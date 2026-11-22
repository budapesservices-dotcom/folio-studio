import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioDocument, PathNode } from '../../core/document/types';
import { resolveComponentInstanceNodes } from '../../core/document/components';
import { serializePathPointsToSvgD } from '../../core/document/vector';
import {
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerClipMaskBaseIds,
  getLayerDescendantIds,
  getLayerRenderOrder,
} from '../../core/document/layers';

export type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

export function sanitizeMaskIdSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildMaskElementId(scopePrefix: string, baseId: string): string {
  return `${scopePrefix}--${sanitizeMaskIdSegment(baseId)}`;
}

function getComponentById(
  components: readonly ComponentDefinition[],
  componentById?: ReadonlyMap<string, ComponentDefinition>,
): ReadonlyMap<string, ComponentDefinition> {
  if (componentById) return componentById;
  return new Map(components.map((component) => [component.id, component]));
}

function buildArrowheadPolygon(
  tip: { x: number; y: number },
  from: { x: number; y: number },
  size: number,
): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return '';
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const backX = tip.x - ux * size;
  const backY = tip.y - uy * size;
  const wing = size * 0.48;
  return `${tip.x},${tip.y} ${backX + px * wing},${backY + py * wing} ${backX - px * wing},${backY - py * wing}`;
}

function renderPathArrowheads(node: PathNode, mask: boolean) {
  if (node.closed || node.points.length < 2) return null;
  if (!node.style.arrowStart && !node.style.arrowEnd) return null;
  const color = mask ? '#fff' : (node.style.stroke !== 'none' && node.style.stroke !== '#00000000' ? node.style.stroke : node.style.fill);
  if (!color || color === 'none') return null;
  const size = Math.max(10, Math.min(28, (node.style.strokeWidth || 2) * 3.8));
  const arrows = [];
  if (node.style.arrowEnd) {
    const tip = node.points[node.points.length - 1];
    const prev = tip.handleIn ?? node.points[node.points.length - 2];
    const pts = buildArrowheadPolygon(tip, prev, size);
    if (pts) arrows.push(<polygon key="arrow-end" points={pts} fill={color} />);
  }
  if (node.style.arrowStart) {
    const tip = node.points[0];
    const next = tip.handleOut ?? node.points[1];
    const pts = buildArrowheadPolygon(tip, next, size);
    if (pts) arrows.push(<polygon key="arrow-start" points={pts} fill={color} />);
  }
  return arrows.length > 0 ? <>{arrows}</> : null;
}

export function NodeShape({ node, mask = false }: { node: PrimitiveNode; mask?: boolean }) {
  const transform = node.rotation
    ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
    : undefined;

  return (
    <g transform={transform} opacity={node.opacity} class="canvas-node">
      {node.type === 'group' && (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill="transparent"
          pointer-events="all"
        />
      )}
      {node.type === 'frame' && (
        <g>
          {!mask && (
            <text
              x={node.x + 2}
              y={node.y - 8}
              fill={node.isSection ? '#8B7CF6' : '#7D879B'}
              font-size="11"
              font-family="Inter, system-ui, sans-serif"
              font-weight="600"
              pointer-events="none"
            >
              {node.name}
            </text>
          )}
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx={node.style.radius ?? 0}
            fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
            stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke}
            stroke-width={node.style.strokeWidth}
            stroke-dasharray={node.isSection && !mask ? '6 4' : undefined}
          />
        </g>
      )}
      {node.type === 'rect' && (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.style.radius ?? 0}
          fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
          stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke}
          stroke-width={node.style.strokeWidth}
        />
      )}
      {node.type === 'ellipse' && (
        <ellipse
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
          stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke}
          stroke-width={node.style.strokeWidth}
        />
      )}
      {node.type === 'path' && (
        <g transform={`translate(${node.x} ${node.y})`}>
          {!mask && !node.closed && (
            <path
              d={serializePathPointsToSvgD(node.points, node.closed, node.subpaths)}
              fill="none"
              stroke="transparent"
              stroke-width={Math.max(12, node.style.strokeWidth + 8)}
              stroke-linecap="round"
              stroke-linejoin="round"
              pointer-events="stroke"
            />
          )}
          <path
            d={serializePathPointsToSvgD(node.points, node.closed, node.subpaths)}
            fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
            fill-rule={node.style.fillRule ?? 'nonzero'}
            stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke}
            stroke-width={node.style.strokeWidth}
            stroke-linecap={node.style.strokeLinecap ?? 'round'}
            stroke-linejoin={node.style.strokeLinejoin ?? 'round'}
            stroke-dasharray={node.style.strokeDasharray || undefined}
          />
          {renderPathArrowheads(node, mask)}
        </g>
      )}
      {node.type === 'text' && (
        <text
          x={node.x}
          y={node.y}
          fill={mask ? '#fff' : node.style.fill}
          font-size={node.style.fontSize}
          font-family={node.style.fontFamily}
          font-weight={node.style.fontWeight}
          letter-spacing={node.style.letterSpacing}
          dominant-baseline="hanging"
        >
          {node.text.split(/\r?\n/).map((line, index) => (
            <tspan
              key={`${node.id}-${index}`}
              x={node.x}
              dy={index === 0 ? 0 : node.style.fontSize * node.style.lineHeight}
            >
              {line || ' '}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

/** Paint a base layer's alpha silhouette into an SVG mask. Group bases use their descendants. */
export function ClipMaskArtwork({
  node,
  nodes,
  components,
  maskPrefix,
  nodeById,
  componentById,
}: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
  maskPrefix: string;
  nodeById?: ReadonlyMap<string, DesignNode>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
}) {
  if (node.type === 'group') {
    const resolvedNodeById = nodeById ?? new Map(nodes.map((item) => [item.id, item]));
    const states = getEffectiveLayerStates(nodes);
    const descendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => resolvedNodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#fff" opacity={node.opacity} />;
    }
    return (
      <g>
        {descendants.map((child) => (
          <ClipMaskArtwork
            key={child.id}
            node={child}
            nodes={nodes}
            components={components}
            maskPrefix={maskPrefix}
            nodeById={resolvedNodeById}
            componentById={componentById}
          />
        ))}
      </g>
    );
  }

  if (node.type === 'component-instance') {
    const resolvedComponents = getComponentById(components, componentById);
    const component = resolvedComponents.get(node.componentId);
    if (!component) {
      const transform = node.rotation
        ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
        : undefined;
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#fff" opacity={node.opacity} transform={transform} />;
    }
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const transform = node.rotation
      ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
      : undefined;
    const resolved = resolveComponentInstanceNodes(node, component);
    const visibleChildren = resolved.filter((child) => child.onCanvas !== false);
    const childNodeById = new Map(visibleChildren.map((child) => [child.id, child]));
    const childClipMaskMap = buildLayerClipMaskMap(visibleChildren, childNodeById);
    const states = getEffectiveLayerStates(visibleChildren);
    const instanceMaskPrefix = `${maskPrefix}-instmask-${sanitizeMaskIdSegment(node.id)}`;
    return (
      <g transform={transform} opacity={node.opacity}>
        <g transform={`translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})`}>
          <defs>
            <DocumentMaskDefs
              nodes={visibleChildren}
              width={component.document.width}
              height={component.document.height}
              components={components}
              maskPrefix={instanceMaskPrefix}
              nodeById={childNodeById}
              clipMaskMap={childClipMaskMap}
              componentById={resolvedComponents}
            />
          </defs>
          {getLayerRenderOrder(visibleChildren)
            .filter((child) => {
              if (child.type === 'group' || !states.get(child.id)?.visible) return false;
              const maskIds = childClipMaskMap.get(child.id) ?? [];
              return maskIds.every((baseId) => states.get(baseId)?.visible);
            })
            .map((child) => {
              const maskIds = childClipMaskMap.get(child.id) ?? [];
              const shape = child.type === 'component-instance'
                ? <rect key={child.id} x={child.x} y={child.y} width={child.width} height={child.height} fill="#fff" opacity={child.opacity} />
                : <NodeShape key={child.id} node={child as PrimitiveNode} mask />;
              return maskIds.reduceRight(
                (artwork, baseId) => <g mask={`url(#${buildMaskElementId(instanceMaskPrefix, baseId)})`}>{artwork}</g>,
                shape,
              );
            })}
        </g>
      </g>
    );
  }

  return <NodeShape node={node as PrimitiveNode} mask />;
}

export function DocumentMaskDefs({
  nodes,
  width,
  height,
  components,
  maskPrefix,
  nodeById,
  clipMaskMap,
  componentById,
}: {
  nodes: DesignNode[];
  width: number;
  height: number;
  components: ComponentDefinition[];
  maskPrefix: string;
  nodeById?: ReadonlyMap<string, DesignNode>;
  clipMaskMap?: ReadonlyMap<string, string[]>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
}) {
  const resolvedNodeById = nodeById ?? new Map(nodes.map((node) => [node.id, node]));
  const resolvedClipMaskMap = clipMaskMap ?? buildLayerClipMaskMap(nodes, resolvedNodeById);
  const referencedSet = new Set<string>();
  for (const node of nodes) {
    const baseIds = resolvedClipMaskMap.get(node.id);
    if (!baseIds) continue;
    for (const baseId of baseIds) referencedSet.add(baseId);
  }
  if (referencedSet.size === 0) return null;

  const resolvedComponents = getComponentById(components, componentById);
  const referencedBaseIds = [...referencedSet];
  return (
    <>
      {referencedBaseIds.map((baseId) => {
        const base = resolvedNodeById.get(baseId);
        if (!base) return null;
        return (
          <mask
            key={baseId}
            id={buildMaskElementId(maskPrefix, baseId)}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={width}
            height={height}
          >
            <rect x="0" y="0" width={width} height={height} fill="#000" />
            <ClipMaskArtwork
              node={base}
              nodes={nodes}
              components={components}
              maskPrefix={maskPrefix}
              nodeById={resolvedNodeById}
              componentById={resolvedComponents}
            />
          </mask>
        );
      })}
    </>
  );
}

export function NodeArtwork({
  node,
  components = [],
  maskPrefix,
  emitNodeId = true,
  componentById,
}: {
  node: DesignNode;
  components?: ComponentDefinition[];
  maskPrefix: string;
  emitNodeId?: boolean;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
}) {
  if (node.type === 'component-instance') {
    const resolvedComponents = getComponentById(components, componentById);
    const component = resolvedComponents.get(node.componentId);
    const scaleX = component ? node.width / Math.max(1, component.document.width) : 1;
    const scaleY = component ? node.height / Math.max(1, component.document.height) : 1;
    const transform = node.rotation
      ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
      : undefined;
    const resolvedChildren = component
      ? resolveComponentInstanceNodes(node, component).filter((child) => child.onCanvas !== false)
      : [];
    const childNodeById = new Map(resolvedChildren.map((child) => [child.id, child]));
    const childClipMaskMap = buildLayerClipMaskMap(resolvedChildren, childNodeById);
    const childStates = getEffectiveLayerStates(resolvedChildren);
    const instanceMaskPrefix = `${maskPrefix}-inst-${sanitizeMaskIdSegment(node.id)}`;
    return (
      <g
        data-node-id={emitNodeId ? node.id : undefined}
        transform={transform}
        opacity={node.opacity}
        class="canvas-node component-instance-artwork"
      >
        {component ? (
          <g transform={`translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})`}>
            <defs>
              <DocumentMaskDefs
                nodes={resolvedChildren}
                width={component.document.width}
                height={component.document.height}
                components={components}
                maskPrefix={instanceMaskPrefix}
                nodeById={childNodeById}
                clipMaskMap={childClipMaskMap}
                componentById={resolvedComponents}
              />
            </defs>
            <rect
              x="0"
              y="0"
              width={component.document.width}
              height={component.document.height}
              fill="transparent"
              pointer-events="all"
            />
            {getLayerRenderOrder(resolvedChildren)
              .filter((child) => {
                if (!childStates.get(child.id)?.visible) return false;
                const maskIds = childClipMaskMap.get(child.id) ?? [];
                return maskIds.every((baseId) => childStates.get(baseId)?.visible);
              })
              .map((effective) => (
                effective.type === 'component-instance'
                  ? null
                  : (
                    <MaskedNodeArtwork
                      key={effective.id}
                      node={effective}
                      nodes={resolvedChildren}
                      components={components}
                      maskPrefix={instanceMaskPrefix}
                      emitNodeId={false}
                      clipMaskMap={childClipMaskMap}
                      componentById={resolvedComponents}
                    />
                  )
              ))}
          </g>
        ) : (
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill="none"
            stroke="#D45B5B"
            stroke-dasharray="6 4"
            stroke-width="2"
            pointer-events="all"
          />
        )}
      </g>
    );
  }

  return <g data-node-id={emitNodeId ? node.id : undefined}><NodeShape node={node as PrimitiveNode} /></g>;
}

export function MaskedNodeArtwork({
  node,
  nodes,
  components,
  maskPrefix,
  emitNodeId = true,
  clipMaskMap,
  componentById,
}: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
  maskPrefix: string;
  emitNodeId?: boolean;
  clipMaskMap?: ReadonlyMap<string, string[]>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
}) {
  const maskIds = clipMaskMap ? (clipMaskMap.get(node.id) ?? []) : getLayerClipMaskBaseIds(nodes, node.id);
  return maskIds.reduceRight(
    (artwork, maskId) => <g mask={`url(#${buildMaskElementId(maskPrefix, maskId)})`}>{artwork}</g>,
    <NodeArtwork
      node={node}
      components={components}
      maskPrefix={maskPrefix}
      emitNodeId={emitNodeId}
      componentById={componentById}
    />,
  );
}

export function DocumentArtworkContent({
  document,
  components = [],
  maskPrefix,
}: {
  document: FolioDocument;
  components?: ComponentDefinition[];
  maskPrefix: string;
}) {
  const canvasNodes = document.nodes.filter((node) => node.onCanvas !== false);
  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const clipMaskMap = buildLayerClipMaskMap(canvasNodes, nodeById);
  const layerStates = getEffectiveLayerStates(canvasNodes);
  const componentById = getComponentById(components);
  return (
    <>
      <defs>
        <DocumentMaskDefs
          nodes={canvasNodes}
          width={document.width}
          height={document.height}
          components={components}
          maskPrefix={maskPrefix}
          nodeById={nodeById}
          clipMaskMap={clipMaskMap}
          componentById={componentById}
        />
      </defs>
      {document.background !== '#00000000' && document.background !== 'transparent' && (
        <rect x="0" y="0" width={document.width} height={document.height} fill={document.background} />
      )}
      {getLayerRenderOrder(canvasNodes)
        .filter((node) => {
          const state = layerStates.get(node.id);
          if (!state?.visible) return false;
          const maskIds = clipMaskMap.get(node.id) ?? [];
          return maskIds.every((baseId) => layerStates.get(baseId)?.visible);
        })
        .map((node) => (
          <MaskedNodeArtwork
            key={node.id}
            node={node}
            nodes={canvasNodes}
            components={components}
            maskPrefix={maskPrefix}
            clipMaskMap={clipMaskMap}
            componentById={componentById}
          />
        ))}
    </>
  );
}

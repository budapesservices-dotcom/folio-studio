import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  PathNode,
} from '../../core/document/types';
import {
  nodeLocalPointToWorld,
  serializePathPointsToSvgD,
  type PlanarArrangement,
  type PlanarFace,
} from '../../core/document/vector';
import { MaskedNodeArtwork, NodeShape, type PrimitiveNode } from './artwork';
import { planarFaceToSvgPath } from './canvasHelpers';
import type { Bounds, ResizeHandle, SnapGuide, SpacingRedlineResult } from './geometry';
import type {
  CanvasToolId,
  CanvasToolOptions,
  CanvasToolOverlay,
  CanvasToolSession,
} from './tools/types';

const HANDLE_SIZE = 10;
const ROTATE_ZONE_OFFSET = 14;
const ROTATE_ZONE_SIZE = 14;

export function SelectionOverlay({
  bounds,
  canResize,
  canRotate,
  isScaleTool,
  invZoom,
}: {
  bounds: Bounds;
  canResize: boolean;
  canRotate: boolean;
  isScaleTool: boolean;
  invZoom: number;
}) {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const middleX = left + bounds.width / 2;
  const middleY = top + bounds.height / 2;
  const handleSize = HANDLE_SIZE * invZoom;
  const rotateOffset = ROTATE_ZONE_OFFSET * invZoom;
  const rotateSize = ROTATE_ZONE_SIZE * invZoom;

  const handles: { id: ResizeHandle; x: number; y: number }[] = [
    { id: 'nw', x: left, y: top },
    { id: 'n', x: middleX, y: top },
    { id: 'ne', x: right, y: top },
    { id: 'e', x: right, y: middleY },
    { id: 'se', x: right, y: bottom },
    { id: 's', x: middleX, y: bottom },
    { id: 'sw', x: left, y: bottom },
    { id: 'w', x: left, y: middleY },
  ];
  const rotateZones = [
    { id: 'rot-nw', x: left - rotateOffset, y: top - rotateOffset },
    { id: 'rot-ne', x: right + rotateOffset - rotateSize, y: top - rotateOffset },
    { id: 'rot-se', x: right + rotateOffset - rotateSize, y: bottom + rotateOffset - rotateSize },
    { id: 'rot-sw', x: left - rotateOffset, y: bottom + rotateOffset - rotateSize },
  ];

  return (
    <g class="canvas-selection" pointer-events="none">
      {canRotate && rotateZones.map((zone) => (
        <rect
          key={zone.id}
          data-rotate-handle="true"
          class="canvas-rotate-zone"
          x={zone.x}
          y={zone.y}
          width={rotateSize}
          height={rotateSize}
          rx={4 * invZoom}
          pointer-events="all"
        />
      ))}
      <rect
        class={'canvas-selection-outline' + (isScaleTool ? ' is-scale' : '')}
        x={left}
        y={top}
        width={Math.max(1, bounds.width)}
        height={Math.max(1, bounds.height)}
      />
      {canResize && handles.map((handle) => (
        <rect
          key={handle.id}
          data-resize-handle={handle.id}
          class={'canvas-resize-handle' + (isScaleTool ? ' is-scale' : '')}
          x={handle.x - handleSize / 2}
          y={handle.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          rx={isScaleTool ? handleSize / 2 : 2 * invZoom}
          pointer-events="all"
        />
      ))}
    </g>
  );
}

export function VectorAnchorOverlay({
  nodes,
  interactive,
  activeSession,
  activeAnchor,
  invZoom,
}: {
  nodes: PathNode[];
  interactive: boolean;
  activeSession: CanvasToolSession | null;
  activeAnchor: { nodeId: string; pointIndex: number } | null;
  invZoom: number;
}) {
  if (nodes.length === 0) return null;
  const focusedAnchor = activeSession?.kind === 'anchor-edit'
    ? { nodeId: activeSession.node.id, pointIndex: activeSession.pointIndex }
    : activeAnchor;
  const handleR = 4.2 * invZoom;
  const smoothR = 4.8 * invZoom;
  const cornerSize = 9 * invZoom;

  return (
    <g class="canvas-vector-overlay" pointer-events="none">
      {nodes.map((node) => {
        const transform = node.rotation
          ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
          : undefined;
        const d = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
        return (
          <g key={`vec-${node.id}`} transform={transform}>
            <g transform={`translate(${node.x} ${node.y})`}>
              <path class="canvas-vector-wireframe" d={d} />
              {node.points.map((pt, index) => {
                const isActive = focusedAnchor?.nodeId === node.id && focusedAnchor.pointIndex === index;
                const isSmooth = pt.pointType === 'smooth' || pt.pointType === 'symmetric';
                return (
                  <g key={pt.id}>
                    {pt.handleIn && (
                      <>
                        <line
                          class="canvas-bezier-tangent"
                          x1={pt.x}
                          y1={pt.y}
                          x2={pt.handleIn.x}
                          y2={pt.handleIn.y}
                        />
                        <circle
                          class="canvas-bezier-handle"
                          cx={pt.handleIn.x}
                          cy={pt.handleIn.y}
                          r={handleR}
                          data-anchor-node-id={interactive ? node.id : undefined}
                          data-anchor-index={interactive ? String(index) : undefined}
                          data-anchor-part={interactive ? 'handle-in' : undefined}
                          pointer-events={interactive ? 'all' : 'none'}
                        />
                      </>
                    )}
                    {pt.handleOut && (
                      <>
                        <line
                          class="canvas-bezier-tangent"
                          x1={pt.x}
                          y1={pt.y}
                          x2={pt.handleOut.x}
                          y2={pt.handleOut.y}
                        />
                        <circle
                          class="canvas-bezier-handle"
                          cx={pt.handleOut.x}
                          cy={pt.handleOut.y}
                          r={handleR}
                          data-anchor-node-id={interactive ? node.id : undefined}
                          data-anchor-index={interactive ? String(index) : undefined}
                          data-anchor-part={interactive ? 'handle-out' : undefined}
                          pointer-events={interactive ? 'all' : 'none'}
                        />
                      </>
                    )}
                    {isSmooth ? (
                      <circle
                        class={'canvas-vector-anchor is-smooth' + (isActive ? ' is-active' : '')}
                        cx={pt.x}
                        cy={pt.y}
                        r={smoothR}
                        data-anchor-node-id={interactive ? node.id : undefined}
                        data-anchor-index={interactive ? String(index) : undefined}
                        data-anchor-part={interactive ? 'anchor' : undefined}
                        pointer-events={interactive ? 'all' : 'none'}
                      />
                    ) : (
                      <rect
                        class={'canvas-vector-anchor' + (isActive ? ' is-active' : '')}
                        x={pt.x - cornerSize / 2}
                        y={pt.y - cornerSize / 2}
                        width={cornerSize}
                        height={cornerSize}
                        rx={1.5 * invZoom}
                        data-anchor-node-id={interactive ? node.id : undefined}
                        data-anchor-index={interactive ? String(index) : undefined}
                        data-anchor-part={interactive ? 'anchor' : undefined}
                        pointer-events={interactive ? 'all' : 'none'}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        );
      })}
    </g>
  );
}

export function HudBadge({
  x,
  y,
  text,
  variant = 'default',
  invZoom = 1,
}: {
  x: number;
  y: number;
  text: string;
  variant?: 'default' | 'measure' | 'rotate';
  invZoom?: number;
}) {
  const width = Math.max(46, text.length * 6.8 + 16);
  const height = 22;
  return (
    <g
      class={`canvas-hud-badge is-${variant}`}
      transform={`translate(${x} ${y}) scale(${invZoom})`}
      pointer-events="none"
    >
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="4" />
      <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">{text}</text>
    </g>
  );
}

export interface EyedropperLoupeState {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly sourceName: string;
  readonly target: string;
}

export interface CanvasInteractiveOverlaysProps {
  readonly docWidth: number;
  readonly docHeight: number;
  readonly invZoom: number;
  readonly toolId: CanvasToolId;
  readonly toolOptions: CanvasToolOptions;
  readonly toolSession: CanvasToolSession | null;
  readonly toolOverlay: CanvasToolOverlay | null;
  readonly selectedNodes: DesignNode[];
  readonly selectedPathNodes: PathNode[];
  readonly selectionBounds: Bounds | null;
  readonly showSelectionBox: boolean;
  readonly canResize: boolean;
  readonly showVectorAnchors: boolean;
  readonly vectorAnchorsInteractive: boolean;
  readonly activeAnchor: { nodeId: string; pointIndex: number } | null;
  readonly previewCreateNodes: DesignNode[] | null;
  readonly isolatedPreviewNodes?: readonly DesignNode[] | null;
  readonly canvasNodes: DesignNode[];
  readonly components: ComponentDefinition[];
  readonly assets?: readonly AssetReference[];
  readonly maskPrefix: string;
  readonly clipMaskMap: Map<string, string[]>;
  readonly frameClipMap: Map<string, string[]>;
  readonly componentById: Map<string, ComponentDefinition>;
  readonly assetById?: ReadonlyMap<string, AssetReference>;
  readonly designTokens?: DesignTokenCollection;
  readonly shapeBuilderHoverArrangement: PlanarArrangement | null;
  readonly shapeBuilderHoveredFace: PlanarFace | null;
  readonly altHeld: boolean;
  readonly smartHandleNode: DesignNode | null;
  readonly pivotPoint: { x: number; y: number } | null;
  readonly spacingRedlines: SpacingRedlineResult | null;
  readonly pathSnapWorldPoint: { x: number; y: number } | null;
  readonly hoverPoint: { x: number; y: number } | null;
  readonly eyedropperLoupe: EyedropperLoupeState | null;
  readonly guides: SnapGuide[];
}

export function CanvasInteractiveOverlays({
  docWidth,
  docHeight,
  invZoom,
  toolId,
  toolOptions,
  toolSession,
  toolOverlay,
  selectedNodes,
  selectedPathNodes,
  selectionBounds,
  showSelectionBox,
  canResize,
  showVectorAnchors,
  vectorAnchorsInteractive,
  activeAnchor,
  previewCreateNodes,
  isolatedPreviewNodes,
  canvasNodes,
  components,
  assets,
  maskPrefix,
  clipMaskMap,
  frameClipMap,
  componentById,
  assetById,
  designTokens,
  shapeBuilderHoverArrangement,
  shapeBuilderHoveredFace,
  altHeld,
  smartHandleNode,
  pivotPoint,
  spacingRedlines,
  pathSnapWorldPoint,
  hoverPoint,
  eyedropperLoupe,
  guides,
}: CanvasInteractiveOverlaysProps) {
  return (
    <>
      {/* Shape Builder hatch patterns live in the interactive overlay so zoom ticks never invalidate static scene memoization. */}
      {toolId === 'shape-builder' && (
        <defs>
          <pattern
            id={`${maskPrefix}-sb-merge`}
            width={10 * invZoom}
            height={10 * invZoom}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={10 * invZoom} height={10 * invZoom} fill="rgba(56, 189, 248, 0.28)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={10 * invZoom}
              stroke="rgba(255, 255, 255, 0.55)"
              stroke-width={2 * invZoom}
            />
          </pattern>
          <pattern
            id={`${maskPrefix}-sb-punch`}
            width={10 * invZoom}
            height={10 * invZoom}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width={10 * invZoom} height={10 * invZoom} fill="rgba(244, 63, 94, 0.34)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={10 * invZoom}
              stroke="rgba(255, 255, 255, 0.55)"
              stroke-width={2 * invZoom}
            />
          </pattern>
        </defs>
      )}

      {/* Isolated Active Drag/Transform Layer — updates at 60–120fps without reconciling static scene nodes. */}
      {isolatedPreviewNodes && isolatedPreviewNodes.length > 0 && (
        <g class="canvas-active-drag-layer" pointer-events="none">
          {isolatedPreviewNodes.map((node) => (
            <MaskedNodeArtwork
              key={`drag-${node.id}`}
              node={node}
              nodes={canvasNodes}
              components={components}
              assets={assets}
              maskPrefix={maskPrefix}
              clipMaskMap={clipMaskMap}
              frameClipMap={frameClipMap}
              componentById={componentById}
              assetById={assetById}
              tokens={designTokens}
            />
          ))}
        </g>
      )}

      {/* Auto-Layout Inner Padding Guide on Selected Container */}
      {selectedNodes.length === 1 &&
        selectedNodes[0].layout &&
        selectedNodes[0].layout.mode !== 'none' && (() => {
          const container = selectedNodes[0];
          const containerLayout = container.layout;
          if (!containerLayout || containerLayout.mode === 'none') return null;
          const pad = containerLayout.padding;
          const innerW = Math.max(0, container.width - pad.left - pad.right);
          const innerH = Math.max(0, container.height - pad.top - pad.bottom);
          if (innerW <= 0 || innerH <= 0) return null;
          return (
            <rect
              class="canvas-autolayout-padding-guide"
              x={container.x + pad.left}
              y={container.y + pad.top}
              width={innerW}
              height={innerH}
              fill="none"
              stroke="#38BDF8"
              stroke-opacity="0.55"
              stroke-width={1 * invZoom}
              stroke-dasharray={`${4 * invZoom} ${3 * invZoom}`}
              pointer-events="none"
            />
          );
        })()}

      {/* Live Alt+Drag Clone Ghost Preview */}
      {previewCreateNodes && previewCreateNodes.length > 0 && (
        <g class="canvas-clone-preview" opacity={0.84} pointer-events="none">
          {previewCreateNodes.map((node) => (
            <MaskedNodeArtwork
              key={`clone-${node.id}`}
              node={node}
              nodes={[...canvasNodes, ...previewCreateNodes]}
              components={components}
              assets={assets}
              maskPrefix={maskPrefix}
              clipMaskMap={clipMaskMap}
              frameClipMap={frameClipMap}
              componentById={componentById}
              assetById={assetById}
              tokens={designTokens}
            />
          ))}
        </g>
      )}

      {toolOverlay?.kind === 'marquee' && (
        <rect
          class="canvas-marquee"
          x={toolOverlay.bounds.x}
          y={toolOverlay.bounds.y}
          width={toolOverlay.bounds.width}
          height={toolOverlay.bounds.height}
          pointer-events="none"
        />
      )}
      {toolOverlay?.kind === 'lasso' && (
        <polyline
          class="canvas-lasso"
          points={toolOverlay.points.map((point) => point.x + ',' + point.y).join(' ')}
          pointer-events="none"
        />
      )}
      {toolOverlay?.kind === 'draw-preview' && (
        <g class="canvas-draw-preview" pointer-events="none">
          <g opacity={0.78}>
            <NodeShape node={toolOverlay.node as PrimitiveNode} />
          </g>
          <rect
            class="canvas-draw-preview-box"
            x={toolOverlay.node.x}
            y={toolOverlay.node.y}
            width={Math.max(1, toolOverlay.node.width)}
            height={Math.max(1, toolOverlay.node.height)}
          />
          <HudBadge x={toolOverlay.labelX} y={toolOverlay.labelY} text={toolOverlay.label} invZoom={invZoom} />
        </g>
      )}
      {toolOverlay?.kind === 'pen-draft' && (
        <g class="canvas-pen-draft" pointer-events="none">
          {toolOverlay.points.length >= 2 && (
            <path
              class="canvas-pen-draft-path"
              d={serializePathPointsToSvgD(toolOverlay.points, false)}
            />
          )}
          {toolOverlay.previewPoints && toolOverlay.previewPoints.length >= 2 ? (
            <path
              class="canvas-pen-rubberband"
              d={serializePathPointsToSvgD(toolOverlay.previewPoints, Boolean(toolOverlay.closedPreview))}
            />
          ) : toolOverlay.points.length >= 1 && (() => {
            const last = toolOverlay.points[toolOverlay.points.length - 1];
            const target = toolOverlay.hoverClose && toolOverlay.points.length >= 3
              ? toolOverlay.points[0]
              : toolOverlay.cursor;
            const rubberD = last.handleOut
              ? `M ${last.x} ${last.y} C ${last.handleOut.x} ${last.handleOut.y} ${target.x} ${target.y} ${target.x} ${target.y}`
              : `M ${last.x} ${last.y} L ${target.x} ${target.y}`;
            return <path class="canvas-pen-rubberband" d={rubberD} />;
          })()}
          {toolOverlay.points.map((pt, index) => (
            <g key={pt.id}>
              {pt.handleIn && (
                <>
                  <line class="canvas-bezier-tangent" x1={pt.x} y1={pt.y} x2={pt.handleIn.x} y2={pt.handleIn.y} />
                  <circle class="canvas-bezier-handle" cx={pt.handleIn.x} cy={pt.handleIn.y} r={3.6 * invZoom} />
                </>
              )}
              {pt.handleOut && (
                <>
                  <line class="canvas-bezier-tangent" x1={pt.x} y1={pt.y} x2={pt.handleOut.x} y2={pt.handleOut.y} />
                  <circle class="canvas-bezier-handle" cx={pt.handleOut.x} cy={pt.handleOut.y} r={3.6 * invZoom} />
                </>
              )}
              {index === 0 && toolOverlay.hoverClose && (
                <circle class="canvas-pen-close-ring" cx={pt.x} cy={pt.y} r={9 * invZoom} />
              )}
              <rect
                class={'canvas-vector-anchor' + (index === 0 ? ' is-origin' : '')}
                x={pt.x - 4 * invZoom}
                y={pt.y - 4 * invZoom}
                width={8 * invZoom}
                height={8 * invZoom}
                rx={1.5 * invZoom}
              />
            </g>
          ))}
          {toolOverlay.segmentHud && (
            <HudBadge
              x={toolOverlay.cursor.x}
              y={toolOverlay.cursor.y - 20 * invZoom}
              text={toolOverlay.segmentHud}
              invZoom={invZoom}
            />
          )}
        </g>
      )}
      {toolOverlay?.kind === 'freehand' && toolOverlay.points.length >= 2 && (
        <polyline
          class={'canvas-freehand-preview is-' + toolOverlay.mode}
          points={toolOverlay.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          pointer-events="none"
        />
      )}
      {toolOverlay?.kind === 'rotate-ring' && (
        <g class="canvas-rotate-overlay" pointer-events="none">
          <circle
            class="canvas-rotate-circle"
            cx={toolOverlay.center.x}
            cy={toolOverlay.center.y}
            r={toolOverlay.radius}
          />
          <line
            class="canvas-rotate-crosshair"
            x1={toolOverlay.center.x - 7 * invZoom}
            y1={toolOverlay.center.y}
            x2={toolOverlay.center.x + 7 * invZoom}
            y2={toolOverlay.center.y}
          />
          <line
            class="canvas-rotate-crosshair"
            x1={toolOverlay.center.x}
            y1={toolOverlay.center.y - 7 * invZoom}
            x2={toolOverlay.center.x}
            y2={toolOverlay.center.y + 7 * invZoom}
          />
          <HudBadge
            x={toolOverlay.center.x}
            y={toolOverlay.center.y - toolOverlay.radius - 16 * invZoom}
            text={`${toolOverlay.angleDeg}°`}
            variant="rotate"
            invZoom={invZoom}
          />
        </g>
      )}
      {toolOverlay?.kind === 'measure' && (
        <g class="canvas-measure-overlay" pointer-events="none">
          {toolOverlay.inspectedBounds ? (
            <>
              <rect
                class="canvas-measure-box"
                x={toolOverlay.inspectedBounds.x}
                y={toolOverlay.inspectedBounds.y}
                width={Math.max(1, toolOverlay.inspectedBounds.width)}
                height={Math.max(1, toolOverlay.inspectedBounds.height)}
              />
              <HudBadge
                x={toolOverlay.inspectedBounds.x + toolOverlay.inspectedBounds.width / 2}
                y={toolOverlay.inspectedBounds.y - 16 * invZoom}
                text={toolOverlay.inspectedLabel ?? `${Math.round(toolOverlay.inspectedBounds.width)} × ${Math.round(toolOverlay.inspectedBounds.height)}`}
                variant="measure"
                invZoom={invZoom}
              />
            </>
          ) : (
            <>
              <line
                class="canvas-measure-guide"
                x1={toolOverlay.start.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.start.y}
              />
              <line
                class="canvas-measure-guide"
                x1={toolOverlay.end.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.end.y}
              />
              <line
                class="canvas-measure-line"
                x1={toolOverlay.start.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.end.y}
              />
              {toolOverlay.snappedStart && (
                <circle class="canvas-measure-snap-ring" cx={toolOverlay.start.x} cy={toolOverlay.start.y} r={6.5 * invZoom} />
              )}
              {toolOverlay.snappedEnd && (
                <circle class="canvas-measure-snap-ring" cx={toolOverlay.end.x} cy={toolOverlay.end.y} r={6.5 * invZoom} />
              )}
              <circle class="canvas-measure-dot" cx={toolOverlay.start.x} cy={toolOverlay.start.y} r={3.5 * invZoom} />
              <circle class="canvas-measure-dot" cx={toolOverlay.end.x} cy={toolOverlay.end.y} r={3.5 * invZoom} />
              <HudBadge
                x={(toolOverlay.start.x + toolOverlay.end.x) / 2}
                y={Math.min(toolOverlay.start.y, toolOverlay.end.y) - 18 * invZoom}
                text={`${toolOverlay.distance}px · ΔX ${toolOverlay.dx} · ΔY ${toolOverlay.dy} · ${toolOverlay.angleDeg}°`}
                variant="measure"
                invZoom={invZoom}
              />
            </>
          )}
        </g>
      )}

      {/* Interactive Shape Builder Overlay (Active Drag & Hover Decomposition) */}
      {toolOverlay?.kind === 'shape-builder' && (
        <g class="canvas-shape-builder-overlay" pointer-events="none">
          {toolOverlay.arrangement.faces.map((face) => {
            const isTouched = toolOverlay.touchedFaceIds.includes(face.id);
            const patternFill = isTouched
              ? `url(#${maskPrefix}-sb-${toolOverlay.mode === 'punch' ? 'punch' : 'merge'})`
              : undefined;
            return (
              <path
                key={`sb-face-${face.id}`}
                class={
                  'canvas-sb-face' +
                  (isTouched ? (toolOverlay.mode === 'punch' ? ' is-punch' : ' is-merge') : '')
                }
                style={patternFill ? { fill: patternFill } : undefined}
                d={planarFaceToSvgPath(face)}
                fill-rule="evenodd"
              />
            );
          })}
          {toolOverlay.strokePoints.length >= 2 && (
            <polyline
              class={'canvas-sb-stroke' + (toolOverlay.mode === 'punch' ? ' is-punch' : ' is-merge')}
              points={toolOverlay.strokePoints.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            />
          )}
          {toolOverlay.strokePoints.length > 0 && (() => {
            const tip = toolOverlay.strokePoints[toolOverlay.strokePoints.length - 1];
            return (
              <HudBadge
                x={tip.x}
                y={tip.y - 20 * invZoom}
                text={
                  toolOverlay.mode === 'punch'
                    ? `− Punch (${toolOverlay.touchedFaceIds.length})`
                    : `+ Merge (${toolOverlay.touchedFaceIds.length})`
                }
                variant={toolOverlay.mode === 'punch' ? 'measure' : 'default'}
                invZoom={invZoom}
              />
            );
          })()}
        </g>
      )}
      {toolId === 'shape-builder' && !toolSession && shapeBuilderHoverArrangement && (
        <g class="canvas-shape-builder-overlay" pointer-events="none">
          {shapeBuilderHoverArrangement.faces.map((face) => {
            const isHover = shapeBuilderHoveredFace?.id === face.id;
            const patternFill = isHover
              ? `url(#${maskPrefix}-sb-${altHeld ? 'punch' : 'merge'})`
              : undefined;
            return (
              <path
                key={`sb-idle-${face.id}`}
                class={
                  'canvas-sb-face' +
                  (isHover ? (altHeld ? ' is-punch' : ' is-merge') : '')
                }
                style={patternFill ? { fill: patternFill } : undefined}
                d={planarFaceToSvgPath(face)}
                fill-rule="evenodd"
              />
            );
          })}
          {shapeBuilderHoveredFace && (
            <g
              class={'canvas-sb-glyph' + (altHeld ? ' is-punch' : ' is-merge')}
              transform={`translate(${shapeBuilderHoveredFace.interiorPoint.x} ${shapeBuilderHoveredFace.interiorPoint.y}) scale(${invZoom})`}
            >
              <circle r="11" />
              <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">
                {altHeld ? '−' : '+'}
              </text>
            </g>
          )}
        </g>
      )}

      {showSelectionBox && selectionBounds && (
        <SelectionOverlay
          bounds={selectionBounds}
          canResize={canResize && (toolId === 'select' || toolId === 'direct-selection' || toolId === 'scale')}
          canRotate={canResize && toolId === 'select'}
          isScaleTool={toolId === 'scale'}
          invZoom={invZoom}
        />
      )}

      {/* On-Canvas Smart Handles: Corner Radius Knobs (Rect/Frame) */}
      {smartHandleNode &&
        (smartHandleNode.type === 'rect' || smartHandleNode.type === 'frame') &&
        smartHandleNode.width >= 28 &&
        smartHandleNode.height >= 28 && (() => {
          const maxR = Math.min(smartHandleNode.width, smartHandleNode.height) / 2;
          const currentR = Math.max(0, Math.min(maxR, smartHandleNode.style.radius ?? 0));
          const inset = Math.min(maxR - 4 * invZoom, Math.max(11 * invZoom, currentR * 0.72 + 10 * invZoom));
          const cx = smartHandleNode.x + smartHandleNode.width / 2;
          const cy = smartHandleNode.y + smartHandleNode.height / 2;
          const rot = smartHandleNode.rotation ? `rotate(${smartHandleNode.rotation} ${cx} ${cy})` : undefined;
          const corners: Array<{ id: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
            { id: 'nw', x: smartHandleNode.x + inset, y: smartHandleNode.y + inset },
            { id: 'ne', x: smartHandleNode.x + smartHandleNode.width - inset, y: smartHandleNode.y + inset },
            { id: 'se', x: smartHandleNode.x + smartHandleNode.width - inset, y: smartHandleNode.y + smartHandleNode.height - inset },
            { id: 'sw', x: smartHandleNode.x + inset, y: smartHandleNode.y + smartHandleNode.height - inset },
          ];
          return (
            <g class="canvas-smart-handles" transform={rot}>
              {corners.map((corner) => (
                <g
                  key={`cr-${corner.id}`}
                  class="canvas-smart-handle"
                  data-smart-handle="corner-radius"
                  data-smart-node-id={smartHandleNode.id}
                  data-smart-corner={corner.id}
                  pointer-events="all"
                >
                  <circle class="canvas-smart-handle-hit" cx={corner.x} cy={corner.y} r={9 * invZoom} />
                  <circle class="canvas-smart-handle-ring" cx={corner.x} cy={corner.y} r={4.2 * invZoom} />
                  <circle class="canvas-smart-handle-dot" cx={corner.x} cy={corner.y} r={1.4 * invZoom} />
                </g>
              ))}
            </g>
          );
        })()}

      {/* On-Canvas Smart Handle: Star Inner-Ratio Diamond Handle */}
      {smartHandleNode &&
        smartHandleNode.type === 'path' &&
        smartHandleNode.shapeMeta?.kind === 'star' &&
        smartHandleNode.points.length >= 2 && (() => {
          const worldInner = nodeLocalPointToWorld(smartHandleNode, smartHandleNode.points[1]);
          const size = 7.8 * invZoom;
          return (
            <g
              class="canvas-smart-handle is-star"
              data-smart-handle="star-inner"
              data-smart-node-id={smartHandleNode.id}
              transform={`translate(${worldInner.x} ${worldInner.y})`}
              pointer-events="all"
            >
              <circle class="canvas-smart-handle-hit" cx="0" cy="0" r={10 * invZoom} />
              <rect
                class="canvas-smart-handle-diamond"
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                transform="rotate(45)"
              />
            </g>
          );
        })()}

      {/* Draggable Custom Rotation Pivot Crosshair */}
      {pivotPoint && (
        <g
          class="canvas-pivot-handle"
          data-smart-handle="pivot"
          transform={`translate(${pivotPoint.x} ${pivotPoint.y})`}
          pointer-events="all"
        >
          <circle class="canvas-smart-handle-hit" cx="0" cy="0" r={12 * invZoom} />
          <circle class="canvas-pivot-ring" cx="0" cy="0" r={6.5 * invZoom} />
          <line class="canvas-pivot-tick" x1={-10 * invZoom} y1="0" x2={10 * invZoom} y2="0" />
          <line class="canvas-pivot-tick" x1="0" y1={-10 * invZoom} x2="0" y2={10 * invZoom} />
          <circle class="canvas-pivot-dot" cx="0" cy="0" r={2.2 * invZoom} />
        </g>
      )}

      {showVectorAnchors && (
        <VectorAnchorOverlay
          nodes={selectedPathNodes}
          interactive={vectorAnchorsInteractive}
          activeSession={toolSession}
          activeAnchor={activeAnchor}
          invZoom={invZoom}
        />
      )}

      {/* Alt-Hover Spacing Redlines */}
      {spacingRedlines && spacingRedlines.segments.length > 0 && (
        <g class="canvas-redlines" pointer-events="none">
          <rect
            class="canvas-redline-target"
            x={spacingRedlines.targetBounds.x}
            y={spacingRedlines.targetBounds.y}
            width={Math.max(1, spacingRedlines.targetBounds.width)}
            height={Math.max(1, spacingRedlines.targetBounds.height)}
          />
          {spacingRedlines.extensions.map((ext, i) => (
            <line
              key={`ext-${i}`}
              class="canvas-redline-ext"
              x1={ext.x1}
              y1={ext.y1}
              x2={ext.x2}
              y2={ext.y2}
            />
          ))}
          {spacingRedlines.segments.map((seg, i) => {
            const mx = (seg.x1 + seg.x2) / 2;
            const my = (seg.y1 + seg.y2) / 2;
            const label = `${seg.value}px`;
            const chipW = Math.max(30, label.length * 6.5 + 10);
            const tick = 3.5 * invZoom;
            return (
              <g key={`red-${i}`}>
                <line class="canvas-redline-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />
                {seg.orientation === 'horizontal' ? (
                  <>
                    <line class="canvas-redline-line" x1={seg.x1} y1={seg.y1 - tick} x2={seg.x1} y2={seg.y1 + tick} />
                    <line class="canvas-redline-line" x1={seg.x2} y1={seg.y2 - tick} x2={seg.x2} y2={seg.y2 + tick} />
                  </>
                ) : (
                  <>
                    <line class="canvas-redline-line" x1={seg.x1 - tick} y1={seg.y1} x2={seg.x1 + tick} y2={seg.y1} />
                    <line class="canvas-redline-line" x1={seg.x2 - tick} y1={seg.y2} x2={seg.x2 + tick} y2={seg.y2} />
                  </>
                )}
                <g class="canvas-redline-chip" transform={`translate(${mx} ${my}) scale(${invZoom})`}>
                  <rect x={-chipW / 2} y="-9" width={chipW} height="18" rx="3" />
                  <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">{label}</text>
                </g>
              </g>
            );
          })}
        </g>
      )}

      {/* Path-Snap Hover Dot (Anchor Point & Scissors) */}
      {pathSnapWorldPoint && (
        <g class="canvas-snap-indicator" pointer-events="none">
          <circle
            class="canvas-snap-ring"
            cx={pathSnapWorldPoint.x}
            cy={pathSnapWorldPoint.y}
            r={7 * invZoom}
          />
          <circle
            class="canvas-snap-dot"
            cx={pathSnapWorldPoint.x}
            cy={pathSnapWorldPoint.y}
            r={3.5 * invZoom}
          />
        </g>
      )}

      {/* Smart HUD Overlay (Corner Radius, Star Ratio, Clone, Pivot) */}
      {toolOverlay?.kind === 'smart-hud' && (
        <HudBadge
          x={toolOverlay.x}
          y={toolOverlay.y - 20 * invZoom}
          text={toolOverlay.text}
          variant={toolOverlay.variant ?? 'default'}
          invZoom={invZoom}
        />
      )}

      {/* Live Smooth Brush Radius Ring */}
      {toolId === 'smooth' && hoverPoint && (
        <circle
          class="canvas-smooth-brush"
          cx={hoverPoint.x}
          cy={hoverPoint.y}
          r={Math.max(8, toolOptions.smoothRadius)}
          pointer-events="none"
        />
      )}

      {/* Live Eyedropper Loupe (Edge-Clamped to Artboard Bounds) */}
      {eyedropperLoupe && (() => {
        const flipX = eyedropperLoupe.x + 152 * invZoom > docWidth;
        const flipY = eyedropperLoupe.y - 48 * invZoom < 0;
        const offsetX = flipX ? -144 : 22;
        const offsetY = flipY ? 26 : -26;
        return (
          <g
            class="canvas-eyedropper-loupe"
            transform={`translate(${eyedropperLoupe.x} ${eyedropperLoupe.y}) scale(${invZoom})`}
            pointer-events="none"
          >
            <g transform={`translate(${offsetX} ${offsetY})`}>
              <rect class="canvas-loupe-card" x="-2" y="-16" width="126" height="32" rx="6" />
              <circle class="canvas-loupe-swatch" cx="14" cy="0" r="9.5" fill={eyedropperLoupe.color} />
              <text class="canvas-loupe-hex" x="30" y="-3" dominant-baseline="middle">
                {eyedropperLoupe.color.toUpperCase().slice(0, 7)}
              </text>
              <text class="canvas-loupe-meta" x="30" y="9" dominant-baseline="middle">
                {eyedropperLoupe.target} · {eyedropperLoupe.sourceName.slice(0, 9)}
              </text>
            </g>
          </g>
        );
      })()}

      {guides.map((guide, index) => (
        guide.axis === 'x'
          ? <line key={'guide-x-' + index} class="canvas-guide" x1={guide.position} x2={guide.position} y1="0" y2={docHeight} />
          : <line key={'guide-y-' + index} class="canvas-guide" x1="0" x2={docWidth} y1={guide.position} y2={guide.position} />
      ))}
    </>
  );
}

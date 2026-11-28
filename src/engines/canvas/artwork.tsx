import type { JSX } from 'preact';
import type {
  AssetReference,
  BorderSidesConfig,
  ComponentDefinition,
  ComponentInstanceNode,
  CornerRadiiConfig,
  DesignNode,
  DesignTokenCollection,
  FillPaint,
  FolioDocument,
  FrameNode,
  ImageFitMode,
  ImageNode,
  PathNode,
} from '../../core/document/types';
import { resolveComponentInstanceNodes } from '../../core/document/components';
import {
  buildCssFilterString,
  buildSvgFilterId,
  buildSvgPaintId,
  computeSvgFilterRegion,
  computeSvgLinearGradientCoords,
  getBackdropBlurRadius,
  getVisibleEffects,
  getVisibleFillPaints,
  hasSvgFilterEffects,
  sanitizeStyleColor,
} from '../../core/document/styling';
import { computeTextVerticalOffset, getSvgTextAnchorAndX, wrapTextLines } from '../../core/document/typography';
import { buildRoundedRectSvgPath, serializePathPointsToSvgD } from '../../core/document/vector';
import {
  computeContourTrimIntervals,
  getNodeContourLengths,
  getPathNodeContours,
  hasActiveTrimPath,
  intervalsToSvgStrokeDash,
} from '../../core/document/pathStudio';
import { resolveAssetDisplayUrl } from '../../core/persistence/assetStore';
import { evaluateComponentDocumentAtTime } from '../animation/evaluator';
import { computeAutoLayoutNodes } from '../layout/autoLayout';
import {
  buildFrameClipAncestorMap,
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerClipMaskBaseIds,
  getLayerDescendantIds,
  getLayerFrameClipAncestorIds,
  getLayerRenderOrder,
} from '../../core/document/layers';
import type { PrototypeNodeOverride } from '../prototype/runtime';
import {
  getAncestorGroupSvgTransforms,
  resolveNodeEffectiveSvgTransform,
} from './transformUtils';

export type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

const MAX_COMPONENT_RECURSION_DEPTH = 16;

export function sanitizeMaskIdSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildMaskElementId(scopePrefix: string, baseId: string): string {
  return `${scopePrefix}--${sanitizeMaskIdSegment(baseId)}`;
}

export function buildOutsideMaskElementId(scopePrefix: string, baseId: string): string {
  return `${scopePrefix}--outside--${sanitizeMaskIdSegment(baseId)}`;
}

export function buildFrameClipElementId(scopePrefix: string, frameId: string): string {
  return `${scopePrefix}--frameclip--${sanitizeMaskIdSegment(frameId)}`;
}

export function buildImageClipElementId(scopePrefix: string, imageId: string): string {
  return `${scopePrefix}--imgclip--${sanitizeMaskIdSegment(imageId)}`;
}

function getComponentById(
  components: readonly ComponentDefinition[],
  componentById?: ReadonlyMap<string, ComponentDefinition>,
): ReadonlyMap<string, ComponentDefinition> {
  if (componentById) return componentById;
  return new Map(components.map((component) => [component.id, component]));
}

function getAssetById(
  assets: readonly AssetReference[] | undefined,
  assetById?: ReadonlyMap<string, AssetReference>,
): ReadonlyMap<string, AssetReference> {
  if (assetById) return assetById;
  if (!assets || assets.length === 0) return new Map();
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function imageFitToPreserveAspectRatio(fit: ImageFitMode): string {
  if (fit === 'contain') return 'xMidYMid meet';
  if (fit === 'fill') return 'none';
  return 'xMidYMid slice';
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

function renderPathArrowheads(node: PathNode, mask: boolean, maskFill = '#fff') {
  if (node.closed || node.points.length < 2) return null;
  if (!node.style.arrowStart && !node.style.arrowEnd) return null;
  const color = mask ? maskFill : (node.style.stroke !== 'none' && node.style.stroke !== '#00000000' ? node.style.stroke : node.style.fill);
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

function resolveFillAttribute(
  paint: FillPaint,
  nodeId: string,
  paintIndex: number,
  maskPrefix: string,
): { fill: string; fillOpacity?: number } {
  const opacity = paint.opacity ?? 1;
  if (paint.type === 'solid') {
    return {
      fill: sanitizeStyleColor(paint.color),
      ...(opacity < 1 ? { fillOpacity: opacity } : {}),
    };
  }
  return {
    fill: `url(#${buildSvgPaintId(maskPrefix, nodeId, paintIndex)})`,
    ...(opacity < 1 ? { fillOpacity: opacity } : {}),
  };
}

function NodeStyleDefs({
  nodes,
  maskPrefix,
}: {
  nodes: readonly DesignNode[];
  maskPrefix: string;
}) {
  const defs: JSX.Element[] = [];

  for (const node of nodes) {
    if (node.type === 'frame' || node.type === 'rect' || node.type === 'ellipse' || node.type === 'path') {
      const fills = getVisibleFillPaints(node);
      fills.forEach((paint, index) => {
        if (paint.type === 'linear-gradient') {
          const coords = computeSvgLinearGradientCoords(paint.angle);
          const id = buildSvgPaintId(maskPrefix, node.id, index);
          defs.push(
            <linearGradient
              key={id}
              id={id}
              x1={coords.x1}
              y1={coords.y1}
              x2={coords.x2}
              y2={coords.y2}
            >
              {paint.stops.map((stop, stopIndex) => (
                <stop
                  key={`${id}-s-${stopIndex}`}
                  offset={`${Math.round(stop.offset * 1000) / 10}%`}
                  stop-color={sanitizeStyleColor(stop.color)}
                  stop-opacity={stop.opacity ?? 1}
                />
              ))}
            </linearGradient>,
          );
        } else if (paint.type === 'radial-gradient') {
          const id = buildSvgPaintId(maskPrefix, node.id, index);
          defs.push(
            <radialGradient
              key={id}
              id={id}
              cx={`${Math.round((paint.cx ?? 0.5) * 1000) / 10}%`}
              cy={`${Math.round((paint.cy ?? 0.5) * 1000) / 10}%`}
              r={`${Math.round((paint.r ?? 0.5) * 1000) / 10}%`}
            >
              {paint.stops.map((stop, stopIndex) => (
                <stop
                  key={`${id}-s-${stopIndex}`}
                  offset={`${Math.round(stop.offset * 1000) / 10}%`}
                  stop-color={sanitizeStyleColor(stop.color)}
                  stop-opacity={stop.opacity ?? 1}
                />
              ))}
            </radialGradient>,
          );
        }
      });
    }

    if (node.type === 'path' && node.style.strokeAlign === 'inside' && node.style.strokeWidth > 0 && node.style.stroke !== 'none') {
      const clipId = `${maskPrefix}--pathclip--${sanitizeMaskIdSegment(node.id)}`;
      const pathD = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
      defs.push(
        <clipPath key={clipId} id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={pathD} fill-rule={node.style.fillRule ?? 'nonzero'} />
        </clipPath>,
      );
    }

    if (
      node.type === 'image' &&
      ((node.style.radius ?? 0) > 0 ||
        Boolean(
          node.style.cornerRadii &&
            (node.style.cornerRadii.topLeft > 0 ||
              node.style.cornerRadii.topRight > 0 ||
              node.style.cornerRadii.bottomRight > 0 ||
              node.style.cornerRadii.bottomLeft > 0),
        ))
    ) {
      const clipId = buildImageClipElementId(maskPrefix, node.id);
      defs.push(
        <clipPath key={clipId} id={clipId} clipPathUnits="userSpaceOnUse">
          {node.style.cornerRadii ? (
            <path d={buildRoundedRectSvgPath(node.x, node.y, node.width, node.height, node.style.cornerRadii)} />
          ) : (
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={node.style.radius ?? 0}
            />
          )}
        </clipPath>,
      );
    }

    if (hasSvgFilterEffects(node)) {
      const filterId = buildSvgFilterId(maskPrefix, node.id);
      const region = computeSvgFilterRegion(node);
      const effects = getVisibleEffects(node);
      const primitives: JSX.Element[] = [];
      let currentSource = 'SourceGraphic';

      effects.forEach((effect, idx) => {
        if (effect.type === 'drop-shadow') {
          const out = `ds_${idx}`;
          const spread = effect.spread ?? 0;
          if (Math.abs(spread) > 0.01) {
            const morphOut = `ds_morph_${idx}`;
            const blurOut = `ds_blur_${idx}`;
            const offOut = `ds_off_${idx}`;
            const floodOut = `ds_flood_${idx}`;
            const compOut = `ds_comp_${idx}`;
            primitives.push(
              <feMorphology
                key={morphOut}
                in="SourceAlpha"
                operator={spread > 0 ? 'dilate' : 'erode'}
                radius={Math.abs(spread)}
                result={morphOut}
              />,
              <feGaussianBlur
                key={blurOut}
                in={morphOut}
                stdDeviation={Math.max(0, effect.blur / 2)}
                result={blurOut}
              />,
              <feOffset
                key={offOut}
                in={blurOut}
                dx={effect.x}
                dy={effect.y}
                result={offOut}
              />,
              <feFlood
                key={floodOut}
                flood-color={sanitizeStyleColor(effect.color)}
                result={floodOut}
              />,
              <feComposite
                key={compOut}
                in={floodOut}
                in2={offOut}
                operator="in"
                result={compOut}
              />,
              <feMerge key={out} result={out}>
                <feMergeNode in={compOut} />
                <feMergeNode in={currentSource} />
              </feMerge>,
            );
          } else {
            primitives.push(
              <feDropShadow
                key={out}
                in={currentSource}
                dx={effect.x}
                dy={effect.y}
                stdDeviation={Math.max(0, effect.blur / 2)}
                flood-color={sanitizeStyleColor(effect.color)}
                result={out}
              />,
            );
          }
          currentSource = out;
        } else if (effect.type === 'layer-blur') {
          const out = `lb_${idx}`;
          primitives.push(
            <feGaussianBlur
              key={out}
              in={currentSource}
              stdDeviation={Math.max(0, effect.radius / 2)}
              result={out}
            />,
          );
          currentSource = out;
        } else if (effect.type === 'inner-shadow') {
          const blurOut = `is_blur_${idx}`;
          const offsetOut = `is_off_${idx}`;
          const compOut = `is_comp_${idx}`;
          const floodOut = `is_flood_${idx}`;
          const colorOut = `is_col_${idx}`;
          const out = `is_out_${idx}`;
          primitives.push(
            <feGaussianBlur key={blurOut} in="SourceAlpha" stdDeviation={Math.max(0, effect.blur / 2)} result={blurOut} />,
            <feOffset key={offsetOut} in={blurOut} dx={effect.x} dy={effect.y} result={offsetOut} />,
            <feComposite key={compOut} in="SourceAlpha" in2={offsetOut} operator="arithmetic" k2="-1" k3="1" result={compOut} />,
            <feFlood key={floodOut} flood-color={sanitizeStyleColor(effect.color)} result={floodOut} />,
            <feComposite key={colorOut} in={floodOut} in2={compOut} operator="in" result={colorOut} />,
            <feComposite key={out} in={colorOut} in2={currentSource} operator="over" result={out} />,
          );
          currentSource = out;
        }
      });

      if (primitives.length > 0) {
        defs.push(
          <filter
            key={filterId}
            id={filterId}
            filterUnits="userSpaceOnUse"
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            color-interpolation-filters="sRGB"
          >
            {primitives}
          </filter>,
        );
      }
    }
  }

  return defs.length > 0 ? <>{defs}</> : null;
}

function renderBackdropBlurOverlay(
  node: PrimitiveNode,
  mask: boolean,
  radius: number,
  isEllipse = false,
  cornerRadii?: CornerRadiiConfig,
) {
  if (mask) return null;
  const blurRadius = getBackdropBlurRadius(node);
  if (blurRadius <= 0 || node.width <= 0 || node.height <= 0) return null;
  const borderRadius = isEllipse
    ? '50%'
    : cornerRadii
      ? `${cornerRadii.topLeft}px ${cornerRadii.topRight}px ${cornerRadii.bottomRight}px ${cornerRadii.bottomLeft}px`
      : `${radius}px`;
  return (
    <foreignObject
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      style={{ pointerEvents: 'none', overflow: 'visible' }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius,
          backdropFilter: `blur(${blurRadius}px)`,
          WebkitBackdropFilter: `blur(${blurRadius}px)`,
          background: 'transparent',
          pointerEvents: 'none',
        }}
      />
    </foreignObject>
  );
}

function renderPerSideBorders(
  node: { id: string; x: number; y: number; width: number; height: number },
  borderSides: BorderSidesConfig | undefined,
  mask: boolean,
): JSX.Element | null {
  if (mask || !borderSides) return null;
  const lines: JSX.Element[] = [];
  const dashFor = (style?: 'solid' | 'dashed' | 'dotted'): string | undefined =>
    style === 'dashed' ? '6 4' : style === 'dotted' ? '2 3' : undefined;
  const { x, y, width: w, height: h } = node;
  if (borderSides.top && borderSides.top.width > 0 && borderSides.top.color !== 'none') {
    const bw = borderSides.top.width;
    lines.push(<line key={`${node.id}-bt`} x1={x} y1={y + bw / 2} x2={x + w} y2={y + bw / 2} stroke={borderSides.top.color} stroke-width={bw} stroke-dasharray={dashFor(borderSides.top.style)} />);
  }
  if (borderSides.right && borderSides.right.width > 0 && borderSides.right.color !== 'none') {
    const bw = borderSides.right.width;
    lines.push(<line key={`${node.id}-br`} x1={x + w - bw / 2} y1={y} x2={x + w - bw / 2} y2={y + h} stroke={borderSides.right.color} stroke-width={bw} stroke-dasharray={dashFor(borderSides.right.style)} />);
  }
  if (borderSides.bottom && borderSides.bottom.width > 0 && borderSides.bottom.color !== 'none') {
    const bw = borderSides.bottom.width;
    lines.push(<line key={`${node.id}-bb`} x1={x} y1={y + h - bw / 2} x2={x + w} y2={y + h - bw / 2} stroke={borderSides.bottom.color} stroke-width={bw} stroke-dasharray={dashFor(borderSides.bottom.style)} />);
  }
  if (borderSides.left && borderSides.left.width > 0 && borderSides.left.color !== 'none') {
    const bw = borderSides.left.width;
    lines.push(<line key={`${node.id}-bl`} x1={x + bw / 2} y1={y} x2={x + bw / 2} y2={y + h} stroke={borderSides.left.color} stroke-width={bw} stroke-dasharray={dashFor(borderSides.left.style)} />);
  }
  return lines.length > 0 ? <g pointer-events="none">{lines}</g> : null;
}

function resolveSingleContourTrimStroke(
  node: PrimitiveNode,
  mask: boolean,
  hasStroke: boolean,
  fallbackDash: string | undefined,
): {
  active: boolean;
  visible: boolean;
  dasharray: string | undefined;
  dashoffset: number | undefined;
} {
  if (
    mask ||
    !hasStroke ||
    (node.type !== 'rect' && node.type !== 'frame' && node.type !== 'ellipse' && node.type !== 'path') ||
    !hasActiveTrimPath(node.style)
  ) {
    return { active: false, visible: true, dasharray: fallbackDash, dashoffset: undefined };
  }
  const lengths = getNodeContourLengths(node);
  const len = lengths[0] ?? 0;
  const intervals = computeContourTrimIntervals(
    [len],
    node.style.trimStart ?? 0,
    node.style.trimEnd ?? 100,
    node.style.trimOffset ?? 0,
    node.style.trimMode ?? 'simultaneous',
  )[0] ?? [];
  const dash = intervalsToSvgStrokeDash(len, intervals);
  if (!dash.visible) {
    return { active: true, visible: false, dasharray: dash.dasharray, dashoffset: dash.dashoffset };
  }
  if (dash.full) {
    return { active: true, visible: true, dasharray: fallbackDash, dashoffset: undefined };
  }
  return { active: true, visible: true, dasharray: dash.dasharray, dashoffset: dash.dashoffset };
}

export function NodeShape({
  node,
  mask = false,
  maskFill = '#fff',
  maskPrefix = 'folio',
  assetById,
  nodeOverrides,
  overrideIdPrefix = '',
}: {
  node: PrimitiveNode;
  mask?: boolean;
  maskFill?: string;
  maskPrefix?: string;
  assetById?: ReadonlyMap<string, AssetReference>;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
  overrideIdPrefix?: string;
}) {
  const { svgTransform: transform } = resolveNodeEffectiveSvgTransform(
    node,
    nodeOverrides,
    overrideIdPrefix,
  );
  const scopedMaskBaseId = mask
    ? (overrideIdPrefix ? `${overrideIdPrefix}${node.id}` : node.id)
    : undefined;
  const filterAttr = !mask && hasSvgFilterEffects(node)
    ? `url(#${buildSvgFilterId(maskPrefix, node.id)})`
    : undefined;
  const cssFilterStr = !mask ? buildCssFilterString(node.cssFilters) : '';
  const hasBlend = !mask && node.blendMode && node.blendMode !== 'normal';
  const combinedCssFilter = filterAttr && cssFilterStr
    ? `${filterAttr} ${cssFilterStr}`
    : cssFilterStr || undefined;
  const groupStyle: JSX.CSSProperties | undefined =
    hasBlend || combinedCssFilter
      ? {
          ...(hasBlend ? { mixBlendMode: node.blendMode } : {}),
          ...(combinedCssFilter ? { filter: combinedCssFilter } : {}),
        }
      : undefined;

  return (
    <g
      data-mask-base-id={scopedMaskBaseId}
      transform={transform}
      opacity={node.opacity}
      filter={combinedCssFilter ? undefined : filterAttr}
      style={groupStyle}
      class="canvas-node"
    >
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
      {node.type === 'frame' && (() => {
        const fills = getVisibleFillPaints(node);
        const rx = node.style.radius ?? 0;
        const cornerRadii = node.style.cornerRadii;
        const baseDash = !mask
          ? (node.style.strokeDasharray || (node.isSection ? '6 4' : undefined))
          : undefined;
        const sw = node.style.strokeWidth;
        const strokeAlign = node.style.strokeAlign ?? 'center';
        const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
        const trimStroke = resolveSingleContourTrimStroke(node, mask, hasStroke, baseDash);
        const dash = trimStroke.dasharray;
        const dashOffset = trimStroke.dashoffset;
        const strokeDelta = strokeAlign === 'inside' ? sw * 0.5 : strokeAlign === 'outside' ? -sw * 0.5 : 0;
        const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center' || trimStroke.active);
        const renderBox = (
          key: string | undefined,
          x: number,
          y: number,
          w: number,
          h: number,
          r: number,
          cr: CornerRadiiConfig | undefined,
          props: Record<string, unknown>,
        ) =>
          cr ? (
            <path key={key} d={buildRoundedRectSvgPath(x, y, w, h, cr)} {...props} />
          ) : (
            <rect key={key} x={x} y={y} width={w} height={h} rx={r} {...props} />
          );
        const strokeRadii: CornerRadiiConfig | undefined = cornerRadii
          ? {
              topLeft: cornerRadii.topLeft > 0 ? Math.max(0, cornerRadii.topLeft - strokeDelta) : 0,
              topRight: cornerRadii.topRight > 0 ? Math.max(0, cornerRadii.topRight - strokeDelta) : 0,
              bottomRight: cornerRadii.bottomRight > 0 ? Math.max(0, cornerRadii.bottomRight - strokeDelta) : 0,
              bottomLeft: cornerRadii.bottomLeft > 0 ? Math.max(0, cornerRadii.bottomLeft - strokeDelta) : 0,
            }
          : undefined;
        return (
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
                {node.semanticTag ? ` · <${node.semanticTag}>` : ''}
                {node.layout && node.layout.mode !== 'none'
                  ? ` · ${
                      node.layout.mode === 'grid'
                        ? `grid(${node.layout.gridColumnsMode === 'auto-fit' ? 'auto-fit' : node.layout.gridColumnsMode === 'custom' ? 'custom' : (node.layout.gridColumns ?? 2)})`
                        : `flex-${node.layout.direction === 'column' || node.layout.direction === 'column-reverse' ? 'col' : 'row'}`
                    }`
                  : ''}
              </text>
            )}
            {renderBackdropBlurOverlay(node, mask, rx, false, cornerRadii)}
            {mask || (fills.length <= 1 && !needsSeparateStroke) ? (
              renderBox(undefined, node.x, node.y, node.width, node.height, rx, cornerRadii, {
                fill: mask
                  ? (node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill)
                  : fills.length === 1
                    ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fill
                    : 'none',
                'fill-opacity': !mask && fills.length === 1 ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fillOpacity : undefined,
                stroke: node.style.borderSides && !mask ? 'none' : (mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke),
                'stroke-width': node.style.borderSides && !mask ? 0 : sw,
                'stroke-dasharray': dash,
                'stroke-dashoffset': dashOffset,
              })
            ) : (
              <>
                {fills.map((paint, index) => {
                  const resolved = resolveFillAttribute(paint, node.id, index, maskPrefix);
                  return renderBox(`${node.id}-fill-${index}`, node.x, node.y, node.width, node.height, rx, cornerRadii, {
                    fill: resolved.fill,
                    'fill-opacity': resolved.fillOpacity,
                    stroke: 'none',
                  });
                })}
                {hasStroke && !node.style.borderSides && trimStroke.visible &&
                  renderBox(
                    undefined,
                    node.x + strokeDelta,
                    node.y + strokeDelta,
                    Math.max(0, node.width - strokeDelta * 2),
                    Math.max(0, node.height - strokeDelta * 2),
                    rx > 0 ? Math.max(0, rx - strokeDelta) : 0,
                    strokeRadii,
                    {
                      fill: 'none',
                      stroke: node.style.stroke,
                      'stroke-width': sw,
                      'stroke-dasharray': dash,
                      'stroke-dashoffset': dashOffset,
                      'stroke-linecap': trimStroke.active ? 'round' : undefined,
                    },
                  )}
              </>
            )}
            {renderPerSideBorders(node, node.style.borderSides, mask)}
          </g>
        );
      })()}
      {node.type === 'rect' && (() => {
        const fills = getVisibleFillPaints(node);
        const rx = node.style.radius ?? 0;
        const cornerRadii = node.style.cornerRadii;
        const baseDash = !mask ? (node.style.strokeDasharray || undefined) : undefined;
        const sw = node.style.strokeWidth;
        const strokeAlign = node.style.strokeAlign ?? 'center';
        const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
        const trimStroke = resolveSingleContourTrimStroke(node, mask, hasStroke, baseDash);
        const dash = trimStroke.dasharray;
        const dashOffset = trimStroke.dashoffset;
        const strokeDelta = strokeAlign === 'inside' ? sw * 0.5 : strokeAlign === 'outside' ? -sw * 0.5 : 0;
        const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center' || trimStroke.active);
        const renderBox = (
          key: string | undefined,
          x: number,
          y: number,
          w: number,
          h: number,
          r: number,
          cr: CornerRadiiConfig | undefined,
          props: Record<string, unknown>,
        ) =>
          cr ? (
            <path key={key} d={buildRoundedRectSvgPath(x, y, w, h, cr)} {...props} />
          ) : (
            <rect key={key} x={x} y={y} width={w} height={h} rx={r} {...props} />
          );
        const strokeRadii: CornerRadiiConfig | undefined = cornerRadii
          ? {
              topLeft: cornerRadii.topLeft > 0 ? Math.max(0, cornerRadii.topLeft - strokeDelta) : 0,
              topRight: cornerRadii.topRight > 0 ? Math.max(0, cornerRadii.topRight - strokeDelta) : 0,
              bottomRight: cornerRadii.bottomRight > 0 ? Math.max(0, cornerRadii.bottomRight - strokeDelta) : 0,
              bottomLeft: cornerRadii.bottomLeft > 0 ? Math.max(0, cornerRadii.bottomLeft - strokeDelta) : 0,
            }
          : undefined;
        return (
          <>
            {renderBackdropBlurOverlay(node, mask, rx, false, cornerRadii)}
            {mask || (fills.length <= 1 && !needsSeparateStroke) ? (
              renderBox(undefined, node.x, node.y, node.width, node.height, rx, cornerRadii, {
                fill: mask
                  ? (node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill)
                  : fills.length === 1
                    ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fill
                    : 'none',
                'fill-opacity': !mask && fills.length === 1 ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fillOpacity : undefined,
                stroke: node.style.borderSides && !mask ? 'none' : (mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke),
                'stroke-width': node.style.borderSides && !mask ? 0 : sw,
                'stroke-dasharray': dash,
                'stroke-dashoffset': dashOffset,
              })
            ) : (
              <>
                {fills.map((paint, index) => {
                  const resolved = resolveFillAttribute(paint, node.id, index, maskPrefix);
                  return renderBox(`${node.id}-fill-${index}`, node.x, node.y, node.width, node.height, rx, cornerRadii, {
                    fill: resolved.fill,
                    'fill-opacity': resolved.fillOpacity,
                    stroke: 'none',
                  });
                })}
                {hasStroke && !node.style.borderSides && trimStroke.visible &&
                  renderBox(
                    undefined,
                    node.x + strokeDelta,
                    node.y + strokeDelta,
                    Math.max(0, node.width - strokeDelta * 2),
                    Math.max(0, node.height - strokeDelta * 2),
                    rx > 0 ? Math.max(0, rx - strokeDelta) : 0,
                    strokeRadii,
                    {
                      fill: 'none',
                      stroke: node.style.stroke,
                      'stroke-width': sw,
                      'stroke-dasharray': dash,
                      'stroke-dashoffset': dashOffset,
                      'stroke-linecap': trimStroke.active ? 'round' : undefined,
                    },
                  )}
              </>
            )}
            {renderPerSideBorders(node, node.style.borderSides, mask)}
          </>
        );
      })()}
      {node.type === 'ellipse' && (() => {
        const fills = getVisibleFillPaints(node);
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const baseDash = !mask ? (node.style.strokeDasharray || undefined) : undefined;
        const sw = node.style.strokeWidth;
        const strokeAlign = node.style.strokeAlign ?? 'center';
        const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
        const trimStroke = resolveSingleContourTrimStroke(node, mask, hasStroke, baseDash);
        const dash = trimStroke.dasharray;
        const dashOffset = trimStroke.dashoffset;
        const strokeDelta = strokeAlign === 'inside' ? sw * 0.5 : strokeAlign === 'outside' ? -sw * 0.5 : 0;
        const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center' || trimStroke.active);
        return (
          <>
            {renderBackdropBlurOverlay(node, mask, 0, true)}
            {mask || (fills.length <= 1 && !needsSeparateStroke) ? (
              <ellipse
                cx={cx}
                cy={cy}
                rx={node.width / 2}
                ry={node.height / 2}
                fill={
                  mask
                    ? (node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill)
                    : fills.length === 1
                      ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fill
                      : 'none'
                }
                fill-opacity={!mask && fills.length === 1 ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fillOpacity : undefined}
                stroke={mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke}
                stroke-width={sw}
                stroke-dasharray={dash}
                stroke-dashoffset={dashOffset}
              />
            ) : (
              <>
                {fills.map((paint, index) => {
                  const resolved = resolveFillAttribute(paint, node.id, index, maskPrefix);
                  return (
                    <ellipse
                      key={`${node.id}-fill-${index}`}
                      cx={cx}
                      cy={cy}
                      rx={node.width / 2}
                      ry={node.height / 2}
                      fill={resolved.fill}
                      fill-opacity={resolved.fillOpacity}
                      stroke="none"
                    />
                  );
                })}
                {hasStroke && trimStroke.visible && (
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={Math.max(0, node.width / 2 - strokeDelta)}
                    ry={Math.max(0, node.height / 2 - strokeDelta)}
                    fill="none"
                    stroke={node.style.stroke}
                    stroke-width={sw}
                    stroke-dasharray={dash}
                    stroke-dashoffset={dashOffset}
                    stroke-linecap={trimStroke.active ? 'round' : undefined}
                  />
                )}
              </>
            )}
          </>
        );
      })()}
      {node.type === 'path' && (() => {
        const pathD = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
        const fills = getVisibleFillPaints(node);
        const sw = node.style.strokeWidth;
        const strokeAlign = node.style.strokeAlign ?? 'center';
        const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
        const isTrimActive = !mask && hasStroke && hasActiveTrimPath(node.style);
        const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center' || isTrimActive);
        const insideClipAttr = strokeAlign === 'inside'
          ? `url(#${maskPrefix}--pathclip--${sanitizeMaskIdSegment(node.id)})`
          : undefined;
        const strokeEl = hasStroke
          ? isTrimActive
            ? (() => {
                const contours = getPathNodeContours(node);
                const lengths = getNodeContourLengths(node);
                const perContour = computeContourTrimIntervals(
                  lengths,
                  node.style.trimStart ?? 0,
                  node.style.trimEnd ?? 100,
                  node.style.trimOffset ?? 0,
                  node.style.trimMode ?? 'simultaneous',
                );
                return (
                  <g clip-path={insideClipAttr}>
                    {contours.map((contour, cIdx) => {
                      const dash = intervalsToSvgStrokeDash(lengths[cIdx] ?? 0, perContour[cIdx] ?? []);
                      if (!dash.visible) return null;
                      const contourD = serializePathPointsToSvgD(contour.points, contour.closed);
                      return (
                        <path
                          key={`${node.id}-trim-c-${cIdx}`}
                          d={contourD}
                          fill="none"
                          stroke={node.style.stroke}
                          stroke-width={strokeAlign === 'center' ? sw : sw * 2}
                          stroke-linecap={node.style.strokeLinecap ?? 'round'}
                          stroke-linejoin={node.style.strokeLinejoin ?? 'round'}
                          stroke-dasharray={dash.full ? (node.style.strokeDasharray || undefined) : dash.dasharray}
                          stroke-dashoffset={dash.full ? undefined : dash.dashoffset}
                        />
                      );
                    })}
                  </g>
                );
              })()
            : (
              <path
                d={pathD}
                fill="none"
                stroke={node.style.stroke}
                stroke-width={strokeAlign === 'center' ? sw : sw * 2}
                stroke-linecap={node.style.strokeLinecap ?? 'round'}
                stroke-linejoin={node.style.strokeLinejoin ?? 'round'}
                stroke-dasharray={node.style.strokeDasharray || undefined}
                clip-path={insideClipAttr}
              />
            )
          : null;
        return (
          <g transform={`translate(${node.x} ${node.y})`}>
            {!mask && !node.closed && (
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                stroke-width={Math.max(12, sw + 8)}
                stroke-linecap="round"
                stroke-linejoin="round"
                pointer-events="stroke"
              />
            )}
            {mask || (fills.length <= 1 && !needsSeparateStroke) ? (
              <path
                d={pathD}
                fill={
                  mask
                    ? (node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill)
                    : fills.length === 1
                      ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fill
                      : 'none'
                }
                fill-opacity={!mask && fills.length === 1 ? resolveFillAttribute(fills[0], node.id, 0, maskPrefix).fillOpacity : undefined}
                fill-rule={node.style.fillRule ?? 'nonzero'}
                stroke={mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke}
                stroke-width={sw}
                stroke-linecap={node.style.strokeLinecap ?? 'round'}
                stroke-linejoin={node.style.strokeLinejoin ?? 'round'}
                stroke-dasharray={node.style.strokeDasharray || undefined}
              />
            ) : (
              <>
                {strokeAlign === 'outside' && strokeEl}
                {fills.map((paint, index) => {
                  const resolved = resolveFillAttribute(paint, node.id, index, maskPrefix);
                  return (
                    <path
                      key={`${node.id}-fill-${index}`}
                      d={pathD}
                      fill={resolved.fill}
                      fill-opacity={resolved.fillOpacity}
                      fill-rule={node.style.fillRule ?? 'nonzero'}
                      stroke="none"
                    />
                  );
                })}
                {strokeAlign !== 'outside' && strokeEl}
              </>
            )}
            {renderPathArrowheads(node, mask, maskFill)}
          </g>
        );
      })()}
      {node.type === 'text' && (() => {
        const lines = wrapTextLines(node.text, {
          maxWidth: node.width,
          fontSize: node.style.fontSize,
          fontFamily: node.style.fontFamily,
          fontWeight: node.style.fontWeight,
          letterSpacing: node.style.letterSpacing,
          textWrap: node.style.textWrap,
          textTransform: node.style.textTransform,
        });
        const isJustify = node.style.textAlign === 'justify';
        const { anchor, xPos } = getSvgTextAnchorAndX(node.x, node.width, isJustify ? 'left' : node.style.textAlign);
        const verticalOffset = computeTextVerticalOffset(
          node.height,
          lines.length,
          node.style.fontSize,
          node.style.lineHeight,
          node.style.verticalAlign,
        );
        const decoration = node.style.textDecoration && node.style.textDecoration !== 'none'
          ? node.style.textDecoration
          : undefined;
        return (
          <text
            x={xPos}
            y={node.y + verticalOffset}
            fill={mask ? maskFill : node.style.fill}
            font-size={node.style.fontSize}
            font-family={node.style.fontFamily}
            font-weight={node.style.fontWeight}
            letter-spacing={node.style.letterSpacing}
            text-anchor={anchor}
            text-decoration={decoration}
            dominant-baseline="hanging"
          >
            {lines.map((line, index) => {
              const shouldJustifyLine =
                isJustify &&
                index < lines.length - 1 &&
                line.trim().includes(' ') &&
                node.width > node.style.fontSize * 2;
              return (
                <tspan
                  key={`${node.id}-${index}`}
                  x={xPos}
                  dy={index === 0 ? 0 : node.style.fontSize * node.style.lineHeight}
                  textLength={shouldJustifyLine ? node.width : undefined}
                  lengthAdjust={shouldJustifyLine ? 'spacing' : undefined}
                >
                  {line || ' '}
                </tspan>
              );
            })}
          </text>
        );
      })()}
      {node.type === 'image' && (() => {
        const imgNode = node as ImageNode;
        const rx = imgNode.style.radius ?? 0;
        const cr = imgNode.style.cornerRadii;
        const hasRadius = rx > 0 || Boolean(cr && (cr.topLeft > 0 || cr.topRight > 0 || cr.bottomRight > 0 || cr.bottomLeft > 0));
        if (mask) {
          return cr ? (
            <path d={buildRoundedRectSvgPath(imgNode.x, imgNode.y, imgNode.width, imgNode.height, cr)} fill={maskFill} />
          ) : (
            <rect
              x={imgNode.x}
              y={imgNode.y}
              width={imgNode.width}
              height={imgNode.height}
              rx={rx}
              fill={maskFill}
            />
          );
        }
        const asset = assetById?.get(imgNode.assetId);
        const href = resolveAssetDisplayUrl(asset);
        const clipAttr = hasRadius ? `url(#${buildImageClipElementId(maskPrefix, imgNode.id)})` : undefined;
        const strokeColor = imgNode.style.stroke && imgNode.style.stroke !== 'none' ? imgNode.style.stroke : undefined;
        const strokeWidth = imgNode.style.strokeWidth ?? 0;
        return (
          <g>
            {href ? (
              <image
                href={href}
                x={imgNode.x}
                y={imgNode.y}
                width={imgNode.width}
                height={imgNode.height}
                preserveAspectRatio={imageFitToPreserveAspectRatio(imgNode.style.fit)}
                clip-path={clipAttr}
              />
            ) : (
              <g>
                {cr ? (
                  <path
                    d={buildRoundedRectSvgPath(imgNode.x, imgNode.y, imgNode.width, imgNode.height, cr)}
                    fill="#1E2534"
                    stroke="#4B5A78"
                    stroke-width="1.5"
                    stroke-dasharray="6 4"
                  />
                ) : (
                  <rect
                    x={imgNode.x}
                    y={imgNode.y}
                    width={imgNode.width}
                    height={imgNode.height}
                    rx={rx}
                    fill="#1E2534"
                    stroke="#4B5A78"
                    stroke-width="1.5"
                    stroke-dasharray="6 4"
                  />
                )}
                <text
                  x={imgNode.x + imgNode.width / 2}
                  y={imgNode.y + imgNode.height / 2}
                  fill="#94A3B8"
                  font-size="12"
                  font-family="Inter, system-ui, sans-serif"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >
                  {imgNode.alt || imgNode.name || 'Image'}
                </text>
              </g>
            )}
            {strokeColor && strokeWidth > 0 && (
              cr ? (
                <path
                  d={buildRoundedRectSvgPath(imgNode.x, imgNode.y, imgNode.width, imgNode.height, cr)}
                  fill="none"
                  stroke={strokeColor}
                  stroke-width={strokeWidth}
                  pointer-events="none"
                />
              ) : (
                <rect
                  x={imgNode.x}
                  y={imgNode.y}
                  width={imgNode.width}
                  height={imgNode.height}
                  rx={rx}
                  fill="none"
                  stroke={strokeColor}
                  stroke-width={strokeWidth}
                  pointer-events="none"
                />
              )
            )}
          </g>
        );
      })()}
    </g>
  );
}

/** Paint a base layer's alpha silhouette into an SVG mask. Group bases use their descendants. */
export function ClipMaskArtwork({
  node,
  nodes,
  components,
  maskPrefix,
  maskFill = '#fff',
  nodeById,
  componentById,
  assetById,
  tokens,
  visitedComponentIds,
  depth = 0,
  animationTimeMs,
  nodeOverrides,
  overrideIdPrefix = '',
}: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
  maskPrefix: string;
  maskFill?: string;
  nodeById?: ReadonlyMap<string, DesignNode>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
  assetById?: ReadonlyMap<string, AssetReference>;
  tokens?: DesignTokenCollection;
  visitedComponentIds?: ReadonlySet<string>;
  depth?: number;
  animationTimeMs?: number;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
  overrideIdPrefix?: string;
}) {
  const scopedMaskBaseId = overrideIdPrefix ? `${overrideIdPrefix}${node.id}` : node.id;

  if (node.type === 'group') {
    const resolvedNodeById = nodeById ?? new Map(nodes.map((item) => [item.id, item]));
    const states = getEffectiveLayerStates(nodes);
    const { svgTransform: groupTransform } = resolveNodeEffectiveSvgTransform(
      node,
      nodeOverrides,
      overrideIdPrefix,
    );
    const visibleLeafDescendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => resolvedNodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (visibleLeafDescendants.length === 0) {
      return (
        <rect
          data-mask-base-id={scopedMaskBaseId}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={maskFill}
          opacity={node.opacity}
          transform={groupTransform}
        />
      );
    }
    const visibleLeafSet = new Set(visibleLeafDescendants.map((item) => item.id));
    const directChildren = nodes.filter((item) => {
      if (item.parentId !== node.id || !states.get(item.id)?.visible) return false;
      if (item.type !== 'group') return true;
      for (const descId of getLayerDescendantIds(nodes, item.id)) {
        if (visibleLeafSet.has(descId)) return true;
      }
      return false;
    });
    return (
      <g data-mask-base-id={scopedMaskBaseId} transform={groupTransform}>
        {directChildren.map((child) => (
          <ClipMaskArtwork
            key={child.id}
            node={child}
            nodes={nodes}
            components={components}
            maskPrefix={maskPrefix}
            maskFill={maskFill}
            nodeById={resolvedNodeById}
            componentById={componentById}
            assetById={assetById}
            tokens={tokens}
            visitedComponentIds={visitedComponentIds}
            depth={depth}
            animationTimeMs={animationTimeMs}
            nodeOverrides={nodeOverrides}
            overrideIdPrefix={overrideIdPrefix}
          />
        ))}
      </g>
    );
  }

  if (node.type === 'component-instance') {
    const resolvedComponents = getComponentById(components, componentById);
    const component = resolvedComponents.get(node.componentId);
    const visited = visitedComponentIds ?? new Set<string>();
    const { svgTransform: transform } = resolveNodeEffectiveSvgTransform(
      node,
      nodeOverrides,
      overrideIdPrefix,
    );
    if (!component || visited.has(node.componentId) || depth >= MAX_COMPONENT_RECURSION_DEPTH) {
      return (
        <rect
          data-mask-base-id={scopedMaskBaseId}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={maskFill}
          opacity={node.opacity}
          transform={transform}
        />
      );
    }
    const nextVisited = new Set(visited);
    nextVisited.add(node.componentId);
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const resolvedBase = resolveComponentInstanceNodes(node, component, tokens);
    const animatedDoc = animationTimeMs !== undefined && component.animations && component.animations.length > 0
      ? evaluateComponentDocumentAtTime({ ...component.document, nodes: resolvedBase }, component.animations, animationTimeMs)
      : null;
    const resolvedRaw = animatedDoc ? animatedDoc.nodes : resolvedBase;
    const resolved = resolvedRaw.some((child) => child.layout && child.layout.mode !== 'none')
      ? computeAutoLayoutNodes(resolvedRaw, { breakpoint: 'desktop', tokens, canvasWidth: component.document.width })
      : resolvedRaw;
    const visibleChildren = resolved.filter((child) => child.onCanvas !== false);
    const childNodeById = new Map(visibleChildren.map((child) => [child.id, child]));
    const childClipMaskMap = buildLayerClipMaskMap(visibleChildren, childNodeById);
    const childFrameClipMap = buildFrameClipAncestorMap(visibleChildren, childNodeById);
    const states = getEffectiveLayerStates(visibleChildren);
    const instanceMaskPrefix = `${maskPrefix}-instmask-${sanitizeMaskIdSegment(node.id)}`;
    const childOverridePrefix = `${scopedMaskBaseId}__`;
    return (
      <g data-mask-base-id={scopedMaskBaseId} transform={transform} opacity={node.opacity}>
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
              frameClipMap={childFrameClipMap}
              componentById={resolvedComponents}
              assetById={assetById}
              tokens={tokens}
              visitedComponentIds={nextVisited}
              depth={depth + 1}
              animationTimeMs={animationTimeMs}
              nodeOverrides={nodeOverrides}
              overrideIdPrefix={childOverridePrefix}
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
              const frameIds = childFrameClipMap.get(child.id) ?? [];
              const childAncestorTransforms = getAncestorGroupSvgTransforms(
                child,
                childNodeById,
                nodeOverrides,
                childOverridePrefix,
              );
              const rawShape = child.type === 'component-instance'
                ? (
                  <ClipMaskArtwork
                    key={child.id}
                    node={child}
                    nodes={visibleChildren}
                    components={components}
                    maskPrefix={instanceMaskPrefix}
                    maskFill={maskFill}
                    nodeById={childNodeById}
                    componentById={resolvedComponents}
                    assetById={assetById}
                    tokens={tokens}
                    visitedComponentIds={nextVisited}
                    depth={depth + 1}
                    animationTimeMs={animationTimeMs}
                    nodeOverrides={nodeOverrides}
                    overrideIdPrefix={childOverridePrefix}
                  />
                )
                : (
                  <NodeShape
                    key={child.id}
                    node={child as PrimitiveNode}
                    mask
                    maskFill={maskFill}
                    maskPrefix={instanceMaskPrefix}
                    assetById={assetById}
                    nodeOverrides={nodeOverrides}
                    overrideIdPrefix={childOverridePrefix}
                  />
                );
              const shape = childAncestorTransforms.reduceRight(
                (artwork, groupTransform) => <g transform={groupTransform}>{artwork}</g>,
                rawShape,
              );
              const clipped = frameIds.reduceRight(
                (artwork, frameId) => <g clip-path={`url(#${buildFrameClipElementId(instanceMaskPrefix, frameId)})`}>{artwork}</g>,
                shape,
              );
              return maskIds.reduceRight(
                (artwork, baseId) => <g mask={`url(#${buildMaskElementId(instanceMaskPrefix, baseId)})`}>{artwork}</g>,
                clipped,
              );
            })}
        </g>
      </g>
    );
  }

  return (
    <NodeShape
      node={node as PrimitiveNode}
      mask
      maskFill={maskFill}
      maskPrefix={maskPrefix}
      assetById={assetById}
      nodeOverrides={nodeOverrides}
      overrideIdPrefix={overrideIdPrefix}
    />
  );
}

export function DocumentMaskDefs({
  nodes,
  width,
  height,
  components,
  maskPrefix,
  nodeById,
  clipMaskMap,
  frameClipMap,
  componentById,
  assetById,
  tokens,
  visitedComponentIds,
  depth = 0,
  animationTimeMs,
  nodeOverrides,
  overrideIdPrefix = '',
}: {
  nodes: DesignNode[];
  width: number;
  height: number;
  components: ComponentDefinition[];
  maskPrefix: string;
  nodeById?: ReadonlyMap<string, DesignNode>;
  clipMaskMap?: ReadonlyMap<string, string[]>;
  frameClipMap?: ReadonlyMap<string, string[]>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
  assetById?: ReadonlyMap<string, AssetReference>;
  tokens?: DesignTokenCollection;
  visitedComponentIds?: ReadonlySet<string>;
  depth?: number;
  animationTimeMs?: number;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
  overrideIdPrefix?: string;
}) {
  const resolvedNodeById = nodeById ?? new Map(nodes.map((node) => [node.id, node]));
  const resolvedClipMaskMap = clipMaskMap ?? buildLayerClipMaskMap(nodes, resolvedNodeById);
  const resolvedFrameClipMap = frameClipMap ?? buildFrameClipAncestorMap(nodes, resolvedNodeById);
  const referencedSet = new Set<string>();
  const referencedOutsideSet = new Set<string>();
  const referencedFrameSet = new Set<string>();
  for (const node of nodes) {
    const baseIds = resolvedClipMaskMap.get(node.id);
    if (baseIds) {
      for (const baseId of baseIds) referencedSet.add(baseId);
    }
    if (node.clipMaskBaseId && node.clipMaskMode === 'outside') {
      referencedOutsideSet.add(node.clipMaskBaseId);
    }
    const frameIds = resolvedFrameClipMap.get(node.id);
    if (frameIds) {
      for (const frameId of frameIds) referencedFrameSet.add(frameId);
    }
  }

  const resolvedComponents = getComponentById(components, componentById);
  const referencedBaseIds = [...referencedSet];
  const referencedOutsideBaseIds = [...referencedOutsideSet];
  const referencedFrameIds = [...referencedFrameSet];
  return (
    <>
      <NodeStyleDefs nodes={nodes} maskPrefix={maskPrefix} />
      {referencedBaseIds.map((baseId) => {
        const base = resolvedNodeById.get(baseId);
        if (!base) return null;
        const ancestorTransforms = getAncestorGroupSvgTransforms(
          base,
          resolvedNodeById,
          nodeOverrides,
          overrideIdPrefix,
        );
        const maskSilhouette = ancestorTransforms.reduceRight(
          (artwork, groupTransform) => <g transform={groupTransform}>{artwork}</g>,
          (
            <ClipMaskArtwork
              node={base}
              nodes={nodes}
              components={components}
              maskPrefix={maskPrefix}
              nodeById={resolvedNodeById}
              componentById={resolvedComponents}
              assetById={assetById}
              tokens={tokens}
              visitedComponentIds={visitedComponentIds}
              depth={depth}
              animationTimeMs={animationTimeMs}
              nodeOverrides={nodeOverrides}
              overrideIdPrefix={overrideIdPrefix}
            />
          ),
        );
        return (
          <mask
            key={`mask-${baseId}`}
            id={buildMaskElementId(maskPrefix, baseId)}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={width}
            height={height}
          >
            <rect x="0" y="0" width={width} height={height} fill="#000" />
            {maskSilhouette}
          </mask>
        );
      })}
      {referencedOutsideBaseIds.map((baseId) => {
        const base = resolvedNodeById.get(baseId);
        if (!base) return null;
        const ancestorTransforms = getAncestorGroupSvgTransforms(
          base,
          resolvedNodeById,
          nodeOverrides,
          overrideIdPrefix,
        );
        const maskSilhouette = ancestorTransforms.reduceRight(
          (artwork, groupTransform) => <g transform={groupTransform}>{artwork}</g>,
          (
            <ClipMaskArtwork
              node={base}
              nodes={nodes}
              components={components}
              maskPrefix={maskPrefix}
              maskFill="#000"
              nodeById={resolvedNodeById}
              componentById={resolvedComponents}
              assetById={assetById}
              tokens={tokens}
              visitedComponentIds={visitedComponentIds}
              depth={depth}
              animationTimeMs={animationTimeMs}
              nodeOverrides={nodeOverrides}
              overrideIdPrefix={overrideIdPrefix}
            />
          ),
        );
        return (
          <mask
            key={`mask-outside-${baseId}`}
            id={buildOutsideMaskElementId(maskPrefix, baseId)}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={width}
            height={height}
          >
            <rect x="0" y="0" width={width} height={height} fill="#fff" />
            {maskSilhouette}
          </mask>
        );
      })}
      {referencedFrameIds.map((frameId) => {
        const candidate = resolvedNodeById.get(frameId);
        if (!candidate || candidate.type !== 'frame') return null;
        const frame = candidate as FrameNode;
        const { svgTransform: transform } = resolveNodeEffectiveSvgTransform(
          frame,
          nodeOverrides,
          overrideIdPrefix,
        );
        const ancestorTransforms = getAncestorGroupSvgTransforms(
          frame,
          resolvedNodeById,
          nodeOverrides,
          overrideIdPrefix,
        );
        const combinedTransform =
          [...ancestorTransforms, ...(transform ? [transform] : [])].join(' ') || undefined;
        return (
          <clipPath
            key={`frameclip-${frameId}`}
            id={buildFrameClipElementId(maskPrefix, frameId)}
            clipPathUnits="userSpaceOnUse"
          >
            <rect
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              rx={frame.style.radius ?? 0}
              transform={combinedTransform}
            />
          </clipPath>
        );
      })}
    </>
  );
}

export function NodeArtwork({
  node,
  components = [],
  assets,
  maskPrefix,
  emitNodeId = true,
  componentById,
  assetById,
  tokens,
  visitedComponentIds,
  depth = 0,
  animationTimeMs,
  nodeOverrides,
  overrideIdPrefix = '',
}: {
  node: DesignNode;
  components?: ComponentDefinition[];
  assets?: readonly AssetReference[];
  maskPrefix: string;
  emitNodeId?: boolean;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
  assetById?: ReadonlyMap<string, AssetReference>;
  tokens?: DesignTokenCollection;
  visitedComponentIds?: ReadonlySet<string>;
  depth?: number;
  animationTimeMs?: number;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
  overrideIdPrefix?: string;
}) {
  const resolvedAssets = getAssetById(assets, assetById);

  if (node.type === 'component-instance') {
    const resolvedComponents = getComponentById(components, componentById);
    const component = resolvedComponents.get(node.componentId);
    const visited = visitedComponentIds ?? new Set<string>();
    const blockedByCycle = !component || visited.has(node.componentId) || depth >= MAX_COMPONENT_RECURSION_DEPTH;
    const scaleX = component ? node.width / Math.max(1, component.document.width) : 1;
    const scaleY = component ? node.height / Math.max(1, component.document.height) : 1;
    const { svgTransform: transform } = resolveNodeEffectiveSvgTransform(
      node,
      nodeOverrides,
      overrideIdPrefix,
    );
    const scopedInstanceId = overrideIdPrefix ? `${overrideIdPrefix}${node.id}` : node.id;
    const childOverridePrefix = `${scopedInstanceId}__`;
    const filterAttr = hasSvgFilterEffects(node)
      ? `url(#${buildSvgFilterId(maskPrefix, node.id)})`
      : undefined;
    const blendStyle = node.blendMode && node.blendMode !== 'normal'
      ? { mixBlendMode: node.blendMode }
      : undefined;
    const nextVisited = new Set(visited);
    nextVisited.add(node.componentId);
    const resolvedChildren = component && !blockedByCycle
      ? (() => {
          const resolvedBase = resolveComponentInstanceNodes(node, component, tokens);
          const animatedDoc = animationTimeMs !== undefined && component.animations && component.animations.length > 0
            ? evaluateComponentDocumentAtTime({ ...component.document, nodes: resolvedBase }, component.animations, animationTimeMs)
            : null;
          const resolvedRaw = animatedDoc ? animatedDoc.nodes : resolvedBase;
          const laidOut = resolvedRaw.some((child) => child.layout && child.layout.mode !== 'none')
            ? computeAutoLayoutNodes(resolvedRaw, { breakpoint: 'desktop', tokens, canvasWidth: component.document.width })
            : resolvedRaw;
          return laidOut.filter((child) => child.onCanvas !== false);
        })()
      : [];
    const childNodeById = new Map(resolvedChildren.map((child) => [child.id, child]));
    const childClipMaskMap = buildLayerClipMaskMap(resolvedChildren, childNodeById);
    const childFrameClipMap = buildFrameClipAncestorMap(resolvedChildren, childNodeById);
    const childStates = getEffectiveLayerStates(resolvedChildren);
    const instanceMaskPrefix = `${maskPrefix}-inst-${sanitizeMaskIdSegment(node.id)}`;
    return (
      <g
        data-node-id={emitNodeId ? node.id : undefined}
        data-animated-component={component?.animations?.length ? 'true' : undefined}
        transform={transform}
        opacity={node.opacity}
        filter={filterAttr}
        style={blendStyle}
        class="canvas-node component-instance-artwork"
      >
        {component && !blockedByCycle ? (
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
                frameClipMap={childFrameClipMap}
                componentById={resolvedComponents}
                assetById={resolvedAssets}
                tokens={tokens}
                visitedComponentIds={nextVisited}
                depth={depth + 1}
                animationTimeMs={animationTimeMs}
                nodeOverrides={nodeOverrides}
                overrideIdPrefix={childOverridePrefix}
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
                <MaskedNodeArtwork
                  key={effective.id}
                  node={effective}
                  nodes={resolvedChildren}
                  components={components}
                  assets={assets}
                  maskPrefix={instanceMaskPrefix}
                  emitNodeId={false}
                  nodeById={childNodeById}
                  clipMaskMap={childClipMaskMap}
                  frameClipMap={childFrameClipMap}
                  componentById={resolvedComponents}
                  assetById={resolvedAssets}
                  tokens={tokens}
                  visitedComponentIds={nextVisited}
                  depth={depth + 1}
                  animationTimeMs={animationTimeMs}
                  nodeOverrides={nodeOverrides}
                  overrideIdPrefix={childOverridePrefix}
                />
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

  return (
    <g data-node-id={emitNodeId ? node.id : undefined}>
      <NodeShape
        node={node as PrimitiveNode}
        maskPrefix={maskPrefix}
        assetById={resolvedAssets}
        nodeOverrides={nodeOverrides}
        overrideIdPrefix={overrideIdPrefix}
      />
    </g>
  );
}

export function MaskedNodeArtwork({
  node,
  nodes,
  components,
  assets,
  maskPrefix,
  emitNodeId = true,
  nodeById,
  clipMaskMap,
  frameClipMap,
  componentById,
  assetById,
  tokens,
  visitedComponentIds,
  depth = 0,
  animationTimeMs,
  nodeOverrides,
  overrideIdPrefix = '',
}: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
  assets?: readonly AssetReference[];
  maskPrefix: string;
  emitNodeId?: boolean;
  nodeById?: ReadonlyMap<string, DesignNode>;
  clipMaskMap?: ReadonlyMap<string, string[]>;
  frameClipMap?: ReadonlyMap<string, string[]>;
  componentById?: ReadonlyMap<string, ComponentDefinition>;
  assetById?: ReadonlyMap<string, AssetReference>;
  tokens?: DesignTokenCollection;
  visitedComponentIds?: ReadonlySet<string>;
  depth?: number;
  animationTimeMs?: number;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
  overrideIdPrefix?: string;
}) {
  const resolvedNodeById = nodeById ?? new Map(nodes.map((item) => [item.id, item]));
  const maskIds = clipMaskMap ? (clipMaskMap.get(node.id) ?? []) : getLayerClipMaskBaseIds(nodes, node.id, resolvedNodeById);
  const frameIds = frameClipMap ? (frameClipMap.get(node.id) ?? []) : getLayerFrameClipAncestorIds(nodes, node.id, resolvedNodeById);
  const ancestorGroupTransforms = getAncestorGroupSvgTransforms(
    node,
    resolvedNodeById,
    nodeOverrides,
    overrideIdPrefix,
  );
  const baseArtwork = (
    <NodeArtwork
      node={node}
      components={components}
      assets={assets}
      maskPrefix={maskPrefix}
      emitNodeId={emitNodeId}
      componentById={componentById}
      assetById={assetById}
      tokens={tokens}
      visitedComponentIds={visitedComponentIds}
      depth={depth}
      animationTimeMs={animationTimeMs}
      nodeOverrides={nodeOverrides}
      overrideIdPrefix={overrideIdPrefix}
    />
  );
  const groupTransformed = ancestorGroupTransforms.reduceRight(
    (artwork, groupTransform) => <g transform={groupTransform}>{artwork}</g>,
    baseArtwork,
  );
  const frameClipped = frameIds.reduceRight(
    (artwork, frameId) => <g clip-path={`url(#${buildFrameClipElementId(maskPrefix, frameId)})`}>{artwork}</g>,
    groupTransformed,
  );
  return maskIds.reduceRight(
    (artwork, maskId) => {
      const isOutside = maskId === node.clipMaskBaseId && node.clipMaskMode === 'outside';
      const urlId = isOutside
        ? buildOutsideMaskElementId(maskPrefix, maskId)
        : buildMaskElementId(maskPrefix, maskId);
      return <g mask={`url(#${urlId})`}>{artwork}</g>;
    },
    frameClipped,
  );
}

export function DocumentArtworkContent({
  document,
  components = [],
  assets = [],
  maskPrefix,
  tokens,
  nodeOverrides,
}: {
  document: FolioDocument;
  components?: ComponentDefinition[];
  assets?: readonly AssetReference[];
  maskPrefix: string;
  tokens?: DesignTokenCollection;
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>;
}) {
  const resolvedNodes = computeAutoLayoutNodes(document.nodes, {
    breakpoint: 'desktop',
    tokens,
    canvasWidth: document.width,
  });
  const canvasNodes = resolvedNodes.filter((node) => node.onCanvas !== false);
  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const clipMaskMap = buildLayerClipMaskMap(canvasNodes, nodeById);
  const frameClipMap = buildFrameClipAncestorMap(canvasNodes, nodeById);
  const layerStates = getEffectiveLayerStates(canvasNodes);
  const componentById = getComponentById(components);
  const assetById = getAssetById(assets);
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
          frameClipMap={frameClipMap}
          componentById={componentById}
          assetById={assetById}
          tokens={tokens}
          nodeOverrides={nodeOverrides}
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
            assets={assets}
            maskPrefix={maskPrefix}
            nodeById={nodeById}
            clipMaskMap={clipMaskMap}
            frameClipMap={frameClipMap}
            componentById={componentById}
            assetById={assetById}
            tokens={tokens}
            nodeOverrides={nodeOverrides}
          />
        ))}
    </>
  );
}

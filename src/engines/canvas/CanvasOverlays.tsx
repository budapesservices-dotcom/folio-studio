import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  PathNode,
} from '../../core/document/types';
import {
  buildRoundedRectSvgPath,
  nodeLocalPointToWorld,
  serializePathPointsToSvgD,
  type PlanarArrangement,
  type PlanarFace,
} from '../../core/document/vector';
import { MaskedNodeArtwork, NodeShape, type PrimitiveNode } from './artwork';
import {
  computeAutoLayoutHandles,
  type GapAxis,
  type PaddingEdge,
} from './autoLayoutHandles';
import { buildSmoothSvgTrailPath, planarFaceToSvgPath } from './canvasHelpers';
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
  hideBoundingRect = false,
  invZoom,
}: {
  bounds: Bounds;
  canResize: boolean;
  canRotate: boolean;
  isScaleTool: boolean;
  hideBoundingRect?: boolean;
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
      {!hideBoundingRect && (
        <rect
          class={'canvas-selection-outline' + (isScaleTool ? ' is-scale' : '')}
          x={left}
          y={top}
          width={Math.max(1, bounds.width)}
          height={Math.max(1, bounds.height)}
        />
      )}
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

/**
 * Renders thin #00E5FF shape-accurate contour paths following each selected node's
 * actual vector geometry (ellipse, rounded rect, rotated shape, Bezier/polygon/star path).
 */
export function ShapeContourOverlay({
  nodes,
  invZoom,
}: {
  nodes: readonly DesignNode[];
  invZoom: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <g class="canvas-shape-contours" pointer-events="none">
      {nodes.map((node) => {
        if (node.type === 'group') return null;
        const transform = node.rotation
          ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
          : undefined;
        const drawModeClass =
          node.drawMode === 'inside'
            ? ' is-draw-inside'
            : node.drawMode === 'outside'
              ? ' is-draw-outside'
              : '';
        return (
          <g key={`contour-${node.id}`} transform={transform} data-selection-contour={node.id}>
            {node.type === 'ellipse' && (
              <ellipse
                class={`canvas-selection-contour${drawModeClass}`}
                cx={node.x + node.width / 2}
                cy={node.y + node.height / 2}
                rx={node.width / 2}
                ry={node.height / 2}
              />
            )}
            {(node.type === 'rect' || node.type === 'frame' || node.type === 'image') && (
              node.style.cornerRadii ? (
                <path
                  class={`canvas-selection-contour${drawModeClass}`}
                  d={buildRoundedRectSvgPath(
                    node.x,
                    node.y,
                    Math.max(1, node.width),
                    Math.max(1, node.height),
                    node.style.cornerRadii,
                  )}
                />
              ) : (
                <rect
                  class={`canvas-selection-contour${drawModeClass}`}
                  x={node.x}
                  y={node.y}
                  width={Math.max(1, node.width)}
                  height={Math.max(1, node.height)}
                  rx={node.style.radius ?? 0}
                />
              )
            )}
            {node.type === 'path' && (
              <g transform={`translate(${node.x} ${node.y})`}>
                <path
                  class={`canvas-selection-contour${drawModeClass}`}
                  d={serializePathPointsToSvgD(node.points, node.closed, node.subpaths)}
                />
              </g>
            )}
            {(node.type === 'text' || node.type === 'component-instance') && (
              <rect
                class={`canvas-selection-contour${drawModeClass}`}
                x={node.x}
                y={node.y}
                width={Math.max(1, node.width)}
                height={Math.max(1, node.height)}
              />
            )}
            {(node.drawMode === 'inside' || node.drawMode === 'outside') && (
              <HudBadge
                x={node.x + node.width / 2}
                y={node.y - 16 * invZoom}
                text={node.drawMode === 'inside' ? 'DRAW INSIDE' : 'DRAW OUTSIDE'}
                variant="default"
                invZoom={invZoom}
              />
            )}
          </g>
        );
      })}
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
  variant?: 'default' | 'measure' | 'rotate' | 'spacing';
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
  readonly hex: string;
  readonly alpha: number;
  readonly isTransparent: boolean;
  readonly sourceName: string;
  readonly target: string;
}

export type HoveredAutoLayoutHandle =
  | { readonly kind: 'padding'; readonly edge: PaddingEdge }
  | { readonly kind: 'gap'; readonly axis: GapAxis; readonly index: number }
  | null;

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
  readonly shiftHeld?: boolean;
  readonly smartHandleNode: DesignNode | null;
  readonly autoLayoutHandleContainer?: DesignNode | null;
  readonly hoveredAutoLayoutHandle?: HoveredAutoLayoutHandle;
  readonly onHoverAutoLayoutHandle?: (handle: HoveredAutoLayoutHandle) => void;
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
  shiftHeld = false,
  smartHandleNode,
  autoLayoutHandleContainer = null,
  hoveredAutoLayoutHandle = null,
  onHoverAutoLayoutHandle,
  pivotPoint,
  spacingRedlines,
  pathSnapWorldPoint,
  hoverPoint,
  eyedropperLoupe,
  guides,
}: CanvasInteractiveOverlaysProps) {
  const isAutoLayoutDirectActive =
    toolOverlay?.kind === 'autolayout-reorder' ||
    (toolSession?.kind === 'smart-handle' &&
      (toolSession.handle.kind === 'autolayout-padding' || toolSession.handle.kind === 'autolayout-gap'));

  const autoLayoutHandles =
    autoLayoutHandleContainer &&
    (toolId === 'select' || toolId === 'direct-selection') &&
    (!toolSession || toolSession.kind === 'smart-handle')
      ? computeAutoLayoutHandles(autoLayoutHandleContainer, canvasNodes, invZoom)
      : null;

  return (
    <>
      {/* Dynamic overlay patterns (Shape Builder hatch, Auto-Layout spacing hatch, Eyedropper checkerboard) */}
      {(toolId === 'shape-builder' || toolId === 'eyedropper' || Boolean(autoLayoutHandles)) && (
        <defs>
          {autoLayoutHandles && (
            <pattern
              id={`${maskPrefix}-al-hatch`}
              width={8 * invZoom}
              height={8 * invZoom}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width={8 * invZoom} height={8 * invZoom} fill="rgba(244, 63, 94, 0.13)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={8 * invZoom}
                stroke="rgba(244, 63, 94, 0.42)"
                stroke-width={1.25 * invZoom}
              />
            </pattern>
          )}
          {toolId === 'shape-builder' && (
            <>
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
            </>
          )}
          {toolId === 'eyedropper' && (
            <pattern
              id={`${maskPrefix}-loupe-checker`}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <rect width="8" height="8" fill="#cbd5e1" />
              <rect width="4" height="4" fill="#64748b" />
              <rect x="4" y="4" width="4" height="4" fill="#64748b" />
            </pattern>
          )}
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
      {autoLayoutHandles && autoLayoutHandles.innerBounds.width > 0 && autoLayoutHandles.innerBounds.height > 0 && (
        <rect
          class="canvas-autolayout-padding-guide"
          x={autoLayoutHandles.innerBounds.x}
          y={autoLayoutHandles.innerBounds.y}
          width={autoLayoutHandles.innerBounds.width}
          height={autoLayoutHandles.innerBounds.height}
          fill="none"
          stroke="#38BDF8"
          stroke-opacity="0.45"
          stroke-width={1 * invZoom}
          stroke-dasharray={`${4 * invZoom} ${3 * invZoom}`}
          pointer-events="none"
        />
      )}

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
      {toolOverlay?.kind === 'freehand' && toolOverlay.points.length >= 1 && (
        <path
          class={'canvas-freehand-preview is-' + toolOverlay.mode}
          d={buildSmoothSvgTrailPath(toolOverlay.points)}
          stroke={toolOverlay.strokeColor}
          stroke-width={toolOverlay.strokeWidth}
          stroke-linecap={toolOverlay.strokeLinecap ?? 'round'}
          stroke-linejoin="round"
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

      {!isAutoLayoutDirectActive && selectedNodes.length > 0 && toolId !== 'shape-builder' && (
        <ShapeContourOverlay nodes={selectedNodes} invZoom={invZoom} />
      )}

      {!isAutoLayoutDirectActive && showSelectionBox && selectionBounds && (() => {
        const single = selectedNodes.length === 1 ? selectedNodes[0] : null;
        const usesShapeContourOnly = Boolean(
          single && (
            single.type === 'ellipse' ||
            single.type === 'path' ||
            ((single.type === 'rect' || single.type === 'frame' || single.type === 'image') &&
              Boolean(
                (single.style.radius ?? 0) > 0 ||
                (single.style.cornerRadii &&
                  (single.style.cornerRadii.topLeft > 0 ||
                    single.style.cornerRadii.topRight > 0 ||
                    single.style.cornerRadii.bottomRight > 0 ||
                    single.style.cornerRadii.bottomLeft > 0)),
              ))
          ),
        );
        return (
          <SelectionOverlay
            bounds={selectionBounds}
            canResize={canResize && (toolId === 'select' || toolId === 'direct-selection' || toolId === 'scale')}
            canRotate={canResize && toolId === 'select'}
            isScaleTool={toolId === 'scale'}
            hideBoundingRect={usesShapeContourOnly}
            invZoom={invZoom}
          />
        );
      })()}

      {/* On-Canvas Smart Handles: Corner Radius Knobs (Rect/Frame) */}
      {!isAutoLayoutDirectActive &&
        smartHandleNode &&
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

      {/* On-Canvas Smart Handles: Per-Vertex Corner Radius Knobs for ALL Vector Paths (Triangle, Polygon, Star, Pen, Boolean) */}
      {!isAutoLayoutDirectActive &&
        smartHandleNode &&
        smartHandleNode.type === 'path' &&
        smartHandleNode.points.length >= 3 &&
        smartHandleNode.points.length <= 16 &&
        smartHandleNode.width >= 24 &&
        smartHandleNode.height >= 24 && (() => {
          const pts = smartHandleNode.points;
          const n = pts.length;
          const knobs: Array<{ index: number; worldX: number; worldY: number; radius: number }> = [];
          for (let i = 0; i < n; i += 1) {
            if (!smartHandleNode.closed && (i === 0 || i === n - 1)) continue;
            const curr = pts[i];
            if (curr.pointType !== 'corner' || curr.handleIn || curr.handleOut) continue;
            const prev = pts[(i - 1 + n) % n];
            const next = pts[(i + 1) % n];
            const v1x = prev.x - curr.x;
            const v1y = prev.y - curr.y;
            const v2x = next.x - curr.x;
            const v2y = next.y - curr.y;
            const l1 = Math.hypot(v1x, v1y);
            const l2 = Math.hypot(v2x, v2y);
            if (l1 < 8 || l2 < 8) continue;
            const bx = v1x / l1 + v2x / l2;
            const by = v1y / l1 + v2y / l2;
            const bLen = Math.hypot(bx, by);
            if (bLen < 0.05) continue;
            const r = curr.cornerRadius ?? 0;
            const inset = Math.min(Math.min(l1, l2) * 0.42, Math.max(12 * invZoom, r * 0.72 + 10 * invZoom));
            const localKnob = {
              x: curr.x + (bx / bLen) * inset,
              y: curr.y + (by / bLen) * inset,
            };
            const worldKnob = nodeLocalPointToWorld(smartHandleNode, localKnob);
            knobs.push({ index: i, worldX: worldKnob.x, worldY: worldKnob.y, radius: r });
          }
          if (knobs.length === 0) return null;
          return (
            <g class="canvas-smart-handles">
              {knobs.map((knob) => (
                <g
                  key={`pcr-${knob.index}`}
                  class="canvas-smart-handle"
                  data-smart-handle="path-corner-radius"
                  data-smart-node-id={smartHandleNode.id}
                  data-smart-point-index={String(knob.index)}
                  pointer-events="all"
                >
                  <title>{`Corner P${knob.index + 1}: ${Math.round(knob.radius)}px (Drag to round corner · Shift rounds all · Double-click resets)`}</title>
                  <circle class="canvas-smart-handle-hit" cx={knob.worldX} cy={knob.worldY} r={9 * invZoom} />
                  <circle class="canvas-smart-handle-ring" cx={knob.worldX} cy={knob.worldY} r={4.2 * invZoom} />
                  <circle class="canvas-smart-handle-dot" cx={knob.worldX} cy={knob.worldY} r={1.4 * invZoom} />
                </g>
              ))}
            </g>
          );
        })()}

      {/* On-Canvas Interactive Auto-Layout Padding & Gap Scrub Handles */}
      {autoLayoutHandles && (() => {
        const activeSmartSession = toolSession?.kind === 'smart-handle' ? toolSession : null;
        const activePadEdges = new Set<PaddingEdge>();
        if (activeSmartSession?.handle.kind === 'autolayout-padding') {
          (activeSmartSession.activeEdges ?? [activeSmartSession.handle.edge]).forEach((e) => activePadEdges.add(e));
        } else if (hoveredAutoLayoutHandle?.kind === 'padding') {
          const hoveredEdge = hoveredAutoLayoutHandle.edge;
          if (shiftHeld) {
            activePadEdges.add('top');
            activePadEdges.add('right');
            activePadEdges.add('bottom');
            activePadEdges.add('left');
          } else if (altHeld) {
            if (hoveredEdge === 'left' || hoveredEdge === 'right') {
              activePadEdges.add('left');
              activePadEdges.add('right');
            } else {
              activePadEdges.add('top');
              activePadEdges.add('bottom');
            }
          } else {
            activePadEdges.add(hoveredEdge);
          }
        }

        const activeGapAxes = new Set<GapAxis>();
        if (activeSmartSession?.handle.kind === 'autolayout-gap') {
          (activeSmartSession.activeGapAxes ?? [activeSmartSession.handle.axis]).forEach((a) => activeGapAxes.add(a));
        } else if (hoveredAutoLayoutHandle?.kind === 'gap') {
          if (autoLayoutHandles.layoutMode === 'grid' && shiftHeld) {
            activeGapAxes.add('horizontal');
            activeGapAxes.add('vertical');
          } else {
            activeGapAxes.add(hoveredAutoLayoutHandle.axis);
          }
        }

        const hatchFill = `url(#${maskPrefix}-al-hatch)`;

        return (
          <g class="canvas-autolayout-handles" data-testid="autolayout-direct-handles">
            {/* Hatched Padding Zones (visible on hover or active scrub) */}
            {autoLayoutHandles.paddingHandles.map((ph) =>
              activePadEdges.has(ph.edge) ? (
                <rect
                  key={`al-pzone-${ph.edge}`}
                  class="canvas-al-spacing-zone"
                  x={ph.zoneRect.x}
                  y={ph.zoneRect.y}
                  width={Math.max(1, ph.zoneRect.width)}
                  height={Math.max(1, ph.zoneRect.height)}
                  fill={hatchFill}
                  pointer-events="none"
                />
              ) : null,
            )}

            {/* Hatched Gap Corridors across ALL sibling gaps on active axis */}
            {activeGapAxes.has('horizontal') &&
              autoLayoutHandles.horizontalGapZones.map((zone, idx) => (
                <rect
                  key={`al-gzone-h-${idx}`}
                  class="canvas-al-spacing-zone"
                  x={zone.x}
                  y={zone.y}
                  width={Math.max(1, zone.width)}
                  height={Math.max(1, zone.height)}
                  fill={hatchFill}
                  pointer-events="none"
                />
              ))}
            {activeGapAxes.has('vertical') &&
              autoLayoutHandles.verticalGapZones.map((zone, idx) => (
                <rect
                  key={`al-gzone-v-${idx}`}
                  class="canvas-al-spacing-zone"
                  x={zone.x}
                  y={zone.y}
                  width={Math.max(1, zone.width)}
                  height={Math.max(1, zone.height)}
                  fill={hatchFill}
                  pointer-events="none"
                />
              ))}

            {/* Interactive Padding Edge Scrub Handles */}
            {autoLayoutHandles.paddingHandles.map((ph) => {
              const isActive = activePadEdges.has(ph.edge);
              const edgeLabel = ph.edge.charAt(0).toUpperCase() + ph.edge.slice(1);
              return (
                <g
                  key={`al-pad-${ph.edge}`}
                  class={`canvas-al-handle is-padding is-${ph.orientation}${isActive ? ' is-active' : ''}`}
                  data-smart-handle="autolayout-padding"
                  data-smart-node-id={autoLayoutHandles.containerId}
                  data-smart-edge={ph.edge}
                  data-testid={`autolayout-padding-handle-${ph.edge}`}
                  pointer-events="all"
                  onPointerEnter={() => onHoverAutoLayoutHandle?.({ kind: 'padding', edge: ph.edge })}
                  onPointerLeave={() => onHoverAutoLayoutHandle?.(null)}
                >
                  <title>{`${edgeLabel} padding: ${ph.value}px (Drag to adjust · Alt opposite · Shift all · Ctrl 4px snap · Double-click reset)`}</title>
                  <rect
                    class="canvas-smart-handle-hit"
                    x={ph.hitRect.x}
                    y={ph.hitRect.y}
                    width={Math.max(1, ph.hitRect.width)}
                    height={Math.max(1, ph.hitRect.height)}
                  />
                  <line
                    class="canvas-al-handle-casing"
                    x1={ph.barLine.x1}
                    y1={ph.barLine.y1}
                    x2={ph.barLine.x2}
                    y2={ph.barLine.y2}
                  />
                  <line
                    class="canvas-al-handle-bar"
                    x1={ph.barLine.x1}
                    y1={ph.barLine.y1}
                    x2={ph.barLine.x2}
                    y2={ph.barLine.y2}
                  />
                </g>
              );
            })}

            {/* Interactive Gap Scrub Handles */}
            {autoLayoutHandles.gapHandles.map((gh) => {
              const isActive = activeGapAxes.has(gh.axis);
              const gapName = gh.isGrid
                ? gh.axis === 'horizontal'
                  ? 'Column gap'
                  : 'Row gap'
                : 'Gap';
              const extraHint = gh.isGrid ? ' · Shift link row & column' : '';
              return (
                <g
                  key={`al-${gh.id}`}
                  class={`canvas-al-handle is-gap is-${gh.barOrientation}${isActive ? ' is-active' : ''}`}
                  data-smart-handle="autolayout-gap"
                  data-smart-node-id={autoLayoutHandles.containerId}
                  data-smart-axis={gh.axis}
                  data-smart-gap-index={String(gh.index)}
                  data-testid={`autolayout-gap-handle-${gh.axis}-${gh.index}`}
                  pointer-events="all"
                  onPointerEnter={() =>
                    onHoverAutoLayoutHandle?.({ kind: 'gap', axis: gh.axis, index: gh.index })
                  }
                  onPointerLeave={() => onHoverAutoLayoutHandle?.(null)}
                >
                  <title>{`${gapName}: ${gh.value}px (Drag to adjust${extraHint} · Ctrl 4px snap · Double-click reset)`}</title>
                  <rect
                    class="canvas-smart-handle-hit"
                    x={gh.hitRect.x}
                    y={gh.hitRect.y}
                    width={Math.max(1, gh.hitRect.width)}
                    height={Math.max(1, gh.hitRect.height)}
                  />
                  <line
                    class="canvas-al-handle-casing"
                    x1={gh.barLine.x1}
                    y1={gh.barLine.y1}
                    x2={gh.barLine.x2}
                    y2={gh.barLine.y2}
                  />
                  <line
                    class="canvas-al-handle-bar"
                    x1={gh.barLine.x1}
                    y1={gh.barLine.y1}
                    x2={gh.barLine.x2}
                    y2={gh.barLine.y2}
                  />
                </g>
              );
            })}
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

      {/* Smart HUD Overlay (Corner Radius, Star Ratio, Clone, Pivot, Auto-Layout Padding/Gap) */}
      {toolOverlay?.kind === 'smart-hud' && (
        <HudBadge
          x={toolOverlay.x}
          y={toolOverlay.y - 20 * invZoom}
          text={toolOverlay.text}
          variant={toolOverlay.variant ?? 'default'}
          invZoom={invZoom}
        />
      )}

      {/* Auto-Layout Drag-to-Reorder Live Cyan Insertion Indicator Bar */}
      {toolOverlay?.kind === 'autolayout-reorder' && (
        <g
          class="canvas-al-reorder-overlay"
          data-testid="autolayout-reorder-indicator"
          pointer-events="none"
        >
          <rect
            class="canvas-al-reorder-container"
            x={toolOverlay.containerBounds.x}
            y={toolOverlay.containerBounds.y}
            width={Math.max(1, toolOverlay.containerBounds.width)}
            height={Math.max(1, toolOverlay.containerBounds.height)}
          />
          <line
            class="canvas-al-reorder-line"
            x1={toolOverlay.slot.indicatorLine.x1}
            y1={toolOverlay.slot.indicatorLine.y1}
            x2={toolOverlay.slot.indicatorLine.x2}
            y2={toolOverlay.slot.indicatorLine.y2}
          />
          <circle
            class="canvas-al-reorder-cap"
            cx={toolOverlay.slot.indicatorLine.x1}
            cy={toolOverlay.slot.indicatorLine.y1}
            r={3.5 * invZoom}
          />
          <circle
            class="canvas-al-reorder-cap"
            cx={toolOverlay.slot.indicatorLine.x2}
            cy={toolOverlay.slot.indicatorLine.y2}
            r={3.5 * invZoom}
          />
          <HudBadge
            x={toolOverlay.slot.hudPoint.x}
            y={toolOverlay.slot.hudPoint.y - 18 * invZoom}
            text={toolOverlay.slot.hudText}
            variant="default"
            invZoom={invZoom}
          />
        </g>
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

      {/* Live Vector Brush Size Ring */}
      {toolId === 'brush' && hoverPoint && (
        <circle
          class="canvas-brush-cursor-ring"
          cx={hoverPoint.x}
          cy={hoverPoint.y}
          r={Math.max(1.5, toolOptions.brushSize / 2)}
          stroke={toolOptions.brushColor === 'transparent' ? '#94a3b8' : toolOptions.brushColor}
          pointer-events="none"
        />
      )}

      {/* Live Vector Eraser Dual-Contrast Brush Cursor Ring */}
      {toolId === 'eraser' && hoverPoint && (() => {
        const radius = Math.max(2, toolOptions.eraserSize / 2);
        const isErasing = toolSession?.kind === 'freehand' && toolSession.mode === 'eraser';
        return (
          <g
            class={`canvas-eraser-cursor-group${isErasing ? ' is-erasing' : ''}`}
            pointer-events="none"
          >
            <circle
              class="canvas-eraser-cursor-halo"
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={radius}
            />
            <circle
              class="canvas-eraser-cursor-ring"
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={radius}
            />
            <circle
              class="canvas-eraser-cursor-dot"
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={Math.max(1.25, 1.8 * invZoom)}
            />
          </g>
        );
      })()}

      {/* Live Eyedropper Circular Magnifier Swatch Loupe (Edge-Clamped to Artboard Bounds) */}
      {eyedropperLoupe && (() => {
        const flipX = eyedropperLoupe.x + 128 * invZoom > docWidth;
        const flipY = eyedropperLoupe.y - 68 * invZoom < 0;
        const offsetX = flipX ? -54 : 54;
        const offsetY = flipY ? 50 : -50;
        const alphaPct = Math.round(eyedropperLoupe.alpha * 100);
        const primaryMeta = eyedropperLoupe.isTransparent
          ? 'TRANSPARENT'
          : alphaPct < 100
            ? `${eyedropperLoupe.target} · ${alphaPct}%`
            : `${eyedropperLoupe.target} · 100%`;
        return (
          <g
            class="canvas-eyedropper-loupe"
            data-testid="eyedropper-loupe"
            transform={`translate(${eyedropperLoupe.x} ${eyedropperLoupe.y}) scale(${invZoom})`}
            pointer-events="none"
          >
            {/* Subtle cursor reticle */}
            <circle class="canvas-loupe-reticle" cx="0" cy="0" r="5.5" />
            <g transform={`translate(${offsetX} ${offsetY})`}>
              {/* Outer circular magnifier ring */}
              <circle class="canvas-loupe-outer-shadow" cx="0" cy="0" r="26" />
              <circle cx="0" cy="0" r="23" fill={`url(#${maskPrefix}-loupe-checker)`} />
              <circle
                cx="0"
                cy="0"
                r="23"
                fill={eyedropperLoupe.isTransparent ? 'none' : eyedropperLoupe.color}
              />
              {eyedropperLoupe.isTransparent && (
                <line x1="-15" y1="15" x2="15" y2="-15" stroke="#ef4444" stroke-width="2.4" />
              )}
              <circle
                class="canvas-loupe-ring-rim"
                cx="0"
                cy="0"
                r="23"
              />
              <circle
                class="canvas-loupe-ring-inner"
                cx="0"
                cy="0"
                r="14"
              />
              <line class="canvas-loupe-cross" x1="-6" y1="0" x2="6" y2="0" />
              <line class="canvas-loupe-cross" x1="0" y1="-6" x2="0" y2="6" />
              {/* Compact visual metadata pill below the magnifier */}
              <rect class="canvas-loupe-card" x="-48" y="29" width="96" height="24" rx="5" />
              <text class="canvas-loupe-hex" x="0" y="38" text-anchor="middle" dominant-baseline="middle">
                {primaryMeta}
              </text>
              <text class="canvas-loupe-meta" x="0" y="48" text-anchor="middle" dominant-baseline="middle">
                {eyedropperLoupe.sourceName.slice(0, 14)}
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

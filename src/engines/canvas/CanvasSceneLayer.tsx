import { memo } from 'preact/compat';
import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
} from '../../core/document/types';
import { DocumentMaskDefs, MaskedNodeArtwork } from './artwork';
import { buildSmoothSvgTrailPath } from './canvasHelpers';

export interface LiveEraserPreview {
  readonly points: ReadonlyArray<{ x: number; y: number }>;
  readonly size: number;
  readonly mode: 'slice' | 'object';
  readonly targetNodeIds: ReadonlySet<string>;
}

export interface CanvasSceneLayerProps {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly canvasNodes: readonly DesignNode[];
  readonly renderNodes: readonly DesignNode[];
  readonly inlineEditNodeId: string | null;
  readonly components: readonly ComponentDefinition[];
  readonly assets?: readonly AssetReference[];
  readonly maskPrefix: string;
  readonly nodeById: ReadonlyMap<string, DesignNode>;
  readonly clipMaskMap: ReadonlyMap<string, string[]>;
  readonly frameClipMap: ReadonlyMap<string, string[]>;
  readonly componentById: ReadonlyMap<string, ComponentDefinition>;
  readonly assetById?: ReadonlyMap<string, AssetReference>;
  readonly tokens?: DesignTokenCollection;
  /** Node IDs currently isolated onto the active drag overlay layer (skipped here without mutating scene arrays). */
  readonly hiddenNodeIds?: ReadonlySet<string> | null;
  /** Live real-time SVG eraser cutout mask (Slice mode) or fade-out preview (Object mode) while dragging. */
  readonly liveEraserPreview?: LiveEraserPreview | null;
  /** Monotonic revision from assetStore so async IndexedDB hydration invalidates React.memo cleanly. */
  readonly assetCacheRevision?: number;
}

/**
 * Memoized static SVG scene layer.
 * Isolates artwork DOM reconciliation from high-frequency pointer hover,
 * zoom ticks, active node drag previews, marquee, selection-box, and overlay
 * updates so large 1,500+ node scenes stay smooth at 60–120 FPS.
 */
export const CanvasSceneLayer = memo(function CanvasSceneLayer({
  width,
  height,
  background,
  canvasNodes,
  renderNodes,
  inlineEditNodeId,
  components,
  assets,
  maskPrefix,
  nodeById,
  clipMaskMap,
  frameClipMap,
  componentById,
  assetById,
  tokens,
  hiddenNodeIds,
  liveEraserPreview,
}: CanvasSceneLayerProps) {
  const artboardClipId = `${maskPrefix}--artboard-clip`;
  const liveEraserMaskId = `${maskPrefix}--live-eraser-mask`;
  const hasLiveSliceMask = Boolean(
    liveEraserPreview &&
      liveEraserPreview.mode === 'slice' &&
      liveEraserPreview.points.length > 0 &&
      liveEraserPreview.targetNodeIds.size > 0,
  );
  const liveEraserTrailD = hasLiveSliceMask && liveEraserPreview
    ? buildSmoothSvgTrailPath(liveEraserPreview.points)
    : '';
  const liveEraserRadius = liveEraserPreview ? Math.max(2, liveEraserPreview.size / 2) : 12;

  return (
    <>
      <defs>
        <clipPath id={artboardClipId}>
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
        {hasLiveSliceMask && liveEraserPreview && (
          <mask
            id={liveEraserMaskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={width}
            height={height}
          >
            <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
            {liveEraserPreview.points.length === 1 ? (
              <circle
                cx={liveEraserPreview.points[0].x}
                cy={liveEraserPreview.points[0].y}
                r={liveEraserRadius}
                fill="#000000"
              />
            ) : (
              <path
                d={liveEraserTrailD}
                fill="none"
                stroke="#000000"
                stroke-width={Math.max(4, liveEraserPreview.size)}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            )}
          </mask>
        )}
        <DocumentMaskDefs
          nodes={canvasNodes as DesignNode[]}
          width={width}
          height={height}
          components={components as ComponentDefinition[]}
          maskPrefix={maskPrefix}
          nodeById={nodeById as Map<string, DesignNode>}
          clipMaskMap={clipMaskMap as Map<string, string[]>}
          frameClipMap={frameClipMap as Map<string, string[]>}
          componentById={componentById as Map<string, ComponentDefinition>}
          assetById={assetById}
          tokens={tokens}
        />
      </defs>
      <rect x="0" y="0" width={width} height={height} fill={background} />
      <g clip-path={`url(#${artboardClipId})`}>
        {renderNodes.map((node) => {
          if (inlineEditNodeId === node.id || hiddenNodeIds?.has(node.id)) return null;
          const isEraserTarget = Boolean(liveEraserPreview?.targetNodeIds.has(node.id));
          const artwork = (
            <MaskedNodeArtwork
              key={node.id}
              node={node}
              nodes={canvasNodes as DesignNode[]}
              components={components as ComponentDefinition[]}
              assets={assets}
              maskPrefix={maskPrefix}
              clipMaskMap={clipMaskMap as Map<string, string[]>}
              frameClipMap={frameClipMap as Map<string, string[]>}
              componentById={componentById as Map<string, ComponentDefinition>}
              assetById={assetById}
              tokens={tokens}
            />
          );
          if (hasLiveSliceMask && isEraserTarget) {
            return (
              <g key={node.id} mask={`url(#${liveEraserMaskId})`}>
                {artwork}
              </g>
            );
          }
          if (liveEraserPreview?.mode === 'object' && isEraserTarget) {
            return (
              <g key={node.id} opacity={0.18}>
                {artwork}
              </g>
            );
          }
          return artwork;
        })}
      </g>
    </>
  );
});

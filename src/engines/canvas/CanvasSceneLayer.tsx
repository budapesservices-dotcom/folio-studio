import { memo } from 'preact/compat';
import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
} from '../../core/document/types';
import { DocumentMaskDefs, MaskedNodeArtwork } from './artwork';

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
}: CanvasSceneLayerProps) {
  return (
    <>
      <defs>
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
      {renderNodes.map((node) => (
        inlineEditNodeId === node.id || hiddenNodeIds?.has(node.id) ? null : (
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
        )
      ))}
    </>
  );
});

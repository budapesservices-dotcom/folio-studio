import { memo } from 'preact/compat';
import type {
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
  readonly maskPrefix: string;
  readonly nodeById: ReadonlyMap<string, DesignNode>;
  readonly clipMaskMap: ReadonlyMap<string, string[]>;
  readonly frameClipMap: ReadonlyMap<string, string[]>;
  readonly componentById: ReadonlyMap<string, ComponentDefinition>;
  readonly tokens?: DesignTokenCollection;
  readonly patternScale: number;
}

/**
 * Memoized static SVG scene layer.
 * Isolates artwork DOM reconciliation from high-frequency pointer hover,
 * marquee, selection-box, and overlay updates so large 1,500-node scenes stay
 * smooth at 60 FPS.
 */
export const CanvasSceneLayer = memo(function CanvasSceneLayer({
  width,
  height,
  background,
  canvasNodes,
  renderNodes,
  inlineEditNodeId,
  components,
  maskPrefix,
  nodeById,
  clipMaskMap,
  frameClipMap,
  componentById,
  tokens,
  patternScale,
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
          tokens={tokens}
        />
        <pattern
          id={`${maskPrefix}-sb-merge`}
          width={10 * patternScale}
          height={10 * patternScale}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={10 * patternScale} height={10 * patternScale} fill="rgba(56, 189, 248, 0.28)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={10 * patternScale}
            stroke="rgba(255, 255, 255, 0.55)"
            stroke-width={2 * patternScale}
          />
        </pattern>
        <pattern
          id={`${maskPrefix}-sb-punch`}
          width={10 * patternScale}
          height={10 * patternScale}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width={10 * patternScale} height={10 * patternScale} fill="rgba(244, 63, 94, 0.34)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={10 * patternScale}
            stroke="rgba(255, 255, 255, 0.55)"
            stroke-width={2 * patternScale}
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill={background} />
      {renderNodes.map((node) => (
        inlineEditNodeId === node.id ? null : (
          <MaskedNodeArtwork
            key={node.id}
            node={node}
            nodes={canvasNodes as DesignNode[]}
            components={components as ComponentDefinition[]}
            maskPrefix={maskPrefix}
            clipMaskMap={clipMaskMap as Map<string, string[]>}
            frameClipMap={frameClipMap as Map<string, string[]>}
            componentById={componentById as Map<string, ComponentDefinition>}
            tokens={tokens}
          />
        )
      ))}
    </>
  );
});

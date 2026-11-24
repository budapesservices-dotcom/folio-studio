/**
 * Preact Hybrid GPU Viewport Layer.
 *
 * Mounts behind `<svg class="artboard">` when Hybrid GPU rendering is active.
 * Static artwork renders via WebGL2 instanced SDF quads + 512x512 LRU tile cache
 * (0 static artwork SVG DOM nodes), while selection outlines, resize/rotate handles,
 * Bezier anchors, snapping guides, redlines, and inline text stay razor-sharp in SVG.
 */

import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
} from '../../../core/document/types';
import { HybridGpuViewportEngine } from './gpuRenderer';
import type { GpuSceneMetrics, ViewportRect } from './types';

export interface GpuViewportLayerProps {
  readonly active: boolean;
  readonly docWidth: number;
  readonly docHeight: number;
  readonly background: string;
  readonly canvasNodes: readonly DesignNode[];
  readonly renderNodes: readonly DesignNode[];
  readonly viewportRect: ViewportRect | null;
  readonly zoom: number;
  readonly components: readonly ComponentDefinition[];
  readonly assets?: readonly AssetReference[];
  readonly nodeById: ReadonlyMap<string, DesignNode>;
  readonly clipMaskMap: ReadonlyMap<string, string[]>;
  readonly frameClipMap: ReadonlyMap<string, string[]>;
  readonly componentById: ReadonlyMap<string, ComponentDefinition>;
  readonly assetById?: ReadonlyMap<string, AssetReference>;
  readonly tokens?: DesignTokenCollection;
  readonly hiddenNodeIds?: ReadonlySet<string> | null;
  readonly inlineEditNodeId: string | null;
  readonly onMetrics?: (metrics: GpuSceneMetrics) => void;
}

export const GpuViewportLayer = memo(function GpuViewportLayer({
  active,
  docWidth,
  docHeight,
  background,
  canvasNodes,
  renderNodes,
  viewportRect,
  zoom,
  components,
  assets,
  nodeById,
  clipMaskMap,
  frameClipMap,
  componentById,
  assetById,
  tokens,
  hiddenNodeIds,
  inlineEditNodeId,
  onMetrics,
}: GpuViewportLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instancedCanvasRef = useRef<HTMLCanvasElement>(null);
  const webgpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<HybridGpuViewportEngine | null>(null);
  const [assetVersion, setAssetVersion] = useState(0);

  // Initialize / dispose GPU engine tied to `active` lifecycle, then opportunistically upgrade to WebGPU
  useEffect(() => {
    if (!active) {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      return;
    }

    const instanced = instancedCanvasRef.current;
    const webgpuCanvas = webgpuCanvasRef.current;
    const tile = tileCanvasRef.current;
    if (!instanced || !tile) return;

    const engine = new HybridGpuViewportEngine(instanced, tile, 64);
    engineRef.current = engine;

    let cancelled = false;
    if (webgpuCanvas) {
      void engine.upgradeToWebGpuAsync(webgpuCanvas).then((upgraded) => {
        if (!cancelled && upgraded && engineRef.current === engine) {
          setAssetVersion((v) => v + 1);
        }
      });
    }

    return () => {
      cancelled = true;
      engine.dispose();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
  }, [active]);

  // Render GPU + Tile frame whenever scene, viewport, zoom, or async images update
  useEffect(() => {
    if (!active || !engineRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const displayW = rect.width > 8 ? rect.width : docWidth * Math.max(0.25, zoom);
    const displayH = rect.height > 8 ? rect.height : docHeight * Math.max(0.25, zoom);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const effectiveViewport: ViewportRect = viewportRect ?? {
      x: 0,
      y: 0,
      width: docWidth,
      height: docHeight,
    };

    const metrics = engineRef.current.renderFrame({
      docWidth,
      docHeight,
      background,
      renderNodes,
      viewportRect: effectiveViewport,
      dpr,
      displayWidthPx: displayW,
      displayHeightPx: displayH,
      hiddenNodeIds,
      inlineEditNodeId,
      richContext: {
        allNodes: canvasNodes,
        components,
        componentById,
        assets,
        assetById,
        tokens,
        clipMaskMap,
        frameClipMap,
        nodeById,
        onAsyncAssetLoaded: () => {
          engineRef.current?.invalidateTiles();
          setAssetVersion((v) => v + 1);
        },
      },
    });

    onMetrics?.(metrics);
  }, [
    active,
    docWidth,
    docHeight,
    background,
    canvasNodes,
    renderNodes,
    viewportRect,
    zoom,
    components,
    assets,
    nodeById,
    clipMaskMap,
    frameClipMap,
    componentById,
    assetById,
    tokens,
    hiddenNodeIds,
    inlineEditNodeId,
    assetVersion,
    onMetrics,
  ]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      class="gpu-viewport-layer"
      data-gpu-viewport="active"
      aria-hidden="true"
    >
      <canvas ref={instancedCanvasRef} class="gpu-viewport-canvas gpu-instanced-layer" />
      <canvas
        ref={webgpuCanvasRef}
        class="gpu-viewport-canvas gpu-instanced-layer"
        style={{ display: 'none' }}
      />
      <canvas ref={tileCanvasRef} class="gpu-viewport-canvas gpu-tile-layer" />
    </div>
  );
});

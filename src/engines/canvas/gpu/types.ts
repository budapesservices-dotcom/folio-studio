/**
 * Hybrid GPU Viewport Engine — Shared Contracts & Telemetry Types.
 *
 * Keeps Folio's rendering pipeline ultra-lightweight (zero 8MB WASM bloat):
 * - Fast-path solid primitives (rects, frames, ellipses) render in a single
 *   WebGPU / WebGL2 instanced SDF draw call (16 floats / instance).
 * - Rich artwork (vector paths, typography, multi-fill gradients, shadows,
 *   blur, images, nested component instances) renders through a 512x512 LRU
 *   Tile Cache on a composited 2D canvas.
 * - Interactive overlays (selection handles, Bezier anchors, snapping guides,
 *   redlines, inline text editing) stay razor-sharp in the SVG/DOM overlay layer.
 */

import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
} from '../../../core/document/types';

export type ViewportRendererMode = 'auto' | 'gpu-hybrid' | 'svg-dom';

export type GpuBackendKind = 'webgpu' | 'webgl2' | 'canvas2d-tiled' | 'svg-dom';

/**
 * In `'auto'` mode, scenes below this node count use SVG DOM directly (preserving
 * lightweight DOM semantics on small scenes), while scenes at or above this threshold
 * automatically engage the Hybrid GPU + Tile Cache viewport.
 */
export const GPU_HYBRID_AUTO_THRESHOLD = 250;

/**
 * Contiguous zero-copy Float32 layout per GPU instanced primitive (4 x vec4 = 64 bytes):
 * [0..3]   a_rect   : x, y, width, height
 * [4..7]   a_fill   : fillR, fillG, fillB, fillA
 * [8..11]  a_geom   : cornerRadius, rotationRadians, strokeWidth, shapeKind (0=rect/frame, 1=ellipse)
 * [12..15] a_stroke : strokeR, strokeG, strokeB, strokeA
 */
export const GPU_INSTANCE_STRIDE_FLOATS = 16;

export const DEFAULT_TILE_SIZE = 512;

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TileCoord {
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly key: string;
}

export interface PackedGpuScene {
  /** Contiguous Float32 instance buffer (length = instanceCount * GPU_INSTANCE_STRIDE_FLOATS). */
  readonly instanceData: Float32Array;
  readonly instanceCount: number;
  /** Complex / rich nodes rendered via the 512x512 LRU tile cache in painter's order. */
  readonly richNodes: readonly DesignNode[];
  /** Total visible non-culled nodes evaluated for this frame. */
  readonly totalEvaluatedNodes: number;
  /** Nodes culled outside the active viewport rect. */
  readonly culledNodes: number;
  /** Time spent packing instances & partitioning rich nodes (ms). */
  readonly packMs: number;
}

export interface TileCacheStats {
  readonly size: number;
  readonly maxTiles: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export interface GpuSceneMetrics {
  readonly backend: GpuBackendKind;
  readonly totalNodes: number;
  readonly instancedPrimitives: number;
  readonly richNodes: number;
  readonly culledNodes: number;
  readonly visibleTiles: number;
  readonly tileCacheHits: number;
  readonly tileCacheMisses: number;
  readonly tileCacheSize: number;
  readonly gpuBufferBytes: number;
  readonly packMs: number;
  readonly uploadMs: number;
  readonly drawMs: number;
  readonly lastFrameMs: number;
}

export interface RichNodeRenderContext {
  readonly allNodes: readonly DesignNode[];
  readonly components: readonly ComponentDefinition[];
  readonly componentById: ReadonlyMap<string, ComponentDefinition>;
  readonly assets?: readonly AssetReference[];
  readonly assetById?: ReadonlyMap<string, AssetReference>;
  readonly tokens?: DesignTokenCollection;
  readonly clipMaskMap: ReadonlyMap<string, string[]>;
  readonly frameClipMap: ReadonlyMap<string, string[]>;
  readonly nodeById: ReadonlyMap<string, DesignNode>;
  readonly onAsyncAssetLoaded?: () => void;
}

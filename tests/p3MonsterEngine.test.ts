import { afterEach, describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import type { DesignNode, EllipseNode, FrameNode, RectNode, TextNode } from '../src/core/document/types';
import {
  bootMonsterComputeKernels,
  FlatGridSpatialIndex,
  getComputeKernelRuntimeStatus,
  getComputeKernels,
  resetComputeKernels,
  type SpatialEntry,
} from '../src/core/kernels';
import {
  createWasmSpatialIndexKernel,
  isWebAssemblySupported,
  WASM_SPATIAL_MODULE_BYTES,
} from '../src/core/kernels/wasmSpatialKernel';
import { handleComputeWorkerMessage } from '../src/core/kernels/compute.worker';
import { ComputeWorkerClient } from '../src/core/kernels/workerBridge';
import {
  computeTileSignature,
  computeVisibleTileGrid,
  filterNodesForTile,
  isGpuInstancedPrimitive,
  packSceneToGpuBatches,
  parseCssColorToRgba,
} from '../src/engines/canvas/gpu/scenePacker';
import { TileCacheManager, type TileSurface } from '../src/engines/canvas/gpu/tileCache';
import { GPU_INSTANCE_STRIDE_FLOATS } from '../src/engines/canvas/gpu/types';
import { WEBGPU_SDF_WGSL } from '../src/engines/canvas/gpu/gpuRenderer';
import { analyzeProjectHealth, runLiveSceneProfile } from '../src/engines/diagnostics/studioProfiler';

function buildSyntheticNodes(count: number): DesignNode[] {
  const nodes: DesignNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % 100;
    const row = Math.floor(i / 100);
    const x = col * 140;
    const y = row * 100;

    if (i % 10 === 9) {
      const text: TextNode = {
        id: `n-${i}`,
        type: 'text',
        name: `Label ${i}`,
        x: x + 8,
        y: y + 8,
        width: 110,
        height: 24,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: `Card #${i}`,
        style: {
          fill: '#f1f5f9',
          fontSize: 14,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          letterSpacing: 0,
          lineHeight: 1.35,
        },
      };
      nodes.push(text);
    } else if (i % 5 === 0) {
      const ellipse: EllipseNode = {
        id: `n-${i}`,
        type: 'ellipse',
        name: `Dot ${i}`,
        x,
        y,
        width: 48,
        height: 48,
        rotation: 0,
        opacity: 0.9,
        visible: true,
        locked: false,
        style: {
          fill: '#8b7cf6',
          stroke: '#ffffff',
          strokeWidth: 2,
        },
      };
      nodes.push(ellipse);
    } else {
      const rect: RectNode = {
        id: `n-${i}`,
        type: 'rect',
        name: `Card ${i}`,
        x,
        y,
        width: 120,
        height: 80,
        rotation: i % 17 === 0 ? 15 : 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: {
          fill: '#1e293b',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 10,
        },
      };
      nodes.push(rect);
    }
  }
  return nodes;
}

function createMockTileSurface(w: number, h: number): TileSurface {
  return {
    width: w,
    height: h,
    getContext2D: () => null,
    drawable: null,
  };
}

describe('Prioritas 3 — Hybrid GPU Viewport + WASM/Worker Compute Kernels', () => {
  afterEach(() => {
    resetComputeKernels();
  });

  describe('WebAssembly Linear-Memory Spatial Index Kernel', () => {
    it('validates the embedded ~190-byte WebAssembly binary and matches FlatGridSpatialIndex 100% across 10,000 nodes', () => {
      expect(isWebAssemblySupported()).toBe(true);
      expect(WebAssembly.validate(WASM_SPATIAL_MODULE_BYTES)).toBe(true);
      expect(WASM_SPATIAL_MODULE_BYTES.byteLength).toBeLessThan(300);

      const entries: SpatialEntry[] = Array.from({ length: 10000 }, (_, i) => {
        const col = i % 100;
        const row = Math.floor(i / 100);
        return {
          id: `node-${i}`,
          minX: col * 120,
          minY: row * 90,
          maxX: col * 120 + 100,
          maxY: row * 90 + 70,
          zIndex: i,
        };
      });

      const wasmKernel = createWasmSpatialIndexKernel();
      expect(wasmKernel.backend).toBe('wasm');

      const wasmIndex = wasmKernel.buildIndex(entries);
      const flatIndex = new FlatGridSpatialIndex(entries);

      const rect = { minX: 480, minY: 360, maxX: 1680, maxY: 1260 };
      const start = performance.now();
      const wasmHits = wasmIndex.queryRect(rect);
      const elapsedMs = performance.now() - start;
      const flatHits = flatIndex.queryRect(rect);

      expect(wasmHits.map((e) => e.id)).toEqual(flatHits.map((e) => e.id));
      expect(wasmHits.length).toBeGreaterThan(50);
      // Must be blazingly fast on 10,000 nodes (< 4 ms target; generous CI ceiling 25 ms)
      expect(elapsedMs).toBeLessThan(25);

      // Point query & snap candidate parity
      const ptHitsWasm = wasmIndex.queryPoint(610, 460, 4);
      const ptHitsFlat = flatIndex.queryPoint(610, 460, 4);
      expect(ptHitsWasm.map((e) => e.id)).toEqual(ptHitsFlat.map((e) => e.id));

      const snapWasm = wasmIndex.querySnapCandidates({ minX: 500, minY: 400, maxX: 700, maxY: 500 }, 12);
      const snapFlat = flatIndex.querySnapCandidates({ minX: 500, minY: 400, maxX: 700, maxY: 500 }, 12);
      expect(snapWasm.map((e) => e.id)).toEqual(snapFlat.map((e) => e.id));
    });

    it('boots WASM spatial kernel via bootMonsterComputeKernels() and restores ts-default on reset', async () => {
      expect(getComputeKernels().spatial.backend).toBe('ts-default');
      const status = await bootMonsterComputeKernels();
      expect(status.wasmSupported).toBe(true);
      expect(status.spatialBackend).toBe('wasm');
      expect(getComputeKernels().spatial.backend).toBe('wasm');

      resetComputeKernels();
      expect(getComputeKernels().spatial.backend).toBe('ts-default');
      expect(getComputeKernelRuntimeStatus().spatialBackend).toBe('ts-default');
    });
  });

  describe('Compute Web Worker Protocol & Offload Bridge', () => {
    it('executes spatial, pathfinder, shape-builder, auto-layout, and a11y audit kernels cleanly', async () => {
      const client = new ComputeWorkerClient();

      // 1. Spatial sync + queryRect + querySnap
      const entries: SpatialEntry[] = [
        { id: 'a', minX: 0, minY: 0, maxX: 100, maxY: 100, zIndex: 0 },
        { id: 'b', minX: 110, minY: 0, maxX: 210, maxY: 100, zIndex: 1 },
        { id: 'c', minX: 900, minY: 900, maxX: 1000, maxY: 1000, zIndex: 2 },
      ];
      const syncResult = await client.syncSpatialIndexAsync(entries);
      expect(syncResult.indexedCount).toBe(3);

      const rectHits = await client.querySpatialRectAsync({ minX: 0, minY: 0, maxX: 250, maxY: 150 });
      expect(rectHits.map((e) => e.id)).toEqual(['a', 'b']);

      const snapHits = await client.querySnapCandidatesAsync({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 20);
      expect(snapHits.map((e) => e.id)).toContain('b');

      // 2. Pathfinder boolean unite off-thread
      const r1: RectNode = {
        id: 'r1',
        type: 'rect',
        name: 'R1',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: '#6366f1', stroke: 'none', strokeWidth: 0 },
      };
      const r2: RectNode = {
        ...r1,
        id: 'r2',
        name: 'R2',
        x: 50,
        y: 0,
      };
      const united = await client.applyPathfinderAsync([r1, r2], 'unite', 'united-1');
      expect(united).not.toBeNull();
      expect(united?.type).toBe('path');
      expect(united?.width).toBeCloseTo(150, 0);

      // 3. Shape Builder arrangement off-thread
      const arrangement = await client.decomposeShapeBuilderAsync([r1, r2]);
      expect(arrangement.faces.length).toBeGreaterThanOrEqual(2);

      // 4. Auto-Layout solver off-thread
      const frame: FrameNode = {
        id: 'f1',
        type: 'frame',
        name: 'Row',
        x: 0,
        y: 0,
        width: 400,
        height: 120,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        layout: {
          mode: 'flex',
          direction: 'row',
          gap: 16,
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
        },
        style: { fill: '#111827', stroke: 'none', strokeWidth: 0 },
      };
      const c1: RectNode = { ...r1, id: 'c1', parentId: 'f1', width: 80, height: 40 };
      const c2: RectNode = { ...r1, id: 'c2', parentId: 'f1', width: 80, height: 40 };
      const solved = await client.computeAutoLayoutAsync([frame, c1, c2], { breakpoint: 'desktop' });
      const solvedC2 = solved.find((n) => n.id === 'c2');
      expect(solvedC2?.x).toBe(106); // 10 padding + 80 width + 16 gap

      // 5. Accessibility audit off-thread
      const project = createInitialProject();
      const report = await client.auditAccessibilityAsync(project, project.activePageId);
      expect(report.pageId).toBe(project.activePageId);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);

      // 6. Direct pure handler error handling
      const missingPageResp = handleComputeWorkerMessage({
        id: 99,
        kind: 'a11y.audit',
        project,
        pageId: 'non-existent-page',
      });
      expect(missingPageResp.ok).toBe(true);

      client.dispose();
    });
  });

  describe('Hybrid GPU Viewport Scene Packer & 512px LRU Tile Cache', () => {
    it('parses hex, rgb, rgba, and named CSS colors with opacity accurately', () => {
      expect(parseCssColorToRgba('#ff0080')).toEqual([1, 0, 128 / 255, 1]);
      expect(parseCssColorToRgba('#0f8', 0.5)).toEqual([0, 1, 136 / 255, 0.5]);
      expect(parseCssColorToRgba('rgba(255, 128, 0, 0.5)')).toEqual([1, 128 / 255, 0, 0.5]);
      expect(parseCssColorToRgba('none')).toEqual([0, 0, 0, 0]);
      expect(parseCssColorToRgba('transparent')).toEqual([0, 0, 0, 0]);
    });

    it('packs 10,000 nodes into contiguous GPU Float32Array batches + rich tile nodes with viewport culling and WGSL shader', () => {
      expect(WEBGPU_SDF_WGSL).toContain('fn vs_main');
      expect(WEBGPU_SDF_WGSL).toContain('fn fs_main');

      const nodes = buildSyntheticNodes(10000);
      const scratch = new Float32Array(nodes.length * GPU_INSTANCE_STRIDE_FLOATS);

      const packed = packSceneToGpuBatches(nodes, {
        viewportRect: { x: 0, y: 0, width: 1440, height: 900 },
        scratchBuffer: scratch,
      });

      expect(packed.culledNodes).toBeGreaterThan(9000);
      expect(packed.instanceCount).toBeGreaterThan(50);
      expect(packed.richNodes.length).toBeGreaterThan(5);
      expect(packed.instanceData.length).toBe(packed.instanceCount * GPU_INSTANCE_STRIDE_FLOATS);
      // Full viewport pack + cull on 10,000 nodes should be blazingly fast
      expect(packed.packMs).toBeLessThan(25);

      // Verify primitive eligibility guard (effects / gradients / sections route to rich tile pass)
      const solidRect = nodes[1] as RectNode;
      expect(isGpuInstancedPrimitive(solidRect)).toBe(true);
      const shadowedRect: RectNode = {
        ...solidRect,
        effects: [{ id: 'e1', type: 'drop-shadow', x: 0, y: 4, blur: 12, color: '#00000044', visible: true }],
      };
      expect(isGpuInstancedPrimitive(shadowedRect)).toBe(false);
    });

    it('preserves painter z-order when a solid primitive overlaps an earlier rich node', () => {
      const textUnder: TextNode = {
        id: 't-under',
        type: 'text',
        name: 'Text Under',
        x: 20,
        y: 20,
        width: 120,
        height: 30,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: 'Hello',
        style: {
          fill: '#ffffff',
          fontSize: 16,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          letterSpacing: 0,
          lineHeight: 1.3,
        },
      };
      const badgeOver: RectNode = {
        id: 'r-over',
        type: 'rect',
        name: 'Badge Over',
        x: 30,
        y: 20,
        width: 60,
        height: 30,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: '#ef4444', stroke: 'none', strokeWidth: 0, radius: 6 },
      };
      const farRect: RectNode = {
        ...badgeOver,
        id: 'r-far',
        x: 700,
        y: 700,
      };

      const packed = packSceneToGpuBatches([textUnder, badgeOver, farRect]);
      // badgeOver overlaps textUnder so it is promoted to richNodes in exact painter's order
      expect(packed.richNodes.map((n) => n.id)).toEqual(['t-under', 'r-over']);
      // farRect does not overlap any rich node cell so it stays in the GPU instanced batch
      expect(packed.instanceCount).toBe(1);
    });

    it('caches unchanged 512px tiles with LRU eviction and invalidates only dirty tiles on edit', () => {
      const tiles = computeVisibleTileGrid({ x: 0, y: 0, width: 1440, height: 900 }, 1440, 900, 512);
      expect(tiles.length).toBe(6); // 3 cols x 2 rows

      const cache = new TileCacheManager(4, createMockTileSurface);
      const richNodes = buildSyntheticNodes(30).filter((n) => n.type === 'text');
      const tile0 = tiles[0];
      const nodesInTile0 = filterNodesForTile(richNodes, tile0);
      const sigA = computeTileSignature(nodesInTile0, tile0, 1);

      let renderCount = 0;
      cache.getOrRenderTile(tile0, sigA, 512, 512, () => {
        renderCount += 1;
      });
      cache.getOrRenderTile(tile0, sigA, 512, 512, () => {
        renderCount += 1;
      });
      expect(renderCount).toBe(1);
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);

      // Mutating a node inside tile0 changes FNV-1a signature and re-rasterizes that tile
      const mutated = nodesInTile0.map((n, idx) =>
        idx === 0 && n.type === 'text' ? { ...n, text: 'Updated Heading' } : n,
      );
      const sigB = computeTileSignature(mutated, tile0, 1);
      expect(sigB).not.toBe(sigA);
      cache.getOrRenderTile(tile0, sigB, 512, 512, () => {
        renderCount += 1;
      });
      expect(renderCount).toBe(2);

      // Fill past maxTiles=4 to verify LRU eviction
      for (const tile of tiles.slice(1)) {
        cache.getOrRenderTile(tile, `sig-${tile.key}`, 512, 512, () => {});
      }
      expect(cache.getStats().size).toBe(4);
      expect(cache.getStats().evictions).toBeGreaterThanOrEqual(2);
    });

    it('reports WASM/Worker compute status and GPU batch packing stage in Studio Profiler', () => {
      const project = createInitialProject();
      const health = analyzeProjectHealth(project);
      expect(health.computeKernels.wasmSupported).toBe(true);
      expect(health.checks.some((c) => c.id === 'compute-kernels')).toBe(true);

      const profile = runLiveSceneProfile(project);
      expect(profile.stages.some((s) => s.id === 'gpu-scene-pack')).toBe(true);
    });
  });
});

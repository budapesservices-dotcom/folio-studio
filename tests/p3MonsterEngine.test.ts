import { afterEach, describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  EllipseNode,
  FrameNode,
  PathNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import {
  bootMonsterComputeKernels,
  FlatGridSpatialIndex,
  getComputeKernelRuntimeStatus,
  getComputeKernels,
  resetComputeKernels,
  type SpatialBoundsEntry,
} from '../src/core/kernels';
import {
  createWasmSpatialIndexKernel,
  isWebAssemblySupported,
  WASM_SPATIAL_MODULE_BYTES,
  WasmAcceleratedSpatialIndex,
} from '../src/core/kernels/wasmSpatialKernel';
import {
  findOverlappingSegmentPairsWasm,
  WASM_GEOMETRY_MODULE_BYTES,
} from '../src/core/kernels/wasmGeometryKernel';
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
import {
  renderRichNodeToContext2D,
  TileCacheManager,
  type TileSurface,
} from '../src/engines/canvas/gpu/tileCache';
import { GPU_INSTANCE_STRIDE_FLOATS, type RichNodeRenderContext } from '../src/engines/canvas/gpu/types';
import { computeGpuViewportProjection, WEBGPU_SDF_WGSL } from '../src/engines/canvas/gpu/gpuRenderer';
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
      expect(WebAssembly.validate(WASM_SPATIAL_MODULE_BYTES as BufferSource)).toBe(true);
      expect(WASM_SPATIAL_MODULE_BYTES.byteLength).toBeLessThan(300);

      const entries: SpatialBoundsEntry[] = Array.from({ length: 10000 }, (_, i) => {
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
      expect(wasmKernel).not.toBeNull();
      expect(wasmKernel!.backend).toBe('wasm');

      const wasmIndex = wasmKernel!.buildIndex(entries);
      const flatIndex = new FlatGridSpatialIndex(entries);

      const rect = { minX: 480, minY: 360, maxX: 1680, maxY: 1260 };
      const start = performance.now();
      const wasmHits = wasmIndex.queryRect(rect);
      const elapsedMs = performance.now() - start;
      const flatHits = flatIndex.queryRect(rect);

      expect(wasmHits).toEqual(flatHits);
      expect(wasmHits.length).toBeGreaterThan(50);
      // Must be blazingly fast on 10,000 nodes (< 4 ms target; generous CI ceiling 25 ms)
      expect(elapsedMs).toBeLessThan(25);

      // Point query & snap candidate parity
      const ptHitsWasm = wasmIndex.queryPoint(610, 460, 4);
      const ptHitsFlat = flatIndex.queryPoint(610, 460, 4);
      expect(ptHitsWasm).toEqual(ptHitsFlat);

      const snapWasm = wasmIndex.querySnapCandidates({ minX: 500, minY: 400, maxX: 700, maxY: 500 }, 12);
      const snapFlat = flatIndex.querySnapCandidates({ minX: 500, minY: 400, maxX: 700, maxY: 500 }, 12);
      expect(snapWasm).toEqual(snapFlat);
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

    it('reuses persistent WASM linear memory with zero memcpy across repeated pan/zoom queries', () => {
      const wasmKernel = createWasmSpatialIndexKernel();
      expect(wasmKernel).not.toBeNull();
      const entries: SpatialBoundsEntry[] = Array.from({ length: 2000 }, (_, i) => ({
        id: `z-${i}`,
        minX: (i % 50) * 100,
        minY: Math.floor(i / 50) * 80,
        maxX: (i % 50) * 100 + 80,
        maxY: Math.floor(i / 50) * 80 + 60,
        zIndex: i,
      }));
      const index = wasmKernel!.buildIndex(entries) as WasmAcceleratedSpatialIndex;
      const before = index.getRuntimeStats();

      // Simulate 12 consecutive viewport pan frames on the same unchanged scene
      for (let frame = 0; frame < 12; frame += 1) {
        const hits = index.queryRect({
          minX: frame * 120,
          minY: 100,
          maxX: frame * 120 + 800,
          maxY: 700,
        });
        expect(hits.length).toBeGreaterThan(0);
      }

      const after = index.getRuntimeStats();
      // Only 1 initial linear-memory upload; all 11 subsequent frames must be zero-copy hits!
      expect(after.uploadCount - before.uploadCount).toBe(1);
      expect(after.zeroCopyHits - before.zeroCopyHits).toBe(11);
    });

    it('validates the ~250-byte WebAssembly sweep-line geometry kernel and matches O(N^2) brute-force 100% across 500 segments', () => {
      expect(WebAssembly.validate(WASM_GEOMETRY_MODULE_BYTES as BufferSource)).toBe(true);
      expect(WASM_GEOMETRY_MODULE_BYTES.byteLength).toBeLessThan(320);

      // Deterministic PRNG for 500 overlapping & non-overlapping segment AABBs
      let seed = 1337;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const count = 500;
      const boxes = Array.from({ length: count }, () => {
        const x0 = rand() * 800;
        const y0 = rand() * 800;
        const w = 10 + rand() * 90;
        const h = 10 + rand() * 90;
        return { minX: x0, minY: y0, maxX: x0 + w, maxY: y0 + h };
      });
      boxes.sort((a, b) => a.minX - b.minX);

      const packed = new Float64Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        packed[i * 4] = boxes[i].minX;
        packed[i * 4 + 1] = boxes[i].minY;
        packed[i * 4 + 2] = boxes[i].maxX;
        packed[i * 4 + 3] = boxes[i].maxY;
      }

      const wasmResult = findOverlappingSegmentPairsWasm(packed, count);
      expect(wasmResult).not.toBeNull();

      const wasmPairs: string[] = [];
      for (let p = 0; p < wasmResult!.pairCount; p += 1) {
        wasmPairs.push(`${wasmResult!.pairsView[p * 2]}:${wasmResult!.pairsView[p * 2 + 1]}`);
      }

      // Ground-truth brute-force O(N^2) overlap detection
      const expectedPairs: string[] = [];
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          if (
            boxes[i].maxX >= boxes[j].minX &&
            boxes[j].maxX >= boxes[i].minX &&
            boxes[i].maxY >= boxes[j].minY &&
            boxes[j].maxY >= boxes[i].minY
          ) {
            expectedPairs.push(`${i}:${j}`);
          }
        }
      }

      expect(wasmPairs.length).toBeGreaterThan(200);
      expect(wasmPairs).toEqual(expectedPairs);
    });
  });

  describe('Compute Web Worker Protocol & Offload Bridge', () => {
    it('executes spatial, pathfinder, shape-builder, auto-layout, and a11y audit kernels cleanly', async () => {
      const client = new ComputeWorkerClient();

      // 1. Spatial sync + queryRect + querySnap
      const entries: SpatialBoundsEntry[] = [
        { id: 'a', minX: 0, minY: 0, maxX: 100, maxY: 100, zIndex: 0 },
        { id: 'b', minX: 110, minY: 0, maxX: 210, maxY: 100, zIndex: 1 },
        { id: 'c', minX: 900, minY: 900, maxX: 1000, maxY: 1000, zIndex: 2 },
      ];
      const syncResult = await client.syncSpatialIndexAsync(entries);
      expect(syncResult.indexedCount).toBe(3);

      const rectHits = await client.querySpatialRectAsync({ minX: 0, minY: 0, maxX: 250, maxY: 150 });
      expect(rectHits).toEqual(['a', 'b']);

      const snapHits = await client.querySnapCandidatesAsync({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 20);
      expect(snapHits).toContain('b');

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

      // 6. Direct pure handler fallback & unknown message safety
      const missingPageResp = handleComputeWorkerMessage({
        id: 99,
        type: 'a11y.audit',
        project,
        pageId: 'non-existent-page',
      });
      expect(missingPageResp.ok).toBe(true);

      const unknownResp = handleComputeWorkerMessage({
        id: 100,
        type: 'unknown.op',
      } as unknown as Parameters<typeof handleComputeWorkerMessage>[0]);
      expect(unknownResp.ok).toBe(false);

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
      const tile0Text: TextNode = {
        id: 'tile0-heading',
        type: 'text',
        name: 'Tile 0 Heading',
        x: 32,
        y: 48,
        width: 180,
        height: 28,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: 'Initial Heading',
        style: {
          fill: '#f1f5f9',
          fontSize: 16,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          letterSpacing: 0,
          lineHeight: 1.35,
        },
      };
      const richNodes = [tile0Text, ...buildSyntheticNodes(30).filter((n) => n.type === 'text')];
      const tile0 = tiles[0];
      const nodesInTile0 = filterNodesForTile(richNodes, tile0);
      expect(nodesInTile0.length).toBeGreaterThan(0);
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

      // Verify path handle & gradient angle mutations invalidate tile signatures (no stale tiles)
      const curvePath: PathNode = {
        id: 'curve-1',
        type: 'path',
        name: 'Curve',
        x: 20,
        y: 20,
        width: 120,
        height: 80,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        closed: false,
        points: [
          { id: 'p0', pointType: 'corner', x: 0, y: 0, handleOut: { x: 20, y: 0 } },
          { id: 'p1', pointType: 'corner', x: 120, y: 80, handleIn: { x: 80, y: 80 } },
        ],
        style: { fill: 'none', stroke: '#38bdf8', strokeWidth: 2 },
      };
      const editedCurvePath: PathNode = {
        ...curvePath,
        points: [
          { id: 'p0', pointType: 'corner', x: 0, y: 0, handleOut: { x: 60, y: 10 } },
          { id: 'p1', pointType: 'corner', x: 120, y: 80, handleIn: { x: 80, y: 80 } },
        ],
      };
      expect(computeTileSignature([curvePath], tile0, 1)).not.toBe(
        computeTileSignature([editedCurvePath], tile0, 1),
      );

      const gradRect: RectNode = {
        id: 'grad-1',
        type: 'rect',
        name: 'Grad',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: {
          fill: '#000000',
          stroke: 'none',
          strokeWidth: 0,
          fills: [
            {
              id: 'fill-g1',
              type: 'linear-gradient',
              angle: 45,
              stops: [
                { offset: 0, color: '#6366f1' },
                { offset: 1, color: '#ec4899' },
              ],
            },
          ],
        },
      };
      const rotatedGradRect: RectNode = {
        ...gradRect,
        style: {
          ...gradRect.style,
          fills: [
            {
              id: 'fill-g1',
              type: 'linear-gradient',
              angle: 135,
              stops: [
                { offset: 0, color: '#6366f1' },
                { offset: 1, color: '#10b981' },
              ],
            },
          ],
        },
      };
      expect(computeTileSignature([gradRect], tile0, 1)).not.toBe(
        computeTileSignature([rotatedGradRect], tile0, 1),
      );

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

    it('packs zero-copy 4xvec4 GPU instances and projects 1600% zoom cleanly in viewport space', () => {
      expect(WEBGPU_SDF_WGSL).toContain('viewport: vec4<f32>');
      expect(WEBGPU_SDF_WGSL).toContain('stroke: vec4<f32>');

      const sampleRect: RectNode = {
        id: 'zc-rect',
        type: 'rect',
        name: 'ZeroCopy',
        x: 120,
        y: 240,
        width: 300,
        height: 150,
        rotation: 90,
        opacity: 1,
        visible: true,
        locked: false,
        style: {
          fill: '#ff0080',
          stroke: '#00ff80',
          strokeWidth: 3,
          radius: 14,
        },
      };
      const packed = packSceneToGpuBatches([sampleRect]);
      expect(packed.instanceCount).toBe(1);
      const d = packed.instanceData;
      // vec4 0: rect
      expect(d[0]).toBe(120);
      expect(d[1]).toBe(240);
      expect(d[2]).toBe(300);
      expect(d[3]).toBe(150);
      // vec4 1: fillRGBA
      expect(d[4]).toBeCloseTo(1, 3);
      expect(d[5]).toBeCloseTo(0, 3);
      expect(d[6]).toBeCloseTo(128 / 255, 3);
      expect(d[7]).toBeCloseTo(1, 3);
      // vec4 2: geom(radius, rotRad, strokeW, shapeKind)
      expect(d[8]).toBe(14);
      expect(d[9]).toBeCloseTo(Math.PI / 2, 4);
      expect(d[10]).toBe(3);
      expect(d[11]).toBe(0);
      // vec4 3: strokeRGBA
      expect(d[12]).toBeCloseTo(0, 3);
      expect(d[13]).toBeCloseTo(1, 3);
      expect(d[14]).toBeCloseTo(128 / 255, 3);
      expect(d[15]).toBeCloseTo(1, 3);

      // 1600% zoom on a 1440x900 document (23040x14400 CSS px) looking at a 90x60 viewport slice
      const proj = computeGpuViewportProjection(
        { x: 500, y: 300, width: 90, height: 60 },
        1440,
        900,
        1440 * 16,
        900 * 16,
        2,
      );
      // Includes 2px bleed on each side: [498..592] -> 94x64 doc units
      expect(proj.viewX).toBe(498);
      expect(proj.viewY).toBe(298);
      expect(proj.viewWidth).toBe(94);
      expect(proj.viewHeight).toBe(64);
      // Full native resolution (94 * 16 * 2 = 3008 <= 4096) — zero blur clamping!
      expect(proj.pixelWidth).toBe(3008);
      expect(proj.pixelHeight).toBe(2048);
      expect(proj.leftPct).toBeCloseTo((498 / 1440) * 100, 3);
      expect(proj.topPct).toBeCloseTo((298 / 900) * 100, 3);
      expect(proj.widthPct).toBeCloseTo((94 / 1440) * 100, 3);
      expect(proj.heightPct).toBeCloseTo((64 / 900) * 100, 3);
    });

    it('invalidates tile signatures when master ComponentDefinition revisions change and renders clip masks + inner shadows', () => {
      const tile = computeVisibleTileGrid({ x: 0, y: 0, width: 512, height: 512 }, 512, 512, 512)[0];
      const instance: ComponentInstanceNode = {
        id: 'inst-1',
        type: 'component-instance',
        name: 'Button Instance',
        componentId: 'comp-btn',
        x: 20,
        y: 20,
        width: 140,
        height: 44,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        overrides: {},
      };
      const baseMaster: ComponentDefinition = {
        id: 'comp-btn',
        name: 'Button',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        document: {
          id: 'doc-btn',
          name: 'Button',
          width: 140,
          height: 44,
          background: 'transparent',
          nodes: [],
        },
      };
      const sigV1 = computeTileSignature([instance], tile, 1, new Map([[baseMaster.id, baseMaster]]));
      const updatedMaster: ComponentDefinition = { ...baseMaster, updatedAt: '2026-01-02T00:00:00.000Z' };
      const sigV2 = computeTileSignature([instance], tile, 1, new Map([[updatedMaster.id, updatedMaster]]));
      expect(sigV2).not.toBe(sigV1);

      // Verify clipMaskMap clipping (rotated ellipse mask) + inner-shadow rendering on mock Canvas2D
      const calls: string[] = [];
      const mockCtx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        beginPath: () => calls.push('beginPath'),
        closePath: () => calls.push('closePath'),
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        rect: () => calls.push('rect'),
        ellipse: () => calls.push('ellipse'),
        clip: () => calls.push('clip'),
        fill: (rule?: string) => calls.push(`fill:${rule ?? 'nonzero'}`),
        stroke: () => calls.push('stroke'),
        translate: () => calls.push('translate'),
        rotate: () => calls.push('rotate'),
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        filter: 'none',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowBlur: 0,
        shadowColor: 'transparent',
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
      } as unknown as CanvasRenderingContext2D;

      const maskNode: EllipseNode = {
        id: 'mask-1',
        type: 'ellipse',
        name: 'Rotated Mask',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 30,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: '#ffffff', stroke: 'none', strokeWidth: 0 },
      };
      const maskedCard: RectNode = {
        id: 'card-masked',
        type: 'rect',
        name: 'Inner Shadow Card',
        x: 0,
        y: 0,
        width: 120,
        height: 120,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: '#1e293b', stroke: 'none', strokeWidth: 0, radius: 12 },
        effects: [
          { id: 'in-1', type: 'inner-shadow', x: 0, y: 2, blur: 6, spread: 0, color: 'rgba(0,0,0,0.45)', visible: true },
        ],
      };

      const renderCtx: RichNodeRenderContext = {
        allNodes: [maskNode, maskedCard],
        nodeById: new Map<string, DesignNode>([
          [maskNode.id, maskNode],
          [maskedCard.id, maskedCard],
        ]),
        clipMaskMap: new Map([[maskedCard.id, [maskNode.id]]]),
        frameClipMap: new Map(),
        components: [],
        componentById: new Map(),
      };
      renderRichNodeToContext2D(mockCtx, maskedCard, renderCtx);
      // Expect clip from clipMaskMap + clip + evenodd fill from inner-shadow
      expect(calls.filter((c) => c === 'clip').length).toBeGreaterThanOrEqual(2);
      expect(calls).toContain('fill:evenodd');
      expect(calls).toContain('rotate');
    });
  });
});

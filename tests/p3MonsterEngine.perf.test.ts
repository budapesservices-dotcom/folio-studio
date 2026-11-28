import { afterEach, describe, expect, it } from 'vitest';
import type { DesignNode, EllipseNode, RectNode, TextNode } from '../src/core/document/types';
import { FlatGridSpatialIndex, resetComputeKernels, type SpatialBoundsEntry } from '../src/core/kernels';
import {
  createWasmSpatialIndexKernel,
  type WasmAcceleratedSpatialIndex,
} from '../src/core/kernels/wasmSpatialKernel';
import { packSceneToGpuBatches } from '../src/engines/canvas/gpu/scenePacker';
import { GPU_INSTANCE_STRIDE_FLOATS } from '../src/engines/canvas/gpu/types';

function buildSyntheticNodes(count: number): DesignNode[] {
  const nodes: DesignNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % 100;
    const row = Math.floor(i / 100);
    const x = col * 140;
    const y = row * 100;

    if (i % 10 === 9) {
      const text: TextNode = {
        id: `perf-n-${i}`,
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
        id: `perf-n-${i}`,
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
        id: `perf-n-${i}`,
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('Prioritas 3 — Dedicated Serial Performance Microbenchmarks (run via npm run test:perf)', () => {
  afterEach(() => {
    resetComputeKernels();
  });

  it('queries 10,000 nodes through the WASM spatial index under strict latency budget', () => {
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

    const wasmIndex = wasmKernel!.buildIndex(entries) as WasmAcceleratedSpatialIndex;
    const flatIndex = new FlatGridSpatialIndex(entries);
    const rect = { minX: 480, minY: 360, maxX: 1680, maxY: 1260 };

    // Warm up JIT & linear memory upload
    const expectedHits = flatIndex.queryRect(rect);
    expect(wasmIndex.queryRect(rect)).toEqual(expectedHits);

    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const hits = wasmIndex.queryRect(rect);
      samples.push(performance.now() - start);
      expect(hits.length).toBe(expectedHits.length);
    }

    expect(median(samples)).toBeLessThan(25);
  });

  it('packs and culls 10,000 nodes into GPU Float32Array batches under strict latency budget', () => {
    const nodes = buildSyntheticNodes(10000);
    const scratch = new Float32Array(nodes.length * GPU_INSTANCE_STRIDE_FLOATS);
    const viewportRect = { x: 0, y: 0, width: 1440, height: 900 };

    // Warm up V8 JIT
    const warmup = packSceneToGpuBatches(nodes, { viewportRect, scratchBuffer: scratch });
    expect(warmup.culledNodes).toBeGreaterThan(9000);

    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const packed = packSceneToGpuBatches(nodes, { viewportRect, scratchBuffer: scratch });
      samples.push(packed.packMs);
      expect(packed.instanceCount).toBe(warmup.instanceCount);
    }

    expect(median(samples)).toBeLessThan(25);
  });
});

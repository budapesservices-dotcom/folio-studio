import { afterEach, describe, expect, it } from 'vitest';
import { createRectNode } from '../src/core/document/factory';
import type { DesignNode, GroupNode } from '../src/core/document/types';
import {
  FlatGridSpatialIndex,
  getComputeKernels,
  registerComputeKernel,
  resetComputeKernels,
  type SpatialBoundsEntry,
  type VectorGeometryKernel,
} from '../src/core/kernels';
import {
  CANVAS_VIEWPORT_CULL_THRESHOLD,
  buildSpatialIndexForNodes,
  cullVisibleRenderNodes,
} from '../src/engines/canvas/canvasHelpers';

afterEach(() => {
  resetComputeKernels();
});

describe('Compute Kernel Ports & FlatGridSpatialIndex', () => {
  it('queries points, rects, snap candidates, and oversized shapes accurately', () => {
    const entries: SpatialBoundsEntry[] = [
      { id: 'a', minX: 10, minY: 10, maxX: 90, maxY: 90, zIndex: 0 },
      { id: 'b', minX: 50, minY: 50, maxX: 150, maxY: 150, zIndex: 1 },
      { id: 'far', minX: 1800, minY: 1400, maxX: 1920, maxY: 1520, zIndex: 2 },
      // Oversized hero backdrop spanning many cells
      { id: 'backdrop', minX: 0, minY: 0, maxX: 3000, maxY: 2200, zIndex: 3 },
    ];

    const index = new FlatGridSpatialIndex(entries, 128);
    expect(index.count).toBe(4);
    expect(index.getBounds('b')).toEqual({ id: 'b', minX: 50, minY: 50, maxX: 150, maxY: 150, zIndex: 1 });
    expect(index.getBounds('missing')).toBeUndefined();

    // Point hits are ordered top-most (highest zIndex) first
    expect(index.queryPoint(70, 70)).toEqual(['backdrop', 'b', 'a']);
    expect(index.queryPoint(1850, 1450)).toEqual(['backdrop', 'far']);
    expect(index.queryPoint(5000, 5000)).toEqual([]);

    // Rect query returns hits in ascending zIndex render order
    expect(index.queryRect({ minX: 0, minY: 0, maxX: 120, maxY: 120 })).toEqual(['a', 'b', 'backdrop']);
    expect(index.queryRect({ minX: 1750, minY: 1350, maxX: 1950, maxY: 1550 })).toEqual(['far', 'backdrop']);

    // Snap candidates include nodes within margin around rect
    const snapNearA = index.querySnapCandidates({ minX: 95, minY: 95, maxX: 110, maxY: 110 }, 8);
    expect(snapNearA).toContain('a');
    expect(snapNearA).toContain('b');
    expect(snapNearA).not.toContain('far');
  });

  it('culls offscreen nodes above threshold while preserving selected nodes and parent/mask dependencies', () => {
    const nodes: DesignNode[] = [];
    const group: GroupNode = {
      id: 'offscreen-group',
      type: 'group',
      name: 'Offscreen Group',
      x: 4000,
      y: 4000,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };
    const maskBase: DesignNode = {
      ...createRectNode(0),
      id: 'offscreen-mask-base',
      name: 'Mask Base',
      parentId: group.id,
      x: 4010,
      y: 4010,
      width: 80,
      height: 80,
    };
    const selectedChild: DesignNode = {
      ...createRectNode(1),
      id: 'selected-child',
      name: 'Selected Child',
      parentId: group.id,
      clipMaskBaseId: maskBase.id,
      x: 4020,
      y: 4020,
      width: 60,
      height: 60,
    };
    nodes.push(group, maskBase, selectedChild);

    const totalGridNodes = CANVAS_VIEWPORT_CULL_THRESHOLD + 400;
    for (let i = 0; i < totalGridNodes; i += 1) {
      nodes.push({
        ...createRectNode(i),
        id: `grid-${i}`,
        name: `Grid ${i}`,
        x: (i % 25) * 160,
        y: Math.floor(i / 25) * 160,
        width: 100,
        height: 100,
      });
    }

    const spatialIndex = buildSpatialIndexForNodes(nodes);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const culled = cullVisibleRenderNodes(
      nodes,
      spatialIndex,
      { minX: 0, minY: 0, maxX: 600, maxY: 600 },
      ['selected-child'],
      nodeById,
    );

    expect(culled.length).toBeLessThan(nodes.length * 0.25);
    const keptIds = new Set(culled.map((node) => node.id));
    expect(keptIds.has('grid-0')).toBe(true);
    expect(keptIds.has('selected-child')).toBe(true);
    expect(keptIds.has('offscreen-mask-base')).toBe(true);
    expect(keptIds.has('offscreen-group')).toBe(true);
  });

  it('supports runtime registration and reset of WASM-ready kernel implementations', () => {
    const defaults = getComputeKernels();
    expect(defaults.spatial.backend).toBe('ts-default');
    expect(defaults.vector.backend).toBe('ts-default');
    expect(defaults.layout.backend).toBe('ts-default');

    let called = false;
    const mockWasmVector: VectorGeometryKernel = {
      ...defaults.vector,
      backend: 'wasm',
      applyPathfinder(nodes, operation, resultId) {
        called = true;
        return defaults.vector.applyPathfinder(nodes, operation, resultId);
      },
    };

    registerComputeKernel({ vector: mockWasmVector });
    expect(getComputeKernels().vector.backend).toBe('wasm');
    const a = { ...createRectNode(0), id: 'r1', x: 0, y: 0, width: 100, height: 100 };
    const b = { ...createRectNode(1), id: 'r2', x: 50, y: 50, width: 100, height: 100 };
    const united = getComputeKernels().vector.applyPathfinder([a, b], 'unite', 'out');
    expect(called).toBe(true);
    expect(united).not.toBeNull();

    resetComputeKernels();
    expect(getComputeKernels().vector.backend).toBe('ts-default');
  });
});

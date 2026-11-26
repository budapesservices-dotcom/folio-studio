import { describe, expect, it } from 'vitest';
import {
  buildBlendedFillPaint,
  convertLinearGradientTransitionStyle,
  detectLinearGradientTransitionStyle,
} from '../src/core/document/colorBlend';
import { createBlankProject } from '../src/core/document/factory';
import { isFillPaint } from '../src/core/document/styling';
import type { EllipseNode, PathNode, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  applyPathfinderOperation,
  applyShapeBuilderAction,
  combineNodesIntoSingleObject,
  decomposeNodesForShapeBuilder,
} from '../src/core/document/vector';
import { handleComputeWorkerMessage } from '../src/core/kernels/compute.worker';
import { DEFAULT_CANVAS_TOOL_OPTIONS } from '../src/core/tools/operationContract';
import { shapeBuilderTool } from '../src/engines/canvas/tools/shape-builder';

function makeRect(id: string, x: number, y: number, w: number, h: number, fill: string): RectNode {
  return {
    id,
    name: id,
    type: 'rect',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fill,
      stroke: '#00000000',
      strokeWidth: 0,
      radius: 0,
    },
  };
}

function makeEllipse(id: string, x: number, y: number, w: number, h: number, fill: string): EllipseNode {
  return {
    id,
    name: id,
    type: 'ellipse',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fill,
      stroke: '#00000000',
      strokeWidth: 0,
    },
  };
}

function makeOpenLine(id: string, x1: number, y1: number, x2: number, y2: number, stroke = '#111827'): PathNode {
  return {
    id,
    name: id,
    type: 'path',
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    closed: false,
    pathKind: 'line',
    points: [
      { id: `${id}-p0`, x: x1 - Math.min(x1, x2), y: y1 - Math.min(y1, y2), pointType: 'corner' },
      { id: `${id}-p1`, x: x2 - Math.min(x1, x2), y: y2 - Math.min(y1, y2), pointType: 'corner' },
    ],
    style: {
      fill: 'none',
      stroke,
      strokeWidth: 3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
  };
}

describe('Multi-color blending for Shape Builder, Pathfinder Unite, and Combine into 1 Object', () => {
  it('blends 2 different-colored overlapping shapes with smooth Linear gradient via Pathfinder Unite', () => {
    const left = makeRect('rect-left', 100, 100, 120, 120, '#8B7CF6');
    const right = makeRect('rect-right', 170, 100, 120, 120, '#F59E0B');

    const united = applyPathfinderOperation([left, right], 'unite', 'united-linear', {
      colorBlendMode: 'linear',
    });

    expect(united).not.toBeNull();
    expect(united!.style.fills).toHaveLength(1);
    const paint = united!.style.fills![0];
    expect(isFillPaint(paint)).toBe(true);
    expect(paint.type).toBe('linear-gradient');
    if (paint.type === 'linear-gradient') {
      expect(paint.angle).toBeCloseTo(90, 0);
      expect(paint.stops.map((s) => s.color.toUpperCase())).toEqual(['#8B7CF6', '#F59E0B']);
      expect(detectLinearGradientTransitionStyle(paint.stops)).toBe('linear');
    }

    const project = createBlankProject('Blend Test');
    project.pages[0].document.nodes = [united!];
    expect(validateProject(project).ok).toBe(true);
  });

  it('blends 2 different-colored shapes with crisp Sharp Split (hard stop) when mode is "hard"', () => {
    const top = makeEllipse('top-circle', 100, 80, 120, 120, '#EF4444');
    const bottom = makeEllipse('bottom-circle', 100, 150, 120, 120, '#3B82F6');

    const united = applyPathfinderOperation([top, bottom], 'unite', 'united-hard', {
      colorBlendMode: 'hard',
    });

    expect(united).not.toBeNull();
    const paint = united!.style.fills![0];
    expect(isFillPaint(paint)).toBe(true);
    expect(paint.type).toBe('linear-gradient');
    if (paint.type === 'linear-gradient') {
      // Top-to-bottom direction => 180deg
      expect(paint.angle).toBeCloseTo(180, 0);
      expect(paint.stops).toHaveLength(4);
      expect(paint.stops[0].color).toBe('#EF4444');
      expect(paint.stops[1].color).toBe('#EF4444');
      expect(paint.stops[2].color).toBe('#3B82F6');
      expect(paint.stops[3].color).toBe('#3B82F6');
      // Adjacent stops share exact sharp split midpoint
      expect(paint.stops[1].offset).toBeCloseTo(paint.stops[2].offset, 3);
      expect(paint.stops[1].offset).toBeGreaterThan(0.3);
      expect(paint.stops[1].offset).toBeLessThan(0.7);
      expect(detectLinearGradientTransitionStyle(paint.stops)).toBe('hard');
    }
  });

  it('keeps single flat color when shapes have the same color or when colorBlendMode is "single"', () => {
    const a = makeRect('same-a', 100, 100, 100, 100, '#22C55E');
    const b = makeRect('same-b', 150, 100, 100, 100, '#22C55E');

    const sameUnited = applyPathfinderOperation([a, b], 'unite', 'same-color', {
      colorBlendMode: 'linear',
    });
    expect(sameUnited).not.toBeNull();
    expect(sameUnited!.style.fills).toBeUndefined();
    expect(sameUnited!.style.fill.toUpperCase()).toBe('#22C55E');

    const c = makeRect('diff-c', 150, 100, 100, 100, '#F43F5E');
    const singleMode = applyPathfinderOperation([a, c], 'unite', 'single-mode', {
      colorBlendMode: 'single',
    });
    expect(singleMode).not.toBeNull();
    expect(singleMode!.style.fills).toBeUndefined();
    expect(singleMode!.style.fill.toUpperCase()).toBe('#22C55E');
  });

  it('applies Linear and Sharp Split color blending inside Shape Builder merge gestures', () => {
    const orbit = makeEllipse('orbit', 100, 100, 140, 140, '#B3A0E5');
    const sun = makeEllipse('sun', 180, 100, 140, 140, '#F4B27D');
    const { candidates, arrangement } = decomposeNodesForShapeBuilder([orbit, sun]);
    expect(arrangement.faces.length).toBeGreaterThanOrEqual(3);

    const allFaceIds = arrangement.faces.map((f) => f.id);
    let seq = 0;

    const linearResult = applyShapeBuilderAction(
      candidates,
      arrangement,
      allFaceIds,
      'merge',
      () => `sb-lin-${++seq}`,
      { colorBlendMode: 'linear' },
    );
    expect(linearResult).toHaveLength(1);
    const linearPaint = linearResult![0].style.fills?.[0];
    expect(linearPaint?.type).toBe('linear-gradient');
    if (linearPaint?.type === 'linear-gradient') {
      expect(linearPaint.stops.map((s) => s.color)).toEqual(['#B3A0E5', '#F4B27D']);
      expect(detectLinearGradientTransitionStyle(linearPaint.stops)).toBe('linear');
    }

    const hardResult = applyShapeBuilderAction(
      candidates,
      arrangement,
      allFaceIds,
      'merge',
      () => `sb-hard-${++seq}`,
      { colorBlendMode: 'hard' },
    );
    expect(hardResult).toHaveLength(1);
    const hardPaint = hardResult![0].style.fills?.[0];
    expect(hardPaint?.type).toBe('linear-gradient');
    if (hardPaint?.type === 'linear-gradient') {
      expect(hardPaint.stops).toHaveLength(4);
      expect(detectLinearGradientTransitionStyle(hardPaint.stops)).toBe('hard');
    }
  });

  it('threads toolOptions.colorBlendMode through shapeBuilderTool pointer drag end-to-end', () => {
    const left = makeRect('sb-left', 100, 100, 120, 120, '#6366F1');
    const right = makeRect('sb-right', 160, 100, 120, 120, '#EC4899');
    const baseCtx = {
      workspace: 'main' as const,
      document: { id: 'doc', name: 'Page', width: 800, height: 600, background: '#fff', nodes: [left, right] },
      nodes: [left, right],
      canvasNodes: [left, right],
      selectableNodes: [left, right],
      otherNodes: [],
      selectedNodeIds: [left.id, right.id],
      selectedNodes: [left, right],
      selectionBounds: { x: 100, y: 100, width: 180, height: 120 },
      zoom: 1,
      pan: { x: 0, y: 0 },
      viewportWidth: 1200,
      session: null,
      toolOptions: { ...DEFAULT_CANVAS_TOOL_OPTIONS, colorBlendMode: 'hard' as const },
    };

    const makePointer = (x: number, y: number) => ({
      pointerId: 1,
      button: 0,
      point: { x, y },
      clientX: x,
      clientY: y,
      viewportAnchor: { x: 0, y: 0 },
      targetNodeId: null,
      resizeHandle: null,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });

    const down = shapeBuilderTool.onPointerDown!(makePointer(120, 160), baseCtx);
    expect(down.session?.kind).toBe('shape-builder');

    const move = shapeBuilderTool.onPointerMove!(
      makePointer(250, 160),
      { ...baseCtx, session: down.session ?? null },
    );

    const up = shapeBuilderTool.onPointerUp!(
      makePointer(260, 160),
      { ...baseCtx, session: move.session ?? null },
    );

    expect(up.replaceNodes?.insertNodes).toHaveLength(1);
    const built = up.replaceNodes!.insertNodes[0] as PathNode;
    const paint = built.style.fills?.[0];
    expect(paint?.type).toBe('linear-gradient');
    if (paint?.type === 'linear-gradient') {
      expect(detectLinearGradientTransitionStyle(paint.stops)).toBe('hard');
      expect(paint.stops.map((s) => s.color)).toEqual(['#6366F1', '#6366F1', '#EC4899', '#EC4899']);
    }
  });

  it('combines 3+ overlapping and disjoint shapes of different colors into 1 single valid PathNode', () => {
    const r1 = makeRect('obj-1', 40, 100, 100, 100, '#EF4444');
    const r2 = makeRect('obj-2', 110, 100, 100, 100, '#F59E0B'); // overlaps r1
    const r3 = makeEllipse('obj-3', 320, 100, 100, 100, '#3B82F6'); // disjoint from r1 & r2

    const combinedLinear = combineNodesIntoSingleObject([r1, r2, r3], 'combined-3', {
      colorBlendMode: 'linear',
    });
    expect(combinedLinear).not.toBeNull();
    expect(combinedLinear!.type).toBe('path');
    expect(combinedLinear!.name).toBe('Combined Object');
    // Overlapping r1+r2 form 1 contour and disjoint r3 forms a subpath => 1 unified PathNode with subpaths
    expect((combinedLinear!.subpaths?.length ?? 0)).toBeGreaterThanOrEqual(1);
    expect(combinedLinear!.width).toBeGreaterThanOrEqual(370);
    const paint = combinedLinear!.style.fills?.[0];
    expect(paint?.type).toBe('linear-gradient');
    if (paint?.type === 'linear-gradient') {
      expect(paint.stops.map((s) => s.color)).toEqual(['#EF4444', '#F59E0B', '#3B82F6']);
    }

    const project = createBlankProject('Combine Test');
    project.pages[0].document.nodes = [combinedLinear!];
    expect(validateProject(project).ok).toBe(true);

    // Also verify Sharp Split for 3 colors
    const combinedHard = combineNodesIntoSingleObject([r1, r2, r3], 'combined-3-hard', {
      colorBlendMode: 'hard',
    });
    expect(combinedHard).not.toBeNull();
    const hardPaint = combinedHard!.style.fills?.[0];
    expect(hardPaint?.type).toBe('linear-gradient');
    if (hardPaint?.type === 'linear-gradient') {
      expect(hardPaint.stops).toHaveLength(6);
      expect(detectLinearGradientTransitionStyle(hardPaint.stops)).toBe('hard');
      expect(isFillPaint(hardPaint)).toBe(true);
    }
  });

  it('combines closed shapes together with open vector paths into 1 single compound PathNode', () => {
    const box = makeRect('box', 60, 60, 80, 80, '#8B7CF6');
    const line = makeOpenLine('line', 200, 80, 320, 140, '#111827');

    const combined = combineNodesIntoSingleObject([box, line], 'combined-mixed-path');
    expect(combined).not.toBeNull();
    expect(combined!.subpaths).toHaveLength(1);
    expect(combined!.subpaths![0].closed).toBe(false);

    const project = createBlankProject('Combined Open+Closed');
    project.pages[0].document.nodes = [combined!];
    expect(validateProject(project).ok).toBe(true);
  });

  it('converts an existing linear gradient back and forth between Linear and Sharp Split cleanly', () => {
    const paint = buildBlendedFillPaint(
      [
        { color: '#8B7CF6', opacity: 1, cx: 100, cy: 100 },
        { color: '#F59E0B', opacity: 1, cx: 220, cy: 100 },
      ],
      { x: 40, y: 40, width: 240, height: 120 },
      'linear',
    );
    expect(paint).not.toBeNull();
    expect(detectLinearGradientTransitionStyle(paint!.stops)).toBe('linear');

    const asHard = convertLinearGradientTransitionStyle(paint!, 'hard');
    expect(detectLinearGradientTransitionStyle(asHard.stops)).toBe('hard');
    expect(asHard.stops).toHaveLength(4);
    expect(asHard.angle).toBe(paint!.angle);

    const backToLinear = convertLinearGradientTransitionStyle(asHard, 'linear');
    expect(detectLinearGradientTransitionStyle(backToLinear.stops)).toBe('linear');
    expect(backToLinear.stops).toHaveLength(2);
    expect(backToLinear.stops.map((s) => s.color)).toEqual(['#8B7CF6', '#F59E0B']);
  });

  it('forwards colorBlendMode through compute.worker.ts for 3+ shape Pathfinder Unite jobs', () => {
    const a = makeRect('w1', 100, 100, 100, 100, '#10B981');
    const b = makeRect('w2', 160, 100, 100, 100, '#3B82F6');
    const c = makeRect('w3', 220, 100, 100, 100, '#A855F7');

    const res = handleComputeWorkerMessage({
      id: 42,
      type: 'vector.pathfinder',
      nodes: [a, b, c],
      operation: 'unite',
      resultId: 'worker-united',
      colorBlendMode: 'hard',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const node = (res.payload as { node: PathNode | null }).node;
      expect(node).not.toBeNull();
      const paint = node!.style.fills?.[0];
      expect(paint?.type).toBe('linear-gradient');
      if (paint?.type === 'linear-gradient') {
        expect(detectLinearGradientTransitionStyle(paint.stops)).toBe('hard');
        expect(paint.stops).toHaveLength(6);
      }
    }
  });

  it('prunes absorbed inner contours and keeps fillRule nonzero when uniting or combining nested shapes', () => {
    const outer = makeRect('outer-card', 100, 100, 300, 400, '#D8C6AD');
    const middle = makeEllipse('mid-orbit', 150, 150, 180, 180, '#B3A0E5');
    const inner = makeEllipse('inner-sun', 200, 200, 80, 80, '#F4B27D');

    const combined = combineNodesIntoSingleObject([outer, middle, inner], 'nested-combined', {
      colorBlendMode: 'hard',
    });
    expect(combined).not.toBeNull();
    expect(combined!.style.fillRule).toBe('nonzero');
    expect(combined!.subpaths ?? []).toHaveLength(0);
    expect(combined!.style.fills?.[0]?.type).toBe('linear-gradient');

    const united = applyPathfinderOperation([middle, inner], 'unite', 'nested-united', {
      colorBlendMode: 'linear',
    });
    expect(united).not.toBeNull();
    expect(united!.style.fillRule).toBe('nonzero');
    expect(united!.subpaths ?? []).toHaveLength(0);
    expect(united!.style.fills?.[0]?.type).toBe('linear-gradient');
  });
});


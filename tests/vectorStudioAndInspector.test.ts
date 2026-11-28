import { describe, expect, it } from 'vitest';
import { createEllipseNode, createRectNode } from '../src/core/document/factory';
import type { PathNode, RectNode } from '../src/core/document/types';
import {
  applyPathfinderOperation,
  convertAllPathAnchors,
  convertShapeToPathNode,
  divideNodesWithPathfinder,
  offsetPathNode,
  reversePathNode,
} from '../src/core/document/vector';
import {
  alignNodeToArtboard,
  computeArrangeMoveSpec,
  computePositionPatchForOrigin,
  computeResizePatchForOrigin,
  computeStepAndRepeatClones,
  extractDocumentSwatches,
  getAnchorCoordinates,
  STUDIO_COLOR_SWATCHES,
} from '../src/app/workspace/inspectorVectorHelpers';

const RAW_STUDIO_FILES = import.meta.glob<string>('../src/app/workspace/InspectorVectorStudioSection.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function makeBox(id: string, x: number, y: number, width: number, height: number, fill = '#3B82F6'): RectNode {
  const base = createRectNode(0);
  return {
    ...base,
    id,
    name: id,
    x,
    y,
    width,
    height,
    style: { ...base.style, fill, stroke: '#0F172A', strokeWidth: 2, radius: 0 },
  };
}

describe('Adobe Illustrator & CorelDRAW vector shaping engine (src/core/document/vector.ts)', () => {
  it('supports Pathfinder Minus Back (keeps top shape minus back overlap)', () => {
    const back = makeBox('back', 0, 0, 100, 100, '#EF4444');
    const front = makeBox('front', 50, 0, 100, 100, '#10B981');

    const result = applyPathfinderOperation([back, front], 'minus-back', 'pf-minus-back');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('pf-minus-back');
    expect(result?.style.fill).toBe('#10B981');
    // Result should span only x in [100, 150], width ~50, height ~100
    expect(Math.round(result!.x)).toBe(100);
    expect(Math.round(result!.width)).toBe(50);
    expect(Math.round(result!.height)).toBe(100);
  });

  it('divides overlapping shapes into atomic planar vector regions', () => {
    const left = makeBox('left', 0, 0, 100, 100, '#3B82F6');
    const right = makeBox('right', 50, 0, 100, 100, '#F59E0B');

    let seq = 0;
    const regions = divideNodesWithPathfinder([left, right], () => `div-${++seq}`);
    expect(regions).not.toBeNull();
    // Two overlapping rectangles split into 3 disjoint planar faces: left-only, middle overlap, right-only
    expect(regions!.length).toBe(3);
    const totalArea = regions!.reduce((sum, node) => sum + node.width * node.height, 0);
    expect(Math.round(totalArea)).toBe(15000);
  });

  it('offsets closed paths outward and inward while guarding against inward collapse', () => {
    const rect = makeBox('rect', 40, 40, 100, 80, '#8B7CF6');

    const outward = offsetPathNode(rect, 10, 'off-out');
    expect(outward).not.toBeNull();
    expect(Math.round(outward!.x)).toBe(30);
    expect(Math.round(outward!.y)).toBe(30);
    expect(Math.round(outward!.width)).toBe(120);
    expect(Math.round(outward!.height)).toBe(100);

    const inward = offsetPathNode(rect, -10, 'off-in');
    expect(inward).not.toBeNull();
    expect(Math.round(inward!.x)).toBe(50);
    expect(Math.round(inward!.y)).toBe(50);
    expect(Math.round(inward!.width)).toBe(80);
    expect(Math.round(inward!.height)).toBe(60);

    // Extreme negative offset collapses cleanly to null instead of inverted geometry
    const collapsed = offsetPathNode(rect, -80, 'off-collapse');
    expect(collapsed).toBeNull();
  });

  it('reverses path anchor direction and swaps cubic Bezier handles', () => {
    const path: PathNode = {
      id: 'p1',
      type: 'path',
      name: 'Curve',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      closed: false,
      points: [
        { id: 'pt-1', x: 0, y: 0, handleOut: { x: 20, y: 0 }, pointType: 'corner' },
        { id: 'pt-2', x: 100, y: 50, handleIn: { x: 80, y: 50 }, pointType: 'corner' },
      ],
      style: { fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, arrowEnd: true },
    };

    const reversed = reversePathNode(path);
    expect(reversed.points[0].x).toBe(100);
    expect(reversed.points[0].y).toBe(50);
    expect(reversed.points[0].handleOut).toEqual({ x: 80, y: 50 });
    expect(reversed.points[1].x).toBe(0);
    expect(reversed.points[1].handleIn).toEqual({ x: 20, y: 0 });
  });

  it('converts all path anchors between smooth Bezier curves and sharp corners', () => {
    const rectPath = convertShapeToPathNode(makeBox('box', 0, 0, 100, 100))!;
    expect(rectPath).toBeTruthy();

    const smoothed = convertAllPathAnchors(rectPath, 'smooth');
    expect(smoothed.points.every((pt) => pt.pointType === 'smooth' && Boolean(pt.handleIn) && Boolean(pt.handleOut))).toBe(true);

    const sharpened = convertAllPathAnchors(smoothed, 'corner');
    expect(sharpened.points.every((pt) => pt.pointType === 'corner' && !pt.handleIn && !pt.handleOut)).toBe(true);
  });
});

describe('Inspector Vector Studio pure helpers (inspectorVectorHelpers.ts)', () => {
  it('computes 9-point reference origin coordinates and pins anchor during W/H resize', () => {
    const node = { x: 100, y: 200, width: 80, height: 40 };

    expect(getAnchorCoordinates(node, 'tl')).toEqual({ x: 100, y: 200 });
    expect(getAnchorCoordinates(node, 'c')).toEqual({ x: 140, y: 220 });
    expect(getAnchorCoordinates(node, 'br')).toEqual({ x: 180, y: 240 });

    // Moving center X to 200 places top-left X at 160
    expect(computePositionPatchForOrigin(node, 'c', 'x', 200)).toEqual({ x: 160 });

    // Resizing from Center (140, 220) to 120×60 keeps center pinned at (140, 220)
    const centerResize = computeResizePatchForOrigin(node, 'c', 120, 60);
    expect(centerResize).toEqual({ x: 80, y: 190, width: 120, height: 60 });
    expect(getAnchorCoordinates(centerResize, 'c')).toEqual({ x: 140, y: 220 });

    // Resizing from Bottom-Right (180, 240) to 100×80 keeps BR pinned at (180, 240)
    const brResize = computeResizePatchForOrigin(node, 'br', 100, 80);
    expect(brResize).toEqual({ x: 80, y: 160, width: 100, height: 80 });
    expect(getAnchorCoordinates(brResize, 'br')).toEqual({ x: 180, y: 240 });
  });

  it('aligns a single node accurately to active artboard bounds', () => {
    const node = makeBox('n1', 35, 45, 100, 60);
    expect(alignNodeToArtboard(node, 1440, 900, 'left').x).toBe(0);
    expect(alignNodeToArtboard(node, 1440, 900, 'horizontal-center').x).toBe(670);
    expect(alignNodeToArtboard(node, 1440, 900, 'right').x).toBe(1340);
    expect(alignNodeToArtboard(node, 1440, 900, 'top').y).toBe(0);
    expect(alignNodeToArtboard(node, 1440, 900, 'vertical-center').y).toBe(420);
    expect(alignNodeToArtboard(node, 1440, 900, 'bottom').y).toBe(840);
  });

  it('computes exact Arrange Z-Order move specs for Front, Forward, Backward, and Back', () => {
    const nodes = [
      makeBox('bottom', 0, 0, 50, 50),
      makeBox('middle', 10, 10, 50, 50),
      makeBox('top', 20, 20, 50, 50),
    ];

    expect(computeArrangeMoveSpec(nodes, ['bottom'], 'front')).toEqual({
      nodeIds: ['bottom'],
      targetId: 'top',
      position: 'before',
    });
    expect(computeArrangeMoveSpec(nodes, ['bottom'], 'forward')).toEqual({
      nodeIds: ['bottom'],
      targetId: 'middle',
      position: 'before',
    });
    expect(computeArrangeMoveSpec(nodes, ['top'], 'backward')).toEqual({
      nodeIds: ['top'],
      targetId: 'middle',
      position: 'after',
    });
    expect(computeArrangeMoveSpec(nodes, ['top'], 'back')).toEqual({
      nodeIds: ['top'],
      targetId: 'bottom',
      position: 'after',
    });
    expect(computeArrangeMoveSpec(nodes, ['top'], 'front')).toBeNull();
    expect(computeArrangeMoveSpec(nodes, ['bottom'], 'back')).toBeNull();
  });

  it('generates progressive Step & Repeat clones with X/Y offset and incremental rotation', () => {
    const base = makeBox('item', 10, 20, 40, 40);
    const clones = computeStepAndRepeatClones([base], ['item'], {
      copies: 3,
      offsetX: 50,
      offsetY: 15,
      rotateDeg: 30,
    });
    expect(clones).toHaveLength(3);
    expect(clones.map((c) => ({ x: c.x, y: c.y, rotation: c.rotation }))).toEqual([
      { x: 60, y: 35, rotation: 30 },
      { x: 110, y: 50, rotation: 60 },
      { x: 160, y: 65, rotation: 90 },
    ]);
  });

  it('extracts unique document swatches and exposes studio palette presets', () => {
    const rect = makeBox('a', 0, 0, 50, 50, '#8b7cf6');
    const ellipse = { ...createEllipseNode(1), id: 'b', style: { fill: '#10b981', stroke: '#8b7cf6', strokeWidth: 2 } };
    const swatches = extractDocumentSwatches([rect, ellipse]);
    expect(swatches).toEqual(['#8B7CF6', '#0F172A', '#10B981']);
    expect(STUDIO_COLOR_SWATCHES.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps InspectorVectorStudioSection strictly decoupled from Canvas engine and reducer/store internals', () => {
    const source = RAW_STUDIO_FILES['../src/app/workspace/InspectorVectorStudioSection.tsx'];
    expect(source).toBeTruthy();
    expect(source).not.toMatch(/engines\/canvas\/Canvas/);
    expect(source).not.toMatch(/engines\/canvas\/tools\//);
    expect(source).not.toMatch(/editorReducer/);
    expect(source).not.toMatch(/editorStore/);
    expect(source).not.toMatch(/\bdispatchLegacyAction\s*\(/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import {
  createEmptyDocument,
  createFrameNode,
  createRectNode,
  createVectorPathNode,
} from '../src/core/document/factory';
import { getEffectiveLayerStates } from '../src/core/document/layers';
import type { DesignNode, GroupNode, PathNode } from '../src/core/document/types';
import { buildSpatialIndexForNodes } from '../src/engines/canvas/canvasHelpers';
import {
  areSnapGuidesEqual,
  getNodeWorldGeometry,
  getWorldBounds,
  solveResizeSnap,
  solveTranslationSnap,
  type SnapGuide,
  type SnapLockState,
} from '../src/engines/canvas/snappingEngine';
import { CanvasInteractiveOverlays, type CanvasInteractiveOverlaysProps } from '../src/engines/canvas/CanvasOverlays';
import { selectTool } from '../src/engines/canvas/tools/select';
import { DEFAULT_CANVAS_TOOL_OPTIONS, type CanvasToolContext, type CanvasToolPointerInput } from '../src/engines/canvas/tools/types';

function makeRect(id: string, x: number, y: number, width: number, height: number, extra: Partial<DesignNode> = {}): DesignNode {
  return {
    ...createRectNode(),
    id,
    name: id,
    x,
    y,
    width,
    height,
    ...extra,
  } as DesignNode;
}

function makeDiamondPath(id: string, x: number, y: number, size: number): PathNode {
  const half = size / 2;
  return createVectorPathNode(
    [
      { id: `${id}-p0`, x: x + half, y, pointType: 'corner' },
      { id: `${id}-p1`, x: x + size, y: y + half, pointType: 'corner' },
      { id: `${id}-p2`, x: x + half, y: y + size, pointType: 'corner' },
      { id: `${id}-p3`, x, y: y + half, pointType: 'corner' },
    ],
    { id, name: id, closed: true },
  );
}

function buildSceneIndex(nodes: readonly DesignNode[]) {
  const spatialIndex = buildSpatialIndexForNodes(nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layerStates = getEffectiveLayerStates(nodes);
  return { spatialIndex, nodeById, layerStates };
}

function makePointer(
  point: { x: number; y: number },
  overrides: Partial<CanvasToolPointerInput> = {},
): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point,
    clientX: point.x,
    clientY: point.y,
    viewportAnchor: point,
    targetNodeId: null,
    resizeHandle: null,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('Unified Snapping Engine — Accuracy', () => {
  it('snaps edge-to-edge cleanly without sub-pixel gap', () => {
    const moving = makeRect('moving', 50, 100, 100, 80);
    const target = makeRect('target', 250, 100, 100, 80);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([moving, target]);

    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 96, // raw right edge = 246, target left edge = 250 (4px away)
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(moving.x + res.dx + moving.width).toBe(target.x);
    expect(res.guides.some((g) => g.axis === 'x' && g.position === 250)).toBe(true);
  });

  it('snaps vertex-to-vertex with exact 2D coupled correction and vertex marker', () => {
    const moving = makeRect('moving', 0, 0, 80, 60);
    const target = makeRect('target', 200, 200, 100, 100);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([moving, target]);

    // Move bottom-right corner (80, 60) -> (197, 196), within 5px of target top-left (200, 200)
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 117,
      dy: 136,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(moving.x + res.dx + moving.width).toBe(200);
    expect(moving.y + res.dy + moving.height).toBe(200);
    expect(res.guides.some((g) => g.kind === 'geometry' && g.marker?.x === 200 && g.marker?.y === 200)).toBe(true);
  });

  it('snaps vertex-to-edge on a slanted path edge using world-space projection', () => {
    const diamond = makeDiamondPath('diamond', 200, 100, 100);
    // Top-right edge of diamond goes from (250, 100) to (300, 150) — midpoint is (275, 125)
    const moving = makeRect('moving', 0, 0, 40, 40);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([diamond, moving]);

    // Move bottom-left corner (0, 40) to (277, 123) — 2.83px perpendicular to midpoint (275, 125)
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 277,
      dy: 83,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    const snappedCornerX = moving.x + res.dx;
    const snappedCornerY = moving.y + res.dy + moving.height;
    // Must lie on line x - y = 150 (passing through (250,100) and (300,150))
    expect(Math.abs((snappedCornerX - snappedCornerY) - 150)).toBeLessThan(0.01);
    expect(res.guides.some((g) => g.axis === 'diagonal')).toBe(true);
  });

  it('computes rotated world geometry accurately and snaps to rotated object bounds and edges', () => {
    const rotated = makeRect('rot', 200, 200, 100, 100, { rotation: 45 });
    const geom = getNodeWorldGeometry(rotated);
    // 100x100 rotated 45deg around center (250, 250) has half-diagonal ~70.7107
    const expectedHalfDiag = Math.SQRT2 * 50;
    expect(geom.worldBounds.x).toBeCloseTo(250 - expectedHalfDiag, 3);
    expect(geom.worldBounds.width).toBeCloseTo(expectedHalfDiag * 2, 3);

    const moving = makeRect('moving', 0, 220, 40, 40);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([rotated, moving]);
    const targetLeft = geom.worldBounds.x; // ~179.29
    // Place moving right edge 4px left of rotated object's world leftmost vertex
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: targetLeft - 40 - 4,
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(moving.x + res.dx + moving.width).toBeCloseTo(targetLeft, 2);
  });

  it('snaps along extended diagonal direction as a single vector correction without conflicting orthogonal snap', () => {
    const slanted = makeDiamondPath('slanted', 100, 100, 100);
    // Edge from (150, 100) to (200, 150) extends along line x - y = 50 -> passes through (260, 210)
    const moving = makeRect('moving', 0, 0, 40, 40);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([slanted, moving]);

    // Move top-left vertex of moving to (262, 208), ~2.83px perpendicular to extended diagonal line
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 262,
      dy: 208,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(res.guides.some((g) => g.axis === 'diagonal')).toBe(true);
    // Verify top-left vertex snapped onto x - y = 50
    expect(Math.abs((res.dx - res.dy) - 50)).toBeLessThan(0.05);
    // Single diagonal guide, not conflicting orthogonal guides
    expect(res.guides.every((g) => g.axis === 'diagonal')).toBe(true);
  });

  it('snaps to deduplicated fractional guides (1/4, 1/3, 1/2, 2/3, 3/4) on X and Y', () => {
    const artboard = { x: 0, y: 0, width: 1200, height: 900 };
    const moving = makeRect('moving', 10, 10, 70, 50);
    const fractions: Array<{ ratio: number; label: string }> = [
      { ratio: 0.25, label: '1/4' },
      { ratio: 1 / 3, label: '1/3' },
      { ratio: 0.5, label: '1/2' },
      { ratio: 2 / 3, label: '2/3' },
      { ratio: 0.75, label: '3/4' },
    ];

    for (const frac of fractions) {
      const targetX = artboard.width * frac.ratio;
      const targetY = artboard.height * frac.ratio;
      const res = solveTranslationSnap({
        movingNodes: [moving],
        dx: targetX - moving.x - 4,
        dy: targetY - moving.y + 3,
        artboard,
        otherNodes: [],
        canvasUnitsPerPixel: 1,
      });

      expect(moving.x + res.dx).toBeCloseTo(targetX, 2);
      expect(moving.y + res.dy).toBeCloseTo(targetY, 2);
      const xGuides = res.guides.filter((g) => g.axis === 'x' && g.kind === 'fractional');
      const yGuides = res.guides.filter((g) => g.axis === 'y' && g.kind === 'fractional');
      expect(xGuides).toHaveLength(1);
      expect(yGuides).toHaveLength(1);
      expect(xGuides[0].label).toBe(frac.label);
      expect(yGuides[0].label).toBe(frac.label);
    }
  });

  it('snaps mirror padding inside a parent container honoring layout.padding', () => {
    const container = {
      ...createFrameNode(),
      id: 'card',
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      layout: {
        mode: 'none' as const,
        direction: 'column' as const,
        gap: 0,
        padding: { top: 20, right: 40, bottom: 20, left: 20 },
      },
    };
    // Content area X = 120..460 (width 340, center = 290); Y = 120..380 (height 260, center = 250)
    const child = makeRect('child', 120, 120, 100, 60, { parentId: 'card' });
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([container, child]);

    // Mirror X left = 120 + (340 - 100)/2 = 240 (gap 120 on both sides of content box)
    // Mirror Y top  = 120 + (260 - 60)/2 = 220 (gap 100 on both sides of content box)
    const res = solveTranslationSnap({
      movingNodes: [child],
      dx: 120 - 4, // raw left = 236 -> snaps to 240
      dy: 100 + 3, // raw top = 223 -> snaps to 220
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(child.x + res.dx).toBe(240);
    expect(child.y + res.dy).toBe(220);
    const mirrorX = res.guides.find((g) => g.axis === 'x' && g.kind === 'mirror-padding');
    expect(mirrorX).toBeDefined();
    expect(mirrorX?.spacingSegments?.map((s) => s.value)).toEqual([120, 120]);
  });

  it('snaps equal spacing between two peers and when extending an adjacent gap without mutating peers', () => {
    const a = makeRect('a', 100, 100, 80, 60); // 100..180
    const b = makeRect('b', 340, 100, 80, 60); // 340..420
    // Space between a and b is 160px. Moving 60px wide -> equal gap is 50px -> target left = 230
    const mid = makeRect('mid', 0, 100, 60, 60);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([a, b, mid]);

    const resBetween = solveTranslationSnap({
      movingNodes: [mid],
      dx: 226, // 4px off from 230
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(mid.x + resBetween.dx).toBe(230);
    const spacingGuide = resBetween.guides.find((g) => g.axis === 'x' && g.kind === 'spacing');
    expect(spacingGuide).toBeDefined();
    expect(spacingGuide?.spacingSegments?.map((s) => s.value)).toEqual([50, 50]);
    // Ensure reference peers were never mutated
    expect(a.x).toBe(100);
    expect(b.x).toBe(340);

    // Extending gap to the right: [a] --30px-- [b2] --30px-- [third]
    const b2 = makeRect('b2', 210, 100, 80, 60); // gap(a, b2) = 30 -> next left = 290 + 30 = 320
    const third = makeRect('third', 350, 100, 80, 60);
    const idx2 = buildSceneIndex([a, b2, third]);
    const resExtend = solveTranslationSnap({
      movingNodes: [third],
      dx: -26, // raw left = 324 -> snaps to 320
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex: idx2.spatialIndex,
      nodeById: idx2.nodeById,
      layerStates: idx2.layerStates,
      canvasUnitsPerPixel: 1,
    });
    expect(third.x + resExtend.dx).toBe(320);
    expect(resExtend.guides.find((g) => g.axis === 'x' && g.kind === 'spacing')?.spacingSegments?.map((s) => s.value)).toEqual([30, 30]);
  });

  it('snaps multi-selection and groups with many children without self-snapping to descendants', () => {
    const group: GroupNode = {
      id: 'grp',
      name: 'Group',
      type: 'group',
      x: 50,
      y: 50,
      width: 200,
      height: 120,
      rotation: 0,
      visible: true,
      locked: false,
      onCanvas: true,
      opacity: 1,
    };
    const children: DesignNode[] = Array.from({ length: 15 }, (_, i) =>
      makeRect(`grp-child-${i}`, 60 + i * 8, 60 + (i % 4) * 20, 24, 24, { parentId: 'grp' }),
    );
    const external = makeRect('external', 400, 50, 100, 120);
    const allNodes = [group, ...children, external];
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex(allNodes);

    // Drag group slightly by +3px — if descendants were not excluded, it would snap back to a child!
    const resNoSelfSnap = solveTranslationSnap({
      movingNodes: [group],
      dx: 3,
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      allNodes,
      canvasUnitsPerPixel: 1,
    });
    expect(resNoSelfSnap.dx).toBe(3);

    // Now drag group so its right edge (250 + dx) approaches external left edge (400)
    const resExternal = solveTranslationSnap({
      movingNodes: [group],
      dx: 146, // raw right = 396 -> snaps to 400
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      allNodes,
      canvasUnitsPerPixel: 1,
    });
    expect(group.x + resExternal.dx + group.width).toBe(400);

    // Multi-selection shared bounds
    const m1 = makeRect('m1', 10, 10, 50, 50);
    const m2 = makeRect('m2', 90, 40, 60, 40); // combined bounds: x=10..150, y=10..80
    const target = makeRect('t', 300, 10, 50, 50);
    const resMulti = solveTranslationSnap({
      movingNodes: [m1, m2],
      dx: 147, // raw right = 297 -> snaps to 300
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      otherNodes: [target],
      canvasUnitsPerPixel: 1,
    });
    expect(150 + resMulti.dx).toBe(300);
  });

  it('respects Main Canvas responsive breakpoint effectiveDocWidth and Component Canvas mirror padding', () => {
    // Main Canvas in mobile breakpoint (effectiveDocWidth = 390 instead of desktop 1280)
    const mobileNode = makeRect('mob', 20, 40, 100, 60);
    const resMainMobile = solveTranslationSnap({
      movingNodes: [mobileNode],
      dx: 129, // raw center = 199 -> mobile 1/2 center = 195 (4px away!)
      dy: 0,
      artboard: { x: 0, y: 0, width: 390, height: 844 },
      profile: 'main',
      otherNodes: [],
      canvasUnitsPerPixel: 1,
    });
    expect(mobileNode.x + resMainMobile.dx + mobileNode.width / 2).toBe(195);

    // Component Canvas profile enables mirror padding directly on component artboard root
    const compChild = makeRect('btn-label', 10, 10, 80, 32);
    const resComp = solveTranslationSnap({
      movingNodes: [compChild],
      dx: 62, // raw left = 72; component root width 220 -> mirror left = 70 (70px left/right)
      dy: 17, // raw top = 27; component root height 80 -> mirror top = 24 (24px top/bottom)
      artboard: { x: 0, y: 0, width: 220, height: 80 },
      profile: 'component',
      otherNodes: [],
      canvasUnitsPerPixel: 1,
    });
    expect(compChild.x + resComp.dx).toBe(70);
    expect(compChild.y + resComp.dy).toBe(24);
    expect(resComp.guides.some((g) => g.kind === 'mirror-padding')).toBe(true);
  });

  it('snaps resize bounds accurately on side handles and aspect-locked corner handles', () => {
    const node = makeRect('box', 100, 100, 100, 50);
    const target = makeRect('ref', 260, 100, 60, 60);
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([node, target]);

    const resEast = solveResizeSnap({
      bounds: { x: 100, y: 100, width: 100, height: 50 },
      handle: 'e',
      dx: 56, // right edge 256 -> snaps to 260
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      movingNodes: [node],
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });
    expect(resEast.dx).toBe(60);

    const resAspect = solveResizeSnap({
      bounds: { x: 100, y: 100, width: 100, height: 50 },
      handle: 'se',
      dx: 56,
      dy: 10,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      movingNodes: [node],
      lockAspect: true,
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });
    expect(resAspect.dx).toBe(60);
    expect(resAspect.guides).toHaveLength(1);
    expect(resAspect.guides[0].axis).toBe('x');
  });
});

describe('Unified Snapping Engine — Priority, Determinism & Hysteresis', () => {
  it('enforces priority hierarchy: Geometry > Alignment > Spacing > Fractional', () => {
    const artboard = { x: 0, y: 0, width: 1200, height: 800 }; // 1/2 X = 600
    // Distant alignment target at x = 602, touching geometry target at x = 605
    const alignTarget = makeRect('align-t', 602, 420, 80, 60);
    const geomTarget = makeRect('geom-t', 605, 100, 80, 80);
    const moving = makeRect('moving', 400, 100, 100, 80); // moving right edge = 500 + dx
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex([moving, alignTarget, geomTarget]);

    // Raw right edge = 601: distance to fractional(600)=1px, alignTarget(602)=1px, geomTarget(605)=4px
    // Geometry vertex/edge touching (605) MUST win over Alignment (602) and Fractional (600)!
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 101,
      dy: 0,
      artboard,
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });

    expect(moving.x + res.dx + moving.width).toBe(605);
    expect(res.guides.some((g) => g.kind === 'geometry')).toBe(true);
  });

  it('breaks equal-distance ties deterministically regardless of target array order', () => {
    const moving = makeRect('moving', 0, 100, 100, 50);
    const targetA = makeRect('node-alpha', 200, 300, 80, 50);
    const targetB = makeRect('node-beta', 208, 450, 80, 50);

    // Raw right edge = 204 (exact equidistant 4px from both 200 and 208)
    const resOrder1 = solveTranslationSnap({
      movingNodes: [moving],
      dx: 104,
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      otherNodes: [targetA, targetB],
      canvasUnitsPerPixel: 1,
    });
    const resOrder2 = solveTranslationSnap({
      movingNodes: [moving],
      dx: 104,
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      otherNodes: [targetB, targetA],
      canvasUnitsPerPixel: 1,
    });

    expect(resOrder1.dx).toBe(resOrder2.dx);
    expect(moving.x + resOrder1.dx + moving.width).toBe(200); // 'node-alpha' < 'node-beta'
  });

  it('maintains active snap lock within 12px release threshold and switches cleanly past 12px', () => {
    const moving = makeRect('moving', 0, 100, 100, 50);
    const target1 = makeRect('t1', 200, 300, 80, 50);
    const target2 = makeRect('t2', 220, 300, 80, 50);
    const artboard = { x: 0, y: 0, width: 1200, height: 800 };

    // Frame 1: enter t1 at raw right = 205 (dist = 5px <= 8px)
    const f1 = solveTranslationSnap({
      movingNodes: [moving],
      dx: 105,
      dy: 0,
      artboard,
      otherNodes: [target1, target2],
      canvasUnitsPerPixel: 1,
    });
    expect(moving.x + f1.dx + moving.width).toBe(200);
    expect(f1.nextLock?.x).toBeTruthy();

    // Frame 2: move to raw right = 211 (11px from t1 <= 12px release, 9px from t2) -> stays locked on t1!
    const f2 = solveTranslationSnap({
      movingNodes: [moving],
      dx: 111,
      dy: 0,
      artboard,
      otherNodes: [target1, target2],
      canvasUnitsPerPixel: 1,
      previousLock: f1.nextLock,
    });
    expect(moving.x + f2.dx + moving.width).toBe(200);

    // Frame 3: move to raw right = 213 (13px from t1 > 12px release, 7px from t2 <= 8px entry) -> switches to t2!
    const f3 = solveTranslationSnap({
      movingNodes: [moving],
      dx: 113,
      dy: 0,
      artboard,
      otherNodes: [target1, target2],
      canvasUnitsPerPixel: 1,
      previousLock: f2.nextLock,
    });
    expect(moving.x + f3.dx + moving.width).toBe(220);
  });

  it('keeps entry (8px) and release (12px) thresholds consistent across 25%–400% zoom and respects Ctrl/Meta bypass', () => {
    const moving = makeRect('moving', 0, 100, 100, 50);
    const target = makeRect('t', 400, 300, 80, 50);
    const artboard = { x: 0, y: 0, width: 2000, height: 1200 };

    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const unitsPerPx = 1 / zoom;
      // 7px screen distance should enter snap
      const enterDx = (400 - 100) - 7 * unitsPerPx;
      const enter = solveTranslationSnap({
        movingNodes: [moving],
        dx: enterDx,
        dy: 0,
        artboard,
        otherNodes: [target],
        canvasUnitsPerPixel: unitsPerPx,
      });
      expect(moving.x + enter.dx + moving.width).toBeCloseTo(400, 3);

      // 9px screen distance without prior lock should NOT enter snap
      const missDx = (400 - 100) - 9 * unitsPerPx;
      const miss = solveTranslationSnap({
        movingNodes: [moving],
        dx: missDx,
        dy: 0,
        artboard,
        otherNodes: [target],
        canvasUnitsPerPixel: unitsPerPx,
      });
      expect(miss.dx).toBeCloseTo(missDx, 3);

      // 11px screen distance WITH prior lock MUST hold lock (< 12px release)
      const holdDx = (400 - 100) - 11 * unitsPerPx;
      const hold = solveTranslationSnap({
        movingNodes: [moving],
        dx: holdDx,
        dy: 0,
        artboard,
        otherNodes: [target],
        canvasUnitsPerPixel: unitsPerPx,
        previousLock: enter.nextLock,
      });
      expect(moving.x + hold.dx + moving.width).toBeCloseTo(400, 3);

      // 13px screen distance WITH prior lock MUST release (> 12px release)
      const releaseDx = (400 - 100) - 13 * unitsPerPx;
      const released = solveTranslationSnap({
        movingNodes: [moving],
        dx: releaseDx,
        dy: 0,
        artboard,
        otherNodes: [target],
        canvasUnitsPerPixel: unitsPerPx,
        previousLock: hold.nextLock,
      });
      expect(released.dx).toBeCloseTo(releaseDx, 3);
    }

    // Ctrl/Meta bypass returns exact raw delta and clears lock
    const bypassed = solveTranslationSnap({
      movingNodes: [moving],
      dx: 298,
      dy: 0,
      artboard,
      otherNodes: [target],
      canvasUnitsPerPixel: 1,
      bypass: true,
    });
    expect(bypassed.dx).toBe(298);
    expect(bypassed.guides).toHaveLength(0);
    expect(bypassed.nextLock).toBeNull();
  });

  it('produces zero jitter and zero coordinate drift across oscillating micro-drags', () => {
    const moving = makeRect('moving', 50, 100, 100, 60);
    const target = makeRect('t', 300, 100, 100, 60);
    const artboard = { x: 0, y: 0, width: 1200, height: 800 };
    let lock: SnapLockState | null = null;

    // Oscillate raw pointer delta around the snap threshold (144..156 -> right edge 294..306)
    const oscillatingDeltas = [146, 148, 152, 155, 158, 154, 149, 144, 142, 147, 151, 150];
    const results: number[] = [];
    for (const rawDx of oscillatingDeltas) {
      const res = solveTranslationSnap({
        movingNodes: [moving],
        dx: rawDx,
        dy: 0,
        artboard,
        otherNodes: [target],
        canvasUnitsPerPixel: 1,
        previousLock: lock,
      });
      lock = res.nextLock;
      results.push(moving.x + res.dx + moving.width);
    }

    // All frames stayed locked stably at 300 without any oscillation or cumulative drift!
    expect(results.every((r) => r === 300)).toBe(true);
  });

  it('respects Shift axis-lock so orthogonal axis receives zero snap correction', () => {
    const moving = makeRect('moving', 0, 103, 80, 60);
    const target = makeRect('t', 200, 100, 80, 60);
    const res = solveTranslationSnap({
      movingNodes: [moving],
      dx: 117,
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      otherNodes: [target],
      lockAxis: 'x',
      canvasUnitsPerPixel: 1,
    });
    expect(moving.x + res.dx + moving.width).toBe(200);
    expect(res.dy).toBe(0);
  });
});

describe('Unified Snapping Engine — FlatGridSpatialIndex & Edge Cases', () => {
  it('handles oversized objects, cell-boundary crossings, negative coords, and off-viewport targets via querySnapCandidates', () => {
    const oversized = makeRect('oversized', 0, 0, 1600, 1200); // spans >16 grid cells (oversized list)
    const boundaryCrossing = makeRect('cross', 240, 240, 40, 40); // crosses 256px FlatGrid cell boundary
    const negativeObj = makeRect('neg', -320, -180, 80, 60); // negative pasteboard coords
    const moving = makeRect('moving', -100, -180, 60, 60);
    const allNodes = [oversized, boundaryCrossing, negativeObj, moving];
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex(allNodes);

    const spy = vi.spyOn(spatialIndex, 'querySnapCandidates');

    // Snap near negative-coord object
    const resNeg = solveTranslationSnap({
      movingNodes: [moving],
      dx: -136, // raw left = -236, negativeObj right = -240 (4px away)
      dy: 0,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });
    expect(spy).toHaveBeenCalled();
    expect(moving.x + resNeg.dx).toBe(-240);

    // Snap near cell-boundary crossing object
    const resBoundary = solveTranslationSnap({
      movingNodes: [moving],
      dx: 384, // raw left = 284, boundaryCrossing right = 280 (4px away)
      dy: 420,
      artboard: { x: 0, y: 0, width: 1200, height: 800 },
      spatialIndex,
      nodeById,
      layerStates,
      canvasUnitsPerPixel: 1,
    });
    expect(moving.x + resBoundary.dx).toBe(280);
  });

  it('reuses static spatial index with zero rebuilds across drag session frames', () => {
    const doc = createEmptyDocument('drag-test', 1200, 800);
    const n1 = makeRect('n1', 40, 40, 100, 80);
    const n2 = makeRect('n2', 300, 40, 100, 80);
    doc.nodes = [n1, n2];
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex(doc.nodes);
    const querySpy = vi.spyOn(spatialIndex, 'querySnapCandidates');

    const baseCtx: CanvasToolContext = {
      document: doc,
      canvasNodes: doc.nodes,
      selectableNodes: doc.nodes,
      otherNodes: doc.nodes,
      selectedNodeIds: [n1.id],
      selectedNodes: [n1],
      selectionBounds: { x: 40, y: 40, width: 100, height: 80 },
      zoom: 1,
      canvasUnitsPerPixel: 1,
      effectiveDocWidth: doc.width,
      spatialIndex,
      staticNodeById: nodeById,
      layerStates,
      pan: { x: 0, y: 0 },
      viewportWidth: doc.width,
      session: null,
      workspace: 'main',
    };

    const down = selectTool.onPointerDown(makePointer({ x: 80, y: 80 }, { targetNodeId: n1.id }), baseCtx);
    let session = down.session ?? null;
    expect(session?.kind).toBe('select-transform');

    for (let step = 1; step <= 25; step += 1) {
      const move = selectTool.onPointerMove(
        makePointer({ x: 80 + step * 6.5, y: 80 }),
        { ...baseCtx, session },
      );
      if (move.session !== undefined) session = move.session;
    }

    // Same spatialIndex instance queried on every frame; never rebuilt!
    expect(querySpy.mock.calls.length).toBeGreaterThanOrEqual(25);

    const up = selectTool.onPointerUp(makePointer({ x: 242, y: 80 }), { ...baseCtx, session });
    expect(up.session).toBeNull();
    expect(up.guides).toEqual([]);
  });
});

describe('Unified Snapping Engine — Overlay Rendering & Cleanup', () => {
  it('renders axial, diagonal, vertex marker, and spacing guides with non-scaling stroke and pointer-events none, and cleans up without DOM leaks', () => {
    const guides: SnapGuide[] = [
      { axis: 'x', position: 200, x1: 200, y1: 50, x2: 200, y2: 320, kind: 'geometry', marker: { x: 200, y: 100, kind: 'vertex' } },
      { axis: 'diagonal', position: 50, x1: 150, y1: 100, x2: 250, y2: 200, kind: 'diagonal' },
      {
        axis: 'x',
        position: 350,
        x1: 350,
        y1: 80,
        x2: 350,
        y2: 240,
        kind: 'spacing',
        spacingSegments: [
          { x1: 200, y1: 150, x2: 300, y2: 150, value: 100, orientation: 'horizontal' },
          { x1: 400, y1: 150, x2: 500, y2: 150, value: 100, orientation: 'horizontal' },
        ],
      },
    ];

    const overlayProps: CanvasInteractiveOverlaysProps = {
      docWidth: 1200,
      docHeight: 800,
      invZoom: 1,
      toolId: 'select',
      toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
      toolSession: null,
      toolOverlay: null,
      selectedNodes: [],
      selectedPathNodes: [],
      selectionBounds: null,
      showSelectionBox: false,
      canResize: false,
      showVectorAnchors: false,
      vectorAnchorsInteractive: false,
      activeAnchor: null,
      previewCreateNodes: null,
      isolatedPreviewNodes: null,
      canvasNodes: [],
      components: [],
      assets: [],
      maskPrefix: 'test',
      clipMaskMap: new Map(),
      frameClipMap: new Map(),
      componentById: new Map(),
      assetById: new Map(),
      designTokens: undefined,
      shapeBuilderHoverArrangement: null,
      shapeBuilderHoveredFace: null,
      altHeld: false,
      shiftHeld: false,
      smartHandleNode: null,
      autoLayoutHandleContainer: null,
      hoveredAutoLayoutHandle: null,
      pivotPoint: null,
      spacingRedlines: null,
      pathSnapWorldPoint: null,
      hoverPoint: null,
      eyedropperLoupe: null,
      guides,
    };

    const findVNodes = (
      root: unknown,
      predicate: (vnode: VNode<Record<string, unknown>>) => boolean,
    ): Array<VNode<Record<string, unknown>>> => {
      const results: Array<VNode<Record<string, unknown>>> = [];
      const visit = (current: unknown) => {
        if (!current || typeof current !== 'object') return;
        if (Array.isArray(current)) {
          for (const item of current) visit(item);
          return;
        }
        const candidate = current as VNode<Record<string, unknown>>;
        if ('type' in candidate && 'props' in candidate) {
          if (predicate(candidate)) results.push(candidate);
          const props = candidate.props;
          if (props && 'children' in props) visit(props.children);
        }
      };
      visit(root);
      return results;
    };

    const isBaseGuideLine = (v: VNode<Record<string, unknown>>) =>
      v.type === 'line' && typeof v.props.class === 'string' && v.props.class.split(/\s+/).includes('canvas-guide');

    const treeActive = CanvasInteractiveOverlays(overlayProps);
    const renderedLines = findVNodes(treeActive, isBaseGuideLine);
    expect(renderedLines).toHaveLength(3);
    renderedLines.forEach((line) => {
      expect(line.props['vector-effect']).toBe('non-scaling-stroke');
      expect(line.props['pointer-events']).toBe('none');
    });
    const markers = findVNodes(
      treeActive,
      (v) => v.type === 'circle' && v.props.class === 'canvas-guide-marker',
    );
    expect(markers).toHaveLength(1);
    const spacingLines = findVNodes(
      treeActive,
      (v) => v.type === 'line' && v.props.class === 'canvas-guide-spacing-line',
    );
    expect(spacingLines).toHaveLength(2);
    const diagLine = renderedLines.find((l) => l.props['data-guide-axis'] === 'diagonal');
    expect(diagLine?.props.x2).toBe(250);

    // Simulate pointer-up clearing guides
    const treeCleared = CanvasInteractiveOverlays({ ...overlayProps, guides: [] });
    expect(findVNodes(treeCleared, isBaseGuideLine)).toHaveLength(0);
    expect(
      findVNodes(treeCleared, (v) => v.type === 'g' && v.props.class === 'canvas-guides-layer'),
    ).toHaveLength(0);

    // Repeat show/clear cycles to guarantee zero SVG element accumulation
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const shown = CanvasInteractiveOverlays({ ...overlayProps, guides });
      expect(findVNodes(shown, isBaseGuideLine)).toHaveLength(3);
      const hidden = CanvasInteractiveOverlays({ ...overlayProps, guides: [] });
      expect(findVNodes(hidden, isBaseGuideLine)).toHaveLength(0);
    }

    expect(areSnapGuidesEqual(guides, [...guides])).toBe(true);
    expect(areSnapGuidesEqual(guides, [])).toBe(false);
  });
});

describe('Unified Snapping Engine — Performance Benchmarks (1,500 & 5,000 objects)', () => {
  function runBenchmark(totalObjects: number) {
    const cols = Math.ceil(Math.sqrt(totalObjects * 1.5));
    const nodes: DesignNode[] = new Array(totalObjects);
    for (let i = 0; i < totalObjects; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes[i] = makeRect(
        `bench-${i}`,
        col * 120 + (row % 2) * 10,
        row * 100,
        80,
        60,
        i % 7 === 0 ? { rotation: 30 } : {},
      );
    }

    const moving = nodes[Math.floor(totalObjects / 2)];
    const buildStart = performance.now();
    const { spatialIndex, nodeById, layerStates } = buildSceneIndex(nodes);
    const buildMs = performance.now() - buildStart;

    let totalCandidates = 0;
    let totalSpatialMs = 0;
    let totalSnapMs = 0;
    let maxGuides = 0;
    let lock: SnapLockState | null = null;
    const frames = 60;
    const artboard = { x: 0, y: 0, width: cols * 120 + 200, height: Math.ceil(totalObjects / cols) * 100 + 200 };

    for (let f = 0; f < frames; f += 1) {
      const res = solveTranslationSnap({
        movingNodes: [moving],
        dx: -18 + f * 0.65,
        dy: -10 + f * 0.35,
        artboard,
        spatialIndex,
        nodeById,
        layerStates,
        canvasUnitsPerPixel: 1,
        previousLock: lock,
        collectMetrics: true,
      });
      lock = res.nextLock;
      const m = res.metrics!;
      expect(m.usedSpatialIndex).toBe(true);
      totalCandidates += m.candidatesInspected;
      totalSpatialMs += m.spatialQueryMs;
      totalSnapMs += m.snapCalcMs;
      maxGuides = Math.max(maxGuides, m.guideCount);
    }

    const avgCandidates = totalCandidates / frames;
    const avgSpatialMs = totalSpatialMs / frames;
    const avgSnapMs = totalSnapMs / frames;

    console.info(
      `[UnifiedSnappingBenchmark objects=${totalObjects}] indexBuildMs=${buildMs.toFixed(2)} avgCandidates=${avgCandidates.toFixed(1)} avgSpatialQueryMs=${avgSpatialMs.toFixed(3)} avgSnapCalcMs=${avgSnapMs.toFixed(3)} maxGuides=${maxGuides} indexRebuildsDuringDrag=0`,
    );

    return { buildMs, avgCandidates, avgSpatialMs, avgSnapMs, maxGuides };
  }

  it('stays bounded and fast on 1,500 objects with zero spatial index rebuilds', () => {
    const stats = runBenchmark(1500);
    expect(stats.avgCandidates).toBeLessThan(200);
    expect(stats.maxGuides).toBeLessThanOrEqual(6);
    expect(getWorldBounds([makeRect('check', 0, 0, 10, 10)])).not.toBeNull();
  });

  it('scales cleanly to 5,000 objects inspecting a tiny local candidate subset', () => {
    const stats = runBenchmark(5000);
    expect(stats.avgCandidates).toBeLessThan(220);
    expect(stats.maxGuides).toBeLessThanOrEqual(6);
  });
});

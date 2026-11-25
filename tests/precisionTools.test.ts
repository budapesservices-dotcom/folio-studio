import { describe, expect, it } from 'vitest';
import {
  createFrameNode,
  createInitialProject,
  createLineNode,
  createPolygonNode,
  createStarNode,
} from '../src/core/document/factory';
import {
  applyPathfinderOperation,
  applyShapeBuilderAction,
  decomposeNodesForShapeBuilder,
  deleteAnchorPoint,
  nodeLocalPointToWorld,
  normalizePathNode,
  updateParametricPathNode,
  worldPointToNodeLocal,
} from '../src/core/document/vector';
import { validateProject } from '../src/core/document/validation';
import type { DesignNode, FolioDocument, PathNode, RectNode } from '../src/core/document/types';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import {
  computeSpacingRedlines,
  getBounds,
  resizeNodes,
  rotateNodesAroundPivot,
  snapPointToTargets,
} from '../src/engines/canvas/geometry';
import { canvasToolRegistry } from '../src/engines/canvas/tools/registry';
import { getStudioTool, studioToolRegistry } from '../src/engines/canvas/tools/studioRegistry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolPointerInput,
} from '../src/engines/canvas/tools/types';

function makeRect(id: string, x: number, y: number, width: number, height: number, fill = '#8B7CF6'): RectNode {
  return {
    id,
    type: 'rect',
    name: `Rect ${id}`,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fill, stroke: '#00000000', strokeWidth: 0, radius: 0 },
  };
}

function makeDoc(nodes: DesignNode[]): FolioDocument {
  return {
    id: 'doc-precision-test',
    name: 'Precision Test Artboard',
    width: 960,
    height: 640,
    background: '#ffffff',
    nodes,
  };
}

function makePointer(overrides: Partial<CanvasToolPointerInput> = {}): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point: { x: 100, y: 100 },
    clientX: 100,
    clientY: 100,
    viewportAnchor: { x: 0, y: 0 },
    targetNodeId: null,
    resizeHandle: null,
    rotateHandle: false,
    anchorHit: null,
    smartHandleHit: null,
    detail: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

function makeContext(
  nodes: DesignNode[],
  selectedIds: string[] = [],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const doc = makeDoc(nodes);
  const selectedNodes = nodes.filter((node) => selectedIds.includes(node.id));
  return {
    document: doc,
    canvasNodes: nodes,
    selectableNodes: nodes,
    otherNodes: nodes,
    selectedNodeIds: selectedIds,
    selectedNodes,
    selectionBounds: getBounds(selectedNodes),
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 960,
    session: null,
    toolOptions: { ...DEFAULT_CANVAS_TOOL_OPTIONS, strokeColor: '#E11D48', strokeWidth: 3 },
    workspace: 'component',
    ...overrides,
  };
}

describe('Rotated Path Coordinate Integrity (Bugs #1, #2)', () => {
  it('round-trips world <-> local coordinates accurately for rotated paths', () => {
    const poly = { ...createPolygonNode(100, 100, 120, 80, 4), rotation: 45 };
    const worldPt = nodeLocalPointToWorld(poly, poly.points[0]);
    const localBack = worldPointToNodeLocal(poly, worldPt);
    expect(localBack.x).toBeCloseTo(poly.points[0].x, 4);
    expect(localBack.y).toBeCloseTo(poly.points[0].y, 4);
  });

  it('preserves exact world anchor positions when normalizing a rotated PathNode', () => {
    const poly = { ...createPolygonNode(120, 80, 100, 100, 4), rotation: 35 };
    // Shift anchor #0 dramatically so bounding box origin moves
    const shifted: PathNode = {
      ...poly,
      points: poly.points.map((pt, i) => (i === 0 ? { ...pt, x: pt.x - 40, y: pt.y - 25 } : pt)),
    };
    const worldBefore = shifted.points.map((pt) => nodeLocalPointToWorld(shifted, pt));
    const normalized = normalizePathNode(shifted);
    const worldAfter = normalized.points.map((pt) => nodeLocalPointToWorld(normalized, pt));

    for (let i = 0; i < worldBefore.length; i++) {
      expect(worldAfter[i].x).toBeCloseTo(worldBefore[i].x, 1);
      expect(worldAfter[i].y).toBeCloseTo(worldBefore[i].y, 1);
    }
  });

  it('drags a rotated PathNode anchor along world cursor direction without drift', () => {
    const poly = { ...createPolygonNode(100, 100, 120, 120, 4), rotation: 90 };
    const anchorBeforeWorld = nodeLocalPointToWorld(poly, poly.points[0]);
    const direct = getStudioTool('direct-selection');
    const down = direct.onPointerDown(
      makePointer({
        point: anchorBeforeWorld,
        anchorHit: { nodeId: poly.id, pointIndex: 0, part: 'anchor' },
      }),
      makeContext([poly], [poly.id]),
    );
    const targetWorld = { x: anchorBeforeWorld.x + 30, y: anchorBeforeWorld.y };
    const move = direct.onPointerMove(
      makePointer({ point: targetWorld }),
      makeContext([poly], [poly.id], { session: down.session ?? null }),
    );
    const up = direct.onPointerUp(
      makePointer({ point: targetWorld }),
      makeContext([poly], [poly.id], { session: move.session ?? null }),
    );
    const updated = up.commitNodes![0] as PathNode;
    const anchorAfterWorld = nodeLocalPointToWorld(updated, updated.points[0]);
    expect(anchorAfterWorld.x).toBeCloseTo(targetWorld.x, 1);
    expect(anchorAfterWorld.y).toBeCloseTo(targetWorld.y, 1);
  });
});

describe('Concave-Safe 2D Planar Boolean Engine & Shape Builder (Bugs #3, #4 + Breakthrough #1)', () => {
  it('unites overlapping shapes into ONE clean outer contour with zero internal seam subpaths', () => {
    const a = makeRect('a', 100, 100, 120, 120);
    const b = makeRect('b', 160, 140, 120, 120);
    const united = applyPathfinderOperation([a, b], 'unite', 'pf-clean-unite');
    expect(united).not.toBeNull();
    // Single merged contour => no compound seam subpaths!
    expect(united!.subpaths).toBeUndefined();
    expect(united!.width).toBeCloseTo(180, 0);
    expect(united!.height).toBeCloseTo(160, 0);
  });

  it('accurately subtracts a rectangle from a concave 5-point Star without convex clipping failure', () => {
    const star = createStarNode(100, 100, 160, 160, 5, 0.44);
    const cutter = makeRect('cut', 160, 100, 120, 160);
    const result = applyPathfinderOperation([star, cutter], 'subtract', 'star-sub');
    expect(result).not.toBeNull();
    // Left half of star remains; right bound clipped near x = 160
    expect(result!.x + result!.width).toBeLessThanOrEqual(162);
    expect(result!.width).toBeGreaterThan(40);
  });

  it('decomposes overlapping shapes into atomic planar faces and supports Shape Builder Merge & Alt-Punch', () => {
    const left = makeRect('l', 100, 100, 100, 100);
    const right = makeRect('r', 150, 100, 100, 100);
    const { candidates, arrangement } = decomposeNodesForShapeBuilder([left, right]);
    expect(candidates).toHaveLength(2);
    // Two overlapping rectangles decompose into 3 atomic faces: left-only, overlap, right-only
    expect(arrangement.faces.length).toBe(3);

    let seq = 0;
    const nextId = () => `sb-out-${++seq}`;

    // Punch out the middle overlap face (around x=175, y=150)
    const overlapFace = arrangement.faces.find((f) => f.memberShapeIndices.includes(0) && f.memberShapeIndices.includes(1));
    expect(overlapFace).toBeDefined();
    const punched = applyShapeBuilderAction(candidates, arrangement, [overlapFace!.id], 'punch', nextId);
    expect(punched).not.toBeNull();
    // Left-only + right-only remain as 2 disjoint contours (2 nodes)
    expect(punched!.length).toBe(2);

    // Interactive tool handler drag-merge across all 3 faces produces 1 unified path via replaceNodes
    const sbTool = getStudioTool('shape-builder');
    const down = sbTool.onPointerDown(makePointer({ point: { x: 120, y: 150 } }), makeContext([left, right], ['l', 'r']));
    const m1 = sbTool.onPointerMove(
      makePointer({ point: { x: 175, y: 150 } }),
      makeContext([left, right], ['l', 'r'], { session: down.session ?? null }),
    );
    const m2 = sbTool.onPointerMove(
      makePointer({ point: { x: 225, y: 150 } }),
      makeContext([left, right], ['l', 'r'], { session: m1.session ?? null }),
    );
    const up = sbTool.onPointerUp(
      makePointer({ point: { x: 225, y: 150 } }),
      makeContext([left, right], ['l', 'r'], { session: m2.session ?? null }),
    );
    expect(up.replaceNodes?.removeIds).toEqual(['l', 'r']);
    expect(up.replaceNodes?.insertNodes).toHaveLength(1);
    expect(up.replaceNodes!.insertNodes[0].width).toBeCloseTo(150, 0);
  });
});

describe('Atomic Single-Step Undo/Redo & .flop v2 Schema Compatibility (Bug #6)', () => {
  it('executes replace-nodes as ONE atomic undo/redo step preserving z-order', () => {
    const project = createInitialProject();
    const doc = project.pages[0].document;
    const a = makeRect('a', 10, 10, 80, 80);
    const b = makeRect('b', 50, 10, 80, 80);
    const c = makeRect('c', 300, 10, 80, 80);
    doc.nodes = [a, b, c];

    const initial = createEditorState(project);
    const merged = applyPathfinderOperation([a, b], 'unite', 'merged-ab')!;
    const after = editorReducer(initial, {
      type: 'replace-nodes',
      removeIds: ['a', 'b'],
      insertNodes: [merged],
    });
    expect(after.past).toHaveLength(1);
    expect(after.project.pages[0].document.nodes.map((n) => n.id)).toEqual(['merged-ab', 'c']);
    expect(after.selectedNodeIds).toEqual(['merged-ab']);

    // ONE single undo restores both original shapes cleanly
    const undone = editorReducer(after, { type: 'undo' });
    expect(undone.project.pages[0].document.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('validates PathNode.shapeMeta inside .flop v2 project schemas', () => {
    const project = createInitialProject();
    const star = createStarNode(40, 40, 120, 120, 6, 0.42);
    const poly = createPolygonNode(200, 40, 100, 100, 7);
    expect(star.shapeMeta).toEqual({ kind: 'star', spikes: 6, innerRatio: 0.42 });
    expect(poly.shapeMeta).toEqual({ kind: 'polygon', sides: 7 });
    project.pages[0].document.nodes.push(star, poly);
    expect(validateProject(project).ok).toBe(true);
  });
});

describe('Transform, Multi-Rotate, Modifiers, Draw & Selection Fixes (Bugs #5, #7-#14)', () => {
  it('orbits multi-selected nodes around a shared or custom pivot', () => {
    const a = makeRect('a', 100, 100, 40, 40); // center (120, 120)
    const b = makeRect('b', 200, 100, 40, 40); // center (220, 120)
    const rotated = rotateNodesAroundPivot([a, b], 90, { x: 170, y: 120 });
    // Center A (120,120) rotated +90 deg around (170,120) -> (170, 70)
    expect(rotated[0].x + rotated[0].width / 2).toBeCloseTo(170, 1);
    expect(rotated[0].y + rotated[0].height / 2).toBeCloseTo(70, 1);
    expect(rotated[0].rotation).toBe(90);
    // Center B (220,120) rotated +90 deg around (170,120) -> (170, 170)
    expect(rotated[1].x + rotated[1].width / 2).toBeCloseTo(170, 1);
    expect(rotated[1].y + rotated[1].height / 2).toBeCloseTo(170, 1);
    expect(rotated[1].rotation).toBe(90);
  });

  it('supports Alt+Resize from center and Shift+Resize proportional lock on side handles', () => {
    const rect = makeRect('r', 100, 100, 100, 60);
    const bounds = getBounds([rect])!;
    const fromCenter = resizeNodes([rect], bounds, 'e', 20, 0, { fromCenter: true });
    // Center X stays at 150, width grows by 40 -> x=80, width=140
    expect(fromCenter[0].x).toBeCloseTo(80, 1);
    expect(fromCenter[0].width).toBeCloseTo(140, 1);
    expect(fromCenter[0].height).toBeCloseTo(60, 1);

    const sideConstrained = resizeNodes([rect], bounds, 'e', 50, 0, { constrainAspect: true });
    // Width 100 -> 150 (1.5x), height 60 -> 90 (1.5x)
    expect(sideConstrained[0].width).toBeCloseTo(150, 1);
    expect(sideConstrained[0].height).toBeCloseTo(90, 1);
  });

  it('supports Shift+Move axis lock and Alt+Drag instant clone with live ghost preview', () => {
    const rect = makeRect('orig', 100, 100, 80, 60);
    const select = getStudioTool('select');

    // Shift+Move locks to dominant horizontal axis
    const down = select.onPointerDown(makePointer({ targetNodeId: 'orig', point: { x: 120, y: 120 } }), makeContext([rect], ['orig']));
    const move = select.onPointerMove(
      makePointer({ point: { x: 180, y: 135 }, shiftKey: true }),
      makeContext([rect], ['orig'], { session: down.session ?? null }),
    );
    expect(move.previewNodes![0].x).toBeGreaterThan(140);
    expect(move.previewNodes![0].y).toBe(100);

    // Alt+Drag produces previewCreateNodes while dragging and commits createNodes on release
    const cDown = select.onPointerDown(
      makePointer({ targetNodeId: 'orig', point: { x: 120, y: 120 }, altKey: true }),
      makeContext([rect], ['orig']),
    );
    const cMove = select.onPointerMove(
      makePointer({ point: { x: 220, y: 120 }, altKey: true }),
      makeContext([rect], ['orig'], { session: cDown.session ?? null }),
    );
    expect(cMove.previewCreateNodes).toHaveLength(1);
    expect(cMove.previewCreateNodes![0].id).not.toBe('orig');
    const cUp = select.onPointerUp(
      makePointer({ point: { x: 220, y: 120 }, altKey: true }),
      makeContext([rect], ['orig'], { session: cMove.session ?? null }),
    );
    expect(cUp.createNodes).toHaveLength(1);
    expect(cUp.createNodes![0].x).toBe(200);
  });

  it('deletes the focused vector anchor via Backspace/Delete in Direct Selection', () => {
    const poly = createPolygonNode(50, 50, 120, 120, 5);
    const deleted = deleteAnchorPoint(poly, 2);
    expect(deleted).not.toBeNull();
    expect(deleted!.points).toHaveLength(4);

    const direct = getStudioTool('direct-selection');
    const keyResult = direct.onKeyDown(
      { key: 'Backspace', code: 'Backspace', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([poly], [poly.id], { activeAnchor: { nodeId: poly.id, pointIndex: 1 } }),
    );
    expect(keyResult.commitNodes).toHaveLength(1);
    expect((keyResult.commitNodes![0] as PathNode).points).toHaveLength(4);
  });

  it('honors strokeColor & strokeWidth on draw shapes and fixes reverse-drag draw-text placement', () => {
    const drawRect = getStudioTool('draw-rect');
    const rDown = drawRect.onPointerDown(makePointer({ point: { x: 50, y: 50 } }), makeContext([]));
    const rUp = drawRect.onPointerUp(
      makePointer({ point: { x: 180, y: 140 } }),
      makeContext([], [], { session: rDown.session ?? null }),
    );
    const createdRect = rUp.createNodes![0] as RectNode;
    expect(createdRect.style.stroke).toBe('#E11D48');
    expect(createdRect.style.strokeWidth).toBe(3);

    const drawText = getStudioTool('draw-text');
    const tDown = drawText.onPointerDown(makePointer({ point: { x: 300, y: 250 } }), makeContext([]));
    const tUp = drawText.onPointerUp(
      makePointer({ point: { x: 120, y: 180 } }),
      makeContext([], [], { session: tDown.session ?? null }),
    );
    // Reverse drag top-left must be (120, 180), not (300, 250)
    expect(tUp.createNodes![0].x).toBe(120);
    expect(tUp.createNodes![0].y).toBe(180);
  });

  it('matches Frame and Path fills in Magic Wand and preserves selection on Lasso cancel', () => {
    const frame = createFrameNode(10, 10, 100, 100);
    frame.style.fill = '#10B981';
    const star = createStarNode(150, 10, 100, 100, 5, 0.44);
    star.style.fill = '#10B981';
    const other = makeRect('other', 300, 10, 80, 80, '#F59E0B');

    const wand = getStudioTool('magic-wand');
    const wandHit = wand.onPointerDown(
      makePointer({ targetNodeId: frame.id, point: { x: 30, y: 30 } }),
      makeContext([frame, star, other]),
    );
    expect(wandHit.selection).toEqual([frame.id, star.id]);

    const lasso = getStudioTool('lasso-selection');
    const lDown = lasso.onPointerDown(makePointer({ point: { x: 5, y: 5 } }), makeContext([other], ['other']));
    // PointerDown does NOT wipe existing selection before drag finishes
    expect(lDown.selection).toBeUndefined();
    const lCancel = lasso.onKeyDown(
      { key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([other], ['other'], { session: lDown.session ?? null }),
    );
    expect(lCancel.session).toBeNull();
    expect(lCancel.selection).toBeUndefined();
  });

  it('supports Pen Shift 45deg snap, Alt cusp handle break, and Escape discard', () => {
    const pen = getStudioTool('pen');
    let session = pen.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([])).session ?? null;
    session = pen.onPointerUp(makePointer({ point: { x: 100, y: 100 } }), makeContext([], [], { session })).session ?? null;
    // Shift+Click at slight offset snaps cleanly to 0deg horizontal (y=100)
    const snapped = pen.onPointerDown(
      makePointer({ point: { x: 200, y: 112 }, shiftKey: true }),
      makeContext([], [], { session }),
    );
    session = snapped.session ?? null;
    if (session?.kind === 'pen-draft') {
      expect(session.points[1].y).toBeCloseTo(100, 0);
    }
    // Drag with Alt breaks handle into corner cusp
    session = pen.onPointerMove(
      makePointer({ point: { x: 230, y: 130 }, altKey: true }),
      makeContext([], [], { session }),
    ).session ?? null;
    if (session?.kind === 'pen-draft') {
      expect(session.points[1].pointType).toBe('corner');
    }
    // Escape discards draft without committing a node
    const discarded = pen.onKeyDown(
      { key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([], [], { session }),
    );
    expect(discarded.session).toBeNull();
    expect(discarded.createNodes).toBeUndefined();
  });
});

describe('On-Canvas Smart Handles, Alt-Hover Redlines & Smart Measure (Breakthroughs #2, #3, #4)', () => {
  it('updates Corner Radius and Star Inner-Ratio live via Smart Handles and Alt+Arrow keys', () => {
    const rect = makeRect('card', 100, 100, 160, 100);
    const select = getStudioTool('select');
    const crDown = select.onPointerDown(
      makePointer({ point: { x: 112, y: 112 }, smartHandleHit: { kind: 'corner-radius', nodeId: 'card', corner: 'nw' } }),
      makeContext([rect], ['card']),
    );
    const crMove = select.onPointerMove(
      makePointer({ point: { x: 136, y: 136 } }),
      makeContext([rect], ['card'], { session: crDown.session ?? null }),
    );
    const crUp = select.onPointerUp(
      makePointer({ point: { x: 136, y: 136 } }),
      makeContext([rect], ['card'], { session: crMove.session ?? null }),
    );
    expect((crUp.commitNodes![0] as RectNode).style.radius).toBeGreaterThan(20);

    const star = createStarNode(100, 100, 140, 140, 5, 0.44);
    const starSpikesUp = select.onKeyDown(
      { key: 'ArrowUp', code: 'ArrowUp', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true },
      makeContext([star], [star.id]),
    );
    const updatedStar = starSpikesUp.commitNodes![0] as PathNode;
    expect(updatedStar.shapeMeta).toEqual({ kind: 'star', spikes: 6, innerRatio: 0.44 });
    expect(updatedStar.points).toHaveLength(12);

    const adjustedRatio = updateParametricPathNode(updatedStar, { kind: 'star', spikes: 6, innerRatio: 0.62 });
    expect(adjustedRatio.shapeMeta).toEqual({ kind: 'star', spikes: 6, innerRatio: 0.62 });
  });

  it('computes accurate Alt-Hover Spacing Redlines for disjoint layers and nested artboard gaps', () => {
    const left = { x: 100, y: 100, width: 100, height: 80 };
    const right = { x: 248, y: 120, width: 100, height: 80 };
    const disjoint = computeSpacingRedlines(left, right);
    expect(disjoint.segments).toHaveLength(1);
    expect(disjoint.segments[0].value).toBe(48);
    expect(disjoint.segments[0].orientation).toBe('horizontal');

    const artboard = { x: 0, y: 0, width: 800, height: 600 };
    const nested = computeSpacingRedlines(left, artboard);
    expect(nested.segments.map((s) => s.value).sort((a, b) => a - b)).toEqual([100, 100, 420, 600]);
  });

  it('magnetically snaps Measure tool endpoints and supports Eyedropper Shift+Click stroke mode', () => {
    const snapped = snapPointToTargets({ x: 104, y: 103 }, [{ x: 100, y: 100, width: 200, height: 100 }], 9);
    expect(snapped.snapped).toBe(true);
    expect(snapped.point).toEqual({ x: 100, y: 100 });

    const rect = makeRect('swatch', 50, 50, 100, 100, '#14B8A6');
    const eyedropper = getStudioTool('eyedropper');
    const strokeSample = eyedropper.onPointerDown(
      makePointer({ targetNodeId: 'swatch', point: { x: 80, y: 80 }, shiftKey: true }),
      makeContext([rect]),
    );
    expect(strokeSample.sampledColor?.color).toBe('#14B8A6');
    expect(strokeSample.sampledColor?.target).toBe('stroke');
  });
});

describe('Existing Tool Quality, Precision & Efficiency Polish (Zero New Tools)', () => {
  it('strictly preserves exact tool counts (29 studio tools, 6 Wave 1 tools)', () => {
    expect(studioToolRegistry.list()).toHaveLength(29);
    expect(canvasToolRegistry.list()).toHaveLength(6);
  });

  it('reuses stable clone IDs across Alt+Drag pointermove frames to prevent DOM thrashing', () => {
    const rect = makeRect('orig', 100, 100, 80, 60);
    const select = getStudioTool('select');
    const down = select.onPointerDown(
      makePointer({ targetNodeId: 'orig', point: { x: 120, y: 120 }, altKey: true }),
      makeContext([rect], ['orig']),
    );
    const move1 = select.onPointerMove(
      makePointer({ point: { x: 180, y: 120 }, altKey: true }),
      makeContext([rect], ['orig'], { session: down.session ?? null }),
    );
    const move2 = select.onPointerMove(
      makePointer({ point: { x: 240, y: 140 }, altKey: true }),
      makeContext([rect], ['orig'], { session: move1.session ?? null }),
    );
    expect(move1.previewCreateNodes?.[0].id).toBeDefined();
    expect(move2.previewCreateNodes?.[0].id).toBe(move1.previewCreateNodes?.[0].id);
  });

  it('supports Arrow-key nudging (1px / Shift 10px) for layers and Direct Selection active anchors', () => {
    const rect = makeRect('nudge-box', 100, 100, 80, 60);
    const select = getStudioTool('select');
    const right1 = select.onKeyDown(
      { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([rect], ['nudge-box']),
    );
    expect(right1.commitNodes?.[0]).toMatchObject({ x: 101, y: 100 });

    const down10 = select.onKeyDown(
      { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([rect], ['nudge-box']),
    );
    expect(down10.commitNodes?.[0]).toMatchObject({ x: 100, y: 110 });

    // Direct Selection nudges the exact focused Bezier anchor point
    const poly = createPolygonNode(100, 100, 100, 100, 4);
    const beforeWorld = nodeLocalPointToWorld(poly, poly.points[0]);
    const direct = getStudioTool('direct-selection');
    const anchorNudge = direct.onKeyDown(
      { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([poly], [poly.id], { activeAnchor: { nodeId: poly.id, pointIndex: 0 } }),
    );
    const updated = anchorNudge.commitNodes?.[0] as PathNode;
    const afterWorld = nodeLocalPointToWorld(updated, updated.points[0]);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x + 10, 1);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 1);
  });

  it('preserves selection on Marquee pointerDown/Escape, supports Direct Selection marquee, and maps directional resize cursors', () => {
    const a = makeRect('a', 50, 50, 40, 40);
    const b = makeRect('b', 160, 50, 40, 40);
    const select = getStudioTool('select');
    const down = select.onPointerDown(makePointer({ point: { x: 10, y: 10 }, shiftKey: true }), makeContext([a, b], ['a']));
    expect(down.selection).toBeUndefined();
    const esc = select.onKeyDown(
      { key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([a, b], ['a'], { session: down.session ?? null }),
    );
    expect(esc.session).toBeNull();
    expect(esc.selection).toBeUndefined();

    // Direct Selection marquee selects exact nodes in box
    const direct = getStudioTool('direct-selection');
    const dDown = direct.onPointerDown(makePointer({ point: { x: 150, y: 40 } }), makeContext([a, b], ['a']));
    const dUp = direct.onPointerUp(
      makePointer({ point: { x: 210, y: 100 } }),
      makeContext([a, b], ['a'], { session: dDown.session ?? null }),
    );
    expect(dUp.selection).toEqual(['b']);

    // Directional resize cursors
    const rDown = select.onPointerDown(
      makePointer({ point: { x: 70, y: 50 }, resizeHandle: 'n' }),
      makeContext([a], ['a']),
    );
    expect(select.cursorStyle(makeContext([a], ['a'], { session: rDown.session ?? null }))).toBe('ns-resize');
    const eDown = select.onPointerDown(
      makePointer({ point: { x: 90, y: 70 }, resizeHandle: 'e' }),
      makeContext([a], ['a']),
    );
    expect(select.cursorStyle(makeContext([a], ['a'], { session: eDown.session ?? null }))).toBe('ew-resize');
  });

  it('supports Magic Wand Shift-add, Ctrl-subtract, and visible stroke-color matching', () => {
    const a = makeRect('a', 10, 10, 50, 50, '#FF0000');
    const b = makeRect('b', 80, 10, 50, 50, '#00FF00');
    const wand = getStudioTool('magic-wand');
    const added = wand.onPointerDown(
      makePointer({ targetNodeId: 'b', shiftKey: true }),
      makeContext([a, b], ['a']),
    );
    expect(added.selection).toEqual(['a', 'b']);

    const subtracted = wand.onPointerDown(
      makePointer({ targetNodeId: 'b', ctrlKey: true }),
      makeContext([a, b], ['a', 'b']),
    );
    expect(subtracted.selection).toEqual(['a']);

    // Stroke-color fallback when fill is none
    const line1 = createLineNode(10, 10, 100, 10, { stroke: '#38BDF8', strokeWidth: 3 });
    const line2 = createLineNode(10, 40, 100, 40, { stroke: '#38BDF8', strokeWidth: 2 });
    const line3 = createLineNode(10, 70, 100, 70, { stroke: '#F43F5E', strokeWidth: 3 });
    const strokeHit = wand.onPointerDown(
      makePointer({ targetNodeId: line1.id }),
      makeContext([line1, line2, line3]),
    );
    expect(strokeHit.selection).toEqual([line1.id, line2.id]);
  });

  it('supports Hand double-click reset and Scrubby Zoom click-in / Alt+click-out', () => {
    const hand = getStudioTool('hand');
    const reset = hand.onPointerDown(makePointer({ detail: 2 }), makeContext([], [], { zoom: 1.75, pan: { x: 120, y: -60 } }));
    expect(reset.zoom).toBe(1);
    expect(reset.pan).toEqual({ x: 0, y: 0 });

    const zoomTool = getStudioTool('scrubby-zoom');
    const zDown = zoomTool.onPointerDown(makePointer({ clientX: 200, viewportAnchor: { x: 0, y: 0 } }), makeContext([], [], { zoom: 1 }));
    const zIn = zoomTool.onPointerUp(makePointer({ clientX: 200 }), makeContext([], [], { zoom: 1, session: zDown.session ?? null }));
    expect(zIn.zoom).toBe(1.25);

    const zOut = zoomTool.onPointerUp(
      makePointer({ clientX: 200, altKey: true }),
      makeContext([], [], { zoom: 1, session: zDown.session ?? null }),
    );
    expect(zOut.zoom).toBe(0.8);
  });

  it('supports Draw Text instant inline edit, Draw Star Left/Right inner-ratio tuning, and Line angle HUD', () => {
    const drawText = getStudioTool('draw-text');
    const tDown = drawText.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([]));
    const tUp = drawText.onPointerUp(
      makePointer({ point: { x: 100, y: 100 } }),
      makeContext([], [], { session: tDown.session ?? null }),
    );
    expect(tUp.editTextNodeId).toBe(tUp.createNodes?.[0].id);

    const drawStar = getStudioTool('draw-star');
    let session = drawStar.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([])).session ?? null;
    session = drawStar.onPointerMove(makePointer({ point: { x: 240, y: 240 } }), makeContext([], [], { session })).session ?? null;
    session = drawStar.onKeyDown(
      { key: 'ArrowRight', code: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([], [], { session }),
    ).session ?? null;
    const starUp = drawStar.onPointerUp(makePointer({ point: { x: 240, y: 240 } }), makeContext([], [], { session }));
    expect((starUp.createNodes?.[0] as PathNode).shapeMeta).toEqual({ kind: 'star', spikes: 5, innerRatio: 0.48 });

    const drawLine = getStudioTool('draw-line');
    const lDown = drawLine.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([]));
    const lMove = drawLine.onPointerMove(makePointer({ point: { x: 200, y: 200 } }), makeContext([], [], { session: lDown.session ?? null }));
    const overlay = drawLine.renderOverlay(makeContext([], [], { session: lMove.session ?? null }));
    expect(overlay?.kind === 'draw-preview' && overlay.label).toContain('45°');
  });

  it('supports Pen handle retraction, Curvature live spline preview, and Scissors prioritizing clicked path', () => {
    const pen = getStudioTool('pen');
    let session = pen.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([])).session ?? null;
    session = pen.onPointerMove(makePointer({ point: { x: 140, y: 100 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerUp(makePointer({ point: { x: 140, y: 100 } }), makeContext([], [], { session })).session ?? null;
    // Click directly back on last anchor to retract handleOut
    const retracted = pen.onPointerDown(makePointer({ point: { x: 101, y: 100 } }), makeContext([], [], { session }));
    expect(retracted.session?.kind === 'pen-draft' && retracted.session.points[0].handleOut).toBeUndefined();

    // Curvature renders live spline previewPoints toward cursor
    const curvature = getStudioTool('curvature');
    let cSession = curvature.onPointerDown(makePointer({ point: { x: 40, y: 40 } }), makeContext([])).session ?? null;
    cSession = curvature.onPointerDown(makePointer({ point: { x: 120, y: 80 } }), makeContext([], [], { session: cSession })).session ?? null;
    cSession = curvature.onPointerMove(makePointer({ point: { x: 200, y: 40 } }), makeContext([], [], { session: cSession })).session ?? null;
    const cOverlay = curvature.renderOverlay(makeContext([], [], { session: cSession }));
    expect(cOverlay?.kind).toBe('pen-draft');
    if (cOverlay?.kind === 'pen-draft') {
      expect(cOverlay.previewPoints?.length).toBe(3);
    }

    // Scissors cuts the directly clicked path even when another path is selected
    const selectedPath = createLineNode(10, 10, 110, 10);
    const clickedPath = createLineNode(10, 120, 110, 120);
    const scissors = getStudioTool('scissors');
    const cut = scissors.onPointerDown(
      makePointer({ targetNodeId: clickedPath.id, point: { x: 60, y: 120 } }),
      makeContext([selectedPath, clickedPath], [selectedPath.id]),
    );
    expect(cut.replaceNodeWithNodes?.nodeId).toBe(clickedPath.id);
    expect(cut.replaceNodeWithNodes?.nodes).toHaveLength(2);
  });

  it('supports Rotate Alt+Drag clone-orbit, Shape Builder quick-select + mid-drag Alt toggle, and Measure click-to-inspect', () => {
    const rect = makeRect('petal', 100, 100, 60, 40);
    const rotate = getStudioTool('rotate');
    const rDown = rotate.onPointerDown(
      makePointer({ point: { x: 200, y: 120 }, altKey: true }),
      makeContext([rect], ['petal']),
    );
    const rMove = rotate.onPointerMove(
      makePointer({ point: { x: 130, y: 200 }, altKey: true, shiftKey: true }),
      makeContext([rect], ['petal'], { session: rDown.session ?? null }),
    );
    expect(rMove.previewCreateNodes).toHaveLength(1);
    const rUp = rotate.onPointerUp(
      makePointer({ point: { x: 130, y: 200 }, altKey: true, shiftKey: true }),
      makeContext([rect], ['petal'], { session: rMove.session ?? null }),
    );
    expect(rUp.createNodes).toHaveLength(1);
    expect(rUp.createNodes![0].id).not.toBe('petal');

    // Shape Builder quick-select when < 2 selected, and reactive Alt toggle mid-drag
    const a = makeRect('sb-a', 100, 100, 100, 100);
    const b = makeRect('sb-b', 150, 100, 100, 100);
    const sb = getStudioTool('shape-builder');
    const qs1 = sb.onPointerDown(makePointer({ targetNodeId: 'sb-a' }), makeContext([a, b], []));
    expect(qs1.selection).toEqual(['sb-a']);
    const qs2 = sb.onPointerDown(makePointer({ targetNodeId: 'sb-b', shiftKey: true }), makeContext([a, b], ['sb-a']));
    expect(qs2.selection).toEqual(['sb-a', 'sb-b']);

    const sbDown = sb.onPointerDown(makePointer({ point: { x: 120, y: 150 }, altKey: true }), makeContext([a, b], ['sb-a', 'sb-b']));
    expect(sbDown.session?.kind === 'shape-builder' && sbDown.session.mode).toBe('punch');
    const sbMoveBack = sb.onPointerMove(
      makePointer({ point: { x: 175, y: 150 }, altKey: false }),
      makeContext([a, b], ['sb-a', 'sb-b'], { session: sbDown.session ?? null }),
    );
    expect(sbMoveBack.session?.kind === 'shape-builder' && sbMoveBack.session.mode).toBe('merge');

    // Measure single-click on a layer pins its bounding box (even when SVG pointer capture clears targetNodeId on pointerUp)
    const measure = getStudioTool('measure');
    const mDown = measure.onPointerDown(makePointer({ targetNodeId: 'petal', point: { x: 130, y: 120 } }), makeContext([rect]));
    const mUp = measure.onPointerUp(
      makePointer({ targetNodeId: null, point: { x: 130, y: 120 } }),
      makeContext([rect], [], { session: mDown.session ?? null }),
    );
    const mOverlay = measure.renderOverlay(makeContext([rect], [], { session: mUp.session ?? null }));
    expect(mOverlay?.kind === 'measure' && mOverlay.inspectedBounds).toEqual({ x: 100, y: 100, width: 60, height: 40 });
  });
});


import { describe, expect, it } from 'vitest';
import {
  createInitialProject,
  createLineNode,
  createPolygonNode,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActiveDocument, updateActiveDocument } from '../src/core/document/project';
import type { DesignNode, FolioDocument, PathNode, RectNode } from '../src/core/document/types';
import { createEditorState, editorReducer, type EditorState } from '../src/app/editorReducer';
import { getBounds, nodesGeometryChanged, resizeNodes, snapResizeBounds } from '../src/engines/canvas/geometry';
import { getStudioTool } from '../src/engines/canvas/tools/studioRegistry';
import { getCanvasUnitsPerPixel } from '../src/engines/canvas/tools/geometry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolKeyInput,
  type CanvasToolPointerInput,
  type CanvasToolTransition,
} from '../src/engines/canvas/tools/types';

function makeRect(id: string, x: number, y: number, width: number, height: number, fill = '#8B7CF6'): RectNode {
  return {
    ...createRectNode(0),
    id,
    name: id,
    x,
    y,
    width,
    height,
    style: { fill, stroke: '#20212A', strokeWidth: 2, radius: 8 },
  };
}

function makeGroup(id: string, x: number, y: number, width: number, height: number): DesignNode {
  return {
    id,
    type: 'group',
    name: id,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
  };
}

function makeContext(
  nodes: DesignNode[],
  selectedIds: string[] = [],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const doc: FolioDocument = {
    ...getActiveDocument(createInitialProject()),
    width: 1200,
    height: 800,
    nodes,
  };
  const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
  return {
    document: doc,
    canvasNodes: nodes,
    selectableNodes: nodes,
    otherNodes: nodes,
    selectedNodeIds: selectedIds,
    selectedNodes,
    selectionBounds: getBounds(selectedNodes),
    zoom: 1,
    canvasUnitsPerPixel: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1200,
    session: null,
    toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
    workspace: 'component',
    customPivot: null,
    activeAnchor: null,
    ...overrides,
  };
}

function makePointer(overrides: Partial<CanvasToolPointerInput> = {}): CanvasToolPointerInput {
  const point = overrides.point ?? { x: 100, y: 100 };
  return {
    pointerId: 1,
    button: 0,
    point,
    clientX: overrides.clientX ?? point.x,
    clientY: overrides.clientY ?? point.y,
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

function makeKey(key: string, overrides: Partial<CanvasToolKeyInput> = {}): CanvasToolKeyInput {
  return {
    key,
    code: key === 'Escape' ? 'Escape' : key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

function applyTransitionToEditor(state: EditorState, transition: CanvasToolTransition): EditorState {
  let next = state;
  if (transition.createNodes && transition.createNodes.length > 0) {
    next = editorReducer(next, { type: 'add-nodes', nodes: transition.createNodes });
  }
  if (transition.replaceNodes) {
    next = editorReducer(next, {
      type: 'replace-nodes',
      removeIds: transition.replaceNodes.removeIds,
      insertNodes: transition.replaceNodes.insertNodes,
    });
  }
  if (transition.commitNodes && transition.commitNodes.length > 0) {
    next = editorReducer(next, { type: 'transform-nodes', nodes: transition.commitNodes });
  }
  if (transition.selection) {
    next = editorReducer(next, { type: 'select-nodes', nodeIds: transition.selection });
  }
  return next;
}

describe('P0.1 Studio Tools Stabilization', () => {
  describe('1. Single & Multi-Selection Drag, Resize, Snapping, and Transform Consistency', () => {
    it('supports consistent Shift+Click and Ctrl+Click multi-selection on top-level and nested layers', () => {
      const a = makeRect('a', 40, 40, 80, 60);
      const b = makeRect('b', 180, 40, 80, 60);
      const grp = makeGroup('grp', 300, 40, 120, 80);
      const child = { ...makeRect('child', 310, 50, 50, 40), parentId: 'grp' };
      const nodes = [a, b, grp, child];
      const select = getStudioTool('select');
      const direct = getStudioTool('direct-selection');

      // Shift+Click top-level adds to multi-selection
      const addB = select.onPointerDown(
        makePointer({ targetNodeId: 'b', point: { x: 200, y: 60 }, shiftKey: true }),
        makeContext(nodes, ['a']),
      );
      expect(addB.selection).toEqual(['a', 'b']);

      // Shift+Click already-selected top-level removes from multi-selection without starting drag
      const removeB = select.onPointerDown(
        makePointer({ targetNodeId: 'b', point: { x: 200, y: 60 }, shiftKey: true }),
        makeContext(nodes, ['a', 'b']),
      );
      expect(removeB.selection).toEqual(['a']);
      expect(removeB.session).toBeUndefined();

      // Shift+Click nested child preserves deep-select of the exact nested layer
      const deepChild = select.onPointerDown(
        makePointer({ targetNodeId: 'child', point: { x: 320, y: 60 }, shiftKey: true }),
        makeContext(nodes, ['a']),
      );
      expect(deepChild.selection).toEqual(['child']);

      // Direct Selection Ctrl+Click adds nested child into multi-selection
      const directMulti = direct.onPointerDown(
        makePointer({ targetNodeId: 'child', point: { x: 320, y: 60 }, ctrlKey: true }),
        makeContext(nodes, ['a']),
      );
      expect(directMulti.selection).toEqual(['a', 'child']);
    });

    it('snaps single and multi-selection resize edges with guides and bypasses snap when Ctrl/Cmd is held', () => {
      const a = makeRect('a', 100, 100, 100, 80);
      const b = makeRect('b', 100, 200, 100, 60);
      const target = makeRect('target', 250, 100, 80, 160);
      const select = getStudioTool('select');
      const nodes = [a, b, target];

      // Multi-selection bounds: x=100..200, y=100..260. Drag east handle by +46 -> x=246, within 8px of target.x=250
      const down = select.onPointerDown(
        makePointer({ point: { x: 200, y: 180 }, resizeHandle: 'e' }),
        makeContext(nodes, ['a', 'b']),
      );
      const snappedMove = select.onPointerMove(
        makePointer({ point: { x: 246, y: 180 } }),
        makeContext(nodes, ['a', 'b'], { session: down.session ?? null }),
      );
      expect(snappedMove.guides).toEqual([{ axis: 'x', position: 250 }]);
      expect(snappedMove.previewNodes?.[0].width).toBe(150);
      expect(snappedMove.previewNodes?.[1].width).toBe(150);

      // Ctrl bypasses resize snapping cleanly
      const unsnappedMove = select.onPointerMove(
        makePointer({ point: { x: 246, y: 180 }, ctrlKey: true }),
        makeContext(nodes, ['a', 'b'], { session: down.session ?? null }),
      );
      expect(unsnappedMove.guides).toEqual([]);
      expect(unsnappedMove.previewNodes?.[0].width).toBe(146);
      expect(unsnappedMove.previewNodes?.[1].width).toBe(146);
    });

    it('resizes mixed multi-selection (Rect + Text + PathNode) and thin lines accurately without drift', () => {
      const rect = makeRect('r', 100, 100, 100, 100);
      const text = { ...createTextNode(0), id: 't', x: 100, y: 220, width: 100, height: 40 };
      const poly = { ...createPolygonNode(220, 100, 80, 80, 4), id: 'p' };
      const bounds = getBounds([rect, text, poly])!;
      expect(bounds).toEqual({ x: 100, y: 100, width: 200, height: 160 });

      const resized = resizeNodes([rect, text, poly], bounds, 'se', 100, 80, { uniformScale: true });
      const nextBounds = getBounds(resized)!;
      expect(nextBounds.width).toBeCloseTo(300, 1);
      expect(nextBounds.height).toBeCloseTo(240, 1);
      expect((resized[1] as typeof text).style.fontSize).toBeCloseTo(text.style.fontSize * 1.5, 1);
      expect((resized[2] as PathNode).width).toBeCloseTo(120, 1);

      // Thin horizontal line (height = 1) resized along east handle keeps height intact without jumping
      const thinLine = createLineNode(100, 100, 200, 100);
      const lineBounds = getBounds([thinLine])!;
      const stretched = resizeNodes([thinLine], lineBounds, 'e', 50, 0);
      expect(stretched[0].width).toBeCloseTo(150, 1);
      expect(stretched[0].height).toBeCloseTo(thinLine.height, 1);
    });

    it('bypasses move snapping when Ctrl/Cmd is held and keeps Alt+Drag multi-clone consistent', () => {
      const a = makeRect('a', 100, 100, 80, 60);
      const b = makeRect('b', 100, 180, 80, 60);
      const target = makeRect('t', 250, 100, 80, 60);
      const select = getStudioTool('select');
      const nodes = [a, b, target];

      const down = select.onPointerDown(
        makePointer({ targetNodeId: 'a', point: { x: 120, y: 120 } }),
        makeContext(nodes, ['a', 'b']),
      );
      // Without Ctrl: 100+80+66 = 246 snaps to target.x=250 (dx=70)
      const moveSnap = select.onPointerMove(
        makePointer({ point: { x: 186, y: 120 } }),
        makeContext(nodes, ['a', 'b'], { session: down.session ?? null }),
      );
      expect(moveSnap.previewNodes?.[0].x).toBe(170);
      expect(moveSnap.previewNodes?.[1].x).toBe(170);
      expect(moveSnap.guides?.length).toBeGreaterThan(0);

      // With Ctrl: bypasses snap -> exact raw dx=66
      const moveNoSnap = select.onPointerMove(
        makePointer({ point: { x: 186, y: 120 }, ctrlKey: true }),
        makeContext(nodes, ['a', 'b'], { session: down.session ?? null }),
      );
      expect(moveNoSnap.previewNodes?.[0].x).toBe(166);
      expect(moveNoSnap.guides).toEqual([]);

      // Mid-drag toggle Alt ON switches cleanly to clone ghost preview; Alt OFF switches back to normal move
      const altOn = select.onPointerMove(
        makePointer({ point: { x: 186, y: 120 }, altKey: true, ctrlKey: true }),
        makeContext(nodes, ['a', 'b'], { session: moveNoSnap.session ?? null }),
      );
      expect(altOn.previewNodes).toBeNull();
      expect(altOn.previewCreateNodes).toHaveLength(2);

      const altOff = select.onPointerMove(
        makePointer({ point: { x: 186, y: 120 }, altKey: false, ctrlKey: true }),
        makeContext(nodes, ['a', 'b'], { session: altOn.session ?? null }),
      );
      expect(altOff.previewCreateNodes).toBeNull();
      expect(altOff.previewNodes).toHaveLength(2);
    });
  });

  describe('2. Escape Cancel & Mid-Gesture Modifiers Leave Zero Artifacts', () => {
    it('cancels every stateful tool cleanly on Escape without committing or leaving stale previews/guides', () => {
      const a = makeRect('a', 100, 100, 100, 100);
      const b = makeRect('b', 150, 100, 100, 100);
      const poly = createPolygonNode(300, 100, 100, 100, 5);
      const esc = makeKey('Escape');

      // Select drag + Escape
      const select = getStudioTool('select');
      const sDown = select.onPointerDown(makePointer({ targetNodeId: 'a', point: { x: 120, y: 120 } }), makeContext([a, b], ['a']));
      const sMove = select.onPointerMove(makePointer({ point: { x: 180, y: 150 } }), makeContext([a, b], ['a'], { session: sDown.session ?? null }));
      const sEsc = select.onKeyDown(esc, makeContext([a, b], ['a'], { session: sMove.session ?? null }));
      expect(sEsc).toMatchObject({ session: null, previewNodes: null, previewCreateNodes: null, guides: [] });
      expect(sEsc.commitNodes).toBeUndefined();
      expect(sEsc.createNodes).toBeUndefined();

      // Pivot drag + Escape restores initialPivot
      const origPivot = { x: 150, y: 150 };
      const pDown = select.onPointerDown(
        makePointer({ point: { x: 150, y: 150 }, smartHandleHit: { kind: 'pivot' } }),
        makeContext([a], ['a'], { customPivot: origPivot }),
      );
      const pMove = select.onPointerMove(
        makePointer({ point: { x: 220, y: 220 } }),
        makeContext([a], ['a'], { session: pDown.session ?? null, customPivot: origPivot }),
      );
      expect(pMove.customPivot).toEqual({ x: 220, y: 220 });
      const pEsc = select.onKeyDown(esc, makeContext([a], ['a'], { session: pMove.session ?? null, customPivot: pMove.customPivot }));
      expect(pEsc.session).toBeNull();
      expect(pEsc.customPivot).toEqual(origPivot);

      // Draw rect + Escape
      const drawRect = getStudioTool('draw-rect');
      const dDown = drawRect.onPointerDown(makePointer({ point: { x: 20, y: 20 } }), makeContext([a]));
      const dMove = drawRect.onPointerMove(makePointer({ point: { x: 140, y: 140 } }), makeContext([a], [], { session: dDown.session ?? null }));
      const dEsc = drawRect.onKeyDown(esc, makeContext([a], [], { session: dMove.session ?? null }));
      expect(dEsc).toMatchObject({ session: null, previewNodes: null, previewCreateNodes: null, guides: [] });
      expect(dEsc.createNodes).toBeUndefined();

      // Pen draft + Escape
      const pen = getStudioTool('pen');
      let penSess = pen.onPointerDown(makePointer({ point: { x: 10, y: 10 } }), makeContext([])).session ?? null;
      penSess = pen.onPointerUp(makePointer({ point: { x: 10, y: 10 } }), makeContext([], [], { session: penSess })).session ?? null;
      penSess = pen.onPointerDown(makePointer({ point: { x: 90, y: 60 } }), makeContext([], [], { session: penSess })).session ?? null;
      const penEsc = pen.onKeyDown(esc, makeContext([], [], { session: penSess }));
      expect(penEsc.session).toBeNull();
      expect(penEsc.createNodes).toBeUndefined();

      // Shape Builder + Escape
      const sb = getStudioTool('shape-builder');
      const sbDown = sb.onPointerDown(makePointer({ point: { x: 120, y: 150 } }), makeContext([a, b], ['a', 'b']));
      const sbMove = sb.onPointerMove(makePointer({ point: { x: 175, y: 150 } }), makeContext([a, b], ['a', 'b'], { session: sbDown.session ?? null }));
      const sbEsc = sb.onKeyDown(esc, makeContext([a, b], ['a', 'b'], { session: sbMove.session ?? null }));
      expect(sbEsc.session).toBeNull();
      expect(sbEsc.replaceNodes).toBeUndefined();

      // Direct Selection anchor edit + Escape
      const direct = getStudioTool('direct-selection');
      const aDown = direct.onPointerDown(
        makePointer({ point: { x: 350, y: 100 }, anchorHit: { nodeId: poly.id, pointIndex: 0, part: 'anchor' } }),
        makeContext([poly], [poly.id]),
      );
      const aMove = direct.onPointerMove(
        makePointer({ point: { x: 390, y: 140 } }),
        makeContext([poly], [poly.id], { session: aDown.session ?? null }),
      );
      const aEsc = direct.onKeyDown(esc, makeContext([poly], [poly.id], { session: aMove.session ?? null }));
      expect(aEsc).toMatchObject({ session: null, previewNodes: null, guides: [] });
      expect(aEsc.commitNodes).toBeUndefined();

      // Hand pan + Escape restores startPan
      const hand = getStudioTool('hand');
      const hDown = hand.onPointerDown(makePointer({ clientX: 100, clientY: 100 }), makeContext([], [], { pan: { x: 25, y: -15 } }));
      const hEsc = hand.onKeyDown(esc, makeContext([], [], { pan: { x: 90, y: 40 }, session: hDown.session ?? null }));
      expect(hEsc.session).toBeNull();
      expect(hEsc.pan).toEqual({ x: 25, y: -15 });

      // Scrubby Zoom + Escape restores startZoom and startPan
      const sz = getStudioTool('scrubby-zoom');
      const zDown = sz.onPointerDown(makePointer({ clientX: 100 }), makeContext([], [], { zoom: 1.2, pan: { x: 10, y: 20 } }));
      const zEsc = sz.onKeyDown(esc, makeContext([], [], { zoom: 2, pan: { x: -50, y: -30 }, session: zDown.session ?? null }));
      expect(zEsc.session).toBeNull();
      expect(zEsc.zoom).toBe(1.2);
      expect(zEsc.pan).toEqual({ x: 10, y: 20 });
    });
  });

  describe('3. Coordinate Precision & Hit-Testing Across Extreme Zoom Levels', () => {
    it('scales snap tolerances, Pen close ring, and Scissors/Anchor segment hits accurately from 15% to 600% zoom', () => {
      const highZoomCtx = { zoom: 6, canvasUnitsPerPixel: 1 / 6 };
      const lowZoomCtx = { zoom: 0.15, canvasUnitsPerPixel: 1 / 0.15 };
      expect(getCanvasUnitsPerPixel(highZoomCtx)).toBeCloseTo(1 / 6, 4);
      expect(getCanvasUnitsPerPixel(lowZoomCtx)).toBeCloseTo(1 / 0.15, 4);

      // Select drag snapping: 5 canvas units offset -> does NOT snap at 600% zoom (tolerance = 8/6 = 1.33u), DOES snap at 15% zoom (tolerance = 53.3u)
      const moving = makeRect('m', 100, 100, 100, 100);
      const target = makeRect('t', 300, 100, 100, 100);
      const select = getStudioTool('select');

      const downHigh = select.onPointerDown(
        makePointer({ targetNodeId: 'm', point: { x: 150, y: 150 } }),
        makeContext([moving, target], ['m'], highZoomCtx),
      );
      const moveHigh = select.onPointerMove(
        makePointer({ point: { x: 245, y: 150 } }), // right edge at 295 (5u away from 300)
        makeContext([moving, target], ['m'], { ...highZoomCtx, session: downHigh.session ?? null }),
      );
      expect(moveHigh.previewNodes?.[0].x).toBe(195); // precise, no false magnetic pull at 600% zoom!

      const downLow = select.onPointerDown(
        makePointer({ targetNodeId: 'm', point: { x: 150, y: 150 } }),
        makeContext([moving, target], ['m'], lowZoomCtx),
      );
      const moveLow = select.onPointerMove(
        makePointer({ point: { x: 245, y: 150 } }),
        makeContext([moving, target], ['m'], { ...lowZoomCtx, session: downLow.session ?? null }),
      );
      expect(moveLow.previewNodes?.[0].x).toBe(200); // snaps cleanly at 15% zoom!

      // Pen close-loop threshold: 8 canvas units away -> does NOT close at 600% zoom (threshold 2u), DOES close at 15% zoom (threshold 80u)
      const pen = getStudioTool('pen');
      const draftPoints = [
        { id: 'p0', x: 100, y: 100, pointType: 'corner' as const },
        { id: 'p1', x: 200, y: 100, pointType: 'corner' as const },
        { id: 'p2', x: 150, y: 200, pointType: 'corner' as const },
      ];
      const basePenSession = {
        kind: 'pen-draft' as const,
        mode: 'pen' as const,
        points: draftPoints,
        draggingHandle: false,
        pointerId: null,
        cursor: { x: 150, y: 200 },
        hoverClose: false,
      };
      const hoverHigh = pen.onPointerMove(
        makePointer({ point: { x: 108, y: 100 } }),
        makeContext([], [], { ...highZoomCtx, session: basePenSession }),
      );
      expect(hoverHigh.session?.kind === 'pen-draft' && hoverHigh.session.hoverClose).toBe(false);

      const hoverLow = pen.onPointerMove(
        makePointer({ point: { x: 108, y: 100 } }),
        makeContext([], [], { ...lowZoomCtx, session: basePenSession }),
      );
      expect(hoverLow.session?.kind === 'pen-draft' && hoverLow.session.hoverClose).toBe(true);

      // Scissors segment hit: 8 canvas units off a line -> misses at 600% zoom (tol 2.67u), hits at 15% zoom (tol 106u)
      const line = createLineNode(100, 100, 300, 100);
      const scissors = getStudioTool('scissors');
      const cutHigh = scissors.onPointerDown(
        makePointer({ targetNodeId: line.id, point: { x: 200, y: 108 } }),
        makeContext([line], [line.id], highZoomCtx),
      );
      expect(cutHigh.replaceNodeWithNodes).toBeUndefined();

      const cutLow = scissors.onPointerDown(
        makePointer({ targetNodeId: line.id, point: { x: 200, y: 108 } }),
        makeContext([line], [line.id], lowZoomCtx),
      );
      expect(cutLow.replaceNodeWithNodes?.nodes).toHaveLength(2);
    });
  });

  describe('4. 1 Complete Gesture = 1 Atomic Undo/Redo Step; Cancel & Zero-Delta = 0 Undo Steps', () => {
    it('commits one multi-frame drag as exactly 1 Undo step and keeps Escape cancel / zero-delta out of Undo history', () => {
      const baseProject = createInitialProject();
      const rectA = makeRect('undo-a', 100, 100, 100, 80);
      const rectB = makeRect('undo-b', 240, 100, 100, 80);
      const doc = { ...getActiveDocument(baseProject), nodes: [rectA, rectB] };
      const project = updateActiveDocument(baseProject, doc);
      let editor = createEditorState(project);
      const select = getStudioTool('select');

      // A) Escape cancel mid-drag -> 0 Undo steps
      const cDown = select.onPointerDown(makePointer({ targetNodeId: 'undo-a', point: { x: 120, y: 120 } }), makeContext([rectA, rectB], ['undo-a', 'undo-b']));
      const cMove = select.onPointerMove(makePointer({ point: { x: 190, y: 170 } }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: cDown.session ?? null }));
      const cEsc = select.onKeyDown(makeKey('Escape'), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: cMove.session ?? null }));
      editor = applyTransitionToEditor(editor, cEsc);
      expect(editor.past).toHaveLength(0);

      // B) Zero-delta round-trip drag (drag out, drag back to exact start, release) -> 0 Undo steps
      const zDown = select.onPointerDown(makePointer({ targetNodeId: 'undo-a', point: { x: 120, y: 120 } }), makeContext([rectA, rectB], ['undo-a', 'undo-b']));
      const zMove1 = select.onPointerMove(makePointer({ point: { x: 180, y: 160 } }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: zDown.session ?? null }));
      const zMoveBack = select.onPointerMove(makePointer({ point: { x: 120, y: 120 }, ctrlKey: true }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: zMove1.session ?? null }));
      const zUp = select.onPointerUp(makePointer({ point: { x: 120, y: 120 }, ctrlKey: true }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: zMoveBack.session ?? null }));
      expect(zUp.commitNodes).toBeUndefined();
      editor = applyTransitionToEditor(editor, zUp);
      expect(editor.past).toHaveLength(0);

      // C) Stationary Alt+Click without moving -> 0 Undo steps, no duplicate created
      const altClickDown = select.onPointerDown(
        makePointer({ targetNodeId: 'undo-a', point: { x: 120, y: 120 }, altKey: true }),
        makeContext([rectA, rectB], ['undo-a']),
      );
      const altClickUp = select.onPointerUp(
        makePointer({ point: { x: 120, y: 120 }, altKey: true }),
        makeContext([rectA, rectB], ['undo-a'], { session: altClickDown.session ?? null }),
      );
      expect(altClickUp.createNodes).toBeUndefined();
      editor = applyTransitionToEditor(editor, altClickUp);
      expect(editor.past).toHaveLength(0);

      // D) Full multi-frame drag of 2 nodes -> strictly 1 Undo step, clean Undo & Redo
      let sess = select.onPointerDown(makePointer({ targetNodeId: 'undo-a', point: { x: 120, y: 120 } }), makeContext([rectA, rectB], ['undo-a', 'undo-b'])).session ?? null;
      for (const pt of [{ x: 140, y: 130 }, { x: 165, y: 145 }, { x: 190, y: 160 }]) {
        const step = select.onPointerMove(makePointer({ point: pt, ctrlKey: true }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: sess }));
        expect(step.commitNodes).toBeUndefined(); // preview only during move!
        sess = step.session ?? null;
      }
      const up = select.onPointerUp(makePointer({ point: { x: 190, y: 160 }, ctrlKey: true }), makeContext([rectA, rectB], ['undo-a', 'undo-b'], { session: sess }));
      expect(up.commitNodes).toHaveLength(2);
      editor = applyTransitionToEditor(editor, up);
      expect(editor.past).toHaveLength(1);
      expect(getActiveDocument(editor.project).nodes[0].x).toBe(170);
      expect(getActiveDocument(editor.project).nodes[1].x).toBe(310);

      // Undo restores both nodes in 1 step
      const undone = editorReducer(editor, { type: 'undo' });
      expect(getActiveDocument(undone.project).nodes[0].x).toBe(100);
      expect(getActiveDocument(undone.project).nodes[1].x).toBe(240);

      // Redo reapplies both nodes in 1 step
      const redone = editorReducer(undone, { type: 'redo' });
      expect(getActiveDocument(redone.project).nodes[0].x).toBe(170);
      expect(getActiveDocument(redone.project).nodes[1].x).toBe(310);
    });

    it('guards Rotate, Pencil, and Smooth zero-delta interactions from creating empty Undo steps', () => {
      const rect = makeRect('rot-box', 100, 100, 80, 60);
      const rotate = getStudioTool('rotate');
      const rDown = rotate.onPointerDown(makePointer({ point: { x: 200, y: 130 } }), makeContext([rect], ['rot-box']));
      const rMove1 = rotate.onPointerMove(makePointer({ point: { x: 200, y: 190 } }), makeContext([rect], ['rot-box'], { session: rDown.session ?? null }));
      const rBack = rotate.onPointerMove(makePointer({ point: { x: 200, y: 130 } }), makeContext([rect], ['rot-box'], { session: rMove1.session ?? null }));
      const rUp = rotate.onPointerUp(makePointer({ point: { x: 200, y: 130 } }), makeContext([rect], ['rot-box'], { session: rBack.session ?? null }));
      expect(rUp.commitNodes).toBeUndefined();

      // Pencil single click without dragging -> no tiny speck node created
      const pencil = getStudioTool('pencil');
      const pDown = pencil.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([]));
      const pUp = pencil.onPointerUp(makePointer({ point: { x: 100.5, y: 100.2 } }), makeContext([], [], { session: pDown.session ?? null }));
      expect(pUp.createNodes).toBeUndefined();
      expect(pUp.session).toBeNull();

      // Smooth stroke far away from path -> no change -> 0 commits
      const poly = createPolygonNode(100, 100, 80, 80, 5);
      const smooth = getStudioTool('smooth');
      const smDown = smooth.onPointerDown(makePointer({ point: { x: 700, y: 700 } }), makeContext([poly], [poly.id]));
      const smMove = smooth.onPointerMove(makePointer({ point: { x: 740, y: 710 } }), makeContext([poly], [poly.id], { session: smDown.session ?? null }));
      const smUp = smooth.onPointerUp(makePointer({ point: { x: 740, y: 710 } }), makeContext([poly], [poly.id], { session: smMove.session ?? null }));
      expect(smUp.commitNodes).toBeUndefined();
    });
  });

  describe('5. Tool-State Isolation Across Tool Switches', () => {
    it('cancels active session cleanly on tool switch without leaking previews, guides, or commits to the next tool', () => {
      const a = makeRect('iso-a', 100, 100, 100, 100);
      const b = makeRect('iso-b', 150, 100, 100, 100);

      // Pen mid-draft -> switch to Select
      const pen = getStudioTool('pen');
      const penDown = pen.onPointerDown(makePointer({ point: { x: 40, y: 40 } }), makeContext([a, b]));
      const penCancel = pen.onPointerCancel(makePointer({ point: { x: 40, y: 40 } }), makeContext([a, b], [], { session: penDown.session ?? null }));
      expect(penCancel).toMatchObject({ session: null, previewNodes: null, previewCreateNodes: null, guides: [] });
      expect(penCancel.createNodes).toBeUndefined();

      // Select starts cleanly with null session and selects + drags 'a'
      const select = getStudioTool('select');
      const selDown = select.onPointerDown(makePointer({ targetNodeId: 'iso-a', point: { x: 120, y: 120 } }), makeContext([a, b], [], { session: null }));
      expect(selDown.session?.kind).toBe('select-transform');

      // Shape Builder mid-drag -> cancel on switch to Rotate -> Rotate starts clean
      const sb = getStudioTool('shape-builder');
      const sbDown = sb.onPointerDown(makePointer({ point: { x: 120, y: 150 } }), makeContext([a, b], ['iso-a', 'iso-b']));
      const sbCancel = sb.onPointerCancel(makePointer({ point: { x: 120, y: 150 } }), makeContext([a, b], ['iso-a', 'iso-b'], { session: sbDown.session ?? null }));
      expect(sbCancel).toMatchObject({ session: null, previewNodes: null, previewCreateNodes: null, guides: [] });
      expect(sbCancel.replaceNodes).toBeUndefined();

      const rotate = getStudioTool('rotate');
      const rotDown = rotate.onPointerDown(makePointer({ point: { x: 280, y: 150 } }), makeContext([a, b], ['iso-a', 'iso-b'], { session: null }));
      expect(rotDown.session?.kind).toBe('select-transform');
      expect(rotDown.session?.kind === 'select-transform' && rotDown.session.mode).toBe('rotate');
    });

    it('detects geometry changes accurately with nodesGeometryChanged', () => {
      const a = makeRect('g1', 10, 20, 100, 80);
      expect(nodesGeometryChanged([a], [{ ...a }])).toBe(false);
      expect(nodesGeometryChanged([a], [{ ...a, x: 10.001 }])).toBe(false);
      expect(nodesGeometryChanged([a], [{ ...a, x: 11 }])).toBe(true);
      expect(nodesGeometryChanged([a], [{ ...a, rotation: 5 }])).toBe(true);
      expect(nodesGeometryChanged([a], [{ ...a, style: { ...a.style, radius: 16 } } as DesignNode])).toBe(true);

      const snapRes = snapResizeBounds(
        { x: 100, y: 100, width: 100, height: 100 },
        'se',
        46,
        46,
        { x: 0, y: 0, width: 1200, height: 800 },
        [makeRect('ref', 250, 100, 50, 100)],
        8,
        { lockAspect: true },
      );
      expect(snapRes.dx).toBe(50);
      expect(snapRes.guides).toEqual([{ axis: 'x', position: 250 }]);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createFrameNode, createInitialProject, createRectNode } from '../src/core/document/factory';
import { moveLayer } from '../src/core/document/layers';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import type { DesignNode, FolioDocument, FrameNode, NodeLayoutConfig, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import { extractToolOperationsFromTransition } from '../src/core/tools/operationContract';
import { evaluateToolOperationBatch } from '../src/engines/canvas/geometryEngine';
import {
  buildAutoLayoutReorderPreviewNodes,
  buildAutoLayoutScrubPreviewNodes,
  computeAutoLayoutHandles,
  computeScrubbedGap,
  computeScrubbedPadding,
  getVisualFlowChildren,
  resolveAutoLayoutKeyboardReorder,
  resolveAutoLayoutReorder,
  resolveNativeMoveForVisualSlot,
} from '../src/engines/canvas/autoLayoutHandles';
import { selectTool } from '../src/engines/canvas/tools/select';
import type { CanvasToolContext, CanvasToolKeyInput, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';
import { computeAutoLayoutNodes } from '../src/engines/layout/autoLayout';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';

function makeFrame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  layout: NodeLayoutConfig,
  extra: Partial<FrameNode> = {},
): FrameNode {
  return {
    ...createFrameNode(0),
    id,
    name: id,
    x,
    y,
    width,
    height,
    layout,
    ...extra,
  };
}

function makeChild(
  id: string,
  parentId: string,
  width: number,
  height: number,
  extra: Partial<RectNode> = {},
): RectNode {
  return {
    ...createRectNode(0),
    id,
    name: id,
    parentId,
    x: 0,
    y: 0,
    width,
    height,
    ...extra,
  };
}

function makeFlexLayout(overrides: Partial<NodeLayoutConfig> = {}): NodeLayoutConfig {
  return {
    mode: 'flex',
    direction: 'row',
    wrap: 'nowrap',
    justifyContent: 'start',
    alignItems: 'start',
    gap: 16,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    paddingMode: 'uniform',
    ...overrides,
  };
}

function makeGridLayout(overrides: Partial<NodeLayoutConfig> = {}): NodeLayoutConfig {
  return {
    mode: 'grid',
    direction: 'row',
    wrap: 'nowrap',
    justifyContent: 'start',
    alignItems: 'start',
    gap: 16,
    columnGap: 16,
    rowGap: 12,
    gridColumns: 2,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    paddingMode: 'uniform',
    ...overrides,
  };
}

function makePointer(
  point: { x: number; y: number },
  extras: Partial<CanvasToolPointerInput> = {},
): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point,
    clientX: point.x,
    clientY: point.y,
    viewportAnchor: { x: 0, y: 0 },
    targetNodeId: null,
    resizeHandle: null,
    smartHandleHit: null,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    detail: 1,
    ...extras,
  };
}

function makeKey(key: string, extras: Partial<CanvasToolKeyInput> = {}): CanvasToolKeyInput {
  return {
    key,
    code: key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extras,
  };
}

function makeToolContext(nodes: DesignNode[], patch: Partial<CanvasToolContext> = {}): CanvasToolContext {
  const document: FolioDocument = { ...getActiveDocument(createInitialProject()), nodes };
  return {
    document,
    canvasNodes: nodes,
    selectableNodes: nodes,
    otherNodes: nodes,
    selectedNodeIds: [],
    selectedNodes: [],
    selectionBounds: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1200,
    session: null,
    ...patch,
  };
}

describe('On-Canvas Auto-Layout Direct Manipulation · Pure Geometry & Math', () => {
  it('computes Padding and Gap handles for Flex Row, Flex Column, Wrapped Flex, and CSS Grid', () => {
    const rowFrame = makeFrame('row-frame', 100, 100, 420, 140, makeFlexLayout({ gap: 20 }));
    const a = makeChild('a', 'row-frame', 100, 60);
    const b = makeChild('b', 'row-frame', 100, 60);
    const c = makeChild('c', 'row-frame', 100, 60);
    const solvedRow = computeAutoLayoutNodes([rowFrame, a, b, c]);
    const solvedRowFrame = solvedRow.find((n) => n.id === 'row-frame')!;

    const rowHandles = computeAutoLayoutHandles(solvedRowFrame, solvedRow, 1);
    expect(rowHandles).not.toBeNull();
    expect(rowHandles!.paddingHandles.map((h) => h.edge)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(rowHandles!.gapHandles).toHaveLength(2);
    expect(rowHandles!.gapHandles.every((h) => h.axis === 'horizontal' && h.barOrientation === 'vertical')).toBe(true);
    expect(rowHandles!.horizontalGapZones).toHaveLength(2);
    expect(rowHandles!.verticalGapZones).toHaveLength(0);

    // Column flex
    const colFrame = makeFrame('col-frame', 0, 0, 200, 320, makeFlexLayout({ direction: 'column', gap: 14 }));
    const ca = makeChild('ca', 'col-frame', 120, 60);
    const cb = makeChild('cb', 'col-frame', 120, 60);
    const solvedCol = computeAutoLayoutNodes([colFrame, ca, cb]);
    const colHandles = computeAutoLayoutHandles(solvedCol[0], solvedCol, 1)!;
    expect(colHandles.gapHandles).toHaveLength(1);
    expect(colHandles.gapHandles[0].axis).toBe('vertical');
    expect(colHandles.gapHandles[0].barOrientation).toBe('horizontal');

    // Wrapped flex exposes both main-axis horizontal gaps and cross-axis vertical row gap
    const wrapFrame = makeFrame('wrap-frame', 0, 0, 260, 240, makeFlexLayout({ wrap: 'wrap', gap: 12, rowGap: 18 }));
    const w1 = makeChild('w1', 'wrap-frame', 100, 60);
    const w2 = makeChild('w2', 'wrap-frame', 100, 60);
    const w3 = makeChild('w3', 'wrap-frame', 100, 60);
    const solvedWrap = computeAutoLayoutNodes([wrapFrame, w1, w2, w3]);
    const wrapHandles = computeAutoLayoutHandles(solvedWrap[0], solvedWrap, 1)!;
    expect(wrapHandles.gapHandles.some((h) => h.axis === 'horizontal')).toBe(true);
    expect(wrapHandles.gapHandles.some((h) => h.axis === 'vertical' && h.value === 18)).toBe(true);

    // CSS Grid 2x2 exposes both horizontal (columnGap) and vertical (rowGap) handles
    const gridFrame = makeFrame('grid-frame', 0, 0, 340, 260, makeGridLayout());
    const g1 = makeChild('g1', 'grid-frame', 100, 80);
    const g2 = makeChild('g2', 'grid-frame', 100, 80);
    const g3 = makeChild('g3', 'grid-frame', 100, 80);
    const g4 = makeChild('g4', 'grid-frame', 100, 80);
    const solvedGrid = computeAutoLayoutNodes([gridFrame, g1, g2, g3, g4]);
    const gridHandles = computeAutoLayoutHandles(solvedGrid[0], solvedGrid, 1)!;
    expect(gridHandles.layoutMode).toBe('grid');
    expect(gridHandles.gapHandles.filter((h) => h.axis === 'horizontal')).toHaveLength(2);
    expect(gridHandles.gapHandles.filter((h) => h.axis === 'vertical')).toHaveLength(1);
    expect(gridHandles.gapHandles.every((h) => h.isGrid)).toBe(true);
  });

  it('suppresses Gap handles on distributed justifyContent, ignores absolute/hidden children, and hides on tiny containers', () => {
    for (const justify of ['space-between', 'space-around', 'space-evenly'] as const) {
      const frame = makeFrame('dist', 0, 0, 360, 120, makeFlexLayout({ justifyContent: justify }));
      const a = makeChild('a', 'dist', 80, 60);
      const b = makeChild('b', 'dist', 80, 60);
      const solved = computeAutoLayoutNodes([frame, a, b]);
      const handles = computeAutoLayoutHandles(solved[0], solved, 1)!;
      expect(handles.paddingHandles).toHaveLength(4);
      expect(handles.gapHandles).toHaveLength(0);
    }

    // Absolute & hidden children are excluded from flow gap calculation
    const frame = makeFrame('mixed', 0, 0, 360, 120, makeFlexLayout({ gap: 16 }));
    const visibleFlow = makeChild('flow-1', 'mixed', 80, 60);
    const absChild = makeChild('abs-1', 'mixed', 40, 40, { layoutChild: { position: 'absolute' } });
    const hiddenChild = makeChild('hid-1', 'mixed', 80, 60, { visible: false });
    const solvedMixed = computeAutoLayoutNodes([frame, visibleFlow, absChild, hiddenChild]);
    const mixedHandles = computeAutoLayoutHandles(solvedMixed[0], solvedMixed, 1)!;
    expect(mixedHandles.gapHandles).toHaveLength(0);

    // Tiny container < 36px suppresses handles to avoid crowding resize handles
    const tiny = makeFrame('tiny', 0, 0, 30, 30, makeFlexLayout());
    expect(computeAutoLayoutHandles(tiny, [tiny], 1)).toBeNull();

    // Zoom-invariant hitboxes scale inversely with zoom
    const normal = makeFrame('zoom-frame', 0, 0, 300, 120, makeFlexLayout());
    const handles1x = computeAutoLayoutHandles(normal, [normal], 1)!;
    const handlesHalfZoom = computeAutoLayoutHandles(normal, [normal], 2)!;
    expect(handlesHalfZoom.paddingHandles[0].hitRect.height).toBeCloseTo(handles1x.paddingHandles[0].hitRect.height * 2, 5);
  });

  it('computes scrubbed Padding accurately with Alt pair, Shift uniform, Ctrl/Cmd 4px snap, clamp >= 0, and double-click reset', () => {
    const base = makeFlexLayout({ padding: { top: 16, right: 16, bottom: 16, left: 16 } });

    // Single edge (top pulls down +14 => 30)
    const single = computeScrubbedPadding(base, 'top', 0, 14);
    expect(single.nextLayout.padding).toEqual({ top: 30, right: 16, bottom: 16, left: 16 });
    expect(single.nextLayout.paddingMode).toBe('per-side');
    expect(single.activeEdges).toEqual(['top']);
    expect(single.hudLabel).toBe('Top: 30px');

    // Bottom pulls UP (-10 => inward +10 => 26) with Alt => top & bottom synced
    const altPair = computeScrubbedPadding(base, 'bottom', 0, -10, { altKey: true });
    expect(altPair.nextLayout.padding).toEqual({ top: 26, right: 16, bottom: 26, left: 16 });
    expect(altPair.activeEdges).toEqual(['top', 'bottom']);
    expect(altPair.hudLabel).toBe('V-Pad: 26px');

    // Right pulls LEFT (-7 => inward +7 => 23) with Shift + 4px snap => 24 uniform
    const shiftSnap = computeScrubbedPadding(base, 'right', -7, 0, { shiftKey: true, snapKey: true });
    expect(shiftSnap.nextLayout.padding).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
    expect(shiftSnap.nextLayout.paddingMode).toBe('uniform');
    expect(shiftSnap.activeEdges).toEqual(['top', 'right', 'bottom', 'left']);
    expect(shiftSnap.hudLabel).toBe('Padding: 24px');

    // Outward past 0 clamps at 0
    const clamped = computeScrubbedPadding(base, 'left', -999, 0);
    expect(clamped.nextLayout.padding.left).toBe(0);

    // Double-click resetZero
    const reset = computeScrubbedPadding(base, 'left', 0, 0, { resetZero: true, shiftKey: true });
    expect(reset.nextLayout.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('computes scrubbed Gap for Flex main/cross axis and CSS Grid independent & Shift-linked axes', () => {
    const flex = makeFlexLayout({ direction: 'row', gap: 16, wrap: 'wrap', rowGap: 12 });
    const flexMain = computeScrubbedGap(flex, 'horizontal', 10, 0);
    expect(flexMain.nextLayout.gap).toBe(26);
    expect(flexMain.hudLabel).toBe('Gap: 26px');

    const flexCross = computeScrubbedGap(flex, 'vertical', 0, 9, { snapKey: true });
    expect(flexCross.nextLayout.rowGap).toBe(20); // 12 + 9 = 21 -> snapped to 20
    expect(flexCross.hudLabel).toBe('Row Gap: 20px');

    const grid = makeGridLayout({ gap: 16, columnGap: 16, rowGap: 12 });
    const gridCol = computeScrubbedGap(grid, 'horizontal', 8, 0);
    expect(gridCol.nextLayout.columnGap).toBe(24);
    expect(gridCol.nextLayout.rowGap).toBe(12);
    expect(gridCol.hudLabel).toBe('Col Gap: 24px');

    const gridRow = computeScrubbedGap(grid, 'vertical', 0, -4);
    expect(gridRow.nextLayout.rowGap).toBe(8);
    expect(gridRow.nextLayout.columnGap).toBe(16);
    expect(gridRow.hudLabel).toBe('Row Gap: 8px');

    const gridLinked = computeScrubbedGap(grid, 'horizontal', 12, 0, { shiftKey: true });
    expect(gridLinked.nextLayout.columnGap).toBe(28);
    expect(gridLinked.nextLayout.rowGap).toBe(28);
    expect(gridLinked.nextLayout.gap).toBe(28);
    expect(gridLinked.hudLabel).toBe('Gap: 28px');

    const gridReset = computeScrubbedGap(grid, 'vertical', 0, 0, { resetZero: true });
    expect(gridReset.nextLayout.rowGap).toBe(0);
  });

  it('maps visual Drag-to-Reorder slots to exact Folio moveLayer paint-order calls across Flex Row, Column, Reverse, and CSS Grid', () => {
    const verifyReorderSequence = (
      layout: NodeLayoutConfig,
      frameW: number,
      frameH: number,
      dragId: string,
      targetPointer: { x: number; y: number },
      expectedVisualOrder: string[],
    ) => {
      const container = makeFrame('box', 0, 0, frameW, frameH, layout);
      const n1 = makeChild('n1', 'box', 80, 60);
      const n2 = makeChild('n2', 'box', 80, 60);
      const n3 = makeChild('n3', 'box', 80, 60);
      const n4 = makeChild('n4', 'box', 80, 60);
      const solved = computeAutoLayoutNodes([container, n1, n2, n3, n4]);
      const solvedBox = solved.find((n) => n.id === 'box')!;
      const dragged = solved.find((n) => n.id === dragId)!;

      const slot = resolveAutoLayoutReorder(solvedBox, dragged, targetPointer, solved);
      expect(slot).not.toBeNull();
      expect(slot!.move).not.toBeNull();

      const moved = moveLayer(solved, dragged.id, slot!.move!.targetId, slot!.move!.position);
      const resolvedAfter = computeAutoLayoutNodes(moved);
      const visualAfter = getVisualFlowChildren(
        resolvedAfter.find((n) => n.id === 'box')!,
        resolvedAfter,
      ).map((n) => n.id);
      expect(visualAfter).toEqual(expectedVisualOrder);
    };

    // Flex Row: visual [n1, n2, n3, n4]; drag n1 to far right -> [n2, n3, n4, n1]
    verifyReorderSequence(
      makeFlexLayout({ direction: 'row', gap: 16 }),
      500,
      120,
      'n1',
      { x: 420, y: 50 },
      ['n2', 'n3', 'n4', 'n1'],
    );

    // Flex Row: drag n4 to far left -> [n4, n1, n2, n3]
    verifyReorderSequence(
      makeFlexLayout({ direction: 'row', gap: 16 }),
      500,
      120,
      'n4',
      { x: 25, y: 50 },
      ['n4', 'n1', 'n2', 'n3'],
    );

    // Flex Column: visual [n1, n2, n3, n4]; drag n1 to bottom -> [n2, n3, n4, n1]
    verifyReorderSequence(
      makeFlexLayout({ direction: 'column', gap: 12 }),
      160,
      380,
      'n1',
      { x: 60, y: 310 },
      ['n2', 'n3', 'n4', 'n1'],
    );

    // Flex Row-Reverse: logical [n1, n2, n3, n4] renders visually as [n4, n3, n2, n1]
    // Dragging visually leftmost item (n4) to far right -> visual [n3, n2, n1, n4]
    verifyReorderSequence(
      makeFlexLayout({ direction: 'row-reverse', gap: 16 }),
      500,
      120,
      'n4',
      { x: 420, y: 50 },
      ['n3', 'n2', 'n1', 'n4'],
    );

    // CSS Grid 2x2: [n1, n2 / n3, n4]; drag n1 to right of n4 (bottom-right) -> [n2, n3, n4, n1]
    verifyReorderSequence(
      makeGridLayout({ gridColumns: 2, columnGap: 16, rowGap: 16 }),
      260,
      220,
      'n1',
      { x: 220, y: 150 },
      ['n2', 'n3', 'n4', 'n1'],
    );
  });

  it('returns null when Drag-to-Reorder escapes beyond 28px margin, and reports no-op when hovering original slot', () => {
    const container = makeFrame('row', 100, 100, 360, 120, makeFlexLayout({ gap: 16 }));
    const a = makeChild('a', 'row', 80, 60);
    const b = makeChild('b', 'row', 80, 60);
    const c = makeChild('c', 'row', 80, 60);
    const solved = computeAutoLayoutNodes([container, a, b, c]);
    const box = solved[0];
    const nodeA = solved.find((n) => n.id === 'a')!;

    // Staying over slot #1 is a no-op
    const sameSlot = resolveAutoLayoutReorder(box, nodeA, { x: 130, y: 150 }, solved);
    expect(sameSlot).not.toBeNull();
    expect(sameSlot!.isNoOp).toBe(true);
    expect(sameSlot!.move).toBeNull();
    expect(sameSlot!.hudText).toBe('Slot #1');

    // Escaping > 28px below container exits reorder mode
    const escaped = resolveAutoLayoutReorder(box, nodeA, { x: 200, y: 100 + 120 + 35 }, solved);
    expect(escaped).toBeNull();

    // Direct helper check for no-op slot
    expect(resolveNativeMoveForVisualSlot(box, [nodeA, solved[2], solved[3]], 'a', 0)).toBeNull();
  });

  it('resolves keyboard Arrow reordering for Flex Row, Flex Column, Flex Row-Reverse, and CSS Grid', () => {
    const row = makeFrame('row', 0, 0, 400, 100, makeFlexLayout({ direction: 'row' }));
    const a = makeChild('a', 'row', 80, 60);
    const b = makeChild('b', 'row', 80, 60);
    const c = makeChild('c', 'row', 80, 60);
    const solvedRow = computeAutoLayoutNodes([row, a, b, c]);

    // Move 'a' right -> slot #2
    const rightMove = resolveAutoLayoutKeyboardReorder(solvedRow[0], solvedRow[1], 'ArrowRight', solvedRow);
    expect(rightMove).not.toBeNull();
    expect(rightMove!.displaySlotNumber).toBe(2);
    const afterRight = moveLayer(solvedRow, 'a', rightMove!.targetId, rightMove!.position);
    expect(getVisualFlowChildren(afterRight[0], afterRight).map((n) => n.id)).toEqual(['b', 'a', 'c']);

    // Pressing ArrowUp in a horizontal flex row is ignored
    expect(resolveAutoLayoutKeyboardReorder(solvedRow[0], solvedRow[1], 'ArrowUp', solvedRow)).toBeNull();
    // Pressing ArrowLeft on first item is ignored
    expect(resolveAutoLayoutKeyboardReorder(solvedRow[0], solvedRow[1], 'ArrowLeft', solvedRow)).toBeNull();

    // CSS Grid 2x2: pressing ArrowDown on slot 0 jumps by gridColumns (2) to slot 2
    const grid = makeFrame('grid', 0, 0, 300, 240, makeGridLayout({ gridColumns: 2 }));
    const g1 = makeChild('g1', 'grid', 80, 60);
    const g2 = makeChild('g2', 'grid', 80, 60);
    const g3 = makeChild('g3', 'grid', 80, 60);
    const g4 = makeChild('g4', 'grid', 80, 60);
    const solvedGrid = computeAutoLayoutNodes([grid, g1, g2, g3, g4]);

    const gridDown = resolveAutoLayoutKeyboardReorder(solvedGrid[0], solvedGrid[1], 'ArrowDown', solvedGrid);
    expect(gridDown).not.toBeNull();
    expect(gridDown!.displaySlotNumber).toBe(3);
    const afterGridDown = moveLayer(solvedGrid, 'g1', gridDown!.targetId, gridDown!.position);
    expect(getVisualFlowChildren(afterGridDown[0], afterGridDown).map((n) => n.id)).toEqual(['g2', 'g3', 'g1', 'g4']);
  });

  it('produces live reflow previews for both spacing scrubs and drag-to-reorder', () => {
    const frame = makeFrame('stack', 0, 0, 400, 120, makeFlexLayout({ gap: 16 }));
    const a = makeChild('a', 'stack', 80, 60);
    const b = makeChild('b', 'stack', 80, 60);
    const solved = computeAutoLayoutNodes([frame, a, b]);
    const container = solved[0];
    const updatedContainer: DesignNode = {
      ...container,
      layout: { ...container.layout!, gap: 40 },
    };

    const scrubPreview = buildAutoLayoutScrubPreviewNodes(solved, updatedContainer);
    const bPreview = scrubPreview.find((n) => n.id === 'b')!;
    expect(bPreview.x).toBe(20 + 80 + 40);

    const ghostA = { ...solved[1], x: 240, y: 25 };
    const slot = resolveAutoLayoutReorder(container, solved[1], { x: 240, y: 50 }, solved)!;
    const reorderPreview = buildAutoLayoutReorderPreviewNodes(solved, ghostA, slot);
    // Sibling 'b' reflows left to slot #1 while dragged ghost stays at pointer position
    expect(reorderPreview.find((n) => n.id === 'b')!.x).toBe(20);
    expect(reorderPreview.find((n) => n.id === 'a')!.x).toBe(240);
  });
});

describe('On-Canvas Auto-Layout Direct Manipulation · End-to-End Native Command Pipeline', () => {
  function setupAutoLayoutStore(layout: NodeLayoutConfig = makeFlexLayout({ gap: 16 })) {
    const project = createInitialProject('AutoLayout E2E');
    const frame = makeFrame('al-box', 60, 60, 440, 160, layout);
    const c1 = makeChild('card-1', 'al-box', 90, 60);
    const c2 = makeChild('card-2', 'al-box', 90, 60);
    const c3 = makeChild('card-3', 'al-box', 90, 60);
    const solved = computeAutoLayoutNodes([frame, c1, c2, c3]);
    getActivePage(project).document.nodes = solved;

    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const notices: string[] = [];
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: () => {},
        onPanChange: () => {},
        onZoomChange: () => {},
        onNotice: (msg) => notices.push(msg),
      },
    });

    const executeTransition = (transition: ReturnType<typeof selectTool.onPointerUp>) => {
      const doc = getActiveDocument(store.getSnapshot().editorState.project);
      const ops = extractToolOperationsFromTransition('select', 'main', transition);
      if (ops.length === 0) return [];
      const evalResult = evaluateToolOperationBatch(ops, {
        document: doc,
        selectedNodeIds: store.getSnapshot().editorState.selectedNodeIds,
      });
      if (evalResult.status === 'rejected') {
        throw new Error(`Geometry engine rejected operation: ${evalResult.rejected[0]?.reason ?? 'unknown'}`);
      }
      return executor.executeBatch(evalResult.ready);
    };

    return { store, commandClient, executor, executeTransition, notices };
  }

  it('scrubs Padding handle end-to-end, commits 1 atomic Undo step, preserves HTML/CSS & React parity, and supports double-click reset', () => {
    const { store, commandClient, executeTransition } = setupAutoLayoutStore();
    const initialNodes = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    const container = initialNodes.find((n) => n.id === 'al-box')!;

    const ctx = makeToolContext(initialNodes, {
      selectedNodeIds: ['al-box'],
      selectedNodes: [container],
    });

    // Pointer down on top padding handle
    const down = selectTool.onPointerDown(
      makePointer(
        { x: 280, y: 70 },
        { smartHandleHit: { kind: 'autolayout-padding', nodeId: 'al-box', edge: 'top' } },
      ),
      ctx,
    );
    expect(down.session?.kind).toBe('smart-handle');
    expect(selectTool.cursorStyle({ ...ctx, session: down.session ?? null })).toBe('ns-resize');

    // Drag down +24px with Shift (uniform all 4 sides: 20 + 24 = 44)
    const moved = selectTool.onPointerMove(
      makePointer({ x: 280, y: 94 }, { shiftKey: true }),
      { ...ctx, session: down.session ?? null },
    );
    expect(moved.previewNodes?.find((n) => n.id === 'al-box')?.layout?.padding).toEqual({
      top: 44,
      right: 44,
      bottom: 44,
      left: 44,
    });
    const overlay = selectTool.renderOverlay({ ...ctx, session: moved.session ?? null });
    expect(overlay?.kind).toBe('smart-hud');
    if (overlay?.kind === 'smart-hud') {
      expect(overlay.variant).toBe('spacing');
      expect(overlay.text).toBe('Padding: 44px');
    }

    // Pointer up commits through Native Command Engine in 1 atomic Undo step
    const up = selectTool.onPointerUp(
      makePointer({ x: 280, y: 94 }, { shiftKey: true }),
      { ...ctx, session: moved.session ?? null },
    );
    const reports = executeTransition(up);
    expect(reports.every((r) => r.status === 'applied')).toBe(true);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);

    const committedProject = store.getSnapshot().editorState.project;
    expect(validateProject(committedProject).ok).toBe(true);
    const updatedBox = getActiveDocument(committedProject).nodes.find((n) => n.id === 'al-box')!;
    expect(updatedBox.layout?.padding).toEqual({ top: 44, right: 44, bottom: 44, left: 44 });

    // Codegen parity (HTML/CSS + React)
    const page = getActivePage(committedProject);
    const htmlCss = compilePageHtmlCss(committedProject, page);
    expect(htmlCss.cssFile.content).toContain('padding: 44px');
    const reactFiles = compileReactProjectFiles(committedProject);
    const reactCode = reactFiles.map((f) => f.content).join('\n');
    expect(reactCode).toContain('../styles/index.css');
    expect(reactCode).toContain('data-folio-id="al-box"');

    // Double-click left padding handle resets padding to 0px
    const nodesNow = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    const ctxNow = makeToolContext(nodesNow, {
      selectedNodeIds: ['al-box'],
      selectedNodes: [nodesNow.find((n) => n.id === 'al-box')!],
    });
    const dbl = selectTool.onPointerDown(
      makePointer(
        { x: 70, y: 140 },
        {
          detail: 2,
          shiftKey: true,
          smartHandleHit: { kind: 'autolayout-padding', nodeId: 'al-box', edge: 'left' },
        },
      ),
      ctxNow,
    );
    expect(dbl.session ?? null).toBeNull();
    expect(dbl.commitNodes?.[0]?.layout?.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    executeTransition(dbl);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'al-box')?.layout?.padding.left).toBe(0);

    // Undo twice returns cleanly to 44px then original 20px
    expect(commandClient.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'al-box')?.layout?.padding.top).toBe(44);
    expect(commandClient.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'al-box')?.layout?.padding.top).toBe(20);
  });

  it('scrubs CSS Grid columnGap independently and cancels cleanly on Escape without committing', () => {
    const { store, executeTransition } = setupAutoLayoutStore(makeGridLayout({ columnGap: 16, rowGap: 12 }));
    const nodes = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    const container = nodes.find((n) => n.id === 'al-box')!;
    const ctx = makeToolContext(nodes, {
      selectedNodeIds: ['al-box'],
      selectedNodes: [container],
    });

    const down = selectTool.onPointerDown(
      makePointer(
        { x: 200, y: 110 },
        { smartHandleHit: { kind: 'autolayout-gap', nodeId: 'al-box', axis: 'horizontal', gapIndex: 0 } },
      ),
      ctx,
    );
    expect(down.session?.kind).toBe('smart-handle');
    expect(selectTool.cursorStyle({ ...ctx, session: down.session ?? null })).toBe('ew-resize');

    const moved = selectTool.onPointerMove(
      makePointer({ x: 220, y: 110 }),
      { ...ctx, session: down.session ?? null },
    );
    expect(moved.previewNodes?.find((n) => n.id === 'al-box')?.layout?.columnGap).toBe(36);
    expect(moved.previewNodes?.find((n) => n.id === 'al-box')?.layout?.rowGap).toBe(12);

    // Escape cancels cleanly with zero history entry
    const cancelled = selectTool.onKeyDown(makeKey('Escape'), { ...ctx, session: moved.session ?? null });
    expect(cancelled.session).toBeNull();
    expect(cancelled.previewNodes).toBeNull();
    expect(cancelled.commitNodes).toBeUndefined();
    expect(store.getSnapshot().editorState.past).toHaveLength(0);

    // Commit when not cancelled
    const up = selectTool.onPointerUp(
      makePointer({ x: 220, y: 110 }),
      { ...ctx, session: moved.session ?? null },
    );
    executeTransition(up);
    const after = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'al-box')!;
    expect(after.layout?.columnGap).toBe(36);
    expect(after.layout?.rowGap).toBe(12);
  });

  it('reorders a flow child via On-Canvas Drag-to-Reorder and Keyboard Arrow keys with atomic Undo/Redo', () => {
    const { store, commandClient, executeTransition } = setupAutoLayoutStore(makeFlexLayout({ direction: 'row', gap: 16 }));
    const nodes0 = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    const card1 = nodes0.find((n) => n.id === 'card-1')!;
    const card3 = nodes0.find((n) => n.id === 'card-3')!;

    // Single-selected child inside Auto-Layout container
    const ctx = makeToolContext(nodes0, {
      selectedNodeIds: ['card-1'],
      selectedNodes: [card1],
    });

    const down = selectTool.onPointerDown(
      makePointer({ x: card1.x + 20, y: card1.y + 20 }, { targetNodeId: 'card-1' }),
      ctx,
    );
    expect(down.session?.kind).toBe('select-transform');

    // Drag card-1 past the right edge of card-3 -> slot #3
    const moved = selectTool.onPointerMove(
      makePointer({ x: card3.x + card3.width - 10, y: card3.y + 25 }),
      { ...ctx, session: down.session ?? null },
    );
    const overlay = selectTool.renderOverlay({ ...ctx, session: moved.session ?? null });
    expect(overlay?.kind).toBe('autolayout-reorder');
    if (overlay?.kind === 'autolayout-reorder') {
      expect(overlay.slot.hudText).toBe('Move to #3');
      expect(overlay.slot.orientation).toBe('vertical');
    }

    // Release emits moveLayer -> layer.move Native Command
    const up = selectTool.onPointerUp(
      makePointer({ x: card3.x + card3.width - 10, y: card3.y + 25 }),
      { ...ctx, session: moved.session ?? null },
    );
    expect(up.moveLayer).toEqual({
      nodeId: 'card-1',
      targetId: 'card-3',
      position: 'before',
    });

    const reports = executeTransition(up);
    expect(reports.some((r) => r.status === 'applied')).toBe(true);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);

    const nodes1 = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    const box1 = nodes1.find((n) => n.id === 'al-box')!;
    expect(getVisualFlowChildren(box1, nodes1).map((n) => n.id)).toEqual(['card-2', 'card-3', 'card-1']);

    // Now test Keyboard ArrowLeft on card-1 (moves from slot #3 back to slot #2)
    const card1After = nodes1.find((n) => n.id === 'card-1')!;
    const keyTransition = selectTool.onKeyDown(
      makeKey('ArrowLeft'),
      makeToolContext(nodes1, { selectedNodeIds: ['card-1'], selectedNodes: [card1After] }),
    );
    expect(keyTransition.moveLayer).not.toBeNull();
    executeTransition(keyTransition);

    const nodes2 = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(getVisualFlowChildren(nodes2.find((n) => n.id === 'al-box')!, nodes2).map((n) => n.id)).toEqual([
      'card-2',
      'card-1',
      'card-3',
    ]);
    expect(store.getSnapshot().editorState.past).toHaveLength(2);

    // Undo twice restores original order [card-1, card-2, card-3]
    expect(commandClient.undo().status).toBe('applied');
    expect(commandClient.undo().status).toBe('applied');
    const nodesRestored = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(getVisualFlowChildren(nodesRestored.find((n) => n.id === 'al-box')!, nodesRestored).map((n) => n.id)).toEqual([
      'card-1',
      'card-2',
      'card-3',
    ]);
  });
});

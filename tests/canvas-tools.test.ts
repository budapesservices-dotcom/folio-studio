import { describe, expect, it } from 'vitest';
import type { DesignNode, FolioDocument } from '../src/core/document/types';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import { getCanvasTool, CANVAS_TOOL_GROUPS, canvasToolRegistry, ToolRegistry } from '../src/engines/canvas/tools/registry';
import { selectTool, directSelectionTool } from '../src/engines/canvas/tools/select';
import { lassoSelectionTool } from '../src/engines/canvas/tools/lasso-selection';
import { magicWandTool, getMagicWandMatchIds } from '../src/engines/canvas/tools/magic-wand';
import { handTool } from '../src/engines/canvas/tools/hand';
import { scrubbyZoomTool, calculateScrubbyZoom } from '../src/engines/canvas/tools/scrubby-zoom';
import { pointInPolygon, polygonIntersectsBounds } from '../src/engines/canvas/tools/geometry';
import type { CanvasToolContext, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';

function rect(id: string, x: number, y: number, fill = '#8b7cf6'): DesignNode {
  return { ...createRectNode(), id, x, y, width: 30, height: 24, style: { fill, stroke: 'none', strokeWidth: 0, radius: 0 } };
}

function group(id: string, x = 0, y = 0): DesignNode {
  return { id, type: 'group', name: 'Group', x, y, width: 160, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, onCanvas: true };
}

function context(nodes: DesignNode[], patch: Partial<CanvasToolContext> = {}): CanvasToolContext {
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

function pointer(
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
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extras,
  };
}

describe('FOLIO Canvas Tool Engine · Wave 1', () => {
  it('registers all six Wave 1 tools in the central registry and assigns them to the correct groups', () => {
    const expected = ['select', 'direct-selection', 'lasso-selection', 'magic-wand', 'hand', 'scrubby-zoom'];
    expect(canvasToolRegistry.list().map((tool) => tool.id)).toEqual(expected);
    expect(CANVAS_TOOL_GROUPS.find((group) => group.id === 'selection')?.tools).toEqual([
      'select', 'direct-selection', 'lasso-selection', 'magic-wand',
    ]);
    expect(CANVAS_TOOL_GROUPS.find((group) => group.id === 'navigation')?.tools).toEqual(['hand', 'scrubby-zoom']);
    for (const id of expected) {
      const handler = getCanvasTool(id as Parameters<typeof getCanvasTool>[0]);
      expect(typeof handler.onPointerDown).toBe('function');
      expect(typeof handler.onPointerMove).toBe('function');
      expect(typeof handler.onPointerUp).toBe('function');
      expect(typeof handler.onKeyDown).toBe('function');
      expect(typeof handler.renderOverlay).toBe('function');
      expect(typeof handler.cursorStyle).toBe('function');
    }
  });

  it('rejects duplicate tool registration instead of silently replacing a handler', () => {
    const handler = getCanvasTool('select');
    expect(() => new ToolRegistry([handler, handler])).toThrow('Duplicate Canvas tool registration');
  });

  it('Select chooses a complete group hierarchy while Direct Selection targets the clicked child only', () => {
    const parent = group('group-a');
    const child = { ...rect('child-a', 20, 25), parentId: parent.id };
    const sibling = { ...rect('child-b', 70, 25), parentId: parent.id };
    const nodes = [parent, child, sibling];
    const input = pointer({ x: 24, y: 30 }, { targetNodeId: child.id });
    const ctx = context(nodes);

    const regular = selectTool.onPointerDown(input, ctx);
    const direct = directSelectionTool.onPointerDown(input, ctx);

    expect(regular.selection).toEqual([parent.id, child.id, sibling.id]);
    expect(direct.selection).toEqual([child.id]);
    expect(direct.session?.kind).toBe('select-transform');
  });

  it('Select moves a selected object as a preview and commits one final transform payload on pointer up', () => {
    const node = rect('move-me', 10, 20);
    const ctx = context([node]);
    const down = selectTool.onPointerDown(pointer({ x: 15, y: 25 }, { targetNodeId: node.id }), ctx);
    expect(down.session?.kind).toBe('select-transform');
    if (!down.session) throw new Error('Select did not begin a transform session');

    const moved = selectTool.onPointerMove(pointer({ x: 45, y: 65 }), { ...ctx, selectedNodeIds: [node.id], selectedNodes: [node], session: down.session });
    expect(moved.previewNodes?.[0]).toMatchObject({ id: node.id, x: 40, y: 60 });

    const finished = selectTool.onPointerUp(pointer({ x: 45, y: 65 }), {
      ...ctx, selectedNodeIds: [node.id], selectedNodes: [node], session: moved.session ?? down.session,
    });
    expect(finished.commitNodes?.[0]).toMatchObject({ id: node.id, x: 40, y: 60 });
    expect(finished.session).toBeNull();
  });

  it('Direct Selection supports the exact child while preserving the resize workflow', () => {
    const node = rect('child-resize', 10, 20);
    const input = pointer({ x: 10, y: 20 }, { targetNodeId: node.id, resizeHandle: 'se' });
    const ctx = context([node], {
      selectedNodeIds: [node.id],
      selectedNodes: [node],
      selectionBounds: { x: 10, y: 20, width: 30, height: 24 },
    });
    const result = directSelectionTool.onPointerDown(input, ctx);
    expect(result.session).toMatchObject({ kind: 'select-transform', mode: 'resize', handle: 'se' });
  });

  it('Lasso overlay tracks a freehand path and selects objects touched by the polygon', () => {
    const inside = rect('inside-lasso', 20, 20);
    const outside = rect('outside-lasso', 120, 120);
    const ctx = context([inside, outside]);
    let transition = lassoSelectionTool.onPointerDown(pointer({ x: 10, y: 10 }), ctx);
    expect(transition.session?.kind).toBe('lasso-selection');

    for (const point of [{ x: 60, y: 10 }, { x: 60, y: 60 }, { x: 10, y: 60 }]) {
      transition = lassoSelectionTool.onPointerMove(pointer(point), { ...ctx, session: transition.session ?? null });
    }
    const overlay = lassoSelectionTool.renderOverlay({ ...ctx, session: transition.session ?? null });
    expect(overlay?.kind).toBe('lasso');

    const finished = lassoSelectionTool.onPointerUp(pointer({ x: 10, y: 10 }), { ...ctx, session: transition.session ?? null });
    expect(finished.selection).toEqual([inside.id]);
    expect(finished.session).toBeNull();
  });

  it('Lasso geometry detects polygon containment and edge intersection', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
    expect(pointInPolygon({ x: 20, y: 20 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 20 }, polygon)).toBe(false);
    expect(polygonIntersectsBounds(polygon, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(polygonIntersectsBounds(polygon, { x: 45, y: 10, width: 20, height: 15 })).toBe(true);
    expect(polygonIntersectsBounds(polygon, { x: 80, y: 80, width: 10, height: 10 })).toBe(false);
  });

  it('Magic Wand matches all visible target-fill objects and excludes different fills', () => {
    const purpleA = rect('purple-a', 0, 0, '#8b7cf6');
    const purpleB = rect('purple-b', 60, 0, '#8B7CF6');
    const orange = rect('orange', 120, 0, '#f29c78');
    const nodes = [purpleA, purpleB, orange];
    expect(getMagicWandMatchIds(nodes, purpleA)).toEqual(['purple-a', 'purple-b']);

    const input = pointer({ x: 5, y: 5 }, { targetNodeId: purpleA.id });
    expect(magicWandTool.onPointerDown(input, context(nodes)).selection).toEqual(['purple-a', 'purple-b']);
  });

  it('Magic Wand falls back to node type when the target has no fill', () => {
    const groupA = group('group-a');
    const groupB = group('group-b', 200, 0);
    const rectA = rect('rect-a', 400, 0);
    expect(getMagicWandMatchIds([groupA, groupB, rectA], groupA)).toEqual(['group-a', 'group-b']);
  });

  it('Hand pans the viewport from pointer delta without creating a document transform', () => {
    const ctx = context([rect('stationary', 10, 10)], { pan: { x: 30, y: -12 } });
    const down = handTool.onPointerDown(pointer({ x: 0, y: 0 }, { clientX: 100, clientY: 120 }), ctx);
    expect(down.session?.kind).toBe('hand');
    const moved = handTool.onPointerMove(pointer({ x: 0, y: 0 }, { clientX: 145, clientY: 98 }), {
      ...ctx, session: down.session ?? null,
    });
    expect(moved.pan).toEqual({ x: 75, y: -34 });
    expect(moved.commitNodes).toBeUndefined();
  });

  it('Scrubby Zoom moves continuously while keeping the original pointer anchor fixed', () => {
    const result = calculateScrubbyZoom(1, 240, { x: 0, y: 0 }, { x: 120, y: 80 });
    expect(result.zoom).toBe(2);
    expect(result.pan).toEqual({ x: -120, y: -80 });

    const ctx = context([], { zoom: 1, pan: { x: 0, y: 0 } });
    const down = scrubbyZoomTool.onPointerDown(pointer({ x: 50, y: 50 }, {
      clientX: 180, clientY: 140, viewportAnchor: { x: 120, y: 80 },
    }), ctx);
    const moved = scrubbyZoomTool.onPointerMove(pointer({ x: 50, y: 50 }, { clientX: 420 }), {
      ...ctx, session: down.session ?? null,
    });
    expect(moved.zoom).toBe(2);
    expect(moved.pan).toEqual({ x: -120, y: -80 });
  });

  it('Scrubby Zoom clamps to the supported zoom range', () => {
    expect(calculateScrubbyZoom(1, 2000, { x: 0, y: 0 }, { x: 0, y: 0 }).zoom).toBe(2);
    expect(calculateScrubbyZoom(1, -2000, { x: 0, y: 0 }, { x: 0, y: 0 }).zoom).toBe(0.35);
  });
});

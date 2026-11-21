import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import {
  alignNodes,
  distributeNodes,
  getBounds,
  resizeNodes,
  snapTranslation,
} from '../src/engines/canvas/geometry';

describe('Canvas geometry engine', () => {
  it('calculates the shared bounds of a multi-selection', () => {
    const first = { ...createRectNode(), x: 10, y: 20, width: 100, height: 80 };
    const second = { ...createRectNode(), x: 160, y: 120, width: 40, height: 30 };

    expect(getBounds([first, second])).toEqual({
      x: 10,
      y: 20,
      width: 190,
      height: 130,
    });
  });

  it('snaps a moving selection to a nearby object edge', () => {
    const moving = { ...createRectNode(), x: 0, y: 0, width: 100, height: 100 };
    const target = { ...createRectNode(), x: 200, y: 200, width: 100, height: 100 };
    const result = snapTranslation(
      [moving],
      95,
      0,
      { x: 0, y: 0, width: 600, height: 600 },
      [target],
      8,
    );

    expect(result.dx).toBe(100);
    expect(result.guides.some((guide) => guide.axis === 'x' && guide.position === 200)).toBe(true);
  });

  it('resizes a selected object from its east handle', () => {
    const node = { ...createRectNode(), x: 10, y: 20, width: 100, height: 80 };
    const bounds = getBounds([node]);

    expect(bounds).not.toBeNull();
    const resized = resizeNodes([node], bounds!, 'e', 25, 0);
    expect(resized[0].x).toBe(10);
    expect(resized[0].width).toBe(125);
    expect(resized[0].height).toBe(80);
  });

  it('keeps the aspect ratio when resizing from a corner', () => {
    const node = { ...createRectNode(), x: 10, y: 20, width: 100, height: 50 };
    const bounds = getBounds([node]);

    expect(bounds).not.toBeNull();
    const resized = resizeNodes([node], bounds!, 'se', 40, 0);

    expect(resized[0].x).toBe(10);
    expect(resized[0].y).toBe(20);
    expect(resized[0].width).toBe(140);
    expect(resized[0].height).toBe(70);
    expect(resized[0].width / resized[0].height).toBe(2);
  });

  it('keeps the opposite corner anchored when resizing from the north-west handle', () => {
    const node = { ...createRectNode(), x: 10, y: 20, width: 100, height: 50 };
    const bounds = getBounds([node]);

    expect(bounds).not.toBeNull();
    const resized = resizeNodes([node], bounds!, 'nw', -20, -10);

    expect(resized[0].x).toBe(-10);
    expect(resized[0].y).toBe(10);
    expect(resized[0].width).toBe(120);
    expect(resized[0].height).toBe(60);
    expect(resized[0].x + resized[0].width).toBe(110);
    expect(resized[0].y + resized[0].height).toBe(70);
  });

  it('aligns a group to the left edge without changing its dimensions', () => {
    const first = { ...createRectNode(), x: 25, y: 10, width: 80, height: 60 };
    const second = { ...createRectNode(), x: 180, y: 90, width: 40, height: 30 };
    const aligned = alignNodes([first, second], 'left');

    expect(aligned.map((node) => node.x)).toEqual([25, 25]);
    expect(aligned.map((node) => node.width)).toEqual([80, 40]);
  });
  it('commits a group transform as one undoable history step', () => {
    const project = createInitialProject();
    const selected = getActiveDocument(project).nodes.slice(0, 2);
    const state = editorReducer(createEditorState(project), {
      type: 'select-nodes',
      nodeIds: selected.map((node) => node.id),
    });
    const moved = editorReducer(state, {
      type: 'transform-nodes',
      nodes: selected.map((node) => ({ ...node, x: node.x + 24 })),
    });

    expect(moved.selectedNodeIds).toEqual(selected.map((node) => node.id));
    expect(moved.selectedNodeId).toBeNull();
    expect(moved.past).toHaveLength(1);
    expect(getActiveDocument(moved.project).nodes[0].x).toBe(selected[0].x + 24);

    const undone = editorReducer(moved, { type: 'undo' });
    expect(getActiveDocument(undone.project).nodes[0].x).toBe(selected[0].x);
    const redone = editorReducer(undone, { type: 'redo' });
    expect(getActiveDocument(redone.project).nodes[0].x).toBe(selected[0].x + 24);
  });

  it('distributes objects horizontally with equal gaps and fixed outer edges', () => {
    const first = { ...createRectNode(), x: 10, y: 0, width: 20, height: 20 };
    const middle = { ...createRectNode(), x: 120, y: 0, width: 40, height: 20 };
    const last = { ...createRectNode(), x: 260, y: 0, width: 60, height: 20 };

    const distributed = distributeNodes([middle, last, first], 'horizontal');
    const byId = new Map(distributed.map((node) => [node.id, node]));

    expect(byId.get(first.id)?.x).toBe(10);
    expect(byId.get(middle.id)?.x).toBe(125);
    expect(byId.get(last.id)?.x).toBe(260);
  });

  it('distributes objects vertically without changing their dimensions', () => {
    const first = { ...createRectNode(), x: 0, y: 10, width: 20, height: 20 };
    const middle = { ...createRectNode(), x: 0, y: 120, width: 20, height: 40 };
    const last = { ...createRectNode(), x: 0, y: 260, width: 20, height: 60 };

    const distributed = distributeNodes([first, middle, last], 'vertical');

    expect(distributed.map((node) => node.y)).toEqual([10, 125, 260]);
    expect(distributed.map((node) => node.height)).toEqual([20, 40, 60]);
  });

});
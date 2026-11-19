import { describe, expect, it } from 'vitest';
import { createRectNode, createInitialProject } from '../src/core/document/factory';
import {
  expandSelectedLayerIds,
  expandSelectedLayers,
  getCanvasClickSelectionIds,
  getLayerAncestorIds,
  getEffectiveLayerStates,
  getLayerPanelRows,
  getLayerRenderOrder,
  placeLayersOnCanvas,
  moveLayer,
  moveLayers,
  removeLayersAndPromoteChildren,
  groupLayers,
  ungroupLayers,
} from '../src/core/document/layers';
import { getActiveDocument } from '../src/core/document/project';
import { createEditorState, editorReducer } from '../src/app/editorReducer';

function layer(id: string, parentId?: string, patch: Record<string, unknown> = {}) {
  return {
    ...createRectNode(),
    id,
    name: id.toUpperCase(),
    ...(parentId ? { parentId } : {}),
    ...patch,
  };
}

describe('layer hierarchy and panel operations', () => {
  it('renames multiple selected layers as one undoable numbered batch', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const one = { ...document.nodes[0], id: 'rename-one', name: 'Old A' };
    const two = { ...document.nodes[1], id: 'rename-two', name: 'Old B' };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [one, two] } })),
    };
    const initial = createEditorState(prepared);
    const renamed = editorReducer(initial, {
      type: 'rename-nodes',
      updates: [{ nodeId: one.id, name: 'Card 1' }, { nodeId: two.id, name: 'Card 2' }],
    });
    const renamedNodes = getActiveDocument(renamed.project).nodes;
    expect(renamedNodes.map((node) => node.name)).toEqual(['Card 1', 'Card 2']);
    expect(getActiveDocument(editorReducer(renamed, { type: 'undo' }).project).nodes.map((node) => node.name)).toEqual(['Old A', 'Old B']);
  });

  it('applies one layer color to every selected layer in a single history step', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const one = { ...document.nodes[0], id: 'batch-color-one', layerColor: '#ef4444' };
    const two = { ...document.nodes[1], id: 'batch-color-two', layerColor: '#3b82f6' };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [one, two] } })),
    };
    const initial = createEditorState(prepared);
    const colored = editorReducer(initial, {
      type: 'set-nodes-properties',
      nodeIds: [one.id, two.id],
      properties: { layerColor: '#22c55e' },
    });
    expect(getActiveDocument(colored.project).nodes.map((node) => node.layerColor)).toEqual(['#22c55e', '#22c55e']);
    expect(colored.past).toHaveLength(initial.past.length + 1);
  });

  it('stores layer marker colors without changing the visual fill', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const node = { ...document.nodes[0], id: 'color-layer', layerColor: '#ff8800' };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [node] } })),
    };
    const initial = createEditorState(prepared);
    const colored = editorReducer(initial, {
      type: 'set-nodes-properties',
      nodeIds: [node.id],
      properties: { layerColor: '#22aa88' },
    });
    const result = getActiveDocument(colored.project).nodes[0];
    expect(result.layerColor).toBe('#22aa88');
    expect(result.type === 'rect' ? result.style.fill : '').toBe(node.type === 'rect' ? node.style.fill : '');
  });

  it('lists top-level layers in reverse paint order and nests children under their parent', () => {
    const nodes = [layer('back'), layer('parent'), layer('child-a', 'parent'), layer('child-b', 'parent')];
    expect(getLayerPanelRows(nodes).map(({ node, depth }) => [node.id, depth])).toEqual([
      ['parent', 0],
      ['child-b', 1],
      ['child-a', 1],
      ['back', 0],
    ]);
  });

  it('inherits parent visibility and lock state for nested layers', () => {
    const nodes = [
      layer('parent', undefined, { visible: false, locked: true }),
      layer('child', 'parent', { visible: true, locked: false }),
    ];
    const states = getEffectiveLayerStates(nodes);
    expect(states.get('parent')).toEqual({ visible: false, locked: true });
    expect(states.get('child')).toEqual({ visible: false, locked: true });
  });

  it('moves a layer into another layer and keeps paint order and hierarchy', () => {
    const nodes = [layer('back'), layer('front')];
    const moved = moveLayer(nodes, 'back', 'front', 'inside');
    expect(moved.find((node) => node.id === 'back')?.parentId).toBe('front');
    expect(getLayerRenderOrder(moved).map((node) => node.id)).toEqual(['front', 'back']);
    expect(getLayerPanelRows(moved).map(({ node, depth }) => [node.id, depth])).toEqual([
      ['front', 0],
      ['back', 1],
    ]);
  });

  it('reorders a layer above or below another layer in the panel', () => {
    const nodes = [layer('a'), layer('b'), layer('c')];
    const moved = moveLayer(nodes, 'c', 'a', 'after');
    expect(getLayerPanelRows(moved).map(({ node }) => node.id)).toEqual(['b', 'a', 'c']);
  });

  it('prevents dropping a parent into its own descendant', () => {
    const nodes = [layer('parent'), layer('child', 'parent')];
    expect(moveLayer(nodes, 'parent', 'child', 'inside')).toBe(nodes);
  });

  it('expands a selected parent into every nested layer in stable document order', () => {
    const nodes = [layer('parent'), layer('child', 'parent'), layer('leaf', 'child'), layer('other')];
    expect(expandSelectedLayerIds(nodes, ['parent'])).toEqual(['parent', 'child', 'leaf']);
    expect(expandSelectedLayers(nodes, ['parent']).map((node) => node.id)).toEqual(['parent', 'child', 'leaf']);
  });

  it('keeps an individually selected sub-layer separate from its siblings', () => {
    const nodes = [layer('parent'), layer('child-a', 'parent'), layer('leaf', 'child-a'), layer('child-b', 'parent')];
    expect(expandSelectedLayerIds(nodes, ['child-b'])).toEqual(['child-b']);
    expect(expandSelectedLayerIds(nodes, ['child-a'])).toEqual(['child-a', 'leaf']);
  });

  it('selects the entire component when any nested layer is clicked on canvas', () => {
    const nodes = [
      layer('parent'),
      layer('child-a', 'parent'),
      layer('leaf', 'child-a'),
      layer('child-b', 'parent'),
      layer('other'),
    ];
    const componentIds = ['parent', 'child-a', 'leaf', 'child-b'];

    expect(getCanvasClickSelectionIds(nodes, 'parent')).toEqual(componentIds);
    expect(getCanvasClickSelectionIds(nodes, 'child-a')).toEqual(componentIds);
    expect(getCanvasClickSelectionIds(nodes, 'leaf')).toEqual(componentIds);
    expect(getCanvasClickSelectionIds(nodes, 'child-b')).toEqual(componentIds);
  });

  it('lets Shift-click select the exact nested layer on canvas', () => {
    const nodes = [layer('parent'), layer('child', 'parent'), layer('leaf', 'child')];
    expect(getCanvasClickSelectionIds(nodes, 'child', true)).toEqual(['child']);
    expect(getCanvasClickSelectionIds(nodes, 'leaf', true)).toEqual(['leaf']);
  });

  it('returns a cycle-safe ancestor chain for deselecting a nested layer', () => {
    const nodes = [layer('parent'), layer('child', 'parent'), layer('leaf', 'child')];
    expect([...getLayerAncestorIds(nodes, 'leaf')]).toEqual(['child', 'parent']);
  });

  it('removes a layer from Canvas without deleting its Layers entry', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const original = { ...document.nodes[0], id: 'canvas-only-remove' };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [original] } })),
    };
    const initial = createEditorState(prepared);
    const removedFromCanvas = editorReducer(initial, {
      type: 'set-nodes-canvas-state',
      nodeIds: [original.id],
      onCanvas: false,
    });
    const remaining = getActiveDocument(removedFromCanvas.project).nodes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(original.id);
    expect(remaining[0].onCanvas).toBe(false);
    const deletedFromLayers = editorReducer(removedFromCanvas, { type: 'delete-nodes', nodeIds: [original.id] });
    expect(getActiveDocument(deletedFromLayers.project).nodes).toHaveLength(0);
  });

  it('places an individual existing layer on Canvas without cloning it', () => {
    const nodes = [
      layer('parent', undefined, { onCanvas: false }),
      layer('child', 'parent', { onCanvas: false }),
      layer('other', undefined, { onCanvas: false }),
    ];
    const placed = placeLayersOnCanvas(nodes, ['child'], { x: 250, y: 180 });
    expect(placed).toHaveLength(nodes.length);
    expect(placed.find((node) => node.id === 'child')).toMatchObject({ onCanvas: true, x: 250, y: 180 });
    expect(placed.find((node) => node.id === 'parent')).toMatchObject({ onCanvas: false });
    expect(placed.find((node) => node.id === 'other')).toMatchObject({ onCanvas: false });
  });

  it('places a Group and its descendants as one existing block on Canvas', () => {
    const nodes = [
      layer('group', undefined, { type: 'group', x: 10, y: 20, width: 120, height: 90, onCanvas: false }),
      layer('child-a', 'group', { x: 30, y: 40, onCanvas: false }),
      layer('child-b', 'group', { x: 50, y: 60, onCanvas: false }),
      layer('other', undefined, { onCanvas: false }),
    ];
    const groupIds = expandSelectedLayerIds(nodes, ['group']);
    const placed = placeLayersOnCanvas(nodes, groupIds, { x: 220, y: 160 });
    expect(placed).toHaveLength(nodes.length);
    expect(groupIds).toEqual(['group', 'child-a', 'child-b']);
    expect(placed.filter((node) => groupIds.includes(node.id)).every((node) => node.onCanvas === true)).toBe(true);
    expect(placed.find((node) => node.id === 'group')?.x).toBe(220);
    expect(placed.find((node) => node.id === 'group')?.y).toBe(160);
    expect(placed.find((node) => node.id === 'other')?.onCanvas).toBe(false);
  });

  it('promotes surviving children when a parent layer is deleted', () => {
    const nodes = [layer('grandparent'), layer('parent', 'grandparent'), layer('child', 'parent')];
    const next = removeLayersAndPromoteChildren(nodes, ['parent']);
    expect(next.find((node) => node.id === 'child')?.parentId).toBe('grandparent');
    expect(getLayerPanelRows(next).map(({ node, depth }) => [node.id, depth])).toEqual([
      ['grandparent', 0],
      ['child', 1],
    ]);
  });


  it('collapses a parent so nested layers disappear from the panel tree', () => {
    const nodes = [layer('parent'), layer('child', 'parent'), layer('grandchild', 'child'), layer('other')];
    expect(getLayerPanelRows(nodes, ['parent']).map(({ node }) => node.id)).toEqual(['other', 'parent']);
    expect(getLayerPanelRows(nodes, ['child']).map(({ node }) => node.id)).toEqual(['other', 'parent', 'child']);
  });

  it('moves all selected layer roots into a target as one nested group', () => {
    const nodes = [layer('first'), layer('second'), layer('target')];
    const moved = moveLayers(nodes, ['first', 'second'], 'target', 'inside');
    expect(moved.find((node) => node.id === 'first')?.parentId).toBe('target');
    expect(moved.find((node) => node.id === 'second')?.parentId).toBe('target');
    expect(getLayerPanelRows(moved).map(({ node, depth }) => [node.id, depth])).toEqual([
      ['target', 0], ['second', 1], ['first', 1],
    ]);
  });

  it('keeps descendants attached when a selected parent and child are both dragged', () => {
    const nodes = [layer('selected-parent'), layer('selected-child', 'selected-parent'), layer('target')];
    const moved = moveLayers(nodes, ['selected-parent', 'selected-child'], 'target', 'inside');
    expect(moved.find((node) => node.id === 'selected-parent')?.parentId).toBe('target');
    expect(moved.find((node) => node.id === 'selected-child')?.parentId).toBe('selected-parent');
  });

  it('creates a dedicated Group container and restores children on ungroup', () => {
    const nodes = [layer('a'), layer('b'), layer('c')];
    const grouped = groupLayers(nodes, ['a', 'b']);
    const group = grouped.find((node) => node.type === 'group');
    expect(group).toBeDefined();
    expect(grouped).toHaveLength(4);
    expect(grouped.find((node) => node.id === 'a')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'b')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'c')?.parentId).toBeUndefined();
    expect(grouped.find((node) => node.id === 'a')?.x).toBe(nodes[0].x);
    expect(ungroupLayers(grouped, group ? [group.id] : [])).toEqual(nodes);
  });

  it('wraps a single parent hierarchy in a Group and ungroups it without losing children', () => {
    const nodes = [
      layer('parent', undefined, { x: 100, y: 100, width: 100, height: 80 }),
      layer('child', 'parent', { x: 160, y: 140, width: 90, height: 70 }),
      layer('grandchild', 'child', { x: 280, y: 220, width: 60, height: 50 }),
    ];
    // Panel/canvas selection may contain the parent and its descendants.
    const grouped = groupLayers(nodes, ['parent', 'child', 'grandchild']);
    const wrapper = grouped.find((node) => node.type === 'group');
    expect(wrapper).toBeDefined();
    expect(wrapper?.x).toBe(100);
    expect(wrapper?.y).toBe(100);
    expect(wrapper?.width).toBe(240);
    expect(wrapper?.height).toBe(170);
    expect(grouped.find((node) => node.id === 'parent')?.parentId).toBe(wrapper?.id);
    expect(grouped.find((node) => node.id === 'child')?.parentId).toBe('parent');
    expect(grouped.find((node) => node.id === 'grandchild')?.parentId).toBe('child');
    expect(ungroupLayers(grouped, wrapper ? [wrapper.id] : [])).toEqual(nodes);
  });

  it('wraps an existing Group again even when only that Group ID is selected', () => {
    const nodes = [layer('a'), layer('b')];
    const first = groupLayers(nodes, ['a', 'b']);
    const inner = first.find((node) => node.type === 'group')!;
    const nested = groupLayers(first, [inner.id]);
    const outer = nested.find((node) => node.type === 'group' && node.id !== inner.id);
    expect(outer).toBeDefined();
    expect(nested.find((node) => node.id === inner.id)?.parentId).toBe(outer?.id);
    expect(ungroupLayers(nested, outer ? [outer.id, inner.id, 'a', 'b'] : [])).toEqual(first);
  });

  it('groups selected layers from different parents without losing their subtrees', () => {
    const nodes = [
      layer('parent-a'),
      layer('a', 'parent-a'),
      layer('a-child', 'a'),
      layer('parent-b'),
      layer('b', 'parent-b'),
      layer('other'),
    ];
    const grouped = groupLayers(nodes, ['a', 'b']);
    const group = grouped.find((node) => node.type === 'group');
    expect(group).toBeDefined();
    expect(group?.parentId).toBeUndefined();
    expect(grouped.find((node) => node.id === 'a')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'b')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'a-child')?.parentId).toBe('a');
    expect(groupLayers(nodes, ['other'])).toBe(nodes);
  });

  it('ungroups children dropped inside a regular layer while preserving the visual parent', () => {
    const nodes = [layer('a'), layer('child-one', 'a'), layer('child-two', 'a'), layer('other')];
    const ungrouped = ungroupLayers(nodes, ['child-one', 'child-two']);
    expect(ungrouped.find((node) => node.id === 'a')).toBeDefined();
    expect(ungrouped.find((node) => node.id === 'child-one')?.parentId).toBeUndefined();
    expect(ungrouped.find((node) => node.id === 'child-two')?.parentId).toBeUndefined();
  });

  it('ungroups a selected regular parent by lifting children but keeping the parent', () => {
    const nodes = [layer('a'), layer('child', 'a'), layer('leaf', 'child')];
    const ungrouped = ungroupLayers(nodes, ['a', 'child', 'leaf']);
    expect(ungrouped.find((node) => node.id === 'a')).toBeDefined();
    expect(ungrouped.find((node) => node.id === 'child')?.parentId).toBeUndefined();
    expect(ungrouped.find((node) => node.id === 'leaf')?.parentId).toBe('child');
  });

  it('allows a Group container to be grouped again and ungrouped one level at a time', () => {
    const nodes = [layer('a'), layer('b'), layer('c')];
    const firstGroup = groupLayers(nodes, ['a', 'b']);
    const inner = firstGroup.find((node) => node.type === 'group')!;
    const outerNodes = groupLayers(firstGroup, [inner.id, 'c']);
    const outer = outerNodes.find((node) => node.type === 'group' && node.id !== inner.id)!;
    expect(outer).toBeDefined();
    expect(outerNodes.find((node) => node.id === inner.id)?.parentId).toBe(outer.id);
    // The canvas selection includes descendants; ungroup must unwrap only
    // the outer container and leave the nested Group intact.
    const oneLevel = ungroupLayers(outerNodes, [outer.id, inner.id]);
    expect(oneLevel.find((node) => node.id === inner.id)?.parentId).toBeUndefined();
    expect(oneLevel.some((node) => node.id === inner.id)).toBe(true);
    expect(ungroupLayers(firstGroup, [inner.id])).toEqual(nodes);
  });

  it('records layer nesting in project history and restores it with undo/redo', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const first = { ...document.nodes[0], id: 'history-first' };
    const second = { ...document.nodes[1], id: 'history-second' };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({
        ...page,
        document: { ...page.document, nodes: [first, second] },
      })),
    };
    const initial = createEditorState(prepared);
    const moved = editorReducer(initial, { type: 'move-layer', nodeId: first.id, targetId: second.id, position: 'inside' });
    expect(getActiveDocument(moved.project).nodes.find((node) => node.id === first.id)?.parentId).toBe(second.id);
    const undone = editorReducer(moved, { type: 'undo' });
    expect(getActiveDocument(undone.project).nodes.find((node) => node.id === first.id)?.parentId).toBeUndefined();
    const redone = editorReducer(undone, { type: 'redo' });
    expect(getActiveDocument(redone.project).nodes.find((node) => node.id === first.id)?.parentId).toBe(second.id);
  });
});

import { describe, expect, it } from 'vitest';
import { createRectNode, createInitialProject } from '../src/core/document/factory';
import {
  expandSelectedLayerIds,
  expandSelectedLayers,
  getLayerAncestorIds,
  getEffectiveLayerStates,
  getLayerPanelRows,
  getLayerRenderOrder,
  moveLayer,
  moveLayers,
  removeLayersAndPromoteChildren,
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

  it('returns a cycle-safe ancestor chain for deselecting a nested layer', () => {
    const nodes = [layer('parent'), layer('child', 'parent'), layer('leaf', 'child')];
    expect([...getLayerAncestorIds(nodes, 'leaf')]).toEqual(['child', 'parent']);
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

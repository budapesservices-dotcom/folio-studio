import { describe, expect, it } from 'vitest';
import type { DesignNode } from '../src/core/document/types';
import { createRectNode, createInitialProject } from '../src/core/document/factory';
import {
  expandSelectedLayerIds,
  expandSelectedLayers,
  getCanvasClickSelectionIds,
  getLayerAncestorIds,
  getLayerDescendantIds,
  getEffectiveLayerStates,
  getLayerPanelRows,
  getLayerRenderOrder,
  collapseLegacyCanvasInstances,
  getSelectedLayerRootIds,
  getClippingMaskBaseId,
  createClippingMask,
  removeClippingMask,
  getLayerClipMaskBaseIds,
  moveLayer,
  moveLayers,
  removeLayersAndPromoteChildren,
  groupLayers,
  ungroupLayers,
} from '../src/core/document/layers';
import { getActiveDocument } from '../src/core/document/project';
import { validateProject } from '../src/core/document/validation';
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

  it('creates a Photoshop-style clipping mask from the selected upper sibling to the layer below', () => {
    const nodes = [
      layer('base', undefined, { x: 10, y: 20 }),
      layer('content', undefined, { x: 90, y: 100 }),
      layer('top'),
    ];
    expect(getClippingMaskBaseId(nodes, 'content')).toBe('base');
    const masked = createClippingMask(nodes, 'content');
    expect(masked.find((node) => node.id === 'content')?.clipMaskBaseId).toBe('base');
    expect(masked.find((node) => node.id === 'base')?.clipMaskBaseId).toBeUndefined();
    expect(masked.find((node) => node.id === 'content')?.x).toBe(90);
    expect(masked.find((node) => node.id === 'content')?.y).toBe(100);
    expect(removeClippingMask(masked, 'content').find((node) => node.id === 'content')?.clipMaskBaseId).toBeUndefined();
  });

  it('clips Group content as one component and propagates its mask to descendants', () => {
    const nodes = [
      layer('base'),
      layer('group', undefined, { type: 'group' }),
      layer('group-child', 'group'),
      layer('group-grandchild', 'group-child'),
    ];
    const selected = ['group', 'group-child', 'group-grandchild'];
    expect(getSelectedLayerRootIds(nodes, selected)).toEqual(['group']);
    const masked = createClippingMask(nodes, 'group');
    expect(masked.find((node) => node.id === 'group')?.clipMaskBaseId).toBe('base');
    expect(getLayerClipMaskBaseIds(masked, 'group-child')).toEqual(['base']);
    expect(getLayerClipMaskBaseIds(masked, 'group-grandchild')).toEqual(['base']);
  });

  it('treats all canvas objects as one layer tree for multi-selection and clipping', () => {
    const nodes = [layer('base'), layer('content'), layer('top')];
    expect(getSelectedLayerRootIds(nodes, ['base', 'content'])).toEqual(['base', 'content']);
    expect(getClippingMaskBaseId(nodes, 'content')).toBe('base');
    expect(createClippingMask(nodes, 'content').find((node) => node.id === 'content')?.clipMaskBaseId).toBe('base');
  });

  it('uses the ultimate base for a consecutive clipping stack', () => {
    const nodes = [
      layer('base'),
      layer('clipped-one', undefined, { clipMaskBaseId: 'base' }),
      layer('clipped-two'),
    ];
    expect(getClippingMaskBaseId(nodes, 'clipped-two')).toBe('base');
    expect(createClippingMask(nodes, 'clipped-two').find((node) => node.id === 'clipped-two')?.clipMaskBaseId).toBe('base');
  });

  it('removes a clipping relationship when its base layer is deleted', () => {
    const project = createInitialProject();
    const document = getActiveDocument(project);
    const base = { ...document.nodes[0], id: 'mask-base' };
    const content = { ...document.nodes[1], id: 'mask-content', clipMaskBaseId: base.id };
    const prepared = {
      ...project,
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [base, content] } })),
    };
    const result = editorReducer(createEditorState(prepared), { type: 'delete-nodes', nodeIds: [base.id] });
    expect(getActiveDocument(result.project).nodes[0].clipMaskBaseId).toBeUndefined();
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

  it('restores the same edited object after removing and re-adding it to Canvas', () => {
    const project = createInitialProject();
    const source = {
      ...layer('persistent-object'),
      x: 48, y: 72, width: 180, height: 96, rotation: 17, onCanvas: true,
    };
    const prepared = {
      ...project,
      pages: project.pages.map((page, index) => index === 0
        ? { ...page, document: { ...page.document, nodes: [source] } }
        : page),
    };
    const initial = createEditorState(prepared);
    const edited = editorReducer(initial, {
      type: 'edit-node',
      node: {
        ...source,
        x: 340, y: 210, width: 260, height: 130, rotation: 42,
        style: { ...source.style, fill: '#19a974', radius: 7 },
      },
      coalesceKey: 'test-edit-object',
    });
    const editedNode = getActiveDocument(edited.project).nodes[0];
    const removed = editorReducer(edited, {
      type: 'set-nodes-canvas-state', nodeIds: [source.id], onCanvas: false,
    });
    const restored = editorReducer(removed, {
      type: 'set-nodes-canvas-state', nodeIds: [source.id], onCanvas: true,
    });
    expect(getActiveDocument(restored.project).nodes).toHaveLength(1);
    expect(getActiveDocument(restored.project).nodes[0]).toEqual({ ...editedNode, onCanvas: true });
  });

  it('keeps off-canvas objects in Layers and restores them without creating a second node', () => {
    const object = { ...layer('off-canvas-object'), onCanvas: false };
    expect(getLayerPanelRows([object]).map(({ node }) => node.id)).toEqual([object.id]);

    const project = createInitialProject();
    const prepared = {
      ...project,
      pages: project.pages.map((page, index) => index === 0
        ? { ...page, document: { ...page.document, nodes: [object] } }
        : page),
    };
    const state = createEditorState(prepared);
    const restored = editorReducer(state, {
      type: 'set-nodes-canvas-state', nodeIds: [object.id], onCanvas: true,
    });
    expect(getActiveDocument(restored.project).nodes).toHaveLength(1);
    expect(getActiveDocument(restored.project).nodes[0].id).toBe(object.id);
  });

  it('collapses previously saved Canvas clones into one layer and preserves the latest visible edit', () => {
    const master = { ...layer('legacy-master'), x: 10, y: 20, width: 100, height: 60, onCanvas: false };
    const olderClone = {
      ...master, id: 'legacy-clone-older', x: 220, y: 140,
      onCanvas: true, isCanvasInstance: true, sourceLayerId: master.id,
    };
    const latestClone = {
      ...master, id: 'legacy-clone-latest', x: 420, y: 280, width: 240, height: 144,
      rotation: 28, style: { ...master.style, fill: '#ff3366' },
      onCanvas: true, isCanvasInstance: true, sourceLayerId: master.id,
    };
    const normalized = collapseLegacyCanvasInstances(
      [master, olderClone, latestClone] as unknown as DesignNode[],
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      id: master.id, x: 420, y: 280, width: 240, height: 144,
      rotation: 28, onCanvas: true, style: { fill: '#ff3366' },
    });
    expect('isCanvasInstance' in normalized[0]).toBe(false);
    expect('sourceLayerId' in normalized[0]).toBe(false);
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

  it('rebinds external clipping layers to the new Group when their base is grouped with another layer', () => {
    const nodes = [
      layer('base'),
      layer('group-companion'),
      layer('clipped-content', undefined, { clipMaskBaseId: 'base' }),
    ];

    const grouped = groupLayers(nodes, ['base', 'group-companion']);
    const group = grouped.find((node) => node.type === 'group' && !nodes.some((old) => old.id === node.id));

    expect(group).toBeDefined();
    expect(grouped.find((node) => node.id === 'base')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'group-companion')?.parentId).toBe(group?.id);
    expect(grouped.find((node) => node.id === 'clipped-content')?.clipMaskBaseId).toBe(group?.id);
    expect(getLayerClipMaskBaseIds(grouped, 'clipped-content')).toEqual([group?.id]);
    expect([...getLayerDescendantIds(grouped, group!.id)]).toEqual(expect.arrayContaining(['base', 'group-companion']));
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

  it('clears dangling clipMaskBaseId and cross-studio refs when ungrouping a Group so project validation & autosave never break', () => {
    const base = layer('mask-base');
    const companion = layer('mask-companion');
    const clipped = layer('clipped-content', undefined, { clipMaskBaseId: 'mask-base' });

    const grouped = groupLayers([base, companion, clipped], ['mask-base', 'mask-companion']);
    const group = grouped.find((node) => node.type === 'group')!;
    expect(grouped.find((node) => node.id === 'clipped-content')?.clipMaskBaseId).toBe(group.id);

    const ungrouped = ungroupLayers(grouped, [group.id]);
    expect(ungrouped.some((node) => node.id === group.id)).toBe(false);
    expect(ungrouped.find((node) => node.id === 'clipped-content')?.clipMaskBaseId).toBeUndefined();

    // End-to-end via editorReducer + validateProject + cross-studio cleanup + Undo
    const initialProject = createInitialProject();
    const activePageId = initialProject.activePageId;
    const now = new Date().toISOString();
    const projectWithGroupRefs = {
      ...initialProject,
      pages: initialProject.pages.map((page) =>
        page.id === activePageId
          ? { ...page, document: { ...page.document, nodes: grouped } }
          : page,
      ),
      logicGraphs: [
        {
          id: 'graph-group-ref',
          name: 'Group Click Logic',
          scope: 'page' as const,
          targetId: activePageId,
          variables: [],
          nodes: [
            {
              id: 'ln-group-click',
              type: 'event.on-click',
              x: 0,
              y: 0,
              data: { targetNodeId: group.id },
            },
          ],
          connections: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      animations: [
        {
          id: 'clip-group-ref',
          name: 'Group Motion',
          pageId: activePageId,
          durationMs: 1000,
          loop: false,
          autoplay: false,
          tracks: [
            {
              id: 'track-group-x',
              targetNodeId: group.id,
              property: 'x' as const,
              keyframes: [{ id: 'kf-1', timeMs: 0, value: 0, easing: 'linear' as const }],
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
      codeModules: [
        {
          id: 'mod-group-ref',
          path: 'custom/group.css',
          language: 'css' as const,
          mapping: 'extension' as const,
          targetPageId: activePageId,
          targetNodeId: group.id,
          content: '.group-ext { opacity: 0.9; }',
          updatedAt: now,
        },
      ],
    };

    expect(validateProject(projectWithGroupRefs).ok).toBe(true);
    const state0 = createEditorState(projectWithGroupRefs);
    const state1 = editorReducer(state0, { type: 'ungroup-layers', nodeIds: [group.id] });

    expect(validateProject(state1.project)).toEqual({ ok: true, project: state1.project });
    expect(getActiveDocument(state1.project).nodes.find((n) => n.id === 'clipped-content')?.clipMaskBaseId).toBeUndefined();
    expect(state1.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('');
    expect(state1.project.animations?.[0].tracks).toHaveLength(0);
    expect(state1.project.codeModules?.[0].targetNodeId).toBeUndefined();

    // Undo restores the Group, clipping mask, and all cross-studio references atomically
    const undone = editorReducer(state1, { type: 'undo' });
    expect(validateProject(undone.project).ok).toBe(true);
    expect(getActiveDocument(undone.project).nodes.find((n) => n.id === 'clipped-content')?.clipMaskBaseId).toBe(group.id);
    expect(undone.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe(group.id);
    expect(undone.project.animations?.[0].tracks).toHaveLength(1);
    expect(undone.project.codeModules?.[0].targetNodeId).toBe(group.id);
  });

  it('replace-node-with-nodes promotes children, clears broken clip masks, cleans cross-studio refs, and stays valid', () => {
    const initialProject = createInitialProject();
    const activePageId = initialProject.activePageId;
    const now = new Date().toISOString();
    const grandparent = layer('grandparent');
    const target = layer('split-target', 'grandparent');
    const child = layer('target-child', 'split-target');
    const clipped = layer('clipped-to-target', 'grandparent', { clipMaskBaseId: 'split-target' });
    const siblingAfter = layer('sibling-after');

    const project = {
      ...initialProject,
      pages: initialProject.pages.map((page) =>
        page.id === activePageId
          ? { ...page, document: { ...page.document, nodes: [grandparent, target, child, clipped, siblingAfter] } }
          : page,
      ),
      logicGraphs: [
        {
          id: 'graph-split',
          name: 'Split Logic',
          scope: 'page' as const,
          targetId: activePageId,
          variables: [],
          nodes: [
            { id: 'ln-split', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'split-target' } },
          ],
          connections: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      animations: [
        {
          id: 'clip-split',
          name: 'Split Motion',
          pageId: activePageId,
          durationMs: 1000,
          loop: false,
          autoplay: false,
          tracks: [
            {
              id: 'track-split-op',
              targetNodeId: 'split-target',
              property: 'opacity' as const,
              keyframes: [{ id: 'kf-s1', timeMs: 0, value: 1, easing: 'linear' as const }],
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
      codeModules: [
        {
          id: 'mod-split',
          path: 'custom/split.css',
          language: 'css' as const,
          mapping: 'extension' as const,
          targetPageId: activePageId,
          targetNodeId: 'split-target',
          content: '.split-ext { color: red; }',
          updatedAt: now,
        },
      ],
    };

    const pieceA = layer('piece-a', 'grandparent');
    const pieceB = layer('piece-b', 'grandparent');
    const state0 = createEditorState(project);
    const state1 = editorReducer(state0, {
      type: 'replace-node-with-nodes',
      nodeId: 'split-target',
      nodes: [pieceA, pieceB],
    });

    expect(validateProject(state1.project)).toEqual({ ok: true, project: state1.project });
    const nextNodes = getActiveDocument(state1.project).nodes;
    expect(nextNodes.map((n) => n.id)).toEqual([
      'grandparent',
      'piece-a',
      'piece-b',
      'target-child',
      'clipped-to-target',
      'sibling-after',
    ]);
    expect(nextNodes.find((n) => n.id === 'target-child')?.parentId).toBe('grandparent');
    expect(nextNodes.find((n) => n.id === 'clipped-to-target')?.clipMaskBaseId).toBeUndefined();
    expect(state1.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('');
    expect(state1.project.animations?.[0].tracks).toHaveLength(0);
    expect(state1.project.codeModules?.[0].targetNodeId).toBeUndefined();

    // Undo restores everything atomically
    const undone = editorReducer(state1, { type: 'undo' });
    expect(validateProject(undone.project).ok).toBe(true);
    const restoredNodes = getActiveDocument(undone.project).nodes;
    expect(restoredNodes.find((n) => n.id === 'target-child')?.parentId).toBe('split-target');
    expect(restoredNodes.find((n) => n.id === 'clipped-to-target')?.clipMaskBaseId).toBe('split-target');
    expect(undone.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('split-target');
    expect(undone.project.animations?.[0].tracks).toHaveLength(1);
    expect(undone.project.codeModules?.[0].targetNodeId).toBe('split-target');
  });

  it('replace-node-with-nodes preserves children and refs when a replacement reuses the original nodeId', () => {
    const initialProject = createInitialProject();
    const activePageId = initialProject.activePageId;
    const now = new Date().toISOString();
    const target = layer('keep-id');
    const child = layer('child-of-keep', 'keep-id');
    const clipped = layer('clipped-to-keep', undefined, { clipMaskBaseId: 'keep-id' });

    const project = {
      ...initialProject,
      pages: initialProject.pages.map((page) =>
        page.id === activePageId
          ? { ...page, document: { ...page.document, nodes: [target, child, clipped] } }
          : page,
      ),
      logicGraphs: [
        {
          id: 'graph-keep',
          name: 'Keep Logic',
          scope: 'page' as const,
          targetId: activePageId,
          variables: [],
          nodes: [
            { id: 'ln-keep', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'keep-id' } },
          ],
          connections: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    const state0 = createEditorState(project);
    const state1 = editorReducer(state0, {
      type: 'replace-node-with-nodes',
      nodeId: 'keep-id',
      nodes: [layer('keep-id', undefined, { x: 42 }), layer('extra-piece')],
    });

    expect(validateProject(state1.project).ok).toBe(true);
    const nextNodes = getActiveDocument(state1.project).nodes;
    expect(nextNodes.find((n) => n.id === 'child-of-keep')?.parentId).toBe('keep-id');
    expect(nextNodes.find((n) => n.id === 'clipped-to-keep')?.clipMaskBaseId).toBe('keep-id');
    expect(state1.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('keep-id');
  });

  it('replace-nodes cleans up cross-studio references for removed nodes and restores them on undo', () => {
    const initialProject = createInitialProject();
    const activePageId = initialProject.activePageId;
    const now = new Date().toISOString();
    const shapeA = layer('bool-a');
    const shapeB = layer('bool-b');
    const merged = layer('bool-merged');

    const project = {
      ...initialProject,
      pages: initialProject.pages.map((page) =>
        page.id === activePageId
          ? { ...page, document: { ...page.document, nodes: [shapeA, shapeB] } }
          : page,
      ),
      logicGraphs: [
        {
          id: 'graph-bool',
          name: 'Bool Logic',
          scope: 'page' as const,
          targetId: activePageId,
          variables: [],
          nodes: [
            { id: 'ln-a', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'bool-a' } },
            { id: 'ln-b', type: 'event.on-click', x: 100, y: 0, data: { targetNodeId: 'bool-b' } },
          ],
          connections: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      animations: [
        {
          id: 'clip-bool',
          name: 'Bool Motion',
          pageId: activePageId,
          durationMs: 1000,
          loop: false,
          autoplay: false,
          tracks: [
            {
              id: 'track-bool-a',
              targetNodeId: 'bool-a',
              property: 'x' as const,
              keyframes: [{ id: 'kf-b1', timeMs: 0, value: 0, easing: 'linear' as const }],
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
      codeModules: [
        {
          id: 'mod-bool',
          path: 'custom/bool.css',
          language: 'css' as const,
          mapping: 'extension' as const,
          targetPageId: activePageId,
          targetNodeId: 'bool-b',
          content: '.bool-ext { opacity: 0.8; }',
          updatedAt: now,
        },
      ],
    };

    const state0 = createEditorState(project);
    const state1 = editorReducer(state0, {
      type: 'replace-nodes',
      removeIds: ['bool-a', 'bool-b'],
      insertNodes: [merged],
    });

    expect(validateProject(state1.project).ok).toBe(true);
    expect(state1.project.logicGraphs[0].nodes.map((n) => n.data.targetNodeId)).toEqual(['', '']);
    expect(state1.project.animations?.[0].tracks).toHaveLength(0);
    expect(state1.project.codeModules?.[0].targetNodeId).toBeUndefined();

    const undone = editorReducer(state1, { type: 'undo' });
    expect(validateProject(undone.project).ok).toBe(true);
    expect(undone.project.logicGraphs[0].nodes.map((n) => n.data.targetNodeId)).toEqual(['bool-a', 'bool-b']);
    expect(undone.project.animations?.[0].tracks).toHaveLength(1);
    expect(undone.project.codeModules?.[0].targetNodeId).toBe('bool-b');
  });
});

import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { DesignNode, FolioProject, FolioProjectV1, GroupNode } from '../src/core/document/types';
import { migrateProjectToV2, migrateProjectV1ToV2 } from '../src/core/document/migrations';
import { validateProject } from '../src/core/document/validation';
import { getActiveDocument } from '../src/core/document/project';
import { createEditorState, editorReducer } from '../src/app/editorReducer';

describe('Folio unified project v2', () => {
  it('creates a valid native v2 project with a consistent Main Page route', () => {
    const project = createInitialProject('Test project');
    const result = validateProject(project);

    expect(result.ok).toBe(true);
    expect(project.formatVersion).toBe(2);
    expect(project.metadata.name).toBe('Test project');
    expect(project.activePageId).toBe(project.pages[0].id);
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0].name).toBe('Main Page');
    expect(project.pages[0].route).toBe('/');
    expect(project.pages[0].document.width).toBe(1440);
    expect(project.pages[0].document.nodes.length).toBeGreaterThan(0);
    expect(project.components).toEqual([]);
    expect(project.logicGraphs).toEqual([]);
    expect(project.assets).toEqual([]);
  });

  it('rejects files with an unsupported format version', () => {
    const project = createInitialProject();
    const result = validateProject({ ...project, formatVersion: 999 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unsupported .flop format version');
  });

  it('migrates a v1 single-document project into a Main Page without losing layers', () => {
    const current = createInitialProject('Legacy project');
    const legacy: FolioProjectV1 = {
      format: 'folio-project',
      formatVersion: 1,
      appVersion: '0.1.0',
      metadata: { ...current.metadata },
      document: {
        ...current.pages[0].document,
        id: 'legacy-document-id',
        name: 'Old single page',
      },
    };

    const migrated = migrateProjectV1ToV2(legacy);
    expect(migrated.formatVersion).toBe(2);
    expect(migrated.metadata).toEqual(legacy.metadata);
    expect(migrated.activePageId).toBe('page-main');
    expect(migrated.pages).toHaveLength(1);
    expect(migrated.pages[0]).toMatchObject({
      id: 'page-main',
      name: 'Main Page',
      route: '/',
      document: {
        id: 'legacy-document-id',
        name: 'Main Page',
        width: legacy.document.width,
        height: legacy.document.height,
        background: legacy.document.background,
      },
    });
    expect(migrated.pages[0].document.nodes).toEqual(legacy.document.nodes);
    expect(migrated.components).toEqual([]);
    expect(migrated.logicGraphs).toEqual([]);
    expect(migrated.assets).toEqual([]);
    expect(validateProject(migrated).ok).toBe(true);
  });

  it('routes supported v1 imports through the automatic migration entry point', () => {
    const current = createInitialProject();
    const legacy: FolioProjectV1 = {
      format: 'folio-project',
      formatVersion: 1,
      appVersion: current.appVersion,
      metadata: current.metadata,
      document: current.pages[0].document,
    };
    expect(migrateProjectToV2(legacy).formatVersion).toBe(2);
  });

  it('falls back to the first page when a v2 activePageId is stale', () => {
    const project = createInitialProject();
    const migrated = migrateProjectToV2({ ...project, activePageId: 'missing-page' });
    expect(migrated.activePageId).toBe(project.pages[0].id);
  });

  it('adds, undoes and redoes a layer on the active page', () => {
    const project = createInitialProject();
    const initialCount = getActiveDocument(project).nodes.length;
    const state = createEditorState(project);
    const added = editorReducer(state, { type: 'add-node', node: createRectNode() });

    expect(getActiveDocument(added.project).nodes).toHaveLength(initialCount + 1);
    expect(added.selectedNodeId).toBe(getActiveDocument(added.project).nodes.at(-1)?.id);

    const undone = editorReducer(added, { type: 'undo' });
    expect(getActiveDocument(undone.project).nodes).toHaveLength(initialCount);

    const redone = editorReducer(undone, { type: 'redo' });
    expect(getActiveDocument(redone.project).nodes).toHaveLength(initialCount + 1);
  });

  it('updates a selected layer without mutating the previous project', () => {
    const project = createInitialProject();
    const firstNode = getActiveDocument(project).nodes[0];
    const state = createEditorState(project);
    const updated = editorReducer(state, {
      type: 'replace-node',
      node: { ...firstNode, x: 123 },
    });

    expect(getActiveDocument(updated.project).nodes[0].x).toBe(123);
    expect(getActiveDocument(state.project).nodes[0].x).toBe(firstNode.x);
  });

  it('commits rotation-only canvas transforms and supports undo/redo', () => {
    const project = createInitialProject();
    const original = getActiveDocument(project).nodes[0];
    const state = createEditorState(project);
    const nextRotation = original.rotation + 23;

    const transformed = editorReducer(state, {
      type: 'transform-nodes',
      nodes: [{ ...original, rotation: nextRotation }],
    });

    const committed = getActiveDocument(transformed.project).nodes.find((node) => node.id === original.id);
    expect(committed?.rotation).toBe(nextRotation);
    expect(transformed.past).toHaveLength(1);

    const undone = editorReducer(transformed, { type: 'undo' });
    const restored = getActiveDocument(undone.project).nodes.find((node) => node.id === original.id);
    expect(restored?.rotation).toBe(original.rotation);

    const redone = editorReducer(undone, { type: 'redo' });
    const reapplied = getActiveDocument(redone.project).nodes.find((node) => node.id === original.id);
    expect(reapplied?.rotation).toBe(nextRotation);
  });

  it('switches active pages deterministically and keeps each page document isolated', () => {
    const project = createInitialProject();
    const secondPage = {
      id: 'page-about',
      name: 'About',
      route: '/about',
      document: {
        ...project.pages[0].document,
        id: 'document-about',
        name: 'About',
        nodes: [],
      },
    };
    const withPage = editorReducer(createEditorState(project), { type: 'add-page', page: secondPage });
    expect(withPage.project.activePageId).toBe('page-about');
    expect(getActiveDocument(withPage.project).nodes).toEqual([]);

    const backToMain = editorReducer(withPage, { type: 'set-active-page', pageId: 'page-main' });
    expect(getActiveDocument(backToMain.project).nodes).toEqual(project.pages[0].document.nodes);
  });

  it('stores component definitions inside the project aggregate', () => {
    const project = createInitialProject();
    const now = new Date().toISOString();
    const component = {
      id: 'component-button',
      name: 'Button',
      createdAt: now,
      updatedAt: now,
      document: {
        ...project.pages[0].document,
        id: 'component-document-button',
        name: 'Button',
        nodes: [createRectNode()],
      },
    };
    const added = editorReducer(createEditorState(project), { type: 'add-component', component });
    expect(added.project.components).toHaveLength(1);
    expect(added.project.components[0].id).toBe('component-button');
    const addedMaster = added.project.components[0];
    const deleted = editorReducer(added, {
      type: 'delete-component',
      componentId: 'component-button',
      expectedMasterDocument: addedMaster.document,
      expectedUpdatedAt: addedMaster.updatedAt,
    });
    expect(deleted.project.components).toHaveLength(0);
  });
  it('inserts a multi-node component as one undoable batch', () => {
    const project = createInitialProject();
    const state = createEditorState(project);
    const nodes = [createRectNode(), createRectNode()];
    const inserted = editorReducer(state, { type: 'add-nodes', nodes });
    expect(inserted.past).toHaveLength(1);
    expect(getActiveDocument(inserted.project).nodes).toHaveLength(getActiveDocument(project).nodes.length + 2);
    const undone = editorReducer(inserted, { type: 'undo' });
    expect(getActiveDocument(undone.project).nodes).toHaveLength(getActiveDocument(project).nodes.length);
  });

  it('coalesces inspector keystrokes into one undo snapshot until edit commit', () => {
    const project = createInitialProject();
    const node = getActiveDocument(project).nodes[0];
    let state = createEditorState(project);
    state = editorReducer(state, { type: 'edit-node', coalesceKey: 'inspector:' + node.id, node: { ...node, name: 'B' } });
    state = editorReducer(state, { type: 'edit-node', coalesceKey: 'inspector:' + node.id, node: { ...node, name: 'Bu' } });
    state = editorReducer(state, { type: 'edit-node', coalesceKey: 'inspector:' + node.id, node: { ...node, name: 'Button' } });
    expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'commit-edit' });
    state = editorReducer(state, { type: 'edit-node', coalesceKey: 'inspector:' + node.id, node: { ...node, name: 'Button 2' } });
    expect(state.past).toHaveLength(2);
    const undone = editorReducer(state, { type: 'undo' });
    expect(getActiveDocument(undone.project).nodes[0].name).toBe('Button');
  });

  it('preserves Inspector name, color, geometry and rotation edits after commit, with one undo step', () => {
    const project = createInitialProject();
    const original = getActiveDocument(project).nodes[0];
    if (original.type !== 'rect') throw new Error('Expected the first sample layer to be a rectangle.');

    let state = createEditorState(project);
    let edited = { ...original };
    const applyInput = (patch: Partial<typeof original>) => {
      edited = { ...edited, ...patch };
      state = editorReducer(state, {
        type: 'edit-node',
        coalesceKey: 'inspector:' + original.id,
        node: edited,
      });
    };

    applyInput({ name: 'Red card' });
    applyInput({ x: 444, y: 222, width: 520, height: 310, rotation: 17 });
    applyInput({ style: { ...edited.style, fill: '#FF0000', radius: 24 } });

    state = editorReducer(state, { type: 'commit-edit' });
    const committed = getActiveDocument(state.project).nodes.find((node) => node.id === original.id);
    expect(committed).toMatchObject({
      name: 'Red card',
      x: 444,
      y: 222,
      width: 520,
      height: 310,
      rotation: 17,
      style: { fill: '#FF0000', radius: 24 },
    });
    expect(state.historyGroup).toBeNull();
    expect(state.past).toHaveLength(1);

    const undone = editorReducer(state, { type: 'undo' });
    const restored = getActiveDocument(undone.project).nodes.find((node) => node.id === original.id);
    expect(restored).toEqual(original);

    const redone = editorReducer(undone, { type: 'redo' });
    const reapplied = getActiveDocument(redone.project).nodes.find((node) => node.id === original.id);
    expect(reapplied).toMatchObject({
      name: 'Red card',
      x: 444,
      y: 222,
      width: 520,
      height: 310,
      rotation: 17,
      style: { fill: '#FF0000', radius: 24 },
    });
  });

  it('rejects zero, negative and non-finite dimensions while preserving the current value', async () => {
    const { normalizePositiveDimension } = await import('../src/app/editorReducer');
    expect(normalizePositiveDimension(0, 120)).toBe(120);
    expect(normalizePositiveDimension(-10, 120)).toBe(120);
    expect(normalizePositiveDimension(Number.NaN, 120)).toBe(120);
    expect(normalizePositiveDimension(42, 120)).toBe(42);
  });

});


describe('linked master components and instances', () => {
  it('resolves instances against the latest master definition', async () => {
    const { createComponentInstance, resolveComponentInstanceNodes } = await import('../src/core/document/components');
    const project = createInitialProject();
    const source = createRectNode();
    const master = {
      id: 'master-card',
      name: 'Card',
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-19T00:00:00.000Z',
      document: { ...project.pages[0].document, id: 'master-doc', name: 'Card', width: 400, height: 280, nodes: [source] },
    };
    const instance = createComponentInstance(master, 80, 120, 'instance-card');
    const first = resolveComponentInstanceNodes(instance, master);
    expect(first[0].type).toBe('rect');
    if (first[0].type !== 'rect') throw new Error('Expected a resolved rectangle.');
    expect(first[0].style.fill).toBe(source.style.fill);

    const updatedMaster = {
      ...master,
      updatedAt: '2026-11-19T00:01:00.000Z',
      document: { ...master.document, nodes: [{ ...source, style: { ...source.style, fill: '#123456' } }] },
    };
    const afterMasterEdit = resolveComponentInstanceNodes(instance, updatedMaster);
    if (afterMasterEdit[0].type !== 'rect') throw new Error('Expected an updated rectangle.');
    expect(afterMasterEdit[0].style.fill).toBe('#123456');
    expect(instance.componentId).toBe(master.id);

    const secondInstance = createComponentInstance(master, 320, 180, 'instance-card-second');
    const secondPage = {
      ...project.pages[0],
      id: 'page-secondary',
      name: 'Secondary',
      route: '/secondary',
      document: {
        ...project.pages[0].document,
        id: 'doc-secondary',
        name: 'Secondary',
        nodes: [secondInstance],
      },
    };
    const linkedProject = {
      ...project,
      components: [master],
      pages: [
        { ...project.pages[0], document: { ...project.pages[0].document, nodes: [instance] } },
        secondPage,
      ],
    };
    const synced = editorReducer(createEditorState(linkedProject), {
      type: 'sync-component-document',
      componentId: master.id,
      expectedMasterDocument: master.document,
      expectedUpdatedAt: master.updatedAt,
      document: updatedMaster.document,
      updatedAt: updatedMaster.updatedAt,
    });
    for (const page of synced.project.pages) {
      const pageInstance = page.document.nodes.find((node) => node.type === 'component-instance');
      if (!pageInstance || pageInstance.type !== 'component-instance') throw new Error('Missing linked page instance.');
      const visibleNodes = resolveComponentInstanceNodes(pageInstance, synced.project.components[0]);
      if (visibleNodes[0].type !== 'rect') throw new Error('Expected an updated instance rectangle.');
      expect(visibleNodes[0].style.fill).toBe('#123456');
    }
  });

  it('rejects linked instances with missing masters or stale override targets', async () => {
    const { createComponentInstance } = await import('../src/core/document/components');
    const project = createInitialProject();
    const master = {
      id: 'master-validation', name: 'Validation',
      createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
      document: { ...project.pages[0].document, id: 'master-validation-doc', nodes: [createRectNode()] },
    };
    const orphan = createComponentInstance(master, 10, 10, 'orphan-instance');
    const missingMaster = { ...project, pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [orphan] } })) };
    expect(validateProject(missingMaster).ok).toBe(false);

    const invalidOverride = { ...orphan, overrides: { 'missing-layer': { fill: '#FFFFFF' } } };
    const invalidProject = {
      ...project,
      components: [master],
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [invalidOverride] } })),
    };
    expect(validateProject(invalidProject).ok).toBe(false);
  });

  it('applies per-instance overrides without changing the master', async () => {
    const { createComponentInstance, resolveComponentInstanceNodes } = await import('../src/core/document/components');
    const project = createInitialProject();
    const text = project.pages[0].document.nodes.find((node) => node.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Expected a text master child.');
    const master = {
      id: 'master-label', name: 'Label',
      createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
      document: { ...project.pages[0].document, id: 'master-label-doc', name: 'Label', nodes: [text] },
    };
    const instance = {
      ...createComponentInstance(master, 40, 50, 'instance-label'),
      overrides: { [text.id]: { text: 'Instance only', fill: '#FF0000' } },
    };
    const resolved = resolveComponentInstanceNodes(instance, master)[0];
    expect(resolved.type).toBe('text');
    if (resolved.type !== 'text') throw new Error('Expected resolved text node.');
    expect(resolved.text).toBe('Instance only');
    expect(resolved.style.fill).toBe('#FF0000');
    expect(master.document.nodes[0]).toEqual(text);
    expect(text.text).not.toBe('Instance only');
  });

  it('detaches an instance to ordinary nodes and deletes a master without broken references', async () => {
    const { createComponentInstance, detachComponentInstance } = await import('../src/core/document/components');
    const project = createInitialProject();
    const source = createRectNode();
    const master = {
      id: 'master-detach', name: 'Detach me',
      createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
      document: { ...project.pages[0].document, id: 'master-detach-doc', width: 400, height: 280, nodes: [source] },
    };
    const instance = createComponentInstance(master, 100, 140, 'instance-detach');
    const detached = detachComponentInstance(instance, master);
    expect(detached).toHaveLength(1);
    expect(detached[0].type).toBe('rect');
    expect(detached[0].id).not.toBe(source.id);

    const withMaster = editorReducer(createEditorState({
      ...project,
      components: [master],
      pages: project.pages.map((page) => ({ ...page, document: { ...page.document, nodes: [...page.document.nodes, instance] } })),
    }), {
      type: 'delete-component',
      componentId: master.id,
      expectedMasterDocument: master.document,
      expectedUpdatedAt: master.updatedAt,
    });
    expect(withMaster.project.components).toHaveLength(0);
    expect(withMaster.project.pages[0].document.nodes.some((node) => node.type === 'component-instance')).toBe(false);
    expect(validateProject(withMaster.project).ok).toBe(true);
  });
});


describe('Group node project validation', () => {
  const createGroup = (id: string, parentId?: string): GroupNode => ({
    id,
    type: 'group',
    name: id,
    x: 24,
    y: 36,
    width: 320,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...(parentId ? { parentId } : {}),
  });

  const withPageNodes = (nodes: DesignNode[]): FolioProject => {
    const project = createInitialProject('Grouped project');
    return {
      ...project,
      pages: project.pages.map((page) => ({
        ...page,
        document: { ...page.document, nodes },
      })),
    };
  };

  it('accepts a valid GroupNode in a page document', () => {
    const group = createGroup('page-group');
    const project = withPageNodes([group]);

    expect(validateProject(project).ok).toBe(true);
  });

  it('accepts grouped children in page and component master documents', () => {
    const project = withPageNodes([
      createGroup('page-group'),
      { ...createRectNode(), id: 'page-child', parentId: 'page-group' },
      createGroup('page-nested-group', 'page-group'),
      { ...createRectNode(), id: 'page-nested-child', parentId: 'page-nested-group' },
    ]);
    const timestamp = project.metadata.createdAt;
    const componentGroup = createGroup('component-group');
    project.components = [{
      id: 'component-with-group',
      name: 'Grouped component',
      createdAt: timestamp,
      updatedAt: timestamp,
      document: {
        ...project.pages[0].document,
        id: 'component-document-with-group',
        name: 'Grouped component',
        nodes: [
          componentGroup,
          { ...createRectNode(), id: 'component-child', parentId: componentGroup.id },
        ],
      },
    }];

    expect(validateProject(project).ok).toBe(true);
  });

  it.each([
    { property: 'id', value: '' },
    { property: 'name', value: 42 },
    { property: 'x', value: Number.NaN },
    { property: 'y', value: Number.POSITIVE_INFINITY },
    { property: 'width', value: -1 },
    { property: 'height', value: -1 },
    { property: 'rotation', value: Number.NaN },
    { property: 'opacity', value: 1.01 },
    { property: 'visible', value: 'true' },
    { property: 'locked', value: 0 },
    { property: 'parentId', value: '' },
  ])('rejects a GroupNode with an invalid common $property property', ({ property, value }) => {
    const invalidGroup = { ...createGroup('invalid-group'), [property]: value } as unknown as DesignNode;

    expect(validateProject(withPageNodes([invalidGroup])).ok).toBe(false);
  });

  it('rejects missing parents and cyclic group hierarchies', () => {
    const missingParent = withPageNodes([createGroup('orphan-group', 'missing-parent')]);
    const cyclic = withPageNodes([
      createGroup('cycle-a', 'cycle-b'),
      createGroup('cycle-b', 'cycle-a'),
    ]);

    expect(validateProject(missingParent).ok).toBe(false);
    expect(validateProject(cyclic).ok).toBe(false);
  });

  it('continues rejecting duplicate node IDs and duplicate page routes', () => {
    const duplicateNodeIds = withPageNodes([
      createGroup('duplicate-group'),
      createGroup('duplicate-group'),
    ]);
    const duplicateRoutes = createInitialProject('Duplicate route project');
    duplicateRoutes.pages.push({
      ...duplicateRoutes.pages[0],
      id: 'second-page',
      name: 'Second page',
      document: {
        ...duplicateRoutes.pages[0].document,
        id: 'second-page-document',
        nodes: [createGroup('second-page-group')],
      },
    });

    expect(validateProject(duplicateNodeIds).ok).toBe(false);
    expect(validateProject(duplicateRoutes).ok).toBe(false);
  });
});

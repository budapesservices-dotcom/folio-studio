import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { FolioProjectV1 } from '../src/core/document/types';
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
    const deleted = editorReducer(added, { type: 'delete-component', componentId: 'component-button' });
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
    expect(first[0].style.fill).toBe(source.style.fill);

    const updatedMaster = {
      ...master,
      updatedAt: '2026-11-19T00:01:00.000Z',
      document: { ...master.document, nodes: [{ ...source, style: { ...source.style, fill: '#123456' } }] },
    };
    const afterMasterEdit = resolveComponentInstanceNodes(instance, updatedMaster);
    expect(afterMasterEdit[0].style.fill).toBe('#123456');
    expect(instance.componentId).toBe(master.id);
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
    }), { type: 'delete-component', componentId: master.id });
    expect(withMaster.project.components).toHaveLength(0);
    expect(withMaster.project.pages[0].document.nodes.some((node) => node.type === 'component-instance')).toBe(false);
    expect(validateProject(withMaster.project).ok).toBe(true);
  });
});

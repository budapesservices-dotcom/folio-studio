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
});

import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { createComponentCanvasSyncAction } from '../src/app/componentCanvasSync';
import { areDocumentsStructurallyEqual } from '../src/core/document/equality';

function createFixture() {
  const project = createInitialProject('Component synchronization');
  project.components = [{
    id: 'component-master',
    name: 'Button',
    document: {
      ...project.pages[0].document,
      id: 'component-document',
      name: 'Button',
      nodes: [{ ...createRectNode(), id: 'master-node' }],
    },
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
  }];
  const store = createCanonicalEditorStore(createEditorState(project));
  const master = store.getSnapshot().editorState.project.components[0];
  return { store, master };
}

describe('Component Canvas master synchronization', () => {
  it('treats an opened copy of an unchanged master as a semantic no-op', () => {
    const { store, master } = createFixture();
    const openedDocument = {
      ...master.document,
      nodes: master.document.nodes.map((node) => ({ ...node })),
    };
    expect(openedDocument).not.toBe(master.document);
    expect(areDocumentsStructurallyEqual(master.document, openedDocument)).toBe(true);

    const before = store.getSnapshot();
    const syncAction = createComponentCanvasSyncAction(master, openedDocument);
    expect(syncAction).toBeNull();

    const reducerNoOp = editorReducer(before.editorState, {
      type: 'update-component',
      component: { ...master, document: openedDocument, updatedAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(reducerNoOp).toBe(before.editorState);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().editorState.project).toBe(before.editorState.project);
    expect(store.getSnapshot().editorState.past).toBe(before.editorState.past);
    expect(store.getSnapshot().editorState.future).toBe(before.editorState.future);
    expect(store.getSnapshot().projectRevision).toBe(0);
    expect(store.getSnapshot().editorState.project.components[0].updatedAt).toBe(master.updatedAt);
  });

  it('synchronizes one genuine subsequent edit exactly once', () => {
    const { store, master } = createFixture();
    const before = store.getSnapshot();
    const editedDocument = {
      ...master.document,
      nodes: master.document.nodes.map((node) => ({ ...node, x: node.x + 25 })),
    };
    expect(areDocumentsStructurallyEqual(master.document, editedDocument)).toBe(false);

    const syncAction = createComponentCanvasSyncAction(master, editedDocument);
    expect(syncAction).not.toBeNull();
    if (!syncAction) throw new Error('Expected a genuine Component Canvas edit to synchronize.');
    const committed = store.dispatchLegacyAction(syncAction);
    expect(committed.status).toBe('committed');

    const afterFirstSync = store.getSnapshot();
    const updatedMaster = afterFirstSync.editorState.project.components[0];
    expect(updatedMaster.document).toEqual(editedDocument);
    expect(afterFirstSync.editorState.project).not.toBe(before.editorState.project);
    expect(afterFirstSync.projectRevision).toBe(1);
    expect(afterFirstSync.editorState.past).toHaveLength(1);
    expect(afterFirstSync.editorState.future).toHaveLength(0);

    expect(createComponentCanvasSyncAction(updatedMaster, editedDocument)).toBeNull();
    expect(store.getSnapshot()).toBe(afterFirstSync);
    expect(store.getSnapshot().projectRevision).toBe(1);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);
  });
});

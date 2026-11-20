import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import {
  advanceComponentCanvasSyncSession,
  createComponentCanvasBufferProject,
  createComponentCanvasSyncAction,
  createComponentCanvasSyncSession,
  markComponentCanvasMasterMissing,
  reconcileComponentCanvasSyncSession,
} from '../src/app/componentCanvasSync';
import { areDocumentsStructurallyEqual } from '../src/core/document/equality';
import type { FolioDocument } from '../src/core/document/types';
import type { ComponentCanvasSyncSession } from '../src/app/componentCanvasSync';

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

function getMaster(store: ReturnType<typeof createCanonicalEditorStore>) {
  const master = store.getSnapshot().editorState.project.components.find(
    (component) => component.id === 'component-master',
  );
  if (!master) throw new Error('The canonical component master is missing.');
  return master;
}

function copyDocument(document: FolioDocument): FolioDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({ ...node })),
  };
}

function commitBufferEdit(
  store: ReturnType<typeof createCanonicalEditorStore>,
  session: ComponentCanvasSyncSession,
  editedDocument: FolioDocument,
): ComponentCanvasSyncSession {
  const master = getMaster(store);
  const syncAction = createComponentCanvasSyncAction(master, editedDocument, session);
  if (!syncAction) throw new Error('Expected a current, non-conflicted Component Canvas edit to synchronize.');
  const result = store.dispatchLegacyAction(syncAction);
  if (result.status !== 'committed') throw new Error('The canonical component update was not committed.');
  return advanceComponentCanvasSyncSession(session, getMaster(store));
}

describe('Component Canvas master synchronization', () => {
  it('treats an opened copy of an unchanged master as a semantic no-op', () => {
    const { store, master } = createFixture();
    const openedDocument = copyDocument(master.document);
    const session = createComponentCanvasSyncSession(master);
    expect(openedDocument).not.toBe(master.document);
    expect(areDocumentsStructurallyEqual(master.document, openedDocument)).toBe(true);

    const before = store.getSnapshot();
    const syncAction = createComponentCanvasSyncAction(master, openedDocument, session);
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

  it('synchronizes multiple sequential Component Canvas edits with one snapshot per genuine edit', () => {
    const { store, master } = createFixture();
    let session = createComponentCanvasSyncSession(master);
    const firstEdit = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: node.x + 25 })),
    };
    session = commitBufferEdit(store, session, firstEdit);

    const secondEdit = {
      ...copyDocument(firstEdit),
      nodes: firstEdit.nodes.map((node) => ({ ...node, y: node.y + 30 })),
    };
    session = commitBufferEdit(store, session, secondEdit);

    expect(getMaster(store).document).toEqual(secondEdit);
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(store.getSnapshot().editorState.past).toHaveLength(2);
    expect(store.getSnapshot().editorState.future).toHaveLength(0);
    expect(createComponentCanvasSyncAction(getMaster(store), secondEdit, session)).toBeNull();
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(store.getSnapshot().editorState.past).toHaveLength(2);
  });

  it('rebases a clean buffer after Main Canvas Undo and does not restore the undone document on the next edit', () => {
    const { store, master } = createFixture();
    let session = createComponentCanvasSyncSession(master);
    const originalX = master.document.nodes[0].x;
    const firstEdit = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: 777 })),
    };
    session = commitBufferEdit(store, session, firstEdit);
    expect(getMaster(store).document.nodes[0].x).toBe(777);

    expect(store.dispatchLegacyAction({ type: 'undo' }).status).toBe('committed');
    const undoneMaster = getMaster(store);
    expect(undoneMaster.document.nodes[0].x).toBe(originalX);

    const reconciliation = reconcileComponentCanvasSyncSession(session, undoneMaster, firstEdit);
    expect(reconciliation.status).toBe('reload-buffer');
    if (reconciliation.status !== 'reload-buffer') throw new Error('Expected a clean buffer to rebase after Undo.');
    session = reconciliation.session;
    const reloadedBuffer = copyDocument(reconciliation.canonicalDocument);
    expect(reloadedBuffer.nodes[0].x).toBe(originalX);

    const secondEdit = {
      ...reloadedBuffer,
      nodes: reloadedBuffer.nodes.map((node) => ({ ...node, y: node.y + 41 })),
    };
    session = commitBufferEdit(store, session, secondEdit);

    expect(getMaster(store).document.nodes[0].x).toBe(originalX);
    expect(getMaster(store).document.nodes[0].y).toBe(secondEdit.nodes[0].y);
    expect(store.getSnapshot().projectRevision).toBe(3);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);
    expect(store.getSnapshot().editorState.future).toHaveLength(0);
    expect(session.conflicted).toBe(false);
  });

  it('rebases a clean buffer after Main Canvas Redo before accepting another local edit', () => {
    const { store, master } = createFixture();
    let session = createComponentCanvasSyncSession(master);
    const firstEdit = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: 888 })),
    };
    session = commitBufferEdit(store, session, firstEdit);

    expect(store.dispatchLegacyAction({ type: 'undo' }).status).toBe('committed');
    const afterUndo = getMaster(store);
    const undoRebase = reconcileComponentCanvasSyncSession(session, afterUndo, firstEdit);
    expect(undoRebase.status).toBe('reload-buffer');
    if (undoRebase.status !== 'reload-buffer') throw new Error('Expected buffer rebase after Undo.');
    session = undoRebase.session;
    const undoBuffer = copyDocument(undoRebase.canonicalDocument);

    expect(store.dispatchLegacyAction({ type: 'redo' }).status).toBe('committed');
    const afterRedo = getMaster(store);
    expect(afterRedo.document.nodes[0].x).toBe(888);
    const redoRebase = reconcileComponentCanvasSyncSession(session, afterRedo, undoBuffer);
    expect(redoRebase.status).toBe('reload-buffer');
    if (redoRebase.status !== 'reload-buffer') throw new Error('Expected buffer rebase after Redo.');
    session = redoRebase.session;

    const reloadedBuffer = copyDocument(redoRebase.canonicalDocument);
    const nextEdit = {
      ...reloadedBuffer,
      nodes: reloadedBuffer.nodes.map((node) => ({ ...node, y: node.y + 19 })),
    };
    session = commitBufferEdit(store, session, nextEdit);

    expect(getMaster(store).document.nodes[0].x).toBe(888);
    expect(getMaster(store).document.nodes[0].y).toBe(nextEdit.nodes[0].y);
    expect(store.getSnapshot().projectRevision).toBe(4);
    expect(store.getSnapshot().editorState.past).toHaveLength(2);
    expect(store.getSnapshot().editorState.future).toHaveLength(0);
    expect(session.conflicted).toBe(false);
  });

  it('reconciles an independent canonical master update while the local buffer is clean', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const buffer = copyDocument(master.document);
    const externalDocument = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: node.x + 63 })),
    };
    const externalUpdate = store.dispatchLegacyAction({
      type: 'update-component',
      component: { ...getMaster(store), document: externalDocument, updatedAt: '2026-11-20T01:00:00.000Z' },
    });
    expect(externalUpdate.status).toBe('committed');

    const reconciliation = reconcileComponentCanvasSyncSession(session, getMaster(store), buffer);
    expect(reconciliation.status).toBe('reload-buffer');
    if (reconciliation.status !== 'reload-buffer') throw new Error('Expected independent canonical update to rebase a clean buffer.');
    expect(reconciliation.canonicalDocument).toEqual(externalDocument);
    expect(createComponentCanvasSyncAction(getMaster(store), reconciliation.canonicalDocument, reconciliation.session)).toBeNull();
    expect(store.getSnapshot().projectRevision).toBe(1);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);
  });

  it('preserves unsynchronized local edits and pauses sync when canonical and local changes conflict', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const unsynchronizedLocalBuffer = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, y: 321 })),
    };
    const independentCanonicalDocument = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: 654 })),
    };
    store.dispatchLegacyAction({
      type: 'update-component',
      component: {
        ...getMaster(store),
        document: independentCanonicalDocument,
        updatedAt: '2026-11-20T02:00:00.000Z',
      },
    });

    const reconciliation = reconcileComponentCanvasSyncSession(
      session,
      getMaster(store),
      unsynchronizedLocalBuffer,
    );
    expect(reconciliation.status).toBe('conflict');
    if (reconciliation.status !== 'conflict') throw new Error('Expected local/canonical conflict.');
    expect(reconciliation.session.conflicted).toBe(true);
    expect(areDocumentsStructurallyEqual(unsynchronizedLocalBuffer, master.document)).toBe(false);
    expect(createComponentCanvasSyncAction(
      getMaster(store),
      unsynchronizedLocalBuffer,
      reconciliation.session,
    )).toBeNull();

    const laterLocalEdit = {
      ...unsynchronizedLocalBuffer,
      nodes: unsynchronizedLocalBuffer.nodes.map((node) => ({ ...node, y: 999 })),
    };
    expect(createComponentCanvasSyncAction(getMaster(store), laterLocalEdit, reconciliation.session)).toBeNull();
    expect(getMaster(store).document.nodes[0].x).toBe(654);
    expect(getMaster(store).document.nodes[0].y).toBe(master.document.nodes[0].y);
    expect(store.getSnapshot().projectRevision).toBe(1);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);
  });
});


describe('Atomic Component Canvas sync and orphan recovery', () => {
  it('rejects a stale M0 sync action after canonical master advances to M2 without changing M2 metadata or history', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const localM1 = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, y: node.y + 100 })),
    };
    const staleM0Action = createComponentCanvasSyncAction(master, localM1, session);
    if (!staleM0Action) throw new Error('Expected an M0 sync action.');

    const canonicalM2Document = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: node.x + 654 })),
    };
    const updated = store.dispatchLegacyAction({
      type: 'update-component',
      component: {
        ...getMaster(store),
        name: 'Renamed canonical master',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2026-11-20T03:00:00.000Z',
        document: canonicalM2Document,
      },
    });
    expect(updated.status).toBe('committed');
    const beforeStaleDispatch = store.getSnapshot();
    const beforePast = beforeStaleDispatch.editorState.past;
    const beforeFuture = beforeStaleDispatch.editorState.future;

    const staleResult = store.dispatchLegacyAction(staleM0Action);

    expect(staleResult.status).toBe('component-conflict');
    expect(store.getSnapshot()).toBe(beforeStaleDispatch);
    expect(store.getSnapshot().projectRevision).toBe(beforeStaleDispatch.projectRevision);
    expect(store.getSnapshot().editorState.past).toBe(beforePast);
    expect(store.getSnapshot().editorState.future).toBe(beforeFuture);
    expect(getMaster(store)).toMatchObject({
      name: 'Renamed canonical master',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-11-20T03:00:00.000Z',
    });
    expect(getMaster(store).document).toEqual(canonicalM2Document);
    expect(getMaster(store).document.nodes[0].x).toBe(master.document.nodes[0].x + 654);
  });

  it('keeps local buffer edits orphaned when Undo removes and Redo restores the canonical master', () => {
    const project = createInitialProject('Orphaned component history');
    const store = createCanonicalEditorStore(createEditorState(project));
    const component = {
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
    };
    expect(store.dispatchLegacyAction({ type: 'add-component', component }).status).toBe('committed');
    const master = getMaster(store);
    let session = createComponentCanvasSyncSession(master);
    const localBuffer = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, y: node.y + 777 })),
    };

    expect(store.dispatchLegacyAction({ type: 'undo' }).status).toBe('committed');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(0);
    session = markComponentCanvasMasterMissing(session);
    expect(session.masterStatus).toBe('missing');

    expect(store.dispatchLegacyAction({ type: 'redo' }).status).toBe('committed');
    const returnedMaster = getMaster(store);
    const returned = reconcileComponentCanvasSyncSession(session, returnedMaster, localBuffer);
    expect(returned.status).toBe('orphaned-master-returned');
    if (returned.status !== 'orphaned-master-returned') throw new Error('Expected explicit orphan recovery state.');
    session = returned.session;
    expect(session.masterStatus).toBe('returned');
    expect(localBuffer.nodes[0].y).toBe(master.document.nodes[0].y + 777);
    expect(createComponentCanvasSyncAction(returnedMaster, localBuffer, session)).toBeNull();

    const laterLocalEdit = {
      ...localBuffer,
      nodes: localBuffer.nodes.map((node) => ({ ...node, x: node.x + 55 })),
    };
    expect(reconcileComponentCanvasSyncSession(session, returnedMaster, laterLocalEdit).status).toBe('orphaned');
    expect(getMaster(store).document).toEqual(master.document);
  });

  it('allows a separate explicit discard/reload operation after an orphaned master returns', () => {
    const { store, master } = createFixture();
    const session = markComponentCanvasMasterMissing(createComponentCanvasSyncSession(master));
    const localBuffer = {
      ...copyDocument(master.document),
      nodes: master.document.nodes.map((node) => ({ ...node, x: node.x + 400 })),
    };
    const returned = reconcileComponentCanvasSyncSession(session, getMaster(store), localBuffer);
    expect(returned.status).toBe('orphaned-master-returned');
    if (returned.status !== 'orphaned-master-returned') throw new Error('Expected an orphaned return.');

    // Models the explicit recovery action in App: only an affirmative user action
    // replaces the local workspace buffer and establishes a fresh baseline.
    const reloadedBuffer = createComponentCanvasBufferProject(getMaster(store)).pages[0].document;
    const reloadedSession = createComponentCanvasSyncSession(getMaster(store));
    expect(reloadedBuffer.nodes).toEqual(getMaster(store).document.nodes);
    expect(reloadedSession.masterStatus).toBe('present');
    expect(createComponentCanvasSyncAction(getMaster(store), reloadedBuffer, reloadedSession)).toBeNull();
    expect(localBuffer.nodes[0].x).toBe(master.document.nodes[0].x + 400);
  });
});


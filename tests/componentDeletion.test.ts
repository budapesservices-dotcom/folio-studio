import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentDefinition, FolioDocument, GroupNode } from '../src/core/document/types';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState } from '../src/app/editorReducer';
import {
  deleteComponentIfCurrent,
  requestComponentDeletion,
  saveComponentCanvasRecoveryCopy,
  type ComponentDeletionTarget,
  type ComponentRecoveryIdFactory,
} from '../src/app/componentDeletion';
import {
  createComponentCanvasSyncSession,
  markComponentCanvasMasterMissing,
  type ComponentCanvasSyncSession,
} from '../src/app/componentCanvasSync';

function createFixture(includeSecond = false) {
  const project = createInitialProject('Safe component deletion');
  const group: GroupNode = {
    id: 'master-group',
    type: 'group',
    name: 'Outer group',
    x: 10,
    y: 20,
    width: 240,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const child = { ...createRectNode(), id: 'master-child', parentId: group.id, x: 44 };
  const document: FolioDocument = {
    ...project.pages[0].document,
    id: 'master-document',
    name: 'Button',
    width: 480,
    height: 320,
    background: '#112233',
    nodes: [group, child],
  };
  const master: ComponentDefinition = {
    id: 'component-master',
    name: 'Button',
    document,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
  };
  project.components = [master];
  if (includeSecond) {
    project.components.push({
      ...master,
      id: 'component-other',
      name: 'Other',
      document: {
        ...document,
        id: 'other-document',
        name: 'Other',
        nodes: document.nodes.map((node) => ({
          ...node,
          id: `other-${node.id}`,
          ...(node.parentId ? { parentId: `other-${node.parentId}` } : {}),
        })),
      },
    });
  }
  const store = createCanonicalEditorStore(createEditorState(project));
  const canonicalMaster = store.getSnapshot().editorState.project.components.find(
    (component) => component.id === master.id,
  )!;
  return { store, master: canonicalMaster };
}

function targetFor(master: ComponentDefinition): ComponentDeletionTarget {
  return {
    componentId: master.id,
    expectedMasterDocument: master.document,
    expectedUpdatedAt: master.updatedAt,
  };
}

function dirtyBuffer(document: FolioDocument): FolioDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === 'master-child'
      ? { ...node, x: node.x + 125 }
      : node),
  };
}

function ids(prefix: string): ComponentRecoveryIdFactory {
  let index = 0;
  return (requestedPrefix) => \`\${prefix}-\${requestedPrefix}-\${++index}\`;
}

function requestActiveDeletion(
  store: ReturnType<typeof createCanonicalEditorStore>,
  master: ComponentDefinition,
  session: ComponentCanvasSyncSession | null,
  bufferDocument: FolioDocument | null,
  recoveryPending = false,
) {
  return requestComponentDeletion(store, targetFor(master), {
    activeMaster: true,
    session,
    bufferDocument,
    recoveryPending,
  });
}

describe('Safe active Component Canvas master deletion', () => {
  it('Cancel leaves the canonical master, local buffer, history and revision unchanged', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const buffer = dirtyBuffer(master.document);
    const before = store.getSnapshot();

    const request = requestActiveDeletion(store, master, session, buffer);

    expect(request.status).toBe('recovery-required');
    // Cancel is a UI-only decision: no commit or buffer replacement follows it.
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().editorState.project.components[0]).toBe(master);
    expect(store.getSnapshot().editorState.past).toHaveLength(0);
    expect(store.getSnapshot().projectRevision).toBe(0);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('saves the complete buffer as a new component before deleting the original master', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const buffer = dirtyBuffer(master.document);
    const decision = requestActiveDeletion(store, master, session, buffer);
    expect(decision.status).toBe('recovery-required');

    const saved = saveComponentCanvasRecoveryCopy(
      store, targetFor(master), buffer, '2026-11-20T12:00:00.000Z', ids('saved'),
    );
    expect(saved.status).toBe('saved');
    if (saved.status !== 'saved') throw new Error('Expected recovery copy to be committed.');

    expect(saved.component.id).not.toBe(master.id);
    expect(saved.component.document.id).not.toBe(master.document.id);
    expect(saved.component.createdAt).toBe('2026-11-20T12:00:00.000Z');
    expect(saved.component.updatedAt).toBe(saved.component.createdAt);
    expect(saved.component.document.width).toBe(buffer.width);
    expect(saved.component.document.height).toBe(buffer.height);
    expect(saved.component.document.background).toBe(buffer.background);
    expect(saved.component.document.nodes).toEqual(buffer.nodes);
    expect(saved.component.document.nodes[1].parentId).toBe('master-group');

    const deleted = deleteComponentIfCurrent(store, targetFor(master));
    expect(deleted.status).toBe('deleted');
    expect(deleted.snapshot.editorState.project.components.map((item) => item.id)).toEqual([saved.component.id]);
    expect(deleted.snapshot.projectRevision).toBe(2);
    expect(deleted.snapshot.editorState.past).toHaveLength(2);
  });

  it('does not delete a protected master until the explicit discard choice is applied', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);
    const buffer = dirtyBuffer(master.document);
    const before = store.getSnapshot();

    const request = requestActiveDeletion(store, master, session, buffer);
    expect(request.status).toBe('recovery-required');
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().editorState.project.components).toHaveLength(1);

    const discarded = deleteComponentIfCurrent(store, targetFor(master));
    expect(discarded.status).toBe('deleted');
    expect(discarded.snapshot.editorState.project.components).toHaveLength(0);
  });

  it('requires recovery for a conflicted buffer even when its document is structurally clean', () => {
    const { store, master } = createFixture();
    const session = { ...createComponentCanvasSyncSession(master), conflicted: true };

    const request = requestActiveDeletion(store, master, session, master.document);

    expect(request.status).toBe('recovery-required');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(1);
    expect(store.getSnapshot().projectRevision).toBe(0);
  });

  it('requires recovery for missing and returned orphan states', () => {
    const { store, master } = createFixture();
    const current = createComponentCanvasSyncSession(master);
    const missing = markComponentCanvasMasterMissing(current);
    const returned: ComponentCanvasSyncSession = { ...current, masterStatus: 'returned' };

    expect(requestActiveDeletion(store, master, missing, master.document).status).toBe('recovery-required');
    expect(requestActiveDeletion(store, master, returned, master.document).status).toBe('recovery-required');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(1);
    expect(store.getSnapshot().projectRevision).toBe(0);
  });

  it('rejects stale master metadata before deletion or recovery save', () => {
    const { store, master } = createFixture();
    const staleTarget = targetFor(master);
    const rename = store.dispatchLegacyAction({
      type: 'rename-component',
      componentId: master.id,
      expectedMasterDocument: master.document,
      expectedUpdatedAt: master.updatedAt,
      name: 'Latest Button',
    });
    expect(rename.status).toBe('committed');
    const beforeStaleAttempt = store.getSnapshot();

    const request = requestComponentDeletion(store, staleTarget, {
      activeMaster: true,
      session: createComponentCanvasSyncSession(master),
      bufferDocument: dirtyBuffer(master.document),
    });
    const save = saveComponentCanvasRecoveryCopy(store, staleTarget, dirtyBuffer(master.document), undefined, ids('stale'));

    expect(request.status).toBe('stale-master');
    expect(save.status).toBe('stale-master');
    expect(store.getSnapshot()).toBe(beforeStaleAttempt);
    expect(store.getSnapshot().editorState.project.components[0].name).toBe('Latest Button');
    expect(store.getSnapshot().projectRevision).toBe(1);
  });

  it('deletes a different component without touching the active master', () => {
    const { store, master } = createFixture(true);
    const activeSession = createComponentCanvasSyncSession(master);
    const other = store.getSnapshot().editorState.project.components.find(
      (component) => component.id === 'component-other',
    )!;
    const beforeActive = master.document;

    const result = requestComponentDeletion(store, targetFor(other), {
      activeMaster: false,
      session: activeSession,
      bufferDocument: dirtyBuffer(master.document),
    });

    expect(result.status).toBe('deleted');
    expect(result.snapshot.editorState.project.components.map((item) => item.id)).toEqual([master.id]);
    expect(result.snapshot.editorState.project.components[0].document).toBe(beforeActive);
    expect(result.snapshot.projectRevision).toBe(1);
  });

  it('keeps the existing immediate deletion behavior for a clean, current active buffer', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);

    const result = requestActiveDeletion(store, master, session, master.document);

    expect(result.status).toBe('deleted');
    expect(result.snapshot.editorState.project.components).toHaveLength(0);
    expect(result.snapshot.projectRevision).toBe(1);
    expect(result.snapshot.editorState.past).toHaveLength(1);
  });

  it('retains a saved recovery component when the original deletion later fails its CAS check', () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const saved = saveComponentCanvasRecoveryCopy(
      store, targetFor(master), buffer, '2026-11-20T13:00:00.000Z', ids('failure'),
    );
    expect(saved.status).toBe('saved');
    if (saved.status !== 'saved') throw new Error('Expected recovery copy to be committed.');

    const latestMaster = store.getSnapshot().editorState.project.components.find(
      (component) => component.id === master.id,
    )!;
    const renamed = store.dispatchLegacyAction({
      type: 'rename-component',
      componentId: latestMaster.id,
      expectedMasterDocument: latestMaster.document,
      expectedUpdatedAt: latestMaster.updatedAt,
      name: 'Changed while recovery was saved',
    });
    expect(renamed.status).toBe('committed');

    const failedDelete = deleteComponentIfCurrent(store, targetFor(master));
    expect(failedDelete.status).toBe('stale-master');
    const components = store.getSnapshot().editorState.project.components;
    expect(components.some((item) => item.id === master.id)).toBe(true);
    const retained = components.find((item) => item.id === saved.component.id);
    expect(retained).toBeDefined();
    expect(retained?.document.nodes).toEqual(buffer.nodes);
    expect(retained?.document.id).toBe(saved.component.document.id);
    expect(store.getSnapshot().projectRevision).toBe(2);
  });

  it('does not auto-delete when another recovery state is pending', () => {
    const { store, master } = createFixture();
    const session = createComponentCanvasSyncSession(master);

    const request = requestActiveDeletion(store, master, session, master.document, true);

    expect(request.status).toBe('recovery-required');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(1);
    expect(store.getSnapshot().projectRevision).toBe(0);
  });
});

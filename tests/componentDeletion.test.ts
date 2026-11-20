import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentDefinition, FolioDocument, FolioProject, GroupNode } from '../src/core/document/types';
import { createCanonicalEditorStore, type CanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState } from '../src/app/editorReducer';
import {
  deleteComponentIfCurrent,
  requestComponentDeletion,
  saveComponentCanvasRecoveryCopy,
  deleteComponentAfterDurableRecovery,
  deleteComponentDurably,
  recoverAndDeleteComponentDurably,
  type ComponentDeletionTarget,
  type ComponentProjectWriteLock,
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
  return (requestedPrefix) => `${prefix}-${requestedPrefix}-${++index}`;
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


function emptyBufferProject(): FolioProject {
  const project = createInitialProject('Component Canvas');
  project.metadata.id = 'folio-component-canvas';
  project.metadata.name = 'Component Canvas';
  project.pages[0].name = 'Component Canvas';
  project.pages[0].document = { ...project.pages[0].document, name: 'Component Canvas', nodes: [] };
  return project;
}

function recoveryProtection(master: ComponentDefinition, buffer: FolioDocument) {
  return {
    activeMaster: true,
    session: createComponentCanvasSyncSession(master),
    bufferDocument: buffer,
    recoveryPending: true,
  };
}

function makeDurableWriter(
  persisted: FolioProject[],
  failAt = 0,
  onPersist?: (call: number, project: FolioProject, revision?: number) => void,
): ComponentProjectWriteLock {
  return async <T>(operation: (persist: (project: FolioProject, revision?: number) => Promise<void>) => Promise<T>) => {
    let calls = 0;
    return operation(async (project, revision) => {
      calls += 1;
      onPersist?.(calls, project, revision);
      if (calls === failAt) throw new Error('Injected IndexedDB transaction failure ' + calls);
      persisted.push(structuredClone(project));
    });
  };
}

describe('durable active Component Canvas deletion barriers', () => {
  it('persists recovery copy before deletion and clears the buffer only after both commits are durable', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const result = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted), '2026-11-20T14:00:00.000Z', ids('durable'),
    );

    expect(result.status).toBe('deleted');
    expect(persisted).toHaveLength(3);
    expect(persisted[0].components).toHaveLength(2);
    expect(persisted[0].components.some((item) => item.id === master.id)).toBe(true);
    expect(persisted[0].components.some((item) => item.id === result.recoveryComponent?.id)).toBe(true);
    expect(persisted[1].components).toEqual([expect.objectContaining({ id: result.recoveryComponent?.id })]);
    expect(persisted[2].metadata.id).toBe('folio-component-canvas');
    expect(persisted[2].pages[0].document.nodes).toEqual([]);
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(store.getSnapshot().editorState.past).toHaveLength(2);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('keeps the master and buffer when recovery-copy persistence fails and rolls memory back monotonically', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const result = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted, 1), '2026-11-20T14:01:00.000Z', ids('recovery-fail'),
    );

    expect(result.status).toBe('recovery-persist-failed');
    expect(persisted).toHaveLength(0);
    expect(store.getSnapshot().editorState.project.components.map((item) => item.id)).toEqual([master.id]);
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(store.getSnapshot().editorState.past).toHaveLength(0);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('keeps the last durable recovery snapshot if final deletion persistence fails, and reload restores it', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const result = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted, 2), '2026-11-20T14:02:00.000Z', ids('delete-fail'),
    );

    expect(result.status).toBe('deletion-persist-failed');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].components).toHaveLength(2);
    expect(store.getSnapshot().editorState.project.components).toHaveLength(2);
    expect(store.getSnapshot().projectRevision).toBe(3);
    expect(store.getSnapshot().editorState.past).toHaveLength(1);
    const reloaded = createCanonicalEditorStore(createEditorState(structuredClone(persisted[0])));
    expect(reloaded.getSnapshot().editorState.project.components).toHaveLength(2);
    expect(reloaded.getSnapshot().editorState.project.components.some((item) => item.id === master.id)).toBe(true);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('does not clear the buffer when cleanup persistence fails after deletion is durable', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const result = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted, 3), '2026-11-20T14:03:00.000Z', ids('cleanup-fail'),
    );

    expect(result.status).toBe('cleanup-persist-failed');
    expect(persisted).toHaveLength(2);
    expect(persisted[1].components).toHaveLength(1);
    expect(store.getSnapshot().editorState.project.components).toHaveLength(1);
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('rejects a concurrent canonical mutation during the recovery durability barrier', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    let attempted: ReturnType<CanonicalEditorStore['dispatchLegacyAction']> | undefined;
    let tried = false;
    const writer = makeDurableWriter(persisted, 0, (call) => {
      if (call !== 1 || tried) return;
      tried = true;
      attempted = store.dispatchLegacyAction({
        type: 'rename-component',
        componentId: master.id,
        expectedMasterDocument: master.document,
        expectedUpdatedAt: master.updatedAt,
        name: 'Concurrent rename',
      });
    });
    const result = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), writer, '2026-11-20T14:04:00.000Z', ids('serialized'),
    );

    expect(attempted).toMatchObject({ status: 'failed', errorCode: 'MUTATION_LOCKED' });
    expect(result.status).toBe('deleted');
    expect(store.getSnapshot().projectRevision).toBe(2);
  });

  it('retains a durably saved recovery copy when the master CAS changes before retrying deletion', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const first = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted, 2), '2026-11-20T14:05:00.000Z', ids('cas-retry'),
    );
    expect(first.status).toBe('deletion-persist-failed');
    const recoveryId = first.recoveryComponent!.id;

    const currentMaster = store.getSnapshot().editorState.project.components.find((item) => item.id === master.id)!;
    const renamed = store.dispatchLegacyAction({
      type: 'rename-component',
      componentId: currentMaster.id,
      expectedMasterDocument: currentMaster.document,
      expectedUpdatedAt: currentMaster.updatedAt,
      name: 'Latest master after recovery barrier',
    });
    expect(renamed.status).toBe('committed');

    const retry = await deleteComponentAfterDurableRecovery(
      store, targetFor(master), recoveryId, emptyBufferProject(), makeDurableWriter(persisted),
    );
    expect(retry.status).toBe('stale-master');
    expect(store.getSnapshot().editorState.project.components.some((item) => item.id === master.id)).toBe(true);
    expect(store.getSnapshot().editorState.project.components.some((item) => item.id === recoveryId)).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].components).toHaveLength(2);
    expect(buffer.nodes[1].x).toBe(master.document.nodes[1].x + 125);
  });

  it('rolls a non-recovery delete back to the previous in-memory snapshot when persistence fails', async () => {
    const { store, master } = createFixture();
    const persisted: FolioProject[] = [];
    const result = await deleteComponentDurably(
      store, targetFor(master), emptyBufferProject(), makeDurableWriter(persisted, 1),
    );

    expect(result.status).toBe('deletion-persist-failed');
    expect(store.getSnapshot().editorState.project.components.map((item) => item.id)).toEqual([master.id]);
    expect(store.getSnapshot().projectRevision).toBe(2);
    expect(persisted).toHaveLength(0);
  });

  it('retries only the deletion barrier after a durable recovery copy exists', async () => {
    const { store, master } = createFixture();
    const buffer = dirtyBuffer(master.document);
    const persisted: FolioProject[] = [];
    const first = await recoverAndDeleteComponentDurably(
      store, targetFor(master), recoveryProtection(master, buffer), buffer,
      emptyBufferProject(), makeDurableWriter(persisted, 2), '2026-11-20T14:06:00.000Z', ids('retry-copy'),
    );
    expect(first.status).toBe('deletion-persist-failed');
    const recoveryId = first.recoveryComponent!.id;

    const retry = await deleteComponentAfterDurableRecovery(
      store, targetFor(master), recoveryId, emptyBufferProject(), makeDurableWriter(persisted),
    );
    expect(retry.status).toBe('deleted');
    expect(persisted.at(-2)?.components).toEqual([expect.objectContaining({ id: recoveryId })]);
    expect(persisted.at(-1)?.metadata.id).toBe('folio-component-canvas');
  });
});

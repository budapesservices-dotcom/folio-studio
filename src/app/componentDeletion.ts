import type { ComponentDefinition, FolioDocument, FolioProject } from '../core/document/types';
import { shouldProtectComponentCanvasBuffer, type ComponentCanvasSyncSession } from './componentCanvasSync';
import type { CanonicalEditorStore, CanonicalEditorStoreSnapshot } from './editorStore';
import { createMainCanvasCommandClient } from './mainCanvasCommandClient';
import { executeNativeSnapshotRollback } from './nativeCommandExecutor';

export interface ComponentDeletionTarget {
  readonly componentId: string;
  readonly expectedMasterDocument: FolioDocument;
  readonly expectedUpdatedAt: string;
}

export interface ComponentDeletionProtection {
  /** True only when the target is the master currently open in Component Canvas. */
  readonly activeMaster: boolean;
  readonly bufferDocument: FolioDocument | null;
  readonly session: ComponentCanvasSyncSession | null;
  /** Includes pending master switches and any other UI recovery flow. */
  readonly recoveryPending?: boolean;
}

export type ComponentDeletionResult =
  | { status: 'deleted'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'stale-master'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'failed'; snapshot: CanonicalEditorStoreSnapshot };

export type ComponentDeletionRequestResult =
  | ComponentDeletionResult
  | { status: 'recovery-required' | 'ready'; snapshot: CanonicalEditorStoreSnapshot };

export type ComponentRecoveryCopyResult =
  | { status: 'saved'; component: ComponentDefinition; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'stale-master'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'failed'; snapshot: CanonicalEditorStoreSnapshot };

export type ComponentRecoveryIdFactory = (prefix: string) => string;

function matchesCurrentMaster(
  snapshot: CanonicalEditorStoreSnapshot,
  target: ComponentDeletionTarget,
): ComponentDefinition | undefined {
  const current = snapshot.editorState.project.components.find(
    (component) => component.id === target.componentId,
  );
  if (!current || current.document !== target.expectedMasterDocument ||
      current.updatedAt !== target.expectedUpdatedAt) return undefined;
  return current;
}

function requiresRecoveryChoice(
  master: ComponentDefinition,
  protection: ComponentDeletionProtection,
): boolean {
  const session = protection.session;
  return protection.recoveryPending === true ||
    !protection.bufferDocument ||
    !session ||
    session.componentId !== master.id ||
    session.baseDocument !== master.document ||
    session.baseUpdatedAt !== master.updatedAt ||
    shouldProtectComponentCanvasBuffer(session, protection.bufferDocument);
}

export function requestComponentDeletion(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  protection: ComponentDeletionProtection,
  deferActiveCommit = false,
): ComponentDeletionRequestResult {
  const snapshot = store.getSnapshot();
  const currentMaster = matchesCurrentMaster(snapshot, target);
  if (!currentMaster) return { status: 'stale-master', snapshot };

  if (protection.activeMaster && requiresRecoveryChoice(currentMaster, protection)) {
    return { status: 'recovery-required', snapshot };
  }
  if (protection.activeMaster && deferActiveCommit) return { status: 'ready', snapshot };
  return deleteComponentIfCurrent(store, target);
}

export function deleteComponentIfCurrent(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  mutationLease?: object,
): ComponentDeletionResult {
  const before = store.getSnapshot();
  if (!matchesCurrentMaster(before, target)) return { status: 'stale-master', snapshot: before };

  const client = createMainCanvasCommandClient(store, { actorId: 'component-deletion-engine' });
  const commandResult = client.deleteComponent({
    componentId: target.componentId,
    expectedMasterDocument: target.expectedMasterDocument,
    expectedUpdatedAt: target.expectedUpdatedAt,
  }, 'Delete component master', mutationLease);
  const after = store.getSnapshot();
  if (commandResult.status === 'rejected') {
    if (commandResult.code === 'COMPONENT_CONFLICT' || commandResult.code === 'TARGET_NOT_FOUND') {
      return { status: 'stale-master', snapshot: after };
    }
    return { status: 'failed', snapshot: after };
  }

  const stillExists = after.editorState.project.components.some(
    (component) => component.id === target.componentId,
  );
  if (stillExists || after === before) {
    return { status: 'stale-master', snapshot: after };
  }
  return { status: 'deleted', snapshot: after };
}

function cloneGraph<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneGraph(item)) as T;
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = cloneGraph(child);
    }
    return output as T;
  }
  return value;
}

function defaultRecoveryIdFactory(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function collectReservedIds(snapshot: CanonicalEditorStoreSnapshot): Set<string> {
  const project = snapshot.editorState.project;
  const ids = new Set<string>();
  const addDocumentIds = (document: FolioDocument) => {
    ids.add(document.id);
    for (const node of document.nodes) ids.add(node.id);
  };

  ids.add(project.metadata.id);
  for (const page of project.pages) {
    ids.add(page.id);
    addDocumentIds(page.document);
  }
  for (const component of project.components) {
    ids.add(component.id);
    addDocumentIds(component.document);
  }
  for (const graph of project.logicGraphs) {
    ids.add(graph.id);
    for (const node of graph.nodes) ids.add(node.id);
    for (const connection of graph.connections) ids.add(connection.id);
  }
  for (const asset of project.assets) ids.add(asset.id);
  return ids;
}

function createUniqueId(
  prefix: string,
  reservedIds: Set<string>,
  idFactory: ComponentRecoveryIdFactory,
): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = idFactory(prefix);
    if (typeof candidate === 'string' && candidate.length > 0 && !reservedIds.has(candidate)) {
      reservedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error('Unable to allocate unique recovery identifiers.');
}

/**
 * Persist a complete copy of the current Component Canvas document before the
 * caller attempts to delete the original master. A later delete conflict never
 * rolls this accepted recovery component back.
 */
export function saveComponentCanvasRecoveryCopy(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  bufferDocument: FolioDocument,
  now = new Date().toISOString(),
  idFactory: ComponentRecoveryIdFactory = defaultRecoveryIdFactory,
  mutationLease?: object,
): ComponentRecoveryCopyResult {
  const before = store.getSnapshot();
  const master = matchesCurrentMaster(before, target);
  if (!master) return { status: 'stale-master', snapshot: before };

  try {
    const reservedIds = collectReservedIds(before);
    const componentId = createUniqueId('component-recovered', reservedIds, idFactory);
    const documentId = createUniqueId('document-recovered', reservedIds, idFactory);
    const baseName = `${master.name} (Recovered)`;
    const existingNames = new Set(before.editorState.project.components.map(
      (component) => component.name.trim().toLocaleLowerCase(),
    ));
    let name = baseName;
    let suffix = 2;
    while (existingNames.has(name.toLocaleLowerCase())) {
      name = `${baseName} ${suffix}`;
      suffix += 1;
    }
    const parsedTimestamp = new Date(now);
    const timestamp = Number.isNaN(parsedTimestamp.getTime())
      ? new Date().toISOString()
      : parsedTimestamp.toISOString();
    const document = cloneGraph(bufferDocument);
    document.id = documentId;
    document.name = name;

    const component: ComponentDefinition = {
      id: componentId,
      name,
      document,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const client = createMainCanvasCommandClient(store, { actorId: 'component-recovery-engine' });
    const commandResult = client.createComponent(component, 'Save recovered component copy', mutationLease);
    const after = store.getSnapshot();
    if (commandResult.status !== 'applied' ||
        !after.editorState.project.components.some((item) => item.id === componentId)) {
      return { status: 'failed', snapshot: after };
    }
    return {
      status: 'saved',
      component: after.editorState.project.components.find(
        (item) => item.id === componentId,
      )!,
      snapshot: after,
    };
  } catch {
    return { status: 'failed', snapshot: store.getSnapshot() };
  }
}


export type ComponentDurableDeletionStatus =
  | 'deleted'
  | 'stale-master'
  | 'recovery-persist-failed'
  | 'deletion-persist-failed'
  | 'cleanup-persist-failed'
  | 'failed';

export interface ComponentDurableDeletionResult {
  readonly status: ComponentDurableDeletionStatus;
  readonly snapshot: CanonicalEditorStoreSnapshot;
  readonly recoveryComponent?: ComponentDefinition;
}

export type ComponentProjectWriteLock = <T>(
  operation: (persist: (project: FolioProject, projectRevision?: number) => Promise<void>) => Promise<T>,
) => Promise<T>;

function rollbackCanonicalSnapshot(
  store: CanonicalEditorStore,
  candidateState: Parameters<CanonicalEditorStore['commitEditorTransition']>[0]['candidateState'],
  mutationLease: object,
): CanonicalEditorStoreSnapshot {
  return executeNativeSnapshotRollback(store, candidateState, mutationLease);
}

/**
 * Recovery and deletion are separate canonical commits with an IndexedDB
 * transaction-complete barrier between them. The canonical store lease and
 * project write queue are held until the final buffer record is durable.
 */
export async function recoverAndDeleteComponentDurably(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  protection: ComponentDeletionProtection,
  bufferDocument: FolioDocument,
  emptyBufferProject: FolioProject,
  withProjectWriteLock: ComponentProjectWriteLock,
  now = new Date().toISOString(),
  idFactory: ComponentRecoveryIdFactory = defaultRecoveryIdFactory,
): Promise<ComponentDurableDeletionResult> {
  try {
    return await store.withMutationLock(async (mutationLease) => withProjectWriteLock(async (persist) => {
      const before = store.getSnapshot();
      const master = matchesCurrentMaster(before, target);
      if (!master) return { status: 'stale-master', snapshot: before };
      const session = protection.session;
      if (!protection.activeMaster || !session || session.componentId !== target.componentId ||
          !protection.bufferDocument || protection.bufferDocument !== bufferDocument ||
          !session.baseDocument || typeof session.baseUpdatedAt !== 'string') {
        return { status: 'failed', snapshot: before };
      }

      const recovery = saveComponentCanvasRecoveryCopy(
        store, target, bufferDocument, now, idFactory, mutationLease,
      );
      if (recovery.status !== 'saved') return {
        status: recovery.status === 'stale-master' ? 'stale-master' : 'failed',
        snapshot: recovery.snapshot,
      };

      try {
        await persist(recovery.snapshot.editorState.project, recovery.snapshot.projectRevision);
      } catch {
        const snapshot = rollbackCanonicalSnapshot(store, before.editorState, mutationLease);
        return { status: 'recovery-persist-failed', snapshot };
      }

      // Re-read and revalidate the master CAS only after IDB transaction completion.
      const afterRecovery = store.getSnapshot();
      if (!matchesCurrentMaster(afterRecovery, target)) {
        return { status: 'stale-master', snapshot: afterRecovery, recoveryComponent: recovery.component };
      }

      const deletion = deleteComponentIfCurrent(store, target, mutationLease);
      if (deletion.status !== 'deleted') return {
        status: deletion.status === 'stale-master' ? 'stale-master' : 'failed',
        snapshot: deletion.snapshot,
        recoveryComponent: recovery.component,
      };

      try {
        await persist(deletion.snapshot.editorState.project, deletion.snapshot.projectRevision);
      } catch {
        // Recovery copy is durable. Reverting is a new guarded commit; revision
        // remains monotonic and the durable recovery snapshot stays authoritative.
        const snapshot = rollbackCanonicalSnapshot(store, recovery.snapshot.editorState, mutationLease);
        return { status: 'deletion-persist-failed', snapshot, recoveryComponent: recovery.component };
      }

      try {
        await persist(emptyBufferProject);
      } catch {
        // Do not reset the UI/session; keep the current buffer available for retry.
        return { status: 'cleanup-persist-failed', snapshot: store.getSnapshot(),
          recoveryComponent: recovery.component };
      }
      return { status: 'deleted', snapshot: store.getSnapshot(), recoveryComponent: recovery.component };
    }));
  } catch {
    return { status: 'failed', snapshot: store.getSnapshot() };
  }
}

/** Clean active-master deletion still requires both canonical and buffer durability. */
export async function deleteComponentDurably(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  emptyBufferProject: FolioProject,
  withProjectWriteLock: ComponentProjectWriteLock,
): Promise<ComponentDurableDeletionResult> {
  try {
    return await store.withMutationLock(async (mutationLease) => withProjectWriteLock(async (persist) => {
      const before = store.getSnapshot();
      if (!matchesCurrentMaster(before, target)) return { status: 'stale-master', snapshot: before };
      const deletion = deleteComponentIfCurrent(store, target, mutationLease);
      if (deletion.status !== 'deleted') return {
        status: deletion.status === 'stale-master' ? 'stale-master' : 'failed',
        snapshot: deletion.snapshot,
      };
      try {
        await persist(deletion.snapshot.editorState.project, deletion.snapshot.projectRevision);
      } catch {
        const snapshot = rollbackCanonicalSnapshot(store, before.editorState, mutationLease);
        return { status: 'deletion-persist-failed', snapshot };
      }
      try {
        await persist(emptyBufferProject);
      } catch {
        return { status: 'cleanup-persist-failed', snapshot: store.getSnapshot() };
      }
      return { status: 'deleted', snapshot: store.getSnapshot() };
    }));
  } catch {
    return { status: 'failed', snapshot: store.getSnapshot() };
  }
}

/** Retry deletion without creating a second recovery copy after its first barrier. */
export async function deleteComponentAfterDurableRecovery(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
  recoveryComponentId: string,
  emptyBufferProject: FolioProject,
  withProjectWriteLock: ComponentProjectWriteLock,
): Promise<ComponentDurableDeletionResult> {
  try {
    return await store.withMutationLock(async (mutationLease) => withProjectWriteLock(async (persist) => {
      const before = store.getSnapshot();
      const recoveryComponent = before.editorState.project.components.find((item) => item.id === recoveryComponentId);
      if (!recoveryComponent || !matchesCurrentMaster(before, target)) {
        return { status: 'stale-master', snapshot: before,
          ...(recoveryComponent ? { recoveryComponent } : {}) };
      }
      const deletion = deleteComponentIfCurrent(store, target, mutationLease);
      if (deletion.status !== 'deleted') return {
        status: deletion.status === 'stale-master' ? 'stale-master' : 'failed',
        snapshot: deletion.snapshot,
        recoveryComponent,
      };
      try {
        await persist(deletion.snapshot.editorState.project, deletion.snapshot.projectRevision);
      } catch {
        const snapshot = rollbackCanonicalSnapshot(store, before.editorState, mutationLease);
        return { status: 'deletion-persist-failed', snapshot, recoveryComponent };
      }
      try {
        await persist(emptyBufferProject);
      } catch {
        return { status: 'cleanup-persist-failed', snapshot: store.getSnapshot(), recoveryComponent };
      }
      return { status: 'deleted', snapshot: store.getSnapshot(), recoveryComponent };
    }));
  } catch {
    return { status: 'failed', snapshot: store.getSnapshot() };
  }
}

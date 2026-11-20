import type { NativeChangeEvent } from '../core/commands/types';
import type { FolioDocument } from '../core/document/types';
import { getActiveDocument } from '../core/document/project';
import { validateProject } from '../core/document/validation';
import { getNativeCommandCommitAuthorization } from './nativeCommandExecutor';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

const RESERVED_COMPONENT_CANVAS_ID = 'folio-component-canvas';
const EDITOR_HISTORY_LIMIT = 60;
const storeIdentities = new WeakMap<object, object>();
const snapshotOwners = new WeakMap<object, object>();

export interface CanonicalEditorStoreSnapshot {
  readonly editorState: EditorState;
  readonly projectRevision: number;
}

export interface ComponentSyncCommitGuard {
  readonly componentId: string;
  readonly expectedMasterDocument: FolioDocument;
  readonly expectedUpdatedAt: string;
}

export interface EditorStoreCommitInput {
  expectedProjectRevision: number;
  expectedEditorState: EditorState;
  candidateState: EditorState;
  componentSyncGuard?: ComponentSyncCommitGuard;
  nativeCommandPreparation?: object;
}

export type EditorStoreCommitResult =
  | { status: 'committed'; snapshot: CanonicalEditorStoreSnapshot; event?: NativeChangeEvent }
  | { status: 'revision-conflict'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'editor-conflict'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'component-conflict'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'failed'; snapshot: CanonicalEditorStoreSnapshot; errorCode: string };

export interface CanonicalEditorStore {
  getSnapshot(): CanonicalEditorStoreSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeChanges(listener: (event: NativeChangeEvent) => void): () => void;
  commitEditorTransition(input: EditorStoreCommitInput, mutationLease?: object): EditorStoreCommitResult;
  dispatchLegacyAction(action: EditorAction, mutationLease?: object): EditorStoreCommitResult;
  withMutationLock<T>(operation: (mutationLease: object) => Promise<T>): Promise<T>;
}

function freezeGraph<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) freezeGraph(child, seen);
  return Object.freeze(object) as T;
}

function cloneEventGraph<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing as T;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(object, output);
    for (const child of value) output.push(cloneEventGraph(child, seen));
    return output as T;
  }
  const prototype = Object.getPrototypeOf(value);
  const output: Record<string, unknown> = Object.create(prototype === null ? null : Object.prototype);
  seen.set(object, output);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = cloneEventGraph(child, seen);
  }
  return output as T;
}

function isHistoricalProject(value: unknown): boolean {
  try {
    if (typeof value !== 'object' || value === null) return false;
    const project = value as EditorState['project'];
    return project.metadata.id !== RESERVED_COMPONENT_CANVAS_ID && validateProject(project).ok;
  } catch {
    return false;
  }
}

/** Validate the current project, every historical project, and selection against the active Main Canvas document. */
function isEditorState(value: unknown): value is EditorState {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.project !== 'object' || candidate.project === null ||
        !validateProject(candidate.project as EditorState['project']).ok ||
        !Array.isArray(candidate.past) || !Array.isArray(candidate.future) ||
        candidate.past.length + candidate.future.length > EDITOR_HISTORY_LIMIT ||
        !candidate.past.every(isHistoricalProject) || !candidate.future.every(isHistoricalProject) ||
        (candidate.selectedNodeId !== null && typeof candidate.selectedNodeId !== 'string') ||
        !Array.isArray(candidate.selectedNodeIds) ||
        !candidate.selectedNodeIds.every((id) => typeof id === 'string' && id.length > 0) ||
        (candidate.historyGroup !== null && typeof candidate.historyGroup !== 'string')) return false;

    const selectedIds = candidate.selectedNodeIds as string[];
    if (new Set(selectedIds).size !== selectedIds.length) return false;
    const expectedSelectedNodeId = selectedIds.length === 1 ? selectedIds[0] : null;
    if (candidate.selectedNodeId !== expectedSelectedNodeId) return false;

    const activeNodeIds = new Set(getActiveDocument(candidate.project as EditorState['project']).nodes.map((node) => node.id));
    return selectedIds.every((id) => activeNodeIds.has(id));
  } catch {
    return false;
  }
}

function isComponentSyncGuard(value: unknown): value is ComponentSyncCommitGuard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 3 && typeof candidate.componentId === 'string' &&
    candidate.componentId.length > 0 && typeof candidate.expectedUpdatedAt === 'string' &&
    typeof candidate.expectedMasterDocument === 'object' && candidate.expectedMasterDocument !== null;
}

function isCommitInput(value: unknown): value is EditorStoreCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return keys.every((key) =>
    key === 'expectedProjectRevision' || key === 'expectedEditorState' ||
    key === 'candidateState' || key === 'componentSyncGuard' || key === 'nativeCommandPreparation') &&
    keys.includes('expectedProjectRevision') && keys.includes('expectedEditorState') && keys.includes('candidateState') &&
    (candidate.componentSyncGuard === undefined || isComponentSyncGuard(candidate.componentSyncGuard)) &&
    (candidate.nativeCommandPreparation === undefined ||
      (typeof candidate.nativeCommandPreparation === 'object' && candidate.nativeCommandPreparation !== null)) &&
    Number.isSafeInteger(candidate.expectedProjectRevision) && Number(candidate.expectedProjectRevision) >= 0 &&
    typeof candidate.expectedEditorState === 'object' && candidate.expectedEditorState !== null &&
    typeof candidate.candidateState === 'object' && candidate.candidateState !== null;
}

class MainCanvasEditorStore implements CanonicalEditorStore {
  private snapshot: CanonicalEditorStoreSnapshot;
  private readonly identity = {};
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<(event: NativeChangeEvent) => void>();
  private committing = false;
  private notifying = false;
  private mutationLease: object | null = null;

  constructor(initialState: EditorState) {
    if (!isEditorState(initialState)) {
      throw new Error('Cannot create the Main Canvas store from an invalid editor state.');
    }
    if (initialState.project.metadata.id === RESERVED_COMPONENT_CANVAS_ID) {
      throw new Error('The temporary Component Canvas buffer cannot become the canonical Main Canvas project.');
    }
    storeIdentities.set(this, this.identity);
    this.snapshot = Object.freeze({ editorState: freezeGraph(initialState), projectRevision: 0 });
    snapshotOwners.set(this.snapshot as object, this.identity);
  }

  getSnapshot(): CanonicalEditorStoreSnapshot { return this.snapshot; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeChanges(listener: (event: NativeChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  commitEditorTransition(input: EditorStoreCommitInput, mutationLease?: object): EditorStoreCommitResult {
    const beforeSnapshot = this.snapshot;
    if (this.mutationLease !== null && mutationLease !== this.mutationLease) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'MUTATION_LOCKED' };
    }
    if (mutationLease !== undefined && mutationLease !== this.mutationLease) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_MUTATION_LEASE' };
    }
    if (this.committing || this.notifying) return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'REENTRANT_COMMIT' };
    if (!isCommitInput(input)) return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_COMMIT_INPUT' };
    if (!isEditorState(input.expectedEditorState) || !isEditorState(input.candidateState)) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_EDITOR_STATE' };
    }
    if (input.expectedProjectRevision !== beforeSnapshot.projectRevision) return { status: 'revision-conflict', snapshot: beforeSnapshot };
    if (input.expectedEditorState !== beforeSnapshot.editorState) return { status: 'editor-conflict', snapshot: beforeSnapshot };

    if (input.componentSyncGuard) {
      const expected = input.componentSyncGuard;
      const currentMaster = beforeSnapshot.editorState.project.components.find((component) => component.id === expected.componentId);
      if (!currentMaster || currentMaster.document !== expected.expectedMasterDocument ||
          currentMaster.updatedAt !== expected.expectedUpdatedAt) {
        return { status: 'component-conflict', snapshot: beforeSnapshot };
      }
    }

    const authorization = input.nativeCommandPreparation
      ? getNativeCommandCommitAuthorization(input.nativeCommandPreparation)
      : undefined;
    if (input.nativeCommandPreparation && (!authorization ||
        authorization.baseSnapshot !== beforeSnapshot || authorization.candidateState !== input.candidateState)) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'UNAUTHORIZED_EVENT_PUBLICATION' };
    }
    if (input.candidateState === beforeSnapshot.editorState) {
      return authorization
        ? { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_CHANGE_EVENT_COMMIT' }
        : { status: 'committed', snapshot: beforeSnapshot };
    }

    const projectMutation = input.candidateState.project !== beforeSnapshot.editorState.project;
    if (authorization && !projectMutation) return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_CHANGE_EVENT_COMMIT' };
    if (projectMutation) {
      if (input.candidateState.project.metadata.id === RESERVED_COMPONENT_CANVAS_ID) {
        return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_CANONICAL_PROJECT' };
      }
      if (!validateProject(input.candidateState.project).ok) {
        return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'PROJECT_VALIDATION_FAILED' };
      }
    }

    const nextRevision = beforeSnapshot.projectRevision + (projectMutation ? 1 : 0);
    let event: NativeChangeEvent | undefined;
    if (authorization) {
      try {
        const { changeDraft, changeSource } = authorization;
        if (changeDraft.projectId !== beforeSnapshot.editorState.project.metadata.id ||
            changeDraft.commandIds.length !== 1 || !changeDraft.commandIds[0] || changeSource.workspace !== 'main') {
          return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_CHANGE_EVENT_COMMIT' };
        }
        const commandId = changeDraft.commandIds[0];
        event = freezeGraph(cloneEventGraph({
          eventId: commandId + ':change',
          projectId: changeDraft.projectId,
          projectRevision: nextRevision,
          commandId,
          ...(changeDraft.transactionId ? { transactionId: changeDraft.transactionId } : {}),
          source: changeSource,
          change: { ...changeDraft, projectRevision: nextRevision },
        }));
      } catch {
        return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_CHANGE_EVENT_COMMIT' };
      }
    }

    let acceptedState: EditorState;
    try { acceptedState = freezeGraph(input.candidateState); }
    catch { return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'COMMIT_FAILED' }; }

    const nextSnapshot: CanonicalEditorStoreSnapshot = Object.freeze({
      editorState: acceptedState,
      projectRevision: nextRevision,
    });
    this.committing = true;
    try {
      this.snapshot = nextSnapshot;
      snapshotOwners.set(nextSnapshot as object, this.identity);
      for (const listener of this.listeners) {
        try { listener(); } catch { /* View notifications cannot roll back an accepted transition. */ }
      }
      if (event) {
        this.notifying = true;
        try {
          for (const listener of this.changeListeners) {
            try { listener(event); } catch { /* Subscriber code is isolated from the accepted commit. */ }
          }
        } finally { this.notifying = false; }
      }
      return { status: 'committed', snapshot: this.snapshot, ...(event ? { event } : {}) };
    } finally {
      this.notifying = false;
      this.committing = false;
    }
  }

  dispatchLegacyAction(action: EditorAction, mutationLease?: object): EditorStoreCommitResult {
    const before = this.snapshot;
    try {
      const candidateState = editorReducer(before.editorState, action);
      const componentSyncGuard = action.type === 'sync-component-document' ||
        action.type === 'rename-component' || action.type === 'delete-component'
        ? {
            componentId: action.componentId,
            expectedMasterDocument: action.expectedMasterDocument,
            expectedUpdatedAt: action.expectedUpdatedAt,
          }
        : undefined;
      return this.commitEditorTransition({
        expectedProjectRevision: before.projectRevision, expectedEditorState: before.editorState,
        candidateState, ...(componentSyncGuard ? { componentSyncGuard } : {}),
      }, mutationLease);
    } catch {
      return { status: 'failed', snapshot: before, errorCode: 'LEGACY_TRANSITION_FAILED' };
    }
  }

  async withMutationLock<T>(operation: (mutationLease: object) => Promise<T>): Promise<T> {
    if (this.mutationLease !== null) throw new Error('The canonical project is already mutation-locked.');
    const mutationLease = Object.freeze({});
    this.mutationLease = mutationLease;
    try {
      return await operation(mutationLease);
    } finally {
      if (this.mutationLease === mutationLease) this.mutationLease = null;
    }
  }
}

export function isSnapshotOwnedByStore(store: CanonicalEditorStore, snapshot: CanonicalEditorStoreSnapshot): boolean {
  const identity = storeIdentities.get(store as object);
  return identity !== undefined && snapshotOwners.get(snapshot as object) === identity;
}

export function createCanonicalEditorStore(initialState: EditorState): CanonicalEditorStore {
  return new MainCanvasEditorStore(initialState);
}

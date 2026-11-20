import type { NativeChangeEvent } from '../core/commands/types';
import { validateProject } from '../core/document/validation';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

export interface CanonicalEditorStoreSnapshot {
  readonly editorState: EditorState;
  readonly projectRevision: number;
}

export type EditorStoreCommitResult =
  | { status: 'committed'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'revision-conflict'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'failed'; snapshot: CanonicalEditorStoreSnapshot; errorCode: string };

export interface CommitEditorTransitionInput {
  expectedProjectRevision: number;
  candidateState: EditorState;
  changeDraft?: unknown;
}

type SnapshotListener = (snapshot: CanonicalEditorStoreSnapshot) => void;
type ChangeListener = (event: NativeChangeEvent) => void;

const RESERVED_COMPONENT_CANVAS_ID = 'folio-component-canvas';
const COMPLETED_COMMAND_ID_LIMIT = 500;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function isEditorState(value: unknown): value is EditorState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.project === 'object' && state.project !== null
    && Array.isArray(state.past)
    && Array.isArray(state.future)
    && (state.selectedNodeId === null || typeof state.selectedNodeId === 'string')
    && Array.isArray(state.selectedNodeIds)
    && (state.historyGroup === null || typeof state.historyGroup === 'string');
}

function failed(snapshot: CanonicalEditorStoreSnapshot, errorCode: string): EditorStoreCommitResult {
  return { status: 'failed', snapshot, errorCode };
}

/** The sole in-memory owner of Main Canvas EditorState and projectRevision. */
export class CanonicalEditorStore {
  private snapshot: CanonicalEditorStoreSnapshot;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly completedCommandIds = new Set<string>();
  private isPublishing = false;

  constructor(initialState: EditorState) {
    if (!isEditorState(initialState)) throw new Error('The canonical editor store requires a valid EditorState.');
    const validation = validateProject(initialState.project);
    if (!validation.ok) throw new Error(validation.error ?? 'The initial project is invalid.');
    if (initialState.project.metadata.id === RESERVED_COMPONENT_CANVAS_ID) {
      throw new Error('The Component Canvas buffer cannot own the canonical project revision.');
    }
    this.snapshot = deepFreeze({ editorState: initialState, projectRevision: 0 });
  }

  getSnapshot(): CanonicalEditorStoreSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  subscribeNativeChanges(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Legacy Main Canvas actions are reduced privately, then accepted at the same boundary. */
  dispatchLegacyAction(action: EditorAction): EditorStoreCommitResult {
    const before = this.snapshot;
    const candidateState = editorReducer(before.editorState, action);
    return this.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      candidateState,
    });
  }

  commitEditorTransition(input: CommitEditorTransitionInput): EditorStoreCommitResult {
    const before = this.snapshot;
    if (this.isPublishing) return failed(before, 'REENTRANT_COMMIT');
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return failed(before, 'INVALID_COMMIT_INPUT');
    }

    const runtimeInput = input as unknown as Record<string, unknown>;
    const allowedKeys = new Set(['expectedProjectRevision', 'candidateState', 'changeDraft']);
    if (Object.keys(runtimeInput).some((key) => !allowedKeys.has(key)) || 'projectMutation' in runtimeInput) {
      return failed(before, 'INVALID_COMMIT_INPUT');
    }
    if (!Number.isSafeInteger(input.expectedProjectRevision) || input.expectedProjectRevision < 0) {
      return failed(before, 'INVALID_COMMIT_INPUT');
    }
    if (input.expectedProjectRevision !== before.projectRevision) {
      return { status: 'revision-conflict', snapshot: before };
    }
    if (!isEditorState(input.candidateState)) return failed(before, 'INVALID_CANDIDATE_STATE');
    if (input.candidateState === before.editorState) {
      return { status: 'committed', snapshot: before };
    }

    // The store alone derives project mutation from immutable before/after references.
    const projectMutation = before.editorState.project !== input.candidateState.project;
    if (projectMutation) {
      if (input.candidateState.project.metadata.id === RESERVED_COMPONENT_CANVAS_ID) {
        return failed(before, 'INVALID_CANONICAL_PROJECT');
      }
      const validation = validateProject(input.candidateState.project);
      if (!validation.ok) return failed(before, 'PROJECT_VALIDATION_FAILED');
    }

    try {
      const nextRevision = before.projectRevision + (projectMutation ? 1 : 0);
      const nextSnapshot = deepFreeze({
        editorState: input.candidateState,
        projectRevision: nextRevision,
      });
      this.snapshot = nextSnapshot;
      this.publishSnapshot(nextSnapshot);
      return { status: 'committed', snapshot: nextSnapshot };
    } catch {
      return failed(before, 'INTERNAL_ERROR');
    }
  }

  publishNativeChange(event: NativeChangeEvent): boolean {
    const current = this.snapshot;
    if (event.projectId !== current.editorState.project.metadata.id
      || event.projectRevision !== current.projectRevision
      || this.isPublishing) return false;
    this.isPublishing = true;
    try {
      for (const listener of this.changeListeners) {
        try { listener(event); } catch { /* Subscriber failure cannot roll back a committed edit. */ }
      }
    } finally {
      this.isPublishing = false;
    }
    return true;
  }

  hasCompletedCommandId(commandId: string): boolean {
    return this.completedCommandIds.has(commandId);
  }

  rememberCompletedCommandId(commandId: string): void {
    if (!commandId) return;
    this.completedCommandIds.add(commandId);
    while (this.completedCommandIds.size > COMPLETED_COMMAND_ID_LIMIT) {
      const oldest = this.completedCommandIds.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.completedCommandIds.delete(oldest);
    }
  }

  private publishSnapshot(snapshot: CanonicalEditorStoreSnapshot): void {
    this.isPublishing = true;
    try {
      for (const listener of this.snapshotListeners) {
        try { listener(snapshot); } catch { /* Rendering subscribers do not own commit success. */ }
      }
    } finally {
      this.isPublishing = false;
    }
  }
}

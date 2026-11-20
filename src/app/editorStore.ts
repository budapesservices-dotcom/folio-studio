import { validateProject } from '../core/document/validation';
import type { NativeChangeEvent, NativeChangeSetDraft } from '../core/commands/types';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

export interface CanonicalEditorStoreSnapshot {
  readonly editorState: EditorState;
  readonly projectRevision: number;
}

export interface EditorStoreCommitInput {
  expectedProjectRevision: number;
  candidateState: EditorState;
  changeDraft?: NativeChangeSetDraft;
}

export type EditorStoreCommitResult =
  | { status: 'committed'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'no-op'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'revision-conflict'; snapshot: CanonicalEditorStoreSnapshot }
  | { status: 'failed'; snapshot: CanonicalEditorStoreSnapshot; errorCode: string };

export interface CanonicalEditorStore {
  getSnapshot(): CanonicalEditorStoreSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeChanges(listener: (event: NativeChangeEvent) => void): () => void;
  commitEditorTransition(input: EditorStoreCommitInput): EditorStoreCommitResult;
  dispatchLegacyAction(action: EditorAction): EditorStoreCommitResult;
  publishChange(event: NativeChangeEvent): boolean;
}

function freezeGraph<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) freezeGraph(child, seen);
  return Object.freeze(object) as T;
}

function isEditorState(value: unknown): value is EditorState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.project === 'object' && candidate.project !== null &&
    Array.isArray(candidate.past) &&
    Array.isArray(candidate.future) &&
    (candidate.selectedNodeId === null || typeof candidate.selectedNodeId === 'string') &&
    Array.isArray(candidate.selectedNodeIds) &&
    candidate.selectedNodeIds.every((id) => typeof id === 'string') &&
    (candidate.historyGroup === null || typeof candidate.historyGroup === 'string')
  );
}

function isCommitInput(value: unknown): value is EditorStoreCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return (
    keys.every((key) => key === 'expectedProjectRevision' || key === 'candidateState' || key === 'changeDraft') &&
    keys.includes('expectedProjectRevision') && keys.includes('candidateState') &&
    (candidate.changeDraft === undefined || (typeof candidate.changeDraft === 'object' && candidate.changeDraft !== null)) &&
    Number.isSafeInteger(candidate.expectedProjectRevision) &&
    Number(candidate.expectedProjectRevision) >= 0 &&
    isEditorState(candidate.candidateState)
  );
}

/**
 * The single in-memory owner of the Main Canvas EditorState and its monotonic
 * project revision. The project graph is frozen at ingress and every accepted
 * candidate, preventing writes through retained mutable aliases.
 */
class MainCanvasEditorStore implements CanonicalEditorStore {
  private snapshot: CanonicalEditorStoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<(event: NativeChangeEvent) => void>();
  private committing = false;
  private notifying = false;

  constructor(initialState: EditorState) {
    if (!isEditorState(initialState) || !validateProject(initialState.project).ok) {
      throw new Error('Cannot create the Main Canvas store from an invalid editor state.');
    }
    this.snapshot = Object.freeze({
      editorState: freezeGraph(initialState),
      projectRevision: 0,
    });
  }

  getSnapshot(): CanonicalEditorStoreSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeChanges(listener: (event: NativeChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  commitEditorTransition(input: EditorStoreCommitInput): EditorStoreCommitResult {
    const beforeSnapshot = this.snapshot;
    if (this.committing || this.notifying) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'REENTRANT_COMMIT' };
    }
    if (!isCommitInput(input)) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'INVALID_COMMIT_INPUT' };
    }
    if (input.expectedProjectRevision !== beforeSnapshot.projectRevision) {
      return { status: 'revision-conflict', snapshot: beforeSnapshot };
    }
    if (input.candidateState === beforeSnapshot.editorState) {
      return { status: 'no-op', snapshot: beforeSnapshot };
    }

    const projectMutation = input.candidateState.project !== beforeSnapshot.editorState.project;
    if (projectMutation && !validateProject(input.candidateState.project).ok) {
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'PROJECT_VALIDATION_FAILED' };
    }

    this.committing = true;
    try {
      const acceptedState = freezeGraph(input.candidateState);
      this.snapshot = Object.freeze({
        editorState: acceptedState,
        projectRevision: beforeSnapshot.projectRevision + (projectMutation ? 1 : 0),
      });
      for (const listener of this.listeners) {
        try { listener(); } catch { /* A view subscriber cannot roll back a committed transition. */ }
      }
      return { status: 'committed', snapshot: this.snapshot };
    } catch {
      this.snapshot = beforeSnapshot;
      return { status: 'failed', snapshot: beforeSnapshot, errorCode: 'COMMIT_FAILED' };
    } finally {
      this.committing = false;
    }
  }

  dispatchLegacyAction(action: EditorAction): EditorStoreCommitResult {
    const before = this.snapshot;
    try {
      const candidateState = editorReducer(before.editorState, action);
      return this.commitEditorTransition({
        expectedProjectRevision: before.projectRevision,
        candidateState,
      });
    } catch {
      return { status: 'failed', snapshot: before, errorCode: 'LEGACY_TRANSITION_FAILED' };
    }
  }

  publishChange(event: NativeChangeEvent): boolean {
    const current = this.snapshot;
    if (this.committing || this.notifying ||
        event.projectId !== current.editorState.project.metadata.id ||
        event.projectRevision !== current.projectRevision) return false;

    this.notifying = true;
    try {
      for (const listener of this.changeListeners) {
        try { listener(event); } catch { /* A subscriber cannot invalidate the committed project. */ }
      }
      return true;
    } finally {
      this.notifying = false;
    }
  }
}

export function createCanonicalEditorStore(initialState: EditorState): CanonicalEditorStore {
  return new MainCanvasEditorStore(initialState);
}

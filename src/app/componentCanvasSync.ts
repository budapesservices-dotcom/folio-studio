import { createInitialProject } from '../core/document/factory';
import { areDocumentsStructurallyEqual } from '../core/document/equality';
import type {
  AnimationClip,
  ComponentDefinition,
  DesignTokenCollection,
  FolioDocument,
  FolioProject,
} from '../core/document/types';
import type { EditorAction } from './editorReducer';

export type ComponentCanvasMasterStatus = 'present' | 'missing' | 'returned';
export interface ComponentCanvasSyncSession {
  readonly componentId: string;
  readonly baseDocument: FolioDocument;
  readonly baseAnimations?: readonly AnimationClip[];
  readonly baseUpdatedAt: string;
  readonly observedCanonicalDocument: FolioDocument;
  readonly observedCanonicalAnimations?: readonly AnimationClip[];
  readonly conflicted: boolean;
  readonly masterStatus: ComponentCanvasMasterStatus;
}
export type ComponentCanvasReconciliation =
  | { status: 'current'; session: ComponentCanvasSyncSession }
  | { status: 'reload-buffer'; session: ComponentCanvasSyncSession; canonicalDocument: FolioDocument }
  | { status: 'conflict'; session: ComponentCanvasSyncSession }
  | { status: 'master-mismatch'; session: ComponentCanvasSyncSession }
  | { status: 'orphaned-master-returned'; session: ComponentCanvasSyncSession }
  | { status: 'orphaned'; session: ComponentCanvasSyncSession };

function normalizeComponentAnimations(
  animations: readonly AnimationClip[] | undefined,
): AnimationClip[] {
  if (!animations || animations.length === 0) return [];
  return animations.map((clip) => ({
    ...clip,
    pageId: 'component-master',
  }));
}

function areComponentAnimationsEqual(
  a: readonly AnimationClip[] | undefined,
  b: readonly AnimationClip[] | undefined,
): boolean {
  const normA = normalizeComponentAnimations(a);
  const normB = normalizeComponentAnimations(b);
  if (normA.length === 0 && normB.length === 0) return true;
  if (normA.length !== normB.length) return false;
  return JSON.stringify(normA) === JSON.stringify(normB);
}

export function createComponentCanvasSyncSession(master: ComponentDefinition): ComponentCanvasSyncSession {
  return {
    componentId: master.id,
    baseDocument: master.document,
    baseAnimations: master.animations,
    baseUpdatedAt: master.updatedAt,
    observedCanonicalDocument: master.document,
    observedCanonicalAnimations: master.animations,
    conflicted: false,
    masterStatus: 'present',
  };
}

export function markComponentCanvasMasterMissing(session: ComponentCanvasSyncSession): ComponentCanvasSyncSession {
  return { ...session, masterStatus: 'missing' };
}

/** Prevent replacing a Component Canvas buffer while it contains unsynchronized or conflicted local work. */
export function shouldProtectComponentCanvasBuffer(
  session: ComponentCanvasSyncSession,
  bufferDocument: FolioDocument,
  bufferAnimations?: readonly AnimationClip[],
): boolean {
  const animationsDirty = bufferAnimations !== undefined &&
    !areComponentAnimationsEqual(session.baseAnimations, bufferAnimations);
  return session.masterStatus !== 'present' || session.conflicted ||
    !areDocumentsStructurallyEqual(session.baseDocument, bufferDocument) ||
    animationsDirty;
}

/** A master disappearing from history never clears the local buffer; a returning ID needs explicit recovery. */
export function reconcileComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  master: ComponentDefinition,
  bufferDocument: FolioDocument,
  bufferAnimations?: readonly AnimationClip[],
): ComponentCanvasReconciliation {
  if (session.masterStatus === 'missing') {
    return {
      status: 'orphaned-master-returned',
      session: {
        ...session,
        masterStatus: 'returned',
        observedCanonicalDocument: master.document,
        observedCanonicalAnimations: master.animations,
      },
    };
  }
  if (session.masterStatus === 'returned') return { status: 'orphaned', session };
  if (session.componentId !== master.id) return { status: 'master-mismatch', session };
  if (session.conflicted) {
    const sameCanonical =
      areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document) &&
      areComponentAnimationsEqual(session.observedCanonicalAnimations, master.animations);
    const next = sameCanonical
      ? session
      : {
          ...session,
          observedCanonicalDocument: master.document,
          observedCanonicalAnimations: master.animations,
        };
    return { status: 'conflict', session: next };
  }
  const changed = session.baseUpdatedAt !== master.updatedAt ||
    !areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document) ||
    !areComponentAnimationsEqual(session.observedCanonicalAnimations, master.animations);
  if (!changed) return { status: 'current', session };
  const localDirty =
    !areDocumentsStructurallyEqual(session.baseDocument, bufferDocument) ||
    (bufferAnimations !== undefined && !areComponentAnimationsEqual(session.baseAnimations, bufferAnimations));
  if (localDirty) {
    return {
      status: 'conflict',
      session: {
        ...session,
        observedCanonicalDocument: master.document,
        observedCanonicalAnimations: master.animations,
        conflicted: true,
      },
    };
  }
  return { status: 'reload-buffer', session: createComponentCanvasSyncSession(master), canonicalDocument: master.document };
}

export function createComponentCanvasBufferProject(
  master: ComponentDefinition,
  designTokens?: DesignTokenCollection,
): FolioProject {
  const project = createInitialProject(master.name);
  project.metadata.id = 'folio-component-canvas';
  project.metadata.name = master.name;
  project.pages[0].name = master.name;
  project.pages[0].route = '/';
  project.pages[0].document = { ...master.document, name: master.name, nodes: master.document.nodes.map((node) => ({ ...node })) };
  if (master.animations && master.animations.length > 0) {
    const bufferPageId = project.pages[0].id;
    project.animations = master.animations.map((clip) => ({
      ...clip,
      pageId: bufferPageId,
      tracks: clip.tracks.map((track) => ({
        ...track,
        keyframes: track.keyframes.map((kf) => ({ ...kf })),
      })),
    }));
  }
  if (designTokens) {
    project.designTokens = designTokens;
  }
  return project;
}

/** Creates an atomic compare-and-swap action rather than a stale full ComponentDefinition replacement. */
export function createComponentCanvasSyncAction(
  master: ComponentDefinition | undefined,
  editedDocument: FolioDocument,
  session?: ComponentCanvasSyncSession,
  editedAnimations?: readonly AnimationClip[],
): Extract<EditorAction, { type: 'sync-component-document' }> | null {
  if (!master) return null;
  const docsEqual = areDocumentsStructurallyEqual(master.document, editedDocument);
  const animationsEqual = editedAnimations === undefined
    ? true
    : areComponentAnimationsEqual(master.animations, editedAnimations);
  if (docsEqual && animationsEqual) return null;
  if (session && (
    session.componentId !== master.id || session.conflicted || session.masterStatus !== 'present' ||
    session.baseDocument !== master.document || session.baseUpdatedAt !== master.updatedAt
  )) return null;
  const normalizedAnimations = editedAnimations !== undefined
    ? normalizeComponentAnimations(editedAnimations)
    : undefined;
  return {
    type: 'sync-component-document',
    componentId: master.id,
    expectedMasterDocument: session?.baseDocument ?? master.document,
    expectedUpdatedAt: session?.baseUpdatedAt ?? master.updatedAt,
    document: editedDocument,
    ...(normalizedAnimations !== undefined ? { animations: normalizedAnimations } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function advanceComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  committedMaster: ComponentDefinition,
): ComponentCanvasSyncSession {
  if (session.componentId !== committedMaster.id) {
    return {
      ...session,
      observedCanonicalDocument: committedMaster.document,
      observedCanonicalAnimations: committedMaster.animations,
      conflicted: true,
    };
  }
  return {
    componentId: committedMaster.id,
    baseDocument: committedMaster.document,
    baseAnimations: committedMaster.animations,
    baseUpdatedAt: committedMaster.updatedAt,
    observedCanonicalDocument: committedMaster.document,
    observedCanonicalAnimations: committedMaster.animations,
    conflicted: false,
    masterStatus: 'present',
  };
}

/**
 * Advances `baseUpdatedAt` when non-document master metadata (such as Variant axes or Slots)
 * is intentionally updated, only when the session was previously aligned and the master document
 * itself did not diverge. Preserves all concurrent conflict and recovery safeguards.
 */
export function acknowledgeComponentCanvasMetadataUpdate(
  session: ComponentCanvasSyncSession,
  previousUpdatedAt: string,
  committedMaster: ComponentDefinition,
): ComponentCanvasSyncSession {
  if (
    session.componentId !== committedMaster.id
    || session.conflicted
    || session.masterStatus !== 'present'
    || session.baseUpdatedAt !== previousUpdatedAt
    || !areDocumentsStructurallyEqual(session.baseDocument, committedMaster.document)
  ) {
    return session;
  }
  return {
    ...session,
    baseDocument: committedMaster.document,
    baseAnimations: committedMaster.animations,
    baseUpdatedAt: committedMaster.updatedAt,
    observedCanonicalDocument: committedMaster.document,
    observedCanonicalAnimations: committedMaster.animations,
  };
}

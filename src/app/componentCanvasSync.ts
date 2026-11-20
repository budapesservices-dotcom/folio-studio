import { createInitialProject } from '../core/document/factory';
import { areDocumentsStructurallyEqual } from '../core/document/equality';
import type { ComponentDefinition, FolioDocument, FolioProject } from '../core/document/types';
import type { EditorAction } from './editorReducer';

export interface ComponentCanvasSyncSession {
  readonly componentId: string;
  /** Canonical document version from which the local buffer was last based/synchronized. */
  readonly baseDocument: FolioDocument;
  /** Most recent canonical master version observed by this open session. */
  readonly observedCanonicalDocument: FolioDocument;
  /** True when both canonical and local edits diverged; local buffer is retained but cannot write. */
  readonly conflicted: boolean;
}

export type ComponentCanvasReconciliation =
  | { status: 'current'; session: ComponentCanvasSyncSession }
  | { status: 'reload-buffer'; session: ComponentCanvasSyncSession; canonicalDocument: FolioDocument }
  | { status: 'conflict'; session: ComponentCanvasSyncSession }
  | { status: 'master-mismatch'; session: ComponentCanvasSyncSession };

export function createComponentCanvasSyncSession(
  master: ComponentDefinition,
): ComponentCanvasSyncSession {
  return {
    componentId: master.id,
    baseDocument: master.document,
    observedCanonicalDocument: master.document,
    conflicted: false,
  };
}

/**
 * Reconciles the local Component Canvas buffer against the latest Main Canvas master.
 *
 * A clean buffer is rebased to an independently changed canonical document (including
 * Undo/Redo). If both sides changed since the last synchronized baseline, the canonical
 * version wins as the shared truth, while the unsynchronized local buffer is preserved
 * and write synchronization is paused until the user explicitly reopens the master.
 */
export function reconcileComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  master: ComponentDefinition,
  bufferDocument: FolioDocument,
): ComponentCanvasReconciliation {
  if (session.componentId !== master.id) return { status: 'master-mismatch', session };

  if (session.conflicted) {
    const nextSession = areDocumentsStructurallyEqual(
      session.observedCanonicalDocument,
      master.document,
    )
      ? session
      : { ...session, observedCanonicalDocument: master.document };
    return { status: 'conflict', session: nextSession };
  }

  if (areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document)) {
    return { status: 'current', session };
  }

  const localBufferIsDirty = !areDocumentsStructurallyEqual(
    session.baseDocument,
    bufferDocument,
  );
  if (localBufferIsDirty) {
    return {
      status: 'conflict',
      session: {
        ...session,
        observedCanonicalDocument: master.document,
        conflicted: true,
      },
    };
  }

  return {
    status: 'reload-buffer',
    session: createComponentCanvasSyncSession(master),
    canonicalDocument: master.document,
  };
}

/** Builds the reserved, local-only Component Canvas project used when opening/rebasing a master. */
export function createComponentCanvasBufferProject(master: ComponentDefinition): FolioProject {
  const editorProject = createInitialProject(master.name);
  editorProject.metadata.id = 'folio-component-canvas';
  editorProject.metadata.name = master.name;
  editorProject.pages[0].name = master.name;
  editorProject.pages[0].route = '/';
  editorProject.pages[0].document = {
    ...master.document,
    name: master.name,
    nodes: master.document.nodes.map((node) => ({ ...node })),
  };
  return editorProject;
}

/**
 * Builds a canonical legacy update only for local edits based on the current master.
 * A conflicted or stale session can never write its old buffer over a newer canonical version.
 */
export function createComponentCanvasSyncAction(
  master: ComponentDefinition | undefined,
  editedDocument: FolioDocument,
  session?: ComponentCanvasSyncSession,
): Extract<EditorAction, { type: 'update-component' }> | null {
  if (!master || areDocumentsStructurallyEqual(master.document, editedDocument)) return null;
  if (session && (
    session.componentId !== master.id ||
    session.conflicted ||
    !areDocumentsStructurallyEqual(session.baseDocument, master.document) ||
    !areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document)
  )) return null;

  return {
    type: 'update-component',
    component: {
      ...master,
      document: editedDocument,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Advances the buffer baseline only after the canonical reducer transition was accepted. */
export function advanceComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  committedMaster: ComponentDefinition,
): ComponentCanvasSyncSession {
  return {
    componentId: committedMaster.id,
    baseDocument: committedMaster.document,
    observedCanonicalDocument: committedMaster.document,
    conflicted: false,
  };
}

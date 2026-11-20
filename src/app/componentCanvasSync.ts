import { createInitialProject } from '../core/document/factory';
import { areDocumentsStructurallyEqual } from '../core/document/equality';
import type { ComponentDefinition, FolioDocument, FolioProject } from '../core/document/types';
import type { EditorAction } from './editorReducer';

export type ComponentCanvasMasterStatus = 'present' | 'missing' | 'returned';
export interface ComponentCanvasSyncSession {
  readonly componentId: string;
  readonly baseDocument: FolioDocument;
  readonly baseUpdatedAt: string;
  readonly observedCanonicalDocument: FolioDocument;
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

export function createComponentCanvasSyncSession(master: ComponentDefinition): ComponentCanvasSyncSession {
  return {
    componentId: master.id, baseDocument: master.document, baseUpdatedAt: master.updatedAt,
    observedCanonicalDocument: master.document, conflicted: false, masterStatus: 'present',
  };
}

export function markComponentCanvasMasterMissing(session: ComponentCanvasSyncSession): ComponentCanvasSyncSession {
  return { ...session, masterStatus: 'missing' };
}

/** A master disappearing from history never clears the local buffer; a returning ID needs explicit recovery. */
export function reconcileComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  master: ComponentDefinition,
  bufferDocument: FolioDocument,
): ComponentCanvasReconciliation {
  if (session.masterStatus === 'missing') {
    return { status: 'orphaned-master-returned', session: { ...session, masterStatus: 'returned', observedCanonicalDocument: master.document } };
  }
  if (session.masterStatus === 'returned') return { status: 'orphaned', session };
  if (session.componentId !== master.id) return { status: 'master-mismatch', session };
  if (session.conflicted) {
    const next = areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document)
      ? session : { ...session, observedCanonicalDocument: master.document };
    return { status: 'conflict', session: next };
  }
  const changed = session.baseUpdatedAt !== master.updatedAt ||
    !areDocumentsStructurallyEqual(session.observedCanonicalDocument, master.document);
  if (!changed) return { status: 'current', session };
  if (!areDocumentsStructurallyEqual(session.baseDocument, bufferDocument)) {
    return { status: 'conflict', session: { ...session, observedCanonicalDocument: master.document, conflicted: true } };
  }
  return { status: 'reload-buffer', session: createComponentCanvasSyncSession(master), canonicalDocument: master.document };
}

export function createComponentCanvasBufferProject(master: ComponentDefinition): FolioProject {
  const project = createInitialProject(master.name);
  project.metadata.id = 'folio-component-canvas';
  project.metadata.name = master.name;
  project.pages[0].name = master.name;
  project.pages[0].route = '/';
  project.pages[0].document = { ...master.document, name: master.name, nodes: master.document.nodes.map((node) => ({ ...node })) };
  return project;
}

/** Creates an atomic compare-and-swap action rather than a stale full ComponentDefinition replacement. */
export function createComponentCanvasSyncAction(
  master: ComponentDefinition | undefined,
  editedDocument: FolioDocument,
  session?: ComponentCanvasSyncSession,
): Extract<EditorAction, { type: 'sync-component-document' }> | null {
  if (!master || areDocumentsStructurallyEqual(master.document, editedDocument)) return null;
  if (session && (
    session.componentId !== master.id || session.conflicted || session.masterStatus !== 'present' ||
    session.baseDocument !== master.document || session.baseUpdatedAt !== master.updatedAt
  )) return null;
  return {
    type: 'sync-component-document', componentId: master.id,
    expectedMasterDocument: session?.baseDocument ?? master.document,
    expectedUpdatedAt: session?.baseUpdatedAt ?? master.updatedAt,
    document: editedDocument, updatedAt: new Date().toISOString(),
  };
}

export function advanceComponentCanvasSyncSession(
  session: ComponentCanvasSyncSession,
  committedMaster: ComponentDefinition,
): ComponentCanvasSyncSession {
  if (session.componentId !== committedMaster.id) {
    return { ...session, observedCanonicalDocument: committedMaster.document, conflicted: true };
  }
  return {
    componentId: committedMaster.id,
    baseDocument: committedMaster.document,
    baseUpdatedAt: committedMaster.updatedAt,
    observedCanonicalDocument: committedMaster.document,
    conflicted: false,
    masterStatus: 'present',
  };
}

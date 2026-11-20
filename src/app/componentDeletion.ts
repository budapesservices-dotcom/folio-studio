import type { ComponentDefinition, FolioDocument } from '../core/document/types';
import { shouldProtectComponentCanvasBuffer, type ComponentCanvasSyncSession } from './componentCanvasSync';
import type { CanonicalEditorStore, CanonicalEditorStoreSnapshot } from './editorStore';

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
  | { status: 'recovery-required'; snapshot: CanonicalEditorStoreSnapshot };

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
): ComponentDeletionRequestResult {
  const snapshot = store.getSnapshot();
  const currentMaster = matchesCurrentMaster(snapshot, target);
  if (!currentMaster) return { status: 'stale-master', snapshot };

  if (protection.activeMaster && requiresRecoveryChoice(currentMaster, protection)) {
    return { status: 'recovery-required', snapshot };
  }
  return deleteComponentIfCurrent(store, target);
}

export function deleteComponentIfCurrent(
  store: CanonicalEditorStore,
  target: ComponentDeletionTarget,
): ComponentDeletionResult {
  const before = store.getSnapshot();
  if (!matchesCurrentMaster(before, target)) return { status: 'stale-master', snapshot: before };

  const transition = store.dispatchLegacyAction({
    type: 'delete-component',
    componentId: target.componentId,
    expectedMasterDocument: target.expectedMasterDocument,
    expectedUpdatedAt: target.expectedUpdatedAt,
  });
  if (transition.status !== 'committed') return { status: 'failed', snapshot: transition.snapshot };

  const stillExists = transition.snapshot.editorState.project.components.some(
    (component) => component.id === target.componentId,
  );
  if (stillExists || transition.snapshot === before) {
    return { status: 'stale-master', snapshot: transition.snapshot };
  }
  return { status: 'deleted', snapshot: transition.snapshot };
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
    \`\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2)}\`;
  return \`\${prefix}-\${randomId}\`;
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
): ComponentRecoveryCopyResult {
  const before = store.getSnapshot();
  const master = matchesCurrentMaster(before, target);
  if (!master) return { status: 'stale-master', snapshot: before };

  try {
    const reservedIds = collectReservedIds(before);
    const componentId = createUniqueId('component-recovered', reservedIds, idFactory);
    const documentId = createUniqueId('document-recovered', reservedIds, idFactory);
    const baseName = \`\${master.name} (Recovered)\`;
    const existingNames = new Set(before.editorState.project.components.map(
      (component) => component.name.trim().toLocaleLowerCase(),
    ));
    let name = baseName;
    let suffix = 2;
    while (existingNames.has(name.toLocaleLowerCase())) {
      name = \`\${baseName} \${suffix}\`;
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
    const transition = store.dispatchLegacyAction({ type: 'add-component', component });
    if (transition.status !== 'committed' ||
        !transition.snapshot.editorState.project.components.some((item) => item.id === componentId)) {
      return { status: 'failed', snapshot: transition.snapshot };
    }
    return {
      status: 'saved',
      component: transition.snapshot.editorState.project.components.find(
        (item) => item.id === componentId,
      )!,
      snapshot: transition.snapshot,
    };
  } catch {
    return { status: 'failed', snapshot: store.getSnapshot() };
  }
}

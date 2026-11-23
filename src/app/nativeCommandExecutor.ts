import { getClippingMaskBaseId, getEffectiveLayerStates } from '../core/document/layers';
import { areDocumentsStructurallyEqual } from '../core/document/equality';
import { freezeImmutableGraph, validateProjectIncremental } from '../core/document/validation';
import { createDocumentAstView, type DocumentAddress, type NativeAstDocumentView, type NativeNodeRef } from '../core/document/ast';
import type { DesignNode, FolioDocument, FolioProject } from '../core/document/types';
import {
  validateNativeCommandEnvelope,
  type ValidationOutcome,
} from '../core/commands/validation';
import type {
  NativeChangeEvent,
  NativeChangeSet,
  NativeChangeSetDraft,
  NativeCommand,
  NativeCommandContext,
  NativeCommandEnvelope,
  NativeCommandResult,
  NativeCommandSource,
  NativeCommandTransactionResult,
  NativeCommandWarning,
} from '../core/commands/types';
import {
  getNativeCommandDefinition,
  type NativeCommandAdapterContext,
  type NativeCommandDefinition,
} from './nativeCommandRegistry';
import {
  getSnapshotWorkspace,
  isSnapshotOwnedByStore,
  type CanonicalEditorStore,
  type CanonicalEditorStoreSnapshot,
  type ComponentSyncCommitGuard,
} from './editorStore';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

const EDITOR_HISTORY_LIMIT = 60;

const KNOWN_NATIVE_PERMISSIONS = new Set([
  'project.read',
  'project.rename',
  'project.replace',
  'page.create',
  'page.switch',
  'document.read',
  'node.create',
  'node.update',
  'node.transform',
  'node.reorder',
  'node.delete',
  'component.read',
  'component.create',
  'component.update',
  'component.delete',
  'tokens.update',
  'code.update',
  'logic.update',
  'animation.update',
  'selection.update',
  'history.execute',
]);

interface PreparedNativeCommandDetails {
  readonly baseSnapshot: CanonicalEditorStoreSnapshot;
  readonly command: NativeCommand;
  readonly projectId: string;
  readonly baseProjectRevision: number;
  readonly candidateState: EditorState;
  readonly changeDraft: NativeChangeSetDraft;
  readonly affectedNodes: NativeNodeRef[];
  readonly warnings: NativeCommandWarning[];
  readonly mutatesProject: boolean;
  readonly allowProjectIdChange: boolean;
  readonly componentSyncGuard?: ComponentSyncCommitGuard;
}

interface AuthenticatedCommitAuthorization {
  readonly baseSnapshot: object;
  readonly candidateState: object;
  readonly changeDraft: NativeChangeSetDraft;
  readonly changeSource: NativeCommandSource;
  readonly allowNonProjectMutation?: boolean;
  readonly allowProjectIdChange?: boolean;
  readonly componentSyncGuard?: ComponentSyncCommitGuard;
}

const preparedNativeOperations = new WeakMap<object, PreparedNativeCommandDetails>();
const authenticatedCommitTokens = new WeakMap<object, AuthenticatedCommitAuthorization>();

/** Only preparations or transactions minted by this executor can authorize event publication. */
export function getNativeCommandCommitAuthorization(preparation: object): AuthenticatedCommitAuthorization | undefined {
  const token = authenticatedCommitTokens.get(preparation);
  if (token) return token;
  const details = preparedNativeOperations.get(preparation);
  if (!details) return undefined;
  return {
    baseSnapshot: details.baseSnapshot as object,
    candidateState: details.candidateState as object,
    changeDraft: details.changeDraft,
    changeSource: details.command.source,
    allowNonProjectMutation: !details.mutatesProject,
    allowProjectIdChange: details.allowProjectIdChange,
    ...(details.componentSyncGuard ? { componentSyncGuard: details.componentSyncGuard } : {}),
  };
}

function cloneGraph<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneGraph(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneGraph(child);
    }
    return clone as unknown as T;
  }
  return value;
}

function freezeGraph<T>(value: T): T {
  return freezeImmutableGraph(value);
}

export type NativeCommandPreparation =
  | {
      status: 'prepared';
      commandId: string;
      projectId: string;
      baseProjectRevision: number;
      command: NativeCommand;
      candidateState: EditorState;
      changeDraft: NativeChangeSetDraft;
      warnings: NativeCommandWarning[];
    }
  | { status: 'no-op'; result: NativeCommandResult }
  | { status: 'rejected'; result: NativeCommandResult };

export type NativeCommandCommitResult =
  | {
      status: 'applied';
      result: NativeCommandResult;
      committedState: EditorState;
      change: NativeChangeSet;
      event?: NativeChangeEvent;
    }
  | {
      status: 'rejected';
      result: NativeCommandResult;
      currentState: EditorState;
      currentProjectRevision: number;
    };

function addressEquals(left: DocumentAddress, right: DocumentAddress): boolean {
  return left.projectId === right.projectId &&
    left.documentId === right.documentId &&
    left.owner.kind === right.owner.kind &&
    left.owner.id === right.owner.id;
}

function readOwnDataProperty(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function commandHeader(input: unknown): { commandId: string; transactionId?: string } {
  const commandId = readOwnDataProperty(input, 'commandId');
  const transactionId = readOwnDataProperty(input, 'transactionId');
  return {
    commandId: typeof commandId === 'string' ? commandId : '',
    ...(typeof transactionId === 'string' ? { transactionId } : {}),
  };
}

function createResult(
  snapshot: CanonicalEditorStoreSnapshot,
  header: { commandId: string; transactionId?: string },
  status: NativeCommandResult['status'],
  code: string,
  message: string,
  affectedDocuments: DocumentAddress[] = [],
  affectedNodes: NativeNodeRef[] = [],
): NativeCommandResult {
  const projectId = snapshot.editorState.project.metadata.id;
  return {
    protocolVersion: 1,
    commandId: header.commandId,
    ...(header.transactionId ? { transactionId: header.transactionId } : {}),
    status,
    code,
    message,
    projectId,
    projectRevisionBefore: snapshot.projectRevision,
    projectRevisionAfter: snapshot.projectRevision,
    changed: false,
    affectedDocuments,
    affectedNodes,
    warnings: [],
  };
}

function noOpPreparation(
  snapshot: CanonicalEditorStoreSnapshot,
  command: NativeCommand,
  affectedDocuments: DocumentAddress[],
  affectedNodes: NativeNodeRef[],
  message = 'The requested state is already up to date.',
): { status: 'no-op'; result: NativeCommandResult } {
  return {
    status: 'no-op',
    result: createResult(
      snapshot,
      command,
      'no-op',
      'NO_OP',
      message,
      affectedDocuments,
      affectedNodes,
    ),
  };
}

function resolveDocumentAddress(
  snapshot: CanonicalEditorStoreSnapshot,
  address: DocumentAddress,
  context: NativeCommandContext,
): ValidationOutcome<{ address: DocumentAddress; document: FolioDocument; astView: NativeAstDocumentView }> {
  const project = snapshot.editorState.project;
  if (address.projectId !== context.projectId || address.projectId !== project.metadata.id) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: 'The addressed project is not the current workspace project.' };
  }
  if (address.owner.kind !== 'page') {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'Document commands only support active workspace page documents.' };
  }
  const page = project.pages.find((item) => item.id === address.owner.id);
  if (!page) {
    return { ok: false, code: 'TARGET_NOT_FOUND', message: 'The addressed page does not exist in this project.' };
  }
  if (page.document.id !== address.documentId) {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'The document ID does not match the addressed page.' };
  }
  if (project.activePageId !== page.id) {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'The addressed page is inactive; commands cannot fall back to the active page.' };
  }
  const astView = createDocumentAstView(page.document, address);
  return { ok: true, value: { address: astView.address, document: page.document, astView } };
}

type ResolvedCommandTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'document'; address: DocumentAddress; document: FolioDocument; astView: NativeAstDocumentView }
  | { kind: 'node'; address: DocumentAddress; document: FolioDocument; astView: NativeAstDocumentView; targetRef: NativeNodeRef };

function resolveCommandTarget(
  snapshot: CanonicalEditorStoreSnapshot,
  target: NativeCommandEnvelope<string, unknown>['target'],
  context: NativeCommandContext,
): ValidationOutcome<ResolvedCommandTarget> {
  const project = snapshot.editorState.project;
  if (target.kind === 'project') {
    if (target.projectId !== context.projectId || target.projectId !== project.metadata.id) {
      return { ok: false, code: 'PROJECT_NOT_FOUND', message: 'The addressed project is not the current workspace project.' };
    }
    return { ok: true, value: { kind: 'project', projectId: target.projectId } };
  }
  if (target.kind === 'document') {
    const resolved = resolveDocumentAddress(snapshot, target.address, context);
    if (!resolved.ok) return resolved;
    return { ok: true, value: { kind: 'document', ...resolved.value } };
  }
  const resolved = resolveDocumentAddress(snapshot, target.ref.document, context);
  if (!resolved.ok) return resolved;
  return { ok: true, value: { kind: 'node', ...resolved.value, targetRef: target.ref } };
}

function getPayloadNodeRefs(command: NativeCommand): NativeNodeRef[] {
  switch (command.type) {
    case 'project.rename':
    case 'project.replace':
    case 'page.create':
    case 'page.set-active':
    case 'component.create':
    case 'component.sync-document':
    case 'component.rename':
    case 'component.delete':
    case 'component.update-contract':
    case 'tokens.update':
    case 'code.update-modules':
    case 'logic.create-graph':
    case 'logic.update-graph':
    case 'logic.delete-graph':
    case 'animation.create-clip':
    case 'animation.update-clip':
    case 'animation.delete-clip':
    case 'node.create':
    case 'node.replace-many':
    case 'node.split':
    case 'node.update-many':
    case 'node.edit':
    case 'selection.set':
    case 'history.commit-edit':
    case 'history.undo':
    case 'history.redo':
      return [];
    case 'node.replace':
      return command.target.kind === 'node' ? [command.target.ref] : [];
    case 'node.transform':
      return command.payload.nodes.map((item) => item.ref);
    case 'node.set-properties':
    case 'node.delete':
    case 'node.set-canvas-state':
    case 'layer.group':
    case 'layer.ungroup':
      return command.payload.nodes;
    case 'node.rename':
      return command.payload.updates.map((item) => item.ref);
    case 'layer.move':
      return [command.payload.node, command.payload.target];
    case 'layer.move-many':
      return [...command.payload.nodes, command.payload.target];
    case 'layer.create-clipping-mask':
    case 'layer.remove-clipping-mask':
      return [command.payload.node];
  }
}

function getLockCheckedNodeIds(command: NativeCommand): string[] {
  switch (command.type) {
    case 'project.rename':
    case 'project.replace':
    case 'page.create':
    case 'page.set-active':
    case 'component.create':
    case 'component.sync-document':
    case 'component.rename':
    case 'component.delete':
    case 'component.update-contract':
    case 'tokens.update':
    case 'code.update-modules':
    case 'logic.create-graph':
    case 'logic.update-graph':
    case 'logic.delete-graph':
    case 'animation.create-clip':
    case 'animation.update-clip':
    case 'animation.delete-clip':
    case 'node.create':
    case 'node.set-properties':
    case 'selection.set':
    case 'history.commit-edit':
    case 'history.undo':
    case 'history.redo':
      return [];
    case 'node.replace':
      return command.target.kind === 'node' ? [command.target.ref.nodeId] : [];
    case 'node.replace-many':
      return [...command.payload.removeIds];
    case 'node.split':
      return [command.payload.nodeId];
    case 'node.update-many':
      return command.payload.nodes.map((node) => node.id);
    case 'node.edit':
      return [command.payload.node.id];
    case 'node.transform':
      return command.payload.nodes.map((item) => item.ref.nodeId);
    case 'node.rename':
      return command.payload.updates.map((item) => item.ref.nodeId);
    case 'node.delete':
    case 'node.set-canvas-state':
    case 'layer.group':
    case 'layer.ungroup':
      return command.payload.nodes.map((ref) => ref.nodeId);
    case 'layer.move':
      return command.payload.position === 'inside'
        ? [command.payload.node.nodeId, command.payload.target.nodeId]
        : [command.payload.node.nodeId];
    case 'layer.move-many':
      return command.payload.position === 'inside'
        ? [...command.payload.nodes.map((ref) => ref.nodeId), command.payload.target.nodeId]
        : command.payload.nodes.map((ref) => ref.nodeId);
    case 'layer.create-clipping-mask':
    case 'layer.remove-clipping-mask':
      return [command.payload.node.nodeId];
  }
}

function buildActions(
  command: NativeCommand,
  definition: NativeCommandDefinition,
  context: NativeCommandAdapterContext,
): readonly EditorAction[] {
  return definition.toEditorActions(command, context);
}

function computeDocumentNodeDiff(
  beforeDocument: FolioDocument,
  afterDocument: FolioDocument,
): { added: string[]; updated: string[]; removed: string[] } {
  if (beforeDocument === afterDocument || beforeDocument.nodes === afterDocument.nodes) {
    return { added: [], updated: [], removed: [] };
  }

  const beforeById = new Map<string, { node: DesignNode; index: number }>();
  for (let index = 0; index < beforeDocument.nodes.length; index += 1) {
    const node = beforeDocument.nodes[index];
    beforeById.set(node.id, { node, index });
  }

  const afterById = new Map<string, { node: DesignNode; index: number }>();
  for (let index = 0; index < afterDocument.nodes.length; index += 1) {
    const node = afterDocument.nodes[index];
    afterById.set(node.id, { node, index });
  }

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const [id, afterEntry] of afterById) {
    const beforeEntry = beforeById.get(id);
    if (!beforeEntry) {
      added.push(id);
    } else if (beforeEntry.index !== afterEntry.index) {
      updated.push(id);
    } else if (
      beforeEntry.node !== afterEntry.node &&
      JSON.stringify(beforeEntry.node) !== JSON.stringify(afterEntry.node)
    ) {
      updated.push(id);
    }
  }

  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) {
      removed.push(id);
    }
  }

  return { added, updated, removed };
}

function computeProjectChangeDraft(
  beforeProject: FolioProject,
  afterProject: FolioProject,
  commandIds: string[],
  transactionId?: string,
  primaryTargetAddress?: DocumentAddress,
): { changeDraft: NativeChangeSetDraft; affectedNodes: NativeNodeRef[] } {
  const projectId = afterProject.metadata.id;
  if (beforeProject === afterProject) {
    const documents: NativeChangeSetDraft['documents'] = primaryTargetAddress
      ? [{ address: primaryTargetAddress, nodeIds: { added: [], updated: [], removed: [] } }]
      : [];
    return {
      changeDraft: {
        projectId,
        ...(transactionId ? { transactionId } : {}),
        commandIds,
        documents,
        components: [],
        projectMetadataChanged: false,
      },
      affectedNodes: [],
    };
  }

  const documents: NativeChangeSetDraft['documents'] = [];
  const affectedNodes: NativeNodeRef[] = [];

  const beforePagesById = new Map(beforeProject.pages.map((page) => [page.id, page]));
  const afterPagesById = new Map(afterProject.pages.map((page) => [page.id, page]));
  const seenDocumentKeys = new Set<string>();

  for (const afterPage of afterProject.pages) {
    const beforePage = beforePagesById.get(afterPage.id);
    const address: DocumentAddress = {
      projectId,
      owner: { kind: 'page', id: afterPage.id },
      documentId: afterPage.document.id,
    };
    const isPrimary = primaryTargetAddress !== undefined && addressEquals(primaryTargetAddress, address);
    if (beforePage === afterPage && !isPrimary) {
      continue;
    }

    const diff = beforePage
      ? computeDocumentNodeDiff(beforePage.document, afterPage.document)
      : { added: afterPage.document.nodes.map((node) => node.id), updated: [], removed: [] };

    const hasChanges = diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0 || !beforePage;
    if (hasChanges || isPrimary) {
      const key = `${address.owner.id}:${address.documentId}`;
      seenDocumentKeys.add(key);
      documents.push({ address, nodeIds: diff });
      const affectedIds = [...new Set([...diff.added, ...diff.updated, ...diff.removed])];
      for (const nodeId of affectedIds) {
        affectedNodes.push({ document: address, nodeId });
      }
    }
  }

  for (const beforePage of beforeProject.pages) {
    if (!afterPagesById.has(beforePage.id)) {
      const address: DocumentAddress = {
        projectId: beforeProject.metadata.id,
        owner: { kind: 'page', id: beforePage.id },
        documentId: beforePage.document.id,
      };
      const key = `${address.owner.id}:${address.documentId}`;
      if (!seenDocumentKeys.has(key)) {
        const removed = beforePage.document.nodes.map((node) => node.id);
        documents.push({ address, nodeIds: { added: [], updated: [], removed } });
        for (const nodeId of removed) {
          affectedNodes.push({ document: address, nodeId });
        }
      }
    }
  }

  const components: NativeChangeSetDraft['components'] = [];
  if (beforeProject.components !== afterProject.components) {
    const beforeComponentsById = new Map(beforeProject.components.map((component) => [component.id, component]));
    const afterComponentsById = new Map(afterProject.components.map((component) => [component.id, component]));

    for (const afterComponent of afterProject.components) {
      const beforeComponent = beforeComponentsById.get(afterComponent.id);
      if (!beforeComponent) {
        components.push({
          componentId: afterComponent.id,
          metadataChanged: true,
          documentContentChanged: true,
        });
      } else if (beforeComponent !== afterComponent) {
        const metadataChanged =
          beforeComponent.name !== afterComponent.name ||
          (beforeComponent.variants !== afterComponent.variants &&
            JSON.stringify(beforeComponent.variants ?? []) !== JSON.stringify(afterComponent.variants ?? [])) ||
          (beforeComponent.slots !== afterComponent.slots &&
            JSON.stringify(beforeComponent.slots ?? []) !== JSON.stringify(afterComponent.slots ?? []));
        const documentContentChanged =
          beforeComponent.document !== afterComponent.document &&
          !areDocumentsStructurallyEqual(beforeComponent.document, afterComponent.document);
        if (metadataChanged || documentContentChanged) {
          components.push({
            componentId: afterComponent.id,
            metadataChanged,
            documentContentChanged,
          });
        }
      }
    }

    for (const beforeComponent of beforeProject.components) {
      if (!afterComponentsById.has(beforeComponent.id)) {
        components.push({
          componentId: beforeComponent.id,
          metadataChanged: true,
          documentContentChanged: true,
        });
      }
    }
  }

  const projectMetadataChanged =
    beforeProject.metadata.id !== afterProject.metadata.id ||
    beforeProject.metadata.name !== afterProject.metadata.name ||
    beforeProject.activePageId !== afterProject.activePageId ||
    beforeProject.pages.length !== afterProject.pages.length ||
    beforeProject.pages.some((page, idx) => afterProject.pages[idx]?.id !== page.id) ||
    (beforeProject.designTokens !== afterProject.designTokens &&
      JSON.stringify(beforeProject.designTokens ?? null) !== JSON.stringify(afterProject.designTokens ?? null)) ||
    (beforeProject.codeModules !== afterProject.codeModules &&
      JSON.stringify(beforeProject.codeModules ?? []) !== JSON.stringify(afterProject.codeModules ?? []));

  const changeDraft: NativeChangeSetDraft = {
    projectId,
    ...(transactionId ? { transactionId } : {}),
    commandIds,
    documents,
    components,
    projectMetadataChanged,
  };

  return { changeDraft, affectedNodes };
}

interface InternalCommandStepPreparation {
  readonly command: NativeCommand;
  readonly definition: NativeCommandDefinition;
  readonly candidateState: EditorState;
  readonly changeDraft: NativeChangeSetDraft;
  readonly affectedNodes: NativeNodeRef[];
  readonly targetAddress?: DocumentAddress;
  readonly componentSyncGuard?: ComponentSyncCommitGuard;
  readonly changed: boolean;
}

type InternalCommandStepOutcome =
  | { status: 'prepared'; step: InternalCommandStepPreparation }
  | { status: 'no-op'; result: NativeCommandResult }
  | { status: 'rejected'; result: NativeCommandResult };

function prepareCommandStep(
  snapshot: CanonicalEditorStoreSnapshot,
  input: unknown,
  context: NativeCommandContext,
  expectedWorkspace: 'main' | 'component',
): InternalCommandStepOutcome {
  const header = commandHeader(input);
  const envelopeOutcome = validateNativeCommandEnvelope(input);
  if (!envelopeOutcome.ok) {
    return {
      status: 'rejected',
      result: createResult(snapshot, header, 'rejected', envelopeOutcome.code, envelopeOutcome.message),
    };
  }

  const envelope = envelopeOutcome.value;
  const definition = getNativeCommandDefinition(envelope.type);
  if (!definition) {
    return {
      status: 'rejected',
      result: createResult(snapshot, header, 'rejected', 'UNKNOWN_COMMAND', 'This command type is not supported.'),
    };
  }
  if (envelope.commandVersion !== definition.commandVersion) {
    return {
      status: 'rejected',
      result: createResult(snapshot, header, 'rejected', 'UNSUPPORTED_COMMAND_VERSION', 'This command version is not supported.'),
    };
  }
  if (!definition.allowedTargets.some((target) => target === envelope.target.kind)) {
    return {
      status: 'rejected',
      result: createResult(snapshot, header, 'rejected', 'TARGET_SCOPE_MISMATCH', 'This command does not support the supplied target type.'),
    };
  }

  const payloadOutcome = definition.validatePayload(envelope.payload);
  if (!payloadOutcome.ok) {
    return {
      status: 'rejected',
      result: createResult(snapshot, header, 'rejected', payloadOutcome.code, payloadOutcome.message),
    };
  }

  let command = freezeGraph(cloneGraph({
    ...envelope,
    type: definition.type,
    payload: payloadOutcome.value,
  })) as NativeCommand;

  if (!context || typeof context.projectId !== 'string' || context.projectId.trim().length === 0 ||
      !context.principal || typeof context.principal.id !== 'string' || context.principal.id.trim().length === 0 ||
      !Array.isArray(context.capabilities) ||
      context.capabilities.some((capability) =>
        typeof capability !== 'string' || !KNOWN_NATIVE_PERMISSIONS.has(capability))) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'PERMISSION_DENIED', 'The trusted workspace context is invalid.'),
    };
  }
  if ((context.workspace !== 'main' && context.workspace !== 'component') ||
      context.workspace !== expectedWorkspace ||
      command.source.workspace !== expectedWorkspace ||
      context.principal.kind !== command.source.actor.kind ||
      (command.source.actor.actorId !== undefined && command.source.actor.actorId !== context.principal.id)) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'PERMISSION_DENIED', 'The command source is not authorized for this workspace session.'),
    };
  }
  if (!context.capabilities.includes(definition.requiredPermission)) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'PERMISSION_DENIED', 'The current session does not have permission to perform this command.'),
    };
  }

  // A user may omit actorId in the protocol. Accepted attribution is normalized
  // from the trusted host principal, never from caller-controlled metadata.
  if (command.source.actor.kind === 'user' && command.source.actor.actorId === undefined) {
    command = freezeGraph({
      ...command,
      source: {
        ...command.source,
        actor: { ...command.source.actor, actorId: context.principal.id },
      },
    }) as NativeCommand;
  }

  if (command.preconditions?.expectedProjectRevision !== undefined &&
      command.preconditions.expectedProjectRevision !== snapshot.projectRevision) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'REVISION_CONFLICT', 'The command was prepared against an outdated project revision.'),
    };
  }

  const resolvedTarget = resolveCommandTarget(snapshot, command.target, context);
  if (!resolvedTarget.ok) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', resolvedTarget.code, resolvedTarget.message),
    };
  }

  let resolvedNodes: DesignNode[] = [];
  let targetDocument: FolioDocument | undefined;
  let targetAddress: DocumentAddress | undefined;
  let refs: NativeNodeRef[] = [];
  let liveComponentMasterDocument: FolioDocument | undefined;
  let componentSyncGuard: ComponentSyncCommitGuard | undefined;

  if (resolvedTarget.value.kind !== 'project') {
    const { address, document, astView } = resolvedTarget.value;
    targetDocument = document;
    targetAddress = address;
    refs = getPayloadNodeRefs(command);

    if (refs.some((ref) => !addressEquals(ref.document, address))) {
      return {
        status: 'rejected',
        result: createResult(snapshot, command, 'rejected', 'TARGET_SCOPE_MISMATCH', 'Every node reference must match the command document address.'),
      };
    }

    for (const ref of refs) {
      const node = astView.getNode(ref.nodeId);
      if (!node) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', 'One or more addressed nodes do not exist in this document.'),
        };
      }
      resolvedNodes.push(node);
    }

    if (command.type === 'node.create') {
      for (const created of command.payload.nodes) {
        if (astView.getNode(created.id)) {
          return {
            status: 'rejected',
            result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', `A node with ID "${created.id}" already exists in this document.`),
          };
        }
      }
    }

    if (command.type === 'node.replace' && resolvedTarget.value.kind === 'node') {
      const existing = resolvedNodes[0];
      if (command.payload.node.id !== resolvedTarget.value.targetRef.nodeId) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', 'Node replacement cannot change the target node ID.'),
        };
      }
      if (command.payload.node.type !== existing.type) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_PAYLOAD', 'Node replacement cannot change the target node type.'),
        };
      }
    }

    if (command.type === 'node.split') {
      if (!astView.getNode(command.payload.nodeId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', 'The target node to split does not exist in this document.'),
        };
      }
    }

    if (command.type === 'node.edit') {
      const existing = astView.getNode(command.payload.node.id);
      if (!existing) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', 'The edited node does not exist in this document.'),
        };
      }
      if (existing.type !== command.payload.node.type) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'INVALID_PAYLOAD', 'Coalesced node editing cannot change the node type.'),
        };
      }
    }

    if (command.type === 'node.update-many') {
      for (const updated of command.payload.nodes) {
        const existing = astView.getNode(updated.id);
        if (!existing) {
          return {
            status: 'rejected',
            result: createResult(snapshot, command, 'rejected', 'INVALID_REFERENCE', `Node "${updated.id}" does not exist in this document.`),
          };
        }
        if (existing.type !== updated.type) {
          return {
            status: 'rejected',
            result: createResult(snapshot, command, 'rejected', 'INVALID_PAYLOAD', `Multi-node update cannot change the type of node "${updated.id}".`),
          };
        }
      }
    }

    const lockCheckedIds = getLockCheckedNodeIds(command);
    if (lockCheckedIds.length > 0) {
      const effectiveStates = getEffectiveLayerStates(document.nodes);
      if (lockCheckedIds.some((nodeId) => effectiveStates.get(nodeId)?.locked)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'LOCKED_TARGET', 'A locked layer or one of its locked ancestors cannot be modified.'),
        };
      }
    }

    if (command.type === 'layer.move') {
      const targetId = command.payload.target.nodeId;
      const descendantIds = new Set(astView.getDescendants(command.payload.node.nodeId).map((item) => item.id));
      if (descendantIds.has(targetId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'A layer cannot be moved inside or relative to its own descendant.'),
        };
      }
    }

    if (command.type === 'layer.move-many') {
      const targetId = command.payload.target.nodeId;
      for (const ref of command.payload.nodes) {
        if (ref.nodeId === targetId) {
          return {
            status: 'rejected',
            result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'A moved layer cannot also be the drop target.'),
          };
        }
        const descendantIds = new Set(astView.getDescendants(ref.nodeId).map((item) => item.id));
        if (descendantIds.has(targetId)) {
          return {
            status: 'rejected',
            result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'A layer cannot be moved inside or relative to its own descendant.'),
          };
        }
      }
    }

    if (command.type === 'layer.create-clipping-mask') {
      const nodeId = command.payload.node.nodeId;
      const baseId = getClippingMaskBaseId(document.nodes, nodeId);
      if (!baseId) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'No layer directly below to use as a clipping mask.'),
        };
      }
    }
  } else {
    const project = snapshot.editorState.project;
    if (command.type === 'page.create') {
      if (project.pages.some((page) => page.id === command.payload.page.id || page.route === command.payload.page.route)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'A page with this ID or route already exists.'),
        };
      }
    } else if (command.type === 'page.set-active') {
      if (!project.pages.some((page) => page.id === command.payload.pageId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The requested page does not exist in this project.'),
        };
      }
    } else if (command.type === 'component.create') {
      if (project.components.some((component) => component.id === command.payload.component.id)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', 'A component with this ID already exists.'),
        };
      }
    } else if (
      command.type === 'component.sync-document' ||
      command.type === 'component.rename' ||
      command.type === 'component.delete' ||
      command.type === 'component.update-contract'
    ) {
      const current = project.components.find((component) => component.id === command.payload.componentId);
      if (!current) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target component does not exist in this project.'),
        };
      }
      if (
        current.updatedAt !== command.payload.expectedUpdatedAt ||
        !areDocumentsStructurallyEqual(current.document, command.payload.expectedMasterDocument)
      ) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'COMPONENT_CONFLICT', 'The canonical component changed before this command could be applied.'),
        };
      }
      liveComponentMasterDocument = current.document;
      componentSyncGuard = {
        componentId: current.id,
        expectedMasterDocument: current.document,
        expectedUpdatedAt: current.updatedAt,
      };
    } else if (command.type === 'logic.create-graph') {
      const graph = command.payload.graph;
      if (project.logicGraphs.some((item) => item.id === graph.id)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', `A logic graph with ID "${graph.id}" already exists.`),
        };
      }
      if (graph.scope === 'page' && !project.pages.some((page) => page.id === graph.targetId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target page for this logic graph does not exist.'),
        };
      }
      if (graph.scope === 'component' && !project.components.some((comp) => comp.id === graph.targetId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target component for this logic graph does not exist.'),
        };
      }
    } else if (command.type === 'logic.update-graph') {
      const graph = command.payload.graph;
      if (!project.logicGraphs.some((item) => item.id === graph.id)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', `Logic graph "${graph.id}" does not exist in this project.`),
        };
      }
      if (graph.scope === 'page' && !project.pages.some((page) => page.id === graph.targetId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target page for this logic graph does not exist.'),
        };
      }
      if (graph.scope === 'component' && !project.components.some((comp) => comp.id === graph.targetId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target component for this logic graph does not exist.'),
        };
      }
    } else if (command.type === 'logic.delete-graph') {
      if (!project.logicGraphs.some((item) => item.id === command.payload.graphId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', `Logic graph "${command.payload.graphId}" does not exist in this project.`),
        };
      }
    } else if (command.type === 'animation.create-clip') {
      const clip = command.payload.clip;
      if ((project.animations ?? []).some((item) => item.id === clip.id)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'PRECONDITION_FAILED', `An animation clip with ID "${clip.id}" already exists.`),
        };
      }
      if (!project.pages.some((page) => page.id === clip.pageId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target page for this animation clip does not exist.'),
        };
      }
    } else if (command.type === 'animation.update-clip') {
      const clip = command.payload.clip;
      if (!(project.animations ?? []).some((item) => item.id === clip.id)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', `Animation clip "${clip.id}" does not exist in this project.`),
        };
      }
      if (!project.pages.some((page) => page.id === clip.pageId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', 'The target page for this animation clip does not exist.'),
        };
      }
    } else if (command.type === 'animation.delete-clip') {
      if (!(project.animations ?? []).some((item) => item.id === command.payload.clipId)) {
        return {
          status: 'rejected',
          result: createResult(snapshot, command, 'rejected', 'TARGET_NOT_FOUND', `Animation clip "${command.payload.clipId}" does not exist in this project.`),
        };
      }
    }
  }

  const adapterContext: NativeCommandAdapterContext = {
    document: targetDocument,
    resolvedNodes,
    ...(liveComponentMasterDocument ? { liveComponentMasterDocument } : {}),
  };
  let candidateState = snapshot.editorState;
  try {
    for (const action of buildActions(command, definition, adapterContext)) {
      candidateState = editorReducer(candidateState, action);
    }
  } catch {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'INTERNAL_ERROR', 'The command could not be prepared.'),
    };
  }

  const mutatesProject = definition.mutatesProject !== false;
  if (candidateState === snapshot.editorState || (mutatesProject && candidateState.project === snapshot.editorState.project)) {
    return noOpPreparation(
      snapshot,
      command,
      targetAddress ? [targetAddress] : [],
      refs,
      command.type === 'project.rename'
        ? 'The project name is already up to date.'
        : 'The requested state is already up to date.',
    );
  }

  if (!validateProjectIncremental(snapshot.editorState.project, candidateState.project).ok) {
    return {
      status: 'rejected',
      result: createResult(snapshot, command, 'rejected', 'PROJECT_VALIDATION_FAILED', 'The prepared project violates the current Folio project schema.'),
    };
  }

  const { changeDraft, affectedNodes } = computeProjectChangeDraft(
    snapshot.editorState.project,
    candidateState.project,
    [command.commandId],
    command.transactionId,
    targetAddress,
  );

  return {
    status: 'prepared',
    step: {
      command,
      definition,
      candidateState,
      changeDraft,
      affectedNodes,
      targetAddress,
      componentSyncGuard,
      changed: true,
    },
  };
}

/**
 * Prepare an immutable reducer-compatible candidate. This function never
 * writes to the store and can never return status applied.
 */
export function prepareNativeCommand(
  snapshot: CanonicalEditorStoreSnapshot,
  input: unknown,
  context: NativeCommandContext,
): NativeCommandPreparation {
  const expectedWorkspace = getSnapshotWorkspace(snapshot);
  const outcome = prepareCommandStep(snapshot, input, context, expectedWorkspace);
  if (outcome.status !== 'prepared') return outcome;

  const { step } = outcome;
  const immutableCandidateState = freezeGraph(step.candidateState);
  const immutableChangeDraft = freezeGraph(step.changeDraft);
  const immutableAffectedNodes = freezeGraph(step.affectedNodes);
  const warnings = freezeGraph([] as NativeCommandWarning[]);
  const preparation = freezeGraph({
    status: 'prepared' as const,
    commandId: step.command.commandId,
    projectId: step.changeDraft.projectId,
    baseProjectRevision: snapshot.projectRevision,
    command: step.command,
    candidateState: immutableCandidateState,
    changeDraft: immutableChangeDraft,
    warnings,
  }) as Extract<NativeCommandPreparation, { status: 'prepared' }>;

  const details: PreparedNativeCommandDetails = {
    baseSnapshot: snapshot,
    command: step.command,
    projectId: step.changeDraft.projectId,
    baseProjectRevision: snapshot.projectRevision,
    candidateState: immutableCandidateState,
    changeDraft: immutableChangeDraft,
    affectedNodes: immutableAffectedNodes,
    warnings,
    mutatesProject: step.definition.mutatesProject !== false,
    allowProjectIdChange: step.definition.allowsProjectIdChange === true,
    ...(step.componentSyncGuard ? { componentSyncGuard: step.componentSyncGuard } : {}),
  };
  preparedNativeOperations.set(preparation, details);
  return preparation;
}

function createRejectedCommit(
  snapshot: CanonicalEditorStoreSnapshot,
  command: { commandId: string; transactionId?: string },
  code: string,
  message: string,
): NativeCommandCommitResult {
  return {
    status: 'rejected',
    result: createResult(snapshot, command, 'rejected', code, message),
    currentState: snapshot.editorState,
    currentProjectRevision: snapshot.projectRevision,
  };
}

/** Commit only a preparation minted by the trusted preparation path. */
export function commitPreparedCommand(
  store: CanonicalEditorStore,
  preparation: Extract<NativeCommandPreparation, { status: 'prepared' }>,
  mutationLease?: object,
): NativeCommandCommitResult {
  const details = preparation && typeof preparation === 'object'
    ? preparedNativeOperations.get(preparation as object)
    : undefined;
  if (!details) {
    return createRejectedCommit(
      store.getSnapshot(),
      { commandId: '' },
      'INVALID_PREPARATION',
      'The prepared operation is not an authentic immutable preparation.',
    );
  }

  if (!isSnapshotOwnedByStore(store, details.baseSnapshot)) {
    return createRejectedCommit(store.getSnapshot(), details.command, 'STORE_OWNERSHIP_MISMATCH',
      'The preparation belongs to a different canonical editor store.');
  }

  const nextRevision = details.baseProjectRevision + (details.mutatesProject ? 1 : 0);
  const preparedChange: NativeChangeSet = freezeGraph({ ...details.changeDraft, projectRevision: nextRevision });
  const preparedResult: NativeCommandResult = freezeGraph({
    protocolVersion: 1,
    commandId: details.command.commandId,
    ...(details.command.transactionId ? { transactionId: details.command.transactionId } : {}),
    status: 'applied',
    code: 'APPLIED',
    message: 'The command was committed successfully.',
    projectId: details.projectId,
    projectRevisionBefore: details.baseProjectRevision,
    projectRevisionAfter: nextRevision,
    changed: true,
    affectedDocuments: preparedChange.documents.map((item) => item.address),
    affectedNodes: details.affectedNodes,
    warnings: details.warnings,
  });

  const commit = store.commitEditorTransition({
    expectedProjectRevision: details.baseProjectRevision,
    expectedEditorState: details.baseSnapshot.editorState,
    candidateState: details.candidateState,
    ...(details.componentSyncGuard ? { componentSyncGuard: details.componentSyncGuard } : {}),
    nativeCommandPreparation: preparation,
  }, mutationLease);

  if (commit.status === 'revision-conflict') {
    return createRejectedCommit(commit.snapshot, details.command, 'REVISION_CONFLICT',
      'The project changed after command preparation; no command changes were committed.');
  }
  if (commit.status === 'editor-conflict') {
    return createRejectedCommit(commit.snapshot, details.command, 'EDITOR_STATE_CONFLICT',
      'The editor state changed after command preparation; no command changes were committed.');
  }
  if (commit.status === 'component-conflict') {
    return createRejectedCommit(commit.snapshot, details.command, 'COMPONENT_CONFLICT',
      'The canonical component changed before this command could commit.');
  }
  if (commit.status === 'failed') {
    const code = commit.errorCode === 'PROJECT_VALIDATION_FAILED'
      ? 'PROJECT_VALIDATION_FAILED'
      : commit.errorCode === 'MUTATION_LOCKED'
        ? 'MUTATION_LOCKED'
        : commit.errorCode === 'UNAUTHORIZED_EVENT_PUBLICATION'
          ? 'INVALID_PREPARATION'
          : 'INTERNAL_ERROR';
    const message = commit.errorCode === 'MUTATION_LOCKED'
      ? 'The project is temporarily locked while another durable operation completes.'
      : 'The command could not be committed.';
    return createRejectedCommit(commit.snapshot, details.command, code, message);
  }

  return {
    status: 'applied',
    result: preparedResult,
    committedState: commit.snapshot.editorState,
    change: commit.event ? commit.event.change : preparedChange,
    ...(commit.event ? { event: commit.event } : {}),
  };
}

const completedCommandIds = new WeakMap<object, Set<string>>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let fallbackTransactionSequence = 1;

function createUuid(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  const suffix = (fallbackTransactionSequence++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

function recordCompletedCommandId(store: CanonicalEditorStore, commandId: string): void {
  if (!UUID_PATTERN.test(commandId)) return;
  const seen = completedCommandIds.get(store) ?? new Set<string>();
  seen.add(commandId);
  while (seen.size > 500) seen.delete(seen.values().next().value as string);
  completedCommandIds.set(store, seen);
}

/** Trusted local host entry point: prepare first, then ask the store to commit. */
export function executeNativeCommand(
  store: CanonicalEditorStore,
  input: unknown,
  context: NativeCommandContext,
  mutationLease?: object,
): NativeCommandResult {
  const snapshot = store.getSnapshot();
  const header = commandHeader(input);
  const seen = completedCommandIds.get(store) ?? new Set<string>();
  if (UUID_PATTERN.test(header.commandId) && seen.has(header.commandId)) {
    return createResult(
      snapshot,
      header,
      'rejected',
      'DUPLICATE_COMMAND_ID',
      'This command ID has already been processed in the current editor session.',
    );
  }

  let result: NativeCommandResult;
  try {
    const preparation = prepareNativeCommand(snapshot, input, context);
    if (preparation.status === 'prepared') {
      result = commitPreparedCommand(store, preparation, mutationLease).result;
    } else {
      result = preparation.result;
    }
  } catch {
    // Hostile Proxy traps or unexpected validation/adapter errors are converted to
    // a structured rejection. Preparation is read-only, so no partial state is published.
    result = createResult(
      store.getSnapshot(),
      header,
      'rejected',
      'INVALID_RUNTIME_OBJECT',
      'The command could not be safely inspected or prepared.',
    );
  }

  recordCompletedCommandId(store, header.commandId);
  return result;
}

/**
 * Execute an ordered batch of Native Commands atomically as a single transaction.
 *
 * - Prepares every command sequentially in memory against the evolving candidate state.
 * - If ANY command is rejected, the entire transaction rolls back (zero store mutations,
 *   zero revision bumps, zero emitted NativeChangeEvents).
 * - If applied, commits in ONE store transition with ONE projectRevision increment,
 *   ONE atomic undo history snapshot, and ONE NativeChangeEvent carrying `transactionId`
 *   and all applied `commandIds`.
 */
export function executeNativeCommandTransaction(
  store: CanonicalEditorStore,
  inputs: readonly unknown[],
  context: NativeCommandContext,
  mutationLease?: object,
): NativeCommandTransactionResult {
  const beforeSnapshot = store.getSnapshot();
  const baseProjectId = beforeSnapshot.editorState.project.metadata.id;
  const firstHeader = inputs.length > 0 ? commandHeader(inputs[0]) : { commandId: '' };
  const transactionId = firstHeader.transactionId && firstHeader.transactionId.trim().length > 0
    ? firstHeader.transactionId
    : createUuid();

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return {
      protocolVersion: 1,
      transactionId,
      status: 'rejected',
      code: 'EMPTY_TRANSACTION',
      message: 'A Native Command transaction requires at least one command.',
      projectId: baseProjectId,
      projectRevisionBefore: beforeSnapshot.projectRevision,
      projectRevisionAfter: beforeSnapshot.projectRevision,
      changed: false,
      commandResults: [],
      failedCommandIndex: 0,
      affectedDocuments: [],
      affectedNodes: [],
      warnings: [],
    };
  }

  const seenSessionIds = completedCommandIds.get(store) ?? new Set<string>();
  const batchCommandIds = new Set<string>();
  const commandResults: NativeCommandResult[] = [];
  const appliedSteps: InternalCommandStepPreparation[] = [];

  let workingState = beforeSnapshot.editorState;
  let primarySource: NativeCommandSource | undefined;
  let primaryTargetAddress: DocumentAddress | undefined;
  let resetsHistory = false;
  let allowsProjectIdChange = false;
  let componentSyncGuard: ComponentSyncCommitGuard | undefined;

  for (let index = 0; index < inputs.length; index += 1) {
    const rawInput = inputs[index];
    const header = commandHeader(rawInput);
    if (UUID_PATTERN.test(header.commandId) && (seenSessionIds.has(header.commandId) || batchCommandIds.has(header.commandId))) {
      const duplicate = createResult(
        beforeSnapshot,
        { commandId: header.commandId, transactionId },
        'rejected',
        'DUPLICATE_COMMAND_ID',
        'This command ID has already been processed or duplicated within the transaction.',
      );
      return {
        protocolVersion: 1,
        transactionId,
        status: 'rejected',
        code: duplicate.code,
        message: duplicate.message,
        projectId: baseProjectId,
        projectRevisionBefore: beforeSnapshot.projectRevision,
        projectRevisionAfter: beforeSnapshot.projectRevision,
        changed: false,
        commandResults: [...commandResults, duplicate],
        failedCommandIndex: index,
        affectedDocuments: [],
        affectedNodes: [],
        warnings: [],
      };
    }

    const workingSnapshot: CanonicalEditorStoreSnapshot = {
      editorState: workingState,
      projectRevision: beforeSnapshot.projectRevision,
    };
    const stepContext: NativeCommandContext = {
      ...context,
      projectId: workingState.project.metadata.id,
    };

    let outcome: InternalCommandStepOutcome;
    try {
      outcome = prepareCommandStep(workingSnapshot, rawInput, stepContext, store.workspace);
    } catch {
      const err = createResult(
        beforeSnapshot,
        { commandId: header.commandId, transactionId },
        'rejected',
        'INVALID_RUNTIME_OBJECT',
        'A command in the transaction could not be safely inspected or prepared.',
      );
      return {
        protocolVersion: 1,
        transactionId,
        status: 'rejected',
        code: err.code,
        message: err.message,
        projectId: baseProjectId,
        projectRevisionBefore: beforeSnapshot.projectRevision,
        projectRevisionAfter: beforeSnapshot.projectRevision,
        changed: false,
        commandResults: [...commandResults, err],
        failedCommandIndex: index,
        affectedDocuments: [],
        affectedNodes: [],
        warnings: [],
      };
    }

    if (outcome.status === 'rejected') {
      const rejectedResult: NativeCommandResult = { ...outcome.result, transactionId };
      return {
        protocolVersion: 1,
        transactionId,
        status: 'rejected',
        code: rejectedResult.code,
        message: rejectedResult.message,
        projectId: baseProjectId,
        projectRevisionBefore: beforeSnapshot.projectRevision,
        projectRevisionAfter: beforeSnapshot.projectRevision,
        changed: false,
        commandResults: [...commandResults, rejectedResult],
        failedCommandIndex: index,
        affectedDocuments: [],
        affectedNodes: [],
        warnings: [],
      };
    }

    if (outcome.status === 'no-op') {
      commandResults.push({ ...outcome.result, transactionId });
      if (UUID_PATTERN.test(header.commandId)) batchCommandIds.add(header.commandId);
      continue;
    }

    const { step } = outcome;
    workingState = step.candidateState;
    appliedSteps.push(step);
    if (!primarySource) primarySource = step.command.source;
    if (!primaryTargetAddress && step.targetAddress) primaryTargetAddress = step.targetAddress;
    if (step.definition.resetsHistory) resetsHistory = true;
    if (step.definition.allowsProjectIdChange) allowsProjectIdChange = true;
    if (!componentSyncGuard && step.componentSyncGuard) componentSyncGuard = step.componentSyncGuard;
    batchCommandIds.add(step.command.commandId);
    commandResults.push({
      protocolVersion: 1,
      commandId: step.command.commandId,
      transactionId,
      status: 'applied',
      code: 'APPLIED',
      message: 'Prepared inside transaction.',
      projectId: step.changeDraft.projectId,
      projectRevisionBefore: beforeSnapshot.projectRevision,
      projectRevisionAfter: beforeSnapshot.projectRevision,
      changed: true,
      affectedDocuments: step.changeDraft.documents.map((doc) => doc.address),
      affectedNodes: step.affectedNodes,
      warnings: [],
    });
  }

  if (appliedSteps.length === 0 || workingState === beforeSnapshot.editorState) {
    for (const id of batchCommandIds) recordCompletedCommandId(store, id);
    return {
      protocolVersion: 1,
      transactionId,
      status: 'no-op',
      code: 'NO_OP',
      message: 'All commands in the transaction were no-ops.',
      projectId: baseProjectId,
      projectRevisionBefore: beforeSnapshot.projectRevision,
      projectRevisionAfter: beforeSnapshot.projectRevision,
      changed: false,
      commandResults,
      affectedDocuments: [],
      affectedNodes: [],
      warnings: [],
    };
  }

  const projectMutated = workingState.project !== beforeSnapshot.editorState.project;
  // Collapse intermediate history entries into ONE atomic transaction undo snapshot
  // unless an included command intentionally resets history (page switch / project replace)
  // or directly manipulates history (undo / redo).
  const includesDirectHistoryStep = appliedSteps.some(
    (step) => step.command.type === 'history.undo' || step.command.type === 'history.redo',
  );
  const finalCandidateState: EditorState = freezeGraph(
    projectMutated && !resetsHistory && !includesDirectHistoryStep
      ? {
          ...workingState,
          past: [...beforeSnapshot.editorState.past, beforeSnapshot.editorState.project].slice(-EDITOR_HISTORY_LIMIT),
          future: [],
          historyGroup: null,
        }
      : workingState,
  );

  const appliedCommandIds = appliedSteps.map((step) => step.command.commandId);
  const { changeDraft, affectedNodes } = computeProjectChangeDraft(
    beforeSnapshot.editorState.project,
    finalCandidateState.project,
    appliedCommandIds,
    transactionId,
    primaryTargetAddress,
  );

  const authToken = Object.freeze({});
  authenticatedCommitTokens.set(authToken, {
    baseSnapshot: beforeSnapshot as object,
    candidateState: finalCandidateState as object,
    changeDraft: freezeGraph(changeDraft),
    changeSource: primarySource!,
    allowNonProjectMutation: !projectMutated,
    allowProjectIdChange: allowsProjectIdChange,
    ...(componentSyncGuard ? { componentSyncGuard } : {}),
  });

  const commit = store.commitEditorTransition({
    expectedProjectRevision: beforeSnapshot.projectRevision,
    expectedEditorState: beforeSnapshot.editorState,
    candidateState: finalCandidateState,
    ...(componentSyncGuard ? { componentSyncGuard } : {}),
    nativeCommandPreparation: authToken,
  }, mutationLease);

  if (commit.status !== 'committed') {
    const code = commit.status === 'revision-conflict'
      ? 'REVISION_CONFLICT'
      : commit.status === 'editor-conflict'
        ? 'EDITOR_STATE_CONFLICT'
        : commit.status === 'component-conflict'
          ? 'COMPONENT_CONFLICT'
          : commit.errorCode;
    return {
      protocolVersion: 1,
      transactionId,
      status: 'rejected',
      code,
      message: 'The transaction could not be committed; no changes were applied.',
      projectId: baseProjectId,
      projectRevisionBefore: beforeSnapshot.projectRevision,
      projectRevisionAfter: commit.snapshot.projectRevision,
      changed: false,
      commandResults: commandResults.map((entry) => ({
        ...entry,
        status: 'rejected',
        code,
        changed: false,
        projectRevisionAfter: commit.snapshot.projectRevision,
      })),
      affectedDocuments: [],
      affectedNodes: [],
      warnings: [],
    };
  }

  for (const id of batchCommandIds) recordCompletedCommandId(store, id);

  const finalRevision = commit.snapshot.projectRevision;
  const finalizedCommandResults = commandResults.map((entry) =>
    entry.status === 'applied'
      ? { ...entry, projectRevisionAfter: finalRevision, message: 'Committed as part of transaction.' }
      : { ...entry, projectRevisionAfter: finalRevision },
  );

  return {
    protocolVersion: 1,
    transactionId,
    status: 'applied',
    code: 'APPLIED',
    message: `Transaction committed (${appliedSteps.length} command${appliedSteps.length === 1 ? '' : 's'}).`,
    projectId: commit.snapshot.editorState.project.metadata.id,
    projectRevisionBefore: beforeSnapshot.projectRevision,
    projectRevisionAfter: finalRevision,
    changed: true,
    commandResults: finalizedCommandResults,
    affectedDocuments: changeDraft.documents.map((doc) => doc.address),
    affectedNodes,
    warnings: [],
  };
}

/**
 * Executor-authenticated rollback helper used exclusively by durable persistence
 * barriers (e.g. IndexedDB failure during component deletion/recovery) so even
 * monotonic durability rollbacks flow through the Native Command Engine and emit
 * a complete NativeChangeEvent.
 */
export function executeNativeSnapshotRollback(
  store: CanonicalEditorStore,
  targetState: EditorState,
  mutationLease: object,
  actorId = 'system-durability-rollback',
): CanonicalEditorStoreSnapshot {
  const beforeSnapshot = store.getSnapshot();
  if (beforeSnapshot.editorState === targetState) return beforeSnapshot;

  const rollbackCommandId = createUuid();
  const frozenTarget = freezeGraph(targetState);
  const { changeDraft } = computeProjectChangeDraft(
    beforeSnapshot.editorState.project,
    frozenTarget.project,
    [rollbackCommandId],
  );
  const source: NativeCommandSource = {
    workspace: store.workspace,
    actor: { kind: 'system', actorId },
  };
  const authToken = Object.freeze({});
  authenticatedCommitTokens.set(authToken, {
    baseSnapshot: beforeSnapshot as object,
    candidateState: frozenTarget as object,
    changeDraft: freezeGraph(changeDraft),
    changeSource: source,
    allowProjectIdChange: true,
  });

  const commit = store.commitEditorTransition({
    expectedProjectRevision: beforeSnapshot.projectRevision,
    expectedEditorState: beforeSnapshot.editorState,
    candidateState: frozenTarget,
    nativeCommandPreparation: authToken,
  }, mutationLease);
  return commit.snapshot;
}

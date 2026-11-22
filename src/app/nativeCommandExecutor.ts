import { getClippingMaskBaseId, getEffectiveLayerStates } from '../core/document/layers';
import { validateProject } from '../core/document/validation';
import { createDocumentAstView, type DocumentAddress, type NativeAstDocumentView, type NativeNodeRef } from '../core/document/ast';
import type { DesignNode, FolioDocument } from '../core/document/types';
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
  NativeCommandWarning,
} from '../core/commands/types';
import { NATIVE_COMMAND_REGISTRY, type NativeCommandAdapterContext } from './nativeCommandRegistry';
import { isSnapshotOwnedByStore, type CanonicalEditorStore, type CanonicalEditorStoreSnapshot } from './editorStore';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

const KNOWN_NATIVE_PERMISSIONS = new Set([
  'project.read',
  'project.rename',
  'document.read',
  'node.create',
  'node.update',
  'node.transform',
  'node.reorder',
  'node.delete',
  'component.read',
  'component.update',
  'component.delete',
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
}

const preparedNativeOperations = new WeakMap<object, PreparedNativeCommandDetails>();

/** Only preparations already minted by this executor can authorize event publication. */
export function getNativeCommandCommitAuthorization(preparation: object) {
  const details = preparedNativeOperations.get(preparation);
  if (!details) return undefined;
  return {
    baseSnapshot: details.baseSnapshot as object,
    candidateState: details.candidateState as object,
    changeDraft: details.changeDraft,
    changeSource: details.command.source,
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

function freezeGraph<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) freezeGraph(child, seen);
  return Object.freeze(object) as T;
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
      event: NativeChangeEvent;
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

function rejectedPreparation(
  snapshot: CanonicalEditorStoreSnapshot,
  header: { commandId: string; transactionId?: string },
  code: string,
  message: string,
): NativeCommandPreparation {
  return {
    status: 'rejected',
    result: createResult(snapshot, header, 'rejected', code, message),
  };
}

function noOpPreparation(
  snapshot: CanonicalEditorStoreSnapshot,
  command: NativeCommand,
  affectedDocuments: DocumentAddress[],
  affectedNodes: NativeNodeRef[],
  message = 'The requested state is already up to date.',
): NativeCommandPreparation {
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
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: 'The addressed project is not the current Main Canvas project.' };
  }
  if (address.owner.kind !== 'page') {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'Main Canvas commands only support Main Canvas page documents.' };
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
      return { ok: false, code: 'PROJECT_NOT_FOUND', message: 'The addressed project is not the current Main Canvas project.' };
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
    case 'node.create':
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
    case 'node.create':
    case 'node.set-properties':
      return [];
    case 'node.replace':
      return command.target.kind === 'node' ? [command.target.ref.nodeId] : [];
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
  definition: (typeof NATIVE_COMMAND_REGISTRY)[keyof typeof NATIVE_COMMAND_REGISTRY],
  context: NativeCommandAdapterContext,
): readonly EditorAction[] {
  return definition.toEditorActions(command, context);
}

function computeDocumentNodeDiff(
  beforeDocument: FolioDocument,
  afterDocument: FolioDocument,
): { added: string[]; updated: string[]; removed: string[] } {
  const beforeById = new Map<string, { node: DesignNode; index: number }>();
  beforeDocument.nodes.forEach((node, index) => beforeById.set(node.id, { node, index }));

  const afterById = new Map<string, { node: DesignNode; index: number }>();
  afterDocument.nodes.forEach((node, index) => afterById.set(node.id, { node, index }));

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const [id, afterEntry] of afterById) {
    const beforeEntry = beforeById.get(id);
    if (!beforeEntry) {
      added.push(id);
    } else if (
      beforeEntry.index !== afterEntry.index ||
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

/**
 * Prepare an immutable reducer-compatible candidate. This function never
 * writes to the store and can never return status applied.
 */
export function prepareNativeCommand(
  snapshot: CanonicalEditorStoreSnapshot,
  input: unknown,
  context: NativeCommandContext,
): NativeCommandPreparation {
  const header = commandHeader(input);
  const envelopeOutcome = validateNativeCommandEnvelope(input);
  if (!envelopeOutcome.ok) {
    return rejectedPreparation(snapshot, header, envelopeOutcome.code, envelopeOutcome.message);
  }

  const envelope = envelopeOutcome.value;
  if (!Object.prototype.hasOwnProperty.call(NATIVE_COMMAND_REGISTRY, envelope.type)) {
    return rejectedPreparation(snapshot, header, 'UNKNOWN_COMMAND', 'This command type is not supported.');
  }
  const definition = NATIVE_COMMAND_REGISTRY[envelope.type as keyof typeof NATIVE_COMMAND_REGISTRY];
  if (!definition) {
    return rejectedPreparation(snapshot, header, 'UNKNOWN_COMMAND', 'This command type is not supported.');
  }
  if (envelope.commandVersion !== definition.commandVersion) {
    return rejectedPreparation(snapshot, header, 'UNSUPPORTED_COMMAND_VERSION', 'This command version is not supported.');
  }
  if (!definition.allowedTargets.some((target) => target === envelope.target.kind)) {
    return rejectedPreparation(snapshot, header, 'TARGET_SCOPE_MISMATCH', 'This command does not support the supplied target type.');
  }

  const payloadOutcome = definition.validatePayload(envelope.payload);
  if (!payloadOutcome.ok) {
    return rejectedPreparation(snapshot, header, payloadOutcome.code, payloadOutcome.message);
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
    return rejectedPreparation(snapshot, command, 'PERMISSION_DENIED', 'The trusted Main Canvas context is invalid.');
  }
  if (context.workspace !== 'main' || command.source.workspace !== 'main' ||
      context.principal.kind !== command.source.actor.kind ||
      (command.source.actor.actorId !== undefined && command.source.actor.actorId !== context.principal.id)) {
    return rejectedPreparation(snapshot, command, 'PERMISSION_DENIED', 'The command source is not authorized for this Main Canvas session.');
  }
  if (!context.capabilities.includes(definition.requiredPermission)) {
    return rejectedPreparation(snapshot, command, 'PERMISSION_DENIED', 'The current session does not have permission to perform this command.');
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
    return rejectedPreparation(snapshot, command, 'REVISION_CONFLICT', 'The command was prepared against an outdated project revision.');
  }

  const resolvedTarget = resolveCommandTarget(snapshot, command.target, context);
  if (!resolvedTarget.ok) {
    return rejectedPreparation(snapshot, command, resolvedTarget.code, resolvedTarget.message);
  }

  let resolvedNodes: DesignNode[] = [];
  let targetDocument: FolioDocument | undefined;
  let targetAddress: DocumentAddress | undefined;
  let refs: NativeNodeRef[] = [];

  if (resolvedTarget.value.kind !== 'project') {
    const { address, document, astView } = resolvedTarget.value;
    targetDocument = document;
    targetAddress = address;
    refs = getPayloadNodeRefs(command);

    if (refs.some((ref) => !addressEquals(ref.document, address))) {
      return rejectedPreparation(snapshot, command, 'TARGET_SCOPE_MISMATCH', 'Every node reference must match the command document address.');
    }

    for (const ref of refs) {
      const node = astView.getNode(ref.nodeId);
      if (!node) {
        return rejectedPreparation(snapshot, command, 'INVALID_REFERENCE', 'One or more addressed nodes do not exist in this document.');
      }
      resolvedNodes.push(node);
    }

    if (command.type === 'node.create') {
      for (const created of command.payload.nodes) {
        if (astView.getNode(created.id)) {
          return rejectedPreparation(snapshot, command, 'INVALID_REFERENCE', `A node with ID "${created.id}" already exists in this document.`);
        }
      }
    }

    if (command.type === 'node.replace' && resolvedTarget.value.kind === 'node') {
      const existing = resolvedNodes[0];
      if (command.payload.node.id !== resolvedTarget.value.targetRef.nodeId) {
        return rejectedPreparation(snapshot, command, 'INVALID_REFERENCE', 'Node replacement cannot change the target node ID.');
      }
      if (command.payload.node.type !== existing.type) {
        return rejectedPreparation(snapshot, command, 'INVALID_PAYLOAD', 'Node replacement cannot change the target node type.');
      }
    }

    const lockCheckedIds = getLockCheckedNodeIds(command);
    if (lockCheckedIds.length > 0) {
      const effectiveStates = getEffectiveLayerStates(document.nodes);
      if (lockCheckedIds.some((nodeId) => effectiveStates.get(nodeId)?.locked)) {
        return rejectedPreparation(snapshot, command, 'LOCKED_TARGET', 'A locked layer or one of its locked ancestors cannot be modified.');
      }
    }

    if (command.type === 'layer.move') {
      const targetId = command.payload.target.nodeId;
      const descendantIds = new Set(astView.getDescendants(command.payload.node.nodeId).map((item) => item.id));
      if (descendantIds.has(targetId)) {
        return rejectedPreparation(snapshot, command, 'PRECONDITION_FAILED', 'A layer cannot be moved inside or relative to its own descendant.');
      }
    }

    if (command.type === 'layer.move-many') {
      const targetId = command.payload.target.nodeId;
      for (const ref of command.payload.nodes) {
        if (ref.nodeId === targetId) {
          return rejectedPreparation(snapshot, command, 'PRECONDITION_FAILED', 'A moved layer cannot also be the drop target.');
        }
        const descendantIds = new Set(astView.getDescendants(ref.nodeId).map((item) => item.id));
        if (descendantIds.has(targetId)) {
          return rejectedPreparation(snapshot, command, 'PRECONDITION_FAILED', 'A layer cannot be moved inside or relative to its own descendant.');
        }
      }
    }

    if (command.type === 'layer.create-clipping-mask') {
      const nodeId = command.payload.node.nodeId;
      const baseId = getClippingMaskBaseId(document.nodes, nodeId);
      if (!baseId) {
        return rejectedPreparation(snapshot, command, 'PRECONDITION_FAILED', 'No layer directly below to use as a clipping mask.');
      }
    }
  }

  const adapterContext: NativeCommandAdapterContext = { document: targetDocument, resolvedNodes };
  let candidateState = snapshot.editorState;
  try {
    for (const action of buildActions(command, definition, adapterContext)) {
      candidateState = editorReducer(candidateState, action);
    }
  } catch {
    return rejectedPreparation(snapshot, command, 'INTERNAL_ERROR', 'The command could not be prepared.');
  }

  if (candidateState === snapshot.editorState ||
      candidateState.project === snapshot.editorState.project) {
    return noOpPreparation(
      snapshot,
      command,
      targetAddress ? [targetAddress] : [],
      refs,
      command.type === 'project.rename'
        ? 'The project name is already up to date.'
        : 'The requested node state is already up to date.',
    );
  }
  if (!validateProject(candidateState.project).ok) {
    return rejectedPreparation(snapshot, command, 'PROJECT_VALIDATION_FAILED', 'The prepared project violates the current Folio project schema.');
  }

  let changeDocuments: NativeChangeSetDraft['documents'] = [];
  let affectedNodes: NativeNodeRef[] = [];
  const projectMetadataChanged = command.type === 'project.rename';

  if (targetAddress && targetDocument) {
    const candidateDocument = candidateState.project.pages.find((page) => page.id === targetAddress.owner.id)?.document;
    const diff = candidateDocument
      ? computeDocumentNodeDiff(targetDocument, candidateDocument)
      : { added: [], updated: [], removed: [] };

    changeDocuments = [{
      address: targetAddress,
      nodeIds: diff,
    }];

    const affectedNodeIds = [...new Set([...diff.added, ...diff.updated, ...diff.removed])];
    affectedNodes = affectedNodeIds.map((nodeId) => ({ document: targetAddress, nodeId }));
  }

  const changeDraft: NativeChangeSetDraft = {
    projectId: snapshot.editorState.project.metadata.id,
    ...(command.transactionId ? { transactionId: command.transactionId } : {}),
    commandIds: [command.commandId],
    documents: changeDocuments,
    components: [],
    projectMetadataChanged,
  };

  const immutableCandidateState = freezeGraph(candidateState);
  const immutableChangeDraft = freezeGraph(changeDraft);
  const immutableAffectedNodes = freezeGraph(affectedNodes);
  const warnings = freezeGraph([] as NativeCommandWarning[]);
  const preparation = freezeGraph({
    status: 'prepared' as const,
    commandId: command.commandId,
    projectId: changeDraft.projectId,
    baseProjectRevision: snapshot.projectRevision,
    command,
    candidateState: immutableCandidateState,
    changeDraft: immutableChangeDraft,
    warnings,
  }) as Extract<NativeCommandPreparation, { status: 'prepared' }>;

  const details: PreparedNativeCommandDetails = {
    baseSnapshot: snapshot,
    command,
    projectId: changeDraft.projectId,
    baseProjectRevision: snapshot.projectRevision,
    candidateState: immutableCandidateState,
    changeDraft: immutableChangeDraft,
    affectedNodes: immutableAffectedNodes,
    warnings,
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
  const preparedChange: NativeChangeSet = freezeGraph({ ...details.changeDraft, projectRevision: details.baseProjectRevision + 1 });
  const preparedResult: NativeCommandResult = freezeGraph({
    protocolVersion: 1,
    commandId: details.command.commandId,
    ...(details.command.transactionId ? { transactionId: details.command.transactionId } : {}),
    status: 'applied',
    code: 'APPLIED',
    message: 'The command was committed successfully.',
    projectId: details.projectId,
    projectRevisionBefore: details.baseProjectRevision,
    projectRevisionAfter: details.baseProjectRevision + 1,
    changed: true,
    affectedDocuments: preparedChange.documents.map((item) => item.address),
    affectedNodes: details.affectedNodes,
    warnings: details.warnings,
  });
  const commit = store.commitEditorTransition({
    expectedProjectRevision: details.baseProjectRevision,
    expectedEditorState: details.baseSnapshot.editorState,
    candidateState: details.candidateState,
    nativeCommandPreparation: preparation,
  });

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

  const event = commit.event as NativeChangeEvent;
  return {
    status: 'applied',
    result: preparedResult,
    committedState: commit.snapshot.editorState,
    change: event.change,
    event,
  };
}

const completedCommandIds = new WeakMap<object, Set<string>>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Trusted local host entry point: prepare first, then ask the store to commit. */
export function executeNativeCommand(
  store: CanonicalEditorStore,
  input: unknown,
  context: NativeCommandContext,
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
      result = commitPreparedCommand(store, preparation).result;
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

  if (UUID_PATTERN.test(header.commandId)) {
    seen.add(header.commandId);
    while (seen.size > 500) seen.delete(seen.values().next().value as string);
    completedCommandIds.set(store, seen);
  }
  return result;
}

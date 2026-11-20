import { getEffectiveLayerStates } from '../core/document/layers';
import { validateProject } from '../core/document/validation';
import type { DocumentAddress, NativeNodeRef } from '../core/document/ast';
import type { DesignNode, FolioDocument } from '../core/document/types';
import {
  validateNativeCommandEnvelope,
  isRecord,
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
  NodeSetPropertiesCommand,
  NodeTransformCommand,
} from '../core/commands/types';
import { NATIVE_COMMAND_REGISTRY, type NativeCommandAdapterContext } from './nativeCommandRegistry';
import type { CanonicalEditorStore, CanonicalEditorStoreSnapshot } from './editorStore';
import { editorReducer, type EditorAction, type EditorState } from './editorReducer';

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

function commandHeader(input: unknown): { commandId: string; transactionId?: string } {
  if (!isRecord(input)) return { commandId: '' };
  return {
    commandId: typeof input.commandId === 'string' ? input.commandId : '',
    ...(typeof input.transactionId === 'string' ? { transactionId: input.transactionId } : {}),
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
  address: DocumentAddress,
  refs: NativeNodeRef[],
): NativeCommandPreparation {
  return {
    status: 'no-op',
    result: createResult(
      snapshot,
      command,
      'no-op',
      'NO_OP',
      'The requested node state is already up to date.',
      [address],
      refs,
    ),
  };
}

function resolveTargetDocument(
  snapshot: CanonicalEditorStoreSnapshot,
  target: NativeCommandEnvelope<string, unknown>['target'],
  context: NativeCommandContext,
): ValidationOutcome<{ address: DocumentAddress; document: FolioDocument }> {
  if (target.kind !== 'document') {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'This command requires an explicitly addressed document.' };
  }
  const address = target.address;
  const project = snapshot.editorState.project;
  if (address.projectId !== context.projectId || address.projectId !== project.metadata.id) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: 'The addressed project is not the current Main Canvas project.' };
  }
  if (address.owner.kind !== 'page') {
    return { ok: false, code: 'TARGET_SCOPE_MISMATCH', message: 'Phase 1 commands only support Main Canvas page documents.' };
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
  return { ok: true, value: { address, document: page.document } };
}

function buildAffectedRefs(command: NativeCommand): NativeNodeRef[] {
  return command.payload.nodes.map((item) => 'ref' in item ? item.ref : item);
}

function buildActions(
  command: NativeCommand,
  definition: (typeof NATIVE_COMMAND_REGISTRY)[keyof typeof NATIVE_COMMAND_REGISTRY],
  context: NativeCommandAdapterContext,
): readonly EditorAction[] {
  return definition.toEditorActions(command, context);
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
  const definition = NATIVE_COMMAND_REGISTRY[envelope.type as keyof typeof NATIVE_COMMAND_REGISTRY];
  if (!definition) {
    return rejectedPreparation(snapshot, header, 'UNKNOWN_COMMAND', 'This command type is not supported.');
  }
  if (envelope.commandVersion !== definition.commandVersion) {
    return rejectedPreparation(snapshot, header, 'UNSUPPORTED_COMMAND_VERSION', 'This command version is not supported.');
  }
  if (!definition.allowedTargets.includes(envelope.target.kind)) {
    return rejectedPreparation(snapshot, header, 'TARGET_SCOPE_MISMATCH', 'This command does not support the supplied target type.');
  }

  let command: NativeCommand;
  if (envelope.type === 'node.transform') {
    const payload = definition.validatePayload(envelope.payload);
    if (!payload.ok) return rejectedPreparation(snapshot, header, payload.code, payload.message);
    command = { ...envelope, type: 'node.transform', payload: payload.value as NodeTransformCommand['payload'] };
  } else if (envelope.type === 'node.set-properties') {
    const payload = definition.validatePayload(envelope.payload);
    if (!payload.ok) return rejectedPreparation(snapshot, header, payload.code, payload.message);
    command = { ...envelope, type: 'node.set-properties', payload: payload.value as NodeSetPropertiesCommand['payload'] };
  } else {
    return rejectedPreparation(snapshot, header, 'UNKNOWN_COMMAND', 'This command type is not supported.');
  }

  if (context.workspace !== 'main' || command.source.workspace !== 'main' ||
      context.principal.kind !== command.source.actor.kind ||
      (command.source.actor.actorId !== undefined && command.source.actor.actorId !== context.principal.id)) {
    return rejectedPreparation(snapshot, command, 'PERMISSION_DENIED', 'The command source is not authorized for this Main Canvas session.');
  }
  if (!context.capabilities.includes(definition.requiredPermission)) {
    return rejectedPreparation(snapshot, command, 'PERMISSION_DENIED', 'The current session does not have permission to perform this command.');
  }

  if (command.preconditions?.expectedProjectRevision !== undefined &&
      command.preconditions.expectedProjectRevision !== snapshot.projectRevision) {
    return rejectedPreparation(snapshot, command, 'REVISION_CONFLICT', 'The command was prepared against an outdated project revision.');
  }

  const resolved = resolveTargetDocument(snapshot, command.target, context);
  if (!resolved.ok) return rejectedPreparation(snapshot, command, resolved.code, resolved.message);
  const { address, document } = resolved.value;
  const refs = buildAffectedRefs(command);
  if (refs.some((ref) => !addressEquals(ref.document, address))) {
    return rejectedPreparation(snapshot, command, 'TARGET_SCOPE_MISMATCH', 'Every node reference must match the command document address.');
  }

  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const resolvedNodes: DesignNode[] = [];
  for (const ref of refs) {
    const node = nodeById.get(ref.nodeId);
    if (!node) {
      return rejectedPreparation(snapshot, command, 'INVALID_REFERENCE', 'One or more addressed nodes do not exist in this document.');
    }
    resolvedNodes.push(node);
  }

  if (command.type === 'node.transform') {
    const effectiveStates = getEffectiveLayerStates(document.nodes);
    if (resolvedNodes.some((node) => effectiveStates.get(node.id)?.locked)) {
      return rejectedPreparation(snapshot, command, 'LOCKED_TARGET', 'A locked layer or one of its locked ancestors cannot be transformed.');
    }
  }

  const adapterContext: NativeCommandAdapterContext = { document, resolvedNodes };
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
    return noOpPreparation(snapshot, command, address, refs);
  }
  if (!validateProject(candidateState.project).ok) {
    return rejectedPreparation(snapshot, command, 'PROJECT_VALIDATION_FAILED', 'The prepared project violates the current Folio project schema.');
  }

  const changeDraft: NativeChangeSetDraft = {
    projectId: snapshot.editorState.project.metadata.id,
    ...(command.transactionId ? { transactionId: command.transactionId } : {}),
    commandIds: [command.commandId],
    documents: [{
      address,
      nodeIds: { added: [], updated: refs.map((ref) => ref.nodeId), removed: [] },
    }],
    components: [],
    projectMetadataChanged: false,
  };

  return {
    status: 'prepared',
    commandId: command.commandId,
    projectId: changeDraft.projectId,
    baseProjectRevision: snapshot.projectRevision,
    command,
    candidateState,
    changeDraft,
    warnings: [],
  };
}

function createRejectedCommit(
  snapshot: CanonicalEditorStoreSnapshot,
  command: NativeCommand,
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

/** Commit a prepared candidate through the one canonical store boundary. */
export function commitPreparedCommand(
  store: CanonicalEditorStore,
  preparation: Extract<NativeCommandPreparation, { status: 'prepared' }>,
): NativeCommandCommitResult {
  const commit = store.commitEditorTransition({
    expectedProjectRevision: preparation.baseProjectRevision,
    candidateState: preparation.candidateState,
  });

  if (commit.status === 'revision-conflict') {
    return createRejectedCommit(
      commit.snapshot,
      preparation.command,
      'REVISION_CONFLICT',
      'The project changed after command preparation; no command changes were committed.',
    );
  }
  if (commit.status === 'failed') {
    const code = commit.errorCode === 'PROJECT_VALIDATION_FAILED'
      ? 'PROJECT_VALIDATION_FAILED'
      : 'INTERNAL_ERROR';
    return createRejectedCommit(commit.snapshot, preparation.command, code, 'The command could not be committed.');
  }
  if (commit.status === 'no-op') {
    return createRejectedCommit(commit.snapshot, preparation.command, 'REVISION_CONFLICT', 'The prepared candidate was not committed.');
  }

  const currentRevision = commit.snapshot.projectRevision;
  if (currentRevision !== preparation.baseProjectRevision + 1) {
    return createRejectedCommit(commit.snapshot, preparation.command, 'INTERNAL_ERROR', 'The project revision did not advance as part of the command commit.');
  }

  const change: NativeChangeSet = {
    ...preparation.changeDraft,
    projectRevision: currentRevision,
  };
  const event: NativeChangeEvent = {
    eventId: preparation.command.commandId + ':change',
    projectId: preparation.projectId,
    projectRevision: currentRevision,
    commandId: preparation.command.commandId,
    ...(preparation.command.transactionId ? { transactionId: preparation.command.transactionId } : {}),
    source: preparation.command.source,
    change,
  };
  store.publishChange(event);

  const result: NativeCommandResult = {
    protocolVersion: 1,
    commandId: preparation.command.commandId,
    ...(preparation.command.transactionId ? { transactionId: preparation.command.transactionId } : {}),
    status: 'applied',
    code: 'APPLIED',
    message: 'The command was committed successfully.',
    projectId: preparation.projectId,
    projectRevisionBefore: preparation.baseProjectRevision,
    projectRevisionAfter: currentRevision,
    changed: true,
    affectedDocuments: change.documents.map((item) => item.address),
    affectedNodes: preparation.command.type === 'node.transform'
      ? preparation.command.payload.nodes.map((item) => item.ref)
      : preparation.command.payload.nodes,
    warnings: preparation.warnings,
  };

  return {
    status: 'applied',
    result,
    committedState: commit.snapshot.editorState,
    change,
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

  const preparation = prepareNativeCommand(snapshot, input, context);
  let result: NativeCommandResult;
  if (preparation.status === 'prepared') {
    result = commitPreparedCommand(store, preparation).result;
  } else {
    result = preparation.result;
  }

  if (UUID_PATTERN.test(header.commandId)) {
    seen.add(header.commandId);
    while (seen.size > 500) seen.delete(seen.values().next().value as string);
    completedCommandIds.set(store, seen);
  }
  return result;
}

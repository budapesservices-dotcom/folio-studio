import type { NativeCommandResult } from '../core/commands/types';
import type { DesignNode } from '../core/document/types';
import {
  getExpectedCategoryForKind,
  isCanvasToolId,
  TOOL_OPERATION_LIMITS,
  TOOL_OPERATION_PROTOCOL,
  TOOL_OPERATION_VERSION,
  validateDesignNodePayload,
  validateToolOperationPayload,
  type CanvasToolId,
  type CommitInlineTextOperationPayload,
  type CreateNodesOperationPayload,
  type NotifyOperationPayload,
  type ReplaceNodesOperationPayload,
  type ReplaceNodeWithNodesOperationPayload,
  type SelectNodesOperationPayload,
  type SwitchToolOperationPayload,
  type ToolOperationCategory,
  type ToolOperationValidationErrorCode,
  type ToolWorkspaceScope,
  type TransformNodesOperationPayload,
  type ViewportUpdateOperationPayload,
} from '../core/tools/operationContract';
import {
  hasGeometryEngineSeal,
  isValidatedToolOperation,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  type ValidatedCommitInlineTextPayload,
  type ValidatedSampleColorPayload,
  type ValidatedToolOperation,
  type ValidatedToolOperationPayload,
} from '../engines/canvas/geometryEngine';
import type { WorkspaceCommandClient } from './mainCanvasCommandClient';

export type SupportedToolOperationKind = ValidatedToolOperationPayload['kind'];

export class ToolOperationEnvelopeError extends Error {
  readonly code: ToolOperationValidationErrorCode | 'UNSEALED_OPERATION';
  readonly path?: string;

  constructor(
    code: ToolOperationValidationErrorCode | 'UNSEALED_OPERATION',
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = 'ToolOperationEnvelopeError';
    this.code = code;
    this.path = path;
  }
}

const SUPPORTED_OPERATION_KINDS: ReadonlySet<string> = new Set<SupportedToolOperationKind>([
  'create-nodes',
  'transform-nodes',
  'replace-node-with-nodes',
  'replace-nodes',
  'sample-color',
  'commit-inline-text',
  'select-nodes',
  'viewport-update',
  'switch-tool',
  'notify',
]);

const VALIDATED_ENVELOPE_STRING_KEYS = [
  'validatedBy',
  'protocol',
  'version',
  'operationId',
  'toolId',
  'workspace',
  'category',
  'payload',
  'metadata',
] as const;

const METADATA_KEYS = ['atomicHistoryStep', 'description'] as const;
const VALIDATED_SAMPLE_COLOR_KEYS = [
  'kind',
  'color',
  'sourceName',
  'target',
  'resolvedNodesToUpdate',
  'noticeMessage',
] as const;
const VALIDATED_COMMIT_INLINE_TEXT_KEYS = ['kind', 'nodeId', 'text', 'resolvedNode'] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return false;
    return Object.keys(value).every((key) => {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(desc && desc.enumerable && 'value' in desc);
    });
  } catch {
    return false;
  }
}

function findUnexpectedStringKey(record: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

function isNonEmptyString(value: unknown, maxLength: number = TOOL_OPERATION_LIMITS.maxIdLength): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isSupportedOperationKind(value: unknown): value is SupportedToolOperationKind {
  return typeof value === 'string' && SUPPORTED_OPERATION_KINDS.has(value);
}

// ── Strict per-operation payload type-guard chain ───────────────────────────

function isCreateNodesPayload(payload: unknown): payload is CreateNodesOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'create-nodes' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function isTransformNodesPayload(payload: unknown): payload is TransformNodesOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'transform-nodes' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function isReplaceNodeWithNodesPayload(payload: unknown): payload is ReplaceNodeWithNodesOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'replace-node-with-nodes' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function isReplaceNodesPayload(payload: unknown): payload is ReplaceNodesOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'replace-nodes' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function assertValidatedSampleColorPayload(payload: unknown): asserts payload is ValidatedSampleColorPayload {
  if (!isPlainRecord(payload) || payload.kind !== 'sample-color') {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated sample-color payload must be a plain object with kind "sample-color".',
      'payload',
    );
  }
  const extraKey = findUnexpectedStringKey(payload, VALIDATED_SAMPLE_COLOR_KEYS);
  if (extraKey) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      `Unexpected property "${extraKey}" on validated sample-color payload.`,
      `payload.${extraKey}`,
    );
  }
  const baseCheck = validateToolOperationPayload(
    {
      kind: payload.kind,
      color: payload.color,
      sourceName: payload.sourceName,
      target: payload.target,
    },
    'payload',
  );
  if (!baseCheck.ok) {
    throw new ToolOperationEnvelopeError(
      baseCheck.code ?? 'INVALID_PAYLOAD',
      baseCheck.error ?? 'Invalid sample-color base payload.',
      baseCheck.path,
    );
  }
  if (!Array.isArray(payload.resolvedNodesToUpdate)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated sample-color payload requires a resolvedNodesToUpdate array.',
      'payload.resolvedNodesToUpdate',
    );
  }
  if (payload.resolvedNodesToUpdate.length > TOOL_OPERATION_LIMITS.maxNodesPerOperation) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      `Validated sample-color resolvedNodesToUpdate exceeds maximum allowed length (${TOOL_OPERATION_LIMITS.maxNodesPerOperation}).`,
      'payload.resolvedNodesToUpdate',
    );
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < payload.resolvedNodesToUpdate.length; i += 1) {
    const node = payload.resolvedNodesToUpdate[i];
    const nodePath = `payload.resolvedNodesToUpdate[${i}]`;
    const nodeErr = validateDesignNodePayload(node, nodePath);
    if (nodeErr) {
      throw new ToolOperationEnvelopeError(
        nodeErr.code ?? 'INVALID_NODE',
        nodeErr.error ?? `Invalid node at ${nodePath}.`,
        nodeErr.path,
      );
    }
    const id = (node as DesignNode).id;
    if (seenIds.has(id)) {
      throw new ToolOperationEnvelopeError(
        'DUPLICATE_NODE_ID',
        `Duplicate node id "${id}" inside payload.resolvedNodesToUpdate.`,
        `${nodePath}.id`,
      );
    }
    seenIds.add(id);
  }
  if (!isNonEmptyString(payload.noticeMessage, TOOL_OPERATION_LIMITS.maxMessageLength)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated sample-color payload requires a non-empty noticeMessage string.',
      'payload.noticeMessage',
    );
  }
}

function isValidatedSampleColorPayload(payload: unknown): payload is ValidatedSampleColorPayload {
  try {
    assertValidatedSampleColorPayload(payload);
    return true;
  } catch {
    return false;
  }
}

function assertValidatedCommitInlineTextPayload(
  payload: unknown,
): asserts payload is ValidatedCommitInlineTextPayload {
  if (!isPlainRecord(payload) || payload.kind !== 'commit-inline-text') {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated commit-inline-text payload must be a plain object with kind "commit-inline-text".',
      'payload',
    );
  }
  const extraKey = findUnexpectedStringKey(payload, VALIDATED_COMMIT_INLINE_TEXT_KEYS);
  if (extraKey) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      `Unexpected property "${extraKey}" on validated commit-inline-text payload.`,
      `payload.${extraKey}`,
    );
  }
  const baseCheck = validateToolOperationPayload(
    {
      kind: payload.kind,
      nodeId: payload.nodeId,
      text: payload.text,
    },
    'payload',
  );
  if (!baseCheck.ok) {
    throw new ToolOperationEnvelopeError(
      baseCheck.code ?? 'INVALID_PAYLOAD',
      baseCheck.error ?? 'Invalid commit-inline-text base payload.',
      baseCheck.path,
    );
  }
  const resolvedErr = validateDesignNodePayload(payload.resolvedNode, 'payload.resolvedNode');
  if (resolvedErr) {
    throw new ToolOperationEnvelopeError(
      resolvedErr.code ?? 'INVALID_NODE',
      resolvedErr.error ?? 'Validated commit-inline-text payload requires a valid resolvedNode.',
      resolvedErr.path,
    );
  }
  const resolvedNode = payload.resolvedNode as DesignNode;
  if (resolvedNode.type !== 'text') {
    throw new ToolOperationEnvelopeError(
      'INVALID_NODE',
      `Validated commit-inline-text resolvedNode must have type "text", received "${resolvedNode.type}".`,
      'payload.resolvedNode.type',
    );
  }
  const base = payload as unknown as CommitInlineTextOperationPayload;
  if (resolvedNode.id !== base.nodeId) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      `Validated commit-inline-text resolvedNode.id "${resolvedNode.id}" does not match payload.nodeId "${base.nodeId}".`,
      'payload.resolvedNode.id',
    );
  }
  if (resolvedNode.text !== base.text) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated commit-inline-text resolvedNode.text must match payload.text.',
      'payload.resolvedNode.text',
    );
  }
}

function isValidatedCommitInlineTextPayload(payload: unknown): payload is ValidatedCommitInlineTextPayload {
  try {
    assertValidatedCommitInlineTextPayload(payload);
    return true;
  } catch {
    return false;
  }
}

function isSelectNodesPayload(payload: unknown): payload is SelectNodesOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'select-nodes' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function isViewportUpdatePayload(payload: unknown): payload is ViewportUpdateOperationPayload {
  if (!isPlainRecord(payload) || payload.kind !== 'viewport-update') return false;
  if (!validateToolOperationPayload(payload, 'payload').ok) return false;
  if (
    payload.zoom !== undefined &&
    (typeof payload.zoom !== 'number' || payload.zoom < MIN_VIEWPORT_ZOOM || payload.zoom > MAX_VIEWPORT_ZOOM)
  ) {
    return false;
  }
  return true;
}

function isSwitchToolPayload(payload: unknown): payload is SwitchToolOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'switch-tool' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function isNotifyPayload(payload: unknown): payload is NotifyOperationPayload {
  return (
    isPlainRecord(payload) &&
    payload.kind === 'notify' &&
    validateToolOperationPayload(payload, 'payload').ok
  );
}

function assertStandardPayload(payload: unknown, kind: SupportedToolOperationKind): void {
  const result = validateToolOperationPayload(payload, 'payload');
  if (!result.ok) {
    throw new ToolOperationEnvelopeError(
      result.code ?? 'INVALID_PAYLOAD',
      result.error ?? `Invalid "${kind}" payload.`,
      result.path,
    );
  }
}

/**
 * Strict type-guard chain for the Native Command Engine execution boundary.
 * Validates the Geometry Engine seal, top-level envelope metadata and operation
 * type (`category` + `payload.kind`), and the full internal `payload` structure
 * for every supported Tool Operation, throwing a descriptive
 * `ToolOperationEnvelopeError` when any invariant fails.
 */
export function validateToolOperationEnvelope(input: unknown): ValidatedToolOperation {
  if (!isPlainRecord(input)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_ENVELOPE',
      'Tool operation envelope must be a plain non-null object.',
    );
  }

  if (!hasGeometryEngineSeal(input)) {
    throw new ToolOperationEnvelopeError(
      'UNSEALED_OPERATION',
      'Refused to execute an operation that was not validated by the Geometry Engine.',
    );
  }

  const envelope = input;
  const unexpectedKey = findUnexpectedStringKey(envelope, VALIDATED_ENVELOPE_STRING_KEYS);
  if (unexpectedKey) {
    throw new ToolOperationEnvelopeError(
      'INVALID_ENVELOPE',
      `Unexpected property "${unexpectedKey}" on validated tool operation envelope.`,
      unexpectedKey,
    );
  }

  if (envelope.protocol !== TOOL_OPERATION_PROTOCOL) {
    throw new ToolOperationEnvelopeError(
      'UNSUPPORTED_PROTOCOL',
      `Unsupported tool operation protocol: ${String(envelope.protocol)}.`,
      'protocol',
    );
  }

  if (envelope.version !== TOOL_OPERATION_VERSION) {
    throw new ToolOperationEnvelopeError(
      'UNSUPPORTED_VERSION',
      `Unsupported tool operation version: ${String(envelope.version)}.`,
      'version',
    );
  }

  if (!isNonEmptyString(envelope.operationId)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_ENVELOPE',
      'Validated tool operation envelope requires a non-empty operationId.',
      'operationId',
    );
  }

  if (!isCanvasToolId(envelope.toolId)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_TOOL',
      `Unknown studio toolId on validated envelope: ${String(envelope.toolId)}.`,
      'toolId',
    );
  }

  if (envelope.workspace !== 'main' && envelope.workspace !== 'component') {
    throw new ToolOperationEnvelopeError(
      'INVALID_ENVELOPE',
      `Invalid workspace scope on validated envelope: ${String(envelope.workspace)}.`,
      'workspace',
    );
  }

  if (!isPlainRecord(envelope.metadata)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_METADATA',
      'Validated tool operation metadata must be a plain object.',
      'metadata',
    );
  }
  const extraMetaKey = findUnexpectedStringKey(envelope.metadata, METADATA_KEYS);
  if (extraMetaKey) {
    throw new ToolOperationEnvelopeError(
      'INVALID_METADATA',
      `Unexpected property "${extraMetaKey}" on validated tool operation metadata.`,
      `metadata.${extraMetaKey}`,
    );
  }
  if (typeof envelope.metadata.atomicHistoryStep !== 'boolean') {
    throw new ToolOperationEnvelopeError(
      'INVALID_METADATA',
      'Validated tool operation metadata.atomicHistoryStep must be a boolean.',
      'metadata.atomicHistoryStep',
    );
  }
  if (
    envelope.metadata.description !== undefined &&
    !isNonEmptyString(envelope.metadata.description, TOOL_OPERATION_LIMITS.maxMessageLength)
  ) {
    throw new ToolOperationEnvelopeError(
      'INVALID_METADATA',
      'Validated tool operation metadata.description must be a non-empty string when provided.',
      'metadata.description',
    );
  }

  const payload = envelope.payload;
  if (!isPlainRecord(payload)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      'Validated tool operation payload must be a plain object.',
      'payload',
    );
  }

  if (!isSupportedOperationKind(payload.kind)) {
    throw new ToolOperationEnvelopeError(
      'INVALID_PAYLOAD',
      `Unsupported tool operation type "${String(payload.kind)}".`,
      'payload.kind',
    );
  }

  const expectedCategory: ToolOperationCategory | null = getExpectedCategoryForKind(payload.kind);
  if (!expectedCategory || envelope.category !== expectedCategory) {
    throw new ToolOperationEnvelopeError(
      'INVALID_CATEGORY',
      `Tool operation category "${String(envelope.category)}" does not match operation type "${payload.kind}".`,
      'category',
    );
  }

  switch (payload.kind) {
    case 'create-nodes':
      if (!isCreateNodesPayload(payload)) assertStandardPayload(payload, 'create-nodes');
      break;

    case 'transform-nodes':
      if (!isTransformNodesPayload(payload)) assertStandardPayload(payload, 'transform-nodes');
      break;

    case 'replace-node-with-nodes':
      if (!isReplaceNodeWithNodesPayload(payload)) assertStandardPayload(payload, 'replace-node-with-nodes');
      break;

    case 'replace-nodes':
      if (!isReplaceNodesPayload(payload)) assertStandardPayload(payload, 'replace-nodes');
      break;

    case 'sample-color':
      if (!isValidatedSampleColorPayload(payload)) assertValidatedSampleColorPayload(payload);
      break;

    case 'commit-inline-text':
      if (!isValidatedCommitInlineTextPayload(payload)) assertValidatedCommitInlineTextPayload(payload);
      break;

    case 'select-nodes':
      if (!isSelectNodesPayload(payload)) assertStandardPayload(payload, 'select-nodes');
      break;

    case 'viewport-update':
      if (!isViewportUpdatePayload(payload)) {
        assertStandardPayload(payload, 'viewport-update');
        if (
          payload.zoom !== undefined &&
          (typeof payload.zoom !== 'number' || payload.zoom < MIN_VIEWPORT_ZOOM || payload.zoom > MAX_VIEWPORT_ZOOM)
        ) {
          throw new ToolOperationEnvelopeError(
            'INVALID_VIEWPORT',
            `Validated viewport-update zoom (${String(payload.zoom)}) must be within [${MIN_VIEWPORT_ZOOM}, ${MAX_VIEWPORT_ZOOM}].`,
            'payload.zoom',
          );
        }
      }
      break;

    case 'switch-tool':
      if (!isSwitchToolPayload(payload)) assertStandardPayload(payload, 'switch-tool');
      break;

    case 'notify':
      if (!isNotifyPayload(payload)) assertStandardPayload(payload, 'notify');
      break;

    default: {
      const exhaustive: never = payload.kind;
      throw new ToolOperationEnvelopeError(
        'INVALID_PAYLOAD',
        `Unhandled tool operation type "${String(exhaustive)}".`,
        'payload.kind',
      );
    }
  }

  if (!isValidatedToolOperation(input)) {
    throw new ToolOperationEnvelopeError(
      'UNSEALED_OPERATION',
      'Validated tool operation failed final Geometry Engine envelope check.',
    );
  }

  return input;
}

export function isValidatedToolOperationEnvelope(input: unknown): input is ValidatedToolOperation {
  try {
    validateToolOperationEnvelope(input);
    return true;
  } catch {
    return false;
  }
}

export interface ToolOperationShellCallbacks {
  readonly isHydrating?: () => boolean;
  readonly onSelectionChange: (nodeIds: string[]) => void;
  readonly onPanChange: (pan: { x: number; y: number }) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onToolChange?: (toolId: CanvasToolId) => void;
  readonly onNotice?: (message: string) => void;
  readonly onSampledColorOptionChange?: (color: string, target: 'fill' | 'stroke') => void;
  readonly onCanvasMutationCommitted?: (kind: 'create' | 'transform' | 'replace' | 'text' | 'sample-color') => void;
}

export interface WorkspaceToolOperationExecutorOptions {
  readonly workspace: ToolWorkspaceScope;
  readonly commandClient: WorkspaceCommandClient;
  readonly shell: ToolOperationShellCallbacks;
}

export type ToolOperationExecutorOptions = WorkspaceToolOperationExecutorOptions;

export interface ToolOperationExecutionReport {
  readonly operationId: string;
  readonly workspace: ToolWorkspaceScope;
  readonly status: 'applied' | 'no-op' | 'rejected';
  readonly commandResult?: NativeCommandResult;
  readonly reason?: string;
}

export interface ToolOperationExecutor {
  execute(operation: ValidatedToolOperation): ToolOperationExecutionReport;
  executeBatch(operations: readonly ValidatedToolOperation[]): ToolOperationExecutionReport[];
}

/**
 * Unidirectional Native Command Engine adapter for Canvas Tool Operations
 * across both Main Canvas and Component Canvas workspaces.
 *
 * Accepts ONLY `ValidatedToolOperation` envelopes sealed by the Geometry Engine
 * and verified through `validateToolOperationEnvelope`.
 * All document mutations commit exclusively through `WorkspaceCommandClient`
 * (Native Command Engine -> Canonical Editor Store). Studio Tools never see
 * `WorkspaceCommandClient`, `CanonicalEditorStore`, `editorReducer`, or UI panels.
 */
export function createToolOperationExecutor(options: ToolOperationExecutorOptions): ToolOperationExecutor {
  const execute = (operation: ValidatedToolOperation): ToolOperationExecutionReport => {
    let validated: ValidatedToolOperation;
    try {
      validated = validateToolOperationEnvelope(operation);
    } catch (error) {
      const candidateId =
        isPlainRecord(operation) && isNonEmptyString(operation.operationId) ? operation.operationId : 'unknown';
      return {
        operationId: candidateId,
        workspace: options.workspace,
        status: 'rejected',
        reason: error instanceof Error ? error.message : 'Invalid tool operation envelope.',
      };
    }

    if (validated.workspace !== options.workspace) {
      return {
        operationId: validated.operationId,
        workspace: options.workspace,
        status: 'rejected',
        reason: `Workspace mismatch: executor serves "${options.workspace}" but received "${validated.workspace}".`,
      };
    }

    const hydrating = options.shell.isHydrating?.() ?? false;
    const payload = validated.payload;
    const description = validated.metadata.description;

    switch (payload.kind) {
      case 'create-nodes': {
        if (hydrating) {
          return {
            operationId: validated.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped document creation while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('create');
        const commandResult = options.commandClient.createNodes(
          payload.nodes,
          description ?? 'Create with studio tool',
        );
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'transform-nodes': {
        if (hydrating) {
          return {
            operationId: validated.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped transform while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('transform');
        const commandResult = options.commandClient.transformNodes(
          payload.nodes,
          description ?? 'Transform on canvas',
        );
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'replace-node-with-nodes': {
        if (hydrating) {
          return {
            operationId: validated.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped split while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('replace');
        const commandResult = options.commandClient.replaceNodeWithNodes(
          payload.nodeId,
          payload.nodes,
          description ?? 'Split vector path',
        );
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'replace-nodes': {
        if (hydrating) {
          return {
            operationId: validated.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped node replacement while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('replace');
        const commandResult = options.commandClient.replaceNodes(
          payload.removeIds,
          payload.insertNodes,
          description ?? 'Replace vector nodes',
          payload.selectIds,
        );
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'sample-color': {
        options.shell.onSampledColorOptionChange?.(payload.color, payload.target);
        let commandResult: NativeCommandResult | undefined;
        if (!hydrating && payload.resolvedNodesToUpdate.length > 0) {
          options.shell.onCanvasMutationCommitted?.('sample-color');
          commandResult = options.commandClient.transformNodes(
            payload.resolvedNodesToUpdate,
            description ?? `Apply sampled ${payload.target}`,
          );
        }
        options.shell.onNotice?.(payload.noticeMessage);
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult ? commandResult.status : 'applied',
          ...(commandResult ? { commandResult } : {}),
        };
      }

      case 'commit-inline-text': {
        if (hydrating) {
          return {
            operationId: validated.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped text commit while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('text');
        const commandResult = options.commandClient.replaceNode(
          payload.resolvedNode,
          description ?? 'Edit text on canvas',
        );
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'select-nodes': {
        options.shell.onSelectionChange([...payload.nodeIds]);
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'viewport-update': {
        if (payload.pan !== undefined) {
          options.shell.onPanChange({ x: payload.pan.x, y: payload.pan.y });
        }
        if (payload.zoom !== undefined) {
          options.shell.onZoomChange(payload.zoom);
        }
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'switch-tool': {
        options.shell.onToolChange?.(payload.nextToolId);
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'notify': {
        options.shell.onNotice?.(payload.message);
        return {
          operationId: validated.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }
    }
  };

  return {
    execute,
    executeBatch(operations) {
      return operations.map((op) => execute(op));
    },
  };
}

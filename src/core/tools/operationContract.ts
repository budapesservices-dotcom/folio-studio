import type { DesignNode } from '../document/types';

export const TOOL_OPERATION_PROTOCOL = 'folio.tool-operation' as const;
export const TOOL_OPERATION_VERSION = 1 as const;

export type ToolOperationProtocol = typeof TOOL_OPERATION_PROTOCOL;
export type ToolOperationVersion = typeof TOOL_OPERATION_VERSION;

export type ToolWorkspaceScope = 'main' | 'component';

export type Wave1CanvasToolId =
  | 'select'
  | 'direct-selection'
  | 'lasso-selection'
  | 'magic-wand'
  | 'hand'
  | 'scrubby-zoom';

export type StudioCanvasToolId =
  | Wave1CanvasToolId
  | 'scale'
  | 'frame'
  | 'section'
  | 'draw-rect'
  | 'draw-ellipse'
  | 'draw-line'
  | 'draw-arrow'
  | 'draw-polygon'
  | 'draw-star'
  | 'pen'
  | 'curvature'
  | 'anchor-point'
  | 'pencil'
  | 'smooth'
  | 'scissors'
  | 'shape-builder'
  | 'draw-text'
  | 'rotate'
  | 'eyedropper'
  | 'measure';

export type CanvasToolId = StudioCanvasToolId;

export type CanvasToolGroupId =
  | 'selection'
  | 'layout'
  | 'shapes'
  | 'vector'
  | 'type'
  | 'transform'
  | 'inspect'
  | 'navigation';

export const CANVAS_TOOL_IDS: readonly CanvasToolId[] = Object.freeze([
  'select',
  'direct-selection',
  'lasso-selection',
  'magic-wand',
  'hand',
  'scrubby-zoom',
  'scale',
  'frame',
  'section',
  'draw-rect',
  'draw-ellipse',
  'draw-line',
  'draw-arrow',
  'draw-polygon',
  'draw-star',
  'pen',
  'curvature',
  'anchor-point',
  'pencil',
  'smooth',
  'scissors',
  'shape-builder',
  'draw-text',
  'rotate',
  'eyedropper',
  'measure',
]);

const CANVAS_TOOL_ID_SET: ReadonlySet<string> = new Set(CANVAS_TOOL_IDS);

export function isCanvasToolId(value: unknown): value is CanvasToolId {
  return typeof value === 'string' && CANVAS_TOOL_ID_SET.has(value);
}

export interface CanvasToolOptions {
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  strokeWidth: number;
  strokeColor: string;
  fillColor: string;
  keepToolActive: boolean;
  smoothRadius: number;
}

export const DEFAULT_CANVAS_TOOL_OPTIONS: CanvasToolOptions = {
  polygonSides: 6,
  starPoints: 5,
  starInnerRatio: 0.44,
  strokeWidth: 2.5,
  strokeColor: '#20212A',
  fillColor: '#8B7CF6',
  keepToolActive: false,
  smoothRadius: 34,
};

export type ToolOperationCategory =
  | 'document-mutation'
  | 'selection'
  | 'viewport'
  | 'tool-state';

export interface CreateNodesOperationPayload {
  readonly kind: 'create-nodes';
  readonly nodes: readonly DesignNode[];
  readonly openInlineTextForNodeId?: string;
}

export interface TransformNodesOperationPayload {
  readonly kind: 'transform-nodes';
  readonly nodes: readonly DesignNode[];
}

export interface ReplaceNodeWithNodesOperationPayload {
  readonly kind: 'replace-node-with-nodes';
  readonly nodeId: string;
  readonly nodes: readonly DesignNode[];
}

export interface ReplaceNodesOperationPayload {
  readonly kind: 'replace-nodes';
  readonly removeIds: readonly string[];
  readonly insertNodes: readonly DesignNode[];
  readonly selectIds?: readonly string[];
}

export interface SampleColorOperationPayload {
  readonly kind: 'sample-color';
  readonly color: string;
  readonly sourceName: string;
  readonly target: 'fill' | 'stroke';
}

export interface CommitInlineTextOperationPayload {
  readonly kind: 'commit-inline-text';
  readonly nodeId: string;
  readonly text: string;
}

export interface SelectNodesOperationPayload {
  readonly kind: 'select-nodes';
  readonly nodeIds: readonly string[];
}

export interface ViewportUpdateOperationPayload {
  readonly kind: 'viewport-update';
  readonly pan?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
}

export interface SwitchToolOperationPayload {
  readonly kind: 'switch-tool';
  readonly nextToolId: CanvasToolId;
}

export interface NotifyOperationPayload {
  readonly kind: 'notify';
  readonly message: string;
}

export type DocumentMutationOperationPayload =
  | CreateNodesOperationPayload
  | TransformNodesOperationPayload
  | ReplaceNodeWithNodesOperationPayload
  | ReplaceNodesOperationPayload
  | SampleColorOperationPayload
  | CommitInlineTextOperationPayload;

export type ToolOperationPayload =
  | DocumentMutationOperationPayload
  | SelectNodesOperationPayload
  | ViewportUpdateOperationPayload
  | SwitchToolOperationPayload
  | NotifyOperationPayload;

export interface ToolOperationMetadata {
  readonly atomicHistoryStep: boolean;
  readonly description?: string;
}

export interface ToolOperationEnvelope<TPayload extends ToolOperationPayload = ToolOperationPayload> {
  readonly protocol: ToolOperationProtocol;
  readonly version: ToolOperationVersion;
  readonly operationId: string;
  readonly toolId: CanvasToolId;
  readonly workspace: ToolWorkspaceScope;
  readonly category: ToolOperationCategory;
  readonly payload: TPayload;
  readonly metadata: ToolOperationMetadata;
}

export type DocumentMutationToolOperation =
  | ToolOperationEnvelope<CreateNodesOperationPayload>
  | ToolOperationEnvelope<TransformNodesOperationPayload>
  | ToolOperationEnvelope<ReplaceNodeWithNodesOperationPayload>
  | ToolOperationEnvelope<ReplaceNodesOperationPayload>
  | ToolOperationEnvelope<SampleColorOperationPayload>
  | ToolOperationEnvelope<CommitInlineTextOperationPayload>;

export type ToolOperation =
  | DocumentMutationToolOperation
  | ToolOperationEnvelope<SelectNodesOperationPayload>
  | ToolOperationEnvelope<ViewportUpdateOperationPayload>
  | ToolOperationEnvelope<SwitchToolOperationPayload>
  | ToolOperationEnvelope<NotifyOperationPayload>;

/**
 * Structural subset of Studio Tool transition outputs relevant to the
 * Tool Operation Contract. Keeps this core contract independent of
 * `src/engines/canvas/*` internals.
 */
export interface ToolTransitionCommitOutput {
  readonly commitNodes?: readonly DesignNode[];
  readonly createNodes?: readonly DesignNode[];
  readonly replaceNodeWithNodes?: {
    readonly nodeId: string;
    readonly nodes: readonly DesignNode[];
  };
  readonly replaceNodes?: {
    readonly removeIds: readonly string[];
    readonly insertNodes: readonly DesignNode[];
  };
  readonly selection?: readonly string[];
  readonly sampledColor?: {
    readonly color: string;
    readonly sourceName: string;
    readonly target?: 'fill' | 'stroke';
  };
  readonly editTextNodeId?: string;
  readonly nextToolId?: CanvasToolId;
  readonly notice?: string;
  readonly pan?: { readonly x: number; readonly y: number };
  readonly zoom?: number;
  readonly operations?: readonly ToolOperation[];
}

export interface ToolOperationEnvelopeValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

let operationSequence = 1;

function nextOperationId(): string {
  const sequence = operationSequence++;
  return `tool-op-${sequence}`;
}

export function getToolOperationCategory(payload: ToolOperationPayload): ToolOperationCategory {
  switch (payload.kind) {
    case 'create-nodes':
    case 'transform-nodes':
    case 'replace-node-with-nodes':
    case 'replace-nodes':
    case 'sample-color':
    case 'commit-inline-text':
      return 'document-mutation';
    case 'select-nodes':
      return 'selection';
    case 'viewport-update':
      return 'viewport';
    case 'switch-tool':
    case 'notify':
      return 'tool-state';
  }
}

export function isDocumentMutationOperation(
  operation: ToolOperation,
): operation is DocumentMutationToolOperation {
  return operation.category === 'document-mutation';
}

export function createToolOperation<TPayload extends ToolOperationPayload>(
  toolId: CanvasToolId,
  workspace: ToolWorkspaceScope,
  payload: TPayload,
  metadata?: Partial<ToolOperationMetadata>,
): TPayload extends ToolOperationPayload ? ToolOperationEnvelope<TPayload> : never {
  const category = getToolOperationCategory(payload);
  return {
    protocol: TOOL_OPERATION_PROTOCOL,
    version: TOOL_OPERATION_VERSION,
    operationId: nextOperationId(),
    toolId,
    workspace,
    category,
    payload,
    metadata: {
      atomicHistoryStep: metadata?.atomicHistoryStep ?? category === 'document-mutation',
      ...(metadata?.description ? { description: metadata.description } : {}),
    },
  } as TPayload extends ToolOperationPayload ? ToolOperationEnvelope<TPayload> : never;
}

function getDefaultMutationDescription(toolId: CanvasToolId, kind: DocumentMutationOperationPayload['kind']): string {
  switch (kind) {
    case 'create-nodes':
      return `Create with ${toolId} tool`;
    case 'transform-nodes':
      return `Transform with ${toolId} tool`;
    case 'replace-node-with-nodes':
      return 'Split vector path';
    case 'replace-nodes':
      return 'Replace vector nodes';
    case 'sample-color':
      return 'Apply sampled color';
    case 'commit-inline-text':
      return 'Edit text on canvas';
  }
}

/**
 * Converts a Studio Tool transition into an ordered list of strict, versioned
 * Tool Operation Contract envelopes. Local preview/session state stays inside
 * the Studio Tool / Canvas viewport and is never emitted as a commit operation.
 */
export function extractToolOperationsFromTransition(
  toolId: CanvasToolId,
  workspace: ToolWorkspaceScope,
  transition: ToolTransitionCommitOutput,
): ToolOperation[] {
  const operations: ToolOperation[] = [];

  if (transition.operations && transition.operations.length > 0) {
    operations.push(...transition.operations);
  }

  if (transition.createNodes && transition.createNodes.length > 0) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'create-nodes',
          nodes: transition.createNodes,
          ...(transition.editTextNodeId ? { openInlineTextForNodeId: transition.editTextNodeId } : {}),
        },
        { description: getDefaultMutationDescription(toolId, 'create-nodes') },
      ),
    );
  }

  if (transition.replaceNodeWithNodes) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'replace-node-with-nodes',
          nodeId: transition.replaceNodeWithNodes.nodeId,
          nodes: transition.replaceNodeWithNodes.nodes,
        },
        { description: getDefaultMutationDescription(toolId, 'replace-node-with-nodes') },
      ),
    );
  }

  if (transition.replaceNodes) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'replace-nodes',
          removeIds: transition.replaceNodes.removeIds,
          insertNodes: transition.replaceNodes.insertNodes,
        },
        { description: getDefaultMutationDescription(toolId, 'replace-nodes') },
      ),
    );
  }

  if (transition.commitNodes && transition.commitNodes.length > 0) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'transform-nodes',
          nodes: transition.commitNodes,
        },
        { description: getDefaultMutationDescription(toolId, 'transform-nodes') },
      ),
    );
  }

  if ('selection' in transition) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'select-nodes',
          nodeIds: transition.selection ?? [],
        },
        { atomicHistoryStep: false },
      ),
    );
  }

  if (transition.sampledColor) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'sample-color',
          color: transition.sampledColor.color,
          sourceName: transition.sampledColor.sourceName,
          target: transition.sampledColor.target ?? 'fill',
        },
        { description: `Apply sampled ${transition.sampledColor.target ?? 'fill'}` },
      ),
    );
  }

  if (transition.nextToolId) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'switch-tool',
          nextToolId: transition.nextToolId,
        },
        { atomicHistoryStep: false },
      ),
    );
  }

  if (transition.notice) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'notify',
          message: transition.notice,
        },
        { atomicHistoryStep: false },
      ),
    );
  }

  if (transition.pan !== undefined || transition.zoom !== undefined) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'viewport-update',
          ...(transition.pan !== undefined ? { pan: transition.pan } : {}),
          ...(transition.zoom !== undefined ? { zoom: transition.zoom } : {}),
        },
        { atomicHistoryStep: false },
      ),
    );
  }

  return operations;
}

export function validateToolOperationEnvelope(input: unknown): ToolOperationEnvelopeValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Tool operation must be a non-null object.' };
  }
  const op = input as Record<string, unknown>;
  if (op.protocol !== TOOL_OPERATION_PROTOCOL) {
    return { ok: false, error: `Unsupported tool operation protocol: ${String(op.protocol)}.` };
  }
  if (op.version !== TOOL_OPERATION_VERSION) {
    return { ok: false, error: `Unsupported tool operation version: ${String(op.version)}.` };
  }
  if (typeof op.operationId !== 'string' || op.operationId.trim().length === 0) {
    return { ok: false, error: 'Tool operation requires a non-empty operationId.' };
  }
  if (!isCanvasToolId(op.toolId)) {
    return { ok: false, error: `Unknown studio toolId: ${String(op.toolId)}.` };
  }
  if (op.workspace !== 'main' && op.workspace !== 'component') {
    return { ok: false, error: `Invalid tool operation workspace: ${String(op.workspace)}.` };
  }
  if (typeof op.payload !== 'object' || op.payload === null || Array.isArray(op.payload)) {
    return { ok: false, error: 'Tool operation payload must be an object.' };
  }
  const payload = op.payload as Record<string, unknown>;
  if (typeof payload.kind !== 'string') {
    return { ok: false, error: 'Tool operation payload requires a discriminant kind.' };
  }
  const expectedCategory = (() => {
    switch (payload.kind) {
      case 'create-nodes':
      case 'transform-nodes':
      case 'replace-node-with-nodes':
      case 'replace-nodes':
      case 'sample-color':
      case 'commit-inline-text':
        return 'document-mutation';
      case 'select-nodes':
        return 'selection';
      case 'viewport-update':
        return 'viewport';
      case 'switch-tool':
      case 'notify':
        return 'tool-state';
      default:
        return null;
    }
  })();
  if (!expectedCategory) {
    return { ok: false, error: `Unsupported tool operation kind: ${payload.kind}.` };
  }
  if (op.category !== expectedCategory) {
    return {
      ok: false,
      error: `Tool operation category "${String(op.category)}" does not match payload kind "${payload.kind}".`,
    };
  }
  if (typeof op.metadata !== 'object' || op.metadata === null || Array.isArray(op.metadata)) {
    return { ok: false, error: 'Tool operation metadata must be an object.' };
  }
  const meta = op.metadata as Record<string, unknown>;
  if (typeof meta.atomicHistoryStep !== 'boolean') {
    return { ok: false, error: 'Tool operation metadata.atomicHistoryStep must be a boolean.' };
  }
  return { ok: true };
}

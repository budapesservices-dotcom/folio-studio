import { getEffectiveLayerStates, type EffectiveLayerState } from '../../core/document/layers';
import type { DesignNode, FolioDocument, PathNode, TextNode, VectorAnchorPoint } from '../../core/document/types';
import {
  isCanvasToolId,
  TOOL_OPERATION_PROTOCOL,
  TOOL_OPERATION_VERSION,
  validateToolOperationEnvelope,
  type CanvasToolId,
  type CommitInlineTextOperationPayload,
  type CreateNodesOperationPayload,
  type NotifyOperationPayload,
  type ReplaceNodesOperationPayload,
  type ReplaceNodeWithNodesOperationPayload,
  type SampleColorOperationPayload,
  type SelectNodesOperationPayload,
  type SwitchToolOperationPayload,
  type ToolOperation,
  type ToolOperationCategory,
  type ToolOperationMetadata,
  type ToolOperationProtocol,
  type ToolOperationValidationErrorCode,
  type ToolOperationVersion,
  type ToolWorkspaceScope,
  type TransformNodesOperationPayload,
  type ViewportUpdateOperationPayload,
} from '../../core/tools/operationContract';
import { nodesGeometryChanged } from './geometry';

const GEOMETRY_ENGINE_SEAL: unique symbol = Symbol('folio.geometry-engine.validated');

export const MIN_VIEWPORT_ZOOM = 0.15;
export const MAX_VIEWPORT_ZOOM = 8;

export interface GeometryValidationContext {
  readonly document: FolioDocument;
  readonly selectedNodeIds: readonly string[];
  readonly effectiveLayerStates?: ReadonlyMap<string, EffectiveLayerState>;
}

export type GeometryRejectionCode =
  | 'INVALID_ENVELOPE'
  | 'EMPTY_OPERATION'
  | 'INVALID_GEOMETRY'
  | 'INVALID_NODE'
  | 'DUPLICATE_NODE_ID'
  | 'TARGET_NOT_FOUND'
  | 'LOCKED_TARGET'
  | 'INVALID_COLOR'
  | 'INVALID_VIEWPORT'
  | 'INVALID_TOOL'
  | 'UNSUPPORTED_TARGET_TYPE';

export interface ValidatedSampleColorPayload extends SampleColorOperationPayload {
  readonly resolvedNodesToUpdate: readonly DesignNode[];
  readonly noticeMessage: string;
}

export interface ValidatedCommitInlineTextPayload extends CommitInlineTextOperationPayload {
  readonly resolvedNode: TextNode;
}

export type ValidatedToolOperationPayload =
  | CreateNodesOperationPayload
  | TransformNodesOperationPayload
  | ReplaceNodeWithNodesOperationPayload
  | ReplaceNodesOperationPayload
  | ValidatedSampleColorPayload
  | ValidatedCommitInlineTextPayload
  | SelectNodesOperationPayload
  | ViewportUpdateOperationPayload
  | SwitchToolOperationPayload
  | NotifyOperationPayload;

export interface ValidatedToolOperationEnvelope<
  TPayload extends ValidatedToolOperationPayload = ValidatedToolOperationPayload,
> {
  readonly [GEOMETRY_ENGINE_SEAL]: true;
  readonly validatedBy: 'geometry-engine';
  readonly protocol: ToolOperationProtocol;
  readonly version: ToolOperationVersion;
  readonly operationId: string;
  readonly toolId: CanvasToolId;
  readonly workspace: ToolWorkspaceScope;
  readonly category: ToolOperationCategory;
  readonly payload: TPayload;
  readonly metadata: ToolOperationMetadata;
}

export type ValidatedToolOperation =
  | ValidatedToolOperationEnvelope<CreateNodesOperationPayload>
  | ValidatedToolOperationEnvelope<TransformNodesOperationPayload>
  | ValidatedToolOperationEnvelope<ReplaceNodeWithNodesOperationPayload>
  | ValidatedToolOperationEnvelope<ReplaceNodesOperationPayload>
  | ValidatedToolOperationEnvelope<ValidatedSampleColorPayload>
  | ValidatedToolOperationEnvelope<ValidatedCommitInlineTextPayload>
  | ValidatedToolOperationEnvelope<SelectNodesOperationPayload>
  | ValidatedToolOperationEnvelope<ViewportUpdateOperationPayload>
  | ValidatedToolOperationEnvelope<SwitchToolOperationPayload>
  | ValidatedToolOperationEnvelope<NotifyOperationPayload>;

export type GeometryEvaluationResult =
  | { readonly status: 'ready'; readonly operation: ValidatedToolOperation }
  | { readonly status: 'no-op'; readonly code: 'ZERO_DELTA_NO_OP' | 'NO_CHANGES'; readonly reason: string }
  | { readonly status: 'rejected'; readonly code: GeometryRejectionCode; readonly reason: string };

export interface GeometryBatchEvaluationResult {
  readonly ready: readonly ValidatedToolOperation[];
  readonly noOps: ReadonlyArray<{ readonly operationId: string; readonly code: 'ZERO_DELTA_NO_OP' | 'NO_CHANGES'; readonly reason: string }>;
  readonly rejected: ReadonlyArray<{ readonly operationId: string; readonly code: GeometryRejectionCode; readonly reason: string }>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidAnchorPoint(point: VectorAnchorPoint): boolean {
  if (typeof point.id !== 'string' || point.id.length === 0) return false;
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false;
  if (point.handleIn && (!isFiniteNumber(point.handleIn.x) || !isFiniteNumber(point.handleIn.y))) return false;
  if (point.handleOut && (!isFiniteNumber(point.handleOut.x) || !isFiniteNumber(point.handleOut.y))) return false;
  return point.pointType === 'corner' || point.pointType === 'smooth' || point.pointType === 'symmetric';
}

function validateNodeGeometry(node: DesignNode): string | null {
  if (!node || typeof node !== 'object') return 'Node must be an object.';
  if (typeof node.id !== 'string' || node.id.trim().length === 0) return 'Node requires a non-empty id.';
  if (typeof node.name !== 'string') return `Node ${node.id} requires a string name.`;
  if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
    return `Node ${node.id} has non-finite coordinates.`;
  }
  if (!isFiniteNumber(node.width) || node.width < 0 || !isFiniteNumber(node.height) || node.height < 0) {
    return `Node ${node.id} has invalid dimensions (${String(node.width)}x${String(node.height)}).`;
  }
  if (!isFiniteNumber(node.rotation)) {
    return `Node ${node.id} has non-finite rotation.`;
  }
  if (!isFiniteNumber(node.opacity) || node.opacity < 0 || node.opacity > 1) {
    return `Node ${node.id} has out-of-range opacity (${String(node.opacity)}).`;
  }

  if (node.type === 'component-instance') {
    if (node.width <= 0 || node.height <= 0) {
      return `Component instance ${node.id} must have positive dimensions.`;
    }
  } else if (node.type === 'path') {
    if (!Array.isArray(node.points) || node.points.length === 0 || !node.points.every(isValidAnchorPoint)) {
      return `Path node ${node.id} contains invalid vector anchor points.`;
    }
    if (node.subpaths) {
      for (const subpath of node.subpaths) {
        if (!Array.isArray(subpath.points) || subpath.points.length === 0 || !subpath.points.every(isValidAnchorPoint)) {
          return `Path node ${node.id} contains invalid subpath anchor points.`;
        }
      }
    }
    if (!isFiniteNumber(node.style.strokeWidth) || node.style.strokeWidth < 0) {
      return `Path node ${node.id} has invalid strokeWidth.`;
    }
  } else if (node.type === 'text') {
    if (!isFiniteNumber(node.style.fontSize) || node.style.fontSize <= 0) {
      return `Text node ${node.id} has invalid fontSize.`;
    }
    if (!isFiniteNumber(node.style.lineHeight) || node.style.lineHeight <= 0) {
      return `Text node ${node.id} has invalid lineHeight.`;
    }
    if (!isFiniteNumber(node.style.letterSpacing)) {
      return `Text node ${node.id} has non-finite letterSpacing.`;
    }
  } else if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    if (!isFiniteNumber(node.style.strokeWidth) || node.style.strokeWidth < 0) {
      return `Shape node ${node.id} has invalid strokeWidth.`;
    }
    if (node.style.radius !== undefined && (!isFiniteNumber(node.style.radius) || node.style.radius < 0)) {
      return `Shape node ${node.id} has invalid corner radius.`;
    }
  }

  return null;
}

function vectorPointsChanged(a: readonly VectorAnchorPoint[], b: readonly VectorAnchorPoint[]): boolean {
  if (a === b) return false;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (
      pa.id !== pb.id ||
      pa.x !== pb.x ||
      pa.y !== pb.y ||
      pa.pointType !== pb.pointType ||
      pa.handleIn?.x !== pb.handleIn?.x ||
      pa.handleIn?.y !== pb.handleIn?.y ||
      pa.handleOut?.x !== pb.handleOut?.x ||
      pa.handleOut?.y !== pb.handleOut?.y
    ) {
      return true;
    }
  }
  return false;
}

function pathSubpathsChanged(a: PathNode['subpaths'], b: PathNode['subpaths']): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].closed !== b[i].closed || vectorPointsChanged(a[i].points, b[i].points)) {
      return true;
    }
  }
  return false;
}

function nodeContentOrStyleChanged(before: DesignNode, after: DesignNode): boolean {
  if (before.type !== after.type) return true;
  if (
    before.opacity !== after.opacity ||
    before.name !== after.name ||
    before.onCanvas !== after.onCanvas ||
    before.parentId !== after.parentId
  ) {
    return true;
  }

  if (before.type === 'text' && after.type === 'text') {
    return (
      before.text !== after.text ||
      before.style.fill !== after.style.fill ||
      before.style.fontSize !== after.style.fontSize ||
      before.style.fontFamily !== after.style.fontFamily ||
      before.style.fontWeight !== after.style.fontWeight ||
      before.style.lineHeight !== after.style.lineHeight ||
      before.style.letterSpacing !== after.style.letterSpacing
    );
  }

  if (before.type === 'rect' && after.type === 'rect') {
    return (
      before.style.fill !== after.style.fill ||
      before.style.stroke !== after.style.stroke ||
      before.style.strokeWidth !== after.style.strokeWidth ||
      before.style.radius !== after.style.radius
    );
  }

  if (before.type === 'frame' && after.type === 'frame') {
    return (
      before.style.fill !== after.style.fill ||
      before.style.stroke !== after.style.stroke ||
      before.style.strokeWidth !== after.style.strokeWidth ||
      before.style.radius !== after.style.radius ||
      before.clipContent !== after.clipContent
    );
  }

  if (before.type === 'ellipse' && after.type === 'ellipse') {
    return (
      before.style.fill !== after.style.fill ||
      before.style.stroke !== after.style.stroke ||
      before.style.strokeWidth !== after.style.strokeWidth
    );
  }

  if (before.type === 'path' && after.type === 'path') {
    if (
      before.closed !== after.closed ||
      before.style.fill !== after.style.fill ||
      before.style.stroke !== after.style.stroke ||
      before.style.strokeWidth !== after.style.strokeWidth ||
      before.style.strokeDasharray !== after.style.strokeDasharray ||
      before.style.arrowStart !== after.style.arrowStart ||
      before.style.arrowEnd !== after.style.arrowEnd ||
      JSON.stringify(before.shapeMeta) !== JSON.stringify(after.shapeMeta)
    ) {
      return true;
    }
    return vectorPointsChanged(before.points, after.points) || pathSubpathsChanged(before.subpaths, after.subpaths);
  }

  return false;
}

function sealValidatedOperation<TPayload extends ValidatedToolOperationPayload>(
  source: ToolOperation,
  payload: TPayload,
): ValidatedToolOperationEnvelope<TPayload> {
  return {
    [GEOMETRY_ENGINE_SEAL]: true,
    validatedBy: 'geometry-engine',
    protocol: source.protocol,
    version: source.version,
    operationId: source.operationId,
    toolId: source.toolId,
    workspace: source.workspace,
    category: source.category,
    payload,
    metadata: source.metadata,
  };
}

export function hasGeometryEngineSeal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return candidate[GEOMETRY_ENGINE_SEAL] === true && candidate.validatedBy === 'geometry-engine';
}

export function isValidatedToolOperation(value: unknown): value is ValidatedToolOperation {
  if (!hasGeometryEngineSeal(value)) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate.protocol === TOOL_OPERATION_PROTOCOL &&
    candidate.version === TOOL_OPERATION_VERSION &&
    typeof candidate.operationId === 'string' &&
    isCanvasToolId(candidate.toolId) &&
    (candidate.workspace === 'main' || candidate.workspace === 'component') &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}

function mapEnvelopeErrorToGeometryCode(
  code?: ToolOperationValidationErrorCode,
): GeometryRejectionCode {
  switch (code) {
    case 'INVALID_GEOMETRY':
    case 'INVALID_NODE':
    case 'DUPLICATE_NODE_ID':
    case 'EMPTY_OPERATION':
    case 'INVALID_COLOR':
    case 'INVALID_VIEWPORT':
    case 'INVALID_TOOL':
      return code;
    default:
      return 'INVALID_ENVELOPE';
  }
}

/**
 * Pure Geometry Engine gate sitting strictly between Tool Operation Contract
 * and Native Command Engine. Validates geometric invariants, target locks,
 * node existence, duplicate IDs, and zero-delta no-ops, and computes derived
 * mutation payloads (e.g. eyedropper color updates & inline text updates).
 */
export function evaluateToolOperation(
  operation: ToolOperation,
  context: GeometryValidationContext,
): GeometryEvaluationResult {
  const envelopeCheck = validateToolOperationEnvelope(operation);
  if (!envelopeCheck.ok) {
    return {
      status: 'rejected',
      code: mapEnvelopeErrorToGeometryCode(envelopeCheck.code),
      reason: envelopeCheck.error ?? 'Invalid tool operation envelope.',
    };
  }

  const nodes = context.document.nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layerStates = context.effectiveLayerStates ?? getEffectiveLayerStates(nodes);

  switch (operation.payload.kind) {
    case 'create-nodes': {
      const created = operation.payload.nodes;
      if (created.length === 0) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'No nodes were provided to create.' };
      }
      const seenBatchIds = new Set<string>();
      for (const node of created) {
        const geomError = validateNodeGeometry(node);
        if (geomError) {
          return { status: 'rejected', code: 'INVALID_GEOMETRY', reason: geomError };
        }
        if (nodeById.has(node.id) || seenBatchIds.has(node.id)) {
          return {
            status: 'rejected',
            code: 'DUPLICATE_NODE_ID',
            reason: `Cannot create duplicate node id "${node.id}".`,
          };
        }
        seenBatchIds.add(node.id);
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'create-nodes',
          nodes: [...created],
          ...(operation.payload.openInlineTextForNodeId
            ? { openInlineTextForNodeId: operation.payload.openInlineTextForNodeId }
            : {}),
        }) as ValidatedToolOperation,
      };
    }

    case 'transform-nodes': {
      const updated = operation.payload.nodes;
      if (updated.length === 0) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'No nodes were provided to transform.' };
      }

      const beforeList: DesignNode[] = [];
      for (const node of updated) {
        const geomError = validateNodeGeometry(node);
        if (geomError) {
          return { status: 'rejected', code: 'INVALID_GEOMETRY', reason: geomError };
        }
        const existing = nodeById.get(node.id);
        if (!existing) {
          return {
            status: 'rejected',
            code: 'TARGET_NOT_FOUND',
            reason: `Transform target "${node.id}" does not exist in active document.`,
          };
        }
        if (layerStates.get(node.id)?.locked) {
          return {
            status: 'rejected',
            code: 'LOCKED_TARGET',
            reason: `Transform target "${node.id}" is locked.`,
          };
        }
        beforeList.push(existing);
      }

      const geometryChanged = nodesGeometryChanged(beforeList, updated);
      const extendedChanged = beforeList.some((before, index) => nodeContentOrStyleChanged(before, updated[index]));
      if (!geometryChanged && !extendedChanged) {
        return {
          status: 'no-op',
          code: 'ZERO_DELTA_NO_OP',
          reason: 'Transform produced zero geometric or style delta.',
        };
      }

      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'transform-nodes',
          nodes: [...updated],
        }) as ValidatedToolOperation,
      };
    }

    case 'replace-node-with-nodes': {
      const { nodeId, nodes: replacementNodes } = operation.payload;
      if (!nodeId || replacementNodes.length === 0) {
        return { status: 'rejected', code: 'EMPTY_OPERATION', reason: 'Replace-node-with-nodes requires a target nodeId and replacement nodes.' };
      }
      if (!nodeById.has(nodeId)) {
        return { status: 'rejected', code: 'TARGET_NOT_FOUND', reason: `Target node "${nodeId}" does not exist.` };
      }
      if (layerStates.get(nodeId)?.locked) {
        return { status: 'rejected', code: 'LOCKED_TARGET', reason: `Target node "${nodeId}" is locked.` };
      }
      const seenBatchIds = new Set<string>();
      for (const node of replacementNodes) {
        const geomError = validateNodeGeometry(node);
        if (geomError) {
          return { status: 'rejected', code: 'INVALID_GEOMETRY', reason: geomError };
        }
        if ((node.id !== nodeId && nodeById.has(node.id)) || seenBatchIds.has(node.id)) {
          return {
            status: 'rejected',
            code: 'DUPLICATE_NODE_ID',
            reason: `Replacement node id "${node.id}" collides with an existing node.`,
          };
        }
        seenBatchIds.add(node.id);
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'replace-node-with-nodes',
          nodeId,
          nodes: [...replacementNodes],
        }) as ValidatedToolOperation,
      };
    }

    case 'replace-nodes': {
      const { removeIds, insertNodes, selectIds } = operation.payload;
      if (removeIds.length === 0) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'No target nodes were specified for replacement.' };
      }
      const removeSet = new Set(removeIds);
      for (const removeId of removeSet) {
        if (!nodeById.has(removeId)) {
          return { status: 'rejected', code: 'TARGET_NOT_FOUND', reason: `Node "${removeId}" does not exist.` };
        }
        if (layerStates.get(removeId)?.locked) {
          return { status: 'rejected', code: 'LOCKED_TARGET', reason: `Node "${removeId}" is locked.` };
        }
      }
      const seenInsertIds = new Set<string>();
      for (const node of insertNodes) {
        const geomError = validateNodeGeometry(node);
        if (geomError) {
          return { status: 'rejected', code: 'INVALID_GEOMETRY', reason: geomError };
        }
        if ((!removeSet.has(node.id) && nodeById.has(node.id)) || seenInsertIds.has(node.id)) {
          return {
            status: 'rejected',
            code: 'DUPLICATE_NODE_ID',
            reason: `Inserted node id "${node.id}" collides with an existing node.`,
          };
        }
        seenInsertIds.add(node.id);
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'replace-nodes',
          removeIds: [...removeSet],
          insertNodes: [...insertNodes],
          ...(selectIds ? { selectIds: [...selectIds] } : {}),
        }) as ValidatedToolOperation,
      };
    }

    case 'sample-color': {
      const color = operation.payload.color.trim();
      if (!color) {
        return { status: 'rejected', code: 'INVALID_COLOR', reason: 'Sampled color must be a non-empty string.' };
      }
      const colorTarget = operation.payload.target;
      const selectedSet = new Set(context.selectedNodeIds);
      const updatedNodes: DesignNode[] = [];

      for (const node of nodes) {
        if (!selectedSet.has(node.id)) continue;
        if (layerStates.get(node.id)?.locked) continue;

        if (colorTarget === 'stroke') {
          if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
            updatedNodes.push({
              ...node,
              style: {
                ...node.style,
                stroke: color,
                strokeWidth: Math.max(1, node.style.strokeWidth || 0),
              },
            } as DesignNode);
          }
        } else if (
          node.type === 'rect' ||
          node.type === 'ellipse' ||
          node.type === 'frame' ||
          node.type === 'text' ||
          node.type === 'path'
        ) {
          updatedNodes.push({
            ...node,
            style: { ...node.style, fill: color },
          } as DesignNode);
        }
      }

      const sourceName = operation.payload.sourceName || 'canvas';
      const noticeMessage =
        updatedNodes.length > 0
          ? `Sampled ${color.toUpperCase()} (${colorTarget}) from ${sourceName} and applied to ${updatedNodes.length} layer${updatedNodes.length === 1 ? '' : 's'}.`
          : `Sampled ${color.toUpperCase()} from ${sourceName} into active draw ${colorTarget}.`;

      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'sample-color',
          color,
          sourceName,
          target: colorTarget,
          resolvedNodesToUpdate: updatedNodes,
          noticeMessage,
        }) as ValidatedToolOperation,
      };
    }

    case 'commit-inline-text': {
      const { nodeId, text } = operation.payload;
      const existing = nodeById.get(nodeId);
      if (!existing) {
        return { status: 'rejected', code: 'TARGET_NOT_FOUND', reason: `Text node "${nodeId}" does not exist.` };
      }
      if (existing.type !== 'text') {
        return { status: 'rejected', code: 'UNSUPPORTED_TARGET_TYPE', reason: `Node "${nodeId}" is not a text node.` };
      }
      if (layerStates.get(nodeId)?.locked) {
        return { status: 'rejected', code: 'LOCKED_TARGET', reason: `Text node "${nodeId}" is locked.` };
      }
      const normalizedText = text.length > 0 ? text : 'Text';
      if (existing.text === normalizedText) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'Inline text content did not change.' };
      }
      const resolvedNode: TextNode = { ...existing, text: normalizedText };
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'commit-inline-text',
          nodeId,
          text: normalizedText,
          resolvedNode,
        }) as ValidatedToolOperation,
      };
    }

    case 'select-nodes': {
      const seen = new Set<string>();
      const validIds: string[] = [];
      for (const id of operation.payload.nodeIds) {
        if (typeof id === 'string' && nodeById.has(id) && !seen.has(id)) {
          seen.add(id);
          validIds.push(id);
        }
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'select-nodes',
          nodeIds: validIds,
        }) as ValidatedToolOperation,
      };
    }

    case 'viewport-update': {
      const { pan, zoom } = operation.payload;
      if (pan === undefined && zoom === undefined) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'Viewport update contains neither pan nor zoom.' };
      }
      let nextPan: { readonly x: number; readonly y: number } | undefined;
      if (pan !== undefined) {
        if (!isFiniteNumber(pan.x) || !isFiniteNumber(pan.y)) {
          return { status: 'rejected', code: 'INVALID_VIEWPORT', reason: 'Viewport pan must contain finite coordinates.' };
        }
        nextPan = { x: pan.x, y: pan.y };
      }
      let nextZoom: number | undefined;
      if (zoom !== undefined) {
        if (!isFiniteNumber(zoom) || zoom <= 0) {
          return { status: 'rejected', code: 'INVALID_VIEWPORT', reason: 'Viewport zoom must be a finite positive number.' };
        }
        nextZoom = Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, zoom));
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'viewport-update',
          ...(nextPan !== undefined ? { pan: nextPan } : {}),
          ...(nextZoom !== undefined ? { zoom: nextZoom } : {}),
        }) as ValidatedToolOperation,
      };
    }

    case 'switch-tool': {
      if (!isCanvasToolId(operation.payload.nextToolId)) {
        return {
          status: 'rejected',
          code: 'INVALID_TOOL',
          reason: `Unknown target toolId "${String(operation.payload.nextToolId)}".`,
        };
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'switch-tool',
          nextToolId: operation.payload.nextToolId,
        }) as ValidatedToolOperation,
      };
    }

    case 'notify': {
      const message = operation.payload.message.trim();
      if (!message) {
        return { status: 'no-op', code: 'NO_CHANGES', reason: 'Empty notification ignored.' };
      }
      return {
        status: 'ready',
        operation: sealValidatedOperation(operation, {
          kind: 'notify',
          message,
        }) as ValidatedToolOperation,
      };
    }
  }
}

/**
 * Evaluates a sequential batch of Tool Operations emitted by a single Studio Tool
 * transition, projecting created/replaced nodes forward within the batch so
 * follow-up intents (such as selecting newly created nodes) validate accurately.
 */
export function evaluateToolOperationBatch(
  operations: readonly ToolOperation[],
  context: GeometryValidationContext,
): GeometryBatchEvaluationResult {
  const ready: ValidatedToolOperation[] = [];
  const noOps: Array<{ operationId: string; code: 'ZERO_DELTA_NO_OP' | 'NO_CHANGES'; reason: string }> = [];
  const rejected: Array<{ operationId: string; code: GeometryRejectionCode; reason: string }> = [];

  let projectedNodes = [...context.document.nodes];
  let projectedSelection = [...context.selectedNodeIds];

  for (const op of operations) {
    const projectedContext: GeometryValidationContext = {
      document: {
        ...context.document,
        nodes: projectedNodes,
      },
      selectedNodeIds: projectedSelection,
    };

    const result = evaluateToolOperation(op, projectedContext);
    if (result.status === 'ready') {
      ready.push(result.operation);
      const payload = result.operation.payload;
      if (payload.kind === 'create-nodes') {
        projectedNodes = [...projectedNodes, ...payload.nodes];
      } else if (payload.kind === 'transform-nodes') {
        const byId = new Map(payload.nodes.map((node) => [node.id, node]));
        projectedNodes = projectedNodes.map((node) => byId.get(node.id) ?? node);
      } else if (payload.kind === 'replace-node-with-nodes') {
        const nextNodes: DesignNode[] = [];
        for (const node of projectedNodes) {
          if (node.id === payload.nodeId) nextNodes.push(...payload.nodes);
          else nextNodes.push(node);
        }
        projectedNodes = nextNodes;
      } else if (payload.kind === 'replace-nodes') {
        const removeSet = new Set(payload.removeIds);
        projectedNodes = [...projectedNodes.filter((node) => !removeSet.has(node.id)), ...payload.insertNodes];
      } else if (payload.kind === 'commit-inline-text') {
        projectedNodes = projectedNodes.map((node) =>
          node.id === payload.resolvedNode.id ? payload.resolvedNode : node,
        );
      } else if (payload.kind === 'sample-color' && payload.resolvedNodesToUpdate.length > 0) {
        const byId = new Map(payload.resolvedNodesToUpdate.map((node) => [node.id, node]));
        projectedNodes = projectedNodes.map((node) => byId.get(node.id) ?? node);
      } else if (payload.kind === 'select-nodes') {
        projectedSelection = [...payload.nodeIds];
      }
    } else if (result.status === 'no-op') {
      noOps.push({ operationId: op.operationId, code: result.code, reason: result.reason });
    } else {
      rejected.push({ operationId: op.operationId, code: result.code, reason: result.reason });
    }
  }

  return { ready, noOps, rejected };
}

import type {
  DocumentAddress,
  NativeNodeRef,
} from '../document/ast';
import type {
  NativeCommandEnvelope,
  NativeCommandSource,
  NativeCommandTarget,
  NodeSetPropertiesPayload,
  NodeTransformPayload,
} from './types';

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, zone, offsetHour, offsetMinute] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > maxDay) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

export function isDocumentAddress(value: unknown): value is DocumentAddress {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'owner', 'documentId'])) return false;
  if (!isNonEmptyString(value.projectId) || !isNonEmptyString(value.documentId) || !isRecord(value.owner)) return false;
  if (!hasOnlyKeys(value.owner, ['kind', 'id']) || !isNonEmptyString(value.owner.id)) return false;
  return value.owner.kind === 'page' || value.owner.kind === 'component';
}

export function isNativeNodeRef(value: unknown): value is NativeNodeRef {
  return isRecord(value) &&
    hasOnlyKeys(value, ['document', 'nodeId']) &&
    isDocumentAddress(value.document) &&
    isNonEmptyString(value.nodeId);
}

function isNativeCommandSource(value: unknown): value is NativeCommandSource {
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspace', 'actor', 'sessionId', 'correlationId'])) return false;
  const workspaces = ['main', 'component', 'node-logic', 'code', 'system', 'plugin', 'ai-agent'];
  if (!workspaces.includes(String(value.workspace)) || !isRecord(value.actor)) return false;
  const actor = value.actor;
  if (!['user', 'system', 'plugin', 'ai-agent'].includes(String(actor.kind))) return false;
  const actorKeys = actor.kind === 'user' ? ['kind', 'actorId'] : ['kind', 'actorId'];
  if (!hasOnlyKeys(actor, actorKeys)) return false;
  if (actor.kind === 'user') {
    if (actor.actorId !== undefined && !isNonEmptyString(actor.actorId)) return false;
  } else if (!isNonEmptyString(actor.actorId)) {
    return false;
  }
  return (
    (value.sessionId === undefined || isNonEmptyString(value.sessionId)) &&
    (value.correlationId === undefined || isNonEmptyString(value.correlationId))
  );
}

function isNativeCommandTarget(value: unknown): value is NativeCommandTarget {
  if (!isRecord(value)) return false;
  if (value.kind === 'project') {
    return hasOnlyKeys(value, ['kind', 'projectId']) && isNonEmptyString(value.projectId);
  }
  if (value.kind === 'document') {
    return hasOnlyKeys(value, ['kind', 'address']) && isDocumentAddress(value.address);
  }
  if (value.kind === 'node') {
    return hasOnlyKeys(value, ['kind', 'ref']) && isNativeNodeRef(value.ref);
  }
  return false;
}

function invalid<T>(code: string, message: string): ValidationOutcome<T> {
  return { ok: false, code, message };
}

export function validateNativeCommandEnvelope(
  input: unknown,
): ValidationOutcome<NativeCommandEnvelope<string, unknown>> {
  if (!isRecord(input) || !hasOnlyKeys(input, [
    'protocol', 'protocolVersion', 'commandId', 'type', 'commandVersion',
    'issuedAt', 'source', 'target', 'payload', 'preconditions', 'transactionId', 'metadata',
  ])) {
    return invalid('INVALID_ENVELOPE', 'The command envelope is malformed or contains unsupported fields.');
  }
  if (input.protocol !== 'folio.native-command') {
    return invalid('INVALID_ENVELOPE', 'The command protocol is invalid.');
  }
  if (input.protocolVersion !== 1) {
    return invalid('UNSUPPORTED_PROTOCOL', 'This command protocol version is not supported.');
  }
  if (!isUuid(input.commandId) || !isNonEmptyString(input.type) || input.commandVersion !== 1 ||
      !isIsoTimestamp(input.issuedAt) || !isNativeCommandSource(input.source) ||
      !isNativeCommandTarget(input.target) || !('payload' in input)) {
    return invalid('INVALID_ENVELOPE', 'The command envelope is incomplete or invalid.');
  }

  if (input.preconditions !== undefined) {
    if (!isRecord(input.preconditions) || !hasOnlyKeys(input.preconditions, ['expectedProjectRevision']) ||
        (input.preconditions.expectedProjectRevision !== undefined &&
          (!Number.isSafeInteger(input.preconditions.expectedProjectRevision) || Number(input.preconditions.expectedProjectRevision) < 0))) {
      return invalid('INVALID_ENVELOPE', 'The command preconditions are invalid.');
    }
  }
  if (input.transactionId !== undefined && !isNonEmptyString(input.transactionId)) {
    return invalid('INVALID_ENVELOPE', 'The transaction ID is invalid.');
  }
  if (input.metadata !== undefined) {
    if (!isRecord(input.metadata) || !hasOnlyKeys(input.metadata, ['description', 'userGestureId']) ||
        (input.metadata.description !== undefined && typeof input.metadata.description !== 'string') ||
        (input.metadata.userGestureId !== undefined && !isNonEmptyString(input.metadata.userGestureId))) {
      return invalid('INVALID_ENVELOPE', 'The command metadata is invalid.');
    }
  }

  return { ok: true, value: input as unknown as NativeCommandEnvelope<string, unknown> };
}

function hasUniqueNodeRefs(refs: readonly NativeNodeRef[]): boolean {
  const keys = refs.map((ref) => [
    ref.document.projectId,
    ref.document.owner.kind,
    ref.document.owner.id,
    ref.document.documentId,
    ref.nodeId,
  ].join('\u0000'));
  return new Set(keys).size === keys.length;
}

export function validateNodeTransformPayload(value: unknown): ValidationOutcome<NodeTransformPayload> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['nodes']) ||
      !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 100) {
    return invalid('INVALID_PAYLOAD', 'A transform command requires between 1 and 100 node transforms.');
  }

  const nodes: NodeTransformPayload['nodes'] = [];
  for (const entry of value.nodes) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['ref', 'transform']) ||
        !isNativeNodeRef(entry.ref) || !isRecord(entry.transform)) {
      return invalid('INVALID_PAYLOAD', 'Each transform entry requires a complete node reference and transform object.');
    }
    const transform = entry.transform;
    const allowed = ['x', 'y', 'width', 'height', 'rotation', 'onCanvas'];
    const keys = Object.keys(transform);
    if (keys.length === 0 || !hasOnlyKeys(transform, allowed)) {
      return invalid('INVALID_PAYLOAD', 'The transform contains no supported fields or contains an unsupported field.');
    }
    for (const key of ['x', 'y', 'width', 'height', 'rotation']) {
      if (transform[key] !== undefined &&
          (typeof transform[key] !== 'number' || !Number.isFinite(transform[key]))) {
        return invalid('INVALID_PAYLOAD', 'Transform geometry must contain finite numbers.');
      }
    }
    if ((transform.width !== undefined && Number(transform.width) <= 0) ||
        (transform.height !== undefined && Number(transform.height) <= 0) ||
        (transform.onCanvas !== undefined && typeof transform.onCanvas !== 'boolean')) {
      return invalid('INVALID_PAYLOAD', 'Transform dimensions must be positive and Canvas placement must be boolean.');
    }
    nodes.push({ ref: entry.ref, transform: transform as NodeTransformPayload['nodes'][number]['transform'] });
  }
  if (!hasUniqueNodeRefs(nodes.map((item) => item.ref))) {
    return invalid('INVALID_REFERENCE', 'A node may appear only once in one transform command.');
  }
  return { ok: true, value: { nodes } };
}

export function validateNodeSetPropertiesPayload(value: unknown): ValidationOutcome<NodeSetPropertiesPayload> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['nodes', 'properties']) ||
      !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 100 ||
      !isRecord(value.properties)) {
    return invalid('INVALID_PAYLOAD', 'A property command requires node references and an explicit property object.');
  }
  const properties = value.properties;
  const keys = Object.keys(properties);
  if (keys.length === 0 || !hasOnlyKeys(properties, ['visible', 'locked', 'layerColor'])) {
    return invalid('INVALID_PAYLOAD', 'Only visible, locked and layerColor may be changed by this command.');
  }
  if ((properties.visible !== undefined && typeof properties.visible !== 'boolean') ||
      (properties.locked !== undefined && typeof properties.locked !== 'boolean') ||
      (properties.layerColor !== undefined && properties.layerColor !== null &&
        (typeof properties.layerColor !== 'string' || properties.layerColor.length > 128))) {
    return invalid('INVALID_PAYLOAD', 'The requested node properties contain an invalid value.');
  }

  const nodes: NativeNodeRef[] = [];
  for (const ref of value.nodes) {
    if (!isNativeNodeRef(ref)) return invalid('INVALID_REFERENCE', 'Every property target must be a complete node reference.');
    nodes.push(ref);
  }
  if (!hasUniqueNodeRefs(nodes)) {
    return invalid('INVALID_REFERENCE', 'A node may appear only once in one property command.');
  }
  return { ok: true, value: { nodes, properties: properties as NodeSetPropertiesPayload['properties'] } };
}

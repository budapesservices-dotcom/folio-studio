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

const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Object.prototype));
const STANDARD_ARRAY_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Array.prototype));

/** Limits apply to one input graph: depth 64, 4,096 object/array nodes, 16,384 own properties,
 * 4,096 aggregate dense array elements and 1,000 elements per array. Shared identities are rejected.
 */
export const NATIVE_COMMAND_RUNTIME_LIMITS = Object.freeze({
  maxDepth: 64, maxObjects: 4096, maxProperties: 16384, maxArrayElements: 4096, maxArrayLength: 1000,
});
type RuntimeCloneResult = { ok: true; value: unknown } | { ok: false };
interface RuntimeCloneBudget {
  readonly memo: WeakMap<object, unknown>;
  readonly active: WeakSet<object>;
  objects: number;
  properties: number;
  arrayElements: number;
}
function cloneRuntimeData(
  value: unknown,
  budget: RuntimeCloneBudget = {
    memo: new WeakMap<object, unknown>(), active: new WeakSet<object>(),
    objects: 0, properties: 0, arrayElements: 0,
  },
  depth = 0,
): RuntimeCloneResult {
  if (depth > NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth) return { ok: false };
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return { ok: true, value };
  if (typeof value !== 'object') return { ok: false };
  try {
    if (budget.active.has(value)) return { ok: false };
    const memoized = budget.memo.get(value);
    if (memoized !== undefined) return { ok: true, value: memoized };
    budget.active.add(value); budget.objects += 1;
    if (budget.objects > NATIVE_COMMAND_RUNTIME_LIMITS.maxObjects) return { ok: false };
    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Array.prototype || Reflect.ownKeys(prototype).some((key) => !STANDARD_ARRAY_PROTOTYPE_KEYS.has(key))) return { ok: false };
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.enumerable ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          lengthDescriptor.value > NATIVE_COMMAND_RUNTIME_LIMITS.maxArrayLength ||
          keys.length !== lengthDescriptor.value + 1) return { ok: false };
      budget.arrayElements += lengthDescriptor.value;
      budget.properties += lengthDescriptor.value;
      if (budget.arrayElements > NATIVE_COMMAND_RUNTIME_LIMITS.maxArrayElements || budget.properties > NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties) return { ok: false };
      const output: unknown[] = new Array(lengthDescriptor.value);
      budget.memo.set(value, output);
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return { ok: false };
        const child = cloneRuntimeData(descriptor.value, budget, depth + 1);
        if (!child.ok) return { ok: false };
        output[index] = child.value;
      }
      return { ok: true, value: output };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return { ok: false };
    if (prototype === Object.prototype && Reflect.ownKeys(prototype).some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) return { ok: false };
    const keys = Reflect.ownKeys(value);
    budget.properties += keys.length;
    if (budget.properties > NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties) return { ok: false };
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    budget.memo.set(value, output);
    for (const key of keys) {
      if (typeof key !== 'string') return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return { ok: false };
      const child = cloneRuntimeData(descriptor.value, budget, depth + 1);
      if (!child.ok) return { ok: false };
      output[key] = child.value;
    }
    return { ok: true, value: output };
  } catch {
    return { ok: false };
  } finally { budget.active.delete(value); }
}
export function isRuntimeCommandDataWithinLimits(value: unknown): boolean {
  return cloneRuntimeData(value).ok;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return false;
    if (prototype === Object.prototype &&
        Reflect.ownKeys(prototype).some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) {
      return false;
    }
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor && descriptor.enumerable && 'value' in descriptor);
    });
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key));
  } catch {
    return false;
  }
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

function isDocumentAddressData(value: unknown): value is DocumentAddress {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'owner', 'documentId'])) return false;
  if (!isNonEmptyString(value.projectId) || !isNonEmptyString(value.documentId) || !isRecord(value.owner)) return false;
  if (!hasOnlyKeys(value.owner, ['kind', 'id']) || !isNonEmptyString(value.owner.id)) return false;
  return value.owner.kind === 'page' || value.owner.kind === 'component';
}

function isNativeNodeRefData(value: unknown): value is NativeNodeRef {
  return isRecord(value) &&
    hasOnlyKeys(value, ['document', 'nodeId']) &&
    isDocumentAddressData(value.document) &&
    isNonEmptyString(value.nodeId);
}

export function isDocumentAddress(value: unknown): value is DocumentAddress {
  const normalized = cloneRuntimeData(value);
  return normalized.ok && isDocumentAddressData(normalized.value);
}

export function isNativeNodeRef(value: unknown): value is NativeNodeRef {
  const normalized = cloneRuntimeData(value);
  return normalized.ok && isNativeNodeRefData(normalized.value);
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
    return hasOnlyKeys(value, ['kind', 'address']) && isDocumentAddressData(value.address);
  }
  if (value.kind === 'node') {
    return hasOnlyKeys(value, ['kind', 'ref']) && isNativeNodeRefData(value.ref);
  }
  return false;
}

function invalid<T>(code: string, message: string): ValidationOutcome<T> {
  return { ok: false, code, message };
}

export function validateNativeCommandEnvelope(
  input: unknown,
): ValidationOutcome<NativeCommandEnvelope<string, unknown>> {
  const normalized = cloneRuntimeData(input);
  if (!normalized.ok) {
    return invalid('INVALID_ENVELOPE', 'The command must contain only plain own data properties.');
  }
  return validateNativeCommandEnvelopeData(normalized.value);
}

function validateNativeCommandEnvelopeData(
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
  if (!isUuid(input.commandId) || !isNonEmptyString(input.type) || !Number.isSafeInteger(input.commandVersion) || Number(input.commandVersion) < 1 ||
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
        (input.metadata.description !== undefined && (typeof input.metadata.description !== 'string' || input.metadata.description.length > 1024)) ||
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

export function validateNodeTransformPayload(
  value: unknown,
): ValidationOutcome<NodeTransformPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  return validateNodeTransformPayloadData(normalized.value);
}

function validateNodeTransformPayloadData(value: unknown): ValidationOutcome<NodeTransformPayload> {
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

export function validateNodeSetPropertiesPayload(
  value: unknown,
): ValidationOutcome<NodeSetPropertiesPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  return validateNodeSetPropertiesPayloadData(normalized.value);
}

function validateNodeSetPropertiesPayloadData(value: unknown): ValidationOutcome<NodeSetPropertiesPayload> {
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

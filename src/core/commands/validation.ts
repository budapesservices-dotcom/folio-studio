import type {
  DocumentAddress,
  NativeNodeRef,
} from '../document/ast';
import type { LayerDropPosition } from '../document/layers';
import type {
  ComponentDefinition,
  DesignNode,
  FolioDocument,
  FolioPage,
  FolioProject,
} from '../document/types';
import { isBlendMode, isFillPaint, isVisualEffect } from '../document/styling';
import {
  SEMANTIC_HTML_TAGS,
  isAnimationClip,
  isCodeModuleList,
  isComponentSlotsList,
  isComponentVariantsList,
  isDesignTokenCollection,
  isLogicGraph,
  isNodeLayoutChildConfig,
  isNodeLayoutConfig,
  isNodeTokenBindings,
  isResponsiveOverrides,
  validateProject,
} from '../document/validation';
import type {
  AnimationCreateClipPayload,
  AnimationDeleteClipPayload,
  AnimationUpdateClipPayload,
  AssetUpsertPayload,
  CodeUpdateModulesPayload,
  ComponentCreatePayload,
  ComponentDeletePayload,
  ComponentRenamePayload,
  ComponentSyncDocumentPayload,
  ComponentUpdateContractPayload,
  HistoryCommitEditPayload,
  HistoryRedoPayload,
  HistoryUndoPayload,
  LayerClippingMaskPayload,
  LayerGroupPayload,
  LayerMoveManyPayload,
  LayerMovePayload,
  LayerUngroupPayload,
  LogicCreateGraphPayload,
  LogicDeleteGraphPayload,
  LogicUpdateGraphPayload,
  NativeCommandEnvelope,
  NativeCommandSource,
  NativeCommandTarget,
  NodeCreatePayload,
  NodeDeletePayload,
  NodeEditPayload,
  NodeRenamePayload,
  NodeReplaceManyPayload,
  NodeReplacePayload,
  NodeSetCanvasStatePayload,
  NodeSetPropertiesPayload,
  NodeSplitPayload,
  NodeTransformPayload,
  NodeUpdateManyPayload,
  PageCreatePayload,
  PageSetActivePayload,
  ProjectRenamePayload,
  ProjectReplacePayload,
  SelectionSetPayload,
  TokensUpdatePayload,
} from './types';

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Object.prototype));
const STANDARD_ARRAY_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Array.prototype));

/** Limits apply to one input graph: depth 64, 4,096 object/array nodes, 16,384 own properties,
 * 4,096 aggregate dense array elements and 1,000 elements per array. Shared objects are cloned once,
 * but every traversal path is checked against the cached object's maximum remaining depth.
 */
export const NATIVE_COMMAND_RUNTIME_LIMITS = Object.freeze({
  maxDepth: 64, maxObjects: 4096, maxProperties: 16384, maxArrayElements: 4096, maxArrayLength: 1000,
});
type RuntimeCloneResult = { ok: true; value: unknown; height: number } | { ok: false };
interface RuntimeCloneBudget {
  readonly memo: WeakMap<object, unknown>;
  readonly heights: WeakMap<object, number>;
  readonly active: WeakSet<object>;
  objects: number;
  properties: number;
  arrayElements: number;
}
function cloneRuntimeData(
  value: unknown,
  budget: RuntimeCloneBudget = {
    memo: new WeakMap<object, unknown>(), heights: new WeakMap<object, number>(),
    active: new WeakSet<object>(), objects: 0, properties: 0, arrayElements: 0,
  },
  depth = 0,
): RuntimeCloneResult {
  if (depth > NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth) return { ok: false };
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return { ok: true, value, height: 0 };
  }
  if (typeof value !== 'object') return { ok: false };
  try {
    if (budget.active.has(value)) return { ok: false };
    const memoized = budget.memo.get(value);
    if (memoized !== undefined) {
      const height = budget.heights.get(value);
      if (height === undefined || depth + height > NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth) return { ok: false };
      return { ok: true, value: memoized, height };
    }
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
      let height = 0;
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return { ok: false };
        const child = cloneRuntimeData(descriptor.value, budget, depth + 1);
        if (!child.ok) return { ok: false };
        height = Math.max(height, child.height + 1);
        output[index] = child.value;
      }
      budget.heights.set(value, height);
      return { ok: true, value: output, height };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return { ok: false };
    if (prototype === Object.prototype && Reflect.ownKeys(prototype).some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) return { ok: false };
    const keys = Reflect.ownKeys(value);
    budget.properties += keys.length;
    if (budget.properties > NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties) return { ok: false };
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    budget.memo.set(value, output);
    let height = 0;
    for (const key of keys) {
      if (typeof key !== 'string') return { ok: false };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return { ok: false };
      const child = cloneRuntimeData(descriptor.value, budget, depth + 1);
      if (!child.ok) return { ok: false };
      height = Math.max(height, child.height + 1);
      output[key] = child.value;
    }
    budget.heights.set(value, height);
    return { ok: true, value: output, height };
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
  const actorKeys = ['kind', 'actorId'];
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

function nodeRefKey(ref: NativeNodeRef): string {
  return [
    ref.document.projectId,
    ref.document.owner.kind,
    ref.document.owner.id,
    ref.document.documentId,
    ref.nodeId,
  ].join('\u0000');
}

function hasUniqueNodeRefs(refs: readonly NativeNodeRef[]): boolean {
  return new Set(refs.map(nodeRefKey)).size === refs.length;
}

function isLayerDropPosition(value: unknown): value is LayerDropPosition {
  return value === 'before' || value === 'inside' || value === 'after';
}

const COMMON_NODE_KEYS = [
  'id', 'name', 'type', 'x', 'y', 'width', 'height', 'rotation',
  'opacity', 'blendMode', 'effects', 'visible', 'locked', 'layerColor', 'parentId', 'onCanvas', 'clipMaskBaseId',
  'semanticTag', 'ariaLabel', 'href', 'layout', 'layoutChild', 'responsive', 'tokenBindings',
] as const;

const TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right']);
const TEXT_WRAP_VALUES = new Set(['wrap', 'nowrap']);
const TEXT_TRANSFORM_VALUES = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const TEXT_DECORATION_VALUES = new Set(['none', 'underline', 'line-through']);
const IMAGE_FIT_VALUES = new Set(['cover', 'contain', 'fill']);
const ASSET_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function isValidFillsList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 16 && value.every(isFillPaint);
}

function isValidEffectsList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 16 && value.every(isVisualEffect);
}

function isDesignNodeData(value: unknown): value is DesignNode {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    typeof value.name !== 'string' || value.name.length > 512 ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) || value.width < 0 ||
    !isFiniteNumber(value.height) || value.height < 0 ||
    !isFiniteNumber(value.rotation) ||
    !isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1 ||
    (value.blendMode !== undefined && !isBlendMode(value.blendMode)) ||
    (value.effects !== undefined && !isValidEffectsList(value.effects)) ||
    typeof value.visible !== 'boolean' ||
    typeof value.locked !== 'boolean' ||
    (value.layerColor !== undefined && (typeof value.layerColor !== 'string' || value.layerColor.length > 128)) ||
    (value.onCanvas !== undefined && typeof value.onCanvas !== 'boolean') ||
    (value.parentId !== undefined && value.parentId !== null && !isNonEmptyString(value.parentId)) ||
    (value.clipMaskBaseId !== undefined && !isNonEmptyString(value.clipMaskBaseId)) ||
    (value.semanticTag !== undefined && !SEMANTIC_HTML_TAGS.has(String(value.semanticTag))) ||
    (value.ariaLabel !== undefined && (typeof value.ariaLabel !== 'string' || value.ariaLabel.length > 512)) ||
    (value.href !== undefined && (typeof value.href !== 'string' || value.href.length > 2048)) ||
    (value.layout !== undefined && !isNodeLayoutConfig(value.layout)) ||
    (value.layoutChild !== undefined && !isNodeLayoutChildConfig(value.layoutChild)) ||
    (value.responsive !== undefined && !isResponsiveOverrides(value.responsive)) ||
    (value.tokenBindings !== undefined && !isNodeTokenBindings(value.tokenBindings))
  ) {
    return false;
  }

  if (value.type === 'group') {
    return hasOnlyKeys(value, COMMON_NODE_KEYS);
  }

  if (value.type === 'frame') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'style', 'clipContent', 'isSection']) || !isRecord(value.style)) {
      return false;
    }
    const style = value.style;
    if (!hasOnlyKeys(style, ['fill', 'fills', 'stroke', 'strokeWidth', 'radius'])) return false;
    return (
      typeof style.fill === 'string' && style.fill.length <= 128 &&
      (style.fills === undefined || isValidFillsList(style.fills)) &&
      typeof style.stroke === 'string' && style.stroke.length <= 128 &&
      isFiniteNumber(style.strokeWidth) && style.strokeWidth >= 0 &&
      (style.radius === undefined || (isFiniteNumber(style.radius) && style.radius >= 0)) &&
      (value.clipContent === undefined || typeof value.clipContent === 'boolean') &&
      (value.isSection === undefined || typeof value.isSection === 'boolean')
    );
  }

  if (value.type === 'rect' || value.type === 'ellipse') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'style']) || !isRecord(value.style)) return false;
    const style = value.style;
    if (!hasOnlyKeys(style, ['fill', 'fills', 'stroke', 'strokeWidth', 'radius'])) return false;
    return (
      typeof style.fill === 'string' && style.fill.length <= 128 &&
      (style.fills === undefined || isValidFillsList(style.fills)) &&
      typeof style.stroke === 'string' && style.stroke.length <= 128 &&
      isFiniteNumber(style.strokeWidth) && style.strokeWidth >= 0 &&
      (style.radius === undefined || (isFiniteNumber(style.radius) && style.radius >= 0))
    );
  }

  if (value.type === 'path') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'points', 'closed', 'style', 'pathKind', 'subpaths', 'shapeMeta'])) return false;
    if (!isRecord(value.style) || !Array.isArray(value.points) || value.points.length === 0 || value.points.length > 500) {
      return false;
    }
    if (typeof value.closed !== 'boolean') return false;
    const isHandle = (h: unknown): boolean =>
      isRecord(h) && hasOnlyKeys(h, ['x', 'y']) && isFiniteNumber(h.x) && isFiniteNumber(h.y);
    const isAnchor = (pt: unknown): boolean =>
      isRecord(pt) &&
      hasOnlyKeys(pt, ['id', 'x', 'y', 'handleIn', 'handleOut', 'pointType']) &&
      isNonEmptyString(pt.id) &&
      isFiniteNumber(pt.x) &&
      isFiniteNumber(pt.y) &&
      (pt.handleIn === undefined || isHandle(pt.handleIn)) &&
      (pt.handleOut === undefined || isHandle(pt.handleOut)) &&
      (pt.pointType === 'corner' || pt.pointType === 'smooth' || pt.pointType === 'symmetric');

    if (!value.points.every(isAnchor)) return false;
    if (value.subpaths !== undefined) {
      if (!Array.isArray(value.subpaths) || value.subpaths.length > 64) return false;
      const validSubpaths = value.subpaths.every((sp) =>
        isRecord(sp) &&
        hasOnlyKeys(sp, ['points', 'closed']) &&
        typeof sp.closed === 'boolean' &&
        Array.isArray(sp.points) && sp.points.length > 0 && sp.points.length <= 500 &&
        sp.points.every(isAnchor),
      );
      if (!validSubpaths) return false;
    }
    if (value.pathKind !== undefined &&
      !['pen', 'curvature', 'pencil', 'line', 'arrow', 'polygon', 'star', 'boolean', 'outline'].includes(String(value.pathKind))) {
      return false;
    }
    if (value.shapeMeta !== undefined) {
      if (!isRecord(value.shapeMeta)) return false;
      if (value.shapeMeta.kind === 'polygon') {
        if (
          !hasOnlyKeys(value.shapeMeta, ['kind', 'sides']) ||
          !isFiniteNumber(value.shapeMeta.sides) ||
          !Number.isInteger(value.shapeMeta.sides) ||
          value.shapeMeta.sides < 3 ||
          value.shapeMeta.sides > 32
        ) {
          return false;
        }
      } else if (value.shapeMeta.kind === 'star') {
        if (
          !hasOnlyKeys(value.shapeMeta, ['kind', 'spikes', 'innerRatio']) ||
          !isFiniteNumber(value.shapeMeta.spikes) ||
          !Number.isInteger(value.shapeMeta.spikes) ||
          value.shapeMeta.spikes < 3 ||
          value.shapeMeta.spikes > 32 ||
          !isFiniteNumber(value.shapeMeta.innerRatio) ||
          value.shapeMeta.innerRatio < 0.1 ||
          value.shapeMeta.innerRatio > 0.95
        ) {
          return false;
        }
      } else {
        return false;
      }
    }
    const style = value.style;
    if (!hasOnlyKeys(style, [
      'fill', 'fills', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
      'strokeDasharray', 'fillRule', 'arrowStart', 'arrowEnd',
    ])) return false;
    return (
      typeof style.fill === 'string' && style.fill.length <= 128 &&
      (style.fills === undefined || isValidFillsList(style.fills)) &&
      typeof style.stroke === 'string' && style.stroke.length <= 128 &&
      isFiniteNumber(style.strokeWidth) && style.strokeWidth >= 0 &&
      (style.strokeLinecap === undefined || ['butt', 'round', 'square'].includes(String(style.strokeLinecap))) &&
      (style.strokeLinejoin === undefined || ['miter', 'round', 'bevel'].includes(String(style.strokeLinejoin))) &&
      (style.strokeDasharray === undefined || (typeof style.strokeDasharray === 'string' && style.strokeDasharray.length <= 128)) &&
      (style.fillRule === undefined || style.fillRule === 'nonzero' || style.fillRule === 'evenodd') &&
      (style.arrowStart === undefined || typeof style.arrowStart === 'boolean') &&
      (style.arrowEnd === undefined || typeof style.arrowEnd === 'boolean')
    );
  }

  if (value.type === 'text') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'text', 'style']) || !isRecord(value.style)) return false;
    if (typeof value.text !== 'string' || value.text.length > 10000) return false;
    const style = value.style;
    if (!hasOnlyKeys(style, [
      'fill', 'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'lineHeight',
      'textAlign', 'textWrap', 'textTransform', 'textDecoration',
    ])) return false;
    return (
      typeof style.fill === 'string' && style.fill.length <= 128 &&
      isFiniteNumber(style.fontSize) && style.fontSize > 0 &&
      typeof style.fontFamily === 'string' && style.fontFamily.length <= 256 &&
      isFiniteNumber(style.fontWeight) &&
      isFiniteNumber(style.letterSpacing) &&
      isFiniteNumber(style.lineHeight) && style.lineHeight > 0 &&
      (style.textAlign === undefined || TEXT_ALIGN_VALUES.has(String(style.textAlign))) &&
      (style.textWrap === undefined || TEXT_WRAP_VALUES.has(String(style.textWrap))) &&
      (style.textTransform === undefined || TEXT_TRANSFORM_VALUES.has(String(style.textTransform))) &&
      (style.textDecoration === undefined || TEXT_DECORATION_VALUES.has(String(style.textDecoration)))
    );
  }

  if (value.type === 'image') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'assetId', 'alt', 'naturalWidth', 'naturalHeight', 'style']) || !isRecord(value.style)) {
      return false;
    }
    if (!isNonEmptyString(value.assetId, 256)) return false;
    if (value.alt !== undefined && (typeof value.alt !== 'string' || value.alt.length > 512)) return false;
    if (value.naturalWidth !== undefined && (!isFiniteNumber(value.naturalWidth) || value.naturalWidth <= 0)) return false;
    if (value.naturalHeight !== undefined && (!isFiniteNumber(value.naturalHeight) || value.naturalHeight <= 0)) return false;
    const style = value.style;
    if (!hasOnlyKeys(style, ['fit', 'radius', 'stroke', 'strokeWidth'])) return false;
    return (
      IMAGE_FIT_VALUES.has(String(style.fit)) &&
      (style.radius === undefined || (isFiniteNumber(style.radius) && style.radius >= 0)) &&
      (style.stroke === undefined || (typeof style.stroke === 'string' && style.stroke.length <= 128)) &&
      (style.strokeWidth === undefined || (isFiniteNumber(style.strokeWidth) && style.strokeWidth >= 0))
    );
  }

  if (value.type === 'component-instance') {
    if (!hasOnlyKeys(value, [...COMMON_NODE_KEYS, 'componentId', 'overrides', 'variantSelection', 'slotAssignments'])) return false;
    if (!isNonEmptyString(value.componentId) || !isRecord(value.overrides)) return false;
    if (value.width <= 0 || value.height <= 0) return false;
    const validOverrides = Object.entries(value.overrides).every(([childId, override]) =>
      isNonEmptyString(childId) &&
      isRecord(override) &&
      hasOnlyKeys(override, ['fill', 'text']) &&
      (override.fill === undefined || (typeof override.fill === 'string' && override.fill.length <= 128)) &&
      (override.text === undefined || (typeof override.text === 'string' && override.text.length <= 10000)),
    );
    if (!validOverrides) return false;
    if (value.variantSelection !== undefined) {
      if (!isRecord(value.variantSelection)) return false;
      const validSelection = Object.entries(value.variantSelection).every(([axisId, optionId]) =>
        isNonEmptyString(axisId) && isNonEmptyString(optionId),
      );
      if (!validSelection) return false;
    }
    if (value.slotAssignments !== undefined) {
      if (!isRecord(value.slotAssignments)) return false;
      const validSlots = Object.entries(value.slotAssignments).every(([slotId, assignment]) =>
        isNonEmptyString(slotId) &&
        isRecord(assignment) &&
        hasOnlyKeys(assignment, ['text', 'fill', 'visible']) &&
        (assignment.text === undefined || (typeof assignment.text === 'string' && assignment.text.length <= 10000)) &&
        (assignment.fill === undefined || (typeof assignment.fill === 'string' && assignment.fill.length <= 128)) &&
        (assignment.visible === undefined || typeof assignment.visible === 'boolean'),
      );
      if (!validSlots) return false;
    }
    return true;
  }

  return false;
}

function validateUniqueNodeRefList(
  value: unknown,
  label: string,
): ValidationOutcome<NativeNodeRef[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return invalid('INVALID_PAYLOAD', `${label} requires between 1 and 100 node references.`);
  }
  const refs: NativeNodeRef[] = [];
  for (const ref of value) {
    if (!isNativeNodeRefData(ref)) {
      return invalid('INVALID_REFERENCE', 'Every target must be a complete node reference.');
    }
    refs.push(ref);
  }
  if (!hasUniqueNodeRefs(refs)) {
    return invalid('INVALID_REFERENCE', 'A node may appear only once in one command.');
  }
  return { ok: true, value: refs };
}

export function validateProjectRenamePayload(
  value: unknown,
): ValidationOutcome<ProjectRenamePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['name']) || !isNonEmptyString(data.name)) {
    return invalid('INVALID_PAYLOAD', 'Project rename requires a non-empty project name.');
  }
  return { ok: true, value: { name: data.name.trim() } };
}

export function validateNodeCreatePayload(
  value: unknown,
): ValidationOutcome<NodeCreatePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes']) ||
      !Array.isArray(data.nodes) || data.nodes.length === 0 || data.nodes.length > 100) {
    return invalid('INVALID_PAYLOAD', 'Node creation requires between 1 and 100 valid nodes.');
  }
  const nodes: DesignNode[] = [];
  const seenIds = new Set<string>();
  for (const entry of data.nodes) {
    if (!isDesignNodeData(entry)) {
      return invalid('INVALID_PAYLOAD', 'One or more created nodes do not match the Folio node schema.');
    }
    if (seenIds.has(entry.id)) {
      return invalid('INVALID_REFERENCE', 'Created nodes in one command must have unique IDs.');
    }
    seenIds.add(entry.id);
    nodes.push(entry);
  }
  return { ok: true, value: { nodes } };
}

export function validateNodeReplacePayload(
  value: unknown,
): ValidationOutcome<NodeReplacePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['node']) || !isDesignNodeData(data.node)) {
    return invalid('INVALID_PAYLOAD', 'Node replacement requires a complete valid Folio node.');
  }
  return { ok: true, value: { node: data.node } };
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
        !isNativeNodeRefData(entry.ref) || !isRecord(entry.transform)) {
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
    if (!isNativeNodeRefData(ref)) return invalid('INVALID_REFERENCE', 'Every property target must be a complete node reference.');
    nodes.push(ref);
  }
  if (!hasUniqueNodeRefs(nodes)) {
    return invalid('INVALID_REFERENCE', 'A node may appear only once in one property command.');
  }
  return { ok: true, value: { nodes, properties: properties as NodeSetPropertiesPayload['properties'] } };
}

export function validateNodeRenamePayload(
  value: unknown,
): ValidationOutcome<NodeRenamePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['updates']) ||
      !Array.isArray(data.updates) || data.updates.length === 0 || data.updates.length > 100) {
    return invalid('INVALID_PAYLOAD', 'A rename command requires between 1 and 100 node updates.');
  }
  const updates: NodeRenamePayload['updates'] = [];
  for (const entry of data.updates) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['ref', 'name']) ||
        !isNativeNodeRefData(entry.ref) || !isNonEmptyString(entry.name)) {
      return invalid('INVALID_PAYLOAD', 'Each rename entry requires a valid node reference and non-empty name.');
    }
    updates.push({ ref: entry.ref, name: entry.name.trim() });
  }
  if (!hasUniqueNodeRefs(updates.map((item) => item.ref))) {
    return invalid('INVALID_REFERENCE', 'A node may appear only once in one rename command.');
  }
  return { ok: true, value: { updates } };
}

export function validateNodeDeletePayload(
  value: unknown,
): ValidationOutcome<NodeDeletePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes'])) {
    return invalid('INVALID_PAYLOAD', 'A delete command requires explicit node references.');
  }
  const refs = validateUniqueNodeRefList(data.nodes, 'A delete command');
  if (!refs.ok) return refs;
  return { ok: true, value: { nodes: refs.value } };
}

export function validateNodeSetCanvasStatePayload(
  value: unknown,
): ValidationOutcome<NodeSetCanvasStatePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes', 'onCanvas']) || typeof data.onCanvas !== 'boolean') {
    return invalid('INVALID_PAYLOAD', 'A canvas-state command requires node references and a boolean onCanvas flag.');
  }
  const refs = validateUniqueNodeRefList(data.nodes, 'A canvas-state command');
  if (!refs.ok) return refs;
  return { ok: true, value: { nodes: refs.value, onCanvas: data.onCanvas } };
}

export function validateLayerMovePayload(
  value: unknown,
): ValidationOutcome<LayerMovePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['node', 'target', 'position']) ||
      !isNativeNodeRefData(data.node) || !isNativeNodeRefData(data.target) || !isLayerDropPosition(data.position)) {
    return invalid('INVALID_PAYLOAD', 'A layer move command requires node, target and drop position.');
  }
  if (nodeRefKey(data.node) === nodeRefKey(data.target)) {
    return invalid('INVALID_REFERENCE', 'A layer cannot be moved relative to itself.');
  }
  return { ok: true, value: { node: data.node, target: data.target, position: data.position } };
}

export function validateLayerMoveManyPayload(
  value: unknown,
): ValidationOutcome<LayerMoveManyPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes', 'target', 'position']) ||
      !isNativeNodeRefData(data.target) || !isLayerDropPosition(data.position)) {
    return invalid('INVALID_PAYLOAD', 'A multi-layer move command requires nodes, target and drop position.');
  }
  const refs = validateUniqueNodeRefList(data.nodes, 'A multi-layer move command');
  if (!refs.ok) return refs;
  return { ok: true, value: { nodes: refs.value, target: data.target, position: data.position } };
}

export function validateLayerGroupPayload(
  value: unknown,
): ValidationOutcome<LayerGroupPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes'])) {
    return invalid('INVALID_PAYLOAD', 'A group command requires explicit node references.');
  }
  const refs = validateUniqueNodeRefList(data.nodes, 'A group command');
  if (!refs.ok) return refs;
  return { ok: true, value: { nodes: refs.value } };
}

export function validateLayerUngroupPayload(
  value: unknown,
): ValidationOutcome<LayerUngroupPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['nodes'])) {
    return invalid('INVALID_PAYLOAD', 'An ungroup command requires explicit node references.');
  }
  const refs = validateUniqueNodeRefList(data.nodes, 'An ungroup command');
  if (!refs.ok) return refs;
  return { ok: true, value: { nodes: refs.value } };
}

export function validateLayerClippingMaskPayload(
  value: unknown,
): ValidationOutcome<LayerClippingMaskPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['node']) || !isNativeNodeRefData(data.node)) {
    return invalid('INVALID_PAYLOAD', 'A clipping mask command requires a single complete node reference.');
  }
  return { ok: true, value: { node: data.node } };
}

function isFolioDocumentData(value: unknown): value is FolioDocument {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'width', 'height', 'background', 'nodes'])) {
    return false;
  }
  if (
    !isNonEmptyString(value.id) ||
    typeof value.name !== 'string' || value.name.length > 512 ||
    !isFiniteNumber(value.width) || value.width <= 0 ||
    !isFiniteNumber(value.height) || value.height <= 0 ||
    typeof value.background !== 'string' || value.background.length > 128 ||
    !Array.isArray(value.nodes)
  ) {
    return false;
  }
  const seenIds = new Set<string>();
  for (const node of value.nodes) {
    if (!isDesignNodeData(node) || seenIds.has(node.id)) return false;
    seenIds.add(node.id);
  }
  return true;
}

function isFolioPageData(value: unknown): value is FolioPage {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'route', 'document'])) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name, 512) &&
    isNonEmptyString(value.route, 512) &&
    isFolioDocumentData(value.document)
  );
}

function isComponentDefinitionData(value: unknown): value is ComponentDefinition {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'document', 'createdAt', 'updatedAt', 'variants', 'slots'])) {
    return false;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name, 512) ||
    !isFolioDocumentData(value.document) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return false;
  }
  const masterNodesById = new Map(value.document.nodes.map((node) => [node.id, node]));
  if (value.variants !== undefined && !isComponentVariantsList(value.variants, masterNodesById)) return false;
  if (value.slots !== undefined && !isComponentSlotsList(value.slots, masterNodesById)) return false;
  return true;
}

export function validateProjectReplacePayload(
  value: unknown,
): ValidationOutcome<ProjectReplacePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['project']) || !validateProject(data.project).ok) {
    return invalid('INVALID_PAYLOAD', 'Project replacement requires a complete valid Folio project.');
  }
  return { ok: true, value: { project: data.project as FolioProject } };
}

export function validatePageCreatePayload(
  value: unknown,
): ValidationOutcome<PageCreatePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['page']) || !isFolioPageData(data.page)) {
    return invalid('INVALID_PAYLOAD', 'Page creation requires a valid Folio page.');
  }
  return { ok: true, value: { page: data.page } };
}

export function validatePageSetActivePayload(
  value: unknown,
): ValidationOutcome<PageSetActivePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['pageId']) || !isNonEmptyString(data.pageId)) {
    return invalid('INVALID_PAYLOAD', 'Setting the active page requires a non-empty page ID.');
  }
  return { ok: true, value: { pageId: data.pageId } };
}

export function validateComponentCreatePayload(
  value: unknown,
): ValidationOutcome<ComponentCreatePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['component']) || !isComponentDefinitionData(data.component)) {
    return invalid('INVALID_PAYLOAD', 'Component creation requires a complete valid component definition.');
  }
  return { ok: true, value: { component: data.component } };
}

export function validateComponentSyncDocumentPayload(
  value: unknown,
): ValidationOutcome<ComponentSyncDocumentPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['componentId', 'document', 'updatedAt', 'expectedUpdatedAt', 'expectedMasterDocument']) ||
    !isNonEmptyString(data.componentId) ||
    !isFolioDocumentData(data.document) ||
    !isIsoTimestamp(data.updatedAt) ||
    !isIsoTimestamp(data.expectedUpdatedAt) ||
    !isFolioDocumentData(data.expectedMasterDocument)
  ) {
    return invalid('INVALID_PAYLOAD', 'Component sync requires a valid component ID, document, and optimistic concurrency guard.');
  }
  return {
    ok: true,
    value: {
      componentId: data.componentId,
      document: data.document,
      updatedAt: data.updatedAt,
      expectedUpdatedAt: data.expectedUpdatedAt,
      expectedMasterDocument: data.expectedMasterDocument,
    },
  };
}

export function validateComponentRenamePayload(
  value: unknown,
): ValidationOutcome<ComponentRenamePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['componentId', 'name', 'expectedUpdatedAt', 'expectedMasterDocument']) ||
    !isNonEmptyString(data.componentId) ||
    !isNonEmptyString(data.name, 512) ||
    !isIsoTimestamp(data.expectedUpdatedAt) ||
    !isFolioDocumentData(data.expectedMasterDocument)
  ) {
    return invalid('INVALID_PAYLOAD', 'Component rename requires a valid component ID, non-empty name, and concurrency guard.');
  }
  return {
    ok: true,
    value: {
      componentId: data.componentId,
      name: data.name.trim(),
      expectedUpdatedAt: data.expectedUpdatedAt,
      expectedMasterDocument: data.expectedMasterDocument,
    },
  };
}

export function validateComponentDeletePayload(
  value: unknown,
): ValidationOutcome<ComponentDeletePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['componentId', 'expectedUpdatedAt', 'expectedMasterDocument']) ||
    !isNonEmptyString(data.componentId) ||
    !isIsoTimestamp(data.expectedUpdatedAt) ||
    !isFolioDocumentData(data.expectedMasterDocument)
  ) {
    return invalid('INVALID_PAYLOAD', 'Component deletion requires a valid component ID and concurrency guard.');
  }
  return {
    ok: true,
    value: {
      componentId: data.componentId,
      expectedUpdatedAt: data.expectedUpdatedAt,
      expectedMasterDocument: data.expectedMasterDocument,
    },
  };
}

export function validateNodeReplaceManyPayload(
  value: unknown,
): ValidationOutcome<NodeReplaceManyPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['removeIds', 'insertNodes', 'selectIds']) ||
    !Array.isArray(data.removeIds) ||
    !Array.isArray(data.insertNodes) ||
    (data.removeIds.length === 0 && data.insertNodes.length === 0) ||
    data.removeIds.length > 200 ||
    data.insertNodes.length > 200
  ) {
    return invalid('INVALID_PAYLOAD', 'Multi-node replacement requires valid removeIds and/or insertNodes.');
  }
  const removeIds: string[] = [];
  for (const id of data.removeIds) {
    if (!isNonEmptyString(id)) return invalid('INVALID_REFERENCE', 'Every removed node ID must be a non-empty string.');
    removeIds.push(id);
  }
  const insertNodes: DesignNode[] = [];
  const seenInsert = new Set<string>();
  for (const entry of data.insertNodes) {
    if (!isDesignNodeData(entry)) return invalid('INVALID_PAYLOAD', 'Inserted nodes must match the Folio node schema.');
    if (seenInsert.has(entry.id)) return invalid('INVALID_REFERENCE', 'Inserted nodes must have unique IDs.');
    seenInsert.add(entry.id);
    insertNodes.push(entry);
  }
  let selectIds: string[] | undefined;
  if (data.selectIds !== undefined) {
    if (!Array.isArray(data.selectIds) || data.selectIds.length > 200) {
      return invalid('INVALID_PAYLOAD', 'selectIds must be an array of valid node IDs.');
    }
    selectIds = [];
    for (const id of data.selectIds) {
      if (!isNonEmptyString(id)) return invalid('INVALID_REFERENCE', 'Every selected node ID must be a non-empty string.');
      selectIds.push(id);
    }
  }
  return {
    ok: true,
    value: {
      removeIds,
      insertNodes,
      ...(selectIds !== undefined ? { selectIds } : {}),
    },
  };
}

export function validateNodeSplitPayload(
  value: unknown,
): ValidationOutcome<NodeSplitPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['nodeId', 'nodes']) ||
    !isNonEmptyString(data.nodeId) ||
    !Array.isArray(data.nodes) ||
    data.nodes.length === 0 ||
    data.nodes.length > 200
  ) {
    return invalid('INVALID_PAYLOAD', 'Node split requires a target node ID and replacement nodes.');
  }
  const nodes: DesignNode[] = [];
  const seenIds = new Set<string>();
  for (const entry of data.nodes) {
    if (!isDesignNodeData(entry)) return invalid('INVALID_PAYLOAD', 'Replacement nodes must match the Folio node schema.');
    if (seenIds.has(entry.id)) return invalid('INVALID_REFERENCE', 'Replacement nodes must have unique IDs.');
    seenIds.add(entry.id);
    nodes.push(entry);
  }
  return { ok: true, value: { nodeId: data.nodeId, nodes } };
}

export function validateNodeUpdateManyPayload(
  value: unknown,
): ValidationOutcome<NodeUpdateManyPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['nodes']) ||
    !Array.isArray(data.nodes) ||
    data.nodes.length === 0 ||
    data.nodes.length > 200
  ) {
    return invalid('INVALID_PAYLOAD', 'Multi-node update requires between 1 and 200 valid nodes.');
  }
  const nodes: DesignNode[] = [];
  const seenIds = new Set<string>();
  for (const entry of data.nodes) {
    if (!isDesignNodeData(entry)) return invalid('INVALID_PAYLOAD', 'Updated nodes must match the Folio node schema.');
    if (seenIds.has(entry.id)) return invalid('INVALID_REFERENCE', 'A node may appear only once in one update command.');
    seenIds.add(entry.id);
    nodes.push(entry);
  }
  return { ok: true, value: { nodes } };
}

export function validateNodeEditPayload(
  value: unknown,
): ValidationOutcome<NodeEditPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['node', 'coalesceKey']) ||
    !isDesignNodeData(data.node) ||
    !isNonEmptyString(data.coalesceKey, 256)
  ) {
    return invalid('INVALID_PAYLOAD', 'Coalesced node editing requires a valid node and coalesce key.');
  }
  return { ok: true, value: { node: data.node, coalesceKey: data.coalesceKey } };
}

export function validateSelectionSetPayload(
  value: unknown,
): ValidationOutcome<SelectionSetPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['nodeIds']) ||
    !Array.isArray(data.nodeIds) ||
    data.nodeIds.length > 500
  ) {
    return invalid('INVALID_PAYLOAD', 'Selection update requires an array of node IDs.');
  }
  const nodeIds: string[] = [];
  for (const id of data.nodeIds) {
    if (!isNonEmptyString(id)) return invalid('INVALID_REFERENCE', 'Every selected node ID must be a non-empty string.');
    nodeIds.push(id);
  }
  return { ok: true, value: { nodeIds } };
}

export function validateEmptyCommandPayload(
  value: unknown,
): ValidationOutcome<HistoryCommitEditPayload | HistoryUndoPayload | HistoryRedoPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || Object.keys(data).length !== 0) {
    return invalid('INVALID_PAYLOAD', 'This command requires an empty payload object.');
  }
  return { ok: true, value: {} };
}

export function validateTokensUpdatePayload(
  value: unknown,
): ValidationOutcome<TokensUpdatePayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['designTokens', 'unbindTokenIds']) ||
    !isDesignTokenCollection(data.designTokens)
  ) {
    return invalid('INVALID_PAYLOAD', 'Updating design tokens requires a valid token collection.');
  }
  let unbindTokenIds: string[] | undefined;
  if (data.unbindTokenIds !== undefined) {
    if (!Array.isArray(data.unbindTokenIds) || data.unbindTokenIds.length > 500) {
      return invalid('INVALID_PAYLOAD', 'unbindTokenIds must be an array of token IDs.');
    }
    unbindTokenIds = [];
    for (const id of data.unbindTokenIds) {
      if (!isNonEmptyString(id)) return invalid('INVALID_REFERENCE', 'Every unbound token ID must be a non-empty string.');
      unbindTokenIds.push(id);
    }
  }
  return {
    ok: true,
    value: {
      designTokens: data.designTokens,
      ...(unbindTokenIds !== undefined ? { unbindTokenIds } : {}),
    },
  };
}

export function validateComponentUpdateContractPayload(
  value: unknown,
): ValidationOutcome<ComponentUpdateContractPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, ['componentId', 'variants', 'slots', 'expectedUpdatedAt', 'expectedMasterDocument']) ||
    !isNonEmptyString(data.componentId) ||
    !isIsoTimestamp(data.expectedUpdatedAt) ||
    !isFolioDocumentData(data.expectedMasterDocument) ||
    (data.variants === undefined && data.slots === undefined)
  ) {
    return invalid('INVALID_PAYLOAD', 'Component contract update requires a component ID, contract changes, and concurrency guard.');
  }
  const masterNodesById = new Map(data.expectedMasterDocument.nodes.map((node) => [node.id, node]));
  if (data.variants !== undefined && !isComponentVariantsList(data.variants, masterNodesById)) {
    return invalid('INVALID_PAYLOAD', 'Component variants must be valid and compatible with existing master nodes.');
  }
  if (data.slots !== undefined && !isComponentSlotsList(data.slots, masterNodesById)) {
    return invalid('INVALID_PAYLOAD', 'Component slots must be valid and compatible with existing master nodes.');
  }
  return {
    ok: true,
    value: {
      componentId: data.componentId,
      ...(data.variants !== undefined ? { variants: data.variants as ComponentUpdateContractPayload['variants'] } : {}),
      ...(data.slots !== undefined ? { slots: data.slots as ComponentUpdateContractPayload['slots'] } : {}),
      expectedUpdatedAt: data.expectedUpdatedAt,
      expectedMasterDocument: data.expectedMasterDocument,
    },
  };
}

export function validateCodeUpdateModulesPayload(
  value: unknown,
): ValidationOutcome<CodeUpdateModulesPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['codeModules', 'coalesceKey']) || !isCodeModuleList(data.codeModules)) {
    return invalid('INVALID_PAYLOAD', 'Updating code modules requires a valid list of custom or extension code modules.');
  }
  if (data.coalesceKey !== undefined && (typeof data.coalesceKey !== 'string' || data.coalesceKey.trim().length === 0)) {
    return invalid('INVALID_PAYLOAD', 'Code module coalesceKey must be a non-empty string when provided.');
  }
  return {
    ok: true,
    value: {
      codeModules: data.codeModules,
      ...(data.coalesceKey !== undefined ? { coalesceKey: data.coalesceKey } : {}),
    },
  };
}

export function validateLogicCreateGraphPayload(
  value: unknown,
): ValidationOutcome<LogicCreateGraphPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['graph']) || !isLogicGraph(data.graph)) {
    return invalid('INVALID_PAYLOAD', 'Creating a logic graph requires a valid Folio LogicGraph object.');
  }
  return {
    ok: true,
    value: {
      graph: data.graph,
    },
  };
}

export function validateLogicUpdateGraphPayload(
  value: unknown,
): ValidationOutcome<LogicUpdateGraphPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['graph']) || !isLogicGraph(data.graph)) {
    return invalid('INVALID_PAYLOAD', 'Updating a logic graph requires a valid Folio LogicGraph object.');
  }
  return {
    ok: true,
    value: {
      graph: data.graph,
    },
  };
}

export function validateLogicDeleteGraphPayload(
  value: unknown,
): ValidationOutcome<LogicDeleteGraphPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['graphId']) || !isNonEmptyString(data.graphId, 128)) {
    return invalid('INVALID_PAYLOAD', 'Deleting a logic graph requires a valid non-empty graphId.');
  }
  return {
    ok: true,
    value: {
      graphId: data.graphId,
    },
  };
}

export function validateAnimationCreateClipPayload(
  value: unknown,
): ValidationOutcome<AnimationCreateClipPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['clip']) || !isAnimationClip(data.clip)) {
    return invalid('INVALID_PAYLOAD', 'Creating an animation clip requires a valid Folio AnimationClip object.');
  }
  return {
    ok: true,
    value: {
      clip: data.clip,
    },
  };
}

export function validateAnimationUpdateClipPayload(
  value: unknown,
): ValidationOutcome<AnimationUpdateClipPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['clip']) || !isAnimationClip(data.clip)) {
    return invalid('INVALID_PAYLOAD', 'Updating an animation clip requires a valid Folio AnimationClip object.');
  }
  return {
    ok: true,
    value: {
      clip: data.clip,
    },
  };
}

export function validateAnimationDeleteClipPayload(
  value: unknown,
): ValidationOutcome<AnimationDeleteClipPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['clipId']) || !isNonEmptyString(data.clipId, 128)) {
    return invalid('INVALID_PAYLOAD', 'Deleting an animation clip requires a valid non-empty clipId.');
  }
  return {
    ok: true,
    value: {
      clipId: data.clipId,
    },
  };
}

export function validateAssetUpsertPayload(
  value: unknown,
): ValidationOutcome<AssetUpsertPayload> {
  const normalized = cloneRuntimeData(value);
  if (!normalized.ok) return invalid('INVALID_PAYLOAD', 'The payload must contain only plain own data properties.');
  const data = normalized.value;
  if (!isRecord(data) || !hasOnlyKeys(data, ['asset']) || !isRecord(data.asset)) {
    return invalid('INVALID_PAYLOAD', 'Upserting an asset requires a valid Folio AssetReference object.');
  }
  const asset = data.asset;
  if (
    !hasOnlyKeys(asset, ['id', 'name', 'kind', 'mimeType', 'source', 'createdAt', 'sha256', 'byteLength', 'width', 'height']) ||
    !isNonEmptyString(asset.id, 256) ||
    !isNonEmptyString(asset.name, 512) ||
    !['image', 'font', 'svg', 'file'].includes(String(asset.kind)) ||
    !isNonEmptyString(asset.mimeType, 128) ||
    !isIsoTimestamp(asset.createdAt) ||
    typeof asset.source !== 'string' ||
    asset.source.trim().length === 0 ||
    asset.source.length > 15 * 1024 * 1024 ||
    !(
      asset.source.startsWith('data:image/') ||
      asset.source.startsWith('data:font/') ||
      asset.source.startsWith('data:application/font') ||
      asset.source.startsWith('data:application/octet-stream') ||
      asset.source.startsWith('idb://') ||
      asset.source.startsWith('assets/') ||
      asset.source.startsWith('/assets/') ||
      asset.source.startsWith('https://')
    ) ||
    (asset.sha256 !== undefined && (typeof asset.sha256 !== 'string' || !ASSET_SHA256_PATTERN.test(asset.sha256))) ||
    (asset.byteLength !== undefined && (!isFiniteNumber(asset.byteLength) || asset.byteLength < 0)) ||
    (asset.width !== undefined && (!isFiniteNumber(asset.width) || asset.width <= 0)) ||
    (asset.height !== undefined && (!isFiniteNumber(asset.height) || asset.height <= 0))
  ) {
    return invalid('INVALID_PAYLOAD', 'The supplied asset reference is malformed or uses an unsupported source scheme.');
  }
  return {
    ok: true,
    value: {
      asset: asset as unknown as AssetUpsertPayload['asset'],
    },
  };
}


import { isBlendMode, isFillPaint, isVisualEffect } from '../document/styling';
import type { DesignNode } from '../document/types';
import {
  isNodeLayoutChildConfig,
  isNodeLayoutConfig,
  isNodeTokenBindings,
  isResponsiveOverrides,
  SEMANTIC_HTML_TAGS,
} from '../document/validation';

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
  | 'brush'
  | 'eraser'
  | 'paint-bucket'
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
  'brush',
  'eraser',
  'paint-bucket',
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

export type VectorBrushPreset = 'round' | 'calligraphy' | 'tapered' | 'marker';
export type VectorBrushCap = 'round' | 'square' | 'butt';
export type VectorEraserMode = 'slice' | 'object';
export type VectorEraserTarget = 'selected' | 'all';
export type PaintBucketTarget = 'fill' | 'stroke' | 'smart-region';
export type PaintBucketGapTolerance = 'tight' | 'medium' | 'loose';

export interface CanvasToolOptions {
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  strokeWidth: number;
  strokeColor: string;
  fillColor: string;
  keepToolActive: boolean;
  smoothRadius: number;
  /** Vector Brush settings (Zero-Typing) */
  brushPreset: VectorBrushPreset;
  brushSize: number;
  brushStabilizer: number;
  brushColor: string;
  brushTokenId?: string;
  brushCap: VectorBrushCap;
  /** Vector Eraser settings (Zero-Typing) */
  eraserSize: number;
  eraserMode: VectorEraserMode;
  eraserTarget: VectorEraserTarget;
  /** Paint Bucket settings (Zero-Typing) */
  paintBucketColor: string;
  paintBucketTokenId?: string;
  paintBucketTarget: PaintBucketTarget;
  paintBucketGapTolerance: PaintBucketGapTolerance;
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
  brushPreset: 'round',
  brushSize: 10,
  brushStabilizer: 45,
  brushColor: '#8B7CF6',
  brushCap: 'round',
  eraserSize: 24,
  eraserMode: 'slice',
  eraserTarget: 'selected',
  paintBucketColor: '#8B7CF6',
  paintBucketTarget: 'fill',
  paintBucketGapTolerance: 'medium',
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

export interface MoveLayerOperationPayload {
  readonly kind: 'move-layer';
  readonly nodeId: string;
  readonly targetId: string;
  readonly position: 'before' | 'after' | 'inside';
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
  | CommitInlineTextOperationPayload
  | MoveLayerOperationPayload;

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
  | ToolOperationEnvelope<CommitInlineTextOperationPayload>
  | ToolOperationEnvelope<MoveLayerOperationPayload>;

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
  readonly moveLayer?: {
    readonly nodeId: string;
    readonly targetId: string;
    readonly position: 'before' | 'after' | 'inside';
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

export type ToolOperationValidationErrorCode =
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_TOOL'
  | 'INVALID_CATEGORY'
  | 'INVALID_METADATA'
  | 'INVALID_PAYLOAD'
  | 'EMPTY_OPERATION'
  | 'INVALID_NODE'
  | 'INVALID_GEOMETRY'
  | 'DUPLICATE_NODE_ID'
  | 'INVALID_COLOR'
  | 'INVALID_VIEWPORT';

export interface ToolOperationEnvelopeValidationResult {
  readonly ok: boolean;
  readonly code?: ToolOperationValidationErrorCode;
  readonly path?: string;
  readonly error?: string;
}

export const TOOL_OPERATION_LIMITS = Object.freeze({
  maxNodesPerOperation: 500,
  maxSelectionIds: 1000,
  maxPathPoints: 5000,
  maxSubpaths: 256,
  maxIdLength: 256,
  maxNameLength: 512,
  maxColorLength: 128,
  maxTextLength: 10000,
  maxMessageLength: 1024,
});

const ENVELOPE_ALLOWED_KEYS = [
  'protocol',
  'version',
  'operationId',
  'toolId',
  'workspace',
  'category',
  'payload',
  'metadata',
] as const;

const METADATA_ALLOWED_KEYS = ['atomicHistoryStep', 'description'] as const;

const COMMON_NODE_KEYS = [
  'id',
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'blendMode',
  'effects',
  'visible',
  'locked',
  'aspectRatioLocked',
  'layerColor',
  'parentId',
  'onCanvas',
  'clipMaskBaseId',
  'clipMaskMode',
  'drawMode',
  'semanticTag',
  'ariaLabel',
  'href',
  'layout',
  'layoutChild',
  'responsive',
  'tokenBindings',
] as const;

const FRAME_NODE_KEYS = [...COMMON_NODE_KEYS, 'style', 'clipContent', 'isSection'] as const;
const SHAPE_NODE_KEYS = [...COMMON_NODE_KEYS, 'style'] as const;
const PATH_NODE_KEYS = [...COMMON_NODE_KEYS, 'points', 'closed', 'style', 'pathKind', 'subpaths', 'shapeMeta'] as const;
const TEXT_NODE_KEYS = [...COMMON_NODE_KEYS, 'text', 'style'] as const;
const IMAGE_NODE_KEYS = [...COMMON_NODE_KEYS, 'assetId', 'alt', 'naturalWidth', 'naturalHeight', 'style'] as const;
const INSTANCE_NODE_KEYS = [
  ...COMMON_NODE_KEYS,
  'componentId',
  'overrides',
  'variantSelection',
  'slotAssignments',
] as const;

const SHAPE_STYLE_KEYS = ['fill', 'fills', 'stroke', 'strokeWidth', 'strokeDasharray', 'strokeAlign', 'radius'] as const;
const PATH_STYLE_KEYS = [
  'fill',
  'fills',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeDasharray',
  'strokeAlign',
  'fillRule',
  'arrowStart',
  'arrowEnd',
] as const;
const TEXT_STYLE_KEYS = [
  'fill',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'verticalAlign',
  'textWrap',
  'textTransform',
  'textDecoration',
] as const;
const IMAGE_STYLE_KEYS = ['fit', 'radius', 'stroke', 'strokeWidth'] as const;
const ANCHOR_POINT_KEYS = ['id', 'x', 'y', 'handleIn', 'handleOut', 'pointType'] as const;
const POINT_2D_KEYS = ['x', 'y'] as const;
const SUBPATH_KEYS = ['points', 'closed'] as const;
const INSTANCE_OVERRIDE_KEYS = ['fill', 'text'] as const;
const SLOT_ASSIGNMENT_KEYS = ['text', 'fill', 'visible'] as const;

const VALID_PATH_KINDS = new Set([
  'pen',
  'curvature',
  'pencil',
  'line',
  'arrow',
  'polygon',
  'star',
  'boolean',
  'outline',
]);
const VALID_STROKE_LINECAPS = new Set(['butt', 'round', 'square']);
const VALID_STROKE_LINEJOINS = new Set(['miter', 'round', 'bevel']);
const VALID_STROKE_ALIGNS = new Set(['inside', 'center', 'outside']);
const VALID_CLIP_MASK_MODES = new Set(['inside', 'outside']);
const VALID_DRAW_MODES = new Set(['normal', 'inside', 'outside']);
const VALID_POINT_TYPES = new Set(['corner', 'smooth', 'symmetric']);
const VALID_TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const VALID_TEXT_VERTICAL_ALIGNS = new Set(['top', 'middle', 'bottom']);
const VALID_TEXT_WRAPS = new Set(['wrap', 'nowrap']);
const VALID_TEXT_TRANSFORMS = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const VALID_TEXT_DECORATIONS = new Set(['none', 'underline', 'line-through']);
const VALID_IMAGE_FITS = new Set(['cover', 'contain', 'fill']);

const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Object.prototype));
const STANDARD_ARRAY_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Array.prototype));

function fail(
  code: ToolOperationValidationErrorCode,
  error: string,
  path?: string,
): ToolOperationEnvelopeValidationResult {
  return path ? { ok: false, code, path, error } : { ok: false, code, error };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return false;
    if (
      prototype === Object.prototype &&
      Reflect.ownKeys(prototype).some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))
    ) {
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

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Array.prototype ||
      Reflect.ownKeys(prototype).some((key) => !STANDARD_ARRAY_PROTOTYPE_KEYS.has(key))
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    const lengthDesc = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !lengthDesc ||
      !('value' in lengthDesc) ||
      lengthDesc.enumerable ||
      !Number.isSafeInteger(lengthDesc.value) ||
      lengthDesc.value < 0 ||
      keys.length !== lengthDesc.value + 1
    ) {
      return false;
    }
    for (let i = 0; i < lengthDesc.value; i += 1) {
      const desc = Object.getOwnPropertyDescriptor(value, String(i));
      if (!desc || !desc.enumerable || !('value' in desc)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function findUnexpectedKey(record: Record<string, unknown>, allowed: readonly string[]): string | null {
  try {
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== 'string' || !allowed.includes(key)) {
        return String(key);
      }
    }
    return null;
  } catch {
    return '<unreadable>';
  }
}

function isNonEmptyString(value: unknown, maxLength: number = TOOL_OPERATION_LIMITS.maxIdLength): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateVectorHandle(
  value: unknown,
  path: string,
): ToolOperationEnvelopeValidationResult | null {
  if (!isPlainRecord(value)) {
    return fail('INVALID_NODE', `${path} must be a plain coordinate object.`, path);
  }
  const extra = findUnexpectedKey(value, POINT_2D_KEYS);
  if (extra) {
    return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return fail('INVALID_GEOMETRY', `${path} must contain finite x and y coordinates.`, path);
  }
  return null;
}

function validateAnchorPoint(
  value: unknown,
  path: string,
): ToolOperationEnvelopeValidationResult | null {
  if (!isPlainRecord(value)) {
    return fail('INVALID_NODE', `${path} must be a plain anchor point object.`, path);
  }
  const extra = findUnexpectedKey(value, ANCHOR_POINT_KEYS);
  if (extra) {
    return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
  }
  if (!isNonEmptyString(value.id)) {
    return fail('INVALID_NODE', `${path}.id must be a non-empty string.`, `${path}.id`);
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return fail('INVALID_GEOMETRY', `${path} must contain finite x and y coordinates.`, path);
  }
  if (typeof value.pointType !== 'string' || !VALID_POINT_TYPES.has(value.pointType)) {
    return fail(
      'INVALID_NODE',
      `${path}.pointType must be "corner", "smooth", or "symmetric".`,
      `${path}.pointType`,
    );
  }
  if (value.handleIn !== undefined) {
    const err = validateVectorHandle(value.handleIn, `${path}.handleIn`);
    if (err) return err;
  }
  if (value.handleOut !== undefined) {
    const err = validateVectorHandle(value.handleOut, `${path}.handleOut`);
    if (err) return err;
  }
  return null;
}

function validateShapeStyle(
  value: unknown,
  path: string,
): ToolOperationEnvelopeValidationResult | null {
  if (!isPlainRecord(value)) {
    return fail('INVALID_NODE', `${path} must be a plain shape style object.`, path);
  }
  const extra = findUnexpectedKey(value, SHAPE_STYLE_KEYS);
  if (extra) {
    return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
  }
  if (typeof value.fill !== 'string' || value.fill.length > TOOL_OPERATION_LIMITS.maxColorLength) {
    return fail('INVALID_NODE', `${path}.fill must be a string.`, `${path}.fill`);
  }
  if (value.fills !== undefined) {
    if (!isDenseArray(value.fills) || value.fills.length > 16 || !value.fills.every(isFillPaint)) {
      return fail('INVALID_NODE', `${path}.fills must contain up to 16 valid FillPaint entries.`, `${path}.fills`);
    }
  }
  if (typeof value.stroke !== 'string' || value.stroke.length > TOOL_OPERATION_LIMITS.maxColorLength) {
    return fail('INVALID_NODE', `${path}.stroke must be a string.`, `${path}.stroke`);
  }
  if (!isFiniteNumber(value.strokeWidth) || value.strokeWidth < 0) {
    return fail('INVALID_GEOMETRY', `${path}.strokeWidth must be a finite number >= 0.`, `${path}.strokeWidth`);
  }
  if (
    value.strokeDasharray !== undefined &&
    (typeof value.strokeDasharray !== 'string' || value.strokeDasharray.length > TOOL_OPERATION_LIMITS.maxColorLength)
  ) {
    return fail('INVALID_NODE', `${path}.strokeDasharray must be a string.`, `${path}.strokeDasharray`);
  }
  if (
    value.strokeAlign !== undefined &&
    (typeof value.strokeAlign !== 'string' || !VALID_STROKE_ALIGNS.has(value.strokeAlign))
  ) {
    return fail('INVALID_NODE', `${path}.strokeAlign must be "inside", "center", or "outside".`, `${path}.strokeAlign`);
  }
  if (value.radius !== undefined && (!isFiniteNumber(value.radius) || value.radius < 0)) {
    return fail('INVALID_GEOMETRY', `${path}.radius must be a finite number >= 0.`, `${path}.radius`);
  }
  return null;
}

function validatePathStyle(
  value: unknown,
  path: string,
): ToolOperationEnvelopeValidationResult | null {
  if (!isPlainRecord(value)) {
    return fail('INVALID_NODE', `${path} must be a plain path style object.`, path);
  }
  const extra = findUnexpectedKey(value, PATH_STYLE_KEYS);
  if (extra) {
    return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
  }
  if (typeof value.fill !== 'string' || value.fill.length > TOOL_OPERATION_LIMITS.maxColorLength) {
    return fail('INVALID_NODE', `${path}.fill must be a string.`, `${path}.fill`);
  }
  if (value.fills !== undefined) {
    if (!isDenseArray(value.fills) || value.fills.length > 16 || !value.fills.every(isFillPaint)) {
      return fail('INVALID_NODE', `${path}.fills must contain up to 16 valid FillPaint entries.`, `${path}.fills`);
    }
  }
  if (typeof value.stroke !== 'string' || value.stroke.length > TOOL_OPERATION_LIMITS.maxColorLength) {
    return fail('INVALID_NODE', `${path}.stroke must be a string.`, `${path}.stroke`);
  }
  if (!isFiniteNumber(value.strokeWidth) || value.strokeWidth < 0) {
    return fail('INVALID_GEOMETRY', `${path}.strokeWidth must be a finite number >= 0.`, `${path}.strokeWidth`);
  }
  if (
    value.strokeLinecap !== undefined &&
    (typeof value.strokeLinecap !== 'string' || !VALID_STROKE_LINECAPS.has(value.strokeLinecap))
  ) {
    return fail('INVALID_NODE', `${path}.strokeLinecap must be "butt", "round", or "square".`, `${path}.strokeLinecap`);
  }
  if (
    value.strokeLinejoin !== undefined &&
    (typeof value.strokeLinejoin !== 'string' || !VALID_STROKE_LINEJOINS.has(value.strokeLinejoin))
  ) {
    return fail('INVALID_NODE', `${path}.strokeLinejoin must be "miter", "round", or "bevel".`, `${path}.strokeLinejoin`);
  }
  if (
    value.strokeDasharray !== undefined &&
    (typeof value.strokeDasharray !== 'string' || value.strokeDasharray.length > TOOL_OPERATION_LIMITS.maxColorLength)
  ) {
    return fail('INVALID_NODE', `${path}.strokeDasharray must be a string.`, `${path}.strokeDasharray`);
  }
  if (
    value.strokeAlign !== undefined &&
    (typeof value.strokeAlign !== 'string' || !VALID_STROKE_ALIGNS.has(value.strokeAlign))
  ) {
    return fail('INVALID_NODE', `${path}.strokeAlign must be "inside", "center", or "outside".`, `${path}.strokeAlign`);
  }
  if (value.fillRule !== undefined && value.fillRule !== 'nonzero' && value.fillRule !== 'evenodd') {
    return fail('INVALID_NODE', `${path}.fillRule must be "nonzero" or "evenodd".`, `${path}.fillRule`);
  }
  if (value.arrowStart !== undefined && typeof value.arrowStart !== 'boolean') {
    return fail('INVALID_NODE', `${path}.arrowStart must be a boolean.`, `${path}.arrowStart`);
  }
  if (value.arrowEnd !== undefined && typeof value.arrowEnd !== 'boolean') {
    return fail('INVALID_NODE', `${path}.arrowEnd must be a boolean.`, `${path}.arrowEnd`);
  }
  return null;
}

export function validateDesignNodePayload(
  value: unknown,
  path = 'node',
): ToolOperationEnvelopeValidationResult | null {
  if (!isPlainRecord(value)) {
    return fail('INVALID_NODE', `${path} must be a plain DesignNode object.`, path);
  }
  if (!isNonEmptyString(value.id)) {
    return fail('INVALID_NODE', `${path}.id must be a non-empty string.`, `${path}.id`);
  }
  if (typeof value.name !== 'string' || value.name.length > TOOL_OPERATION_LIMITS.maxNameLength) {
    return fail('INVALID_NODE', `${path}.name must be a string.`, `${path}.name`);
  }
  if (typeof value.visible !== 'boolean') {
    return fail('INVALID_NODE', `${path}.visible must be a boolean.`, `${path}.visible`);
  }
  if (typeof value.locked !== 'boolean') {
    return fail('INVALID_NODE', `${path}.locked must be a boolean.`, `${path}.locked`);
  }
  if (value.aspectRatioLocked !== undefined && typeof value.aspectRatioLocked !== 'boolean') {
    return fail('INVALID_NODE', `${path}.aspectRatioLocked must be a boolean.`, `${path}.aspectRatioLocked`);
  }
  if (
    value.layerColor !== undefined &&
    (typeof value.layerColor !== 'string' || value.layerColor.length > TOOL_OPERATION_LIMITS.maxColorLength)
  ) {
    return fail('INVALID_NODE', `${path}.layerColor must be a string.`, `${path}.layerColor`);
  }
  if (value.onCanvas !== undefined && typeof value.onCanvas !== 'boolean') {
    return fail('INVALID_NODE', `${path}.onCanvas must be a boolean.`, `${path}.onCanvas`);
  }
  if (value.parentId !== undefined && value.parentId !== null && !isNonEmptyString(value.parentId)) {
    return fail('INVALID_NODE', `${path}.parentId must be null or a non-empty string.`, `${path}.parentId`);
  }
  if (value.clipMaskBaseId !== undefined && !isNonEmptyString(value.clipMaskBaseId)) {
    return fail('INVALID_NODE', `${path}.clipMaskBaseId must be a non-empty string.`, `${path}.clipMaskBaseId`);
  }
  if (value.clipMaskMode !== undefined && (typeof value.clipMaskMode !== 'string' || !VALID_CLIP_MASK_MODES.has(value.clipMaskMode))) {
    return fail('INVALID_NODE', `${path}.clipMaskMode must be "inside" or "outside".`, `${path}.clipMaskMode`);
  }
  if (value.drawMode !== undefined && (typeof value.drawMode !== 'string' || !VALID_DRAW_MODES.has(value.drawMode))) {
    return fail('INVALID_NODE', `${path}.drawMode must be "normal", "inside", or "outside".`, `${path}.drawMode`);
  }
  if (value.blendMode !== undefined && !isBlendMode(value.blendMode)) {
    return fail('INVALID_NODE', `${path}.blendMode is not a supported BlendMode.`, `${path}.blendMode`);
  }
  if (value.effects !== undefined) {
    if (!isDenseArray(value.effects) || value.effects.length > 16 || !value.effects.every(isVisualEffect)) {
      return fail('INVALID_NODE', `${path}.effects must contain up to 16 valid VisualEffect entries.`, `${path}.effects`);
    }
  }
  if (value.semanticTag !== undefined && !SEMANTIC_HTML_TAGS.has(String(value.semanticTag))) {
    return fail('INVALID_NODE', `${path}.semanticTag is not a supported semantic HTML tag.`, `${path}.semanticTag`);
  }
  if (value.ariaLabel !== undefined && (typeof value.ariaLabel !== 'string' || value.ariaLabel.length > 512)) {
    return fail('INVALID_NODE', `${path}.ariaLabel must be a string.`, `${path}.ariaLabel`);
  }
  if (value.href !== undefined && (typeof value.href !== 'string' || value.href.length > 2048)) {
    return fail('INVALID_NODE', `${path}.href must be a string.`, `${path}.href`);
  }
  if (value.layout !== undefined && !isNodeLayoutConfig(value.layout)) {
    return fail('INVALID_NODE', `${path}.layout is not a valid Auto-Layout configuration.`, `${path}.layout`);
  }
  if (value.layoutChild !== undefined && !isNodeLayoutChildConfig(value.layoutChild)) {
    return fail('INVALID_NODE', `${path}.layoutChild is not a valid layout child configuration.`, `${path}.layoutChild`);
  }
  if (value.responsive !== undefined && !isResponsiveOverrides(value.responsive)) {
    return fail('INVALID_NODE', `${path}.responsive is not a valid responsive override map.`, `${path}.responsive`);
  }
  if (value.tokenBindings !== undefined && !isNodeTokenBindings(value.tokenBindings)) {
    return fail('INVALID_NODE', `${path}.tokenBindings is not a valid token binding map.`, `${path}.tokenBindings`);
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return fail('INVALID_GEOMETRY', `Node ${value.id} has non-finite coordinates.`, path);
  }
  if (!isFiniteNumber(value.width) || value.width < 0 || !isFiniteNumber(value.height) || value.height < 0) {
    return fail(
      'INVALID_GEOMETRY',
      `Node ${value.id} has invalid dimensions (${String(value.width)}x${String(value.height)}).`,
      path,
    );
  }
  if (!isFiniteNumber(value.rotation)) {
    return fail('INVALID_GEOMETRY', `Node ${value.id} has non-finite rotation.`, `${path}.rotation`);
  }
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) {
    return fail(
      'INVALID_GEOMETRY',
      `Node ${value.id} has out-of-range opacity (${String(value.opacity)}).`,
      `${path}.opacity`,
    );
  }

  switch (value.type) {
    case 'group': {
      const extra = findUnexpectedKey(value, COMMON_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      return null;
    }

    case 'rect':
    case 'ellipse': {
      const extra = findUnexpectedKey(value, SHAPE_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      return validateShapeStyle(value.style, `${path}.style`);
    }

    case 'frame': {
      const extra = findUnexpectedKey(value, FRAME_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      if (value.clipContent !== undefined && typeof value.clipContent !== 'boolean') {
        return fail('INVALID_NODE', `${path}.clipContent must be a boolean.`, `${path}.clipContent`);
      }
      if (value.isSection !== undefined && typeof value.isSection !== 'boolean') {
        return fail('INVALID_NODE', `${path}.isSection must be a boolean.`, `${path}.isSection`);
      }
      return validateShapeStyle(value.style, `${path}.style`);
    }

    case 'text': {
      const extra = findUnexpectedKey(value, TEXT_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      if (typeof value.text !== 'string' || value.text.length > TOOL_OPERATION_LIMITS.maxTextLength) {
        return fail('INVALID_NODE', `${path}.text must be a string.`, `${path}.text`);
      }
      if (!isPlainRecord(value.style)) {
        return fail('INVALID_NODE', `${path}.style must be a plain text style object.`, `${path}.style`);
      }
      const styleExtra = findUnexpectedKey(value.style, TEXT_STYLE_KEYS);
      if (styleExtra) {
        return fail('INVALID_NODE', `Unexpected property "${styleExtra}" on ${path}.style.`, `${path}.style.${styleExtra}`);
      }
      const style = value.style;
      if (typeof style.fill !== 'string' || style.fill.length > TOOL_OPERATION_LIMITS.maxColorLength) {
        return fail('INVALID_NODE', `${path}.style.fill must be a string.`, `${path}.style.fill`);
      }
      if (typeof style.fontFamily !== 'string' || style.fontFamily.length > TOOL_OPERATION_LIMITS.maxIdLength) {
        return fail('INVALID_NODE', `${path}.style.fontFamily must be a string.`, `${path}.style.fontFamily`);
      }
      if (!isFiniteNumber(style.fontSize) || style.fontSize <= 0) {
        return fail('INVALID_GEOMETRY', `Text node ${value.id} has invalid fontSize.`, `${path}.style.fontSize`);
      }
      if (!isFiniteNumber(style.fontWeight)) {
        return fail('INVALID_GEOMETRY', `Text node ${value.id} has non-finite fontWeight.`, `${path}.style.fontWeight`);
      }
      if (!isFiniteNumber(style.letterSpacing)) {
        return fail(
          'INVALID_GEOMETRY',
          `Text node ${value.id} has non-finite letterSpacing.`,
          `${path}.style.letterSpacing`,
        );
      }
      if (!isFiniteNumber(style.lineHeight) || style.lineHeight <= 0) {
        return fail('INVALID_GEOMETRY', `Text node ${value.id} has invalid lineHeight.`, `${path}.style.lineHeight`);
      }
      if (style.textAlign !== undefined && (typeof style.textAlign !== 'string' || !VALID_TEXT_ALIGNS.has(style.textAlign))) {
        return fail('INVALID_NODE', `${path}.style.textAlign must be "left", "center", "right", or "justify".`, `${path}.style.textAlign`);
      }
      if (style.verticalAlign !== undefined && (typeof style.verticalAlign !== 'string' || !VALID_TEXT_VERTICAL_ALIGNS.has(style.verticalAlign))) {
        return fail('INVALID_NODE', `${path}.style.verticalAlign must be "top", "middle", or "bottom".`, `${path}.style.verticalAlign`);
      }
      if (style.textWrap !== undefined && (typeof style.textWrap !== 'string' || !VALID_TEXT_WRAPS.has(style.textWrap))) {
        return fail('INVALID_NODE', `${path}.style.textWrap must be "wrap" or "nowrap".`, `${path}.style.textWrap`);
      }
      if (
        style.textTransform !== undefined &&
        (typeof style.textTransform !== 'string' || !VALID_TEXT_TRANSFORMS.has(style.textTransform))
      ) {
        return fail('INVALID_NODE', `${path}.style.textTransform is invalid.`, `${path}.style.textTransform`);
      }
      if (
        style.textDecoration !== undefined &&
        (typeof style.textDecoration !== 'string' || !VALID_TEXT_DECORATIONS.has(style.textDecoration))
      ) {
        return fail('INVALID_NODE', `${path}.style.textDecoration is invalid.`, `${path}.style.textDecoration`);
      }
      return null;
    }

    case 'image': {
      const extra = findUnexpectedKey(value, IMAGE_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      if (!isNonEmptyString(value.assetId)) {
        return fail('INVALID_NODE', `${path}.assetId must be a non-empty string.`, `${path}.assetId`);
      }
      if (value.alt !== undefined && (typeof value.alt !== 'string' || value.alt.length > TOOL_OPERATION_LIMITS.maxNameLength)) {
        return fail('INVALID_NODE', `${path}.alt must be a string.`, `${path}.alt`);
      }
      if (value.naturalWidth !== undefined && (!isFiniteNumber(value.naturalWidth) || value.naturalWidth <= 0)) {
        return fail('INVALID_GEOMETRY', `${path}.naturalWidth must be a positive finite number.`, `${path}.naturalWidth`);
      }
      if (value.naturalHeight !== undefined && (!isFiniteNumber(value.naturalHeight) || value.naturalHeight <= 0)) {
        return fail('INVALID_GEOMETRY', `${path}.naturalHeight must be a positive finite number.`, `${path}.naturalHeight`);
      }
      if (!isPlainRecord(value.style)) {
        return fail('INVALID_NODE', `${path}.style must be a plain image style object.`, `${path}.style`);
      }
      const styleExtra = findUnexpectedKey(value.style, IMAGE_STYLE_KEYS);
      if (styleExtra) {
        return fail('INVALID_NODE', `Unexpected property "${styleExtra}" on ${path}.style.`, `${path}.style.${styleExtra}`);
      }
      const style = value.style;
      if (typeof style.fit !== 'string' || !VALID_IMAGE_FITS.has(style.fit)) {
        return fail('INVALID_NODE', `${path}.style.fit must be "cover", "contain", or "fill".`, `${path}.style.fit`);
      }
      if (style.radius !== undefined && (!isFiniteNumber(style.radius) || style.radius < 0)) {
        return fail('INVALID_GEOMETRY', `${path}.style.radius must be a finite number >= 0.`, `${path}.style.radius`);
      }
      if (style.stroke !== undefined && (typeof style.stroke !== 'string' || style.stroke.length > TOOL_OPERATION_LIMITS.maxColorLength)) {
        return fail('INVALID_NODE', `${path}.style.stroke must be a string.`, `${path}.style.stroke`);
      }
      if (style.strokeWidth !== undefined && (!isFiniteNumber(style.strokeWidth) || style.strokeWidth < 0)) {
        return fail('INVALID_GEOMETRY', `${path}.style.strokeWidth must be a finite number >= 0.`, `${path}.style.strokeWidth`);
      }
      return null;
    }

    case 'path': {
      const extra = findUnexpectedKey(value, PATH_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      if (typeof value.closed !== 'boolean') {
        return fail('INVALID_NODE', `${path}.closed must be a boolean.`, `${path}.closed`);
      }
      if (
        !isDenseArray(value.points) ||
        value.points.length === 0 ||
        value.points.length > TOOL_OPERATION_LIMITS.maxPathPoints
      ) {
        return fail(
          'INVALID_GEOMETRY',
          `Path node ${value.id} must contain between 1 and ${TOOL_OPERATION_LIMITS.maxPathPoints} anchor points.`,
          `${path}.points`,
        );
      }
      for (let i = 0; i < value.points.length; i += 1) {
        const ptErr = validateAnchorPoint(value.points[i], `${path}.points[${i}]`);
        if (ptErr) return ptErr;
      }
      if (value.subpaths !== undefined) {
        if (!isDenseArray(value.subpaths) || value.subpaths.length > TOOL_OPERATION_LIMITS.maxSubpaths) {
          return fail(
            'INVALID_NODE',
            `${path}.subpaths must be an array with at most ${TOOL_OPERATION_LIMITS.maxSubpaths} entries.`,
            `${path}.subpaths`,
          );
        }
        for (let s = 0; s < value.subpaths.length; s += 1) {
          const sp = value.subpaths[s];
          const spPath = `${path}.subpaths[${s}]`;
          if (!isPlainRecord(sp)) {
            return fail('INVALID_NODE', `${spPath} must be a plain subpath object.`, spPath);
          }
          const spExtra = findUnexpectedKey(sp, SUBPATH_KEYS);
          if (spExtra) {
            return fail('INVALID_NODE', `Unexpected property "${spExtra}" on ${spPath}.`, `${spPath}.${spExtra}`);
          }
          if (typeof sp.closed !== 'boolean') {
            return fail('INVALID_NODE', `${spPath}.closed must be a boolean.`, `${spPath}.closed`);
          }
          if (
            !isDenseArray(sp.points) ||
            sp.points.length === 0 ||
            sp.points.length > TOOL_OPERATION_LIMITS.maxPathPoints
          ) {
            return fail('INVALID_GEOMETRY', `${spPath}.points must contain valid anchor points.`, `${spPath}.points`);
          }
          for (let j = 0; j < sp.points.length; j += 1) {
            const ptErr = validateAnchorPoint(sp.points[j], `${spPath}.points[${j}]`);
            if (ptErr) return ptErr;
          }
        }
      }
      if (value.pathKind !== undefined && (typeof value.pathKind !== 'string' || !VALID_PATH_KINDS.has(value.pathKind))) {
        return fail('INVALID_NODE', `${path}.pathKind "${String(value.pathKind)}" is not supported.`, `${path}.pathKind`);
      }
      if (value.shapeMeta !== undefined) {
        if (!isPlainRecord(value.shapeMeta)) {
          return fail('INVALID_NODE', `${path}.shapeMeta must be a plain object.`, `${path}.shapeMeta`);
        }
        if (value.shapeMeta.kind === 'polygon') {
          const metaExtra = findUnexpectedKey(value.shapeMeta, ['kind', 'sides']);
          if (metaExtra) {
            return fail(
              'INVALID_NODE',
              `Unexpected property "${metaExtra}" on ${path}.shapeMeta.`,
              `${path}.shapeMeta.${metaExtra}`,
            );
          }
          if (
            !isFiniteNumber(value.shapeMeta.sides) ||
            !Number.isInteger(value.shapeMeta.sides) ||
            value.shapeMeta.sides < 3 ||
            value.shapeMeta.sides > 32
          ) {
            return fail(
              'INVALID_GEOMETRY',
              `${path}.shapeMeta.sides must be an integer between 3 and 32.`,
              `${path}.shapeMeta.sides`,
            );
          }
        } else if (value.shapeMeta.kind === 'star') {
          const metaExtra = findUnexpectedKey(value.shapeMeta, ['kind', 'spikes', 'innerRatio']);
          if (metaExtra) {
            return fail(
              'INVALID_NODE',
              `Unexpected property "${metaExtra}" on ${path}.shapeMeta.`,
              `${path}.shapeMeta.${metaExtra}`,
            );
          }
          if (
            !isFiniteNumber(value.shapeMeta.spikes) ||
            !Number.isInteger(value.shapeMeta.spikes) ||
            value.shapeMeta.spikes < 3 ||
            value.shapeMeta.spikes > 32
          ) {
            return fail(
              'INVALID_GEOMETRY',
              `${path}.shapeMeta.spikes must be an integer between 3 and 32.`,
              `${path}.shapeMeta.spikes`,
            );
          }
          if (
            !isFiniteNumber(value.shapeMeta.innerRatio) ||
            value.shapeMeta.innerRatio < 0.1 ||
            value.shapeMeta.innerRatio > 0.95
          ) {
            return fail(
              'INVALID_GEOMETRY',
              `${path}.shapeMeta.innerRatio must be between 0.1 and 0.95.`,
              `${path}.shapeMeta.innerRatio`,
            );
          }
        } else {
          return fail(
            'INVALID_NODE',
            `${path}.shapeMeta.kind must be "polygon" or "star".`,
            `${path}.shapeMeta.kind`,
          );
        }
      }
      return validatePathStyle(value.style, `${path}.style`);
    }

    case 'component-instance': {
      const extra = findUnexpectedKey(value, INSTANCE_NODE_KEYS);
      if (extra) return fail('INVALID_NODE', `Unexpected property "${extra}" on ${path}.`, `${path}.${extra}`);
      if (!isNonEmptyString(value.componentId)) {
        return fail('INVALID_NODE', `${path}.componentId must be a non-empty string.`, `${path}.componentId`);
      }
      if (value.width <= 0 || value.height <= 0) {
        return fail('INVALID_GEOMETRY', `Component instance ${value.id} must have positive dimensions.`, path);
      }
      if (!isPlainRecord(value.overrides)) {
        return fail('INVALID_NODE', `${path}.overrides must be a plain object.`, `${path}.overrides`);
      }
      for (const [childId, override] of Object.entries(value.overrides)) {
        const overridePath = `${path}.overrides.${childId}`;
        if (!isNonEmptyString(childId)) {
          return fail('INVALID_NODE', `${path}.overrides keys must be non-empty strings.`, overridePath);
        }
        if (!isPlainRecord(override)) {
          return fail('INVALID_NODE', `${overridePath} must be a plain override object.`, overridePath);
        }
        const ovExtra = findUnexpectedKey(override, INSTANCE_OVERRIDE_KEYS);
        if (ovExtra) {
          return fail('INVALID_NODE', `Unexpected property "${ovExtra}" on ${overridePath}.`, `${overridePath}.${ovExtra}`);
        }
        if (
          override.fill !== undefined &&
          (typeof override.fill !== 'string' || override.fill.length > TOOL_OPERATION_LIMITS.maxColorLength)
        ) {
          return fail('INVALID_NODE', `${overridePath}.fill must be a string.`, `${overridePath}.fill`);
        }
        if (
          override.text !== undefined &&
          (typeof override.text !== 'string' || override.text.length > TOOL_OPERATION_LIMITS.maxTextLength)
        ) {
          return fail('INVALID_NODE', `${overridePath}.text must be a string.`, `${overridePath}.text`);
        }
      }
      if (value.variantSelection !== undefined) {
        if (!isPlainRecord(value.variantSelection)) {
          return fail('INVALID_NODE', `${path}.variantSelection must be a plain object.`, `${path}.variantSelection`);
        }
        for (const [axisId, optionId] of Object.entries(value.variantSelection)) {
          if (!isNonEmptyString(axisId) || !isNonEmptyString(optionId)) {
            return fail(
              'INVALID_NODE',
              `${path}.variantSelection entries must map non-empty axis IDs to option IDs.`,
              `${path}.variantSelection.${axisId}`,
            );
          }
        }
      }
      if (value.slotAssignments !== undefined) {
        if (!isPlainRecord(value.slotAssignments)) {
          return fail('INVALID_NODE', `${path}.slotAssignments must be a plain object.`, `${path}.slotAssignments`);
        }
        for (const [slotId, assignment] of Object.entries(value.slotAssignments)) {
          const slotPath = `${path}.slotAssignments.${slotId}`;
          if (!isNonEmptyString(slotId) || !isPlainRecord(assignment)) {
            return fail('INVALID_NODE', `${slotPath} must be a plain slot assignment object.`, slotPath);
          }
          const slotExtra = findUnexpectedKey(assignment, SLOT_ASSIGNMENT_KEYS);
          if (slotExtra) {
            return fail('INVALID_NODE', `Unexpected property "${slotExtra}" on ${slotPath}.`, `${slotPath}.${slotExtra}`);
          }
          if (
            assignment.text !== undefined &&
            (typeof assignment.text !== 'string' || assignment.text.length > TOOL_OPERATION_LIMITS.maxTextLength)
          ) {
            return fail('INVALID_NODE', `${slotPath}.text must be a string.`, `${slotPath}.text`);
          }
          if (
            assignment.fill !== undefined &&
            (typeof assignment.fill !== 'string' || assignment.fill.length > TOOL_OPERATION_LIMITS.maxColorLength)
          ) {
            return fail('INVALID_NODE', `${slotPath}.fill must be a string.`, `${slotPath}.fill`);
          }
          if (assignment.visible !== undefined && typeof assignment.visible !== 'boolean') {
            return fail('INVALID_NODE', `${slotPath}.visible must be a boolean.`, `${slotPath}.visible`);
          }
        }
      }
      return null;
    }

    default:
      return fail('INVALID_NODE', `${path}.type "${String(value.type)}" is not a supported DesignNode type.`, `${path}.type`);
  }
}

function validateNodeArray(
  value: unknown,
  path: string,
  options: { readonly allowEmpty: boolean },
): ToolOperationEnvelopeValidationResult | null {
  if (!isDenseArray(value)) {
    return fail('INVALID_PAYLOAD', `${path} must be a dense array of DesignNode objects.`, path);
  }
  if (!options.allowEmpty && value.length === 0) {
    return fail('EMPTY_OPERATION', `${path} must contain at least one node.`, path);
  }
  if (value.length > TOOL_OPERATION_LIMITS.maxNodesPerOperation) {
    return fail(
      'INVALID_PAYLOAD',
      `${path} exceeds maximum allowed length (${TOOL_OPERATION_LIMITS.maxNodesPerOperation}).`,
      path,
    );
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const node = value[i];
    const nodePath = `${path}[${i}]`;
    const err = validateDesignNodePayload(node, nodePath);
    if (err) return err;
    const id = (node as DesignNode).id;
    if (seenIds.has(id)) {
      return fail('DUPLICATE_NODE_ID', `Duplicate node id "${id}" inside ${path}.`, `${nodePath}.id`);
    }
    seenIds.add(id);
  }
  return null;
}

function validateIdArray(
  value: unknown,
  path: string,
  options: { readonly allowEmpty: boolean; readonly maxLength: number },
): ToolOperationEnvelopeValidationResult | null {
  if (!isDenseArray(value)) {
    return fail('INVALID_PAYLOAD', `${path} must be a dense array of node IDs.`, path);
  }
  if (!options.allowEmpty && value.length === 0) {
    return fail('EMPTY_OPERATION', `${path} must contain at least one node ID.`, path);
  }
  if (value.length > options.maxLength) {
    return fail('INVALID_PAYLOAD', `${path} exceeds maximum allowed length (${options.maxLength}).`, path);
  }
  for (let i = 0; i < value.length; i += 1) {
    if (!isNonEmptyString(value[i])) {
      return fail('INVALID_PAYLOAD', `${path}[${i}] must be a non-empty string ID.`, `${path}[${i}]`);
    }
  }
  return null;
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
    case 'move-layer':
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

export function getExpectedCategoryForKind(kind: string): ToolOperationCategory | null {
  switch (kind) {
    case 'create-nodes':
    case 'transform-nodes':
    case 'replace-node-with-nodes':
    case 'replace-nodes':
    case 'sample-color':
    case 'commit-inline-text':
    case 'move-layer':
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
    case 'move-layer':
      return 'Reorder layer on canvas';
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

  if (transition.moveLayer) {
    operations.push(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'move-layer',
          nodeId: transition.moveLayer.nodeId,
          targetId: transition.moveLayer.targetId,
          position: transition.moveLayer.position,
        },
        { description: getDefaultMutationDescription(toolId, 'move-layer') },
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

  if (transition.notice && transition.notice.trim().length > 0) {
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

/**
 * Exhaustively validates a Tool Operation payload according to its discriminant `kind`,
 * verifying exact allowed keys, plain own data properties, DesignNode schemas,
 * geometry bounds, color/viewport/tool invariants, and cross-field consistency.
 */
export function validateToolOperationPayload(
  input: unknown,
  pathPrefix = 'payload',
): ToolOperationEnvelopeValidationResult {
  if (!isPlainRecord(input)) {
    return fail('INVALID_PAYLOAD', 'Tool operation payload must be a plain object.', pathPrefix);
  }
  if (typeof input.kind !== 'string') {
    return fail('INVALID_PAYLOAD', 'Tool operation payload requires a discriminant kind.', `${pathPrefix}.kind`);
  }

  switch (input.kind) {
    case 'create-nodes': {
      const extra = findUnexpectedKey(input, ['kind', 'nodes', 'openInlineTextForNodeId']);
      if (extra) {
        return fail('INVALID_PAYLOAD', `Unexpected property "${extra}" on create-nodes payload.`, `${pathPrefix}.${extra}`);
      }
      const nodesErr = validateNodeArray(input.nodes, `${pathPrefix}.nodes`, { allowEmpty: false });
      if (nodesErr) return nodesErr;

      if (input.openInlineTextForNodeId !== undefined) {
        if (!isNonEmptyString(input.openInlineTextForNodeId)) {
          return fail(
            'INVALID_PAYLOAD',
            'create-nodes openInlineTextForNodeId must be a non-empty string.',
            `${pathPrefix}.openInlineTextForNodeId`,
          );
        }
        const createdNodes = input.nodes as readonly DesignNode[];
        const targetTextNode = createdNodes.find((node) => node.id === input.openInlineTextForNodeId);
        if (!targetTextNode || targetTextNode.type !== 'text') {
          return fail(
            'INVALID_PAYLOAD',
            `create-nodes openInlineTextForNodeId "${input.openInlineTextForNodeId}" must reference a text node in payload.nodes.`,
            `${pathPrefix}.openInlineTextForNodeId`,
          );
        }
      }
      return { ok: true };
    }

    case 'transform-nodes': {
      const extra = findUnexpectedKey(input, ['kind', 'nodes']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on transform-nodes payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      const nodesErr = validateNodeArray(input.nodes, `${pathPrefix}.nodes`, { allowEmpty: false });
      if (nodesErr) return nodesErr;
      return { ok: true };
    }

    case 'replace-node-with-nodes': {
      const extra = findUnexpectedKey(input, ['kind', 'nodeId', 'nodes']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on replace-node-with-nodes payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (!isNonEmptyString(input.nodeId)) {
        return fail(
          'INVALID_PAYLOAD',
          'replace-node-with-nodes requires a non-empty string nodeId.',
          `${pathPrefix}.nodeId`,
        );
      }
      const nodesErr = validateNodeArray(input.nodes, `${pathPrefix}.nodes`, { allowEmpty: false });
      if (nodesErr) return nodesErr;
      return { ok: true };
    }

    case 'replace-nodes': {
      const extra = findUnexpectedKey(input, ['kind', 'removeIds', 'insertNodes', 'selectIds']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on replace-nodes payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      const removeErr = validateIdArray(input.removeIds, `${pathPrefix}.removeIds`, {
        allowEmpty: false,
        maxLength: TOOL_OPERATION_LIMITS.maxNodesPerOperation,
      });
      if (removeErr) return removeErr;

      const insertErr = validateNodeArray(input.insertNodes, `${pathPrefix}.insertNodes`, { allowEmpty: true });
      if (insertErr) return insertErr;

      if (input.selectIds !== undefined) {
        const selectErr = validateIdArray(input.selectIds, `${pathPrefix}.selectIds`, {
          allowEmpty: true,
          maxLength: TOOL_OPERATION_LIMITS.maxSelectionIds,
        });
        if (selectErr) return selectErr;
      }
      return { ok: true };
    }

    case 'sample-color': {
      const extra = findUnexpectedKey(input, ['kind', 'color', 'sourceName', 'target']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on sample-color payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (!isNonEmptyString(input.color, TOOL_OPERATION_LIMITS.maxColorLength)) {
        return fail(
          'INVALID_COLOR',
          'sample-color requires a non-empty color string.',
          `${pathPrefix}.color`,
        );
      }
      if (typeof input.sourceName !== 'string' || input.sourceName.length > TOOL_OPERATION_LIMITS.maxIdLength) {
        return fail(
          'INVALID_PAYLOAD',
          'sample-color sourceName must be a string.',
          `${pathPrefix}.sourceName`,
        );
      }
      if (input.target !== 'fill' && input.target !== 'stroke') {
        return fail(
          'INVALID_PAYLOAD',
          `sample-color target must be "fill" or "stroke", received "${String(input.target)}".`,
          `${pathPrefix}.target`,
        );
      }
      return { ok: true };
    }

    case 'commit-inline-text': {
      const extra = findUnexpectedKey(input, ['kind', 'nodeId', 'text']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on commit-inline-text payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (!isNonEmptyString(input.nodeId)) {
        return fail(
          'INVALID_PAYLOAD',
          'commit-inline-text requires a non-empty string nodeId.',
          `${pathPrefix}.nodeId`,
        );
      }
      if (typeof input.text !== 'string' || input.text.length > TOOL_OPERATION_LIMITS.maxTextLength) {
        return fail(
          'INVALID_PAYLOAD',
          'commit-inline-text text must be a string.',
          `${pathPrefix}.text`,
        );
      }
      return { ok: true };
    }

    case 'move-layer': {
      const extra = findUnexpectedKey(input, ['kind', 'nodeId', 'targetId', 'position']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on move-layer payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (!isNonEmptyString(input.nodeId)) {
        return fail('INVALID_PAYLOAD', 'move-layer requires a non-empty string nodeId.', `${pathPrefix}.nodeId`);
      }
      if (!isNonEmptyString(input.targetId)) {
        return fail('INVALID_PAYLOAD', 'move-layer requires a non-empty string targetId.', `${pathPrefix}.targetId`);
      }
      if (input.position !== 'before' && input.position !== 'after' && input.position !== 'inside') {
        return fail(
          'INVALID_PAYLOAD',
          `move-layer position must be "before", "after", or "inside", received "${String(input.position)}".`,
          `${pathPrefix}.position`,
        );
      }
      return { ok: true };
    }

    case 'select-nodes': {
      const extra = findUnexpectedKey(input, ['kind', 'nodeIds']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on select-nodes payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      const idsErr = validateIdArray(input.nodeIds, `${pathPrefix}.nodeIds`, {
        allowEmpty: true,
        maxLength: TOOL_OPERATION_LIMITS.maxSelectionIds,
      });
      if (idsErr) return idsErr;
      return { ok: true };
    }

    case 'viewport-update': {
      const extra = findUnexpectedKey(input, ['kind', 'pan', 'zoom']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on viewport-update payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (input.pan === undefined && input.zoom === undefined) {
        return fail(
          'EMPTY_OPERATION',
          'viewport-update requires at least one of pan or zoom.',
          pathPrefix,
        );
      }
      if (input.pan !== undefined) {
        if (!isPlainRecord(input.pan)) {
          return fail('INVALID_VIEWPORT', 'viewport-update pan must be a plain { x, y } object.', `${pathPrefix}.pan`);
        }
        const panExtra = findUnexpectedKey(input.pan, POINT_2D_KEYS);
        if (panExtra) {
          return fail(
            'INVALID_VIEWPORT',
            `Unexpected property "${panExtra}" on viewport-update pan.`,
            `${pathPrefix}.pan.${panExtra}`,
          );
        }
        if (!isFiniteNumber(input.pan.x) || !isFiniteNumber(input.pan.y)) {
          return fail(
            'INVALID_VIEWPORT',
            'viewport-update pan must contain finite x and y coordinates.',
            `${pathPrefix}.pan`,
          );
        }
      }
      if (input.zoom !== undefined) {
        if (!isFiniteNumber(input.zoom) || input.zoom <= 0) {
          return fail(
            'INVALID_VIEWPORT',
            'viewport-update zoom must be a finite positive number.',
            `${pathPrefix}.zoom`,
          );
        }
      }
      return { ok: true };
    }

    case 'switch-tool': {
      const extra = findUnexpectedKey(input, ['kind', 'nextToolId']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on switch-tool payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (!isCanvasToolId(input.nextToolId)) {
        return fail(
          'INVALID_TOOL',
          `switch-tool nextToolId "${String(input.nextToolId)}" is not a valid CanvasToolId.`,
          `${pathPrefix}.nextToolId`,
        );
      }
      return { ok: true };
    }

    case 'notify': {
      const extra = findUnexpectedKey(input, ['kind', 'message']);
      if (extra) {
        return fail(
          'INVALID_PAYLOAD',
          `Unexpected property "${extra}" on notify payload.`,
          `${pathPrefix}.${extra}`,
        );
      }
      if (typeof input.message !== 'string' || input.message.length > TOOL_OPERATION_LIMITS.maxMessageLength) {
        return fail('INVALID_PAYLOAD', 'notify message must be a string.', `${pathPrefix}.message`);
      }
      if (input.message.trim().length === 0) {
        return fail('EMPTY_OPERATION', 'notify message must be non-empty.', `${pathPrefix}.message`);
      }
      return { ok: true };
    }

    default:
      return fail('INVALID_PAYLOAD', `Unsupported tool operation kind: ${input.kind}.`, `${pathPrefix}.kind`);
  }
}

export function validateToolOperationEnvelope(input: unknown): ToolOperationEnvelopeValidationResult {
  if (!isPlainRecord(input)) {
    return fail('INVALID_ENVELOPE', 'Tool operation must be a plain non-null object.');
  }
  const unexpectedEnvelopeKey = findUnexpectedKey(input, ENVELOPE_ALLOWED_KEYS);
  if (unexpectedEnvelopeKey) {
    return fail(
      'INVALID_ENVELOPE',
      `Unexpected property "${unexpectedEnvelopeKey}" on tool operation envelope.`,
      unexpectedEnvelopeKey,
    );
  }
  if (input.protocol !== TOOL_OPERATION_PROTOCOL) {
    return fail('UNSUPPORTED_PROTOCOL', `Unsupported tool operation protocol: ${String(input.protocol)}.`, 'protocol');
  }
  if (input.version !== TOOL_OPERATION_VERSION) {
    return fail('UNSUPPORTED_VERSION', `Unsupported tool operation version: ${String(input.version)}.`, 'version');
  }
  if (!isNonEmptyString(input.operationId)) {
    return fail('INVALID_ENVELOPE', 'Tool operation requires a non-empty operationId.', 'operationId');
  }
  if (!isCanvasToolId(input.toolId)) {
    return fail('INVALID_TOOL', `Unknown studio toolId: ${String(input.toolId)}.`, 'toolId');
  }
  if (input.workspace !== 'main' && input.workspace !== 'component') {
    return fail('INVALID_ENVELOPE', `Invalid tool operation workspace: ${String(input.workspace)}.`, 'workspace');
  }
  if (!isPlainRecord(input.metadata)) {
    return fail('INVALID_METADATA', 'Tool operation metadata must be a plain object.', 'metadata');
  }
  const unexpectedMetaKey = findUnexpectedKey(input.metadata, METADATA_ALLOWED_KEYS);
  if (unexpectedMetaKey) {
    return fail(
      'INVALID_METADATA',
      `Unexpected property "${unexpectedMetaKey}" on tool operation metadata.`,
      `metadata.${unexpectedMetaKey}`,
    );
  }
  if (typeof input.metadata.atomicHistoryStep !== 'boolean') {
    return fail(
      'INVALID_METADATA',
      'Tool operation metadata.atomicHistoryStep must be a boolean.',
      'metadata.atomicHistoryStep',
    );
  }
  if (
    input.metadata.description !== undefined &&
    !isNonEmptyString(input.metadata.description, TOOL_OPERATION_LIMITS.maxMessageLength)
  ) {
    return fail(
      'INVALID_METADATA',
      'Tool operation metadata.description must be a non-empty string when provided.',
      'metadata.description',
    );
  }

  if (!isPlainRecord(input.payload)) {
    return fail('INVALID_PAYLOAD', 'Tool operation payload must be a plain object.', 'payload');
  }
  if (typeof input.payload.kind !== 'string') {
    return fail('INVALID_PAYLOAD', 'Tool operation payload requires a discriminant kind.', 'payload.kind');
  }
  const expectedCategory = getExpectedCategoryForKind(input.payload.kind);
  if (!expectedCategory) {
    return fail('INVALID_PAYLOAD', `Unsupported tool operation kind: ${input.payload.kind}.`, 'payload.kind');
  }
  if (input.category !== expectedCategory) {
    return fail(
      'INVALID_CATEGORY',
      `Tool operation category "${String(input.category)}" does not match payload kind "${input.payload.kind}".`,
      'category',
    );
  }

  return validateToolOperationPayload(input.payload, 'payload');
}

export function isToolOperation(input: unknown): input is ToolOperation {
  return validateToolOperationEnvelope(input).ok;
}

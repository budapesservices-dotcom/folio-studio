import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  FOLIO_LEGACY_FORMAT_VERSION,
  type ComponentDefinition,
  type DesignNode,
  type DesignTokenCollection,
  type FolioDocument,
  type FolioProject,
  type FolioProjectV1,
} from './types';
import { isOverrideFieldCompatibleWithNodeType } from './components';
import { isBlendMode, isFillPaint, isVisualEffect } from './styling';
import { validateDesignTokenCollection, validateNodeTokenBindings } from './tokens';

export interface ValidationResult {
  ok: boolean;
  project?: FolioProject;
  error?: string;
}

export interface LegacyValidationResult {
  ok: boolean;
  project?: FolioProjectV1;
  error?: string;
}

/**
 * Shared registry of objects deeply frozen by Folio's canonical freeze helper.
 * Only objects present in this WeakSet are trusted for O(1) incremental
 * validation memoization — unfrozen or shallowly frozen candidates always run
 * full structural validation.
 */
const deeplyFrozenObjects = new WeakSet<object>();
const validatedFrozenNodes = new WeakSet<object>();
const validatedFrozenDocuments = new WeakSet<object>();
const validatedFrozenTokens = new WeakSet<object>();
const validatedFrozenCodeModules = new WeakSet<object>();
const validatedFrozenLogicGraphsContext = new WeakMap<object, { pages: unknown; components: unknown }>();
const validatedFrozenAnimationsContext = new WeakMap<object, unknown>();
const validatedFrozenAssets = new WeakSet<object>();
const validatedFrozenComponentsContext = new WeakMap<object, { tokens: unknown; components: unknown }>();
const validatedFrozenPagesContext = new WeakMap<object, { tokens: unknown; components: unknown }>();

export function isDeeplyFrozenGraph(value: unknown): boolean {
  return value !== null && typeof value === 'object' && deeplyFrozenObjects.has(value as object);
}

/**
 * Recursively freezes an immutable state/project graph while short-circuiting
 * on subgraphs already registered in deeplyFrozenObjects (O(changed objects)).
 */
export function freezeImmutableGraph<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (deeplyFrozenObjects.has(object) || seen.has(object)) return value;
  seen.add(object);
  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i += 1) {
      freezeImmutableGraph(object[i], seen);
    }
  } else {
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        freezeImmutableGraph((object as Record<string, unknown>)[key], seen);
      }
    }
  }
  Object.freeze(object);
  deeplyFrozenObjects.add(object);
  return value;
}

function isValidatedDesignNode(value: unknown): value is DesignNode {
  if (value !== null && typeof value === 'object' && deeplyFrozenObjects.has(value as object) && validatedFrozenNodes.has(value as object)) {
    return true;
  }
  if (!isDesignNode(value)) return false;
  if (value !== null && typeof value === 'object' && deeplyFrozenObjects.has(value as object)) {
    validatedFrozenNodes.add(value as object);
  }
  return true;
}

export const SEMANTIC_HTML_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside',
  'button', 'a', 'h1', 'h2', 'h3', 'p', 'span', 'ul', 'li', 'form', 'input', 'img',
]);

const TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right']);
const TEXT_WRAP_VALUES = new Set(['wrap', 'nowrap']);
const TEXT_TRANSFORM_VALUES = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const TEXT_DECORATION_VALUES = new Set(['none', 'underline', 'line-through']);
const IMAGE_FIT_VALUES = new Set(['cover', 'contain', 'fill']);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_COMPONENT_NESTING_DEPTH = 16;

const BREAKPOINT_IDS = new Set(['desktop', 'tablet', 'mobile']);
const LAYOUT_MODES = new Set(['none', 'flex', 'grid']);
const LAYOUT_DIRECTIONS = new Set(['row', 'column']);
const LAYOUT_WRAPS = new Set(['nowrap', 'wrap']);
const LAYOUT_JUSTIFY = new Set(['start', 'center', 'end', 'space-between', 'space-around']);
const LAYOUT_ALIGN = new Set(['start', 'center', 'end', 'stretch']);
const LAYOUT_SIZING_MODES = new Set(['fixed', 'hug', 'fill']);
const ALIGN_SELF_VALUES = new Set(['auto', 'start', 'center', 'end', 'stretch']);
const HORIZONTAL_CONSTRAINTS = new Set(['left', 'right', 'left-right', 'center', 'scale']);
const VERTICAL_CONSTRAINTS = new Set(['top', 'bottom', 'top-bottom', 'center', 'scale']);
const TOKEN_LAYERS = new Set(['primitive', 'semantic']);
const TOKEN_CATEGORIES = new Set(['color', 'spacing', 'radius', 'typography']);
const TOKEN_UNITS = new Set(['px', 'rem', '%', 'em']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNodePadding(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.top) && value.top >= 0 &&
    isFiniteNumber(value.right) && value.right >= 0 &&
    isFiniteNumber(value.bottom) && value.bottom >= 0 &&
    isFiniteNumber(value.left) && value.left >= 0
  );
}

export function isNodeLayoutConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    LAYOUT_MODES.has(String(value.mode)) &&
    LAYOUT_DIRECTIONS.has(String(value.direction)) &&
    (value.wrap === undefined || LAYOUT_WRAPS.has(String(value.wrap))) &&
    (value.justifyContent === undefined || LAYOUT_JUSTIFY.has(String(value.justifyContent))) &&
    (value.alignItems === undefined || LAYOUT_ALIGN.has(String(value.alignItems))) &&
    isFiniteNumber(value.gap) && value.gap >= 0 &&
    (value.columnGap === undefined || (isFiniteNumber(value.columnGap) && value.columnGap >= 0)) &&
    (value.rowGap === undefined || (isFiniteNumber(value.rowGap) && value.rowGap >= 0)) &&
    (value.gridColumns === undefined || (isFiniteNumber(value.gridColumns) && value.gridColumns >= 1 && value.gridColumns <= 24)) &&
    isNodePadding(value.padding)
  );
}

export function isNodeLayoutChildConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.widthMode === undefined || LAYOUT_SIZING_MODES.has(String(value.widthMode))) &&
    (value.heightMode === undefined || LAYOUT_SIZING_MODES.has(String(value.heightMode))) &&
    (value.alignSelf === undefined || ALIGN_SELF_VALUES.has(String(value.alignSelf))) &&
    (value.flexGrow === undefined || (isFiniteNumber(value.flexGrow) && value.flexGrow >= 0)) &&
    (value.minWidth === undefined || (isFiniteNumber(value.minWidth) && value.minWidth >= 0)) &&
    (value.maxWidth === undefined || (isFiniteNumber(value.maxWidth) && value.maxWidth >= 0)) &&
    (value.minHeight === undefined || (isFiniteNumber(value.minHeight) && value.minHeight >= 0)) &&
    (value.maxHeight === undefined || (isFiniteNumber(value.maxHeight) && value.maxHeight >= 0)) &&
    (value.constraints === undefined || (
      isRecord(value.constraints) &&
      HORIZONTAL_CONSTRAINTS.has(String(value.constraints.horizontal)) &&
      VERTICAL_CONSTRAINTS.has(String(value.constraints.vertical))
    ))
  );
}

export function isResponsiveOverrides(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([bp, override]) => {
    if (!BREAKPOINT_IDS.has(bp) || !isRecord(override)) return false;
    return (
      (override.visible === undefined || typeof override.visible === 'boolean') &&
      (override.width === undefined || (isFiniteNumber(override.width) && override.width > 0)) &&
      (override.height === undefined || (isFiniteNumber(override.height) && override.height > 0)) &&
      (override.layoutDirection === undefined || LAYOUT_DIRECTIONS.has(String(override.layoutDirection))) &&
      (override.gridColumns === undefined || (isFiniteNumber(override.gridColumns) && override.gridColumns >= 1 && override.gridColumns <= 24)) &&
      (override.gap === undefined || (isFiniteNumber(override.gap) && override.gap >= 0)) &&
      (override.padding === undefined || isNodePadding(override.padding))
    );
  });
}

export function isNodeTokenBindings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowed = new Set(['fill', 'stroke', 'radius', 'gap', 'padding', 'fontSize']);
  return Object.entries(value).every(([key, tokenId]) =>
    allowed.has(key) && (tokenId === undefined || (isString(tokenId) && tokenId.length > 0)),
  );
}

function isDesignTokenValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'alias') {
    return isString(value.tokenId) && value.tokenId.trim().length > 0;
  }
  if (value.kind === 'literal') {
    const validRaw = isString(value.value) || isFiniteNumber(value.value);
    const validUnit = value.unit === undefined || TOKEN_UNITS.has(String(value.unit));
    return validRaw && validUnit;
  }
  return false;
}

export function isDesignTokenCollection(value: unknown): value is DesignTokenCollection {
  if (!isRecord(value)) return false;
  if (!isString(value.activeThemeId) || !value.activeThemeId.trim()) return false;
  if (!Array.isArray(value.themes) || value.themes.length === 0) return false;
  if (!Array.isArray(value.tokens)) return false;

  for (const theme of value.themes) {
    if (!isRecord(theme) || !isString(theme.id) || !theme.id.trim() || !isString(theme.name) || !theme.name.trim()) {
      return false;
    }
  }

  for (const token of value.tokens) {
    if (
      !isRecord(token) ||
      !isString(token.id) || !token.id.trim() ||
      !isString(token.name) || !token.name.trim() ||
      !TOKEN_LAYERS.has(String(token.layer)) ||
      !TOKEN_CATEGORIES.has(String(token.category)) ||
      !isDesignTokenValue(token.value) ||
      (token.description !== undefined && !isString(token.description))
    ) {
      return false;
    }
    if (token.themeValues !== undefined) {
      if (!isRecord(token.themeValues)) return false;
      for (const themeVal of Object.values(token.themeValues)) {
        if (!isDesignTokenValue(themeVal)) return false;
      }
    }
  }

  return validateDesignTokenCollection(value as unknown as DesignTokenCollection).ok;
}

function isComponentVariantOverride(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.fill === undefined || isString(value.fill)) &&
    (value.stroke === undefined || isString(value.stroke)) &&
    (value.text === undefined || isString(value.text)) &&
    (value.visible === undefined || typeof value.visible === 'boolean')
  );
}

export function isComponentVariantsList(
  value: unknown,
  validNodes?: ReadonlySet<string> | ReadonlyMap<string, DesignNode>,
): boolean {
  if (!Array.isArray(value)) return false;
  const axisIds = new Set<string>();
  for (const axis of value) {
    if (
      !isRecord(axis) ||
      !isString(axis.id) || !axis.id.trim() ||
      !isString(axis.name) || !axis.name.trim() ||
      !isString(axis.defaultOptionId) || !axis.defaultOptionId.trim() ||
      !Array.isArray(axis.options) || axis.options.length === 0
    ) {
      return false;
    }
    if (axisIds.has(axis.id)) return false;
    axisIds.add(axis.id);

    const optionIds = new Set<string>();
    for (const option of axis.options) {
      if (
        !isRecord(option) ||
        !isString(option.id) || !option.id.trim() ||
        !isString(option.label) || !option.label.trim() ||
        !isRecord(option.overrides)
      ) {
        return false;
      }
      if (optionIds.has(option.id)) return false;
      optionIds.add(option.id);

      for (const [nodeId, patch] of Object.entries(option.overrides)) {
        if (!isString(nodeId) || !nodeId.trim() || !isComponentVariantOverride(patch)) return false;
        if (validNodes) {
          if (validNodes instanceof Map) {
            const targetNode = validNodes.get(nodeId);
            if (!targetNode) return false;
            const typedPatch = patch as Record<string, unknown>;
            if (typedPatch.text !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'text')) return false;
            if (typedPatch.fill !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'fill')) return false;
            if (typedPatch.stroke !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'stroke')) return false;
          } else if (!validNodes.has(nodeId)) {
            return false;
          }
        }
      }
    }
    if (!optionIds.has(axis.defaultOptionId)) return false;
  }
  return true;
}

export function isComponentSlotsList(
  value: unknown,
  validNodes?: ReadonlySet<string> | ReadonlyMap<string, DesignNode>,
): boolean {
  if (!Array.isArray(value)) return false;
  const slotIds = new Set<string>();
  for (const slot of value) {
    if (
      !isRecord(slot) ||
      !isString(slot.id) || !slot.id.trim() ||
      !isString(slot.name) || !slot.name.trim() ||
      !isString(slot.targetNodeId) || !slot.targetNodeId.trim() ||
      (slot.description !== undefined && !isString(slot.description)) ||
      (slot.defaultText !== undefined && !isString(slot.defaultText))
    ) {
      return false;
    }
    if (slotIds.has(slot.id)) return false;
    slotIds.add(slot.id);
    if (validNodes) {
      if (validNodes instanceof Map) {
        const targetNode = validNodes.get(slot.targetNodeId);
        if (!targetNode) return false;
        if (slot.defaultText !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'text')) {
          return false;
        }
      } else if (!validNodes.has(slot.targetNodeId)) {
        return false;
      }
    }
  }
  return true;
}

function isCommonNode(value: Record<string, unknown>): boolean {
  return (
    isString(value.id) && value.id.length > 0 &&
    isString(value.name) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) && value.width >= 0 &&
    isFiniteNumber(value.height) && value.height >= 0 &&
    isFiniteNumber(value.rotation) &&
    isFiniteNumber(value.opacity) && value.opacity >= 0 && value.opacity <= 1 &&
    typeof value.visible === 'boolean' &&
    typeof value.locked === 'boolean' &&
    (value.layerColor === undefined || isString(value.layerColor)) &&
    (value.onCanvas === undefined || typeof value.onCanvas === 'boolean') &&
    (value.parentId === undefined || value.parentId === null || (isString(value.parentId) && value.parentId.length > 0)) &&
    (value.clipMaskBaseId === undefined || (isString(value.clipMaskBaseId) && value.clipMaskBaseId.length > 0)) &&
    (value.semanticTag === undefined || SEMANTIC_HTML_TAGS.has(String(value.semanticTag))) &&
    (value.ariaLabel === undefined || isString(value.ariaLabel)) &&
    (value.href === undefined || isString(value.href)) &&
    (value.layout === undefined || isNodeLayoutConfig(value.layout)) &&
    (value.layoutChild === undefined || isNodeLayoutChildConfig(value.layoutChild)) &&
    (value.responsive === undefined || isResponsiveOverrides(value.responsive)) &&
    (value.tokenBindings === undefined || isNodeTokenBindings(value.tokenBindings)) &&
    (value.blendMode === undefined || isBlendMode(value.blendMode)) &&
    (value.effects === undefined || (Array.isArray(value.effects) && value.effects.length <= 16 && value.effects.every(isVisualEffect))) &&
    (value.aspectRatioLocked === undefined || typeof value.aspectRatioLocked === 'boolean')
  );
}

function isShapeStyle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.fill) &&
    isString(value.stroke) &&
    isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 &&
    (value.radius === undefined || (isFiniteNumber(value.radius) && value.radius >= 0)) &&
    (value.fills === undefined || (Array.isArray(value.fills) && value.fills.length <= 16 && value.fills.every(isFillPaint)))
  );
}

function isVectorHandle(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isVectorAnchorPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) && value.id.length > 0 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    (value.handleIn === undefined || isVectorHandle(value.handleIn)) &&
    (value.handleOut === undefined || isVectorHandle(value.handleOut)) &&
    (value.pointType === 'corner' || value.pointType === 'smooth' || value.pointType === 'symmetric')
  );
}

function isVectorSubpath(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.closed === 'boolean' &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.every(isVectorAnchorPoint)
  );
}

function isPathStyle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.fill) &&
    isString(value.stroke) &&
    isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 &&
    (value.strokeLinecap === undefined || ['butt', 'round', 'square'].includes(String(value.strokeLinecap))) &&
    (value.strokeLinejoin === undefined || ['miter', 'round', 'bevel'].includes(String(value.strokeLinejoin))) &&
    (value.strokeDasharray === undefined || isString(value.strokeDasharray)) &&
    (value.fillRule === undefined || value.fillRule === 'nonzero' || value.fillRule === 'evenodd') &&
    (value.arrowStart === undefined || typeof value.arrowStart === 'boolean') &&
    (value.arrowEnd === undefined || typeof value.arrowEnd === 'boolean') &&
    (value.fills === undefined || (Array.isArray(value.fills) && value.fills.length <= 16 && value.fills.every(isFillPaint)))
  );
}

function isDesignNode(value: unknown): value is DesignNode {
  if (!isRecord(value) || !isCommonNode(value)) return false;

  if (value.type === 'group') return true;

  if (value.type === 'frame') {
    return (
      isShapeStyle(value.style) &&
      (value.clipContent === undefined || typeof value.clipContent === 'boolean') &&
      (value.isSection === undefined || typeof value.isSection === 'boolean')
    );
  }

  if (value.type === 'rect' || value.type === 'ellipse') {
    return isShapeStyle(value.style);
  }

  if (value.type === 'path') {
    const validShapeMeta =
      value.shapeMeta === undefined ||
      (isRecord(value.shapeMeta) &&
        ((value.shapeMeta.kind === 'polygon' &&
          isFiniteNumber(value.shapeMeta.sides) &&
          value.shapeMeta.sides >= 3 &&
          value.shapeMeta.sides <= 32) ||
          (value.shapeMeta.kind === 'star' &&
            isFiniteNumber(value.shapeMeta.spikes) &&
            value.shapeMeta.spikes >= 3 &&
            value.shapeMeta.spikes <= 32 &&
            isFiniteNumber(value.shapeMeta.innerRatio) &&
            value.shapeMeta.innerRatio >= 0.1 &&
            value.shapeMeta.innerRatio <= 0.95)));
    return (
      Array.isArray(value.points) &&
      value.points.length > 0 &&
      value.points.every(isVectorAnchorPoint) &&
      typeof value.closed === 'boolean' &&
      isPathStyle(value.style) &&
      (value.pathKind === undefined ||
        ['pen', 'curvature', 'pencil', 'line', 'arrow', 'polygon', 'star', 'boolean', 'outline'].includes(String(value.pathKind))) &&
      (value.subpaths === undefined || (Array.isArray(value.subpaths) && value.subpaths.every(isVectorSubpath))) &&
      validShapeMeta
    );
  }

  if (value.type === 'text') {
    if (!isString(value.text) || !isRecord(value.style)) return false;
    const style = value.style;
    return (
      isString(style.fill) &&
      isFiniteNumber(style.fontSize) && style.fontSize > 0 &&
      isString(style.fontFamily) &&
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
    if (
      !isString(value.assetId) || !value.assetId.trim() ||
      (value.alt !== undefined && !isString(value.alt)) ||
      (value.naturalWidth !== undefined && (!isFiniteNumber(value.naturalWidth) || value.naturalWidth <= 0)) ||
      (value.naturalHeight !== undefined && (!isFiniteNumber(value.naturalHeight) || value.naturalHeight <= 0)) ||
      !isRecord(value.style)
    ) {
      return false;
    }
    const style = value.style;
    return (
      IMAGE_FIT_VALUES.has(String(style.fit)) &&
      (style.radius === undefined || (isFiniteNumber(style.radius) && style.radius >= 0)) &&
      (style.stroke === undefined || isString(style.stroke)) &&
      (style.strokeWidth === undefined || (isFiniteNumber(style.strokeWidth) && style.strokeWidth >= 0))
    );
  }

  if (value.type === 'component-instance') {
    if (!isString(value.componentId) || !value.componentId || !isRecord(value.overrides) ||
        !isFiniteNumber(value.width) || value.width <= 0 ||
        !isFiniteNumber(value.height) || value.height <= 0) return false;
    const validOverrides = Object.values(value.overrides).every((override) =>
      isRecord(override) &&
      (override.fill === undefined || isString(override.fill)) &&
      (override.text === undefined || isString(override.text)),
    );
    if (!validOverrides) return false;
    if (value.variantSelection !== undefined) {
      if (!isRecord(value.variantSelection)) return false;
      const validSelection = Object.entries(value.variantSelection).every(([axisId, optionId]) =>
        isString(axisId) && axisId.length > 0 && isString(optionId) && optionId.length > 0,
      );
      if (!validSelection) return false;
    }
    if (value.slotAssignments !== undefined) {
      if (!isRecord(value.slotAssignments)) return false;
      const validSlots = Object.entries(value.slotAssignments).every(([slotId, assignment]) =>
        isString(slotId) && slotId.length > 0 &&
        isRecord(assignment) &&
        (assignment.text === undefined || isString(assignment.text)) &&
        (assignment.fill === undefined || isString(assignment.fill)) &&
        (assignment.visible === undefined || typeof assignment.visible === 'boolean'),
      );
      if (!validSlots) return false;
    }
    return true;
  }

  return false;
}

function isValidLayerHierarchy(nodes: readonly DesignNode[]): boolean {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    let parentId = node.parentId ?? undefined;
    const visited = new Set<string>([node.id]);
    while (parentId) {
      if (visited.has(parentId) || !nodeById.has(parentId)) return false;
      visited.add(parentId);
      parentId = nodeById.get(parentId)?.parentId ?? undefined;
    }
    if (node.clipMaskBaseId !== undefined) {
      if (node.clipMaskBaseId === node.id || !nodeById.has(node.clipMaskBaseId)) return false;
    }
  }
  return true;
}

function isDocument(value: unknown): value is FolioDocument {
  if (value !== null && typeof value === 'object' && deeplyFrozenObjects.has(value as object) && validatedFrozenDocuments.has(value as object)) {
    return true;
  }
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.length === 0 ||
    !isString(value.name) ||
    !isFiniteNumber(value.width) || value.width <= 0 ||
    !isFiniteNumber(value.height) || value.height <= 0 ||
    !isString(value.background) ||
    !Array.isArray(value.nodes)
  ) return false;

  for (let i = 0; i < value.nodes.length; i += 1) {
    if (!isValidatedDesignNode(value.nodes[i])) return false;
  }

  const nodes = value.nodes as DesignNode[];
  const ids = new Set<string>();
  for (let i = 0; i < nodes.length; i += 1) {
    const id = nodes[i].id;
    if (ids.has(id)) return false;
    ids.add(id);
  }
  if (!isValidLayerHierarchy(nodes)) return false;
  if (deeplyFrozenObjects.has(value as object)) {
    validatedFrozenDocuments.add(value as object);
  }
  return true;
}

function isMetadata(value: unknown): value is FolioProject['metadata'] {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) && value.id.length > 0 &&
    isString(value.name) && value.name.trim().length > 0 &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function validateEnvelope(input: unknown): string | null {
  if (!isRecord(input)) return 'The file does not contain a Folio project object.';
  if (input.format !== FOLIO_FORMAT) return 'This file is not a supported Folio project.';
  if (!isMetadata(input.metadata) || !isString(input.appVersion)) return 'Project metadata is incomplete or invalid.';
  return null;
}

export function validateProjectV1(input: unknown): LegacyValidationResult {
  const envelopeError = validateEnvelope(input);
  if (envelopeError) return { ok: false, error: envelopeError };
  if (!isRecord(input) || input.formatVersion !== FOLIO_LEGACY_FORMAT_VERSION) {
    return { ok: false, error: 'The file is not a supported version 1 Folio project.' };
  }
  if (!isDocument(input.document)) {
    return { ok: false, error: 'Legacy document dimensions, background or node list is invalid.' };
  }
  return { ok: true, project: input as unknown as FolioProjectV1 };
}

const LOGIC_VALUE_TYPES = new Set(['string', 'number', 'boolean', 'list', 'object']);
const LOGIC_VARIABLE_SCOPES = new Set(['local', 'global']);
const LOGIC_VARIABLE_PERSISTS = new Set(['none', 'local', 'session']);

export function isLogicVariableDefinition(value: unknown): value is import('./types').LogicVariableDefinition {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.trim().length === 0 || value.id.length > 128 ||
    !isString(value.name) || value.name.trim().length === 0 || value.name.length > 128 ||
    !isString(value.valueType) || !LOGIC_VALUE_TYPES.has(value.valueType)
  ) {
    return false;
  }
  if (value.description !== undefined && (!isString(value.description) || value.description.length > 512)) {
    return false;
  }
  if (value.scope !== undefined && (!isString(value.scope) || !LOGIC_VARIABLE_SCOPES.has(value.scope))) {
    return false;
  }
  if (value.persist !== undefined && (!isString(value.persist) || !LOGIC_VARIABLE_PERSISTS.has(value.persist))) {
    return false;
  }
  if (value.computed !== undefined && typeof value.computed !== 'boolean') {
    return false;
  }
  if (value.computedExpression !== undefined && (!isString(value.computedExpression) || value.computedExpression.length > 1024)) {
    return false;
  }
  if (value.valueType === 'string') return typeof value.initialValue === 'string';
  if (value.valueType === 'number') return isFiniteNumber(value.initialValue);
  if (value.valueType === 'boolean') return typeof value.initialValue === 'boolean';
  if (value.valueType === 'list') {
    return Array.isArray(value.initialValue) || typeof value.initialValue === 'string';
  }
  return isRecord(value.initialValue) || typeof value.initialValue === 'string';
}

export function isLogicNetworkSettings(value: unknown): value is import('./types').LogicNetworkSettings {
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'authToken')) return false;
  return (
    isString(value.baseUrl) && value.baseUrl.length <= 2048 &&
    isString(value.globalHeaders) && value.globalHeaders.length <= 8192 &&
    isString(value.authSecretRef) && value.authSecretRef.length <= 128
  );
}

export function isLogicGraph(value: unknown): value is import('./types').LogicGraph {
  if (!isRecord(value) || !isString(value.id) || value.id.trim().length === 0 || !isString(value.name) || value.name.trim().length === 0) return false;
  if (!['project', 'page', 'component'].includes(String(value.scope))) return false;
  if (value.scope === 'project') {
    if (value.targetId !== null) return false;
  } else if (!isString(value.targetId) || value.targetId.trim().length === 0) {
    return false;
  }
  if (!isString(value.createdAt) || !isString(value.updatedAt)) return false;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.connections)) return false;

  if (value.networkSettings !== undefined && !isLogicNetworkSettings(value.networkSettings)) {
    return false;
  }

  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables)) return false;
    const variableIds = new Set<string>();
    const variableNames = new Set<string>();
    for (const variable of value.variables) {
      if (!isLogicVariableDefinition(variable)) return false;
      const normalizedName = variable.name.trim().toLowerCase();
      if (variableIds.has(variable.id) || variableNames.has(normalizedName)) return false;
      variableIds.add(variable.id);
      variableNames.add(normalizedName);
    }
  }

  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (!isRecord(node) || !isString(node.id) || node.id.trim().length === 0 ||
        !isString(node.type) || node.type.trim().length === 0 ||
        !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isRecord(node.data)) return false;
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    if (!Object.values(node.data).every((item) =>
      item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      isFiniteNumber(item),
    )) return false;
  }

  const connectionIds = new Set<string>();
  for (const connection of value.connections) {
    if (!isRecord(connection) || !isString(connection.id) || connection.id.trim().length === 0 ||
        !isString(connection.sourceNodeId) || !isString(connection.sourcePortId) || connection.sourcePortId.trim().length === 0 ||
        !isString(connection.targetNodeId) || !isString(connection.targetPortId) || connection.targetPortId.trim().length === 0 ||
        !nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId)) return false;
    if (connectionIds.has(connection.id)) return false;
    connectionIds.add(connection.id);
  }

  if (value.frames !== undefined) {
    if (!Array.isArray(value.frames) || value.frames.length > 256) return false;
    const frameIds = new Set<string>();
    for (const frame of value.frames) {
      if (!isLogicFrame(frame, nodeIds)) return false;
      if (frameIds.has(frame.id)) return false;
      frameIds.add(frame.id);
    }
  }
  return true;
}

const LOGIC_FRAME_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'color', 'select']);

function isLogicFrameExposedParam(value: unknown): value is import('./types').LogicFrameExposedParam {
  return (
    isRecord(value) &&
    isString(value.paramId) && value.paramId.trim().length > 0 &&
    isString(value.nodeId) && value.nodeId.trim().length > 0 &&
    isString(value.field) && value.field.trim().length > 0 &&
    isString(value.label) && value.label.trim().length > 0 &&
    isString(value.type) && LOGIC_FRAME_PARAM_TYPES.has(value.type)
  );
}

function isLogicFrameBakedData(value: unknown): value is import('./types').LogicFrameBakedData {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.exposedInputs) ||
    !Array.isArray(value.exposedOutputs) ||
    !Array.isArray(value.exposedParams) ||
    !isRecord(value.compiledPlan)
  ) {
    return false;
  }
  for (const inp of value.exposedInputs) {
    if (
      !isRecord(inp) ||
      !isString(inp.portId) || inp.portId.trim().length === 0 ||
      !isString(inp.targetNodeId) || inp.targetNodeId.trim().length === 0 ||
      !isString(inp.targetPort) || inp.targetPort.trim().length === 0 ||
      !isString(inp.label) ||
      (inp.kind !== 'exec' && inp.kind !== 'data') ||
      (inp.dataType !== undefined && !isString(inp.dataType))
    ) {
      return false;
    }
  }
  for (const outp of value.exposedOutputs) {
    if (
      !isRecord(outp) ||
      !isString(outp.portId) || outp.portId.trim().length === 0 ||
      !isString(outp.sourceNodeId) || outp.sourceNodeId.trim().length === 0 ||
      !isString(outp.sourcePort) || outp.sourcePort.trim().length === 0 ||
      !isString(outp.label) ||
      (outp.kind !== 'exec' && outp.kind !== 'data') ||
      (outp.dataType !== undefined && !isString(outp.dataType))
    ) {
      return false;
    }
  }
  for (const param of value.exposedParams) {
    if (!isLogicFrameExposedParam(param)) return false;
  }
  const plan = value.compiledPlan;
  if (
    plan.version !== 1 ||
    !Array.isArray(plan.internalNodeIds) ||
    !plan.internalNodeIds.every((id) => isString(id) && id.trim().length > 0) ||
    !isRecord(plan.entryRoutes) ||
    !Array.isArray(plan.steps)
  ) {
    return false;
  }
  for (const step of plan.steps) {
    if (
      !isRecord(step) ||
      !isString(step.nodeId) || step.nodeId.trim().length === 0 ||
      !isFiniteNumber(step.order) ||
      !isRecord(step.nextByPort) ||
      !isRecord(step.dataInputs) ||
      !isRecord(step.externalExitsByPort)
    ) {
      return false;
    }
  }
  if (value.bakedAt !== undefined && !isString(value.bakedAt)) return false;
  return true;
}

export function isLogicFrame(
  value: unknown,
  validNodeIds?: ReadonlySet<string>,
): value is import('./types').LogicFrame {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.trim().length === 0 || value.id.length > 128 ||
    !isString(value.title) || value.title.trim().length === 0 || value.title.length > 128 ||
    !isString(value.color) || value.color.trim().length === 0 || value.color.length > 64 ||
    typeof value.isBaked !== 'boolean' ||
    !isRecord(value.bounds) ||
    !isFiniteNumber(value.bounds.x) ||
    !isFiniteNumber(value.bounds.y) ||
    !isFiniteNumber(value.bounds.width) || value.bounds.width < 40 ||
    !isFiniteNumber(value.bounds.height) || value.bounds.height < 40 ||
    !Array.isArray(value.childNodeIds)
  ) {
    return false;
  }
  const childSeen = new Set<string>();
  for (const cid of value.childNodeIds) {
    if (!isString(cid) || cid.trim().length === 0 || childSeen.has(cid)) return false;
    if (validNodeIds && !validNodeIds.has(cid)) return false;
    childSeen.add(cid);
  }
  if (value.exposedParams !== undefined) {
    if (!Array.isArray(value.exposedParams)) return false;
    for (const param of value.exposedParams) {
      if (!isLogicFrameExposedParam(param)) return false;
    }
  }
  if (value.bakedData !== undefined && !isLogicFrameBakedData(value.bakedData)) {
    return false;
  }
  return true;
}

export function isLogicFramePreset(value: unknown): value is import('./types').LogicFramePreset {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.trim().length === 0 || value.id.length > 128 ||
    !isString(value.name) || value.name.trim().length === 0 || value.name.length > 128 ||
    (value.description !== undefined && (!isString(value.description) || value.description.length > 512)) ||
    !isString(value.color) || value.color.trim().length === 0 ||
    !isString(value.createdAt) || value.createdAt.trim().length === 0 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.connections)
  ) {
    return false;
  }
  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (
      !isRecord(node) || !isString(node.id) || node.id.trim().length === 0 ||
      !isString(node.type) || node.type.trim().length === 0 ||
      !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isRecord(node.data)
    ) {
      return false;
    }
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    if (!Object.values(node.data).every((item) =>
      item === null || typeof item === 'string' || typeof item === 'boolean' || isFiniteNumber(item),
    )) {
      return false;
    }
  }
  const connIds = new Set<string>();
  for (const conn of value.connections) {
    if (
      !isRecord(conn) || !isString(conn.id) || conn.id.trim().length === 0 ||
      !isString(conn.sourceNodeId) || !isString(conn.sourcePortId) || conn.sourcePortId.trim().length === 0 ||
      !isString(conn.targetNodeId) || !isString(conn.targetPortId) || conn.targetPortId.trim().length === 0 ||
      !nodeIds.has(conn.sourceNodeId) || !nodeIds.has(conn.targetNodeId)
    ) {
      return false;
    }
    if (connIds.has(conn.id)) return false;
    connIds.add(conn.id);
  }
  return isLogicFrame(value.frame, nodeIds);
}

function isSafeAssetSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return true;
  if (/^(?:javascript|vbscript):/i.test(trimmed)) return false;
  if (/^data:\s*text\/html/i.test(trimmed)) return false;
  return true;
}

function isAssetReference(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.id) && value.id.trim().length > 0 &&
    isString(value.name) &&
    ['image', 'font', 'file'].includes(String(value.kind)) &&
    isString(value.mimeType) &&
    isString(value.source) && isSafeAssetSource(value.source) &&
    isString(value.createdAt) &&
    (value.sha256 === undefined || (isString(value.sha256) && SHA256_HEX_PATTERN.test(value.sha256))) &&
    (value.byteLength === undefined || (isFiniteNumber(value.byteLength) && value.byteLength >= 0)) &&
    (value.width === undefined || (isFiniteNumber(value.width) && value.width > 0)) &&
    (value.height === undefined || (isFiniteNumber(value.height) && value.height > 0));
}

const CODE_MODULE_LANGUAGES = new Set(['html', 'css', 'tsx', 'ts', 'js']);
const CODE_MODULE_PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export function isCodeModuleRecord(value: unknown): value is import('./types').CodeModuleRecord {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.trim().length === 0 || value.id.length > 128 ||
    !isString(value.path) || value.path.trim().length === 0 || value.path.length > 240 ||
    value.path.includes('..') || value.path.startsWith('/') || !CODE_MODULE_PATH_PATTERN.test(value.path) ||
    !isString(value.language) || !CODE_MODULE_LANGUAGES.has(value.language) ||
    (value.mapping !== 'custom' && value.mapping !== 'extension') ||
    !isString(value.content) || value.content.length > 200_000 ||
    !isString(value.updatedAt) || value.updatedAt.trim().length === 0
  ) {
    return false;
  }
  if (value.targetNodeId !== undefined && (!isString(value.targetNodeId) || value.targetNodeId.trim().length === 0)) {
    return false;
  }
  if (value.targetPageId !== undefined && (!isString(value.targetPageId) || value.targetPageId.trim().length === 0)) {
    return false;
  }
  if (value.description !== undefined && (!isString(value.description) || value.description.length > 512)) {
    return false;
  }
  return true;
}

export function isCodeModuleList(value: unknown): value is import('./types').CodeModuleRecord[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const item of value) {
    if (!isCodeModuleRecord(item)) return false;
    if (ids.has(item.id) || paths.has(item.path)) return false;
    ids.add(item.id);
    paths.add(item.path);
  }
  return true;
}

const ANIMATION_EASINGS_SET = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring']);
const ANIMATABLE_PROPERTIES_SET = new Set([
  'x',
  'y',
  'width',
  'height',
  'opacity',
  'rotation',
  'scale',
  'radius',
  'fill',
  'stroke',
  'strokeWidth',
]);
const SAFE_HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_FUNC_COLOR_PATTERN = /^(?:rgba?|hsla?)\(\s*[0-9.%\s,/+-]+\s*\)$/i;

export function isSafeAnimationColorValue(value: unknown): value is string {
  if (!isString(value)) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  if (trimmed === 'transparent') return true;
  return SAFE_HEX_COLOR_PATTERN.test(trimmed) || SAFE_FUNC_COLOR_PATTERN.test(trimmed);
}

export function isAnimationClip(value: unknown): value is import('./types').AnimationClip {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.trim().length === 0 || value.id.length > 128 ||
    !isString(value.name) || value.name.trim().length === 0 || value.name.length > 128 ||
    !isString(value.pageId) || value.pageId.trim().length === 0 || value.pageId.length > 128 ||
    !isFiniteNumber(value.durationMs) || value.durationMs < 100 || value.durationMs > 60_000 ||
    typeof value.loop !== 'boolean' ||
    typeof value.autoplay !== 'boolean' ||
    !Array.isArray(value.tracks) || value.tracks.length > 256 ||
    !isString(value.createdAt) || value.createdAt.trim().length === 0 ||
    !isString(value.updatedAt) || value.updatedAt.trim().length === 0
  ) {
    return false;
  }

  const trackIds = new Set<string>();
  const trackKeys = new Set<string>();
  for (const track of value.tracks) {
    if (
      !isRecord(track) ||
      !isString(track.id) || track.id.trim().length === 0 || track.id.length > 128 ||
      !isString(track.targetNodeId) || track.targetNodeId.trim().length === 0 || track.targetNodeId.length > 128 ||
      !isString(track.property) || !ANIMATABLE_PROPERTIES_SET.has(track.property) ||
      !Array.isArray(track.keyframes) || track.keyframes.length > 256
    ) {
      return false;
    }
    const pairKey = `${track.targetNodeId}:${track.property}`;
    if (trackIds.has(track.id) || trackKeys.has(pairKey)) return false;
    trackIds.add(track.id);
    trackKeys.add(pairKey);

    const keyframeIds = new Set<string>();
    for (const kf of track.keyframes) {
      if (
        !isRecord(kf) ||
        !isString(kf.id) || kf.id.trim().length === 0 || kf.id.length > 128 ||
        !isFiniteNumber(kf.timeMs) || kf.timeMs < 0 || kf.timeMs > value.durationMs ||
        !isString(kf.easing) || !ANIMATION_EASINGS_SET.has(kf.easing)
      ) {
        return false;
      }
      if (keyframeIds.has(kf.id)) return false;
      keyframeIds.add(kf.id);

      if (track.property === 'fill' || track.property === 'stroke') {
        if (!isSafeAnimationColorValue(kf.value)) return false;
      } else {
        if (!isFiniteNumber(kf.value)) return false;
        if (track.property === 'opacity' && (kf.value < 0 || kf.value > 1)) return false;
        if (track.property === 'scale' && (kf.value < 0.05 || kf.value > 10)) return false;
        if ((track.property === 'width' || track.property === 'height') && (kf.value < 1 || kf.value > 20000)) return false;
        if ((track.property === 'radius' || track.property === 'strokeWidth') && (kf.value < 0 || kf.value > 2000)) return false;
      }
    }
  }
  return true;
}

export function isAnimationClipList(value: unknown): value is import('./types').AnimationClip[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isAnimationClip(item)) return false;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function validateComponentInstanceReference(
  node: Extract<DesignNode, { type: 'component-instance' }>,
  ownerLabel: string,
  componentsById: ReadonlyMap<string, ComponentDefinition>,
  masterNodesCache: Map<string, Map<string, DesignNode>>,
): string | null {
  const master = componentsById.get(node.componentId);
  if (!master) {
    return `${ownerLabel} references missing component: ${node.componentId}.`;
  }
  let masterNodesById = masterNodesCache.get(master.id);
  if (!masterNodesById) {
    masterNodesById = new Map(master.document.nodes.map((child) => [child.id, child]));
    masterNodesCache.set(master.id, masterNodesById);
  }
  for (const [childId, override] of Object.entries(node.overrides)) {
    const targetNode = masterNodesById.get(childId);
    if (!targetNode) {
      return `An instance of ${node.componentId} contains an override for a missing master layer.`;
    }
    if (override.text !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'text')) {
      return `An instance of ${node.componentId} overrides "text" on incompatible ${targetNode.type} layer "${targetNode.name}".`;
    }
    if (override.fill !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'fill')) {
      return `An instance of ${node.componentId} overrides "fill" on incompatible ${targetNode.type} layer "${targetNode.name}".`;
    }
  }
  if (node.variantSelection) {
    const axisById = new Map((master.variants ?? []).map((axis) => [axis.id, axis]));
    for (const [axisId, optionId] of Object.entries(node.variantSelection)) {
      const axis = axisById.get(axisId);
      if (!axis) {
        return `An instance of ${node.componentId} selects unknown variant axis "${axisId}".`;
      }
      if (!axis.options.some((opt) => opt.id === optionId)) {
        return `An instance of ${node.componentId} selects unknown option "${optionId}" for variant axis "${axis.name}".`;
      }
    }
  }
  if (node.slotAssignments) {
    const slotById = new Map((master.slots ?? []).map((slot) => [slot.id, slot]));
    for (const [slotId, assignment] of Object.entries(node.slotAssignments)) {
      const slot = slotById.get(slotId);
      if (!slot) {
        return `An instance of ${node.componentId} assigns unknown slot "${slotId}".`;
      }
      const targetNode = masterNodesById.get(slot.targetNodeId);
      if (!targetNode) {
        return `Slot "${slot.name}" on ${node.componentId} references missing master layer "${slot.targetNodeId}".`;
      }
      if (assignment.text !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'text')) {
        return `Slot "${slot.name}" on ${node.componentId} cannot assign "text" to ${targetNode.type} layer "${targetNode.name}".`;
      }
      if (assignment.fill !== undefined && !isOverrideFieldCompatibleWithNodeType(targetNode.type, 'fill')) {
        return `Slot "${slot.name}" on ${node.componentId} cannot assign "fill" to ${targetNode.type} layer "${targetNode.name}".`;
      }
    }
  }
  return null;
}

/**
 * Enforces that nested component instances form a strict Directed Acyclic Graph (DAG)
 * with bounded nesting depth (<= MAX_COMPONENT_NESTING_DEPTH).
 */
export function validateComponentGraphAcyclic(
  components: readonly ComponentDefinition[],
): string | null {
  const byId = new Map(components.map((c) => [c.id, c]));
  // 0 = unvisited, 1 = visiting (active recursion stack), 2 = verified acyclic
  const state = new Map<string, number>();

  const dfs = (compId: string, depth: number, chain: string[]): string | null => {
    if (depth > MAX_COMPONENT_NESTING_DEPTH) {
      return `Component nesting exceeds maximum allowed depth (${MAX_COMPONENT_NESTING_DEPTH}): ${chain.join(' -> ')}.`;
    }
    const status = state.get(compId) ?? 0;
    if (status === 1) {
      return `Circular component nesting detected: ${[...chain, compId].join(' -> ')}.`;
    }
    if (status === 2) return null;

    state.set(compId, 1);
    const comp = byId.get(compId);
    if (comp) {
      for (const node of comp.document.nodes) {
        if (node.type === 'component-instance') {
          if (node.componentId === compId) {
            return `Circular component nesting detected: component "${comp.name}" cannot contain an instance of itself.`;
          }
          const err = dfs(node.componentId, depth + 1, [...chain, compId]);
          if (err) return err;
        }
      }
    }
    state.set(compId, 2);
    return null;
  };

  for (const comp of components) {
    const err = dfs(comp.id, 0, []);
    if (err) return err;
  }
  return null;
}

function validateComponentCrossChecks(
  component: ComponentDefinition,
  projectDesignTokens: DesignTokenCollection | undefined,
  componentsRef: readonly ComponentDefinition[],
  componentsById: ReadonlyMap<string, ComponentDefinition>,
  masterNodesCache: Map<string, Map<string, DesignNode>>,
): string | null {
  const tokenKey = projectDesignTokens ?? null;
  const isFrozen = deeplyFrozenObjects.has(component as unknown as object);
  const tokensFrozen = projectDesignTokens === undefined || deeplyFrozenObjects.has(projectDesignTokens as unknown as object);
  const componentsFrozen = deeplyFrozenObjects.has(componentsRef as unknown as object);
  if (isFrozen && tokensFrozen && componentsFrozen) {
    const cached = validatedFrozenComponentsContext.get(component as unknown as object);
    if (cached && cached.tokens === tokenKey && cached.components === componentsRef) {
      return null;
    }
  }

  for (let i = 0; i < component.document.nodes.length; i += 1) {
    const node = component.document.nodes[i];
    if (node.type === 'component-instance') {
      const refErr = validateComponentInstanceReference(
        node,
        `Component "${component.name}"`,
        componentsById,
        masterNodesCache,
      );
      if (refErr) return refErr;
    }
    const tokenCheck = validateNodeTokenBindings(node, projectDesignTokens);
    if (!tokenCheck.ok) {
      return `Component "${component.name}": ${tokenCheck.error}`;
    }
  }

  if (isFrozen && tokensFrozen && componentsFrozen) {
    validatedFrozenComponentsContext.set(component as unknown as object, {
      tokens: tokenKey,
      components: componentsRef,
    });
  }
  return null;
}

function validatePageCrossChecks(
  page: { name: string; document: FolioDocument },
  projectDesignTokens: DesignTokenCollection | undefined,
  componentsRef: readonly ComponentDefinition[],
  componentsById: ReadonlyMap<string, ComponentDefinition>,
  masterNodesCache: Map<string, Map<string, DesignNode>>,
): string | null {
  const tokenKey = projectDesignTokens ?? null;
  const pageFrozen = deeplyFrozenObjects.has(page as unknown as object);
  const tokensFrozen = projectDesignTokens === undefined || deeplyFrozenObjects.has(projectDesignTokens as unknown as object);
  const componentsFrozen = deeplyFrozenObjects.has(componentsRef as unknown as object);
  if (pageFrozen && tokensFrozen && componentsFrozen) {
    const cached = validatedFrozenPagesContext.get(page as unknown as object);
    if (cached && cached.tokens === tokenKey && cached.components === componentsRef) {
      return null;
    }
  }

  const nodes = page.document.nodes;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.tokenBindings !== undefined) {
      const tokenCheck = validateNodeTokenBindings(node, projectDesignTokens);
      if (!tokenCheck.ok) {
        return `Page "${page.name}": ${tokenCheck.error}`;
      }
    }
    if (node.type === 'component-instance') {
      const refErr = validateComponentInstanceReference(
        node,
        'A page',
        componentsById,
        masterNodesCache,
      );
      if (refErr) return refErr;
    }
  }

  if (pageFrozen && tokensFrozen && componentsFrozen) {
    validatedFrozenPagesContext.set(page as unknown as object, {
      tokens: tokenKey,
      components: componentsRef,
    });
  }
  return null;
}

export function validateProject(input: unknown): ValidationResult {
  const envelopeError = validateEnvelope(input);
  if (envelopeError) return { ok: false, error: envelopeError };

  if (!isRecord(input) || input.formatVersion !== FOLIO_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported .flop format version: ${String(isRecord(input) ? input.formatVersion : 'unknown')}. This build supports version ${FOLIO_FORMAT_VERSION}.`,
    };
  }

  if (!isString(input.activePageId) ||
      !Array.isArray(input.pages) || input.pages.length === 0 ||
      !Array.isArray(input.components) ||
      !Array.isArray(input.logicGraphs) ||
      !Array.isArray(input.assets)) {
    return { ok: false, error: 'Project pages, components, logic graphs or assets are missing.' };
  }

  if (input.designTokens !== undefined) {
    const tokensFrozen = deeplyFrozenObjects.has(input.designTokens as object);
    if (!(tokensFrozen && validatedFrozenTokens.has(input.designTokens as object))) {
      if (!isDesignTokenCollection(input.designTokens)) {
        return { ok: false, error: 'Project design tokens contain invalid values, missing themes, or cyclic/incompatible aliases.' };
      }
      if (tokensFrozen) validatedFrozenTokens.add(input.designTokens as object);
    }
  }

  if (input.codeModules !== undefined) {
    const modulesFrozen = deeplyFrozenObjects.has(input.codeModules as object);
    if (!(modulesFrozen && validatedFrozenCodeModules.has(input.codeModules as object))) {
      if (!isCodeModuleList(input.codeModules)) {
        return { ok: false, error: 'Project code modules contain invalid paths, duplicate IDs, or unsupported mappings.' };
      }
      if (modulesFrozen) validatedFrozenCodeModules.add(input.codeModules as object);
    }
  }

  const pageIds = new Set<string>();
  const routes = new Set<string>();
  for (let i = 0; i < input.pages.length; i += 1) {
    const page = input.pages[i];
    if (!isRecord(page) || !isString(page.id) || !page.id ||
        !isString(page.name) || !page.name.trim() ||
        !isString(page.route) || !page.route.startsWith('/') ||
        !isDocument(page.document)) {
      return { ok: false, error: 'One or more pages contain invalid route or document data.' };
    }
    if (pageIds.has(page.id)) return { ok: false, error: 'Page IDs must be unique within a project.' };
    if (routes.has(page.route)) return { ok: false, error: 'Page routes must be unique within a project.' };
    pageIds.add(page.id);
    routes.add(page.route);
  }

  if (!pageIds.has(input.activePageId)) {
    return { ok: false, error: 'The active page ID does not belong to this project.' };
  }

  const componentIds = new Set<string>();
  const componentsArray = input.components as unknown as ComponentDefinition[];
  const projectDesignTokens = input.designTokens as DesignTokenCollection | undefined;
  const masterNodesCache = new Map<string, Map<string, DesignNode>>();

  for (let i = 0; i < input.components.length; i += 1) {
    const component = input.components[i];
    if (!isRecord(component) || !isString(component.id) || !component.id ||
        !isString(component.name) || !component.name.trim() ||
        !isString(component.createdAt) || !isString(component.updatedAt) ||
        !isDocument(component.document)) {
      return { ok: false, error: 'One or more component definitions are invalid.' };
    }
    if (componentIds.has(component.id)) return { ok: false, error: 'Component IDs must be unique within a project.' };

    const compFrozen = deeplyFrozenObjects.has(component as object);
    const tokensFrozen = projectDesignTokens === undefined || deeplyFrozenObjects.has(projectDesignTokens as unknown as object);
    const componentsFrozen = deeplyFrozenObjects.has(componentsArray as unknown as object);
    const cachedCompEntry = compFrozen ? validatedFrozenComponentsContext.get(component as object) : undefined;
    const cachedCompValid = Boolean(
      compFrozen &&
      tokensFrozen &&
      componentsFrozen &&
      cachedCompEntry &&
      cachedCompEntry.tokens === (projectDesignTokens ?? null) &&
      cachedCompEntry.components === componentsArray,
    );

    if (!cachedCompValid) {
      const masterNodesById = new Map((component.document as FolioDocument).nodes.map((node) => [node.id, node]));
      masterNodesCache.set(component.id, masterNodesById);
      if (component.variants !== undefined && !isComponentVariantsList(component.variants, masterNodesById)) {
        return { ok: false, error: `Component "${component.name}" contains invalid variant definitions.` };
      }
      if (component.slots !== undefined && !isComponentSlotsList(component.slots, masterNodesById)) {
        return { ok: false, error: `Component "${component.name}" contains invalid slot definitions.` };
      }
      if (component.nodeLogicEnabled !== undefined && typeof component.nodeLogicEnabled !== 'boolean') {
        return { ok: false, error: `Component "${component.name}" contains an invalid nodeLogicEnabled flag.` };
      }
    }
    componentIds.add(component.id);
  }

  const componentsById = new Map(componentsArray.map((component) => [component.id, component]));
  for (let i = 0; i < componentsArray.length; i += 1) {
    const compErr = validateComponentCrossChecks(
      componentsArray[i],
      projectDesignTokens,
      componentsArray,
      componentsById,
      masterNodesCache,
    );
    if (compErr) return { ok: false, error: compErr };
  }

  const dagError = validateComponentGraphAcyclic(componentsArray);
  if (dagError) return { ok: false, error: dagError };

  const pagesArray = input.pages as Array<{ name: string; document: FolioDocument }>;
  for (let i = 0; i < pagesArray.length; i += 1) {
    const pageErr = validatePageCrossChecks(
      pagesArray[i],
      projectDesignTokens,
      componentsArray,
      componentsById,
      masterNodesCache,
    );
    if (pageErr) return { ok: false, error: pageErr };
  }

  const logicFrozen = deeplyFrozenObjects.has(input.logicGraphs as object);
  const pagesFrozen = deeplyFrozenObjects.has(input.pages as object);
  const componentsFrozenForLogic = deeplyFrozenObjects.has(input.components as object);
  const cachedLogicCtx = logicFrozen
    ? validatedFrozenLogicGraphsContext.get(input.logicGraphs as object)
    : undefined;
  const logicContextValid = Boolean(
    logicFrozen &&
    pagesFrozen &&
    componentsFrozenForLogic &&
    cachedLogicCtx &&
    cachedLogicCtx.pages === input.pages &&
    cachedLogicCtx.components === input.components,
  );
  if (!logicContextValid) {
    const graphIds = new Set<string>();
    for (const graph of input.logicGraphs) {
      if (!isLogicGraph(graph)) {
        return { ok: false, error: 'One or more logic graphs contain invalid variables, nodes, or connections.' };
      }
      if (graphIds.has(graph.id)) {
        return { ok: false, error: 'Logic graph IDs must be unique within a project.' };
      }
      graphIds.add(graph.id);
      if (graph.scope === 'page' && (!graph.targetId || !pageIds.has(graph.targetId))) {
        return { ok: false, error: `Logic graph "${graph.name}" references missing page "${String(graph.targetId)}".` };
      }
      if (graph.scope === 'component' && (!graph.targetId || !componentIds.has(graph.targetId))) {
        return { ok: false, error: `Logic graph "${graph.name}" references missing component "${String(graph.targetId)}".` };
      }
    }
    if (logicFrozen && pagesFrozen && componentsFrozenForLogic) {
      validatedFrozenLogicGraphsContext.set(input.logicGraphs as object, {
        pages: input.pages,
        components: input.components,
      });
    }
  }

  if (input.animations !== undefined) {
    const animFrozen = deeplyFrozenObjects.has(input.animations as object);
    const animContextValid = Boolean(
      animFrozen &&
      pagesFrozen &&
      validatedFrozenAnimationsContext.get(input.animations as object) === input.pages,
    );
    if (!animContextValid) {
      if (!isAnimationClipList(input.animations)) {
        return { ok: false, error: 'Project animations contain invalid clip timing, tracks, keyframes, or duplicate IDs.' };
      }
      for (const clip of input.animations) {
        if (!pageIds.has(clip.pageId)) {
          return { ok: false, error: `Animation clip "${clip.name}" references missing page "${clip.pageId}".` };
        }
      }
      if (animFrozen && pagesFrozen) {
        validatedFrozenAnimationsContext.set(input.animations as object, input.pages);
      }
    }
  }

  if (input.logicFramePresets !== undefined) {
    if (!Array.isArray(input.logicFramePresets) || input.logicFramePresets.length > 128) {
      return { ok: false, error: 'Project logic frame presets must be an array of valid frame presets.' };
    }
    const presetIds = new Set<string>();
    for (const preset of input.logicFramePresets) {
      if (!isLogicFramePreset(preset)) {
        return { ok: false, error: 'One or more saved logic frame presets contain invalid data.' };
      }
      if (presetIds.has(preset.id)) {
        return { ok: false, error: 'Logic frame preset IDs must be unique within a project.' };
      }
      presetIds.add(preset.id);
    }
  }

  const assetsFrozen = deeplyFrozenObjects.has(input.assets as object);
  if (!(assetsFrozen && validatedFrozenAssets.has(input.assets as object))) {
    if (!input.assets.every(isAssetReference)) {
      return { ok: false, error: 'One or more asset references are invalid.' };
    }
    if (assetsFrozen) validatedFrozenAssets.add(input.assets as object);
  }

  return { ok: true, project: input as unknown as FolioProject };
}

/**
 * Incremental project validator against a previously validated, deeply frozen
 * canonical project. Unchanged deeply frozen pages, components, tokens, code
 * modules, and nodes bypass redundant O(N) re-validation while maintaining
 * 100% equivalence with full validateProject().
 */
export function validateProjectIncremental(
  previousValidProject: FolioProject | null | undefined,
  candidateInput: unknown,
): ValidationResult {
  if (
    previousValidProject &&
    candidateInput === previousValidProject &&
    deeplyFrozenObjects.has(previousValidProject as unknown as object)
  ) {
    return { ok: true, project: previousValidProject };
  }
  return validateProject(candidateInput);
}

export function requireValidProject(input: unknown): FolioProject {
  const result = validateProject(input);
  if (!result.ok || !result.project) {
    throw new Error(result.error ?? 'Invalid Folio project.');
  }
  return result.project;
}

export function requireValidProjectV1(input: unknown): FolioProjectV1 {
  const result = validateProjectV1(input);
  if (!result.ok || !result.project) {
    throw new Error(result.error ?? 'Invalid legacy Folio project.');
  }
  return result.project;
}

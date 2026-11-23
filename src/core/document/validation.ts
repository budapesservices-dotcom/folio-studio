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
import { validateDesignTokenCollection } from './tokens';

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

export const SEMANTIC_HTML_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside',
  'button', 'a', 'h1', 'h2', 'h3', 'p', 'span', 'ul', 'li', 'form', 'input',
]);

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

export function isComponentVariantsList(value: unknown, validNodeIds?: ReadonlySet<string>): boolean {
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
        if (validNodeIds && !validNodeIds.has(nodeId)) return false;
      }
    }
    if (!optionIds.has(axis.defaultOptionId)) return false;
  }
  return true;
}

export function isComponentSlotsList(value: unknown, validNodeIds?: ReadonlySet<string>): boolean {
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
    if (validNodeIds && !validNodeIds.has(slot.targetNodeId)) return false;
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
    (value.tokenBindings === undefined || isNodeTokenBindings(value.tokenBindings))
  );
}

function isShapeStyle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.fill) &&
    isString(value.stroke) &&
    isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 &&
    (value.radius === undefined || (isFiniteNumber(value.radius) && value.radius >= 0))
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
    (value.arrowEnd === undefined || typeof value.arrowEnd === 'boolean')
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
          value.shapeMeta.sides <= 24) ||
          (value.shapeMeta.kind === 'star' &&
            isFiniteNumber(value.shapeMeta.spikes) &&
            value.shapeMeta.spikes >= 3 &&
            value.shapeMeta.spikes <= 24 &&
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
      isFiniteNumber(style.lineHeight) && style.lineHeight > 0
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
  if (!isRecord(value)) return false;
  if (
    !isString(value.id) || value.id.length === 0 ||
    !isString(value.name) ||
    !isFiniteNumber(value.width) || value.width <= 0 ||
    !isFiniteNumber(value.height) || value.height <= 0 ||
    !isString(value.background) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isDesignNode)
  ) return false;

  const nodes = value.nodes as DesignNode[];
  const ids = nodes.map((node) => node.id);
  return new Set(ids).size === ids.length && isValidLayerHierarchy(nodes);
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

function isLogicGraph(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return false;
  if (!['project', 'page', 'component'].includes(String(value.scope))) return false;
  if (value.targetId !== null && !isString(value.targetId)) return false;
  if (!isString(value.createdAt) || !isString(value.updatedAt)) return false;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.connections)) return false;

  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (!isRecord(node) || !isString(node.id) || !isString(node.type) ||
        !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isRecord(node.data)) return false;
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    if (!Object.values(node.data).every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) return false;
  }

  const connectionIds = new Set<string>();
  for (const connection of value.connections) {
    if (!isRecord(connection) || !isString(connection.id) ||
        !isString(connection.sourceNodeId) || !isString(connection.sourcePortId) ||
        !isString(connection.targetNodeId) || !isString(connection.targetPortId) ||
        !nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId)) return false;
    if (connectionIds.has(connection.id)) return false;
    connectionIds.add(connection.id);
  }
  return true;
}

function isAssetReference(value: unknown): boolean {
  return isRecord(value) &&
    isString(value.id) && isString(value.name) &&
    ['image', 'font', 'file'].includes(String(value.kind)) &&
    isString(value.mimeType) && isString(value.source) &&
    isString(value.createdAt);
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

  if (input.designTokens !== undefined && !isDesignTokenCollection(input.designTokens)) {
    return { ok: false, error: 'Project design tokens contain invalid values, missing themes, or cyclic/incompatible aliases.' };
  }

  if (input.codeModules !== undefined && !isCodeModuleList(input.codeModules)) {
    return { ok: false, error: 'Project code modules contain invalid paths, duplicate IDs, or unsupported mappings.' };
  }

  const pageIds = new Set<string>();
  const routes = new Set<string>();
  for (const page of input.pages) {
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
  for (const component of input.components) {
    if (!isRecord(component) || !isString(component.id) || !component.id ||
        !isString(component.name) || !component.name.trim() ||
        !isString(component.createdAt) || !isString(component.updatedAt) ||
        !isDocument(component.document)) {
      return { ok: false, error: 'One or more component definitions are invalid.' };
    }
    if (componentIds.has(component.id)) return { ok: false, error: 'Component IDs must be unique within a project.' };
    const masterNodeIds = new Set((component.document as FolioDocument).nodes.map((node) => node.id));
    if (component.variants !== undefined && !isComponentVariantsList(component.variants, masterNodeIds)) {
      return { ok: false, error: `Component "${component.name}" contains invalid variant definitions.` };
    }
    if (component.slots !== undefined && !isComponentSlotsList(component.slots, masterNodeIds)) {
      return { ok: false, error: `Component "${component.name}" contains invalid slot definitions.` };
    }
    componentIds.add(component.id);
  }

  for (const component of input.components as Array<Record<string, unknown>>) {
    const definitionDocument = component.document as FolioDocument;
    if (definitionDocument.nodes.some((node) => node.type === 'component-instance')) {
      return { ok: false, error: 'Nested component instances are not supported inside master definitions.' };
    }
  }

  const componentsById = new Map((input.components as unknown as ComponentDefinition[]).map((component) => [component.id, component]));
  for (const page of input.pages as Array<{ document: FolioDocument }>) {
    for (const node of page.document.nodes) {
      if (node.type === 'component-instance') {
        const master = componentsById.get(node.componentId);
        if (!master) {
          return { ok: false, error: `A page references missing component: ${node.componentId}.` };
        }
        const childIds = new Set(master.document.nodes.map((child) => child.id));
        if (Object.keys(node.overrides).some((childId) => !childIds.has(childId))) {
          return { ok: false, error: `An instance of ${node.componentId} contains an override for a missing master layer.` };
        }
      }
    }
  }

  if (!input.logicGraphs.every(isLogicGraph)) {
    return { ok: false, error: 'One or more logic graphs contain invalid nodes or connections.' };
  }
  if (!input.assets.every(isAssetReference)) {
    return { ok: false, error: 'One or more asset references are invalid.' };
  }

  return { ok: true, project: input as unknown as FolioProject };
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

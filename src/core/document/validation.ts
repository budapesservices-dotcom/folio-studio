import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  FOLIO_LEGACY_FORMAT_VERSION,
  type DesignNode,
  type FolioDocument,
  type FolioProject,
  type FolioProjectV1,
} from './types';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
    (value.clipMaskBaseId === undefined || (isString(value.clipMaskBaseId) && value.clipMaskBaseId.length > 0))
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
    return (
      Array.isArray(value.points) &&
      value.points.length > 0 &&
      value.points.every(isVectorAnchorPoint) &&
      typeof value.closed === 'boolean' &&
      isPathStyle(value.style) &&
      (value.pathKind === undefined ||
        ['pen', 'curvature', 'pencil', 'line', 'arrow', 'polygon', 'star', 'boolean', 'outline'].includes(String(value.pathKind))) &&
      (value.subpaths === undefined || (Array.isArray(value.subpaths) && value.subpaths.every(isVectorSubpath)))
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
    return Object.values(value.overrides).every((override) =>
      isRecord(override) &&
      (override.fill === undefined || isString(override.fill)) &&
      (override.text === undefined || isString(override.text)),
    );
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
    componentIds.add(component.id);
  }

  for (const component of input.components as Array<Record<string, unknown>>) {
    const definitionDocument = component.document as FolioDocument;
    if (definitionDocument.nodes.some((node) => node.type === 'component-instance')) {
      return { ok: false, error: 'Nested component instances are not supported inside master definitions.' };
    }
  }

  const knownComponentIds = new Set((input.components as Array<{ id: string }>).map((component) => component.id));
  for (const page of input.pages as Array<{ document: FolioDocument }>) {
    for (const node of page.document.nodes) {
      if (node.type === 'component-instance') {
        if (!knownComponentIds.has(node.componentId)) {
          return { ok: false, error: `A page references missing component: ${node.componentId}.` };
        }
        const master = (input.components as Array<{ id: string; document: FolioDocument }>).find((item) => item.id === node.componentId)!;
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

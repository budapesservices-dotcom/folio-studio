import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  type DesignNode,
  type FolioProject,
} from './types';

export interface ValidationResult {
  ok: boolean;
  project?: FolioProject;
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
    isString(value.id) &&
    isString(value.name) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width >= 0 &&
    isFiniteNumber(value.height) &&
    value.height >= 0 &&
    isFiniteNumber(value.rotation) &&
    isFiniteNumber(value.opacity) &&
    value.opacity >= 0 &&
    value.opacity <= 1 &&
    typeof value.visible === 'boolean' &&
    typeof value.locked === 'boolean'
  );
}

function isShapeStyle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.fill) &&
    isString(value.stroke) &&
    isFiniteNumber(value.strokeWidth) &&
    (value.radius === undefined || isFiniteNumber(value.radius))
  );
}

function isDesignNode(value: unknown): value is DesignNode {
  if (!isRecord(value) || !isCommonNode(value)) return false;

  if (value.type === 'rect' || value.type === 'ellipse') {
    return isShapeStyle(value.style);
  }

  if (value.type === 'text') {
    if (!isString(value.text) || !isRecord(value.style)) return false;
    const style = value.style;
    return (
      isString(style.fill) &&
      isFiniteNumber(style.fontSize) &&
      isString(style.fontFamily) &&
      isFiniteNumber(style.fontWeight) &&
      isFiniteNumber(style.letterSpacing) &&
      isFiniteNumber(style.lineHeight)
    );
  }

  return false;
}

export function validateProject(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: 'The file does not contain a Folio project object.' };
  }

  if (input.format !== FOLIO_FORMAT) {
    return { ok: false, error: 'This file is not a supported Folio project.' };
  }

  if (input.formatVersion !== FOLIO_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported .flop format version: ${String(input.formatVersion)}. This build supports version ${FOLIO_FORMAT_VERSION}.`,
    };
  }

  if (!isRecord(input.metadata) || !isRecord(input.document)) {
    return { ok: false, error: 'Project metadata or document data is missing.' };
  }

  const metadata = input.metadata;
  const document = input.document;

  if (
    !isString(metadata.id) ||
    !isString(metadata.name) ||
    !isString(metadata.createdAt) ||
    !isString(metadata.updatedAt) ||
    !isString(input.appVersion)
  ) {
    return { ok: false, error: 'Project metadata is incomplete or invalid.' };
  }

  if (
    !isString(document.id) ||
    !isString(document.name) ||
    !isFiniteNumber(document.width) ||
    document.width <= 0 ||
    !isFiniteNumber(document.height) ||
    document.height <= 0 ||
    !isString(document.background) ||
    !Array.isArray(document.nodes)
  ) {
    return { ok: false, error: 'Document dimensions, background or node list is invalid.' };
  }

  if (!document.nodes.every(isDesignNode)) {
    return { ok: false, error: 'One or more layers contain unsupported or invalid data.' };
  }

  const ids = (document.nodes as DesignNode[]).map((node) => node.id);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'Layer IDs must be unique within a document.' };
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

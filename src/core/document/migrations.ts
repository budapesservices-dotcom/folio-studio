import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  type FolioProject,
  type FolioProjectV1,
} from './types';
import { requireValidProject, requireValidProjectV1 } from './validation';

/**
 * Wrap a valid single-document v1 project in the unified v2 aggregate.
 * The legacy document ID, geometry, layers and styling are preserved.
 */
export function migrateProjectV1ToV2(input: FolioProjectV1): FolioProject {
  const legacy = requireValidProjectV1(input);
  const legacyProjectFields = { ...(input as unknown as Record<string, unknown>) };
  delete legacyProjectFields.document;
  const pageId = 'page-main';

  return {
    // Preserve v1 extension fields that this version does not interpret.
    ...legacyProjectFields,
    format: FOLIO_FORMAT,
    formatVersion: FOLIO_FORMAT_VERSION,
    appVersion: legacy.appVersion,
    metadata: { ...legacy.metadata },
    activePageId: pageId,
    pages: [{
      id: pageId,
      name: 'Main Page',
      route: '/',
      document: {
        ...legacy.document,
        name: 'Main Page',
        nodes: legacy.document.nodes.map((node) => ({ ...node })),
      },
    }],
    components: [],
    logicGraphs: [],
    assets: [],
  };
}

/** Normalize any supported native project version to the current v2 schema. */
export function migrateProjectToV2(input: unknown): FolioProject {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('The file does not contain a Folio project object.');
  }

  const version = (input as { formatVersion?: unknown }).formatVersion;
  if (version === 1) return migrateProjectV1ToV2(input as FolioProjectV1);
  if (version === FOLIO_FORMAT_VERSION) {
    const candidate = input as Record<string, unknown>;
    if (Array.isArray(candidate.pages) && candidate.pages.length > 0) {
      const activePageExists = candidate.pages.some(
        (page) => typeof page === 'object' && page !== null &&
          (page as { id?: unknown }).id === candidate.activePageId,
      );
      if (!activePageExists) {
        const firstPage = candidate.pages[0] as { id?: unknown };
        if (typeof firstPage?.id === 'string') {
          return requireValidProject({ ...candidate, activePageId: firstPage.id });
        }
      }
    }
    return requireValidProject(input);
  }

  throw new Error(`Unsupported .flop format version: ${String(version)}.`);
}

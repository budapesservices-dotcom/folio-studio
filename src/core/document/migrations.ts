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

const SAFE_LEGACY_SECRET_REF = /^(?:env:)?[A-Z][A-Z0-9_]{1,63}$/i;

function normalizeLegacyNetworkSettingsOnGraphs(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(candidate.logicGraphs)) return candidate;
  let mutated = false;
  const nextGraphs = candidate.logicGraphs.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return entry;
    }
    const graphRecord = entry as Record<string, unknown>;
    const rawSettings = graphRecord.networkSettings;
    if (typeof rawSettings !== 'object' || rawSettings === null || Array.isArray(rawSettings)) {
      return entry;
    }
    const settingsRecord = rawSettings as Record<string, unknown>;
    const hasLegacyAuthToken = Object.prototype.hasOwnProperty.call(settingsRecord, 'authToken');
    const missingSecretRef = typeof settingsRecord.authSecretRef !== 'string';
    if (!hasLegacyAuthToken && !missingSecretRef) {
      return entry;
    }
    mutated = true;
    const legacyToken = typeof settingsRecord.authToken === 'string' ? settingsRecord.authToken.trim() : '';
    let migratedRef = typeof settingsRecord.authSecretRef === 'string' ? settingsRecord.authSecretRef.trim() : '';
    if (!migratedRef && legacyToken && SAFE_LEGACY_SECRET_REF.test(legacyToken)) {
      migratedRef = legacyToken.replace(/^env:/i, '').trim();
    }
    const sanitizedSettings: Record<string, unknown> = {
      baseUrl: typeof settingsRecord.baseUrl === 'string' ? settingsRecord.baseUrl : '',
      globalHeaders: typeof settingsRecord.globalHeaders === 'string' ? settingsRecord.globalHeaders : '',
      authSecretRef: migratedRef,
    };
    return {
      ...graphRecord,
      networkSettings: sanitizedSettings,
    };
  });
  return mutated ? { ...candidate, logicGraphs: nextGraphs } : candidate;
}

/** Normalize any supported native project version to the current v2 schema. */
export function migrateProjectToV2(input: unknown): FolioProject {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('The file does not contain a Folio project object.');
  }

  const version = (input as { formatVersion?: unknown }).formatVersion;
  if (version === 1) return migrateProjectV1ToV2(input as FolioProjectV1);
  if (version === FOLIO_FORMAT_VERSION) {
    let candidate = normalizeLegacyNetworkSettingsOnGraphs(input as Record<string, unknown>);
    if (Array.isArray(candidate.pages) && candidate.pages.length > 0) {
      const activePageExists = candidate.pages.some(
        (page) => typeof page === 'object' && page !== null &&
          (page as { id?: unknown }).id === candidate.activePageId,
      );
      if (!activePageExists) {
        const firstPage = candidate.pages[0] as { id?: unknown };
        if (typeof firstPage?.id === 'string') {
          candidate = { ...candidate, activePageId: firstPage.id };
        }
      }
    }
    return requireValidProject(candidate);
  }

  throw new Error(`Unsupported .flop format version: ${String(version)}.`);
}

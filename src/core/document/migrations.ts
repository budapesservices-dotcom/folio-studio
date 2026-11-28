import {
  sanitizeLogicNodeDataRecord,
  sanitizeNetworkSettingsForPersistence,
} from './networkSecrets';
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

function sanitizeRawLogicNodesArray(rawNodes: unknown): { readonly nodes: unknown; readonly mutated: boolean } {
  if (!Array.isArray(rawNodes)) return { nodes: rawNodes, mutated: false };
  let nodesMutated = false;
  const mappedNodes = rawNodes.map((nodeEntry) => {
    if (typeof nodeEntry !== 'object' || nodeEntry === null || Array.isArray(nodeEntry)) {
      return nodeEntry;
    }
    const nodeRecord = nodeEntry as Record<string, unknown>;
    const nodeType = typeof nodeRecord.type === 'string' ? nodeRecord.type : '';
    const nodeData = nodeRecord.data;
    if (typeof nodeData !== 'object' || nodeData === null || Array.isArray(nodeData)) {
      return nodeEntry;
    }
    const cleanData = sanitizeLogicNodeDataRecord(nodeType, nodeData as Record<string, unknown>);
    if (cleanData === nodeData) return nodeEntry;
    nodesMutated = true;
    return { ...nodeRecord, data: cleanData };
  });
  return nodesMutated ? { nodes: mappedNodes, mutated: true } : { nodes: rawNodes, mutated: false };
}

function normalizeLegacyNetworkSettingsOnGraphs(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  let mutated = false;
  let nextGraphs = candidate.logicGraphs;

  if (Array.isArray(candidate.logicGraphs)) {
    let graphsMutated = false;
    const mappedGraphs = candidate.logicGraphs.map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return entry;
      }
      const graphRecord = entry as Record<string, unknown>;
      let graphMutated = false;
      let nextSettings = graphRecord.networkSettings;

      if (
        typeof nextSettings === 'object'
        && nextSettings !== null
        && !Array.isArray(nextSettings)
      ) {
        const settingsRecord = nextSettings as Record<string, unknown>;
        const sanitized = sanitizeNetworkSettingsForPersistence(settingsRecord);
        const hasExtraKeys = Object.keys(settingsRecord).some(
          (key) => key !== 'baseUrl' && key !== 'globalHeaders' && key !== 'authSecretRef',
        );
        if (
          hasExtraKeys
          || sanitized.baseUrl !== settingsRecord.baseUrl
          || sanitized.globalHeaders !== settingsRecord.globalHeaders
          || sanitized.authSecretRef !== settingsRecord.authSecretRef
        ) {
          nextSettings = sanitized;
          graphMutated = true;
        }
      }

      const nodesRes = sanitizeRawLogicNodesArray(graphRecord.nodes);
      if (nodesRes.mutated) {
        graphMutated = true;
      }

      if (!graphMutated) return entry;
      graphsMutated = true;
      return {
        ...graphRecord,
        ...(nextSettings !== undefined ? { networkSettings: nextSettings } : {}),
        ...(nodesRes.nodes !== undefined ? { nodes: nodesRes.nodes } : {}),
      };
    });
    if (graphsMutated) {
      nextGraphs = mappedGraphs;
      mutated = true;
    }
  }

  let nextPresets = candidate.logicFramePresets;
  if (Array.isArray(candidate.logicFramePresets)) {
    let presetsMutated = false;
    const mappedPresets = candidate.logicFramePresets.map((presetEntry) => {
      if (typeof presetEntry !== 'object' || presetEntry === null || Array.isArray(presetEntry)) {
        return presetEntry;
      }
      const presetRecord = presetEntry as Record<string, unknown>;
      const nodesRes = sanitizeRawLogicNodesArray(presetRecord.nodes);
      if (!nodesRes.mutated) return presetEntry;
      presetsMutated = true;
      return {
        ...presetRecord,
        nodes: nodesRes.nodes,
      };
    });
    if (presetsMutated) {
      nextPresets = mappedPresets;
      mutated = true;
    }
  }

  if (!mutated) return candidate;
  return {
    ...candidate,
    ...(nextGraphs !== candidate.logicGraphs ? { logicGraphs: nextGraphs } : {}),
    ...(nextPresets !== candidate.logicFramePresets ? { logicFramePresets: nextPresets } : {}),
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

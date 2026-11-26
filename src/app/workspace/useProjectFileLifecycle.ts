import { useEffect, useState } from 'preact/hooks';
import type { AssetReference, BreakpointId, FolioDocument, FolioProject } from '../../core/document/types';
import {
  deleteProjectById,
  isStorageQuotaExceededError,
  loadMostRecentProject,
  saveProjectAndActivate,
  saveProjectIfRevisionCurrent,
  subscribeExternalPersistenceSync,
} from '../../core/persistence/indexedDb';
import {
  MAX_BINARY_ASSET_BYTES,
  hydrateProjectAssetsToStore,
  materializeProjectAssetsForExport,
} from '../../core/persistence/assetStore';
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_SIZE,
  ProjectFileSizeLimitError,
  downloadProject,
  estimateAssetSerializedBytes,
  evaluateProjectAssetPortabilityBudget,
  getUtf8ByteLength,
  type LargestProjectAssetInfo,
} from '../../core/persistence/projectFile';
import { estimateBase64DataUrlBytes } from '../../core/persistence/projectPortability';
import { setRevisionFencedAutosaveStatus } from '../debouncedAutosave';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { createProjectExportSnapshot } from '../projectExport';
import { openProjectFile } from '../projectFileActions';
import {
  executeNewProjectAction,
  type NewProjectActionMode,
  type NewProjectActionOutcome,
  type NewProjectExportResult,
} from '../newProjectFlow';
import { resolveActiveExportTarget } from './canvasViewState';

export { MAX_PROJECT_SIZE };

/** Threshold (1 MiB raw or serialized) above which an imported asset is flagged as a large binary asset. */
export const LARGE_BINARY_ASSET_THRESHOLD_BYTES = 1 * 1024 * 1024;

export interface ScannedBinaryAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: AssetReference['kind'];
  readonly mimeType: string;
  readonly rawBytes: number;
  readonly serializedBytes: number;
  readonly isLarge: boolean;
  readonly exceedsPerAssetLimit: boolean;
}

export interface PreImportValidationOptions {
  readonly fileSizeBytes?: number;
  readonly maxContractBytes?: number;
  readonly largeAssetThresholdBytes?: number;
}

export interface PreImportValidationResult {
  readonly allowed: boolean;
  readonly totalRawAssetBytes: number;
  readonly totalSerializedAssetBytes: number;
  readonly effectiveTotalBytes: number;
  readonly maxContractBytes: number;
  readonly scannedAssets: readonly ScannedBinaryAsset[];
  readonly largeAssets: readonly ScannedBinaryAsset[];
  readonly largestAsset: LargestProjectAssetInfo | null;
  readonly error: ProjectFileSizeLimitError | null;
  readonly warningMessage: string | null;
}

/**
 * Pre-import validation routine that scans a candidate `.flop` project for large
 * binary assets and denies the import if total asset/file size exceeds the
 * canonical contract limit (`MAX_PROJECT_FILE_BYTES`).
 */
export function validateProjectPreImport(
  project: FolioProject,
  options: PreImportValidationOptions = {},
): PreImportValidationResult {
  const maxContractBytes = options.maxContractBytes ?? MAX_PROJECT_FILE_BYTES;
  const largeThreshold = options.largeAssetThresholdBytes ?? LARGE_BINARY_ASSET_THRESHOLD_BYTES;
  const scannedAssets: ScannedBinaryAsset[] = [];
  const largeAssets: ScannedBinaryAsset[] = [];

  let totalRawAssetBytes = 0;
  let totalSerializedAssetBytes = 0;
  let largestAsset: LargestProjectAssetInfo | null = null;

  for (const asset of project.assets) {
    const { rawBytes, serializedBytes } = estimateAssetSerializedBytes(asset);
    totalRawAssetBytes += rawBytes;
    totalSerializedAssetBytes += serializedBytes;

    if (!largestAsset || serializedBytes > largestAsset.serializedBytes) {
      largestAsset = {
        id: asset.id,
        name: asset.name,
        rawBytes,
        serializedBytes,
      };
    }

    const isLarge = rawBytes >= largeThreshold || serializedBytes >= largeThreshold;
    const scanned: ScannedBinaryAsset = {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      mimeType: asset.mimeType,
      rawBytes,
      serializedBytes,
      isLarge,
      exceedsPerAssetLimit: rawBytes > MAX_BINARY_ASSET_BYTES,
    };
    scannedAssets.push(scanned);
    if (isLarge) {
      largeAssets.push(scanned);
    }
  }

  const fileSizeBytes =
    typeof options.fileSizeBytes === 'number' && Number.isFinite(options.fileSizeBytes) && options.fileSizeBytes >= 0
      ? options.fileSizeBytes
      : 0;
  const effectiveTotalBytes = Math.max(totalSerializedAssetBytes, fileSizeBytes);

  if (effectiveTotalBytes > maxContractBytes) {
    const error = new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: effectiveTotalBytes,
      maxBytes: maxContractBytes,
      largestAsset,
    });
    return {
      allowed: false,
      totalRawAssetBytes,
      totalSerializedAssetBytes,
      effectiveTotalBytes,
      maxContractBytes,
      scannedAssets,
      largeAssets,
      largestAsset,
      error,
      warningMessage: null,
    };
  }

  const budgetReport = evaluateProjectAssetPortabilityBudget(project.assets);
  return {
    allowed: true,
    totalRawAssetBytes,
    totalSerializedAssetBytes,
    effectiveTotalBytes,
    maxContractBytes,
    scannedAssets,
    largeAssets,
    largestAsset,
    error: null,
    warningMessage: budgetReport.warningMessage,
  };
}

export interface PreParseFileValidationResult {
  readonly allowed: boolean;
  readonly incomingFileBytes: number;
  readonly totalRawAssetBytes: number;
  readonly totalAssetsBytes: number;
  readonly effectiveTotalBytes: number;
  readonly maxContractBytes: number;
  readonly largestAsset: LargestProjectAssetInfo | null;
  readonly error: ProjectFileSizeLimitError | null;
  readonly errorMessage: string | null;
}

export type ProjectImportOutcome =
  | { readonly ok: true; readonly project: FolioProject; readonly warningMessage: string | null }
  | { readonly ok: false; readonly error: string };

function skipJsonWhitespace(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      i += 1;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Advances past a JSON string literal starting at `quoteIndex` (which must point
 * to `"`), returning the index immediately after the closing quote, the UTF-8
 * byte length of the raw string body, and an optional short prefix.
 */
function scanJsonStringToken(
  text: string,
  quoteIndex: number,
  maxPreviewChars = 0,
): { readonly nextIndex: number; readonly utf8Bytes: number; readonly preview: string } | null {
  if (quoteIndex >= text.length || text.charCodeAt(quoteIndex) !== 34) return null;
  let i = quoteIndex + 1;
  let utf8Bytes = 0;
  let preview = '';

  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 34) {
      return { nextIndex: i + 1, utf8Bytes, preview };
    }
    if (code === 92) {
      // Backslash escape sequence
      if (i + 1 >= text.length) return null;
      const esc = text.charCodeAt(i + 1);
      if (esc === 117) {
        // \uXXXX
        if (i + 5 >= text.length) return null;
        const hex = text.slice(i + 2, i + 6);
        const cp = Number.parseInt(hex, 16);
        if (Number.isFinite(cp)) {
          utf8Bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
          if (preview.length < maxPreviewChars) preview += String.fromCharCode(cp);
        }
        i += 6;
      } else {
        utf8Bytes += 1;
        if (preview.length < maxPreviewChars) {
          preview += esc === 110 ? '\n' : esc === 114 ? '\r' : esc === 116 ? '\t' : text[i + 1];
        }
        i += 2;
      }
      continue;
    }

    if (code < 0x80) {
      utf8Bytes += 1;
      if (preview.length < maxPreviewChars) preview += text[i];
      i += 1;
    } else if (code < 0x800) {
      utf8Bytes += 2;
      if (preview.length < maxPreviewChars) preview += text[i];
      i += 1;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        utf8Bytes += 4;
        if (preview.length < maxPreviewChars) preview += text.slice(i, i + 2);
        i += 2;
      } else {
        utf8Bytes += 3;
        if (preview.length < maxPreviewChars) preview += text[i];
        i += 1;
      }
    } else {
      utf8Bytes += 3;
      if (preview.length < maxPreviewChars) preview += text[i];
      i += 1;
    }
  }

  return null;
}

function skipJsonValue(text: string, start: number): number {
  let i = skipJsonWhitespace(text, start);
  if (i >= text.length) return i;
  const ch = text.charCodeAt(i);
  if (ch === 34) {
    const token = scanJsonStringToken(text, i, 0);
    return token ? token.nextIndex : text.length;
  }
  if (ch === 123 || ch === 91) {
    // { or [
    let depth = 1;
    i += 1;
    while (i < text.length && depth > 0) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        const token = scanJsonStringToken(text, i, 0);
        if (!token) return text.length;
        i = token.nextIndex;
        continue;
      }
      if (c === 123 || c === 91) depth += 1;
      else if (c === 125 || c === 93) depth -= 1;
      i += 1;
    }
    return i;
  }
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 44 || c === 125 || c === 93 || c === 32 || c === 9 || c === 10 || c === 13) break;
    i += 1;
  }
  return i;
}

function scanAssetsArrayBeforeParse(text: string): {
  readonly totalRawAssetBytes: number;
  readonly totalAssetsBytes: number;
  readonly largestAsset: LargestProjectAssetInfo | null;
} {
  let i = skipJsonWhitespace(text, 0);
  if (i >= text.length || text.charCodeAt(i) !== 123) {
    return { totalRawAssetBytes: 0, totalAssetsBytes: 0, largestAsset: null };
  }
  i += 1;

  // Locate the top-level "assets" array without JSON.parse
  let assetsArrayStart = -1;
  while (i < text.length) {
    i = skipJsonWhitespace(text, i);
    if (i >= text.length || text.charCodeAt(i) === 125) break;
    if (text.charCodeAt(i) === 44) {
      i += 1;
      continue;
    }
    const keyToken = scanJsonStringToken(text, i, 16);
    if (!keyToken) break;
    i = skipJsonWhitespace(text, keyToken.nextIndex);
    if (i >= text.length || text.charCodeAt(i) !== 58) break;
    i = skipJsonWhitespace(text, i + 1);

    if (keyToken.utf8Bytes === 6 && keyToken.preview === 'assets' && text.charCodeAt(i) === 91) {
      assetsArrayStart = i;
      break;
    }
    i = skipJsonValue(text, i);
  }

  if (assetsArrayStart < 0) {
    return { totalRawAssetBytes: 0, totalAssetsBytes: 0, largestAsset: null };
  }

  let totalRawAssetBytes = 0;
  let totalAssetsBytes = 0;
  let largestAsset: LargestProjectAssetInfo | null = null;
  let cursor = assetsArrayStart + 1;

  while (cursor < text.length) {
    cursor = skipJsonWhitespace(text, cursor);
    if (cursor >= text.length || text.charCodeAt(cursor) === 93) break;
    if (text.charCodeAt(cursor) === 44) {
      cursor += 1;
      continue;
    }
    if (text.charCodeAt(cursor) !== 123) {
      cursor = skipJsonValue(text, cursor);
      continue;
    }

    // Scan one asset object without JSON.parse
    cursor += 1;
    let id = '';
    let name = '';
    let mimeType = 'application/octet-stream';
    let byteLength: number | null = null;
    let sourcePrefix = '';
    let sourceUtf8Bytes = 0;

    while (cursor < text.length) {
      cursor = skipJsonWhitespace(text, cursor);
      if (cursor >= text.length || text.charCodeAt(cursor) === 125) {
        if (cursor < text.length && text.charCodeAt(cursor) === 125) cursor += 1;
        break;
      }
      if (text.charCodeAt(cursor) === 44) {
        cursor += 1;
        continue;
      }
      const fieldKey = scanJsonStringToken(text, cursor, 16);
      if (!fieldKey) {
        cursor = text.length;
        break;
      }
      cursor = skipJsonWhitespace(text, fieldKey.nextIndex);
      if (cursor >= text.length || text.charCodeAt(cursor) !== 58) {
        cursor = text.length;
        break;
      }
      cursor = skipJsonWhitespace(text, cursor + 1);

      const keyName = fieldKey.preview;
      if (keyName === 'id' && fieldKey.utf8Bytes === 2 && text.charCodeAt(cursor) === 34) {
        const val = scanJsonStringToken(text, cursor, 128);
        if (!val) break;
        id = val.preview;
        cursor = val.nextIndex;
      } else if (keyName === 'name' && fieldKey.utf8Bytes === 4 && text.charCodeAt(cursor) === 34) {
        const val = scanJsonStringToken(text, cursor, 256);
        if (!val) break;
        name = val.preview;
        cursor = val.nextIndex;
      } else if (keyName === 'mimeType' && fieldKey.utf8Bytes === 8 && text.charCodeAt(cursor) === 34) {
        const val = scanJsonStringToken(text, cursor, 96);
        if (!val) break;
        mimeType = val.preview || mimeType;
        cursor = val.nextIndex;
      } else if (keyName === 'source' && fieldKey.utf8Bytes === 6 && text.charCodeAt(cursor) === 34) {
        const val = scanJsonStringToken(text, cursor, 64);
        if (!val) break;
        sourcePrefix = val.preview.trim();
        sourceUtf8Bytes = val.utf8Bytes;
        cursor = val.nextIndex;
      } else if (keyName === 'byteLength' && fieldKey.utf8Bytes === 10) {
        const numEnd = skipJsonValue(text, cursor);
        const parsed = Number(text.slice(cursor, numEnd));
        if (Number.isFinite(parsed) && parsed >= 0) byteLength = parsed;
        cursor = numEnd;
      } else {
        cursor = skipJsonValue(text, cursor);
      }
    }

    let serializedBytes: number;
    let rawBytes: number;
    if (sourcePrefix.startsWith('data:')) {
      serializedBytes = sourceUtf8Bytes;
      const commaIdx = sourcePrefix.indexOf(',');
      const payloadBytes = commaIdx >= 0 ? Math.max(0, sourceUtf8Bytes - (commaIdx + 1)) : sourceUtf8Bytes;
      rawBytes = byteLength !== null ? byteLength : Math.floor((payloadBytes * 3) / 4);
    } else if (byteLength !== null && byteLength > 0) {
      rawBytes = byteLength;
      serializedBytes = estimateBase64DataUrlBytes(byteLength, mimeType);
    } else {
      serializedBytes = sourceUtf8Bytes;
      rawBytes = sourceUtf8Bytes;
    }

    totalRawAssetBytes += rawBytes;
    totalAssetsBytes += serializedBytes;
    if (!largestAsset || serializedBytes > largestAsset.serializedBytes) {
      largestAsset = {
        id: id || 'unknown-asset',
        name: name || id || 'Unnamed asset',
        rawBytes,
        serializedBytes,
      };
    }
  }

  return { totalRawAssetBytes, totalAssetsBytes, largestAsset };
}

/**
 * Calculates incoming `.flop` file byte size and total assets size directly from
 * raw text BEFORE `JSON.parse()` runs, denying files that exceed `MAX_PROJECT_SIZE`.
 */
export function scanRawProjectFileBeforeParse(
  rawContent: string,
  fileSizeBytes?: number,
  maxContractBytes: number = MAX_PROJECT_SIZE,
): PreParseFileValidationResult {
  const declaredFileSize =
    typeof fileSizeBytes === 'number' && Number.isFinite(fileSizeBytes) && fileSizeBytes >= 0
      ? fileSizeBytes
      : 0;
  const contentByteLength = getUtf8ByteLength(rawContent);
  const incomingFileBytes = Math.max(declaredFileSize, contentByteLength);

  const assetScan = scanAssetsArrayBeforeParse(rawContent);
  const effectiveTotalBytes = Math.max(incomingFileBytes, assetScan.totalAssetsBytes);

  if (incomingFileBytes > maxContractBytes || assetScan.totalAssetsBytes > maxContractBytes) {
    const error = new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: effectiveTotalBytes,
      maxBytes: maxContractBytes,
      largestAsset: assetScan.largestAsset,
    });
    return {
      allowed: false,
      incomingFileBytes,
      totalRawAssetBytes: assetScan.totalRawAssetBytes,
      totalAssetsBytes: assetScan.totalAssetsBytes,
      effectiveTotalBytes,
      maxContractBytes,
      largestAsset: assetScan.largestAsset,
      error,
      errorMessage: error.message,
    };
  }

  return {
    allowed: true,
    incomingFileBytes,
    totalRawAssetBytes: assetScan.totalRawAssetBytes,
    totalAssetsBytes: assetScan.totalAssetsBytes,
    effectiveTotalBytes,
    maxContractBytes,
    largestAsset: assetScan.largestAsset,
    error: null,
    errorMessage: null,
  };
}

/**
 * Pre-parse validation entry point for an incoming `File`. Enforces `MAX_PROJECT_SIZE`
 * on `file.size` before reading text, then calculates incoming file bytes and total
 * assets size before `JSON.parse()` runs.
 */
export async function validateRawProjectFileBeforeParse(
  file: File,
  maxContractBytes: number = MAX_PROJECT_SIZE,
): Promise<PreParseFileValidationResult & { readonly rawContent: string | null }> {
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > maxContractBytes) {
    const error = new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: file.size,
      maxBytes: maxContractBytes,
    });
    return {
      allowed: false,
      incomingFileBytes: file.size,
      totalRawAssetBytes: 0,
      totalAssetsBytes: 0,
      effectiveTotalBytes: file.size,
      maxContractBytes,
      largestAsset: null,
      error,
      errorMessage: error.message,
      rawContent: null,
    };
  }

  const rawContent = await file.text();
  const scan = scanRawProjectFileBeforeParse(rawContent, file.size, maxContractBytes);
  return {
    ...scan,
    rawContent: scan.allowed ? rawContent : null,
  };
}

export interface UseProjectFileLifecycleOptions {
  project: FolioProject;
  componentProject: FolioProject;
  componentDocument: FolioDocument;
  activeEditorId: EditorTarget;
  getActiveBreakpoint?: () => BreakpointId;
  getEditingComponentId: () => string | null;
  onResetEditingComponent: () => void;
  mainCommandClient: MainCanvasCommandClient;
  getCanonicalRevision: () => number;
  getCanonicalProject: () => FolioProject;
  subscribeCanonicalStore: (listener: () => void) => () => void;
  setActiveEditorId: (target: EditorTarget) => void;
  setComponentCanvasClosed: (closed: boolean) => void;
  setComponentCanvasMinimized: (minimized: boolean) => void;
  setFileMenuOpen: (open: boolean) => void;
  setNotice: (message: string) => void;
}

export function useProjectFileLifecycle({
  project,
  componentProject,
  componentDocument,
  activeEditorId,
  getActiveBreakpoint,
  getEditingComponentId,
  onResetEditingComponent,
  mainCommandClient,
  getCanonicalRevision,
  getCanonicalProject,
  subscribeCanonicalStore,
  setActiveEditorId,
  setComponentCanvasClosed,
  setComponentCanvasMinimized,
  setFileMenuOpen,
  setNotice,
}: UseProjectFileLifecycleOptions) {
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');

  // Hydrate primary project from IndexedDB
  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((loadedProject) => {
        if (!active || !loadedProject) return;
        const activePage = loadedProject.pages.find((page) => page.id === loadedProject.activePageId)
          ?? loadedProject.pages[0];
        if (!activePage) throw new Error('The saved project does not contain a page.');
        mainCommandClient.replaceProject(
          { ...loadedProject, activePageId: activePage.id },
          'Restore project from IndexedDB',
        );
        void hydrateProjectAssetsToStore(loadedProject);
      })
      .catch((error: unknown) => {
        console.error('Folio could not restore the project from IndexedDB:', error);
        if (active) setNotice('The saved project could not be restored. A new project is available.');
      })
      .finally(() => {
        if (active) setIsProjectLoaded(true);
      });
    return () => { active = false; };
  }, [mainCommandClient]);

  // Multi-tab persistence awareness: warn immediately if another tab commits newer changes
  useEffect(() => {
    return subscribeExternalPersistenceSync((event) => {
      const currentProject = getCanonicalProject();
      if (event.projectId === currentProject.metadata.id) {
        setNotice(
          'Another Folio tab saved newer changes to this project. Reload or export a .flop backup to avoid overwriting newer work.',
        );
      } else if (event.activated) {
        setNotice(
          'Another Folio tab opened a different project. Export a .flop backup before closing if you want to keep this tab.',
        );
      }
    });
  }, [getCanonicalProject, setNotice]);

  // Revision-fenced debounced autosave for primary project with pagehide/visibility flush
  useEffect(() => {
    if (!isProjectLoaded) return;
    setSaveStatus('saving');
    const projectRevision = getCanonicalRevision();
    const canonicalProject = getCanonicalProject();
    let flushed = false;

    const persistNow = () => {
      if (flushed) return;
      flushed = true;
      window.clearTimeout(timer);
      saveProjectIfRevisionCurrent(
        canonicalProject,
        projectRevision,
        getCanonicalRevision,
        subscribeCanonicalStore,
      )
        .then((result) => {
          if (result.status === 'saved') {
            setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'saved', setSaveStatus);
          }
        })
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'error', setSaveStatus);
          if (isStorageQuotaExceededError(error)) {
            setNotice(
              'Browser storage quota is full. Export a .flop backup now (File -> Export .flop) to avoid losing your changes.',
            );
          }
        });
    };

    const timer = window.setTimeout(persistNow, 450);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistNow();
    };
    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', persistNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [project, isProjectLoaded, getCanonicalRevision, getCanonicalProject, subscribeCanonicalStore, setNotice]);

  const handleProjectFileSelected = async (file: File): Promise<ProjectImportOutcome> => {
    try {
      const preParseCheck = await validateRawProjectFileBeforeParse(file, MAX_PROJECT_SIZE);
      if (!preParseCheck.allowed || preParseCheck.rawContent === null) {
        const errorMessage =
          preParseCheck.errorMessage ??
          new ProjectFileSizeLimitError({
            direction: 'import',
            actualBytes: preParseCheck.effectiveTotalBytes,
            maxBytes: MAX_PROJECT_SIZE,
            largestAsset: preParseCheck.largestAsset,
          }).message;
        setNotice('Unable to open project: ' + errorMessage);
        return { ok: false, error: errorMessage };
      }

      const preReadFile = {
        name: file.name,
        size: preParseCheck.incomingFileBytes,
        text: async () => preParseCheck.rawContent as string,
      } as File;

      let preImportWarning: string | null = null;
      const loaded = await openProjectFile(preReadFile, async (loadedProject) => {
        const validation = validateProjectPreImport(loadedProject, {
          fileSizeBytes: preParseCheck.incomingFileBytes,
          maxContractBytes: MAX_PROJECT_SIZE,
        });
        if (!validation.allowed) {
          throw validation.error ?? new ProjectFileSizeLimitError({
            direction: 'import',
            actualBytes: validation.effectiveTotalBytes,
            maxBytes: validation.maxContractBytes,
            largestAsset: validation.largestAsset,
          });
        }
        preImportWarning = validation.warningMessage;
        await saveProjectAndActivate(loadedProject);
        mainCommandClient.replaceProject(loadedProject, 'Open .flop project');
        void hydrateProjectAssetsToStore(loadedProject);
      });
      if (!loaded) {
        return { ok: false, error: 'No project file was selected.' };
      }
      setActiveEditorId('main');
      onResetEditingComponent();
      setComponentCanvasClosed(true);
      setComponentCanvasMinimized(false);
      const baseNotice = 'Opened "' + loaded.metadata.name + '".';
      setNotice(preImportWarning ? `${baseNotice} Warning: ${preImportWarning}` : baseNotice);
      return { ok: true, project: loaded, warningMessage: preImportWarning };
    } catch (error) {
      console.error('Folio could not open the selected project file:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to open project: ' + detail);
      return { ok: false, error: detail };
    }
  };

  const exportCurrentProject = async (
    isHydrating: boolean,
    options: { silentNotice?: boolean } = {},
  ): Promise<NewProjectExportResult> => {
    setFileMenuOpen(false);
    if (isHydrating) {
      return { ok: false, error: 'Wait for the workspace to finish loading before exporting.' };
    }
    try {
      const exportSnapshot = createProjectExportSnapshot(
        project,
        getEditingComponentId(),
        componentProject,
      );
      const portableSnapshot = await materializeProjectAssetsForExport(exportSnapshot);
      downloadProject(portableSnapshot);
      if (!options.silentNotice) {
        setNotice('Project exported successfully as a .flop file.');
      }
      return { ok: true };
    } catch (error) {
      console.error('Folio could not export the current project:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export project: ' + detail);
      return { ok: false, error: detail };
    }
  };

  const createNewProject = async (
    mode: NewProjectActionMode,
    isHydrating: boolean,
    onAfterSwitch?: () => void,
  ): Promise<NewProjectActionOutcome> => {
    if (isHydrating) {
      return {
        ok: false,
        mode,
        stage: 'persist',
        error: 'Wait for the workspace to finish loading before starting a new project.',
      };
    }

    const currentProject = getCanonicalProject();
    const outcome = await executeNewProjectAction(mode, {
      currentProject,
      exportCurrentProject: () => exportCurrentProject(false, { silentNotice: true }),
      persistAndActivateProject: async (nextProject) => {
        if ('indexedDB' in globalThis) {
          await saveProjectAndActivate(nextProject);
        }
      },
      deleteStoredProject: async (projectId) => {
        if ('indexedDB' in globalThis) {
          await deleteProjectById(projectId);
        }
      },
      replaceCanonicalProject: (nextProject, description) =>
        mainCommandClient.replaceProject(nextProject, description),
      resetWorkspaceAfterProjectSwitch: () => {
        setActiveEditorId('main');
        onResetEditingComponent();
        setComponentCanvasClosed(true);
        setComponentCanvasMinimized(false);
        onAfterSwitch?.();
      },
    });

    if (outcome.ok) {
      setNotice(outcome.notice);
    }
    return outcome;
  };

  // Dynamically import visualExport so PNG/SVG export code stays off the critical startup chunk.
  const exportActiveCanvasSvg = async (isHydrating: boolean) => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const [{ downloadSvgDocument }, portableProject] = await Promise.all([
        import('../visualExport'),
        materializeProjectAssetsForExport(project),
      ]);
      const target = resolveActiveExportTarget(
        activeEditorId,
        portableProject,
        componentDocument,
        getEditingComponentId(),
      );
      const exportBreakpoint = activeEditorId === 'main' ? (getActiveBreakpoint?.() ?? 'desktop') : 'desktop';
      downloadSvgDocument(target.document, portableProject.components, target.name, {
        designTokens: portableProject.designTokens,
        breakpoint: exportBreakpoint,
        assets: portableProject.assets,
      });
      setNotice(`Exported "${target.name}" as standalone SVG.`);
    } catch (error) {
      console.error('Folio could not export SVG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export SVG: ' + detail);
    }
  };

  const exportActiveCanvasPng = async (isHydrating: boolean) => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const [{ downloadPngDocument }, portableProject] = await Promise.all([
        import('../visualExport'),
        materializeProjectAssetsForExport(project),
      ]);
      const target = resolveActiveExportTarget(
        activeEditorId,
        portableProject,
        componentDocument,
        getEditingComponentId(),
      );
      const exportBreakpoint = activeEditorId === 'main' ? (getActiveBreakpoint?.() ?? 'desktop') : 'desktop';
      const result = await downloadPngDocument(target.document, portableProject.components, target.name, 2, {
        designTokens: portableProject.designTokens,
        breakpoint: exportBreakpoint,
        assets: portableProject.assets,
      });
      setNotice(`Exported "${target.name}" as PNG (${result.width}×${result.height}px @2×).`);
    } catch (error) {
      console.error('Folio could not export PNG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export PNG: ' + detail);
    }
  };

  return {
    isProjectLoaded,
    saveStatus,
    handleProjectFileSelected,
    exportCurrentProject,
    createNewProject,
    exportActiveCanvasSvg,
    exportActiveCanvasPng,
  };
}

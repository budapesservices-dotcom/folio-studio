import { migrateProjectToV2 } from '../document/migrations';
import { sanitizeProjectNetworkSecrets } from '../document/networkSecrets';
import { requireValidProject } from '../document/validation';
import type { FolioProject } from '../document/types';
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_SIZE,
  MissingExportAssetsError,
  ProjectFileSizeLimitError,
  estimateAssetSerializedBytes,
  evaluateProjectAssetPortabilityBudget,
  findLargestProjectAsset,
  findUnmaterializedInternalAssets,
  getUtf8ByteLength,
  type LargestProjectAssetInfo,
} from './projectPortability';
import { isZipArchiveBytes, parseFlopZipArchive } from './flopArchive';

export {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_SIZE,
  MissingExportAssetsError,
  ProjectFileSizeLimitError,
  estimateAssetSerializedBytes,
  evaluateProjectAssetPortabilityBudget,
  getUtf8ByteLength,
};
export type { LargestProjectAssetInfo };

function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return cleaned || 'untitled-project';
}

/**
 * Produces a validated, secret-safe, portable `.flop` v2 JSON string.
 * Guarantees:
 * - No raw `authToken`, unsafe `authSecretRef`, raw credential inside `globalHeaders`,
 *   embedded URL credentials, or network node secrets are written into `.flop` files.
 * - No unmaterialized internal `folio-asset://` or ephemeral `blob:` asset URIs leak
 *   into exported `.flop` files (fail-closed via `MissingExportAssetsError`).
 * - Final UTF-8 serialized size respects the exact same `MAX_PROJECT_FILE_BYTES`
 *   safety limit enforced by `readProjectFile()` (fail-closed via `ProjectFileSizeLimitError`).
 */
export function serializeProjectToFlopJson(project: FolioProject): string {
  const sanitizedProject = sanitizeProjectNetworkSecrets(project);
  const validatedProject = requireValidProject(sanitizedProject);

  const unmaterialized = findUnmaterializedInternalAssets(validatedProject.assets);
  if (unmaterialized.length > 0) {
    throw new MissingExportAssetsError(unmaterialized);
  }

  // Fast OOM guard on low-RAM devices before stringifying extreme multi-asset payloads.
  let lowerBoundAssetBytes = 0;
  for (const asset of validatedProject.assets) {
    lowerBoundAssetBytes += getUtf8ByteLength(asset.source);
  }
  if (lowerBoundAssetBytes > MAX_PROJECT_FILE_BYTES * 2) {
    throw new ProjectFileSizeLimitError({
      direction: 'export',
      actualBytes: lowerBoundAssetBytes,
      maxBytes: MAX_PROJECT_FILE_BYTES,
      largestAsset: findLargestProjectAsset(validatedProject.assets),
    });
  }

  const content = JSON.stringify(validatedProject, null, 2);
  const actualBytes = getUtf8ByteLength(content);
  if (actualBytes > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileSizeLimitError({
      direction: 'export',
      actualBytes,
      maxBytes: MAX_PROJECT_FILE_BYTES,
      largestAsset: findLargestProjectAsset(validatedProject.assets),
    });
  }

  return content;
}

export function downloadProject(project: FolioProject): void {
  const content = serializeProjectToFlopJson(project);
  const blob = new Blob([content], { type: 'application/vnd.folio.project+json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(project.metadata.name)}.flop`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely parses untrusted JSON text while stripping prototype-polluting keys
 * before schema migration or validation touches the parsed graph.
 */
export function parseProjectJsonSafe(content: string): unknown {
  return JSON.parse(content, (key, value: unknown) => {
    if (FORBIDDEN_JSON_KEYS.has(key)) return undefined;
    return value;
  });
}

const utf8Decoder = new TextDecoder();

export async function readProjectFile(file: File): Promise<FolioProject> {
  if (typeof file.size === 'number' && file.size > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: file.size,
      maxBytes: MAX_PROJECT_FILE_BYTES,
    });
  }

  let content: string;
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > MAX_PROJECT_FILE_BYTES) {
      throw new ProjectFileSizeLimitError({
        direction: 'import',
        actualBytes: bytes.byteLength,
        maxBytes: MAX_PROJECT_FILE_BYTES,
      });
    }
    if (isZipArchiveBytes(bytes)) {
      return parseFlopZipArchive(bytes);
    }
    content = utf8Decoder.decode(bytes);
  } else {
    content = await file.text();
  }

  const actualBytes = getUtf8ByteLength(content);
  if (actualBytes > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes,
      maxBytes: MAX_PROJECT_FILE_BYTES,
    });
  }

  let parsed: unknown;

  try {
    parsed = parseProjectJsonSafe(content);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  return migrateProjectToV2(parsed);
}

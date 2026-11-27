import { migrateProjectToV2 } from '../document/migrations';
import { sanitizeProjectNetworkSecrets } from '../document/networkSecrets';
import { requireValidProject } from '../document/validation';
import type { AssetReference, FolioProject } from '../document/types';
import { buildZipArchive, parseZipArchive, type ZipArchiveEntry } from '../../engines/codegen/zipArchive';
import {
  MAX_PROJECT_FILE_BYTES,
  MissingExportAssetsError,
  ProjectFileSizeLimitError,
  findLargestProjectAsset,
  findUnmaterializedInternalAssets,
} from './projectPortability';
import { parseProjectJsonSafe } from './projectFile';

export const FLOP_ARCHIVE_MANIFEST_PATH = 'manifest.json';
export const FLOP_ARCHIVE_PROJECT_PATH = 'project.json';
export const FLOP_ARCHIVE_ASSET_SCHEME = 'folio-archive://';
export const FLOP_ARCHIVE_CONTAINER_FORMAT = 'flop-archive' as const;
export const FLOP_ARCHIVE_CONTAINER_VERSION = 1 as const;

export interface FlopArchiveManifest {
  readonly containerFormat: typeof FLOP_ARCHIVE_CONTAINER_FORMAT;
  readonly containerVersion: typeof FLOP_ARCHIVE_CONTAINER_VERSION;
  readonly projectFormatVersion: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly assetCount: number;
  readonly extractedAssetCount: number;
  readonly exportedAt: string;
}

const textDecoder = new TextDecoder();

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/json': 'json',
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

function encodeBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const chunks: string[] = [];
  const chunkSize = 0x3000; // divisible by 3
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    let part = '';
    for (let i = offset; i < end; i += 3) {
      const b0 = bytes[i];
      const hasB1 = i + 1 < end;
      const hasB2 = i + 2 < end;
      const b1 = hasB1 ? bytes[i + 1] : 0;
      const b2 = hasB2 ? bytes[i + 2] : 0;
      const triple = (b0 << 16) | (b1 << 8) | b2;
      part += BASE64_ALPHABET[(triple >>> 18) & 0x3f];
      part += BASE64_ALPHABET[(triple >>> 12) & 0x3f];
      part += hasB1 ? BASE64_ALPHABET[(triple >>> 6) & 0x3f] : '=';
      part += hasB2 ? BASE64_ALPHABET[triple & 0x3f] : '=';
    }
    chunks.push(part);
  }
  return chunks.join('');
}

function decodeBase64(input: string): Uint8Array | null {
  const cleaned = input.replace(/[\r\n\t ]+/g, '');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (cleaned.length % 4 !== 0) return null;

  let padding = 0;
  if (cleaned.endsWith('==')) padding = 2;
  else if (cleaned.endsWith('=')) padding = 1;

  const outLen = (cleaned.length / 4) * 3 - padding;
  const output = new Uint8Array(outLen);
  let outIdx = 0;

  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = cleaned.charCodeAt(i);
    const c1 = cleaned.charCodeAt(i + 1);
    const c2 = cleaned.charCodeAt(i + 2);
    const c3 = cleaned.charCodeAt(i + 3);
    if (c0 >= 128 || c1 >= 128 || c2 >= 128 || c3 >= 128) return null;

    const v0 = BASE64_LOOKUP[c0];
    const v1 = BASE64_LOOKUP[c1];
    const v2 = c2 === 61 ? 0 : BASE64_LOOKUP[c2];
    const v3 = c3 === 61 ? 0 : BASE64_LOOKUP[c3];
    if (v0 < 0 || v1 < 0 || (c2 !== 61 && v2 < 0) || (c3 !== 61 && v3 < 0)) return null;

    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (outIdx < outLen) output[outIdx++] = (triple >>> 16) & 0xff;
    if (outIdx < outLen) output[outIdx++] = (triple >>> 8) & 0xff;
    if (outIdx < outLen) output[outIdx++] = triple & 0xff;
  }

  return output;
}

function parseBase64DataUri(source: string): { readonly mimeType: string; readonly bytes: Uint8Array } | null {
  if (!source.startsWith('data:')) return null;
  const commaIdx = source.indexOf(',');
  if (commaIdx < 0) return null;
  const header = source.slice(5, commaIdx);
  if (!/;base64$/i.test(header)) return null;
  const mimeType = header.slice(0, header.length - ';base64'.length).trim().toLowerCase() || 'application/octet-stream';
  const payload = source.slice(commaIdx + 1);
  const bytes = decodeBase64(payload);
  if (!bytes) return null;
  return { mimeType, bytes };
}

function safeArchiveAssetSlug(assetId: string, fallbackIndex: number): string {
  const cleaned = assetId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : `asset-${fallbackIndex}`;
}

function safeDownloadBaseName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return cleaned || 'untitled-project';
}

/** Returns true if the leading 4 bytes match a PKZIP local file header (`PK\x03\x04`). */
export function isZipArchiveBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Serializes a validated, secret-sanitized Folio project into a `.flop` ZIP container
 * (`manifest.json`, `project.json`, and binary `assets/<id>.<ext>` entries).
 */
export function serializeProjectToFlopZip(project: FolioProject): Uint8Array {
  const sanitizedProject = sanitizeProjectNetworkSecrets(project);
  const validatedProject = requireValidProject(sanitizedProject);

  const unmaterialized = findUnmaterializedInternalAssets(validatedProject.assets);
  if (unmaterialized.length > 0) {
    throw new MissingExportAssetsError(unmaterialized);
  }

  const assetEntries: ZipArchiveEntry[] = [];
  const usedPaths = new Set<string>();
  const rewrittenAssets: AssetReference[] = [];
  let extractedAssetCount = 0;

  for (let i = 0; i < validatedProject.assets.length; i += 1) {
    const asset = validatedProject.assets[i];
    const parsedDataUri = parseBase64DataUri(asset.source);
    if (!parsedDataUri) {
      rewrittenAssets.push(asset);
      continue;
    }

    const mime = (asset.mimeType || parsedDataUri.mimeType || 'application/octet-stream').toLowerCase();
    const ext = MIME_EXTENSIONS[mime] ?? 'bin';
    const baseSlug = safeArchiveAssetSlug(asset.id, i);
    let entryPath = `assets/${baseSlug}.${ext}`;
    let suffix = 1;
    while (usedPaths.has(entryPath)) {
      entryPath = `assets/${baseSlug}-${suffix}.${ext}`;
      suffix += 1;
    }
    usedPaths.add(entryPath);

    assetEntries.push({
      path: entryPath,
      content: parsedDataUri.bytes,
    });
    extractedAssetCount += 1;

    rewrittenAssets.push({
      ...asset,
      source: `${FLOP_ARCHIVE_ASSET_SCHEME}${entryPath}`,
      byteLength: parsedDataUri.bytes.byteLength,
    });
  }

  const archivedProject: FolioProject = {
    ...validatedProject,
    assets: rewrittenAssets,
  };

  const manifest: FlopArchiveManifest = {
    containerFormat: FLOP_ARCHIVE_CONTAINER_FORMAT,
    containerVersion: FLOP_ARCHIVE_CONTAINER_VERSION,
    projectFormatVersion: validatedProject.formatVersion,
    projectId: validatedProject.metadata.id,
    projectName: validatedProject.metadata.name,
    assetCount: validatedProject.assets.length,
    extractedAssetCount,
    exportedAt: new Date().toISOString(),
  };

  const entries: ZipArchiveEntry[] = [
    {
      path: FLOP_ARCHIVE_MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2),
    },
    {
      path: FLOP_ARCHIVE_PROJECT_PATH,
      content: JSON.stringify(archivedProject, null, 2),
    },
    ...assetEntries,
  ];

  const zipBytes = buildZipArchive(entries);
  if (zipBytes.byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileSizeLimitError({
      direction: 'export',
      actualBytes: zipBytes.byteLength,
      maxBytes: MAX_PROJECT_FILE_BYTES,
      largestAsset: findLargestProjectAsset(validatedProject.assets),
    });
  }

  return zipBytes;
}

/**
 * Parses and validates a `.flop` ZIP container, verifying CRC-32 integrity,
 * rehydrating extracted binary assets into portable data URIs, and migrating
 * to the canonical `.flop` v2 schema.
 */
export function parseFlopZipArchive(bytes: Uint8Array): FolioProject {
  if (bytes.byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: bytes.byteLength,
      maxBytes: MAX_PROJECT_FILE_BYTES,
    });
  }
  if (!isZipArchiveBytes(bytes)) {
    throw new Error('The selected file is not a valid .flop ZIP archive.');
  }

  const entries = parseZipArchive(bytes);
  const byPath = new Map<string, Uint8Array>();
  for (const entry of entries) {
    byPath.set(entry.path, entry.data);
  }

  const manifestBytes = byPath.get(FLOP_ARCHIVE_MANIFEST_PATH);
  if (!manifestBytes) {
    throw new Error('Invalid .flop archive: missing manifest.json.');
  }
  let manifest: unknown;
  try {
    manifest = parseProjectJsonSafe(textDecoder.decode(manifestBytes));
  } catch {
    throw new Error('Invalid .flop archive: manifest.json is not valid JSON.');
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    (manifest as Record<string, unknown>).containerFormat !== FLOP_ARCHIVE_CONTAINER_FORMAT ||
    (manifest as Record<string, unknown>).containerVersion !== FLOP_ARCHIVE_CONTAINER_VERSION
  ) {
    throw new Error('Unsupported .flop archive container format or version.');
  }

  const projectBytes = byPath.get(FLOP_ARCHIVE_PROJECT_PATH);
  if (!projectBytes) {
    throw new Error('Invalid .flop archive: missing project.json.');
  }
  let parsedProject: unknown;
  try {
    parsedProject = parseProjectJsonSafe(textDecoder.decode(projectBytes));
  } catch {
    throw new Error('Invalid .flop archive: project.json is not valid JSON.');
  }

  if (typeof parsedProject !== 'object' || parsedProject === null || Array.isArray(parsedProject)) {
    throw new Error('Invalid .flop archive: project.json does not contain a project object.');
  }

  const candidate = parsedProject as Record<string, unknown>;
  if (Array.isArray(candidate.assets)) {
    const rehydratedAssets = candidate.assets.map((rawAsset) => {
      if (typeof rawAsset !== 'object' || rawAsset === null || Array.isArray(rawAsset)) {
        return rawAsset;
      }
      const assetRecord = rawAsset as Record<string, unknown>;
      const source = typeof assetRecord.source === 'string' ? assetRecord.source : '';
      if (!source.startsWith(FLOP_ARCHIVE_ASSET_SCHEME)) {
        return rawAsset;
      }

      const relPath = source.slice(FLOP_ARCHIVE_ASSET_SCHEME.length);
      const assetData = byPath.get(relPath);
      if (!assetData) {
        throw new Error(`Invalid .flop archive: referenced asset "${relPath}" is missing from archive.`);
      }
      const mimeType =
        typeof assetRecord.mimeType === 'string' && assetRecord.mimeType.trim().length > 0
          ? assetRecord.mimeType.trim()
          : 'application/octet-stream';
      const base64 = encodeBase64(assetData);
      return {
        ...assetRecord,
        source: `data:${mimeType};base64,${base64}`,
        byteLength: assetData.byteLength,
      };
    });
    candidate.assets = rehydratedAssets;
  }

  return migrateProjectToV2(candidate);
}

/** Triggers a browser download of the project packaged as a `.flop` ZIP archive. */
export function downloadProjectArchive(project: FolioProject): void {
  const zipBytes = serializeProjectToFlopZip(project);
  const copy = new Uint8Array(zipBytes.byteLength);
  copy.set(zipBytes);
  const blob = new Blob([copy.buffer], { type: 'application/vnd.folio.project+zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeDownloadBaseName(project.metadata.name)}.flop`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

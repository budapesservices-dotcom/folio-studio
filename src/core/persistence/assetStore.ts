/**
 * Deduplicated Binary Asset Pipeline for Folio Studio.
 *
 * - Supports PNG, JPG, WebP, and sanitized SVG uploads (drag-and-drop or file picker)
 * - Content-addressed SHA-256 deduplication stored in dedicated IndexedDB
 *   (`folio-studio-assets` v1, `blobs` object store keyed by `sha256`) so the main
 *   project store (`folio-studio` v2) never suffers VersionError or snapshot bloat
 * - Sanitizes uploaded SVG markup before storing (strips scripts, foreignObject,
 *   event handler attributes, and dangerous URI protocols)
 * - Automatically bundles binary assets into `.flop` (portable data URLs) and
 *   Export ZIP archives (`assets/<slug>-<shortHash>.<ext>`)
 */

import type { AssetReference, FolioProject, ImageNode } from '../document/types';

export const ASSET_DB_NAME = 'folio-studio-assets';
export const ASSET_DB_VERSION = 1;
export const ASSET_BLOB_STORE = 'blobs';
export const MAX_BINARY_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB per asset

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};

export interface StoredAssetBlobRecord {
  readonly sha256: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly blob: Blob;
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: string;
}

/** In-memory fast cache mapping sha256 -> displayable data/object URL. */
const memoryUrlByHash = new Map<string, string>();
const memoryBytesByHash = new Map<string, { bytes: Uint8Array; mimeType: string }>();

/**
 * Pure deterministic SHA-256 implementation (FIPS 180-4) used as a reliable
 * fallback when `crypto.subtle` is unavailable (e.g. non-secure HTTP origins).
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256FallbackHex(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  view.setUint32(padLen - 8, hi, false);
  view.setUint32(padLen - 4, lo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeBytesSha256(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle?.digest) {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below
    }
  }
  return sha256FallbackHex(bytes);
}

/**
 * Strictly sanitizes uploaded SVG markup so embedded scripts, foreignObject HTML,
 * inline event handlers, and dangerous href/src protocols cannot execute.
 */
export function sanitizeSvgMarkup(rawSvg: string): string {
  let clean = rawSvg
    // Remove dangerous elements and their bodies
    .replace(/<(script|foreignObject|iframe|object|embed|applet|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|applet|meta|link)\b[^>]*\/?>/gi, '')
    // Strip inline on* event handler attributes
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralize javascript:/vbscript:/data:text/html in href/xlink:href/src attributes
    .replace(
      /\b(xlink:href|href|src)\s*=\s*("[^"]*"|'[^']*')/gi,
      (_match, attr: string, quoted: string) => {
        const inner = quoted.slice(1, -1).trim();
        if (/^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(inner)) {
          return `${attr}=""`;
        }
        return `${attr}=${quoted}`;
      },
    );
  clean = clean.trim();
  return clean;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([a-zA-Z0-9.+/-]+)(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3];
  try {
    const bytes = isBase64
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

export function inferImageMimeType(fileName: string, providedMime?: string): string | null {
  const normalized = (providedMime ?? '').toLowerCase().trim();
  if (ALLOWED_IMAGE_MIME_TYPES.has(normalized)) return normalized;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

function openAssetDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(ASSET_DB_NAME, ASSET_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ASSET_BLOB_STORE)) {
          db.createObjectStore(ASSET_BLOB_STORE, { keyPath: 'sha256' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Stores a binary asset blob in the deduplicated IndexedDB store (`folio-studio-assets`)
 * keyed by SHA-256 content hash. If the hash already exists, returns `{ deduplicated: true }`
 * without rewriting redundant bytes.
 */
export async function putDeduplicatedAssetBlob(input: {
  sha256: string;
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}): Promise<{ deduplicated: boolean; persistedInIdb: boolean }> {
  const dataUrl = bytesToDataUrl(input.bytes, input.mimeType);
  const alreadyInMemory = memoryBytesByHash.has(input.sha256);
  memoryBytesByHash.set(input.sha256, { bytes: input.bytes, mimeType: input.mimeType });
  memoryUrlByHash.set(input.sha256, dataUrl);

  const db = await openAssetDatabase();
  if (!db) {
    return { deduplicated: alreadyInMemory, persistedInIdb: false };
  }

  try {
    const existing = await new Promise<StoredAssetBlobRecord | null>((resolve) => {
      const tx = db.transaction(ASSET_BLOB_STORE, 'readonly');
      const req = tx.objectStore(ASSET_BLOB_STORE).get(input.sha256);
      req.onsuccess = () => resolve((req.result as StoredAssetBlobRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    if (existing) {
      return { deduplicated: true, persistedInIdb: true };
    }

    const blobCopy = new Uint8Array(input.bytes.byteLength);
    blobCopy.set(input.bytes);
    const record: StoredAssetBlobRecord = {
      sha256: input.sha256,
      mimeType: input.mimeType,
      byteLength: input.bytes.byteLength,
      blob: new Blob([blobCopy.buffer], { type: input.mimeType }),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      createdAt: new Date().toISOString(),
    };
    const saved = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(ASSET_BLOB_STORE, 'readwrite');
      tx.objectStore(ASSET_BLOB_STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
    return { deduplicated: false, persistedInIdb: saved };
  } finally {
    db.close();
  }
}

export async function getAssetBlobRecord(sha256: string): Promise<StoredAssetBlobRecord | null> {
  const db = await openAssetDatabase();
  if (!db) return null;
  try {
    return await new Promise<StoredAssetBlobRecord | null>((resolve) => {
      const tx = db.transaction(ASSET_BLOB_STORE, 'readonly');
      const req = tx.objectStore(ASSET_BLOB_STORE).get(sha256);
      req.onsuccess = () => resolve((req.result as StoredAssetBlobRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function getAssetBytesByHash(sha256: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const cached = memoryBytesByHash.get(sha256);
  if (cached) return cached;
  const record = await getAssetBlobRecord(sha256);
  if (!record) return null;
  const buffer = await record.blob.arrayBuffer();
  const entry = { bytes: new Uint8Array(buffer), mimeType: record.mimeType };
  memoryBytesByHash.set(sha256, entry);
  memoryUrlByHash.set(sha256, bytesToDataUrl(entry.bytes, entry.mimeType));
  return entry;
}

/** Synchronously resolves an AssetReference into a safe displayable URL for Canvas/Export. */
export function resolveAssetDisplayUrl(asset: AssetReference | undefined): string | null {
  if (!asset) return null;
  if (asset.sha256) {
    const cached = memoryUrlByHash.get(asset.sha256);
    if (cached) return cached;
  }
  const src = asset.source.trim();
  if (src.startsWith('data:image/') || src.startsWith('blob:') || src.startsWith('https://') || src.startsWith('http://')) {
    return src;
  }
  if (src.startsWith('folio-asset://')) {
    const hash = src.slice('folio-asset://'.length);
    return memoryUrlByHash.get(hash) ?? null;
  }
  return null;
}

function probeImageDimensionsInBrowser(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      resolve(w > 0 && h > 0 ? { width: w, height: h } : null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function parseSvgIntrinsicDimensions(svgText: string): { width: number; height: number } | null {
  const vbMatch = /viewBox\s*=\s*["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i.exec(svgText);
  if (vbMatch) {
    const w = Number(vbMatch[1]);
    const h = Number(vbMatch[2]);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
  }
  const wMatch = /\bwidth\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i.exec(svgText);
  const hMatch = /\bheight\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i.exec(svgText);
  if (wMatch && hMatch) {
    const w = Number(wMatch[1]);
    const h = Number(hMatch[1]);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      return { width: Math.round(w), height: Math.round(h) };
    }
  }
  return null;
}

export interface IngestedImageResult {
  readonly asset: AssetReference;
  readonly deduplicated: boolean;
  readonly existingAssetId?: string;
}

/**
 * Validates, sanitizes (for SVG), SHA-256 hashes, deduplicates, and stores raw
 * image bytes into IndexedDB + memory cache, returning a valid `AssetReference`.
 */
export async function ingestImageBytes(
  input: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    width?: number;
    height?: number;
  },
  existingAssets: readonly AssetReference[] = [],
): Promise<IngestedImageResult> {
  const mimeType = inferImageMimeType(input.name, input.mimeType);
  if (!mimeType) {
    throw new Error('Unsupported image format. Please use PNG, JPG, WebP, or SVG.');
  }
  if (input.bytes.byteLength === 0) {
    throw new Error('The image file is empty.');
  }
  if (input.bytes.byteLength > MAX_BINARY_ASSET_BYTES) {
    throw new Error(`Image exceeds the ${Math.round(MAX_BINARY_ASSET_BYTES / (1024 * 1024))} MB per-asset safety limit.`);
  }

  let finalBytes = input.bytes;
  let detectedSize: { width: number; height: number } | null =
    input.width && input.height ? { width: input.width, height: input.height } : null;

  if (mimeType === 'image/svg+xml') {
    const rawText = new TextDecoder().decode(input.bytes);
    const sanitized = sanitizeSvgMarkup(rawText);
    if (!/<svg\b/i.test(sanitized)) {
      throw new Error('The uploaded SVG file does not contain a valid <svg> root element.');
    }
    finalBytes = new TextEncoder().encode(sanitized);
    detectedSize ??= parseSvgIntrinsicDimensions(sanitized);
  }

  const sha256 = await computeBytesSha256(finalBytes);
  const dataUrl = bytesToDataUrl(finalBytes, mimeType);
  if (!detectedSize) {
    detectedSize = await probeImageDimensionsInBrowser(dataUrl);
  }

  await putDeduplicatedAssetBlob({
    sha256,
    bytes: finalBytes,
    mimeType,
    width: detectedSize?.width,
    height: detectedSize?.height,
  });

  // Deduplicate against project.assets by SHA-256 content hash
  const existing = existingAssets.find((item) => item.kind === 'image' && item.sha256 === sha256);
  if (existing) {
    return { asset: existing, deduplicated: true, existingAssetId: existing.id };
  }

  const asset: AssetReference = {
    id: `asset-${sha256.slice(0, 12)}`,
    name: input.name.trim() || `image.${EXTENSION_BY_MIME[mimeType] ?? 'png'}`,
    kind: 'image',
    mimeType,
    source: dataUrl,
    sha256,
    byteLength: finalBytes.byteLength,
    ...(detectedSize ? { width: detectedSize.width, height: detectedSize.height } : {}),
    createdAt: new Date().toISOString(),
  };

  return { asset, deduplicated: false };
}

export async function ingestImageFile(
  file: File,
  existingAssets: readonly AssetReference[] = [],
): Promise<IngestedImageResult> {
  if (file.size > MAX_BINARY_ASSET_BYTES) {
    throw new Error(`Image "${file.name}" exceeds the ${Math.round(MAX_BINARY_ASSET_BYTES / (1024 * 1024))} MB per-asset limit.`);
  }
  const buffer = await file.arrayBuffer();
  return ingestImageBytes(
    {
      name: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(buffer),
    },
    existingAssets,
  );
}

/** Creates an ImageNode neatly fitted within maxDimension while preserving aspect ratio. */
export function createImageNodeFromAsset(
  asset: AssetReference,
  options: {
    x: number;
    y: number;
    maxDimension?: number;
    id?: string;
    name?: string;
  },
): ImageNode {
  const natW = Math.max(1, asset.width ?? 360);
  const natH = Math.max(1, asset.height ?? 240);
  const maxDim = options.maxDimension ?? 480;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const width = Math.max(24, Math.round(natW * scale));
  const height = Math.max(24, Math.round(natH * scale));
  const baseName = (options.name ?? asset.name).replace(/\.[^.]+$/, '').trim() || 'Image';

  return {
    id: options.id ?? (globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}`),
    type: 'image',
    name: baseName,
    assetId: asset.id,
    alt: baseName,
    naturalWidth: natW,
    naturalHeight: natH,
    x: Math.round(options.x),
    y: Math.round(options.y),
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fit: 'cover',
      radius: 0,
      stroke: 'none',
      strokeWidth: 0,
    },
  };
}

/** Deterministic relative bundle path for an asset in Export ZIP (`assets/<slug>-<hash>.<ext>`). */
export function getAssetBundlePath(asset: AssetReference): string {
  const ext = EXTENSION_BY_MIME[asset.mimeType.toLowerCase()] ?? 'bin';
  const base = asset.name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'asset';
  const suffix = (asset.sha256 ?? asset.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || '0000';
  return `assets/${base}-${suffix}.${ext}`;
}

/** Extracts raw binary bytes from an AssetReference (inline data URL or in-memory hash cache). */
export function extractAssetBinaryBytesSync(asset: AssetReference): Uint8Array | null {
  if (asset.sha256) {
    const cached = memoryBytesByHash.get(asset.sha256);
    if (cached) return cached.bytes;
  }
  const decoded = dataUrlToBytes(asset.source);
  return decoded ? decoded.bytes : null;
}

/**
 * Hydrates embedded `data:` assets from a loaded `.flop` project into the
 * deduplicated IndexedDB blob store & memory cache (best-effort async).
 */
export async function hydrateProjectAssetsToStore(project: FolioProject): Promise<void> {
  for (const asset of project.assets) {
    if (asset.source.startsWith('data:')) {
      const decoded = dataUrlToBytes(asset.source);
      if (!decoded) continue;
      const sha256 = asset.sha256 ?? (await computeBytesSha256(decoded.bytes));
      await putDeduplicatedAssetBlob({
        sha256,
        bytes: decoded.bytes,
        mimeType: asset.mimeType || decoded.mimeType,
        width: asset.width,
        height: asset.height,
      });
    } else if (asset.sha256) {
      await getAssetBytesByHash(asset.sha256);
    }
  }
}

/**
 * Ensures every `AssetReference` in a `.flop` export snapshot carries a portable
 * self-contained `data:` URL (hydrating any `folio-asset://<sha256>` reference
 * from IndexedDB / memory cache) and deduplicates redundant entries by `sha256`.
 */
export async function materializeProjectAssetsForExport(project: FolioProject): Promise<FolioProject> {
  if (project.assets.length === 0) return project;
  let changed = false;
  const nextAssets: AssetReference[] = [];
  for (const asset of project.assets) {
    if (asset.source.startsWith('folio-asset://') || (!asset.source.startsWith('data:') && asset.sha256)) {
      const hash = asset.sha256 ?? asset.source.slice('folio-asset://'.length);
      const entry = await getAssetBytesByHash(hash);
      if (entry) {
        changed = true;
        nextAssets.push({
          ...asset,
          sha256: hash,
          byteLength: entry.bytes.byteLength,
          source: bytesToDataUrl(entry.bytes, asset.mimeType || entry.mimeType),
        });
        continue;
      }
    }
    nextAssets.push(asset);
  }
  return changed ? { ...project, assets: nextAssets } : project;
}

import type { AssetReference } from '../document/types';

/**
 * Single source of truth for `.flop` JSON v2 portability size limits across
 * upload budget estimation, `.flop` export serialization, and `.flop` import.
 *
 * Kept at 25 MiB to prevent browser tab OOM / freeze on low-RAM devices.
 */
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

/** Canonical maximum `.flop` project size contract (identical to `MAX_PROJECT_FILE_BYTES`). */
export const MAX_PROJECT_SIZE = MAX_PROJECT_FILE_BYTES;

/** Conservative headroom reserved for non-asset project JSON structure (pages, nodes, components, logic, code). */
export const PROJECT_JSON_HEADROOM_BYTES = 1 * 1024 * 1024;

/** Maximum cumulative serialized (Base64 data URL) asset budget expected to fit inside a portable `.flop` file. */
export const MAX_PROJECT_SERIALIZED_ASSETS_BYTES = MAX_PROJECT_FILE_BYTES - PROJECT_JSON_HEADROOM_BYTES;

/** Equivalent cumulative raw binary asset budget (~18 MiB raw -> ~24 MiB Base64 + ~1 MiB JSON <= 25 MiB). */
export const MAX_PROJECT_RAW_ASSETS_BYTES = Math.floor((MAX_PROJECT_SERIALIZED_ASSETS_BYTES * 3) / 4);

/** Early warning threshold ratio against `MAX_PROJECT_FILE_BYTES` (80% = 20 MiB serialized). */
export const PROJECT_ASSET_WARNING_RATIO = 0.8;

/** Internal IndexedDB-backed content-addressed URI scheme that must never leak into exported `.flop` files. */
export const INTERNAL_ASSET_URI_PREFIX = 'folio-asset://';

export interface LargestProjectAssetInfo {
  readonly id: string;
  readonly name: string;
  readonly serializedBytes: number;
  readonly rawBytes: number;
}

export interface MissingExportAssetInfo {
  readonly id: string;
  readonly name: string;
  readonly sha256: string | null;
  readonly source: string;
  readonly kind: AssetReference['kind'];
}

export type ProjectAssetBudgetStatus = 'ok' | 'warning' | 'exceeds-flop-limit';

export interface ProjectAssetBudgetReport {
  readonly assetCount: number;
  readonly totalRawBytes: number;
  readonly totalEstimatedSerializedBytes: number;
  readonly maxProjectFileBytes: number;
  readonly maxSerializedAssetsBytes: number;
  readonly maxRawAssetsBytes: number;
  readonly utilizationRatio: number;
  readonly status: ProjectAssetBudgetStatus;
  readonly largestAsset: LargestProjectAssetInfo | null;
  readonly warningMessage: string | null;
}

/**
 * Exact UTF-8 byte length calculation without allocating a duplicate Uint8Array
 * copy of large multi-megabyte JSON strings on low-RAM devices.
 */
export function getUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function formatByteSizeMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (Number.isInteger(mb)) {
    return `${mb} MB`;
  }
  return `${mb.toFixed(2)} MB`;
}

/** Estimates exact `data:<mime>;base64,...` UTF-8 byte length for a raw binary payload (~33.3% Base64 overhead). */
export function estimateBase64DataUrlBytes(
  rawByteLength: number,
  mimeType = 'application/octet-stream',
): number {
  const safeRaw = Math.max(0, Math.floor(rawByteLength));
  const base64Chars = Math.ceil(safeRaw / 3) * 4;
  const headerLength = `data:${mimeType};base64,`.length;
  return headerLength + base64Chars;
}

export function estimateAssetSerializedBytes(asset: AssetReference): {
  readonly serializedBytes: number;
  readonly rawBytes: number;
} {
  const source = asset.source.trim();
  if (source.startsWith('data:')) {
    const serializedBytes = getUtf8ByteLength(source);
    const commaIdx = source.indexOf(',');
    const payloadBytes = commaIdx >= 0 ? Math.max(0, serializedBytes - (commaIdx + 1)) : serializedBytes;
    const rawBytes =
      typeof asset.byteLength === 'number' && Number.isFinite(asset.byteLength) && asset.byteLength >= 0
        ? asset.byteLength
        : Math.floor((payloadBytes * 3) / 4);
    return { serializedBytes, rawBytes };
  }
  if (typeof asset.byteLength === 'number' && Number.isFinite(asset.byteLength) && asset.byteLength > 0) {
    return {
      serializedBytes: estimateBase64DataUrlBytes(asset.byteLength, asset.mimeType),
      rawBytes: asset.byteLength,
    };
  }
  const sourceBytes = getUtf8ByteLength(source);
  return { serializedBytes: sourceBytes, rawBytes: sourceBytes };
}

export function findLargestProjectAsset(
  assets: readonly AssetReference[],
): LargestProjectAssetInfo | null {
  let largest: LargestProjectAssetInfo | null = null;
  for (const asset of assets) {
    const { serializedBytes, rawBytes } = estimateAssetSerializedBytes(asset);
    if (!largest || serializedBytes > largest.serializedBytes) {
      largest = {
        id: asset.id,
        name: asset.name,
        serializedBytes,
        rawBytes,
      };
    }
  }
  return largest;
}

/**
 * Evaluates cumulative project asset size against the canonical 25 MiB `.flop`
 * export/import contract (accounting for ~33% Base64 serialization overhead).
 */
export function evaluateProjectAssetPortabilityBudget(
  assets: readonly AssetReference[],
): ProjectAssetBudgetReport {
  let totalRawBytes = 0;
  let totalEstimatedSerializedBytes = 0;
  let largestAsset: LargestProjectAssetInfo | null = null;

  for (const asset of assets) {
    const { serializedBytes, rawBytes } = estimateAssetSerializedBytes(asset);
    totalRawBytes += rawBytes;
    totalEstimatedSerializedBytes += serializedBytes;
    if (!largestAsset || serializedBytes > largestAsset.serializedBytes) {
      largestAsset = {
        id: asset.id,
        name: asset.name,
        serializedBytes,
        rawBytes,
      };
    }
  }

  const utilizationRatio = totalEstimatedSerializedBytes / MAX_PROJECT_FILE_BYTES;
  const warningThresholdBytes = Math.floor(MAX_PROJECT_FILE_BYTES * PROJECT_ASSET_WARNING_RATIO);
  const largestSuffix = largestAsset
    ? ` Largest asset: "${largestAsset.name}" (~${formatByteSizeMb(largestAsset.serializedBytes)} in .flop).`
    : '';

  let status: ProjectAssetBudgetStatus = 'ok';
  let warningMessage: string | null = null;

  if (totalEstimatedSerializedBytes > MAX_PROJECT_SERIALIZED_ASSETS_BYTES) {
    status = 'exceeds-flop-limit';
    warningMessage =
      `Project assets (~${formatByteSizeMb(totalEstimatedSerializedBytes)} after Base64 encoding) exceed the ` +
      `${formatByteSizeMb(MAX_PROJECT_FILE_BYTES)} .flop export limit.${largestSuffix} ` +
      'Remove or compress large assets before exporting .flop.';
  } else if (totalEstimatedSerializedBytes >= warningThresholdBytes) {
    status = 'warning';
    const percent = Math.round(utilizationRatio * 100);
    warningMessage =
      `Project assets (~${formatByteSizeMb(totalEstimatedSerializedBytes)} after Base64 encoding) are approaching the ` +
      `${formatByteSizeMb(MAX_PROJECT_FILE_BYTES)} .flop export limit (${percent}% used).${largestSuffix}`;
  }

  return {
    assetCount: assets.length,
    totalRawBytes,
    totalEstimatedSerializedBytes,
    maxProjectFileBytes: MAX_PROJECT_FILE_BYTES,
    maxSerializedAssetsBytes: MAX_PROJECT_SERIALIZED_ASSETS_BYTES,
    maxRawAssetsBytes: MAX_PROJECT_RAW_ASSETS_BYTES,
    utilizationRatio,
    status,
    largestAsset,
    warningMessage,
  };
}

/**
 * Returns any internal/non-portable asset references (`folio-asset://` or ephemeral `blob:`)
 * that have not been materialized into self-contained `data:` URLs.
 */
export function findUnmaterializedInternalAssets(
  assets: readonly AssetReference[],
): MissingExportAssetInfo[] {
  const unmaterialized: MissingExportAssetInfo[] = [];
  for (const asset of assets) {
    const trimmed = asset.source.trim();
    if (trimmed.startsWith(INTERNAL_ASSET_URI_PREFIX)) {
      const hashFromUri = trimmed.slice(INTERNAL_ASSET_URI_PREFIX.length).trim();
      const sha256 = (asset.sha256 ?? hashFromUri).trim() || null;
      unmaterialized.push({
        id: asset.id,
        name: asset.name,
        sha256,
        source: asset.source,
        kind: asset.kind,
      });
    } else if (trimmed.startsWith('blob:')) {
      unmaterialized.push({
        id: asset.id,
        name: asset.name,
        sha256: asset.sha256?.trim() || null,
        source: asset.source,
        kind: asset.kind,
      });
    }
  }
  return unmaterialized;
}

export interface ProjectFileSizeLimitErrorOptions {
  readonly direction: 'export' | 'import';
  readonly actualBytes: number;
  readonly maxBytes?: number;
  readonly largestAsset?: LargestProjectAssetInfo | null;
}

export class ProjectFileSizeLimitError extends Error {
  readonly code = 'PROJECT_FILE_SIZE_LIMIT_EXCEEDED' as const;
  readonly direction: 'export' | 'import';
  readonly actualBytes: number;
  readonly maxBytes: number;
  readonly largestAsset: LargestProjectAssetInfo | null;

  constructor(options: ProjectFileSizeLimitErrorOptions) {
    const maxBytes = options.maxBytes ?? MAX_PROJECT_FILE_BYTES;
    const largestAsset = options.largestAsset ?? null;
    const actualText = formatByteSizeMb(options.actualBytes);
    const maxText = formatByteSizeMb(maxBytes);

    let message: string;
    const largestDetail = largestAsset
      ? ` Largest asset: "${largestAsset.name}" (${formatByteSizeMb(largestAsset.serializedBytes)} in .flop / ${formatByteSizeMb(largestAsset.rawBytes)} raw).`
      : '';
    if (options.direction === 'export') {
      message =
        `Cannot export .flop file: serialized size (${actualText}) exceeds the ${maxText} safety limit.` +
        `${largestDetail} Remove or compress large assets before exporting.`;
    } else {
      message = `The selected .flop file (${actualText}) exceeds the ${maxText} safety limit.${largestDetail}`;
    }

    super(message);
    this.name = 'ProjectFileSizeLimitError';
    this.direction = options.direction;
    this.actualBytes = options.actualBytes;
    this.maxBytes = maxBytes;
    this.largestAsset = largestAsset;
  }
}

export class MissingExportAssetsError extends Error {
  readonly code = 'MISSING_EXPORT_ASSETS' as const;
  readonly missingAssets: readonly MissingExportAssetInfo[];

  constructor(missingAssets: readonly MissingExportAssetInfo[]) {
    const summary = missingAssets
      .map((asset) => `"${asset.name}" [${asset.id}]`)
      .join(', ');
    const count = missingAssets.length;
    super(
      `Cannot export portable .flop file: ${count} asset blob${count === 1 ? ' is' : 's are'} missing from local storage (${summary}). Re-upload the missing asset${count === 1 ? '' : 's'} before exporting.`,
    );
    this.name = 'MissingExportAssetsError';
    this.missingAssets = [...missingAssets];
  }
}

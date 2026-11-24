/**
 * Pure, zero-dependency PKZIP Store-mode archive builder and reader.
 * Used to export multi-file compiled Folio projects (HTML/CSS or React TSX)
 * directly in the browser or Node without adding external compression packages.
 */

export interface ZipArchiveEntry {
  readonly path: string;
  readonly content: string | Uint8Array;
}

export interface ParsedZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
  readonly crc32: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function normalizeArchiveEntryPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error('Archive entry path cannot be empty.');
  }
  if (trimmed.includes('\\') || trimmed.startsWith('/') || trimmed.includes('\0')) {
    throw new Error(`Unsafe archive entry path: "${rawPath}".`);
  }
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`Unsafe archive entry path segment in "${rawPath}".`);
    }
  }
  return segments.join('/');
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Builds a standards-compliant Store-mode ZIP archive (PKZIP 2.0, UTF-8 flag 0x0800).
 * Uses a deterministic fixed DOS timestamp (2026-01-01 00:00:00) so identical project
 * inputs produce byte-for-byte reproducible archives.
 */
export function buildZipArchive(entries: readonly ZipArchiveEntry[]): Uint8Array {
  const seenPaths = new Set<string>();
  const prepared: Array<{
    pathBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc32: number;
    localHeaderOffset: number;
  }> = [];

  // Fixed DOS timestamp for deterministic builds: 2026-01-01 00:00:00
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  let localSectionSize = 0;
  let centralSectionSize = 0;

  for (const entry of entries) {
    const normalizedPath = normalizeArchiveEntryPath(entry.path);
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Duplicate archive entry path: "${normalizedPath}".`);
    }
    seenPaths.add(normalizedPath);

    const pathBytes = textEncoder.encode(normalizedPath);
    const dataBytes = typeof entry.content === 'string'
      ? textEncoder.encode(entry.content)
      : entry.content;
    const crc32 = computeCrc32(dataBytes);
    const localHeaderOffset = localSectionSize;

    prepared.push({ pathBytes, dataBytes, crc32, localHeaderOffset });

    localSectionSize += 30 + pathBytes.length + dataBytes.length;
    centralSectionSize += 46 + pathBytes.length;
  }

  const totalSize = localSectionSize + centralSectionSize + 22;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // 1. Write local file headers + raw file payloads
  let offset = 0;
  for (const item of prepared) {
    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(offset + 6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(offset + 8, 0, true); // Compression method (0 = Store)
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, item.crc32, true);
    view.setUint32(offset + 18, item.dataBytes.length, true); // Compressed size
    view.setUint32(offset + 22, item.dataBytes.length, true); // Uncompressed size
    view.setUint16(offset + 26, item.pathBytes.length, true);
    view.setUint16(offset + 28, 0, true); // Extra field length
    offset += 30;

    buffer.set(item.pathBytes, offset);
    offset += item.pathBytes.length;
    buffer.set(item.dataBytes, offset);
    offset += item.dataBytes.length;
  }

  // 2. Write central directory records
  const centralDirOffset = offset;
  for (const item of prepared) {
    view.setUint32(offset, 0x02014b50, true); // Central directory file header signature
    view.setUint16(offset + 4, 20, true); // Version made by
    view.setUint16(offset + 6, 20, true); // Version needed to extract
    view.setUint16(offset + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(offset + 10, 0, true); // Compression method (Store)
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, item.crc32, true);
    view.setUint32(offset + 20, item.dataBytes.length, true);
    view.setUint32(offset + 24, item.dataBytes.length, true);
    view.setUint16(offset + 28, item.pathBytes.length, true);
    view.setUint16(offset + 30, 0, true); // Extra field length
    view.setUint16(offset + 32, 0, true); // File comment length
    view.setUint16(offset + 34, 0, true); // Disk number start
    view.setUint16(offset + 36, 0, true); // Internal file attributes
    view.setUint32(offset + 38, 0, true); // External file attributes
    view.setUint32(offset + 42, item.localHeaderOffset, true);
    offset += 46;

    buffer.set(item.pathBytes, offset);
    offset += item.pathBytes.length;
  }

  // 3. Write End of Central Directory (EOCD) record
  view.setUint32(offset, 0x06054b50, true); // EOCD signature
  view.setUint16(offset + 4, 0, true); // Number of this disk
  view.setUint16(offset + 6, 0, true); // Disk with central directory
  view.setUint16(offset + 8, prepared.length, true); // Entries on this disk
  view.setUint16(offset + 10, prepared.length, true); // Total entries
  view.setUint32(offset + 12, centralSectionSize, true); // Size of central directory
  view.setUint32(offset + 16, centralDirOffset, true); // Offset of central directory
  view.setUint16(offset + 20, 0, true); // Comment length

  return buffer;
}

/**
 * Parses a Store-mode ZIP archive and validates every entry's CRC-32 checksum.
 */
export function parseZipArchive(bytes: Uint8Array): ParsedZipEntry[] {
  if (bytes.length < 22) {
    throw new Error('Invalid ZIP archive: shorter than EOCD header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = bytes.length - 22;
  if (view.getUint32(eocdOffset, true) !== 0x06054b50) {
    throw new Error('Invalid ZIP archive: missing EOCD signature.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const results: ParsedZipEntry[] = [];

  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Invalid ZIP archive: malformed central directory entry.');
    }
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method: ${method}.`);
    }
    const expectedCrc = view.getUint32(cursor + 16, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const path = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP archive: missing local header for "${path}".`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + uncompressedSize);
    const actualCrc = computeCrc32(data);
    if (actualCrc !== expectedCrc) {
      throw new Error(`CRC-32 mismatch for archive entry "${path}".`);
    }
    results.push({ path, data, crc32: actualCrc });
  }

  return results;
}

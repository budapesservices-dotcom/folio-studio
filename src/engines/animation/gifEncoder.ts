/**
 * Native Zero-Dependency GIF89a Animated GIF Encoder for Folio Studio.
 * Uses a fast 6x7x6 + grayscale 256-color palette (reserving index 255 for alpha
 * transparency when enabled), optional 2x2 Bayer ordered dithering, NETSCAPE2.0
 * loop extension, and variable-width LZW compression.
 */

export interface GifFrameInput {
  readonly rgba: Uint8ClampedArray;
  /** Frame delay in milliseconds (quantized to GIF centiseconds, min 20ms). */
  readonly delayMs: number;
}

export interface GifEncodeOptions {
  readonly width: number;
  readonly height: number;
  /** 0 = infinite loop; positive integer = repeat count. Defaults to 0. */
  readonly loopCount?: number;
  /** Enables 1-bit alpha transparency (pixels with alpha < 128 become transparent). */
  readonly transparent?: boolean;
  /** Enables subtle 2x2 Bayer ordered dithering for smoother gradients & blurs. */
  readonly dither?: boolean;
}

const TRANSPARENT_INDEX = 255;
// 6 * 7 * 6 = 252 color cube + 3 neutral grays (or 4 when opaque) = 255 / 256 entries
const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;
const BAYER_2X2 = [
  [-0.375, 0.125],
  [0.375, -0.125],
] as const;

function buildGlobalPalette(transparent: boolean): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  let idx = 0;
  for (let r = 0; r < R_LEVELS; r += 1) {
    const rv = Math.round((r * 255) / (R_LEVELS - 1));
    for (let g = 0; g < G_LEVELS; g += 1) {
      const gv = Math.round((g * 255) / (G_LEVELS - 1));
      for (let b = 0; b < B_LEVELS; b += 1) {
        const bv = Math.round((b * 255) / (B_LEVELS - 1));
        palette[idx * 3] = rv;
        palette[idx * 3 + 1] = gv;
        palette[idx * 3 + 2] = bv;
        idx += 1;
      }
    }
  }
  // Fill remaining 3-4 slots with mid-grays (index 255 reserved if transparent)
  const extraGrays = [42, 128, 212, 240];
  for (let i = 0; idx < 256; i += 1, idx += 1) {
    const v = transparent && idx === TRANSPARENT_INDEX ? 0 : (extraGrays[i] ?? 128);
    palette[idx * 3] = v;
    palette[idx * 3 + 1] = v;
    palette[idx * 3 + 2] = v;
  }
  return palette;
}

function quantizeFrameToIndices(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  transparent: boolean,
  dither: boolean,
): Uint8Array {
  const pixelCount = width * height;
  const indices = new Uint8Array(pixelCount);
  const rScale = (R_LEVELS - 1) / 255;
  const gScale = (G_LEVELS - 1) / 255;
  const bScale = (B_LEVELS - 1) / 255;

  for (let y = 0; y < height; y += 1) {
    const bayerRow = BAYER_2X2[y & 1];
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const off = p * 4;
      const a = rgba[off + 3];
      if (transparent && a < 128) {
        indices[p] = TRANSPARENT_INDEX;
        continue;
      }
      const d = dither ? bayerRow[x & 1] * 24 : 0;
      const r = Math.max(0, Math.min(255, rgba[off] + d));
      const g = Math.max(0, Math.min(255, rgba[off + 1] + d));
      const b = Math.max(0, Math.min(255, rgba[off + 2] + d));

      const ri = Math.round(r * rScale);
      const gi = Math.round(g * gScale);
      const bi = Math.round(b * bScale);
      indices[p] = ri * (G_LEVELS * B_LEVELS) + gi * B_LEVELS + bi;
    }
  }
  return indices;
}

/**
 * Compresses indexed pixels using GIF LZW with minCodeSize = 8 (256-color table).
 */
function encodeLzw(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clearCode = 1 << minCodeSize; // 256
  const eoiCode = clearCode + 1;      // 257
  const maxTableSize = 4096;

  // Flat hash table for fast prefix+symbol -> code lookup (zero GC pressure on low-spec PCs)
  const HASH_SIZE = 8192;
  const hashKeys = new Int32Array(HASH_SIZE).fill(-1);
  const hashVals = new Int16Array(HASH_SIZE);

  const resetTable = () => {
    hashKeys.fill(-1);
  };

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const subBlocks: Uint8Array[] = [];
  const blockBuf = new Uint8Array(255);
  let blockPos = 0;
  let bitAcc = 0;
  let bitCount = 0;

  const flushBlock = () => {
    if (blockPos === 0) return;
    const chunk = new Uint8Array(blockPos + 1);
    chunk[0] = blockPos;
    chunk.set(blockBuf.subarray(0, blockPos), 1);
    subBlocks.push(chunk);
    blockPos = 0;
  };

  const emitCode = (code: number) => {
    bitAcc |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      blockBuf[blockPos] = bitAcc & 0xff;
      blockPos += 1;
      bitAcc >>>= 8;
      bitCount -= 8;
      if (blockPos === 255) {
        flushBlock();
      }
    }
  };

  emitCode(clearCode);

  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      let slot = ((prefix << 5) ^ k) & (HASH_SIZE - 1);
      let found = -1;
      while (hashKeys[slot] !== -1) {
        if (hashKeys[slot] === key) {
          found = hashVals[slot];
          break;
        }
        slot = (slot + 1) & (HASH_SIZE - 1);
      }

      if (found !== -1) {
        prefix = found;
      } else {
        emitCode(prefix);
        if (nextCode < maxTableSize) {
          hashKeys[slot] = key;
          hashVals[slot] = nextCode;
          nextCode += 1;
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize += 1;
          }
        } else {
          emitCode(clearCode);
          resetTable();
          codeSize = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }
        prefix = k;
      }
    }
    emitCode(prefix);
  }

  emitCode(eoiCode);
  if (bitCount > 0) {
    blockBuf[blockPos] = bitAcc & 0xff;
    blockPos += 1;
  }
  flushBlock();

  // Prefix with minCodeSize byte and suffix with 0x00 block terminator
  let total = 2;
  for (const b of subBlocks) total += b.length;
  const out = new Uint8Array(total);
  out[0] = minCodeSize;
  let offset = 1;
  for (const b of subBlocks) {
    out.set(b, offset);
    offset += b.length;
  }
  out[total - 1] = 0x00;
  return out;
}

function u16le(val: number): [number, number] {
  return [val & 0xff, (val >>> 8) & 0xff];
}

/**
 * Encodes one or more RGBA frames into a complete animated GIF89a file (`Uint8Array`).
 */
export function encodeAnimatedGif(
  frames: readonly GifFrameInput[],
  options: GifEncodeOptions,
): Uint8Array {
  if (frames.length === 0) {
    throw new Error('Cannot encode an empty GIF frame list.');
  }
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const transparent = Boolean(options.transparent);
  const dither = options.dither !== false;
  const loopCount = Math.max(0, Math.min(65535, Math.round(options.loopCount ?? 0)));

  const palette = buildGlobalPalette(transparent);
  const chunks: Uint8Array[] = [];

  // Header + Logical Screen Descriptor (13 bytes)
  const [wLo, wHi] = u16le(width);
  const [hLo, hHi] = u16le(height);
  chunks.push(
    new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      wLo, wHi,
      hLo, hHi,
      0xf7, // Global Color Table flag (1), color res 7 (8-bit), sort 0, size 7 (256 entries)
      transparent ? TRANSPARENT_INDEX : 0, // Background color index
      0x00, // Pixel aspect ratio
    ]),
  );

  // Global Color Table (768 bytes)
  chunks.push(palette);

  // NETSCAPE2.0 Application Extension for looping (19 bytes)
  if (frames.length > 1) {
    const [lLo, lHi] = u16le(loopCount);
    chunks.push(
      new Uint8Array([
        0x21, 0xff, 0x0b,
        0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
        0x03, 0x01, lLo, lHi,
        0x00,
      ]),
    );
  }

  for (const frame of frames) {
    const delayCs = Math.max(2, Math.round(frame.delayMs / 10));
    const [dLo, dHi] = u16le(delayCs);
    // Graphic Control Extension (8 bytes)
    // Disposal method: 2 (restore to background) when transparent, 1 (do not dispose) when opaque
    const packedGce = transparent ? 0x09 : 0x04;
    chunks.push(
      new Uint8Array([
        0x21, 0xf9, 0x04,
        packedGce,
        dLo, dHi,
        transparent ? TRANSPARENT_INDEX : 0,
        0x00,
      ]),
    );

    // Image Descriptor (10 bytes)
    chunks.push(
      new Uint8Array([
        0x2c,
        0x00, 0x00, // left
        0x00, 0x00, // top
        wLo, wHi,
        hLo, hHi,
        0x00, // no local color table, not interlaced
      ]),
    );

    const indexed = quantizeFrameToIndices(frame.rgba, width, height, transparent, dither);
    chunks.push(encodeLzw(indexed, 8));
  }

  // GIF Trailer
  chunks.push(new Uint8Array([0x3b]));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

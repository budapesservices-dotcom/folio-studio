/**
 * Embedded WebAssembly 1.0 Linear-Memory Sweep-Line Geometry Kernel.
 *
 * Compiles a ~250-byte spec-compliant WebAssembly binary directly to V8
 * Liftoff/TurboFan native machine code for broad-phase X-sorted segment AABB
 * overlap detection inside Folio's 2D Planar Boolean & Shape Builder engine.
 *
 * Exported WASM function:
 *   sweep_overlap_pairs(count: i32, outOffset: i32, maxPairs: i32) -> i32
 *
 * Memory layout (imported `env.memory`):
 *   - [0 .. count * 32): Float64Array sorted ascending by minX: [minX, minY, maxX, maxY]
 *   - [outOffset .. outOffset + maxPairs * 8): Int32Array interleaved [i0, j0, i1, j1, ...]
 *   - Returns exact pair count, or -1 if output capacity `maxPairs` is exceeded.
 */

const WASM_PAGE_BYTES = 65536;
const BYTES_PER_AABB = 32; // 4 * float64 (minX, minY, maxX, maxY)

function encodeU32(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

function encodeString(text: string): number[] {
  const encoded = Array.from(new TextEncoder().encode(text));
  return [...encodeU32(encoded.length), ...encoded];
}

function encodeSection(sectionId: number, payload: number[]): number[] {
  return [sectionId, ...encodeU32(payload.length), ...payload];
}

function buildWasmGeometryModuleBytes(): Uint8Array {
  const I32 = 0x7f;
  const F64 = 0x7c;

  // Type section: (i32, i32, i32) -> (i32)
  const typeSection = encodeSection(1, [
    1,
    0x60,
    3, I32, I32, I32,
    1, I32,
  ]);

  // Import section: env.memory (min=1 page)
  const importSection = encodeSection(2, [
    1,
    ...encodeString('env'),
    ...encodeString('memory'),
    0x02,
    0x00,
    ...encodeU32(1),
  ]);

  // Function section: 1 function of type 0
  const functionSection = encodeSection(3, [1, 0]);

  // Export section: export "sweep_overlap_pairs" -> func 0
  const exportSection = encodeSection(7, [
    1,
    ...encodeString('sweep_overlap_pairs'),
    0x00,
    0,
  ]);

  // Params: 0=count, 1=outOffset, 2=maxPairs
  // Locals: 3=i, 4=j, 5=ptrI, 6=ptrJ, 7=pairs, 8=outPtr (i32); 9=maxXI, 10=minYI, 11=maxYI (f64)
  const bodyInstructions: number[] = [
    2, // 2 local declaration groups
    6, I32,
    3, F64,

    // outPtr = outOffset
    0x20, 1, 0x21, 8,

    0x02, 0x40, // block $done
    0x03, 0x40, // loop $outer
      // if i >=u count -> br $done (1)
      0x20, 3, 0x20, 0, 0x4f, 0x0d, 1,

      // maxXI = f64[ptrI + 16], minYI = f64[ptrI + 8], maxYI = f64[ptrI + 24]
      0x20, 5, 0x2b, 3, ...encodeU32(16), 0x21, 9,
      0x20, 5, 0x2b, 3, ...encodeU32(8), 0x21, 10,
      0x20, 5, 0x2b, 3, ...encodeU32(24), 0x21, 11,

      // j = i + 1; ptrJ = ptrI + 32
      0x20, 3, 0x41, 1, 0x6a, 0x21, 4,
      0x20, 5, 0x41, ...encodeU32(32), 0x6a, 0x21, 6,

      0x02, 0x40, // block $inner_done
      0x03, 0x40, // loop $inner
        // if j >=u count -> br $inner_done (1)
        0x20, 4, 0x20, 0, 0x4f, 0x0d, 1,

        // X-sweep early pruning: if f64[ptrJ + 0] (minXJ) > maxXI -> br $inner_done (1)
        0x20, 6, 0x2b, 3, ...encodeU32(0),
        0x20, 9,
        0x64, // f64.gt
        0x0d, 1,

        // Y-overlap check: (f64[ptrJ + 24] >= minYI) && (f64[ptrJ + 8] <= maxYI)
        0x20, 6, 0x2b, 3, ...encodeU32(24),
        0x20, 10,
        0x66, // f64.ge
        0x20, 6, 0x2b, 3, ...encodeU32(8),
        0x20, 11,
        0x65, // f64.le
        0x71, // i32.and
        0x04, 0x40, // if
          // overflow check: if pairs >=u maxPairs -> return -1
          0x20, 7, 0x20, 2, 0x4f,
          0x04, 0x40,
            0x41, 0x7f, // i32.const -1 (signed LEB128)
            0x0f,       // return
          0x0b,
          // i32.store(outPtr + 0, i); i32.store(outPtr + 4, j)
          0x20, 8, 0x20, 3, 0x36, 2, 0,
          0x20, 8, 0x20, 4, 0x36, 2, 4,
          // outPtr += 8; pairs += 1
          0x20, 8, 0x41, 8, 0x6a, 0x21, 8,
          0x20, 7, 0x41, 1, 0x6a, 0x21, 7,
        0x0b, // end if

        // j += 1; ptrJ += 32; br $inner (0)
        0x20, 4, 0x41, 1, 0x6a, 0x21, 4,
        0x20, 6, 0x41, ...encodeU32(32), 0x6a, 0x21, 6,
        0x0c, 0,
      0x0b, // end loop $inner
      0x0b, // end block $inner_done

      // i += 1; ptrI += 32; br $outer (0)
      0x20, 3, 0x41, 1, 0x6a, 0x21, 3,
      0x20, 5, 0x41, ...encodeU32(32), 0x6a, 0x21, 5,
      0x0c, 0,
    0x0b, // end loop $outer
    0x0b, // end block $done

    0x20, 7, // return pairs
    0x0b,    // end func
  ];

  const codeSection = encodeSection(10, [
    1,
    ...encodeU32(bodyInstructions.length),
    ...bodyInstructions,
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...typeSection,
    ...importSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
  ]);
}

export const WASM_GEOMETRY_MODULE_BYTES: Uint8Array = buildWasmGeometryModuleBytes();

interface WasmGeometryExports {
  sweep_overlap_pairs(count: number, outOffset: number, maxPairs: number): number;
}

export interface WasmSweepResult {
  readonly pairCount: number;
  /** Direct Int32Array view into linear memory containing `[i0, j0, i1, j1, ...]`. */
  readonly pairsView: Int32Array;
}

class WasmGeometryRuntime {
  private readonly memory: WebAssembly.Memory;
  private readonly exports: WasmGeometryExports;

  constructor(module: WebAssembly.Module) {
    this.memory = new WebAssembly.Memory({ initial: 4 });
    const instance = new WebAssembly.Instance(module, {
      env: { memory: this.memory },
    });
    this.exports = instance.exports as unknown as WasmGeometryExports;
  }

  private ensureMemory(count: number, maxPairs: number): {
    aabbView: Float64Array;
    outOffset: number;
    pairsView: Int32Array;
  } {
    const aabbBytes = count * BYTES_PER_AABB;
    const outOffset = (aabbBytes + 7) & ~7;
    const totalBytes = outOffset + maxPairs * 8;
    const currentBytes = this.memory.buffer.byteLength;
    if (totalBytes > currentBytes) {
      const neededPages = Math.ceil((totalBytes - currentBytes) / WASM_PAGE_BYTES);
      this.memory.grow(Math.max(1, neededPages));
    }
    return {
      aabbView: new Float64Array(this.memory.buffer, 0, count * 4),
      outOffset,
      pairsView: new Int32Array(this.memory.buffer, outOffset, maxPairs * 2),
    };
  }

  sweepOverlapPairs(sortedAabbs: Float64Array, count: number): WasmSweepResult {
    if (count < 2) {
      return { pairCount: 0, pairsView: new Int32Array(0) };
    }
    let maxPairs = Math.max(256, count * 8);
    const maxPossible = (count * (count - 1)) / 2;

    while (true) {
      const { aabbView, outOffset, pairsView } = this.ensureMemory(count, maxPairs);
      aabbView.set(sortedAabbs.subarray(0, count * 4));
      const pairCount = this.exports.sweep_overlap_pairs(count, outOffset, maxPairs);
      if (pairCount >= 0) {
        return { pairCount, pairsView };
      }
      if (maxPairs >= maxPossible) {
        return { pairCount: 0, pairsView: new Int32Array(0) };
      }
      maxPairs = Math.min(maxPossible, maxPairs * 2);
    }
  }
}

let cachedGeometryModule: WebAssembly.Module | null = null;
let cachedGeometryRuntime: WasmGeometryRuntime | null = null;

function getOrCreateGeometryRuntime(): WasmGeometryRuntime | null {
  if (cachedGeometryRuntime) return cachedGeometryRuntime;
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.Module !== 'function') {
    return null;
  }
  try {
    if (!cachedGeometryModule) {
      cachedGeometryModule = new WebAssembly.Module(WASM_GEOMETRY_MODULE_BYTES as BufferSource);
    }
    cachedGeometryRuntime = new WasmGeometryRuntime(cachedGeometryModule);
    return cachedGeometryRuntime;
  } catch {
    return null;
  }
}

export async function warmupWasmGeometryKernelAsync(): Promise<boolean> {
  if (cachedGeometryRuntime) return true;
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.compile !== 'function') {
    return false;
  }
  try {
    if (!cachedGeometryModule) {
      cachedGeometryModule = await WebAssembly.compile(WASM_GEOMETRY_MODULE_BYTES as BufferSource);
    }
    cachedGeometryRuntime = new WasmGeometryRuntime(cachedGeometryModule);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the compiled WebAssembly sweep-line AABB overlap kernel on `count`
 * X-sorted bounding boxes (`[minX, minY, maxX, maxY]`). Returns `null` if
 * WebAssembly is unavailable so callers can seamlessly fall back to TypeScript.
 */
export function findOverlappingSegmentPairsWasm(
  sortedAabbs: Float64Array,
  count: number,
): WasmSweepResult | null {
  const runtime = getOrCreateGeometryRuntime();
  if (!runtime) return null;
  return runtime.sweepOverlapPairs(sortedAabbs, count);
}

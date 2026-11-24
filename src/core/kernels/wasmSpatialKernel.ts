import type {
  SpatialBoundsEntry,
  SpatialIndexHandle,
  SpatialIndexKernel,
  SpatialQueryRect,
} from './types';
import { FlatGridSpatialIndex } from './spatialIndex';

const WASM_PAGE_BYTES = 65536;
const BYTES_PER_BOUNDS_ENTRY = 32; // 4 * float64 (minX, minY, maxX, maxY)

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

/**
 * Builds a compact (~190-byte), spec-compliant WebAssembly 1.0 binary module
 * implementing a zero-allocation linear-memory AABB spatial query kernel:
 *
 *   query_rect(count: i32, outOffset: i32, minX: f64, minY: f64, maxX: f64, maxY: f64) -> i32
 *
 * Memory layout (shared via imported `env.memory`):
 *   - [0 .. count * 32): Float64Array interleaved [minX, minY, maxX, maxY]
 *   - [outOffset .. outOffset + count * 4): Int32Array matched node indices
 *
 * Runs at native JIT speed inside V8 Liftoff/TurboFan with zero 8 MB WASM bloat.
 */
function buildWasmSpatialModuleBytes(): Uint8Array {
  const I32 = 0x7f;
  const F64 = 0x7c;

  // Type section: 1 func type (i32, i32, f64, f64, f64, f64) -> (i32)
  const typeSection = encodeSection(1, [
    1,
    0x60,
    6, I32, I32, F64, F64, F64, F64,
    1, I32,
  ]);

  // Import section: env.memory (limits min=1 page, no max)
  const importSection = encodeSection(2, [
    1,
    ...encodeString('env'),
    ...encodeString('memory'),
    0x02, // memory import
    0x00, // flags: min only
    ...encodeU32(1),
  ]);

  // Function section: 1 function of type 0
  const functionSection = encodeSection(3, [1, 0]);

  // Export section: export "query_rect" -> func 0
  const exportSection = encodeSection(7, [
    1,
    ...encodeString('query_rect'),
    0x00, // func export
    0,
  ]);

  // Code section: function 0 body
  // Params: 0=count, 1=outOffset, 2=minX, 3=minY, 4=maxX, 5=maxY
  // Locals: 6=i (i32), 7=ptr (i32), 8=hits (i32)
  const bodyInstructions: number[] = [
    1, // 1 local declaration group
    3, I32, // 3 i32 locals (i, ptr, hits)

    0x02, 0x40, // block $done
    0x03, 0x40, // loop $loop
    // if i >=u count -> br $done (depth 1)
    0x20, 6, // local.get $i
    0x20, 0, // local.get $count
    0x4f,    // i32.ge_u
    0x0d, 1, // br_if 1

    // (f64.load align=3 offset=16 (ptr)) >= minX
    0x20, 7, 0x2b, 3, ...encodeU32(16),
    0x20, 2,
    0x66, // f64.ge
    // (f64.load align=3 offset=0 (ptr)) <= maxX
    0x20, 7, 0x2b, 3, ...encodeU32(0),
    0x20, 4,
    0x65, // f64.le
    0x71, // i32.and

    // (f64.load align=3 offset=24 (ptr)) >= minY
    0x20, 7, 0x2b, 3, ...encodeU32(24),
    0x20, 3,
    0x66, // f64.ge
    // (f64.load align=3 offset=8 (ptr)) <= maxY
    0x20, 7, 0x2b, 3, ...encodeU32(8),
    0x20, 5,
    0x65, // f64.le
    0x71, // i32.and
    0x71, // i32.and

    0x04, 0x40, // if
    // i32.store align=2 offset=0 (outOffset + (hits << 2), i)
    0x20, 1, // local.get $outOffset
    0x20, 8, // local.get $hits
    0x41, 2, // i32.const 2
    0x74,    // i32.shl
    0x6a,    // i32.add
    0x20, 6, // local.get $i
    0x36, 2, 0, // i32.store align=2 offset=0
    // hits = hits + 1
    0x20, 8, 0x41, 1, 0x6a, 0x21, 8,
    0x0b, // end if

    // i = i + 1
    0x20, 6, 0x41, 1, 0x6a, 0x21, 6,
    // ptr = ptr + 32
    0x20, 7, 0x41, ...encodeU32(32), 0x6a, 0x21, 7,
    0x0c, 0, // br $loop
    0x0b, // end loop
    0x0b, // end block

    0x20, 8, // local.get $hits
    0x0b, // end func
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

export const WASM_SPATIAL_MODULE_BYTES: Uint8Array = buildWasmSpatialModuleBytes();

interface WasmSpatialExports {
  query_rect(
    count: number,
    outOffset: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): number;
}

class WasmSpatialRuntime {
  private readonly memory: WebAssembly.Memory;
  private readonly exports: WasmSpatialExports;

  constructor(module: WebAssembly.Module) {
    this.memory = new WebAssembly.Memory({ initial: 4 });
    const instance = new WebAssembly.Instance(module, {
      env: { memory: this.memory },
    });
    this.exports = instance.exports as unknown as WasmSpatialExports;
  }

  ensureCapacity(entryCount: number): {
    boundsView: Float64Array;
    outOffset: number;
    outView: Int32Array;
  } {
    const boundsBytes = entryCount * BYTES_PER_BOUNDS_ENTRY;
    // Align output Int32Array offset to 8 bytes
    const outOffset = (boundsBytes + 7) & ~7;
    const totalBytes = outOffset + entryCount * 4;
    const currentBytes = this.memory.buffer.byteLength;
    if (totalBytes > currentBytes) {
      const neededPages = Math.ceil((totalBytes - currentBytes) / WASM_PAGE_BYTES);
      this.memory.grow(Math.max(1, neededPages));
    }
    return {
      boundsView: new Float64Array(this.memory.buffer, 0, entryCount * 4),
      outOffset,
      outView: new Int32Array(this.memory.buffer, outOffset, entryCount),
    };
  }

  queryRect(
    boundsBuffer: Float64Array,
    count: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): Int32Array {
    if (count === 0) return new Int32Array(0);
    const { boundsView, outOffset, outView } = this.ensureCapacity(count);
    boundsView.set(boundsBuffer);
    const hitCount = this.exports.query_rect(count, outOffset, minX, minY, maxX, maxY);
    return outView.slice(0, hitCount);
  }
}

/**
 * Hybrid WASM + Grid-Hash Spatial Index.
 * Uses the compiled WebAssembly linear-memory AABB kernel for broad viewport sweeps
 * and large scenes (zero JS GC pressure), while delegating tight point/localized
 * cell lookups to the O(1) FlatGridSpatialIndex hash buckets.
 */
export class WasmAcceleratedSpatialIndex implements SpatialIndexHandle {
  readonly count: number;
  private readonly ids: string[];
  private readonly zIndices: Int32Array;
  private readonly boundsBuffer: Float64Array;
  private readonly gridIndex: FlatGridSpatialIndex;
  private readonly runtime: WasmSpatialRuntime;

  constructor(
    entries: readonly SpatialBoundsEntry[],
    runtime: WasmSpatialRuntime,
    cellSize = 256,
  ) {
    this.count = entries.length;
    this.runtime = runtime;
    this.ids = new Array<string>(entries.length);
    this.zIndices = new Int32Array(entries.length);
    this.boundsBuffer = new Float64Array(entries.length * 4);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const offset = i * 4;
      this.ids[i] = entry.id;
      this.zIndices[i] = entry.zIndex;
      this.boundsBuffer[offset] = Math.min(entry.minX, entry.maxX);
      this.boundsBuffer[offset + 1] = Math.min(entry.minY, entry.maxY);
      this.boundsBuffer[offset + 2] = Math.max(entry.minX, entry.maxX);
      this.boundsBuffer[offset + 3] = Math.max(entry.minY, entry.maxY);
    }
    this.gridIndex = new FlatGridSpatialIndex(entries, cellSize);
  }

  getBounds(id: string): SpatialBoundsEntry | undefined {
    return this.gridIndex.getBounds(id);
  }

  queryRect(rect: SpatialQueryRect): string[] {
    if (this.count === 0) return [];
    const minX = Math.min(rect.minX, rect.maxX);
    const minY = Math.min(rect.minY, rect.maxY);
    const maxX = Math.max(rect.minX, rect.maxX);
    const maxY = Math.max(rect.minY, rect.maxY);

    // For broad viewport queries or dense scenes, execute the compiled WASM linear-memory AABB scan
    const queryWidth = maxX - minX;
    const queryHeight = maxY - minY;
    const useWasmScan = this.count >= 64 && (queryWidth * queryHeight >= 65536 || this.count <= 20000);
    if (!useWasmScan) {
      return this.gridIndex.queryRect(rect);
    }

    const hitIndices = this.runtime.queryRect(this.boundsBuffer, this.count, minX, minY, maxX, maxY);
    const matched = Array.from(hitIndices);
    matched.sort((a, b) => this.zIndices[a] - this.zIndices[b]);
    const result = new Array<string>(matched.length);
    for (let i = 0; i < matched.length; i += 1) {
      result[i] = this.ids[matched[i]];
    }
    return result;
  }

  queryPoint(x: number, y: number, tolerance = 0): string[] {
    return this.gridIndex.queryPoint(x, y, tolerance);
  }

  querySnapCandidates(
    subjectRect: SpatialQueryRect,
    margin: number,
    excludeIds?: ReadonlySet<string>,
  ): string[] {
    return this.gridIndex.querySnapCandidates(subjectRect, margin, excludeIds);
  }
}

let cachedWasmModule: WebAssembly.Module | null = null;
let cachedWasmKernel: SpatialIndexKernel | null = null;

export function isWebAssemblySupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.Module === 'function';
}

/**
 * Synchronously compiles and instantiates the embedded ~190-byte WebAssembly
 * spatial AABB kernel (safe in browsers and Node 22+; returns null if blocked by CSP).
 */
export function createWasmSpatialIndexKernel(): SpatialIndexKernel | null {
  if (cachedWasmKernel) return cachedWasmKernel;
  if (!isWebAssemblySupported()) return null;
  try {
    if (!cachedWasmModule) {
      cachedWasmModule = new WebAssembly.Module(WASM_SPATIAL_MODULE_BYTES as BufferSource);
    }
    const runtime = new WasmSpatialRuntime(cachedWasmModule);
    cachedWasmKernel = {
      backend: 'wasm',
      buildIndex(entries, cellSize) {
        return new WasmAcceleratedSpatialIndex(entries, runtime, cellSize);
      },
    };
    return cachedWasmKernel;
  } catch {
    return null;
  }
}

/**
 * Asynchronous variant using `WebAssembly.compile` (preferred for main-thread startup).
 */
export async function createWasmSpatialIndexKernelAsync(): Promise<SpatialIndexKernel | null> {
  if (cachedWasmKernel) return cachedWasmKernel;
  if (!isWebAssemblySupported()) return null;
  try {
    if (!cachedWasmModule) {
      cachedWasmModule = await WebAssembly.compile(WASM_SPATIAL_MODULE_BYTES as BufferSource);
    }
    const runtime = new WasmSpatialRuntime(cachedWasmModule);
    cachedWasmKernel = {
      backend: 'wasm',
      buildIndex(entries, cellSize) {
        return new WasmAcceleratedSpatialIndex(entries, runtime, cellSize);
      },
    };
    return cachedWasmKernel;
  } catch {
    return null;
  }
}

import type {
  SpatialBoundsEntry,
  SpatialIndexHandle,
  SpatialIndexKernel,
  SpatialQueryRect,
} from './types';

const DEFAULT_CELL_SIZE = 256;

function clampCell(value: number, cellSize: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / cellSize);
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

/**
 * Pure TypeScript grid-hash spatial index storing bounds in a flat Float64Array
 * so hot-path AABB tests avoid per-node object allocations and mirror the exact
 * flat-memory layout expected by a future Rust/WASM spatial kernel.
 */
export class FlatGridSpatialIndex implements SpatialIndexHandle {
  readonly count: number;
  private readonly cellSize: number;
  private readonly ids: string[];
  private readonly zIndices: Int32Array;
  /** Interleaved [minX, minY, maxX, maxY] per entry index. */
  private readonly boundsBuffer: Float64Array;
  private readonly indexById = new Map<string, number>();
  private readonly cells = new Map<string, number[]>();
  /** Entries spanning too many cells (> 64) are checked directly to keep build O(N). */
  private readonly oversizedIndices: number[] = [];

  constructor(entries: readonly SpatialBoundsEntry[], cellSize = DEFAULT_CELL_SIZE) {
    this.count = entries.length;
    this.cellSize = Math.max(32, Number.isFinite(cellSize) ? cellSize : DEFAULT_CELL_SIZE);
    this.ids = new Array<string>(entries.length);
    this.zIndices = new Int32Array(entries.length);
    this.boundsBuffer = new Float64Array(entries.length * 4);

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const minX = Math.min(entry.minX, entry.maxX);
      const minY = Math.min(entry.minY, entry.maxY);
      const maxX = Math.max(entry.minX, entry.maxX);
      const maxY = Math.max(entry.minY, entry.maxY);
      const offset = i * 4;

      this.ids[i] = entry.id;
      this.zIndices[i] = entry.zIndex;
      this.boundsBuffer[offset] = minX;
      this.boundsBuffer[offset + 1] = minY;
      this.boundsBuffer[offset + 2] = maxX;
      this.boundsBuffer[offset + 3] = maxY;
      this.indexById.set(entry.id, i);

      const minCx = clampCell(minX, this.cellSize);
      const maxCx = clampCell(maxX, this.cellSize);
      const minCy = clampCell(minY, this.cellSize);
      const maxCy = clampCell(maxY, this.cellSize);
      const span = (maxCx - minCx + 1) * (maxCy - minCy + 1);

      if (span > 64) {
        this.oversizedIndices.push(i);
        continue;
      }

      for (let cy = minCy; cy <= maxCy; cy += 1) {
        for (let cx = minCx; cx <= maxCx; cx += 1) {
          const key = cellKey(cx, cy);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  getBounds(id: string): SpatialBoundsEntry | undefined {
    const idx = this.indexById.get(id);
    if (idx === undefined) return undefined;
    const offset = idx * 4;
    return {
      id: this.ids[idx],
      minX: this.boundsBuffer[offset],
      minY: this.boundsBuffer[offset + 1],
      maxX: this.boundsBuffer[offset + 2],
      maxY: this.boundsBuffer[offset + 3],
      zIndex: this.zIndices[idx],
    };
  }

  queryRect(rect: SpatialQueryRect): string[] {
    if (this.count === 0) return [];
    const minX = Math.min(rect.minX, rect.maxX);
    const minY = Math.min(rect.minY, rect.maxY);
    const maxX = Math.max(rect.minX, rect.maxX);
    const maxY = Math.max(rect.minY, rect.maxY);

    const minCx = clampCell(minX, this.cellSize);
    const maxCx = clampCell(maxX, this.cellSize);
    const minCy = clampCell(minY, this.cellSize);
    const maxCy = clampCell(maxY, this.cellSize);
    const cellSpan = (maxCx - minCx + 1) * (maxCy - minCy + 1);

    const matched: number[] = [];
    const buf = this.boundsBuffer;

    // If the query rect covers a very large number of cells, a linear pass over
    // the flat Float64Array is faster and avoids map lookups.
    if (cellSpan > 256 || cellSpan > this.count) {
      for (let i = 0; i < this.count; i += 1) {
        const offset = i * 4;
        if (
          buf[offset + 2] >= minX &&
          buf[offset] <= maxX &&
          buf[offset + 3] >= minY &&
          buf[offset + 1] <= maxY
        ) {
          matched.push(i);
        }
      }
      matched.sort((a, b) => this.zIndices[a] - this.zIndices[b]);
      return matched.map((idx) => this.ids[idx]);
    }

    const visited = new Uint8Array(this.count);

    for (let i = 0; i < this.oversizedIndices.length; i += 1) {
      const idx = this.oversizedIndices[i];
      const offset = idx * 4;
      if (
        buf[offset + 2] >= minX &&
        buf[offset] <= maxX &&
        buf[offset + 3] >= minY &&
        buf[offset + 1] <= maxY
      ) {
        visited[idx] = 1;
        matched.push(idx);
      }
    }

    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b += 1) {
          const idx = bucket[b];
          if (visited[idx]) continue;
          visited[idx] = 1;
          const offset = idx * 4;
          if (
            buf[offset + 2] >= minX &&
            buf[offset] <= maxX &&
            buf[offset + 3] >= minY &&
            buf[offset + 1] <= maxY
          ) {
            matched.push(idx);
          }
        }
      }
    }

    matched.sort((a, b) => this.zIndices[a] - this.zIndices[b]);
    return matched.map((idx) => this.ids[idx]);
  }

  queryPoint(x: number, y: number, tolerance = 0): string[] {
    const pad = Math.max(0, tolerance);
    return this.queryRect({
      minX: x - pad,
      minY: y - pad,
      maxX: x + pad,
      maxY: y + pad,
    }).reverse();
  }

  querySnapCandidates(
    subjectRect: SpatialQueryRect,
    margin: number,
    excludeIds?: ReadonlySet<string>,
  ): string[] {
    const pad = Math.max(0, margin);
    const hits = this.queryRect({
      minX: subjectRect.minX - pad,
      minY: subjectRect.minY - pad,
      maxX: subjectRect.maxX + pad,
      maxY: subjectRect.maxY + pad,
    });
    if (!excludeIds || excludeIds.size === 0) return hits;
    return hits.filter((id) => !excludeIds.has(id));
  }
}

export const defaultSpatialIndexKernel: SpatialIndexKernel = {
  backend: 'ts-default',
  buildIndex(entries, cellSize) {
    return new FlatGridSpatialIndex(entries, cellSize);
  },
};

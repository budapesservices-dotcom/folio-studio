/**
 * Pure GPU Scene Packer & Dirty-Tile Signature Engine.
 *
 * Zero DOM dependencies — runs identically in browser main thread, Web Workers,
 * Node unit tests, and 10,000-node benchmark suites.
 */

import type { DesignNode, EllipseNode, FrameNode, RectNode } from '../../../core/document/types';
import { getVisibleEffects, getVisibleFillPaints } from '../../../core/document/styling';
import {
  DEFAULT_TILE_SIZE,
  GPU_INSTANCE_STRIDE_FLOATS,
  type PackedGpuScene,
  type TileCoord,
  type ViewportRect,
} from './types';

export type RgbaTuple = readonly [number, number, number, number];

const COLOR_CACHE_MAX = 512;
const colorCache = new Map<string, RgbaTuple>();
const TRANSPARENT_RGBA: RgbaTuple = [0, 0, 0, 0];

const NAMED_COLORS: Record<string, RgbaTuple> = {
  transparent: [0, 0, 0, 0],
  none: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 0.502, 0, 1],
  blue: [0, 0, 1, 1],
  gray: [0.502, 0.502, 0.502, 1],
  grey: [0.502, 0.502, 0.502, 1],
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Parses hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `rgba()`,
 * and common named CSS colors into normalized `[r, g, b, a]` in `[0, 1]`.
 */
export function parseCssColorToRgba(rawColor: string | undefined | null, opacity = 1): RgbaTuple {
  const alphaMult = clamp01(opacity);
  if (!rawColor || alphaMult <= 0) return TRANSPARENT_RGBA;

  const normalized = rawColor.trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'transparent') {
    return TRANSPARENT_RGBA;
  }

  let base = colorCache.get(normalized);
  if (!base) {
    base = parseBaseCssColor(normalized);
    if (colorCache.size >= COLOR_CACHE_MAX) {
      colorCache.clear();
    }
    colorCache.set(normalized, base);
  }

  if (alphaMult >= 0.9999) return base;
  return [base[0], base[1], base[2], clamp01(base[3] * alphaMult)];
}

function parseBaseCssColor(color: string): RgbaTuple {
  const named = NAMED_COLORS[color];
  if (named) return named;

  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
        return [r / 255, g / 255, b / 255, a / 255];
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
        return [r / 255, g / 255, b / 255, a / 255];
      }
    }
    return TRANSPARENT_RGBA;
  }

  if (color.startsWith('rgb')) {
    const match = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/.exec(color);
    if (match) {
      const r = clamp01(parseFloat(match[1]) / 255);
      const g = clamp01(parseFloat(match[2]) / 255);
      const b = clamp01(parseFloat(match[3]) / 255);
      let a = 1;
      if (match[4] !== undefined) {
        a = match[4].endsWith('%')
          ? clamp01(parseFloat(match[4]) / 100)
          : clamp01(parseFloat(match[4]));
      }
      return [r, g, b, a];
    }
  }

  return TRANSPARENT_RGBA;
}

type FastPrimitiveNode = RectNode | FrameNode | EllipseNode;

/**
 * Determines whether a DesignNode can be rendered on the ultra-fast GPU SDF
 * instanced pass (1 draw call for 10,000+ primitives).
 */
export function isGpuInstancedPrimitive(
  node: DesignNode,
  clipMaskMap?: ReadonlyMap<string, string[]>,
  frameClipMap?: ReadonlyMap<string, string[]>,
): node is FastPrimitiveNode {
  if (node.type !== 'rect' && node.type !== 'frame' && node.type !== 'ellipse') {
    return false;
  }
  if (node.type === 'frame' && node.isSection) {
    return false;
  }
  if (node.blendMode && node.blendMode !== 'normal') {
    return false;
  }
  if (clipMaskMap && (clipMaskMap.get(node.id)?.length ?? 0) > 0) {
    return false;
  }
  if (frameClipMap && (frameClipMap.get(node.id)?.length ?? 0) > 0) {
    return false;
  }
  if (node.effects && node.effects.length > 0 && getVisibleEffects(node).length > 0) {
    return false;
  }
  if (node.style.fills && node.style.fills.length > 0) {
    const visibleFills = getVisibleFillPaints(node);
    if (visibleFills.length > 1) return false;
    if (visibleFills.length === 1 && visibleFills[0].type !== 'solid') return false;
  }
  return true;
}

function resolveFastPrimitiveFill(node: FastPrimitiveNode): RgbaTuple {
  const opacity = node.opacity ?? 1;
  if (node.style.fills && node.style.fills.length > 0) {
    const visibleFills = getVisibleFillPaints(node);
    if (visibleFills.length === 0) return TRANSPARENT_RGBA;
    const paint = visibleFills[0];
    if (paint.type === 'solid') {
      return parseCssColorToRgba(paint.color, opacity * (paint.opacity ?? 1));
    }
    return TRANSPARENT_RGBA;
  }
  return parseCssColorToRgba(node.style.fill, opacity);
}

function getNodeExpandedBounds(node: DesignNode): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const pad = node.rotation !== 0 ? Math.max(node.width, node.height) * 0.45 : 8;
  return {
    minX: node.x - pad,
    minY: node.y - pad,
    maxX: node.x + node.width + pad,
    maxY: node.y + node.height + pad,
  };
}

function intersectsViewport(node: DesignNode, viewport: ViewportRect, margin = 96): boolean {
  const b = getNodeExpandedBounds(node);
  return !(
    b.maxX < viewport.x - margin ||
    b.minX > viewport.x + viewport.width + margin ||
    b.maxY < viewport.y - margin ||
    b.minY > viewport.y + viewport.height + margin
  );
}

const RICH_OVERLAP_CELL = 256;

function encodeCellKey(cx: number, cy: number): number {
  return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
}

function markRichOccupancy(cells: Set<number>, node: DesignNode): void {
  const b = getNodeExpandedBounds(node);
  const x0 = Math.floor(b.minX / RICH_OVERLAP_CELL);
  const y0 = Math.floor(b.minY / RICH_OVERLAP_CELL);
  const x1 = Math.floor(b.maxX / RICH_OVERLAP_CELL);
  const y1 = Math.floor(b.maxY / RICH_OVERLAP_CELL);
  // Guard pathological huge boxes from inserting thousands of keys
  const spanX = Math.min(x1 - x0, 64);
  const spanY = Math.min(y1 - y0, 64);
  for (let cy = y0; cy <= y0 + spanY; cy += 1) {
    for (let cx = x0; cx <= x0 + spanX; cx += 1) {
      cells.add(encodeCellKey(cx, cy));
    }
  }
}

function overlapsRichOccupancy(cells: Set<number>, node: DesignNode): boolean {
  if (cells.size === 0) return false;
  const b = getNodeExpandedBounds(node);
  const x0 = Math.floor(b.minX / RICH_OVERLAP_CELL);
  const y0 = Math.floor(b.minY / RICH_OVERLAP_CELL);
  const x1 = Math.floor(b.maxX / RICH_OVERLAP_CELL);
  const y1 = Math.floor(b.maxY / RICH_OVERLAP_CELL);
  const spanX = Math.min(x1 - x0, 64);
  const spanY = Math.min(y1 - y0, 64);
  for (let cy = y0; cy <= y0 + spanY; cy += 1) {
    for (let cx = x0; cx <= x0 + spanX; cx += 1) {
      if (cells.has(encodeCellKey(cx, cy))) return true;
    }
  }
  return false;
}

export interface PackSceneOptions {
  readonly viewportRect?: ViewportRect | null;
  readonly hiddenNodeIds?: ReadonlySet<string> | null;
  readonly inlineEditNodeId?: string | null;
  readonly clipMaskMap?: ReadonlyMap<string, string[]>;
  readonly frameClipMap?: ReadonlyMap<string, string[]>;
  /** Optional reusable scratch Float32Array to avoid per-frame GC allocations. */
  readonly scratchBuffer?: Float32Array;
}

/**
 * Packs visible render-ordered nodes into:
 * 1. `instanceData` (`Float32Array`, 16 floats per instance) for single-draw-call WebGPU/WebGL2 SDF rendering
 * 2. `richNodes` for the 512x512 LRU Tile Cache pass
 *
 * Preserves exact painter's z-order: if a fast primitive sits above an earlier rich node
 * that occupies the same spatial cell, it is promoted to `richNodes` so it draws cleanly on top.
 */
export function packSceneToGpuBatches(
  nodes: readonly DesignNode[],
  options: PackSceneOptions = {},
): PackedGpuScene {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const {
    viewportRect,
    hiddenNodeIds,
    inlineEditNodeId,
    clipMaskMap,
    frameClipMap,
    scratchBuffer,
  } = options;

  const maxFloats = nodes.length * GPU_INSTANCE_STRIDE_FLOATS;
  const buffer =
    scratchBuffer && scratchBuffer.length >= maxFloats
      ? scratchBuffer
      : new Float32Array(Math.max(GPU_INSTANCE_STRIDE_FLOATS, maxFloats));

  const richNodes: DesignNode[] = [];
  const richCells = new Set<number>();

  let instanceCount = 0;
  let totalEvaluatedNodes = 0;
  let culledNodes = 0;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node.visible || node.type === 'group') continue;
    if (inlineEditNodeId && node.id === inlineEditNodeId) continue;
    if (hiddenNodeIds && hiddenNodeIds.has(node.id)) continue;

    if (viewportRect && !intersectsViewport(node, viewportRect)) {
      culledNodes += 1;
      continue;
    }

    totalEvaluatedNodes += 1;

    if (
      isGpuInstancedPrimitive(node, clipMaskMap, frameClipMap) &&
      !overlapsRichOccupancy(richCells, node)
    ) {
      const fill = resolveFastPrimitiveFill(node);
      const strokeW = node.style.strokeWidth > 0 ? node.style.strokeWidth : 0;
      const stroke = strokeW > 0
        ? parseCssColorToRgba(node.style.stroke, node.opacity ?? 1)
        : TRANSPARENT_RGBA;

      const base = instanceCount * GPU_INSTANCE_STRIDE_FLOATS;
      buffer[base] = node.x;
      buffer[base + 1] = node.y;
      buffer[base + 2] = Math.max(0, node.width);
      buffer[base + 3] = Math.max(0, node.height);

      buffer[base + 4] = fill[0];
      buffer[base + 5] = fill[1];
      buffer[base + 6] = fill[2];
      buffer[base + 7] = fill[3];

      const maxR = Math.min(node.width, node.height) * 0.5;
      buffer[base + 8] = node.type === 'ellipse'
        ? 0
        : Math.max(0, Math.min(maxR, node.style.radius ?? 0));
      buffer[base + 9] = (node.rotation || 0) * (Math.PI / 180);

      buffer[base + 10] = stroke[0];
      buffer[base + 11] = stroke[1];
      buffer[base + 12] = stroke[2];
      buffer[base + 13] = stroke[3];
      buffer[base + 14] = strokeW;
      buffer[base + 15] = node.type === 'ellipse' ? 1 : 0;

      instanceCount += 1;
    } else {
      richNodes.push(node);
      markRichOccupancy(richCells, node);
    }
  }

  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    instanceData: buffer.subarray(0, instanceCount * GPU_INSTANCE_STRIDE_FLOATS),
    instanceCount,
    richNodes,
    totalEvaluatedNodes,
    culledNodes,
    packMs: Math.max(0, end - start),
  };
}

/**
 * Computes the visible 512x512 tile coordinates intersecting `viewportRect` clamped
 * to the document bounds `[0..docWidth, 0..docHeight]`.
 */
export function computeVisibleTileGrid(
  viewportRect: ViewportRect,
  docWidth: number,
  docHeight: number,
  tileSize = DEFAULT_TILE_SIZE,
): TileCoord[] {
  const safeTileSize = Math.max(64, Math.floor(tileSize));
  const minX = Math.max(0, viewportRect.x);
  const minY = Math.max(0, viewportRect.y);
  const maxX = Math.min(docWidth, viewportRect.x + viewportRect.width);
  const maxY = Math.min(docHeight, viewportRect.y + viewportRect.height);

  if (maxX <= minX || maxY <= minY) return [];

  const colStart = Math.floor(minX / safeTileSize);
  const rowStart = Math.floor(minY / safeTileSize);
  const colEnd = Math.floor((maxX - 0.001) / safeTileSize);
  const rowEnd = Math.floor((maxY - 0.001) / safeTileSize);

  const tiles: TileCoord[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const x = col * safeTileSize;
      const y = row * safeTileSize;
      const width = Math.min(safeTileSize, docWidth - x);
      const height = Math.min(safeTileSize, docHeight - y);
      if (width <= 0 || height <= 0) continue;
      tiles.push({
        col,
        row,
        x,
        y,
        width,
        height,
        key: `${col}:${row}:${width}x${height}`,
      });
    }
  }
  return tiles;
}

/**
 * Computes a fast FNV-1a 32-bit dirty-tile signature over the rich nodes intersecting a tile
 * plus the quantized DPR/zoom bucket so unchanged tiles stay 100% cached across pan/zoom frames.
 */
export function computeTileSignature(
  nodesInTile: readonly DesignNode[],
  tile: TileCoord,
  scaleBucket: number,
): string {
  let hash = 2166136261 >>> 0;
  const mixInt = (n: number) => {
    hash ^= n | 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  };
  const mixStr = (s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };

  mixInt(tile.col);
  mixInt(tile.row);
  mixInt(Math.round(scaleBucket * 100));
  mixInt(nodesInTile.length);

  for (let i = 0; i < nodesInTile.length; i += 1) {
    const node = nodesInTile[i];
    mixStr(node.id);
    mixStr(node.type);
    mixInt(Math.round(node.x * 10));
    mixInt(Math.round(node.y * 10));
    mixInt(Math.round(node.width * 10));
    mixInt(Math.round(node.height * 10));
    mixInt(Math.round((node.rotation || 0) * 10));
    mixInt(Math.round((node.opacity ?? 1) * 1000));
    if (node.blendMode) mixStr(node.blendMode);

    if (node.type === 'text') {
      mixStr(node.text);
      mixStr(node.style.fill);
      mixInt(Math.round(node.style.fontSize * 10));
      mixInt(node.style.fontWeight);
      mixStr(node.style.fontFamily);
      if (node.style.textAlign) mixStr(node.style.textAlign);
      if (node.style.textTransform) mixStr(node.style.textTransform);
      if (node.style.textDecoration) mixStr(node.style.textDecoration);
    } else if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
      mixStr(node.style.fill);
      mixStr(node.style.stroke);
      mixInt(Math.round(node.style.strokeWidth * 10));
      mixInt(Math.round((node.style.radius ?? 0) * 10));
      if (node.style.fills) {
        mixInt(node.style.fills.length);
        for (const p of node.style.fills) {
          mixStr(p.type);
          if (p.type === 'solid') mixStr(p.color);
          else mixInt(p.stops.length);
        }
      }
    } else if (node.type === 'path') {
      mixStr(node.style.fill);
      mixStr(node.style.stroke);
      mixInt(Math.round(node.style.strokeWidth * 10));
      mixInt(node.points.length);
      mixInt(node.closed ? 1 : 0);
      mixInt(node.subpaths?.length ?? 0);
      if (node.points.length > 0) {
        mixInt(Math.round(node.points[0].x * 10));
        mixInt(Math.round(node.points[0].y * 10));
      }
    } else if (node.type === 'image') {
      mixStr(node.assetId);
      mixStr(node.style.fit);
      mixInt(Math.round((node.style.radius ?? 0) * 10));
    } else if (node.type === 'component-instance') {
      mixStr(node.componentId);
      mixStr(JSON.stringify(node.overrides));
      if (node.variantSelection) mixStr(JSON.stringify(node.variantSelection));
      if (node.slotAssignments) mixStr(JSON.stringify(node.slotAssignments));
    }

    if (node.effects && node.effects.length > 0) {
      mixInt(node.effects.length);
      for (const eff of node.effects) {
        mixStr(eff.type);
        if (eff.visible === false) mixInt(0);
        else if (eff.type === 'drop-shadow' || eff.type === 'inner-shadow') {
          mixInt(Math.round(eff.blur * 10));
          mixStr(eff.color);
        } else {
          mixInt(Math.round(eff.radius * 10));
        }
      }
    }
  }

  return `${tile.key}@${Math.round(scaleBucket * 100)}#${hash.toString(16)}`;
}

/**
 * Filters `richNodes` to those intersecting a given tile (with shadow/blur bleed padding).
 */
export function filterNodesForTile(
  richNodes: readonly DesignNode[],
  tile: TileCoord,
  pad = 48,
): DesignNode[] {
  const minX = tile.x - pad;
  const minY = tile.y - pad;
  const maxX = tile.x + tile.width + pad;
  const maxY = tile.y + tile.height + pad;
  const out: DesignNode[] = [];
  for (let i = 0; i < richNodes.length; i += 1) {
    const node = richNodes[i];
    const b = getNodeExpandedBounds(node);
    if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY) {
      out.push(node);
    }
  }
  return out;
}

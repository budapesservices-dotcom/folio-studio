/**
 * 512x512 LRU Tile Cache & Faithful Canvas2D Rich-Artwork Rasterizer.
 *
 * Renders rich nodes (typography with Folio auto text-wrapping, cubic Bezier paths,
 * multi-fill linear/radial gradients, drop shadows, layer blur, blend modes, images,
 * and nested component instances) into cached 512x512 offscreen tiles so panning
 * and zooming across large artboards never re-rasterizes unchanged regions.
 */

import type {
  ComponentInstanceNode,
  DesignNode,
  EllipseNode,
  FillPaint,
  FrameNode,
  ImageNode,
  PathNode,
  RectNode,
  TextAlign,
  TextNode,
  VectorAnchorPoint,
} from '../../../core/document/types';
import { resolveComponentInstanceNodes } from '../../../core/document/components';
import {
  buildCssFilterString,
  getVisibleEffects,
  getVisibleFillPaints,
  sanitizeStyleColor,
} from '../../../core/document/styling';
import { wrapTextLines } from '../../../core/document/typography';
import { resolveAssetDisplayUrl } from '../../../core/persistence/assetStore';
import { computeAutoLayoutNodes } from '../../layout/autoLayout';
import type { RichNodeRenderContext, TileCacheStats, TileCoord } from './types';

export interface TileSurface {
  width: number;
  height: number;
  getContext2D(): CanvasRenderingContext2D | null;
  readonly drawable: CanvasImageSource | null;
}

export type TileSurfaceFactory = (pixelWidth: number, pixelHeight: number) => TileSurface;

function createDefaultBrowserTileSurface(pixelWidth: number, pixelHeight: number): TileSurface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pixelWidth));
  canvas.height = Math.max(1, Math.round(pixelHeight));
  let cachedCtx: CanvasRenderingContext2D | null | undefined;
  return {
    get width() {
      return canvas.width;
    },
    set width(v: number) {
      canvas.width = v;
    },
    get height() {
      return canvas.height;
    },
    set height(v: number) {
      canvas.height = v;
    },
    getContext2D() {
      if (cachedCtx === undefined) {
        cachedCtx = canvas.getContext('2d');
      }
      return cachedCtx;
    },
    drawable: canvas,
  };
}

interface CachedTileEntry {
  readonly signature: string;
  readonly surface: TileSurface;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * Pure LRU Tile Cache with pluggable surface factory (100% testable in Node without DOM).
 */
export class TileCacheManager {
  private readonly maxTiles: number;
  private readonly createSurface: TileSurfaceFactory;
  private readonly entries = new Map<string, CachedTileEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxTiles = 64, factory?: TileSurfaceFactory) {
    this.maxTiles = Math.max(4, maxTiles);
    this.createSurface = factory ?? createDefaultBrowserTileSurface;
  }

  public getOrRenderTile(
    coord: TileCoord,
    signature: string,
    pixelWidth: number,
    pixelHeight: number,
    renderTile: (surface: TileSurface) => void,
  ): TileSurface {
    const existing = this.entries.get(coord.key);
    if (
      existing &&
      existing.signature === signature &&
      existing.pixelWidth === pixelWidth &&
      existing.pixelHeight === pixelHeight
    ) {
      // Refresh LRU recency
      this.entries.delete(coord.key);
      this.entries.set(coord.key, existing);
      this.hits += 1;
      return existing.surface;
    }

    this.misses += 1;
    const surface =
      existing && existing.pixelWidth === pixelWidth && existing.pixelHeight === pixelHeight
        ? existing.surface
        : this.createSurface(pixelWidth, pixelHeight);

    renderTile(surface);

    this.entries.delete(coord.key);
    this.entries.set(coord.key, {
      signature,
      surface,
      pixelWidth,
      pixelHeight,
    });

    while (this.entries.size > this.maxTiles) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
      this.evictions += 1;
    }

    return surface;
  }

  public clear(): void {
    this.entries.clear();
  }

  public resetCounters(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getStats(): TileCacheStats {
    return {
      size: this.entries.size,
      maxTiles: this.maxTiles,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

/* ─── Image Element Cache for ImageNode rasterization ─── */

interface CachedImageEntry {
  readonly img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

const MAX_CACHED_IMAGES = 128;
const imageElementCache = new Map<string, CachedImageEntry>();

function getOrLoadImage(url: string, onLoaded?: () => void): HTMLImageElement | null {
  if (!url || typeof Image === 'undefined') return null;
  let entry = imageElementCache.get(url);
  if (entry) {
    // Refresh LRU recency
    imageElementCache.delete(url);
    imageElementCache.set(url, entry);
  } else {
    while (imageElementCache.size >= MAX_CACHED_IMAGES) {
      const oldestKey = imageElementCache.keys().next().value;
      if (oldestKey === undefined) break;
      imageElementCache.delete(oldestKey);
    }
    const img = new Image();
    img.decoding = 'async';
    entry = { img, loaded: false, failed: false };
    imageElementCache.set(url, entry);
    img.onload = () => {
      if (entry) entry.loaded = true;
      onLoaded?.();
    };
    img.onerror = () => {
      if (entry) entry.failed = true;
    };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      entry.loaded = true;
    }
  }
  return entry.loaded && !entry.failed ? entry.img : null;
}

/* ─── Canvas2D Rich Node Rasterizer ─── */

const MAX_COMPONENT_DEPTH = 16;

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w * 0.5, h * 0.5));
  ctx.beginPath();
  if (r <= 0.01) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function buildCanvasFillStyle(
  ctx: CanvasRenderingContext2D,
  paint: FillPaint,
  x: number,
  y: number,
  w: number,
  h: number,
): string | CanvasGradient | null {
  if (paint.type === 'solid') {
    const color = sanitizeStyleColor(paint.color);
    return color && color !== 'none' && color !== 'transparent' ? color : null;
  }
  if (paint.type === 'linear-gradient') {
    const rad = ((paint.angle - 90) * Math.PI) / 180;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const halfSpan = Math.abs(Math.cos(rad)) * w * 0.5 + Math.abs(Math.sin(rad)) * h * 0.5;
    const dx = Math.cos(rad) * halfSpan;
    const dy = Math.sin(rad) * halfSpan;
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const stop of paint.stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), sanitizeStyleColor(stop.color));
    }
    return grad;
  }
  const cx = x + w * (paint.cx ?? 0.5);
  const cy = y + h * (paint.cy ?? 0.5);
  const r = Math.max(1, Math.max(w, h) * (paint.r ?? 0.5));
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const stop of paint.stops) {
    grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), sanitizeStyleColor(stop.color));
  }
  return grad;
}

function applyNodeEffectsAndBlend(ctx: CanvasRenderingContext2D, node: DesignNode): void {
  if (node.blendMode && node.blendMode !== 'normal') {
    ctx.globalCompositeOperation = node.blendMode as GlobalCompositeOperation;
  }
  const effects = getVisibleEffects(node);
  const cssFilterStr = buildCssFilterString(node.cssFilters);
  if (effects.length === 0 && !cssFilterStr) return;

  const filters: string[] = [];
  const dropShadows: Array<{ x: number; y: number; blur: number; color: string }> = [];
  for (const eff of effects) {
    if (eff.type === 'layer-blur' && eff.radius > 0) {
      filters.push(`blur(${eff.radius}px)`);
    } else if (eff.type === 'drop-shadow') {
      dropShadows.push({
        x: eff.x,
        y: eff.y,
        blur: Math.max(0, eff.blur),
        color: sanitizeStyleColor(eff.color),
      });
    }
  }

  // Use native canvas shadow for single shadow (widest support), and CSS filter chain when multiple shadows stack
  if (dropShadows.length === 1) {
    const ds = dropShadows[0];
    ctx.shadowOffsetX = ds.x;
    ctx.shadowOffsetY = ds.y;
    ctx.shadowBlur = ds.blur;
    ctx.shadowColor = ds.color;
  } else if (dropShadows.length > 1) {
    for (const ds of dropShadows) {
      filters.push(`drop-shadow(${ds.x}px ${ds.y}px ${ds.blur}px ${ds.color})`);
    }
  }

  if (cssFilterStr) {
    filters.push(cssFilterStr);
  }

  if (filters.length > 0 && 'filter' in ctx) {
    ctx.filter = filters.join(' ');
  }
}

function traceNodeGeometryPath(ctx: CanvasRenderingContext2D, node: DesignNode): boolean {
  if (node.type === 'rect' || node.type === 'frame' || node.type === 'image') {
    traceRoundedRect(ctx, node.x, node.y, node.width, node.height, node.style.radius ?? 0);
    return true;
  }
  if (node.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      node.x + node.width * 0.5,
      node.y + node.height * 0.5,
      Math.max(0.5, node.width * 0.5),
      Math.max(0.5, node.height * 0.5),
      0,
      0,
      Math.PI * 2,
    );
    return true;
  }
  if (node.type === 'path' && node.points.length > 0) {
    ctx.beginPath();
    traceSubpath(ctx, node.x, node.y, node.points, node.closed);
    if (node.subpaths) {
      for (const sub of node.subpaths) {
        traceSubpath(ctx, node.x, node.y, sub.points, sub.closed);
      }
    }
    return true;
  }
  return false;
}

function renderInnerShadowsForNode(ctx: CanvasRenderingContext2D, node: DesignNode): void {
  const effects = getVisibleEffects(node);
  const innerShadows = effects.filter((eff) => eff.type === 'inner-shadow');
  if (innerShadows.length === 0) return;

  for (const eff of innerShadows) {
    if (eff.type !== 'inner-shadow') continue;
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'none';
    if (!traceNodeGeometryPath(ctx, node)) {
      ctx.restore();
      return;
    }
    ctx.clip();
    // Draw an inverted frame around the shape with a cast shadow so the shadow falls strictly inside the clip region
    const pad = Math.max(40, eff.blur * 3 + Math.abs(eff.x) + Math.abs(eff.y) + Math.abs(eff.spread ?? 0) + 16);
    ctx.shadowOffsetX = eff.x;
    ctx.shadowOffsetY = eff.y;
    ctx.shadowBlur = Math.max(0, eff.blur);
    ctx.shadowColor = sanitizeStyleColor(eff.color);
    ctx.fillStyle = sanitizeStyleColor(eff.color);
    ctx.beginPath();
    ctx.rect(node.x - pad, node.y - pad, node.width + pad * 2, node.height + pad * 2);
    if (node.type === 'ellipse') {
      ctx.ellipse(
        node.x + node.width * 0.5,
        node.y + node.height * 0.5,
        Math.max(0.5, node.width * 0.5),
        Math.max(0.5, node.height * 0.5),
        0,
        0,
        Math.PI * 2,
        true,
      );
    } else if (node.type === 'rect' || node.type === 'frame' || node.type === 'image') {
      const r = Math.max(0, Math.min(node.style.radius ?? 0, node.width * 0.5, node.height * 0.5));
      if (r > 0) {
        const x = node.x;
        const y = node.y;
        const w = node.width;
        const h = node.height;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      } else {
        ctx.rect(node.x, node.y, node.width, node.height);
      }
    } else if (node.type === 'path' && node.points.length > 0) {
      traceSubpath(ctx, node.x, node.y, node.points, node.closed);
      if (node.subpaths) {
        for (const sub of node.subpaths) {
          traceSubpath(ctx, node.x, node.y, sub.points, sub.closed);
        }
      }
    }
    ctx.fill('evenodd');
    ctx.restore();
  }
}

function traceSubpath(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  points: readonly VectorAnchorPoint[],
  closed: boolean,
): void {
  if (points.length === 0) return;
  const first = points[0];
  ctx.moveTo(offsetX + first.x, offsetY + first.y);
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    if (curr.handleOut || next.handleIn) {
      const cp1 = curr.handleOut ?? curr;
      const cp2 = next.handleIn ?? next;
      ctx.bezierCurveTo(
        offsetX + cp1.x,
        offsetY + cp1.y,
        offsetX + cp2.x,
        offsetY + cp2.y,
        offsetX + next.x,
        offsetY + next.y,
      );
    } else {
      ctx.lineTo(offsetX + next.x, offsetY + next.y);
    }
  }
  if (closed) ctx.closePath();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tip: { x: number; y: number },
  from: { x: number; y: number },
  size: number,
  color: string,
): void {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const backX = tip.x - ux * size;
  const backY = tip.y - uy * size;
  const wing = size * 0.48;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(backX + px * wing, backY + py * wing);
  ctx.lineTo(backX - px * wing, backY - py * wing);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function renderRectOrFrameNode(ctx: CanvasRenderingContext2D, node: RectNode | FrameNode): void {
  const radius = node.style.radius ?? 0;
  const fills = getVisibleFillPaints(node);
  const baseAlpha = ctx.globalAlpha;

  for (const paint of fills) {
    const fillStyle = buildCanvasFillStyle(ctx, paint, node.x, node.y, node.width, node.height);
    if (!fillStyle) continue;
    ctx.globalAlpha = baseAlpha * (paint.opacity ?? 1);
    traceRoundedRect(ctx, node.x, node.y, node.width, node.height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;

  if (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    traceRoundedRect(ctx, node.x, node.y, node.width, node.height, radius);
    ctx.strokeStyle = sanitizeStyleColor(node.style.stroke);
    ctx.lineWidth = node.style.strokeWidth;
    ctx.stroke();
  }

  if (node.type === 'frame' && node.isSection) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const label = node.name || 'Section';
    const textW = ctx.measureText(label).width;
    const badgeW = Math.min(node.width, Math.max(68, textW + 16));
    traceRoundedRect(ctx, node.x, Math.max(0, node.y - 24), badgeW, 20, 4);
    ctx.fillStyle = 'rgba(139, 124, 246, 0.92)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, node.x + 8, Math.max(0, node.y - 24) + 10);
    ctx.restore();
  }
}

function renderEllipseNode(ctx: CanvasRenderingContext2D, node: EllipseNode): void {
  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  const rx = Math.max(0.5, node.width * 0.5);
  const ry = Math.max(0.5, node.height * 0.5);
  const fills = getVisibleFillPaints(node);
  const baseAlpha = ctx.globalAlpha;

  for (const paint of fills) {
    const fillStyle = buildCanvasFillStyle(ctx, paint, node.x, node.y, node.width, node.height);
    if (!fillStyle) continue;
    ctx.globalAlpha = baseAlpha * (paint.opacity ?? 1);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;

  if (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = sanitizeStyleColor(node.style.stroke);
    ctx.lineWidth = node.style.strokeWidth;
    ctx.stroke();
  }
}

function renderPathNode(ctx: CanvasRenderingContext2D, node: PathNode): void {
  if (node.points.length === 0 && (!node.subpaths || node.subpaths.length === 0)) return;

  const buildPath = () => {
    ctx.beginPath();
    if (node.points.length > 0) {
      traceSubpath(ctx, node.x, node.y, node.points, node.closed);
    }
    if (node.subpaths) {
      for (const sub of node.subpaths) {
        traceSubpath(ctx, node.x, node.y, sub.points, sub.closed);
      }
    }
  };

  const fills = getVisibleFillPaints(node);
  const fillRule: CanvasFillRule = node.style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const baseAlpha = ctx.globalAlpha;

  for (const paint of fills) {
    const fillStyle = buildCanvasFillStyle(ctx, paint, node.x, node.y, node.width, node.height);
    if (!fillStyle) continue;
    ctx.globalAlpha = baseAlpha * (paint.opacity ?? 1);
    buildPath();
    ctx.fillStyle = fillStyle;
    ctx.fill(fillRule);
  }
  ctx.globalAlpha = baseAlpha;

  if (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    buildPath();
    ctx.strokeStyle = sanitizeStyleColor(node.style.stroke);
    ctx.lineWidth = node.style.strokeWidth;
    ctx.lineCap = node.style.strokeLinecap ?? 'round';
    ctx.lineJoin = node.style.strokeLinejoin ?? 'round';
    if (node.style.strokeDasharray) {
      const dashes = node.style.strokeDasharray
        .split(/[\s,]+/)
        .map((v) => parseFloat(v))
        .filter((v) => Number.isFinite(v) && v >= 0);
      if (dashes.length > 0) ctx.setLineDash(dashes);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (!node.closed && node.points.length >= 2 && (node.style.arrowStart || node.style.arrowEnd)) {
    const color =
      node.style.stroke && node.style.stroke !== 'none'
        ? sanitizeStyleColor(node.style.stroke)
        : sanitizeStyleColor(node.style.fill);
    const size = Math.max(10, Math.min(28, (node.style.strokeWidth || 2) * 3.8));
    if (node.style.arrowEnd) {
      const tip = node.points[node.points.length - 1];
      const prev = tip.handleIn ?? node.points[node.points.length - 2];
      drawArrowhead(
        ctx,
        { x: node.x + tip.x, y: node.y + tip.y },
        { x: node.x + prev.x, y: node.y + prev.y },
        size,
        color,
      );
    }
    if (node.style.arrowStart) {
      const tip = node.points[0];
      const next = tip.handleOut ?? node.points[1];
      drawArrowhead(
        ctx,
        { x: node.x + tip.x, y: node.y + tip.y },
        { x: node.x + next.x, y: node.y + next.y },
        size,
        color,
      );
    }
  }
}

function mapTextAlignToCanvasTextAlign(align: TextAlign): CanvasTextAlign {
  switch (align) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'left':
    case 'justify':
      return 'left';
  }
}

function renderTextNode(ctx: CanvasRenderingContext2D, node: TextNode): void {
  const fontSize = Math.max(1, node.style.fontSize || 16);
  const fontWeight = Math.round(node.style.fontWeight || 400);
  const fontFamily = node.style.fontFamily || 'Inter, system-ui, sans-serif';
  const lineHeightPx = fontSize * (node.style.lineHeight || 1.35);
  const textAlign: TextAlign = node.style.textAlign ?? 'left';
  const canvasTextAlign = mapTextAlignToCanvasTextAlign(textAlign);

  const lines = wrapTextLines(node.text, {
    maxWidth: node.width,
    fontSize,
    fontFamily,
    fontWeight,
    letterSpacing: node.style.letterSpacing || 0,
    textWrap: node.style.textWrap,
    textTransform: node.style.textTransform,
  });

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = sanitizeStyleColor(node.style.fill);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = canvasTextAlign;

  const anchorX =
    textAlign === 'center'
      ? node.x + node.width * 0.5
      : textAlign === 'right'
        ? node.x + node.width
        : node.x;

  // Match SVG artwork baseline (`y = node.y + fontSize` for first line)
  const firstBaselineY = node.y + fontSize;
  const decoration = node.style.textDecoration;

  const letterSpacing = node.style.letterSpacing || 0;
  const ctxWithSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const supportsNativeSpacing = letterSpacing !== 0 && 'letterSpacing' in ctxWithSpacing;
  if (supportsNativeSpacing) {
    ctxWithSpacing.letterSpacing = `${letterSpacing}px`;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const baselineY = firstBaselineY + i * lineHeightPx;
    let metricsW = ctx.measureText(line).width;

    if (letterSpacing !== 0 && !supportsNativeSpacing && line.length > 1) {
      const totalExtra = letterSpacing * (line.length - 1);
      metricsW += totalExtra;
      let cursorX =
        textAlign === 'center'
          ? anchorX - metricsW * 0.5
          : textAlign === 'right'
            ? anchorX - metricsW
            : anchorX;
      ctx.textAlign = 'left';
      for (let c = 0; c < line.length; c += 1) {
        const ch = line[c];
        ctx.fillText(ch, cursorX, baselineY);
        cursorX += ctx.measureText(ch).width + letterSpacing;
      }
      ctx.textAlign = canvasTextAlign;
    } else {
      ctx.fillText(line, anchorX, baselineY);
    }

    if (decoration && decoration !== 'none' && line.length > 0) {
      const startX =
        textAlign === 'center'
          ? anchorX - metricsW * 0.5
          : textAlign === 'right'
            ? anchorX - metricsW
            : anchorX;
      const decoY = decoration === 'underline' ? baselineY + fontSize * 0.14 : baselineY - fontSize * 0.3;
      ctx.beginPath();
      ctx.moveTo(startX, decoY);
      ctx.lineTo(startX + metricsW, decoY);
      ctx.strokeStyle = sanitizeStyleColor(node.style.fill);
      ctx.lineWidth = Math.max(1, fontSize * 0.065);
      ctx.stroke();
    }
  }

  if (supportsNativeSpacing) {
    ctxWithSpacing.letterSpacing = '0px';
  }
}

function renderImageNode(
  ctx: CanvasRenderingContext2D,
  node: ImageNode,
  context: RichNodeRenderContext,
): void {
  const asset = context.assetById?.get(node.assetId);
  const displayUrl = asset ? resolveAssetDisplayUrl(asset) : null;
  const radius = node.style.radius ?? 0;

  ctx.save();
  traceRoundedRect(ctx, node.x, node.y, node.width, node.height, radius);
  ctx.clip();

  const img = displayUrl ? getOrLoadImage(displayUrl, context.onAsyncAssetLoaded) : null;
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const nw = Math.max(1, node.width);
    const nh = Math.max(1, node.height);
    if (node.style.fit === 'fill') {
      ctx.drawImage(img, node.x, node.y, nw, nh);
    } else {
      const scale =
        node.style.fit === 'contain'
          ? Math.min(nw / iw, nh / ih)
          : Math.max(nw / iw, nh / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = node.x + (nw - dw) * 0.5;
      const dy = node.y + (nh - dh) * 0.5;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  } else {
    ctx.fillStyle = '#1e2433';
    ctx.fillRect(node.x, node.y, node.width, node.height);
    ctx.strokeStyle = '#4f5d7a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y);
    ctx.lineTo(node.x + node.width, node.y + node.height);
    ctx.moveTo(node.x + node.width, node.y);
    ctx.lineTo(node.x, node.y + node.height);
    ctx.stroke();
  }
  ctx.restore();

  if ((node.style.strokeWidth ?? 0) > 0 && node.style.stroke && node.style.stroke !== 'none') {
    traceRoundedRect(ctx, node.x, node.y, node.width, node.height, radius);
    ctx.strokeStyle = sanitizeStyleColor(node.style.stroke);
    ctx.lineWidth = node.style.strokeWidth ?? 1;
    ctx.stroke();
  }
}

function renderComponentInstanceNode(
  ctx: CanvasRenderingContext2D,
  node: ComponentInstanceNode,
  context: RichNodeRenderContext,
  depth: number,
  visitedIds: ReadonlySet<string>,
): void {
  if (depth >= MAX_COMPONENT_DEPTH || visitedIds.has(node.componentId)) return;
  const component = context.componentById.get(node.componentId);
  if (!component) {
    traceRoundedRect(ctx, node.x, node.y, node.width, node.height, 8);
    ctx.strokeStyle = '#e59a4c';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  const nextVisited = new Set(visitedIds);
  nextVisited.add(component.id);

  const resolvedRaw = resolveComponentInstanceNodes(node, component, context.tokens);
  const resolved = computeAutoLayoutNodes(resolvedRaw);
  const resolvedById = new Map(resolved.map((child) => [child.id, child]));
  const childContext: RichNodeRenderContext = {
    ...context,
    allNodes: resolved,
    nodeById: resolvedById,
    clipMaskMap: new Map(),
    frameClipMap: new Map(),
  };

  for (const child of resolved) {
    if (!child.visible || child.type === 'group') continue;
    renderRichNodeToContext2D(ctx, child, childContext, depth + 1, nextVisited);
  }
}

/**
 * Renders any Folio `DesignNode` faithfully into a Canvas2D context (respecting
 * parent `frameClipMap` clipping, rotation, opacity, blend modes, effects, and nested components).
 */
export function renderRichNodeToContext2D(
  ctx: CanvasRenderingContext2D,
  node: DesignNode,
  context: RichNodeRenderContext,
  depth = 0,
  visitedComponentIds: ReadonlySet<string> = new Set(),
): void {
  if (!node.visible || node.type === 'group') return;

  ctx.save();

  // Apply parent frame clipContent regions if present
  const clipFrameIds = context.frameClipMap.get(node.id);
  if (clipFrameIds && clipFrameIds.length > 0) {
    for (const frameId of clipFrameIds) {
      const frame = context.nodeById.get(frameId);
      if (frame && frame.type === 'frame') {
        traceRoundedRect(ctx, frame.x, frame.y, frame.width, frame.height, frame.style.radius ?? 0);
        ctx.clip();
      }
    }
  }

  // Apply sibling/ancestor vector clip masks if present (supporting rotated mask geometry)
  const clipMaskIds = context.clipMaskMap.get(node.id);
  if (clipMaskIds && clipMaskIds.length > 0) {
    for (const maskId of clipMaskIds) {
      const maskNode = context.nodeById.get(maskId);
      if (!maskNode || !maskNode.visible) continue;
      if (maskNode.rotation) {
        const mcx = maskNode.x + maskNode.width * 0.5;
        const mcy = maskNode.y + maskNode.height * 0.5;
        ctx.translate(mcx, mcy);
        ctx.rotate((maskNode.rotation * Math.PI) / 180);
        ctx.translate(-mcx, -mcy);
        if (traceNodeGeometryPath(ctx, maskNode)) {
          ctx.clip();
        }
        ctx.translate(mcx, mcy);
        ctx.rotate((-maskNode.rotation * Math.PI) / 180);
        ctx.translate(-mcx, -mcy);
      } else if (traceNodeGeometryPath(ctx, maskNode)) {
        ctx.clip();
      }
    }
  }

  ctx.globalAlpha = Math.max(0, Math.min(1, node.opacity ?? 1));
  applyNodeEffectsAndBlend(ctx, node);

  if (node.rotation) {
    const cx = node.x + node.width * 0.5;
    const cy = node.y + node.height * 0.5;
    ctx.translate(cx, cy);
    ctx.rotate((node.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  switch (node.type) {
    case 'rect':
    case 'frame':
      renderRectOrFrameNode(ctx, node);
      renderInnerShadowsForNode(ctx, node);
      break;
    case 'ellipse':
      renderEllipseNode(ctx, node);
      renderInnerShadowsForNode(ctx, node);
      break;
    case 'path':
      renderPathNode(ctx, node);
      renderInnerShadowsForNode(ctx, node);
      break;
    case 'text':
      renderTextNode(ctx, node);
      break;
    case 'image':
      renderImageNode(ctx, node, context);
      renderInnerShadowsForNode(ctx, node);
      break;
    case 'component-instance':
      renderComponentInstanceNode(ctx, node, context, depth, visitedComponentIds);
      break;
    default:
      break;
  }

  ctx.restore();
}

/**
 * Pure Multi-Color Blending Engine for Folio's Shape Builder, Pathfinder Unite,
 * and Combine into 1 Object workflows.
 *
 * When 2+ shapes with different colors are merged into a single PathNode:
 * - `'linear'`: creates a smooth linear-gradient transition aligned with the
 *   spatial axis between the source shapes' centroids.
 * - `'hard'`: creates a crisp hard-stop linear-gradient split ("sharp split")
 *   along the midpoints between adjacent source colors.
 * - `'single'`: keeps a single flat fill color from the template shape.
 */

import {
  computeSvgLinearGradientCoords,
  getVisibleFillPaints,
  isTransparentColor,
  parseColorWithAlpha,
  roundStyleNum,
} from './styling';
import type { DesignNode, FillPaint, GradientStop, PathNode } from './types';

export type ShapeColorBlendMode = 'linear' | 'hard' | 'single';

export interface ColorBlendSourceSample {
  readonly color: string;
  readonly opacity: number;
  readonly cx: number;
  readonly cy: number;
}

export interface BoundsRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const MAX_HARD_SPLIT_COLORS = 8; // 8 zones * 2 stops = 16 stops (isFillPaint max)

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundOffset(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function normalizeColorKey(color: string, opacity: number): string {
  const parsed = parseColorWithAlpha(color, '#8B7CF6');
  const effectiveAlpha = Math.round(clamp01(parsed.alpha * opacity) * 100);
  return `${parsed.hex.toUpperCase()}@${effectiveAlpha}`;
}

/**
 * Extracts the primary visible color and opacity from a shape/path node.
 * Handles both multi-fill `style.fills` (solid or gradient) and legacy `style.fill`.
 */
export function extractNodeVisualColor(
  node: DesignNode,
): { readonly color: string; readonly opacity: number } | null {
  if (
    node.type !== 'rect' &&
    node.type !== 'ellipse' &&
    node.type !== 'frame' &&
    node.type !== 'path'
  ) {
    return null;
  }

  const paints = getVisibleFillPaints(node);
  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const paint = paints[i];
    const paintOpacity = clamp01(paint.opacity ?? 1);
    if (paintOpacity <= 0) continue;

    if (paint.type === 'solid') {
      if (isTransparentColor(paint.color)) continue;
      const parsed = parseColorWithAlpha(paint.color, '#8B7CF6');
      if (parsed.isTransparent) continue;
      return {
        color: parsed.hex,
        opacity: roundStyleNum(clamp01(parsed.alpha * paintOpacity)),
      };
    }

    if (paint.stops.length > 0) {
      // Pick the first visible stop as representative color when re-merging a gradient shape
      const repStop = paint.stops[0];
      if (!isTransparentColor(repStop.color)) {
        const parsed = parseColorWithAlpha(repStop.color, '#8B7CF6');
        const stopOpacity = clamp01(repStop.opacity ?? 1);
        const eff = clamp01(parsed.alpha * stopOpacity * paintOpacity);
        if (eff > 0) {
          return { color: parsed.hex, opacity: roundStyleNum(eff) };
        }
      }
    }
  }

  if (!isTransparentColor(node.style.fill)) {
    const parsed = parseColorWithAlpha(node.style.fill, '#8B7CF6');
    if (!parsed.isTransparent) {
      return { color: parsed.hex, opacity: roundStyleNum(parsed.alpha) };
    }
  }

  return null;
}

/**
 * Computes the CSS/SVG linear-gradient angle (in degrees, where 0deg = bottom-to-top,
 * 90deg = left-to-right, 135deg = top-left to bottom-right) from a direction vector
 * in normalized objectBoundingBox coordinates.
 */
function directionToGradientAngle(du: number, dv: number): number {
  const len = Math.hypot(du, dv);
  if (len < 1e-4) return 135;
  const rad = Math.atan2(du, -dv);
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  return Math.round(deg * 10) / 10;
}

/**
 * Parses percentage string returned by `computeSvgLinearGradientCoords` into [0, 1].
 */
function parsePct(raw: string): number {
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num / 100 : 0.5;
}

/**
 * Computes the dominant spatial axis across 2+ colored samples in normalized
 * bounding-box coordinates, returning the gradient angle and projected parameter
 * `t` for every sample along the exact SVG `<linearGradient>` line segment.
 */
function computeAxisAndProjections(
  samples: readonly ColorBlendSourceSample[],
  bounds: BoundsRect,
): {
  readonly angle: number;
  readonly projected: Array<ColorBlendSourceSample & { readonly t: number }>;
} {
  const safeW = Math.max(1, bounds.width);
  const safeH = Math.max(1, bounds.height);

  const normalized = samples.map((sample) => ({
    sample,
    u: (sample.cx - bounds.x) / safeW,
    v: (sample.cy - bounds.y) / safeH,
  }));

  // Find the pair of differently-colored samples with maximum spatial separation
  // so the gradient axis naturally follows the arrangement of distinct colors.
  let bestDu = 0;
  let bestDv = 0;
  let maxDistSq = -1;

  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const keyI = normalizeColorKey(normalized[i].sample.color, normalized[i].sample.opacity);
      const keyJ = normalizeColorKey(normalized[j].sample.color, normalized[j].sample.opacity);
      if (keyI === keyJ) continue;
      const du = normalized[j].u - normalized[i].u;
      const dv = normalized[j].v - normalized[i].v;
      const distSq = du * du + dv * dv;
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        bestDu = du;
        bestDv = dv;
      }
    }
  }

  // Fallback to general 135deg diagonal if shapes are concentric / identical centers
  const angle = maxDistSq > 1e-5 ? directionToGradientAngle(bestDu, bestDv) : 135;

  const coords = computeSvgLinearGradientCoords(angle);
  const x1 = parsePct(coords.x1);
  const y1 = parsePct(coords.y1);
  const x2 = parsePct(coords.x2);
  const y2 = parsePct(coords.y2);
  const gx = x2 - x1;
  const gy = y2 - y1;
  const gLenSq = Math.max(1e-6, gx * gx + gy * gy);

  const projected = normalized.map(({ sample, u, v }) => {
    const t = ((u - x1) * gx + (v - y1) * gy) / gLenSq;
    return { ...sample, t: clamp01(t) };
  });

  return { angle, projected };
}

/**
 * Builds a multi-color `linear-gradient` FillPaint from 2+ colored source shapes.
 * Returns `null` if `mode === 'single'` or if all contributing shapes share the
 * same color (so single-color merges stay clean solid fills).
 */
export function buildBlendedFillPaint(
  samples: readonly ColorBlendSourceSample[],
  bounds: BoundsRect,
  mode: ShapeColorBlendMode,
  paintId = 'fill-blend',
): Extract<FillPaint, { type: 'linear-gradient' }> | null {
  if (mode === 'single' || samples.length < 2) return null;

  const validSamples = samples.filter((s) => !isTransparentColor(s.color) && s.opacity > 0);
  if (validSamples.length < 2) return null;

  // Verify at least 2 distinct colors exist
  const uniqueKeys = new Set(validSamples.map((s) => normalizeColorKey(s.color, s.opacity)));
  if (uniqueKeys.size < 2) return null;

  const { angle, projected } = computeAxisAndProjections(validSamples, bounds);

  // Sort along the gradient axis
  projected.sort((a, b) => a.t - b.t);

  // Collapse adjacent identical colors by averaging their projected position
  const orderedZones: Array<{ color: string; opacity: number; t: number; count: number }> = [];
  for (const item of projected) {
    const key = normalizeColorKey(item.color, item.opacity);
    const prev = orderedZones[orderedZones.length - 1];
    if (prev && normalizeColorKey(prev.color, prev.opacity) === key) {
      prev.t = (prev.t * prev.count + item.t) / (prev.count + 1);
      prev.count += 1;
    } else {
      orderedZones.push({ color: item.color, opacity: item.opacity, t: item.t, count: 1 });
    }
  }

  if (orderedZones.length < 2) return null;

  // Cap zones to MAX_HARD_SPLIT_COLORS so even hard-split stays <= 16 stops (isFillPaint limit)
  const zones =
    orderedZones.length <= MAX_HARD_SPLIT_COLORS
      ? orderedZones
      : Array.from({ length: MAX_HARD_SPLIT_COLORS }, (_, idx) => {
          const sourceIdx = Math.round((idx / (MAX_HARD_SPLIT_COLORS - 1)) * (orderedZones.length - 1));
          return orderedZones[sourceIdx];
        });

  const tMin = zones[0].t;
  const tMax = zones[zones.length - 1].t;
  const spread = tMax - tMin;

  // Determine well-spaced anchor positions along [0, 1]
  const positions = zones.map((zone, idx) => {
    if (spread < 0.08) {
      // Concentric or heavily overlapping shapes: space cleanly so every color is visible
      return zones.length === 2
        ? idx === 0
          ? 0.22
          : 0.78
        : 0.12 + (idx / (zones.length - 1)) * 0.76;
    }
    return clamp01(zone.t);
  });

  if (mode === 'hard') {
    const stops: GradientStop[] = [];
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i];
      const startOffset = i === 0 ? 0 : roundOffset((positions[i - 1] + positions[i]) * 0.5);
      const endOffset = i === zones.length - 1 ? 1 : roundOffset((positions[i] + positions[i + 1]) * 0.5);
      const safeEnd = Math.max(startOffset, endOffset);
      stops.push({ offset: startOffset, color: zone.color, opacity: zone.opacity });
      stops.push({ offset: safeEnd, color: zone.color, opacity: zone.opacity });
    }
    return {
      id: paintId,
      type: 'linear-gradient',
      angle,
      stops,
      opacity: 1,
      visible: true,
    };
  }

  // Smooth linear blend: each source color anchors near its natural centroid position
  const linearStops: GradientStop[] = zones.map((zone, idx) => {
    let offset = positions[idx];
    if (zones.length === 2) {
      // Keep core color saturated on each outer side while smoothly blending across the join
      offset = idx === 0 ? Math.max(0.08, Math.min(0.42, offset)) : Math.min(0.92, Math.max(0.58, offset));
    }
    return {
      offset: roundOffset(offset),
      color: zone.color,
      opacity: zone.opacity,
    };
  });

  return {
    id: paintId,
    type: 'linear-gradient',
    angle,
    stops: linearStops,
    opacity: 1,
    visible: true,
  };
}

/**
 * Applies multi-color blending to a newly merged PathNode based on its contributing
 * source shapes and the chosen `ShapeColorBlendMode`.
 */
export function applyMergedColorBlendToPathNode(
  mergedNode: PathNode,
  sourceNodes: readonly DesignNode[],
  mode: ShapeColorBlendMode,
  centroidOverrides?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): PathNode {
  if (mode === 'single' || sourceNodes.length < 2) return mergedNode;

  const samples: ColorBlendSourceSample[] = [];
  for (const source of sourceNodes) {
    const visual = extractNodeVisualColor(source);
    if (!visual) continue;
    const override = centroidOverrides?.get(source.id);
    const cx = override ? override.x : source.x + source.width * 0.5;
    const cy = override ? override.y : source.y + source.height * 0.5;
    samples.push({
      color: visual.color,
      opacity: visual.opacity,
      cx,
      cy,
    });
  }

  const blendedPaint = buildBlendedFillPaint(
    samples,
    {
      x: mergedNode.x,
      y: mergedNode.y,
      width: mergedNode.width,
      height: mergedNode.height,
    },
    mode,
    `fill-blend-${mode}`,
  );

  if (!blendedPaint) return mergedNode;

  return {
    ...mergedNode,
    style: {
      ...mergedNode.style,
      fill: blendedPaint.stops[0]?.color ?? mergedNode.style.fill,
      fills: [blendedPaint],
    },
  };
}

/**
 * Detects whether an existing linear gradient uses hard-stop sharp transitions
 * ("patah biasa") or smooth linear interpolation.
 */
export function detectLinearGradientTransitionStyle(
  stops: readonly GradientStop[],
): 'linear' | 'hard' {
  if (stops.length < 3) return 'linear';
  const sorted = stops.slice().sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (
      Math.abs(a.offset - b.offset) <= 0.005 &&
      normalizeColorKey(a.color, a.opacity ?? 1) !== normalizeColorKey(b.color, b.opacity ?? 1)
    ) {
      return 'hard';
    }
  }
  return 'linear';
}

/**
 * Converts an existing linear-gradient paint cleanly between smooth `'linear'`
 * and crisp `'hard'` sharp-split transitions while preserving its colors and angle.
 */
export function convertLinearGradientTransitionStyle(
  paint: Extract<FillPaint, { type: 'linear-gradient' }>,
  target: 'linear' | 'hard',
): Extract<FillPaint, { type: 'linear-gradient' }> {
  const sorted = paint.stops.slice().sort((a, b) => a.offset - b.offset);
  // Extract ordered unique consecutive color bands
  const bands: Array<{ color: string; opacity: number; offsets: number[] }> = [];
  for (const stop of sorted) {
    const op = clamp01(stop.opacity ?? 1);
    const key = normalizeColorKey(stop.color, op);
    const prev = bands[bands.length - 1];
    if (prev && normalizeColorKey(prev.color, prev.opacity) === key) {
      prev.offsets.push(stop.offset);
    } else {
      bands.push({ color: stop.color, opacity: op, offsets: [stop.offset] });
    }
  }

  if (bands.length < 2) return paint;

  const usableBands = bands.slice(0, MAX_HARD_SPLIT_COLORS);

  if (target === 'hard') {
    const centers = usableBands.map((band, idx) => {
      if (band.offsets.length >= 2) {
        return (band.offsets[0] + band.offsets[band.offsets.length - 1]) * 0.5;
      }
      return usableBands.length === 2
        ? idx === 0
          ? 0.25
          : 0.75
        : idx / (usableBands.length - 1);
    });

    const stops: GradientStop[] = [];
    for (let i = 0; i < usableBands.length; i += 1) {
      const band = usableBands[i];
      const startOffset = i === 0 ? 0 : roundOffset((centers[i - 1] + centers[i]) * 0.5);
      const endOffset =
        i === usableBands.length - 1 ? 1 : roundOffset((centers[i] + centers[i + 1]) * 0.5);
      const safeEnd = Math.max(startOffset, endOffset);
      stops.push({ offset: startOffset, color: band.color, opacity: band.opacity });
      stops.push({ offset: safeEnd, color: band.color, opacity: band.opacity });
    }
    return { ...paint, stops };
  }

  // Smooth linear stops
  const stops: GradientStop[] = usableBands.map((band, idx) => {
    const offset =
      usableBands.length === 2
        ? idx === 0
          ? 0.2
          : 0.8
        : roundOffset(idx / (usableBands.length - 1));
    return {
      offset,
      color: band.color,
      opacity: band.opacity,
    };
  });
  return { ...paint, stops };
}

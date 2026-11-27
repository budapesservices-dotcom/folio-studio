/**
 * FOLIO Native Animated SVG (SMIL) Generator.
 *
 * Emits self-contained, zero-JavaScript SVG SMIL (`<animate>`, `<animateTransform>`)
 * markup for both page-level animation clips and embedded animated components
 * (`component.animations`) so standalone `.svg` exports animate natively in every
 * modern browser (Chrome, Firefox, Safari, Edge) with 1:1 fidelity to Canvas & Video.
 *
 * Supports:
 *   - Native Shape Morph (`pathMorph`) via `<animate attributeName="d" ... />`
 *     with flags-aware, topology-locked cubic Bezier contours (`M ... C ... Z`)
 *     across 2-keyframe AND 3+ keyframe sequences with zero handle collapse or twist
 *   - Transform tracks (`x`, `y`, `rotation`, `scale`, `width`, `height`) in exact
 *     world-space `translate -> rotate -> scale` order (matching `evaluator.ts`)
 *   - Animated parent Group / Frame transform & opacity propagation to descendants
 *   - Visual & box tracks (`opacity`, `fill`, `stroke`, `strokeWidth`, `radius`)
 *   - Strictly spec-compliant SMIL `keySplines` in `[0, 1]` with automatic high-density
 *     `calcMode="linear"` sampling for overshoot, `spring`, `bounce-out`, `elastic-out`,
 *     and `multi-point` easing curves
 */

import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationTrack,
  ComponentDefinition,
  DesignNode,
  FolioDocument,
  FolioPage,
  FolioProject,
  TrimPathMode,
} from '../../core/document/types';
import {
  parsePathMorphSnapshot,
  prepareMorphPair,
} from '../../core/document/pathMorph';
import {
  computeContourTrimIntervals,
  getNodeContourLengths,
  intervalsToSvgStrokeDash,
} from '../../core/document/pathStudio';
import { formatColorWithAlpha, isTransparentColor, parseColorWithAlpha } from '../../core/document/styling';
import { easingToCubicBezier, evaluateEasing, isMultiPointEasing } from './easing';
import {
  applyAnimatedPosesToDocument,
  evaluateClipAtTime,
  evaluateTrackAtTime,
  sortKeyframes,
} from './evaluator';

const MORPH_STRIDE = 7;
const FLAG_HI = 1;
const FLAG_HO = 2;

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function fmtKeyTime(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  return String(Math.round(clamped * 10000) / 10000);
}

/**
 * Per SVG SMIL 3.0 / Blink / Gecko / WebKit rules, ALL four values in
 * `keySplines="x1 y1 x2 y2"` must lie strictly inside `[0, 1]` — overshoot
 * cubic-beziers (`y < 0` or `y > 1`) are rejected by Chromium and break the
 * entire `<animate>` element! Any non-cubic or overshoot easing MUST be sampled
 * via `calcMode="linear"` instead.
 */
export function needsSmilSampling(easing: AnimationEasing): boolean {
  if (isMultiPointEasing(easing)) return true;
  if (
    easing === 'spring' ||
    easing === 'bounce-out' ||
    easing === 'elastic-out' ||
    easing === 'overshoot-out' ||
    easing === 'back-in-out'
  ) {
    return true;
  }
  const [x1, y1, x2, y2] = easingToCubicBezier(easing);
  return x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1;
}

function formatEasingKeySpline(easing: AnimationEasing): string {
  const [x1, y1, x2, y2] = easingToCubicBezier(easing);
  const cx1 = Math.max(0, Math.min(1, x1));
  const cy1 = Math.max(0, Math.min(1, y1));
  const cx2 = Math.max(0, Math.min(1, x2));
  const cy2 = Math.max(0, Math.min(1, y2));
  return `${fmtNum(cx1)} ${fmtNum(cy1)} ${fmtNum(cx2)} ${fmtNum(cy2)}`;
}

interface CubicSegment {
  p0x: number;
  p0y: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  p3x: number;
  p3y: number;
}

function anchorsToCubicSegments(
  points: readonly {
    x: number;
    y: number;
    handleIn?: { x: number; y: number };
    handleOut?: { x: number; y: number };
  }[],
  closed: boolean,
): CubicSegment[] {
  const segs: CubicSegment[] = [];
  const count = points.length;
  if (count < 2) return segs;
  const segCount = closed ? count : count - 1;
  for (let i = 0; i < segCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    segs.push({
      p0x: a.x,
      p0y: a.y,
      c1x: a.handleOut ? a.handleOut.x : a.x,
      c1y: a.handleOut ? a.handleOut.y : a.y,
      c2x: b.handleIn ? b.handleIn.x : b.x,
      c2y: b.handleIn ? b.handleIn.y : b.y,
      p3x: b.x,
      p3y: b.y,
    });
  }
  return segs;
}

/**
 * Converts a packed `PreparedMorphPair` Float64Array buffer (`fromBuf` or `toBuf`)
 * into explicit `CubicSegment[]`, strictly honoring `flags` (`FLAG_HI = 1`, `FLAG_HO = 2`)
 * so straight segments keep their anchor coordinates instead of collapsing control
 * points to `(0, 0)`.
 */
function preparedBufferToCubicSegments(
  buf: Float64Array,
  flags: Uint8Array,
  pointCount: number,
  closed: boolean,
): CubicSegment[] {
  const segs: CubicSegment[] = [];
  if (pointCount < 2) return segs;
  const segCount = closed ? pointCount : pointCount - 1;
  for (let i = 0; i < segCount; i += 1) {
    const next = (i + 1) % pointCount;
    const bi = i * MORPH_STRIDE;
    const bn = next * MORPH_STRIDE;
    const ax = buf[bi];
    const ay = buf[bi + 1];
    const bx = buf[bn];
    const by = buf[bn + 1];
    const hasOut = (flags[i] & FLAG_HO) !== 0;
    const hasIn = (flags[next] & FLAG_HI) !== 0;
    segs.push({
      p0x: ax,
      p0y: ay,
      c1x: hasOut ? buf[bi + 4] : ax,
      c1y: hasOut ? buf[bi + 5] : ay,
      c2x: hasIn ? buf[bn + 2] : bx,
      c2y: hasIn ? buf[bn + 3] : by,
      p3x: bx,
      p3y: by,
    });
  }
  return segs;
}

function splitCubicAtHalf(s: CubicSegment): [CubicSegment, CubicSegment] {
  const m01x = (s.p0x + s.c1x) * 0.5;
  const m01y = (s.p0y + s.c1y) * 0.5;
  const m12x = (s.c1x + s.c2x) * 0.5;
  const m12y = (s.c1y + s.c2y) * 0.5;
  const m23x = (s.c2x + s.p3x) * 0.5;
  const m23y = (s.c2y + s.p3y) * 0.5;

  const m012x = (m01x + m12x) * 0.5;
  const m012y = (m01y + m12y) * 0.5;
  const m123x = (m12x + m23x) * 0.5;
  const m123y = (m12y + m23y) * 0.5;

  const midx = (m012x + m123x) * 0.5;
  const midy = (m012y + m123y) * 0.5;

  return [
    { p0x: s.p0x, p0y: s.p0y, c1x: m01x, c1y: m01y, c2x: m012x, c2y: m012y, p3x: midx, p3y: midy },
    { p0x: midx, p0y: midy, c1x: m123x, c1y: m123y, c2x: m23x, c2y: m23y, p3x: s.p3x, p3y: s.p3y },
  ];
}

function estimateSegmentLength(s: CubicSegment): number {
  const chord = Math.hypot(s.p3x - s.p0x, s.p3y - s.p0y);
  const net =
    Math.hypot(s.c1x - s.p0x, s.c1y - s.p0y) +
    Math.hypot(s.c2x - s.c1x, s.c2y - s.c1y) +
    Math.hypot(s.p3x - s.c2x, s.p3y - s.c2y);
  return (chord + net) * 0.5;
}

/**
 * Simultaneously elevates a matched `(fromSegs, toSegs)` pair to `targetCount`
 * segments by splitting the SAME segment index in both contours via exact
 * de Casteljau midpoint subdivision. Guarantees 100% locked 1-to-1 vertex
 * correspondence and zero shape distortion across the entire morph transition.
 */
function elevateSegmentPairToCount(
  fromSegs: readonly CubicSegment[],
  toSegs: readonly CubicSegment[],
  targetCount: number,
): { from: CubicSegment[]; to: CubicSegment[] } {
  const fList = fromSegs.map((s) => ({ ...s }));
  const tList = toSegs.map((s) => ({ ...s }));
  while (fList.length > 0 && fList.length === tList.length && fList.length < targetCount) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < fList.length; i += 1) {
      const score = estimateSegmentLength(fList[i]) + estimateSegmentLength(tList[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const [fl, fr] = splitCubicAtHalf(fList[bestIdx]);
    const [tl, tr] = splitCubicAtHalf(tList[bestIdx]);
    fList.splice(bestIdx, 1, fl, fr);
    tList.splice(bestIdx, 1, tl, tr);
  }
  return { from: fList, to: tList };
}

function lerpCubicSegments(
  fromSegs: readonly CubicSegment[],
  toSegs: readonly CubicSegment[],
  t: number,
): CubicSegment[] {
  const n = Math.min(fromSegs.length, toSegs.length);
  const out: CubicSegment[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = fromSegs[i];
    const b = toSegs[i];
    out[i] = {
      p0x: a.p0x + (b.p0x - a.p0x) * t,
      p0y: a.p0y + (b.p0y - a.p0y) * t,
      c1x: a.c1x + (b.c1x - a.c1x) * t,
      c1y: a.c1y + (b.c1y - a.c1y) * t,
      c2x: a.c2x + (b.c2x - a.c2x) * t,
      c2y: a.c2y + (b.c2y - a.c2y) * t,
      p3x: a.p3x + (b.p3x - a.p3x) * t,
      p3y: a.p3y + (b.p3y - a.p3y) * t,
    };
  }
  return out;
}

function serializeCubicSegmentsToSvgD(
  segs: readonly CubicSegment[],
  closed: boolean,
  offsetX = 0,
  offsetY = 0,
): string {
  if (segs.length === 0) return '';
  const parts: string[] = [`M ${fmtNum(segs[0].p0x + offsetX)} ${fmtNum(segs[0].p0y + offsetY)}`];
  for (const s of segs) {
    parts.push(
      `C ${fmtNum(s.c1x + offsetX)} ${fmtNum(s.c1y + offsetY)} ${fmtNum(s.c2x + offsetX)} ${fmtNum(s.c2y + offsetY)} ${fmtNum(s.p3x + offsetX)} ${fmtNum(s.p3y + offsetY)}`,
    );
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

function serializeMultiContourCubicSegmentsToSvgD(
  contours: readonly { segs: readonly CubicSegment[]; closed: boolean }[],
  offsetX = 0,
  offsetY = 0,
): string {
  const parts: string[] = [];
  for (const contour of contours) {
    const d = serializeCubicSegmentsToSvgD(contour.segs, contour.closed, offsetX, offsetY);
    if (d) parts.push(d);
  }
  return parts.join(' ');
}

function buildCollapsedCubicSegments(segs: readonly CubicSegment[]): CubicSegment[] {
  if (segs.length === 0) return [];
  let sx = 0;
  let sy = 0;
  for (const s of segs) {
    sx += s.p0x;
    sy += s.p0y;
  }
  const cx = sx / segs.length;
  const cy = sy / segs.length;
  return segs.map(() => ({
    p0x: cx,
    p0y: cy,
    c1x: cx,
    c1y: cy,
    c2x: cx,
    c2y: cy,
    p3x: cx,
    p3y: cy,
  }));
}

export interface SvgMorphTrackSmilResult {
  readonly initialD: string;
  readonly animateMarkup: string;
}

/**
 * Generates an initial `<path d="...">` string + SMIL `<animate attributeName="d">`
 * tag for a `pathMorph` track (single-contour or multi-contour/holes) in
 * node-global SVG coordinates (`+ node.x, + node.y`).
 */
export function buildSvgPathMorphSmil(
  track: AnimationTrack,
  clip: AnimationClip,
  offsetX: number,
  offsetY: number,
): SvgMorphTrackSmilResult | null {
  if (track.property !== 'pathMorph' || track.keyframes.length === 0) return null;
  const sorted = sortKeyframes(track.keyframes).filter((kf) => typeof kf.value === 'string');
  if (sorted.length === 0) return null;

  const durationMs = Math.max(100, clip.durationMs);
  const durStr = `${fmtNum(durationMs / 1000)}s`;
  const repeatAttr = clip.loop ? 'repeatCount="indefinite"' : 'repeatCount="1" fill="freeze"';

  // Single keyframe -> static path (supports subpaths)
  if (sorted.length === 1) {
    const snap = parsePathMorphSnapshot(String(sorted[0].value));
    if (!snap || snap.points.length < 2) return null;
    const toContour = (pts: typeof snap.points, closed: boolean) => ({
      closed,
      segs: anchorsToCubicSegments(
        pts.map((p) => ({
          x: p.x,
          y: p.y,
          ...(p.hi ? { handleIn: { x: p.hi[0], y: p.hi[1] } } : {}),
          ...(p.ho ? { handleOut: { x: p.ho[0], y: p.ho[1] } } : {}),
        })),
        closed,
      ),
    });
    const contours = [
      toContour(snap.points, snap.closed),
      ...(snap.subpaths ?? []).map((sp) => toContour(sp.points, sp.closed)),
    ];
    return {
      initialD: serializeMultiContourCubicSegmentsToSvgD(contours, offsetX, offsetY),
      animateMarkup: '',
    };
  }

  // Fast exact path: 2 keyframes with SMIL-safe cubic-bezier easing (all spline values in [0,1])
  if (sorted.length === 2 && !needsSmilSampling(sorted[1].easing)) {
    const pair = prepareMorphPair(String(sorted[0].value), String(sorted[1].value));
    if (pair && pair.compatible) {
      const fromContours: Array<{ segs: CubicSegment[]; closed: boolean }> = [
        {
          closed: pair.closed,
          segs: preparedBufferToCubicSegments(pair.fromBuf, pair.flags, pair.pointCount, pair.closed),
        },
        ...(pair.subpathPairs ?? []).map((sp) => ({
          closed: sp.closed,
          segs: preparedBufferToCubicSegments(sp.fromBuf, sp.flags, sp.pointCount, sp.closed),
        })),
      ];
      const toContours: Array<{ segs: CubicSegment[]; closed: boolean }> = [
        {
          closed: pair.closed,
          segs: preparedBufferToCubicSegments(pair.toBuf, pair.flags, pair.pointCount, pair.closed),
        },
        ...(pair.subpathPairs ?? []).map((sp) => ({
          closed: sp.closed,
          segs: preparedBufferToCubicSegments(sp.toBuf, sp.flags, sp.pointCount, sp.closed),
        })),
      ];
      const d0 = serializeMultiContourCubicSegmentsToSvgD(fromContours, offsetX, offsetY);
      const d1 = serializeMultiContourCubicSegmentsToSvgD(toContours, offsetX, offsetY);
      const t0 = Math.max(0, Math.min(1, sorted[0].timeMs / durationMs));
      const t1 = Math.max(t0, Math.min(1, sorted[1].timeMs / durationMs));

      const values: string[] = [];
      const keyTimes: string[] = [];
      const keySplines: string[] = [];

      if (t0 > 0.0001) {
        values.push(d0);
        keyTimes.push('0');
        keySplines.push('0 0 1 1');
      }
      values.push(d0, d1);
      keyTimes.push(fmtKeyTime(t0), fmtKeyTime(t1));
      keySplines.push(formatEasingKeySpline(sorted[1].easing));
      if (t1 < 0.9999) {
        values.push(d1);
        keyTimes.push('1');
        keySplines.push('0 0 1 1');
      }
      while (keySplines.length > values.length - 1) keySplines.pop();

      const animateMarkup =
        `<animate attributeName="d" dur="${durStr}" ${repeatAttr} calcMode="spline"` +
        ` keyTimes="${keyTimes.join(';')}"` +
        ` keySplines="${keySplines.join(';')}"` +
        ` values="${escapeXmlAttr(values.join(';'))}" />`;
      return { initialD: d0, animateMarkup };
    }
  }

  // General path (3+ keyframes, or spring/bounce/elastic/overshoot/multi-point easing):
  // Elevate every adjacent pair's `(fromContours, toContours)` simultaneously to ONE
  // uniform contour count and segment count per contour so every SMIL value has
  // identical `M ... C ... Z` topology across all contours.
  const rawPairs: Array<{
    t0: number;
    t1: number;
    easing: AnimationEasing;
    contours: Array<{ closed: boolean; fromSegs: CubicSegment[]; toSegs: CubicSegment[] }>;
  }> = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const prepared = prepareMorphPair(String(sorted[i].value), String(sorted[i + 1].value));
    if (!prepared || !prepared.compatible) continue;
    rawPairs.push({
      t0: Math.max(0, Math.min(durationMs, sorted[i].timeMs)),
      t1: Math.max(0, Math.min(durationMs, sorted[i + 1].timeMs)),
      easing: sorted[i + 1].easing,
      contours: [
        {
          closed: prepared.closed,
          fromSegs: preparedBufferToCubicSegments(prepared.fromBuf, prepared.flags, prepared.pointCount, prepared.closed),
          toSegs: preparedBufferToCubicSegments(prepared.toBuf, prepared.flags, prepared.pointCount, prepared.closed),
        },
        ...(prepared.subpathPairs ?? []).map((sp) => ({
          closed: sp.closed,
          fromSegs: preparedBufferToCubicSegments(sp.fromBuf, sp.flags, sp.pointCount, sp.closed),
          toSegs: preparedBufferToCubicSegments(sp.toBuf, sp.flags, sp.pointCount, sp.closed),
        })),
      ],
    });
  }
  if (rawPairs.length === 0) return null;

  const maxContourCount = Math.max(...rawPairs.map((p) => p.contours.length));
  const maxSegsPerContour = new Array<number>(maxContourCount).fill(1);
  for (const p of rawPairs) {
    for (let c = 0; c < p.contours.length; c += 1) {
      maxSegsPerContour[c] = Math.max(maxSegsPerContour[c], p.contours[c].fromSegs.length);
    }
  }

  const alignedPairs = rawPairs.map((p) => {
    const alignedContours: Array<{ closed: boolean; fromSegs: CubicSegment[]; toSegs: CubicSegment[] }> = [];
    for (let c = 0; c < maxContourCount; c += 1) {
      const existing = p.contours[c];
      if (existing) {
        const elevated = elevateSegmentPairToCount(existing.fromSegs, existing.toSegs, maxSegsPerContour[c]);
        alignedContours.push({
          closed: existing.closed,
          fromSegs: elevated.from,
          toSegs: elevated.to,
        });
      } else {
        // Synthesize collapsed zero-area contour matching primary center for consistent SMIL topology
        const base = p.contours[0];
        const collapsedFrom = elevateSegmentPairToCount(
          buildCollapsedCubicSegments(base.fromSegs),
          buildCollapsedCubicSegments(base.toSegs),
          maxSegsPerContour[c],
        );
        alignedContours.push({
          closed: true,
          fromSegs: collapsedFrom.from,
          toSegs: collapsedFrom.to,
        });
      }
    }
    return {
      t0: p.t0,
      t1: p.t1,
      easing: p.easing,
      contours: alignedContours,
    };
  });

  const serializeAlignedFrame = (
    contours: readonly { closed: boolean; fromSegs: CubicSegment[]; toSegs: CubicSegment[] }[],
    t: number,
  ): string => {
    const evaluated = contours.map((c) => ({
      closed: c.closed,
      segs: t <= 0 ? c.fromSegs : t >= 1 ? c.toSegs : lerpCubicSegments(c.fromSegs, c.toSegs, t),
    }));
    return serializeMultiContourCubicSegmentsToSvgD(evaluated, offsetX, offsetY);
  };

  const values: string[] = [];
  const keyTimes: number[] = [];

  const pushFrame = (ratio: number, d: string) => {
    const clamped = Math.max(0, Math.min(1, Math.round(ratio * 10000) / 10000));
    if (keyTimes.length > 0) {
      const prev = keyTimes[keyTimes.length - 1];
      if (clamped <= prev) {
        if (values[values.length - 1] === d) return;
        const nudged = Math.min(1, Math.round((prev + 0.0001) * 10000) / 10000);
        if (nudged > prev) {
          keyTimes.push(nudged);
          values.push(d);
        } else {
          values[values.length - 1] = d;
        }
        return;
      }
    }
    keyTimes.push(clamped);
    values.push(d);
  };

  const firstD = serializeAlignedFrame(alignedPairs[0].contours, 0);
  if (alignedPairs[0].t0 > 0) {
    pushFrame(0, firstD);
  }

  for (let pIdx = 0; pIdx < alignedPairs.length; pIdx += 1) {
    const seg = alignedPairs[pIdx];
    const spanMs = Math.max(0, seg.t1 - seg.t0);
    const startD = serializeAlignedFrame(seg.contours, 0);

    if (spanMs <= 0) {
      pushFrame(seg.t0 / durationMs, startD);
      const endD = serializeAlignedFrame(seg.contours, 1);
      pushFrame(seg.t1 / durationMs, endD);
      continue;
    }

    const isSampledEasing = needsSmilSampling(seg.easing);
    const isLinear = seg.easing === 'linear';
    const steps = isSampledEasing
      ? Math.max(14, Math.min(48, Math.round((spanMs / 1000) * 32)))
      : isLinear
        ? Math.max(2, Math.min(8, Math.round((spanMs / 1000) * 6)))
        : Math.max(10, Math.min(28, Math.round((spanMs / 1000) * 20)));

    pushFrame(seg.t0 / durationMs, startD);
    const actualStartRatio = keyTimes[keyTimes.length - 1];
    const targetEndRatio = Math.max(actualStartRatio, seg.t1 / durationMs);

    for (let s = 1; s <= steps; s += 1) {
      const raw = s / steps;
      const eased = evaluateEasing(seg.easing, raw);
      const ratio = actualStartRatio + (targetEndRatio - actualStartRatio) * raw;
      pushFrame(ratio, serializeAlignedFrame(seg.contours, eased));
    }
  }

  if (keyTimes[keyTimes.length - 1] < 1) {
    pushFrame(1, values[values.length - 1]);
  }
  if (keyTimes[0] !== 0) {
    keyTimes[0] = 0;
  }
  if (keyTimes[keyTimes.length - 1] !== 1) {
    keyTimes[keyTimes.length - 1] = 1;
  }

  const animateMarkup =
    `<animate attributeName="d" dur="${durStr}" ${repeatAttr} calcMode="linear"` +
    ` keyTimes="${keyTimes.map(fmtKeyTime).join(';')}"` +
    ` values="${escapeXmlAttr(values.join(';'))}" />`;
  return {
    initialD: values[0],
    animateMarkup,
  };
}

interface SmilSeries {
  values: string;
  keyTimes: string;
  keySplines?: string;
  calcMode: 'spline' | 'linear';
}

function buildSampledTimestamps(durationMs: number, extraTimes: readonly number[], fps = 30): number[] {
  const sampleCount = Math.max(16, Math.min(64, Math.round((durationMs / 1000) * fps)));
  const set = new Set<number>([0, durationMs]);
  for (let i = 1; i < sampleCount; i += 1) {
    set.add(Math.round((i / sampleCount) * durationMs));
  }
  for (const t of extraTimes) {
    if (Number.isFinite(t)) {
      set.add(Math.max(0, Math.min(durationMs, Math.round(t))));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function normalizeColorTrackValue(
  raw: string,
  partnerHex: string,
): string {
  if (isTransparentColor(raw)) {
    return formatColorWithAlpha(partnerHex, 0);
  }
  return raw;
}

function findPartnerHexForColorTrack(track: AnimationTrack): string {
  for (const kf of track.keyframes) {
    const s = String(kf.value);
    if (!isTransparentColor(s) && s !== 'none') {
      return parseColorWithAlpha(s, '#000000').hex;
    }
  }
  return '#000000';
}

function buildTrackSmilSeries(
  track: AnimationTrack,
  clip: AnimationClip,
  formatVal: (val: number | string) => string,
  options?: { isColor?: boolean },
): SmilSeries | null {
  const sorted = sortKeyframes(track.keyframes);
  if (sorted.length === 0) return null;
  const durationMs = Math.max(100, clip.durationMs);

  // Single keyframe: emit constant hold so static SVG matches evaluated pose at t=0
  if (sorted.length === 1) {
    const v = formatVal(sorted[0].value);
    return {
      values: `${v};${v}`,
      keyTimes: '0;1',
      calcMode: 'linear',
    };
  }

  const partnerHex = options?.isColor ? findPartnerHexForColorTrack(track) : '#000000';
  const hasTransparentColor = options?.isColor && sorted.some((kf) => isTransparentColor(String(kf.value)));
  const requiresSampling =
    hasTransparentColor ||
    sorted.some((kf, idx) => idx > 0 && needsSmilSampling(kf.easing));

  if (requiresSampling) {
    const timestamps = buildSampledTimestamps(
      durationMs,
      sorted.map((kf) => kf.timeMs),
      30,
    );
    const vals: string[] = [];
    const times: string[] = [];
    for (const t of timestamps) {
      const evaluated = evaluateTrackAtTime(track, t) ?? sorted[0].value;
      const formatted = options?.isColor
        ? formatVal(normalizeColorTrackValue(String(evaluated), partnerHex))
        : formatVal(evaluated);
      vals.push(formatted);
      times.push(fmtKeyTime(t / durationMs));
    }
    return { values: vals.join(';'), keyTimes: times.join(';'), calcMode: 'linear' };
  }

  const vals: string[] = [];
  const times: string[] = [];
  const splines: string[] = [];

  const firstRatio = Math.max(0, Math.min(1, sorted[0].timeMs / durationMs));
  if (firstRatio > 0.0001) {
    vals.push(formatVal(sorted[0].value));
    times.push('0');
    splines.push('0 0 1 1');
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const kf = sorted[i];
    const ratio = Math.max(0, Math.min(1, kf.timeMs / durationMs));
    const ratioStr = fmtKeyTime(ratio);
    if (times.length > 0 && ratioStr === times[times.length - 1]) {
      vals[vals.length - 1] = formatVal(kf.value);
      continue;
    }
    vals.push(formatVal(kf.value));
    times.push(ratioStr);
    if (i > 0) {
      splines.push(formatEasingKeySpline(kf.easing));
    }
  }
  const lastRatio = Math.max(0, Math.min(1, sorted[sorted.length - 1].timeMs / durationMs));
  if (lastRatio < 0.9999) {
    vals.push(formatVal(sorted[sorted.length - 1].value));
    times.push('1');
    splines.push('0 0 1 1');
  }

  while (splines.length < vals.length - 1) splines.push('0 0 1 1');
  while (splines.length > vals.length - 1) splines.pop();

  if (vals.length < 2) {
    return {
      values: `${vals[0]};${vals[0]}`,
      keyTimes: '0;1',
      calcMode: 'linear',
    };
  }

  return {
    values: vals.join(';'),
    keyTimes: times.join(';'),
    keySplines: splines.join(';'),
    calcMode: 'spline',
  };
}

function buildSmilAttrTag(
  tagName: 'animate' | 'animateTransform',
  attrs: string,
  series: SmilSeries,
  clip: AnimationClip,
): string {
  const durStr = `${fmtNum(Math.max(100, clip.durationMs) / 1000)}s`;
  const repeatAttr = clip.loop ? 'repeatCount="indefinite"' : 'repeatCount="1" fill="freeze"';
  const splineAttr =
    series.calcMode === 'spline' && series.keySplines
      ? ` keySplines="${series.keySplines}"`
      : '';
  return `<${tagName} ${attrs} dur="${durStr}" ${repeatAttr} calcMode="${series.calcMode}" keyTimes="${series.keyTimes}"${splineAttr} values="${escapeXmlAttr(series.values)}" />`;
}

function seriesHasVariation(values: readonly string[]): boolean {
  if (values.length <= 1) return false;
  const first = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== first) return true;
  }
  return false;
}

export interface NodeSvgAnimationBundle {
  /** Wrapper `<animate>` / `<animateTransform>` tags applied to a `<g>` enclosing the node. */
  readonly wrapperSmilMarkup: string;
  /** Optional shape-level attribute animations (`fill`, `stroke`, `stroke-width`, `rx`). */
  readonly shapeSmilMarkup: string;
  /** Optional `pathMorph` replacement `<path d="...">` + `<animate attributeName="d">` markup. */
  readonly morphSmil: SvgMorphTrackSmilResult | null;
  /**
   * When true, `wrapperSmilMarkup` already encodes the full world `translate -> rotate -> scale`
   * transform chain, so the caller MUST omit the static `transform="rotate(...)"` attribute on
   * the same `<g>` to avoid double-rotation or translating along rotated local axes.
   */
  readonly replacesStaticTransform?: boolean;
  /**
   * When true, a `fill` animation track overrides static gradient/multi-fill paints, so
   * `<path>` / `<rect>` / `<ellipse>` should start with a solid color rather than `url(#grad)`.
   */
  readonly overridesStaticFill?: boolean;
  /** Initial solid fill color at `t = 0` when `overridesStaticFill` is true. */
  readonly initialSolidFill?: string;
}

function collectAncestorChain(
  node: DesignNode,
  allNodes: readonly DesignNode[] | undefined,
): DesignNode[] {
  if (!allNodes || allNodes.length === 0 || !node.parentId) return [];
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const chain: DesignNode[] = [];
  const seen = new Set<string>([node.id]);
  let cur: DesignNode | undefined = node;
  while (cur?.parentId && !seen.has(cur.parentId)) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    seen.add(parent.id);
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

/**
 * Compiles all animation tracks targeting `node` (plus any inherited motion from
 * animated parent Groups/Frames when `allNodes` is provided) into native SVG SMIL markup.
 */
export function buildNodeSvgSmilAnimations(
  node: DesignNode,
  clip: AnimationClip | null | undefined,
  allNodes?: readonly DesignNode[],
): NodeSvgAnimationBundle | null {
  if (!clip || (clip.tracks.length === 0 && (!clip.motionPaths || clip.motionPaths.length === 0))) return null;
  const nodeTracks = clip.tracks.filter((t) => t.targetNodeId === node.id && t.keyframes.length > 0);
  const nodeMotionPath = (clip.motionPaths ?? []).find(
    (mp) => mp.targetNodeId === node.id && mp.points.length >= 2,
  );
  const ancestors = collectAncestorChain(node, allNodes);
  const ancestorIdSet = new Set(ancestors.map((a) => a.id));
  const ancestorTracks = ancestors.length > 0
    ? clip.tracks.filter((t) => ancestorIdSet.has(t.targetNodeId) && t.keyframes.length > 0)
    : [];
  const hasAncestorMotionPath = ancestors.length > 0
    ? (clip.motionPaths ?? []).some((mp) => ancestorIdSet.has(mp.targetNodeId) && mp.points.length >= 2)
    : false;

  if (nodeTracks.length === 0 && !nodeMotionPath && ancestorTracks.length === 0 && !hasAncestorMotionPath) return null;

  const trackByProp = new Map<AnimatableProperty, AnimationTrack>();
  for (const tr of nodeTracks) {
    trackByProp.set(tr.property, tr);
  }

  const wrapperTags: string[] = [];
  const shapeTags: string[] = [];
  let morphSmil: SvgMorphTrackSmilResult | null = null;
  let replacesStaticTransform = false;

  // 1. Shape Morph (`pathMorph`)
  const morphTrack = trackByProp.get('pathMorph');
  if (morphTrack) {
    morphSmil = buildSvgPathMorphSmil(morphTrack, clip, node.x, node.y);
  }

  const xTrack = nodeMotionPath ? undefined : trackByProp.get('x');
  const yTrack = nodeMotionPath ? undefined : trackByProp.get('y');
  const widthTrack = trackByProp.get('width');
  const heightTrack = trackByProp.get('height');
  const rotTrack = trackByProp.get('rotation');
  const scaleTrack = trackByProp.get('scale');
  const opacityTrack = trackByProp.get('opacity');

  const hasDirectBoxResize =
    !morphSmil &&
    (node.type === 'rect' || node.type === 'frame') &&
    Boolean(widthTrack || heightTrack) &&
    !scaleTrack &&
    !rotTrack &&
    Math.abs(node.rotation || 0) < 0.01 &&
    ancestorTracks.length === 0;

  const hasAnimatedAncestorTransformOrOpacity = ancestorTracks.some(
    (t) =>
      t.property === 'x' ||
      t.property === 'y' ||
      t.property === 'width' ||
      t.property === 'height' ||
      t.property === 'rotation' ||
      t.property === 'scale' ||
      t.property === 'opacity',
  );

  const hasNonRectResize = Boolean(widthTrack || heightTrack) && !hasDirectBoxResize;
  const hasStaticRotation = Math.abs(node.rotation || 0) > 0.01;
  const hasTransformTracks = Boolean(xTrack || yTrack || rotTrack || scaleTrack || hasNonRectResize);

  // Use exact evaluator-driven world transform sampling whenever:
  // - An ancestor Group/Frame animates transform or opacity, OR
  // - Non-rect width/height or combined width/height + scale/rotation animates, OR
  // - Static rotation coexists with animated translate/scale/resize, OR
  // - Combined x + y or any transform track uses overshoot/spring/bounce/elastic/multi-point easing
  const transformTracks = [xTrack, yTrack, widthTrack, heightTrack, rotTrack, scaleTrack].filter(
    (t): t is AnimationTrack => Boolean(t),
  );
  const transformNeedsEvaluatorSampling =
    Boolean(nodeMotionPath) ||
    hasAncestorMotionPath ||
    hasAnimatedAncestorTransformOrOpacity ||
    hasNonRectResize ||
    (hasStaticRotation && hasTransformTracks) ||
    Boolean(xTrack && yTrack) ||
    transformTracks.some((tr) => tr.keyframes.some((kf, i) => i > 0 && needsSmilSampling(kf.easing)));

  const durationMs = Math.max(100, clip.durationMs);
  const baseCx = node.x + node.width / 2;
  const baseCy = node.y + node.height / 2;
  const baseW = Math.max(1, node.width);
  const baseH = Math.max(1, node.height);

  if (transformNeedsEvaluatorSampling) {
    const miniDoc: FolioDocument = {
      id: 'smil-eval',
      name: 'smil-eval',
      width: 1000,
      height: 1000,
      background: 'transparent',
      nodes: [...ancestors, node],
    };
    const relevantTracks = [...nodeTracks, ...ancestorTracks];
    const extraTimes: number[] = [];
    for (const tr of relevantTracks) {
      for (const kf of tr.keyframes) {
        extraTimes.push(kf.timeMs);
      }
    }
    if (nodeMotionPath?.pathKeyframes) {
      for (const pkf of nodeMotionPath.pathKeyframes) {
        extraTimes.push(pkf.timeMs);
      }
    }
    for (const mp of clip.motionPaths ?? []) {
      if (ancestorIdSet.has(mp.targetNodeId) && mp.pathKeyframes) {
        for (const pkf of mp.pathKeyframes) {
          extraTimes.push(pkf.timeMs);
        }
      }
    }
    const timestamps = buildSampledTimestamps(durationMs, extraTimes, 30);

    const translateVals: string[] = [];
    const rotateVals: string[] = [];
    const scaleOriginVals: string[] = [];
    const scaleVals: string[] = [];
    const opacityVals: string[] = [];
    const keyTimes: string[] = [];

    for (const t of timestamps) {
      const poses = evaluateClipAtTime(clip, t);
      const evalDoc = applyAnimatedPosesToDocument(miniDoc, poses);
      const evalNode = evalDoc.nodes[evalDoc.nodes.length - 1];
      const evalCx = evalNode.x + evalNode.width / 2;
      const evalCy = evalNode.y + evalNode.height / 2;
      const dx = evalCx - baseCx;
      const dy = evalCy - baseCy;
      const rot = evalNode.rotation || 0;
      const sx = Math.max(0.001, evalNode.width / baseW);
      const sy = Math.max(0.001, evalNode.height / baseH);

      translateVals.push(`${fmtNum(dx)} ${fmtNum(dy)}`);
      rotateVals.push(`${fmtNum(rot)} ${fmtNum(baseCx)} ${fmtNum(baseCy)}`);
      scaleOriginVals.push(`${fmtNum(baseCx * (1 - sx))} ${fmtNum(baseCy * (1 - sy))}`);
      scaleVals.push(`${fmtNum(sx)} ${fmtNum(sy)}`);
      opacityVals.push(fmtNum(Math.max(0, Math.min(1, evalNode.opacity))));
      keyTimes.push(fmtKeyTime(t / durationMs));
    }

    const keyTimesStr = keyTimes.join(';');
    const hasTranslate =
      seriesHasVariation(translateVals) || translateVals[0] !== '0 0';
    const hasRotate =
      seriesHasVariation(rotateVals) ||
      Math.abs((node.rotation || 0)) > 0.01 ||
      !rotateVals[0].startsWith('0 ');
    const hasScale =
      seriesHasVariation(scaleVals) || scaleVals[0] !== '1 1';
    const hasOpacity =
      Boolean(opacityTrack || ancestorTracks.some((t) => t.property === 'opacity')) &&
      (seriesHasVariation(opacityVals) || Number(opacityVals[0]) !== node.opacity);

    // Emit in exact world order: translate(world) * rotate(about base center) * scale(about base center)
    if (hasTranslate) {
      wrapperTags.push(
        buildSmilAttrTag(
          'animateTransform',
          'attributeName="transform" type="translate" additive="sum"',
          { values: translateVals.join(';'), keyTimes: keyTimesStr, calcMode: 'linear' },
          clip,
        ),
      );
    }
    if (hasRotate) {
      replacesStaticTransform = true;
      wrapperTags.push(
        buildSmilAttrTag(
          'animateTransform',
          'attributeName="transform" type="rotate" additive="sum"',
          { values: rotateVals.join(';'), keyTimes: keyTimesStr, calcMode: 'linear' },
          clip,
        ),
      );
    }
    if (hasScale) {
      wrapperTags.push(
        buildSmilAttrTag(
          'animateTransform',
          'attributeName="transform" type="translate" additive="sum"',
          { values: scaleOriginVals.join(';'), keyTimes: keyTimesStr, calcMode: 'linear' },
          clip,
        ),
      );
      wrapperTags.push(
        buildSmilAttrTag(
          'animateTransform',
          'attributeName="transform" type="scale" additive="sum"',
          { values: scaleVals.join(';'), keyTimes: keyTimesStr, calcMode: 'linear' },
          clip,
        ),
      );
    }
    if (hasOpacity) {
      wrapperTags.push(
        buildSmilAttrTag(
          'animate',
          'attributeName="opacity"',
          { values: opacityVals.join(';'), keyTimes: keyTimesStr, calcMode: 'linear' },
          clip,
        ),
      );
    }
  } else {
    // Clean spline fast-path (no animated ancestors, no static rotation conflict, spline-safe easings)
    if (xTrack) {
      const series = buildTrackSmilSeries(xTrack, clip, (v) => `${fmtNum(Number(v) - node.x)} 0`);
      if (series) {
        wrapperTags.push(
          buildSmilAttrTag('animateTransform', 'attributeName="transform" type="translate" additive="sum"', series, clip),
        );
      }
    } else if (yTrack) {
      const series = buildTrackSmilSeries(yTrack, clip, (v) => `0 ${fmtNum(Number(v) - node.y)}`);
      if (series) {
        wrapperTags.push(
          buildSmilAttrTag('animateTransform', 'attributeName="transform" type="translate" additive="sum"', series, clip),
        );
      }
    }

    if (rotTrack) {
      const cx = fmtNum(baseCx);
      const cy = fmtNum(baseCy);
      replacesStaticTransform = true;
      const series = buildTrackSmilSeries(rotTrack, clip, (v) => `${fmtNum(Number(v))} ${cx} ${cy}`);
      if (series) {
        wrapperTags.push(
          buildSmilAttrTag('animateTransform', 'attributeName="transform" type="rotate" additive="sum"', series, clip),
        );
      }
    }

    if (scaleTrack) {
      const series = buildTrackSmilSeries(scaleTrack, clip, (v) => {
        const s = Math.max(0.01, Number(v));
        return `${fmtNum(s)} ${fmtNum(s)}`;
      });
      if (series) {
        const translateSeries = buildTrackSmilSeries(scaleTrack, clip, (v) => {
          const s = Math.max(0.01, Number(v));
          return `${fmtNum(baseCx * (1 - s))} ${fmtNum(baseCy * (1 - s))}`;
        });
        if (translateSeries) {
          wrapperTags.push(
            buildSmilAttrTag('animateTransform', 'attributeName="transform" type="translate" additive="sum"', translateSeries, clip),
          );
        }
        wrapperTags.push(
          buildSmilAttrTag('animateTransform', 'attributeName="transform" type="scale" additive="sum"', series, clip),
        );
      }
    }

    if (opacityTrack) {
      const series = buildTrackSmilSeries(opacityTrack, clip, (v) => fmtNum(Math.max(0, Math.min(1, Number(v)))));
      if (series) {
        wrapperTags.push(buildSmilAttrTag('animate', 'attributeName="opacity"', series, clip));
      }
    }
  }

  // 6. Shape-level attributes (`fill`, `stroke`, `strokeWidth`, `radius`, direct `width`/`height`)
  let overridesStaticFill = false;
  let initialSolidFill: string | undefined;

  const fillTrack = trackByProp.get('fill');
  if (fillTrack) {
    const partnerHex = findPartnerHexForColorTrack(fillTrack);
    const series = buildTrackSmilSeries(fillTrack, clip, (v) => normalizeColorTrackValue(String(v), partnerHex), {
      isColor: true,
    });
    if (series) {
      shapeTags.push(buildSmilAttrTag('animate', 'attributeName="fill"', series, clip));
      overridesStaticFill = true;
      initialSolidFill = normalizeColorTrackValue(
        String(evaluateTrackAtTime(fillTrack, 0) ?? fillTrack.keyframes[0].value),
        partnerHex,
      );
    }
  }
  const strokeTrack = trackByProp.get('stroke');
  if (strokeTrack) {
    const partnerHex = findPartnerHexForColorTrack(strokeTrack);
    const series = buildTrackSmilSeries(strokeTrack, clip, (v) => normalizeColorTrackValue(String(v), partnerHex), {
      isColor: true,
    });
    if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="stroke"', series, clip));
  }
  const strokeWTrack = trackByProp.get('strokeWidth');
  if (strokeWTrack) {
    const series = buildTrackSmilSeries(strokeWTrack, clip, (v) => fmtNum(Math.max(0, Number(v))));
    if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="stroke-width"', series, clip));
  }
  if (!morphSmil && (node.type === 'rect' || node.type === 'frame')) {
    const radiusTrack = trackByProp.get('radius');
    if (radiusTrack) {
      const series = buildTrackSmilSeries(radiusTrack, clip, (v) => fmtNum(Math.max(0, Number(v))));
      if (series) {
        shapeTags.push(buildSmilAttrTag('animate', 'attributeName="rx"', series, clip));
        shapeTags.push(buildSmilAttrTag('animate', 'attributeName="ry"', series, clip));
      }
    }
    if (hasDirectBoxResize) {
      if (widthTrack) {
        const series = buildTrackSmilSeries(widthTrack, clip, (v) => fmtNum(Math.max(1, Number(v))));
        if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="width"', series, clip));
      }
      if (heightTrack) {
        const series = buildTrackSmilSeries(heightTrack, clip, (v) => fmtNum(Math.max(1, Number(v))));
        if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="height"', series, clip));
      }
    }
  }

  // 7. Trim Path SMIL (`stroke-dasharray`, `stroke-dashoffset`, `stroke-opacity`)
  const trimStartTrack = trackByProp.get('trimStart');
  const trimEndTrack = trackByProp.get('trimEnd');
  const trimOffsetTrack = trackByProp.get('trimOffset');
  if (
    (trimStartTrack || trimEndTrack || trimOffsetTrack) &&
    (node.type === 'path' || node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse')
  ) {
    const contourLengths = getNodeContourLengths(node);
    const totalLen = contourLengths.reduce((acc, l) => acc + l, 0);
    if (totalLen > 0.01) {
      const trimMode: TrimPathMode =
        trimStartTrack?.trimMode ??
        trimEndTrack?.trimMode ??
        trimOffsetTrack?.trimMode ??
        ('style' in node && 'trimMode' in node.style ? node.style.trimMode : undefined) ??
        'simultaneous';
      const trimExtraTimes: number[] = [];
      for (const tr of [trimStartTrack, trimEndTrack, trimOffsetTrack]) {
        if (!tr) continue;
        for (const kf of tr.keyframes) trimExtraTimes.push(kf.timeMs);
      }
      const trimTimestamps = buildSampledTimestamps(durationMs, trimExtraTimes, 30);
      const baseS = 'style' in node && 'trimStart' in node.style ? (node.style.trimStart ?? 0) : 0;
      const baseE = 'style' in node && 'trimEnd' in node.style ? (node.style.trimEnd ?? 100) : 100;
      const baseO = 'style' in node && 'trimOffset' in node.style ? (node.style.trimOffset ?? 0) : 0;
      const dashVals: string[] = [];
      const offsetVals: string[] = [];
      const opVals: string[] = [];
      const ktVals: string[] = [];
      for (const t of trimTimestamps) {
        const sVal = trimStartTrack ? Number(evaluateTrackAtTime(trimStartTrack, t) ?? baseS) : baseS;
        const eVal = trimEndTrack ? Number(evaluateTrackAtTime(trimEndTrack, t) ?? baseE) : baseE;
        const oVal = trimOffsetTrack ? Number(evaluateTrackAtTime(trimOffsetTrack, t) ?? baseO) : baseO;
        const intervals = computeContourTrimIntervals([totalLen], sVal, eVal, oVal, trimMode)[0] ?? [];
        const dash = intervalsToSvgStrokeDash(totalLen, intervals);
        dashVals.push(dash.full ? `${fmtNum(totalLen)} ${fmtNum(totalLen + 4)}` : (dash.dasharray ?? `0 ${fmtNum(totalLen + 4)}`));
        offsetVals.push(fmtNum(dash.full ? 0 : (dash.dashoffset ?? 0)));
        opVals.push(dash.visible ? '1' : '0');
        ktVals.push(fmtKeyTime(t / durationMs));
      }
      const ktStr = ktVals.join(';');
      shapeTags.push(
        buildSmilAttrTag('animate', 'attributeName="stroke-dasharray"', { values: dashVals.join(';'), keyTimes: ktStr, calcMode: 'linear' }, clip),
        buildSmilAttrTag('animate', 'attributeName="stroke-dashoffset"', { values: offsetVals.join(';'), keyTimes: ktStr, calcMode: 'linear' }, clip),
        buildSmilAttrTag('animate', 'attributeName="stroke-opacity"', { values: opVals.join(';'), keyTimes: ktStr, calcMode: 'linear' }, clip),
      );
    }
  }

  if (wrapperTags.length === 0 && shapeTags.length === 0 && !morphSmil) return null;

  return {
    wrapperSmilMarkup: wrapperTags.join(''),
    shapeSmilMarkup: shapeTags.join(''),
    morphSmil,
    replacesStaticTransform,
    overridesStaticFill,
    initialSolidFill,
  };
}

/**
 * Computes the effective animation duration (ms) for a page, considering BOTH
 * the selected page clip AND any animated Component Instances placed on the page
 * (including nested animated components).
 */
export function getEffectivePageAnimationDurationMs(
  project: FolioProject,
  page: FolioPage,
  selectedClip: AnimationClip | null,
): number {
  const clipHasAnim = (c: AnimationClip | null) =>
    Boolean(c && (c.tracks.length > 0 || (c.motionPaths !== undefined && c.motionPaths.length > 0)));
  let maxDuration = clipHasAnim(selectedClip) ? selectedClip!.durationMs : 0;
  const componentById = new Map<string, ComponentDefinition>(
    project.components.map((c) => [c.id, c]),
  );

  const visitNodes = (nodes: readonly DesignNode[], visited: Set<string>, depth: number) => {
    if (depth > 12) return;
    for (const node of nodes) {
      if (node.type !== 'component-instance') continue;
      if (visited.has(node.componentId)) continue;
      const comp = componentById.get(node.componentId);
      if (!comp) continue;
      if (comp.animations && comp.animations.length > 0) {
        for (const cClip of comp.animations) {
          if (clipHasAnim(cClip) && cClip.durationMs > maxDuration) {
            maxDuration = cClip.durationMs;
          }
        }
      }
      const nextVisited = new Set(visited);
      nextVisited.add(node.componentId);
      visitNodes(comp.document.nodes, nextVisited, depth + 1);
    }
  };

  visitNodes(page.document.nodes, new Set<string>(), 0);
  return maxDuration > 0 ? maxDuration : (selectedClip?.durationMs ?? 1200);
}

/**
 * Checks whether a document (or any nested Component Instance inside it) has
 * active animations.
 */
export function documentHasAnyAnimations(
  nodes: readonly DesignNode[],
  components: readonly ComponentDefinition[],
  pageClip?: AnimationClip | null,
): boolean {
  const clipIsAnimated = (c: AnimationClip | null | undefined) =>
    Boolean(
      c &&
        (c.tracks.some((t) => t.keyframes.length >= 2) ||
          (c.motionPaths !== undefined && c.motionPaths.some((mp) => mp.points.length >= 2))),
    );
  if (clipIsAnimated(pageClip)) return true;
  const componentById = new Map(components.map((c) => [c.id, c]));
  const visit = (list: readonly DesignNode[], visited: Set<string>, depth: number): boolean => {
    if (depth > 12) return false;
    for (const node of list) {
      if (node.type !== 'component-instance') continue;
      if (visited.has(node.componentId)) continue;
      const comp = componentById.get(node.componentId);
      if (!comp) continue;
      if (comp.animations?.some((clip) => clipIsAnimated(clip))) {
        return true;
      }
      const next = new Set(visited);
      next.add(node.componentId);
      if (visit(comp.document.nodes, next, depth + 1)) return true;
    }
    return false;
  };
  return visit(nodes, new Set<string>(), 0);
}

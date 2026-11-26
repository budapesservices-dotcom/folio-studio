/**
 * FOLIO Native Animated SVG (SMIL) Generator.
 *
 * Emits self-contained, zero-JavaScript SVG SMIL (`<animate>`, `<animateTransform>`)
 * markup for both page-level animation clips and embedded animated components
 * (`component.animations`) so standalone `.svg` exports animate natively in every
 * modern browser (Chrome, Firefox, Safari, Edge).
 *
 * Supports:
 *   - Native Shape Morph (`pathMorph`) via `<animate attributeName="d" ... />`
 *     with topology-matched cubic Bezier contours (`M ... C ... Z`)
 *   - Transform tracks (`x`, `y`, `rotation`, `scale`) via `<animateTransform>`
 *   - Visual & box tracks (`opacity`, `fill`, `stroke`, `strokeWidth`, `width`, `height`, `radius`)
 *   - Accurate cubic-bezier `calcMode="spline"` `keySplines` and multi-point curve sampling
 */

import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationTrack,
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
} from '../../core/document/types';
import {
  evaluatePreparedMorphPairToAnchors,
  parsePathMorphSnapshot,
  prepareMorphPair,
} from '../../core/document/pathMorph';
import { easingToCubicBezier, evaluateEasing, isMultiPointEasing } from './easing';
import { evaluateTrackAtTime, sortKeyframes } from './evaluator';

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function fmtKeyTime(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  return String(Math.round(clamped * 10000) / 10000);
}

function formatEasingKeySpline(easing: AnimationEasing): string {
  const [x1, y1, x2, y2] = easingToCubicBezier(easing);
  // SMIL keySplines requires x1,x2 in [0,1]; y1,y2 can overshoot in modern browsers,
  // but clamping y softly to [-1.5, 2.5] avoids invalid parse rejection.
  const cx1 = Math.max(0, Math.min(1, x1));
  const cx2 = Math.max(0, Math.min(1, x2));
  const cy1 = Math.max(-1.5, Math.min(2.5, y1));
  const cy2 = Math.max(-1.5, Math.min(2.5, y2));
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
 * Raises a cubic segment list to `targetCount` segments by iteratively splitting
 * the longest segment via exact de Casteljau midpoint subdivision.
 * Guarantees every `values` entry in SMIL `<animate attributeName="d">` has
 * identical `M ... C ... Z` command topology!
 */
function elevateSegmentsToCount(segs: readonly CubicSegment[], targetCount: number): CubicSegment[] {
  const list = segs.map((s) => ({ ...s }));
  while (list.length > 0 && list.length < targetCount) {
    let bestIdx = 0;
    let bestLen = -1;
    for (let i = 0; i < list.length; i += 1) {
      const len = estimateSegmentLength(list[i]);
      if (len > bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    const [left, right] = splitCubicAtHalf(list[bestIdx]);
    list.splice(bestIdx, 1, left, right);
  }
  return list;
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

function buildPreparedBufferD(
  buf: Float64Array,
  pointCount: number,
  closed: boolean,
  offsetX = 0,
  offsetY = 0,
): string {
  if (pointCount < 2) return '';
  const STRIDE = 7;
  const parts: string[] = [`M ${fmtNum(buf[0] + offsetX)} ${fmtNum(buf[1] + offsetY)}`];
  const segCount = closed ? pointCount : pointCount - 1;
  for (let i = 0; i < segCount; i += 1) {
    const next = (i + 1) % pointCount;
    const bi = i * STRIDE;
    const bn = next * STRIDE;
    parts.push(
      `C ${fmtNum(buf[bi + 4] + offsetX)} ${fmtNum(buf[bi + 5] + offsetY)} ${fmtNum(buf[bn + 2] + offsetX)} ${fmtNum(buf[bn + 3] + offsetY)} ${fmtNum(buf[bn] + offsetX)} ${fmtNum(buf[bn + 1] + offsetY)}`,
    );
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

export interface SvgMorphTrackSmilResult {
  readonly initialD: string;
  readonly animateMarkup: string;
}

/**
 * Generates an initial `<path d="...">` string + SMIL `<animate attributeName="d">`
 * tag for a `pathMorph` track in node-global SVG coordinates (`+ node.x, + node.y`).
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

  // Single keyframe -> static path
  if (sorted.length === 1) {
    const snap = parsePathMorphSnapshot(String(sorted[0].value));
    if (!snap || snap.points.length < 2) return null;
    const segs = anchorsToCubicSegments(
      snap.points.map((p) => ({
        x: p.x,
        y: p.y,
        ...(p.hi ? { handleIn: { x: p.hi[0], y: p.hi[1] } } : {}),
        ...(p.ho ? { handleOut: { x: p.ho[0], y: p.ho[1] } } : {}),
      })),
      snap.closed,
    );
    return {
      initialD: serializeCubicSegmentsToSvgD(segs, snap.closed, offsetX, offsetY),
      animateMarkup: '',
    };
  }

  // Fast exact path: 2 keyframes with standard / cubic-bezier easing -> ultra-compact 120Hz native SMIL spline!
  if (sorted.length === 2 && !isMultiPointEasing(sorted[1].easing)) {
    const pair = prepareMorphPair(String(sorted[0].value), String(sorted[1].value));
    if (pair && pair.compatible) {
      const d0 = buildPreparedBufferD(pair.fromBuf, pair.pointCount, pair.closed, offsetX, offsetY);
      const d1 = buildPreparedBufferD(pair.toBuf, pair.pointCount, pair.closed, offsetX, offsetY);
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
      // keySplines must have exactly values.length - 1 entries
      while (keySplines.length > values.length - 1) keySplines.pop();

      const animateMarkup =
        `<animate attributeName="d" dur="${durStr}" ${repeatAttr} calcMode="spline"` +
        ` keyTimes="${keyTimes.join(';')}"` +
        ` keySplines="${keySplines.join(';')}"` +
        ` values="${escapeXmlAttr(values.join(';'))}" />`;
      return { initialD: d0, animateMarkup };
    }
  }

  // General path (3+ keyframes or custom multi-point curves):
  // Evaluate smooth frames across the clip and elevate all frames to ONE uniform
  // cubic segment count so every SMIL value has identical `M ... C ... Z` topology.
  const pairs: Array<{
    t0: number;
    t1: number;
    easing: AnimationEasing;
    pair: NonNullable<ReturnType<typeof prepareMorphPair>>;
  }> = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const prepared = prepareMorphPair(String(sorted[i].value), String(sorted[i + 1].value));
    if (!prepared || !prepared.compatible) continue;
    pairs.push({
      t0: sorted[i].timeMs,
      t1: sorted[i + 1].timeMs,
      easing: sorted[i + 1].easing,
      pair: prepared,
    });
  }
  if (pairs.length === 0) return null;

  const closed = pairs[0].pair.closed;
  const maxSegs = Math.max(...pairs.map((p) => (closed ? p.pair.pointCount : p.pair.pointCount - 1)));
  const sampleCount = Math.max(12, Math.min(72, Math.round((durationMs / 1000) * 24)));
  const values: string[] = [];
  const keyTimes: string[] = [];

  for (let s = 0; s <= sampleCount; s += 1) {
    const ratio = s / sampleCount;
    const tMs = ratio * durationMs;
    let active = pairs[pairs.length - 1];
    let localT = 1;
    if (tMs <= pairs[0].t0) {
      active = pairs[0];
      localT = 0;
    } else {
      for (const seg of pairs) {
        if (tMs >= seg.t0 && tMs <= seg.t1) {
          active = seg;
          const span = seg.t1 - seg.t0;
          const raw = span > 0 ? (tMs - seg.t0) / span : 1;
          localT = evaluateEasing(seg.easing, raw);
          break;
        }
      }
    }
    const anchors = evaluatePreparedMorphPairToAnchors(active.pair, localT);
    const segs = elevateSegmentsToCount(anchorsToCubicSegments(anchors, closed), maxSegs);
    values.push(serializeCubicSegmentsToSvgD(segs, closed, offsetX, offsetY));
    keyTimes.push(fmtKeyTime(ratio));
  }

  const animateMarkup =
    `<animate attributeName="d" dur="${durStr}" ${repeatAttr} calcMode="linear"` +
    ` keyTimes="${keyTimes.join(';')}"` +
    ` values="${escapeXmlAttr(values.join(';'))}" />`;
  return {
    initialD: values[0],
    animateMarkup,
  };
}

function buildTrackSmilSeries(
  track: AnimationTrack,
  clip: AnimationClip,
  formatVal: (val: number | string) => string,
): { values: string; keyTimes: string; keySplines?: string; calcMode: 'spline' | 'linear' } | null {
  const sorted = sortKeyframes(track.keyframes);
  if (sorted.length < 2) return null;
  const durationMs = Math.max(100, clip.durationMs);
  const hasMultiPoint = sorted.some((kf, idx) => idx > 0 && isMultiPointEasing(kf.easing));

  if (hasMultiPoint) {
    const samples = Math.max(16, Math.min(60, Math.round((durationMs / 1000) * 24)));
    const vals: string[] = [];
    const times: string[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const ratio = i / samples;
      const evaluated = evaluateTrackAtTime(track, ratio * durationMs);
      vals.push(formatVal(evaluated ?? sorted[0].value));
      times.push(fmtKeyTime(ratio));
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
    vals.push(formatVal(kf.value));
    times.push(fmtKeyTime(ratio));
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

  // Ensure monotonic keyTimes and exact spline count (vals.length - 1)
  while (splines.length < vals.length - 1) splines.push('0 0 1 1');
  while (splines.length > vals.length - 1) splines.pop();

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
  series: { values: string; keyTimes: string; keySplines?: string; calcMode: 'spline' | 'linear' },
  clip: AnimationClip,
): string {
  const durStr = `${fmtNum(Math.max(100, clip.durationMs) / 1000)}s`;
  const repeatAttr = clip.loop ? 'repeatCount="indefinite"' : 'repeatCount="1" fill="freeze"';
  const splineAttr = series.calcMode === 'spline' && series.keySplines
    ? ` keySplines="${series.keySplines}"`
    : '';
  return `<${tagName} ${attrs} dur="${durStr}" ${repeatAttr} calcMode="${series.calcMode}" keyTimes="${series.keyTimes}"${splineAttr} values="${escapeXmlAttr(series.values)}" />`;
}

export interface NodeSvgAnimationBundle {
  /** Wrapper `<animate>` / `<animateTransform>` tags applied to a `<g>` enclosing the node. */
  readonly wrapperSmilMarkup: string;
  /** Optional shape-level attribute animations (`fill`, `stroke`, `stroke-width`, `rx`). */
  readonly shapeSmilMarkup: string;
  /** Optional `pathMorph` replacement `<path d="...">` + `<animate attributeName="d">` markup. */
  readonly morphSmil: SvgMorphTrackSmilResult | null;
}

/**
 * Compiles all animation tracks targeting `node` in `clip` into native SVG SMIL markup.
 */
export function buildNodeSvgSmilAnimations(
  node: DesignNode,
  clip: AnimationClip | null | undefined,
): NodeSvgAnimationBundle | null {
  if (!clip || clip.tracks.length === 0) return null;
  const nodeTracks = clip.tracks.filter((t) => t.targetNodeId === node.id && t.keyframes.length > 0);
  if (nodeTracks.length === 0) return null;

  const trackByProp = new Map<AnimatableProperty, AnimationTrack>();
  for (const tr of nodeTracks) {
    trackByProp.set(tr.property, tr);
  }

  const wrapperTags: string[] = [];
  const shapeTags: string[] = [];
  let morphSmil: SvgMorphTrackSmilResult | null = null;

  // 1. Shape Morph (`pathMorph`)
  const morphTrack = trackByProp.get('pathMorph');
  if (morphTrack) {
    morphSmil = buildSvgPathMorphSmil(morphTrack, clip, node.x, node.y);
  }

  // 2. Translation delta (`x` / `y` relative to base node position)
  const xTrack = trackByProp.get('x');
  const yTrack = trackByProp.get('y');
  if ((xTrack && xTrack.keyframes.length >= 2) || (yTrack && yTrack.keyframes.length >= 2)) {
    const durationMs = Math.max(100, clip.durationMs);
    const timeSet = new Set<number>([0, durationMs]);
    xTrack?.keyframes.forEach((kf) => timeSet.add(Math.max(0, Math.min(durationMs, kf.timeMs))));
    yTrack?.keyframes.forEach((kf) => timeSet.add(Math.max(0, Math.min(durationMs, kf.timeMs))));
    const useSampled =
      Boolean(xTrack?.keyframes.some((kf, i) => i > 0 && isMultiPointEasing(kf.easing))) ||
      Boolean(yTrack?.keyframes.some((kf, i) => i > 0 && isMultiPointEasing(kf.easing))) ||
      (Boolean(xTrack) && Boolean(yTrack));

    if (useSampled) {
      const samples = Math.max(16, Math.min(48, Math.round((durationMs / 1000) * 24)));
      const vals: string[] = [];
      const times: string[] = [];
      for (let i = 0; i <= samples; i += 1) {
        const ratio = i / samples;
        const t = ratio * durationMs;
        const vx = xTrack ? Number(evaluateTrackAtTime(xTrack, t) ?? node.x) : node.x;
        const vy = yTrack ? Number(evaluateTrackAtTime(yTrack, t) ?? node.y) : node.y;
        vals.push(`${fmtNum(vx - node.x)} ${fmtNum(vy - node.y)}`);
        times.push(fmtKeyTime(ratio));
      }
      wrapperTags.push(
        buildSmilAttrTag(
          'animateTransform',
          'attributeName="transform" type="translate" additive="sum"',
          { values: vals.join(';'), keyTimes: times.join(';'), calcMode: 'linear' },
          clip,
        ),
      );
    } else if (xTrack) {
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
  }

  // 3. Rotation delta around node center (cx, cy)
  const rotTrack = trackByProp.get('rotation');
  if (rotTrack && rotTrack.keyframes.length >= 2) {
    const cx = fmtNum(node.x + node.width / 2);
    const cy = fmtNum(node.y + node.height / 2);
    const baseRot = node.rotation || 0;
    const series = buildTrackSmilSeries(rotTrack, clip, (v) => `${fmtNum(Number(v) - baseRot)} ${cx} ${cy}`);
    if (series) {
      wrapperTags.push(
        buildSmilAttrTag('animateTransform', 'attributeName="transform" type="rotate" additive="sum"', series, clip),
      );
    }
  }

  // 4. Scale around node center (cx, cy) via additive translate(cx,cy) -> scale(s) -> translate(-cx,-cy)
  const scaleTrack = trackByProp.get('scale');
  if (scaleTrack && scaleTrack.keyframes.length >= 2) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const series = buildTrackSmilSeries(scaleTrack, clip, (v) => {
      const s = Math.max(0.01, Number(v));
      return `${fmtNum(s)} ${fmtNum(s)}`;
    });
    if (series) {
      // Scale around center: translate(cx*(1-s), cy*(1-s)) + scale(s, s)
      const translateSeries = buildTrackSmilSeries(scaleTrack, clip, (v) => {
        const s = Math.max(0.01, Number(v));
        return `${fmtNum(cx * (1 - s))} ${fmtNum(cy * (1 - s))}`;
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

  // 5. Opacity
  const opacityTrack = trackByProp.get('opacity');
  if (opacityTrack && opacityTrack.keyframes.length >= 2) {
    const series = buildTrackSmilSeries(opacityTrack, clip, (v) => fmtNum(Math.max(0, Math.min(1, Number(v)))));
    if (series) {
      wrapperTags.push(buildSmilAttrTag('animate', 'attributeName="opacity"', series, clip));
    }
  }

  // 6. Shape-level attributes (`fill`, `stroke`, `strokeWidth`, `radius`, `width`, `height`)
  const fillTrack = trackByProp.get('fill');
  if (fillTrack && fillTrack.keyframes.length >= 2) {
    const series = buildTrackSmilSeries(fillTrack, clip, (v) => String(v));
    if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="fill"', series, clip));
  }
  const strokeTrack = trackByProp.get('stroke');
  if (strokeTrack && strokeTrack.keyframes.length >= 2) {
    const series = buildTrackSmilSeries(strokeTrack, clip, (v) => String(v));
    if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="stroke"', series, clip));
  }
  const strokeWTrack = trackByProp.get('strokeWidth');
  if (strokeWTrack && strokeWTrack.keyframes.length >= 2) {
    const series = buildTrackSmilSeries(strokeWTrack, clip, (v) => fmtNum(Math.max(0, Number(v))));
    if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="stroke-width"', series, clip));
  }
  if (!morphSmil && (node.type === 'rect' || node.type === 'frame')) {
    const radiusTrack = trackByProp.get('radius');
    if (radiusTrack && radiusTrack.keyframes.length >= 2) {
      const series = buildTrackSmilSeries(radiusTrack, clip, (v) => fmtNum(Math.max(0, Number(v))));
      if (series) {
        shapeTags.push(buildSmilAttrTag('animate', 'attributeName="rx"', series, clip));
        shapeTags.push(buildSmilAttrTag('animate', 'attributeName="ry"', series, clip));
      }
    }
    const widthTrack = trackByProp.get('width');
    if (widthTrack && widthTrack.keyframes.length >= 2) {
      const series = buildTrackSmilSeries(widthTrack, clip, (v) => fmtNum(Math.max(1, Number(v))));
      if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="width"', series, clip));
    }
    const heightTrack = trackByProp.get('height');
    if (heightTrack && heightTrack.keyframes.length >= 2) {
      const series = buildTrackSmilSeries(heightTrack, clip, (v) => fmtNum(Math.max(1, Number(v))));
      if (series) shapeTags.push(buildSmilAttrTag('animate', 'attributeName="height"', series, clip));
    }
  }

  if (wrapperTags.length === 0 && shapeTags.length === 0 && !morphSmil) return null;

  return {
    wrapperSmilMarkup: wrapperTags.join(''),
    shapeSmilMarkup: shapeTags.join(''),
    morphSmil,
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
  let maxDuration = selectedClip && selectedClip.tracks.length > 0 ? selectedClip.durationMs : 0;
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
          if (cClip.tracks.length > 0 && cClip.durationMs > maxDuration) {
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
  if (pageClip && pageClip.tracks.some((t) => t.keyframes.length >= 2)) return true;
  const componentById = new Map(components.map((c) => [c.id, c]));
  const visit = (list: readonly DesignNode[], visited: Set<string>, depth: number): boolean => {
    if (depth > 12) return false;
    for (const node of list) {
      if (node.type !== 'component-instance') continue;
      if (visited.has(node.componentId)) continue;
      const comp = componentById.get(node.componentId);
      if (!comp) continue;
      if (comp.animations?.some((clip) => clip.tracks.some((t) => t.keyframes.length >= 2))) {
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

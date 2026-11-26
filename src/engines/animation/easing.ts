import type {
  AnimationEasing,
  AnimationEasingPreset,
  CubicBezierEasing,
  MultiPointEasing,
  MultiPointEasingStop,
} from '../../core/document/types';

export type EasingPresetCategory = 'standard' | 'dynamic' | 'expressive';

export interface EasingPresetDescriptor {
  readonly id: AnimationEasingPreset;
  readonly label: string;
  readonly shortLabel: string;
  readonly category: EasingPresetCategory;
  /** Equivalent cubic-bezier control points when representable as a single cubic curve. */
  readonly bezier?: readonly [number, number, number, number];
}

export const EASING_PRESET_CATALOG: readonly EasingPresetDescriptor[] = Object.freeze([
  // Standard (legacy + CapCut Ease In/Out 1-3)
  { id: 'linear', label: 'Linear', shortLabel: 'Linear', category: 'standard', bezier: [0, 0, 1, 1] },
  { id: 'ease', label: 'Ease', shortLabel: 'Ease', category: 'standard', bezier: [0.25, 0.1, 0.25, 1] },
  { id: 'ease-in', label: 'Ease In', shortLabel: 'In', category: 'standard', bezier: [0.42, 0, 1, 1] },
  { id: 'ease-out', label: 'Ease Out', shortLabel: 'Out', category: 'standard', bezier: [0, 0, 0.58, 1] },
  { id: 'ease-in-out', label: 'Ease In-Out', shortLabel: 'In-Out', category: 'standard', bezier: [0.42, 0, 0.58, 1] },
  { id: 'ease-in-quad', label: 'Ease In 1 (Quad)', shortLabel: 'In 1', category: 'standard', bezier: [0.55, 0.085, 0.68, 0.53] },
  { id: 'ease-out-quad', label: 'Ease Out 1 (Quad)', shortLabel: 'Out 1', category: 'standard', bezier: [0.25, 0.46, 0.45, 0.94] },
  { id: 'ease-in-out-quad', label: 'In-Out 1 (Quad)', shortLabel: 'IO 1', category: 'standard', bezier: [0.455, 0.03, 0.515, 0.955] },
  { id: 'ease-in-cubic', label: 'Ease In 2 (Cubic)', shortLabel: 'In 2', category: 'standard', bezier: [0.55, 0.055, 0.675, 0.19] },
  { id: 'ease-out-cubic', label: 'Ease Out 2 (Cubic)', shortLabel: 'Out 2', category: 'standard', bezier: [0.215, 0.61, 0.355, 1] },
  { id: 'ease-in-out-cubic', label: 'In-Out 2 (Cubic)', shortLabel: 'IO 2', category: 'standard', bezier: [0.645, 0.045, 0.355, 1] },
  // Dynamic (CapCut aggressive velocity ramps)
  { id: 'ease-in-expo', label: 'Ease In 3 (Expo)', shortLabel: 'In 3', category: 'dynamic', bezier: [0.95, 0.05, 0.795, 0.035] },
  { id: 'ease-out-expo', label: 'Ease Out 3 (Expo)', shortLabel: 'Out 3', category: 'dynamic', bezier: [0.19, 1, 0.22, 1] },
  { id: 'ease-in-out-expo', label: 'In-Out 3 (Expo)', shortLabel: 'IO 3', category: 'dynamic', bezier: [1, 0, 0, 1] },
  { id: 'fast-slow-fast', label: 'Fast - Slow - Fast', shortLabel: 'F-S-F', category: 'dynamic', bezier: [0.15, 0.85, 0.85, 0.15] },
  { id: 'slow-fast-slow', label: 'Slow - Fast - Slow', shortLabel: 'S-F-S', category: 'dynamic', bezier: [0.85, 0.05, 0.15, 0.95] },
  // Expressive (Overshoot, Back, Spring, Bounce, Elastic)
  { id: 'overshoot-out', label: 'Overshoot Out', shortLabel: 'Overshoot', category: 'expressive', bezier: [0.34, 1.56, 0.64, 1] },
  { id: 'back-in-out', label: 'Back In-Out', shortLabel: 'Back IO', category: 'expressive', bezier: [0.68, -0.55, 0.265, 1.55] },
  { id: 'spring', label: 'Spring', shortLabel: 'Spring', category: 'expressive' },
  { id: 'bounce-out', label: 'Bounce Out', shortLabel: 'Bounce', category: 'expressive' },
  { id: 'elastic-out', label: 'Elastic Out', shortLabel: 'Elastic', category: 'expressive' },
]);

export const ANIMATION_EASINGS: readonly AnimationEasingPreset[] = Object.freeze(
  EASING_PRESET_CATALOG.map((item) => item.id),
);

export const ANIMATION_EASING_LABELS: Readonly<Record<AnimationEasingPreset, string>> = Object.freeze(
  EASING_PRESET_CATALOG.reduce(
    (acc, item) => {
      acc[item.id] = item.label;
      return acc;
    },
    {} as Record<AnimationEasingPreset, string>,
  ),
);

const PRESET_BY_ID = new Map<AnimationEasingPreset, EasingPresetDescriptor>(
  EASING_PRESET_CATALOG.map((item) => [item.id, item]),
);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  const r = Math.round(value * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function sampleCubic(a: number, b: number, c: number, u: number): number {
  return ((a * u + b) * u + c) * u;
}

function sampleCubicDerivative(a: number, b: number, c: number, u: number): number {
  return (3 * a * u + 2 * b) * u + c;
}

/**
 * High-precision CSS-spec Cubic Bezier timing solver (Newton-Raphson + binary search fallback).
 * Supports overshoot control points (`y1`, `y2` outside `[0, 1]`).
 */
export function solveCubicBezier(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const clamped = clamp01(t);
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;

  const px1 = clamp01(x1);
  const px2 = clamp01(x2);
  if (Math.abs(px1 - y1) < 1e-6 && Math.abs(px2 - y2) < 1e-6) {
    return clamped;
  }

  const cx = 3 * px1;
  const bx = 3 * (px2 - px1) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  // Solve x(u) = clamped using Newton-Raphson first
  let u = clamped;
  for (let i = 0; i < 8; i += 1) {
    const xErr = sampleCubic(ax, bx, cx, u) - clamped;
    if (Math.abs(xErr) < 1e-6) {
      return sampleCubic(ay, by, cy, u);
    }
    const dx = sampleCubicDerivative(ax, bx, cx, u);
    if (Math.abs(dx) < 1e-6) break;
    u -= xErr / dx;
  }

  // Fallback to guaranteed-convergent binary search on [0, 1]
  let lo = 0;
  let hi = 1;
  u = clamped;
  for (let i = 0; i < 20; i += 1) {
    const x = sampleCubic(ax, bx, cx, u);
    if (Math.abs(x - clamped) < 1e-6) break;
    if (clamped > x) lo = u;
    else hi = u;
    u = 0.5 * (lo + hi);
  }
  return sampleCubic(ay, by, cy, u);
}

/**
 * Normalizes a multi-point curve so endpoints lock to x=0 and x=1 and x values
 * remain strictly sorted in [0, 1].
 */
export function normalizeMultiPointStops(
  points: readonly MultiPointEasingStop[],
): MultiPointEasingStop[] {
  if (points.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }
  const sorted = [...points]
    .map((pt) => ({
      x: round3(clamp01(pt.x)),
      y: round3(Math.max(-2, Math.min(3, Number.isFinite(pt.y) ? pt.y : 0))),
    }))
    .sort((a, b) => a.x - b.x);

  if (sorted[0].x > 0.001) {
    sorted.unshift({ x: 0, y: 0 });
  } else {
    sorted[0] = { x: 0, y: sorted[0].y };
  }
  const lastIdx = sorted.length - 1;
  if (sorted[lastIdx].x < 0.999) {
    sorted.push({ x: 1, y: 1 });
  } else {
    sorted[lastIdx] = { x: 1, y: sorted[lastIdx].y };
  }
  return sorted;
}

/**
 * Evaluates a multi-point speed/progress curve using Fritsch-Carlson monotone
 * cubic Hermite interpolation (PCHIP) so interior handles transition smoothly
 * without ringing.
 */
export function evaluateMultiPointCurve(
  rawPoints: readonly MultiPointEasingStop[],
  t: number,
): number {
  const clamped = clamp01(t);
  const pts = normalizeMultiPointStops(rawPoints);
  const n = pts.length;
  if (n < 2) return clamped;
  if (clamped <= pts[0].x) return pts[0].y;
  if (clamped >= pts[n - 1].x) return pts[n - 1].y;

  // Locate segment [i, i + 1]
  let segIdx = 0;
  for (let i = 0; i < n - 1; i += 1) {
    if (clamped >= pts[i].x && clamped <= pts[i + 1].x) {
      segIdx = i;
      break;
    }
  }

  const h: number[] = new Array(n - 1);
  const delta: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    h[i] = Math.max(1e-5, pts[i + 1].x - pts[i].x);
    delta[i] = (pts[i + 1].y - pts[i].y) / h[i];
  }

  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  const dx = h[segIdx];
  const s = (clamped - pts[segIdx].x) / dx;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * pts[segIdx].y + h10 * dx * m[segIdx] + h01 * pts[segIdx + 1].y + h11 * dx * m[segIdx + 1];
}

function evaluateBounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  }
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

function evaluateElasticOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function evaluateSpring(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(t * Math.PI * 2.5);
}

/**
 * Evaluates a Folio easing definition at normalized progress `t ∈ [0, 1]`.
 * Expressive curves (`spring`, `elastic-out`, `overshoot-out`, custom overshoot)
 * may intentionally overshoot outside `[0, 1]`.
 */
export function evaluateEasing(easing: AnimationEasing, t: number): number {
  const clamped = clamp01(t);
  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      return solveCubicBezier(clamped, easing.p1[0], easing.p1[1], easing.p2[0], easing.p2[1]);
    }
    if (easing.type === 'multi-point') {
      return evaluateMultiPointCurve(easing.points, clamped);
    }
    return clamped;
  }

  switch (easing) {
    case 'linear':
      return clamped;
    case 'spring':
      return evaluateSpring(clamped);
    case 'bounce-out':
      return evaluateBounceOut(clamped);
    case 'elastic-out':
      return evaluateElasticOut(clamped);
    default: {
      const descriptor = PRESET_BY_ID.get(easing);
      if (descriptor?.bezier) {
        const [x1, y1, x2, y2] = descriptor.bezier;
        return solveCubicBezier(clamped, x1, y1, x2, y2);
      }
      return clamped;
    }
  }
}

/**
 * Converts a preset or cubic-bezier easing to editable `[x1, y1, x2, y2]` handles.
 * Non-bezier presets return a reasonable starting cubic approximation so users
 * can seamlessly switch into Bezier editing.
 */
export function easingToCubicBezier(easing: AnimationEasing): readonly [number, number, number, number] {
  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      return [easing.p1[0], easing.p1[1], easing.p2[0], easing.p2[1]];
    }
    // Approximate multi-point curve handles from its 1/3 and 2/3 samples
    const y1 = round3(evaluateMultiPointCurve(easing.points, 0.33));
    const y2 = round3(evaluateMultiPointCurve(easing.points, 0.67));
    return [0.33, y1, 0.67, y2];
  }
  const descriptor = PRESET_BY_ID.get(easing);
  if (descriptor?.bezier) {
    return descriptor.bezier;
  }
  if (easing === 'spring') return [0.34, 1.56, 0.64, 1];
  if (easing === 'elastic-out') return [0.22, 1.45, 0.58, 1];
  if (easing === 'bounce-out') return [0.25, 0.9, 0.4, 1.15];
  return [0.25, 0.1, 0.25, 1];
}

/**
 * Samples an easing curve at `steps + 1` uniform points for SVG graph rendering
 * and thumbnail previews.
 */
export function sampleEasingCurve(
  easing: AnimationEasing,
  steps = 36,
): Array<{ x: number; y: number }> {
  const count = Math.max(4, Math.min(128, Math.round(steps)));
  const samples: Array<{ x: number; y: number }> = new Array(count + 1);
  for (let i = 0; i <= count; i += 1) {
    const x = i / count;
    samples[i] = { x, y: evaluateEasing(easing, x) };
  }
  return samples;
}

/**
 * Builds a standards-compliant CSS `linear(...)` timing function by uniformly
 * sampling complex curves (`spring`, `bounce-out`, `elastic-out`, `multi-point`).
 */
function buildCssLinearTimingFunction(easing: AnimationEasing, samples = 24): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const val = i === 0 ? 0 : i === samples ? 1 : round3(evaluateEasing(easing, t));
    pts.push(String(val));
  }
  return `linear(${pts.join(', ')})`;
}

/**
 * Compiles any Folio `AnimationEasing` to a valid CSS `animation-timing-function`.
 * - Standard CSS keywords remain clean keywords (`linear`, `ease`, etc.).
 * - Cubic Bezier presets & custom Bezier curves emit `cubic-bezier(x1, y1, x2, y2)`.
 * - Complex curves (`spring`, `bounce-out`, `elastic-out`, `multi-point`) emit
 *   sampled standard CSS `linear(0, ...)` for exact Canvas <-> Browser parity.
 */
export function toCssTimingFunction(easing: AnimationEasing): string {
  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      const x1 = round3(clamp01(easing.p1[0]));
      const y1 = round3(easing.p1[1]);
      const x2 = round3(clamp01(easing.p2[0]));
      const y2 = round3(easing.p2[1]);
      return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
    }
    if (easing.type === 'multi-point') {
      return buildCssLinearTimingFunction(easing, 24);
    }
    return 'ease-out';
  }

  switch (easing) {
    case 'linear':
      return 'linear';
    case 'ease':
      return 'ease';
    case 'ease-in':
      return 'ease-in';
    case 'ease-out':
      return 'ease-out';
    case 'ease-in-out':
      return 'ease-in-out';
    case 'spring':
    case 'bounce-out':
    case 'elastic-out':
      return buildCssLinearTimingFunction(easing, 24);
    default: {
      const descriptor = PRESET_BY_ID.get(easing);
      if (descriptor?.bezier) {
        const [x1, y1, x2, y2] = descriptor.bezier;
        return `cubic-bezier(${round3(x1)}, ${round3(y1)}, ${round3(x2)}, ${round3(y2)})`;
      }
      return 'ease-out';
    }
  }
}

export function formatEasingLabel(easing: AnimationEasing): string {
  if (typeof easing === 'string') {
    return ANIMATION_EASING_LABELS[easing] ?? easing;
  }
  if (easing.type === 'cubic-bezier') {
    return `Bezier (${round3(easing.p1[0])}, ${round3(easing.p1[1])}, ${round3(easing.p2[0])}, ${round3(easing.p2[1])})`;
  }
  return `Multi-Point (${easing.points.length} pts)`;
}

export function areEasingsEqual(a: AnimationEasing, b: AnimationEasing): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (a.type === 'cubic-bezier' && b.type === 'cubic-bezier') {
    return (
      Math.abs(a.p1[0] - b.p1[0]) < 1e-4 &&
      Math.abs(a.p1[1] - b.p1[1]) < 1e-4 &&
      Math.abs(a.p2[0] - b.p2[0]) < 1e-4 &&
      Math.abs(a.p2[1] - b.p2[1]) < 1e-4
    );
  }
  if (a.type === 'multi-point' && b.type === 'multi-point') {
    if (a.points.length !== b.points.length) return false;
    return a.points.every(
      (pt, i) => Math.abs(pt.x - b.points[i].x) < 1e-4 && Math.abs(pt.y - b.points[i].y) < 1e-4,
    );
  }
  return false;
}

export function isCubicBezierEasing(easing: AnimationEasing): easing is CubicBezierEasing {
  return typeof easing === 'object' && easing !== null && easing.type === 'cubic-bezier';
}

export function isMultiPointEasing(easing: AnimationEasing): easing is MultiPointEasing {
  return typeof easing === 'object' && easing !== null && easing.type === 'multi-point';
}

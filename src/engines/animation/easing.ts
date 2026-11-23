import type { AnimationEasing } from '../../core/document/types';

export const ANIMATION_EASINGS: readonly AnimationEasing[] = Object.freeze([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'spring',
]);

export const ANIMATION_EASING_LABELS: Readonly<Record<AnimationEasing, string>> = Object.freeze({
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In-Out',
  spring: 'Spring',
});

const CUBIC_BEZIER_POINTS: Readonly<Record<Exclude<AnimationEasing, 'linear' | 'spring'>, readonly [number, number, number, number]>> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

function cubicCoord(u: number, p1: number, p2: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u;
}

function cubicDerivative(u: number, p1: number, p2: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * p1 + 6 * inv * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

function solveCubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  let u = x;
  for (let i = 0; i < 6; i += 1) {
    const err = cubicCoord(u, x1, x2) - x;
    if (Math.abs(err) < 1e-5) break;
    const deriv = cubicDerivative(u, x1, x2);
    if (Math.abs(deriv) < 1e-6) break;
    u = Math.max(0, Math.min(1, u - err / deriv));
  }
  return cubicCoord(u, y1, y2);
}

/**
 * Pure analytical easing evaluator for live canvas scrubbing and playback.
 * Guarantees f(0) = 0 and f(1) = 1 while allowing spring overshoot in (0, 1).
 */
export function evaluateEasing(easing: AnimationEasing, rawT: number): number {
  if (!Number.isFinite(rawT) || rawT <= 0) return 0;
  if (rawT >= 1) return 1;
  if (easing === 'linear') return rawT;
  if (easing === 'spring') {
    // Underdamped spring curve normalized so f(0)=0 and f(1)=1
    const decay = Math.exp(-6.2 * rawT);
    const osc = Math.cos(11.5 * rawT);
    const raw = 1 - decay * osc;
    const endValue = 1 - Math.exp(-6.2) * Math.cos(11.5);
    return endValue !== 0 ? raw / endValue : rawT;
  }
  const [x1, y1, x2, y2] = CUBIC_BEZIER_POINTS[easing];
  return solveCubicBezier(rawT, x1, y1, x2, y2);
}

/**
 * Converts a Folio AnimationEasing into a standard CSS animation-timing-function.
 */
export function toCssTimingFunction(easing: AnimationEasing): string {
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
      return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  }
}

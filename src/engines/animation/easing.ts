/**
 * Folio Motion & Easing Engine — Comprehensive Curve Library & Math.
 *
 * Pure, deterministic TypeScript supporting:
 * - 68 curated easing presets across Standard, UI Systems, Dynamic, Physics, Expressive, and Steps
 * - Custom Cubic-Bezier curves with overshoot (y1, y2 outside [0, 1]) via Newton-Raphson + bisection
 * - Multi-point speed/value curves with Catmull-Rom smooth interpolation
 * - Automatic compilation to CSS `cubic-bezier(...)`, `steps(...)`, or `linear(...)` timing functions
 */

import type {
  AnimationEasing,
  AnimationEasingPreset,
  CubicBezierEasing,
  MultiPointEasing,
  MultiPointEasingStop,
} from '../../core/document/types';

export type EasingPresetCategory =
  | 'standard'
  | 'ui'
  | 'dynamic'
  | 'physics'
  | 'expressive'
  | 'steps';

export interface EasingPresetDefinition {
  readonly id: AnimationEasingPreset;
  readonly label: string;
  readonly shortLabel: string;
  readonly category: EasingPresetCategory;
  readonly description: string;
  readonly bezier?: readonly [number, number, number, number];
  readonly stepsCount?: number;
}

export const EASING_CATEGORY_META: readonly {
  readonly id: EasingPresetCategory;
  readonly label: string;
  readonly shortLabel: string;
}[] = [
  { id: 'standard', label: 'Standard', shortLabel: 'Standard' },
  { id: 'ui', label: 'UI Systems', shortLabel: 'UI' },
  { id: 'dynamic', label: 'Dynamic', shortLabel: 'Dynamic' },
  { id: 'physics', label: 'Physics', shortLabel: 'Physics' },
  { id: 'expressive', label: 'Expressive', shortLabel: 'Expressive' },
  { id: 'steps', label: 'Steps', shortLabel: 'Steps' },
];

export const EASING_PRESET_CATALOG: readonly EasingPresetDefinition[] = [
  // ── Standard (17) ──────────────────────────────────────────────────────────
  {
    id: 'linear',
    label: 'Linear',
    shortLabel: 'Linear',
    category: 'standard',
    description: 'Constant mechanical velocity from start to end.',
    bezier: [0, 0, 1, 1],
  },
  {
    id: 'ease',
    label: 'Ease',
    shortLabel: 'Ease',
    category: 'standard',
    description: 'Balanced CSS default acceleration and gentle deceleration.',
    bezier: [0.25, 0.1, 0.25, 1],
  },
  {
    id: 'ease-in',
    label: 'Ease In',
    shortLabel: 'Ease In',
    category: 'standard',
    description: 'Starts slowly and accelerates toward the exit.',
    bezier: [0.42, 0, 1, 1],
  },
  {
    id: 'ease-out',
    label: 'Ease Out',
    shortLabel: 'Ease Out',
    category: 'standard',
    description: 'Starts briskly and settles smoothly to rest.',
    bezier: [0, 0, 0.58, 1],
  },
  {
    id: 'ease-in-out',
    label: 'Ease In-Out',
    shortLabel: 'In-Out',
    category: 'standard',
    description: 'Smooth symmetric S-curve acceleration and deceleration.',
    bezier: [0.42, 0, 0.58, 1],
  },
  {
    id: 'ease-in-sine',
    label: 'In Sine',
    shortLabel: 'In Sine',
    category: 'standard',
    description: 'Softest sinusoidal build-up for subtle ambient motion.',
    bezier: [0.12, 0, 0.39, 0],
  },
  {
    id: 'ease-out-sine',
    label: 'Out Sine',
    shortLabel: 'Out Sine',
    category: 'standard',
    description: 'Delicate sinusoidal landing with very gentle friction.',
    bezier: [0.61, 1, 0.88, 1],
  },
  {
    id: 'ease-in-out-sine',
    label: 'In-Out Sine',
    shortLabel: 'Sine S',
    category: 'standard',
    description: 'Natural pendulum-like wave ideal for breathing loops.',
    bezier: [0.37, 0, 0.63, 1],
  },
  {
    id: 'ease-in-quad',
    label: 'In Quad',
    shortLabel: 'In Quad',
    category: 'standard',
    description: 'Gentle quadratic acceleration curve.',
    bezier: [0.11, 0, 0.5, 0],
  },
  {
    id: 'ease-out-quad',
    label: 'Out Quad',
    shortLabel: 'Out Quad',
    category: 'standard',
    description: 'Gentle quadratic deceleration for clean UI settles.',
    bezier: [0.5, 1, 0.89, 1],
  },
  {
    id: 'ease-in-out-quad',
    label: 'In-Out Quad',
    shortLabel: 'Quad S',
    category: 'standard',
    description: 'Balanced quadratic S-curve transition.',
    bezier: [0.45, 0, 0.55, 1],
  },
  {
    id: 'ease-in-cubic',
    label: 'In Cubic',
    shortLabel: 'In Cubic',
    category: 'standard',
    description: 'Stronger cubic ramp-up for decisive exits.',
    bezier: [0.32, 0, 0.67, 0],
  },
  {
    id: 'ease-out-cubic',
    label: 'Out Cubic',
    shortLabel: 'Out Cubic',
    category: 'standard',
    description: 'Confident cubic landing ideal for cards and modals.',
    bezier: [0.33, 1, 0.68, 1],
  },
  {
    id: 'ease-in-out-cubic',
    label: 'In-Out Cubic',
    shortLabel: 'Cubic S',
    category: 'standard',
    description: 'Pronounced editorial cubic S-curve.',
    bezier: [0.65, 0, 0.35, 1],
  },
  {
    id: 'ease-in-quart',
    label: 'In Quart',
    shortLabel: 'In Quart',
    category: 'standard',
    description: 'Steep 4th-power acceleration with tight momentum.',
    bezier: [0.5, 0, 0.75, 0],
  },
  {
    id: 'ease-out-quart',
    label: 'Out Quart',
    shortLabel: 'Out Quart',
    category: 'standard',
    description: 'Crisp fast launch with long silky settle.',
    bezier: [0.25, 1, 0.5, 1],
  },
  {
    id: 'ease-in-out-quart',
    label: 'In-Out Quart',
    shortLabel: 'Quart S',
    category: 'standard',
    description: 'High-contrast 4th-power sweep for view transitions.',
    bezier: [0.76, 0, 0.24, 1],
  },

  // ── UI Systems (12) ────────────────────────────────────────────────────────
  {
    id: 'apple-ease',
    label: 'Apple HIG',
    shortLabel: 'Apple',
    category: 'ui',
    description: 'Classic macOS & iOS system ease for balanced interface motion.',
    bezier: [0.25, 0.1, 0.25, 1],
  },
  {
    id: 'ios-sheet',
    label: 'iOS Sheet',
    shortLabel: 'iOS Sheet',
    category: 'ui',
    description: 'Silky iOS bottom sheet and navigation drawer deceleration.',
    bezier: [0.32, 0.72, 0, 1],
  },
  {
    id: 'material-standard',
    label: 'Material Standard',
    shortLabel: 'M3 Std',
    category: 'ui',
    description: 'Material 3 standard asymmetric curve for on-screen elements.',
    bezier: [0.2, 0, 0, 1],
  },
  {
    id: 'material-emphasized',
    label: 'Material Emphasized',
    shortLabel: 'M3 Emph',
    category: 'ui',
    description: 'Material 3 expressive deceleration for primary hero transitions.',
    bezier: [0.05, 0.7, 0.1, 1],
  },
  {
    id: 'material-decelerate',
    label: 'Material Enter',
    shortLabel: 'M3 Enter',
    category: 'ui',
    description: 'Incoming elements entering the viewport at full speed.',
    bezier: [0, 0, 0, 1],
  },
  {
    id: 'material-accelerate',
    label: 'Material Exit',
    shortLabel: 'M3 Exit',
    category: 'ui',
    description: 'Outgoing elements accelerating cleanly off screen.',
    bezier: [0.3, 0, 1, 1],
  },
  {
    id: 'fluent-standard',
    label: 'Fluent Standard',
    shortLabel: 'Fluent',
    category: 'ui',
    description: 'Windows Fluent crisp point-to-point motion curve.',
    bezier: [0.8, 0, 0.2, 1],
  },
  {
    id: 'fluent-decelerate',
    label: 'Fluent Enter',
    shortLabel: 'Fluent In',
    category: 'ui',
    description: 'Fluent UI panel entrance with quick arrival and quiet settle.',
    bezier: [0.1, 0.9, 0.2, 1],
  },
  {
    id: 'fluent-accelerate',
    label: 'Fluent Exit',
    shortLabel: 'Fluent Out',
    category: 'ui',
    description: 'Fluent UI dismissal curve that clears space swiftly.',
    bezier: [0.7, 0, 1, 0.5],
  },
  {
    id: 'framer-smooth',
    label: 'Framer Smooth',
    shortLabel: 'Framer',
    category: 'ui',
    description: 'Modern web editorial out-quint feel for reveal choreography.',
    bezier: [0.22, 1, 0.36, 1],
  },
  {
    id: 'snappy-ui',
    label: 'Snappy UI',
    shortLabel: 'Snappy',
    category: 'ui',
    description: 'Ultra-responsive tactile response for toggles, tabs, and menus.',
    bezier: [0.16, 1, 0.3, 1],
  },
  {
    id: 'swift-out',
    label: 'Swift Out',
    shortLabel: 'Swift',
    category: 'ui',
    description: 'Fast acceleration and clean settle for hover & micro-states.',
    bezier: [0.4, 0, 0.2, 1],
  },

  // ── Dynamic (12) ───────────────────────────────────────────────────────────
  {
    id: 'ease-in-quint',
    label: 'In Quint',
    shortLabel: 'In Quint',
    category: 'dynamic',
    description: 'Deep 5th-power hold followed by explosive acceleration.',
    bezier: [0.64, 0, 0.78, 0],
  },
  {
    id: 'ease-out-quint',
    label: 'Out Quint',
    shortLabel: 'Out Quint',
    category: 'dynamic',
    description: 'High-velocity burst with ultra-smooth luxury deceleration.',
    bezier: [0.22, 1, 0.36, 1],
  },
  {
    id: 'ease-in-out-quint',
    label: 'In-Out Quint',
    shortLabel: 'Quint S',
    category: 'dynamic',
    description: 'Dramatic rapid mid-point whip with plush endpoints.',
    bezier: [0.83, 0, 0.17, 1],
  },
  {
    id: 'ease-in-expo',
    label: 'In Expo',
    shortLabel: 'In Expo',
    category: 'dynamic',
    description: 'Exponential launch for high-energy camera & title exits.',
    bezier: [0.7, 0, 0.84, 0],
  },
  {
    id: 'ease-out-expo',
    label: 'Out Expo',
    shortLabel: 'Out Expo',
    category: 'dynamic',
    description: 'Instant snap arrival with silky exponential coasting.',
    bezier: [0.16, 1, 0.3, 1],
  },
  {
    id: 'ease-in-out-expo',
    label: 'In-Out Expo',
    shortLabel: 'Expo S',
    category: 'dynamic',
    description: 'Razor-sharp cinematic whip transition.',
    bezier: [0.87, 0, 0.13, 1],
  },
  {
    id: 'ease-in-circ',
    label: 'In Circ',
    shortLabel: 'In Circ',
    category: 'dynamic',
    description: 'Circular arc acceleration with sudden final snap.',
    bezier: [0.55, 0, 1, 0.45],
  },
  {
    id: 'ease-out-circ',
    label: 'Out Circ',
    shortLabel: 'Out Circ',
    category: 'dynamic',
    description: 'Immediate circular arc burst gliding effortlessly to stop.',
    bezier: [0, 0.55, 0.45, 1],
  },
  {
    id: 'ease-in-out-circ',
    label: 'In-Out Circ',
    shortLabel: 'Circ S',
    category: 'dynamic',
    description: 'Tight circular midpoint acceleration with smooth tails.',
    bezier: [0.85, 0, 0.15, 1],
  },
  {
    id: 'fast-slow-fast',
    label: 'Fast · Slow · Fast',
    shortLabel: 'Flash Hold',
    category: 'dynamic',
    description: 'Rushes in, lingers in the center for emphasis, then speeds out.',
    bezier: [0.1, 0.9, 0.9, 0.1],
  },
  {
    id: 'slow-fast-slow',
    label: 'Slow · Fast · Slow',
    shortLabel: 'Cinematic',
    category: 'dynamic',
    description: 'Dramatic hold at both ends with a rapid mid-curve sweep.',
    bezier: [0.85, 0, 0.15, 1],
  },
  {
    id: 'whip-in-out',
    label: 'Whip Pan',
    shortLabel: 'Whip Pan',
    category: 'dynamic',
    description: 'Ultra-tight motion-graphics whip between static poses.',
    bezier: [0.95, 0.05, 0.05, 0.95],
  },

  // ── Physics (11) ───────────────────────────────────────────────────────────
  {
    id: 'spring',
    label: 'Spring Balanced',
    shortLabel: 'Spring',
    category: 'physics',
    description: 'Natural damped harmonic spring with a crisp settle.',
  },
  {
    id: 'spring-gentle',
    label: 'Spring Gentle',
    shortLabel: 'Spr Gentle',
    category: 'physics',
    description: 'Soft low-stiffness spring with a subtle floating overshoot.',
  },
  {
    id: 'spring-snappy',
    label: 'Spring Snappy',
    shortLabel: 'Spr Snappy',
    category: 'physics',
    description: 'Fast interactive UI spring with minimal ringing.',
  },
  {
    id: 'spring-bouncy',
    label: 'Spring Bouncy',
    shortLabel: 'Spr Bouncy',
    category: 'physics',
    description: 'Energetic playful spring with lively secondary oscillation.',
  },
  {
    id: 'spring-stiff',
    label: 'Spring Stiff',
    shortLabel: 'Spr Stiff',
    category: 'physics',
    description: 'High-tension precision spring for buttons and switches.',
  },
  {
    id: 'spring-wobbly',
    label: 'Spring Wobbly',
    shortLabel: 'Spr Wobbly',
    category: 'physics',
    description: 'Low-damping rubbery wobble for expressive hero objects.',
  },
  {
    id: 'spring-heavy',
    label: 'Spring Heavy',
    shortLabel: 'Spr Heavy',
    category: 'physics',
    description: 'Weighted mass feel with deliberate overshoot and slow settle.',
  },
  {
    id: 'bounce-out',
    label: 'Bounce Out',
    shortLabel: 'Bounce Out',
    category: 'physics',
    description: 'Gravity-inspired multi-hop landing.',
  },
  {
    id: 'bounce-in',
    label: 'Bounce In',
    shortLabel: 'Bounce In',
    category: 'physics',
    description: 'Reverse bounce build-up before launching forward.',
  },
  {
    id: 'bounce-in-out',
    label: 'Bounce In-Out',
    shortLabel: 'Bounce I/O',
    category: 'physics',
    description: 'Symmetric bounce launch and gravity bounce landing.',
  },
  {
    id: 'bounce-soft',
    label: 'Bounce Soft',
    shortLabel: 'Soft Hop',
    category: 'physics',
    description: 'Subtle single micro-rebound for polite tactile feedback.',
  },

  // ── Expressive (10) ────────────────────────────────────────────────────────
  {
    id: 'overshoot-out',
    label: 'Overshoot Out',
    shortLabel: 'Overshoot',
    category: 'expressive',
    description: 'Back-out curve that pops slightly past target then settles.',
    bezier: [0.34, 1.56, 0.64, 1],
  },
  {
    id: 'overshoot-soft',
    label: 'Overshoot Soft',
    shortLabel: 'Soft Pop',
    category: 'expressive',
    description: 'Refined micro-overshoot ideal for cards, tooltips, and badges.',
    bezier: [0.22, 1.24, 0.36, 1],
  },
  {
    id: 'overshoot-bold',
    label: 'Overshoot Bold',
    shortLabel: 'Bold Pop',
    category: 'expressive',
    description: 'High-energy pop for celebration badges and title reveals.',
    bezier: [0.18, 1.85, 0.42, 1],
  },
  {
    id: 'back-in',
    label: 'Back In',
    shortLabel: 'Back In',
    category: 'expressive',
    description: 'Pulls backward in anticipation before accelerating away.',
    bezier: [0.36, 0, 0.66, -0.56],
  },
  {
    id: 'back-in-out',
    label: 'Back In-Out',
    shortLabel: 'Back I/O',
    category: 'expressive',
    description: 'Full anticipation pullback plus playful overshoot landing.',
    bezier: [0.68, -0.6, 0.32, 1.6],
  },
  {
    id: 'anticipation-snap',
    label: 'Anticipation Snap',
    shortLabel: 'Anticipate',
    category: 'expressive',
    description: 'Cartoon-inspired wind-up followed by a razor-crisp launch.',
    bezier: [0.6, -0.45, 0.2, 1.08],
  },
  {
    id: 'elastic-out',
    label: 'Elastic Out',
    shortLabel: 'Elastic Out',
    category: 'expressive',
    description: 'High-energy elastic oscillation that rings into place.',
  },
  {
    id: 'elastic-in',
    label: 'Elastic In',
    shortLabel: 'Elastic In',
    category: 'expressive',
    description: 'Oscillating elastic wind-up before snapping to target.',
  },
  {
    id: 'elastic-in-out',
    label: 'Elastic In-Out',
    shortLabel: 'Elastic I/O',
    category: 'expressive',
    description: 'Symmetric elastic tension on departure and arrival.',
  },
  {
    id: 'elastic-soft',
    label: 'Elastic Soft',
    shortLabel: 'Soft Ring',
    category: 'expressive',
    description: 'Restrained single-ring elastic flourish for modern UI.',
  },

  // ── Steps (6) ──────────────────────────────────────────────────────────────
  {
    id: 'steps-2',
    label: 'Steps (2)',
    shortLabel: '2 Steps',
    category: 'steps',
    description: 'Crisp 2-beat mechanical flip.',
    stepsCount: 2,
  },
  {
    id: 'steps-4',
    label: 'Steps (4)',
    shortLabel: '4 Steps',
    category: 'steps',
    description: '4-frame rhythmic quantized stepping.',
    stepsCount: 4,
  },
  {
    id: 'steps-6',
    label: 'Steps (6)',
    shortLabel: '6 Steps',
    category: 'steps',
    description: '6-step kinetic poster / sprite motion.',
    stepsCount: 6,
  },
  {
    id: 'steps-8',
    label: 'Steps (8)',
    shortLabel: '8 Steps',
    category: 'steps',
    description: '8-step retro stop-motion cadence.',
    stepsCount: 8,
  },
  {
    id: 'steps-12',
    label: 'Steps (12)',
    shortLabel: '12 Steps',
    category: 'steps',
    description: '12-frame animation-on-twos handcrafted texture.',
    stepsCount: 12,
  },
  {
    id: 'step-end',
    label: 'Hold / Cut',
    shortLabel: 'Hold Cut',
    category: 'steps',
    description: 'Holds initial value then cuts instantaneously on final frame.',
    stepsCount: 1,
  },
];

export type EasingPresetDescriptor = EasingPresetDefinition;

export const ANIMATION_EASINGS: readonly AnimationEasingPreset[] = EASING_PRESET_CATALOG.map(
  (preset) => preset.id,
);

export const ANIMATION_EASING_LABELS: Record<AnimationEasingPreset, string> = Object.fromEntries(
  EASING_PRESET_CATALOG.map((preset) => [preset.id, preset.label]),
) as Record<AnimationEasingPreset, string>;

const PRESET_MAP = new Map<AnimationEasingPreset, EasingPresetDefinition>(
  EASING_PRESET_CATALOG.map((preset) => [preset.id, preset]),
);

export function getEasingPresetDefinition(
  easing: AnimationEasing,
): EasingPresetDefinition | null {
  if (typeof easing !== 'string') return null;
  return PRESET_MAP.get(easing) ?? null;
}

export function isCubicBezierEasing(value: AnimationEasing): value is CubicBezierEasing {
  return typeof value === 'object' && value !== null && value.type === 'cubic-bezier';
}

export function isMultiPointEasing(value: AnimationEasing): value is MultiPointEasing {
  return typeof value === 'object' && value !== null && value.type === 'multi-point';
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sampleCubic(u: number, p1: number, p2: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u;
}

function sampleCubicDerivative(u: number, p1: number, p2: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * p1 + 6 * inv * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

/**
 * Solves `y(t)` for a CSS-compatible cubic-bezier(x1, y1, x2, y2) curve.
 * Uses Newton-Raphson with safe bisection fallback so steep curves & overshoot
 * control points converge cleanly to 1e-6 precision.
 */
export function solveCubicBezier(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;

  const cx1 = clamp01(x1);
  const cx2 = clamp01(x2);

  let u = x;
  for (let i = 0; i < 6; i += 1) {
    const err = sampleCubic(u, cx1, cx2) - x;
    if (Math.abs(err) < 1e-6) {
      return sampleCubic(u, y1, y2);
    }
    const deriv = sampleCubicDerivative(u, cx1, cx2);
    if (Math.abs(deriv) < 1e-6) break;
    const next = u - err / deriv;
    if (next < 0 || next > 1) break;
    u = next;
  }

  // Guaranteed monotone bisection fallback
  let lo = 0;
  let hi = 1;
  u = x;
  for (let i = 0; i < 16; i += 1) {
    const val = sampleCubic(u, cx1, cx2);
    if (Math.abs(val - x) < 1e-6) break;
    if (val < x) lo = u;
    else hi = u;
    u = (lo + hi) * 0.5;
  }
  return sampleCubic(u, y1, y2);
}

/**
 * Evaluates a normalized damped harmonic spring curve so f(0)=0 and f(1)=1 exactly.
 */
function evaluateDampedSpring(t: number, decay: number, omega: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const raw = (u: number) => 1 - Math.exp(-decay * u) * Math.cos(omega * u);
  const endVal = raw(1);
  if (Math.abs(endVal) < 1e-5) return t;
  return raw(t) / endVal;
}

function evaluateBounceOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
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

function evaluateBounceIn(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - evaluateBounceOut(1 - t);
}

function evaluateBounceInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5
    ? (1 - evaluateBounceOut(1 - 2 * t)) * 0.5
    : (1 + evaluateBounceOut(2 * t - 1)) * 0.5;
}

function evaluateBounceSoft(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Single clean deceleration with one polite micro-hop near the end
  if (t < 0.72) {
    const u = t / 0.72;
    return 1 - Math.pow(1 - u, 3);
  }
  const u = (t - 0.72) / 0.28;
  return 1 - 0.08 * Math.sin(u * Math.PI);
}

function evaluateElasticOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function evaluateElasticIn(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
}

function evaluateElasticInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c5 = (2 * Math.PI) / 4.5;
  return t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
}

function evaluateElasticSoft(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const raw = (u: number) => 1 - Math.exp(-7.5 * u) * Math.cos(u * 2.4 * Math.PI);
  const endVal = raw(1);
  return Math.abs(endVal) < 1e-5 ? t : raw(t) / endVal;
}

function evaluateStepped(t: number, steps: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (steps <= 1) return 0;
  return Math.floor(t * steps) / steps;
}

/**
 * Evaluates a custom Multi-Point curve using smooth Catmull-Rom interpolation
 * between sorted monotonic stops (clamping horizontal progression cleanly).
 */
export function evaluateMultiPointEasing(
  points: readonly MultiPointEasingStop[],
  rawT: number,
): number {
  const t = clamp01(rawT);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (points.length < 2) return t;

  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (t <= sorted[0].x) return sorted[0].y;
  const last = sorted[sorted.length - 1];
  if (t >= last.x) return last.y;

  let segIdx = 0;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (t >= sorted[i].x && t <= sorted[i + 1].x) {
      segIdx = i;
      break;
    }
  }

  const p1 = sorted[segIdx];
  const p2 = sorted[segIdx + 1];
  const span = p2.x - p1.x;
  if (span <= 1e-6) return p2.y;
  const u = (t - p1.x) / span;

  // Catmull-Rom tangents in y with boundary mirroring
  const p0 = sorted[Math.max(0, segIdx - 1)];
  const p3 = sorted[Math.min(sorted.length - 1, segIdx + 2)];
  const m1 =
    segIdx === 0
      ? p2.y - p1.y
      : ((p2.y - p0.y) / Math.max(1e-4, p2.x - p0.x)) * span * 0.5;
  const m2 =
    segIdx === sorted.length - 2
      ? p2.y - p1.y
      : ((p3.y - p1.y) / Math.max(1e-4, p3.x - p1.x)) * span * 0.5;

  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p1.y + h10 * m1 + h01 * p2.y + h11 * m2;
}

export function normalizeMultiPointStops(
  stops: readonly MultiPointEasingStop[],
): MultiPointEasingStop[] {
  const cleaned: MultiPointEasingStop[] = stops
    .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
    .map((pt) => ({
      x: clamp01(pt.x),
      y: Math.max(-2, Math.min(3, pt.y)),
    }))
    .sort((a, b) => a.x - b.x);
  const interior = cleaned.filter((pt) => pt.x > 0.001 && pt.x < 0.999);
  return [{ x: 0, y: 0 }, ...interior, { x: 1, y: 1 }];
}

export function evaluateMultiPointCurve(
  points: readonly MultiPointEasingStop[],
  rawT: number,
): number {
  return evaluateMultiPointEasing(normalizeMultiPointStops(points), rawT);
}

/**
 * Evaluates any Folio AnimationEasing (preset string, CubicBezierEasing, or MultiPointEasing).
 * Guarantees exact 0 at t<=0 and 1 at t>=1, while permitting natural overshoot in (0, 1).
 */
export function evaluateEasing(easing: AnimationEasing, rawT: number): number {
  const t = clamp01(rawT);
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      return solveCubicBezier(
        t,
        easing.p1[0],
        easing.p1[1],
        easing.p2[0],
        easing.p2[1],
      );
    }
    if (easing.type === 'multi-point') {
      return evaluateMultiPointEasing(easing.points, t);
    }
    return t;
  }

  switch (easing) {
    case 'spring':
      return evaluateDampedSpring(t, 6, Math.PI * 3);
    case 'spring-gentle':
      return evaluateDampedSpring(t, 4.8, Math.PI * 1.65);
    case 'spring-snappy':
      return evaluateDampedSpring(t, 8.2, Math.PI * 2.2);
    case 'spring-bouncy':
      return evaluateDampedSpring(t, 4.1, Math.PI * 3.6);
    case 'spring-stiff':
      return evaluateDampedSpring(t, 9.6, Math.PI * 3.2);
    case 'spring-wobbly':
      return evaluateDampedSpring(t, 3.0, Math.PI * 5.0);
    case 'spring-heavy':
      return evaluateDampedSpring(t, 5.2, Math.PI * 1.45);
    case 'bounce-out':
      return evaluateBounceOut(t);
    case 'bounce-in':
      return evaluateBounceIn(t);
    case 'bounce-in-out':
      return evaluateBounceInOut(t);
    case 'bounce-soft':
      return evaluateBounceSoft(t);
    case 'elastic-out':
      return evaluateElasticOut(t);
    case 'elastic-in':
      return evaluateElasticIn(t);
    case 'elastic-in-out':
      return evaluateElasticInOut(t);
    case 'elastic-soft':
      return evaluateElasticSoft(t);
    default: {
      const def = PRESET_MAP.get(easing);
      if (def?.stepsCount !== undefined) {
        return evaluateStepped(t, def.stepsCount);
      }
      if (def?.bezier) {
        const [x1, y1, x2, y2] = def.bezier;
        return solveCubicBezier(t, x1, y1, x2, y2);
      }
      return t;
    }
  }
}

/**
 * Extracts editable cubic-bezier control points `[x1, y1, x2, y2]` from any easing
 * (providing an intuitive representative bezier approximation for non-bezier curves).
 */
export function easingToCubicBezier(easing: AnimationEasing): [number, number, number, number] {
  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      return [easing.p1[0], easing.p1[1], easing.p2[0], easing.p2[1]];
    }
    return [0.25, 0.1, 0.25, 1];
  }
  const def = PRESET_MAP.get(easing);
  if (def?.bezier) {
    return [def.bezier[0], def.bezier[1], def.bezier[2], def.bezier[3]];
  }
  if (easing.startsWith('spring') || easing.startsWith('elastic')) {
    return [0.22, 1.35, 0.36, 1];
  }
  if (easing.startsWith('bounce')) {
    return [0.34, 1.4, 0.64, 1];
  }
  return [0.25, 0.1, 0.25, 1];
}

/**
 * Samples any easing curve into `{ x, y }` points across `[0, 1]`.
 */
export function sampleEasingCurve(
  easing: AnimationEasing,
  steps = 40,
): { x: number; y: number }[] {
  const count = Math.max(2, Math.min(128, Math.round(steps)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= count; i += 1) {
    const x = i / count;
    points.push({ x, y: evaluateEasing(easing, x) });
  }
  return points;
}

/**
 * Samples any easing curve into a CSS `linear(...)` timing function (CSS Easing Level 2)
 * so Bounce, Elastic, Spring, and Multi-Point curves export with exact visual fidelity.
 */
export function sampleEasingToCssLinear(easing: AnimationEasing, samples = 24): string {
  const count = Math.max(8, Math.min(48, Math.round(samples)));
  const stops: string[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const v = evaluateEasing(easing, t);
    const rounded = Math.round(v * 1000) / 1000;
    stops.push(String(rounded));
  }
  return `linear(${stops.join(', ')})`;
}

function roundBezierCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Compiles any Folio AnimationEasing into a valid CSS `animation-timing-function`.
 */
export function toCssTimingFunction(easing: AnimationEasing): string {
  if (typeof easing === 'object' && easing !== null) {
    if (easing.type === 'cubic-bezier') {
      const x1 = roundBezierCoord(clamp01(easing.p1[0]));
      const y1 = roundBezierCoord(easing.p1[1]);
      const x2 = roundBezierCoord(clamp01(easing.p2[0]));
      const y2 = roundBezierCoord(easing.p2[1]);
      return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
    }
    if (easing.type === 'multi-point') {
      return sampleEasingToCssLinear(easing, 24);
    }
    return 'linear';
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
    case 'spring-gentle':
    case 'spring-snappy':
    case 'spring-bouncy':
    case 'spring-stiff':
    case 'spring-wobbly':
    case 'spring-heavy':
    case 'bounce-in':
    case 'bounce-out':
    case 'bounce-in-out':
    case 'bounce-soft':
    case 'elastic-in':
    case 'elastic-out':
    case 'elastic-in-out':
    case 'elastic-soft':
      return sampleEasingToCssLinear(easing, 24);
    default: {
      const def = PRESET_MAP.get(easing);
      if (def?.stepsCount !== undefined) {
        return `steps(${def.stepsCount}, end)`;
      }
      if (def?.bezier) {
        const [x1, y1, x2, y2] = def.bezier;
        return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
      }
      return 'ease-out';
    }
  }
}

export function formatEasingLabel(easing: AnimationEasing): string {
  if (typeof easing === 'string') {
    return PRESET_MAP.get(easing)?.label ?? easing;
  }
  if (easing.type === 'cubic-bezier') {
    return `Bezier (${roundBezierCoord(easing.p1[0])}, ${roundBezierCoord(easing.p1[1])})`;
  }
  return `Multi-Point (${easing.points.length} pts)`;
}

export function areEasingsEqual(a: AnimationEasing, b: AnimationEasing): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a.type !== b.type) return false;
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
      (pt, idx) =>
        Math.abs(pt.x - b.points[idx].x) < 1e-4 && Math.abs(pt.y - b.points[idx].y) < 1e-4,
    );
  }
  return false;
}

/**
 * Generates an SVG path `d` attribute for previewing any easing curve inside
 * a width x height viewport with vertical margin for overshoot curves.
 */
export function buildEasingCurveSvgPath(
  easing: AnimationEasing,
  width: number,
  height: number,
  padX = 6,
  padY = 8,
  samples = 48,
): string {
  const innerW = Math.max(4, width - padX * 2);
  const innerH = Math.max(4, height - padY * 2);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const rawY = evaluateEasing(easing, t);
    // Clamp visual display range to [-0.5, 1.5] so extreme elastic curves stay legible
    const clampedY = Math.max(-0.5, Math.min(1.5, rawY));
    const px = padX + t * innerW;
    const py = padY + (1 - clampedY) * innerH;
    pts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  return pts.join(' ');
}

export function createDefaultMultiPointFromEasing(easing: AnimationEasing): MultiPointEasing {
  if (typeof easing === 'object' && easing.type === 'multi-point' && easing.points.length >= 2) {
    return {
      type: 'multi-point',
      points: easing.points.map((p) => ({ x: p.x, y: p.y })),
    };
  }
  return {
    type: 'multi-point',
    points: [
      { x: 0, y: 0 },
      { x: 0.25, y: Math.round(evaluateEasing(easing, 0.25) * 100) / 100 },
      { x: 0.5, y: Math.round(evaluateEasing(easing, 0.5) * 100) / 100 },
      { x: 0.75, y: Math.round(evaluateEasing(easing, 0.75) * 100) / 100 },
      { x: 1, y: 1 },
    ],
  };
}

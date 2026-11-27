import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AnimationEasing,
  AnimationKeyframe,
  AnimationTrack,
  CubicBezierEasing,
  CustomEasingPreset,
  MultiPointEasing,
  MultiPointEasingStop,
} from '../../core/document/types';
import {
  ANIMATABLE_PROPERTY_META,
  EASING_CATEGORY_META,
  EASING_PRESET_CATALOG,
  areEasingsEqual,
  easingToCubicBezier,
  evaluateEasing,
  evaluateTrackAtTime,
  formatEasingLabel,
  sampleEasingCurve,
  sortKeyframes,
  toCssTimingFunction,
  type EasingPresetCategory,
} from '../../engines/animation';

export type MotionGraphViewMode = 'easing' | 'value' | 'speed';

export interface MotionGraphEditorProps {
  value: AnimationEasing;
  title: string;
  customEasings: readonly CustomEasingPreset[];
  onChange: (nextEasing: AnimationEasing, coalesceKey?: string) => void;
  onUpdateCustomEasings: (nextCustomEasings: readonly CustomEasingPreset[], description?: string) => void;
  onClose: () => void;
  /** Optional full numeric track for Value Graph & Speed Graph editing. */
  track?: AnimationTrack;
  /** Currently selected keyframe ID inside `track`. */
  selectedKeyframeId?: string;
  /** Total clip duration in ms for Value/Speed Graph X-axis. */
  clipDurationMs?: number;
  /** Live playhead time in ms for Value/Speed Graph cursor & live velocity readout. */
  playheadMs?: number;
  /** Display unit for channel values (e.g. `%`, `px`, `deg`). */
  propertyUnit?: string;
  /** Which tab to open initially (`easing`, `value`, or `speed`). */
  initialGraphView?: MotionGraphViewMode;
  /** Callback invoked when Value Graph or Speed Graph edits keyframe times, values, or segment easings. */
  onUpdateTrack?: (nextTrack: AnimationTrack, description?: string, coalesceKey?: string) => void;
  /** Optional callback to sync selected keyframe back to timeline. */
  onSelectKeyframe?: (keyframeId: string) => void;
}

type PresetTabId = 'all' | EasingPresetCategory | 'custom';
type GraphEditMode = 'cubic-bezier' | 'multi-point';

const SVG_W = 264;
const SVG_H = 216;
const PAD_L = 26;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 22;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;
const Y_MIN = -0.6;
const Y_MAX = 1.6;

// Full-track Value / Speed Graph dimensions
const TG_W = 588;
const TG_H = 248;
const TG_PAD_L = 52;
const TG_PAD_R = 20;
const TG_PAD_T = 22;
const TG_PAD_B = 30;
const TG_PLOT_W = TG_W - TG_PAD_L - TG_PAD_R;
const TG_PLOT_H = TG_H - TG_PAD_T - TG_PAD_B;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  const r = Math.round(val * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function round1(val: number): number {
  const r = Math.round(val * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

function toSvgX(x: number): number {
  return PAD_L + clamp(x, 0, 1) * PLOT_W;
}

function toSvgY(y: number): number {
  const norm = (clamp(y, Y_MIN, Y_MAX) - Y_MIN) / (Y_MAX - Y_MIN);
  return PAD_T + (1 - norm) * PLOT_H;
}

function fromSvgPoint(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const scaleX = rect.width > 0 ? SVG_W / rect.width : 1;
  const scaleY = rect.height > 0 ? SVG_H / rect.height : 1;
  const sx = (clientX - rect.left) * scaleX;
  const sy = (clientY - rect.top) * scaleY;
  const x = clamp((sx - PAD_L) / PLOT_W, 0, 1);
  const normY = 1 - (sy - PAD_T) / PLOT_H;
  const y = clamp(Y_MIN + normY * (Y_MAX - Y_MIN), Y_MIN, Y_MAX);
  return { x: round2(x), y: round2(y) };
}

function fromTrackGraphPoint(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
): { sx: number; sy: number } {
  const rect = svg.getBoundingClientRect();
  const scaleX = rect.width > 0 ? TG_W / rect.width : 1;
  const scaleY = rect.height > 0 ? TG_H / rect.height : 1;
  return {
    sx: (clientX - rect.left) * scaleX,
    sy: (clientY - rect.top) * scaleY,
  };
}

function buildCurvePolyline(easing: AnimationEasing, steps = 44): string {
  const pts = sampleEasingCurve(easing, steps);
  return pts
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${toSvgX(pt.x).toFixed(1)},${toSvgY(pt.y).toFixed(1)}`)
    .join(' ');
}

function buildMiniCurvePath(easing: AnimationEasing, width: number, height: number, pad = 4): string {
  const pts = sampleEasingCurve(easing, 20);
  const innerW = Math.max(4, width - pad * 2);
  const innerH = Math.max(4, height - pad * 2);
  let minY = 0;
  let maxY = 1;
  for (const pt of pts) {
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const spanY = Math.max(1, maxY - minY);
  return pts
    .map((pt, idx) => {
      const px = pad + pt.x * innerW;
      const py = pad + (1 - (pt.y - minY) / spanY) * innerH;
      return `${idx === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

export interface EasingCurveMiniSvgProps {
  easing: AnimationEasing;
  width?: number;
  height?: number;
  className?: string;
}

export function EasingCurveMiniSvg({
  easing,
  width = 36,
  height = 24,
  className = 'mge-mini-svg',
}: EasingCurveMiniSvgProps) {
  const d = useMemo(() => buildMiniCurvePath(easing, width, height, 4), [easing, width, height]);
  return (
    <svg
      class={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <line
        x1={4}
        y1={height - 4}
        x2={width - 4}
        y2={4}
        stroke="var(--line-strong)"
        stroke-opacity="0.5"
        stroke-width="1"
        stroke-dasharray="2 2"
      />
      <path d={d} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function convertToMultiPoint(easing: AnimationEasing): MultiPointEasing {
  if (typeof easing === 'object' && easing !== null && easing.type === 'multi-point') {
    return easing;
  }
  return {
    type: 'multi-point',
    points: [
      { x: 0, y: 0 },
      { x: 0.35, y: round2(evaluateEasing(easing, 0.35)) },
      { x: 0.7, y: round2(evaluateEasing(easing, 0.7)) },
      { x: 1, y: 1 },
    ],
  };
}

/**
 * Evaluates instantaneous speed `|dv/dt|` in `units/second` for a numeric track at `timeMs`.
 */
function sampleTrackSpeedAtTime(
  track: AnimationTrack,
  sortedKfs: readonly AnimationKeyframe[],
  timeMs: number,
  durationMs: number,
): number {
  if (sortedKfs.length < 2 || durationMs <= 0) return 0;
  // Find active segment
  for (let i = 0; i < sortedKfs.length - 1; i += 1) {
    const a = sortedKfs[i];
    const b = sortedKfs[i + 1];
    if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
      const span = b.timeMs - a.timeMs;
      if (span <= 0.5) return 0;
      const dv = Number(b.value) - Number(a.value);
      const dt = Math.max(0.5, Math.min(span * 0.015, 4));
      const tA = clamp((timeMs - dt - a.timeMs) / span, 0, 1);
      const tB = clamp((timeMs + dt - a.timeMs) / span, 0, 1);
      const spanT = tB - tA;
      if (spanT <= 1e-6) return 0;
      const eA = evaluateEasing(b.easing, tA);
      const eB = evaluateEasing(b.easing, tB);
      const slope = Math.abs((eB - eA) / spanT);
      return (Math.abs(dv) * slope) / (span / 1000);
    }
  }
  // Outside keyframe bounds -> speed is 0 (held)
  void track;
  return 0;
}

const SPEED_PROFILE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  easing: AnimationEasing;
}> = [
  { id: 'linear', label: 'Constant', easing: 'linear' },
  { id: 'easy', label: 'Easy Ease', easing: { type: 'cubic-bezier', p1: [0.42, 0], p2: [0.58, 1] } },
  { id: 'decel', label: 'Fast Out', easing: { type: 'cubic-bezier', p1: [0.16, 1], p2: [0.3, 1] } },
  { id: 'accel', label: 'Fast In', easing: { type: 'cubic-bezier', p1: [0.7, 0], p2: [0.84, 0] } },
  { id: 'whip', label: 'Whip Peak', easing: { type: 'cubic-bezier', p1: [0.82, 0], p2: [0.18, 1] } },
  { id: 'gentle', label: 'Smooth S', easing: { type: 'cubic-bezier', p1: [0.33, 0], p2: [0.67, 1] } },
];

export function MotionGraphEditor({
  value,
  title,
  customEasings,
  onChange,
  onUpdateCustomEasings,
  onClose,
  track,
  selectedKeyframeId,
  clipDurationMs = 1200,
  playheadMs = 0,
  propertyUnit,
  initialGraphView = 'easing',
  onUpdateTrack,
  onSelectKeyframe,
}: MotionGraphEditorProps) {
  const isNumericTrack = Boolean(
    track &&
      ANIMATABLE_PROPERTY_META[track.property]?.kind === 'number' &&
      track.keyframes.length >= 1,
  );
  const canShowTrackGraphs = isNumericTrack && Boolean(onUpdateTrack);

  const [graphView, setGraphView] = useState<MotionGraphViewMode>(
    canShowTrackGraphs ? initialGraphView : 'easing',
  );

  // Sync graphView if caller opens directly into speed/value mode
  useEffect(() => {
    if (canShowTrackGraphs) {
      setGraphView(initialGraphView);
    } else {
      setGraphView('easing');
    }
  }, [initialGraphView, canShowTrackGraphs]);

  const isMultiPointValue = typeof value === 'object' && value !== null && value.type === 'multi-point';
  const [editMode, setEditMode] = useState<GraphEditMode>(isMultiPointValue ? 'multi-point' : 'cubic-bezier');
  const [activeTab, setActiveTab] = useState<PresetTabId>('all');
  const [presetQuery, setPresetQuery] = useState('');
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [customNameDraft, setCustomNameDraft] = useState('');

  // Track Graph (Value & Speed) local selection
  const sortedTrackKfs = useMemo(
    () => (track ? sortKeyframes(track.keyframes) : []),
    [track],
  );
  const [activeGraphKfId, setActiveGraphKfId] = useState<string | null>(
    selectedKeyframeId ?? (sortedTrackKfs.length >= 2 ? sortedTrackKfs[sortedTrackKfs.length - 1].id : sortedTrackKfs[0]?.id ?? null),
  );
  useEffect(() => {
    if (selectedKeyframeId && sortedTrackKfs.some((kf) => kf.id === selectedKeyframeId)) {
      setActiveGraphKfId(selectedKeyframeId);
    } else if (!activeGraphKfId || !sortedTrackKfs.some((kf) => kf.id === activeGraphKfId)) {
      const fallback = sortedTrackKfs.length >= 2 ? sortedTrackKfs[sortedTrackKfs.length - 1] : sortedTrackKfs[0];
      setActiveGraphKfId(fallback?.id ?? null);
    }
  }, [selectedKeyframeId, sortedTrackKfs, activeGraphKfId]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const trackSvgRef = useRef<SVGSVGElement | null>(null);
  const valueRef = useRef<AnimationEasing>(value);
  valueRef.current = value;
  const trackRef = useRef<AnimationTrack | undefined>(track);
  trackRef.current = track;

  useEffect(() => {
    if (isMultiPointValue) {
      setEditMode('multi-point');
    } else if (typeof value === 'object' && value !== null && value.type === 'cubic-bezier') {
      setEditMode('cubic-bezier');
    }
  }, [isMultiPointValue, value]);

  // Lightweight live velocity preview loop (only active while in Easing mode & playing)
  useEffect(() => {
    if (!previewPlaying || graphView !== 'easing') return;
    let rafId = 0;
    let startTs: number | null = null;
    const cycleMs = 1150;
    const pauseHoldMs = 260;

    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const elapsed = (ts - startTs) % (cycleMs + pauseHoldMs);
      const t = elapsed <= cycleMs ? elapsed / cycleMs : 1;
      setPreviewProgress(t);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [previewPlaying, graphView]);

  const bezierCoords = useMemo(() => easingToCubicBezier(value), [value]);
  const [x1, y1, x2, y2] = bezierCoords;

  const multiPoints: readonly MultiPointEasingStop[] = useMemo(() => {
    if (typeof value === 'object' && value !== null && value.type === 'multi-point') {
      return value.points;
    }
    return [];
  }, [value]);

  const curvePath = useMemo(() => buildCurvePolyline(value, 48), [value]);
  const cssTimingString = useMemo(() => toCssTimingFunction(value), [value]);
  const evaluatedBallPos = useMemo(
    () => clamp(evaluateEasing(value, previewProgress), -0.35, 1.35),
    [value, previewProgress],
  );
  const ballLeftPct = useMemo(
    () => clamp(12 + evaluatedBallPos * 76, 4, 96),
    [evaluatedBallPos],
  );

  const emitBezier = (nx1: number, ny1: number, nx2: number, ny2: number, coalesceKey?: string) => {
    const next: CubicBezierEasing = {
      type: 'cubic-bezier',
      p1: [round2(clamp(nx1, 0, 1)), round2(clamp(ny1, Y_MIN, Y_MAX))],
      p2: [round2(clamp(nx2, 0, 1)), round2(clamp(ny2, Y_MIN, Y_MAX))],
    };
    onChange(next, coalesceKey);
  };

  const handleBezierHandlePointerDown = (
    handle: 'p1' | 'p2',
    event: JSX.TargetedPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const pt = fromSvgPoint(moveEvent.clientX, moveEvent.clientY, svg);
      const [cx1, cy1, cx2, cy2] = easingToCubicBezier(valueRef.current);
      if (handle === 'p1') {
        emitBezier(pt.x, pt.y, cx2, cy2, 'mge-bezier-p1');
      } else {
        emitBezier(cx1, cy1, pt.x, pt.y, 'mge-bezier-p2');
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleMultiStopPointerDown = (
    index: number,
    event: JSX.TargetedPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (index <= 0 || index >= multiPoints.length - 1) return;
    setSelectedStopIndex(index);
    const svg = svgRef.current;
    if (!svg) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const current = valueRef.current;
      if (typeof current !== 'object' || current === null || current.type !== 'multi-point') return;
      const pts = current.points;
      if (index <= 0 || index >= pts.length - 1) return;
      const pt = fromSvgPoint(moveEvent.clientX, moveEvent.clientY, svg);
      const minX = pts[index - 1].x + 0.02;
      const maxX = pts[index + 1].x - 0.02;
      const clampedX = round2(clamp(pt.x, minX, maxX));
      const clampedY = round2(clamp(pt.y, Y_MIN, Y_MAX));
      const nextPoints = pts.map((stop, idx) =>
        idx === index ? { x: clampedX, y: clampedY } : stop,
      );
      onChange({ type: 'multi-point', points: nextPoints }, `mge-stop-${index}`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleGraphDoubleClick = (event: JSX.TargetedMouseEvent<SVGSVGElement>) => {
    if (editMode !== 'multi-point') return;
    const svg = svgRef.current;
    if (!svg) return;
    const base = convertToMultiPoint(value);
    if (base.points.length >= 12) return;
    const pt = fromSvgPoint(event.clientX, event.clientY, svg);
    if (pt.x <= 0.03 || pt.x >= 0.97) return;
    const existsNearby = base.points.some((stop) => Math.abs(stop.x - pt.x) < 0.03);
    if (existsNearby) return;
    const nextPoints = [...base.points, { x: pt.x, y: pt.y }].sort((a, b) => a.x - b.x);
    const insertedIdx = nextPoints.findIndex((stop) => stop.x === pt.x && stop.y === pt.y);
    setSelectedStopIndex(insertedIdx > 0 && insertedIdx < nextPoints.length - 1 ? insertedIdx : null);
    onChange({ type: 'multi-point', points: nextPoints });
  };

  const handleDeleteStop = (index: number) => {
    if (typeof value !== 'object' || value === null || value.type !== 'multi-point') return;
    if (index <= 0 || index >= value.points.length - 1 || value.points.length <= 2) return;
    const nextPoints = value.points.filter((_, idx) => idx !== index);
    setSelectedStopIndex(null);
    onChange({ type: 'multi-point', points: nextPoints });
  };

  const handleSwitchMode = (mode: GraphEditMode) => {
    setEditMode(mode);
    setSelectedStopIndex(null);
    if (mode === 'multi-point') {
      if (typeof value !== 'object' || value === null || value.type !== 'multi-point') {
        onChange(convertToMultiPoint(value));
      }
    } else if (typeof value !== 'object' || value === null || value.type !== 'cubic-bezier') {
      const [cx1, cy1, cx2, cy2] = easingToCubicBezier(value);
      emitBezier(cx1, cy1, cx2, cy2);
    }
  };

  const handleSaveCustomCurve = () => {
    const trimmed = customNameDraft.trim() || `Custom Curve ${customEasings.length + 1}`;
    const nextPreset: CustomEasingPreset = {
      id: `custom-ease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed.slice(0, 32),
      easing: value,
    };
    onUpdateCustomEasings([...customEasings, nextPreset], `Save custom easing "${nextPreset.name}"`);
    setCustomNameDraft('');
    setActiveTab('custom');
  };

  const handleDeleteCustomCurve = (id: string, name: string) => {
    const next = customEasings.filter((item) => item.id !== id);
    onUpdateCustomEasings(next, `Delete custom easing "${name}"`);
  };

  const visibleCatalogPresets = useMemo(() => {
    if (activeTab === 'custom') return [];
    const needle = presetQuery.trim().toLowerCase();
    return EASING_PRESET_CATALOG.filter((item) => {
      if (activeTab !== 'all' && item.category !== activeTab) return false;
      if (!needle) return true;
      return (
        item.label.toLowerCase().includes(needle) ||
        item.shortLabel.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle)
      );
    });
  }, [activeTab, presetQuery]);

  // ============================================================================
  // VALUE GRAPH & SPEED GRAPH COMPUTATION
  // ============================================================================
  const effectiveDurationMs = Math.max(100, clipDurationMs);
  const trackMeta = track ? ANIMATABLE_PROPERTY_META[track.property] : undefined;
  const unitLabel = propertyUnit ?? trackMeta?.unit ?? '';
  const speedUnitLabel = unitLabel ? `${unitLabel}/s` : 'u/s';

  const trackGraphData = useMemo(() => {
    if (!track || !isNumericTrack || sortedTrackKfs.length === 0) return null;
    const sampleCount = 128;
    const valueSamples: Array<{ t: number; v: number }> = [];
    const speedSamples: Array<{ t: number; s: number }> = [];

    let minVal = Infinity;
    let maxVal = -Infinity;
    let peakSpeed = 0;
    let speedSum = 0;

    for (let i = 0; i <= sampleCount; i += 1) {
      const t = (i / sampleCount) * effectiveDurationMs;
      const v = Number(evaluateTrackAtTime(track, t) ?? sortedTrackKfs[0].value);
      const s = sampleTrackSpeedAtTime(track, sortedTrackKfs, t, effectiveDurationMs);
      valueSamples.push({ t, v });
      speedSamples.push({ t, s });
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      if (s > peakSpeed) peakSpeed = s;
      speedSum += s;
    }
    for (const kf of sortedTrackKfs) {
      const num = Number(kf.value);
      if (num < minVal) minVal = num;
      if (num > maxVal) maxVal = num;
    }

    const rawSpan = maxVal - minVal;
    const pad = rawSpan > 0.01 ? rawSpan * 0.18 : Math.max(10, Math.abs(minVal) * 0.25 || 10);
    const vMin = minVal - pad;
    const vMax = maxVal + pad;
    const sMax = Math.max(10, peakSpeed * 1.18);
    const avgSpeed = speedSamples.length > 0 ? speedSum / speedSamples.length : 0;

    const liveVal = Number(evaluateTrackAtTime(track, playheadMs) ?? sortedTrackKfs[0].value);
    const liveSpeed = sampleTrackSpeedAtTime(track, sortedTrackKfs, playheadMs, effectiveDurationMs);

    return {
      valueSamples,
      speedSamples,
      vMin,
      vMax,
      sMax,
      peakSpeed,
      avgSpeed,
      liveVal,
      liveSpeed,
    };
  }, [track, isNumericTrack, sortedTrackKfs, effectiveDurationMs, playheadMs]);

  const activeKfIndex = useMemo(() => {
    if (!activeGraphKfId) return -1;
    return sortedTrackKfs.findIndex((kf) => kf.id === activeGraphKfId);
  }, [sortedTrackKfs, activeGraphKfId]);

  const activeKf = activeKfIndex >= 0 ? sortedTrackKfs[activeKfIndex] : sortedTrackKfs[sortedTrackKfs.length - 1] ?? null;

  // Determine active segment (pair of consecutive keyframes) for tangent handle editing
  const activeSegmentIndex = useMemo(() => {
    if (sortedTrackKfs.length < 2) return -1;
    if (activeKfIndex >= 1) return activeKfIndex - 1;
    return 0;
  }, [sortedTrackKfs.length, activeKfIndex]);

  const segStartKf = activeSegmentIndex >= 0 ? sortedTrackKfs[activeSegmentIndex] : null;
  const segEndKf = activeSegmentIndex >= 0 ? sortedTrackKfs[activeSegmentIndex + 1] : null;

  const tgTimeToX = (t: number) => TG_PAD_L + (clamp(t, 0, effectiveDurationMs) / effectiveDurationMs) * TG_PLOT_W;
  const tgXToTime = (sx: number) =>
    Math.round(clamp(((sx - TG_PAD_L) / TG_PLOT_W) * effectiveDurationMs, 0, effectiveDurationMs));
  const tgValToY = (v: number, vMin: number, vMax: number) => {
    const span = Math.max(1e-6, vMax - vMin);
    return TG_PAD_T + (1 - (v - vMin) / span) * TG_PLOT_H;
  };
  const tgYToVal = (sy: number, vMin: number, vMax: number) => {
    const norm = 1 - (sy - TG_PAD_T) / TG_PLOT_H;
    return vMin + norm * (vMax - vMin);
  };
  const tgSpeedToY = (s: number, sMax: number) =>
    TG_PAD_T + (1 - clamp(s, 0, sMax) / Math.max(1e-6, sMax)) * TG_PLOT_H;

  const commitTrackKeyframePatch = (
    kfId: string,
    patch: Partial<Pick<AnimationKeyframe, 'timeMs' | 'value' | 'easing'>>,
    description: string,
    coalesceKey?: string,
  ) => {
    const curTrack = trackRef.current;
    if (!curTrack || !onUpdateTrack) return;
    const meta = ANIMATABLE_PROPERTY_META[curTrack.property];
    const nextKfs = sortKeyframes(
      curTrack.keyframes.map((kf) => {
        if (kf.id !== kfId) return kf;
        let nextVal = patch.value !== undefined ? Number(patch.value) : Number(kf.value);
        if (meta?.min !== undefined) nextVal = Math.max(meta.min, nextVal);
        if (meta?.max !== undefined) nextVal = Math.min(meta.max, nextVal);
        return {
          ...kf,
          ...(patch.timeMs !== undefined ? { timeMs: clamp(Math.round(patch.timeMs), 0, effectiveDurationMs) } : {}),
          ...(patch.value !== undefined ? { value: round2(nextVal) } : {}),
          ...(patch.easing !== undefined ? { easing: patch.easing } : {}),
        };
      }),
    );
    onUpdateTrack({ ...curTrack, keyframes: nextKfs }, description, coalesceKey);
  };

  // Drag keyframe node in Value Graph (retime + revalue simultaneously)
  const handleValueNodePointerDown = (
    kfIndex: number,
    event: JSX.TargetedPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = trackSvgRef.current;
    if (!svg || !trackGraphData || !track) return;
    const kf = sortedTrackKfs[kfIndex];
    if (!kf) return;
    setActiveGraphKfId(kf.id);
    onSelectKeyframe?.(kf.id);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const { vMin, vMax } = trackGraphData;
    const minT = kfIndex > 0 ? sortedTrackKfs[kfIndex - 1].timeMs + 10 : 0;
    const maxT = kfIndex < sortedTrackKfs.length - 1 ? sortedTrackKfs[kfIndex + 1].timeMs - 10 : effectiveDurationMs;

    const onMove = (moveEvent: PointerEvent) => {
      const pt = fromTrackGraphPoint(moveEvent.clientX, moveEvent.clientY, svg);
      const nextTime = clamp(tgXToTime(pt.sx), minT, maxT);
      const nextVal = tgYToVal(pt.sy, vMin, vMax);
      commitTrackKeyframePatch(
        kf.id,
        { timeMs: nextTime, value: nextVal },
        'Edit keyframe in Value Graph',
        `mge-vg-kf-${kf.id}`,
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag Value Graph tangent handle (p1 or p2 on active segment)
  const handleValueTangentPointerDown = (
    handle: 'p1' | 'p2',
    event: JSX.TargetedPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = trackSvgRef.current;
    if (!svg || !trackGraphData || !segStartKf || !segEndKf) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const { vMin, vMax } = trackGraphData;
    const startT = segStartKf.timeMs;
    const endT = segEndKf.timeMs;
    const startV = Number(segStartKf.value);
    const endV = Number(segEndKf.value);
    const spanT = Math.max(1, endT - startT);
    const spanV = endV - startV;
    const targetKfId = segEndKf.id;

    const onMove = (moveEvent: PointerEvent) => {
      const curTrack = trackRef.current;
      const curTarget = curTrack?.keyframes.find((k) => k.id === targetKfId);
      if (!curTarget) return;
      const [cx1, cy1, cx2, cy2] = easingToCubicBezier(curTarget.easing);
      const pt = fromTrackGraphPoint(moveEvent.clientX, moveEvent.clientY, svg);
      const normX = round2(clamp((tgXToTime(pt.sx) - startT) / spanT, 0, 1));
      const rawVal = tgYToVal(pt.sy, vMin, vMax);
      const normY = Math.abs(spanV) > 1e-4
        ? round2(clamp((rawVal - startV) / spanV, Y_MIN, Y_MAX))
        : (handle === 'p1' ? cy1 : cy2);

      const nextEasing: CubicBezierEasing =
        handle === 'p1'
          ? { type: 'cubic-bezier', p1: [normX, normY], p2: [round2(cx2), round2(cy2)] }
          : { type: 'cubic-bezier', p1: [round2(cx1), round2(cy1)], p2: [normX, normY] };

      commitTrackKeyframePatch(
        targetKfId,
        { easing: nextEasing },
        'Shape segment curve in Value Graph',
        `mge-vg-tan-${targetKfId}-${handle}`,
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag Speed Graph influence handle (horizontal adjusts cubic-bezier influence x1/x2; vertical adjusts exit/entry velocity)
  const handleSpeedInfluencePointerDown = (
    handle: 'out' | 'in',
    event: JSX.TargetedPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = trackSvgRef.current;
    if (!svg || !trackGraphData || !segStartKf || !segEndKf) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);

    const startT = segStartKf.timeMs;
    const endT = segEndKf.timeMs;
    const spanT = Math.max(1, endT - startT);
    const targetKfId = segEndKf.id;

    const onMove = (moveEvent: PointerEvent) => {
      const curTrack = trackRef.current;
      const curTarget = curTrack?.keyframes.find((k) => k.id === targetKfId);
      if (!curTarget) return;
      const [cx1, cy1, cx2, cy2] = easingToCubicBezier(curTarget.easing);
      const pt = fromTrackGraphPoint(moveEvent.clientX, moveEvent.clientY, svg);
      const tAtPointer = tgXToTime(pt.sx);
      const fracX = clamp((tAtPointer - startT) / spanT, 0.02, 0.98);
      // Vertical drag from baseline raises exit/entry speed (y1 > 0 for 'out', y2 < 1 for 'in')
      const baseY = TG_PAD_T + TG_PLOT_H;
      const liftRatio = clamp((baseY - pt.sy) / TG_PLOT_H, 0, 1);

      let nextEasing: CubicBezierEasing;
      if (handle === 'out') {
        const nextX1 = round2(clamp(fracX, 0.02, 0.96));
        const nextY1 = round2(clamp(liftRatio * 0.9, 0, 1.2));
        nextEasing = {
          type: 'cubic-bezier',
          p1: [nextX1, nextY1],
          p2: [round2(cx2), round2(cy2)],
        };
      } else {
        const nextX2 = round2(clamp(fracX, 0.04, 0.98));
        const nextY2 = round2(clamp(1 - liftRatio * 0.9, -0.2, 1));
        nextEasing = {
          type: 'cubic-bezier',
          p1: [round2(cx1), round2(cy1)],
          p2: [nextX2, nextY2],
        };
      }

      commitTrackKeyframePatch(
        targetKfId,
        { easing: nextEasing },
        'Shape velocity in Speed Graph',
        `mge-sg-tan-${targetKfId}-${handle}`,
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const yZeroSvg = toSvgY(0);
  const yOneSvg = toSvgY(1);
  const xZeroSvg = toSvgX(0);
  const xOneSvg = toSvgX(1);

  const popover = (
    <div
      class={`mge-popover${graphView !== 'easing' ? ' is-track-graph' : ''}`}
      role="dialog"
      aria-label={`Motion Graph Editor — ${title}`}
      data-testid="motion-graph-editor"
      data-graph-view={graphView}
    >
      <header class="mge-header">
        <div class="mge-title-wrap">
          <span class="mge-title-badge">GRAPH</span>
          <strong class="mge-title">{title}</strong>
          <span class="mge-active-pill">
            {graphView === 'easing'
              ? formatEasingLabel(value)
              : graphView === 'value'
                ? 'Value Graph'
                : 'Speed Graph'}
          </span>
        </div>
        <div class="mge-header-actions">
          {/* Primary 3-Mode Graph Switcher: Easing | Value | Speed */}
          <div class="mge-mode-seg mge-view-seg" role="tablist" aria-label="Graph Editor view">
            <button
              type="button"
              role="tab"
              aria-selected={graphView === 'easing'}
              class={`mge-mode-btn${graphView === 'easing' ? ' is-active' : ''}`}
              data-testid="mge-tab-easing"
              onClick={() => setGraphView('easing')}
            >
              Easing
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={graphView === 'value'}
              disabled={!canShowTrackGraphs}
              class={`mge-mode-btn${graphView === 'value' ? ' is-active' : ''}`}
              title={canShowTrackGraphs ? 'Edit keyframe values & curve tangents over time' : 'Select a numeric track keyframe to view Value Graph'}
              data-testid="mge-tab-value"
              onClick={() => canShowTrackGraphs && setGraphView('value')}
            >
              Value Graph
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={graphView === 'speed'}
              disabled={!canShowTrackGraphs}
              class={`mge-mode-btn${graphView === 'speed' ? ' is-active' : ''}`}
              title={canShowTrackGraphs ? 'Inspect and shape velocity & acceleration over time' : 'Select a numeric track keyframe to view Speed Graph'}
              data-testid="mge-tab-speed"
              onClick={() => canShowTrackGraphs && setGraphView('speed')}
            >
              Speed Graph
            </button>
          </div>

          {graphView === 'easing' && (
            <div class="mge-mode-seg" role="group" aria-label="Curve editing mode">
              <button
                type="button"
                class={`mge-mode-btn${editMode === 'cubic-bezier' ? ' is-active' : ''}`}
                aria-pressed={editMode === 'cubic-bezier'}
                onClick={() => handleSwitchMode('cubic-bezier')}
              >
                Bezier
              </button>
              <button
                type="button"
                class={`mge-mode-btn${editMode === 'multi-point' ? ' is-active' : ''}`}
                aria-pressed={editMode === 'multi-point'}
                onClick={() => handleSwitchMode('multi-point')}
              >
                Multi-Point
              </button>
            </div>
          )}

          <button
            type="button"
            class="mt-icon-btn"
            aria-label="Close Graph Editor"
            title="Close Graph Editor"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* VIEW 1: VALUE GRAPH & VIEW 2: SPEED GRAPH                             */}
      {/* ===================================================================== */}
      {graphView !== 'easing' && track && trackGraphData ? (
        <div class="mge-track-graph-body" data-testid={`mge-${graphView}-graph`}>
          {/* Top Metrics Strip */}
          <div class="mge-tg-metrics">
            <div class="mge-tg-stat">
              <span class="mge-tg-stat-k">Channel</span>
              <strong>{trackMeta?.label ?? track.property}</strong>
            </div>
            <div class="mge-tg-stat">
              <span class="mge-tg-stat-k">Playhead</span>
              <strong>{Math.round(playheadMs)}ms</strong>
            </div>
            <div class="mge-tg-stat">
              <span class="mge-tg-stat-k">Value</span>
              <strong>
                {round1(trackGraphData.liveVal)}
                {unitLabel}
              </strong>
            </div>
            <div class="mge-tg-stat is-accent">
              <span class="mge-tg-stat-k">Live Speed</span>
              <strong data-testid="mge-live-speed">
                {round1(trackGraphData.liveSpeed)} {speedUnitLabel}
              </strong>
            </div>
            <div class="mge-tg-stat">
              <span class="mge-tg-stat-k">Peak Speed</span>
              <strong data-testid="mge-peak-speed">
                {round1(trackGraphData.peakSpeed)} {speedUnitLabel}
              </strong>
            </div>
            <span class="mge-tg-guide">
              {graphView === 'value'
                ? 'Drag keyframe nodes to retime/revalue · Drag cyan/amber handles to bend curve'
                : 'Drag amber influence handles horizontally to accelerate/decelerate velocity peaks'}
            </span>
          </div>

          {/* Interactive SVG Canvas */}
          <div class="mge-tg-svg-frame">
            <svg
              ref={trackSvgRef}
              class="mge-tg-svg"
              viewBox={`0 0 ${TG_W} ${TG_H}`}
              role="img"
              aria-label={`${graphView === 'value' ? 'Value Graph' : 'Speed Graph'} for ${trackMeta?.label ?? track.property}`}
            >
              {/* Plot area background */}
              <rect
                x={TG_PAD_L}
                y={TG_PAD_T}
                width={TG_PLOT_W}
                height={TG_PLOT_H}
                fill="var(--canvas-bg)"
                fill-opacity="0.45"
                stroke="var(--line-strong)"
                stroke-opacity="0.55"
                stroke-width="1"
              />

              {/* Vertical time gridlines (0%, 25%, 50%, 75%, 100%) */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const gx = TG_PAD_L + frac * TG_PLOT_W;
                const ms = Math.round(frac * effectiveDurationMs);
                return (
                  <g key={`tg-gx-${frac}`}>
                    <line
                      x1={gx}
                      y1={TG_PAD_T}
                      x2={gx}
                      y2={TG_PAD_T + TG_PLOT_H}
                      stroke="var(--line-strong)"
                      stroke-opacity={frac === 0 || frac === 1 ? '0.55' : '0.28'}
                      stroke-dasharray={frac > 0 && frac < 1 ? '3 3' : undefined}
                      stroke-width="1"
                    />
                    <text x={gx} y={TG_H - 9} text-anchor="middle" class="mge-axis-label">
                      {ms >= 1000 ? `${round2(ms / 1000)}s` : `${ms}ms`}
                    </text>
                  </g>
                );
              })}

              {/* Horizontal value/speed gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const gy = TG_PAD_T + (1 - frac) * TG_PLOT_H;
                const labelVal =
                  graphView === 'value'
                    ? round1(trackGraphData.vMin + frac * (trackGraphData.vMax - trackGraphData.vMin))
                    : round1(frac * trackGraphData.sMax);
                return (
                  <g key={`tg-gy-${frac}`}>
                    <line
                      x1={TG_PAD_L}
                      y1={gy}
                      x2={TG_PAD_L + TG_PLOT_W}
                      y2={gy}
                      stroke="var(--line-strong)"
                      stroke-opacity={frac === 0 ? '0.6' : '0.25'}
                      stroke-width="1"
                    />
                    <text x={TG_PAD_L - 7} y={gy + 3} text-anchor="end" class="mge-axis-label">
                      {labelVal}
                      {graphView === 'value' ? unitLabel : ''}
                    </text>
                  </g>
                );
              })}

              {/* VALUE GRAPH CURVE & HANDLES */}
              {graphView === 'value' && (() => {
                const { valueSamples, vMin, vMax } = trackGraphData;
                const pathD = valueSamples
                  .map(
                    (pt, idx) =>
                      `${idx === 0 ? 'M' : 'L'}${tgTimeToX(pt.t).toFixed(1)},${tgValToY(pt.v, vMin, vMax).toFixed(1)}`,
                  )
                  .join(' ');
                const [sx1, sy1, sx2, sy2] = segEndKf ? easingToCubicBezier(segEndKf.easing) : [0.42, 0, 0.58, 1];
                const segStartVal = segStartKf ? Number(segStartKf.value) : 0;
                const segEndVal = segEndKf ? Number(segEndKf.value) : 0;
                const segSpanT = segStartKf && segEndKf ? segEndKf.timeMs - segStartKf.timeMs : 0;
                const segSpanV = segEndVal - segStartVal;
                const h1X = segStartKf ? tgTimeToX(segStartKf.timeMs + sx1 * segSpanT) : 0;
                const h1Y = segStartKf ? tgValToY(segStartVal + sy1 * segSpanV, vMin, vMax) : 0;
                const h2X = segStartKf ? tgTimeToX(segStartKf.timeMs + sx2 * segSpanT) : 0;
                const h2Y = segStartKf ? tgValToY(segStartVal + sy2 * segSpanV, vMin, vMax) : 0;

                return (
                  <>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--accent)"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />

                    {/* Active segment tangent handles */}
                    {segStartKf && segEndKf && segSpanT > 0 && (
                      <g class="mge-vg-tangents">
                        <line
                          x1={tgTimeToX(segStartKf.timeMs)}
                          y1={tgValToY(segStartVal, vMin, vMax)}
                          x2={h1X}
                          y2={h1Y}
                          stroke="var(--accent)"
                          stroke-opacity="0.8"
                          stroke-dasharray="3 2"
                          stroke-width="1.3"
                        />
                        <line
                          x1={tgTimeToX(segEndKf.timeMs)}
                          y1={tgValToY(segEndVal, vMin, vMax)}
                          x2={h2X}
                          y2={h2Y}
                          stroke="var(--studio-amber)"
                          stroke-opacity="0.85"
                          stroke-dasharray="3 2"
                          stroke-width="1.3"
                        />
                        <circle
                          class="mge-handle mge-handle-p1"
                          cx={h1X}
                          cy={h1Y}
                          r="6"
                          data-testid="mge-vg-handle-p1"
                          onPointerDown={(e) => handleValueTangentPointerDown('p1', e)}
                        />
                        <circle
                          class="mge-handle mge-handle-p2"
                          cx={h2X}
                          cy={h2Y}
                          r="6"
                          data-testid="mge-vg-handle-p2"
                          onPointerDown={(e) => handleValueTangentPointerDown('p2', e)}
                        />
                      </g>
                    )}

                    {/* Draggable keyframe nodes */}
                    {sortedTrackKfs.map((kf, idx) => {
                      const kx = tgTimeToX(kf.timeMs);
                      const ky = tgValToY(Number(kf.value), vMin, vMax);
                      const isSel = activeKf?.id === kf.id;
                      return (
                        <circle
                          key={kf.id}
                          class={`mge-tg-kf-node${isSel ? ' is-selected' : ''}`}
                          cx={kx}
                          cy={ky}
                          r={isSel ? '6.5' : '5'}
                          data-testid={`mge-vg-kf-${idx}`}
                          onPointerDown={(e) => handleValueNodePointerDown(idx, e)}
                        />
                      );
                    })}
                  </>
                );
              })()}

              {/* SPEED GRAPH CURVE & INFLUENCE HANDLES */}
              {graphView === 'speed' && (() => {
                const { speedSamples, sMax } = trackGraphData;
                const baseY = TG_PAD_T + TG_PLOT_H;
                const lineD = speedSamples
                  .map(
                    (pt, idx) =>
                      `${idx === 0 ? 'M' : 'L'}${tgTimeToX(pt.t).toFixed(1)},${tgSpeedToY(pt.s, sMax).toFixed(1)}`,
                  )
                  .join(' ');
                const areaD =
                  speedSamples.length > 0
                    ? `${lineD} L${tgTimeToX(speedSamples[speedSamples.length - 1].t).toFixed(1)},${baseY.toFixed(1)} L${tgTimeToX(speedSamples[0].t).toFixed(1)},${baseY.toFixed(1)} Z`
                    : '';

                const [sx1, sy1, sx2, sy2] = segEndKf ? easingToCubicBezier(segEndKf.easing) : [0.42, 0, 0.58, 1];
                const segSpanT = segStartKf && segEndKf ? segEndKf.timeMs - segStartKf.timeMs : 0;
                const outHandleX = segStartKf ? tgTimeToX(segStartKf.timeMs + sx1 * segSpanT) : 0;
                const outHandleY = baseY - clamp(sy1, 0, 1) * TG_PLOT_H * 0.72;
                const inHandleX = segStartKf ? tgTimeToX(segStartKf.timeMs + sx2 * segSpanT) : 0;
                const inHandleY = baseY - clamp(1 - sy2, 0, 1) * TG_PLOT_H * 0.72;

                return (
                  <>
                    {/* Area fill under velocity curve */}
                    {areaD && (
                      <path
                        d={areaD}
                        fill="var(--studio-amber)"
                        fill-opacity="0.16"
                      />
                    )}
                    {/* Velocity polyline */}
                    <path
                      d={lineD}
                      fill="none"
                      stroke="var(--studio-amber)"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />

                    {/* Keyframe markers on speed baseline */}
                    {sortedTrackKfs.map((kf, idx) => {
                      const kx = tgTimeToX(kf.timeMs);
                      const isSel = activeKf?.id === kf.id;
                      return (
                        <g key={kf.id}>
                          <line
                            x1={kx}
                            y1={TG_PAD_T}
                            x2={kx}
                            y2={baseY}
                            stroke={isSel ? 'var(--studio-amber)' : 'var(--line-strong)'}
                            stroke-opacity={isSel ? '0.65' : '0.35'}
                            stroke-dasharray="2 2"
                            stroke-width="1"
                          />
                          <circle
                            class={`mge-tg-kf-node is-speed${isSel ? ' is-selected' : ''}`}
                            cx={kx}
                            cy={baseY}
                            r={isSel ? '5.8' : '4.5'}
                            data-testid={`mge-sg-kf-${idx}`}
                            onClick={() => {
                              setActiveGraphKfId(kf.id);
                              onSelectKeyframe?.(kf.id);
                            }}
                          />
                        </g>
                      );
                    })}

                    {/* Interactive Speed / Influence handles for active segment */}
                    {segStartKf && segEndKf && segSpanT > 0 && (
                      <g class="mge-sg-tangents">
                        <line
                          x1={tgTimeToX(segStartKf.timeMs)}
                          y1={baseY}
                          x2={outHandleX}
                          y2={outHandleY}
                          stroke="var(--accent)"
                          stroke-width="1.8"
                        />
                        <line
                          x1={tgTimeToX(segEndKf.timeMs)}
                          y1={baseY}
                          x2={inHandleX}
                          y2={inHandleY}
                          stroke="var(--studio-amber)"
                          stroke-width="1.8"
                        />
                        <circle
                          class="mge-handle mge-handle-p1"
                          cx={outHandleX}
                          cy={outHandleY}
                          r="6.5"
                          data-testid="mge-sg-handle-out"
                          onPointerDown={(e) => handleSpeedInfluencePointerDown('out', e)}
                        />
                        <circle
                          class="mge-handle mge-handle-p2"
                          cx={inHandleX}
                          cy={inHandleY}
                          r="6.5"
                          data-testid="mge-sg-handle-in"
                          onPointerDown={(e) => handleSpeedInfluencePointerDown('in', e)}
                        />
                      </g>
                    )}
                  </>
                );
              })()}

              {/* Live Playhead cursor line */}
              <line
                x1={tgTimeToX(playheadMs)}
                y1={TG_PAD_T}
                x2={tgTimeToX(playheadMs)}
                y2={TG_PAD_T + TG_PLOT_H}
                stroke="var(--danger, #f87171)"
                stroke-width="1.4"
                stroke-dasharray="3 2"
                pointer-events="none"
              />
            </svg>
          </div>

          {/* Keyframe Precision Controls + Quick Velocity Presets */}
          <div class="mge-tg-footer">
            {activeKf && (
              <div class="mge-tg-kf-fields">
                <span class="mge-tg-kf-tag">
                  KF #{Math.max(1, activeKfIndex + 1)}/{sortedTrackKfs.length}
                </span>
                <label class="mge-tg-field">
                  <span>Time</span>
                  <input
                    type="number"
                    min={0}
                    max={effectiveDurationMs}
                    step={10}
                    aria-label="Keyframe time ms"
                    value={Math.round(activeKf.timeMs)}
                    onChange={(e) => {
                      const ms = Number.parseFloat(e.currentTarget.value);
                      if (Number.isFinite(ms)) {
                        commitTrackKeyframePatch(activeKf.id, { timeMs: ms }, 'Update keyframe time');
                      }
                    }}
                  />
                  <em>ms</em>
                </label>
                <label class="mge-tg-field">
                  <span>Value</span>
                  <input
                    type="number"
                    step={trackMeta?.step ?? 1}
                    aria-label="Keyframe value"
                    value={round2(Number(activeKf.value))}
                    onChange={(e) => {
                      const num = Number.parseFloat(e.currentTarget.value);
                      if (Number.isFinite(num)) {
                        commitTrackKeyframePatch(activeKf.id, { value: num }, 'Update keyframe value');
                      }
                    }}
                  />
                  {unitLabel && <em>{unitLabel}</em>}
                </label>
              </div>
            )}

            {segEndKf && (
              <div class="mge-tg-presets" role="group" aria-label="Quick velocity profiles">
                <span class="mge-tg-presets-label">Speed Profile</span>
                {SPEED_PROFILE_PRESETS.map((preset) => {
                  const isAct = areEasingsEqual(segEndKf.easing, preset.easing);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      class={`mge-tg-preset-btn${isAct ? ' is-active' : ''}`}
                      onClick={() =>
                        commitTrackKeyframePatch(
                          segEndKf.id,
                          { easing: preset.easing },
                          `Apply ${preset.label} velocity profile`,
                        )
                      }
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ===================================================================== */
        /* VIEW 3: EASING CURVE & 68-PRESET LIBRARY (ORIGINAL PRECISION EDITOR)  */
        /* ===================================================================== */
        <div class="mge-body">
          {/* LEFT COLUMN: Interactive SVG Graph + Live Preview + Numeric Bezier Precision */}
          <div class="mge-graph-col">
            <div class="mge-svg-frame">
              <svg
                ref={svgRef}
                class="mge-svg"
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                role="img"
                aria-label={`Easing curve graph for ${formatEasingLabel(value)}`}
                onDblClick={handleGraphDoubleClick}
              >
                {/* Subtle overshoot regions (y > 1 and y < 0) */}
                <rect
                  x={PAD_L}
                  y={PAD_T}
                  width={PLOT_W}
                  height={Math.max(0, yOneSvg - PAD_T)}
                  fill="var(--accent)"
                  fill-opacity="0.045"
                />
                <rect
                  x={PAD_L}
                  y={yZeroSvg}
                  width={PLOT_W}
                  height={Math.max(0, PAD_T + PLOT_H - yZeroSvg)}
                  fill="var(--accent)"
                  fill-opacity="0.045"
                />

                {/* Vertical time grid (0.25, 0.5, 0.75) */}
                {[0.25, 0.5, 0.75].map((gx) => (
                  <line
                    key={`gx-${gx}`}
                    x1={toSvgX(gx)}
                    y1={PAD_T}
                    x2={toSvgX(gx)}
                    y2={PAD_T + PLOT_H}
                    stroke="var(--line-strong)"
                    stroke-opacity="0.35"
                    stroke-width="1"
                  />
                ))}

                {/* Horizontal value grid (0, 0.5, 1) */}
                {[0, 0.5, 1].map((gy) => (
                  <line
                    key={`gy-${gy}`}
                    x1={PAD_L}
                    y1={toSvgY(gy)}
                    x2={PAD_L + PLOT_W}
                    y2={toSvgY(gy)}
                    stroke="var(--line-strong)"
                    stroke-opacity={gy === 0.5 ? '0.32' : '0.75'}
                    stroke-dasharray={gy === 0.5 ? '3 3' : undefined}
                    stroke-width="1"
                  />
                ))}

                {/* Unit bounding box (0..1 x 0..1) */}
                <rect
                  x={xZeroSvg}
                  y={yOneSvg}
                  width={PLOT_W}
                  height={yZeroSvg - yOneSvg}
                  fill="none"
                  stroke="var(--line-strong)"
                  stroke-opacity="0.7"
                  stroke-width="1"
                />

                {/* Linear reference diagonal */}
                <line
                  x1={xZeroSvg}
                  y1={yZeroSvg}
                  x2={xOneSvg}
                  y2={yOneSvg}
                  stroke="var(--line-strong)"
                  stroke-opacity="0.45"
                  stroke-dasharray="4 4"
                  stroke-width="1"
                />

                {/* Axis labels */}
                <text x={PAD_L - 6} y={yOneSvg + 3} text-anchor="end" class="mge-axis-label">1</text>
                <text x={PAD_L - 6} y={yZeroSvg + 3} text-anchor="end" class="mge-axis-label">0</text>
                <text x={xZeroSvg} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">0%</text>
                <text x={toSvgX(0.5)} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">50%</text>
                <text x={xOneSvg} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">100%</text>

                {/* Main precision curve */}
                <path
                  d={curvePath}
                  fill="none"
                  stroke="var(--accent)"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />

                {/* Animated playhead dot tracing the curve */}
                <circle
                  cx={toSvgX(previewProgress)}
                  cy={toSvgY(evaluateEasing(value, previewProgress))}
                  r="3.5"
                  fill="var(--panel)"
                  stroke="var(--accent)"
                  stroke-width="1.8"
                />

                {/* Start (0,0) and End (1,1) anchor points */}
                <circle cx={xZeroSvg} cy={yZeroSvg} r="3.8" fill="var(--panel)" stroke="var(--text-primary)" stroke-width="1.6" />
                <circle cx={xOneSvg} cy={yOneSvg} r="3.8" fill="var(--panel)" stroke="var(--text-primary)" stroke-width="1.6" />

                {/* Cubic Bezier handles */}
                {editMode === 'cubic-bezier' && (
                  <>
                    <line
                      x1={xZeroSvg}
                      y1={yZeroSvg}
                      x2={toSvgX(x1)}
                      y2={toSvgY(y1)}
                      stroke="var(--accent)"
                      stroke-opacity="0.72"
                      stroke-dasharray="3 2"
                      stroke-width="1.2"
                    />
                    <line
                      x1={xOneSvg}
                      y1={yOneSvg}
                      x2={toSvgX(x2)}
                      y2={toSvgY(y2)}
                      stroke="var(--studio-amber)"
                      stroke-opacity="0.78"
                      stroke-dasharray="3 2"
                      stroke-width="1.2"
                    />
                    <circle
                      class="mge-handle mge-handle-p1"
                      cx={toSvgX(x1)}
                      cy={toSvgY(y1)}
                      r="6.5"
                      data-testid="mge-handle-p1"
                      onPointerDown={(e) => handleBezierHandlePointerDown('p1', e)}
                    />
                    <circle
                      class="mge-handle mge-handle-p2"
                      cx={toSvgX(x2)}
                      cy={toSvgY(y2)}
                      r="6.5"
                      data-testid="mge-handle-p2"
                      onPointerDown={(e) => handleBezierHandlePointerDown('p2', e)}
                    />
                  </>
                )}

                {/* Multi-Point interior stops */}
                {editMode === 'multi-point' &&
                  multiPoints.map((stop, idx) => {
                    if (idx === 0 || idx === multiPoints.length - 1) return null;
                    const isSel = selectedStopIndex === idx;
                    return (
                      <circle
                        key={`stop-${idx}-${stop.x}`}
                        class={`mge-handle mge-stop-handle${isSel ? ' is-selected' : ''}`}
                        cx={toSvgX(stop.x)}
                        cy={toSvgY(stop.y)}
                        r={isSel ? '6.5' : '5.5'}
                        onPointerDown={(e) => handleMultiStopPointerDown(idx, e)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          handleDeleteStop(idx);
                        }}
                      />
                    );
                  })}
              </svg>
            </div>

            {editMode === 'multi-point' && (
              <div class="mge-multipoint-bar">
                <span class="mge-hint-text">Double-click graph to add stop · Drag stops · Right-click to delete</span>
                {selectedStopIndex !== null && (
                  <button
                    type="button"
                    class="mt-btn mt-danger-btn"
                    onClick={() => handleDeleteStop(selectedStopIndex)}
                  >
                    Delete Stop #{selectedStopIndex}
                  </button>
                )}
              </div>
            )}

            {/* Live Velocity Preview Track */}
            <div class="mge-preview-strip" aria-label="Live velocity preview">
              <button
                type="button"
                class="mge-preview-toggle"
                aria-label={previewPlaying ? 'Pause curve preview' : 'Play curve preview'}
                title={previewPlaying ? 'Pause live velocity preview' : 'Play live velocity preview'}
                onClick={() => setPreviewPlaying((p) => !p)}
              >
                {previewPlaying ? '❚❚' : '▶'}
              </button>
              <div class="mge-preview-track">
                <span class="mge-preview-rail" />
                <span class="mge-preview-marker start" />
                <span class="mge-preview-marker end" />
                <span class="mge-preview-ball" style={{ left: `${ballLeftPct}%` }} />
              </div>
            </div>

            {/* Numeric Precision Inputs for Cubic Bezier */}
            <div class="mge-bezier-inputs" aria-label="Cubic Bezier coordinates">
              {(
                [
                  { key: 'x1', label: 'X1', val: x1, min: 0, max: 1 },
                  { key: 'y1', label: 'Y1', val: y1, min: Y_MIN, max: Y_MAX },
                  { key: 'x2', label: 'X2', val: x2, min: 0, max: 1 },
                  { key: 'y2', label: 'Y2', val: y2, min: Y_MIN, max: Y_MAX },
                ] as const
              ).map((field) => (
                <label key={field.key} class="mge-coord-field">
                  <span>{field.label}</span>
                  <input
                    type="number"
                    step="0.01"
                    min={field.min}
                    max={field.max}
                    aria-label={`Bezier ${field.label}`}
                    value={round2(field.val)}
                    onChange={(e) => {
                      const num = Number.parseFloat(e.currentTarget.value);
                      if (!Number.isFinite(num)) return;
                      setEditMode('cubic-bezier');
                      if (field.key === 'x1') emitBezier(num, y1, x2, y2);
                      else if (field.key === 'y1') emitBezier(x1, num, x2, y2);
                      else if (field.key === 'x2') emitBezier(x1, y1, num, y2);
                      else emitBezier(x1, y1, x2, num);
                    }}
                  />
                </label>
              ))}
            </div>

            <div class="mge-css-readout" title={cssTimingString}>
              <span class="mge-css-kicker">CSS</span>
              <code>{cssTimingString}</code>
            </div>
          </div>

          {/* RIGHT COLUMN: Categorized Preset Thumbnails + Search + My Custom */}
          <div class="mge-presets-col">
            <div class="mge-tabs" role="tablist" aria-label="Easing preset categories">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'all'}
                class={`mge-tab-btn${activeTab === 'all' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All ({EASING_PRESET_CATALOG.length})
              </button>
              {EASING_CATEGORY_META.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === cat.id}
                  class={`mge-tab-btn${activeTab === cat.id ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(cat.id)}
                >
                  {cat.shortLabel}
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'custom'}
                class={`mge-tab-btn${activeTab === 'custom' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('custom')}
              >
                Custom ({customEasings.length})
              </button>
            </div>

            {activeTab !== 'custom' ? (
              <>
                <div class="mge-search-row">
                  <input
                    type="search"
                    class="mge-search-input"
                    aria-label="Search easing templates"
                    placeholder="Search 68 curves (spring, bounce, ios, material, expo, steps)…"
                    value={presetQuery}
                    onInput={(e) => setPresetQuery(e.currentTarget.value)}
                  />
                  <span class="mge-search-count">{visibleCatalogPresets.length}</span>
                </div>
                {visibleCatalogPresets.length === 0 ? (
                  <div class="mge-custom-empty">
                    No easing presets match "{presetQuery}". Try "spring", "ios", "bounce", or "expo".
                  </div>
                ) : (
                  <div class="mge-preset-grid" role="listbox" aria-label={`${activeTab} easing presets`}>
                    {visibleCatalogPresets.map((preset) => {
                      const isActive = areEasingsEqual(value, preset.id);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          class={`mge-preset-card${isActive ? ' is-active' : ''}`}
                          title={`${preset.label} — ${preset.description}`}
                          onClick={() => {
                            setEditMode('cubic-bezier');
                            onChange(preset.id);
                          }}
                        >
                          <EasingCurveMiniSvg easing={preset.id} width={44} height={28} />
                          <span class="mge-preset-name">{preset.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div class="mge-custom-panel">
                <div class="mge-custom-save-row">
                  <input
                    type="text"
                    class="mge-custom-name-input"
                    aria-label="Custom curve name"
                    placeholder="Name current curve…"
                    maxLength={32}
                    value={customNameDraft}
                    onInput={(e) => setCustomNameDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCustomCurve();
                    }}
                  />
                  <button
                    type="button"
                    class="mt-btn mt-cta-btn"
                    onClick={handleSaveCustomCurve}
                  >
                    Save Curve
                  </button>
                </div>
                {customEasings.length === 0 ? (
                  <div class="mge-custom-empty">
                    Shape any Bezier or Multi-Point curve on the left, then save it here for instant reuse across your project.
                  </div>
                ) : (
                  <div class="mge-preset-grid" role="listbox" aria-label="Saved custom easing presets">
                    {customEasings.map((preset) => {
                      const isActive = areEasingsEqual(value, preset.easing);
                      return (
                        <div key={preset.id} class={`mge-custom-card-wrap${isActive ? ' is-active' : ''}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            class={`mge-preset-card${isActive ? ' is-active' : ''}`}
                            title={`${preset.name} (${formatEasingLabel(preset.easing)})`}
                            onClick={() => {
                              if (
                                typeof preset.easing === 'object' &&
                                preset.easing !== null &&
                                preset.easing.type === 'multi-point'
                              ) {
                                setEditMode('multi-point');
                              } else {
                                setEditMode('cubic-bezier');
                              }
                              onChange(preset.easing);
                            }}
                          >
                            <EasingCurveMiniSvg easing={preset.easing} width={44} height={28} />
                            <span class="mge-preset-name">{preset.name}</span>
                          </button>
                          <button
                            type="button"
                            class="mge-custom-del-btn"
                            aria-label={`Delete custom curve ${preset.name}`}
                            title={`Delete "${preset.name}"`}
                            onClick={() => handleDeleteCustomCurve(preset.id, preset.name)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(popover, document.body);
  }
  return popover;
}

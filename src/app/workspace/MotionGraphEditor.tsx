import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AnimationEasing,
  CubicBezierEasing,
  CustomEasingPreset,
  MultiPointEasing,
  MultiPointEasingStop,
} from '../../core/document/types';
import {
  EASING_CATEGORY_META,
  EASING_PRESET_CATALOG,
  areEasingsEqual,
  easingToCubicBezier,
  evaluateEasing,
  formatEasingLabel,
  sampleEasingCurve,
  toCssTimingFunction,
  type EasingPresetCategory,
} from '../../engines/animation';

export interface MotionGraphEditorProps {
  value: AnimationEasing;
  title: string;
  customEasings: readonly CustomEasingPreset[];
  onChange: (nextEasing: AnimationEasing, coalesceKey?: string) => void;
  onUpdateCustomEasings: (nextCustomEasings: readonly CustomEasingPreset[], description?: string) => void;
  onClose: () => void;
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  const r = Math.round(val * 100) / 100;
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
        stroke="#4A5568"
        stroke-opacity="0.35"
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

export function MotionGraphEditor({
  value,
  title,
  customEasings,
  onChange,
  onUpdateCustomEasings,
  onClose,
}: MotionGraphEditorProps) {
  const isMultiPointValue = typeof value === 'object' && value !== null && value.type === 'multi-point';
  const [editMode, setEditMode] = useState<GraphEditMode>(isMultiPointValue ? 'multi-point' : 'cubic-bezier');
  const [activeTab, setActiveTab] = useState<PresetTabId>('all');
  const [presetQuery, setPresetQuery] = useState('');
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [customNameDraft, setCustomNameDraft] = useState('');

  const svgRef = useRef<SVGSVGElement | null>(null);
  const valueRef = useRef<AnimationEasing>(value);
  valueRef.current = value;

  useEffect(() => {
    if (isMultiPointValue) {
      setEditMode('multi-point');
    } else if (typeof value === 'object' && value !== null && value.type === 'cubic-bezier') {
      setEditMode('cubic-bezier');
    }
  }, [isMultiPointValue, value]);

  // Lightweight live velocity preview loop (only active while popover is mounted & playing)
  useEffect(() => {
    if (!previewPlaying) return;
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
  }, [previewPlaying]);

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

  const yZeroSvg = toSvgY(0);
  const yOneSvg = toSvgY(1);
  const xZeroSvg = toSvgX(0);
  const xOneSvg = toSvgX(1);

  const popover = (
    <div
      class="mge-popover"
      role="dialog"
      aria-label={`Easing Graph Editor — ${title}`}
      data-testid="motion-graph-editor"
    >
      <header class="mge-header">
        <div class="mge-title-wrap">
          <span class="mge-title-badge">GRAPH</span>
          <strong class="mge-title">{title}</strong>
          <span class="mge-active-pill">{formatEasingLabel(value)}</span>
        </div>
        <div class="mge-header-actions">
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
          <button
            type="button"
            class="mt-icon-btn"
            aria-label="Close Easing Graph Editor"
            title="Close Graph Editor"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

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
                fill="#00E5FF"
                fill-opacity="0.035"
              />
              <rect
                x={PAD_L}
                y={yZeroSvg}
                width={PLOT_W}
                height={Math.max(0, PAD_T + PLOT_H - yZeroSvg)}
                fill="#00E5FF"
                fill-opacity="0.035"
              />

              {/* Vertical time grid (0.25, 0.5, 0.75) */}
              {[0.25, 0.5, 0.75].map((gx) => (
                <line
                  key={`gx-${gx}`}
                  x1={toSvgX(gx)}
                  y1={PAD_T}
                  x2={toSvgX(gx)}
                  y2={PAD_T + PLOT_H}
                  stroke="#4A5568"
                  stroke-opacity="0.3"
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
                  stroke="#4A5568"
                  stroke-opacity={gy === 0.5 ? '0.28' : '0.65'}
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
                stroke="#4A5568"
                stroke-opacity="0.6"
                stroke-width="1"
              />

              {/* Linear reference diagonal */}
              <line
                x1={xZeroSvg}
                y1={yZeroSvg}
                x2={xOneSvg}
                y2={yOneSvg}
                stroke="#4A5568"
                stroke-opacity="0.35"
                stroke-dasharray="4 4"
                stroke-width="1"
              />

              {/* Axis labels */}
              <text x={PAD_L - 6} y={yOneSvg + 3} text-anchor="end" class="mge-axis-label">1</text>
              <text x={PAD_L - 6} y={yZeroSvg + 3} text-anchor="end" class="mge-axis-label">0</text>
              <text x={xZeroSvg} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">0%</text>
              <text x={toSvgX(0.5)} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">50%</text>
              <text x={xOneSvg} y={SVG_H - 6} text-anchor="middle" class="mge-axis-label">100%</text>

              {/* Soft glow under active curve */}
              <path
                d={curvePath}
                fill="none"
                stroke="#00E5FF"
                stroke-opacity="0.22"
                stroke-width="6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              {/* Main #00E5FF curve */}
              <path
                d={curvePath}
                fill="none"
                stroke="#00E5FF"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              {/* Animated playhead dot tracing the curve */}
              <circle
                cx={toSvgX(previewProgress)}
                cy={toSvgY(evaluateEasing(value, previewProgress))}
                r="3.5"
                fill="#FFFFFF"
                stroke="#00E5FF"
                stroke-width="1.5"
              />

              {/* Start (0,0) and End (1,1) anchor points */}
              <circle cx={xZeroSvg} cy={yZeroSvg} r="4" fill="#12161A" stroke="#E2E8F0" stroke-width="1.8" />
              <circle cx={xOneSvg} cy={yOneSvg} r="4" fill="#12161A" stroke="#E2E8F0" stroke-width="1.8" />

              {/* Cubic Bezier handles */}
              {editMode === 'cubic-bezier' && (
                <>
                  <line
                    x1={xZeroSvg}
                    y1={yZeroSvg}
                    x2={toSvgX(x1)}
                    y2={toSvgY(y1)}
                    stroke="#00E5FF"
                    stroke-opacity="0.7"
                    stroke-dasharray="3 2"
                    stroke-width="1.2"
                  />
                  <line
                    x1={xOneSvg}
                    y1={yOneSvg}
                    x2={toSvgX(x2)}
                    y2={toSvgY(y2)}
                    stroke="#A855F7"
                    stroke-opacity="0.75"
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
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(popover, document.body);
  }
  return popover;
}

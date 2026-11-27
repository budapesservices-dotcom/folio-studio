/**
 * FOLIO Path Studio — Pure Framework-Independent Geometry & Evaluation Engine
 *
 * Powers FOLIO Studio's unified path animation capabilities inside the single
 * Native Path & Animation Engine:
 *   1. Motion Path: cubic Bézier arc-length reparameterization (Constant Speed),
 *      tangent-aligned Auto Orient, Start/End windowing, Reverse, Perpendicular Offset,
 *      Loop / Ping-Pong, and direct on-canvas anchor/handle editing with exact
 *      de Casteljau point insertion and Corner/Smooth/Symmetric handle constraints.
 *   2. Trim Path: arc-length calculation for single & compound vector paths and
 *      geometric shapes, wrap-around offset math, Simultaneous vs Sequential
 *      multi-contour distribution, and SVG stroke-dasharray / stroke-dashoffset
 *      compilation.
 *
 * Strictly framework-independent (no DOM, no Preact).
 */

import type {
  DesignNode,
  MotionPathBinding,
  MotionPathLoopMode,
  PathNode,
  TrimPathMode,
  VectorAnchorPoint,
  VectorPointHandle,
  VectorPointType,
  VectorSubpath,
} from './types';

export interface CubicSegment2D {
  readonly p0x: number;
  readonly p0y: number;
  readonly c1x: number;
  readonly c1y: number;
  readonly c2x: number;
  readonly c2y: number;
  readonly p3x: number;
  readonly p3y: number;
}

export interface ArcLengthSample {
  readonly segmentIndex: number;
  readonly localT: number;
  readonly distance: number;
  readonly x: number;
  readonly y: number;
}

export interface PathArcLengthTable {
  readonly segments: readonly CubicSegment2D[];
  readonly samples: readonly ArcLengthSample[];
  readonly totalLength: number;
}

export interface MotionPathSample {
  /** World X coordinate (after perpendicular offsetPx). */
  readonly x: number;
  /** World Y coordinate (after perpendicular offsetPx). */
  readonly y: number;
  /** Curve point X before perpendicular offset. */
  readonly baseX: number;
  /** Curve point Y before perpendicular offset. */
  readonly baseY: number;
  /** Tangent angle in degrees (`atan2(dy, dx) * 180 / PI`), flipped 180° if reversed. */
  readonly tangentAngleDeg: number;
  /** Unit normal X perpendicular to travel direction. */
  readonly normalX: number;
  /** Unit normal Y perpendicular to travel direction. */
  readonly normalY: number;
  /** Effective normalized curve fraction in [0, 1] after loop/window/reverse. */
  readonly curveFraction: number;
  /** Total geometric arc length of the path in px. */
  readonly totalLength: number;
}

export interface MotionPathChevron {
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
}

export interface MotionPathProjection {
  readonly segmentIndex: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

export interface TrimInterval {
  /** Normalized start in [0, 1]. */
  readonly start: number;
  /** Normalized end in [0, 1]. */
  readonly end: number;
}

export interface SvgTrimDashResult {
  readonly visible: boolean;
  readonly full: boolean;
  readonly dasharray?: string;
  readonly dashoffset?: number;
}

const DEFAULT_LUT_STEPS_PER_SEGMENT = 48;
const EPS = 1e-6;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function makePathStudioPointId(prefix = 'mp'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

// ============================================================================
// 1. CUBIC BÉZIER SEGMENT MATH & ARC-LENGTH LUT
// ============================================================================

export function extractCubicSegments(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
): CubicSegment2D[] {
  const n = points.length;
  if (n < 2) return [];
  const segCount = closed ? n : n - 1;
  const segments: CubicSegment2D[] = [];
  for (let i = 0; i < segCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c1 = a.handleOut ?? { x: a.x, y: a.y };
    const c2 = b.handleIn ?? { x: b.x, y: b.y };
    segments.push({
      p0x: a.x,
      p0y: a.y,
      c1x: c1.x,
      c1y: c1.y,
      c2x: c2.x,
      c2y: c2.y,
      p3x: b.x,
      p3y: b.y,
    });
  }
  return segments;
}

export function evaluateCubicPoint(
  seg: CubicSegment2D,
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * seg.p0x + 3 * u2 * t * seg.c1x + 3 * u * t2 * seg.c2x + t3 * seg.p3x,
    y: u3 * seg.p0y + 3 * u2 * t * seg.c1y + 3 * u * t2 * seg.c2y + t3 * seg.p3y,
  };
}

export function evaluateCubicDerivative(
  seg: CubicSegment2D,
  t: number,
): { dx: number; dy: number } {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  let dx =
    3 * u2 * (seg.c1x - seg.p0x) +
    6 * u * t * (seg.c2x - seg.c1x) +
    3 * t2 * (seg.p3x - seg.c2x);
  let dy =
    3 * u2 * (seg.c1y - seg.p0y) +
    6 * u * t * (seg.c2y - seg.c1y) +
    3 * t2 * (seg.p3y - seg.c2y);

  // Fallback for degenerate endpoints where control handle coincides with anchor
  if (Math.hypot(dx, dy) < EPS) {
    const dt = t < 0.5 ? 0.002 : -0.002;
    const tAlt = clamp(t + dt, 0, 1);
    const pA = evaluateCubicPoint(seg, t);
    const pB = evaluateCubicPoint(seg, tAlt);
    dx = (pB.x - pA.x) * (dt > 0 ? 1 : -1);
    dy = (pB.y - pA.y) * (dt > 0 ? 1 : -1);
  }
  if (Math.hypot(dx, dy) < EPS) {
    dx = seg.p3x - seg.p0x;
    dy = seg.p3y - seg.p0y;
  }
  return { dx, dy };
}

export function buildPathArcLengthTable(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
  stepsPerSegment = DEFAULT_LUT_STEPS_PER_SEGMENT,
): PathArcLengthTable {
  const segments = extractCubicSegments(points, closed);
  if (segments.length === 0) {
    return { segments: [], samples: [], totalLength: 0 };
  }
  const steps = Math.max(8, Math.round(stepsPerSegment));
  const samples: ArcLengthSample[] = [];
  let distance = 0;
  let prevX = segments[0].p0x;
  let prevY = segments[0].p0y;

  samples.push({
    segmentIndex: 0,
    localT: 0,
    distance: 0,
    x: prevX,
    y: prevY,
  });

  for (let sIdx = 0; sIdx < segments.length; sIdx += 1) {
    const seg = segments[sIdx];
    for (let step = 1; step <= steps; step += 1) {
      const localT = step / steps;
      const pt = evaluateCubicPoint(seg, localT);
      distance += Math.hypot(pt.x - prevX, pt.y - prevY);
      samples.push({
        segmentIndex: sIdx,
        localT,
        distance,
        x: pt.x,
        y: pt.y,
      });
      prevX = pt.x;
      prevY = pt.y;
    }
  }

  return {
    segments,
    samples,
    totalLength: distance,
  };
}

export function computeVectorContourLength(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
): number {
  return buildPathArcLengthTable(points, closed, 32).totalLength;
}

/**
 * Resolves a normalized progress value `p` (where 0..1 is one cycle, and values
 * outside [0, 1] may occur for overshoot or multi-cycle inputs) according to
 * `loopMode`.
 */
export function resolveMotionPathLoopProgress(
  rawProgress01: number,
  loopMode: MotionPathLoopMode,
): { progress01: number; pingPongReversed: boolean } {
  if (!Number.isFinite(rawProgress01)) {
    return { progress01: 0, pingPongReversed: false };
  }
  if (loopMode === 'ping-pong') {
    // One full clip pass (0 -> 1) goes forward (0 -> 1) then back (1 -> 0).
    // Supports continuous values beyond 1 as well.
    const scaled = rawProgress01 * 2;
    const mod = ((scaled % 2) + 2) % 2;
    if (rawProgress01 >= 1 - EPS && Math.abs(rawProgress01 - Math.round(rawProgress01)) < EPS) {
      return { progress01: 0, pingPongReversed: true };
    }
    if (mod <= 1) {
      return { progress01: mod, pingPongReversed: false };
    }
    return { progress01: 2 - mod, pingPongReversed: true };
  }
  if (loopMode === 'loop') {
    if (rawProgress01 >= 0 && rawProgress01 <= 1) {
      return { progress01: rawProgress01, pingPongReversed: false };
    }
    const wrapped = ((rawProgress01 % 1) + 1) % 1;
    return { progress01: wrapped, pingPongReversed: false };
  }
  return { progress01: clamp(rawProgress01, 0, 1), pingPongReversed: false };
}

/**
 * Evaluates a `MotionPathBinding` at `progressPct` (`0..100`).
 * Supports Constant Speed (arc-length LUT binary search) and Parametric Speed,
 * Start/End range windowing, Reverse Path, Perpendicular Path Offset, Auto Orient
 * tangent angles, and Loop / Ping-Pong modes.
 */
export function evaluateMotionPathAtProgress(
  binding: MotionPathBinding,
  progressPct: number,
  cachedTable?: PathArcLengthTable,
): MotionPathSample | null {
  const table = cachedTable ?? buildPathArcLengthTable(binding.points, binding.closed);
  if (table.segments.length === 0) {
    const pt = binding.points[0];
    if (!pt) return null;
    return {
      x: pt.x,
      y: pt.y,
      baseX: pt.x,
      baseY: pt.y,
      tangentAngleDeg: 0,
      normalX: 0,
      normalY: 1,
      curveFraction: 0,
      totalLength: 0,
    };
  }

  const raw01 = progressPct / 100;
  const { progress01, pingPongReversed } = resolveMotionPathLoopProgress(
    raw01,
    binding.loopMode,
  );

  const startF = clamp(binding.startPct, 0, 100) / 100;
  const endF = clamp(binding.endPct, 0, 100) / 100;
  const dirProgress = binding.reverse ? 1 - progress01 : progress01;
  const curveFraction = clamp(startF + (endF - startF) * dirProgress, 0, 1);

  const effectiveBackward =
    (binding.reverse !== pingPongReversed) !== (endF < startF);

  let segIndex = 0;
  let localT = 0;

  if (binding.constantSpeed && table.totalLength > EPS && table.samples.length >= 2) {
    const targetDist = curveFraction * table.totalLength;
    let lo = 0;
    let hi = table.samples.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (table.samples[mid].distance <= targetDist) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const sA = table.samples[lo];
    const sB = table.samples[hi];
    const span = sB.distance - sA.distance;
    const alpha = span > EPS ? clamp((targetDist - sA.distance) / span, 0, 1) : 0;
    if (sA.segmentIndex === sB.segmentIndex) {
      segIndex = sA.segmentIndex;
      localT = sA.localT + (sB.localT - sA.localT) * alpha;
    } else {
      // Crossed segment boundary from sA (localT=1 on prev or 0) to sB
      segIndex = sB.segmentIndex;
      localT = sB.localT * alpha;
    }
  } else {
    const segCount = table.segments.length;
    const scaled = curveFraction * segCount;
    segIndex = Math.min(segCount - 1, Math.floor(scaled));
    localT = clamp(scaled - segIndex, 0, 1);
  }

  const seg = table.segments[segIndex];
  const base = evaluateCubicPoint(seg, localT);
  const deriv = evaluateCubicDerivative(seg, localT);
  const dirSign = effectiveBackward ? -1 : 1;
  const tx = deriv.dx * dirSign;
  const ty = deriv.dy * dirSign;
  const tLen = Math.hypot(tx, ty);
  const ux = tLen > EPS ? tx / tLen : 1;
  const uy = tLen > EPS ? ty / tLen : 0;
  // Right-hand perpendicular unit normal in screen coords (Y down)
  const normalX = -uy;
  const normalY = ux;
  const tangentAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  const offset = Number.isFinite(binding.offsetPx) ? binding.offsetPx : 0;

  return {
    x: base.x + normalX * offset,
    y: base.y + normalY * offset,
    baseX: base.x,
    baseY: base.y,
    tangentAngleDeg,
    normalX,
    normalY,
    curveFraction,
    totalLength: table.totalLength,
  };
}

// ============================================================================
// 2. DIRECT CANVAS MOTION PATH CREATION & EDITING OPERATIONS
// ============================================================================

/**
 * Creates a smooth S-curve Motion Path starting at the node's current center
 * so users can immediately see, preview, and edit the path on Canvas.
 */
export function createDefaultMotionPathForNode(
  node: DesignNode,
  docWidth = 1280,
  docHeight = 720,
): MotionPathBinding {
  const cx = round2(node.x + node.width / 2);
  const cy = round2(node.y + node.height / 2);
  const spanX = Math.max(180, Math.min(360, docWidth * 0.32));
  const dirX = cx + spanX > docWidth - 40 ? -1 : 1;
  const arcY = Math.max(64, Math.min(120, docHeight * 0.14));
  const midX = round2(cx + dirX * spanX * 0.5);
  const endX = round2(cx + dirX * spanX);
  const midY = round2(clamp(cy - arcY, 48, Math.max(96, docHeight - 48)));
  const endY = round2(clamp(cy + arcY * 0.35, 48, Math.max(96, docHeight - 48)));

  const p0: VectorAnchorPoint = {
    id: makePathStudioPointId('mp'),
    x: cx,
    y: cy,
    handleOut: { x: round2(cx + dirX * spanX * 0.2), y: round2(cy - arcY * 0.85) },
    pointType: 'smooth',
  };
  const p1: VectorAnchorPoint = {
    id: makePathStudioPointId('mp'),
    x: midX,
    y: midY,
    handleIn: { x: round2(midX - dirX * spanX * 0.18), y: midY },
    handleOut: { x: round2(midX + dirX * spanX * 0.18), y: midY },
    pointType: 'symmetric',
  };
  const p2: VectorAnchorPoint = {
    id: makePathStudioPointId('mp'),
    x: endX,
    y: endY,
    handleIn: { x: round2(endX - dirX * spanX * 0.2), y: round2(endY + arcY * 0.4) },
    pointType: 'smooth',
  };

  return {
    id: `mpath-${node.id}-${Date.now().toString(36)}`,
    targetNodeId: node.id,
    points: [p0, p1, p2],
    closed: false,
    autoOrient: true,
    orientOffsetDeg: 0,
    reverse: false,
    startPct: 0,
    endPct: 100,
    offsetPx: 0,
    constantSpeed: true,
    loopMode: 'none',
    visible: true,
  };
}

/**
 * Converts an existing `PathNode` on the page into a world-space `MotionPathBinding`
 * for `targetNodeId`.
 */
export function createMotionPathFromPathNode(
  targetNodeId: string,
  pathNode: PathNode,
): MotionPathBinding {
  const worldPoints: VectorAnchorPoint[] = pathNode.points.map((pt, idx) => ({
    id: pt.id || makePathStudioPointId(`mp${idx}`),
    x: round2(pathNode.x + pt.x),
    y: round2(pathNode.y + pt.y),
    ...(pt.handleIn
      ? { handleIn: { x: round2(pathNode.x + pt.handleIn.x), y: round2(pathNode.y + pt.handleIn.y) } }
      : {}),
    ...(pt.handleOut
      ? { handleOut: { x: round2(pathNode.x + pt.handleOut.x), y: round2(pathNode.y + pt.handleOut.y) } }
      : {}),
    pointType: pt.pointType,
  }));

  return {
    id: `mpath-${targetNodeId}-${Date.now().toString(36)}`,
    targetNodeId,
    points: worldPoints,
    closed: pathNode.closed,
    sourcePathNodeId: pathNode.id,
    autoOrient: true,
    orientOffsetDeg: 0,
    reverse: false,
    startPct: 0,
    endPct: 100,
    offsetPx: 0,
    constantSpeed: true,
    loopMode: 'none',
    visible: true,
  };
}

export function moveMotionPathAnchor(
  binding: MotionPathBinding,
  pointIndex: number,
  worldX: number,
  worldY: number,
): MotionPathBinding {
  if (pointIndex < 0 || pointIndex >= binding.points.length) return binding;
  const pt = binding.points[pointIndex];
  const dx = round2(worldX) - pt.x;
  const dy = round2(worldY) - pt.y;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return binding;

  const nextPoints = binding.points.map((item, idx) => {
    if (idx !== pointIndex) return item;
    return {
      ...item,
      x: round2(item.x + dx),
      y: round2(item.y + dy),
      ...(item.handleIn
        ? { handleIn: { x: round2(item.handleIn.x + dx), y: round2(item.handleIn.y + dy) } }
        : {}),
      ...(item.handleOut
        ? { handleOut: { x: round2(item.handleOut.x + dx), y: round2(item.handleOut.y + dy) } }
        : {}),
    };
  });
  return { ...binding, points: nextPoints };
}

export function moveMotionPathHandle(
  binding: MotionPathBinding,
  pointIndex: number,
  handleKind: 'in' | 'out',
  worldX: number,
  worldY: number,
  breakSmooth = false,
): MotionPathBinding {
  if (pointIndex < 0 || pointIndex >= binding.points.length) return binding;
  const nextHandle: VectorPointHandle = { x: round2(worldX), y: round2(worldY) };

  const nextPoints = binding.points.map((pt, idx) => {
    if (idx !== pointIndex) return pt;
    const effectiveType: VectorPointType = breakSmooth ? 'corner' : pt.pointType;
    const vx = nextHandle.x - pt.x;
    const vy = nextHandle.y - pt.y;
    const vLen = Math.hypot(vx, vy);

    if (effectiveType === 'corner') {
      return {
        ...pt,
        pointType: effectiveType,
        ...(handleKind === 'in' ? { handleIn: nextHandle } : { handleOut: nextHandle }),
      };
    }

    if (effectiveType === 'symmetric') {
      const mirrored: VectorPointHandle = {
        x: round2(pt.x - vx),
        y: round2(pt.y - vy),
      };
      return handleKind === 'in'
        ? { ...pt, handleIn: nextHandle, handleOut: mirrored }
        : { ...pt, handleOut: nextHandle, handleIn: mirrored };
    }

    // Smooth: opposite handle stays collinear while keeping its existing length
    const opposite = handleKind === 'in' ? pt.handleOut : pt.handleIn;
    if (!opposite || vLen < EPS) {
      return handleKind === 'in'
        ? { ...pt, handleIn: nextHandle }
        : { ...pt, handleOut: nextHandle };
    }
    const oppLen = Math.hypot(opposite.x - pt.x, opposite.y - pt.y);
    const alignedOpposite: VectorPointHandle = {
      x: round2(pt.x - (vx / vLen) * oppLen),
      y: round2(pt.y - (vy / vLen) * oppLen),
    };
    return handleKind === 'in'
      ? { ...pt, handleIn: nextHandle, handleOut: alignedOpposite }
      : { ...pt, handleOut: nextHandle, handleIn: alignedOpposite };
  });

  return { ...binding, points: nextPoints };
}

export function setMotionPathPointType(
  binding: MotionPathBinding,
  pointIndex: number,
  nextType: VectorPointType,
): MotionPathBinding {
  const n = binding.points.length;
  if (pointIndex < 0 || pointIndex >= n) return binding;

  const nextPoints = binding.points.map((pt, idx) => {
    if (idx !== pointIndex) return pt;
    if (nextType === 'corner') {
      const cleaned: VectorAnchorPoint = {
        id: pt.id,
        x: pt.x,
        y: pt.y,
        pointType: 'corner',
      };
      return cleaned;
    }

    const prevPt = idx > 0 ? binding.points[idx - 1] : binding.closed ? binding.points[n - 1] : null;
    const nextPt = idx < n - 1 ? binding.points[idx + 1] : binding.closed ? binding.points[0] : null;

    // Derive tangent direction from existing handles or neighboring anchors
    let tx = 0;
    let ty = 0;
    if (pt.handleOut && Math.hypot(pt.handleOut.x - pt.x, pt.handleOut.y - pt.y) > EPS) {
      tx = pt.handleOut.x - pt.x;
      ty = pt.handleOut.y - pt.y;
    } else if (pt.handleIn && Math.hypot(pt.x - pt.handleIn.x, pt.y - pt.handleIn.y) > EPS) {
      tx = pt.x - pt.handleIn.x;
      ty = pt.y - pt.handleIn.y;
    } else if (prevPt && nextPt) {
      tx = nextPt.x - prevPt.x;
      ty = nextPt.y - prevPt.y;
    } else if (nextPt) {
      tx = nextPt.x - pt.x;
      ty = nextPt.y - pt.y;
    } else if (prevPt) {
      tx = pt.x - prevPt.x;
      ty = pt.y - prevPt.y;
    }

    const tLen = Math.hypot(tx, ty);
    const ux = tLen > EPS ? tx / tLen : 1;
    const uy = tLen > EPS ? ty / tLen : 0;

    const defaultInLen = prevPt ? Math.max(24, Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y) * 0.28) : 40;
    const defaultOutLen = nextPt ? Math.max(24, Math.hypot(nextPt.x - pt.x, nextPt.y - pt.y) * 0.28) : 40;
    const curInLen = pt.handleIn ? Math.hypot(pt.handleIn.x - pt.x, pt.handleIn.y - pt.y) : defaultInLen;
    const curOutLen = pt.handleOut ? Math.hypot(pt.handleOut.x - pt.x, pt.handleOut.y - pt.y) : defaultOutLen;

    if (nextType === 'symmetric') {
      const symLen = Math.max(20, (curInLen + curOutLen) * 0.5);
      return {
        ...pt,
        pointType: 'symmetric' as const,
        ...(prevPt ? { handleIn: { x: round2(pt.x - ux * symLen), y: round2(pt.y - uy * symLen) } } : {}),
        ...(nextPt ? { handleOut: { x: round2(pt.x + ux * symLen), y: round2(pt.y + uy * symLen) } } : {}),
      };
    }

    return {
      ...pt,
      pointType: 'smooth' as const,
      ...(prevPt ? { handleIn: { x: round2(pt.x - ux * Math.max(16, curInLen)), y: round2(pt.y - uy * Math.max(16, curInLen)) } } : {}),
      ...(nextPt ? { handleOut: { x: round2(pt.x + ux * Math.max(16, curOutLen)), y: round2(pt.y + uy * Math.max(16, curOutLen)) } } : {}),
    };
  });

  return { ...binding, points: nextPoints };
}

/**
 * Inserts a new anchor point on `segmentIndex` at parameter `t` in (0, 1) using
 * exact de Casteljau cubic Bézier subdivision — preserving the exact curve shape.
 */
export function insertMotionPathPointOnSegment(
  binding: MotionPathBinding,
  segmentIndex: number,
  t: number,
): { binding: MotionPathBinding; insertedIndex: number } {
  const n = binding.points.length;
  const segCount = binding.closed ? n : n - 1;
  if (n < 2 || segmentIndex < 0 || segmentIndex >= segCount) {
    return { binding, insertedIndex: -1 };
  }

  const u = clamp(t, 0.05, 0.95);
  const nextIdx = (segmentIndex + 1) % n;
  const a = binding.points[segmentIndex];
  const b = binding.points[nextIdx];

  const p0 = { x: a.x, y: a.y };
  const p1 = a.handleOut ?? p0;
  const p2 = b.handleIn ?? { x: b.x, y: b.y };
  const p3 = { x: b.x, y: b.y };

  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }) => ({
    x: p.x + (q.x - p.x) * u,
    y: p.y + (q.y - p.y) * u,
  });

  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s0 = lerp(r0, r1);

  const isStraight = !a.handleOut && !b.handleIn;

  const updatedA: VectorAnchorPoint = {
    ...a,
    ...(isStraight ? {} : { handleOut: { x: round2(q0.x), y: round2(q0.y) } }),
  };
  const updatedB: VectorAnchorPoint = {
    ...b,
    ...(isStraight ? {} : { handleIn: { x: round2(q2.x), y: round2(q2.y) } }),
  };
  const inserted: VectorAnchorPoint = {
    id: makePathStudioPointId('mp'),
    x: round2(s0.x),
    y: round2(s0.y),
    ...(isStraight
      ? { pointType: 'corner' as const }
      : {
          handleIn: { x: round2(r0.x), y: round2(r0.y) },
          handleOut: { x: round2(r1.x), y: round2(r1.y) },
          pointType: 'smooth' as const,
        }),
  };

  const nextPoints = binding.points.slice();
  nextPoints[segmentIndex] = updatedA;
  nextPoints[nextIdx] = updatedB;
  const insertedIndex = segmentIndex + 1;
  nextPoints.splice(insertedIndex, 0, inserted);

  return {
    binding: { ...binding, points: nextPoints },
    insertedIndex,
  };
}

export function removeMotionPathPoint(
  binding: MotionPathBinding,
  pointIndex: number,
): MotionPathBinding {
  if (binding.points.length <= 2) return binding;
  if (pointIndex < 0 || pointIndex >= binding.points.length) return binding;
  const nextPoints = binding.points.filter((_, idx) => idx !== pointIndex);
  return { ...binding, points: nextPoints };
}

export function reverseMotionPathPoints(
  binding: MotionPathBinding,
): MotionPathBinding {
  const reversed = [...binding.points].reverse().map((pt) => {
    const next: VectorAnchorPoint = {
      id: pt.id,
      x: pt.x,
      y: pt.y,
      pointType: pt.pointType,
      ...(pt.handleOut ? { handleIn: { ...pt.handleOut } } : {}),
      ...(pt.handleIn ? { handleOut: { ...pt.handleIn } } : {}),
    };
    return next;
  });
  return { ...binding, points: reversed };
}

export function serializeMotionPathToSvgD(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
): string {
  if (points.length === 0) return '';
  const first = points[0];
  const parts: string[] = [`M ${round2(first.x)} ${round2(first.y)}`];
  const segCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a.handleOut && !b.handleIn) {
      parts.push(`L ${round2(b.x)} ${round2(b.y)}`);
    } else {
      const c1 = a.handleOut ?? a;
      const c2 = b.handleIn ?? b;
      parts.push(
        `C ${round2(c1.x)} ${round2(c1.y)} ${round2(c2.x)} ${round2(c2.y)} ${round2(b.x)} ${round2(b.y)}`,
      );
    }
  }
  if (closed && points.length >= 2) {
    parts.push('Z');
  }
  return parts.join(' ');
}

export function sampleMotionPathChevrons(
  binding: MotionPathBinding,
  count = 5,
): MotionPathChevron[] {
  const table = buildPathArcLengthTable(binding.points, binding.closed, 32);
  if (table.totalLength < 24) return [];
  const n = Math.max(1, Math.min(12, count));
  const chevrons: MotionPathChevron[] = [];
  for (let i = 1; i <= n; i += 1) {
    const pct = (i / (n + 1)) * 100;
    const sample = evaluateMotionPathAtProgress(
      { ...binding, loopMode: 'none', offsetPx: 0 },
      pct,
      table,
    );
    if (sample) {
      chevrons.push({
        x: sample.baseX,
        y: sample.baseY,
        angleDeg: sample.tangentAngleDeg,
      });
    }
  }
  return chevrons;
}

/**
 * Projects a world-space canvas point onto the nearest cubic segment of a
 * `MotionPathBinding` for click-to-add-point editing.
 */
export function projectPointOntoMotionPath(
  binding: MotionPathBinding,
  worldPoint: { x: number; y: number },
  samplesPerSegment = 32,
): MotionPathProjection | null {
  const segments = extractCubicSegments(binding.points, binding.closed);
  if (segments.length === 0) return null;

  let best: MotionPathProjection | null = null;
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx];
    for (let i = 0; i <= samplesPerSegment; i += 1) {
      const t = i / samplesPerSegment;
      const pt = evaluateCubicPoint(seg, t);
      const dist = Math.hypot(pt.x - worldPoint.x, pt.y - worldPoint.y);
      if (!best || dist < best.distance) {
        best = {
          segmentIndex: segIdx,
          t,
          x: pt.x,
          y: pt.y,
          distance: dist,
        };
      }
    }
  }

  // Local refinement around the winning sample
  if (best) {
    const seg = segments[best.segmentIndex];
    let step = 0.5 / samplesPerSegment;
    let curT = best.t;
    let curDist = best.distance;
    for (let iter = 0; iter < 6; iter += 1) {
      for (const candidateT of [clamp(curT - step, 0, 1), clamp(curT + step, 0, 1)]) {
        const pt = evaluateCubicPoint(seg, candidateT);
        const dist = Math.hypot(pt.x - worldPoint.x, pt.y - worldPoint.y);
        if (dist < curDist) {
          curDist = dist;
          curT = candidateT;
          best = {
            segmentIndex: best.segmentIndex,
            t: curT,
            x: pt.x,
            y: pt.y,
            distance: curDist,
          };
        }
      }
      step *= 0.5;
    }
  }

  return best;
}

// ============================================================================
// 3. TRIM PATH MATH (SINGLE & COMPOUND SIMULTANEOUS / SEQUENTIAL)
// ============================================================================

/**
 * Checks whether a style object has active non-default Trim Path values.
 */
export function hasActiveTrimPath(style: {
  trimStart?: number;
  trimEnd?: number;
  trimOffset?: number;
}): boolean {
  const s = style.trimStart ?? 0;
  const e = style.trimEnd ?? 100;
  const o = style.trimOffset ?? 0;
  return (
    Math.abs(s) > 0.01 ||
    Math.abs(e - 100) > 0.01 ||
    Math.abs(((o % 100) + 100) % 100) > 0.01
  );
}

/**
 * Computes exact normalized visible sub-intervals in `[0, 1]` for a Trim Path
 * with `startPct` (0..100), `endPct` (0..100), and `offsetPct` (wrapping mod 100).
 * Handles start > end (auto-swapped) and wrap-around across 0/1 seamlessly.
 */
export function normalizeTrimIntervals(
  startPct: number,
  endPct: number,
  offsetPct = 0,
): TrimInterval[] {
  const rawA = clamp(startPct, 0, 100) / 100;
  const rawB = clamp(endPct, 0, 100) / 100;
  const lo = Math.min(rawA, rawB);
  const hi = Math.max(rawA, rawB);
  const span = hi - lo;

  if (span <= EPS) return [];
  if (span >= 1 - EPS) return [{ start: 0, end: 1 }];

  const shift = (((Number.isFinite(offsetPct) ? offsetPct : 0) / 100) % 1 + 1) % 1;
  const s = (lo + shift) % 1;
  const e = s + span;

  if (e <= 1 + EPS) {
    return [{ start: s, end: Math.min(1, e) }];
  }
  return [
    { start: 0, end: Math.min(1, e - 1) },
    { start: s, end: 1 },
  ];
}

/**
 * Distributes Trim Path across multiple contours (`simultaneous` vs `sequential`).
 *
 * - `simultaneous`: every contour gets the same `[startPct, endPct, offsetPct]`.
 * - `sequential`: contours are laid end-to-end proportionally to their geometric
 *   arc length, and each contour receives the slice of the global trim intervals
 *   that overlaps its `[cumStart/total, cumEnd/total]` range.
 */
export function computeContourTrimIntervals(
  contourLengths: readonly number[],
  startPct: number,
  endPct: number,
  offsetPct = 0,
  mode: TrimPathMode = 'simultaneous',
): TrimInterval[][] {
  if (contourLengths.length === 0) return [];
  const globalIntervals = normalizeTrimIntervals(startPct, endPct, offsetPct);

  if (mode === 'simultaneous' || contourLengths.length === 1) {
    return contourLengths.map(() => globalIntervals);
  }

  const totalLen = contourLengths.reduce((acc, len) => acc + Math.max(0, len), 0);
  if (totalLen <= EPS) {
    return contourLengths.map(() => []);
  }

  const result: TrimInterval[][] = [];
  let cursor = 0;

  for (const rawLen of contourLengths) {
    const len = Math.max(0, rawLen);
    const cStart = cursor / totalLen;
    const cEnd = (cursor + len) / totalLen;
    cursor += len;

    if (len <= EPS || globalIntervals.length === 0) {
      result.push([]);
      continue;
    }

    const localIntervals: TrimInterval[] = [];
    for (const iv of globalIntervals) {
      const ovStart = Math.max(cStart, iv.start);
      const ovEnd = Math.min(cEnd, iv.end);
      if (ovEnd - ovStart > EPS) {
        const localStart = clamp((ovStart - cStart) / (cEnd - cStart), 0, 1);
        const localEnd = clamp((ovEnd - cStart) / (cEnd - cStart), 0, 1);
        if (localEnd - localStart > EPS) {
          localIntervals.push({ start: localStart, end: localEnd });
        }
      }
    }
    result.push(localIntervals);
  }

  return result;
}

/**
 * Converts normalized visible intervals in `[0, 1]` and a contour's `totalLength`
 * into an exact SVG `stroke-dasharray` + `stroke-dashoffset` pair.
 *
 * Supports:
 * - Empty (invisible stroke)
 * - Full (untrimmed stroke)
 * - Single interval `[a, b]`
 * - Wrapped dual intervals `[0, b]` and `[a, 1]` (e.g. offset pushing dash past 100%)
 */
export function intervalsToSvgStrokeDash(
  totalLength: number,
  intervals: readonly TrimInterval[],
): SvgTrimDashResult {
  if (!Number.isFinite(totalLength) || totalLength <= EPS || intervals.length === 0) {
    return { visible: false, full: false, dasharray: `0 ${round2(Math.max(1, totalLength + 2))}`, dashoffset: 0 };
  }

  // Merge/sort intervals defensively
  const sorted = [...intervals]
    .filter((iv) => iv.end - iv.start > EPS)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) {
    return { visible: false, full: false, dasharray: `0 ${round2(totalLength + 2)}`, dashoffset: 0 };
  }

  const totalFraction = sorted.reduce((acc, iv) => acc + (iv.end - iv.start), 0);
  if (totalFraction >= 1 - 1e-4) {
    return { visible: true, full: true };
  }

  if (sorted.length === 1) {
    const iv = sorted[0];
    const visibleLen = (iv.end - iv.start) * totalLength;
    const gapLen = totalLength + 4;
    const startDist = iv.start * totalLength;
    return {
      visible: true,
      full: false,
      dasharray: `${round2(visibleLen)} ${round2(gapLen)}`,
      dashoffset: round2(-startDist),
    };
  }

  // Dual intervals (wrapped around 0/1): [0, b] and [a, 1]
  // Encode explicit alternating dash/gap pattern starting at distance 0.
  const pattern: number[] = [];
  let cursor = 0;
  for (const iv of sorted) {
    const startDist = iv.start * totalLength;
    const endDist = iv.end * totalLength;
    if (startDist > cursor + EPS) {
      if (pattern.length === 0) {
        pattern.push(0); // zero leading dash so gap starts at 0
      }
      pattern.push(round2(startDist - cursor));
    }
    pattern.push(round2(Math.max(0.01, endDist - startDist)));
    cursor = endDist;
  }
  if (cursor < totalLength + 2) {
    pattern.push(round2(totalLength + 4 - cursor));
  }
  return {
    visible: true,
    full: false,
    dasharray: pattern.join(' '),
    dashoffset: 0,
  };
}

/**
 * Computes exact per-contour lengths for a `PathNode`, `RectNode`, `FrameNode`, or `EllipseNode`.
 */
export function getNodeContourLengths(node: DesignNode): number[] {
  if (node.type === 'path') {
    const primaryLen = computeVectorContourLength(node.points, node.closed);
    if (!node.subpaths || node.subpaths.length === 0) {
      return [primaryLen];
    }
    return [
      primaryLen,
      ...node.subpaths.map((sp) => computeVectorContourLength(sp.points, sp.closed)),
    ];
  }
  if (node.type === 'rect' || node.type === 'frame') {
    const w = Math.max(0, node.width);
    const h = Math.max(0, node.height);
    const maxR = Math.min(w, h) / 2;
    const r = clamp(node.style.radius ?? 0, 0, maxR);
    // Exact perimeter of a rounded rectangle: 2*(w + h) - 8*r + 2*pi*r
    return [Math.max(0, 2 * (w + h) - (8 - 2 * Math.PI) * r)];
  }
  if (node.type === 'ellipse') {
    const a = Math.max(0, node.width / 2);
    const b = Math.max(0, node.height / 2);
    if (a + b <= EPS) return [0];
    // Ramanujan second approximation for ellipse perimeter (accurate to < 0.0001%)
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
    return [Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))];
  }
  return [];
}

/**
 * Returns all contours of a `PathNode` in order: primary contour followed by any compound subpaths.
 */
export function getPathNodeContours(node: PathNode): VectorSubpath[] {
  return [
    { points: node.points, closed: node.closed },
    ...(node.subpaths ?? []),
  ];
}

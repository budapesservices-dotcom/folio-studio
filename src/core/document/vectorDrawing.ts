/**
 * Pure, framework-independent 100% Vector-Native Drawing Algorithms Engine.
 *
 * Code-split into its own lazy Vite chunk (`vector-drawing-engine`) via dynamic import
 * so the main Canvas bundle stays lean.
 *
 * Powers:
 * 1. Vector Brush Tool: stabilizer/smoothing, Douglas-Peucker simplification,
 *    and 4 vector-native nib presets (Round, Calligraphy/Flat, Tapered, Marker).
 * 2. Vector Eraser Tool: Object Erase & Slice/Cut (Pathfinder planar boolean subtract
 *    for closed shapes/paths + exact geometric segment clipping for open strokes).
 * 3. Paint Bucket (Live Fill) Tool: direct Fill/Stroke tinting (with Transparent clear)
 *    + Smart Region closed-area detection with Gap Closing using planarBoolean.ts.
 */

import { createVectorPathNode } from './factory';
import {
  assembleFacesToContours,
  buildPlanarArrangement,
  buildPlanarFacesFromSegments,
  pointInContours,
  pointInSimplePolygon,
  type PlanarPoint,
  type PlanarShapeInput,
  type RawPlanarSegment,
} from './planarBoolean';
import { isTransparentColor, sanitizeStyleColor } from './styling';
import { resolveDesignTokenValue } from './tokens';
import type {
  DesignNode,
  DesignTokenCollection,
  PathNode,
  VectorAnchorPoint,
  VectorSubpath,
} from './types';
import {
  convertShapeToPathNode,
  createAnchorId,
  fitCatmullRomToBezier,
  normalizePathNode,
  sampleSubpathToPolygon,
  simplifyPolyline,
  type Point2D,
} from './vector';
import type {
  PaintBucketGapTolerance,
  PaintBucketTarget,
  VectorBrushCap,
  VectorBrushPreset,
  VectorEraserMode,
  VectorEraserTarget,
} from '../tools/operationContract';

export interface VectorBrushBuildOptions {
  readonly preset: VectorBrushPreset;
  readonly size: number;
  readonly stabilizer: number;
  readonly color: string;
  readonly cap: VectorBrushCap;
  readonly tokenId?: string;
}

export interface VectorEraserApplyOptions {
  readonly size: number;
  readonly mode: VectorEraserMode;
  readonly target: VectorEraserTarget;
}

export interface VectorEraserResult {
  readonly removeIds: string[];
  readonly insertNodes: DesignNode[];
  readonly touchedCount: number;
}

export interface PaintBucketApplyOptions {
  readonly color: string;
  readonly target: PaintBucketTarget;
  readonly gapTolerance: PaintBucketGapTolerance;
  readonly fallbackStrokeWidth?: number;
  readonly tokenId?: string;
  readonly designTokens?: DesignTokenCollection;
}

export type PaintBucketResult =
  | { readonly kind: 'update'; readonly nodes: DesignNode[]; readonly notice: string }
  | { readonly kind: 'create'; readonly nodes: PathNode[]; readonly notice: string }
  | { readonly kind: 'none'; readonly notice: string };

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rotatePointAround(point: Point2D, center: Point2D, angleDeg: number): Point2D {
  if (!angleDeg) return point;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): { distance: number; closest: Point2D; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { distance: Math.hypot(p.x - a.x, p.y - a.y), closest: a, t: 0 };
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return { distance: Math.hypot(p.x - cx, p.y - cy), closest: { x: cx, y: cy }, t };
}

function pointToPolylineDistance(p: Point2D, polyline: readonly Point2D[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return Math.hypot(p.x - polyline[0].x, p.y - polyline[0].y);
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const d = pointToSegmentDistance(p, polyline[i], polyline[i + 1]).distance;
    if (d < best) best = d;
  }
  return best;
}

function dedupePolyline(points: readonly Point2D[], minStep = 0.75): Point2D[] {
  if (points.length === 0) return [];
  const out: Point2D[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= minStep) {
      out.push({ x: curr.x, y: curr.y });
    }
  }
  const lastRaw = points[points.length - 1];
  const lastOut = out[out.length - 1];
  if (points.length > 1 && Math.hypot(lastRaw.x - lastOut.x, lastRaw.y - lastOut.y) > 0.25) {
    out.push({ x: lastRaw.x, y: lastRaw.y });
  }
  return out;
}

function resamplePolyline(points: readonly Point2D[], stepPx: number): Point2D[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const spacing = Math.max(1.5, stepPx);
  const out: Point2D[] = [{ x: points[0].x, y: points[0].y }];
  let carry = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen < 1e-4) continue;
    let dist = spacing - carry;
    while (dist <= segLen) {
      const t = dist / segLen;
      out.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      });
      dist += spacing;
    }
    carry = segLen - (dist - spacing);
  }

  const end = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(end.x - tail.x, end.y - tail.y) > 0.5) {
    out.push({ x: end.x, y: end.y });
  }
  return out;
}

function getWorldPathContours(node: DesignNode): {
  contours: Point2D[][];
  closed: boolean;
  openPolyline?: Point2D[];
} | null {
  let pathNode: PathNode | null = null;
  if (node.type === 'path') {
    pathNode = node;
  } else if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    pathNode = convertShapeToPathNode(node);
  }
  if (!pathNode) return null;

  const center = { x: pathNode.x + pathNode.width / 2, y: pathNode.y + pathNode.height / 2 };
  const mapAnchor = (pt: VectorAnchorPoint): VectorAnchorPoint => {
    const w = rotatePointAround({ x: pathNode!.x + pt.x, y: pathNode!.y + pt.y }, center, pathNode!.rotation);
    const next: VectorAnchorPoint = {
      id: pt.id,
      x: roundCoord(w.x),
      y: roundCoord(w.y),
      pointType: pt.pointType,
    };
    if (pt.handleIn) {
      const hIn = rotatePointAround(
        { x: pathNode!.x + pt.handleIn.x, y: pathNode!.y + pt.handleIn.y },
        center,
        pathNode!.rotation,
      );
      next.handleIn = { x: roundCoord(hIn.x), y: roundCoord(hIn.y) };
    }
    if (pt.handleOut) {
      const hOut = rotatePointAround(
        { x: pathNode!.x + pt.handleOut.x, y: pathNode!.y + pt.handleOut.y },
        center,
        pathNode!.rotation,
      );
      next.handleOut = { x: roundCoord(hOut.x), y: roundCoord(hOut.y) };
    }
    return next;
  };

  const worldMain = pathNode.points.map(mapAnchor);
  if (!pathNode.closed) {
    const openPoly = sampleSubpathToPolygon(worldMain, false, 16);
    return { contours: [], closed: false, openPolyline: openPoly };
  }

  const contours: Point2D[][] = [];
  const mainPoly = sampleSubpathToPolygon(worldMain, true, 16);
  if (mainPoly.length >= 3) contours.push(mainPoly);

  if (pathNode.subpaths) {
    for (const sp of pathNode.subpaths) {
      const worldSp = sp.points.map(mapAnchor);
      const spPoly = sampleSubpathToPolygon(worldSp, true, 14);
      if (spPoly.length >= 3) contours.push(spPoly);
    }
  }

  return { contours, closed: true };
}

function getBasePathStyle(node: DesignNode): PathNode['style'] {
  if (node.type === 'path') return { ...node.style };
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    return {
      fill: node.style.fill,
      ...(node.style.fills ? { fills: node.style.fills } : {}),
      stroke: node.style.stroke,
      strokeWidth: node.style.strokeWidth,
      ...(node.style.strokeDasharray ? { strokeDasharray: node.style.strokeDasharray } : {}),
      ...(node.style.strokeAlign ? { strokeAlign: node.style.strokeAlign } : {}),
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fillRule: 'nonzero',
    };
  }
  return {
    fill: '#8B7CF6',
    stroke: '#00000000',
    strokeWidth: 0,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fillRule: 'nonzero',
  };
}

function polygonToCornerAnchors(poly: readonly Point2D[], epsilon = 0.5): VectorAnchorPoint[] {
  if (poly.length < 3) return [];
  const simplified = simplifyPolyline([...poly, poly[0]], epsilon);
  if (simplified.length > 1) simplified.pop();
  const source = simplified.length >= 3 ? simplified : poly;
  return source.map((pt) => ({
    id: createAnchorId('vd'),
    x: roundCoord(pt.x),
    y: roundCoord(pt.y),
    pointType: 'corner',
  }));
}

// ============================================================================
// 1. VECTOR BRUSH ENGINE (Stabilizer + Simplification + 4 Vector Presets)
// ============================================================================

/**
 * Smooths raw mouse/touchpad/pen points using exponential moving average (EMA)
 * plus endpoint-preserving Laplacian passes scaled by `stabilizerPercent` (0-100).
 */
export function stabilizeBrushPolyline(
  rawPoints: readonly Point2D[],
  stabilizerPercent: number,
): Point2D[] {
  const cleaned = dedupePolyline(rawPoints, 0.7);
  if (cleaned.length <= 2) return cleaned;

  const s = clamp(Number.isFinite(stabilizerPercent) ? stabilizerPercent : 45, 0, 100) / 100;
  if (s <= 0.01) return cleaned;

  // Forward-backward zero-phase EMA so stabilized strokes never lag behind cursor
  const alpha = 1 - s * 0.72; // 1.0 (no smoothing) -> 0.28 (strong smoothing)
  const forward: Point2D[] = [{ ...cleaned[0] }];
  for (let i = 1; i < cleaned.length; i += 1) {
    const prev = forward[i - 1];
    const curr = cleaned[i];
    forward.push({
      x: prev.x + (curr.x - prev.x) * alpha,
      y: prev.y + (curr.y - prev.y) * alpha,
    });
  }
  const backward: Point2D[] = new Array(cleaned.length);
  backward[cleaned.length - 1] = { ...cleaned[cleaned.length - 1] };
  for (let i = cleaned.length - 2; i >= 0; i -= 1) {
    const next = backward[i + 1];
    const curr = forward[i];
    backward[i] = {
      x: next.x + (curr.x - next.x) * alpha,
      y: next.y + (curr.y - next.y) * alpha,
    };
  }
  backward[0] = { ...cleaned[0] };
  backward[backward.length - 1] = { ...cleaned[cleaned.length - 1] };

  // Additional weighted Laplacian passes for high stabilizer settings (50%-100%)
  let current = backward;
  const passes = s >= 0.75 ? 3 : s >= 0.35 ? 2 : 1;
  const weight = 0.25 + s * 0.25;
  for (let pass = 0; pass < passes; pass += 1) {
    const next: Point2D[] = [current[0]];
    for (let i = 1; i < current.length - 1; i += 1) {
      const p0 = current[i - 1];
      const p1 = current[i];
      const p2 = current[i + 1];
      const avgX = (p0.x + p2.x) * 0.5;
      const avgY = (p0.y + p2.y) * 0.5;
      next.push({
        x: p1.x + (avgX - p1.x) * weight,
        y: p1.y + (avgY - p1.y) * weight,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

function computeTangents(points: readonly Point2D[]): Point2D[] {
  const n = points.length;
  const tangents: Point2D[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) {
      tangents.push(tangents[tangents.length - 1] ?? { x: 1, y: 0 });
    } else {
      tangents.push({ x: dx / len, y: dy / len });
    }
  }
  return tangents;
}

function buildDabContour(center: Point2D, radius: number, preset: VectorBrushPreset, cap: VectorBrushCap): Point2D[] {
  const r = Math.max(1, radius);
  if (preset === 'calligraphy' || preset === 'marker') {
    const angle = preset === 'calligraphy' ? (-35 * Math.PI) / 180 : (-26 * Math.PI) / 180;
    const halfMajor = r;
    const halfMinor = Math.max(1.1, r * (preset === 'calligraphy' ? 0.28 : 0.48));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localCorners: Point2D[] = [
      { x: -halfMajor, y: -halfMinor },
      { x: halfMajor, y: -halfMinor },
      { x: halfMajor, y: halfMinor },
      { x: -halfMajor, y: halfMinor },
    ];
    return localCorners.map((pt) => ({
      x: roundCoord(center.x + pt.x * cos - pt.y * sin),
      y: roundCoord(center.y + pt.x * sin + pt.y * cos),
    }));
  }
  if (cap === 'square' || cap === 'butt') {
    return [
      { x: roundCoord(center.x - r), y: roundCoord(center.y - r) },
      { x: roundCoord(center.x + r), y: roundCoord(center.y - r) },
      { x: roundCoord(center.x + r), y: roundCoord(center.y + r) },
      { x: roundCoord(center.x - r), y: roundCoord(center.y + r) },
    ];
  }
  const steps = 12;
  const pts: Point2D[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({
      x: roundCoord(center.x + Math.cos(a) * r),
      y: roundCoord(center.y + Math.sin(a) * r),
    });
  }
  return pts;
}

function buildSweptVariableRibbon(
  centerline: readonly Point2D[],
  radius: number,
  preset: 'calligraphy' | 'tapered' | 'marker',
  cap: VectorBrushCap,
): Point2D[] {
  const resampled = resamplePolyline(centerline, Math.max(2.5, radius * 0.45));
  if (resampled.length < 2) {
    return buildDabContour(resampled[0] ?? { x: 0, y: 0 }, radius, preset, cap);
  }

  const tangents = computeTangents(resampled);
  const cumLen: number[] = [0];
  for (let i = 1; i < resampled.length; i += 1) {
    cumLen.push(cumLen[i - 1] + Math.hypot(resampled[i].x - resampled[i - 1].x, resampled[i].y - resampled[i - 1].y));
  }
  const totalLen = Math.max(1e-4, cumLen[cumLen.length - 1]);

  const left: Point2D[] = [];
  const right: Point2D[] = [];

  if (preset === 'tapered') {
    for (let i = 0; i < resampled.length; i += 1) {
      const u = cumLen[i] / totalLen;
      // Smooth bell envelope: narrow pointed tips tapering gracefully to full width through body
      const envelope = Math.min(1, Math.sin(Math.PI * u) * 1.42);
      const halfW = Math.max(0.7, radius * (0.08 + 0.92 * envelope));
      const t = tangents[i];
      const nx = -t.y;
      const ny = t.x;
      left.push({ x: resampled[i].x + nx * halfW, y: resampled[i].y + ny * halfW });
      right.push({ x: resampled[i].x - nx * halfW, y: resampled[i].y - ny * halfW });
    }
    const startPt = resampled[0];
    const endPt = resampled[resampled.length - 1];
    const t0 = tangents[0];
    const tEnd = tangents[tangents.length - 1];
    const tipExtend = cap === 'butt' ? 0 : radius * 0.28;
    const startTip = { x: startPt.x - t0.x * tipExtend, y: startPt.y - t0.y * tipExtend };
    const endTip = { x: endPt.x + tEnd.x * tipExtend, y: endPt.y + tEnd.y * tipExtend };
    return [startTip, ...left, endTip, ...right.reverse()];
  }

  // Fixed-angle nib for Calligraphy (-35°) and Chisel Marker (-26°)
  const angleRad = preset === 'calligraphy' ? (-35 * Math.PI) / 180 : (-26 * Math.PI) / 180;
  const nibX = Math.cos(angleRad);
  const nibY = Math.sin(angleRad);
  const minRatio = preset === 'calligraphy' ? 0.18 : 0.42;

  for (let i = 0; i < resampled.length; i += 1) {
    const t = tangents[i];
    const nx = -t.y;
    const ny = t.x;
    // Project fixed nib vector onto stroke normal so perpendicular strokes are wide and parallel strokes are crisp & fine
    const proj = Math.abs(nibX * nx + nibY * ny);
    const halfW = Math.max(0.85, radius * (minRatio + (1 - minRatio) * proj));
    // Slight directional shear along fixed nib angle for authentic calligraphic corner terminals
    const shear = (nibX * t.x + nibY * t.y) * radius * (preset === 'calligraphy' ? 0.22 : 0.14);
    const ox = nx * halfW + t.x * shear;
    const oy = ny * halfW + t.y * shear;
    left.push({ x: resampled[i].x + ox, y: resampled[i].y + oy });
    right.push({ x: resampled[i].x - ox, y: resampled[i].y - oy });
  }

  if (cap === 'round' && preset === 'marker') {
    const startCenter = resampled[0];
    const endCenter = resampled[resampled.length - 1];
    const endMid = {
      x: endCenter.x + tangents[tangents.length - 1].x * radius * 0.35,
      y: endCenter.y + tangents[tangents.length - 1].y * radius * 0.35,
    };
    const startMid = {
      x: startCenter.x - tangents[0].x * radius * 0.35,
      y: startCenter.y - tangents[0].y * radius * 0.35,
    };
    return [startMid, ...left, endMid, ...right.reverse()];
  }

  return [...left, ...right.reverse()];
}

/**
 * Converts raw pointer input into a clean, simplified 100% vector-native PathNode.
 * Never produces raster/bitmap data.
 */
export function buildVectorBrushPathNode(
  rawPoints: readonly Point2D[],
  options: VectorBrushBuildOptions,
  createId?: () => string,
): PathNode | null {
  if (rawPoints.length === 0) return null;

  const brushSize = clamp(Number.isFinite(options.size) ? options.size : 10, 2, 100);
  const stabilizer = clamp(Number.isFinite(options.stabilizer) ? options.stabilizer : 45, 0, 100);
  const safeColor = isTransparentColor(options.color)
    ? 'transparent'
    : sanitizeStyleColor(options.color, '#8B7CF6');

  const stabilized = stabilizeBrushPolyline(rawPoints, stabilizer);
  const first = stabilized[0];
  const last = stabilized[stabilized.length - 1];
  let totalTravel = 0;
  for (let i = 1; i < stabilized.length; i += 1) {
    totalTravel += Math.hypot(stabilized[i].x - stabilized[i - 1].x, stabilized[i].y - stabilized[i - 1].y);
  }

  const presetNames: Record<VectorBrushPreset, string> = {
    round: 'Brush Stroke',
    calligraphy: 'Calligraphy Stroke',
    tapered: 'Tapered Brush',
    marker: 'Marker Stroke',
  };

  // Preset 1: Round smooth stroked Bezier path (open curve with configurable Line Cap)
  if (options.preset === 'round') {
    const simplifyTol = Math.max(0.9, 0.75 + (stabilizer / 100) * 1.9 + brushSize * 0.035);
    const simplified = totalTravel < 1.5
      ? [first, { x: first.x + 0.5, y: first.y }]
      : simplifyPolyline(stabilized, simplifyTol);
    const anchors = simplified.length >= 2
      ? fitCatmullRomToBezier(simplified, false, 0.24)
      : [
          { id: createAnchorId('br'), x: roundCoord(first.x), y: roundCoord(first.y), pointType: 'smooth' as const },
          { id: createAnchorId('br'), x: roundCoord(last.x + 0.5), y: roundCoord(last.y), pointType: 'smooth' as const },
        ];

    const node = createVectorPathNode(anchors, {
      id: createId?.(),
      name: presetNames.round,
      closed: false,
      pathKind: 'pencil',
      fill: 'none',
      stroke: safeColor,
      strokeWidth: brushSize,
      strokeLinecap: options.cap,
      strokeLinejoin: 'round',
    });
    if (options.tokenId && !isTransparentColor(safeColor)) {
      return { ...node, tokenBindings: { stroke: options.tokenId } };
    }
    return node;
  }

  // Presets 2, 3, 4: Calligraphy, Tapered, Marker -> closed filled vector outline PathNode
  const halfWidth = brushSize / 2;
  const contour = totalTravel < 1.5
    ? buildDabContour(first, halfWidth, options.preset, options.cap)
    : buildSweptVariableRibbon(stabilized, halfWidth, options.preset, options.cap);

  if (contour.length < 3) return null;

  const outlineTol = Math.max(0.75, brushSize * 0.045 + (stabilizer / 100) * 0.6);
  const closedLoop = [...contour, contour[0]];
  const simplifiedContour = simplifyPolyline(closedLoop, outlineTol);
  if (simplifiedContour.length > 1) simplifiedContour.pop();
  const finalLoop = simplifiedContour.length >= 3 ? simplifiedContour : contour;

  const anchors = options.preset === 'marker'
    ? polygonToCornerAnchors(finalLoop, outlineTol)
    : fitCatmullRomToBezier(finalLoop, true, 0.16);

  const node = createVectorPathNode(anchors, {
    id: createId?.(),
    name: presetNames[options.preset],
    closed: true,
    pathKind: 'outline',
    fill: safeColor,
    stroke: '#00000000',
    strokeWidth: 0,
    strokeLinecap: options.cap,
    strokeLinejoin: 'round',
    fillRule: 'nonzero',
  });

  if (options.tokenId && !isTransparentColor(safeColor)) {
    return { ...node, tokenBindings: { fill: options.tokenId } };
  }
  return node;
}

// ============================================================================
// 2. VECTOR ERASER ENGINE (Slice/Cut Boolean & Segment Clipping + Object Erase)
// ============================================================================

function buildCapsulePolygon(a: Point2D, b: Point2D, radius: number, capSteps = 6): Point2D[] {
  const r = Math.max(1.5, radius);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);

  if (len < 0.25) {
    const circle: Point2D[] = [];
    const steps = capSteps * 2;
    for (let i = 0; i < steps; i += 1) {
      const ang = (i / steps) * Math.PI * 2;
      circle.push({ x: roundCoord(a.x + Math.cos(ang) * r), y: roundCoord(a.y + Math.sin(ang) * r) });
    }
    return circle;
  }

  const baseAngle = Math.atan2(dy, dx);
  const pts: Point2D[] = [];
  // Semi-circle cap around B from baseAngle - PI/2 to baseAngle + PI/2
  for (let i = 0; i <= capSteps; i += 1) {
    const ang = baseAngle - Math.PI / 2 + (i / capSteps) * Math.PI;
    pts.push({ x: roundCoord(b.x + Math.cos(ang) * r), y: roundCoord(b.y + Math.sin(ang) * r) });
  }
  // Semi-circle cap around A from baseAngle + PI/2 to baseAngle + 3*PI/2
  for (let i = 0; i <= capSteps; i += 1) {
    const ang = baseAngle + Math.PI / 2 + (i / capSteps) * Math.PI;
    pts.push({ x: roundCoord(a.x + Math.cos(ang) * r), y: roundCoord(a.y + Math.sin(ang) * r) });
  }
  return pts;
}

function buildEraserCapsules(eraserPoints: readonly Point2D[], radius: number): PlanarShapeInput[] {
  const cleaned = dedupePolyline(eraserPoints, Math.max(1.2, radius * 0.2));
  if (cleaned.length === 0) return [];
  if (cleaned.length === 1) {
    return [{ contours: [buildCapsulePolygon(cleaned[0], cleaned[0], radius, 8)] }];
  }
  const simplified = simplifyPolyline(cleaned, Math.max(1.2, radius * 0.22));
  const shapes: PlanarShapeInput[] = [];
  for (let i = 0; i < simplified.length - 1; i += 1) {
    shapes.push({ contours: [buildCapsulePolygon(simplified[i], simplified[i + 1], radius, 6)] });
  }
  return shapes;
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
  const rX = a2.x - a1.x;
  const rY = a2.y - a1.y;
  const sX = b2.x - b1.x;
  const sY = b2.y - b1.y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-8) return false;
  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = (qpx * sY - qpy * sX) / denom;
  const u = (qpx * rY - qpy * rX) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function eraserTouchesNode(node: DesignNode, eraserPolyline: readonly Point2D[], radius: number): boolean {
  if (eraserPolyline.length === 0) return false;

  // Quick AABB broad-phase reject
  const pad = radius + (node.type === 'path' ? node.style.strokeWidth * 0.5 : 0) + 6;
  let eMinX = Infinity;
  let eMaxX = -Infinity;
  let eMinY = Infinity;
  let eMaxY = -Infinity;
  for (const pt of eraserPolyline) {
    if (pt.x < eMinX) eMinX = pt.x;
    if (pt.x > eMaxX) eMaxX = pt.x;
    if (pt.y < eMinY) eMinY = pt.y;
    if (pt.y > eMaxY) eMaxY = pt.y;
  }
  const nPad = node.rotation ? Math.hypot(node.width, node.height) * 0.5 : 0;
  const nMinX = node.x - nPad - pad;
  const nMaxX = node.x + node.width + nPad + pad;
  const nMinY = node.y - nPad - pad;
  const nMaxY = node.y + node.height + nPad + pad;
  if (eMaxX < nMinX || eMinX > nMaxX || eMaxY < nMinY || eMinY > nMaxY) {
    return false;
  }

  const world = getWorldPathContours(node);
  if (!world) {
    // Text, image, or component instance -> test rotated bounding box
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const rectPoly: Point2D[] = [
      rotatePointAround({ x: node.x, y: node.y }, center, node.rotation),
      rotatePointAround({ x: node.x + node.width, y: node.y }, center, node.rotation),
      rotatePointAround({ x: node.x + node.width, y: node.y + node.height }, center, node.rotation),
      rotatePointAround({ x: node.x, y: node.y + node.height }, center, node.rotation),
    ];
    for (const pt of eraserPolyline) {
      if (pointInSimplePolygon(pt, rectPoly)) return true;
      for (let i = 0; i < rectPoly.length; i += 1) {
        if (pointToSegmentDistance(pt, rectPoly[i], rectPoly[(i + 1) % rectPoly.length]).distance <= radius) {
          return true;
        }
      }
    }
    return false;
  }

  if (!world.closed && world.openPolyline) {
    const strokeHalf = node.type === 'path' ? node.style.strokeWidth * 0.5 : 0;
    const hitDist = radius + strokeHalf;
    const poly = world.openPolyline;
    for (const pt of poly) {
      if (pointToPolylineDistance(pt, eraserPolyline) <= hitDist) return true;
    }
    for (let i = 0; i < poly.length - 1; i += 1) {
      for (let j = 0; j < eraserPolyline.length - 1; j += 1) {
        if (segmentsIntersect(poly[i], poly[i + 1], eraserPolyline[j], eraserPolyline[j + 1])) return true;
      }
    }
    return false;
  }

  for (const pt of eraserPolyline) {
    if (pointInContours(pt, world.contours)) return true;
  }
  for (const contour of world.contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if (pointToPolylineDistance(a, eraserPolyline) <= radius) return true;
      for (let j = 0; j < eraserPolyline.length; j += 1) {
        if (pointToSegmentDistance(eraserPolyline[j], a, b).distance <= radius) return true;
      }
      for (let j = 0; j < eraserPolyline.length - 1; j += 1) {
        if (segmentsIntersect(a, b, eraserPolyline[j], eraserPolyline[j + 1])) return true;
      }
    }
  }
  return false;
}

function copyNodeMetadataToPath(source: DesignNode, pathNode: PathNode): PathNode {
  return {
    ...pathNode,
    opacity: source.opacity,
    visible: source.visible,
    locked: false,
    onCanvas: source.onCanvas ?? true,
    ...(source.parentId !== undefined ? { parentId: source.parentId } : {}),
    ...(source.clipMaskBaseId ? { clipMaskBaseId: source.clipMaskBaseId } : {}),
    ...(source.clipMaskMode ? { clipMaskMode: source.clipMaskMode } : {}),
    ...(source.blendMode ? { blendMode: source.blendMode } : {}),
    ...(source.effects ? { effects: source.effects } : {}),
    ...(source.tokenBindings ? { tokenBindings: source.tokenBindings } : {}),
    ...(source.layerColor ? { layerColor: source.layerColor } : {}),
  };
}

function sliceClosedNodeWithEraser(
  node: DesignNode,
  contours: Point2D[][],
  eraserCapsules: readonly PlanarShapeInput[],
  createId: () => string,
): PathNode[] {
  const arrangement = buildPlanarArrangement([{ contours }, ...eraserCapsules]);
  const survivingFaces = arrangement.faces.filter(
    (face) => face.memberShapeIndices.length === 1 && face.memberShapeIndices[0] === 0,
  );
  if (survivingFaces.length === 0) return [];

  const assembled = assembleFacesToContours(survivingFaces);
  if (assembled.length === 0) return [];

  const outers = assembled.filter((c) => !c.isHole && c.points.length >= 3);
  const holes = assembled.filter((c) => c.isHole && c.points.length >= 3);
  if (outers.length === 0) return [];

  // Assign each hole to its smallest enclosing outer shell
  const holesByOuter: Point2D[][][] = outers.map(() => []);
  for (const hole of holes) {
    const samplePt = hole.points[0];
    let bestIdx = -1;
    let bestArea = Infinity;
    for (let i = 0; i < outers.length; i += 1) {
      if (pointInSimplePolygon(samplePt, outers[i].points)) {
        let area = 0;
        const pts = outers[i].points;
        for (let k = 0; k < pts.length; k += 1) {
          const a = pts[k];
          const b = pts[(k + 1) % pts.length];
          area += a.x * b.y - b.x * a.y;
        }
        const absArea = Math.abs(area) * 0.5;
        if (absArea < bestArea) {
          bestArea = absArea;
          bestIdx = i;
        }
      }
    }
    if (bestIdx !== -1) {
      holesByOuter[bestIdx].push(hole.points);
    }
  }

  const baseStyle = getBasePathStyle(node);
  const resultNodes: PathNode[] = [];
  outers.forEach((outer, index) => {
    const mainAnchors = polygonToCornerAnchors(outer.points, 0.55);
    if (mainAnchors.length < 3) return;
    const subpaths: VectorSubpath[] = holesByOuter[index]
      .map((holePts) => polygonToCornerAnchors(holePts, 0.55))
      .filter((pts) => pts.length >= 3)
      .map((pts) => ({ points: pts, closed: true }));

    const rawPath: PathNode = {
      id: createId(),
      name: outers.length > 1 ? `${node.name} Piece ${index + 1}` : node.name,
      type: 'path',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      opacity: node.opacity,
      visible: true,
      locked: false,
      onCanvas: true,
      points: mainAnchors,
      closed: true,
      ...(subpaths.length > 0 ? { subpaths } : {}),
      pathKind: 'boolean',
      style: {
        ...baseStyle,
        fillRule: subpaths.length > 0 ? 'evenodd' : (baseStyle.fillRule ?? 'nonzero'),
      },
    };
    resultNodes.push(copyNodeMetadataToPath(node, normalizePathNode(rawPath)));
  });

  return resultNodes;
}

function sliceOpenPathWithEraser(
  node: PathNode,
  openPolyline: readonly Point2D[],
  eraserPolyline: readonly Point2D[],
  radius: number,
  createId: () => string,
): PathNode[] {
  const dense = resamplePolyline(openPolyline, 2.0);
  if (dense.length < 2) return [];

  const isErased = (pt: Point2D): boolean => pointToPolylineDistance(pt, eraserPolyline) <= radius;

  const findBoundary = (insidePt: Point2D, outsidePt: Point2D): Point2D => {
    let lo = 0;
    let hi = 1;
    for (let iter = 0; iter < 8; iter += 1) {
      const mid = (lo + hi) * 0.5;
      const probe = {
        x: outsidePt.x + (insidePt.x - outsidePt.x) * mid,
        y: outsidePt.y + (insidePt.y - outsidePt.y) * mid,
      };
      if (isErased(probe)) hi = mid;
      else lo = mid;
    }
    return {
      x: outsidePt.x + (insidePt.x - outsidePt.x) * lo,
      y: outsidePt.y + (insidePt.y - outsidePt.y) * lo,
    };
  };

  const runs: Point2D[][] = [];
  let current: Point2D[] = [];
  let prevErased = isErased(dense[0]);
  if (!prevErased) {
    current.push(dense[0]);
  }

  for (let i = 1; i < dense.length; i += 1) {
    const pt = dense[i];
    const erased = isErased(pt);
    if (!prevErased && !erased) {
      current.push(pt);
    } else if (!prevErased && erased) {
      const cut = findBoundary(pt, dense[i - 1]);
      current.push(cut);
      if (current.length >= 2) runs.push(current);
      current = [];
    } else if (prevErased && !erased) {
      const entry = findBoundary(dense[i - 1], pt);
      current = [entry, pt];
    }
    prevErased = erased;
  }
  if (current.length >= 2) runs.push(current);

  const fragments: PathNode[] = [];
  runs.forEach((run, index) => {
    let arcLen = 0;
    for (let i = 1; i < run.length; i += 1) {
      arcLen += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
    }
    if (arcLen < 1.5) return;
    const simplified = simplifyPolyline(run, 0.85);
    const anchors = fitCatmullRomToBezier(simplified, false, 0.22);
    if (anchors.length < 2) return;
    const created = createVectorPathNode(anchors, {
      id: createId(),
      name: runs.length > 1 ? `${node.name} Cut ${index + 1}` : node.name,
      closed: false,
      pathKind: node.pathKind ?? 'pencil',
      fill: node.style.fill,
      stroke: node.style.stroke,
      strokeWidth: node.style.strokeWidth,
      strokeLinecap: node.style.strokeLinecap ?? 'round',
      strokeLinejoin: node.style.strokeLinejoin ?? 'round',
      ...(node.style.strokeDasharray ? { strokeDasharray: node.style.strokeDasharray } : {}),
    });
    fragments.push(copyNodeMetadataToPath(node, created));
  });

  return fragments;
}

/**
 * Executes Vector Eraser (`slice` or `object` mode) against eligible unlocked, visible nodes.
 * Returns atomic `removeIds` + `insertNodes` ready for `replaceNodes` -> `node.replace-many`.
 */
export function applyVectorEraserOperation(
  selectableNodes: readonly DesignNode[],
  selectedNodeIds: readonly string[],
  rawEraserPoints: readonly Point2D[],
  options: VectorEraserApplyOptions,
  createId: () => string,
): VectorEraserResult {
  const eraserPolyline = dedupePolyline(rawEraserPoints, 1.0);
  if (eraserPolyline.length === 0) {
    return { removeIds: [], insertNodes: [], touchedCount: 0 };
  }

  const radius = clamp(Number.isFinite(options.size) ? options.size : 24, 4, 100) / 2;
  const selectedSet = new Set(selectedNodeIds);
  const candidates = (options.target === 'selected'
    ? selectableNodes.filter((n) => selectedSet.has(n.id))
    : selectableNodes
  ).filter((n) => n.visible && !n.locked && n.onCanvas !== false && n.type !== 'group');

  const touched = candidates.filter((node) => eraserTouchesNode(node, eraserPolyline, radius));
  if (touched.length === 0) {
    return { removeIds: [], insertNodes: [], touchedCount: 0 };
  }

  if (options.mode === 'object') {
    return {
      removeIds: touched.map((n) => n.id),
      insertNodes: [],
      touchedCount: touched.length,
    };
  }

  // Slice / Cut mode
  const eraserCapsules = buildEraserCapsules(eraserPolyline, radius);
  const removeIds: string[] = [];
  const insertNodes: DesignNode[] = [];

  for (const node of touched) {
    const world = getWorldPathContours(node);
    if (!world) {
      // Non-vector nodes (e.g. text/image) cannot be boolean-sliced -> skip safely in Slice mode
      continue;
    }
    if (!world.closed && node.type === 'path' && world.openPolyline) {
      const pieces = sliceOpenPathWithEraser(node, world.openPolyline, eraserPolyline, radius, createId);
      removeIds.push(node.id);
      insertNodes.push(...pieces);
    } else if (world.closed && world.contours.length > 0) {
      const pieces = sliceClosedNodeWithEraser(node, world.contours, eraserCapsules, createId);
      removeIds.push(node.id);
      insertNodes.push(...pieces);
    }
  }

  return {
    removeIds,
    insertNodes,
    touchedCount: removeIds.length,
  };
}

// ============================================================================
// 3. PAINT BUCKET (LIVE FILL + SMART CLOSED REGION + GAP CLOSING)
// ============================================================================

export function getGapTolerancePx(tolerance: PaintBucketGapTolerance): number {
  switch (tolerance) {
    case 'tight':
      return 0;
    case 'loose':
      return 32;
    case 'medium':
    default:
      return 14;
  }
}

function hitTestPaintableNode(
  node: DesignNode,
  point: Point2D,
  target: 'fill' | 'stroke',
): boolean {
  if (!node.visible || node.locked || node.onCanvas === false || node.type === 'group') return false;
  if (target === 'stroke' && (node.type === 'text' || node.type === 'component-instance')) return false;
  if (target === 'fill' && (node.type === 'image' || node.type === 'component-instance')) return false;

  if (node.type === 'text' || node.type === 'image') {
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const local = rotatePointAround(point, center, -node.rotation);
    return (
      local.x >= node.x &&
      local.x <= node.x + node.width &&
      local.y >= node.y &&
      local.y <= node.y + node.height
    );
  }

  const world = getWorldPathContours(node);
  if (!world) return false;

  if (world.closed && world.contours.length > 0) {
    if (pointInContours(point, world.contours)) return true;
    if (target === 'stroke') {
      const nodeStrokeWidth = 'style' in node && 'strokeWidth' in node.style ? node.style.strokeWidth : 2;
      const strokeTol = Math.max(8, (nodeStrokeWidth || 2) * 0.5 + 5);
      for (const contour of world.contours) {
        for (let i = 0; i < contour.length; i += 1) {
          if (pointToSegmentDistance(point, contour[i], contour[(i + 1) % contour.length]).distance <= strokeTol) {
            return true;
          }
        }
      }
    }
    return false;
  }

  if (!world.closed && world.openPolyline && world.openPolyline.length >= 2) {
    const strokeTol = Math.max(9, (node.type === 'path' ? node.style.strokeWidth : 2) * 0.5 + 5);
    if (target === 'stroke') {
      return pointToPolylineDistance(point, world.openPolyline) <= strokeTol;
    }
    // In Fill mode, allow clicking directly on an open path stroke only if user clicks near its stroke?
    // No — open strokes bound empty regions, so let empty-space clicks fall through to Smart Region!
    return false;
  }

  return false;
}

function resolvePaintBucketColor(options: PaintBucketApplyOptions): { color: string; tokenId?: string } {
  if (isTransparentColor(options.color)) {
    return { color: 'transparent' };
  }
  if (options.tokenId && options.designTokens) {
    const resolved = resolveDesignTokenValue(options.designTokens, options.tokenId);
    if (resolved.ok && resolved.cssValue.trim().length > 0) {
      return {
        color: sanitizeStyleColor(resolved.cssValue, '#8B7CF6'),
        tokenId: options.tokenId,
      };
    }
  }
  return {
    color: sanitizeStyleColor(options.color, '#8B7CF6'),
    ...(options.tokenId ? { tokenId: options.tokenId } : {}),
  };
}

interface IndexedBoundarySegment extends RawPlanarSegment {
  readonly sourceIdx: number;
  readonly segIdx: number;
}

interface OpenEndpoint {
  readonly pt: PlanarPoint;
  readonly sourceIdx: number;
  readonly endKind: 'start' | 'end';
  readonly segIdx: number;
}

function detectSmartClosedRegionAtPoint(
  nodes: readonly DesignNode[],
  clickPoint: Point2D,
  gapTolerancePx: number,
): Point2D[] | null {
  const segments: IndexedBoundarySegment[] = [];
  const openEndpoints: OpenEndpoint[] = [];

  nodes.forEach((node, sourceIdx) => {
    if (!node.visible || node.locked || node.onCanvas === false) return;
    const world = getWorldPathContours(node);
    if (!world) return;

    if (world.closed) {
      for (const contour of world.contours) {
        if (contour.length < 3) continue;
        for (let i = 0; i < contour.length; i += 1) {
          const a = contour[i];
          const b = contour[(i + 1) % contour.length];
          if (Math.hypot(b.x - a.x, b.y - a.y) > 0.1) {
            segments.push({ a, b, sourceIdx, segIdx: i });
          }
        }
      }
    } else if (world.openPolyline && world.openPolyline.length >= 2) {
      const poly = world.openPolyline;
      for (let i = 0; i < poly.length - 1; i += 1) {
        const a = poly[i];
        const b = poly[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.1) {
          segments.push({ a, b, sourceIdx, segIdx: i });
        }
      }
      openEndpoints.push({ pt: poly[0], sourceIdx, endKind: 'start', segIdx: 0 });
      openEndpoints.push({
        pt: poly[poly.length - 1],
        sourceIdx,
        endKind: 'end',
        segIdx: Math.max(0, poly.length - 2),
      });
    }
  });

  if (segments.length < 3) return null;

  const rawSegments: RawPlanarSegment[] = segments.map((s) => ({ a: s.a, b: s.b }));

  // Gap Closing: bridge open endpoints to nearby endpoints or nearby non-adjacent segments
  if (gapTolerancePx > 0 && openEndpoints.length > 0) {
    const addedBridgeKeys = new Set<string>();
    const addBridge = (a: PlanarPoint, b: PlanarPoint) => {
      const k1 = `${Math.round(a.x * 10)},${Math.round(a.y * 10)}->${Math.round(b.x * 10)},${Math.round(b.y * 10)}`;
      const k2 = `${Math.round(b.x * 10)},${Math.round(b.y * 10)}->${Math.round(a.x * 10)},${Math.round(a.y * 10)}`;
      if (addedBridgeKeys.has(k1) || addedBridgeKeys.has(k2)) return;
      addedBridgeKeys.add(k1);
      rawSegments.push({ a, b });
    };

    for (let i = 0; i < openEndpoints.length; i += 1) {
      const ep = openEndpoints[i];
      let bestDist = gapTolerancePx;
      let bestTarget: PlanarPoint | null = null;

      // 1. Check other open endpoints
      for (let j = 0; j < openEndpoints.length; j += 1) {
        if (i === j) continue;
        const other = openEndpoints[j];
        if (other.sourceIdx === ep.sourceIdx && Math.abs(other.segIdx - ep.segIdx) < 2) continue;
        const d = Math.hypot(other.pt.x - ep.pt.x, other.pt.y - ep.pt.y);
        if (d > 0.25 && d <= bestDist) {
          bestDist = d;
          bestTarget = other.pt;
        }
      }

      // 2. Check nearest point on any segment from another path or non-adjacent self segment
      for (const seg of segments) {
        if (seg.sourceIdx === ep.sourceIdx && Math.abs(seg.segIdx - ep.segIdx) <= 2) continue;
        const hit = pointToSegmentDistance(ep.pt, seg.a, seg.b);
        if (hit.distance > 0.25 && hit.distance <= bestDist) {
          bestDist = hit.distance;
          bestTarget = hit.closest;
        }
      }

      if (bestTarget) {
        addBridge(ep.pt, bestTarget);
      }
    }
  }

  const { faces } = buildPlanarFacesFromSegments(rawSegments, { pruneDangling: true });
  if (faces.length === 0) return null;

  let bestFace = null;
  let bestArea = Infinity;
  for (const face of faces) {
    if (pointInSimplePolygon(clickPoint, face.polygon) && face.area < bestArea) {
      bestArea = face.area;
      bestFace = face;
    }
  }
  return bestFace ? bestFace.polygon : null;
}

/**
 * Executes Paint Bucket (Live Fill) at `clickPoint`:
 * - `fill`: updates existing shape/path/text Fill (or clears with Transparent);
 *   if clicking inside an empty enclosed area bounded by paths, falls back to Smart Region fill.
 * - `stroke`: updates existing shape/path/image Stroke (or clears with Transparent).
 * - `smart-region`: detects the minimal enclosed planar region bounded by intersecting shapes/lines
 *   (with configurable Gap Closing) and creates a new filled vector PathNode.
 */
export function applyPaintBucketOperation(
  selectableNodes: readonly DesignNode[],
  clickPoint: Point2D,
  options: PaintBucketApplyOptions,
  createId: () => string,
): PaintBucketResult {
  const { color: nextColor, tokenId } = resolvePaintBucketColor(options);
  const transparent = isTransparentColor(nextColor);

  if (options.target === 'fill' || options.target === 'stroke') {
    // Search topmost to bottommost
    let hitNode: DesignNode | null = null;
    for (let i = selectableNodes.length - 1; i >= 0; i -= 1) {
      if (hitTestPaintableNode(selectableNodes[i], clickPoint, options.target)) {
        hitNode = selectableNodes[i];
        break;
      }
    }

    if (hitNode) {
      if (options.target === 'stroke') {
        if (hitNode.type === 'rect' || hitNode.type === 'ellipse' || hitNode.type === 'frame' || hitNode.type === 'path' || hitNode.type === 'image') {
          const nextBindings = { ...(hitNode.tokenBindings ?? {}) };
          if (transparent || !tokenId) delete nextBindings.stroke;
          else nextBindings.stroke = tokenId;
          const hasBindings = Object.keys(nextBindings).length > 0;
          const updated: DesignNode = {
            ...hitNode,
            style: {
              ...hitNode.style,
              stroke: transparent ? 'transparent' : nextColor,
              strokeWidth: transparent
                ? 0
                : Math.max(1, hitNode.style.strokeWidth || options.fallbackStrokeWidth || 2),
            },
            ...(hasBindings ? { tokenBindings: nextBindings } : { tokenBindings: undefined }),
          } as DesignNode;
          if (!hasBindings) delete (updated as { tokenBindings?: unknown }).tokenBindings;
          return {
            kind: 'update',
            nodes: [updated],
            notice: transparent
              ? `Cleared stroke on ${hitNode.name}.`
              : `Filled stroke on ${hitNode.name} with ${nextColor.toUpperCase()}.`,
          };
        }
      } else {
        if (
          hitNode.type === 'rect' ||
          hitNode.type === 'ellipse' ||
          hitNode.type === 'frame' ||
          hitNode.type === 'path' ||
          hitNode.type === 'text'
        ) {
          const nextBindings = { ...(hitNode.tokenBindings ?? {}) };
          if (transparent || !tokenId) delete nextBindings.fill;
          else nextBindings.fill = tokenId;
          const hasBindings = Object.keys(nextBindings).length > 0;
          const nextStyle: Record<string, unknown> = {
            ...hitNode.style,
            fill: transparent ? 'transparent' : nextColor,
          };
          if ('fills' in nextStyle) {
            delete nextStyle.fills;
          }
          const updated: DesignNode = {
            ...hitNode,
            style: nextStyle,
            ...(hasBindings ? { tokenBindings: nextBindings } : {}),
          } as DesignNode;
          if (!hasBindings) delete (updated as { tokenBindings?: unknown }).tokenBindings;
          return {
            kind: 'update',
            nodes: [updated],
            notice: transparent
              ? `Cleared fill on ${hitNode.name}.`
              : `Filled ${hitNode.name} with ${nextColor.toUpperCase()}.`,
          };
        }
      }
    }

    if (options.target === 'stroke') {
      return { kind: 'none', notice: 'Click a shape or path edge to fill its stroke.' };
    }
  }

  // Smart Region detection (explicit `smart-region` mode or empty-space click in `fill` mode)
  if (transparent) {
    return {
      kind: 'none',
      notice: 'Choose a visible color (non-transparent) to fill an enclosed empty region.',
    };
  }

  const gapPx = getGapTolerancePx(options.gapTolerance);
  const regionPoly = detectSmartClosedRegionAtPoint(selectableNodes, clickPoint, gapPx);
  if (!regionPoly || regionPoly.length < 3) {
    return {
      kind: 'none',
      notice:
        options.gapTolerance === 'tight'
          ? 'No closed region found here. Try Medium or Loose gap closing.'
          : 'No enclosed vector region detected at this point.',
    };
  }

  const anchors = polygonToCornerAnchors(regionPoly, 0.55);
  if (anchors.length < 3) {
    return { kind: 'none', notice: 'Enclosed region was too small to create a vector fill.' };
  }

  const regionNode = createVectorPathNode(anchors, {
    id: createId(),
    name: 'Live Fill Region',
    closed: true,
    pathKind: 'outline',
    fill: nextColor,
    stroke: '#00000000',
    strokeWidth: 0,
    fillRule: 'nonzero',
  });

  const finalNode: PathNode = tokenId
    ? { ...regionNode, tokenBindings: { fill: tokenId } }
    : regionNode;

  return {
    kind: 'create',
    nodes: [finalNode],
    notice: `Created vector live fill region (${nextColor.toUpperCase()}).`,
  };
}

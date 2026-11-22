/**
 * Pure, framework-independent vector geometry, cubic Bezier serialization,
 * Illustrator-grade path editing, and Pathfinder Boolean operations.
 */

import type {
  DesignNode,
  EllipseNode,
  FrameNode,
  PathNode,
  RectNode,
  VectorAnchorPoint,
  VectorPointHandle,
  VectorShapeMeta,
  VectorSubpath,
} from './types';
import {
  assembleFacesToContours,
  buildPlanarArrangement,
  hitTestPlanarFace,
  hitTestPlanarFacesAlongStroke,
  type PlanarArrangement,
  type PlanarFace,
  type PlanarPoint,
  type PlanarShapeInput,
} from './planarBoolean';

export type { PlanarArrangement, PlanarFace, PlanarPoint };
export { hitTestPlanarFace, hitTestPlanarFacesAlongStroke };

export interface Point2D {
  x: number;
  y: number;
}

export type PathfinderOperation = 'unite' | 'subtract' | 'intersect' | 'exclude';

const KAPPA = 0.5522847498307936;
const EPS = 1e-6;

let anchorCounter = 0;

export function createAnchorId(prefix = 'pt'): string {
  anchorCounter += 1;
  const rand = globalThis.crypto?.randomUUID?.()?.slice(0, 8) ?? `${Date.now().toString(36)}-${anchorCounter}`;
  return `${prefix}-${rand}-${anchorCounter}`;
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function serializeSubpathD(points: readonly VectorAnchorPoint[], closed: boolean): string {
  if (points.length === 0) return '';
  const parts: string[] = [`M ${roundCoord(points[0].x)} ${roundCoord(points[0].y)}`];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const hOut = a.handleOut;
    const hIn = b.handleIn;
    if (hOut || hIn) {
      const c1 = hOut ?? { x: a.x, y: a.y };
      const c2 = hIn ?? { x: b.x, y: b.y };
      parts.push(
        `C ${roundCoord(c1.x)} ${roundCoord(c1.y)} ${roundCoord(c2.x)} ${roundCoord(c2.y)} ${roundCoord(b.x)} ${roundCoord(b.y)}`,
      );
    } else {
      parts.push(`L ${roundCoord(b.x)} ${roundCoord(b.y)}`);
    }
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

export function serializePathPointsToSvgD(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
  subpaths?: readonly VectorSubpath[],
): string {
  const segments: string[] = [];
  const main = serializeSubpathD(points, closed);
  if (main) segments.push(main);
  if (subpaths) {
    for (const subpath of subpaths) {
      const d = serializeSubpathD(subpath.points, subpath.closed);
      if (d) segments.push(d);
    }
  }
  return segments.join(' ');
}

export function evaluateCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
): Point2D {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

export function sampleSubpathToPolygon(
  points: readonly VectorAnchorPoint[],
  closed: boolean,
  stepsPerCurve = 12,
): Point2D[] {
  if (points.length === 0) return [];
  const out: Point2D[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (i === 0) out.push({ x: a.x, y: a.y });
    if (a.handleOut || b.handleIn) {
      const c1 = a.handleOut ?? { x: a.x, y: a.y };
      const c2 = b.handleIn ?? { x: b.x, y: b.y };
      for (let step = 1; step <= stepsPerCurve; step += 1) {
        out.push(evaluateCubicBezier(a, c1, c2, b, step / stepsPerCurve));
      }
    } else {
      out.push({ x: b.x, y: b.y });
    }
  }
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
      out.pop();
    }
  }
  return out;
}

function computeSubpathBounds(points: readonly VectorAnchorPoint[], closed: boolean): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (points.length === 0) return null;
  const sampled = sampleSubpathToPolygon(points, closed, 16);
  const allPoints = sampled.length > 0 ? sampled : points.map((pt) => ({ x: pt.x, y: pt.y }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of allPoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { minX, minY, maxX, maxY };
}

function shiftAnchorPoint(pt: VectorAnchorPoint, dx: number, dy: number): VectorAnchorPoint {
  const next: VectorAnchorPoint = {
    id: pt.id,
    x: roundCoord(pt.x + dx),
    y: roundCoord(pt.y + dy),
    pointType: pt.pointType,
  };
  if (pt.handleIn) {
    next.handleIn = { x: roundCoord(pt.handleIn.x + dx), y: roundCoord(pt.handleIn.y + dy) };
  }
  if (pt.handleOut) {
    next.handleOut = { x: roundCoord(pt.handleOut.x + dx), y: roundCoord(pt.handleOut.y + dy) };
  }
  return next;
}

function scaleAnchorPoint(pt: VectorAnchorPoint, scaleX: number, scaleY: number): VectorAnchorPoint {
  const next: VectorAnchorPoint = {
    id: pt.id,
    x: roundCoord(pt.x * scaleX),
    y: roundCoord(pt.y * scaleY),
    pointType: pt.pointType,
  };
  if (pt.handleIn) {
    next.handleIn = { x: roundCoord(pt.handleIn.x * scaleX), y: roundCoord(pt.handleIn.y * scaleY) };
  }
  if (pt.handleOut) {
    next.handleOut = { x: roundCoord(pt.handleOut.x * scaleX), y: roundCoord(pt.handleOut.y * scaleY) };
  }
  return next;
}

function rotatePointAround(pt: Point2D, center: Point2D, degrees: number): Point2D {
  if (!degrees) return pt;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Transforms a world/canvas point into a node's unrotated local coordinate space. */
export function worldPointToNodeLocal(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  worldPt: Point2D,
): Point2D {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const unrotated = rotatePointAround(worldPt, center, -(node.rotation || 0));
  return { x: unrotated.x - node.x, y: unrotated.y - node.y };
}

/** Transforms a node-local point into world/canvas coordinates accounting for rotation. */
export function nodeLocalPointToWorld(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  localPt: Point2D,
): Point2D {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return rotatePointAround({ x: node.x + localPt.x, y: node.y + localPt.y }, center, node.rotation || 0);
}

/** Rotates a world-space drag delta into a node's rotated local axes. */
export function worldDeltaToNodeLocalDelta(rotation: number, dx: number, dy: number): Point2D {
  if (!rotation) return { x: dx, y: dy };
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * Re-normalizes a PathNode so its local anchor points start at (0, 0) and
 * its (x, y, width, height) match the true sampled curve bounds.
 * Compensates world position for `node.rotation` so editing a rotated path never jumps!
 */
export function normalizePathNode(node: PathNode): PathNode {
  const boundsList = [
    computeSubpathBounds(node.points, node.closed),
    ...(node.subpaths ?? []).map((sp) => computeSubpathBounds(sp.points, sp.closed)),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (boundsList.length === 0) {
    return { ...node, width: Math.max(1, node.width), height: Math.max(1, node.height) };
  }

  const minX = Math.min(...boundsList.map((b) => b.minX));
  const minY = Math.min(...boundsList.map((b) => b.minY));
  const maxX = Math.max(...boundsList.map((b) => b.maxX));
  const maxY = Math.max(...boundsList.map((b) => b.maxY));

  const shiftX = -minX;
  const shiftY = -minY;
  const width = Math.max(1, roundCoord(maxX - minX));
  const height = Math.max(1, roundCoord(maxY - minY));

  let nextX = roundCoord(node.x + minX);
  let nextY = roundCoord(node.y + minY);
  if (node.rotation) {
    // Rotate local center shift by +node.rotation so visual world anchors stay pinned in place!
    const oldCenterX = node.x + node.width / 2;
    const oldCenterY = node.y + node.height / 2;
    const dcx = minX + width / 2 - node.width / 2;
    const dcy = minY + height / 2 - node.height / 2;
    const rad = (node.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const nextCenterX = oldCenterX + dcx * cos - dcy * sin;
    const nextCenterY = oldCenterY + dcx * sin + dcy * cos;
    nextX = roundCoord(nextCenterX - width / 2);
    nextY = roundCoord(nextCenterY - height / 2);
  }

  const next: PathNode = {
    ...node,
    x: nextX,
    y: nextY,
    width,
    height,
    points: node.points.map((pt) => shiftAnchorPoint(pt, shiftX, shiftY)),
  };
  if (node.subpaths && node.subpaths.length > 0) {
    next.subpaths = node.subpaths.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map((pt) => shiftAnchorPoint(pt, shiftX, shiftY)),
    }));
  }
  return next;
}

export function scalePathNodeGeometry(
  node: PathNode,
  nextX: number,
  nextY: number,
  nextWidth: number,
  nextHeight: number,
  uniformStrokeScale?: number,
): PathNode {
  const scaleX = nextWidth / Math.max(1, node.width);
  const scaleY = nextHeight / Math.max(1, node.height);
  const next: PathNode = {
    ...node,
    x: roundCoord(nextX),
    y: roundCoord(nextY),
    width: Math.max(1, roundCoord(nextWidth)),
    height: Math.max(1, roundCoord(nextHeight)),
    points: node.points.map((pt) => scaleAnchorPoint(pt, scaleX, scaleY)),
    style: uniformStrokeScale !== undefined
      ? { ...node.style, strokeWidth: Math.max(0, roundCoord(node.style.strokeWidth * uniformStrokeScale)) }
      : node.style,
  };
  if (node.subpaths && node.subpaths.length > 0) {
    next.subpaths = node.subpaths.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map((pt) => scaleAnchorPoint(pt, scaleX, scaleY)),
    }));
  }
  return next;
}

export function createPolygonPathPoints(width: number, height: number, sides = 6): VectorAnchorPoint[] {
  const safeSides = Math.max(3, Math.min(24, Math.round(sides)));
  const rx = Math.max(1, width) / 2;
  const ry = Math.max(1, height) / 2;
  const cx = rx;
  const cy = ry;
  const points: VectorAnchorPoint[] = [];
  for (let i = 0; i < safeSides; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / safeSides;
    points.push({
      id: createAnchorId('poly'),
      x: roundCoord(cx + Math.cos(angle) * rx),
      y: roundCoord(cy + Math.sin(angle) * ry),
      pointType: 'corner',
    });
  }
  return points;
}

export function createStarPathPoints(
  width: number,
  height: number,
  pointsCount = 5,
  innerRatio = 0.44,
): VectorAnchorPoint[] {
  const spikes = Math.max(3, Math.min(24, Math.round(pointsCount)));
  const ratio = Math.max(0.15, Math.min(0.9, innerRatio));
  const rx = Math.max(1, width) / 2;
  const ry = Math.max(1, height) / 2;
  const cx = rx;
  const cy = ry;
  const total = spikes * 2;
  const points: VectorAnchorPoint[] = [];
  for (let i = 0; i < total; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes;
    const radiusScale = i % 2 === 0 ? 1 : ratio;
    points.push({
      id: createAnchorId('star'),
      x: roundCoord(cx + Math.cos(angle) * rx * radiusScale),
      y: roundCoord(cy + Math.sin(angle) * ry * radiusScale),
      pointType: 'corner',
    });
  }
  return points;
}

export function createLinePathPoints(dx: number, dy: number): {
  points: VectorAnchorPoint[];
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
} {
  const minX = Math.min(0, dx);
  const minY = Math.min(0, dy);
  const width = Math.max(1, Math.abs(dx));
  const height = Math.max(1, Math.abs(dy));
  return {
    offsetX: minX,
    offsetY: minY,
    width,
    height,
    points: [
      { id: createAnchorId('ln'), x: roundCoord(-minX), y: roundCoord(-minY), pointType: 'corner' },
      { id: createAnchorId('ln'), x: roundCoord(dx - minX), y: roundCoord(dy - minY), pointType: 'corner' },
    ],
  };
}

/**
 * Fits smooth Catmull-Rom-derived cubic Bezier handles through a sequence of
 * points (powers the Adobe Illustrator-style Curvature Tool and Pencil smoothing).
 */
export function fitCatmullRomToBezier(
  rawPoints: readonly (Point2D & { corner?: boolean })[],
  closed: boolean,
  tension = 0.25,
): VectorAnchorPoint[] {
  const n = rawPoints.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ id: createAnchorId('cv'), x: roundCoord(rawPoints[0].x), y: roundCoord(rawPoints[0].y), pointType: 'corner' }];
  }

  return rawPoints.map((pt, i) => {
    const anchor: VectorAnchorPoint = {
      id: createAnchorId('cv'),
      x: roundCoord(pt.x),
      y: roundCoord(pt.y),
      pointType: pt.corner ? 'corner' : 'smooth',
    };
    if (pt.corner) return anchor;

    const prev = i > 0 ? rawPoints[i - 1] : (closed ? rawPoints[n - 1] : rawPoints[0]);
    const next = i < n - 1 ? rawPoints[i + 1] : (closed ? rawPoints[0] : rawPoints[n - 1]);
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    if (closed || i > 0) {
      anchor.handleIn = {
        x: roundCoord(pt.x - dx * tension),
        y: roundCoord(pt.y - dy * tension),
      };
    }
    if (closed || i < n - 1) {
      anchor.handleOut = {
        x: roundCoord(pt.x + dx * tension),
        y: roundCoord(pt.y + dy * tension),
      };
    }
    return anchor;
  });
}

function perpendicularDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/** Ramer-Douglas-Peucker polyline simplification for clean freehand Pencil strokes. */
export function simplifyPolyline(points: readonly Point2D[], tolerance = 3.5): Point2D[] {
  if (points.length <= 2) return [...points];
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
    const right = simplifyPolyline(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[end]];
}

export function simplifyFreehandToPathPoints(
  rawPoints: readonly Point2D[],
  tolerance = 4,
): { points: VectorAnchorPoint[]; closed: boolean } {
  if (rawPoints.length < 2) {
    return {
      points: rawPoints.map((pt) => ({ id: createAnchorId('pen'), x: roundCoord(pt.x), y: roundCoord(pt.y), pointType: 'corner' })),
      closed: false,
    };
  }
  const first = rawPoints[0];
  const last = rawPoints[rawPoints.length - 1];
  const closed = rawPoints.length > 6 && Math.hypot(last.x - first.x, last.y - first.y) <= 18;
  const trimmed = closed ? rawPoints.slice(0, -1) : rawPoints;
  const simplified = simplifyPolyline(trimmed, tolerance);
  const points = fitCatmullRomToBezier(simplified, closed, 0.22);
  return { points, closed };
}

/**
 * Illustrator Smooth Tool: locally relaxes anchor points and recomputes smooth
 * tangent handles for anchors within the brush radius of a stroke (rotation-safe).
 */
export function smoothPathAnchors(
  node: PathNode,
  brushPoints: readonly Point2D[],
  radius = 36,
): PathNode {
  if (node.points.length < 3 || brushPoints.length === 0) return node;
  const nextPoints = node.points.map((pt) => ({ ...pt }));
  const n = nextPoints.length;

  for (let i = 0; i < n; i += 1) {
    if (!node.closed && (i === 0 || i === n - 1)) continue;
    const worldPt = nodeLocalPointToWorld(node, nextPoints[i]);
    const nearBrush = brushPoints.some((bp) => Math.hypot(bp.x - worldPt.x, bp.y - worldPt.y) <= radius);
    if (!nearBrush) continue;

    const prev = node.points[(i - 1 + n) % n];
    const next = node.points[(i + 1) % n];
    const avgX = (prev.x + node.points[i].x * 2 + next.x) / 4;
    const avgY = (prev.y + node.points[i].y * 2 + next.y) / 4;
    const tx = (next.x - prev.x) * 0.22;
    const ty = (next.y - prev.y) * 0.22;
    nextPoints[i] = {
      id: nextPoints[i].id,
      x: roundCoord(avgX),
      y: roundCoord(avgY),
      handleIn: { x: roundCoord(avgX - tx), y: roundCoord(avgY - ty) },
      handleOut: { x: roundCoord(avgX + tx), y: roundCoord(avgY + ty) },
      pointType: 'smooth',
    };
  }

  return normalizePathNode({ ...node, points: nextPoints, shapeMeta: undefined });
}

/**
 * Deletes an anchor point cleanly from a PathNode while preserving minimum
 * contour validity (2 points open, 3 points closed).
 */
export function deleteAnchorPoint(node: PathNode, anchorIndex: number): PathNode | null {
  const minPoints = node.closed ? 3 : 2;
  if (node.points.length <= minPoints) return null;
  if (anchorIndex < 0 || anchorIndex >= node.points.length) return null;
  const nextPoints = node.points.filter((_, idx) => idx !== anchorIndex);
  return normalizePathNode({ ...node, points: nextPoints, shapeMeta: undefined });
}

/**
 * Updates parametric Polygon or Star geometry in-place while preserving visual center,
 * bounding box size, rotation, and style (powers On-Canvas Smart Handles).
 */
export function updateParametricPathNode(node: PathNode, meta: VectorShapeMeta): PathNode {
  const w = Math.max(8, node.width);
  const h = Math.max(8, node.height);
  if (meta.kind === 'polygon') {
    const sides = Math.max(3, Math.min(24, Math.round(meta.sides)));
    return {
      ...node,
      points: createPolygonPathPoints(w, h, sides),
      closed: true,
      pathKind: 'polygon',
      shapeMeta: { kind: 'polygon', sides },
    };
  }
  const spikes = Math.max(3, Math.min(24, Math.round(meta.spikes)));
  const innerRatio = Math.max(0.15, Math.min(0.9, Math.round(meta.innerRatio * 100) / 100));
  return {
    ...node,
    points: createStarPathPoints(w, h, spikes, innerRatio),
    closed: true,
    pathKind: 'star',
    shapeMeta: { kind: 'star', spikes, innerRatio },
  };
}

/**
 * Illustrator Simplify Path action: reduces point density on complex paths
 * while keeping smooth curves intact.
 */
export function simplifyPathNode(node: PathNode, tolerance = 6): PathNode {
  if (node.points.length <= 3) return node;
  const sampled = sampleSubpathToPolygon(node.points, node.closed, 6);
  const reduced = simplifyPolyline(sampled, tolerance);
  if (reduced.length < 2) return node;
  const fitted = fitCatmullRomToBezier(reduced, node.closed, 0.22);
  return normalizePathNode({ ...node, points: fitted });
}

/**
 * Finds the nearest segment on a PathNode to a local point and splits the cubic
 * Bezier cleanly using de Casteljau subdivision.
 */
export function findNearestSegmentHit(
  node: PathNode,
  localPoint: Point2D,
  maxDistance = 16,
): { segmentIndex: number; t: number; point: Point2D; distance: number } | null {
  const pts = node.points;
  const segCount = node.closed ? pts.length : pts.length - 1;
  let best: { segmentIndex: number; t: number; point: Point2D; distance: number } | null = null;

  for (let i = 0; i < segCount; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c1 = a.handleOut ?? { x: a.x, y: a.y };
    const c2 = b.handleIn ?? { x: b.x, y: b.y };
    const steps = 20;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const sample = evaluateCubicBezier(a, c1, c2, b, t);
      const dist = Math.hypot(sample.x - localPoint.x, sample.y - localPoint.y);
      if (dist <= maxDistance && (!best || dist < best.distance)) {
        best = { segmentIndex: i, t, point: sample, distance: dist };
      }
    }
  }
  return best;
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Inserts an anchor point cleanly on a PathNode segment using de Casteljau subdivision. */
export function insertAnchorOnPathSegment(
  node: PathNode,
  segmentIndex: number,
  t: number,
): { node: PathNode; insertedIndex: number } {
  const pts = node.points.map((pt) => ({
    ...pt,
    ...(pt.handleIn ? { handleIn: { ...pt.handleIn } } : {}),
    ...(pt.handleOut ? { handleOut: { ...pt.handleOut } } : {}),
  }));
  const clampedT = Math.max(0.05, Math.min(0.95, t));
  const nextIndex = (segmentIndex + 1) % pts.length;
  const a = pts[segmentIndex];
  const b = pts[nextIndex];

  const isCurved = Boolean(a.handleOut || b.handleIn);
  let inserted: VectorAnchorPoint;

  if (isCurved) {
    const p0 = { x: a.x, y: a.y };
    const p1 = a.handleOut ?? p0;
    const p3 = { x: b.x, y: b.y };
    const p2 = b.handleIn ?? p3;

    const q0 = lerpPoint(p0, p1, clampedT);
    const q1 = lerpPoint(p1, p2, clampedT);
    const q2 = lerpPoint(p2, p3, clampedT);
    const r0 = lerpPoint(q0, q1, clampedT);
    const r1 = lerpPoint(q1, q2, clampedT);
    const s = lerpPoint(r0, r1, clampedT);

    a.handleOut = { x: roundCoord(q0.x), y: roundCoord(q0.y) };
    b.handleIn = { x: roundCoord(q2.x), y: roundCoord(q2.y) };
    inserted = {
      id: createAnchorId('pt'),
      x: roundCoord(s.x),
      y: roundCoord(s.y),
      handleIn: { x: roundCoord(r0.x), y: roundCoord(r0.y) },
      handleOut: { x: roundCoord(r1.x), y: roundCoord(r1.y) },
      pointType: 'smooth',
    };
  } else {
    const pos = lerpPoint(a, b, clampedT);
    inserted = {
      id: createAnchorId('pt'),
      x: roundCoord(pos.x),
      y: roundCoord(pos.y),
      pointType: 'corner',
    };
  }

  const insertAt = segmentIndex + 1;
  pts.splice(insertAt, 0, inserted);
  return {
    node: normalizePathNode({ ...node, points: pts }),
    insertedIndex: insertAt,
  };
}

/**
 * Illustrator Anchor Point Convert Tool: toggles an anchor between sharp corner
 * (no handles) and smooth symmetric Bezier handles inferred from its neighbors.
 */
export function toggleAnchorPointType(node: PathNode, anchorIndex: number): PathNode {
  if (anchorIndex < 0 || anchorIndex >= node.points.length) return node;
  const pts = node.points.map((pt) => ({ ...pt }));
  const current = pts[anchorIndex];
  const hasHandles = Boolean(current.handleIn || current.handleOut);

  if (hasHandles) {
    const nextPt: VectorAnchorPoint = {
      id: current.id,
      x: current.x,
      y: current.y,
      pointType: 'corner',
    };
    pts[anchorIndex] = nextPt;
  } else {
    const n = pts.length;
    const prev = anchorIndex > 0 ? pts[anchorIndex - 1] : (node.closed ? pts[n - 1] : pts[0]);
    const next = anchorIndex < n - 1 ? pts[anchorIndex + 1] : (node.closed ? pts[0] : pts[n - 1]);
    const dx = (next.x - prev.x) * 0.25;
    const dy = (next.y - prev.y) * 0.25;
    const fallback = Math.hypot(dx, dy) < 1 ? { x: 24, y: 0 } : { x: dx, y: dy };
    pts[anchorIndex] = {
      id: current.id,
      x: current.x,
      y: current.y,
      handleIn: { x: roundCoord(current.x - fallback.x), y: roundCoord(current.y - fallback.y) },
      handleOut: { x: roundCoord(current.x + fallback.x), y: roundCoord(current.y + fallback.y) },
      pointType: 'symmetric',
    };
  }
  return normalizePathNode({ ...node, points: pts });
}

/**
 * Illustrator Scissors Tool: splits a PathNode at the clicked segment or anchor.
 * - Closed path -> opens cleanly at the cut point (returns 1 open PathNode).
 * - Open path -> splits into 2 separate editable PathNodes!
 */
export function splitPathAtLocalPoint(
  node: PathNode,
  localPoint: Point2D,
  createNewId: () => string,
  tolerance = 18,
): PathNode[] | null {
  if (node.points.length < 2) return null;
  const hit = findNearestSegmentHit(node, localPoint, tolerance);
  if (!hit) return null;

  const { node: subdivided, insertedIndex } = insertAnchorOnPathSegment(node, hit.segmentIndex, hit.t);
  const pts = subdivided.points;

  if (subdivided.closed) {
    // Re-order points starting at the cut point and open the path
    const cutStart = { ...pts[insertedIndex], handleIn: undefined };
    const cutEnd = { ...pts[insertedIndex], id: createAnchorId('cut'), handleOut: undefined };
    const reordered = [
      cutStart,
      ...pts.slice(insertedIndex + 1),
      ...pts.slice(0, insertedIndex),
      cutEnd,
    ];
    return [
      normalizePathNode({
        ...subdivided,
        closed: false,
        points: reordered,
        style: {
          ...subdivided.style,
          fill: 'none',
          stroke: subdivided.style.stroke === 'none' || subdivided.style.stroke === '#00000000'
            ? (subdivided.style.fill !== 'none' ? subdivided.style.fill : '#20212A')
            : subdivided.style.stroke,
          strokeWidth: Math.max(2, subdivided.style.strokeWidth),
        },
      }),
    ];
  }

  // Open path -> split into two independent PathNodes
  const firstPts = pts.slice(0, insertedIndex + 1).map((pt, idx, arr) =>
    idx === arr.length - 1 ? { ...pt, handleOut: undefined } : pt,
  );
  const secondPts = pts.slice(insertedIndex).map((pt, idx) =>
    idx === 0 ? { ...pt, id: createAnchorId('cut'), handleIn: undefined } : pt,
  );
  if (firstPts.length < 2 || secondPts.length < 2) return null;

  const first = normalizePathNode({ ...subdivided, points: firstPts, closed: false });
  const second = normalizePathNode({
    ...subdivided,
    id: createNewId(),
    name: `${subdivided.name} Split`,
    points: secondPts,
    closed: false,
  });
  return [first, second];
}

/**
 * Converts a RectNode, FrameNode, or EllipseNode into a fully editable cubic
 * Bezier PathNode (exact kappa ellipse & rounded-rectangle Bezier arcs!).
 */
export function convertShapeToPathNode(
  node: RectNode | FrameNode | EllipseNode,
): PathNode {
  const w = Math.max(1, node.width);
  const h = Math.max(1, node.height);
  let points: VectorAnchorPoint[];

  if (node.type === 'ellipse') {
    const rx = w / 2;
    const ry = h / 2;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    points = [
      {
        id: createAnchorId('el'),
        x: roundCoord(rx),
        y: 0,
        handleIn: { x: roundCoord(rx - kx), y: 0 },
        handleOut: { x: roundCoord(rx + kx), y: 0 },
        pointType: 'symmetric',
      },
      {
        id: createAnchorId('el'),
        x: roundCoord(w),
        y: roundCoord(ry),
        handleIn: { x: roundCoord(w), y: roundCoord(ry - ky) },
        handleOut: { x: roundCoord(w), y: roundCoord(ry + ky) },
        pointType: 'symmetric',
      },
      {
        id: createAnchorId('el'),
        x: roundCoord(rx),
        y: roundCoord(h),
        handleIn: { x: roundCoord(rx + kx), y: roundCoord(h) },
        handleOut: { x: roundCoord(rx - kx), y: roundCoord(h) },
        pointType: 'symmetric',
      },
      {
        id: createAnchorId('el'),
        x: 0,
        y: roundCoord(ry),
        handleIn: { x: 0, y: roundCoord(ry + ky) },
        handleOut: { x: 0, y: roundCoord(ry - ky) },
        pointType: 'symmetric',
      },
    ];
  } else {
    const r = Math.min(Math.max(0, node.style.radius ?? 0), w / 2, h / 2);
    if (r < 0.5) {
      points = [
        { id: createAnchorId('rc'), x: 0, y: 0, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w), y: 0, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w), y: roundCoord(h), pointType: 'corner' },
        { id: createAnchorId('rc'), x: 0, y: roundCoord(h), pointType: 'corner' },
      ];
    } else {
      const k = r * KAPPA;
      points = [
        { id: createAnchorId('rc'), x: roundCoord(r), y: 0, handleIn: { x: roundCoord(r - k), y: 0 }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w - r), y: 0, handleOut: { x: roundCoord(w - r + k), y: 0 }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w), y: roundCoord(r), handleIn: { x: roundCoord(w), y: roundCoord(r - k) }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w), y: roundCoord(h - r), handleOut: { x: roundCoord(w), y: roundCoord(h - r + k) }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(w - r), y: roundCoord(h), handleIn: { x: roundCoord(w - r + k), y: roundCoord(h) }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: roundCoord(r), y: roundCoord(h), handleOut: { x: roundCoord(r - k), y: roundCoord(h) }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: 0, y: roundCoord(h - r), handleIn: { x: 0, y: roundCoord(h - r + k) }, pointType: 'corner' },
        { id: createAnchorId('rc'), x: 0, y: roundCoord(r), handleOut: { x: 0, y: roundCoord(r - k) }, pointType: 'corner' },
      ];
    }
  }

  return {
    id: node.id,
    name: `${node.name} Path`,
    type: 'path',
    x: node.x,
    y: node.y,
    width: w,
    height: h,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    locked: node.locked,
    ...(node.layerColor ? { layerColor: node.layerColor } : {}),
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    ...(node.onCanvas !== undefined ? { onCanvas: node.onCanvas } : {}),
    ...(node.clipMaskBaseId ? { clipMaskBaseId: node.clipMaskBaseId } : {}),
    points,
    closed: true,
    pathKind: 'outline',
    style: {
      fill: node.style.fill,
      stroke: node.style.stroke,
      strokeWidth: node.style.strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fillRule: 'nonzero',
    },
  };
}

export function flipPathNode(node: PathNode, axis: 'horizontal' | 'vertical'): PathNode {
  const flipPt = (pt: VectorAnchorPoint): VectorAnchorPoint => {
    const flipHandle = (h?: VectorPointHandle): VectorPointHandle | undefined =>
      h
        ? {
            x: axis === 'horizontal' ? roundCoord(node.width - h.x) : h.x,
            y: axis === 'vertical' ? roundCoord(node.height - h.y) : h.y,
          }
        : undefined;
    const next: VectorAnchorPoint = {
      id: pt.id,
      x: axis === 'horizontal' ? roundCoord(node.width - pt.x) : pt.x,
      y: axis === 'vertical' ? roundCoord(node.height - pt.y) : pt.y,
      pointType: pt.pointType,
    };
    const hIn = flipHandle(pt.handleIn);
    const hOut = flipHandle(pt.handleOut);
    if (hIn) next.handleIn = hIn;
    if (hOut) next.handleOut = hOut;
    return next;
  };
  return {
    ...node,
    points: node.points.map(flipPt),
    ...(node.subpaths
      ? { subpaths: node.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map(flipPt) })) }
      : {}),
  };
}

// ============================================================================
// Concave-Safe 2D Planar Pathfinder & Interactive Shape Builder Engine
// ============================================================================

function toWorldPath(node: DesignNode): { points: VectorAnchorPoint[]; closed: boolean; subpaths?: VectorSubpath[] } | null {
  let pathNode: PathNode | null = null;
  if (node.type === 'path') {
    pathNode = node;
  } else if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    pathNode = convertShapeToPathNode(node);
  }
  if (!pathNode) return null;

  const center = { x: pathNode.x + pathNode.width / 2, y: pathNode.y + pathNode.height / 2 };
  const mapAnchor = (pt: VectorAnchorPoint): VectorAnchorPoint => {
    const worldPos = rotatePointAround({ x: pathNode!.x + pt.x, y: pathNode!.y + pt.y }, center, pathNode!.rotation);
    const next: VectorAnchorPoint = {
      id: createAnchorId('bool'),
      x: roundCoord(worldPos.x),
      y: roundCoord(worldPos.y),
      pointType: pt.pointType,
    };
    if (pt.handleIn) {
      const hIn = rotatePointAround({ x: pathNode!.x + pt.handleIn.x, y: pathNode!.y + pt.handleIn.y }, center, pathNode!.rotation);
      next.handleIn = { x: roundCoord(hIn.x), y: roundCoord(hIn.y) };
    }
    if (pt.handleOut) {
      const hOut = rotatePointAround({ x: pathNode!.x + pt.handleOut.x, y: pathNode!.y + pt.handleOut.y }, center, pathNode!.rotation);
      next.handleOut = { x: roundCoord(hOut.x), y: roundCoord(hOut.y) };
    }
    return next;
  };

  return {
    points: pathNode.points.map(mapAnchor),
    closed: pathNode.closed,
    subpaths: pathNode.subpaths?.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map(mapAnchor),
    })),
  };
}

function worldPathToPlanarShape(world: { points: VectorAnchorPoint[]; closed: boolean; subpaths?: VectorSubpath[] }): PlanarShapeInput {
  const contours: PlanarPoint[][] = [];
  const mainPoly = sampleSubpathToPolygon(world.points, true, 14);
  if (mainPoly.length >= 3) contours.push(mainPoly);
  if (world.subpaths) {
    for (const sp of world.subpaths) {
      const spPoly = sampleSubpathToPolygon(sp.points, true, 14);
      if (spPoly.length >= 3) contours.push(spPoly);
    }
  }
  return { contours };
}

function polygonToAnchors(poly: readonly Point2D[]): VectorAnchorPoint[] {
  const simplified = simplifyPolyline([...poly, poly[0]], 0.45);
  if (simplified.length > 1) simplified.pop();
  const source = simplified.length >= 3 ? simplified : poly;
  return source.map((pt) => ({
    id: createAnchorId('pf'),
    x: roundCoord(pt.x),
    y: roundCoord(pt.y),
    pointType: 'corner',
  }));
}

function getBaseStyle(node: DesignNode): PathNode['style'] {
  if (node.type === 'path') return { ...node.style };
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    return {
      fill: node.style.fill,
      stroke: node.style.stroke,
      strokeWidth: node.style.strokeWidth,
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

function buildPathNodeFromFaces(
  faces: readonly PlanarFace[],
  templateNode: DesignNode,
  newId: string,
  name: string,
  fillRule: 'nonzero' | 'evenodd' = 'evenodd',
): PathNode | null {
  const contours = assembleFacesToContours(faces);
  if (contours.length === 0) return null;
  const anchorLoops = contours
    .map((contour) => polygonToAnchors(contour.points))
    .filter((pts) => pts.length >= 3);
  if (anchorLoops.length === 0) return null;

  const baseStyle = getBaseStyle(templateNode);
  const [mainPoints, ...extraLoops] = anchorLoops;
  const subpaths: VectorSubpath[] = extraLoops.map((pts) => ({ points: pts, closed: true }));

  return normalizePathNode({
    id: newId,
    name,
    type: 'path',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: templateNode.opacity,
    visible: true,
    locked: false,
    onCanvas: true,
    ...(templateNode.parentId !== undefined ? { parentId: templateNode.parentId } : {}),
    points: mainPoints,
    closed: true,
    ...(subpaths.length > 0 ? { subpaths } : {}),
    pathKind: 'boolean',
    style: {
      ...baseStyle,
      fillRule: subpaths.length > 0 ? 'evenodd' : fillRule,
    },
  });
}

/**
 * Executes concave-safe 2D Planar Pathfinder operations on 2+ vector/shape nodes:
 * - `unite`: dissolves internal overlapping seams into clean outer silhouette(s) & true holes.
 * - `subtract` (Minus Front): punches front shapes cleanly out of base shape (concave-safe!).
 * - `intersect`: computes the exact overlapping geometric region (works on Stars & concave paths!).
 * - `exclude`: computes the crisp symmetric XOR region (`odd` parity faces).
 */
export function applyPathfinderOperation(
  nodes: readonly DesignNode[],
  operation: PathfinderOperation,
  newId: string,
): PathNode | null {
  const vectorNodes = nodes
    .map((node) => ({ node, world: toWorldPath(node) }))
    .filter((item): item is { node: DesignNode; world: NonNullable<ReturnType<typeof toWorldPath>> } => item.world !== null);

  if (vectorNodes.length < 2) return null;

  const baseNode = vectorNodes[0].node;
  const opLabels: Record<PathfinderOperation, string> = {
    unite: 'United Path',
    subtract: 'Subtracted Path',
    intersect: 'Intersected Path',
    exclude: 'Excluded Path',
  };

  const planarShapes = vectorNodes.map((item) => worldPathToPlanarShape(item.world));
  const arrangement = buildPlanarArrangement(planarShapes);
  const totalCount = vectorNodes.length;

  let selectedFaces: PlanarFace[];
  if (operation === 'unite') {
    selectedFaces = arrangement.faces.filter((face) => face.memberShapeIndices.length >= 1);
  } else if (operation === 'subtract') {
    selectedFaces = arrangement.faces.filter(
      (face) => face.memberShapeIndices.length === 1 && face.memberShapeIndices[0] === 0,
    );
  } else if (operation === 'intersect') {
    selectedFaces = arrangement.faces.filter((face) => face.memberShapeIndices.length === totalCount);
  } else {
    selectedFaces = arrangement.faces.filter((face) => face.memberShapeIndices.length % 2 === 1);
  }

  return buildPathNodeFromFaces(
    selectedFaces,
    baseNode,
    newId,
    opLabels[operation],
    operation === 'unite' ? 'nonzero' : 'evenodd',
  );
}

/**
 * Decomposes 2+ selected shape/path nodes into atomic planar faces for the
 * interactive Shape Builder tool (`Shift+M`).
 */
export function decomposeNodesForShapeBuilder(nodes: readonly DesignNode[]): {
  candidates: DesignNode[];
  arrangement: PlanarArrangement;
} {
  const items = nodes
    .map((node) => ({ node, world: toWorldPath(node) }))
    .filter((item): item is { node: DesignNode; world: NonNullable<ReturnType<typeof toWorldPath>> } => item.world !== null);
  if (items.length < 2) {
    return { candidates: items.map((i) => i.node), arrangement: { vertices: [], faces: [] } };
  }
  const arrangement = buildPlanarArrangement(items.map((item) => worldPathToPlanarShape(item.world)));
  return { candidates: items.map((item) => item.node), arrangement };
}

/**
 * Resolves an interactive Shape Builder gesture (merge touched faces OR Alt-punch
 * touched faces) into the resulting replacement PathNodes for a single atomic undo step.
 */
export function applyShapeBuilderAction(
  candidates: readonly DesignNode[],
  arrangement: PlanarArrangement,
  touchedFaceIds: readonly number[],
  mode: 'merge' | 'punch',
  createNewId: () => string,
): PathNode[] | null {
  if (candidates.length === 0 || arrangement.faces.length === 0 || touchedFaceIds.length === 0) {
    return null;
  }
  const touchedSet = new Set(touchedFaceIds);
  const touchedFaces = arrangement.faces.filter((f) => touchedSet.has(f.id));
  if (touchedFaces.length === 0) return null;

  const resultNodes: PathNode[] = [];

  if (mode === 'merge') {
    // 1. Merge all touched faces into a single unified PathNode styled after the first touched face's top source shape
    const firstFace = touchedFaces[0];
    const styleSourceIdx = firstFace.memberShapeIndices[firstFace.memberShapeIndices.length - 1] ?? 0;
    const styleTemplate = candidates[styleSourceIdx] ?? candidates[0];
    const merged = buildPathNodeFromFaces(touchedFaces, styleTemplate, createNewId(), 'Built Shape', 'nonzero');
    if (!merged) return null;

    // 2. Preserve untouched remaining faces grouped by their top contributing shape
    const remainingByTopShape = new Map<number, PlanarFace[]>();
    for (const face of arrangement.faces) {
      if (touchedSet.has(face.id)) continue;
      const topIdx = face.memberShapeIndices[face.memberShapeIndices.length - 1] ?? 0;
      const bucket = remainingByTopShape.get(topIdx);
      if (bucket) bucket.push(face);
      else remainingByTopShape.set(topIdx, [face]);
    }

    for (const [shapeIdx, faces] of remainingByTopShape.entries()) {
      const source = candidates[shapeIdx] ?? candidates[0];
      const built = buildPathNodeFromFaces(faces, source, createNewId(), `${source.name} Part`, 'evenodd');
      if (built) resultNodes.push(built);
    }
    resultNodes.push(merged);
    return resultNodes;
  }

  // `punch` (Alt+Click / Alt+Drag): delete touched faces and rebuild surviving regions cleanly
  const survivingByTopShape = new Map<number, PlanarFace[]>();
  for (const face of arrangement.faces) {
    if (touchedSet.has(face.id)) continue;
    const topIdx = face.memberShapeIndices[face.memberShapeIndices.length - 1] ?? 0;
    const bucket = survivingByTopShape.get(topIdx);
    if (bucket) bucket.push(face);
    else survivingByTopShape.set(topIdx, [face]);
  }

  for (const [shapeIdx, faces] of survivingByTopShape.entries()) {
    const source = candidates[shapeIdx] ?? candidates[0];
    const built = buildPathNodeFromFaces(faces, source, createNewId(), `${source.name} Carved`, 'evenodd');
    if (built) resultNodes.push(built);
  }
  return resultNodes;
}

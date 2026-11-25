import { isTransparentColor } from '../../core/document/styling';
import type { EffectiveLayerState } from '../../core/document/layers';
import type { DesignNode, PathNode, VectorAnchorPoint } from '../../core/document/types';

export interface CanvasPoint2D {
  readonly x: number;
  readonly y: number;
}

interface PolylineContour {
  readonly points: readonly CanvasPoint2D[];
  readonly closed: boolean;
}

/**
 * Converts a world-space point into node-local coordinates [0..width, 0..height],
 * undoing the node's rotation around its center.
 */
export function toNodeLocalPoint(node: DesignNode, worldPoint: CanvasPoint2D): CanvasPoint2D {
  const cx = node.x + node.width * 0.5;
  const cy = node.y + node.height * 0.5;
  let dx = worldPoint.x - cx;
  let dy = worldPoint.y - cy;
  if (node.rotation) {
    const rad = (-node.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }
  return {
    x: dx + node.width * 0.5,
    y: dy + node.height * 0.5,
  };
}

/**
 * Exact point-in-rounded-rectangle check in local coordinates [0..width, 0..height].
 * Clicking the empty exterior corner outside a rounded corner arc returns false.
 */
export function isPointInRoundedRect(
  lx: number,
  ly: number,
  width: number,
  height: number,
  radius: number,
  pad = 0,
): boolean {
  const minX = -pad;
  const minY = -pad;
  const maxX = width + pad;
  const maxY = height + pad;
  if (lx < minX || lx > maxX || ly < minY || ly > maxY) {
    return false;
  }
  const effW = maxX - minX;
  const effH = maxY - minY;
  const r = Math.max(0, Math.min(radius + (radius > 0 ? pad : 0), effW * 0.5, effH * 0.5));
  if (r <= 0.001) return true;

  const px = lx - minX;
  const py = ly - minY;

  let cornerCx = 0;
  let cornerCy = 0;
  let inCornerZone = false;

  if (px < r && py < r) {
    cornerCx = r;
    cornerCy = r;
    inCornerZone = true;
  } else if (px > effW - r && py < r) {
    cornerCx = effW - r;
    cornerCy = r;
    inCornerZone = true;
  } else if (px > effW - r && py > effH - r) {
    cornerCx = effW - r;
    cornerCy = effH - r;
    inCornerZone = true;
  } else if (px < r && py > effH - r) {
    cornerCx = r;
    cornerCy = effH - r;
    inCornerZone = true;
  }

  if (!inCornerZone) return true;
  const dx = px - cornerCx;
  const dy = py - cornerCy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Exact point-in-ellipse check in local coordinates [0..width, 0..height].
 * Clicking empty corners of the bounding box outside the ellipse returns false.
 */
export function isPointInEllipse(
  lx: number,
  ly: number,
  width: number,
  height: number,
  pad = 0,
): boolean {
  const rx = width * 0.5 + pad;
  const ry = height * 0.5 + pad;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (lx - width * 0.5) / rx;
  const dy = (ly - height * 0.5) / ry;
  return dx * dx + dy * dy <= 1;
}

function evalCubicBezier(
  p0: CanvasPoint2D,
  c1: CanvasPoint2D,
  c2: CanvasPoint2D,
  p3: CanvasPoint2D,
  t: number,
): CanvasPoint2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * p3.y,
  };
}

function flattenAnchorList(
  anchors: readonly VectorAnchorPoint[],
  closed: boolean,
  stepsPerCurve = 14,
): PolylineContour {
  if (anchors.length === 0) return { points: [], closed };
  const pts: CanvasPoint2D[] = [{ x: anchors[0].x, y: anchors[0].y }];
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const hasCurve = Boolean(a.handleOut || b.handleIn);
    if (!hasCurve) {
      pts.push({ x: b.x, y: b.y });
    } else {
      const c1 = a.handleOut ?? a;
      const c2 = b.handleIn ?? b;
      for (let s = 1; s <= stepsPerCurve; s += 1) {
        pts.push(evalCubicBezier(a, c1, c2, b, s / stepsPerCurve));
      }
    }
  }
  return { points: pts, closed };
}

function getPathContours(node: PathNode): PolylineContour[] {
  const contours: PolylineContour[] = [flattenAnchorList(node.points, node.closed)];
  if (node.subpaths && node.subpaths.length > 0) {
    for (const sub of node.subpaths) {
      contours.push(flattenAnchorList(sub.points, sub.closed));
    }
  }
  return contours;
}

function distanceToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

function isPointNearContours(
  contours: readonly PolylineContour[],
  px: number,
  py: number,
  maxDistance: number,
): boolean {
  const maxDistSq = maxDistance * maxDistance;
  for (const contour of contours) {
    const pts = contour.points;
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      const dx = px - pts[0].x;
      const dy = py - pts[0].y;
      if (dx * dx + dy * dy <= maxDistSq) return true;
      continue;
    }
    const segCount = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (distanceToSegmentSq(px, py, a.x, a.y, b.x, b.y) <= maxDistSq) {
        return true;
      }
    }
  }
  return false;
}

function isPointInClosedContours(
  contours: readonly PolylineContour[],
  px: number,
  py: number,
  fillRule: 'nonzero' | 'evenodd',
): boolean {
  if (fillRule === 'evenodd') {
    let inside = false;
    for (const contour of contours) {
      if (!contour.closed || contour.points.length < 3) continue;
      const pts = contour.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        const xi = pts[i].x;
        const yi = pts[i].y;
        const xj = pts[j].x;
        const yj = pts[j].y;
        const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
    }
    return inside;
  }

  let winding = 0;
  for (const contour of contours) {
    if (!contour.closed || contour.points.length < 3) continue;
    const pts = contour.points;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) {
          winding += 1;
        }
      } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

function getStrokeOutwardPad(strokeWidth: number, strokeAlign: 'inside' | 'center' | 'outside' | undefined): number {
  if (strokeWidth <= 0) return 0;
  if (strokeAlign === 'inside') return 0;
  if (strokeAlign === 'outside') return strokeWidth;
  return strokeWidth * 0.5;
}

function hasVisibleFill(node: DesignNode): boolean {
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
    if (node.style.fills && node.style.fills.length > 0) {
      return node.style.fills.some((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0 && (paint.type !== 'solid' || !isTransparentColor(paint.color)));
    }
    return !isTransparentColor(node.style.fill);
  }
  return true;
}

function hasVisibleStroke(node: DesignNode): boolean {
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
    return node.style.strokeWidth > 0 && !isTransparentColor(node.style.stroke);
  }
  if (node.type === 'image') {
    return (node.style.strokeWidth ?? 0) > 0 && !isTransparentColor(node.style.stroke);
  }
  return false;
}

/**
 * Shape-aware geometric hit test for a single DesignNode.
 * Respects rotation, ellipse equations, rounded corner arcs, polygon/star/Bezier paths,
 * and stroke widths/alignments rather than falling back to coarse AABB hit boxes.
 */
export function hitTestNodeAtPoint(
  node: DesignNode,
  worldPoint: CanvasPoint2D,
  strokeTolerance = 4,
): boolean {
  if (node.type === 'group') return false;

  const local = toNodeLocalPoint(node, worldPoint);
  const tol = Math.max(1, strokeTolerance);

  switch (node.type) {
    case 'ellipse': {
      const sw = hasVisibleStroke(node) ? node.style.strokeWidth : 0;
      const outPad = getStrokeOutwardPad(sw, node.style.strokeAlign);
      const filled = hasVisibleFill(node);
      if (filled || sw === 0) {
        return isPointInEllipse(local.x, local.y, node.width, node.height, outPad + 1);
      }
      const inPad = node.style.strokeAlign === 'outside' ? 0 : node.style.strokeAlign === 'inside' ? sw : sw * 0.5;
      const hitOuter = isPointInEllipse(local.x, local.y, node.width, node.height, outPad + tol);
      if (!hitOuter) return false;
      const innerW = Math.max(0, node.width - (inPad + tol) * 2);
      const innerH = Math.max(0, node.height - (inPad + tol) * 2);
      if (innerW <= 1 || innerH <= 1) return true;
      return !isPointInEllipse(
        local.x - (inPad + tol),
        local.y - (inPad + tol),
        innerW,
        innerH,
        0,
      );
    }

    case 'rect': {
      const sw = hasVisibleStroke(node) ? node.style.strokeWidth : 0;
      const outPad = getStrokeOutwardPad(sw, node.style.strokeAlign);
      const radius = node.style.radius ?? 0;
      const filled = hasVisibleFill(node);
      if (filled || sw === 0) {
        return isPointInRoundedRect(local.x, local.y, node.width, node.height, radius, outPad + 1);
      }
      const inPad = node.style.strokeAlign === 'outside' ? 0 : node.style.strokeAlign === 'inside' ? sw : sw * 0.5;
      const hitOuter = isPointInRoundedRect(local.x, local.y, node.width, node.height, radius, outPad + tol);
      if (!hitOuter) return false;
      const inset = inPad + tol;
      if (node.width - inset * 2 <= 1 || node.height - inset * 2 <= 1) return true;
      return !isPointInRoundedRect(
        local.x - inset,
        local.y - inset,
        node.width - inset * 2,
        node.height - inset * 2,
        Math.max(0, radius - inset),
        0,
      );
    }

    case 'frame': {
      const sw = hasVisibleStroke(node) ? node.style.strokeWidth : 0;
      const outPad = getStrokeOutwardPad(sw, node.style.strokeAlign);
      return isPointInRoundedRect(local.x, local.y, node.width, node.height, node.style.radius ?? 0, outPad + 1);
    }

    case 'image': {
      const sw = hasVisibleStroke(node) ? (node.style.strokeWidth ?? 0) : 0;
      return isPointInRoundedRect(local.x, local.y, node.width, node.height, node.style.radius ?? 0, sw * 0.5 + 1);
    }

    case 'path': {
      const contours = getPathContours(node);
      const filled = node.closed && hasVisibleFill(node);
      if (filled && isPointInClosedContours(contours, local.x, local.y, node.style.fillRule ?? 'nonzero')) {
        return true;
      }
      const sw = node.style.strokeWidth ?? 0;
      const strokeHitDist = node.closed
        ? (hasVisibleStroke(node) ? Math.max(tol, sw * 0.5 + tol) : tol)
        : Math.max(6, sw * 0.5 + tol);
      return isPointNearContours(contours, local.x, local.y, strokeHitDist);
    }

    case 'text':
    case 'component-instance': {
      return local.x >= -2 && local.x <= node.width + 2 && local.y >= -2 && local.y <= node.height + 2;
    }
  }
}

export interface HitTestOptions {
  readonly strokeTolerance?: number;
  readonly candidateIds?: ReadonlySet<string> | null;
}

/**
 * Finds the topmost visible, unlocked node whose actual shape contour contains worldPoint.
 * `orderedRenderNodes` is in paint order (bottom to top), so iteration proceeds in reverse.
 */
export function hitTestNodesAtPoint(
  orderedRenderNodes: readonly DesignNode[],
  worldPoint: CanvasPoint2D,
  layerStates: ReadonlyMap<string, EffectiveLayerState>,
  options: HitTestOptions = {},
): string | null {
  const strokeTolerance = options.strokeTolerance ?? 4;
  const candidateIds = options.candidateIds ?? null;

  for (let i = orderedRenderNodes.length - 1; i >= 0; i -= 1) {
    const node = orderedRenderNodes[i];
    if (node.type === 'group') continue;
    if (candidateIds && !candidateIds.has(node.id)) continue;
    const state = layerStates.get(node.id);
    if (!state?.visible || state.locked) continue;
    if (hitTestNodeAtPoint(node, worldPoint, strokeTolerance)) {
      return node.id;
    }
  }
  return null;
}

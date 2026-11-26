import { isTransparentColor } from '../../core/document/styling';
import type { EffectiveLayerState } from '../../core/document/layers';
import type { CornerRadiiConfig, DesignNode, PathNode, VectorAnchorPoint } from '../../core/document/types';
import { applyCornerRoundingToAnchors } from '../../core/document/vector';

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

function resolveNodeCornerRadii(
  radius: number | undefined,
  cornerRadii: CornerRadiiConfig | undefined,
  width: number,
  height: number,
  pad = 0,
): [number, number, number, number] {
  const base = Math.max(0, radius ?? 0);
  const raw: [number, number, number, number] = cornerRadii
    ? [
        Math.max(0, cornerRadii.topLeft),
        Math.max(0, cornerRadii.topRight),
        Math.max(0, cornerRadii.bottomRight),
        Math.max(0, cornerRadii.bottomLeft),
      ]
    : [base, base, base, base];
  const adjusted = raw.map((r) => (r > 0 ? Math.max(0, r + pad) : 0)) as [number, number, number, number];
  const effW = Math.max(0.01, width + pad * 2);
  const effH = Math.max(0.01, height + pad * 2);
  const scale = Math.min(
    1,
    adjusted[0] + adjusted[1] > 0 ? effW / (adjusted[0] + adjusted[1]) : 1,
    adjusted[3] + adjusted[2] > 0 ? effW / (adjusted[3] + adjusted[2]) : 1,
    adjusted[0] + adjusted[3] > 0 ? effH / (adjusted[0] + adjusted[3]) : 1,
    adjusted[1] + adjusted[2] > 0 ? effH / (adjusted[1] + adjusted[2]) : 1,
  );
  return [adjusted[0] * scale, adjusted[1] * scale, adjusted[2] * scale, adjusted[3] * scale];
}

/**
 * Exact point-in-rounded-rectangle check in local coordinates [0..width, 0..height].
 * Supports both uniform `radius` and per-corner `cornerRadii`.
 */
export function isPointInRoundedRect(
  lx: number,
  ly: number,
  width: number,
  height: number,
  radius: number,
  pad = 0,
  cornerRadii?: CornerRadiiConfig,
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
  const [tl, tr, br, bl] = resolveNodeCornerRadii(radius, cornerRadii, width, height, pad);
  if (tl <= 0.001 && tr <= 0.001 && br <= 0.001 && bl <= 0.001) return true;

  const px = lx - minX;
  const py = ly - minY;

  if (tl > 0.001 && px < tl && py < tl) {
    const dx = px - tl;
    const dy = py - tl;
    return dx * dx + dy * dy <= tl * tl;
  }
  if (tr > 0.001 && px > effW - tr && py < tr) {
    const dx = px - (effW - tr);
    const dy = py - tr;
    return dx * dx + dy * dy <= tr * tr;
  }
  if (br > 0.001 && px > effW - br && py > effH - br) {
    const dx = px - (effW - br);
    const dy = py - (effH - br);
    return dx * dx + dy * dy <= br * br;
  }
  if (bl > 0.001 && px < bl && py > effH - bl) {
    const dx = px - bl;
    const dy = py - (effH - bl);
    return dx * dx + dy * dy <= bl * bl;
  }
  return true;
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
  rawAnchors: readonly VectorAnchorPoint[],
  closed: boolean,
  stepsPerCurve = 14,
): PolylineContour {
  const anchors = applyCornerRoundingToAnchors(rawAnchors, closed);
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

function minDistanceToContours(
  contours: readonly PolylineContour[],
  px: number,
  py: number,
): number {
  let minSq = Infinity;
  for (const contour of contours) {
    const pts = contour.points;
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      const dx = px - pts[0].x;
      const dy = py - pts[0].y;
      const sq = dx * dx + dy * dy;
      if (sq < minSq) minSq = sq;
      continue;
    }
    const segCount = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const sq = distanceToSegmentSq(px, py, a.x, a.y, b.x, b.y);
      if (sq < minSq) minSq = sq;
    }
  }
  return Number.isFinite(minSq) ? Math.sqrt(minSq) : Infinity;
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

function computeContoursVisualArea(contours: readonly PolylineContour[], fallbackArea: number): number {
  let total = 0;
  for (const contour of contours) {
    if (!contour.closed || contour.points.length < 3) continue;
    const pts = contour.points;
    let sum = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      sum += a.x * b.y - b.x * a.y;
    }
    total += Math.abs(sum) * 0.5;
  }
  return total > 1 ? total : fallbackArea;
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

interface DetailedHitResult {
  readonly hitKind: 'stroke' | 'fill';
  readonly visualArea: number;
  readonly strokeDistance: number;
}

function evaluateDetailedNodeHit(
  node: DesignNode,
  worldPoint: CanvasPoint2D,
  strokeTolerance: number,
): DetailedHitResult | null {
  if (node.type === 'group') return null;

  const local = toNodeLocalPoint(node, worldPoint);
  const tol = Math.max(1, strokeTolerance);

  switch (node.type) {
    case 'ellipse': {
      const visibleStroke = hasVisibleStroke(node);
      const sw = visibleStroke ? node.style.strokeWidth : 0;
      const outPad = getStrokeOutwardPad(sw, node.style.strokeAlign);
      const inPad = node.style.strokeAlign === 'outside' ? 0 : node.style.strokeAlign === 'inside' ? sw : sw * 0.5;
      const filled = hasVisibleFill(node);
      const visualArea = Math.max(1, Math.PI * (node.width * 0.5) * (node.height * 0.5));

      const onStroke = (() => {
        if (!visibleStroke && filled) return false;
        const hitOuter = isPointInEllipse(local.x, local.y, node.width, node.height, outPad + tol);
        if (!hitOuter) return false;
        const inset = inPad + tol;
        const innerW = Math.max(0, node.width - inset * 2);
        const innerH = Math.max(0, node.height - inset * 2);
        if (innerW <= 1 || innerH <= 1) return true;
        return !isPointInEllipse(local.x - inset, local.y - inset, innerW, innerH, 0);
      })();

      if (visibleStroke && onStroke) {
        return { hitKind: 'stroke', visualArea, strokeDistance: 0 };
      }
      if (filled || sw === 0) {
        if (isPointInEllipse(local.x, local.y, node.width, node.height, outPad + 1)) {
          return { hitKind: 'fill', visualArea, strokeDistance: Infinity };
        }
        return null;
      }
      return onStroke ? { hitKind: 'stroke', visualArea, strokeDistance: 0 } : null;
    }

    case 'rect':
    case 'frame': {
      const visibleStroke = hasVisibleStroke(node);
      const sw = visibleStroke ? node.style.strokeWidth : 0;
      const outPad = getStrokeOutwardPad(sw, node.style.strokeAlign);
      const inPad = node.style.strokeAlign === 'outside' ? 0 : node.style.strokeAlign === 'inside' ? sw : sw * 0.5;
      const radius = node.style.radius ?? 0;
      const cornerRadii = node.style.cornerRadii;
      const filled = hasVisibleFill(node);
      const visualArea = Math.max(1, node.width * node.height);

      const onBorderRing = (() => {
        const hitOuter = isPointInRoundedRect(local.x, local.y, node.width, node.height, radius, outPad + tol, cornerRadii);
        if (!hitOuter) return false;
        const inset = inPad + tol;
        if (node.width - inset * 2 <= 1 || node.height - inset * 2 <= 1) return true;
        const innerRadii: CornerRadiiConfig | undefined = cornerRadii
          ? {
              topLeft: Math.max(0, cornerRadii.topLeft - inset),
              topRight: Math.max(0, cornerRadii.topRight - inset),
              bottomRight: Math.max(0, cornerRadii.bottomRight - inset),
              bottomLeft: Math.max(0, cornerRadii.bottomLeft - inset),
            }
          : undefined;
        return !isPointInRoundedRect(
          local.x - inset,
          local.y - inset,
          node.width - inset * 2,
          node.height - inset * 2,
          Math.max(0, radius - inset),
          0,
          innerRadii,
        );
      })();

      if (visibleStroke && onBorderRing) {
        return { hitKind: 'stroke', visualArea, strokeDistance: 0 };
      }
      if (filled) {
        if (isPointInRoundedRect(local.x, local.y, node.width, node.height, radius, outPad + 1, cornerRadii)) {
          return { hitKind: 'fill', visualArea, strokeDistance: Infinity };
        }
        return null;
      }
      // Transparent fill passes through the interior and only hits the border/outline
      return onBorderRing ? { hitKind: 'stroke', visualArea, strokeDistance: 0 } : null;
    }

    case 'image': {
      const sw = hasVisibleStroke(node) ? (node.style.strokeWidth ?? 0) : 0;
      if (
        isPointInRoundedRect(
          local.x,
          local.y,
          node.width,
          node.height,
          node.style.radius ?? 0,
          sw * 0.5 + 1,
          node.style.cornerRadii,
        )
      ) {
        return { hitKind: 'fill', visualArea: Math.max(1, node.width * node.height), strokeDistance: Infinity };
      }
      return null;
    }

    case 'path': {
      const contours = getPathContours(node);
      const visibleStroke = hasVisibleStroke(node);
      const sw = node.style.strokeWidth ?? 0;
      const strokeHitDist = node.closed
        ? (visibleStroke ? Math.max(tol, sw * 0.5 + tol) : tol)
        : Math.max(6, sw * 0.5 + tol);
      const dist = minDistanceToContours(contours, local.x, local.y);
      const visualArea = computeContoursVisualArea(contours, Math.max(1, node.width * node.height * 0.5));

      if ((visibleStroke || !node.closed) && dist <= strokeHitDist) {
        return { hitKind: 'stroke', visualArea, strokeDistance: dist };
      }
      const filled = node.closed && hasVisibleFill(node);
      if (filled && isPointInClosedContours(contours, local.x, local.y, node.style.fillRule ?? 'nonzero')) {
        return { hitKind: 'fill', visualArea, strokeDistance: dist };
      }
      if (!filled && dist <= strokeHitDist) {
        return { hitKind: 'stroke', visualArea, strokeDistance: dist };
      }
      return null;
    }

    case 'text':
    case 'component-instance': {
      if (local.x >= -2 && local.x <= node.width + 2 && local.y >= -2 && local.y <= node.height + 2) {
        return { hitKind: 'fill', visualArea: Math.max(1, node.width * node.height), strokeDistance: Infinity };
      }
      return null;
    }
  }
}

/**
 * Shape-aware geometric hit test for a single DesignNode.
 * Respects rotation, ellipse equations, rounded corner arcs, polygon/star/Bezier paths,
 * per-vertex corner rounding, and stroke widths/alignments.
 */
export function hitTestNodeAtPoint(
  node: DesignNode,
  worldPoint: CanvasPoint2D,
  strokeTolerance = 4,
): boolean {
  return evaluateDetailedNodeHit(node, worldPoint, strokeTolerance) !== null;
}

export interface HitTestOptions {
  readonly strokeTolerance?: number;
  readonly candidateIds?: ReadonlySet<string> | null;
}

/**
 * Ibis Paint-style visual hit-testing on canvas (ignoring z-index):
 * - Clicking directly on a visible line/stroke picks that stroke cleanly even if
 *   another filled shape overlaps it in z-order.
 * - Clicking inside overlapping visible color regions picks the smallest/tightest
 *   visible shape contour at that pixel (so smaller details remain directly pickable
 *   regardless of z-index; exact layer-order picking is handled by the Layer Tab).
 * - Transparent fills pass through so objects underneath can be clicked directly.
 */
export function hitTestNodesAtPoint(
  orderedRenderNodes: readonly DesignNode[],
  worldPoint: CanvasPoint2D,
  layerStates: ReadonlyMap<string, EffectiveLayerState>,
  options: HitTestOptions = {},
): string | null {
  const strokeTolerance = options.strokeTolerance ?? 4;
  const candidateIds = options.candidateIds ?? null;

  interface RankedHit {
    readonly id: string;
    readonly paintIndex: number;
    readonly detail: DetailedHitResult;
  }

  const hits: RankedHit[] = [];

  for (let i = 0; i < orderedRenderNodes.length; i += 1) {
    const node = orderedRenderNodes[i];
    if (node.type === 'group') continue;
    if (candidateIds && !candidateIds.has(node.id)) continue;
    const state = layerStates.get(node.id);
    if (!state?.visible || state.locked) continue;
    const detail = evaluateDetailedNodeHit(node, worldPoint, strokeTolerance);
    if (detail) {
      hits.push({ id: node.id, paintIndex: i, detail });
    }
  }

  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0].id;

  // Prefer direct visible stroke/line hits over broad interior fill hits
  const strokeHits = hits.filter((h) => h.detail.hitKind === 'stroke');
  if (strokeHits.length > 0) {
    strokeHits.sort((a, b) => {
      const distDiff = a.detail.strokeDistance - b.detail.strokeDistance;
      if (Math.abs(distDiff) > 1.5) return distDiff;
      const areaDiff = a.detail.visualArea - b.detail.visualArea;
      if (Math.abs(areaDiff) > 4) return areaDiff;
      return b.paintIndex - a.paintIndex;
    });
    return strokeHits[0].id;
  }

  // Among visible colored fills, ignore z-index and pick the tightest visible shape contour
  // (using paint order only as a tie-breaker when two shapes have nearly identical area)
  hits.sort((a, b) => {
    const ratio = Math.max(a.detail.visualArea, b.detail.visualArea) / Math.max(1, Math.min(a.detail.visualArea, b.detail.visualArea));
    if (ratio > 1.05) {
      return a.detail.visualArea - b.detail.visualArea;
    }
    return b.paintIndex - a.paintIndex;
  });
  return hits[0].id;
}


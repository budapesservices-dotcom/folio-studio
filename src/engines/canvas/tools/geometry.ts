import type { Bounds } from '../geometry';
export type CanvasPoint = { x: number; y: number };

export function pointInPolygon(point: CanvasPoint, polygon: readonly CanvasPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0))
    && ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0));
}
export function polygonIntersectsBounds(polygon: readonly CanvasPoint[], bounds: Bounds): boolean {
  if (polygon.length < 3) return false;
  const corners: CanvasPoint[] = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((p) => p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height)) return true;
  const rectEdges = corners.map((corner, i) => [corner, corners[(i + 1) % corners.length]] as const);
  const polygonEdges = polygon.map((point, i) => [point, polygon[(i + 1) % polygon.length]] as const);
  return polygonEdges.some(([a, b]) => rectEdges.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}
export function rectangleBounds(start: CanvasPoint, end: CanvasPoint): Bounds {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/**
 * Computes exact canvas units per CSS pixel so hit tolerances, snap thresholds,
 * and handle sizes stay visually and physically consistent from extreme zoom-out
 * (e.g. 15%) to extreme zoom-in (e.g. 800%+).
 */
export function getCanvasUnitsPerPixel(context: {
  zoom: number;
  canvasUnitsPerPixel?: number;
  document?: { width: number };
  viewportWidth?: number;
}): number {
  if (typeof context.canvasUnitsPerPixel === 'number' && Number.isFinite(context.canvasUnitsPerPixel) && context.canvasUnitsPerPixel > 0) {
    return context.canvasUnitsPerPixel;
  }
  const safeZoom = Math.max(0.05, Number.isFinite(context.zoom) ? context.zoom : 1);
  if (context.document && context.viewportWidth && context.viewportWidth > 0) {
    return (context.document.width / context.viewportWidth) / safeZoom;
  }
  return 1 / safeZoom;
}

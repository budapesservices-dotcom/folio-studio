/**
 * Pure, framework-independent 2D Planar Arrangement & Concave-Safe Boolean Engine.
 *
 * Powers BOTH:
 * 1. Concave-safe Illustrator Pathfinder (`unite`, `subtract`, `intersect`, `exclude`)
 *    including stars, L-shapes, rotated shapes, and compound paths with zero internal seams.
 * 2. Interactive Shape Builder (`Shift+M`): decomposes overlapping shapes into atomic
 *    clickable/draggable planar faces for live drag-to-merge and Alt+drag-to-punch.
 */

import { findOverlappingSegmentPairsWasm } from '../kernels/wasmGeometryKernel';

export interface PlanarPoint {
  x: number;
  y: number;
}

export interface PlanarShapeInput {
  /** Outer contour and optional hole/compound contours in world coordinates. */
  contours: PlanarPoint[][];
}

export interface PlanarFace {
  id: number;
  /** Boundary vertices in counter-clockwise winding order (positive signed area in Y-down/standard math). */
  polygon: PlanarPoint[];
  /** Unsigned geometric area in px^2. */
  area: number;
  /** Guaranteed interior point for hit-testing, classification, and label placement. */
  interiorPoint: PlanarPoint;
  /** Indices of input shapes that contain this atomic face (sorted ascending). */
  memberShapeIndices: number[];
}

export interface PlanarArrangement {
  vertices: PlanarPoint[];
  faces: PlanarFace[];
}

export interface AssembledContour {
  points: PlanarPoint[];
  isHole: boolean;
}

const SNAP_GRID = 0.05;
const EPS = 1e-7;
const MIN_FACE_AREA = 1.5;

export function signedArea(poly: readonly PlanarPoint[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function pointInSimplePolygon(pt: PlanarPoint, poly: readonly PlanarPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInContours(pt: PlanarPoint, contours: readonly PlanarPoint[][]): boolean {
  let count = 0;
  for (const contour of contours) {
    if (contour.length >= 3 && pointInSimplePolygon(pt, contour)) {
      count += 1;
    }
  }
  return count % 2 === 1;
}

function pointOnSegmentDistSq(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return (p.x - px) ** 2 + (p.y - py) ** 2;
}

function pointInTriangle(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint, c: PlanarPoint): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

/**
 * Finds a point strictly inside any simple polygon (including deeply concave C-shapes
 * and thin crescents) by trying the centroid first, then locating a valid ear triangle.
 */
export function findInteriorPoint(poly: readonly PlanarPoint[]): PlanarPoint {
  if (poly.length === 0) return { x: 0, y: 0 };
  if (poly.length < 3) return poly[0];

  // Try polygon centroid first
  let cx = 0;
  let cy = 0;
  for (const pt of poly) {
    cx += pt.x;
    cy += pt.y;
  }
  const centroid = { x: cx / poly.length, y: cy / poly.length };
  if (pointInSimplePolygon(centroid, poly)) {
    let minEdgeDistSq = Infinity;
    for (let i = 0; i < poly.length; i += 1) {
      const d = pointOnSegmentDistSq(centroid, poly[i], poly[(i + 1) % poly.length]);
      if (d < minEdgeDistSq) minEdgeDistSq = d;
    }
    if (minEdgeDistSq > 0.04) return centroid;
  }

  // Ensure positive orientation for ear test
  const oriented = signedArea(poly) >= 0 ? poly : [...poly].reverse();
  const n = oriented.length;
  for (let i = 0; i < n; i += 1) {
    const prev = oriented[(i - 1 + n) % n];
    const curr = oriented[i];
    const next = oriented[(i + 1) % n];
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if (cross <= EPS) continue;

    let containsOther = false;
    for (let k = 0; k < n; k += 1) {
      if (k === i || k === (i - 1 + n) % n || k === (i + 1) % n) continue;
      if (pointInTriangle(oriented[k], prev, curr, next)) {
        containsOther = true;
        break;
      }
    }
    if (!containsOther) {
      const candidate = {
        x: (prev.x + curr.x + next.x) / 3,
        y: (prev.y + curr.y + next.y) / 3,
      };
      if (pointInSimplePolygon(candidate, poly)) return candidate;
    }
  }

  // Fallback: scanline midpoint across the polygon's vertical middle
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of poly) {
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const midY = (minY + maxY) / 2;
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y <= midY && b.y > midY) || (b.y <= midY && a.y > midY)) {
      const t = (midY - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
  }
  xs.sort((a, b) => a - b);
  if (xs.length >= 2) {
    return { x: (xs[0] + xs[1]) / 2, y: midY };
  }
  return centroid;
}

interface RawSegment {
  a: PlanarPoint;
  b: PlanarPoint;
}

function collectSegments(shapes: readonly PlanarShapeInput[]): RawSegment[] {
  const segments: RawSegment[] = [];
  for (const shape of shapes) {
    for (const contour of shape.contours) {
      if (contour.length < 3) continue;
      for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05) {
          segments.push({ a, b });
        }
      }
    }
  }
  return segments;
}

function addSplitParam(params: number[], t: number): void {
  if (t <= 1e-5 || t >= 1 - 1e-5) return;
  for (const existing of params) {
    if (Math.abs(existing - t) < 1e-4) return;
  }
  params.push(t);
}

function projectParam(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return -1;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
}

function findSegmentIntersections(
  s1: RawSegment,
  s2: RawSegment,
  splits1: number[],
  splits2: number[],
): void {
  const rX = s1.b.x - s1.a.x;
  const rY = s1.b.y - s1.a.y;
  const sX = s2.b.x - s2.a.x;
  const sY = s2.b.y - s2.a.y;
  const denom = rX * sY - rY * sX;

  const qpx = s2.a.x - s1.a.x;
  const qpy = s2.a.y - s1.a.y;

  if (Math.abs(denom) > 1e-8) {
    const t = (qpx * sY - qpy * sX) / denom;
    const u = (qpx * rY - qpy * rX) / denom;
    if (t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
      addSplitParam(splits1, t);
      addSplitParam(splits2, u);
    }
    return;
  }

  // Collinear / overlapping check
  const cross = Math.abs(qpx * rY - qpy * rX);
  const scale = Math.hypot(rX, rY) + 1e-8;
  if (cross / scale > 0.05) return;

  const tA = projectParam(s2.a, s1.a, s1.b);
  const tB = projectParam(s2.b, s1.a, s1.b);
  addSplitParam(splits1, tA);
  addSplitParam(splits1, tB);

  const uA = projectParam(s1.a, s2.a, s2.b);
  const uB = projectParam(s1.b, s2.a, s2.b);
  addSplitParam(splits2, uA);
  addSplitParam(splits2, uB);
}

/**
 * Builds the exact 2D planar face arrangement for any collection of overlapping
 * convex or concave shapes.
 */
export function buildPlanarArrangement(shapes: readonly PlanarShapeInput[]): PlanarArrangement {
  const rawSegments = collectSegments(shapes);
  if (rawSegments.length === 0) return { vertices: [], faces: [] };

  const splitParams: number[][] = rawSegments.map(() => []);

  // Precompute segment AABBs sorted ascending by minX for O(N log N + k) sweep-line broad-phase
  const segCount = rawSegments.length;
  const order = new Int32Array(segCount);
  const rawMinX = new Float64Array(segCount);
  const rawMinY = new Float64Array(segCount);
  const rawMaxX = new Float64Array(segCount);
  const rawMaxY = new Float64Array(segCount);
  for (let i = 0; i < segCount; i += 1) {
    const seg = rawSegments[i];
    order[i] = i;
    rawMinX[i] = (seg.a.x < seg.b.x ? seg.a.x : seg.b.x) - 0.1;
    rawMaxX[i] = (seg.a.x > seg.b.x ? seg.a.x : seg.b.x) + 0.1;
    rawMinY[i] = (seg.a.y < seg.b.y ? seg.a.y : seg.b.y) - 0.1;
    rawMaxY[i] = (seg.a.y > seg.b.y ? seg.a.y : seg.b.y) + 0.1;
  }
  order.sort((a, b) => rawMinX[a] - rawMinX[b]);

  const sortedAabbs = new Float64Array(segCount * 4);
  for (let s = 0; s < segCount; s += 1) {
    const idx = order[s];
    const base = s * 4;
    sortedAabbs[base] = rawMinX[idx];
    sortedAabbs[base + 1] = rawMinY[idx];
    sortedAabbs[base + 2] = rawMaxX[idx];
    sortedAabbs[base + 3] = rawMaxY[idx];
  }

  const wasmPairs = segCount >= 24 ? findOverlappingSegmentPairsWasm(sortedAabbs, segCount) : null;
  if (wasmPairs) {
    const { pairCount, pairsView } = wasmPairs;
    for (let p = 0; p < pairCount; p += 1) {
      const idxA = order[pairsView[p * 2]];
      const idxB = order[pairsView[p * 2 + 1]];
      findSegmentIntersections(rawSegments[idxA], rawSegments[idxB], splitParams[idxA], splitParams[idxB]);
    }
  } else {
    for (let i = 0; i < segCount; i += 1) {
      const baseI = i * 4;
      const maxXI = sortedAabbs[baseI + 2];
      const minYI = sortedAabbs[baseI + 1];
      const maxYI = sortedAabbs[baseI + 3];
      const idxA = order[i];
      for (let j = i + 1; j < segCount; j += 1) {
        const baseJ = j * 4;
        if (sortedAabbs[baseJ] > maxXI) break;
        if (sortedAabbs[baseJ + 3] < minYI || sortedAabbs[baseJ + 1] > maxYI) continue;
        const idxB = order[j];
        findSegmentIntersections(rawSegments[idxA], rawSegments[idxB], splitParams[idxA], splitParams[idxB]);
      }
    }
  }

  // Vertex deduplication via zero-allocation packed-integer spatial hashing
  const vertices: PlanarPoint[] = [];
  const vertexBuckets = new Map<number, number[]>();
  const SNAP_TOL_SQ = (SNAP_GRID * 1.5) * (SNAP_GRID * 1.5);
  const CELL_BIAS = 16777216; // 2^24 -> safe exact 53-bit integer key up to +-838,860 px
  const CELL_STRIDE = 33554432; // 2^25
  const packCell = (gx: number, gy: number): number => (gx + CELL_BIAS) * CELL_STRIDE + (gy + CELL_BIAS);

  const getVertexId = (pt: PlanarPoint): number => {
    const gx = Math.round(pt.x / SNAP_GRID);
    const gy = Math.round(pt.y / SNAP_GRID);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = vertexBuckets.get(packCell(gx + dx, gy + dy));
        if (!bucket) continue;
        for (const id of bucket) {
          const existing = vertices[id];
          const ex = existing.x - pt.x;
          const ey = existing.y - pt.y;
          if (ex * ex + ey * ey <= SNAP_TOL_SQ) {
            return id;
          }
        }
      }
    }
    const id = vertices.length;
    vertices.push({
      x: Math.round(pt.x * 1000) / 1000,
      y: Math.round(pt.y * 1000) / 1000,
    });
    const key = packCell(gx, gy);
    const list = vertexBuckets.get(key);
    if (list) list.push(id);
    else vertexBuckets.set(key, [id]);
    return id;
  };

  // Deduplicate undirected sub-segments
  const uniqueEdges = new Map<string, [number, number]>();
  for (let i = 0; i < rawSegments.length; i += 1) {
    const seg = rawSegments[i];
    const params = [0, ...splitParams[i].sort((a, b) => a - b), 1];
    for (let k = 0; k < params.length - 1; k += 1) {
      const t0 = params[k];
      const t1 = params[k + 1];
      if (t1 - t0 < 1e-5) continue;
      const p0 = { x: seg.a.x + (seg.b.x - seg.a.x) * t0, y: seg.a.y + (seg.b.y - seg.a.y) * t0 };
      const p1 = { x: seg.a.x + (seg.b.x - seg.a.x) * t1, y: seg.a.y + (seg.b.y - seg.a.y) * t1 };
      const u = getVertexId(p0);
      const v = getVertexId(p1);
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!uniqueEdges.has(key)) {
        uniqueEdges.set(key, [u, v]);
      }
    }
  }

  // Build directed half-edges
  interface HalfEdge {
    id: number;
    from: number;
    to: number;
    twin: number;
    angle: number;
  }

  const halfEdges: HalfEdge[] = [];
  const outgoing: number[][] = vertices.map(() => []);

  for (const [u, v] of uniqueEdges.values()) {
    const a = vertices[u];
    const b = vertices[v];
    const id1 = halfEdges.length;
    const id2 = id1 + 1;
    halfEdges.push({
      id: id1,
      from: u,
      to: v,
      twin: id2,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
    halfEdges.push({
      id: id2,
      from: v,
      to: u,
      twin: id1,
      angle: Math.atan2(a.y - b.y, a.x - b.x),
    });
    outgoing[u].push(id1);
    outgoing[v].push(id2);
  }

  // Sort outgoing half-edges at each vertex by ascending angle (CCW in standard math, CW in Y-down)
  for (const edges of outgoing) {
    edges.sort((e1, e2) => halfEdges[e1].angle - halfEdges[e2].angle);
  }

  // Map (from, halfEdgeId) -> index in outgoing[from]
  const nextHalfEdge = new Int32Array(halfEdges.length).fill(-1);
  for (const he of halfEdges) {
    const list = outgoing[he.to];
    if (list.length === 0) continue;
    const twinIdx = list.indexOf(he.twin);
    if (twinIdx === -1) continue;
    // Choose the next outgoing edge clockwise from twin (index - 1 mod len) to trace minimal interior faces
    const nextIdx = (twinIdx - 1 + list.length) % list.length;
    nextHalfEdge[he.id] = list[nextIdx];
  }

  const visited = new Uint8Array(halfEdges.length);
  const faces: PlanarFace[] = [];

  for (let startId = 0; startId < halfEdges.length; startId += 1) {
    if (visited[startId]) continue;
    const cycleVertexIds: number[] = [];
    let current = startId;
    let guard = 0;
    const maxSteps = halfEdges.length + 2;

    while (current !== -1 && !visited[current] && guard < maxSteps) {
      visited[current] = 1;
      cycleVertexIds.push(halfEdges[current].from);
      current = nextHalfEdge[current];
      guard += 1;
    }

    if (current !== startId || cycleVertexIds.length < 3) continue;

    const polygon = cycleVertexIds.map((vid) => vertices[vid]);
    const area = signedArea(polygon);
    // In our choice of (twinIdx - 1), minimal bounded interior faces have positive signedArea!
    if (area <= MIN_FACE_AREA) continue;

    const interiorPoint = findInteriorPoint(polygon);
    const memberShapeIndices: number[] = [];
    for (let s = 0; s < shapes.length; s += 1) {
      if (pointInContours(interiorPoint, shapes[s].contours)) {
        memberShapeIndices.push(s);
      }
    }

    // Only keep faces that actually belong to at least one input shape
    if (memberShapeIndices.length === 0) continue;

    faces.push({
      id: faces.length,
      polygon,
      area,
      interiorPoint,
      memberShapeIndices,
    });
  }

  return { vertices, faces };
}

function simplifyCollinearLoop(points: readonly PlanarPoint[]): PlanarPoint[] {
  if (points.length <= 3) return [...points];
  const out: PlanarPoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < 0.05) continue;
    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const cross = Math.abs(ax * by - ay * bx);
    const denom = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denom > EPS && cross / denom < 0.002 && ax * bx + ay * by > 0) {
      continue;
    }
    out.push(curr);
  }
  return out.length >= 3 ? out : [...points];
}

/**
 * Merges any subset of planar faces by canceling shared internal opposite half-edges
 * and tracing crisp outer shells and inner holes with zero internal seam lines!
 */
export function assembleFacesToContours(faces: readonly PlanarFace[]): AssembledContour[] {
  if (faces.length === 0) return [];

  const snapKey = (pt: PlanarPoint): string =>
    `${Math.round(pt.x / SNAP_GRID)},${Math.round(pt.y / SNAP_GRID)}`;

  const vertexMap = new Map<string, number>();
  const vertices: PlanarPoint[] = [];

  const intern = (pt: PlanarPoint): number => {
    const key = snapKey(pt);
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push({ x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100 });
    vertexMap.set(key, id);
    return id;
  };

  // Cancel opposing directed edges (u->v cancels v->u)
  const directedEdges = new Set<string>();
  for (const face of faces) {
    const poly = signedArea(face.polygon) >= 0 ? face.polygon : [...face.polygon].reverse();
    for (let i = 0; i < poly.length; i += 1) {
      const u = intern(poly[i]);
      const v = intern(poly[(i + 1) % poly.length]);
      if (u === v) continue;
      const rev = `${v}->${u}`;
      if (directedEdges.has(rev)) {
        directedEdges.delete(rev);
      } else {
        directedEdges.add(`${u}->${v}`);
      }
    }
  }

  if (directedEdges.size === 0) return [];

  // Build adjacency for remaining boundary edges
  const adjacency = new Map<number, number[]>();
  for (const key of directedEdges) {
    const [uStr, vStr] = key.split('->');
    const u = Number(uStr);
    const v = Number(vStr);
    const list = adjacency.get(u);
    if (list) list.push(v);
    else adjacency.set(u, [v]);
  }

  const usedEdges = new Set<string>();
  const contours: AssembledContour[] = [];

  for (const edgeKey of directedEdges) {
    if (usedEdges.has(edgeKey)) continue;
    const [startU, startV] = edgeKey.split('->').map(Number);
    const loopIds: number[] = [startU];
    usedEdges.add(edgeKey);

    let prev = startU;
    let curr = startV;
    let guard = 0;
    const maxSteps = directedEdges.size + 4;

    while (curr !== startU && guard < maxSteps) {
      loopIds.push(curr);
      const candidates = (adjacency.get(curr) ?? []).filter(
        (next) => !usedEdges.has(`${curr}->${next}`),
      );
      if (candidates.length === 0) break;

      let chosen = candidates[0];
      if (candidates.length > 1) {
        // Resolve pinch vertex by choosing the sharpest right turn to keep loops non-self-crossing
        const inAngle = Math.atan2(vertices[prev].y - vertices[curr].y, vertices[prev].x - vertices[curr].x);
        let bestTurn = Infinity;
        for (const cand of candidates) {
          const outAngle = Math.atan2(vertices[cand].y - vertices[curr].y, vertices[cand].x - vertices[curr].x);
          let turn = inAngle - outAngle;
          while (turn <= 0) turn += Math.PI * 2;
          if (turn < bestTurn) {
            bestTurn = turn;
            chosen = cand;
          }
        }
      }

      usedEdges.add(`${curr}->${chosen}`);
      prev = curr;
      curr = chosen;
      guard += 1;
    }

    if (curr === startU && loopIds.length >= 3) {
      const rawPoints = loopIds.map((id) => vertices[id]);
      const cleaned = simplifyCollinearLoop(rawPoints);
      const area = signedArea(cleaned);
      if (Math.abs(area) >= MIN_FACE_AREA) {
        contours.push({
          points: cleaned,
          isHole: area < 0,
        });
      }
    }
  }

  // Sort outer contours first (largest area first), then holes
  contours.sort((a, b) => {
    if (a.isHole !== b.isHole) return a.isHole ? 1 : -1;
    return Math.abs(signedArea(b.points)) - Math.abs(signedArea(a.points));
  });

  return contours;
}

/**
 * Finds the planar face containing a given world point (used for interactive
 * Shape Builder hover and drag-stroke hit testing).
 */
export function hitTestPlanarFace(arrangement: PlanarArrangement, point: PlanarPoint): PlanarFace | null {
  for (const face of arrangement.faces) {
    if (pointInSimplePolygon(point, face.polygon)) {
      return face;
    }
  }
  return null;
}

/**
 * Returns all planar faces intersected by a drag polyline (used by Shape Builder
 * so fast drags across thin regions never skip a face!).
 */
export function hitTestPlanarFacesAlongStroke(
  arrangement: PlanarArrangement,
  strokePoints: readonly PlanarPoint[],
): number[] {
  const hitIds = new Set<number>();
  if (strokePoints.length === 0) return [];

  for (let i = 0; i < strokePoints.length; i += 1) {
    const p0 = strokePoints[i];
    const hit0 = hitTestPlanarFace(arrangement, p0);
    if (hit0) hitIds.add(hit0.id);

    if (i > 0) {
      const prev = strokePoints[i - 1];
      const dist = Math.hypot(p0.x - prev.x, p0.y - prev.y);
      const steps = Math.max(1, Math.min(24, Math.ceil(dist / 6)));
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const sample = {
          x: prev.x + (p0.x - prev.x) * t,
          y: prev.y + (p0.y - prev.y) * t,
        };
        const hit = hitTestPlanarFace(arrangement, sample);
        if (hit) hitIds.add(hit.id);
      }
    }
  }

  return [...hitIds];
}

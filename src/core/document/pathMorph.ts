/**
 * Pure vertex & cubic Bezier curve morphing engine (Alight Motion-style shape animation).
 *
 * Serializes PathNode anchor points, Bezier handles (`handleIn` / `handleOut`),
 * and per-vertex `cornerRadius` into compact deterministic JSON snapshots for
 * `pathMorph` animation keyframes, and smoothly interpolates between any two
 * vector states (including automatic point-count alignment and straight-to-curve
 * handle synthesis).
 */

import type { PathNode, VectorAnchorPoint, VectorSubpath } from './types';

export interface PathMorphPoint {
  x: number;
  y: number;
  hi?: [number, number];
  ho?: [number, number];
  pt: 'c' | 's' | 'y';
  cr?: number;
}

export interface PathMorphSubpath {
  points: PathMorphPoint[];
  closed: boolean;
}

export interface PathMorphSnapshot {
  v: 1;
  closed: boolean;
  points: PathMorphPoint[];
  subpaths?: PathMorphSubpath[];
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function encodePointType(pt: VectorAnchorPoint['pointType']): 'c' | 's' | 'y' {
  if (pt === 'smooth') return 's';
  if (pt === 'symmetric') return 'y';
  return 'c';
}

function decodePointType(pt: 'c' | 's' | 'y'): VectorAnchorPoint['pointType'] {
  if (pt === 's') return 'smooth';
  if (pt === 'y') return 'symmetric';
  return 'corner';
}

function encodeAnchors(anchors: readonly VectorAnchorPoint[]): PathMorphPoint[] {
  return anchors.map((pt) => {
    const out: PathMorphPoint = {
      x: round2(pt.x),
      y: round2(pt.y),
      pt: encodePointType(pt.pointType),
    };
    if (pt.handleIn) {
      out.hi = [round2(pt.handleIn.x), round2(pt.handleIn.y)];
    }
    if (pt.handleOut) {
      out.ho = [round2(pt.handleOut.x), round2(pt.handleOut.y)];
    }
    if (typeof pt.cornerRadius === 'number' && Number.isFinite(pt.cornerRadius) && pt.cornerRadius > 0) {
      out.cr = round2(pt.cornerRadius);
    }
    return out;
  });
}

function decodeAnchors(
  points: readonly PathMorphPoint[],
  templateAnchors?: readonly VectorAnchorPoint[],
  idPrefix = 'morph',
): VectorAnchorPoint[] {
  return points.map((pt, index) => {
    const template = templateAnchors?.[index];
    const out: VectorAnchorPoint = {
      id: template?.id ?? `${idPrefix}-${index}`,
      x: round2(pt.x),
      y: round2(pt.y),
      pointType: decodePointType(pt.pt),
    };
    if (pt.hi) {
      out.handleIn = { x: round2(pt.hi[0]), y: round2(pt.hi[1]) };
    }
    if (pt.ho) {
      out.handleOut = { x: round2(pt.ho[0]), y: round2(pt.ho[1]) };
    }
    if (typeof pt.cr === 'number' && Number.isFinite(pt.cr) && pt.cr > 0.01) {
      out.cornerRadius = round2(pt.cr);
    }
    return out;
  });
}

export function serializePathMorphSnapshot(node: Pick<PathNode, 'points' | 'closed' | 'subpaths'>): string {
  const snapshot: PathMorphSnapshot = {
    v: 1,
    closed: Boolean(node.closed),
    points: encodeAnchors(node.points),
    ...(node.subpaths && node.subpaths.length > 0
      ? {
          subpaths: node.subpaths.map((sp) => ({
            closed: Boolean(sp.closed),
            points: encodeAnchors(sp.points),
          })),
        }
      : {}),
  };
  return JSON.stringify(snapshot);
}

function isValidMorphPoint(raw: unknown): raw is PathMorphPoint {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  if (typeof p.x !== 'number' || !Number.isFinite(p.x)) return false;
  if (typeof p.y !== 'number' || !Number.isFinite(p.y)) return false;
  if (p.pt !== 'c' && p.pt !== 's' && p.pt !== 'y') return false;
  if (p.hi !== undefined) {
    if (!Array.isArray(p.hi) || p.hi.length !== 2 || !Number.isFinite(p.hi[0]) || !Number.isFinite(p.hi[1])) {
      return false;
    }
  }
  if (p.ho !== undefined) {
    if (!Array.isArray(p.ho) || p.ho.length !== 2 || !Number.isFinite(p.ho[0]) || !Number.isFinite(p.ho[1])) {
      return false;
    }
  }
  if (p.cr !== undefined && (typeof p.cr !== 'number' || !Number.isFinite(p.cr) || p.cr < 0)) {
    return false;
  }
  return true;
}

export function parsePathMorphSnapshot(raw: string): PathMorphSnapshot | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 120_000) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1 || typeof obj.closed !== 'boolean') return null;
    if (!Array.isArray(obj.points) || obj.points.length === 0 || obj.points.length > 2048) return null;
    if (!obj.points.every(isValidMorphPoint)) return null;
    if (obj.subpaths !== undefined) {
      if (!Array.isArray(obj.subpaths) || obj.subpaths.length > 64) return null;
      for (const sp of obj.subpaths) {
        if (!sp || typeof sp !== 'object') return null;
        const spObj = sp as Record<string, unknown>;
        if (typeof spObj.closed !== 'boolean' || !Array.isArray(spObj.points) || spObj.points.length === 0) {
          return null;
        }
        if (!spObj.points.every(isValidMorphPoint)) return null;
      }
    }
    return obj as unknown as PathMorphSnapshot;
  } catch {
    return null;
  }
}

export function isValidPathMorphSnapshot(raw: unknown): raw is string {
  return typeof raw === 'string' && parsePathMorphSnapshot(raw) !== null;
}

/**
 * Splits a cubic Bezier segment `(p0, c1, c2, p3)` at `t = 0.5` using exact
 * de Casteljau subdivision so resampling preserves curve geometry faithfully.
 */
function subdivideMorphSegmentAtHalf(
  a: PathMorphPoint,
  b: PathMorphPoint,
): { aOut: [number, number] | undefined; mid: PathMorphPoint; bIn: [number, number] | undefined } {
  const hasCurve = Boolean(a.ho || b.hi);
  if (!hasCurve) {
    return {
      aOut: undefined,
      mid: {
        x: round2((a.x + b.x) * 0.5),
        y: round2((a.y + b.y) * 0.5),
        pt: 'c',
      },
      bIn: undefined,
    };
  }
  const p0x = a.x;
  const p0y = a.y;
  const p1x = a.ho ? a.ho[0] : a.x + (b.x - a.x) / 3;
  const p1y = a.ho ? a.ho[1] : a.y + (b.y - a.y) / 3;
  const p2x = b.hi ? b.hi[0] : a.x + ((b.x - a.x) * 2) / 3;
  const p2y = b.hi ? b.hi[1] : a.y + ((b.y - a.y) * 2) / 3;
  const p3x = b.x;
  const p3y = b.y;

  const q0x = (p0x + p1x) * 0.5;
  const q0y = (p0y + p1y) * 0.5;
  const q1x = (p1x + p2x) * 0.5;
  const q1y = (p1y + p2y) * 0.5;
  const q2x = (p2x + p3x) * 0.5;
  const q2y = (p2y + p3y) * 0.5;

  const r0x = (q0x + q1x) * 0.5;
  const r0y = (q0y + q1y) * 0.5;
  const r1x = (q1x + q2x) * 0.5;
  const r1y = (q1y + q2y) * 0.5;

  const sx = (r0x + r1x) * 0.5;
  const sy = (r0y + r1y) * 0.5;

  return {
    aOut: [round2(q0x), round2(q0y)],
    mid: {
      x: round2(sx),
      y: round2(sy),
      hi: [round2(r0x), round2(r0y)],
      ho: [round2(r1x), round2(r1y)],
      pt: 's',
    },
    bIn: [round2(q2x), round2(q2y)],
  };
}

function resampleMorphPoints(
  points: readonly PathMorphPoint[],
  closed: boolean,
  targetCount: number,
): PathMorphPoint[] {
  const result = points.map((p) => ({
    ...p,
    ...(p.hi ? { hi: [p.hi[0], p.hi[1]] as [number, number] } : {}),
    ...(p.ho ? { ho: [p.ho[0], p.ho[1]] as [number, number] } : {}),
  }));
  if (result.length === 0 || result.length >= targetCount) return result;
  if (result.length === 1) {
    while (result.length < targetCount) result.push({ ...result[0] });
    return result;
  }

  let guard = 0;
  while (result.length < targetCount && guard < 1024) {
    guard += 1;
    const segCount = closed ? result.length : result.length - 1;
    let longestIdx = 0;
    let longestLen = -1;
    for (let i = 0; i < segCount; i += 1) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > longestLen) {
        longestLen = len;
        longestIdx = i;
      }
    }
    const nextIdx = (longestIdx + 1) % result.length;
    const sub = subdivideMorphSegmentAtHalf(result[longestIdx], result[nextIdx]);
    if (sub.aOut) result[longestIdx] = { ...result[longestIdx], ho: sub.aOut };
    if (sub.bIn) result[nextIdx] = { ...result[nextIdx], hi: sub.bIn };
    result.splice(longestIdx + 1, 0, sub.mid);
  }
  return result;
}

function interpolateMorphPointLists(
  fromRaw: readonly PathMorphPoint[],
  toRaw: readonly PathMorphPoint[],
  closed: boolean,
  t: number,
): PathMorphPoint[] {
  const targetCount = Math.max(fromRaw.length, toRaw.length);
  const fromPts = fromRaw.length < targetCount ? resampleMorphPoints(fromRaw, closed, targetCount) : fromRaw;
  const toPts = toRaw.length < targetCount ? resampleMorphPoints(toRaw, closed, targetCount) : toRaw;
  const count = Math.min(fromPts.length, toPts.length);
  const lerp = (a: number, b: number) => round2(a + (b - a) * t);

  const out: PathMorphPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = fromPts[i];
    const b = toPts[i];
    const prevA = fromPts[(i - 1 + count) % count];
    const nextA = fromPts[(i + 1) % count];
    const prevB = toPts[(i - 1 + count) % count];
    const nextB = toPts[(i + 1) % count];

    const point: PathMorphPoint = {
      x: lerp(a.x, b.x),
      y: lerp(a.y, b.y),
      pt: t < 0.5 ? a.pt : b.pt,
    };

    if (a.hi || b.hi) {
      const ahi: [number, number] = a.hi ?? [
        a.x + (prevA.x - a.x) / 3,
        a.y + (prevA.y - a.y) / 3,
      ];
      const bhi: [number, number] = b.hi ?? [
        b.x + (prevB.x - b.x) / 3,
        b.y + (prevB.y - b.y) / 3,
      ];
      point.hi = [lerp(ahi[0], bhi[0]), lerp(ahi[1], bhi[1])];
    }

    if (a.ho || b.ho) {
      const aho: [number, number] = a.ho ?? [
        a.x + (nextA.x - a.x) / 3,
        a.y + (nextA.y - a.y) / 3,
      ];
      const bho: [number, number] = b.ho ?? [
        b.x + (nextB.x - b.x) / 3,
        b.y + (nextB.y - b.y) / 3,
      ];
      point.ho = [lerp(aho[0], bho[0]), lerp(aho[1], bho[1])];
    }

    const acr = a.cr ?? 0;
    const bcr = b.cr ?? 0;
    if (acr > 0 || bcr > 0) {
      const cr = Math.max(0, lerp(acr, bcr));
      if (cr > 0.01) point.cr = cr;
    }

    out.push(point);
  }
  return out;
}

/**
 * Smoothly interpolates two serialized `PathMorphSnapshot` JSON strings at eased progress `t`.
 */
export function interpolatePathMorph(fromStr: string, toStr: string, t: number): string {
  if (t <= 0) return fromStr;
  if (t >= 1) return toStr;
  const from = parsePathMorphSnapshot(fromStr);
  const to = parsePathMorphSnapshot(toStr);
  if (!from || !to) return t < 0.5 ? fromStr : toStr;

  const closed = t < 0.5 ? from.closed : to.closed;
  const points = interpolateMorphPointLists(from.points, to.points, closed, t);

  let subpaths: PathMorphSubpath[] | undefined;
  const subCount = Math.max(from.subpaths?.length ?? 0, to.subpaths?.length ?? 0);
  if (subCount > 0) {
    subpaths = [];
    for (let i = 0; i < subCount; i += 1) {
      const sa = from.subpaths?.[i];
      const sb = to.subpaths?.[i];
      if (sa && sb) {
        const subClosed = t < 0.5 ? sa.closed : sb.closed;
        subpaths.push({
          closed: subClosed,
          points: interpolateMorphPointLists(sa.points, sb.points, subClosed, t),
        });
      } else if (sa) {
        subpaths.push(sa);
      } else if (sb) {
        subpaths.push(sb);
      }
    }
  }

  const blended: PathMorphSnapshot = {
    v: 1,
    closed,
    points,
    ...(subpaths && subpaths.length > 0 ? { subpaths } : {}),
  };
  return JSON.stringify(blended);
}

/**
 * Applies an evaluated `pathMorph` snapshot string onto a `PathNode` cleanly
 * without mutating the canonical node.
 */
export function applyPathMorphSnapshotToNode(node: PathNode, snapshotJson: string): PathNode {
  const snapshot = parsePathMorphSnapshot(snapshotJson);
  if (!snapshot) return node;

  const nextPoints = decodeAnchors(snapshot.points, node.points, `${node.id}-pt`);
  let nextSubpaths: VectorSubpath[] | undefined;
  if (snapshot.subpaths && snapshot.subpaths.length > 0) {
    nextSubpaths = snapshot.subpaths.map((sp, spIdx) => ({
      closed: sp.closed,
      points: decodeAnchors(sp.points, node.subpaths?.[spIdx]?.points, `${node.id}-sp${spIdx}`),
    }));
  }

  return {
    ...node,
    points: nextPoints,
    closed: snapshot.closed,
    ...(nextSubpaths ? { subpaths: nextSubpaths } : {}),
  };
}

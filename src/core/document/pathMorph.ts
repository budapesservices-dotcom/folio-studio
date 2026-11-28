/**
 * FOLIO Native Shape Morph Geometry Engine.
 *
 * Allows a single canonical vector object (`EllipseNode`, `RectNode`, `FrameNode`,
 * or single-contour / multi-contour closed `PathNode` including shapes with holes)
 * to transform smoothly across arbitrary geometry keyframes while preserving one
 * stable `nodeId`.
 *
 * Pipeline (Phases 1, 2 & 3):
 *   1. Topology & capability validation (`checkNodeMorphSupport`, `checkMorphPairCompatibility`)
 *   2. Canonical cubic Bezier extraction from primitive shapes, presets & compound paths
 *   3. Multi-contour spatial matching + centroid-collapse synthesis when contour counts differ
 *   4. Winding-direction normalization per contour pair
 *   5. Arc-length-aware exact de Casteljau cubic Bezier subdivision (point-budget guarded)
 *   6. Optimal cyclic start-anchor alignment (minimizes rotational twist) + user overrides
 *   7. Cached `PreparedMorphPair` with flat `Float64Array` buffers so playback hot-path
 *      performs pure numeric lerp with zero JSON parsing or subdivision per frame.
 *
 * Explicitly classified as unsupported (fail loudly & cleanly):
 *   - Open paths (non-closed primary or hole contours)
 *   - Non-vector/non-shape nodes (`text`, `image`, `group`, `component-instance`)
 *   - Degenerate contours (`< 3` vertices, collapsed zero perimeter, non-finite coordinates)
 *   - Excessive contour/point budgets (`> MAX_MORPH_CONTOURS` contours or `> MAX_MORPH_POINTS` per contour)
 */

import type {
  CornerRadiiConfig,
  DesignNode,
  EllipseNode,
  FrameNode,
  PathNode,
  RectNode,
  VectorAnchorPoint,
  VectorSubpath,
} from './types';

export const MAX_MORPH_POINTS = 256;
export const MAX_MORPH_CONTOURS = 32;
export const MAX_PREPARED_MORPH_CACHE = 128;

const KAPPA = 0.5522847498307936;
const MIN_CONTOUR_PERIMETER = 0.5;

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

export type MorphMatchMode = 'auto' | 'index';

export interface PathMorphMatchOptions {
  /** 'auto' aligns winding + cyclic start anchor; 'index' preserves exact vertex index order. */
  matchMode?: MorphMatchMode;
  /** Manual cyclic start-anchor offset applied to this target keyframe. */
  startOffset?: number;
  /** Manual contour direction reversal applied to this target keyframe. */
  reverse?: boolean;
}

export interface PathMorphSnapshot {
  v: 1;
  closed: boolean;
  points: PathMorphPoint[];
  subpaths?: PathMorphSubpath[];
  /** Human-readable shape/state label (e.g. 'Circle', 'Rounded Square', 'Triangle'). */
  label?: string;
  /** Reference local bounding width when captured. */
  w?: number;
  /** Reference local bounding height when captured. */
  h?: number;
  /** Optional correspondence controls for Phase 2 manual twist/direction fixes. */
  morph?: PathMorphMatchOptions;
}

export type MorphTopologyReason =
  | 'supported'
  | 'unsupported-node-type'
  | 'open-path'
  | 'multi-contour'
  | 'too-few-points'
  | 'degenerate-geometry'
  | 'non-finite-values'
  | 'exceeds-point-budget';

export interface MorphSupportResult {
  supported: boolean;
  reason: MorphTopologyReason;
  message: string;
}

export type MorphShapePresetId =
  | 'circle'
  | 'rounded-rect'
  | 'square'
  | 'triangle'
  | 'arrow'
  | 'pentagon'
  | 'hexagon'
  | 'star';

export interface MorphShapePresetDescriptor {
  id: MorphShapePresetId;
  label: string;
  shortLabel: string;
}

export const MORPH_SHAPE_PRESETS: readonly MorphShapePresetDescriptor[] = [
  { id: 'circle', label: 'Circle', shortLabel: 'Circle' },
  { id: 'rounded-rect', label: 'Rounded Square', shortLabel: 'Rounded' },
  { id: 'square', label: 'Square', shortLabel: 'Square' },
  { id: 'triangle', label: 'Triangle', shortLabel: 'Triangle' },
  { id: 'arrow', label: 'Arrow', shortLabel: 'Arrow' },
  { id: 'pentagon', label: 'Pentagon', shortLabel: 'Pentagon' },
  { id: 'hexagon', label: 'Hexagon', shortLabel: 'Hexagon' },
  { id: 'star', label: '5-Point Star', shortLabel: 'Star' },
];

export interface MorphCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
}

/**
 * Pre-normalized contour pair stored as flat `Float64Array` buffers for
 * zero-allocation, zero-JSON-parse per-frame playback evaluation.
 *
 * Buffer layout per anchor `i` (stride = 7):
 *   [i*7 + 0] = x
 *   [i*7 + 1] = y
 *   [i*7 + 2] = handleIn.x
 *   [i*7 + 3] = handleIn.y
 *   [i*7 + 4] = handleOut.x
 *   [i*7 + 5] = handleOut.y
 *   [i*7 + 6] = cornerRadius
 */
export interface PreparedMorphContourPair {
  pointCount: number;
  closed: boolean;
  cyclicShift: number;
  reversed: boolean;
  flags: Uint8Array;
  fromTypes: ReadonlyArray<'c' | 's' | 'y'>;
  toTypes: ReadonlyArray<'c' | 's' | 'y'>;
  fromBuf: Float64Array;
  toBuf: Float64Array;
  fromPoints: readonly PathMorphPoint[];
  toPoints: readonly PathMorphPoint[];
}

export interface EvaluatedMorphGeometry {
  points: VectorAnchorPoint[];
  closed: boolean;
  subpaths?: VectorSubpath[];
}

export type MorphTopologyTransition =
  | 'closed-to-closed'
  | 'open-to-open'
  | 'open-to-closed'
  | 'closed-to-open';

export interface PreparedMorphPair {
  compatible: boolean;
  reason: MorphTopologyReason;
  message: string;
  /** Deterministic topology transition mode applied to this morph pair. */
  topologyTransition?: MorphTopologyTransition;
  pointCount: number;
  closed: boolean;
  /** Optimal cyclic shift applied to `to` contour during preparation. */
  cyclicShift: number;
  /** Whether `to` contour direction was reversed during preparation. */
  reversed: boolean;
  /** Bitmask flags per point: bit 0 = hasHi, bit 1 = hasHo, bit 2 = hasCr. */
  flags: Uint8Array;
  fromTypes: ReadonlyArray<'c' | 's' | 'y'>;
  toTypes: ReadonlyArray<'c' | 's' | 'y'>;
  fromBuf: Float64Array;
  toBuf: Float64Array;
  /** Matched subpath / hole contour pairs (Phase 3 multi-contour morph). */
  subpathPairs?: readonly PreparedMorphContourPair[];
  fromSnapshot: PathMorphSnapshot;
  toSnapshot: PathMorphSnapshot;
}

const STRIDE = 7;
const FLAG_HI = 1;
const FLAG_HO = 2;
const FLAG_CR = 4;

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

/**
 * Checks whether a single closed contour's points are finite and non-degenerate.
 */
function validateContourPoints(
  points: readonly PathMorphPoint[],
  closed: boolean,
): MorphSupportResult {
  const minPoints = closed ? 3 : 2;
  if (points.length < minPoints) {
    return {
      supported: false,
      reason: 'too-few-points',
      message: closed
        ? 'Shape Morph requires a closed contour with at least 3 anchor points.'
        : 'Shape Morph requires an open path with at least 2 anchor points.',
    };
  }
  if (points.length > MAX_MORPH_POINTS) {
    return {
      supported: false,
      reason: 'exceeds-point-budget',
      message: `Shape Morph supports up to ${MAX_MORPH_POINTS} anchor points per contour (found ${points.length}).`,
    };
  }
  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return {
        supported: false,
        reason: 'non-finite-values',
        message: 'Contour contains non-finite coordinates.',
      };
    }
    if (pt.hi && (!Number.isFinite(pt.hi[0]) || !Number.isFinite(pt.hi[1]))) {
      return {
        supported: false,
        reason: 'non-finite-values',
        message: 'Contour contains non-finite Bezier handle coordinates.',
      };
    }
    if (pt.ho && (!Number.isFinite(pt.ho[0]) || !Number.isFinite(pt.ho[1]))) {
      return {
        supported: false,
        reason: 'non-finite-values',
        message: 'Contour contains non-finite Bezier handle coordinates.',
      };
    }
  }
  const perimeter = computeContourPerimeter(points, closed);
  if (!Number.isFinite(perimeter) || perimeter < MIN_CONTOUR_PERIMETER) {
    return {
      supported: false,
      reason: 'degenerate-geometry',
      message: 'Contour geometry is collapsed (zero perimeter) and cannot be morphed.',
    };
  }
  return {
    supported: true,
    reason: 'supported',
    message: closed ? 'Supported single closed contour.' : 'Supported open Bezier path.',
  };
}

/**
 * Classifies whether a FOLIO `DesignNode` supports Native Shape Morph.
 */
export function checkNodeMorphSupport(node: DesignNode | null | undefined): MorphSupportResult {
  if (!node) {
    return {
      supported: false,
      reason: 'unsupported-node-type',
      message: 'Select a closed vector shape (Circle, Rectangle, Frame, or closed Path) to enable Shape Morph.',
    };
  }
  if (!Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0) {
    return {
      supported: false,
      reason: 'degenerate-geometry',
      message: 'Shape must have positive width and height to enable Shape Morph.',
    };
  }

  if (node.type === 'ellipse' || node.type === 'rect' || node.type === 'frame') {
    return {
      supported: true,
      reason: 'supported',
      message: `Supported (${node.type}). Morphing evaluates smoothly while preserving node ID "${node.id}".`,
    };
  }

  if (node.type === 'path') {
    const primaryCheck = validateContourPoints(encodeAnchors(node.points), Boolean(node.closed));
    if (!primaryCheck.supported) return primaryCheck;
    if (node.subpaths && node.subpaths.length > 0) {
      if (node.subpaths.length + 1 > MAX_MORPH_CONTOURS) {
        return {
          supported: false,
          reason: 'exceeds-point-budget',
          message: `Shape Morph supports up to ${MAX_MORPH_CONTOURS} contours per path (found ${node.subpaths.length + 1}).`,
        };
      }
      for (const sp of node.subpaths) {
        const spCheck = validateContourPoints(encodeAnchors(sp.points), Boolean(sp.closed));
        if (!spCheck.supported) return spCheck;
      }
      return {
        supported: true,
        reason: 'supported',
        message: `Supported multi-contour closed path (${node.subpaths.length + 1} contours).`,
      };
    }
    return primaryCheck;
  }

  return {
    supported: false,
    reason: 'unsupported-node-type',
    message: `Shape Morph is not supported for ${node.type} layers. Select a Circle, Rectangle, Frame, or closed Path.`,
  };
}

/**
 * Classifies whether two `PathMorphSnapshot` keyframes can be cleanly morphed
 * (supports both single closed contours and multi-contour compound paths/holes).
 */
export function checkMorphPairCompatibility(
  from: PathMorphSnapshot | null,
  to: PathMorphSnapshot | null,
): MorphSupportResult {
  if (!from || !to) {
    return {
      supported: false,
      reason: 'degenerate-geometry',
      message: 'One or both morph keyframes contain invalid geometry data.',
    };
  }
  const fromCheck = validateContourPoints(from.points, from.closed);
  if (!fromCheck.supported) return fromCheck;
  const toCheck = validateContourPoints(to.points, to.closed);
  if (!toCheck.supported) return toCheck;

  const fromSubpaths = from.subpaths ?? [];
  const toSubpaths = to.subpaths ?? [];
  if (fromSubpaths.length + 1 > MAX_MORPH_CONTOURS || toSubpaths.length + 1 > MAX_MORPH_CONTOURS) {
    return {
      supported: false,
      reason: 'exceeds-point-budget',
      message: `Shape Morph supports up to ${MAX_MORPH_CONTOURS} contours per shape.`,
    };
  }
  for (const sp of fromSubpaths) {
    const spCheck = validateContourPoints(sp.points, sp.closed);
    if (!spCheck.supported) return spCheck;
  }
  for (const sp of toSubpaths) {
    const spCheck = validateContourPoints(sp.points, sp.closed);
    if (!spCheck.supported) return spCheck;
  }

  const isMulti = fromSubpaths.length > 0 || toSubpaths.length > 0;
  const openClosedBridge = from.closed !== to.closed;
  return {
    supported: true,
    reason: 'supported',
    message: openClosedBridge
      ? 'Compatible open/closed morph pair (bridged closure transition).'
      : !from.closed && !to.closed
        ? isMulti
          ? 'Compatible multi-contour open path morph pair.'
          : 'Compatible open path morph pair.'
        : isMulti
          ? 'Compatible multi-contour closed morph pair.'
          : 'Compatible single closed contour morph pair.',
  };
}

/**
 * Generates canonical clockwise cubic Bezier points for an ellipse in local `[0..w, 0..h]`.
 */
function buildCircleMorphPoints(w: number, h: number): PathMorphPoint[] {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    {
      x: round2(rx),
      y: 0,
      hi: [round2(rx - kx), 0],
      ho: [round2(rx + kx), 0],
      pt: 'y',
    },
    {
      x: round2(w),
      y: round2(ry),
      hi: [round2(w), round2(ry - ky)],
      ho: [round2(w), round2(ry + ky)],
      pt: 'y',
    },
    {
      x: round2(rx),
      y: round2(h),
      hi: [round2(rx + kx), round2(h)],
      ho: [round2(rx - kx), round2(h)],
      pt: 'y',
    },
    {
      x: 0,
      y: round2(ry),
      hi: [0, round2(ry + ky)],
      ho: [0, round2(ry - ky)],
      pt: 'y',
    },
  ];
}

/**
 * Generates canonical clockwise cubic Bezier points for a sharp or rounded rectangle
 * (supporting both uniform `radius` and per-corner `cornerRadii`) in local `[0..w, 0..h]`.
 */
function buildRectMorphPoints(
  w: number,
  h: number,
  uniformRadius = 0,
  cornerRadii?: CornerRadiiConfig,
): PathMorphPoint[] {
  const maxR = Math.min(w, h) / 2;
  const clampR = (val: number) => Math.max(0, Math.min(maxR, Number.isFinite(val) ? val : 0));
  const tl = clampR(cornerRadii ? cornerRadii.topLeft : uniformRadius);
  const tr = clampR(cornerRadii ? cornerRadii.topRight : uniformRadius);
  const br = clampR(cornerRadii ? cornerRadii.bottomRight : uniformRadius);
  const bl = clampR(cornerRadii ? cornerRadii.bottomLeft : uniformRadius);

  if (tl < 0.5 && tr < 0.5 && br < 0.5 && bl < 0.5) {
    return [
      { x: 0, y: 0, pt: 'c' },
      { x: round2(w), y: 0, pt: 'c' },
      { x: round2(w), y: round2(h), pt: 'c' },
      { x: 0, y: round2(h), pt: 'c' },
    ];
  }

  // Emit symmetric clockwise rounded-rect contour starting at Top-Center (0 deg)
  // with cardinal edge midpoints so Circle <-> Rounded Square has 0-deg phase offset.
  const pts: PathMorphPoint[] = [];
  const ktl = tl * KAPPA;
  const ktr = tr * KAPPA;
  const kbr = br * KAPPA;
  const kbl = bl * KAPPA;
  const pushIfDistinct = (pt: PathMorphPoint) => {
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.05 && !pt.hi && !pt.ho) {
      return;
    }
    pts.push(pt);
  };

  // Top edge midpoint (0 deg)
  if (w - tl - tr > 1) {
    pushIfDistinct({ x: round2((tl + (w - tr)) * 0.5), y: 0, pt: 'c' });
  }
  // Top-right corner
  pushIfDistinct({
    x: round2(w - tr),
    y: 0,
    ...(tr >= 0.5 ? { ho: [round2(w - tr + ktr), 0] as [number, number] } : {}),
    pt: 'c',
  });
  pushIfDistinct({
    x: round2(w),
    y: round2(tr),
    ...(tr >= 0.5 ? { hi: [round2(w), round2(tr - ktr)] as [number, number] } : {}),
    pt: 'c',
  });
  // Right edge midpoint (90 deg)
  if (h - tr - br > 1) {
    pushIfDistinct({ x: round2(w), y: round2((tr + (h - br)) * 0.5), pt: 'c' });
  }
  // Bottom-right corner
  pushIfDistinct({
    x: round2(w),
    y: round2(h - br),
    ...(br >= 0.5 ? { ho: [round2(w), round2(h - br + kbr)] as [number, number] } : {}),
    pt: 'c',
  });
  pushIfDistinct({
    x: round2(w - br),
    y: round2(h),
    ...(br >= 0.5 ? { hi: [round2(w - br + kbr), round2(h)] as [number, number] } : {}),
    pt: 'c',
  });
  // Bottom edge midpoint (180 deg)
  if (w - bl - br > 1) {
    pushIfDistinct({ x: round2((bl + (w - br)) * 0.5), y: round2(h), pt: 'c' });
  }
  // Bottom-left corner
  pushIfDistinct({
    x: round2(bl),
    y: round2(h),
    ...(bl >= 0.5 ? { ho: [round2(bl - kbl), round2(h)] as [number, number] } : {}),
    pt: 'c',
  });
  pushIfDistinct({
    x: 0,
    y: round2(h - bl),
    ...(bl >= 0.5 ? { hi: [0, round2(h - bl + kbl)] as [number, number] } : {}),
    pt: 'c',
  });
  // Left edge midpoint (270 deg)
  if (h - tl - bl > 1) {
    pushIfDistinct({ x: 0, y: round2((tl + (h - bl)) * 0.5), pt: 'c' });
  }
  // Top-left corner
  pushIfDistinct({
    x: 0,
    y: round2(tl),
    ...(tl >= 0.5 ? { ho: [0, round2(tl - ktl)] as [number, number] } : {}),
    pt: 'c',
  });
  pushIfDistinct({
    x: round2(tl),
    y: 0,
    ...(tl >= 0.5 ? { hi: [round2(tl - ktl), 0] as [number, number] } : {}),
    pt: 'c',
  });

  // Deduplicate zero-length coincident corners if a single corner had radius 0 while others were > 0
  return pts.filter((pt, idx) => {
    const prev = pts[(idx - 1 + pts.length) % pts.length];
    return Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.05 || Boolean(pt.hi || pt.ho);
  });
}

function buildPolygonMorphPoints(w: number, h: number, sides: number): PathMorphPoint[] {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const out: PathMorphPoint[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    out.push({
      x: round2(cx + Math.cos(angle) * rx),
      y: round2(cy + Math.sin(angle) * ry),
      pt: 'c',
    });
  }
  return out;
}

function buildTriangleMorphPoints(w: number, h: number): PathMorphPoint[] {
  return [
    { x: round2(w * 0.5), y: 0, pt: 'c' },
    { x: round2(w), y: round2(h), pt: 'c' },
    { x: 0, y: round2(h), pt: 'c' },
  ];
}

function buildArrowMorphPoints(w: number, h: number): PathMorphPoint[] {
  // Clean right-pointing block arrow, clockwise from top-left shaft corner
  return [
    { x: 0, y: round2(h * 0.3), pt: 'c' },
    { x: round2(w * 0.54), y: round2(h * 0.3), pt: 'c' },
    { x: round2(w * 0.54), y: round2(h * 0.08), pt: 'c' },
    { x: round2(w), y: round2(h * 0.5), pt: 'c' },
    { x: round2(w * 0.54), y: round2(h * 0.92), pt: 'c' },
    { x: round2(w * 0.54), y: round2(h * 0.7), pt: 'c' },
    { x: 0, y: round2(h * 0.7), pt: 'c' },
  ];
}

function buildStarMorphPoints(w: number, h: number, spikes = 5, innerRatio = 0.44): PathMorphPoint[] {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const total = spikes * 2;
  const out: PathMorphPoint[] = [];
  for (let i = 0; i < total; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / total;
    const scale = i % 2 === 0 ? 1 : innerRatio;
    out.push({
      x: round2(cx + Math.cos(angle) * rx * scale),
      y: round2(cy + Math.sin(angle) * ry * scale),
      pt: 'c',
    });
  }
  return out;
}

/**
 * Generates a canonical serialized `PathMorphSnapshot` for a built-in shape preset
 * sized to `[0..width, 0..height]`.
 */
export function createMorphPresetSnapshot(
  preset: MorphShapePresetId,
  width: number,
  height: number,
  options?: PathMorphMatchOptions,
): string {
  const w = Math.max(2, Number.isFinite(width) ? width : 100);
  const h = Math.max(2, Number.isFinite(height) ? height : 100);
  let points: PathMorphPoint[];
  let label: string;

  switch (preset) {
    case 'circle':
      points = buildCircleMorphPoints(w, h);
      label = 'Circle';
      break;
    case 'rounded-rect':
      points = buildRectMorphPoints(w, h, Math.min(w, h) * 0.24);
      label = 'Rounded Square';
      break;
    case 'square':
      points = buildRectMorphPoints(w, h, 0);
      label = 'Square';
      break;
    case 'triangle':
      points = buildTriangleMorphPoints(w, h);
      label = 'Triangle';
      break;
    case 'arrow':
      points = buildArrowMorphPoints(w, h);
      label = 'Arrow';
      break;
    case 'pentagon':
      points = buildPolygonMorphPoints(w, h, 5);
      label = 'Pentagon';
      break;
    case 'hexagon':
      points = buildPolygonMorphPoints(w, h, 6);
      label = 'Hexagon';
      break;
    case 'star':
      points = buildStarMorphPoints(w, h, 5, 0.44);
      label = 'Star';
      break;
  }

  const snapshot: PathMorphSnapshot = {
    v: 1,
    closed: true,
    points,
    label,
    w: round2(w),
    h: round2(h),
    ...(options && (options.matchMode || options.startOffset || options.reverse)
      ? { morph: options }
      : {}),
  };
  return JSON.stringify(snapshot);
}

/**
 * Extracts a canonical serialized `PathMorphSnapshot` from ANY supported FOLIO shape node
 * (`EllipseNode`, `RectNode`, `FrameNode`, or closed `PathNode`) without mutating the node.
 * Returns `null` if the node does not support Shape Morph.
 */
export function extractMorphSnapshotFromNode(node: DesignNode): string | null {
  const support = checkNodeMorphSupport(node);
  if (!support.supported) return null;

  const w = Math.max(1, node.width);
  const h = Math.max(1, node.height);

  if (node.type === 'ellipse') {
    const snapshot: PathMorphSnapshot = {
      v: 1,
      closed: true,
      points: buildCircleMorphPoints(w, h),
      label: 'Circle',
      w: round2(w),
      h: round2(h),
    };
    return JSON.stringify(snapshot);
  }

  if (node.type === 'rect' || node.type === 'frame') {
    const r = node.style.radius ?? 0;
    const hasRounding =
      r >= 0.5 ||
      Boolean(
        node.style.cornerRadii &&
          (node.style.cornerRadii.topLeft >= 0.5 ||
            node.style.cornerRadii.topRight >= 0.5 ||
            node.style.cornerRadii.bottomRight >= 0.5 ||
            node.style.cornerRadii.bottomLeft >= 0.5),
      );
    const snapshot: PathMorphSnapshot = {
      v: 1,
      closed: true,
      points: buildRectMorphPoints(w, h, r, node.style.cornerRadii),
      label: hasRounding ? 'Rounded Rect' : 'Rectangle',
      w: round2(w),
      h: round2(h),
    };
    return JSON.stringify(snapshot);
  }

  if (node.type === 'path') {
    const encodedSubpaths: PathMorphSubpath[] | undefined =
      node.subpaths && node.subpaths.length > 0
        ? node.subpaths.map((sp) => ({
            closed: Boolean(sp.closed),
            points: encodeAnchors(sp.points),
          }))
        : undefined;
    const snapshot: PathMorphSnapshot = {
      v: 1,
      closed: Boolean(node.closed),
      points: encodeAnchors(node.points),
      ...(encodedSubpaths ? { subpaths: encodedSubpaths } : {}),
      label: encodedSubpaths
        ? 'Compound Path'
        : node.points.length === 3
          ? 'Triangle'
          : 'Path',
      w: round2(w),
      h: round2(h),
    };
    return JSON.stringify(snapshot);
  }

  return null;
}

/**
 * Backward-compatible path snapshot serializer for `PathNode`.
 */
export function serializePathMorphSnapshot(
  node: Pick<PathNode, 'points' | 'closed' | 'subpaths'> & { width?: number; height?: number },
  options?: { label?: string; morph?: PathMorphMatchOptions },
): string {
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
    ...(options?.label ? { label: options.label } : {}),
    ...(typeof node.width === 'number' && Number.isFinite(node.width) && node.width > 0
      ? { w: round2(node.width) }
      : {}),
    ...(typeof node.height === 'number' && Number.isFinite(node.height) && node.height > 0
      ? { h: round2(node.height) }
      : {}),
    ...(options?.morph ? { morph: options.morph } : {}),
  };
  return JSON.stringify(snapshot);
}

/**
 * Updates Phase 2 correspondence options (`matchMode`, `startOffset`, `reverse`) or `label`
 * on an existing serialized `PathMorphSnapshot` string.
 */
export function updateMorphSnapshotOptions(
  snapshotJson: string,
  patch: Partial<PathMorphMatchOptions> & { label?: string },
): string | null {
  const parsed = parsePathMorphSnapshot(snapshotJson);
  if (!parsed) return null;
  const nextMorph: PathMorphMatchOptions = {
    ...(parsed.morph ?? {}),
    ...(patch.matchMode !== undefined ? { matchMode: patch.matchMode } : {}),
    ...(patch.startOffset !== undefined ? { startOffset: Math.trunc(patch.startOffset) } : {}),
    ...(patch.reverse !== undefined ? { reverse: Boolean(patch.reverse) } : {}),
  };
  if (nextMorph.matchMode === 'auto') delete nextMorph.matchMode;
  if (!nextMorph.startOffset) delete nextMorph.startOffset;
  if (!nextMorph.reverse) delete nextMorph.reverse;

  const hasMorph = Object.keys(nextMorph).length > 0;
  const next: PathMorphSnapshot = {
    v: 1,
    closed: parsed.closed,
    points: parsed.points,
    ...(parsed.subpaths && parsed.subpaths.length > 0 ? { subpaths: parsed.subpaths } : {}),
    ...(patch.label !== undefined
      ? patch.label
        ? { label: patch.label }
        : {}
      : parsed.label
        ? { label: parsed.label }
        : {}),
    ...(parsed.w !== undefined ? { w: parsed.w } : {}),
    ...(parsed.h !== undefined ? { h: parsed.h } : {}),
    ...(hasMorph ? { morph: nextMorph } : {}),
  };
  return JSON.stringify(next);
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
    if (obj.label !== undefined && (typeof obj.label !== 'string' || obj.label.length > 64)) {
      return null;
    }
    if (obj.w !== undefined && (typeof obj.w !== 'number' || !Number.isFinite(obj.w) || obj.w <= 0)) {
      return null;
    }
    if (obj.h !== undefined && (typeof obj.h !== 'number' || !Number.isFinite(obj.h) || obj.h <= 0)) {
      return null;
    }
    if (obj.morph !== undefined) {
      if (!obj.morph || typeof obj.morph !== 'object') return null;
      const m = obj.morph as Record<string, unknown>;
      if (m.matchMode !== undefined && m.matchMode !== 'auto' && m.matchMode !== 'index') {
        return null;
      }
      if (
        m.startOffset !== undefined &&
        (typeof m.startOffset !== 'number' || !Number.isFinite(m.startOffset) || Math.abs(m.startOffset) > 2048)
      ) {
        return null;
      }
      if (m.reverse !== undefined && typeof m.reverse !== 'boolean') {
        return null;
      }
    }
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
 * Computes signed area of a closed contour by sampling its cubic Bezier curves
 * (8 samples per segment). In screen coordinates (Y down):
 *   > 0 => clockwise (CW)
 *   < 0 => counter-clockwise (CCW)
 */
export function computeContourSignedArea(points: readonly PathMorphPoint[]): number {
  const n = points.length;
  if (n < 3) return 0;
  const samplesPerSeg = 6;
  const polyX: number[] = [];
  const polyY: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const hasCurve = Boolean(a.ho || b.hi);
    if (!hasCurve) {
      polyX.push(a.x);
      polyY.push(a.y);
      continue;
    }
    const p1x = a.ho ? a.ho[0] : a.x + (b.x - a.x) / 3;
    const p1y = a.ho ? a.ho[1] : a.y + (b.y - a.y) / 3;
    const p2x = b.hi ? b.hi[0] : a.x + ((b.x - a.x) * 2) / 3;
    const p2y = b.hi ? b.hi[1] : a.y + ((b.y - a.y) * 2) / 3;
    for (let s = 0; s < samplesPerSeg; s += 1) {
      const t = s / samplesPerSeg;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const t2 = t * t;
      const x = mt2 * mt * a.x + 3 * mt2 * t * p1x + 3 * mt * t2 * p2x + t2 * t * b.x;
      const y = mt2 * mt * a.y + 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t2 * t * b.y;
      polyX.push(x);
      polyY.push(y);
    }
  }

  let area2 = 0;
  const total = polyX.length;
  for (let i = 0; i < total; i += 1) {
    const j = (i + 1) % total;
    area2 += polyX[i] * polyY[j] - polyX[j] * polyY[i];
  }
  return area2 * 0.5;
}

/**
 * Approximates cubic Bezier segment arc length via 8-step polyline quadrature.
 */
function cubicSegmentArcLength(a: PathMorphPoint, b: PathMorphPoint): number {
  const hasCurve = Boolean(a.ho || b.hi);
  if (!hasCurve) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const p1x = a.ho ? a.ho[0] : a.x + (b.x - a.x) / 3;
  const p1y = a.ho ? a.ho[1] : a.y + (b.y - a.y) / 3;
  const p2x = b.hi ? b.hi[0] : a.x + ((b.x - a.x) * 2) / 3;
  const p2y = b.hi ? b.hi[1] : a.y + ((b.y - a.y) * 2) / 3;

  let len = 0;
  let prevX = a.x;
  let prevY = a.y;
  const steps = 8;
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const x = mt2 * mt * a.x + 3 * mt2 * t * p1x + 3 * mt * t2 * p2x + t2 * t * b.x;
    const y = mt2 * mt * a.y + 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t2 * t * b.y;
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return len;
}

function computeContourPerimeter(points: readonly PathMorphPoint[], closed: boolean): number {
  const n = points.length;
  if (n < 2) return 0;
  const segs = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segs; i += 1) {
    total += cubicSegmentArcLength(points[i], points[(i + 1) % n]);
  }
  return total;
}

/**
 * Reverses a closed contour while swapping `handleIn` and `handleOut` on every anchor
 * so the geometric curve remains identical with opposite traversal direction.
 */
export function reverseMorphContour(points: readonly PathMorphPoint[]): PathMorphPoint[] {
  const n = points.length;
  const out: PathMorphPoint[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const src = points[n - 1 - i];
    const next: PathMorphPoint = {
      x: src.x,
      y: src.y,
      pt: src.pt,
    };
    if (src.ho) next.hi = [src.ho[0], src.ho[1]];
    if (src.hi) next.ho = [src.hi[0], src.hi[1]];
    if (src.cr !== undefined) next.cr = src.cr;
    out[i] = next;
  }
  return out;
}

/**
 * Cyclically rotates a contour array by `shift` indices (positive shifts index `shift` to index `0`).
 */
export function rotateMorphContour(points: readonly PathMorphPoint[], shift: number): PathMorphPoint[] {
  const n = points.length;
  if (n === 0) return [];
  const k = ((shift % n) + n) % n;
  if (k === 0) return points.slice();
  return [...points.slice(k), ...points.slice(0, k)];
}

/**
 * Splits a cubic Bezier segment `(p0, c1, c2, p3)` at arbitrary parameter `t in (0, 1)`
 * using exact de Casteljau subdivision so resampling preserves curve geometry faithfully.
 */
function splitCubicAtT(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  t: number,
): {
  leftC1: [number, number];
  leftC2: [number, number];
  splitX: number;
  splitY: number;
  rightC1: [number, number];
  rightC2: [number, number];
} {
  const mt = 1 - t;
  const q0x = mt * p0x + t * p1x;
  const q0y = mt * p0y + t * p1y;
  const q1x = mt * p1x + t * p2x;
  const q1y = mt * p1y + t * p2y;
  const q2x = mt * p2x + t * p3x;
  const q2y = mt * p2y + t * p3y;

  const r0x = mt * q0x + t * q1x;
  const r0y = mt * q0y + t * q1y;
  const r1x = mt * q1x + t * q2x;
  const r1y = mt * q1y + t * q2y;

  const sx = mt * r0x + t * r1x;
  const sy = mt * r0y + t * r1y;

  return {
    leftC1: [q0x, q0y],
    leftC2: [r0x, r0y],
    splitX: sx,
    splitY: sy,
    rightC1: [r1x, r1y],
    rightC2: [q2x, q2y],
  };
}

/**
 * Splits a segment `a -> b` into `parts` equal-parameter sub-segments (inserting `parts - 1`
 * interior anchors) via exact recursive de Casteljau subdivision.
 */
function subdivideMorphSegmentEvenly(
  a: PathMorphPoint,
  b: PathMorphPoint,
  parts: number,
): {
  aOut: [number, number] | undefined;
  mids: PathMorphPoint[];
  bIn: [number, number] | undefined;
} {
  if (parts <= 1) {
    return { aOut: a.ho, mids: [], bIn: b.hi };
  }
  const hasCurve = Boolean(a.ho || b.hi);
  if (!hasCurve) {
    const mids: PathMorphPoint[] = [];
    for (let i = 1; i < parts; i += 1) {
      const t = i / parts;
      mids.push({
        x: round2(a.x + (b.x - a.x) * t),
        y: round2(a.y + (b.y - a.y) * t),
        pt: 'c',
      });
    }
    return { aOut: undefined, mids, bIn: undefined };
  }

  let cur0x = a.x;
  let cur0y = a.y;
  let cur1x = a.ho ? a.ho[0] : a.x + (b.x - a.x) / 3;
  let cur1y = a.ho ? a.ho[1] : a.y + (b.y - a.y) / 3;
  let cur2x = b.hi ? b.hi[0] : a.x + ((b.x - a.x) * 2) / 3;
  let cur2y = b.hi ? b.hi[1] : a.y + ((b.y - a.y) * 2) / 3;
  const endX = b.x;
  const endY = b.y;

  let firstOut: [number, number] | undefined;
  const mids: PathMorphPoint[] = [];

  for (let remaining = parts; remaining > 1; remaining -= 1) {
    const t = 1 / remaining;
    const split = splitCubicAtT(cur0x, cur0y, cur1x, cur1y, cur2x, cur2y, endX, endY, t);
    if (!firstOut) {
      firstOut = [round2(split.leftC1[0]), round2(split.leftC1[1])];
    } else if (mids.length > 0) {
      mids[mids.length - 1].ho = [round2(split.leftC1[0]), round2(split.leftC1[1])];
    }
    mids.push({
      x: round2(split.splitX),
      y: round2(split.splitY),
      hi: [round2(split.leftC2[0]), round2(split.leftC2[1])],
      pt: 's',
    });
    cur0x = split.splitX;
    cur0y = split.splitY;
    cur1x = split.rightC1[0];
    cur1y = split.rightC1[1];
    cur2x = split.rightC2[0];
    cur2y = split.rightC2[1];
  }

  if (mids.length > 0) {
    mids[mids.length - 1].ho = [round2(cur1x), round2(cur1y)];
  }
  const lastIn: [number, number] = [round2(cur2x), round2(cur2y)];
  return { aOut: firstOut, mids, bIn: lastIn };
}

/**
 * Proportional arc-length-aware cubic Bezier subdivision up to `targetCount`
 * (capped at `MAX_MORPH_POINTS`). Allocates extra anchors proportionally across
 * segments by `arcLength / parts` and splits each segment into equal-parameter
 * cubic sub-curves via exact de Casteljau subdivision (preserving exact symmetry,
 * e.g. 4-point Circle -> 12-point contour with exact 30-degree arc spacing).
 */
function resampleMorphPoints(
  points: readonly PathMorphPoint[],
  closed: boolean,
  targetCount: number,
): PathMorphPoint[] {
  const cappedTarget = Math.min(MAX_MORPH_POINTS, Math.max(points.length, targetCount));
  const base = points.map((p) => ({
    ...p,
    ...(p.hi ? { hi: [p.hi[0], p.hi[1]] as [number, number] } : {}),
    ...(p.ho ? { ho: [p.ho[0], p.ho[1]] as [number, number] } : {}),
  }));
  if (base.length === 0 || base.length >= cappedTarget) return base;
  if (base.length === 1) {
    while (base.length < cappedTarget) base.push({ ...base[0] });
    return base;
  }

  const segCount = closed ? base.length : base.length - 1;
  const lengths = new Float64Array(segCount);
  const parts = new Uint16Array(segCount);
  for (let i = 0; i < segCount; i += 1) {
    lengths[i] = cubicSegmentArcLength(base[i], base[(i + 1) % base.length]);
    parts[i] = 1;
  }

  let needed = cappedTarget - base.length;
  while (needed > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < segCount; i += 1) {
      const score = lengths[i] / parts[i];
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    parts[bestIdx] += 1;
    needed -= 1;
  }

  // Clone anchors so handle updates never alias
  const anchors = base.map((p) => ({
    ...p,
    ...(p.hi ? { hi: [p.hi[0], p.hi[1]] as [number, number] } : {}),
    ...(p.ho ? { ho: [p.ho[0], p.ho[1]] as [number, number] } : {}),
  }));
  const segmentMids: PathMorphPoint[][] = new Array(segCount);

  for (let i = 0; i < segCount; i += 1) {
    if (parts[i] <= 1) {
      segmentMids[i] = [];
      continue;
    }
    const nextIdx = (i + 1) % anchors.length;
    const sub = subdivideMorphSegmentEvenly(anchors[i], anchors[nextIdx], parts[i]);
    if (sub.aOut) anchors[i].ho = sub.aOut;
    if (sub.bIn) anchors[nextIdx].hi = sub.bIn;
    segmentMids[i] = sub.mids;
  }

  const out: PathMorphPoint[] = [];
  for (let i = 0; i < anchors.length; i += 1) {
    out.push(anchors[i]);
    if (i < segCount && segmentMids[i].length > 0) {
      for (const m of segmentMids[i]) out.push(m);
    }
  }
  return out;
}

/**
 * Normalizes a contour to unit scale around its centroid for scale-invariant
 * cyclic correspondence cost evaluation.
 */
function computeNormalizedCoords(points: readonly PathMorphPoint[]): Float64Array {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    cx += points[i].x;
    cy += points[i].y;
  }
  cx /= n;
  cy /= n;

  let rms = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = points[i].x - cx;
    const dy = points[i].y - cy;
    rms += dx * dx + dy * dy;
  }
  const scale = Math.sqrt(rms / n) || 1;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    out[i * 2] = (points[i].x - cx) / scale;
    out[i * 2 + 1] = (points[i].y - cy) / scale;
  }
  return out;
}

/**
 * Finds the cyclic shift `k` of `toPts` that minimizes mean squared normalized
 * vertex distance against `fromPts` (eliminates unintended rotational twist).
 */
function findBestCyclicShift(
  fromPts: readonly PathMorphPoint[],
  toPts: readonly PathMorphPoint[],
): { shift: number; meanSqError: number } {
  const n = fromPts.length;
  if (n === 0 || toPts.length !== n) {
    return { shift: 0, meanSqError: 0 };
  }
  const normA = computeNormalizedCoords(fromPts);
  const normB = computeNormalizedCoords(toPts);

  let bestShift = 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let k = 0; k < n; k += 1) {
    let cost = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + k) % n;
      const dx = normA[i * 2] - normB[j * 2];
      const dy = normA[i * 2 + 1] - normB[j * 2 + 1];
      cost += dx * dx + dy * dy;
    }
    // Slight deterministic tie-breaker favoring shift 0 when geometrically symmetric
    const tieBias = k === 0 ? -1e-6 : 0;
    if (cost + tieBias < bestCost) {
      bestCost = cost;
      bestShift = k;
    }
  }
  return { shift: bestShift, meanSqError: bestCost / n };
}

/**
 * Packs a matched contour into a flat `Float64Array` (7 doubles per anchor)
 * with explicit straight-to-curve third-point handle synthesis whenever the partner
 * contour has a Bezier handle on that slot.
 */
function packMatchedContours(
  fromPts: readonly PathMorphPoint[],
  toPts: readonly PathMorphPoint[],
  closed = true,
): {
  fromBuf: Float64Array;
  toBuf: Float64Array;
  flags: Uint8Array;
  fromTypes: Array<'c' | 's' | 'y'>;
  toTypes: Array<'c' | 's' | 'y'>;
} {
  const n = Math.min(fromPts.length, toPts.length);
  const fromBuf = new Float64Array(n * STRIDE);
  const toBuf = new Float64Array(n * STRIDE);
  const flags = new Uint8Array(n);
  const fromTypes: Array<'c' | 's' | 'y'> = new Array(n);
  const toTypes: Array<'c' | 's' | 'y'> = new Array(n);

  for (let i = 0; i < n; i += 1) {
    const a = fromPts[i];
    const b = toPts[i];
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const prevA = hasPrev ? fromPts[(i - 1 + n) % n] : a;
    const nextA = hasNext ? fromPts[(i + 1) % n] : a;
    const prevB = hasPrev ? toPts[(i - 1 + n) % n] : b;
    const nextB = hasNext ? toPts[(i + 1) % n] : b;

    const base = i * STRIDE;
    fromBuf[base] = a.x;
    fromBuf[base + 1] = a.y;
    toBuf[base] = b.x;
    toBuf[base + 1] = b.y;

    fromTypes[i] = a.pt;
    toTypes[i] = b.pt;

    let f = 0;
    if (hasPrev && (a.hi || b.hi)) {
      f |= FLAG_HI;
      fromBuf[base + 2] = a.hi ? a.hi[0] : a.x + (prevA.x - a.x) / 3;
      fromBuf[base + 3] = a.hi ? a.hi[1] : a.y + (prevA.y - a.y) / 3;
      toBuf[base + 2] = b.hi ? b.hi[0] : b.x + (prevB.x - b.x) / 3;
      toBuf[base + 3] = b.hi ? b.hi[1] : b.y + (prevB.y - b.y) / 3;
    }
    if (hasNext && (a.ho || b.ho)) {
      f |= FLAG_HO;
      fromBuf[base + 4] = a.ho ? a.ho[0] : a.x + (nextA.x - a.x) / 3;
      fromBuf[base + 5] = a.ho ? a.ho[1] : a.y + (nextA.y - a.y) / 3;
      toBuf[base + 4] = b.ho ? b.ho[0] : b.x + (nextB.x - b.x) / 3;
      toBuf[base + 5] = b.ho ? b.ho[1] : b.y + (nextB.y - b.y) / 3;
    }
    const acr = a.cr ?? 0;
    const bcr = b.cr ?? 0;
    if (acr > 0 || bcr > 0) {
      f |= FLAG_CR;
      fromBuf[base + 6] = acr;
      toBuf[base + 6] = bcr;
    }
    flags[i] = f;
  }

  return { fromBuf, toBuf, flags, fromTypes, toTypes };
}

// ---------------------------------------------------------------------------
// Bounded LRU Cache for PreparedMorphPair (avoids per-frame JSON/subdivision)
// ---------------------------------------------------------------------------

const preparedPairCache = new Map<string, PreparedMorphPair>();
let cacheHits = 0;
let cacheMisses = 0;

export function getMorphCacheStats(): MorphCacheStats {
  return {
    size: preparedPairCache.size,
    maxSize: MAX_PREPARED_MORPH_CACHE,
    hits: cacheHits,
    misses: cacheMisses,
  };
}

export function clearMorphPairCache(): void {
  preparedPairCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

function computeContourCentroid(points: readonly PathMorphPoint[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < points.length; i += 1) {
    sx += points[i].x;
    sy += points[i].y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Synthesizes a zero-radius collapsed closed partner contour centered at the
 * partner's centroid so extra contours/holes open out of or shrink into their
 * center cleanly when morphing between shapes with different contour counts.
 */
function buildCollapsedPartnerContour(contour: readonly PathMorphPoint[]): PathMorphPoint[] {
  const { x, y } = computeContourCentroid(contour);
  const cx = round2(x);
  const cy = round2(y);
  return contour.map((pt) => {
    const out: PathMorphPoint = { x: cx, y: cy, pt: pt.pt };
    if (pt.hi) out.hi = [cx, cy];
    if (pt.ho) out.ho = [cx, cy];
    return out;
  });
}

function computeOpenPathDirectionCost(
  fromPts: readonly PathMorphPoint[],
  toPts: readonly PathMorphPoint[],
): number {
  const n = Math.min(fromPts.length, toPts.length);
  let cost = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = fromPts[i].x - toPts[i].x;
    const dy = fromPts[i].y - toPts[i].y;
    cost += dx * dx + dy * dy;
  }
  return cost;
}

function prepareSingleContourPair(
  rawFromPts: readonly PathMorphPoint[],
  rawToPts: readonly PathMorphPoint[],
  matchMode: MorphMatchMode,
  manualReverse: boolean,
  manualOffset: number,
  skipWindingAlign = false,
  fromClosed = true,
  toClosed = true,
): PreparedMorphContourPair {
  const effectiveClosed = fromClosed || toClosed;
  let fromPts = rawFromPts.slice();
  let toPts = rawToPts.slice();
  let reversed = false;

  if (!effectiveClosed) {
    // Open <-> Open morphing:
    // Resample open curves across (n - 1) segments and pick forward vs reversed
    // endpoint alignment without cyclic wrapping across the open gap.
    const nA = fromPts.length;
    const nB = toPts.length;
    let targetCount = Math.max(nA, nB);
    if (matchMode === 'auto' && nA !== nB) {
      targetCount = Math.min(MAX_MORPH_POINTS, Math.max(targetCount, 8));
    }
    if (fromPts.length < targetCount) {
      fromPts = resampleMorphPoints(fromPts, false, targetCount);
    }
    if (toPts.length < targetCount) {
      toPts = resampleMorphPoints(toPts, false, targetCount);
    }
    if (matchMode === 'auto' && !skipWindingAlign) {
      const forwardCost = computeOpenPathDirectionCost(fromPts, toPts);
      const revCandidate = reverseMorphContour(toPts);
      const reverseCost = computeOpenPathDirectionCost(fromPts, revCandidate);
      if (reverseCost + 1e-3 < forwardCost) {
        toPts = revCandidate;
        reversed = !reversed;
      }
    }
    if (manualReverse) {
      toPts = reverseMorphContour(toPts);
      reversed = !reversed;
    }
    const packed = packMatchedContours(fromPts, toPts, false);
    return {
      pointCount: packed.flags.length,
      closed: false,
      cyclicShift: 0,
      reversed,
      flags: packed.flags,
      fromTypes: packed.fromTypes,
      toTypes: packed.toTypes,
      fromBuf: packed.fromBuf,
      toBuf: packed.toBuf,
      fromPoints: rawFromPts,
      toPoints: rawToPts,
    };
  }

  // Closed <-> Closed OR Open <-> Closed (open contour promoted via deterministic closing bridge)
  // Step 1: Winding normalization (ensure both contours traverse in the same direction)
  if (matchMode === 'auto' && !skipWindingAlign) {
    const areaA = computeContourSignedArea(fromPts);
    const areaB = computeContourSignedArea(toPts);
    if ((areaA > 1e-4 && areaB < -1e-4) || (areaA < -1e-4 && areaB > 1e-4)) {
      toPts = reverseMorphContour(toPts);
      reversed = !reversed;
    }
  }
  if (manualReverse) {
    toPts = reverseMorphContour(toPts);
    reversed = !reversed;
  }

  // Step 2: Determine target point count with symmetry-preserving subdivision
  const nA = fromPts.length;
  const nB = toPts.length;
  const hasCornerRadiusEdit =
    nA === nB &&
    (fromPts.some((p) => (p.cr ?? 0) > 0) || toPts.some((p) => (p.cr ?? 0) > 0));

  let targetCount = Math.max(nA, nB);
  if (matchMode === 'auto' && !hasCornerRadiusEdit && !skipWindingAlign) {
    if (nA === nB && nA <= 6 && nA >= 3) {
      const rawAlign = findBestCyclicShift(fromPts, toPts);
      if (rawAlign.meanSqError > 0.16) {
        const doubledA = resampleMorphPoints(fromPts, true, nA * 2);
        const doubledB = resampleMorphPoints(toPts, true, nB * 2);
        const doubledAlign = findBestCyclicShift(doubledA, doubledB);
        if (doubledAlign.meanSqError < rawAlign.meanSqError * 0.72) {
          targetCount = nA * 2;
        }
      }
    } else if (nA !== nB || nA < 3 || nB < 3) {
      const minSmooth = Math.max(nA, nB) < 8 ? 12 : Math.max(nA, nB);
      targetCount = Math.min(MAX_MORPH_POINTS, minSmooth);
    }
  }

  if (fromPts.length < targetCount) {
    fromPts = resampleMorphPoints(fromPts, true, targetCount);
  }
  if (toPts.length < targetCount) {
    toPts = resampleMorphPoints(toPts, true, targetCount);
  }

  // Step 3: Optimal cyclic start-anchor alignment (or manual offset / index mode)
  let cyclicShift = 0;
  if (matchMode === 'auto' && !skipWindingAlign) {
    const autoAlign = findBestCyclicShift(fromPts, toPts);
    cyclicShift = autoAlign.shift;
  }
  if (manualOffset !== 0) {
    cyclicShift = ((cyclicShift + manualOffset) % toPts.length + toPts.length) % toPts.length;
  }
  if (cyclicShift !== 0) {
    toPts = rotateMorphContour(toPts, cyclicShift);
  }

  const packed = packMatchedContours(fromPts, toPts, true);
  return {
    pointCount: packed.flags.length,
    closed: true,
    cyclicShift,
    reversed,
    flags: packed.flags,
    fromTypes: packed.fromTypes,
    toTypes: packed.toTypes,
    fromBuf: packed.fromBuf,
    toBuf: packed.toBuf,
    fromPoints: rawFromPts,
    toPoints: rawToPts,
  };
}

/**
 * Matches subpath/hole contours across two snapshots by spatial proximity
 * (centroid distance + area similarity). Any unmatched extra contour on either
 * side is paired with a collapsed zero-radius contour at its centroid so holes
 * emerge or vanish smoothly without popping.
 */
function prepareSubpathPairs(
  fromSubpaths: readonly PathMorphSubpath[],
  toSubpaths: readonly PathMorphSubpath[],
  matchMode: MorphMatchMode,
): PreparedMorphContourPair[] {
  if (fromSubpaths.length === 0 && toSubpaths.length === 0) return [];

  const fromMeta = fromSubpaths.map((sp, idx) => ({
    idx,
    points: sp.points,
    closed: sp.closed,
    centroid: computeContourCentroid(sp.points),
    area: Math.abs(computeContourSignedArea(sp.points)),
  }));
  const toMeta = toSubpaths.map((sp, idx) => ({
    idx,
    points: sp.points,
    closed: sp.closed,
    centroid: computeContourCentroid(sp.points),
    area: Math.abs(computeContourSignedArea(sp.points)),
  }));

  const usedFrom = new Set<number>();
  const usedTo = new Set<number>();
  const matchedPairs: Array<{
    fromPts: readonly PathMorphPoint[];
    toPts: readonly PathMorphPoint[];
    fromClosed: boolean;
    toClosed: boolean;
    collapsed: boolean;
  }> = [];

  // Greedy nearest-centroid assignment for shared contour count
  const pairCount = Math.min(fromMeta.length, toMeta.length);
  for (let p = 0; p < pairCount; p += 1) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const fm of fromMeta) {
      if (usedFrom.has(fm.idx)) continue;
      for (const tm of toMeta) {
        if (usedTo.has(tm.idx)) continue;
        const dx = fm.centroid.x - tm.centroid.x;
        const dy = fm.centroid.y - tm.centroid.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestFrom = fm.idx;
          bestTo = tm.idx;
        }
      }
    }
    if (bestFrom >= 0 && bestTo >= 0) {
      usedFrom.add(bestFrom);
      usedTo.add(bestTo);
      matchedPairs.push({
        fromPts: fromMeta[bestFrom].points,
        toPts: toMeta[bestTo].points,
        fromClosed: fromMeta[bestFrom].closed,
        toClosed: toMeta[bestTo].closed,
        collapsed: false,
      });
    }
  }

  for (const fm of fromMeta) {
    if (!usedFrom.has(fm.idx)) {
      matchedPairs.push({
        fromPts: fm.points,
        toPts: buildCollapsedPartnerContour(fm.points),
        fromClosed: fm.closed,
        toClosed: fm.closed,
        collapsed: true,
      });
    }
  }
  for (const tm of toMeta) {
    if (!usedTo.has(tm.idx)) {
      matchedPairs.push({
        fromPts: buildCollapsedPartnerContour(tm.points),
        toPts: tm.points,
        fromClosed: tm.closed,
        toClosed: tm.closed,
        collapsed: true,
      });
    }
  }

  return matchedPairs.map((item) =>
    prepareSingleContourPair(
      item.fromPts,
      item.toPts,
      item.collapsed ? 'index' : matchMode,
      false,
      0,
      item.collapsed,
      item.fromClosed,
      item.toClosed,
    ),
  );
}

/**
 * Prepares and caches a normalized, winding-aligned, start-anchor-matched contour
 * pair between two serialized `PathMorphSnapshot` keyframes (single or multi-contour).
 */
export function prepareMorphPair(fromStr: string, toStr: string): PreparedMorphPair | null {
  const cacheKey = `${fromStr}\u0000${toStr}`;
  const cached = preparedPairCache.get(cacheKey);
  if (cached) {
    cacheHits += 1;
    // Refresh LRU order
    preparedPairCache.delete(cacheKey);
    preparedPairCache.set(cacheKey, cached);
    return cached;
  }
  cacheMisses += 1;

  const from = parsePathMorphSnapshot(fromStr);
  const to = parsePathMorphSnapshot(toStr);
  if (!from || !to) return null;

  const compat = checkMorphPairCompatibility(from, to);
  if (!compat.supported) {
    const failed: PreparedMorphPair = {
      compatible: false,
      reason: compat.reason,
      message: compat.message,
      pointCount: 0,
      closed: from.closed,
      cyclicShift: 0,
      reversed: false,
      flags: new Uint8Array(0),
      fromTypes: [],
      toTypes: [],
      fromBuf: new Float64Array(0),
      toBuf: new Float64Array(0),
      fromSnapshot: from,
      toSnapshot: to,
    };
    storePreparedPair(cacheKey, failed);
    return failed;
  }

  const options = to.morph ?? {};
  const matchMode: MorphMatchMode = options.matchMode ?? 'auto';
  const manualReverse = Boolean(options.reverse);
  const manualOffset = options.startOffset ?? 0;

  const primary = prepareSingleContourPair(
    from.points,
    to.points,
    matchMode,
    manualReverse,
    manualOffset,
    false,
    from.closed,
    to.closed,
  );

  const fromSubpaths = from.subpaths ?? [];
  const toSubpaths = to.subpaths ?? [];
  const subpathPairs =
    fromSubpaths.length > 0 || toSubpaths.length > 0
      ? prepareSubpathPairs(fromSubpaths, toSubpaths, matchMode)
      : undefined;

  const topologyTransition: MorphTopologyTransition =
    from.closed && to.closed
      ? 'closed-to-closed'
      : !from.closed && !to.closed
        ? 'open-to-open'
        : !from.closed && to.closed
          ? 'open-to-closed'
          : 'closed-to-open';

  const prepared: PreparedMorphPair = {
    compatible: true,
    reason: 'supported',
    topologyTransition,
    message: subpathPairs && subpathPairs.length > 0
      ? `Prepared multi-contour morph pair (${subpathPairs.length + 1} contours, ${topologyTransition}).`
      : `Prepared single-contour morph pair (${topologyTransition}).`,
    pointCount: primary.pointCount,
    closed: primary.closed,
    cyclicShift: primary.cyclicShift,
    reversed: primary.reversed,
    flags: primary.flags,
    fromTypes: primary.fromTypes,
    toTypes: primary.toTypes,
    fromBuf: primary.fromBuf,
    toBuf: primary.toBuf,
    ...(subpathPairs && subpathPairs.length > 0 ? { subpathPairs } : {}),
    fromSnapshot: from,
    toSnapshot: to,
  };
  storePreparedPair(cacheKey, prepared);
  return prepared;
}

function storePreparedPair(key: string, value: PreparedMorphPair): void {
  if (preparedPairCache.size >= MAX_PREPARED_MORPH_CACHE) {
    const oldestKey = preparedPairCache.keys().next().value;
    if (oldestKey !== undefined) {
      preparedPairCache.delete(oldestKey);
    }
  }
  preparedPairCache.set(key, value);
}

function lerpContourBuffersToAnchors(
  fromBuf: Float64Array,
  toBuf: Float64Array,
  flags: Uint8Array,
  fromTypes: ReadonlyArray<'c' | 's' | 'y'>,
  toTypes: ReadonlyArray<'c' | 's' | 'y'>,
  pointCount: number,
  t: number,
  templateAnchors?: readonly VectorAnchorPoint[],
  idPrefix = 'morph',
): VectorAnchorPoint[] {
  const useToType = t >= 0.5;
  const out: VectorAnchorPoint[] = new Array(pointCount);
  for (let i = 0; i < pointCount; i += 1) {
    const base = i * STRIDE;
    const f = flags[i];
    const template = templateAnchors?.[i];
    const pt: VectorAnchorPoint = {
      id: template?.id ?? `${idPrefix}-${i}`,
      x: round2(fromBuf[base] + (toBuf[base] - fromBuf[base]) * t),
      y: round2(fromBuf[base + 1] + (toBuf[base + 1] - fromBuf[base + 1]) * t),
      pointType: decodePointType(useToType ? toTypes[i] : fromTypes[i]),
    };
    if (f & FLAG_HI) {
      pt.handleIn = {
        x: round2(fromBuf[base + 2] + (toBuf[base + 2] - fromBuf[base + 2]) * t),
        y: round2(fromBuf[base + 3] + (toBuf[base + 3] - fromBuf[base + 3]) * t),
      };
    }
    if (f & FLAG_HO) {
      pt.handleOut = {
        x: round2(fromBuf[base + 4] + (toBuf[base + 4] - fromBuf[base + 4]) * t),
        y: round2(fromBuf[base + 5] + (toBuf[base + 5] - fromBuf[base + 5]) * t),
      };
    }
    if (f & FLAG_CR) {
      const cr = Math.max(0, round2(fromBuf[base + 6] + (toBuf[base + 6] - fromBuf[base + 6]) * t));
      if (cr > 0.01) pt.cornerRadius = cr;
    }
    out[i] = pt;
  }
  return out;
}

function lerpContourBuffersToMorphPoints(
  fromBuf: Float64Array,
  toBuf: Float64Array,
  flags: Uint8Array,
  fromTypes: ReadonlyArray<'c' | 's' | 'y'>,
  toTypes: ReadonlyArray<'c' | 's' | 'y'>,
  pointCount: number,
  t: number,
): PathMorphPoint[] {
  const useToType = t >= 0.5;
  const points: PathMorphPoint[] = new Array(pointCount);
  for (let i = 0; i < pointCount; i += 1) {
    const base = i * STRIDE;
    const f = flags[i];
    const point: PathMorphPoint = {
      x: round2(fromBuf[base] + (toBuf[base] - fromBuf[base]) * t),
      y: round2(fromBuf[base + 1] + (toBuf[base + 1] - fromBuf[base + 1]) * t),
      pt: useToType ? toTypes[i] : fromTypes[i],
    };
    if (f & FLAG_HI) {
      point.hi = [
        round2(fromBuf[base + 2] + (toBuf[base + 2] - fromBuf[base + 2]) * t),
        round2(fromBuf[base + 3] + (toBuf[base + 3] - fromBuf[base + 3]) * t),
      ];
    }
    if (f & FLAG_HO) {
      point.ho = [
        round2(fromBuf[base + 4] + (toBuf[base + 4] - fromBuf[base + 4]) * t),
        round2(fromBuf[base + 5] + (toBuf[base + 5] - fromBuf[base + 5]) * t),
      ];
    }
    if (f & FLAG_CR) {
      const cr = Math.max(0, round2(fromBuf[base + 6] + (toBuf[base + 6] - fromBuf[base + 6]) * t));
      if (cr > 0.01) point.cr = cr;
    }
    points[i] = point;
  }
  return points;
}

function decodeSubpathsFromSnapshot(
  snapshot: PathMorphSnapshot,
  idPrefix: string,
): VectorSubpath[] | undefined {
  if (!snapshot.subpaths || snapshot.subpaths.length === 0) return undefined;
  return snapshot.subpaths.map((sp, spIdx) => ({
    closed: sp.closed,
    points: decodeAnchors(sp.points, undefined, `${idPrefix}-sp${spIdx}`),
  }));
}

/**
 * Evaluates a cached `PreparedMorphPair` directly into primary `VectorAnchorPoint[]`
 * with zero JSON serialization or parsing on playback frames.
 */
export function evaluatePreparedMorphPairToAnchors(
  pair: PreparedMorphPair,
  t: number,
  templateAnchors?: readonly VectorAnchorPoint[],
  idPrefix = 'morph',
): VectorAnchorPoint[] {
  if (!pair.compatible || pair.pointCount === 0) {
    const fallback = t < 0.5 ? pair.fromSnapshot : pair.toSnapshot;
    return decodeAnchors(fallback.points, templateAnchors, idPrefix);
  }
  if (t <= 0) {
    return decodeAnchors(pair.fromSnapshot.points, templateAnchors, idPrefix);
  }
  if (t >= 1) {
    return decodeAnchors(pair.toSnapshot.points, templateAnchors, idPrefix);
  }
  return lerpContourBuffersToAnchors(
    pair.fromBuf,
    pair.toBuf,
    pair.flags,
    pair.fromTypes,
    pair.toTypes,
    pair.pointCount,
    t,
    templateAnchors,
    idPrefix,
  );
}

/**
 * Evaluates a cached `PreparedMorphPair` into full geometry including any
 * multi-contour `subpaths` (holes/compound contours).
 */
export function evaluatePreparedMorphPairToGeometry(
  pair: PreparedMorphPair,
  t: number,
  templateAnchors?: readonly VectorAnchorPoint[],
  idPrefix = 'morph',
): EvaluatedMorphGeometry {
  if (!pair.compatible || pair.pointCount === 0) {
    const fallback = t < 0.5 ? pair.fromSnapshot : pair.toSnapshot;
    const subpaths = decodeSubpathsFromSnapshot(fallback, idPrefix);
    return {
      points: decodeAnchors(fallback.points, templateAnchors, idPrefix),
      closed: fallback.closed,
      ...(subpaths ? { subpaths } : {}),
    };
  }
  if (t <= 0) {
    const subpaths = decodeSubpathsFromSnapshot(pair.fromSnapshot, idPrefix);
    return {
      points: decodeAnchors(pair.fromSnapshot.points, templateAnchors, idPrefix),
      closed: pair.fromSnapshot.closed,
      ...(subpaths ? { subpaths } : {}),
    };
  }
  if (t >= 1) {
    const subpaths = decodeSubpathsFromSnapshot(pair.toSnapshot, idPrefix);
    return {
      points: decodeAnchors(pair.toSnapshot.points, templateAnchors, idPrefix),
      closed: pair.toSnapshot.closed,
      ...(subpaths ? { subpaths } : {}),
    };
  }

  const points = lerpContourBuffersToAnchors(
    pair.fromBuf,
    pair.toBuf,
    pair.flags,
    pair.fromTypes,
    pair.toTypes,
    pair.pointCount,
    t,
    templateAnchors,
    idPrefix,
  );

  const subpaths: VectorSubpath[] | undefined =
    pair.subpathPairs && pair.subpathPairs.length > 0
      ? pair.subpathPairs.map((spPair, spIdx) => ({
          closed: spPair.closed,
          points: lerpContourBuffersToAnchors(
            spPair.fromBuf,
            spPair.toBuf,
            spPair.flags,
            spPair.fromTypes,
            spPair.toTypes,
            spPair.pointCount,
            t,
            undefined,
            `${idPrefix}-sp${spIdx}`,
          ),
        }))
      : undefined;

  return {
    points,
    closed: pair.closed,
    ...(subpaths ? { subpaths } : {}),
  };
}

/**
 * Evaluates a morph pair between two serialized snapshots directly into
 * `EvaluatedMorphGeometry` (`points`, `closed`, optional `subpaths`) using the
 * cached `PreparedMorphPair`.
 */
export function evaluateMorphSnapshotsToAnchors(
  fromStr: string,
  toStr: string,
  t: number,
  templateAnchors?: readonly VectorAnchorPoint[],
  idPrefix = 'morph',
): EvaluatedMorphGeometry | null {
  if (fromStr === toStr || t <= 0) {
    const snap = parsePathMorphSnapshot(fromStr);
    if (!snap) return null;
    const subpaths = decodeSubpathsFromSnapshot(snap, idPrefix);
    return {
      points: decodeAnchors(snap.points, templateAnchors, idPrefix),
      closed: snap.closed,
      ...(subpaths ? { subpaths } : {}),
    };
  }
  if (t >= 1) {
    const snap = parsePathMorphSnapshot(toStr);
    if (!snap) return null;
    const subpaths = decodeSubpathsFromSnapshot(snap, idPrefix);
    return {
      points: decodeAnchors(snap.points, templateAnchors, idPrefix),
      closed: snap.closed,
      ...(subpaths ? { subpaths } : {}),
    };
  }
  const pair = prepareMorphPair(fromStr, toStr);
  if (!pair) return null;
  return evaluatePreparedMorphPairToGeometry(pair, t, templateAnchors, idPrefix);
}

/**
 * Smoothly interpolates two serialized `PathMorphSnapshot` JSON strings at eased progress `t`.
 * Supports both single-contour and multi-contour compound shapes & holes.
 */
export function interpolatePathMorph(fromStr: string, toStr: string, t: number): string {
  if (t <= 0 || fromStr === toStr) return fromStr;
  if (t >= 1) return toStr;

  const pair = prepareMorphPair(fromStr, toStr);
  if (!pair || !pair.compatible) {
    // Explicit fail-clean fallback for incompatible topologies (open paths, degenerate)
    return t < 0.5 ? fromStr : toStr;
  }

  const points = lerpContourBuffersToMorphPoints(
    pair.fromBuf,
    pair.toBuf,
    pair.flags,
    pair.fromTypes,
    pair.toTypes,
    pair.pointCount,
    t,
  );

  const subpaths: PathMorphSubpath[] | undefined =
    pair.subpathPairs && pair.subpathPairs.length > 0
      ? pair.subpathPairs.map((spPair) => ({
          closed: spPair.closed,
          points: lerpContourBuffersToMorphPoints(
            spPair.fromBuf,
            spPair.toBuf,
            spPair.flags,
            spPair.fromTypes,
            spPair.toTypes,
            spPair.pointCount,
            t,
          ),
        }))
      : undefined;

  const blended: PathMorphSnapshot = {
    v: 1,
    closed: pair.closed,
    points,
    ...(subpaths ? { subpaths } : {}),
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
    ...(nextSubpaths && !node.style.fillRule
      ? { style: { ...node.style, fillRule: 'evenodd' } }
      : {}),
  };
}

/**
 * Transiently projects ANY morph-supported `DesignNode` (`EllipseNode`, `RectNode`,
 * `FrameNode`, or `PathNode`) into a rendering `PathNode` using pre-evaluated anchors
 * (including multi-contour `subpaths` / holes) while preserving the EXACT canonical
 * `node.id`, transforms, visual styles, effects, filters, parent links, and clip masks.
 *
 * Canonical base geometry in the project document is NEVER mutated.
 */
export function applyMorphGeometryToDesignNode(
  node: DesignNode,
  geometry: EvaluatedMorphGeometry | string,
): DesignNode {
  if (
    node.type !== 'path' &&
    node.type !== 'ellipse' &&
    node.type !== 'rect' &&
    node.type !== 'frame'
  ) {
    return node;
  }

  let points: VectorAnchorPoint[];
  let closed: boolean;
  let nextSubpaths: VectorSubpath[] | undefined;

  if (typeof geometry === 'string') {
    const snapshot = parsePathMorphSnapshot(geometry);
    if (!snapshot) return node;
    const template = node.type === 'path' ? node.points : undefined;
    points = decodeAnchors(snapshot.points, template, `${node.id}-pt`);
    closed = snapshot.closed;
    if (snapshot.subpaths && snapshot.subpaths.length > 0) {
      nextSubpaths = snapshot.subpaths.map((sp, spIdx) => ({
        closed: sp.closed,
        points: decodeAnchors(
          sp.points,
          node.type === 'path' ? node.subpaths?.[spIdx]?.points : undefined,
          `${node.id}-sp${spIdx}`,
        ),
      }));
    }
  } else {
    points = geometry.points;
    closed = geometry.closed;
    if (geometry.subpaths && geometry.subpaths.length > 0) {
      nextSubpaths = geometry.subpaths;
    }
  }

  if (node.type === 'path') {
    return {
      ...node,
      points,
      closed,
      ...(nextSubpaths ? { subpaths: nextSubpaths } : { subpaths: undefined }),
      ...(nextSubpaths && !node.style.fillRule
        ? { style: { ...node.style, fillRule: 'evenodd' } }
        : {}),
    };
  }

  // Transiently project EllipseNode / RectNode / FrameNode into a rendering PathNode
  // preserving exact canonical identity (`id`), hierarchy, styles, fills, strokes, and effects.
  const shapeNode = node as EllipseNode | RectNode | FrameNode;
  const projected: PathNode = {
    id: shapeNode.id,
    name: shapeNode.name,
    type: 'path',
    x: shapeNode.x,
    y: shapeNode.y,
    width: shapeNode.width,
    height: shapeNode.height,
    rotation: shapeNode.rotation,
    opacity: shapeNode.opacity,
    visible: shapeNode.visible,
    locked: shapeNode.locked,
    parentId: shapeNode.parentId,
    onCanvas: shapeNode.onCanvas,
    blendMode: shapeNode.blendMode,
    effects: shapeNode.effects,
    cssFilters: shapeNode.cssFilters,
    clipMaskBaseId: shapeNode.clipMaskBaseId,
    clipMaskMode: shapeNode.clipMaskMode,
    semanticTag: shapeNode.semanticTag,
    htmlId: shapeNode.htmlId,
    className: shapeNode.className,
    ariaLabel: shapeNode.ariaLabel,
    href: shapeNode.href,
    linkTarget: shapeNode.linkTarget,
    layout: shapeNode.layout,
    layoutChild: shapeNode.layoutChild,
    responsive: shapeNode.responsive,
    transition: shapeNode.transition,
    tokenBindings: shapeNode.tokenBindings,
    style: {
      fill: shapeNode.style.fill,
      fills: shapeNode.style.fills,
      stroke: shapeNode.style.stroke,
      strokeWidth: shapeNode.style.strokeWidth,
      strokeAlign: shapeNode.style.strokeAlign,
      strokeDasharray: shapeNode.style.strokeDasharray,
      ...(shapeNode.style.trimStart !== undefined ? { trimStart: shapeNode.style.trimStart } : {}),
      ...(shapeNode.style.trimEnd !== undefined ? { trimEnd: shapeNode.style.trimEnd } : {}),
      ...(shapeNode.style.trimOffset !== undefined ? { trimOffset: shapeNode.style.trimOffset } : {}),
      ...(shapeNode.style.trimMode !== undefined ? { trimMode: shapeNode.style.trimMode } : {}),
      ...(nextSubpaths ? { fillRule: 'evenodd' as const } : {}),
    },
    points,
    closed,
    ...(nextSubpaths ? { subpaths: nextSubpaths } : {}),
  };
  return projected;
}

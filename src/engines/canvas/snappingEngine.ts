/**
 * Unified Snapping Engine for FOLIO Studio.
 *
 * One shared snapping core serving both Main Canvas and Component Canvas via
 * profile configuration (`'main' | 'component'`). Integrates four snap layers
 * over the existing FlatGridSpatialIndex broad-phase kernel with zoom-adaptive
 * thresholds, anti-jitter hysteresis, world-space rotated/path geometry,
 * mirror padding, equal spacing, axial/diagonal alignment, and deterministic
 * priority arbitration.
 *
 * Pure module — zero Preact/DOM dependencies.
 */

import type { DesignNode, PathNode, VectorAnchorPoint } from '../../core/document/types';
import { nodeLocalPointToWorld, type Point2D } from '../../core/document/vector';
import type { EffectiveLayerState } from '../../core/document/layers';
import type { SpatialIndexHandle, SpatialQueryRect } from '../../core/kernels/types';
import type { Bounds, ResizeHandle } from './geometry';

export type SnapProfile = 'main' | 'component';

export type SnapLayerKind =
  | 'geometry'
  | 'alignment'
  | 'spacing'
  | 'mirror-padding'
  | 'fractional'
  | 'diagonal';

export interface SnapSpacingSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly value: number;
  readonly orientation: 'horizontal' | 'vertical';
}

export interface SnapPointMarker {
  readonly x: number;
  readonly y: number;
  readonly kind: 'vertex' | 'edge-point';
}

export interface SnapGuide {
  axis: 'x' | 'y' | 'diagonal';
  position: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  kind?: SnapLayerKind;
  label?: string;
  spacingSegments?: readonly SnapSpacingSegment[];
  marker?: SnapPointMarker;
}

export interface SnapAxisLock {
  readonly id: string;
  readonly kind: SnapLayerKind;
  readonly priority: number;
  readonly snappedDelta: number;
  readonly targetPosition: number;
}

export interface SnapCoupledLock {
  readonly id: string;
  readonly kind: SnapLayerKind;
  readonly priority: number;
  readonly mode: 'point' | 'line';
  readonly snappedDx: number;
  readonly snappedDy: number;
  /** For diagonal line slide lock: line reference point, unit direction, unit normal, and subject reference point at start. */
  readonly linePoint?: Point2D;
  readonly dir?: Point2D;
  readonly normal?: Point2D;
  readonly subjectStartPoint?: Point2D;
  readonly segmentA?: Point2D;
  readonly segmentB?: Point2D;
}

export interface SnapLockState {
  readonly x?: SnapAxisLock | null;
  readonly y?: SnapAxisLock | null;
  readonly coupled?: SnapCoupledLock | null;
}

export interface SnapTelemetry {
  readonly candidatesInspected: number;
  readonly spatialQueryMs: number;
  readonly snapCalcMs: number;
  readonly usedSpatialIndex: boolean;
  readonly guideCount: number;
}

export interface TranslationSnapInput {
  readonly movingNodes: readonly DesignNode[];
  readonly dx: number;
  readonly dy: number;
  readonly artboard: Bounds;
  readonly profile?: SnapProfile;
  /** Canvas units per screen pixel (e.g. `1 / zoom` or `effectiveDocWidth / renderedSvgWidth`). */
  readonly canvasUnitsPerPixel?: number;
  /** Optional explicit entry tolerance override in canvas units (legacy callers). */
  readonly toleranceOverride?: number;
  /** Set true when Ctrl/Meta bypass is held. */
  readonly bypass?: boolean;
  /** Optional Shift axis-lock so snapping never moves the locked orthogonal axis. */
  readonly lockAxis?: 'x' | 'y' | null;
  /** Active FlatGridSpatialIndex from static scene (never rebuilt during drag). */
  readonly spatialIndex?: SpatialIndexHandle | null;
  /** Map of all static canvas nodes by ID for O(1) spatial-index hydration and parent lookup. */
  readonly nodeById?: ReadonlyMap<string, DesignNode> | null;
  /** Effective visibility/lock states from static scene. */
  readonly layerStates?: ReadonlyMap<string, EffectiveLayerState> | null;
  /** Fallback node list when spatialIndex is not provided (e.g. standalone unit calls). */
  readonly otherNodes?: readonly DesignNode[];
  /** Optional full document node list used to expand moving group descendants when nodeById is partial. */
  readonly allNodes?: readonly DesignNode[];
  /** Explicit IDs to exclude in addition to movingNodes + descendants. */
  readonly excludeIds?: ReadonlySet<string> | readonly string[];
  /** Allow snapping to movingNodes themselves (used for Alt+Drag clone preview). */
  readonly includeSelfAsTargets?: boolean;
  /** Transient lock state from previous drag frame for anti-jitter hysteresis. */
  readonly previousLock?: SnapLockState | null;
  /** Collect lightweight metrics for diagnostics/benchmarks. */
  readonly collectMetrics?: boolean;
}

export interface TranslationSnapOutput {
  readonly dx: number;
  readonly dy: number;
  readonly guides: SnapGuide[];
  readonly nextLock: SnapLockState | null;
  readonly metrics?: SnapTelemetry;
}

export interface ResizeSnapInput {
  readonly bounds: Bounds;
  readonly handle: ResizeHandle;
  readonly dx: number;
  readonly dy: number;
  readonly artboard: Bounds;
  readonly movingNodes?: readonly DesignNode[];
  readonly profile?: SnapProfile;
  readonly canvasUnitsPerPixel?: number;
  readonly toleranceOverride?: number;
  readonly bypass?: boolean;
  readonly lockAspect?: boolean;
  readonly fromCenter?: boolean;
  readonly spatialIndex?: SpatialIndexHandle | null;
  readonly nodeById?: ReadonlyMap<string, DesignNode> | null;
  readonly layerStates?: ReadonlyMap<string, EffectiveLayerState> | null;
  readonly otherNodes?: readonly DesignNode[];
  readonly allNodes?: readonly DesignNode[];
  readonly excludeIds?: ReadonlySet<string> | readonly string[];
  readonly previousLock?: SnapLockState | null;
  readonly collectMetrics?: boolean;
}

export interface ResizeSnapOutput {
  readonly dx: number;
  readonly dy: number;
  readonly guides: SnapGuide[];
  readonly nextLock: SnapLockState | null;
  readonly metrics?: SnapTelemetry;
}

export interface WorldSegment {
  readonly a: Point2D;
  readonly b: Point2D;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly isHorizontal: boolean;
  readonly isVertical: boolean;
  readonly isSlanted: boolean;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface NodeWorldGeometry {
  readonly id: string;
  readonly type: DesignNode['type'];
  readonly worldBounds: Bounds;
  readonly center: Point2D;
  readonly corners: readonly Point2D[];
  readonly vertices: readonly Point2D[];
  readonly edges: readonly WorldSegment[];
  readonly hasSlantedEdges: boolean;
  readonly rotationDeg: number;
}

export const SNAP_ENTRY_SCREEN_PX = 8;
export const SNAP_RELEASE_SCREEN_PX = 12;

const MAX_ACTIVE_GUIDES = 6;
const MAX_LOCAL_CANDIDATES = 96;
const MAX_CORRIDOR_CANDIDATES = 64;
const MAX_PATH_VERTICES = 64;
const MAX_SUBJECT_VERTICES = 28;
const MAX_SUBJECT_EDGES = 28;
const AXIS_EPS = 1e-3;
const DIST_TIE_EPS = 1e-4;
const PARALLEL_CROSS_EPS = 0.016; // ~0.9 degrees
const GUIDE_OVERHANG_PX = 14;
const DIAGONAL_EXTENSION_LIMIT = 640;

const FRACTION_SPECS: readonly { readonly ratio: number; readonly label: string }[] = [
  { ratio: 1 / 4, label: '1/4' },
  { ratio: 1 / 3, label: '1/3' },
  { ratio: 1 / 2, label: '1/2' },
  { ratio: 2 / 3, label: '2/3' },
  { ratio: 3 / 4, label: '3/4' },
];

const PRIORITY_ACTIVE_LOCK = 0;
const PRIORITY_GEOMETRY = 1;
const PRIORITY_ALIGNMENT = 2;
const PRIORITY_SPACING = 3;
const PRIORITY_FRACTIONAL = 4;

const worldGeometryCache = new WeakMap<DesignNode, NodeWorldGeometry>();

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function roundSnapValue(value: number): number {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function makeSegment(a: Point2D, b: Point2D): WorldSegment | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.05) return null;
  const dirX = dx / length;
  const dirY = dy / length;
  const normalX = -dirY;
  const normalY = dirX;
  const isHorizontal = Math.abs(dirY) <= AXIS_EPS;
  const isVertical = Math.abs(dirX) <= AXIS_EPS;
  const isSlanted = !isHorizontal && !isVertical;
  return {
    a,
    b,
    dx,
    dy,
    length,
    dirX,
    dirY,
    normalX,
    normalY,
    isHorizontal,
    isVertical,
    isSlanted,
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function evalCubicBezierPoint(p0: Point2D, c1: Point2D, c2: Point2D, p1: Point2D, t: number): Point2D {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p1.x,
    y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p1.y,
  };
}

function extractPathSubpathGeometry(
  node: PathNode,
  points: readonly VectorAnchorPoint[],
  closed: boolean,
  outVertices: Point2D[],
  outEdges: WorldSegment[],
): void {
  const count = points.length;
  if (count === 0) return;

  const worldAnchors: Point2D[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const pt = points[i];
    const world = nodeLocalPointToWorld(node, { x: pt.x, y: pt.y });
    worldAnchors[i] = world;
    if (outVertices.length < MAX_PATH_VERTICES) {
      outVertices.push(world);
    }
  }

  const segCount = closed ? count : count - 1;
  for (let i = 0; i < segCount; i += 1) {
    if (outEdges.length >= MAX_PATH_VERTICES) break;
    const p0 = points[i];
    const p1 = points[(i + 1) % count];
    const w0 = worldAnchors[i];
    const w1 = worldAnchors[(i + 1) % count];
    const hasCurve = Boolean(p0.handleOut || p1.handleIn);
    if (!hasCurve) {
      const seg = makeSegment(w0, w1);
      if (seg) outEdges.push(seg);
      continue;
    }

    const c1 = p0.handleOut ? nodeLocalPointToWorld(node, p0.handleOut) : w0;
    const c2 = p1.handleIn ? nodeLocalPointToWorld(node, p1.handleIn) : w1;
    // Sample 4 chords per cubic curve so curved paths snap accurately without heavy tessellation.
    let prev = w0;
    const steps = 4;
    for (let s = 1; s <= steps; s += 1) {
      if (outEdges.length >= MAX_PATH_VERTICES) break;
      const curr = s === steps ? w1 : evalCubicBezierPoint(w0, c1, c2, w1, s / steps);
      const seg = makeSegment(prev, curr);
      if (seg) outEdges.push(seg);
      prev = curr;
    }
  }
}

/**
 * Computes and caches exact world-space geometry (OBB corners, rotated AABB,
 * path anchor vertices, and world-space segments) keyed weakly by node reference.
 */
export function getNodeWorldGeometry(node: DesignNode): NodeWorldGeometry {
  const cached = worldGeometryCache.get(node);
  if (cached) return cached;

  const rotationDeg = Number.isFinite(node.rotation) ? node.rotation : 0;
  const center: Point2D = {
    x: node.x + node.width * 0.5,
    y: node.y + node.height * 0.5,
  };

  let corners: Point2D[];
  if (Math.abs(rotationDeg) <= 1e-4) {
    corners = [
      { x: node.x, y: node.y },
      { x: node.x + node.width, y: node.y },
      { x: node.x + node.width, y: node.y + node.height },
      { x: node.x, y: node.y + node.height },
    ];
  } else {
    corners = [
      nodeLocalPointToWorld(node, { x: 0, y: 0 }),
      nodeLocalPointToWorld(node, { x: node.width, y: 0 }),
      nodeLocalPointToWorld(node, { x: node.width, y: node.height }),
      nodeLocalPointToWorld(node, { x: 0, y: node.height }),
    ];
  }

  let vertices: Point2D[] = [];
  let edges: WorldSegment[] = [];

  if (node.type === 'path' && node.points.length > 0) {
    extractPathSubpathGeometry(node, node.points, node.closed, vertices, edges);
    if (node.subpaths) {
      for (const sp of node.subpaths) {
        if (vertices.length >= MAX_PATH_VERTICES && edges.length >= MAX_PATH_VERTICES) break;
        extractPathSubpathGeometry(node, sp.points, sp.closed, vertices, edges);
      }
    }
    if (vertices.length === 0) {
      vertices = corners;
    }
    if (edges.length === 0) {
      for (let i = 0; i < 4; i += 1) {
        const seg = makeSegment(corners[i], corners[(i + 1) % 4]);
        if (seg) edges.push(seg);
      }
    }
  } else {
    vertices = corners;
    for (let i = 0; i < 4; i += 1) {
      const seg = makeSegment(corners[i], corners[(i + 1) % 4]);
      if (seg) edges.push(seg);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < corners.length; i += 1) {
    const pt = corners[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (node.type === 'path') {
    for (let i = 0; i < vertices.length; i += 1) {
      const pt = vertices[i];
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = node.x;
    minY = node.y;
    maxX = node.x + node.width;
    maxY = node.y + node.height;
  }

  const hasSlantedEdges = edges.some((edge) => edge.isSlanted);
  const geometry: NodeWorldGeometry = {
    id: node.id,
    type: node.type,
    worldBounds: {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    },
    center,
    corners,
    vertices,
    edges,
    hasSlantedEdges,
    rotationDeg,
  };

  worldGeometryCache.set(node, geometry);
  return geometry;
}

/** Computes the exact world-space AABB for one or more nodes (accounting for rotation and paths). */
export function getWorldBounds(nodes: readonly DesignNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const wb = getNodeWorldGeometry(nodes[i]).worldBounds;
    if (wb.x < minX) minX = wb.x;
    if (wb.y < minY) minY = wb.y;
    if (wb.x + wb.width > maxX) maxX = wb.x + wb.width;
    if (wb.y + wb.height > maxY) maxY = wb.y + wb.height;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

interface SubjectGeometry {
  readonly worldBounds: Bounds;
  readonly vertices: readonly Point2D[];
  readonly edges: readonly WorldSegment[];
}

function buildSubjectGeometry(movingNodes: readonly DesignNode[]): SubjectGeometry | null {
  if (movingNodes.length === 0) return null;
  if (movingNodes.length === 1) {
    const geom = getNodeWorldGeometry(movingNodes[0]);
    return {
      worldBounds: geom.worldBounds,
      vertices: geom.vertices.length <= MAX_SUBJECT_VERTICES
        ? geom.vertices
        : geom.vertices.slice(0, MAX_SUBJECT_VERTICES),
      edges: geom.edges.length <= MAX_SUBJECT_EDGES
        ? geom.edges
        : geom.edges.slice(0, MAX_SUBJECT_EDGES),
    };
  }

  // For groups or multi-selections: union world bounds + outer corners/edges, plus
  // individual node vertices/edges when selection size is modest to keep O(1) bounded work.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const vertices: Point2D[] = [];
  const edges: WorldSegment[] = [];
  const includeMemberGeometry = movingNodes.length <= 6;

  for (let i = 0; i < movingNodes.length; i += 1) {
    const geom = getNodeWorldGeometry(movingNodes[i]);
    const wb = geom.worldBounds;
    if (wb.x < minX) minX = wb.x;
    if (wb.y < minY) minY = wb.y;
    if (wb.x + wb.width > maxX) maxX = wb.x + wb.width;
    if (wb.y + wb.height > maxY) maxY = wb.y + wb.height;
    if (includeMemberGeometry) {
      for (let v = 0; v < geom.vertices.length && vertices.length < MAX_SUBJECT_VERTICES - 4; v += 1) {
        vertices.push(geom.vertices[v]);
      }
      for (let e = 0; e < geom.edges.length && edges.length < MAX_SUBJECT_EDGES - 4; e += 1) {
        edges.push(geom.edges[e]);
      }
    }
  }

  const worldBounds: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };

  const outerCorners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  // Outer corners & edges always participate first for clean group snapping.
  const combinedVertices = [...outerCorners, ...vertices].slice(0, MAX_SUBJECT_VERTICES);
  const outerEdges: WorldSegment[] = [];
  for (let i = 0; i < 4; i += 1) {
    const seg = makeSegment(outerCorners[i], outerCorners[(i + 1) % 4]);
    if (seg) outerEdges.push(seg);
  }
  const combinedEdges = [...outerEdges, ...edges].slice(0, MAX_SUBJECT_EDGES);

  return {
    worldBounds,
    vertices: combinedVertices,
    edges: combinedEdges,
  };
}

function collectExcludedIds(
  movingNodes: readonly DesignNode[],
  nodeById: ReadonlyMap<string, DesignNode> | null | undefined,
  otherNodes: readonly DesignNode[] | undefined,
  allNodes: readonly DesignNode[] | undefined,
  explicitExclude: ReadonlySet<string> | readonly string[] | undefined,
  includeSelfAsTargets: boolean,
): Set<string> {
  const excluded = new Set<string>();
  if (explicitExclude) {
    for (const id of explicitExclude) excluded.add(id);
  }
  if (includeSelfAsTargets) return excluded;

  for (let i = 0; i < movingNodes.length; i += 1) {
    excluded.add(movingNodes[i].id);
  }

  // Expand all descendants of moving nodes so dragging a group/frame never self-snaps to its children.
  const sourcePool: Iterable<DesignNode> | null = allNodes
    ? allNodes
    : nodeById
      ? nodeById.values()
      : otherNodes ?? null;

  if (!sourcePool || excluded.size === 0) return excluded;

  // Build parent -> children adjacency only for nodes whose parentId might be relevant.
  // Single pass using ancestor chain walk when nodeById is available (O(N * depth), zero extra arrays).
  if (nodeById) {
    const checkList = allNodes ?? otherNodes;
    if (checkList) {
      for (let i = 0; i < checkList.length; i += 1) {
        const node = checkList[i];
        if (excluded.has(node.id)) continue;
        let parentId = node.parentId;
        let guard = 0;
        while (parentId && guard < 32) {
          if (excluded.has(parentId)) {
            excluded.add(node.id);
            break;
          }
          parentId = nodeById.get(parentId)?.parentId;
          guard += 1;
        }
      }
    } else {
      // Only check moving nodes' direct children via nodeById if we didn't get a list,
      // and for safety iterate nodeById only if small or if any moving node is a container/group.
      const hasContainer = movingNodes.some((n) => n.type === 'group' || n.type === 'frame');
      if (hasContainer) {
        for (const node of nodeById.values()) {
          if (excluded.has(node.id)) continue;
          let parentId = node.parentId;
          let guard = 0;
          while (parentId && guard < 32) {
            if (excluded.has(parentId)) {
              excluded.add(node.id);
              break;
            }
            parentId = nodeById.get(parentId)?.parentId;
            guard += 1;
          }
        }
      }
    }
    return excluded;
  }

  // Fallback without nodeById map: build quick parent lookup from sourcePool.
  const lookup = new Map<string, DesignNode>();
  for (const node of sourcePool) lookup.set(node.id, node);
  for (const node of lookup.values()) {
    if (excluded.has(node.id)) continue;
    let parentId = node.parentId;
    let guard = 0;
    while (parentId && guard < 32) {
      if (excluded.has(parentId)) {
        excluded.add(node.id);
        break;
      }
      parentId = lookup.get(parentId)?.parentId;
      guard += 1;
    }
  }
  return excluded;
}

interface ContainerContext {
  readonly id: string;
  readonly outerBounds: Bounds;
  readonly contentBounds: Bounds;
  readonly hasExplicitPadding: boolean;
  readonly isArtboard: boolean;
}

function resolveContainerContext(
  movingNodes: readonly DesignNode[],
  artboard: Bounds,
  nodeById: ReadonlyMap<string, DesignNode> | null | undefined,
  otherNodes: readonly DesignNode[] | undefined,
  excludedIds: ReadonlySet<string>,
): ContainerContext {
  const movingSet = new Set(movingNodes.map((n) => n.id));
  const roots = movingNodes.filter((n) => !n.parentId || !movingSet.has(n.parentId));
  const sharedParentId = roots.length > 0 && roots[0].parentId
    ? (roots.every((r) => r.parentId === roots[0].parentId) ? roots[0].parentId : null)
    : null;

  if (sharedParentId && !excludedIds.has(sharedParentId)) {
    const parent = nodeById?.get(sharedParentId) ?? otherNodes?.find((n) => n.id === sharedParentId);
    if (parent && parent.onCanvas !== false) {
      const outerBounds = getNodeWorldGeometry(parent).worldBounds;
      const pad = parent.layout?.padding;
      const padLeft = Math.max(0, pad?.left ?? 0);
      const padRight = Math.max(0, pad?.right ?? 0);
      const padTop = Math.max(0, pad?.top ?? 0);
      const padBottom = Math.max(0, pad?.bottom ?? 0);
      const hasExplicitPadding = padLeft > 0 || padRight > 0 || padTop > 0 || padBottom > 0;
      const contentWidth = Math.max(0, outerBounds.width - padLeft - padRight);
      const contentHeight = Math.max(0, outerBounds.height - padTop - padBottom);
      return {
        id: parent.id,
        outerBounds,
        contentBounds: {
          x: outerBounds.x + padLeft,
          y: outerBounds.y + padTop,
          width: contentWidth,
          height: contentHeight,
        },
        hasExplicitPadding,
        isArtboard: false,
      };
    }
  }

  return {
    id: '__artboard__',
    outerBounds: artboard,
    contentBounds: artboard,
    hasExplicitPadding: false,
    isArtboard: true,
  };
}

function isNodeVisibleForSnap(
  node: DesignNode,
  layerStates: ReadonlyMap<string, EffectiveLayerState> | null | undefined,
): boolean {
  if (node.onCanvas === false) return false;
  if (node.visible === false) return false;
  if (layerStates) {
    const state = layerStates.get(node.id);
    if (state && !state.visible) return false;
  }
  return true;
}

interface CandidateQueryResult {
  readonly localNodes: DesignNode[];
  readonly axialNodes: DesignNode[];
  readonly totalInspected: number;
  readonly spatialQueryMs: number;
  readonly usedSpatialIndex: boolean;
}

function distSqToRectCenter(node: DesignNode, cx: number, cy: number): number {
  const ncx = node.x + node.width * 0.5;
  const ncy = node.y + node.height * 0.5;
  const dx = ncx - cx;
  const dy = ncy - cy;
  return dx * dx + dy * dy;
}

function queryCandidates(
  subjectRect: SpatialQueryRect,
  artboard: Bounds,
  releaseTol: number,
  spatialIndex: SpatialIndexHandle | null | undefined,
  nodeById: ReadonlyMap<string, DesignNode> | null | undefined,
  layerStates: ReadonlyMap<string, EffectiveLayerState> | null | undefined,
  otherNodes: readonly DesignNode[] | undefined,
  excludedIds: ReadonlySet<string>,
  parentContainerId: string | null,
  collectMetrics: boolean,
): CandidateQueryResult {
  const t0 = collectMetrics ? nowMs() : 0;
  const subjectW = Math.max(1, subjectRect.maxX - subjectRect.minX);
  const subjectH = Math.max(1, subjectRect.maxY - subjectRect.minY);
  const subjectCx = (subjectRect.minX + subjectRect.maxX) * 0.5;
  const subjectCy = (subjectRect.minY + subjectRect.maxY) * 0.5;

  // Local neighborhood margin covers nearby geometry, diagonal edges, and equal-spacing neighbors.
  const localMargin = Math.max(releaseTol + 36, Math.min(340, Math.max(subjectW, subjectH) * 2 + 160));
  const corridorSpan = Math.min(1400, Math.max(artboard.width, artboard.height, 800));

  if (spatialIndex && nodeById) {
    const localIds = spatialIndex.querySnapCandidates(subjectRect, localMargin, excludedIds);
    const verticalCorridorIds = spatialIndex.querySnapCandidates(
      {
        minX: subjectRect.minX,
        maxX: subjectRect.maxX,
        minY: subjectRect.minY - corridorSpan,
        maxY: subjectRect.maxY + corridorSpan,
      },
      releaseTol + 4,
      excludedIds,
    );
    const horizontalCorridorIds = spatialIndex.querySnapCandidates(
      {
        minX: subjectRect.minX - corridorSpan,
        maxX: subjectRect.maxX + corridorSpan,
        minY: subjectRect.minY,
        maxY: subjectRect.maxY,
      },
      releaseTol + 4,
      excludedIds,
    );

    const localSeen = new Set<string>();
    const localNodes: DesignNode[] = [];
    for (let i = 0; i < localIds.length; i += 1) {
      const id = localIds[i];
      if (localSeen.has(id) || excludedIds.has(id)) continue;
      const node = nodeById.get(id);
      if (!node || !isNodeVisibleForSnap(node, layerStates)) continue;
      localSeen.add(id);
      localNodes.push(node);
    }

    if (parentContainerId && parentContainerId !== '__artboard__' && !localSeen.has(parentContainerId) && !excludedIds.has(parentContainerId)) {
      const parentNode = nodeById.get(parentContainerId);
      if (parentNode && isNodeVisibleForSnap(parentNode, layerStates)) {
        localSeen.add(parentContainerId);
        localNodes.push(parentNode);
      }
    }

    // Bound local candidates in pathological densely-stacked scenes by keeping nearest nodes deterministically.
    let boundedLocal = localNodes;
    if (localNodes.length > MAX_LOCAL_CANDIDATES) {
      boundedLocal = [...localNodes]
        .sort((a, b) => {
          const da = distSqToRectCenter(a, subjectCx, subjectCy);
          const db = distSqToRectCenter(b, subjectCx, subjectCy);
          return da - db || a.id.localeCompare(b.id);
        })
        .slice(0, MAX_LOCAL_CANDIDATES);
    }

    const axialSeen = new Set<string>(boundedLocal.map((n) => n.id));
    const axialExtras: DesignNode[] = [];
    const addCorridorIds = (ids: readonly string[]) => {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        if (axialSeen.has(id) || excludedIds.has(id)) continue;
        const node = nodeById.get(id);
        if (!node || !isNodeVisibleForSnap(node, layerStates)) continue;
        axialSeen.add(id);
        axialExtras.push(node);
      }
    };
    addCorridorIds(verticalCorridorIds);
    addCorridorIds(horizontalCorridorIds);

    let boundedExtras = axialExtras;
    if (axialExtras.length > MAX_CORRIDOR_CANDIDATES) {
      boundedExtras = [...axialExtras]
        .sort((a, b) => {
          const da = distSqToRectCenter(a, subjectCx, subjectCy);
          const db = distSqToRectCenter(b, subjectCx, subjectCy);
          return da - db || a.id.localeCompare(b.id);
        })
        .slice(0, MAX_CORRIDOR_CANDIDATES);
    }

    const axialNodes = boundedExtras.length > 0 ? [...boundedLocal, ...boundedExtras] : boundedLocal;
    const elapsed = collectMetrics ? nowMs() - t0 : 0;
    return {
      localNodes: boundedLocal,
      axialNodes,
      totalInspected: axialNodes.length,
      spatialQueryMs: elapsed,
      usedSpatialIndex: true,
    };
  }

  // Fallback path when called without a spatial index (e.g. legacy direct calls).
  const pool = otherNodes ?? (nodeById ? Array.from(nodeById.values()) : []);
  const filtered: DesignNode[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    const node = pool[i];
    if (excludedIds.has(node.id)) continue;
    if (!isNodeVisibleForSnap(node, layerStates)) continue;
    filtered.push(node);
  }
  const elapsed = collectMetrics ? nowMs() - t0 : 0;
  return {
    localNodes: filtered,
    axialNodes: filtered,
    totalInspected: filtered.length,
    spatialQueryMs: elapsed,
    usedSpatialIndex: false,
  };
}

interface AxisCandidate {
  readonly id: string;
  readonly axis: 'x' | 'y';
  readonly kind: SnapLayerKind;
  readonly priority: number;
  readonly snappedDelta: number;
  readonly targetPosition: number;
  readonly distance: number;
  readonly screenDistance: number;
  readonly guide: SnapGuide;
}

interface CoupledCandidate {
  readonly id: string;
  readonly kind: SnapLayerKind;
  readonly priority: number;
  readonly mode: 'point' | 'line';
  readonly snappedDx: number;
  readonly snappedDy: number;
  readonly distance: number;
  readonly screenDistance: number;
  readonly guides: readonly SnapGuide[];
  readonly lockData: SnapCoupledLock;
}

function isBetterAxisCandidate(next: AxisCandidate, current: AxisCandidate | null): boolean {
  if (!current) return true;
  if (next.priority !== current.priority) return next.priority < current.priority;
  const distDiff = next.screenDistance - current.screenDistance;
  if (Math.abs(distDiff) > DIST_TIE_EPS) return distDiff < 0;
  return next.id.localeCompare(current.id) < 0;
}

function isBetterCoupledCandidate(next: CoupledCandidate, current: CoupledCandidate | null): boolean {
  if (!current) return true;
  if (next.priority !== current.priority) return next.priority < current.priority;
  const distDiff = next.screenDistance - current.screenDistance;
  if (Math.abs(distDiff) > DIST_TIE_EPS) return distDiff < 0;
  return next.id.localeCompare(current.id) < 0;
}

function resolveThresholds(
  canvasUnitsPerPixel: number | undefined,
  toleranceOverride: number | undefined,
): { entryTol: number; releaseTol: number; unitsPerPx: number } {
  const unitsPerPx =
    typeof canvasUnitsPerPixel === 'number' && Number.isFinite(canvasUnitsPerPixel) && canvasUnitsPerPixel > 0
      ? canvasUnitsPerPixel
      : 1;

  if (typeof toleranceOverride === 'number' && Number.isFinite(toleranceOverride)) {
    const entryTol = Math.max(0, toleranceOverride);
    const releaseTol = entryTol * (SNAP_RELEASE_SCREEN_PX / SNAP_ENTRY_SCREEN_PX);
    return { entryTol, releaseTol, unitsPerPx };
  }

  return {
    entryTol: SNAP_ENTRY_SCREEN_PX * unitsPerPx,
    releaseTol: SNAP_RELEASE_SCREEN_PX * unitsPerPx,
    unitsPerPx,
  };
}

function isBoundsEnclosing(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.x <= inner.x + 0.5 &&
    outer.x + outer.width >= inner.x + inner.width - 0.5 &&
    outer.y <= inner.y + 0.5 &&
    outer.y + outer.height >= inner.y + inner.height - 0.5
  );
}

/**
 * Unified translation snapping solver used by both Main Canvas and Component Canvas.
 */
export function solveTranslationSnap(input: TranslationSnapInput): TranslationSnapOutput {
  const tStart = input.collectMetrics ? nowMs() : 0;
  if (input.bypass || input.movingNodes.length === 0) {
    return {
      dx: input.dx,
      dy: input.dy,
      guides: [],
      nextLock: null,
      ...(input.collectMetrics
        ? {
            metrics: {
              candidatesInspected: 0,
              spatialQueryMs: 0,
              snapCalcMs: nowMs() - tStart,
              usedSpatialIndex: Boolean(input.spatialIndex),
              guideCount: 0,
            },
          }
        : {}),
    };
  }

  const { entryTol, releaseTol, unitsPerPx } = resolveThresholds(
    input.canvasUnitsPerPixel,
    input.toleranceOverride,
  );
  if (entryTol <= 0) {
    return {
      dx: input.dx,
      dy: input.dy,
      guides: [],
      nextLock: null,
      ...(input.collectMetrics
        ? {
            metrics: {
              candidatesInspected: 0,
              spatialQueryMs: 0,
              snapCalcMs: nowMs() - tStart,
              usedSpatialIndex: Boolean(input.spatialIndex),
              guideCount: 0,
            },
          }
        : {}),
    };
  }

  const subject = buildSubjectGeometry(input.movingNodes);
  if (!subject) {
    return { dx: input.dx, dy: input.dy, guides: [], nextLock: null };
  }

  const profile: SnapProfile = input.profile ?? 'main';
  const rawDx = input.dx;
  const rawDy = input.dy;
  const lockAxis = input.lockAxis ?? null;
  const allowX = lockAxis !== 'y';
  const allowY = lockAxis !== 'x';
  const allowCoupled = lockAxis === null;

  const startBounds = subject.worldBounds;
  const rawBounds: Bounds = {
    x: startBounds.x + rawDx,
    y: startBounds.y + rawDy,
    width: startBounds.width,
    height: startBounds.height,
  };
  const rawRight = rawBounds.x + rawBounds.width;
  const rawBottom = rawBounds.y + rawBounds.height;
  const rawCenterX = rawBounds.x + rawBounds.width * 0.5;
  const rawCenterY = rawBounds.y + rawBounds.height * 0.5;

  const excludedIds = collectExcludedIds(
    input.movingNodes,
    input.nodeById,
    input.otherNodes,
    input.allNodes,
    input.excludeIds,
    Boolean(input.includeSelfAsTargets),
  );

  const containerCtx = resolveContainerContext(
    input.movingNodes,
    input.artboard,
    input.nodeById,
    input.otherNodes,
    excludedIds,
  );

  const queried = queryCandidates(
    {
      minX: rawBounds.x,
      minY: rawBounds.y,
      maxX: rawRight,
      maxY: rawBottom,
    },
    input.artboard,
    releaseTol,
    input.spatialIndex,
    input.nodeById,
    input.layerStates,
    input.otherNodes,
    excludedIds,
    containerCtx.isArtboard ? null : containerCtx.id,
    Boolean(input.collectMetrics),
  );

  const prevLock = input.previousLock ?? null;
  const prevXLockId = prevLock?.x?.id ?? null;
  const prevYLockId = prevLock?.y?.id ?? null;
  const prevCoupledLock = prevLock?.coupled ?? null;

  let bestX: AxisCandidate | null = null;
  let bestY: AxisCandidate | null = null;
  let bestCoupled: CoupledCandidate | null = null;

  const considerAxis = (
    id: string,
    axis: 'x' | 'y',
    kind: SnapLayerKind,
    basePriority: number,
    snappedDelta: number,
    targetPosition: number,
    guide: SnapGuide,
  ) => {
    if (axis === 'x' && !allowX) return;
    if (axis === 'y' && !allowY) return;
    const rawDelta = axis === 'x' ? rawDx : rawDy;
    const distance = Math.abs(snappedDelta - rawDelta);
    const isLockedMatch = axis === 'x' ? id === prevXLockId : id === prevYLockId;
    const maxTol = isLockedMatch ? releaseTol : entryTol;
    if (distance > maxTol + 1e-6) return;

    const candidate: AxisCandidate = {
      id,
      axis,
      kind,
      priority: isLockedMatch ? PRIORITY_ACTIVE_LOCK : basePriority,
      snappedDelta: roundSnapValue(snappedDelta),
      targetPosition: roundSnapValue(targetPosition),
      distance,
      screenDistance: distance / unitsPerPx,
      guide,
    };
    if (axis === 'x') {
      if (isBetterAxisCandidate(candidate, bestX)) bestX = candidate;
    } else {
      if (isBetterAxisCandidate(candidate, bestY)) bestY = candidate;
    }
  };

  const considerCoupled = (
    id: string,
    kind: SnapLayerKind,
    basePriority: number,
    mode: 'point' | 'line',
    snappedDx: number,
    snappedDy: number,
    guides: readonly SnapGuide[],
    lockData: Omit<SnapCoupledLock, 'id' | 'kind' | 'priority' | 'mode' | 'snappedDx' | 'snappedDy'>,
  ) => {
    if (!allowCoupled) return;
    const distance = Math.hypot(snappedDx - rawDx, snappedDy - rawDy);
    const isLockedMatch = prevCoupledLock?.id === id;
    const maxTol = isLockedMatch ? releaseTol : entryTol;
    if (distance > maxTol + 1e-6) return;

    const priority = isLockedMatch ? PRIORITY_ACTIVE_LOCK : basePriority;
    const roundedDx = roundSnapValue(snappedDx);
    const roundedDy = roundSnapValue(snappedDy);
    const candidate: CoupledCandidate = {
      id,
      kind,
      priority,
      mode,
      snappedDx: roundedDx,
      snappedDy: roundedDy,
      distance,
      screenDistance: distance / unitsPerPx,
      guides,
      lockData: {
        id,
        kind,
        priority: basePriority,
        mode,
        snappedDx: roundedDx,
        snappedDy: roundedDy,
        ...lockData,
      },
    };
    if (isBetterCoupledCandidate(candidate, bestCoupled)) {
      bestCoupled = candidate;
    }
  };

  // Preserve active diagonal slide lock smoothly when sliding along the locked slanted edge.
  if (
    allowCoupled &&
    prevCoupledLock &&
    prevCoupledLock.mode === 'line' &&
    prevCoupledLock.linePoint &&
    prevCoupledLock.dir &&
    prevCoupledLock.normal &&
    prevCoupledLock.subjectStartPoint
  ) {
    const px = prevCoupledLock.subjectStartPoint.x + rawDx;
    const py = prevCoupledLock.subjectStartPoint.y + rawDy;
    const signedPerp =
      (px - prevCoupledLock.linePoint.x) * prevCoupledLock.normal.x +
      (py - prevCoupledLock.linePoint.y) * prevCoupledLock.normal.y;
    if (Math.abs(signedPerp) <= releaseTol + 1e-6) {
      const snappedDx = rawDx - signedPerp * prevCoupledLock.normal.x;
      const snappedDy = rawDy - signedPerp * prevCoupledLock.normal.y;
      const projPt: Point2D = {
        x: px - signedPerp * prevCoupledLock.normal.x,
        y: py - signedPerp * prevCoupledLock.normal.y,
      };
      const segA = prevCoupledLock.segmentA ?? prevCoupledLock.linePoint;
      const segB = prevCoupledLock.segmentB ?? projPt;
      const tA = (segA.x - prevCoupledLock.linePoint.x) * prevCoupledLock.dir.x + (segA.y - prevCoupledLock.linePoint.y) * prevCoupledLock.dir.y;
      const tB = (segB.x - prevCoupledLock.linePoint.x) * prevCoupledLock.dir.x + (segB.y - prevCoupledLock.linePoint.y) * prevCoupledLock.dir.y;
      const tP = (projPt.x - prevCoupledLock.linePoint.x) * prevCoupledLock.dir.x + (projPt.y - prevCoupledLock.linePoint.y) * prevCoupledLock.dir.y;
      const minT = Math.min(tA, tB, tP) - GUIDE_OVERHANG_PX * unitsPerPx;
      const maxT = Math.max(tA, tB, tP) + GUIDE_OVERHANG_PX * unitsPerPx;
      const gx1 = prevCoupledLock.linePoint.x + prevCoupledLock.dir.x * minT;
      const gy1 = prevCoupledLock.linePoint.y + prevCoupledLock.dir.y * minT;
      const gx2 = prevCoupledLock.linePoint.x + prevCoupledLock.dir.x * maxT;
      const gy2 = prevCoupledLock.linePoint.y + prevCoupledLock.dir.y * maxT;
      const position = roundSnapValue(
        prevCoupledLock.linePoint.x * prevCoupledLock.normal.x +
        prevCoupledLock.linePoint.y * prevCoupledLock.normal.y,
      );
      considerCoupled(
        prevCoupledLock.id,
        prevCoupledLock.kind,
        prevCoupledLock.priority,
        'line',
        snappedDx,
        snappedDy,
        [
          {
            axis: 'diagonal',
            position,
            x1: roundSnapValue(gx1),
            y1: roundSnapValue(gy1),
            x2: roundSnapValue(gx2),
            y2: roundSnapValue(gy2),
            kind: prevCoupledLock.kind,
            marker: { x: roundSnapValue(projPt.x), y: roundSnapValue(projPt.y), kind: 'edge-point' },
          },
        ],
        {
          linePoint: prevCoupledLock.linePoint,
          dir: prevCoupledLock.dir,
          normal: prevCoupledLock.normal,
          subjectStartPoint: prevCoupledLock.subjectStartPoint,
          segmentA: segA,
          segmentB: segB,
        },
      );
    }
  }

  // Precompute translated subject vertices and edges once for Layer 2 & Layer 4.
  const movedVertices: Point2D[] = new Array(subject.vertices.length);
  for (let i = 0; i < subject.vertices.length; i += 1) {
    movedVertices[i] = {
      x: subject.vertices[i].x + rawDx,
      y: subject.vertices[i].y + rawDy,
    };
  }

  const localGeoms: NodeWorldGeometry[] = new Array(queried.localNodes.length);
  for (let i = 0; i < queried.localNodes.length; i += 1) {
    localGeoms[i] = getNodeWorldGeometry(queried.localNodes[i]);
  }

  const overhang = GUIDE_OVERHANG_PX * unitsPerPx;

  // =========================================================================
  // LAYER 2: GEOMETRY SNAPPING (Vertex-to-Vertex, Vertex-to-Edge, Edge-to-Edge)
  // & LAYER 4B: DIAGONAL EDGE / LINE ALIGNMENT
  // =========================================================================
  for (let c = 0; c < localGeoms.length; c += 1) {
    const target = localGeoms[c];
    const tb = target.worldBounds;
    const targetMinX = tb.x;
    const targetMaxX = tb.x + tb.width;
    const targetMinY = tb.y;
    const targetMaxY = tb.y + tb.height;

    const withinLocalGeomRange =
      rawBounds.x <= targetMaxX + releaseTol + 4 &&
      rawRight >= targetMinX - releaseTol - 4 &&
      rawBounds.y <= targetMaxY + releaseTol + 4 &&
      rawBottom >= targetMinY - releaseTol - 4;

    if (withinLocalGeomRange) {
      // 2A. Vertex-to-Vertex (2D coupled exact corner/anchor joining)
      if (allowCoupled) {
        for (let svIdx = 0; svIdx < movedVertices.length; svIdx += 1) {
          const sv = movedVertices[svIdx];
          for (let tvIdx = 0; tvIdx < target.vertices.length; tvIdx += 1) {
            const tv = target.vertices[tvIdx];
            const ddx = tv.x - sv.x;
            const ddy = tv.y - sv.y;
            if (Math.abs(ddx) > releaseTol + 1e-6 || Math.abs(ddy) > releaseTol + 1e-6) continue;
            const dist = Math.hypot(ddx, ddy);
            if (dist > releaseTol + 1e-6) continue;

            const spanMinY = Math.min(rawBounds.y + ddy, targetMinY) - overhang;
            const spanMaxY = Math.max(rawBottom + ddy, targetMaxY) + overhang;
            const spanMinX = Math.min(rawBounds.x + ddx, targetMinX) - overhang;
            const spanMaxX = Math.max(rawRight + ddx, targetMaxX) + overhang;

            considerCoupled(
              `geom:v2v:${target.id}:${svIdx}:${tvIdx}`,
              'geometry',
              PRIORITY_GEOMETRY,
              'point',
              rawDx + ddx,
              rawDy + ddy,
              [
                {
                  axis: 'x',
                  position: roundSnapValue(tv.x),
                  x1: roundSnapValue(tv.x),
                  y1: roundSnapValue(spanMinY),
                  x2: roundSnapValue(tv.x),
                  y2: roundSnapValue(spanMaxY),
                  kind: 'geometry',
                  marker: { x: roundSnapValue(tv.x), y: roundSnapValue(tv.y), kind: 'vertex' },
                },
                {
                  axis: 'y',
                  position: roundSnapValue(tv.y),
                  x1: roundSnapValue(spanMinX),
                  y1: roundSnapValue(tv.y),
                  x2: roundSnapValue(spanMaxX),
                  y2: roundSnapValue(tv.y),
                  kind: 'geometry',
                },
              ],
              {},
            );
          }
        }
      }

      // 2B. Vertex-to-Edge (exact perpendicular projection onto target segment)
      for (let eIdx = 0; eIdx < target.edges.length; eIdx += 1) {
        const edge = target.edges[eIdx];
        if (
          rawBounds.x > edge.maxX + releaseTol + 2 ||
          rawRight < edge.minX - releaseTol - 2 ||
          rawBounds.y > edge.maxY + releaseTol + 2 ||
          rawBottom < edge.minY - releaseTol - 2
        ) {
          continue;
        }

        for (let svIdx = 0; svIdx < movedVertices.length; svIdx += 1) {
          const sv = movedVertices[svIdx];
          const relX = sv.x - edge.a.x;
          const relY = sv.y - edge.a.y;
          const tAlong = relX * edge.dirX + relY * edge.dirY;
          if (tAlong < -0.5 || tAlong > edge.length + 0.5) continue;

          const clampedT = Math.max(0, Math.min(edge.length, tAlong));
          const projX = edge.a.x + edge.dirX * clampedT;
          const projY = edge.a.y + edge.dirY * clampedT;
          const ddx = projX - sv.x;
          const ddy = projY - sv.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist > releaseTol + 1e-6) continue;

          if (edge.isVertical) {
            const xPos = edge.a.x;
            considerAxis(
              `geom:v2e:x:${target.id}:${svIdx}:${eIdx}`,
              'x',
              'geometry',
              PRIORITY_GEOMETRY,
              rawDx + (xPos - sv.x),
              xPos,
              {
                axis: 'x',
                position: roundSnapValue(xPos),
                x1: roundSnapValue(xPos),
                y1: roundSnapValue(Math.min(edge.minY, sv.y) - overhang),
                x2: roundSnapValue(xPos),
                y2: roundSnapValue(Math.max(edge.maxY, sv.y) + overhang),
                kind: 'geometry',
                marker: { x: roundSnapValue(xPos), y: roundSnapValue(projY), kind: 'edge-point' },
              },
            );
          } else if (edge.isHorizontal) {
            const yPos = edge.a.y;
            considerAxis(
              `geom:v2e:y:${target.id}:${svIdx}:${eIdx}`,
              'y',
              'geometry',
              PRIORITY_GEOMETRY,
              rawDy + (yPos - sv.y),
              yPos,
              {
                axis: 'y',
                position: roundSnapValue(yPos),
                x1: roundSnapValue(Math.min(edge.minX, sv.x) - overhang),
                y1: roundSnapValue(yPos),
                x2: roundSnapValue(Math.max(edge.maxX, sv.x) + overhang),
                y2: roundSnapValue(yPos),
                kind: 'geometry',
                marker: { x: roundSnapValue(projX), y: roundSnapValue(yPos), kind: 'edge-point' },
              },
            );
          } else if (allowCoupled) {
            const gx1 = edge.a.x - edge.dirX * overhang;
            const gy1 = edge.a.y - edge.dirY * overhang;
            const gx2 = edge.b.x + edge.dirX * overhang;
            const gy2 = edge.b.y + edge.dirY * overhang;
            const linePos = edge.a.x * edge.normalX + edge.a.y * edge.normalY;
            considerCoupled(
              `geom:v2e:diag:${target.id}:${svIdx}:${eIdx}`,
              'geometry',
              PRIORITY_GEOMETRY,
              'line',
              rawDx + ddx,
              rawDy + ddy,
              [
                {
                  axis: 'diagonal',
                  position: roundSnapValue(linePos),
                  x1: roundSnapValue(gx1),
                  y1: roundSnapValue(gy1),
                  x2: roundSnapValue(gx2),
                  y2: roundSnapValue(gy2),
                  kind: 'geometry',
                  marker: { x: roundSnapValue(projX), y: roundSnapValue(projY), kind: 'edge-point' },
                },
              ],
              {
                linePoint: edge.a,
                dir: { x: edge.dirX, y: edge.dirY },
                normal: { x: edge.normalX, y: edge.normalY },
                subjectStartPoint: subject.vertices[svIdx],
                segmentA: edge.a,
                segmentB: edge.b,
              },
            );
          }
        }
      }

      // 2C. Edge-to-Edge (parallel touching or collinear edges)
      for (let seIdx = 0; seIdx < subject.edges.length; seIdx += 1) {
        const se = subject.edges[seIdx];
        const seAx = se.a.x + rawDx;
        const seAy = se.a.y + rawDy;
        const seBx = se.b.x + rawDx;
        const seBy = se.b.y + rawDy;

        for (let teIdx = 0; teIdx < target.edges.length; teIdx += 1) {
          const te = target.edges[teIdx];
          const cross = Math.abs(se.dirX * te.dirY - se.dirY * te.dirX);
          if (cross > PARALLEL_CROSS_EPS) continue;

          const signedPerp = (seAx - te.a.x) * te.normalX + (seAy - te.a.y) * te.normalY;
          if (Math.abs(signedPerp) > releaseTol + 1e-6) continue;

          // Verify longitudinal overlap or close proximity along edge direction so touching edges get priority 1.
          const t0 = (seAx - te.a.x) * te.dirX + (seAy - te.a.y) * te.dirY;
          const t1 = (seBx - te.a.x) * te.dirX + (seBy - te.a.y) * te.dirY;
          const sMinT = Math.min(t0, t1);
          const sMaxT = Math.max(t0, t1);
          const overlapsLongitudinal = sMaxT >= -releaseTol && sMinT <= te.length + releaseTol;
          if (!overlapsLongitudinal) continue;

          if (te.isVertical) {
            const xPos = te.a.x;
            const ddx = xPos - seAx;
            const minY = Math.min(te.minY, seAy, seBy) - overhang;
            const maxY = Math.max(te.maxY, seAy, seBy) + overhang;
            considerAxis(
              `geom:e2e:x:${target.id}:${seIdx}:${teIdx}`,
              'x',
              'geometry',
              PRIORITY_GEOMETRY,
              rawDx + ddx,
              xPos,
              {
                axis: 'x',
                position: roundSnapValue(xPos),
                x1: roundSnapValue(xPos),
                y1: roundSnapValue(minY),
                x2: roundSnapValue(xPos),
                y2: roundSnapValue(maxY),
                kind: 'geometry',
              },
            );
          } else if (te.isHorizontal) {
            const yPos = te.a.y;
            const ddy = yPos - seAy;
            const minX = Math.min(te.minX, seAx, seBx) - overhang;
            const maxX = Math.max(te.maxX, seAx, seBx) + overhang;
            considerAxis(
              `geom:e2e:y:${target.id}:${seIdx}:${teIdx}`,
              'y',
              'geometry',
              PRIORITY_GEOMETRY,
              rawDy + ddy,
              yPos,
              {
                axis: 'y',
                position: roundSnapValue(yPos),
                x1: roundSnapValue(minX),
                y1: roundSnapValue(yPos),
                x2: roundSnapValue(maxX),
                y2: roundSnapValue(yPos),
                kind: 'geometry',
              },
            );
          } else if (allowCoupled) {
            const ddx = -signedPerp * te.normalX;
            const ddy = -signedPerp * te.normalY;
            const minT = Math.min(0, sMinT) - overhang;
            const maxT = Math.max(te.length, sMaxT) + overhang;
            const gx1 = te.a.x + te.dirX * minT;
            const gy1 = te.a.y + te.dirY * minT;
            const gx2 = te.a.x + te.dirX * maxT;
            const gy2 = te.a.y + te.dirY * maxT;
            const linePos = te.a.x * te.normalX + te.a.y * te.normalY;
            considerCoupled(
              `geom:e2e:diag:${target.id}:${seIdx}:${teIdx}`,
              'diagonal',
              PRIORITY_GEOMETRY,
              'line',
              rawDx + ddx,
              rawDy + ddy,
              [
                {
                  axis: 'diagonal',
                  position: roundSnapValue(linePos),
                  x1: roundSnapValue(gx1),
                  y1: roundSnapValue(gy1),
                  x2: roundSnapValue(gx2),
                  y2: roundSnapValue(gy2),
                  kind: 'diagonal',
                },
              ],
              {
                linePoint: te.a,
                dir: { x: te.dirX, y: te.dirY },
                normal: { x: te.normalX, y: te.normalY },
                subjectStartPoint: se.a,
                segmentA: te.a,
                segmentB: te.b,
              },
            );
          }
        }
      }
    }

    // 4B. Diagonal line alignment along extended slanted edges (beyond segment endpoints)
    if (allowCoupled && target.hasSlantedEdges) {
      for (let eIdx = 0; eIdx < target.edges.length; eIdx += 1) {
        const edge = target.edges[eIdx];
        if (!edge.isSlanted) continue;

        // Test moving subject vertices & center against extended diagonal line.
        const testPoints: { pt: Point2D; startPt: Point2D; tag: string }[] = [
          {
            pt: { x: rawCenterX, y: rawCenterY },
            startPt: { x: startBounds.x + startBounds.width * 0.5, y: startBounds.y + startBounds.height * 0.5 },
            tag: 'center',
          },
        ];
        for (let vIdx = 0; vIdx < Math.min(movedVertices.length, 8); vIdx += 1) {
          testPoints.push({
            pt: movedVertices[vIdx],
            startPt: subject.vertices[vIdx],
            tag: `v${vIdx}`,
          });
        }

        for (let pIdx = 0; pIdx < testPoints.length; pIdx += 1) {
          const { pt, startPt, tag } = testPoints[pIdx];
          const relX = pt.x - edge.a.x;
          const relY = pt.y - edge.a.y;
          const signedPerp = relX * edge.normalX + relY * edge.normalY;
          if (Math.abs(signedPerp) > releaseTol + 1e-6) continue;

          const tAlong = relX * edge.dirX + relY * edge.dirY;
          // Skip on-segment vertices already handled with higher priority in Layer 2B.
          if (tag !== 'center' && tAlong >= -0.5 && tAlong <= edge.length + 0.5) continue;
          if (tAlong < -DIAGONAL_EXTENSION_LIMIT || tAlong > edge.length + DIAGONAL_EXTENSION_LIMIT) continue;

          const ddx = -signedPerp * edge.normalX;
          const ddy = -signedPerp * edge.normalY;
          const projX = pt.x + ddx;
          const projY = pt.y + ddy;
          const minT = Math.min(0, tAlong) - overhang;
          const maxT = Math.max(edge.length, tAlong) + overhang;
          const gx1 = edge.a.x + edge.dirX * minT;
          const gy1 = edge.a.y + edge.dirY * minT;
          const gx2 = edge.a.x + edge.dirX * maxT;
          const gy2 = edge.a.y + edge.dirY * maxT;
          const linePos = edge.a.x * edge.normalX + edge.a.y * edge.normalY;

          considerCoupled(
            `diag:line:${target.id}:${eIdx}:${tag}`,
            'diagonal',
            PRIORITY_ALIGNMENT,
            'line',
            rawDx + ddx,
            rawDy + ddy,
            [
              {
                axis: 'diagonal',
                position: roundSnapValue(linePos),
                x1: roundSnapValue(gx1),
                y1: roundSnapValue(gy1),
                x2: roundSnapValue(gx2),
                y2: roundSnapValue(gy2),
                kind: 'diagonal',
                marker: { x: roundSnapValue(projX), y: roundSnapValue(projY), kind: 'edge-point' },
              },
            ],
            {
              linePoint: edge.a,
              dir: { x: edge.dirX, y: edge.dirY },
              normal: { x: edge.normalX, y: edge.normalY },
              subjectStartPoint: startPt,
              segmentA: edge.a,
              segmentB: edge.b,
            },
          );
        }
      }
    }
  }

  // =========================================================================
  // LAYER 4A: AXIAL OBJECT & ARTBOARD ALIGNMENT (Priority 2)
  // =========================================================================
  const subjectXAnchors: readonly { readonly value: number; readonly name: string }[] = [
    { value: rawBounds.x, name: 'l' },
    { value: rawCenterX, name: 'c' },
    { value: rawRight, name: 'r' },
  ];
  const subjectYAnchors: readonly { readonly value: number; readonly name: string }[] = [
    { value: rawBounds.y, name: 't' },
    { value: rawCenterY, name: 'm' },
    { value: rawBottom, name: 'b' },
  ];

  // Artboard outer edges (active breakpoint effectiveDocWidth x docHeight)
  const artboardXEdges: readonly { readonly value: number; readonly name: string }[] = [
    { value: input.artboard.x, name: 'left' },
    { value: input.artboard.x + input.artboard.width, name: 'right' },
  ];
  const artboardYEdges: readonly { readonly value: number; readonly name: string }[] = [
    { value: input.artboard.y, name: 'top' },
    { value: input.artboard.y + input.artboard.height, name: 'bottom' },
  ];

  if (allowX) {
    for (const sa of subjectXAnchors) {
      for (const ae of artboardXEdges) {
        const adj = ae.value - sa.value;
        if (Math.abs(adj) > releaseTol + 1e-6) continue;
        considerAxis(
          `align:artboard:x:${ae.name}:${sa.name}`,
          'x',
          'alignment',
          PRIORITY_ALIGNMENT,
          rawDx + adj,
          ae.value,
          {
            axis: 'x',
            position: roundSnapValue(ae.value),
            x1: roundSnapValue(ae.value),
            y1: roundSnapValue(input.artboard.y),
            x2: roundSnapValue(ae.value),
            y2: roundSnapValue(input.artboard.y + input.artboard.height),
            kind: 'alignment',
          },
        );
      }
    }
  }

  if (allowY) {
    for (const sa of subjectYAnchors) {
      for (const ae of artboardYEdges) {
        const adj = ae.value - sa.value;
        if (Math.abs(adj) > releaseTol + 1e-6) continue;
        considerAxis(
          `align:artboard:y:${ae.name}:${sa.name}`,
          'y',
          'alignment',
          PRIORITY_ALIGNMENT,
          rawDy + adj,
          ae.value,
          {
            axis: 'y',
            position: roundSnapValue(ae.value),
            x1: roundSnapValue(input.artboard.x),
            y1: roundSnapValue(ae.value),
            x2: roundSnapValue(input.artboard.x + input.artboard.width),
            y2: roundSnapValue(ae.value),
            kind: 'alignment',
          },
        );
      }
    }
  }

  // Object-to-object axial alignment using exact worldBounds (works for rotated objects too).
  for (let i = 0; i < queried.axialNodes.length; i += 1) {
    const geom = getNodeWorldGeometry(queried.axialNodes[i]);
    const tb = geom.worldBounds;
    const tLeft = tb.x;
    const tCenterX = tb.x + tb.width * 0.5;
    const tRight = tb.x + tb.width;
    const tTop = tb.y;
    const tCenterY = tb.y + tb.height * 0.5;
    const tBottom = tb.y + tb.height;

    if (allowX) {
      const targetXs = [
        { value: tLeft, name: 'l' },
        { value: tCenterX, name: 'c' },
        { value: tRight, name: 'r' },
      ];
      const guideY1 = Math.min(rawBounds.y, tTop) - overhang;
      const guideY2 = Math.max(rawBottom, tBottom) + overhang;
      for (let sIdx = 0; sIdx < subjectXAnchors.length; sIdx += 1) {
        const sa = subjectXAnchors[sIdx];
        for (let tIdx = 0; tIdx < targetXs.length; tIdx += 1) {
          const ta = targetXs[tIdx];
          const adj = ta.value - sa.value;
          if (Math.abs(adj) > releaseTol + 1e-6) continue;
          considerAxis(
            `align:obj:x:${geom.id}:${ta.name}:${sa.name}`,
            'x',
            'alignment',
            PRIORITY_ALIGNMENT,
            rawDx + adj,
            ta.value,
            {
              axis: 'x',
              position: roundSnapValue(ta.value),
              x1: roundSnapValue(ta.value),
              y1: roundSnapValue(guideY1),
              x2: roundSnapValue(ta.value),
              y2: roundSnapValue(guideY2),
              kind: 'alignment',
            },
          );
        }
      }
    }

    if (allowY) {
      const targetYs = [
        { value: tTop, name: 't' },
        { value: tCenterY, name: 'm' },
        { value: tBottom, name: 'b' },
      ];
      const guideX1 = Math.min(rawBounds.x, tLeft) - overhang;
      const guideX2 = Math.max(rawRight, tRight) + overhang;
      for (let sIdx = 0; sIdx < subjectYAnchors.length; sIdx += 1) {
        const sa = subjectYAnchors[sIdx];
        for (let tIdx = 0; tIdx < targetYs.length; tIdx += 1) {
          const ta = targetYs[tIdx];
          const adj = ta.value - sa.value;
          if (Math.abs(adj) > releaseTol + 1e-6) continue;
          considerAxis(
            `align:obj:y:${geom.id}:${ta.name}:${sa.name}`,
            'y',
            'alignment',
            PRIORITY_ALIGNMENT,
            rawDy + adj,
            ta.value,
            {
              axis: 'y',
              position: roundSnapValue(ta.value),
              x1: roundSnapValue(guideX1),
              y1: roundSnapValue(ta.value),
              x2: roundSnapValue(guideX2),
              y2: roundSnapValue(ta.value),
              kind: 'alignment',
            },
          );
        }
      }
    }
  }

  // =========================================================================
  // LAYER 3: MIRROR PADDING & EQUAL SPACING (Priority 3)
  // =========================================================================
  // 3A. Mirror Padding relative to active parent container content box (or Component Canvas root)
  const content = containerCtx.contentBounds;
  const subjectFitsHoriz =
    rawBounds.width <= content.width + 0.5 &&
    rawBounds.y >= content.y - releaseTol &&
    rawBottom <= content.y + content.height + releaseTol;
  const subjectFitsVert =
    rawBounds.height <= content.height + 0.5 &&
    rawBounds.x >= content.x - releaseTol &&
    rawRight <= content.x + content.width + releaseTol;

  const enableMirrorOnRoot = !containerCtx.isArtboard || profile === 'component';

  if (allowX && subjectFitsHoriz) {
    // Explicit container inner padding edges (when container defines layout.padding)
    if (!containerCtx.isArtboard && containerCtx.hasExplicitPadding) {
      const leftPadAdj = content.x - rawBounds.x;
      if (Math.abs(leftPadAdj) <= releaseTol + 1e-6) {
        considerAxis(
          `pad:content:x:left:${containerCtx.id}`,
          'x',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDx + leftPadAdj,
          content.x,
          {
            axis: 'x',
            position: roundSnapValue(content.x),
            x1: roundSnapValue(content.x),
            y1: roundSnapValue(content.y),
            x2: roundSnapValue(content.x),
            y2: roundSnapValue(content.y + content.height),
            kind: 'mirror-padding',
            spacingSegments: [
              {
                x1: roundSnapValue(containerCtx.outerBounds.x),
                y1: roundSnapValue(rawCenterY),
                x2: roundSnapValue(content.x),
                y2: roundSnapValue(rawCenterY),
                value: Math.round(content.x - containerCtx.outerBounds.x),
                orientation: 'horizontal',
              },
            ],
          },
        );
      }

      const contentRight = content.x + content.width;
      const rightPadAdj = contentRight - rawRight;
      if (Math.abs(rightPadAdj) <= releaseTol + 1e-6) {
        considerAxis(
          `pad:content:x:right:${containerCtx.id}`,
          'x',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDx + rightPadAdj,
          contentRight,
          {
            axis: 'x',
            position: roundSnapValue(contentRight),
            x1: roundSnapValue(contentRight),
            y1: roundSnapValue(content.y),
            x2: roundSnapValue(contentRight),
            y2: roundSnapValue(content.y + content.height),
            kind: 'mirror-padding',
            spacingSegments: [
              {
                x1: roundSnapValue(contentRight),
                y1: roundSnapValue(rawCenterY),
                x2: roundSnapValue(containerCtx.outerBounds.x + containerCtx.outerBounds.width),
                y2: roundSnapValue(rawCenterY),
                value: Math.round(containerCtx.outerBounds.x + containerCtx.outerBounds.width - contentRight),
                orientation: 'horizontal',
              },
            ],
          },
        );
      }
    }

    // Equal left/right mirror padding inside parent container (and Component Canvas root)
    if (enableMirrorOnRoot) {
      const mirrorLeft = content.x + (content.width - rawBounds.width) * 0.5;
      const mirrorGap = (content.width - rawBounds.width) * 0.5;
      const adj = mirrorLeft - rawBounds.x;
      if (mirrorGap >= 0.5 && Math.abs(adj) <= releaseTol + 1e-6) {
        const centerX = content.x + content.width * 0.5;
        const gapVal = Math.round(mirrorGap);
        considerAxis(
          `mirror:x:${containerCtx.id}`,
          'x',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDx + adj,
          centerX,
          {
            axis: 'x',
            position: roundSnapValue(centerX),
            x1: roundSnapValue(centerX),
            y1: roundSnapValue(content.y),
            x2: roundSnapValue(centerX),
            y2: roundSnapValue(content.y + content.height),
            kind: 'mirror-padding',
            label: `${gapVal}`,
            spacingSegments: [
              {
                x1: roundSnapValue(content.x),
                y1: roundSnapValue(rawCenterY),
                x2: roundSnapValue(mirrorLeft),
                y2: roundSnapValue(rawCenterY),
                value: gapVal,
                orientation: 'horizontal',
              },
              {
                x1: roundSnapValue(mirrorLeft + rawBounds.width),
                y1: roundSnapValue(rawCenterY),
                x2: roundSnapValue(content.x + content.width),
                y2: roundSnapValue(rawCenterY),
                value: gapVal,
                orientation: 'horizontal',
              },
            ],
          },
        );
      }
    }
  }

  if (allowY && subjectFitsVert) {
    if (!containerCtx.isArtboard && containerCtx.hasExplicitPadding) {
      const topPadAdj = content.y - rawBounds.y;
      if (Math.abs(topPadAdj) <= releaseTol + 1e-6) {
        considerAxis(
          `pad:content:y:top:${containerCtx.id}`,
          'y',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDy + topPadAdj,
          content.y,
          {
            axis: 'y',
            position: roundSnapValue(content.y),
            x1: roundSnapValue(content.x),
            y1: roundSnapValue(content.y),
            x2: roundSnapValue(content.x + content.width),
            y2: roundSnapValue(content.y),
            kind: 'mirror-padding',
            spacingSegments: [
              {
                x1: roundSnapValue(rawCenterX),
                y1: roundSnapValue(containerCtx.outerBounds.y),
                x2: roundSnapValue(rawCenterX),
                y2: roundSnapValue(content.y),
                value: Math.round(content.y - containerCtx.outerBounds.y),
                orientation: 'vertical',
              },
            ],
          },
        );
      }

      const contentBottom = content.y + content.height;
      const bottomPadAdj = contentBottom - rawBottom;
      if (Math.abs(bottomPadAdj) <= releaseTol + 1e-6) {
        considerAxis(
          `pad:content:y:bottom:${containerCtx.id}`,
          'y',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDy + bottomPadAdj,
          contentBottom,
          {
            axis: 'y',
            position: roundSnapValue(contentBottom),
            x1: roundSnapValue(content.x),
            y1: roundSnapValue(contentBottom),
            x2: roundSnapValue(content.x + content.width),
            y2: roundSnapValue(contentBottom),
            kind: 'mirror-padding',
            spacingSegments: [
              {
                x1: roundSnapValue(rawCenterX),
                y1: roundSnapValue(contentBottom),
                x2: roundSnapValue(rawCenterX),
                y2: roundSnapValue(containerCtx.outerBounds.y + containerCtx.outerBounds.height),
                value: Math.round(containerCtx.outerBounds.y + containerCtx.outerBounds.height - contentBottom),
                orientation: 'vertical',
              },
            ],
          },
        );
      }
    }

    if (enableMirrorOnRoot) {
      const mirrorTop = content.y + (content.height - rawBounds.height) * 0.5;
      const mirrorGap = (content.height - rawBounds.height) * 0.5;
      const adj = mirrorTop - rawBounds.y;
      if (mirrorGap >= 0.5 && Math.abs(adj) <= releaseTol + 1e-6) {
        const centerY = content.y + content.height * 0.5;
        const gapVal = Math.round(mirrorGap);
        considerAxis(
          `mirror:y:${containerCtx.id}`,
          'y',
          'mirror-padding',
          PRIORITY_SPACING,
          rawDy + adj,
          centerY,
          {
            axis: 'y',
            position: roundSnapValue(centerY),
            x1: roundSnapValue(content.x),
            y1: roundSnapValue(centerY),
            x2: roundSnapValue(content.x + content.width),
            y2: roundSnapValue(centerY),
            kind: 'mirror-padding',
            label: `${gapVal}`,
            spacingSegments: [
              {
                x1: roundSnapValue(rawCenterX),
                y1: roundSnapValue(content.y),
                x2: roundSnapValue(rawCenterX),
                y2: roundSnapValue(mirrorTop),
                value: gapVal,
                orientation: 'vertical',
              },
              {
                x1: roundSnapValue(rawCenterX),
                y1: roundSnapValue(mirrorTop + rawBounds.height),
                x2: roundSnapValue(rawCenterX),
                y2: roundSnapValue(content.y + content.height),
                value: gapVal,
                orientation: 'vertical',
              },
            ],
          },
        );
      }
    }
  }

  // 3B. Equal Spacing (between 2 objects or matching adjacent neighbor gap)
  // Exclude enclosing containers so spacing only compares sibling/peer objects.
  const peerGeoms = localGeoms.filter((geom) => {
    if (geom.id === containerCtx.id) return false;
    if (isBoundsEnclosing(geom.worldBounds, rawBounds)) return false;
    return true;
  });

  if (allowX && peerGeoms.length >= 2) {
    const horizPeers = peerGeoms.filter((geom) => {
      const tb = geom.worldBounds;
      const overlap = Math.min(rawBottom, tb.y + tb.height) - Math.max(rawBounds.y, tb.y);
      return overlap > 1;
    });

    const leftPeers = horizPeers
      .filter((g) => g.worldBounds.x + g.worldBounds.width <= rawBounds.x + releaseTol)
      .sort((a, b) => (b.worldBounds.x + b.worldBounds.width) - (a.worldBounds.x + a.worldBounds.width) || a.id.localeCompare(b.id));

    const rightPeers = horizPeers
      .filter((g) => g.worldBounds.x >= rawRight - releaseTol)
      .sort((a, b) => a.worldBounds.x - b.worldBounds.x || a.id.localeCompare(b.id));

    // Case 1: Center between nearest left and nearest right peer
    if (leftPeers.length >= 1 && rightPeers.length >= 1) {
      const left = leftPeers[0];
      const right = rightPeers[0];
      const leftEdge = left.worldBounds.x + left.worldBounds.width;
      const rightEdge = right.worldBounds.x;
      const avail = rightEdge - leftEdge;
      if (avail >= rawBounds.width + 0.5) {
        const gap = (avail - rawBounds.width) * 0.5;
        const targetLeft = leftEdge + gap;
        const adj = targetLeft - rawBounds.x;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const bandTop = Math.max(rawBounds.y, left.worldBounds.y, right.worldBounds.y);
          const bandBottom = Math.min(rawBottom, left.worldBounds.y + left.worldBounds.height, right.worldBounds.y + right.worldBounds.height);
          const lineY = bandBottom > bandTop ? (bandTop + bandBottom) * 0.5 : rawCenterY;
          const gapVal = Math.round(gap);
          const centerX = targetLeft + rawBounds.width * 0.5;
          considerAxis(
            `space:x:between:${left.id}:${right.id}`,
            'x',
            'spacing',
            PRIORITY_SPACING,
            rawDx + adj,
            centerX,
            {
              axis: 'x',
              position: roundSnapValue(centerX),
              x1: roundSnapValue(centerX),
              y1: roundSnapValue(rawBounds.y - overhang),
              x2: roundSnapValue(centerX),
              y2: roundSnapValue(rawBottom + overhang),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(leftEdge),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(targetLeft),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
                {
                  x1: roundSnapValue(targetLeft + rawBounds.width),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(rightEdge),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
              ],
            },
          );
        }
      }
    }

    // Case 2: Match gap between two adjacent peers to the left ([L2] --gap-- [L1] --gap-- [Subject])
    if (leftPeers.length >= 2) {
      const l1 = leftPeers[0];
      const l2 = leftPeers[1];
      const l2Right = l2.worldBounds.x + l2.worldBounds.width;
      const l1Left = l1.worldBounds.x;
      const l1Right = l1.worldBounds.x + l1.worldBounds.width;
      const refGap = l1Left - l2Right;
      if (refGap >= 0.5) {
        const targetLeft = l1Right + refGap;
        const adj = targetLeft - rawBounds.x;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const lineY = rawCenterY;
          const gapVal = Math.round(refGap);
          considerAxis(
            `space:x:after:${l2.id}:${l1.id}`,
            'x',
            'spacing',
            PRIORITY_SPACING,
            rawDx + adj,
            targetLeft,
            {
              axis: 'x',
              position: roundSnapValue(targetLeft),
              x1: roundSnapValue(targetLeft),
              y1: roundSnapValue(Math.min(rawBounds.y, l1.worldBounds.y) - overhang),
              x2: roundSnapValue(targetLeft),
              y2: roundSnapValue(Math.max(rawBottom, l1.worldBounds.y + l1.worldBounds.height) + overhang),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(l2Right),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(l1Left),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
                {
                  x1: roundSnapValue(l1Right),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(targetLeft),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
              ],
            },
          );
        }
      }
    }

    // Case 3: Match gap between two adjacent peers to the right ([Subject] --gap-- [R1] --gap-- [R2])
    if (rightPeers.length >= 2) {
      const r1 = rightPeers[0];
      const r2 = rightPeers[1];
      const r1Left = r1.worldBounds.x;
      const r1Right = r1.worldBounds.x + r1.worldBounds.width;
      const r2Left = r2.worldBounds.x;
      const refGap = r2Left - r1Right;
      if (refGap >= 0.5) {
        const targetRight = r1Left - refGap;
        const targetLeft = targetRight - rawBounds.width;
        const adj = targetLeft - rawBounds.x;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const lineY = rawCenterY;
          const gapVal = Math.round(refGap);
          considerAxis(
            `space:x:before:${r1.id}:${r2.id}`,
            'x',
            'spacing',
            PRIORITY_SPACING,
            rawDx + adj,
            targetRight,
            {
              axis: 'x',
              position: roundSnapValue(targetRight),
              x1: roundSnapValue(targetRight),
              y1: roundSnapValue(Math.min(rawBounds.y, r1.worldBounds.y) - overhang),
              x2: roundSnapValue(targetRight),
              y2: roundSnapValue(Math.max(rawBottom, r1.worldBounds.y + r1.worldBounds.height) + overhang),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(targetRight),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(r1Left),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
                {
                  x1: roundSnapValue(r1Right),
                  y1: roundSnapValue(lineY),
                  x2: roundSnapValue(r2Left),
                  y2: roundSnapValue(lineY),
                  value: gapVal,
                  orientation: 'horizontal',
                },
              ],
            },
          );
        }
      }
    }
  }

  if (allowY && peerGeoms.length >= 2) {
    const vertPeers = peerGeoms.filter((geom) => {
      const tb = geom.worldBounds;
      const overlap = Math.min(rawRight, tb.x + tb.width) - Math.max(rawBounds.x, tb.x);
      return overlap > 1;
    });

    const topPeers = vertPeers
      .filter((g) => g.worldBounds.y + g.worldBounds.height <= rawBounds.y + releaseTol)
      .sort((a, b) => (b.worldBounds.y + b.worldBounds.height) - (a.worldBounds.y + a.worldBounds.height) || a.id.localeCompare(b.id));

    const bottomPeers = vertPeers
      .filter((g) => g.worldBounds.y >= rawBottom - releaseTol)
      .sort((a, b) => a.worldBounds.y - b.worldBounds.y || a.id.localeCompare(b.id));

    // Case 1: Center vertically between nearest top and bottom peer
    if (topPeers.length >= 1 && bottomPeers.length >= 1) {
      const top = topPeers[0];
      const bottom = bottomPeers[0];
      const topEdge = top.worldBounds.y + top.worldBounds.height;
      const bottomEdge = bottom.worldBounds.y;
      const avail = bottomEdge - topEdge;
      if (avail >= rawBounds.height + 0.5) {
        const gap = (avail - rawBounds.height) * 0.5;
        const targetTop = topEdge + gap;
        const adj = targetTop - rawBounds.y;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const bandLeft = Math.max(rawBounds.x, top.worldBounds.x, bottom.worldBounds.x);
          const bandRight = Math.min(rawRight, top.worldBounds.x + top.worldBounds.width, bottom.worldBounds.x + bottom.worldBounds.width);
          const lineX = bandRight > bandLeft ? (bandLeft + bandRight) * 0.5 : rawCenterX;
          const gapVal = Math.round(gap);
          const centerY = targetTop + rawBounds.height * 0.5;
          considerAxis(
            `space:y:between:${top.id}:${bottom.id}`,
            'y',
            'spacing',
            PRIORITY_SPACING,
            rawDy + adj,
            centerY,
            {
              axis: 'y',
              position: roundSnapValue(centerY),
              x1: roundSnapValue(rawBounds.x - overhang),
              y1: roundSnapValue(centerY),
              x2: roundSnapValue(rawRight + overhang),
              y2: roundSnapValue(centerY),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(topEdge),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(targetTop),
                  value: gapVal,
                  orientation: 'vertical',
                },
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(targetTop + rawBounds.height),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(bottomEdge),
                  value: gapVal,
                  orientation: 'vertical',
                },
              ],
            },
          );
        }
      }
    }

    // Case 2: Match gap between two adjacent peers above
    if (topPeers.length >= 2) {
      const t1 = topPeers[0];
      const t2 = topPeers[1];
      const t2Bottom = t2.worldBounds.y + t2.worldBounds.height;
      const t1Top = t1.worldBounds.y;
      const t1Bottom = t1.worldBounds.y + t1.worldBounds.height;
      const refGap = t1Top - t2Bottom;
      if (refGap >= 0.5) {
        const targetTop = t1Bottom + refGap;
        const adj = targetTop - rawBounds.y;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const lineX = rawCenterX;
          const gapVal = Math.round(refGap);
          considerAxis(
            `space:y:after:${t2.id}:${t1.id}`,
            'y',
            'spacing',
            PRIORITY_SPACING,
            rawDy + adj,
            targetTop,
            {
              axis: 'y',
              position: roundSnapValue(targetTop),
              x1: roundSnapValue(Math.min(rawBounds.x, t1.worldBounds.x) - overhang),
              y1: roundSnapValue(targetTop),
              x2: roundSnapValue(Math.max(rawRight, t1.worldBounds.x + t1.worldBounds.width) + overhang),
              y2: roundSnapValue(targetTop),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(t2Bottom),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(t1Top),
                  value: gapVal,
                  orientation: 'vertical',
                },
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(t1Bottom),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(targetTop),
                  value: gapVal,
                  orientation: 'vertical',
                },
              ],
            },
          );
        }
      }
    }

    // Case 3: Match gap between two adjacent peers below
    if (bottomPeers.length >= 2) {
      const b1 = bottomPeers[0];
      const b2 = bottomPeers[1];
      const b1Top = b1.worldBounds.y;
      const b1Bottom = b1.worldBounds.y + b1.worldBounds.height;
      const b2Top = b2.worldBounds.y;
      const refGap = b2Top - b1Bottom;
      if (refGap >= 0.5) {
        const targetBottom = b1Top - refGap;
        const targetTop = targetBottom - rawBounds.height;
        const adj = targetTop - rawBounds.y;
        if (Math.abs(adj) <= releaseTol + 1e-6) {
          const lineX = rawCenterX;
          const gapVal = Math.round(refGap);
          considerAxis(
            `space:y:before:${b1.id}:${b2.id}`,
            'y',
            'spacing',
            PRIORITY_SPACING,
            rawDy + adj,
            targetBottom,
            {
              axis: 'y',
              position: roundSnapValue(targetBottom),
              x1: roundSnapValue(Math.min(rawBounds.x, b1.worldBounds.x) - overhang),
              y1: roundSnapValue(targetBottom),
              x2: roundSnapValue(Math.max(rawRight, b1.worldBounds.x + b1.worldBounds.width) + overhang),
              y2: roundSnapValue(targetBottom),
              kind: 'spacing',
              label: `${gapVal}`,
              spacingSegments: [
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(targetBottom),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(b1Top),
                  value: gapVal,
                  orientation: 'vertical',
                },
                {
                  x1: roundSnapValue(lineX),
                  y1: roundSnapValue(b1Bottom),
                  x2: roundSnapValue(lineX),
                  y2: roundSnapValue(b2Top),
                  value: gapVal,
                  orientation: 'vertical',
                },
              ],
            },
          );
        }
      }
    }
  }

  // =========================================================================
  // LAYER 1: FRACTIONAL GUIDES (1/4, 1/3, 1/2, 2/3, 3/4 — Priority 4, deduplicated)
  // =========================================================================
  const fractionalScopes: { readonly scope: string; readonly bounds: Bounds }[] = [
    { scope: 'artboard', bounds: input.artboard },
  ];
  if (!containerCtx.isArtboard && containerCtx.contentBounds.width > 1 && containerCtx.contentBounds.height > 1) {
    fractionalScopes.push({ scope: `container:${containerCtx.id}`, bounds: containerCtx.contentBounds });
  }

  const seenFracX = new Set<number>();
  const seenFracY = new Set<number>();

  for (let scIdx = 0; scIdx < fractionalScopes.length; scIdx += 1) {
    const { scope, bounds } = fractionalScopes[scIdx];
    for (let fIdx = 0; fIdx < FRACTION_SPECS.length; fIdx += 1) {
      const spec = FRACTION_SPECS[fIdx];

      if (allowX && bounds.width > 0) {
        const posX = roundSnapValue(bounds.x + bounds.width * spec.ratio);
        const dedupKey = Math.round(posX * 100);
        if (!seenFracX.has(dedupKey)) {
          seenFracX.add(dedupKey);
          for (let sIdx = 0; sIdx < subjectXAnchors.length; sIdx += 1) {
            const sa = subjectXAnchors[sIdx];
            const adj = posX - sa.value;
            if (Math.abs(adj) > releaseTol + 1e-6) continue;
            considerAxis(
              `frac:${scope}:x:${spec.label}:${sa.name}`,
              'x',
              'fractional',
              PRIORITY_FRACTIONAL,
              rawDx + adj,
              posX,
              {
                axis: 'x',
                position: posX,
                x1: posX,
                y1: roundSnapValue(bounds.y),
                x2: posX,
                y2: roundSnapValue(bounds.y + bounds.height),
                kind: 'fractional',
                label: spec.label,
              },
            );
          }
        }
      }

      if (allowY && bounds.height > 0) {
        const posY = roundSnapValue(bounds.y + bounds.height * spec.ratio);
        const dedupKey = Math.round(posY * 100);
        if (!seenFracY.has(dedupKey)) {
          seenFracY.add(dedupKey);
          for (let sIdx = 0; sIdx < subjectYAnchors.length; sIdx += 1) {
            const sa = subjectYAnchors[sIdx];
            const adj = posY - sa.value;
            if (Math.abs(adj) > releaseTol + 1e-6) continue;
            considerAxis(
              `frac:${scope}:y:${spec.label}:${sa.name}`,
              'y',
              'fractional',
              PRIORITY_FRACTIONAL,
              rawDy + adj,
              posY,
              {
                axis: 'y',
                position: posY,
                x1: roundSnapValue(bounds.x),
                y1: posY,
                x2: roundSnapValue(bounds.x + bounds.width),
                y2: posY,
                kind: 'fractional',
                label: spec.label,
              },
            );
          }
        }
      }
    }
  }

  // =========================================================================
  // ARBITRATION: Coupled 2D/Diagonal vs Independent Axial X & Y
  // =========================================================================
  let finalDx = rawDx;
  let finalDy = rawDy;
  const guides: SnapGuide[] = [];
  let nextLock: SnapLockState | null = null;

  const chosenCoupled = bestCoupled as CoupledCandidate | null;
  const chosenX = bestX as AxisCandidate | null;
  const chosenY = bestY as AxisCandidate | null;

  const minAxialPriority = Math.min(
    chosenX ? chosenX.priority : 99,
    chosenY ? chosenY.priority : 99,
  );
  const xAtMinPriority = chosenX && chosenX.priority === minAxialPriority ? chosenX : null;
  const yAtMinPriority = chosenY && chosenY.priority === minAxialPriority ? chosenY : null;
  const minAxialScreenDist = Math.min(
    xAtMinPriority ? xAtMinPriority.screenDistance : Infinity,
    yAtMinPriority ? yAtMinPriority.screenDistance : Infinity,
  );
  const combinedAxialScreenDist =
    xAtMinPriority && yAtMinPriority
      ? Math.hypot(xAtMinPriority.screenDistance, yAtMinPriority.screenDistance)
      : minAxialScreenDist;

  const useCoupled =
    chosenCoupled !== null &&
    (chosenCoupled.priority < minAxialPriority ||
      (chosenCoupled.priority === minAxialPriority &&
        (chosenCoupled.mode === 'point'
          ? chosenCoupled.screenDistance <= combinedAxialScreenDist + DIST_TIE_EPS
          : chosenCoupled.screenDistance <= minAxialScreenDist + DIST_TIE_EPS)));

  if (useCoupled && chosenCoupled) {
    finalDx = chosenCoupled.snappedDx;
    finalDy = chosenCoupled.snappedDy;
    for (let i = 0; i < chosenCoupled.guides.length && guides.length < MAX_ACTIVE_GUIDES; i += 1) {
      guides.push(chosenCoupled.guides[i]);
    }
    nextLock = { coupled: chosenCoupled.lockData };
  } else {
    let lockX: SnapAxisLock | null = null;
    let lockY: SnapAxisLock | null = null;

    if (chosenX) {
      finalDx = chosenX.snappedDelta;
      guides.push(chosenX.guide);
      lockX = {
        id: chosenX.id,
        kind: chosenX.kind,
        priority: chosenX.priority === PRIORITY_ACTIVE_LOCK
          ? (prevLock?.x?.priority ?? PRIORITY_ALIGNMENT)
          : chosenX.priority,
        snappedDelta: chosenX.snappedDelta,
        targetPosition: chosenX.targetPosition,
      };
    }

    if (chosenY && guides.length < MAX_ACTIVE_GUIDES) {
      finalDy = chosenY.snappedDelta;
      guides.push(chosenY.guide);
      lockY = {
        id: chosenY.id,
        kind: chosenY.kind,
        priority: chosenY.priority === PRIORITY_ACTIVE_LOCK
          ? (prevLock?.y?.priority ?? PRIORITY_ALIGNMENT)
          : chosenY.priority,
        snappedDelta: chosenY.snappedDelta,
        targetPosition: chosenY.targetPosition,
      };
    }

    if (lockX || lockY) {
      nextLock = { x: lockX, y: lockY };
    }
  }

  return {
    dx: finalDx,
    dy: finalDy,
    guides,
    nextLock,
    ...(input.collectMetrics
      ? {
          metrics: {
            candidatesInspected: queried.totalInspected,
            spatialQueryMs: queried.spatialQueryMs,
            snapCalcMs: nowMs() - tStart,
            usedSpatialIndex: queried.usedSpatialIndex,
            guideCount: guides.length,
          },
        }
      : {}),
  };
}

/**
 * Unified resize snapping solver using FlatGridSpatialIndex, zoom-adaptive
 * thresholds, anti-jitter hysteresis, and active artboard bounds.
 */
export function solveResizeSnap(input: ResizeSnapInput): ResizeSnapOutput {
  const tStart = input.collectMetrics ? nowMs() : 0;
  if (input.bypass || input.fromCenter) {
    return { dx: input.dx, dy: input.dy, guides: [], nextLock: null };
  }

  const { entryTol, releaseTol, unitsPerPx } = resolveThresholds(
    input.canvasUnitsPerPixel,
    input.toleranceOverride,
  );
  if (entryTol <= 0) {
    return { dx: input.dx, dy: input.dy, guides: [], nextLock: null };
  }

  const { bounds, handle, dx: rawDx, dy: rawDy } = input;
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');

  const activeEdgeX = handle.includes('e')
    ? bounds.x + bounds.width + rawDx
    : handle.includes('w')
      ? bounds.x + rawDx
      : bounds.x;
  const activeEdgeY = handle.includes('s')
    ? bounds.y + bounds.height + rawDy
    : handle.includes('n')
      ? bounds.y + rawDy
      : bounds.y;

  const nextMinX = handle.includes('w') ? Math.min(bounds.x + bounds.width, bounds.x + rawDx) : bounds.x;
  const nextMaxX = handle.includes('e') ? Math.max(bounds.x, bounds.x + bounds.width + rawDx) : bounds.x + bounds.width;
  const nextMinY = handle.includes('n') ? Math.min(bounds.y + bounds.height, bounds.y + rawDy) : bounds.y;
  const nextMaxY = handle.includes('s') ? Math.max(bounds.y, bounds.y + bounds.height + rawDy) : bounds.y + bounds.height;

  const excludedIds = collectExcludedIds(
    input.movingNodes ?? [],
    input.nodeById,
    input.otherNodes,
    input.allNodes,
    input.excludeIds,
    false,
  );

  const containerCtx = resolveContainerContext(
    input.movingNodes ?? [],
    input.artboard,
    input.nodeById,
    input.otherNodes,
    excludedIds,
  );

  const queried = queryCandidates(
    { minX: nextMinX, minY: nextMinY, maxX: nextMaxX, maxY: nextMaxY },
    input.artboard,
    releaseTol,
    input.spatialIndex,
    input.nodeById,
    input.layerStates,
    input.otherNodes,
    excludedIds,
    containerCtx.isArtboard ? null : containerCtx.id,
    Boolean(input.collectMetrics),
  );

  const prevLock = input.previousLock ?? null;
  const prevXLockId = prevLock?.x?.id ?? null;
  const prevYLockId = prevLock?.y?.id ?? null;

  let bestX: AxisCandidate | null = null;
  let bestY: AxisCandidate | null = null;
  const overhang = GUIDE_OVERHANG_PX * unitsPerPx;

  const considerResizeAxis = (
    id: string,
    axis: 'x' | 'y',
    kind: SnapLayerKind,
    basePriority: number,
    targetPosition: number,
    guide: SnapGuide,
  ) => {
    const activeVal = axis === 'x' ? activeEdgeX : activeEdgeY;
    const rawDelta = axis === 'x' ? rawDx : rawDy;
    const adj = targetPosition - activeVal;
    const distance = Math.abs(adj);
    const isLocked = axis === 'x' ? id === prevXLockId : id === prevYLockId;
    const maxTol = isLocked ? releaseTol : entryTol;
    if (distance > maxTol + 1e-6) return;

    const candidate: AxisCandidate = {
      id,
      axis,
      kind,
      priority: isLocked ? PRIORITY_ACTIVE_LOCK : basePriority,
      snappedDelta: roundSnapValue(rawDelta + adj),
      targetPosition: roundSnapValue(targetPosition),
      distance,
      screenDistance: distance / unitsPerPx,
      guide,
    };
    if (axis === 'x') {
      if (isBetterAxisCandidate(candidate, bestX)) bestX = candidate;
    } else {
      if (isBetterAxisCandidate(candidate, bestY)) bestY = candidate;
    }
  };

  // Artboard outer edges
  if (affectsX) {
    for (const [name, pos] of [['left', input.artboard.x], ['right', input.artboard.x + input.artboard.width]] as const) {
      considerResizeAxis(`resize:artboard:x:${name}`, 'x', 'alignment', PRIORITY_ALIGNMENT, pos, {
        axis: 'x',
        position: roundSnapValue(pos),
        x1: roundSnapValue(pos),
        y1: roundSnapValue(input.artboard.y),
        x2: roundSnapValue(pos),
        y2: roundSnapValue(input.artboard.y + input.artboard.height),
        kind: 'alignment',
      });
    }
  }
  if (affectsY) {
    for (const [name, pos] of [['top', input.artboard.y], ['bottom', input.artboard.y + input.artboard.height]] as const) {
      considerResizeAxis(`resize:artboard:y:${name}`, 'y', 'alignment', PRIORITY_ALIGNMENT, pos, {
        axis: 'y',
        position: roundSnapValue(pos),
        x1: roundSnapValue(input.artboard.x),
        y1: roundSnapValue(pos),
        x2: roundSnapValue(input.artboard.x + input.artboard.width),
        y2: roundSnapValue(pos),
        kind: 'alignment',
      });
    }
  }

  // Container content padding edges
  if (!containerCtx.isArtboard && containerCtx.hasExplicitPadding) {
    const c = containerCtx.contentBounds;
    if (affectsX) {
      considerResizeAxis(`resize:pad:x:left:${containerCtx.id}`, 'x', 'mirror-padding', PRIORITY_SPACING, c.x, {
        axis: 'x',
        position: roundSnapValue(c.x),
        x1: roundSnapValue(c.x),
        y1: roundSnapValue(c.y),
        x2: roundSnapValue(c.x),
        y2: roundSnapValue(c.y + c.height),
        kind: 'mirror-padding',
      });
      considerResizeAxis(`resize:pad:x:right:${containerCtx.id}`, 'x', 'mirror-padding', PRIORITY_SPACING, c.x + c.width, {
        axis: 'x',
        position: roundSnapValue(c.x + c.width),
        x1: roundSnapValue(c.x + c.width),
        y1: roundSnapValue(c.y),
        x2: roundSnapValue(c.x + c.width),
        y2: roundSnapValue(c.y + c.height),
        kind: 'mirror-padding',
      });
    }
    if (affectsY) {
      considerResizeAxis(`resize:pad:y:top:${containerCtx.id}`, 'y', 'mirror-padding', PRIORITY_SPACING, c.y, {
        axis: 'y',
        position: roundSnapValue(c.y),
        x1: roundSnapValue(c.x),
        y1: roundSnapValue(c.y),
        x2: roundSnapValue(c.x + c.width),
        y2: roundSnapValue(c.y),
        kind: 'mirror-padding',
      });
      considerResizeAxis(`resize:pad:y:bottom:${containerCtx.id}`, 'y', 'mirror-padding', PRIORITY_SPACING, c.y + c.height, {
        axis: 'y',
        position: roundSnapValue(c.y + c.height),
        x1: roundSnapValue(c.x),
        y1: roundSnapValue(c.y + c.height),
        x2: roundSnapValue(c.x + c.width),
        y2: roundSnapValue(c.y + c.height),
        kind: 'mirror-padding',
      });
    }
  }

  // Object world bounds & vertices
  for (let i = 0; i < queried.axialNodes.length; i += 1) {
    const geom = getNodeWorldGeometry(queried.axialNodes[i]);
    const tb = geom.worldBounds;
    if (affectsX) {
      const y1 = Math.min(nextMinY, tb.y) - overhang;
      const y2 = Math.max(nextMaxY, tb.y + tb.height) + overhang;
      for (const [name, pos] of [
        ['l', tb.x],
        ['c', tb.x + tb.width * 0.5],
        ['r', tb.x + tb.width],
      ] as const) {
        considerResizeAxis(`resize:obj:x:${geom.id}:${name}`, 'x', 'alignment', PRIORITY_ALIGNMENT, pos, {
          axis: 'x',
          position: roundSnapValue(pos),
          x1: roundSnapValue(pos),
          y1: roundSnapValue(y1),
          x2: roundSnapValue(pos),
          y2: roundSnapValue(y2),
          kind: 'alignment',
        });
      }
    }
    if (affectsY) {
      const x1 = Math.min(nextMinX, tb.x) - overhang;
      const x2 = Math.max(nextMaxX, tb.x + tb.width) + overhang;
      for (const [name, pos] of [
        ['t', tb.y],
        ['m', tb.y + tb.height * 0.5],
        ['b', tb.y + tb.height],
      ] as const) {
        considerResizeAxis(`resize:obj:y:${geom.id}:${name}`, 'y', 'alignment', PRIORITY_ALIGNMENT, pos, {
          axis: 'y',
          position: roundSnapValue(pos),
          x1: roundSnapValue(x1),
          y1: roundSnapValue(pos),
          x2: roundSnapValue(x2),
          y2: roundSnapValue(pos),
          kind: 'alignment',
        });
      }
    }
  }

  // Fractional guides (deduplicated)
  for (let fIdx = 0; fIdx < FRACTION_SPECS.length; fIdx += 1) {
    const spec = FRACTION_SPECS[fIdx];
    if (affectsX && input.artboard.width > 0) {
      const posX = roundSnapValue(input.artboard.x + input.artboard.width * spec.ratio);
      considerResizeAxis(`resize:frac:x:${spec.label}`, 'x', 'fractional', PRIORITY_FRACTIONAL, posX, {
        axis: 'x',
        position: posX,
        x1: posX,
        y1: roundSnapValue(input.artboard.y),
        x2: posX,
        y2: roundSnapValue(input.artboard.y + input.artboard.height),
        kind: 'fractional',
        label: spec.label,
      });
    }
    if (affectsY && input.artboard.height > 0) {
      const posY = roundSnapValue(input.artboard.y + input.artboard.height * spec.ratio);
      considerResizeAxis(`resize:frac:y:${spec.label}`, 'y', 'fractional', PRIORITY_FRACTIONAL, posY, {
        axis: 'y',
        position: posY,
        x1: roundSnapValue(input.artboard.x),
        y1: posY,
        x2: roundSnapValue(input.artboard.x + input.artboard.width),
        y2: posY,
        kind: 'fractional',
        label: spec.label,
      });
    }
  }

  const chosenX = bestX as AxisCandidate | null;
  const chosenY = bestY as AxisCandidate | null;

  let snappedDx = rawDx;
  let snappedDy = rawDy;
  const guides: SnapGuide[] = [];
  let lockX: SnapAxisLock | null = null;
  let lockY: SnapAxisLock | null = null;

  if (input.lockAspect && affectsX && affectsY) {
    // For aspect-locked corners, snap only the dominant drag axis so proportions stay exact.
    const widthRatio = Math.abs(rawDx) / Math.max(1, bounds.width);
    const heightRatio = Math.abs(rawDy) / Math.max(1, bounds.height);
    if (widthRatio >= heightRatio) {
      if (chosenX) {
        snappedDx = chosenX.snappedDelta;
        guides.push(chosenX.guide);
        lockX = {
          id: chosenX.id,
          kind: chosenX.kind,
          priority: chosenX.priority === PRIORITY_ACTIVE_LOCK ? (prevLock?.x?.priority ?? PRIORITY_ALIGNMENT) : chosenX.priority,
          snappedDelta: chosenX.snappedDelta,
          targetPosition: chosenX.targetPosition,
        };
      }
    } else if (chosenY) {
      snappedDy = chosenY.snappedDelta;
      guides.push(chosenY.guide);
      lockY = {
        id: chosenY.id,
        kind: chosenY.kind,
        priority: chosenY.priority === PRIORITY_ACTIVE_LOCK ? (prevLock?.y?.priority ?? PRIORITY_ALIGNMENT) : chosenY.priority,
        snappedDelta: chosenY.snappedDelta,
        targetPosition: chosenY.targetPosition,
      };
    }
  } else {
    if (chosenX) {
      snappedDx = chosenX.snappedDelta;
      guides.push(chosenX.guide);
      lockX = {
        id: chosenX.id,
        kind: chosenX.kind,
        priority: chosenX.priority === PRIORITY_ACTIVE_LOCK ? (prevLock?.x?.priority ?? PRIORITY_ALIGNMENT) : chosenX.priority,
        snappedDelta: chosenX.snappedDelta,
        targetPosition: chosenX.targetPosition,
      };
    }
    if (chosenY) {
      snappedDy = chosenY.snappedDelta;
      guides.push(chosenY.guide);
      lockY = {
        id: chosenY.id,
        kind: chosenY.kind,
        priority: chosenY.priority === PRIORITY_ACTIVE_LOCK ? (prevLock?.y?.priority ?? PRIORITY_ALIGNMENT) : chosenY.priority,
        snappedDelta: chosenY.snappedDelta,
        targetPosition: chosenY.targetPosition,
      };
    }
  }

  return {
    dx: snappedDx,
    dy: snappedDy,
    guides,
    nextLock: lockX || lockY ? { x: lockX, y: lockY } : null,
    ...(input.collectMetrics
      ? {
          metrics: {
            candidatesInspected: queried.totalInspected,
            spatialQueryMs: queried.spatialQueryMs,
            snapCalcMs: nowMs() - tStart,
            usedSpatialIndex: queried.usedSpatialIndex,
            guideCount: guides.length,
          },
        }
      : {}),
  };
}

/**
 * Fast deep equality check for SnapGuide arrays so Canvas skips redundant
 * overlay re-renders when guide lines are unchanged across drag frames.
 */
export function areSnapGuidesEqual(
  prev: readonly SnapGuide[],
  next: readonly SnapGuide[],
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.axis !== b.axis ||
      a.position !== b.position ||
      a.x1 !== b.x1 ||
      a.y1 !== b.y1 ||
      a.x2 !== b.x2 ||
      a.y2 !== b.y2 ||
      a.kind !== b.kind ||
      a.label !== b.label
    ) {
      return false;
    }
    if (Boolean(a.marker) !== Boolean(b.marker)) return false;
    if (a.marker && b.marker && (a.marker.x !== b.marker.x || a.marker.y !== b.marker.y || a.marker.kind !== b.marker.kind)) {
      return false;
    }
    const segA = a.spacingSegments;
    const segB = b.spacingSegments;
    if ((segA?.length ?? 0) !== (segB?.length ?? 0)) return false;
    if (segA && segB) {
      for (let j = 0; j < segA.length; j += 1) {
        const sa = segA[j];
        const sb = segB[j];
        if (
          sa.x1 !== sb.x1 ||
          sa.y1 !== sb.y1 ||
          sa.x2 !== sb.x2 ||
          sa.y2 !== sb.y2 ||
          sa.value !== sb.value ||
          sa.orientation !== sb.orientation
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

import type { JSX } from 'preact';
import type { DesignNode } from '../../core/document/types';
import type { PlanarFace } from '../../core/document/vector';
import {
  getComputeKernels,
  type SpatialBoundsEntry,
  type SpatialIndexHandle,
  type SpatialQueryRect,
} from '../../core/kernels';
import type { ResizeHandle } from './geometry';
import type { CanvasToolPointerInput, SmartHandleHit, VectorAnchorHit } from './tools/types';

/**
 * Only engage viewport culling above this visible node count so small/medium
 * artboards keep zero culling overhead and full DOM visibility for tests.
 */
export const CANVAS_VIEWPORT_CULL_THRESHOLD = 250;

export function toCanvasPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (matrix && Math.abs(matrix.a) > 1e-6 && Math.abs(matrix.d) > 1e-6) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    if (Number.isFinite(local.x) && Number.isFinite(local.y)) {
      return { x: local.x, y: local.y };
    }
  }

  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * Number(svg.viewBox.baseVal.width),
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * Number(svg.viewBox.baseVal.height),
  };
}

export function planarFaceToSvgPath(face: PlanarFace): string {
  const ring = face.polygon;
  if (ring.length === 0) return '';
  return `M ${ring[0].x} ${ring[0].y} ` + ring.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z';
}

/**
 * Converts a sequence of pointer points into a C1-smooth quadratic Bezier SVG path
 * using midpoint interpolation. Handles 1-point clicks/dabs, 2-point lines, and 3+ point curves.
 */
export function buildSmoothSvgTrailPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const fmt = (n: number) => Math.round(n * 100) / 100;
  const p0 = points[0];
  if (points.length === 1) {
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p0.x + 0.01)} ${fmt(p0.y)}`;
  }
  if (points.length === 2) {
    const p1 = points[1];
    return `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  const parts: string[] = [`M ${fmt(p0.x)} ${fmt(p0.y)}`];
  const firstMidX = (p0.x + points[1].x) * 0.5;
  const firstMidY = (p0.y + points[1].y) * 0.5;
  parts.push(`L ${fmt(firstMidX)} ${fmt(firstMidY)}`);
  for (let i = 1; i < points.length - 1; i += 1) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) * 0.5;
    const midY = (curr.y + next.y) * 0.5;
    parts.push(`Q ${fmt(curr.x)} ${fmt(curr.y)} ${fmt(midX)} ${fmt(midY)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(' ');
}

export function buildSpatialIndexForNodes(nodes: readonly DesignNode[]): SpatialIndexHandle {
  const entries: SpatialBoundsEntry[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    // Expand rotated bounds conservatively by bounding circle radius so rotated
    // nodes are never falsely culled or missed by spatial queries.
    const pad = node.rotation
      ? Math.hypot(node.width, node.height) * 0.5
      : 0;
    const cx = node.x + node.width * 0.5;
    const cy = node.y + node.height * 0.5;
    const strokePad = (node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'frame' || node.type === 'image')
      ? Math.max(4, (node.style.strokeWidth ?? 0) * 1.5)
      : 4;
    entries[i] = {
      id: node.id,
      minX: (pad > 0 ? cx - pad : node.x) - strokePad,
      minY: (pad > 0 ? cy - pad : node.y) - strokePad,
      maxX: (pad > 0 ? cx + pad : node.x + node.width) + strokePad,
      maxY: (pad > 0 ? cy + pad : node.y + node.height) + strokePad,
      zIndex: i,
    };
  }
  return getComputeKernels().spatial.buildIndex(entries, 256);
}

/**
 * Computes the visible artboard rect in canvas coordinates with a generous
 * overscan buffer so panning never flickers at viewport edges.
 * Returns null if measurements are unavailable (e.g., headless SSR / initial layout).
 */
export function computeVisibleArtboardRect(
  scrollArea: HTMLDivElement | null,
  svg: SVGSVGElement | null,
  docWidth: number,
  docHeight: number,
  overscanCanvasUnits = 240,
): SpatialQueryRect | null {
  if (!scrollArea || !svg) return null;
  const scrollRect = scrollArea.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (
    !Number.isFinite(scrollRect.width) || scrollRect.width <= 0 ||
    !Number.isFinite(scrollRect.height) || scrollRect.height <= 0 ||
    !Number.isFinite(svgRect.width) || svgRect.width <= 0 ||
    !Number.isFinite(svgRect.height) || svgRect.height <= 0
  ) {
    return null;
  }

  const scaleX = docWidth / svgRect.width;
  const scaleY = docHeight / svgRect.height;

  const minX = (scrollRect.left - svgRect.left) * scaleX - overscanCanvasUnits;
  const minY = (scrollRect.top - svgRect.top) * scaleY - overscanCanvasUnits;
  const maxX = (scrollRect.right - svgRect.left) * scaleX + overscanCanvasUnits;
  const maxY = (scrollRect.bottom - svgRect.top) * scaleY + overscanCanvasUnits;

  // If the entire artboard fits within the overscanned viewport, skip culling.
  if (minX <= 0 && minY <= 0 && maxX >= docWidth && maxY >= docHeight) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Filters visible render nodes against the active viewport rect using the
 * spatial index while preserving selected nodes and parent/mask dependencies.
 */
export function cullVisibleRenderNodes(
  visibleRenderNodes: readonly DesignNode[],
  spatialIndex: SpatialIndexHandle,
  viewportRect: SpatialQueryRect | null,
  selectedNodeIds: readonly string[],
  nodeById: ReadonlyMap<string, DesignNode>,
): readonly DesignNode[] {
  if (!viewportRect || visibleRenderNodes.length <= CANVAS_VIEWPORT_CULL_THRESHOLD) {
    return visibleRenderNodes;
  }

  const keepIds = new Set(spatialIndex.queryRect(viewportRect));
  for (let i = 0; i < selectedNodeIds.length; i += 1) {
    keepIds.add(selectedNodeIds[i]);
  }

  // Retain ancestor containers and clip mask bases for any kept node.
  const seed = Array.from(keepIds);
  for (let i = 0; i < seed.length; i += 1) {
    let cursor = nodeById.get(seed[i]);
    while (cursor) {
      if (cursor.clipMaskBaseId && !keepIds.has(cursor.clipMaskBaseId)) {
        keepIds.add(cursor.clipMaskBaseId);
      }
      if (cursor.parentId && !keepIds.has(cursor.parentId)) {
        keepIds.add(cursor.parentId);
        cursor = nodeById.get(cursor.parentId);
      } else {
        break;
      }
    }
  }

  if (keepIds.size >= visibleRenderNodes.length) {
    return visibleRenderNodes;
  }

  return visibleRenderNodes.filter((node) => keepIds.has(node.id));
}

export function buildCanvasPointerInput(
  event: JSX.TargetedPointerEvent<SVGSVGElement>,
  scrollArea: HTMLDivElement | null,
): CanvasToolPointerInput {
  const target = event.target as Element;
  const resizeElement = target.closest('[data-resize-handle]');
  const resizeHandle = resizeElement?.getAttribute('data-resize-handle') as ResizeHandle | null;
  const rotateHandle = Boolean(target.closest('[data-rotate-handle]'));
  const anchorElement = target.closest('[data-anchor-node-id]');
  let anchorHit: VectorAnchorHit | null = null;
  if (anchorElement) {
    const nodeId = anchorElement.getAttribute('data-anchor-node-id');
    const idxRaw = anchorElement.getAttribute('data-anchor-index');
    const part = anchorElement.getAttribute('data-anchor-part') as VectorAnchorHit['part'] | null;
    if (nodeId && idxRaw !== null && part) {
      const pointIndex = Number(idxRaw);
      if (Number.isInteger(pointIndex) && pointIndex >= 0) {
        anchorHit = { nodeId, pointIndex, part };
      }
    }
  }

  const smartEl = target.closest('[data-smart-handle]');
  let smartHandleHit: SmartHandleHit | null = null;
  if (smartEl) {
    const kind = smartEl.getAttribute('data-smart-handle');
    if (kind === 'corner-radius') {
      const nodeId = smartEl.getAttribute('data-smart-node-id');
      const corner = smartEl.getAttribute('data-smart-corner') as 'nw' | 'ne' | 'se' | 'sw' | null;
      if (nodeId && corner) smartHandleHit = { kind: 'corner-radius', nodeId, corner };
    } else if (kind === 'star-inner') {
      const nodeId = smartEl.getAttribute('data-smart-node-id');
      if (nodeId) smartHandleHit = { kind: 'star-inner', nodeId };
    } else if (kind === 'pivot') {
      smartHandleHit = { kind: 'pivot' };
    } else if (kind === 'autolayout-padding') {
      const nodeId = smartEl.getAttribute('data-smart-node-id');
      const edge = smartEl.getAttribute('data-smart-edge') as 'top' | 'right' | 'bottom' | 'left' | null;
      if (nodeId && (edge === 'top' || edge === 'right' || edge === 'bottom' || edge === 'left')) {
        smartHandleHit = { kind: 'autolayout-padding', nodeId, edge };
      }
    } else if (kind === 'autolayout-gap') {
      const nodeId = smartEl.getAttribute('data-smart-node-id');
      const axis = smartEl.getAttribute('data-smart-axis') as 'horizontal' | 'vertical' | null;
      const gapIndexRaw = smartEl.getAttribute('data-smart-gap-index');
      const gapIndex = gapIndexRaw !== null ? Number(gapIndexRaw) : 0;
      if (nodeId && (axis === 'horizontal' || axis === 'vertical') && Number.isInteger(gapIndex) && gapIndex >= 0) {
        smartHandleHit = { kind: 'autolayout-gap', nodeId, axis, gapIndex };
      }
    }
  }

  const scrollRect = scrollArea?.getBoundingClientRect();
  return {
    pointerId: event.pointerId,
    button: event.button,
    point: toCanvasPoint(event.currentTarget, event.clientX, event.clientY),
    clientX: event.clientX,
    clientY: event.clientY,
    viewportAnchor: scrollRect ? {
      x: event.clientX - scrollRect.left - scrollRect.width / 2,
      y: event.clientY - scrollRect.top - scrollRect.height / 2,
    } : { x: 0, y: 0 },
    targetNodeId: target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
    resizeHandle,
    rotateHandle,
    anchorHit,
    smartHandleHit,
    detail: event.detail,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

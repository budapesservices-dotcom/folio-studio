import type { DesignNode } from '../../core/document/types';
import { scalePathNodeGeometry } from '../../core/document/vector';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Alignment =
  | 'left'
  | 'horizontal-center'
  | 'right'
  | 'top'
  | 'vertical-center'
  | 'bottom';

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export function getBounds(nodes: readonly Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>[]): Bounds | null {
  if (nodes.length === 0) return null;
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function anchors(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

function findSnap(
  movingAnchors: number[],
  targetAnchors: number[],
  tolerance: number,
): { adjustment: number; position: number } | null {
  let bestDistance = tolerance + 0.0001;
  let best: { adjustment: number; position: number } | null = null;

  for (const moving of movingAnchors) {
    for (const target of targetAnchors) {
      const adjustment = target - moving;
      const distance = Math.abs(adjustment);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { adjustment, position: target };
      }
    }
  }

  return best;
}

export function snapTranslation(
  nodes: readonly DesignNode[],
  dx: number,
  dy: number,
  canvas: Bounds,
  otherNodes: readonly DesignNode[],
  tolerance: number,
): SnapResult {
  const movingBounds = getBounds(nodes);
  if (!movingBounds || tolerance <= 0) return { dx, dy, guides: [] };

  const targets = [canvas, ...otherNodes.map((node) => ({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }))];

  const targetX = targets.flatMap((bounds) => anchors(bounds.x, bounds.width));
  const targetY = targets.flatMap((bounds) => anchors(bounds.y, bounds.height));
  const snapX = findSnap(
    anchors(movingBounds.x + dx, movingBounds.width),
    targetX,
    tolerance,
  );
  const snapY = findSnap(
    anchors(movingBounds.y + dy, movingBounds.height),
    targetY,
    tolerance,
  );

  return {
    dx: dx + (snapX?.adjustment ?? 0),
    dy: dy + (snapY?.adjustment ?? 0),
    guides: [
      ...(snapX ? [{ axis: 'x' as const, position: snapX.position }] : []),
      ...(snapY ? [{ axis: 'y' as const, position: snapY.position }] : []),
    ],
  };
}

export function snapResizeBounds(
  bounds: Bounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  canvas: Bounds,
  otherNodes: readonly DesignNode[],
  tolerance: number,
  options: { lockAspect?: boolean; fromCenter?: boolean } = {},
): SnapResult {
  if (tolerance <= 0 || options.fromCenter) return { dx, dy, guides: [] };

  const targets = [canvas, ...otherNodes.map((node) => ({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }))];
  const targetX = targets.flatMap((b) => anchors(b.x, b.width));
  const targetY = targets.flatMap((b) => anchors(b.y, b.height));

  let snappedDx = dx;
  let snappedDy = dy;
  const guides: SnapGuide[] = [];

  const snapXEdge = (): { adjustment: number; position: number } | null => {
    if (handle.includes('e')) {
      return findSnap([bounds.x + bounds.width + dx], targetX, tolerance);
    }
    if (handle.includes('w')) {
      return findSnap([bounds.x + dx], targetX, tolerance);
    }
    return null;
  };

  const snapYEdge = (): { adjustment: number; position: number } | null => {
    if (handle.includes('s')) {
      return findSnap([bounds.y + bounds.height + dy], targetY, tolerance);
    }
    if (handle.includes('n')) {
      return findSnap([bounds.y + dy], targetY, tolerance);
    }
    return null;
  };

  if (options.lockAspect && (handle.includes('e') || handle.includes('w')) && (handle.includes('n') || handle.includes('s'))) {
    // For aspect-locked corners, snap only the dominant drag axis so proportions stay exact.
    const widthRatio = Math.abs(dx) / Math.max(1, bounds.width);
    const heightRatio = Math.abs(dy) / Math.max(1, bounds.height);
    if (widthRatio >= heightRatio) {
      const snapX = snapXEdge();
      if (snapX) {
        snappedDx = dx + snapX.adjustment;
        guides.push({ axis: 'x', position: snapX.position });
      }
    } else {
      const snapY = snapYEdge();
      if (snapY) {
        snappedDy = dy + snapY.adjustment;
        guides.push({ axis: 'y', position: snapY.position });
      }
    }
    return { dx: snappedDx, dy: snappedDy, guides };
  }

  const snapX = snapXEdge();
  if (snapX) {
    snappedDx = dx + snapX.adjustment;
    guides.push({ axis: 'x', position: snapX.position });
  }
  const snapY = snapYEdge();
  if (snapY) {
    snappedDy = dy + snapY.adjustment;
    guides.push({ axis: 'y', position: snapY.position });
  }

  return { dx: snappedDx, dy: snappedDy, guides };
}

function roundGeom(value: number): number {
  return Math.round(value * 100) / 100;
}

export function nodesGeometryChanged(
  before: readonly DesignNode[],
  after: readonly DesignNode[] | undefined | null,
): boolean {
  if (!after || after.length !== before.length) return false;
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a.id !== b.id) return true;
    if (
      Math.abs(a.x - b.x) > 0.005 ||
      Math.abs(a.y - b.y) > 0.005 ||
      Math.abs(a.width - b.width) > 0.005 ||
      Math.abs(a.height - b.height) > 0.005 ||
      Math.abs((a.rotation || 0) - (b.rotation || 0)) > 0.005
    ) {
      return true;
    }
    if ((a.type === 'rect' || a.type === 'frame') && (b.type === 'rect' || b.type === 'frame')) {
      if (Math.abs((a.style.radius ?? 0) - (b.style.radius ?? 0)) > 0.005) return true;
      if (Math.abs(a.style.strokeWidth - b.style.strokeWidth) > 0.005) return true;
    }
    if (a.type === 'text' && b.type === 'text') {
      if (Math.abs(a.style.fontSize - b.style.fontSize) > 0.005) return true;
    }
    if (a.type === 'path' && b.type === 'path') {
      if (a.points.length !== b.points.length || a.closed !== b.closed) return true;
      for (let j = 0; j < a.points.length; j++) {
        const pa = a.points[j];
        const pb = b.points[j];
        if (
          Math.abs(pa.x - pb.x) > 0.005 ||
          Math.abs(pa.y - pb.y) > 0.005 ||
          pa.pointType !== pb.pointType ||
          Boolean(pa.handleIn) !== Boolean(pb.handleIn) ||
          Boolean(pa.handleOut) !== Boolean(pb.handleOut) ||
          (pa.handleIn && pb.handleIn && (Math.abs(pa.handleIn.x - pb.handleIn.x) > 0.005 || Math.abs(pa.handleIn.y - pb.handleIn.y) > 0.005)) ||
          (pa.handleOut && pb.handleOut && (Math.abs(pa.handleOut.x - pb.handleOut.x) > 0.005 || Math.abs(pa.handleOut.y - pb.handleOut.y) > 0.005))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function resizeNodes(
  nodes: readonly DesignNode[],
  bounds: Bounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: { uniformScale?: boolean; fromCenter?: boolean; constrainAspect?: boolean } = {},
): DesignNode[] {
  const minimum = 8;
  const safeBoundsW = Math.max(1, bounds.width);
  const safeBoundsH = Math.max(1, bounds.height);
  const minW = Math.min(minimum, safeBoundsW);
  const minH = Math.min(minimum, safeBoundsH);
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
  const lockAspect = isCorner || Boolean(options.uniformScale) || Boolean(options.constrainAspect);
  const multiplier = options.fromCenter ? 2 : 1;

  if (lockAspect) {
    const signedWidthChange =
      ((handle.includes('e') ? dx : handle.includes('w') ? -dx : 0) * multiplier) /
      Math.max(minimum, safeBoundsW);
    const signedHeightChange =
      ((handle.includes('s') ? dy : handle.includes('n') ? -dy : 0) * multiplier) /
      Math.max(minimum, safeBoundsH);
    const scaleChange =
      Math.abs(signedWidthChange) >= Math.abs(signedHeightChange)
        ? signedWidthChange
        : signedHeightChange;
    const minimumScale = Math.max(
      minW / safeBoundsW,
      minH / safeBoundsH,
    );
    const scale = Math.max(minimumScale, 1 + scaleChange);
    const nextWidth = bounds.width * scale;
    const nextHeight = bounds.height * scale;

    if (options.fromCenter) {
      left = centerX - nextWidth / 2;
      right = centerX + nextWidth / 2;
      top = centerY - nextHeight / 2;
      bottom = centerY + nextHeight / 2;
    } else {
      if (handle.includes('w')) left = right - nextWidth;
      else if (handle.includes('e')) right = left + nextWidth;
      else {
        left = centerX - nextWidth / 2;
        right = centerX + nextWidth / 2;
      }

      if (handle.includes('n')) top = bottom - nextHeight;
      else if (handle.includes('s')) bottom = top + nextHeight;
      else {
        top = centerY - nextHeight / 2;
        bottom = centerY + nextHeight / 2;
      }
    }
  } else if (options.fromCenter) {
    if (handle.includes('w') || handle.includes('e')) {
      const signedDx = handle.includes('e') ? dx : -dx;
      const nextWidth = Math.max(minW, bounds.width + signedDx * 2);
      left = centerX - nextWidth / 2;
      right = centerX + nextWidth / 2;
    }
    if (handle.includes('n') || handle.includes('s')) {
      const signedDy = handle.includes('s') ? dy : -dy;
      const nextHeight = Math.max(minH, bounds.height + signedDy * 2);
      top = centerY - nextHeight / 2;
      bottom = centerY + nextHeight / 2;
    }
  } else {
    // Side handles resize on one axis only; the opposite edge stays anchored.
    if (handle.includes('w')) left = Math.min(right - minW, left + dx);
    if (handle.includes('e')) right = Math.max(left + minW, right + dx);
    if (handle.includes('n')) top = Math.min(bottom - minH, top + dy);
    if (handle.includes('s')) bottom = Math.max(top + minH, bottom + dy);
  }

  const scaleX = (right - left) / safeBoundsW;
  const scaleY = (bottom - top) / safeBoundsH;
  const fontScale =
    !lockAspect && (handle === 'e' || handle === 'w')
      ? scaleX
      : !lockAspect && (handle === 'n' || handle === 's')
        ? scaleY
        : Math.min(scaleX, scaleY);

  return nodes.map((node): DesignNode => {
    const nodeMinW = Math.min(minimum, Math.max(1, node.width));
    const nodeMinH = Math.min(minimum, Math.max(1, node.height));
    const x = roundGeom(left + (node.x - bounds.x) * scaleX);
    const y = roundGeom(top + (node.y - bounds.y) * scaleY);
    const width = roundGeom(Math.max(nodeMinW, node.width * scaleX));
    const height = roundGeom(Math.max(nodeMinH, node.height * scaleY));

    if (node.type === 'text') {
      return {
        ...node,
        x,
        y,
        width,
        height,
        style: {
          ...node.style,
          fontSize: Math.max(8, roundGeom(node.style.fontSize * fontScale)),
        },
      };
    }

    if (node.type === 'rect' || node.type === 'frame') {
      return {
        ...node,
        x,
        y,
        width,
        height,
        style: {
          ...node.style,
          radius: node.style.radius === undefined ? undefined : roundGeom(node.style.radius * fontScale),
          strokeWidth: options.uniformScale
            ? Math.max(0, roundGeom(node.style.strokeWidth * fontScale))
            : node.style.strokeWidth,
        },
      };
    }

    if (node.type === 'ellipse') {
      return {
        ...node,
        x,
        y,
        width,
        height,
        style: options.uniformScale
          ? { ...node.style, strokeWidth: Math.max(0, roundGeom(node.style.strokeWidth * fontScale)) }
          : node.style,
      };
    }

    if (node.type === 'path') {
      return scalePathNodeGeometry(
        node,
        x,
        y,
        width,
        height,
        options.uniformScale ? fontScale : undefined,
      );
    }

    return { ...node, x, y, width, height };
  });
}

/**
 * Rotates one or more layers around a shared world pivot point, orbiting each
 * layer's center around the pivot while incrementing its rotation angle cleanly.
 */
export function rotateNodesAroundPivot(
  nodes: readonly DesignNode[],
  deltaDeg: number,
  pivot: { x: number; y: number },
): DesignNode[] {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return nodes.map((node) => {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const relX = cx - pivot.x;
    const relY = cy - pivot.y;
    const nextCx = pivot.x + relX * cos - relY * sin;
    const nextCy = pivot.y + relX * sin + relY * cos;
    const nextRotation = Math.round((((node.rotation || 0) + deltaDeg) % 360) * 10) / 10;
    return {
      ...node,
      x: Math.round((nextCx - node.width / 2) * 100) / 100,
      y: Math.round((nextCy - node.height / 2) * 100) / 100,
      rotation: nextRotation,
    };
  });
}

export interface SpacingRedlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
  orientation: 'horizontal' | 'vertical';
}

export interface SpacingExtensionLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpacingRedlineResult {
  targetBounds: Bounds;
  segments: SpacingRedlineSegment[];
  extensions: SpacingExtensionLine[];
}

/**
 * Computes Figma-grade Alt-Hover Spacing Redlines between the active selection
 * and a hovered target layer (or artboard boundary when hovering empty canvas).
 */
export function computeSpacingRedlines(
  source: Bounds,
  target: Bounds,
): SpacingRedlineResult {
  const segments: SpacingRedlineSegment[] = [];
  const extensions: SpacingExtensionLine[] = [];

  const sL = source.x;
  const sR = source.x + source.width;
  const sT = source.y;
  const sB = source.y + source.height;
  const sCx = sL + source.width / 2;
  const sCy = sT + source.height / 2;

  const tL = target.x;
  const tR = target.x + target.width;
  const tT = target.y;
  const tB = target.y + target.height;

  const sourceInsideTarget = sL >= tL - 0.5 && sR <= tR + 0.5 && sT >= tT - 0.5 && sB <= tB + 0.5;
  const targetInsideSource = tL >= sL - 0.5 && tR <= sR + 0.5 && tT >= sT - 0.5 && tB <= sB + 0.5;

  if (sourceInsideTarget || targetInsideSource) {
    const inner = sourceInsideTarget ? source : target;
    const outer = sourceInsideTarget ? target : source;
    const iCx = inner.x + inner.width / 2;
    const iCy = inner.y + inner.height / 2;
    const leftGap = Math.round(inner.x - outer.x);
    const rightGap = Math.round(outer.x + outer.width - (inner.x + inner.width));
    const topGap = Math.round(inner.y - outer.y);
    const bottomGap = Math.round(outer.y + outer.height - (inner.y + inner.height));

    if (leftGap > 0) segments.push({ x1: outer.x, y1: iCy, x2: inner.x, y2: iCy, value: leftGap, orientation: 'horizontal' });
    if (rightGap > 0) segments.push({ x1: inner.x + inner.width, y1: iCy, x2: outer.x + outer.width, y2: iCy, value: rightGap, orientation: 'horizontal' });
    if (topGap > 0) segments.push({ x1: iCx, y1: outer.y, x2: iCx, y2: inner.y, value: topGap, orientation: 'vertical' });
    if (bottomGap > 0) segments.push({ x1: iCx, y1: inner.y + inner.height, x2: iCx, y2: outer.y + outer.height, value: bottomGap, orientation: 'vertical' });
    return { targetBounds: target, segments, extensions };
  }

  // Horizontal separation
  const overlapTop = Math.max(sT, tT);
  const overlapBottom = Math.min(sB, tB);
  const hasVerticalOverlap = overlapBottom > overlapTop;
  const hLineY = hasVerticalOverlap ? (overlapTop + overlapBottom) / 2 : sCy;

  if (sR < tL) {
    const gap = Math.round(tL - sR);
    if (gap > 0) {
      segments.push({ x1: sR, y1: hLineY, x2: tL, y2: hLineY, value: gap, orientation: 'horizontal' });
      if (!hasVerticalOverlap) {
        const extY = hLineY < tT ? tT : tB;
        extensions.push({ x1: tL, y1: hLineY, x2: tL, y2: extY });
      }
    }
  } else if (tR < sL) {
    const gap = Math.round(sL - tR);
    if (gap > 0) {
      segments.push({ x1: tR, y1: hLineY, x2: sL, y2: hLineY, value: gap, orientation: 'horizontal' });
      if (!hasVerticalOverlap) {
        const extY = hLineY < tT ? tT : tB;
        extensions.push({ x1: tR, y1: hLineY, x2: tR, y2: extY });
      }
    }
  }

  // Vertical separation
  const overlapLeft = Math.max(sL, tL);
  const overlapRight = Math.min(sR, tR);
  const hasHorizontalOverlap = overlapRight > overlapLeft;
  const vLineX = hasHorizontalOverlap ? (overlapLeft + overlapRight) / 2 : sCx;

  if (sB < tT) {
    const gap = Math.round(tT - sB);
    if (gap > 0) {
      segments.push({ x1: vLineX, y1: sB, x2: vLineX, y2: tT, value: gap, orientation: 'vertical' });
      if (!hasHorizontalOverlap) {
        const extX = vLineX < tL ? tL : tR;
        extensions.push({ x1: vLineX, y1: tT, x2: extX, y2: tT });
      }
    }
  } else if (tB < sT) {
    const gap = Math.round(sT - tB);
    if (gap > 0) {
      segments.push({ x1: vLineX, y1: tB, x2: vLineX, y2: sT, value: gap, orientation: 'vertical' });
      if (!hasHorizontalOverlap) {
        const extX = vLineX < tL ? tL : tR;
        extensions.push({ x1: vLineX, y1: tB, x2: extX, y2: tB });
      }
    }
  }

  // Partial overlap without containment: show top/left alignment offset deltas
  if (segments.length === 0) {
    const dx = Math.round(Math.abs(sL - tL));
    const dy = Math.round(Math.abs(sT - tT));
    if (dx > 0) segments.push({ x1: Math.min(sL, tL), y1: sCy, x2: Math.max(sL, tL), y2: sCy, value: dx, orientation: 'horizontal' });
    if (dy > 0) segments.push({ x1: sCx, y1: Math.min(sT, tT), x2: sCx, y2: Math.max(sT, tT), value: dy, orientation: 'vertical' });
  }

  return { targetBounds: target, segments, extensions };
}

/**
 * Magnetically snaps a canvas point to the nearest 9-point anchor (corners, edge midpoints,
 * or center) of any provided target bounds within `tolerance`.
 */
export function snapPointToTargets(
  point: { x: number; y: number },
  targets: readonly Bounds[],
  tolerance: number,
): { point: { x: number; y: number }; snapped: boolean } {
  let bestDist = tolerance;
  let best: { x: number; y: number } | null = null;

  for (const b of targets) {
    const xs = [b.x, b.x + b.width / 2, b.x + b.width];
    const ys = [b.y, b.y + b.height / 2, b.y + b.height];
    for (const x of xs) {
      for (const y of ys) {
        const d = Math.hypot(point.x - x, point.y - y);
        if (d <= bestDist) {
          bestDist = d;
          best = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
        }
      }
    }
  }

  return best ? { point: best, snapped: true } : { point, snapped: false };
}

export function alignNodes(nodes: readonly DesignNode[], alignment: Alignment): DesignNode[] {
  if (nodes.length < 2) return [...nodes];
  const bounds = getBounds(nodes);
  if (!bounds) return [...nodes];

  return nodes.map((node) => {
    switch (alignment) {
      case 'left':
        return { ...node, x: bounds.x };
      case 'horizontal-center':
        return { ...node, x: bounds.x + (bounds.width - node.width) / 2 };
      case 'right':
        return { ...node, x: bounds.x + bounds.width - node.width };
      case 'top':
        return { ...node, y: bounds.y };
      case 'vertical-center':
        return { ...node, y: bounds.y + (bounds.height - node.height) / 2 };
      case 'bottom':
        return { ...node, y: bounds.y + bounds.height - node.height };
    }
  });
}


export type DistributionAxis = 'horizontal' | 'vertical';

export function distributeNodes(
  nodes: readonly DesignNode[],
  axis: DistributionAxis,
): DesignNode[] {
  if (nodes.length < 3) return [...nodes];

  const positionKey = axis === 'horizontal' ? 'x' : 'y';
  const sizeKey = axis === 'horizontal' ? 'width' : 'height';
  const sorted = [...nodes].sort((a, b) => {
    const positionDifference = a[positionKey] - b[positionKey];
    if (positionDifference !== 0) return positionDifference;
    const secondaryA = axis === 'horizontal' ? a.y : a.x;
    const secondaryB = axis === 'horizontal' ? b.y : b.x;
    return secondaryA - secondaryB || a.id.localeCompare(b.id);
  });

  const start = Math.min(...sorted.map((node) => node[positionKey]));
  const end = Math.max(...sorted.map((node) => node[positionKey] + node[sizeKey]));
  const occupied = sorted.reduce((total, node) => total + node[sizeKey], 0);
  const gap = (end - start - occupied) / (sorted.length - 1);

  const positions = new Map<string, number>();
  let cursor = start;
  for (const node of sorted) {
    positions.set(node.id, cursor);
    cursor += node[sizeKey] + gap;
  }

  return nodes.map((node) => ({
    ...node,
    [positionKey]: positions.get(node.id) ?? node[positionKey],
  }));
}

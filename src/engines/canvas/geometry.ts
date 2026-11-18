import type { DesignNode } from '../../core/document/types';

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

export function resizeNodes(
  nodes: readonly DesignNode[],
  bounds: Bounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): DesignNode[] {
  const minimum = 8;
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;

  if (handle.includes('w')) left = Math.min(right - minimum, left + dx);
  if (handle.includes('e')) right = Math.max(left + minimum, right + dx);
  if (handle.includes('n')) top = Math.min(bottom - minimum, top + dy);
  if (handle.includes('s')) bottom = Math.max(top + minimum, bottom + dy);

  const scaleX = (right - left) / Math.max(minimum, bounds.width);
  const scaleY = (bottom - top) / Math.max(minimum, bounds.height);
  const fontScale = Math.min(scaleX, scaleY);

  return nodes.map((node) => {
    const resized = {
      ...node,
      x: left + (node.x - bounds.x) * scaleX,
      y: top + (node.y - bounds.y) * scaleY,
      width: Math.max(minimum, node.width * scaleX),
      height: Math.max(minimum, node.height * scaleY),
    };

    if (node.type === 'text') {
      return {
        ...resized,
        style: { ...node.style, fontSize: Math.max(8, node.style.fontSize * fontScale) },
      };
    }

    if (node.type === 'rect') {
      return {
        ...resized,
        style: {
          ...node.style,
          radius: node.style.radius === undefined ? undefined : node.style.radius * fontScale,
        },
      };
    }

    return resized;
  });
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

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

  const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
  if (isCorner) {
    // Corner handles keep the selection's aspect ratio. The opposite corner
    // stays anchored while the dominant pointer axis determines the scale.
    const signedWidthChange = (handle.includes('e') ? dx : -dx) / Math.max(minimum, bounds.width);
    const signedHeightChange = (handle.includes('s') ? dy : -dy) / Math.max(minimum, bounds.height);
    const scaleChange = Math.abs(signedWidthChange) >= Math.abs(signedHeightChange)
      ? signedWidthChange
      : signedHeightChange;
    const minimumScale = Math.max(
      minimum / Math.max(minimum, bounds.width),
      minimum / Math.max(minimum, bounds.height),
    );
    const scale = Math.max(minimumScale, 1 + scaleChange);
    const nextWidth = bounds.width * scale;
    const nextHeight = bounds.height * scale;

    if (handle.includes('w')) left = right - nextWidth;
    else right = left + nextWidth;

    if (handle.includes('n')) top = bottom - nextHeight;
    else bottom = top + nextHeight;
  } else {
    // Side handles resize on one axis only; the opposite edge stays anchored.
    if (handle.includes('w')) left = Math.min(right - minimum, left + dx);
    if (handle.includes('e')) right = Math.max(left + minimum, right + dx);
    if (handle.includes('n')) top = Math.min(bottom - minimum, top + dy);
    if (handle.includes('s')) bottom = Math.max(top + minimum, bottom + dy);
  }

  const scaleX = (right - left) / Math.max(minimum, bounds.width);
  const scaleY = (bottom - top) / Math.max(minimum, bounds.height);
  const fontScale = handle === 'e' || handle === 'w'
    ? scaleX
    : handle === 'n' || handle === 's'
      ? scaleY
      : Math.min(scaleX, scaleY);

  return nodes.map((node): DesignNode => {
    const x = left + (node.x - bounds.x) * scaleX;
    const y = top + (node.y - bounds.y) * scaleY;
    const width = Math.max(minimum, node.width * scaleX);
    const height = Math.max(minimum, node.height * scaleY);

    // Preserve each discriminated node type and its corresponding style schema.
    if (node.type === 'text') {
      return {
        ...node,
        x,
        y,
        width,
        height,
        style: {
          ...node.style,
          fontSize: Math.max(8, node.style.fontSize * fontScale),
        },
      };
    }

    if (node.type === 'rect') {
      return {
        ...node,
        x,
        y,
        width,
        height,
        style: {
          ...node.style,
          radius: node.style.radius === undefined ? undefined : node.style.radius * fontScale,
        },
      };
    }

    return { ...node, x, y, width, height };
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

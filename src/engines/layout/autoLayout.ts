import type {
  BreakpointId,
  DesignNode,
  DesignTokenCollection,
  NodeLayoutConfig,
  NodePadding,
} from '../../core/document/types';
import { resolveNodeWithTokens } from '../../core/document/tokens';

export const BREAKPOINT_PRESETS: Record<BreakpointId, { id: BreakpointId; label: string; width: number }> = {
  desktop: { id: 'desktop', label: 'Desktop', width: 1440 },
  tablet: { id: 'tablet', label: 'Tablet', width: 768 },
  mobile: { id: 'mobile', label: 'Mobile', width: 390 },
};

export const DEFAULT_NODE_PADDING: NodePadding = {
  top: 16,
  right: 16,
  bottom: 16,
  left: 16,
};

export function createDefaultAutoLayout(mode: 'flex' | 'grid' = 'flex'): NodeLayoutConfig {
  return {
    mode,
    direction: 'row',
    wrap: 'nowrap',
    justifyContent: 'start',
    alignItems: 'start',
    gap: 16,
    ...(mode === 'grid' ? { gridColumns: 2, columnGap: 16, rowGap: 16 } : {}),
    padding: { ...DEFAULT_NODE_PADDING },
  };
}

export function getBreakpointCanvasWidth(documentWidth: number, breakpoint: BreakpointId): number {
  if (breakpoint === 'desktop') return documentWidth;
  return Math.min(documentWidth, BREAKPOINT_PRESETS[breakpoint].width);
}

/**
 * Applies per-breakpoint responsive overrides non-destructively.
 * Tablet inherits from Desktop; Mobile inherits from Tablet then Desktop.
 */
export function resolveEffectiveNodeForBreakpoint<T extends DesignNode>(
  node: T,
  breakpoint: BreakpointId,
): T {
  if (breakpoint === 'desktop' || !node.responsive) return node;

  const tabletOverride = node.responsive.tablet;
  const mobileOverride = breakpoint === 'mobile' ? node.responsive.mobile : undefined;

  const merged = {
    ...(tabletOverride ?? {}),
    ...(mobileOverride ?? {}),
  };

  if (Object.keys(merged).length === 0) return node;

  const nextLayout = node.layout
    ? {
        ...node.layout,
        ...(merged.layoutDirection !== undefined ? { direction: merged.layoutDirection } : {}),
        ...(merged.gridColumns !== undefined ? { gridColumns: Math.max(1, Math.round(merged.gridColumns)) } : {}),
        ...(merged.gap !== undefined ? { gap: Math.max(0, merged.gap) } : {}),
        ...(merged.padding !== undefined ? { padding: { ...merged.padding } } : {}),
      }
    : undefined;

  return {
    ...node,
    ...(merged.visible !== undefined ? { visible: merged.visible } : {}),
    ...(merged.width !== undefined ? { width: Math.max(1, merged.width) } : {}),
    ...(merged.height !== undefined ? { height: Math.max(1, merged.height) } : {}),
    ...(nextLayout ? { layout: nextLayout } : {}),
  };
}

export interface AutoLayoutComputeOptions {
  breakpoint?: BreakpointId;
  tokens?: DesignTokenCollection;
  canvasWidth?: number;
  /** When set, only solve layout for the specified container ID and its descendants. */
  onlyContainerId?: string;
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampSize(value: number, min?: number, max?: number): number {
  let result = Math.max(1, value);
  if (min !== undefined && Number.isFinite(min)) result = Math.max(min, result);
  if (max !== undefined && Number.isFinite(max)) result = Math.min(max, result);
  return roundPx(result);
}

function shiftSubtree(
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
  rootId: string,
  dx: number,
  dy: number,
): void {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  const childIds = childrenByParent.get(rootId);
  if (!childIds) return;
  for (const childId of childIds) {
    const child = nodeById.get(childId);
    if (!child) continue;
    nodeById.set(childId, {
      ...child,
      x: roundPx(child.x + dx),
      y: roundPx(child.y + dy),
    });
    shiftSubtree(nodeById, childrenByParent, childId, dx, dy);
  }
}

function solveFlexContainer(
  container: DesignNode,
  children: DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  const layout = container.layout;
  if (!layout || layout.mode !== 'flex') return;

  const isRow = layout.direction === 'row';
  const wrap = layout.wrap === 'wrap';
  const justify = layout.justifyContent ?? 'start';
  const align = layout.alignItems ?? 'start';
  const gap = Math.max(0, layout.gap);
  const pad = layout.padding;

  const contentX = container.x + pad.left;
  const contentY = container.y + pad.top;
  const innerWidth = Math.max(1, container.width - pad.left - pad.right);
  const innerHeight = Math.max(1, container.height - pad.top - pad.bottom);
  const mainAvailable = isRow ? innerWidth : innerHeight;
  const crossAvailable = isRow ? innerHeight : innerWidth;

  interface FlexItem {
    node: DesignNode;
    mainSize: number;
    crossSize: number;
    isFillMain: boolean;
    isFillCross: boolean;
    grow: number;
  }

  const items: FlexItem[] = children.map((child) => {
    const childCfg = child.layoutChild;
    const widthMode = childCfg?.widthMode ?? 'fixed';
    const heightMode = childCfg?.heightMode ?? 'fixed';
    const isFillMain = isRow ? widthMode === 'fill' : heightMode === 'fill';
    const isFillCross = isRow ? heightMode === 'fill' : widthMode === 'fill';
    const grow = Math.max(0, childCfg?.flexGrow ?? (isFillMain ? 1 : 0));
    return {
      node: child,
      mainSize: isRow ? child.width : child.height,
      crossSize: isRow ? child.height : child.width,
      isFillMain,
      isFillCross,
      grow,
    };
  });

  // Partition into lines (single line when nowrap)
  const lines: FlexItem[][] = [];
  if (!wrap) {
    lines.push(items);
  } else {
    let currentLine: FlexItem[] = [];
    let lineMain = 0;
    for (const item of items) {
      const nextMain = currentLine.length === 0 ? item.mainSize : lineMain + gap + item.mainSize;
      if (currentLine.length > 0 && nextMain > mainAvailable + 0.5) {
        lines.push(currentLine);
        currentLine = [item];
        lineMain = item.mainSize;
      } else {
        currentLine.push(item);
        lineMain = nextMain;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);
  }

  let crossCursor = 0;
  let totalUsedMainMax = 0;

  for (const line of lines) {
    const totalGaps = Math.max(0, line.length - 1) * gap;
    const fixedMain = line.reduce((sum, item) => sum + (item.isFillMain ? 0 : item.mainSize), 0);
    const totalGrow = line.reduce((sum, item) => sum + (item.isFillMain ? Math.max(1, item.grow) : 0), 0);
    const remainingForFill = Math.max(0, mainAvailable - fixedMain - totalGaps);

    for (const item of line) {
      if (item.isFillMain && totalGrow > 0) {
        const share = (remainingForFill * Math.max(1, item.grow)) / totalGrow;
        const cfg = item.node.layoutChild;
        item.mainSize = isRow
          ? clampSize(share, cfg?.minWidth, cfg?.maxWidth)
          : clampSize(share, cfg?.minHeight, cfg?.maxHeight);
      }
    }

    const lineCrossTarget = lines.length === 1
      ? crossAvailable
      : Math.max(...line.map((item) => item.crossSize), 1);

    for (const item of line) {
      const effectiveAlign = item.node.layoutChild?.alignSelf && item.node.layoutChild.alignSelf !== 'auto'
        ? item.node.layoutChild.alignSelf
        : align;
      if (item.isFillCross || effectiveAlign === 'stretch') {
        const cfg = item.node.layoutChild;
        item.crossSize = isRow
          ? clampSize(lineCrossTarget, cfg?.minHeight, cfg?.maxHeight)
          : clampSize(lineCrossTarget, cfg?.minWidth, cfg?.maxWidth);
      }
    }

    const lineMainSum = line.reduce((sum, item) => sum + item.mainSize, 0) + totalGaps;
    totalUsedMainMax = Math.max(totalUsedMainMax, lineMainSum);
    const freeSpace = Math.max(0, mainAvailable - lineMainSum);

    let mainCursor = 0;
    let itemStepGap = gap;

    if (justify === 'center') {
      mainCursor = freeSpace / 2;
    } else if (justify === 'end') {
      mainCursor = freeSpace;
    } else if (justify === 'space-between' && line.length > 1) {
      itemStepGap = gap + freeSpace / (line.length - 1);
    } else if (justify === 'space-around' && line.length > 0) {
      const extra = freeSpace / line.length;
      mainCursor = extra / 2;
      itemStepGap = gap + extra;
    }

    const lineActualCross = Math.max(...line.map((item) => item.crossSize), 0);
    const alignBoxCross = lines.length === 1 ? Math.max(crossAvailable, lineActualCross) : lineActualCross;

    for (const item of line) {
      const effectiveAlign = item.node.layoutChild?.alignSelf && item.node.layoutChild.alignSelf !== 'auto'
        ? item.node.layoutChild.alignSelf
        : align;
      let crossOffset = 0;
      if (effectiveAlign === 'center') {
        crossOffset = (alignBoxCross - item.crossSize) / 2;
      } else if (effectiveAlign === 'end') {
        crossOffset = alignBoxCross - item.crossSize;
      }

      const nextX = roundPx(isRow ? contentX + mainCursor : contentX + crossCursor + crossOffset);
      const nextY = roundPx(isRow ? contentY + crossCursor + crossOffset : contentY + mainCursor);
      const nextW = roundPx(isRow ? item.mainSize : item.crossSize);
      const nextH = roundPx(isRow ? item.crossSize : item.mainSize);

      const prev = nodeById.get(item.node.id) ?? item.node;
      const dx = nextX - prev.x;
      const dy = nextY - prev.y;
      nodeById.set(prev.id, {
        ...prev,
        x: nextX,
        y: nextY,
        width: Math.max(1, nextW),
        height: Math.max(1, nextH),
      });
      shiftSubtree(nodeById, childrenByParent, prev.id, dx, dy);

      mainCursor += item.mainSize + itemStepGap;
    }

    crossCursor += lineActualCross + gap;
  }

  // Hug-contents resizing on the container itself when requested
  const containerWidthMode = container.layoutChild?.widthMode ?? 'fixed';
  const containerHeightMode = container.layoutChild?.heightMode ?? 'fixed';
  const totalCrossUsed = Math.max(0, crossCursor - (lines.length > 0 ? gap : 0));

  let nextContainerW = container.width;
  let nextContainerH = container.height;
  if (containerWidthMode === 'hug') {
    const contentW = isRow ? totalUsedMainMax : totalCrossUsed;
    nextContainerW = clampSize(contentW + pad.left + pad.right, container.layoutChild?.minWidth, container.layoutChild?.maxWidth);
  }
  if (containerHeightMode === 'hug') {
    const contentH = isRow ? totalCrossUsed : totalUsedMainMax;
    nextContainerH = clampSize(contentH + pad.top + pad.bottom, container.layoutChild?.minHeight, container.layoutChild?.maxHeight);
  }
  if (nextContainerW !== container.width || nextContainerH !== container.height) {
    const latest = nodeById.get(container.id) ?? container;
    nodeById.set(container.id, {
      ...latest,
      width: nextContainerW,
      height: nextContainerH,
    });
  }
}

function solveGridContainer(
  container: DesignNode,
  children: DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  const layout = container.layout;
  if (!layout || layout.mode !== 'grid') return;

  const cols = Math.max(1, Math.round(layout.gridColumns ?? 2));
  const colGap = Math.max(0, layout.columnGap ?? layout.gap);
  const rowGap = Math.max(0, layout.rowGap ?? layout.gap);
  const pad = layout.padding;

  const innerWidth = Math.max(1, container.width - pad.left - pad.right);
  const cellWidth = Math.max(1, (innerWidth - colGap * (cols - 1)) / cols);
  const align = layout.alignItems ?? 'stretch';

  const rowCount = Math.ceil(children.length / cols);
  let yCursor = container.y + pad.top;

  for (let row = 0; row < rowCount; row += 1) {
    const rowChildren = children.slice(row * cols, (row + 1) * cols);
    const rowHeight = Math.max(...rowChildren.map((child) => child.height), 1);

    for (let col = 0; col < rowChildren.length; col += 1) {
      const child = rowChildren[col];
      const childCfg = child.layoutChild;
      const nextW = childCfg?.widthMode === 'fixed'
        ? clampSize(child.width, childCfg?.minWidth, childCfg?.maxWidth)
        : clampSize(cellWidth, childCfg?.minWidth, childCfg?.maxWidth);
      const nextH = (childCfg?.heightMode === 'fill' || align === 'stretch')
        ? clampSize(rowHeight, childCfg?.minHeight, childCfg?.maxHeight)
        : clampSize(child.height, childCfg?.minHeight, childCfg?.maxHeight);

      const cellX = container.x + pad.left + col * (cellWidth + colGap);
      let nextY = yCursor;
      if (align === 'center') nextY = yCursor + (rowHeight - nextH) / 2;
      else if (align === 'end') nextY = yCursor + (rowHeight - nextH);

      const prev = nodeById.get(child.id) ?? child;
      const dx = roundPx(cellX) - prev.x;
      const dy = roundPx(nextY) - prev.y;
      nodeById.set(prev.id, {
        ...prev,
        x: roundPx(cellX),
        y: roundPx(nextY),
        width: nextW,
        height: nextH,
      });
      shiftSubtree(nodeById, childrenByParent, prev.id, dx, dy);
    }

    yCursor += rowHeight + rowGap;
  }

  if (container.layoutChild?.heightMode === 'hug' && rowCount > 0) {
    const usedH = yCursor - rowGap - container.y + pad.bottom;
    const latest = nodeById.get(container.id) ?? container;
    nodeById.set(container.id, {
      ...latest,
      height: clampSize(usedH, container.layoutChild?.minHeight, container.layoutChild?.maxHeight),
    });
  }
}

/**
 * Pure, framework-independent deterministic Auto-Layout + Responsive + Token solver.
 * Produces resolved render/commit nodes while preserving original node ordering.
 */
export function computeAutoLayoutNodes(
  nodes: readonly DesignNode[],
  options: AutoLayoutComputeOptions = {},
): DesignNode[] {
  const breakpoint = options.breakpoint ?? 'desktop';
  const tokens = options.tokens;

  const working: DesignNode[] = nodes.map((raw) => {
    const withTokens = tokens ? resolveNodeWithTokens(raw, tokens) : raw;
    const withResponsive = resolveEffectiveNodeForBreakpoint(withTokens, breakpoint);
    // Clamp top-level Auto-Layout containers to active preview width on tablet/mobile
    if (
      options.canvasWidth !== undefined &&
      breakpoint !== 'desktop' &&
      !withResponsive.parentId &&
      withResponsive.layout &&
      withResponsive.layout.mode !== 'none' &&
      withResponsive.width > options.canvasWidth - 32
    ) {
      return {
        ...withResponsive,
        x: Math.min(withResponsive.x, 16),
        width: Math.max(120, options.canvasWidth - 32),
      };
    }
    return withResponsive;
  });

  const nodeById = new Map<string, DesignNode>(working.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, string[]>();

  for (const node of working) {
    if (node.parentId && nodeById.has(node.parentId)) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node.id);
      childrenByParent.set(node.parentId, list);
    }
  }

  const solveRecursive = (containerId: string, visited: Set<string>) => {
    if (visited.has(containerId)) return;
    visited.add(containerId);

    const container = nodeById.get(containerId);
    if (!container) return;

    const childIds = childrenByParent.get(containerId) ?? [];
    const visibleChildren = childIds
      .map((id) => nodeById.get(id))
      .filter((child): child is DesignNode => child !== undefined && child.visible && child.onCanvas !== false);

    // Solve current container first (top-down sizing for fill children)
    if (container.layout && container.layout.mode === 'flex' && visibleChildren.length > 0) {
      solveFlexContainer(container, visibleChildren, nodeById, childrenByParent);
    } else if (container.layout && container.layout.mode === 'grid' && visibleChildren.length > 0) {
      solveGridContainer(container, visibleChildren, nodeById, childrenByParent);
    }

    // Recursively solve nested Auto-Layout children
    for (const childId of childIds) {
      solveRecursive(childId, visited);
    }
  };

  const visited = new Set<string>();
  if (options.onlyContainerId) {
    solveRecursive(options.onlyContainerId, visited);
  } else {
    // Solve from top-level roots downward
    for (const node of working) {
      if (!node.parentId || !nodeById.has(node.parentId)) {
        solveRecursive(node.id, visited);
      }
    }
  }

  return nodes.map((original) => nodeById.get(original.id) ?? original);
}

/**
 * Computes canonical desktop Auto-Layout coordinates for committing to the AST
 * via Native Command Engine (`node.update-many`).
 */
export function applyAutoLayoutToNodes(
  nodes: readonly DesignNode[],
  containerId?: string,
  tokens?: DesignTokenCollection,
): DesignNode[] {
  const solved = computeAutoLayoutNodes(nodes, {
    breakpoint: 'desktop',
    tokens,
    onlyContainerId: containerId,
  });
  // Preserve original tokenBindings & literal styles (only commit solved x/y/width/height geometry)
  return nodes.map((original, index) => {
    const computed = solved[index];
    if (
      original.x === computed.x &&
      original.y === computed.y &&
      original.width === computed.width &&
      original.height === computed.height
    ) {
      return original;
    }
    return {
      ...original,
      x: computed.x,
      y: computed.y,
      width: computed.width,
      height: computed.height,
    };
  });
}

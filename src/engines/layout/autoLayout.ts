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

function resolveAbsolutePinnedChildren(
  container: DesignNode,
  absoluteChildren: readonly DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  if (absoluteChildren.length === 0) return;
  const pad = container.layout?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const innerW = Math.max(1, container.width - pad.left - pad.right);
  const innerH = Math.max(1, container.height - pad.top - pad.bottom);

  for (const child of absoluteChildren) {
    const prev = nodeById.get(child.id) ?? child;
    const cfg = prev.layoutChild;
    const widthMode = cfg?.widthMode ?? 'fixed';
    const heightMode = cfg?.heightMode ?? 'fixed';
    const hPin = cfg?.constraints?.horizontal;
    const vPin = cfg?.constraints?.vertical;

    let nextW = prev.width;
    if (widthMode === 'fill' || hPin === 'left-right') {
      nextW = clampSize(innerW, cfg?.minWidth, cfg?.maxWidth);
    } else if (widthMode === 'relative') {
      const pct = Math.max(1, cfg?.widthPercent ?? 100) / 100;
      nextW = clampSize(innerW * pct, cfg?.minWidth, cfg?.maxWidth);
    } else {
      nextW = clampSize(prev.width, cfg?.minWidth, cfg?.maxWidth);
    }

    let nextH = prev.height;
    if (heightMode === 'fill' || vPin === 'top-bottom') {
      nextH = clampSize(innerH, cfg?.minHeight, cfg?.maxHeight);
    } else if (heightMode === 'relative') {
      const pct = Math.max(1, cfg?.heightPercent ?? 100) / 100;
      nextH = clampSize(innerH * pct, cfg?.minHeight, cfg?.maxHeight);
    } else {
      nextH = clampSize(prev.height, cfg?.minHeight, cfg?.maxHeight);
    }

    let nextX = prev.x;
    if (hPin === 'left' || hPin === 'left-right') {
      nextX = roundPx(container.x + pad.left);
    } else if (hPin === 'right') {
      nextX = roundPx(container.x + container.width - pad.right - nextW);
    } else if (hPin === 'center') {
      nextX = roundPx(container.x + (container.width - nextW) / 2);
    }

    let nextY = prev.y;
    if (vPin === 'top' || vPin === 'top-bottom') {
      nextY = roundPx(container.y + pad.top);
    } else if (vPin === 'bottom') {
      nextY = roundPx(container.y + container.height - pad.bottom - nextH);
    } else if (vPin === 'center') {
      nextY = roundPx(container.y + (container.height - nextH) / 2);
    }

    const dx = nextX - prev.x;
    const dy = nextY - prev.y;
    if (dx !== 0 || dy !== 0 || nextW !== prev.width || nextH !== prev.height) {
      nodeById.set(prev.id, {
        ...prev,
        x: nextX,
        y: nextY,
        width: Math.max(1, nextW),
        height: Math.max(1, nextH),
      });
      shiftSubtree(nodeById, childrenByParent, prev.id, dx, dy);
    }
  }
}

function solveFlexContainer(
  container: DesignNode,
  allVisibleChildren: DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  const layout = container.layout;
  if (!layout || layout.mode !== 'flex') return;

  const flowChildren = allVisibleChildren.filter((c) => c.layoutChild?.position !== 'absolute');
  const absoluteChildren = allVisibleChildren.filter((c) => c.layoutChild?.position === 'absolute');

  const isRow = layout.direction === 'row';
  const wrap = layout.wrap === 'wrap';
  const justify = layout.justifyContent ?? 'start';
  const align = layout.alignItems ?? 'start';
  const mainGap = Math.max(0, isRow ? (layout.columnGap ?? layout.gap) : (layout.rowGap ?? layout.gap));
  const crossGap = Math.max(0, isRow ? (layout.rowGap ?? layout.gap) : (layout.columnGap ?? layout.gap));
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

  const items: FlexItem[] = flowChildren.map((child) => {
    const latestChild = nodeById.get(child.id) ?? child;
    const childCfg = latestChild.layoutChild;
    const widthMode = childCfg?.widthMode ?? 'fixed';
    const heightMode = childCfg?.heightMode ?? 'fixed';
    const isFillMain = isRow ? widthMode === 'fill' : heightMode === 'fill';
    const isFillCross = isRow ? heightMode === 'fill' : widthMode === 'fill';
    const grow = Math.max(0, childCfg?.flexGrow ?? (isFillMain ? 1 : 0));

    let baseWidth = latestChild.width;
    if (widthMode === 'relative') {
      const pct = Math.max(1, childCfg?.widthPercent ?? 100) / 100;
      baseWidth = clampSize(innerWidth * pct, childCfg?.minWidth, childCfg?.maxWidth);
    } else if (widthMode === 'fixed') {
      baseWidth = clampSize(latestChild.width, childCfg?.minWidth, childCfg?.maxWidth);
    }

    let baseHeight = latestChild.height;
    if (heightMode === 'relative') {
      const pct = Math.max(1, childCfg?.heightPercent ?? 100) / 100;
      baseHeight = clampSize(innerHeight * pct, childCfg?.minHeight, childCfg?.maxHeight);
    } else if (heightMode === 'fixed') {
      baseHeight = clampSize(latestChild.height, childCfg?.minHeight, childCfg?.maxHeight);
    }

    return {
      node: latestChild,
      mainSize: isRow ? baseWidth : baseHeight,
      crossSize: isRow ? baseHeight : baseWidth,
      isFillMain,
      isFillCross,
      grow,
    };
  });

  // Partition into lines (single line when nowrap)
  const lines: FlexItem[][] = [];
  if (!wrap) {
    if (items.length > 0) lines.push(items);
  } else {
    let currentLine: FlexItem[] = [];
    let lineMain = 0;
    for (const item of items) {
      const nextMain = currentLine.length === 0 ? item.mainSize : lineMain + mainGap + item.mainSize;
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
    const totalGaps = Math.max(0, line.length - 1) * mainGap;
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
    let itemStepGap = mainGap;

    if (justify === 'center') {
      mainCursor = freeSpace / 2;
    } else if (justify === 'end') {
      mainCursor = freeSpace;
    } else if (justify === 'space-between' && line.length > 1) {
      itemStepGap = mainGap + freeSpace / (line.length - 1);
    } else if (justify === 'space-around' && line.length > 0) {
      const extra = freeSpace / line.length;
      mainCursor = extra / 2;
      itemStepGap = mainGap + extra;
    } else if (justify === 'space-evenly' && line.length > 0) {
      const extra = freeSpace / (line.length + 1);
      mainCursor = extra;
      itemStepGap = mainGap + extra;
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

    crossCursor += lineActualCross + crossGap;
  }

  // Hug-contents (Fit Content) resizing on the container itself from in-flow children
  const containerWidthMode = container.layoutChild?.widthMode ?? 'fixed';
  const containerHeightMode = container.layoutChild?.heightMode ?? 'fixed';
  const totalCrossUsed = Math.max(0, crossCursor - (lines.length > 0 ? crossGap : 0));

  let nextContainerW = container.width;
  let nextContainerH = container.height;
  if (containerWidthMode === 'hug' && flowChildren.length > 0) {
    const contentW = isRow ? totalUsedMainMax : totalCrossUsed;
    nextContainerW = clampSize(contentW + pad.left + pad.right, container.layoutChild?.minWidth, container.layoutChild?.maxWidth);
  }
  if (containerHeightMode === 'hug' && flowChildren.length > 0) {
    const contentH = isRow ? totalCrossUsed : totalUsedMainMax;
    nextContainerH = clampSize(contentH + pad.top + pad.bottom, container.layoutChild?.minHeight, container.layoutChild?.maxHeight);
  }
  const latestContainer = nodeById.get(container.id) ?? container;
  const resolvedContainer =
    nextContainerW !== container.width || nextContainerH !== container.height
      ? { ...latestContainer, width: nextContainerW, height: nextContainerH }
      : latestContainer;
  if (resolvedContainer !== latestContainer) {
    nodeById.set(container.id, resolvedContainer);
  }

  // Pin absolute children against the resolved container bounds without affecting flow siblings
  resolveAbsolutePinnedChildren(resolvedContainer, absoluteChildren, nodeById, childrenByParent);
}

function solveGridContainer(
  container: DesignNode,
  allVisibleChildren: DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  const layout = container.layout;
  if (!layout || layout.mode !== 'grid') return;

  const flowChildren = allVisibleChildren.filter((c) => c.layoutChild?.position !== 'absolute');
  const absoluteChildren = allVisibleChildren.filter((c) => c.layoutChild?.position === 'absolute');

  const cols = Math.max(1, Math.round(layout.gridColumns ?? 2));
  const colGap = Math.max(0, layout.columnGap ?? layout.gap);
  const rowGap = Math.max(0, layout.rowGap ?? layout.gap);
  const pad = layout.padding;

  const innerWidth = Math.max(1, container.width - pad.left - pad.right);
  const cellWidth = Math.max(1, (innerWidth - colGap * (cols - 1)) / cols);
  const align = layout.alignItems ?? 'stretch';
  const justify = layout.justifyContent ?? 'start';

  // Pack children into rows respecting optional gridColumnSpan (1..cols)
  interface GridPlacement {
    child: DesignNode;
    colStart: number;
    span: number;
  }
  const rows: GridPlacement[][] = [];
  let currentRow: GridPlacement[] = [];
  let colCursor = 0;

  for (const rawChild of flowChildren) {
    const child = nodeById.get(rawChild.id) ?? rawChild;
    const span = Math.max(1, Math.min(cols, Math.round(child.layoutChild?.gridColumnSpan ?? 1)));
    if (colCursor > 0 && colCursor + span > cols) {
      rows.push(currentRow);
      currentRow = [];
      colCursor = 0;
    }
    currentRow.push({ child, colStart: colCursor, span });
    colCursor += span;
    if (colCursor >= cols) {
      rows.push(currentRow);
      currentRow = [];
      colCursor = 0;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  let yCursor = container.y + pad.top;

  for (const rowPlacements of rows) {
    const rowHeight = Math.max(...rowPlacements.map((p) => p.child.height), 1);

    for (const { child, colStart, span } of rowPlacements) {
      const childCfg = child.layoutChild;
      const spanWidth = Math.max(1, cellWidth * span + colGap * (span - 1));
      const widthMode = childCfg?.widthMode ?? 'fill';
      const heightMode = childCfg?.heightMode ?? 'fixed';

      let nextW: number;
      if (widthMode === 'fixed') {
        nextW = clampSize(child.width, childCfg?.minWidth, childCfg?.maxWidth);
      } else if (widthMode === 'relative') {
        const pct = Math.max(1, childCfg?.widthPercent ?? 100) / 100;
        nextW = clampSize(spanWidth * pct, childCfg?.minWidth, childCfg?.maxWidth);
      } else {
        nextW = clampSize(spanWidth, childCfg?.minWidth, childCfg?.maxWidth);
      }

      const effectiveAlign =
        childCfg?.alignSelf && childCfg.alignSelf !== 'auto' ? childCfg.alignSelf : align;
      let nextH: number;
      if (heightMode === 'fill' || effectiveAlign === 'stretch') {
        nextH = clampSize(rowHeight, childCfg?.minHeight, childCfg?.maxHeight);
      } else if (heightMode === 'relative') {
        const pct = Math.max(1, childCfg?.heightPercent ?? 100) / 100;
        nextH = clampSize(rowHeight * pct, childCfg?.minHeight, childCfg?.maxHeight);
      } else {
        nextH = clampSize(child.height, childCfg?.minHeight, childCfg?.maxHeight);
      }

      let cellX = container.x + pad.left + colStart * (cellWidth + colGap);
      if (nextW < spanWidth) {
        if (justify === 'center') cellX += (spanWidth - nextW) / 2;
        else if (justify === 'end') cellX += spanWidth - nextW;
      }

      let nextY = yCursor;
      if (effectiveAlign === 'center') nextY = yCursor + (rowHeight - nextH) / 2;
      else if (effectiveAlign === 'end') nextY = yCursor + (rowHeight - nextH);

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

  const latest = nodeById.get(container.id) ?? container;
  let resolvedContainer = latest;
  if (container.layoutChild?.heightMode === 'hug' && rows.length > 0) {
    const usedH = yCursor - rowGap - container.y + pad.bottom;
    resolvedContainer = {
      ...latest,
      height: clampSize(usedH, container.layoutChild?.minHeight, container.layoutChild?.maxHeight),
    };
    nodeById.set(container.id, resolvedContainer);
  }

  resolveAbsolutePinnedChildren(resolvedContainer, absoluteChildren, nodeById, childrenByParent);
}

/**
 * Pure, framework-independent deterministic 2-Pass Framer Auto-Layout + Responsive + Token solver.
 * Pass 1 (Bottom-Up): resolves nested `hug` (Fit Content) intrinsic bounds from leaf containers upward.
 * Pass 2 (Top-Down): distributes `fill` (fr), `relative` (%), `space-evenly`, and `absolute` pins downward.
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

  const solveContainerNode = (containerId: string) => {
    const container = nodeById.get(containerId);
    if (!container || !container.layout || container.layout.mode === 'none') return;
    const childIds = childrenByParent.get(containerId) ?? [];
    const visibleChildren = childIds
      .map((id) => nodeById.get(id))
      .filter((child): child is DesignNode => child !== undefined && child.visible && child.onCanvas !== false);
    if (visibleChildren.length === 0) return;

    if (container.layout.mode === 'flex') {
      solveFlexContainer(container, visibleChildren, nodeById, childrenByParent);
    } else if (container.layout.mode === 'grid') {
      solveGridContainer(container, visibleChildren, nodeById, childrenByParent);
    }
  };

  // Pass 1 (Bottom-Up): measure nested Fit-Content (hug) containers first so parents see accurate intrinsic sizes
  const solveIntrinsicBottomUp = (containerId: string, visited: Set<string>) => {
    if (visited.has(containerId)) return;
    visited.add(containerId);
    const childIds = childrenByParent.get(containerId) ?? [];
    for (const childId of childIds) {
      solveIntrinsicBottomUp(childId, visited);
    }
    const container = nodeById.get(containerId);
    if (
      container &&
      container.layout &&
      container.layout.mode !== 'none' &&
      (container.layoutChild?.widthMode === 'hug' || container.layoutChild?.heightMode === 'hug')
    ) {
      solveContainerNode(containerId);
    }
  };

  // Pass 2 (Top-Down): distribute Fill (fr), Relative (%), alignment, and Absolute pins downward
  const solveTopDown = (containerId: string, visited: Set<string>) => {
    if (visited.has(containerId)) return;
    visited.add(containerId);
    solveContainerNode(containerId);
    const childIds = childrenByParent.get(containerId) ?? [];
    for (const childId of childIds) {
      solveTopDown(childId, visited);
    }
  };

  const roots = options.onlyContainerId
    ? [options.onlyContainerId]
    : working
        .filter((node) => !node.parentId || !nodeById.has(node.parentId))
        .map((node) => node.id);

  const visitedBottomUp = new Set<string>();
  for (const rootId of roots) {
    solveIntrinsicBottomUp(rootId, visitedBottomUp);
  }

  const visitedTopDown = new Set<string>();
  for (const rootId of roots) {
    solveTopDown(rootId, visitedTopDown);
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

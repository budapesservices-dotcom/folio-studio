import type {
  BreakpointId,
  CssLengthValue,
  DesignNode,
  DesignTokenCollection,
  LayoutDirection,
  LayoutMode,
  NodeLayoutConfig,
  NodePadding,
} from '../../core/document/types';
import { parseAspectRatioNumeric } from '../../core/document/cssUnits';
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
  visited: Set<string> = new Set([rootId]),
): void {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  const childIds = childrenByParent.get(rootId);
  if (!childIds) return;
  for (const childId of childIds) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    const child = nodeById.get(childId);
    if (!child) continue;
    nodeById.set(childId, {
      ...child,
      x: roundPx(child.x + dx),
      y: roundPx(child.y + dy),
    });
    shiftSubtree(nodeById, childrenByParent, childId, dx, dy, visited);
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

function isOutOfFlowPosition(position: string | undefined): boolean {
  return position === 'absolute' || position === 'fixed';
}

function resolveCssLengthToPx(val: CssLengthValue | undefined, referencePx: number, fallbackPx: number): number {
  if (!val || !Number.isFinite(val.value)) return fallbackPx;
  switch (val.unit) {
    case 'px':
      return val.value;
    case '%':
      return (val.value / 100) * referencePx;
    case 'rem':
    case 'em':
      return val.value * 16;
    case 'vw':
      return (val.value / 100) * 1440;
    case 'vh':
    case 'dvh':
      return (val.value / 100) * 900;
    default:
      return val.value;
  }
}

function parseCustomGridTrackWidths(
  template: string | undefined,
  innerWidth: number,
  colGap: number,
): number[] | null {
  if (!template) return null;
  const trimmed = template.trim();
  if (!trimmed) return null;

  // Handle repeat(N, track) shorthand
  const repeatMatch = /^repeat\(\s*(\d+)\s*,\s*([^)]+)\)$/.exec(trimmed);
  const rawTokens = repeatMatch
    ? Array.from({ length: Math.max(1, Math.min(24, Number(repeatMatch[1]))) }, () => repeatMatch[2].trim())
    : trimmed.split(/\s+/).filter(Boolean);

  if (rawTokens.length === 0 || rawTokens.length > 24) return null;

  const totalGap = Math.max(0, rawTokens.length - 1) * colGap;
  const available = Math.max(1, innerWidth - totalGap);

  const fixedPx: Array<number | null> = [];
  const frWeights: number[] = [];
  let usedFixed = 0;
  let totalFr = 0;

  for (const token of rawTokens) {
    if (token.endsWith('fr')) {
      const weight = Number(token.slice(0, -2));
      const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;
      fixedPx.push(null);
      frWeights.push(safeWeight);
      totalFr += safeWeight;
    } else if (token.endsWith('px')) {
      const px = Math.max(1, Number(token.slice(0, -2)) || 100);
      fixedPx.push(px);
      frWeights.push(0);
      usedFixed += px;
    } else if (token.endsWith('%')) {
      const pct = Math.max(1, Number(token.slice(0, -1)) || 50);
      const px = Math.max(1, (pct / 100) * available);
      fixedPx.push(px);
      frWeights.push(0);
      usedFixed += px;
    } else if (token.endsWith('rem') || token.endsWith('em')) {
      const val = Math.max(0.5, Number(token.replace(/r?em$/, '')) || 10);
      const px = val * 16;
      fixedPx.push(px);
      frWeights.push(0);
      usedFixed += px;
    } else {
      // auto / minmax(...) fallback -> 1fr share
      fixedPx.push(null);
      frWeights.push(1);
      totalFr += 1;
    }
  }

  const remaining = Math.max(1, available - usedFixed);
  return rawTokens.map((_, idx) => {
    const fixed = fixedPx[idx];
    if (fixed !== null) return fixed;
    return Math.max(1, (remaining * frWeights[idx]) / Math.max(1, totalFr));
  });
}

function solveFlexContainer(
  container: DesignNode,
  allVisibleChildren: DesignNode[],
  nodeById: Map<string, DesignNode>,
  childrenByParent: Map<string, string[]>,
): void {
  const layout = container.layout;
  if (!layout || layout.mode !== 'flex') return;

  const rawFlowChildren = allVisibleChildren.filter((c) => !isOutOfFlowPosition(c.layoutChild?.position));
  const absoluteChildren = allVisibleChildren.filter((c) => isOutOfFlowPosition(c.layoutChild?.position));

  const isRow = layout.direction === 'row' || layout.direction === 'row-reverse';
  const isReverse = layout.direction === 'row-reverse' || layout.direction === 'column-reverse';
  const flowChildren = isReverse ? [...rawFlowChildren].reverse() : rawFlowChildren;
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
    const ratio = parseAspectRatioNumeric(childCfg?.aspectRatio);
    if (heightMode === 'relative') {
      const pct = Math.max(1, childCfg?.heightPercent ?? 100) / 100;
      baseHeight = clampSize(innerHeight * pct, childCfg?.minHeight, childCfg?.maxHeight);
    } else if (ratio && heightMode === 'fixed') {
      baseHeight = clampSize(baseWidth / ratio, childCfg?.minHeight, childCfg?.maxHeight);
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

  const flowChildren = allVisibleChildren.filter((c) => !isOutOfFlowPosition(c.layoutChild?.position));
  const absoluteChildren = allVisibleChildren.filter((c) => isOutOfFlowPosition(c.layoutChild?.position));

  const colGap = Math.max(0, layout.columnGap ?? layout.gap);
  const rowGap = Math.max(0, layout.rowGap ?? layout.gap);
  const pad = layout.padding;
  const innerWidth = Math.max(1, container.width - pad.left - pad.right);

  const columnsMode = layout.gridColumnsMode ?? 'fixed';
  let trackWidths: number[];
  if (columnsMode === 'auto-fit') {
    const minCardPx = Math.max(
      40,
      resolveCssLengthToPx(layout.gridMinColumnWidth, innerWidth, 220),
    );
    const autoCols = Math.max(1, Math.min(24, Math.floor((innerWidth + colGap) / (minCardPx + colGap))));
    const cellW = Math.max(1, (innerWidth - colGap * (autoCols - 1)) / autoCols);
    trackWidths = Array.from({ length: autoCols }, () => cellW);
  } else if (columnsMode === 'custom') {
    const parsed = parseCustomGridTrackWidths(layout.gridTemplateColumns, innerWidth, colGap);
    if (parsed && parsed.length > 0) {
      trackWidths = parsed;
    } else {
      const fallbackCols = Math.max(1, Math.round(layout.gridColumns ?? 2));
      const cellW = Math.max(1, (innerWidth - colGap * (fallbackCols - 1)) / fallbackCols);
      trackWidths = Array.from({ length: fallbackCols }, () => cellW);
    }
  } else {
    const cols = Math.max(1, Math.round(layout.gridColumns ?? 2));
    const cellW = Math.max(1, (innerWidth - colGap * (cols - 1)) / cols);
    trackWidths = Array.from({ length: cols }, () => cellW);
  }

  const cols = trackWidths.length;
  const trackOffsets: number[] = [];
  let xAcc = 0;
  for (let c = 0; c < cols; c += 1) {
    trackOffsets.push(xAcc);
    xAcc += trackWidths[c] + colGap;
  }

  const align = layout.alignItems ?? 'stretch';
  const justify = layout.justifyContent ?? 'start';

  // 2D occupancy grid supporting both gridColumnSpan (including full) and gridRowSpan (Bento grids)
  interface GridCellPlacement {
    child: DesignNode;
    rowStart: number;
    colStart: number;
    colSpan: number;
    rowSpan: number;
    spanWidth: number;
    nextW: number;
    intrinsicH: number;
  }
  const occupied: boolean[][] = [];
  const placements: GridCellPlacement[] = [];

  const ensureRow = (r: number) => {
    while (occupied.length <= r) {
      occupied.push(Array.from({ length: cols }, () => false));
    }
  };

  const canPlace = (row: number, col: number, colSpan: number, rowSpan: number): boolean => {
    if (col + colSpan > cols) return false;
    for (let dr = 0; dr < rowSpan; dr += 1) {
      ensureRow(row + dr);
      for (let dc = 0; dc < colSpan; dc += 1) {
        if (occupied[row + dr][col + dc]) return false;
      }
    }
    return true;
  };

  const markOccupied = (row: number, col: number, colSpan: number, rowSpan: number): void => {
    for (let dr = 0; dr < rowSpan; dr += 1) {
      ensureRow(row + dr);
      for (let dc = 0; dc < colSpan; dc += 1) {
        occupied[row + dr][col + dc] = true;
      }
    }
  };

  let scanRow = 0;
  let scanCol = 0;
  const maxPlacementRows = Math.max(256, flowChildren.length * 6 + 16);

  for (const rawChild of flowChildren) {
    const child = nodeById.get(rawChild.id) ?? rawChild;
    const childCfg = child.layoutChild;
    const colSpan = childCfg?.gridColumnSpanFull
      ? cols
      : Math.max(1, Math.min(cols, Math.round(childCfg?.gridColumnSpan ?? 1)));
    const rowSpan = Math.max(1, Math.min(6, Math.round(childCfg?.gridRowSpan ?? 1)));

    let placed = false;
    let r = scanRow;
    let c = scanCol;
    while (!placed && r < maxPlacementRows) {
      if (canPlace(r, c, colSpan, rowSpan)) {
        markOccupied(r, c, colSpan, rowSpan);

        let spanWidth = 0;
        for (let dc = 0; dc < colSpan; dc += 1) {
          spanWidth += trackWidths[c + dc] ?? 1;
        }
        spanWidth = Math.max(1, spanWidth + colGap * (colSpan - 1));

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

        const ratio = parseAspectRatioNumeric(childCfg?.aspectRatio);
        const intrinsicH =
          ratio && heightMode !== 'fill'
            ? clampSize(nextW / ratio, childCfg?.minHeight, childCfg?.maxHeight)
            : clampSize(child.height, childCfg?.minHeight, childCfg?.maxHeight);

        placements.push({ child, rowStart: r, colStart: c, colSpan, rowSpan, spanWidth, nextW, intrinsicH });
        scanRow = r;
        scanCol = c + colSpan;
        if (scanCol >= cols) {
          scanRow += 1;
          scanCol = 0;
        }
        placed = true;
      } else {
        c += 1;
        if (c >= cols) {
          r += 1;
          c = 0;
        }
      }
    }
  }

  const totalRows = Math.max(
    occupied.length,
    layout.gridRowsMode === 'fixed' && layout.gridRows ? Math.round(layout.gridRows) : 0,
  );
  const rowHeights: number[] = Array.from({ length: totalRows }, () => 1);

  // Pass A: single-row children establish natural row heights (including aspectRatio heights)
  for (const p of placements) {
    if (p.rowSpan === 1) {
      rowHeights[p.rowStart] = Math.max(rowHeights[p.rowStart] ?? 1, p.intrinsicH);
    }
  }
  // Pass B: multi-row children expand rows proportionally if taller than summed rows
  for (const p of placements) {
    if (p.rowSpan > 1) {
      let spanH = 0;
      for (let dr = 0; dr < p.rowSpan; dr += 1) {
        spanH += rowHeights[p.rowStart + dr] ?? 1;
      }
      spanH += Math.max(0, p.rowSpan - 1) * rowGap;
      if (p.intrinsicH > spanH) {
        const deficit = (p.intrinsicH - spanH) / p.rowSpan;
        for (let dr = 0; dr < p.rowSpan; dr += 1) {
          rowHeights[p.rowStart + dr] = (rowHeights[p.rowStart + dr] ?? 1) + deficit;
        }
      }
    }
  }

  const rowOffsets: number[] = [];
  let yAcc = 0;
  for (let r = 0; r < totalRows; r += 1) {
    rowOffsets.push(yAcc);
    yAcc += rowHeights[r] + rowGap;
  }

  for (const { child, rowStart, colStart, rowSpan, spanWidth, nextW } of placements) {
    const childCfg = child.layoutChild;

    let spanHeight = 0;
    for (let dr = 0; dr < rowSpan; dr += 1) {
      spanHeight += rowHeights[rowStart + dr] ?? 1;
    }
    spanHeight = Math.max(1, spanHeight + rowGap * (rowSpan - 1));

    const heightMode = childCfg?.heightMode ?? 'fixed';
    const effectiveAlign =
      childCfg?.alignSelf && childCfg.alignSelf !== 'auto' ? childCfg.alignSelf : align;
    const ratio = parseAspectRatioNumeric(childCfg?.aspectRatio);
    let nextH: number;
    if (ratio && heightMode !== 'fill') {
      nextH = clampSize(nextW / ratio, childCfg?.minHeight, childCfg?.maxHeight);
    } else if (heightMode === 'fill' || effectiveAlign === 'stretch' || rowSpan > 1) {
      nextH = clampSize(spanHeight, childCfg?.minHeight, childCfg?.maxHeight);
    } else if (heightMode === 'relative') {
      const pct = Math.max(1, childCfg?.heightPercent ?? 100) / 100;
      nextH = clampSize(spanHeight * pct, childCfg?.minHeight, childCfg?.maxHeight);
    } else {
      nextH = clampSize(child.height, childCfg?.minHeight, childCfg?.maxHeight);
    }

    let cellX = container.x + pad.left + (trackOffsets[colStart] ?? 0);
    if (nextW < spanWidth) {
      if (justify === 'center') cellX += (spanWidth - nextW) / 2;
      else if (justify === 'end') cellX += spanWidth - nextW;
    }

    const rowY = container.y + pad.top + (rowOffsets[rowStart] ?? 0);
    let nextY = rowY;
    if (effectiveAlign === 'center') nextY = rowY + (spanHeight - nextH) / 2;
    else if (effectiveAlign === 'end') nextY = rowY + (spanHeight - nextH);

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

  const latest = nodeById.get(container.id) ?? container;
  let resolvedContainer = latest;
  if (container.layoutChild?.heightMode === 'hug' && totalRows > 0) {
    const usedH = yAcc - rowGap + pad.top + pad.bottom;
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

export interface FrameModeConversionResult {
  readonly nextNodes: DesignNode[];
  readonly detectedDirection: LayoutDirection;
  readonly estimatedGap: number;
  readonly childOrderIds: string[];
}

/**
 * Pure deterministic converter for switching a Frame between Freeform ('none'),
 * Stack ('flex'), and Grid ('grid').
 * When converting Freeform -> Stack, detects dominant visual axis, sorts children
 * by visual order, estimates initial positive gap, and solves layout so the caller
 * can commit the entire transition in ONE atomic Native Command transaction.
 */
export function computeFrameModeConversion(
  nodes: readonly DesignNode[],
  containerId: string,
  targetMode: LayoutMode,
  tokens?: DesignTokenCollection,
): FrameModeConversionResult | null {
  const container = nodes.find((n) => n.id === containerId);
  if (!container) return null;

  const existingLayout = container.layout;
  const basePadding: NodePadding = existingLayout?.padding ?? { top: 16, right: 16, bottom: 16, left: 16 };
  const directChildren = nodes.filter(
    (n) => n.parentId === containerId && n.visible && n.onCanvas !== false && !isOutOfFlowPosition(n.layoutChild?.position),
  );

  if (targetMode === 'none') {
    const nextNodes = nodes.map((node) =>
      node.id === containerId
        ? {
            ...node,
            layout: {
              ...(existingLayout ?? {
                direction: 'column' as const,
                gap: 12,
                padding: basePadding,
              }),
              mode: 'none' as const,
            },
          }
        : node,
    );
    return {
      nextNodes,
      detectedDirection: existingLayout?.direction ?? 'column',
      estimatedGap: existingLayout?.gap ?? 12,
      childOrderIds: directChildren.map((c) => c.id),
    };
  }

  let detectedDirection: LayoutDirection = existingLayout?.direction ?? 'column';
  let estimatedGap = existingLayout?.gap ?? 12;
  let orderedChildren = [...directChildren];

  if (targetMode === 'flex' && (!existingLayout || existingLayout.mode === 'none') && directChildren.length >= 2) {
    const centersX = directChildren.map((c) => c.x + c.width / 2);
    const centersY = directChildren.map((c) => c.y + c.height / 2);
    const spreadX = Math.max(...centersX) - Math.min(...centersX);
    const spreadY = Math.max(...centersY) - Math.min(...centersY);
    detectedDirection = spreadX > spreadY ? 'row' : 'column';

    orderedChildren.sort((a, b) =>
      detectedDirection === 'row'
        ? (a.x - b.x) || (a.y - b.y)
        : (a.y - b.y) || (a.x - b.x),
    );

    const positiveGaps: number[] = [];
    for (let i = 1; i < orderedChildren.length; i += 1) {
      const prev = orderedChildren[i - 1];
      const curr = orderedChildren[i];
      const delta = detectedDirection === 'row'
        ? curr.x - (prev.x + prev.width)
        : curr.y - (prev.y + prev.height);
      if (delta >= 0) positiveGaps.push(delta);
    }
    if (positiveGaps.length > 0) {
      const avg = positiveGaps.reduce((acc, g) => acc + g, 0) / positiveGaps.length;
      estimatedGap = Math.max(0, Math.min(96, Math.round(avg / 2) * 2));
    } else {
      estimatedGap = 12;
    }
  } else if (targetMode === 'grid') {
    orderedChildren.sort((a, b) => (Math.round(a.y / 16) - Math.round(b.y / 16)) || (a.x - b.x));
  }

  const nextLayout: NodeLayoutConfig =
    targetMode === 'flex'
      ? {
          ...(existingLayout ?? {
            direction: detectedDirection,
            gap: estimatedGap,
            padding: basePadding,
          }),
          mode: 'flex',
          direction: (!existingLayout || existingLayout.mode === 'none') ? detectedDirection : existingLayout.direction,
          gap: (!existingLayout || existingLayout.mode === 'none') ? estimatedGap : existingLayout.gap,
          justifyContent: existingLayout?.justifyContent ?? 'start',
          alignItems: existingLayout?.alignItems ?? 'start',
          padding: basePadding,
        }
      : {
          ...(existingLayout ?? {
            direction: 'row',
            gap: 16,
            padding: basePadding,
          }),
          mode: 'grid',
          gridColumnsMode: existingLayout?.gridColumnsMode ?? 'fixed',
          gridColumns: existingLayout?.gridColumns ?? 2,
          gridRowsMode: existingLayout?.gridRowsMode ?? 'auto',
          gap: existingLayout?.gap ?? 16,
          columnGap: existingLayout?.columnGap ?? existingLayout?.gap ?? 16,
          rowGap: existingLayout?.rowGap ?? existingLayout?.gap ?? 16,
          alignItems: existingLayout?.alignItems ?? 'stretch',
          padding: basePadding,
        };

  // Reorder direct children slots in-place so visual order becomes DOM/AST order
  const orderedIds = orderedChildren.map((c) => c.id);
  const orderedSet = new Set(orderedIds);
  let childInsertCursor = 0;
  const reorderedWithLayout: DesignNode[] = nodes.map((node) => {
    if (node.id === containerId) {
      return { ...node, layout: nextLayout };
    }
    if (orderedSet.has(node.id)) {
      const replacement = orderedChildren[childInsertCursor];
      childInsertCursor += 1;
      return replacement ?? node;
    }
    return node;
  });

  const solvedNodes = applyAutoLayoutToNodes(reorderedWithLayout, containerId, tokens);

  return {
    nextNodes: solvedNodes,
    detectedDirection: nextLayout.direction,
    estimatedGap: nextLayout.gap,
    childOrderIds: orderedIds,
  };
}

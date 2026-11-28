/**
 * Pure list-windowing (virtualization) math for Folio Studio's LayersPanel.
 * Keeps DOM size bounded (~30-45 rows) for projects with 120 to 1,000+ layers
 * without changing scroll height, keyboard/screen-reader tree semantics, or
 * behavior on small/medium documents.
 */

export const LAYER_VIRTUALIZATION_THRESHOLD = 120;
export const LAYER_ROW_ESTIMATED_HEIGHT = 32; // 30px row min-height + 2px flex gap
export const LAYER_VIRTUALIZATION_OVERSCAN = 8;
export const LAYER_VIEWPORT_FALLBACK_HEIGHT = 480;

export interface LayerVirtualWindowParams {
  totalCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
  threshold?: number;
  pinnedIndices?: readonly number[];
}

export interface LayerVirtualWindow {
  isVirtualized: boolean;
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
  totalHeightPx: number;
}

/**
 * Computes the visible slice `[startIndex, endIndex)` and top/bottom spacer
 * heights for a vertical fixed-pitch list of layer rows.
 *
 * Below `threshold` rows, virtualization stays disabled so small documents
 * render every row directly with zero spacer nodes.
 */
export function computeLayerVirtualWindow({
  totalCount,
  scrollTop,
  viewportHeight,
  rowHeight = LAYER_ROW_ESTIMATED_HEIGHT,
  overscan = LAYER_VIRTUALIZATION_OVERSCAN,
  threshold = LAYER_VIRTUALIZATION_THRESHOLD,
  pinnedIndices,
}: LayerVirtualWindowParams): LayerVirtualWindow {
  const safeCount = Math.max(0, Math.floor(totalCount));
  const safeRowHeight = Math.max(1, Number.isFinite(rowHeight) ? rowHeight : LAYER_ROW_ESTIMATED_HEIGHT);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeThreshold = Math.max(1, Math.floor(threshold));
  const totalHeightPx = safeCount * safeRowHeight;

  if (safeCount < safeThreshold) {
    return {
      isVirtualized: false,
      startIndex: 0,
      endIndex: safeCount,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      totalHeightPx,
    };
  }

  const effectiveViewport =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : LAYER_VIEWPORT_FALLBACK_HEIGHT;
  const maxScrollTop = Math.max(0, totalHeightPx - effectiveViewport);
  const clampedScrollTop = Math.min(
    maxScrollTop,
    Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0),
  );

  const visibleStart = Math.floor(clampedScrollTop / safeRowHeight);
  const visibleCount = Math.max(1, Math.ceil(effectiveViewport / safeRowHeight));

  let startIndex = Math.max(0, visibleStart - safeOverscan);
  let endIndex = Math.min(safeCount, visibleStart + visibleCount + safeOverscan);

  // Keep pinned rows (such as an actively renamed layer) mounted inside the window.
  if (pinnedIndices && pinnedIndices.length > 0) {
    for (const rawIdx of pinnedIndices) {
      if (Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < safeCount) {
        if (rawIdx < startIndex) startIndex = rawIdx;
        if (rawIdx + 1 > endIndex) endIndex = rawIdx + 1;
      }
    }
  }

  return {
    isVirtualized: true,
    startIndex,
    endIndex,
    topSpacerPx: startIndex * safeRowHeight,
    bottomSpacerPx: Math.max(0, (safeCount - endIndex) * safeRowHeight),
    totalHeightPx,
  };
}

export interface ScrollToLayerIndexParams {
  index: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
}

/**
 * Returns the minimal `scrollTop` needed to bring `index` cleanly into view,
 * or `null` if the row is already fully visible inside the scroll container.
 */
export function computeScrollTopForLayerIndex({
  index,
  scrollTop,
  viewportHeight,
  rowHeight = LAYER_ROW_ESTIMATED_HEIGHT,
}: ScrollToLayerIndexParams): number | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const safeRowHeight = Math.max(1, Number.isFinite(rowHeight) ? rowHeight : LAYER_ROW_ESTIMATED_HEIGHT);
  const safeViewport =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : LAYER_VIEWPORT_FALLBACK_HEIGHT;
  const safeScrollTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);

  const itemTop = index * safeRowHeight;
  const itemBottom = itemTop + safeRowHeight;
  const viewTop = safeScrollTop;
  const viewBottom = safeScrollTop + safeViewport;

  if (itemTop >= viewTop && itemBottom <= viewBottom) {
    return null;
  }
  if (itemTop < viewTop) {
    return Math.max(0, itemTop - safeRowHeight);
  }
  return Math.max(0, itemBottom - safeViewport + safeRowHeight);
}

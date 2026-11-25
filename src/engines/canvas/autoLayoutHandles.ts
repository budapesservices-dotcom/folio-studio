import type { EffectiveLayerState } from '../../core/document/layers';
import { moveLayer, type LayerDropPosition } from '../../core/document/layers';
import type {
  DesignNode,
  DesignTokenCollection,
  NodeLayoutConfig,
  NodePadding,
} from '../../core/document/types';
import { computeAutoLayoutNodes } from '../layout/autoLayout';
import type { Bounds } from './geometry';

export type PaddingEdge = 'top' | 'right' | 'bottom' | 'left';
export type GapAxis = 'horizontal' | 'vertical';

export interface PaddingHandleSpec {
  readonly edge: PaddingEdge;
  readonly orientation: 'horizontal' | 'vertical';
  readonly value: number;
  readonly barLine: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly hitRect: Bounds;
  readonly zoneRect: Bounds;
  readonly labelAnchor: { readonly x: number; readonly y: number };
}

export interface GapHandleSpec {
  readonly id: string;
  readonly index: number;
  readonly axis: GapAxis;
  /** Orientation of the visual scrub bar itself: vertical bar inside a horizontal gap, horizontal bar inside a vertical gap. */
  readonly barOrientation: 'vertical' | 'horizontal';
  readonly value: number;
  readonly isGrid: boolean;
  readonly barLine: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly hitRect: Bounds;
  /** All sibling gap corridor rectangles along this axis so hover/drag highlights every affected gap together. */
  readonly corridorRect: Bounds;
  readonly labelAnchor: { readonly x: number; readonly y: number };
}

export interface AutoLayoutHandlesGeometry {
  readonly containerId: string;
  readonly layoutMode: 'flex' | 'grid';
  readonly paddingHandles: readonly PaddingHandleSpec[];
  readonly gapHandles: readonly GapHandleSpec[];
  readonly horizontalGapZones: readonly Bounds[];
  readonly verticalGapZones: readonly Bounds[];
  readonly innerBounds: Bounds;
}

export interface PaddingScrubOptions {
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly snapKey?: boolean;
  readonly resetZero?: boolean;
}

export interface PaddingScrubResult {
  readonly nextLayout: NodeLayoutConfig;
  readonly hudLabel: string;
  readonly activeEdges: readonly PaddingEdge[];
}

export interface GapScrubOptions {
  readonly shiftKey?: boolean;
  readonly snapKey?: boolean;
  readonly resetZero?: boolean;
}

export interface GapScrubResult {
  readonly nextLayout: NodeLayoutConfig;
  readonly hudLabel: string;
  readonly activeAxes: readonly GapAxis[];
}

export interface AutoLayoutReorderSlot {
  readonly containerId: string;
  readonly draggedId: string;
  /** Target sibling ID & drop position formatted for Folio's native `moveLayer` contract. Null when slot equals original order. */
  readonly move: { readonly targetId: string; readonly position: Extract<LayerDropPosition, 'before' | 'after'> } | null;
  readonly visualSlotIndex: number;
  readonly displaySlotNumber: number;
  readonly isNoOp: boolean;
  readonly orientation: 'vertical' | 'horizontal';
  readonly indicatorLine: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly hudPoint: { readonly x: number; readonly y: number };
  readonly hudText: string;
}

export interface AutoLayoutKeyboardReorderResult {
  readonly targetId: string;
  readonly position: Extract<LayerDropPosition, 'before' | 'after'>;
  readonly displaySlotNumber: number;
  readonly containerId: string;
}

const MIN_CONTAINER_DIM_FOR_HANDLES = 36;
const REORDER_ESCAPE_MARGIN = 28;
const MAX_SPACING_VALUE = 1024;

function isOutOfFlow(node: DesignNode): boolean {
  const pos = node.layoutChild?.position;
  return pos === 'absolute' || pos === 'fixed' || pos === 'sticky';
}

function isDistributedJustify(layout: NodeLayoutConfig): boolean {
  return (
    layout.justifyContent === 'space-between' ||
    layout.justifyContent === 'space-around' ||
    layout.justifyContent === 'space-evenly'
  );
}

function isReverseFlex(layout: NodeLayoutConfig): boolean {
  return layout.mode === 'flex' && (layout.direction === 'row-reverse' || layout.direction === 'column-reverse');
}

function isRowFlex(layout: NodeLayoutConfig): boolean {
  return layout.direction === 'row' || layout.direction === 'row-reverse';
}

function clampSpacing(raw: number, snapKey?: boolean): number {
  const rounded = snapKey ? Math.round(raw / 4) * 4 : Math.round(raw);
  return Math.max(0, Math.min(MAX_SPACING_VALUE, rounded));
}

export function isAutoLayoutContainer(
  node: DesignNode | null | undefined,
): node is DesignNode & { layout: NodeLayoutConfig } {
  return Boolean(node && node.layout && (node.layout.mode === 'flex' || node.layout.mode === 'grid'));
}

/**
 * Returns visible direct flow children of an Auto-Layout container in canonical AST storage order,
 * excluding out-of-flow (`absolute`/`fixed`/`sticky`) and hidden layers.
 */
export function getLogicalFlowChildren(
  container: DesignNode,
  nodes: readonly DesignNode[],
  layerStates?: ReadonlyMap<string, EffectiveLayerState>,
): DesignNode[] {
  const children: DesignNode[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const child = nodes[i];
    if (child.parentId !== container.id) continue;
    if (child.onCanvas === false) continue;
    const effective = layerStates?.get(child.id);
    if (effective ? !effective.visible : !child.visible) continue;
    if (isOutOfFlow(child)) continue;
    children.push(child);
  }
  return children;
}

/**
 * Returns visible direct flow children in visual display order
 * (reversed for `row-reverse` / `column-reverse`).
 */
export function getVisualFlowChildren(
  container: DesignNode,
  nodes: readonly DesignNode[],
  layerStates?: ReadonlyMap<string, EffectiveLayerState>,
): DesignNode[] {
  const logical = getLogicalFlowChildren(container, nodes, layerStates);
  if (container.layout && isReverseFlex(container.layout)) {
    return [...logical].reverse();
  }
  return logical;
}

function createZeroSafePaddingZone(
  container: DesignNode,
  edge: PaddingEdge,
  pad: NodePadding,
  invZoom: number,
): Bounds {
  const minVisualStrip = Math.max(4 * invZoom, 2);
  if (edge === 'top') {
    const h = Math.max(pad.top, minVisualStrip);
    return { x: container.x, y: container.y, width: container.width, height: Math.min(container.height, h) };
  }
  if (edge === 'bottom') {
    const h = Math.max(pad.bottom, minVisualStrip);
    const clampedH = Math.min(container.height, h);
    return { x: container.x, y: container.y + container.height - clampedH, width: container.width, height: clampedH };
  }
  if (edge === 'left') {
    const w = Math.max(pad.left, minVisualStrip);
    return { x: container.x, y: container.y, width: Math.min(container.width, w), height: container.height };
  }
  const w = Math.max(pad.right, minVisualStrip);
  const clampedW = Math.min(container.width, w);
  return { x: container.x + container.width - clampedW, y: container.y, width: clampedW, height: container.height };
}

/**
 * Computes zoom-invariant SVG geometry for all interactive Auto-Layout Padding & Gap
 * direct-manipulation handles on a selected Flex or Grid container.
 */
export function computeAutoLayoutHandles(
  container: DesignNode,
  nodes: readonly DesignNode[],
  invZoom: number,
  layerStates?: ReadonlyMap<string, EffectiveLayerState>,
): AutoLayoutHandlesGeometry | null {
  if (!isAutoLayoutContainer(container)) return null;
  if (container.width < MIN_CONTAINER_DIM_FOR_HANDLES || container.height < MIN_CONTAINER_DIM_FOR_HANDLES) {
    return null;
  }

  const layout = container.layout;
  const pad = layout.padding;
  const safeInvZoom = Number.isFinite(invZoom) && invZoom > 0 ? invZoom : 1;

  const innerX = container.x + pad.left;
  const innerY = container.y + pad.top;
  const innerW = Math.max(0, container.width - pad.left - pad.right);
  const innerH = Math.max(0, container.height - pad.top - pad.bottom);
  const innerBounds: Bounds = { x: innerX, y: innerY, width: innerW, height: innerH };

  const midX = container.x + container.width / 2;
  const midY = container.y + container.height / 2;

  // Keep padding bars safely clear of corner resize handles & corner-radius knobs.
  const barHalfH = Math.max(6 * safeInvZoom, Math.min(13 * safeInvZoom, Math.max(0, container.width - 36 * safeInvZoom) * 0.25));
  const barHalfV = Math.max(6 * safeInvZoom, Math.min(13 * safeInvZoom, Math.max(0, container.height - 36 * safeInvZoom) * 0.25));
  const hitThick = 14 * safeInvZoom;
  const minInset = 7 * safeInvZoom;

  // Position bars centered within the padding strip (or slightly inset when padding is 0 so handles stay discoverable without colliding with resize handles).
  const topBarY = container.y + Math.max(minInset, Math.min(container.height * 0.35, pad.top / 2));
  const bottomBarY = container.y + container.height - Math.max(minInset, Math.min(container.height * 0.35, pad.bottom / 2));
  const leftBarX = container.x + Math.max(minInset, Math.min(container.width * 0.35, pad.left / 2));
  const rightBarX = container.x + container.width - Math.max(minInset, Math.min(container.width * 0.35, pad.right / 2));

  const paddingHandles: PaddingHandleSpec[] = [];
  if (container.height >= 44) {
    paddingHandles.push(
      {
        edge: 'top',
        orientation: 'horizontal',
        value: Math.round(pad.top),
        barLine: { x1: midX - barHalfH, y1: topBarY, x2: midX + barHalfH, y2: topBarY },
        hitRect: {
          x: midX - barHalfH - 4 * safeInvZoom,
          y: topBarY - hitThick / 2,
          width: barHalfH * 2 + 8 * safeInvZoom,
          height: hitThick,
        },
        zoneRect: createZeroSafePaddingZone(container, 'top', pad, safeInvZoom),
        labelAnchor: { x: midX, y: topBarY },
      },
      {
        edge: 'bottom',
        orientation: 'horizontal',
        value: Math.round(pad.bottom),
        barLine: { x1: midX - barHalfH, y1: bottomBarY, x2: midX + barHalfH, y2: bottomBarY },
        hitRect: {
          x: midX - barHalfH - 4 * safeInvZoom,
          y: bottomBarY - hitThick / 2,
          width: barHalfH * 2 + 8 * safeInvZoom,
          height: hitThick,
        },
        zoneRect: createZeroSafePaddingZone(container, 'bottom', pad, safeInvZoom),
        labelAnchor: { x: midX, y: bottomBarY },
      },
    );
  }
  if (container.width >= 44) {
    paddingHandles.push(
      {
        edge: 'left',
        orientation: 'vertical',
        value: Math.round(pad.left),
        barLine: { x1: leftBarX, y1: midY - barHalfV, x2: leftBarX, y2: midY + barHalfV },
        hitRect: {
          x: leftBarX - hitThick / 2,
          y: midY - barHalfV - 4 * safeInvZoom,
          width: hitThick,
          height: barHalfV * 2 + 8 * safeInvZoom,
        },
        zoneRect: createZeroSafePaddingZone(container, 'left', pad, safeInvZoom),
        labelAnchor: { x: leftBarX, y: midY },
      },
      {
        edge: 'right',
        orientation: 'vertical',
        value: Math.round(pad.right),
        barLine: { x1: rightBarX, y1: midY - barHalfV, x2: rightBarX, y2: midY + barHalfV },
        hitRect: {
          x: rightBarX - hitThick / 2,
          y: midY - barHalfV - 4 * safeInvZoom,
          width: hitThick,
          height: barHalfV * 2 + 8 * safeInvZoom,
        },
        zoneRect: createZeroSafePaddingZone(container, 'right', pad, safeInvZoom),
        labelAnchor: { x: rightBarX, y: midY },
      },
    );
  }

  const gapHandles: GapHandleSpec[] = [];
  const horizontalGapZones: Bounds[] = [];
  const verticalGapZones: Bounds[] = [];

  const visualChildren = getVisualFlowChildren(container, nodes, layerStates);
  if (visualChildren.length >= 2) {
    const gapBarHalf = 10 * safeInvZoom;
    const minZoneVisual = Math.max(3 * safeInvZoom, 1.5);

    if (layout.mode === 'flex') {
      const row = isRowFlex(layout);
      const suppressMainGap = isDistributedJustify(layout);
      const wrap = layout.wrap === 'wrap';

      if (row) {
        // Group children into visual rows by overlapping Y bands
        const rows: DesignNode[][] = [];
        for (const child of visualChildren) {
          const prevRow = rows[rows.length - 1];
          if (!prevRow || !wrap) {
            if (!prevRow) rows.push([child]);
            else prevRow.push(child);
            continue;
          }
          const prevAnchor = prevRow[0];
          const sameRow =
            child.y < prevAnchor.y + prevAnchor.height - 2 &&
            child.y + child.height > prevAnchor.y + 2;
          if (sameRow) prevRow.push(child);
          else rows.push([child]);
        }

        if (!suppressMainGap) {
          const gapValue = Math.round(Math.max(0, layout.columnGap ?? layout.gap));
          let idx = 0;
          for (const rowNodes of rows) {
            const sorted = [...rowNodes].sort((a, b) => a.x - b.x);
            for (let i = 0; i < sorted.length - 1; i += 1) {
              const leftNode = sorted[i];
              const rightNode = sorted[i + 1];
              const x1 = leftNode.x + leftNode.width;
              const x2 = rightNode.x;
              if (x2 < x1 - 2) continue;
              const centerX = (x1 + x2) / 2;
              const topY = Math.min(leftNode.y, rightNode.y);
              const bottomY = Math.max(leftNode.y + leftNode.height, rightNode.y + rightNode.height);
              const corridorH = Math.max(8, bottomY - topY);
              const centerY = topY + corridorH / 2;
              const barH = Math.min(gapBarHalf, Math.max(4 * safeInvZoom, corridorH * 0.28));
              const zoneW = Math.max(x2 - x1, minZoneVisual);
              const corridorRect: Bounds = {
                x: centerX - zoneW / 2,
                y: topY,
                width: zoneW,
                height: corridorH,
              };
              horizontalGapZones.push(corridorRect);
              gapHandles.push({
                id: `gap-h-${idx}`,
                index: idx,
                axis: 'horizontal',
                barOrientation: 'vertical',
                value: gapValue,
                isGrid: false,
                barLine: { x1: centerX, y1: centerY - barH, x2: centerX, y2: centerY + barH },
                hitRect: {
                  x: centerX - Math.max(hitThick / 2, (x2 - x1) / 2),
                  y: centerY - barH - 4 * safeInvZoom,
                  width: Math.max(hitThick, x2 - x1),
                  height: barH * 2 + 8 * safeInvZoom,
                },
                corridorRect,
                labelAnchor: { x: centerX, y: centerY },
              });
              idx += 1;
            }
          }
        }

        // Wrapped Flex cross-axis (row) gap handles between wrapped lines
        if (wrap && rows.length >= 2) {
          const crossGapVal = Math.round(Math.max(0, layout.rowGap ?? layout.gap));
          for (let r = 0; r < rows.length - 1; r += 1) {
            const topRow = rows[r];
            const bottomRow = rows[r + 1];
            const y1 = Math.max(...topRow.map((n) => n.y + n.height));
            const y2 = Math.min(...bottomRow.map((n) => n.y));
            if (y2 < y1 - 2) continue;
            const centerY = (y1 + y2) / 2;
            const leftX = Math.min(...topRow.map((n) => n.x), ...bottomRow.map((n) => n.x));
            const rightX = Math.max(...topRow.map((n) => n.x + n.width), ...bottomRow.map((n) => n.x + n.width));
            const corridorW = Math.max(8, rightX - leftX);
            const centerX = leftX + corridorW / 2;
            const barW = Math.min(gapBarHalf, Math.max(4 * safeInvZoom, corridorW * 0.22));
            const zoneH = Math.max(y2 - y1, minZoneVisual);
            const corridorRect: Bounds = {
              x: leftX,
              y: centerY - zoneH / 2,
              width: corridorW,
              height: zoneH,
            };
            verticalGapZones.push(corridorRect);
            gapHandles.push({
              id: `gap-v-${r}`,
              index: r,
              axis: 'vertical',
              barOrientation: 'horizontal',
              value: crossGapVal,
              isGrid: false,
              barLine: { x1: centerX - barW, y1: centerY, x2: centerX + barW, y2: centerY },
              hitRect: {
                x: centerX - barW - 4 * safeInvZoom,
                y: centerY - Math.max(hitThick / 2, (y2 - y1) / 2),
                width: barW * 2 + 8 * safeInvZoom,
                height: Math.max(hitThick, y2 - y1),
              },
              corridorRect,
              labelAnchor: { x: centerX, y: centerY },
            });
          }
        }
      } else {
        // Vertical flex (column / column-reverse)
        const cols: DesignNode[][] = [];
        for (const child of visualChildren) {
          const prevCol = cols[cols.length - 1];
          if (!prevCol || !wrap) {
            if (!prevCol) cols.push([child]);
            else prevCol.push(child);
            continue;
          }
          const prevAnchor = prevCol[0];
          const sameCol =
            child.x < prevAnchor.x + prevAnchor.width - 2 &&
            child.x + child.width > prevAnchor.x + 2;
          if (sameCol) prevCol.push(child);
          else cols.push([child]);
        }

        if (!suppressMainGap) {
          const gapValue = Math.round(Math.max(0, layout.rowGap ?? layout.gap));
          let idx = 0;
          for (const colNodes of cols) {
            const sorted = [...colNodes].sort((a, b) => a.y - b.y);
            for (let i = 0; i < sorted.length - 1; i += 1) {
              const topNode = sorted[i];
              const bottomNode = sorted[i + 1];
              const y1 = topNode.y + topNode.height;
              const y2 = bottomNode.y;
              if (y2 < y1 - 2) continue;
              const centerY = (y1 + y2) / 2;
              const leftX = Math.min(topNode.x, bottomNode.x);
              const rightX = Math.max(topNode.x + topNode.width, bottomNode.x + bottomNode.width);
              const corridorW = Math.max(8, rightX - leftX);
              const centerX = leftX + corridorW / 2;
              const barW = Math.min(gapBarHalf, Math.max(4 * safeInvZoom, corridorW * 0.28));
              const zoneH = Math.max(y2 - y1, minZoneVisual);
              const corridorRect: Bounds = {
                x: leftX,
                y: centerY - zoneH / 2,
                width: corridorW,
                height: zoneH,
              };
              verticalGapZones.push(corridorRect);
              gapHandles.push({
                id: `gap-v-${idx}`,
                index: idx,
                axis: 'vertical',
                barOrientation: 'horizontal',
                value: gapValue,
                isGrid: false,
                barLine: { x1: centerX - barW, y1: centerY, x2: centerX + barW, y2: centerY },
                hitRect: {
                  x: centerX - barW - 4 * safeInvZoom,
                  y: centerY - Math.max(hitThick / 2, (y2 - y1) / 2),
                  width: barW * 2 + 8 * safeInvZoom,
                  height: Math.max(hitThick, y2 - y1),
                },
                corridorRect,
                labelAnchor: { x: centerX, y: centerY },
              });
              idx += 1;
            }
          }
        }
      }
    } else if (layout.mode === 'grid') {
      // Group grid items into visual rows by Y overlap to discover both column gaps and row gaps cleanly
      const sortedByY = [...visualChildren].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));
      const rows: DesignNode[][] = [];
      for (const child of sortedByY) {
        const targetRow = rows.find((row) =>
          row.some((other) => child.y < other.y + other.height - 2 && child.y + child.height > other.y + 2),
        );
        if (targetRow) targetRow.push(child);
        else rows.push([child]);
      }

      const colGapValue = Math.round(Math.max(0, layout.columnGap ?? layout.gap));
      const rowGapValue = Math.round(Math.max(0, layout.rowGap ?? layout.gap));

      // Column gaps (horizontal axis, vertical bar)
      let hIdx = 0;
      for (const rowNodes of rows) {
        const sortedRow = [...rowNodes].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sortedRow.length - 1; i += 1) {
          const leftNode = sortedRow[i];
          const rightNode = sortedRow[i + 1];
          const x1 = leftNode.x + leftNode.width;
          const x2 = rightNode.x;
          if (x2 < x1 - 2) continue;
          const centerX = (x1 + x2) / 2;
          const topY = Math.min(leftNode.y, rightNode.y);
          const bottomY = Math.max(leftNode.y + leftNode.height, rightNode.y + rightNode.height);
          const corridorH = Math.max(8, bottomY - topY);
          const centerY = topY + corridorH / 2;
          const barH = Math.min(gapBarHalf, Math.max(4 * safeInvZoom, corridorH * 0.28));
          const zoneW = Math.max(x2 - x1, minZoneVisual);
          const corridorRect: Bounds = {
            x: centerX - zoneW / 2,
            y: topY,
            width: zoneW,
            height: corridorH,
          };
          horizontalGapZones.push(corridorRect);
          gapHandles.push({
            id: `gap-h-${hIdx}`,
            index: hIdx,
            axis: 'horizontal',
            barOrientation: 'vertical',
            value: colGapValue,
            isGrid: true,
            barLine: { x1: centerX, y1: centerY - barH, x2: centerX, y2: centerY + barH },
            hitRect: {
              x: centerX - Math.max(hitThick / 2, (x2 - x1) / 2),
              y: centerY - barH - 4 * safeInvZoom,
              width: Math.max(hitThick, x2 - x1),
              height: barH * 2 + 8 * safeInvZoom,
            },
            corridorRect,
            labelAnchor: { x: centerX, y: centerY },
          });
          hIdx += 1;
        }
      }

      // Row gaps (vertical axis, horizontal bar)
      for (let r = 0; r < rows.length - 1; r += 1) {
        const topRow = rows[r];
        const bottomRow = rows[r + 1];
        const y1 = Math.max(...topRow.map((n) => n.y + n.height));
        const y2 = Math.min(...bottomRow.map((n) => n.y));
        if (y2 < y1 - 2) continue;
        const centerY = (y1 + y2) / 2;
        const leftX = Math.min(...topRow.map((n) => n.x), ...bottomRow.map((n) => n.x));
        const rightX = Math.max(...topRow.map((n) => n.x + n.width), ...bottomRow.map((n) => n.x + n.width));
        const corridorW = Math.max(8, rightX - leftX);
        const centerX = leftX + corridorW / 2;
        const barW = Math.min(gapBarHalf, Math.max(4 * safeInvZoom, corridorW * 0.24));
        const zoneH = Math.max(y2 - y1, minZoneVisual);
        const corridorRect: Bounds = {
          x: leftX,
          y: centerY - zoneH / 2,
          width: corridorW,
          height: zoneH,
        };
        verticalGapZones.push(corridorRect);
        gapHandles.push({
          id: `gap-v-${r}`,
          index: r,
          axis: 'vertical',
          barOrientation: 'horizontal',
          value: rowGapValue,
          isGrid: true,
          barLine: { x1: centerX - barW, y1: centerY, x2: centerX + barW, y2: centerY },
          hitRect: {
            x: centerX - barW - 4 * safeInvZoom,
            y: centerY - Math.max(hitThick / 2, (y2 - y1) / 2),
            width: barW * 2 + 8 * safeInvZoom,
            height: Math.max(hitThick, y2 - y1),
          },
          corridorRect,
          labelAnchor: { x: centerX, y: centerY },
        });
      }
    }
  }

  return {
    containerId: container.id,
    layoutMode: layout.mode === 'grid' ? 'grid' : 'flex',
    paddingHandles,
    gapHandles,
    horizontalGapZones,
    verticalGapZones,
    innerBounds,
  };
}

/**
 * Resolves the updated Auto-Layout config & HUD text while scrubbing a Padding handle.
 * Pulling inward increases padding; pulling outward decreases padding down to 0.
 * - `Shift`: uniform all 4 sides
 * - `Alt`: symmetric opposite pair (`Left + Right` or `Top + Bottom`)
 * - `Ctrl/Cmd` (`snapKey`): 4px design-grid increments
 * - `resetZero`: double-click reset to 0px
 */
export function computeScrubbedPadding(
  initialLayout: NodeLayoutConfig,
  edge: PaddingEdge,
  dx: number,
  dy: number,
  options: PaddingScrubOptions = {},
): PaddingScrubResult {
  const inwardDelta =
    edge === 'top' ? dy
    : edge === 'bottom' ? -dy
    : edge === 'left' ? dx
    : -dx;

  const basePad = initialLayout.padding;
  const nextVal = options.resetZero ? 0 : clampSpacing(basePad[edge] + inwardDelta, options.snapKey);
  const nextPadding: NodePadding = { ...basePad };
  let activeEdges: PaddingEdge[];
  let hudLabel: string;

  if (options.shiftKey) {
    nextPadding.top = nextVal;
    nextPadding.right = nextVal;
    nextPadding.bottom = nextVal;
    nextPadding.left = nextVal;
    activeEdges = ['top', 'right', 'bottom', 'left'];
    hudLabel = `Padding: ${nextVal}px`;
  } else if (options.altKey) {
    if (edge === 'left' || edge === 'right') {
      nextPadding.left = nextVal;
      nextPadding.right = nextVal;
      activeEdges = ['left', 'right'];
      hudLabel = `H-Pad: ${nextVal}px`;
    } else {
      nextPadding.top = nextVal;
      nextPadding.bottom = nextVal;
      activeEdges = ['top', 'bottom'];
      hudLabel = `V-Pad: ${nextVal}px`;
    }
  } else {
    nextPadding[edge] = nextVal;
    activeEdges = [edge];
    const edgeTitle = edge.charAt(0).toUpperCase() + edge.slice(1);
    hudLabel = `${edgeTitle}: ${nextVal}px`;
  }

  const allEqual =
    nextPadding.top === nextPadding.right &&
    nextPadding.right === nextPadding.bottom &&
    nextPadding.bottom === nextPadding.left;

  const nextLayout: NodeLayoutConfig = {
    ...initialLayout,
    padding: nextPadding,
    paddingMode: allEqual ? 'uniform' : 'per-side',
  };

  return { nextLayout, hudLabel, activeEdges };
}

/**
 * Resolves the updated Auto-Layout config & HUD text while scrubbing a Gap handle.
 * - Dragging right/down increases gap; dragging left/up decreases gap down to 0.
 * - For CSS Grid: `horizontal` adjusts `columnGap`, `vertical` adjusts `rowGap`; holding `Shift` links both.
 * - For Flex: adjusts `gap` and keeps matching `columnGap`/`rowGap` in sync.
 */
export function computeScrubbedGap(
  initialLayout: NodeLayoutConfig,
  axis: GapAxis,
  dx: number,
  dy: number,
  options: GapScrubOptions = {},
): GapScrubResult {
  const delta = axis === 'horizontal' ? dx : dy;
  const currentVal =
    axis === 'horizontal'
      ? Math.max(0, initialLayout.columnGap ?? initialLayout.gap)
      : Math.max(0, initialLayout.rowGap ?? initialLayout.gap);

  const nextVal = options.resetZero ? 0 : clampSpacing(currentVal + delta, options.snapKey);

  if (initialLayout.mode === 'grid') {
    if (options.shiftKey) {
      return {
        nextLayout: {
          ...initialLayout,
          gap: nextVal,
          columnGap: nextVal,
          rowGap: nextVal,
        },
        hudLabel: `Gap: ${nextVal}px`,
        activeAxes: ['horizontal', 'vertical'],
      };
    }
    if (axis === 'horizontal') {
      const preservedRowGap = initialLayout.rowGap ?? initialLayout.gap;
      return {
        nextLayout: {
          ...initialLayout,
          columnGap: nextVal,
          rowGap: preservedRowGap,
          gap: nextVal === preservedRowGap ? nextVal : initialLayout.gap,
        },
        hudLabel: `Col Gap: ${nextVal}px`,
        activeAxes: ['horizontal'],
      };
    }
    const preservedColGap = initialLayout.columnGap ?? initialLayout.gap;
    return {
      nextLayout: {
        ...initialLayout,
        rowGap: nextVal,
        columnGap: preservedColGap,
        gap: nextVal === preservedColGap ? nextVal : initialLayout.gap,
      },
      hudLabel: `Row Gap: ${nextVal}px`,
      activeAxes: ['vertical'],
    };
  }

  // Flex container
  const rowMain = isRowFlex(initialLayout);
  const isMainAxis = (rowMain && axis === 'horizontal') || (!rowMain && axis === 'vertical');
  if (isMainAxis) {
    const nextLayout: NodeLayoutConfig = {
      ...initialLayout,
      gap: nextVal,
      ...(axis === 'horizontal' && initialLayout.columnGap !== undefined ? { columnGap: nextVal } : {}),
      ...(axis === 'vertical' && initialLayout.rowGap !== undefined ? { rowGap: nextVal } : {}),
    };
    return {
      nextLayout,
      hudLabel: `Gap: ${nextVal}px`,
      activeAxes: [axis],
    };
  }

  // Cross-axis gap on wrapped flex container
  if (axis === 'vertical') {
    return {
      nextLayout: { ...initialLayout, rowGap: nextVal },
      hudLabel: `Row Gap: ${nextVal}px`,
      activeAxes: ['vertical'],
    };
  }
  return {
    nextLayout: { ...initialLayout, columnGap: nextVal },
    hudLabel: `Col Gap: ${nextVal}px`,
    activeAxes: ['horizontal'],
  };
}

/**
 * Translates a desired 0-based insertion index inside `remainingVisual` (all visual siblings
 * excluding `draggedId`) into Folio's native `moveLayer(nodes, draggedId, targetId, position)`
 * contract, accounting for both paint-order storage and `row-reverse`/`column-reverse`.
 */
export function resolveNativeMoveForVisualSlot(
  container: DesignNode,
  logicalFlowChildren: readonly DesignNode[],
  draggedId: string,
  remainingVisualInsertIndex: number,
): { targetId: string; position: Extract<LayerDropPosition, 'before' | 'after'> } | null {
  const originalLogicalIndex = logicalFlowChildren.findIndex((c) => c.id === draggedId);
  if (originalLogicalIndex < 0) return null;

  const remainingLogical = logicalFlowChildren.filter((c) => c.id !== draggedId);
  if (remainingLogical.length === 0) return null;

  const clampedVisual = Math.max(0, Math.min(remainingLogical.length, remainingVisualInsertIndex));
  const reversed = Boolean(container.layout && isReverseFlex(container.layout));
  const remainingLogicalInsertIndex = reversed
    ? remainingLogical.length - clampedVisual
    : clampedVisual;

  // No-op when inserting right back into the original logical slot
  if (remainingLogicalInsertIndex === originalLogicalIndex) {
    return null;
  }

  // Note: `moveLayer` inserts BEFORE target in `document.nodes` when position === 'after',
  // and AFTER target in `document.nodes` when position === 'before'.
  if (remainingLogicalInsertIndex < remainingLogical.length) {
    return {
      targetId: remainingLogical[remainingLogicalInsertIndex].id,
      position: 'after',
    };
  }
  return {
    targetId: remainingLogical[remainingLogical.length - 1].id,
    position: 'before',
  };
}

/**
 * Resolves live Drag-to-Reorder target slot & Cyan Insertion Indicator geometry when
 * dragging a flow child inside a Flex or Grid Auto-Layout container.
 * Returns `null` when pointer escapes beyond `escapeMargin` outside container bounds.
 */
export function resolveAutoLayoutReorder(
  container: DesignNode,
  draggedNode: DesignNode,
  pointer: { readonly x: number; readonly y: number },
  nodes: readonly DesignNode[],
  layerStates?: ReadonlyMap<string, EffectiveLayerState>,
  escapeMargin: number = REORDER_ESCAPE_MARGIN,
): AutoLayoutReorderSlot | null {
  if (!isAutoLayoutContainer(container)) return null;
  if (draggedNode.parentId !== container.id || isOutOfFlow(draggedNode)) return null;

  // Escape check: if pointer leaves container bounds + forgiving margin, allow normal free move
  if (
    pointer.x < container.x - escapeMargin ||
    pointer.x > container.x + container.width + escapeMargin ||
    pointer.y < container.y - escapeMargin ||
    pointer.y > container.y + container.height + escapeMargin
  ) {
    return null;
  }

  const logicalChildren = getLogicalFlowChildren(container, nodes, layerStates);
  if (logicalChildren.length < 2) return null;

  const layout = container.layout;
  const visualChildren = isReverseFlex(layout) ? [...logicalChildren].reverse() : logicalChildren;
  const remainingVisual = visualChildren.filter((c) => c.id !== draggedNode.id);
  if (remainingVisual.length === 0) return null;

  const is2D = layout.mode === 'grid' || (layout.mode === 'flex' && layout.wrap === 'wrap');
  const isRow = layout.mode === 'grid' || isRowFlex(layout);

  let bestVisualIndex = 0;
  let indicatorLine: { x1: number; y1: number; x2: number; y2: number };
  let orientation: 'vertical' | 'horizontal' = isRow ? 'vertical' : 'horizontal';

  if (!is2D) {
    // 1D Flex row or column: compare pointer along main axis against each sibling midpoint
    const sortedWithIdx = remainingVisual.map((node, visualIdx) => ({ node, visualIdx }));
    if (isRow) {
      let insertIdx = remainingVisual.length;
      for (let i = 0; i < sortedWithIdx.length; i += 1) {
        const sibling = sortedWithIdx[i].node;
        if (pointer.x < sibling.x + sibling.width / 2) {
          insertIdx = i;
          break;
        }
      }
      bestVisualIndex = insertIdx;
      const prev = insertIdx > 0 ? remainingVisual[insertIdx - 1] : null;
      const next = insertIdx < remainingVisual.length ? remainingVisual[insertIdx] : null;
      const lineX =
        prev && next
          ? (prev.x + prev.width + next.x) / 2
          : prev
            ? prev.x + prev.width + Math.min(6, Math.max(2, (layout.columnGap ?? layout.gap) / 2))
            : next!.x - Math.min(6, Math.max(2, (layout.columnGap ?? layout.gap) / 2));
      const refTop = Math.min(prev?.y ?? Infinity, next?.y ?? Infinity);
      const refBottom = Math.max(
        prev ? prev.y + prev.height : -Infinity,
        next ? next.y + next.height : -Infinity,
      );
      indicatorLine = {
        x1: lineX,
        y1: Number.isFinite(refTop) ? refTop : container.y + layout.padding.top,
        x2: lineX,
        y2: Number.isFinite(refBottom) ? refBottom : container.y + container.height - layout.padding.bottom,
      };
      orientation = 'vertical';
    } else {
      let insertIdx = remainingVisual.length;
      for (let i = 0; i < sortedWithIdx.length; i += 1) {
        const sibling = sortedWithIdx[i].node;
        if (pointer.y < sibling.y + sibling.height / 2) {
          insertIdx = i;
          break;
        }
      }
      bestVisualIndex = insertIdx;
      const prev = insertIdx > 0 ? remainingVisual[insertIdx - 1] : null;
      const next = insertIdx < remainingVisual.length ? remainingVisual[insertIdx] : null;
      const lineY =
        prev && next
          ? (prev.y + prev.height + next.y) / 2
          : prev
            ? prev.y + prev.height + Math.min(6, Math.max(2, (layout.rowGap ?? layout.gap) / 2))
            : next!.y - Math.min(6, Math.max(2, (layout.rowGap ?? layout.gap) / 2));
      const refLeft = Math.min(prev?.x ?? Infinity, next?.x ?? Infinity);
      const refRight = Math.max(
        prev ? prev.x + prev.width : -Infinity,
        next ? next.x + next.width : -Infinity,
      );
      indicatorLine = {
        x1: Number.isFinite(refLeft) ? refLeft : container.x + layout.padding.left,
        y1: lineY,
        x2: Number.isFinite(refRight) ? refRight : container.x + container.width - layout.padding.right,
        y2: lineY,
      };
      orientation = 'horizontal';
    }
  } else {
    // 2D Grid or Wrapped Flex: find nearest sibling card in 2D space, then split left/right (or top/bottom for wrapped column)
    let nearestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remainingVisual.length; i += 1) {
      const sibling = remainingVisual[i];
      const cx = sibling.x + sibling.width / 2;
      const cy = sibling.y + sibling.height / 2;
      const dist = Math.hypot(pointer.x - cx, pointer.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        nearestIdx = i;
      }
    }
    const anchor = remainingVisual[nearestIdx];
    if (isRow) {
      const placeAfter = pointer.x >= anchor.x + anchor.width / 2;
      bestVisualIndex = placeAfter ? nearestIdx + 1 : nearestIdx;
      const halfGap = Math.min(6, Math.max(2, (layout.columnGap ?? layout.gap) / 2));
      const lineX = placeAfter ? anchor.x + anchor.width + halfGap : anchor.x - halfGap;
      indicatorLine = {
        x1: lineX,
        y1: anchor.y,
        x2: lineX,
        y2: anchor.y + anchor.height,
      };
      orientation = 'vertical';
    } else {
      const placeAfter = pointer.y >= anchor.y + anchor.height / 2;
      bestVisualIndex = placeAfter ? nearestIdx + 1 : nearestIdx;
      const halfGap = Math.min(6, Math.max(2, (layout.rowGap ?? layout.gap) / 2));
      const lineY = placeAfter ? anchor.y + anchor.height + halfGap : anchor.y - halfGap;
      indicatorLine = {
        x1: anchor.x,
        y1: lineY,
        x2: anchor.x + anchor.width,
        y2: lineY,
      };
      orientation = 'horizontal';
    }
  }

  const move = resolveNativeMoveForVisualSlot(container, logicalChildren, draggedNode.id, bestVisualIndex);
  const displaySlotNumber = bestVisualIndex + 1;
  const hudPoint = {
    x: (indicatorLine.x1 + indicatorLine.x2) / 2,
    y: Math.min(indicatorLine.y1, indicatorLine.y2),
  };

  return {
    containerId: container.id,
    draggedId: draggedNode.id,
    move,
    visualSlotIndex: bestVisualIndex,
    displaySlotNumber,
    isNoOp: move === null,
    orientation,
    indicatorLine,
    hudPoint,
    hudText: move === null ? `Slot #${displaySlotNumber}` : `Move to #${displaySlotNumber}`,
  };
}

/**
 * Resolves keyboard arrow-key reordering for a single selected flow child inside an Auto-Layout
 * Flex or Grid container.
 */
export function resolveAutoLayoutKeyboardReorder(
  container: DesignNode,
  selectedNode: DesignNode,
  key: string,
  nodes: readonly DesignNode[],
  layerStates?: ReadonlyMap<string, EffectiveLayerState>,
): AutoLayoutKeyboardReorderResult | null {
  if (!isAutoLayoutContainer(container)) return null;
  if (selectedNode.parentId !== container.id || isOutOfFlow(selectedNode)) return null;

  const logicalChildren = getLogicalFlowChildren(container, nodes, layerStates);
  if (logicalChildren.length < 2) return null;

  const layout = container.layout;
  const visualChildren = isReverseFlex(layout) ? [...logicalChildren].reverse() : logicalChildren;
  const currentVisualIdx = visualChildren.findIndex((c) => c.id === selectedNode.id);
  if (currentVisualIdx < 0) return null;

  let step = 0;
  if (layout.mode === 'grid') {
    const cols = Math.max(1, Math.round(layout.gridColumns ?? 2));
    if (key === 'ArrowLeft') step = -1;
    else if (key === 'ArrowRight') step = 1;
    else if (key === 'ArrowUp') step = -cols;
    else if (key === 'ArrowDown') step = cols;
    else return null;
  } else if (isRowFlex(layout)) {
    if (key === 'ArrowLeft') step = -1;
    else if (key === 'ArrowRight') step = 1;
    else return null;
  } else {
    if (key === 'ArrowUp') step = -1;
    else if (key === 'ArrowDown') step = 1;
    else return null;
  }

  const targetVisualIdx = Math.max(0, Math.min(visualChildren.length - 1, currentVisualIdx + step));
  if (targetVisualIdx === currentVisualIdx) return null;

  // In `remainingVisual` (which excludes `selectedNode`), inserting at `targetVisualIdx`
  // places `selectedNode` at exact visual index `targetVisualIdx`.
  const move = resolveNativeMoveForVisualSlot(container, logicalChildren, selectedNode.id, targetVisualIdx);
  if (!move) return null;

  return {
    targetId: move.targetId,
    position: move.position,
    displaySlotNumber: targetVisualIdx + 1,
    containerId: container.id,
  };
}

/**
 * Re-runs the Auto-Layout solver against a mutated container layout and returns only the nodes
 * whose layout or solved geometry changed so live Canvas preview updates smoothly at 60fps.
 */
export function buildAutoLayoutScrubPreviewNodes(
  allNodes: readonly DesignNode[],
  updatedContainer: DesignNode,
  tokens?: DesignTokenCollection,
  canvasWidth?: number,
): DesignNode[] {
  const patched = allNodes.map((node) => (node.id === updatedContainer.id ? updatedContainer : node));
  const solved = computeAutoLayoutNodes(patched, { tokens, canvasWidth });
  const prevById = new Map(allNodes.map((node) => [node.id, node]));
  const changed: DesignNode[] = [];
  for (let i = 0; i < solved.length; i += 1) {
    const next = solved[i];
    if (next.id === updatedContainer.id) {
      changed.push(next);
      continue;
    }
    const prev = prevById.get(next.id);
    if (
      !prev ||
      prev.x !== next.x ||
      prev.y !== next.y ||
      prev.width !== next.width ||
      prev.height !== next.height
    ) {
      changed.push(next);
    }
  }
  return changed;
}

/**
 * Builds live solved sibling preview nodes when hovering a reorder slot inside an Auto-Layout container.
 * Keeps the dragged node at its pointer-offset ghost position while reflowing every sibling around it.
 */
export function buildAutoLayoutReorderPreviewNodes(
  allNodes: readonly DesignNode[],
  draggedGhostNode: DesignNode,
  slot: AutoLayoutReorderSlot,
  tokens?: DesignTokenCollection,
  canvasWidth?: number,
): DesignNode[] {
  const reordered = slot.move
    ? moveLayer([...allNodes], draggedGhostNode.id, slot.move.targetId, slot.move.position)
    : [...allNodes];
  const solved = computeAutoLayoutNodes(reordered, { tokens, canvasWidth });
  const prevById = new Map(allNodes.map((node) => [node.id, node]));
  const changed: DesignNode[] = [];
  for (let i = 0; i < solved.length; i += 1) {
    const next = solved[i];
    if (next.id === draggedGhostNode.id) {
      changed.push(draggedGhostNode);
      continue;
    }
    const prev = prevById.get(next.id);
    if (
      !prev ||
      prev.x !== next.x ||
      prev.y !== next.y ||
      prev.width !== next.width ||
      prev.height !== next.height
    ) {
      changed.push(next);
    }
  }
  return changed;
}

/**
 * Pure, framework-independent helpers for the Adobe Illustrator & CorelDRAW
 * Vector Studio Inspector: 9-point Transform Origin matrix, Arrange Z-Order
 * calculation, Artboard alignment, Step & Repeat cloning, and Studio Swatches.
 */

import type { DesignNode, DrawMaskMode, VectorShapeMeta } from '../../core/document/types';
import type { LayerDropPosition } from '../../core/document/layers';
import type { SelectSimilarCriterion } from '../../core/document/selectionQueries';
import type { PathfinderOperation } from '../../core/document/vector';
import type { Alignment, DistributionAxis } from '../../engines/canvas/geometry';
import { cloneNodesSubtree } from '../nodeClipboard';

export type TransformOriginAnchor = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br';

export type ArrangeOrderAction = 'front' | 'forward' | 'backward' | 'back';

export interface StepAndRepeatConfig {
  readonly copies: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotateDeg: number;
}

export interface StudioVectorActions {
  readonly onPathfinder: (operation: PathfinderOperation) => void;
  readonly onBooleanOp: (operation: PathfinderOperation) => void;
  readonly onDividePathfinder: () => void;
  readonly onCombineSelection?: () => void;
  readonly onOffsetPath: (distancePx: number, keepOriginal: boolean) => void;
  readonly onReversePath: () => void;
  readonly onConvertAllAnchors: (mode: 'smooth' | 'corner') => void;
  readonly onUpdateParametricShape: (meta: VectorShapeMeta) => void;
  readonly onFlip: (axis: 'horizontal' | 'vertical') => void;
  readonly onRotateBy: (deltaDeg: number) => void;
  readonly onResetRotation: () => void;
  readonly onAlign: (alignment: Alignment) => void;
  readonly onDistribute: (axis: DistributionAxis) => void;
  readonly onArrange: (action: ArrangeOrderAction) => void;
  readonly onStepAndRepeat: (config: StepAndRepeatConfig) => void;
  readonly onSwapFillAndStroke: () => void;
  readonly onResetDefaultColors: () => void;
  readonly onApplySwatch: (color: string, channel: 'fill' | 'stroke') => void;
  readonly onGroupSelection: () => void;
  readonly onUngroupSelection: () => void;
  readonly onCreateClippingMask: () => void;
  readonly onDeselect: () => void;
  readonly onInvertSelection: () => void;
  readonly onSelectSimilar: (criterion: SelectSimilarCriterion) => void;
  readonly onSetDrawMode: (mode: DrawMaskMode) => void;
  readonly onPermanentSubtractOutside: () => void;
  readonly onOpenNodeLogic?: () => void;
}

export interface StrokeDashPreset {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export const STROKE_DASH_PRESETS: readonly StrokeDashPreset[] = Object.freeze([
  { id: 'solid', label: 'Solid', value: '' },
  { id: 'dash', label: 'Dash', value: '8 5' },
  { id: 'short', label: 'Short', value: '4 4' },
  { id: 'dot', label: 'Dot', value: '2 4' },
  { id: 'dash-dot', label: 'D·Dot', value: '10 4 2 4' },
]);

export const STROKE_WIDTH_PRESETS: readonly number[] = Object.freeze([0, 1, 2, 4, 8]);

/**
 * Curated CorelDRAW / Adobe Illustrator default swatch palette (neutrals +
 * high-precision editorial/vector hues). Left-click sets Fill; Shift/Right-click sets Stroke.
 */
export const STUDIO_COLOR_SWATCHES: readonly { readonly name: string; readonly hex: string }[] = Object.freeze([
  { name: 'Pure White', hex: '#FFFFFF' },
  { name: 'Cloud', hex: '#E2E8F0' },
  { name: 'Slate', hex: '#94A3B8' },
  { name: 'Graphite', hex: '#475569' },
  { name: 'Charcoal', hex: '#1E293B' },
  { name: 'Obsidian', hex: '#0F172A' },
  { name: 'Jet Ink', hex: '#000000' },
  { name: 'Crimson', hex: '#EF4444' },
  { name: 'Coral', hex: '#F97316' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Gold', hex: '#EAB308' },
  { name: 'Lime', hex: '#84CC16' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Sky', hex: '#38BDF8' },
  { name: 'Cobalt', hex: '#3B82F6' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Studio Violet', hex: '#8B7CF6' },
  { name: 'Fuchsia', hex: '#D946EF' },
  { name: 'Rose', hex: '#F43F5E' },
]);

const ORIGIN_FACTORS: Record<TransformOriginAnchor, { readonly fx: number; readonly fy: number }> = {
  tl: { fx: 0, fy: 0 },
  tc: { fx: 0.5, fy: 0 },
  tr: { fx: 1, fy: 0 },
  ml: { fx: 0, fy: 0.5 },
  c: { fx: 0.5, fy: 0.5 },
  mr: { fx: 1, fy: 0.5 },
  bl: { fx: 0, fy: 1 },
  bc: { fx: 0.5, fy: 1 },
  br: { fx: 1, fy: 1 },
};

export function getOriginFactors(origin: TransformOriginAnchor): { readonly fx: number; readonly fy: number } {
  return ORIGIN_FACTORS[origin];
}

/**
 * Returns the displayed X/Y coordinates of a node relative to the chosen 9-point
 * Illustrator/CorelDRAW reference origin (e.g. Top-Left, Center, Bottom-Right).
 */
export function getAnchorCoordinates(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>,
  origin: TransformOriginAnchor,
): { readonly x: number; readonly y: number } {
  const { fx, fy } = ORIGIN_FACTORS[origin];
  return {
    x: Math.round((node.x + node.width * fx) * 100) / 100,
    y: Math.round((node.y + node.height * fy) * 100) / 100,
  };
}

/** Converts an edited reference-origin X or Y coordinate back into top-left node x/y. */
export function computePositionPatchForOrigin(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>,
  origin: TransformOriginAnchor,
  axis: 'x' | 'y',
  referenceValue: number,
): Partial<Pick<DesignNode, 'x' | 'y'>> {
  const { fx, fy } = ORIGIN_FACTORS[origin];
  if (axis === 'x') {
    return { x: Math.round((referenceValue - node.width * fx) * 100) / 100 };
  }
  return { y: Math.round((referenceValue - node.height * fy) * 100) / 100 };
}

/**
 * Computes `{ x, y, width, height }` when resizing a node so the selected 9-point
 * reference origin stays pinned in place (just like Illustrator Transform & CorelDRAW).
 */
export function computeResizePatchForOrigin(
  node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>,
  origin: TransformOriginAnchor,
  nextWidth: number,
  nextHeight: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const { fx, fy } = ORIGIN_FACTORS[origin];
  const anchorX = node.x + node.width * fx;
  const anchorY = node.y + node.height * fy;
  const safeW = Math.max(1, nextWidth);
  const safeH = Math.max(1, nextHeight);
  return {
    x: Math.round((anchorX - safeW * fx) * 100) / 100,
    y: Math.round((anchorY - safeH * fy) * 100) / 100,
    width: Math.round(safeW * 100) / 100,
    height: Math.round(safeH * 100) / 100,
  };
}

/**
 * Computes a single-node alignment patch relative to the active artboard dimensions
 * (Illustrator "Align to Artboard" behavior when 1 object is selected).
 */
export function alignNodeToArtboard(
  node: DesignNode,
  artboardWidth: number,
  artboardHeight: number,
  alignment: Alignment,
): DesignNode {
  const safeW = Math.max(1, artboardWidth);
  const safeH = Math.max(1, artboardHeight);
  switch (alignment) {
    case 'left':
      return { ...node, x: 0 };
    case 'horizontal-center':
      return { ...node, x: Math.round(((safeW - node.width) / 2) * 100) / 100 };
    case 'right':
      return { ...node, x: Math.round((safeW - node.width) * 100) / 100 };
    case 'top':
      return { ...node, y: 0 };
    case 'vertical-center':
      return { ...node, y: Math.round(((safeH - node.height) / 2) * 100) / 100 };
    case 'bottom':
      return { ...node, y: Math.round((safeH - node.height) * 100) / 100 };
  }
}

export interface ArrangeMoveSpec {
  readonly nodeIds: readonly string[];
  readonly targetId: string;
  readonly position: LayerDropPosition;
}

/**
 * Computes the exact Native Command `moveLayers(nodeIds, targetId, position)`
 * target for Adobe Illustrator / CorelDRAW Arrange Z-Order actions.
 *
 * Note on FOLIO document array ordering:
 * - `nodes[0]` is painted at the back (bottom of stack).
 * - `nodes[nodes.length - 1]` is painted in front (top of stack).
 * - In `moveLayer`: `position: 'before'` places the moved node ABOVE the target (higher index),
 *   and `position: 'after'` places it BELOW the target (lower index), matching the Layers panel
 *   top-to-bottom visual order.
 */
export function computeArrangeMoveSpec(
  nodes: readonly DesignNode[],
  selectedIds: readonly string[],
  action: ArrangeOrderAction,
): ArrangeMoveSpec | null {
  if (selectedIds.length === 0 || nodes.length < 2) return null;
  const selectedSet = new Set(selectedIds);
  const selectedRootNodes = nodes.filter(
    (node) => selectedSet.has(node.id) && (!node.parentId || !selectedSet.has(node.parentId)),
  );
  if (selectedRootNodes.length === 0) return null;

  const primaryParentId = selectedRootNodes[0].parentId ?? null;
  const siblings = nodes.filter((node) => (node.parentId ?? null) === primaryParentId);
  if (siblings.length < 2) return null;

  const rootIdSet = new Set(selectedRootNodes.map((n) => n.id));
  const selectedSiblingIndices: number[] = [];
  siblings.forEach((sib, idx) => {
    if (rootIdSet.has(sib.id)) selectedSiblingIndices.push(idx);
  });
  if (selectedSiblingIndices.length === 0) return null;

  const firstIdx = selectedSiblingIndices[0];
  const lastIdx = selectedSiblingIndices[selectedSiblingIndices.length - 1];
  const movableIds = selectedSiblingIndices.map((idx) => siblings[idx].id);

  if (action === 'front') {
    const topMostUnselected = [...siblings].reverse().find((sib) => !rootIdSet.has(sib.id));
    if (!topMostUnselected || siblings[siblings.length - 1].id === siblings[lastIdx].id) return null;
    return { nodeIds: movableIds, targetId: topMostUnselected.id, position: 'before' };
  }

  if (action === 'back') {
    const bottomMostUnselected = siblings.find((sib) => !rootIdSet.has(sib.id));
    if (!bottomMostUnselected || siblings[0].id === siblings[firstIdx].id) return null;
    return { nodeIds: movableIds, targetId: bottomMostUnselected.id, position: 'after' };
  }

  if (action === 'forward') {
    const nextAbove = siblings.slice(lastIdx + 1).find((sib) => !rootIdSet.has(sib.id));
    if (!nextAbove) return null;
    return { nodeIds: movableIds, targetId: nextAbove.id, position: 'before' };
  }

  // backward
  const nextBelow = [...siblings.slice(0, firstIdx)].reverse().find((sib) => !rootIdSet.has(sib.id));
  if (!nextBelow) return null;
  return { nodeIds: movableIds, targetId: nextBelow.id, position: 'after' };
}

/**
 * Generates CorelDRAW / Adobe Illustrator Step & Repeat clones with progressive
 * X/Y translation and optional incremental rotation, ready for one atomic `createNodes`.
 */
export function computeStepAndRepeatClones(
  documentNodes: readonly DesignNode[],
  selectedIds: readonly string[],
  config: StepAndRepeatConfig,
): DesignNode[] {
  const copies = Math.max(1, Math.min(24, Math.round(config.copies)));
  const dx = Number.isFinite(config.offsetX) ? config.offsetX : 0;
  const dy = Number.isFinite(config.offsetY) ? config.offsetY : 0;
  const rotStep = Number.isFinite(config.rotateDeg) ? config.rotateDeg : 0;
  if (selectedIds.length === 0) return [];

  const allClones: DesignNode[] = [];
  for (let step = 1; step <= copies; step += 1) {
    const { clonedNodes } = cloneNodesSubtree(documentNodes, selectedIds, {
      offsetX: dx * step,
      offsetY: dy * step,
      nameSuffix: ` #${step + 1}`,
      preserveExternalParent: true,
    });
    for (const clone of clonedNodes) {
      allClones.push(
        rotStep !== 0
          ? { ...clone, rotation: Math.round((((clone.rotation || 0) + rotStep * step) % 360) * 100) / 100 }
          : clone,
      );
    }
  }
  return allClones;
}

/**
 * Extracts unique solid hex colors currently used across the active document
 * so users get a live Document Swatches row like Adobe Illustrator & CorelDRAW.
 */
export function extractDocumentSwatches(nodes: readonly DesignNode[], maxCount = 12): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  const pushHex = (raw: string | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    colors.push(trimmed);
  };

  for (const node of nodes) {
    if (colors.length >= maxCount) break;
    if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
      pushHex(node.style.fill);
      if (node.style.strokeWidth > 0) pushHex(node.style.stroke);
    } else if (node.type === 'text') {
      pushHex(node.style.fill);
    }
  }
  return colors.slice(0, maxCount);
}

/**
 * Pure selection query helpers executed by the Native Command Engine
 * (`selection.invert` and `selection.select-similar`).
 *
 * Strictly filters out hidden, locked, and off-canvas layers using
 * `getEffectiveLayerStates`, and expands group subtrees consistently.
 */

import { expandSelectedLayerIds, getEffectiveLayerStates } from './layers';
import { isTransparentColor, parseColorWithAlpha } from './styling';
import type { DesignNode } from './types';

export type SelectSimilarCriterion = 'fill' | 'stroke' | 'type';

function isNodeSelectable(
  node: DesignNode,
  effectiveStates: ReadonlyMap<string, { visible: boolean; locked: boolean }>,
): boolean {
  if (node.onCanvas === false) return false;
  const state = effectiveStates.get(node.id);
  return Boolean(state?.visible && !state.locked);
}

function normalizeComparableColor(raw: string | undefined): string {
  if (isTransparentColor(raw)) return 'transparent';
  const parsed = parseColorWithAlpha(raw, '#000000');
  if (parsed.isTransparent) return 'transparent';
  return `${parsed.hex}@${Math.round(parsed.alpha * 100)}`;
}

function getNodeFillSignature(node: DesignNode): string | null {
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
    return normalizeComparableColor(node.style.fill);
  }
  if (node.type === 'text') {
    return normalizeComparableColor(node.style.fill);
  }
  return null;
}

function getNodeStrokeSignature(node: DesignNode): string | null {
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
    if (node.style.strokeWidth <= 0 || isTransparentColor(node.style.stroke)) {
      return 'transparent';
    }
    return normalizeComparableColor(node.style.stroke);
  }
  if (node.type === 'image') {
    if (!node.style.strokeWidth || node.style.strokeWidth <= 0 || isTransparentColor(node.style.stroke)) {
      return 'transparent';
    }
    return normalizeComparableColor(node.style.stroke);
  }
  return null;
}

/**
 * Inverts selection among unlocked, visible, on-canvas sibling nodes in the
 * active parent scope (or top-level siblings when nothing is selected).
 */
export function computeInvertedSelectionIds(
  nodes: readonly DesignNode[],
  currentSelectedIds: readonly string[],
): string[] {
  const effectiveStates = getEffectiveLayerStates([...nodes]);
  const selectedSet = new Set(currentSelectedIds);

  // Determine the active parent scope from selected root nodes (default null = page root)
  const selectedRoots = nodes.filter(
    (node) => selectedSet.has(node.id) && (!node.parentId || !selectedSet.has(node.parentId)),
  );
  const parentScopes = new Set<string | null>(
    selectedRoots.length > 0
      ? selectedRoots.map((node) => node.parentId ?? null)
      : [null],
  );

  const invertedRoots: string[] = [];
  for (const node of nodes) {
    const parentId = node.parentId ?? null;
    if (!parentScopes.has(parentId)) continue;
    if (!isNodeSelectable(node, effectiveStates)) continue;
    if (selectedSet.has(node.id)) continue;
    invertedRoots.push(node.id);
  }

  return expandSelectedLayerIds([...nodes], invertedRoots).filter((id) => {
    const node = nodes.find((item) => item.id === id);
    return Boolean(node && isNodeSelectable(node, effectiveStates));
  });
}

/**
 * Selects all visible, unlocked, on-canvas nodes matching the primary selected
 * node by `fill`, `stroke`, or `type`.
 */
export function computeSimilarSelectionIds(
  nodes: readonly DesignNode[],
  currentSelectedIds: readonly string[],
  criterion: SelectSimilarCriterion,
): string[] {
  if (currentSelectedIds.length === 0) return [];
  const effectiveStates = getEffectiveLayerStates([...nodes]);
  const primary = nodes.find((node) => node.id === currentSelectedIds[0]);
  if (!primary) return [];

  if (criterion === 'type') {
    const matched = nodes
      .filter((node) => node.type === primary.type && isNodeSelectable(node, effectiveStates))
      .map((node) => node.id);
    return expandSelectedLayerIds([...nodes], matched).filter((id) => {
      const node = nodes.find((item) => item.id === id);
      return Boolean(node && isNodeSelectable(node, effectiveStates));
    });
  }

  if (criterion === 'fill') {
    const targetFill = getNodeFillSignature(primary);
    if (targetFill === null) return [];
    const matched = nodes
      .filter((node) => isNodeSelectable(node, effectiveStates) && getNodeFillSignature(node) === targetFill)
      .map((node) => node.id);
    return matched;
  }

  const targetStroke = getNodeStrokeSignature(primary);
  if (targetStroke === null) return [];
  return nodes
    .filter((node) => isNodeSelectable(node, effectiveStates) && getNodeStrokeSignature(node) === targetStroke)
    .map((node) => node.id);
}

import {
  expandSelectedLayerIds,
  getClippingMaskBaseId,
  getLayerAncestorIds,
  getLayerAncestorIdsFromMap,
  getLayerPanelRows,
  getSelectedLayerRootIds,
  type LayerDropPosition,
  type LayerPanelRow,
} from '../../core/document/layers';
import type { DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';

export const LAYER_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7',
  '#ec4899', '#94a3b8',
] as const;

export interface LayerRenameSession {
  anchorId: string;
  nodeIds: string[];
  value: string;
  batch: boolean;
  editorId: EditorTarget;
  existingNames: string[];
}

export interface LayerContextMenuState {
  nodeId: string;
  nodeIds: string[];
  editorId: EditorTarget;
  x: number;
  y: number;
}

export interface LayerContextMenuCapabilities {
  rootIds: string[];
  rootNodes: DesignNode[];
  canGroup: boolean;
  canUngroup: boolean;
  canMask: boolean;
  canUnmask: boolean;
}

export interface LayerSelectionResult {
  action: 'rename-single' | 'rename-batch' | 'select';
  nodeIds?: string[];
  nextAnchorId?: string | null;
  description?: string;
}

export interface PopoverRectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Computes deterministic node rename updates for both single-layer and numbered
 * batch renames while avoiding collisions with non-selected sibling names.
 */
export function computeLayerRenameUpdates(
  session: Pick<LayerRenameSession, 'nodeIds' | 'value' | 'batch' | 'existingNames'>,
): Array<{ nodeId: string; name: string }> {
  const baseName = session.value.trim();
  if (!baseName || session.nodeIds.length === 0) return [];

  if (!session.batch) {
    return [{ nodeId: session.nodeIds[0], name: baseName }];
  }

  const occupied = new Set(session.existingNames);
  let suffix = 1;
  return session.nodeIds.map((nodeId) => {
    let name = '';
    do {
      name = `${baseName} ${suffix++}`;
    } while (occupied.has(name));
    occupied.add(name);
    return { nodeId, name };
  });
}

/**
 * Resolves the Layers panel drop zone from a normalized vertical pointer ratio.
 */
export function getLayerDropPositionFromRatio(relativeY: number): LayerDropPosition {
  if (relativeY < 0.25) return 'before';
  if (relativeY > 0.75) return 'after';
  return 'inside';
}

/**
 * Resolves the Layers panel drop zone from a target element bounding rect and pointer Y.
 */
export function getLayerDropPosition(
  rect: { top: number; height: number },
  clientY: number,
): LayerDropPosition {
  const relativeY = (clientY - rect.top) / Math.max(1, rect.height);
  return getLayerDropPositionFromRatio(relativeY);
}

/**
 * Derives available Layer context menu actions for the given node selection.
 */
export function getLayerContextMenuCapabilities(
  nodes: readonly DesignNode[],
  selectedNodeIds: readonly string[],
): LayerContextMenuCapabilities {
  const rootIds = getSelectedLayerRootIds(nodes, selectedNodeIds);
  const rootNodes = rootIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DesignNode => node !== undefined);

  const canGroup = rootNodes.length > 1
    || (rootNodes.length === 1 && (
      rootNodes[0].type === 'group'
      || nodes.some((node) => node.parentId === rootNodes[0].id)
    ));
  const canUngroup = rootNodes.some((root) =>
    nodes.some((node) => node.parentId === root.id),
  );
  const canMask = rootIds.length === 1
    && Boolean(getClippingMaskBaseId(nodes, rootIds[0]));
  const canUnmask = rootIds.length === 1
    && Boolean(rootNodes[0]?.clipMaskBaseId);

  return {
    rootIds,
    rootNodes,
    canGroup,
    canUngroup,
    canMask,
    canUnmask,
  };
}

/**
 * Pure selection resolver for clicks/Enter/Space in the Layers panel.
 * Preserves subtree selection invariants, Shift-range selection, Cmd/Ctrl
 * toggling, and click-selected-to-rename interactions.
 */
export function computeLayerSelection(params: {
  nodeId: string;
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  nodes: readonly DesignNode[];
  rows: readonly LayerPanelRow[];
  selectedNodeIds: readonly string[];
  currentAnchorId: string | null;
}): LayerSelectionResult {
  const { nodeId, modifiers, nodes, rows, selectedNodeIds, currentAnchorId } = params;
  const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  const subtreeIds = expandSelectedLayerIds(nodes, [nodeId]);
  const subtreeIsSelected = subtreeIds.length === selectedNodeIds.length
    && subtreeIds.every((id) => selectedNodeIds.includes(id));

  if (
    modifiers.shiftKey
    && selectedNodeIds.length > 1
    && selectedNodeIds.includes(nodeId)
    && !subtreeIsSelected
    && getLayerAncestorIds(nodes, nodeId).size === 0
  ) {
    return { action: 'rename-batch' };
  }

  if (!modifiers.shiftKey && !additive && subtreeIsSelected) {
    return { action: 'rename-single' };
  }

  const orderedIds = rows.map((row) => row.node.id);
  if (modifiers.shiftKey) {
    const anchorId = currentAnchorId && selectedNodeIds.includes(currentAnchorId)
      ? currentAnchorId
      : (selectedNodeIds[0] ?? nodeId);
    const start = orderedIds.indexOf(anchorId);
    const end = orderedIds.indexOf(nodeId);
    if (start >= 0 && end >= 0) {
      const range = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      const requested = additive ? [...new Set([...selectedNodeIds, ...range])] : range;
      return {
        action: 'select',
        nodeIds: expandSelectedLayerIds(nodes, requested),
        nextAnchorId: currentAnchorId,
        description: 'Select layer range',
      };
    }
  }

  if (additive) {
    const groupIsSelected = subtreeIds.every((id) => selectedNodeIds.includes(id));
    let next: string[];
    if (groupIsSelected) {
      // A child cannot stay implicitly selected through an ancestor after
      // its own subtree is toggled off.
      const removed = new Set([...subtreeIds, ...getLayerAncestorIds(nodes, nodeId)]);
      next = selectedNodeIds.filter((id) => !removed.has(id));
    } else {
      next = expandSelectedLayerIds(nodes, [...selectedNodeIds, ...subtreeIds]);
    }
    const nextAnchorId = (!currentAnchorId || !selectedNodeIds.includes(currentAnchorId))
      ? nodeId
      : currentAnchorId;
    return {
      action: 'select',
      nodeIds: next,
      nextAnchorId,
      description: 'Toggle layer selection',
    };
  }

  return {
    action: 'select',
    nodeIds: subtreeIds,
    nextAnchorId: nodeId,
    description: 'Select layer',
  };
}

/**
 * Computes a viewport-clamped fixed position for an anchored popover
 * (such as the Layer Color Palette), preferring placement below the anchor
 * and flipping above when near the bottom viewport edge.
 */
export function computeClampedPopoverPosition(
  anchorRect: PopoverRectLike,
  popoverSize: PopoverSize,
  viewport: ViewportSize,
  options: { margin?: number; gap?: number } = {},
): { top: number; left: number } {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 6;
  const left = Math.max(
    margin,
    Math.min(viewport.width - popoverSize.width - margin, anchorRect.right - popoverSize.width),
  );
  const belowTop = anchorRect.bottom + gap;
  const top = belowTop + popoverSize.height <= viewport.height - margin
    ? belowTop
    : Math.max(margin, anchorRect.top - popoverSize.height - gap);
  return { top, left };
}

/**
 * Clamps a context menu point to keep the menu inside the visible viewport.
 */
export function computeClampedContextMenuPosition(
  clientX: number,
  clientY: number,
  viewport: ViewportSize,
  menuSize: PopoverSize = { width: 208, height: 240 },
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(clientX, viewport.width - menuSize.width - margin)),
    y: Math.max(margin, Math.min(clientY, viewport.height - menuSize.height - margin)),
  };
}

export interface FilteredLayerRowsResult {
  isFiltering: boolean;
  rows: LayerPanelRow[];
  matchedIds: ReadonlySet<string>;
  matchCount: number;
}

/**
 * Splits a raw layer search query into normalized lowercase search tokens.
 */
export function tokenizeLayerSearchQuery(rawQuery: string): string[] {
  return rawQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Returns true when every query token matches the layer's display name,
 * canonical AST node ID, or optional semantic HTML ID (case-insensitive).
 */
export function matchesLayerSearchQuery(
  node: Pick<DesignNode, 'id' | 'name' | 'htmlId'>,
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return true;
  const name = node.name.toLowerCase();
  const id = node.id.toLowerCase();
  const htmlId = node.htmlId?.toLowerCase() ?? '';
  return tokens.every((token) => name.includes(token) || id.includes(token) || htmlId.includes(token));
}

/**
 * Filters Layers panel rows by node name, canonical AST ID, or HTML ID while
 * preserving ancestor hierarchy context and auto-expanding collapsed branches
 * that contain matching descendants.
 */
export function filterLayerPanelRows(
  nodes: readonly DesignNode[],
  collapsedIds: readonly string[],
  rawQuery: string,
): FilteredLayerRowsResult {
  const tokens = tokenizeLayerSearchQuery(rawQuery);
  if (tokens.length === 0) {
    return {
      isFiltering: false,
      rows: getLayerPanelRows(nodes, collapsedIds),
      matchedIds: new Set<string>(),
      matchCount: nodes.length,
    };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const matchedIds = new Set<string>();
  const visibleIds = new Set<string>();

  for (const node of nodes) {
    if (matchesLayerSearchQuery(node, tokens)) {
      matchedIds.add(node.id);
      visibleIds.add(node.id);
      for (const ancestorId of getLayerAncestorIdsFromMap(nodeById, node.id)) {
        visibleIds.add(ancestorId);
      }
    }
  }

  if (matchedIds.size === 0) {
    return {
      isFiltering: true,
      rows: [],
      matchedIds,
      matchCount: 0,
    };
  }

  // Expand all branches while searching so matching descendants inside collapsed
  // frames/groups remain discoverable in their true parent hierarchy.
  const expandedRows = getLayerPanelRows(nodes, []);
  const rows = expandedRows.filter((row) => visibleIds.has(row.node.id));
  return {
    isFiltering: true,
    rows,
    matchedIds,
    matchCount: matchedIds.size,
  };
}

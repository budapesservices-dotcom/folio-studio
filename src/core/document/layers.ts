import type { DesignNode } from './types';

export type LayerDropPosition = 'before' | 'inside' | 'after';

export interface LayerPanelRow {
  node: DesignNode;
  depth: number;
  hasChildren: boolean;
}

export interface EffectiveLayerState {
  visible: boolean;
  locked: boolean;
}

function getParentId(node: DesignNode, nodeById: Map<string, DesignNode>): string | null {
  const parentId = node.parentId;
  return parentId && parentId !== node.id && nodeById.has(parentId) ? parentId : null;
}

function getChildrenMap(nodes: readonly DesignNode[]): Map<string | null, DesignNode[]> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, DesignNode[]>();
  for (const node of nodes) {
    const parentId = getParentId(node, nodeById);
    const siblings = children.get(parentId) ?? [];
    siblings.push(node);
    children.set(parentId, siblings);
  }
  return children;
}

/** Builds the Layers panel order. The document array is painted back-to-front. */
export function getLayerPanelRows(
  nodes: readonly DesignNode[],
  collapsedIds: readonly string[] = [],
): LayerPanelRow[] {
  const children = getChildrenMap(nodes);
  const collapsed = new Set(collapsedIds);
  const rows: LayerPanelRow[] = [];
  const visited = new Set<string>();

  const visit = (node: DesignNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const descendants = children.get(node.id) ?? [];
    rows.push({ node, depth, hasChildren: descendants.length > 0 });
    if (collapsed.has(node.id)) return;
    [...descendants].reverse().forEach((child) => visit(child, depth + 1));
  };

  [...(children.get(null) ?? [])].reverse().forEach((node) => visit(node, 0));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => {
    if (visited.has(node.id)) return;
    // A collapsed ancestor has already been visited, but this descendant was
    // intentionally not traversed. Do not re-add it as a fallback root.
    let parentId = getParentId(node, nodeById);
    const chain = new Set<string>();
    while (parentId && !chain.has(parentId)) {
      if (visited.has(parentId)) return;
      chain.add(parentId);
      const parent = nodeById.get(parentId);
      parentId = parent ? getParentId(parent, nodeById) : null;
    }
    visit(node, 0);
  });
  return rows;
}

/** Returns a paint order where each parent is drawn before its nested children. */
export function getLayerRenderOrder(nodes: readonly DesignNode[]): DesignNode[] {
  const children = getChildrenMap(nodes);
  const ordered: DesignNode[] = [];
  const visited = new Set<string>();

  const visit = (node: DesignNode) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    (children.get(node.id) ?? []).forEach(visit);
  };

  (children.get(null) ?? []).forEach(visit);
  nodes.forEach(visit);
  return ordered;
}

export function getEffectiveLayerStates(nodes: readonly DesignNode[]): Map<string, EffectiveLayerState> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const states = new Map<string, EffectiveLayerState>();

  const resolve = (node: DesignNode, visiting: Set<string>): EffectiveLayerState => {
    const cached = states.get(node.id);
    if (cached) return cached;
    if (visiting.has(node.id)) return { visible: node.visible, locked: node.locked };

    const nextVisiting = new Set(visiting);
    nextVisiting.add(node.id);
    const parentId = getParentId(node, nodeById);
    const parent = parentId ? nodeById.get(parentId) : undefined;
    const inherited = parent ? resolve(parent, nextVisiting) : { visible: true, locked: false };
    const result = {
      visible: node.visible && inherited.visible,
      locked: node.locked || inherited.locked,
    };
    states.set(node.id, result);
    return result;
  };

  nodes.forEach((node) => resolve(node, new Set()));
  return states;
}

export function getLayerDescendantIds(nodes: readonly DesignNode[], nodeId: string): Set<string> {
  const children = getChildrenMap(nodes);
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      visit(child.id);
    }
  };
  if (nodes.some((node) => node.id === nodeId)) visit(nodeId);
  return result;
}

/** Returns the ancestor chain for a layer, closest parent first. */
export function getLayerAncestorIds(nodes: readonly DesignNode[], nodeId: string): Set<string> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const result = new Set<string>();
  let current = nodeById.get(nodeId);
  let parentId = current ? getParentId(current, nodeById) : null;

  while (parentId && !result.has(parentId)) {
    result.add(parentId);
    current = nodeById.get(parentId);
    parentId = current ? getParentId(current, nodeById) : null;
  }

  return result;
}

/** Expands selected parent IDs into their complete nested subtrees in document order. */
export function expandSelectedLayerIds(nodes: readonly DesignNode[], selectedIds: readonly string[]): string[] {
  const available = new Set(nodes.map((node) => node.id));
  const included = new Set<string>();

  selectedIds.forEach((id) => {
    if (!available.has(id)) return;
    included.add(id);
    getLayerDescendantIds(nodes, id).forEach((childId) => included.add(childId));
  });

  return nodes.filter((node) => included.has(node.id)).map((node) => node.id);
}

/**
 * Canvas treats every nested layer as part of its top-level component.
 * A normal click anywhere in that hierarchy selects the whole component;
 * Shift-click is the precision override for selecting the exact child.
 */
export function getCanvasClickSelectionIds(
  nodes: readonly DesignNode[],
  nodeId: string,
  exactLayer = false,
): string[] {
  if (!nodes.some((node) => node.id === nodeId)) return [];
  if (exactLayer) return [nodeId];

  const ancestors = getLayerAncestorIds(nodes, nodeId);
  const componentRootId = [...ancestors].at(-1) ?? nodeId;
  return expandSelectedLayerIds(nodes, [componentRootId]);
}

/** Selecting a parent layer also transforms its descendants as one visual hierarchy. */
export function expandSelectedLayers(nodes: readonly DesignNode[], selectedIds: readonly string[]): DesignNode[] {
  const included = new Set(expandSelectedLayerIds(nodes, selectedIds));
  return nodes.filter((node) => included.has(node.id));
}

/** Moves one or more selected layer roots as a single block, preserving every nested subtree. */
export function moveLayers(nodes: DesignNode[], nodeIds: readonly string[], targetId: string, position: LayerDropPosition): DesignNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(nodeIds.filter((id) => nodeById.has(id)));
  const target = nodeById.get(targetId);
  if (selected.size === 0 || !target) return nodes;

  // If a parent and its child are both selected, move only their common root.
  const rootIds = new Set<string>();
  for (const id of selected) {
    let parentId = getParentId(nodeById.get(id)!, nodeById);
    const visited = new Set<string>();
    let hasSelectedAncestor = false;
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) { hasSelectedAncestor = true; break; }
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      parentId = parent ? getParentId(parent, nodeById) : null;
    }
    if (!hasSelectedAncestor) rootIds.add(id);
  }

  const movedIds = new Set<string>();
  for (const rootId of rootIds) {
    movedIds.add(rootId);
    getLayerDescendantIds(nodes, rootId).forEach((id) => movedIds.add(id));
  }
  if (movedIds.has(targetId)) return nodes;

  const movedBlock = nodes.filter((node) => movedIds.has(node.id));
  const remaining = nodes.filter((node) => !movedIds.has(node.id));
  const targetBlock = getLayerDescendantIds(remaining, targetId);
  targetBlock.add(targetId);
  const targetIndexes = remaining.map((node, index) => targetBlock.has(node.id) ? index : -1).filter((index) => index >= 0);
  if (targetIndexes.length === 0) return nodes;

  const parentId = position === 'inside' ? targetId : (target.parentId ?? undefined);
  if (parentId && movedIds.has(parentId)) return nodes;
  const movedWithParents = movedBlock.map((node) => rootIds.has(node.id) ? { ...node, parentId } : node);

  // Node storage is paint order (back-to-front), while the panel reads in reverse.
  const insertionIndex = position === 'after' ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1;
  return [...remaining.slice(0, insertionIndex), ...movedWithParents, ...remaining.slice(insertionIndex)];
}

/** Backwards-compatible single-layer move helper. */
export function moveLayer(nodes: DesignNode[], nodeId: string, targetId: string, position: LayerDropPosition): DesignNode[] {
  return moveLayers(nodes, [nodeId], targetId, position);
}

/** Deleting a parent promotes surviving children to the nearest surviving ancestor. */
export function removeLayersAndPromoteChildren(
  nodes: DesignNode[],
  removedIds: Iterable<string>,
): DesignNode[] {
  const removed = new Set(removedIds);
  if (!nodes.some((node) => removed.has(node.id))) return nodes as DesignNode[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return nodes
    .filter((node) => !removed.has(node.id))
    .map((node) => {
      let parentId = node.parentId ?? undefined;
      const visited = new Set<string>();
      while (parentId && removed.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        parentId = nodeById.get(parentId)?.parentId ?? undefined;
      }
      return parentId === node.parentId ? node : { ...node, parentId };
    });
}


/** Creates a dedicated non-visual container and reparents selected sibling roots. */
export function groupLayers(nodes: DesignNode[], selectedIds: readonly string[]): DesignNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(selectedIds.filter((id) => nodeById.has(id)));
  if (selected.size < 2) return nodes;
  const roots = [...selected].filter((id) => {
    let parentId = getParentId(nodeById.get(id)!, nodeById);
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      parentId = parent ? getParentId(parent, nodeById) : null;
    }
    return true;
  });
  if (roots.length < 2) return nodes;
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  roots.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const parentId = nodeById.get(roots[0])?.parentId ?? null;
  if (!roots.every((id) => (nodeById.get(id)?.parentId ?? null) === parentId)) return nodes;
  const picked = roots.map((id) => nodeById.get(id)!);
  const x = Math.min(...picked.map((node) => node.x));
  const y = Math.min(...picked.map((node) => node.y));
  const right = Math.max(...picked.map((node) => node.x + node.width));
  const bottom = Math.max(...picked.map((node) => node.y + node.height));
  const groupId = 'group-' + (globalThis.crypto?.randomUUID?.() ?? (Date.now() + '-' + Math.random().toString(16).slice(2)));
  const group: DesignNode = { id: groupId, type: 'group', name: 'Group', x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), rotation: 0, opacity: 1, visible: true, locked: false, ...(parentId ? { parentId } : {}) };
  const rootSet = new Set(roots);
  const firstIndex = Math.min(...roots.map((id) => order.get(id) ?? nodes.length));
  const next = nodes.map((node) => rootSet.has(node.id) ? { ...node, parentId: groupId } : node);
  next.splice(firstIndex, 0, group);
  return next;
}

/** Removes selected Group containers and promotes their direct children. */
export function ungroupLayers(nodes: DesignNode[], selectedIds: readonly string[]): DesignNode[] {
  const groups = new Map(nodes.filter((node) => node.type === 'group' && selectedIds.includes(node.id)).map((node) => [node.id, node]));
  if (groups.size === 0) return nodes;
  return nodes.filter((node) => !groups.has(node.id)).map((node) => {
    if (!node.parentId || !groups.has(node.parentId)) return node;
    const parentId = groups.get(node.parentId)?.parentId ?? undefined;
    if (parentId) return { ...node, parentId };
    const { parentId: _parentId, ...promoted } = node;
    return promoted;
  });
}
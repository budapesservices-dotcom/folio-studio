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

/** Reduce a selection to its independent roots (a selected Group counts once). */
export function getSelectedLayerRootIds(nodes: readonly DesignNode[], selectedIds: readonly string[]): string[] {
  const available = new Set(nodes.map((node) => node.id));
  const selected = new Set(selectedIds.filter((id) => available.has(id)));
  return nodes
    .filter((node) => selected.has(node.id))
    .filter((node) => ![...getLayerAncestorIds(nodes, node.id)].some((ancestorId) => selected.has(ancestorId)))
    .map((node) => node.id);
}

/** Photoshop-style clipping uses the immediately lower sibling as its base. */
export function getClippingMaskBaseId(nodes: readonly DesignNode[], nodeId: string): string | null {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const parentId = node.parentId ?? null;
  const siblings = nodes.filter((item) => (item.parentId ?? null) === parentId);
  const index = siblings.findIndex((item) => item.id === nodeId);
  if (index <= 0) return null;
  const base = siblings[index - 1];
  const baseId = base.clipMaskBaseId && nodes.some((item) => item.id === base.clipMaskBaseId)
    ? base.clipMaskBaseId
    : base.id;
  return baseId === nodeId ? null : baseId;
}

/** Creates an undoable clipping relationship without changing layer geometry. */
export function createClippingMask(nodes: DesignNode[], nodeId: string): DesignNode[] {
  const baseId = getClippingMaskBaseId(nodes, nodeId);
  if (!baseId) return nodes;
  const target = nodes.find((node) => node.id === nodeId);
  if (!target || target.clipMaskBaseId === baseId) return nodes;
  return nodes.map((node) => node.id === nodeId ? { ...node, clipMaskBaseId: baseId } : node);
}

/** Removes only the selected clipping relationship. */
export function removeClippingMask(nodes: DesignNode[], nodeId: string): DesignNode[] {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target?.clipMaskBaseId) return nodes;
  return nodes.map((node) => node.id === nodeId ? { ...node, clipMaskBaseId: undefined } : node);
}

/** Returns inherited and local clipping bases for Canvas rendering. */
export function getLayerClipMaskBaseIds(nodes: readonly DesignNode[], nodeId: string): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  const visited = new Set<string>();

  const collectOwnerAndAncestors = (ownerId: string) => {
    const chain: DesignNode[] = [];
    const localVisited = new Set<string>();
    let current = nodeById.get(ownerId);
    while (current && !localVisited.has(current.id)) {
      localVisited.add(current.id);
      chain.push(current);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
    chain.reverse().forEach((owner) => {
      if (visited.has(owner.id)) return;
      visited.add(owner.id);
      const baseId = owner.clipMaskBaseId;
      if (baseId && nodeById.has(baseId) && baseId !== owner.id) {
        collectOwnerAndAncestors(baseId);
        if (!result.includes(baseId)) result.push(baseId);
      }
    });
  };

  collectOwnerAndAncestors(nodeId);
  return result;
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
  const layerNodes = nodes;
  const children = getChildrenMap(layerNodes);
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
  const nodeById = new Map(layerNodes.map((node) => [node.id, node]));
  layerNodes.forEach((node) => {
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
 * Fold Canvas-only clones from earlier builds back into their source layer.
 * The last visible clone is used, preserving its last edited geometry and
 * appearance. If every old clone was hidden, the last clone is retained while
 * the source stays off Canvas. New placements never create clone records.
 */
type LegacyCanvasNode = DesignNode & { isCanvasInstance?: boolean; sourceLayerId?: string };

function stripLegacyCanvasFields(node: DesignNode): DesignNode {
  const clean = { ...node } as LegacyCanvasNode;
  delete clean.isCanvasInstance;
  delete clean.sourceLayerId;
  return clean;
}

function mergeLegacyCanvasState(master: DesignNode, instance: DesignNode, onCanvas: boolean): DesignNode {
  const common = {
    ...master,
    name: instance.name,
    x: instance.x,
    y: instance.y,
    width: instance.width,
    height: instance.height,
    rotation: instance.rotation,
    opacity: instance.opacity,
    visible: instance.visible,
    locked: instance.locked,
    layerColor: instance.layerColor ?? master.layerColor,
    onCanvas,
  };
  if (master.type === 'rect' && instance.type === 'rect') return { ...common, style: instance.style };
  if (master.type === 'ellipse' && instance.type === 'ellipse') return { ...common, style: instance.style };
  if (master.type === 'text' && instance.type === 'text') return { ...common, text: instance.text, style: instance.style };
  if (master.type === 'component-instance' && instance.type === 'component-instance') {
    return { ...common, componentId: instance.componentId, overrides: instance.overrides };
  }
  return common;
}

export function collapseLegacyCanvasInstances(nodes: readonly DesignNode[]): DesignNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const instancesBySource = new Map<string, DesignNode[]>();
  const orphanIds = new Set<string>();

  for (const node of nodes) {
    const legacy = node as LegacyCanvasNode;
    if (legacy.isCanvasInstance !== true) continue;
    const sourceId = legacy.sourceLayerId;
    const source = typeof sourceId === 'string' ? byId.get(sourceId) as LegacyCanvasNode | undefined : undefined;
    if (source && source.isCanvasInstance !== true) {
      const instances = instancesBySource.get(sourceId!) ?? [];
      instances.push(node);
      instancesBySource.set(sourceId!, instances);
    } else {
      orphanIds.add(node.id);
    }
  }

  const normalized: DesignNode[] = [];
  for (const node of nodes) {
    const legacy = node as LegacyCanvasNode;
    if (legacy.isCanvasInstance === true) {
      if (orphanIds.has(node.id)) normalized.push(stripLegacyCanvasFields(node));
      continue;
    }
    const instances = instancesBySource.get(node.id);
    if (!instances?.length) {
      normalized.push(stripLegacyCanvasFields(node));
      continue;
    }
    const visibleInstances = instances.filter((instance) => instance.onCanvas !== false);
    const latest = (visibleInstances.length > 0 ? visibleInstances : instances).at(-1)!;
    normalized.push(stripLegacyCanvasFields(mergeLegacyCanvasState(node, latest, visibleInstances.length > 0)));
  }
  return normalized;
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
  if (selected.size === 0) return nodes;
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
  if (roots.length === 0) return nodes;
  // A single selected hierarchy can be wrapped again. This is essential for
  // nested Groups and for a regular layer that already owns sub-layers.
  if (roots.length === 1) {
    const root = nodeById.get(roots[0])!;
    if (root.type !== 'group' && getLayerDescendantIds(nodes, root.id).size === 0) return nodes;
  }
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  roots.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  // Place the new container at the nearest common ancestor of the selected
  // roots. This allows grouping layers from different nested branches while
  // keeping every selected subtree intact.
  const ancestorChains = roots.map((id) => {
    const chain: string[] = [];
    let parentId = getParentId(nodeById.get(id)!, nodeById);
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      chain.push(parentId);
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      parentId = parent ? getParentId(parent, nodeById) : null;
    }
    return chain;
  });
  const firstChain = ancestorChains[0] ?? [];
  const parentId = firstChain.find((candidate) => ancestorChains.every((chain) => chain.includes(candidate))) ?? null;
  // Include every nested descendant in the container bounds. A parent
  // node's own rectangle may be smaller than content extending beyond it.
  const memberIds = new Set<string>();
  roots.forEach((id) => {
    memberIds.add(id);
    getLayerDescendantIds(nodes, id).forEach((childId) => memberIds.add(childId));
  });
  const picked = nodes.filter((node) => memberIds.has(node.id));
  const x = Math.min(...picked.map((node) => node.x));
  const y = Math.min(...picked.map((node) => node.y));
  const right = Math.max(...picked.map((node) => node.x + node.width));
  const bottom = Math.max(...picked.map((node) => node.y + node.height));
  const groupId = 'group-' + (globalThis.crypto?.randomUUID?.() ?? (Date.now() + '-' + Math.random().toString(16).slice(2)));
  const group: DesignNode = { id: groupId, type: 'group', name: 'Group', x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), rotation: 0, opacity: 1, visible: true, locked: false, onCanvas: picked.some((node) => node.onCanvas !== false), ...(parentId ? { parentId } : {}) };
  const rootSet = new Set(roots);
  const firstIndex = Math.min(...roots.map((id) => order.get(id) ?? nodes.length));
  const next = nodes.map((node) => {
    if (rootSet.has(node.id)) return { ...node, parentId: groupId };

    // A layer clipped to one of the newly grouped roots must clip to the
    // resulting Group as a whole. Otherwise its mask would keep referencing
    // the original child layer and ignore the other grouped artwork.
    const isExternalClippedLayer = !memberIds.has(node.id)
      && node.clipMaskBaseId !== undefined
      && rootSet.has(node.clipMaskBaseId)
      && getParentId(node, nodeById) === parentId;
    return isExternalClippedLayer ? { ...node, clipMaskBaseId: groupId } : node;
  });
  next.splice(firstIndex, 0, group);
  return next;
}

/** Unwraps one selected hierarchy level.
 * Group containers are removed; ordinary visual parents remain while their
 * direct children are lifted to the parent's level.
 */
export function ungroupLayers(nodes: DesignNode[], selectedIds: readonly string[]): DesignNode[] {
  const selected = new Set(selectedIds.filter((id) => nodes.some((node) => node.id === id)));
  if (selected.size === 0) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = getChildrenMap(nodes);
  const selectedNodes = [...selected].map((id) => nodeById.get(id)!).filter(Boolean);
  const commonParents = new Set(selectedNodes.map((node) => getParentId(node, nodeById)));
  const inferredParent = commonParents.size === 1 ? [...commonParents][0] : null;

  const candidates = new Set<string>();
  for (const id of selected) {
    if ((children.get(id)?.length ?? 0) > 0) candidates.add(id);
  }
  // After drag-into, the moved layers remain selected. Infer their common
  // target parent so Ctrl+Shift+G works without requiring a re-selection.
  if (inferredParent && (children.get(inferredParent)?.length ?? 0) > 0) candidates.add(inferredParent);
  if (candidates.size === 0) return nodes;

  const roots = [...candidates].filter((id) => {
    let parentId = getParentId(nodeById.get(id)!, nodeById);
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (candidates.has(parentId)) return false;
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      parentId = parent ? getParentId(parent, nodeById) : null;
    }
    return true;
  });
  const unwrap = new Set(roots);
  const removedGroups = new Set(roots.filter((id) => nodeById.get(id)?.type === 'group'));
  const parentById = new Map(roots.map((id) => [id, nodeById.get(id)?.parentId ?? undefined]));

  return nodes.filter((node) => !removedGroups.has(node.id)).map((node) => {
    if (!node.parentId || !unwrap.has(node.parentId)) return node;
    const nextParentId = parentById.get(node.parentId);
    if (nextParentId) return { ...node, parentId: nextParentId };
    const { parentId: _parentId, ...promoted } = node;
    return promoted;
  });
}
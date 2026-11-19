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
  nodes.forEach((node) => visit(node, 0));
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

/** Selecting a parent layer also transforms its descendants as one visual hierarchy. */
export function expandSelectedLayers(nodes: readonly DesignNode[], selectedIds: readonly string[]): DesignNode[] {
  const included = new Set(selectedIds);
  selectedIds.forEach((id) => getLayerDescendantIds(nodes, id).forEach((childId) => included.add(childId)));
  return nodes.filter((node) => included.has(node.id));
}

/** Moves a complete layer subtree while keeping the document array in paint order. */
export function moveLayer(
  nodes: readonly DesignNode[],
  nodeId: string,
  targetId: string,
  position: LayerDropPosition,
): DesignNode[] {
  const dragged = nodes.find((node) => node.id === nodeId);
  const target = nodes.find((node) => node.id === targetId);
  if (!dragged || !target || nodeId === targetId) return nodes;

  const movedIds = getLayerDescendantIds(nodes, nodeId);
  movedIds.add(nodeId);
  if (movedIds.has(targetId)) return nodes;

  const movedBlock = nodes.filter((node) => movedIds.has(node.id));
  const remaining = nodes.filter((node) => !movedIds.has(node.id));
  const targetBlock = getLayerDescendantIds(remaining, targetId);
  targetBlock.add(targetId);
  const targetIndexes = remaining
    .map((node, index) => targetBlock.has(node.id) ? index : -1)
    .filter((index) => index >= 0);
  if (targetIndexes.length === 0) return nodes;

  const parentId = position === 'inside' ? targetId : (target.parentId ?? undefined);
  if (parentId && movedIds.has(parentId)) return nodes;
  const movedWithParent = movedBlock.map((node) =>
    node.id === nodeId ? { ...node, parentId } : node,
  );

  // "Before" means above in the panel; the paint order runs in reverse.
  const insertionIndex = position === 'after'
    ? Math.min(...targetIndexes)
    : Math.max(...targetIndexes) + 1;

  return [
    ...remaining.slice(0, insertionIndex),
    ...movedWithParent,
    ...remaining.slice(insertionIndex),
  ];
}

/** Deleting a parent promotes surviving children to the nearest surviving ancestor. */
export function removeLayersAndPromoteChildren(
  nodes: readonly DesignNode[],
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

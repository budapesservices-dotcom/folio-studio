import type {
  BorderSidesConfig,
  ComponentDefinition,
  ComponentSlotAssignment,
  CornerRadiiConfig,
  CssLengthValue,
  DesignNode,
  FillPaint,
  NodeBase,
  NodeInsetOffsets,
  NodeLayoutChildConfig,
  NodeLayoutConfig,
  NodePadding,
  PathNode,
  PseudoStateKey,
  ResponsiveNodeOverride,
  VectorAnchorPoint,
  VectorSubpath,
} from '../core/document/types';
import { expandSelectedLayerIds, getSelectedLayerRootIds } from '../core/document/layers';
import { detachComponentInstance } from '../core/document/components';
import type { EditorTarget } from './editorContext';

export interface StudioClipboardPayload {
  sourceTarget: EditorTarget;
  sourcePageId: string | null;
  sourceComponentId: string | null;
  /** Complete expanded subtree snapshots captured at copy/cut time. */
  nodes: DesignNode[];
  /** Number of consecutive pastes already performed on the same destination. */
  pasteCount: number;
}

export interface CloneNodesOptions {
  offsetX?: number;
  offsetY?: number;
  nameSuffix?: string;
  /** Keep parentId for root nodes whose parent was not part of the cloned selection (true for Ctrl+D, false for cross-doc paste). */
  preserveExternalParent?: boolean;
  /** Optional deterministic ID generator for testing. */
  idFactory?: (index: number, source: DesignNode) => string;
}

export interface CloneNodesResult {
  clonedNodes: DesignNode[];
  rootIds: string[];
  idMap: Map<string, string>;
}

export interface PasteDestination {
  target: EditorTarget;
  pageId: string | null;
  componentId: string | null;
  components: readonly ComponentDefinition[];
}

export interface PastePreparationResult {
  nodes: DesignNode[];
  detachedCircularCount: number;
  nextPasteCount: number;
}

let fallbackCloneCounter = 0;

function defaultCloneId(index: number, source: DesignNode): string {
  fallbackCloneCounter += 1;
  return globalThis.crypto?.randomUUID?.() ?? `copy-${source.type}-${Date.now()}-${index}-${fallbackCloneCounter}`;
}

function cloneAnchorPoint(pt: VectorAnchorPoint): VectorAnchorPoint {
  const next: VectorAnchorPoint = {
    id: pt.id,
    x: pt.x,
    y: pt.y,
    pointType: pt.pointType,
  };
  if (pt.handleIn) next.handleIn = { x: pt.handleIn.x, y: pt.handleIn.y };
  if (pt.handleOut) next.handleOut = { x: pt.handleOut.x, y: pt.handleOut.y };
  return next;
}

function cloneSubpath(subpath: VectorSubpath): VectorSubpath {
  return {
    closed: subpath.closed,
    points: subpath.points.map(cloneAnchorPoint),
  };
}

function cloneCssLength(value: CssLengthValue): CssLengthValue {
  return typeof value === 'object' && value !== null ? { ...value } : value;
}

function clonePadding(padding: NodePadding): NodePadding {
  return { ...padding };
}

function cloneLayout(layout: NodeLayoutConfig): NodeLayoutConfig {
  return {
    ...layout,
    padding: clonePadding(layout.padding),
    ...(layout.gridMinColumnWidth ? { gridMinColumnWidth: cloneCssLength(layout.gridMinColumnWidth) } : {}),
  };
}

function cloneInset(inset: NodeInsetOffsets): NodeInsetOffsets {
  return {
    ...(inset.top ? { top: cloneCssLength(inset.top) } : {}),
    ...(inset.right ? { right: cloneCssLength(inset.right) } : {}),
    ...(inset.bottom ? { bottom: cloneCssLength(inset.bottom) } : {}),
    ...(inset.left ? { left: cloneCssLength(inset.left) } : {}),
  };
}

function cloneLayoutChild(layoutChild: NodeLayoutChildConfig): NodeLayoutChildConfig {
  return {
    ...layoutChild,
    ...(layoutChild.widthValue ? { widthValue: cloneCssLength(layoutChild.widthValue) } : {}),
    ...(layoutChild.heightValue ? { heightValue: cloneCssLength(layoutChild.heightValue) } : {}),
    ...(layoutChild.minWidthValue ? { minWidthValue: cloneCssLength(layoutChild.minWidthValue) } : {}),
    ...(layoutChild.maxWidthValue ? { maxWidthValue: cloneCssLength(layoutChild.maxWidthValue) } : {}),
    ...(layoutChild.minHeightValue ? { minHeightValue: cloneCssLength(layoutChild.minHeightValue) } : {}),
    ...(layoutChild.maxHeightValue ? { maxHeightValue: cloneCssLength(layoutChild.maxHeightValue) } : {}),
    ...(layoutChild.inset ? { inset: cloneInset(layoutChild.inset) } : {}),
    ...(layoutChild.constraints ? { constraints: { ...layoutChild.constraints } } : {}),
  };
}

function cloneResponsive(
  responsive: NonNullable<NodeBase['responsive']>,
): NonNullable<NodeBase['responsive']> {
  const cloned: NonNullable<NodeBase['responsive']> = {};
  for (const [bp, entry] of Object.entries(responsive) as Array<[keyof NonNullable<NodeBase['responsive']>, ResponsiveNodeOverride | undefined]>) {
    if (!entry) continue;
    cloned[bp] = {
      ...entry,
      ...(entry.padding ? { padding: clonePadding(entry.padding) } : {}),
    };
  }
  return cloned;
}

function cloneStateOverrides(
  stateOverrides: NonNullable<NodeBase['stateOverrides']>,
): NonNullable<NodeBase['stateOverrides']> {
  const cloned: NonNullable<NodeBase['stateOverrides']> = {};
  for (const [key, entry] of Object.entries(stateOverrides) as Array<[PseudoStateKey, NonNullable<NodeBase['stateOverrides']>[PseudoStateKey]]>) {
    if (!entry) continue;
    cloned[key] = { ...entry };
  }
  return cloned;
}

function cloneBorderSides(borderSides: BorderSidesConfig): BorderSidesConfig {
  return {
    ...(borderSides.top ? { top: { ...borderSides.top } } : {}),
    ...(borderSides.right ? { right: { ...borderSides.right } } : {}),
    ...(borderSides.bottom ? { bottom: { ...borderSides.bottom } } : {}),
    ...(borderSides.left ? { left: { ...borderSides.left } } : {}),
  };
}

function cloneCornerRadii(cornerRadii: CornerRadiiConfig): CornerRadiiConfig {
  return { ...cornerRadii };
}

function cloneFills(fills: readonly FillPaint[] | undefined): FillPaint[] | undefined {
  return fills
    ? fills.map((fill) =>
        fill.type === 'solid'
          ? { ...fill }
          : { ...fill, stops: fill.stops.map((stop) => ({ ...stop })) },
      )
    : undefined;
}

function cloneNodeBaseExtras(node: NodeBase): Partial<NodeBase> {
  return {
    ...(node.layout ? { layout: cloneLayout(node.layout) } : {}),
    ...(node.layoutChild ? { layoutChild: cloneLayoutChild(node.layoutChild) } : {}),
    ...(node.responsive ? { responsive: cloneResponsive(node.responsive) } : {}),
    ...(node.tokenBindings ? { tokenBindings: { ...node.tokenBindings } } : {}),
    ...(node.effects ? { effects: node.effects.map((effect) => ({ ...effect })) } : {}),
    ...(node.cssFilters ? { cssFilters: { ...node.cssFilters } } : {}),
    ...(node.transition ? { transition: { ...node.transition } } : {}),
    ...(node.stateOverrides ? { stateOverrides: cloneStateOverrides(node.stateOverrides) } : {}),
  };
}

/** Deep-clones a DesignNode so mutations never alias shared nested layout, responsive, style, points, or override objects. */
export function deepCloneNode(node: DesignNode): DesignNode {
  const baseExtras = cloneNodeBaseExtras(node);

  switch (node.type) {
    case 'group':
      return { ...node, ...baseExtras };
    case 'frame':
    case 'rect':
    case 'ellipse':
      return {
        ...node,
        ...baseExtras,
        style: {
          ...node.style,
          ...(node.style.borderSides ? { borderSides: cloneBorderSides(node.style.borderSides) } : {}),
          ...(node.style.cornerRadii ? { cornerRadii: cloneCornerRadii(node.style.cornerRadii) } : {}),
          ...(node.style.fills ? { fills: cloneFills(node.style.fills) } : {}),
        },
      };
    case 'text':
      return {
        ...node,
        ...baseExtras,
        style: { ...node.style },
      };
    case 'image':
      return {
        ...node,
        ...baseExtras,
        style: {
          ...node.style,
          ...(node.style.borderSides ? { borderSides: cloneBorderSides(node.style.borderSides) } : {}),
          ...(node.style.cornerRadii ? { cornerRadii: cloneCornerRadii(node.style.cornerRadii) } : {}),
        },
      };
    case 'path': {
      const cloned: PathNode = {
        ...node,
        ...baseExtras,
        points: node.points.map(cloneAnchorPoint),
        style: {
          ...node.style,
          ...(node.style.fills ? { fills: cloneFills(node.style.fills) } : {}),
        },
      };
      if (node.subpaths) cloned.subpaths = node.subpaths.map(cloneSubpath);
      if (node.shapeMeta) cloned.shapeMeta = { ...node.shapeMeta };
      return cloned;
    }
    case 'component-instance': {
      const overrides: Record<string, { fill?: string; text?: string }> = {};
      for (const [key, value] of Object.entries(node.overrides)) {
        overrides[key] = { ...value };
      }
      const variantSelection = node.variantSelection ? { ...node.variantSelection } : undefined;
      let slotAssignments: Record<string, ComponentSlotAssignment> | undefined;
      if (node.slotAssignments) {
        slotAssignments = {};
        for (const [slotId, assignment] of Object.entries(node.slotAssignments)) {
          slotAssignments[slotId] = { ...assignment };
        }
      }
      return {
        ...node,
        ...baseExtras,
        overrides,
        ...(variantSelection ? { variantSelection } : {}),
        ...(slotAssignments ? { slotAssignments } : {}),
      };
    }
  }
}

/**
 * Clones the selected layers and all of their nested descendants in document order,
 * assigning fresh IDs and safely remapping internal `parentId` and `clipMaskBaseId` links.
 */
export function cloneNodesSubtree(
  allNodes: readonly DesignNode[],
  selectedIds: readonly string[],
  options: CloneNodesOptions = {},
): CloneNodesResult {
  const {
    offsetX = 0,
    offsetY = 0,
    nameSuffix = '',
    preserveExternalParent = true,
    idFactory = defaultCloneId,
  } = options;

  const expandedIds = expandSelectedLayerIds(allNodes, selectedIds);
  if (expandedIds.length === 0) {
    return { clonedNodes: [], rootIds: [], idMap: new Map() };
  }

  const rootIdSet = new Set(getSelectedLayerRootIds(allNodes, selectedIds));
  const expandedSet = new Set(expandedIds);
  const sourceNodes = allNodes.filter((node) => expandedSet.has(node.id));

  const idMap = new Map<string, string>();
  sourceNodes.forEach((node, index) => {
    idMap.set(node.id, idFactory(index, node));
  });

  const clonedNodes = sourceNodes.map((source) => {
    const cloned = deepCloneNode(source);
    const nextId = idMap.get(source.id)!;
    const isRoot = rootIdSet.has(source.id);

    const mappedParentId =
      source.parentId && idMap.has(source.parentId)
        ? idMap.get(source.parentId)!
        : preserveExternalParent
          ? (source.parentId ?? null)
          : null;

    const mappedClipMaskBaseId =
      source.clipMaskBaseId && idMap.has(source.clipMaskBaseId)
        ? idMap.get(source.clipMaskBaseId)!
        : undefined;

    const nextNode: DesignNode = {
      ...cloned,
      id: nextId,
      name: isRoot && nameSuffix ? `${source.name}${nameSuffix}` : source.name,
      x: Math.round((source.x + offsetX) * 100) / 100,
      y: Math.round((source.y + offsetY) * 100) / 100,
      parentId: mappedParentId,
      onCanvas: true,
    };

    if (mappedClipMaskBaseId) {
      nextNode.clipMaskBaseId = mappedClipMaskBaseId;
    } else {
      delete nextNode.clipMaskBaseId;
    }

    return nextNode;
  });

  const rootIds = sourceNodes
    .filter((node) => rootIdSet.has(node.id))
    .map((node) => idMap.get(node.id)!);

  return { clonedNodes, rootIds, idMap };
}

/** Captures an immutable clipboard snapshot of the selected layers and their subtrees. */
export function createClipboardPayload(
  allNodes: readonly DesignNode[],
  selectedIds: readonly string[],
  source: {
    target: EditorTarget;
    pageId: string | null;
    componentId: string | null;
  },
): StudioClipboardPayload | null {
  const expandedIds = expandSelectedLayerIds(allNodes, selectedIds);
  if (expandedIds.length === 0) return null;
  const expandedSet = new Set(expandedIds);
  const snapshotNodes = allNodes
    .filter((node) => expandedSet.has(node.id))
    .map((node) => {
      const cloned = deepCloneNode(node);
      if (cloned.parentId && !expandedSet.has(cloned.parentId)) {
        cloned.parentId = null;
      }
      if (cloned.clipMaskBaseId && !expandedSet.has(cloned.clipMaskBaseId)) {
        delete cloned.clipMaskBaseId;
      }
      return cloned;
    });

  return {
    sourceTarget: source.target,
    sourcePageId: source.pageId,
    sourceComponentId: source.componentId,
    nodes: snapshotNodes,
    pasteCount: 0,
  };
}

/** Checks whether inserting `candidateComponentId` inside `targetComponentId` would create a cycle. */
export function wouldCreateComponentCycle(
  components: readonly ComponentDefinition[],
  candidateComponentId: string,
  targetComponentId: string,
): boolean {
  if (candidateComponentId === targetComponentId) return true;
  const byId = new Map(components.map((component) => [component.id, component]));
  const visited = new Set<string>();
  const stack: string[] = [candidateComponentId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const component = byId.get(currentId);
    if (!component) continue;
    for (const node of component.document.nodes) {
      if (node.type === 'component-instance') {
        if (node.componentId === targetComponentId) return true;
        if (!visited.has(node.componentId)) stack.push(node.componentId);
      }
    }
  }
  return false;
}

/**
 * Materializes fresh pasteable nodes from a clipboard payload for either Main Page
 * or Component Canvas, handling cascade offsets and circular Component Instance protection.
 */
export function prepareNodesForPaste(
  clipboard: StudioClipboardPayload,
  destination: PasteDestination,
  idFactory?: (index: number, source: DesignNode) => string,
): PastePreparationResult {
  if (clipboard.nodes.length === 0) {
    return { nodes: [], detachedCircularCount: 0, nextPasteCount: clipboard.pasteCount };
  }

  const isSameDestination =
    clipboard.sourceTarget === destination.target &&
    clipboard.sourcePageId === destination.pageId &&
    clipboard.sourceComponentId === destination.componentId;

  const stepIndex = isSameDestination ? clipboard.pasteCount + 1 : clipboard.pasteCount;
  const offset = stepIndex * 24;

  const allClipboardIds = clipboard.nodes.map((node) => node.id);
  const { clonedNodes } = cloneNodesSubtree(clipboard.nodes, allClipboardIds, {
    offsetX: offset,
    offsetY: offset,
    nameSuffix: '',
    preserveExternalParent: false,
    idFactory,
  });

  if (destination.target !== 'component' || !destination.componentId) {
    return {
      nodes: clonedNodes,
      detachedCircularCount: 0,
      nextPasteCount: clipboard.pasteCount + 1,
    };
  }

  const componentById = new Map(destination.components.map((component) => [component.id, component]));
  let detachedCircularCount = 0;
  const detachedInstanceIds = new Set<string>();
  const parentByDetachedId = new Map<string, string | null | undefined>();
  const safeNodes: DesignNode[] = [];
  for (const node of clonedNodes) {
    if (
      node.type === 'component-instance' &&
      wouldCreateComponentCycle(destination.components, node.componentId, destination.componentId)
    ) {
      const master = componentById.get(node.componentId);
      if (master) {
        detachedInstanceIds.add(node.id);
        parentByDetachedId.set(node.id, node.parentId);
        const detached = detachComponentInstance(node, master).map((detachedNode) => ({
          ...detachedNode,
          parentId: detachedNode.parentId ?? node.parentId ?? null,
          onCanvas: true,
        }));
        safeNodes.push(...detached);
        detachedCircularCount += 1;
        continue;
      }
    }
    safeNodes.push(node);
  }

  let finalNodes = safeNodes;
  if (detachedInstanceIds.size > 0) {
    const resolveSurvivingParentId = (startParentId: string): string | undefined => {
      let cursor: string | null | undefined = startParentId;
      const visited = new Set<string>();
      while (cursor && detachedInstanceIds.has(cursor)) {
        if (visited.has(cursor)) return undefined;
        visited.add(cursor);
        cursor = parentByDetachedId.get(cursor);
      }
      return cursor ?? undefined;
    };

    finalNodes = safeNodes.map((node) => {
      let nextNode = node;
      if (nextNode.clipMaskBaseId && detachedInstanceIds.has(nextNode.clipMaskBaseId)) {
        const { clipMaskBaseId: _removedClip, ...unmasked } = nextNode;
        nextNode = unmasked as DesignNode;
      }
      if (nextNode.parentId && detachedInstanceIds.has(nextNode.parentId)) {
        const promotedParentId = resolveSurvivingParentId(nextNode.parentId);
        if (promotedParentId) {
          nextNode = { ...nextNode, parentId: promotedParentId };
        } else {
          const { parentId: _removedParent, ...promoted } = nextNode;
          nextNode = promoted as DesignNode;
        }
      }
      return nextNode;
    });
  }

  return {
    nodes: finalNodes,
    detachedCircularCount,
    nextPasteCount: clipboard.pasteCount + 1,
  };
}

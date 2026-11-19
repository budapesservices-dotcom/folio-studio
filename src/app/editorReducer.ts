import type { ComponentDefinition, DesignNode, FolioPage, FolioProject } from '../core/document/types';
import { getActiveDocument, updateActiveDocument } from '../core/document/project';
import { replaceComponentInstancesInDocument } from '../core/document/components';
import { moveLayer, moveLayers, removeLayersAndPromoteChildren, getLayerDescendantIds, groupLayers, ungroupLayers, expandSelectedLayerIds, createClippingMask, removeClippingMask, type LayerDropPosition } from '../core/document/layers';

const HISTORY_LIMIT = 60;

export interface EditorState {
  project: FolioProject;
  past: FolioProject[];
  future: FolioProject[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  historyGroup: string | null;
}

export type EditorAction =
  | { type: 'select-node'; nodeId: string | null }
  | { type: 'select-nodes'; nodeIds: string[] }
  | { type: 'add-node'; node: DesignNode }
  | { type: 'add-nodes'; nodes: DesignNode[] }
  | { type: 'place-layer-instances'; sourceNodeIds: string[]; instanceNodes: DesignNode[] }
  | { type: 'replace-node'; node: DesignNode }
  | { type: 'set-nodes-properties'; nodeIds: string[]; properties: Partial<Pick<DesignNode, 'visible' | 'locked' | 'layerColor'>> }
  | { type: 'rename-nodes'; updates: Array<{ nodeId: string; name: string }> }
  | { type: 'replace-node-with-nodes'; nodeId: string; nodes: DesignNode[] }
  | { type: 'edit-node'; node: DesignNode; coalesceKey: string }
  | { type: 'commit-edit' }
  | { type: 'delete-nodes'; nodeIds: string[] }
  | { type: 'set-nodes-canvas-state'; nodeIds: string[]; onCanvas: boolean }
  | { type: 'transform-nodes'; nodes: DesignNode[] }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'move-layer'; nodeId: string; targetId: string; position: LayerDropPosition }
  | { type: 'move-layers'; nodeIds: string[]; targetId: string; position: LayerDropPosition }
  | { type: 'group-layers'; nodeIds: string[] }
  | { type: 'ungroup-layers'; nodeIds: string[] }
  | { type: 'mask-layer'; nodeId: string }
  | { type: 'unmask-layer'; nodeId: string }
  | { type: 'rename-project'; name: string }
  | { type: 'add-page'; page: FolioPage }
  | { type: 'set-active-page'; pageId: string }
  | { type: 'add-component'; component: ComponentDefinition }
  | { type: 'update-component'; component: ComponentDefinition }
  | { type: 'rename-component'; componentId: string; name: string }
  | { type: 'delete-component'; componentId: string }
  | { type: 'replace-project'; project: FolioProject }
  | { type: 'undo' }
  | { type: 'redo' };

export function createEditorState(project: FolioProject): EditorState {
  return { project, past: [], future: [], selectedNodeId: null, selectedNodeIds: [], historyGroup: null };
}

function withSnapshot(
  state: EditorState,
  nextProject: FolioProject,
  selectedNodeId = state.selectedNodeId,
  selectedNodeIds = state.selectedNodeIds,
): EditorState {
  return {
    project: nextProject,
    past: [...state.past, state.project].slice(-HISTORY_LIMIT),
    future: [],
    selectedNodeId,
    selectedNodeIds,
    historyGroup: null,
  };
}

function touch(project: FolioProject): FolioProject {
  return {
    ...project,
    metadata: { ...project.metadata, updatedAt: new Date().toISOString() },
  };
}

function copyLinkedAppearance(target: DesignNode, source: DesignNode): DesignNode {
  if (target.type !== source.type) return target;
  const common = { name: source.name, opacity: source.opacity, visible: source.visible, locked: source.locked };
  if (target.type === 'rect' && source.type === 'rect') return { ...target, ...common, style: source.style };
  if (target.type === 'ellipse' && source.type === 'ellipse') return { ...target, ...common, style: source.style };
  if (target.type === 'text' && source.type === 'text') return { ...target, ...common, text: source.text, style: source.style };
  if (target.type === 'component-instance' && source.type === 'component-instance') {
    return { ...target, ...common, componentId: source.componentId, overrides: source.overrides };
  }
  return { ...target, ...common };
}

function syncMasterNodeToInstances(nodes: DesignNode[], previousMaster: DesignNode, nextMaster: DesignNode): DesignNode[] {
  const scaleX = nextMaster.width / Math.max(1, previousMaster.width);
  const scaleY = nextMaster.height / Math.max(1, previousMaster.height);
  const dx = nextMaster.x - previousMaster.x;
  const dy = nextMaster.y - previousMaster.y;
  const rotationDelta = nextMaster.rotation - previousMaster.rotation;
  return nodes.map((node) => {
    if (node.isCanvasInstance !== true || node.sourceLayerId !== previousMaster.id) return node;
    const appearance = copyLinkedAppearance(node, nextMaster);
    return {
      ...appearance,
      x: node.x + dx,
      y: node.y + dy,
      width: Math.max(1, node.width * scaleX),
      height: Math.max(1, node.height * scaleY),
      rotation: node.rotation + rotationDelta,
    };
  });
}

function syncChangedMasters(previousNodes: DesignNode[], nextNodes: DesignNode[], sourceIds: Iterable<string>): DesignNode[] {
  let result = nextNodes;
  for (const sourceId of new Set(sourceIds)) {
    const previousMaster = previousNodes.find((node) => node.id === sourceId);
    const nextMaster = result.find((node) => node.id === sourceId);
    if (!previousMaster || !nextMaster || previousMaster.isCanvasInstance === true) continue;
    result = syncMasterNodeToInstances(result, previousMaster, nextMaster);
  }
  return result;
}

function hasLinkedAppearanceChanges(previous: DesignNode, next: DesignNode): boolean {
  if (previous.name !== next.name || previous.opacity !== next.opacity || previous.visible !== next.visible || previous.locked !== next.locked) return true;
  if (previous.type !== next.type) return true;
  if (previous.type === 'rect' && next.type === 'rect') return previous.style !== next.style;
  if (previous.type === 'ellipse' && next.type === 'ellipse') return previous.style !== next.style;
  if (previous.type === 'text' && next.type === 'text') return previous.text !== next.text || previous.style !== next.style;
  if (previous.type === 'component-instance' && next.type === 'component-instance') return previous.componentId !== next.componentId || previous.overrides !== next.overrides;
  return false;
}

function replaceNodeWithLinkedSync(nodes: DesignNode[], previousNode: DesignNode, nextNode: DesignNode): DesignNode[] {
  let result = nodes.map((node) => node.id === nextNode.id ? nextNode : node);
  if (previousNode.isCanvasInstance === true && previousNode.sourceLayerId && hasLinkedAppearanceChanges(previousNode, nextNode)) {
    const sourceId = previousNode.sourceLayerId;
    const source = nodes.find((node) => node.id === sourceId);
    if (source) {
      const updatedSource = copyLinkedAppearance(source, nextNode);
      result = result.map((node) => {
        if (node.id === sourceId) return updatedSource;
        if (node.isCanvasInstance === true && node.sourceLayerId === sourceId) return copyLinkedAppearance(node, updatedSource);
        return node;
      });
    }
    return result;
  }
  if (previousNode.isCanvasInstance !== true) result = syncMasterNodeToInstances(result, previousNode, nextNode);
  return result;
}

function removeNodesAndCanvasInstances(nodes: DesignNode[], requestedIds: Iterable<string>): DesignNode[] {
  const requested = new Set(requestedIds);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sourceIds = new Set([...requested].filter((id) => {
    const node = byId.get(id);
    return node && node.isCanvasInstance !== true;
  }));
  const removeIds = new Set(requested);
  for (const instance of nodes) {
    if (instance.isCanvasInstance !== true || !instance.sourceLayerId || !sourceIds.has(instance.sourceLayerId)) continue;
    removeIds.add(instance.id);
    getLayerDescendantIds(nodes, instance.id).forEach((id) => removeIds.add(id));
  }
  const remaining = removeLayersAndPromoteChildren(nodes, removeIds);
  const remainingIds = new Set(remaining.map((node) => node.id));
  // When a base is deleted, clipped layers return to independent visibility.
  return remaining.map((node) => node.clipMaskBaseId && !remainingIds.has(node.clipMaskBaseId)
    ? { ...node, clipMaskBaseId: undefined }
    : node);
}

function existingSelection(project: FolioProject, ids: string[]): string[] {
  const available = new Set(getActiveDocument(project).nodes.map((node) => node.id));
  return [...new Set(ids)].filter((id) => available.has(id));
}

export function normalizePositiveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const document = getActiveDocument(state.project);

  switch (action.type) {
    case 'select-node': {
      const ids = action.nodeId ? existingSelection(state.project, [action.nodeId]) : [];
      return { ...state, selectedNodeId: ids[0] ?? null, selectedNodeIds: ids };
    }

    case 'select-nodes': {
      const ids = existingSelection(state.project, action.nodeIds);
      return {
        ...state,
        selectedNodeId: ids.length === 1 ? ids[0] : null,
        selectedNodeIds: ids,
      };
    }

    case 'add-node':
      return editorReducer(state, { type: 'add-nodes', nodes: [action.node] });

    case 'add-nodes': {
      if (action.nodes.length === 0) return state;
      const nextDocument = {
        ...document,
        nodes: [...document.nodes, ...action.nodes],
      };
      const next = touch(updateActiveDocument(state.project, nextDocument));
      const ids = action.nodes.map((node) => node.id);
      return withSnapshot(state, next, ids.length === 1 ? ids[0] : null, ids);
    }

    case 'place-layer-instances': {
      const sourceIds = new Set(action.sourceNodeIds);
      const existingIds = new Set(document.nodes.map((node) => node.id));
      const instances = action.instanceNodes.filter((node) =>
        node.isCanvasInstance === true && Boolean(node.sourceLayerId) &&
        sourceIds.has(node.sourceLayerId!) && !existingIds.has(node.id));
      if (instances.length === 0) return state;

      // Layers remain as reusable masters; the Canvas shows only linked instances.
      const sourceNodes = document.nodes.map((node) =>
        sourceIds.has(node.id) && node.isCanvasInstance !== true && node.onCanvas !== false
          ? { ...node, onCanvas: false }
          : node);
      const nextDocument = { ...document, nodes: [...sourceNodes, ...instances] };
      const next = touch(updateActiveDocument(state.project, nextDocument));
      const ids = instances.map((node) => node.id);
      return withSnapshot(state, next, ids.length === 1 ? ids[0] : null, ids);
    }

    case 'replace-node-with-nodes': {
      if (!document.nodes.some((node) => node.id === action.nodeId)) return state;
      const nodes = document.nodes.flatMap((node) => node.id === action.nodeId ? action.nodes : [node]);
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const ids = action.nodes.map((node) => node.id);
      return withSnapshot(state, next, ids.length === 1 ? ids[0] : null, ids);
    }

    case 'edit-node': {
      const previous = document.nodes.find((node) => node.id === action.node.id);
      if (!previous) return state;
      const nodes = replaceNodeWithLinkedSync(document.nodes, previous, action.node);
      const nextProject = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const past = state.historyGroup === action.coalesceKey
        ? state.past
        : [...state.past, state.project].slice(-HISTORY_LIMIT);
      return {
        ...state,
        project: nextProject,
        past,
        future: [],
        historyGroup: action.coalesceKey,
      };
    }

    case 'commit-edit':
      return state.historyGroup ? { ...state, historyGroup: null } : state;

    case 'set-nodes-properties': {
      const ids = new Set(action.nodeIds);
      if (ids.size === 0) return state;
      let nodes = document.nodes.map((node) => {
        if (!ids.has(node.id)) return node;
        const next = { ...node, ...action.properties };
        return next.visible === node.visible
          && next.locked === node.locked
          && next.layerColor === node.layerColor
          ? node
          : next;
      });
      if (nodes.every((node, index) => node === document.nodes[index])) return state;
      const changedSources = nodes.filter((node) => ids.has(node.id) && node.isCanvasInstance !== true).map((node) => node.id);
      nodes = syncChangedMasters(document.nodes, nodes, changedSources);
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'rename-nodes': {
      const updates = new Map(action.updates.map((item) => [item.nodeId, item.name]));
      if (updates.size === 0) return state;
      let changed = false;
      const nodes = document.nodes.map((node) => {
        const name = updates.get(node.id);
        if (name === undefined || name === node.name) return node;
        changed = true;
        return { ...node, name };
      });
      if (!changed) return state;
      const synced = syncChangedMasters(document.nodes, nodes, updates.keys());
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes: synced })));
    }

    case 'replace-node': {
      const previous = document.nodes.find((node) => node.id === action.node.id);
      if (!previous) return state;
      const nodes = replaceNodeWithLinkedSync(document.nodes, previous, action.node);
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'transform-nodes': {
      const updates = new Map(action.nodes.map((node) => [node.id, node] as const));
      let changed = false;
      const nodes = document.nodes.map((node) => {
        const replacement = updates.get(node.id);
        if (!replacement) return node;
        if (
          replacement.x === node.x &&
          replacement.y === node.y &&
          replacement.width === node.width &&
          replacement.height === node.height &&
          replacement.onCanvas === node.onCanvas &&
          (node.type !== 'text' || replacement.type !== 'text' || replacement.style.fontSize === node.style.fontSize)
        ) return node;
        changed = true;
        return replacement;
      });
      if (!changed) return state;
      const changedSources = action.nodes.filter((node) => node.isCanvasInstance !== true).map((node) => node.id);
      const synced = syncChangedMasters(document.nodes, nodes, changedSources);
      return withSnapshot(
        state,
        touch(updateActiveDocument(state.project, { ...document, nodes: synced })),
      );
    }

    case 'move-layer': {
      const nodes = moveLayer(document.nodes, action.nodeId, action.targetId, action.position);
      if (nodes === document.nodes) return state;
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'move-layers': {
      const nodes = moveLayers(document.nodes, action.nodeIds, action.targetId, action.position);
      if (nodes === document.nodes) return state;
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'group-layers': {
      const nodes = groupLayers(document.nodes, action.nodeIds);
      if (nodes === document.nodes) return state;
      const group = nodes.find((node) => node.type === 'group' && !document.nodes.some((old) => old.id === node.id));
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const selectedIds = group ? expandSelectedLayerIds(nodes, [group.id]) : [];
      return withSnapshot(state, next, group?.id ?? null, selectedIds);
    }

    case 'ungroup-layers': {
      const nodes = ungroupLayers(document.nodes, action.nodeIds);
      if (nodes === document.nodes) return state;
      const nextById = new Map(nodes.map((node) => [node.id, node]));
      const promotedIds = document.nodes
        .filter((node) => {
          const nextNode = nextById.get(node.id);
          return nextNode && nextNode.parentId !== node.parentId;
        })
        .map((node) => node.id);
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      return withSnapshot(state, next, promotedIds.length === 1 ? promotedIds[0] : null, promotedIds);
    }

    case 'mask-layer': {
      const nodes = createClippingMask(document.nodes, action.nodeId);
      if (nodes === document.nodes) return state;
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'unmask-layer': {
      const nodes = removeClippingMask(document.nodes, action.nodeId);
      if (nodes === document.nodes) return state;
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'set-nodes-canvas-state': {
      const ids = new Set(action.nodeIds);
      if (ids.size === 0) return state;
      let changed = false;
      const nodes = document.nodes.map((node) => {
        if (!ids.has(node.id) || (node.onCanvas !== false) === action.onCanvas) return node;
        changed = true;
        return { ...node, onCanvas: action.onCanvas };
      });
      if (!changed) return state;
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'delete-nodes': {
      const ids = new Set(action.nodeIds);
      const nodes = removeNodesAndCanvasInstances(document.nodes, ids);
      if (nodes.length === document.nodes.length) return state;
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const remainingIds = new Set(nodes.map((node) => node.id));
      const selected = state.selectedNodeIds.filter((id) => remainingIds.has(id));
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'delete-node': {
      const nodes = removeNodesAndCanvasInstances(document.nodes, [action.nodeId]);
      if (nodes.length === document.nodes.length) return state;
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const remainingIds = new Set(nodes.map((node) => node.id));
      const selected = state.selectedNodeIds.filter((id) => remainingIds.has(id));
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'rename-project': {
      const name = action.name.trim() || 'Untitled project';
      if (name === state.project.metadata.name) return state;
      const next = touch({
        ...state.project,
        metadata: { ...state.project.metadata, name },
      });
      return withSnapshot(state, next);
    }

    case 'add-page': {
      if (state.project.pages.some((page) => page.id === action.page.id || page.route === action.page.route)) return state;
      const next = touch({
        ...state.project,
        activePageId: action.page.id,
        pages: [...state.project.pages, action.page],
      });
      return {
        project: next,
        past: [],
        future: [],
        selectedNodeId: null,
        selectedNodeIds: [],
        historyGroup: null,
      };
    }

    case 'set-active-page': {
      if (!state.project.pages.some((page) => page.id === action.pageId)) return state;
      if (state.project.activePageId === action.pageId) return state;
      return {
        ...state,
        project: touch({ ...state.project, activePageId: action.pageId }),
        past: [],
        future: [],
        selectedNodeId: null,
        selectedNodeIds: [],
        historyGroup: null,
      };
    }

    case 'add-component': {
      if (state.project.components.some((component) => component.id === action.component.id)) return state;
      return withSnapshot(state, touch({
        ...state.project,
        components: [...state.project.components, action.component],
      }));
    }

    case 'update-component': {
      if (!state.project.components.some((component) => component.id === action.component.id)) return state;
      const components = state.project.components.map((component) =>
        component.id === action.component.id ? action.component : component);
      return withSnapshot(state, touch({ ...state.project, components }));
    }

    case 'rename-component': {
      const name = action.name.trim();
      const target = state.project.components.find((component) => component.id === action.componentId);
      if (!target || !name || target.name === name) return state;
      const now = new Date().toISOString();
      const components = state.project.components.map((component) =>
        component.id === action.componentId ? { ...component, name, updatedAt: now, document: { ...component.document, name } } : component);
      return withSnapshot(state, touch({ ...state.project, components }));
    }

    case 'delete-component': {
      const target = state.project.components.find((component) => component.id === action.componentId);
      if (!target) return state;
      // Detach all page instances so deleting a master never leaves broken references.
      const pages = state.project.pages.map((page) => ({
        ...page, document: replaceComponentInstancesInDocument(page.document, target),
      }));
      const components = state.project.components.filter((component) => component.id !== action.componentId);
      const next = touch({ ...state.project, pages, components });
      const selected = existingSelection(next, state.selectedNodeIds);
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'replace-project':
      return createEditorState(touch(action.project));

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const selected = existingSelection(previous, state.selectedNodeIds);
      return {
        project: touch(previous),
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        selectedNodeId: selected.length === 1 ? selected[0] : null,
        selectedNodeIds: selected,
        historyGroup: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const selected = existingSelection(next, state.selectedNodeIds);
      return {
        project: touch(next),
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedNodeId: selected.length === 1 ? selected[0] : null,
        selectedNodeIds: selected,
        historyGroup: null,
      };
    }

    default:
      return state;
  }
}

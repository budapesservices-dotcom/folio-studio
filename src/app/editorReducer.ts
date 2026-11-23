import type {
  AnimationClip,
  CodeModuleRecord,
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  FolioPage,
  FolioProject,
  LogicGraph,
  NodeTokenBindings,
} from '../core/document/types';
import { pruneLogicGraphsForDeletedComponent } from '../engines/prototype/validator';
import { getActiveDocument, updateActiveDocument } from '../core/document/project';
import { areDocumentsStructurallyEqual } from '../core/document/equality';
import { classifyNodeChange } from '../core/document/nodeChanges';
import {
  pruneComponentContractForDocument,
  pruneComponentInstanceContractsInDocument,
  replaceComponentInstancesInDocument,
} from '../core/document/components';
import { moveLayer, moveLayers, removeLayersAndPromoteChildren, groupLayers, ungroupLayers, expandSelectedLayerIds, createClippingMask, removeClippingMask, collapseLegacyCanvasInstances, type LayerDropPosition } from '../core/document/layers';
import { cleanupDeletedNodeReferences } from '../core/document/nodeReferenceCleanup';

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
  | { type: 'replace-node'; node: DesignNode }
  | { type: 'set-nodes-properties'; nodeIds: string[]; properties: Partial<Pick<DesignNode, 'visible' | 'locked' | 'layerColor'>> }
  | { type: 'rename-nodes'; updates: Array<{ nodeId: string; name: string }> }
  | { type: 'replace-node-with-nodes'; nodeId: string; nodes: DesignNode[] }
  | { type: 'replace-nodes'; removeIds: string[]; insertNodes: DesignNode[]; selectIds?: string[] }
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
  | { type: 'sync-component-document'; componentId: string; expectedMasterDocument: FolioDocument; expectedUpdatedAt: string; document: FolioDocument; updatedAt: string }
  | { type: 'rename-component'; componentId: string; expectedMasterDocument: FolioDocument; expectedUpdatedAt: string; name: string }
  | { type: 'delete-component'; componentId: string; expectedMasterDocument: FolioDocument; expectedUpdatedAt: string }
  | { type: 'update-component-contract'; componentId: string; expectedMasterDocument: FolioDocument; expectedUpdatedAt: string; variants?: ComponentVariantAxis[]; slots?: ComponentSlotDefinition[] }
  | { type: 'update-design-tokens'; designTokens: DesignTokenCollection; unbindTokenIds?: string[] }
  | { type: 'update-code-modules'; codeModules: CodeModuleRecord[] }
  | { type: 'create-logic-graph'; graph: LogicGraph }
  | { type: 'update-logic-graph'; graph: LogicGraph }
  | { type: 'delete-logic-graph'; graphId: string }
  | { type: 'create-animation-clip'; clip: AnimationClip }
  | { type: 'update-animation-clip'; clip: AnimationClip }
  | { type: 'delete-animation-clip'; clipId: string }
  | { type: 'replace-project'; project: FolioProject }
  | { type: 'undo' }
  | { type: 'redo' };

export function createEditorState(project: FolioProject): EditorState {
  return { project: normalizeProjectLayerDocuments(project), past: [], future: [], selectedNodeId: null, selectedNodeIds: [], historyGroup: null };
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

function normalizeProjectLayerDocuments(project: FolioProject): FolioProject {
  return {
    ...project,
    pages: project.pages.map((page) => ({
      ...page,
      document: { ...page.document, nodes: collapseLegacyCanvasInstances(page.document.nodes) },
    })),
    components: project.components.map((component) => ({
      ...component,
      document: { ...component.document, nodes: collapseLegacyCanvasInstances(component.document.nodes) },
    })),
  };
}

function removeNodesFromLayers(nodes: DesignNode[], requestedIds: Iterable<string>): DesignNode[] {
  const remaining = removeLayersAndPromoteChildren(nodes, requestedIds);
  const remainingIds = new Set(remaining.map((node) => node.id));
  return remaining.map((node) => node.clipMaskBaseId && !remainingIds.has(node.clipMaskBaseId)
    ? { ...node, clipMaskBaseId: undefined }
    : node);
}

function unbindTokenIdsFromNodes(nodes: DesignNode[], removeSet: ReadonlySet<string>): DesignNode[] {
  if (removeSet.size === 0) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    if (!node.tokenBindings) return node;
    let nodeChanged = false;
    const cleaned: NodeTokenBindings = {};
    for (const [key, tokenId] of Object.entries(node.tokenBindings) as Array<[keyof NodeTokenBindings, string | undefined]>) {
      if (!tokenId) continue;
      if (removeSet.has(tokenId)) {
        nodeChanged = true;
      } else {
        cleaned[key] = tokenId;
      }
    }
    if (!nodeChanged) return node;
    changed = true;
    const nextNode = { ...node };
    if (Object.keys(cleaned).length > 0) {
      nextNode.tokenBindings = cleaned;
    } else {
      delete nextNode.tokenBindings;
    }
    return nextNode;
  });
  return changed ? next : nodes;
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
      const nextSelectedNodeId = ids.length === 1 ? ids[0] : null;
      if (
        nextSelectedNodeId === state.selectedNodeId &&
        ids.length === state.selectedNodeIds.length &&
        ids.every((id, index) => id === state.selectedNodeIds[index])
      ) {
        return state;
      }
      return {
        ...state,
        selectedNodeId: nextSelectedNodeId,
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

    case 'replace-node-with-nodes': {
      if (!document.nodes.some((node) => node.id === action.nodeId)) return state;
      const nodes = document.nodes.flatMap((node) => node.id === action.nodeId ? action.nodes : [node]);
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const ids = action.nodes.map((node) => node.id);
      return withSnapshot(state, next, ids.length === 1 ? ids[0] : null, ids);
    }

    case 'replace-nodes': {
      const removeSet = new Set(action.removeIds);
      if (removeSet.size === 0 && action.insertNodes.length === 0) return state;
      let insertIndex = -1;
      document.nodes.forEach((node, idx) => {
        if (removeSet.has(node.id)) insertIndex = idx;
      });
      if (removeSet.size > 0 && insertIndex === -1 && action.insertNodes.length === 0) return state;

      // Remove targeted nodes (preserving children & cleaning broken clip masks),
      // then insert replacement nodes at the exact z-index slot in ONE atomic undo step!
      const survivingBeforeSlot: DesignNode[] = [];
      const survivingAfterSlot: DesignNode[] = [];
      const cleaned = removeNodesFromLayers(document.nodes, removeSet);
      const originalIndexById = new Map(document.nodes.map((n, idx) => [n.id, idx]));
      for (const node of cleaned) {
        const origIdx = originalIndexById.get(node.id) ?? 0;
        if (insertIndex === -1 || origIdx <= insertIndex) survivingBeforeSlot.push(node);
        else survivingAfterSlot.push(node);
      }
      const nodes = [...survivingBeforeSlot, ...action.insertNodes, ...survivingAfterSlot];
      const next = touch(updateActiveDocument(state.project, { ...document, nodes }));
      const ids = existingSelection(
        next,
        action.selectIds ?? action.insertNodes.map((node) => node.id),
      );
      return withSnapshot(state, next, ids.length === 1 ? ids[0] : null, ids);
    }

    case 'edit-node': {
      const exists = document.nodes.some((node) => node.id === action.node.id);
      if (!exists) return state;
      const nextDocument = {
        ...document,
        nodes: document.nodes.map((node) => (node.id === action.node.id ? action.node : node)),
      };
      const nextProject = touch(updateActiveDocument(state.project, nextDocument));
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
      const nodes = document.nodes.map((node) => {
        if (!ids.has(node.id)) return node;
        const next = { ...node, ...action.properties };
        return next.visible === node.visible
          && next.locked === node.locked
          && next.layerColor === node.layerColor
          ? node
          : next;
      });
      if (nodes.every((node, index) => node === document.nodes[index])) return state;
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
      return withSnapshot(state, touch(updateActiveDocument(state.project, { ...document, nodes })));
    }

    case 'replace-node': {
      const existing = document.nodes.find((node) => node.id === action.node.id);
      if (!existing || !classifyNodeChange(existing, action.node).hasAnyChange) return state;
      const nextDocument = {
        ...document,
        nodes: document.nodes.map((node) => (node.id === action.node.id ? action.node : node)),
      };
      return withSnapshot(state, touch(updateActiveDocument(state.project, nextDocument)));
    }

    case 'transform-nodes': {
      const updates = new Map(action.nodes.map((node) => [node.id, node] as const));
      let changed = false;
      const nodes = document.nodes.map((node) => {
        const replacement = updates.get(node.id);
        if (!replacement) return node;
        if (!classifyNodeChange(node, replacement).hasAnyChange) return node;
        changed = true;
        return replacement;
      });
      if (!changed) return state;
      return withSnapshot(
        state,
        touch(updateActiveDocument(state.project, { ...document, nodes })),
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
      return withSnapshot(state, next, selectedIds.length === 1 ? selectedIds[0] : null, selectedIds);
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
      const nodes = removeNodesFromLayers(document.nodes, ids);
      if (nodes.length === document.nodes.length) return state;
      const remainingIds = new Set(nodes.map((node) => node.id));
      const actuallyRemovedIds = new Set(
        document.nodes.filter((node) => !remainingIds.has(node.id)).map((node) => node.id),
      );
      const cleanedProject = cleanupDeletedNodeReferences(
        updateActiveDocument(state.project, { ...document, nodes }),
        actuallyRemovedIds,
        state.project.activePageId,
      ).project;
      const next = touch(cleanedProject);
      const selected = state.selectedNodeIds.filter((id) => remainingIds.has(id));
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'delete-node': {
      const nodes = removeNodesFromLayers(document.nodes, [action.nodeId]);
      if (nodes.length === document.nodes.length) return state;
      const remainingIds = new Set(nodes.map((node) => node.id));
      const actuallyRemovedIds = new Set(
        document.nodes.filter((node) => !remainingIds.has(node.id)).map((node) => node.id),
      );
      const cleanedProject = cleanupDeletedNodeReferences(
        updateActiveDocument(state.project, { ...document, nodes }),
        actuallyRemovedIds,
        state.project.activePageId,
      ).project;
      const next = touch(cleanedProject);
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

    case 'sync-component-document': {
      const currentComponent = state.project.components.find((component) => component.id === action.componentId);
      if (!currentComponent || currentComponent.document !== action.expectedMasterDocument ||
          currentComponent.updatedAt !== action.expectedUpdatedAt ||
          areDocumentsStructurallyEqual(currentComponent.document, action.document)) return state;
      const prunedComponent: ComponentDefinition = {
        ...pruneComponentContractForDocument(currentComponent, action.document),
        document: action.document,
        updatedAt: action.updatedAt,
      };
      const components = state.project.components.map((component) =>
        component.id === action.componentId ? prunedComponent : component);
      const pages = state.project.pages.map((page) => {
        const document = pruneComponentInstanceContractsInDocument(page.document, prunedComponent);
        return document === page.document ? page : { ...page, document };
      });
      return withSnapshot(state, touch({ ...state.project, pages, components }));
    }

    case 'rename-component': {
      const name = action.name.trim();
      const target = state.project.components.find((component) => component.id === action.componentId);
      if (!target || target.document !== action.expectedMasterDocument ||
          target.updatedAt !== action.expectedUpdatedAt || !name || target.name === name) return state;
      const now = new Date().toISOString();
      const components = state.project.components.map((component) =>
        component.id === action.componentId ? { ...component, name, updatedAt: now, document: { ...component.document, name } } : component);
      return withSnapshot(state, touch({ ...state.project, components }));
    }

    case 'delete-component': {
      const target = state.project.components.find((component) => component.id === action.componentId);
      if (!target || target.document !== action.expectedMasterDocument ||
          target.updatedAt !== action.expectedUpdatedAt) return state;
      // Detach all page instances so deleting a master never leaves broken references.
      const pages = state.project.pages.map((page) => ({
        ...page, document: replaceComponentInstancesInDocument(page.document, target, state.project.designTokens),
      }));
      const components = state.project.components.filter((component) => component.id !== action.componentId);
      const logicGraphs = pruneLogicGraphsForDeletedComponent(state.project.logicGraphs, action.componentId);
      const next = touch({ ...state.project, pages, components, logicGraphs });
      const selected = existingSelection(next, state.selectedNodeIds);
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'update-component-contract': {
      const target = state.project.components.find((component) => component.id === action.componentId);
      if (!target || target.document !== action.expectedMasterDocument ||
          target.updatedAt !== action.expectedUpdatedAt) return state;
      const nextVariants = action.variants !== undefined ? action.variants : target.variants;
      const nextSlots = action.slots !== undefined ? action.slots : target.slots;
      if (
        JSON.stringify(target.variants ?? []) === JSON.stringify(nextVariants ?? []) &&
        JSON.stringify(target.slots ?? []) === JSON.stringify(nextSlots ?? [])
      ) {
        return state;
      }
      const now = new Date().toISOString();
      const updatedComponent: ComponentDefinition = { ...target, updatedAt: now };
      if (nextVariants && nextVariants.length > 0) updatedComponent.variants = nextVariants;
      else delete updatedComponent.variants;
      if (nextSlots && nextSlots.length > 0) updatedComponent.slots = nextSlots;
      else delete updatedComponent.slots;

      const components = state.project.components.map((component) =>
        component.id === action.componentId ? updatedComponent : component);
      const pages = state.project.pages.map((page) => {
        const document = pruneComponentInstanceContractsInDocument(page.document, updatedComponent);
        return document === page.document ? page : { ...page, document };
      });
      return withSnapshot(state, touch({ ...state.project, pages, components }));
    }

    case 'update-design-tokens': {
      const nextTokenIds = new Set(action.designTokens.tokens.map((token) => token.id));
      const removeSet = new Set(action.unbindTokenIds ?? []);
      for (const prevToken of state.project.designTokens?.tokens ?? []) {
        if (!nextTokenIds.has(prevToken.id)) {
          removeSet.add(prevToken.id);
        }
      }
      const tokensChanged = JSON.stringify(state.project.designTokens ?? null) !== JSON.stringify(action.designTokens);
      const pages = removeSet.size === 0
        ? state.project.pages
        : state.project.pages.map((page) => {
            const nodes = unbindTokenIdsFromNodes(page.document.nodes, removeSet);
            return nodes === page.document.nodes ? page : { ...page, document: { ...page.document, nodes } };
          });
      const components = removeSet.size === 0
        ? state.project.components
        : state.project.components.map((component) => {
            const nodes = unbindTokenIdsFromNodes(component.document.nodes, removeSet);
            return nodes === component.document.nodes ? component : { ...component, document: { ...component.document, nodes } };
          });
      const bindingsChanged = pages !== state.project.pages || components !== state.project.components;
      if (!tokensChanged && !bindingsChanged) return state;
      return withSnapshot(
        state,
        touch({
          ...state.project,
          pages,
          components,
          designTokens: action.designTokens,
        }),
      );
    }

    case 'update-code-modules': {
      const currentModules = state.project.codeModules ?? [];
      if (JSON.stringify(currentModules) === JSON.stringify(action.codeModules)) {
        return state;
      }
      const nextProject: FolioProject = { ...state.project };
      if (action.codeModules.length > 0) {
        nextProject.codeModules = action.codeModules;
      } else {
        delete nextProject.codeModules;
      }
      return withSnapshot(state, touch(nextProject));
    }

    case 'create-logic-graph': {
      if (state.project.logicGraphs.some((graph) => graph.id === action.graph.id)) {
        return state;
      }
      return withSnapshot(
        state,
        touch({
          ...state.project,
          logicGraphs: [...state.project.logicGraphs, action.graph],
        }),
      );
    }

    case 'update-logic-graph': {
      const existing = state.project.logicGraphs.find((graph) => graph.id === action.graph.id);
      if (!existing) return state;
      if (JSON.stringify(existing) === JSON.stringify(action.graph)) {
        return state;
      }
      return withSnapshot(
        state,
        touch({
          ...state.project,
          logicGraphs: state.project.logicGraphs.map((graph) =>
            graph.id === action.graph.id ? action.graph : graph,
          ),
        }),
      );
    }

    case 'delete-logic-graph': {
      if (!state.project.logicGraphs.some((graph) => graph.id === action.graphId)) {
        return state;
      }
      return withSnapshot(
        state,
        touch({
          ...state.project,
          logicGraphs: state.project.logicGraphs.filter((graph) => graph.id !== action.graphId),
        }),
      );
    }

    case 'create-animation-clip': {
      const currentClips = state.project.animations ?? [];
      if (currentClips.some((clip) => clip.id === action.clip.id)) {
        return state;
      }
      return withSnapshot(
        state,
        touch({
          ...state.project,
          animations: [...currentClips, action.clip],
        }),
      );
    }

    case 'update-animation-clip': {
      const currentClips = state.project.animations ?? [];
      const existing = currentClips.find((clip) => clip.id === action.clip.id);
      if (!existing) return state;
      if (JSON.stringify(existing) === JSON.stringify(action.clip)) {
        return state;
      }
      return withSnapshot(
        state,
        touch({
          ...state.project,
          animations: currentClips.map((clip) => (clip.id === action.clip.id ? action.clip : clip)),
        }),
      );
    }

    case 'delete-animation-clip': {
      const currentClips = state.project.animations ?? [];
      if (!currentClips.some((clip) => clip.id === action.clipId)) {
        return state;
      }
      const remaining = currentClips.filter((clip) => clip.id !== action.clipId);
      const nextProject: FolioProject = { ...state.project };
      if (remaining.length > 0) {
        nextProject.animations = remaining;
      } else {
        delete nextProject.animations;
      }
      return withSnapshot(state, touch(nextProject));
    }

    case 'replace-project':
      return createEditorState(action.project);

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

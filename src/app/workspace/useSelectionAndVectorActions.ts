import type { ComponentInstanceNode, DesignNode } from '../../core/document/types';
import { expandSelectedLayerIds, getEffectiveLayerStates } from '../../core/document/layers';
import { detachComponentInstance } from '../../core/document/components';
import { getActiveDocument } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import {
  convertShapeToPathNode,
  flipPathNode,
  normalizePathNode,
  scalePathNodeGeometry,
  simplifyPathNode,
  type PathfinderOperation,
} from '../../core/document/vector';
import { getComputeKernels } from '../../core/kernels';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../../engines/canvas/geometry';
import type { CanvasToolId, CanvasToolOptions } from '../../engines/canvas/tools/types';
import { getActiveEditorContext, getTransformableNodes, type EditorTarget } from '../editorContext';
import type { EditorState } from '../editorReducer';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  cloneNodesSubtree,
  createClipboardPayload,
  prepareNodesForPaste,
  type StudioClipboardPayload,
} from '../nodeClipboard';

function clampPositiveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface UseSelectionAndVectorActionsOptions {
  activeEditorId: EditorTarget;
  isHydrating: boolean;
  state: EditorState;
  componentState: EditorState;
  selectedNode: DesignNode | null;
  selectedNodes: DesignNode[];
  editingComponentId: string | null;
  toolOptions: CanvasToolOptions;
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  clipboardRef: { current: StudioClipboardPayload | null };
  setWorkspaceToolId: (target: EditorTarget, toolId: CanvasToolId) => void;
  setInspectorVisible: (visible: boolean) => void;
  setNotice: (message: string) => void;
}

export function useSelectionAndVectorActions({
  activeEditorId,
  isHydrating,
  state,
  componentState,
  selectedNode,
  selectedNodes,
  editingComponentId,
  toolOptions,
  focusedCommandClient,
  getCommandClient,
  selectionSourceRef,
  clipboardRef,
  setWorkspaceToolId,
  setInspectorVisible,
  setNotice,
}: UseSelectionAndVectorActionsOptions) {
  const updateSelected = (patch: Partial<DesignNode>) => {
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const singleRootContainer =
      !selectedNode && selectedNodes.length > 1
        ? (() => {
            const roots = selectedNodes.filter((n) => !n.parentId || !selectedIds.has(n.parentId));
            return roots.length === 1 && (roots[0].type === 'frame' || roots[0].type === 'group')
              ? roots[0]
              : null;
          })()
        : null;
    const targetNode = selectedNode ?? singleRootContainer;
    if (!targetNode) return;
    const safePatch = { ...patch };
    if ('width' in patch) safePatch.width = clampPositiveDimension(Number(patch.width), targetNode.width);
    if ('height' in patch) safePatch.height = clampPositiveDimension(Number(patch.height), targetNode.height);
    if ('opacity' in patch) {
      const rawOpacity = Number(patch.opacity);
      safePatch.opacity = Number.isFinite(rawOpacity) ? Math.min(1, Math.max(0, rawOpacity)) : targetNode.opacity;
    }

    let nextNode: DesignNode;
    if (targetNode.type === 'path' && ('width' in safePatch || 'height' in safePatch)) {
      const nextX = 'x' in safePatch && typeof safePatch.x === 'number' ? safePatch.x : targetNode.x;
      const nextY = 'y' in safePatch && typeof safePatch.y === 'number' ? safePatch.y : targetNode.y;
      const nextW = typeof safePatch.width === 'number' ? safePatch.width : targetNode.width;
      const nextH = typeof safePatch.height === 'number' ? safePatch.height : targetNode.height;
      const scaled = scalePathNodeGeometry(targetNode, nextX, nextY, nextW, nextH);
      nextNode = { ...scaled, ...safePatch, points: scaled.points, subpaths: scaled.subpaths } as DesignNode;
    } else {
      nextNode = { ...targetNode, ...safePatch } as DesignNode;
    }
    focusedCommandClient.editNode(nextNode, 'inspector:' + targetNode.id, 'Edit layer properties');
  };

  const updateSelectedStyle = (patch: Record<string, string | number>) => {
    if (!selectedNode || selectedNode.type === 'component-instance' || selectedNode.type === 'group') return;
    focusedCommandClient.editNode(
      { ...selectedNode, style: { ...selectedNode.style, ...patch } } as DesignNode,
      'inspector:' + selectedNode.id,
      'Edit layer style',
    );
  };

  const updateInstanceOverride = (childNodeId: string, patch: { fill?: string; text?: string }) => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    const instance = selectedNode as ComponentInstanceNode;
    const overrides = {
      ...instance.overrides,
      [childNodeId]: { ...instance.overrides[childNodeId], ...patch },
    };
    focusedCommandClient.editNode(
      { ...instance, overrides },
      'instance-override:' + instance.id,
      'Update component instance override',
    );
  };

  const resetInstanceOverrides = () => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    focusedCommandClient.editNode(
      { ...selectedNode, overrides: {} },
      'instance-override:' + selectedNode.id,
      'Reset component instance overrides',
    );
  };

  const detachSelectedInstance = () => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    const master = state.project.components.find((component) => component.id === selectedNode.componentId);
    if (!master) {
      setNotice('The linked master component could not be found.');
      return;
    }
    const detached = detachComponentInstance(selectedNode, master, getProjectDesignTokens(state.project));
    focusedCommandClient.replaceNodeWithNodes(selectedNode.id, detached, 'Detach component instance');
    setNotice('Instance detached. Its nodes can now be edited independently.');
  };

  const alignSelection = (alignment: Alignment, target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const layerStates = getEffectiveLayerStates(doc.nodes);
    const selected = getTransformableNodes(
      doc.nodes
        .filter((node) => editor.selectedNodeIds.includes(node.id))
        .filter((node) => {
          const effective = layerStates.get(node.id);
          return effective?.visible && !effective.locked;
        }),
    );
    if (selected.length < 2) return;
    getCommandClient(target).transformNodes(alignNodes(selected, alignment), `Align layers ${alignment}`);
  };

  const distributeSelection = (axis: DistributionAxis, target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const selected = getTransformableNodes(
      getActiveDocument(editor.project).nodes.filter((node) => editor.selectedNodeIds.includes(node.id)),
    );
    if (selected.length < 3) return;
    getCommandClient(target).transformNodes(distributeNodes(selected, axis), `Distribute layers ${axis}`);
  };

  const handlePathfinder = (target: EditorTarget, operation: PathfinderOperation) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const candidates = doc.nodes.filter(
      (node) =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path'),
    );
    if (candidates.length < 2) {
      setNotice('Select at least 2 shapes or vector paths for Pathfinder.');
      return;
    }
    const newId = globalThis.crypto?.randomUUID?.() ?? `pathfinder-${Date.now()}`;
    const result = getComputeKernels().vector.applyPathfinder(candidates, operation, newId);
    if (!result) {
      setNotice(`Pathfinder ${operation} produced an empty region. Make sure shapes overlap.`);
      return;
    }
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).replaceNodes(candidates.map((node) => node.id), [result], 'Replace vector nodes');
    setNotice(`Pathfinder ${operation} created “${result.name}”.`);
  };

  const handleConvertToPath = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const convertible = doc.nodes.filter(
      (node): node is Extract<DesignNode, { type: 'rect' | 'ellipse' | 'frame' }> =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame'),
    );
    if (convertible.length === 0) return;
    const convertedPaths = convertible
      .map((node) => convertShapeToPathNode(node))
      .filter((pathNode): pathNode is NonNullable<typeof pathNode> => pathNode !== null);
    if (convertedPaths.length === 0) return;
    const removeIds = convertedPaths.map((node) => node.id);
    const convertResult = getCommandClient(target).replaceNodes(
      removeIds,
      convertedPaths,
      convertedPaths.length === 1 ? 'Convert shape to vector path' : 'Convert shapes to vector paths',
      removeIds,
    );
    if (convertResult.status !== 'applied') return;
    setWorkspaceToolId(target, 'direct-selection');
    setNotice(`Converted ${convertedPaths.length} shape${convertedPaths.length === 1 ? '' : 's'} to editable cubic Bezier paths (Direct Selection A).`);
  };

  const handleFlipSelection = (target: EditorTarget, axis: 'horizontal' | 'vertical') => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const selected = getTransformableNodes(doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id)));
    if (selected.length === 0) return;
    const minX = Math.min(...selected.map((node) => node.x));
    const maxX = Math.max(...selected.map((node) => node.x + node.width));
    const minY = Math.min(...selected.map((node) => node.y));
    const maxY = Math.max(...selected.map((node) => node.y + node.height));
    const nextNodes = selected.map((node) => {
      const mirroredX = axis === 'horizontal' ? minX + (maxX - (node.x + node.width)) : node.x;
      const mirroredY = axis === 'vertical' ? minY + (maxY - (node.y + node.height)) : node.y;
      if (node.type === 'path') {
        const flipped = flipPathNode(node, axis);
        return { ...flipped, x: Math.round(mirroredX * 100) / 100, y: Math.round(mirroredY * 100) / 100 };
      }
      return {
        ...node,
        x: Math.round(mirroredX * 100) / 100,
        y: Math.round(mirroredY * 100) / 100,
        rotation: node.rotation ? (360 - node.rotation) % 360 : 0,
      };
    });
    getCommandClient(target).transformNodes(nextNodes, `Flip ${axis}`);
  };

  const handleRotate90 = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const selected = getTransformableNodes(doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id)));
    if (selected.length === 0) return;
    getCommandClient(target).transformNodes(
      selected.map((node) => ({ ...node, rotation: ((node.rotation || 0) + 90) % 360 })),
      'Rotate +90°',
    );
  };

  const handleSimplifyPath = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const paths = doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id) && node.type === 'path');
    if (paths.length === 0) return;
    let totalBefore = 0;
    let totalAfter = 0;
    const simplifiedNodes: DesignNode[] = [];
    for (const node of paths) {
      if (node.type !== 'path') continue;
      totalBefore += node.points.length;
      const simplified = simplifyPathNode(node, 2.5);
      totalAfter += simplified.points.length;
      simplifiedNodes.push(simplified);
    }
    if (simplifiedNodes.length === 0) return;
    getCommandClient(target).transformNodes(simplifiedNodes, 'Simplify vector paths');
    setNotice(`Simplified path anchors (${totalBefore} → ${totalAfter}).`);
  };

  const handleTogglePathClosed = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const paths = doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id) && node.type === 'path');
    if (paths.length === 0) return;
    const updatedNodes: DesignNode[] = [];
    for (const node of paths) {
      if (node.type !== 'path') continue;
      const nextClosed = !node.closed;
      updatedNodes.push(
        normalizePathNode({
          ...node,
          closed: nextClosed,
          style: {
            ...node.style,
            fill: nextClosed && node.style.fill === 'none' ? toolOptions.fillColor : node.style.fill,
            strokeWidth: !nextClosed && node.style.strokeWidth === 0 ? Math.max(2, toolOptions.strokeWidth) : node.style.strokeWidth,
          },
        }),
      );
    }
    if (updatedNodes.length === 0) return;
    getCommandClient(target).transformNodes(updatedNodes, 'Toggle closed vector contour');
  };

  const duplicateSelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const context = getActiveEditorContext(target, state, componentState);
    const layerStates = getEffectiveLayerStates(context.document.nodes);
    const eligibleIds = context.state.selectedNodeIds.filter((id) => {
      const effective = layerStates.get(id);
      return effective?.visible && !effective.locked;
    });
    if (eligibleIds.length === 0) return;
    const { clonedNodes } = cloneNodesSubtree(context.document.nodes, eligibleIds, {
      offsetX: 24,
      offsetY: 24,
      nameSuffix: ' copy',
      preserveExternalParent: true,
    });
    if (clonedNodes.length === 0) return;
    getCommandClient(target).createNodes(clonedNodes, 'Duplicate layers');
  };

  const copySelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return false;
    const context = getActiveEditorContext(target, state, componentState);
    if (context.state.selectedNodeIds.length === 0) return false;
    const payload = createClipboardPayload(context.document.nodes, context.state.selectedNodeIds, {
      target,
      pageId: target === 'main' ? state.project.activePageId : null,
      componentId: target === 'component' ? editingComponentId : null,
    });
    if (!payload) return false;
    clipboardRef.current = payload;
    const count = payload.nodes.length;
    setNotice(`Copied ${count} layer${count === 1 ? '' : 's'} to studio clipboard.`);
    return true;
  };

  const cutSelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const context = getActiveEditorContext(target, state, componentState);
    if (context.state.selectedNodeIds.length === 0) return;
    if (!copySelection(target)) return;
    const ids = expandSelectedLayerIds(context.document.nodes, context.state.selectedNodeIds);
    getCommandClient(target).setNodesCanvasState(ids, false, 'Cut layers');
    setNotice(`Cut ${ids.length} layer${ids.length === 1 ? '' : 's'} to studio clipboard.`);
  };

  const pasteSelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating || !clipboardRef.current) return;
    const prepared = prepareNodesForPaste(clipboardRef.current, {
      target,
      pageId: target === 'main' ? state.project.activePageId : null,
      componentId: target === 'component' ? editingComponentId : null,
      components: state.project.components,
    });
    if (prepared.nodes.length === 0) return;
    clipboardRef.current = { ...clipboardRef.current, pasteCount: prepared.nextPasteCount };
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).createNodes(prepared.nodes, 'Paste layers');
    setInspectorVisible(true);
    if (prepared.detachedCircularCount > 0) {
      setNotice(
        `Pasted ${prepared.nodes.length} layer${prepared.nodes.length === 1 ? '' : 's'} (${prepared.detachedCircularCount} self-referencing component instance detached to prevent recursion).`,
      );
    } else {
      setNotice(`Pasted ${prepared.nodes.length} layer${prepared.nodes.length === 1 ? '' : 's'}.`);
    }
  };

  return {
    updateSelected,
    updateSelectedStyle,
    updateInstanceOverride,
    resetInstanceOverrides,
    detachSelectedInstance,
    alignSelection,
    distributeSelection,
    handlePathfinder,
    handleConvertToPath,
    handleFlipSelection,
    handleRotate90,
    handleSimplifyPath,
    handleTogglePathClosed,
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteSelection,
  };
}

import type { ComponentInstanceNode, DesignNode, DrawMaskMode, VectorShapeMeta } from '../../core/document/types';
import { expandSelectedLayerIds, getEffectiveLayerStates } from '../../core/document/layers';
import type { SelectSimilarCriterion } from '../../core/document/selectionQueries';
import { detachComponentInstance } from '../../core/document/components';
import { getActiveDocument } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import {
  convertAllPathAnchors,
  convertShapeToPathNode,
  divideNodesWithPathfinder,
  flipPathNode,
  normalizePathNode,
  offsetPathNode,
  reversePathNode,
  scalePathNodeGeometry,
  simplifyPathNode,
  updateParametricPathNode,
  type PathfinderOperation,
} from '../../core/document/vector';
import { getComputeKernels, getComputeWorkerClient } from '../../core/kernels';
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
import {
  alignNodeToArtboard,
  computeArrangeMoveSpec,
  computeStepAndRepeatClones,
  type ArrangeOrderAction,
  type StepAndRepeatConfig,
  type StudioVectorActions,
} from './inspectorVectorHelpers';

export type { StudioVectorActions };

function clampPositiveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createStudioVectorId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${rand ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;
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
  onUpdateToolOptions?: (patch: Partial<CanvasToolOptions>) => void;
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  clipboardRef: { current: StudioClipboardPayload | null };
  setWorkspaceToolId: (target: EditorTarget, toolId: CanvasToolId) => void;
  setInspectorVisible: (visible: boolean) => void;
  setNotice: (message: string) => void;
  openNodeLogic?: () => void;
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
  onUpdateToolOptions,
  focusedCommandClient,
  getCommandClient,
  selectionSourceRef,
  clipboardRef,
  setWorkspaceToolId,
  setInspectorVisible,
  setNotice,
  openNodeLogic,
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
    if (selected.length === 1) {
      const aligned = alignNodeToArtboard(selected[0], doc.width, doc.height, alignment);
      getCommandClient(target).transformNodes([aligned], `Align layer to artboard (${alignment})`);
      return;
    }
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
    const newId = createStudioVectorId('pathfinder');
    const totalPathPoints = candidates.reduce(
      (sum, node) => sum + (node.type === 'path' ? node.points.length : 4),
      0,
    );
    const shouldOffloadWorker = candidates.length >= 3 || totalPathPoints >= 60;
    const candidateIds = candidates.map((node) => node.id);

    if (shouldOffloadWorker) {
      setNotice(`Computing Pathfinder ${operation} in background worker…`);
      void getComputeWorkerClient()
        .applyPathfinderAsync(candidates, operation, newId)
        .then((result) => {
          if (!result) {
            setNotice(`Pathfinder ${operation} produced an empty region. Make sure shapes overlap.`);
            return;
          }
          selectionSourceRef.current = 'canvas';
          getCommandClient(target).replaceNodes(candidateIds, [result], 'Replace vector nodes');
          setNotice(`Pathfinder ${operation} created “${result.name}”.`);
        })
        .catch(() => {
          const fallback = getComputeKernels().vector.applyPathfinder(candidates, operation, newId);
          if (!fallback) {
            setNotice(`Pathfinder ${operation} produced an empty region. Make sure shapes overlap.`);
            return;
          }
          selectionSourceRef.current = 'canvas';
          getCommandClient(target).replaceNodes(candidateIds, [fallback], 'Replace vector nodes');
          setNotice(`Pathfinder ${operation} created “${fallback.name}”.`);
        });
      return;
    }

    const result = getComputeKernels().vector.applyPathfinder(candidates, operation, newId);
    if (!result) {
      setNotice(`Pathfinder ${operation} produced an empty region. Make sure shapes overlap.`);
      return;
    }
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).replaceNodes(candidateIds, [result], 'Replace vector nodes');
    setNotice(`Pathfinder ${operation} created “${result.name}”.`);
  };

  const handleDividePathfinder = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const candidates = doc.nodes.filter(
      (node) =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path'),
    );
    if (candidates.length < 2) {
      setNotice('Select at least 2 overlapping shapes to Divide.');
      return;
    }
    const divided = divideNodesWithPathfinder(candidates, () => createStudioVectorId('divide'));
    if (!divided || divided.length === 0) {
      setNotice('Divide produced no closed regions. Make sure shapes have non-zero area.');
      return;
    }
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).replaceNodes(
      candidates.map((node) => node.id),
      divided,
      'Pathfinder Divide shapes',
      divided.map((node) => node.id),
    );
    setNotice(`Divided selection into ${divided.length} editable vector region${divided.length === 1 ? '' : 's'}.`);
  };

  const handleOffsetPath = (target: EditorTarget, distancePx: number, keepOriginal: boolean) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const candidates = doc.nodes.filter(
      (node) =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path'),
    );
    if (candidates.length === 0) {
      setNotice('Select a shape or vector path to apply Offset / Contour.');
      return;
    }
    const created = candidates
      .map((node) => offsetPathNode(node, distancePx, createStudioVectorId('offset')))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (created.length === 0) {
      setNotice('Offset distance collapsed the shape geometry. Try a smaller inward value.');
      return;
    }
    selectionSourceRef.current = 'canvas';
    if (keepOriginal) {
      getCommandClient(target).createNodes(created, `Offset path (${distancePx > 0 ? '+' : ''}${distancePx}px)`);
    } else {
      getCommandClient(target).replaceNodes(
        candidates.map((node) => node.id),
        created,
        `Offset path (${distancePx > 0 ? '+' : ''}${distancePx}px)`,
        created.map((node) => node.id),
      );
    }
    setNotice(`Created ${created.length} offset contour${created.length === 1 ? '' : 's'} (${distancePx > 0 ? '+' : ''}${distancePx}px).`);
  };

  const handleReversePath = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const paths = doc.nodes.filter(
      (node): node is Extract<DesignNode, { type: 'path' }> =>
        editor.selectedNodeIds.includes(node.id) && node.type === 'path',
    );
    if (paths.length === 0) return;
    getCommandClient(target).transformNodes(paths.map(reversePathNode), 'Reverse path direction');
    setNotice(`Reversed path direction on ${paths.length} vector path${paths.length === 1 ? '' : 's'}.`);
  };

  const handleConvertAllAnchors = (target: EditorTarget, mode: 'smooth' | 'corner') => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const paths = doc.nodes.filter(
      (node): node is Extract<DesignNode, { type: 'path' }> =>
        editor.selectedNodeIds.includes(node.id) && node.type === 'path',
    );
    if (paths.length === 0) return;
    getCommandClient(target).transformNodes(
      paths.map((node) => convertAllPathAnchors(node, mode)),
      mode === 'smooth' ? 'Smooth all vector anchors' : 'Sharpen all vector corners',
    );
    setNotice(mode === 'smooth' ? 'Converted anchors to smooth Bezier curves.' : 'Converted anchors to sharp corners.');
  };

  const handleUpdateParametricShape = (target: EditorTarget, meta: VectorShapeMeta) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const activeNode = doc.nodes.find((node) => node.id === editor.selectedNodeIds[0]);
    if (!activeNode || activeNode.type !== 'path') return;
    const updated = updateParametricPathNode(activeNode, meta);
    getCommandClient(target).editNode(updated, `parametric:${activeNode.id}`, 'Adjust parametric shape');
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

  const handleRotateBy = (target: EditorTarget, deltaDeg: number) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const selected = getTransformableNodes(doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id)));
    if (selected.length === 0) return;
    getCommandClient(target).transformNodes(
      selected.map((node) => ({ ...node, rotation: (((node.rotation || 0) + deltaDeg) % 360 + 360) % 360 })),
      `Rotate ${deltaDeg > 0 ? '+' : ''}${deltaDeg}°`,
    );
  };

  const handleResetRotation = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const selected = getTransformableNodes(doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id)));
    if (selected.length === 0) return;
    getCommandClient(target).transformNodes(
      selected.map((node) => ({ ...node, rotation: 0 })),
      'Reset rotation to 0°',
    );
  };

  const handleRotate90 = (target: EditorTarget) => handleRotateBy(target, 90);

  const handleArrangeOrder = (target: EditorTarget, action: ArrangeOrderAction) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const spec = computeArrangeMoveSpec(doc.nodes, editor.selectedNodeIds, action);
    if (!spec) return;
    getCommandClient(target).moveLayers(spec.nodeIds, spec.targetId, spec.position);
  };

  const handleStepAndRepeat = (target: EditorTarget, config: StepAndRepeatConfig) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const layerStates = getEffectiveLayerStates(doc.nodes);
    const eligibleIds = editor.selectedNodeIds.filter((id) => {
      const effective = layerStates.get(id);
      return effective?.visible && !effective.locked;
    });
    if (eligibleIds.length === 0) return;
    const clones = computeStepAndRepeatClones(doc.nodes, eligibleIds, config);
    if (clones.length === 0) return;
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).createNodes(clones, `Step & Repeat (${config.copies} copies)`);
    setNotice(`Created ${clones.length} stepped clone${clones.length === 1 ? '' : 's'}.`);
  };

  const handleSwapFillAndStroke = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const styleable = doc.nodes.filter(
      (node): node is Extract<DesignNode, { type: 'rect' | 'ellipse' | 'frame' | 'path' }> =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path'),
    );

    if (styleable.length > 0) {
      const swapped = styleable.map((node) => {
        const prevFill = node.style.fill;
        const prevStroke = node.style.strokeWidth > 0 && node.style.stroke !== '#00000000'
          ? node.style.stroke
          : 'none';
        const nextFill = prevStroke === 'none' ? 'none' : prevStroke;
        const nextStroke = prevFill === 'none' || prevFill === '#00000000' ? '#00000000' : prevFill;
        const nextStrokeWidth = nextStroke === '#00000000' ? 0 : Math.max(2, node.style.strokeWidth);
        return {
          ...node,
          style: {
            ...node.style,
            fill: nextFill,
            stroke: nextStroke,
            strokeWidth: nextStrokeWidth,
            ...(node.style.fills ? { fills: undefined } : {}),
          },
        } as DesignNode;
      });
      getCommandClient(target).transformNodes(swapped, 'Swap fill and stroke');
    }

    onUpdateToolOptions?.({
      fillColor: toolOptions.strokeColor,
      strokeColor: toolOptions.fillColor,
    });
  };

  const handleResetDefaultColors = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const styleable = doc.nodes.filter(
      (node): node is Extract<DesignNode, { type: 'rect' | 'ellipse' | 'frame' | 'path' }> =>
        editor.selectedNodeIds.includes(node.id)
        && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path'),
    );
    if (styleable.length > 0) {
      getCommandClient(target).transformNodes(
        styleable.map((node) => ({
          ...node,
          style: {
            ...node.style,
            fill: '#FFFFFF',
            stroke: '#111827',
            strokeWidth: 2,
            ...(node.style.fills ? { fills: undefined } : {}),
          },
        }) as DesignNode),
        'Reset default fill and stroke',
      );
    }
    onUpdateToolOptions?.({ fillColor: '#FFFFFF', strokeColor: '#111827', strokeWidth: 2 });
  };

  const handleApplySwatch = (target: EditorTarget, color: string, channel: 'fill' | 'stroke') => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const doc = getActiveDocument(editor.project);
    const selected = doc.nodes.filter((node) => editor.selectedNodeIds.includes(node.id));
    const updated: DesignNode[] = [];
    for (const node of selected) {
      if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
        if (channel === 'fill') {
          updated.push({
            ...node,
            style: {
              ...node.style,
              fill: color,
              ...(node.style.fills ? { fills: undefined } : {}),
            },
          } as DesignNode);
        } else {
          updated.push({
            ...node,
            style: {
              ...node.style,
              stroke: color === 'none' ? '#00000000' : color,
              strokeWidth: color === 'none' ? 0 : Math.max(1.5, node.style.strokeWidth),
            },
          } as DesignNode);
        }
      } else if (node.type === 'text' && channel === 'fill' && color !== 'none') {
        updated.push({ ...node, style: { ...node.style, fill: color } });
      }
    }
    if (updated.length > 0) {
      getCommandClient(target).transformNodes(updated, `Apply ${channel} swatch`);
    }
    if (color !== 'none') {
      onUpdateToolOptions?.(channel === 'fill' ? { fillColor: color } : { strokeColor: color });
    }
  };

  const handleGroupSelection = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    if (editor.selectedNodeIds.length < 2) return;
    getCommandClient(target).groupLayers(editor.selectedNodeIds);
  };

  const handleUngroupSelection = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    if (editor.selectedNodeIds.length === 0) return;
    getCommandClient(target).ungroupLayers(editor.selectedNodeIds);
  };

  const handleCreateClippingMask = (target: EditorTarget) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    if (editor.selectedNodeIds.length === 0) return;
    getCommandClient(target).createClippingMask(editor.selectedNodeIds[0]);
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

  const deselectSelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    getCommandClient(target).deselectAll('Deselect layers');
  };

  const invertSelection = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const result = getCommandClient(target).invertSelection('Invert selection');
    if (result.status === 'no-op') {
      setNotice('No selectable sibling layers to invert.');
    }
  };

  const selectSimilar = (target: EditorTarget = activeEditorId, criterion: SelectSimilarCriterion) => {
    if (isHydrating) return;
    const context = getActiveEditorContext(target, state, componentState);
    if (context.state.selectedNodeIds.length === 0) {
      setNotice('Select at least one layer before running Select Similar.');
      return;
    }
    const result = getCommandClient(target).selectSimilar(criterion, `Select similar (${criterion})`);
    if (result.status === 'no-op') {
      setNotice(`No additional layers match the same ${criterion}.`);
    }
  };

  const setDrawMode = (target: EditorTarget = activeEditorId, mode: DrawMaskMode) => {
    if (isHydrating) return;
    const context = getActiveEditorContext(target, state, componentState);
    const layerStates = getEffectiveLayerStates(context.document.nodes);
    const targets = context.document.nodes.filter(
      (node) =>
        context.state.selectedNodeIds.includes(node.id) &&
        node.type !== 'group' &&
        layerStates.get(node.id)?.visible &&
        !layerStates.get(node.id)?.locked,
    );
    if (targets.length === 0) {
      setNotice('Select an unlocked object to change its Draw Mode.');
      return;
    }
    const updated = targets.map((node) => {
      if (node.type === 'frame' && mode === 'inside') {
        return { ...node, drawMode: mode, clipContent: true };
      }
      return { ...node, drawMode: mode };
    });
    getCommandClient(target).transformNodes(updated, `Set draw mode (${mode})`);
    if (mode === 'inside') {
      setNotice('Draw Inside active: new shapes will clip inside the selected container.');
    } else if (mode === 'outside') {
      setNotice('Draw Outside active: new shapes will mask outside the selected contour.');
    } else {
      setNotice('Draw Mode reset to Normal.');
    }
  };

  const permanentSubtractOutside = (target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const context = getActiveEditorContext(target, state, componentState);
    const nodes = context.document.nodes;
    const layerStates = getEffectiveLayerStates(nodes);
    const activeNode = context.selectedNode;
    if (!activeNode) {
      setNotice('Select a Draw Outside shape or its base contour first.');
      return;
    }

    const baseNode =
      activeNode.clipMaskBaseId && activeNode.clipMaskMode === 'outside'
        ? nodes.find((node) => node.id === activeNode.clipMaskBaseId) ?? null
        : activeNode;
    if (!baseNode) {
      setNotice('Could not locate the base shape for Draw Outside subtraction.');
      return;
    }

    const outsideOverlays =
      activeNode.clipMaskBaseId && activeNode.clipMaskMode === 'outside'
        ? [activeNode]
        : nodes.filter(
          (node) =>
            node.clipMaskBaseId === baseNode.id &&
            node.clipMaskMode === 'outside' &&
            layerStates.get(node.id)?.visible &&
            !layerStates.get(node.id)?.locked,
        );

    if (outsideOverlays.length === 0) {
      setNotice('No Draw Outside shapes are masked against this object.');
      return;
    }

    const kernels = getComputeKernels();
    const removeIds: string[] = [];
    const insertNodes: DesignNode[] = [];
    for (const overlay of outsideOverlays) {
      const subtracted = kernels.vector.booleanOp([overlay, baseNode], 'subtract');
      if (!subtracted) continue;
      removeIds.push(overlay.id);
      insertNodes.push({
        ...subtracted,
        id: createStudioVectorId('path-subtract'),
        name: `${overlay.name} (Cutout)`,
        ...(overlay.parentId ? { parentId: overlay.parentId } : {}),
        clipMaskBaseId: undefined,
        clipMaskMode: undefined,
      });
    }

    if (removeIds.length === 0 || insertNodes.length === 0) {
      setNotice('Permanent Subtract requires overlapping vector shapes.');
      return;
    }

    getCommandClient(target).replaceNodes(
      removeIds,
      insertNodes,
      'Permanent Subtract (Draw Outside)',
      insertNodes.map((n) => n.id),
    );
    setNotice(`Permanently subtracted ${insertNodes.length} Draw Outside shape${insertNodes.length === 1 ? '' : 's'} with Pathfinder.`);
  };

  const createStudioActionsForTarget = (target: EditorTarget): StudioVectorActions => ({
    onPathfinder: (operation) => handlePathfinder(target, operation),
    onBooleanOp: (operation) => handlePathfinder(target, operation),
    onDividePathfinder: () => handleDividePathfinder(target),
    onOffsetPath: (distancePx, keepOriginal) => handleOffsetPath(target, distancePx, keepOriginal),
    onReversePath: () => handleReversePath(target),
    onConvertAllAnchors: (mode) => handleConvertAllAnchors(target, mode),
    onUpdateParametricShape: (meta) => handleUpdateParametricShape(target, meta),
    onFlip: (axis) => handleFlipSelection(target, axis),
    onRotateBy: (deltaDeg) => handleRotateBy(target, deltaDeg),
    onResetRotation: () => handleResetRotation(target),
    onAlign: (alignment) => alignSelection(alignment, target),
    onDistribute: (axis) => distributeSelection(axis, target),
    onArrange: (action) => handleArrangeOrder(target, action),
    onStepAndRepeat: (config) => handleStepAndRepeat(target, config),
    onSwapFillAndStroke: () => handleSwapFillAndStroke(target),
    onResetDefaultColors: () => handleResetDefaultColors(target),
    onApplySwatch: (color, channel) => handleApplySwatch(target, color, channel),
    onGroupSelection: () => handleGroupSelection(target),
    onUngroupSelection: () => handleUngroupSelection(target),
    onCreateClippingMask: () => handleCreateClippingMask(target),
    onDeselect: () => deselectSelection(target),
    onInvertSelection: () => invertSelection(target),
    onSelectSimilar: (criterion) => selectSimilar(target, criterion),
    onSetDrawMode: (mode) => setDrawMode(target, mode),
    onPermanentSubtractOutside: () => permanentSubtractOutside(target),
    ...(openNodeLogic ? { onOpenNodeLogic: openNodeLogic } : {}),
  });

  return {
    updateSelected,
    updateSelectedStyle,
    updateInstanceOverride,
    resetInstanceOverrides,
    detachSelectedInstance,
    alignSelection,
    distributeSelection,
    handlePathfinder,
    handleDividePathfinder,
    handleOffsetPath,
    handleReversePath,
    handleConvertAllAnchors,
    handleUpdateParametricShape,
    handleConvertToPath,
    handleFlipSelection,
    handleRotate90,
    handleRotateBy,
    handleResetRotation,
    handleArrangeOrder,
    handleStepAndRepeat,
    handleSwapFillAndStroke,
    handleResetDefaultColors,
    handleApplySwatch,
    handleSimplifyPath,
    handleTogglePathClosed,
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteSelection,
    deselectSelection,
    invertSelection,
    selectSimilar,
    setDrawMode,
    permanentSubtractOutside,
    createStudioActionsForTarget,
  };
}

import { useMemo } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import type { DesignNode, FolioDocument, FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import type { ToolOperationExecutor } from '../toolOperationExecutor';
import { createMotionAutoKeyBridge } from './motionAutoKeyBridge';
import { useAnimatedComponentsClock } from './useAnimatedComponentsClock';
import { useMotionPlayback } from './useMotionPlayback';

export interface UseWorkspaceMotionBridgeOptions {
  activeEditorId: EditorTarget;
  mainProject: FolioProject;
  componentProject: FolioProject;
  activeDocument: FolioDocument;
  componentDocument: FolioDocument;
  editingComponentName?: string;
  selectedNode: DesignNode | null;
  selectedNodes: readonly DesignNode[];
  selectedNodeIds: readonly string[];
  focusedCommandClient: MainCanvasCommandClient;
  mainToolOperationExecutor: ToolOperationExecutor;
  componentToolOperationExecutor: ToolOperationExecutor;
  onUpdateSelectedFallback: (patch: Partial<DesignNode>, coalesceKey?: string) => void;
  onUpdateSelectedStyleFallback: (patch: Record<string, string | number>, coalesceKey?: string) => void;
  onSampledColorOption: (color: string, colorTarget: 'fill' | 'stroke') => void;
  onCanvasInteraction: () => void;
  onNotice: (message: string) => void;
}

export function useWorkspaceMotionBridge(options: UseWorkspaceMotionBridgeOptions) {
  const {
    activeEditorId,
    mainProject,
    componentProject,
    activeDocument,
    componentDocument,
    editingComponentName,
    selectedNode,
    selectedNodes,
    selectedNodeIds,
    focusedCommandClient,
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    onUpdateSelectedFallback,
    onUpdateSelectedStyleFallback,
    onSampledColorOption,
    onCanvasInteraction,
    onNotice,
  } = options;

  const activeMotionProject = activeEditorId === 'component' ? componentProject : mainProject;
  const activeMotionPage = getActivePage(activeMotionProject);

  const motionExportProject = useMemo(() => {
    if (activeEditorId !== 'component') return mainProject;
    return {
      ...activeMotionProject,
      metadata: {
        ...activeMotionProject.metadata,
        name: editingComponentName ?? activeMotionProject.metadata.name,
      },
      components: mainProject.components,
      assets: mainProject.assets,
      designTokens: mainProject.designTokens,
    };
  }, [activeEditorId, mainProject, activeMotionProject, editingComponentName]);

  const motion = useMotionPlayback({
    workspaceScope: activeEditorId,
    project: activeMotionProject,
    activePage: activeMotionPage,
    selectedNodeIds,
    commandClient: focusedCommandClient,
    onNotice,
  });

  const isActiveMotionPose = motion.motionOpen && (motion.previewActive || motion.isPlaying);
  const animatedActiveNodesById = useMemo(
    () => new Map(motion.animatedMainDocument.nodes.map((node) => [node.id, node])),
    [motion.animatedMainDocument.nodes],
  );
  const inspectorSelectedNode = isActiveMotionPose && selectedNode
    ? (animatedActiveNodesById.get(selectedNode.id) ?? selectedNode)
    : selectedNode;
  const inspectorSelectedNodes = isActiveMotionPose
    ? selectedNodes.map((node) => animatedActiveNodesById.get(node.id) ?? node)
    : selectedNodes;

  const motionAutoKeyBridge = createMotionAutoKeyBridge({
    activeEditorId,
    motion,
    inspectorSelectedNode,
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    onUpdateSelectedFallback,
    onUpdateSelectedStyleFallback,
    onSampledColorOption,
    onCanvasInteraction,
    onNotice,
  });

  const {
    hasAnimatedComponentsOnMain,
    componentAnimPlaying,
    toggleComponentAnimPlaying,
    effectiveMainAnimationTimeMs,
  } = useAnimatedComponentsClock({
    nodes: activeDocument.nodes,
    components: mainProject.components,
    activeEditorId,
    motionOpen: motion.motionOpen,
    motionPlaying: motion.isPlaying,
    motionPreviewActive: motion.previewActive,
    motionPlayheadMs: motion.playheadMs,
  });

  const mainCanvasDocument = activeEditorId === 'main' ? motion.animatedMainDocument : activeDocument;
  const componentCanvasDocument = activeEditorId === 'component' ? motion.animatedMainDocument : componentDocument;

  return {
    activeMotionProject,
    activeMotionPage,
    motionExportProject,
    motion,
    inspectorSelectedNode,
    inspectorSelectedNodes,
    motionAutoKeyBridge,
    hasAnimatedComponentsOnMain,
    componentAnimPlaying,
    toggleComponentAnimPlaying,
    effectiveMainAnimationTimeMs,
    mainCanvasDocument,
    componentCanvasDocument,
  };
}

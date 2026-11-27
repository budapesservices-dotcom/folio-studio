import { useCallback } from 'preact/hooks';
import { findCrossStudioNodeReferences, formatLayerDeletionCleanupNotice } from '../../core/document/nodeReferenceCleanup';
import type { DesignNode, DesignTokenCollection, FolioDocument, FolioPage, FolioProject } from '../../core/document/types';
import type { CanvasToolId } from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { buildCanvasContextMenuExtras, buildWorkspaceToolExecutor } from './canvasContextMenuExtras';
import { buildGlobalToolbarMenuActions } from './globalMenuActions';
import type { useComponentMasterLifecycle } from './useComponentMasterLifecycle';
import type { useLayerPanelController } from './useLayerPanelController';
import type { usePageAndTemplateActions } from './usePageAndTemplateActions';
import type { useSelectionAndVectorActions } from './useSelectionAndVectorActions';
import type { useWorkspaceWindows } from './useWorkspaceWindows';

export interface UseWorkspaceDerivedActionsOptions {
  project: FolioProject;
  activePage: FolioPage;
  activeDocument: FolioDocument;
  componentDocument: FolioDocument | null;
  focusedDocument: FolioDocument;
  activeEditorId: EditorTarget;
  activeCanvasToolId: CanvasToolId;
  mainSelectedNodeIds: readonly string[];
  componentSelectedNodeIds: readonly string[];
  focusedSelectedNodeIds: readonly string[];
  focusedSelectedNodes: readonly DesignNode[];
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
  isHydrating: boolean;
  designTokens: DesignTokenCollection;
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient: MainCanvasCommandClient;
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  windows: ReturnType<typeof useWorkspaceWindows>;
  layers: ReturnType<typeof useLayerPanelController>;
  selectionActions: ReturnType<typeof useSelectionAndVectorActions>;
  pageActions: ReturnType<typeof usePageAndTemplateActions>;
  componentMaster: ReturnType<typeof useComponentMasterLifecycle>;
  chooseCanvasTool: (toolId: CanvasToolId, target?: EditorTarget) => void;
  applySampledColorOption: (color: string, target: 'fill' | 'stroke') => void;
  onUpdateDesignTokens: (nextTokens: DesignTokenCollection, unbindTokenIds?: string[], description?: string) => void;
  setNotice: (message: string) => void;
}

export function useWorkspaceDerivedActions({
  project,
  activePage,
  activeDocument,
  componentDocument,
  focusedDocument,
  activeEditorId,
  activeCanvasToolId,
  mainSelectedNodeIds,
  componentSelectedNodeIds,
  focusedSelectedNodeIds,
  focusedSelectedNodes,
  canUndo,
  canRedo,
  hasClipboard,
  isHydrating,
  designTokens,
  mainCommandClient,
  componentCommandClient,
  focusedCommandClient,
  getCommandClient,
  selectionSourceRef,
  windows,
  layers,
  selectionActions,
  pageActions,
  componentMaster,
  chooseCanvasTool,
  applySampledColorOption,
  onUpdateDesignTokens,
  setNotice,
}: UseWorkspaceDerivedActionsOptions) {
  const buildToolExecutor = (workspace: EditorTarget) =>
    buildWorkspaceToolExecutor({
      workspace,
      commandClient: workspace === 'main' ? mainCommandClient : componentCommandClient,
      isHydrating,
      onMarkCanvasSelectionSource: () => {
        selectionSourceRef.current = 'canvas';
      },
      onShowInspectorOnMain: () => windows.setInspectorVisible(true),
      onPanChange: workspace === 'main' ? windows.setMainPan : windows.setComponentCanvasPan,
      onZoomChange: workspace === 'main' ? windows.setZoom : windows.setComponentCanvasZoom,
      onToolChange: chooseCanvasTool,
      onNotice: setNotice,
      onSampledColorOptionChange: applySampledColorOption,
    });

  const mainToolOperationExecutor = buildToolExecutor('main');
  const componentToolOperationExecutor = buildToolExecutor('component');

  const deleteLayersSafely = useCallback(
    (editorId: EditorTarget, nodeIds: string[]) => {
      const refs = editorId === 'main' ? findCrossStudioNodeReferences(project, nodeIds, activePage.id) : null;
      const names =
        editorId === 'main'
          ? activePage.document.nodes.filter((n) => nodeIds.includes(n.id)).map((n) => n.name)
          : [];
      const result = getCommandClient(editorId).deleteNodes(nodeIds);
      if (result.status === 'applied' && refs && refs.totalCount > 0) {
        const msg = formatLayerDeletionCleanupNotice(names, {
          logicCount: refs.logicBindings.length,
          motionCount: refs.animationTracks.length,
          codeExtensionCount: refs.codeExtensions.length,
        });
        if (msg) setNotice(msg);
      }
    },
    [project, activePage, getCommandClient, setNotice],
  );

  const globalMenuActions = buildGlobalToolbarMenuActions({
    activeEditorId,
    focusedDocument,
    focusedSelectedNodeIds: [...focusedSelectedNodeIds],
    focusedSelectedNodes: [...focusedSelectedNodes],
    canUndo,
    canRedo,
    hasClipboard,
    activeToolId: activeCanvasToolId,
    designTokens,
    focusedCommandClient,
    setActiveZoom: activeEditorId === 'main' ? windows.setZoom : windows.setComponentCanvasZoom,
    onResetView:
      activeEditorId === 'main'
        ? windows.resetMainView
        : () => windows.centerComponentCanvasView(componentDocument?.width ?? 420, componentDocument?.height ?? 280),
    onCut: selectionActions.cutSelection,
    onCopy: selectionActions.copySelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onSelectTool: chooseCanvasTool,
    onPathfinder: selectionActions.handlePathfinder,
    onCombineSelection: selectionActions.handleCombineSelection,
    onConvertToPath: selectionActions.handleConvertToPath,
    onRotate90: selectionActions.handleRotate90,
    onUpdateDesignTokens,
    onDeleteSelected: deleteLayersSafely,
    onNotice: setNotice,
  });

  const mainCanvasContextMenuExtras = buildCanvasContextMenuExtras({
    workspace: 'main',
    documentNodes: activeDocument.nodes,
    selectedNodeIds: [...mainSelectedNodeIds],
    canPaste: hasClipboard,
    commandClient: mainCommandClient,
    onCopy: selectionActions.copySelection,
    onCut: selectionActions.cutSelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onToggleLayerProperty: layers.toggleLayerPropertyFromRow,
    onSaveAsComponent: componentMaster.saveNodesAsComponent,
    onUnpackComponent: selectionActions.unpackComponentInstance,
    onQuickAdd: pageActions.addNode,
  });

  const componentCanvasContextMenuExtras = buildCanvasContextMenuExtras({
    workspace: 'component',
    documentNodes: componentDocument?.nodes ?? [],
    selectedNodeIds: [...componentSelectedNodeIds],
    canPaste: hasClipboard,
    commandClient: componentCommandClient,
    onCopy: selectionActions.copySelection,
    onCut: selectionActions.cutSelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onToggleLayerProperty: layers.toggleLayerPropertyFromRow,
    onUnpackComponent: selectionActions.unpackComponentInstance,
    onQuickAdd: pageActions.addNode,
  });

  return {
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    deleteLayersSafely,
    globalMenuActions,
    mainCanvasContextMenuExtras,
    componentCanvasContextMenuExtras,
  };
}

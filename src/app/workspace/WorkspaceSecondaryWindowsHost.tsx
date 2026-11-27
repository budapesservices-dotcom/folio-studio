import type { FolioDocument, FolioProject } from '../../core/document/types';
import type { CanvasContextMenuActions } from '../../engines/canvas/Canvas';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { getWindowZIndex } from '../windowManager';
import { ComponentCanvasWindow, NodeLogicWindow } from './CanvasWindows';
import type { CanvasPathStudioBridge } from './useCanvasPathStudioBridge';
import type { MotionPlaybackController } from './useMotionPlayback';
import type { useComponentMasterLifecycle } from './useComponentMasterLifecycle';
import type { useDesignSystemActions } from './useDesignSystemActions';
import type { useLayerPanelController } from './useLayerPanelController';
import type { useQuickInteractionActions } from './useQuickInteractionActions';
import type { useSelectionAndVectorActions } from './useSelectionAndVectorActions';
import type { useWorkspaceMotionBridge } from './useWorkspaceMotionBridge';
import type { useWorkspaceToolState } from './useWorkspaceToolState';
import type { useWorkspaceWindows } from './useWorkspaceWindows';

export interface WorkspaceSecondaryWindowsHostProps {
  project: FolioProject;
  activePageId: string;
  activeEditorId: EditorTarget;
  componentDocument: FolioDocument | null;
  componentCanvasDocument: FolioDocument;
  componentSelectedNodeIds: string[];
  componentCanUndo: boolean;
  componentCanRedo: boolean;
  componentCanvasVisible: boolean;
  pendingOpenComponentName: string | null;
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient: MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  windows: ReturnType<typeof useWorkspaceWindows>;
  toolShell: ReturnType<typeof useWorkspaceToolState>;
  designSystem: ReturnType<typeof useDesignSystemActions>;
  layers: ReturnType<typeof useLayerPanelController>;
  selectionActions: ReturnType<typeof useSelectionAndVectorActions>;
  componentMaster: ReturnType<typeof useComponentMasterLifecycle>;
  quickInteractions: ReturnType<typeof useQuickInteractionActions>;
  motion: MotionPlaybackController;
  motionAutoKeyBridge: ReturnType<typeof useWorkspaceMotionBridge>['motionAutoKeyBridge'];
  pathStudio: CanvasPathStudioBridge;
  componentCanvasContextMenuExtras: Partial<CanvasContextMenuActions>;
  onSetActiveEditorId: (target: EditorTarget) => void;
  onInsertImageFiles: (
    files: readonly File[],
    targetEditor?: EditorTarget,
    dropPoint?: { x: number; y: number },
  ) => Promise<void>;
  onNotice: (message: string) => void;
}

export function WorkspaceSecondaryWindowsHost({
  project,
  activePageId,
  activeEditorId,
  componentDocument,
  componentCanvasDocument,
  componentSelectedNodeIds,
  componentCanUndo,
  componentCanRedo,
  componentCanvasVisible,
  pendingOpenComponentName,
  mainCommandClient,
  componentCommandClient,
  selectionSourceRef,
  windows,
  toolShell,
  designSystem,
  layers,
  selectionActions,
  componentMaster,
  quickInteractions,
  motion,
  motionAutoKeyBridge,
  pathStudio,
  componentCanvasContextMenuExtras,
  onSetActiveEditorId,
  onInsertImageFiles,
  onNotice,
}: WorkspaceSecondaryWindowsHostProps) {
  return (
    <>
      <ComponentCanvasWindow
        visible={componentCanvasVisible}
        minimized={windows.componentCanvasMinimized}
        closed={windows.componentCanvasClosed}
        floating={windows.componentCanvasFloating}
        position={windows.componentCanvasPosition}
        size={windows.componentCanvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'component-canvas')}
        document={componentCanvasDocument}
        components={project.components}
        designTokens={designSystem.designTokens}
        assets={project.assets}
        editingComponent={componentMaster.editingComponent}
        selectedNodeIds={componentSelectedNodeIds}
        selectedComponentNodes={componentMaster.selectedComponentNodes}
        toolId={toolShell.workspaceTools.component}
        toolOptions={toolShell.toolOptions}
        zoom={windows.componentCanvasZoom}
        pan={windows.componentView.pan}
        canUndo={componentCanUndo}
        canRedo={componentCanRedo}
        recoveryStatus={componentMaster.componentRecoveryStatus}
        pendingOpenComponentName={pendingOpenComponentName}
        hasPendingDeletion={Boolean(componentMaster.pendingComponentDeletion)}
        showRetryCleanupButton={Boolean(
          componentMaster.pendingComponentDeletion
          && componentMaster.componentCleanupPending
          && !componentMaster.componentDeletionDialogOpen,
        )}
        onPositionChange={windows.setComponentCanvasPosition}
        onSizeChange={windows.setComponentCanvasSize}
        onFocus={() => {
          windows.focusWindow('component-canvas');
          onSetActiveEditorId('component');
          selectionSourceRef.current = 'canvas';
        }}
        onFocusMinimized={() => {
          windows.focusWindow('component-canvas');
          onSetActiveEditorId('component');
        }}
        onHoverHint={() =>
          toolShell.updateToolbarHint(
            'COMPONENT CANVAS',
            'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.',
            ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'],
          )
        }
        onReloadRecoveredMaster={componentMaster.reloadRecoveredComponentMaster}
        onKeepCurrentBuffer={componentMaster.keepCurrentComponentBuffer}
        onDiscardAndOpenPending={componentMaster.discardBufferAndOpenPendingMaster}
        onOpenCleanupDialog={() => componentMaster.setComponentDeletionDialogOpen(true)}
        onSaveMaster={componentMaster.saveComponentCanvasMaster}
        onSaveSelectionAsNew={() =>
          componentMaster.saveNodesAsComponent(componentMaster.selectedComponentNodes, componentDocument?.nodes ?? [])
        }
        onAlign={(alignment) => selectionActions.alignSelection(alignment, 'component')}
        onDistribute={(axis) => selectionActions.distributeSelection(axis, 'component')}
        onUndo={() => componentCommandClient.undo()}
        onRedo={() => componentCommandClient.redo()}
        onZoomChange={windows.setComponentCanvasZoom}
        onResetView={() =>
          windows.centerComponentCanvasView(componentDocument?.width ?? 420, componentDocument?.height ?? 280)
        }
        onMinimize={() => {
          windows.setComponentCanvasMinimized(true);
          onSetActiveEditorId('main');
          if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
        }}
        onRestore={() => {
          windows.setComponentCanvasMinimized(false);
          onSetActiveEditorId('component');
          windows.focusWindow('component-canvas');
        }}
        onToggleFloating={() =>
          windows.setComponentCanvasWindowMode(windows.componentCanvasFloating ? 'docked' : 'floating')
        }
        onClose={() => {
          windows.setComponentCanvasClosed(true);
          windows.setComponentCanvasMinimized(false);
          windows.setComponentCanvasWindowMode('docked');
          onSetActiveEditorId('main');
          if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
        }}
        onCloseMinimized={() => {
          windows.setComponentCanvasClosed(true);
          windows.setComponentCanvasMinimized(false);
        }}
        onChangeToolOptions={toolShell.updateToolOptions}
        onPathfinder={(op) => selectionActions.handlePathfinder('component', op)}
        onConvertToPath={() => selectionActions.handleConvertToPath('component')}
        onFlip={(axis) => selectionActions.handleFlipSelection('component', axis)}
        onRotate90={() => selectionActions.handleRotate90('component')}
        onSimplifyPath={() => selectionActions.handleSimplifyPath('component')}
        onTogglePathClosed={() => selectionActions.handleTogglePathClosed('component')}
        onSelectTool={(nextTool) => toolShell.chooseCanvasTool(nextTool, 'component')}
        onToolOperation={(operation) => motionAutoKeyBridge.executeComponentToolOperations([operation])}
        onToolOperationBatch={(operations) => motionAutoKeyBridge.executeComponentToolOperations(operations)}
        onLayerDrop={(nodeIds) => layers.dropLayersOnCanvas(nodeIds, 'component')}
        onDropImageFiles={(files, point) => { void onInsertImageFiles(files, 'component', point); }}
        onChangeBackground={(background) => { componentCommandClient.setDocumentBackground(background); }}
        onResizeDocument={(width, height) => {
          const res = componentCommandClient.setDocumentSize(width, height, 'Resize component canvas');
          if (res.status === 'applied') windows.centerComponentCanvasView(width, height);
        }}
        studioActions={selectionActions.createStudioActionsForTarget('component')}
        canvasContextMenuExtras={componentCanvasContextMenuExtras}
        motionPaths={activeEditorId === 'component' ? pathStudio.activeCanvasMotionPaths : undefined}
        motionPathSpacingDotsByNodeId={activeEditorId === 'component' ? pathStudio.motionPathSpacingDotsByNodeId : undefined}
        selectedMotionPathPoint={activeEditorId === 'component' ? pathStudio.selectedMotionPathPoint : null}
        onSelectMotionPathPoint={pathStudio.setSelectedMotionPathPoint}
        onUpdateMotionPath={activeEditorId === 'component' ? pathStudio.handleUpdateCanvasMotionPath : undefined}
        showMorphCorrespondence={activeEditorId === 'component' && motion.motionOpen && pathStudio.showMorphCorrespondence}
        morphCorrespondenceMetaByNodeId={activeEditorId === 'component' ? pathStudio.morphCorrespondenceMetaByNodeId : undefined}
        onPickMorphStartVertex={activeEditorId === 'component' && motion.motionOpen ? pathStudio.handlePickMorphStartVertex : undefined}
      />

      <NodeLogicWindow
        visible={!windows.nodeLogicClosed && !windows.nodeLogicMinimized}
        minimized={windows.nodeLogicMinimized}
        closed={windows.nodeLogicClosed}
        floating={windows.nodeLogicFloating}
        position={windows.nodeLogicPosition}
        size={windows.nodeLogicSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'node-logic')}
        project={project}
        activePageId={activePageId}
        mainCommandClient={mainCommandClient}
        onNotice={onNotice}
        onOpenLivePreview={toolShell.openLivePreviewForPage}
        onToggleComponentNodeLogic={designSystem.toggleComponentNodeLogic}
        focusRequest={quickInteractions.nodeLogicFocusRequest}
        onPositionChange={windows.setNodeLogicPosition}
        onSizeChange={windows.setNodeLogicSize}
        onFocus={() => {
          windows.focusWindow('node-logic');
          onSetActiveEditorId('main');
        }}
        onHoverHint={() =>
          toolShell.updateToolbarHint(
            'NODE LOGIC',
            'Build interactive event, state, logic, and action flows connected to Live Preview.',
          )
        }
        onMinimize={() => windows.setNodeLogicMinimized(true)}
        onRestore={() => {
          windows.setNodeLogicMinimized(false);
          onSetActiveEditorId('main');
          windows.focusWindow('node-logic');
        }}
        onToggleFloating={() =>
          windows.setNodeLogicWindowMode(windows.nodeLogicFloating ? 'docked' : 'floating')
        }
        onClose={() => {
          windows.setNodeLogicClosed(true);
          windows.setNodeLogicMinimized(false);
          windows.setNodeLogicWindowMode('docked');
        }}
        onCloseMinimized={() => {
          windows.setNodeLogicClosed(true);
          windows.setNodeLogicMinimized(false);
        }}
      />
    </>
  );
}

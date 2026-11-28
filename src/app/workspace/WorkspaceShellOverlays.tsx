import type { FolioDocument, FolioPage, FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import type { CanvasPathStudioBridge } from './useCanvasPathStudioBridge';
import type { MotionPlaybackController } from './useMotionPlayback';
import type { useComponentMasterLifecycle } from './useComponentMasterLifecycle';
import type { useDesignSystemActions } from './useDesignSystemActions';
import type { useLayerPanelController } from './useLayerPanelController';
import type { useProjectFileLifecycle } from './useProjectFileLifecycle';
import type { useSelectionAndVectorActions } from './useSelectionAndVectorActions';
import type { useWorkspaceDialogs } from './useWorkspaceDialogs';
import type { useWorkspaceToolState } from './useWorkspaceToolState';
import type { useWorkspaceWindows } from './useWorkspaceWindows';
import { ComponentDeletionDialog, ProjectHydrationOverlay } from './ComponentDeletionDialog';
import { WorkspaceModals } from './WorkspaceModals';
import { WorkspaceStudioOverlays } from './WorkspaceStudioOverlays';

export interface WorkspaceShellOverlaysProps {
  project: FolioProject;
  activePage: FolioPage;
  pages: readonly FolioPage[];
  activeDocument: FolioDocument;
  componentDocument: FolioDocument | null;
  activeEditorId: EditorTarget;
  selectedMainNodeId: string | null;
  mainSelectedNodeIds: readonly string[];
  componentSelectedNodeIds: readonly string[];
  historyUndoCount: number;
  historyRedoCount: number;
  isHydrating: boolean;
  canPaste: boolean;
  notice: string;
  mainCommandClient: MainCanvasCommandClient;
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  activeMotionPage: FolioPage;
  activeMotionProject: FolioProject;
  motionExportProject: FolioProject;
  activeMotionSelectedNodeIds: readonly string[];
  windows: ReturnType<typeof useWorkspaceWindows>;
  toolShell: ReturnType<typeof useWorkspaceToolState>;
  designSystem: ReturnType<typeof useDesignSystemActions>;
  layers: ReturnType<typeof useLayerPanelController>;
  selectionActions: ReturnType<typeof useSelectionAndVectorActions>;
  componentMaster: ReturnType<typeof useComponentMasterLifecycle>;
  dialogs: ReturnType<typeof useWorkspaceDialogs>;
  fileLifecycle: ReturnType<typeof useProjectFileLifecycle>;
  motion: MotionPlaybackController;
  pathStudio: CanvasPathStudioBridge;
  onSetActiveEditorId: (target: EditorTarget) => void;
  onDeleteLayersSafely: (editorId: EditorTarget, nodeIds: string[]) => void;
  onNotice: (message: string) => void;
}

export function WorkspaceShellOverlays({
  project,
  activePage,
  pages,
  activeDocument,
  componentDocument,
  activeEditorId,
  selectedMainNodeId,
  mainSelectedNodeIds,
  componentSelectedNodeIds,
  historyUndoCount,
  historyRedoCount,
  isHydrating,
  canPaste,
  notice,
  mainCommandClient,
  focusedCommandClient,
  getCommandClient,
  selectionSourceRef,
  activeMotionPage,
  activeMotionProject,
  motionExportProject,
  activeMotionSelectedNodeIds,
  windows,
  toolShell,
  designSystem,
  layers,
  selectionActions,
  componentMaster,
  dialogs,
  fileLifecycle,
  motion,
  pathStudio,
  onSetActiveEditorId,
  onDeleteLayersSafely,
  onNotice,
}: WorkspaceShellOverlaysProps) {
  const {
    projectFileInputRef,
    codeWorkspaceOpen,
    setCodeWorkspaceOpen: onSetCodeWorkspaceOpen,
    codeWorkspaceLaunch,
    motionExportOpen,
    setMotionExportOpen: onSetMotionExportOpen,
    chooseCanvasTool: onChooseTool,
    openLivePreviewForPage: onOpenLivePreview,
  } = toolShell;
  return (
    <>
      <WorkspaceStudioOverlays
        project={project}
        activePage={activePage}
        pages={pages}
        activeEditorId={activeEditorId}
        selectedMainNodeId={selectedMainNodeId}
        activeBreakpoint={designSystem.activeBreakpoint}
        designTokens={designSystem.designTokens}
        mainCommandClient={mainCommandClient}
        focusedCommandClient={focusedCommandClient}
        getCommandClient={getCommandClient}
        tokensRackOpen={designSystem.tokensRackOpen}
        tokensRackRef={designSystem.tokensRackRef}
        onUpdateDesignTokens={designSystem.updateDesignTokens}
        onCloseTokensRack={designSystem.closeTokensRack}
        codeWorkspaceOpen={codeWorkspaceOpen}
        codeWorkspaceLaunch={codeWorkspaceLaunch}
        onJumpToCanvasNode={() => {
          onSetActiveEditorId('main');
          windows.openMainCanvas();
        }}
        onCloseCodeWorkspace={() => onSetCodeWorkspaceOpen(false)}
        layerColorPickerKey={layers.layerColorPickerKey}
        layerSourceNodes={layers.layerSourceNodes}
        layerColorPickerPosition={layers.layerColorPickerPosition}
        layerColorPaletteRef={layers.layerColorPaletteRef}
        onSelectPresetLayerColor={(nodeId, color) => {
          layers.setLayerColorFromRow(nodeId, color);
          layers.closeLayerColorPicker();
        }}
        onSelectCustomLayerColor={layers.setLayerColorFromRow}
        layerContextMenu={layers.layerContextMenu}
        layerContextMenuRef={layers.layerContextMenuRef}
        contextMenuNodes={layers.contextMenuNodes}
        contextMenuCapabilities={layers.contextMenuCapabilities}
        canPaste={canPaste}
        onDismissLayerContextMenu={() => layers.setLayerContextMenu(null)}
        onRenameLayer={(nodeId) => layers.beginLayerRename(nodeId, false)}
        onCopyLayer={selectionActions.copySelection}
        onCutLayer={selectionActions.cutSelection}
        onPasteLayer={selectionActions.pasteSelection}
        onDuplicateLayer={selectionActions.duplicateSelection}
        onToggleLayerVisible={(nodeId) => layers.toggleLayerPropertyFromRow(nodeId, 'visible')}
        onToggleLayerLock={(nodeId) => layers.toggleLayerPropertyFromRow(nodeId, 'locked')}
        onArrangeLayer={selectionActions.handleArrangeOrder}
        onCombineSelection={selectionActions.handleCombineSelection}
        onSaveLayerAsComponent={(editorId) => {
          const docNodes = editorId === 'main' ? activeDocument.nodes : (componentDocument?.nodes ?? []);
          const selectedIds = editorId === 'main' ? mainSelectedNodeIds : componentSelectedNodeIds;
          componentMaster.saveNodesAsComponent(docNodes.filter((n) => selectedIds.includes(n.id)), docNodes);
        }}
        onUnpackComponent={selectionActions.unpackComponentInstance}
        onDeleteLayers={onDeleteLayersSafely}
        onMarkLayerSelectionSource={() => {
          selectionSourceRef.current = 'layers';
        }}
        motionOpen={motion.motionOpen}
        activeMotionPage={activeMotionPage}
        activeMotionProject={activeMotionProject}
        pageClips={motion.pageClips}
        activeClip={motion.activeClip}
        activeMotionSelectedNodeIds={activeMotionSelectedNodeIds}
        playheadMs={motion.playheadMs}
        isPlaying={motion.isPlaying}
        previewActive={motion.previewActive}
        autoKeyEnabled={motion.autoKeyEnabled}
        onToggleAutoKey={motion.toggleAutoKey}
        onSelectClip={motion.selectClip}
        onCreateClip={motion.createNewClip}
        onApplyPreset={motion.applyPreset}
        onDeleteClip={motion.deleteActiveClip}
        onUpdateClip={motion.updateClip}
        onUpdateCustomEasings={motion.updateCustomEasings}
        onTogglePlay={motion.togglePlay}
        onStop={motion.stop}
        onSeek={motion.seek}
        onKeyframeSelected={() => motion.keyframeSelectedLayers()}
        onKeyframePathMorph={() => motion.keyframeShapeMorph()}
        onImportMorphFromComponent={(component, options) =>
          motion.importShapeMorphFromComponent(component, designSystem.designTokens, options)
        }
        onChooseTool={onChooseTool}
        onOpenLivePreview={onOpenLivePreview}
        onOpenMotionExport={() => onSetMotionExportOpen(true)}
        selectedMotionPathPoint={pathStudio.selectedMotionPathPoint}
        onSelectMotionPathPoint={pathStudio.setSelectedMotionPathPoint}
        showMorphCorrespondence={pathStudio.showMorphCorrespondence}
        onToggleMorphCorrespondence={pathStudio.toggleMorphCorrespondence}
        onCloseMotion={motion.closeMotion}
        onNotice={onNotice}
      />

      <ComponentDeletionDialog
        open={componentMaster.componentDeletionDialogOpen}
        pendingComponent={componentMaster.pendingComponentDeletion}
        mode={componentMaster.componentDeletionMode}
        busy={componentMaster.componentDeletionBusy}
        cleanupPending={componentMaster.componentCleanupPending}
        durableRecoveryComponentId={componentMaster.durableRecoveryComponentId}
        componentSaveStatus={componentMaster.componentSaveStatus}
        hostRef={componentMaster.deletionModalHostRef}
        dialogRef={componentMaster.deletionDialogRef}
        onCancel={componentMaster.cancelComponentDeletion}
        onSaveBufferAsNewAndDelete={() => { void componentMaster.saveBufferAsNewAndDelete(); }}
        onDiscardBufferAndDelete={() => { void componentMaster.discardBufferAndDelete(); }}
        onRetryCleanup={() => { void componentMaster.retryComponentBufferCleanup(); }}
        onRetryComponentSave={componentMaster.retryComponentCanvasSave}
      />

      <WorkspaceModals
        project={project}
        activePage={activePage}
        motionExportProject={motionExportProject}
        motionExportPage={activeMotionPage}
        pageClips={motion.pageClips}
        activeClip={motion.activeClip}
        breakpoint={designSystem.activeBreakpoint}
        activeWorkspace={activeEditorId}
        componentDeletionDialogOpen={componentMaster.componentDeletionDialogOpen}
        newProjectDialogOpen={dialogs.newProjectDialogOpen}
        newProjectBusyMode={dialogs.newProjectBusyMode}
        newProjectError={dialogs.newProjectError}
        newProjectModalHostRef={dialogs.newProjectModalHostRef}
        newProjectDialogRef={dialogs.newProjectDialogRef}
        onSaveAndCreateNewProject={() => { void dialogs.confirmNewProject('save'); }}
        onDeleteAndCreateNewProject={() => { void dialogs.confirmNewProject('delete'); }}
        onCancelNewProject={dialogs.closeNewProjectDialog}
        motionExportOpen={motionExportOpen}
        shortcutsModalOpen={dialogs.shortcutsModalOpen}
        diagnosticsModalOpen={dialogs.diagnosticsModalOpen}
        projectLibraryOpen={dialogs.projectLibraryOpen}
        historyUndoCount={historyUndoCount}
        historyRedoCount={historyRedoCount}
        shortcutsModalHostRef={dialogs.shortcutsModalHostRef}
        shortcutsDialogRef={dialogs.shortcutsDialogRef}
        onNotice={onNotice}
        onCloseMotionExport={() => onSetMotionExportOpen(false)}
        onCloseShortcuts={dialogs.closeShortcutsModal}
        onShortcutsReady={dialogs.handleShortcutsModalReady}
        onOpenCodeStudio={() => {
          onSetActiveEditorId('main');
          onSetCodeWorkspaceOpen(true);
        }}
        onCloseDiagnostics={() => dialogs.setDiagnosticsModalOpen(false)}
        onLoadStoredProject={fileLifecycle.loadStoredProjectIntoWorkspace}
        onOpenProjectFilePicker={() => {
          if (!isHydrating) projectFileInputRef.current?.click();
        }}
        onCloseProjectLibrary={dialogs.closeProjectLibrary}
      />

      <ProjectHydrationOverlay visible={isHydrating} />
      {notice && (
        <div class={`toast${motion.motionOpen ? ' is-above-timeline' : ''}`} role="status">
          {notice}
        </div>
      )}
    </>
  );
}

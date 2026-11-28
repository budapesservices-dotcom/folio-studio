import { useCallback, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { getActiveApplication, getProjectApplications } from '../core/document/applications';
import { getComponentOverrideTargets } from '../core/document/components';
import { getActiveDocument, getActivePage } from '../core/document/project';
import { getStudioTool } from '../engines/canvas/tools/studioRegistry';
import type { StudioClipboardPayload } from './nodeClipboard';
import { getActiveEditorContext, type EditorTarget } from './editorContext';
import { getWindowZIndex } from './windowManager';
import { DEFAULT_TOOLBAR_HINT } from './ToolbarHintBar';
import { useWorkspaceStores } from './useWorkspaceStores';
import { useWorkspaceWindows } from './workspace/useWorkspaceWindows';
import { useWorkspaceToolState } from './workspace/useWorkspaceToolState';
import { useWorkspaceChromeEffects } from './workspace/useWorkspaceChromeEffects';
import { useWorkspaceChromeActions } from './workspace/useWorkspaceChromeActions';
import { useWorkspaceDialogs } from './workspace/useWorkspaceDialogs';
import { useWorkspaceMotionBridge } from './workspace/useWorkspaceMotionBridge';
import { usePanelResizeController } from './workspace/usePanelResizeController';
import { useComponentMasterLifecycle } from './workspace/useComponentMasterLifecycle';
import { useWorkspaceShortcuts } from './workspace/useWorkspaceShortcuts';
import { useLayerPanelController } from './workspace/useLayerPanelController';
import { useSelectionAndVectorActions } from './workspace/useSelectionAndVectorActions';
import { useProjectFileLifecycle } from './workspace/useProjectFileLifecycle';
import { usePageAndTemplateActions } from './workspace/usePageAndTemplateActions';
import { useDesignSystemActions } from './workspace/useDesignSystemActions';
import { useMediaAndFontsLifecycle } from './workspace/useMediaAndFontsLifecycle';
import { useWorkspaceDerivedActions } from './workspace/useWorkspaceDerivedActions';
import { useCanvasPathStudioBridge } from './workspace/useCanvasPathStudioBridge';
import { useQuickInteractionActions } from './workspace/useQuickInteractionActions';
import { GlobalToolbar, WorkspacePreferencesRecoveryBanner } from './workspace/GlobalToolbar';
import { ToolRail } from './workspace/ToolRail';
import { LayersPanel } from './workspace/LayersPanel';
import { MainCanvasWindow } from './workspace/CanvasWindows';
import { PagesRackPanel } from './workspace/PagesRackPanel';
import { ComponentRackPanel } from './workspace/ComponentRackPanel';
import { StatusBar } from './workspace/StatusBar';
import { WorkspaceInspectorHost } from './workspace/WorkspaceInspectorHost';
import { WorkspaceSecondaryWindowsHost } from './workspace/WorkspaceSecondaryWindowsHost';
import { WorkspaceShellOverlays } from './workspace/WorkspaceShellOverlays';
import type { PrototypeNodeOverride, PrototypeRuntimeSnapshot } from '../engines/prototype/runtime';

export function App() {
  const [activeEditorId, setActiveEditorId] = useState<EditorTarget>('main');
  const [notice, setNotice] = useState('');
  const [logicRuntimeState, setLogicRuntimeState] = useState<{
    readonly scope: 'page' | 'component' | 'project';
    readonly targetId?: string;
    readonly nodeOverrides: Readonly<Record<string, PrototypeNodeOverride>>;
  } | null>(null);
  const handleLogicRuntimeSnapshotChange = useCallback(
    (
      snapshot: PrototypeRuntimeSnapshot | null,
      scope: 'page' | 'component' | 'project',
      targetId?: string,
    ) => {
      if (!snapshot || Object.keys(snapshot.nodeOverrides).length === 0) {
        setLogicRuntimeState(null);
        return;
      }
      setLogicRuntimeState({
        scope,
        targetId,
        nodeOverrides: snapshot.nodeOverrides,
      });
    },
    [],
  );
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const selectionSourceRef = useRef<'layers' | 'canvas'>('canvas');
  const clipboardRef = useRef<StudioClipboardPayload | null>(null);
  const setProjectNameEditingRef = useRef<(editing: boolean) => void>(() => {});
  const chromeActionsRef = useRef<ReturnType<typeof useWorkspaceChromeActions> | null>(null);
  const editingComponentIdRef = useRef<string | null>(null);
  const resetEditingComponentRef = useRef<() => void>(() => {});
  const activeBreakpointRef = useRef<'desktop' | 'tablet' | 'mobile'>('desktop');

  // Canonical & component editor stores + Native Command Engine clients
  const {
    canonicalStore,
    componentStore,
    state,
    componentState,
    componentInitialProject,
    mainCommandClient,
    componentCommandClient,
    getCommandClient,
    getCanonicalRevision,
    getCanonicalProject,
    subscribeCanonicalStore,
  } = useWorkspaceStores({ onRejectedNotice: setNotice });

  // Workspace windows, panel resize & shell tool/menu/rack state
  const windows = useWorkspaceWindows({ setActiveEditorId, setNotice });
  const panelResize = usePanelResizeController({
    appShellRef,
    layersVisible: windows.layersVisible,
    inspectorVisible: windows.inspectorVisible,
  });
  const toolShell = useWorkspaceToolState({
    activeEditorId,
    resizingPanelRef: panelResize.resizingPanelRef,
    setActiveEditorId,
    setPagesRackOpen: windows.setPagesRackOpen,
    setComponentRackOpen: windows.setComponentRackOpen,
  });

  const activeDocument = getActiveDocument(state.project);
  const componentDocument = getActiveDocument(componentState.project);
  const getEditingComponentId = useCallback(() => editingComponentIdRef.current, []);
  const resetEditingComponent = useCallback(() => resetEditingComponentRef.current(), []);
  const getActiveBreakpoint = useCallback(() => activeBreakpointRef.current, []);

  // Project hydration, revision-fenced autosave & .flop / SVG / PNG export
  const fileLifecycle = useProjectFileLifecycle({
    project: state.project,
    componentProject: componentState.project,
    componentDocument,
    activeEditorId,
    getActiveBreakpoint,
    getEditingComponentId,
    onResetEditingComponent: resetEditingComponent,
    mainCommandClient,
    getCanonicalRevision,
    getCanonicalProject,
    subscribeCanonicalStore,
    setActiveEditorId,
    setComponentCanvasClosed: windows.setComponentCanvasClosed,
    setComponentCanvasMinimized: windows.setComponentCanvasMinimized,
    setFileMenuOpen: (open) => toolShell.setOpenMenu(open ? 'file' : null),
    setNotice,
  });

  // Component Canvas master sync, buffer protection & durable deletion lifecycle
  const componentMaster = useComponentMasterLifecycle({
    canonicalStore,
    mainCommandClient,
    componentCommandClient,
    state,
    componentState,
    componentInitialProject,
    isProjectLoaded: fileLifecycle.isProjectLoaded,
    appShellRef,
    focusWindow: windows.focusWindow,
    setActiveEditorId,
    setComponentCanvasClosed: windows.setComponentCanvasClosed,
    setComponentCanvasMinimized: windows.setComponentCanvasMinimized,
    setInspectorVisible: windows.setInspectorVisible,
    setComponentRackOpen: windows.setComponentRackOpen,
    closePagesRack: toolShell.closePagesRack,
    closeComponentRack: toolShell.closeComponentRack,
    onCenterComponentCanvas: windows.centerComponentCanvasView,
    setNotice,
  });
  editingComponentIdRef.current = componentMaster.editingComponentId;
  resetEditingComponentRef.current = () => componentMaster.setEditingComponentId(null);

  // Derived active workspace context
  const isHydrating = !fileLifecycle.isProjectLoaded || !componentMaster.componentReady;
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;
  const activePage = getActivePage(state.project);
  const projectApplications = getProjectApplications(state.project);
  const activeApplication = getActiveApplication(state.project);
  const ownedComponents = state.project.components;
  const focusedEditor = getActiveEditorContext(activeEditorId, state, componentState);
  const focusedDocument = focusedEditor.document;
  const focusedPage = activeEditorId === 'main' ? activePage : null;
  const layerContextName = focusedPage?.name ?? componentMaster.editingComponent?.name ?? componentDocument.name;
  const layerContextLabel = focusedPage ? `EDITING: ${focusedPage.name}` : `COMPONENT: ${layerContextName}`;
  const layerContextTitle = focusedPage
    ? `Editing page ${focusedPage.name} (${focusedPage.route})`
    : `Editing component ${layerContextName}`;
  const selectedNode = focusedEditor.selectedNode;
  const selectedNodes = focusedEditor.selectedNodes;
  const selectedInstance = selectedNode?.type === 'component-instance' ? selectedNode : null;
  const selectedInstanceComponent = selectedInstance
    ? state.project.components.find((component) => component.id === selectedInstance.componentId) ?? null
    : null;
  const instanceOverrideTargets = selectedInstanceComponent
    ? getComponentOverrideTargets(selectedInstanceComponent)
    : null;
  const focusedCommandClient = getCommandClient(activeEditorId);

  // Layers panel controller
  const layers = useLayerPanelController({
    activeEditorId,
    state,
    componentState,
    activeDocument,
    componentDocument,
    focusedDocument,
    focusedSelectedNodeIds: focusedEditor.state.selectedNodeIds,
    focusedCommandClient,
    getCommandClient,
    selectionSourceRef,
    setActiveEditorId,
    setInspectorVisible: windows.setInspectorVisible,
    setNotice,
  });

  // Dialogs & global chrome side effects
  const dismissPopoversForDialog = useCallback(() => {
    toolShell.setOpenMenu(null);
    toolShell.setToolRackOpen(null);
    layers.setLayerContextMenu(null);
  }, [toolShell.setOpenMenu, toolShell.setToolRackOpen, layers.setLayerContextMenu]);

  const handleAfterNewProjectReset = useCallback(() => {
    toolShell.setCodeWorkspaceOpen(false);
    toolShell.setMotionExportOpen(false);
    setProjectNameEditingRef.current(false);
    windows.openMainCanvas();
  }, [toolShell.setCodeWorkspaceOpen, toolShell.setMotionExportOpen, windows]);

  const dialogs = useWorkspaceDialogs({
    isHydrating,
    onDismissPopovers: dismissPopoversForDialog,
    onCreateNewProject: fileLifecycle.createNewProject,
    onAfterNewProjectReset: handleAfterNewProjectReset,
  });

  useWorkspaceChromeEffects({
    notice,
    setNotice,
    openMenu: toolShell.openMenu,
    setOpenMenu: toolShell.setOpenMenu,
    menuBarRef: toolShell.menuBarRef,
    toolRackOpen: toolShell.toolRackOpen,
    setToolRackOpen: toolShell.setToolRackOpen,
    toolRailRef: toolShell.toolRailRef,
    recoverWindow: windows.recoverWindow,
    clampCurrentPanelWidths: panelResize.clampCurrentPanelWidths,
    shortcutsModalOpen: dialogs.shortcutsModalOpen,
    shortcutsMountTick: dialogs.shortcutsMountTick,
    componentDeletionDialogOpen: componentMaster.componentDeletionDialogOpen,
    appShellRef,
    shortcutsModalHostRef: dialogs.shortcutsModalHostRef,
    shortcutsDialogRef: dialogs.shortcutsDialogRef,
    shortcutsFocusReturnRef: dialogs.shortcutsFocusReturnRef,
    closeShortcutsModal: dialogs.closeShortcutsModal,
    newProjectDialogOpen: dialogs.newProjectDialogOpen,
    newProjectBusy: dialogs.newProjectBusyMode !== null,
    newProjectModalHostRef: dialogs.newProjectModalHostRef,
    newProjectDialogRef: dialogs.newProjectDialogRef,
    newProjectFocusReturnRef: dialogs.newProjectFocusReturnRef,
    closeNewProjectDialog: dialogs.closeNewProjectDialog,
  });

  // Studio feature controllers
  const quickInteractions = useQuickInteractionActions({
    project: state.project,
    mainCommandClient,
    openNodeLogic: windows.openNodeLogic,
    setNotice,
  });

  const selectionActions = useSelectionAndVectorActions({
    activeEditorId, isHydrating, state, componentState, selectedNode, selectedNodes,
    editingComponentId: componentMaster.editingComponentId, toolOptions: toolShell.toolOptions,
    onUpdateToolOptions: toolShell.updateToolOptions, focusedCommandClient, getCommandClient,
    selectionSourceRef, clipboardRef, setWorkspaceToolId: toolShell.setWorkspaceToolId,
    setInspectorVisible: windows.setInspectorVisible, setNotice, openNodeLogic: windows.openNodeLogic,
  });
  const activeStudioActions = selectionActions.createStudioActionsForTarget(activeEditorId);

  const pageActions = usePageAndTemplateActions({
    project: state.project,
    activeEditorId,
    editingComponentId: componentMaster.editingComponentId,
    activeDocument,
    focusedDocument,
    isHydrating,
    mainCommandClient,
    focusedCommandClient,
    setActiveEditorId,
    setWorkspaceTools: toolShell.setWorkspaceTools,
    setToolRackOpen: toolShell.setToolRackOpen,
    setInspectorVisible: windows.setInspectorVisible,
    openMainCanvas: windows.openMainCanvas,
    closePagesRack: toolShell.closePagesRack,
    setNotice,
  });

  const { handleInsertImageFiles, handleImportFontFiles } = useMediaAndFontsLifecycle({
    project: state.project,
    activeEditorId,
    isHydrating,
    canonicalStore,
    componentStore,
    mainCommandClient,
    componentCommandClient,
    selectionSourceRef,
    setInspectorVisible: windows.setInspectorVisible,
    setNotice,
  });

  useWorkspaceShortcuts({
    activeEditorId, editingComponentId: componentMaster.editingComponentId, state, componentState, isHydrating,
    componentDeletionDialogOpen: componentMaster.componentDeletionDialogOpen,
    shortcutsModalOpen: dialogs.shortcutsModalOpen, newProjectDialogOpen: dialogs.newProjectDialogOpen,
    diagnosticsModalOpen: dialogs.diagnosticsModalOpen, projectLibraryOpen: dialogs.projectLibraryOpen,
    motionExportOpen: toolShell.motionExportOpen, selectionSourceRef, clipboardRef, getCommandClient,
    openShortcutsModal: dialogs.openShortcutsModal,
    copySelection: selectionActions.copySelection, cutSelection: selectionActions.cutSelection,
    pasteSelection: selectionActions.pasteSelection, duplicateSelection: selectionActions.duplicateSelection,
    chooseCanvasTool: toolShell.chooseCanvasTool, setNotice,
    onZoomStep: (target, action) => chromeActionsRef.current?.stepWorkspaceZoom(target, action),
    onArrangeOrder: (target, action) => selectionActions.handleArrangeOrder(target, action),
    onToggleSelectedProperty: (target, property) => {
      const primaryId = (target === 'main' ? state : componentState).selectedNodeIds[0];
      if (primaryId) layers.toggleLayerPropertyFromRow(primaryId, property);
    },
    onBeginLayerRename: (nodeId) => { if (!windows.layersVisible) windows.setLayersVisible(true); layers.beginLayerRename(nodeId, false); },
    onToggleFocusCanvas: () => chromeActionsRef.current?.toggleFocusCanvas(),
    onToggleStudioPanel: (panel) => chromeActionsRef.current?.toggleStudioPanel(panel),
  });

  const designSystem = useDesignSystemActions({
    project: state.project,
    focusedDocument,
    selectedNode,
    mainCommandClient,
    focusedCommandClient,
    componentCommandClient,
    setNotice,
    onMasterMetadataUpdated: componentMaster.acknowledgeMasterMetadataUpdate,
  });
  activeBreakpointRef.current = designSystem.activeBreakpoint;

  // Derived tool executors, safe layer deletion & menu/context action builders
  const {
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    deleteLayersSafely,
    globalMenuActions,
    mainCanvasContextMenuExtras,
    componentCanvasContextMenuExtras,
  } = useWorkspaceDerivedActions({
    project: state.project,
    activePage,
    activeDocument,
    componentDocument,
    focusedDocument,
    activeEditorId,
    activeCanvasToolId: toolShell.activeCanvasToolId,
    mainSelectedNodeIds: state.selectedNodeIds,
    componentSelectedNodeIds: componentState.selectedNodeIds,
    focusedSelectedNodeIds: focusedEditor.state.selectedNodeIds,
    focusedSelectedNodes: focusedEditor.selectedNodes,
    canUndo: focusedEditor.state.past.length > 0,
    canRedo: focusedEditor.state.future.length > 0,
    hasClipboard: clipboardRef.current !== null,
    isHydrating,
    designTokens: designSystem.designTokens,
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
    chooseCanvasTool: toolShell.chooseCanvasTool,
    applySampledColorOption: toolShell.applySampledColorOption,
    onUpdateDesignTokens: designSystem.updateDesignTokens,
    setNotice,
  });

  // Motion Timeline, Auto-Key bridge & Path Studio canvas bridge
  const activeMotionSelectedNodeIds = focusedEditor.state.selectedNodeIds;
  const {
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
  } = useWorkspaceMotionBridge({
    activeEditorId,
    mainProject: state.project,
    componentProject: componentState.project,
    activeDocument,
    componentDocument,
    editingComponentName: componentMaster.editingComponent?.name,
    selectedNode,
    selectedNodes: focusedEditor.selectedNodes,
    selectedNodeIds: activeMotionSelectedNodeIds,
    focusedCommandClient,
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    onUpdateSelectedFallback: selectionActions.updateSelected,
    onUpdateSelectedStyleFallback: selectionActions.updateSelectedStyle,
    onSampledColorOption: toolShell.applySampledColorOption,
    onCanvasInteraction: () => { selectionSourceRef.current = 'canvas'; },
    onNotice: setNotice,
  });

  const pathStudio = useCanvasPathStudioBridge({ motion, inspectorSelectedNode, setNotice });

  const chromeActions = useWorkspaceChromeActions({
    projectName: state.project.metadata.name,
    windows,
    tokensRackOpen: designSystem.tokensRackOpen,
    setTokensRackOpen: designSystem.setTokensRackOpen,
    closeTokensRack: designSystem.closeTokensRack,
    closePagesRack: toolShell.closePagesRack,
    closeComponentRack: toolShell.closeComponentRack,
    resetAllPanelWidths: panelResize.resetAllPanelWidths,
    motionOpen: motion.motionOpen,
    toggleMotionOpen: motion.toggleMotionOpen,
    setOpenMenu: toolShell.setOpenMenu,
    setToolRackOpen: toolShell.setToolRackOpen,
    setActiveEditorId,
    setCodeWorkspaceOpen: toolShell.setCodeWorkspaceOpen,
    onResetComponentView: () => windows.centerComponentCanvasView(componentDocument?.width ?? 420, componentDocument?.height ?? 280),
    onCommitProjectName: pageActions.commitProjectName,
    setNotice,
  });
  chromeActionsRef.current = chromeActions;
  setProjectNameEditingRef.current = chromeActions.setProjectNameEditing;

  // Window visibility computation
  const mainCanvasVisible = !windows.canvasClosed && !windows.canvasMinimized
    && !(windows.componentCanvasOpen && !windows.componentCanvasFloating && !windows.canvasFloating)
    && !(windows.nodeLogicOpen && !windows.nodeLogicFloating && !windows.canvasFloating);
  const nodeLogicCoversDockedComponent = windows.nodeLogicOpen && !windows.nodeLogicFloating
    && !windows.componentCanvasFloating
    && getWindowZIndex(windows.windowOrder, 'node-logic') > getWindowZIndex(windows.windowOrder, 'component-canvas');
  const componentCanvasVisible = !windows.componentCanvasClosed && !windows.componentCanvasMinimized && !nodeLogicCoversDockedComponent;
  const pendingOpenComponentName = componentMaster.pendingComponentOpenId
    ? (state.project.components.find((item) => item.id === componentMaster.pendingComponentOpenId)?.name ?? 'another master')
    : null;

  return (
    <div
      ref={appShellRef}
      class={`app-shell ${windows.layersVisible ? '' : 'layers-hidden'} ${windows.inspectorVisible ? '' : 'inspector-hidden'} ${motion.motionOpen ? 'has-motion-timeline' : ''} ${isHydrating ? 'is-hydrating' : ''} ${panelResize.resizingPanel ? 'is-resizing-panel' : ''}`}
      style={{
        '--layers-panel-width': `${panelResize.panelWidthsRef.current.layers}px`,
        '--inspector-panel-width': `${panelResize.panelWidthsRef.current.inspector}px`,
      } as JSX.CSSProperties}
      data-active-window={windows.activeWindowId}
      aria-busy={isHydrating}
      onMouseLeave={() => {
        if (panelResize.resizingPanelRef.current === null) toolShell.toolbarHintStore.setHint(DEFAULT_TOOLBAR_HINT);
      }}
      onKeyDown={(event) => {
        if (isHydrating) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <GlobalToolbar
        projectName={state.project.metadata.name}
        isHydrating={isHydrating}
        openMenu={toolShell.openMenu}
        menuActions={globalMenuActions}
        menuBarRef={toolShell.menuBarRef}
        projectFileInputRef={toolShell.projectFileInputRef}
        pagesRackToggleRef={toolShell.pagesRackToggleRef}
        componentRackToggleRef={toolShell.componentRackToggleRef}
        tokensRackToggleRef={designSystem.tokensRackToggleRef}
        projectNameEditing={chromeActions.projectNameEditing}
        projectNameDraft={chromeActions.projectNameDraft}
        pagesRackOpen={windows.pagesRackOpen}
        componentRackOpen={windows.componentRackOpen}
        tokensRackOpen={designSystem.tokensRackOpen}
        layersVisible={windows.layersVisible}
        inspectorVisible={windows.inspectorVisible}
        canvasClosed={windows.canvasClosed}
        canvasMinimized={windows.canvasMinimized}
        componentCanvasOpen={windows.componentCanvasOpen}
        componentCanvasClosed={windows.componentCanvasClosed}
        componentCanvasMinimized={windows.componentCanvasMinimized}
        nodeLogicOpen={windows.nodeLogicOpen}
        nodeLogicClosed={windows.nodeLogicClosed}
        nodeLogicMinimized={windows.nodeLogicMinimized}
        codeWorkspaceOpen={toolShell.codeWorkspaceOpen}
        motionTimelineOpen={motion.motionOpen}
        shortcutsModalOpen={dialogs.shortcutsModalOpen}
        projectLibraryOpen={dialogs.projectLibraryOpen}
        toolbarHintStore={toolShell.toolbarHintStore}
        onToggleMenu={(menu) => { toolShell.setOpenMenu((current) => (current === menu ? null : menu)); toolShell.setToolRackOpen(null); }}
        onCloseMenus={() => toolShell.setOpenMenu(null)}
        onRequestNewProject={dialogs.openNewProjectDialog}
        onOpenProjectPicker={() => { if (isHydrating) return; toolShell.setOpenMenu(null); toolShell.projectFileInputRef.current?.click(); }}
        onProjectFileSelected={fileLifecycle.handleProjectFileSelected}
        onExportCurrentProject={() => { void fileLifecycle.exportCurrentProject(isHydrating); }}
        onExportCurrentProjectArchive={() => { void fileLifecycle.exportCurrentProjectArchive(isHydrating); }}
        onOpenProjectLibrary={dialogs.openProjectLibrary}
        onExportActiveCanvasSvg={() => { void fileLifecycle.exportActiveCanvasSvg(isHydrating); }}
        onExportActiveCanvasPng={() => { void fileLifecycle.exportActiveCanvasPng(isHydrating); }}
        onOpenMotionExport={() => toolShell.setMotionExportOpen(true)}
        onResetWindowLayout={chromeActions.resetWindowLayout}
        onOpenShortcutsModal={dialogs.openShortcutsModal}
        onOpenDiagnosticsModal={() => dialogs.setDiagnosticsModalOpen(true)}
        onStartProjectRename={chromeActions.startProjectRename}
        onProjectNameDraftChange={chromeActions.setProjectNameDraft}
        onCommitProjectRename={chromeActions.commitProjectRename}
        onCancelProjectRename={chromeActions.cancelProjectRename}
        onTogglePagesRack={chromeActions.togglePagesRack}
        onToggleComponentRack={chromeActions.toggleComponentRack}
        onToggleTokensRack={chromeActions.toggleTokensRack}
        onToggleLayersVisible={() => windows.setLayersVisible((value) => !value)}
        onToggleInspectorVisible={() => windows.setInspectorVisible((value) => !value)}
        onToggleMainCanvas={chromeActions.toggleMainCanvas}
        onToggleComponentCanvas={chromeActions.toggleComponentCanvas}
        onToggleNodeLogic={chromeActions.toggleNodeLogic}
        onToggleCodeWorkspace={() => toolShell.setCodeWorkspaceOpen((open) => { if (!open) setActiveEditorId('main'); return !open; })}
        onToggleMotionTimeline={chromeActions.toggleMotionTimeline}
        onEnterFullscreen={chromeActions.enterFullscreen}
        onUpdateToolbarHint={toolShell.updateToolbarHint}
      />

      <WorkspacePreferencesRecoveryBanner
        status={windows.initialWorkspacePreferences.status}
        reviewRequired={windows.workspacePreferencesReviewRequired}
        onApprove={windows.approveWorkspacePreferencesReview}
      />

      <ToolRail
        toolRailRef={toolShell.toolRailRef}
        activeEditorId={activeEditorId}
        activeCanvasToolId={toolShell.activeCanvasToolId}
        toolGroups={toolShell.activeToolGroups}
        resolveTool={getStudioTool}
        toolRackOpen={toolShell.toolRackOpen}
        templateInsertMode={pageActions.templateInsertMode}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        colorSwatch={{
          fillColor: toolShell.toolOptions.fillColor,
          strokeColor: toolShell.toolOptions.strokeColor,
          strokeWidth: toolShell.toolOptions.strokeWidth,
          onChangeFill: (color) => activeStudioActions.onApplySwatch(color, 'fill'),
          onChangeStroke: (color) => activeStudioActions.onApplySwatch(color, 'stroke'),
          onSwap: activeStudioActions.onSwapFillAndStroke,
          onResetDefault: activeStudioActions.onResetDefaultColors,
        }}
        onCloseTopMenus={() => toolShell.setOpenMenu(null)}
        onToggleToolRack={toolShell.setToolRackOpen}
        onChooseTool={(toolId) => toolShell.chooseCanvasTool(toolId, activeEditorId)}
        onTemplateInsertModeChange={pageActions.setTemplateInsertMode}
        onInsertTemplate={pageActions.insertTemplate}
        onUndo={() => focusedCommandClient.undo()}
        onRedo={() => focusedCommandClient.redo()}
        onUpdateToolbarHint={toolShell.updateToolbarHint}
      />

      <LayersPanel
        visible={windows.layersVisible}
        width={panelResize.panelWidths.layers}
        isResizing={panelResize.resizingPanel === 'layers'}
        resizeHandleRef={panelResize.layersResizeHandleRef}
        activeEditorId={activeEditorId}
        focusedPageId={focusedPage?.id ?? undefined}
        layerContextLabel={layerContextLabel}
        layerContextTitle={layerContextTitle}
        layerSourceNodes={layers.layerSourceNodes}
        layerRows={layers.layerRows}
        layerEffectiveStates={layers.layerEffectiveStates}
        selectedNodeIds={focusedEditor.state.selectedNodeIds}
        collapsedLayerIds={layers.activeCollapsedLayers ?? []}
        layerDropTarget={layers.layerDropTarget}
        layerRename={layers.layerRename}
        layerRenameInputRef={layers.layerRenameInputRef}
        layerColorPickerKey={layers.layerColorPickerKey}
        searchQuery={layers.layerSearchQuery}
        isSearchActive={layers.isSearchActive}
        searchMatchedIds={layers.searchMatchedIds}
        searchMatchCount={layers.searchMatchCount}
        onSearchQueryChange={layers.setLayerSearchQuery}
        onStartResize={panelResize.startPanelResize}
        onResizeDoubleClick={panelResize.handlePanelResizeDoubleClick}
        onResizeKeyDown={panelResize.handlePanelResizeKeyDown}
        onHoverHint={() => toolShell.updateToolbarHint(
          'LAYERS',
          'Each Layer is one object. Drag an object that is off Canvas to restore it; an object already on Canvas cannot be duplicated by dragging.',
          ['CTRL/CMD + M: MASK', 'CTRL/CMD + SHIFT + M: UNMASK'],
        )}
        onSelectLayer={layers.selectLayerFromPanel}
        onOpenContextMenu={layers.openLayerContextMenu}
        onStartDrag={layers.startLayerDrag}
        onDragOver={layers.updateLayerDropTarget}
        onDrop={layers.dropLayer}
        onDragEnd={layers.endLayerDrag}
        onDragLeave={layers.clearLayerDropTarget}
        onToggleCollapsed={layers.toggleLayerCollapsed}
        onUpdateRenameDraft={layers.updateLayerRenameDraft}
        onFinishRename={layers.finishLayerRename}
        onToggleColorPicker={layers.toggleLayerColorPicker}
        onToggleLayerProperty={layers.toggleLayerPropertyFromRow}
        components={state.project.components}
        onUnpackComponentInstance={(nodeId) => selectionActions.unpackComponentInstance(activeEditorId, nodeId)}
        canPaste={clipboardRef.current !== null}
        onPasteLayers={() => selectionActions.pasteSelection(activeEditorId)}
        onSelectAllLayers={() => focusedCommandClient.selectNodes(focusedDocument.nodes.map((node) => node.id), 'Select all layers')}
        onQuickAddLayer={(kind) => pageActions.addNode(kind)}
      />

      <MainCanvasWindow
        visible={mainCanvasVisible}
        minimized={windows.canvasMinimized}
        closed={windows.canvasClosed}
        floating={windows.canvasFloating}
        position={windows.canvasPosition}
        size={windows.canvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'main-canvas')}
        document={mainCanvasDocument}
        components={state.project.components}
        designTokens={designSystem.designTokens}
        assets={state.project.assets}
        activeBreakpoint={designSystem.activeBreakpoint}
        onChangeBreakpoint={designSystem.setActiveBreakpoint}
        selectedNodeIds={state.selectedNodeIds}
        selectedNodes={activeDocument.nodes.filter((node) => state.selectedNodeIds.includes(node.id))}
        toolId={toolShell.workspaceTools.main}
        toolOptions={toolShell.toolOptions}
        zoom={windows.zoom}
        pan={windows.mainView.pan}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        onPositionChange={windows.setCanvasPosition}
        onSizeChange={windows.setCanvasSize}
        onFocus={() => { windows.focusWindow('main-canvas'); setActiveEditorId('main'); selectionSourceRef.current = 'canvas'; }}
        onFocusMinimized={() => { windows.focusWindow('main-canvas'); setActiveEditorId('main'); }}
        onHoverHint={() => toolShell.updateToolbarHint('CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
        onAlign={(alignment) => selectionActions.alignSelection(alignment, 'main')}
        onDistribute={(axis) => selectionActions.distributeSelection(axis, 'main')}
        onUndo={() => focusedCommandClient.undo()}
        onRedo={() => focusedCommandClient.redo()}
        onZoomChange={windows.setZoom}
        onResetView={windows.resetMainView}
        onMinimize={() => windows.setCanvasMinimized(true)}
        onRestore={() => windows.setCanvasMinimized(false)}
        onToggleFloating={() => windows.setCanvasWindowMode(windows.canvasFloating ? 'docked' : 'floating')}
        onClose={() => { windows.setCanvasClosed(true); windows.setCanvasMinimized(false); windows.setCanvasWindowMode('docked'); }}
        onCloseMinimized={() => { windows.setCanvasClosed(true); windows.setCanvasMinimized(false); }}
        onChangeToolOptions={toolShell.updateToolOptions}
        onPathfinder={(op) => selectionActions.handlePathfinder('main', op)}
        onConvertToPath={() => selectionActions.handleConvertToPath('main')}
        onFlip={(axis) => selectionActions.handleFlipSelection('main', axis)}
        onRotate90={() => selectionActions.handleRotate90('main')}
        onSimplifyPath={() => selectionActions.handleSimplifyPath('main')}
        onTogglePathClosed={() => selectionActions.handleTogglePathClosed('main')}
        onSelectTool={(nextTool) => toolShell.chooseCanvasTool(nextTool, 'main')}
        onToolOperation={(operation) => motionAutoKeyBridge.executeMainToolOperations([operation])}
        onToolOperationBatch={(operations) => motionAutoKeyBridge.executeMainToolOperations(operations)}
        onLayerDrop={(nodeIds) => layers.dropLayersOnCanvas(nodeIds, 'main')}
        onDropImageFiles={(files, point) => { void handleInsertImageFiles(files, 'main', point); }}
        onChangeBackground={(background) => { mainCommandClient.setDocumentBackground(background); }}
        animationTimeMs={effectiveMainAnimationTimeMs}
        hasAnimatedComponents={hasAnimatedComponentsOnMain}
        componentAnimPlaying={componentAnimPlaying}
        onToggleComponentAnimPlaying={toggleComponentAnimPlaying}
        studioActions={selectionActions.createStudioActionsForTarget('main')}
        canvasContextMenuExtras={mainCanvasContextMenuExtras}
        motionPaths={activeEditorId === 'main' ? pathStudio.activeCanvasMotionPaths : undefined}
        motionPathSpacingDotsByNodeId={activeEditorId === 'main' ? pathStudio.motionPathSpacingDotsByNodeId : undefined}
        selectedMotionPathPoint={activeEditorId === 'main' ? pathStudio.selectedMotionPathPoint : null}
        onSelectMotionPathPoint={pathStudio.setSelectedMotionPathPoint}
        onUpdateMotionPath={activeEditorId === 'main' ? pathStudio.handleUpdateCanvasMotionPath : undefined}
        showMorphCorrespondence={activeEditorId === 'main' && motion.motionOpen && pathStudio.showMorphCorrespondence}
        morphCorrespondenceMetaByNodeId={activeEditorId === 'main' ? pathStudio.morphCorrespondenceMetaByNodeId : undefined}
        onPickMorphStartVertex={activeEditorId === 'main' && motion.motionOpen ? pathStudio.handlePickMorphStartVertex : undefined}
        nodeOverrides={
          logicRuntimeState &&
          (logicRuntimeState.scope === 'project' ||
            (logicRuntimeState.scope === 'page' &&
              (!logicRuntimeState.targetId || logicRuntimeState.targetId === activePageId)))
            ? logicRuntimeState.nodeOverrides
            : undefined
        }
      />

      <WorkspaceSecondaryWindowsHost
        project={state.project}
        activePageId={activePageId}
        activeEditorId={activeEditorId}
        componentDocument={componentDocument}
        componentCanvasDocument={componentCanvasDocument}
        componentSelectedNodeIds={componentState.selectedNodeIds}
        componentCanUndo={componentState.past.length > 0}
        componentCanRedo={componentState.future.length > 0}
        componentCanvasVisible={componentCanvasVisible}
        pendingOpenComponentName={pendingOpenComponentName}
        mainCommandClient={mainCommandClient}
        componentCommandClient={componentCommandClient}
        selectionSourceRef={selectionSourceRef}
        windows={windows}
        toolShell={toolShell}
        designSystem={designSystem}
        layers={layers}
        selectionActions={selectionActions}
        componentMaster={componentMaster}
        quickInteractions={quickInteractions}
        motion={motion}
        motionAutoKeyBridge={motionAutoKeyBridge}
        pathStudio={pathStudio}
        componentCanvasContextMenuExtras={componentCanvasContextMenuExtras}
        onSetActiveEditorId={setActiveEditorId}
        onInsertImageFiles={handleInsertImageFiles}
        onNotice={setNotice}
        componentNodeOverrides={
          logicRuntimeState &&
          logicRuntimeState.scope === 'component' &&
          componentMaster.editingComponent &&
          componentMaster.editingComponent.id === logicRuntimeState.targetId
            ? logicRuntimeState.nodeOverrides
            : undefined
        }
        onRuntimeSnapshotChange={handleLogicRuntimeSnapshotChange}
      />

      <WorkspaceInspectorHost
        project={state.project}
        activePageId={activePageId}
        focusedDocument={focusedDocument}
        activeEditorId={activeEditorId}
        inspectorSelectedNode={inspectorSelectedNode}
        inspectorSelectedNodes={inspectorSelectedNodes}
        selectedInstanceComponent={selectedInstanceComponent}
        instanceOverrideTargets={instanceOverrideTargets}
        canRemoveFromCanvas={selectionSourceRef.current !== 'layers'}
        toolOptions={toolShell.toolOptions}
        mainCommandClient={mainCommandClient}
        componentCommandClient={componentCommandClient}
        focusedCommandClient={focusedCommandClient}
        windows={windows}
        panelResize={panelResize}
        designSystem={designSystem}
        selectionActions={selectionActions}
        pageActions={pageActions}
        componentMaster={componentMaster}
        quickInteractions={quickInteractions}
        motion={motion}
        motionAutoKeyBridge={motionAutoKeyBridge}
        pathStudio={pathStudio}
        activeStudioActions={activeStudioActions}
        onChooseTool={toolShell.chooseCanvasTool}
        onUpdateToolOptions={toolShell.updateToolOptions}
        onUpdateToolbarHint={toolShell.updateToolbarHint}
        onInsertImageFiles={handleInsertImageFiles}
        onImportFontFiles={handleImportFontFiles}
      />

      <PagesRackPanel
        panelRef={toolShell.pagesRackRef} open={windows.pagesRackOpen} pages={pages} activePageId={activePageId}
        applications={projectApplications} activeApplicationId={activeApplication.id}
        onSelectApplication={pageActions.switchApplication} onCreateApplication={pageActions.addApplication}
        pageNameDraft={pageActions.pageNameDraft} onFocus={() => windows.focusWindow('pages')}
        onPageNameDraftChange={pageActions.setPageNameDraft} onAddPage={pageActions.addPage}
        onSwitchPage={pageActions.switchPage} onClose={toolShell.closePagesRack} onNotice={setNotice}
      />

      <ComponentRackPanel
        panelRef={toolShell.componentRackRef} open={windows.componentRackOpen} components={ownedComponents}
        activeApplicationId={activeApplication.id} activeApplicationName={activeApplication.name}
        onSetComponentScope={componentMaster.setComponentScope}
        designTokens={designSystem.designTokens} assets={state.project.assets} searchQuery={toolShell.componentRackSearch}
        canSaveSelection={selectedNodes.length > 0} renamingComponentId={componentMaster.renamingComponentId}
        componentNameDraft={componentMaster.componentNameDraft} onSearchChange={toolShell.setComponentRackSearch}
        onCreateNewMaster={componentMaster.createNewMasterComponent}
        onSaveSelection={() => componentMaster.saveNodesAsComponent(focusedEditor.selectedNodes, focusedDocument.nodes)}
        onClose={toolShell.closeComponentRack} onInsertComponent={pageActions.insertOwnedComponent}
        onEditMaster={componentMaster.openMasterComponent}
        onStartRename={(c) => { componentMaster.setRenamingComponentId(c.id); componentMaster.setComponentNameDraft(c.name); }}
        onRenameDraftChange={componentMaster.setComponentNameDraft} onCommitRename={componentMaster.renameComponent}
        onCancelRename={() => componentMaster.setRenamingComponentId(null)} onDuplicateComponent={componentMaster.duplicateComponent}
        onDeleteComponent={(component) => { void componentMaster.deleteComponent(component); }}
        onToggleNodeLogic={(component) => designSystem.toggleComponentNodeLogic(component)}
      />

      <StatusBar
        layerCount={activeDocument.nodes.length}
        documentWidth={activeDocument.width}
        documentHeight={activeDocument.height}
        isHydrating={isHydrating}
        saveStatus={fileLifecycle.saveStatus}
        componentSaveStatus={componentMaster.componentSaveStatus}
        componentSaveError={componentMaster.componentSaveError}
        componentCleanupPending={componentMaster.componentCleanupPending}
        onRetryComponentSave={componentMaster.retryComponentCanvasSave}
        onRetryComponentCleanup={() => { void componentMaster.retryComponentBufferCleanup(); }}
      />

      <WorkspaceShellOverlays
        project={state.project}
        activePage={activePage}
        pages={pages}
        activeDocument={activeDocument}
        componentDocument={componentDocument}
        activeEditorId={activeEditorId}
        selectedMainNodeId={state.selectedNodeId}
        mainSelectedNodeIds={state.selectedNodeIds}
        componentSelectedNodeIds={componentState.selectedNodeIds}
        historyUndoCount={state.past.length}
        historyRedoCount={state.future.length}
        isHydrating={isHydrating}
        canPaste={clipboardRef.current !== null}
        notice={notice}
        mainCommandClient={mainCommandClient}
        focusedCommandClient={focusedCommandClient}
        getCommandClient={getCommandClient}
        selectionSourceRef={selectionSourceRef}
        activeMotionPage={activeMotionPage}
        activeMotionProject={activeMotionProject}
        motionExportProject={motionExportProject}
        activeMotionSelectedNodeIds={activeMotionSelectedNodeIds}
        windows={windows}
        toolShell={toolShell}
        designSystem={designSystem}
        layers={layers}
        selectionActions={selectionActions}
        componentMaster={componentMaster}
        dialogs={dialogs}
        fileLifecycle={fileLifecycle}
        motion={motion}
        pathStudio={pathStudio}
        onSetActiveEditorId={setActiveEditorId}
        onDeleteLayersSafely={deleteLayersSafely}
        onNotice={setNotice}
      />
    </div>
  );
}

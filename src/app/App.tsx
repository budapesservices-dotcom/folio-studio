import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { createInitialProject } from '../core/document/factory';
import { getActiveApplication, getProjectApplications } from '../core/document/applications';
import { getComponentOverrideTargets } from '../core/document/components';
import { findCrossStudioNodeReferences, formatLayerDeletionCleanupNotice } from '../core/document/nodeReferenceCleanup';
import { getActiveDocument, getActivePage } from '../core/document/project';
import {
  getStudioTool,
  getStudioToolGroupsForWorkspace,
  isToolAvailableInWorkspace,
} from '../engines/canvas/tools/studioRegistry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolId,
  type CanvasToolOptions,
} from '../engines/canvas/tools/types';
import type { MotionPathBinding } from '../core/document/types';
import {
  applyMotionPathEditAtTime,
  evaluateMotionPathBindingAtTime,
} from '../core/document/pathStudio';
import { parsePathMorphSnapshot } from '../core/document/pathMorph';
import type { MorphCorrespondenceMeta, MotionPathPointSelection } from '../engines/canvas/MotionPathOverlay';
import { evaluateEasing, upsertMotionPathInClip } from '../engines/animation';
import { InspectorPanel } from './InspectorPanel';
import type { StudioClipboardPayload } from './nodeClipboard';
import { createEditorState } from './editorReducer';
import { createCanonicalEditorStore } from './editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from './mainCanvasCommandClient';
import { getActiveEditorContext, type EditorTarget } from './editorContext';
import { getWindowZIndex } from './windowManager';
import { createToolbarHintStore, DEFAULT_TOOLBAR_HINT } from './ToolbarHintBar';
import { StudioIcon } from './workspace/StudioIcon';
import { useWorkspaceWindows } from './workspace/useWorkspaceWindows';
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
import { GlobalToolbar, WorkspacePreferencesRecoveryBanner, type TopMenuId } from './workspace/GlobalToolbar';
import { buildGlobalToolbarMenuActions } from './workspace/globalMenuActions';
import { createInteractiveStarterProject } from './workspace/starterProject';
import type { CodeWorkspaceViewMode } from './workspace/useCodeWorkspace';
import { ToolRail } from './workspace/ToolRail';
import { LayersPanel } from './workspace/LayersPanel';
import { ComponentCanvasWindow, MainCanvasWindow, NodeLogicWindow } from './workspace/CanvasWindows';
import { PagesRackPanel } from './workspace/PagesRackPanel';
import { ComponentRackPanel } from './workspace/ComponentRackPanel';
import { StatusBar } from './workspace/StatusBar';
import { ComponentDeletionDialog, ProjectHydrationOverlay } from './workspace/ComponentDeletionDialog';
import { buildCanvasContextMenuExtras, buildWorkspaceToolExecutor } from './workspace/canvasContextMenuExtras';
import { useQuickInteractionActions } from './workspace/useQuickInteractionActions';
import { WorkspaceModals } from './workspace/WorkspaceModals';
import { WorkspaceStudioOverlays } from './workspace/WorkspaceStudioOverlays';

export function App() {
  const [activeEditorId, setActiveEditorId] = useState<EditorTarget>('main');
  const [notice, setNotice] = useState('');
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const commandRejectNoticeRef = useRef<(message: string) => void>(() => {});
  commandRejectNoticeRef.current = setNotice;

  // Canonical stores & Native Command Engine clients
  const initialEditorState = useMemo(() => createEditorState(createInteractiveStarterProject('First canvas')), []);
  const canonicalStore = useMemo(() => createCanonicalEditorStore(initialEditorState), []);
  const [state, setState] = useState(() => canonicalStore.getSnapshot().editorState);
  const syncStateFromStore = useCallback(() => {
    const next = canonicalStore.getSnapshot().editorState;
    setState((current) => (current === next ? current : next));
  }, [canonicalStore]);
  useEffect(() => canonicalStore.subscribe(syncStateFromStore), [canonicalStore, syncStateFromStore]);
  const mainCommandClient = useMemo(() => createMainCanvasCommandClient(canonicalStore, {
    onRejected: (result) => commandRejectNoticeRef.current(result.message),
  }), [canonicalStore]);

  const componentInitialState = useMemo(() => {
    const project = createInitialProject('Component Canvas');
    project.metadata.id = 'folio-component-canvas';
    const page = getActivePage(project);
    page.name = 'Component Canvas';
    page.document.name = 'Component Canvas';
    page.document.width = 420;
    page.document.height = 280;
    page.document.nodes = [];
    return createEditorState(project);
  }, []);
  const componentStore = useMemo(() => createCanonicalEditorStore(componentInitialState, { workspace: 'component' }), [componentInitialState]);
  const [componentState, setComponentState] = useState(() => componentStore.getSnapshot().editorState);
  const syncComponentStateFromStore = useCallback(() => {
    const next = componentStore.getSnapshot().editorState;
    setComponentState((current) => (current === next ? current : next));
  }, [componentStore]);
  useEffect(() => componentStore.subscribe(syncComponentStateFromStore), [componentStore, syncComponentStateFromStore]);
  const componentCommandClient = useMemo(() => createComponentCanvasCommandClient(componentStore, {
    onRejected: (result) => commandRejectNoticeRef.current(result.message),
  }), [componentStore]);
  const getCommandClient = useCallback((target: EditorTarget) => (target === 'main' ? mainCommandClient : componentCommandClient), [mainCommandClient, componentCommandClient]);

  // Workspace windows, layout preferences & view persistence
  const windows = useWorkspaceWindows({ setActiveEditorId, setNotice });

  // Panel resize controller (Layers & Inspector)
  const panelResize = usePanelResizeController({
    appShellRef,
    layersVisible: windows.layersVisible,
    inspectorVisible: windows.inspectorVisible,
  });

  // Racks focus-return helpers
  const pagesRackRef = useRef<HTMLElement | null>(null);
  const componentRackRef = useRef<HTMLElement | null>(null);
  const pagesRackToggleRef = useRef<HTMLButtonElement | null>(null);
  const componentRackToggleRef = useRef<HTMLButtonElement | null>(null);

  const closePagesRack = useCallback(() => {
    if (pagesRackRef.current?.contains(document.activeElement)) pagesRackToggleRef.current?.focus({ preventScroll: true });
    windows.setPagesRackOpen(false);
  }, [windows.setPagesRackOpen]);

  const closeComponentRack = useCallback(() => {
    if (componentRackRef.current?.contains(document.activeElement)) componentRackToggleRef.current?.focus({ preventScroll: true });
    windows.setComponentRackOpen(false);
  }, [windows.setComponentRackOpen]);

  // Menus, tool rack, shortcuts modal, and project/page drafts
  const toolbarHintStore = useMemo(() => createToolbarHintStore(), []);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const toolRailRef = useRef<HTMLElement | null>(null);
  const [openMenu, setOpenMenu] = useState<TopMenuId | null>(null);
  const [toolRackOpen, setToolRackOpen] = useState<string | null>(null);
  const [codeWorkspaceOpen, setCodeWorkspaceOpen] = useState(false);
  const [motionExportOpen, setMotionExportOpen] = useState(false);
  const [codeWorkspaceLaunch, setCodeWorkspaceLaunch] = useState<{ viewMode: CodeWorkspaceViewMode; pageId?: string; nonce: number }>({ viewMode: 'code', nonce: 0 });
  const [workspaceTools, setWorkspaceTools] = useState<Record<EditorTarget, CanvasToolId>>({ main: 'select', component: 'select' });
  const [toolOptions, setToolOptions] = useState<CanvasToolOptions>(DEFAULT_CANVAS_TOOL_OPTIONS);
  const [componentRackSearch, setComponentRackSearch] = useState('');
  const [selectedMotionPathPoint, setSelectedMotionPathPoint] = useState<MotionPathPointSelection | null>(null);
  const [showMorphCorrespondence, setShowMorphCorrespondence] = useState(false);
  const selectionSourceRef = useRef<'layers' | 'canvas'>('canvas');
  const clipboardRef = useRef<StudioClipboardPayload | null>(null);
  const setProjectNameEditingRef = useRef<(editing: boolean) => void>(() => {});
  const chromeActionsRef = useRef<ReturnType<typeof useWorkspaceChromeActions> | null>(null);

  // Derived active documents
  const activeDocument = getActiveDocument(state.project);
  const componentDocument = getActiveDocument(componentState.project);

  // Stable canonical store callbacks for project hydration & autosave
  const editingComponentIdRef = useRef<string | null>(null);
  const resetEditingComponentRef = useRef<() => void>(() => {});
  const activeBreakpointRef = useRef<'desktop' | 'tablet' | 'mobile'>('desktop');
  const getCanonicalRevision = useCallback(() => canonicalStore.getSnapshot().projectRevision, [canonicalStore]);
  const getCanonicalProject = useCallback(() => canonicalStore.getSnapshot().editorState.project, [canonicalStore]);
  const subscribeCanonicalStore = useCallback(
    (listener: () => void) => canonicalStore.subscribe(listener),
    [canonicalStore],
  );
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
    setFileMenuOpen: (open) => setOpenMenu(open ? 'file' : null),
    setNotice,
  });

  // Component Canvas master sync, buffer protection & durable deletion lifecycle
  const componentMaster = useComponentMasterLifecycle({
    canonicalStore,
    mainCommandClient,
    componentCommandClient,
    state,
    componentState,
    componentInitialProject: componentInitialState.project,
    isProjectLoaded: fileLifecycle.isProjectLoaded,
    appShellRef,
    focusWindow: windows.focusWindow,
    setActiveEditorId,
    setComponentCanvasClosed: windows.setComponentCanvasClosed,
    setComponentCanvasMinimized: windows.setComponentCanvasMinimized,
    setInspectorVisible: windows.setInspectorVisible,
    setComponentRackOpen: windows.setComponentRackOpen,
    closePagesRack,
    closeComponentRack,
    onCenterComponentCanvas: windows.centerComponentCanvasView,
    setNotice,
  });

  editingComponentIdRef.current = componentMaster.editingComponentId;
  resetEditingComponentRef.current = () => componentMaster.setEditingComponentId(null);

  const isHydrating = !fileLifecycle.isProjectLoaded || !componentMaster.componentReady;

  // Derived active workspace context
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;
  const projectApplications = getProjectApplications(state.project);
  const activeApplication = getActiveApplication(state.project);
  const ownedComponents = state.project.components;
  const focusedEditor = getActiveEditorContext(activeEditorId, state, componentState);
  const focusedDocument = focusedEditor.document;
  const focusedPage = activeEditorId === 'main' ? getActivePage(state.project) : null;
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

  // Layers panel controller (collapse, drag/drop, context menu, inline rename, color picker)
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

  const dismissPopoversForDialog = useCallback(() => {
    setOpenMenu(null);
    setToolRackOpen(null);
    layers.setLayerContextMenu(null);
  }, [layers.setLayerContextMenu]);

  const handleAfterNewProjectReset = useCallback(() => {
    setCodeWorkspaceOpen(false);
    setMotionExportOpen(false);
    setProjectNameEditingRef.current(false);
    windows.openMainCanvas();
  }, [windows]);

  const dialogs = useWorkspaceDialogs({
    isHydrating,
    onDismissPopovers: dismissPopoversForDialog,
    onCreateNewProject: fileLifecycle.createNewProject,
    onAfterNewProjectReset: handleAfterNewProjectReset,
  });

  useWorkspaceChromeEffects({
    notice,
    setNotice,
    openMenu,
    setOpenMenu,
    menuBarRef,
    toolRackOpen,
    setToolRackOpen,
    toolRailRef,
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

  const updateToolbarHint = useCallback((panel: string, description: string, shortcuts: string[] = []) => {
    if (panelResize.resizingPanelRef.current !== null) return;
    toolbarHintStore.setHint({ panel, description, shortcuts });
  }, [toolbarHintStore, panelResize.resizingPanelRef]);

  const activeCanvasToolId = workspaceTools[activeEditorId];
  const activeToolGroups = getStudioToolGroupsForWorkspace(activeEditorId);

  const setWorkspaceToolId = (target: EditorTarget, toolId: CanvasToolId) => {
    const resolvedToolId = isToolAvailableInWorkspace(toolId, target) ? toolId : 'select';
    setWorkspaceTools((current) => (
      current[target] === resolvedToolId ? current : { ...current, [target]: resolvedToolId }
    ));
  };

  const updateToolOptions = (patch: Partial<CanvasToolOptions>) => {
    setToolOptions((current) => ({ ...current, ...patch }));
  };

  const quickInteractions = useQuickInteractionActions({ project: state.project, mainCommandClient, openNodeLogic: windows.openNodeLogic, setNotice });

  const chooseCanvasTool = (toolId: CanvasToolId, target: EditorTarget = activeEditorId) => {
    const resolvedToolId = isToolAvailableInWorkspace(toolId, target) ? toolId : 'select';
    const tool = getStudioTool(resolvedToolId);
    setWorkspaceToolId(target, resolvedToolId);
    setToolRackOpen(null);
    updateToolbarHint(
      tool.label.toUpperCase(),
      tool.description,
      tool.shortcut ? [`KEY: ${tool.shortcut.toUpperCase()}`] : [],
    );
  };

  // Selection, alignment, vector pathfinder & clipboard actions
  const selectionActions = useSelectionAndVectorActions({
    activeEditorId, isHydrating, state, componentState, selectedNode, selectedNodes,
    editingComponentId: componentMaster.editingComponentId, toolOptions, onUpdateToolOptions: updateToolOptions,
    focusedCommandClient, getCommandClient, selectionSourceRef, clipboardRef,
    setWorkspaceToolId, setInspectorVisible: windows.setInspectorVisible, setNotice, openNodeLogic: windows.openNodeLogic,
  });
  const activeStudioActions = selectionActions.createStudioActionsForTarget(activeEditorId);

  // Document, Page, Template & Component insertion actions
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
    setWorkspaceTools,
    setToolRackOpen,
    setInspectorVisible: windows.setInspectorVisible,
    openMainCanvas: windows.openMainCanvas,
    closePagesRack,
    setNotice,
  });

  // Studio Google Fonts / @font-face loader & deduplicated image ingestion
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

  const applySampledColorOption = useCallback((color: string, colorTarget: 'fill' | 'stroke') => {
    setToolOptions((current) => ({
      ...current,
      ...(colorTarget === 'stroke' ? { strokeColor: color } : { fillColor: color }),
      brushColor: color,
      brushTokenId: undefined,
      paintBucketColor: color,
      paintBucketTokenId: undefined,
    }));
  }, []);

  const buildToolExecutor = (workspace: EditorTarget) => buildWorkspaceToolExecutor({
    workspace,
    commandClient: workspace === 'main' ? mainCommandClient : componentCommandClient,
    isHydrating,
    onMarkCanvasSelectionSource: () => { selectionSourceRef.current = 'canvas'; },
    onShowInspectorOnMain: () => windows.setInspectorVisible(true),
    onPanChange: workspace === 'main' ? windows.setMainPan : windows.setComponentCanvasPan,
    onZoomChange: workspace === 'main' ? windows.setZoom : windows.setComponentCanvasZoom,
    onToolChange: chooseCanvasTool,
    onNotice: setNotice,
    onSampledColorOptionChange: applySampledColorOption,
  });
  const mainToolOperationExecutor = buildToolExecutor('main');
  const componentToolOperationExecutor = buildToolExecutor('component');

  // Global keyboard shortcuts
  useWorkspaceShortcuts({
    activeEditorId, editingComponentId: componentMaster.editingComponentId, state, componentState, isHydrating,
    componentDeletionDialogOpen: componentMaster.componentDeletionDialogOpen,
    shortcutsModalOpen: dialogs.shortcutsModalOpen, newProjectDialogOpen: dialogs.newProjectDialogOpen,
    diagnosticsModalOpen: dialogs.diagnosticsModalOpen, projectLibraryOpen: dialogs.projectLibraryOpen, motionExportOpen,
    selectionSourceRef, clipboardRef, getCommandClient, openShortcutsModal: dialogs.openShortcutsModal,
    copySelection: selectionActions.copySelection, cutSelection: selectionActions.cutSelection,
    pasteSelection: selectionActions.pasteSelection, duplicateSelection: selectionActions.duplicateSelection,
    chooseCanvasTool, setNotice,
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

  const activePage = getActivePage(state.project);
  const deleteLayersSafely = useCallback((editorId: EditorTarget, nodeIds: string[]) => {
    const refs = editorId === 'main' ? findCrossStudioNodeReferences(state.project, nodeIds, activePage.id) : null;
    const names = editorId === 'main'
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
  }, [state.project, activePage, getCommandClient]);

  const globalMenuActions = buildGlobalToolbarMenuActions({
    activeEditorId,
    focusedDocument,
    focusedSelectedNodeIds: focusedEditor.state.selectedNodeIds,
    focusedSelectedNodes: focusedEditor.selectedNodes,
    canUndo: focusedEditor.state.past.length > 0,
    canRedo: focusedEditor.state.future.length > 0,
    hasClipboard: clipboardRef.current !== null,
    activeToolId: activeCanvasToolId,
    designTokens: designSystem.designTokens,
    focusedCommandClient,
    setActiveZoom: activeEditorId === 'main' ? windows.setZoom : windows.setComponentCanvasZoom,
    onResetView: activeEditorId === 'main'
      ? windows.resetMainView
      : () => windows.centerComponentCanvasView(
        componentDocument?.width ?? 420,
        componentDocument?.height ?? 280,
      ),
    onCut: selectionActions.cutSelection,
    onCopy: selectionActions.copySelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onSelectTool: chooseCanvasTool,
    onPathfinder: selectionActions.handlePathfinder,
    onCombineSelection: selectionActions.handleCombineSelection,
    onConvertToPath: selectionActions.handleConvertToPath,
    onRotate90: selectionActions.handleRotate90,
    onUpdateDesignTokens: designSystem.updateDesignTokens,
    onDeleteSelected: deleteLayersSafely,
    onNotice: setNotice,
  });
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
    onSampledColorOption: applySampledColorOption,
    onCanvasInteraction: () => { selectionSourceRef.current = 'canvas'; },
    onNotice: setNotice,
  });

  const mainCanvasContextMenuExtras = buildCanvasContextMenuExtras({
    workspace: 'main',
    documentNodes: activeDocument.nodes,
    selectedNodeIds: state.selectedNodeIds,
    canPaste: clipboardRef.current !== null,
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
    selectedNodeIds: componentState.selectedNodeIds,
    canPaste: clipboardRef.current !== null,
    commandClient: componentCommandClient,
    onCopy: selectionActions.copySelection,
    onCut: selectionActions.cutSelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onToggleLayerProperty: layers.toggleLayerPropertyFromRow,
    onUnpackComponent: selectionActions.unpackComponentInstance,
    onQuickAdd: pageActions.addNode,
  });

  const chromeActions = useWorkspaceChromeActions({
    projectName: state.project.metadata.name,
    windows,
    tokensRackOpen: designSystem.tokensRackOpen,
    setTokensRackOpen: designSystem.setTokensRackOpen,
    closeTokensRack: designSystem.closeTokensRack,
    closePagesRack,
    closeComponentRack,
    resetAllPanelWidths: panelResize.resetAllPanelWidths,
    motionOpen: motion.motionOpen,
    toggleMotionOpen: motion.toggleMotionOpen,
    setOpenMenu,
    setToolRackOpen,
    setActiveEditorId,
    setCodeWorkspaceOpen,
    onResetComponentView: () => windows.centerComponentCanvasView(componentDocument?.width ?? 420, componentDocument?.height ?? 280),
    onCommitProjectName: pageActions.commitProjectName,
    setNotice,
  });
  chromeActionsRef.current = chromeActions;
  setProjectNameEditingRef.current = chromeActions.setProjectNameEditing;

  const openLivePreviewForPage = useCallback((pageId?: string) => {
    setActiveEditorId('main');
    setCodeWorkspaceLaunch((current) => ({ viewMode: 'preview', pageId, nonce: current.nonce + 1 }));
    setCodeWorkspaceOpen(true);
  }, []);

  const activeCanvasMotionPaths = useMemo(
    () =>
      motion.motionOpen && motion.activeClip?.motionPaths && motion.activeClip.motionPaths.length > 0
        ? motion.activeClip.motionPaths.map((mp) =>
            evaluateMotionPathBindingAtTime(mp, motion.playheadMs, evaluateEasing),
          )
        : undefined,
    [motion.motionOpen, motion.activeClip?.motionPaths, motion.playheadMs],
  );

  const morphCorrespondenceMetaByNodeId = useMemo<Readonly<Record<string, MorphCorrespondenceMeta>> | undefined>(() => {
    if (!motion.motionOpen || !showMorphCorrespondence || !motion.activeClip) return undefined;
    const result: Record<string, MorphCorrespondenceMeta> = {};
    for (const track of motion.activeClip.tracks) {
      if (track.property !== 'pathMorph' || track.keyframes.length === 0) continue;
      const exact = track.keyframes.find((kf) => Math.abs(kf.timeMs - motion.playheadMs) <= 25);
      let activeKf = exact ?? track.keyframes[0];
      if (!exact) {
        for (const kf of track.keyframes) {
          if (kf.timeMs <= motion.playheadMs) activeKf = kf;
        }
      }
      if (typeof activeKf.value !== 'string') continue;
      const parsed = parsePathMorphSnapshot(activeKf.value);
      if (parsed?.morph) {
        result[track.targetNodeId] = {
          startOffset: parsed.morph.startOffset ?? 0,
          reverse: Boolean(parsed.morph.reverse),
        };
      }
    }
    return result;
  }, [motion.motionOpen, showMorphCorrespondence, motion.activeClip, motion.playheadMs]);

  const handleUpdateCanvasMotionPath = useCallback(
    (binding: MotionPathBinding, options?: { coalesceKey?: string; description?: string }) => {
      if (!motion.activeClip) return;
      const existing = motion.activeClip.motionPaths?.find(
        (mp) => mp.targetNodeId === binding.targetNodeId,
      );
      const nextBinding =
        existing && existing.pathKeyframes && existing.pathKeyframes.length > 0
          ? applyMotionPathEditAtTime(
              { ...existing, ...binding, pathKeyframes: existing.pathKeyframes },
              motion.playheadMs,
              binding.points,
              evaluateEasing,
            )
          : binding;
      const nextClip = upsertMotionPathInClip(motion.activeClip, nextBinding, {
        ensureProgressTrack: true,
      });
      motion.updateClip(nextClip, options?.description ?? 'Edit Motion Path', options?.coalesceKey);
    },
    [motion.activeClip, motion.playheadMs, motion.updateClip],
  );

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
        if (panelResize.resizingPanelRef.current === null) toolbarHintStore.setHint(DEFAULT_TOOLBAR_HINT);
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
        openMenu={openMenu}
        menuActions={globalMenuActions}
        menuBarRef={menuBarRef}
        projectFileInputRef={projectFileInputRef}
        pagesRackToggleRef={pagesRackToggleRef}
        componentRackToggleRef={componentRackToggleRef}
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
        codeWorkspaceOpen={codeWorkspaceOpen}
        motionTimelineOpen={motion.motionOpen}
        shortcutsModalOpen={dialogs.shortcutsModalOpen}
        projectLibraryOpen={dialogs.projectLibraryOpen}
        toolbarHintStore={toolbarHintStore}
        onToggleMenu={(menu) => { setOpenMenu((current) => (current === menu ? null : menu)); setToolRackOpen(null); }}
        onCloseMenus={() => setOpenMenu(null)}
        onRequestNewProject={dialogs.openNewProjectDialog}
        onOpenProjectPicker={() => { if (isHydrating) return; setOpenMenu(null); projectFileInputRef.current?.click(); }}
        onProjectFileSelected={fileLifecycle.handleProjectFileSelected}
        onExportCurrentProject={() => { void fileLifecycle.exportCurrentProject(isHydrating); }}
        onExportCurrentProjectArchive={() => { void fileLifecycle.exportCurrentProjectArchive(isHydrating); }}
        onOpenProjectLibrary={dialogs.openProjectLibrary}
        onExportActiveCanvasSvg={() => { void fileLifecycle.exportActiveCanvasSvg(isHydrating); }}
        onExportActiveCanvasPng={() => { void fileLifecycle.exportActiveCanvasPng(isHydrating); }}
        onOpenMotionExport={() => setMotionExportOpen(true)}
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
        onToggleCodeWorkspace={() => setCodeWorkspaceOpen((open) => { if (!open) setActiveEditorId('main'); return !open; })}
        onToggleMotionTimeline={chromeActions.toggleMotionTimeline}
        onEnterFullscreen={chromeActions.enterFullscreen}
        onUpdateToolbarHint={updateToolbarHint}
      />

      <WorkspacePreferencesRecoveryBanner
        status={windows.initialWorkspacePreferences.status}
        reviewRequired={windows.workspacePreferencesReviewRequired}
        onApprove={windows.approveWorkspacePreferencesReview}
      />

      <ToolRail
        toolRailRef={toolRailRef}
        activeEditorId={activeEditorId}
        activeCanvasToolId={activeCanvasToolId}
        toolGroups={activeToolGroups}
        resolveTool={getStudioTool}
        toolRackOpen={toolRackOpen}
        templateInsertMode={pageActions.templateInsertMode}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        colorSwatch={{
          fillColor: toolOptions.fillColor, strokeColor: toolOptions.strokeColor, strokeWidth: toolOptions.strokeWidth,
          onChangeFill: (color) => activeStudioActions.onApplySwatch(color, 'fill'),
          onChangeStroke: (color) => activeStudioActions.onApplySwatch(color, 'stroke'),
          onSwap: activeStudioActions.onSwapFillAndStroke, onResetDefault: activeStudioActions.onResetDefaultColors,
        }}
        onCloseTopMenus={() => setOpenMenu(null)}
        onToggleToolRack={setToolRackOpen}
        onChooseTool={(toolId) => chooseCanvasTool(toolId, activeEditorId)}
        onTemplateInsertModeChange={pageActions.setTemplateInsertMode}
        onInsertTemplate={pageActions.insertTemplate}
        onUndo={() => focusedCommandClient.undo()}
        onRedo={() => focusedCommandClient.redo()}
        onUpdateToolbarHint={updateToolbarHint}
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
        onHoverHint={() => updateToolbarHint(
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
        toolId={workspaceTools.main}
        toolOptions={toolOptions}
        zoom={windows.zoom}
        pan={windows.mainView.pan}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        onPositionChange={windows.setCanvasPosition}
        onSizeChange={windows.setCanvasSize}
        onFocus={() => { windows.focusWindow('main-canvas'); setActiveEditorId('main'); selectionSourceRef.current = 'canvas'; }}
        onFocusMinimized={() => { windows.focusWindow('main-canvas'); setActiveEditorId('main'); }}
        onHoverHint={() => updateToolbarHint('CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
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
        onChangeToolOptions={updateToolOptions}
        onPathfinder={(op) => selectionActions.handlePathfinder('main', op)}
        onConvertToPath={() => selectionActions.handleConvertToPath('main')}
        onFlip={(axis) => selectionActions.handleFlipSelection('main', axis)}
        onRotate90={() => selectionActions.handleRotate90('main')}
        onSimplifyPath={() => selectionActions.handleSimplifyPath('main')}
        onTogglePathClosed={() => selectionActions.handleTogglePathClosed('main')}
        onSelectTool={(nextTool) => chooseCanvasTool(nextTool, 'main')}
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
        motionPaths={activeEditorId === 'main' ? activeCanvasMotionPaths : undefined}
        selectedMotionPathPoint={activeEditorId === 'main' ? selectedMotionPathPoint : null}
        onSelectMotionPathPoint={setSelectedMotionPathPoint}
        onUpdateMotionPath={activeEditorId === 'main' ? handleUpdateCanvasMotionPath : undefined}
        showMorphCorrespondence={activeEditorId === 'main' && motion.motionOpen && showMorphCorrespondence}
        morphCorrespondenceMetaByNodeId={activeEditorId === 'main' ? morphCorrespondenceMetaByNodeId : undefined}
      />

      <ComponentCanvasWindow
        visible={componentCanvasVisible}
        minimized={windows.componentCanvasMinimized}
        closed={windows.componentCanvasClosed}
        floating={windows.componentCanvasFloating}
        position={windows.componentCanvasPosition}
        size={windows.componentCanvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'component-canvas')}
        document={componentCanvasDocument}
        components={state.project.components}
        designTokens={designSystem.designTokens}
        assets={state.project.assets}
        editingComponent={componentMaster.editingComponent}
        selectedNodeIds={componentState.selectedNodeIds}
        selectedComponentNodes={componentMaster.selectedComponentNodes}
        toolId={workspaceTools.component}
        toolOptions={toolOptions}
        zoom={windows.componentCanvasZoom}
        pan={windows.componentView.pan}
        canUndo={componentState.past.length > 0}
        canRedo={componentState.future.length > 0}
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
        onFocus={() => { windows.focusWindow('component-canvas'); setActiveEditorId('component'); selectionSourceRef.current = 'canvas'; }}
        onFocusMinimized={() => { windows.focusWindow('component-canvas'); setActiveEditorId('component'); }}
        onHoverHint={() => updateToolbarHint('COMPONENT CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
        onReloadRecoveredMaster={componentMaster.reloadRecoveredComponentMaster}
        onKeepCurrentBuffer={componentMaster.keepCurrentComponentBuffer}
        onDiscardAndOpenPending={componentMaster.discardBufferAndOpenPendingMaster}
        onOpenCleanupDialog={() => componentMaster.setComponentDeletionDialogOpen(true)}
        onSaveMaster={componentMaster.saveComponentCanvasMaster}
        onSaveSelectionAsNew={() => componentMaster.saveNodesAsComponent(componentMaster.selectedComponentNodes, componentDocument?.nodes ?? [])}
        onAlign={(alignment) => selectionActions.alignSelection(alignment, 'component')}
        onDistribute={(axis) => selectionActions.distributeSelection(axis, 'component')}
        onUndo={() => componentCommandClient.undo()}
        onRedo={() => componentCommandClient.redo()}
        onZoomChange={windows.setComponentCanvasZoom}
        onResetView={() => windows.centerComponentCanvasView(
          componentDocument?.width ?? 420,
          componentDocument?.height ?? 280,
        )}
        onMinimize={() => { windows.setComponentCanvasMinimized(true); setActiveEditorId('main'); if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas'); }}
        onRestore={() => { windows.setComponentCanvasMinimized(false); setActiveEditorId('component'); windows.focusWindow('component-canvas'); }}
        onToggleFloating={() => windows.setComponentCanvasWindowMode(windows.componentCanvasFloating ? 'docked' : 'floating')}
        onClose={() => { windows.setComponentCanvasClosed(true); windows.setComponentCanvasMinimized(false); windows.setComponentCanvasWindowMode('docked'); setActiveEditorId('main'); if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas'); }}
        onCloseMinimized={() => { windows.setComponentCanvasClosed(true); windows.setComponentCanvasMinimized(false); }}
        onChangeToolOptions={updateToolOptions}
        onPathfinder={(op) => selectionActions.handlePathfinder('component', op)}
        onConvertToPath={() => selectionActions.handleConvertToPath('component')}
        onFlip={(axis) => selectionActions.handleFlipSelection('component', axis)}
        onRotate90={() => selectionActions.handleRotate90('component')}
        onSimplifyPath={() => selectionActions.handleSimplifyPath('component')}
        onTogglePathClosed={() => selectionActions.handleTogglePathClosed('component')}
        onSelectTool={(nextTool) => chooseCanvasTool(nextTool, 'component')}
        onToolOperation={(operation) => motionAutoKeyBridge.executeComponentToolOperations([operation])}
        onToolOperationBatch={(operations) => motionAutoKeyBridge.executeComponentToolOperations(operations)}
        onLayerDrop={(nodeIds) => layers.dropLayersOnCanvas(nodeIds, 'component')}
        onDropImageFiles={(files, point) => { void handleInsertImageFiles(files, 'component', point); }}
        onChangeBackground={(background) => { componentCommandClient.setDocumentBackground(background); }}
        onResizeDocument={(width, height) => {
          const res = componentCommandClient.setDocumentSize(width, height, 'Resize component canvas');
          if (res.status === 'applied') windows.centerComponentCanvasView(width, height);
        }}
        studioActions={selectionActions.createStudioActionsForTarget('component')}
        canvasContextMenuExtras={componentCanvasContextMenuExtras}
        motionPaths={activeEditorId === 'component' ? activeCanvasMotionPaths : undefined}
        selectedMotionPathPoint={activeEditorId === 'component' ? selectedMotionPathPoint : null}
        onSelectMotionPathPoint={setSelectedMotionPathPoint}
        onUpdateMotionPath={activeEditorId === 'component' ? handleUpdateCanvasMotionPath : undefined}
        showMorphCorrespondence={activeEditorId === 'component' && motion.motionOpen && showMorphCorrespondence}
        morphCorrespondenceMetaByNodeId={activeEditorId === 'component' ? morphCorrespondenceMetaByNodeId : undefined}
      />

      <NodeLogicWindow
        visible={!windows.nodeLogicClosed && !windows.nodeLogicMinimized}
        minimized={windows.nodeLogicMinimized}
        closed={windows.nodeLogicClosed}
        floating={windows.nodeLogicFloating}
        position={windows.nodeLogicPosition}
        size={windows.nodeLogicSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'node-logic')}
        project={state.project}
        activePageId={activePageId}
        mainCommandClient={mainCommandClient}
        onNotice={setNotice}
        onOpenLivePreview={openLivePreviewForPage}
        onToggleComponentNodeLogic={designSystem.toggleComponentNodeLogic}
        focusRequest={quickInteractions.nodeLogicFocusRequest}
        onPositionChange={windows.setNodeLogicPosition}
        onSizeChange={windows.setNodeLogicSize}
        onFocus={() => { windows.focusWindow('node-logic'); setActiveEditorId('main'); }}
        onHoverHint={() => updateToolbarHint('NODE LOGIC', 'Build interactive event, state, logic, and action flows connected to Live Preview.')}
        onMinimize={() => windows.setNodeLogicMinimized(true)}
        onRestore={() => { windows.setNodeLogicMinimized(false); setActiveEditorId('main'); windows.focusWindow('node-logic'); }}
        onToggleFloating={() => windows.setNodeLogicWindowMode(windows.nodeLogicFloating ? 'docked' : 'floating')}
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

      <InspectorPanel
        visible={windows.inspectorVisible}
        width={panelResize.panelWidths.inspector}
        isResizing={panelResize.resizingPanel === 'inspector'}
        resizeHandleRef={panelResize.inspectorResizeHandleRef}
        activeEditorId={activeEditorId}
        selectedNode={inspectorSelectedNode}
        selectedNodes={inspectorSelectedNodes}
        selectedCount={inspectorSelectedNodes.length}
        canRemoveFromCanvas={selectionSourceRef.current !== 'layers'}
        selectedInstanceComponent={selectedInstanceComponent}
        editingMasterComponent={componentMaster.editingComponent}
        instanceOverrideTargets={instanceOverrideTargets}
        activeBreakpoint={designSystem.activeBreakpoint}
        designTokens={designSystem.designTokens}
        assets={state.project.assets}
        defaultFillColor={toolOptions.fillColor}
        renderIcon={(name) => <StudioIcon name={name} />}
        onStartResize={panelResize.startPanelResize}
        onResizeDoubleClick={panelResize.handlePanelResizeDoubleClick}
        onResizeKeyDown={panelResize.handlePanelResizeKeyDown}
        onCommitEdit={() => {
          mainCommandClient.commitEdit();
          componentCommandClient.commitEdit();
        }}
        onHoverHint={() =>
          updateToolbarHint('INSPECTOR', 'Edit the selected layer’s position, dimensions, fills, gradients, effects, typography, layout, and contract.')
        }
        onRemoveFromCanvas={(nodeId) => {
          focusedCommandClient.setNodesCanvasState([nodeId], false, 'Remove from canvas');
        }}
        onUpdateSelected={motionAutoKeyBridge.handleInspectorUpdateSelected}
        onUpdateSelectedStyle={motionAutoKeyBridge.handleInspectorUpdateSelectedStyle}
        onTogglePropertyKeyframe={motion.togglePropertyKeyframe}
        isPropertyKeyedAtPlayhead={motion.isPropertyKeyedAtPlayhead}
        onApplyAutoLayout={designSystem.applyAutoLayout}
        onConvertFrameLayoutMode={designSystem.convertFrameLayoutMode}
        onSwitchBreakpoint={designSystem.setActiveBreakpoint}
        onUpdateInstanceOverride={selectionActions.updateInstanceOverride}
        onUpdateInstanceVariant={designSystem.updateInstanceVariant}
        onUpdateInstanceSlot={designSystem.updateInstanceSlot}
        onUpdateMasterContract={designSystem.updateMasterContract}
        onToggleComponentNodeLogic={designSystem.toggleComponentNodeLogic}
        onResetInstanceOverrides={selectionActions.resetInstanceOverrides}
        onDetachInstance={selectionActions.detachSelectedInstance}
        onConvertToPath={selectionActions.handleConvertToPath}
        onTogglePathClosed={selectionActions.handleTogglePathClosed}
        onSimplifyPath={selectionActions.handleSimplifyPath}
        onChooseTool={chooseCanvasTool}
        onQuickAdd={pageActions.addNode}
        onInsertImageFiles={(files) => { void handleInsertImageFiles(files, activeEditorId); }}
        onImportFontFiles={(files) => { void handleImportFontFiles(files, activeEditorId); }}
        onDuplicateSelection={() => selectionActions.duplicateSelection(activeEditorId)}
        onCopySelection={() => selectionActions.copySelection(activeEditorId)}
        project={state.project}
        activePageId={activePageId}
        scopedNodes={focusedDocument.nodes}
        onCreateQuickInteraction={quickInteractions.createQuickInteraction}
        onUpdateQuickInteraction={quickInteractions.updateQuickInteraction}
        onDeleteQuickInteraction={quickInteractions.deleteQuickInteraction}
        onOpenInteractionInNodeGraph={quickInteractions.openInteractionInNodeGraph}
        colorBlendMode={toolOptions.colorBlendMode}
        onChangeColorBlendMode={(colorBlendMode) => updateToolOptions({ colorBlendMode })}
        studioActions={activeStudioActions}
      />

      <PagesRackPanel
        panelRef={pagesRackRef} open={windows.pagesRackOpen} pages={pages} activePageId={activePageId}
        applications={projectApplications} activeApplicationId={activeApplication.id}
        onSelectApplication={pageActions.switchApplication} onCreateApplication={pageActions.addApplication}
        pageNameDraft={pageActions.pageNameDraft} onFocus={() => windows.focusWindow('pages')}
        onPageNameDraftChange={pageActions.setPageNameDraft} onAddPage={pageActions.addPage}
        onSwitchPage={pageActions.switchPage} onClose={closePagesRack} onNotice={setNotice}
      />

      <ComponentRackPanel
        panelRef={componentRackRef} open={windows.componentRackOpen} components={ownedComponents}
        activeApplicationId={activeApplication.id} activeApplicationName={activeApplication.name}
        onSetComponentScope={componentMaster.setComponentScope}
        designTokens={designSystem.designTokens} assets={state.project.assets} searchQuery={componentRackSearch}
        canSaveSelection={selectedNodes.length > 0} renamingComponentId={componentMaster.renamingComponentId}
        componentNameDraft={componentMaster.componentNameDraft} onSearchChange={setComponentRackSearch}
        onCreateNewMaster={componentMaster.createNewMasterComponent}
        onSaveSelection={() => componentMaster.saveNodesAsComponent(focusedEditor.selectedNodes, focusedDocument.nodes)}
        onClose={closeComponentRack} onInsertComponent={pageActions.insertOwnedComponent}
        onEditMaster={componentMaster.openMasterComponent}
        onStartRename={(c) => { componentMaster.setRenamingComponentId(c.id); componentMaster.setComponentNameDraft(c.name); }}
        onRenameDraftChange={componentMaster.setComponentNameDraft} onCommitRename={componentMaster.renameComponent}
        onCancelRename={() => componentMaster.setRenamingComponentId(null)} onDuplicateComponent={componentMaster.duplicateComponent}
        onDeleteComponent={(component) => { void componentMaster.deleteComponent(component); }}
        onToggleNodeLogic={(component) => designSystem.toggleComponentNodeLogic(component)}
      />

      <WorkspaceStudioOverlays
        project={state.project}
        activePage={activePage}
        pages={pages}
        activeEditorId={activeEditorId}
        selectedMainNodeId={state.selectedNodeId}
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
          setActiveEditorId('main');
          windows.openMainCanvas();
        }}
        onCloseCodeWorkspace={() => setCodeWorkspaceOpen(false)}
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
        canPaste={clipboardRef.current !== null}
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
          const selectedIds = editorId === 'main' ? state.selectedNodeIds : componentState.selectedNodeIds;
          componentMaster.saveNodesAsComponent(docNodes.filter((n) => selectedIds.includes(n.id)), docNodes);
        }}
        onUnpackComponent={selectionActions.unpackComponentInstance}
        onDeleteLayers={deleteLayersSafely}
        onMarkLayerSelectionSource={() => { selectionSourceRef.current = 'layers'; }}
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
        onChooseTool={chooseCanvasTool}
        onOpenLivePreview={openLivePreviewForPage}
        onOpenMotionExport={() => setMotionExportOpen(true)}
        selectedMotionPathPoint={selectedMotionPathPoint}
        onSelectMotionPathPoint={setSelectedMotionPathPoint}
        showMorphCorrespondence={showMorphCorrespondence}
        onToggleMorphCorrespondence={() => setShowMorphCorrespondence((v) => !v)}
        onCloseMotion={motion.closeMotion}
        onNotice={setNotice}
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
        project={state.project} activePage={activePage} motionExportProject={motionExportProject}
        motionExportPage={activeMotionPage} pageClips={motion.pageClips} activeClip={motion.activeClip}
        breakpoint={designSystem.activeBreakpoint} activeWorkspace={activeEditorId}
        componentDeletionDialogOpen={componentMaster.componentDeletionDialogOpen}
        newProjectDialogOpen={dialogs.newProjectDialogOpen} newProjectBusyMode={dialogs.newProjectBusyMode}
        newProjectError={dialogs.newProjectError} newProjectModalHostRef={dialogs.newProjectModalHostRef}
        newProjectDialogRef={dialogs.newProjectDialogRef}
        onSaveAndCreateNewProject={() => { void dialogs.confirmNewProject('save'); }}
        onDeleteAndCreateNewProject={() => { void dialogs.confirmNewProject('delete'); }}
        onCancelNewProject={dialogs.closeNewProjectDialog}
        motionExportOpen={motionExportOpen} shortcutsModalOpen={dialogs.shortcutsModalOpen}
        diagnosticsModalOpen={dialogs.diagnosticsModalOpen} projectLibraryOpen={dialogs.projectLibraryOpen}
        historyUndoCount={state.past.length} historyRedoCount={state.future.length}
        shortcutsModalHostRef={dialogs.shortcutsModalHostRef} shortcutsDialogRef={dialogs.shortcutsDialogRef}
        onNotice={setNotice} onCloseMotionExport={() => setMotionExportOpen(false)}
        onCloseShortcuts={dialogs.closeShortcutsModal} onShortcutsReady={dialogs.handleShortcutsModalReady}
        onOpenCodeStudio={() => { setActiveEditorId('main'); setCodeWorkspaceOpen(true); }}
        onCloseDiagnostics={() => dialogs.setDiagnosticsModalOpen(false)}
        onLoadStoredProject={fileLifecycle.loadStoredProjectIntoWorkspace}
        onOpenProjectFilePicker={() => { if (!isHydrating) projectFileInputRef.current?.click(); }}
        onCloseProjectLibrary={dialogs.closeProjectLibrary}
      />

      <ProjectHydrationOverlay visible={isHydrating} />
      {notice && (
        <div class={`toast${motion.motionOpen ? ' is-above-timeline' : ''}`} role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

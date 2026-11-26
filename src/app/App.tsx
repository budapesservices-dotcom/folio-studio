import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { JSX } from 'preact';
import { createInitialProject } from '../core/document/factory';
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
import { InspectorPanel } from './InspectorPanel';
import type { StudioClipboardPayload } from './nodeClipboard';
import { createEditorState } from './editorReducer';
import { createCanonicalEditorStore } from './editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from './mainCanvasCommandClient';
import { createToolOperationExecutor } from './toolOperationExecutor';
import { getActiveEditorContext, type EditorTarget } from './editorContext';
import { getWindowZIndex } from './windowManager';
import { createToolbarHintStore, DEFAULT_TOOLBAR_HINT } from './ToolbarHintBar';
import { StudioIcon } from './workspace/StudioIcon';
import { useWorkspaceWindows } from './workspace/useWorkspaceWindows';
import { useWorkspaceChromeEffects } from './workspace/useWorkspaceChromeEffects';
import { usePanelResizeController } from './workspace/usePanelResizeController';
import { useComponentMasterLifecycle } from './workspace/useComponentMasterLifecycle';
import { useWorkspaceShortcuts } from './workspace/useWorkspaceShortcuts';
import { useLayerPanelController } from './workspace/useLayerPanelController';
import { useSelectionAndVectorActions } from './workspace/useSelectionAndVectorActions';
import { useProjectFileLifecycle } from './workspace/useProjectFileLifecycle';
import { usePageAndTemplateActions } from './workspace/usePageAndTemplateActions';
import { useDesignSystemActions } from './workspace/useDesignSystemActions';
import { useMotionPlayback } from './workspace/useMotionPlayback';
import { useMediaAndFontsLifecycle } from './workspace/useMediaAndFontsLifecycle';
import { GlobalToolbar, WorkspacePreferencesRecoveryBanner, type TopMenuId } from './workspace/GlobalToolbar';
import { buildGlobalToolbarMenuActions } from './workspace/globalMenuActions';
import { createInteractiveStarterProject } from './workspace/starterProject';
import type { CodeWorkspaceViewMode } from './workspace/useCodeWorkspace';
import { ToolRail } from './workspace/ToolRail';
import { LayersPanel } from './workspace/LayersPanel';
import { LayerColorPalette, LayerContextMenu } from './workspace/LayerPopovers';
import { ComponentCanvasWindow, MainCanvasWindow, NodeLogicWindow } from './workspace/CanvasWindows';
import { PagesRackPanel } from './workspace/PagesRackPanel';
import { ComponentRackPanel } from './workspace/ComponentRackPanel';
import { StatusBar } from './workspace/StatusBar';
import { ComponentDeletionDialog, ProjectHydrationOverlay } from './workspace/ComponentDeletionDialog';
import { createMotionAutoKeyBridge } from './workspace/motionAutoKeyBridge';
import { useQuickInteractionActions } from './workspace/useQuickInteractionActions';
import { WorkspaceModals } from './workspace/WorkspaceModals';

// Lazy-loaded feature bundles kept outside Folio's critical startup chunk.
const LazyCodeWorkspace = lazy(() => import('./workspace/LazyCodeWorkspace'));
const LazyTokensPanel = lazy(() => import('./workspace/TokensPanel').then((m) => ({ default: m.TokensPanel })));
const LazyMotionTimelinePanel = lazy(() => import('./workspace/MotionTimelinePanel').then((m) => ({ default: m.MotionTimelinePanel })));

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
    page.document.nodes = [];
    return createEditorState(project);
  }, []);
  const componentStore = useMemo(
    () => createCanonicalEditorStore(componentInitialState, { workspace: 'component' }),
    [componentInitialState],
  );
  const [componentState, setComponentState] = useState(() => componentStore.getSnapshot().editorState);
  const syncComponentStateFromStore = useCallback(() => {
    const next = componentStore.getSnapshot().editorState;
    setComponentState((current) => (current === next ? current : next));
  }, [componentStore]);
  useEffect(
    () => componentStore.subscribe(syncComponentStateFromStore),
    [componentStore, syncComponentStateFromStore],
  );
  const componentCommandClient = useMemo(() => createComponentCanvasCommandClient(componentStore, {
    onRejected: (result) => commandRejectNoticeRef.current(result.message),
  }), [componentStore]);

  const getCommandClient = useCallback(
    (target: EditorTarget) => (target === 'main' ? mainCommandClient : componentCommandClient),
    [mainCommandClient, componentCommandClient],
  );

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
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameCancelRef = useRef(false);
  const [componentRackSearch, setComponentRackSearch] = useState('');
  const selectionSourceRef = useRef<'layers' | 'canvas'>('canvas');
  const clipboardRef = useRef<StudioClipboardPayload | null>(null);

  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [diagnosticsModalOpen, setDiagnosticsModalOpen] = useState(false);
  const [shortcutsMountTick, setShortcutsMountTick] = useState(0);
  const shortcutsModalHostRef = useRef<HTMLDivElement | null>(null);
  const shortcutsDialogRef = useRef<HTMLElement | null>(null);
  const shortcutsFocusReturnRef = useRef<HTMLElement | null>(null);

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
    setNotice,
  });

  editingComponentIdRef.current = componentMaster.editingComponentId;
  resetEditingComponentRef.current = () => componentMaster.setEditingComponentId(null);

  const isHydrating = !fileLifecycle.isProjectLoaded || !componentMaster.componentReady;

  // Derived active workspace context
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;
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

  const openShortcutsModal = useCallback(() => {
    shortcutsFocusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenMenu(null);
    setToolRackOpen(null);
    layers.setLayerContextMenu(null);
    setShortcutsModalOpen(true);
  }, [layers.setLayerContextMenu]);

  const closeShortcutsModal = useCallback(() => {
    setShortcutsModalOpen(false);
  }, []);

  const handleShortcutsModalReady = useCallback(() => {
    setShortcutsMountTick((tick) => tick + 1);
  }, []);

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
    shortcutsModalOpen,
    shortcutsMountTick,
    componentDeletionDialogOpen: componentMaster.componentDeletionDialogOpen,
    appShellRef,
    shortcutsModalHostRef,
    shortcutsDialogRef,
    shortcutsFocusReturnRef,
    closeShortcutsModal,
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
  const { handleInsertImageFiles } = useMediaAndFontsLifecycle({
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

  const buildToolExecutor = (workspace: EditorTarget) => {
    const isMain = workspace === 'main';
    const commandClient = isMain ? mainCommandClient : componentCommandClient;
    return createToolOperationExecutor({
      workspace,
      commandClient,
      shell: {
        isHydrating: () => isHydrating,
        onSelectionChange: (nodeIds) => {
          selectionSourceRef.current = 'canvas';
          commandClient.selectNodes(nodeIds, isMain ? 'Select layers on canvas' : 'Select layers on component canvas');
          if (isMain && nodeIds.length > 0) windows.setInspectorVisible(true);
        },
        onPanChange: isMain ? windows.setMainPan : windows.setComponentCanvasPan,
        onZoomChange: isMain ? windows.setZoom : windows.setComponentCanvasZoom,
        onToolChange: (nextTool) => chooseCanvasTool(nextTool, workspace),
        onNotice: setNotice,
        onSampledColorOptionChange: applySampledColorOption,
        onCanvasMutationCommitted: (kind) => {
          selectionSourceRef.current = 'canvas';
          if (isMain && kind === 'create') windows.setInspectorVisible(true);
        },
      },
    });
  };
  const mainToolOperationExecutor = buildToolExecutor('main');
  const componentToolOperationExecutor = buildToolExecutor('component');

  const enterFullscreen = () => {
    const root = document.querySelector('.app-shell') as HTMLElement | null;
    if (!document.fullscreenElement) {
      root?.requestFullscreen?.().catch(() => setNotice('Fullscreen is unavailable in this browser.'));
    } else {
      document.exitFullscreen?.();
    }
  };

  const resetWindowLayout = () => {
    windows.resetAllWindowLayouts();
    panelResize.resetAllPanelWidths();
    setOpenMenu(null);
    setNotice('Window layout has been reset.');
  };

  // Global keyboard shortcuts
  useWorkspaceShortcuts({
    activeEditorId,
    editingComponentId: componentMaster.editingComponentId,
    state,
    componentState,
    isHydrating,
    componentDeletionDialogOpen: componentMaster.componentDeletionDialogOpen,
    shortcutsModalOpen,
    selectionSourceRef,
    clipboardRef,
    getCommandClient,
    openShortcutsModal,
    copySelection: selectionActions.copySelection,
    cutSelection: selectionActions.cutSelection,
    pasteSelection: selectionActions.pasteSelection,
    duplicateSelection: selectionActions.duplicateSelection,
    chooseCanvasTool,
    setNotice,
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

  const mainCanvasVisible = !windows.canvasClosed
    && !windows.canvasMinimized
    && !(windows.componentCanvasOpen && !windows.componentCanvasFloating && !windows.canvasFloating)
    && !(windows.nodeLogicOpen && !windows.nodeLogicFloating && !windows.canvasFloating);

  const nodeLogicCoversDockedComponent = windows.nodeLogicOpen
    && !windows.nodeLogicFloating
    && !windows.componentCanvasFloating
    && getWindowZIndex(windows.windowOrder, 'node-logic') > getWindowZIndex(windows.windowOrder, 'component-canvas');

  const componentCanvasVisible = !windows.componentCanvasClosed
    && !windows.componentCanvasMinimized
    && !nodeLogicCoversDockedComponent;

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
    onCut: selectionActions.cutSelection,
    onCopy: selectionActions.copySelection,
    onPaste: selectionActions.pasteSelection,
    onDuplicate: selectionActions.duplicateSelection,
    onSelectTool: chooseCanvasTool,
    onPathfinder: selectionActions.handlePathfinder,
    onConvertToPath: selectionActions.handleConvertToPath,
    onRotate90: selectionActions.handleRotate90,
    onUpdateDesignTokens: designSystem.updateDesignTokens,
    onDeleteSelected: deleteLayersSafely,
    onNotice: setNotice,
  });
  const motion = useMotionPlayback({ project: state.project, activePage, selectedNodeIds: state.selectedNodeIds, mainCommandClient, onNotice: setNotice });
  const isMainMotionPoseActive = activeEditorId === 'main' && motion.motionOpen && (motion.previewActive || motion.isPlaying);
  const animatedMainNodesById = useMemo(
    () => new Map(motion.animatedMainDocument.nodes.map((node) => [node.id, node])),
    [motion.animatedMainDocument.nodes],
  );
  const inspectorSelectedNode = isMainMotionPoseActive && selectedNode
    ? (animatedMainNodesById.get(selectedNode.id) ?? selectedNode)
    : selectedNode;
  const inspectorSelectedNodes = isMainMotionPoseActive
    ? focusedEditor.selectedNodes.map((node) => animatedMainNodesById.get(node.id) ?? node)
    : focusedEditor.selectedNodes;
  const motionAutoKeyBridge = createMotionAutoKeyBridge({
    activeEditorId,
    motion,
    inspectorSelectedNode,
    mainToolOperationExecutor,
    onUpdateSelectedFallback: selectionActions.updateSelected,
    onUpdateSelectedStyleFallback: selectionActions.updateSelectedStyle,
    onSampledColorOption: applySampledColorOption,
    onCanvasInteraction: () => { selectionSourceRef.current = 'canvas'; },
  });

  const openLivePreviewForPage = useCallback((pageId?: string) => {
    setActiveEditorId('main');
    setCodeWorkspaceLaunch((current) => ({ viewMode: 'preview', pageId, nonce: current.nonce + 1 }));
    setCodeWorkspaceOpen(true);
  }, []);

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
        projectNameEditing={projectNameEditing}
        projectNameDraft={projectNameDraft}
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
        shortcutsModalOpen={shortcutsModalOpen}
        toolbarHintStore={toolbarHintStore}
        onToggleMenu={(menu) => { setOpenMenu((current) => (current === menu ? null : menu)); setToolRackOpen(null); }}
        onCloseMenus={() => setOpenMenu(null)}
        onOpenProjectPicker={() => { if (isHydrating) return; setOpenMenu(null); projectFileInputRef.current?.click(); }}
        onProjectFileSelected={fileLifecycle.handleProjectFileSelected}
        onExportCurrentProject={() => { void fileLifecycle.exportCurrentProject(isHydrating); }}
        onExportActiveCanvasSvg={() => { void fileLifecycle.exportActiveCanvasSvg(isHydrating); }}
        onExportActiveCanvasPng={() => { void fileLifecycle.exportActiveCanvasPng(isHydrating); }}
        onOpenMotionExport={() => setMotionExportOpen(true)}
        onResetWindowLayout={resetWindowLayout}
        onOpenShortcutsModal={openShortcutsModal}
        onOpenDiagnosticsModal={() => setDiagnosticsModalOpen(true)}
        onStartProjectRename={() => {
          setProjectNameDraft(state.project.metadata.name);
          projectNameCancelRef.current = false;
          setProjectNameEditing(true);
        }}
        onProjectNameDraftChange={setProjectNameDraft}
        onCommitProjectRename={() => {
          if (!projectNameCancelRef.current) pageActions.commitProjectName(projectNameDraft);
          projectNameCancelRef.current = false;
          setProjectNameEditing(false);
        }}
        onCancelProjectRename={() => {
          projectNameCancelRef.current = true;
          setProjectNameDraft(state.project.metadata.name);
          setProjectNameEditing(false);
        }}
        onTogglePagesRack={() => {
          setToolRackOpen(null);
          if (windows.pagesRackOpen) closePagesRack();
          else { windows.focusWindow('pages'); windows.setPagesRackOpen(true); closeComponentRack(); designSystem.closeTokensRack(); }
        }}
        onToggleComponentRack={() => {
          setToolRackOpen(null);
          if (windows.componentRackOpen) closeComponentRack();
          else { windows.setComponentRackOpen(true); closePagesRack(); designSystem.closeTokensRack(); }
        }}
        onToggleTokensRack={() => {
          setToolRackOpen(null);
          if (designSystem.tokensRackOpen) designSystem.closeTokensRack();
          else { designSystem.setTokensRackOpen(true); closePagesRack(); closeComponentRack(); }
        }}
        onToggleLayersVisible={() => windows.setLayersVisible((value) => !value)}
        onToggleInspectorVisible={() => windows.setInspectorVisible((value) => !value)}
        onToggleMainCanvas={() => {
          if (windows.canvasClosed || windows.canvasMinimized) windows.openMainCanvas();
          else { windows.setCanvasClosed(true); windows.setCanvasMinimized(false); }
        }}
        onToggleComponentCanvas={() => {
          if (windows.componentCanvasClosed || windows.componentCanvasMinimized) windows.openComponentCanvas();
          else {
            windows.setComponentCanvasClosed(true); windows.setComponentCanvasMinimized(false); setActiveEditorId('main');
            if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
          }
        }}
        onToggleNodeLogic={() => {
          if (windows.nodeLogicClosed || windows.nodeLogicMinimized) windows.openNodeLogic();
          else { windows.setNodeLogicClosed(true); windows.setNodeLogicMinimized(false); }
        }}
        onToggleCodeWorkspace={() => setCodeWorkspaceOpen((open) => { if (!open) setActiveEditorId('main'); return !open; })}
        onToggleMotionTimeline={() => { if (!motion.motionOpen) setActiveEditorId('main'); motion.toggleMotionOpen(); }}
        onEnterFullscreen={enterFullscreen}
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
      />

      <MainCanvasWindow
        visible={mainCanvasVisible}
        minimized={windows.canvasMinimized}
        closed={windows.canvasClosed}
        floating={windows.canvasFloating}
        position={windows.canvasPosition}
        size={windows.canvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'main-canvas')}
        document={motion.animatedMainDocument}
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
        studioActions={selectionActions.createStudioActionsForTarget('main')}
      />

      <ComponentCanvasWindow
        visible={componentCanvasVisible}
        minimized={windows.componentCanvasMinimized}
        closed={windows.componentCanvasClosed}
        floating={windows.componentCanvasFloating}
        position={windows.componentCanvasPosition}
        size={windows.componentCanvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'component-canvas')}
        document={componentDocument}
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
        onToolOperation={(operation) => componentToolOperationExecutor.execute(operation)}
        onToolOperationBatch={(operations) => componentToolOperationExecutor.executeBatch(operations)}
        onLayerDrop={(nodeIds) => layers.dropLayersOnCanvas(nodeIds, 'component')}
        onDropImageFiles={(files, point) => { void handleInsertImageFiles(files, 'component', point); }}
        studioActions={selectionActions.createStudioActionsForTarget('component')}
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
        onTogglePropertyKeyframe={activeEditorId === 'main' ? motion.togglePropertyKeyframe : undefined}
        isPropertyKeyedAtPlayhead={activeEditorId === 'main' ? motion.isPropertyKeyedAtPlayhead : undefined}
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
        onDuplicateSelection={() => selectionActions.duplicateSelection(activeEditorId)}
        onCopySelection={() => selectionActions.copySelection(activeEditorId)}
        project={state.project}
        activePageId={activePageId}
        scopedNodes={focusedDocument.nodes}
        onCreateQuickInteraction={quickInteractions.createQuickInteraction}
        onUpdateQuickInteraction={quickInteractions.updateQuickInteraction}
        onDeleteQuickInteraction={quickInteractions.deleteQuickInteraction}
        onOpenInteractionInNodeGraph={quickInteractions.openInteractionInNodeGraph}
        studioActions={activeStudioActions}
      />

      <PagesRackPanel
        panelRef={pagesRackRef}
        open={windows.pagesRackOpen}
        pages={pages}
        activePageId={activePageId}
        pageNameDraft={pageActions.pageNameDraft}
        onFocus={() => windows.focusWindow('pages')}
        onPageNameDraftChange={pageActions.setPageNameDraft}
        onAddPage={pageActions.addPage}
        onSwitchPage={pageActions.switchPage}
        onClose={closePagesRack}
      />

      <ComponentRackPanel
        panelRef={componentRackRef}
        open={windows.componentRackOpen}
        components={ownedComponents}
        designTokens={designSystem.designTokens}
        assets={state.project.assets}
        searchQuery={componentRackSearch}
        canSaveSelection={selectedNodes.length > 0}
        renamingComponentId={componentMaster.renamingComponentId}
        componentNameDraft={componentMaster.componentNameDraft}
        onSearchChange={setComponentRackSearch}
        onCreateNewMaster={componentMaster.createNewMasterComponent}
        onSaveSelection={() => componentMaster.saveNodesAsComponent(focusedEditor.selectedNodes, focusedDocument.nodes)}
        onClose={closeComponentRack}
        onInsertComponent={pageActions.insertOwnedComponent}
        onEditMaster={componentMaster.openMasterComponent}
        onStartRename={(component) => {
          componentMaster.setRenamingComponentId(component.id);
          componentMaster.setComponentNameDraft(component.name);
        }}
        onRenameDraftChange={componentMaster.setComponentNameDraft}
        onCommitRename={componentMaster.renameComponent}
        onCancelRename={() => componentMaster.setRenamingComponentId(null)}
        onDuplicateComponent={componentMaster.duplicateComponent}
        onDeleteComponent={(component) => { void componentMaster.deleteComponent(component); }}
        onToggleNodeLogic={(component) => designSystem.toggleComponentNodeLogic(component)}
      />

      {designSystem.tokensRackOpen && (
        <Suspense fallback={null}>
          <LazyTokensPanel
            panelRef={designSystem.tokensRackRef}
            open={designSystem.tokensRackOpen}
            project={state.project}
            tokens={designSystem.designTokens}
            onUpdateTokens={designSystem.updateDesignTokens}
            onCopyNotice={setNotice}
            onClose={designSystem.closeTokensRack}
          />
        </Suspense>
      )}

      {codeWorkspaceOpen && (
        <Suspense
          fallback={(
            <div class="code-workspace-overlay" role="status" aria-live="polite">
              <div class="code-workspace-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
                Loading Code &amp; Live Preview Studio…
              </div>
            </div>
          )}
        >
          <LazyCodeWorkspace
            key={codeWorkspaceLaunch.nonce}
            project={state.project}
            pages={pages}
            themes={designSystem.designTokens.themes}
            selectedNodeId={state.selectedNodeId}
            activeBreakpoint={designSystem.activeBreakpoint}
            initialViewMode={codeWorkspaceLaunch.viewMode}
            initialPageId={codeWorkspaceLaunch.pageId}
            mainCommandClient={mainCommandClient}
            onNotice={setNotice}
            onJumpToCanvasNode={() => {
              setActiveEditorId('main');
              windows.openMainCanvas();
            }}
            onClose={() => setCodeWorkspaceOpen(false)}
          />
        </Suspense>
      )}

      <LayerColorPalette
        pickerKey={layers.layerColorPickerKey}
        activeEditorId={activeEditorId}
        layerSourceNodes={layers.layerSourceNodes}
        position={layers.layerColorPickerPosition}
        paletteRef={layers.layerColorPaletteRef}
        onSelectPresetColor={(nodeId, color) => {
          layers.setLayerColorFromRow(nodeId, color);
          layers.closeLayerColorPicker();
        }}
        onSelectCustomColor={layers.setLayerColorFromRow}
      />

      <LayerContextMenu
        menu={layers.layerContextMenu}
        menuRef={layers.layerContextMenuRef}
        targetNodeName={
          layers.layerContextMenu
            ? (layers.contextMenuNodes.find((node) => node.id === layers.layerContextMenu?.nodeId)?.name ?? 'layer')
            : 'layer'
        }
        capabilities={layers.contextMenuCapabilities}
        referenceWarning={layers.layerContextMenu?.editorId === 'main' ? (() => {
          const refs = findCrossStudioNodeReferences(state.project, layers.layerContextMenu.nodeIds, activePage.id);
          return refs.totalCount > 0
            ? { logicCount: refs.logicBindings.length, motionCount: refs.animationTracks.length, codeExtensionCount: refs.codeExtensions.length }
            : null;
        })() : null}
        onRename={(nodeId) => { layers.setLayerContextMenu(null); layers.beginLayerRename(nodeId, false); }}
        onGroup={(editorId, rootIds) => { layers.setLayerContextMenu(null); selectionSourceRef.current = 'layers'; getCommandClient(editorId).groupLayers(rootIds); }}
        onUngroup={(editorId, rootIds) => { layers.setLayerContextMenu(null); selectionSourceRef.current = 'layers'; getCommandClient(editorId).ungroupLayers(rootIds); }}
        onCreateClippingMask={(editorId, rootId) => { layers.setLayerContextMenu(null); selectionSourceRef.current = 'layers'; getCommandClient(editorId).createClippingMask(rootId); }}
        onRemoveClippingMask={(editorId, rootId) => { layers.setLayerContextMenu(null); selectionSourceRef.current = 'layers'; getCommandClient(editorId).removeClippingMask(rootId); }}
        onDelete={(editorId, nodeIds) => { layers.setLayerContextMenu(null); selectionSourceRef.current = 'layers'; deleteLayersSafely(editorId, nodeIds); }}
      />

      {motion.motionOpen && (
        <Suspense fallback={null}>
          <LazyMotionTimelinePanel
            activePage={activePage}
            pageClips={motion.pageClips}
            activeClip={motion.activeClip}
            customEasings={state.project.customEasings ?? []}
            selectedNodeIds={state.selectedNodeIds}
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
            onOpenLivePreview={openLivePreviewForPage}
            onOpenMotionExport={() => setMotionExportOpen(true)}
            onSelectCanvasNode={(nodeId) => { setActiveEditorId('main'); mainCommandClient.selectNodes([nodeId], 'Select animated layer'); }}
            onFocusStudio={() => setActiveEditorId('main')}
            onClose={motion.closeMotion}
          />
        </Suspense>
      )}

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
        project={state.project}
        activePage={activePage}
        pageClips={motion.pageClips}
        activeClip={motion.activeClip}
        breakpoint={designSystem.activeBreakpoint}
        activeWorkspace={activeEditorId}
        componentDeletionDialogOpen={componentMaster.componentDeletionDialogOpen}
        motionExportOpen={motionExportOpen}
        shortcutsModalOpen={shortcutsModalOpen}
        diagnosticsModalOpen={diagnosticsModalOpen}
        historyUndoCount={state.past.length}
        historyRedoCount={state.future.length}
        shortcutsModalHostRef={shortcutsModalHostRef}
        shortcutsDialogRef={shortcutsDialogRef}
        onNotice={setNotice}
        onCloseMotionExport={() => setMotionExportOpen(false)}
        onCloseShortcuts={closeShortcutsModal}
        onShortcutsReady={handleShortcutsModalReady}
        onOpenCodeStudio={() => { setActiveEditorId('main'); setCodeWorkspaceOpen(true); }}
        onCloseDiagnostics={() => setDiagnosticsModalOpen(false)}
      />

      <ProjectHydrationOverlay visible={isHydrating} />
      {notice && <div class="toast" role="status">{notice}</div>}
    </div>
  );
}

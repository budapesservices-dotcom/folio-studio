import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEmptyDocument, createInitialProject, createNodeForDocument } from '../core/document/factory';
import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioPage } from '../core/document/types';
import {
  expandSelectedLayerIds,
  getEffectiveLayerStates,
  getLayerPanelRows,
  type LayerDropPosition,
} from '../core/document/layers';
import {
  createComponentInstance,
  detachComponentInstance,
  getComponentOverrideTargets,
} from '../core/document/components';
import { getActiveDocument, getActivePage } from '../core/document/project';
import {
  loadMostRecentProject,
  saveProjectAndActivate,
  saveProjectIfRevisionCurrent,
} from '../core/persistence/indexedDb';
import { downloadProject } from '../core/persistence/projectFile';
import {
  applyPathfinderOperation,
  convertShapeToPathNode,
  flipPathNode,
  normalizePathNode,
  scalePathNodeGeometry,
  simplifyPathNode,
  type PathfinderOperation,
} from '../core/document/vector';
import {
  buildTemplateComponentAndInstance,
  computeTemplateInsertionOrigin,
  instantiateTemplateNodes,
  type StudioTemplateDefinition,
  type TemplateInsertMode,
} from '../core/document/templates';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../engines/canvas/geometry';
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
import { createProjectExportSnapshot } from './projectExport';
import { openProjectFile } from './projectFileActions';
import { InspectorPanel } from './InspectorPanel';
import {
  cloneNodesSubtree,
  createClipboardPayload,
  prepareNodesForPaste,
  type StudioClipboardPayload,
} from './nodeClipboard';
import { downloadPngDocument, downloadSvgDocument } from './visualExport';
import { createEditorState, normalizePositiveDimension } from './editorReducer';
import { createCanonicalEditorStore } from './editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from './mainCanvasCommandClient';
import { createToolOperationExecutor } from './toolOperationExecutor';
import { setRevisionFencedAutosaveStatus } from './debouncedAutosave';
import { activateModalDialog, trapModalDialogKeydown } from './modalFocus';
import { getActiveEditorContext, getTransformableNodes, type EditorTarget } from './editorContext';
import { getWindowZIndex } from './windowManager';
import { createToolbarHintStore, DEFAULT_TOOLBAR_HINT } from './ToolbarHintBar';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { StudioIcon } from './workspace/StudioIcon';
import {
  computeClampedContextMenuPosition,
  computeClampedPopoverPosition,
  computeLayerRenameUpdates,
  computeLayerSelection,
  getLayerContextMenuCapabilities,
  getLayerDropPosition,
  type LayerContextMenuState,
  type LayerRenameSession,
} from './workspace/layerOperations';
import { resolveActiveExportTarget } from './workspace/canvasViewState';
import { useWorkspaceWindows } from './workspace/useWorkspaceWindows';
import { usePanelResizeController } from './workspace/usePanelResizeController';
import { useComponentMasterLifecycle } from './workspace/useComponentMasterLifecycle';
import { useWorkspaceShortcuts } from './workspace/useWorkspaceShortcuts';
import { GlobalToolbar, WorkspacePreferencesRecoveryBanner } from './workspace/GlobalToolbar';
import { ToolRail } from './workspace/ToolRail';
import { LayersPanel } from './workspace/LayersPanel';
import { LayerColorPalette, LayerContextMenu } from './workspace/LayerPopovers';
import { ComponentCanvasWindow, MainCanvasWindow, NodeLogicWindow } from './workspace/CanvasWindows';
import { PagesRackPanel } from './workspace/PagesRackPanel';
import { ComponentRackPanel } from './workspace/ComponentRackPanel';
import { StatusBar } from './workspace/StatusBar';
import { ComponentDeletionDialog, ProjectHydrationOverlay } from './workspace/ComponentDeletionDialog';

export function App() {
  const [activeEditorId, setActiveEditorId] = useState<EditorTarget>('main');
  const [notice, setNotice] = useState('');
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const commandRejectNoticeRef = useRef<(message: string) => void>(() => {});
  commandRejectNoticeRef.current = setNotice;

  // Canonical stores & Native Command Engine clients
  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
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
    if (pagesRackRef.current?.contains(document.activeElement)) {
      pagesRackToggleRef.current?.focus({ preventScroll: true });
    }
    windows.setPagesRackOpen(false);
  }, [windows.setPagesRackOpen]);

  const closeComponentRack = useCallback(() => {
    if (componentRackRef.current?.contains(document.activeElement)) {
      componentRackToggleRef.current?.focus({ preventScroll: true });
    }
    windows.setComponentRackOpen(false);
  }, [windows.setComponentRackOpen]);

  // Project hydration & IndexedDB autosave
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');

  // Component Canvas master sync, buffer protection & durable deletion lifecycle
  const componentMaster = useComponentMasterLifecycle({
    canonicalStore,
    mainCommandClient,
    componentCommandClient,
    state,
    componentState,
    componentInitialProject: componentInitialState.project,
    isProjectLoaded,
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

  const isHydrating = !isProjectLoaded || !componentMaster.componentReady;

  // Hydrate primary project from IndexedDB
  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((loadedProject) => {
        if (!active || !loadedProject) return;
        const activePage = loadedProject.pages.find((page) => page.id === loadedProject.activePageId)
          ?? loadedProject.pages[0];
        if (!activePage) throw new Error('The saved project does not contain a page.');
        mainCommandClient.replaceProject(
          { ...loadedProject, activePageId: activePage.id },
          'Restore project from IndexedDB',
        );
      })
      .catch((error: unknown) => {
        console.error('Folio could not restore the project from IndexedDB:', error);
        if (active) setNotice('The saved project could not be restored. A new project is available.');
      })
      .finally(() => {
        if (active) setIsProjectLoaded(true);
      });
    return () => { active = false; };
  }, [mainCommandClient]);

  // Revision-fenced debounced autosave for primary project
  useEffect(() => {
    if (!isProjectLoaded) return;
    setSaveStatus('saving');
    const canonicalSnapshot = canonicalStore.getSnapshot();
    const projectRevision = canonicalSnapshot.projectRevision;
    const getCanonicalRevision = () => canonicalStore.getSnapshot().projectRevision;
    const timer = window.setTimeout(() => {
      saveProjectIfRevisionCurrent(
        canonicalSnapshot.editorState.project,
        projectRevision,
        getCanonicalRevision,
        (listener) => canonicalStore.subscribe(listener),
      )
        .then((result) => {
          if (result.status === 'saved') {
            setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'saved', setSaveStatus);
          }
        })
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'error', setSaveStatus);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state.project, isProjectLoaded, canonicalStore]);

  // Auto-dismiss transient status toast
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Menus, tool rack, shortcuts modal, and project/page drafts
  const toolbarHintStore = useMemo(() => createToolbarHintStore(), []);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const toolRailRef = useRef<HTMLElement | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [toolRackOpen, setToolRackOpen] = useState<string | null>(null);
  const [workspaceTools, setWorkspaceTools] = useState<Record<EditorTarget, CanvasToolId>>({
    main: 'select',
    component: 'select',
  });
  const [toolOptions, setToolOptions] = useState<CanvasToolOptions>(DEFAULT_CANVAS_TOOL_OPTIONS);
  const [templateInsertMode, setTemplateInsertMode] = useState<TemplateInsertMode>('nodes');
  const templateInsertCountRef = useRef(0);
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameCancelRef = useRef(false);
  const [pageNameDraft, setPageNameDraft] = useState('');
  const [componentRackSearch, setComponentRackSearch] = useState('');

  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const shortcutsModalHostRef = useRef<HTMLDivElement | null>(null);
  const shortcutsDialogRef = useRef<HTMLElement | null>(null);
  const shortcutsFocusReturnRef = useRef<HTMLElement | null>(null);

  // Layers interaction state (collapse, drag/drop, context menu, inline rename, color picker)
  const [collapsedLayers, setCollapsedLayers] = useState<Record<EditorTarget, string[]>>({ main: [], component: [] });
  const [layerDropTarget, setLayerDropTarget] = useState<{ nodeId: string; position: LayerDropPosition } | null>(null);
  const [layerContextMenu, setLayerContextMenu] = useState<LayerContextMenuState | null>(null);
  const layerContextMenuRef = useRef<HTMLDivElement | null>(null);
  const layerDragSourceRef = useRef<string[] | null>(null);
  const layerDragEditorRef = useRef<EditorTarget | null>(null);
  const selectionSourceRef = useRef<'layers' | 'canvas'>('canvas');
  const clipboardRef = useRef<StudioClipboardPayload | null>(null);
  const layerSelectionAnchorRef = useRef<Record<EditorTarget, string | null>>({ main: null, component: null });
  const [layerRename, setLayerRename] = useState<LayerRenameSession | null>(null);
  const layerRenameRef = useRef<LayerRenameSession | null>(null);
  const layerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const [layerColorPickerKey, setLayerColorPickerKey] = useState<string | null>(null);
  const layerColorAnchorRef = useRef<HTMLButtonElement | null>(null);
  const layerColorPaletteRef = useRef<HTMLDivElement | null>(null);
  const [layerColorPickerPosition, setLayerColorPickerPosition] = useState<{ top: number; left: number } | null>(null);

  const openShortcutsModal = useCallback(() => {
    shortcutsFocusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setHelpMenuOpen(false);
    setToolRackOpen(null);
    setLayerContextMenu(null);
    setShortcutsModalOpen(true);
  }, []);
  const closeShortcutsModal = useCallback(() => {
    setShortcutsModalOpen(false);
  }, []);

  // Dismiss menus on outside pointerdown or Escape
  useLayoutEffect(() => {
    if (!fileMenuOpen && !viewMenuOpen && !helpMenuOpen) return;
    const closeMenus = () => {
      setFileMenuOpen(false);
      setViewMenuOpen(false);
      setHelpMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuBarRef.current?.contains(event.target)) return;
      closeMenus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenus();
      }
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal: controller.signal });
    window.addEventListener('keydown', handleKeyDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [fileMenuOpen, viewMenuOpen, helpMenuOpen]);

  // Dismiss tool rack flyouts on outside pointerdown or Escape
  useLayoutEffect(() => {
    if (!toolRackOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolRailRef.current?.contains(event.target)) return;
      setToolRackOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (
          event.target instanceof HTMLInputElement
          && event.target.classList.contains('template-library-search')
          && event.target.value.trim().length > 0
        ) {
          return;
        }
        event.preventDefault();
        setToolRackOpen(null);
      }
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal: controller.signal });
    window.addEventListener('keydown', handleKeyDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [toolRackOpen]);

  // Keep root-mounted Layer Color Palette positioned and dismissible
  useEffect(() => {
    if (!layerColorPickerKey) return;
    const updatePalettePosition = () => {
      const anchor = layerColorAnchorRef.current;
      const palette = layerColorPaletteRef.current;
      if (!anchor || !palette) return;
      const next = computeClampedPopoverPosition(
        anchor.getBoundingClientRect(),
        palette.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      setLayerColorPickerPosition((current) => (
        current && Math.abs(current.top - next.top) < 0.5 && Math.abs(current.left - next.left) < 0.5
          ? current
          : next
      ));
    };
    const closePalette = () => {
      setLayerColorPickerKey(null);
      setLayerColorPickerPosition(null);
      layerColorAnchorRef.current = null;
    };
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layerColorPaletteRef.current?.contains(target)) return;
      if (layerColorAnchorRef.current?.contains(target)) return;
      closePalette();
    };
    const handlePaletteKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      if (event.target instanceof Node && layerColorPaletteRef.current?.contains(event.target)) {
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        closePalette();
      }
    };
    updatePalettePosition();
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true, signal });
    document.addEventListener('keydown', handlePaletteKeyDown, { capture: true, signal });
    window.addEventListener('resize', updatePalettePosition, { signal });
    window.addEventListener('scroll', updatePalettePosition, { capture: true, signal });
    return () => controller.abort();
  }, [layerColorPickerKey]);

  // Dismiss Layer Context Menu on outside pointerdown, Escape, resize, or scroll
  useEffect(() => {
    if (!layerContextMenu) return;
    const dismiss = () => setLayerContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && layerContextMenuRef.current?.contains(target)) return;
      dismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal });
    document.addEventListener('keydown', handleKeyDown, { capture: true, signal });
    window.addEventListener('resize', dismiss, { signal });
    window.addEventListener('scroll', dismiss, { capture: true, signal });
    return () => controller.abort();
  }, [layerContextMenu]);

  // Window viewport recovery on mount & resize
  useEffect(() => {
    const onResize = () => {
      windows.recoverWindow('main-canvas');
      windows.recoverWindow('component-canvas');
      windows.recoverWindow('node-logic');
      panelResize.clampCurrentPanelWidths();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [windows.recoverWindow, panelResize.clampCurrentPanelWidths]);

  useEffect(() => {
    windows.recoverWindow('main-canvas');
    windows.recoverWindow('component-canvas');
    windows.recoverWindow('node-logic');
  }, []);

  // Keyboard Shortcuts modal focus trap
  useEffect(() => {
    if (!shortcutsModalOpen || componentMaster.componentDeletionDialogOpen) return;
    const shell = appShellRef.current;
    const host = shortcutsModalHostRef.current;
    const dialog = shortcutsDialogRef.current;
    if (!shell || !host || !dialog) return;
    const restoreFocus = activateModalDialog(shell, host, dialog, shortcutsFocusReturnRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === '/') {
        event.preventDefault();
        event.stopPropagation();
        closeShortcutsModal();
        return;
      }
      trapModalDialogKeydown(dialog, event, closeShortcutsModal);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus();
    };
  }, [shortcutsModalOpen, componentMaster.componentDeletionDialogOpen, closeShortcutsModal]);

  // Derived active workspace context
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;
  const ownedComponents = state.project.components;
  const activeDocument = getActiveDocument(state.project);
  const componentDocument = getActiveDocument(componentState.project);
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
  const layerSourceNodes = focusedDocument.nodes;
  const activeCollapsedLayers = collapsedLayers[activeEditorId];
  const layerSourceIds = useMemo(
    () => new Set(layerSourceNodes.map((node) => node.id)),
    [layerSourceNodes],
  );
  const layerRows = useMemo(
    () => getLayerPanelRows(layerSourceNodes, activeCollapsedLayers),
    [layerSourceNodes, activeCollapsedLayers],
  );
  const layerEffectiveStates = useMemo(
    () => getEffectiveLayerStates(layerSourceNodes),
    [layerSourceNodes],
  );
  const contextMenuEditor = layerContextMenu
    ? getActiveEditorContext(layerContextMenu.editorId, state, componentState)
    : null;
  const contextMenuNodes = contextMenuEditor?.document.nodes ?? [];
  const contextMenuCapabilities = useMemo(
    () => getLayerContextMenuCapabilities(contextMenuNodes, layerContextMenu?.nodeIds ?? []),
    [contextMenuNodes, layerContextMenu],
  );

  // Layer rename lifecycle
  const beginLayerRename = (nodeId: string, batch: boolean) => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const nodeIds = batch
      ? layerRows.filter(({ node }) => selectedIds.includes(node.id)).map(({ node }) => node.id)
      : [nodeId];
    const clickedNode = layerSourceNodes.find((node) => node.id === nodeId);
    if (!clickedNode || nodeIds.length === 0) return;
    const selectedSet = new Set(nodeIds);
    const session: LayerRenameSession = {
      anchorId: nodeId,
      nodeIds,
      value: batch ? clickedNode.name.replace(/\s+\d+$/, '') : clickedNode.name,
      batch,
      editorId: activeEditorId,
      existingNames: layerSourceNodes.filter((node) => !selectedSet.has(node.id)).map((node) => node.name),
    };
    layerRenameRef.current = session;
    setLayerRename(session);
  };

  const updateLayerRenameDraft = (value: string) => {
    const current = layerRenameRef.current;
    if (!current) return;
    const next = { ...current, value };
    layerRenameRef.current = next;
    setLayerRename(next);
  };

  const finishLayerRename = (save: boolean) => {
    const session = layerRenameRef.current;
    if (!session) {
      setLayerRename(null);
      return;
    }
    // Clear the ref first: Enter followed by an ensuing blur must never commit twice.
    layerRenameRef.current = null;
    setLayerRename(null);
    if (!save) return;

    const updates = computeLayerRenameUpdates(session);
    if (updates.length === 0) return;
    getCommandClient(session.editorId).renameNodes(
      updates,
      session.batch ? 'Batch rename layers' : 'Rename layer',
    );
  };

  useEffect(() => {
    if (!layerRename) return;
    const input = layerRenameInputRef.current;
    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(0, input.value.length);
    }
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const activeInput = layerRenameInputRef.current;
      if (!activeInput) {
        finishLayerRename(true);
        return;
      }
      if (event.target instanceof Node && activeInput.contains(event.target)) return;
      finishLayerRename(true);
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [layerRename?.anchorId]);

  // Layer actions
  const setLayerColorFromRow = (nodeId: string, color: string) => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const validIds = layerSourceNodes.filter((node) => targetIds.includes(node.id)).map((node) => node.id);
    if (validIds.length === 0) return;
    focusedCommandClient.setNodesProperties(validIds, { layerColor: color }, 'Set layer color');
    setLayerColorPickerKey(null);
  };

  const toggleLayerPropertyFromRow = (nodeId: string, property: 'visible' | 'locked') => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const targets = layerSourceNodes.filter((node) => targetIds.includes(node.id));
    if (targets.length === 0) return;
    const shouldEnable = !targets.every((node) => node[property]);
    focusedCommandClient.setNodesProperties(
      targets.map((node) => node.id),
      { [property]: shouldEnable },
      property === 'visible' ? 'Toggle layer visibility' : 'Toggle layer lock',
    );
  };

  const selectLayerFromPanel = (nodeId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    selectionSourceRef.current = 'layers';
    const result = computeLayerSelection({
      nodeId,
      modifiers,
      nodes: layerSourceNodes,
      rows: layerRows,
      selectedNodeIds: focusedEditor.state.selectedNodeIds,
      currentAnchorId: layerSelectionAnchorRef.current[activeEditorId],
    });
    if (result.action === 'rename-batch') {
      beginLayerRename(nodeId, true);
      return;
    }
    if (result.action === 'rename-single') {
      beginLayerRename(nodeId, false);
      return;
    }
    if (result.nextAnchorId !== undefined) {
      layerSelectionAnchorRef.current[activeEditorId] = result.nextAnchorId;
    }
    focusedCommandClient.selectNodes(result.nodeIds ?? [], result.description ?? 'Select layer');
    windows.setInspectorVisible(true);
  };

  const openLayerContextMenu = (nodeId: string, event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    selectionSourceRef.current = 'layers';
    const currentSelection = focusedEditor.state.selectedNodeIds.filter((id) => layerSourceIds.has(id));
    const menuNodeIds = currentSelection.includes(nodeId)
      ? currentSelection
      : expandSelectedLayerIds(layerSourceNodes, [nodeId]);
    if (!currentSelection.includes(nodeId)) {
      layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      focusedCommandClient.selectNodes(menuNodeIds, 'Select layer for context menu');
      windows.setInspectorVisible(true);
    }
    const pos = computeClampedContextMenuPosition(
      event.clientX,
      event.clientY,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setLayerContextMenu({ nodeId, nodeIds: menuNodeIds, editorId: activeEditorId, x: pos.x, y: pos.y });
  };

  const toggleLayerCollapsed = (nodeId: string) => {
    setCollapsedLayers((current) => {
      const ids = current[activeEditorId] ?? [];
      return {
        ...current,
        [activeEditorId]: ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId],
      };
    });
  };

  const startLayerDrag = (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    selectionSourceRef.current = 'layers';
    layerDragEditorRef.current = activeEditorId;
    const currentSelection = focusedEditor.state.selectedNodeIds.filter((id) => layerSourceIds.has(id));
    const requestedIds = currentSelection.includes(nodeId) ? currentSelection : [nodeId];
    const draggedIds = expandSelectedLayerIds(layerSourceNodes, requestedIds);
    layerDragSourceRef.current = draggedIds;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-folio-layer-ids', JSON.stringify(draggedIds));
      event.dataTransfer.setData('text/plain', draggedIds.join(','));
    }
  };

  const updateLayerDropTarget = (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    if (!layerDragSourceRef.current?.length) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setLayerDropTarget({
      nodeId,
      position: getLayerDropPosition(event.currentTarget.getBoundingClientRect(), event.clientY),
    });
  };

  const dropLayer = (targetId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    let draggedIds = layerDragSourceRef.current ?? [];
    const transferred = event.dataTransfer?.getData('application/x-folio-layer-ids');
    if (transferred) {
      try {
        const parsed: unknown = JSON.parse(transferred);
        if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) draggedIds = parsed;
      } catch { /* Keep the in-memory drag selection as a safe fallback. */ }
    } else if (!draggedIds.length) {
      draggedIds = (event.dataTransfer?.getData('text/plain') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    }
    const position = getLayerDropPosition(event.currentTarget.getBoundingClientRect(), event.clientY);
    if (draggedIds.length > 0) {
      const result = focusedCommandClient.moveLayers(draggedIds, targetId, position);
      if (result.status === 'applied' && position === 'inside') {
        setCollapsedLayers((current) => ({
          ...current,
          [activeEditorId]: (current[activeEditorId] ?? []).filter((id) => id !== targetId),
        }));
      }
    }
    layerDragSourceRef.current = null;
    layerDragEditorRef.current = null;
    setLayerDropTarget(null);
  };

  const dropLayersOnCanvas = (nodeIds: string[], target: EditorTarget) => {
    const source = layerDragEditorRef.current;
    const clearDrag = () => {
      layerDragSourceRef.current = null;
      layerDragEditorRef.current = null;
      setLayerDropTarget(null);
    };
    if (source && source !== target) {
      setNotice('Drag layers into the Canvas that belongs to the active Layers editor.');
      clearDrag();
      return;
    }
    const targetDocument = target === 'main' ? activeDocument : componentDocument;
    const targetClient = getCommandClient(target);
    const requested = new Set(nodeIds);
    const droppedNodes = targetDocument.nodes.filter((node) => requested.has(node.id));
    if (droppedNodes.length === 0) {
      clearDrag();
      return;
    }
    const ids = droppedNodes.map((node) => node.id);
    const existing = droppedNodes.find((node) => node.onCanvas !== false);
    selectionSourceRef.current = 'canvas';
    setActiveEditorId(target);
    windows.setInspectorVisible(true);
    targetClient.selectNodes(ids, 'Select dropped layers');
    if (existing) {
      setNotice(`“${existing.name}” is already on the Canvas. Duplicate objects are not allowed.`);
      clearDrag();
      return;
    }
    const result = targetClient.setNodesCanvasState(ids, true, 'Restore layers to canvas');
    if (result.status === 'applied') {
      setNotice(`“${droppedNodes[0].name}” has been restored to the Canvas with its previous properties.`);
    }
    clearDrag();
  };

  // Document, Page, Template & Export actions
  const addNode = (type: 'rect' | 'ellipse' | 'text') => {
    if (isHydrating) return;
    const node = createNodeForDocument(type, focusedDocument);
    focusedCommandClient.createNodes([node], `Create ${type} node`);
    windows.setInspectorVisible(true);
  };

  const insertTemplate = (template: StudioTemplateDefinition, requestedMode: TemplateInsertMode) => {
    if (isHydrating) return;
    const effectiveMode: TemplateInsertMode = activeEditorId === 'component' ? 'nodes' : requestedMode;
    const staggerIndex = templateInsertCountRef.current;
    templateInsertCountRef.current += 1;
    const origin = computeTemplateInsertionOrigin(focusedDocument, template, staggerIndex);

    if (effectiveMode === 'component' && activeEditorId === 'main') {
      const existingNames = ownedComponents.map((item) => item.name);
      const { component, instance } = buildTemplateComponentAndInstance(template, origin, existingNames);
      const txResult = mainCommandClient.createComponentWithInstance(
        component,
        instance,
        `Insert "${template.name}" as component`,
      );
      if (txResult.status === 'applied') {
        mainCommandClient.selectNodes([instance.id], `Select inserted ${component.name} instance`);
        setWorkspaceTools((current) => ({ ...current, main: 'select' }));
        setToolRackOpen(null);
        windows.setInspectorVisible(true);
        setNotice(`Inserted “${component.name}” as Master Component + linked Instance.`);
      }
      return;
    }

    const nodes = instantiateTemplateNodes(template, origin);
    const result = focusedCommandClient.createNodes(nodes, `Insert "${template.name}" template`);
    if (result.status === 'applied') {
      const rootIds = nodes.filter((node) => !node.parentId).map((node) => node.id);
      focusedCommandClient.selectNodes(rootIds.length > 0 ? rootIds : [nodes[0].id], `Select inserted ${template.name}`);
      setWorkspaceTools((current) => ({ ...current, [activeEditorId]: 'select' }));
      setToolRackOpen(null);
      windows.setInspectorVisible(true);
      setNotice(`Inserted “${template.name}” (${nodes.length} layers).`);
    }
  };

  const switchPage = (page: FolioPage) => {
    if (isHydrating || page.id === activePageId) return;
    setActiveEditorId('main');
    mainCommandClient.setActivePage(page.id, 'Switch active page');
    closePagesRack();
    windows.setInspectorVisible(true);
    setNotice(`Switched to ${page.name}.`);
  };

  const addPage = () => {
    if (isHydrating) return;
    const name = pageNameDraft.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `page-${pages.length + 1}`;
    const route = `/${slug}`;
    if (pages.some((page) => page.route === route)) {
      setNotice('A page with this route already exists.');
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now()}`;
    const document = {
      ...createEmptyDocument(name, activeDocument.width, activeDocument.height),
      background: activeDocument.background,
    };
    mainCommandClient.createPage({ id, name, route, document }, 'Create page');
    setPageNameDraft('');
    closePagesRack();
    windows.setInspectorVisible(true);
    setNotice(`Created ${name}.`);
  };

  const commitProjectName = (value: string) => {
    if (isHydrating) return;
    const name = value.trim();
    if (name && name !== state.project.metadata.name) {
      mainCommandClient.renameProject(name);
    }
  };

  const handleProjectFileSelected = async (file: File) => {
    try {
      const project = await openProjectFile(file, async (loadedProject) => {
        await saveProjectAndActivate(loadedProject);
        mainCommandClient.replaceProject(loadedProject, 'Open .flop project');
      });
      if (!project) return;
      setActiveEditorId('main');
      componentMaster.setEditingComponentId(null);
      windows.setComponentCanvasClosed(true);
      windows.setComponentCanvasMinimized(false);
      setNotice('Opened "' + project.metadata.name + '".');
    } catch (error) {
      console.error('Folio could not open the selected project file:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to open project: ' + detail);
    }
  };

  const exportCurrentProject = () => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const exportSnapshot = createProjectExportSnapshot(
        state.project,
        componentMaster.editingComponentId,
        componentState.project,
      );
      downloadProject(exportSnapshot);
      setNotice('Project exported successfully as a .flop file.');
    } catch (error) {
      console.error('Folio could not export the current project:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export project: ' + detail);
    }
  };

  const exportActiveCanvasSvg = () => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const target = resolveActiveExportTarget(
        activeEditorId,
        state.project,
        componentDocument,
        componentMaster.editingComponentId,
      );
      downloadSvgDocument(target.document, state.project.components, target.name);
      setNotice(`Exported "${target.name}" as standalone SVG.`);
    } catch (error) {
      console.error('Folio could not export SVG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export SVG: ' + detail);
    }
  };

  const exportActiveCanvasPng = async () => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const target = resolveActiveExportTarget(
        activeEditorId,
        state.project,
        componentDocument,
        componentMaster.editingComponentId,
      );
      const result = await downloadPngDocument(target.document, state.project.components, target.name, 2);
      setNotice(`Exported "${target.name}" as PNG (${result.width}×${result.height}px @2×).`);
    } catch (error) {
      console.error('Folio could not export PNG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export PNG: ' + detail);
    }
  };

  const insertOwnedComponent = (component: ComponentDefinition) => {
    if (isHydrating) return;
    const offset = state.project.pages.find((page) => page.id === state.project.activePageId)?.document.nodes.length ?? 0;
    const instance = createComponentInstance(component, 150 + (offset % 4) * 28, 130 + (offset % 4) * 28);
    const result = mainCommandClient.createNodes([instance], 'Insert component instance');
    if (result.status !== 'applied') return;
    windows.openMainCanvas();
    windows.setInspectorVisible(true);
    setNotice(`Linked instance of “${component.name}” added to Main Canvas.`);
  };

  // Inspector & vector/transform operations
  const updateSelected = (patch: Partial<DesignNode>) => {
    if (!selectedNode) return;
    const safePatch = { ...patch };
    if ('width' in patch) safePatch.width = normalizePositiveDimension(Number(patch.width), selectedNode.width);
    if ('height' in patch) safePatch.height = normalizePositiveDimension(Number(patch.height), selectedNode.height);
    if ('opacity' in patch) {
      const rawOpacity = Number(patch.opacity);
      safePatch.opacity = Number.isFinite(rawOpacity) ? Math.min(1, Math.max(0, rawOpacity)) : selectedNode.opacity;
    }

    let nextNode: DesignNode;
    if (selectedNode.type === 'path' && ('width' in safePatch || 'height' in safePatch)) {
      const nextX = 'x' in safePatch && typeof safePatch.x === 'number' ? safePatch.x : selectedNode.x;
      const nextY = 'y' in safePatch && typeof safePatch.y === 'number' ? safePatch.y : selectedNode.y;
      const nextW = typeof safePatch.width === 'number' ? safePatch.width : selectedNode.width;
      const nextH = typeof safePatch.height === 'number' ? safePatch.height : selectedNode.height;
      const scaled = scalePathNodeGeometry(selectedNode, nextX, nextY, nextW, nextH);
      nextNode = { ...scaled, ...safePatch, points: scaled.points, subpaths: scaled.subpaths } as DesignNode;
    } else {
      nextNode = { ...selectedNode, ...safePatch } as DesignNode;
    }
    focusedCommandClient.editNode(nextNode, 'inspector:' + selectedNode.id, 'Edit layer properties');
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
    const detached = detachComponentInstance(selectedNode, master);
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

  const mainToolOperationExecutor = createToolOperationExecutor({
    workspace: 'main',
    commandClient: mainCommandClient,
    shell: {
      isHydrating: () => isHydrating,
      onSelectionChange: (nodeIds) => {
        selectionSourceRef.current = 'canvas';
        mainCommandClient.selectNodes(nodeIds, 'Select layers on canvas');
        if (nodeIds.length > 0) windows.setInspectorVisible(true);
      },
      onPanChange: windows.setMainPan,
      onZoomChange: windows.setZoom,
      onToolChange: (nextTool) => chooseCanvasTool(nextTool, 'main'),
      onNotice: setNotice,
      onSampledColorOptionChange: (color, colorTarget) => {
        setToolOptions((current) =>
          colorTarget === 'stroke' ? { ...current, strokeColor: color } : { ...current, fillColor: color },
        );
      },
      onCanvasMutationCommitted: (kind) => {
        selectionSourceRef.current = 'canvas';
        if (kind === 'create') windows.setInspectorVisible(true);
      },
    },
  });

  const componentToolOperationExecutor = createToolOperationExecutor({
    workspace: 'component',
    commandClient: componentCommandClient,
    shell: {
      isHydrating: () => isHydrating,
      onSelectionChange: (nodeIds) => {
        selectionSourceRef.current = 'canvas';
        componentCommandClient.selectNodes(nodeIds, 'Select layers on component canvas');
      },
      onPanChange: windows.setComponentCanvasPan,
      onZoomChange: windows.setComponentCanvasZoom,
      onToolChange: (nextTool) => chooseCanvasTool(nextTool, 'component'),
      onNotice: setNotice,
      onSampledColorOptionChange: (color, colorTarget) => {
        setToolOptions((current) =>
          colorTarget === 'stroke' ? { ...current, strokeColor: color } : { ...current, fillColor: color },
        );
      },
      onCanvasMutationCommitted: () => {
        selectionSourceRef.current = 'canvas';
      },
    },
  });

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
    const result = applyPathfinderOperation(candidates, operation, newId);
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

  // Clipboard & duplication
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
      componentId: target === 'component' ? componentMaster.editingComponentId : null,
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
      componentId: target === 'component' ? componentMaster.editingComponentId : null,
      components: state.project.components,
    });
    if (prepared.nodes.length === 0) return;
    clipboardRef.current = { ...clipboardRef.current, pasteCount: prepared.nextPasteCount };
    selectionSourceRef.current = 'canvas';
    getCommandClient(target).createNodes(prepared.nodes, 'Paste layers');
    windows.setInspectorVisible(true);
    if (prepared.detachedCircularCount > 0) {
      setNotice(
        `Pasted ${prepared.nodes.length} layer${prepared.nodes.length === 1 ? '' : 's'} (${prepared.detachedCircularCount} self-referencing component instance detached to prevent recursion).`,
      );
    } else {
      setNotice(`Pasted ${prepared.nodes.length} layer${prepared.nodes.length === 1 ? '' : 's'}.`);
    }
  };

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
    setViewMenuOpen(false);
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
    copySelection,
    cutSelection,
    pasteSelection,
    duplicateSelection,
    chooseCanvasTool,
    setNotice,
  });

  const mainCanvasVisible = !windows.canvasClosed
    && !windows.canvasMinimized
    && !(windows.componentCanvasOpen && !windows.componentCanvasFloating && !windows.canvasFloating)
    && !(windows.nodeLogicOpen && !windows.nodeLogicFloating && !windows.canvasFloating);

  const componentCanvasVisible = !windows.componentCanvasClosed
    && !windows.componentCanvasMinimized
    && !(windows.nodeLogicOpen && !windows.nodeLogicFloating && !windows.componentCanvasFloating);

  const pendingOpenComponentName = componentMaster.pendingComponentOpenId
    ? (state.project.components.find((item) => item.id === componentMaster.pendingComponentOpenId)?.name ?? 'another master')
    : null;

  return (
    <div
      ref={appShellRef}
      class={`app-shell ${windows.layersVisible ? '' : 'layers-hidden'} ${windows.inspectorVisible ? '' : 'inspector-hidden'} ${isHydrating ? 'is-hydrating' : ''} ${panelResize.resizingPanel ? 'is-resizing-panel' : ''}`}
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
        fileMenuOpen={fileMenuOpen}
        viewMenuOpen={viewMenuOpen}
        helpMenuOpen={helpMenuOpen}
        menuBarRef={menuBarRef}
        projectFileInputRef={projectFileInputRef}
        pagesRackToggleRef={pagesRackToggleRef}
        componentRackToggleRef={componentRackToggleRef}
        projectNameEditing={projectNameEditing}
        projectNameDraft={projectNameDraft}
        pagesRackOpen={windows.pagesRackOpen}
        componentRackOpen={windows.componentRackOpen}
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
        shortcutsModalOpen={shortcutsModalOpen}
        toolbarHintStore={toolbarHintStore}
        onToggleFileMenu={() => { setFileMenuOpen((open) => !open); setViewMenuOpen(false); setHelpMenuOpen(false); setToolRackOpen(null); }}
        onToggleViewMenu={() => { setViewMenuOpen((open) => !open); setFileMenuOpen(false); setHelpMenuOpen(false); setToolRackOpen(null); }}
        onToggleHelpMenu={() => { setHelpMenuOpen((open) => !open); setFileMenuOpen(false); setViewMenuOpen(false); setToolRackOpen(null); }}
        onOpenProjectPicker={() => { if (isHydrating) return; setFileMenuOpen(false); projectFileInputRef.current?.click(); }}
        onProjectFileSelected={handleProjectFileSelected}
        onExportCurrentProject={exportCurrentProject}
        onExportActiveCanvasSvg={exportActiveCanvasSvg}
        onExportActiveCanvasPng={exportActiveCanvasPng}
        onResetWindowLayout={resetWindowLayout}
        onOpenShortcutsModal={openShortcutsModal}
        onStartProjectRename={() => {
          setProjectNameDraft(state.project.metadata.name);
          projectNameCancelRef.current = false;
          setProjectNameEditing(true);
        }}
        onProjectNameDraftChange={setProjectNameDraft}
        onCommitProjectRename={() => {
          if (!projectNameCancelRef.current) commitProjectName(projectNameDraft);
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
          else {
            windows.focusWindow('pages');
            windows.setPagesRackOpen(true);
            closeComponentRack();
          }
        }}
        onToggleComponentRack={() => {
          setToolRackOpen(null);
          if (windows.componentRackOpen) closeComponentRack();
          else {
            windows.setComponentRackOpen(true);
            closePagesRack();
          }
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
            windows.setComponentCanvasClosed(true);
            windows.setComponentCanvasMinimized(false);
            setActiveEditorId('main');
            if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
          }
        }}
        onToggleNodeLogic={() => {
          if (windows.nodeLogicClosed || windows.nodeLogicMinimized) windows.openNodeLogic();
          else { windows.setNodeLogicClosed(true); windows.setNodeLogicMinimized(false); }
        }}
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
        templateInsertMode={templateInsertMode}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        onCloseTopMenus={() => { setFileMenuOpen(false); setViewMenuOpen(false); setHelpMenuOpen(false); }}
        onToggleToolRack={setToolRackOpen}
        onChooseTool={(toolId) => chooseCanvasTool(toolId, activeEditorId)}
        onTemplateInsertModeChange={setTemplateInsertMode}
        onInsertTemplate={insertTemplate}
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
        layerSourceNodes={layerSourceNodes}
        layerRows={layerRows}
        layerEffectiveStates={layerEffectiveStates}
        selectedNodeIds={focusedEditor.state.selectedNodeIds}
        collapsedLayerIds={activeCollapsedLayers ?? []}
        layerDropTarget={layerDropTarget}
        layerRename={layerRename}
        layerRenameInputRef={layerRenameInputRef}
        layerColorPickerKey={layerColorPickerKey}
        onStartResize={panelResize.startPanelResize}
        onResizeDoubleClick={panelResize.handlePanelResizeDoubleClick}
        onResizeKeyDown={panelResize.handlePanelResizeKeyDown}
        onHoverHint={() => updateToolbarHint(
          'LAYERS',
          'Each Layer is one object. Drag an object that is off Canvas to restore it; an object already on Canvas cannot be duplicated by dragging.',
          ['CTRL/CMD + M: MASK', 'CTRL/CMD + SHIFT + M: UNMASK'],
        )}
        onSelectLayer={selectLayerFromPanel}
        onOpenContextMenu={openLayerContextMenu}
        onStartDrag={startLayerDrag}
        onDragOver={updateLayerDropTarget}
        onDrop={dropLayer}
        onDragEnd={() => {
          layerDragSourceRef.current = null;
          layerDragEditorRef.current = null;
          setLayerDropTarget(null);
        }}
        onDragLeave={(nodeId) => setLayerDropTarget((current) => current?.nodeId === nodeId ? null : current)}
        onToggleCollapsed={toggleLayerCollapsed}
        onUpdateRenameDraft={updateLayerRenameDraft}
        onFinishRename={finishLayerRename}
        onToggleColorPicker={(nodeId, anchor) => {
          const key = `${activeEditorId}:${nodeId}`;
          if (layerColorPickerKey === key) {
            setLayerColorPickerKey(null);
            setLayerColorPickerPosition(null);
            layerColorAnchorRef.current = null;
            return;
          }
          layerColorAnchorRef.current = anchor;
          const pos = computeClampedPopoverPosition(
            anchor.getBoundingClientRect(),
            { width: 170, height: 160 },
            { width: window.innerWidth, height: window.innerHeight },
          );
          setLayerColorPickerPosition(pos);
          setLayerColorPickerKey(key);
        }}
        onToggleLayerProperty={toggleLayerPropertyFromRow}
      />

      <MainCanvasWindow
        visible={mainCanvasVisible}
        minimized={windows.canvasMinimized}
        closed={windows.canvasClosed}
        floating={windows.canvasFloating}
        position={windows.canvasPosition}
        size={windows.canvasSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'main-canvas')}
        document={activeDocument}
        components={state.project.components}
        selectedNodeIds={state.selectedNodeIds}
        selectedNodes={selectedNodes}
        toolId={workspaceTools.main}
        toolOptions={toolOptions}
        zoom={windows.zoom}
        pan={windows.mainView.pan}
        canUndo={focusedEditor.state.past.length > 0}
        canRedo={focusedEditor.state.future.length > 0}
        onPositionChange={windows.setCanvasPosition}
        onSizeChange={windows.setCanvasSize}
        onFocus={() => {
          windows.focusWindow('main-canvas');
          setActiveEditorId('main');
          selectionSourceRef.current = 'canvas';
        }}
        onFocusMinimized={() => {
          windows.focusWindow('main-canvas');
          setActiveEditorId('main');
        }}
        onHoverHint={() => updateToolbarHint(
          'CANVAS',
          'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.',
          ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'],
        )}
        onAlign={(alignment) => alignSelection(alignment, 'main')}
        onDistribute={(axis) => distributeSelection(axis, 'main')}
        onUndo={() => focusedCommandClient.undo()}
        onRedo={() => focusedCommandClient.redo()}
        onZoomChange={windows.setZoom}
        onMinimize={() => windows.setCanvasMinimized(true)}
        onRestore={() => windows.setCanvasMinimized(false)}
        onToggleFloating={() => windows.setCanvasWindowMode(windows.canvasFloating ? 'docked' : 'floating')}
        onClose={() => {
          windows.setCanvasClosed(true);
          windows.setCanvasMinimized(false);
          windows.setCanvasWindowMode('docked');
        }}
        onCloseMinimized={() => {
          windows.setCanvasClosed(true);
          windows.setCanvasMinimized(false);
        }}
        onChangeToolOptions={updateToolOptions}
        onPathfinder={(op) => handlePathfinder('main', op)}
        onConvertToPath={() => handleConvertToPath('main')}
        onFlip={(axis) => handleFlipSelection('main', axis)}
        onRotate90={() => handleRotate90('main')}
        onSimplifyPath={() => handleSimplifyPath('main')}
        onTogglePathClosed={() => handleTogglePathClosed('main')}
        onSelectTool={(nextTool) => chooseCanvasTool(nextTool, 'main')}
        onToolOperation={(operation) => mainToolOperationExecutor.execute(operation)}
        onToolOperationBatch={(operations) => mainToolOperationExecutor.executeBatch(operations)}
        onLayerDrop={(nodeIds) => dropLayersOnCanvas(nodeIds, 'main')}
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
        onFocus={() => {
          windows.focusWindow('component-canvas');
          setActiveEditorId('component');
          selectionSourceRef.current = 'canvas';
        }}
        onFocusMinimized={() => {
          windows.focusWindow('component-canvas');
          setActiveEditorId('component');
        }}
        onHoverHint={() => updateToolbarHint(
          'COMPONENT CANVAS',
          'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.',
          ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'],
        )}
        onReloadRecoveredMaster={componentMaster.reloadRecoveredComponentMaster}
        onKeepCurrentBuffer={componentMaster.keepCurrentComponentBuffer}
        onDiscardAndOpenPending={componentMaster.discardBufferAndOpenPendingMaster}
        onOpenCleanupDialog={() => componentMaster.setComponentDeletionDialogOpen(true)}
        onSaveMaster={componentMaster.saveComponentCanvasMaster}
        onSaveSelectionAsNew={() => componentMaster.saveNodesAsComponent(componentMaster.selectedComponentNodes, componentDocument.nodes)}
        onAlign={(alignment) => alignSelection(alignment, 'component')}
        onDistribute={(axis) => distributeSelection(axis, 'component')}
        onUndo={() => componentCommandClient.undo()}
        onRedo={() => componentCommandClient.redo()}
        onZoomChange={windows.setComponentCanvasZoom}
        onMinimize={() => {
          windows.setComponentCanvasMinimized(true);
          setActiveEditorId('main');
          if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
        }}
        onRestore={() => windows.setComponentCanvasMinimized(false)}
        onToggleFloating={() => windows.setComponentCanvasWindowMode(windows.componentCanvasFloating ? 'docked' : 'floating')}
        onClose={() => {
          windows.setComponentCanvasClosed(true);
          windows.setComponentCanvasMinimized(false);
          windows.setComponentCanvasWindowMode('docked');
          setActiveEditorId('main');
          if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
        }}
        onCloseMinimized={() => {
          windows.setComponentCanvasClosed(true);
          windows.setComponentCanvasMinimized(false);
        }}
        onChangeToolOptions={updateToolOptions}
        onPathfinder={(op) => handlePathfinder('component', op)}
        onConvertToPath={() => handleConvertToPath('component')}
        onFlip={(axis) => handleFlipSelection('component', axis)}
        onRotate90={() => handleRotate90('component')}
        onSimplifyPath={() => handleSimplifyPath('component')}
        onTogglePathClosed={() => handleTogglePathClosed('component')}
        onSelectTool={(nextTool) => chooseCanvasTool(nextTool, 'component')}
        onToolOperation={(operation) => componentToolOperationExecutor.execute(operation)}
        onToolOperationBatch={(operations) => componentToolOperationExecutor.executeBatch(operations)}
        onLayerDrop={(nodeIds) => dropLayersOnCanvas(nodeIds, 'component')}
      />

      <NodeLogicWindow
        visible={!windows.nodeLogicClosed && !windows.nodeLogicMinimized}
        minimized={windows.nodeLogicMinimized}
        closed={windows.nodeLogicClosed}
        floating={windows.nodeLogicFloating}
        position={windows.nodeLogicPosition}
        size={windows.nodeLogicSize}
        zIndex={getWindowZIndex(windows.windowOrder, 'node-logic')}
        onPositionChange={windows.setNodeLogicPosition}
        onSizeChange={windows.setNodeLogicSize}
        onFocus={() => windows.focusWindow('node-logic')}
        onHoverHint={() => updateToolbarHint('NODE LOGIC', 'Node Logic workspace for building visual logic flows.')}
        onMinimize={() => windows.setNodeLogicMinimized(true)}
        onRestore={() => windows.setNodeLogicMinimized(false)}
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
        selectedNode={selectedNode}
        selectedNodes={focusedEditor.selectedNodes}
        selectedCount={focusedEditor.state.selectedNodeIds.length}
        canRemoveFromCanvas={selectionSourceRef.current !== 'layers'}
        selectedInstanceComponent={selectedInstanceComponent}
        instanceOverrideTargets={instanceOverrideTargets}
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
          updateToolbarHint('INSPECTOR', 'Edit the selected layer’s position, dimensions, appearance and options.')
        }
        onRemoveFromCanvas={(nodeId) => {
          focusedCommandClient.setNodesCanvasState([nodeId], false, 'Remove from canvas');
        }}
        onUpdateSelected={updateSelected}
        onUpdateSelectedStyle={updateSelectedStyle}
        onUpdateInstanceOverride={updateInstanceOverride}
        onResetInstanceOverrides={resetInstanceOverrides}
        onDetachInstance={detachSelectedInstance}
        onConvertToPath={handleConvertToPath}
        onTogglePathClosed={handleTogglePathClosed}
        onSimplifyPath={handleSimplifyPath}
        onChooseTool={chooseCanvasTool}
        onQuickAdd={addNode}
        onDuplicateSelection={() => duplicateSelection(activeEditorId)}
        onCopySelection={() => copySelection(activeEditorId)}
      />

      <PagesRackPanel
        panelRef={pagesRackRef}
        open={windows.pagesRackOpen}
        pages={pages}
        activePageId={activePageId}
        pageNameDraft={pageNameDraft}
        onFocus={() => windows.focusWindow('pages')}
        onPageNameDraftChange={setPageNameDraft}
        onAddPage={addPage}
        onSwitchPage={switchPage}
        onClose={closePagesRack}
      />

      <ComponentRackPanel
        panelRef={componentRackRef}
        open={windows.componentRackOpen}
        components={ownedComponents}
        searchQuery={componentRackSearch}
        canSaveSelection={selectedNodes.length > 0}
        renamingComponentId={componentMaster.renamingComponentId}
        componentNameDraft={componentMaster.componentNameDraft}
        onSearchChange={setComponentRackSearch}
        onCreateNewMaster={componentMaster.createNewMasterComponent}
        onSaveSelection={() => componentMaster.saveNodesAsComponent(focusedEditor.selectedNodes, focusedDocument.nodes)}
        onClose={closeComponentRack}
        onInsertComponent={insertOwnedComponent}
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
      />

      <LayerColorPalette
        pickerKey={layerColorPickerKey}
        activeEditorId={activeEditorId}
        layerSourceNodes={layerSourceNodes}
        position={layerColorPickerPosition}
        paletteRef={layerColorPaletteRef}
        onSelectPresetColor={(nodeId, color) => {
          setLayerColorFromRow(nodeId, color);
          setLayerColorPickerKey(null);
          setLayerColorPickerPosition(null);
          layerColorAnchorRef.current = null;
        }}
        onSelectCustomColor={setLayerColorFromRow}
      />

      <LayerContextMenu
        menu={layerContextMenu}
        menuRef={layerContextMenuRef}
        targetNodeName={
          layerContextMenu
            ? (contextMenuNodes.find((node) => node.id === layerContextMenu.nodeId)?.name ?? 'layer')
            : 'layer'
        }
        capabilities={contextMenuCapabilities}
        onRename={(nodeId) => {
          setLayerContextMenu(null);
          beginLayerRename(nodeId, false);
        }}
        onGroup={(editorId, rootIds) => {
          setLayerContextMenu(null);
          selectionSourceRef.current = 'layers';
          getCommandClient(editorId).groupLayers(rootIds);
        }}
        onUngroup={(editorId, rootIds) => {
          setLayerContextMenu(null);
          selectionSourceRef.current = 'layers';
          getCommandClient(editorId).ungroupLayers(rootIds);
        }}
        onCreateClippingMask={(editorId, rootId) => {
          setLayerContextMenu(null);
          selectionSourceRef.current = 'layers';
          getCommandClient(editorId).createClippingMask(rootId);
        }}
        onRemoveClippingMask={(editorId, rootId) => {
          setLayerContextMenu(null);
          selectionSourceRef.current = 'layers';
          getCommandClient(editorId).removeClippingMask(rootId);
        }}
        onDelete={(editorId, nodeIds) => {
          setLayerContextMenu(null);
          selectionSourceRef.current = 'layers';
          getCommandClient(editorId).deleteNodes(nodeIds);
        }}
      />

      <StatusBar
        layerCount={activeDocument.nodes.length}
        documentWidth={activeDocument.width}
        documentHeight={activeDocument.height}
        isHydrating={isHydrating}
        saveStatus={saveStatus}
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

      <KeyboardShortcutsModal
        open={shortcutsModalOpen && !componentMaster.componentDeletionDialogOpen}
        activeWorkspace={activeEditorId}
        onClose={closeShortcutsModal}
        hostRef={shortcutsModalHostRef}
        dialogRef={shortcutsDialogRef}
      />

      <ProjectHydrationOverlay visible={isHydrating} />
      {notice && <div class="toast" role="status">{notice}</div>}
    </div>
  );
}

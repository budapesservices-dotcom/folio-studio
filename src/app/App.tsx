import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEmptyDocument, createInitialProject, createNodeForDocument } from '../core/document/factory';
import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioDocument, FolioPage, FolioProject } from '../core/document/types';
import { expandSelectedLayerIds, getLayerAncestorIds, getEffectiveLayerStates, getLayerPanelRows, getSelectedLayerRootIds, getClippingMaskBaseId, type LayerDropPosition } from '../core/document/layers';
import { buildComponentDefinitionFromNodes, createComponentInstance, detachComponentInstance, getComponentOverrideTargets } from '../core/document/components';
import { getActiveDocument, getActivePage } from '../core/document/project';
import { loadMostRecentProject, loadProjectById, saveProject, saveProjectIfRevisionCurrent, saveProjectAndActivate, withProjectWriteLock } from '../core/persistence/indexedDb';
import { downloadProject } from '../core/persistence/projectFile';
import { createProjectExportSnapshot } from './projectExport';
import { openProjectFile } from './projectFileActions';
import { Canvas } from '../engines/canvas/Canvas';
import { CANVAS_TOOL_GROUPS, getCanvasTool, type CanvasToolGroupId, type CanvasToolId } from '../engines/canvas/tools/registry';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../engines/canvas/geometry';
import { createEditorState, editorReducer, normalizePositiveDimension } from './editorReducer';
import type { EditorAction } from './editorReducer';
import { createCanonicalEditorStore } from './editorStore';
import {
  advanceComponentCanvasSyncSession,
  createComponentCanvasBufferProject,
  createComponentCanvasSyncAction,
  createComponentCanvasSyncSession,
  reconcileComponentCanvasSyncSession,
  markComponentCanvasMasterMissing,
  shouldProtectComponentCanvasBuffer,
  type ComponentCanvasSyncSession,
} from './componentCanvasSync';
import {
  deleteComponentAfterDurableRecovery,
  deleteComponentDurably,
  recoverAndDeleteComponentDurably,
  requestComponentDeletion,
} from './componentDeletion';
import { FloatingWindow } from './FloatingWindow';
import { ComponentThumbnail } from './ComponentThumbnail';
import {
  DEFAULT_RESIZE_THROTTLE_MS,
  PANEL_RESIZE_CONSTRAINTS,
  clampPanelWidth,
  computeResizedPanelWidth,
  createThrottledMouseMove,
  getDefaultPanelWidths,
  getPanelWidthBounds,
  loadPanelWidths,
  savePanelWidths,
  type PanelWidths,
  type ResizablePanelId,
} from './panelResize';
import { createDebouncedAutosave, setRevisionFencedAutosaveStatus } from './debouncedAutosave';
import { activateModalDialog, trapModalDialogKeydown } from './modalFocus';
import { getActiveEditorContext, getTransformableNodes, type EditorTarget } from './editorContext';
import { bringWindowToFront, getDefaultWindowLayouts, getWindowZIndex, recoverWindowLayout, type WindowId } from './windowManager';
import { loadWorkspacePreferences, saveWorkspacePreferences, type WorkspaceKind, type WorkspaceLayoutV1, type WorkspacePreferencesLoadResult } from './workspacePreferences';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    cursor: 'M5 3l14 9-6 1.5L10 20 5 3z',
    directSelection: 'M4 3l15 10-6 1 4 7-3 1-4-7-4 5z',
    lasso: 'M12 3c5 0 9 3 9 7s-4 8-9 8-9-3-9-7 4-8 9-8zM5 19l-1 2m6-1-1 2m7-3 1 2',
    magicWand: 'm4 20 12-12m-9 9 3 3m5-17v4m-2-2h4m5 7v4m-2-2h4m-9 5v3m-2-1h4',
    hand: 'M8 11V5a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-3-4a2 2 0 0 1 3-3z',
    scrubbyZoom: 'M5 12h14m-5-5 5 5-5 5M9 7 4 12l5 5',
    shapes: 'M4 5h8v8H4zM15 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 17h16',
    rect: 'M4 5h16v14H4z',
    ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    text: 'M4 5h16M12 5v14M8 19h8',
    layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
    export: 'M12 3v12m0-12 4 4m-4-4-4 4M5 14v6h14v-6',
    import: 'M12 15V3m0 12 4-4m-4 4-4-4M5 14v6h14v-6',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
    redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2',
    trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.9M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9 9 0 0 0 3.2-.6',
    lock: 'M5 10h14v11H5zM8 10V7a4 4 0 1 1 8 0v3',
    unlock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 7.5-2',
    chevronDown: 'm6 9 6 6 6-6',
    chevronRight: 'm9 18 6-6-6-6',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    chevron: 'm9 18 6-6-6-6',
    clipArrow: 'M20 4H8V16m-4-4 4 4 4-4',
    save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
    fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    sidebar: 'M4 4h16v16H4zM9 4v16',
    canvas: 'M3 4h18v16H3zM7 8h10v8H7z',
    componentCanvas: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    logicNodes: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h3a3 3 0 0 1 3 3v4',
    inspector: 'M4 4h16v16H4zM15 4v16',
    rack: 'M3 5h18v14H3zM7 9h4v6H7zM14 9h3M14 12h3M14 15h3',
    pages: 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8',
    edit: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l4 4',
    copyPlus: 'M8 8h11v11H8zM5 16H4V4h12v1M13.5 11v5M11 13.5h5',
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
      <path d={paths[name] ?? paths.layers} />
    </svg>
  );
}

function LayerIcon({ type }: { type: DesignNode['type'] }) {
  const glyph = type === 'group' ? '▣' : type === 'text' ? 'T' : type === 'ellipse' ? '○' : type === 'component-instance' ? '◇' : '□';
  return <span class={`layer-type layer-type-${type}`}>{glyph}</span>;
}

type ToolRackGroupId = CanvasToolGroupId | 'create';

type ToolbarHint = {
  panel: string;
  description: string;
  shortcuts: string[];
};

const DEFAULT_TOOLBAR_HINT: ToolbarHint = {
  panel: 'WORKSPACE',
  description: 'Click a parent to select its full hierarchy; click a nested layer to select only that object.',
  shortcuts: ['SHIFT + CLICK: EXACT LAYER', 'CTRL/CMD + CLICK: GROUP TOGGLE'],
};

function parseNumericInput(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type CanvasViewState = { zoom: number; pan: { x: number; y: number } };
type LayerRenameSession = {
  anchorId: string;
  nodeIds: string[];
  value: string;
  batch: boolean;
  editorId: EditorTarget;
  existingNames: string[];
};
type LayerContextMenuState = {
  nodeId: string;
  nodeIds: string[];
  editorId: EditorTarget;
  x: number;
  y: number;
};
const LAYER_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7',
  '#ec4899', '#94a3b8',
];
function readCanvasViewState(key: string): CanvasViewState {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return {
      zoom: Number.isFinite(value?.zoom) ? Math.min(2, Math.max(0.35, value.zoom)) : 0.82,
      pan: { x: Number.isFinite(value?.pan?.x) ? value.pan.x : 0, y: Number.isFinite(value?.pan?.y) ? value.pan.y : 0 },
    };
  } catch { return { zoom: 0.82, pan: { x: 0, y: 0 } }; }
}

export function App() {
  const workspacePreferencesLoadRef = useRef<WorkspacePreferencesLoadResult | null>(null);
  if (workspacePreferencesLoadRef.current === null) {
    workspacePreferencesLoadRef.current = loadWorkspacePreferences({
      viewport: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      },
    });
  }
  const initialWorkspacePreferences = workspacePreferencesLoadRef.current!;
  const initialWorkspaceLayout = initialWorkspacePreferences.layout;
  const initialWorkspaceWindow = (workspace: WorkspaceKind) =>
    initialWorkspaceLayout.windows.find((record) => record.workspace === workspace)!;
  const initialMainWindow = initialWorkspaceWindow('main-canvas');
  const initialComponentWindow = initialWorkspaceWindow('component-canvas');
  const initialNodeLogicWindow = initialWorkspaceWindow('node-logic');
  const initialWorkspaceOrder = initialWorkspaceLayout.stackOrder.flatMap((instanceId) => {
    const record = initialWorkspaceLayout.windows.find((candidate) =>
      candidate.windowInstanceId === instanceId,
    );
    return record ? [record.workspace] : [];
  });
  const initialPreferencesNeedReview =
    initialWorkspacePreferences.status === 'migrated' ||
    initialWorkspacePreferences.status === 'recovered' ||
    initialWorkspacePreferences.status === 'malformed';
  const workspacePreferencesReplaceMalformedRef = useRef(
    initialWorkspacePreferences.status === 'malformed',
  );
  const [workspacePreferencesPersistenceEnabled, setWorkspacePreferencesPersistenceEnabled] =
    useState(
      initialWorkspacePreferences.status === 'valid' ||
      initialWorkspacePreferences.status === 'missing',
    );
  const [workspacePreferencesReviewRequired, setWorkspacePreferencesReviewRequired] =
    useState(initialPreferencesNeedReview);

  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
  const canonicalStore = useMemo(() => createCanonicalEditorStore(initialEditorState), []);
  const [state, setState] = useState(() => canonicalStore.getSnapshot().editorState);
  const dispatch = useCallback((action: EditorAction) => {
    const transition = canonicalStore.dispatchLegacyAction(action);
    setState(transition.snapshot.editorState);
    return transition;
  }, [canonicalStore]);
  useEffect(() => canonicalStore.subscribe(() => {
    setState(canonicalStore.getSnapshot().editorState);
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
  const [componentState, componentDispatch] = useReducer(editorReducer, componentInitialState);
  const [componentReady, setComponentReady] = useState(false);
  const componentSyncSessionRef = useRef<ComponentCanvasSyncSession | null>(null);
  const [componentRecoveryStatus, setComponentRecoveryStatus] = useState<'none' | 'missing' | 'returned' | 'conflict' | 'switch-pending'>('none');
  const [pendingComponentOpenId, setPendingComponentOpenId] = useState<string | null>(null);
  const [pendingComponentDeletion, setPendingComponentDeletion] = useState<ComponentDefinition | null>(null);
  const [componentDeletionDialogOpen, setComponentDeletionDialogOpen] = useState(false);
  const [componentDeletionMode, setComponentDeletionMode] = useState<'recovery' | 'clean' | 'cleanup'>('recovery');
  const [componentDeletionBusy, setComponentDeletionBusy] = useState(false);
  const [componentCleanupPending, setComponentCleanupPending] = useState(false);
  const [durableRecoveryComponentId, setDurableRecoveryComponentId] = useState<string | null>(null);
  const pendingComponentDeletionRef = useRef(false);
  const componentSyncPauseAfterCancelRef = useRef<FolioDocument | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const deletionModalHostRef = useRef<HTMLDivElement | null>(null);
  const deletionDialogRef = useRef<HTMLElement | null>(null);
  const deletionFocusReturnRef = useRef<HTMLElement | null>(null);
  const [componentSaveStatus, setComponentSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [componentSaveError, setComponentSaveError] = useState<string | null>(null);
  const componentAutosave = useMemo(() => createDebouncedAutosave<FolioProject>(
    (project) => saveProject(project),
    (status, error) => {
      setComponentSaveStatus(status);
      setComponentSaveError(status === 'error'
        ? (error instanceof Error ? error.message : 'The Component Canvas buffer could not be saved.')
        : null);
    },
    450,
  ), []);
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const isHydrating = !isProjectLoaded || !componentReady;
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [mainView, setMainView] = useState<CanvasViewState>(() => readCanvasViewState('folio.main-canvas-view'));
  const [componentView, setComponentView] = useState<CanvasViewState>(() => readCanvasViewState('folio.component-canvas-view'));
  const zoom = mainView.zoom;
  const setZoom = (next: number | ((current: number) => number)) => setMainView((view) => ({ ...view, zoom: typeof next === 'function' ? next(view.zoom) : next }));
  const componentCanvasZoom = componentView.zoom;
  const setComponentCanvasZoom = (next: number | ((current: number) => number)) => setComponentView((view) => ({ ...view, zoom: typeof next === 'function' ? next(view.zoom) : next }));
  const setMainPan = (pan: { x: number; y: number }) => setMainView((view) => ({ ...view, pan }));
  const setComponentCanvasPan = (pan: { x: number; y: number }) => setComponentView((view) => ({ ...view, pan }));
  const [toolbarHint, setToolbarHint] = useState<ToolbarHint>(DEFAULT_TOOLBAR_HINT);
  const [activeCanvasToolId, setActiveCanvasToolId] = useState<CanvasToolId>('select');
  const [toolRackOpen, setToolRackOpen] = useState<ToolRackGroupId | null>(null);
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameCancelRef = useRef(false);
  const [layersVisible, setLayersVisible] = useState(() => initialWorkspaceLayout.panelVisibility.layers);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [collapsedLayers, setCollapsedLayers] = useState<Record<EditorTarget, string[]>>({ main: [], component: [] });
  const [layerDropTarget, setLayerDropTarget] = useState<{ nodeId: string; position: LayerDropPosition } | null>(null);
  const [layerContextMenu, setLayerContextMenu] = useState<LayerContextMenuState | null>(null);
  const layerContextMenuRef = useRef<HTMLDivElement | null>(null);
  const layerDragSourceRef = useRef<string[] | null>(null);
  const layerDragEditorRef = useRef<EditorTarget | null>(null);
  const selectionSourceRef = useRef<'layers' | 'canvas'>('canvas');
  const layerSelectionAnchorRef = useRef<Record<EditorTarget, string | null>>({ main: null, component: null });
  const [layerRename, setLayerRename] = useState<LayerRenameSession | null>(null);
  const layerRenameRef = useRef<LayerRenameSession | null>(null);
  const layerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const [layerColorPickerKey, setLayerColorPickerKey] = useState<string | null>(null);
  const layerColorAnchorRef = useRef<HTMLButtonElement | null>(null);
  const layerColorPaletteRef = useRef<HTMLDivElement | null>(null);
  const [layerColorPickerPosition, setLayerColorPickerPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!layerColorPickerKey) return;

    const updatePalettePosition = () => {
      const anchor = layerColorAnchorRef.current;
      const palette = layerColorPaletteRef.current;
      if (!anchor || !palette) return;

      const anchorRect = anchor.getBoundingClientRect();
      const paletteRect = palette.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const left = Math.max(
        margin,
        Math.min(window.innerWidth - paletteRect.width - margin, anchorRect.right - paletteRect.width),
      );
      const belowTop = anchorRect.bottom + gap;
      const top = belowTop + paletteRect.height <= window.innerHeight - margin
        ? belowTop
        : Math.max(margin, anchorRect.top - paletteRect.height - gap);

      setLayerColorPickerPosition((current) => (
        current && Math.abs(current.top - top) < 0.5 && Math.abs(current.left - left) < 0.5
          ? current
          : { top, left }
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
      // Like committing a layer rename with Enter: keep the applied color and dismiss.
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
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handlePaletteKeyDown, true);
    window.addEventListener('resize', updatePalettePosition);
    window.addEventListener('scroll', updatePalettePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      document.removeEventListener('keydown', handlePaletteKeyDown, true);
      window.removeEventListener('resize', updatePalettePosition);
      window.removeEventListener('scroll', updatePalettePosition, true);
    };
  }, [layerColorPickerKey]);
  const [activeEditorId, setActiveEditorId] = useState<EditorTarget>('main');
  const [windowOrder, setWindowOrder] = useState<WindowId[]>(() => [
    ...initialWorkspaceOrder,
    ...(initialWorkspaceLayout.panelVisibility['pages-rack'] ? ['pages' as const] : []),
  ]);
  const [activeWindowId, setActiveWindowId] = useState<WindowId>(
    () => initialWorkspaceLayout.activeWorkspace,
  );
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const toolRailRef = useRef<HTMLElement | null>(null);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(() => loadPanelWidths());
  const [resizingPanel, setResizingPanel] = useState<ResizablePanelId | null>(null);
  const panelWidthsRef = useRef<PanelWidths>(panelWidths);
  panelWidthsRef.current = panelWidths;
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);
  const [componentRackOpen, setComponentRackOpen] = useState(
    () => initialWorkspaceLayout.panelVisibility['component-rack'],
  );
  const [pagesRackOpen, setPagesRackOpen] = useState(
    () => initialWorkspaceLayout.panelVisibility['pages-rack'],
  );
  const pagesRackRef = useRef<HTMLElement | null>(null);
  const componentRackRef = useRef<HTMLElement | null>(null);
  const pagesRackToggleRef = useRef<HTMLButtonElement | null>(null);
  const componentRackToggleRef = useRef<HTMLButtonElement | null>(null);
  const closePagesRack = () => {
    if (pagesRackRef.current?.contains(document.activeElement)) {
      pagesRackToggleRef.current?.focus({ preventScroll: true });
    }
    setPagesRackOpen(false);
  };
  const closeComponentRack = () => {
    if (componentRackRef.current?.contains(document.activeElement)) {
      componentRackToggleRef.current?.focus({ preventScroll: true });
    }
    setComponentRackOpen(false);
  };
  const [pageNameDraft, setPageNameDraft] = useState('');
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;

  const [componentRackSearch, setComponentRackSearch] = useState('');
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [renamingComponentId, setRenamingComponentId] = useState<string | null>(null);
  const [componentNameDraft, setComponentNameDraft] = useState('');
  const ownedComponents = state.project.components;
  const editingComponent = ownedComponents.find((component) => component.id === editingComponentId) ?? null;
  const [canvasMinimized, setCanvasMinimized] = useState(
    () => initialMainWindow.visibility === 'minimized',
  );
  const [canvasClosed, setCanvasClosed] = useState(
    () => initialMainWindow.visibility === 'closed',
  );
  const [canvasWindowMode, setCanvasWindowMode] = useState<'docked' | 'floating'>(
    () => initialMainWindow.presentation,
  );
  const canvasFloating = canvasWindowMode === 'floating';
  const [canvasSize, setCanvasSize] = useState(() => ({
    width: initialMainWindow.geometry.width,
    height: initialMainWindow.geometry.height,
  }));

  const [componentCanvasClosed, setComponentCanvasClosed] = useState(
    () => initialComponentWindow.visibility === 'closed',
  );
  const [componentCanvasMinimized, setComponentCanvasMinimized] = useState(
    () => initialComponentWindow.visibility === 'minimized',
  );
  const [componentCanvasWindowMode, setComponentCanvasWindowMode] =
    useState<'docked' | 'floating'>(() => initialComponentWindow.presentation);
  const componentCanvasFloating = componentCanvasWindowMode === 'floating';
  const componentCanvasOpen = !componentCanvasClosed && !componentCanvasMinimized;
  const [componentCanvasSize, setComponentCanvasSize] = useState(() => ({
    width: initialComponentWindow.geometry.width,
    height: initialComponentWindow.geometry.height,
  }));
  const [componentCanvasPosition, setComponentCanvasPosition] = useState(() => ({
    x: initialComponentWindow.geometry.x,
    y: initialComponentWindow.geometry.y,
  }));

  const [nodeLogicClosed, setNodeLogicClosed] = useState(
    () => initialNodeLogicWindow.visibility === 'closed',
  );
  const [nodeLogicMinimized, setNodeLogicMinimized] = useState(
    () => initialNodeLogicWindow.visibility === 'minimized',
  );
  const [nodeLogicWindowMode, setNodeLogicWindowMode] =
    useState<'docked' | 'floating'>(() => initialNodeLogicWindow.presentation);
  const nodeLogicFloating = nodeLogicWindowMode === 'floating';
  const nodeLogicOpen = !nodeLogicClosed && !nodeLogicMinimized;
  const [nodeLogicSize, setNodeLogicSize] = useState(() => ({
    width: initialNodeLogicWindow.geometry.width,
    height: initialNodeLogicWindow.geometry.height,
  }));
  const [nodeLogicPosition, setNodeLogicPosition] = useState(() => ({
    x: initialNodeLogicWindow.geometry.x,
    y: initialNodeLogicWindow.geometry.y,
  }));

  const [canvasPosition, setCanvasPosition] = useState(() => ({
    x: initialMainWindow.geometry.x,
    y: initialMainWindow.geometry.y,
  }));

  useLayoutEffect(() => {
    if (!fileMenuOpen && !viewMenuOpen) return;
    const closeMenus = () => {
      setFileMenuOpen(false);
      setViewMenuOpen(false);
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
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [fileMenuOpen, viewMenuOpen]);

  useLayoutEffect(() => {
    if (!toolRackOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolRailRef.current?.contains(event.target)) return;
      setToolRackOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setToolRackOpen(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [toolRackOpen]);

  useEffect(() => {
    try { window.localStorage.setItem('folio.main-canvas-view', JSON.stringify(mainView)); }
    catch (error) { console.warn('Folio could not persist Main Canvas view:', error); }
  }, [mainView]);

  useEffect(() => {
    try { window.localStorage.setItem('folio.component-canvas-view', JSON.stringify(componentView)); }
    catch (error) { console.warn('Folio could not persist Component Canvas view:', error); }
  }, [componentView]);

  const workspacePreferencesSnapshot = useMemo<WorkspaceLayoutV1>(() => {
    const currentWindows: WorkspaceLayoutV1['windows'] = [
      {
        ...initialMainWindow,
        visibility: canvasClosed ? 'closed' : canvasMinimized ? 'minimized' : 'open',
        presentation: canvasWindowMode,
        geometry: {
          x: canvasPosition.x,
          y: canvasPosition.y,
          width: canvasSize.width,
          height: canvasSize.height,
        },
      },
      {
        ...initialComponentWindow,
        visibility: componentCanvasClosed
          ? 'closed'
          : componentCanvasMinimized ? 'minimized' : 'open',
        presentation: componentCanvasWindowMode,
        geometry: {
          x: componentCanvasPosition.x,
          y: componentCanvasPosition.y,
          width: componentCanvasSize.width,
          height: componentCanvasSize.height,
        },
      },
      {
        ...initialNodeLogicWindow,
        visibility: nodeLogicClosed ? 'closed' : nodeLogicMinimized ? 'minimized' : 'open',
        presentation: nodeLogicWindowMode,
        geometry: {
          x: nodeLogicPosition.x,
          y: nodeLogicPosition.y,
          width: nodeLogicSize.width,
          height: nodeLogicSize.height,
        },
      },
    ];

    const stackOrder = windowOrder.flatMap((id) => {
      if (id !== 'main-canvas' && id !== 'component-canvas' && id !== 'node-logic') {
        return [];
      }
      const record = currentWindows.find((candidate) => candidate.workspace === id);
      return record?.visibility === 'open' ? [record.windowInstanceId] : [];
    });
    for (const record of currentWindows) {
      if (record.visibility === 'open' && !stackOrder.includes(record.windowInstanceId)) {
        stackOrder.push(record.windowInstanceId);
      }
    }

    const activeRecord =
      currentWindows.find((record) =>
        record.workspace === activeWindowId && record.visibility === 'open',
      ) ??
      currentWindows.find((record) =>
        record.windowInstanceId === stackOrder.at(-1),
      );
    const stackPositions = new Map(stackOrder.map((id, index) => [id, index]));

    return {
      ...initialWorkspaceLayout,
      windows: currentWindows.map((record) => ({
        ...record,
        stackOrder: stackPositions.get(record.windowInstanceId) ?? 0,
      })),
      stackOrder,
      activeWindowInstanceId: activeRecord?.windowInstanceId ?? null,
      activeWorkspace: activeRecord?.workspace ?? 'main-canvas',
      panelVisibility: {
        'pages-rack': pagesRackOpen,
        'component-rack': componentRackOpen,
        layers: layersVisible,
      },
      updatedAt: new Date().toISOString(),
    };
  }, [
    initialWorkspaceLayout,
    initialMainWindow,
    initialComponentWindow,
    initialNodeLogicWindow,
    canvasClosed,
    canvasMinimized,
    canvasWindowMode,
    canvasPosition,
    canvasSize,
    componentCanvasClosed,
    componentCanvasMinimized,
    componentCanvasWindowMode,
    componentCanvasPosition,
    componentCanvasSize,
    nodeLogicClosed,
    nodeLogicMinimized,
    nodeLogicWindowMode,
    nodeLogicPosition,
    nodeLogicSize,
    windowOrder,
    activeWindowId,
    pagesRackOpen,
    componentRackOpen,
    layersVisible,
  ]);

  useEffect(() => {
    if (!workspacePreferencesPersistenceEnabled) return;
    const saved = saveWorkspacePreferences(workspacePreferencesSnapshot, {
      reconciliationComplete: true,
      replaceUnsupportedVersion: workspacePreferencesReplaceMalformedRef.current,
      viewport: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      },
    });
    if (!saved.ok) {
      console.warn('Folio could not persist its workspace layout:', saved.reason);
      setNotice('Workspace layout could not be saved: ' + saved.reason + '.');
      return;
    }
    workspacePreferencesReplaceMalformedRef.current = false;
  }, [workspacePreferencesSnapshot, workspacePreferencesPersistenceEnabled]);

  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((loadedProject) => {
        if (!active || !loadedProject) return;

        // Restore explicitly from the project's activePageId. If an older or
        // malformed v2 record points nowhere, use the first persisted page.
        const activePage = loadedProject.pages.find((page) => page.id === loadedProject.activePageId)
          ?? loadedProject.pages[0];
        if (!activePage) throw new Error('The saved project does not contain a page.');
        dispatch({
          type: 'replace-project',
          project: { ...loadedProject, activePageId: activePage.id },
        });
      })
      .catch((error: unknown) => {
        console.error('Folio could not restore the project from IndexedDB:', error);
        if (active) setNotice('The saved project could not be restored. A new project is available.');
      })
      .finally(() => {
        if (active) setIsProjectLoaded(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadProjectById('folio-component-canvas')
      .then((project) => {
        if (active && project) componentDispatch({ type: 'replace-project', project });
      })
      .catch((error: unknown) => {
        console.warn('Folio could not read Component Canvas autosave:', error);
      })
      .finally(() => {
        if (active) setComponentReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!componentReady) return;
    componentAutosave.schedule(componentState.project);
    return () => componentAutosave.cancel();
  }, [componentState.project, componentReady, componentAutosave]);

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
          // A queued or in-flight candidate may be invalidated by a newer
          // canonical revision. Never let its Promise callback overwrite the
          // newer revision's "saving" state.
          if (result.status === 'saved') {
            setRevisionFencedAutosaveStatus(
              projectRevision, getCanonicalRevision, 'saved', setSaveStatus,
            );
          }
        })
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setRevisionFencedAutosaveStatus(
            projectRevision, getCanonicalRevision, 'error', setSaveStatus,
          );
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state.project, isProjectLoaded]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeDocument = getActiveDocument(state.project);
  const componentDocument = getActiveDocument(componentState.project);
  const focusedEditor = getActiveEditorContext(activeEditorId, state, componentState);
  const focusedDocument = focusedEditor.document;
  const focusedPage = activeEditorId === 'main' ? getActivePage(state.project) : null;
  const layerContextName = focusedPage?.name ?? editingComponent?.name ?? componentDocument.name;
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
  const instanceOverrideTargets = selectedInstanceComponent ? getComponentOverrideTargets(selectedInstanceComponent) : null;
  const dispatchFocused = activeEditorId === 'main' ? dispatch : componentDispatch;
  const layerSourceNodes = focusedDocument.nodes;
  const layerSourceIds = new Set(layerSourceNodes.map((node) => node.id));
  const layerRows = getLayerPanelRows(layerSourceNodes, collapsedLayers[activeEditorId]);
  const layerEffectiveStates = getEffectiveLayerStates(layerSourceNodes);
  const contextMenuEditor = layerContextMenu
    ? getActiveEditorContext(layerContextMenu.editorId, state, componentState)
    : null;
  const contextMenuNodes = contextMenuEditor?.document.nodes ?? [];
  const contextMenuRootIds = layerContextMenu
    ? getSelectedLayerRootIds(contextMenuNodes, layerContextMenu.nodeIds)
    : [];
  const contextMenuRootNodes = contextMenuRootIds
    .map((id) => contextMenuNodes.find((node) => node.id === id))
    .filter((node): node is DesignNode => node !== undefined);
  const contextMenuCanGroup = contextMenuRootNodes.length > 1
    || (contextMenuRootNodes.length === 1 && (
      contextMenuRootNodes[0].type === 'group'
      || contextMenuNodes.some((node) => node.parentId === contextMenuRootNodes[0].id)
    ));
  const contextMenuCanUngroup = contextMenuRootNodes.some((root) =>
    contextMenuNodes.some((node) => node.parentId === root.id)
  );
  const contextMenuCanMask = contextMenuRootIds.length === 1
    && Boolean(getClippingMaskBaseId(contextMenuNodes, contextMenuRootIds[0]));
  const contextMenuCanUnmask = contextMenuRootIds.length === 1
    && Boolean(contextMenuRootNodes[0]?.clipMaskBaseId);
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
    const baseName = session.value.trim();
    if (!save || !baseName) return;

    const updates = session.batch
      ? (() => {
          const occupied = new Set(session.existingNames);
          let suffix = 1;
          return session.nodeIds.map((nodeId) => {
            let name = '';
            do { name = `${baseName} ${suffix++}`; } while (occupied.has(name));
            occupied.add(name);
            return { nodeId, name };
          });
        })()
      : [{ nodeId: session.nodeIds[0], name: baseName }];

    const targetDispatch = session.editorId === 'main' ? dispatch : componentDispatch;
    targetDispatch({ type: 'rename-nodes', updates });
  };

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
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [layerContextMenu]);

  useEffect(() => {
    if (!layerRename) return;

    // autoFocus is unreliable when a conditional input is mounted in a keyed tree.
    // Focus only after Preact has committed the input to the DOM.
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
      // Capture-phase pointerdown closes the editor before another layer/action
      // receives its click, including clicks on empty workspace areas.
      finishLayerRename(true);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [layerRename?.anchorId]);

  const setLayerColorFromRow = (nodeId: string, color: string) => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const validIds = layerSourceNodes.filter((node) => targetIds.includes(node.id)).map((node) => node.id);
    if (validIds.length === 0) return;
    dispatchFocused({
      type: 'set-nodes-properties',
      nodeIds: validIds,
      properties: { layerColor: color },
    });
    setLayerColorPickerKey(null);
  };

  const toggleLayerPropertyFromRow = (nodeId: string, property: 'visible' | 'locked') => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const targets = layerSourceNodes.filter((node) => targetIds.includes(node.id));
    if (targets.length === 0) return;
    const shouldEnable = !targets.every((node) => node[property]);
    dispatchFocused({
      type: 'set-nodes-properties',
      nodeIds: targets.map((node) => node.id),
      properties: { [property]: shouldEnable },
    });
  };

  const selectLayerFromPanel = (nodeId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    selectionSourceRef.current = 'layers';
    const selected = focusedEditor.state.selectedNodeIds;
    const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey);
    const subtreeIds = expandSelectedLayerIds(layerSourceNodes, [nodeId]);
    const subtreeIsSelected = subtreeIds.length === selected.length
      && subtreeIds.every((id) => selected.includes(id));

    if (modifiers.shiftKey && selected.length > 1 && selected.includes(nodeId) && !subtreeIsSelected && getLayerAncestorIds(layerSourceNodes, nodeId).size === 0) {
      beginLayerRename(nodeId, true);
      return;
    }
    if (!modifiers.shiftKey && !additive && subtreeIsSelected) {
      beginLayerRename(nodeId, false);
      return;
    }

    const orderedIds = layerRows.map((row) => row.node.id);
    if (modifiers.shiftKey) {
      const anchor = layerSelectionAnchorRef.current[activeEditorId];
      const anchorId = anchor && selected.includes(anchor) ? anchor : (selected[0] ?? nodeId);
      const start = orderedIds.indexOf(anchorId);
      const end = orderedIds.indexOf(nodeId);
      if (start >= 0 && end >= 0) {
        const range = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
        const requested = additive ? [...new Set([...selected, ...range])] : range;
        dispatchFocused({ type: 'select-nodes', nodeIds: expandSelectedLayerIds(layerSourceNodes, requested) });
        setInspectorVisible(true);
        return;
      }
    }

    if (additive) {
      const groupIsSelected = subtreeIds.every((id) => selected.includes(id));
      let next: string[];
      if (groupIsSelected) {
        // A child cannot stay implicitly selected through an ancestor after
        // its own subtree is toggled off.
        const removed = new Set([...subtreeIds, ...getLayerAncestorIds(layerSourceNodes, nodeId)]);
        next = selected.filter((id) => !removed.has(id));
      } else {
        next = expandSelectedLayerIds(layerSourceNodes, [...selected, ...subtreeIds]);
      }
      const anchor = layerSelectionAnchorRef.current[activeEditorId];
      if (!anchor || !selected.includes(anchor)) layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      dispatchFocused({ type: 'select-nodes', nodeIds: next });
    } else {
      layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      dispatchFocused({ type: 'select-nodes', nodeIds: subtreeIds });
    }
    setInspectorVisible(true);
  };

  const openLayerContextMenu = (nodeId: string, event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    selectionSourceRef.current = 'layers';

    // Right-clicking a selected member preserves the current multi-selection.
    // Otherwise, behave like a normal Layers-panel selection and include its subtree.
    const currentSelection = focusedEditor.state.selectedNodeIds.filter((id) => layerSourceIds.has(id));
    const menuNodeIds = currentSelection.includes(nodeId)
      ? currentSelection
      : expandSelectedLayerIds(layerSourceNodes, [nodeId]);

    if (!currentSelection.includes(nodeId)) {
      layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      dispatchFocused({ type: 'select-nodes', nodeIds: menuNodeIds });
      setInspectorVisible(true);
    }

    setLayerContextMenu({
      nodeId,
      nodeIds: menuNodeIds,
      editorId: activeEditorId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 248)),
    });
  };

  const toggleLayerCollapsed = (nodeId: string) => {
    setCollapsedLayers((current) => {
      const ids = current[activeEditorId] ?? [];
      return { ...current, [activeEditorId]: ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId] };
    });
  };

  const getLayerDropPosition = (event: { currentTarget: HTMLElement; clientY: number }): LayerDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeY = (event.clientY - rect.top) / Math.max(1, rect.height);
    return relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside';
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
    setLayerDropTarget({ nodeId, position: getLayerDropPosition(event) });
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
    const position = getLayerDropPosition(event);
    if (draggedIds.length > 0) {
      dispatchFocused({ type: 'move-layers', nodeIds: draggedIds, targetId, position });
      if (position === 'inside') {
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
    const targetDispatch = target === 'main' ? dispatch : componentDispatch;
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
    setInspectorVisible(true);
    targetDispatch({ type: 'select-nodes', nodeIds: ids });

    if (existing) {
      setNotice(`“${existing.name}” is already on the Canvas. Duplicate objects are not allowed.`);
      clearDrag();
      return;
    }

    // Re-show the exact same nodes. The saved position, size, style and
    // rotation remain on the original layer records; dropping never resets them.
    targetDispatch({ type: 'set-nodes-canvas-state', nodeIds: ids, onCanvas: true });
    setNotice(`“${droppedNodes[0].name}” has been restored to the Canvas with its previous properties.`);
    clearDrag();
  };

  const addNode = (type: 'rect' | 'ellipse' | 'text') => {
    if (isHydrating) return;
    dispatchFocused({ type: 'add-node', node: createNodeForDocument(type, focusedDocument) });
    setInspectorVisible(true);
  };
  const saveNodesAsComponent = (nodes: DesignNode[], sourceNodes: readonly DesignNode[] = activeDocument.nodes) => {
    if (isHydrating || nodes.length === 0) return;
    const component = buildComponentDefinitionFromNodes(
      sourceNodes,
      nodes.map((node) => node.id),
      `Component ${ownedComponents.length + 1}`,
    );
    if (!component) return;
    dispatch({ type: 'add-component', component });
    closePagesRack();
    setComponentRackOpen(true);
    setNotice(`“${component.name}” saved to this project’s Component Rack.`);
  };

  /**
   * Explicit Component Canvas save/update action (WEB-09):
   * - When editing an existing master, updates/syncs that master in place
   *   without ever creating accidental duplicates.
   * - When working in a scratch Component Canvas with no active master, creates
   *   one new master component and attaches the buffer to it.
   */
  const saveComponentCanvasMaster = () => {
    if (isHydrating || pendingComponentDeletionRef.current) return;
    const bufferDocument = getActiveDocument(componentState.project);

    if (editingComponent) {
      const session = componentSyncSessionRef.current;
      if (componentRecoveryStatus !== 'none' || !session || session.conflicted || session.masterStatus !== 'present') {
        setNotice('Resolve the active Component Canvas recovery state before updating this master.');
        return;
      }
      const syncAction = createComponentCanvasSyncAction(editingComponent, bufferDocument, session);
      if (!syncAction) {
        void componentAutosave.flush(componentState.project);
        setNotice(`“${editingComponent.name}” master is up to date.`);
        return;
      }
      const transition = dispatch(syncAction);
      if (transition.status === 'committed') {
        const committedMaster = transition.snapshot.editorState.project.components
          .find((component) => component.id === editingComponent.id);
        if (committedMaster) {
          componentSyncSessionRef.current = advanceComponentCanvasSyncSession(session, committedMaster);
        }
        void componentAutosave.flush(componentState.project);
        setNotice(`Updated master “${editingComponent.name}”.`);
      } else {
        componentSyncSessionRef.current = { ...session, conflicted: true };
        setComponentRecoveryStatus('conflict');
        setNotice('The master changed before this update could be applied. Review the latest master before saving.');
      }
      return;
    }

    const sourceIds = selectedComponentNodes.length > 0
      ? selectedComponentNodes.map((node) => node.id)
      : bufferDocument.nodes.map((node) => node.id);
    const component = buildComponentDefinitionFromNodes(
      bufferDocument.nodes,
      sourceIds,
      `Component ${ownedComponents.length + 1}`,
    );
    if (!component) return;
    dispatch({ type: 'add-component', component });
    componentSyncSessionRef.current = createComponentCanvasSyncSession(component);
    setEditingComponentId(component.id);
    setComponentRecoveryStatus('none');
    closePagesRack();
    setComponentRackOpen(true);
    setNotice(`Created master “${component.name}” in Component Rack.`);
  };

  const loadMasterComponent = (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current) {
      setNotice('Resolve the active component deletion recovery decision before replacing the Component Canvas buffer.');
      return;
    }
    componentSyncPauseAfterCancelRef.current = null;
    componentSyncSessionRef.current = createComponentCanvasSyncSession(component);
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    componentDispatch({
      type: 'replace-project',
      project: createComponentCanvasBufferProject(component),
    });
    setEditingComponentId(component.id);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
    closeComponentRack();
    setNotice(`Editing master: ${component.name}.`);
  };

  const openMasterComponent = (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current) {
      setNotice('Resolve the active component deletion recovery decision before opening another master.');
      return;
    }
    const session = componentSyncSessionRef.current;
    const bufferDocument = getActiveDocument(componentState.project);
    const hasActiveBuffer = editingComponentId !== null;
    const mustProtectBuffer = hasActiveBuffer && (
      !session || shouldProtectComponentCanvasBuffer(session, bufferDocument)
    );
    if (mustProtectBuffer) {
      setPendingComponentOpenId(component.id);
      setComponentCanvasClosed(false);
      setComponentCanvasMinimized(false);
      setActiveEditorId('component');
      focusWindow('component-canvas');
      setComponentRecoveryStatus('switch-pending');
      setNotice(
        'The current Component Canvas has local edits or a recovery conflict. Keep editing, or explicitly discard its buffer before opening another master.',
      );
      return;
    }
    loadMasterComponent(component);
  };

  const keepCurrentComponentBuffer = () => {
    setPendingComponentOpenId(null);
    const session = componentSyncSessionRef.current;
    if (!session) {
      setComponentRecoveryStatus('none');
    } else if (session.masterStatus === 'missing') {
      setComponentRecoveryStatus('missing');
    } else if (session.masterStatus === 'returned') {
      setComponentRecoveryStatus('returned');
    } else if (session.conflicted) {
      setComponentRecoveryStatus('conflict');
    } else {
      setComponentRecoveryStatus('none');
    }
  };

  const discardBufferAndOpenPendingMaster = () => {
    const pending = pendingComponentOpenId
      ? state.project.components.find((item) => item.id === pendingComponentOpenId)
      : undefined;
    if (!pending) {
      setPendingComponentOpenId(null);
      setNotice('The requested master is no longer available. The current Component Canvas buffer was kept.');
      return;
    }
    loadMasterComponent(pending);
  };

  const createNewMasterComponent = () => {
    if (isHydrating) return;
    const now = new Date().toISOString();
    const name = `Component ${ownedComponents.length + 1}`;
    const component: ComponentDefinition = {
      id: globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`,
      name,
      document: { ...createEmptyDocument(name, 420, 280), background: '#00000000' },
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: 'add-component', component });
    openMasterComponent(component);
  };

  const renameComponent = (componentId: string) => {
    const name = componentNameDraft.trim();
    if (!name) return;
    const current = state.project.components.find((item) => item.id === componentId);
    if (!current) {
      setNotice('This component is no longer available in the current project.');
      return;
    }
    const transition = dispatch({
      type: 'rename-component',
      componentId,
      expectedMasterDocument: current.document,
      expectedUpdatedAt: current.updatedAt,
      name,
    });
    if (transition.status !== 'committed') {
      setNotice('The component changed before the rename could be applied. Review the latest master and retry.');
      return;
    }
    setRenamingComponentId(null);
    setNotice(`Component renamed to “${name}”.`);
  };

  const duplicateComponent = (component: ComponentDefinition) => {
    const now = new Date().toISOString();
    const copy: ComponentDefinition = {
      ...component,
      id: globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`,
      name: `${component.name} copy`,
      document: {
        ...component.document,
        id: globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}`,
        name: `${component.name} copy`,
        nodes: component.document.nodes.map((node) => ({ ...node })),
      },
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: 'add-component', component: copy });
    setNotice(`“${component.name}” duplicated.`);
  };

  const componentDeletionTarget = (component: ComponentDefinition) => ({
    componentId: component.id,
    expectedMasterDocument: component.document,
    expectedUpdatedAt: component.updatedAt,
  });

  const clearPendingComponentDeletion = () => {
    pendingComponentDeletionRef.current = false;
    setPendingComponentDeletion(null);
    setComponentDeletionDialogOpen(false);
    setComponentDeletionBusy(false);
    setComponentCleanupPending(false);
    setDurableRecoveryComponentId(null);
  };

  const keepComponentAfterStaleDeletion = (message: string) => {
    clearPendingComponentDeletion();
    const session = componentSyncSessionRef.current;
    if (session) componentSyncSessionRef.current = { ...session, conflicted: true };
    setComponentRecoveryStatus('conflict');
    setNotice(message);
  };

  const finishDeletedActiveComponent = (component: ComponentDefinition) => {
    if (editingComponentId !== component.id) return;
    setEditingComponentId(null);
    componentSyncSessionRef.current = null;
    componentSyncPauseAfterCancelRef.current = null;
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    componentDispatch({ type: 'replace-project', project: componentInitialState.project });
    setComponentCanvasClosed(true);
    setComponentCanvasMinimized(false);
    setActiveEditorId('main');
  };

  const openComponentDeletionDialog = (component: ComponentDefinition, mode: 'recovery' | 'clean' = 'recovery') => {
    pendingComponentDeletionRef.current = true;
    setPendingComponentDeletion(component);
    setComponentDeletionMode(mode);
    setComponentDeletionDialogOpen(true);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
  };

  const showComponentCleanupPending = (component: ComponentDefinition) => {
    pendingComponentDeletionRef.current = true;
    setPendingComponentDeletion(component);
    setComponentCleanupPending(true);
    setComponentDeletionMode('cleanup');
    setComponentDeletionDialogOpen(true);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
  };

  const completeDurableComponentDeletion = (component: ComponentDefinition, message: string) => {
    clearPendingComponentDeletion();
    finishDeletedActiveComponent(component);
    setNotice(message);
  };

  const deleteComponent = async (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current || componentCleanupPending) return;
    const isActiveMaster = editingComponentId === component.id;
    const trigger = document.activeElement;
    deletionFocusReturnRef.current = trigger instanceof HTMLElement ? trigger : null;
    const protection = {
      activeMaster: isActiveMaster,
      bufferDocument: isActiveMaster ? getActiveDocument(componentState.project) : null,
      session: isActiveMaster ? componentSyncSessionRef.current : null,
      recoveryPending: isActiveMaster && (
        componentRecoveryStatus !== 'none' || pendingComponentOpenId !== null
      ),
    };
    const result = requestComponentDeletion(
      canonicalStore, componentDeletionTarget(component), protection, isActiveMaster,
    );

    if (result.status === 'recovery-required') {
      openComponentDeletionDialog(component);
      return;
    }
    if (result.status === 'stale-master') {
      if (isActiveMaster) {
        const session = componentSyncSessionRef.current;
        if (session) componentSyncSessionRef.current = { ...session, conflicted: true };
        setComponentRecoveryStatus('conflict');
      }
      setNotice('The master changed before deletion could be applied. Review the latest master and retry; the Component Canvas buffer was kept.');
      return;
    }

    if (result.status === 'ready' && isActiveMaster) {
      openComponentDeletionDialog(component, 'clean');
      setComponentDeletionBusy(true);
      const bufferSaved = await componentAutosave.flush(componentState.project);
      if (!bufferSaved) {
        setComponentDeletionBusy(false);
        clearPendingComponentDeletion();
        setNotice('Component Canvas buffer could not be saved durably. The master and buffer are unchanged; retry the buffer save before deleting.');
        return;
      }
      const deletion = await deleteComponentDurably(
        canonicalStore, componentDeletionTarget(component), componentInitialState.project, withProjectWriteLock,
      );
      setComponentDeletionBusy(false);
      if (deletion.status === 'deleted') {
        completeDurableComponentDeletion(component, `“${component.name}” deleted; linked instances were detached and Component Canvas cleanup is durable.`);
      } else if (deletion.status === 'cleanup-persist-failed') {
        showComponentCleanupPending(component);
        componentAutosave.schedule(componentState.project);
        setNotice('The master deletion is durable, but Component Canvas cleanup failed. Your local buffer is preserved; retry cleanup before discarding it.');
      } else {
        clearPendingComponentDeletion();
        componentAutosave.schedule(componentState.project);
        setNotice('The master deletion could not be made durable. The canonical master and Component Canvas buffer were preserved; retry is safe.');
      }
      return;
    }

    if (result.status !== 'deleted') {
      setNotice('The master could not be deleted. The Component Canvas buffer was kept; review the latest master and retry.');
      return;
    }
    setNotice(`“${component.name}” deleted; any linked instances were detached.`);
  };

  const cancelComponentDeletion = () => {
    if (!pendingComponentDeletion || componentDeletionBusy) return;
    if (componentCleanupPending) {
      setNotice('The master deletion is already durable. Keep this recovery dialog open and retry the buffer cleanup; the protected buffer has not been discarded.');
      return;
    }
    componentSyncPauseAfterCancelRef.current = getActiveDocument(componentState.project);
    clearPendingComponentDeletion();
    setNotice('Deletion cancelled. The master, local Component Canvas buffer, and recovery session were kept.');
  };

  const saveBufferAsNewAndDelete = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || componentCleanupPending) return;
    setComponentDeletionBusy(true);
    const bufferSaved = await componentAutosave.flush(componentState.project);
    if (!bufferSaved) {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas buffer could not be saved durably. No recovery or deletion commit was attempted; retry the buffer save.');
      return;
    }
    const target = componentDeletionTarget(pending);
    const bufferDocument = getActiveDocument(componentState.project);
    const protection = {
      activeMaster: editingComponentId === pending.id,
      bufferDocument,
      session: componentSyncSessionRef.current,
      recoveryPending: true,
    };
    const result = durableRecoveryComponentId
      ? await deleteComponentAfterDurableRecovery(
          canonicalStore, target, durableRecoveryComponentId, componentInitialState.project, withProjectWriteLock,
        )
      : await recoverAndDeleteComponentDurably(
          canonicalStore, target, protection, bufferDocument, componentInitialState.project, withProjectWriteLock,
        );
    setComponentDeletionBusy(false);

    if (result.status === 'deleted') {
      const savedName = result.recoveryComponent?.name ?? 'Recovered component';
      completeDurableComponentDeletion(pending, `“${savedName}” was saved durably and “${pending.name}” was deleted. Component Canvas cleanup is durable.`);
    } else if (result.status === 'stale-master') {
      const message = result.recoveryComponent
        ? `“${result.recoveryComponent.name}” is durably saved; the original master changed, so it and the local buffer were kept.`
        : 'The master changed before recovery could be applied. The master and local buffer were kept.';
      keepComponentAfterStaleDeletion(message);
      componentAutosave.schedule(componentState.project);
    } else if (result.status === 'recovery-persist-failed') {
      componentAutosave.schedule(componentState.project);
      setNotice('Recovery-copy persistence failed. No deletion was attempted; the master and local buffer remain. Retry is safe.');
    } else if (result.status === 'deletion-persist-failed') {
      if (result.recoveryComponent) setDurableRecoveryComponentId(result.recoveryComponent.id);
      componentAutosave.schedule(componentState.project);
      setNotice('The recovery copy is durable, but deletion persistence failed. The master and buffer remain in memory; retry deletion without creating another recovery copy.');
    } else if (result.status === 'cleanup-persist-failed') {
      showComponentCleanupPending(pending);
      if (result.recoveryComponent) setDurableRecoveryComponentId(result.recoveryComponent.id);
      componentAutosave.schedule(componentState.project);
      setNotice('The recovered component and master deletion are durable, but buffer cleanup failed. The local buffer remains preserved; retry cleanup.');
    } else {
      componentAutosave.schedule(componentState.project);
      setNotice('The durable recovery operation failed. The local buffer remains protected; retry or cancel safely.');
    }
  };

  const discardBufferAndDelete = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || componentCleanupPending) return;
    setComponentDeletionBusy(true);
    const bufferSaved = await componentAutosave.flush(componentState.project);
    if (!bufferSaved) {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas buffer could not be saved durably. No deletion was attempted; retry the buffer save.');
      return;
    }
    const deletion = await deleteComponentDurably(
      canonicalStore, componentDeletionTarget(pending), componentInitialState.project, withProjectWriteLock,
    );
    setComponentDeletionBusy(false);
    if (deletion.status === 'deleted') {
      completeDurableComponentDeletion(pending, `“${pending.name}” was deleted durably after discarding the protected local buffer; linked instances were detached.`);
    } else if (deletion.status === 'cleanup-persist-failed') {
      showComponentCleanupPending(pending);
      setNotice('The master deletion is durable, but buffer cleanup failed. The local buffer remains preserved; retry cleanup.');
    } else if (deletion.status === 'stale-master') {
      keepComponentAfterStaleDeletion('The master changed while the recovery choice was open. Deletion was cancelled; the local buffer was kept. Review the latest master.');
    } else {
      componentAutosave.schedule(componentState.project);
      setNotice('The master deletion could not be made durable. The original master and local buffer remain; retry or cancel safely.');
    }
  };

  const retryComponentBufferCleanup = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || !componentCleanupPending) return;
    setComponentDeletionBusy(true);
    await componentAutosave.cancelAndWait();
    try {
      await withProjectWriteLock((persist) => persist(componentInitialState.project));
      setComponentDeletionBusy(false);
      completeDurableComponentDeletion(pending, 'Component Canvas cleanup is now durable. The recovered component and master deletion remain saved.');
    } catch {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas cleanup is still failing. The local buffer remains intact; retry is safe.');
    }
  };

  const retryComponentCanvasSave = () => {
    void componentAutosave.flush(componentState.project);
  };

  useEffect(() => {
    if (!componentReady || !editingComponentId || pendingComponentDeletionRef.current) return;
    const editedDocument = getActiveDocument(componentState.project);
    const pausedAfterCancel = componentSyncPauseAfterCancelRef.current;
    if (pausedAfterCancel) {
      if (pausedAfterCancel === editedDocument) return;
      componentSyncPauseAfterCancelRef.current = null;
    }
    const master = state.project.components.find((component) => component.id === editingComponentId);
    if (!master) {
      const session = componentSyncSessionRef.current;
      if (session && session.masterStatus !== 'missing') {
        componentSyncSessionRef.current = markComponentCanvasMasterMissing(session);
        setComponentRecoveryStatus('missing');
        setNotice('The master is temporarily missing from Main Canvas history. The Component Canvas buffer and local edits are preserved; synchronization is paused.');
      }
      return;
    }

    let session = componentSyncSessionRef.current;
    if (!session || session.componentId !== master.id) {
      session = createComponentCanvasSyncSession(master);
      componentSyncSessionRef.current = session;
      componentDispatch({
        type: 'replace-project',
        project: createComponentCanvasBufferProject(master),
      });
      return;
    }

    const reconciliation = reconcileComponentCanvasSyncSession(session, master, editedDocument);
    if (reconciliation.status === 'orphaned-master-returned') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('returned');
      setNotice('The master has returned, but the previous Component Canvas buffer remains untouched. Reloading it would discard local edits; use the explicit recovery action only when ready.');
      return;
    }
    if (reconciliation.status === 'orphaned') {
      componentSyncSessionRef.current = reconciliation.session;
      return;
    }
    if (reconciliation.status === 'reload-buffer') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('none');
      componentDispatch({
        type: 'replace-project',
        project: createComponentCanvasBufferProject(master),
      });
      return;
    }
    if (reconciliation.status === 'conflict') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('conflict');
      if (!session.conflicted) {
        setNotice(
          'The master changed in Main Canvas while this buffer had unsynchronized edits. ' +
          'Local edits were kept and synchronization is paused. Reopen the master to discard this buffer and load the canonical version.',
        );
      }
      return;
    }
    if (reconciliation.status === 'master-mismatch') return;

    componentSyncSessionRef.current = reconciliation.session;
    const syncAction = createComponentCanvasSyncAction(master, editedDocument, session);
    if (!syncAction) return;

    const transition = dispatch(syncAction);
    if (transition.status === 'committed') {
      const committedMaster = transition.snapshot.editorState.project.components
        .find((component) => component.id === master.id);
      if (committedMaster) {
        componentSyncSessionRef.current = advanceComponentCanvasSyncSession(session, committedMaster);
      }
    } else {
      componentSyncSessionRef.current = { ...session, conflicted: true };
      setComponentRecoveryStatus('conflict');
      setNotice(
        'The component master changed before this edit could synchronize. ' +
        'Local edits were kept and synchronization is paused; reopen the master to reload the canonical version.',
      );
    }
  }, [componentState.project.pages, editingComponentId, componentReady, state.project.components, pendingComponentDeletion]);

  const reloadRecoveredComponentMaster = () => {
    if (!editingComponentId || pendingComponentDeletionRef.current) return;
    componentSyncPauseAfterCancelRef.current = null;
    const master = state.project.components.find((component) => component.id === editingComponentId);
    if (!master) {
      setComponentRecoveryStatus('missing');
      setNotice('The canonical master is still missing. The local Component Canvas buffer remains preserved.');
      return;
    }
    componentSyncSessionRef.current = createComponentCanvasSyncSession(master);
    componentDispatch({ type: 'replace-project', project: createComponentCanvasBufferProject(master) });
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    setNotice('The latest canonical master was reloaded. The previous local Component Canvas edits were discarded by explicit request.');
  };

  const switchPage = (page: FolioPage) => {
    if (isHydrating || page.id === activePageId) return;
    setActiveEditorId('main');
    dispatch({ type: 'set-active-page', pageId: page.id });
    closePagesRack();
    setInspectorVisible(true);
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
    dispatch({ type: 'add-page', page: { id, name, route, document } });
    setPageNameDraft('');
    closePagesRack();
    setInspectorVisible(true);
    setNotice(`Created ${name}.`);
  };

  const saveSelectionAsComponent = () => saveNodesAsComponent(focusedEditor.selectedNodes, focusedDocument.nodes);

  const commitProjectName = (value: string) => {
    if (isHydrating) return;
    const name = value.trim();
    if (name && name !== state.project.metadata.name) {
      dispatch({ type: 'rename-project', name });
    }
  };

  const openProjectPicker = () => {
    if (isHydrating) return;
    setFileMenuOpen(false);
    projectFileInputRef.current?.click();
  };

  const exportCurrentProject = () => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const exportSnapshot = createProjectExportSnapshot(
        state.project,
        editingComponentId,
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

  const selectedComponentNodes = componentDocument.nodes.filter((node) => componentState.selectedNodeIds.includes(node.id));
  const insertOwnedComponent = (component: ComponentDefinition) => {
    if (isHydrating) return;
    const offset = state.project.pages.find((page) => page.id === state.project.activePageId)?.document.nodes.length ?? 0;
    const instance = createComponentInstance(component, 150 + (offset % 4) * 28, 130 + (offset % 4) * 28);
    dispatch({ type: 'add-node', node: instance });
    openMainCanvas();
    setInspectorVisible(true);
    setNotice(`Linked instance of “${component.name}” added to Main Canvas.`);
  };

  const updateSelected = (patch: Partial<DesignNode>) => {
    if (!selectedNode) return;
    const safePatch = { ...patch };
    if ('width' in patch) safePatch.width = normalizePositiveDimension(Number(patch.width), selectedNode.width);
    if ('height' in patch) safePatch.height = normalizePositiveDimension(Number(patch.height), selectedNode.height);
    dispatchFocused({ type: 'edit-node', coalesceKey: 'inspector:' + selectedNode.id, node: { ...selectedNode, ...safePatch } as DesignNode });
  };

  const updateSelectedStyle = (patch: Record<string, string | number>) => {
    if (!selectedNode || selectedNode.type === 'component-instance' || selectedNode.type === 'group') return;
    dispatchFocused({ type: 'edit-node', coalesceKey: 'inspector:' + selectedNode.id, node: { ...selectedNode, style: { ...selectedNode.style, ...patch } } as DesignNode });
  };

  const updateInstanceOverride = (childNodeId: string, patch: { fill?: string; text?: string }) => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    const instance = selectedNode as ComponentInstanceNode;
    const overrides = {
      ...instance.overrides,
      [childNodeId]: { ...instance.overrides[childNodeId], ...patch },
    };
    dispatchFocused({
      type: 'edit-node',
      coalesceKey: 'instance-override:' + instance.id,
      node: { ...instance, overrides },
    });
  };

  const resetInstanceOverrides = () => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    dispatchFocused({
      type: 'edit-node',
      coalesceKey: 'instance-override:' + selectedNode.id,
      node: { ...selectedNode, overrides: {} },
    });
  };

  const detachSelectedInstance = () => {
    if (!selectedNode || selectedNode.type !== 'component-instance') return;
    const master = state.project.components.find((component) => component.id === selectedNode.componentId);
    if (!master) { setNotice('The linked master component could not be found.'); return; }
    const detached = detachComponentInstance(selectedNode, master);
    dispatchFocused({ type: 'replace-node-with-nodes', nodeId: selectedNode.id, nodes: detached });
    setNotice('Instance detached. Its nodes can now be edited independently.');
  };

  const alignSelection = (alignment: Alignment, target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const document = getActiveDocument(editor.project);
    const layerStates = getEffectiveLayerStates(document.nodes);
    const selected = getTransformableNodes(document.nodes.filter((node) => editor.selectedNodeIds.includes(node.id)).filter((node) => {
      const effective = layerStates.get(node.id);
      return effective?.visible && !effective.locked;
    }));
    if (selected.length < 2) return;
    const nextNodes = alignNodes(selected, alignment);
    if (target === 'main') dispatch({ type: 'transform-nodes', nodes: nextNodes });
    else componentDispatch({ type: 'transform-nodes', nodes: nextNodes });
  };

  const distributeSelection = (axis: DistributionAxis, target: EditorTarget = activeEditorId) => {
    if (isHydrating) return;
    const editor = target === 'main' ? state : componentState;
    const selected = getTransformableNodes(getActiveDocument(editor.project).nodes.filter((node) => editor.selectedNodeIds.includes(node.id)));
    if (selected.length < 3) return;
    const nextNodes = distributeNodes(selected, axis);
    if (target === 'main') dispatch({ type: 'transform-nodes', nodes: nextNodes });
    else componentDispatch({ type: 'transform-nodes', nodes: nextNodes });
  };

  const updateToolbarHint = (panel: string, description: string, shortcuts: string[] = []) => {
    setToolbarHint({ panel, description, shortcuts });
  };

  const chooseCanvasTool = (toolId: CanvasToolId) => {
    const tool = getCanvasTool(toolId);
    setActiveCanvasToolId(toolId);
    setToolRackOpen(null);
    updateToolbarHint(tool.label.toUpperCase(), tool.description);
  };

  const enterFullscreen = () => {
    const root = document.querySelector('.app-shell') as HTMLElement | null;
    if (!document.fullscreenElement) root?.requestFullscreen?.().catch(() => setNotice('Fullscreen is unavailable in this browser.'));
    else document.exitFullscreen?.();
  };

  const focusWindow = (id: WindowId) => {
    setWindowOrder((current) => bringWindowToFront(current, id));
    setActiveWindowId(id);
  };

  const getViewport = () => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  });

  const recoverWindow = (id: 'main-canvas' | 'component-canvas' | 'node-logic') => {
    const viewport = getViewport();
    if (id === 'main-canvas') {
      const layout = recoverWindowLayout({ position: canvasPosition, size: canvasSize }, viewport);
      setCanvasPosition(layout.position); setCanvasSize(layout.size);
    } else if (id === 'component-canvas') {
      const layout = recoverWindowLayout({ position: componentCanvasPosition, size: componentCanvasSize }, viewport);
      setComponentCanvasPosition(layout.position); setComponentCanvasSize(layout.size);
    } else {
      const layout = recoverWindowLayout({ position: nodeLogicPosition, size: nodeLogicSize }, viewport);
      setNodeLogicPosition(layout.position); setNodeLogicSize(layout.size);
    }
  };

  const openMainCanvas = () => { recoverWindow('main-canvas'); setCanvasClosed(false); setCanvasMinimized(false); setActiveEditorId('main'); focusWindow('main-canvas'); };
  const openComponentCanvas = () => { recoverWindow('component-canvas'); setComponentCanvasClosed(false); setComponentCanvasMinimized(false); setActiveEditorId('component'); focusWindow('component-canvas'); };
  const openNodeLogic = () => { recoverWindow('node-logic'); setNodeLogicClosed(false); setNodeLogicMinimized(false); focusWindow('node-logic'); };

  const getPanelClampContext = useCallback((panel: ResizablePanelId, widths: PanelWidths = panelWidthsRef.current) => ({
    viewportWidth: appShellRef.current?.clientWidth || window.innerWidth,
    layersVisible,
    inspectorVisible,
    otherPanelWidth: panel === 'layers' ? widths.inspector : widths.layers,
  }), [layersVisible, inspectorVisible]);

  const applyPanelWidth = useCallback((panel: ResizablePanelId, nextWidth: number, persist = false) => {
    const cssVar = panel === 'layers' ? '--layers-panel-width' : '--inspector-panel-width';
    appShellRef.current?.style.setProperty(cssVar, `${nextWidth}px`);
    const nextWidths: PanelWidths = { ...panelWidthsRef.current, [panel]: nextWidth };
    panelWidthsRef.current = nextWidths;
    setPanelWidths((current) => (current[panel] === nextWidth ? current : { ...current, [panel]: nextWidth }));
    if (persist) savePanelWidths(nextWidths);
  }, []);

  const startPanelResize = useCallback((panel: ResizablePanelId, event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    panelResizeCleanupRef.current?.();

    const startClientX = event.clientX;
    const initialWidths: PanelWidths = { ...panelWidthsRef.current };
    const startWidth = initialWidths[panel];
    appShellRef.current?.classList.add('is-resizing-panel');
    setResizingPanel(panel);

    const throttledMove = createThrottledMouseMove<number>((clientX) => {
      const nextWidth = computeResizedPanelWidth(
        panel,
        startWidth,
        startClientX,
        clientX,
        getPanelClampContext(panel, panelWidthsRef.current),
      );
      applyPanelWidth(panel, nextWidth, false);
    }, { intervalMs: DEFAULT_RESIZE_THROTTLE_MS });

    const detach = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('blur', finishResize);
      window.removeEventListener('keydown', onKeyDown, true);
      appShellRef.current?.classList.remove('is-resizing-panel');
      if (panelResizeCleanupRef.current === cleanupAndCancel) {
        panelResizeCleanupRef.current = null;
      }
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      throttledMove(moveEvent.clientX);
    };

    const finishResize = () => {
      throttledMove.flush();
      detach();
      savePanelWidths(panelWidthsRef.current);
      setResizingPanel(null);
    };

    const cancelResize = () => {
      throttledMove.cancel();
      detach();
      applyPanelWidth(panel, initialWidths[panel], false);
      setResizingPanel(null);
    };

    const cleanupAndCancel = () => {
      throttledMove.cancel();
      detach();
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        cancelResize();
      }
    };

    panelResizeCleanupRef.current = cleanupAndCancel;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('blur', finishResize);
    window.addEventListener('keydown', onKeyDown, true);
  }, [applyPanelWidth, getPanelClampContext]);

  const resetPanelWidth = useCallback((panel: ResizablePanelId) => {
    const nextWidth = clampPanelWidth(
      panel,
      PANEL_RESIZE_CONSTRAINTS[panel].defaultWidth,
      getPanelClampContext(panel),
    );
    applyPanelWidth(panel, nextWidth, true);
  }, [applyPanelWidth, getPanelClampContext]);

  const handlePanelResizeKeyDown = useCallback((panel: ResizablePanelId, event: KeyboardEvent) => {
    const step = event.shiftKey ? 32 : 16;
    const context = getPanelClampContext(panel);
    const bounds = getPanelWidthBounds(panel, context);
    const current = panelWidthsRef.current[panel];
    let target: number | null = null;

    if (event.key === 'ArrowLeft') {
      target = panel === 'layers' ? current - step : current + step;
    } else if (event.key === 'ArrowRight') {
      target = panel === 'layers' ? current + step : current - step;
    } else if (event.key === 'Home') {
      target = bounds.minWidth;
    } else if (event.key === 'End') {
      target = bounds.maxWidth;
    }

    if (target === null) return;
    event.preventDefault();
    applyPanelWidth(panel, clampPanelWidth(panel, target, context), true);
  }, [applyPanelWidth, getPanelClampContext]);

  useEffect(() => () => {
    panelResizeCleanupRef.current?.();
  }, []);

  const resetWindowLayout = () => {
    const layouts = getDefaultWindowLayouts(getViewport());
    setCanvasPosition(layouts['main-canvas'].position); setCanvasSize(layouts['main-canvas'].size);
    setComponentCanvasPosition(layouts['component-canvas'].position); setComponentCanvasSize(layouts['component-canvas'].size);
    setNodeLogicPosition(layouts['node-logic'].position); setNodeLogicSize(layouts['node-logic'].size);
    const defaultWidths = getDefaultPanelWidths();
    setPanelWidths(defaultWidths);
    panelWidthsRef.current = defaultWidths;
    savePanelWidths(defaultWidths);
    setWindowOrder(['node-logic', 'component-canvas', 'pages', 'main-canvas']);
    setActiveWindowId('main-canvas'); setViewMenuOpen(false); setNotice('Window layout has been reset.');
  };

  useEffect(() => {
    const onResize = () => {
      recoverWindow('main-canvas');
      recoverWindow('component-canvas');
      recoverWindow('node-logic');
      const current = panelWidthsRef.current;
      const clampedLayers = clampPanelWidth('layers', current.layers, getPanelClampContext('layers', current));
      const clampedInspector = clampPanelWidth('inspector', current.inspector, getPanelClampContext('inspector', { ...current, layers: clampedLayers }));
      if (clampedLayers !== current.layers || clampedInspector !== current.inspector) {
        const nextWidths = { layers: clampedLayers, inspector: clampedInspector };
        panelWidthsRef.current = nextWidths;
        setPanelWidths(nextWidths);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvasPosition, canvasSize, componentCanvasPosition, componentCanvasSize, nodeLogicPosition, nodeLogicSize, getPanelClampContext]);

  useEffect(() => {
    recoverWindow('main-canvas');
    recoverWindow('component-canvas');
    recoverWindow('node-logic');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isHydrating || componentDeletionDialogOpen) return;
      const target = event.target instanceof Element ? event.target : null;
      if ((target instanceof HTMLElement && target.isContentEditable) || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const context = getActiveEditorContext(activeEditorId, state, componentState);
      const emit = activeEditorId === 'main' ? dispatch : componentDispatch;
      const layerStates = getEffectiveLayerStates(context.document.nodes);
      const nodes = getTransformableNodes(context.document.nodes.filter((node) => context.state.selectedNodeIds.includes(node.id)).filter((node) => {
        const effective = layerStates.get(node.id);
        return effective?.visible && !effective.locked;
      }));
      const ids = context.state.selectedNodeIds;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && !event.shiftKey && key === 'a') {
        // Select every layer in the active document, just like a standard
        // design-editor Select All command. Keep it scoped to the active
        // canvas/component editor and never hijack text-field selection.
        event.preventDefault();
        emit({ type: 'select-nodes', nodeIds: context.document.nodes.map((node) => node.id) });
        return;
      }
      if (modifier && event.shiftKey && key === 'g') {
        if (ids.length > 0) {
          event.preventDefault();
          emit({ type: 'ungroup-layers', nodeIds: ids });
        }
        return;
      }
      if (modifier && !event.shiftKey && key === 'g') {
        // Let the document operation decide whether this selection can be
        // grouped: a single Group or a parent with descendants can be wrapped.
        if (ids.length > 0) {
          event.preventDefault();
          emit({ type: 'group-layers', nodeIds: ids });
        }
        return;
      }
      if (modifier && event.shiftKey && key === 'm') {
        event.preventDefault();
        const roots = getSelectedLayerRootIds(context.document.nodes, ids);
        if (roots.length !== 1) {
          setNotice('Select one layer or Group to unmask.');
          return;
        }
        const target = context.document.nodes.find((node) => node.id === roots[0]);
        if (!target?.clipMaskBaseId) {
          setNotice('The selected layer is not masked.');
          return;
        }
        emit({ type: 'unmask-layer', nodeId: target.id });
        return;
      }
      if (modifier && !event.shiftKey && key === 'm') {
        event.preventDefault();
        const roots = getSelectedLayerRootIds(context.document.nodes, ids);
        if (roots.length !== 1) {
          setNotice('Multiple layers cannot be masked. Group them first.');
          return;
        }
        const baseId = getClippingMaskBaseId(context.document.nodes, roots[0]);
        if (!baseId) {
          setNotice('No layer directly below to use as a clipping mask.');
          return;
        }
        emit({ type: 'mask-layer', nodeId: roots[0] });
        return;
      }
      if (modifier && key === 'z') { event.preventDefault(); emit({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if (modifier && key === 'y') { event.preventDefault(); emit({ type: 'redo' }); return; }
      if (modifier && key === 'd' && nodes.length > 0) {
        event.preventDefault();
        const copies = nodes.map((node, index) => ({ ...node, id: globalThis.crypto?.randomUUID?.() ?? 'duplicate-' + Date.now() + '-' + index, name: node.name + ' copy', x: node.x + 24, y: node.y + 24 }));
        emit({ type: 'add-nodes', nodes: copies }); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.length > 0) {
        if (selectionSourceRef.current === 'layers') {
          // Master/source layers can only be deleted deliberately from the
          // Layers context menu, never through an easy-to-hit keyboard key.
          event.preventDefault();
          setNotice('Right-click a layer and choose Delete to remove it from Layers and Canvas.');
        } else {
          event.preventDefault();
          emit({ type: 'set-nodes-canvas-state', nodeIds: ids, onCanvas: false });
        }
        return;
      }
      if (event.altKey && !event.shiftKey) {
        const alignmentByKey: Record<string, Alignment> = { arrowleft: 'left', arrowright: 'right', arrowup: 'top', arrowdown: 'bottom' };
        const alignment = alignmentByKey[key];
        if (alignment && nodes.length > 1) { event.preventDefault(); emit({ type: 'transform-nodes', nodes: alignNodes(nodes, alignment) }); }
      } else if (event.altKey && event.shiftKey && (key === 'h' || key === 'v') && nodes.length > 2) {
        event.preventDefault(); emit({ type: 'transform-nodes', nodes: distributeNodes(nodes, key === 'h' ? 'horizontal' : 'vertical') });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeEditorId, state, componentState, isHydrating, componentDeletionDialogOpen]);


  useEffect(() => {
    if (!componentDeletionDialogOpen) return;
    const shell = appShellRef.current;
    const host = deletionModalHostRef.current;
    const dialog = deletionDialogRef.current;
    if (!shell || !host || !dialog) return;
    const restoreFocus = activateModalDialog(shell, host, dialog, deletionFocusReturnRef.current);
    const onKeyDown = (event: KeyboardEvent) => trapModalDialogKeydown(dialog, event, cancelComponentDeletion);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus();
    };
  }, [componentDeletionDialogOpen, pendingComponentDeletion, componentCleanupPending, componentDeletionMode]);

  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <div
      ref={appShellRef}
      class={`app-shell ${layersVisible ? "" : "layers-hidden"} ${inspectorVisible ? "" : "inspector-hidden"} ${isHydrating ? "is-hydrating" : ""} ${resizingPanel ? "is-resizing-panel" : ""}`}
      style={{
        '--layers-panel-width': `${panelWidths.layers}px`,
        '--inspector-panel-width': `${panelWidths.inspector}px`,
      } as JSX.CSSProperties}
      data-active-window={activeWindowId}
      aria-busy={isHydrating}
      onMouseLeave={() => setToolbarHint(DEFAULT_TOOLBAR_HINT)}
      onKeyDown={(event) => {
        if (isHydrating) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <header class="global-toolbar-slot" aria-label="FOLIO application toolbar">
        <nav class="global-menu-bar" aria-label="Application menus">
          <div class="global-toolbar-left">
          <div class="global-menu-items" ref={menuBarRef}>
            <div class="global-menu-entry">
              <button type="button" class="global-menu-item menu-trigger" aria-haspopup="menu" aria-expanded={fileMenuOpen} onClick={() => { setFileMenuOpen((open) => !open); setViewMenuOpen(false); }} onMouseEnter={() => updateToolbarHint('FILE', 'Open or export the current native .flop project.')}>File</button>
              {fileMenuOpen && <div class="global-menu-dropdown" role="menu" aria-label="File menu">
                <button type="button" role="menuitem" onClick={openProjectPicker} disabled={isHydrating}>Open Project…</button>
                <button type="button" role="menuitem" onClick={exportCurrentProject} disabled={isHydrating}>Export Project</button>
              </div>}
              <input
                ref={projectFileInputRef}
                type="file"
                accept=".flop,application/vnd.folio.project+json"
                aria-label="Choose a FOLIO project file"
                hidden
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  // Clear the native input so the same file can be selected again after failure.
                  input.value = '';
                  if (!file) return;

                  try {
                    const project = await openProjectFile(file, async (loadedProject) => {
                      await saveProjectAndActivate(loadedProject);
                      dispatch({ type: 'replace-project', project: loadedProject });
                    });
                    if (!project) return;
                    setActiveEditorId('main');
                    setEditingComponentId(null);
                    setComponentCanvasClosed(true);
                    setComponentCanvasMinimized(false);
                    setNotice('Opened "' + project.metadata.name + '".');
                  } catch (error) {
                    console.error('Folio could not open the selected project file:', error);
                    const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
                    setNotice('Unable to open project: ' + detail);
                  }
                }}
              />
            </div>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item is-disabled" aria-disabled="true" title="Edit menu (planned)" onMouseEnter={() => updateToolbarHint('EDIT', 'Editing, history and selection commands will be organized here.')}>Edit</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <div class="global-menu-entry">
              <button type="button" class="global-menu-item menu-trigger" aria-haspopup="menu" aria-expanded={viewMenuOpen} onClick={() => { setViewMenuOpen((open) => !open); setFileMenuOpen(false); }} onMouseEnter={() => updateToolbarHint('VIEW', 'Workspace display, panels, zoom and window layout controls.')}>View</button>
              {viewMenuOpen && <div class="global-menu-dropdown" role="menu" aria-label="View menu"><button type="button" role="menuitem" onClick={resetWindowLayout}>Reset Window Layout</button></div>}
            </div>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item is-disabled" aria-disabled="true" title="Tools menu (planned)" onMouseEnter={() => updateToolbarHint('TOOLS', 'Design tools and tool-specific settings will be organized here.')}>Tools</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item is-disabled" aria-disabled="true" title="Option menu (planned)" onMouseEnter={() => updateToolbarHint('OPTION', 'Application and workspace preferences will be organized here.')}>Option</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item is-disabled" aria-disabled="true" title="Help menu (planned)" onMouseEnter={() => updateToolbarHint('HELP', 'Keyboard reference, documentation and support will be organized here.')}>Help</span>
          </div>

          </div>
                  <div class="global-project-name" title={`${state.project.metadata.name}.flop`}>
          {projectNameEditing ? (
            <input
              class="global-project-rename-input"
              autoFocus
              value={projectNameDraft}
              aria-label="Project name"
              onInput={(event) => setProjectNameDraft(event.currentTarget.value)}
              onBlur={() => {
                if (!projectNameCancelRef.current) commitProjectName(projectNameDraft);
                projectNameCancelRef.current = false;
                setProjectNameEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  projectNameCancelRef.current = true;
                  setProjectNameDraft(state.project.metadata.name);
                  setProjectNameEditing(false);
                }
              }}
            />
          ) : (
            <button type="button" class="global-project-rename-button" title="Rename project" onClick={() => { setProjectNameDraft(state.project.metadata.name); projectNameCancelRef.current = false; setProjectNameEditing(true); }}>
              <span class="global-project-label">{state.project.metadata.name}</span>
              <span class="global-project-extension">.flop</span>
              <Icon name="edit" />
            </button>
          )}
        </div>
          <div class="global-panel-toggles" aria-label="Workspace panels">
            <div class="global-panel-group" role="group" aria-label="Racks">
              <button ref={pagesRackToggleRef} class={`global-panel-toggle pages-rack-header-toggle ${pagesRackOpen ? 'active' : ''}`} type="button" title={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'} aria-label={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'} aria-pressed={pagesRackOpen} onClick={() => {
                setToolRackOpen(null);
                if (pagesRackOpen) closePagesRack();
                else {
                  focusWindow('pages');
                  setPagesRackOpen(true);
                  closeComponentRack();
                }
              }} onMouseEnter={() => updateToolbarHint('PAGES RACK', 'Manage the pages in this project.')}><Icon name="pages" /></button>
              <button ref={componentRackToggleRef} class={`global-panel-toggle component-rack-header-toggle ${componentRackOpen ? 'active' : ''}`} type="button" title={componentRackOpen ? "Close Component Rack" : "Open Component Rack"} aria-label={componentRackOpen ? "Close Component Rack" : "Open Component Rack"} aria-pressed={componentRackOpen} onClick={() => {
                setToolRackOpen(null);
                if (componentRackOpen) closeComponentRack();
                else {
                  setComponentRackOpen(true);
                  closePagesRack();
                }
              }} onMouseEnter={() => updateToolbarHint('COMPONENT RACK', 'Browse and reuse components saved to your personal library.')}><Icon name="rack" /></button>
            </div>
            <span class="global-panel-group-divider" aria-hidden="true" />
            <div class="global-panel-group" role="group" aria-label="Side panels">
              <button class={`global-panel-toggle ${layersVisible ? 'active' : ''}`} type="button" title="Show / hide Layers sidebar" aria-label="Show or hide Layers sidebar" aria-pressed={layersVisible} onClick={() => setLayersVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('LAYERS SIDEBAR', 'Show or hide the document Layers dock.')}><Icon name="sidebar" /></button>
              <button class={`global-panel-toggle inspector-header-toggle ${inspectorVisible ? 'active' : ''}`} type="button" title={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-label={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-pressed={inspectorVisible} onClick={() => setInspectorVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('INSPECTOR', inspectorVisible ? 'Hide the properties Inspector. Selecting an object opens it automatically.' : 'Show the properties Inspector. Selecting an object also opens it automatically.')}><Icon name="inspector" /></button>
            </div>
            <span class="global-panel-group-divider" aria-hidden="true" />
            <div class="global-panel-group" role="group" aria-label="Workspace windows">
              <button class={`global-panel-toggle canvas-header-toggle ${!canvasClosed && !canvasMinimized ? "active" : ""}`} type="button" title={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-label={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-pressed={!canvasClosed && !canvasMinimized} onClick={() => { if (canvasClosed || canvasMinimized) openMainCanvas(); else { setCanvasClosed(true); setCanvasMinimized(false); } }} onMouseEnter={() => updateToolbarHint('CANVAS WINDOW', canvasClosed || canvasMinimized ? 'Open the Canvas dock.' : 'Close the Canvas workspace.')}><Icon name="canvas" /></button>
              <button class={`global-panel-toggle component-canvas-header-toggle ${componentCanvasOpen ? 'active' : ''}`} type="button" title={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-label={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-pressed={componentCanvasOpen} onClick={() => { if (componentCanvasClosed || componentCanvasMinimized) openComponentCanvas(); else { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); setActiveEditorId('main'); if (!canvasClosed && !canvasMinimized) focusWindow('main-canvas'); } }} onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', componentCanvasClosed || componentCanvasMinimized ? 'Open the Component Canvas window.' : 'Close the Component Canvas window.')}><Icon name="componentCanvas" /></button>
              <button class={`global-panel-toggle node-logic-header-toggle ${nodeLogicOpen ? 'active' : ''}`} type="button" title={nodeLogicClosed || nodeLogicMinimized ? "Open Node Logic" : "Close Node Logic"} aria-label={nodeLogicClosed || nodeLogicMinimized ? "Open Node Logic" : "Close Node Logic"} aria-pressed={nodeLogicOpen} onClick={() => { if (nodeLogicClosed || nodeLogicMinimized) openNodeLogic(); else { setNodeLogicClosed(true); setNodeLogicMinimized(false); } }} onMouseEnter={() => updateToolbarHint('NODE LOGIC', nodeLogicClosed || nodeLogicMinimized ? 'Open the Node Logic workspace.' : 'Close the Node Logic workspace.')}><Icon name="logicNodes" /></button>
            </div>
            <span class="global-panel-group-divider" aria-hidden="true" />
            <button class="global-panel-toggle fullscreen-toggle" type="button" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={enterFullscreen} onMouseEnter={() => updateToolbarHint('FULLSCREEN', 'Enter or exit browser fullscreen mode.')}><Icon name="fullscreen" /></button>
          </div>
        </nav>
        <div class="global-hint-bar" role="status" aria-live="polite">
          <span class="hint-panel-label">{toolbarHint.panel}</span>
          <span class="hint-panel-description">{toolbarHint.description}</span>
          <span class="hint-shortcut-divider" aria-hidden="true">·</span>
          <div class="hint-shortcut-list">
            {toolbarHint.shortcuts.length > 0
              ? toolbarHint.shortcuts.map((shortcut) => <span class="hint-shortcut" key={shortcut}>{shortcut}</span>)
              : <span class="hint-no-shortcuts">SHORTCUTS NOT ASSIGNED</span>}
          </div>
        </div>
      </header>
      {(workspacePreferencesReviewRequired ||
        initialWorkspacePreferences.status === 'unsupported-newer-schema' ||
        initialWorkspacePreferences.status === 'storage-unavailable') && (
        <div class="workspace-preferences-recovery" role="status" aria-live="polite">
          <div class="workspace-preferences-recovery-copy">
            <strong>Workspace layout preferences</strong>
            <span>
              {initialWorkspacePreferences.status === 'migrated'
                ? 'Legacy window settings were found. Review the restored layout before converting them to Workspace Preferences V1.'
                : initialWorkspacePreferences.status === 'recovered'
                  ? 'Some saved layout values needed safe recovery. Review the restored layout before saving it.'
                  : initialWorkspacePreferences.status === 'malformed'
                    ? 'The saved workspace layout is unreadable. The app loaded safe defaults; replacing the damaged record requires your approval.'
                    : initialWorkspacePreferences.status === 'unsupported-newer-schema'
                      ? 'This layout was saved by a newer Folio version. Safe defaults are active and the newer record will not be overwritten.'
                      : 'Browser storage is unavailable. Workspace layout changes cannot be saved in this session.'}
            </span>
          </div>
          {workspacePreferencesReviewRequired && (
            <button type="button" onClick={() => {
              setWorkspacePreferencesReviewRequired(false);
              setWorkspacePreferencesPersistenceEnabled(true);
              setNotice(
                initialWorkspacePreferences.status === 'migrated'
                  ? 'Workspace Preferences V1 migration enabled.'
                  : 'Recovered workspace layout accepted and saving enabled.',
              );
            }}>
              {initialWorkspacePreferences.status === 'migrated'
                ? 'Migrate saved layout'
                : initialWorkspacePreferences.status === 'malformed'
                  ? 'Replace damaged layout'
                  : 'Use recovered layout'}
            </button>
          )}
        </div>
      )}
      <nav ref={toolRailRef} class="tool-rail" aria-label="Tool Rack" onMouseEnter={() => updateToolbarHint('TOOL RACK', 'Choose a cursor tool or create a design object. The active cursor tool works in both Canvas workspaces.')}>
        <div class="tool-rack-caption">TOOLS</div>
        {CANVAS_TOOL_GROUPS.map((group) => {
          const activeInGroup = group.tools.includes(activeCanvasToolId);
          const activeTool = activeInGroup ? getCanvasTool(activeCanvasToolId) : null;
          return (
            <div class="tool-rack-group" key={group.id}>
              <button
                type="button"
                class={'tool-rack-group-trigger ' + (activeInGroup ? 'active' : '') + (toolRackOpen === group.id ? ' open' : '')}
                title={group.label + ' tools'}
                aria-label={group.label + ' tools'}
                aria-expanded={toolRackOpen === group.id}
                onClick={() => setToolRackOpen((current) => current === group.id ? null : group.id)}
                onMouseEnter={() => updateToolbarHint(group.label.toUpperCase(), group.description)}
              >
                <Icon name={activeTool?.icon ?? group.icon} />
                <span>{group.label}</span>
                <Icon name="chevronRight" />
              </button>
              {toolRackOpen === group.id && (
                <div class="tool-rack-menu" role="menu" aria-label={group.label + ' tools'}>
                  {group.tools.map((id) => {
                    const tool = getCanvasTool(id);
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={activeCanvasToolId === id}
                        class={'tool-rack-item ' + (activeCanvasToolId === id ? 'active' : '')}
                        key={id}
                        onClick={() => chooseCanvasTool(id)}
                        onMouseEnter={() => updateToolbarHint(tool.label.toUpperCase(), tool.description)}
                      >
                        <span class="tool-rack-item-icon"><Icon name={tool.icon} /></span>
                        <span class="tool-rack-item-name">{tool.label}</span>
                        {activeCanvasToolId === id && <span class="tool-rack-active-mark">●</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div class="rail-separator" />
        <div class="tool-rack-group">
          <button
            type="button"
            class={'tool-rack-group-trigger ' + (toolRackOpen === 'create' ? 'active open' : '')}
            title="Create tools"
            aria-label="Create tools"
            aria-expanded={toolRackOpen === 'create'}
            onClick={() => setToolRackOpen((current) => current === 'create' ? null : 'create')}
            onMouseEnter={() => updateToolbarHint('CREATE', 'Create new Rectangle, Ellipse or Text objects in the active Canvas workspace.')}
          >
            <Icon name="shapes" />
            <span>Create</span>
            <Icon name="chevronRight" />
          </button>
          {toolRackOpen === 'create' && (
            <div class="tool-rack-menu" role="menu" aria-label="Create tools">
              {([
                { type: 'rect' as const, label: 'Rectangle', icon: 'rect', description: 'Add a new rectangle to the active Canvas.' },
                { type: 'ellipse' as const, label: 'Ellipse', icon: 'ellipse', description: 'Add a new ellipse to the active Canvas.' },
                { type: 'text' as const, label: 'Text', icon: 'text', description: 'Add a new text object to the active Canvas.' },
              ]).map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  class="tool-rack-item"
                  key={item.type}
                  onClick={() => { setToolRackOpen(null); addNode(item.type); }}
                  onMouseEnter={() => updateToolbarHint(item.label.toUpperCase(), item.description)}
                >
                  <span class="tool-rack-item-icon"><Icon name={item.icon} /></span>
                  <span class="tool-rack-item-name">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div class="rail-bottom">
          <button class="tool-button" title="Undo" aria-label="Undo" disabled={focusedEditor.state.past.length === 0} onClick={() => dispatchFocused({ type: 'undo' })}>
            <Icon name="undo" />
          </button>
          <button class="tool-button" title="Redo" aria-label="Redo" disabled={focusedEditor.state.future.length === 0} onClick={() => dispatchFocused({ type: 'redo' })}>
            <Icon name="redo" />
          </button>
        </div>
      </nav>

      <aside class={`layers-panel ${layersVisible ? "" : "is-hidden"}`} onMouseEnter={() => updateToolbarHint('LAYERS', 'Each Layer is one object. Drag an object that is off Canvas to restore it; an object already on Canvas cannot be duplicated by dragging.', ['CTRL/CMD + M: MASK', 'CTRL/CMD + SHIFT + M: UNMASK'])}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Layers sidebar"
          aria-valuenow={panelWidths.layers}
          aria-valuemin={PANEL_RESIZE_CONSTRAINTS.layers.minWidth}
          aria-valuemax={PANEL_RESIZE_CONSTRAINTS.layers.maxWidth}
          tabIndex={layersVisible ? 0 : -1}
          data-resize-panel="layers"
          class={`panel-resize-handle panel-resize-handle-right ${resizingPanel === 'layers' ? 'is-active' : ''}`}
          title="Drag to resize Layers sidebar (double-click to reset)"
          onMouseDown={(event) => startPanelResize('layers', event)}
          onDblClick={() => resetPanelWidth('layers')}
          onKeyDown={(event) => handlePanelResizeKeyDown('layers', event)}
        />
        <div class="panel-heading">
          <h2>Layers</h2>
        </div>
        <div class="layer-list-heading" data-page-id={focusedPage?.id ?? undefined}>
          <span>LAYERS · {layerSourceNodes.length}</span>
          <span class="layer-page-context" title={layerContextTitle}>{layerContextLabel}</span>
        </div>
        <div class="layer-list" role="tree" aria-label="Document layers">
          {layerRows.map(({ node, depth, hasChildren }) => {
            const selected = focusedEditor.state.selectedNodeIds.includes(node.id);
            const effective = layerEffectiveStates.get(node.id);
            const clipBaseName = node.clipMaskBaseId
              ? layerSourceNodes.find((item) => item.id === node.clipMaskBaseId)?.name ?? 'another layer'
              : '';
            const isMaskBase = layerSourceNodes.some((item) => item.clipMaskBaseId === node.id);
            const collapsed = (collapsedLayers[activeEditorId] ?? []).includes(node.id);
            const dropClass = layerDropTarget?.nodeId === node.id ? ('drop-' + layerDropTarget.position) : '';
            return (
              <div
                key={node.id}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected}
                aria-expanded={hasChildren ? !collapsed : undefined}
                tabIndex={0}
                draggable={true}
                class={'layer-row ' + (selected ? 'selected ' : '') + (node.onCanvas === false ? 'layer-not-on-canvas ' : '') + (!effective?.visible ? 'layer-hidden ' : '') + (effective?.locked ? 'layer-inherited-locked ' : '') + (node.clipMaskBaseId ? 'layer-row-clipped ' : '') + (isMaskBase ? 'layer-row-mask-base ' : '') + dropClass}
                style={{ paddingLeft: (8 + depth * 15 + (node.clipMaskBaseId ? 14 : 0)) + 'px' }}
                onClick={(event) => selectLayerFromPanel(node.id, event)}
                onContextMenu={(event) => openLayerContextMenu(node.id, event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectLayerFromPanel(node.id, event);
                  }
                }}
                onDragStart={(event) => startLayerDrag(node.id, event)}
                onDragOver={(event) => updateLayerDropTarget(node.id, event)}
                onDrop={(event) => dropLayer(node.id, event)}
                onDragEnd={() => { layerDragSourceRef.current = null; layerDragEditorRef.current = null; setLayerDropTarget(null); }}
                onDragLeave={() => setLayerDropTarget((current) => current?.nodeId === node.id ? null : current)}
                title={node.onCanvas === false ? 'Restore ' + node.name + ' to Canvas. Its last position, size and appearance will be kept.' : 'Select ' + node.name + '. It is already on Canvas; dragging it there again will not create a duplicate.'}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    class="layer-disclosure"
                    title={collapsed ? 'Expand sub-layers' : 'Collapse sub-layers'}
                    aria-label={collapsed ? ('Expand ' + node.name) : ('Collapse ' + node.name)}
                    onClick={(event) => { event.stopPropagation(); toggleLayerCollapsed(node.id); }}
                  >
                    <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
                  </button>
                ) : <span class="layer-disclosure-spacer" />}
                {node.clipMaskBaseId && <span class="layer-clip-indicator" title={`Clipped to ${clipBaseName}`} aria-label={`Clipped to ${clipBaseName}`}><Icon name="clipArrow" /></span>}
                <LayerIcon type={node.type} />
                {layerRename?.anchorId === node.id ? (
                  <input
                    ref={layerRenameInputRef}
                    class="layer-name-editor"
                    type="text"
                    value={layerRename.value}
                    aria-label={layerRename.batch ? `Rename ${layerRename.nodeIds.length} selected layers` : `Rename ${node.name}`}
                    title={layerRename.batch ? `Batch rename ${layerRename.nodeIds.length} layers (numbered)` : 'Rename layer'}
                    onClick={(event) => event.stopPropagation()}
                    onInput={(event) => updateLayerRenameDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishLayerRename(true);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        finishLayerRename(false);
                      }
                    }}
                    onBlur={() => finishLayerRename(true)}
                  />
                ) : (
                  <span class={'layer-name ' + (isMaskBase ? 'layer-mask-base-name' : '')}>{node.name}</span>
                )}
                <div class="layer-actions">
                  <button
                    type="button"
                    class="layer-color-control"
                    style={{ backgroundColor: node.layerColor ?? '#7f8797' }}
                    title={node.layerColor ? `Layer color ${node.layerColor}` : 'Set layer color'}
                    aria-label={`Choose color for ${node.name}`}
                    aria-expanded={layerColorPickerKey === `${activeEditorId}:${node.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const key = `${activeEditorId}:${node.id}`;
                      if (layerColorPickerKey === key) {
                        setLayerColorPickerKey(null);
                        setLayerColorPickerPosition(null);
                        layerColorAnchorRef.current = null;
                        return;
                      }

                      const anchor = event.currentTarget as HTMLButtonElement;
                      layerColorAnchorRef.current = anchor;
                      const anchorRect = anchor.getBoundingClientRect();
                      const estimatedWidth = 170;
                      const estimatedHeight = 160;
                      const margin = 8;
                      const left = Math.max(
                        margin,
                        Math.min(window.innerWidth - estimatedWidth - margin, anchorRect.right - estimatedWidth),
                      );
                      const belowTop = anchorRect.bottom + 6;
                      const top = belowTop + estimatedHeight <= window.innerHeight - margin
                        ? belowTop
                        : Math.max(margin, anchorRect.top - estimatedHeight - 6);
                      setLayerColorPickerPosition({ top, left });
                      setLayerColorPickerKey(key);
                    }}
                  />
                  <button
                    type="button"
                    class={'layer-control ' + (node.visible ? 'active' : '')}
                    title={node.visible ? 'Hide layer' : 'Show layer'}
                    aria-label={node.visible ? ('Hide ' + node.name) : ('Show ' + node.name)}
                    aria-pressed={node.visible}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLayerPropertyFromRow(node.id, 'visible');
                    }}
                  ><Icon name={node.visible ? 'eye' : 'eyeOff'} /></button>
                  <button
                    type="button"
                    class={'layer-control ' + (node.locked ? 'active' : '')}
                    title={node.locked ? 'Unlock layer' : 'Lock layer'}
                    aria-label={node.locked ? ('Unlock ' + node.name) : ('Lock ' + node.name)}
                    aria-pressed={node.locked}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLayerPropertyFromRow(node.id, 'locked');
                    }}
                  ><Icon name={node.locked ? 'lock' : 'unlock'} /></button>
                </div>
                <span class="layer-color-rail" style={{ backgroundColor: node.layerColor ?? 'transparent' }} aria-hidden="true" />
              </div>
            );
          })}
          {layerSourceNodes.length === 0 && (
            <div class="empty-layers">Your layers will appear here.</div>
          )}
        </div>
      </aside>

      {!canvasClosed && !canvasMinimized && !(componentCanvasOpen && !componentCanvasFloating && !canvasFloating) && !(nodeLogicOpen && !nodeLogicFloating && !canvasFloating) && <FloatingWindow
        as="main"
        id="main-canvas"
        className={`workspace${canvasFloating ? " canvas-floating" : ""}`}
        floating={canvasFloating}
        draggable={canvasFloating}
        position={canvasPosition}
        size={canvasSize}
        zIndex={getWindowZIndex(windowOrder, 'main-canvas')}
        onPositionChange={setCanvasPosition}
        onSizeChange={setCanvasSize}
        onFocus={() => { focusWindow('main-canvas'); setActiveEditorId('main'); selectionSourceRef.current = 'canvas'; }}
        onMouseEnter={() => updateToolbarHint('CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >        <div
          class={`workspace-toolbar${canvasFloating ? " workspace-toolbar-draggable" : ""}`}
        >
          <div class="breadcrumb">
            <strong>{activeDocument.name}</strong>
          </div>
          <div class="canvas-window-tools">
            {state.selectedNodeIds.length > 1 && (
              <div class="alignment-tools" aria-label="Align selected layers">
                <button title="Align left" aria-label="Align left" onClick={() => alignSelection('left')}>⇤</button>
                <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignSelection('horizontal-center')}>↔</button>
                <button title="Align right" aria-label="Align right" onClick={() => alignSelection('right')}>⇥</button>
                <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('horizontal')}>⇌</button>
                <button title="Align top" aria-label="Align top" onClick={() => alignSelection('top')}>⇡</button>
                <button title="Align vertical center" aria-label="Align vertical center" onClick={() => alignSelection('vertical-center')}>↕</button>
                <button title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection('bottom')}>⇣</button>
                <button title="Distribute vertically" aria-label="Distribute vertically" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('vertical')}>⇅</button>
              </div>
            )}
            <div class="workspace-tools">
              <button class="history-button" title="Undo" disabled={focusedEditor.state.past.length === 0} onClick={() => dispatchFocused({ type: 'undo' })}><Icon name="undo" /></button>
              <button class="history-button" title="Redo" disabled={focusedEditor.state.future.length === 0} onClick={() => dispatchFocused({ type: 'redo' })}><Icon name="redo" /></button>
              <span class="workspace-divider" />
              <button class="zoom-button" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}><Icon name="minus" /></button>
              <span class="zoom-value">{Math.round(zoom * 100)}%</span>
              <button class="zoom-button" title="Zoom in" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
            </div>
            <div class="workspace-window-controls" aria-label="Canvas window controls">
              <button type="button" class="window-control window-control-minimize" title="Minimize canvas" aria-label="Minimize canvas" onClick={() => setCanvasMinimized(true)}></button>
              <button type="button" class="window-control" title={canvasFloating ? "Dock Canvas" : "Float Canvas"} aria-label={canvasFloating ? "Dock Canvas" : "Float Canvas"} aria-pressed={canvasFloating} onClick={() => setCanvasWindowMode(canvasFloating ? 'docked' : 'floating')}>{canvasFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Canvas window" aria-label="Close Canvas window" onClick={() => { setCanvasClosed(true); setCanvasMinimized(false); setCanvasWindowMode('docked'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={activeDocument}
            components={state.project.components}
            selectedNodeIds={state.selectedNodeIds}
            toolId={activeCanvasToolId}
            zoom={zoom}
            pan={mainView.pan}
            onPanChange={setMainPan}
            onZoomChange={setZoom}
            onSelectionChange={(nodeIds) => {
              selectionSourceRef.current = 'canvas';
              dispatch({ type: 'select-nodes', nodeIds });
              if (nodeIds.length > 0) setInspectorVisible(true);
            }}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
            onLayerDrop={(nodeIds) => dropLayersOnCanvas(nodeIds, 'main')}
          />
        </div>

      </FloatingWindow>}

      {!componentCanvasClosed && !componentCanvasMinimized && !(nodeLogicOpen && !nodeLogicFloating && !componentCanvasFloating) && <FloatingWindow
        as="main"
        id="component-canvas"
        className={`workspace component-canvas-window${componentCanvasFloating ? " canvas-floating" : " component-canvas-docked"}`}
        floating={componentCanvasFloating}
        draggable={componentCanvasFloating}
        position={componentCanvasPosition}
        size={componentCanvasSize}
        zIndex={getWindowZIndex(windowOrder, 'component-canvas')}
        onPositionChange={setComponentCanvasPosition}
        onSizeChange={setComponentCanvasSize}
        onFocus={() => { focusWindow('component-canvas'); setActiveEditorId('component'); selectionSourceRef.current = 'canvas'; }}
        onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >        <div
          class={`workspace-toolbar${componentCanvasFloating ? " workspace-toolbar-draggable" : ""}`}
        >
          <div class="breadcrumb">
            <Icon name="componentCanvas" />
            <strong>{editingComponent ? editingComponent.name + ' · Master' : 'Component Canvas'}</strong>
          </div>
          {componentRecoveryStatus === 'missing' && (
            <span class="component-recovery-status" role="status">Master temporarily missing · local buffer preserved</span>
          )}
          {(componentRecoveryStatus === 'returned' || componentRecoveryStatus === 'conflict') && (
            <button type="button" class="component-recovery-action" disabled={Boolean(pendingComponentDeletion)} onClick={reloadRecoveredComponentMaster}>
              Discard local edits and reload current master
            </button>
          )}
          {pendingComponentOpenId && (
            <div class="component-recovery-panel" role="alert">
              <span>
                Opening {state.project.components.find((item) => item.id === pendingComponentOpenId)?.name ?? 'another master'} would replace the current local buffer.
              </span>
              <button type="button" class="component-recovery-action" onClick={keepCurrentComponentBuffer}>
                Keep current buffer
              </button>
              <button type="button" class="component-recovery-action" onClick={discardBufferAndOpenPendingMaster}>
                Discard local edits and open requested master
              </button>
            </div>
          )}
          {pendingComponentDeletion && componentCleanupPending && !componentDeletionDialogOpen && (
            <button type="button" class="component-recovery-action" onClick={() => setComponentDeletionDialogOpen(true)}>
              Retry durable Component Canvas cleanup
            </button>
          )}
          <div class="canvas-window-tools">
            <div class="workspace-tools component-canvas-create-tools" aria-label="Component actions">
              <button
                type="button"
                class="component-master-save-button"
                title={editingComponent ? `Update master “${editingComponent.name}”` : 'Save Component Canvas as new component'}
                aria-label={editingComponent ? `Update master ${editingComponent.name}` : 'Save Component Canvas as new component'}
                disabled={!editingComponent && componentDocument.nodes.length === 0}
                onClick={saveComponentCanvasMaster}
              ><Icon name="save" /></button>
              <button
                type="button"
                class="component-save-new-button"
                title="Save selected layers as a new component"
                aria-label="Save selected layers as a new component"
                disabled={selectedComponentNodes.length === 0}
                onClick={() => saveNodesAsComponent(selectedComponentNodes, componentDocument.nodes)}
              ><Icon name="copyPlus" /></button>
            </div>
            {componentState.selectedNodeIds.length > 1 && (
              <div class="alignment-tools" aria-label="Align selected layers">
                <button title="Align left" aria-label="Align left" onClick={() => alignSelection('left', 'component')}>⇤</button>
                <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignSelection('horizontal-center', 'component')}>↔</button>
                <button title="Align right" aria-label="Align right" onClick={() => alignSelection('right', 'component')}>⇥</button>
                <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={componentState.selectedNodeIds.length < 3} onClick={() => distributeSelection('horizontal', 'component')}>⇌</button>
                <button title="Align top" aria-label="Align top" onClick={() => alignSelection('top', 'component')}>⇡</button>
                <button title="Align vertical center" aria-label="Align vertical center" onClick={() => alignSelection('vertical-center', 'component')}>↕</button>
                <button title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection('bottom', 'component')}>⇣</button>
                <button title="Distribute vertically" aria-label="Distribute vertically" disabled={componentState.selectedNodeIds.length < 3} onClick={() => distributeSelection('vertical', 'component')}>⇅</button>
              </div>
            )}
            <div class="workspace-tools">
              <button class="history-button" title="Undo" disabled={componentState.past.length === 0} onClick={() => componentDispatch({ type: 'undo' })}><Icon name="undo" /></button>
              <button class="history-button" title="Redo" disabled={componentState.future.length === 0} onClick={() => componentDispatch({ type: 'redo' })}><Icon name="redo" /></button>
              <span class="workspace-divider" />
              <button class="zoom-button" title="Zoom out" onClick={() => setComponentCanvasZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}><Icon name="minus" /></button>
              <span class="zoom-value">{Math.round(componentCanvasZoom * 100)}%</span>
              <button class="zoom-button" title="Zoom in" onClick={() => setComponentCanvasZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
            </div>
            <div class="workspace-window-controls" aria-label="Component Canvas window controls">
              <button type="button" class="window-control window-control-minimize" title="Minimize Component Canvas" aria-label="Minimize Component Canvas" disabled={Boolean(pendingComponentDeletion)} onClick={() => { setComponentCanvasMinimized(true); setActiveEditorId('main'); if (!canvasClosed && !canvasMinimized) focusWindow('main-canvas'); }}></button>
              <button type="button" class="window-control" title={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-label={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-pressed={componentCanvasFloating} onClick={() => setComponentCanvasWindowMode(componentCanvasFloating ? 'docked' : 'floating')}>{componentCanvasFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Component Canvas window" aria-label="Close Component Canvas window" disabled={Boolean(pendingComponentDeletion)} onClick={() => { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); setComponentCanvasWindowMode('docked'); setActiveEditorId('main'); if (!canvasClosed && !canvasMinimized) focusWindow('main-canvas'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={componentDocument}
            components={state.project.components}
            selectedNodeIds={componentState.selectedNodeIds}
            toolId={activeCanvasToolId}
            zoom={componentCanvasZoom}
            pan={componentView.pan}
            onPanChange={setComponentCanvasPan}
            onZoomChange={setComponentCanvasZoom}
            onSelectionChange={(nodeIds) => {
              selectionSourceRef.current = 'canvas';
              componentDispatch({ type: 'select-nodes', nodeIds });
            }}
            onTransformCommit={(nodes) => componentDispatch({ type: 'transform-nodes', nodes })}
            onLayerDrop={(nodeIds) => dropLayersOnCanvas(nodeIds, 'component')}
          />
        </div>

      </FloatingWindow>}

      {canvasMinimized && !canvasClosed && (
        <FloatingWindow as="div" id="main-canvas" className="canvas-minimized-window" minimized draggable position={canvasPosition} size={canvasSize} zIndex={getWindowZIndex(windowOrder, 'main-canvas')} onPositionChange={setCanvasPosition} onSizeChange={setCanvasSize} onFocus={() => { focusWindow('main-canvas'); setActiveEditorId('main'); }}>
          <div class="canvas-minimized-titlebar">
            <Icon name="canvas" />
            <strong>{activeDocument.name}</strong>
            <button type="button" class="minimized-restore-control" title="Restore Canvas" aria-label="Restore Canvas" onClick={() => setCanvasMinimized(false)}></button>
            <button type="button" title="Close Canvas" aria-label="Close Canvas" onClick={() => { setCanvasClosed(true); setCanvasMinimized(false); }}>×</button>
          </div>
        </FloatingWindow>
      )}

      {componentCanvasMinimized && !componentCanvasClosed && (
        <FloatingWindow as="div" id="component-canvas" className="canvas-minimized-window component-canvas-minimized" minimized draggable position={componentCanvasPosition} size={componentCanvasSize} zIndex={getWindowZIndex(windowOrder, 'component-canvas')} onPositionChange={setComponentCanvasPosition} onSizeChange={setComponentCanvasSize} onFocus={() => { focusWindow('component-canvas'); setActiveEditorId('component'); }}>
          <div class="canvas-minimized-titlebar">
            <Icon name="componentCanvas" />
            <strong>Component Canvas</strong>
            <button type="button" class="minimized-restore-control" title="Restore Component Canvas" aria-label="Restore Component Canvas" onClick={() => setComponentCanvasMinimized(false)}></button>
            <button type="button" title="Close Component Canvas" aria-label="Close Component Canvas" onClick={() => { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); }}>×</button>
          </div>
        </FloatingWindow>
      )}

      {!nodeLogicClosed && !nodeLogicMinimized && <FloatingWindow
        as="main"
        id="node-logic"
        className={`workspace node-logic-window${nodeLogicFloating ? " canvas-floating" : " node-logic-docked"}`}
        floating={nodeLogicFloating}
        draggable={nodeLogicFloating}
        position={nodeLogicPosition}
        size={nodeLogicSize}
        zIndex={getWindowZIndex(windowOrder, 'node-logic')}
        onPositionChange={setNodeLogicPosition}
        onSizeChange={setNodeLogicSize}
        onFocus={() => focusWindow('node-logic')}
        onMouseEnter={() => updateToolbarHint('NODE LOGIC', 'Node Logic workspace for building visual logic flows.')}
      >        <div
          class={`workspace-toolbar${nodeLogicFloating ? " workspace-toolbar-draggable" : ""}`}
        >
          <div class="breadcrumb">
            <Icon name="logicNodes" />
            <strong>Node Logic</strong>
          </div>
          <div class="canvas-window-tools">
            <div class="workspace-window-controls" aria-label="Node Logic window controls">
              <button type="button" class="window-control window-control-minimize" title="Minimize Node Logic" aria-label="Minimize Node Logic" onClick={() => setNodeLogicMinimized(true)}></button>
              <button type="button" class="window-control" title={nodeLogicFloating ? "Dock Node Logic" : "Float Node Logic"} aria-label={nodeLogicFloating ? "Dock Node Logic" : "Float Node Logic"} aria-pressed={nodeLogicFloating} onClick={() => setNodeLogicWindowMode(nodeLogicFloating ? 'docked' : 'floating')}>{nodeLogicFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Node Logic window" aria-label="Close Node Logic window" onClick={() => { setNodeLogicClosed(true); setNodeLogicMinimized(false); setNodeLogicWindowMode('docked'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="node-logic-workspace">
          <div class="node-logic-empty">
            <div class="node-logic-empty-icon"><Icon name="logicNodes" /></div>
            <span class="panel-kicker">VISUAL LOGIC</span>
            <strong>Node Logic</strong>
            <p>Build and connect logic nodes in this independent workspace.</p>
            <span class="node-logic-empty-note">NODE EDITOR · SEPARATE FROM DESIGN CANVAS</span>
          </div>
        </div>

      </FloatingWindow>}

      {nodeLogicMinimized && !nodeLogicClosed && (
        <FloatingWindow as="div" id="node-logic" className="canvas-minimized-window node-logic-minimized" minimized draggable={nodeLogicFloating} position={nodeLogicPosition} size={nodeLogicSize} zIndex={getWindowZIndex(windowOrder, 'node-logic')} onPositionChange={setNodeLogicPosition} onSizeChange={setNodeLogicSize} onFocus={() => focusWindow('node-logic')}>
          <div class="canvas-minimized-titlebar">
            <Icon name="logicNodes" />
            <strong>Node Logic</strong>
            <button type="button" class="minimized-restore-control" title="Restore Node Logic" aria-label="Restore Node Logic" onClick={() => setNodeLogicMinimized(false)}></button>
            <button type="button" title="Close Node Logic" aria-label="Close Node Logic" onClick={() => { setNodeLogicClosed(true); setNodeLogicMinimized(false); }}>×</button>
          </div>
        </FloatingWindow>
      )}

      <aside class={`inspector-panel ${inspectorVisible ? "" : "is-hidden"}`} onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          dispatch({ type: 'commit-edit' });
          componentDispatch({ type: 'commit-edit' });
        }
      }} onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key === 'Enter' && target.matches('input:not([type="checkbox"])')) {
          // Enter confirms a single-line Inspector field. Blurring also runs
          // the same commit path used when the user clicks outside the panel.
          event.preventDefault();
          target.blur();
          dispatch({ type: 'commit-edit' });
          componentDispatch({ type: 'commit-edit' });
        }
      }} onMouseEnter={() => updateToolbarHint('INSPECTOR', 'Edit the selected layer’s position, dimensions, appearance and options.')}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Inspector panel"
          aria-valuenow={panelWidths.inspector}
          aria-valuemin={PANEL_RESIZE_CONSTRAINTS.inspector.minWidth}
          aria-valuemax={PANEL_RESIZE_CONSTRAINTS.inspector.maxWidth}
          tabIndex={inspectorVisible ? 0 : -1}
          data-resize-panel="inspector"
          class={`panel-resize-handle panel-resize-handle-left ${resizingPanel === 'inspector' ? 'is-active' : ''}`}
          title="Drag to resize Inspector panel (double-click to reset)"
          onMouseDown={(event) => startPanelResize('inspector', event)}
          onDblClick={() => resetPanelWidth('inspector')}
          onKeyDown={(event) => handlePanelResizeKeyDown('inspector', event)}
        />
        <div class="panel-heading inspector-heading">
          <div>
            <span class="panel-kicker">PROPERTIES</span>
            <h2>Inspector</h2><span class="panel-context-indicator">{activeEditorId === 'component' ? 'COMPONENT CANVAS' : 'MAIN PAGE'}</span>
          </div>
          {selectedNode && selectionSourceRef.current !== 'layers' && <button class="icon-button danger" title="Remove from Canvas only" onClick={() => dispatchFocused({ type: 'set-nodes-canvas-state', nodeIds: [selectedNode.id], onCanvas: false })}><Icon name="trash" /></button>}
        </div>

        {selectedNode ? (
          <div class="inspector-content">
            <section class="property-section">
              <div class="section-title">Layer</div>
              <label class="field-label">Name</label>
              <input
                class="text-field"
                value={selectedNode.name}
                onInput={(event) => updateSelected({ name: event.currentTarget.value })}
              />
            </section>

            <section class="property-section">
              <div class="section-title">Position</div>
              <div class="field-grid">
                <label class="field-label">X<input class="number-field" type="number" value={Math.round(selectedNode.x)} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelected({ x: value }); }} /></label>
                <label class="field-label">Y<input class="number-field" type="number" value={Math.round(selectedNode.y)} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelected({ y: value }); }} /></label>
                <label class="field-label">W<input class="number-field" type="number" min="1" value={Math.round(selectedNode.width)} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelected({ width: normalizePositiveDimension(value, selectedNode.width) }); }} /></label>
                <label class="field-label">H<input class="number-field" type="number" min="1" value={Math.round(selectedNode.height)} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelected({ height: normalizePositiveDimension(value, selectedNode.height) }); }} /></label>
              </div>
              <label class="field-label rotation-field">Rotation<input class="number-field" type="number" value={selectedNode.rotation} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelected({ rotation: value }); }} /></label>
            </section>

            <section class="property-section">
              <div class="section-title">Appearance</div>
              {selectedNode.type === 'component-instance' ? (
                <>
                  <span class="field-help">LINKED MASTER · {selectedInstanceComponent?.name ?? 'Missing component'}</span>
                  {instanceOverrideTargets?.fillNode && (() => {
                    const target = instanceOverrideTargets.fillNode!;
                    const value = selectedNode.overrides[target.id]?.fill ?? target.style.fill;
                    return (
                      <>
                        <label class="field-label">Instance fill override</label>
                        <div class="color-field-wrap">
                          <input class="color-swatch" type="color"
                            value={value.startsWith('#') && value.length === 7 ? value : '#8B7CF6'}
                            onInput={(event) => updateInstanceOverride(target.id, { fill: event.currentTarget.value })} />
                          <span class="color-value">{value.toUpperCase()}</span>
                        </div>
                      </>
                    );
                  })()}
                  {instanceOverrideTargets?.textNode && (() => {
                    const target = instanceOverrideTargets.textNode!;
                    return (
                      <>
                        <label class="field-label text-content-label">Instance text override</label>
                        <textarea class="text-area-field" rows={3}
                          value={selectedNode.overrides[target.id]?.text ?? target.text}
                          onInput={(event) => updateInstanceOverride(target.id, { text: event.currentTarget.value })} />
                      </>
                    );
                  })()}
                  <div class="instance-actions">
                    <button type="button" onClick={resetInstanceOverrides}
                      disabled={Object.keys(selectedNode.overrides).length === 0}>Reset Overrides</button>
                    <button type="button" onClick={detachSelectedInstance}>Detach Instance</button>
                  </div>
                </>
              ) : selectedNode.type === 'group' ? (
                <span class="field-help">GROUP CONTAINER · Holds child layers as one hierarchy.</span>
              ) : (
                <>
                  <label class="field-label">Fill</label>
                  <div class="color-field-wrap">
                    <input
                      class="color-swatch"
                      type="color"
                      value={selectedNode.style.fill.startsWith('#') && selectedNode.style.fill.length === 7 ? selectedNode.style.fill : '#8B7CF6'}
                      onInput={(event) => updateSelectedStyle({ fill: event.currentTarget.value })}
                    />
                    <span class="color-value">{selectedNode.style.fill.toUpperCase()}</span>
                  </div>
                  {selectedNode.type === 'rect' && (
                    <label class="field-label range-label">Corner radius
                      <input class="number-field" type="number" min="0" value={selectedNode.style.radius ?? 0} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelectedStyle({ radius: Math.max(0, value) }); }} />
                    </label>
                  )}
                  {selectedNode.type === 'text' && (
                    <>
                      <label class="field-label text-content-label">Text content</label>
                      <textarea class="text-area-field" rows={3} value={selectedNode.text} onInput={(event) => updateSelected({ text: event.currentTarget.value })} />
                      <div class="field-grid single-row">
                        <label class="field-label">Font size<input class="number-field" type="number" min="1" value={selectedNode.style.fontSize} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelectedStyle({ fontSize: Math.max(1, value) }); }} /></label>
                        <label class="field-label">Weight<input class="number-field" type="number" min="100" max="900" step="100" value={selectedNode.style.fontWeight} onInput={(event) => { const value = parseNumericInput(event.currentTarget.value); if (value !== null) updateSelectedStyle({ fontWeight: Math.min(900, Math.max(100, value)) }); }} /></label>
                      </div>
                    </>
                  )}
                </>
              )}
            </section>

            <section class="property-section last-section">
              <div class="section-title">Layer options</div>
              <label class="toggle-row"><span>Visible</span><input type="checkbox" checked={selectedNode.visible} onChange={(event) => updateSelected({ visible: event.currentTarget.checked })} /></label>
              <label class="toggle-row"><span>Locked</span><input type="checkbox" checked={selectedNode.locked} onChange={(event) => updateSelected({ locked: event.currentTarget.checked })} /></label>
            </section>
          </div>
        ) : focusedEditor.state.selectedNodeIds.length > 1 ? (
          <div class="inspector-empty multi-inspector">
            <div class="empty-icon"><Icon name="layers" /></div>
            <strong>{focusedEditor.state.selectedNodeIds.length} layers selected</strong>
            <p>Drag to move the group, use the resize handles, or choose an alignment control above the canvas.</p>
          </div>
        ) : (
          <div class="inspector-empty">
            <div class="empty-icon"><Icon name="cursor" /></div>
            <strong>Nothing selected</strong>
            <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
            <div class="quick-add">
              <button onClick={() => addNode('rect')}>+ Rectangle</button>
              <button onClick={() => addNode('text')}>+ Text</button>
            </div>
          </div>
        )}
      </aside>


      <section ref={pagesRackRef} class={`pages-rack-panel ${pagesRackOpen ? 'is-open' : ''}`} onPointerDown={() => focusWindow('pages')} aria-label="Pages Rack" aria-hidden={!pagesRackOpen} inert={!pagesRackOpen}>
        <div class="pages-rack-heading">
          <div class="pages-rack-title"><span class="panel-kicker">PROJECT STRUCTURE</span><strong>Pages</strong><span class="pages-rack-count">{pages.length}</span></div>
          <div class="pages-rack-actions">
            <input class="pages-rack-name-input" type="text" placeholder="New page name..." value={pageNameDraft} onInput={(event) => setPageNameDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') addPage(); }} aria-label="New page name" />
            <button type="button" class="pages-rack-add" onClick={addPage} disabled={!pageNameDraft.trim()}>＋ Add page</button>
            <button type="button" class="component-rack-close" title="Close Pages Rack" aria-label="Close Pages Rack" onClick={closePagesRack}>×</button>
          </div>
        </div>
        <div class="pages-rack-list">
          {pages.map((page) => (
            <button type="button" key={page.id} class={`pages-rack-card ${activePageId === page.id ? 'is-active' : ''}`} onClick={() => switchPage(page)} aria-current={activePageId === page.id ? 'page' : undefined}>
              <span class="pages-rack-card-icon"><Icon name="pages" /></span>
              <span class="pages-rack-card-copy"><strong>{page.name}</strong><small>{page.route}</small></span>
              <span class="pages-rack-card-kind">{page.route === '/' ? 'HOME' : page.route === '/404' ? '404' : 'PAGE'}</span>
            </button>
          ))}
        </div>
      </section>

      <section ref={componentRackRef} class={`component-rack-panel ${componentRackOpen ? 'is-open' : ''}`} aria-label="Component Rack" aria-hidden={!componentRackOpen} inert={!componentRackOpen}>
        <div class="component-rack-heading">
          <div class="component-rack-title">
            <span class="panel-kicker">YOUR LIBRARY</span>
            <strong>Component Rack</strong>
            <span class="component-rack-count">{ownedComponents.length}</span>
          </div>
          <div class="component-rack-actions">
            <input class="component-rack-search" type="search" placeholder="Search components..." value={componentRackSearch} onInput={(event) => setComponentRackSearch(event.currentTarget.value)} />
            <button type="button" class="component-rack-save" onClick={createNewMasterComponent} title="Create a new master component">＋ New component</button>
            <button type="button" class="component-rack-save" disabled={selectedNodes.length === 0} onClick={saveSelectionAsComponent} title="Save selected layers as a reusable component">Save selection</button>
            <button type="button" class="component-rack-close" title="Close Component Rack" aria-label="Close Component Rack" onClick={closeComponentRack}>×</button>
          </div>
        </div>
        <div class="component-rack-list">
          {ownedComponents.filter((component) => component.name.toLowerCase().includes(componentRackSearch.toLowerCase())).map((component) => (
            <article class="component-rack-card" key={component.id}>
              <button type="button" class="component-rack-preview" title={`Insert linked ${component.name} into Main Canvas`} onClick={() => insertOwnedComponent(component)}>
                <ComponentThumbnail component={component} components={ownedComponents} />
                <span class="component-rack-card-name">{component.name}</span>
                <span class="component-rack-card-meta">{component.document.nodes.length} master layer{component.document.nodes.length === 1 ? '' : 's'}</span>
              </button>
              <div class="component-rack-card-actions">
                <button type="button" title={`Edit ${component.name} master`} onClick={() => openMasterComponent(component)}>Edit Master</button>
                {renamingComponentId === component.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); renameComponent(component.id); }}>
                    <input aria-label={`Rename ${component.name}`} value={componentNameDraft} onInput={(event) => setComponentNameDraft(event.currentTarget.value)} />
                    <button type="submit">Save</button>
                    <button type="button" onClick={() => setRenamingComponentId(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" title={`Rename ${component.name}`} onClick={() => { setRenamingComponentId(component.id); setComponentNameDraft(component.name); }}>Rename</button>
                )}
                <button type="button" title={`Duplicate ${component.name}`} onClick={() => duplicateComponent(component)}>Duplicate</button>
                <button type="button" class="component-rack-delete" title={`Delete ${component.name}`} aria-label={`Delete ${component.name}`} onClick={() => deleteComponent(component)}>Delete</button>
              </div>
            </article>
          ))}
          {ownedComponents.length === 0 && <div class="component-rack-empty"><Icon name="rack" /><strong>Your component library is empty</strong><span>Select layers on the canvas and choose “Save selection” to keep reusable components here.</span></div>}
          {ownedComponents.length > 0 && ownedComponents.every((component) => !component.name.toLowerCase().includes(componentRackSearch.toLowerCase())) && <div class="component-rack-empty">No components match “{componentRackSearch}”.</div>}
        </div>
      </section>

      {(() => {
        if (!layerColorPickerKey) return null;
        const prefix = `${activeEditorId}:`;
        if (!layerColorPickerKey.startsWith(prefix)) return null;
        const targetNodeId = layerColorPickerKey.slice(prefix.length);
        const colorNode = layerSourceNodes.find((item) => item.id === targetNodeId);
        if (!colorNode) return null;
        return (
          <div
            ref={layerColorPaletteRef}
            class="layer-color-palette"
            style={layerColorPickerPosition ? { top: `${layerColorPickerPosition.top}px`, left: `${layerColorPickerPosition.left}px` } : undefined}
            role="group"
            aria-label={`Color tags for ${colorNode.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <span>Layer color</span>
            <div class="layer-color-swatches">
              {LAYER_COLOR_PRESETS.map((color) => (
                <button
                  type="button"
                  key={color}
                  class={'layer-color-swatch ' + (colorNode.layerColor === color ? 'active' : '')}
                  style={{ backgroundColor: color }}
                  title={color}
                  aria-label={`Apply ${color} to selected layers`}
                  onClick={() => {
                    setLayerColorFromRow(colorNode.id, color);
                    setLayerColorPickerKey(null);
                    setLayerColorPickerPosition(null);
                    layerColorAnchorRef.current = null;
                  }}
                />
              ))}
            </div>
            <label class="layer-color-custom">
              <span>Custom</span>
              <input
                type="color"
                value={colorNode.layerColor ?? '#7f8797'}
                aria-label="Custom layer color"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setLayerColorFromRow(colorNode.id, event.currentTarget.value)}
              />
            </label>
          </div>
        );
      })()}

      {layerContextMenu && (
        <div
          ref={layerContextMenuRef}
          class="layer-context-menu"
          role="menu"
          aria-label={`Actions for ${contextMenuNodes.find((node) => node.id === layerContextMenu.nodeId)?.name ?? 'layer'}`}
          style={{ position: 'fixed', left: layerContextMenu.x + 'px', top: layerContextMenu.y + 'px' }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => {
            const menu = layerContextMenu;
            setLayerContextMenu(null);
            beginLayerRename(menu.nodeId, false);
          }}>Rename</button>
          {contextMenuCanGroup && <button type="button" role="menuitem" onClick={() => {
            const menu = layerContextMenu;
            const targetDispatch = menu.editorId === 'main' ? dispatch : componentDispatch;
            setLayerContextMenu(null);
            selectionSourceRef.current = 'layers';
            targetDispatch({ type: 'group-layers', nodeIds: contextMenuRootIds });
          }}>Group</button>}
          {contextMenuCanUngroup && <button type="button" role="menuitem" onClick={() => {
            const menu = layerContextMenu;
            const targetDispatch = menu.editorId === 'main' ? dispatch : componentDispatch;
            setLayerContextMenu(null);
            selectionSourceRef.current = 'layers';
            targetDispatch({ type: 'ungroup-layers', nodeIds: contextMenuRootIds });
          }}>Ungroup</button>}
          {contextMenuCanMask && <button type="button" role="menuitem" onClick={() => {
            const menu = layerContextMenu;
            const targetDispatch = menu.editorId === 'main' ? dispatch : componentDispatch;
            setLayerContextMenu(null);
            selectionSourceRef.current = 'layers';
            targetDispatch({ type: 'mask-layer', nodeId: contextMenuRootIds[0] });
          }}>Create Clipping Mask</button>}
          {contextMenuCanUnmask && <button type="button" role="menuitem" onClick={() => {
            const menu = layerContextMenu;
            const targetDispatch = menu.editorId === 'main' ? dispatch : componentDispatch;
            setLayerContextMenu(null);
            selectionSourceRef.current = 'layers';
            targetDispatch({ type: 'unmask-layer', nodeId: contextMenuRootIds[0] });
          }}>Release Clipping Mask</button>}
          <div class="layer-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" class="layer-context-menu-danger" onClick={() => {
            const menu = layerContextMenu;
            const targetDispatch = menu.editorId === 'main' ? dispatch : componentDispatch;
            setLayerContextMenu(null);
            selectionSourceRef.current = 'layers';
            targetDispatch({ type: 'delete-nodes', nodeIds: menu.nodeIds });
          }}><Icon name="trash" /> Delete{layerContextMenu.nodeIds.length > 1 ? ` (${layerContextMenu.nodeIds.length})` : ''}</button>
        </div>
      )}

      <footer class="statusbar">
        <div><span class="status-brand">F</span><span>Folio Studio <b>0.1.0</b></span></div>
        <div class="status-center">{activeDocument.nodes.length} LAYERS <span>·</span> {activeDocument.width} × {activeDocument.height} PX</div>
        <div class={`status-right save-${saveStatus}`} role="status" aria-live="polite"><span class="status-ready-dot" /> {isHydrating ? 'RESTORING PROJECT…' : statusLabel}</div>
        <div class={`component-buffer-save component-save-${componentSaveStatus}`}>
          <span role="status" aria-live="polite" aria-atomic="true">
            Component Canvas: {componentSaveStatus === 'saving' ? 'Saving…' : componentSaveStatus === 'saved' ? 'Saved' : 'Save error'}
            {componentSaveError && <span class="component-buffer-save-error"> — {componentSaveError}</span>}
          </span>
          {componentSaveStatus === 'error' && <button type="button" onClick={retryComponentCanvasSave}>Retry buffer save</button>}
          {componentCleanupPending && <button type="button" onClick={retryComponentBufferCleanup}>Retry buffer cleanup</button>}
        </div>
      </footer>

      {componentDeletionDialogOpen && pendingComponentDeletion && (
        <div class="component-deletion-modal-host" ref={deletionModalHostRef}>
          <div class="component-deletion-backdrop" aria-hidden="true" />
          <section
            class="component-deletion-dialog"
            key={componentDeletionMode}
            role="dialog"
            aria-modal="true"
            aria-labelledby="component-delete-recovery-title"
            aria-describedby="component-delete-recovery-description"
            tabIndex={-1}
            ref={deletionDialogRef}
          >
            {componentDeletionMode === 'clean' ? (
              <>
                <h2 id="component-delete-recovery-title">Deleting “{pendingComponentDeletion.name}”</h2>
                <p id="component-delete-recovery-description">The clean master deletion is being committed and saved to IndexedDB. The Component Canvas buffer will only be cleared after both the project and buffer cleanup transactions complete.</p>
                <div class="component-deletion-progress" role="status" aria-live="polite">Saving canonical project and buffer cleanup…</div>
              </>
            ) : componentCleanupPending ? (
              <>
                <h2 id="component-delete-recovery-title">Deletion saved; buffer cleanup pending</h2>
                <p id="component-delete-recovery-description">The master deletion and any recovery copy are durable. The local Component Canvas buffer has not been cleared because its cleanup transaction failed. Your buffer remains preserved.</p>
                <button type="button" class="component-recovery-action" data-dialog-initial-focus onClick={retryComponentBufferCleanup} disabled={componentDeletionBusy}>
                  {componentDeletionBusy ? 'Saving cleanup…' : 'Retry durable cleanup'}
                </button>
                <p>Keep this dialog open until cleanup succeeds. Your protected buffer remains durable and will not be removed on failure.</p>
              </>
            ) : componentDeletionMode === 'recovery' && durableRecoveryComponentId ? (
              <>
                <h2 id="component-delete-recovery-title">Recovery copy saved; deletion needs retry</h2>
                <p id="component-delete-recovery-description">The recovery copy is already durable. The original master and local buffer were preserved after deletion persistence failed. Retry the second canonical commit without creating another recovery copy.</p>
                <button type="button" class="component-recovery-action" data-dialog-initial-focus onClick={saveBufferAsNewAndDelete} disabled={componentDeletionBusy}>
                  {componentDeletionBusy ? 'Retrying deletion…' : 'Retry deletion using saved recovery'}
                </button>
                <button type="button" class="component-recovery-action" onClick={cancelComponentDeletion} disabled={componentDeletionBusy}>
                  Cancel and keep both
                </button>
              </>
            ) : (
              <>
                <h2 id="component-delete-recovery-title">Delete “{pendingComponentDeletion.name}” master?</h2>
                <p id="component-delete-recovery-description">The active Component Canvas buffer is protected by local edits or recovery state. Choose how to continue. No deletion happens until you choose an action.</p>
                <button type="button" class="component-recovery-action" data-dialog-initial-focus onClick={cancelComponentDeletion} disabled={componentDeletionBusy}>
                  Cancel
                </button>
                <button type="button" class="component-recovery-action" onClick={saveBufferAsNewAndDelete} disabled={componentDeletionBusy}>
                  {componentDeletionBusy ? 'Saving recovery…' : 'Save buffer as a new component'}
                </button>
                <button type="button" class="component-recovery-action" onClick={discardBufferAndDelete} disabled={componentDeletionBusy}>
                  {componentDeletionBusy ? 'Deleting…' : 'Discard buffer and delete'}
                </button>
              </>
            )}
            {componentSaveStatus === 'error' && !componentCleanupPending && componentDeletionMode !== 'clean' && (
              <button type="button" class="component-recovery-action" onClick={retryComponentCanvasSave}>
                Retry Component Canvas buffer save
              </button>
            )}
          </section>
        </div>
      )}

      {isHydrating && (
        <div class="project-hydration-overlay" role="status" aria-live="polite">
          <div class="project-hydration-indicator" />
          <strong>RESTORING PROJECT</strong>
          <span>Loading your pages and component library from local storage</span>
        </div>
      )}
      {notice && <div class="toast" role="status">{notice}</div>}
    </div>
  );
}

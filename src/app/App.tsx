import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEmptyDocument, createInitialProject, createNode } from '../core/document/factory';
import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioPage } from '../core/document/types';
import { expandSelectedLayers, getEffectiveLayerStates, getLayerPanelRows, type LayerDropPosition } from '../core/document/layers';
import { createComponentInstance, detachComponentInstance, getComponentOverrideTargets } from '../core/document/components';
import { getActiveDocument, getActivePage } from '../core/document/project';
import { loadMostRecentProject, loadProjectById, saveProject } from '../core/persistence/indexedDb';
import { Canvas } from '../engines/canvas/Canvas';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../engines/canvas/geometry';
import { createEditorState, editorReducer, normalizePositiveDimension } from './editorReducer';
import { FloatingWindow } from './FloatingWindow';
import { getActiveEditorContext, getTransformableNodes, type EditorTarget } from './editorContext';
import { bringWindowToFront, getDefaultWindowLayouts, getWindowZIndex, recoverWindowLayout, type WindowId } from './windowManager';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    cursor: 'M5 3l14 9-6 1.5L10 20 5 3z',
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
    save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
    fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    sidebar: 'M4 4h16v16H4zM9 4v16',
    canvas: 'M3 4h18v16H3zM7 8h10v8H7z',
    componentCanvas: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    logicNodes: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h3a3 3 0 0 1 3 3v4',
    inspector: 'M4 4h16v16H4zM15 4v16',
    rack: 'M3 5h18v14H3zM7 9h4v6H7zM14 9h3M14 12h3M14 15h3',
    pages: 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8',
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
      <path d={paths[name] ?? paths.layers} />
    </svg>
  );
}

function LayerIcon({ type }: { type: DesignNode['type'] }) {
  const glyph = type === 'text' ? 'T' : type === 'ellipse' ? '○' : type === 'component-instance' ? '◇' : '□';
  return <span class={`layer-type layer-type-${type}`}>{glyph}</span>;
}

type ToolbarHint = {
  panel: string;
  description: string;
  shortcuts: string[];
};

const DEFAULT_TOOLBAR_HINT: ToolbarHint = {
  panel: 'WORKSPACE',
  description: 'Point at a panel to see what it does and which shortcuts are available.',
  shortcuts: ['SPACE + DRAG', 'SHIFT + CLICK'],
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
  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
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
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const isHydrating = !isProjectLoaded || !componentReady;
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [mainView, setMainView] = useState<CanvasViewState>(() => readCanvasViewState('folio.main-canvas-view'));
  const [componentView, setComponentView] = useState<CanvasViewState>(() => readCanvasViewState('folio.component-canvas-view'));
  const zoom = mainView.zoom;
  const setZoom = (next: number | ((current: number) => number)) => setMainView((view) => ({ ...view, zoom: typeof next === 'function' ? next(view.zoom) : next }));
  const componentCanvasZoom = componentView.zoom;
  const setComponentCanvasZoom = (next: number | ((current: number) => number)) => setComponentView((view) => ({ ...view, zoom: typeof next === 'function' ? next(view.zoom) : next }));
  const setMainPan = (pan: { x: number; y: number }) => setMainView((view) => ({ ...view, pan }));
  const setComponentCanvasPan = (pan: { x: number; y: number }) => setComponentView((view) => ({ ...view, pan }));
  const [toolbarHint, setToolbarHint] = useState<ToolbarHint>(DEFAULT_TOOLBAR_HINT);
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameCancelRef = useRef(false);
  const [layersVisible, setLayersVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [collapsedLayers, setCollapsedLayers] = useState<Record<EditorTarget, string[]>>({ main: [], component: [] });
  const [layerDropTarget, setLayerDropTarget] = useState<{ nodeId: string; position: LayerDropPosition } | null>(null);
  const layerDragSourceRef = useRef<string[] | null>(null);
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

    updatePalettePosition();
    window.addEventListener('resize', updatePalettePosition);
    window.addEventListener('scroll', updatePalettePosition, true);
    return () => {
      window.removeEventListener('resize', updatePalettePosition);
      window.removeEventListener('scroll', updatePalettePosition, true);
    };
  }, [layerColorPickerKey]);
  const [activeEditorId, setActiveEditorId] = useState<EditorTarget>('main');
  const [windowOrder, setWindowOrder] = useState<WindowId[]>(['node-logic', 'component-canvas', 'pages', 'main-canvas']);
  const [activeWindowId, setActiveWindowId] = useState<WindowId>('main-canvas');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [componentRackOpen, setComponentRackOpen] = useState(false);
  const [pagesRackOpen, setPagesRackOpen] = useState(false);
  const [pageNameDraft, setPageNameDraft] = useState('');
  const pages = state.project.pages;
  const activePageId = state.project.activePageId;

  const [componentRackSearch, setComponentRackSearch] = useState('');
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [renamingComponentId, setRenamingComponentId] = useState<string | null>(null);
  const [componentNameDraft, setComponentNameDraft] = useState('');
  const ownedComponents = state.project.components;
  const editingComponent = ownedComponents.find((component) => component.id === editingComponentId) ?? null;
  const [canvasMinimized, setCanvasMinimized] = useState(false);
  const [canvasClosed, setCanvasClosed] = useState(false);
  const [canvasWindowMode, setCanvasWindowMode] = useState<'docked' | 'floating'>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      return saved?.mode === 'floating' ? 'floating' : 'docked';
    } catch { return 'docked'; }
  });
  const canvasFloating = canvasWindowMode === 'floating';
  const [canvasSize, setCanvasSize] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      // Keep enough free screen area around the window for reliable dragging.
      const maxWidth = Math.max(280, Math.min(viewportWidth * 0.82, viewportWidth - 24));
      const maxHeight = Math.max(220, Math.min(viewportHeight * 0.60, viewportHeight - 56 - 27 - 16));
      const preferredWidth = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(860, viewportWidth * 0.78);
      const preferredHeight = Number.isFinite(saved?.size?.height) ? saved.size.height : Math.min(620, viewportHeight * 0.58);
      return {
        width: Math.min(maxWidth, Math.max(280, preferredWidth)),
        height: Math.min(maxHeight, Math.max(220, preferredHeight)),
      };
    } catch {
      return {
        width: Math.max(280, Math.min(860, window.innerWidth * 0.78, window.innerWidth * 0.82)),
        height: Math.max(220, Math.min(620, window.innerHeight * 0.58)),
      };
    }
  });
  const [componentCanvasClosed, setComponentCanvasClosed] = useState(true);
  const [componentCanvasMinimized, setComponentCanvasMinimized] = useState(false);
  const [componentCanvasWindowMode, setComponentCanvasWindowMode] = useState<'docked' | 'floating'>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      return saved?.mode === 'docked' ? 'docked' : 'floating';
    } catch { return 'floating'; }
  });
  const componentCanvasFloating = componentCanvasWindowMode === 'floating';
  const componentCanvasOpen = !componentCanvasClosed && !componentCanvasMinimized;
  const [componentCanvasSize, setComponentCanvasSize] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(680, viewportWidth * 0.72);
      const height = Number.isFinite(saved?.size?.height) ? saved.size.height : Math.min(500, viewportHeight * 0.58);
      return {
        width: Math.min(Math.max(280, viewportWidth - 24), Math.max(280, width)),
        height: Math.min(Math.max(220, viewportHeight - 100), Math.max(220, height)),
      };
    } catch {
      return {
        width: Math.max(280, Math.min(680, window.innerWidth * 0.72)),
        height: Math.max(220, Math.min(500, window.innerHeight * 0.58)),
      };
    }
  });
  const [componentCanvasPosition, setComponentCanvasPosition] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(680, viewportWidth * 0.72);
      return {
        x: Number.isFinite(saved?.position?.x) ? saved.position.x : Math.max(24, viewportWidth - width - 48),
        y: Math.max(56, Number.isFinite(saved?.position?.y) ? saved.position.y : 112),
      };
    } catch { return { x: Math.max(24, window.innerWidth - 700), y: 112 }; }
  });

  const [nodeLogicClosed, setNodeLogicClosed] = useState(true);
  const [nodeLogicMinimized, setNodeLogicMinimized] = useState(false);
  const [nodeLogicWindowMode, setNodeLogicWindowMode] = useState<'docked' | 'floating'>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.node-logic-window') ?? 'null');
      return saved?.mode === 'docked' ? 'docked' : 'floating';
    } catch { return 'floating'; }
  });
  const nodeLogicFloating = nodeLogicWindowMode === 'floating';
  const nodeLogicOpen = !nodeLogicClosed && !nodeLogicMinimized;
  const [nodeLogicSize, setNodeLogicSize] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.node-logic-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(720, viewportWidth * 0.74);
      const height = Number.isFinite(saved?.size?.height) ? saved.size.height : Math.min(540, viewportHeight * 0.60);
      return {
        width: Math.min(Math.max(280, viewportWidth - 24), Math.max(280, width)),
        height: Math.min(Math.max(220, viewportHeight - 100), Math.max(220, height)),
      };
    } catch {
      return {
        width: Math.max(280, Math.min(720, window.innerWidth * 0.74)),
        height: Math.max(220, Math.min(540, window.innerHeight * 0.60)),
      };
    }
  });
  const [nodeLogicPosition, setNodeLogicPosition] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.node-logic-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(720, viewportWidth * 0.74);
      return {
        x: Number.isFinite(saved?.position?.x) ? saved.position.x : Math.max(40, Math.round((viewportWidth - width) * 0.18)),
        y: Math.max(56, Number.isFinite(saved?.position?.y) ? saved.position.y : 146),
      };
    } catch { return { x: Math.max(40, Math.round((window.innerWidth - 720) * 0.18)), y: 146 }; }
  });

  const [canvasPosition, setCanvasPosition] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      const savedX = Number.isFinite(saved?.position?.x) ? saved.position.x : 48;
      const savedY = Number.isFinite(saved?.position?.y) ? saved.position.y : 80;
      // Horizontal and bottom placement are intentionally unbounded; only keep
      // the titlebar below the app header so the window can always be recovered.
      return {
        x: savedX,
        y: Math.max(56, savedY),
      };
    } catch { return { x: 48, y: 80 }; }
  });

  useEffect(() => {
    try { window.localStorage.setItem('folio.main-canvas-view', JSON.stringify(mainView)); }
    catch (error) { console.warn('Folio could not persist Main Canvas view:', error); }
  }, [mainView]);

  useEffect(() => {
    try { window.localStorage.setItem('folio.component-canvas-view', JSON.stringify(componentView)); }
    catch (error) { console.warn('Folio could not persist Component Canvas view:', error); }
  }, [componentView]);

  useEffect(() => {
    try {
      window.localStorage.setItem('folio.canvas-window', JSON.stringify({ mode: canvasWindowMode, position: canvasPosition, size: canvasSize }));
    } catch (error) {
      console.warn('Folio could not persist Canvas window layout:', error);
    }
  }, [canvasWindowMode, canvasPosition, canvasSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem('folio.component-canvas-window', JSON.stringify({
        mode: componentCanvasWindowMode,
        position: componentCanvasPosition,
        size: componentCanvasSize,
      }));
    } catch (error) {
      console.warn('Folio could not persist Component Canvas window layout:', error);
    }
  }, [componentCanvasWindowMode, componentCanvasPosition, componentCanvasSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem('folio.node-logic-window', JSON.stringify({
        mode: nodeLogicWindowMode,
        position: nodeLogicPosition,
        size: nodeLogicSize,
      }));
    } catch (error) {
      console.warn('Folio could not persist Node Logic window layout:', error);
    }
  }, [nodeLogicWindowMode, nodeLogicPosition, nodeLogicSize]);

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
    const timer = window.setTimeout(() => {
      saveProject(componentState.project).catch((error: unknown) => {
        console.error('Folio Component Canvas autosave failed:', error);
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [componentState.project, componentReady]);

  useEffect(() => {
    if (!isProjectLoaded) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveProject(state.project)
        .then(() => setSaveStatus('saved'))
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setSaveStatus('error');
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
  const layerRows = getLayerPanelRows(focusedDocument.nodes, collapsedLayers[activeEditorId]);
  const layerEffectiveStates = getEffectiveLayerStates(focusedDocument.nodes);
  const beginLayerRename = (nodeId: string, batch: boolean) => {
    const selectedIds = focusedEditor.state.selectedNodeIds;
    const nodeIds = batch
      ? layerRows.filter(({ node }) => selectedIds.includes(node.id)).map(({ node }) => node.id)
      : [nodeId];
    const clickedNode = focusedDocument.nodes.find((node) => node.id === nodeId);
    if (!clickedNode || nodeIds.length === 0) return;
    const selectedSet = new Set(nodeIds);
    const session: LayerRenameSession = {
      anchorId: nodeId,
      nodeIds,
      value: batch ? clickedNode.name.replace(/\s+\d+$/, '') : clickedNode.name,
      batch,
      editorId: activeEditorId,
      existingNames: focusedDocument.nodes.filter((node) => !selectedSet.has(node.id)).map((node) => node.name),
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
    const validIds = focusedDocument.nodes.filter((node) => targetIds.includes(node.id)).map((node) => node.id);
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
    const targets = focusedDocument.nodes.filter((node) => targetIds.includes(node.id));
    if (targets.length === 0) return;
    const shouldEnable = !targets.every((node) => node[property]);
    dispatchFocused({
      type: 'set-nodes-properties',
      nodeIds: targets.map((node) => node.id),
      properties: { [property]: shouldEnable },
    });
  };

  const selectLayerFromPanel = (nodeId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    const selected = focusedEditor.state.selectedNodeIds;
    const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey);
    if (modifiers.shiftKey && selected.length > 1 && selected.includes(nodeId)) {
      beginLayerRename(nodeId, true);
      return;
    }
    if (!modifiers.shiftKey && !additive && selected.length === 1 && selected[0] === nodeId) {
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
        const next = additive ? [...new Set([...selected, ...range])] : range;
        dispatchFocused({ type: 'select-nodes', nodeIds: next });
        setInspectorVisible(true);
        return;
      }
    }
    if (additive) {
      const next = selected.includes(nodeId)
        ? selected.filter((id) => id !== nodeId)
        : [...selected, nodeId];
      const anchor = layerSelectionAnchorRef.current[activeEditorId];
      if (!anchor || !selected.includes(anchor)) layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      dispatchFocused({ type: 'select-nodes', nodeIds: next });
    } else {
      layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      dispatchFocused({ type: 'select-node', nodeId });
    }
    setInspectorVisible(true);
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
    const currentSelection = focusedEditor.state.selectedNodeIds;
    const draggedIds = currentSelection.includes(nodeId) ? currentSelection : [nodeId];
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
    setLayerDropTarget(null);
  };

  const addNode = (type: 'rect' | 'ellipse' | 'text') => {
    if (isHydrating) return;
    dispatchFocused({ type: 'add-node', node: createNode(type, focusedDocument.nodes.length) });
    setInspectorVisible(true);
  };
  const saveNodesAsComponent = (nodes: DesignNode[]) => {
    const reusableNodes = nodes.filter((node) => node.type !== 'component-instance');
    if (isHydrating || reusableNodes.length === 0) return;
    const name = reusableNodes.length === 1 ? reusableNodes[0].name : `Component ${ownedComponents.length + 1}`;
    const minX = Math.min(...reusableNodes.map((node) => node.x));
    const minY = Math.min(...reusableNodes.map((node) => node.y));
    const maxX = Math.max(...reusableNodes.map((node) => node.x + node.width));
    const maxY = Math.max(...reusableNodes.map((node) => node.y + node.height));
    const now = new Date().toISOString();
    const component: ComponentDefinition = {
      id: globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`,
      name,
      document: {
        ...createEmptyDocument(name, Math.max(1, maxX - minX), Math.max(1, maxY - minY)),
        background: '#00000000',
        nodes: reusableNodes.map((node) => ({ ...node, x: node.x - minX, y: node.y - minY })),
      },
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: 'add-component', component });
    setComponentRackOpen(true);
    setNotice(`“${name}” saved to this project’s Component Rack.`);
  };

  const openMasterComponent = (component: ComponentDefinition) => {
    const editorProject = createInitialProject(component.name);
    editorProject.metadata.id = 'folio-component-canvas';
    editorProject.metadata.name = component.name;
    editorProject.pages[0].name = component.name;
    editorProject.pages[0].route = '/';
    editorProject.pages[0].document = {
      ...component.document,
      name: component.name,
      nodes: component.document.nodes.map((node) => ({ ...node })),
    };
    componentDispatch({ type: 'replace-project', project: editorProject });
    setEditingComponentId(component.id);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
    setComponentRackOpen(false);
    setNotice(`Editing master: ${component.name}.`);
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
    dispatch({ type: 'rename-component', componentId, name });
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

  const deleteComponent = (component: ComponentDefinition) => {
    dispatch({ type: 'delete-component', componentId: component.id });
    if (editingComponentId === component.id) {
      setEditingComponentId(null);
      componentDispatch({ type: 'replace-project', project: componentInitialState.project });
      setComponentCanvasClosed(true);
      setComponentCanvasMinimized(false);
      setActiveEditorId('main');
    }
    setNotice(`“${component.name}” deleted; any linked instances were detached.`);
  };

  useEffect(() => {
    if (!componentReady || !editingComponentId) return;
    const master = state.project.components.find((component) => component.id === editingComponentId);
    if (!master) return;
    const editedDocument = getActiveDocument(componentState.project);
    if (master.document === editedDocument) return;
    dispatch({
      type: 'update-component',
      component: {
        ...master,
        document: editedDocument,
        updatedAt: new Date().toISOString(),
      },
    });
  }, [componentState.project.pages, editingComponentId, componentReady]);

  const switchPage = (page: FolioPage) => {
    if (isHydrating || page.id === activePageId) return;
    setActiveEditorId('main');
    dispatch({ type: 'set-active-page', pageId: page.id });
    setPagesRackOpen(false);
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
    setPagesRackOpen(false);
    setInspectorVisible(true);
    setNotice(`Created ${name}.`);
  };

  const saveSelectionAsComponent = () => saveNodesAsComponent(expandSelectedLayers(focusedDocument.nodes, focusedEditor.state.selectedNodeIds));

  const commitProjectName = (value: string) => {
    if (isHydrating) return;
    const name = value.trim();
    if (name && name !== state.project.metadata.name) {
      dispatch({ type: 'rename-project', name });
    }
  };

  const selectedComponentNodes = expandSelectedLayers(componentDocument.nodes, componentState.selectedNodeIds);
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
    if (!selectedNode || selectedNode.type === 'component-instance') return;
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
    const selected = getTransformableNodes(expandSelectedLayers(document.nodes, editor.selectedNodeIds).filter((node) => {
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

  const resetWindowLayout = () => {
    const layouts = getDefaultWindowLayouts(getViewport());
    setCanvasPosition(layouts['main-canvas'].position); setCanvasSize(layouts['main-canvas'].size);
    setComponentCanvasPosition(layouts['component-canvas'].position); setComponentCanvasSize(layouts['component-canvas'].size);
    setNodeLogicPosition(layouts['node-logic'].position); setNodeLogicSize(layouts['node-logic'].size);
    setWindowOrder(['node-logic', 'component-canvas', 'pages', 'main-canvas']);
    setActiveWindowId('main-canvas'); setViewMenuOpen(false); setNotice('Window layout has been reset.');
  };

  useEffect(() => {
    const onResize = () => { recoverWindow('main-canvas'); recoverWindow('component-canvas'); recoverWindow('node-logic'); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvasPosition, canvasSize, componentCanvasPosition, componentCanvasSize, nodeLogicPosition, nodeLogicSize]);

  useEffect(() => {
    recoverWindow('main-canvas');
    recoverWindow('component-canvas');
    recoverWindow('node-logic');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isHydrating) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const context = getActiveEditorContext(activeEditorId, state, componentState);
      const emit = activeEditorId === 'main' ? dispatch : componentDispatch;
      const layerStates = getEffectiveLayerStates(context.document.nodes);
      const nodes = getTransformableNodes(expandSelectedLayers(context.document.nodes, context.state.selectedNodeIds).filter((node) => {
        const effective = layerStates.get(node.id);
        return effective?.visible && !effective.locked;
      }));
      const ids = context.state.selectedNodeIds;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') { event.preventDefault(); emit({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if (modifier && key === 'y') { event.preventDefault(); emit({ type: 'redo' }); return; }
      if (modifier && key === 'd' && nodes.length > 0) {
        event.preventDefault();
        const copies = nodes.map((node, index) => ({ ...node, id: globalThis.crypto?.randomUUID?.() ?? 'duplicate-' + Date.now() + '-' + index, name: node.name + ' copy', x: node.x + 24, y: node.y + 24 }));
        emit({ type: 'add-nodes', nodes: copies }); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.length > 0) { event.preventDefault(); emit({ type: 'delete-nodes', nodeIds: ids }); return; }
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
  }, [activeEditorId, state, componentState, isHydrating]);


  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <div
      class={`app-shell ${layersVisible ? "" : "layers-hidden"} ${inspectorVisible ? "" : "inspector-hidden"} ${isHydrating ? "is-hydrating" : ""}`}
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
          <div class="global-menu-items">
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('FILE', 'Project actions and .flop file commands will be organized here.')}>File</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('EDIT', 'Editing, history and selection commands will be organized here.')}>Edit</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <div class="global-menu-entry">
              <button type="button" class="global-menu-item menu-trigger" aria-expanded={viewMenuOpen} onClick={() => setViewMenuOpen((open) => !open)} onMouseEnter={() => updateToolbarHint('VIEW', 'Workspace display, panels, zoom and window layout controls.')}>View</button>
              {viewMenuOpen && <div class="global-menu-dropdown" role="menu"><button type="button" role="menuitem" onClick={resetWindowLayout}>Reset Window Layout</button></div>}
            </div>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('TOOLS', 'Design tools and tool-specific settings will be organized here.')}>Tools</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('OPTION', 'Application and workspace preferences will be organized here.')}>Option</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('HELP', 'Keyboard reference, documentation and support will be organized here.')}>Help</span>
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
            <button class={`global-panel-toggle pages-rack-header-toggle ${pagesRackOpen ? 'active' : ''}`} type="button" title={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'} aria-label={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'} aria-pressed={pagesRackOpen} onClick={() => { focusWindow('pages'); setPagesRackOpen((value) => !value); setComponentRackOpen(false); }} onMouseEnter={() => updateToolbarHint('PAGES RACK', 'Manage the pages in this project.')}><Icon name="pages" /></button>
            <button class={`global-panel-toggle component-rack-header-toggle ${componentRackOpen ? 'active' : ''}`} type="button" title={componentRackOpen ? "Close Component Rack" : "Open Component Rack"} aria-label={componentRackOpen ? "Close Component Rack" : "Open Component Rack"} aria-pressed={componentRackOpen} onClick={() => { setComponentRackOpen((value) => !value); setPagesRackOpen(false); }} onMouseEnter={() => updateToolbarHint('COMPONENT RACK', 'Browse and reuse components saved to your personal library.')}><Icon name="rack" /></button>
            <button class={`global-panel-toggle ${layersVisible ? 'active' : ''}`} type="button" title="Show / hide Layers sidebar" aria-label="Show or hide Layers sidebar" aria-pressed={layersVisible} onClick={() => setLayersVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('LAYERS SIDEBAR', 'Show or hide the document Layers dock.')}><Icon name="sidebar" /></button>
            <button class={`global-panel-toggle canvas-header-toggle ${!canvasClosed && !canvasMinimized ? "active" : ""}`} type="button" title={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-label={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-pressed={!canvasClosed && !canvasMinimized} onClick={() => { if (canvasClosed || canvasMinimized) openMainCanvas(); else { setCanvasClosed(true); setCanvasMinimized(false); } }} onMouseEnter={() => updateToolbarHint('CANVAS WINDOW', canvasClosed || canvasMinimized ? 'Open the Canvas dock.' : 'Close the Canvas workspace.')}><Icon name="canvas" /></button>
            <button class={`global-panel-toggle component-canvas-header-toggle ${componentCanvasOpen ? 'active' : ''}`} type="button" title={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-label={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-pressed={componentCanvasOpen} onClick={() => { if (componentCanvasClosed || componentCanvasMinimized) openComponentCanvas(); else { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); } }} onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', componentCanvasClosed || componentCanvasMinimized ? 'Open the Component Canvas window.' : 'Close the Component Canvas window.')}><Icon name="componentCanvas" /></button>
            <button class={`global-panel-toggle node-logic-header-toggle ${nodeLogicOpen ? 'active' : ''}`} type="button" title={nodeLogicClosed || nodeLogicMinimized ? "Open Node Logic" : "Close Node Logic"} aria-label={nodeLogicClosed || nodeLogicMinimized ? "Open Node Logic" : "Close Node Logic"} aria-pressed={nodeLogicOpen} onClick={() => { if (nodeLogicClosed || nodeLogicMinimized) openNodeLogic(); else { setNodeLogicClosed(true); setNodeLogicMinimized(false); } }} onMouseEnter={() => updateToolbarHint('NODE LOGIC', nodeLogicClosed || nodeLogicMinimized ? 'Open the Node Logic workspace.' : 'Close the Node Logic workspace.')}><Icon name="logicNodes" /></button>
            <button class={`global-panel-toggle inspector-header-toggle ${inspectorVisible ? 'active' : ''}`} type="button" title={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-label={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-pressed={inspectorVisible} onClick={() => setInspectorVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('INSPECTOR', inspectorVisible ? 'Hide the properties Inspector. Selecting an object opens it automatically.' : 'Show the properties Inspector. Selecting an object also opens it automatically.')}><Icon name="inspector" /></button>
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
      <nav class="tool-rail" aria-label="Insert tools" onMouseEnter={() => updateToolbarHint('TOOLS', 'Choose Select, Rectangle, Ellipse or Text from the tool rail.')}>
        <button class="tool-button active" title="Select layer" aria-label="Select layer" onClick={() => dispatchFocused({ type: 'select-node', nodeId: null })}>
          <Icon name="cursor" />
        </button>
        <div class="rail-separator" />
        <button class="tool-button" title="Add rectangle" aria-label="Add rectangle" onClick={() => addNode('rect')}>
          <Icon name="rect" />
        </button>
        <button class="tool-button" title="Add ellipse" aria-label="Add ellipse" onClick={() => addNode('ellipse')}>
          <Icon name="ellipse" />
        </button>
        <button class="tool-button" title="Add text" aria-label="Add text" onClick={() => addNode('text')}>
          <Icon name="text" />
        </button>
        <div class="rail-bottom">
          <button class="tool-button" title="Undo" aria-label="Undo" disabled={focusedEditor.state.past.length === 0} onClick={() => dispatchFocused({ type: 'undo' })}>
            <Icon name="undo" />
          </button>
          <button class="tool-button" title="Redo" aria-label="Redo" disabled={focusedEditor.state.future.length === 0} onClick={() => dispatchFocused({ type: 'redo' })}>
            <Icon name="redo" />
          </button>
        </div>
      </nav>

      <aside class={`layers-panel ${layersVisible ? "" : "is-hidden"}`} onMouseEnter={() => updateToolbarHint('LAYERS', 'Select layers, Ctrl/Cmd-click to toggle multiple, Shift-click for a range, and drag selected layers to reorder or nest.', ['CTRL/CMD + CLICK', 'SHIFT + CLICK', 'DRAG TO REORDER / NEST'])}>
        <div class="panel-heading">
          <h2>Layers</h2>
        </div>
        <div class="layer-list-heading" data-page-id={focusedPage?.id ?? undefined}>
          <span>LAYERS · {focusedDocument.nodes.length}</span>
          <span class="layer-page-context" title={layerContextTitle}>{layerContextLabel}</span>
        </div>
        <div class="layer-list" role="tree" aria-label="Document layers">
          {layerRows.map(({ node, depth, hasChildren }) => {
            const selected = focusedEditor.state.selectedNodeIds.includes(node.id);
            const effective = layerEffectiveStates.get(node.id);
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
                class={'layer-row ' + (selected ? 'selected ' : '') + (!effective?.visible ? 'layer-hidden ' : '') + (effective?.locked ? 'layer-inherited-locked ' : '') + dropClass}
                style={{ paddingLeft: (8 + depth * 15) + 'px' }}
                onClick={(event) => selectLayerFromPanel(node.id, event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectLayerFromPanel(node.id, event);
                  }
                }}
                onDragStart={(event) => startLayerDrag(node.id, event)}
                onDragOver={(event) => updateLayerDropTarget(node.id, event)}
                onDrop={(event) => dropLayer(node.id, event)}
                onDragEnd={() => { layerDragSourceRef.current = null; setLayerDropTarget(null); }}
                onDragLeave={() => setLayerDropTarget((current) => current?.nodeId === node.id ? null : current)}
                title={'Select ' + node.name + '. Drag above or below to reorder, or onto the center to nest it.'}
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
                  <span class="layer-name">{node.name}</span>
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
                  {layerColorPickerKey === `${activeEditorId}:${node.id}` && (
                    <div
                      ref={layerColorPaletteRef}
                      class="layer-color-palette"
                      style={layerColorPickerPosition ? { top: `${layerColorPickerPosition.top}px`, left: `${layerColorPickerPosition.left}px` } : undefined}
                      role="group"
                      aria-label={`Color tags for ${node.name}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>Layer color</span>
                      <div class="layer-color-swatches">
                        {LAYER_COLOR_PRESETS.map((color) => (
                          <button
                            type="button"
                            key={color}
                            class={'layer-color-swatch ' + (node.layerColor === color ? 'active' : '')}
                            style={{ backgroundColor: color }}
                            title={color}
                            aria-label={`Apply ${color} to selected layers`}
                            onClick={() => setLayerColorFromRow(node.id, color)}
                          />
                        ))}
                      </div>
                      <label class="layer-color-custom">
                        <span>Custom</span>
                        <input
                          type="color"
                          value={node.layerColor ?? '#7f8797'}
                          aria-label="Custom layer color"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setLayerColorFromRow(node.id, event.currentTarget.value)}
                        />
                      </label>
                    </div>
                  )}
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
          {focusedDocument.nodes.length === 0 && (
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
        onFocus={() => { focusWindow('main-canvas'); setActiveEditorId('main'); }}
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
            zoom={zoom}
            pan={mainView.pan}
            onPanChange={setMainPan}
            onZoomChange={setZoom}
            onSelectionChange={(nodeIds) => {
              dispatch({ type: 'select-nodes', nodeIds });
              if (nodeIds.length > 0) setInspectorVisible(true);
            }}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SCROLL: PAN Y · SHIFT + SCROLL: PAN X · CTRL/CMD + SCROLL: ZOOM · SPACE + DRAG: PAN</div>
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
        onFocus={() => { focusWindow('component-canvas'); setActiveEditorId('component'); }}
        onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >        <div
          class={`workspace-toolbar${componentCanvasFloating ? " workspace-toolbar-draggable" : ""}`}
        >
          <div class="breadcrumb">
            <Icon name="componentCanvas" />
            <strong>{editingComponent ? editingComponent.name + ' · Master' : 'Component Canvas'}</strong>
          </div>
          <div class="canvas-window-tools">
            <div class="workspace-tools component-canvas-create-tools" aria-label="Create component elements">
              <button type="button" title="Add rectangle" aria-label="Add rectangle" onClick={() => componentDispatch({ type: 'add-node', node: createNode('rect', getActiveDocument(componentState.project).nodes.length) })}><Icon name="rect" /></button>
              <button type="button" title="Add ellipse" aria-label="Add ellipse" onClick={() => componentDispatch({ type: 'add-node', node: createNode('ellipse', getActiveDocument(componentState.project).nodes.length) })}><Icon name="ellipse" /></button>
              <button type="button" title="Add text" aria-label="Add text" onClick={() => componentDispatch({ type: 'add-node', node: createNode('text', getActiveDocument(componentState.project).nodes.length) })}><Icon name="text" /></button>
              <span class="workspace-divider" />
              <button type="button" title="Save selected as reusable component" aria-label="Save selected as reusable component" disabled={selectedComponentNodes.length === 0} onClick={() => saveNodesAsComponent(selectedComponentNodes)}><Icon name="save" /></button>
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
              <button type="button" class="window-control window-control-minimize" title="Minimize Component Canvas" aria-label="Minimize Component Canvas" onClick={() => setComponentCanvasMinimized(true)}></button>
              <button type="button" class="window-control" title={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-label={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-pressed={componentCanvasFloating} onClick={() => setComponentCanvasWindowMode(componentCanvasFloating ? 'docked' : 'floating')}>{componentCanvasFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Component Canvas window" aria-label="Close Component Canvas window" onClick={() => { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); setComponentCanvasWindowMode('docked'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={componentDocument}
            components={state.project.components}
            selectedNodeIds={componentState.selectedNodeIds}
            zoom={componentCanvasZoom}
            pan={componentView.pan}
            onPanChange={setComponentCanvasPan}
            onZoomChange={setComponentCanvasZoom}
            onSelectionChange={(nodeIds) => componentDispatch({ type: 'select-nodes', nodeIds })}
            onTransformCommit={(nodes) => componentDispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SCROLL: PAN Y · SHIFT + SCROLL: PAN X · CTRL/CMD + SCROLL: ZOOM · SPACE + DRAG: PAN</div>
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
        <div class="panel-heading inspector-heading">
          <div>
            <span class="panel-kicker">PROPERTIES</span>
            <h2>Inspector</h2><span class="panel-context-indicator">{activeEditorId === 'component' ? 'COMPONENT CANVAS' : 'MAIN PAGE'}</span>
          </div>
          {selectedNode && <button class="icon-button danger" title="Delete selected layer" onClick={() => dispatchFocused({ type: 'delete-node', nodeId: selectedNode.id })}><Icon name="trash" /></button>}
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


      <section class={`pages-rack-panel ${pagesRackOpen ? 'is-open' : ''}`} style={{ zIndex: getWindowZIndex(windowOrder, 'pages') }} onPointerDown={() => focusWindow('pages')} aria-label="Pages Rack" aria-hidden={!pagesRackOpen}>
        <div class="pages-rack-heading">
          <div class="pages-rack-title"><span class="panel-kicker">PROJECT STRUCTURE</span><strong>Pages</strong><span class="pages-rack-count">{pages.length}</span></div>
          <div class="pages-rack-actions">
            <input class="pages-rack-name-input" type="text" placeholder="New page name..." value={pageNameDraft} onInput={(event) => setPageNameDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') addPage(); }} aria-label="New page name" />
            <button type="button" class="pages-rack-add" onClick={addPage} disabled={!pageNameDraft.trim()}>＋ Add page</button>
            <button type="button" class="component-rack-close" title="Close Pages Rack" aria-label="Close Pages Rack" onClick={() => setPagesRackOpen(false)}>×</button>
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

      <section class={`component-rack-panel ${componentRackOpen ? 'is-open' : ''}`} aria-label="Component Rack" aria-hidden={!componentRackOpen}>
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
            <button type="button" class="component-rack-close" title="Close Component Rack" aria-label="Close Component Rack" onClick={() => setComponentRackOpen(false)}>×</button>
          </div>
        </div>
        <div class="component-rack-list">
          {ownedComponents.filter((component) => component.name.toLowerCase().includes(componentRackSearch.toLowerCase())).map((component) => (
            <article class="component-rack-card" key={component.id}>
              <button type="button" class="component-rack-preview" title={`Insert linked ${component.name} into Main Canvas`} onClick={() => insertOwnedComponent(component)}>
                <span class="component-rack-preview-shapes">{component.document.nodes.slice(0, 5).map((node) => <span class={`component-preview-shape shape-${node.type}`} style={node.type === 'text' ? { color: node.style.fill } : node.type === 'component-instance' ? {} : { background: node.style.fill }} />)}</span>
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

      <footer class="statusbar">
        <div><span class="status-brand">F</span><span>Folio Studio <b>0.1.0</b></span></div>
        <div class="status-center">{activeDocument.nodes.length} LAYERS <span>·</span> {activeDocument.width} × {activeDocument.height} PX</div>
        <div class={`status-right save-${saveStatus}`} role="status" aria-live="polite"><span class="status-ready-dot" /> {isHydrating ? 'RESTORING PROJECT…' : statusLabel}</div>
      </footer>

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

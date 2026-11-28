import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EditorTarget } from '../editorContext';
import {
  bringWindowToFront,
  getDefaultWindowLayouts,
  recoverWindowLayout,
  type WindowId,
} from '../windowManager';
import {
  loadWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspaceKind,
  type WorkspaceLayoutV1,
  type WorkspacePreferencesLoadResult,
} from '../workspacePreferences';
import {
  DEFAULT_CANVAS_ZOOM,
  computeCenteredComponentView,
  readCanvasViewState,
  type CanvasViewState,
} from './canvasViewState';

export interface UseWorkspaceWindowsOptions {
  setActiveEditorId: (target: EditorTarget) => void;
  setNotice: (message: string) => void;
}

export function useWorkspaceWindows({
  setActiveEditorId,
  setNotice,
}: UseWorkspaceWindowsOptions) {
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

  const [layersVisible, setLayersVisible] = useState(
    () => initialWorkspaceLayout.panelVisibility.layers,
  );
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [componentRackOpen, setComponentRackOpen] = useState(
    () => initialWorkspaceLayout.panelVisibility['component-rack'],
  );
  const [pagesRackOpen, setPagesRackOpen] = useState(
    () => initialWorkspaceLayout.panelVisibility['pages-rack'],
  );

  const [windowOrder, setWindowOrder] = useState<WindowId[]>(() => [
    ...initialWorkspaceOrder,
    ...(initialWorkspaceLayout.panelVisibility['pages-rack'] ? ['pages' as const] : []),
  ]);
  const [activeWindowId, setActiveWindowId] = useState<WindowId>(
    () => initialWorkspaceLayout.activeWorkspace,
  );

  const [mainView, setMainView] = useState<CanvasViewState>(() => readCanvasViewState('folio.main-canvas-view'));
  const [componentView, setComponentView] = useState<CanvasViewState>(() => readCanvasViewState('folio.component-canvas-view'));

  const setZoom = useCallback((next: number | ((current: number) => number)) => {
    setMainView((view) => ({
      ...view,
      zoom: typeof next === 'function' ? next(view.zoom) : next,
    }));
  }, []);
  const setComponentCanvasZoom = useCallback((next: number | ((current: number) => number)) => {
    setComponentView((view) => ({
      ...view,
      zoom: typeof next === 'function' ? next(view.zoom) : next,
    }));
  }, []);
  const setMainPan = useCallback((pan: { x: number; y: number }) => {
    setMainView((view) => ({ ...view, pan }));
  }, []);
  const setComponentCanvasPan = useCallback((pan: { x: number; y: number }) => {
    setComponentView((view) => ({ ...view, pan }));
  }, []);
  const resetMainView = useCallback(() => {
    setMainView({ zoom: DEFAULT_CANVAS_ZOOM, pan: { x: 0, y: 0 } });
  }, []);
  const centerComponentCanvasView = useCallback((docWidth: number, docHeight: number) => {
    const applyCenteredView = () => {
      let vpW = 900;
      let vpH = 560;
      if (typeof document !== 'undefined') {
        const compStage = document.querySelector<HTMLElement>('.component-canvas-window .canvas-scroll-area');
        const fallbackStage = document.querySelector<HTMLElement>('.workspace-center');
        const rect = compStage?.getBoundingClientRect() ?? fallbackStage?.getBoundingClientRect();
        if (rect && rect.width > 160 && rect.height > 140) {
          vpW = rect.width;
          vpH = rect.height;
        } else if (typeof window !== 'undefined') {
          vpW = Math.max(480, window.innerWidth - 520);
          vpH = Math.max(320, window.innerHeight - 160);
        }
      }
      setComponentView(computeCenteredComponentView(docWidth, docHeight, vpW, vpH));
    };
    applyCenteredView();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => applyCenteredView());
    }
  }, []);

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
  const [canvasPosition, setCanvasPosition] = useState(() => ({
    x: initialMainWindow.geometry.x,
    y: initialMainWindow.geometry.y,
  }));

  const [componentCanvasClosed, setComponentCanvasClosed] = useState(
    () => initialComponentWindow.visibility === 'closed',
  );
  const [componentCanvasMinimized, setComponentCanvasMinimized] = useState(
    () => initialComponentWindow.visibility === 'minimized',
  );
  const [componentCanvasWindowMode, setComponentCanvasWindowMode] =
    useState<'docked' | 'floating'>(() => initialComponentWindow.presentation);
  const [componentCanvasLocked, setComponentCanvasLocked] = useState(
    () => Boolean(initialComponentWindow.locked),
  );
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

  // Debounced Canvas view persistence
  const latestMainViewRef = useRef(mainView);
  latestMainViewRef.current = mainView;
  const mainViewDirtyRef = useRef(false);
  const mainViewTimerRef = useRef<number | null>(null);
  const flushMainView = useCallback(() => {
    if (mainViewTimerRef.current !== null) {
      window.clearTimeout(mainViewTimerRef.current);
      mainViewTimerRef.current = null;
    }
    if (!mainViewDirtyRef.current) return;
    mainViewDirtyRef.current = false;
    try {
      window.localStorage.setItem('folio.main-canvas-view', JSON.stringify(latestMainViewRef.current));
    } catch (error) {
      console.warn('Folio could not persist Main Canvas view:', error);
    }
  }, []);
  useEffect(() => {
    mainViewDirtyRef.current = true;
    if (mainViewTimerRef.current !== null) window.clearTimeout(mainViewTimerRef.current);
    mainViewTimerRef.current = window.setTimeout(flushMainView, 160);
  }, [mainView, flushMainView]);

  const latestComponentViewRef = useRef(componentView);
  latestComponentViewRef.current = componentView;
  const componentViewDirtyRef = useRef(false);
  const componentViewTimerRef = useRef<number | null>(null);
  const flushComponentView = useCallback(() => {
    if (componentViewTimerRef.current !== null) {
      window.clearTimeout(componentViewTimerRef.current);
      componentViewTimerRef.current = null;
    }
    if (!componentViewDirtyRef.current) return;
    componentViewDirtyRef.current = false;
    try {
      window.localStorage.setItem('folio.component-canvas-view', JSON.stringify(latestComponentViewRef.current));
    } catch (error) {
      console.warn('Folio could not persist Component Canvas view:', error);
    }
  }, []);
  useEffect(() => {
    componentViewDirtyRef.current = true;
    if (componentViewTimerRef.current !== null) window.clearTimeout(componentViewTimerRef.current);
    componentViewTimerRef.current = window.setTimeout(flushComponentView, 160);
  }, [componentView, flushComponentView]);

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
        ...(componentCanvasLocked ? { locked: true } : { locked: undefined }),
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
    componentCanvasLocked,
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

  const workspacePreferencesPersistedOnceRef = useRef(false);
  const workspacePreferencesEnabledRef = useRef(workspacePreferencesPersistenceEnabled);
  workspacePreferencesEnabledRef.current = workspacePreferencesPersistenceEnabled;
  const latestWorkspaceSnapshotRef = useRef(workspacePreferencesSnapshot);
  latestWorkspaceSnapshotRef.current = workspacePreferencesSnapshot;
  const workspacePreferencesDirtyRef = useRef(false);
  const workspacePreferencesTimerRef = useRef<number | null>(null);

  const flushWorkspacePreferences = useCallback((_fromPageHide = false) => {
    if (workspacePreferencesTimerRef.current !== null) {
      window.clearTimeout(workspacePreferencesTimerRef.current);
      workspacePreferencesTimerRef.current = null;
    }
    if (!workspacePreferencesDirtyRef.current || !workspacePreferencesEnabledRef.current) return;
    workspacePreferencesDirtyRef.current = false;
    if (workspacePreferencesPersistedOnceRef.current && !workspacePreferencesReplaceMalformedRef.current) {
      try {
        if (window.localStorage.getItem('folio.workspace-layout.v1') === null) {
          return;
        }
      } catch {
        // Proceed to normal persistence error handling if storage access fails.
      }
    }
    const saved = saveWorkspacePreferences(latestWorkspaceSnapshotRef.current, {
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
    workspacePreferencesPersistedOnceRef.current = true;
  }, [setNotice]);

  useEffect(() => {
    if (!workspacePreferencesPersistenceEnabled) return;
    workspacePreferencesDirtyRef.current = true;
    if (!workspacePreferencesPersistedOnceRef.current || workspacePreferencesReplaceMalformedRef.current) {
      flushWorkspacePreferences(false);
      return;
    }
    if (workspacePreferencesTimerRef.current !== null) {
      window.clearTimeout(workspacePreferencesTimerRef.current);
    }
    workspacePreferencesTimerRef.current = window.setTimeout(() => flushWorkspacePreferences(false), 120);
  }, [workspacePreferencesSnapshot, workspacePreferencesPersistenceEnabled, flushWorkspacePreferences]);

  useEffect(() => {
    const flushAllPendingStorage = (fromPageHide: boolean) => {
      flushMainView();
      flushComponentView();
      flushWorkspacePreferences(fromPageHide);
    };
    const onPageHide = () => flushAllPendingStorage(true);
    const controller = new AbortController();
    window.addEventListener('pagehide', onPageHide, { signal: controller.signal });
    return () => {
      controller.abort();
      flushAllPendingStorage(false);
    };
  }, [flushMainView, flushComponentView, flushWorkspacePreferences]);

  const focusWindow = useCallback((id: WindowId) => {
    setWindowOrder((current) => bringWindowToFront(current, id));
    setActiveWindowId(id);
  }, []);

  const getViewport = useCallback(() => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  }), []);

  const recoverWindow = useCallback((id: 'main-canvas' | 'component-canvas' | 'node-logic') => {
    const viewport = getViewport();
    if (id === 'main-canvas') {
      const layout = recoverWindowLayout({ position: canvasPosition, size: canvasSize }, viewport);
      setCanvasPosition(layout.position);
      setCanvasSize(layout.size);
    } else if (id === 'component-canvas') {
      const layout = recoverWindowLayout({ position: componentCanvasPosition, size: componentCanvasSize }, viewport);
      setComponentCanvasPosition(layout.position);
      setComponentCanvasSize(layout.size);
    } else {
      const layout = recoverWindowLayout({ position: nodeLogicPosition, size: nodeLogicSize }, viewport);
      setNodeLogicPosition(layout.position);
      setNodeLogicSize(layout.size);
    }
  }, [
    getViewport,
    canvasPosition,
    canvasSize,
    componentCanvasPosition,
    componentCanvasSize,
    nodeLogicPosition,
    nodeLogicSize,
  ]);

  const openMainCanvas = useCallback(() => {
    recoverWindow('main-canvas');
    setCanvasClosed(false);
    setCanvasMinimized(false);
    setActiveEditorId('main');
    focusWindow('main-canvas');
  }, [recoverWindow, setActiveEditorId, focusWindow]);

  const openComponentCanvas = useCallback(() => {
    recoverWindow('component-canvas');
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
  }, [recoverWindow, setActiveEditorId, focusWindow]);

  const openNodeLogic = useCallback((options?: { preserveEditor?: boolean }) => {
    recoverWindow('node-logic');
    setNodeLogicClosed(false);
    setNodeLogicMinimized(false);
    if (!options?.preserveEditor) {
      setActiveEditorId('main');
    }
    focusWindow('node-logic');
  }, [recoverWindow, setActiveEditorId, focusWindow]);

  const approveWorkspacePreferencesReview = useCallback(() => {
    setWorkspacePreferencesReviewRequired(false);
    setWorkspacePreferencesPersistenceEnabled(true);
    setNotice(
      initialWorkspacePreferences.status === 'migrated'
        ? 'Workspace Preferences V1 migration enabled.'
        : 'Recovered workspace layout accepted and saving enabled.',
    );
  }, [initialWorkspacePreferences.status, setNotice]);

  const resetAllWindowLayouts = useCallback(() => {
    const layouts = getDefaultWindowLayouts(getViewport());
    setCanvasPosition(layouts['main-canvas'].position);
    setCanvasSize(layouts['main-canvas'].size);
    setComponentCanvasPosition(layouts['component-canvas'].position);
    setComponentCanvasSize(layouts['component-canvas'].size);
    setComponentCanvasLocked(false);
    setNodeLogicPosition(layouts['node-logic'].position);
    setNodeLogicSize(layouts['node-logic'].size);
    setWindowOrder(['node-logic', 'component-canvas', 'pages', 'main-canvas']);
    setActiveWindowId('main-canvas');
  }, [getViewport]);

  return {
    initialWorkspacePreferences,
    workspacePreferencesReviewRequired,
    approveWorkspacePreferencesReview,
    layersVisible,
    setLayersVisible,
    inspectorVisible,
    setInspectorVisible,
    componentRackOpen,
    setComponentRackOpen,
    pagesRackOpen,
    setPagesRackOpen,
    windowOrder,
    activeWindowId,
    focusWindow,
    recoverWindow,
    openMainCanvas,
    openComponentCanvas,
    openNodeLogic,
    resetAllWindowLayouts,
    mainView,
    zoom: mainView.zoom,
    setZoom,
    setMainPan,
    resetMainView,
    componentView,
    componentCanvasZoom: componentView.zoom,
    setComponentCanvasZoom,
    setComponentCanvasPan,
    centerComponentCanvasView,
    canvasMinimized,
    setCanvasMinimized,
    canvasClosed,
    setCanvasClosed,
    canvasWindowMode,
    setCanvasWindowMode,
    canvasFloating,
    canvasSize,
    setCanvasSize,
    canvasPosition,
    setCanvasPosition,
    componentCanvasClosed,
    setComponentCanvasClosed,
    componentCanvasMinimized,
    setComponentCanvasMinimized,
    componentCanvasWindowMode,
    setComponentCanvasWindowMode,
    componentCanvasLocked,
    setComponentCanvasLocked,
    componentCanvasFloating,
    componentCanvasOpen,
    componentCanvasSize,
    setComponentCanvasSize,
    componentCanvasPosition,
    setComponentCanvasPosition,
    nodeLogicClosed,
    setNodeLogicClosed,
    nodeLogicMinimized,
    setNodeLogicMinimized,
    nodeLogicWindowMode,
    setNodeLogicWindowMode,
    nodeLogicFloating,
    nodeLogicOpen,
    nodeLogicSize,
    setNodeLogicSize,
    nodeLogicPosition,
    setNodeLogicPosition,
  };
}

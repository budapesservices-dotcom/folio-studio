import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import {
  DEFAULT_RESIZE_THROTTLE_MS,
  PANEL_RESIZE_CONSTRAINTS,
  attachPanelResizeListeners,
  clampPanelWidth,
  computeResizedPanelWidth,
  createThrottledMouseMove,
  getDefaultPanelWidths,
  getPanelWidthBounds,
  loadPanelWidths,
  savePanelWidths,
  type ActivePanelResizeSession,
  type PanelWidths,
  type ResizablePanelId,
  type ThrottledMouseMoveController,
} from '../panelResize';

export interface UsePanelResizeControllerOptions {
  appShellRef: RefObject<HTMLDivElement>;
  layersVisible: boolean;
  inspectorVisible: boolean;
}

export function usePanelResizeController({
  appShellRef,
  layersVisible,
  inspectorVisible,
}: UsePanelResizeControllerOptions) {
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(() => loadPanelWidths());
  const [resizingPanel, setResizingPanel] = useState<ResizablePanelId | null>(null);
  const panelWidthsRef = useRef<PanelWidths>(panelWidths);
  const resizingPanelRef = useRef<ResizablePanelId | null>(null);
  const panelVisibilityRef = useRef({ layersVisible, inspectorVisible });
  panelVisibilityRef.current = { layersVisible, inspectorVisible };
  const activePanelResizeSessionRef = useRef<ActivePanelResizeSession | null>(null);
  const panelResizeSessionSeqRef = useRef(0);
  const throttledPanelMoveRef = useRef<ThrottledMouseMoveController<{ sessionId: number; clientX: number }> | null>(null);
  const layersResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const inspectorResizeHandleRef = useRef<HTMLDivElement | null>(null);
  const panelResizeCleanupRef = useRef<(() => void) | null>(null);

  if (resizingPanelRef.current === null) {
    panelWidthsRef.current = panelWidths;
  }

  const getPanelClampContext = useCallback((panel: ResizablePanelId, widths: PanelWidths = panelWidthsRef.current) => ({
    viewportWidth: appShellRef.current?.clientWidth || window.innerWidth,
    layersVisible: panelVisibilityRef.current.layersVisible,
    inspectorVisible: panelVisibilityRef.current.inspectorVisible,
    otherPanelWidth: panel === 'layers' ? widths.inspector : widths.layers,
  }), [appShellRef]);

  const applyPanelWidth = useCallback(
    (panel: ResizablePanelId, nextWidth: number, options: { persist?: boolean; syncState?: boolean } = {}) => {
      const { persist = false, syncState = true } = options;
      const cssVar = panel === 'layers' ? '--layers-panel-width' : '--inspector-panel-width';
      appShellRef.current?.style.setProperty(cssVar, `${nextWidth}px`);
      const handleEl = panel === 'layers' ? layersResizeHandleRef.current : inspectorResizeHandleRef.current;
      handleEl?.setAttribute('aria-valuenow', String(nextWidth));
      const nextWidths: PanelWidths = { ...panelWidthsRef.current, [panel]: nextWidth };
      panelWidthsRef.current = nextWidths;
      if (syncState) {
        setPanelWidths((current) => (current[panel] === nextWidth ? current : { ...current, [panel]: nextWidth }));
      }
      if (persist) savePanelWidths(nextWidths);
    },
    [appShellRef],
  );

  const handleThrottledPanelMove = useCallback(
    ({ sessionId, clientX }: { sessionId: number; clientX: number }) => {
      const session = activePanelResizeSessionRef.current;
      if (!session || session.sessionId !== sessionId) return;
      const nextWidth = computeResizedPanelWidth(
        session.panel,
        session.startWidth,
        session.startClientX,
        clientX,
        getPanelClampContext(session.panel, panelWidthsRef.current),
      );
      applyPanelWidth(session.panel, nextWidth, { persist: false, syncState: false });
    },
    [applyPanelWidth, getPanelClampContext],
  );

  const getThrottledPanelMove = useCallback(() => {
    if (!throttledPanelMoveRef.current) {
      throttledPanelMoveRef.current = createThrottledMouseMove<{ sessionId: number; clientX: number }>(
        handleThrottledPanelMove,
        { intervalMs: DEFAULT_RESIZE_THROTTLE_MS },
      );
    }
    return throttledPanelMoveRef.current;
  }, [handleThrottledPanelMove]);

  const startPanelResize = useCallback((panel: ResizablePanelId, event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    panelResizeCleanupRef.current?.();
    if (event.detail >= 2) return;

    const throttledMove = getThrottledPanelMove();
    throttledMove.reset();

    const initialWidths: PanelWidths = { ...panelWidthsRef.current };
    const session: ActivePanelResizeSession = {
      sessionId: ++panelResizeSessionSeqRef.current,
      panel,
      startClientX: event.clientX,
      startWidth: initialWidths[panel],
      initialWidths,
    };

    const abortController = new AbortController();
    const handleElement =
      (event.currentTarget instanceof Element ? event.currentTarget : null) ??
      (panel === 'layers' ? layersResizeHandleRef.current : inspectorResizeHandleRef.current);

    activePanelResizeSessionRef.current = session;
    resizingPanelRef.current = panel;
    appShellRef.current?.classList.add('is-resizing-panel');
    setResizingPanel(panel);

    const isCurrentSession = () => activePanelResizeSessionRef.current?.sessionId === session.sessionId;

    const endResize = (mode: 'commit' | 'cancel' | 'abort') => {
      if (!isCurrentSession()) {
        abortController.abort();
        return;
      }
      try {
        if (mode === 'commit') {
          throttledMove.flush();
        }
        throttledMove.cancel();
      } finally {
        abortController.abort();
        appShellRef.current?.classList.remove('is-resizing-panel');
        if (isCurrentSession()) {
          activePanelResizeSessionRef.current = null;
        }
        if (resizingPanelRef.current === panel) {
          resizingPanelRef.current = null;
        }
        if (panelResizeCleanupRef.current === abortResize) {
          panelResizeCleanupRef.current = null;
        }
      }

      if (mode === 'commit') {
        const committed: PanelWidths = { ...panelWidthsRef.current };
        setPanelWidths(committed);
        savePanelWidths(committed);
      } else if (mode === 'cancel') {
        applyPanelWidth(panel, session.initialWidths[panel], { persist: false, syncState: true });
      }
      setResizingPanel(null);
    };

    const abortResize = () => endResize('abort');
    panelResizeCleanupRef.current = abortResize;

    try {
      attachPanelResizeListeners(
        {
          onMouseMove: (moveEvent) => {
            if (!isCurrentSession()) return;
            throttledMove({ sessionId: session.sessionId, clientX: moveEvent.clientX });
          },
          onFinish: () => endResize('commit'),
          onCancel: () => endResize('cancel'),
          onAbort: abortResize,
        },
        {
          controller: abortController,
          handleElement,
          observeContainer: appShellRef.current,
        },
      );
    } catch (error) {
      abortResize();
      throw error;
    }
  }, [appShellRef, applyPanelWidth, getThrottledPanelMove]);

  const resetPanelWidth = useCallback((panel: ResizablePanelId) => {
    panelResizeCleanupRef.current?.();
    const nextWidth = clampPanelWidth(
      panel,
      PANEL_RESIZE_CONSTRAINTS[panel].defaultWidth,
      getPanelClampContext(panel),
    );
    applyPanelWidth(panel, nextWidth, { persist: true, syncState: true });
  }, [applyPanelWidth, getPanelClampContext]);

  const handlePanelResizeDoubleClick = useCallback((panel: ResizablePanelId, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resetPanelWidth(panel);
  }, [resetPanelWidth]);

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
    applyPanelWidth(panel, clampPanelWidth(panel, target, context), { persist: true, syncState: true });
  }, [applyPanelWidth, getPanelClampContext]);

  const clampCurrentPanelWidths = useCallback(() => {
    const current = panelWidthsRef.current;
    const clampedLayers = clampPanelWidth('layers', current.layers, getPanelClampContext('layers', current));
    const clampedInspector = clampPanelWidth(
      'inspector',
      current.inspector,
      getPanelClampContext('inspector', { ...current, layers: clampedLayers }),
    );
    if (clampedLayers !== current.layers || clampedInspector !== current.inspector) {
      const nextWidths = { layers: clampedLayers, inspector: clampedInspector };
      panelWidthsRef.current = nextWidths;
      setPanelWidths(nextWidths);
    }
  }, [getPanelClampContext]);

  const resetAllPanelWidths = useCallback(() => {
    const defaultWidths = getDefaultPanelWidths();
    setPanelWidths(defaultWidths);
    panelWidthsRef.current = defaultWidths;
    savePanelWidths(defaultWidths);
  }, []);

  useEffect(() => {
    if (
      (resizingPanelRef.current === 'layers' && !layersVisible) ||
      (resizingPanelRef.current === 'inspector' && !inspectorVisible)
    ) {
      panelResizeCleanupRef.current?.();
    }
  }, [layersVisible, inspectorVisible]);

  useEffect(() => () => {
    panelResizeCleanupRef.current?.();
    throttledPanelMoveRef.current?.cancel();
  }, []);

  return {
    panelWidths,
    panelWidthsRef,
    resizingPanel,
    resizingPanelRef,
    layersResizeHandleRef,
    inspectorResizeHandleRef,
    startPanelResize,
    handlePanelResizeDoubleClick,
    handlePanelResizeKeyDown,
    clampCurrentPanelWidths,
    resetAllPanelWidths,
  };
}

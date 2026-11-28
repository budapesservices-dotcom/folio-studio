export type ResizablePanelId = 'layers' | 'inspector';

export interface PanelWidthConstraints {
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

export interface PanelWidths {
  layers: number;
  inspector: number;
}

export interface PanelClampContext {
  viewportWidth: number;
  layersVisible: boolean;
  inspectorVisible: boolean;
  otherPanelWidth: number;
  toolRailWidth?: number;
  minWorkspaceWidth?: number;
}

export interface PanelResizeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PANEL_WIDTHS_STORAGE_KEY = 'folio.panel-widths.v1';

export const PANEL_RESIZE_CONSTRAINTS: Record<ResizablePanelId, PanelWidthConstraints> = {
  layers: {
    defaultWidth: 240,
    minWidth: 180,
    maxWidth: 480,
  },
  inspector: {
    defaultWidth: 292,
    minWidth: 220,
    maxWidth: 520,
  },
};

export const DEFAULT_TOOL_RAIL_WIDTH = 58;
export const MIN_WORKSPACE_COLUMN_WIDTH = 320;
export const DEFAULT_RESIZE_THROTTLE_MS = 16;

export function getDefaultPanelWidths(): PanelWidths {
  return {
    layers: PANEL_RESIZE_CONSTRAINTS.layers.defaultWidth,
    inspector: PANEL_RESIZE_CONSTRAINTS.inspector.defaultWidth,
  };
}

/**
 * Computes the effective allowed [minWidth, maxWidth] for a sidebar panel
 * while guaranteeing the central canvas retains at least `minWorkspaceWidth`.
 */
export function getPanelWidthBounds(
  panel: ResizablePanelId,
  context: PanelClampContext,
): { minWidth: number; maxWidth: number } {
  const { minWidth, maxWidth } = PANEL_RESIZE_CONSTRAINTS[panel];
  const toolRailWidth = context.toolRailWidth ?? DEFAULT_TOOL_RAIL_WIDTH;
  const minWorkspaceWidth = context.minWorkspaceWidth ?? MIN_WORKSPACE_COLUMN_WIDTH;
  const otherVisible = panel === 'layers' ? context.inspectorVisible : context.layersVisible;
  const reservedOtherWidth = otherVisible ? Math.max(0, context.otherPanelWidth) : 0;

  if (!Number.isFinite(context.viewportWidth) || context.viewportWidth <= 0) {
    return { minWidth, maxWidth };
  }

  const availableForPanel = Math.floor(
    context.viewportWidth - toolRailWidth - minWorkspaceWidth - reservedOtherWidth,
  );
  const effectiveMax = Math.max(minWidth, Math.min(maxWidth, availableForPanel));
  return { minWidth, maxWidth: effectiveMax };
}

export function clampPanelWidth(
  panel: ResizablePanelId,
  rawWidth: number,
  context: PanelClampContext,
): number {
  const { minWidth, maxWidth } = getPanelWidthBounds(panel, context);
  if (!Number.isFinite(rawWidth)) {
    return Math.min(maxWidth, Math.max(minWidth, PANEL_RESIZE_CONSTRAINTS[panel].defaultWidth));
  }
  return Math.round(Math.min(maxWidth, Math.max(minWidth, rawWidth)));
}

/**
 * Computes the next width of a panel during a horizontal drag.
 * - `layers` handle sits on the right edge: dragging right increases width.
 * - `inspector` handle sits on the left edge: dragging left increases width.
 */
export function computeResizedPanelWidth(
  panel: ResizablePanelId,
  startWidth: number,
  startClientX: number,
  currentClientX: number,
  context: PanelClampContext,
): number {
  const deltaX = currentClientX - startClientX;
  const candidate = panel === 'layers' ? startWidth + deltaX : startWidth - deltaX;
  return clampPanelWidth(panel, candidate, context);
}

export interface ActivePanelResizeSession {
  readonly sessionId: number;
  readonly panel: ResizablePanelId;
  readonly startClientX: number;
  readonly startWidth: number;
  readonly initialWidths: PanelWidths;
}

export interface ThrottledMouseMoveOptions {
  intervalMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelScheduled?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface ThrottledMouseMoveController<T> {
  (payload: T): void;
  flush: () => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Leading + trailing throttle tailored for high-frequency `mousemove` streams.
 * Executes immediately on the leading edge, coalesces intermediate moves inside
 * each `intervalMs` window (~16ms / 60fps), and flushes the latest position on
 * the trailing edge so the panel always lands on the exact pointer coordinate.
 */
export function createThrottledMouseMove<T>(
  callback: (payload: T) => void,
  options: ThrottledMouseMoveOptions = {},
): ThrottledMouseMoveController<T> {
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_RESIZE_THROTTLE_MS);
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const schedule = options.schedule ?? ((fn, delay) => setTimeout(fn, delay));
  const cancelScheduled = options.cancelScheduled ?? ((id) => clearTimeout(id));

  let lastInvokeTime = Number.NEGATIVE_INFINITY;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pendingPayload: T | undefined;

  const invoke = (payload: T, timestamp: number) => {
    lastInvokeTime = timestamp;
    hasPending = false;
    pendingPayload = undefined;
    callback(payload);
  };

  const clearTimer = () => {
    if (timerId !== null) {
      cancelScheduled(timerId);
      timerId = null;
    }
  };

  const throttled = ((payload: T) => {
    const currentTime = now();
    const elapsed = currentTime - lastInvokeTime;

    if (elapsed >= intervalMs) {
      clearTimer();
      invoke(payload, currentTime);
      return;
    }

    pendingPayload = payload;
    hasPending = true;

    if (timerId === null) {
      const remaining = Math.max(0, intervalMs - elapsed);
      timerId = schedule(() => {
        timerId = null;
        if (hasPending) {
          invoke(pendingPayload as T, now());
        }
      }, remaining);
    }
  }) as ThrottledMouseMoveController<T>;

  throttled.flush = () => {
    clearTimer();
    if (hasPending) {
      invoke(pendingPayload as T, now());
    }
  };

  throttled.cancel = () => {
    clearTimer();
    hasPending = false;
    pendingPayload = undefined;
  };

  throttled.reset = () => {
    clearTimer();
    hasPending = false;
    pendingPayload = undefined;
    lastInvokeTime = Number.NEGATIVE_INFINITY;
  };

  return throttled;
}

export interface PanelResizeEventTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener?(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface PanelResizeDocumentTarget extends PanelResizeEventTarget {
  readonly visibilityState?: DocumentVisibilityState;
  readonly body?: Node | null;
}

export interface PanelResizeHandleTarget {
  readonly isConnected: boolean;
}

export interface PanelResizeListenerHandlers {
  onMouseMove: (event: MouseEvent) => void;
  onFinish: () => void;
  onCancel: () => void;
  onAbort?: () => void;
}

export interface AttachPanelResizeListenersOptions {
  controller?: AbortController;
  signal?: AbortSignal;
  windowTarget?: PanelResizeEventTarget | null;
  documentTarget?: PanelResizeDocumentTarget | null;
  handleElement?: PanelResizeHandleTarget | null;
  observeContainer?: Node | null;
}

/**
 * Registers all global listeners for a panel resize drag session using an
 * `AbortController` so `mousemove`, `mouseup`, and interruption handlers are
 * reliably detached on session end, interruption, or DOM element removal.
 */
export function attachPanelResizeListeners(
  handlers: PanelResizeListenerHandlers,
  options: AttachPanelResizeListenersOptions = {},
): () => void {
  const windowTarget: PanelResizeEventTarget | null =
    options.windowTarget !== undefined
      ? options.windowTarget
      : (typeof window !== 'undefined' ? window : null);
  const documentTarget: PanelResizeDocumentTarget | null =
    options.documentTarget !== undefined
      ? options.documentTarget
      : (typeof document !== 'undefined' ? document : null);
  const handleElement = options.handleElement ?? null;

  if (!windowTarget) {
    return () => {};
  }

  const controller = options.controller ?? new AbortController();
  const { signal } = controller;
  const externalSignal = options.signal;

  if (signal.aborted || externalSignal?.aborted) {
    controller.abort();
    return () => {};
  }

  let observer: MutationObserver | null = null;
  const disconnectObserver = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const abortSession = () => {
    disconnectObserver();
    if (!signal.aborted) {
      controller.abort();
    }
  };

  const triggerDisconnectedAbort = () => {
    disconnectObserver();
    if (handlers.onAbort) {
      handlers.onAbort();
    } else {
      handlers.onFinish();
    }
    abortSession();
  };

  if (handleElement && !handleElement.isConnected) {
    triggerDisconnectedAbort();
    return abortSession;
  }

  if (externalSignal && externalSignal !== signal) {
    const forwardAbort = () => abortSession();
    externalSignal.addEventListener('abort', forwardAbort, { once: true });
    signal.addEventListener(
      'abort',
      () => externalSignal.removeEventListener('abort', forwardAbort),
      { once: true },
    );
  }

  const handleMouseMove: EventListener = (event) => {
    if (signal.aborted) return;
    if (handleElement && !handleElement.isConnected) {
      triggerDisconnectedAbort();
      return;
    }
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.isTrusted && mouseEvent.buttons === 0) {
      handlers.onFinish();
      return;
    }
    handlers.onMouseMove(mouseEvent);
  };

  const handleFinish: EventListener = () => {
    if (signal.aborted) return;
    handlers.onFinish();
  };

  const handleVisibilityChange: EventListener = () => {
    if (signal.aborted) return;
    if (documentTarget?.visibilityState === 'hidden') {
      handlers.onFinish();
    }
  };

  const handleKeyDown: EventListener = (event) => {
    if (signal.aborted) return;
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      handlers.onCancel();
    }
  };

  const bindings: Array<{
    target: PanelResizeEventTarget;
    type: string;
    listener: EventListener;
    capture: boolean;
  }> = [
    { target: windowTarget, type: 'mousemove', listener: handleMouseMove, capture: true },
    { target: windowTarget, type: 'mouseup', listener: handleFinish, capture: true },
    { target: windowTarget, type: 'pointercancel', listener: handleFinish, capture: true },
    { target: windowTarget, type: 'contextmenu', listener: handleFinish, capture: true },
    { target: windowTarget, type: 'blur', listener: handleFinish, capture: false },
    { target: windowTarget, type: 'keydown', listener: handleKeyDown, capture: true },
  ];

  if (documentTarget) {
    bindings.push({
      target: documentTarget,
      type: 'visibilitychange',
      listener: handleVisibilityChange,
      capture: false,
    });
  }

  try {
    for (const binding of bindings) {
      binding.target.addEventListener(binding.type, binding.listener, {
        capture: binding.capture,
        signal,
      });
    }

    const observationRoot =
      options.observeContainer ??
      (documentTarget && 'body' in documentTarget ? documentTarget.body ?? null : null);

    if (handleElement && observationRoot && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (signal.aborted) {
          disconnectObserver();
          return;
        }
        if (!handleElement.isConnected) {
          triggerDisconnectedAbort();
        }
      });
      observer.observe(observationRoot, { childList: true, subtree: true });
      signal.addEventListener('abort', disconnectObserver, { once: true });
    }
  } catch (error) {
    abortSession();
    throw error;
  }

  return abortSession;
}

export function loadPanelWidths(
  storage: PanelResizeStorage | null = typeof window !== 'undefined' ? window.localStorage : null,
): PanelWidths {
  const defaults = getDefaultPanelWidths();
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(PANEL_WIDTHS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PanelWidths> | null;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const layers = typeof parsed.layers === 'number' && Number.isFinite(parsed.layers)
      ? Math.round(Math.min(PANEL_RESIZE_CONSTRAINTS.layers.maxWidth, Math.max(PANEL_RESIZE_CONSTRAINTS.layers.minWidth, parsed.layers)))
      : defaults.layers;
    const inspector = typeof parsed.inspector === 'number' && Number.isFinite(parsed.inspector)
      ? Math.round(Math.min(PANEL_RESIZE_CONSTRAINTS.inspector.maxWidth, Math.max(PANEL_RESIZE_CONSTRAINTS.inspector.minWidth, parsed.inspector)))
      : defaults.inspector;
    return { layers, inspector };
  } catch {
    return defaults;
  }
}

export function savePanelWidths(
  widths: PanelWidths,
  storage: PanelResizeStorage | null = typeof window !== 'undefined' ? window.localStorage : null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({
      layers: Math.round(widths.layers),
      inspector: Math.round(widths.inspector),
    }));
    return true;
  } catch {
    return false;
  }
}

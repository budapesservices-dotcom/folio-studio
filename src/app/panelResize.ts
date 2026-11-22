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

  return throttled;
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

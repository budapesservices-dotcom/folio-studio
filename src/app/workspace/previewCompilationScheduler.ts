/**
 * Pure debounce + idle-callback scheduler for Live Preview and Code Workspace
 * recompilation. Keeps rapid Canvas drags and Inspector scrubbing at 60fps by
 * coalescing continuous project mutations while flushing explicit user switches
 * (initial open, page/theme/target switches, manual refresh) immediately.
 */

export const PREVIEW_DEBOUNCE_DEFAULT_MS = 160;
export const PREVIEW_DEBOUNCE_LARGE_PROJECT_MS = 280;
export const PREVIEW_LARGE_PROJECT_NODE_THRESHOLD = 150;
export const PREVIEW_IDLE_TIMEOUT_MS = 250;

export interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

export interface DeferredSchedulerDeps {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  requestIdleCallback?: (fn: (deadline: IdleDeadlineLike) => void, opts?: { timeout: number }) => unknown;
  cancelIdleCallback?: (handle: unknown) => void;
}

export interface ScheduleOptions {
  immediate?: boolean;
  idleTimeoutMs?: number;
}

export interface DeferredTaskScheduler {
  schedule: (delayMs: number, task: () => void, options?: ScheduleOptions) => void;
  flush: () => void;
  cancel: () => void;
  isPending: () => boolean;
}

/**
 * Selects an adaptive debounce interval based on active page node complexity.
 */
export function computePreviewDebounceMs(nodeCount: number): number {
  const safeCount = Number.isFinite(nodeCount) ? Math.max(0, nodeCount) : 0;
  return safeCount >= PREVIEW_LARGE_PROJECT_NODE_THRESHOLD
    ? PREVIEW_DEBOUNCE_LARGE_PROJECT_MS
    : PREVIEW_DEBOUNCE_DEFAULT_MS;
}

function getDefaultSchedulerDeps(): DeferredSchedulerDeps {
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (fn: (deadline: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    requestIdleCallback: typeof g.requestIdleCallback === 'function'
      ? (fn, opts) => g.requestIdleCallback!(fn, opts)
      : undefined,
    cancelIdleCallback: typeof g.cancelIdleCallback === 'function'
      ? (handle) => g.cancelIdleCallback!(handle as number)
      : undefined,
  };
}

/**
 * Creates a cancelable debounce + optional `requestIdleCallback` scheduler.
 * Calling `schedule(...)` supersedes any previous queued timer or idle callback.
 */
export function createDeferredTaskScheduler(
  customDeps?: Partial<DeferredSchedulerDeps>,
): DeferredTaskScheduler {
  const defaults = getDefaultSchedulerDeps();
  const deps: DeferredSchedulerDeps = {
    setTimeout: customDeps?.setTimeout ?? defaults.setTimeout,
    clearTimeout: customDeps?.clearTimeout ?? defaults.clearTimeout,
    requestIdleCallback:
      customDeps && 'requestIdleCallback' in customDeps
        ? customDeps.requestIdleCallback
        : defaults.requestIdleCallback,
    cancelIdleCallback:
      customDeps && 'cancelIdleCallback' in customDeps
        ? customDeps.cancelIdleCallback
        : defaults.cancelIdleCallback,
  };

  let timerHandle: unknown = null;
  let idleHandle: unknown = null;
  let pendingTask: (() => void) | null = null;

  const clearScheduledHandles = () => {
    if (timerHandle !== null) {
      deps.clearTimeout(timerHandle);
      timerHandle = null;
    }
    if (idleHandle !== null) {
      deps.cancelIdleCallback?.(idleHandle);
      idleHandle = null;
    }
  };

  const runPendingNow = () => {
    clearScheduledHandles();
    const task = pendingTask;
    pendingTask = null;
    if (task) task();
  };

  const cancel = () => {
    clearScheduledHandles();
    pendingTask = null;
  };

  const schedule = (delayMs: number, task: () => void, options?: ScheduleOptions) => {
    clearScheduledHandles();
    pendingTask = task;

    if (options?.immediate || delayMs <= 0) {
      runPendingNow();
      return;
    }

    const idleTimeoutMs = options?.idleTimeoutMs ?? PREVIEW_IDLE_TIMEOUT_MS;
    timerHandle = deps.setTimeout(() => {
      timerHandle = null;
      if (!pendingTask) return;
      if (deps.requestIdleCallback) {
        idleHandle = deps.requestIdleCallback(
          () => {
            idleHandle = null;
            runPendingNow();
          },
          { timeout: idleTimeoutMs },
        );
      } else {
        runPendingNow();
      }
    }, Math.max(0, delayMs));
  };

  return {
    schedule,
    flush: runPendingNow,
    cancel,
    isPending: () => pendingTask !== null,
  };
}

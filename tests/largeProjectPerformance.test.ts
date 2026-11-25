import { describe, expect, it } from 'vitest';
import {
  computeLayerVirtualWindow,
  computeScrollTopForLayerIndex,
  LAYER_ROW_ESTIMATED_HEIGHT,
  LAYER_VIRTUALIZATION_OVERSCAN,
  LAYER_VIRTUALIZATION_THRESHOLD,
} from '../src/app/workspace/layerListVirtualization';
import {
  computePreviewDebounceMs,
  createDeferredTaskScheduler,
  PREVIEW_DEBOUNCE_DEFAULT_MS,
  PREVIEW_DEBOUNCE_LARGE_PROJECT_MS,
  PREVIEW_LARGE_PROJECT_NODE_THRESHOLD,
} from '../src/app/workspace/previewCompilationScheduler';

const RAW_SOURCES = import.meta.glob<string>(
  [
    '../src/app/workspace/LayersPanel.tsx',
    '../src/app/workspace/useCodeWorkspace.ts',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

describe('Large Project Performance — Layer List Virtualization', () => {
  it('stays disabled below the virtualization threshold so small projects render directly', () => {
    const win = computeLayerVirtualWindow({
      totalCount: LAYER_VIRTUALIZATION_THRESHOLD - 1,
      scrollTop: 0,
      viewportHeight: 500,
    });
    expect(win.isVirtualized).toBe(false);
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(LAYER_VIRTUALIZATION_THRESHOLD - 1);
    expect(win.topSpacerPx).toBe(0);
    expect(win.bottomSpacerPx).toBe(0);
  });

  it('bounds rendered DOM rows and preserves exact total scroll height for 1,000 layers', () => {
    const totalCount = 1000;
    const viewportHeight = 480; // 15 visible rows at 32px each

    const atTop = computeLayerVirtualWindow({ totalCount, scrollTop: 0, viewportHeight });
    expect(atTop.isVirtualized).toBe(true);
    expect(atTop.startIndex).toBe(0);
    expect(atTop.endIndex).toBe(15 + LAYER_VIRTUALIZATION_OVERSCAN);
    expect(atTop.endIndex - atTop.startIndex).toBeLessThan(40);
    expect(
      atTop.topSpacerPx + (atTop.endIndex - atTop.startIndex) * LAYER_ROW_ESTIMATED_HEIGHT + atTop.bottomSpacerPx,
    ).toBe(atTop.totalHeightPx);

    const atMiddle = computeLayerVirtualWindow({
      totalCount,
      scrollTop: 500 * LAYER_ROW_ESTIMATED_HEIGHT,
      viewportHeight,
    });
    expect(atMiddle.isVirtualized).toBe(true);
    expect(atMiddle.startIndex).toBe(500 - LAYER_VIRTUALIZATION_OVERSCAN);
    expect(atMiddle.endIndex).toBe(500 + 15 + LAYER_VIRTUALIZATION_OVERSCAN);
    expect(atMiddle.topSpacerPx).toBe(atMiddle.startIndex * LAYER_ROW_ESTIMATED_HEIGHT);
    expect(
      atMiddle.topSpacerPx + (atMiddle.endIndex - atMiddle.startIndex) * LAYER_ROW_ESTIMATED_HEIGHT + atMiddle.bottomSpacerPx,
    ).toBe(totalCount * LAYER_ROW_ESTIMATED_HEIGHT);

    // Overscrolled past the bottom clamps safely instead of rendering an empty slice
    const overScrolled = computeLayerVirtualWindow({
      totalCount,
      scrollTop: 999_999,
      viewportHeight,
    });
    expect(overScrolled.endIndex).toBe(totalCount);
    expect(overScrolled.endIndex - overScrolled.startIndex).toBeGreaterThan(0);
    expect(overScrolled.bottomSpacerPx).toBe(0);
  });

  it('keeps pinned rows (e.g. inline rename anchor) mounted even when scrolled out of view', () => {
    const win = computeLayerVirtualWindow({
      totalCount: 300,
      scrollTop: 200 * LAYER_ROW_ESTIMATED_HEIGHT,
      viewportHeight: 320,
      pinnedIndices: [10],
    });
    expect(win.isVirtualized).toBe(true);
    expect(win.startIndex).toBeLessThanOrEqual(10);
    expect(win.endIndex).toBeGreaterThan(200);
  });

  it('computes minimal scrollTop adjustments only when a selected row is outside the viewport', () => {
    const viewportHeight = 320; // 10 rows at 32px
    // Already visible
    expect(
      computeScrollTopForLayerIndex({ index: 12, scrollTop: 10 * 32, viewportHeight }),
    ).toBeNull();
    // Above viewport -> scrolls up
    const scrollUp = computeScrollTopForLayerIndex({ index: 4, scrollTop: 10 * 32, viewportHeight });
    expect(scrollUp).toBe(3 * 32);
    // Below viewport -> scrolls down
    const scrollDown = computeScrollTopForLayerIndex({ index: 30, scrollTop: 0, viewportHeight });
    expect(scrollDown).toBe(31 * 32 - viewportHeight + 32);
  });
});

describe('Large Project Performance — Debounced & Idle Live Preview Scheduler', () => {
  it('selects adaptive debounce delay based on node count', () => {
    expect(computePreviewDebounceMs(12)).toBe(PREVIEW_DEBOUNCE_DEFAULT_MS);
    expect(computePreviewDebounceMs(PREVIEW_LARGE_PROJECT_NODE_THRESHOLD - 1)).toBe(PREVIEW_DEBOUNCE_DEFAULT_MS);
    expect(computePreviewDebounceMs(PREVIEW_LARGE_PROJECT_NODE_THRESHOLD)).toBe(PREVIEW_DEBOUNCE_LARGE_PROJECT_MS);
    expect(computePreviewDebounceMs(800)).toBe(PREVIEW_DEBOUNCE_LARGE_PROJECT_MS);
  });

  it('coalesces 60 rapid drag mutations into a single idle-scheduled compilation', () => {
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    const idles = new Map<number, (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void>();

    const scheduler = createDeferredTaskScheduler({
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
      requestIdleCallback: (fn) => {
        const id = nextId++;
        idles.set(id, fn);
        return id;
      },
      cancelIdleCallback: (handle) => {
        idles.delete(handle as number);
      },
    });

    const executedFrames: number[] = [];
    for (let frame = 1; frame <= 60; frame += 1) {
      scheduler.schedule(160, () => executedFrames.push(frame));
    }

    // Only the latest timer should be queued; nothing has executed yet during the drag burst
    expect(timers.size).toBe(1);
    expect(idles.size).toBe(0);
    expect(executedFrames).toEqual([]);
    expect(scheduler.isPending()).toBe(true);

    // Fire debounce timer -> moves into requestIdleCallback
    const [timerEntry] = [...timers.values()];
    timers.clear();
    timerEntry.fn();
    expect(idles.size).toBe(1);
    expect(executedFrames).toEqual([]);

    // Fire idle callback -> executes exactly once with frame 60
    const [idleCb] = [...idles.values()];
    idles.clear();
    idleCb({ didTimeout: false, timeRemaining: () => 12 });
    expect(executedFrames).toEqual([60]);
    expect(scheduler.isPending()).toBe(false);
  });

  it('flushes immediately on explicit user controls, supports manual flush, and cancels cleanly', () => {
    let nextId = 1;
    const timers = new Map<number, () => void>();
    const scheduler = createDeferredTaskScheduler({
      setTimeout: (fn) => {
        const id = nextId++;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
      requestIdleCallback: undefined,
      cancelIdleCallback: undefined,
    });

    const events: string[] = [];
    scheduler.schedule(0, () => events.push('immediate'), { immediate: true });
    expect(events).toEqual(['immediate']);
    expect(timers.size).toBe(0);

    scheduler.schedule(200, () => events.push('flushed'));
    expect(timers.size).toBe(1);
    scheduler.flush();
    expect(events).toEqual(['immediate', 'flushed']);
    expect(timers.size).toBe(0);

    scheduler.schedule(200, () => events.push('cancelled'));
    expect(scheduler.isPending()).toBe(true);
    scheduler.cancel();
    expect(scheduler.isPending()).toBe(false);
    expect(timers.size).toBe(0);

    // Fallback without requestIdleCallback runs directly when debounce timer fires
    scheduler.schedule(160, () => events.push('fallback-timer'));
    expect(timers.size).toBe(1);
    const [cb] = [...timers.values()];
    timers.clear();
    cb();
    expect(events).toEqual(['immediate', 'flushed', 'fallback-timer']);
  });

  it('wires virtualization into LayersPanel and debounced scheduling into useCodeWorkspace', () => {
    const layersSource = RAW_SOURCES['../src/app/workspace/LayersPanel.tsx'] ?? '';
    expect(layersSource).toContain('computeLayerVirtualWindow');
    expect(layersSource).toContain('computeScrollTopForLayerIndex');
    expect(layersSource).toContain('data-virtualized=');
    expect(layersSource).toContain('aria-setsize=');
    expect(layersSource).toContain('aria-posinset=');
    expect(layersSource).toContain('layer-virtual-spacer');

    const codeWsSource = RAW_SOURCES['../src/app/workspace/useCodeWorkspace.ts'] ?? '';
    expect(codeWsSource).toContain('createDeferredTaskScheduler');
    expect(codeWsSource).toContain('computePreviewDebounceMs');
    expect(codeWsSource).toContain('compileSchedulerRef.current?.flush()');
    expect(codeWsSource).toContain('shouldRenderPreview');
  });
});

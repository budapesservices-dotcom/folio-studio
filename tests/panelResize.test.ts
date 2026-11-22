import { describe, expect, it } from 'vitest';
import {
  PANEL_RESIZE_CONSTRAINTS,
  PANEL_WIDTHS_STORAGE_KEY,
  clampPanelWidth,
  computeResizedPanelWidth,
  createThrottledMouseMove,
  getDefaultPanelWidths,
  getPanelWidthBounds,
  loadPanelWidths,
  savePanelWidths,
  type PanelResizeStorage,
} from '../src/app/panelResize';

describe('panelResize bounds and geometry', () => {
  const desktopContext = {
    viewportWidth: 1440,
    layersVisible: true,
    inspectorVisible: true,
    otherPanelWidth: 292,
  };

  it('computes resized width in the right direction for Layers and Inspector', () => {
    // Layers handle on right edge: dragging right widens, dragging left narrows
    expect(computeResizedPanelWidth('layers', 240, 298, 368, desktopContext)).toBe(310);
    expect(computeResizedPanelWidth('layers', 240, 298, 258, desktopContext)).toBe(200);

    // Inspector handle on left edge: dragging left widens, dragging right narrows
    const inspectorContext = { ...desktopContext, otherPanelWidth: 240 };
    expect(computeResizedPanelWidth('inspector', 292, 1148, 1048, inspectorContext)).toBe(392);
    expect(computeResizedPanelWidth('inspector', 292, 1148, 1208, inspectorContext)).toBe(232);
  });

  it('clamps to configured min/max bounds and preserves minimum central workspace width', () => {
    expect(clampPanelWidth('layers', 90, desktopContext)).toBe(PANEL_RESIZE_CONSTRAINTS.layers.minWidth);
    expect(clampPanelWidth('layers', 900, desktopContext)).toBe(PANEL_RESIZE_CONSTRAINTS.layers.maxWidth);

    // Narrow 900px viewport with 58px rail + 320px workspace + 292px inspector => only 230px left for layers
    const tightBounds = getPanelWidthBounds('layers', {
      viewportWidth: 900,
      layersVisible: true,
      inspectorVisible: true,
      otherPanelWidth: 292,
    });
    expect(tightBounds).toEqual({ minWidth: 180, maxWidth: 230 });
    expect(clampPanelWidth('layers', 340, {
      viewportWidth: 900,
      layersVisible: true,
      inspectorVisible: true,
      otherPanelWidth: 292,
    })).toBe(230);

    // When Inspector is hidden, Layers can expand up to its normal maxWidth
    const expandedBounds = getPanelWidthBounds('layers', {
      viewportWidth: 900,
      layersVisible: true,
      inspectorVisible: false,
      otherPanelWidth: 292,
    });
    expect(expandedBounds.maxWidth).toBe(PANEL_RESIZE_CONSTRAINTS.layers.maxWidth);
  });
});

describe('createThrottledMouseMove', () => {
  it('invokes immediately on leading edge, coalesces high-frequency bursts, and flushes final position on trailing edge', () => {
    let clock = 1000;
    const scheduled: Array<{ id: number; runAt: number; fn: () => void; cancelled: boolean }> = [];
    let nextId = 1;
    const received: number[] = [];

    const throttled = createThrottledMouseMove<number>((x) => received.push(x), {
      intervalMs: 16,
      now: () => clock,
      schedule: (fn, delayMs) => {
        const entry = { id: nextId++, runAt: clock + delayMs, fn, cancelled: false };
        scheduled.push(entry);
        return entry.id as unknown as ReturnType<typeof setTimeout>;
      },
      cancelScheduled: (id) => {
        const match = scheduled.find((item) => item.id === (id as unknown as number));
        if (match) match.cancelled = true;
      },
    });

    const advanceTo = (targetTime: number) => {
      clock = targetTime;
      for (const task of scheduled) {
        if (!task.cancelled && task.runAt <= clock) {
          task.cancelled = true;
          task.fn();
        }
      }
    };

    // Simulate 25 high-frequency mousemove events in 12ms (e.g., 1000Hz polling)
    for (let i = 0; i < 25; i++) {
      throttled(300 + i * 4);
      clock += 0.5;
    }

    // Only the leading call should have fired so far!
    expect(received).toEqual([300]);
    expect(scheduled.length).toBe(1);

    // Advance past the 16ms throttle window -> trailing edge delivers the exact last position (300 + 24*4 = 396)
    advanceTo(1017);
    expect(received).toEqual([300, 396]);

    // Subsequent burst in next window throttles again cleanly
    clock = 1020;
    throttled(410);
    clock = 1024;
    throttled(435);
    expect(received).toEqual([300, 396]);

    // Explicit flush (e.g. on mouseup) delivers pending 435 immediately
    throttled.flush();
    expect(received).toEqual([300, 396, 435]);
  });

  it('cancels pending trailing execution on cancel()', () => {
    let clock = 0;
    let pendingFn: (() => void) | null = null;
    const received: number[] = [];

    const throttled = createThrottledMouseMove<number>((x) => received.push(x), {
      intervalMs: 16,
      now: () => clock,
      schedule: (fn) => {
        pendingFn = fn;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancelScheduled: () => {
        pendingFn = null;
      },
    });

    throttled(100);
    clock = 5;
    throttled(200);
    throttled.cancel();
    expect(pendingFn).toBeNull();
    throttled.flush();
    expect(received).toEqual([100]);
  });
});

describe('panelWidths localStorage persistence', () => {
  function createMemoryStorage(initial: Record<string, string> = {}): PanelResizeStorage {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value); },
    };
  }

  it('saves and loads valid widths and clamps out-of-range stored values', () => {
    const storage = createMemoryStorage();
    expect(savePanelWidths({ layers: 312, inspector: 384 }, storage)).toBe(true);
    expect(loadPanelWidths(storage)).toEqual({ layers: 312, inspector: 384 });

    const outOfRange = createMemoryStorage({
      [PANEL_WIDTHS_STORAGE_KEY]: JSON.stringify({ layers: 9999, inspector: 10 }),
    });
    expect(loadPanelWidths(outOfRange)).toEqual({
      layers: PANEL_RESIZE_CONSTRAINTS.layers.maxWidth,
      inspector: PANEL_RESIZE_CONSTRAINTS.inspector.minWidth,
    });
  });

  it('falls back safely to defaults on malformed JSON or null storage', () => {
    const malformed = createMemoryStorage({ [PANEL_WIDTHS_STORAGE_KEY]: '{broken-json' });
    expect(loadPanelWidths(malformed)).toEqual(getDefaultPanelWidths());
    expect(loadPanelWidths(null)).toEqual(getDefaultPanelWidths());
  });
});

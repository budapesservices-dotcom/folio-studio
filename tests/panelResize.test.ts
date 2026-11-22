import { describe, expect, it } from 'vitest';
import {
  PANEL_RESIZE_CONSTRAINTS,
  PANEL_WIDTHS_STORAGE_KEY,
  attachPanelResizeListeners,
  clampPanelWidth,
  computeResizedPanelWidth,
  createThrottledMouseMove,
  getDefaultPanelWidths,
  getPanelWidthBounds,
  loadPanelWidths,
  savePanelWidths,
  type PanelResizeDocumentTarget,
  type PanelResizeEventTarget,
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

  it('reuses a single persistent controller across rapid sessions via reset() without stale cross-session races', () => {
    let clock = 500;
    const scheduled: Array<{ id: number; runAt: number; fn: () => void; cancelled: boolean }> = [];
    let nextId = 1;
    let activeSessionId: number | null = 1;
    const applied: Array<{ sessionId: number; clientX: number }> = [];

    const persistentThrottled = createThrottledMouseMove<{ sessionId: number; clientX: number }>(
      (payload) => {
        if (payload.sessionId !== activeSessionId) return;
        applied.push(payload);
      },
      {
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
      },
    );

    // Session 1: leading call fires at t=500, second move queues trailing timer at t=503
    persistentThrottled({ sessionId: 1, clientX: 300 });
    clock = 503;
    persistentThrottled({ sessionId: 1, clientX: 340 });
    expect(applied).toEqual([{ sessionId: 1, clientX: 300 }]);
    expect(scheduled.filter((t) => !t.cancelled).length).toBe(1);

    // Rapidly start Session 2 just 2ms later (t=505): reset() cancels Session 1's pending timer
    // AND gives Session 2 an immediate leading-edge update without recreating the controller.
    clock = 505;
    activeSessionId = 2;
    persistentThrottled.reset();
    expect(scheduled.filter((t) => !t.cancelled).length).toBe(0);

    persistentThrottled({ sessionId: 2, clientX: 500 });
    expect(applied).toEqual([
      { sessionId: 1, clientX: 300 },
      { sessionId: 2, clientX: 500 },
    ]);

    // Stale Session 1 event arriving during Session 2 is safely ignored even if flushed
    clock = 508;
    persistentThrottled({ sessionId: 1, clientX: 999 });
    persistentThrottled.flush();
    expect(applied).toEqual([
      { sessionId: 1, clientX: 300 },
      { sessionId: 2, clientX: 500 },
    ]);
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

describe('attachPanelResizeListeners AbortController lifecycle', () => {
  function createFakeTarget(visibilityState: DocumentVisibilityState = 'visible') {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const registeredSignals = new Map<string, AbortSignal | undefined>();
    const keyOf = (type: string, options?: boolean | AddEventListenerOptions) => {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      return `${type}:${capture}`;
    };
    const target: PanelResizeEventTarget & PanelResizeDocumentTarget & {
      visibilityState: DocumentVisibilityState;
      emit: (type: string, event: unknown, capture?: boolean) => void;
      activeCount: () => number;
      has: (type: string, capture?: boolean) => boolean;
      signalFor: (type: string, capture?: boolean) => AbortSignal | undefined;
    } = {
      visibilityState,
      addEventListener(type, listener, options) {
        const signal = typeof options === 'object' && options !== null ? options.signal : undefined;
        if (signal?.aborted) return;
        const key = keyOf(type, options);
        const set = listeners.get(key) ?? new Set();
        set.add(listener);
        listeners.set(key, set);
        registeredSignals.set(key, signal);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              const current = listeners.get(key);
              if (!current) return;
              current.delete(listener);
              if (current.size === 0) listeners.delete(key);
            },
            { once: true },
          );
        }
      },
      removeEventListener(type, listener, options) {
        const key = keyOf(type, options);
        const set = listeners.get(key);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      },
      emit(type, event, capture = true) {
        const set = listeners.get(`${type}:${capture}`);
        if (!set) return;
        for (const fn of [...set]) {
          if (typeof fn === 'function') fn(event as Event);
          else fn.handleEvent(event as Event);
        }
      },
      activeCount() {
        let count = 0;
        for (const set of listeners.values()) count += set.size;
        return count;
      },
      has(type, capture = true) {
        return Boolean(listeners.get(`${type}:${capture}`)?.size);
      },
      signalFor(type, capture = true) {
        return registeredSignals.get(`${type}:${capture}`);
      },
    };
    return target;
  }

  it('attaches mousemove/mouseup with an AbortController signal in capture phase and detaches idempotently on abort', () => {
    const win = createFakeTarget();
    const doc = createFakeTarget('visible');
    const controller = new AbortController();
    const moves: number[] = [];
    let finishes = 0;
    let cancels = 0;

    const dispose = attachPanelResizeListeners(
      {
        onMouseMove: (event) => moves.push(event.clientX),
        onFinish: () => { finishes += 1; controller.abort(); },
        onCancel: () => { cancels += 1; controller.abort(); },
      },
      { controller, windowTarget: win, documentTarget: doc },
    );

    expect(win.has('mousemove', true)).toBe(true);
    expect(win.has('mouseup', true)).toBe(true);
    expect(doc.has('visibilitychange', false)).toBe(true);
    expect(win.signalFor('mousemove', true)).toBe(controller.signal);
    expect(win.signalFor('mouseup', true)).toBe(controller.signal);
    expect(doc.signalFor('visibilitychange', false)).toBe(controller.signal);

    win.emit('mousemove', { clientX: 340, isTrusted: false, buttons: 0 }, true);
    expect(moves).toEqual([340]);

    win.emit('mouseup', {}, true);
    expect(finishes).toBe(1);
    expect(cancels).toBe(0);
    expect(controller.signal.aborted).toBe(true);
    expect(win.activeCount()).toBe(0);
    expect(doc.activeCount()).toBe(0);

    // Calling dispose again or emitting after abort is a safe no-op
    dispose();
    win.emit('mousemove', { clientX: 500, isTrusted: false, buttons: 0 }, true);
    expect(moves).toEqual([340]);
  });

  it('detaches real EventTarget listeners immediately when AbortController aborts', () => {
    const nativeWindow = new EventTarget();
    const nativeDoc = new EventTarget() as EventTarget & PanelResizeDocumentTarget;
    const controller = new AbortController();
    let moveCount = 0;
    let finishCount = 0;

    attachPanelResizeListeners(
      {
        onMouseMove: () => { moveCount += 1; },
        onFinish: () => { finishCount += 1; },
        onCancel: () => {},
      },
      { controller, windowTarget: nativeWindow, documentTarget: nativeDoc },
    );

    nativeWindow.dispatchEvent(new Event('mousemove'));
    expect(moveCount).toBe(1);

    controller.abort();

    nativeWindow.dispatchEvent(new Event('mousemove'));
    nativeWindow.dispatchEvent(new Event('mouseup'));
    expect(moveCount).toBe(1);
    expect(finishCount).toBe(0);
  });

  it('cleans up mousemove and mouseup listeners on every interruption path', () => {
    const cases: Array<{
      name: string;
      trigger: (win: ReturnType<typeof createFakeTarget>, doc: ReturnType<typeof createFakeTarget>) => void;
      expected: 'finish' | 'cancel';
    }> = [
      { name: 'blur', trigger: (win) => win.emit('blur', {}, false), expected: 'finish' },
      { name: 'pointercancel', trigger: (win) => win.emit('pointercancel', {}, true), expected: 'finish' },
      { name: 'contextmenu', trigger: (win) => win.emit('contextmenu', {}, true), expected: 'finish' },
      {
        name: 'trusted mousemove with buttons=0',
        trigger: (win) => win.emit('mousemove', { clientX: 400, isTrusted: true, buttons: 0 }, true),
        expected: 'finish',
      },
      {
        name: 'document visibilitychange hidden',
        trigger: (_win, doc) => {
          doc.visibilityState = 'hidden';
          doc.emit('visibilitychange', {}, false);
        },
        expected: 'finish',
      },
      {
        name: 'Escape keydown',
        trigger: (win) => win.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }, true),
        expected: 'cancel',
      },
    ];

    for (const testCase of cases) {
      const win = createFakeTarget();
      const doc = createFakeTarget('visible');
      const controller = new AbortController();
      let outcome: 'none' | 'finish' | 'cancel' = 'none';
      attachPanelResizeListeners(
        {
          onMouseMove: () => {},
          onFinish: () => { outcome = 'finish'; controller.abort(); },
          onCancel: () => { outcome = 'cancel'; controller.abort(); },
        },
        { controller, windowTarget: win, documentTarget: doc },
      );

      testCase.trigger(win, doc);
      expect(outcome, testCase.name).toBe(testCase.expected);
      expect(controller.signal.aborted, `${testCase.name} aborted`).toBe(true);
      expect(win.activeCount(), `${testCase.name} window listeners`).toBe(0);
      expect(doc.activeCount(), `${testCase.name} document listeners`).toBe(0);
    }
  });

  it('aborts and detaches listeners if the resize handle DOM element is disconnected', () => {
    const win = createFakeTarget();
    const doc = createFakeTarget('visible');
    const controller = new AbortController();
    const handle = { isConnected: true };
    const moves: number[] = [];
    let aborts = 0;

    attachPanelResizeListeners(
      {
        onMouseMove: (event) => moves.push(event.clientX),
        onFinish: () => {},
        onCancel: () => {},
        onAbort: () => { aborts += 1; },
      },
      { controller, windowTarget: win, documentTarget: doc, handleElement: handle },
    );

    win.emit('mousemove', { clientX: 280, isTrusted: false, buttons: 1 }, true);
    expect(moves).toEqual([280]);

    // Simulate DOM element removal mid-drag
    handle.isConnected = false;
    win.emit('mousemove', { clientX: 360, isTrusted: false, buttons: 1 }, true);
    expect(moves).toEqual([280]);
    expect(aborts).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    expect(win.activeCount()).toBe(0);
    expect(doc.activeCount()).toBe(0);

    // Pre-disconnected handle immediately aborts without attaching listeners
    const preDisconnectedController = new AbortController();
    let preAborts = 0;
    attachPanelResizeListeners(
      {
        onMouseMove: () => {},
        onFinish: () => {},
        onCancel: () => {},
        onAbort: () => { preAborts += 1; },
      },
      {
        controller: preDisconnectedController,
        windowTarget: win,
        documentTarget: doc,
        handleElement: { isConnected: false },
      },
    );
    expect(preAborts).toBe(1);
    expect(preDisconnectedController.signal.aborted).toBe(true);
    expect(win.activeCount()).toBe(0);
  });

  it('aborts and rolls back already-attached listeners if a subsequent addEventListener throws', () => {
    const win = createFakeTarget();
    const controller = new AbortController();
    const failingDoc: PanelResizeDocumentTarget = {
      visibilityState: 'visible',
      addEventListener() {
        throw new Error('simulated attachment failure');
      },
      removeEventListener() {},
    };

    expect(() =>
      attachPanelResizeListeners(
        { onMouseMove: () => {}, onFinish: () => {}, onCancel: () => {} },
        { controller, windowTarget: win, documentTarget: failingDoc },
      ),
    ).toThrow('simulated attachment failure');

    expect(controller.signal.aborted).toBe(true);
    expect(win.activeCount()).toBe(0);
  });
});

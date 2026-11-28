import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useRef: vi.fn(),
  useEffect: vi.fn(),
}));

vi.mock('preact/hooks', () => ({
  useRef: hookMocks.useRef,
  useEffect: hookMocks.useEffect,
}));

import { FloatingWindow } from '../src/app/FloatingWindow';

type EventHandler = (event: any) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<EventHandler>>();
  addEventListener(type: string, listener: EventHandler): void {
    const current = this.listeners.get(type) ?? new Set<EventHandler>();
    current.add(listener);
    this.listeners.set(type, current);
  }
  removeEventListener(type: string, listener: EventHandler): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

type RootProps = {
  onPointerDown: (event: any) => void;
  onFocusCapture: (event: { target: unknown; currentTarget: unknown }) => void;
};

let fakeWindow: FakeEventTarget;
let fakeDocument: FakeEventTarget & { visibilityState: string };
let unmount: (() => void) | undefined;
let previousWindow: PropertyDescriptor | undefined;
let previousDocument: PropertyDescriptor | undefined;

function renderFloatingWindow(options: {
  onFocus?: () => void;
  onPositionChange?: (position: { x: number; y: number }) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;
} = {}) {
  const vnode = FloatingWindow({
    id: 'main-canvas',
    className: 'workspace canvas-floating',
    children: null,
    floating: true,
    draggable: true,
    position: { x: 48, y: 80 },
    size: { width: 860, height: 620 },
    zIndex: 120,
    onFocus: options.onFocus,
    onPositionChange: options.onPositionChange ?? vi.fn(),
    onSizeChange: options.onSizeChange ?? vi.fn(),
  }) as unknown as { props: RootProps };
  return vnode.props;
}

function startDrag(root: RootProps, pointerId = 7) {
  const shell = { getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  const target = {
    closest(selector: string) {
      if (selector === '[data-window-resize]') return null;
      if (selector.includes('.workspace-toolbar-draggable')) return {};
      return null;
    },
  };
  root.onPointerDown({
    button: 0,
    isPrimary: true,
    pointerId,
    clientX: 100,
    clientY: 100,
    target,
    currentTarget: { closest: () => shell },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
}

function dispatchMove(pointerId = 7) {
  fakeWindow.dispatch('pointermove', {
    pointerId,
    clientX: 120,
    clientY: 130,
    preventDefault: vi.fn(),
  });
}

function startResize(root: RootProps, direction = 'se', pointerId = 9) {
  const shell = { getBoundingClientRect: () => ({ width: 1600, height: 1000 }) };
  const resizeHandle = { getAttribute: (name: string) => name === 'data-window-resize' ? direction : null };
  const target = {
    closest(selector: string) {
      if (selector === '[data-window-resize]') return resizeHandle;
      return null;
    },
  };
  root.onPointerDown({
    button: 0,
    isPrimary: true,
    pointerId,
    clientX: 100,
    clientY: 100,
    target,
    currentTarget: { closest: () => shell },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
}

beforeEach(() => {
  fakeWindow = new FakeEventTarget();
  fakeDocument = Object.assign(new FakeEventTarget(), { visibilityState: 'visible' });
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  hookMocks.useRef.mockImplementation((initial: unknown) => ({ current: initial }));
  hookMocks.useEffect.mockImplementation((effect: () => (() => void) | void) => {
    unmount = effect() as (() => void) | undefined;
  });
  unmount = undefined;
});

afterEach(() => {
  unmount?.();
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  hookMocks.useRef.mockReset();
  hookMocks.useEffect.mockReset();
});

describe('FloatingWindow focus and pointer-session component contract', () => {
  it('raises the owning window when keyboard focus enters a child control', () => {
    const onFocus = vi.fn();
    const root = renderFloatingWindow({ onFocus });
    root.onFocusCapture({ target: {}, currentTarget: {} });
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it('does not raise the window again when focus remains on the root itself', () => {
    const onFocus = vi.fn();
    const root = renderFloatingWindow({ onFocus });
    const rootElement = {};
    root.onFocusCapture({ target: rootElement, currentTarget: rootElement });
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('cleans pointer listeners after pointerup and ignores subsequent moves', () => {
    const onPositionChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange });
    startDrag(root);
    expect(fakeWindow.listenerCount('pointermove')).toBe(1);
    dispatchMove();
    expect(onPositionChange).toHaveBeenCalledOnce();
    fakeWindow.dispatch('pointerup', { pointerId: 7 });
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    dispatchMove();
    expect(onPositionChange).toHaveBeenCalledOnce();
  });

  it('ignores a pointerup from another pointer ID and cleans on the matching pointercancel', () => {
    const onPositionChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange });
    startDrag(root);
    fakeWindow.dispatch('pointerup', { pointerId: 8 });
    expect(fakeWindow.listenerCount('pointermove')).toBe(1);
    dispatchMove(7);
    expect(onPositionChange).toHaveBeenCalledOnce();
    fakeWindow.dispatch('pointercancel', { pointerId: 7 });
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    dispatchMove(7);
    expect(onPositionChange).toHaveBeenCalledOnce();
  });

  it('cleans an active resize session on pointercancel and ignores later movement', () => {
    const onPositionChange = vi.fn();
    const onSizeChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange, onSizeChange });
    startResize(root, 'se');

    expect(fakeWindow.listenerCount('pointermove')).toBe(1);
    fakeWindow.dispatch('pointermove', {
      pointerId: 9,
      clientX: 120,
      clientY: 115,
      preventDefault: vi.fn(),
    });
    expect(onPositionChange).toHaveBeenCalledOnce();
    expect(onSizeChange).toHaveBeenCalledOnce();
    expect(onSizeChange).toHaveBeenLastCalledWith({ width: 880, height: 635 });

    fakeWindow.dispatch('pointercancel', { pointerId: 9 });
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    fakeWindow.dispatch('pointermove', {
      pointerId: 9,
      clientX: 160,
      clientY: 160,
      preventDefault: vi.fn(),
    });
    expect(onPositionChange).toHaveBeenCalledOnce();
    expect(onSizeChange).toHaveBeenCalledOnce();
  });

  it('cleans the active pointer session on window blur', () => {
    const onPositionChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange });
    startDrag(root);
    fakeWindow.dispatch('blur');
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    dispatchMove();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('cleans the active pointer session when the document becomes hidden', () => {
    const onPositionChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange });
    startDrag(root);
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    dispatchMove();
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('cleans the active pointer session when the component unmounts', () => {
    const onPositionChange = vi.fn();
    const root = renderFloatingWindow({ onPositionChange });
    startDrag(root);
    expect(fakeWindow.listenerCount('pointermove')).toBe(1);
    unmount?.();
    unmount = undefined;
    expect(fakeWindow.listenerCount('pointermove')).toBe(0);
    dispatchMove();
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});

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
import {
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  createDefaultWorkspaceLayout,
  loadWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspacePreferencesStorage,
} from '../src/app/workspacePreferences';

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
}

function createMemoryStorage(): WorkspacePreferencesStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

let fakeWindow: FakeEventTarget;
let fakeDocument: FakeEventTarget & { visibilityState: string };
let previousWindow: PropertyDescriptor | undefined;
let previousDocument: PropertyDescriptor | undefined;

describe('Component Canvas Workspace — Resize, Move, Lock/Unlock & Persistence', () => {
  beforeEach(() => {
    fakeWindow = new FakeEventTarget();
    fakeDocument = Object.assign(new FakeEventTarget(), { visibilityState: 'visible' });
    previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true });
    hookMocks.useRef.mockReset().mockImplementation((initial: unknown) => ({ current: initial }));
    hookMocks.useEffect.mockReset();
  });

  afterEach(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: unknown }).document;
  });

  it('blocks drag and resize and hides resize handles when locked, while still allowing focus and unlock', () => {
    const onFocus = vi.fn();
    const onPositionChange = vi.fn();
    const onSizeChange = vi.fn();

    const lockedVNode = FloatingWindow({
      id: 'component-canvas',
      className: 'workspace component-canvas-window canvas-floating',
      children: null,
      floating: true,
      draggable: true,
      locked: true,
      position: { x: 100, y: 120 },
      size: { width: 640, height: 480 },
      zIndex: 140,
      onFocus,
      onPositionChange,
      onSizeChange,
    }) as unknown as {
      props: {
        class: string;
        'data-window-locked': string;
        children: unknown[];
        onPointerDown: (event: any) => void;
      };
    };

    expect(lockedVNode.props['data-window-locked']).toBe('true');
    expect(lockedVNode.props.class).toContain('window-locked');
    // Second child slot (resize handles) is false when locked
    expect(lockedVNode.props.children[1]).toBe(false);

    // Attempt to drag while locked
    const shell = { getBoundingClientRect: () => ({ width: 1280, height: 800 }) };
    lockedVNode.props.onPointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 150,
      clientY: 130,
      target: {
        closest(selector: string) {
          if (selector.includes('.workspace-toolbar-draggable')) return {};
          return null;
        },
      },
      currentTarget: { closest: () => shell },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    fakeWindow.dispatch('pointermove', { pointerId: 1, clientX: 280, clientY: 220, preventDefault: vi.fn() });
    fakeWindow.dispatch('pointerup', { pointerId: 1 });

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(onSizeChange).not.toHaveBeenCalled();

    // Now render unlocked and verify resize handles appear and drag works
    const unlockedVNode = FloatingWindow({
      id: 'component-canvas',
      className: 'workspace component-canvas-window canvas-floating',
      children: null,
      floating: true,
      draggable: true,
      locked: false,
      position: { x: 100, y: 120 },
      size: { width: 640, height: 480 },
      zIndex: 140,
      onFocus,
      onPositionChange,
      onSizeChange,
    }) as unknown as {
      props: {
        'data-window-locked': string;
        children: unknown[];
        onPointerDown: (event: any) => void;
      };
    };

    expect(unlockedVNode.props['data-window-locked']).toBe('false');
    expect(Array.isArray(unlockedVNode.props.children[1])).toBe(true);
    expect((unlockedVNode.props.children[1] as unknown[]).length).toBe(8);

    unlockedVNode.props.onPointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 2,
      clientX: 150,
      clientY: 130,
      target: {
        closest(selector: string) {
          if (selector === '[data-window-resize]') return null;
          if (selector.includes('.workspace-toolbar-draggable')) return {};
          return null;
        },
      },
      currentTarget: { closest: () => shell },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    fakeWindow.dispatch('pointermove', { pointerId: 2, clientX: 250, clientY: 180, preventDefault: vi.fn() });
    fakeWindow.dispatch('pointerup', { pointerId: 2 });

    expect(onPositionChange).toHaveBeenCalledWith({ x: 200, y: 170 });
  });

  it('persists component-canvas locked state across save/load while staying backward compatible with existing V1 records', () => {
    const storage = createMemoryStorage();
    const viewport = { width: 1440, height: 900 };
    const layout = createDefaultWorkspaceLayout(viewport, '2026-11-28T10:00:00.000Z');

    // Old V1 snapshot without locked property loads cleanly as valid with 0 warnings
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(layout));
    const legacyLoad = loadWorkspacePreferences({ storage, viewport });
    expect(legacyLoad.status).toBe('valid');
    expect(legacyLoad.warnings).toEqual([]);
    expect(legacyLoad.layout.windows.find((w) => w.workspace === 'component-canvas')?.locked).toBeUndefined();

    // Save with component-canvas floating, custom size/pos, and locked: true
    const nextLayout = {
      ...layout,
      windows: layout.windows.map((w) =>
        w.workspace === 'component-canvas'
          ? {
              ...w,
              visibility: 'open' as const,
              presentation: 'floating' as const,
              geometry: { x: 180, y: 110, width: 720, height: 520 },
              locked: true,
            }
          : w,
      ),
    };
    const openIds = nextLayout.windows.filter((w) => w.visibility === 'open').map((w) => w.windowInstanceId);
    nextLayout.stackOrder = openIds;

    const saveRes = saveWorkspacePreferences(nextLayout, {
      storage,
      viewport,
      reconciliationComplete: true,
    });
    expect(saveRes).toEqual({ ok: true, key: WORKSPACE_PREFERENCES_STORAGE_KEY });

    const reloaded = loadWorkspacePreferences({ storage, viewport });
    expect(reloaded.status).toBe('valid');
    expect(reloaded.warnings).toEqual([]);
    const compRecord = reloaded.layout.windows.find((w) => w.workspace === 'component-canvas');
    expect(compRecord?.locked).toBe(true);
    expect(compRecord?.presentation).toBe('floating');
    expect(compRecord?.geometry).toEqual({ x: 180, y: 110, width: 720, height: 520 });
  });
});

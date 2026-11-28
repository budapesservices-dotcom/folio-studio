import { describe, expect, it } from 'vitest';
import {
  WINDOW_CHROME,
  WINDOW_LAYERING,
  bringWindowToFront,
  clampWindowPosition,
  getDefaultWindowLayouts,
  getWindowZIndex,
  getWorkspacePanelIds,
  getWorkspaceWindowIds,
  recoverWindowLayout,
  resizeWindowFromPointer,
  type WorkspaceStackTarget,
  type WindowLayout,
  type WindowViewport,
} from '../src/app/windowManager';

const DESKTOP: WindowViewport = { width: 1280, height: 800 };
const WINDOW_ORDER: readonly WorkspaceStackTarget[] = [
  'node-logic',
  'component-canvas',
  'pages',
  'main-canvas',
];

function expectInsideViewport(layout: WindowLayout, viewport: WindowViewport) {
  expect(layout.position.x).toBeGreaterThanOrEqual(0);
  expect(layout.position.y).toBeGreaterThanOrEqual(
    Math.min(WINDOW_CHROME.header, Math.max(0, viewport.height - 1)),
  );
  expect(layout.size.width).toBeGreaterThanOrEqual(1);
  expect(layout.size.height).toBeGreaterThanOrEqual(1);
  expect(layout.position.x + layout.size.width).toBeLessThanOrEqual(viewport.width);
  expect(layout.position.y + layout.size.height).toBeLessThanOrEqual(
    viewport.height - Math.min(WINDOW_CHROME.footer, Math.max(0, viewport.height - WINDOW_CHROME.header - 1)),
  );
}

describe('Window layering policy', () => {
  it('keeps all floating workspace windows below Component Rack and app chrome', () => {
    const topWorkspaceWindow = Math.max(
      ...WINDOW_ORDER.map((id) => getWindowZIndex(WINDOW_ORDER, id)),
    );

    expect(topWorkspaceWindow).toBeLessThan(WINDOW_LAYERING.componentRack);
    expect(WINDOW_LAYERING.componentRack).toBeLessThan(WINDOW_LAYERING.applicationToolbar);
    expect(WINDOW_LAYERING.toolRail).toBe(WINDOW_LAYERING.applicationToolbar);
    expect(WINDOW_LAYERING.menuOverlay).toBeGreaterThan(WINDOW_LAYERING.applicationToolbar);
    expect(WINDOW_LAYERING.contextMenu).toBeGreaterThan(WINDOW_LAYERING.menuOverlay);
    expect(WINDOW_LAYERING.blockingOverlay).toBeGreaterThan(WINDOW_LAYERING.contextMenu);
  });

  it('keeps the reserved workspace window band below the rack even with every window focused', () => {
    expect(getWorkspaceWindowIds()).toEqual([
      'main-canvas',
      'component-canvas',
      'node-logic',
    ]);
    const focused = WINDOW_ORDER.reduce(
      (order, id) => bringWindowToFront(order, id),
      [...WINDOW_ORDER],
    );
    expect(Math.max(...focused.map((id) => getWindowZIndex(focused, id))))
      .toBeLessThan(WINDOW_LAYERING.componentRack);
  });
});

describe('Workspace window and panel identity', () => {
  it('registers exactly three workspace windows and a separate panel registry', () => {
    expect(getWorkspaceWindowIds()).toEqual([
      'main-canvas',
      'component-canvas',
      'node-logic',
    ]);
    expect(getWorkspacePanelIds()).toEqual([
      'pages-rack',
      'component-rack',
      'layers',
    ]);
    expect(Object.keys(getDefaultWindowLayouts(DESKTOP)).sort()).toEqual([
      'component-canvas',
      'main-canvas',
      'node-logic',
    ]);
    expect(Object.keys(getDefaultWindowLayouts(DESKTOP))).not.toContain('pages-rack');
  });

  it('normalizes the legacy pages focus identifier to the Pages Rack panel identity', () => {
    const focused = bringWindowToFront(
      ['main-canvas', 'pages', 'pages-rack', 'node-logic'],
      'pages',
    );
    expect(focused).toEqual(['main-canvas', 'node-logic', 'pages-rack']);
    expect(focused.filter((id) => id === 'pages-rack')).toHaveLength(1);
    expect(getWindowZIndex(focused, 'pages')).toBe(getWindowZIndex(focused, 'pages-rack'));
  });

  it('keeps the combined panel/window stack below Component Rack and application chrome', () => {
    const targets = [
      ...getWorkspaceWindowIds(),
      ...getWorkspacePanelIds(),
    ];
    const focused = targets.reduce(
      (order, id) => bringWindowToFront(order, id),
      [] as WorkspaceStackTarget[],
    );
    const highest = Math.max(...focused.map((id) => getWindowZIndex(focused, id)));
    expect(highest).toBeLessThan(WINDOW_LAYERING.componentRack);
    expect(WINDOW_LAYERING.componentRack).toBeLessThan(WINDOW_LAYERING.applicationToolbar);
    expect(WINDOW_LAYERING.applicationToolbar).toBeLessThan(WINDOW_LAYERING.menuOverlay);
    expect(WINDOW_LAYERING.menuOverlay).toBeLessThan(WINDOW_LAYERING.contextMenu);
    expect(WINDOW_LAYERING.contextMenu).toBeLessThan(WINDOW_LAYERING.blockingOverlay);
  });
});

describe('Window focus and stacking order', () => {
  it('raises whichever workspace receives focus to the top without duplicate entries', () => {
    const focused = bringWindowToFront(
      ['main-canvas', 'component-canvas', 'node-logic', 'main-canvas'],
      'main-canvas',
    );
    expect(focused).toEqual(['component-canvas', 'node-logic', 'main-canvas']);
    expect(focused.at(-1)).toBe('main-canvas');
    expect(getWindowZIndex(focused, 'main-canvas'))
      .toBeGreaterThan(getWindowZIndex(focused, 'component-canvas'));

    const next = bringWindowToFront(focused, 'node-logic');
    expect(next.at(-1)).toBe('node-logic');
    expect(next).toHaveLength(3);
  });

  it('uses the configured base for a target not yet present in the focus order', () => {
    expect(getWindowZIndex(['main-canvas'], 'component-canvas', 240)).toBe(240);
  });

  it('clamps extreme custom bases below reserved rack and chrome layers', () => {
    expect(getWindowZIndex(['main-canvas'], 'component-canvas', 1_000_000))
      .toBeLessThan(WINDOW_LAYERING.componentRack);
    expect(getWindowZIndex(['main-canvas'], 'component-canvas', Number.POSITIVE_INFINITY))
      .toBe(WINDOW_LAYERING.floatingWindowBase);
    expect(getWindowZIndex(['main-canvas'], 'component-canvas', -1_000_000))
      .toBeGreaterThanOrEqual(WINDOW_LAYERING.sidePanel);
    const allTargets = [
      ...getWorkspaceWindowIds(),
      ...getWorkspacePanelIds(),
    ];
    const focused = allTargets.reduce(
      (order, id) => bringWindowToFront(order, id),
      [] as WorkspaceStackTarget[],
    );
    expect(Math.max(...focused.map((id) => getWindowZIndex(focused, id, 1_000_000))))
      .toBeLessThan(WINDOW_LAYERING.componentRack);
  });
});

describe('Default workspace layouts', () => {
  it('provides independent desktop layouts for Main Canvas, Component Canvas and Node Logic', () => {
    const layouts = getDefaultWindowLayouts(DESKTOP);
    expect(Object.keys(layouts).sort()).toEqual([
      'component-canvas',
      'main-canvas',
      'node-logic',
    ]);
    expect(layouts['main-canvas'].size.width).toBe(860);
    expect(layouts['component-canvas'].size.width).toBe(680);
    expect(layouts['node-logic'].size.width).toBe(720);
    for (const layout of Object.values(layouts)) expectInsideViewport(layout, DESKTOP);
  });

  it('adapts each default layout to a small viewport without leaving the usable area', () => {
    const viewport = { width: 360, height: 280 };
    const layouts = getDefaultWindowLayouts(viewport);
    for (const layout of Object.values(layouts)) expectInsideViewport(layout, viewport);
    expect(layouts['main-canvas'].size.width).toBeLessThanOrEqual(viewport.width);
    expect(layouts['component-canvas'].size.height)
      .toBeLessThanOrEqual(viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer);
  });

  it('keeps a recoverable usable window on extremely small viewports below nominal minimums', () => {
    const viewport = { width: 240, height: 180 };
    const layouts = getDefaultWindowLayouts(viewport);
    for (const layout of Object.values(layouts)) expectInsideViewport(layout, viewport);
    expect(layouts['main-canvas'].size.width).toBe(240);
    expect(layouts['main-canvas'].size.height).toBe(97);
  });
});

describe('Saved geometry recovery and dragging', () => {
  it('recovers off-screen saved geometry entirely inside the usable desktop viewport', () => {
    const recovered = recoverWindowLayout(
      { position: { x: 4000, y: -900 }, size: { width: 920, height: 800 } },
      DESKTOP,
    );
    expect(recovered.size.width).toBeLessThanOrEqual(DESKTOP.width);
    expect(recovered.size.height).toBeLessThanOrEqual(DESKTOP.height - WINDOW_CHROME.header - WINDOW_CHROME.footer);
    expectInsideViewport(recovered, DESKTOP);
  });

  it('recovers non-finite, negative and structurally invalid saved values', () => {
    const recovered = recoverWindowLayout(
      {
        position: { x: Number.POSITIVE_INFINITY, y: Number.NaN },
        size: { width: Number.NaN, height: -20 },
      },
      DESKTOP,
    );
    expect(recovered).toEqual({
      position: { x: 0, y: WINDOW_CHROME.header },
      size: { width: 280, height: 220 },
    });

    const malformed = recoverWindowLayout(null as unknown as WindowLayout, DESKTOP);
    expectInsideViewport(malformed, DESKTOP);
  });

  it('clamps a dragged window so it remains reachable inside the viewport', () => {
    const position = clampWindowPosition(
      { x: 9000, y: -400 },
      { width: 420, height: 320 },
      DESKTOP,
    );
    expect(position.x).toBe(DESKTOP.width - 420);
    expect(position.y).toBe(WINDOW_CHROME.header);
  });
});

describe('Resize constraints', () => {
  it('resizes from all eight directions without crossing viewport chrome', () => {
    const directions = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const direction of directions) {
      const result = resizeWindowFromPointer(
        { x: 120, y: 100 },
        { width: 400, height: 300 },
        direction,
        40,
        35,
        { width: 900, height: 700 },
      );
      expect(result.size.width).toBeGreaterThanOrEqual(280);
      expect(result.size.height).toBeGreaterThanOrEqual(220);
      expectInsideViewport(result, { width: 900, height: 700 });
    }
  });

  it('clamps resize values to adaptive minimum dimensions on a viewport smaller than nominal minimums', () => {
    const viewport = { width: 240, height: 180 };
    const result = resizeWindowFromPointer(
      { x: 0, y: 56 },
      { width: 240, height: 97 },
      'se',
      1000,
      1000,
      viewport,
    );
    expect(result.size).toEqual({ width: 240, height: 97 });
    expectInsideViewport(result, viewport);
  });

  it('does not change geometry for an unsupported resize direction', () => {
    const layout = resizeWindowFromPointer(
      { x: 120, y: 100 },
      { width: 400, height: 300 },
      'middle',
      80,
      80,
      DESKTOP,
    );
    expect(layout).toEqual({
      position: { x: 120, y: 100 },
      size: { width: 400, height: 300 },
    });
  });
});

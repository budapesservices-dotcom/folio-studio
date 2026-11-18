import { describe, expect, it } from 'vitest';
import {
  bringWindowToFront,
  getWindowZIndex,
  recoverWindowLayout,
  clampWindowPosition,
  resizeWindowFromPointer,
} from '../src/app/windowManager';

describe('Window Manager', () => {
  it('raises whichever workspace receives focus to the top of the z-order', () => {
    const initial = ['main-canvas', 'component-canvas', 'node-logic', 'pages'] as const;
    const focused = bringWindowToFront(initial, 'main-canvas');
    expect(focused.at(-1)).toBe('main-canvas');
    expect(getWindowZIndex(focused, 'main-canvas')).toBeGreaterThan(getWindowZIndex(focused, 'component-canvas'));
    const next = bringWindowToFront(focused, 'node-logic');
    expect(next.at(-1)).toBe('node-logic');
    expect(next).toHaveLength(4);
  });

  it('recovers an off-screen saved window entirely inside the usable viewport', () => {
    const recovered = recoverWindowLayout(
      { position: { x: 4000, y: -900 }, size: { width: 920, height: 800 } },
      { width: 1280, height: 800 },
    );
    expect(recovered.size.width).toBeLessThanOrEqual(1280);
    expect(recovered.size.height).toBeLessThanOrEqual(800 - 56 - 27);
    expect(recovered.position.x).toBeGreaterThanOrEqual(0);
    expect(recovered.position.x + recovered.size.width).toBeLessThanOrEqual(1280);
    expect(recovered.position.y).toBeGreaterThanOrEqual(56);
    expect(recovered.position.y + recovered.size.height).toBeLessThanOrEqual(800 - 27);
  });

  it('clamps a dragged window so it remains reachable inside the viewport', () => {
    const position = clampWindowPosition({ x: 9000, y: -400 }, { width: 420, height: 320 }, { width: 1280, height: 800 });
    expect(position.x).toBe(1280 - 420);
    expect(position.y).toBe(56);
  });

  it('resizes from all eight directions without crossing the viewport chrome', () => {
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
      expect(result.position.x).toBeGreaterThanOrEqual(0);
      expect(result.position.y).toBeGreaterThanOrEqual(56);
      expect(result.position.x + result.size.width).toBeLessThanOrEqual(900);
      expect(result.position.y + result.size.height).toBeLessThanOrEqual(700 - 27);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createRectNode } from '../src/core/document/factory';
import {
  alignNodes,
  getBounds,
  resizeNodes,
  snapTranslation,
} from '../src/engines/canvas/geometry';

describe('Canvas geometry engine', () => {
  it('calculates the shared bounds of a multi-selection', () => {
    const first = { ...createRectNode(), x: 10, y: 20, width: 100, height: 80 };
    const second = { ...createRectNode(), x: 160, y: 120, width: 40, height: 30 };

    expect(getBounds([first, second])).toEqual({
      x: 10,
      y: 20,
      width: 190,
      height: 130,
    });
  });

  it('snaps a moving selection to a nearby object edge', () => {
    const moving = { ...createRectNode(), x: 0, y: 0, width: 100, height: 100 };
    const target = { ...createRectNode(), x: 200, y: 200, width: 100, height: 100 };
    const result = snapTranslation(
      [moving],
      95,
      0,
      { x: 0, y: 0, width: 600, height: 600 },
      [target],
      8,
    );

    expect(result.dx).toBe(100);
    expect(result.guides.some((guide) => guide.axis === 'x' && guide.position === 200)).toBe(true);
  });

  it('resizes a selected object from its east handle', () => {
    const node = { ...createRectNode(), x: 10, y: 20, width: 100, height: 80 };
    const bounds = getBounds([node]);

    expect(bounds).not.toBeNull();
    const resized = resizeNodes([node], bounds!, 'e', 25, 0);
    expect(resized[0].x).toBe(10);
    expect(resized[0].width).toBe(125);
    expect(resized[0].height).toBe(80);
  });

  it('aligns a group to the left edge without changing its dimensions', () => {
    const first = { ...createRectNode(), x: 25, y: 10, width: 80, height: 60 };
    const second = { ...createRectNode(), x: 180, y: 90, width: 40, height: 30 };
    const aligned = alignNodes([first, second], 'left');

    expect(aligned.map((node) => node.x)).toEqual([25, 25]);
    expect(aligned.map((node) => node.width)).toEqual([80, 40]);
  });
});

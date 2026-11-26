import { describe, expect, it } from 'vitest';
import {
  computePlayheadPercent,
  computeTimelineScrubMs,
  resolveTimelineTrackBounds,
} from '../src/app/workspace/motionTimelineMath';

describe('Motion Timeline scrub math & bounds resolution', () => {
  it('maps pointer coordinates accurately to start, midpoint, and end of timeline', () => {
    const trackLeft = 240;
    const trackWidth = 600;
    const durationMs = 1200;

    expect(
      computeTimelineScrubMs({ clientX: trackLeft, trackLeft, trackWidth, durationMs }),
    ).toBe(0);
    expect(
      computeTimelineScrubMs({ clientX: trackLeft + trackWidth / 2, trackLeft, trackWidth, durationMs }),
    ).toBe(600);
    expect(
      computeTimelineScrubMs({ clientX: trackLeft + trackWidth, trackLeft, trackWidth, durationMs }),
    ).toBe(1200);
    expect(
      computeTimelineScrubMs({ clientX: trackLeft + trackWidth / 3, trackLeft, trackWidth, durationMs }),
    ).toBe(400);
  });

  it('clamps out-of-bounds pointer drags cleanly and snaps to 10ms grid', () => {
    expect(
      computeTimelineScrubMs({ clientX: 50, trackLeft: 200, trackWidth: 400, durationMs: 1200 }),
    ).toBe(0);
    expect(
      computeTimelineScrubMs({ clientX: 900, trackLeft: 200, trackWidth: 400, durationMs: 1200 }),
    ).toBe(1200);
    // 25.1% of 1200ms = 301.2ms -> snaps to 300ms
    expect(
      computeTimelineScrubMs({ clientX: 200 + 400 * 0.251, trackLeft: 200, trackWidth: 400, durationMs: 1200 }),
    ).toBe(300);
  });

  it('uses inner track rect directly so arbitrary ruler padding and resizes stay exact', () => {
    const outer = {
      getBoundingClientRect: () => ({ left: 100, width: 500 }),
    } as unknown as HTMLElement;
    const paddedInner = {
      getBoundingClientRect: () => ({ left: 136, width: 428 }),
    } as unknown as HTMLElement;

    const boundsBeforeResize = resolveTimelineTrackBounds(outer, paddedInner);
    expect(boundsBeforeResize).toEqual({ left: 136, width: 428 });
    expect(
      computeTimelineScrubMs({
        clientX: 136 + 428 / 2,
        trackLeft: boundsBeforeResize.left,
        trackWidth: boundsBeforeResize.width,
        durationMs: 1200,
      }),
    ).toBe(600);

    // After timeline resize (wider track), re-resolving produces the exact midpoint
    const resizedInner = {
      getBoundingClientRect: () => ({ left: 136, width: 760 }),
    } as unknown as HTMLElement;
    const boundsAfterResize = resolveTimelineTrackBounds(outer, resizedInner);
    expect(boundsAfterResize).toEqual({ left: 136, width: 760 });
    expect(
      computeTimelineScrubMs({
        clientX: 136 + 760 / 2,
        trackLeft: boundsAfterResize.left,
        trackWidth: boundsAfterResize.width,
        durationMs: 1200,
      }),
    ).toBe(600);
  });

  it('computes consistent playhead percentage for timecode alignment', () => {
    expect(computePlayheadPercent(0, 1200)).toBe(0);
    expect(computePlayheadPercent(400, 1200)).toBeCloseTo(33.3333, 3);
    expect(computePlayheadPercent(600, 1200)).toBe(50);
    expect(computePlayheadPercent(1200, 1200)).toBe(100);
    expect(computePlayheadPercent(1500, 1200)).toBe(100);
  });
});

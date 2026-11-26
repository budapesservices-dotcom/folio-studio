/**
 * Pure Motion Timeline ruler & lane coordinate math.
 *
 * Keeps pointer-to-time mapping deterministic across arbitrary CSS padding,
 * horizontal scroll offsets, and dynamic timeline resizes.
 */

export interface TimelineTrackBounds {
  readonly left: number;
  readonly width: number;
}

export interface TimelineScrubInput {
  readonly clientX: number;
  readonly trackLeft: number;
  readonly trackWidth: number;
  readonly durationMs: number;
  readonly snapMs?: number;
}

export function computeTimelineScrubMs(input: TimelineScrubInput): number {
  const safeDuration = Math.max(0, Number.isFinite(input.durationMs) ? input.durationMs : 0);
  if (safeDuration === 0) return 0;

  const safeWidth = Math.max(1, Number.isFinite(input.trackWidth) ? input.trackWidth : 1);
  const rawRatio = (input.clientX - input.trackLeft) / safeWidth;
  const clampedRatio = Math.max(0, Math.min(1, rawRatio));
  const rawMs = clampedRatio * safeDuration;

  const snap = input.snapMs ?? 10;
  if (snap <= 0) {
    return Math.round(rawMs);
  }
  const snapped = Math.round(rawMs / snap) * snap;
  return Math.max(0, Math.min(safeDuration, snapped));
}

export function computePlayheadPercent(playheadMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(playheadMs) || playheadMs <= 0) return 0;
  return Math.max(0, Math.min(100, (playheadMs / durationMs) * 100));
}

/**
 * Resolves the live inner track geometry for a ruler or lane element.
 *
 * Prefers the inner `.mt-ruler-track` / `.mt-lane-track` rect directly so CSS
 * padding on the outer container is never double-counted or hardcoded. Falls
 * back to subtracting computed horizontal padding from the outer element.
 */
export function resolveTimelineTrackBounds(
  containerEl: HTMLElement,
  trackEl?: HTMLElement | null,
): TimelineTrackBounds {
  if (trackEl) {
    const trackRect = trackEl.getBoundingClientRect();
    if (trackRect.width > 0) {
      return { left: trackRect.left, width: trackRect.width };
    }
  }

  const rect = containerEl.getBoundingClientRect();
  let padLeft = 0;
  let padRight = 0;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(containerEl);
    padLeft = Number.parseFloat(style.paddingLeft) || 0;
    padRight = Number.parseFloat(style.paddingRight) || 0;
  }
  const width = Math.max(1, rect.width - padLeft - padRight);
  return {
    left: rect.left + padLeft,
    width,
  };
}

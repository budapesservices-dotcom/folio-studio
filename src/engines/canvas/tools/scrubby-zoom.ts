import type { CanvasToolHandler, CanvasToolTransition } from './types';
export function calculateScrubbyZoom(startZoom: number, deltaX: number, startPan: { x: number; y: number }, anchor: { x: number; y: number }): { zoom: number; pan: { x: number; y: number } } {
  const zoom = Math.min(2, Math.max(0.35, startZoom * Math.pow(2, deltaX / 240)));
  const ratio = zoom / startZoom;
  return { zoom, pan: { x: anchor.x - (anchor.x - startPan.x) * ratio, y: anchor.y - (anchor.y - startPan.y) * ratio } };
}
export const scrubbyZoomTool: CanvasToolHandler = {
  id: 'scrubby-zoom', label: 'Scrubby Zoom', shortcut: 'Z',
  description: 'Drag right/left to zoom smoothly, click to zoom in, Alt+click to zoom out, double-click for 100%.',
  group: 'navigation', icon: 'scrubbyZoom',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    if ((event.detail ?? 0) >= 2) {
      return { zoom: 1, pan: { x: 0, y: 0 }, session: null, notice: 'Reset zoom to 100%.', preventDefault: true };
    }
    return {
      session: { kind: 'scrubby-zoom', pointerId: event.pointerId, startClientX: event.clientX, startZoom: context.zoom, startPan: context.pan, anchor: event.viewportAnchor },
      capturePointer: true, preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'scrubby-zoom' || session.pointerId !== event.pointerId) return {};
    const result = calculateScrubbyZoom(session.startZoom, event.clientX - session.startClientX, session.startPan, session.anchor);
    return { zoom: result.zoom, pan: result.pan, preventDefault: true };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'scrubby-zoom' || session.pointerId !== event.pointerId) return {};
    if (Math.abs(event.clientX - session.startClientX) < 3) {
      const factor = event.altKey ? 1 / 1.25 : 1.25;
      const nextZoom = Math.min(2, Math.max(0.35, Math.round(session.startZoom * factor * 1000) / 1000));
      const ratio = nextZoom / session.startZoom;
      const nextPan = {
        x: session.anchor.x - (session.anchor.x - session.startPan.x) * ratio,
        y: session.anchor.y - (session.anchor.y - session.startPan.y) * ratio,
      };
      return { zoom: nextZoom, pan: nextPan, session: null, preventDefault: true };
    }
    return { session: null, preventDefault: true };
  },
  onPointerCancel(event, context) {
    const session = context.session;
    return session?.kind === 'scrubby-zoom' && session.pointerId === event.pointerId ? { zoom: session.startZoom, pan: session.startPan, session: null } : {};
  },
  onKeyDown(event, context) {
    const session = context.session;
    return event.key === 'Escape' && session?.kind === 'scrubby-zoom'
      ? { zoom: session.startZoom, pan: session.startPan, session: null, preventDefault: true }
      : {};
  },
  renderOverlay: () => null, cursorStyle: (context) => (context.session?.kind === 'scrubby-zoom' ? 'ew-resize' : 'zoom-in'),
};

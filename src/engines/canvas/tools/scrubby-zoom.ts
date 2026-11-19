import type { CanvasToolContext, CanvasToolHandler, CanvasToolTransition } from './types';
export function calculateScrubbyZoom(startZoom: number, deltaX: number, startPan: { x: number; y: number }, anchor: { x: number; y: number }): { zoom: number; pan: { x: number; y: number } } {
  const zoom = Math.min(2, Math.max(0.35, startZoom * Math.pow(2, deltaX / 240)));
  const ratio = zoom / startZoom;
  return { zoom, pan: { x: anchor.x - (anchor.x - startPan.x) * ratio, y: anchor.y - (anchor.y - startPan.y) * ratio } };
}
export const scrubbyZoomTool: CanvasToolHandler = {
  id: 'scrubby-zoom', label: 'Scrubby Zoom',
  description: 'Drag right to zoom in and left to zoom out, anchored to the point where you started.',
  group: 'navigation', icon: 'scrubbyZoom',
  onPointerDown(event, context): CanvasToolTransition {
    return event.button !== 0 ? {} : {
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
  onPointerUp(event, context) {
    return context.session?.kind === 'scrubby-zoom' && context.session.pointerId === event.pointerId ? { session: null, preventDefault: true } : {};
  },
  onPointerCancel(event, context) {
    const session = context.session;
    return session?.kind === 'scrubby-zoom' && session.pointerId === event.pointerId ? { zoom: session.startZoom, pan: session.startPan, session: null } : {};
  },
  onKeyDown: () => ({}), renderOverlay: () => null, cursorStyle: () => 'ew-resize',
};

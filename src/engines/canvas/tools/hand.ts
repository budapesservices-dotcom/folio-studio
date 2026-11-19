import type { CanvasToolContext, CanvasToolHandler, CanvasToolTransition } from './types';
export const handTool: CanvasToolHandler = {
  id: 'hand', label: 'Hand',
  description: 'Pan the Canvas viewport by dragging anywhere, without selecting or moving artwork.',
  group: 'navigation', icon: 'hand',
  onPointerDown(event, context): CanvasToolTransition {
    return event.button !== 0 ? {} : {
      session: { kind: 'hand', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPan: context.pan },
      capturePointer: true, preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'hand' || session.pointerId !== event.pointerId) return {};
    return { pan: { x: session.startPan.x + event.clientX - session.startClientX, y: session.startPan.y + event.clientY - session.startClientY }, preventDefault: true };
  },
  onPointerUp(event, context) {
    return context.session?.kind === 'hand' && context.session.pointerId === event.pointerId ? { session: null, preventDefault: true } : {};
  },
  onPointerCancel(event, context) {
    const session = context.session;
    return session?.kind === 'hand' && session.pointerId === event.pointerId ? { pan: session.startPan, session: null } : {};
  },
  onKeyDown: () => ({}), renderOverlay: () => null,
  cursorStyle(context) { return context.session?.kind === 'hand' ? 'grabbing' : 'grab'; },
};

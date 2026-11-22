import { expandSelectedLayerIds, getCanvasClickSelectionIds, getLayerAncestorIds } from '../../../core/document/layers';
import { getBounds } from '../geometry';
import { getCanvasUnitsPerPixel, polygonIntersectsBounds } from './geometry';
import type { CanvasToolContext, CanvasToolHandler, LassoSelectionSession } from './types';

function mergeSelection(session: LassoSelectionSession, hits: string[], nodes: CanvasToolContext['canvasNodes']): string[] {
  const roots = new Set<string>();
  for (const id of hits) getCanvasClickSelectionIds(nodes, id).forEach((selectedId) => roots.add(selectedId));
  const expanded = expandSelectedLayerIds(nodes, [...roots]);
  if (session.subtractive) {
    const removed = new Set(expanded);
    hits.forEach((id) => getLayerAncestorIds(nodes, id).forEach((ancestor) => removed.add(ancestor)));
    return session.initialIds.filter((id) => !removed.has(id));
  }
  return session.additive ? [...new Set([...session.initialIds, ...expanded])] : expanded;
}
export const lassoSelectionTool: CanvasToolHandler = {
  id: 'lasso-selection', label: 'Lasso Selection',
  description: 'Draw a freehand loop to select every visible object touched or enclosed by the path.',
  group: 'selection', icon: 'lasso',
  onPointerDown(event, context) {
    if (event.button !== 0) return {};
    return {
      session: {
        kind: 'lasso-selection',
        pointerId: event.pointerId,
        points: [event.point],
        additive: event.shiftKey,
        subtractive: event.ctrlKey || event.metaKey,
        initialIds: context.selectedNodeIds,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context) {
    const session = context.session;
    if (!session || session.kind !== 'lasso-selection' || session.pointerId !== event.pointerId) return {};
    const last = session.points[session.points.length - 1];
    const minSample = Math.max(0.4, 1.5 * getCanvasUnitsPerPixel(context));
    if (Math.hypot(event.point.x - last.x, event.point.y - last.y) < minSample) return {};
    return { session: { ...session, points: [...session.points, event.point] }, preventDefault: true };
  },
  onPointerUp(event, context) {
    const session = context.session;
    if (!session || session.kind !== 'lasso-selection' || session.pointerId !== event.pointerId) return {};
    const points = [...session.points, event.point];
    if (points.length < 3) {
      return {
        ...(session.additive || session.subtractive ? {} : { selection: [] }),
        session: null,
        guides: [],
        preventDefault: true,
      };
    }
    const hits = context.selectableNodes.filter((node) => {
      const bounds = getBounds([node]);
      return bounds ? polygonIntersectsBounds(points, bounds) : false;
    }).map((node) => node.id);
    return { selection: mergeSelection(session, hits, context.canvasNodes), session: null, guides: [], preventDefault: true };
  },
  onPointerCancel(_event, context) { return context.session?.kind === 'lasso-selection' ? { session: null, guides: [] } : {}; },
  onKeyDown(event, context) { return event.key === 'Escape' && context.session?.kind === 'lasso-selection' ? { session: null, guides: [], preventDefault: true } : {}; },
  renderOverlay(context) {
    const session = context.session;
    return session?.kind === 'lasso-selection' ? { kind: 'lasso', points: session.points } : null;
  },
  cursorStyle: () => 'crosshair',
};

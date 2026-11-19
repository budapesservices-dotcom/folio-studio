import { expandSelectedLayerIds, getCanvasClickSelectionIds, getLayerAncestorIds } from '../../../core/document/layers';
import { getBounds, resizeNodes, snapTranslation } from '../geometry';
import type { CanvasToolContext, CanvasToolHandler, CanvasToolId, CanvasToolTransition } from './types';
import { rectangleBounds } from './geometry';

function createSelectTool(id: CanvasToolId, exactLayer: boolean): CanvasToolHandler {
  const label = exactLayer ? 'Direct Selection' : 'Select';
  return {
    id, label,
    description: exactLayer
      ? 'Select and move one nested child directly, without selecting its parent hierarchy.'
      : 'Select, move, resize and transform objects or complete layer hierarchies.',
    group: 'selection',
    icon: exactLayer ? 'directSelection' : 'cursor',
    onPointerDown(event, context): CanvasToolTransition {
      if (event.button !== 0) return {};
      if (event.resizeHandle && context.selectionBounds && context.selectedNodes.length) {
        return {
          session: { kind: 'select-transform', pointerId: event.pointerId, mode: 'resize', start: event.point,
            nodes: context.selectedNodes, bounds: context.selectionBounds, ids: context.selectedNodes.map((n) => n.id), handle: event.resizeHandle },
          capturePointer: true, preventDefault: true,
        };
      }
      if (!event.targetNodeId) {
        if (exactLayer) return { selection: [], preventDefault: true };
        return {
          selection: [],
          session: { kind: 'marquee-selection', pointerId: event.pointerId, start: event.point, current: event.point,
            additive: event.shiftKey, subtractive: event.ctrlKey || event.metaKey, initialIds: context.selectedNodeIds },
          capturePointer: true, preventDefault: true,
        };
      }
      const hit = context.selectableNodes.find((node) => node.id === event.targetNodeId);
      if (!hit) return {};
      const scope = exactLayer || event.shiftKey ? [hit.id] : getCanvasClickSelectionIds(context.canvasNodes, hit.id);
      const groupSelected = scope.every((id) => context.selectedNodeIds.includes(id));
      const modifier = event.ctrlKey || event.metaKey;
      let nextIds: string[];
      if (exactLayer || event.shiftKey) nextIds = [hit.id];
      else if (modifier && groupSelected) {
        const removed = new Set([...scope, ...getLayerAncestorIds(context.canvasNodes, hit.id)]);
        nextIds = context.selectedNodeIds.filter((id) => !removed.has(id));
      } else if (modifier) nextIds = [...new Set([...context.selectedNodeIds, ...scope])];
      else nextIds = scope;
      if (modifier && groupSelected && !exactLayer) return { selection: nextIds, preventDefault: true };
      const moving = context.selectableNodes.filter((node) => nextIds.includes(node.id));
      const bounds = getBounds(moving);
      if (!moving.length || !bounds) return { selection: nextIds, preventDefault: true };
      return {
        selection: nextIds,
        session: { kind: 'select-transform', pointerId: event.pointerId, mode: 'move', start: event.point,
          nodes: moving, bounds, ids: moving.map((n) => n.id) },
        capturePointer: true, preventDefault: true,
      };
    },
    onPointerMove(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.pointerId !== event.pointerId) return {};
      if (session.kind === 'marquee-selection') return { session: { ...session, current: event.point }, preventDefault: true };
      if (session.kind !== 'select-transform') return {};
      const dx = event.point.x - session.start.x, dy = event.point.y - session.start.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.25) return {};
      if (session.mode === 'resize' && session.handle) {
        const previewNodes = resizeNodes(session.nodes, session.bounds, session.handle, dx, dy);
        return { session: { ...session, previewNodes }, previewNodes, guides: [], preventDefault: true };
      }
      const scale = context.document.width / Math.max(1, context.viewportWidth);
      const snapped = snapTranslation(session.nodes, dx, dy,
        { x: 0, y: 0, width: context.document.width, height: context.document.height },
        context.otherNodes.filter((node) => !session.ids.includes(node.id)), 8 * scale);
      const previewNodes = session.nodes.map((node) => ({ ...node, x: node.x + snapped.dx, y: node.y + snapped.dy }));
      return { session: { ...session, previewNodes }, previewNodes, guides: snapped.guides, preventDefault: true };
    },
    onPointerUp(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.pointerId !== event.pointerId) return {};
      if (session.kind === 'marquee-selection') {
        const box = rectangleBounds(session.start, event.point);
        const ids = box.width > 1 || box.height > 1 ? context.selectableNodes.filter((node) =>
          node.x <= box.x + box.width && node.x + node.width >= box.x
          && node.y <= box.y + box.height && node.y + node.height >= box.y).map((node) => node.id) : [];
        const expanded = expandSelectedLayerIds(context.canvasNodes, ids);
        let selection: string[];
        if (session.subtractive) {
          const removed = new Set(expanded);
          ids.forEach((id) => getLayerAncestorIds(context.canvasNodes, id).forEach((ancestor) => removed.add(ancestor)));
          selection = session.initialIds.filter((id) => !removed.has(id));
        } else if (session.additive) selection = [...new Set([...session.initialIds, ...expanded])];
        else selection = expanded;
        return { selection, session: null, previewNodes: null, guides: [], preventDefault: true };
      }
      if (session.kind === 'select-transform') return {
        ...(session.previewNodes ? { commitNodes: session.previewNodes } : {}),
        session: null, previewNodes: null, guides: [], preventDefault: true,
      };
      return {};
    },
    onPointerCancel(_event, context) {
      return context.session ? { session: null, previewNodes: null, guides: [] } : {};
    },
    onKeyDown(event, context) {
      return event.key === 'Escape' && context.session ? { session: null, previewNodes: null, guides: [] } : {};
    },
    renderOverlay(context) {
      const session = context.session;
      return session?.kind === 'marquee-selection' ? { kind: 'marquee', bounds: rectangleBounds(session.start, session.current) } : null;
    },
    cursorStyle(context) {
      if (context.session?.kind === 'select-transform') return context.session.mode === 'move' ? 'move' : 'nwse-resize';
      return 'default';
    },
  };
}
export const selectTool = createSelectTool('select', false);
export const directSelectionTool = createSelectTool('direct-selection', true);

import { expandSelectedLayerIds, getCanvasClickSelectionIds, getLayerAncestorIds } from '../../../core/document/layers';
import type { PathNode } from '../../../core/document/types';
import { normalizePathNode, toggleAnchorPointType } from '../../../core/document/vector';
import { getBounds, resizeNodes, snapTranslation } from '../geometry';
import type { CanvasToolHandler, CanvasToolId, CanvasToolTransition } from './types';
import { rectangleBounds } from './geometry';

function computeAngleDeg(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function createSelectTool(id: CanvasToolId, exactLayer: boolean, uniformScale = false): CanvasToolHandler {
  const label = uniformScale ? 'Scale' : exactLayer ? 'Direct Selection' : 'Select';
  const shortcut = uniformScale ? 'K' : exactLayer ? 'A' : 'V';
  return {
    id,
    label,
    shortcut,
    description: uniformScale
      ? 'Scale objects, strokes, corner radii and typography proportionally together.'
      : exactLayer
        ? 'Select a nested child directly or drag vector anchor points and Bezier handles.'
        : 'Select, move, resize, and rotate objects or complete layer hierarchies.',
    group: 'selection',
    icon: uniformScale ? 'scale' : exactLayer ? 'directSelection' : 'cursor',
    onPointerDown(event, context): CanvasToolTransition {
      if (event.button !== 0) return {};

      // Direct Selection (A): live Adobe Illustrator-grade vector anchor & Bezier handle editing!
      if (exactLayer && event.anchorHit) {
        const pathNode = context.selectableNodes.find(
          (node): node is PathNode => node.id === event.anchorHit?.nodeId && node.type === 'path',
        );
        if (pathNode && event.anchorHit.pointIndex >= 0 && event.anchorHit.pointIndex < pathNode.points.length) {
          if (event.anchorHit.part === 'anchor' && (event.altKey || (event.detail ?? 0) >= 2)) {
            const toggled = toggleAnchorPointType(pathNode, event.anchorHit.pointIndex);
            return { commitNodes: [toggled], selection: [pathNode.id], preventDefault: true };
          }
          return {
            selection: [pathNode.id],
            session: {
              kind: 'anchor-edit',
              pointerId: event.pointerId,
              node: pathNode,
              pointIndex: event.anchorHit.pointIndex,
              part: event.anchorHit.part,
              start: event.point,
            },
            capturePointer: true,
            preventDefault: true,
          };
        }
      }

      // Corner rotation zone (Figma-style hover/drag outside selection corner)
      if (event.rotateHandle && context.selectionBounds && context.selectedNodes.length) {
        const center = {
          x: context.selectionBounds.x + context.selectionBounds.width / 2,
          y: context.selectionBounds.y + context.selectionBounds.height / 2,
        };
        const startAngle = computeAngleDeg(center, event.point);
        return {
          session: {
            kind: 'select-transform',
            pointerId: event.pointerId,
            mode: 'rotate',
            start: event.point,
            nodes: context.selectedNodes,
            bounds: context.selectionBounds,
            ids: context.selectedNodes.map((n) => n.id),
            startAngle,
            currentAngle: 0,
          },
          capturePointer: true,
          preventDefault: true,
        };
      }

      if (event.resizeHandle && context.selectionBounds && context.selectedNodes.length) {
        return {
          session: {
            kind: 'select-transform',
            pointerId: event.pointerId,
            mode: 'resize',
            start: event.point,
            nodes: context.selectedNodes,
            bounds: context.selectionBounds,
            ids: context.selectedNodes.map((n) => n.id),
            handle: event.resizeHandle,
            uniformScale,
          },
          capturePointer: true,
          preventDefault: true,
        };
      }

      if (!event.targetNodeId) {
        if (exactLayer) return { selection: [], preventDefault: true };
        return {
          selection: [],
          session: {
            kind: 'marquee-selection',
            pointerId: event.pointerId,
            start: event.point,
            current: event.point,
            additive: event.shiftKey,
            subtractive: event.ctrlKey || event.metaKey,
            initialIds: context.selectedNodeIds,
          },
          capturePointer: true,
          preventDefault: true,
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
        session: {
          kind: 'select-transform',
          pointerId: event.pointerId,
          mode: 'move',
          start: event.point,
          nodes: moving,
          bounds,
          ids: moving.map((n) => n.id),
          uniformScale,
        },
        capturePointer: true,
        preventDefault: true,
      };
    },

    onPointerMove(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.pointerId !== event.pointerId) return {};
      if (session.kind === 'marquee-selection') {
        return { session: { ...session, current: event.point }, preventDefault: true };
      }

      if (session.kind === 'anchor-edit') {
        const dx = event.point.x - session.start.x;
        const dy = event.point.y - session.start.y;
        const points = session.node.points.map((pt, index) => {
          if (index !== session.pointIndex) return pt;
          if (session.part === 'anchor') {
            return {
              ...pt,
              x: Math.round((pt.x + dx) * 100) / 100,
              y: Math.round((pt.y + dy) * 100) / 100,
              ...(pt.handleIn ? { handleIn: { x: Math.round((pt.handleIn.x + dx) * 100) / 100, y: Math.round((pt.handleIn.y + dy) * 100) / 100 } } : {}),
              ...(pt.handleOut ? { handleOut: { x: Math.round((pt.handleOut.x + dx) * 100) / 100, y: Math.round((pt.handleOut.y + dy) * 100) / 100 } } : {}),
            };
          }
          const localX = Math.round((event.point.x - session.node.x) * 100) / 100;
          const localY = Math.round((event.point.y - session.node.y) * 100) / 100;
          if (session.part === 'handle-out') {
            const mirror = !event.altKey && pt.pointType !== 'corner';
            return {
              ...pt,
              handleOut: { x: localX, y: localY },
              ...(mirror ? { handleIn: { x: Math.round((pt.x * 2 - localX) * 100) / 100, y: Math.round((pt.y * 2 - localY) * 100) / 100 } } : {}),
              pointType: event.altKey ? ('corner' as const) : pt.pointType,
            };
          }
          const mirror = !event.altKey && pt.pointType !== 'corner';
          return {
            ...pt,
            handleIn: { x: localX, y: localY },
            ...(mirror ? { handleOut: { x: Math.round((pt.x * 2 - localX) * 100) / 100, y: Math.round((pt.y * 2 - localY) * 100) / 100 } } : {}),
            pointType: event.altKey ? ('corner' as const) : pt.pointType,
          };
        });
        const previewNode = normalizePathNode({ ...session.node, points });
        return {
          session: { ...session, previewNode },
          previewNodes: [previewNode],
          preventDefault: true,
        };
      }

      if (session.kind !== 'select-transform') return {};

      if (session.mode === 'rotate') {
        const center = {
          x: session.bounds.x + session.bounds.width / 2,
          y: session.bounds.y + session.bounds.height / 2,
        };
        let deltaAngle = computeAngleDeg(center, event.point) - (session.startAngle ?? 0);
        if (event.shiftKey) {
          deltaAngle = Math.round(deltaAngle / 15) * 15;
        }
        const roundedDelta = Math.round(deltaAngle * 10) / 10;
        const previewNodes = session.nodes.map((node) => ({
          ...node,
          rotation: Math.round(((node.rotation + roundedDelta) % 360) * 10) / 10,
        }));
        return {
          session: { ...session, currentAngle: roundedDelta, previewNodes },
          previewNodes,
          guides: [],
          preventDefault: true,
        };
      }

      const dx = event.point.x - session.start.x;
      const dy = event.point.y - session.start.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.25) return {};

      if (session.mode === 'resize' && session.handle) {
        const previewNodes = resizeNodes(session.nodes, session.bounds, session.handle, dx, dy, {
          uniformScale: Boolean(session.uniformScale),
        });
        return { session: { ...session, previewNodes }, previewNodes, guides: [], preventDefault: true };
      }

      const scale = context.document.width / Math.max(1, context.viewportWidth);
      const snapped = snapTranslation(
        session.nodes,
        dx,
        dy,
        { x: 0, y: 0, width: context.document.width, height: context.document.height },
        context.otherNodes.filter((node) => !session.ids.includes(node.id)),
        8 * scale,
      );
      const previewNodes = session.nodes.map((node) => ({ ...node, x: node.x + snapped.dx, y: node.y + snapped.dy }));
      return { session: { ...session, previewNodes }, previewNodes, guides: snapped.guides, preventDefault: true };
    },

    onPointerUp(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.pointerId !== event.pointerId) return {};
      if (session.kind === 'anchor-edit') {
        return {
          ...(session.previewNode ? { commitNodes: [session.previewNode] } : {}),
          session: null,
          previewNodes: null,
          preventDefault: true,
        };
      }
      if (session.kind === 'marquee-selection') {
        const box = rectangleBounds(session.start, event.point);
        const ids = box.width > 1 || box.height > 1
          ? context.selectableNodes
              .filter(
                (node) =>
                  node.x <= box.x + box.width &&
                  node.x + node.width >= box.x &&
                  node.y <= box.y + box.height &&
                  node.y + node.height >= box.y,
              )
              .map((node) => node.id)
          : [];
        const expanded = expandSelectedLayerIds(context.canvasNodes, ids);
        let selection: string[];
        if (session.subtractive) {
          const removed = new Set(expanded);
          ids.forEach((id) => getLayerAncestorIds(context.canvasNodes, id).forEach((ancestor) => removed.add(ancestor)));
          selection = session.initialIds.filter((id) => !removed.has(id));
        } else if (session.additive) {
          selection = [...new Set([...session.initialIds, ...expanded])];
        } else {
          selection = expanded;
        }
        return { selection, session: null, previewNodes: null, guides: [], preventDefault: true };
      }
      if (session.kind === 'select-transform') {
        return {
          ...(session.previewNodes ? { commitNodes: session.previewNodes } : {}),
          session: null,
          previewNodes: null,
          guides: [],
          preventDefault: true,
        };
      }
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
      if (session?.kind === 'marquee-selection') {
        return { kind: 'marquee', bounds: rectangleBounds(session.start, session.current) };
      }
      if (session?.kind === 'select-transform' && session.mode === 'rotate') {
        const center = {
          x: session.bounds.x + session.bounds.width / 2,
          y: session.bounds.y + session.bounds.height / 2,
        };
        const radius = Math.max(32, Math.hypot(session.bounds.width, session.bounds.height) / 2);
        return { kind: 'rotate-ring', center, radius, angleDeg: session.currentAngle ?? 0 };
      }
      return null;
    },

    cursorStyle(context) {
      if (context.session?.kind === 'anchor-edit') return 'crosshair';
      if (context.session?.kind === 'select-transform') {
        if (context.session.mode === 'rotate') return 'grabbing';
        return context.session.mode === 'move' ? 'move' : 'nwse-resize';
      }
      return 'default';
    },
  };
}

export const selectTool = createSelectTool('select', false, false);
export const directSelectionTool = createSelectTool('direct-selection', true, false);
export const scaleTool = createSelectTool('scale', false, true);

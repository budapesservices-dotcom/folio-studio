import { expandSelectedLayerIds, getCanvasClickSelectionIds, getLayerAncestorIds } from '../../../core/document/layers';
import { classifyNodeChange } from '../../../core/document/nodeChanges';
import type { DesignNode, FrameNode, PathNode, RectNode } from '../../../core/document/types';
import {
  deleteAnchorPoint,
  normalizePathNode,
  setAllPathCornerRadii,
  setAnchorCornerRadius,
  toggleAnchorPointType,
  updateParametricPathNode,
  worldDeltaToNodeLocalDelta,
  worldPointToNodeLocal,
} from '../../../core/document/vector';
import {
  buildAutoLayoutReorderPreviewNodes,
  buildAutoLayoutScrubPreviewNodes,
  computeScrubbedGap,
  computeScrubbedPadding,
  isAutoLayoutContainer,
  resolveAutoLayoutKeyboardReorder,
  resolveAutoLayoutReorder,
} from '../autoLayoutHandles';
import {
  getBounds,
  nodesGeometryChanged,
  resizeNodes,
  rotateNodesAroundPivot,
  snapPointToTargets,
  snapResizeBounds,
  snapTranslation,
} from '../geometry';
import type { CanvasToolHandler, CanvasToolId, CanvasToolTransition } from './types';
import { getCanvasUnitsPerPixel, rectangleBounds } from './geometry';

function computeAngleDeg(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function createCloneId(): string {
  const rand = globalThis.crypto?.randomUUID?.();
  return `node-${rand ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function getOrCreateCloneIdMap(
  nodes: readonly DesignNode[],
  existing?: Record<string, string>,
): Record<string, string> {
  if (existing) return existing;
  const map: Record<string, string> = {};
  for (const node of nodes) {
    map[node.id] = createCloneId();
  }
  return map;
}

function cloneNodesForDuplicate(
  nodes: readonly DesignNode[],
  dx: number,
  dy: number,
  idMap: Record<string, string>,
): DesignNode[] {
  return nodes.map((node) => {
    const clonedId = idMap[node.id] ?? createCloneId();
    const remappedParent = node.parentId && idMap[node.parentId] ? idMap[node.parentId] : node.parentId;
    const remappedClip = node.clipMaskBaseId && idMap[node.clipMaskBaseId] ? idMap[node.clipMaskBaseId] : node.clipMaskBaseId;
    return {
      ...node,
      id: clonedId,
      name: `${node.name} Copy`,
      x: Math.round((node.x + dx) * 100) / 100,
      y: Math.round((node.y + dy) * 100) / 100,
      ...(remappedParent !== undefined ? { parentId: remappedParent } : {}),
      ...(remappedClip !== undefined ? { clipMaskBaseId: remappedClip } : {}),
    };
  });
}

function computeCornerRadiusFromLocal(
  node: RectNode | FrameNode,
  corner: 'nw' | 'ne' | 'se' | 'sw',
  localPt: { x: number; y: number },
  resetZero: boolean,
): number {
  if (resetZero) return 0;
  const maxR = Math.floor(Math.min(node.width, node.height) / 2);
  const cornerX = corner.includes('e') ? node.width : 0;
  const cornerY = corner.includes('s') ? node.height : 0;
  const insetX = corner.includes('e') ? cornerX - localPt.x : localPt.x - cornerX;
  const insetY = corner.includes('s') ? cornerY - localPt.y : localPt.y - cornerY;
  const raw = Math.max(insetX, insetY);
  return Math.max(0, Math.min(maxR, Math.round(raw)));
}

function computeStarInnerRatioFromLocal(
  node: PathNode,
  localPt: { x: number; y: number },
): number {
  const rx = Math.max(4, node.width / 2);
  const ry = Math.max(4, node.height / 2);
  const nx = (localPt.x - rx) / rx;
  const ny = (localPt.y - ry) / ry;
  const ratio = Math.hypot(nx, ny);
  return Math.max(0.15, Math.min(0.9, Math.round(ratio * 100) / 100));
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
        ? 'Select a nested child directly or drag vector anchor points and Bezier handles (Delete removes anchor).'
        : 'Select, move (Shift locks axis, Alt+Drag clones), resize (Alt from center), and scrub Smart Handles.',
    group: 'selection',
    icon: uniformScale ? 'scale' : exactLayer ? 'directSelection' : 'cursor',
    onPointerDown(event, context): CanvasToolTransition {
      if (event.button !== 0) return {};

      // On-Canvas Smart Handles (Corner Radius, Star Inner Ratio, Draggable Rotation Pivot)
      if (event.smartHandleHit) {
        if (event.smartHandleHit.kind === 'pivot') {
          if ((event.detail ?? 0) >= 2) {
            return { customPivot: null, notice: 'Reset rotation pivot to selection center.', preventDefault: true };
          }
          return {
            session: {
              kind: 'smart-handle',
              pointerId: event.pointerId,
              handle: event.smartHandleHit,
              start: event.point,
              pivot: event.point,
              initialPivot: context.customPivot ?? null,
            },
            capturePointer: true,
            preventDefault: true,
          };
        }

        if (event.smartHandleHit.kind === 'corner-radius') {
          const targetId = event.smartHandleHit.nodeId;
          const target = context.selectableNodes.find(
            (node): node is RectNode | FrameNode =>
              node.id === targetId && (node.type === 'rect' || node.type === 'frame'),
          );
          if (target) {
            if (event.altKey || (event.detail ?? 0) >= 2) {
              const resetNode = { ...target, style: { ...target.style, radius: 0 } };
              return { commitNodes: [resetNode], selection: [target.id], preventDefault: true };
            }
            return {
              selection: [target.id],
              session: {
                kind: 'smart-handle',
                pointerId: event.pointerId,
                handle: event.smartHandleHit,
                start: event.point,
                node: target,
                hudLabel: `R: ${Math.round(target.style.radius ?? 0)}px`,
                hudPoint: event.point,
              },
              capturePointer: true,
              preventDefault: true,
            };
          }
        }

        if (event.smartHandleHit.kind === 'path-corner-radius') {
          const targetId = event.smartHandleHit.nodeId;
          const ptIdx = event.smartHandleHit.pointIndex;
          const target = context.selectableNodes.find(
            (node): node is PathNode => node.id === targetId && node.type === 'path',
          );
          if (target && target.points[ptIdx]) {
            if ((event.detail ?? 0) >= 2) {
              const resetNode = event.shiftKey
                ? setAllPathCornerRadii(target, 0)
                : setAnchorCornerRadius(target, ptIdx, 0);
              return { commitNodes: [resetNode], selection: [target.id], preventDefault: true };
            }
            return {
              selection: [target.id],
              session: {
                kind: 'smart-handle',
                pointerId: event.pointerId,
                handle: event.smartHandleHit,
                start: event.point,
                node: target,
                hudLabel: `P${ptIdx + 1} R: ${Math.round(target.points[ptIdx].cornerRadius ?? 0)}px`,
                hudPoint: event.point,
              },
              capturePointer: true,
              preventDefault: true,
            };
          }
        }

        if (event.smartHandleHit.kind === 'star-inner') {
          const targetId = event.smartHandleHit.nodeId;
          const target = context.selectableNodes.find(
            (node): node is PathNode => node.id === targetId && node.type === 'path' && node.shapeMeta?.kind === 'star',
          );
          if (target && target.shapeMeta?.kind === 'star') {
            return {
              selection: [target.id],
              session: {
                kind: 'smart-handle',
                pointerId: event.pointerId,
                handle: event.smartHandleHit,
                start: event.point,
                node: target,
                hudLabel: `Ratio: ${Math.round(target.shapeMeta.innerRatio * 100)}%`,
                hudPoint: event.point,
              },
              capturePointer: true,
              preventDefault: true,
            };
          }
        }

        if (event.smartHandleHit.kind === 'autolayout-padding') {
          const targetId = event.smartHandleHit.nodeId;
          const target = context.selectableNodes.find((node) => node.id === targetId);
          if (target && isAutoLayoutContainer(target)) {
            const edge = event.smartHandleHit.edge;
            if ((event.detail ?? 0) >= 2) {
              const reset = computeScrubbedPadding(target.layout, edge, 0, 0, {
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                resetZero: true,
              });
              const updatedNode: DesignNode = { ...target, layout: reset.nextLayout };
              const edgeLabel = event.shiftKey ? 'all padding' : event.altKey ? (edge === 'left' || edge === 'right' ? 'horizontal padding' : 'vertical padding') : `${edge} padding`;
              return {
                commitNodes: [updatedNode],
                selection: context.selectedNodeIds.length > 0 ? context.selectedNodeIds : [target.id],
                notice: `Reset ${edgeLabel} to 0px.`,
                preventDefault: true,
              };
            }
            const init = computeScrubbedPadding(target.layout, edge, 0, 0, {
              altKey: event.altKey,
              shiftKey: event.shiftKey,
            });
            return {
              session: {
                kind: 'smart-handle',
                pointerId: event.pointerId,
                handle: event.smartHandleHit,
                start: event.point,
                node: target,
                previewNode: target,
                hudLabel: init.hudLabel,
                hudPoint: event.point,
                activeEdges: init.activeEdges,
              },
              capturePointer: true,
              preventDefault: true,
            };
          }
        }

        if (event.smartHandleHit.kind === 'autolayout-gap') {
          const targetId = event.smartHandleHit.nodeId;
          const target = context.selectableNodes.find((node) => node.id === targetId);
          if (target && isAutoLayoutContainer(target)) {
            const axis = event.smartHandleHit.axis;
            if ((event.detail ?? 0) >= 2) {
              const reset = computeScrubbedGap(target.layout, axis, 0, 0, {
                shiftKey: event.shiftKey,
                resetZero: true,
              });
              const updatedNode: DesignNode = { ...target, layout: reset.nextLayout };
              return {
                commitNodes: [updatedNode],
                selection: context.selectedNodeIds.length > 0 ? context.selectedNodeIds : [target.id],
                notice: `Reset ${reset.hudLabel.split(':')[0].toLowerCase()} to 0px.`,
                preventDefault: true,
              };
            }
            const init = computeScrubbedGap(target.layout, axis, 0, 0, {
              shiftKey: event.shiftKey,
            });
            return {
              session: {
                kind: 'smart-handle',
                pointerId: event.pointerId,
                handle: event.smartHandleHit,
                start: event.point,
                node: target,
                previewNode: target,
                hudLabel: init.hudLabel,
                hudPoint: event.point,
                activeGapAxes: init.activeAxes,
              },
              capturePointer: true,
              preventDefault: true,
            };
          }
        }
      }

      // Direct Selection (A): live rotation-safe vector anchor & Bezier handle editing!
      if (exactLayer && event.anchorHit) {
        const pathNode = context.selectableNodes.find(
          (node): node is PathNode => node.id === event.anchorHit?.nodeId && node.type === 'path',
        );
        if (pathNode && event.anchorHit.pointIndex >= 0 && event.anchorHit.pointIndex < pathNode.points.length) {
          if (event.anchorHit.part === 'anchor' && (event.altKey || (event.detail ?? 0) >= 2)) {
            const toggled = toggleAnchorPointType(pathNode, event.anchorHit.pointIndex);
            return {
              commitNodes: [{ ...toggled, shapeMeta: undefined }],
              selection: [pathNode.id],
              activeAnchor: { nodeId: pathNode.id, pointIndex: event.anchorHit.pointIndex },
              preventDefault: true,
            };
          }
          return {
            selection: [pathNode.id],
            activeAnchor: { nodeId: pathNode.id, pointIndex: event.anchorHit.pointIndex },
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

      // Corner rotation zone (orbits around shared selection pivot or custom pivot!)
      if (event.rotateHandle && context.selectionBounds && context.selectedNodes.length) {
        const pivot = context.customPivot ?? {
          x: context.selectionBounds.x + context.selectionBounds.width / 2,
          y: context.selectionBounds.y + context.selectionBounds.height / 2,
        };
        const startAngle = computeAngleDeg(pivot, event.point);
        return {
          session: {
            kind: 'select-transform',
            pointerId: event.pointerId,
            mode: 'rotate',
            start: event.point,
            nodes: context.selectedNodes,
            bounds: context.selectionBounds,
            ids: context.selectedNodes.map((n) => n.id),
            pivot,
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
        return {
          activeAnchor: null,
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
      const modifier = event.ctrlKey || event.metaKey;
      const hasAncestors = getLayerAncestorIds(context.canvasNodes, hit.id).size > 0;
      const deepSelectSingle = !exactLayer && event.shiftKey && hasAncestors && !modifier;
      const toggleMulti = modifier || (event.shiftKey && !deepSelectSingle);
      const scope = exactLayer || deepSelectSingle ? [hit.id] : getCanvasClickSelectionIds(context.canvasNodes, hit.id);
      const groupSelected = scope.every((id) => context.selectedNodeIds.includes(id));

      // Double-clicking a non-text child inside a selected Auto-Layout container drills down into that child
      // so designers can immediately drag-reorder or arrow-reorder it on canvas.
      const hitParent = hit.parentId
        ? context.canvasNodes.find((node) => node.id === hit.parentId) ?? null
        : null;
      const doubleClickDrillIntoFlowChild =
        !exactLayer &&
        !toggleMulti &&
        (event.detail ?? 0) >= 2 &&
        hit.type !== 'text' &&
        isAutoLayoutContainer(hitParent) &&
        context.selectedNodeIds.includes(hitParent.id);

      // Clicking an already-selected single nested child keeps that child selected instead of popping back up to its parent.
      const alreadySingleSelected =
        !toggleMulti &&
        context.selectedNodeIds.length === 1 &&
        context.selectedNodeIds[0] === hit.id;

      let nextIds: string[];
      if (toggleMulti && groupSelected) {
        const removed = new Set(
          exactLayer ? scope : [...scope, ...getLayerAncestorIds(context.canvasNodes, hit.id)],
        );
        nextIds = context.selectedNodeIds.filter((id) => !removed.has(id));
        return { selection: nextIds, activeAnchor: null, preventDefault: true };
      } else if (toggleMulti) {
        nextIds = [...new Set([...context.selectedNodeIds, ...scope])];
      } else if (deepSelectSingle || doubleClickDrillIntoFlowChild || alreadySingleSelected) {
        nextIds = [hit.id];
      } else if (groupSelected && context.selectedNodeIds.length > 1) {
        // Clicking an already-selected member of a multi-selection keeps the multi-selection intact for dragging!
        nextIds = context.selectedNodeIds;
      } else {
        nextIds = scope;
      }

      // If dragging a single selected root whose parent is an Auto-Layout container, expand its own subtree for visual ghost preview
      // while preserving `nextIds` selection.
      const expandedMovingIds = nextIds.length === 1 && !exactLayer
        ? expandSelectedLayerIds(context.canvasNodes, nextIds)
        : nextIds;
      const moving = context.selectableNodes.filter((node) => expandedMovingIds.includes(node.id));
      const bounds = getBounds(moving);
      if (!moving.length || !bounds) return { selection: nextIds, preventDefault: true };

      // Check if we are dragging a single flow child root inside an Auto-Layout container
      const movingIdSet = new Set(moving.map((n) => n.id));
      const movingRoots = moving.filter((n) => !n.parentId || !movingIdSet.has(n.parentId));
      let autoLayoutReorder: { containerId: string; containerBounds: { x: number; y: number; width: number; height: number }; slot: null } | undefined;
      if (movingRoots.length === 1 && !uniformScale) {
        const dragRoot = movingRoots[0];
        const pos = dragRoot.layoutChild?.position;
        const outOfFlow = pos === 'absolute' || pos === 'fixed' || pos === 'sticky';
        if (!outOfFlow && dragRoot.parentId) {
          const parentContainer = context.canvasNodes.find((n) => n.id === dragRoot.parentId);
          if (isAutoLayoutContainer(parentContainer)) {
            autoLayoutReorder = {
              containerId: parentContainer.id,
              containerBounds: {
                x: parentContainer.x,
                y: parentContainer.y,
                width: parentContainer.width,
                height: parentContainer.height,
              },
              slot: null,
            };
          }
        }
      }

      return {
        selection: nextIds,
        activeAnchor: null,
        session: {
          kind: 'select-transform',
          pointerId: event.pointerId,
          mode: 'move',
          start: event.point,
          nodes: moving,
          bounds,
          ids: moving.map((n) => n.id),
          uniformScale,
          cloneMode: event.altKey,
          ...(autoLayoutReorder ? { autoLayoutReorder } : {}),
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

      const unitsPerPx = getCanvasUnitsPerPixel(context);

      if (session.kind === 'smart-handle') {
        if (session.handle.kind === 'pivot') {
          const targets = context.selectionBounds ? [context.selectionBounds] : [];
          const snapped = event.ctrlKey || event.metaKey
            ? { point: event.point, snapped: false }
            : snapPointToTargets(event.point, targets, 10 * unitsPerPx);
          return {
            session: {
              ...session,
              pivot: snapped.point,
              hudLabel: snapped.snapped ? 'Pivot (Snapped)' : 'Pivot',
              hudPoint: snapped.point,
            },
            customPivot: snapped.point,
            preventDefault: true,
          };
        }

        if (session.handle.kind === 'corner-radius' && session.node && (session.node.type === 'rect' || session.node.type === 'frame')) {
          const localPt = worldPointToNodeLocal(session.node, event.point);
          const nextRadius = computeCornerRadiusFromLocal(
            session.node,
            session.handle.corner,
            localPt,
            event.altKey,
          );
          const previewNode: RectNode | FrameNode = {
            ...session.node,
            style: { ...session.node.style, radius: nextRadius },
          };
          return {
            session: {
              ...session,
              previewNode,
              hudLabel: `R: ${nextRadius}px`,
              hudPoint: { x: event.point.x, y: event.point.y - 20 * unitsPerPx },
            },
            previewNodes: [previewNode],
            preventDefault: true,
          };
        }

        if (session.handle.kind === 'path-corner-radius' && session.node?.type === 'path') {
          const ptIdx = session.handle.pointIndex;
          const pt = session.node.points[ptIdx];
          if (pt) {
            const localPt = worldPointToNodeLocal(session.node, event.point);
            const n = session.node.points.length;
            const prev = session.node.points[(ptIdx - 1 + n) % n];
            const next = session.node.points[(ptIdx + 1) % n];
            const lenPrev = Math.hypot(prev.x - pt.x, prev.y - pt.y);
            const lenNext = Math.hypot(next.x - pt.x, next.y - pt.y);
            const maxR = Math.max(0, Math.floor(Math.min(lenPrev, lenNext) * 0.48));
            const rawDist = Math.hypot(localPt.x - pt.x, localPt.y - pt.y);
            const nextRadius = Math.max(0, Math.min(maxR, Math.round(rawDist)));
            const previewNode = event.shiftKey
              ? setAllPathCornerRadii(session.node, nextRadius)
              : setAnchorCornerRadius(session.node, ptIdx, nextRadius);
            return {
              session: {
                ...session,
                previewNode,
                hudLabel: event.shiftKey ? `All R: ${nextRadius}px` : `P${ptIdx + 1} R: ${nextRadius}px`,
                hudPoint: { x: event.point.x, y: event.point.y - 20 * unitsPerPx },
              },
              previewNodes: [previewNode],
              preventDefault: true,
            };
          }
        }

        if (session.handle.kind === 'star-inner' && session.node?.type === 'path' && session.node.shapeMeta?.kind === 'star') {
          const localPt = worldPointToNodeLocal(session.node, event.point);
          const nextRatio = computeStarInnerRatioFromLocal(session.node, localPt);
          const previewNode = updateParametricPathNode(session.node, {
            kind: 'star',
            spikes: session.node.shapeMeta.spikes,
            innerRatio: nextRatio,
          });
          return {
            session: {
              ...session,
              previewNode,
              hudLabel: `Ratio: ${Math.round(nextRatio * 100)}%`,
              hudPoint: { x: event.point.x, y: event.point.y - 20 * unitsPerPx },
            },
            previewNodes: [previewNode],
            preventDefault: true,
          };
        }

        if (session.handle.kind === 'autolayout-padding' && session.node && isAutoLayoutContainer(session.node)) {
          const dx = event.point.x - session.start.x;
          const dy = event.point.y - session.start.y;
          const result = computeScrubbedPadding(session.node.layout, session.handle.edge, dx, dy, {
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            snapKey: event.ctrlKey || event.metaKey,
          });
          const updatedContainer: DesignNode = { ...session.node, layout: result.nextLayout };
          const livePreview = buildAutoLayoutScrubPreviewNodes(
            context.document.nodes,
            updatedContainer,
            context.designTokens,
            context.document.width,
          );
          return {
            session: {
              ...session,
              previewNode: updatedContainer,
              previewNodes: livePreview,
              hudLabel: result.hudLabel,
              hudPoint: { x: event.point.x, y: event.point.y - 18 * unitsPerPx },
              activeEdges: result.activeEdges,
            },
            previewNodes: livePreview,
            preventDefault: true,
          };
        }

        if (session.handle.kind === 'autolayout-gap' && session.node && isAutoLayoutContainer(session.node)) {
          const dx = event.point.x - session.start.x;
          const dy = event.point.y - session.start.y;
          const result = computeScrubbedGap(session.node.layout, session.handle.axis, dx, dy, {
            shiftKey: event.shiftKey,
            snapKey: event.ctrlKey || event.metaKey,
          });
          const updatedContainer: DesignNode = { ...session.node, layout: result.nextLayout };
          const livePreview = buildAutoLayoutScrubPreviewNodes(
            context.document.nodes,
            updatedContainer,
            context.designTokens,
            context.document.width,
          );
          return {
            session: {
              ...session,
              previewNode: updatedContainer,
              previewNodes: livePreview,
              hudLabel: result.hudLabel,
              hudPoint: { x: event.point.x, y: event.point.y - 18 * unitsPerPx },
              activeGapAxes: result.activeAxes,
            },
            previewNodes: livePreview,
            preventDefault: true,
          };
        }

        return {};
      }

      if (session.kind === 'anchor-edit') {
        const localDelta = worldDeltaToNodeLocalDelta(
          session.node.rotation || 0,
          event.point.x - session.start.x,
          event.point.y - session.start.y,
        );
        const localPointer = worldPointToNodeLocal(session.node, event.point);
        const points = session.node.points.map((pt, index) => {
          if (index !== session.pointIndex) return pt;
          if (session.part === 'anchor') {
            return {
              ...pt,
              x: Math.round((pt.x + localDelta.x) * 100) / 100,
              y: Math.round((pt.y + localDelta.y) * 100) / 100,
              ...(pt.handleIn ? { handleIn: { x: Math.round((pt.handleIn.x + localDelta.x) * 100) / 100, y: Math.round((pt.handleIn.y + localDelta.y) * 100) / 100 } } : {}),
              ...(pt.handleOut ? { handleOut: { x: Math.round((pt.handleOut.x + localDelta.x) * 100) / 100, y: Math.round((pt.handleOut.y + localDelta.y) * 100) / 100 } } : {}),
            };
          }
          const localX = Math.round(localPointer.x * 100) / 100;
          const localY = Math.round(localPointer.y * 100) / 100;
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
        const previewNode = normalizePathNode({ ...session.node, points, shapeMeta: undefined });
        return {
          session: { ...session, previewNode },
          previewNodes: [previewNode],
          preventDefault: true,
        };
      }

      if (session.kind !== 'select-transform') return {};

      if (session.mode === 'rotate') {
        const pivot = session.pivot ?? {
          x: session.bounds.x + session.bounds.width / 2,
          y: session.bounds.y + session.bounds.height / 2,
        };
        let deltaAngle = computeAngleDeg(pivot, event.point) - (session.startAngle ?? 0);
        if (event.shiftKey) {
          deltaAngle = Math.round(deltaAngle / 15) * 15;
        }
        const roundedDelta = Math.round(deltaAngle * 10) / 10;
        const previewNodes = rotateNodesAroundPivot(session.nodes, roundedDelta, pivot);
        return {
          session: { ...session, currentAngle: roundedDelta, previewNodes },
          previewNodes,
          guides: [],
          preventDefault: true,
        };
      }

      let dx = event.point.x - session.start.x;
      let dy = event.point.y - session.start.y;
      const deadzone = Math.min(0.25, 0.25 * unitsPerPx);
      if (Math.abs(dx) + Math.abs(dy) < deadzone && !session.previewNodes) return {};

      const bypassSnap = event.ctrlKey || event.metaKey;
      const snapTolerance = bypassSnap ? 0 : 8 * unitsPerPx;

      if (session.mode === 'resize' && session.handle) {
        const isCorner =
          session.handle === 'nw' ||
          session.handle === 'ne' ||
          session.handle === 'se' ||
          session.handle === 'sw';
        const nodeLocksAspect = session.nodes.some((node) => Boolean(node.aspectRatioLocked));
        const lockAspect = isCorner || Boolean(session.uniformScale) || event.shiftKey || nodeLocksAspect;
        const resizeTargets = context.otherNodes.filter((node) => !session.ids.includes(node.id));
        const snappedResize = snapResizeBounds(
          session.bounds,
          session.handle,
          dx,
          dy,
          { x: 0, y: 0, width: context.document.width, height: context.document.height },
          resizeTargets,
          snapTolerance,
          { lockAspect, fromCenter: event.altKey },
        );
        const resizedRaw = resizeNodes(
          session.nodes,
          session.bounds,
          session.handle,
          snappedResize.dx,
          snappedResize.dy,
          {
            uniformScale: Boolean(session.uniformScale),
            fromCenter: event.altKey,
            constrainAspect: event.shiftKey || nodeLocksAspect,
          },
        );
        const affectsWidth = session.handle !== 'n' && session.handle !== 's';
        const affectsHeight = session.handle !== 'e' && session.handle !== 'w';
        const previewNodes = resizedRaw.map((node, index) => {
          const orig = session.nodes[index];
          if (!node.layoutChild || !orig) return node;
          const widthChanged = affectsWidth && Math.abs(node.width - orig.width) > 0.01;
          const heightChanged = affectsHeight && Math.abs(node.height - orig.height) > 0.01;
          if (!widthChanged && !heightChanged) return node;
          const nextChild = { ...node.layoutChild };
          let mutated = false;
          if (widthChanged) {
            if (nextChild.widthValue !== undefined) {
              delete nextChild.widthValue;
              mutated = true;
            }
            if (nextChild.widthMode && nextChild.widthMode !== 'fixed') {
              nextChild.widthMode = 'fixed';
              mutated = true;
            }
          }
          if (heightChanged) {
            if (nextChild.heightValue !== undefined) {
              delete nextChild.heightValue;
              mutated = true;
            }
            if (nextChild.heightMode && nextChild.heightMode !== 'fixed') {
              nextChild.heightMode = 'fixed';
              mutated = true;
            }
          }
          return mutated ? { ...node, layoutChild: nextChild } : node;
        });
        const nextBounds = getBounds(previewNodes);
        return {
          session: {
            ...session,
            previewNodes,
            hudLabel: nextBounds ? `${Math.round(nextBounds.width)} × ${Math.round(nextBounds.height)}` : undefined,
          },
          previewNodes,
          guides: snappedResize.guides,
          preventDefault: true,
        };
      }

      // Shift locks Move strictly to dominant horizontal or vertical axis
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }

      const cloneMode = Boolean(event.altKey);
      const snapTargets = cloneMode
        ? context.otherNodes
        : context.otherNodes.filter((node) => !session.ids.includes(node.id));
      const snapped = snapTranslation(
        session.nodes,
        dx,
        dy,
        { x: 0, y: 0, width: context.document.width, height: context.document.height },
        snapTargets,
        snapTolerance,
      );

      if (cloneMode) {
        const cloneIdMap = getOrCreateCloneIdMap(session.nodes, session.cloneIdMap);
        const clonedPreview = cloneNodesForDuplicate(session.nodes, snapped.dx, snapped.dy, cloneIdMap);
        return {
          session: {
            ...session,
            cloneMode: true,
            cloneIdMap,
            previewNodes: clonedPreview,
            hudLabel: `Clone · ΔX ${Math.round(snapped.dx)} · ΔY ${Math.round(snapped.dy)}`,
            ...(session.autoLayoutReorder
              ? { autoLayoutReorder: { ...session.autoLayoutReorder, slot: null } }
              : {}),
          },
          previewNodes: null,
          previewCreateNodes: clonedPreview,
          guides: snapped.guides,
          preventDefault: true,
        };
      }

      // On-Canvas Auto-Layout Drag-to-Reorder when dragging a flow child inside its Flex/Grid parent
      if (session.autoLayoutReorder) {
        const parentContainer = context.canvasNodes.find((n) => n.id === session.autoLayoutReorder?.containerId);
        const sessionIdSet = new Set(session.nodes.map((n) => n.id));
        const dragRoot = session.nodes.find((n) => !n.parentId || !sessionIdSet.has(n.parentId));
        if (parentContainer && dragRoot) {
          const reorderSlot = resolveAutoLayoutReorder(
            parentContainer,
            dragRoot,
            event.point,
            context.canvasNodes,
          );
          if (reorderSlot) {
            const ghostRoot: DesignNode = {
              ...dragRoot,
              x: Math.round((dragRoot.x + dx) * 100) / 100,
              y: Math.round((dragRoot.y + dy) * 100) / 100,
            };
            const liveSiblings = buildAutoLayoutReorderPreviewNodes(
              context.document.nodes,
              ghostRoot,
              reorderSlot,
              context.designTokens,
              context.document.width,
            );
            // Offset any nested children of `dragRoot` along with `ghostRoot`
            const liveById = new Map(liveSiblings.map((n) => [n.id, n]));
            for (const movedNode of session.nodes) {
              if (movedNode.id !== dragRoot.id) {
                liveById.set(movedNode.id, {
                  ...movedNode,
                  x: Math.round((movedNode.x + dx) * 100) / 100,
                  y: Math.round((movedNode.y + dy) * 100) / 100,
                });
              }
            }
            const previewNodes = Array.from(liveById.values());
            return {
              session: {
                ...session,
                cloneMode: false,
                previewNodes,
                hudLabel: undefined,
                autoLayoutReorder: {
                  ...session.autoLayoutReorder,
                  containerBounds: {
                    x: parentContainer.x,
                    y: parentContainer.y,
                    width: parentContainer.width,
                    height: parentContainer.height,
                  },
                  slot: reorderSlot,
                },
              },
              previewNodes,
              previewCreateNodes: null,
              guides: [],
              preventDefault: true,
            };
          }
        }
      }

      const previewNodes = session.nodes.map((node) => ({
        ...node,
        x: Math.round((node.x + snapped.dx) * 100) / 100,
        y: Math.round((node.y + snapped.dy) * 100) / 100,
      }));
      return {
        session: {
          ...session,
          cloneMode: false,
          previewNodes,
          hudLabel: undefined,
          ...(session.autoLayoutReorder
            ? { autoLayoutReorder: { ...session.autoLayoutReorder, slot: null } }
            : {}),
        },
        previewNodes,
        previewCreateNodes: null,
        guides: snapped.guides,
        preventDefault: true,
      };
    },

    onPointerUp(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.pointerId !== event.pointerId) return {};
      if (session.kind === 'smart-handle') {
        if (session.handle.kind === 'pivot') {
          return {
            session: null,
            notice: 'Updated custom rotation pivot (double-click pivot to reset).',
            preventDefault: true,
          };
        }
        if (
          (session.handle.kind === 'autolayout-padding' || session.handle.kind === 'autolayout-gap') &&
          session.node &&
          session.previewNode
        ) {
          const changed = classifyNodeChange(session.node, session.previewNode).hasAnyChange;
          return {
            ...(changed ? { commitNodes: [session.previewNode] } : {}),
            session: null,
            previewNodes: null,
            guides: [],
            preventDefault: true,
          };
        }
        const changed = session.node && session.previewNode && nodesGeometryChanged([session.node], [session.previewNode]);
        return {
          ...(changed && session.previewNode ? { commitNodes: [session.previewNode] } : {}),
          session: null,
          previewNodes: null,
          guides: [],
          preventDefault: true,
        };
      }
      if (session.kind === 'anchor-edit') {
        const changed = session.previewNode && nodesGeometryChanged([session.node], [session.previewNode]);
        return {
          ...(changed && session.previewNode ? { commitNodes: [session.previewNode] } : {}),
          session: null,
          previewNodes: null,
          guides: [],
          preventDefault: true,
        };
      }
      if (session.kind === 'marquee-selection') {
        const box = rectangleBounds(session.start, event.point);
        const unitsPerPx = getCanvasUnitsPerPixel(context);
        const clickThreshold = Math.max(0.5, Math.min(4, 1.5 * unitsPerPx));
        const dragged = box.width > clickThreshold || box.height > clickThreshold;
        if (!dragged) {
          const selection = session.additive || session.subtractive ? session.initialIds : [];
          return { selection, session: null, previewNodes: null, previewCreateNodes: null, guides: [], preventDefault: true };
        }
        const ids = context.selectableNodes
          .filter(
            (node) =>
              node.x <= box.x + box.width &&
              node.x + node.width >= box.x &&
              node.y <= box.y + box.height &&
              node.y + node.height >= box.y,
          )
          .map((node) => node.id);
        const expanded = exactLayer ? ids : expandSelectedLayerIds(context.canvasNodes, ids);
        let selection: string[];
        if (session.subtractive) {
          const removed = new Set(expanded);
          if (!exactLayer) {
            ids.forEach((id) => getLayerAncestorIds(context.canvasNodes, id).forEach((ancestor) => removed.add(ancestor)));
          }
          selection = session.initialIds.filter((id) => !removed.has(id));
        } else if (session.additive) {
          selection = [...new Set([...session.initialIds, ...expanded])];
        } else {
          selection = expanded;
        }
        return { selection, session: null, previewNodes: null, previewCreateNodes: null, guides: [], preventDefault: true };
      }
      if (session.kind === 'select-transform') {
        if (session.cloneMode && session.previewNodes && session.previewNodes.length > 0) {
          const moved = session.nodes.some((orig, idx) => {
            const clone = session.previewNodes?.[idx];
            return clone && (Math.abs(orig.x - clone.x) > 0.01 || Math.abs(orig.y - clone.y) > 0.01 || Math.abs((orig.rotation || 0) - (clone.rotation || 0)) > 0.01);
          });
          if (!moved) {
            return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], preventDefault: true };
          }
          return {
            createNodes: session.previewNodes,
            selection: session.previewNodes.map((n) => n.id),
            session: null,
            previewNodes: null,
            previewCreateNodes: null,
            guides: [],
            notice: `Duplicated ${session.previewNodes.length} layer${session.previewNodes.length === 1 ? '' : 's'} with Alt+Drag.`,
            preventDefault: true,
          };
        }
        if (session.autoLayoutReorder?.slot) {
          const slot = session.autoLayoutReorder.slot;
          return {
            ...(slot.move
              ? {
                  moveLayer: {
                    nodeId: slot.draggedId,
                    targetId: slot.move.targetId,
                    position: slot.move.position,
                  },
                  notice: `Reordered layer to slot #${slot.displaySlotNumber}.`,
                }
              : {}),
            session: null,
            previewNodes: null,
            previewCreateNodes: null,
            guides: [],
            preventDefault: true,
          };
        }
        const changed = session.previewNodes && nodesGeometryChanged(session.nodes, session.previewNodes);
        return {
          ...(changed && session.previewNodes ? { commitNodes: session.previewNodes } : {}),
          session: null,
          previewNodes: null,
          previewCreateNodes: null,
          guides: [],
          preventDefault: true,
        };
      }
      return {};
    },

    onPointerCancel(_event, context) {
      if (!context.session) return {};
      const restorePivot =
        context.session.kind === 'smart-handle' && context.session.handle.kind === 'pivot'
          ? { customPivot: context.session.initialPivot ?? null }
          : {};
      return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], ...restorePivot };
    },

    onKeyDown(event, context): CanvasToolTransition {
      if (event.key === 'Escape' && context.session) {
        const restorePivot =
          context.session.kind === 'smart-handle' && context.session.handle.kind === 'pivot'
            ? { customPivot: context.session.initialPivot ?? null }
            : {};
        return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], ...restorePivot, preventDefault: true };
      }
      // Direct Selection (A): Delete / Backspace deletes active anchor point cleanly!
      if (exactLayer && !context.session && (event.key === 'Backspace' || event.key === 'Delete') && context.activeAnchor) {
        const target = context.selectableNodes.find(
          (node): node is PathNode => node.id === context.activeAnchor?.nodeId && node.type === 'path',
        );
        if (target) {
          const updated = deleteAnchorPoint(target, context.activeAnchor.pointIndex);
          if (updated) {
            return {
              commitNodes: [updated],
              activeAnchor: null,
              notice: 'Deleted anchor point.',
              preventDefault: true,
            };
          }
          return { notice: 'Cannot delete anchor: minimum contour points reached.', preventDefault: true };
        }
      }
      // Parametric Star/Polygon live spikes/sides tuning via Alt+ArrowUp / Alt+ArrowDown when selected
      if (!context.session && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && context.selectedNodes.length === 1) {
        const single = context.selectedNodes[0];
        if (single.type === 'path' && single.shapeMeta) {
          const step = event.key === 'ArrowUp' ? 1 : -1;
          if (single.shapeMeta.kind === 'polygon') {
            const nextSides = Math.max(3, Math.min(24, single.shapeMeta.sides + step));
            const updated = updateParametricPathNode(single, { kind: 'polygon', sides: nextSides });
            return { commitNodes: [updated], notice: `Polygon sides: ${nextSides}`, preventDefault: true };
          }
          if (single.shapeMeta.kind === 'star') {
            const nextSpikes = Math.max(3, Math.min(24, single.shapeMeta.spikes + step));
            const updated = updateParametricPathNode(single, {
              kind: 'star',
              spikes: nextSpikes,
              innerRatio: single.shapeMeta.innerRatio,
            });
            return { commitNodes: [updated], notice: `Star points: ${nextSpikes}`, preventDefault: true };
          }
        }
      }
      // Precision Arrow-Key Nudge (1px, or 10px with Shift) for selected layers or active Bezier anchor!
      if (
        !context.session &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;

        if (exactLayer && context.activeAnchor) {
          const targetPath = context.selectableNodes.find(
            (node): node is PathNode => node.id === context.activeAnchor?.nodeId && node.type === 'path',
          );
          if (targetPath && context.activeAnchor.pointIndex >= 0 && context.activeAnchor.pointIndex < targetPath.points.length) {
            const localDelta = worldDeltaToNodeLocalDelta(targetPath.rotation || 0, dx, dy);
            const points = targetPath.points.map((pt, index) => {
              if (index !== context.activeAnchor?.pointIndex) return pt;
              return {
                ...pt,
                x: Math.round((pt.x + localDelta.x) * 100) / 100,
                y: Math.round((pt.y + localDelta.y) * 100) / 100,
                ...(pt.handleIn ? { handleIn: { x: Math.round((pt.handleIn.x + localDelta.x) * 100) / 100, y: Math.round((pt.handleIn.y + localDelta.y) * 100) / 100 } } : {}),
                ...(pt.handleOut ? { handleOut: { x: Math.round((pt.handleOut.x + localDelta.x) * 100) / 100, y: Math.round((pt.handleOut.y + localDelta.y) * 100) / 100 } } : {}),
              };
            });
            const normalized = normalizePathNode({ ...targetPath, points, shapeMeta: undefined });
            return {
              commitNodes: [normalized],
              activeAnchor: context.activeAnchor,
              preventDefault: true,
            };
          }
        }

        if (context.selectedNodes.length > 0) {
          // Single flow child inside an Auto-Layout container reorders along the layout axis on Arrow keys!
          if (!event.shiftKey) {
            const selectedSet = new Set(context.selectedNodes.map((n) => n.id));
            const selectedRoots = context.selectedNodes.filter((n) => !n.parentId || !selectedSet.has(n.parentId));
            if (selectedRoots.length === 1 && selectedRoots[0].parentId) {
              const singleChild = selectedRoots[0];
              const parentContainer = context.canvasNodes.find((n) => n.id === singleChild.parentId);
              if (isAutoLayoutContainer(parentContainer)) {
                const reorder = resolveAutoLayoutKeyboardReorder(
                  parentContainer,
                  singleChild,
                  event.key,
                  context.canvasNodes,
                );
                if (reorder) {
                  return {
                    moveLayer: {
                      nodeId: singleChild.id,
                      targetId: reorder.targetId,
                      position: reorder.position,
                    },
                    notice: `Reordered layer to slot #${reorder.displaySlotNumber}.`,
                    preventDefault: true,
                  };
                }
                // Consume arrow key cleanly on flow children so auto-layout doesn't create dead coordinate nudges
                const pos = singleChild.layoutChild?.position;
                if (pos !== 'absolute' && pos !== 'fixed' && pos !== 'sticky') {
                  return { preventDefault: true };
                }
              }
            }
          }

          const nudged = context.selectedNodes.map((node) => ({
            ...node,
            x: Math.round((node.x + dx) * 100) / 100,
            y: Math.round((node.y + dy) * 100) / 100,
          }));
          return {
            commitNodes: nudged,
            preventDefault: true,
          };
        }
      }
      return {};
    },

    renderOverlay(context) {
      const session = context.session;
      if (session?.kind === 'marquee-selection') {
        return { kind: 'marquee', bounds: rectangleBounds(session.start, session.current) };
      }
      if (session?.kind === 'smart-handle' && session.hudLabel && session.hudPoint) {
        const variant =
          session.handle.kind === 'pivot'
            ? 'rotate'
            : session.handle.kind === 'autolayout-padding' || session.handle.kind === 'autolayout-gap'
              ? 'spacing'
              : 'default';
        return {
          kind: 'smart-hud',
          x: session.hudPoint.x,
          y: session.hudPoint.y,
          text: session.hudLabel,
          variant,
        };
      }
      if (session?.kind === 'select-transform' && session.mode === 'rotate') {
        const center = session.pivot ?? {
          x: session.bounds.x + session.bounds.width / 2,
          y: session.bounds.y + session.bounds.height / 2,
        };
        const radius = Math.max(32, Math.hypot(session.bounds.width, session.bounds.height) / 2);
        return { kind: 'rotate-ring', center, radius, angleDeg: session.currentAngle ?? 0 };
      }
      if (session?.kind === 'select-transform' && session.autoLayoutReorder?.slot) {
        return {
          kind: 'autolayout-reorder',
          containerBounds: session.autoLayoutReorder.containerBounds,
          slot: session.autoLayoutReorder.slot,
        };
      }
      if (session?.kind === 'select-transform' && session.hudLabel && session.previewNodes?.length) {
        const b = getBounds(session.previewNodes);
        if (b) {
          return {
            kind: 'smart-hud',
            x: b.x + b.width / 2,
            y: b.y + b.height + 18 * getCanvasUnitsPerPixel(context),
            text: session.hudLabel,
            variant: 'default',
          };
        }
      }
      return null;
    },

    cursorStyle(context) {
      if (context.session?.kind === 'anchor-edit') return 'crosshair';
      if (context.session?.kind === 'smart-handle') {
        if (context.session.handle.kind === 'autolayout-padding') {
          return context.session.handle.edge === 'top' || context.session.handle.edge === 'bottom'
            ? 'ns-resize'
            : 'ew-resize';
        }
        if (context.session.handle.kind === 'autolayout-gap') {
          return context.session.handle.axis === 'horizontal' ? 'ew-resize' : 'ns-resize';
        }
        return 'grabbing';
      }
      if (context.session?.kind === 'select-transform') {
        if (context.session.mode === 'rotate') return 'grabbing';
        if (context.session.cloneMode) return 'copy';
        if (context.session.autoLayoutReorder?.slot) return 'grabbing';
        if (context.session.mode === 'move') return 'move';
        const h = context.session.handle;
        if (h === 'n' || h === 's') return 'ns-resize';
        if (h === 'e' || h === 'w') return 'ew-resize';
        if (h === 'ne' || h === 'sw') return 'nesw-resize';
        return 'nwse-resize';
      }
      return 'default';
    },
  };
}

export const selectTool = createSelectTool('select', false, false);
export const directSelectionTool = createSelectTool('direct-selection', true, false);
export const scaleTool = createSelectTool('scale', false, true);

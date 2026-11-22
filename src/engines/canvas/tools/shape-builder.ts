import {
  applyShapeBuilderAction,
  decomposeNodesForShapeBuilder,
  hitTestPlanarFacesAlongStroke,
} from '../../../core/document/vector';
import type { CanvasToolHandler, CanvasToolTransition } from './types';

function createBuilderId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `sb-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/**
 * Interactive Shape Builder Tool (`Shift+M`):
 * - Select 2+ overlapping shapes or vector paths on Main or Component Canvas.
 * - Hover illuminates atomic planar regions decomposed in real time.
 * - Drag across regions to fuse them cleanly into one seamless vector silhouette.
 * - Hold `Alt` and click or drag to punch out / delete unwanted regions cleanly.
 * - Commits as a single atomic Undo/Redo step!
 */
export const shapeBuilderTool: CanvasToolHandler = {
  id: 'shape-builder',
  label: 'Shape Builder',
  shortcut: 'Shift+M',
  group: 'vector',
  icon: 'shapeBuilder',
  description: 'Drag across overlapping selected shapes to merge regions; hold Alt to punch out regions.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const { candidates, arrangement } = decomposeNodesForShapeBuilder(context.selectedNodes);
    if (candidates.length < 2 || arrangement.faces.length === 0) {
      if (event.targetNodeId) {
        const hit = context.selectableNodes.find((node) => node.id === event.targetNodeId);
        if (hit && (hit.type === 'rect' || hit.type === 'ellipse' || hit.type === 'frame' || hit.type === 'path')) {
          const nextIds = event.shiftKey
            ? [...new Set([...context.selectedNodeIds, hit.id])]
            : [hit.id];
          return {
            selection: nextIds,
            notice:
              nextIds.length >= 2
                ? `Selected ${nextIds.length} shapes — drag across overlapping regions to merge (Alt to punch).`
                : 'Selected 1 shape — Shift+Click another overlapping shape to start Shape Builder.',
            preventDefault: true,
          };
        }
      }
      return {
        notice: 'Select at least 2 shapes or vector paths first to use Shape Builder.',
        preventDefault: true,
      };
    }

    const mode = event.altKey ? 'punch' : 'merge';
    const touchedFaceIds = hitTestPlanarFacesAlongStroke(arrangement, [event.point]);

    return {
      session: {
        kind: 'shape-builder',
        pointerId: event.pointerId,
        mode,
        candidateIds: candidates.map((node) => node.id),
        candidates,
        arrangement,
        strokePoints: [event.point],
        touchedFaceIds,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },

  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'shape-builder' || session.pointerId !== event.pointerId) {
      return {};
    }
    const last = session.strokePoints[session.strokePoints.length - 1];
    const nextStroke =
      Math.hypot(event.point.x - last.x, event.point.y - last.y) >= 2
        ? [...session.strokePoints, event.point]
        : session.strokePoints;
    const newlyHit = hitTestPlanarFacesAlongStroke(session.arrangement, [last, event.point]);
    const touchedFaceIds = [...new Set([...session.touchedFaceIds, ...newlyHit])];

    return {
      session: {
        ...session,
        mode: event.altKey ? 'punch' : 'merge',
        strokePoints: nextStroke,
        touchedFaceIds,
      },
      preventDefault: true,
    };
  },

  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'shape-builder' || session.pointerId !== event.pointerId) {
      return {};
    }
    const last = session.strokePoints[session.strokePoints.length - 1];
    const finalHit = hitTestPlanarFacesAlongStroke(session.arrangement, [last, event.point]);
    const touchedFaceIds = [...new Set([...session.touchedFaceIds, ...finalHit])];

    if (touchedFaceIds.length === 0) {
      return { session: null, preventDefault: true };
    }

    // For merge mode, require at least 1 face (if 2+ faces touched, merges them; if 1 face clicked in merge mode, extracts it cleanly)
    const resultNodes = applyShapeBuilderAction(
      session.candidates,
      session.arrangement,
      touchedFaceIds,
      session.mode,
      createBuilderId,
    );

    if (!resultNodes) {
      return { session: null, preventDefault: true };
    }

    return {
      replaceNodes: {
        removeIds: session.candidateIds,
        insertNodes: resultNodes,
      },
      selection: resultNodes.map((node) => node.id),
      session: null,
      notice:
        session.mode === 'punch'
          ? `Shape Builder punched ${touchedFaceIds.length} region${touchedFaceIds.length === 1 ? '' : 's'}.`
          : `Shape Builder merged ${touchedFaceIds.length} region${touchedFaceIds.length === 1 ? '' : 's'}.`,
      preventDefault: true,
    };
  },

  onPointerCancel(_event, context) {
    return context.session?.kind === 'shape-builder' ? { session: null } : {};
  },

  onKeyDown(event, context) {
    if (event.key === 'Escape' && context.session?.kind === 'shape-builder') {
      return { session: null, preventDefault: true };
    }
    return {};
  },

  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'shape-builder') return null;
    return {
      kind: 'shape-builder',
      arrangement: session.arrangement,
      touchedFaceIds: session.touchedFaceIds,
      strokePoints: session.strokePoints,
      mode: session.mode,
    };
  },

  cursorStyle() {
    return 'crosshair';
  },
};

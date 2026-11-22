import { createVectorPathNode } from '../../../core/document/factory';
import type { PathNode, VectorAnchorPoint } from '../../../core/document/types';
import {
  createAnchorId,
  findNearestSegmentHit,
  fitCatmullRomToBezier,
  insertAnchorOnPathSegment,
  normalizePathNode,
  simplifyFreehandToPathPoints,
  smoothPathAnchors,
  splitPathAtLocalPoint,
  toggleAnchorPointType,
  worldPointToNodeLocal,
} from '../../../core/document/vector';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolHandler,
  type CanvasToolTransition,
  type PenDraftSession,
} from './types';

function createNodeId(prefix = 'node'): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function snapAngle45(origin: { x: number; y: number }, target: { x: number; y: number }): { x: number; y: number } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return target;
  const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.round((origin.x + Math.cos(snapped) * dist) * 100) / 100,
    y: Math.round((origin.y + Math.sin(snapped) * dist) * 100) / 100,
  };
}

function finalizePenDraft(
  session: PenDraftSession,
  closed: boolean,
  context: CanvasToolContext,
): CanvasToolTransition {
  if (session.points.length < 2) {
    return { session: null, preventDefault: true };
  }
  const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
  const isTransparent = context.document.background === '#00000000' || context.document.background === 'transparent';
  const strokeColor = isTransparent && opts.strokeColor === '#20212A' ? '#E6EAF2' : opts.strokeColor;
  const finalPoints = session.mode === 'curvature' && session.rawCurvaturePoints
    ? fitCatmullRomToBezier(session.rawCurvaturePoints, closed, 0.25)
    : session.points;

  // Honor user-configured strokeWidth on closed paths too (no longer silently forcing 0!)
  const strokeWidth = closed
    ? Math.max(0, Number.isFinite(opts.strokeWidth) ? opts.strokeWidth : 0)
    : Math.max(2, Number.isFinite(opts.strokeWidth) ? opts.strokeWidth : 2);

  const node = createVectorPathNode(finalPoints, {
    name: session.mode === 'curvature' ? 'Curvature Path' : 'Vector Path',
    closed,
    pathKind: session.mode,
    fill: closed ? opts.fillColor : 'none',
    stroke: strokeWidth > 0 ? strokeColor : '#00000000',
    strokeWidth,
  });

  return {
    createNodes: [node],
    selection: [node.id],
    session: null,
    notice: closed ? 'Closed vector path created.' : 'Vector path created.',
    preventDefault: true,
  };
}

/**
 * Adobe Illustrator & Figma Pen Tool (P):
 * - Click to add sharp corner anchors (Shift snaps 45° from previous anchor).
 * - Click-drag to pull symmetric cubic Bezier handles (Shift snaps 45°, Alt breaks cusp).
 * - Click the first anchor (highlighted close ring) to close the shape.
 * - Double-click or press Enter to commit an open path; Escape discards draft; Backspace undoes last anchor.
 */
export const penTool: CanvasToolHandler = {
  id: 'pen',
  label: 'Pen',
  shortcut: 'P',
  group: 'vector',
  icon: 'pen',
  description: 'Click for corners, drag for curves. Shift snaps 45°, Alt breaks cusp handle, Enter commits, Esc discards.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const current = context.session?.kind === 'pen-draft' && context.session.mode === 'pen' ? context.session : null;

    if (!current) {
      const first: VectorAnchorPoint = {
        id: createAnchorId('pen'),
        x: Math.round(event.point.x * 100) / 100,
        y: Math.round(event.point.y * 100) / 100,
        pointType: 'corner',
      };
      return {
        session: {
          kind: 'pen-draft',
          mode: 'pen',
          points: [first],
          draggingHandle: true,
          pointerId: event.pointerId,
          cursor: event.point,
          hoverClose: false,
        },
        capturePointer: true,
        preventDefault: true,
      };
    }

    // Close path if clicking near first anchor with >= 3 points
    const first = current.points[0];
    const closeThreshold = 12 / Math.max(0.35, context.zoom);
    if (current.points.length >= 3 && Math.hypot(event.point.x - first.x, event.point.y - first.y) <= closeThreshold) {
      return finalizePenDraft(current, true, context);
    }

    // Double-click finishes open path cleanly
    if ((event.detail ?? 0) >= 2 && current.points.length >= 2) {
      return finalizePenDraft(current, false, context);
    }

    const prev = current.points[current.points.length - 1];
    // Illustrator-style handle retraction: clicking directly on the last anchor retracts its outgoing curve handle
    const retractThreshold = 10 / Math.max(0.35, context.zoom);
    if (prev && prev.handleOut && Math.hypot(event.point.x - prev.x, event.point.y - prev.y) <= retractThreshold) {
      const retracted: VectorAnchorPoint = {
        ...prev,
        handleOut: undefined,
        pointType: 'corner',
      };
      return {
        session: {
          ...current,
          points: [...current.points.slice(0, -1), retracted],
          draggingHandle: false,
          pointerId: null,
          cursor: event.point,
        },
        notice: 'Retracted outgoing handle for crisp corner transition.',
        preventDefault: true,
      };
    }

    const placed = event.shiftKey && prev ? snapAngle45(prev, event.point) : event.point;
    const nextAnchor: VectorAnchorPoint = {
      id: createAnchorId('pen'),
      x: Math.round(placed.x * 100) / 100,
      y: Math.round(placed.y * 100) / 100,
      pointType: 'corner',
    };
    return {
      session: {
        ...current,
        points: [...current.points, nextAnchor],
        draggingHandle: true,
        pointerId: event.pointerId,
        cursor: placed,
        hoverClose: false,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'pen') return {};

    if (session.draggingHandle && session.pointerId === event.pointerId && session.points.length > 0) {
      const lastIndex = session.points.length - 1;
      const anchor = session.points[lastIndex];
      const handleTarget = event.shiftKey ? snapAngle45(anchor, event.point) : event.point;
      const dx = handleTarget.x - anchor.x;
      const dy = handleTarget.y - anchor.y;
      if (Math.hypot(dx, dy) >= 3) {
        const updated: VectorAnchorPoint = event.altKey
          ? {
              // Alt mid-drag breaks symmetry into independent cusp handle!
              ...anchor,
              handleOut: { x: Math.round((anchor.x + dx) * 100) / 100, y: Math.round((anchor.y + dy) * 100) / 100 },
              pointType: 'corner',
            }
          : {
              ...anchor,
              handleOut: { x: Math.round((anchor.x + dx) * 100) / 100, y: Math.round((anchor.y + dy) * 100) / 100 },
              handleIn: { x: Math.round((anchor.x - dx) * 100) / 100, y: Math.round((anchor.y - dy) * 100) / 100 },
              pointType: 'symmetric',
            };
        const points = [...session.points.slice(0, lastIndex), updated];
        return { session: { ...session, points, cursor: handleTarget }, preventDefault: true };
      }
      return { session: { ...session, cursor: handleTarget }, preventDefault: true };
    }

    const prev = session.points[session.points.length - 1];
    const cursor = event.shiftKey && prev ? snapAngle45(prev, event.point) : event.point;
    const first = session.points[0];
    const closeThreshold = 12 / Math.max(0.35, context.zoom);
    const hoverClose = session.points.length >= 3 && Math.hypot(cursor.x - first.x, cursor.y - first.y) <= closeThreshold;
    return { session: { ...session, cursor, hoverClose } };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'pen') return {};
    if (session.pointerId !== event.pointerId) return {};
    return {
      session: { ...session, draggingHandle: false, pointerId: null, cursor: event.point },
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'pen-draft' ? { session: null } : {};
  },
  onKeyDown(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'pen') return {};
    if (event.key === 'Enter') {
      return finalizePenDraft(session, false, context);
    }
    if (event.key === 'Escape') {
      return { session: null, notice: 'Discarded pen draft.', preventDefault: true };
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (session.points.length <= 1) return { session: null, preventDefault: true };
      return { session: { ...session, points: session.points.slice(0, -1) }, preventDefault: true };
    }
    return {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'pen') return null;
    const last = session.points[session.points.length - 1];
    const target = session.hoverClose && session.points.length >= 3 ? session.points[0] : session.cursor;
    const dx = last ? target.x - last.x : 0;
    const dy = last ? target.y - last.y : 0;
    const dist = Math.round(Math.hypot(dx, dy));
    const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    const segmentHud = last && dist >= 4 ? `${dist} px · ${angle}°` : undefined;
    return {
      kind: 'pen-draft',
      points: session.points,
      cursor: session.cursor,
      hoverClose: session.hoverClose,
      segmentHud,
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Adobe Illustrator Curvature Tool (U):
 * Click points to automatically sculpt silky smooth Catmull-Rom Bezier curves.
 * Alt+Click drops a sharp corner anchor. Click first point to close; Enter commits, Esc discards.
 */
export const curvatureTool: CanvasToolHandler = {
  id: 'curvature',
  label: 'Curvature',
  shortcut: 'U',
  group: 'vector',
  icon: 'curvature',
  workspaces: ['component'],
  description: 'Illustrator Curvature tool: click for smooth curves, Alt+click for sharp corners, Enter commits, Esc discards.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const current = context.session?.kind === 'pen-draft' && context.session.mode === 'curvature' ? context.session : null;

    if (!current) {
      const raw = [{ x: Math.round(event.point.x * 100) / 100, y: Math.round(event.point.y * 100) / 100, corner: event.altKey }];
      return {
        session: {
          kind: 'pen-draft',
          mode: 'curvature',
          points: fitCatmullRomToBezier(raw, false),
          rawCurvaturePoints: raw,
          draggingHandle: false,
          pointerId: null,
          cursor: event.point,
          hoverClose: false,
        },
        preventDefault: true,
      };
    }

    const rawPoints = current.rawCurvaturePoints ?? [];
    const closeThreshold = 12 / Math.max(0.35, context.zoom);
    if (rawPoints.length >= 3 && Math.hypot(event.point.x - rawPoints[0].x, event.point.y - rawPoints[0].y) <= closeThreshold) {
      return finalizePenDraft(current, true, context);
    }

    if ((event.detail ?? 0) >= 2 && rawPoints.length >= 2) {
      return finalizePenDraft(current, false, context);
    }

    const prevRaw = rawPoints[rawPoints.length - 1];
    const placed = event.shiftKey && prevRaw ? snapAngle45(prevRaw, event.point) : event.point;
    const nextRaw = [
      ...rawPoints,
      { x: Math.round(placed.x * 100) / 100, y: Math.round(placed.y * 100) / 100, corner: event.altKey },
    ];
    return {
      session: {
        ...current,
        rawCurvaturePoints: nextRaw,
        points: fitCatmullRomToBezier(nextRaw, false),
        cursor: placed,
        hoverClose: false,
      },
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'curvature') return {};
    const raw = session.rawCurvaturePoints ?? [];
    const prevRaw = raw[raw.length - 1];
    const cursor = event.shiftKey && prevRaw ? snapAngle45(prevRaw, event.point) : event.point;
    const closeThreshold = 12 / Math.max(0.35, context.zoom);
    const hoverClose = raw.length >= 3 && Math.hypot(cursor.x - raw[0].x, cursor.y - raw[0].y) <= closeThreshold;
    return { session: { ...session, cursor, hoverClose } };
  },
  onPointerUp() {
    return {};
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'pen-draft' ? { session: null } : {};
  },
  onKeyDown(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'curvature') return {};
    if (event.key === 'Enter') {
      return session.points.length >= 2 ? finalizePenDraft(session, false, context) : { session: null, preventDefault: true };
    }
    if (event.key === 'Escape') {
      return { session: null, notice: 'Discarded curvature draft.', preventDefault: true };
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const raw = (session.rawCurvaturePoints ?? []).slice(0, -1);
      if (raw.length === 0) return { session: null, preventDefault: true };
      return {
        session: { ...session, rawCurvaturePoints: raw, points: fitCatmullRomToBezier(raw, false) },
        preventDefault: true,
      };
    }
    return {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'pen-draft' || session.mode !== 'curvature') return null;
    const raw = session.rawCurvaturePoints ?? [];
    let previewPoints: VectorAnchorPoint[] | undefined;
    if (raw.length >= 1) {
      if (session.hoverClose && raw.length >= 3) {
        previewPoints = fitCatmullRomToBezier(raw, true, 0.25);
      } else {
        previewPoints = fitCatmullRomToBezier(
          [...raw, { x: session.cursor.x, y: session.cursor.y }],
          false,
          0.25,
        );
      }
    }
    return {
      kind: 'pen-draft',
      points: session.points,
      cursor: session.cursor,
      hoverClose: session.hoverClose,
      closedPreview: session.hoverClose && raw.length >= 3,
      previewPoints,
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Adobe Illustrator Anchor Point / Convert Tool (Shift+C):
 * - Click an anchor to convert smooth ↔ corner.
 * - Drag from an anchor to pull fresh symmetric Bezier handles (rotation-safe!).
 * - Click any path segment to insert a new anchor point via de Casteljau subdivision!
 */
export const anchorPointTool: CanvasToolHandler = {
  id: 'anchor-point',
  label: 'Anchor Point',
  shortcut: 'Shift+C',
  group: 'vector',
  icon: 'anchorPoint',
  workspaces: ['component'],
  description: 'Illustrator Anchor Point tool: click anchor to toggle corner/smooth, drag to pull handles, click segment to add anchor.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};

    if (event.anchorHit) {
      const pathNode = context.selectableNodes.find(
        (node): node is PathNode => node.id === event.anchorHit?.nodeId && node.type === 'path',
      );
      if (!pathNode) return {};
      if (event.anchorHit.part === 'anchor') {
        return {
          selection: [pathNode.id],
          session: {
            kind: 'anchor-edit',
            pointerId: event.pointerId,
            node: pathNode,
            pointIndex: event.anchorHit.pointIndex,
            part: 'anchor',
            start: event.point,
            symmetricConvert: true,
          },
          capturePointer: true,
          preventDefault: true,
        };
      }
      // Dragging an individual handle breaks tangent symmetry into independent corner handle
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

    // Prioritize directly clicked PathNode first, then fall back to selected PathNode
    const targetPath =
      (event.targetNodeId
        ? context.selectableNodes.find((n): n is PathNode => n.id === event.targetNodeId && n.type === 'path')
        : undefined) ??
      context.selectedNodes.find((n): n is PathNode => n.type === 'path');
    if (targetPath) {
      const localPoint = worldPointToNodeLocal(targetPath, event.point);
      const hit = findNearestSegmentHit(targetPath, localPoint, 16 / Math.max(0.35, context.zoom));
      if (hit) {
        const { node: subdivided } = insertAnchorOnPathSegment(targetPath, hit.segmentIndex, hit.t);
        return {
          selection: [subdivided.id],
          commitNodes: [{ ...subdivided, shapeMeta: undefined }],
          notice: 'Added anchor point on path segment.',
          preventDefault: true,
        };
      }
      return { selection: [targetPath.id], preventDefault: true };
    }
    return {};
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'anchor-edit' || session.pointerId !== event.pointerId) return {};

    const anchor = session.node.points[session.pointIndex];
    if (!anchor) return {};

    const rawLocal = worldPointToNodeLocal(session.node, event.point);
    const localPointer = event.shiftKey ? snapAngle45(anchor, rawLocal) : rawLocal;

    if (session.symmetricConvert) {
      const dx = localPointer.x - anchor.x;
      const dy = localPointer.y - anchor.y;
      if (Math.hypot(dx, dy) < 3) return {};
      const points = session.node.points.map((pt, idx) =>
        idx === session.pointIndex
          ? {
              ...pt,
              handleOut: { x: Math.round((pt.x + dx) * 100) / 100, y: Math.round((pt.y + dy) * 100) / 100 },
              handleIn: { x: Math.round((pt.x - dx) * 100) / 100, y: Math.round((pt.y - dy) * 100) / 100 },
              pointType: 'symmetric' as const,
            }
          : pt,
      );
      const previewNode = normalizePathNode({ ...session.node, points, shapeMeta: undefined });
      return { session: { ...session, previewNode }, previewNodes: [previewNode], preventDefault: true };
    }

    // Independent handle break in rotated local space
    const localX = Math.round(localPointer.x * 100) / 100;
    const localY = Math.round(localPointer.y * 100) / 100;
    const points = session.node.points.map((pt, idx) =>
      idx === session.pointIndex
        ? {
            ...pt,
            ...(session.part === 'handle-out' ? { handleOut: { x: localX, y: localY } } : { handleIn: { x: localX, y: localY } }),
            pointType: 'corner' as const,
          }
        : pt,
    );
    const previewNode = normalizePathNode({ ...session.node, points, shapeMeta: undefined });
    return { session: { ...session, previewNode }, previewNodes: [previewNode], preventDefault: true };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'anchor-edit' || session.pointerId !== event.pointerId) return {};
    if (session.previewNode) {
      return { commitNodes: [session.previewNode], session: null, previewNodes: null, preventDefault: true };
    }
    // Plain click without drag -> toggle corner <-> smooth
    if (session.symmetricConvert) {
      const toggled = toggleAnchorPointType(session.node, session.pointIndex);
      return { commitNodes: [{ ...toggled, shapeMeta: undefined }], session: null, previewNodes: null, preventDefault: true };
    }
    return { session: null, previewNodes: null, preventDefault: true };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'anchor-edit' ? { session: null, previewNodes: null } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session ? { session: null, previewNodes: null, preventDefault: true } : {};
  },
  renderOverlay() {
    return null;
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Figma & Illustrator Pencil Tool (N):
 * Draw freehand strokes; automatically simplifies via Douglas-Peucker and fits
 * smooth cubic Bezier curves on pointer release.
 */
export const pencilTool: CanvasToolHandler = {
  id: 'pencil',
  label: 'Pencil',
  shortcut: 'N',
  group: 'vector',
  icon: 'pencil',
  description: 'Draw smooth freehand vector strokes. Automatically simplifies into editable Bezier paths.',
  onPointerDown(event): CanvasToolTransition {
    if (event.button !== 0) return {};
    return {
      session: { kind: 'freehand', mode: 'pencil', pointerId: event.pointerId, points: [event.point] },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'pencil' || session.pointerId !== event.pointerId) {
      return {};
    }
    if (event.shiftKey) {
      const first = session.points[0];
      return {
        session: { ...session, points: [first, event.point] },
        preventDefault: true,
      };
    }
    const last = session.points[session.points.length - 1];
    const minSampleDist = Math.max(1.5, 3 / Math.max(0.35, context.zoom));
    if (Math.hypot(event.point.x - last.x, event.point.y - last.y) < minSampleDist) return {};
    return {
      session: { ...session, points: [...session.points, event.point] },
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'pencil' || session.pointerId !== event.pointerId) {
      return {};
    }
    const raw = event.shiftKey ? [session.points[0], event.point] : [...session.points, event.point];
    if (raw.length < 2) return { session: null, preventDefault: true };
    const tolerance = Math.max(1.5, 3.5 / Math.max(0.5, context.zoom));
    const simplified = simplifyFreehandToPathPoints(raw, tolerance);
    if (simplified.points.length < 2) return { session: null, preventDefault: true };
    const closed = simplified.closed || (event.altKey && simplified.points.length >= 3);
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    const isTransparent = context.document.background === '#00000000' || context.document.background === 'transparent';
    const strokeColor = isTransparent && opts.strokeColor === '#20212A' ? '#E6EAF2' : opts.strokeColor;
    const node = createVectorPathNode(simplified.points, {
      name: 'Pencil Stroke',
      closed,
      pathKind: 'pencil',
      fill: closed ? opts.fillColor : 'none',
      stroke: strokeColor,
      strokeWidth: Math.max(2, opts.strokeWidth),
    });
    return {
      createNodes: [node],
      selection: [node.id],
      session: null,
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'freehand' ? { session: null } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session?.kind === 'freehand' ? { session: null, preventDefault: true } : {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'pencil') return null;
    return { kind: 'freehand', points: session.points, mode: 'pencil' };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Adobe Illustrator Smooth Tool (Shift+N):
 * Drag across any selected vector path (including rotated paths!) to smoothly relax jagged curves.
 */
export const smoothTool: CanvasToolHandler = {
  id: 'smooth',
  label: 'Smooth',
  shortcut: 'Shift+N',
  group: 'vector',
  icon: 'smooth',
  workspaces: ['component'],
  description: 'Illustrator Smooth tool: drag across a selected vector path to relax and smooth jagged curves.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const target = context.selectedNodes.find((n): n is PathNode => n.type === 'path') ??
      context.selectableNodes.find((n): n is PathNode => n.id === event.targetNodeId && n.type === 'path');
    if (!target) {
      return { notice: 'Select a vector path first to smooth its curves.', preventDefault: true };
    }
    return {
      selection: [target.id],
      session: {
        kind: 'freehand',
        mode: 'smooth',
        pointerId: event.pointerId,
        points: [event.point],
        targetNode: target,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'smooth' || session.pointerId !== event.pointerId) {
      return {};
    }
    const last = session.points[session.points.length - 1];
    const minSampleDist = Math.max(2, 3 / Math.max(0.35, context.zoom));
    if (last && Math.hypot(event.point.x - last.x, event.point.y - last.y) < minSampleDist) {
      return {};
    }
    const nextPoints = [...session.points, event.point];
    const radius = context.toolOptions?.smoothRadius ?? DEFAULT_CANVAS_TOOL_OPTIONS.smoothRadius;
    const previewNode = session.targetNode ? smoothPathAnchors(session.targetNode, nextPoints, radius) : undefined;
    return {
      session: { ...session, points: nextPoints, previewNode },
      ...(previewNode ? { previewNodes: [previewNode] } : {}),
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'smooth' || session.pointerId !== event.pointerId) {
      return {};
    }
    return {
      ...(session.previewNode ? { commitNodes: [session.previewNode], notice: 'Smoothed vector path.' } : {}),
      session: null,
      previewNodes: null,
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'freehand' ? { session: null, previewNodes: null } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session ? { session: null, previewNodes: null, preventDefault: true } : {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'smooth') return null;
    return { kind: 'freehand', points: session.points, mode: 'smooth' };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Adobe Illustrator Scissors Tool (C):
 * Click anywhere along a PathNode segment (rotation-safe!) to open a closed path or split an open
 * path into two separate editable PathNodes in one atomic undo step.
 */
export const scissorsTool: CanvasToolHandler = {
  id: 'scissors',
  label: 'Scissors',
  shortcut: 'C',
  group: 'vector',
  icon: 'scissors',
  workspaces: ['component'],
  description: 'Illustrator Scissors tool: click any vector path segment to open or split the path in two.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    // Prioritize directly clicked PathNode first, then fall back to selected PathNode
    const target =
      (event.targetNodeId
        ? context.selectableNodes.find((n): n is PathNode => n.id === event.targetNodeId && n.type === 'path')
        : undefined) ??
      context.selectedNodes.find((n): n is PathNode => n.type === 'path');
    if (!target) {
      return { notice: 'Click a vector path segment to cut or split it.', preventDefault: true };
    }
    const localPoint = worldPointToNodeLocal(target, event.point);
    const split = splitPathAtLocalPoint(target, localPoint, () => createNodeId('node'));
    if (!split) {
      return { notice: 'Click directly on a vector path edge to cut.', preventDefault: true };
    }
    const cleanedSplit = split.map((item) => ({ ...item, shapeMeta: undefined }));
    if (cleanedSplit.length === 1) {
      return {
        commitNodes: cleanedSplit,
        selection: [cleanedSplit[0].id],
        notice: 'Opened vector path at cut point.',
        preventDefault: true,
      };
    }
    return {
      replaceNodeWithNodes: { nodeId: target.id, nodes: cleanedSplit },
      selection: cleanedSplit.map((item) => item.id),
      notice: 'Split path into two editable vector paths.',
      preventDefault: true,
    };
  },
  onPointerMove() { return {}; },
  onPointerUp() { return {}; },
  onPointerCancel() { return {}; },
  onKeyDown() { return {}; },
  renderOverlay() { return null; },
  cursorStyle() {
    return 'crosshair';
  },
};

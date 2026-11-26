import { createVectorPathNode } from '../../../core/document/factory';
import { isTransparentColor, sanitizeStyleColor } from '../../../core/document/styling';
import { resolveDesignTokenValue } from '../../../core/document/tokens';
import type { DesignNode } from '../../../core/document/types';
import { simplifyFreehandToPathPoints } from '../../../core/document/vector';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolHandler,
  type CanvasToolTransition,
} from './types';
import {
  getLoadedVectorDrawingEngine,
  preloadVectorDrawingEngine,
} from './vectorDrawingLoader';

function createDrawingNodeId(prefix = 'node'): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function resolveBrushColor(context: CanvasToolContext): string {
  const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
  if (isTransparentColor(opts.brushColor)) return 'transparent';
  if (opts.brushTokenId && context.designTokens) {
    const resolved = resolveDesignTokenValue(context.designTokens, opts.brushTokenId);
    if (resolved.ok && resolved.cssValue.trim().length > 0) {
      return sanitizeStyleColor(resolved.cssValue, '#8B7CF6');
    }
  }
  return sanitizeStyleColor(opts.brushColor || opts.fillColor, '#8B7CF6');
}

function resolveBucketColor(context: CanvasToolContext): string {
  const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
  if (isTransparentColor(opts.paintBucketColor)) return 'transparent';
  if (opts.paintBucketTokenId && context.designTokens) {
    const resolved = resolveDesignTokenValue(context.designTokens, opts.paintBucketTokenId);
    if (resolved.ok && resolved.cssValue.trim().length > 0) {
      return sanitizeStyleColor(resolved.cssValue, '#8B7CF6');
    }
  }
  return sanitizeStyleColor(opts.paintBucketColor || opts.fillColor, '#8B7CF6');
}

/**
 * Vector Brush Tool (B):
 * - 100% vector-native output (smooth cubic Bezier PathNode, zero raster/bitmap).
 * - Supports Round, Calligraphy/Flat, Tapered, and Marker presets.
 * - Real-time pointer stabilization & Douglas-Peucker simplification.
 * - Respects Draw Inside / Draw Outside via Geometry Engine automatically.
 */
export const vectorBrushTool: CanvasToolHandler = {
  id: 'brush',
  label: 'Vector Brush',
  shortcut: 'B',
  group: 'vector',
  icon: 'brush',
  description: 'Paint smooth 100% vector brush strokes (Round, Calligraphy, Tapered, Marker) with stabilizer and zero-typing controls.',
  onPointerDown(event, _context): CanvasToolTransition {
    if (event.button !== 0) return {};
    void preloadVectorDrawingEngine();
    const startPt = { x: event.point.x, y: event.point.y };
    return {
      session: {
        kind: 'freehand',
        mode: 'brush',
        pointerId: event.pointerId,
        points: [startPt],
        rawPoints: [startPt],
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'brush' || session.pointerId !== event.pointerId) {
      return {};
    }
    const rawList = session.rawPoints ?? session.points;
    const lastRaw = rawList[rawList.length - 1];
    if (lastRaw && Math.hypot(event.point.x - lastRaw.x, event.point.y - lastRaw.y) < 1.25) {
      return { preventDefault: true };
    }
    const nextRaw = [...rawList, { x: event.point.x, y: event.point.y }];

    // Live exponential smoothing on preview stroke proportional to stabilizer (0-100%)
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    const stab = Math.max(0, Math.min(100, opts.brushStabilizer)) / 100;
    const prevSmooth = session.points[session.points.length - 1] ?? event.point;
    const blend = 1 - stab * 0.68;
    const nextSmooth = {
      x: prevSmooth.x + (event.point.x - prevSmooth.x) * blend,
      y: prevSmooth.y + (event.point.y - prevSmooth.y) * blend,
    };

    return {
      session: {
        ...session,
        points: [...session.points, nextSmooth],
        rawPoints: nextRaw,
      },
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'brush' || session.pointerId !== event.pointerId) {
      return {};
    }
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    const rawPoints = [...(session.rawPoints ?? session.points), { x: event.point.x, y: event.point.y }];
    const color = resolveBrushColor(context);
    const engine = getLoadedVectorDrawingEngine();

    let createdNode = engine
      ? engine.buildVectorBrushPathNode(
          rawPoints,
          {
            preset: opts.brushPreset,
            size: opts.brushSize,
            stabilizer: opts.brushStabilizer,
            color,
            cap: opts.brushCap,
            tokenId: opts.brushTokenId,
          },
          () => createDrawingNodeId('brush'),
        )
      : null;

    // Lightweight inline vector fallback if dynamic chunk is still warming up on first frame
    if (!createdNode && rawPoints.length > 0) {
      const simplified = rawPoints.length >= 2
        ? simplifyFreehandToPathPoints(rawPoints, Math.max(1.2, opts.brushSize * 0.12))
        : simplifyFreehandToPathPoints([rawPoints[0], { x: rawPoints[0].x + 0.5, y: rawPoints[0].y }], 0.5);
      createdNode = createVectorPathNode(simplified.points, {
        id: createDrawingNodeId('brush'),
        name: 'Brush Stroke',
        closed: false,
        pathKind: 'pencil',
        fill: 'none',
        stroke: color,
        strokeWidth: Math.max(2, opts.brushSize),
        strokeLinecap: opts.brushCap,
        strokeLinejoin: 'round',
      });
    }

    if (!createdNode) {
      return { session: null, preventDefault: true };
    }

    const presetLabel =
      opts.brushPreset === 'calligraphy'
        ? 'Calligraphy'
        : opts.brushPreset === 'tapered'
          ? 'Tapered'
          : opts.brushPreset === 'marker'
            ? 'Marker'
            : 'Round';

    return {
      createNodes: [createdNode],
      selection: [createdNode.id],
      session: null,
      notice: `${presetLabel} vector brush stroke created (${createdNode.points.length} anchors).`,
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'freehand' && context.session.mode === 'brush'
      ? { session: null }
      : {};
  },
  onKeyDown(event, context) {
    if (event.key === 'Escape' && context.session?.kind === 'freehand' && context.session.mode === 'brush') {
      return { session: null, preventDefault: true };
    }
    return {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'brush') return null;
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    return {
      kind: 'freehand',
      mode: 'brush',
      points: session.points,
      strokeWidth: Math.max(2, opts.brushSize),
      strokeColor: resolveBrushColor(context),
      strokeLinecap: opts.brushCap,
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Vector Eraser Tool (E):
 * - Slice/Cut mode: carves partial vector geometry via Pathfinder planar subtraction
 *   (closed shapes/paths) and geometric segment splitting (open strokes).
 * - Object Erase mode: deletes entire vector objects touched by the eraser trail.
 * - Executes atomically via Native Command Engine (`replaceNodes`) for clean 1-step Undo.
 */
export const vectorEraserTool: CanvasToolHandler = {
  id: 'eraser',
  label: 'Vector Eraser',
  shortcut: 'E',
  group: 'vector',
  icon: 'eraser',
  description: 'Erase vector artwork cleanly: Slice/Cut partial geometry or Object Erase whole layers with full atomic Undo.',
  onPointerDown(event, _context): CanvasToolTransition {
    if (event.button !== 0) return {};
    void preloadVectorDrawingEngine();
    const startPt = { x: event.point.x, y: event.point.y };
    return {
      session: {
        kind: 'freehand',
        mode: 'eraser',
        pointerId: event.pointerId,
        points: [startPt],
        rawPoints: [startPt],
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'eraser' || session.pointerId !== event.pointerId) {
      return {};
    }
    const rawList = session.rawPoints ?? session.points;
    const lastRaw = rawList[rawList.length - 1];
    if (lastRaw && Math.hypot(event.point.x - lastRaw.x, event.point.y - lastRaw.y) < 0.85) {
      return { preventDefault: true };
    }
    const nextRaw = [...rawList, { x: event.point.x, y: event.point.y }];

    // Light exponential smoothing keeps the live eraser silky-smooth without lagging behind cursor
    const prevSmooth = session.points[session.points.length - 1] ?? event.point;
    const blend = 0.68;
    const nextSmooth = {
      x: prevSmooth.x + (event.point.x - prevSmooth.x) * blend,
      y: prevSmooth.y + (event.point.y - prevSmooth.y) * blend,
    };

    return {
      session: {
        ...session,
        points: [...session.points, nextSmooth],
        rawPoints: nextRaw,
      },
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'eraser' || session.pointerId !== event.pointerId) {
      return {};
    }
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    const trail = [...(session.rawPoints ?? session.points), { x: event.point.x, y: event.point.y }];

    if (opts.eraserTarget === 'selected' && context.selectedNodeIds.length === 0) {
      return {
        session: null,
        notice: 'Select a layer to erase, or switch Eraser Target to All Active Layers.',
        preventDefault: true,
      };
    }

    const engine = getLoadedVectorDrawingEngine();
    if (!engine) {
      void preloadVectorDrawingEngine();
      return {
        session: null,
        notice: 'Vector Eraser engine is loading — please try the stroke again.',
        preventDefault: true,
      };
    }

    const result = engine.applyVectorEraserOperation(
      context.selectableNodes,
      context.selectedNodeIds,
      trail,
      {
        size: opts.eraserSize,
        mode: opts.eraserMode,
        target: opts.eraserTarget,
      },
      () => createDrawingNodeId('cut'),
    );

    if (result.removeIds.length === 0) {
      return {
        session: null,
        notice:
          opts.eraserTarget === 'selected'
            ? 'Eraser did not intersect the selected layer.'
            : 'No editable vector layer intersected the eraser path.',
        preventDefault: true,
      };
    }

    const notice = opts.eraserMode === 'object'
      ? `Erased ${result.removeIds.length} vector object${result.removeIds.length === 1 ? '' : 's'}.`
      : result.insertNodes.length === 0
        ? `Erased ${result.removeIds.length} vector layer${result.removeIds.length === 1 ? '' : 's'} completely.`
        : `Sliced ${result.removeIds.length} layer${result.removeIds.length === 1 ? '' : 's'} into ${result.insertNodes.length} vector path${result.insertNodes.length === 1 ? '' : 's'}.`;

    // Keep carved pieces selected when erasing selected layers so consecutive strokes continue seamlessly;
    // when erasing across all layers with nothing selected, avoid popping jarring selection boxes.
    const removedSet = new Set(result.removeIds);
    const hadSelectedTarget = context.selectedNodeIds.some((id) => removedSet.has(id));
    const nextSelection =
      opts.eraserTarget === 'selected'
        ? result.insertNodes.map((n) => n.id)
        : hadSelectedTarget
          ? [
              ...context.selectedNodeIds.filter((id) => !removedSet.has(id)),
              ...result.insertNodes.map((n) => n.id),
            ]
          : context.selectedNodeIds.filter((id) => !removedSet.has(id));

    return {
      replaceNodes: {
        removeIds: result.removeIds,
        insertNodes: result.insertNodes,
      },
      selection: nextSelection,
      session: null,
      notice,
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'freehand' && context.session.mode === 'eraser'
      ? { session: null }
      : {};
  },
  onKeyDown(event, context) {
    if (event.key === 'Escape' && context.session?.kind === 'freehand' && context.session.mode === 'eraser') {
      return { session: null, preventDefault: true };
    }
    return {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'freehand' || session.mode !== 'eraser') return null;
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    return {
      kind: 'freehand',
      mode: 'eraser',
      points: session.points,
      strokeWidth: Math.max(4, opts.eraserSize),
      strokeColor: opts.eraserMode === 'object' ? 'rgba(244, 63, 94, 0.28)' : 'rgba(244, 63, 94, 0.14)',
      strokeLinecap: 'round',
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

/**
 * Paint Bucket Tool (Live Fill) (J):
 * - Click an existing shape/path to apply Fill or Stroke color (or clear with Transparent).
 * - Click an empty enclosed area bounded by intersecting lines/paths to detect the closed
 *   planar region (with configurable Gap Closing) and generate a new filled vector PathNode.
 */
export const paintBucketTool: CanvasToolHandler = {
  id: 'paint-bucket',
  label: 'Paint Bucket',
  shortcut: 'J',
  group: 'vector',
  icon: 'paintBucket',
  description: 'Fill existing shapes/strokes, clear with Transparent, or click empty enclosed areas to generate live vector fills.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
    const engine = getLoadedVectorDrawingEngine();

    if (!engine) {
      void preloadVectorDrawingEngine();
      // Lightweight fallback for direct hit fill while lazy chunk initializes
      const hitNode: DesignNode | undefined = event.targetNodeId
        ? context.selectableNodes.find((n) => n.id === event.targetNodeId)
        : undefined;
      if (hitNode && (hitNode.type === 'rect' || hitNode.type === 'ellipse' || hitNode.type === 'frame' || hitNode.type === 'path' || hitNode.type === 'text')) {
        const nextColor = resolveBucketColor(context);
        const transparent = isTransparentColor(nextColor);
        const updated = {
          ...hitNode,
          style: {
            ...hitNode.style,
            fill: transparent ? 'transparent' : nextColor,
          },
        } as DesignNode;
        return {
          commitNodes: [updated],
          selection: [updated.id],
          notice: transparent ? `Cleared fill on ${hitNode.name}.` : `Filled ${hitNode.name} with ${nextColor.toUpperCase()}.`,
          preventDefault: true,
        };
      }
      return {
        notice: 'Paint Bucket smart-region engine is loading — click again to fill enclosed regions.',
        preventDefault: true,
      };
    }

    const result = engine.applyPaintBucketOperation(
      context.selectableNodes,
      event.point,
      {
        color: opts.paintBucketColor,
        target: opts.paintBucketTarget,
        gapTolerance: opts.paintBucketGapTolerance,
        fallbackStrokeWidth: opts.strokeWidth > 0 ? opts.strokeWidth : 2,
        tokenId: opts.paintBucketTokenId,
        designTokens: context.designTokens,
      },
      () => createDrawingNodeId('fill'),
    );

    if (result.kind === 'update') {
      return {
        commitNodes: result.nodes,
        selection: result.nodes.map((n) => n.id),
        notice: result.notice,
        preventDefault: true,
      };
    }

    if (result.kind === 'create') {
      return {
        createNodes: result.nodes,
        selection: result.nodes.map((n) => n.id),
        notice: result.notice,
        preventDefault: true,
      };
    }

    return {
      notice: result.notice,
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

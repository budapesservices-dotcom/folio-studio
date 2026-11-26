import {
  createEllipseNode,
  createFrameNode,
  createLineNode,
  createPolygonNode,
  createRectNode,
  createStarNode,
  createTextNode,
  createTriangleNode,
} from '../../../core/document/factory';
import type { DesignNode } from '../../../core/document/types';
import { getBounds, snapPointToTargets, type Bounds } from '../geometry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolGroupId,
  type CanvasToolHandler,
  type CanvasToolId,
  type CanvasToolTransition,
  type DrawShapeSession,
} from './types';

import { getCanvasUnitsPerPixel } from './geometry';

function getDrawSnapTargets(context: CanvasToolContext): Bounds[] {
  const targets: Bounds[] = [{ x: 0, y: 0, width: context.document.width, height: context.document.height }];
  for (const node of context.selectableNodes) {
    const b = getBounds([node]);
    if (b) targets.push(b);
  }
  return targets;
}

function resolveDrawPoint(
  rawPoint: { x: number; y: number },
  bypassSnap: boolean,
  context: CanvasToolContext,
): { x: number; y: number } {
  if (bypassSnap) return rawPoint;
  const tolerance = 7 * getCanvasUnitsPerPixel(context);
  return snapPointToTargets(rawPoint, getDrawSnapTargets(context), tolerance).point;
}

function computeDraftRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
  constrain: boolean,
  fromCenter: boolean,
): { x: number; y: number; width: number; height: number } {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  if (fromCenter) {
    const halfW = Math.abs(dx);
    const halfH = Math.abs(dy);
    return {
      x: Math.round(start.x - halfW),
      y: Math.round(start.y - halfH),
      width: Math.max(1, Math.round(halfW * 2)),
      height: Math.max(1, Math.round(halfH * 2)),
    };
  }
  const x = Math.min(start.x, start.x + dx);
  const y = Math.min(start.y, start.y + dy);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(Math.abs(dx))),
    height: Math.max(1, Math.round(Math.abs(dy))),
  };
}

function snapLineEnd(
  start: { x: number; y: number },
  current: { x: number; y: number },
  constrain: boolean,
): { x: number; y: number } {
  if (!constrain) return { x: Math.round(current.x), y: Math.round(current.y) };
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const dist = Math.hypot(dx, dy);
  const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return {
    x: Math.round(start.x + Math.cos(snappedAngle) * dist),
    y: Math.round(start.y + Math.sin(snappedAngle) * dist),
  };
}

function buildDrawnNode(
  session: DrawShapeSession,
  context: CanvasToolContext,
  isClickFallback: boolean,
): DesignNode {
  const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
  const isCompact = context.document.width < 700 || context.document.height < 500;
  const defaultSize = isCompact ? 110 : 180;
  const strokeColor = opts.strokeColor;
  const hasVisibleStroke = Number.isFinite(opts.strokeWidth) && opts.strokeWidth > 0;
  const shapeStrokeStyle = hasVisibleStroke
    ? { stroke: strokeColor, strokeWidth: opts.strokeWidth }
    : { stroke: '#00000000', strokeWidth: 0 };

  if (session.toolId === 'draw-line' || session.toolId === 'draw-arrow') {
    const end = isClickFallback
      ? { x: Math.round(session.start.x + defaultSize), y: Math.round(session.start.y) }
      : snapLineEnd(session.start, session.current, session.constrain);
    return createLineNode(session.start.x, session.start.y, end.x, end.y, {
      arrowEnd: session.toolId === 'draw-arrow',
      stroke: strokeColor,
      strokeWidth: Math.max(1.5, opts.strokeWidth),
    });
  }

  const box = isClickFallback
    ? {
        x: Math.round(session.start.x - (session.toolId === 'draw-text' ? 0 : defaultSize / 2)),
        y: Math.round(session.start.y - (session.toolId === 'draw-text' ? 0 : defaultSize * 0.35)),
        width: session.toolId === 'frame' || session.toolId === 'section' ? (isCompact ? 180 : 320) : defaultSize,
        height: session.toolId === 'draw-text' ? 56 : session.toolId === 'frame' || session.toolId === 'section' ? (isCompact ? 120 : 220) : Math.round(defaultSize * (session.toolId === 'draw-rect' ? 0.7 : 1)),
      }
    : computeDraftRect(session.start, session.current, session.constrain, session.fromCenter);

  switch (session.toolId) {
    case 'frame':
      return createFrameNode(box.x, box.y, box.width, box.height, { name: 'Frame' });
    case 'section':
      return createFrameNode(box.x, box.y, box.width, box.height, { name: 'Section', isSection: true });
    case 'draw-rect': {
      const base = createRectNode(context.document.nodes.length);
      return {
        ...base,
        x: box.x,
        y: box.y,
        width: Math.max(8, box.width),
        height: Math.max(8, box.height),
        style: {
          ...base.style,
          fill: opts.fillColor,
          ...shapeStrokeStyle,
          radius: Math.min(12, Math.floor(Math.min(box.width, box.height) / 5)),
        },
      };
    }
    case 'draw-ellipse': {
      const base = createEllipseNode(context.document.nodes.length);
      return {
        ...base,
        x: box.x,
        y: box.y,
        width: Math.max(8, box.width),
        height: Math.max(8, box.height),
        style: { ...base.style, fill: opts.fillColor, ...shapeStrokeStyle },
      };
    }
    case 'draw-triangle': {
      const node = createTriangleNode(box.x, box.y, box.width, box.height);
      return { ...node, style: { ...node.style, fill: opts.fillColor, ...shapeStrokeStyle } };
    }
    case 'draw-polygon': {
      const sides = session.sidesOverride ?? opts.polygonSides;
      const node = createPolygonNode(box.x, box.y, box.width, box.height, sides);
      return { ...node, style: { ...node.style, fill: opts.fillColor, ...shapeStrokeStyle } };
    }
    case 'draw-star': {
      const spikes = session.spikesOverride ?? opts.starPoints;
      const innerRatio = session.innerRatioOverride ?? opts.starInnerRatio;
      const node = createStarNode(box.x, box.y, box.width, box.height, spikes, innerRatio);
      return { ...node, style: { ...node.style, fill: opts.fillColor, ...shapeStrokeStyle } };
    }
    case 'draw-text': {
      const base = createTextNode(context.document.nodes.length);
      const fontSize = isCompact ? 20 : Math.max(16, Math.min(72, Math.round(box.height * 0.55)));
      return {
        ...base,
        x: box.x,
        y: box.y,
        width: Math.max(120, box.width),
        height: Math.max(36, box.height),
        text: isClickFallback ? 'Type something' : 'Heading text',
        style: {
          ...base.style,
          fill: '#20212A',
          fontSize,
          letterSpacing: -0.5,
        },
      };
    }
    default: {
      const base = createRectNode(context.document.nodes.length);
      return { ...base, x: box.x, y: box.y, width: Math.max(8, box.width), height: Math.max(8, box.height) };
    }
  }
}

function createDrawTool(config: {
  id: CanvasToolId;
  label: string;
  description: string;
  group: CanvasToolGroupId;
  icon: string;
  shortcut: string;
}): CanvasToolHandler {
  return {
    ...config,
    onPointerDown(event, context): CanvasToolTransition {
      if (event.button !== 0) return {};
      const opts = context.toolOptions ?? DEFAULT_CANVAS_TOOL_OPTIONS;
      const start = resolveDrawPoint(event.point, event.ctrlKey || event.metaKey, context);
      return {
        session: {
          kind: 'draw-shape',
          pointerId: event.pointerId,
          toolId: config.id,
          start,
          current: start,
          constrain: event.shiftKey,
          fromCenter: event.altKey,
          ...(config.id === 'draw-polygon' ? { sidesOverride: opts.polygonSides } : {}),
          ...(config.id === 'draw-star' ? { spikesOverride: opts.starPoints, innerRatioOverride: opts.starInnerRatio } : {}),
        },
        capturePointer: true,
        preventDefault: true,
      };
    },
    onPointerMove(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.kind !== 'draw-shape' || session.pointerId !== event.pointerId) return {};
      const current = resolveDrawPoint(event.point, event.ctrlKey || event.metaKey, context);
      return {
        session: {
          ...session,
          current,
          constrain: event.shiftKey,
          fromCenter: event.altKey,
        },
        preventDefault: true,
      };
    },
    onPointerUp(event, context): CanvasToolTransition {
      const session = context.session;
      if (!session || session.kind !== 'draw-shape' || session.pointerId !== event.pointerId) return {};
      const current = resolveDrawPoint(event.point, event.ctrlKey || event.metaKey, context);
      const finalSession: DrawShapeSession = {
        ...session,
        current,
        constrain: event.shiftKey,
        fromCenter: event.altKey,
      };
      const unitsPerPx = getCanvasUnitsPerPixel(context);
      const dragDistance = Math.hypot(
        finalSession.current.x - finalSession.start.x,
        finalSession.current.y - finalSession.start.y,
      );
      const clickFallbackThreshold = Math.max(1.5, Math.min(8, 5 * unitsPerPx));
      const node = buildDrawnNode(finalSession, context, dragDistance < clickFallbackThreshold);
      const keepActive = Boolean(context.toolOptions?.keepToolActive);
      return {
        createNodes: [node],
        selection: [node.id],
        session: null,
        previewNodes: null,
        previewCreateNodes: null,
        guides: [],
        ...(config.id === 'draw-text' ? { editTextNodeId: node.id } : {}),
        ...(keepActive ? {} : { nextToolId: 'select' }),
        preventDefault: true,
      };
    },
    onPointerCancel(_event, context) {
      return context.session?.kind === 'draw-shape'
        ? { session: null, previewNodes: null, previewCreateNodes: null, guides: [] }
        : {};
    },
    onKeyDown(event, context) {
      const session = context.session;
      if (!session || session.kind !== 'draw-shape') return {};
      if (event.key === 'Escape') {
        return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], preventDefault: true };
      }
      if (event.key === 'Shift' || event.key === 'Alt') {
        return {
          session: { ...session, constrain: event.shiftKey, fromCenter: event.altKey },
        };
      }
      // Illustrator live Up/Down arrow adjustment while drawing Polygons & Stars!
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const delta = event.key === 'ArrowUp' ? 1 : -1;
        if (session.toolId === 'draw-polygon') {
          const curr = session.sidesOverride ?? (context.toolOptions?.polygonSides ?? 6);
          return {
            session: { ...session, sidesOverride: Math.max(3, Math.min(24, curr + delta)) },
            preventDefault: true,
          };
        }
        if (session.toolId === 'draw-star') {
          const curr = session.spikesOverride ?? (context.toolOptions?.starPoints ?? 5);
          return {
            session: { ...session, spikesOverride: Math.max(3, Math.min(24, curr + delta)) },
            preventDefault: true,
          };
        }
      }
      // Star inner-ratio live tuning via Left/Right arrows while dragging!
      if (session.toolId === 'draw-star' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const delta = event.key === 'ArrowRight' ? 0.04 : -0.04;
        const curr = session.innerRatioOverride ?? (context.toolOptions?.starInnerRatio ?? 0.44);
        const nextRatio = Math.max(0.15, Math.min(0.9, Math.round((curr + delta) * 100) / 100));
        return {
          session: { ...session, innerRatioOverride: nextRatio },
          preventDefault: true,
        };
      }
      return {};
    },
    renderOverlay(context) {
      const session = context.session;
      if (!session || session.kind !== 'draw-shape') return null;
      const unitsPerPx = getCanvasUnitsPerPixel(context);
      const dist = Math.hypot(session.current.x - session.start.x, session.current.y - session.start.y);
      if (dist < Math.max(0.5, Math.min(4, 2 * unitsPerPx))) return null;
      const preview = buildDrawnNode(session, context, false);
      const isLine = session.toolId === 'draw-line' || session.toolId === 'draw-arrow';
      const extra =
        session.toolId === 'draw-polygon' && session.sidesOverride
          ? ` · ${session.sidesOverride} sides`
          : session.toolId === 'draw-star' && session.spikesOverride
            ? ` · ${session.spikesOverride} pts · ${Math.round((session.innerRatioOverride ?? context.toolOptions?.starInnerRatio ?? 0.44) * 100)}%`
            : '';
      let label: string;
      if (isLine) {
        const snappedEnd = snapLineEnd(session.start, session.current, session.constrain);
        const dx = snappedEnd.x - session.start.x;
        const dy = snappedEnd.y - session.start.y;
        const lineLen = Math.round(Math.hypot(dx, dy));
        const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
        label = `${lineLen} px · ${angleDeg}°`;
      } else {
        label = `${Math.round(preview.width)} × ${Math.round(preview.height)}${extra}`;
      }
      return {
        kind: 'draw-preview',
        node: preview,
        label,
        labelX: preview.x + preview.width / 2,
        labelY: preview.y + preview.height + 16 * unitsPerPx,
      };
    },
    cursorStyle() {
      return config.id === 'draw-text' ? 'text' : 'crosshair';
    },
  };
}

export const frameTool = createDrawTool({
  id: 'frame',
  label: 'Frame',
  shortcut: 'F',
  group: 'layout',
  icon: 'frame',
  description: 'Draw a Figma-style layout Frame container. Hold Shift for square, Alt for center.',
});

export const sectionTool = createDrawTool({
  id: 'section',
  label: 'Section',
  shortcut: 'Shift+S',
  group: 'layout',
  icon: 'section',
  description: 'Draw a labeled canvas Section to organize flows and groups of frames.',
});

export const drawRectTool = createDrawTool({
  id: 'draw-rect',
  label: 'Rectangle',
  shortcut: 'R',
  group: 'shapes',
  icon: 'rect',
  description: 'Click or drag to draw a Rectangle. Hold Shift for square, Alt from center.',
});

export const drawEllipseTool = createDrawTool({
  id: 'draw-ellipse',
  label: 'Ellipse',
  shortcut: 'O',
  group: 'shapes',
  icon: 'ellipse',
  description: 'Click or drag to draw an Ellipse. Hold Shift for a perfect circle.',
});

export const drawLineTool = createDrawTool({
  id: 'draw-line',
  label: 'Line',
  shortcut: 'L',
  group: 'shapes',
  icon: 'line',
  description: 'Drag to draw a crisp vector line. Hold Shift to snap to 15° angles.',
});

export const drawArrowTool = createDrawTool({
  id: 'draw-arrow',
  label: 'Arrow',
  shortcut: 'Shift+L',
  group: 'shapes',
  icon: 'arrow',
  description: 'Drag to draw a directional vector arrow. Hold Shift to snap to 15° angles.',
});

export const drawTriangleTool = createDrawTool({
  id: 'draw-triangle',
  label: 'Triangle',
  shortcut: 'Shift+T',
  group: 'shapes',
  icon: 'triangle',
  description: 'Click or drag to draw a Triangle. Hold Shift for equilateral proportions.',
});

export const drawPolygonTool = createDrawTool({
  id: 'draw-polygon',
  label: 'Polygon',
  shortcut: 'G',
  group: 'shapes',
  icon: 'polygon',
  description: 'Drag to draw a regular Polygon. Press Up/Down arrows while dragging to adjust sides.',
});

export const drawStarTool = createDrawTool({
  id: 'draw-star',
  label: 'Star',
  shortcut: 'Shift+G',
  group: 'shapes',
  icon: 'star',
  description: 'Drag to draw a multi-point Star. Press Up/Down arrows while dragging to adjust points.',
});

export const drawTextTool = createDrawTool({
  id: 'draw-text',
  label: 'Text',
  shortcut: 'T',
  group: 'type',
  icon: 'text',
  description: 'Click anywhere on the artboard to place text, or drag to define a text frame.',
});

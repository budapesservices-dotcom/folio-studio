import type { DesignNode } from '../../../core/document/types';
import type { CanvasToolHandler, CanvasToolTransition } from './types';

function computeAngleDeg(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function extractSampledColor(node: DesignNode | undefined, artboardBackground: string): { color: string; sourceName: string } {
  if (!node) {
    return {
      color: artboardBackground === '#00000000' || artboardBackground === 'transparent' ? '#171B24' : artboardBackground,
      sourceName: 'Artboard',
    };
  }
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    const color = node.style.fill !== 'none' && node.style.fill !== '#00000000' ? node.style.fill : node.style.stroke;
    return { color: color && color !== 'none' ? color : '#8B7CF6', sourceName: node.name };
  }
  if (node.type === 'path') {
    const color = node.style.fill !== 'none' && node.style.fill !== '#00000000' ? node.style.fill : node.style.stroke;
    return { color: color && color !== 'none' ? color : '#20212A', sourceName: node.name };
  }
  if (node.type === 'text') {
    return { color: node.style.fill, sourceName: node.name };
  }
  return { color: '#8B7CF6', sourceName: node.name };
}

/**
 * Adobe Illustrator Rotate Tool (Shift+R):
 * Drag anywhere around the selected artwork to rotate smoothly around its
 * bounding center with a live angle ring readout (Shift snaps to 15°).
 */
export const rotateTool: CanvasToolHandler = {
  id: 'rotate',
  label: 'Rotate',
  shortcut: 'Shift+R',
  group: 'transform',
  icon: 'rotate',
  workspaces: ['component'],
  description: 'Illustrator Rotate tool: drag around selected artwork to rotate freely. Hold Shift to snap to 15°.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    if (!context.selectionBounds || context.selectedNodes.length === 0) {
      if (event.targetNodeId) {
        const hit = context.selectableNodes.find((n) => n.id === event.targetNodeId);
        if (hit) {
          const bounds = { x: hit.x, y: hit.y, width: hit.width, height: hit.height };
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return {
            selection: [hit.id],
            session: {
              kind: 'select-transform',
              pointerId: event.pointerId,
              mode: 'rotate',
              start: event.point,
              nodes: [hit],
              bounds,
              ids: [hit.id],
              startAngle: computeAngleDeg(center, event.point),
              currentAngle: 0,
            },
            capturePointer: true,
            preventDefault: true,
          };
        }
      }
      return { notice: 'Select an object first to rotate it.', preventDefault: true };
    }

    const center = {
      x: context.selectionBounds.x + context.selectionBounds.width / 2,
      y: context.selectionBounds.y + context.selectionBounds.height / 2,
    };
    return {
      session: {
        kind: 'select-transform',
        pointerId: event.pointerId,
        mode: 'rotate',
        start: event.point,
        nodes: context.selectedNodes,
        bounds: context.selectionBounds,
        ids: context.selectedNodes.map((n) => n.id),
        startAngle: computeAngleDeg(center, event.point),
        currentAngle: 0,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'select-transform' || session.mode !== 'rotate' || session.pointerId !== event.pointerId) {
      return {};
    }
    const center = {
      x: session.bounds.x + session.bounds.width / 2,
      y: session.bounds.y + session.bounds.height / 2,
    };
    let deltaAngle = computeAngleDeg(center, event.point) - (session.startAngle ?? 0);
    if (event.shiftKey) {
      deltaAngle = Math.round(deltaAngle / 15) * 15;
    }
    const rounded = Math.round(deltaAngle * 10) / 10;
    const previewNodes = session.nodes.map((node) => ({
      ...node,
      rotation: Math.round(((node.rotation + rounded) % 360) * 10) / 10,
    }));
    return {
      session: { ...session, currentAngle: rounded, previewNodes },
      previewNodes,
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'select-transform' || session.mode !== 'rotate' || session.pointerId !== event.pointerId) {
      return {};
    }
    return {
      ...(session.previewNodes ? { commitNodes: session.previewNodes } : {}),
      session: null,
      previewNodes: null,
      preventDefault: true,
    };
  },
  onPointerCancel(_event, context) {
    return context.session ? { session: null, previewNodes: null } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session ? { session: null, previewNodes: null } : {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'select-transform' || session.mode !== 'rotate') return null;
    const center = {
      x: session.bounds.x + session.bounds.width / 2,
      y: session.bounds.y + session.bounds.height / 2,
    };
    const radius = Math.max(36, Math.hypot(session.bounds.width, session.bounds.height) / 2);
    return { kind: 'rotate-ring', center, radius, angleDeg: session.currentAngle ?? 0 };
  },
  cursorStyle() {
    return 'grab';
  },
};

/**
 * Figma & Illustrator Eyedropper Tool (I):
 * Click any artwork or artboard to sample its color, update the active tool
 * swatch, and apply it directly to currently selected layers!
 */
export const eyedropperTool: CanvasToolHandler = {
  id: 'eyedropper',
  label: 'Eyedropper',
  shortcut: 'I',
  group: 'inspect',
  icon: 'eyedropper',
  description: 'Sample any fill color from the artboard and apply it to the current selection.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const hit = event.targetNodeId
      ? context.canvasNodes.find((node) => node.id === event.targetNodeId)
      : undefined;
    const sampled = extractSampledColor(hit, context.document.background);
    return {
      sampledColor: sampled,
      notice: `Sampled ${sampled.color.toUpperCase()} from ${sampled.sourceName}.`,
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

/**
 * Folio Signature Precision Measure Tool (M):
 * Drag anywhere on the artboard to inspect exact pixel distance, ΔX, ΔY, and
 * angle θ° with live engineering redlines. Hold Shift to lock axis/45° angles!
 */
export const measureTool: CanvasToolHandler = {
  id: 'measure',
  label: 'Measure',
  shortcut: 'M',
  group: 'inspect',
  icon: 'measure',
  description: 'Drag between any two points to inspect exact ΔX, ΔY, distance (px) and angle.',
  onPointerDown(event): CanvasToolTransition {
    if (event.button !== 0) return {};
    return {
      session: { kind: 'measure', pointerId: event.pointerId, start: event.point, current: event.point, active: true },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'measure' || !session.active || session.pointerId !== event.pointerId) return {};
    let current = event.point;
    if (event.shiftKey) {
      const dx = event.point.x - session.start.x;
      const dy = event.point.y - session.start.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      current = { x: session.start.x + Math.cos(angle) * dist, y: session.start.y + Math.sin(angle) * dist };
    }
    return { session: { ...session, current }, preventDefault: true };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'measure' || session.pointerId !== event.pointerId) return {};
    return { session: { ...session, active: false }, preventDefault: true };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'measure' ? { session: null } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session?.kind === 'measure' ? { session: null, preventDefault: true } : {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (!session || session.kind !== 'measure') return null;
    const dx = Math.round(session.current.x - session.start.x);
    const dy = Math.round(session.current.y - session.start.y);
    const distance = Math.round(Math.hypot(dx, dy) * 10) / 10;
    const angleDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 10) / 10;
    return {
      kind: 'measure',
      start: session.start,
      end: session.current,
      dx,
      dy,
      distance,
      angleDeg,
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

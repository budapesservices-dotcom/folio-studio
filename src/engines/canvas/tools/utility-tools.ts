import {
  formatColorWithAlpha,
  getVisibleFillPaints,
  isTransparentColor,
  parseColorWithAlpha,
} from '../../../core/document/styling';
import type { DesignNode } from '../../../core/document/types';
import { getBounds, nodesGeometryChanged, rotateNodesAroundPivot, snapPointToTargets, type Bounds } from '../geometry';
import { getCanvasUnitsPerPixel } from './geometry';
import type { CanvasToolHandler, CanvasToolTransition } from './types';

function computeAngleDeg(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function createRotateCloneId(): string {
  const rand = globalThis.crypto?.randomUUID?.();
  return `node-${rand ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function getOrCreateRotateCloneIdMap(
  nodes: readonly DesignNode[],
  existing?: Record<string, string>,
): Record<string, string> {
  if (existing) return existing;
  const map: Record<string, string> = {};
  for (const node of nodes) map[node.id] = createRotateCloneId();
  return map;
}

function remapRotatedClones(nodes: readonly DesignNode[], idMap: Record<string, string>): DesignNode[] {
  return nodes.map((node) => {
    const clonedId = idMap[node.id] ?? createRotateCloneId();
    const remappedParent = node.parentId && idMap[node.parentId] ? idMap[node.parentId] : node.parentId;
    const remappedClip = node.clipMaskBaseId && idMap[node.clipMaskBaseId] ? idMap[node.clipMaskBaseId] : node.clipMaskBaseId;
    return {
      ...node,
      id: clonedId,
      name: `${node.name} Copy`,
      ...(remappedParent !== undefined ? { parentId: remappedParent } : {}),
      ...(remappedClip !== undefined ? { clipMaskBaseId: remappedClip } : {}),
    };
  });
}

export interface SampledColorDetails {
  readonly color: string;
  readonly hex: string;
  readonly alpha: number;
  readonly isTransparent: boolean;
  readonly sourceName: string;
}

function resolveColorWithNodeOpacity(rawColor: string | undefined, nodeOpacity: number, fallbackHex: string): {
  color: string;
  hex: string;
  alpha: number;
  isTransparent: boolean;
} {
  if (!rawColor || isTransparentColor(rawColor)) {
    return { color: 'transparent', hex: fallbackHex, alpha: 0, isTransparent: true };
  }
  const parsed = parseColorWithAlpha(rawColor, fallbackHex);
  const combinedAlpha = Math.max(0, Math.min(1, Math.round(parsed.alpha * nodeOpacity * 100) / 100));
  if (combinedAlpha <= 0) {
    return { color: 'transparent', hex: parsed.hex, alpha: 0, isTransparent: true };
  }
  const formatted = formatColorWithAlpha(parsed.hex, combinedAlpha);
  return {
    color: formatted,
    hex: parsed.hex,
    alpha: combinedAlpha,
    isTransparent: false,
  };
}

export function extractSampledColor(
  node: DesignNode | undefined,
  artboardBackground: string,
  preferTarget: 'fill' | 'stroke' = 'fill',
): SampledColorDetails {
  if (!node) {
    if (isTransparentColor(artboardBackground)) {
      return {
        color: 'transparent',
        hex: '#171B24',
        alpha: 0,
        isTransparent: true,
        sourceName: 'Artboard',
      };
    }
    const parsed = parseColorWithAlpha(artboardBackground, '#171B24');
    return {
      color: formatColorWithAlpha(parsed.hex, parsed.alpha),
      hex: parsed.hex,
      alpha: parsed.alpha,
      isTransparent: parsed.isTransparent,
      sourceName: 'Artboard',
    };
  }

  const nodeOpacity = Number.isFinite(node.opacity) ? Math.max(0, Math.min(1, node.opacity)) : 1;

  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path') {
    const hasStroke = node.style.strokeWidth > 0 && !isTransparentColor(node.style.stroke);
    const paints = getVisibleFillPaints(node);
    const topPaint = paints[paints.length - 1];
    let rawFill: string | undefined = node.style.fill;
    let paintOpacity = 1;
    if (topPaint) {
      paintOpacity = topPaint.opacity ?? 1;
      if (topPaint.type === 'solid') {
        rawFill = topPaint.color;
      } else if (topPaint.stops.length > 0) {
        rawFill = topPaint.stops[0].color;
        paintOpacity *= topPaint.stops[0].opacity ?? 1;
      }
    }
    const hasFill = !isTransparentColor(rawFill);

    if (preferTarget === 'stroke') {
      if (hasStroke) {
        return {
          ...resolveColorWithNodeOpacity(node.style.stroke, nodeOpacity, '#20212A'),
          sourceName: node.name,
        };
      }
      if (hasFill) {
        return {
          ...resolveColorWithNodeOpacity(rawFill, nodeOpacity * paintOpacity, '#8B7CF6'),
          sourceName: node.name,
        };
      }
      return { color: 'transparent', hex: '#20212A', alpha: 0, isTransparent: true, sourceName: node.name };
    }

    if (hasFill) {
      return {
        ...resolveColorWithNodeOpacity(rawFill, nodeOpacity * paintOpacity, '#8B7CF6'),
        sourceName: node.name,
      };
    }
    if (hasStroke) {
      return {
        ...resolveColorWithNodeOpacity(node.style.stroke, nodeOpacity, '#20212A'),
        sourceName: node.name,
      };
    }
    return { color: 'transparent', hex: '#8B7CF6', alpha: 0, isTransparent: true, sourceName: node.name };
  }

  if (node.type === 'text') {
    return {
      ...resolveColorWithNodeOpacity(node.style.fill, nodeOpacity, '#FFFFFF'),
      sourceName: node.name,
    };
  }

  if (node.type === 'image' && node.style.stroke && !isTransparentColor(node.style.stroke)) {
    return {
      ...resolveColorWithNodeOpacity(node.style.stroke, nodeOpacity, '#8B7CF6'),
      sourceName: node.name,
    };
  }

  return { color: '#8B7CF6', hex: '#8B7CF6', alpha: 1, isTransparent: false, sourceName: node.name };
}

/**
 * Adobe Illustrator Rotate Tool (Shift+R) with Draggable Custom Pivot:
 * - Drag anywhere around selected artwork to orbit around its center or custom pivot.
 * - Drag the pivot crosshair anywhere (snaps to 9-point selection bounds); double-click pivot to recenter.
 * - Hold Shift to snap to 15° increments.
 */
export const rotateTool: CanvasToolHandler = {
  id: 'rotate',
  label: 'Rotate',
  shortcut: 'Shift+R',
  group: 'transform',
  icon: 'rotate',
  workspaces: ['component'],
  description: 'Drag to orbit around pivot (Shift snaps 15°). Drag pivot crosshair anywhere; double-click to recenter.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};

    // Dragging or double-clicking the custom rotation pivot crosshair
    if (event.smartHandleHit?.kind === 'pivot') {
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

    if (!context.selectionBounds || context.selectedNodes.length === 0) {
      if (event.targetNodeId) {
        const hit = context.selectableNodes.find((n) => n.id === event.targetNodeId);
        if (hit) {
          const bounds = { x: hit.x, y: hit.y, width: hit.width, height: hit.height };
          const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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
              pivot,
              startAngle: computeAngleDeg(pivot, event.point),
              currentAngle: 0,
              cloneMode: event.altKey,
            },
            capturePointer: true,
            preventDefault: true,
          };
        }
      }
      return { notice: 'Select an object first to rotate it.', preventDefault: true };
    }

    const pivot = context.customPivot ?? {
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
        pivot,
        startAngle: computeAngleDeg(pivot, event.point),
        currentAngle: 0,
        cloneMode: event.altKey,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.pointerId !== event.pointerId) return {};

    if (session.kind === 'smart-handle' && session.handle.kind === 'pivot') {
      const targets: Bounds[] = context.selectionBounds ? [context.selectionBounds] : [];
      const snapped = event.ctrlKey || event.metaKey
        ? { point: event.point, snapped: false }
        : snapPointToTargets(event.point, targets, 10 * getCanvasUnitsPerPixel(context));
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

    if (session.kind !== 'select-transform' || session.mode !== 'rotate') return {};
    const pivot = session.pivot ?? {
      x: session.bounds.x + session.bounds.width / 2,
      y: session.bounds.y + session.bounds.height / 2,
    };
    let deltaAngle = computeAngleDeg(pivot, event.point) - (session.startAngle ?? 0);
    if (event.shiftKey) {
      deltaAngle = Math.round(deltaAngle / 15) * 15;
    }
    const rounded = Math.round(deltaAngle * 10) / 10;
    const rotated = rotateNodesAroundPivot(session.nodes, rounded, pivot);
    if (event.altKey) {
      const cloneIdMap = getOrCreateRotateCloneIdMap(session.nodes, session.cloneIdMap);
      const clonedPreview = remapRotatedClones(rotated, cloneIdMap);
      return {
        session: { ...session, cloneMode: true, cloneIdMap, currentAngle: rounded, previewNodes: clonedPreview },
        previewNodes: null,
        previewCreateNodes: clonedPreview,
        preventDefault: true,
      };
    }
    return {
      session: { ...session, cloneMode: false, currentAngle: rounded, previewNodes: rotated },
      previewNodes: rotated,
      previewCreateNodes: null,
      preventDefault: true,
    };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.pointerId !== event.pointerId) return {};
    if (session.kind === 'smart-handle') {
      return {
        session: null,
        notice: 'Updated custom rotation pivot (double-click pivot to recenter).',
        preventDefault: true,
      };
    }
    if (session.kind !== 'select-transform' || session.mode !== 'rotate') return {};
    if (session.cloneMode && session.previewNodes && session.previewNodes.length > 0) {
      if (Math.abs(session.currentAngle ?? 0) < 0.05) {
        return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], preventDefault: true };
      }
      return {
        createNodes: session.previewNodes,
        selection: session.previewNodes.map((n) => n.id),
        session: null,
        previewNodes: null,
        previewCreateNodes: null,
        guides: [],
        notice: `Rotated & cloned ${session.previewNodes.length} layer${session.previewNodes.length === 1 ? '' : 's'} by ${session.currentAngle ?? 0}°.`,
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
  },
  onPointerCancel(_event, context) {
    if (!context.session) return {};
    const restorePivot =
      context.session.kind === 'smart-handle' && context.session.handle.kind === 'pivot'
        ? { customPivot: context.session.initialPivot ?? null }
        : {};
    return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], ...restorePivot };
  },
  onKeyDown(event, context) {
    if (event.key === 'Escape' && context.session) {
      const restorePivot =
        context.session.kind === 'smart-handle' && context.session.handle.kind === 'pivot'
          ? { customPivot: context.session.initialPivot ?? null }
          : {};
      return { session: null, previewNodes: null, previewCreateNodes: null, guides: [], ...restorePivot, preventDefault: true };
    }
    return {};
  },
  renderOverlay(context) {
    const session = context.session;
    if (session?.kind === 'smart-handle' && session.hudLabel && session.hudPoint) {
      return { kind: 'smart-hud', x: session.hudPoint.x, y: session.hudPoint.y, text: session.hudLabel, variant: 'rotate' };
    }
    if (!session || session.kind !== 'select-transform' || session.mode !== 'rotate') return null;
    const center = session.pivot ?? {
      x: session.bounds.x + session.bounds.width / 2,
      y: session.bounds.y + session.bounds.height / 2,
    };
    const radius = Math.max(36, Math.hypot(session.bounds.width, session.bounds.height) / 2);
    return { kind: 'rotate-ring', center, radius, angleDeg: session.currentAngle ?? 0 };
  },
  cursorStyle(context) {
    if (context.session?.kind === 'smart-handle') return 'grabbing';
    if (context.session?.kind === 'select-transform' && context.session.cloneMode) return 'copy';
    return context.session?.kind === 'select-transform' ? 'grabbing' : 'grab';
  },
};

/**
 * Figma & Illustrator Eyedropper Tool (I) with Live Color Loupe & Shift Stroke Mode:
 * - Hover anywhere for a live color loupe readout.
 * - Click to sample Fill; Shift+Click to sample directly into Stroke!
 */
export const eyedropperTool: CanvasToolHandler = {
  id: 'eyedropper',
  label: 'Eyedropper',
  shortcut: 'I',
  group: 'inspect',
  icon: 'eyedropper',
  description: 'Hover for live color loupe. Click to apply Fill; Shift+Click to apply Stroke.',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const hit = event.targetNodeId
      ? context.canvasNodes.find((node) => node.id === event.targetNodeId)
      : undefined;
    const target: 'fill' | 'stroke' = event.shiftKey ? 'stroke' : 'fill';
    const sampled = extractSampledColor(hit, context.document.background, target);
    const label = sampled.isTransparent
      ? 'TRANSPARENT'
      : sampled.alpha < 1
        ? `${sampled.hex.toUpperCase()} (${Math.round(sampled.alpha * 100)}%)`
        : sampled.hex.toUpperCase();
    return {
      sampledColor: { color: sampled.color, sourceName: sampled.sourceName, target },
      notice: `Sampled ${label} (${target}) from ${sampled.sourceName}.`,
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

function getMeasureSnapTargets(context: { document: { width: number; height: number }; selectableNodes: DesignNode[] }): Bounds[] {
  const targets: Bounds[] = [{ x: 0, y: 0, width: context.document.width, height: context.document.height }];
  for (const node of context.selectableNodes) {
    const b = getBounds([node]);
    if (b) targets.push(b);
  }
  return targets;
}

/**
 * Folio Signature Precision Measure Tool (M) with Magnetic Smart Snap:
 * Drag between any two points (snaps magnetically to object & artboard edges/centers)
 * to inspect exact pixel distance, ΔX, ΔY, and angle θ°. Hold Shift for 45° lock!
 */
export const measureTool: CanvasToolHandler = {
  id: 'measure',
  label: 'Measure',
  shortcut: 'M',
  group: 'inspect',
  icon: 'measure',
  description: 'Drag to measure ΔX, ΔY, distance & angle with magnetic edge snapping (Shift snaps 45°).',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const bypassSnap = event.ctrlKey || event.metaKey || event.altKey;
    const tolerance = 9 * getCanvasUnitsPerPixel(context);
    const snapped = bypassSnap
      ? { point: event.point, snapped: false }
      : snapPointToTargets(event.point, getMeasureSnapTargets(context), tolerance);
    return {
      session: {
        kind: 'measure',
        pointerId: event.pointerId,
        start: snapped.point,
        current: snapped.point,
        active: true,
        snappedStart: snapped.snapped,
        snappedEnd: snapped.snapped,
        targetNodeId: event.targetNodeId,
      },
      capturePointer: true,
      preventDefault: true,
    };
  },
  onPointerMove(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'measure' || !session.active || session.pointerId !== event.pointerId) return {};
    let current = event.point;
    let snappedEnd = false;
    if (event.shiftKey) {
      const dx = event.point.x - session.start.x;
      const dy = event.point.y - session.start.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      current = { x: session.start.x + Math.cos(angle) * dist, y: session.start.y + Math.sin(angle) * dist };
    } else if (!(event.ctrlKey || event.metaKey || event.altKey)) {
      const tolerance = 9 * getCanvasUnitsPerPixel(context);
      const snapped = snapPointToTargets(event.point, getMeasureSnapTargets(context), tolerance);
      current = snapped.point;
      snappedEnd = snapped.snapped;
    }
    return { session: { ...session, current, snappedEnd }, preventDefault: true };
  },
  onPointerUp(event, context): CanvasToolTransition {
    const session = context.session;
    if (!session || session.kind !== 'measure' || session.pointerId !== event.pointerId) return {};
    const dist = Math.hypot(session.current.x - session.start.x, session.current.y - session.start.y);
    const clickThreshold = Math.max(1, Math.min(6, 3 * getCanvasUnitsPerPixel(context)));
    const clickedNodeId = event.targetNodeId ?? session.targetNodeId ?? null;
    if (dist < clickThreshold && clickedNodeId) {
      const hit = context.selectableNodes.find((node) => node.id === clickedNodeId);
      const b = hit ? getBounds([hit]) : null;
      if (hit && b) {
        return {
          session: {
            ...session,
            active: false,
            start: { x: b.x, y: b.y },
            current: { x: b.x + b.width, y: b.y + b.height },
            inspectedBounds: b,
            inspectedLabel: `${hit.name} · ${Math.round(b.width)} × ${Math.round(b.height)} · (${Math.round(b.x)}, ${Math.round(b.y)})`,
          },
          preventDefault: true,
        };
      }
    }
    return { session: { ...session, active: false }, preventDefault: true };
  },
  onPointerCancel(_event, context) {
    return context.session?.kind === 'measure' ? { session: null, guides: [] } : {};
  },
  onKeyDown(event, context) {
    return event.key === 'Escape' && context.session?.kind === 'measure' ? { session: null, guides: [], preventDefault: true } : {};
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
      snappedStart: session.snappedStart,
      snappedEnd: session.snappedEnd,
      ...(session.inspectedBounds ? { inspectedBounds: session.inspectedBounds, inspectedLabel: session.inspectedLabel } : {}),
    };
  },
  cursorStyle() {
    return 'crosshair';
  },
};

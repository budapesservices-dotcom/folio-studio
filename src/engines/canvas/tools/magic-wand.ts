import type { DesignNode } from '../../../core/document/types';
import type { CanvasToolHandler, CanvasToolTransition } from './types';

function getFill(node: DesignNode): string | null {
  if (
    node.type !== 'rect' &&
    node.type !== 'ellipse' &&
    node.type !== 'text' &&
    node.type !== 'frame' &&
    node.type !== 'path'
  ) {
    return null;
  }
  const fill = node.style.fill.trim().toLowerCase();
  return !fill || fill === 'none' || fill === 'transparent' || fill === '#00000000' ? null : fill;
}
function getStroke(node: DesignNode): string | null {
  if (
    node.type !== 'rect' &&
    node.type !== 'ellipse' &&
    node.type !== 'frame' &&
    node.type !== 'path'
  ) {
    return null;
  }
  if (!Number.isFinite(node.style.strokeWidth) || node.style.strokeWidth <= 0) return null;
  const stroke = node.style.stroke.trim().toLowerCase();
  return !stroke || stroke === 'none' || stroke === 'transparent' || stroke === '#00000000' ? null : stroke;
}

export function getMagicWandMatchIds(nodes: readonly DesignNode[], target: DesignNode): string[] {
  const fill = getFill(target);
  if (fill) {
    return nodes.filter((node) => getFill(node) === fill).map((node) => node.id);
  }
  const stroke = getStroke(target);
  if (stroke) {
    return nodes.filter((node) => getStroke(node) === stroke).map((node) => node.id);
  }
  return nodes.filter((node) => node.type === target.type).map((node) => node.id);
}

export const magicWandTool: CanvasToolHandler = {
  id: 'magic-wand', label: 'Magic Wand', shortcut: 'W',
  description: 'Select visible objects with the same fill (or stroke) color. Shift adds to selection; Ctrl/Cmd subtracts.',
  group: 'selection', icon: 'magicWand',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const target = context.selectableNodes.find((node) => node.id === event.targetNodeId);
    if (!target) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) return {};
      return { selection: [] };
    }
    const matched = getMagicWandMatchIds(context.selectableNodes, target);
    let selection: string[];
    if (event.ctrlKey || event.metaKey) {
      const removed = new Set(matched);
      selection = context.selectedNodeIds.filter((id) => !removed.has(id));
    } else if (event.shiftKey) {
      selection = [...new Set([...context.selectedNodeIds, ...matched])];
    } else {
      selection = matched;
    }
    return { selection, preventDefault: true };
  },
  onPointerMove: () => ({}), onPointerUp: () => ({}), onPointerCancel: () => ({}), onKeyDown: () => ({}),
  renderOverlay: () => null, cursorStyle: () => 'crosshair',
};

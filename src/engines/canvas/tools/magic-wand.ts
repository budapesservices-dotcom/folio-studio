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
export function getMagicWandMatchIds(nodes: readonly DesignNode[], target: DesignNode): string[] {
  const fill = getFill(target);
  return nodes.filter((node) => fill ? getFill(node) === fill : node.type === target.type).map((node) => node.id);
}
export const magicWandTool: CanvasToolHandler = {
  id: 'magic-wand', label: 'Magic Wand',
  description: 'Select all visible objects with the same fill color; if there is no fill, match the same node type.',
  group: 'selection', icon: 'magicWand',
  onPointerDown(event, context): CanvasToolTransition {
    if (event.button !== 0) return {};
    const target = context.selectableNodes.find((node) => node.id === event.targetNodeId);
    return { selection: target ? getMagicWandMatchIds(context.selectableNodes, target) : [], preventDefault: Boolean(target) };
  },
  onPointerMove: () => ({}), onPointerUp: () => ({}), onPointerCancel: () => ({}), onKeyDown: () => ({}),
  renderOverlay: () => null, cursorStyle: () => 'crosshair',
};

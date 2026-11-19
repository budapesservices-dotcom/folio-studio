import { directSelectionTool, selectTool } from './select';
import { lassoSelectionTool } from './lasso-selection';
import { magicWandTool } from './magic-wand';
import { handTool } from './hand';
import { scrubbyZoomTool } from './scrubby-zoom';
import type { CanvasToolGroupId, CanvasToolHandler, CanvasToolId } from './types';

export interface CanvasToolGroup { id: CanvasToolGroupId; label: string; description: string; icon: string; tools: CanvasToolId[]; }
export const CANVAS_TOOL_GROUPS: CanvasToolGroup[] = [
  { id: 'selection', label: 'Selection', description: 'Select and target objects on the active Canvas.', icon: 'cursor', tools: ['select', 'direct-selection', 'lasso-selection', 'magic-wand'] },
  { id: 'navigation', label: 'Navigation', description: 'Move and zoom the Canvas viewport without editing artwork.', icon: 'hand', tools: ['hand', 'scrubby-zoom'] },
];
const handlers: CanvasToolHandler[] = [selectTool, directSelectionTool, lassoSelectionTool, magicWandTool, handTool, scrubbyZoomTool];

export class ToolRegistry {
  private readonly tools = new Map<CanvasToolId, CanvasToolHandler>();
  constructor(items: readonly CanvasToolHandler[]) {
    for (const item of items) {
      if (this.tools.has(item.id)) throw new Error('Duplicate Canvas tool registration: ' + item.id);
      this.tools.set(item.id, item);
    }
  }
  get(id: CanvasToolId): CanvasToolHandler {
    const handler = this.tools.get(id);
    if (!handler) throw new Error('Canvas tool is not registered: ' + id);
    return handler;
  }
  list(): CanvasToolHandler[] { return [...this.tools.values()]; }
}
export const canvasToolRegistry = new ToolRegistry(handlers);
export function getCanvasTool(id: CanvasToolId): CanvasToolHandler { return canvasToolRegistry.get(id); }
export type { CanvasToolGroupId, CanvasToolHandler, CanvasToolId } from './types';

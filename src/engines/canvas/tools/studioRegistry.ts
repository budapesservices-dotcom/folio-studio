import { directSelectionTool, scaleTool, selectTool } from './select';
import { lassoSelectionTool } from './lasso-selection';
import { magicWandTool } from './magic-wand';
import { handTool } from './hand';
import { scrubbyZoomTool } from './scrubby-zoom';
import {
  drawArrowTool,
  drawEllipseTool,
  drawLineTool,
  drawPolygonTool,
  drawRectTool,
  drawStarTool,
  drawTextTool,
  frameTool,
  sectionTool,
} from './draw-tools';
import {
  anchorPointTool,
  curvatureTool,
  pencilTool,
  penTool,
  scissorsTool,
  smoothTool,
} from './vector-tools';
import { shapeBuilderTool } from './shape-builder';
import { paintBucketTool, vectorBrushTool, vectorEraserTool } from './drawing-tools';
import { eyedropperTool, measureTool, rotateTool } from './utility-tools';
import { ToolRegistry } from './registry';
import type {
  CanvasToolGroupId,
  CanvasToolHandler,
  CanvasToolId,
  ToolWorkspaceScope,
} from './types';

export interface StudioToolGroup {
  id: CanvasToolGroupId;
  label: string;
  description: string;
  icon: string;
  tools: CanvasToolId[];
  workspaces: readonly ToolWorkspaceScope[];
}

const ALL_STUDIO_TOOLS: CanvasToolHandler[] = [
  // Selection & Transform
  selectTool,
  directSelectionTool,
  scaleTool,
  lassoSelectionTool,
  magicWandTool,
  // Frame & Layout (Figma)
  frameTool,
  sectionTool,
  // Shapes (Figma + Illustrator)
  drawRectTool,
  drawEllipseTool,
  drawLineTool,
  drawArrowTool,
  drawPolygonTool,
  drawStarTool,
  // Vector Craft & Vector-Native Drawing Suite
  penTool,
  curvatureTool,
  anchorPointTool,
  pencilTool,
  vectorBrushTool,
  vectorEraserTool,
  paintBucketTool,
  smoothTool,
  scissorsTool,
  shapeBuilderTool,
  // Typography
  drawTextTool,
  // Illustrator Transform
  rotateTool,
  // Inspect & Sample
  eyedropperTool,
  measureTool,
  // Viewport Navigation
  handTool,
  scrubbyZoomTool,
];

export const studioToolRegistry = new ToolRegistry(ALL_STUDIO_TOOLS);

export function getStudioTool(id: CanvasToolId): CanvasToolHandler {
  return studioToolRegistry.get(id);
}

/**
 * Main Canvas — Complete Figma Layout & Design Studio toolset + Folio Vector Drawing & Shape Builder.
 */
export const MAIN_CANVAS_TOOL_GROUPS: readonly StudioToolGroup[] = [
  {
    id: 'selection',
    label: 'Selection',
    description: 'Select, target nested objects, scale proportionally, or select by region/fill.',
    icon: 'cursor',
    tools: ['select', 'direct-selection', 'scale', 'lasso-selection', 'magic-wand'],
    workspaces: ['main'],
  },
  {
    id: 'layout',
    label: 'Frame',
    description: 'Create Figma-style Frames and canvas Sections to structure layouts.',
    icon: 'frame',
    tools: ['frame', 'section'],
    workspaces: ['main'],
  },
  {
    id: 'shapes',
    label: 'Shape',
    description: 'Draw Rectangles, Ellipses, Lines, Arrows, Polygons, and Stars directly on Canvas.',
    icon: 'rect',
    tools: ['draw-rect', 'draw-ellipse', 'draw-line', 'draw-arrow', 'draw-polygon', 'draw-star'],
    workspaces: ['main'],
  },
  {
    id: 'vector',
    label: 'Vector',
    description: 'Draw Bezier paths (Pen), Vector Brush (B), Vector Eraser (E), Paint Bucket (J), Pencil (N), or Shape Builder (Shift+M).',
    icon: 'pen',
    tools: ['pen', 'pencil', 'brush', 'eraser', 'paint-bucket', 'shape-builder'],
    workspaces: ['main'],
  },
  {
    id: 'type',
    label: 'Text',
    description: 'Click or drag anywhere on the Canvas to place crisp typography.',
    icon: 'text',
    tools: ['draw-text'],
    workspaces: ['main'],
  },
  {
    id: 'inspect',
    label: 'Inspect',
    description: 'Sample colors with Eyedropper Loupe or inspect distances & angles with Precision Measure.',
    icon: 'eyedropper',
    tools: ['eyedropper', 'measure'],
    workspaces: ['main'],
  },
  {
    id: 'navigation',
    label: 'Navigation',
    description: 'Pan and scrub-zoom the Canvas viewport without editing artwork.',
    icon: 'hand',
    tools: ['hand', 'scrubby-zoom'],
    workspaces: ['main'],
  },
];

/**
 * Component Canvas — Dedicated Adobe Illustrator Vector Craft & Vector-Native Drawing Studio toolset.
 * Brings Pen, Vector Brush, Vector Eraser, Paint Bucket, Curvature, Anchor Point, Pencil,
 * Smooth, Scissors, Shape Builder, Rotate (with custom pivot), and Vector Shapes right to the forefront.
 */
export const COMPONENT_CANVAS_TOOL_GROUPS: readonly StudioToolGroup[] = [
  {
    id: 'selection',
    label: 'Selection',
    description: 'Selection (V), Direct Selection & Anchor Editor (A), Lasso (Q), Magic Wand (Y).',
    icon: 'cursor',
    tools: ['select', 'direct-selection', 'lasso-selection', 'magic-wand'],
    workspaces: ['component'],
  },
  {
    id: 'vector',
    label: 'Vector',
    description: 'Vector Craft & Drawing Suite: Pen (P), Vector Brush (B), Vector Eraser (E), Paint Bucket (J), Curvature (U), Anchor Point, Pencil (N), Smooth, Scissors (C), Shape Builder.',
    icon: 'pen',
    tools: ['pen', 'brush', 'eraser', 'paint-bucket', 'curvature', 'anchor-point', 'pencil', 'smooth', 'scissors', 'shape-builder'],
    workspaces: ['component'],
  },
  {
    id: 'shapes',
    label: 'Shape',
    description: 'Vector primitives: Rectangle (R), Ellipse (O), Polygon (G), Star (Shift+G), Line (L), Arrow, Frame (F).',
    icon: 'polygon',
    tools: ['draw-rect', 'draw-ellipse', 'draw-polygon', 'draw-star', 'draw-line', 'draw-arrow', 'frame'],
    workspaces: ['component'],
  },
  {
    id: 'transform',
    label: 'Transform',
    description: 'Illustrator Rotate with Custom Pivot (Shift+R) and Proportional Scale (K).',
    icon: 'rotate',
    tools: ['rotate', 'scale'],
    workspaces: ['component'],
  },
  {
    id: 'type',
    label: 'Text',
    description: 'Place crisp typography inside reusable component masters.',
    icon: 'text',
    tools: ['draw-text'],
    workspaces: ['component'],
  },
  {
    id: 'inspect',
    label: 'Inspect',
    description: 'Eyedropper Loupe (I) color & alpha sampling and Precision Measure (M) redlines.',
    icon: 'eyedropper',
    tools: ['eyedropper', 'measure'],
    workspaces: ['component'],
  },
  {
    id: 'navigation',
    label: 'Navigation',
    description: 'Pan (H) and Scrubby Zoom (Z) inside Component Canvas.',
    icon: 'hand',
    tools: ['hand', 'scrubby-zoom'],
    workspaces: ['component'],
  },
];

export function getStudioToolGroupsForWorkspace(workspace: ToolWorkspaceScope): readonly StudioToolGroup[] {
  return workspace === 'component' ? COMPONENT_CANVAS_TOOL_GROUPS : MAIN_CANVAS_TOOL_GROUPS;
}

export function isToolAvailableInWorkspace(toolId: CanvasToolId, workspace: ToolWorkspaceScope): boolean {
  return getStudioToolGroupsForWorkspace(workspace).some((group) => group.tools.includes(toolId));
}

export function findStudioToolByShortcut(
  key: string,
  shiftKey: boolean,
  workspace: ToolWorkspaceScope,
): CanvasToolId | null {
  const normalized = key.toLowerCase();
  const availableIds = new Set(
    getStudioToolGroupsForWorkspace(workspace).flatMap((group) => group.tools),
  );

  const shiftMap: Record<string, CanvasToolId> = {
    s: 'section',
    l: 'draw-arrow',
    g: 'draw-star',
    c: 'anchor-point',
    n: 'smooth',
    r: 'rotate',
    m: 'shape-builder',
  };
  if (shiftKey && shiftMap[normalized] && availableIds.has(shiftMap[normalized])) {
    return shiftMap[normalized];
  }

  const singleMap: Record<string, CanvasToolId> = {
    v: 'select',
    a: 'direct-selection',
    k: 'scale',
    q: 'lasso-selection',
    y: 'magic-wand',
    f: 'frame',
    r: 'draw-rect',
    o: 'draw-ellipse',
    l: 'draw-line',
    g: 'draw-polygon',
    p: 'pen',
    b: 'brush',
    e: 'eraser',
    j: 'paint-bucket',
    u: 'curvature',
    n: 'pencil',
    c: 'scissors',
    t: 'draw-text',
    i: 'eyedropper',
    m: 'measure',
    h: 'hand',
    z: 'scrubby-zoom',
  };
  if (!shiftKey && singleMap[normalized] && availableIds.has(singleMap[normalized])) {
    return singleMap[normalized];
  }
  return null;
}

import {
  COMPONENT_CANVAS_TOOL_GROUPS,
  MAIN_CANVAS_TOOL_GROUPS,
  getStudioTool,
} from '../engines/canvas/tools/studioRegistry';
import type { CanvasToolId } from '../engines/canvas/tools/types';

export type ShortcutWorkspaceId = 'global' | 'main' | 'component' | 'layers-panels';
export type ShortcutWorkspaceFilter = 'all' | ShortcutWorkspaceId;

export type ShortcutActionCategoryId =
  | 'editing-history'
  | 'selection-navigation'
  | 'drawing-shapes'
  | 'vector-craft'
  | 'arrange-transform'
  | 'layers-masking'
  | 'panels-dialogs';

export type ShortcutActionCategoryFilter = 'all' | ShortcutActionCategoryId;
export type ShortcutPlatform = 'mac' | 'standard';

export interface ShortcutWorkspaceMeta {
  readonly id: ShortcutWorkspaceId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly accent: 'neutral' | 'page' | 'vector';
}

export interface ShortcutActionCategoryMeta {
  readonly id: ShortcutActionCategoryId;
  readonly label: string;
  readonly shortLabel: string;
}

export interface KeyboardShortcutEntry {
  readonly id: string;
  readonly action: string;
  readonly description: string;
  /** Primary key sequence tokens in platform-neutral notation (e.g. ['Mod', 'Shift', 'G']). */
  readonly keys: readonly string[];
  /** Optional alternate key sequence (e.g. ['Mod', 'Y'] for Redo). */
  readonly alternateKeys?: readonly string[];
  readonly workspace: ShortcutWorkspaceId;
  readonly category: ShortcutActionCategoryId;
  /** Optional contextual qualifier shown inline (e.g. 'Main only', 'Component only', '2+ selected'). */
  readonly scopeNote?: string;
  /** Tool ID when backed by studioRegistry. */
  readonly toolId?: CanvasToolId;
  readonly keywords?: readonly string[];
}

export interface ShortcutActionGroup {
  readonly category: ShortcutActionCategoryMeta;
  readonly shortcuts: readonly KeyboardShortcutEntry[];
}

export interface ShortcutWorkspaceGroup {
  readonly workspace: ShortcutWorkspaceMeta;
  readonly categories: readonly ShortcutActionGroup[];
  readonly totalCount: number;
}

export interface ShortcutFilterOptions {
  readonly workspace: ShortcutWorkspaceFilter;
  readonly category: ShortcutActionCategoryFilter;
  readonly query: string;
  readonly platform?: ShortcutPlatform;
}

export const SHORTCUT_WORKSPACES: readonly ShortcutWorkspaceMeta[] = [
  {
    id: 'global',
    label: 'Global Studio',
    shortLabel: 'Global',
    description: 'Clipboard, history, help, and dialog controls available across the active editor.',
    accent: 'neutral',
  },
  {
    id: 'main',
    label: 'Main Canvas',
    shortLabel: 'Main Canvas',
    description: 'Page layout tools, frames, sections, shapes, alignment, and viewport navigation.',
    accent: 'page',
  },
  {
    id: 'component',
    label: 'Component Canvas',
    shortLabel: 'Component Canvas',
    description: 'Vector craft studio for master components, Bezier anchors, curves, and pivot rotation.',
    accent: 'vector',
  },
  {
    id: 'layers-panels',
    label: 'Layers & Panels',
    shortLabel: 'Layers & Panels',
    description: 'Layer hierarchy, grouping, clipping masks, inline renaming, and resizable docks.',
    accent: 'neutral',
  },
];

export const SHORTCUT_WORKSPACE_BY_ID: Readonly<Record<ShortcutWorkspaceId, ShortcutWorkspaceMeta>> = {
  global: SHORTCUT_WORKSPACES[0],
  main: SHORTCUT_WORKSPACES[1],
  component: SHORTCUT_WORKSPACES[2],
  'layers-panels': SHORTCUT_WORKSPACES[3],
};

export const SHORTCUT_ACTION_CATEGORIES: readonly ShortcutActionCategoryMeta[] = [
  { id: 'editing-history', label: 'Editing & History', shortLabel: 'Editing' },
  { id: 'selection-navigation', label: 'Selection & Viewport', shortLabel: 'Selection & View' },
  { id: 'drawing-shapes', label: 'Frames, Shapes & Inspect', shortLabel: 'Drawing & Shapes' },
  { id: 'vector-craft', label: 'Vector & Path Craft', shortLabel: 'Vector Craft' },
  { id: 'arrange-transform', label: 'Arrange, Align & Nudge', shortLabel: 'Arrange & Align' },
  { id: 'layers-masking', label: 'Layers & Masking', shortLabel: 'Layers & Masks' },
  { id: 'panels-dialogs', label: 'Text, Panels & Dialogs', shortLabel: 'Panels & Help' },
];

export const SHORTCUT_CATEGORY_BY_ID: Readonly<Record<ShortcutActionCategoryId, ShortcutActionCategoryMeta>> = {
  'editing-history': SHORTCUT_ACTION_CATEGORIES[0],
  'selection-navigation': SHORTCUT_ACTION_CATEGORIES[1],
  'drawing-shapes': SHORTCUT_ACTION_CATEGORIES[2],
  'vector-craft': SHORTCUT_ACTION_CATEGORIES[3],
  'arrange-transform': SHORTCUT_ACTION_CATEGORIES[4],
  'layers-masking': SHORTCUT_ACTION_CATEGORIES[5],
  'panels-dialogs': SHORTCUT_ACTION_CATEGORIES[6],
};

/**
 * Exact runtime keybindings implemented in `findStudioToolByShortcut` (`studioRegistry.ts`).
 * Kept explicit here and verified against `findStudioToolByShortcut` in unit tests so the
 * cheat sheet never drifts from actual keyboard dispatch.
 */
export const STUDIO_TOOL_KEYBINDINGS: Readonly<Record<CanvasToolId, readonly string[]>> = {
  select: ['V'],
  'direct-selection': ['A'],
  scale: ['K'],
  'lasso-selection': ['Q'],
  'magic-wand': ['Y'],
  frame: ['F'],
  section: ['Shift', 'S'],
  'draw-rect': ['R'],
  'draw-ellipse': ['O'],
  'draw-line': ['L'],
  'draw-arrow': ['Shift', 'L'],
  'draw-polygon': ['G'],
  'draw-star': ['Shift', 'G'],
  pen: ['P'],
  curvature: ['U'],
  'anchor-point': ['Shift', 'C'],
  pencil: ['N'],
  brush: ['B'],
  eraser: ['E'],
  'paint-bucket': ['J'],
  smooth: ['Shift', 'N'],
  scissors: ['C'],
  'shape-builder': ['Shift', 'M'],
  'draw-text': ['T'],
  rotate: ['Shift', 'R'],
  eyedropper: ['I'],
  measure: ['M'],
  hand: ['H'],
  'scrubby-zoom': ['Z'],
};

const TOOL_CATEGORY_MAP: Readonly<Record<CanvasToolId, ShortcutActionCategoryId>> = {
  select: 'selection-navigation',
  'direct-selection': 'selection-navigation',
  scale: 'arrange-transform',
  'lasso-selection': 'selection-navigation',
  'magic-wand': 'selection-navigation',
  frame: 'drawing-shapes',
  section: 'drawing-shapes',
  'draw-rect': 'drawing-shapes',
  'draw-ellipse': 'drawing-shapes',
  'draw-line': 'drawing-shapes',
  'draw-arrow': 'drawing-shapes',
  'draw-polygon': 'drawing-shapes',
  'draw-star': 'drawing-shapes',
  pen: 'vector-craft',
  curvature: 'vector-craft',
  'anchor-point': 'vector-craft',
  pencil: 'vector-craft',
  brush: 'vector-craft',
  eraser: 'vector-craft',
  'paint-bucket': 'vector-craft',
  smooth: 'vector-craft',
  scissors: 'vector-craft',
  'shape-builder': 'vector-craft',
  'draw-text': 'drawing-shapes',
  rotate: 'arrange-transform',
  eyedropper: 'drawing-shapes',
  measure: 'drawing-shapes',
  hand: 'selection-navigation',
  'scrubby-zoom': 'selection-navigation',
};

function buildToolShortcutsForWorkspace(workspace: 'main' | 'component'): KeyboardShortcutEntry[] {
  const groups = workspace === 'component' ? COMPONENT_CANVAS_TOOL_GROUPS : MAIN_CANVAS_TOOL_GROUPS;
  const otherGroups = workspace === 'component' ? MAIN_CANVAS_TOOL_GROUPS : COMPONENT_CANVAS_TOOL_GROUPS;
  const otherToolIds = new Set(otherGroups.flatMap((group) => group.tools));

  const seen = new Set<CanvasToolId>();
  const entries: KeyboardShortcutEntry[] = [];

  for (const group of groups) {
    for (const toolId of group.tools) {
      if (seen.has(toolId)) continue;
      seen.add(toolId);
      const tool = getStudioTool(toolId);
      const keys = STUDIO_TOOL_KEYBINDINGS[toolId];
      const exclusive = !otherToolIds.has(toolId);
      entries.push({
        id: `${workspace}-tool-${toolId}`,
        action: `${tool.label} tool`,
        description: tool.description,
        keys,
        workspace,
        category: TOOL_CATEGORY_MAP[toolId],
        scopeNote: exclusive ? (workspace === 'component' ? 'Vector studio only' : 'Page studio only') : undefined,
        toolId,
        keywords: [group.label.toLowerCase(), toolId, tool.label.toLowerCase(), 'tool'],
      });
    }
  }

  return entries;
}

const GLOBAL_SHORTCUTS: readonly KeyboardShortcutEntry[] = [
  {
    id: 'global-undo',
    action: 'Undo',
    description: 'Revert the last atomic edit in the active workspace.',
    keys: ['Mod', 'Z'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['history', 'revert', 'back'],
  },
  {
    id: 'global-redo',
    action: 'Redo',
    description: 'Re-apply the most recently undone edit.',
    keys: ['Mod', 'Shift', 'Z'],
    alternateKeys: ['Mod', 'Y'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['history', 'forward'],
  },
  {
    id: 'global-copy',
    action: 'Copy selection',
    description: 'Copy selected layers and nested subtrees to the studio clipboard.',
    keys: ['Mod', 'C'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['clipboard'],
  },
  {
    id: 'global-cut',
    action: 'Cut selection',
    description: 'Copy selected layers and remove them from the active canvas.',
    keys: ['Mod', 'X'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['clipboard', 'remove'],
  },
  {
    id: 'global-paste',
    action: 'Paste selection',
    description: 'Paste copied layers into the active canvas with fresh IDs.',
    keys: ['Mod', 'V'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['clipboard'],
  },
  {
    id: 'global-duplicate',
    action: 'Duplicate selection',
    description: 'Clone selected layers in place with a small offset.',
    keys: ['Mod', 'D'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['clone', 'copy'],
  },
  {
    id: 'global-select-all',
    action: 'Select all layers',
    description: 'Select every layer in the currently active canvas document.',
    keys: ['Mod', 'A'],
    workspace: 'global',
    category: 'editing-history',
    keywords: ['selection', 'all'],
  },
  {
    id: 'global-remove-from-canvas',
    action: 'Remove from canvas',
    description: 'Hide selected layers from canvas while keeping source layers in the Layers panel.',
    keys: ['Delete'],
    alternateKeys: ['Backspace'],
    workspace: 'global',
    category: 'editing-history',
    scopeNote: 'Canvas focus',
    keywords: ['delete', 'backspace', 'clear', 'hide'],
  },
  {
    id: 'global-shortcuts-modal',
    action: 'Keyboard Shortcuts reference',
    description: 'Open or close this categorized keyboard shortcuts cheat sheet.',
    keys: ['?'],
    alternateKeys: ['Mod', '/'],
    workspace: 'global',
    category: 'panels-dialogs',
    keywords: ['help', 'cheat sheet', 'hotkeys', 'keys'],
  },
  {
    id: 'global-escape-dismiss',
    action: 'Cancel gesture or close overlay',
    description: 'Dismiss open menus, popovers, dialogs, or abort an active drag/pan session.',
    keys: ['Esc'],
    workspace: 'global',
    category: 'panels-dialogs',
    keywords: ['cancel', 'close', 'dismiss', 'escape'],
  },
  {
    id: 'global-dialog-focus-cycle',
    action: 'Move focus within modal dialog',
    description: 'Cycle keyboard focus forward or backward inside an active modal dialog.',
    keys: ['Tab'],
    alternateKeys: ['Shift', 'Tab'],
    workspace: 'global',
    category: 'panels-dialogs',
    keywords: ['accessibility', 'focus', 'trap'],
  },
];

const MAIN_CANVAS_GESTURE_SHORTCUTS: readonly KeyboardShortcutEntry[] = [
  {
    id: 'main-space-pan',
    action: 'Temporary Hand pan',
    description: 'Hold Space and drag anywhere on the canvas to pan without switching tools.',
    keys: ['Space', 'Drag'],
    workspace: 'main',
    category: 'selection-navigation',
    keywords: ['pan', 'viewport', 'move', 'hand'],
  },
  {
    id: 'main-wheel-zoom',
    action: 'Zoom toward cursor',
    description: 'Zoom in or out smoothly anchored to the current pointer location.',
    keys: ['Mod', 'Scroll'],
    workspace: 'main',
    category: 'selection-navigation',
    keywords: ['zoom', 'wheel', 'magnify'],
  },
  {
    id: 'main-wheel-pan-x',
    action: 'Pan canvas horizontally',
    description: 'Scroll vertically while holding Shift to pan left and right.',
    keys: ['Shift', 'Scroll'],
    workspace: 'main',
    category: 'selection-navigation',
    keywords: ['pan', 'horizontal', 'wheel'],
  },
  {
    id: 'main-reset-view',
    action: 'Reset zoom & pan to 100%',
    description: 'Re-center the canvas viewport and reset zoom to 100%.',
    keys: ['Ctrl', 'Shift', 'Middle Click'],
    workspace: 'main',
    category: 'selection-navigation',
    keywords: ['zoom', 'reset', 'center', 'viewport'],
  },
  {
    id: 'main-alt-redlines',
    action: 'Inspect spacing redlines',
    description: 'Hold Alt and hover another layer or the artboard to view exact pixel distances.',
    keys: ['Alt', 'Hover'],
    workspace: 'main',
    category: 'selection-navigation',
    scopeNote: 'Select / Direct',
    keywords: ['measure', 'distance', 'spacing', 'redlines'],
  },
  {
    id: 'main-draw-constrain',
    action: 'Constrain aspect ratio or 45° angle',
    description: 'Hold Shift while drawing shapes, lines, or resizing to lock proportions or 45° steps.',
    keys: ['Shift', 'Drag'],
    workspace: 'main',
    category: 'drawing-shapes',
    keywords: ['square', 'circle', 'proportional', 'angle'],
  },
  {
    id: 'main-draw-from-center',
    action: 'Draw shape from center',
    description: 'Hold Alt while dragging a new shape to expand symmetrically from the start point.',
    keys: ['Alt', 'Drag'],
    workspace: 'main',
    category: 'drawing-shapes',
    keywords: ['center', 'symmetric', 'draw'],
  },
  {
    id: 'main-draw-sides-live',
    action: 'Adjust polygon sides or star points while drawing',
    description: 'Press Up or Down arrows mid-drag to add or remove sides/spikes live.',
    keys: ['ArrowUp'],
    alternateKeys: ['ArrowDown'],
    workspace: 'main',
    category: 'drawing-shapes',
    scopeNote: 'Polygon / Star',
    keywords: ['polygon', 'star', 'sides', 'spikes'],
  },
  {
    id: 'main-draw-star-ratio',
    action: 'Adjust star inner ratio while drawing',
    description: 'Press Left or Right arrows mid-drag to sharpen or soften star points.',
    keys: ['ArrowLeft'],
    alternateKeys: ['ArrowRight'],
    workspace: 'main',
    category: 'drawing-shapes',
    scopeNote: 'Star tool',
    keywords: ['star', 'ratio', 'spikes'],
  },
  {
    id: 'main-eyedropper-stroke',
    action: 'Sample color directly into Stroke',
    description: 'With Eyedropper (I) active, Shift+Click any surface to apply sampled color to stroke.',
    keys: ['Shift', 'Click'],
    workspace: 'main',
    category: 'drawing-shapes',
    scopeNote: 'Eyedropper',
    keywords: ['color', 'stroke', 'sample'],
  },
  {
    id: 'main-pen-commit',
    action: 'Commit open Pen path',
    description: 'Finish and commit the current open Bezier path without closing the contour.',
    keys: ['Enter'],
    workspace: 'main',
    category: 'vector-craft',
    scopeNote: 'Pen active',
    keywords: ['pen', 'bezier', 'finish', 'commit'],
  },
  {
    id: 'main-pen-undo-anchor',
    action: 'Undo last Pen anchor',
    description: 'Step back and remove the most recently placed anchor while drawing a path.',
    keys: ['Backspace'],
    alternateKeys: ['Delete'],
    workspace: 'main',
    category: 'vector-craft',
    scopeNote: 'Pen active',
    keywords: ['pen', 'anchor', 'undo'],
  },
  {
    id: 'main-shape-builder-subtract',
    action: 'Punch out region with Shape Builder',
    description: 'Hold Alt and click or drag across overlapping regions to subtract them.',
    keys: ['Alt', 'Drag'],
    workspace: 'main',
    category: 'vector-craft',
    scopeNote: 'Shape Builder',
    keywords: ['boolean', 'subtract', 'punch', 'shape builder'],
  },
  {
    id: 'main-nudge-1px',
    action: 'Nudge selection by 1px',
    description: 'Move selected layers in 1px increments using arrow keys.',
    keys: ['Arrows'],
    workspace: 'main',
    category: 'arrange-transform',
    keywords: ['move', 'position', 'nudge', 'arrow'],
  },
  {
    id: 'main-nudge-10px',
    action: 'Nudge selection by 10px',
    description: 'Move selected layers in 10px increments for rapid layout adjustments.',
    keys: ['Shift', 'Arrows'],
    workspace: 'main',
    category: 'arrange-transform',
    keywords: ['move', 'position', 'nudge', 'arrow'],
  },
  {
    id: 'main-align-edges',
    action: 'Align left, right, top, or bottom',
    description: 'Align two or more selected layers along the chosen edge.',
    keys: ['Alt', 'Arrows'],
    workspace: 'main',
    category: 'arrange-transform',
    scopeNote: '2+ selected',
    keywords: ['align', 'left', 'right', 'top', 'bottom', 'layout'],
  },
  {
    id: 'main-distribute-h',
    action: 'Distribute horizontally',
    description: 'Evenly space three or more selected layers along the horizontal axis.',
    keys: ['Alt', 'Shift', 'H'],
    workspace: 'main',
    category: 'arrange-transform',
    scopeNote: '3+ selected',
    keywords: ['distribute', 'spacing', 'horizontal', 'layout'],
  },
  {
    id: 'main-distribute-v',
    action: 'Distribute vertically',
    description: 'Evenly space three or more selected layers along the vertical axis.',
    keys: ['Alt', 'Shift', 'V'],
    workspace: 'main',
    category: 'arrange-transform',
    scopeNote: '3+ selected',
    keywords: ['distribute', 'spacing', 'vertical', 'layout'],
  },
  {
    id: 'main-parametric-tune',
    action: 'Tune selected Polygon sides or Star points',
    description: 'Increment or decrement sides/points on a single selected parametric shape.',
    keys: ['Alt', 'ArrowUp'],
    alternateKeys: ['Alt', 'ArrowDown'],
    workspace: 'main',
    category: 'arrange-transform',
    scopeNote: '1 shape selected',
    keywords: ['polygon', 'star', 'parametric', 'sides'],
  },
  {
    id: 'main-inline-text-commit',
    action: 'Commit inline text edit',
    description: 'Save text changes and exit inline text editing on canvas.',
    keys: ['Mod', 'Enter'],
    workspace: 'main',
    category: 'panels-dialogs',
    scopeNote: 'Text editing',
    keywords: ['text', 'typography', 'save', 'commit'],
  },
];

const COMPONENT_CANVAS_GESTURE_SHORTCUTS: readonly KeyboardShortcutEntry[] = [
  {
    id: 'component-pen-commit',
    action: 'Commit open Pen or Curvature path',
    description: 'Complete the active vector path draft inside the Component master.',
    keys: ['Enter'],
    workspace: 'component',
    category: 'vector-craft',
    scopeNote: 'Pen / Curvature',
    keywords: ['pen', 'curvature', 'bezier', 'commit'],
  },
  {
    id: 'component-pen-undo-anchor',
    action: 'Undo last placed path anchor',
    description: 'Remove the last draft anchor point while plotting with Pen or Curvature.',
    keys: ['Backspace'],
    alternateKeys: ['Delete'],
    workspace: 'component',
    category: 'vector-craft',
    scopeNote: 'Pen / Curvature',
    keywords: ['anchor', 'undo', 'bezier'],
  },
  {
    id: 'component-curvature-corner',
    action: 'Drop sharp corner point (Curvature)',
    description: 'Hold Alt and click with Curvature (U) to place a crisp corner instead of a smooth curve.',
    keys: ['Alt', 'Click'],
    workspace: 'component',
    category: 'vector-craft',
    scopeNote: 'Curvature tool',
    keywords: ['corner', 'cusp', 'curve', 'point'],
  },
  {
    id: 'component-pen-break-cusp',
    action: 'Break handle symmetry (cusp anchor)',
    description: 'Hold Alt while dragging a Pen handle to bend one side independently.',
    keys: ['Alt', 'Drag'],
    workspace: 'component',
    category: 'vector-craft',
    scopeNote: 'Pen / Shape Builder',
    keywords: ['cusp', 'handle', 'bezier', 'asymmetric'],
  },
  {
    id: 'component-delete-anchor',
    action: 'Delete active Bezier anchor',
    description: 'With Direct Selection (A) and an anchor selected, delete that anchor point cleanly.',
    keys: ['Delete'],
    alternateKeys: ['Backspace'],
    workspace: 'component',
    category: 'vector-craft',
    scopeNote: 'Direct Selection',
    keywords: ['anchor', 'node', 'bezier', 'remove'],
  },
  {
    id: 'component-nudge-anchor',
    action: 'Nudge active anchor (1px / 10px)',
    description: 'Precision-nudge the selected Bezier anchor point with arrow keys or Shift+Arrows.',
    keys: ['Arrows'],
    alternateKeys: ['Shift', 'Arrows'],
    workspace: 'component',
    category: 'arrange-transform',
    scopeNote: 'Direct Selection',
    keywords: ['anchor', 'nudge', 'precision', 'arrow'],
  },
  {
    id: 'component-rotate-snap',
    action: 'Snap pivot rotation to 15° steps',
    description: 'Hold Shift while orbiting with Rotate (Shift+R) to snap angles cleanly.',
    keys: ['Shift', 'Drag'],
    workspace: 'component',
    category: 'arrange-transform',
    scopeNote: 'Rotate tool',
    keywords: ['rotate', 'angle', 'pivot', 'snap'],
  },
  {
    id: 'component-space-pan',
    action: 'Temporary Hand pan',
    description: 'Hold Space and drag to pan around the master component artboard.',
    keys: ['Space', 'Drag'],
    workspace: 'component',
    category: 'selection-navigation',
    keywords: ['pan', 'viewport', 'hand'],
  },
  {
    id: 'component-wheel-zoom',
    action: 'Zoom toward cursor',
    description: 'Zoom into fine Bezier handles anchored on your pointer position.',
    keys: ['Mod', 'Scroll'],
    workspace: 'component',
    category: 'selection-navigation',
    keywords: ['zoom', 'wheel', 'magnify'],
  },
];

const LAYERS_AND_PANELS_SHORTCUTS: readonly KeyboardShortcutEntry[] = [
  {
    id: 'layers-group',
    action: 'Group selected layers',
    description: 'Wrap the current layer selection inside a new Group container.',
    keys: ['Mod', 'G'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    keywords: ['group', 'folder', 'hierarchy'],
  },
  {
    id: 'layers-ungroup',
    action: 'Ungroup selection',
    description: 'Dissolve selected Group containers while keeping child layers intact.',
    keys: ['Mod', 'Shift', 'G'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    keywords: ['ungroup', 'flatten', 'hierarchy'],
  },
  {
    id: 'layers-create-mask',
    action: 'Create clipping mask',
    description: 'Clip the selected layer or Group to the shape directly beneath it.',
    keys: ['Mod', 'M'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    scopeNote: '1 root selected',
    keywords: ['clipping', 'mask', 'clip'],
  },
  {
    id: 'layers-release-mask',
    action: 'Release clipping mask',
    description: 'Remove clipping mask binding from the selected masked layer or Group.',
    keys: ['Mod', 'Shift', 'M'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    scopeNote: 'Masked layer',
    keywords: ['unmask', 'clipping', 'mask', 'release'],
  },
  {
    id: 'layers-exact-select',
    action: 'Select exact nested layer',
    description: 'Select an individual layer without selecting its entire parent Group hierarchy.',
    keys: ['Shift', 'Click'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    keywords: ['exact', 'nested', 'select', 'tree'],
  },
  {
    id: 'layers-toggle-select',
    action: 'Toggle layer or group in selection',
    description: 'Add or remove a layer row from the current multi-selection.',
    keys: ['Mod', 'Click'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    keywords: ['multi-select', 'toggle', 'tree'],
  },
  {
    id: 'layers-activate-row',
    action: 'Select focused layer row',
    description: 'Activate the currently keyboard-focused item in the Layers tree.',
    keys: ['Enter'],
    alternateKeys: ['Space'],
    workspace: 'layers-panels',
    category: 'layers-masking',
    scopeNote: 'Layer tree',
    keywords: ['keyboard', 'tree', 'select'],
  },
  {
    id: 'panels-commit-rename',
    action: 'Confirm rename or Inspector value',
    description: 'Commit layer rename, project title edit, new page name, or numeric Inspector field.',
    keys: ['Enter'],
    workspace: 'layers-panels',
    category: 'panels-dialogs',
    keywords: ['rename', 'inspector', 'input', 'save'],
  },
  {
    id: 'panels-resize-step',
    action: 'Resize focused sidebar divider (16px)',
    description: 'Adjust the Layers or Inspector panel width when its vertical divider has focus.',
    keys: ['ArrowLeft'],
    alternateKeys: ['ArrowRight'],
    workspace: 'layers-panels',
    category: 'panels-dialogs',
    scopeNote: 'Divider focus',
    keywords: ['sidebar', 'panel', 'width', 'resize'],
  },
  {
    id: 'panels-resize-fast',
    action: 'Resize focused sidebar divider (32px)',
    description: 'Hold Shift with Left/Right arrows on a focused panel divider for larger steps.',
    keys: ['Shift', 'ArrowLeft'],
    alternateKeys: ['Shift', 'ArrowRight'],
    workspace: 'layers-panels',
    category: 'panels-dialogs',
    scopeNote: 'Divider focus',
    keywords: ['sidebar', 'panel', 'width', 'resize'],
  },
  {
    id: 'panels-resize-bounds',
    action: 'Jump sidebar to min or max width',
    description: 'Press Home or End on a focused panel divider to jump to its width bounds.',
    keys: ['Home'],
    alternateKeys: ['End'],
    workspace: 'layers-panels',
    category: 'panels-dialogs',
    scopeNote: 'Divider focus',
    keywords: ['sidebar', 'panel', 'min', 'max', 'reset'],
  },
];

export const STUDIO_KEYBOARD_SHORTCUTS: readonly KeyboardShortcutEntry[] = [
  ...GLOBAL_SHORTCUTS,
  ...buildToolShortcutsForWorkspace('main'),
  ...MAIN_CANVAS_GESTURE_SHORTCUTS,
  ...buildToolShortcutsForWorkspace('component'),
  ...COMPONENT_CANVAS_GESTURE_SHORTCUTS,
  ...LAYERS_AND_PANELS_SHORTCUTS,
];

export function detectShortcutPlatform(
  navigatorLike?: Pick<Navigator, 'platform' | 'userAgent'> | null,
): ShortcutPlatform {
  const nav = navigatorLike ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return 'standard';
  const raw = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  return /mac|iphone|ipad|ipod/.test(raw) ? 'mac' : 'standard';
}

const STANDARD_KEY_LABELS: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Enter: 'Enter',
  Esc: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Del',
  Space: 'Space',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Arrows: '← ↑ ↓ →',
};

const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Enter: '↩',
  Esc: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Space: 'Space',
  Tab: '⇥',
  Home: 'Home',
  End: 'End',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Arrows: '← ↑ ↓ →',
};

export function formatKeyTokenForPlatform(token: string, platform: ShortcutPlatform): string {
  const map = platform === 'mac' ? MAC_KEY_LABELS : STANDARD_KEY_LABELS;
  return map[token] ?? token;
}

export function formatKeyComboForPlatform(
  tokens: readonly string[],
  platform: ShortcutPlatform,
): string[] {
  return tokens.map((token) => formatKeyTokenForPlatform(token, platform));
}

export function tokenizeShortcutQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function buildSearchHaystack(entry: KeyboardShortcutEntry): string {
  const workspaceMeta = SHORTCUT_WORKSPACE_BY_ID[entry.workspace];
  const categoryMeta = SHORTCUT_CATEGORY_BY_ID[entry.category];
  const primaryStandard = formatKeyComboForPlatform(entry.keys, 'standard').join('+');
  const primaryMac = formatKeyComboForPlatform(entry.keys, 'mac').join('+');
  const altStandard = entry.alternateKeys ? formatKeyComboForPlatform(entry.alternateKeys, 'standard').join('+') : '';
  const altMac = entry.alternateKeys ? formatKeyComboForPlatform(entry.alternateKeys, 'mac').join('+') : '';

  return [
    entry.action,
    entry.description,
    entry.scopeNote ?? '',
    workspaceMeta.label,
    workspaceMeta.shortLabel,
    categoryMeta.label,
    categoryMeta.shortLabel,
    entry.keys.join('+'),
    entry.keys.join(' '),
    primaryStandard,
    primaryStandard.replace(/\+/g, ' '),
    primaryMac,
    altStandard,
    altStandard.replace(/\+/g, ' '),
    altMac,
    ...(entry.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

export function filterKeyboardShortcuts(
  shortcuts: readonly KeyboardShortcutEntry[],
  options: ShortcutFilterOptions,
): KeyboardShortcutEntry[] {
  const tokens = tokenizeShortcutQuery(options.query);

  return shortcuts.filter((entry) => {
    if (options.workspace !== 'all' && entry.workspace !== options.workspace) {
      return false;
    }
    if (options.category !== 'all' && entry.category !== options.category) {
      return false;
    }
    if (tokens.length === 0) return true;
    const haystack = buildSearchHaystack(entry);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function countShortcutsByWorkspace(
  shortcuts: readonly KeyboardShortcutEntry[],
  query: string,
  category: ShortcutActionCategoryFilter = 'all',
): Record<ShortcutWorkspaceFilter, number> {
  const matched = filterKeyboardShortcuts(shortcuts, {
    workspace: 'all',
    category,
    query,
  });
  const counts: Record<ShortcutWorkspaceFilter, number> = {
    all: matched.length,
    global: 0,
    main: 0,
    component: 0,
    'layers-panels': 0,
  };
  for (const entry of matched) {
    counts[entry.workspace] += 1;
  }
  return counts;
}

export function countShortcutsByCategory(
  shortcuts: readonly KeyboardShortcutEntry[],
  query: string,
  workspace: ShortcutWorkspaceFilter = 'all',
): Record<ShortcutActionCategoryFilter, number> {
  const matched = filterKeyboardShortcuts(shortcuts, {
    workspace,
    category: 'all',
    query,
  });
  const counts: Record<ShortcutActionCategoryFilter, number> = {
    all: matched.length,
    'editing-history': 0,
    'selection-navigation': 0,
    'drawing-shapes': 0,
    'vector-craft': 0,
    'arrange-transform': 0,
    'layers-masking': 0,
    'panels-dialogs': 0,
  };
  for (const entry of matched) {
    counts[entry.category] += 1;
  }
  return counts;
}

export function groupShortcutsByWorkspaceAndAction(
  shortcuts: readonly KeyboardShortcutEntry[],
  preferredWorkspace?: 'main' | 'component',
): ShortcutWorkspaceGroup[] {
  const orderedWorkspaces: ShortcutWorkspaceMeta[] = preferredWorkspace === 'component'
    ? [
        SHORTCUT_WORKSPACE_BY_ID.global,
        SHORTCUT_WORKSPACE_BY_ID.component,
        SHORTCUT_WORKSPACE_BY_ID.main,
        SHORTCUT_WORKSPACE_BY_ID['layers-panels'],
      ]
    : [...SHORTCUT_WORKSPACES];

  const groups: ShortcutWorkspaceGroup[] = [];

  for (const workspaceMeta of orderedWorkspaces) {
    const workspaceEntries = shortcuts.filter((entry) => entry.workspace === workspaceMeta.id);
    if (workspaceEntries.length === 0) continue;

    const orderedCategories = workspaceMeta.id === 'component'
      ? [
          SHORTCUT_CATEGORY_BY_ID['vector-craft'],
          ...SHORTCUT_ACTION_CATEGORIES.filter((c) => c.id !== 'vector-craft'),
        ]
      : SHORTCUT_ACTION_CATEGORIES;

    const categories: ShortcutActionGroup[] = [];
    for (const categoryMeta of orderedCategories) {
      const categoryEntries = workspaceEntries.filter((entry) => entry.category === categoryMeta.id);
      if (categoryEntries.length > 0) {
        categories.push({
          category: categoryMeta,
          shortcuts: categoryEntries,
        });
      }
    }

    if (categories.length > 0) {
      groups.push({
        workspace: workspaceMeta,
        categories,
        totalCount: workspaceEntries.length,
      });
    }
  }

  return groups;
}

export interface ShortcutTriggerKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Returns true for `?` (without Ctrl/Cmd/Alt) or `Ctrl/Cmd + /`.
 */
export function isShortcutHelpTrigger(event: ShortcutTriggerKeyEvent): boolean {
  if (event.altKey) return false;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier && event.key === '?') {
    return true;
  }
  if (modifier && !event.shiftKey && event.key === '/') {
    return true;
  }
  return false;
}

import { describe, expect, it, vi } from 'vitest';
import type { RefObject, VNode } from 'preact';

vi.mock('preact/hooks', () => ({
  useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
    const value = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [value, () => {}];
  },
}));

import { createBlankProject, createInitialProject } from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import {
  executeNewProjectAction,
  summarizeProjectForNewProjectDialog,
} from '../src/app/newProjectFlow';
import { NewProjectConfirmDialog } from '../src/app/workspace/NewProjectConfirmDialog';
import {
  GlobalToolbar,
  type GlobalToolbarMenuActions,
  type GlobalToolbarProps,
} from '../src/app/workspace/GlobalToolbar';
import { createToolbarHintStore } from '../src/app/ToolbarHintBar';

interface InspectableVNode {
  type: unknown;
  props: Record<string, unknown>;
}

function isVNode(value: unknown): value is InspectableVNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

function walkVNodes(node: unknown, visit: (vnode: InspectableVNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkVNodes(child, visit);
    return;
  }
  if (!isVNode(node)) return;
  visit(node);
  walkVNodes(node.props.children, visit);
}

function findVNode(root: unknown, predicate: (vnode: InspectableVNode) => boolean): InspectableVNode | null {
  let match: InspectableVNode | null = null;
  walkVNodes(root, (vnode) => {
    if (!match && predicate(vnode)) match = vnode;
  });
  return match;
}

function extractText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (isVNode(node)) return extractText(node.props.children);
  return '';
}

function createRef<T>(): RefObject<T> {
  return { current: null };
}

function createMenuActions(): GlobalToolbarMenuActions {
  return {
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    hasClipboard: false,
    canGroup: false,
    canUngroup: false,
    canMask: false,
    canUnmask: false,
    canPathfinder: false,
    canConvertToPath: false,
    activeToolId: 'select',
    activeThemeId: 'light',
    themes: [{ id: 'light', name: 'Light' }],
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDuplicate: vi.fn(),
    onSelectAll: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onCreateMask: vi.fn(),
    onRemoveMask: vi.fn(),
    onDelete: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onSelectTool: vi.fn(),
    onPathfinder: vi.fn(),
    onConvertToPath: vi.fn(),
    onRotate90: vi.fn(),
    onSelectTheme: vi.fn(),
  };
}

describe('File -> New Project flow', () => {
  it('createBlankProject produces a valid empty project with a unique id', () => {
    const first = createBlankProject();
    const second = createBlankProject('Brand Site');

    expect(validateProject(first).ok).toBe(true);
    expect(validateProject(second).ok).toBe(true);
    expect(first.metadata.name).toBe('Untitled project');
    expect(second.metadata.name).toBe('Brand Site');
    expect(first.metadata.id).not.toBe(second.metadata.id);
    expect(first.pages).toHaveLength(1);
    expect(first.pages[0].document.nodes).toEqual([]);
    expect(first.components).toEqual([]);
  });

  it('summarizes project metadata for the verification dialog', () => {
    const project = createInitialProject('Landing Page');
    const summary = summarizeProjectForNewProjectDialog(project);
    expect(summary).toEqual({
      projectName: 'Landing Page',
      pageCount: 1,
      layerCount: project.pages[0].document.nodes.length,
      componentCount: 0,
    });
  });

  it('save mode exports first, activates a blank project, and preserves stored records', async () => {
    const currentProject = createInitialProject('Marketing Deck');
    const order: string[] = [];
    const exportCurrentProject = vi.fn(async () => {
      order.push('export');
      return { ok: true };
    });
    const persistAndActivateProject = vi.fn(async () => {
      order.push('persist');
    });
    const deleteStoredProject = vi.fn(async () => {
      order.push('delete');
    });
    const replaceCanonicalProject = vi.fn(() => {
      order.push('replace');
      return { status: 'applied' };
    });
    const resetWorkspaceAfterProjectSwitch = vi.fn(() => {
      order.push('reset');
    });

    const outcome = await executeNewProjectAction('save', {
      currentProject,
      exportCurrentProject,
      persistAndActivateProject,
      deleteStoredProject,
      replaceCanonicalProject,
      resetWorkspaceAfterProjectSwitch,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(order).toEqual(['export', 'persist', 'replace', 'reset']);
    expect(deleteStoredProject).not.toHaveBeenCalled();
    expect(outcome.project.pages[0].document.nodes).toEqual([]);
    expect(outcome.project.metadata.id).not.toBe(currentProject.metadata.id);
    expect(outcome.notice).toContain('Saved "Marketing Deck.flop"');
  });

  it('save mode aborts cleanly without replacing the active project when export fails', async () => {
    const currentProject = createInitialProject('Client Work');
    const persistAndActivateProject = vi.fn(async () => undefined);
    const deleteStoredProject = vi.fn(async () => undefined);
    const replaceCanonicalProject = vi.fn(() => ({ status: 'applied' }));
    const resetWorkspaceAfterProjectSwitch = vi.fn();

    const outcome = await executeNewProjectAction('save', {
      currentProject,
      exportCurrentProject: vi.fn(async () => ({ ok: false, error: 'Disk quota exceeded' })),
      persistAndActivateProject,
      deleteStoredProject,
      replaceCanonicalProject,
      resetWorkspaceAfterProjectSwitch,
    });

    expect(outcome).toEqual({
      ok: false,
      mode: 'save',
      stage: 'export',
      error: 'Disk quota exceeded',
    });
    expect(persistAndActivateProject).not.toHaveBeenCalled();
    expect(deleteStoredProject).not.toHaveBeenCalled();
    expect(replaceCanonicalProject).not.toHaveBeenCalled();
    expect(resetWorkspaceAfterProjectSwitch).not.toHaveBeenCalled();
  });

  it('delete mode skips export, switches to a blank project, and deletes the previous stored project', async () => {
    const currentProject = createInitialProject('Scratchpad');
    const order: string[] = [];
    const exportCurrentProject = vi.fn(async () => ({ ok: true }));
    const persistAndActivateProject = vi.fn(async () => {
      order.push('persist');
    });
    const deleteStoredProject = vi.fn(async (id: string) => {
      order.push(`delete:${id}`);
    });
    const replaceCanonicalProject = vi.fn(() => {
      order.push('replace');
      return { status: 'applied' };
    });
    const resetWorkspaceAfterProjectSwitch = vi.fn(() => {
      order.push('reset');
    });

    const outcome = await executeNewProjectAction('delete', {
      currentProject,
      exportCurrentProject,
      persistAndActivateProject,
      deleteStoredProject,
      replaceCanonicalProject,
      resetWorkspaceAfterProjectSwitch,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(exportCurrentProject).not.toHaveBeenCalled();
    expect(order).toEqual(['persist', 'replace', 'reset', `delete:${currentProject.metadata.id}`]);
    expect(deleteStoredProject).toHaveBeenCalledWith(currentProject.metadata.id);
    expect(outcome.project.pages[0].document.nodes).toEqual([]);
    expect(outcome.notice).toContain('Deleted "Scratchpad"');
  });

  it('NewProjectConfirmDialog renders Save, Delete, and Cancel actions with accessible semantics', () => {
    const onSaveAndCreateNew = vi.fn();
    const onDeleteAndCreateNew = vi.fn();
    const onCancel = vi.fn();

    const tree = NewProjectConfirmDialog({
      open: true,
      summary: { projectName: 'First canvas', pageCount: 1, layerCount: 7, componentCount: 2 },
      busyMode: null,
      errorMessage: null,
      hostRef: createRef<HTMLDivElement>(),
      dialogRef: createRef<HTMLElement>(),
      onSaveAndCreateNew,
      onDeleteAndCreateNew,
      onCancel,
    }) as VNode;

    const dialog = findVNode(tree, (v) => v.props.role === 'dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.props['aria-modal']).toBe('true');

    const saveBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-save-btn');
    const deleteBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-delete-btn');
    const cancelBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-cancel-btn');

    expect(saveBtn).not.toBeNull();
    expect(deleteBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    expect(extractText(saveBtn)).toContain('Save & New Project');
    expect(extractText(deleteBtn)).toContain('Delete & Start New');
    expect(extractText(cancelBtn)).toContain('Cancel');

    (saveBtn!.props.onClick as () => void)();
    (deleteBtn!.props.onClick as () => void)();
    (cancelBtn!.props.onClick as () => void)();

    expect(onSaveAndCreateNew).toHaveBeenCalledOnce();
    expect(onDeleteAndCreateNew).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('NewProjectConfirmDialog disables buttons while busy and renders inline error alert', () => {
    const tree = NewProjectConfirmDialog({
      open: true,
      summary: { projectName: 'First canvas', pageCount: 1, layerCount: 7, componentCount: 0 },
      busyMode: 'save',
      errorMessage: 'Export failed unexpectedly.',
      hostRef: createRef<HTMLDivElement>(),
      dialogRef: createRef<HTMLElement>(),
      onSaveAndCreateNew: vi.fn(),
      onDeleteAndCreateNew: vi.fn(),
      onCancel: vi.fn(),
    }) as VNode;

    const saveBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-save-btn');
    const deleteBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-delete-btn');
    const cancelBtn = findVNode(tree, (v) => v.props['data-testid'] === 'new-project-cancel-btn');
    const alert = findVNode(tree, (v) => v.props.role === 'alert');

    expect(saveBtn!.props.disabled).toBe(true);
    expect(deleteBtn!.props.disabled).toBe(true);
    expect(cancelBtn!.props.disabled).toBe(true);
    expect(alert).not.toBeNull();
    expect(extractText(alert)).toContain('Export failed unexpectedly.');
  });

  it('GlobalToolbar File menu renders New Project… and invokes onRequestNewProject', () => {
    const onRequestNewProject = vi.fn();
    const onCloseMenus = vi.fn();
    const props: GlobalToolbarProps = {
      projectName: 'First canvas',
      isHydrating: false,
      openMenu: 'file',
      menuActions: createMenuActions(),
      menuBarRef: createRef<HTMLDivElement>(),
      projectFileInputRef: createRef<HTMLInputElement>(),
      pagesRackToggleRef: createRef<HTMLButtonElement>(),
      componentRackToggleRef: createRef<HTMLButtonElement>(),
      tokensRackToggleRef: createRef<HTMLButtonElement>(),
      projectNameEditing: false,
      projectNameDraft: 'First canvas',
      pagesRackOpen: false,
      componentRackOpen: false,
      tokensRackOpen: false,
      layersVisible: true,
      inspectorVisible: true,
      canvasClosed: false,
      canvasMinimized: false,
      componentCanvasOpen: false,
      componentCanvasClosed: true,
      componentCanvasMinimized: false,
      nodeLogicOpen: false,
      nodeLogicClosed: true,
      nodeLogicMinimized: false,
      codeWorkspaceOpen: false,
      motionTimelineOpen: false,
      shortcutsModalOpen: false,
      toolbarHintStore: createToolbarHintStore(),
      onToggleMenu: vi.fn(),
      onCloseMenus,
      onRequestNewProject,
      onOpenProjectPicker: vi.fn(),
      onProjectFileSelected: vi.fn(),
      onExportCurrentProject: vi.fn(),
      onExportActiveCanvasSvg: vi.fn(),
      onExportActiveCanvasPng: vi.fn(),
      onResetWindowLayout: vi.fn(),
      onOpenShortcutsModal: vi.fn(),
      onStartProjectRename: vi.fn(),
      onProjectNameDraftChange: vi.fn(),
      onCommitProjectRename: vi.fn(),
      onCancelProjectRename: vi.fn(),
      onTogglePagesRack: vi.fn(),
      onToggleComponentRack: vi.fn(),
      onToggleTokensRack: vi.fn(),
      onToggleLayersVisible: vi.fn(),
      onToggleInspectorVisible: vi.fn(),
      onToggleMainCanvas: vi.fn(),
      onToggleComponentCanvas: vi.fn(),
      onToggleNodeLogic: vi.fn(),
      onToggleCodeWorkspace: vi.fn(),
      onToggleMotionTimeline: vi.fn(),
      onEnterFullscreen: vi.fn(),
      onUpdateToolbarHint: vi.fn(),
    };

    const tree = GlobalToolbar(props) as VNode;
    const newProjectBtn = findVNode(tree, (v) => v.props['data-testid'] === 'file-new-project-btn');
    expect(newProjectBtn).not.toBeNull();
    expect(extractText(newProjectBtn)).toContain('New Project');
    (newProjectBtn!.props.onClick as () => void)();
    expect(onCloseMenus).toHaveBeenCalledOnce();
    expect(onRequestNewProject).toHaveBeenCalledOnce();
  });
});

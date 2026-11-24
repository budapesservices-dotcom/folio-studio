import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX, RefObject, VNode } from 'preact';

const stateCell = vi.hoisted(() => ({
  value: null as unknown,
  initialized: false,
}));

vi.mock('preact/hooks', () => ({
  useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
    if (!stateCell.initialized) {
      stateCell.value = typeof initial === 'function' ? (initial as () => T)() : initial;
      stateCell.initialized = true;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      stateCell.value = typeof next === 'function'
        ? (next as (prev: T) => T)(stateCell.value as T)
        : next;
    };
    return [stateCell.value as T, setState];
  },
}));

import { createInitialProject } from '../src/core/document/factory';
import {
  MAX_PROJECT_SIZE,
  ProjectFileSizeLimitError,
} from '../src/core/persistence/projectPortability';
import { createToolbarHintStore } from '../src/app/ToolbarHintBar';
import {
  GlobalToolbar,
  type GlobalToolbarMenuActions,
  type GlobalToolbarProps,
} from '../src/app/workspace/GlobalToolbar';
import type { ProjectImportOutcome } from '../src/app/workspace/useProjectFileLifecycle';

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
    if (!match && predicate(vnode)) {
      match = vnode;
    }
  });
  return match;
}

function extractText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (isVNode(node)) return extractText(node.props.children);
  return '';
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

function createRef<T>(): RefObject<T> {
  return { current: null };
}

function buildProps(overrides: Partial<GlobalToolbarProps> = {}): GlobalToolbarProps {
  return {
    projectName: 'Demo',
    isHydrating: false,
    openMenu: null,
    menuActions: createMenuActions(),
    menuBarRef: createRef<HTMLDivElement>(),
    projectFileInputRef: createRef<HTMLInputElement>(),
    pagesRackToggleRef: createRef<HTMLButtonElement>(),
    componentRackToggleRef: createRef<HTMLButtonElement>(),
    tokensRackToggleRef: createRef<HTMLButtonElement>(),
    projectNameEditing: false,
    projectNameDraft: 'Demo',
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
    onCloseMenus: vi.fn(),
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
    ...overrides,
  };
}

function renderToolbar(props: GlobalToolbarProps): VNode {
  return GlobalToolbar(props) as VNode;
}

function createFileChangeEvent(file: File): JSX.TargetedEvent<HTMLInputElement, Event> {
  const input = {
    files: [file] as unknown as FileList,
    value: 'C:\\fakepath\\oversized.flop',
  } as unknown as HTMLInputElement;
  return { currentTarget: input } as JSX.TargetedEvent<HTMLInputElement, Event>;
}

describe('GlobalToolbar project import size validation error display', () => {
  beforeEach(() => {
    stateCell.value = null;
    stateCell.initialized = false;
  });

  it('catches and displays the size validation error returned by handleProjectFileSelected', async () => {
    const sizeError = new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: MAX_PROJECT_SIZE + 2 * 1024 * 1024,
      maxBytes: MAX_PROJECT_SIZE,
      largestAsset: {
        id: 'asset-hero',
        name: 'hero-4k.png',
        rawBytes: 18 * 1024 * 1024,
        serializedBytes: 24 * 1024 * 1024,
      },
    });

    const onProjectFileSelected = vi.fn(
      async (): Promise<ProjectImportOutcome> => ({ ok: false, error: sizeError.message }),
    );
    const props = buildProps({ onProjectFileSelected });

    const initialTree = renderToolbar(props);
    expect(findVNode(initialTree, (v) => v.props.role === 'alert')).toBeNull();

    const fileInput = findVNode(initialTree, (v) => v.type === 'input' && v.props.type === 'file');
    expect(fileInput).not.toBeNull();

    const file = new File(['{}'], 'oversized.flop', { type: 'application/json' });
    const onChange = fileInput!.props.onChange as (event: JSX.TargetedEvent<HTMLInputElement, Event>) => Promise<void>;
    await onChange(createFileChangeEvent(file));

    expect(onProjectFileSelected).toHaveBeenCalledWith(file);

    const errorTree = renderToolbar(props);
    const alertBanner = findVNode(errorTree, (v) => v.props.role === 'alert');
    expect(alertBanner).not.toBeNull();
    expect(extractText(alertBanner)).toContain('Project import blocked');
    expect(extractText(alertBanner)).toContain(sizeError.message);
    expect(extractText(alertBanner)).toContain('hero-4k.png');

    // Dismissing the error alert removes it cleanly.
    const dismissButton = findVNode(
      alertBanner,
      (v) => v.type === 'button' && v.props.class === 'project-import-error-dismiss',
    );
    expect(dismissButton).not.toBeNull();
    (dismissButton!.props.onClick as () => void)();

    const clearedTree = renderToolbar(props);
    expect(findVNode(clearedTree, (v) => v.props.role === 'alert')).toBeNull();
  });

  it('catches rejected ProjectFileSizeLimitError exceptions and clears them on a subsequent valid import', async () => {
    const thrownError = new ProjectFileSizeLimitError({
      direction: 'import',
      actualBytes: MAX_PROJECT_SIZE + 512 * 1024,
      maxBytes: MAX_PROJECT_SIZE,
    });

    const onProjectFileSelected = vi.fn<GlobalToolbarProps['onProjectFileSelected']>()
      .mockRejectedValueOnce(thrownError)
      .mockResolvedValueOnce({
        ok: true,
        project: createInitialProject(),
        warningMessage: null,
      });

    const props = buildProps({ onProjectFileSelected });
    const tree1 = renderToolbar(props);
    const fileInput = findVNode(tree1, (v) => v.type === 'input' && v.props.type === 'file');
    const onChange = fileInput!.props.onChange as (event: JSX.TargetedEvent<HTMLInputElement, Event>) => Promise<void>;

    await onChange(createFileChangeEvent(new File(['{}'], 'too-big.flop')));

    const errorTree = renderToolbar(props);
    const alertBanner = findVNode(errorTree, (v) => v.props.role === 'alert');
    expect(alertBanner).not.toBeNull();
    expect(extractText(alertBanner)).toContain(thrownError.message);

    // Selecting a valid project afterwards clears the alert.
    const nextInput = findVNode(errorTree, (v) => v.type === 'input' && v.props.type === 'file');
    const nextOnChange = nextInput!.props.onChange as (event: JSX.TargetedEvent<HTMLInputElement, Event>) => Promise<void>;
    await nextOnChange(createFileChangeEvent(new File(['{}'], 'valid.flop')));

    const recoveredTree = renderToolbar(props);
    expect(findVNode(recoveredTree, (v) => v.props.role === 'alert')).toBeNull();
  });

  it('clears an existing import error when the user opens the File -> Open Project picker', async () => {
    const onOpenProjectPicker = vi.fn();
    const onProjectFileSelected = vi.fn(
      async (): Promise<ProjectImportOutcome> => ({ ok: false, error: 'Project exceeds 25 MB limit.' }),
    );
    const props = buildProps({
      openMenu: 'file',
      onOpenProjectPicker,
      onProjectFileSelected,
    });

    const tree1 = renderToolbar(props);
    const fileInput = findVNode(tree1, (v) => v.type === 'input' && v.props.type === 'file');
    await (fileInput!.props.onChange as (event: JSX.TargetedEvent<HTMLInputElement, Event>) => Promise<void>)(
      createFileChangeEvent(new File(['{}'], 'too-big.flop')),
    );

    const treeWithError = renderToolbar(props);
    expect(findVNode(treeWithError, (v) => v.props.role === 'alert')).not.toBeNull();

    const openProjectBtn = findVNode(
      treeWithError,
      (v) => v.type === 'button' && v.props.role === 'menuitem' && extractText(v).includes('Open Project'),
    );
    expect(openProjectBtn).not.toBeNull();
    (openProjectBtn!.props.onClick as () => void)();

    expect(onOpenProjectPicker).toHaveBeenCalledOnce();
    const clearedTree = renderToolbar(props);
    expect(findVNode(clearedTree, (v) => v.props.role === 'alert')).toBeNull();
  });
});

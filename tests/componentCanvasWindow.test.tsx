import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { createEmptyDocument } from '../src/core/document/factory';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { ComponentDefinition, DesignNode, FolioDocument } from '../src/core/document/types';
import { DEFAULT_CANVAS_TOOL_OPTIONS } from '../src/engines/canvas/tools/types';
import { Canvas } from '../src/engines/canvas/Canvas';
import {
  ComponentCanvasWindow,
  normalizeCanvasDocument,
  type ComponentCanvasWindowProps,
} from '../src/app/workspace/CanvasWindows';
import { InspectorPanel, type InspectorPanelProps } from '../src/app/InspectorPanel';

function findVNodes(node: unknown, predicate: (vnode: VNode<Record<string, unknown>>) => boolean): Array<VNode<Record<string, unknown>>> {
  const results: Array<VNode<Record<string, unknown>>> = [];
  const visit = (current: unknown) => {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const candidate = current as VNode<Record<string, unknown>>;
    if ('type' in candidate && 'props' in candidate) {
      if (predicate(candidate)) results.push(candidate);
      const props = candidate.props;
      if (props && 'children' in props) visit(props.children);
    }
  };
  visit(node);
  return results;
}

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as VNode<Record<string, unknown>>).props;
    return props && 'children' in props ? getTextContent(props.children) : '';
  }
  return '';
}

function makeComponentCanvasProps(overrides: Partial<ComponentCanvasWindowProps> = {}): ComponentCanvasWindowProps {
  return {
    visible: true,
    minimized: false,
    closed: false,
    floating: false,
    position: { x: 0, y: 0 },
    size: { width: 680, height: 520 },
    zIndex: 10,
    document: createEmptyDocument('Component Canvas', 420, 280),
    components: [],
    designTokens: createDefaultDesignTokens(),
    editingComponent: null,
    selectedNodeIds: [],
    selectedComponentNodes: [],
    toolId: 'select',
    toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
    zoom: 1,
    pan: { x: 0, y: 0 },
    canUndo: false,
    canRedo: false,
    recoveryStatus: 'none',
    pendingOpenComponentName: null,
    hasPendingDeletion: false,
    showRetryCleanupButton: false,
    onPositionChange: vi.fn(),
    onSizeChange: vi.fn(),
    onFocus: vi.fn(),
    onFocusMinimized: vi.fn(),
    onHoverHint: vi.fn(),
    onReloadRecoveredMaster: vi.fn(),
    onKeepCurrentBuffer: vi.fn(),
    onDiscardAndOpenPending: vi.fn(),
    onOpenCleanupDialog: vi.fn(),
    onSaveMaster: vi.fn(),
    onSaveSelectionAsNew: vi.fn(),
    onAlign: vi.fn(),
    onDistribute: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onZoomChange: vi.fn(),
    onMinimize: vi.fn(),
    onRestore: vi.fn(),
    onToggleFloating: vi.fn(),
    onClose: vi.fn(),
    onCloseMinimized: vi.fn(),
    onChangeToolOptions: vi.fn(),
    onPathfinder: vi.fn(),
    onConvertToPath: vi.fn(),
    onFlip: vi.fn(),
    onRotate90: vi.fn(),
    onSimplifyPath: vi.fn(),
    onTogglePathClosed: vi.fn(),
    onSelectTool: vi.fn(),
    onToolOperation: vi.fn(),
    onToolOperationBatch: vi.fn(),
    onLayerDrop: vi.fn(),
    ...overrides,
  };
}

function makeInspectorProps(overrides: Partial<InspectorPanelProps> = {}): InspectorPanelProps {
  return {
    visible: true,
    width: 280,
    isResizing: false,
    resizeHandleRef: { current: null },
    activeEditorId: 'component',
    selectedNode: null,
    selectedNodes: [],
    selectedCount: 0,
    canRemoveFromCanvas: true,
    selectedInstanceComponent: null,
    editingMasterComponent: null,
    instanceOverrideTargets: null,
    activeBreakpoint: 'desktop',
    designTokens: createDefaultDesignTokens(),
    defaultFillColor: '#8B7CF6',
    renderIcon: () => <span />,
    onStartResize: vi.fn(),
    onResizeDoubleClick: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onCommitEdit: vi.fn(),
    onHoverHint: vi.fn(),
    onRemoveFromCanvas: vi.fn(),
    onUpdateSelected: vi.fn(),
    onUpdateSelectedStyle: vi.fn(),
    onApplyAutoLayout: vi.fn(),
    onUpdateInstanceOverride: vi.fn(),
    onUpdateInstanceVariant: vi.fn(),
    onUpdateInstanceSlot: vi.fn(),
    onUpdateMasterContract: vi.fn(),
    onResetInstanceOverrides: vi.fn(),
    onDetachInstance: vi.fn(),
    onConvertToPath: vi.fn(),
    onTogglePathClosed: vi.fn(),
    onSimplifyPath: vi.fn(),
    onChooseTool: vi.fn(),
    onQuickAdd: vi.fn(),
    onDuplicateSelection: vi.fn(),
    onCopySelection: vi.fn(),
    ...overrides,
  };
}

describe('ComponentCanvasWindow null/empty document handling & Inspector Quick-add initialization', () => {
  it('normalizes null, undefined, and nullish-nodes documents safely', () => {
    expect(normalizeCanvasDocument(null)).toBeNull();
    expect(normalizeCanvasDocument(undefined)).toBeNull();

    const emptyDoc = createEmptyDocument('Empty Master', 420, 280);
    expect(normalizeCanvasDocument(emptyDoc)).toBe(emptyDoc);

    const malformedDoc = { ...emptyDoc, nodes: null as unknown as DesignNode[] };
    const normalized = normalizeCanvasDocument(malformedDoc);
    expect(normalized).not.toBeNull();
    expect(normalized?.nodes).toEqual([]);
  });

  it('renders ComponentCanvasWindow gracefully when document is null without mounting Canvas', () => {
    const tree = ComponentCanvasWindow(makeComponentCanvasProps({ document: null }));

    const canvasNodes = findVNodes(tree, (v) => (v.type as unknown) === Canvas);
    expect(canvasNodes).toHaveLength(0);

    const emptyFallback = findVNodes(tree, (v) => v.props.class === 'component-canvas-empty');
    expect(emptyFallback).toHaveLength(1);

    const saveMasterBtn = findVNodes(tree, (v) => v.props.class === 'component-master-save-button')[0];
    expect(saveMasterBtn?.props.disabled).toBe(true);
  });

  it('normalizes nullish document.nodes inside ComponentCanvasWindow and still mounts Canvas for empty artboards', () => {
    const docWithNullNodes = {
      ...createEmptyDocument('Empty Master', 420, 280),
      nodes: null as unknown as DesignNode[],
    } as FolioDocument;

    const tree = ComponentCanvasWindow(makeComponentCanvasProps({ document: docWithNullNodes }));

    const canvasNodes = findVNodes(tree, (v) => (v.type as unknown) === Canvas);
    expect(canvasNodes).toHaveLength(1);
    expect((canvasNodes[0].props.document as FolioDocument).nodes).toEqual([]);

    const saveMasterBtn = findVNodes(tree, (v) => v.props.class === 'component-master-save-button')[0];
    expect(saveMasterBtn?.props.disabled).toBe(true);
  });

  it('mounts Inspector Quick-add Rectangle when editing an empty Master Component and invokes onQuickAdd("rect")', () => {
    const onQuickAdd = vi.fn();
    const emptyMaster: ComponentDefinition = {
      id: 'comp-empty-1',
      name: 'Empty Card',
      document: createEmptyDocument('Empty Card', 420, 280),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const tree = InspectorPanel(
      makeInspectorProps({
        activeEditorId: 'component',
        editingMasterComponent: emptyMaster,
        selectedNode: null,
        selectedNodes: [],
        selectedCount: 2, // Stale selectedCount must NOT suppress empty quick-add controls
        onQuickAdd,
      }),
    );

    const quickAddContainers = findVNodes(tree, (v) => v.props.class === 'quick-add');
    expect(quickAddContainers).toHaveLength(1);

    const buttons = findVNodes(quickAddContainers[0], (v) => v.type === 'button');
    const rectButton = buttons.find((button) => getTextContent(button).includes('Rectangle'));
    expect(rectButton).toBeTruthy();

    (rectButton?.props.onClick as () => void)();
    expect(onQuickAdd).toHaveBeenCalledWith('rect');
  });

  it('mounts Inspector Quick-add Rectangle when Component Canvas is empty without an active master', () => {
    const onQuickAdd = vi.fn();
    const tree = InspectorPanel(
      makeInspectorProps({
        activeEditorId: 'component',
        editingMasterComponent: null,
        selectedNode: null,
        selectedNodes: [],
        selectedCount: 0,
        onQuickAdd,
      }),
    );

    const quickAddContainers = findVNodes(tree, (v) => v.props.class === 'quick-add');
    expect(quickAddContainers).toHaveLength(1);

    const rectButton = findVNodes(quickAddContainers[0], (v) => v.type === 'button')
      .find((button) => getTextContent(button).includes('Rectangle'));
    expect(rectButton).toBeTruthy();

    (rectButton?.props.onClick as () => void)();
    expect(onQuickAdd).toHaveBeenCalledWith('rect');
  });
});

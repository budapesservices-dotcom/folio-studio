import type { JSX, RefObject } from 'preact';
import type {
  AnimatableProperty,
  AssetReference,
  BreakpointId,
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DesignTokenCollection,
  EllipseNode,
  FolioProject,
  FrameNode,
  LayoutMode,
  PathNode,
  RectNode,
  TextNode,
} from '../../core/document/types';
import { isShapeContainerCapable, isShapeContainerNode } from '../../core/document/layers';
import type { CanvasToolId, ShapeColorBlendMode } from '../../core/tools/operationContract';
import type { EditorTarget } from '../editorContext';
import type { ResizablePanelId } from '../panelResize';
import type { StudioVectorActions } from './inspectorVectorHelpers';
import type {
  QuickInteractionConfig,
  QuickInteractionEntry,
  QuickInteractionScopeContext,
} from './quickInteractions';
import type { StudioContextMenuEntry } from './StudioContextMenu';

export interface InspectorOverrideTargets {
  fillNode?: FrameNode | RectNode | EllipseNode | PathNode | TextNode | null;
  textNode?: TextNode | null;
}

export interface InspectorPanelProps {
  visible: boolean;
  width: number;
  isResizing: boolean;
  resizeHandleRef: RefObject<HTMLDivElement>;
  activeEditorId: EditorTarget;
  selectedNode: DesignNode | null;
  selectedNodes: readonly DesignNode[];
  selectedCount: number;
  canRemoveFromCanvas: boolean;
  selectedInstanceComponent: ComponentDefinition | null;
  editingMasterComponent?: ComponentDefinition | null;
  instanceOverrideTargets: InspectorOverrideTargets | null;
  activeBreakpoint: BreakpointId;
  designTokens: DesignTokenCollection;
  assets?: readonly AssetReference[];
  defaultFillColor: string;
  renderIcon: (name: 'trash' | 'layers' | 'cursor') => JSX.Element;
  onStartResize: (panel: ResizablePanelId, event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  onResizeDoubleClick: (panel: ResizablePanelId, event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (panel: ResizablePanelId, event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
  onCommitEdit: () => void;
  onHoverHint: () => void;
  onRemoveFromCanvas: (nodeId: string) => void;
  onUpdateSelected: (patch: Partial<DesignNode>, coalesceKey?: string) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>, coalesceKey?: string) => void;
  onTogglePropertyKeyframe?: (nodeId: string, property: AnimatableProperty) => void;
  isPropertyKeyedAtPlayhead?: (nodeId: string, property: AnimatableProperty) => boolean;
  positionLockedByMotionPath?: boolean;
  autoOrientByMotionPath?: boolean;
  onApplyAutoLayout: (containerId: string) => void;
  onConvertFrameLayoutMode?: (containerId: string, mode: LayoutMode) => void;
  onSwitchBreakpoint?: (bp: BreakpointId) => void;
  onUpdateInstanceOverride: (childNodeId: string, patch: { fill?: string; text?: string }) => void;
  onUpdateInstanceVariant: (axisId: string, optionId: string) => void;
  onUpdateInstanceSlot: (slotId: string, patch: { text?: string; visible?: boolean }) => void;
  onUpdateMasterContract: (
    component: ComponentDefinition,
    patch: {
      variants?: ComponentVariantAxis[];
      slots?: ComponentSlotDefinition[];
      nodeLogicEnabled?: boolean;
    },
  ) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  onResetInstanceOverrides: () => void;
  onDetachInstance: () => void;
  onConvertToPath: (target: EditorTarget) => void;
  onTogglePathClosed: (target: EditorTarget) => void;
  onSimplifyPath: (target: EditorTarget) => void;
  onChooseTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  onQuickAdd: (type: 'rect' | 'text') => void;
  onInsertImageFiles?: (files: readonly File[]) => void;
  onImportFontFiles?: (files: readonly File[]) => void;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
  project?: FolioProject;
  activePageId?: string;
  scopedNodes?: readonly DesignNode[];
  onCreateQuickInteraction?: (
    scopeContext: QuickInteractionScopeContext,
    config: QuickInteractionConfig,
  ) => { entryId: string } | null;
  onUpdateQuickInteraction?: (
    entry: QuickInteractionEntry,
    layerId: string,
    nextConfig: QuickInteractionConfig,
  ) => void;
  onDeleteQuickInteraction?: (entry: QuickInteractionEntry) => void;
  onOpenInteractionInNodeGraph?: (graphId: string, nodeIds: readonly string[]) => void;
  colorBlendMode?: ShapeColorBlendMode;
  onChangeColorBlendMode?: (mode: ShapeColorBlendMode) => void;
  onPromoteSelectionToComponent?: () => void;
  studioActions?: StudioVectorActions;
}

export type InspectorAccordionSectionId =
  | 'layout-frame'
  | 'size-position'
  | 'appearance'
  | 'text'
  | 'modern-effects'
  | 'responsive-semantic'
  | 'component-logic';

export function getDefaultInspectorOpenSections(
  nodeType: DesignNode['type'],
): Record<InspectorAccordionSectionId, boolean> {
  return {
    'size-position': true,
    appearance: true,
    text: nodeType === 'text',
    'layout-frame': nodeType === 'frame' || nodeType === 'group',
    'modern-effects': false,
    'responsive-semantic': false,
    'component-logic': nodeType === 'component-instance',
  };
}

export function resolveInspectorLayoutBadge(
  selectedNode: DesignNode,
  parentNode: DesignNode | null,
): string {
  const parentLayout = parentNode?.layout;
  if (selectedNode.type === 'frame' || selectedNode.type === 'group' || isShapeContainerNode(selectedNode)) {
    if (selectedNode.layout?.mode === 'flex') return 'STACK';
    if (selectedNode.layout?.mode === 'grid') return 'GRID';
    if (isShapeContainerNode(selectedNode)) {
      return selectedNode.clipContent ? 'CLIP' : 'BOX';
    }
    return 'FREE';
  }
  if (parentLayout?.mode === 'grid') return 'GRID ITEM';
  if (parentLayout?.mode === 'flex') return 'STACK ITEM';
  return 'WEB';
}

export interface BuildInspectorContextEntriesOptions {
  selectedNode: DesignNode;
  canRemoveFromCanvas: boolean;
  allExpanded: boolean;
  openCount: number;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
  onSetAllSectionsOpen: (open: boolean) => void;
  onRemoveFromCanvas: (nodeId: string) => void;
  onPromoteSelectionToComponent?: () => void;
}

export function buildInspectorContextEntries(
  options: BuildInspectorContextEntriesOptions,
): StudioContextMenuEntry[] {
  const {
    selectedNode,
    canRemoveFromCanvas,
    allExpanded,
    openCount,
    onDuplicateSelection,
    onCopySelection,
    onUpdateSelected,
    onCommitEdit,
    onSetAllSectionsOpen,
    onRemoveFromCanvas,
    onPromoteSelectionToComponent,
  } = options;

  const isShapeContainer = isShapeContainerNode(selectedNode);
  const canBeShapeContainer = isShapeContainerCapable(selectedNode);

  return [
    {
      kind: 'header',
      id: 'hdr-node',
      label: selectedNode.name,
      meta: isShapeContainer ? 'SHAPE CONTAINER' : selectedNode.type.toUpperCase(),
    },
    {
      kind: 'item',
      id: 'dup',
      label: 'Duplicate Layer',
      shortcut: ['Mod', 'D'],
      onSelect: onDuplicateSelection,
    },
    {
      kind: 'item',
      id: 'copy',
      label: 'Copy Layer',
      shortcut: ['Mod', 'C'],
      onSelect: onCopySelection,
    },
    ...(canBeShapeContainer
      ? [
          {
            kind: 'item' as const,
            id: 'toggle-shape-container',
            label: isShapeContainer ? 'Release Container' : 'Set as Container',
            onSelect: () => {
              onUpdateSelected(
                (isShapeContainer
                  ? { isContainer: false, clipContent: false }
                  : { isContainer: true, clipContent: false }) as Partial<DesignNode>,
              );
              onCommitEdit();
            },
          },
        ]
      : []),
    ...(onPromoteSelectionToComponent && (selectedNode.type === 'group' || isShapeContainer)
      ? [
          {
            kind: 'item' as const,
            id: 'promote-component',
            label: 'Promote to Component',
            tone: 'accent' as const,
            onSelect: onPromoteSelectionToComponent,
          },
        ]
      : []),
    { kind: 'divider', id: 'div-1' },
    {
      kind: 'item',
      id: 'toggle-vis',
      label: selectedNode.visible ? 'Hide Layer' : 'Show Layer',
      shortcut: ['Mod', 'Shift', 'H'],
      onSelect: () => {
        onUpdateSelected({ visible: !selectedNode.visible });
        onCommitEdit();
      },
    },
    {
      kind: 'item',
      id: 'toggle-lock',
      label: selectedNode.locked ? 'Unlock Layer' : 'Lock Layer',
      shortcut: ['Mod', 'Shift', 'L'],
      onSelect: () => {
        onUpdateSelected({ locked: !selectedNode.locked });
        onCommitEdit();
      },
    },
    {
      kind: 'item',
      id: 'reset-rot',
      label: 'Reset Rotation (0°)',
      disabled: Math.abs(selectedNode.rotation) < 0.001,
      onSelect: () => {
        onUpdateSelected({ rotation: 0 });
        onCommitEdit();
      },
    },
    {
      kind: 'item',
      id: 'reset-op',
      label: 'Reset Opacity (100%)',
      disabled: Math.abs(selectedNode.opacity - 1) < 0.001,
      onSelect: () => {
        onUpdateSelected({ opacity: 1 });
        onCommitEdit();
      },
    },
    { kind: 'divider', id: 'div-2' },
    {
      kind: 'item',
      id: 'expand-all',
      label: 'Expand All Sections',
      disabled: allExpanded,
      onSelect: () => onSetAllSectionsOpen(true),
    },
    {
      kind: 'item',
      id: 'collapse-all',
      label: 'Collapse All Sections',
      disabled: openCount === 0,
      onSelect: () => onSetAllSectionsOpen(false),
    },
    ...(canRemoveFromCanvas
      ? [
          { kind: 'divider' as const, id: 'div-3' },
          {
            kind: 'item' as const,
            id: 'remove',
            label: 'Remove from Canvas',
            shortcut: ['Delete'],
            tone: 'danger' as const,
            onSelect: () => onRemoveFromCanvas(selectedNode.id),
          },
        ]
      : []),
  ];
}

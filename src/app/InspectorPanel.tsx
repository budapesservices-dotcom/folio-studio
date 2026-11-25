import type { JSX, RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CURATED_FONT_FAMILIES } from '../core/document/fonts';
import {
  parseAspectRatioNumeric,
  type CssLengthUnit,
  type CssLengthValue,
  type CssUnitOption,
} from '../core/document/cssUnits';
import type {
  AssetReference,
  BreakpointId,
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DesignTokenCollection,
  DrawMaskMode,
  EllipseNode,
  FolioProject,
  FrameNode,
  InteractiveStateId,
  LayoutChildPosition,
  LayoutMode,
  LayoutSizingMode,
  NodeInsetOffsets,
  NodeLayoutChildConfig,
  NodeStateOverride,
  NodeTransitionConfig,
  PathNode,
  PseudoStateKey,
  RectNode,
  TextAlign,
  TextDecoration,
  TextNode,
  TextTransform,
  TextVerticalAlign,
  TransitionPreset,
} from '../core/document/types';
import { computeProportionalDimensions } from '../engines/canvas/geometry';
import { PANEL_RESIZE_CONSTRAINTS, type ResizablePanelId } from './panelResize';
import { normalizePositiveDimension } from './editorReducer';
import type { EditorTarget } from './editorContext';
import type { CanvasToolId } from '../core/tools/operationContract';
import {
  computePositionPatchForOrigin,
  computeResizePatchForOrigin,
  getAnchorCoordinates,
  type StudioVectorActions,
  type TransformOriginAnchor,
} from './workspace/inspectorVectorHelpers';
import {
  InspectorAlignDistributeSection,
  InspectorTransformActions,
  TransformOriginSelector,
} from './workspace/InspectorVectorStudioSection';
import {
  InspectorAccordionSection,
  InspectorAccordionToolbar,
} from './workspace/InspectorAccordion';
import { NumericUnitInput, type NumericUnitPreset } from './workspace/NumericUnitInput';
import { InspectorFrameLayoutSection } from './workspace/InspectorFrameLayoutSection';
import { InspectorAppearanceSection } from './workspace/InspectorAppearanceSection';
import { InspectorModernEffectsSection } from './workspace/InspectorModernEffectsSection';
import { InspectorResponsiveSemanticSection } from './workspace/InspectorResponsiveSemanticSection';
import { InspectorComponentContractSection } from './workspace/InspectorComponentContractSection';
import { InspectorInteractionsSection } from './workspace/InspectorInteractionsSection';
import type {
  QuickInteractionConfig,
  QuickInteractionEntry,
  QuickInteractionScopeContext,
} from './workspace/quickInteractions';

export const INSPECTOR_FONT_FAMILIES = CURATED_FONT_FAMILIES.map((entry) => ({
  label: entry.label,
  value: entry.value,
}));

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
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
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
  studioActions?: StudioVectorActions;
}

type AccordionSectionId =
  | 'layout-frame'
  | 'size-position'
  | 'appearance'
  | 'text'
  | 'modern-effects'
  | 'responsive-semantic'
  | 'component-logic';

const DEFAULT_ACCORDION_STATE: Record<AccordionSectionId, boolean> = {
  'layout-frame': true,
  'size-position': true,
  appearance: true,
  text: true,
  'modern-effects': false,
  'responsive-semantic': false,
  'component-logic': false,
};

const INTERACTIVE_STATES: ReadonlyArray<{ id: InteractiveStateId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'hover', label: 'Hover' },
  { id: 'active', label: 'Active' },
  { id: 'focus', label: 'Focus' },
  { id: 'disabled', label: 'Dis' },
];

const TRANSITION_PRESET_DEFAULTS: Record<TransitionPreset, { durationMs: number }> = {
  none: { durationMs: 0 },
  fast: { durationMs: 150 },
  smooth: { durationMs: 240 },
  bouncy: { durationMs: 360 },
};

const DIMENSION_UNITS: readonly CssUnitOption[] = ['px', '%', 'vw', 'vh', 'dvh', 'rem', 'em', 'fit', 'fill'];
const BOUND_UNITS: readonly CssUnitOption[] = ['auto', 'px', '%', 'vw', 'vh', 'dvh', 'rem'];
const INSET_UNITS: readonly CssUnitOption[] = ['auto', 'px', '%', 'rem'];
const POSITION_UNITS: readonly CssUnitOption[] = ['px'];
const ROTATION_UNITS: readonly CssUnitOption[] = ['deg'];
const DURATION_UNITS: readonly CssUnitOption[] = ['ms', 's'];
const FONT_SIZE_UNITS: readonly CssUnitOption[] = ['px', 'rem', 'em'];
const LINE_HEIGHT_UNITS: readonly CssUnitOption[] = ['', 'px', '%'];
const LETTER_SPACING_UNITS: readonly CssUnitOption[] = ['px', 'em'];

const CONTAINER_MAX_WIDTH_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Auto (None)', value: 0, keyword: 'auto' },
  { label: 'SM (640px)', value: 640, unit: 'px' },
  { label: 'MD (768px)', value: 768, unit: 'px' },
  { label: 'LG (1024px)', value: 1024, unit: 'px' },
  { label: 'XL (1280px)', value: 1280, unit: 'px' },
  { label: '2XL (1440px)', value: 1440, unit: 'px' },
];

const BOUND_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Auto (None)', value: 0, keyword: 'auto' },
  { label: '160 px', value: 160, unit: 'px' },
  { label: '320 px', value: 320, unit: 'px' },
  { label: '640 px', value: 640, unit: 'px' },
  { label: '100 %', value: 100, unit: '%' },
  { label: '100 vh', value: 100, unit: 'vh' },
];

const DIMENSION_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Fit Content', value: 0, keyword: 'fit' },
  { label: 'Fill Container', value: 0, keyword: 'fill' },
  { label: '100 %', value: 100, unit: '%' },
  { label: '100 vw', value: 100, unit: 'vw' },
  { label: '100 dvh', value: 100, unit: 'dvh' },
  { label: '320 px', value: 320, unit: 'px' },
  { label: '640 px', value: 640, unit: 'px' },
  { label: '1280 px', value: 1280, unit: 'px' },
];

const Z_INDEX_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Base (0)', value: 0 },
  { label: 'Sticky (10)', value: 10 },
  { label: 'Dropdown (20)', value: 20 },
  { label: 'Modal (50)', value: 50 },
  { label: 'Top (100)', value: 100 },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: '1/1', label: '1 : 1 (Square)' },
  { value: '4/3', label: '4 : 3 (Classic)' },
  { value: '16/9', label: '16 : 9 (Widescreen)' },
  { value: '21/9', label: '21 : 9 (Ultrawide)' },
  { value: '9/16', label: '9 : 16 (Vertical)' },
] as const;

const FONT_WEIGHT_OPTIONS = [
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'SemiBold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'ExtraBold (800)', value: 800 },
] as const;

const FONT_SIZE_PRESETS: readonly NumericUnitPreset[] = [
  { label: '12 px', value: 12, unit: 'px' },
  { label: '14 px', value: 14, unit: 'px' },
  { label: '16 px (1rem)', value: 16, unit: 'px' },
  { label: '20 px', value: 20, unit: 'px' },
  { label: '24 px', value: 24, unit: 'px' },
  { label: '32 px', value: 32, unit: 'px' },
  { label: '48 px', value: 48, unit: 'px' },
  { label: '64 px', value: 64, unit: 'px' },
];

const LINE_HEIGHT_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Tight (1.1)', value: 1.1 },
  { label: 'Snug (1.25)', value: 1.25 },
  { label: 'Normal (1.4)', value: 1.4 },
  { label: 'Relaxed (1.6)', value: 1.6 },
  { label: 'Loose (1.85)', value: 1.85 },
];

const LETTER_SPACING_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Tight (-0.5px)', value: -0.5, unit: 'px' },
  { label: 'Normal (0px)', value: 0, unit: 'px' },
  { label: 'Wide (1px)', value: 1, unit: 'px' },
  { label: 'Caps (0.08em)', value: 0.08, unit: 'em' },
];

type LayoutChildConstraints = NonNullable<NodeLayoutChildConfig['constraints']>;
type PinPresetId = 'tl' | 'tc' | 'tr' | 'center' | 'bl' | 'br' | 'stretch';

const PIN_PRESETS: readonly {
  id: PinPresetId;
  label: string;
  title: string;
  constraints: LayoutChildConstraints;
}[] = [
  { id: 'tl', label: 'TL', title: 'Pin Top-Left', constraints: { horizontal: 'left', vertical: 'top' } },
  { id: 'tc', label: 'TC', title: 'Pin Top-Center', constraints: { horizontal: 'center', vertical: 'top' } },
  { id: 'tr', label: 'TR', title: 'Pin Top-Right', constraints: { horizontal: 'right', vertical: 'top' } },
  { id: 'center', label: 'Ctr', title: 'Pin Center', constraints: { horizontal: 'center', vertical: 'center' } },
  { id: 'bl', label: 'BL', title: 'Pin Bottom-Left', constraints: { horizontal: 'left', vertical: 'bottom' } },
  { id: 'br', label: 'BR', title: 'Pin Bottom-Right', constraints: { horizontal: 'right', vertical: 'bottom' } },
  { id: 'stretch', label: 'Fill', title: 'Pin All Sides', constraints: { horizontal: 'left-right', vertical: 'top-bottom' } },
];

function detectActivePinPreset(constraints?: LayoutChildConstraints): PinPresetId | null {
  const h = constraints?.horizontal ?? 'left';
  const v = constraints?.vertical ?? 'top';
  const match = PIN_PRESETS.find((p) => p.constraints.horizontal === h && p.constraints.vertical === v);
  return match?.id ?? null;
}

function toLengthUnit(unit: CssUnitOption, fallback: CssLengthUnit = 'px'): CssLengthUnit {
  if (
    unit === 'px' ||
    unit === '%' ||
    unit === 'vw' ||
    unit === 'vh' ||
    unit === 'dvh' ||
    unit === 'rem' ||
    unit === 'em' ||
    unit === 'fr'
  ) {
    return unit;
  }
  return fallback;
}

function renderHorizontalAlignIcon(align: TextAlign): JSX.Element {
  if (align === 'center') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M4.5 6.5H11.5M2.5 9.5H13.5M5 12.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'right') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M5.5 6.5H13.5M3.5 9.5H13.5M6.5 12.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'justify') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M2.5 6.5H13.5M2.5 9.5H13.5M2.5 12.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.5H13.5M2.5 6.5H10.5M2.5 9.5H12.5M2.5 12.5H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function renderVerticalAlignIcon(align: TextVerticalAlign): JSX.Element {
  if (align === 'middle') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 8H13.5M5 5.5H11M5 10.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'bottom') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 13H13.5M5 10H11M6.5 7H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3H13.5M5 6H11M6.5 9H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

interface InspectorSelectedNodeBodyProps {
  activeEditorId: EditorTarget;
  selectedNode: DesignNode;
  scopedNodes: readonly DesignNode[];
  selectedInstanceComponent: ComponentDefinition | null;
  editingMasterComponent: ComponentDefinition | null;
  activeBreakpoint: BreakpointId;
  designTokens: DesignTokenCollection;
  defaultFillColor: string;
  project?: FolioProject;
  activePageId?: string;
  onCommitEdit: () => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onConvertFrameLayoutMode?: (containerId: string, mode: LayoutMode) => void;
  onSwitchBreakpoint?: (bp: BreakpointId) => void;
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
  onDuplicateSelection: () => void;
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
  studioActions?: StudioVectorActions;
}

function InspectorSelectedNodeBody({
  activeEditorId,
  selectedNode,
  scopedNodes,
  selectedInstanceComponent,
  editingMasterComponent,
  activeBreakpoint,
  designTokens,
  defaultFillColor,
  project,
  activePageId,
  onCommitEdit,
  onUpdateSelected,
  onUpdateSelectedStyle,
  onApplyAutoLayout,
  onConvertFrameLayoutMode,
  onSwitchBreakpoint,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
  onUpdateMasterContract,
  onToggleComponentNodeLogic,
  onResetInstanceOverrides,
  onDetachInstance,
  onConvertToPath,
  onTogglePathClosed,
  onSimplifyPath,
  onChooseTool,
  onDuplicateSelection,
  onCreateQuickInteraction,
  onUpdateQuickInteraction,
  onDeleteQuickInteraction,
  onOpenInteractionInNodeGraph,
  studioActions,
}: InspectorSelectedNodeBodyProps) {
  const [openSections, setOpenSections] = useState<Record<AccordionSectionId, boolean>>(
    DEFAULT_ACCORDION_STATE,
  );
  const [activeState, setActiveState] = useState<InteractiveStateId>('default');
  const [transformOrigin, setTransformOrigin] = useState<TransformOriginAnchor>('tl');
  const [showMinMax, setShowMinMax] = useState(false);

  useEffect(() => {
    setActiveState('default');
  }, [selectedNode.id]);

  const isTextNode = selectedNode.type === 'text';
  const isConvertibleVector =
    selectedNode.type === 'rect' || selectedNode.type === 'ellipse' || selectedNode.type === 'frame';
  const isPathNode = selectedNode.type === 'path';
  const hasQuickInteractions = Boolean(
    project &&
      activePageId &&
      onCreateQuickInteraction &&
      onUpdateQuickInteraction &&
      onDeleteQuickInteraction &&
      onOpenInteractionInNodeGraph,
  );
  const isComponentLogicVisible =
    selectedNode.type === 'component-instance' ||
    Boolean(editingMasterComponent) ||
    isPathNode ||
    isConvertibleVector ||
    hasQuickInteractions ||
    Boolean(studioActions?.onOpenNodeLogic);

  const visibleSectionIds: AccordionSectionId[] = [
    'layout-frame',
    'size-position',
    'appearance',
    ...(isTextNode ? (['text'] as const) : []),
    'modern-effects',
    'responsive-semantic',
    ...(isComponentLogicVisible ? (['component-logic'] as const) : []),
  ];

  const openCount = visibleSectionIds.filter((id) => openSections[id]).length;
  const allExpanded = openCount === visibleSectionIds.length;

  const toggleSection = (id: string) => {
    const typedId = id as AccordionSectionId;
    setOpenSections((prev) => ({ ...prev, [typedId]: !prev[typedId] }));
  };

  const toggleAllSections = () => {
    const nextOpen = !allExpanded;
    setOpenSections((prev) => {
      const next = { ...prev };
      for (const id of visibleSectionIds) {
        next[id] = nextOpen;
      }
      return next;
    });
  };

  const isPseudoState = activeState !== 'default';
  const pseudoKey = activeState as PseudoStateKey;
  const activeStateOverride: NodeStateOverride | undefined = isPseudoState
    ? selectedNode.stateOverrides?.[pseudoKey]
    : undefined;

  const updateActiveStateOverride = (patch: Partial<NodeStateOverride>, commit = true) => {
    if (!isPseudoState) return;
    const nextEntry: NodeStateOverride = {
      ...(selectedNode.stateOverrides?.[pseudoKey] ?? {}),
      ...patch,
    };
    onUpdateSelected({
      stateOverrides: {
        ...(selectedNode.stateOverrides ?? {}),
        [pseudoKey]: nextEntry,
      },
    });
    if (commit) onCommitEdit();
  };

  const resetActiveStateOverride = () => {
    if (!isPseudoState || !selectedNode.stateOverrides) return;
    const nextOverrides = { ...selectedNode.stateOverrides };
    delete nextOverrides[pseudoKey];
    onUpdateSelected({
      stateOverrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
    });
    onCommitEdit();
  };

  const handleUpdateExtendedStyle = (patch: Record<string, unknown>) => {
    const isPrimitiveOnly = Object.values(patch).every(
      (value) => typeof value === 'string' || typeof value === 'number',
    );
    if (isPrimitiveOnly) {
      onUpdateSelectedStyle(patch as Record<string, string | number>);
      return;
    }
    if (
      selectedNode.type === 'rect' ||
      selectedNode.type === 'frame' ||
      selectedNode.type === 'ellipse' ||
      selectedNode.type === 'path' ||
      selectedNode.type === 'text' ||
      selectedNode.type === 'image'
    ) {
      onUpdateSelected({
        style: {
          ...selectedNode.style,
          ...patch,
        },
      } as Partial<DesignNode>);
    }
  };

  const parentNode = selectedNode.parentId
    ? scopedNodes.find((node) => node.id === selectedNode.parentId) ?? null
    : null;
  const parentLayout = parentNode?.layout;
  const isInsideAutoLayout = Boolean(parentLayout && parentLayout.mode !== 'none');

  const layoutChild: NodeLayoutChildConfig = {
    widthMode: 'fixed',
    heightMode: 'fixed',
    flexGrow: 1,
    position: 'relative',
    alignSelf: 'auto',
    ...(selectedNode.layoutChild ?? {}),
  };

  const commitLayoutChild = (patch: Partial<NodeLayoutChildConfig>, commit = true) => {
    const nextChild: NodeLayoutChildConfig = { ...layoutChild, ...patch };
    onUpdateSelected({ layoutChild: nextChild });
    if ((selectedNode.type === 'frame' || selectedNode.type === 'group') && selectedNode.layout?.mode && selectedNode.layout.mode !== 'none') {
      onApplyAutoLayout(selectedNode.id);
    }
    if (parentNode && isInsideAutoLayout) {
      onApplyAutoLayout(parentNode.id);
    }
    if (commit) onCommitEdit();
  };

  const isAspectRatioLocked = Boolean(selectedNode.aspectRatioLocked);
  const anchorCoords = getAnchorCoordinates(selectedNode, transformOrigin);

  const handleDimensionChange = (axis: 'width' | 'height', nextValue: number) => {
    const currentAxisValue = axis === 'width' ? selectedNode.width : selectedNode.height;
    const safeNext = normalizePositiveDimension(nextValue, currentAxisValue);
    let nextW = axis === 'width' ? safeNext : selectedNode.width;
    let nextH = axis === 'height' ? safeNext : selectedNode.height;
    if (isAspectRatioLocked) {
      const explicitRatio = parseAspectRatioNumeric(layoutChild.aspectRatio);
      const anchor = explicitRatio ?? (selectedNode.height > 0 ? selectedNode.width / selectedNode.height : 1);
      const next = computeProportionalDimensions({
        currentWidth: selectedNode.width,
        currentHeight: selectedNode.height,
        axis,
        nextValue: safeNext,
        lockAspectRatio: true,
        anchorRatio: anchor,
      });
      nextW = next.width;
      nextH = next.height;
    }
    if (transformOrigin === 'tl') {
      onUpdateSelected(
        isAspectRatioLocked
          ? { width: nextW, height: nextH }
          : axis === 'width'
            ? { width: nextW }
            : { height: nextH },
      );
      return;
    }
    onUpdateSelected(computeResizePatchForOrigin(selectedNode, transformOrigin, nextW, nextH));
  };

  const resolveDimensionUnit = (axis: 'width' | 'height'): CssUnitOption => {
    const mode: LayoutSizingMode =
      (axis === 'width' ? layoutChild.widthMode : layoutChild.heightMode) ?? 'fixed';
    if (mode === 'hug') return 'fit';
    if (mode === 'fill') return 'fill';
    if (mode === 'relative') return '%';
    const cssVal = axis === 'width' ? layoutChild.widthValue : layoutChild.heightValue;
    return cssVal?.unit ?? 'px';
  };

  const resolveDimensionNumeric = (axis: 'width' | 'height'): number => {
    const mode: LayoutSizingMode =
      (axis === 'width' ? layoutChild.widthMode : layoutChild.heightMode) ?? 'fixed';
    if (mode === 'relative') {
      return axis === 'width' ? (layoutChild.widthPercent ?? 100) : (layoutChild.heightPercent ?? 100);
    }
    const cssVal = axis === 'width' ? layoutChild.widthValue : layoutChild.heightValue;
    if (cssVal && cssVal.unit !== 'px') return cssVal.value;
    return axis === 'width' ? Math.round(selectedNode.width) : Math.round(selectedNode.height);
  };

  const applyDimensionPayload = (
    axis: 'width' | 'height',
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const modeKey = axis === 'width' ? 'widthMode' : 'heightMode';
    const pctKey = axis === 'width' ? 'widthPercent' : 'heightPercent';
    const cssValKey = axis === 'width' ? 'widthValue' : 'heightValue';

    if (payload.unit === 'fit') {
      commitLayoutChild({ [modeKey]: 'hug', [cssValKey]: undefined }, commit);
      return;
    }
    if (payload.unit === 'fill') {
      commitLayoutChild({ [modeKey]: 'fill', [cssValKey]: undefined }, commit);
      return;
    }
    if (payload.unit === '%') {
      commitLayoutChild(
        {
          [modeKey]: 'relative',
          [pctKey]: Math.max(1, Math.min(100, payload.value)),
          [cssValKey]: { value: Math.max(1, Math.min(100, payload.value)), unit: '%' },
        },
        commit,
      );
      return;
    }
    const lenUnit = toLengthUnit(payload.unit, 'px');
    const nextCssVal: CssLengthValue = { value: payload.value, unit: lenUnit };
    if (lenUnit === 'px') {
      handleDimensionChange(axis, payload.value);
      if (layoutChild[modeKey] !== 'fixed' || layoutChild[cssValKey]) {
        commitLayoutChild({ [modeKey]: 'fixed', [cssValKey]: undefined }, false);
      }
      if (commit) onCommitEdit();
      return;
    }
    commitLayoutChild({ [modeKey]: 'fixed', [cssValKey]: nextCssVal }, commit);
  };

  const resolveBound = (
    key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
  ): { value: number; unit: CssUnitOption } => {
    const cssKey = `${key}Value` as const;
    const cssVal = layoutChild[cssKey];
    if (cssVal) return { value: cssVal.value, unit: cssVal.unit };
    const pxVal = layoutChild[key];
    if (typeof pxVal === 'number' && pxVal > 0) return { value: pxVal, unit: 'px' };
    return { value: 0, unit: 'auto' };
  };

  const applyBound = (
    key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const cssKey = `${key}Value` as const;
    if (payload.unit === 'auto' || payload.value <= 0) {
      commitLayoutChild({ [key]: undefined, [cssKey]: undefined }, commit);
      return;
    }
    const lenUnit = toLengthUnit(payload.unit, 'px');
    commitLayoutChild(
      {
        [key]: lenUnit === 'px' ? payload.value : layoutChild[key],
        [cssKey]: { value: payload.value, unit: lenUnit },
      },
      commit,
    );
  };

  const activeBoundsCount = (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const).filter(
    (k) => resolveBound(k).unit !== 'auto',
  ).length;

  const positionType: LayoutChildPosition = layoutChild.position ?? 'relative';
  const showInsets = positionType !== 'relative';
  const showPinPresets = !isInsideAutoLayout || positionType === 'absolute';
  const activePinPreset = detectActivePinPreset(layoutChild.constraints);

  const updateInset = (
    side: keyof NodeInsetOffsets,
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const nextInset: NodeInsetOffsets = { ...(layoutChild.inset ?? {}) };
    if (payload.unit === 'auto') {
      delete nextInset[side];
    } else {
      nextInset[side] = { value: payload.value, unit: toLengthUnit(payload.unit, 'px') };
    }
    commitLayoutChild(
      { inset: Object.keys(nextInset).length > 0 ? nextInset : undefined },
      commit,
    );
  };

  const currentTransition: NodeTransitionConfig = selectedNode.transition ?? {
    preset: 'none',
    durationMs: 0,
    durationUnit: 'ms',
  };

  const currentDrawMode: DrawMaskMode = selectedNode.drawMode ?? 'normal';
  const showPermanentSubtract =
    currentDrawMode === 'outside' || selectedNode.clipMaskMode === 'outside';

  const targetLogicComponent =
    activeEditorId === 'component'
      ? editingMasterComponent
      : selectedInstanceComponent ?? editingMasterComponent;

  const layoutBadge =
    selectedNode.type === 'frame' || selectedNode.type === 'group'
      ? selectedNode.layout?.mode === 'flex'
        ? 'STACK'
        : selectedNode.layout?.mode === 'grid'
          ? 'GRID'
          : 'FREE'
      : parentLayout?.mode === 'grid'
        ? 'GRID ITEM'
        : parentLayout?.mode === 'flex'
          ? 'STACK ITEM'
          : 'WEB';

  const hasAnyStateOverrides = (stateId: InteractiveStateId): boolean => {
    if (stateId === 'default') return false;
    const entry = selectedNode.stateOverrides?.[stateId];
    return Boolean(entry && Object.keys(entry).length > 0);
  };

  return (
    <div class={`inspector-content inspector-zero-typing${isPseudoState ? ' is-state-editing' : ''}`}>
      {/* Global Expand All / Collapse All Bar */}
      <InspectorAccordionToolbar
        allExpanded={allExpanded}
        openCount={openCount}
        totalCount={visibleSectionIds.length}
        onToggleAll={toggleAllSections}
      />

      {/* SECTION 1 — HEADER IDENTITY & INTERACTIVE STATE SWITCHER (ALWAYS VISIBLE) */}
      <section class="inspector-quick-header" aria-label="Identity and interactive states">
        <div class="inspector-quick-name-row">
          <input
            type="text"
            class="text-field inspector-name-input"
            aria-label="Layer or Component Name"
            value={selectedNode.name}
            onInput={(event) => onUpdateSelected({ name: event.currentTarget.value })}
          />
          <span class="inspector-type-tag">{selectedNode.type.toUpperCase()}</span>
        </div>

        <div class="inspector-quick-actions-row">
          <button
            type="button"
            class={`inspector-quick-icon-btn${selectedNode.locked ? ' is-active' : ''}`}
            aria-pressed={selectedNode.locked}
            title={selectedNode.locked ? 'Unlock layer' : 'Lock layer'}
            onClick={() => {
              onUpdateSelected({ locked: !selectedNode.locked });
              onCommitEdit();
            }}
          >
            {selectedNode.locked ? 'Locked' : 'Lock'}
          </button>
          <button
            type="button"
            class={`inspector-quick-icon-btn${!selectedNode.visible ? ' is-active' : ''}`}
            aria-pressed={!selectedNode.visible}
            title={selectedNode.visible ? 'Hide layer' : 'Show layer'}
            onClick={() => {
              onUpdateSelected({ visible: !selectedNode.visible });
              onCommitEdit();
            }}
          >
            {selectedNode.visible ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            class="inspector-quick-icon-btn"
            title="Duplicate selection (Ctrl+Shift+D)"
            onClick={onDuplicateSelection}
          >
            Dup
          </button>
          {studioActions && (
            <>
              <button
                type="button"
                class="inspector-quick-icon-btn"
                title="Deselect all (Esc / Ctrl+D)"
                onClick={studioActions.onDeselect}
              >
                Deselect
              </button>
              <button
                type="button"
                class="inspector-quick-icon-btn"
                title="Invert selection (Ctrl+Shift+I)"
                onClick={studioActions.onInvertSelection}
              >
                Invert
              </button>
            </>
          )}
        </div>

        {/* Interactive State Switcher Pill: Default | Hover | Active | Focus | Disabled */}
        <div class="folio-state-block">
          <div class="folio-state-switcher-pill" role="tablist" aria-label="Interactive state switcher">
            {INTERACTIVE_STATES.map((st) => {
              const active = activeState === st.id;
              const overridden = hasAnyStateOverrides(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  class={`folio-state-pill-btn${active ? ' is-active' : ''}${
                    active && st.id !== 'default' ? ' is-pseudo-active' : ''
                  }`}
                  title={st.id === 'disabled' ? 'Disabled State (:disabled)' : `${st.label} State`}
                  onClick={() => setActiveState(st.id)}
                >
                  <span>{st.label}</span>
                  {overridden && <span class="folio-override-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {isPseudoState && (
            <div class="folio-pseudo-banner" role="status">
              <div class="folio-pseudo-banner-row">
                <span class="folio-pseudo-badge">Editing :{activeState}</span>
                <button
                  type="button"
                  class="inspector-mini-btn"
                  disabled={!activeStateOverride}
                  onClick={resetActiveStateOverride}
                >
                  Reset :{activeState}
                </button>
              </div>
              <div class="folio-triple-grid">
                <NumericUnitInput
                  label="Op"
                  ariaLabel={`${activeState} opacity`}
                  value={Math.round((activeStateOverride?.opacity ?? selectedNode.opacity) * 100)}
                  unit="%"
                  units={['%']}
                  min={0}
                  max={100}
                  step={5}
                  hasOverrideDot={typeof activeStateOverride?.opacity === 'number'}
                  onChange={(p) =>
                    updateActiveStateOverride({ opacity: Math.max(0, Math.min(1, p.value / 100)) })
                  }
                />
                <NumericUnitInput
                  label="Scl"
                  ariaLabel={`${activeState} scale`}
                  value={activeStateOverride?.scale ?? 1}
                  unit=""
                  units={['']}
                  min={0.2}
                  max={2}
                  step={0.02}
                  precision={2}
                  hasOverrideDot={typeof activeStateOverride?.scale === 'number'}
                  onChange={(p) => updateActiveStateOverride({ scale: p.value })}
                />
                <NumericUnitInput
                  label="dY"
                  ariaLabel={`${activeState} translate Y`}
                  value={activeStateOverride?.translateY ?? 0}
                  unit="px"
                  units={['px']}
                  min={-120}
                  max={120}
                  step={1}
                  allowNegative
                  hasOverrideDot={typeof activeStateOverride?.translateY === 'number'}
                  onChange={(p) => updateActiveStateOverride({ translateY: p.value })}
                />
              </div>
            </div>
          )}

          {/* CSS Transition Preset & Duration */}
          <div class="folio-transition-row">
            <select
              class="select-field folio-compact-select"
              aria-label="CSS Transition Preset"
              value={currentTransition.preset}
              onChange={(event) => {
                const preset = event.currentTarget.value as TransitionPreset;
                if (preset === 'none') {
                  onUpdateSelected({ transition: undefined });
                } else {
                  const def = TRANSITION_PRESET_DEFAULTS[preset];
                  onUpdateSelected({
                    transition: {
                      preset,
                      durationMs: def.durationMs,
                      durationUnit: 'ms',
                    },
                  });
                }
                onCommitEdit();
              }}
            >
              <option value="none">Transition: None</option>
              <option value="fast">Fast (150ms)</option>
              <option value="smooth">Smooth (240ms)</option>
              <option value="bouncy">Bouncy (360ms)</option>
            </select>
            {currentTransition.preset !== 'none' && (
              <NumericUnitInput
                label="Dur"
                ariaLabel="Transition Duration"
                value={
                  currentTransition.durationUnit === 's'
                    ? Number(((currentTransition.durationMs ?? 240) / 1000).toFixed(2))
                    : (currentTransition.durationMs ?? 240)
                }
                unit={currentTransition.durationUnit ?? 'ms'}
                units={DURATION_UNITS}
                min={0}
                max={3000}
                step={20}
                onChange={(p) => {
                  const durationUnit: 'ms' | 's' = p.unit === 's' ? 's' : 'ms';
                  const ms = durationUnit === 's' ? Math.round(p.value * 1000) : Math.round(p.value);
                  onUpdateSelected({
                    transition: {
                      ...currentTransition,
                      durationMs: Math.max(0, ms),
                      durationUnit,
                    },
                  });
                  onCommitEdit();
                }}
              />
            )}
          </div>
        </div>

        {studioActions && (
          <div class="inspector-similar-row">
            <select
              class="select-field inspector-similar-select"
              aria-label="Select Similar"
              value=""
              onChange={(event) => {
                const value = event.currentTarget.value as '' | 'fill' | 'stroke' | 'type';
                if (!value) return;
                studioActions.onSelectSimilar(value);
                event.currentTarget.value = '';
              }}
            >
              <option value="">Select Similar…</option>
              <option value="fill">Select Same Fill</option>
              <option value="stroke">Select Same Stroke</option>
              <option value="type">Select Same Type</option>
            </select>
          </div>
        )}
      </section>

      {/* SECTION 2 — LAYOUT & FRAME (DEFAULT OPEN) */}
      <InspectorAccordionSection
        id="layout-frame"
        title="Layout & Frame"
        badge={layoutBadge}
        isOpen={openSections['layout-frame']}
        onToggle={toggleSection}
      >
        <InspectorFrameLayoutSection
          selectedNode={selectedNode}
          parentNode={parentNode}
          onUpdateSelected={onUpdateSelected}
          onApplyAutoLayout={onApplyAutoLayout}
          onConvertFrameLayoutMode={onConvertFrameLayoutMode}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 3 — SIZE & POSITION (DEFAULT OPEN) */}
      <InspectorAccordionSection
        id="size-position"
        title="Size & Position"
        badge={`${Math.round(selectedNode.width)}×${Math.round(selectedNode.height)}`}
        isOpen={openSections['size-position']}
        onToggle={toggleSection}
      >
        {studioActions && (
          <div class="inspector-acc-group">
            <div class="inspector-align-grid" role="group" aria-label="Align and distribute">
              <button type="button" class="inspector-icon-btn" title="Align Left" onClick={() => studioActions.onAlign('left')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 2V14M5 4H12V6.5H5V4ZM5 9.5H9.5V12H5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Center X" onClick={() => studioActions.onAlign('horizontal-center')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M8 2V14M4 4H12V6.5H4V4ZM5.5 9.5H10.5V12H5.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Right" onClick={() => studioActions.onAlign('right')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M13.5 2V14M4 4H11V6.5H4V4ZM6.5 9.5H11V12H6.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Top" onClick={() => studioActions.onAlign('top')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2 2.5H14M4 5H6.5V12H4V5ZM9.5 5H12V9.5H9.5V5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Middle Y" onClick={() => studioActions.onAlign('vertical-center')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2 8H14M4 4H6.5V12H4V4ZM9.5 5.5H12V10.5H9.5V5.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Bottom" onClick={() => studioActions.onAlign('bottom')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2 13.5H14M4 4H6.5V11H4V4ZM9.5 6.5H12V11H9.5V6.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Distribute Horizontally" onClick={() => studioActions.onDistribute('horizontal')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2 2.5V13.5M14 2.5V13.5M6.5 4.5H9.5V11.5H6.5V4.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Distribute Vertically" onClick={() => studioActions.onDistribute('vertical')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 2H13.5M2.5 14H13.5M4.5 6.5H11.5V9.5H4.5V6.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* Width & Height with Pinned Units (px/%/vw/vh/dvh/rem/em/Fit/Fill) + Aspect Ratio */}
        <div class="inspector-acc-group">
          <div class="folio-dual-grid">
            <NumericUnitInput
              label="W"
              ariaLabel="Width"
              value={resolveDimensionNumeric('width')}
              unit={resolveDimensionUnit('width')}
              units={DIMENSION_UNITS}
              presets={DIMENSION_PRESETS}
              min={1}
              max={10000}
              step={2}
              onPreview={(p) => applyDimensionPayload('width', p, false)}
              onChange={(p) => applyDimensionPayload('width', p, true)}
            />
            <NumericUnitInput
              label="H"
              ariaLabel="Height"
              value={resolveDimensionNumeric('height')}
              unit={resolveDimensionUnit('height')}
              units={DIMENSION_UNITS}
              presets={DIMENSION_PRESETS}
              min={1}
              max={10000}
              step={2}
              onPreview={(p) => applyDimensionPayload('height', p, false)}
              onChange={(p) => applyDimensionPayload('height', p, true)}
            />
          </div>

          <div class="folio-aspect-row">
            <button
              type="button"
              class={`inspector-mini-btn${isAspectRatioLocked ? ' is-accent' : ''}`}
              aria-pressed={isAspectRatioLocked}
              title="Lock proportional aspect ratio"
              onClick={() => {
                onUpdateSelected({ aspectRatioLocked: !isAspectRatioLocked });
                onCommitEdit();
              }}
            >
              {isAspectRatioLocked ? '🔒 Locked' : '🔓 Unlock'}
            </button>
            <select
              class="select-field folio-compact-select"
              aria-label="Aspect Ratio Preset"
              value={layoutChild.aspectRatio ?? ''}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                if (!raw) {
                  commitLayoutChild({ aspectRatio: undefined }, true);
                  return;
                }
                const numeric = parseAspectRatioNumeric(raw);
                if (numeric && selectedNode.width > 0) {
                  const nextHeight = Math.max(8, Math.round(selectedNode.width / numeric));
                  onUpdateSelected({
                    height: nextHeight,
                    aspectRatioLocked: true,
                    layoutChild: { ...layoutChild, aspectRatio: raw },
                  });
                  if (parentNode && isInsideAutoLayout) onApplyAutoLayout(parentNode.id);
                  onCommitEdit();
                } else {
                  commitLayoutChild({ aspectRatio: raw }, true);
                }
              }}
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value || 'auto'} value={opt.value}>
                  Ratio: {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Min / Max Bounds (Container Presets 640/768/1024/1280/1440px) */}
          <div class="framer-minmax-wrap">
            <button
              type="button"
              class={`framer-minmax-toggle${showMinMax || activeBoundsCount > 0 ? ' is-active' : ''}`}
              aria-expanded={showMinMax}
              onClick={() => setShowMinMax((prev) => !prev)}
            >
              <span>Min / Max Bounds</span>
              <span class="framer-minmax-meta">
                {activeBoundsCount > 0 ? `${activeBoundsCount} active` : showMinMax ? 'Hide' : 'Set'}
              </span>
            </button>
            {showMinMax && (
              <div class="framer-minmax-panel">
                <div class="folio-dual-grid">
                  <NumericUnitInput
                    label="MinW"
                    ariaLabel="Min Width"
                    value={resolveBound('minWidth').value}
                    unit={resolveBound('minWidth').unit}
                    units={BOUND_UNITS}
                    presets={BOUND_PRESETS}
                    min={0}
                    max={4000}
                    step={8}
                    onChange={(p) => applyBound('minWidth', p, true)}
                  />
                  <NumericUnitInput
                    label="MaxW"
                    ariaLabel="Max Width"
                    value={resolveBound('maxWidth').value}
                    unit={resolveBound('maxWidth').unit}
                    units={BOUND_UNITS}
                    presets={CONTAINER_MAX_WIDTH_PRESETS}
                    min={0}
                    max={4000}
                    step={8}
                    onChange={(p) => applyBound('maxWidth', p, true)}
                  />
                  <NumericUnitInput
                    label="MinH"
                    ariaLabel="Min Height"
                    value={resolveBound('minHeight').value}
                    unit={resolveBound('minHeight').unit}
                    units={BOUND_UNITS}
                    presets={BOUND_PRESETS}
                    min={0}
                    max={4000}
                    step={8}
                    onChange={(p) => applyBound('minHeight', p, true)}
                  />
                  <NumericUnitInput
                    label="MaxH"
                    ariaLabel="Max Height"
                    value={resolveBound('maxHeight').value}
                    unit={resolveBound('maxHeight').unit}
                    units={BOUND_UNITS}
                    presets={BOUND_PRESETS}
                    min={0}
                    max={4000}
                    step={8}
                    onChange={(p) => applyBound('maxHeight', p, true)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Position Type (Relative | Absolute | Fixed | Sticky) + Insets + Pinning */}
        <div class="inspector-acc-group">
          <span class="framer-mini-kicker">Position Type</span>
          <div class="framer-seg-row cols-4" role="group" aria-label="CSS Position Type">
            {(
              [
                { value: 'relative', label: 'Relative' },
                { value: 'absolute', label: 'Absolute' },
                { value: 'fixed', label: 'Fixed' },
                { value: 'sticky', label: 'Sticky' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                class={`framer-seg-btn${positionType === opt.value ? ' is-active' : ''}`}
                aria-pressed={positionType === opt.value}
                onClick={() =>
                  commitLayoutChild({
                    position: opt.value as LayoutChildPosition,
                    ...(opt.value === 'sticky' && !layoutChild.inset?.top
                      ? { inset: { ...(layoutChild.inset ?? {}), top: { value: 0, unit: 'px' } } }
                      : {}),
                  })
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          {showInsets && (
            <div class="folio-dual-grid">
              {(
                [
                  { side: 'top', label: 'Top' },
                  { side: 'right', label: 'Right' },
                  { side: 'bottom', label: 'Bot' },
                  { side: 'left', label: 'Left' },
                ] as const
              ).map((item) => {
                const current = layoutChild.inset?.[item.side];
                return (
                  <NumericUnitInput
                    key={item.side}
                    label={item.label}
                    ariaLabel={`Inset ${item.side}`}
                    value={current?.value ?? 0}
                    unit={current?.unit ?? 'auto'}
                    units={INSET_UNITS}
                    min={-2000}
                    max={2000}
                    step={2}
                    allowNegative
                    onChange={(p) => updateInset(item.side, p, true)}
                  />
                );
              })}
            </div>
          )}

          {showPinPresets && (
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Pin Anchor</span>
              <div class="framer-pin-grid" role="group" aria-label="Pin anchor constraints">
                {PIN_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    class={`framer-seg-btn${activePinPreset === preset.id ? ' is-active' : ''}`}
                    title={preset.title}
                    aria-pressed={activePinPreset === preset.id}
                    onClick={() => commitLayoutChild({ constraints: preset.constraints })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Canvas X / Y, Rotation, Flip, Transform Origin, Opacity & Z-Index */}
        <div class="inspector-acc-group">
          <div class="folio-dual-grid">
            <NumericUnitInput
              label="X"
              ariaLabel="Position X"
              value={Math.round(anchorCoords.x)}
              unit="px"
              units={POSITION_UNITS}
              min={-4000}
              max={8000}
              step={2}
              allowNegative
              onPreview={(p) =>
                onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'x', p.value))
              }
              onChange={(p) => {
                onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'x', p.value));
                onCommitEdit();
              }}
            />
            <NumericUnitInput
              label="Y"
              ariaLabel="Position Y"
              value={Math.round(anchorCoords.y)}
              unit="px"
              units={POSITION_UNITS}
              min={-4000}
              max={8000}
              step={2}
              allowNegative
              onPreview={(p) =>
                onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'y', p.value))
              }
              onChange={(p) => {
                onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'y', p.value));
                onCommitEdit();
              }}
            />
          </div>

          <div class="folio-dual-grid">
            <NumericUnitInput
              label="Rot"
              ariaLabel="Rotation angle"
              value={Math.round(selectedNode.rotation)}
              unit="deg"
              units={ROTATION_UNITS}
              min={-360}
              max={360}
              step={1}
              allowNegative
              onPreview={(p) => onUpdateSelected({ rotation: p.value })}
              onChange={(p) => {
                onUpdateSelected({ rotation: p.value });
                onCommitEdit();
              }}
            />
            <NumericUnitInput
              label="Z"
              ariaLabel="Z-Index"
              value={Math.round(layoutChild.zIndex ?? 0)}
              unit=""
              units={['']}
              presets={Z_INDEX_PRESETS}
              min={-100}
              max={9999}
              step={1}
              precision={0}
              allowNegative
              onChange={(p) => commitLayoutChild({ zIndex: Math.round(p.value) })}
            />
          </div>

          <div class="folio-origin-flip-row">
            <TransformOriginSelector value={transformOrigin} onChange={setTransformOrigin} />
            <div class="folio-flip-col">
              {studioActions && (
                <div class="inspector-quick-row cols-2">
                  <button
                    type="button"
                    class="inspector-mini-btn"
                    title="Flip Horizontal"
                    onClick={() => studioActions.onFlip('horizontal')}
                  >
                    ⇄ Flip H
                  </button>
                  <button
                    type="button"
                    class="inspector-mini-btn"
                    title="Flip Vertical"
                    onClick={() => studioActions.onFlip('vertical')}
                  >
                    ⇅ Flip V
                  </button>
                </div>
              )}
              <div class="folio-opacity-compact">
                <div class="inspector-sublabel-row">
                  <span class="framer-mini-kicker">Opacity</span>
                  <span class="zt-value-readout">{Math.round(selectedNode.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  class="zt-range-slider"
                  aria-label="Opacity percentage"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(selectedNode.opacity * 100)}
                  style={{
                    '--slider-pct': `${Math.max(0, Math.min(100, Math.round(selectedNode.opacity * 100)))}%`,
                  } as Record<string, string>}
                  onInput={(event) =>
                    onUpdateSelected({
                      opacity: Math.min(1, Math.max(0, Number(event.currentTarget.value) / 100)),
                    })
                  }
                  onPointerUp={onCommitEdit}
                  onKeyUp={onCommitEdit}
                  onBlur={onCommitEdit}
                />
              </div>
            </div>
          </div>
        </div>
      </InspectorAccordionSection>

      {/* SECTION 4 — FILL, BORDER & RADIUS (DEFAULT OPEN) */}
      <InspectorAccordionSection
        id="appearance"
        title="Fill, Border & Radius"
        badge={isPseudoState ? `:${activeState}` : undefined}
        isOpen={openSections.appearance}
        onToggle={toggleSection}
      >
        <InspectorAppearanceSection
          selectedNode={selectedNode}
          activeState={activeState}
          designTokens={designTokens}
          defaultFillColor={defaultFillColor}
          onUpdateSelected={onUpdateSelected}
          onUpdateSelectedStyle={handleUpdateExtendedStyle}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 5 — TEXT & PARAGRAPH (CONTEXTUAL — TEXT NODES ONLY, DEFAULT OPEN) */}
      {isTextNode && (
        <InspectorAccordionSection
          id="text"
          title="Text & Paragraph"
          badge={`${selectedNode.style.fontSize}${selectedNode.style.fontSizeUnit ?? 'px'}`}
          isOpen={openSections.text}
          onToggle={toggleSection}
        >
          <div class="inspector-acc-group">
            <label class="field-label">
              Font Family
              <select
                class="select-field"
                aria-label="Font Family"
                value={selectedNode.style.fontFamily}
                onChange={(event) => {
                  onUpdateSelectedStyle({ fontFamily: event.currentTarget.value });
                  onCommitEdit();
                }}
              >
                {INSPECTOR_FONT_FAMILIES.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>

            <div class="folio-dual-grid">
              <label class="field-label">
                Weight
                <select
                  class="select-field"
                  aria-label="Font Weight"
                  value={String(selectedNode.style.fontWeight)}
                  onChange={(event) => {
                    onUpdateSelectedStyle({ fontWeight: Number(event.currentTarget.value) });
                    onCommitEdit();
                  }}
                >
                  {FONT_WEIGHT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <NumericUnitInput
                label="Size"
                ariaLabel="Font Size"
                value={selectedNode.style.fontSize}
                unit={selectedNode.style.fontSizeUnit ?? 'px'}
                units={FONT_SIZE_UNITS}
                presets={FONT_SIZE_PRESETS}
                min={8}
                max={240}
                step={1}
                onPreview={(p) =>
                  handleUpdateExtendedStyle({
                    fontSize: p.value,
                    fontSizeUnit: p.unit === 'rem' || p.unit === 'em' ? p.unit : 'px',
                  })
                }
                onChange={(p) => {
                  handleUpdateExtendedStyle({
                    fontSize: p.value,
                    fontSizeUnit: p.unit === 'rem' || p.unit === 'em' ? p.unit : 'px',
                  });
                  onCommitEdit();
                }}
              />
            </div>

            <div class="folio-dual-grid">
              <NumericUnitInput
                label="LH"
                ariaLabel="Line Height"
                value={selectedNode.style.lineHeight}
                unit={selectedNode.style.lineHeightUnit ?? ''}
                units={LINE_HEIGHT_UNITS}
                presets={LINE_HEIGHT_PRESETS}
                min={0.5}
                max={400}
                step={0.05}
                precision={2}
                onChange={(p) => {
                  handleUpdateExtendedStyle({
                    lineHeight: p.value,
                    lineHeightUnit: p.unit === 'px' || p.unit === '%' ? p.unit : '',
                  });
                  onCommitEdit();
                }}
              />
              <NumericUnitInput
                label="LS"
                ariaLabel="Letter Spacing"
                value={selectedNode.style.letterSpacing ?? 0}
                unit={selectedNode.style.letterSpacingUnit ?? 'px'}
                units={LETTER_SPACING_UNITS}
                presets={LETTER_SPACING_PRESETS}
                min={-10}
                max={40}
                step={0.25}
                precision={2}
                allowNegative
                onChange={(p) => {
                  handleUpdateExtendedStyle({
                    letterSpacing: p.value,
                    letterSpacingUnit: p.unit === 'em' ? 'em' : 'px',
                  });
                  onCommitEdit();
                }}
              />
            </div>

            {/* 4-Button Horizontal Align */}
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Horizontal Alignment</span>
              <div class="framer-seg-row cols-4" role="group" aria-label="Text horizontal alignment">
                {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    class={`framer-seg-btn${(selectedNode.style.textAlign ?? 'left') === align ? ' is-active' : ''}`}
                    aria-label={`Align ${align}`}
                    aria-pressed={(selectedNode.style.textAlign ?? 'left') === align}
                    onClick={() => {
                      onUpdateSelectedStyle({ textAlign: align });
                      onCommitEdit();
                    }}
                  >
                    <span class="folio-align-svg">{renderHorizontalAlignIcon(align)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 3-Button Vertical Align */}
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Vertical Alignment</span>
              <div class="framer-seg-row cols-3" role="group" aria-label="Text vertical alignment">
                {(['top', 'middle', 'bottom'] as const).map((valign) => (
                  <button
                    key={valign}
                    type="button"
                    class={`framer-seg-btn${(selectedNode.style.verticalAlign ?? 'top') === valign ? ' is-active' : ''}`}
                    aria-label={`Vertical align ${valign}`}
                    aria-pressed={(selectedNode.style.verticalAlign ?? 'top') === valign}
                    onClick={() => {
                      onUpdateSelectedStyle({ verticalAlign: valign });
                      onCommitEdit();
                    }}
                  >
                    <span class="folio-align-svg">{renderVerticalAlignIcon(valign)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div class="folio-dual-grid">
              <label class="field-label">
                Transform
                <select
                  class="select-field"
                  aria-label="Text Transform"
                  value={selectedNode.style.textTransform ?? 'none'}
                  onChange={(event) => {
                    onUpdateSelectedStyle({
                      textTransform: event.currentTarget.value as TextTransform,
                    });
                    onCommitEdit();
                  }}
                >
                  <option value="none">None</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="lowercase">lowercase</option>
                  <option value="capitalize">Capitalize</option>
                </select>
              </label>
              <label class="field-label">
                Decoration
                <select
                  class="select-field"
                  aria-label="Text Decoration"
                  value={selectedNode.style.textDecoration ?? 'none'}
                  onChange={(event) => {
                    onUpdateSelectedStyle({
                      textDecoration: event.currentTarget.value as TextDecoration,
                    });
                    onCommitEdit();
                  }}
                >
                  <option value="none">None</option>
                  <option value="underline">Underline</option>
                  <option value="line-through">Strike</option>
                </select>
              </label>
            </div>
          </div>
        </InspectorAccordionSection>
      )}

      {/* SECTION 6 — MODERN EFFECTS (DEFAULT COLLAPSED) */}
      <InspectorAccordionSection
        id="modern-effects"
        title="Modern Effects"
        badge={
          (selectedNode.effects?.length ?? 0) > 0 || Boolean(selectedNode.cssFilters)
            ? 'ACTIVE'
            : undefined
        }
        isOpen={openSections['modern-effects']}
        onToggle={toggleSection}
      >
        <InspectorModernEffectsSection
          selectedNode={selectedNode}
          activeState={activeState}
          onUpdateSelected={onUpdateSelected}
          onCommitEdit={onCommitEdit}
        />

        {/* Vector Draw Masking Mode */}
        <div class="inspector-acc-group" style={{ marginTop: '8px' }}>
          <label class="field-label">
            Vector Masking Mode
            <select
              class="select-field"
              aria-label="Draw mode"
              value={currentDrawMode}
              onChange={(event) => {
                const nextMode = event.currentTarget.value as DrawMaskMode;
                if (studioActions) {
                  studioActions.onSetDrawMode(nextMode);
                } else {
                  onUpdateSelected({ drawMode: nextMode });
                  onCommitEdit();
                }
              }}
            >
              <option value="normal">Normal</option>
              <option value="inside">Draw Inside (Vector Clip)</option>
              <option value="outside">Draw Outside (Inverted Mask)</option>
            </select>
          </label>
          {showPermanentSubtract && studioActions && (
            <button
              type="button"
              class="inspector-mini-btn is-accent inspector-span-full"
              onClick={studioActions.onPermanentSubtractOutside}
            >
              Permanent Subtract (Pathfinder)
            </button>
          )}
        </div>
      </InspectorAccordionSection>

      {/* SECTION 7 — RESPONSIVE, SEMANTIC HTML & A11Y (DEFAULT COLLAPSED) */}
      <InspectorAccordionSection
        id="responsive-semantic"
        title="Responsive, Semantic & A11y"
        badge={selectedNode.semanticTag ? `<${selectedNode.semanticTag}>` : activeBreakpoint.toUpperCase()}
        isOpen={openSections['responsive-semantic']}
        onToggle={toggleSection}
      >
        <InspectorResponsiveSemanticSection
          selectedNode={selectedNode}
          activeBreakpoint={activeBreakpoint}
          project={project}
          activePageId={activePageId}
          onSwitchBreakpoint={onSwitchBreakpoint}
          onUpdateSelected={onUpdateSelected}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 8 — COMPONENT, VECTOR & LOGIC (CONTEXTUAL, DEFAULT COLLAPSED) */}
      {isComponentLogicVisible && (
        <InspectorAccordionSection
          id="component-logic"
          title="Component & Logic"
          badge={selectedInstanceComponent?.name ?? editingMasterComponent?.name ?? (isPathNode ? 'PATH' : 'LOGIC')}
          isOpen={openSections['component-logic']}
          onToggle={toggleSection}
        >
          <div class="inspector-acc-group">
            {/* Component Instance & Master Contract */}
            {(selectedNode.type === 'component-instance' || editingMasterComponent) && (
              <InspectorComponentContractSection
                instanceNode={selectedNode.type === 'component-instance' ? selectedNode : null}
                instanceComponent={selectedInstanceComponent}
                editingMasterComponent={editingMasterComponent}
                onUpdateInstanceVariant={onUpdateInstanceVariant}
                onUpdateInstanceSlot={onUpdateInstanceSlot}
                onUpdateMasterContract={onUpdateMasterContract}
                onToggleComponentNodeLogic={onToggleComponentNodeLogic}
              />
            )}

            {selectedNode.type === 'component-instance' && (
              <div class="inspector-quick-row cols-2">
                <button
                  type="button"
                  class="inspector-mini-btn"
                  onClick={onResetInstanceOverrides}
                  disabled={Object.keys(selectedNode.overrides).length === 0}
                >
                  Reset Overrides
                </button>
                <button type="button" class="inspector-mini-btn" onClick={onDetachInstance}>
                  Detach Instance
                </button>
              </div>
            )}

            {/* Vector Path Operations */}
            {(isConvertibleVector || isPathNode) && (
              <div class="inspector-quick-row cols-2">
                {isConvertibleVector && (
                  <button
                    type="button"
                    class="inspector-mini-btn"
                    onClick={() => onConvertToPath(activeEditorId)}
                  >
                    Convert to Path
                  </button>
                )}
                {isPathNode && (
                  <>
                    <button
                      type="button"
                      class="inspector-mini-btn"
                      onClick={() => onChooseTool('direct-selection', activeEditorId)}
                    >
                      Edit Points (A)
                    </button>
                    <button
                      type="button"
                      class="inspector-mini-btn"
                      onClick={() => onTogglePathClosed(activeEditorId)}
                    >
                      {selectedNode.closed ? 'Open Path' : 'Close Path'}
                    </button>
                    <button
                      type="button"
                      class="inspector-mini-btn"
                      onClick={() => onSimplifyPath(activeEditorId)}
                    >
                      Simplify Path
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Quick Interactions */}
            {project &&
              activePageId &&
              onCreateQuickInteraction &&
              onUpdateQuickInteraction &&
              onDeleteQuickInteraction &&
              onOpenInteractionInNodeGraph && (
                <InspectorInteractionsSection
                  project={project}
                  activeEditorId={activeEditorId}
                  activePageId={activePageId}
                  editingMasterComponent={editingMasterComponent}
                  selectedNode={selectedNode}
                  scopedNodes={scopedNodes}
                  onCreateQuickInteraction={onCreateQuickInteraction}
                  onUpdateQuickInteraction={onUpdateQuickInteraction}
                  onDeleteQuickInteraction={onDeleteQuickInteraction}
                  onOpenInteractionInNodeGraph={onOpenInteractionInNodeGraph}
                />
              )}

            {targetLogicComponent && onToggleComponentNodeLogic && (
              <label class="toggle-row">
                <span>Node Logic Enabled</span>
                <input
                  type="checkbox"
                  checked={Boolean(targetLogicComponent.nodeLogicEnabled)}
                  onChange={(event) =>
                    onToggleComponentNodeLogic(targetLogicComponent, event.currentTarget.checked)
                  }
                />
              </label>
            )}

            {studioActions?.onOpenNodeLogic && (
              <button
                type="button"
                class="inspector-mini-btn is-accent inspector-span-full"
                onClick={studioActions.onOpenNodeLogic}
              >
                Open Node Logic
              </button>
            )}
          </div>
        </InspectorAccordionSection>
      )}
    </div>
  );
}

/**
 * Root InspectorPanel MUST remain hook-free because unit tests invoke
 * `InspectorPanel(props)` directly as a plain function without Preact render context.
 */
export function InspectorPanel({
  visible,
  width,
  isResizing,
  resizeHandleRef,
  activeEditorId,
  selectedNode,
  selectedNodes,
  selectedCount,
  canRemoveFromCanvas,
  selectedInstanceComponent,
  editingMasterComponent = null,
  activeBreakpoint,
  designTokens,
  defaultFillColor,
  renderIcon,
  onStartResize,
  onResizeDoubleClick,
  onResizeKeyDown,
  onCommitEdit,
  onHoverHint,
  onRemoveFromCanvas,
  onUpdateSelected,
  onUpdateSelectedStyle,
  onApplyAutoLayout,
  onConvertFrameLayoutMode,
  onSwitchBreakpoint,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
  onUpdateMasterContract,
  onToggleComponentNodeLogic,
  onResetInstanceOverrides,
  onDetachInstance,
  onConvertToPath,
  onTogglePathClosed,
  onSimplifyPath,
  onChooseTool,
  onQuickAdd,
  onInsertImageFiles,
  onDuplicateSelection,
  onCopySelection,
  project,
  activePageId,
  scopedNodes = [],
  onCreateQuickInteraction,
  onUpdateQuickInteraction,
  onDeleteQuickInteraction,
  onOpenInteractionInNodeGraph,
  studioActions,
}: InspectorPanelProps) {
  const triggerImagePicker = () => {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('folio-inspector-image-input') as HTMLInputElement | null;
    input?.click();
  };
  const safeSelectedNodes = Array.isArray(selectedNodes) ? selectedNodes : [];
  const effectiveSelectedCount = Math.min(selectedCount, safeSelectedNodes.length);
  const hasConvertibleInMulti = safeSelectedNodes.some(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  );
  const hasPathsInMulti = safeSelectedNodes.some((node) => node.type === 'path');

  return (
    <aside
      class={`inspector-panel ${visible ? '' : 'is-hidden'}`}
      aria-hidden={!visible}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onCommitEdit();
        }
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          event.key === 'Enter' &&
          target.matches('input:not([type="checkbox"]):not([type="range"])') &&
          !target.classList.contains('folio-num-unit-input')
        ) {
          event.preventDefault();
          target.blur();
          onCommitEdit();
        }
      }}
      onMouseEnter={onHoverHint}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Inspector panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_RESIZE_CONSTRAINTS.inspector.minWidth}
        aria-valuemax={PANEL_RESIZE_CONSTRAINTS.inspector.maxWidth}
        tabIndex={visible ? 0 : -1}
        data-resize-panel="inspector"
        class={`panel-resize-handle panel-resize-handle-left ${isResizing ? 'is-active' : ''}`}
        title="Drag to resize Inspector panel (double-click to reset)"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => onStartResize('inspector', event)}
        onDblClick={(event) => onResizeDoubleClick('inspector', event)}
        onKeyDown={(event) => onResizeKeyDown('inspector', event)}
      />
      <input
        id="folio-inspector-image-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          const fileList = event.currentTarget.files;
          if (fileList && fileList.length > 0 && onInsertImageFiles) {
            onInsertImageFiles(Array.from(fileList));
          }
          event.currentTarget.value = '';
        }}
      />
      <div class="panel-heading inspector-heading">
        <div>
          <span class="panel-kicker">PROPERTIES</span>
          <h2>Inspector</h2>
          <span class={`panel-context-indicator${activeEditorId === 'component' ? ' is-component' : ''}`}>
            {activeEditorId === 'component' ? 'COMPONENT CANVAS' : 'MAIN PAGE'}
          </span>
        </div>
        {selectedNode && canRemoveFromCanvas && (
          <button
            class="icon-button danger"
            title="Remove from Canvas only"
            aria-label="Remove from Canvas only"
            onClick={() => onRemoveFromCanvas(selectedNode.id)}
          >
            {renderIcon('trash')}
          </button>
        )}
      </div>

      {selectedNode ? (
        <InspectorSelectedNodeBody
          activeEditorId={activeEditorId}
          selectedNode={selectedNode}
          scopedNodes={scopedNodes}
          selectedInstanceComponent={selectedInstanceComponent}
          editingMasterComponent={editingMasterComponent}
          activeBreakpoint={activeBreakpoint}
          designTokens={designTokens}
          defaultFillColor={defaultFillColor}
          project={project}
          activePageId={activePageId}
          onCommitEdit={onCommitEdit}
          onUpdateSelected={onUpdateSelected}
          onUpdateSelectedStyle={onUpdateSelectedStyle}
          onApplyAutoLayout={onApplyAutoLayout}
          onConvertFrameLayoutMode={onConvertFrameLayoutMode}
          onSwitchBreakpoint={onSwitchBreakpoint}
          onUpdateInstanceVariant={onUpdateInstanceVariant}
          onUpdateInstanceSlot={onUpdateInstanceSlot}
          onUpdateMasterContract={onUpdateMasterContract}
          onToggleComponentNodeLogic={onToggleComponentNodeLogic}
          onResetInstanceOverrides={onResetInstanceOverrides}
          onDetachInstance={onDetachInstance}
          onConvertToPath={onConvertToPath}
          onTogglePathClosed={onTogglePathClosed}
          onSimplifyPath={onSimplifyPath}
          onChooseTool={onChooseTool}
          onDuplicateSelection={onDuplicateSelection}
          onCreateQuickInteraction={onCreateQuickInteraction}
          onUpdateQuickInteraction={onUpdateQuickInteraction}
          onDeleteQuickInteraction={onDeleteQuickInteraction}
          onOpenInteractionInNodeGraph={onOpenInteractionInNodeGraph}
          studioActions={studioActions}
        />
      ) : effectiveSelectedCount > 1 ? (
        <div class="inspector-content multi-inspector inspector-zero-typing">
          <section class="inspector-quick-header">
            <div class="section-title-row">
              <span class="section-title">{effectiveSelectedCount} Layers Selected</span>
              <span class="inspector-type-tag">MULTI</span>
            </div>
            <div class="inspector-quick-actions-row">
              <button type="button" class="inspector-quick-icon-btn" onClick={onDuplicateSelection}>
                Duplicate
              </button>
              <button type="button" class="inspector-quick-icon-btn" onClick={onCopySelection}>
                Copy
              </button>
              {studioActions && (
                <>
                  <button type="button" class="inspector-quick-icon-btn" onClick={studioActions.onDeselect}>
                    Deselect
                  </button>
                  <button type="button" class="inspector-quick-icon-btn" onClick={studioActions.onInvertSelection}>
                    Invert
                  </button>
                </>
              )}
            </div>
            {(hasConvertibleInMulti || hasPathsInMulti) && (
              <div class="inspector-quick-row cols-2">
                {hasConvertibleInMulti && (
                  <button type="button" class="inspector-mini-btn" onClick={() => onConvertToPath(activeEditorId)}>
                    Convert to Path
                  </button>
                )}
                {hasPathsInMulti && (
                  <button type="button" class="inspector-mini-btn" onClick={() => onSimplifyPath(activeEditorId)}>
                    Simplify Paths
                  </button>
                )}
              </div>
            )}
          </section>

          {studioActions && (
            <>
              <InspectorAlignDistributeSection
                selectedCount={effectiveSelectedCount}
                studioActions={studioActions}
              />
              <section class="property-section">
                <div class="section-title">Pathfinder &amp; Arrange</div>
                <div class="inspector-quick-row cols-4">
                  <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onBooleanOp('unite')}>
                    Unite
                  </button>
                  <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onBooleanOp('subtract')}>
                    Subtract
                  </button>
                  <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onBooleanOp('intersect')}>
                    Intersect
                  </button>
                  <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onBooleanOp('exclude')}>
                    Exclude
                  </button>
                </div>
                <InspectorTransformActions
                  studioActions={studioActions}
                  selectedCount={effectiveSelectedCount}
                  hasGroupSelected={safeSelectedNodes.some((node) => node.type === 'group')}
                />
              </section>
            </>
          )}
        </div>
      ) : activeEditorId === 'component' && editingMasterComponent ? (
        <div class="inspector-content inspector-zero-typing">
          <div class="inspector-empty">
            <div class="empty-icon">{renderIcon('cursor')}</div>
            <strong>Master: {editingMasterComponent.name}</strong>
            <p>Select a layer inside Component Canvas to edit its properties.</p>
            {onToggleComponentNodeLogic && (
              <label class="toggle-row" style={{ width: '100%', marginBottom: '8px' }}>
                <span>Node Logic Enabled</span>
                <input
                  type="checkbox"
                  checked={Boolean(editingMasterComponent.nodeLogicEnabled)}
                  onChange={(event) =>
                    onToggleComponentNodeLogic(editingMasterComponent, event.currentTarget.checked)
                  }
                />
              </label>
            )}
            <div class="quick-add">
              <button type="button" onClick={() => onQuickAdd('rect')}>+ Rectangle</button>
              <button type="button" onClick={() => onQuickAdd('text')}>+ Text</button>
              {onInsertImageFiles && (
                <button type="button" onClick={triggerImagePicker}>+ Image</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div class="inspector-empty">
          <div class="empty-icon">{renderIcon('cursor')}</div>
          <strong>Nothing selected</strong>
          <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
          <div class="quick-add">
            <button type="button" onClick={() => onQuickAdd('rect')}>+ Rectangle</button>
            <button type="button" onClick={() => onQuickAdd('text')}>+ Text</button>
            {onInsertImageFiles && (
              <button type="button" onClick={triggerImagePicker}>+ Image</button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

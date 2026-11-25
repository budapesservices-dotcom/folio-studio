import type { JSX, RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { CURATED_FONT_FAMILIES } from '../core/document/fonts';
import {
  applyShadowPresetToEffects,
  detectShadowPreset,
  SHADOW_PRESETS,
  type ShadowPresetId,
} from '../core/document/styling';
import type {
  AssetReference,
  BlendMode,
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
  ImageFitMode,
  NodeLayoutConfig,
  PathNode,
  RectNode,
  StrokeAlign,
  TextAlign,
  TextNode,
  TextVerticalAlign,
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
import {
  PresetStepperSlider,
  VisualColorAlphaControl,
} from './workspace/InspectorZeroTypingControls';
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
  | 'position'
  | 'fill-stroke'
  | 'text'
  | 'effects-masking'
  | 'component-logic';

const DEFAULT_ACCORDION_STATE: Record<AccordionSectionId, boolean> = {
  position: true,
  'fill-stroke': true,
  text: true,
  'effects-masking': false,
  'component-logic': false,
};

const DIMENSION_PRESETS = [24, 48, 80, 120, 160, 240, 320, 480, 640, 800, 1200] as const;
const POSITION_PRESETS = [0, 16, 32, 64, 120, 200, 320, 480, 640] as const;
const RADIUS_PRESETS = [0, 4, 8, 12, 16, 24, 32, 48, 999] as const;
const STROKE_WIDTH_PRESETS = [0, 1, 2, 3, 4, 6, 8, 12, 16] as const;
const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 32, 40, 48, 64, 72] as const;
const SPACING_PRESETS = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
const ROTATION_PRESETS = [0, 45, 90, 180] as const;

const FONT_WEIGHT_OPTIONS = [
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'SemiBold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
] as const;

const LINE_HEIGHT_PRESETS = [
  { label: 'Tight (1.1)', value: 1.1 },
  { label: 'Normal (1.35)', value: 1.35 },
  { label: 'Relaxed (1.6)', value: 1.6 },
  { label: 'Loose (1.85)', value: 1.85 },
] as const;

const LETTER_SPACING_PRESETS = [
  { label: 'Tight (-0.5px)', value: -0.5 },
  { label: 'Normal (0px)', value: 0 },
  { label: 'Wide (1px)', value: 1 },
  { label: 'Extra Wide (2.5px)', value: 2.5 },
] as const;

const BLEND_MODE_OPTIONS: ReadonlyArray<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
];

function resolveStrokeStyleKey(dasharray?: string): 'solid' | 'dashed' | 'dotted' {
  const trimmed = dasharray?.trim();
  if (!trimmed) return 'solid';
  const first = Number(trimmed.split(/[\s,]+/)[0]);
  return Number.isFinite(first) && first > 0 && first <= 3 ? 'dotted' : 'dashed';
}

function strokeStyleKeyToDasharray(key: 'solid' | 'dashed' | 'dotted'): string {
  if (key === 'dashed') return '8 5';
  if (key === 'dotted') return '2 4';
  return '';
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
  safeSelectedNodes: readonly DesignNode[];
  selectedInstanceComponent: ComponentDefinition | null;
  editingMasterComponent: ComponentDefinition | null;
  instanceOverrideTargets: InspectorOverrideTargets | null;
  designTokens: DesignTokenCollection;
  assets: readonly AssetReference[];
  defaultFillColor: string;
  onCommitEdit: () => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onUpdateInstanceOverride: (childNodeId: string, patch: { fill?: string; text?: string }) => void;
  onUpdateInstanceVariant: (axisId: string, optionId: string) => void;
  onUpdateInstanceSlot: (slotId: string, patch: { text?: string; visible?: boolean }) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  onResetInstanceOverrides: () => void;
  onDetachInstance: () => void;
  onConvertToPath: (target: EditorTarget) => void;
  onTogglePathClosed: (target: EditorTarget) => void;
  onSimplifyPath: (target: EditorTarget) => void;
  onChooseTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  onDuplicateSelection: () => void;
  studioActions?: StudioVectorActions;
}

function InspectorSelectedNodeBody({
  activeEditorId,
  selectedNode,
  safeSelectedNodes,
  selectedInstanceComponent,
  editingMasterComponent,
  instanceOverrideTargets,
  designTokens,
  assets,
  defaultFillColor,
  onCommitEdit,
  onUpdateSelected,
  onUpdateSelectedStyle,
  onApplyAutoLayout,
  onUpdateInstanceOverride,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
  onToggleComponentNodeLogic,
  onResetInstanceOverrides,
  onDetachInstance,
  onConvertToPath,
  onTogglePathClosed,
  onSimplifyPath,
  onChooseTool,
  onDuplicateSelection,
  studioActions,
}: InspectorSelectedNodeBodyProps) {
  const [openSections, setOpenSections] = useState<Record<AccordionSectionId, boolean>>(
    DEFAULT_ACCORDION_STATE,
  );
  const [transformOrigin, setTransformOrigin] = useState<TransformOriginAnchor>('tl');

  const isTextNode = selectedNode.type === 'text';
  const isComponentContext =
    selectedNode.type === 'component-instance' || Boolean(editingMasterComponent);

  const visibleSectionIds: AccordionSectionId[] = [
    'position',
    'fill-stroke',
    ...(isTextNode ? (['text'] as const) : []),
    'effects-masking',
    ...(isComponentContext ? (['component-logic'] as const) : []),
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

  const isAspectRatioLocked = Boolean(selectedNode.aspectRatioLocked);
  const anchorCoords = getAnchorCoordinates(selectedNode, transformOrigin);

  const handleDimensionChange = (axis: 'width' | 'height', nextValue: number) => {
    const currentAxisValue = axis === 'width' ? selectedNode.width : selectedNode.height;
    const safeNext = normalizePositiveDimension(nextValue, currentAxisValue);
    let nextW = axis === 'width' ? safeNext : selectedNode.width;
    let nextH = axis === 'height' ? safeNext : selectedNode.height;
    if (isAspectRatioLocked) {
      const anchor = selectedNode.height > 0 ? selectedNode.width / selectedNode.height : 1;
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

  const updateFrameLayout = (patch: Partial<NodeLayoutConfig>) => {
    if (selectedNode.type !== 'frame') return;
    const current: NodeLayoutConfig = selectedNode.layout ?? {
      mode: 'none',
      direction: 'column',
      wrap: 'nowrap',
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      justifyContent: 'start',
      alignItems: 'stretch',
      gridColumns: 2,
    };
    const nextLayout: NodeLayoutConfig = { ...current, ...patch };
    onUpdateSelected({ layout: nextLayout });
    if (nextLayout.mode !== 'none') {
      onApplyAutoLayout(selectedNode.id);
    }
    onCommitEdit();
  };

  const hasShapeStroke =
    selectedNode.type === 'rect' ||
    selectedNode.type === 'ellipse' ||
    selectedNode.type === 'frame' ||
    selectedNode.type === 'path';

  const activeShadowPreset = detectShadowPreset(selectedNode.effects);
  const layerBlurEffect = (selectedNode.effects ?? []).find(
    (item) => item.type === 'layer-blur' && item.enabled,
  );
  const bgBlurEffect = (selectedNode.effects ?? []).find(
    (item) => item.type === 'background-blur' && item.enabled,
  );
  const layerBlurPx = layerBlurEffect && layerBlurEffect.type === 'layer-blur' ? layerBlurEffect.blur : 0;
  const bgBlurPx = bgBlurEffect && bgBlurEffect.type === 'background-blur' ? bgBlurEffect.blur : 0;

  const updateBlurEffect = (kind: 'layer-blur' | 'background-blur', blur: number) => {
    const rest = (selectedNode.effects ?? []).filter((item) => item.type !== kind);
    const nextEffects =
      blur <= 0
        ? rest
        : [
            ...rest,
            {
              id: `effect-${kind}`,
              type: kind,
              enabled: true,
              blur,
            } as const,
          ];
    onUpdateSelected({ effects: nextEffects });
  };

  const currentDrawMode: DrawMaskMode = selectedNode.drawMode ?? 'normal';
  const showPermanentSubtract =
    currentDrawMode === 'outside' || selectedNode.clipMaskMode === 'outside';

  const targetLogicComponent =
    activeEditorId === 'component'
      ? editingMasterComponent
      : selectedInstanceComponent ?? editingMasterComponent;

  return (
    <div class="inspector-content inspector-zero-typing">
      {/* Top Expand/Collapse All Bar */}
      <InspectorAccordionToolbar
        allExpanded={allExpanded}
        openCount={openCount}
        totalCount={visibleSectionIds.length}
        onToggleAll={toggleAllSections}
      />

      {/* a. Quick Actions Header (Always Visible — ONLY text input in sidebar) */}
      <section class="inspector-quick-header" aria-label="Quick actions header">
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

      {/* b. Position & Size (Default Open) */}
      <InspectorAccordionSection
        id="position"
        title="Position & Size"
        badge={`${Math.round(selectedNode.width)}×${Math.round(selectedNode.height)}`}
        isOpen={openSections.position}
        onToggle={toggleSection}
      >
        {studioActions && (
          <div class="inspector-acc-group">
            <div class="inspector-align-grid" role="group" aria-label="Align and distribute">
              <button type="button" class="inspector-icon-btn" title="Align Left" onClick={() => studioActions.onAlign('left')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 2V14M5 4H12V6.5H5V4ZM5 9.5H9.5V12H5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Center X" onClick={() => studioActions.onAlign('center-x')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M8 2V14M4 4H12V6.5H4V4ZM5.5 9.5H10.5V12H5.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Right" onClick={() => studioActions.onAlign('right')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M13.5 2V14M4 4H11V6.5H4V4ZM6.5 9.5H11V12H6.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Top" onClick={() => studioActions.onAlign('top')}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M2 2.5H14M4 5H6.5V12H4V5ZM9.5 5H12V9.5H9.5V5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="inspector-icon-btn" title="Align Middle Y" onClick={() => studioActions.onAlign('center-y')}>
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

        <div class="inspector-acc-group">
          <div class="inspector-origin-bar">
            <TransformOriginSelector value={transformOrigin} onChange={setTransformOrigin} />
            <div class="inspector-origin-meta">
              <span class="inspector-sublabel">Origin ({transformOrigin.toUpperCase()})</span>
              <button
                type="button"
                class={`inspector-mini-btn${isAspectRatioLocked ? ' is-active' : ''}`}
                aria-pressed={isAspectRatioLocked}
                onClick={() => {
                  onUpdateSelected({ aspectRatioLocked: !isAspectRatioLocked });
                  onCommitEdit();
                }}
              >
                {isAspectRatioLocked ? 'Ratio Locked' : 'Lock Ratio'}
              </button>
            </div>
          </div>

          <PresetStepperSlider
            label="W"
            ariaLabel="Width"
            value={Math.round(selectedNode.width)}
            min={8}
            max={1920}
            step={4}
            presets={DIMENSION_PRESETS}
            onChange={(next) => handleDimensionChange('width', next)}
            onCommit={onCommitEdit}
          />
          <PresetStepperSlider
            label="H"
            ariaLabel="Height"
            value={Math.round(selectedNode.height)}
            min={8}
            max={1920}
            step={4}
            presets={DIMENSION_PRESETS}
            onChange={(next) => handleDimensionChange('height', next)}
            onCommit={onCommitEdit}
          />
          <PresetStepperSlider
            label="X"
            ariaLabel="X Position"
            value={Math.round(anchorCoords.x)}
            min={-400}
            max={1920}
            step={4}
            presets={POSITION_PRESETS}
            onChange={(next) =>
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'x', next))
            }
            onCommit={onCommitEdit}
          />
          <PresetStepperSlider
            label="Y"
            ariaLabel="Y Position"
            value={Math.round(anchorCoords.y)}
            min={-400}
            max={1920}
            step={4}
            presets={POSITION_PRESETS}
            onChange={(next) =>
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'y', next))
            }
            onCommit={onCommitEdit}
          />

          {(selectedNode.type === 'rect' || selectedNode.type === 'frame' || selectedNode.type === 'image') && (
            <PresetStepperSlider
              label="Radius"
              ariaLabel="Corner Radius"
              value={Math.round(selectedNode.style.radius ?? 0)}
              min={0}
              max={160}
              step={2}
              presets={RADIUS_PRESETS}
              onChange={(next) => onUpdateSelectedStyle({ radius: Math.max(0, next) })}
              onCommit={onCommitEdit}
            />
          )}
        </div>

        <div class="inspector-acc-group">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Rotation</span>
            <span class="zt-value-readout">{Math.round(selectedNode.rotation)}°</span>
          </div>
          <div class="inspector-quick-row cols-4">
            {ROTATION_PRESETS.map((deg) => (
              <button
                key={deg}
                type="button"
                class={`inspector-mini-btn${Math.round(selectedNode.rotation) === deg ? ' is-active' : ''}`}
                onClick={() => {
                  onUpdateSelected({ rotation: deg });
                  onCommitEdit();
                }}
              >
                {deg}°
              </button>
            ))}
          </div>
          <input
            type="range"
            class="zt-range-slider"
            aria-label="Rotation angle"
            min={-180}
            max={180}
            step={1}
            value={Math.round(selectedNode.rotation)}
            onInput={(event) => onUpdateSelected({ rotation: Number(event.currentTarget.value) })}
            onChange={onCommitEdit}
          />
          {studioActions && (
            <div class="inspector-quick-row cols-2">
              <button type="button" class="inspector-mini-btn" onClick={studioActions.onFlipHorizontal}>
                Flip Horizontal
              </button>
              <button type="button" class="inspector-mini-btn" onClick={studioActions.onFlipVertical}>
                Flip Vertical
              </button>
            </div>
          )}
        </div>

        {selectedNode.type === 'frame' && (
          <div class="inspector-acc-group inspector-autolayout-block">
            <div class="inspector-sublabel-row">
              <span class="inspector-sublabel">Frame Auto-Layout</span>
              <span class="inspector-accordion-badge">
                {(selectedNode.layout?.mode ?? 'none').toUpperCase()}
              </span>
            </div>
            <div class="field-grid single-row">
              <label class="field-label">
                Mode
                <select
                  class="select-field"
                  aria-label="Auto-Layout mode"
                  value={selectedNode.layout?.mode ?? 'none'}
                  onChange={(event) =>
                    updateFrameLayout({
                      mode: event.currentTarget.value as NodeLayoutConfig['mode'],
                    })
                  }
                >
                  <option value="none">None (Free)</option>
                  <option value="flex">Flex</option>
                  <option value="grid">Grid</option>
                </select>
              </label>
              <label class="field-label">
                Direction
                <select
                  class="select-field"
                  aria-label="Flex direction"
                  value={selectedNode.layout?.direction ?? 'column'}
                  onChange={(event) =>
                    updateFrameLayout({
                      direction: event.currentTarget.value as NodeLayoutConfig['direction'],
                    })
                  }
                >
                  <option value="row">Row</option>
                  <option value="column">Column</option>
                </select>
              </label>
            </div>
            {(selectedNode.layout?.mode ?? 'none') !== 'none' && (
              <>
                <div class="field-grid single-row">
                  <label class="field-label">
                    Justify
                    <select
                      class="select-field"
                      aria-label="Justify content"
                      value={selectedNode.layout?.justifyContent ?? 'start'}
                      onChange={(event) =>
                        updateFrameLayout({
                          justifyContent: event.currentTarget.value as NodeLayoutConfig['justifyContent'],
                        })
                      }
                    >
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                      <option value="space-between">Between</option>
                      <option value="space-around">Around</option>
                    </select>
                  </label>
                  <label class="field-label">
                    Align
                    <select
                      class="select-field"
                      aria-label="Align items"
                      value={selectedNode.layout?.alignItems ?? 'stretch'}
                      onChange={(event) =>
                        updateFrameLayout({
                          alignItems: event.currentTarget.value as NodeLayoutConfig['alignItems'],
                        })
                      }
                    >
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                      <option value="stretch">Stretch</option>
                    </select>
                  </label>
                </div>
                <PresetStepperSlider
                  label="Gap"
                  ariaLabel="Auto-Layout Gap"
                  value={Math.round(selectedNode.layout?.gap ?? 12)}
                  min={0}
                  max={96}
                  step={4}
                  presets={SPACING_PRESETS}
                  onChange={(next) => updateFrameLayout({ gap: next })}
                />
                <PresetStepperSlider
                  label="Padding"
                  ariaLabel="Auto-Layout Padding"
                  value={Math.round(selectedNode.layout?.padding.top ?? 16)}
                  min={0}
                  max={96}
                  step={4}
                  presets={SPACING_PRESETS}
                  onChange={(next) =>
                    updateFrameLayout({
                      padding: { top: next, right: next, bottom: next, left: next },
                    })
                  }
                />
              </>
            )}
            <label class="toggle-row">
              <span>Clip Content</span>
              <input
                type="checkbox"
                checked={selectedNode.clipContent !== false}
                onChange={(event) => {
                  onUpdateSelected({ clipContent: event.currentTarget.checked } as Partial<DesignNode>);
                  onCommitEdit();
                }}
              />
            </label>
          </div>
        )}
      </InspectorAccordionSection>

      {/* c. Fill & Stroke (Default Open) */}
      <InspectorAccordionSection
        id="fill-stroke"
        title="Fill & Stroke"
        isOpen={openSections['fill-stroke']}
        onToggle={toggleSection}
      >
        {selectedNode.type === 'group' ? (
          <p class="field-help">Group container — select a child layer to edit fill or stroke.</p>
        ) : selectedNode.type === 'component-instance' ? (
          instanceOverrideTargets?.fillNode ? (
            <VisualColorAlphaControl
              label="Instance Fill"
              value={
                selectedNode.overrides[instanceOverrideTargets.fillNode.id]?.fill ??
                instanceOverrideTargets.fillNode.style.fill
              }
              fallbackHex={defaultFillColor}
              designTokens={designTokens}
              onChangeColor={(nextColor) =>
                onUpdateInstanceOverride(instanceOverrideTargets.fillNode!.id, { fill: nextColor })
              }
              onCommit={onCommitEdit}
            />
          ) : (
            <p class="field-help">Linked Component Instance — edit colors via Variants or Master.</p>
          )
        ) : selectedNode.type === 'image' ? (
          <div class="inspector-acc-group">
            {(() => {
              const linkedAsset = assets.find((item) => item.id === selectedNode.assetId);
              return (
                <div class="vector-meta-row">
                  <span>Asset</span>
                  <strong>
                    {linkedAsset?.width && linkedAsset?.height
                      ? `${linkedAsset.width}×${linkedAsset.height}px`
                      : (linkedAsset?.name ?? selectedNode.assetId)}
                  </strong>
                </div>
              );
            })()}
            <label class="field-label">
              Object Fit
              <select
                class="select-field"
                aria-label="Image fit mode"
                value={selectedNode.style.fit}
                onChange={(event) => {
                  onUpdateSelectedStyle({ fit: event.currentTarget.value as ImageFitMode });
                  onCommitEdit();
                }}
              >
                <option value="cover">Cover (Crop)</option>
                <option value="contain">Contain (Fit)</option>
                <option value="fill">Fill (Stretch)</option>
              </select>
            </label>
            <VisualColorAlphaControl
              label="Stroke"
              value={selectedNode.style.stroke ?? 'transparent'}
              fallbackHex="#00E5FF"
              boundTokenId={selectedNode.tokenBindings?.stroke}
              designTokens={designTokens}
              onChangeColor={(nextColor) =>
                onUpdateSelectedStyle({
                  stroke: nextColor,
                  strokeWidth:
                    nextColor === 'transparent'
                      ? 0
                      : Math.max(1, selectedNode.style.strokeWidth ?? 0),
                })
              }
              onBindToken={(tokenId) =>
                onUpdateSelected({
                  tokenBindings: { ...(selectedNode.tokenBindings ?? {}), stroke: tokenId },
                })
              }
              onCommit={onCommitEdit}
            />
            <PresetStepperSlider
              label="Stroke Width"
              ariaLabel="Stroke Width"
              value={selectedNode.style.strokeWidth ?? 0}
              min={0}
              max={32}
              step={1}
              presets={STROKE_WIDTH_PRESETS}
              onChange={(next) => onUpdateSelectedStyle({ strokeWidth: next })}
              onCommit={onCommitEdit}
            />
          </div>
        ) : (
          <div class="inspector-acc-group">
            <VisualColorAlphaControl
              label="Fill"
              value={selectedNode.style.fill}
              fallbackHex={defaultFillColor}
              boundTokenId={selectedNode.tokenBindings?.fill}
              designTokens={designTokens}
              onChangeColor={(nextColor) => onUpdateSelectedStyle({ fill: nextColor })}
              onBindToken={(tokenId) =>
                onUpdateSelected({
                  tokenBindings: { ...(selectedNode.tokenBindings ?? {}), fill: tokenId },
                })
              }
              onCommit={onCommitEdit}
            />

            {hasShapeStroke && (
              <>
                <div class="inspector-swap-row">
                  <button
                    type="button"
                    class="inspector-mini-btn"
                    title="Swap Fill and Stroke colors"
                    onClick={() => {
                      const prevFill = selectedNode.style.fill;
                      const prevStroke = selectedNode.style.stroke;
                      onUpdateSelectedStyle({
                        fill: prevStroke === 'none' ? 'transparent' : prevStroke,
                        stroke: prevFill === 'none' ? 'transparent' : prevFill,
                        strokeWidth: Math.max(1, selectedNode.style.strokeWidth),
                      });
                      onCommitEdit();
                    }}
                  >
                    ⇄ Swap Fill &amp; Stroke
                  </button>
                </div>

                <VisualColorAlphaControl
                  label="Stroke"
                  value={selectedNode.style.stroke}
                  fallbackHex="#00E5FF"
                  boundTokenId={selectedNode.tokenBindings?.stroke}
                  designTokens={designTokens}
                  onChangeColor={(nextColor) =>
                    onUpdateSelectedStyle({
                      stroke: nextColor,
                      strokeWidth:
                        nextColor === 'transparent' || nextColor === 'none'
                          ? 0
                          : Math.max(1, selectedNode.style.strokeWidth),
                    })
                  }
                  onBindToken={(tokenId) =>
                    onUpdateSelected({
                      tokenBindings: { ...(selectedNode.tokenBindings ?? {}), stroke: tokenId },
                    })
                  }
                  onCommit={onCommitEdit}
                />

                <PresetStepperSlider
                  label="Stroke Width"
                  ariaLabel="Stroke Width"
                  value={selectedNode.style.strokeWidth}
                  min={0}
                  max={32}
                  step={1}
                  presets={STROKE_WIDTH_PRESETS}
                  onChange={(next) => onUpdateSelectedStyle({ strokeWidth: next })}
                  onCommit={onCommitEdit}
                />

                <div class="field-grid single-row">
                  <label class="field-label">
                    Stroke Style
                    <select
                      class="select-field"
                      aria-label="Stroke Style"
                      value={resolveStrokeStyleKey(selectedNode.style.strokeDasharray)}
                      onChange={(event) => {
                        const key = event.currentTarget.value as 'solid' | 'dashed' | 'dotted';
                        onUpdateSelectedStyle({ strokeDasharray: strokeStyleKeyToDasharray(key) });
                        onCommitEdit();
                      }}
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </label>
                  <label class="field-label">
                    Position
                    <select
                      class="select-field"
                      aria-label="Stroke Position"
                      value={selectedNode.style.strokeAlign ?? 'center'}
                      onChange={(event) => {
                        onUpdateSelectedStyle({ strokeAlign: event.currentTarget.value as StrokeAlign });
                        onCommitEdit();
                      }}
                    >
                      <option value="inside">Inside</option>
                      <option value="center">Center</option>
                      <option value="outside">Outside</option>
                    </select>
                  </label>
                </div>

                <div class="inspector-quick-row cols-2">
                  {selectedNode.type === 'path' ? (
                    <>
                      <button
                        type="button"
                        class="inspector-mini-btn"
                        onClick={() => onChooseTool('direct-selection', activeEditorId)}
                      >
                        Edit Anchors
                      </button>
                      <button
                        type="button"
                        class="inspector-mini-btn"
                        onClick={() => onSimplifyPath(activeEditorId)}
                      >
                        Simplify Path
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      class="inspector-mini-btn inspector-span-full"
                      onClick={() => onConvertToPath(activeEditorId)}
                    >
                      Convert to Vector Path
                    </button>
                  )}
                </div>

                {selectedNode.type === 'path' && (
                  <label class="toggle-row">
                    <span>Closed Contour</span>
                    <input
                      type="checkbox"
                      checked={selectedNode.closed}
                      onChange={() => onTogglePathClosed(activeEditorId)}
                    />
                  </label>
                )}
              </>
            )}
          </div>
        )}
      </InspectorAccordionSection>

      {/* d. Text & Paragraph (Contextual — Only when Text Node is Selected, Default Open) */}
      {isTextNode && (
        <InspectorAccordionSection
          id="text"
          title="Text & Paragraph"
          badge={`${Math.round(selectedNode.style.fontSize)}px`}
          isOpen={openSections.text}
          onToggle={toggleSection}
        >
          <div class="inspector-acc-group">
            <label class="field-label">
              Font Family
              <select
                class="select-field"
                aria-label="Font family"
                value={selectedNode.style.fontFamily}
                onChange={(event) => {
                  onUpdateSelectedStyle({ fontFamily: event.currentTarget.value });
                  onCommitEdit();
                }}
              >
                {!INSPECTOR_FONT_FAMILIES.some((opt) => opt.value === selectedNode.style.fontFamily) && (
                  <option value={selectedNode.style.fontFamily}>{selectedNode.style.fontFamily}</option>
                )}
                {INSPECTOR_FONT_FAMILIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label class="field-label">
              Font Weight
              <select
                class="select-field"
                aria-label="Font weight"
                value={String(selectedNode.style.fontWeight)}
                onChange={(event) => {
                  onUpdateSelectedStyle({ fontWeight: Number(event.currentTarget.value) });
                  onCommitEdit();
                }}
              >
                {!FONT_WEIGHT_OPTIONS.some((opt) => opt.value === selectedNode.style.fontWeight) && (
                  <option value={String(selectedNode.style.fontWeight)}>
                    Weight ({selectedNode.style.fontWeight})
                  </option>
                )}
                {FONT_WEIGHT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <PresetStepperSlider
              label="Font Size"
              ariaLabel="Font Size"
              value={Math.round(selectedNode.style.fontSize)}
              min={8}
              max={160}
              step={2}
              presets={FONT_SIZE_PRESETS}
              onChange={(next) => onUpdateSelectedStyle({ fontSize: Math.max(8, next) })}
              onCommit={onCommitEdit}
            />

            <div class="field-grid single-row">
              <label class="field-label">
                Line Height
                <select
                  class="select-field"
                  aria-label="Line height preset"
                  value={String(selectedNode.style.lineHeight)}
                  onChange={(event) => {
                    onUpdateSelectedStyle({ lineHeight: Number(event.currentTarget.value) });
                    onCommitEdit();
                  }}
                >
                  {!LINE_HEIGHT_PRESETS.some(
                    (opt) => Math.abs(opt.value - selectedNode.style.lineHeight) < 0.02,
                  ) && (
                    <option value={String(selectedNode.style.lineHeight)}>
                      Custom ({selectedNode.style.lineHeight})
                    </option>
                  )}
                  {LINE_HEIGHT_PRESETS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field-label">
                Letter Spacing
                <select
                  class="select-field"
                  aria-label="Letter spacing preset"
                  value={String(selectedNode.style.letterSpacing)}
                  onChange={(event) => {
                    onUpdateSelectedStyle({ letterSpacing: Number(event.currentTarget.value) });
                    onCommitEdit();
                  }}
                >
                  {!LETTER_SPACING_PRESETS.some(
                    (opt) => Math.abs(opt.value - selectedNode.style.letterSpacing) < 0.05,
                  ) && (
                    <option value={String(selectedNode.style.letterSpacing)}>
                      Custom ({selectedNode.style.letterSpacing}px)
                    </option>
                  )}
                  {LETTER_SPACING_PRESETS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div class="inspector-align-row">
              <span class="inspector-sublabel">Horizontal Alignment</span>
              <div class="inspector-icon-seg-group cols-4" role="group" aria-label="Horizontal text alignment">
                {(['left', 'center', 'right', 'justify'] as const).map((align) => {
                  const active = (selectedNode.style.textAlign ?? 'left') === align;
                  const label = align.charAt(0).toUpperCase() + align.slice(1);
                  return (
                    <button
                      key={align}
                      type="button"
                      class={`inspector-icon-btn${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      aria-label={`Align ${label}`}
                      title={`Align ${label}`}
                      onClick={() => {
                        onUpdateSelectedStyle({ textAlign: align });
                        onCommitEdit();
                      }}
                    >
                      {renderHorizontalAlignIcon(align)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div class="inspector-align-row">
              <span class="inspector-sublabel">Vertical Alignment</span>
              <div class="inspector-icon-seg-group cols-3" role="group" aria-label="Vertical text alignment">
                {(['top', 'middle', 'bottom'] as const).map((vAlign) => {
                  const active = (selectedNode.style.verticalAlign ?? 'top') === vAlign;
                  const label = vAlign.charAt(0).toUpperCase() + vAlign.slice(1);
                  return (
                    <button
                      key={vAlign}
                      type="button"
                      class={`inspector-icon-btn${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      aria-label={`Vertical Align ${label}`}
                      title={`Vertical Align ${label}`}
                      onClick={() => {
                        onUpdateSelectedStyle({ verticalAlign: vAlign });
                        onCommitEdit();
                      }}
                    >
                      {renderVerticalAlignIcon(vAlign)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div class="field-grid single-row">
              <label class="field-label">
                Case
                <select
                  class="select-field"
                  aria-label="Text case"
                  value={selectedNode.style.textTransform ?? 'none'}
                  onChange={(event) => {
                    onUpdateSelectedStyle({ textTransform: event.currentTarget.value });
                    onCommitEdit();
                  }}
                >
                  <option value="none">Normal</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="lowercase">lowercase</option>
                  <option value="capitalize">Title Case</option>
                </select>
              </label>
              <label class="field-label">
                Decoration
                <select
                  class="select-field"
                  aria-label="Text decoration"
                  value={selectedNode.style.textDecoration ?? 'none'}
                  onChange={(event) => {
                    onUpdateSelectedStyle({ textDecoration: event.currentTarget.value });
                    onCommitEdit();
                  }}
                >
                  <option value="none">None</option>
                  <option value="underline">Underline</option>
                  <option value="line-through">Strikethrough</option>
                </select>
              </label>
            </div>

            <label class="toggle-row">
              <span>Wrap Text Inside Box</span>
              <input
                type="checkbox"
                checked={(selectedNode.style.textWrap ?? 'wrap') === 'wrap'}
                onChange={(event) => {
                  onUpdateSelectedStyle({
                    textWrap: event.currentTarget.checked ? 'wrap' : 'nowrap',
                  });
                  onCommitEdit();
                }}
              />
            </label>
          </div>
        </InspectorAccordionSection>
      )}

      {/* e. Effects & Masking (Default Collapsed) */}
      <InspectorAccordionSection
        id="effects-masking"
        title="Effects & Masking"
        badge={currentDrawMode !== 'normal' ? currentDrawMode.toUpperCase() : `${Math.round(selectedNode.opacity * 100)}%`}
        isOpen={openSections['effects-masking']}
        onToggle={toggleSection}
      >
        <div class="inspector-acc-group">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Opacity</span>
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
            onInput={(event) =>
              onUpdateSelected({
                opacity: Math.min(1, Math.max(0, Number(event.currentTarget.value) / 100)),
              })
            }
            onChange={onCommitEdit}
          />

          <div class="field-grid single-row">
            <label class="field-label">
              Blend Mode
              <select
                class="select-field"
                aria-label="Blend mode"
                value={selectedNode.blendMode ?? 'normal'}
                onChange={(event) => {
                  onUpdateSelected({ blendMode: event.currentTarget.value as BlendMode });
                  onCommitEdit();
                }}
              >
                {BLEND_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label class="field-label">
              Shadow Preset
              <select
                class="select-field"
                aria-label="Shadow preset"
                value={activeShadowPreset}
                onChange={(event) => {
                  const presetId = event.currentTarget.value as ShadowPresetId;
                  onUpdateSelected({
                    effects: applyShadowPresetToEffects(selectedNode.effects, presetId),
                  });
                  onCommitEdit();
                }}
              >
                {SHADOW_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Layer Blur</span>
            <span class="zt-value-readout">{Math.round(layerBlurPx)}px</span>
          </div>
          <input
            type="range"
            class="zt-range-slider"
            aria-label="Layer blur"
            min={0}
            max={48}
            step={1}
            value={Math.round(layerBlurPx)}
            onInput={(event) => updateBlurEffect('layer-blur', Number(event.currentTarget.value))}
            onChange={onCommitEdit}
          />

          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Background Blur</span>
            <span class="zt-value-readout">{Math.round(bgBlurPx)}px</span>
          </div>
          <input
            type="range"
            class="zt-range-slider"
            aria-label="Background blur"
            min={0}
            max={48}
            step={1}
            value={Math.round(bgBlurPx)}
            onInput={(event) => updateBlurEffect('background-blur', Number(event.currentTarget.value))}
            onChange={onCommitEdit}
          />

          <label class="field-label">
            Draw Mode (Vector Masking)
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

      {/* f. Component & Logic (Contextual — Default Collapsed) */}
      {isComponentContext && (
        <InspectorAccordionSection
          id="component-logic"
          title="Component & Logic"
          badge={selectedInstanceComponent?.name ?? editingMasterComponent?.name ?? 'LINKED'}
          isOpen={openSections['component-logic']}
          onToggle={toggleSection}
        >
          <div class="inspector-acc-group">
            {selectedNode.type === 'component-instance' && selectedInstanceComponent && (
              <>
                {(selectedInstanceComponent.variants ?? []).map((axis) => {
                  const activeOptionId =
                    selectedNode.variantSelection?.[axis.id] ?? axis.defaultOptionId;
                  return (
                    <label key={axis.id} class="field-label">
                      {axis.name}
                      <select
                        class="select-field"
                        aria-label={`Variant ${axis.name}`}
                        value={activeOptionId}
                        onChange={(event) => {
                          onUpdateInstanceVariant(axis.id, event.currentTarget.value);
                          onCommitEdit();
                        }}
                      >
                        {axis.options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}

                {(selectedInstanceComponent.slots ?? []).map((slot) => {
                  const slotState = selectedNode.slotOverrides?.[slot.id];
                  const isVisible = slotState?.visible ?? slot.defaultVisible;
                  return (
                    <label key={slot.id} class="toggle-row">
                      <span>Slot: {slot.name}</span>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={(event) => {
                          onUpdateInstanceSlot(slot.id, { visible: event.currentTarget.checked });
                          onCommitEdit();
                        }}
                      />
                    </label>
                  );
                })}

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
              </>
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
  instanceOverrideTargets,
  designTokens,
  assets = [],
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
  onUpdateInstanceOverride,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
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
        if (event.key === 'Enter' && target.matches('input:not([type="checkbox"]):not([type="range"])')) {
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
          safeSelectedNodes={safeSelectedNodes}
          selectedInstanceComponent={selectedInstanceComponent}
          editingMasterComponent={editingMasterComponent}
          instanceOverrideTargets={instanceOverrideTargets}
          designTokens={designTokens}
          assets={assets}
          defaultFillColor={defaultFillColor}
          onCommitEdit={onCommitEdit}
          onUpdateSelected={onUpdateSelected}
          onUpdateSelectedStyle={onUpdateSelectedStyle}
          onApplyAutoLayout={onApplyAutoLayout}
          onUpdateInstanceOverride={onUpdateInstanceOverride}
          onUpdateInstanceVariant={onUpdateInstanceVariant}
          onUpdateInstanceSlot={onUpdateInstanceSlot}
          onToggleComponentNodeLogic={onToggleComponentNodeLogic}
          onResetInstanceOverrides={onResetInstanceOverrides}
          onDetachInstance={onDetachInstance}
          onConvertToPath={onConvertToPath}
          onTogglePathClosed={onTogglePathClosed}
          onSimplifyPath={onSimplifyPath}
          onChooseTool={onChooseTool}
          onDuplicateSelection={onDuplicateSelection}
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

import type { JSX, RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
  InteractiveStateId,
  LayoutMode,
  PathNode,
  RectNode,
  TextNode,
} from '../core/document/types';
import { PANEL_RESIZE_CONSTRAINTS, type ResizablePanelId } from './panelResize';
import type { EditorTarget } from './editorContext';
import type { CanvasToolId, ShapeColorBlendMode } from '../core/tools/operationContract';
import type { StudioVectorActions } from './workspace/inspectorVectorHelpers';
import {
  InspectorAccordionSection,
  InspectorAccordionToolbar,
} from './workspace/InspectorAccordion';
import {
  InspectorInteractiveStateSection,
  InspectorQuickHeaderActions,
  InspectorSelectSimilarControl,
} from './workspace/InspectorInteractiveStateSection';
import { InspectorFrameLayoutSection } from './workspace/InspectorFrameLayoutSection';
import { InspectorSizePositionSection } from './workspace/InspectorSizePositionSection';
import { InspectorAppearanceSection } from './workspace/InspectorAppearanceSection';
import {
  INSPECTOR_FONT_FAMILIES,
  InspectorTypographySection,
} from './workspace/InspectorTypographySection';
import { InspectorModernEffectsSection } from './workspace/InspectorModernEffectsSection';
import { InspectorResponsiveSemanticSection } from './workspace/InspectorResponsiveSemanticSection';
import {
  InspectorComponentLogicSection,
  InspectorVectorMaskingControl,
} from './workspace/InspectorComponentLogicSection';
import {
  InspectorEmptyStateView,
  InspectorMultiSelectionView,
} from './workspace/InspectorSelectionStates';
import type {
  QuickInteractionConfig,
  QuickInteractionEntry,
  QuickInteractionScopeContext,
} from './workspace/quickInteractions';

export { INSPECTOR_FONT_FAMILIES };

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
  colorBlendMode?: ShapeColorBlendMode;
  onChangeColorBlendMode?: (mode: ShapeColorBlendMode) => void;
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

interface InspectorSelectedNodeBodyProps {
  panel: InspectorPanelProps;
  selectedNode: DesignNode;
}

function InspectorSelectedNodeBody({ panel, selectedNode }: InspectorSelectedNodeBodyProps) {
  const {
    activeEditorId,
    scopedNodes = [],
    selectedInstanceComponent,
    editingMasterComponent = null,
    activeBreakpoint,
    designTokens,
    defaultFillColor,
    project,
    activePageId,
    onCommitEdit,
    onUpdateSelected,
    onUpdateSelectedStyle,
    onTogglePropertyKeyframe,
    isPropertyKeyedAtPlayhead,
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
  } = panel;

  const [openSections, setOpenSections] = useState<Record<AccordionSectionId, boolean>>(
    DEFAULT_ACCORDION_STATE,
  );
  const [activeState, setActiveState] = useState<InteractiveStateId>('default');

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
  const isPseudoState = activeState !== 'default';

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

  return (
    <div class={`inspector-content inspector-zero-typing${isPseudoState ? ' is-state-editing' : ''}`}>
      <InspectorAccordionToolbar
        allExpanded={allExpanded}
        openCount={openCount}
        totalCount={visibleSectionIds.length}
        onToggleAll={toggleAllSections}
      />

      {/* SECTION 1 — HEADER IDENTITY & INTERACTIVE STATE SWITCHER */}
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

        <InspectorQuickHeaderActions
          selectedNode={selectedNode}
          studioActions={studioActions}
          onUpdateSelected={onUpdateSelected}
          onDuplicateSelection={onDuplicateSelection}
          onCommitEdit={onCommitEdit}
        />

        <InspectorInteractiveStateSection
          selectedNode={selectedNode}
          activeState={activeState}
          onSelectState={setActiveState}
          onUpdateSelected={onUpdateSelected}
          onCommitEdit={onCommitEdit}
        />

        {studioActions && <InspectorSelectSimilarControl studioActions={studioActions} />}
      </section>

      {/* SECTION 2 — LAYOUT & FRAME */}
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

      {/* SECTION 3 — SIZE & POSITION */}
      <InspectorAccordionSection
        id="size-position"
        title="Size & Position"
        badge={`${Math.round(selectedNode.width)}×${Math.round(selectedNode.height)}`}
        isOpen={openSections['size-position']}
        onToggle={toggleSection}
      >
        <InspectorSizePositionSection
          selectedNode={selectedNode}
          parentNode={parentNode}
          studioActions={studioActions}
          onUpdateSelected={onUpdateSelected}
          onApplyAutoLayout={onApplyAutoLayout}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 4 — FILL, BORDER & RADIUS */}
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
          onConvertToPath={() => onConvertToPath(activeEditorId)}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 5 — TEXT & PARAGRAPH (TEXT NODES ONLY) */}
      {isTextNode && (
        <InspectorAccordionSection
          id="text"
          title="Text & Paragraph"
          badge={`${selectedNode.style.fontSize}${selectedNode.style.fontSizeUnit ?? 'px'}`}
          isOpen={openSections.text}
          onToggle={toggleSection}
        >
          <InspectorTypographySection
            selectedNode={selectedNode}
            onUpdateSelectedStyle={onUpdateSelectedStyle}
            onUpdateExtendedStyle={handleUpdateExtendedStyle}
            onCommitEdit={onCommitEdit}
          />
        </InspectorAccordionSection>
      )}

      {/* SECTION 6 — MODERN EFFECTS */}
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
          onTogglePropertyKeyframe={onTogglePropertyKeyframe}
          isPropertyKeyedAtPlayhead={isPropertyKeyedAtPlayhead}
        />
        <InspectorVectorMaskingControl
          selectedNode={selectedNode}
          studioActions={studioActions}
          onUpdateSelected={onUpdateSelected}
          onCommitEdit={onCommitEdit}
        />
      </InspectorAccordionSection>

      {/* SECTION 7 — RESPONSIVE, SEMANTIC HTML & A11Y */}
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

      {/* SECTION 8 — COMPONENT, VECTOR & LOGIC */}
      {isComponentLogicVisible && (
        <InspectorAccordionSection
          id="component-logic"
          title="Component & Logic"
          badge={selectedInstanceComponent?.name ?? editingMasterComponent?.name ?? (isPathNode ? 'PATH' : 'LOGIC')}
          isOpen={openSections['component-logic']}
          onToggle={toggleSection}
        >
          <InspectorComponentLogicSection
            activeEditorId={activeEditorId}
            selectedNode={selectedNode}
            scopedNodes={scopedNodes}
            selectedInstanceComponent={selectedInstanceComponent}
            editingMasterComponent={editingMasterComponent}
            project={project}
            activePageId={activePageId}
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
            onCreateQuickInteraction={onCreateQuickInteraction}
            onUpdateQuickInteraction={onUpdateQuickInteraction}
            onDeleteQuickInteraction={onDeleteQuickInteraction}
            onOpenInteractionInNodeGraph={onOpenInteractionInNodeGraph}
            studioActions={studioActions}
          />
        </InspectorAccordionSection>
      )}
    </div>
  );
}

/**
 * Root InspectorPanel MUST remain hook-free because unit tests invoke
 * `InspectorPanel(props)` directly as a plain function without Preact render context.
 */
export function InspectorPanel(props: InspectorPanelProps) {
  const {
    visible,
    width,
    isResizing,
    resizeHandleRef,
    activeEditorId,
    selectedNode,
    selectedNodes,
    selectedCount,
    canRemoveFromCanvas,
    editingMasterComponent = null,
    renderIcon,
    onStartResize,
    onResizeDoubleClick,
    onResizeKeyDown,
    onCommitEdit,
    onHoverHint,
    onRemoveFromCanvas,
    onToggleComponentNodeLogic,
    onConvertToPath,
    onSimplifyPath,
    onQuickAdd,
    onInsertImageFiles,
    onDuplicateSelection,
    onCopySelection,
    studioActions,
  } = props;

  const triggerImagePicker = () => {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('folio-inspector-image-input') as HTMLInputElement | null;
    input?.click();
  };
  const safeSelectedNodes = Array.isArray(selectedNodes) ? selectedNodes : [];
  const effectiveSelectedCount = Math.min(selectedCount, safeSelectedNodes.length);

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
        <InspectorSelectedNodeBody panel={props} selectedNode={selectedNode} />
      ) : effectiveSelectedCount > 1 ? (
        InspectorMultiSelectionView({
          activeEditorId,
          selectedNodes: safeSelectedNodes,
          effectiveSelectedCount,
          colorBlendMode: props.colorBlendMode,
          onChangeColorBlendMode: props.onChangeColorBlendMode,
          onDuplicateSelection,
          onCopySelection,
          onConvertToPath,
          onSimplifyPath,
          studioActions,
        })
      ) : (
        InspectorEmptyStateView({
          activeEditorId,
          editingMasterComponent,
          renderIcon,
          onToggleComponentNodeLogic,
          onQuickAdd,
          hasImageInsert: Boolean(onInsertImageFiles),
          onTriggerImagePicker: triggerImagePicker,
        })
      )}
    </aside>
  );
}

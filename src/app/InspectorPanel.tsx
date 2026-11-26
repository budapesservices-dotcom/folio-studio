import { useEffect, useState } from 'preact/hooks';
import type { DesignNode, InteractiveStateId } from '../core/document/types';
import { PANEL_RESIZE_CONSTRAINTS } from './panelResize';
import {
  InspectorAccordionSection,
  InspectorAccordionToolbar,
} from './workspace/InspectorAccordion';
import {
  InspectorInteractiveStateSection,
  InspectorQuickHeaderActions,
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
import { StudioContextMenu } from './workspace/StudioContextMenu';
import {
  buildInspectorContextEntries,
  getDefaultInspectorOpenSections,
  resolveInspectorLayoutBadge,
  type InspectorAccordionSectionId,
  type InspectorOverrideTargets,
  type InspectorPanelProps,
} from './workspace/inspectorPanelTypes';

export {
  INSPECTOR_FONT_FAMILIES,
  getDefaultInspectorOpenSections,
  type InspectorAccordionSectionId,
  type InspectorOverrideTargets,
  type InspectorPanelProps,
};

interface InspectorSelectedNodeBodyProps {
  panel: InspectorPanelProps;
  selectedNode: DesignNode;
}

function InspectorSelectedNodeBody({ panel, selectedNode }: InspectorSelectedNodeBodyProps) {
  const {
    activeEditorId,
    scopedNodes = [],
    canRemoveFromCanvas,
    selectedInstanceComponent,
    editingMasterComponent = null,
    activeBreakpoint,
    designTokens,
    defaultFillColor,
    project,
    activePageId,
    onCommitEdit,
    onRemoveFromCanvas,
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
    onCopySelection,
    onCreateQuickInteraction,
    onUpdateQuickInteraction,
    onDeleteQuickInteraction,
    onOpenInteractionInNodeGraph,
    onImportFontFiles,
    studioActions,
  } = panel;

  const [openSections, setOpenSections] = useState<Record<InspectorAccordionSectionId, boolean>>(
    () => getDefaultInspectorOpenSections(selectedNode.type),
  );
  const [activeState, setActiveState] = useState<InteractiveStateId>('default');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setActiveState('default');
  }, [selectedNode.id]);

  useEffect(() => {
    setOpenSections(getDefaultInspectorOpenSections(selectedNode.type));
  }, [selectedNode.type]);

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

  const visibleSectionIds: InspectorAccordionSectionId[] = [
    'size-position',
    'appearance',
    ...(isTextNode ? (['text'] as const) : []),
    'layout-frame',
    'modern-effects',
    'responsive-semantic',
    ...(isComponentLogicVisible ? (['component-logic'] as const) : []),
  ];

  const openCount = visibleSectionIds.filter((id) => openSections[id]).length;
  const allExpanded = openCount === visibleSectionIds.length;

  const toggleSection = (id: string) => {
    const typedId = id as InspectorAccordionSectionId;
    setOpenSections((prev) => ({ ...prev, [typedId]: !prev[typedId] }));
  };

  const setAllSectionsOpen = (nextOpen: boolean) => {
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
  const isPseudoState = activeState !== 'default';
  const layoutBadge = resolveInspectorLayoutBadge(selectedNode, parentNode);
  const inspectorContextEntries = buildInspectorContextEntries({
    selectedNode,
    canRemoveFromCanvas,
    allExpanded,
    openCount,
    onDuplicateSelection,
    onCopySelection,
    onUpdateSelected,
    onCommitEdit,
    onSetAllSectionsOpen: setAllSectionsOpen,
    onRemoveFromCanvas,
  });

  return (
    <div
      class={`inspector-content inspector-zero-typing${isPseudoState ? ' is-state-editing' : ''}`}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.matches('input, select')) return;
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <InspectorAccordionToolbar
        allExpanded={allExpanded}
        openCount={openCount}
        totalCount={visibleSectionIds.length}
        onToggleAll={() => setAllSectionsOpen(!allExpanded)}
      />

      {/* SECTION 1 — HEADER IDENTITY & COMPACT QUICK ACTIONS */}
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
      </section>

      {/* SECTION 2 — SIZE & POSITION */}
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

      {/* SECTION 3 — FILL, BORDER & RADIUS */}
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

      {/* SECTION 4 — TEXT & PARAGRAPH (TEXT NODES ONLY) */}
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
            projectAssets={project?.assets}
            onImportFontFiles={onImportFontFiles}
            onUpdateSelectedStyle={onUpdateSelectedStyle}
            onUpdateExtendedStyle={handleUpdateExtendedStyle}
            onCommitEdit={onCommitEdit}
          />
        </InspectorAccordionSection>
      )}

      {/* SECTION 5 — LAYOUT & FRAME */}
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

      <StudioContextMenu
        position={contextMenu}
        ariaLabel="Inspector actions"
        entries={inspectorContextEntries}
        testId="inspector-context-menu"
        onClose={() => setContextMenu(null)}
      />
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

import type { JSX } from 'preact';
import type { ComponentDefinition, DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { StudioVectorActions } from './inspectorVectorHelpers';
import {
  InspectorAlignDistributeSection,
  InspectorTransformActions,
} from './InspectorVectorStudioSection';

export interface InspectorMultiSelectionViewProps {
  activeEditorId: EditorTarget;
  selectedNodes: readonly DesignNode[];
  effectiveSelectedCount: number;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
  onConvertToPath: (target: EditorTarget) => void;
  onSimplifyPath: (target: EditorTarget) => void;
  studioActions?: StudioVectorActions;
}

export function InspectorMultiSelectionView({
  activeEditorId,
  selectedNodes,
  effectiveSelectedCount,
  onDuplicateSelection,
  onCopySelection,
  onConvertToPath,
  onSimplifyPath,
  studioActions,
}: InspectorMultiSelectionViewProps) {
  const hasConvertibleInMulti = selectedNodes.some(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  );
  const hasPathsInMulti = selectedNodes.some((node) => node.type === 'path');

  return (
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
              hasGroupSelected={selectedNodes.some((node) => node.type === 'group')}
            />
          </section>
        </>
      )}
    </div>
  );
}

export interface InspectorEmptyStateViewProps {
  activeEditorId: EditorTarget;
  editingMasterComponent: ComponentDefinition | null;
  renderIcon: (name: 'trash' | 'layers' | 'cursor') => JSX.Element;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  onQuickAdd: (type: 'rect' | 'text') => void;
  hasImageInsert: boolean;
  onTriggerImagePicker: () => void;
}

export function InspectorEmptyStateView({
  activeEditorId,
  editingMasterComponent,
  renderIcon,
  onToggleComponentNodeLogic,
  onQuickAdd,
  hasImageInsert,
  onTriggerImagePicker,
}: InspectorEmptyStateViewProps) {
  if (activeEditorId === 'component' && editingMasterComponent) {
    return (
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
            {hasImageInsert && (
              <button type="button" onClick={onTriggerImagePicker}>+ Image</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="inspector-empty">
      <div class="empty-icon">{renderIcon('cursor')}</div>
      <strong>Nothing selected</strong>
      <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
      <div class="quick-add">
        <button type="button" onClick={() => onQuickAdd('rect')}>+ Rectangle</button>
        <button type="button" onClick={() => onQuickAdd('text')}>+ Text</button>
        {hasImageInsert && (
          <button type="button" onClick={onTriggerImagePicker}>+ Image</button>
        )}
      </div>
    </div>
  );
}

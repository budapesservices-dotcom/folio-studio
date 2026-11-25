import type {
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DrawMaskMode,
  FolioProject,
} from '../../core/document/types';
import type { CanvasToolId } from '../../core/tools/operationContract';
import type { EditorTarget } from '../editorContext';
import type { StudioVectorActions } from './inspectorVectorHelpers';
import { InspectorComponentContractSection } from './InspectorComponentContractSection';
import { InspectorInteractionsSection } from './InspectorInteractionsSection';
import type {
  QuickInteractionConfig,
  QuickInteractionEntry,
  QuickInteractionScopeContext,
} from './quickInteractions';

export interface InspectorVectorMaskingControlProps {
  selectedNode: DesignNode;
  studioActions?: StudioVectorActions;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
}

export function InspectorVectorMaskingControl({
  selectedNode,
  studioActions,
  onUpdateSelected,
  onCommitEdit,
}: InspectorVectorMaskingControlProps) {
  const currentDrawMode: DrawMaskMode = selectedNode.drawMode ?? 'normal';
  const showPermanentSubtract =
    currentDrawMode === 'outside' || selectedNode.clipMaskMode === 'outside';

  return (
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
  );
}

export interface InspectorComponentLogicSectionProps {
  activeEditorId: EditorTarget;
  selectedNode: DesignNode;
  scopedNodes: readonly DesignNode[];
  selectedInstanceComponent: ComponentDefinition | null;
  editingMasterComponent: ComponentDefinition | null;
  project?: FolioProject;
  activePageId?: string;
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

export function InspectorComponentLogicSection({
  activeEditorId,
  selectedNode,
  scopedNodes,
  selectedInstanceComponent,
  editingMasterComponent,
  project,
  activePageId,
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
  onCreateQuickInteraction,
  onUpdateQuickInteraction,
  onDeleteQuickInteraction,
  onOpenInteractionInNodeGraph,
  studioActions,
}: InspectorComponentLogicSectionProps) {
  const isConvertibleVector =
    selectedNode.type === 'rect' || selectedNode.type === 'ellipse' || selectedNode.type === 'frame';
  const isPathNode = selectedNode.type === 'path';
  const targetLogicComponent =
    activeEditorId === 'component'
      ? editingMasterComponent
      : selectedInstanceComponent ?? editingMasterComponent;

  return (
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
  );
}

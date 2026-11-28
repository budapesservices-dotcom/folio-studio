import type { DesignNode } from '../../core/document/types';
import { isShapeContainerCapable, isShapeContainerNode } from '../../core/document/layers';

export interface InspectorObjectRoleSectionProps {
  selectedNode: DesignNode;
  directChildCount: number;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
  onUngroupSelection?: () => void;
  onPromoteSelectionToComponent?: () => void;
}

export function InspectorObjectRoleSection({
  selectedNode,
  directChildCount,
  onUpdateSelected,
  onCommitEdit,
  onUngroupSelection,
  onPromoteSelectionToComponent,
}: InspectorObjectRoleSectionProps) {
  const canBeShapeContainer = isShapeContainerCapable(selectedNode);
  const isShapeContainer = isShapeContainerNode(selectedNode);
  const isGroupNode = selectedNode.type === 'group';

  if (canBeShapeContainer && !isShapeContainer) {
    return (
      <div class="inspector-object-role-bar" data-testid="inspector-shape-role-bar">
        <button
          type="button"
          class="inspector-role-btn"
          data-testid="inspector-set-as-container-btn"
          title="Turn this shape into a Shape Container that holds child layers, optional clipping, and a stable interaction area"
          onClick={() => {
            onUpdateSelected({ isContainer: true, clipContent: false } as Partial<DesignNode>);
            onCommitEdit();
          }}
        >
          Set as Container
        </button>
      </div>
    );
  }

  if (isShapeContainer) {
    return (
      <div class="inspector-object-role-card" data-testid="inspector-shape-container-card">
        <div class="inspector-object-role-head">
          <span class="inspector-object-role-title">
            Shape Container · {directChildCount} {directChildCount === 1 ? 'child' : 'children'}
          </span>
          <button
            type="button"
            class="inspector-role-link"
            data-testid="inspector-release-container-btn"
            title="Convert back to regular shape without deleting child layers"
            onClick={() => {
              onUpdateSelected({ isContainer: false, clipContent: false } as Partial<DesignNode>);
              onCommitEdit();
            }}
          >
            Release
          </button>
        </div>
        <label class="inspector-role-checkbox">
          <input
            type="checkbox"
            data-testid="inspector-clip-contents-toggle"
            checked={Boolean(selectedNode.clipContent)}
            onChange={(event) => {
              const nextClip = event.currentTarget.checked;
              onUpdateSelected({
                clipContent: nextClip,
                ...(selectedNode.layout
                  ? { layout: { ...selectedNode.layout, overflow: nextClip ? 'hidden' : 'visible' } }
                  : {}),
              } as Partial<DesignNode>);
              onCommitEdit();
            }}
          />
          <span>
            Clip Contents to{' '}
            {selectedNode.type === 'path'
              ? 'Custom Path'
              : selectedNode.type === 'ellipse'
                ? 'Ellipse'
                : 'Shape'}
          </span>
        </label>
        {onPromoteSelectionToComponent && (
          <button
            type="button"
            class="inspector-role-btn is-accent"
            data-testid="inspector-promote-to-component-btn"
            title="Promote this Shape Container and its children into a reusable Component Master"
            onClick={onPromoteSelectionToComponent}
          >
            Promote to Component
          </button>
        )}
      </div>
    );
  }

  if (isGroupNode) {
    return (
      <div class="inspector-object-role-card" data-testid="inspector-group-role-card">
        <div class="inspector-object-role-head">
          <span class="inspector-object-role-title">
            Structural Group · {directChildCount} {directChildCount === 1 ? 'layer' : 'layers'}
          </span>
          {onUngroupSelection && (
            <button
              type="button"
              class="inspector-role-link"
              data-testid="inspector-ungroup-btn"
              onClick={onUngroupSelection}
            >
              Ungroup
            </button>
          )}
        </div>
        <p class="inspector-object-role-note">
          Groups organize layers. Promote to a Component for Variants, Slots, and reusable Component Logic.
        </p>
        {onPromoteSelectionToComponent && (
          <button
            type="button"
            class="inspector-role-btn is-accent"
            data-testid="inspector-promote-to-component-btn"
            title="Promote this Group into a reusable Component Master while keeping its layers intact"
            onClick={onPromoteSelectionToComponent}
          >
            Promote to Component
          </button>
        )}
      </div>
    );
  }

  return null;
}

import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import type { AssetReference, ComponentDefinition, DesignTokenCollection } from '../../core/document/types';
import { ComponentThumbnail } from '../ComponentThumbnail';
import { StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';

export interface ComponentRackPanelProps {
  panelRef: RefObject<HTMLElement>;
  open: boolean;
  components: ComponentDefinition[];
  designTokens?: DesignTokenCollection;
  assets?: readonly AssetReference[];
  searchQuery: string;
  canSaveSelection: boolean;
  renamingComponentId: string | null;
  componentNameDraft: string;
  onSearchChange: (value: string) => void;
  onCreateNewMaster: () => void;
  onSaveSelection: () => void;
  onClose: () => void;
  onInsertComponent: (component: ComponentDefinition) => void;
  onEditMaster: (component: ComponentDefinition) => void;
  onStartRename: (component: ComponentDefinition) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (componentId: string) => void;
  onCancelRename: () => void;
  onDuplicateComponent: (component: ComponentDefinition) => void;
  onDeleteComponent: (component: ComponentDefinition) => void;
  onToggleNodeLogic?: (component: ComponentDefinition) => void;
}

export function ComponentRackPanel({
  panelRef,
  open,
  components,
  designTokens,
  assets,
  searchQuery,
  canSaveSelection,
  renamingComponentId,
  componentNameDraft,
  onSearchChange,
  onCreateNewMaster,
  onSaveSelection,
  onClose,
  onInsertComponent,
  onEditMaster,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onDuplicateComponent,
  onDeleteComponent,
  onToggleNodeLogic,
}: ComponentRackPanelProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    component: ComponentDefinition | null;
  } | null>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredComponents = normalizedQuery
    ? components.filter((component) => component.name.toLowerCase().includes(normalizedQuery))
    : components;

  return (
    <section
      ref={panelRef}
      class={`component-rack-panel ${open ? 'is-open' : ''}`}
      aria-label="Component Rack"
      aria-hidden={!open}
      inert={!open}
    >
      <div class="component-rack-heading">
        <div class="component-rack-title">
          <span class="panel-kicker">YOUR LIBRARY</span>
          <strong>Component Rack</strong>
          <span class="component-rack-count">{components.length}</span>
        </div>
        <div class="component-rack-actions">
          <div class="component-rack-search-wrap">
            <input
              class="component-rack-search"
              type="search"
              placeholder="Search components..."
              aria-label="Search components"
              value={searchQuery}
              onInput={(event) => onSearchChange(event.currentTarget.value)}
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                class="component-rack-search-clear"
                title="Clear search"
                aria-label="Clear component search"
                onClick={() => onSearchChange('')}
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            class="component-rack-save"
            onClick={onCreateNewMaster}
            title="Create a new master component"
          >
            ＋ New component
          </button>
          <button
            type="button"
            class="component-rack-save"
            disabled={!canSaveSelection}
            onClick={onSaveSelection}
            title="Save selected layers as a reusable component"
          >
            Save selection
          </button>
          <button
            type="button"
            class="component-rack-close"
            title="Close Component Rack"
            aria-label="Close Component Rack"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div
        class="component-rack-list"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('.component-rack-card') || target?.closest('input')) return;
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, component: null });
        }}
      >
        {filteredComponents.map((component) => (
          <article
            class="component-rack-card"
            key={component.id}
            onContextMenu={(event) => {
              if ((event.target as HTMLElement | null)?.closest('input')) return;
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY, component });
            }}
          >
            <button
              type="button"
              class="component-rack-preview"
              title={`Insert linked ${component.name} into Main Canvas`}
              onClick={() => onInsertComponent(component)}
            >
              <ComponentThumbnail component={component} components={components} designTokens={designTokens} assets={assets} />
              <span class="component-rack-card-name">{component.name}</span>
              <span class="component-rack-card-meta">
                {component.document.nodes.length} layer{component.document.nodes.length === 1 ? '' : 's'}
                {(component.variants?.length ?? 0) > 0 ? ` · ${component.variants!.length} var` : ''}
                {(component.slots?.length ?? 0) > 0 ? ` · ${component.slots!.length} slot` : ''}
                {component.nodeLogicEnabled ? ' · In Node Logic' : ''}
              </span>
            </button>
            <div class="component-rack-card-actions">
              {onToggleNodeLogic && (
                <button
                  type="button"
                  class={`component-rack-node-toggle ${component.nodeLogicEnabled ? 'is-enabled' : ''}`}
                  aria-pressed={Boolean(component.nodeLogicEnabled)}
                  title={
                    component.nodeLogicEnabled
                      ? `Disable "${component.name}" in Node Logic`
                      : `Send "${component.name}" to Node Logic`
                  }
                  onClick={() => onToggleNodeLogic(component)}
                >
                  {component.nodeLogicEnabled ? '✓ In Node' : 'Send to Node'}
                </button>
              )}
              <button type="button" title={`Edit ${component.name} master`} onClick={() => onEditMaster(component)}>
                Edit Master
              </button>
              {renamingComponentId === component.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onCommitRename(component.id);
                  }}
                >
                  <input
                    aria-label={`Rename ${component.name}`}
                    value={componentNameDraft}
                    onInput={(event) => onRenameDraftChange(event.currentTarget.value)}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={onCancelRename}>Cancel</button>
                </form>
              ) : (
                <button type="button" title={`Rename ${component.name}`} onClick={() => onStartRename(component)}>
                  Rename
                </button>
              )}
              <button type="button" title={`Duplicate ${component.name}`} onClick={() => onDuplicateComponent(component)}>
                Duplicate
              </button>
              <button
                type="button"
                class="component-rack-delete"
                title={`Delete ${component.name}`}
                aria-label={`Delete ${component.name}`}
                onClick={() => onDeleteComponent(component)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
        {components.length === 0 && (
          <div class="component-rack-empty">
            <StudioIcon name="rack" />
            <strong>Your component library is empty</strong>
            <span>Select layers on the canvas and choose “Save selection” to keep reusable components here.</span>
          </div>
        )}
        {components.length > 0 && filteredComponents.length === 0 && (
          <div class="component-rack-empty">
            <span>No components match “{searchQuery}”.</span>
          </div>
        )}
      </div>
      {contextMenu && (
        <StudioContextMenu
          open={true}
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={contextMenu.component ? `Actions for ${contextMenu.component.name}` : 'Component Rack actions'}
          testId="component-rack-context-menu"
          onClose={() => setContextMenu(null)}
          items={(() => {
            const comp = contextMenu.component;
            if (!comp) {
              const items: StudioContextMenuItem[] = [
                { kind: 'header', id: 'hdr', label: 'Component Library', meta: `${components.length}` },
                { kind: 'item', id: 'new-master', label: 'New Master Component', accent: true, onSelect: onCreateNewMaster },
                {
                  kind: 'item',
                  id: 'save-sel',
                  label: 'Save Selection as Component',
                  disabled: !canSaveSelection,
                  onSelect: onSaveSelection,
                },
              ];
              return items;
            }
            const items: StudioContextMenuItem[] = [
              { kind: 'header', id: 'hdr', label: comp.name, meta: `${comp.document.nodes.length} layers` },
              { kind: 'item', id: 'insert', label: 'Insert Linked Instance', accent: true, onSelect: () => onInsertComponent(comp) },
              { kind: 'item', id: 'edit', label: 'Edit Master', onSelect: () => onEditMaster(comp) },
              { kind: 'divider', id: 'div-1' },
              { kind: 'item', id: 'rename', label: 'Rename', onSelect: () => onStartRename(comp) },
              { kind: 'item', id: 'duplicate', label: 'Duplicate Component', onSelect: () => onDuplicateComponent(comp) },
            ];
            if (onToggleNodeLogic) {
              items.push({
                kind: 'item',
                id: 'toggle-node',
                label: comp.nodeLogicEnabled ? 'Disable in Node Logic' : 'Send to Node Logic',
                active: Boolean(comp.nodeLogicEnabled),
                onSelect: () => onToggleNodeLogic(comp),
              });
            }
            items.push({ kind: 'divider', id: 'div-del' });
            items.push({
              kind: 'item',
              id: 'delete',
              label: 'Delete Component',
              danger: true,
              onSelect: () => onDeleteComponent(comp),
            });
            return items;
          })()}
        />
      )}
    </section>
  );
}

import type { RefObject } from 'preact';
import type { AssetReference, ComponentDefinition, DesignTokenCollection } from '../../core/document/types';
import { ComponentThumbnail } from '../ComponentThumbnail';
import { StudioIcon } from './StudioIcon';

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
}: ComponentRackPanelProps) {
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
      <div class="component-rack-list">
        {filteredComponents.map((component) => (
          <article class="component-rack-card" key={component.id}>
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
              </span>
            </button>
            <div class="component-rack-card-actions">
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
    </section>
  );
}

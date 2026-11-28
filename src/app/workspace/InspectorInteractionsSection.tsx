import { useEffect, useMemo, useState } from 'preact/hooks';
import type {
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
} from '../../core/document/types';
import {
  adaptQuickInteractionConfigForActionKind,
  createDefaultQuickInteractionConfig,
  extractLayerInteractions,
  getVariantTargetCandidates,
  validateQuickInteractionConfig,
  type QuickInteractionActionKind,
  type QuickInteractionConfig,
  type QuickInteractionEntry,
  type QuickInteractionLayerProperty,
  type QuickInteractionNavigateMode,
  type QuickInteractionScopeContext,
  type QuickInteractionToastTone,
  type QuickInteractionTrigger,
  type QuickInteractionVisibilityMode,
} from './quickInteractions';

export interface InspectorInteractionsSectionProps {
  project: FolioProject;
  activeEditorId: 'main' | 'component';
  activePageId: string;
  editingMasterComponent: ComponentDefinition | null;
  selectedNode: DesignNode;
  scopedNodes: readonly DesignNode[];
  onCreateQuickInteraction: (
    scopeContext: QuickInteractionScopeContext,
    config: QuickInteractionConfig,
  ) => { entryId: string } | null;
  onUpdateQuickInteraction: (
    entry: QuickInteractionEntry,
    layerId: string,
    nextConfig: QuickInteractionConfig,
  ) => void;
  onDeleteQuickInteraction: (entry: QuickInteractionEntry) => void;
  onOpenInteractionInNodeGraph: (graphId: string, nodeIds: readonly string[]) => void;
}

const TRIGGER_OPTIONS: readonly { value: QuickInteractionTrigger; label: string }[] = [
  { value: 'on-click', label: 'On Click' },
  { value: 'on-hover', label: 'On Hover' },
  { value: 'on-submit', label: 'On Submit (Form)' },
];

const ACTION_OPTIONS: readonly { value: QuickInteractionActionKind; label: string }[] = [
  { value: 'visibility', label: 'Show / Hide / Toggle Visibility' },
  { value: 'navigate', label: 'Navigate' },
  { value: 'set-variant', label: 'Set Variant' },
  { value: 'set-layer-property', label: 'Set Layer Property' },
  { value: 'show-toast', label: 'Show Toast' },
];

const VISIBILITY_MODES: readonly { value: QuickInteractionVisibilityMode; label: string }[] = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
];

const LAYER_PROPERTY_OPTIONS: readonly { value: QuickInteractionLayerProperty; label: string }[] = [
  { value: 'fill', label: 'Fill Color' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'text', label: 'Text Content' },
  { value: 'transform', label: 'Transform' },
  { value: 'disabled', label: 'Disabled State' },
];

const NAV_MODE_OPTIONS: readonly { value: QuickInteractionNavigateMode; label: string }[] = [
  { value: 'internal', label: 'Page Route' },
  { value: 'external', label: 'External URL' },
  { value: 'scroll-to', label: 'Scroll to Layer' },
  { value: 'back', label: 'Browser Back' },
];

const TOAST_TONE_OPTIONS: readonly { value: QuickInteractionToastTone; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

interface InteractionFieldsProps {
  config: QuickInteractionConfig;
  selectedNodeId: string;
  scopedNodes: readonly DesignNode[];
  pages: readonly FolioPage[];
  activePageId: string;
  components: readonly ComponentDefinition[];
  ownerComponent?: ComponentDefinition | null;
  idPrefix: string;
  onChange: (next: QuickInteractionConfig) => void;
}

function InteractionConfigFields({
  config,
  selectedNodeId,
  scopedNodes,
  pages,
  activePageId,
  components,
  ownerComponent = null,
  idPrefix,
  onChange,
}: InteractionFieldsProps) {
  const variantCandidates = useMemo(
    () => getVariantTargetCandidates(scopedNodes, components, ownerComponent),
    [scopedNodes, components, ownerComponent],
  );
  const activeVariantCandidate = useMemo(
    () => variantCandidates.find((c) => c.id === config.targetNodeId) ?? null,
    [variantCandidates, config.targetNodeId],
  );
  const activeVariantAxes = useMemo(
    () => (activeVariantCandidate?.component.variants ?? []).filter((a) => a.options.length > 0),
    [activeVariantCandidate],
  );
  const activeVariantAxis = useMemo(
    () => activeVariantAxes.find((a) => a.id === config.axisId) ?? activeVariantAxes[0] ?? null,
    [activeVariantAxes, config.axisId],
  );

  const fillableNodes = useMemo(
    () => scopedNodes.filter((n) => n.type !== 'group' && n.type !== 'component-instance'),
    [scopedNodes],
  );

  const layerOptionsForAction =
    config.actionKind === 'set-layer-property' && config.layerProperty === 'fill'
      ? fillableNodes
      : scopedNodes;

  return (
    <div class="quick-interaction-fields">
      <label class="field-label" htmlFor={`${idPrefix}-trigger`}>
        Trigger
        <select
          id={`${idPrefix}-trigger`}
          class="select-field"
          aria-label="Interaction trigger"
          value={config.trigger}
          onChange={(event) => {
            const trigger = event.currentTarget.value as QuickInteractionTrigger;
            onChange({ ...config, trigger });
          }}
        >
          {TRIGGER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {config.trigger === 'on-hover' && (
        <div class="field-label">
          Hover Phase
          <div class="style-segmented-row" role="group" aria-label="Hover phase">
            {([
              { value: 'enter', label: 'Enter' },
              { value: 'leave', label: 'Leave' },
            ] as const).map((phase) => (
              <button
                key={phase.value}
                type="button"
                class={`style-seg-btn${config.hoverPhase === phase.value ? ' is-active' : ''}`}
                aria-pressed={config.hoverPhase === phase.value}
                onClick={() => onChange({ ...config, hoverPhase: phase.value })}
              >
                {phase.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label class="field-label" htmlFor={`${idPrefix}-action`}>
        Action
        <select
          id={`${idPrefix}-action`}
          class="select-field"
          aria-label="Interaction action"
          value={config.actionKind}
          onChange={(event) => {
            const nextKind = event.currentTarget.value as QuickInteractionActionKind;
            onChange(
              adaptQuickInteractionConfigForActionKind(config, nextKind, {
                layerId: selectedNodeId,
                scopedNodes,
                pages,
                activePageId,
                components,
                ownerComponent,
              }),
            );
          }}
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {config.actionKind === 'visibility' && (
        <>
          <label class="field-label" htmlFor={`${idPrefix}-vis-target`}>
            Target Layer
            <select
              id={`${idPrefix}-vis-target`}
              class="select-field"
              aria-label="Target layer"
              value={config.targetNodeId}
              onChange={(event) => onChange({ ...config, targetNodeId: event.currentTarget.value })}
            >
              {scopedNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                  {node.id === selectedNodeId ? ' (this layer)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div class="field-label">
            Visibility Mode
            <div class="style-segmented-row" role="group" aria-label="Visibility mode">
              {VISIBILITY_MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  class={`style-seg-btn${config.visibleMode === item.value ? ' is-active' : ''}`}
                  aria-pressed={config.visibleMode === item.value}
                  onClick={() => onChange({ ...config, visibleMode: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {config.actionKind === 'navigate' && (
        <>
          <label class="field-label" htmlFor={`${idPrefix}-nav-mode`}>
            Destination Type
            <select
              id={`${idPrefix}-nav-mode`}
              class="select-field"
              aria-label="Navigation mode"
              value={config.navMode}
              onChange={(event) => {
                const navMode = event.currentTarget.value as QuickInteractionNavigateMode;
                let nextRoute = config.route;
                let nextTarget = config.targetNodeId;
                if (navMode === 'internal' && !pages.some((p) => p.route === nextRoute)) {
                  nextRoute = pages.find((p) => p.id !== activePageId)?.route ?? pages[0]?.route ?? '/';
                } else if (navMode === 'external' && (!nextRoute || nextRoute.startsWith('/'))) {
                  nextRoute = 'https://';
                } else if (navMode === 'scroll-to' && !scopedNodes.some((n) => n.id === nextTarget)) {
                  nextTarget = scopedNodes[0]?.id ?? '';
                }
                onChange({ ...config, navMode, route: nextRoute, targetNodeId: nextTarget });
              }}
            >
              {NAV_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {config.navMode === 'internal' && (
            <label class="field-label" htmlFor={`${idPrefix}-nav-page`}>
              Target Page
              <select
                id={`${idPrefix}-nav-page`}
                class="select-field"
                aria-label="Target page"
                value={config.route}
                onChange={(event) => onChange({ ...config, route: event.currentTarget.value })}
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.route}>
                    {page.name} ({page.route})
                  </option>
                ))}
                {!pages.some((page) => page.route === config.route) && config.route && (
                  <option value={config.route}>{config.route}</option>
                )}
              </select>
            </label>
          )}

          {config.navMode === 'external' && (
            <label class="field-label" htmlFor={`${idPrefix}-nav-url`}>
              URL
              <input
                id={`${idPrefix}-nav-url`}
                class="text-field"
                type="text"
                aria-label="Target URL"
                placeholder="https://example.com"
                value={config.route}
                onInput={(event) => onChange({ ...config, route: event.currentTarget.value })}
              />
            </label>
          )}

          {config.navMode === 'scroll-to' && (
            <label class="field-label" htmlFor={`${idPrefix}-nav-scroll-target`}>
              Scroll Target Layer
              <select
                id={`${idPrefix}-nav-scroll-target`}
                class="select-field"
                aria-label="Scroll target layer"
                value={config.targetNodeId}
                onChange={(event) => onChange({ ...config, targetNodeId: event.currentTarget.value })}
              >
                {scopedNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {config.actionKind === 'set-variant' && (
        <>
          {variantCandidates.length === 0 ? (
            <div class="quick-interaction-hint" role="note">
              No component instances with variants exist on this canvas yet. Create a component with variants first.
            </div>
          ) : (
            <>
              <label class="field-label" htmlFor={`${idPrefix}-var-target`}>
                Component Instance
                <select
                  id={`${idPrefix}-var-target`}
                  class="select-field"
                  aria-label="Variant target instance"
                  value={config.targetNodeId}
                  onChange={(event) => {
                    const nextTargetId = event.currentTarget.value;
                    const candidate = variantCandidates.find((c) => c.id === nextTargetId);
                    const firstAxis = candidate?.component.variants?.find((a) => a.options.length > 0);
                    onChange({
                      ...config,
                      targetNodeId: nextTargetId,
                      axisId: firstAxis?.id ?? '',
                      optionId: firstAxis?.options[0]?.id ?? '',
                    });
                  }}
                >
                  {variantCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>

              {activeVariantAxes.length > 0 && (
                <div class="field-grid single-row">
                  <label class="field-label" htmlFor={`${idPrefix}-var-axis`}>
                    Variant Axis
                    <select
                      id={`${idPrefix}-var-axis`}
                      class="select-field"
                      aria-label="Variant axis"
                      value={activeVariantAxis?.id ?? ''}
                      onChange={(event) => {
                        const axisId = event.currentTarget.value;
                        const axis = activeVariantAxes.find((a) => a.id === axisId);
                        onChange({
                          ...config,
                          axisId,
                          optionId: axis?.options[0]?.id ?? '',
                        });
                      }}
                    >
                      {activeVariantAxes.map((axis) => (
                        <option key={axis.id} value={axis.id}>
                          {axis.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label class="field-label" htmlFor={`${idPrefix}-var-opt`}>
                    Option
                    <select
                      id={`${idPrefix}-var-opt`}
                      class="select-field"
                      aria-label="Variant option"
                      value={config.optionId}
                      onChange={(event) => onChange({ ...config, optionId: event.currentTarget.value })}
                    >
                      {(activeVariantAxis?.options ?? []).map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
        </>
      )}

      {config.actionKind === 'set-layer-property' && (
        <>
          <label class="field-label" htmlFor={`${idPrefix}-prop-target`}>
            Target Layer
            <select
              id={`${idPrefix}-prop-target`}
              class="select-field"
              aria-label="Target layer"
              value={config.targetNodeId}
              onChange={(event) => onChange({ ...config, targetNodeId: event.currentTarget.value })}
            >
              {layerOptionsForAction.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                  {node.id === selectedNodeId ? ' (this layer)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label class="field-label" htmlFor={`${idPrefix}-prop-name`}>
            Property
            <select
              id={`${idPrefix}-prop-name`}
              class="select-field"
              aria-label="Layer property"
              value={config.layerProperty}
              onChange={(event) => {
                const layerProperty = event.currentTarget.value as QuickInteractionLayerProperty;
                let nextTarget = config.targetNodeId;
                if (layerProperty === 'fill') {
                  const target = scopedNodes.find((n) => n.id === nextTarget);
                  if (target && (target.type === 'group' || target.type === 'component-instance')) {
                    nextTarget = fillableNodes[0]?.id ?? nextTarget;
                  }
                }
                onChange({ ...config, layerProperty, targetNodeId: nextTarget });
              }}
            >
              {LAYER_PROPERTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {config.layerProperty === 'fill' && (
            <label class="field-label" htmlFor={`${idPrefix}-prop-fill`}>
              Fill Color
              <div class="quick-interaction-color-row">
                <input
                  type="color"
                  class="contract-mini-swatch"
                  aria-label="Pick fill color"
                  value={/^#[0-9a-f]{6}$/i.test(config.fill) ? config.fill : '#2dd4bf'}
                  onInput={(event) => onChange({ ...config, fill: event.currentTarget.value })}
                />
                <input
                  id={`${idPrefix}-prop-fill`}
                  class="text-field"
                  type="text"
                  aria-label="Fill color hex"
                  value={config.fill}
                  onInput={(event) => onChange({ ...config, fill: event.currentTarget.value })}
                />
              </div>
            </label>
          )}

          {config.layerProperty === 'opacity' && (
            <label class="field-label range-label" htmlFor={`${idPrefix}-prop-opacity`}>
              <span>Opacity ({Math.round(config.opacity * 100)}%)</span>
              <input
                id={`${idPrefix}-prop-opacity`}
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label="Target opacity percentage"
                value={Math.round(config.opacity * 100)}
                onInput={(event) => {
                  const pct = Number(event.currentTarget.value);
                  onChange({ ...config, opacity: Math.max(0, Math.min(1, pct / 100)) });
                }}
              />
            </label>
          )}

          {config.layerProperty === 'text' && (
            <label class="field-label" htmlFor={`${idPrefix}-prop-text`}>
              Text Value
              <input
                id={`${idPrefix}-prop-text`}
                class="text-field"
                type="text"
                aria-label="Target text value"
                placeholder="Updated text"
                value={config.text}
                onInput={(event) => onChange({ ...config, text: event.currentTarget.value })}
              />
            </label>
          )}

          {config.layerProperty === 'transform' && (
            <label class="field-label" htmlFor={`${idPrefix}-prop-transform`}>
              CSS Transform
              <input
                id={`${idPrefix}-prop-transform`}
                class="text-field"
                type="text"
                aria-label="CSS transform value"
                placeholder="scale(1.05)"
                value={config.transform}
                onInput={(event) => onChange({ ...config, transform: event.currentTarget.value })}
              />
            </label>
          )}

          {config.layerProperty === 'disabled' && (
            <label class="toggle-row">
              <span>Disabled</span>
              <input
                type="checkbox"
                checked={config.disabled}
                onChange={(event) => onChange({ ...config, disabled: event.currentTarget.checked })}
              />
            </label>
          )}
        </>
      )}

      {config.actionKind === 'show-toast' && (
        <>
          <label class="field-label" htmlFor={`${idPrefix}-toast-msg`}>
            Toast Message
            <input
              id={`${idPrefix}-toast-msg`}
              class="text-field"
              type="text"
              aria-label="Toast message"
              placeholder="Saved changes"
              value={config.toastMessage}
              onInput={(event) => onChange({ ...config, toastMessage: event.currentTarget.value })}
            />
          </label>
          <label class="field-label" htmlFor={`${idPrefix}-toast-tone`}>
            Tone
            <select
              id={`${idPrefix}-toast-tone`}
              class="select-field"
              aria-label="Toast tone"
              value={config.toastTone}
              onChange={(event) =>
                onChange({ ...config, toastTone: event.currentTarget.value as QuickInteractionToastTone })
              }
            >
              {TOAST_TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export function InspectorInteractionsSection({
  project,
  activeEditorId,
  activePageId,
  editingMasterComponent,
  selectedNode,
  scopedNodes,
  onCreateQuickInteraction,
  onUpdateQuickInteraction,
  onDeleteQuickInteraction,
  onOpenInteractionInNodeGraph,
}: InspectorInteractionsSectionProps) {
  const scope: 'page' | 'component' =
    activeEditorId === 'component' && editingMasterComponent ? 'component' : 'page';
  const activePage = useMemo(
    () => project.pages.find((page) => page.id === activePageId) ?? project.pages[0],
    [project.pages, activePageId],
  );
  const scopeTargetId =
    scope === 'component' && editingMasterComponent
      ? editingMasterComponent.id
      : (activePage?.id ?? activePageId);
  const scopeName =
    scope === 'component' && editingMasterComponent
      ? editingMasterComponent.name
      : (activePage?.name ?? 'Page');

  const entries = useMemo(
    () => extractLayerInteractions(project, scope, scopeTargetId, selectedNode.id, scopedNodes),
    [project, scope, scopeTargetId, selectedNode.id, scopedNodes],
  );

  const ownerComponent = scope === 'component' ? editingMasterComponent : null;

  const [composerOpen, setComposerOpen] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<QuickInteractionConfig>(() =>
    createDefaultQuickInteractionConfig({
      selectedNode,
      scopedNodes,
      pages: project.pages,
      activePageId,
      components: project.components,
      ownerComponent,
    }),
  );

  // Reset composer cleanly when switching selected layer
  useEffect(() => {
    setComposerOpen(false);
    setExpandedEntryId(null);
  }, [selectedNode.id, scopeTargetId]);

  const draftError = useMemo(
    () =>
      validateQuickInteractionConfig(draftConfig, {
        scopedNodes,
        components: project.components,
        ownerComponent,
      }),
    [draftConfig, scopedNodes, project.components, ownerComponent],
  );

  const handleOpenComposer = () => {
    setDraftConfig(
      createDefaultQuickInteractionConfig({
        selectedNode,
        scopedNodes,
        pages: project.pages,
        activePageId,
        components: project.components,
        ownerComponent,
      }),
    );
    setComposerOpen(true);
    setExpandedEntryId(null);
  };

  const handleCreate = () => {
    if (draftError) return;
    const created = onCreateQuickInteraction(
      {
        scope,
        scopeTargetId,
        scopeName,
        layerId: selectedNode.id,
      },
      draftConfig,
    );
    if (created) {
      setComposerOpen(false);
      setExpandedEntryId(null);
    }
  };

  return (
    <section class="property-section interactions-section" aria-label="Interactions">
      <div class="section-title-row">
        <div class="interactions-title-group">
          <span class="section-title">Interactions</span>
          {entries.length > 0 && (
            <span class="interactions-count-badge" title={`${entries.length} interaction(s) on this layer`}>
              {entries.length}
            </span>
          )}
        </div>
        <button
          type="button"
          class="interactions-add-btn"
          aria-expanded={composerOpen}
          onClick={() => (composerOpen ? setComposerOpen(false) : handleOpenComposer())}
        >
          {composerOpen ? 'Cancel' : '+ Add Interaction'}
        </button>
      </div>

      {composerOpen && (
        <div class="interactions-composer" data-testid="quick-interaction-composer">
          <div class="interactions-composer-header">
            <span class="contract-card-title">New Quick Interaction</span>
            <span class="contract-card-meta">2 nodes · 1 wire</span>
          </div>

          <InteractionConfigFields
            config={draftConfig}
            selectedNodeId={selectedNode.id}
            scopedNodes={scopedNodes}
            pages={project.pages}
            activePageId={activePageId}
            components={project.components}
            ownerComponent={ownerComponent}
            idPrefix="qi-new"
            onChange={setDraftConfig}
          />

          {draftError && (
            <div class="quick-interaction-error" role="alert">
              {draftError}
            </div>
          )}

          <div class="interactions-composer-actions">
            <button
              type="button"
              class="interactions-primary-btn"
              disabled={Boolean(draftError)}
              onClick={handleCreate}
            >
              Add Interaction
            </button>
            <button
              type="button"
              class="inspector-inline-chip"
              onClick={() => setComposerOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !composerOpen ? (
        <p class="interactions-empty-hint">
          Add click, hover, or submit behaviors—auto-generates a clean 2-node Logic Graph.
        </p>
      ) : (
        <div class="interactions-list">
          {entries.map((entry) => {
            const isExpanded = entry.editable && expandedEntryId === entry.id;
            const entryError =
              entry.editable && entry.config
                ? validateQuickInteractionConfig(entry.config, {
                    scopedNodes,
                    components: project.components,
                    ownerComponent,
                  })
                : null;

            return (
              <div
                key={entry.id}
                class={`interaction-card${entry.editable ? '' : ' is-custom-flow'}${isExpanded ? ' is-expanded' : ''}`}
                data-testid={entry.editable ? 'quick-interaction-card' : 'custom-interaction-card'}
              >
                <div class="interaction-card-header">
                  {entry.editable ? (
                    <button
                      type="button"
                      class="interaction-card-toggle"
                      aria-expanded={isExpanded}
                      title={isExpanded ? 'Collapse interaction editor' : 'Click to edit interaction'}
                      onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                    >
                      <span class="interaction-card-topline">
                        <span class="interaction-trigger-tag">{entry.triggerLabel}</span>
                        <span class="interaction-edit-cue">{isExpanded ? 'Done ▴' : 'Edit ▾'}</span>
                      </span>
                      <span class="interaction-summary-text">{entry.actionSummary}</span>
                    </button>
                  ) : (
                    <div class="interaction-card-readonly">
                      <span class="interaction-trigger-tag is-custom">{entry.triggerLabel}</span>
                      <span class="interaction-summary-text">{entry.actionSummary}</span>
                    </div>
                  )}

                  {entry.editable && (
                    <button
                      type="button"
                      class="contract-remove-btn"
                      title="Remove interaction"
                      aria-label={`Remove ${entry.triggerLabel} ${entry.actionSummary}`}
                      onClick={() => {
                        if (expandedEntryId === entry.id) setExpandedEntryId(null);
                        onDeleteQuickInteraction(entry);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>

                {isExpanded && entry.config && (
                  <div class="interaction-card-body">
                    <InteractionConfigFields
                      config={entry.config}
                      selectedNodeId={selectedNode.id}
                      scopedNodes={scopedNodes}
                      pages={project.pages}
                      activePageId={activePageId}
                      components={project.components}
                      ownerComponent={ownerComponent}
                      idPrefix={`qi-${entry.triggerNodeId}`}
                      onChange={(nextConfig) => {
                        onUpdateQuickInteraction(entry, selectedNode.id, nextConfig);
                      }}
                    />
                    {entryError && (
                      <div class="quick-interaction-error" role="alert">
                        {entryError}
                      </div>
                    )}
                  </div>
                )}

                <div class="interaction-card-footer">
                  <span class="interaction-graph-meta" title={entry.graphName}>
                    {entry.editable ? '2 nodes · 1 wire' : `${entry.graphName}`}
                  </span>
                  <button
                    type="button"
                    class="interaction-open-graph-btn"
                    title="Open and focus these nodes in Node Graph"
                    onClick={() => onOpenInteractionInNodeGraph(entry.graphId, entry.focusNodeIds)}
                  >
                    Open in Node Graph
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

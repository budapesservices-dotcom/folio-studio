import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  STUDIO_TEMPLATE_CATALOG,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CATEGORY_META,
  buildTemplatePreviewDocument,
  countMatchingTemplatesByCategory,
  filterStudioTemplates,
  getTemplateLogicNodeCount,
  groupTemplatesByCategory,
  splitHighlightSegments,
  tokenizeTemplateSearch,
  type StudioTemplateDefinition,
  type TemplateCategory,
  type TemplateInsertMode,
  type TemplateWorkspaceScope,
} from '../core/document/templates';
import { DocumentArtworkContent, sanitizeMaskIdSegment } from '../engines/canvas/artwork';

type FilterTab = 'all' | TemplateCategory;

const FILTER_TABS: ReadonlyArray<{ id: FilterTab; label: string; ariaLabel: string }> = [
  { id: 'all', label: 'All', ariaLabel: 'All templates' },
  ...TEMPLATE_CATEGORY_META.map((meta) => ({
    id: meta.id,
    label: meta.shortLabel,
    ariaLabel: meta.label,
  })),
];

interface PreparedTemplatePreview {
  readonly template: StudioTemplateDefinition;
  readonly previewDocument: ReturnType<typeof buildTemplatePreviewDocument>;
  readonly layerCount: number;
  readonly logicNodeCount: number;
  readonly viewBox: string;
  readonly maskPrefix: string;
}

const PREPARED_TEMPLATE_PREVIEWS: readonly PreparedTemplatePreview[] = STUDIO_TEMPLATE_CATALOG.map((template) => {
  const previewDocument = buildTemplatePreviewDocument(template);
  const logicNodeCount = getTemplateLogicNodeCount(template);
  const padX = Math.max(8, Math.round(template.width * 0.06));
  const padY = Math.max(8, Math.round(template.height * 0.06));
  return {
    template,
    previewDocument,
    layerCount: previewDocument.nodes.length,
    logicNodeCount,
    viewBox: `${-padX} ${-padY} ${template.width + padX * 2} ${template.height + padY * 2}`,
    maskPrefix: `folio-tpl-mask-${sanitizeMaskIdSegment(template.id)}`,
  };
});

const PREPARED_BY_ID: ReadonlyMap<string, PreparedTemplatePreview> = new Map(
  PREPARED_TEMPLATE_PREVIEWS.map((entry) => [entry.template.id, entry]),
);

export interface TemplateLibraryPopoverProps {
  workspace: TemplateWorkspaceScope;
  insertMode: TemplateInsertMode;
  onInsertModeChange: (mode: TemplateInsertMode) => void;
  onInsertTemplate: (template: StudioTemplateDefinition, mode: TemplateInsertMode) => void;
  onHoverHint: (title: string, description: string, shortcuts?: string[]) => void;
  onClose: () => void;
}

export function TemplateLibraryPopover({
  workspace,
  insertMode,
  onInsertModeChange,
  onInsertTemplate,
  onHoverHint,
  onClose,
}: TemplateLibraryPopoverProps) {
  const isVectorStudio = workspace === 'component';
  const [activeCategory, setActiveCategory] = useState<FilterTab>(isVectorStudio ? 'vectors' : 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveCategory(isVectorStudio ? 'vectors' : 'all');
  }, [isVectorStudio]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const effectiveMode: TemplateInsertMode = isVectorStudio ? 'nodes' : insertMode;
  const searchTokens = useMemo(() => tokenizeTemplateSearch(searchQuery), [searchQuery]);
  const hasSearchQuery = searchTokens.length > 0;

  const categoryCounts = useMemo(
    () => countMatchingTemplatesByCategory(STUDIO_TEMPLATE_CATALOG, searchQuery),
    [searchQuery],
  );

  const filteredItems = useMemo(() => {
    const matched = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, searchQuery, activeCategory);
    const prepared: PreparedTemplatePreview[] = [];
    for (const template of matched) {
      const entry = PREPARED_BY_ID.get(template.id);
      if (entry) prepared.push(entry);
    }
    return prepared;
  }, [activeCategory, searchQuery]);

  const groupedItems = useMemo(
    () => (activeCategory === 'all' ? groupTemplatesByCategory(filteredItems) : []),
    [activeCategory, filteredItems],
  );

  const alternateMode: TemplateInsertMode = effectiveMode === 'nodes' ? 'component' : 'nodes';
  const totalInActiveScope = activeCategory === 'all'
    ? PREPARED_TEMPLATE_PREVIEWS.length
    : PREPARED_TEMPLATE_PREVIEWS.filter((entry) => entry.template.category === activeCategory).length;

  const renderTemplateCard = ({
    template,
    previewDocument,
    layerCount,
    logicNodeCount,
    viewBox,
    maskPrefix,
  }: PreparedTemplatePreview) => {
    const titleSegments = splitHighlightSegments(template.name, searchTokens);
    const isPageTemplate = template.category === 'pages' && !isVectorStudio;
    const primaryMode: TemplateInsertMode = isPageTemplate ? 'page' : effectiveMode;
    const altMode: TemplateInsertMode = isPageTemplate ? 'nodes' : alternateMode;
    const altLabel = isPageTemplate ? '+ Layers' : (altMode === 'component' ? '+ Comp' : '+ Nodes');
    const primaryActionText =
      primaryMode === 'page'
        ? 'as a new ready-to-use Page with wired Node Logic'
        : primaryMode === 'component'
          ? 'as Master Component + linked Instance'
          : 'as editable native layers';
    const metaShortcuts = logicNodeCount > 0
      ? [`${template.width}×${template.height}`, `${layerCount} LAYERS`, `${logicNodeCount} LOGIC`]
      : [`${template.width}×${template.height}`, `${layerCount} LAYERS`];

    return (
      <div
        class="template-card"
        role="listitem"
        key={template.id}
        data-template-id={template.id}
        data-template-category={template.category}
      >
        <button
          type="button"
          class="template-card-primary"
          title={`Insert ${template.name} (${primaryActionText})`}
          onClick={() => onInsertTemplate(template, primaryMode)}
          onMouseEnter={() => onHoverHint(
            template.name.toUpperCase(),
            `${template.summary} Click to insert ${primaryActionText}.`,
            metaShortcuts,
          )}
        >
          <span
            class={'template-card-preview ' + (template.previewSurface === 'light' ? 'is-light' : 'is-dark')}
            aria-hidden="true"
          >
            <svg
              class="template-card-svg"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
              role="presentation"
            >
              <DocumentArtworkContent
                document={previewDocument}
                components={[]}
                maskPrefix={maskPrefix}
              />
            </svg>
          </span>
          <span class="template-card-body">
            <span class="template-card-name">
              {titleSegments.map((segment, index) => (
                segment.match ? (
                  <mark key={index} class="template-search-match">{segment.text}</mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              ))}
            </span>
            <span class="template-card-meta">
              {template.width} × {template.height} · {layerCount} layers
              {logicNodeCount > 0 ? ` · ${logicNodeCount} logic` : ''}
            </span>
          </span>
        </button>
        {!isVectorStudio && (
          <button
            type="button"
            class="template-card-alt-action"
            title={
              isPageTemplate
                ? `Insert ${template.name} layers + logic onto the active page`
                : altMode === 'component'
                  ? `Insert ${template.name} as Master Component + Instance`
                  : `Insert ${template.name} as editable Nodes`
            }
            onClick={(event) => {
              event.stopPropagation();
              onInsertTemplate(template, altMode);
            }}
            onMouseEnter={() => onHoverHint(
              `${template.name.toUpperCase()} (${isPageTemplate ? 'LAYERS' : altMode === 'component' ? 'COMPONENT' : 'NODES'})`,
              isPageTemplate
                ? 'Inserts all layers and wired Node Logic directly into the currently active page.'
                : altMode === 'component'
                  ? 'Registers this template in Component Rack (with Node Logic) and places a linked Instance on Main Canvas.'
                  : 'Places this template directly as editable native layers with wired Node Logic.',
            )}
          >
            {altLabel}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      class={'tool-rack-menu template-library-popover' + (isVectorStudio ? ' is-vector-studio' : '')}
      role="dialog"
      aria-label="Template library"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (searchQuery.trim().length > 0) {
            setSearchQuery('');
            searchInputRef.current?.focus();
            return;
          }
          onClose();
        }
      }}
    >
      <div class="template-library-header">
        <div class="template-library-heading">
          <strong class="template-library-title">Template Library</strong>
          <span class="template-library-count" aria-live="polite" aria-atomic="true">
            {filteredItems.length} of {totalInActiveScope}
          </span>
        </div>
        {!isVectorStudio ? (
          <div class="template-mode-switch" role="group" aria-label="Insert mode">
            <button
              type="button"
              class={'template-mode-btn' + (effectiveMode === 'nodes' ? ' active' : '')}
              aria-pressed={effectiveMode === 'nodes'}
              title="Insert as editable native layers"
              onClick={() => onInsertModeChange('nodes')}
              onMouseEnter={() => onHoverHint('INSERT AS NODES', 'Places directly editable native layers onto the active page.')}
            >
              Nodes
            </button>
            <button
              type="button"
              class={'template-mode-btn' + (effectiveMode === 'component' ? ' active' : '')}
              aria-pressed={effectiveMode === 'component'}
              title="Register as Master Component and place a linked Instance"
              onClick={() => onInsertModeChange('component')}
              onMouseEnter={() => onHoverHint('INSERT AS COMPONENT', 'Creates a reusable Master Component in Component Rack and places a linked Instance in one Undo step.')}
            >
              Component
            </button>
          </div>
        ) : (
          <span
            class="template-library-workspace-note"
            title="Templates insert as editable vector layers into the active master component"
          >
            Editable layers
          </span>
        )}
      </div>

      <div class="template-library-controls">
        <div class="template-library-search-wrap">
          <svg
            class="template-library-search-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            type="search"
            class="template-library-search"
            placeholder="Filter UI, sections, pages, vectors..."
            aria-label="Search templates"
            autoComplete="off"
            spellcheck={false}
            value={searchQuery}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filteredItems.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                const first = filteredItems[0].template;
                const mode = first.category === 'pages' && !isVectorStudio ? 'page' : effectiveMode;
                onInsertTemplate(first, mode);
              }
            }}
          />
          {searchQuery && (
            <button
              type="button"
              class="template-library-search-clear"
              aria-label="Clear template search"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </div>

        <div class="template-category-tabs" role="tablist" aria-label="Template categories">
          {FILTER_TABS.map((tab) => {
            const count = categoryCounts[tab.id];
            const isActive = activeCategory === tab.id;
            const isDimmed = hasSearchQuery && count === 0 && !isActive;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`${tab.ariaLabel} (${count})`}
                class={
                  'template-category-tab'
                  + (isActive ? ' active' : '')
                  + (isDimmed ? ' is-empty' : '')
                }
                onClick={() => setActiveCategory(tab.id)}
              >
                <span class="template-category-tab-label">{tab.label}</span>
                <span class="template-category-tab-count" aria-hidden="true">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div class="template-library-empty" role="status" aria-live="polite">
          {activeCategory !== 'all' && categoryCounts.all > 0 ? (
            <>
              <p>
                No {TEMPLATE_CATEGORY_LABELS[activeCategory]} match “{searchQuery.trim()}”.
              </p>
              <div class="template-library-empty-actions">
                <button
                  type="button"
                  class="template-library-reset-btn is-primary"
                  onClick={() => {
                    setActiveCategory('all');
                    searchInputRef.current?.focus();
                  }}
                >
                  Show {categoryCounts.all} {categoryCounts.all === 1 ? 'match' : 'matches'} in All
                </button>
                <button
                  type="button"
                  class="template-library-reset-btn"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                >
                  Clear search
                </button>
              </div>
            </>
          ) : (
            <>
              <p>No templates match “{searchQuery.trim()}”.</p>
              <div class="template-library-empty-actions">
                <button
                  type="button"
                  class="template-library-reset-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategory('all');
                    searchInputRef.current?.focus();
                  }}
                >
                  Clear search
                </button>
              </div>
            </>
          )}
        </div>
      ) : activeCategory === 'all' ? (
        <div class="template-library-sections" aria-label="Available templates">
          {groupedItems.map((group) => (
            <section
              key={group.category}
              class="template-library-section"
              data-template-section={group.category}
              aria-label={group.label}
            >
              <div class="template-library-section-header">
                <h4 class="template-library-section-title">{group.label}</h4>
                <span class="template-library-section-count">{group.items.length}</span>
              </div>
              <div class="template-library-grid" role="list" aria-label={group.label}>
                {group.items.map(renderTemplateCard)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div class="template-library-sections" aria-label={TEMPLATE_CATEGORY_LABELS[activeCategory]}>
          <div class="template-library-grid" role="list" aria-label={TEMPLATE_CATEGORY_LABELS[activeCategory]}>
            {filteredItems.map(renderTemplateCard)}
          </div>
        </div>
      )}
    </div>
  );
}

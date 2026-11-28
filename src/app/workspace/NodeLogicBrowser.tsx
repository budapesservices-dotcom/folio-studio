import { useMemo, useState } from 'preact/hooks';
import type { FolioProject, LogicGraph } from '../../core/document/types';
import {
  deriveOwnerContextFromLogicGraph,
  type NodeLogicOwnerContext,
} from './nodeLogicGraphHelpers';
import { StudioIcon } from './StudioIcon';

export interface NodeLogicBrowserProps {
  project: FolioProject;
  activePageId: string;
  activeOwnerContext: NodeLogicOwnerContext;
  activeGraphId: string | null;
  onOpenLogic: (owner: NodeLogicOwnerContext, graphId: string | null) => void;
  onOpenOwner?: (owner: NodeLogicOwnerContext) => void;
  onClose: () => void;
}

interface BrowserGraphEntry {
  readonly graph: LogicGraph;
  readonly owner: NodeLogicOwnerContext;
  readonly ownerLabel: string;
  readonly scopeLabel: 'Project' | 'Page' | 'Component';
  readonly isActive: boolean;
}

/**
 * Scope-organized Node Logic Graph Browser allowing users to search, inspect
 * owner identity, open any Project / Page / Component graph directly without
 * opening the owning canvas first, or jump straight to the owner canvas.
 */
export function NodeLogicBrowser({
  project,
  activePageId,
  activeOwnerContext,
  activeGraphId,
  onOpenLogic,
  onOpenOwner,
  onClose,
}: NodeLogicBrowserProps) {
  const [search, setSearch] = useState('');

  const pageById = useMemo(
    () => new Map(project.pages.map((page) => [page.id, page])),
    [project.pages],
  );
  const componentById = useMemo(
    () => new Map(project.components.map((comp) => [comp.id, comp])),
    [project.components],
  );

  const normalizedQuery = search.trim().toLowerCase();

  const grouped = useMemo(() => {
    const projectEntries: BrowserGraphEntry[] = [];
    const pageEntries: BrowserGraphEntry[] = [];
    const componentEntries: BrowserGraphEntry[] = [];

    for (const graph of project.logicGraphs) {
      const owner = deriveOwnerContextFromLogicGraph(graph, activePageId);
      let ownerLabel = project.metadata.name || 'Project';
      let scopeLabel: 'Project' | 'Page' | 'Component' = 'Project';

      if (graph.scope === 'page') {
        scopeLabel = 'Page';
        const page = (graph.targetId ? pageById.get(graph.targetId) : undefined)
          ?? pageById.get(activePageId)
          ?? project.pages[0];
        ownerLabel = page?.name ?? 'Main Page';
      } else if (graph.scope === 'component') {
        scopeLabel = 'Component';
        const comp = graph.targetId ? componentById.get(graph.targetId) : undefined;
        ownerLabel = comp?.name ?? 'Missing Component';
      }

      if (normalizedQuery) {
        const haystack = `${graph.name} ${ownerLabel} ${scopeLabel}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) continue;
      }

      const entry: BrowserGraphEntry = {
        graph,
        owner,
        ownerLabel,
        scopeLabel,
        isActive: graph.id === activeGraphId,
      };

      if (graph.scope === 'project') projectEntries.push(entry);
      else if (graph.scope === 'component') componentEntries.push(entry);
      else pageEntries.push(entry);
    }

    // Owners that do not yet have any logic graph so users can switch to them directly too.
    const pageIdsWithGraphs = new Set(
      project.logicGraphs
        .filter((g) => g.scope === 'page')
        .map((g) => g.targetId || activePageId),
    );
    const compIdsWithGraphs = new Set(
      project.logicGraphs
        .filter((g) => g.scope === 'component' && g.targetId)
        .map((g) => g.targetId as string),
    );

    const emptyPages = project.pages.filter((page) => {
      if (pageIdsWithGraphs.has(page.id)) return false;
      if (!normalizedQuery) return true;
      return `${page.name} page`.toLowerCase().includes(normalizedQuery);
    });

    const emptyComponents = project.components.filter((comp) => {
      if (compIdsWithGraphs.has(comp.id)) return false;
      if (!normalizedQuery) return true;
      return `${comp.name} component`.toLowerCase().includes(normalizedQuery);
    });

    return {
      projectEntries,
      pageEntries,
      componentEntries,
      emptyPages,
      emptyComponents,
    };
  }, [
    project.logicGraphs,
    project.pages,
    project.components,
    project.metadata.name,
    activePageId,
    activeGraphId,
    pageById,
    componentById,
    normalizedQuery,
  ]);

  const totalMatches =
    grouped.projectEntries.length
    + grouped.pageEntries.length
    + grouped.componentEntries.length
    + grouped.emptyPages.length
    + grouped.emptyComponents.length;

  const renderGraphRow = (entry: BrowserGraphEntry) => {
    const canOpenOwner =
      Boolean(onOpenOwner)
      && (entry.owner.scope === 'page'
        ? pageById.has(entry.owner.pageId)
        : entry.owner.scope === 'component'
          ? componentById.has(entry.owner.componentId)
          : true);

    return (
      <div
        key={entry.graph.id}
        class={`nl-browser-row${entry.isActive ? ' is-active' : ''}`}
        data-testid={`nl-browser-row-${entry.graph.id}`}
        data-graph-scope={entry.graph.scope}
      >
        <div class="nl-browser-row-main">
          <strong class="nl-browser-graph-name">{entry.graph.name}</strong>
          <span class="nl-browser-owner-meta nl-tabular">
            {entry.scopeLabel} · {entry.ownerLabel} · {entry.graph.nodes.length} nodes
          </span>
        </div>
        <div class="nl-browser-row-actions">
          <button
            type="button"
            class="nl-browser-action-btn is-primary"
            data-testid={`nl-browser-open-logic-${entry.graph.id}`}
            onClick={() => onOpenLogic(entry.owner, entry.graph.id)}
          >
            Open Logic
          </button>
          {onOpenOwner && (
            <button
              type="button"
              class="nl-browser-action-btn"
              data-testid={`nl-browser-open-owner-${entry.graph.id}`}
              disabled={!canOpenOwner}
              title={
                entry.owner.scope === 'component'
                  ? `Open Component Master “${entry.ownerLabel}”`
                  : entry.owner.scope === 'page'
                    ? `Open Page “${entry.ownerLabel}”`
                    : 'Open Project Main Canvas'
              }
              onClick={() => onOpenOwner(entry.owner)}
            >
              Open Owner
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside
      class="nl-browser-drawer"
      aria-label="Node Logic Browser"
      data-testid="nl-browser-drawer"
    >
      <div class="nl-browser-header">
        <div class="nl-browser-title">
          <StudioIcon name="layers" />
          <strong>Logic Browser</strong>
        </div>
        <button
          type="button"
          class="nl-bar-icon-btn"
          aria-label="Close Logic Browser"
          title="Close Logic Browser"
          onClick={onClose}
        >
          <StudioIcon name="close" />
        </button>
      </div>

      <div class="nl-browser-search-wrap">
        <input
          class="nl-input"
          type="search"
          data-testid="nl-browser-search"
          aria-label="Search logic graphs and owners"
          placeholder="Search graphs, pages, components…"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>

      <div class="nl-browser-groups">
        {/* 1. Project Logic */}
        <section class="nl-browser-group" data-testid="nl-browser-group-project">
          <div class="nl-browser-group-head">
            <span>Project Logic</span>
            <span class="nl-tabular">{grouped.projectEntries.length}</span>
          </div>
          {grouped.projectEntries.length > 0 ? (
            grouped.projectEntries.map(renderGraphRow)
          ) : (
            <div class="nl-browser-empty-owner">
              <span>{project.metadata.name || 'Project'} · No graph yet</span>
              <button
                type="button"
                class="nl-browser-action-btn"
                data-testid="nl-browser-open-project-scope"
                onClick={() => onOpenLogic({ scope: 'project' }, null)}
              >
                Open Logic
              </button>
            </div>
          )}
        </section>

        {/* 2. Page Logic */}
        <section class="nl-browser-group" data-testid="nl-browser-group-page">
          <div class="nl-browser-group-head">
            <span>Page Logic</span>
            <span class="nl-tabular">{grouped.pageEntries.length}</span>
          </div>
          {grouped.pageEntries.map(renderGraphRow)}
          {grouped.emptyPages.map((page) => {
            const isSelectedOwner =
              activeOwnerContext.scope === 'page' && activeOwnerContext.pageId === page.id;
            return (
              <div
                key={`empty-page-${page.id}`}
                class={`nl-browser-row is-empty-owner${isSelectedOwner ? ' is-active' : ''}`}
                data-testid={`nl-browser-empty-page-${page.id}`}
              >
                <div class="nl-browser-row-main">
                  <strong class="nl-browser-graph-name">{page.name}</strong>
                  <span class="nl-browser-owner-meta">Page · No logic graph yet</span>
                </div>
                <div class="nl-browser-row-actions">
                  <button
                    type="button"
                    class="nl-browser-action-btn"
                    data-testid={`nl-browser-open-logic-page-${page.id}`}
                    onClick={() => onOpenLogic({ scope: 'page', pageId: page.id }, null)}
                  >
                    Open Logic
                  </button>
                  {onOpenOwner && (
                    <button
                      type="button"
                      class="nl-browser-action-btn"
                      data-testid={`nl-browser-open-owner-page-${page.id}`}
                      onClick={() => onOpenOwner({ scope: 'page', pageId: page.id })}
                    >
                      Open Owner
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* 3. Component Logic */}
        <section class="nl-browser-group" data-testid="nl-browser-group-component">
          <div class="nl-browser-group-head">
            <span>Component Logic</span>
            <span class="nl-tabular">{grouped.componentEntries.length}</span>
          </div>
          {grouped.componentEntries.map(renderGraphRow)}
          {grouped.emptyComponents.map((comp) => {
            const isSelectedOwner =
              activeOwnerContext.scope === 'component'
              && activeOwnerContext.componentId === comp.id;
            return (
              <div
                key={`empty-comp-${comp.id}`}
                class={`nl-browser-row is-empty-owner${isSelectedOwner ? ' is-active' : ''}`}
                data-testid={`nl-browser-empty-component-${comp.id}`}
              >
                <div class="nl-browser-row-main">
                  <strong class="nl-browser-graph-name">{comp.name}</strong>
                  <span class="nl-browser-owner-meta">Component · No logic graph yet</span>
                </div>
                <div class="nl-browser-row-actions">
                  <button
                    type="button"
                    class="nl-browser-action-btn"
                    data-testid={`nl-browser-open-logic-component-${comp.id}`}
                    onClick={() => onOpenLogic({ scope: 'component', componentId: comp.id }, null)}
                  >
                    Open Logic
                  </button>
                  {onOpenOwner && (
                    <button
                      type="button"
                      class="nl-browser-action-btn"
                      data-testid={`nl-browser-open-owner-component-${comp.id}`}
                      onClick={() => onOpenOwner({ scope: 'component', componentId: comp.id })}
                    >
                      Open Owner
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {grouped.componentEntries.length === 0 && grouped.emptyComponents.length === 0 && (
            <div class="nl-browser-empty-hint">No matching components.</div>
          )}
        </section>

        {totalMatches === 0 && normalizedQuery && (
          <div class="nl-browser-empty-hint">No logic graphs match “{search.trim()}”.</div>
        )}
      </div>
    </aside>
  );
}

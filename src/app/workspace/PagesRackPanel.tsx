import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { DEFAULT_APPLICATION_ID } from '../../core/document/applications';
import type { FolioApplication, FolioPage } from '../../core/document/types';
import { StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';

export interface PagesRackPanelProps {
  panelRef: RefObject<HTMLElement>;
  open: boolean;
  pages: readonly FolioPage[];
  activePageId: string;
  pageNameDraft: string;
  applications?: readonly FolioApplication[];
  activeApplicationId?: string;
  onSelectApplication?: (applicationId: string) => void;
  onCreateApplication?: (name: string) => void;
  onFocus: () => void;
  onPageNameDraftChange: (value: string) => void;
  onAddPage: () => void;
  onSwitchPage: (page: FolioPage) => void;
  onClose: () => void;
  onNotice?: (message: string) => void;
}

export function PagesRackPanel({
  panelRef,
  open,
  pages,
  activePageId,
  pageNameDraft,
  applications,
  activeApplicationId,
  onSelectApplication,
  onCreateApplication,
  onFocus,
  onPageNameDraftChange,
  onAddPage,
  onSwitchPage,
  onClose,
  onNotice,
}: PagesRackPanelProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; page: FolioPage | null } | null>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [appNameDraft, setAppNameDraft] = useState('');

  const resolvedApps = applications && applications.length > 0 ? applications : null;
  const resolvedAppId = activeApplicationId ?? resolvedApps?.[0]?.id ?? DEFAULT_APPLICATION_ID;
  const visiblePages = resolvedApps
    ? pages.filter((page) => {
        const effectiveAppId =
          page.applicationId && resolvedApps.some((app) => app.id === page.applicationId)
            ? page.applicationId
            : resolvedApps[0].id;
        return effectiveAppId === resolvedAppId;
      })
    : pages;
  const displayPages = visiblePages.length > 0 ? visiblePages : pages;

  const commitNewApp = () => {
    const trimmed = appNameDraft.trim();
    if (!trimmed || !onCreateApplication) return;
    onCreateApplication(trimmed);
    setAppNameDraft('');
    setAddingApp(false);
  };

  const copyRoute = (route: string) => {
    void navigator.clipboard?.writeText(route).catch(() => {});
    onNotice?.(`Copied route "${route}".`);
  };

  return (
    <section
      ref={panelRef}
      class={`pages-rack-panel ${open ? 'is-open' : ''}`}
      onPointerDown={onFocus}
      aria-label="Pages Rack"
      aria-hidden={!open}
      inert={!open}
    >
      <div class="pages-rack-heading">
        <div class="pages-rack-title">
          <span class="panel-kicker">PROJECT STRUCTURE</span>
          <strong>Pages</strong>
          <span class="pages-rack-count">{displayPages.length}</span>
        </div>
        <div class="pages-rack-actions">
          <input
            ref={nameInputRef}
            class="pages-rack-name-input"
            type="text"
            placeholder="New page name..."
            value={pageNameDraft}
            onInput={(event) => onPageNameDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAddPage();
            }}
            aria-label="New page name"
          />
          <button type="button" class="pages-rack-add" onClick={onAddPage} disabled={!pageNameDraft.trim()}>
            ＋ Add page
          </button>
          <button type="button" class="component-rack-close" title="Close Pages Rack" aria-label="Close Pages Rack" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      {resolvedApps && onSelectApplication && (
        <div class="pages-app-switcher" data-testid="pages-app-switcher">
          <label class="pages-app-switcher-label" for="pages-active-app-select">
            App
          </label>
          <select
            id="pages-active-app-select"
            class="pages-app-select"
            data-testid="pages-app-select"
            aria-label="Active application"
            value={resolvedAppId}
            onChange={(event) => onSelectApplication(event.currentTarget.value)}
          >
            {resolvedApps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name} ({app.basePath})
              </option>
            ))}
          </select>
          <span class="pages-app-count" title={`${resolvedApps.length} applications in this project`}>
            {resolvedApps.length} {resolvedApps.length === 1 ? 'app' : 'apps'}
          </span>
          {onCreateApplication && !addingApp && (
            <button
              type="button"
              class="pages-app-add-btn"
              data-testid="pages-add-app-btn"
              onClick={() => setAddingApp(true)}
              title="Add another application to this project"
            >
              ＋ App
            </button>
          )}
          {onCreateApplication && addingApp && (
            <div class="pages-app-create-inline">
              <input
                type="text"
                class="pages-app-name-input"
                data-testid="pages-new-app-input"
                placeholder="App name (e.g. Admin)"
                aria-label="New application name"
                value={appNameDraft}
                onInput={(event) => setAppNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitNewApp();
                  if (event.key === 'Escape') {
                    setAddingApp(false);
                    setAppNameDraft('');
                  }
                }}
              />
              <button
                type="button"
                class="pages-app-add-btn"
                data-testid="pages-create-app-submit"
                disabled={!appNameDraft.trim()}
                onClick={commitNewApp}
              >
                Create
              </button>
              <button
                type="button"
                class="pages-app-cancel-btn"
                onClick={() => {
                  setAddingApp(false);
                  setAppNameDraft('');
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
      <div
        class="pages-rack-list"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('.pages-rack-card')) return;
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, page: null });
        }}
      >
        {displayPages.map((page) => (
          <button
            type="button"
            key={page.id}
            class={`pages-rack-card ${activePageId === page.id ? 'is-active' : ''}`}
            onClick={() => onSwitchPage(page)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY, page });
            }}
            aria-current={activePageId === page.id ? 'page' : undefined}
          >
            <span class="pages-rack-card-icon"><StudioIcon name="pages" /></span>
            <span class="pages-rack-card-copy">
              <strong>{page.name}</strong>
              <small>{page.route}</small>
            </span>
            <span class="pages-rack-card-kind">
              {page.route === '/' ? 'HOME' : page.route === '/404' ? '404' : 'PAGE'}
            </span>
          </button>
        ))}
      </div>
      {contextMenu && (
        <StudioContextMenu
          open={true}
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={contextMenu.page ? `Actions for page ${contextMenu.page.name}` : 'Pages Rack actions'}
          testId="pages-rack-context-menu"
          onClose={() => setContextMenu(null)}
          items={(() => {
            const page = contextMenu.page;
            const items: StudioContextMenuItem[] = [];
            if (page) {
              items.push({ kind: 'header', id: 'hdr', label: page.name, meta: page.route });
              items.push({
                kind: 'item',
                id: 'switch',
                label: activePageId === page.id ? 'Current Active Page' : `Switch to ${page.name}`,
                active: activePageId === page.id,
                onSelect: () => onSwitchPage(page),
              });
              items.push({
                kind: 'item',
                id: 'copy-route',
                label: `Copy Route (${page.route})`,
                onSelect: () => copyRoute(page.route),
              });
              items.push({ kind: 'divider', id: 'div-new' });
            } else {
              items.push({ kind: 'header', id: 'hdr', label: 'Pages', meta: `${pages.length}` });
            }
            items.push({
              kind: 'item',
              id: 'new-page',
              label: 'Create New Page…',
              accent: true,
              onSelect: () => nameInputRef.current?.focus(),
            });
            return items;
          })()}
        />
      )}
    </section>
  );
}


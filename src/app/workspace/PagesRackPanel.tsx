import type { RefObject } from 'preact';
import type { FolioPage } from '../../core/document/types';
import { StudioIcon } from './StudioIcon';

export interface PagesRackPanelProps {
  panelRef: RefObject<HTMLElement>;
  open: boolean;
  pages: readonly FolioPage[];
  activePageId: string;
  pageNameDraft: string;
  onFocus: () => void;
  onPageNameDraftChange: (value: string) => void;
  onAddPage: () => void;
  onSwitchPage: (page: FolioPage) => void;
  onClose: () => void;
}

export function PagesRackPanel({
  panelRef,
  open,
  pages,
  activePageId,
  pageNameDraft,
  onFocus,
  onPageNameDraftChange,
  onAddPage,
  onSwitchPage,
  onClose,
}: PagesRackPanelProps) {
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
          <span class="pages-rack-count">{pages.length}</span>
        </div>
        <div class="pages-rack-actions">
          <input
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
      <div class="pages-rack-list">
        {pages.map((page) => (
          <button
            type="button"
            key={page.id}
            class={`pages-rack-card ${activePageId === page.id ? 'is-active' : ''}`}
            onClick={() => onSwitchPage(page)}
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
    </section>
  );
}

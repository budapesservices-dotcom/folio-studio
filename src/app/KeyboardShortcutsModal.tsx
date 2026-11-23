import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  SHORTCUT_ACTION_CATEGORIES,
  SHORTCUT_WORKSPACES,
  STUDIO_KEYBOARD_SHORTCUTS,
  countShortcutsByCategory,
  countShortcutsByWorkspace,
  detectShortcutPlatform,
  filterKeyboardShortcuts,
  formatKeyComboForPlatform,
  groupShortcutsByWorkspaceAndAction,
  tokenizeShortcutQuery,
  type KeyboardShortcutEntry,
  type ShortcutActionCategoryFilter,
  type ShortcutPlatform,
  type ShortcutWorkspaceFilter,
} from './keyboardShortcuts';
import { splitHighlightSegments } from '../core/document/templates';
import type { EditorTarget } from './editorContext';

export interface KeyboardShortcutsModalProps {
  open: boolean;
  activeWorkspace: EditorTarget;
  onClose: () => void;
  hostRef: { current: HTMLDivElement | null };
  dialogRef: { current: HTMLElement | null };
}

function KeyCombo({
  tokens,
  platform,
}: {
  tokens: readonly string[];
  platform: ShortcutPlatform;
}) {
  const formatted = formatKeyComboForPlatform(tokens, platform);
  return (
    <span class="shortcut-key-combo">
      {formatted.map((label, index) => (
        <span class="shortcut-key-token" key={`${label}-${index}`}>
          {index > 0 && <span class="shortcut-key-plus" aria-hidden="true">+</span>}
          <kbd class="shortcut-kbd">{label}</kbd>
        </span>
      ))}
    </span>
  );
}

function HighlightedText({ text, tokens }: { text: string; tokens: readonly string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const segments = splitHighlightSegments(text, tokens);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark class="shortcuts-search-match" key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function KeyboardShortcutsModal({
  open,
  activeWorkspace,
  onClose,
  hostRef,
  dialogRef,
}: KeyboardShortcutsModalProps) {
  const [workspaceFilter, setWorkspaceFilter] = useState<ShortcutWorkspaceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<ShortcutActionCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [platform, setPlatform] = useState<ShortcutPlatform>(() => detectShortcutPlatform());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset transient filters cleanly each time the modal opens
  useEffect(() => {
    if (!open) return;
    setWorkspaceFilter('all');
    setCategoryFilter('all');
    setSearchQuery('');
  }, [open]);

  const searchTokens = useMemo(() => tokenizeShortcutQuery(searchQuery), [searchQuery]);

  const workspaceCounts = useMemo(
    () => countShortcutsByWorkspace(STUDIO_KEYBOARD_SHORTCUTS, searchQuery, categoryFilter),
    [searchQuery, categoryFilter],
  );

  const categoryCounts = useMemo(
    () => countShortcutsByCategory(STUDIO_KEYBOARD_SHORTCUTS, searchQuery, workspaceFilter),
    [searchQuery, workspaceFilter],
  );

  const filteredShortcuts = useMemo(
    () =>
      filterKeyboardShortcuts(STUDIO_KEYBOARD_SHORTCUTS, {
        workspace: workspaceFilter,
        category: categoryFilter,
        query: searchQuery,
        platform,
      }),
    [workspaceFilter, categoryFilter, searchQuery, platform],
  );

  const workspaceGroups = useMemo(
    () => groupShortcutsByWorkspaceAndAction(filteredShortcuts, activeWorkspace),
    [filteredShortcuts, activeWorkspace],
  );

  if (!open) return null;

  const hasActiveFilters = workspaceFilter !== 'all' || categoryFilter !== 'all' || searchQuery.trim().length > 0;
  const activeWorkspaceLabel = activeWorkspace === 'component' ? 'Component Canvas' : 'Main Canvas';

  const resetFilters = () => {
    setWorkspaceFilter('all');
    setCategoryFilter('all');
    setSearchQuery('');
    searchInputRef.current?.focus({ preventScroll: true });
  };

  const renderShortcutRow = (entry: KeyboardShortcutEntry) => (
    <li class="shortcut-row" key={entry.id}>
      <div class="shortcut-row-info">
        <div class="shortcut-row-title-line">
          <span class="shortcut-row-action">
            <HighlightedText text={entry.action} tokens={searchTokens} />
          </span>
          {entry.scopeNote && (
            <>
              <span class="shortcut-row-sep" aria-hidden="true">·</span>
              <span class="shortcut-row-scope">{entry.scopeNote}</span>
            </>
          )}
        </div>
        <span class="shortcut-row-description">
          <HighlightedText text={entry.description} tokens={searchTokens} />
        </span>
      </div>
      <div class="shortcut-row-keys" aria-label={`Shortcut: ${formatKeyComboForPlatform(entry.keys, platform).join(' + ')}`}>
        <KeyCombo tokens={entry.keys} platform={platform} />
        {entry.alternateKeys && (
          <>
            <span class="shortcut-key-or" aria-hidden="true">/</span>
            <KeyCombo tokens={entry.alternateKeys} platform={platform} />
          </>
        )}
      </div>
    </li>
  );

  return (
    <div class="shortcuts-modal-host" ref={hostRef}>
      <div
        class="shortcuts-modal-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <section
        class={`shortcuts-modal-dialog ${activeWorkspace === 'component' ? 'is-vector-context' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        aria-describedby="keyboard-shortcuts-subtitle"
        tabIndex={-1}
        ref={dialogRef}
        data-testid="keyboard-shortcuts-modal"
      >
        <header class="shortcuts-modal-header">
          <div class="shortcuts-modal-title-group">
            <h2 id="keyboard-shortcuts-title">Keyboard Shortcuts</h2>
            <p id="keyboard-shortcuts-subtitle" class="shortcuts-modal-subtitle">
              <span>Active workspace: {activeWorkspaceLabel}</span>
              <span aria-hidden="true">·</span>
              <span class="shortcuts-modal-count">
                {filteredShortcuts.length} of {STUDIO_KEYBOARD_SHORTCUTS.length} shortcuts
              </span>
            </p>
          </div>
          <div class="shortcuts-modal-header-actions">
            <div class="shortcuts-platform-switch" role="group" aria-label="Modifier key notation">
              <button
                type="button"
                class={`shortcuts-platform-btn ${platform === 'standard' ? 'active' : ''}`}
                aria-pressed={platform === 'standard'}
                onClick={() => setPlatform('standard')}
              >
                Win / Linux
              </button>
              <button
                type="button"
                class={`shortcuts-platform-btn ${platform === 'mac' ? 'active' : ''}`}
                aria-pressed={platform === 'mac'}
                onClick={() => setPlatform('mac')}
              >
                macOS
              </button>
            </div>
            <button
              type="button"
              class="shortcuts-modal-close"
              aria-label="Close keyboard shortcuts"
              title="Close (Esc)"
              onClick={onClose}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div class="shortcuts-modal-controls">
          <div class="shortcuts-controls-top">
            <div class="shortcuts-workspace-tabs" role="tablist" aria-label="Filter shortcuts by workspace">
              <button
                type="button"
                role="tab"
                aria-selected={workspaceFilter === 'all'}
                class={`shortcuts-workspace-tab ${workspaceFilter === 'all' ? 'active' : ''}`}
                onClick={() => setWorkspaceFilter('all')}
              >
                <span>All Workspaces</span>
                <span class="shortcuts-tab-count">{workspaceCounts.all}</span>
              </button>
              {SHORTCUT_WORKSPACES.map((ws) => (
                <button
                  type="button"
                  role="tab"
                  key={ws.id}
                  aria-selected={workspaceFilter === ws.id}
                  class={`shortcuts-workspace-tab ${workspaceFilter === ws.id ? 'active' : ''} ${ws.accent === 'vector' ? 'is-vector' : ''}`}
                  onClick={() => setWorkspaceFilter(ws.id)}
                >
                  <span>{ws.shortLabel}</span>
                  <span class="shortcuts-tab-count">{workspaceCounts[ws.id]}</span>
                </button>
              ))}
            </div>

            <div class="shortcuts-search-wrap">
              <svg class="shortcuts-search-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
                <path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              <input
                ref={searchInputRef}
                type="search"
                class="shortcuts-search-input"
                data-dialog-initial-focus
                value={searchQuery}
                placeholder="Search shortcuts or keys (e.g. Shift+M, mask)"
                aria-label="Search keyboard shortcuts"
                onInput={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  class="shortcuts-search-clear"
                  aria-label="Clear search query"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div class="shortcuts-category-bar" role="group" aria-label="Filter shortcuts by action category">
            <button
              type="button"
              class={`shortcuts-category-btn ${categoryFilter === 'all' ? 'active' : ''}`}
              aria-pressed={categoryFilter === 'all'}
              onClick={() => setCategoryFilter('all')}
            >
              <span>All Actions</span>
              <span class="shortcuts-tab-count">{categoryCounts.all}</span>
            </button>
            {SHORTCUT_ACTION_CATEGORIES.map((category) => {
              const count = categoryCounts[category.id];
              return (
                <button
                  type="button"
                  key={category.id}
                  class={`shortcuts-category-btn ${categoryFilter === category.id ? 'active' : ''}`}
                  aria-pressed={categoryFilter === category.id}
                  disabled={count === 0 && categoryFilter !== category.id}
                  onClick={() => setCategoryFilter(category.id)}
                >
                  <span>{category.shortLabel}</span>
                  <span class="shortcuts-tab-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div class="shortcuts-modal-body" data-testid="keyboard-shortcuts-list">
          {workspaceGroups.length === 0 ? (
            <div class="shortcuts-empty-state" role="status">
              <h3>No matching shortcuts</h3>
              <p>
                No keyboard shortcuts matched
                {searchQuery.trim() ? ` “${searchQuery.trim()}”` : ' the active workspace and action filters'}.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  class="shortcuts-reset-btn"
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            workspaceGroups.map((group) => (
              <section
                class={`shortcuts-workspace-section ${group.workspace.accent === 'vector' ? 'is-vector' : ''}`}
                key={group.workspace.id}
                aria-labelledby={`shortcuts-ws-heading-${group.workspace.id}`}
              >
                <div class="shortcuts-workspace-heading">
                  <div class="shortcuts-workspace-heading-main">
                    <h3 id={`shortcuts-ws-heading-${group.workspace.id}`}>{group.workspace.label}</h3>
                    <span class="shortcuts-workspace-sep" aria-hidden="true">·</span>
                    <span class="shortcuts-workspace-count">{group.totalCount} shortcuts</span>
                  </div>
                  <p class="shortcuts-workspace-description">{group.workspace.description}</p>
                </div>

                <div class="shortcuts-category-grid">
                  {group.categories.map((actionGroup) => (
                    <div class="shortcuts-category-block" key={`${group.workspace.id}-${actionGroup.category.id}`}>
                      <h4 class="shortcuts-category-heading">
                        <span>{actionGroup.category.label}</span>
                        <span class="shortcuts-category-count">{actionGroup.shortcuts.length}</span>
                      </h4>
                      <ul class="shortcuts-list">
                        {actionGroup.shortcuts.map(renderShortcutRow)}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <footer class="shortcuts-modal-footer">
          <span class="shortcuts-footer-hint">
            Press <kbd class="shortcut-kbd">?</kbd> or <KeyCombo tokens={['Mod', '/']} platform={platform} /> anytime to toggle this cheat sheet
          </span>
          <span class="shortcuts-footer-sep" aria-hidden="true">·</span>
          <span class="shortcuts-footer-hint">
            Press <kbd class="shortcut-kbd">Esc</kbd> to close
          </span>
        </footer>
      </section>
    </div>
  );
}

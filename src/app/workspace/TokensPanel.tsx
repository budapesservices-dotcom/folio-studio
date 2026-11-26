import type { RefObject } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type {
  DesignTokenCategory,
  DesignTokenCollection,
  DesignTokenDefinition,
  DesignTokenLayer,
  FolioProject,
} from '../../core/document/types';
import {
  findTokenUsages,
  generateDesignTokensCss,
  isSafeCssColorValue,
  resolveDesignTokenValue,
  toCssVariableName,
} from '../../core/document/tokens';
import { StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';

export interface TokensPanelProps {
  panelRef: RefObject<HTMLElement>;
  open: boolean;
  project: FolioProject;
  tokens: DesignTokenCollection;
  onUpdateTokens: (next: DesignTokenCollection, unbindTokenIds?: string[], description?: string) => void;
  onCopyNotice: (message: string) => void;
  onClose: () => void;
}

const CATEGORIES: ReadonlyArray<{ id: 'all' | DesignTokenCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'color', label: 'Color' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'radius', label: 'Radius' },
  { id: 'typography', label: 'Type' },
];

const LAYERS: ReadonlyArray<{ id: 'all' | DesignTokenLayer; label: string }> = [
  { id: 'all', label: 'All layers' },
  { id: 'semantic', label: 'Semantic' },
  { id: 'primitive', label: 'Primitive' },
];

function createTokenId(name: string, existing: readonly DesignTokenDefinition[]): string {
  const base = 'tok-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tok-custom';
  const ids = new Set(existing.map((t) => t.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function TokensPanel({
  panelRef,
  open,
  project,
  tokens,
  onUpdateTokens,
  onCopyNotice,
  onClose,
}: TokensPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | DesignTokenCategory>('all');
  const [layerFilter, setLayerFilter] = useState<'all' | DesignTokenLayer>('all');
  const [showCss, setShowCss] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<DesignTokenCategory>('color');
  const [newLayer, setNewLayer] = useState<DesignTokenLayer>('semantic');
  const [newValue, setNewValue] = useState('#7C6FF6');
  const [tokenContextMenu, setTokenContextMenu] = useState<{
    x: number;
    y: number;
    token: DesignTokenDefinition | null;
  } | null>(null);

  const usagesById = useMemo(() => {
    const map = new Map<string, number>();
    for (const token of tokens.tokens) {
      map.set(token.id, findTokenUsages(project, token.id).length);
    }
    return map;
  }, [project, tokens.tokens]);

  const filteredTokens = useMemo(
    () =>
      tokens.tokens.filter((token) => {
        if (categoryFilter !== 'all' && token.category !== categoryFilter) return false;
        if (layerFilter !== 'all' && token.layer !== layerFilter) return false;
        return true;
      }),
    [tokens.tokens, categoryFilter, layerFilter],
  );

  const cssOutput = useMemo(
    () => (showCss ? generateDesignTokensCss(tokens) : ''),
    [showCss, tokens],
  );

  const defaultThemeId = tokens.themes[0]?.id ?? 'light';
  const activeThemeId = tokens.activeThemeId;

  const handleSwitchTheme = (themeId: string) => {
    if (themeId === tokens.activeThemeId) return;
    onUpdateTokens({ ...tokens, activeThemeId: themeId }, undefined, `Switch design token theme to ${themeId}`);
  };

  const handleUpdateTokenLiteral = (token: DesignTokenDefinition, raw: string | number) => {
    const isNumeric = token.category !== 'color';
    if (!isNumeric) {
      const colorStr = String(raw).trim();
      if (!isSafeCssColorValue(colorStr)) {
        onCopyNotice('Invalid CSS color value. Use hex, rgb(), hsl(), or standard CSS color names.');
        return;
      }
    }
    const minNumeric = token.category === 'typography' ? 1 : 0;
    const numericVal = Number(raw);
    const nextLiteral = isNumeric
      ? {
          kind: 'literal' as const,
          value: Number.isFinite(numericVal) ? Math.max(minNumeric, numericVal) : minNumeric,
          unit: 'px' as const,
        }
      : { kind: 'literal' as const, value: String(raw).trim() };

    const nextTokens = tokens.tokens.map((item) => {
      if (item.id !== token.id) return item;
      if (activeThemeId !== defaultThemeId && item.layer === 'semantic') {
        return {
          ...item,
          themeValues: {
            ...(item.themeValues ?? {}),
            [activeThemeId]: nextLiteral,
          },
        };
      }
      return { ...item, value: nextLiteral };
    });

    onUpdateTokens({ ...tokens, tokens: nextTokens }, undefined, `Update token ${token.name}`);
  };

  const handleDeleteToken = (token: DesignTokenDefinition) => {
    const nextTokens = tokens.tokens
      .filter((item) => item.id !== token.id)
      .map((item) => {
        // If another token aliased the deleted token, bake its current resolved literal so collection stays valid.
        const resolved = resolveDesignTokenValue(tokens, item.id, defaultThemeId);
        let updated = item;
        if (updated.value.kind === 'alias' && updated.value.tokenId === token.id) {
          updated = {
            ...updated,
            value: {
              kind: 'literal',
              value: resolved.ok ? resolved.rawValue : (updated.category === 'color' ? '#8B7CF6' : 8),
              ...(updated.category !== 'color' ? { unit: 'px' } : {}),
            },
          };
        }
        if (updated.themeValues) {
          const nextThemeValues = { ...updated.themeValues };
          let mutated = false;
          for (const [tid, tv] of Object.entries(nextThemeValues)) {
            if (tv.kind === 'alias' && tv.tokenId === token.id) {
              const tRes = resolveDesignTokenValue(tokens, item.id, tid);
              nextThemeValues[tid] = {
                kind: 'literal',
                value: tRes.ok ? tRes.rawValue : (updated.category === 'color' ? '#8B7CF6' : 8),
                ...(updated.category !== 'color' ? { unit: 'px' } : {}),
              };
              mutated = true;
            }
          }
          if (mutated) updated = { ...updated, themeValues: nextThemeValues };
        }
        return updated;
      });

    onUpdateTokens(
      { ...tokens, tokens: nextTokens },
      [token.id],
      `Delete design token ${token.name}`,
    );
  };

  const handleCreateToken = (event: Event) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const isNumeric = newCategory !== 'color';
    if (!isNumeric) {
      const candidateColor = newValue.trim() || '#7C6FF6';
      if (!isSafeCssColorValue(candidateColor)) {
        onCopyNotice('Invalid CSS color value. Use hex, rgb(), hsl(), or standard CSS color names.');
        return;
      }
    }
    const minNumeric = newCategory === 'typography' ? 1 : 0;
    const parsedNum = Number(newValue);
    const parsedVal = isNumeric
      ? (Number.isFinite(parsedNum) ? Math.max(minNumeric, parsedNum) : (newCategory === 'typography' ? 16 : 8))
      : (newValue.trim() || '#7C6FF6');
    const created: DesignTokenDefinition = {
      id: createTokenId(trimmed, tokens.tokens),
      name: trimmed,
      layer: newLayer,
      category: newCategory,
      value: {
        kind: 'literal',
        value: parsedVal,
        ...(isNumeric ? { unit: 'px' } : {}),
      },
    };
    onUpdateTokens(
      { ...tokens, tokens: [...tokens.tokens, created] },
      undefined,
      `Add design token ${created.name}`,
    );
    setNewName('');
    setCreating(false);
  };

  const handleCopyCss = async () => {
    const css = generateDesignTokensCss(tokens);
    try {
      await navigator.clipboard?.writeText(css);
      onCopyNotice('Copied CSS custom properties to clipboard');
    } catch {
      onCopyNotice('CSS custom properties ready in preview');
    }
  };

  return (
    <section
      ref={panelRef}
      class={`tokens-rack-panel ${open ? 'is-open' : ''}`}
      aria-label="Design Tokens"
      aria-hidden={!open}
      inert={!open}
    >
      <div class="component-rack-heading tokens-rack-heading">
        <div class="component-rack-title">
          <span class="panel-kicker">DESIGN SYSTEM</span>
          <strong>Design Tokens</strong>
          <span class="tokens-rack-meta">{tokens.tokens.length} tokens</span>
        </div>

        <div class="tokens-rack-controls">
          <div class="tokens-theme-switcher" role="group" aria-label="Active theme">
            {tokens.themes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                class={`tokens-segment-btn ${activeThemeId === theme.id ? 'is-active' : ''}`}
                aria-pressed={activeThemeId === theme.id}
                onClick={() => handleSwitchTheme(theme.id)}
              >
                {theme.name}
              </button>
            ))}
          </div>

          <div class="tokens-category-filter" role="group" aria-label="Filter tokens by category">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                class={`tokens-segment-btn ${categoryFilter === cat.id ? 'is-active' : ''}`}
                aria-pressed={categoryFilter === cat.id}
                onClick={() => setCategoryFilter(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <select
            class="tokens-layer-select"
            aria-label="Filter tokens by layer"
            value={layerFilter}
            onChange={(event) => setLayerFilter(event.currentTarget.value as 'all' | DesignTokenLayer)}
          >
            {LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>{layer.label}</option>
            ))}
          </select>

          <button
            type="button"
            class={`tokens-action-btn ${showCss ? 'is-active' : ''}`}
            aria-pressed={showCss}
            onClick={() => setShowCss((prev) => !prev)}
          >
            CSS
          </button>

          <button
            type="button"
            class="component-rack-save"
            onClick={() => setCreating((prev) => !prev)}
          >
            {creating ? 'Cancel' : '+ New Token'}
          </button>

          <button
            type="button"
            class="component-rack-close"
            title="Close Design Tokens"
            aria-label="Close Design Tokens"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {creating && (
        <form class="tokens-create-bar" onSubmit={handleCreateToken}>
          <input
            class="tokens-create-input"
            type="text"
            placeholder="Token name (e.g. color.brand.primary)"
            aria-label="New token name"
            value={newName}
            onInput={(event) => setNewName(event.currentTarget.value)}
            required
          />
          <select
            class="tokens-layer-select"
            aria-label="New token layer"
            value={newLayer}
            onChange={(event) => setNewLayer(event.currentTarget.value as DesignTokenLayer)}
          >
            <option value="semantic">Semantic</option>
            <option value="primitive">Primitive</option>
          </select>
          <select
            class="tokens-layer-select"
            aria-label="New token category"
            value={newCategory}
            onChange={(event) => {
              const cat = event.currentTarget.value as DesignTokenCategory;
              setNewCategory(cat);
              setNewValue(cat === 'color' ? '#7C6FF6' : '16');
            }}
          >
            <option value="color">Color</option>
            <option value="spacing">Spacing</option>
            <option value="radius">Radius</option>
            <option value="typography">Typography</option>
          </select>
          {newCategory === 'color' ? (
            <div class="tokens-color-input-wrap">
              <input
                type="color"
                aria-label="New color value"
                value={newValue.startsWith('#') && newValue.length >= 7 ? newValue.slice(0, 7) : '#7C6FF6'}
                onInput={(event) => setNewValue(event.currentTarget.value)}
              />
              <input
                class="tokens-value-input"
                type="text"
                aria-label="New hex value"
                value={newValue}
                onInput={(event) => setNewValue(event.currentTarget.value)}
              />
            </div>
          ) : (
            <input
              class="tokens-value-input"
              type="number"
              min="0"
              aria-label="New numeric value"
              value={newValue}
              onInput={(event) => setNewValue(event.currentTarget.value)}
            />
          )}
          <button type="submit" class="component-rack-save">Create</button>
        </form>
      )}

      {showCss ? (
        <div class="tokens-css-preview">
          <div class="tokens-css-header">
            <span>Generated CSS Custom Properties</span>
            <button type="button" class="tokens-action-btn" onClick={() => void handleCopyCss()}>
              Copy CSS
            </button>
          </div>
          <pre class="tokens-css-code">{cssOutput}</pre>
        </div>
      ) : (
        <div
          class="tokens-list"
          role="list"
          onContextMenu={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('.token-row') || target?.closest('input')) return;
            event.preventDefault();
            setTokenContextMenu({ x: event.clientX, y: event.clientY, token: null });
          }}
        >
          {filteredTokens.map((token) => {
            const resolved = resolveDesignTokenValue(tokens, token.id, activeThemeId);
            const resolvedVal = resolved.ok ? resolved.rawValue : '';
            const usageCount = usagesById.get(token.id) ?? 0;
            const cssVar = toCssVariableName(token.name);
            return (
              <div
                class="token-row"
                role="listitem"
                key={token.id}
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement | null)?.closest('input')) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setTokenContextMenu({ x: event.clientX, y: event.clientY, token });
                }}
              >
                <div class="token-row-identity">
                  {token.category === 'color' ? (
                    <span
                      class="token-swatch-dot"
                      style={{ backgroundColor: typeof resolvedVal === 'string' ? resolvedVal : '#8B7CF6' }}
                    />
                  ) : (
                    <span class="token-kind-glyph">
                      {token.category === 'spacing' ? '↔' : token.category === 'radius' ? '╭' : 'Aa'}
                    </span>
                  )}
                  <div class="token-name-stack">
                    <span class="token-name">{token.name}</span>
                    <span class="token-css-var">{cssVar} · {token.layer}</span>
                  </div>
                </div>

                <div class="token-row-editor">
                  {token.category === 'color' ? (
                    <div class="tokens-color-input-wrap">
                      <input
                        type="color"
                        aria-label={`Edit ${token.name} color`}
                        value={
                          typeof resolvedVal === 'string' && resolvedVal.startsWith('#') && resolvedVal.length >= 7
                            ? resolvedVal.slice(0, 7)
                            : '#8B7CF6'
                        }
                        onInput={(event) => handleUpdateTokenLiteral(token, event.currentTarget.value)}
                      />
                      <span class="token-resolved-value">
                        {typeof resolvedVal === 'string' ? resolvedVal.toUpperCase() : '—'}
                      </span>
                    </div>
                  ) : (
                    <div class="tokens-number-wrap">
                      <input
                        class="tokens-value-input"
                        type="number"
                        min="0"
                        aria-label={`Edit ${token.name} value`}
                        value={typeof resolvedVal === 'number' ? resolvedVal : 0}
                        onInput={(event) => handleUpdateTokenLiteral(token, event.currentTarget.value)}
                      />
                      <span class="token-unit">px</span>
                    </div>
                  )}
                </div>

                <div class="token-row-meta">
                  <span class="token-usage-label">
                    {usageCount === 0 ? 'Unused' : `${usageCount} ${usageCount === 1 ? 'use' : 'uses'}`}
                  </span>
                  <button
                    type="button"
                    class="token-delete-btn"
                    title={`Delete ${token.name}`}
                    aria-label={`Delete ${token.name}`}
                    onClick={() => handleDeleteToken(token)}
                  >
                    <StudioIcon name="trash" />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredTokens.length === 0 && (
            <div class="component-rack-empty">
              <StudioIcon name="tokens" />
              <strong>No matching tokens</strong>
              <span>Change your filter or create a new design token above.</span>
            </div>
          )}
        </div>
      )}
      {tokenContextMenu && (
        <StudioContextMenu
          open={true}
          x={tokenContextMenu.x}
          y={tokenContextMenu.y}
          ariaLabel={tokenContextMenu.token ? `Actions for token ${tokenContextMenu.token.name}` : 'Design Tokens actions'}
          testId="tokens-context-menu"
          onClose={() => setTokenContextMenu(null)}
          items={(() => {
            const tok = tokenContextMenu.token;
            if (!tok) {
              const items: StudioContextMenuItem[] = [
                { kind: 'header', id: 'hdr', label: 'Design Tokens', meta: `${tokens.tokens.length}` },
                { kind: 'item', id: 'new-tok', label: 'New Design Token', accent: true, onSelect: () => setCreating(true) },
                { kind: 'item', id: 'copy-all-css', label: 'Copy All CSS Variables', onSelect: () => void handleCopyCss() },
                {
                  kind: 'item',
                  id: 'toggle-css',
                  label: showCss ? 'Show Token List' : 'View Generated CSS',
                  onSelect: () => setShowCss((prev) => !prev),
                },
              ];
              return items;
            }
            const cssVar = toCssVariableName(tok.name);
            const resolved = resolveDesignTokenValue(tokens, tok.id, activeThemeId);
            const resolvedText = resolved.ok
              ? (tok.category === 'color' ? String(resolved.rawValue) : `${resolved.rawValue}px`)
              : '';
            const items: StudioContextMenuItem[] = [
              { kind: 'header', id: 'hdr', label: tok.name, meta: tok.layer },
              {
                kind: 'item',
                id: 'copy-var',
                label: `Copy var(${cssVar})`,
                onSelect: () => {
                  void navigator.clipboard?.writeText(`var(${cssVar})`).catch(() => {});
                  onCopyNotice(`Copied var(${cssVar})`);
                },
              },
              {
                kind: 'item',
                id: 'copy-val',
                label: `Copy Value (${resolvedText || '—'})`,
                disabled: !resolvedText,
                onSelect: () => {
                  void navigator.clipboard?.writeText(resolvedText).catch(() => {});
                  onCopyNotice(`Copied ${resolvedText}`);
                },
              },
              { kind: 'divider', id: 'div-del' },
              {
                kind: 'item',
                id: 'del-tok',
                label: 'Delete Token',
                danger: true,
                onSelect: () => handleDeleteToken(tok),
              },
            ];
            return items;
          })()}
        />
      )}
    </section>
  );
}

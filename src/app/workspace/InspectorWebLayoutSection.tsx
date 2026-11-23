import type {
  BreakpointId,
  DesignNode,
  DesignTokenCollection,
  LayoutAlignItems,
  LayoutDirection,
  LayoutJustifyContent,
  LayoutMode,
  LayoutSizingMode,
  NodeLayoutChildConfig,
  NodeLayoutConfig,
  NodeTokenBindings,
  ResponsiveNodeOverride,
  SemanticHtmlTag,
} from '../../core/document/types';
import { resolveDesignTokenValue } from '../../core/document/tokens';
import { createDefaultAutoLayout } from '../../engines/layout/autoLayout';

export const SEMANTIC_TAG_OPTIONS: ReadonlyArray<{ value: '' | SemanticHtmlTag; label: string }> = [
  { value: '', label: 'Auto (default)' },
  { value: 'div', label: '<div> Container' },
  { value: 'section', label: '<section> Section' },
  { value: 'header', label: '<header> Header' },
  { value: 'footer', label: '<footer> Footer' },
  { value: 'nav', label: '<nav> Navigation' },
  { value: 'main', label: '<main> Main' },
  { value: 'article', label: '<article> Article' },
  { value: 'aside', label: '<aside> Aside' },
  { value: 'button', label: '<button> Button' },
  { value: 'a', label: '<a> Link' },
  { value: 'h1', label: '<h1> Heading 1' },
  { value: 'h2', label: '<h2> Heading 2' },
  { value: 'h3', label: '<h3> Heading 3' },
  { value: 'p', label: '<p> Paragraph' },
  { value: 'span', label: '<span> Inline' },
  { value: 'ul', label: '<ul> List' },
  { value: 'li', label: '<li> List item' },
  { value: 'form', label: '<form> Form' },
  { value: 'input', label: '<input> Input' },
];

export interface InspectorWebLayoutSectionProps {
  selectedNode: DesignNode;
  activeBreakpoint: BreakpointId;
  designTokens: DesignTokenCollection;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onApplyAutoLayout: (containerId: string) => void;
}

function parseNonNegative(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function InspectorWebLayoutSection({
  selectedNode,
  activeBreakpoint,
  designTokens,
  onUpdateSelected,
  onApplyAutoLayout,
}: InspectorWebLayoutSectionProps) {
  const isContainer = selectedNode.type === 'frame' || selectedNode.type === 'group';
  const layout: NodeLayoutConfig = selectedNode.layout ?? {
    ...createDefaultAutoLayout('flex'),
    mode: 'none',
  };
  const layoutChild: NodeLayoutChildConfig = selectedNode.layoutChild ?? {};
  const activeResponsive: ResponsiveNodeOverride = selectedNode.responsive?.[activeBreakpoint] ?? {};
  const bindings: NodeTokenBindings = selectedNode.tokenBindings ?? {};

  const colorTokens = designTokens.tokens.filter((t) => t.category === 'color');
  const spacingTokens = designTokens.tokens.filter((t) => t.category === 'spacing');
  const radiusTokens = designTokens.tokens.filter((t) => t.category === 'radius');
  const typographyTokens = designTokens.tokens.filter((t) => t.category === 'typography');

  const updateLayout = (patch: Partial<NodeLayoutConfig>) => {
    const base: NodeLayoutConfig = selectedNode.layout ?? createDefaultAutoLayout('flex');
    const next: NodeLayoutConfig = {
      ...base,
      ...patch,
      padding: patch.padding ? { ...base.padding, ...patch.padding } : { ...base.padding },
    };
    onUpdateSelected({ layout: next });
  };

  const updateLayoutMode = (mode: LayoutMode) => {
    if (mode === 'none') {
      onUpdateSelected({ layout: undefined });
      return;
    }
    if (selectedNode.layout && selectedNode.layout.mode !== 'none') {
      updateLayout({
        mode,
        ...(mode === 'grid' && !selectedNode.layout.gridColumns ? { gridColumns: 2 } : {}),
      });
    } else {
      onUpdateSelected({ layout: createDefaultAutoLayout(mode) });
    }
  };

  const updateLayoutChild = (patch: Partial<NodeLayoutChildConfig>) => {
    onUpdateSelected({
      layoutChild: {
        ...layoutChild,
        ...patch,
      },
    });
  };

  const updateResponsive = (patch: Partial<ResponsiveNodeOverride>) => {
    const currentMap = selectedNode.responsive ?? {};
    const merged: ResponsiveNodeOverride = { ...activeResponsive, ...patch };
    const clean: ResponsiveNodeOverride = {};
    if (merged.visible !== undefined) clean.visible = merged.visible;
    if (merged.width !== undefined) clean.width = merged.width;
    if (merged.height !== undefined) clean.height = merged.height;
    if (merged.layoutDirection !== undefined) clean.layoutDirection = merged.layoutDirection;
    if (merged.gridColumns !== undefined) clean.gridColumns = merged.gridColumns;
    if (merged.gap !== undefined) clean.gap = merged.gap;
    if (merged.padding !== undefined) clean.padding = merged.padding;

    const nextMap = { ...currentMap };
    if (Object.keys(clean).length === 0) {
      delete nextMap[activeBreakpoint];
    } else {
      nextMap[activeBreakpoint] = clean;
    }
    onUpdateSelected({
      responsive: Object.keys(nextMap).length > 0 ? nextMap : undefined,
    });
  };

  const updateTokenBinding = (key: keyof NodeTokenBindings, tokenId: string) => {
    const nextBindings: NodeTokenBindings = { ...bindings };
    if (!tokenId) {
      delete nextBindings[key];
    } else {
      nextBindings[key] = tokenId;
    }
    onUpdateSelected({
      tokenBindings: Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
    });
  };

  const formatTokenOption = (tokenId: string, name: string): string => {
    const res = resolveDesignTokenValue(designTokens, tokenId, designTokens.activeThemeId);
    if (!res.ok) return name;
    return `${name} (${res.cssValue})`;
  };

  const hasFill = selectedNode.type !== 'group' && selectedNode.type !== 'component-instance';
  const hasStroke =
    selectedNode.type === 'frame' ||
    selectedNode.type === 'rect' ||
    selectedNode.type === 'ellipse' ||
    selectedNode.type === 'path';
  const hasRadius = selectedNode.type === 'frame' || selectedNode.type === 'rect';

  return (
    <>
      <section class="property-section" aria-label="Web Semantics">
        <div class="section-title">Web Semantics</div>
        <label class="field-label">
          HTML Tag
          <select
            class="select-field"
            aria-label="Semantic HTML tag"
            value={selectedNode.semanticTag ?? ''}
            onChange={(event) => {
              const val = event.currentTarget.value as '' | SemanticHtmlTag;
              onUpdateSelected({ semanticTag: val || undefined });
            }}
          >
            {SEMANTIC_TAG_OPTIONS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label class="field-label range-label">
          Accessible Label (aria-label)
          <input
            class="text-field"
            type="text"
            placeholder="Optional screen-reader label"
            value={selectedNode.ariaLabel ?? ''}
            onInput={(event) => {
              const val = event.currentTarget.value;
              onUpdateSelected({ ariaLabel: val.length > 0 ? val : undefined });
            }}
          />
        </label>
        {selectedNode.semanticTag === 'a' && (
          <label class="field-label range-label">
            Link URL (href)
            <input
              class="text-field"
              type="text"
              placeholder="https://... or /about"
              value={selectedNode.href ?? ''}
              onInput={(event) => {
                const val = event.currentTarget.value;
                onUpdateSelected({ href: val.length > 0 ? val : undefined });
              }}
            />
          </label>
        )}
      </section>

      {isContainer && (
        <section class="property-section" aria-label="Auto-Layout">
          <div class="section-title-row">
            <span class="section-title">Auto-Layout</span>
            {layout.mode !== 'none' && (
              <button
                type="button"
                class="inspector-inline-chip"
                title="Commit computed Auto-Layout child positions to the document"
                onClick={() => onApplyAutoLayout(selectedNode.id)}
              >
                Apply Layout
              </button>
            )}
          </div>

          <div class="inspector-segmented" role="group" aria-label="Auto-Layout mode">
            {(['none', 'flex', 'grid'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                class={`inspector-segment-btn ${layout.mode === mode ? 'is-active' : ''}`}
                aria-pressed={layout.mode === mode}
                onClick={() => updateLayoutMode(mode)}
              >
                {mode === 'none' ? 'None' : mode === 'flex' ? 'Flex' : 'Grid'}
              </button>
            ))}
          </div>

          {layout.mode !== 'none' && (
            <div class="autolayout-controls">
              {layout.mode === 'flex' ? (
                <>
                  <div class="field-grid single-row">
                    <div class="field-label">
                      Direction
                      <div class="inspector-segmented compact-segmented" role="group" aria-label="Flex direction">
                        {(['row', 'column'] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            class={`inspector-segment-btn ${layout.direction === dir ? 'is-active' : ''}`}
                            aria-pressed={layout.direction === dir}
                            onClick={() => updateLayout({ direction: dir })}
                          >
                            {dir === 'row' ? 'Row' : 'Col'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div class="field-label">
                      Wrap
                      <div class="inspector-segmented compact-segmented" role="group" aria-label="Flex wrap">
                        {(['nowrap', 'wrap'] as const).map((wrap) => (
                          <button
                            key={wrap}
                            type="button"
                            class={`inspector-segment-btn ${(layout.wrap ?? 'nowrap') === wrap ? 'is-active' : ''}`}
                            aria-pressed={(layout.wrap ?? 'nowrap') === wrap}
                            onClick={() => updateLayout({ wrap })}
                          >
                            {wrap === 'nowrap' ? 'No' : 'Wrap'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div class="field-grid single-row">
                    <label class="field-label">
                      Justify
                      <select
                        class="select-field"
                        aria-label="Justify content"
                        value={layout.justifyContent ?? 'start'}
                        onChange={(event) =>
                          updateLayout({ justifyContent: event.currentTarget.value as LayoutJustifyContent })
                        }
                      >
                        <option value="start">Start</option>
                        <option value="center">Center</option>
                        <option value="end">End</option>
                        <option value="space-between">Between</option>
                        <option value="space-around">Around</option>
                      </select>
                    </label>
                    <label class="field-label">
                      Align
                      <select
                        class="select-field"
                        aria-label="Align items"
                        value={layout.alignItems ?? 'start'}
                        onChange={(event) =>
                          updateLayout({ alignItems: event.currentTarget.value as LayoutAlignItems })
                        }
                      >
                        <option value="start">Start</option>
                        <option value="center">Center</option>
                        <option value="end">End</option>
                        <option value="stretch">Stretch</option>
                      </select>
                    </label>
                  </div>
                </>
              ) : (
                <div class="field-grid single-row">
                  <label class="field-label">
                    Columns
                    <input
                      class="number-field"
                      type="number"
                      min="1"
                      max="12"
                      aria-label="Grid columns"
                      value={layout.gridColumns ?? 2}
                      onInput={(event) => {
                        const val = parseNonNegative(event.currentTarget.value);
                        if (val !== null) updateLayout({ gridColumns: Math.max(1, Math.min(12, Math.round(val))) });
                      }}
                    />
                  </label>
                  <label class="field-label">
                    Row gap
                    <input
                      class="number-field"
                      type="number"
                      min="0"
                      aria-label="Grid row gap"
                      value={layout.rowGap ?? layout.gap}
                      onInput={(event) => {
                        const val = parseNonNegative(event.currentTarget.value);
                        if (val !== null) updateLayout({ rowGap: val });
                      }}
                    />
                  </label>
                </div>
              )}

              <label class="field-label range-label">
                Gap
                <input
                  class="number-field"
                  type="number"
                  min="0"
                  aria-label="Layout gap"
                  value={layout.gap}
                  onInput={(event) => {
                    const val = parseNonNegative(event.currentTarget.value);
                    if (val !== null) updateLayout({ gap: val });
                  }}
                />
              </label>

              <div class="field-label range-label">Padding (T / R / B / L)</div>
              <div class="padding-quad-grid">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <input
                    key={side}
                    class="number-field"
                    type="number"
                    min="0"
                    aria-label={`Padding ${side}`}
                    title={`Padding ${side}`}
                    value={layout.padding[side]}
                    onInput={(event) => {
                      const val = parseNonNegative(event.currentTarget.value);
                      if (val !== null) {
                        updateLayout({
                          padding: { ...layout.padding, [side]: val },
                        });
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {(selectedNode.parentId || layout.mode !== 'none') && (
        <section class="property-section" aria-label="Sizing">
          <div class="section-title">Sizing</div>
          <div class="field-grid single-row">
            <label class="field-label">
              Width
              <select
                class="select-field"
                aria-label="Width sizing mode"
                value={layoutChild.widthMode ?? 'fixed'}
                onChange={(event) => updateLayoutChild({ widthMode: event.currentTarget.value as LayoutSizingMode })}
              >
                <option value="fixed">Fixed</option>
                <option value="hug">Hug</option>
                <option value="fill">Fill</option>
              </select>
            </label>
            <label class="field-label">
              Height
              <select
                class="select-field"
                aria-label="Height sizing mode"
                value={layoutChild.heightMode ?? 'fixed'}
                onChange={(event) => updateLayoutChild({ heightMode: event.currentTarget.value as LayoutSizingMode })}
              >
                <option value="fixed">Fixed</option>
                <option value="hug">Hug</option>
                <option value="fill">Fill</option>
              </select>
            </label>
          </div>
        </section>
      )}

      <section class="property-section" aria-label="Responsive Breakpoint">
        <div class="section-title-row">
          <span class="section-title">
            Responsive · {activeBreakpoint === 'desktop' ? 'Desktop (Base)' : activeBreakpoint === 'tablet' ? 'Tablet (768)' : 'Mobile (390)'}
          </span>
          {activeBreakpoint !== 'desktop' && Object.keys(activeResponsive).length > 0 && (
            <button
              type="button"
              class="inspector-inline-chip"
              onClick={() => updateResponsive({
                visible: undefined,
                width: undefined,
                height: undefined,
                layoutDirection: undefined,
                gridColumns: undefined,
                gap: undefined,
                padding: undefined,
              })}
            >
              Reset
            </button>
          )}
        </div>
        {activeBreakpoint === 'desktop' ? (
          <span class="field-help">
            Switch canvas breakpoint to Tablet or Mobile to override visibility, stack direction, or grid columns.
          </span>
        ) : (
          <div class="autolayout-controls">
            <label class="toggle-row">
              <span>Visible on {activeBreakpoint}</span>
              <input
                type="checkbox"
                checked={activeResponsive.visible !== false}
                onChange={(event) =>
                  updateResponsive({ visible: event.currentTarget.checked ? undefined : false })
                }
              />
            </label>
            {isContainer && layout.mode === 'flex' && (
              <label class="field-label">
                Direction override
                <select
                  class="select-field"
                  aria-label="Responsive direction override"
                  value={activeResponsive.layoutDirection ?? ''}
                  onChange={(event) => {
                    const val = event.currentTarget.value as '' | LayoutDirection;
                    updateResponsive({ layoutDirection: val || undefined });
                  }}
                >
                  <option value="">Inherit ({layout.direction})</option>
                  <option value="row">Row</option>
                  <option value="column">Column</option>
                </select>
              </label>
            )}
            {isContainer && layout.mode === 'grid' && (
              <label class="field-label">
                Columns override
                <input
                  class="number-field"
                  type="number"
                  min="1"
                  max="12"
                  placeholder={String(layout.gridColumns ?? 2)}
                  value={activeResponsive.gridColumns ?? ''}
                  onInput={(event) => {
                    const raw = event.currentTarget.value.trim();
                    if (!raw) {
                      updateResponsive({ gridColumns: undefined });
                      return;
                    }
                    const val = parseNonNegative(raw);
                    if (val !== null) updateResponsive({ gridColumns: Math.max(1, Math.min(12, Math.round(val))) });
                  }}
                />
              </label>
            )}
          </div>
        )}
      </section>

      {(hasFill || hasStroke || hasRadius || layout.mode !== 'none') && (
        <section class="property-section" aria-label="Design Token Bindings">
          <div class="section-title">Token Bindings</div>
          <div class="token-bindings-stack">
            {hasFill && (
              <label class="field-label">
                Fill token
                <select
                  class="select-field"
                  aria-label="Fill design token"
                  value={bindings.fill ?? ''}
                  onChange={(event) => updateTokenBinding('fill', event.currentTarget.value)}
                >
                  <option value="">None (manual)</option>
                  {colorTokens.map((t) => (
                    <option key={t.id} value={t.id}>{formatTokenOption(t.id, t.name)}</option>
                  ))}
                </select>
              </label>
            )}
            {hasStroke && (
              <label class="field-label">
                Stroke token
                <select
                  class="select-field"
                  aria-label="Stroke design token"
                  value={bindings.stroke ?? ''}
                  onChange={(event) => updateTokenBinding('stroke', event.currentTarget.value)}
                >
                  <option value="">None (manual)</option>
                  {colorTokens.map((t) => (
                    <option key={t.id} value={t.id}>{formatTokenOption(t.id, t.name)}</option>
                  ))}
                </select>
              </label>
            )}
            {hasRadius && (
              <label class="field-label">
                Radius token
                <select
                  class="select-field"
                  aria-label="Radius design token"
                  value={bindings.radius ?? ''}
                  onChange={(event) => updateTokenBinding('radius', event.currentTarget.value)}
                >
                  <option value="">None (manual)</option>
                  {radiusTokens.map((t) => (
                    <option key={t.id} value={t.id}>{formatTokenOption(t.id, t.name)}</option>
                  ))}
                </select>
              </label>
            )}
            {layout.mode !== 'none' && (
              <label class="field-label">
                Gap token
                <select
                  class="select-field"
                  aria-label="Gap design token"
                  value={bindings.gap ?? ''}
                  onChange={(event) => updateTokenBinding('gap', event.currentTarget.value)}
                >
                  <option value="">None (manual)</option>
                  {spacingTokens.map((t) => (
                    <option key={t.id} value={t.id}>{formatTokenOption(t.id, t.name)}</option>
                  ))}
                </select>
              </label>
            )}
            {selectedNode.type === 'text' && (
              <label class="field-label">
                Font size token
                <select
                  class="select-field"
                  aria-label="Font size design token"
                  value={bindings.fontSize ?? ''}
                  onChange={(event) => updateTokenBinding('fontSize', event.currentTarget.value)}
                >
                  <option value="">None (manual)</option>
                  {typographyTokens.map((t) => (
                    <option key={t.id} value={t.id}>{formatTokenOption(t.id, t.name)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
      )}
    </>
  );
}

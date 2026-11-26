import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CURATED_FONT_FAMILIES,
  FONT_CATEGORY_META,
  ensureStudioPreviewGoogleFontsLoaded,
  extractPrimaryFontFamily,
  getProjectCustomFontEntries,
  type CuratedFontCategory,
} from '../../core/document/fonts';
import type { CssUnitOption } from '../../core/document/cssUnits';
import type {
  AssetReference,
  TextAlign,
  TextDecoration,
  TextNode,
  TextTransform,
  TextVerticalAlign,
} from '../../core/document/types';
import { NumericUnitInput, type NumericUnitPreset } from './NumericUnitInput';

export const INSPECTOR_FONT_FAMILIES = CURATED_FONT_FAMILIES.map((entry) => ({
  label: entry.label,
  value: entry.value,
}));

const FONT_SIZE_UNITS: readonly CssUnitOption[] = ['px', 'rem', 'em'];
const LINE_HEIGHT_UNITS: readonly CssUnitOption[] = ['', 'px', '%'];
const LETTER_SPACING_UNITS: readonly CssUnitOption[] = ['px', 'em'];

const FONT_WEIGHT_OPTIONS = [
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'SemiBold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'ExtraBold (800)', value: 800 },
] as const;

const FONT_SIZE_PRESETS: readonly NumericUnitPreset[] = [
  { label: '12 px', value: 12, unit: 'px' },
  { label: '14 px', value: 14, unit: 'px' },
  { label: '16 px (1rem)', value: 16, unit: 'px' },
  { label: '20 px', value: 20, unit: 'px' },
  { label: '24 px', value: 24, unit: 'px' },
  { label: '32 px', value: 32, unit: 'px' },
  { label: '48 px', value: 48, unit: 'px' },
  { label: '64 px', value: 64, unit: 'px' },
];

const LINE_HEIGHT_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Tight (1.1)', value: 1.1 },
  { label: 'Snug (1.25)', value: 1.25 },
  { label: 'Normal (1.4)', value: 1.4 },
  { label: 'Relaxed (1.6)', value: 1.6 },
  { label: 'Loose (1.85)', value: 1.85 },
];

const LETTER_SPACING_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Tight (-0.5px)', value: -0.5, unit: 'px' },
  { label: 'Normal (0px)', value: 0, unit: 'px' },
  { label: 'Wide (1px)', value: 1, unit: 'px' },
  { label: 'Caps (0.08em)', value: 0.08, unit: 'em' },
];

function renderHorizontalAlignIcon(align: TextAlign): JSX.Element {
  if (align === 'center') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M4.5 6.5H11.5M2.5 9.5H13.5M5 12.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'right') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M5.5 6.5H13.5M3.5 9.5H13.5M6.5 12.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'justify') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 3.5H13.5M2.5 6.5H13.5M2.5 9.5H13.5M2.5 12.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3.5H13.5M2.5 6.5H10.5M2.5 9.5H12.5M2.5 12.5H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function renderVerticalAlignIcon(align: TextVerticalAlign): JSX.Element {
  if (align === 'middle') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 8H13.5M5 5.5H11M5 10.5H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  if (align === 'bottom') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 13H13.5M5 10H11M6.5 7H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 3H13.5M5 6H11M6.5 9H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

type FontBrowserTab = 'all' | 'custom' | CuratedFontCategory;

export interface InspectorTypographySectionProps {
  selectedNode: TextNode;
  projectAssets?: readonly AssetReference[];
  onImportFontFiles?: (files: readonly File[]) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
  onUpdateExtendedStyle: (patch: Record<string, unknown>) => void;
  onCommitEdit: () => void;
}

export function InspectorTypographySection({
  selectedNode,
  projectAssets = [],
  onImportFontFiles,
  onUpdateSelectedStyle,
  onUpdateExtendedStyle,
  onCommitEdit,
}: InspectorTypographySectionProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<FontBrowserTab>('all');
  const [fontQuery, setFontQuery] = useState('');
  const fontFileInputRef = useRef<HTMLInputElement | null>(null);

  const customFonts = useMemo(
    () => getProjectCustomFontEntries(projectAssets),
    [projectAssets],
  );

  const activePrimaryFamily = useMemo(
    () => extractPrimaryFontFamily(selectedNode.style.fontFamily).toLowerCase(),
    [selectedNode.style.fontFamily],
  );

  const curatedByCategory = useMemo(() => {
    const groups = new Map<CuratedFontCategory, typeof CURATED_FONT_FAMILIES[number][]>();
    for (const meta of FONT_CATEGORY_META) {
      groups.set(meta.id, []);
    }
    for (const entry of CURATED_FONT_FAMILIES) {
      groups.get(entry.category)?.push(entry);
    }
    return groups;
  }, []);

  const hasMatchingSelectOption = useMemo(() => {
    const cur = selectedNode.style.fontFamily;
    if (CURATED_FONT_FAMILIES.some((f) => f.value === cur)) return true;
    if (customFonts.some((f) => f.value === cur)) return true;
    return false;
  }, [selectedNode.style.fontFamily, customFonts]);

  const browserItems = useMemo(() => {
    const needle = fontQuery.trim().toLowerCase();
    const out: {
      readonly key: string;
      readonly label: string;
      readonly family: string;
      readonly value: string;
      readonly meta: string;
      readonly isCustom: boolean;
      readonly googleFont: boolean;
    }[] = [];

    if (browserTab === 'all' || browserTab === 'custom') {
      for (const cf of customFonts) {
        if (
          needle &&
          !cf.family.toLowerCase().includes(needle) &&
          !cf.label.toLowerCase().includes(needle) &&
          !'custom imported'.includes(needle)
        ) {
          continue;
        }
        out.push({
          key: `custom:${cf.assetId}`,
          label: cf.family,
          family: cf.family,
          value: cf.value,
          meta: `Imported · ${cf.format === 'truetype' ? 'TTF' : cf.format === 'opentype' ? 'OTF' : cf.format.toUpperCase()}`,
          isCustom: true,
          googleFont: false,
        });
      }
    }

    if (browserTab !== 'custom') {
      for (const font of CURATED_FONT_FAMILIES) {
        if (browserTab !== 'all' && font.category !== browserTab) continue;
        if (
          needle &&
          !font.label.toLowerCase().includes(needle) &&
          !font.family.toLowerCase().includes(needle) &&
          !font.category.toLowerCase().includes(needle)
        ) {
          continue;
        }
        out.push({
          key: `curated:${font.family}`,
          label: font.label,
          family: font.family,
          value: font.value,
          meta: FONT_CATEGORY_META.find((c) => c.id === font.category)?.shortLabel ?? font.category,
          isCustom: false,
          googleFont: font.googleFont,
        });
      }
    }

    return out;
  }, [browserTab, customFonts, fontQuery]);

  // Lazily load visible Google Fonts while the inline Font Browser is open
  useEffect(() => {
    if (!browserOpen) return;
    const families = browserItems
      .filter((item) => item.googleFont)
      .slice(0, 28)
      .map((item) => item.family);
    if (families.length > 0) {
      ensureStudioPreviewGoogleFontsLoaded(families);
    }
  }, [browserOpen, browserItems]);

  const applyFontFamily = (fontValue: string) => {
    onUpdateSelectedStyle({ fontFamily: fontValue });
    onCommitEdit();
  };

  return (
    <div class="inspector-acc-group">
      <div class="font-family-header-row">
        <span class="framer-mini-kicker">Font Family</span>
        <div class="font-family-header-actions">
          <button
            type="button"
            class={`font-mini-btn${browserOpen ? ' is-active' : ''}`}
            aria-expanded={browserOpen}
            aria-label="Browse all fonts"
            title="Search and preview 74+ fonts"
            onClick={() => setBrowserOpen((prev) => !prev)}
          >
            Browse ({CURATED_FONT_FAMILIES.length + customFonts.length})
          </button>
          {onImportFontFiles && (
            <>
              <button
                type="button"
                class="font-mini-btn is-import"
                aria-label="Import custom font"
                title="Import custom font file (.woff2, .woff, .ttf, .otf)"
                onClick={() => fontFileInputRef.current?.click()}
              >
                + Import
              </button>
              <input
                ref={fontFileInputRef}
                type="file"
                accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                multiple
                class="sr-only-file-input"
                aria-label="Upload custom font files"
                onChange={(event) => {
                  const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                  if (files.length > 0) {
                    onImportFontFiles(files);
                  }
                  event.currentTarget.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>

      <label class="field-label font-select-wrap">
        <span class="sr-only">Font Family</span>
        <select
          class="select-field"
          aria-label="Font Family"
          value={selectedNode.style.fontFamily}
          onChange={(event) => applyFontFamily(event.currentTarget.value)}
        >
          {!hasMatchingSelectOption && (
            <option value={selectedNode.style.fontFamily}>
              {extractPrimaryFontFamily(selectedNode.style.fontFamily) || selectedNode.style.fontFamily}
            </option>
          )}
          {customFonts.length > 0 && (
            <optgroup label={`Imported Fonts (${customFonts.length})`}>
              {customFonts.map((font) => (
                <option key={font.assetId} value={font.value}>
                  {font.label}
                </option>
              ))}
            </optgroup>
          )}
          {FONT_CATEGORY_META.map((cat) => {
            const list = curatedByCategory.get(cat.id) ?? [];
            return (
              <optgroup key={cat.id} label={`${cat.label} (${list.length})`}>
                {list.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>

      {browserOpen && (
        <div class="font-browser-panel" data-testid="inspector-font-browser">
          <div class="font-browser-search-row">
            <input
              type="search"
              class="font-browser-search"
              aria-label="Search fonts"
              placeholder="Search fonts (Syne, Playfair, Mono, Caveat)…"
              value={fontQuery}
              onInput={(e) => setFontQuery(e.currentTarget.value)}
            />
          </div>
          <div class="font-browser-tabs" role="tablist" aria-label="Font categories">
            <button
              type="button"
              role="tab"
              aria-selected={browserTab === 'all'}
              class={`font-browser-tab${browserTab === 'all' ? ' is-active' : ''}`}
              onClick={() => setBrowserTab('all')}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browserTab === 'custom'}
              class={`font-browser-tab${browserTab === 'custom' ? ' is-active' : ''}`}
              onClick={() => setBrowserTab('custom')}
            >
              Imported ({customFonts.length})
            </button>
            {FONT_CATEGORY_META.map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={browserTab === cat.id}
                class={`font-browser-tab${browserTab === cat.id ? ' is-active' : ''}`}
                onClick={() => setBrowserTab(cat.id)}
              >
                {cat.shortLabel}
              </button>
            ))}
          </div>

          {browserItems.length === 0 ? (
            <div class="font-browser-empty">
              {browserTab === 'custom'
                ? 'No custom fonts imported yet. Click "+ Import" to upload .woff2, .woff, .ttf, or .otf files.'
                : `No fonts match "${fontQuery}".`}
            </div>
          ) : (
            <div class="font-browser-list" role="listbox" aria-label="Available fonts">
              {browserItems.map((item) => {
                const isSelected =
                  selectedNode.style.fontFamily === item.value ||
                  activePrimaryFamily === item.family.toLowerCase();
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    class={`font-browser-item${isSelected ? ' is-active' : ''}`}
                    onClick={() => applyFontFamily(item.value)}
                  >
                    <span class="font-browser-item-name" style={{ fontFamily: item.value }}>
                      {item.label}
                    </span>
                    <span class="font-browser-item-meta">{item.meta}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div class="folio-dual-grid">
        <label class="field-label">
          Weight
          <select
            class="select-field"
            aria-label="Font Weight"
            value={String(selectedNode.style.fontWeight)}
            onChange={(event) => {
              onUpdateSelectedStyle({ fontWeight: Number(event.currentTarget.value) });
              onCommitEdit();
            }}
          >
            {FONT_WEIGHT_OPTIONS.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <NumericUnitInput
          label="Size"
          ariaLabel="Font Size"
          value={selectedNode.style.fontSize}
          unit={selectedNode.style.fontSizeUnit ?? 'px'}
          units={FONT_SIZE_UNITS}
          presets={FONT_SIZE_PRESETS}
          min={8}
          max={240}
          step={1}
          onPreview={(p) =>
            onUpdateExtendedStyle({
              fontSize: p.value,
              fontSizeUnit: p.unit === 'rem' || p.unit === 'em' ? p.unit : 'px',
            })
          }
          onChange={(p) => {
            onUpdateExtendedStyle({
              fontSize: p.value,
              fontSizeUnit: p.unit === 'rem' || p.unit === 'em' ? p.unit : 'px',
            });
            onCommitEdit();
          }}
        />
      </div>

      <div class="folio-dual-grid">
        <NumericUnitInput
          label="LH"
          ariaLabel="Line Height"
          value={selectedNode.style.lineHeight}
          unit={selectedNode.style.lineHeightUnit ?? ''}
          units={LINE_HEIGHT_UNITS}
          presets={LINE_HEIGHT_PRESETS}
          min={0.5}
          max={400}
          step={0.05}
          precision={2}
          onChange={(p) => {
            onUpdateExtendedStyle({
              lineHeight: p.value,
              lineHeightUnit: p.unit === 'px' || p.unit === '%' ? p.unit : '',
            });
            onCommitEdit();
          }}
        />
        <NumericUnitInput
          label="LS"
          ariaLabel="Letter Spacing"
          value={selectedNode.style.letterSpacing ?? 0}
          unit={selectedNode.style.letterSpacingUnit ?? 'px'}
          units={LETTER_SPACING_UNITS}
          presets={LETTER_SPACING_PRESETS}
          min={-10}
          max={40}
          step={0.25}
          precision={2}
          allowNegative
          onChange={(p) => {
            onUpdateExtendedStyle({
              letterSpacing: p.value,
              letterSpacingUnit: p.unit === 'em' ? 'em' : 'px',
            });
            onCommitEdit();
          }}
        />
      </div>

      {/* 4-Button Horizontal Align */}
      <div class="framer-subcontrol">
        <span class="framer-mini-kicker">Horizontal Alignment</span>
        <div class="framer-seg-row cols-4" role="group" aria-label="Text horizontal alignment">
          {(['left', 'center', 'right', 'justify'] as const).map((align) => (
            <button
              key={align}
              type="button"
              class={`framer-seg-btn${(selectedNode.style.textAlign ?? 'left') === align ? ' is-active' : ''}`}
              aria-label={`Align ${align}`}
              aria-pressed={(selectedNode.style.textAlign ?? 'left') === align}
              onClick={() => {
                onUpdateSelectedStyle({ textAlign: align });
                onCommitEdit();
              }}
            >
              <span class="folio-align-svg">{renderHorizontalAlignIcon(align)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3-Button Vertical Align */}
      <div class="framer-subcontrol">
        <span class="framer-mini-kicker">Vertical Alignment</span>
        <div class="framer-seg-row cols-3" role="group" aria-label="Text vertical alignment">
          {(['top', 'middle', 'bottom'] as const).map((valign) => (
            <button
              key={valign}
              type="button"
              class={`framer-seg-btn${(selectedNode.style.verticalAlign ?? 'top') === valign ? ' is-active' : ''}`}
              aria-label={`Vertical align ${valign}`}
              aria-pressed={(selectedNode.style.verticalAlign ?? 'top') === valign}
              onClick={() => {
                onUpdateSelectedStyle({ verticalAlign: valign });
                onCommitEdit();
              }}
            >
              <span class="folio-align-svg">{renderVerticalAlignIcon(valign)}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="folio-dual-grid">
        <label class="field-label">
          Transform
          <select
            class="select-field"
            aria-label="Text Transform"
            value={selectedNode.style.textTransform ?? 'none'}
            onChange={(event) => {
              onUpdateSelectedStyle({
                textTransform: event.currentTarget.value as TextTransform,
              });
              onCommitEdit();
            }}
          >
            <option value="none">None</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="lowercase">lowercase</option>
            <option value="capitalize">Capitalize</option>
          </select>
        </label>
        <label class="field-label">
          Decoration
          <select
            class="select-field"
            aria-label="Text Decoration"
            value={selectedNode.style.textDecoration ?? 'none'}
            onChange={(event) => {
              onUpdateSelectedStyle({
                textDecoration: event.currentTarget.value as TextDecoration,
              });
              onCommitEdit();
            }}
          >
            <option value="none">None</option>
            <option value="underline">Underline</option>
            <option value="line-through">Strike</option>
          </select>
        </label>
      </div>
    </div>
  );
}

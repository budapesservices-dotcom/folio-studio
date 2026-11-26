import { describe, expect, it } from 'vitest';
import {
  CURATED_FONT_FAMILIES,
  FONT_CATEGORY_META,
  buildCustomFontFaceCss,
  buildGoogleFontsStylesheetUrl,
  formatCustomFontCssStack,
  getProjectCustomFontEntries,
  sanitizeCustomFontFamilyName,
} from '../src/core/document/fonts';
import { ingestFontBytes } from '../src/core/persistence/assetStore';
import {
  ANIMATION_EASINGS,
  EASING_CATEGORY_META,
  EASING_PRESET_CATALOG,
  evaluateEasing,
  formatEasingLabel,
  getEasingPresetDefinition,
  toCssTimingFunction,
} from '../src/engines/animation/easing';
import { isAnimationEasing } from '../src/core/document/validation';

describe('Expanded Curated Fonts & Custom Font Import', () => {
  it('provides 70+ curated fonts across all 5 categories with valid Google Fonts stylesheet URLs', () => {
    expect(CURATED_FONT_FAMILIES.length).toBeGreaterThanOrEqual(70);

    const categories = new Set(CURATED_FONT_FAMILIES.map((f) => f.category));
    expect(categories).toEqual(new Set(['sans', 'display', 'serif', 'mono', 'handwriting']));
    expect(FONT_CATEGORY_META.length).toBe(5);

    // Every font entry has unique family & valid stack
    const seen = new Set<string>();
    for (const font of CURATED_FONT_FAMILIES) {
      expect(seen.has(font.family)).toBe(false);
      seen.add(font.family);
      expect(font.value.length).toBeGreaterThan(3);
    }

    const url = buildGoogleFontsStylesheetUrl([
      '"Space Grotesk", sans-serif',
      '"Instrument Serif", serif',
      '"JetBrains Mono", monospace',
      '"Caveat", cursive',
    ]);
    expect(url).toContain('family=Space+Grotesk');
    expect(url).toContain('family=Instrument+Serif');
    expect(url).toContain('family=JetBrains+Mono');
    expect(url).toContain('family=Caveat');
  });

  it('sanitizes custom font names, ingests binary fonts with SHA-256 deduplication, blocks markup, and builds @font-face CSS', async () => {
    expect(sanitizeCustomFontFamilyName('My_Brand-Display.woff2')).toBe('My Brand-Display');
    expect(formatCustomFontCssStack('My Brand Display')).toBe('"My Brand Display", system-ui, sans-serif');

    // Minimal valid WOFF2 header ("wOF2" + padding)
    const woff2Bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00, 0x10, 0x20, 0x30, 0x40]);
    const first = await ingestFontBytes({
      bytes: woff2Bytes,
      name: 'StudioGrotesque-Bold.woff2',
      mimeType: 'font/woff2',
    });
    expect(first.asset.kind).toBe('font');
    expect(first.asset.mimeType).toBe('font/woff2');
    expect(first.familyName).toBe('StudioGrotesque-Bold');
    expect(formatCustomFontCssStack(first.familyName)).toContain('"StudioGrotesque-Bold"');

    // Same bytes deduplicate to the same SHA-256 asset ID
    const second = await ingestFontBytes(
      {
        bytes: woff2Bytes,
        name: 'StudioGrotesque-Bold.woff2',
        mimeType: 'font/woff2',
      },
      [first.asset],
    );
    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.sha256).toBe(first.asset.sha256);

    // Rejects malicious script/SVG disguised as font file
    const malicious = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    await expect(
      ingestFontBytes({ bytes: malicious, name: 'evil.woff2', mimeType: 'font/woff2' }),
    ).rejects.toThrow();

    // Emits @font-face CSS and lists project custom fonts
    const entries = getProjectCustomFontEntries([first.asset]);
    expect(entries).toHaveLength(1);
    expect(entries[0].family).toBe('StudioGrotesque-Bold');

    const dataUrl = `data:font/woff2;base64,${btoa(String.fromCharCode(...woff2Bytes))}`;
    const css = buildCustomFontFaceCss([first.asset], {
      resolveHref: (asset) => (asset.id === first.asset.id ? dataUrl : null),
    });
    expect(css).toContain('@font-face');
    expect(css).toContain('font-family: "StudioGrotesque-Bold"');
    expect(css).toContain('format("woff2")');
  });
});

describe('68-Curve Categorized Easing Preset Library', () => {
  it('exposes 65+ validated easing presets across all 6 categories with exact 0/1 endpoints and valid CSS output', () => {
    expect(EASING_PRESET_CATALOG.length).toBeGreaterThanOrEqual(65);
    expect(ANIMATION_EASINGS.length).toBe(EASING_PRESET_CATALOG.length);
    expect(EASING_CATEGORY_META.length).toBe(6);

    const seenIds = new Set<string>();
    const cssKeywords = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
    for (const preset of EASING_PRESET_CATALOG) {
      expect(seenIds.has(preset.id)).toBe(false);
      seenIds.add(preset.id);

      // Accepted by document validation
      expect(isAnimationEasing(preset.id), `Easing "${preset.id}" must pass document validation`).toBe(true);

      // Lookup and human label work
      expect(getEasingPresetDefinition(preset.id)?.id).toBe(preset.id);
      expect(formatEasingLabel(preset.id).length).toBeGreaterThan(0);

      // Exact boundary math & finite mid-curve values
      expect(evaluateEasing(preset.id, 0)).toBe(0);
      expect(evaluateEasing(preset.id, 1)).toBe(1);
      for (const t of [0.15, 0.35, 0.5, 0.75, 0.9]) {
        const y = evaluateEasing(preset.id, t);
        expect(Number.isFinite(y), `Easing "${preset.id}" produced non-finite value at t=${t}`).toBe(true);
      }

      // Compiles cleanly to valid CSS timing function
      const css = toCssTimingFunction(preset.id);
      expect(css.length).toBeGreaterThan(0);
      expect(
        cssKeywords.has(css) ||
          css.startsWith('cubic-bezier(') ||
          css.startsWith('steps(') ||
          css.startsWith('linear('),
        `Unexpected CSS timing function "${css}" for easing "${preset.id}"`,
      ).toBe(true);
    }
  });
});

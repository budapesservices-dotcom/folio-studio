/**
 * Google Fonts & @font-face Typography Loader + Codegen Helper.
 *
 * Pure catalog and URL/CSS builders work in Node/Vitest and browser;
 * runtime DOM helpers load selected Google Fonts and custom @font-face assets
 * into the Studio canvas idempotently.
 */

import type { AssetReference, DesignNode, FolioProject } from './types';

export interface CuratedFontEntry {
  readonly label: string;
  readonly family: string;
  readonly value: string;
  readonly googleFont: boolean;
  readonly weights: readonly number[];
  readonly category: 'sans' | 'serif' | 'display' | 'mono';
}

export const CURATED_FONT_FAMILIES: readonly CuratedFontEntry[] = Object.freeze([
  { label: 'Inter (UI Sans)', family: 'Inter', value: 'Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'System UI', family: 'system-ui', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', googleFont: false, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Space Grotesk', family: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans', value: '"Plus Jakarta Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'DM Sans', family: 'DM Sans', value: '"DM Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 700], category: 'sans' },
  { label: 'Outfit', family: 'Outfit', value: 'Outfit, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Sora', family: 'Sora', value: 'Sora, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Syne', family: 'Syne', value: 'Syne, Inter, system-ui, sans-serif', googleFont: true, weights: [500, 600, 700, 800], category: 'display' },
  { label: 'Playfair Display', family: 'Playfair Display', value: '"Playfair Display", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Instrument Serif', family: 'Instrument Serif', value: '"Instrument Serif", Georgia, serif', googleFont: true, weights: [400], category: 'serif' },
  { label: 'Georgia (Editorial Serif)', family: 'Georgia', value: 'Georgia, "Times New Roman", serif', googleFont: false, weights: [400, 700], category: 'serif' },
  { label: 'JetBrains Mono', family: 'JetBrains Mono', value: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Fira Code', family: 'Fira Code', value: '"Fira Code", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
]);

const GOOGLE_FONT_BY_LOWER = new Map(
  CURATED_FONT_FAMILIES
    .filter((entry) => entry.googleFont)
    .map((entry) => [entry.family.toLowerCase(), entry]),
);

const SAFE_FONT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\s-]{0,60}$/;

export function isSafeFontFamilyName(name: string): boolean {
  return SAFE_FONT_NAME_PATTERN.test(name.trim());
}

/**
 * Extracts the primary (first) font family name from a CSS `font-family` stack,
 * stripping surrounding quotes.
 */
export function extractPrimaryFontFamily(fontFamilyStack: string): string {
  const first = fontFamilyStack.split(',')[0]?.trim() ?? '';
  return first.replace(/^["']|["']$/g, '').trim();
}

export function getGoogleFontEntry(fontFamilyStack: string): CuratedFontEntry | null {
  const primary = extractPrimaryFontFamily(fontFamilyStack);
  if (!primary) return null;
  return GOOGLE_FONT_BY_LOWER.get(primary.toLowerCase()) ?? null;
}

function collectFontsFromNodes(nodes: readonly DesignNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'text' && node.style.fontFamily) {
      const entry = getGoogleFontEntry(node.style.fontFamily);
      if (entry) out.add(entry.family);
    }
  }
}

/** Collects all unique Google Font families used across pages & components in a project. */
export function collectProjectGoogleFonts(project: FolioProject): string[] {
  const found = new Set<string>();
  for (const page of project.pages) {
    collectFontsFromNodes(page.document.nodes, found);
  }
  for (const component of project.components) {
    collectFontsFromNodes(component.document.nodes, found);
  }
  return [...found].sort();
}

/**
 * Builds a deterministic, strictly allowlisted Google Fonts CSS2 stylesheet URL
 * for the requested curated font families. Returns null if none match.
 */
export function buildGoogleFontsStylesheetUrl(families: readonly string[]): string | null {
  const queryParts: string[] = [];
  const seen = new Set<string>();

  for (const raw of families) {
    const entry = GOOGLE_FONT_BY_LOWER.get(extractPrimaryFontFamily(raw).toLowerCase());
    if (!entry || seen.has(entry.family)) continue;
    seen.add(entry.family);
    const encodedName = encodeURIComponent(entry.family).replace(/%20/g, '+');
    const weightList = entry.weights.join(';');
    queryParts.push(`family=${encodedName}:wght@${weightList}`);
  }

  if (queryParts.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${queryParts.join('&')}&display=swap`;
}

function detectFontFormat(mimeType: string, name: string): string {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerMime.includes('woff2') || lowerName.endsWith('.woff2')) return 'woff2';
  if (lowerMime.includes('woff') || lowerName.endsWith('.woff')) return 'woff';
  if (lowerMime.includes('otf') || lowerMime.includes('opentype') || lowerName.endsWith('.otf')) return 'opentype';
  return 'truetype';
}

const SAFE_FONT_DATA_URL_PREFIX = /^data:(?:font\/(?:woff2|woff|ttf|otf)|application\/(?:font-woff2|font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,[A-Za-z0-9+/=]+$/;

/**
 * Emits safe `@font-face` CSS rules for embedded project font assets (`kind === 'font'`).
 * Only allows validated `data:` font URLs or clean relative `assets/` paths.
 */
export function buildCustomFontFaceCss(
  assets: readonly AssetReference[],
  options: { resolveHref?: (asset: AssetReference) => string | null } = {},
): string {
  const rules: string[] = [];
  for (const asset of assets) {
    if (asset.kind !== 'font') continue;
    const rawName = asset.name.replace(/\.(woff2?|ttf|otf)$/i, '').trim();
    if (!isSafeFontFamilyName(rawName)) continue;
    const href = options.resolveHref ? options.resolveHref(asset) : asset.source;
    if (!href) continue;
    const isSafeData = SAFE_FONT_DATA_URL_PREFIX.test(href);
    const isSafeRelative = /^\.\.\/assets\/[a-zA-Z0-9._-]+$|^\/assets\/[a-zA-Z0-9._-]+$/.test(href);
    if (!isSafeData && !isSafeRelative) continue;
    const format = detectFontFormat(asset.mimeType, asset.name);
    rules.push(
      [
        '@font-face {',
        `  font-family: "${rawName}";`,
        `  src: url("${href}") format("${format}");`,
        '  font-display: swap;',
        '}',
      ].join('\n'),
    );
  }
  return rules.join('\n\n');
}

const STUDIO_GOOGLE_FONT_LINK_ATTR = 'data-folio-google-fonts';
const STUDIO_CUSTOM_FONT_STYLE_ATTR = 'data-folio-custom-fonts';

/**
 * Idempotently loads Google Fonts into the active browser document `<head>`
 * so Canvas SVG and Inspector previews render the true webfont.
 */
export function ensureStudioGoogleFontsLoaded(families: readonly string[]): string | null {
  const url = buildGoogleFontsStylesheetUrl(families);
  if (!url || typeof document === 'undefined' || !document.head) return url;
  let link = document.head.querySelector(`link[${STUDIO_GOOGLE_FONT_LINK_ATTR}]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute(STUDIO_GOOGLE_FONT_LINK_ATTR, 'true');
    document.head.appendChild(link);
  }
  if (link.href !== url) {
    link.href = url;
  }
  return url;
}

/**
 * Idempotently injects `@font-face` rules for project custom font assets into `<head>`.
 */
export function ensureStudioCustomFontsLoaded(assets: readonly AssetReference[]): void {
  if (typeof document === 'undefined' || !document.head) return;
  const css = buildCustomFontFaceCss(assets);
  let styleEl = document.head.querySelector(`style[${STUDIO_CUSTOM_FONT_STYLE_ATTR}]`) as HTMLStyleElement | null;
  if (!css) {
    styleEl?.remove();
    return;
  }
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute(STUDIO_CUSTOM_FONT_STYLE_ATTR, 'true');
    document.head.appendChild(styleEl);
  }
  if (styleEl.textContent !== css) {
    styleEl.textContent = css;
  }
}

/**
 * Google Fonts & @font-face Typography Loader + Codegen Helper.
 *
 * Pure catalog and URL/CSS builders work in Node/Vitest and browser;
 * runtime DOM helpers load selected Google Fonts and custom @font-face assets
 * into the Studio canvas idempotently.
 */

import type { AssetReference, DesignNode, FolioProject } from './types';
import { resolveAssetDisplayUrl, resolvePortableAssetUrl } from '../persistence/assetStore';

export type CuratedFontCategory = 'sans' | 'display' | 'serif' | 'mono' | 'handwriting';

export interface CuratedFontEntry {
  readonly label: string;
  readonly family: string;
  readonly value: string;
  readonly googleFont: boolean;
  readonly weights: readonly number[];
  readonly category: CuratedFontCategory;
}

export interface ProjectCustomFontEntry {
  readonly assetId: string;
  readonly family: string;
  readonly label: string;
  readonly value: string;
  readonly format: string;
  readonly mimeType: string;
}

export const FONT_CATEGORY_META: readonly {
  readonly id: CuratedFontCategory;
  readonly label: string;
  readonly shortLabel: string;
}[] = Object.freeze([
  { id: 'sans', label: 'Sans-Serif', shortLabel: 'Sans' },
  { id: 'display', label: 'Display & Geometric', shortLabel: 'Display' },
  { id: 'serif', label: 'Editorial Serif', shortLabel: 'Serif' },
  { id: 'mono', label: 'Monospace', shortLabel: 'Mono' },
  { id: 'handwriting', label: 'Script & Handwriting', shortLabel: 'Script' },
]);

export const CURATED_FONT_FAMILIES: readonly CuratedFontEntry[] = Object.freeze([
  // ── Sans-Serif (26) ────────────────────────────────────────────────────────
  { label: 'Inter (UI Sans)', family: 'Inter', value: 'Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'System UI', family: 'system-ui', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', googleFont: false, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans', value: '"Plus Jakarta Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'DM Sans', family: 'DM Sans', value: '"DM Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 700], category: 'sans' },
  { label: 'Manrope', family: 'Manrope', value: 'Manrope, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Work Sans', family: 'Work Sans', value: '"Work Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Public Sans', family: 'Public Sans', value: '"Public Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Urbanist', family: 'Urbanist', value: 'Urbanist, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Figtree', family: 'Figtree', value: 'Figtree, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Onest', family: 'Onest', value: 'Onest, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Albert Sans', family: 'Albert Sans', value: '"Albert Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Rubik', family: 'Rubik', value: 'Rubik, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Nunito', family: 'Nunito', value: 'Nunito, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Poppins', family: 'Poppins', value: 'Poppins, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Montserrat', family: 'Montserrat', value: 'Montserrat, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Raleway', family: 'Raleway', value: 'Raleway, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Lato', family: 'Lato', value: 'Lato, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 700], category: 'sans' },
  { label: 'Open Sans', family: 'Open Sans', value: '"Open Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Source Sans 3', family: 'Source Sans 3', value: '"Source Sans 3", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'IBM Plex Sans', family: 'IBM Plex Sans', value: '"IBM Plex Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Mulish', family: 'Mulish', value: 'Mulish, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'sans' },
  { label: 'Karla', family: 'Karla', value: 'Karla, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Barlow', family: 'Barlow', value: 'Barlow, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Lexend', family: 'Lexend', value: 'Lexend, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Be Vietnam Pro', family: 'Be Vietnam Pro', value: '"Be Vietnam Pro", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },
  { label: 'Instrument Sans', family: 'Instrument Sans', value: '"Instrument Sans", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'sans' },

  // ── Display & Geometric (16) ───────────────────────────────────────────────
  { label: 'Space Grotesk', family: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Outfit', family: 'Outfit', value: 'Outfit, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Sora', family: 'Sora', value: 'Sora, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Syne', family: 'Syne', value: 'Syne, Inter, system-ui, sans-serif', googleFont: true, weights: [500, 600, 700, 800], category: 'display' },
  { label: 'Bricolage Grotesque', family: 'Bricolage Grotesque', value: '"Bricolage Grotesque", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'display' },
  { label: 'Archivo', family: 'Archivo', value: 'Archivo, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'display' },
  { label: 'Archivo Black', family: 'Archivo Black', value: '"Archivo Black", Impact, sans-serif', googleFont: true, weights: [400], category: 'display' },
  { label: 'Unbounded', family: 'Unbounded', value: 'Unbounded, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'display' },
  { label: 'Bebas Neue', family: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif', googleFont: true, weights: [400], category: 'display' },
  { label: 'Oswald', family: 'Oswald', value: 'Oswald, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Anton', family: 'Anton', value: 'Anton, Impact, sans-serif', googleFont: true, weights: [400], category: 'display' },
  { label: 'Antonio', family: 'Antonio', value: 'Antonio, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Barlow Condensed', family: 'Barlow Condensed', value: '"Barlow Condensed", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },
  { label: 'Big Shoulders Display', family: 'Big Shoulders Display', value: '"Big Shoulders Display", Impact, sans-serif', googleFont: true, weights: [500, 600, 700, 800], category: 'display' },
  { label: 'Orbitron', family: 'Orbitron', value: 'Orbitron, Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700, 800], category: 'display' },
  { label: 'Chakra Petch', family: 'Chakra Petch', value: '"Chakra Petch", Inter, system-ui, sans-serif', googleFont: true, weights: [400, 500, 600, 700], category: 'display' },

  // ── Editorial Serif (15) ───────────────────────────────────────────────────
  { label: 'Playfair Display', family: 'Playfair Display', value: '"Playfair Display", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Instrument Serif', family: 'Instrument Serif', value: '"Instrument Serif", Georgia, serif', googleFont: true, weights: [400], category: 'serif' },
  { label: 'Fraunces', family: 'Fraunces', value: 'Fraunces, Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Cormorant Garamond', family: 'Cormorant Garamond', value: '"Cormorant Garamond", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Bodoni Moda', family: 'Bodoni Moda', value: '"Bodoni Moda", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'DM Serif Display', family: 'DM Serif Display', value: '"DM Serif Display", Georgia, serif', googleFont: true, weights: [400], category: 'serif' },
  { label: 'Libre Baskerville', family: 'Libre Baskerville', value: '"Libre Baskerville", Georgia, serif', googleFont: true, weights: [400, 700], category: 'serif' },
  { label: 'Merriweather', family: 'Merriweather', value: 'Merriweather, Georgia, serif', googleFont: true, weights: [400, 700], category: 'serif' },
  { label: 'Lora', family: 'Lora', value: 'Lora, Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Source Serif 4', family: 'Source Serif 4', value: '"Source Serif 4", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Newsreader', family: 'Newsreader', value: 'Newsreader, Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Crimson Pro', family: 'Crimson Pro', value: '"Crimson Pro", Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Bitter', family: 'Bitter', value: 'Bitter, Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Spectral', family: 'Spectral', value: 'Spectral, Georgia, serif', googleFont: true, weights: [400, 500, 600, 700], category: 'serif' },
  { label: 'Georgia (Editorial Serif)', family: 'Georgia', value: 'Georgia, "Times New Roman", serif', googleFont: false, weights: [400, 700], category: 'serif' },

  // ── Monospace (9) ──────────────────────────────────────────────────────────
  { label: 'JetBrains Mono', family: 'JetBrains Mono', value: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Fira Code', family: 'Fira Code', value: '"Fira Code", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'IBM Plex Mono', family: 'IBM Plex Mono', value: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Space Mono', family: 'Space Mono', value: '"Space Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 700], category: 'mono' },
  { label: 'Source Code Pro', family: 'Source Code Pro', value: '"Source Code Pro", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Roboto Mono', family: 'Roboto Mono', value: '"Roboto Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Inconsolata', family: 'Inconsolata', value: 'Inconsolata, ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },
  { label: 'Ubuntu Mono', family: 'Ubuntu Mono', value: '"Ubuntu Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 700], category: 'mono' },
  { label: 'Azeret Mono', family: 'Azeret Mono', value: '"Azeret Mono", ui-monospace, SFMono-Regular, monospace', googleFont: true, weights: [400, 500, 600, 700], category: 'mono' },

  // ── Script & Handwriting (8) ───────────────────────────────────────────────
  { label: 'Caveat', family: 'Caveat', value: 'Caveat, cursive', googleFont: true, weights: [400, 500, 600, 700], category: 'handwriting' },
  { label: 'Dancing Script', family: 'Dancing Script', value: '"Dancing Script", cursive', googleFont: true, weights: [400, 500, 600, 700], category: 'handwriting' },
  { label: 'Pacifico', family: 'Pacifico', value: 'Pacifico, cursive', googleFont: true, weights: [400], category: 'handwriting' },
  { label: 'Satisfy', family: 'Satisfy', value: 'Satisfy, cursive', googleFont: true, weights: [400], category: 'handwriting' },
  { label: 'Permanent Marker', family: 'Permanent Marker', value: '"Permanent Marker", cursive', googleFont: true, weights: [400], category: 'handwriting' },
  { label: 'Kalam', family: 'Kalam', value: 'Kalam, cursive', googleFont: true, weights: [400, 700], category: 'handwriting' },
  { label: 'Shadows Into Light', family: 'Shadows Into Light', value: '"Shadows Into Light", cursive', googleFont: true, weights: [400], category: 'handwriting' },
  { label: 'Indie Flower', family: 'Indie Flower', value: '"Indie Flower", cursive', googleFont: true, weights: [400], category: 'handwriting' },
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
 * Converts a font file name (e.g. "ClashDisplay_Semibold.woff2") into a clean,
 * CSS-safe font-family identifier guaranteed to pass `isSafeFontFamilyName`.
 */
export function sanitizeCustomFontFamilyName(rawName: string): string {
  const withoutExt = rawName.replace(/\.(woff2?|ttf|otf)$/i, '');
  const normalized = withoutExt
    .replace(/[_]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 60)
    .trim();
  return isSafeFontFamilyName(normalized) ? normalized : 'Custom Font';
}

export function formatCustomFontCssStack(familyName: string): string {
  const safe = sanitizeCustomFontFamilyName(familyName);
  return `"${safe}", system-ui, sans-serif`;
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

export function getProjectCustomFontEntries(
  assets: readonly AssetReference[],
): ProjectCustomFontEntry[] {
  const seen = new Set<string>();
  const entries: ProjectCustomFontEntry[] = [];
  for (const asset of assets) {
    if (asset.kind !== 'font') continue;
    const rawName = asset.name.replace(/\.(woff2?|ttf|otf)$/i, '').trim();
    const family = isSafeFontFamilyName(rawName)
      ? rawName
      : sanitizeCustomFontFamilyName(asset.name);
    const key = family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const format = detectFontFormat(asset.mimeType, asset.name);
    entries.push({
      assetId: asset.id,
      family,
      label: `${family} (${format === 'truetype' ? 'TTF' : format === 'opentype' ? 'OTF' : format.toUpperCase()})`,
      value: formatCustomFontCssStack(family),
      format,
      mimeType: asset.mimeType,
    });
  }
  return entries;
}

const SAFE_FONT_DATA_URL_PREFIX = /^data:(?:font\/(?:woff2|woff|ttf|otf|sfnt)|application\/(?:font-woff2|font-woff|x-font-ttf|x-font-truetype|x-font-opentype|vnd\.ms-opentype|font-sfnt|octet-stream));base64,[A-Za-z0-9+/=]+$/;
const SAFE_FONT_RELATIVE_PATH = /^\.\.\/assets\/[a-zA-Z0-9._-]+$|^\/assets\/[a-zA-Z0-9._-]+$/;
const SAFE_FONT_BLOB_URL = /^blob:(?:https?:\/\/[a-zA-Z0-9.:-]+|null)\/[a-zA-Z0-9._-]+$/;

export interface CustomFontFaceCssOptions {
  /** Custom href resolver (e.g. bundled `../assets/...` or `/assets/...` paths for ZIP export). */
  resolveHref?: (asset: AssetReference) => string | null;
  /** 'display' allows in-tab hydrated blob: URLs for Studio/Live Preview; 'portable' emits only self-contained data: or relative asset URLs. */
  mode?: 'display' | 'portable';
}

/**
 * Emits safe `@font-face` CSS rules for embedded project font assets (`kind === 'font'`).
 * Resolves `folio-asset://<sha256>` assets (> 16 KB) via `assetStore` in addition to
 * validated `data:` font URLs and clean relative `assets/` paths.
 */
export function buildCustomFontFaceCss(
  assets: readonly AssetReference[],
  options: CustomFontFaceCssOptions = {},
): string {
  const mode = options.mode ?? 'display';
  const rules: string[] = [];
  for (const asset of assets) {
    if (asset.kind !== 'font') continue;
    const rawName = asset.name.replace(/\.(woff2?|ttf|otf)$/i, '').trim();
    if (!isSafeFontFamilyName(rawName)) continue;
    let href: string | null;
    if (options.resolveHref) {
      href = options.resolveHref(asset);
    } else if (mode === 'portable') {
      href = resolvePortableAssetUrl(asset) ?? (SAFE_FONT_RELATIVE_PATH.test(asset.source.trim()) ? asset.source.trim() : null);
    } else {
      const trimmed = asset.source.trim();
      if (trimmed.startsWith('folio-asset://') || asset.sha256) {
        href = resolveAssetDisplayUrl(asset) ?? resolvePortableAssetUrl(asset);
      } else {
        href = trimmed;
      }
    }
    if (!href) continue;
    const trimmedHref = href.trim();
    const isSafeData = SAFE_FONT_DATA_URL_PREFIX.test(trimmedHref);
    const isSafeRelative = SAFE_FONT_RELATIVE_PATH.test(trimmedHref);
    const isSafeBlob = mode === 'display' && SAFE_FONT_BLOB_URL.test(trimmedHref);
    if (!isSafeData && !isSafeRelative && !isSafeBlob) continue;
    const format = detectFontFormat(asset.mimeType, asset.name);
    rules.push(
      [
        '@font-face {',
        `  font-family: "${rawName}";`,
        `  src: url("${trimmedHref}") format("${format}");`,
        '  font-display: swap;',
        '}',
      ].join('\n'),
    );
  }
  return rules.join('\n\n');
}

const STUDIO_GOOGLE_FONT_LINK_ATTR = 'data-folio-google-fonts';
const STUDIO_GOOGLE_FONT_PREVIEW_LINK_ATTR = 'data-folio-google-fonts-preview';
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
 * Lazily loads a bounded batch of Google Fonts (weight 400 & 600) for live previewing
 * inside the Inspector Font Browser without bloating the main project font link.
 */
export function ensureStudioPreviewGoogleFontsLoaded(families: readonly string[]): string | null {
  const queryParts: string[] = [];
  const seen = new Set<string>();
  for (const raw of families) {
    const entry = GOOGLE_FONT_BY_LOWER.get(extractPrimaryFontFamily(raw).toLowerCase());
    if (!entry || seen.has(entry.family)) continue;
    seen.add(entry.family);
    const encodedName = encodeURIComponent(entry.family).replace(/%20/g, '+');
    const previewWeight = entry.weights.includes(500) ? '400;500' : String(entry.weights[0] ?? 400);
    queryParts.push(`family=${encodedName}:wght@${previewWeight}`);
    if (queryParts.length >= 28) break;
  }
  if (queryParts.length === 0) return null;
  const url = `https://fonts.googleapis.com/css2?${queryParts.join('&')}&display=swap`;
  if (typeof document === 'undefined' || !document.head) return url;
  let link = document.head.querySelector(`link[${STUDIO_GOOGLE_FONT_PREVIEW_LINK_ATTR}]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute(STUDIO_GOOGLE_FONT_PREVIEW_LINK_ATTR, 'true');
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

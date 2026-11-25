/**
 * Pure security sanitization and deterministic identifier helpers for Folio's
 * Code Engine and sandboxed Live Preview.
 */

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, ' ');
}

/**
 * Strictly validates navigation URLs for generated HTML/React anchor elements.
 * Allows relative paths (`/`, `./`, `../`, `#anchor`) and `http:`, `https:`, `mailto:`.
 * Rejects `javascript:`, `data:`, `vbscript:`, and control characters.
 */
export function sanitizeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip ASCII control characters before protocol inspection to prevent obfuscated schemes.
  const cleaned = trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('//')) {
    return null;
  }

  if (
    cleaned.startsWith('#') ||
    cleaned.startsWith('/') ||
    cleaned.startsWith('./') ||
    cleaned.startsWith('../')
  ) {
    return cleaned;
  }

  // Reject protocol-relative URLs or unknown schemes
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    // Plain relative slug like "about" -> prefix with "/"
    if (/^[a-zA-Z0-9._~/?#&=%-]+$/.test(cleaned)) {
      return `/${cleaned.replace(/^\/+/, '')}`;
    }
    return null;
  }

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (!SAFE_URL_PROTOCOLS.has(protocol)) {
    return null;
  }

  try {
    const parsed = new URL(cleaned);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Prevents `</style>` breakout in embedded HTML `<style>` blocks without
 * altering normal CSS declarations.
 */
export function sanitizeCssText(css: string): string {
  return css
    .replace(/<\/style/gi, '<\\/style')
    .replace(/<(\/?)script/gi, '<\\$1script');
}

/**
 * Prevents `</script>` breakout in embedded `<script>` blocks.
 */
export function sanitizeJsText(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * Sanitizes untrusted labels (page names, routes, component names, module paths)
 * before interpolating into CSS block comments (`/* ... *\/`) or JS/TS line comments
 * (`// ...`) so comment terminators or line breaks cannot inject code or CSS rules.
 */
export function sanitizeCommentLabel(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ')
    .replace(/\*\//g, '* /')
    .replace(/\/\*/g, '/ *')
    .replace(/<\/(style|script)/gi, '<\\/$1')
    .trim();
}

/**
 * Sanitizes a single CSS property value (e.g. fill color or font family) so
 * AST string fields cannot inject arbitrary declarations or close blocks.
 */
export function sanitizeCssValue(raw: string, fallback = 'transparent'): string {
  const cleaned = raw.replace(/[\r\n;{}<>\\]/g, '').trim();
  if (!cleaned) return fallback;
  if (/\/\*|\*\/|@import|\b(?:expression|url|javascript|vbscript|data|behavior)\s*[:(]/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-zA-Z0-9+/=\s]+$/i;
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validates dynamic image URLs for runtime overrides and generated exports.
 * Allows `http:`, `https:`, relative paths (`/`, `./`, `../`, excluding `//`),
 * and base64 raster data URIs (png/jpeg/gif/webp/avif).
 * Rejects protocol-relative URLs (`//`), `javascript:`, `vbscript:`, `mailto:`, `#`,
 * `data:text/html`, and `data:image/svg+xml`.
 */
export function sanitizeImageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('//') || cleaned.startsWith('#')) {
    return null;
  }
  if (SAFE_IMAGE_DATA_URI.test(cleaned)) {
    return cleaned;
  }
  if (cleaned.startsWith('/') || cleaned.startsWith('./') || cleaned.startsWith('../')) {
    return cleaned;
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    return /^[a-zA-Z0-9._~/?&=%-]+$/.test(cleaned) ? cleaned : null;
  }
  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (!SAFE_IMAGE_PROTOCOLS.has(protocol)) {
    return null;
  }
  try {
    const parsed = new URL(cleaned);
    if (!SAFE_IMAGE_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Sanitizes a dynamic CSS transform string so untrusted runtime values cannot
 * break out of style rules or invoke `url()` / `expression()` / script schemes.
 */
export function sanitizeCssTransformValue(raw: string | undefined): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[\u0000-\u001F\u007F\r\n;{}<>\\]/g, '').trim();
  if (!cleaned) return '';
  if (/\/\*|\*\/|@import|\b(?:expression|url|javascript|vbscript|data|behavior)\s*[:(]/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export function toKebabCase(input: string, fallback = 'item'): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function toPascalCase(input: string, fallback = 'FolioComponent'): string {
  const parts = input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  const joined = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z_]/.test(joined) ? joined : `${fallback}${joined}`;
}

export function toCamelCase(input: string, fallback = 'prop'): string {
  const pascal = toPascalCase(input, fallback);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toCssClassName(prefix: string, name: string, id: string): string {
  const nameSlug = toKebabCase(name, 'node').slice(0, 28);
  const idSuffix = toKebabCase(id, 'id').slice(-6);
  return `${prefix}-${nameSlug}-${idSuffix}`;
}

export function toThemeSlug(themeName: string): string {
  return toKebabCase(themeName, 'default');
}

export function toPageFileSlug(route: string, name: string): string {
  const normalizedRoute = route.trim().replace(/^\/+|\/+$/g, '');
  if (!normalizedRoute) return 'index';
  return toKebabCase(normalizedRoute.replace(/\//g, '-'), toKebabCase(name, 'page'));
}

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
 * Prevents `</script>`, `<!--`, and `<script` HTML5 script-data breakout
 * in embedded `<script>` blocks and inline JSON payloads.
 */
export function sanitizeJsText(js: string): string {
  return js
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<script/gi, '<\\u0073cript')
    .replace(/<!--/g, '<\\u0021--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const MAX_SAFE_REGEX_PATTERN_LENGTH = 200;
const MAX_SAFE_REGEX_INPUT_LENGTH = 10_000;
const MAX_SAFE_REGEX_NESTING = 6;
const MAX_SAFE_REGEX_QUANTIFIER_BOUND = 100;
const MAX_UNBOUNDED_WILDCARDS_PER_GROUP = 2;

export interface RegexSafetyResult {
  readonly ok: boolean;
  readonly valid: boolean;
  readonly safe: boolean;
  readonly reason?: string;
}

const WILDCARD_CHAR_CLASSES = new Set([
  '[\\s\\S]',
  '[\\S\\s]',
  '[\\d\\D]',
  '[\\D\\d]',
  '[\\w\\W]',
  '[\\W\\w]',
  '[^]',
]);

interface ParsedQuantifier {
  length: number;
  maxVal: number;
  span: number;
  isRepeating: boolean;
  isUnbounded: boolean;
  isNullable: boolean;
  error?: string;
  unsafe?: string;
}

function readQuantifierAt(pattern: string, index: number): ParsedQuantifier | null {
  if (index >= pattern.length) return null;
  const ch = pattern[index];
  if (ch === '+' || ch === '*' || ch === '?') {
    const lazy = pattern[index + 1] === '?' ? 1 : 0;
    return {
      length: 1 + lazy,
      maxVal: ch === '?' ? 1 : Infinity,
      span: ch === '?' ? 1 : Infinity,
      isRepeating: ch === '+' || ch === '*',
      isUnbounded: ch === '+' || ch === '*',
      isNullable: ch === '*' || ch === '?',
    };
  }
  if (ch === '{') {
    const match = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(index));
    if (!match) return null;
    const minVal = Number(match[1]);
    const maxVal = match[2] === undefined ? minVal : match[2] === '' ? Infinity : Number(match[2]);
    if (Number.isFinite(maxVal) && maxVal < minVal) {
      return {
        length: match[0].length,
        maxVal,
        span: 0,
        isRepeating: false,
        isUnbounded: false,
        isNullable: false,
        error: `Invalid quantifier range "{${match[1]},${match[2] ?? ''}}" (max is less than min).`,
      };
    }
    if (
      minVal > MAX_SAFE_REGEX_QUANTIFIER_BOUND ||
      (Number.isFinite(maxVal) && maxVal > MAX_SAFE_REGEX_QUANTIFIER_BOUND)
    ) {
      return {
        length: match[0].length,
        maxVal,
        span: Number.isFinite(maxVal) ? maxVal - minVal : Infinity,
        isRepeating: maxVal > 1,
        isUnbounded: !Number.isFinite(maxVal),
        isNullable: minVal === 0,
        unsafe: `Quantifier repetition bound exceeds maximum safe limit (${MAX_SAFE_REGEX_QUANTIFIER_BOUND}).`,
      };
    }
    const lazy = pattern[index + match[0].length] === '?' ? 1 : 0;
    return {
      length: match[0].length + lazy,
      maxVal,
      span: Number.isFinite(maxVal) ? maxVal - minVal : Infinity,
      isRepeating: maxVal > 1,
      isUnbounded: !Number.isFinite(maxVal),
      isNullable: minVal === 0,
    };
  }
  return null;
}

function sigsOverlap(prevSig: string | null, nextSig: string | null): boolean {
  if (!prevSig || !nextSig) return false;
  return prevSig === 'WILDCARD' || nextSig === 'WILDCARD' || prevSig === nextSig;
}

/**
 * Analyzes a user-authored regex pattern for both syntax validity and ReDoS
 * safety (nested quantifiers including optional-in-loop, quantified or nested
 * alternations, numbered/named backreferences, quantified lookarounds,
 * adjacent overlapping unbounded quantifiers, polynomial wildcard chains, and
 * excessive length/nesting/repetition bounds).
 */
export function analyzeRegexPattern(pattern: string): RegexSafetyResult {
  if (typeof pattern !== 'string' || !pattern) {
    return { ok: false, valid: false, safe: false, reason: 'Regex pattern cannot be empty.' };
  }
  if (pattern.length > MAX_SAFE_REGEX_PATTERN_LENGTH) {
    return {
      ok: false,
      valid: true,
      safe: false,
      reason: `Regex pattern exceeds maximum safe length (${MAX_SAFE_REGEX_PATTERN_LENGTH} characters).`,
    };
  }

  interface GroupFrame {
    hasQuantifier: boolean;
    hasUnboundedQuantifier: boolean;
    quantifierCount: number;
    maxQuantifierSpan: number;
    hasAlternation: boolean;
    isLookaround: boolean;
    seenMandatoryAtom: boolean;
    leadingUnboundedSig: string | null;
    prevUnboundedSig: string | null;
    wildcardUnboundedCount: number;
  }

  const stack: GroupFrame[] = [
    {
      hasQuantifier: false,
      hasUnboundedQuantifier: false,
      quantifierCount: 0,
      maxQuantifierSpan: 0,
      hasAlternation: false,
      isLookaround: false,
      seenMandatoryAtom: false,
      leadingUnboundedSig: null,
      prevUnboundedSig: null,
      wildcardUnboundedCount: 0,
    },
  ];

  const applyAtomQuantifier = (
    frame: GroupFrame,
    atomSig: string,
    quant: ParsedQuantifier | null,
  ): RegexSafetyResult | null => {
    if (!quant) {
      frame.seenMandatoryAtom = true;
      frame.prevUnboundedSig = null;
      return null;
    }
    if (quant.error) return { ok: false, valid: false, safe: false, reason: quant.error };
    if (quant.unsafe) return { ok: false, valid: true, safe: false, reason: quant.unsafe };
    frame.hasQuantifier = true;
    frame.quantifierCount += 1;
    if (quant.isUnbounded) {
      frame.hasUnboundedQuantifier = true;
      frame.maxQuantifierSpan = Infinity;
    } else if (quant.span > frame.maxQuantifierSpan) {
      frame.maxQuantifierSpan = quant.span;
    }
    if (quant.isUnbounded) {
      if (atomSig === 'WILDCARD') {
        frame.wildcardUnboundedCount += 1;
        if (frame.wildcardUnboundedCount > MAX_UNBOUNDED_WILDCARDS_PER_GROUP) {
          return {
            ok: false,
            valid: true,
            safe: false,
            reason: 'Too many unbounded wildcards in one group can cause polynomial backtracking.',
          };
        }
      }
      if (sigsOverlap(frame.prevUnboundedSig, atomSig)) {
        return {
          ok: false,
          valid: true,
          safe: false,
          reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
        };
      }
      if (!frame.seenMandatoryAtom && frame.leadingUnboundedSig === null) {
        frame.leadingUnboundedSig = atomSig;
      }
      frame.prevUnboundedSig = atomSig;
      if (!quant.isNullable) {
        frame.seenMandatoryAtom = true;
      }
    } else if (!quant.isNullable) {
      frame.seenMandatoryAtom = true;
      frame.prevUnboundedSig = null;
    }
    return null;
  };

  let i = 0;

  while (i < pattern.length) {
    const frame = stack[stack.length - 1];
    const ch = pattern[i];

    // Escaped token (literal escape, shorthand class, or forbidden backreference)
    if (ch === '\\') {
      if (i + 1 >= pattern.length) {
        return { ok: false, valid: false, safe: false, reason: 'Trailing backslash at end of regex pattern.' };
      }
      const next = pattern[i + 1];
      if (next >= '1' && next <= '9') {
        return {
          ok: false,
          valid: true,
          safe: false,
          reason: 'Numbered backreferences (\\1-\\9) are disabled to prevent backtracking freezes.',
        };
      }
      if (next === 'k' && pattern[i + 2] === '<') {
        return {
          ok: false,
          valid: true,
          safe: false,
          reason: 'Named backreferences (\\k<...>) are disabled to prevent backtracking freezes.',
        };
      }
      const isZeroWidthBoundary = next === 'b' || next === 'B';
      let tokenLen = 2;
      if (next === 'x' && i + 3 < pattern.length) tokenLen = 4;
      else if (next === 'u') {
        const braceU = /^\\u\{[0-9a-fA-F]+\}/.exec(pattern.slice(i));
        if (braceU) tokenLen = braceU[0].length;
        else if (i + 5 < pattern.length) tokenLen = 6;
      } else if ((next === 'p' || next === 'P') && pattern[i + 2] === '{') {
        const propClose = pattern.indexOf('}', i + 3);
        if (propClose === -1) {
          return { ok: false, valid: false, safe: false, reason: 'Unclosed Unicode property escape.' };
        }
        tokenLen = propClose - i + 1;
      }
      const atomSig = `esc:${pattern.slice(i, i + tokenLen)}`;
      i += tokenLen;

      if (isZeroWidthBoundary) {
        continue;
      }

      const quant = readQuantifierAt(pattern, i);
      if (quant) {
        i += quant.length;
        if (readQuantifierAt(pattern, i)) {
          return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
        }
      }
      const err = applyAtomQuantifier(frame, atomSig, quant);
      if (err) return err;
      continue;
    }

    // Character class `[...]`
    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < pattern.length) {
        if (pattern[j] === '\\') {
          j += 2;
          continue;
        }
        if (pattern[j] === ']') {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) {
        return { ok: false, valid: false, safe: false, reason: 'Unclosed character class "[".' };
      }
      const clsText = pattern.slice(i, j);
      const atomSig = WILDCARD_CHAR_CLASSES.has(clsText) ? 'WILDCARD' : `cls:${clsText}`;
      i = j;

      const quant = readQuantifierAt(pattern, i);
      if (quant) {
        i += quant.length;
        if (readQuantifierAt(pattern, i)) {
          return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
        }
      }
      const err = applyAtomQuantifier(frame, atomSig, quant);
      if (err) return err;
      continue;
    }

    // Group open `(` (capturing, non-capturing `(?:`, lookaround `(?=`/`(?!`/`(?<=`/`(?<!`, named `(?<name>`)
    if (ch === '(') {
      if (stack.length > MAX_SAFE_REGEX_NESTING) {
        return {
          ok: false,
          valid: true,
          safe: false,
          reason: `Regex nesting exceeds maximum safe depth (${MAX_SAFE_REGEX_NESTING}).`,
        };
      }
      let isLookaround = false;
      if (pattern[i + 1] === '?') {
        const p2 = pattern[i + 2];
        if (p2 === ':') {
          i += 3;
        } else if (p2 === '=' || p2 === '!') {
          isLookaround = true;
          i += 3;
        } else if (p2 === '<') {
          const p3 = pattern[i + 3];
          if (p3 === '=' || p3 === '!') {
            isLookaround = true;
            i += 4;
          } else {
            const nameMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)>/.exec(pattern.slice(i + 3));
            if (!nameMatch) {
              return { ok: false, valid: false, safe: false, reason: 'Invalid named capturing group syntax.' };
            }
            i += 3 + nameMatch[0].length;
          }
        } else {
          return { ok: false, valid: false, safe: false, reason: 'Unsupported or invalid group syntax "(?...".' };
        }
      } else {
        i += 1;
      }
      stack.push({
        hasQuantifier: false,
        hasUnboundedQuantifier: false,
        quantifierCount: 0,
        maxQuantifierSpan: 0,
        hasAlternation: false,
        isLookaround,
        seenMandatoryAtom: false,
        leadingUnboundedSig: null,
        prevUnboundedSig: null,
        wildcardUnboundedCount: 0,
      });
      continue;
    }

    // Group close `)`
    if (ch === ')') {
      if (stack.length <= 1) {
        return { ok: false, valid: false, safe: false, reason: 'Unmatched closing parenthesis ")".' };
      }
      const popped = stack.pop()!;
      const parent = stack[stack.length - 1];
      i += 1;

      const quant = readQuantifierAt(pattern, i);
      if (quant) {
        if (quant.error) return { ok: false, valid: false, safe: false, reason: quant.error };
        if (quant.unsafe) return { ok: false, valid: true, safe: false, reason: quant.unsafe };
        i += quant.length;
        if (readQuantifierAt(pattern, i)) {
          return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
        }
        if (quant.isRepeating) {
          if (popped.isLookaround) {
            return { ok: false, valid: true, safe: false, reason: 'Quantified lookaround groups are not allowed.' };
          }
          const isSmallBoundedInner =
            !quant.isUnbounded &&
            quant.maxVal <= 4 &&
            !popped.hasAlternation &&
            !popped.hasUnboundedQuantifier &&
            popped.quantifierCount <= 1 &&
            popped.maxQuantifierSpan <= 4;
          if ((popped.hasQuantifier || popped.hasAlternation) && !isSmallBoundedInner) {
            return {
              ok: false,
              valid: true,
              safe: false,
              reason: 'Nested quantifiers or quantified alternations can cause catastrophic backtracking.',
            };
          }
          parent.hasQuantifier = true;
          parent.quantifierCount += 1;
          if (quant.isUnbounded) {
            parent.hasUnboundedQuantifier = true;
            parent.maxQuantifierSpan = Infinity;
            if (sigsOverlap(parent.prevUnboundedSig, 'GROUP')) {
              return {
                ok: false,
                valid: true,
                safe: false,
                reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
              };
            }
            if (!parent.seenMandatoryAtom && parent.leadingUnboundedSig === null) {
              parent.leadingUnboundedSig = 'GROUP';
            }
            parent.prevUnboundedSig = 'GROUP';
          } else {
            if (quant.span > parent.maxQuantifierSpan) parent.maxQuantifierSpan = quant.span;
            if (!quant.isNullable) {
              parent.seenMandatoryAtom = true;
              parent.prevUnboundedSig = null;
            }
          }
        } else {
          // Optional/single quantifier like `(...)?` or `(...){0,1}` still counts as a quantifier for outer loops
          parent.hasQuantifier = true;
          parent.quantifierCount += 1;
          if (popped.hasUnboundedQuantifier) parent.hasUnboundedQuantifier = true;
          if (quant.span > parent.maxQuantifierSpan) parent.maxQuantifierSpan = quant.span;
          if (popped.maxQuantifierSpan > parent.maxQuantifierSpan) parent.maxQuantifierSpan = popped.maxQuantifierSpan;
          if (!quant.isNullable && !popped.isLookaround) {
            parent.seenMandatoryAtom = true;
            parent.prevUnboundedSig = null;
          }
        }
      } else {
        if (popped.hasQuantifier) parent.hasQuantifier = true;
        if (popped.hasUnboundedQuantifier) parent.hasUnboundedQuantifier = true;
        parent.quantifierCount += popped.quantifierCount;
        if (popped.maxQuantifierSpan > parent.maxQuantifierSpan) {
          parent.maxQuantifierSpan = popped.maxQuantifierSpan;
        }
        if (popped.hasAlternation && !popped.isLookaround) parent.hasAlternation = true;
        if (!popped.isLookaround) {
          if (sigsOverlap(parent.prevUnboundedSig, popped.leadingUnboundedSig)) {
            return {
              ok: false,
              valid: true,
              safe: false,
              reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
            };
          }
          if (!parent.seenMandatoryAtom && parent.leadingUnboundedSig === null && popped.leadingUnboundedSig) {
            parent.leadingUnboundedSig = popped.leadingUnboundedSig;
          }
          if (popped.seenMandatoryAtom) {
            parent.seenMandatoryAtom = true;
            parent.prevUnboundedSig = popped.prevUnboundedSig;
          } else if (popped.prevUnboundedSig !== null) {
            parent.prevUnboundedSig = popped.prevUnboundedSig;
          }
          parent.wildcardUnboundedCount += popped.wildcardUnboundedCount;
          if (parent.wildcardUnboundedCount > MAX_UNBOUNDED_WILDCARDS_PER_GROUP) {
            return {
              ok: false,
              valid: true,
              safe: false,
              reason: 'Too many unbounded wildcards in one group can cause polynomial backtracking.',
            };
          }
        }
      }
      continue;
    }

    // Alternation `|`
    if (ch === '|') {
      frame.hasAlternation = true;
      frame.seenMandatoryAtom = false;
      frame.prevUnboundedSig = null;
      frame.wildcardUnboundedCount = 0;
      i += 1;
      continue;
    }

    // Anchors `^` and `$`
    if (ch === '^' || ch === '$') {
      i += 1;
      continue;
    }

    // Stray quantifier without a preceding quantifiable atom
    const strayQuant = readQuantifierAt(pattern, i);
    if (strayQuant) {
      return {
        ok: false,
        valid: false,
        safe: false,
        reason: `Unexpected quantifier "${ch}" with nothing to repeat.`,
      };
    }

    // Regular literal or wildcard `.`
    const atomSig = ch === '.' ? 'WILDCARD' : `lit:${ch}`;
    i += 1;

    const quant = readQuantifierAt(pattern, i);
    if (quant) {
      i += quant.length;
      if (readQuantifierAt(pattern, i)) {
        return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
      }
    }
    const err = applyAtomQuantifier(frame, atomSig, quant);
    if (err) return err;
  }

  if (stack.length !== 1) {
    return { ok: false, valid: false, safe: false, reason: 'Unclosed opening parenthesis "(".' };
  }

  try {
    new RegExp(pattern);
  } catch (err) {
    return {
      ok: false,
      valid: false,
      safe: false,
      reason: err instanceof Error ? err.message : 'Invalid regular expression syntax.',
    };
  }

  return { ok: true, valid: true, safe: true };
}

/**
 * Checks whether a user-authored regex pattern is syntactically valid and safe
 * from catastrophic/polynomial backtracking.
 */
export function isSafeRegexPattern(pattern: string): boolean {
  return analyzeRegexPattern(pattern).ok;
}

/**
 * Safely tests a string against a user-authored regex pattern with ReDoS
 * and input-length guards.
 */
export function safeRegexTest(pattern: string, input: string): boolean {
  if (!isSafeRegexPattern(pattern)) return false;
  if (typeof input !== 'string' || input.length > MAX_SAFE_REGEX_INPUT_LENGTH) return false;
  try {
    return new RegExp(pattern).test(input);
  } catch {
    return false;
  }
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

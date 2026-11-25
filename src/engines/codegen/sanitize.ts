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

type CharSet = [number, number, number, number, number];

const NON_ASCII_SPACE = 1;
const NON_ASCII_OTHER = 2;
const NON_ASCII_ALL = 3;
const ALL_CHAR_SET: CharSet = [-1, -1, -1, -1, NON_ASCII_ALL];

function createEmptyCharSet(): CharSet {
  return [0, 0, 0, 0, 0];
}

function cloneCharSet(set: CharSet): CharSet {
  return [set[0], set[1], set[2], set[3], set[4]];
}

function addCharCode(set: CharSet, code: number): void {
  if (code < 0) return;
  if (code < 128) {
    set[code >>> 5] |= 1 << (code & 31);
    return;
  }
  const isUnicodeSpace =
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff;
  set[4] |= isUnicodeSpace ? NON_ASCII_SPACE : NON_ASCII_OTHER;
}

function addCharRange(set: CharSet, start: number, end: number): void {
  const lo = Math.max(0, start);
  const asciiHi = Math.min(end, 127);
  for (let code = lo; code <= asciiHi; code += 1) {
    set[code >>> 5] |= 1 << (code & 31);
  }
  if (end >= 128) {
    set[4] |= NON_ASCII_ALL;
  }
}

function unionCharSets(a: CharSet | null, b: CharSet | null): CharSet | null {
  if (!a) return b ? cloneCharSet(b) : null;
  if (!b) return cloneCharSet(a);
  return [a[0] | b[0], a[1] | b[1], a[2] | b[2], a[3] | b[3], a[4] | b[4]];
}

function invertCharSet(set: CharSet): CharSet {
  return [~set[0], ~set[1], ~set[2], ~set[3], ~set[4] & NON_ASCII_ALL];
}

function charSetsOverlap(a: CharSet | null, b: CharSet | null): boolean {
  if (!a || !b) return false;
  return (
    ((a[0] & b[0]) | (a[1] & b[1]) | (a[2] & b[2]) | (a[3] & b[3]) | (a[4] & b[4])) !== 0
  );
}

const DOT_CHAR_SET: CharSet = (() => {
  const set: CharSet = [-1, -1, -1, -1, NON_ASCII_ALL];
  set[0] &= ~((1 << 10) | (1 << 13)); // Exclude \n (10) and \r (13)
  return set;
})();

const DIGIT_CHAR_SET: CharSet = (() => {
  const set = createEmptyCharSet();
  addCharRange(set, 48, 57);
  return set;
})();

const WORD_CHAR_SET: CharSet = (() => {
  const set = createEmptyCharSet();
  addCharRange(set, 48, 57);
  addCharRange(set, 65, 90);
  addCharRange(set, 97, 122);
  addCharCode(set, 95);
  return set;
})();

const SPACE_CHAR_SET: CharSet = (() => {
  const set = createEmptyCharSet();
  for (const code of [9, 10, 11, 12, 13, 32]) addCharCode(set, code);
  set[4] = NON_ASCII_SPACE;
  return set;
})();

const NOT_DIGIT_CHAR_SET: CharSet = invertCharSet(DIGIT_CHAR_SET);
const NOT_WORD_CHAR_SET: CharSet = invertCharSet(WORD_CHAR_SET);
const NOT_SPACE_CHAR_SET: CharSet = invertCharSet(SPACE_CHAR_SET);

function isWildcardCharSet(set: CharSet): boolean {
  const dotMask0 = DOT_CHAR_SET[0];
  return (
    (set[0] & dotMask0) === dotMask0 &&
    set[1] === -1 &&
    set[2] === -1 &&
    set[3] === -1 &&
    set[4] === NON_ASCII_ALL
  );
}

interface ParsedEscapeToken {
  length: number;
  set: CharSet;
  singleCode: number | null;
  error?: string;
}

function parseEscapeToken(pattern: string, index: number, inCharClass: boolean): ParsedEscapeToken {
  const next = pattern[index + 1];
  switch (next) {
    case 'd':
      return { length: 2, set: cloneCharSet(DIGIT_CHAR_SET), singleCode: null };
    case 'D':
      return { length: 2, set: cloneCharSet(NOT_DIGIT_CHAR_SET), singleCode: null };
    case 'w':
      return { length: 2, set: cloneCharSet(WORD_CHAR_SET), singleCode: null };
    case 'W':
      return { length: 2, set: cloneCharSet(NOT_WORD_CHAR_SET), singleCode: null };
    case 's':
      return { length: 2, set: cloneCharSet(SPACE_CHAR_SET), singleCode: null };
    case 'S':
      return { length: 2, set: cloneCharSet(NOT_SPACE_CHAR_SET), singleCode: null };
    case 't': {
      const set = createEmptyCharSet();
      addCharCode(set, 9);
      return { length: 2, set, singleCode: 9 };
    }
    case 'n': {
      const set = createEmptyCharSet();
      addCharCode(set, 10);
      return { length: 2, set, singleCode: 10 };
    }
    case 'v': {
      const set = createEmptyCharSet();
      addCharCode(set, 11);
      return { length: 2, set, singleCode: 11 };
    }
    case 'f': {
      const set = createEmptyCharSet();
      addCharCode(set, 12);
      return { length: 2, set, singleCode: 12 };
    }
    case 'r': {
      const set = createEmptyCharSet();
      addCharCode(set, 13);
      return { length: 2, set, singleCode: 13 };
    }
    case '0': {
      const set = createEmptyCharSet();
      addCharCode(set, 0);
      return { length: 2, set, singleCode: 0 };
    }
    case 'b': {
      const set = createEmptyCharSet();
      if (inCharClass) {
        addCharCode(set, 8);
        return { length: 2, set, singleCode: 8 };
      }
      return { length: 2, set, singleCode: null };
    }
    case 'x': {
      const hex = /^[0-9a-fA-F]{2}/.exec(pattern.slice(index + 2));
      if (hex) {
        const code = Number.parseInt(hex[0], 16);
        const set = createEmptyCharSet();
        addCharCode(set, code);
        return { length: 4, set, singleCode: code };
      }
      break;
    }
    case 'u': {
      const braceU = /^\\u\{([0-9a-fA-F]+)\}/.exec(pattern.slice(index));
      if (braceU) {
        const code = Number.parseInt(braceU[1], 16);
        const set = createEmptyCharSet();
        addCharCode(set, code);
        return { length: braceU[0].length, set, singleCode: code };
      }
      const hex4 = /^[0-9a-fA-F]{4}/.exec(pattern.slice(index + 2));
      if (hex4) {
        const code = Number.parseInt(hex4[0], 16);
        const set = createEmptyCharSet();
        addCharCode(set, code);
        return { length: 6, set, singleCode: code };
      }
      break;
    }
    case 'p':
    case 'P': {
      if (pattern[index + 2] === '{') {
        const propClose = pattern.indexOf('}', index + 3);
        if (propClose === -1) {
          return {
            length: 2,
            set: cloneCharSet(ALL_CHAR_SET),
            singleCode: null,
            error: 'Unclosed Unicode property escape.',
          };
        }
        return {
          length: propClose - index + 1,
          set: cloneCharSet(ALL_CHAR_SET),
          singleCode: null,
        };
      }
      break;
    }
    case 'c': {
      const ctrl = pattern[index + 2];
      if (ctrl && /[A-Za-z]/.test(ctrl)) {
        const code = ctrl.charCodeAt(0) % 32;
        const set = createEmptyCharSet();
        addCharCode(set, code);
        return { length: 3, set, singleCode: code };
      }
      break;
    }
    default:
      break;
  }
  const code = next.charCodeAt(0);
  const set = createEmptyCharSet();
  addCharCode(set, code);
  return { length: 2, set, singleCode: code };
}

function parseCharClass(
  pattern: string,
  startIndex: number,
): { endIndex: number; set: CharSet; isWildcard: boolean; error?: string } {
  let j = startIndex + 1;
  const negated = pattern[j] === '^';
  if (negated) j += 1;

  const set = createEmptyCharSet();
  let closed = false;
  let prevSingleCode: number | null = null;
  let pendingRange = false;

  while (j < pattern.length) {
    const ch = pattern[j];
    if (ch === ']') {
      if (pendingRange) {
        addCharCode(set, 45); // trailing '-' is literal
      }
      closed = true;
      j += 1;
      break;
    }
    if (ch === '-' && prevSingleCode !== null && !pendingRange && pattern[j + 1] !== ']') {
      pendingRange = true;
      j += 1;
      continue;
    }

    let tokenSet: CharSet;
    let singleCode: number | null;
    if (ch === '\\') {
      if (j + 1 >= pattern.length) {
        return {
          endIndex: j,
          set,
          isWildcard: false,
          error: 'Unclosed character class "[".',
        };
      }
      const esc = parseEscapeToken(pattern, j, true);
      if (esc.error) {
        return { endIndex: j, set, isWildcard: false, error: esc.error };
      }
      tokenSet = esc.set;
      singleCode = esc.singleCode;
      j += esc.length;
    } else {
      singleCode = ch.charCodeAt(0);
      tokenSet = createEmptyCharSet();
      addCharCode(tokenSet, singleCode);
      j += 1;
    }

    if (pendingRange) {
      if (prevSingleCode !== null && singleCode !== null && singleCode >= prevSingleCode) {
        addCharRange(set, prevSingleCode, singleCode);
      } else {
        addCharCode(set, 45);
        for (let k = 0; k < 5; k += 1) set[k] |= tokenSet[k];
      }
      prevSingleCode = null;
      pendingRange = false;
    } else {
      for (let k = 0; k < 5; k += 1) set[k] |= tokenSet[k];
      prevSingleCode = singleCode;
    }
  }

  if (!closed) {
    return { endIndex: j, set, isWildcard: false, error: 'Unclosed character class "[".' };
  }

  const finalSet = negated ? invertCharSet(set) : set;
  const clsText = pattern.slice(startIndex, j);
  const isWildcard = WILDCARD_CHAR_CLASSES.has(clsText) || isWildcardCharSet(finalSet);
  return { endIndex: j, set: finalSet, isWildcard };
}

/**
 * Analyzes a user-authored regex pattern for both syntax validity and ReDoS
 * safety (nested quantifiers including optional-in-loop, quantified or nested
 * alternations, numbered/named backreferences, quantified lookarounds,
 * adjacent overlapping unbounded quantifiers across character classes/shorthands/groups,
 * polynomial wildcard chains, and excessive length/nesting/repetition bounds).
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
    leadingUnboundedSet: CharSet | null;
    trailingUnboundedSet: CharSet | null;
    altLeadingSet: CharSet | null;
    altTrailingSet: CharSet | null;
    altAllMandatory: boolean;
    groupCharSet: CharSet | null;
    wildcardUnboundedCount: number;
  }

  const makeFrame = (isLookaround: boolean): GroupFrame => ({
    hasQuantifier: false,
    hasUnboundedQuantifier: false,
    quantifierCount: 0,
    maxQuantifierSpan: 0,
    hasAlternation: false,
    isLookaround,
    seenMandatoryAtom: false,
    leadingUnboundedSet: null,
    trailingUnboundedSet: null,
    altLeadingSet: null,
    altTrailingSet: null,
    altAllMandatory: true,
    groupCharSet: null,
    wildcardUnboundedCount: 0,
  });

  const stack: GroupFrame[] = [makeFrame(false)];

  const applyAtomQuantifier = (
    frame: GroupFrame,
    atomSet: CharSet,
    isWildcard: boolean,
    quant: ParsedQuantifier | null,
  ): RegexSafetyResult | null => {
    frame.groupCharSet = unionCharSets(frame.groupCharSet, atomSet);
    if (!quant) {
      frame.seenMandatoryAtom = true;
      frame.trailingUnboundedSet = null;
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
      if (isWildcard) {
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
      if (charSetsOverlap(frame.trailingUnboundedSet, atomSet)) {
        return {
          ok: false,
          valid: true,
          safe: false,
          reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
        };
      }
      if (!frame.seenMandatoryAtom) {
        frame.leadingUnboundedSet = unionCharSets(frame.leadingUnboundedSet, atomSet);
      }
      if (quant.isNullable) {
        frame.trailingUnboundedSet = unionCharSets(frame.trailingUnboundedSet, atomSet);
      } else {
        frame.seenMandatoryAtom = true;
        frame.trailingUnboundedSet = cloneCharSet(atomSet);
      }
    } else if (!quant.isNullable) {
      frame.seenMandatoryAtom = true;
      frame.trailingUnboundedSet = null;
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
      const esc = parseEscapeToken(pattern, i, false);
      if (esc.error) {
        return { ok: false, valid: false, safe: false, reason: esc.error };
      }
      i += esc.length;

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
      const err = applyAtomQuantifier(frame, esc.set, isWildcardCharSet(esc.set), quant);
      if (err) return err;
      continue;
    }

    // Character class `[...]`
    if (ch === '[') {
      const parsedClass = parseCharClass(pattern, i);
      if (parsedClass.error) {
        return { ok: false, valid: false, safe: false, reason: parsedClass.error };
      }
      i = parsedClass.endIndex;

      const quant = readQuantifierAt(pattern, i);
      if (quant) {
        i += quant.length;
        if (readQuantifierAt(pattern, i)) {
          return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
        }
      }
      const err = applyAtomQuantifier(frame, parsedClass.set, parsedClass.isWildcard, quant);
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
      stack.push(makeFrame(isLookaround));
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

      const poppedLeading = unionCharSets(popped.altLeadingSet, popped.leadingUnboundedSet);
      const poppedTrailing = unionCharSets(popped.altTrailingSet, popped.trailingUnboundedSet);
      const poppedAllMandatory = popped.altAllMandatory && popped.seenMandatoryAtom;
      const poppedGroupSet = popped.groupCharSet ?? cloneCharSet(ALL_CHAR_SET);

      if (!popped.isLookaround && popped.groupCharSet) {
        parent.groupCharSet = unionCharSets(parent.groupCharSet, popped.groupCharSet);
      }

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
            if (isWildcardCharSet(poppedGroupSet)) {
              parent.wildcardUnboundedCount += 1;
              if (parent.wildcardUnboundedCount > MAX_UNBOUNDED_WILDCARDS_PER_GROUP) {
                return {
                  ok: false,
                  valid: true,
                  safe: false,
                  reason: 'Too many unbounded wildcards in one group can cause polynomial backtracking.',
                };
              }
            }
            if (charSetsOverlap(parent.trailingUnboundedSet, poppedGroupSet)) {
              return {
                ok: false,
                valid: true,
                safe: false,
                reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
              };
            }
            if (!parent.seenMandatoryAtom) {
              parent.leadingUnboundedSet = unionCharSets(parent.leadingUnboundedSet, poppedGroupSet);
            }
            if (quant.isNullable) {
              parent.trailingUnboundedSet = unionCharSets(parent.trailingUnboundedSet, poppedGroupSet);
            } else {
              parent.seenMandatoryAtom = true;
              parent.trailingUnboundedSet = cloneCharSet(poppedGroupSet);
            }
          } else {
            if (quant.span > parent.maxQuantifierSpan) parent.maxQuantifierSpan = quant.span;
            if (!quant.isNullable && poppedAllMandatory) {
              parent.seenMandatoryAtom = true;
              parent.trailingUnboundedSet = null;
            }
          }
        } else {
          // Optional/single quantifier like `(...)?` or `(...){0,1}` still counts as a quantifier for outer loops
          parent.hasQuantifier = true;
          parent.quantifierCount += 1;
          if (popped.hasUnboundedQuantifier) parent.hasUnboundedQuantifier = true;
          if (quant.span > parent.maxQuantifierSpan) parent.maxQuantifierSpan = quant.span;
          if (popped.maxQuantifierSpan > parent.maxQuantifierSpan) parent.maxQuantifierSpan = popped.maxQuantifierSpan;
          if (!popped.isLookaround) {
            if (charSetsOverlap(parent.trailingUnboundedSet, poppedLeading)) {
              return {
                ok: false,
                valid: true,
                safe: false,
                reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
              };
            }
            if (!parent.seenMandatoryAtom) {
              parent.leadingUnboundedSet = unionCharSets(parent.leadingUnboundedSet, poppedLeading);
            }
            if (!quant.isNullable && poppedAllMandatory) {
              parent.seenMandatoryAtom = true;
              parent.trailingUnboundedSet = poppedTrailing;
            } else {
              parent.trailingUnboundedSet = unionCharSets(parent.trailingUnboundedSet, poppedTrailing);
            }
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
          if (charSetsOverlap(parent.trailingUnboundedSet, poppedLeading)) {
            return {
              ok: false,
              valid: true,
              safe: false,
              reason: 'Adjacent overlapping unbounded quantifiers can cause polynomial backtracking.',
            };
          }
          if (!parent.seenMandatoryAtom) {
            parent.leadingUnboundedSet = unionCharSets(parent.leadingUnboundedSet, poppedLeading);
          }
          if (poppedAllMandatory) {
            parent.seenMandatoryAtom = true;
            parent.trailingUnboundedSet = poppedTrailing;
          } else {
            parent.trailingUnboundedSet = unionCharSets(parent.trailingUnboundedSet, poppedTrailing);
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
      frame.altLeadingSet = unionCharSets(frame.altLeadingSet, frame.leadingUnboundedSet);
      frame.altTrailingSet = unionCharSets(frame.altTrailingSet, frame.trailingUnboundedSet);
      frame.altAllMandatory = frame.altAllMandatory && frame.seenMandatoryAtom;
      frame.seenMandatoryAtom = false;
      frame.leadingUnboundedSet = null;
      frame.trailingUnboundedSet = null;
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
    let atomSet: CharSet;
    const isDot = ch === '.';
    if (isDot) {
      atomSet = cloneCharSet(DOT_CHAR_SET);
    } else {
      atomSet = createEmptyCharSet();
      addCharCode(atomSet, ch.charCodeAt(0));
    }
    i += 1;

    const quant = readQuantifierAt(pattern, i);
    if (quant) {
      i += quant.length;
      if (readQuantifierAt(pattern, i)) {
        return { ok: false, valid: false, safe: false, reason: 'Stacked quantifiers are not allowed.' };
      }
    }
    const err = applyAtomQuantifier(frame, atomSet, isDot, quant);
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

/**
 * Pure CSS unit parsing, safe arithmetic evaluation, and CSS safety validators
 * powering Folio's NumericUnitInput and Dual-Mode Frame codegen.
 */

export type CssLengthUnit =
  | 'px'
  | '%'
  | 'vw'
  | 'vh'
  | 'dvh'
  | 'rem'
  | 'em'
  | 'fr'
  | 'deg'
  | 'ms'
  | 's'
  | '';

export type CssKeywordUnit = 'auto' | 'fit' | 'fill';
export type CssUnitOption = CssLengthUnit | CssKeywordUnit;

export interface CssLengthValue {
  readonly value: number;
  readonly unit: CssLengthUnit;
}

export interface NumericUnitParseOptions {
  readonly allowedUnits: readonly CssUnitOption[];
  readonly fallbackUnit: CssUnitOption;
  readonly min?: number;
  readonly max?: number;
  readonly allowNegative?: boolean;
  readonly precision?: number;
}

export type ParsedNumericUnitResult =
  | { readonly ok: true; readonly kind: 'numeric'; readonly value: number; readonly unit: CssLengthUnit }
  | { readonly ok: true; readonly kind: 'keyword'; readonly keyword: CssKeywordUnit }
  | { readonly ok: false; readonly reason: string };

export const CSS_LENGTH_UNITS: ReadonlySet<string> = new Set<CssLengthUnit>([
  'px',
  '%',
  'vw',
  'vh',
  'dvh',
  'rem',
  'em',
  'fr',
  'deg',
  'ms',
  's',
  '',
]);

export const CSS_KEYWORD_UNITS: ReadonlySet<string> = new Set<CssKeywordUnit>([
  'auto',
  'fit',
  'fill',
]);

const UNSAFE_CSS_PATTERN = /[;{}<>\\"'`]|\/\*|\*\/|url\s*\(|expression\s*\(|javascript:/i;

/**
 * Checks whether a value is a valid CssLengthUnit.
 */
export function isCssLengthUnit(value: unknown): value is CssLengthUnit {
  return typeof value === 'string' && CSS_LENGTH_UNITS.has(value);
}

/**
 * Checks whether an unknown object is a valid CssLengthValue.
 */
export function isCssLengthValue(value: unknown): value is CssLengthValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.value === 'number'
    && Number.isFinite(record.value)
    && isCssLengthUnit(record.unit)
  );
}

export function roundNumericValue(value: number, precision = 2): number {
  const factor = 10 ** Math.max(0, Math.min(6, Math.round(precision)));
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Formats a CssLengthValue (or plain px number) into a clean CSS string.
 */
export function formatCssLengthValue(
  input: CssLengthValue | number,
  defaultUnit: CssLengthUnit = 'px',
): string {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return `0${defaultUnit}`;
    const rounded = roundNumericValue(input, 2);
    return `${rounded}${defaultUnit}`;
  }
  const rounded = roundNumericValue(input.value, 2);
  return `${rounded}${input.unit}`;
}

/**
 * Safe recursive-descent arithmetic evaluator supporting +, -, *, /, unary +/-, and parentheses.
 * Never invokes eval or Function.
 */
export function evaluateSimpleMathExpression(raw: string): number | null {
  const input = raw.trim();
  if (!input || input.length > 64) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(input)) return null;

  let index = 0;

  const skipSpaces = (): void => {
    while (index < input.length && input[index] === ' ') {
      index += 1;
    }
  };

  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (true) {
      skipSpaces();
      const ch = input[index];
      if (ch === '+' || ch === '-') {
        index += 1;
        const right = parseTerm();
        if (right === null) return null;
        left = ch === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return Number.isFinite(left) ? left : null;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    while (true) {
      skipSpaces();
      const ch = input[index];
      if (ch === '*' || ch === '/') {
        index += 1;
        const right = parseFactor();
        if (right === null) return null;
        if (ch === '/') {
          if (Math.abs(right) < 1e-12) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return Number.isFinite(left) ? left : null;
  };

  const parseFactor = (): number | null => {
    skipSpaces();
    const ch = input[index];
    if (ch === '+') {
      index += 1;
      return parseFactor();
    }
    if (ch === '-') {
      index += 1;
      const val = parseFactor();
      return val === null ? null : -val;
    }
    if (ch === '(') {
      index += 1;
      const inner = parseExpression();
      skipSpaces();
      if (inner === null || input[index] !== ')') return null;
      index += 1;
      return inner;
    }
    return parseNumber();
  };

  const parseNumber = (): number | null => {
    skipSpaces();
    const start = index;
    let hasDigits = false;
    let hasDot = false;
    while (index < input.length) {
      const ch = input[index];
      if (ch >= '0' && ch <= '9') {
        hasDigits = true;
        index += 1;
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        index += 1;
      } else {
        break;
      }
    }
    if (!hasDigits) return null;
    const parsed = Number(input.slice(start, index));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const result = parseExpression();
  skipSpaces();
  if (result === null || index !== input.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

const KNOWN_UNIT_SUFFIXES: readonly CssLengthUnit[] = [
  'dvh',
  'rem',
  'deg',
  'px',
  'vw',
  'vh',
  'em',
  'fr',
  'ms',
  '%',
  's',
];

/**
 * Parses user text inside NumericUnitInput:
 * - Supports plain decimals and negative values (when allowed).
 * - Smart-pastes unit-bearing strings (e.g., "100vh", "50%", "1.5rem", "240px").
 * - Evaluates simple inline math (e.g., "100/3" -> 33.33, "100/3%" -> 33.33%).
 * - Recognizes allowed keywords ("auto", "fit", "fill").
 * - Enforces CSS safety validation and min/max bounds.
 */
export function parseNumericUnitInput(
  raw: string,
  options: NumericUnitParseOptions,
): ParsedNumericUnitResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty input' };
  }
  if (trimmed.length > 64 || UNSAFE_CSS_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'Unsafe CSS syntax' };
  }

  const lower = trimmed.toLowerCase();
  const normalizedKeyword: CssKeywordUnit | null =
    lower === 'auto'
      ? 'auto'
      : lower === 'fit' || lower === 'fit-content' || lower === 'hug'
        ? 'fit'
        : lower === 'fill' || lower === 'fill-container'
          ? 'fill'
          : null;

  if (normalizedKeyword !== null) {
    if (options.allowedUnits.includes(normalizedKeyword)) {
      return { ok: true, kind: 'keyword', keyword: normalizedKeyword };
    }
    return { ok: false, reason: `Keyword "${normalizedKeyword}" is not allowed for this property` };
  }

  // Detect optional trailing unit suffix (smart paste / fallback)
  let exprPart = trimmed;
  let detectedUnit: CssLengthUnit | null = null;

  for (const suffix of KNOWN_UNIT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      const candidateExpr = trimmed.slice(0, trimmed.length - suffix.length).trim();
      // Guard against empty expression before suffix (e.g., just "px")
      if (candidateExpr.length > 0 && /[0-9)]$/.test(candidateExpr)) {
        if (!options.allowedUnits.includes(suffix)) {
          return { ok: false, reason: `Unit "${suffix}" is not allowed for this property` };
        }
        detectedUnit = suffix;
        exprPart = candidateExpr;
        break;
      }
    }
  }

  const evaluated = evaluateSimpleMathExpression(exprPart);
  if (evaluated === null) {
    return { ok: false, reason: 'Invalid numeric expression' };
  }

  const allowNegative = options.allowNegative ?? (options.min !== undefined ? options.min < 0 : false);
  if (!allowNegative && evaluated < 0) {
    return { ok: false, reason: 'Negative values are not allowed' };
  }

  let value = roundNumericValue(evaluated, options.precision ?? 2);
  if (options.min !== undefined && value < options.min) {
    value = options.min;
  }
  if (options.max !== undefined && value > options.max) {
    value = options.max;
  }

  let targetUnit: CssLengthUnit;
  if (detectedUnit !== null) {
    targetUnit = detectedUnit;
  } else if (isCssLengthUnit(options.fallbackUnit)) {
    targetUnit = options.fallbackUnit;
  } else {
    const firstNumericUnit = options.allowedUnits.find(isCssLengthUnit);
    if (firstNumericUnit === undefined) {
      return { ok: false, reason: 'No numeric unit available' };
    }
    targetUnit = firstNumericUnit;
  }

  return {
    ok: true,
    kind: 'numeric',
    value,
    unit: targetUnit,
  };
}

/**
 * Validates custom CSS Grid template strings (e.g. "240px 1fr 300px", "repeat(auto-fit, minmax(220px, 1fr))").
 */
export function isSafeCssGridTemplate(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (UNSAFE_CSS_PATTERN.test(trimmed)) return false;
  if (!/^[a-zA-Z0-9.%(),\s-]+$/.test(trimmed)) return false;

  // Verify balanced parentheses
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  if (depth !== 0) return false;

  // Allow only safe CSS Grid function names
  const fnMatches = trimmed.match(/([a-zA-Z-]+)\s*\(/g) ?? [];
  const allowedFns = new Set(['repeat', 'minmax', 'fit-content', 'clamp', 'min', 'max']);
  for (const fnMatch of fnMatches) {
    const fnName = fnMatch.replace(/\s*\($/, '').toLowerCase();
    if (!allowedFns.has(fnName)) return false;
  }

  return true;
}

/**
 * Validates and normalizes CSS aspect-ratio strings ("auto", "16:9", "16 / 9", "1.5").
 */
export function normalizeCssAspectRatio(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 32) return null;
  if (trimmed === 'auto') return 'auto';
  const ratioMatch = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (ratioMatch) {
    const w = Number(ratioMatch[1]);
    const h = Number(ratioMatch[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return `${roundNumericValue(w, 3)} / ${roundNumericValue(h, 3)}`;
  }
  const single = Number(trimmed);
  if (Number.isFinite(single) && single > 0 && single <= 100) {
    return `${roundNumericValue(single, 3)}`;
  }
  return null;
}

export function isSafeCssAspectRatio(raw: string): boolean {
  return normalizeCssAspectRatio(raw) !== null;
}

export function parseAspectRatioNumeric(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalized = normalizeCssAspectRatio(raw);
  if (!normalized || normalized === 'auto') return null;
  const parts = normalized.split('/').map((s) => Number(s.trim()));
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    return parts[0] / parts[1];
  }
  if (parts.length === 1 && parts[0] > 0) {
    return parts[0];
  }
  return null;
}

export function isSafeHtmlId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^[A-Za-z_][A-Za-z0-9_:-]{0,63}$/.test(trimmed);
}

export function isSafeHtmlClassName(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.length > 256) return false;
  return trimmed.split(/\s+/).every((token) => /^-?[A-Za-z_][A-Za-z0-9_:/[\]-]{0,63}$/.test(token));
}

export function isSafeCssColorString(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128 || UNSAFE_CSS_PATTERN.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'transparent' || lower === 'none' || lower === 'currentcolor') return true;
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return true;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return true;
  if (/^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return true;
  if (/^var\(--[a-zA-Z0-9_-]{1,64}\)$/.test(trimmed)) return true;
  return false;
}

/**
 * Pure, framework-independent CSS Transform visual parser and serializer for
 * Node Logic's `action.set-layer` (property: `transform`) Visual Mode & CSS Mode.
 *
 * Keeps Visual Mode controls (Move X/Y, Rotate, Scale) and manual CSS Mode
 * synchronized against the exact same `node.data.transform` string while
 * preserving unsupported/advanced CSS transform syntax losslessly in CSS Mode.
 */

export interface TransformVisualValues {
  readonly translateX: number;
  readonly translateY: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly uniformScale: boolean;
}

export interface ParsedCssTransformVisual {
  readonly supported: boolean;
  readonly values: TransformVisualValues;
}

export const DEFAULT_TRANSFORM_VISUAL_VALUES: TransformVisualValues = Object.freeze({
  translateX: 0,
  translateY: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  uniformScale: true,
});

function roundTransformNumber(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parsePxToken(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;
  if (/^[+-]?(?:0(?:\.0+)?|\.0+)$/.test(token)) return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))px$/i.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? roundTransformNumber(num) : null;
}

function parseDegToken(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;
  if (/^[+-]?(?:0(?:\.0+)?|\.0+)$/.test(token)) return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))deg$/i.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? roundTransformNumber(num) : null;
}

function parseScaleToken(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))$/.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? roundTransformNumber(num, 3) : null;
}

function splitCssArgs(rawArgs: string): string[] {
  return rawArgs
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parses a CSS `transform` string into Visual Mode fields.
 * Returns `{ supported: false, values: DEFAULT_TRANSFORM_VISUAL_VALUES }` when
 * advanced/custom functions (e.g. `matrix()`, `skew()`, `perspective()`, `%`,
 * `calc()`) are present so CSS Mode remains lossless and authoritative.
 */
export function parseCssTransformForVisual(
  raw: string | undefined | null,
): ParsedCssTransformVisual {
  if (typeof raw !== 'string') {
    return { supported: true, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return { supported: true, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
  }

  let translateX = 0;
  let translateY = 0;
  let rotate = 0;
  let scaleX = 1;
  let scaleY = 1;
  let hasTx = false;
  let hasTy = false;
  let hasRotate = false;
  let hasSx = false;
  let hasSy = false;

  const tokenRe = /([a-zA-Z0-9_-]+)\s*\(([^()]*)\)/g;
  let consumed = '';
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(trimmed)) !== null) {
    const leading = trimmed.slice(consumed.length, match.index);
    if (leading.trim().length > 0) {
      return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
    }
    consumed = trimmed.slice(0, match.index + match[0].length);

    const fn = match[1].toLowerCase();
    const args = splitCssArgs(match[2]);
    if (args.length === 0) {
      return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
    }

    if (fn === 'translate') {
      if (args.length > 2 || hasTx || (args.length === 2 && hasTy)) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const x = parsePxToken(args[0]);
      const y = args.length === 2 ? parsePxToken(args[1]) : 0;
      if (x === null || y === null) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      translateX = x;
      translateY = y;
      hasTx = true;
      if (args.length === 2) hasTy = true;
    } else if (fn === 'translatex') {
      if (args.length !== 1 || hasTx) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const x = parsePxToken(args[0]);
      if (x === null) return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      translateX = x;
      hasTx = true;
    } else if (fn === 'translatey') {
      if (args.length !== 1 || hasTy) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const y = parsePxToken(args[0]);
      if (y === null) return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      translateY = y;
      hasTy = true;
    } else if (fn === 'rotate' || fn === 'rotatez') {
      if (args.length !== 1 || hasRotate) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const deg = parseDegToken(args[0]);
      if (deg === null) return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      rotate = deg;
      hasRotate = true;
    } else if (fn === 'scale') {
      if (args.length > 2 || hasSx || hasSy) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const sx = parseScaleToken(args[0]);
      const sy = args.length === 2 ? parseScaleToken(args[1]) : sx;
      if (sx === null || sy === null) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      scaleX = sx;
      scaleY = sy;
      hasSx = true;
      hasSy = true;
    } else if (fn === 'scalex') {
      if (args.length !== 1 || hasSx) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const sx = parseScaleToken(args[0]);
      if (sx === null) return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      scaleX = sx;
      hasSx = true;
    } else if (fn === 'scaley') {
      if (args.length !== 1 || hasSy) {
        return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      }
      const sy = parseScaleToken(args[0]);
      if (sy === null) return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
      scaleY = sy;
      hasSy = true;
    } else {
      return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
    }
  }

  if (consumed.length === 0 || trimmed.slice(consumed.length).trim().length > 0) {
    return { supported: false, values: { ...DEFAULT_TRANSFORM_VISUAL_VALUES } };
  }

  return {
    supported: true,
    values: {
      translateX,
      translateY,
      rotate,
      scaleX,
      scaleY,
      uniformScale: Math.abs(scaleX - scaleY) < 0.0005,
    },
  };
}

/**
 * Serializes Visual Mode transform values into a clean, canonical CSS transform string.
 */
export function serializeVisualTransformToCss(values: TransformVisualValues): string {
  const tx = roundTransformNumber(values.translateX);
  const ty = roundTransformNumber(values.translateY);
  const rot = roundTransformNumber(values.rotate);
  const sx = roundTransformNumber(values.scaleX, 3);
  const sy = roundTransformNumber(values.uniformScale ? values.scaleX : values.scaleY, 3);

  const parts: string[] = [];
  if (tx !== 0 && ty !== 0) {
    parts.push(`translate(${tx}px, ${ty}px)`);
  } else if (tx !== 0) {
    parts.push(`translateX(${tx}px)`);
  } else if (ty !== 0) {
    parts.push(`translateY(${ty}px)`);
  }

  if (rot !== 0) {
    parts.push(`rotate(${rot}deg)`);
  }

  if (Math.abs(sx - 1) >= 0.0005 || Math.abs(sy - 1) >= 0.0005) {
    if (Math.abs(sx - sy) < 0.0005) {
      parts.push(`scale(${sx})`);
    } else {
      parts.push(`scale(${sx}, ${sy})`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : 'scale(1)';
}

/**
 * Computes pixel delta from an initial canvas position to a dragged target position.
 */
export function computeVisualTransformDelta(
  startPos: { readonly x: number; readonly y: number },
  endPos: { readonly x: number; readonly y: number },
): { readonly translateX: number; readonly translateY: number } {
  return {
    translateX: roundTransformNumber(endPos.x - startPos.x, 1),
    translateY: roundTransformNumber(endPos.y - startPos.y, 1),
  };
}

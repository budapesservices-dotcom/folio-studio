/**
 * Pure Auto Text-Wrapping & Typography Measurement Engine.
 *
 * Produces deterministic wrapped lines that match browser CSS `white-space: pre-wrap;
 * overflow-wrap: break-word;` across:
 * - Interactive SVG Canvas (`src/engines/canvas/artwork.tsx`)
 * - Standalone SVG / PNG Visual Export (`src/app/visualExport.ts`)
 * - Compiled HTML/CSS & React TSX (`htmlCssCompiler.ts`, `reactCompiler.ts`)
 */

import type { TextAlign, TextTransform, TextWrapMode } from './types';

export interface TextWrapOptions {
  maxWidth: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number;
  textWrap?: TextWrapMode;
  textTransform?: TextTransform;
}

let cachedMeasureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (cachedMeasureContext !== undefined) return cachedMeasureContext;
  if (typeof document === 'undefined') {
    cachedMeasureContext = null;
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    cachedMeasureContext = canvas.getContext('2d');
  } catch {
    cachedMeasureContext = null;
  }
  return cachedMeasureContext;
}

/**
 * Deterministic proportional character width estimator used in headless Node /
 * SSR / Vitest environments where Canvas2D `measureText` is unavailable.
 */
function estimateGlyphFactor(ch: string, isMonospace: boolean): number {
  if (isMonospace) return 0.6;
  if (ch === ' ') return 0.28;
  if ('ilI1|!.,:;`\'"'.includes(ch)) return 0.28;
  if ('fjtfr()[]{}'.includes(ch)) return 0.36;
  if ('mwMW@#%&'.includes(ch)) return 0.84;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= '0' && ch <= '9') return 0.56;
  return 0.53;
}

export function measureTextLineWidth(
  text: string,
  options: Pick<TextWrapOptions, 'fontSize' | 'fontFamily' | 'fontWeight' | 'letterSpacing'>,
): number {
  if (!text) return 0;
  const ctx = getMeasureContext();
  const extraSpacing = Math.max(0, text.length - 1) * (options.letterSpacing || 0);
  if (ctx) {
    const weight = Math.round(options.fontWeight || 400);
    const size = Math.max(1, options.fontSize || 16);
    const family = options.fontFamily || 'system-ui, sans-serif';
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(text).width + extraSpacing;
  }
  const isMono = /mono|code|courier/i.test(options.fontFamily || '');
  const weightBoost = options.fontWeight >= 600 ? 1.045 : 1;
  let units = 0;
  for (let i = 0; i < text.length; i += 1) {
    units += estimateGlyphFactor(text[i], isMono);
  }
  return units * options.fontSize * weightBoost + extraSpacing;
}

export function applyTextTransform(text: string, transform?: TextTransform): string {
  if (!transform || transform === 'none') return text;
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') {
    return text.replace(/(^|\s)([a-z\u00e0-\u00ff])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
  }
  return text;
}

/**
 * Wraps `text` into visual lines constrained by `maxWidth`, matching CSS
 * `white-space: pre-wrap; overflow-wrap: break-word;`.
 */
export function wrapTextLines(
  rawText: string,
  options: TextWrapOptions,
): string[] {
  const transformed = applyTextTransform(rawText, options.textTransform);
  const paragraphs = transformed.split(/\r?\n/);

  if (options.textWrap === 'nowrap' || !Number.isFinite(options.maxWidth) || options.maxWidth <= 0) {
    return paragraphs.length > 0 ? paragraphs : [''];
  }

  // Slight tolerance (+1.5px) matches browser subpixel glyph rounding
  const limit = Math.max(options.fontSize * 0.75, options.maxWidth + 1.5);
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      result.push('');
      continue;
    }

    if (measureTextLineWidth(paragraph, options) <= limit) {
      result.push(paragraph);
      continue;
    }

    // Split into tokens preserving whitespace boundaries
    const tokens = paragraph.match(/\S+|\s+/g) ?? [paragraph];
    let currentLine = '';

    const pushLongToken = (word: string) => {
      let chunk = '';
      for (let i = 0; i < word.length; i += 1) {
        const candidate = chunk + word[i];
        if (chunk.length > 0 && measureTextLineWidth(candidate, options) > limit) {
          result.push(chunk);
          chunk = word[i];
        } else {
          chunk = candidate;
        }
      }
      currentLine = chunk;
    };

    for (const token of tokens) {
      if (!currentLine) {
        if (measureTextLineWidth(token, options) <= limit) {
          currentLine = token;
        } else if (/^\s+$/.test(token)) {
          currentLine = token;
        } else {
          pushLongToken(token);
        }
        continue;
      }

      const candidate = currentLine + token;
      if (measureTextLineWidth(candidate, options) <= limit) {
        currentLine = candidate;
      } else if (/^\s+$/.test(token)) {
        // Trailing space at wrap boundary stays trimmed on the next line just like CSS
        result.push(currentLine.replace(/\s+$/, ''));
        currentLine = '';
      } else {
        result.push(currentLine.replace(/\s+$/, ''));
        currentLine = '';
        if (measureTextLineWidth(token, options) <= limit) {
          currentLine = token;
        } else {
          pushLongToken(token);
        }
      }
    }

    if (currentLine.length > 0) {
      result.push(currentLine);
    }
  }

  return result.length > 0 ? result : [''];
}

export function getSvgTextAnchorAndX(
  x: number,
  width: number,
  textAlign?: TextAlign,
): { anchor: 'start' | 'middle' | 'end'; xPos: number } {
  if (textAlign === 'center') {
    return { anchor: 'middle', xPos: Math.round((x + width / 2) * 100) / 100 };
  }
  if (textAlign === 'right') {
    return { anchor: 'end', xPos: Math.round((x + width) * 100) / 100 };
  }
  return { anchor: 'start', xPos: x };
}

export function computeTextVerticalOffset(
  boxHeight: number,
  lineCount: number,
  fontSize: number,
  lineHeight: number,
  verticalAlign?: 'top' | 'middle' | 'bottom',
): number {
  if (!verticalAlign || verticalAlign === 'top') return 0;
  const safeLines = Math.max(1, lineCount);
  const safeFont = Math.max(1, fontSize);
  const safeLineHeight = Math.max(0.5, lineHeight);
  const contentHeight = (safeLines - 1) * safeFont * safeLineHeight + safeFont;
  const freeSpace = Math.max(0, boxHeight - contentHeight);
  if (verticalAlign === 'middle') {
    return Math.round((freeSpace / 2) * 100) / 100;
  }
  return Math.round(freeSpace * 100) / 100;
}


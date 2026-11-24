/**
 * Pure Modern Styling Engine shared by Canvas SVG, Visual Export (SVG/PNG),
 * HTML/CSS Compiler, and React Compiler.
 *
 * Handles:
 * - Multi-fill stacks (Solid, Linear Gradient, Radial Gradient)
 * - Drop Shadow, Inner Shadow, Layer Blur, Backdrop Blur (Glassmorphism)
 * - Blend Modes (CSS mix-blend-mode)
 * - Strict sanitization against CSS/XML injection
 */

import type {
  BlendMode,
  DesignNode,
  FillPaint,
  GradientStop,
  VisualEffect,
} from './types';

export const BLEND_MODES: readonly BlendMode[] = Object.freeze([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

const BLEND_MODE_SET = new Set<string>(BLEND_MODES);

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODE_SET.has(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SAFE_COLOR_CHARS = /^[#a-zA-Z0-9(),.%\s/+_-]+$/;

export function sanitizeStyleColor(raw: string, fallback = 'transparent'): string {
  const cleaned = raw.replace(/[\r\n;{}<>\\]/g, '').trim();
  if (!cleaned || cleaned.length > 128) return fallback;
  if (/\/\*|\*\/|@import|\b(?:expression|url|javascript|vbscript|data|behavior)\s*[:(]/i.test(cleaned)) {
    return fallback;
  }
  if (!SAFE_COLOR_CHARS.test(cleaned)) return fallback;
  return cleaned;
}

export function isGradientStop(value: unknown): value is GradientStop {
  return (
    isRecord(value) &&
    isFiniteNumber(value.offset) &&
    value.offset >= 0 &&
    value.offset <= 1 &&
    typeof value.color === 'string' &&
    value.color.trim().length > 0 &&
    (value.opacity === undefined || (isFiniteNumber(value.opacity) && value.opacity >= 0 && value.opacity <= 1))
  );
}

export function isFillPaint(value: unknown): value is FillPaint {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return false;
  if (value.opacity !== undefined && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)) {
    return false;
  }
  if (value.visible !== undefined && typeof value.visible !== 'boolean') return false;

  if (value.type === 'solid') {
    return typeof value.color === 'string' && value.color.trim().length > 0;
  }
  if (value.type === 'linear-gradient') {
    return (
      isFiniteNumber(value.angle) &&
      Array.isArray(value.stops) &&
      value.stops.length >= 2 &&
      value.stops.length <= 16 &&
      value.stops.every(isGradientStop)
    );
  }
  if (value.type === 'radial-gradient') {
    return (
      (value.cx === undefined || (isFiniteNumber(value.cx) && value.cx >= -2 && value.cx <= 3)) &&
      (value.cy === undefined || (isFiniteNumber(value.cy) && value.cy >= -2 && value.cy <= 3)) &&
      (value.r === undefined || (isFiniteNumber(value.r) && value.r > 0 && value.r <= 4)) &&
      Array.isArray(value.stops) &&
      value.stops.length >= 2 &&
      value.stops.length <= 16 &&
      value.stops.every(isGradientStop)
    );
  }
  return false;
}

export function isVisualEffect(value: unknown): value is VisualEffect {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return false;
  if (value.visible !== undefined && typeof value.visible !== 'boolean') return false;

  if (value.type === 'drop-shadow' || value.type === 'inner-shadow') {
    return (
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.blur) && value.blur >= 0 && value.blur <= 200 &&
      (value.spread === undefined || (isFiniteNumber(value.spread) && value.spread >= -100 && value.spread <= 100)) &&
      typeof value.color === 'string' &&
      value.color.trim().length > 0
    );
  }
  if (value.type === 'layer-blur' || value.type === 'backdrop-blur') {
    return isFiniteNumber(value.radius) && value.radius >= 0 && value.radius <= 200;
  }
  return false;
}

export function roundStyleNum(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeSvgIdPart(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Returns the active (visible) paint layers in bottom-to-top paint order for any
 * shape/path node, falling back to legacy `style.fill` if `fills` is omitted.
 */
export function getVisibleFillPaints(
  node: Extract<DesignNode, { type: 'frame' | 'rect' | 'ellipse' | 'path' }>,
): FillPaint[] {
  const custom = node.style.fills;
  if (Array.isArray(custom) && custom.length > 0) {
    return custom.filter((paint) => paint.visible !== false);
  }
  if (node.style.fill && node.style.fill !== 'none' && node.style.fill !== 'transparent') {
    return [{ id: 'legacy-fill', type: 'solid', color: node.style.fill, opacity: 1, visible: true }];
  }
  return [];
}

export function getVisibleEffects(node: DesignNode): VisualEffect[] {
  if (!Array.isArray(node.effects) || node.effects.length === 0) return [];
  return node.effects.filter((effect) => effect.visible !== false);
}

export function getBackdropBlurRadius(node: DesignNode): number {
  let maxRadius = 0;
  for (const effect of getVisibleEffects(node)) {
    if (effect.type === 'backdrop-blur' && effect.radius > maxRadius) {
      maxRadius = effect.radius;
    }
  }
  return maxRadius;
}

/**
 * Converts a CSS linear-gradient angle (0deg = bottom-to-top, 90deg = left-to-right,
 * 135deg = top-left to bottom-right) into exact SVG objectBoundingBox x1,y1,x2,y2 coords.
 */
export function computeSvgLinearGradientCoords(angleDeg: number): {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
} {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const rad = (normalized * Math.PI) / 180;
  // CSS angle 0deg points UP (0, -1); 90deg points RIGHT (1, 0)
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const scale = Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
  const nx = dx / scale;
  const ny = dy / scale;
  const x1 = roundStyleNum((0.5 - nx * 0.5) * 100);
  const y1 = roundStyleNum((0.5 - ny * 0.5) * 100);
  const x2 = roundStyleNum((0.5 + nx * 0.5) * 100);
  const y2 = roundStyleNum((0.5 + ny * 0.5) * 100);
  return { x1: `${x1}%`, y1: `${y1}%`, x2: `${x2}%`, y2: `${y2}%` };
}

function applyStopOpacityToCssColor(color: string, opacity: number | undefined): string {
  const safe = sanitizeStyleColor(color, 'transparent');
  if (opacity === undefined || opacity >= 0.999) return safe;
  const clamped = clamp01(opacity);
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(safe);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${roundStyleNum(clamped)})`;
  }
  return `color-mix(in srgb, ${safe} ${roundStyleNum(clamped * 100)}%, transparent)`;
}

/**
 * Formats a single FillPaint into a valid CSS background image or color expression.
 */
export function fillPaintToCssLayer(paint: FillPaint, isBottomLayer: boolean): string {
  const layerOpacity = paint.opacity ?? 1;
  if (paint.type === 'solid') {
    const color = applyStopOpacityToCssColor(paint.color, layerOpacity);
    return isBottomLayer ? color : `linear-gradient(${color}, ${color})`;
  }
  const stops = paint.stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => {
      const effectiveOpacity = clamp01((stop.opacity ?? 1) * layerOpacity);
      const cssColor = applyStopOpacityToCssColor(stop.color, effectiveOpacity);
      return `${cssColor} ${roundStyleNum(stop.offset * 100)}%`;
    })
    .join(', ');

  if (paint.type === 'linear-gradient') {
    return `linear-gradient(${roundStyleNum(paint.angle)}deg, ${stops})`;
  }
  const cx = roundStyleNum((paint.cx ?? 0.5) * 100);
  const cy = roundStyleNum((paint.cy ?? 0.5) * 100);
  return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
}

/**
 * Composes an ordered bottom-to-top FillPaint[] array into a CSS `background` value.
 * In CSS, earlier comma-separated layers paint ON TOP of later layers, so we reverse order.
 */
export function buildCssBackgroundFromFills(
  fills: readonly FillPaint[] | undefined,
  fallbackFill: string,
): string | null {
  if (!fills || fills.length === 0) {
    const safe = sanitizeStyleColor(fallbackFill, 'transparent');
    return safe && safe !== 'none' ? safe : null;
  }
  const visible = fills.filter((paint) => paint.visible !== false);
  if (visible.length === 0) return null;
  if (visible.length === 1 && visible[0].type === 'solid') {
    return fillPaintToCssLayer(visible[0], true);
  }
  // CSS background stacks top-most first -> reverse bottom-to-top paint order
  const reversed = [...visible].reverse();
  return reversed
    .map((paint, index) => fillPaintToCssLayer(paint, index === reversed.length - 1))
    .join(', ');
}

/**
 * Generates CSS declarations for VisualEffect[] (Drop Shadow, Inner Shadow,
 * Layer Blur, Backdrop Blur) and BlendMode.
 */
export function buildCssEffectsAndBlendDeclarations(
  node: DesignNode,
): string[] {
  const declarations: string[] = [];
  const effects = getVisibleEffects(node);
  const isBoxNode =
    node.type === 'frame' ||
    node.type === 'rect' ||
    node.type === 'ellipse' ||
    node.type === 'image';

  const boxShadows: string[] = [];
  const filters: string[] = [];
  const backdropFilters: string[] = [];

  for (const effect of effects) {
    if (effect.type === 'drop-shadow') {
      const color = sanitizeStyleColor(effect.color, 'rgba(0, 0, 0, 0.25)');
      if (isBoxNode) {
        const spread = effect.spread ? ` ${roundStyleNum(effect.spread)}px` : '';
        boxShadows.push(
          `${roundStyleNum(effect.x)}px ${roundStyleNum(effect.y)}px ${roundStyleNum(effect.blur)}px${spread} ${color}`,
        );
      } else {
        filters.push(
          `drop-shadow(${roundStyleNum(effect.x)}px ${roundStyleNum(effect.y)}px ${roundStyleNum(effect.blur)}px ${color})`,
        );
      }
    } else if (effect.type === 'inner-shadow') {
      const color = sanitizeStyleColor(effect.color, 'rgba(0, 0, 0, 0.25)');
      const spread = effect.spread ? ` ${roundStyleNum(effect.spread)}px` : '';
      if (isBoxNode) {
        boxShadows.push(
          `inset ${roundStyleNum(effect.x)}px ${roundStyleNum(effect.y)}px ${roundStyleNum(effect.blur)}px${spread} ${color}`,
        );
      }
    } else if (effect.type === 'layer-blur' && effect.radius > 0) {
      filters.push(`blur(${roundStyleNum(effect.radius)}px)`);
    } else if (effect.type === 'backdrop-blur' && effect.radius > 0) {
      backdropFilters.push(`blur(${roundStyleNum(effect.radius)}px)`);
    }
  }

  if (boxShadows.length > 0) {
    declarations.push(`box-shadow: ${boxShadows.join(', ')};`);
  }
  if (filters.length > 0) {
    declarations.push(`filter: ${filters.join(' ')};`);
  }
  if (backdropFilters.length > 0) {
    const val = backdropFilters.join(' ');
    declarations.push(`backdrop-filter: ${val};`);
    declarations.push(`-webkit-backdrop-filter: ${val};`);
  }
  if (node.blendMode && node.blendMode !== 'normal' && isBlendMode(node.blendMode)) {
    declarations.push(`mix-blend-mode: ${node.blendMode};`);
  }

  return declarations;
}

export function buildSvgPaintId(prefix: string, nodeId: string, paintIndex: number): string {
  return `${prefix}--paint--${sanitizeSvgIdPart(nodeId)}--${paintIndex}`;
}

export function buildSvgFilterId(prefix: string, nodeId: string): string {
  return `${prefix}--fx--${sanitizeSvgIdPart(nodeId)}`;
}

export function hasSvgFilterEffects(node: DesignNode): boolean {
  return getVisibleEffects(node).some(
    (fx) => fx.type === 'drop-shadow' || fx.type === 'inner-shadow' || (fx.type === 'layer-blur' && fx.radius > 0),
  );
}

/**
 * Serializes SVG `<linearGradient>`, `<radialGradient>`, and `<filter>` `<defs>`
 * XML strings for a single node — used by standalone SVG/PNG visual export.
 */
export function serializeNodeSvgStyleDefs(node: DesignNode, prefix: string): string {
  const parts: string[] = [];

  if (node.type === 'frame' || node.type === 'rect' || node.type === 'ellipse' || node.type === 'path') {
    const paints = getVisibleFillPaints(node);
    paints.forEach((paint, idx) => {
      if (paint.type === 'solid') return;
      const id = buildSvgPaintId(prefix, node.id, idx);
      const layerOpacity = clamp01(paint.opacity ?? 1);
      const stopsXml = paint.stops
        .slice()
        .sort((a, b) => a.offset - b.offset)
        .map((stop) => {
          const op = roundStyleNum(clamp01((stop.opacity ?? 1) * layerOpacity));
          const color = sanitizeStyleColor(stop.color, '#000000');
          return `<stop offset="${roundStyleNum(stop.offset * 100)}%" stop-color="${escapeXmlAttr(color)}" stop-opacity="${op}" />`;
        })
        .join('');
      if (paint.type === 'linear-gradient') {
        const coords = computeSvgLinearGradientCoords(paint.angle);
        parts.push(
          `<linearGradient id="${escapeXmlAttr(id)}" x1="${coords.x1}" y1="${coords.y1}" x2="${coords.x2}" y2="${coords.y2}">${stopsXml}</linearGradient>`,
        );
      } else {
        const cx = `${roundStyleNum((paint.cx ?? 0.5) * 100)}%`;
        const cy = `${roundStyleNum((paint.cy ?? 0.5) * 100)}%`;
        const r = `${roundStyleNum((paint.r ?? 0.5) * 100)}%`;
        parts.push(
          `<radialGradient id="${escapeXmlAttr(id)}" cx="${cx}" cy="${cy}" r="${r}">${stopsXml}</radialGradient>`,
        );
      }
    });
  }

  const effects = getVisibleEffects(node).filter(
    (fx) => fx.type === 'drop-shadow' || fx.type === 'inner-shadow' || (fx.type === 'layer-blur' && fx.radius > 0),
  );
  if (effects.length > 0) {
    const filterId = buildSvgFilterId(prefix, node.id);
    const primitives: string[] = [];
    let currentResult = 'SourceGraphic';
    let step = 0;

    for (const fx of effects) {
      step += 1;
      if (fx.type === 'drop-shadow') {
        const color = sanitizeStyleColor(fx.color, 'rgba(0,0,0,0.25)');
        const stdDev = roundStyleNum(Math.max(0, fx.blur) / 2);
        const out = `fx_ds_${step}`;
        primitives.push(
          `<feDropShadow in="${currentResult}" dx="${roundStyleNum(fx.x)}" dy="${roundStyleNum(fx.y)}" stdDeviation="${stdDev}" flood-color="${escapeXmlAttr(color)}" result="${out}" />`,
        );
        currentResult = out;
      } else if (fx.type === 'inner-shadow') {
        const color = sanitizeStyleColor(fx.color, 'rgba(0,0,0,0.25)');
        const stdDev = roundStyleNum(Math.max(0, fx.blur) / 2);
        const offsetOut = `fx_is_off_${step}`;
        const blurOut = `fx_is_blur_${step}`;
        const compOut = `fx_is_comp_${step}`;
        const floodOut = `fx_is_flood_${step}`;
        const colorOut = `fx_is_color_${step}`;
        const mergeOut = `fx_is_merge_${step}`;
        primitives.push(
          `<feOffset in="SourceAlpha" dx="${roundStyleNum(fx.x)}" dy="${roundStyleNum(fx.y)}" result="${offsetOut}" />`,
          `<feGaussianBlur in="${offsetOut}" stdDeviation="${stdDev}" result="${blurOut}" />`,
          `<feComposite in="SourceAlpha" in2="${blurOut}" operator="out" result="${compOut}" />`,
          `<feFlood flood-color="${escapeXmlAttr(color)}" result="${floodOut}" />`,
          `<feComposite in="${floodOut}" in2="${compOut}" operator="in" result="${colorOut}" />`,
          `<feMerge result="${mergeOut}"><feMergeNode in="${currentResult}" /><feMergeNode in="${colorOut}" /></feMerge>`,
        );
        currentResult = mergeOut;
      } else if (fx.type === 'layer-blur' && fx.radius > 0) {
        const out = `fx_blur_${step}`;
        primitives.push(
          `<feGaussianBlur in="${currentResult}" stdDeviation="${roundStyleNum(fx.radius / 2)}" result="${out}" />`,
        );
        currentResult = out;
      }
    }

    parts.push(
      `<filter id="${escapeXmlAttr(filterId)}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${primitives.join('')}</filter>`,
    );
  }

  return parts.join('');
}

/** Creates a default linear gradient fill paint. */
export function createDefaultLinearGradientFill(id?: string): Extract<FillPaint, { type: 'linear-gradient' }> {
  return {
    id: id ?? `fill-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    type: 'linear-gradient',
    angle: 135,
    stops: [
      { offset: 0, color: '#6366F1', opacity: 1 },
      { offset: 1, color: '#EC4899', opacity: 1 },
    ],
    opacity: 1,
    visible: true,
  };
}

/** Creates a default radial gradient fill paint. */
export function createDefaultRadialGradientFill(id?: string): Extract<FillPaint, { type: 'radial-gradient' }> {
  return {
    id: id ?? `fill-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    type: 'radial-gradient',
    cx: 0.5,
    cy: 0.5,
    r: 0.65,
    stops: [
      { offset: 0, color: '#38BDF8', opacity: 1 },
      { offset: 1, color: '#312E81', opacity: 1 },
    ],
    opacity: 1,
    visible: true,
  };
}

/** Creates a default visual effect entry. */
export function createDefaultVisualEffect(
  type: VisualEffect['type'],
  id?: string,
): VisualEffect {
  const effectId = id ?? `fx-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  switch (type) {
    case 'drop-shadow':
      return { id: effectId, type: 'drop-shadow', x: 0, y: 12, blur: 28, spread: 0, color: 'rgba(15, 23, 42, 0.24)', visible: true };
    case 'inner-shadow':
      return { id: effectId, type: 'inner-shadow', x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(15, 23, 42, 0.22)', visible: true };
    case 'layer-blur':
      return { id: effectId, type: 'layer-blur', radius: 8, visible: true };
    case 'backdrop-blur':
      return { id: effectId, type: 'backdrop-blur', radius: 16, visible: true };
  }
}

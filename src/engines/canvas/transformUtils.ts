import type { DesignNode } from '../../core/document/types';
import type { PrototypeNodeOverride } from '../prototype/runtime';

const TRANSFORM_FUNC_RE = /([a-zA-Z0-9_-]+)\s*\(([^)]*)\)/g;

function roundSvgNum(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseLengthPx(raw: string, referenceSize: number): number | null {
  const token = raw.trim();
  if (!token) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%|em|rem|vw|vh)?$/i.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '%') {
    return (num / 100) * referenceSize;
  }
  if (unit === 'em' || unit === 'rem') {
    return num * 16;
  }
  return num;
}

function parseAngleDeg(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] ?? 'deg').toLowerCase();
  if (unit === 'rad') return (num * 180) / Math.PI;
  if (unit === 'grad') return num * 0.9;
  if (unit === 'turn') return num * 360;
  return num;
}

function parseScaleFactor(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(token);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  return match[2] === '%' ? num / 100 : num;
}

function splitTransformArgs(rawArgs: string): string[] {
  return rawArgs
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Converts a CSS `transform` string (evaluated around CSS `transform-origin: 50% 50%`,
 * i.e. pivot `(cx, cy)`) into an equivalent SVG `transform` attribute string.
 *
 * Returns `undefined` for empty or `"none"` values so callers cleanly remove or
 * revert transforms without leaving stale SVG attributes behind.
 */
export function cssTransformToSvgTransform(
  cssTransform: string | undefined | null,
  cx: number,
  cy: number,
  width = 0,
  height = 0,
): string | undefined {
  if (typeof cssTransform !== 'string') return undefined;
  const trimmed = cssTransform.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return undefined;

  const ops: string[] = [];
  let onlyPureTranslates = true;
  TRANSFORM_FUNC_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TRANSFORM_FUNC_RE.exec(trimmed)) !== null) {
    const fn = match[1].toLowerCase();
    const args = splitTransformArgs(match[2]);
    if (args.length === 0) continue;

    if (fn === 'translate' || fn === 'translate3d') {
      const tx = parseLengthPx(args[0], width);
      const ty = args.length >= 2 ? parseLengthPx(args[1], height) : 0;
      if (tx !== null && ty !== null) {
        ops.push(`translate(${roundSvgNum(tx)} ${roundSvgNum(ty)})`);
      }
    } else if (fn === 'translatex') {
      const tx = parseLengthPx(args[0], width);
      if (tx !== null) {
        ops.push(`translate(${roundSvgNum(tx)} 0)`);
      }
    } else if (fn === 'translatey') {
      const ty = parseLengthPx(args[0], height);
      if (ty !== null) {
        ops.push(`translate(0 ${roundSvgNum(ty)})`);
      }
    } else if (fn === 'rotate' || fn === 'rotatez') {
      const deg = parseAngleDeg(args[0]);
      if (deg !== null) {
        onlyPureTranslates = false;
        ops.push(`rotate(${roundSvgNum(deg)})`);
      }
    } else if (fn === 'scale' || fn === 'scale3d') {
      const sx = parseScaleFactor(args[0]);
      const sy = args.length >= 2 ? parseScaleFactor(args[1]) : sx;
      if (sx !== null && sy !== null) {
        onlyPureTranslates = false;
        ops.push(`scale(${roundSvgNum(sx)} ${roundSvgNum(sy)})`);
      }
    } else if (fn === 'scalex') {
      const sx = parseScaleFactor(args[0]);
      if (sx !== null) {
        onlyPureTranslates = false;
        ops.push(`scale(${roundSvgNum(sx)} 1)`);
      }
    } else if (fn === 'scaley') {
      const sy = parseScaleFactor(args[0]);
      if (sy !== null) {
        onlyPureTranslates = false;
        ops.push(`scale(1 ${roundSvgNum(sy)})`);
      }
    } else if (fn === 'skewx') {
      const deg = parseAngleDeg(args[0]);
      if (deg !== null) {
        onlyPureTranslates = false;
        ops.push(`skewX(${roundSvgNum(deg)})`);
      }
    } else if (fn === 'skewy') {
      const deg = parseAngleDeg(args[0]);
      if (deg !== null) {
        onlyPureTranslates = false;
        ops.push(`skewY(${roundSvgNum(deg)})`);
      }
    } else if (fn === 'skew') {
      const ax = parseAngleDeg(args[0]);
      const ay = args.length >= 2 ? parseAngleDeg(args[1]) : 0;
      if (ax !== null && ay !== null) {
        onlyPureTranslates = false;
        const tanX = Math.tan((ax * Math.PI) / 180);
        const tanY = Math.tan((ay * Math.PI) / 180);
        ops.push(`matrix(1 ${roundSvgNum(tanY)} ${roundSvgNum(tanX)} 1 0 0)`);
      }
    } else if (fn === 'matrix' && args.length >= 6) {
      const nums = args.slice(0, 6).map((token) => Number(token));
      if (nums.every((n) => Number.isFinite(n))) {
        onlyPureTranslates = false;
        ops.push(`matrix(${nums.map(roundSvgNum).join(' ')})`);
      }
    }
  }

  if (ops.length === 0) return undefined;

  if (onlyPureTranslates) {
    return ops.join(' ');
  }

  const rcx = roundSvgNum(cx);
  const rcy = roundSvgNum(cy);
  const negCx = roundSvgNum(-cx);
  const negCy = roundSvgNum(-cy);
  if (rcx === 0 && rcy === 0) {
    return ops.join(' ');
  }
  return `translate(${rcx} ${rcy}) ${ops.join(' ')} translate(${negCx} ${negCy})`;
}

/**
 * Returns the runtime SVG transform override for a single node (without static rotation).
 * When an override is explicitly cleared (`""` or `"none"`), returns `undefined`.
 */
export function resolveNodeRuntimeSvgTransform(
  node: Pick<DesignNode, 'id' | 'x' | 'y' | 'width' | 'height'>,
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>,
  overrideIdPrefix = '',
): string | undefined {
  if (!nodeOverrides) return undefined;
  const key = overrideIdPrefix ? `${overrideIdPrefix}${node.id}` : node.id;
  const raw = nodeOverrides[key]?.transform;
  if (!raw) return undefined;
  return cssTransformToSvgTransform(
    raw,
    node.x + node.width / 2,
    node.y + node.height / 2,
    node.width,
    node.height,
  );
}

/**
 * Computes the effective SVG transform for a node (visual artwork or clip-mask silhouette).
 * Matches CSS inline `style.transform` semantics used in Live Preview and React export:
 * - When a non-empty runtime `transform` override is active, it governs the node's transform
 *   around its center (preventing double-rotation with static `node.rotation`).
 * - When no runtime `transform` override is active (or it was cleared back to `""`),
 *   the node cleanly falls back to its static `node.rotation`.
 */
export function resolveNodeEffectiveSvgTransform(
  node: Pick<DesignNode, 'id' | 'type' | 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>,
  overrideIdPrefix = '',
): { readonly svgTransform: string | undefined; readonly hasOverrideTransform: boolean } {
  const runtimeTransform = resolveNodeRuntimeSvgTransform(node, nodeOverrides, overrideIdPrefix);
  if (runtimeTransform) {
    return { svgTransform: runtimeTransform, hasOverrideTransform: true };
  }
  const staticTransform = node.type !== 'group' && node.rotation
    ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
    : undefined;
  return { svgTransform: staticTransform, hasOverrideTransform: false };
}

/**
 * Collects effective SVG transforms from ancestor `group` nodes (outermost first).
 * Used so flat SVG Canvas rendering AND `DocumentMaskDefs` apply ancestor group transforms
 * identically and strictly ONCE (never double-transforming group descendants).
 */
export function getAncestorGroupSvgTransforms(
  node: DesignNode,
  nodeById: ReadonlyMap<string, DesignNode>,
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>,
  overrideIdPrefix = '',
  stopAtAncestorId?: string,
): string[] {
  if (!node.parentId) return [];
  const chain: DesignNode[] = [];
  const visited = new Set<string>([node.id]);
  let current = nodeById.get(node.parentId);
  while (current && !visited.has(current.id)) {
    if (stopAtAncestorId && current.id === stopAtAncestorId) break;
    visited.add(current.id);
    if (current.type === 'group' || current.type === 'frame') {
      chain.push(current);
    }
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  if (chain.length === 0) return [];

  const transforms: string[] = [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const containerNode = chain[i];
    const svgTransform = resolveNodeRuntimeSvgTransform(containerNode, nodeOverrides, overrideIdPrefix);
    if (svgTransform) {
      transforms.push(svgTransform);
    }
  }
  return transforms;
}

export function hasActiveTransformOverrides(
  nodeOverrides?: Readonly<Record<string, PrototypeNodeOverride>>,
): boolean {
  if (!nodeOverrides) return false;
  for (const override of Object.values(nodeOverrides)) {
    if (typeof override?.transform === 'string' && override.transform.trim().length > 0) {
      return true;
    }
  }
  return false;
}

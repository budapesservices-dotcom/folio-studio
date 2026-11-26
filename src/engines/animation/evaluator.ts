import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationKeyframe,
  AnimationTrack,
  DesignNode,
  FolioDocument,
  FolioPage,
  NodeCssFilters,
  VisualEffect,
} from '../../core/document/types';
import {
  formatColorWithAlpha,
  parseColorWithAlpha,
  parseCssColorRgba,
} from '../../core/document/styling';
import { scalePathNodeGeometry } from '../../core/document/vector';
import { evaluateEasing } from './easing';

export const MODERN_EFFECT_ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = Object.freeze([
  'layerBlur',
  'backdropBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
  'shadowSpread',
  'shadowOpacity',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
]);

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = Object.freeze([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'scale',
  'radius',
  'fill',
  'stroke',
  'strokeWidth',
  ...MODERN_EFFECT_ANIMATABLE_PROPERTIES,
]);

export const ANIMATABLE_PROPERTY_META: Readonly<Record<AnimatableProperty, {
  label: string;
  unit: string;
  step: number;
  min?: number;
  max?: number;
  kind: 'number' | 'color';
}>> = Object.freeze({
  x: { label: 'X', unit: 'px', step: 1, kind: 'number' },
  y: { label: 'Y', unit: 'px', step: 1, kind: 'number' },
  width: { label: 'W', unit: 'px', step: 1, min: 1, max: 20000, kind: 'number' },
  height: { label: 'H', unit: 'px', step: 1, min: 1, max: 20000, kind: 'number' },
  rotation: { label: 'Rotation', unit: 'deg', step: 1, kind: 'number' },
  opacity: { label: 'Opacity', unit: '', step: 0.05, min: 0, max: 1, kind: 'number' },
  scale: { label: 'Scale', unit: 'x', step: 0.05, min: 0.05, max: 5, kind: 'number' },
  radius: { label: 'Radius', unit: 'px', step: 1, min: 0, max: 2000, kind: 'number' },
  fill: { label: 'Fill', unit: '', step: 0, kind: 'color' },
  stroke: { label: 'Stroke', unit: '', step: 0, kind: 'color' },
  strokeWidth: { label: 'Stroke W', unit: 'px', step: 0.5, min: 0, max: 200, kind: 'number' },
  layerBlur: { label: 'Layer Blur', unit: 'px', step: 1, min: 0, max: 200, kind: 'number' },
  backdropBlur: { label: 'Backdrop Blur', unit: 'px', step: 1, min: 0, max: 200, kind: 'number' },
  shadowOffsetX: { label: 'Shadow X', unit: 'px', step: 1, min: -500, max: 500, kind: 'number' },
  shadowOffsetY: { label: 'Shadow Y', unit: 'px', step: 1, min: -500, max: 500, kind: 'number' },
  shadowBlur: { label: 'Shadow Blur', unit: 'px', step: 1, min: 0, max: 200, kind: 'number' },
  shadowSpread: { label: 'Shadow Spread', unit: 'px', step: 1, min: -100, max: 100, kind: 'number' },
  shadowOpacity: { label: 'Shadow Opacity', unit: '', step: 0.05, min: 0, max: 1, kind: 'number' },
  brightness: { label: 'Brightness', unit: '%', step: 1, min: 0, max: 300, kind: 'number' },
  contrast: { label: 'Contrast', unit: '%', step: 1, min: 0, max: 300, kind: 'number' },
  saturate: { label: 'Saturate', unit: '%', step: 1, min: 0, max: 300, kind: 'number' },
  grayscale: { label: 'Grayscale', unit: '%', step: 1, min: 0, max: 100, kind: 'number' },
});

export interface AnimatedNodePose {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  rotation?: number;
  scale?: number;
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  layerBlur?: number;
  backdropBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
  shadowSpread?: number;
  shadowOpacity?: number;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  grayscale?: number;
}

export interface MotionPresetDefinition {
  id: 'hero-entrance' | 'orbit-float' | 'pulse-glow';
  name: string;
  description: string;
  durationMs: number;
  loop: boolean;
}

export const MOTION_PRESETS: readonly MotionPresetDefinition[] = Object.freeze([
  {
    id: 'hero-entrance',
    name: 'Hero Entrance',
    description: 'Smooth staggered fade-up reveal with spring lift',
    durationMs: 1200,
    loop: false,
  },
  {
    id: 'orbit-float',
    name: 'Orbit Float',
    description: 'Continuous gentle vertical float and subtle rotation',
    durationMs: 2400,
    loop: true,
  },
  {
    id: 'pulse-glow',
    name: 'Pulse Glow',
    description: 'Rhythmic scale and opacity breath loop',
    durationMs: 1600,
    loop: true,
  },
]);

function createMotionId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid.slice(0, 8)}`;
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo2(value: number): number {
  const r = Math.round(value * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function roundTo3(value: number): number {
  const r = Math.round(value * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function channelToHex(channel: number): string {
  return clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
}

function isKeywordTransparent(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return !lower || lower === 'transparent' || lower === 'none';
}

/**
 * Smoothly interpolates any CSS color (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`,
 * `rgb()`, `rgba()`, and legacy `'transparent'`/`'none'`).
 * When one endpoint is legacy `'transparent'`/`'none'`, automatically adopts the
 * paired keyframe's RGB channels with alpha 0 so fading stays smooth without
 * binary snapping or muddy mid-transition darkening.
 */
export function interpolateColor(from: string, to: string, t: number): string {
  let a = parseCssColorRgba(from);
  let b = parseCssColorRgba(to);

  if (!a && !b) {
    if (isKeywordTransparent(from) && isKeywordTransparent(to)) {
      return 'rgba(0, 0, 0, 0)';
    }
    return t < 0.5 ? from : to;
  }

  if (!a && b && isKeywordTransparent(from)) {
    a = { r: b.r, g: b.g, b: b.b, a: 0 };
  } else if (!b && a && isKeywordTransparent(to)) {
    b = { r: a.r, g: a.g, b: a.b, a: 0 };
  }

  if (!a || !b) return t < 0.5 ? from : to;

  const clampedT = clamp(t, 0, 1);
  const r = clamp(Math.round(a.r + (b.r - a.r) * clampedT), 0, 255);
  const g = clamp(Math.round(a.g + (b.g - a.g) * clampedT), 0, 255);
  const bl = clamp(Math.round(a.b + (b.b - a.b) * clampedT), 0, 255);
  const alpha = roundTo3(clamp(a.a + (b.a - a.a) * clampedT, 0, 1));
  if (alpha < 0.999) {
    return `rgba(${r}, ${g}, ${bl}, ${alpha <= 0 ? 0 : alpha})`;
  }
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`;
}

/** Backward-compatible alias for `interpolateColor`. */
export function interpolateHexColor(from: string, to: string, t: number): string {
  return interpolateColor(from, to, t);
}

export function sortKeyframes(keyframes: readonly AnimationKeyframe[]): AnimationKeyframe[] {
  return [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Evaluates a single animation track at `timeMs`.
 * Returns `undefined` if the track has no keyframes.
 */
export function evaluateTrackAtTime(
  track: AnimationTrack,
  timeMs: number,
): number | string | undefined {
  if (track.keyframes.length === 0) return undefined;
  const sorted = sortKeyframes(track.keyframes);
  if (sorted.length === 1 || timeMs <= sorted[0].timeMs) {
    const val = sorted[0].value;
    if (track.property === 'opacity' || track.property === 'shadowOpacity') {
      return roundTo3(clamp(Number(val), 0, 1));
    }
    return val;
  }
  const last = sorted[sorted.length - 1];
  if (timeMs >= last.timeMs) {
    const val = last.value;
    if (track.property === 'opacity' || track.property === 'shadowOpacity') {
      return roundTo3(clamp(Number(val), 0, 1));
    }
    return val;
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (timeMs >= start.timeMs && timeMs <= end.timeMs) {
      const span = end.timeMs - start.timeMs;
      if (span <= 0) return end.value;
      const rawT = (timeMs - start.timeMs) / span;
      const easedT = evaluateEasing(end.easing, rawT);

      if (track.property === 'fill' || track.property === 'stroke') {
        return interpolateColor(String(start.value), String(end.value), easedT);
      }

      const startNum = Number(start.value);
      const endNum = Number(end.value);
      const interpolated = startNum + (endNum - startNum) * easedT;
      if (track.property === 'opacity' || track.property === 'shadowOpacity') {
        return roundTo3(clamp(interpolated, 0, 1));
      }
      if (track.property === 'scale') return roundTo3(clamp(interpolated, 0.05, 10));
      if (track.property === 'width' || track.property === 'height') return roundTo2(clamp(interpolated, 1, 20000));
      if (track.property === 'radius' || track.property === 'strokeWidth') return roundTo2(clamp(interpolated, 0, 2000));
      if (track.property === 'layerBlur' || track.property === 'backdropBlur' || track.property === 'shadowBlur') {
        return roundTo2(clamp(interpolated, 0, 200));
      }
      if (track.property === 'shadowOffsetX' || track.property === 'shadowOffsetY') {
        return roundTo2(clamp(interpolated, -500, 500));
      }
      if (track.property === 'shadowSpread') {
        return roundTo2(clamp(interpolated, -100, 100));
      }
      if (track.property === 'brightness' || track.property === 'contrast' || track.property === 'saturate') {
        return roundTo2(clamp(interpolated, 0, 300));
      }
      if (track.property === 'grayscale') {
        return roundTo2(clamp(interpolated, 0, 100));
      }
      return roundTo2(interpolated);
    }
  }
  return last.value;
}

/**
 * Evaluates all tracks in an AnimationClip at `timeMs` (automatically wrapping if `clip.loop` is true).
 */
export function evaluateClipAtTime(
  clip: AnimationClip,
  timeMs: number,
): Record<string, AnimatedNodePose> {
  const effectiveTime = clip.durationMs <= 0
    ? 0
    : clip.loop && timeMs > clip.durationMs
      ? timeMs % clip.durationMs
      : clamp(timeMs, 0, clip.durationMs);

  const poses: Record<string, AnimatedNodePose> = {};
  for (const track of clip.tracks) {
    const value = evaluateTrackAtTime(track, effectiveTime);
    if (value === undefined) continue;
    const pose = poses[track.targetNodeId] ?? (poses[track.targetNodeId] = {});
    if (track.property === 'fill') {
      pose.fill = String(value);
    } else if (track.property === 'stroke') {
      pose.stroke = String(value);
    } else {
      pose[track.property] = Number(value);
    }
  }
  return poses;
}

/**
 * Applies evaluated poses as a pure non-destructive visual overlay onto a FolioDocument
 * for live Main Canvas playback and scrubbing without mutating canonical AST state.
 */
export function applyAnimatedPosesToDocument(
  document: FolioDocument,
  poses: Readonly<Record<string, AnimatedNodePose>>,
): FolioDocument {
  const poseKeys = Object.keys(poses);
  if (poseKeys.length === 0) return document;

  const nodeById = new Map<string, DesignNode>(document.nodes.map((n) => [n.id, n]));
  const getAncestorChain = (node: DesignNode): DesignNode[] => {
    const chain: DesignNode[] = [];
    let curParentId = node.parentId;
    const visited = new Set<string>([node.id]);
    while (curParentId && !visited.has(curParentId)) {
      visited.add(curParentId);
      const anc = nodeById.get(curParentId);
      if (!anc) break;
      chain.push(anc);
      curParentId = anc.parentId;
    }
    return chain;
  };

  let changed = false;
  const nextNodes = document.nodes.map((node) => {
    const pose = poses[node.id];
    const ancestors = getAncestorChain(node);

    // Nearest animated ancestor provides inherited world displacement & frame rotation/opacity
    let inheritedDx = 0;
    let inheritedDy = 0;
    let inheritedRotDelta = 0;
    let inheritedOpacityMul = 1;
    let orbitOriginX = 0;
    let orbitOriginY = 0;
    let hasOrbit = false;

    for (const anc of ancestors) {
      const ancPose = poses[anc.id];
      if (!ancPose) continue;
      if (inheritedDx === 0 && ancPose.x !== undefined) {
        inheritedDx = ancPose.x - anc.x;
      }
      if (inheritedDy === 0 && ancPose.y !== undefined) {
        inheritedDy = ancPose.y - anc.y;
      }
      if (!hasOrbit && anc.type !== 'group' && ancPose.rotation !== undefined) {
        const dRot = ancPose.rotation - (anc.rotation || 0);
        if (Math.abs(dRot) > 0.001) {
          inheritedRotDelta = dRot;
          orbitOriginX = (ancPose.x ?? anc.x) + anc.width / 2;
          orbitOriginY = (ancPose.y ?? anc.y) + anc.height / 2;
          hasOrbit = true;
        }
      }
      if (ancPose.opacity !== undefined) {
        const baseAncOp = anc.opacity > 0.001 ? anc.opacity : 1;
        inheritedOpacityMul *= clamp(ancPose.opacity, 0, 1) / baseAncOp;
      }
    }

    const hasInheritedTransform =
      inheritedDx !== 0 || inheritedDy !== 0 || hasOrbit || Math.abs(inheritedOpacityMul - 1) > 0.001;
    if (!pose && !hasInheritedTransform) return node;
    changed = true;

    let baseX = pose?.x !== undefined ? pose.x : roundTo2(node.x + inheritedDx);
    let baseY = pose?.y !== undefined ? pose.y : roundTo2(node.y + inheritedDy);
    const baseWidth = pose?.width !== undefined ? Math.max(1, roundTo2(pose.width)) : node.width;
    const baseHeight = pose?.height !== undefined ? Math.max(1, roundTo2(pose.height)) : node.height;

    // Orbit un-keyed child center around animated rotated Frame parent's center to match CSS DOM nesting
    if (hasOrbit && pose?.x === undefined && pose?.y === undefined) {
      const childCx = baseX + baseWidth / 2;
      const childCy = baseY + baseHeight / 2;
      const rad = (inheritedRotDelta * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const relX = childCx - orbitOriginX;
      const relY = childCy - orbitOriginY;
      const rotatedCx = orbitOriginX + relX * cos - relY * sin;
      const rotatedCy = orbitOriginY + relX * sin + relY * cos;
      baseX = roundTo2(rotatedCx - baseWidth / 2);
      baseY = roundTo2(rotatedCy - baseHeight / 2);
    }

    const scale = pose?.scale ?? 1;
    const scaledWidth = scale !== 1 ? Math.max(1, roundTo2(baseWidth * scale)) : baseWidth;
    const scaledHeight = scale !== 1 ? Math.max(1, roundTo2(baseHeight * scale)) : baseHeight;
    const centeredX = scale !== 1 ? roundTo2(baseX + (baseWidth - scaledWidth) / 2) : baseX;
    const centeredY = scale !== 1 ? roundTo2(baseY + (baseHeight - scaledHeight) / 2) : baseY;

    const effectiveRotation =
      pose?.rotation !== undefined
        ? pose.rotation
        : roundTo2((node.rotation || 0) + (hasOrbit ? inheritedRotDelta : 0));
    const effectiveOpacity =
      pose?.opacity !== undefined
        ? roundTo3(clamp(pose.opacity, 0, 1))
        : roundTo3(clamp(node.opacity * inheritedOpacityMul, 0, 1));

    const basePatch = {
      x: centeredX,
      y: centeredY,
      width: scaledWidth,
      height: scaledHeight,
      rotation: effectiveRotation,
      opacity: effectiveOpacity,
    };

    let nextNode: DesignNode =
      node.type === 'path' && (scaledWidth !== node.width || scaledHeight !== node.height)
        ? {
            ...scalePathNodeGeometry(node, centeredX, centeredY, scaledWidth, scaledHeight),
            rotation: basePatch.rotation,
            opacity: basePatch.opacity,
          }
        : ({ ...node, ...basePatch } as DesignNode);

    const hasStyleAnim = Boolean(
      pose && (
        pose.fill !== undefined ||
        pose.stroke !== undefined ||
        pose.strokeWidth !== undefined ||
        pose.radius !== undefined
      ),
    );

    if (hasStyleAnim && pose && 'style' in nextNode) {
      const nextStyle: Record<string, unknown> = { ...nextNode.style };
      if (pose.fill !== undefined && 'fill' in nextNode.style) {
        nextStyle.fill = pose.fill;
        if ('fills' in nextStyle) {
          nextStyle.fills = undefined;
        }
      }
      if (pose.stroke !== undefined && 'stroke' in nextNode.style) {
        nextStyle.stroke = pose.stroke;
        if ('strokes' in nextStyle) {
          nextStyle.strokes = undefined;
        }
      }
      if (pose.strokeWidth !== undefined && 'strokeWidth' in nextNode.style) {
        nextStyle.strokeWidth = Math.max(0, roundTo2(pose.strokeWidth));
      }
      if (pose.radius !== undefined && 'radius' in nextNode.style) {
        nextStyle.radius = Math.max(0, roundTo2(pose.radius));
      }
      nextNode = {
        ...nextNode,
        style: nextStyle,
      } as DesignNode;
    }

    // Apply animated Modern Effects (layerBlur, backdropBlur, drop-shadow)
    const hasShadowAnim = Boolean(
      pose && (
        pose.shadowOffsetX !== undefined ||
        pose.shadowOffsetY !== undefined ||
        pose.shadowBlur !== undefined ||
        pose.shadowSpread !== undefined ||
        pose.shadowOpacity !== undefined
      ),
    );
    const hasEffectAnim = Boolean(
      pose && (pose.layerBlur !== undefined || pose.backdropBlur !== undefined || hasShadowAnim),
    );

    if (hasEffectAnim && pose) {
      let nextEffects: VisualEffect[] = [...(nextNode.effects ?? [])];

      if (pose.layerBlur !== undefined) {
        const radius = Math.max(0, roundTo2(pose.layerBlur));
        const withoutLayerBlur = nextEffects.filter((fx) => fx.type !== 'layer-blur');
        if (radius > 0) {
          const existing = nextEffects.find((fx) => fx.type === 'layer-blur');
          nextEffects = [
            ...withoutLayerBlur,
            { id: existing?.id ?? 'fx-anim-layer-blur', type: 'layer-blur', radius, visible: true },
          ];
        } else {
          nextEffects = withoutLayerBlur;
        }
      }

      if (pose.backdropBlur !== undefined) {
        const radius = Math.max(0, roundTo2(pose.backdropBlur));
        const withoutBackdrop = nextEffects.filter((fx) => fx.type !== 'backdrop-blur');
        if (radius > 0) {
          const existing = nextEffects.find((fx) => fx.type === 'backdrop-blur');
          nextEffects = [
            ...withoutBackdrop,
            { id: existing?.id ?? 'fx-anim-backdrop-blur', type: 'backdrop-blur', radius, visible: true },
          ];
        } else {
          nextEffects = withoutBackdrop;
        }
      }

      if (hasShadowAnim) {
        const existingShadow = nextEffects.find(
          (fx): fx is Extract<VisualEffect, { type: 'drop-shadow' }> => fx.type === 'drop-shadow',
        );
        const withoutDropShadow = nextEffects.filter((fx) => fx.type !== 'drop-shadow');
        const baseColor = existingShadow?.color ?? 'rgba(15, 23, 42, 0.32)';
        const parsedBase = parseColorWithAlpha(baseColor, '#0F172A');
        const nextAlpha = pose.shadowOpacity !== undefined
          ? roundTo3(clamp(pose.shadowOpacity, 0, 1))
          : parsedBase.alpha;
        const nextShadowColor = formatColorWithAlpha(parsedBase.hex, nextAlpha);
        const nextX = pose.shadowOffsetX !== undefined ? roundTo2(pose.shadowOffsetX) : (existingShadow?.x ?? 0);
        const nextY = pose.shadowOffsetY !== undefined ? roundTo2(pose.shadowOffsetY) : (existingShadow?.y ?? 12);
        const nextBlur = pose.shadowBlur !== undefined ? Math.max(0, roundTo2(pose.shadowBlur)) : (existingShadow?.blur ?? 24);
        const nextSpread = pose.shadowSpread !== undefined ? roundTo2(pose.shadowSpread) : (existingShadow?.spread ?? 0);
        nextEffects = [
          {
            id: existingShadow?.id ?? 'fx-anim-drop-shadow',
            type: 'drop-shadow',
            x: nextX,
            y: nextY,
            blur: nextBlur,
            spread: nextSpread,
            color: nextShadowColor,
            visible: true,
          },
          ...withoutDropShadow,
        ];
      }

      nextNode = {
        ...nextNode,
        effects: nextEffects.length > 0 ? nextEffects : undefined,
      } as DesignNode;
    }

    // Apply animated CSS Filters (brightness, contrast, saturate, grayscale)
    const hasCssFilterAnim = Boolean(
      pose && (
        pose.brightness !== undefined ||
        pose.contrast !== undefined ||
        pose.saturate !== undefined ||
        pose.grayscale !== undefined
      ),
    );

    if (hasCssFilterAnim && pose) {
      const nextFilters: NodeCssFilters = {
        ...(nextNode.cssFilters ?? {}),
        ...(pose.brightness !== undefined ? { brightness: Math.max(0, roundTo2(pose.brightness)) } : {}),
        ...(pose.contrast !== undefined ? { contrast: Math.max(0, roundTo2(pose.contrast)) } : {}),
        ...(pose.saturate !== undefined ? { saturate: Math.max(0, roundTo2(pose.saturate)) } : {}),
        ...(pose.grayscale !== undefined ? { grayscale: Math.max(0, roundTo2(pose.grayscale)) } : {}),
      };
      nextNode = {
        ...nextNode,
        cssFilters: nextFilters,
      } as DesignNode;
    }

    return nextNode;
  });

  if (!changed) return document;
  return {
    ...document,
    nodes: nextNodes,
  };
}

function normalizeAnimatableColor(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || trimmed.toLowerCase() === 'none') return 'rgba(0, 0, 0, 0)';
  if (trimmed.toLowerCase() === 'transparent') return 'transparent';
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^(?:rgba?|hsla?)\(\s*[0-9.%\s,/+-]+\s*\)$/i.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Returns the core transform/appearance properties captured by one-click full-object
 * keyframing (without cluttering timelines with untouched Modern Effects).
 */
export function getCoreAnimatablePropertiesForNode(node: DesignNode): AnimatableProperty[] {
  const base: AnimatableProperty[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
  switch (node.type) {
    case 'rect':
    case 'frame':
      return [...base, 'radius', 'fill', 'stroke', 'strokeWidth'];
    case 'ellipse':
    case 'path':
      return [...base, 'fill', 'stroke', 'strokeWidth'];
    case 'text':
      return [...base, 'fill'];
    case 'image':
      return [...base, 'radius', 'stroke', 'strokeWidth'];
    case 'group':
    case 'component-instance':
    default:
      return base;
  }
}

/**
 * Returns the complete list of animatable properties supported by a given DesignNode
 * including all Modern Effects (Blur, Backdrop Blur, Drop Shadow, CSS Filters).
 */
export function getAnimatablePropertiesForNode(node: DesignNode): AnimatableProperty[] {
  return [...getCoreAnimatablePropertiesForNode(node), ...MODERN_EFFECT_ANIMATABLE_PROPERTIES];
}

export function getDefaultNodePropertyValue(node: DesignNode, property: AnimatableProperty): number | string {
  switch (property) {
    case 'x':
      return roundTo2(node.x);
    case 'y':
      return roundTo2(node.y);
    case 'width':
      return Math.max(1, roundTo2(node.width));
    case 'height':
      return Math.max(1, roundTo2(node.height));
    case 'opacity':
      return roundTo3(clamp(node.opacity ?? 1, 0, 1));
    case 'rotation':
      return roundTo2(node.rotation ?? 0);
    case 'scale':
      return 1;
    case 'radius':
      return 'style' in node && 'radius' in node.style && typeof node.style.radius === 'number'
        ? Math.max(0, roundTo2(node.style.radius))
        : 0;
    case 'fill': {
      if ('style' in node && 'fill' in node.style) {
        if (typeof node.style.fill === 'string' && node.style.fill.trim().length > 0) {
          return normalizeAnimatableColor(node.style.fill, '#4f8cff');
        }
        if ('fills' in node.style && Array.isArray(node.style.fills)) {
          const firstSolid = node.style.fills.find(
            (item): item is Extract<typeof item, { type: 'solid' }> => item.visible !== false && item.type === 'solid',
          );
          if (firstSolid && firstSolid.color) {
            return normalizeAnimatableColor(firstSolid.color, '#4f8cff');
          }
        }
        return 'rgba(0, 0, 0, 0)';
      }
      return '#4f8cff';
    }
    case 'stroke': {
      if ('style' in node && 'stroke' in node.style) {
        if (typeof node.style.stroke === 'string' && node.style.stroke.trim().length > 0) {
          return normalizeAnimatableColor(node.style.stroke, 'rgba(0, 0, 0, 0)');
        }
        if ('strokes' in node.style && Array.isArray(node.style.strokes)) {
          const firstStroke = node.style.strokes.find((item) => item.visible !== false && typeof item.color === 'string');
          if (firstStroke && firstStroke.color) {
            return normalizeAnimatableColor(firstStroke.color, 'rgba(0, 0, 0, 0)');
          }
        }
        return 'rgba(0, 0, 0, 0)';
      }
      return 'rgba(0, 0, 0, 0)';
    }
    case 'strokeWidth':
      return 'style' in node && 'strokeWidth' in node.style && typeof node.style.strokeWidth === 'number'
        ? Math.max(0, roundTo2(node.style.strokeWidth))
        : 0;
    case 'layerBlur': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'layer-blur' }> =>
          item.type === 'layer-blur' && item.visible !== false,
      );
      return fx ? Math.max(0, roundTo2(fx.radius)) : 0;
    }
    case 'backdropBlur': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'backdrop-blur' }> =>
          item.type === 'backdrop-blur' && item.visible !== false,
      );
      return fx ? Math.max(0, roundTo2(fx.radius)) : 0;
    }
    case 'shadowOffsetX': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'drop-shadow' }> =>
          item.type === 'drop-shadow' && item.visible !== false,
      );
      return fx ? roundTo2(fx.x) : 0;
    }
    case 'shadowOffsetY': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'drop-shadow' }> =>
          item.type === 'drop-shadow' && item.visible !== false,
      );
      return fx ? roundTo2(fx.y) : 0;
    }
    case 'shadowBlur': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'drop-shadow' }> =>
          item.type === 'drop-shadow' && item.visible !== false,
      );
      return fx ? Math.max(0, roundTo2(fx.blur)) : 0;
    }
    case 'shadowSpread': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'drop-shadow' }> =>
          item.type === 'drop-shadow' && item.visible !== false,
      );
      return fx ? roundTo2(fx.spread ?? 0) : 0;
    }
    case 'shadowOpacity': {
      const fx = (node.effects ?? []).find(
        (item): item is Extract<VisualEffect, { type: 'drop-shadow' }> =>
          item.type === 'drop-shadow' && item.visible !== false,
      );
      if (!fx) return 0;
      return roundTo3(parseColorWithAlpha(fx.color, '#0F172A').alpha);
    }
    case 'brightness':
      return Math.max(0, roundTo2(node.cssFilters?.brightness ?? 100));
    case 'contrast':
      return Math.max(0, roundTo2(node.cssFilters?.contrast ?? 100));
    case 'saturate':
      return Math.max(0, roundTo2(node.cssFilters?.saturate ?? 100));
    case 'grayscale':
      return Math.max(0, roundTo2(node.cssFilters?.grayscale ?? 0));
  }
}

export function createAnimationClip(args: {
  id?: string;
  name: string;
  pageId: string;
  durationMs?: number;
  loop?: boolean;
  autoplay?: boolean;
  tracks?: AnimationTrack[];
}): AnimationClip {
  const now = new Date().toISOString();
  return {
    id: args.id ?? createMotionId('clip'),
    name: args.name.trim() || 'Untitled Motion',
    pageId: args.pageId,
    durationMs: clamp(Math.round(args.durationMs ?? 1200), 100, 60_000),
    loop: args.loop ?? false,
    autoplay: args.autoplay ?? false,
    tracks: args.tracks ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateClipSettings(
  clip: AnimationClip,
  patch: Partial<Pick<AnimationClip, 'name' | 'durationMs' | 'loop' | 'autoplay'>>,
): AnimationClip {
  const nextDuration = patch.durationMs !== undefined
    ? clamp(Math.round(patch.durationMs), 100, 60_000)
    : clip.durationMs;

  const clampedTracks = nextDuration < clip.durationMs
    ? clip.tracks.map((track) => ({
        ...track,
        keyframes: sortKeyframes(
          track.keyframes.map((kf) => ({
            ...kf,
            timeMs: clamp(kf.timeMs, 0, nextDuration),
          })),
        ),
      }))
    : clip.tracks;

  return {
    ...clip,
    name: patch.name !== undefined ? (patch.name.trim() || clip.name) : clip.name,
    durationMs: nextDuration,
    loop: patch.loop ?? clip.loop,
    autoplay: patch.autoplay ?? clip.autoplay,
    tracks: clampedTracks,
    updatedAt: new Date().toISOString(),
  };
}

export function addTrackToClip(
  clip: AnimationClip,
  node: DesignNode,
  property: AnimatableProperty,
): { clip: AnimationClip; trackId: string } {
  const existing = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === property);
  if (existing) return { clip, trackId: existing.id };

  const baseValue = getDefaultNodePropertyValue(node, property);
  const startValue: number | string = property === 'opacity'
    ? 0
    : property === 'y'
      ? roundTo2(Number(baseValue) + 28)
      : property === 'scale'
        ? 0.92
        : property === 'rotation'
          ? roundTo2(Number(baseValue) - 6)
          : baseValue;

  const trackId = createMotionId('track');
  const endTime = Math.min(clip.durationMs, Math.max(200, Math.round(clip.durationMs * 0.75)));
  const newTrack: AnimationTrack = {
    id: trackId,
    targetNodeId: node.id,
    property,
    keyframes: [
      { id: createMotionId('kf'), timeMs: 0, value: startValue, easing: 'linear' },
      { id: createMotionId('kf'), timeMs: endTime, value: baseValue, easing: 'ease-out' },
    ],
  };

  return {
    trackId,
    clip: {
      ...clip,
      tracks: [...clip.tracks, newTrack],
      updatedAt: new Date().toISOString(),
    },
  };
}

export function removeTrackFromClip(clip: AnimationClip, trackId: string): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.filter((t) => t.id !== trackId),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertKeyframeInClip(
  clip: AnimationClip,
  trackId: string,
  timeMs: number,
  value: number | string,
  easing: AnimationEasing = 'ease-out',
): { clip: AnimationClip; keyframeId: string } {
  const clampedTime = clamp(Math.round(timeMs), 0, clip.durationMs);
  let targetKfId = '';
  const nextTracks = clip.tracks.map((track) => {
    if (track.id !== trackId) return track;
    const near = track.keyframes.find((kf) => Math.abs(kf.timeMs - clampedTime) <= 15);
    if (near) {
      targetKfId = near.id;
      return {
        ...track,
        keyframes: sortKeyframes(
          track.keyframes.map((kf) => (kf.id === near.id ? { ...kf, timeMs: clampedTime, value, easing } : kf)),
        ),
      };
    }
    const created: AnimationKeyframe = {
      id: createMotionId('kf'),
      timeMs: clampedTime,
      value,
      easing,
    };
    targetKfId = created.id;
    return {
      ...track,
      keyframes: sortKeyframes([...track.keyframes, created]),
    };
  });

  return {
    keyframeId: targetKfId,
    clip: {
      ...clip,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function updateKeyframeInClip(
  clip: AnimationClip,
  trackId: string,
  keyframeId: string,
  patch: Partial<Pick<AnimationKeyframe, 'timeMs' | 'value' | 'easing'>>,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        keyframes: sortKeyframes(
          track.keyframes.map((kf) => {
            if (kf.id !== keyframeId) return kf;
            return {
              ...kf,
              ...(patch.timeMs !== undefined ? { timeMs: clamp(Math.round(patch.timeMs), 0, clip.durationMs) } : {}),
              ...(patch.value !== undefined ? { value: patch.value } : {}),
              ...(patch.easing !== undefined ? { easing: patch.easing } : {}),
            };
          }),
        ),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function deleteKeyframeFromClip(
  clip: AnimationClip,
  trackId: string,
  keyframeId: string,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        keyframes: track.keyframes.filter((kf) => kf.id !== keyframeId),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function areAnimatableValuesEqual(a: number | string, b: number | string): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-4;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Captures a unified full-object keyframe snapshot at `timeMs` covering all
 * supported animatable properties for `node` (position, size, rotation, opacity,
 * radius, fill, stroke, strokeWidth). When creating a brand-new track at
 * `timeMs > 0` with a `baselineNode`, automatically seeds a `0ms` baseline
 * keyframe so motion interpolates immediately without manual setup.
 */
export function captureNodeKeyframeSnapshot(
  clip: AnimationClip,
  node: DesignNode,
  timeMs: number,
  options?: {
    baselineNode?: DesignNode;
    properties?: readonly AnimatableProperty[];
    easing?: AnimationEasing;
  },
): { clip: AnimationClip; capturedProperties: readonly AnimatableProperty[] } {
  const properties = options?.properties && options.properties.length > 0
    ? [...options.properties]
    : getCoreAnimatablePropertiesForNode(node);
  const clampedTime = clamp(Math.round(timeMs), 0, clip.durationMs);
  const easing = options?.easing ?? 'ease-out';
  const baselineNode = options?.baselineNode;

  let nextTracks = [...clip.tracks];
  for (const property of properties) {
    const value = getDefaultNodePropertyValue(node, property);
    const existingIndex = nextTracks.findIndex(
      (track) => track.targetNodeId === node.id && track.property === property,
    );

    if (existingIndex === -1) {
      const keyframes: AnimationKeyframe[] = [];
      if (clampedTime > 0 && baselineNode) {
        keyframes.push({
          id: createMotionId('kf'),
          timeMs: 0,
          value: getDefaultNodePropertyValue(baselineNode, property),
          easing: 'linear',
        });
      }
      keyframes.push({
        id: createMotionId('kf'),
        timeMs: clampedTime,
        value,
        easing: clampedTime === 0 ? 'linear' : easing,
      });
      nextTracks.push({
        id: createMotionId('track'),
        targetNodeId: node.id,
        property,
        keyframes: sortKeyframes(keyframes),
      });
    } else {
      const track = nextTracks[existingIndex];
      const near = track.keyframes.find((kf) => Math.abs(kf.timeMs - clampedTime) <= 15);
      const nextKeyframes = near
        ? track.keyframes.map((kf) => (kf.id === near.id ? { ...kf, timeMs: clampedTime, value } : kf))
        : [
            ...track.keyframes,
            {
              id: createMotionId('kf'),
              timeMs: clampedTime,
              value,
              easing: clampedTime === 0 ? 'linear' : easing,
            },
          ];
      nextTracks[existingIndex] = {
        ...track,
        keyframes: sortKeyframes(nextKeyframes),
      };
    }
  }

  return {
    capturedProperties: properties,
    clip: {
      ...clip,
      tracks: nextTracks,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Checks whether a specific node property has a keyframe within 15ms of `timeMs`.
 */
export function hasKeyframeAtTime(
  clip: AnimationClip | null | undefined,
  nodeId: string,
  property: AnimatableProperty,
  timeMs: number,
): boolean {
  if (!clip) return false;
  const track = clip.tracks.find((t) => t.targetNodeId === nodeId && t.property === property);
  if (!track) return false;
  const clampedTime = clamp(Math.round(timeMs), 0, clip.durationMs);
  return track.keyframes.some((kf) => Math.abs(kf.timeMs - clampedTime) <= 15);
}

/**
 * Toggles a single property keyframe at `timeMs` (used by Inspector diamond icons).
 * - If a keyframe already exists within 15ms of `timeMs`, removes it (and prunes the track if empty).
 * - Otherwise inserts/upserts a keyframe with the node's current property value (auto-seeding
 *   a 0ms baseline from `baselineNode` if creating a new track at `timeMs > 0`).
 */
export function togglePropertyKeyframeInClip(
  clip: AnimationClip,
  node: DesignNode,
  property: AnimatableProperty,
  timeMs: number,
  options?: { baselineNode?: DesignNode; easing?: AnimationEasing },
): { clip: AnimationClip; action: 'added' | 'removed' } {
  const clampedTime = clamp(Math.round(timeMs), 0, clip.durationMs);
  const existingTrack = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === property);
  const nearKf = existingTrack?.keyframes.find((kf) => Math.abs(kf.timeMs - clampedTime) <= 15);

  if (existingTrack && nearKf) {
    const remaining = existingTrack.keyframes.filter((kf) => kf.id !== nearKf.id);
    const nextTracks = remaining.length > 0
      ? clip.tracks.map((t) => (t.id === existingTrack.id ? { ...t, keyframes: remaining } : t))
      : clip.tracks.filter((t) => t.id !== existingTrack.id);
    return {
      action: 'removed',
      clip: {
        ...clip,
        tracks: nextTracks,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  const { clip: nextClip } = captureNodeKeyframeSnapshot(clip, node, clampedTime, {
    baselineNode: options?.baselineNode,
    properties: [property],
    easing: options?.easing ?? 'ease-out',
  });
  return {
    action: 'added',
    clip: nextClip,
  };
}

/**
 * Inspects an edit from `beforeNode` -> `afterNode` during Motion Auto-Key mode.
 * Supports both core properties AND all 11 Modern Effects properties.
 * Captures changed properties plus existing tracked properties (and core properties
 * when core attributes changed) without polluting the timeline with untouched effects.
 */
export function applyAutoKeyFromNodeChange(
  clip: AnimationClip,
  beforeNode: DesignNode,
  afterNode: DesignNode,
  timeMs: number,
  options?: {
    baselineNode?: DesignNode;
    easing?: AnimationEasing;
  },
): {
  clip: AnimationClip;
  recorded: boolean;
  changedProperties: AnimatableProperty[];
} {
  const allProperties = getAnimatablePropertiesForNode(afterNode);
  const corePropertySet = new Set(getCoreAnimatablePropertiesForNode(afterNode));
  const changedProperties: AnimatableProperty[] = [];
  for (const property of allProperties) {
    const beforeValue = getDefaultNodePropertyValue(beforeNode, property);
    const afterValue = getDefaultNodePropertyValue(afterNode, property);
    if (!areAnimatableValuesEqual(beforeValue, afterValue)) {
      changedProperties.push(property);
    }
  }

  if (changedProperties.length === 0) {
    return { clip, recorded: false, changedProperties: [] };
  }

  const targetPropertySet = new Set<AnimatableProperty>(changedProperties);
  const hasCoreChange = changedProperties.some((p) => corePropertySet.has(p));
  if (hasCoreChange) {
    for (const coreProp of corePropertySet) {
      targetPropertySet.add(coreProp);
    }
  }
  for (const track of clip.tracks) {
    if (track.targetNodeId === afterNode.id) {
      targetPropertySet.add(track.property);
    }
  }

  const { clip: nextClip } = captureNodeKeyframeSnapshot(clip, afterNode, timeMs, {
    baselineNode: options?.baselineNode ?? beforeNode,
    properties: [...targetPropertySet],
    easing: options?.easing ?? 'ease-out',
  });

  return {
    clip: nextClip,
    recorded: true,
    changedProperties,
  };
}

export interface GroupedAnimationLayer {
  readonly targetNodeId: string;
  readonly tracks: readonly AnimationTrack[];
  readonly keyframeTimes: readonly number[];
}

/**
 * Groups flat AnimationTracks by `targetNodeId` in stable order so the Motion
 * Timeline can render one clean master row per animated object with expandable
 * per-property sub-tracks.
 */
export function groupClipTracksByNode(clip: AnimationClip): GroupedAnimationLayer[] {
  const map = new Map<string, AnimationTrack[]>();
  for (const track of clip.tracks) {
    const existing = map.get(track.targetNodeId);
    if (existing) {
      existing.push(track);
    } else {
      map.set(track.targetNodeId, [track]);
    }
  }

  const groups: GroupedAnimationLayer[] = [];
  for (const [targetNodeId, tracks] of map.entries()) {
    const timeSet = new Set<number>();
    for (const track of tracks) {
      for (const kf of track.keyframes) {
        timeSet.add(Math.round(kf.timeMs));
      }
    }
    groups.push({
      targetNodeId,
      tracks,
      keyframeTimes: [...timeSet].sort((a, b) => a - b),
    });
  }
  return groups;
}

/**
 * Moves all keyframes belonging to `targetNodeId` at `fromTimeMs` together to `toTimeMs`.
 */
export function moveLayerKeyframesInClip(
  clip: AnimationClip,
  targetNodeId: string,
  fromTimeMs: number,
  toTimeMs: number,
): AnimationClip {
  const clampedTo = clamp(Math.round(toTimeMs), 0, clip.durationMs);
  const roundedFrom = Math.round(fromTimeMs);
  if (clampedTo === roundedFrom) return clip;

  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetNodeId !== targetNodeId) return track;
      const moved = track.keyframes.map((kf) =>
        Math.abs(kf.timeMs - roundedFrom) <= 1 ? { ...kf, timeMs: clampedTo } : kf,
      );
      // Deduplicate if dragged directly onto an existing keyframe timestamp
      const deduped: AnimationKeyframe[] = [];
      for (const kf of sortKeyframes(moved)) {
        const last = deduped[deduped.length - 1];
        if (last && Math.abs(last.timeMs - kf.timeMs) <= 1) {
          deduped[deduped.length - 1] = kf;
        } else {
          deduped.push(kf);
        }
      }
      return { ...track, keyframes: deduped };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deletes every keyframe at `timeMs` across all tracks for `targetNodeId`.
 */
export function deleteLayerKeyframesAtTimeInClip(
  clip: AnimationClip,
  targetNodeId: string,
  timeMs: number,
): AnimationClip {
  const roundedTime = Math.round(timeMs);
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetNodeId !== targetNodeId) return track;
      return {
        ...track,
        keyframes: track.keyframes.filter((kf) => Math.abs(kf.timeMs - roundedTime) > 1),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes all animation tracks belonging to `targetNodeId` from the clip.
 */
export function removeLayerTracksFromClip(clip: AnimationClip, targetNodeId: string): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.filter((track) => track.targetNodeId !== targetNodeId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates the easing curve of all keyframes at `timeMs` across all tracks for `targetNodeId`.
 */
export function updateLayerKeyframesEasingInClip(
  clip: AnimationClip,
  targetNodeId: string,
  timeMs: number,
  easing: AnimationEasing,
): AnimationClip {
  const roundedTime = Math.round(timeMs);
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetNodeId !== targetNodeId) return track;
      return {
        ...track,
        keyframes: track.keyframes.map((kf) =>
          Math.abs(kf.timeMs - roundedTime) <= 1 ? { ...kf, easing } : kf,
        ),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Builds a ready-to-play AnimationClip from a preset targeting selected nodes (or top visible page nodes).
 */
export function buildPresetClipForPage(
  page: FolioPage,
  presetId: MotionPresetDefinition['id'],
  preferredNodeIds: readonly string[] = [],
  clipId?: string,
): AnimationClip {
  const candidates = preferredNodeIds.length > 0
    ? preferredNodeIds
        .map((id) => page.document.nodes.find((n) => n.id === id))
        .filter((n): n is DesignNode => Boolean(n && n.visible && n.onCanvas !== false))
    : page.document.nodes.filter((n) => n.visible && n.onCanvas !== false && n.type !== 'frame').slice(0, 3);

  const fallbackNodes = candidates.length > 0
    ? candidates
    : page.document.nodes.filter((n) => n.visible).slice(0, 2);

  const now = new Date().toISOString();

  if (presetId === 'orbit-float') {
    const tracks: AnimationTrack[] = [];
    fallbackNodes.forEach((node, idx) => {
      const baseY = roundTo2(node.y);
      const offset = idx % 2 === 0 ? -14 : 12;
      tracks.push({
        id: `track-orbit-y-${node.id}`,
        targetNodeId: node.id,
        property: 'y',
        keyframes: [
          { id: `kf-oy-0-${idx}`, timeMs: 0, value: baseY, easing: 'linear' },
          { id: `kf-oy-1-${idx}`, timeMs: 1200, value: roundTo2(baseY + offset), easing: 'ease-in-out' },
          { id: `kf-oy-2-${idx}`, timeMs: 2400, value: baseY, easing: 'ease-in-out' },
        ],
      });
      tracks.push({
        id: `track-orbit-rot-${node.id}`,
        targetNodeId: node.id,
        property: 'rotation',
        keyframes: [
          { id: `kf-or-0-${idx}`, timeMs: 0, value: roundTo2(node.rotation), easing: 'linear' },
          { id: `kf-or-1-${idx}`, timeMs: 1200, value: roundTo2(node.rotation + (idx % 2 === 0 ? 3 : -3)), easing: 'ease-in-out' },
          { id: `kf-or-2-${idx}`, timeMs: 2400, value: roundTo2(node.rotation), easing: 'ease-in-out' },
        ],
      });
    });
    return {
      id: clipId ?? createMotionId('clip'),
      name: 'Orbit Float',
      pageId: page.id,
      durationMs: 2400,
      loop: true,
      autoplay: false,
      tracks,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (presetId === 'pulse-glow') {
    const tracks: AnimationTrack[] = [];
    fallbackNodes.forEach((node, idx) => {
      const baseOpacity = roundTo2(node.opacity ?? 1);
      tracks.push({
        id: `track-pulse-scale-${node.id}`,
        targetNodeId: node.id,
        property: 'scale',
        keyframes: [
          { id: `kf-ps-0-${idx}`, timeMs: 0, value: 1, easing: 'linear' },
          { id: `kf-ps-1-${idx}`, timeMs: 800, value: 1.07, easing: 'ease-in-out' },
          { id: `kf-ps-2-${idx}`, timeMs: 1600, value: 1, easing: 'ease-in-out' },
        ],
      });
      tracks.push({
        id: `track-pulse-op-${node.id}`,
        targetNodeId: node.id,
        property: 'opacity',
        keyframes: [
          { id: `kf-po-0-${idx}`, timeMs: 0, value: baseOpacity, easing: 'linear' },
          { id: `kf-po-1-${idx}`, timeMs: 800, value: roundTo2(Math.max(0.55, baseOpacity * 0.72)), easing: 'ease-in-out' },
          { id: `kf-po-2-${idx}`, timeMs: 1600, value: baseOpacity, easing: 'ease-in-out' },
        ],
      });
    });
    return {
      id: clipId ?? createMotionId('clip'),
      name: 'Pulse Glow',
      pageId: page.id,
      durationMs: 1600,
      loop: true,
      autoplay: false,
      tracks,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Default: Hero Entrance (staggered fade-up + spring lift)
  const tracks: AnimationTrack[] = [];
  fallbackNodes.forEach((node, idx) => {
    const delay = Math.min(400, idx * 140);
    const end = Math.min(1200, delay + 720);
    const baseY = roundTo2(node.y);
    const baseOpacity = roundTo2(node.opacity ?? 1);
    tracks.push({
      id: `track-hero-y-${node.id}`,
      targetNodeId: node.id,
      property: 'y',
      keyframes: [
        ...(delay > 0 ? [{ id: `kf-hy-pre-${idx}`, timeMs: 0, value: roundTo2(baseY + 36), easing: 'linear' as const }] : []),
        { id: `kf-hy-0-${idx}`, timeMs: delay, value: roundTo2(baseY + 36), easing: 'linear' },
        { id: `kf-hy-1-${idx}`, timeMs: end, value: baseY, easing: 'spring' },
      ],
    });
    tracks.push({
      id: `track-hero-op-${node.id}`,
      targetNodeId: node.id,
      property: 'opacity',
      keyframes: [
        ...(delay > 0 ? [{ id: `kf-ho-pre-${idx}`, timeMs: 0, value: 0, easing: 'linear' as const }] : []),
        { id: `kf-ho-0-${idx}`, timeMs: delay, value: 0, easing: 'linear' },
        { id: `kf-ho-1-${idx}`, timeMs: Math.min(1200, delay + 540), value: baseOpacity, easing: 'ease-out' },
      ],
    });
  });

  return {
    id: clipId ?? createMotionId('clip'),
    name: 'Hero Entrance',
    pageId: page.id,
    durationMs: 1200,
    loop: false,
    autoplay: true,
    tracks,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates the deterministic starter "Hero Entrance" animation clip for the interactive starter page.
 */
export function createStarterHeroEntranceClip(page: FolioPage): AnimationClip {
  const card = page.document.nodes.find((n) => n.name === 'Visual card');
  const sun = page.document.nodes.find((n) => n.name === 'Sun');
  const caption = page.document.nodes.find((n) => n.name === 'Card caption');
  const targets = [card, sun, caption].filter((n): n is DesignNode => Boolean(n));
  return buildPresetClipForPage(
    page,
    'hero-entrance',
    targets.map((n) => n.id),
    'clip-hero-entrance',
  );
}

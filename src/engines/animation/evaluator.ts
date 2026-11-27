import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationKeyframe,
  AnimationTrack,
  DesignNode,
  FolioDocument,
  FolioPage,
  MotionPathBinding,
  NodeCssFilters,
  TrimPathMode,
  VectorAnchorPoint,
  VisualEffect,
} from '../../core/document/types';
import {
  formatColorWithAlpha,
  parseColorWithAlpha,
  parseCssColorRgba,
} from '../../core/document/styling';
import { scalePathNodeGeometry } from '../../core/document/vector';
import {
  applyMorphGeometryToDesignNode,
  createMorphPresetSnapshot,
  evaluateMorphSnapshotsToAnchors,
  extractMorphSnapshotFromNode,
  interpolatePathMorph,
  type EvaluatedMorphGeometry,
  type MorphShapePresetId,
} from '../../core/document/pathMorph';
import {
  cloneVectorAnchorPoints,
  createDefaultMotionPathForNode,
  evaluateMotionPathAtProgress,
  evaluateMotionPathBindingAtTime,
} from '../../core/document/pathStudio';
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
  'pathMorph',
  'motionPathProgress',
  'motionPathStart',
  'motionPathEnd',
  'motionPathOffset',
  'trimStart',
  'trimEnd',
  'trimOffset',
  ...MODERN_EFFECT_ANIMATABLE_PROPERTIES,
]);

export const ANIMATABLE_PROPERTY_META: Readonly<Record<AnimatableProperty, {
  label: string;
  unit: string;
  step: number;
  min?: number;
  max?: number;
  kind: 'number' | 'color' | 'morph';
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
  pathMorph: { label: 'Shape Points & Curves', unit: '', step: 0, kind: 'morph' },
  motionPathProgress: { label: 'Path Progress', unit: '%', step: 1, min: -1000, max: 1000, kind: 'number' },
  motionPathStart: { label: 'Path Start', unit: '%', step: 1, min: 0, max: 100, kind: 'number' },
  motionPathEnd: { label: 'Path End', unit: '%', step: 1, min: 0, max: 100, kind: 'number' },
  motionPathOffset: { label: 'Path Offset', unit: 'px', step: 1, min: -4000, max: 4000, kind: 'number' },
  trimStart: { label: 'Trim Start', unit: '%', step: 1, min: 0, max: 100, kind: 'number' },
  trimEnd: { label: 'Trim End', unit: '%', step: 1, min: 0, max: 100, kind: 'number' },
  trimOffset: { label: 'Trim Offset', unit: '%', step: 1, min: -1000, max: 1000, kind: 'number' },
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
  pathMorph?: string;
  /** Pre-evaluated morph geometry produced directly from cached PreparedMorphPair (zero JSON overhead). */
  pathMorphGeometry?: EvaluatedMorphGeometry;
  motionPathProgress?: number;
  motionPathStart?: number;
  motionPathEnd?: number;
  motionPathOffset?: number;
  motionPathCenterX?: number;
  motionPathCenterY?: number;
  motionPathAutoOrient?: boolean;
  motionPathRotationDeg?: number;
  trimStart?: number;
  trimEnd?: number;
  trimOffset?: number;
  trimMode?: TrimPathMode;
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
  id: 'hero-entrance' | 'orbit-float' | 'pulse-glow' | 'motion-path-cruise' | 'trim-logo-reveal';
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
  {
    id: 'motion-path-cruise',
    name: 'Motion Path Cruise',
    description: 'Follows an editable cubic Bézier trajectory with constant speed and auto-orient',
    durationMs: 2400,
    loop: true,
  },
  {
    id: 'trim-logo-reveal',
    name: 'Trim Path Reveal',
    description: 'Progressively draws vector and shape strokes from 0% to 100%',
    durationMs: 1400,
    loop: false,
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
    if (track.property === 'trimStart' || track.property === 'trimEnd' || track.property === 'motionPathStart' || track.property === 'motionPathEnd') {
      return roundTo2(clamp(Number(val), 0, 100));
    }
    if (track.property === 'trimOffset' || track.property === 'motionPathProgress') {
      return roundTo2(clamp(Number(val), -1000, 1000));
    }
    if (track.property === 'motionPathOffset') {
      return roundTo2(clamp(Number(val), -4000, 4000));
    }
    return val;
  }
  const last = sorted[sorted.length - 1];
  if (timeMs >= last.timeMs) {
    const val = last.value;
    if (track.property === 'opacity' || track.property === 'shadowOpacity') {
      return roundTo3(clamp(Number(val), 0, 1));
    }
    if (track.property === 'trimStart' || track.property === 'trimEnd' || track.property === 'motionPathStart' || track.property === 'motionPathEnd') {
      return roundTo2(clamp(Number(val), 0, 100));
    }
    if (track.property === 'trimOffset' || track.property === 'motionPathProgress') {
      return roundTo2(clamp(Number(val), -1000, 1000));
    }
    if (track.property === 'motionPathOffset') {
      return roundTo2(clamp(Number(val), -4000, 4000));
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
      if (track.property === 'pathMorph') {
        return interpolatePathMorph(String(start.value), String(end.value), easedT);
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
      if (track.property === 'trimStart' || track.property === 'trimEnd' || track.property === 'motionPathStart' || track.property === 'motionPathEnd') {
        return roundTo2(clamp(interpolated, 0, 100));
      }
      if (track.property === 'trimOffset' || track.property === 'motionPathProgress') {
        return roundTo2(clamp(interpolated, -1000, 1000));
      }
      if (track.property === 'motionPathOffset') {
        return roundTo2(clamp(interpolated, -4000, 4000));
      }
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
 * Hot-path evaluator for `pathMorph` tracks that reads directly from cached
 * `PreparedMorphPair` Float64Array buffers without per-frame JSON.stringify/parse.
 */
function evaluateMorphTrackToGeometry(
  track: AnimationTrack,
  timeMs: number,
): EvaluatedMorphGeometry | null {
  if (track.keyframes.length === 0) return null;
  const sorted = sortKeyframes(track.keyframes);
  const idPrefix = `${track.targetNodeId}-pt`;
  if (sorted.length === 1 || timeMs <= sorted[0].timeMs) {
    const snapStr = String(sorted[0].value);
    return evaluateMorphSnapshotsToAnchors(snapStr, snapStr, 0, undefined, idPrefix);
  }
  const last = sorted[sorted.length - 1];
  if (timeMs >= last.timeMs) {
    const snapStr = String(last.value);
    return evaluateMorphSnapshotsToAnchors(snapStr, snapStr, 1, undefined, idPrefix);
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (timeMs >= start.timeMs && timeMs <= end.timeMs) {
      const span = end.timeMs - start.timeMs;
      if (span <= 0) {
        const endStr = String(end.value);
        return evaluateMorphSnapshotsToAnchors(endStr, endStr, 1, undefined, idPrefix);
      }
      const rawT = (timeMs - start.timeMs) / span;
      const easedT = evaluateEasing(end.easing, rawT);
      return evaluateMorphSnapshotsToAnchors(
        String(start.value),
        String(end.value),
        easedT,
        undefined,
        idPrefix,
      );
    }
  }
  const endStr = String(last.value);
  return evaluateMorphSnapshotsToAnchors(endStr, endStr, 1, undefined, idPrefix);
}

/**
 * Evaluates all tracks in an AnimationClip at `timeMs` (automatically wrapping if `clip.loop` is true).
 */
export const MOTION_PATH_POSITION_PROPERTIES: readonly AnimatableProperty[] = Object.freeze([
  'x',
  'y',
]);

/**
 * Returns `true` when `nodeId` is driven by an active Motion Path binding in `clip`.
 * While active, Motion Path owns the layer's position (`x`, `y`) so independent X/Y
 * keyframes are excluded to prevent transform conflicts — rotation, size, scale,
 * opacity, color, stroke, morph, trim, and effects remain freely keyframeable.
 */
export function hasActiveMotionPathForNode(
  clip: AnimationClip | null | undefined,
  nodeId: string,
): boolean {
  if (!clip?.motionPaths || clip.motionPaths.length === 0) return false;
  return clip.motionPaths.some((mp) => mp.targetNodeId === nodeId && mp.points.length >= 2);
}

/**
 * Returns `true` when `property` (`x` or `y`) is locked because `nodeId` is driven
 * by an active Motion Path binding in `clip`.
 */
export function isPropertyLockedByMotionPath(
  clip: AnimationClip | null | undefined,
  nodeId: string,
  property: AnimatableProperty,
): boolean {
  return (property === 'x' || property === 'y') && hasActiveMotionPathForNode(clip, nodeId);
}

export function evaluateClipAtTime(
  clip: AnimationClip,
  timeMs: number,
): Record<string, AnimatedNodePose> {
  const effectiveTime = clip.durationMs <= 0
    ? 0
    : clip.loop && timeMs > clip.durationMs
      ? timeMs % clip.durationMs
      : clamp(timeMs, 0, clip.durationMs);

  const motionPathNodeIds = new Set<string>(
    (clip.motionPaths ?? [])
      .filter((mp) => mp.points.length >= 2)
      .map((mp) => mp.targetNodeId),
  );

  const poses: Record<string, AnimatedNodePose> = {};
  for (const track of clip.tracks) {
    // Defense-in-depth: Motion Path owns X/Y positioning; ignore any legacy X/Y tracks to prevent collision.
    if (
      (track.property === 'x' || track.property === 'y') &&
      motionPathNodeIds.has(track.targetNodeId)
    ) {
      continue;
    }
    if (track.property === 'pathMorph') {
      const morphGeom = evaluateMorphTrackToGeometry(track, effectiveTime);
      if (morphGeom) {
        const pose = poses[track.targetNodeId] ?? (poses[track.targetNodeId] = {});
        pose.pathMorphGeometry = morphGeom;
      }
      continue;
    }
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
    if (
      (track.property === 'trimStart' || track.property === 'trimEnd' || track.property === 'trimOffset') &&
      track.trimMode
    ) {
      pose.trimMode = track.trimMode;
    }
  }

  // Evaluate Motion Path bindings (with keyframed path geometry + independent Start/End/Offset channels)
  if (clip.motionPaths && clip.motionPaths.length > 0) {
    const defaultProgressPct = clip.durationMs > 0 ? (effectiveTime / clip.durationMs) * 100 : 0;
    for (const binding of clip.motionPaths) {
      if (binding.points.length < 2) continue;
      const pose = poses[binding.targetNodeId] ?? (poses[binding.targetNodeId] = {});
      const progressPct = pose.motionPathProgress !== undefined
        ? pose.motionPathProgress
        : defaultProgressPct;
      const timedBinding = evaluateMotionPathBindingAtTime(binding, effectiveTime, evaluateEasing);
      const effectiveBinding: MotionPathBinding =
        pose.motionPathStart !== undefined ||
        pose.motionPathEnd !== undefined ||
        pose.motionPathOffset !== undefined
          ? {
              ...timedBinding,
              startPct: pose.motionPathStart !== undefined ? clamp(pose.motionPathStart, 0, 100) : timedBinding.startPct,
              endPct: pose.motionPathEnd !== undefined ? clamp(pose.motionPathEnd, 0, 100) : timedBinding.endPct,
              offsetPx: pose.motionPathOffset !== undefined ? clamp(pose.motionPathOffset, -4000, 4000) : timedBinding.offsetPx,
            }
          : timedBinding;
      const sample = evaluateMotionPathAtProgress(effectiveBinding, progressPct);
      if (!sample) continue;
      pose.motionPathCenterX = roundTo2(sample.x);
      pose.motionPathCenterY = roundTo2(sample.y);
      if (effectiveBinding.autoOrient) {
        pose.motionPathAutoOrient = true;
        pose.motionPathRotationDeg = roundTo2(sample.tangentAngleDeg + (effectiveBinding.orientOffsetDeg ?? 0));
      }
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
      const ancW = ancPose.width !== undefined ? Math.max(1, roundTo2(ancPose.width)) : anc.width;
      const ancH = ancPose.height !== undefined ? Math.max(1, roundTo2(ancPose.height)) : anc.height;
      const ancX = ancPose.motionPathCenterX !== undefined
        ? roundTo2(ancPose.motionPathCenterX - ancW / 2)
        : ancPose.x;
      const ancY = ancPose.motionPathCenterY !== undefined
        ? roundTo2(ancPose.motionPathCenterY - ancH / 2)
        : ancPose.y;
      if (inheritedDx === 0 && ancX !== undefined) {
        inheritedDx = ancX - anc.x;
      }
      if (inheritedDy === 0 && ancY !== undefined) {
        inheritedDy = ancY - anc.y;
      }
      const ancEffectiveRot = ancPose.motionPathAutoOrient && ancPose.motionPathRotationDeg !== undefined
        ? roundTo2(ancPose.motionPathRotationDeg + (ancPose.rotation !== undefined ? ancPose.rotation - (anc.rotation || 0) : 0))
        : ancPose.rotation;
      if (!hasOrbit && anc.type !== 'group' && ancEffectiveRot !== undefined) {
        const dRot = ancEffectiveRot - (anc.rotation || 0);
        if (Math.abs(dRot) > 0.001) {
          inheritedRotDelta = dRot;
          orbitOriginX = (ancX ?? anc.x) + ancW / 2;
          orbitOriginY = (ancY ?? anc.y) + ancH / 2;
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

    const baseWidth = pose?.width !== undefined ? Math.max(1, roundTo2(pose.width)) : node.width;
    const baseHeight = pose?.height !== undefined ? Math.max(1, roundTo2(pose.height)) : node.height;
    let baseX = pose?.motionPathCenterX !== undefined
      ? roundTo2(pose.motionPathCenterX - baseWidth / 2)
      : pose?.x !== undefined
        ? pose.x
        : roundTo2(node.x + inheritedDx);
    let baseY = pose?.motionPathCenterY !== undefined
      ? roundTo2(pose.motionPathCenterY - baseHeight / 2)
      : pose?.y !== undefined
        ? pose.y
        : roundTo2(node.y + inheritedDy);

    // Orbit un-keyed child center around animated rotated Frame parent's center to match CSS DOM nesting
    if (
      hasOrbit &&
      pose?.motionPathCenterX === undefined &&
      pose?.motionPathCenterY === undefined &&
      pose?.x === undefined &&
      pose?.y === undefined
    ) {
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
      pose?.motionPathAutoOrient && pose.motionPathRotationDeg !== undefined
        ? roundTo2(pose.motionPathRotationDeg + (pose.rotation !== undefined ? pose.rotation - (node.rotation || 0) : 0))
        : pose?.rotation !== undefined
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

    let nextNode: DesignNode;
    const morphPayload = pose?.pathMorphGeometry ?? pose?.pathMorph;
    if (
      morphPayload &&
      (node.type === 'path' ||
        node.type === 'ellipse' ||
        node.type === 'rect' ||
        node.type === 'frame')
    ) {
      const morphed = applyMorphGeometryToDesignNode(node, morphPayload);
      if (morphed.type === 'path' && (scaledWidth !== morphed.width || scaledHeight !== morphed.height)) {
        nextNode = {
          ...scalePathNodeGeometry(morphed, centeredX, centeredY, scaledWidth, scaledHeight),
          rotation: basePatch.rotation,
          opacity: basePatch.opacity,
        };
      } else {
        nextNode = {
          ...morphed,
          ...basePatch,
        };
      }
    } else if (node.type === 'path' && (scaledWidth !== node.width || scaledHeight !== node.height)) {
      nextNode = {
        ...scalePathNodeGeometry(node, centeredX, centeredY, scaledWidth, scaledHeight),
        rotation: basePatch.rotation,
        opacity: basePatch.opacity,
      };
    } else {
      nextNode = { ...node, ...basePatch } as DesignNode;
    }

    const hasStyleAnim = Boolean(
      pose && (
        pose.fill !== undefined ||
        pose.stroke !== undefined ||
        pose.strokeWidth !== undefined ||
        pose.radius !== undefined ||
        pose.trimStart !== undefined ||
        pose.trimEnd !== undefined ||
        pose.trimOffset !== undefined ||
        pose.trimMode !== undefined
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
        if ('cornerRadii' in nextStyle) {
          delete nextStyle.cornerRadii;
        }
      }
      if ('stroke' in nextNode.style) {
        if (pose.trimStart !== undefined) {
          nextStyle.trimStart = clamp(roundTo2(pose.trimStart), 0, 100);
        }
        if (pose.trimEnd !== undefined) {
          nextStyle.trimEnd = clamp(roundTo2(pose.trimEnd), 0, 100);
        }
        if (pose.trimOffset !== undefined) {
          nextStyle.trimOffset = clamp(roundTo2(pose.trimOffset), -1000, 1000);
        }
        if (pose.trimMode !== undefined) {
          nextStyle.trimMode = pose.trimMode;
        }
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
      return [...base, 'fill', 'stroke', 'strokeWidth'];
    case 'path':
      return [...base, 'fill', 'stroke', 'strokeWidth', 'pathMorph'];
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
    case 'pathMorph':
      return extractMorphSnapshotFromNode(node) ?? '';
    case 'motionPathProgress':
      return 0;
    case 'motionPathStart':
      return 0;
    case 'motionPathEnd':
      return 100;
    case 'motionPathOffset':
      return 0;
    case 'trimStart':
      return 'style' in node && 'trimStart' in node.style && typeof node.style.trimStart === 'number'
        ? clamp(roundTo2(node.style.trimStart), 0, 100)
        : 0;
    case 'trimEnd':
      return 'style' in node && 'trimEnd' in node.style && typeof node.style.trimEnd === 'number'
        ? clamp(roundTo2(node.style.trimEnd), 0, 100)
        : 100;
    case 'trimOffset':
      return 'style' in node && 'trimOffset' in node.style && typeof node.style.trimOffset === 'number'
        ? clamp(roundTo2(node.style.trimOffset), -1000, 1000)
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

  const clampedMotionPaths =
    nextDuration < clip.durationMs && clip.motionPaths
      ? clip.motionPaths.map((mp) =>
          mp.pathKeyframes && mp.pathKeyframes.length > 0
            ? {
                ...mp,
                pathKeyframes: [...mp.pathKeyframes]
                  .map((pkf) => ({ ...pkf, timeMs: clamp(pkf.timeMs, 0, nextDuration) }))
                  .sort((a, b) => a.timeMs - b.timeMs),
              }
            : mp,
        )
      : clip.motionPaths;

  return {
    ...clip,
    name: patch.name !== undefined ? (patch.name.trim() || clip.name) : clip.name,
    durationMs: nextDuration,
    loop: patch.loop ?? clip.loop,
    autoplay: patch.autoplay ?? clip.autoplay,
    tracks: clampedTracks,
    ...(clampedMotionPaths ? { motionPaths: clampedMotionPaths } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function addTrackToClip(
  clip: AnimationClip,
  node: DesignNode,
  property: AnimatableProperty,
): { clip: AnimationClip; trackId: string } {
  if (isPropertyLockedByMotionPath(clip, node.id, property)) {
    return { clip, trackId: '' };
  }
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
          : property === 'motionPathProgress' || property === 'trimEnd' || property === 'trimStart' || property === 'trimOffset'
            ? 0
            : baseValue;
  const endValue: number | string =
    property === 'motionPathProgress' ||
    property === 'trimEnd' ||
    property === 'trimStart' ||
    property === 'trimOffset'
      ? 100
      : baseValue;

  const trackId = createMotionId('track');
  const endTime =
    property === 'motionPathProgress' || property === 'trimOffset'
      ? clip.durationMs
      : Math.min(clip.durationMs, Math.max(200, Math.round(clip.durationMs * 0.75)));
  const endEasing: AnimationEasing =
    property === 'motionPathProgress' || property === 'trimOffset' ? 'linear' : 'ease-out';
  const newTrack: AnimationTrack = {
    id: trackId,
    targetNodeId: node.id,
    property,
    keyframes: [
      { id: createMotionId('kf'), timeMs: 0, value: startValue, easing: 'linear' },
      { id: createMotionId('kf'), timeMs: endTime, value: endValue, easing: endEasing },
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
  const rawProperties = options?.properties && options.properties.length > 0
    ? [...options.properties]
    : getCoreAnimatablePropertiesForNode(node);
  const lockPosition = hasActiveMotionPathForNode(clip, node.id);
  const properties = lockPosition
    ? rawProperties.filter((prop) => prop !== 'x' && prop !== 'y')
    : rawProperties;
  if (properties.length === 0) {
    return { clip, capturedProperties: [] };
  }
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
 * Toggles a single property keyframe at `timeMs` (used by Inspector & Path Studio diamond icons).
 * - If a keyframe already exists within 15ms of `timeMs`, removes it (and prunes the track if empty).
 * - If the property is locked by an active Motion Path (`x` or `y`), returns `action: 'blocked'`
 *   without modifying the clip.
 * - Otherwise inserts/upserts a keyframe using `valueOverride` (when provided, e.g. for live
 *   track-only Path Studio channels) or the node's current property value, auto-seeding a `0ms`
 *   baseline only when creating a brand-new track at `timeMs > 0` (never planting a phantom 75% keyframe).
 */
export function togglePropertyKeyframeInClip(
  clip: AnimationClip,
  node: DesignNode,
  property: AnimatableProperty,
  timeMs: number,
  options?: {
    baselineNode?: DesignNode;
    easing?: AnimationEasing;
    valueOverride?: number | string;
    baselineValueOverride?: number | string;
  },
): { clip: AnimationClip; action: 'added' | 'removed' | 'blocked' } {
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

  if (isPropertyLockedByMotionPath(clip, node.id, property)) {
    return {
      action: 'blocked',
      clip,
    };
  }

  if (options?.valueOverride !== undefined) {
    const nextClip = setSingleChannelKeyframeInClip(
      clip,
      node,
      property,
      clampedTime,
      options.valueOverride,
      {
        baselineValue: options.baselineValueOverride,
        easing: options.easing ?? 'ease-out',
      },
    ).clip;
    return {
      action: 'added',
      clip: nextClip,
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
 * Sets or inserts a single channel keyframe at `timeMs` with an explicit `value`.
 * Unlike `addTrackToClip`, this never fabricates a phantom 75%-duration keyframe;
 * when creating a brand-new track at `timeMs > 0`, it optionally seeds `0ms` with
 * `baselineValue` so interpolation starts cleanly from the baseline.
 */
export function setSingleChannelKeyframeInClip(
  clip: AnimationClip,
  node: DesignNode,
  property: AnimatableProperty,
  timeMs: number,
  value: number | string,
  options?: {
    baselineValue?: number | string;
    easing?: AnimationEasing;
  },
): { clip: AnimationClip; trackId: string; keyframeId: string } {
  if (isPropertyLockedByMotionPath(clip, node.id, property)) {
    return { clip, trackId: '', keyframeId: '' };
  }
  const clampedTime = clamp(Math.round(timeMs), 0, clip.durationMs);
  const easing = options?.easing ?? 'ease-in-out';
  const existingTrack = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === property);

  if (existingTrack) {
    const upserted = upsertKeyframeInClip(clip, existingTrack.id, clampedTime, value, easing);
    return {
      clip: upserted.clip,
      trackId: existingTrack.id,
      keyframeId: upserted.keyframeId,
    };
  }

  const trackId = createMotionId('track');
  const keyframes: AnimationKeyframe[] = [];
  if (clampedTime > 25 && options?.baselineValue !== undefined) {
    keyframes.push({
      id: createMotionId('kf'),
      timeMs: 0,
      value: options.baselineValue,
      easing: 'linear',
    });
  }
  const createdKfId = createMotionId('kf');
  keyframes.push({
    id: createdKfId,
    timeMs: clampedTime,
    value,
    easing: clampedTime === 0 ? 'linear' : easing,
  });

  const newTrack: AnimationTrack = {
    id: trackId,
    targetNodeId: node.id,
    property,
    keyframes: sortKeyframes(keyframes),
  };

  return {
    trackId,
    keyframeId: createdKfId,
    clip: {
      ...clip,
      tracks: [...clip.tracks, newTrack],
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Applies a built-in Shape Morph preset cleanly without seeding a dead 0%-75%
 * freeze keyframe: creates `[0ms: baseShape, targetTime: presetShape]` on a new
 * `pathMorph` track, or upserts `presetShape` at `targetTime` on an existing track.
 */
export function applyMorphPresetInClip(
  clip: AnimationClip,
  node: DesignNode,
  presetId: MorphShapePresetId,
  playheadMs: number,
  easing: AnimationEasing = 'ease-in-out',
): { clip: AnimationClip; trackId: string; keyframeId: string } {
  const targetTime = playheadMs > 0 ? clamp(Math.round(playheadMs), 0, clip.durationMs) : clip.durationMs;
  const presetSnap = createMorphPresetSnapshot(presetId, node.width, node.height);
  const existingTrack = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === 'pathMorph');

  if (existingTrack) {
    const upserted = upsertKeyframeInClip(clip, existingTrack.id, targetTime, presetSnap, easing);
    return {
      clip: upserted.clip,
      trackId: existingTrack.id,
      keyframeId: upserted.keyframeId,
    };
  }

  const baseSnap = extractMorphSnapshotFromNode(node);
  return setSingleChannelKeyframeInClip(clip, node, 'pathMorph', targetTime, presetSnap, {
    baselineValue: baseSnap ?? undefined,
    easing,
  });
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
  const lockPosition = hasActiveMotionPathForNode(clip, afterNode.id);
  const hasExistingMorphTrack = clip.tracks.some(
    (t) => t.targetNodeId === afterNode.id && t.property === 'pathMorph',
  );
  const allProperties = getAnimatablePropertiesForNode(afterNode).filter(
    (prop) => !(lockPosition && (prop === 'x' || prop === 'y')),
  );
  if (hasExistingMorphTrack && !allProperties.includes('pathMorph')) {
    allProperties.push('pathMorph');
  }
  const corePropertySet = new Set(
    getCoreAnimatablePropertiesForNode(afterNode).filter(
      (prop) => !(lockPosition && (prop === 'x' || prop === 'y')),
    ),
  );
  const changedProperties: AnimatableProperty[] = [];
  for (const property of allProperties) {
    if (property === 'pathMorph' && !hasExistingMorphTrack && afterNode.type !== 'path') {
      continue;
    }
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
      // Do not attach pathMorph automatically when editing non-path core properties unless already tracked
      if (coreProp === 'pathMorph' && !hasExistingMorphTrack && !changedProperties.includes('pathMorph')) {
        continue;
      }
      targetPropertySet.add(coreProp);
    }
  }
  const trackOnlyPathStudioProps = new Set<AnimatableProperty>([
    'motionPathProgress',
    'motionPathStart',
    'motionPathEnd',
    'motionPathOffset',
    'trimStart',
    'trimEnd',
    'trimOffset',
  ]);
  for (const track of clip.tracks) {
    if (track.targetNodeId === afterNode.id) {
      if (lockPosition && (track.property === 'x' || track.property === 'y')) continue;
      if (trackOnlyPathStudioProps.has(track.property)) continue;
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
  readonly motionPath?: MotionPathBinding;
}

/**
 * Groups flat AnimationTracks by `targetNodeId` in stable order so the Motion
 * Timeline can render one clean master row per animated object with expandable
 * per-property sub-tracks and Motion Path shape keyframes.
 */
export function groupClipTracksByNode(clip: AnimationClip): GroupedAnimationLayer[] {
  const map = new Map<string, AnimationTrack[]>();
  const motionPathByNodeId = new Map<string, MotionPathBinding>();
  for (const track of clip.tracks) {
    const existing = map.get(track.targetNodeId);
    if (existing) {
      existing.push(track);
    } else {
      map.set(track.targetNodeId, [track]);
    }
  }
  for (const mp of clip.motionPaths ?? []) {
    motionPathByNodeId.set(mp.targetNodeId, mp);
    if (!map.has(mp.targetNodeId)) {
      map.set(mp.targetNodeId, []);
    }
  }

  const groups: GroupedAnimationLayer[] = [];
  for (const [targetNodeId, tracks] of map.entries()) {
    const motionPath = motionPathByNodeId.get(targetNodeId);
    const timeSet = new Set<number>();
    for (const track of tracks) {
      for (const kf of track.keyframes) {
        timeSet.add(Math.round(kf.timeMs));
      }
    }
    if (motionPath?.pathKeyframes) {
      for (const pkf of motionPath.pathKeyframes) {
        timeSet.add(Math.round(pkf.timeMs));
      }
    }
    groups.push({
      targetNodeId,
      tracks,
      keyframeTimes: [...timeSet].sort((a, b) => a - b),
      ...(motionPath ? { motionPath } : {}),
    });
  }
  return groups;
}

/**
 * Moves all keyframes belonging to `targetNodeId` at `fromTimeMs` together to `toTimeMs`
 * (including any Motion Path shape keyframes at that timestamp).
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

  const nextMotionPaths = clip.motionPaths?.map((mp) => {
    if (mp.targetNodeId !== targetNodeId || !mp.pathKeyframes || mp.pathKeyframes.length === 0) {
      return mp;
    }
    const moved = mp.pathKeyframes.map((pkf) =>
      Math.abs(pkf.timeMs - roundedFrom) <= 1 ? { ...pkf, timeMs: clampedTo } : pkf,
    );
    const sorted = [...moved].sort((a, b) => a.timeMs - b.timeMs);
    const deduped: typeof sorted = [];
    for (const pkf of sorted) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(last.timeMs - pkf.timeMs) <= 1) {
        deduped[deduped.length - 1] = pkf;
      } else {
        deduped.push(pkf);
      }
    }
    return {
      ...mp,
      points: deduped[0] ? cloneVectorAnchorPoints(deduped[0].points) : mp.points,
      pathKeyframes: deduped,
    };
  });

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
    ...(nextMotionPaths ? { motionPaths: nextMotionPaths } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deletes every keyframe at `timeMs` across all tracks (and Motion Path shape keyframes)
 * for `targetNodeId`.
 */
export function deleteLayerKeyframesAtTimeInClip(
  clip: AnimationClip,
  targetNodeId: string,
  timeMs: number,
): AnimationClip {
  const roundedTime = Math.round(timeMs);
  const nextMotionPaths = clip.motionPaths?.map((mp) => {
    if (mp.targetNodeId !== targetNodeId || !mp.pathKeyframes || mp.pathKeyframes.length === 0) {
      return mp;
    }
    const remaining = mp.pathKeyframes.filter((pkf) => Math.abs(pkf.timeMs - roundedTime) > 1);
    if (remaining.length === 0) {
      const next = { ...mp };
      delete next.pathKeyframes;
      return next;
    }
    return {
      ...mp,
      points: cloneVectorAnchorPoints(remaining[0].points),
      pathKeyframes: remaining,
    };
  });

  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (track.targetNodeId !== targetNodeId) return track;
      return {
        ...track,
        keyframes: track.keyframes.filter((kf) => Math.abs(kf.timeMs - roundedTime) > 1),
      };
    }),
    ...(nextMotionPaths ? { motionPaths: nextMotionPaths } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes all animation tracks belonging to `targetNodeId` from the clip.
 */
export function removeLayerTracksFromClip(clip: AnimationClip, targetNodeId: string): AnimationClip {
  const nextMotionPaths = clip.motionPaths
    ? clip.motionPaths.filter((mp) => mp.targetNodeId !== targetNodeId)
    : undefined;
  return {
    ...clip,
    tracks: clip.tracks.filter((track) => track.targetNodeId !== targetNodeId),
    ...(nextMotionPaths && nextMotionPaths.length > 0 ? { motionPaths: nextMotionPaths } : { motionPaths: undefined }),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// FOLIO PATH STUDIO — MOTION PATH & TRIM PATH CLIP HELPERS
// ============================================================================

/**
 * Adds or updates a `MotionPathBinding` for `binding.targetNodeId` in `clip`.
 * Optionally seeds a `motionPathProgress` track (0% -> 100%) so speed/easing
 * can be customized directly in the Motion Timeline and Graph Editor.
 */
export function upsertMotionPathInClip(
  clip: AnimationClip,
  binding: MotionPathBinding,
  options?: {
    ensureProgressTrack?: boolean;
    initialProgressKeyframes?: readonly AnimationKeyframe[];
  },
): AnimationClip {
  const existingPaths = clip.motionPaths ?? [];
  const idx = existingPaths.findIndex((mp) => mp.targetNodeId === binding.targetNodeId);
  const nextMotionPaths = idx >= 0
    ? existingPaths.map((mp, i) => (i === idx ? binding : mp))
    : [...existingPaths, binding];

  // Strip any conflicting X/Y positioning tracks on this node — Motion Path is the sole position driver,
  // while rotation, size, scale, opacity, color, morph, trim, and effects remain freely animatable.
  let nextTracks = binding.points.length >= 2
    ? clip.tracks.filter(
        (t) => !(t.targetNodeId === binding.targetNodeId && (t.property === 'x' || t.property === 'y')),
      )
    : clip.tracks;
  if (options?.ensureProgressTrack) {
    const hasProgress = nextTracks.some(
      (t) => t.targetNodeId === binding.targetNodeId && t.property === 'motionPathProgress',
    );
    if (!hasProgress) {
      const seededKeyframes: AnimationKeyframe[] =
        options.initialProgressKeyframes && options.initialProgressKeyframes.length >= 2
          ? sortKeyframes([...options.initialProgressKeyframes])
          : [
              { id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' },
              { id: createMotionId('kf'), timeMs: clip.durationMs, value: 100, easing: 'linear' },
            ];
      nextTracks = [
        ...nextTracks,
        {
          id: createMotionId('track'),
          targetNodeId: binding.targetNodeId,
          property: 'motionPathProgress',
          keyframes: seededKeyframes,
        },
      ];
    }
  }

  return {
    ...clip,
    tracks: nextTracks,
    motionPaths: nextMotionPaths,
    updatedAt: new Date().toISOString(),
  };
}

function collectDistinctXYWaypoints(
  clip: AnimationClip,
  node: DesignNode,
): Array<{ timeMs: number; cx: number; cy: number; easing: AnimationEasing }> {
  const xTrack = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === 'x');
  const yTrack = clip.tracks.find((t) => t.targetNodeId === node.id && t.property === 'y');
  if (!xTrack && !yTrack) return [];

  const timeSet = new Set<number>();
  for (const kf of xTrack?.keyframes ?? []) timeSet.add(Math.round(kf.timeMs));
  for (const kf of yTrack?.keyframes ?? []) timeSet.add(Math.round(kf.timeMs));
  const sortedTimes = [...timeSet].sort((a, b) => a - b);
  if (sortedTimes.length < 2) return [];

  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const waypoints: Array<{ timeMs: number; cx: number; cy: number; easing: AnimationEasing }> = [];

  for (const timeMs of sortedTimes) {
    const xVal = xTrack ? evaluateTrackAtTime(xTrack, timeMs) : undefined;
    const yVal = yTrack ? evaluateTrackAtTime(yTrack, timeMs) : undefined;
    const wx = typeof xVal === 'number' ? xVal : node.x;
    const wy = typeof yVal === 'number' ? yVal : node.y;
    const cx = roundTo2(wx + halfW);
    const cy = roundTo2(wy + halfH);

    const exactX = xTrack?.keyframes.find((k) => Math.abs(k.timeMs - timeMs) <= 2);
    const exactY = yTrack?.keyframes.find((k) => Math.abs(k.timeMs - timeMs) <= 2);
    const easing: AnimationEasing = exactX?.easing ?? exactY?.easing ?? 'ease-in-out';

    const prev = waypoints[waypoints.length - 1];
    if (!prev || Math.hypot(cx - prev.cx, cy - prev.cy) >= 1) {
      waypoints.push({ timeMs, cx, cy, easing });
    }
  }
  return waypoints;
}

/**
 * Returns true if `nodeId` has existing X/Y position keyframes in `clip`
 * representing at least 2 distinct spatial positions that can be upgraded
 * directly into a Bézier Motion Path in one click.
 */
export function canConvertXYTracksToMotionPath(
  clip: AnimationClip | null | undefined,
  node: DesignNode | null | undefined,
): boolean {
  if (!clip || !node) return false;
  if (hasActiveMotionPathForNode(clip, node.id)) return false;
  return collectDistinctXYWaypoints(clip, node).length >= 2;
}

/**
 * Converts a node's existing X/Y position keyframes into a smooth Bézier
 * `MotionPathBinding` plus matching arc-length-timed `motionPathProgress`
 * keyframes so prior position authoring is upgraded without data loss.
 */
export function createMotionPathFromXYTracks(
  clip: AnimationClip,
  node: DesignNode,
): {
  binding: MotionPathBinding;
  progressKeyframes?: AnimationKeyframe[];
  convertedFromXY: boolean;
} {
  const waypoints = collectDistinctXYWaypoints(clip, node);
  if (waypoints.length < 2) {
    return {
      binding: createDefaultMotionPathForNode(node),
      convertedFromXY: false,
    };
  }

  const n = waypoints.length;
  const points: VectorAnchorPoint[] = waypoints.map((wp, idx) => {
    const prev = waypoints[Math.max(0, idx - 1)];
    const next = waypoints[Math.min(n - 1, idx + 1)];
    if (n === 2) {
      // Gentle smooth handles along the segment for immediate editable Bézier curves
      const dx = next.cx - prev.cx;
      const dy = next.cy - prev.cy;
      return {
        id: createMotionId('mppt'),
        x: wp.cx,
        y: wp.cy,
        pointType: 'smooth',
        ...(idx === 0
          ? { handleOut: { x: roundTo2(wp.cx + dx * 0.33), y: roundTo2(wp.cy + dy * 0.33) } }
          : { handleIn: { x: roundTo2(wp.cx - dx * 0.33), y: roundTo2(wp.cy - dy * 0.33) } }),
      };
    }

    // Catmull-Rom tangents (tension = 0.22) for natural smooth curves across 3+ waypoints
    const tx = (next.cx - prev.cx) * 0.22;
    const ty = (next.cy - prev.cy) * 0.22;
    return {
      id: createMotionId('mppt'),
      x: wp.cx,
      y: wp.cy,
      pointType: idx === 0 || idx === n - 1 ? 'corner' : 'smooth',
      ...(idx > 0
        ? { handleIn: { x: roundTo2(wp.cx - tx), y: roundTo2(wp.cy - ty) } }
        : {}),
      ...(idx < n - 1
        ? { handleOut: { x: roundTo2(wp.cx + tx), y: roundTo2(wp.cy + ty) } }
        : {}),
    };
  });

  // Compute cumulative chord-length progress % for each waypoint timestamp
  const cumDist: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < n; i += 1) {
    totalDist += Math.hypot(waypoints[i].cx - waypoints[i - 1].cx, waypoints[i].cy - waypoints[i - 1].cy);
    cumDist.push(totalDist);
  }
  const progressKeyframes: AnimationKeyframe[] = waypoints.map((wp, idx) => ({
    id: createMotionId('kf'),
    timeMs: clamp(wp.timeMs, 0, clip.durationMs),
    value: totalDist > 0 ? roundTo2((cumDist[idx] / totalDist) * 100) : roundTo2((idx / (n - 1)) * 100),
    easing: idx === 0 ? 'linear' : wp.easing,
  }));

  const binding: MotionPathBinding = {
    id: createMotionId('mpath'),
    targetNodeId: node.id,
    points,
    closed: false,
    autoOrient: false,
    orientOffsetDeg: 0,
    reverse: false,
    constantSpeed: true,
    startPct: 0,
    endPct: 100,
    offsetPx: 0,
    loopMode: 'none',
    visible: true,
  };

  return {
    binding,
    progressKeyframes,
    convertedFromXY: true,
  };
}

/**
 * Removes a node's `MotionPathBinding` (and optionally its `motionPathProgress` track).
 */
export function removeMotionPathFromClip(
  clip: AnimationClip,
  targetNodeId: string,
  options?: { removeProgressTrack?: boolean },
): AnimationClip {
  const nextMotionPaths = (clip.motionPaths ?? []).filter(
    (mp) => mp.targetNodeId !== targetNodeId,
  );
  const nextTracks = options?.removeProgressTrack !== false
    ? clip.tracks.filter(
        (t) =>
          !(
            t.targetNodeId === targetNodeId &&
            (t.property === 'motionPathProgress' ||
              t.property === 'motionPathStart' ||
              t.property === 'motionPathEnd' ||
              t.property === 'motionPathOffset')
          ),
      )
    : clip.tracks;

  return {
    ...clip,
    tracks: nextTracks,
    motionPaths: nextMotionPaths.length > 0 ? nextMotionPaths : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Multi-object Motion Path authoring with automatic sequential staggering.
 * Attaches/updates Motion Path bindings for all `nodes` (sharing `sourceBinding`
 * trajectory if supplied, or preserving each node's existing path / creating one)
 * and staggers each node's `motionPathProgress` keyframes by `idx * staggerMs`.
 */
export function applyStaggeredMotionPathInClip(
  clip: AnimationClip,
  nodes: readonly DesignNode[],
  options: {
    sourceBinding?: MotionPathBinding;
    staggerMs: number;
    order?: 'selection' | 'reverse';
    travelDurationMs?: number;
    docWidth?: number;
    docHeight?: number;
    preserveExistingPath?: boolean;
  },
): AnimationClip {
  if (nodes.length === 0) return clip;
  const ordered = options.order === 'reverse' ? [...nodes].reverse() : [...nodes];
  const staggerMs = clamp(Math.round(options.staggerMs), 0, 10_000);
  const totalStagger = Math.max(0, (ordered.length - 1) * staggerMs);
  const travelMs = clamp(
    Math.round(options.travelDurationMs ?? Math.max(400, clip.durationMs - totalStagger)),
    200,
    60_000,
  );
  const requiredDuration = clamp(totalStagger + travelMs, clip.durationMs, 60_000);

  let working: AnimationClip =
    requiredDuration > clip.durationMs
      ? { ...clip, durationMs: requiredDuration }
      : { ...clip };

  const existingByNode = new Map<string, MotionPathBinding>(
    (working.motionPaths ?? []).map((mp) => [mp.targetNodeId, mp]),
  );

  for (let idx = 0; idx < ordered.length; idx += 1) {
    const node = ordered[idx];
    const existing = existingByNode.get(node.id);
    let binding: MotionPathBinding;
    if (options.preserveExistingPath && existing) {
      binding = existing;
    } else if (options.sourceBinding) {
      binding = {
        ...options.sourceBinding,
        id: existing?.id ?? `mpath-${node.id}-${Date.now().toString(36)}-${idx}`,
        targetNodeId: node.id,
        points: cloneVectorAnchorPoints(options.sourceBinding.points),
        ...(options.sourceBinding.pathKeyframes
          ? {
              pathKeyframes: options.sourceBinding.pathKeyframes.map((pkf, kIdx) => ({
                ...pkf,
                id: `mpkf-${node.id}-${kIdx}-${Date.now().toString(36)}`,
                points: cloneVectorAnchorPoints(pkf.points),
              })),
            }
          : {}),
      };
    } else if (existing) {
      binding = existing;
    } else {
      binding = createDefaultMotionPathForNode(
        node,
        options.docWidth ?? 1280,
        options.docHeight ?? 720,
      );
    }

    working = upsertMotionPathInClip(working, binding, { ensureProgressTrack: false });

    const startTime = Math.min(working.durationMs, idx * staggerMs);
    const endTime = Math.min(working.durationMs, startTime + travelMs);
    const progressKfs: AnimationKeyframe[] = [
      ...(startTime > 0
        ? [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' as const }]
        : []),
      { id: createMotionId('kf'), timeMs: startTime, value: 0, easing: 'linear' },
      { id: createMotionId('kf'), timeMs: Math.max(startTime + 50, endTime), value: 100, easing: 'ease-in-out' },
    ];
    const filteredTracks = working.tracks.filter(
      (t) => !(t.targetNodeId === node.id && t.property === 'motionPathProgress'),
    );
    working = {
      ...working,
      tracks: [
        ...filteredTracks,
        {
          id: createMotionId('track'),
          targetNodeId: node.id,
          property: 'motionPathProgress',
          keyframes: sortKeyframes(progressKfs),
        },
      ],
    };
  }

  return {
    ...working,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Multi-object Trim Path authoring with sequential staggering across multiple shapes.
 */
export function applyStaggeredTrimPathInClip(
  clip: AnimationClip,
  nodes: readonly DesignNode[],
  preset: 'draw-in' | 'draw-out' | 'traveling-dash' = 'draw-in',
  trimMode: TrimPathMode = 'simultaneous',
  options: {
    staggerMs: number;
    order?: 'selection' | 'reverse';
    strokeDurationMs?: number;
  },
): AnimationClip {
  const validNodes = nodes.filter(
    (n) => n.type === 'path' || n.type === 'rect' || n.type === 'frame' || n.type === 'ellipse',
  );
  if (validNodes.length === 0) return clip;
  const ordered = options.order === 'reverse' ? [...validNodes].reverse() : [...validNodes];
  const staggerMs = clamp(Math.round(options.staggerMs), 0, 10_000);
  const totalStagger = Math.max(0, (ordered.length - 1) * staggerMs);
  const spanMs = clamp(
    Math.round(options.strokeDurationMs ?? Math.max(350, clip.durationMs - totalStagger)),
    150,
    60_000,
  );
  const requiredDuration = clamp(totalStagger + spanMs, clip.durationMs, 60_000);

  const targetIds = new Set(ordered.map((n) => n.id));
  const keptTracks = clip.tracks.filter(
    (t) =>
      !(
        targetIds.has(t.targetNodeId) &&
        (t.property === 'trimStart' || t.property === 'trimEnd' || t.property === 'trimOffset')
      ),
  );
  const created: AnimationTrack[] = [];

  ordered.forEach((node, idx) => {
    const startTime = Math.min(requiredDuration, idx * staggerMs);
    const endTime = Math.min(requiredDuration, startTime + spanMs);
    if (preset === 'draw-in') {
      created.push({
        id: createMotionId('track'),
        targetNodeId: node.id,
        property: 'trimEnd',
        trimMode,
        keyframes: sortKeyframes([
          ...(startTime > 0
            ? [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' as const }]
            : []),
          { id: createMotionId('kf'), timeMs: startTime, value: 0, easing: 'linear' },
          { id: createMotionId('kf'), timeMs: Math.max(startTime + 50, endTime), value: 100, easing: 'ease-in-out' },
        ]),
      });
    } else if (preset === 'draw-out') {
      created.push({
        id: createMotionId('track'),
        targetNodeId: node.id,
        property: 'trimStart',
        trimMode,
        keyframes: sortKeyframes([
          ...(startTime > 0
            ? [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' as const }]
            : []),
          { id: createMotionId('kf'), timeMs: startTime, value: 0, easing: 'linear' },
          { id: createMotionId('kf'), timeMs: Math.max(startTime + 50, endTime), value: 100, easing: 'ease-in-out' },
        ]),
      });
    } else {
      created.push(
        {
          id: createMotionId('track'),
          targetNodeId: node.id,
          property: 'trimStart',
          trimMode,
          keyframes: [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' }],
        },
        {
          id: createMotionId('track'),
          targetNodeId: node.id,
          property: 'trimEnd',
          trimMode,
          keyframes: [{ id: createMotionId('kf'), timeMs: 0, value: 28, easing: 'linear' }],
        },
        {
          id: createMotionId('track'),
          targetNodeId: node.id,
          property: 'trimOffset',
          trimMode,
          keyframes: sortKeyframes([
            ...(startTime > 0
              ? [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' as const }]
              : []),
            { id: createMotionId('kf'), timeMs: startTime, value: 0, easing: 'linear' },
            { id: createMotionId('kf'), timeMs: Math.max(startTime + 50, endTime), value: 100, easing: 'linear' },
          ]),
        },
      );
    }
  });

  return {
    ...clip,
    durationMs: requiredDuration,
    tracks: [...keptTracks, ...created],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Applies a ready-to-play Trim Path animation preset (`draw-in`, `draw-out`,
 * or `traveling-dash`) to `node` inside `clip`.
 */
export function enableTrimPathInClip(
  clip: AnimationClip,
  node: DesignNode,
  preset: 'draw-in' | 'draw-out' | 'traveling-dash' = 'draw-in',
  trimMode: TrimPathMode = 'simultaneous',
): AnimationClip {
  const withoutOldTrim = clip.tracks.filter(
    (t) =>
      !(
        t.targetNodeId === node.id &&
        (t.property === 'trimStart' || t.property === 'trimEnd' || t.property === 'trimOffset')
      ),
  );
  const dur = clip.durationMs;
  const created: AnimationTrack[] = [];

  if (preset === 'draw-in') {
    created.push({
      id: createMotionId('track'),
      targetNodeId: node.id,
      property: 'trimEnd',
      trimMode,
      keyframes: [
        { id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' },
        { id: createMotionId('kf'), timeMs: dur, value: 100, easing: 'ease-in-out' },
      ],
    });
  } else if (preset === 'draw-out') {
    created.push({
      id: createMotionId('track'),
      targetNodeId: node.id,
      property: 'trimStart',
      trimMode,
      keyframes: [
        { id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' },
        { id: createMotionId('kf'), timeMs: dur, value: 100, easing: 'ease-in-out' },
      ],
    });
  } else {
    // Traveling dash: fixed 28% stroke window gliding continuously around the path
    created.push(
      {
        id: createMotionId('track'),
        targetNodeId: node.id,
        property: 'trimStart',
        trimMode,
        keyframes: [{ id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' }],
      },
      {
        id: createMotionId('track'),
        targetNodeId: node.id,
        property: 'trimEnd',
        trimMode,
        keyframes: [{ id: createMotionId('kf'), timeMs: 0, value: 28, easing: 'linear' }],
      },
      {
        id: createMotionId('track'),
        targetNodeId: node.id,
        property: 'trimOffset',
        trimMode,
        keyframes: [
          { id: createMotionId('kf'), timeMs: 0, value: 0, easing: 'linear' },
          { id: createMotionId('kf'), timeMs: dur, value: 100, easing: 'linear' },
        ],
      },
    );
  }

  return {
    ...clip,
    tracks: [...withoutOldTrim, ...created],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Sets `trimMode` (`simultaneous` | `sequential`) across all Trim Path tracks
 * targeting `targetNodeId` in `clip`.
 */
export function setNodeTrimModeInClip(
  clip: AnimationClip,
  targetNodeId: string,
  trimMode: TrimPathMode,
): AnimationClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => {
      if (
        track.targetNodeId === targetNodeId &&
        (track.property === 'trimStart' ||
          track.property === 'trimEnd' ||
          track.property === 'trimOffset')
      ) {
        return { ...track, trimMode };
      }
      return track;
    }),
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

  if (presetId === 'motion-path-cruise') {
    const primary = fallbackNodes[0];
    const motionPaths: MotionPathBinding[] = [];
    const tracks: AnimationTrack[] = [];
    if (primary) {
      const binding = createDefaultMotionPathForNode(
        primary,
        page.document.width,
        page.document.height,
      );
      motionPaths.push(binding);
      tracks.push({
        id: `track-mp-prog-${primary.id}`,
        targetNodeId: primary.id,
        property: 'motionPathProgress',
        keyframes: [
          { id: `kf-mp-0-${primary.id}`, timeMs: 0, value: 0, easing: 'linear' },
          { id: `kf-mp-1-${primary.id}`, timeMs: 2400, value: 100, easing: 'ease-in-out' },
        ],
      });
    }
    return {
      id: clipId ?? createMotionId('clip'),
      name: 'Motion Path Cruise',
      pageId: page.id,
      durationMs: 2400,
      loop: true,
      autoplay: false,
      tracks,
      motionPaths,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (presetId === 'trim-logo-reveal') {
    const trimTargets = fallbackNodes.filter(
      (n) => n.type === 'path' || n.type === 'rect' || n.type === 'frame' || n.type === 'ellipse',
    );
    const tracks: AnimationTrack[] = [];
    trimTargets.forEach((node, idx) => {
      const delay = Math.min(400, idx * 160);
      const end = Math.min(1400, delay + 900);
      tracks.push({
        id: `track-trim-end-${node.id}`,
        targetNodeId: node.id,
        property: 'trimEnd',
        trimMode: 'sequential',
        keyframes: [
          ...(delay > 0 ? [{ id: `kf-te-pre-${idx}`, timeMs: 0, value: 0, easing: 'linear' as const }] : []),
          { id: `kf-te-0-${idx}`, timeMs: delay, value: 0, easing: 'linear' },
          { id: `kf-te-1-${idx}`, timeMs: end, value: 100, easing: 'ease-in-out' },
        ],
      });
    });
    return {
      id: clipId ?? createMotionId('clip'),
      name: 'Trim Path Reveal',
      pageId: page.id,
      durationMs: 1400,
      loop: false,
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

/**
 * Evaluates a saved ComponentDefinition's embedded animation clip at `timeMs`
 * (wrapping seamlessly for looping playback so animated components play as
 * 1 unified animated object when placed on any page).
 */
export function evaluateComponentDocumentAtTime(
  document: FolioDocument,
  animations: readonly AnimationClip[] | undefined,
  timeMs: number,
): FolioDocument {
  if (!animations || animations.length === 0) return document;
  const clip =
    animations.find(
      (c) => c.tracks.length > 0 || (c.motionPaths !== undefined && c.motionPaths.length > 0),
    ) ?? animations[0];
  const hasAnim =
    clip &&
    (clip.tracks.length > 0 || (clip.motionPaths !== undefined && clip.motionPaths.length > 0));
  if (!clip || !hasAnim || clip.durationMs <= 0) return document;
  const effectiveTime = clip.loop ? timeMs % clip.durationMs : timeMs % clip.durationMs;
  const poses = evaluateClipAtTime(clip, effectiveTime);
  return applyAnimatedPosesToDocument(document, poses);
}


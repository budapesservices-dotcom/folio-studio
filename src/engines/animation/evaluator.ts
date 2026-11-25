import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationKeyframe,
  AnimationTrack,
  DesignNode,
  FolioDocument,
  FolioPage,
} from '../../core/document/types';
import { scalePathNodeGeometry } from '../../core/document/vector';
import { evaluateEasing } from './easing';

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
  return Math.round(value * 100) / 100;
}

function parseHexToRgba(hex: string): [number, number, number, number] | null {
  const clean = hex.trim();
  if (!clean.startsWith('#')) return null;
  const raw = clean.slice(1);
  if (raw.length === 3 || raw.length === 4) {
    const r = Number.parseInt(raw[0] + raw[0], 16);
    const g = Number.parseInt(raw[1] + raw[1], 16);
    const b = Number.parseInt(raw[2] + raw[2], 16);
    const a = raw.length === 4 ? Number.parseInt(raw[3] + raw[3], 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b, a];
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b, a];
  }
  return null;
}

function channelToHex(channel: number): string {
  return clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
}

export function interpolateHexColor(from: string, to: string, t: number): string {
  const a = parseHexToRgba(from);
  const b = parseHexToRgba(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const clampedT = clamp(t, 0, 1);
  const r = a[0] + (b[0] - a[0]) * clampedT;
  const g = a[1] + (b[1] - a[1]) * clampedT;
  const bl = a[2] + (b[2] - a[2]) * clampedT;
  const alpha = a[3] + (b[3] - a[3]) * clampedT;
  if (alpha < 0.999) {
    return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}${channelToHex(alpha * 255)}`;
  }
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`;
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
    return sorted[0].value;
  }
  const last = sorted[sorted.length - 1];
  if (timeMs >= last.timeMs) {
    return last.value;
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
        return interpolateHexColor(String(start.value), String(end.value), easedT);
      }

      const startNum = Number(start.value);
      const endNum = Number(end.value);
      const interpolated = startNum + (endNum - startNum) * easedT;
      if (track.property === 'opacity') return roundTo2(clamp(interpolated, 0, 1));
      if (track.property === 'scale') return roundTo2(clamp(interpolated, 0.05, 10));
      if (track.property === 'width' || track.property === 'height') return roundTo2(clamp(interpolated, 1, 20000));
      if (track.property === 'radius' || track.property === 'strokeWidth') return roundTo2(clamp(interpolated, 0, 2000));
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
  const getAncestorDelta = (node: DesignNode): { dx: number; dy: number } => {
    let curParentId = node.parentId;
    const visited = new Set<string>([node.id]);
    while (curParentId && !visited.has(curParentId)) {
      visited.add(curParentId);
      const anc = nodeById.get(curParentId);
      if (!anc) break;
      const ancPose = poses[anc.id];
      if (ancPose && (ancPose.x !== undefined || ancPose.y !== undefined)) {
        return {
          dx: ancPose.x !== undefined ? ancPose.x - anc.x : 0,
          dy: ancPose.y !== undefined ? ancPose.y - anc.y : 0,
        };
      }
      curParentId = anc.parentId;
    }
    return { dx: 0, dy: 0 };
  };

  let changed = false;
  const nextNodes = document.nodes.map((node) => {
    const pose = poses[node.id];
    const ancDelta = !pose || pose.x === undefined || pose.y === undefined
      ? getAncestorDelta(node)
      : { dx: 0, dy: 0 };
    if (!pose && ancDelta.dx === 0 && ancDelta.dy === 0) return node;
    changed = true;

    const baseX = pose?.x !== undefined ? pose.x : roundTo2(node.x + ancDelta.dx);
    const baseY = pose?.y !== undefined ? pose.y : roundTo2(node.y + ancDelta.dy);
    const baseWidth = pose?.width !== undefined ? Math.max(1, roundTo2(pose.width)) : node.width;
    const baseHeight = pose?.height !== undefined ? Math.max(1, roundTo2(pose.height)) : node.height;
    const scale = pose?.scale ?? 1;
    const scaledWidth = scale !== 1 ? Math.max(1, roundTo2(baseWidth * scale)) : baseWidth;
    const scaledHeight = scale !== 1 ? Math.max(1, roundTo2(baseHeight * scale)) : baseHeight;
    const centeredX = scale !== 1 ? roundTo2(baseX + (baseWidth - scaledWidth) / 2) : baseX;
    const centeredY = scale !== 1 ? roundTo2(baseY + (baseHeight - scaledHeight) / 2) : baseY;

    const basePatch = {
      x: centeredX,
      y: centeredY,
      width: scaledWidth,
      height: scaledHeight,
      rotation: pose?.rotation ?? node.rotation,
      opacity: pose?.opacity !== undefined ? clamp(pose.opacity, 0, 1) : node.opacity,
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
  if (!trimmed || trimmed.toLowerCase() === 'none') return 'transparent';
  if (trimmed.toLowerCase() === 'transparent') return 'transparent';
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^(?:rgba?|hsla?)\(\s*[0-9.%\s,/+-]+\s*\)$/i.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Returns the complete list of animatable properties supported by a given DesignNode
 * so keyframing an object captures its full visual state (position, size, rotation,
 * opacity, radius, fill, stroke, stroke width) in one action.
 */
export function getAnimatablePropertiesForNode(node: DesignNode): AnimatableProperty[] {
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
      return roundTo2(clamp(node.opacity ?? 1, 0, 1));
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
        return 'transparent';
      }
      return '#4f8cff';
    }
    case 'stroke': {
      if ('style' in node && 'stroke' in node.style) {
        if (typeof node.style.stroke === 'string' && node.style.stroke.trim().length > 0) {
          return normalizeAnimatableColor(node.style.stroke, 'transparent');
        }
        if ('strokes' in node.style && Array.isArray(node.style.strokes)) {
          const firstStroke = node.style.strokes.find((item) => item.visible !== false && typeof item.color === 'string');
          if (firstStroke && firstStroke.color) {
            return normalizeAnimatableColor(firstStroke.color, 'transparent');
          }
        }
        return 'transparent';
      }
      return 'transparent';
    }
    case 'strokeWidth':
      return 'style' in node && 'strokeWidth' in node.style && typeof node.style.strokeWidth === 'number'
        ? Math.max(0, roundTo2(node.style.strokeWidth))
        : 0;
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
    : getAnimatablePropertiesForNode(node);
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
 * Inspects an edit from `beforeNode` -> `afterNode` during Motion Auto-Key mode.
 * If any animatable property changed, captures a full-object keyframe snapshot
 * at `timeMs` (auto-seeding `0ms` from `baselineNode ?? beforeNode` for new tracks).
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
  const properties = getAnimatablePropertiesForNode(afterNode);
  const changedProperties: AnimatableProperty[] = [];
  for (const property of properties) {
    const beforeValue = getDefaultNodePropertyValue(beforeNode, property);
    const afterValue = getDefaultNodePropertyValue(afterNode, property);
    if (!areAnimatableValuesEqual(beforeValue, afterValue)) {
      changedProperties.push(property);
    }
  }

  if (changedProperties.length === 0) {
    return { clip, recorded: false, changedProperties: [] };
  }

  const { clip: nextClip } = captureNodeKeyframeSnapshot(clip, afterNode, timeMs, {
    baselineNode: options?.baselineNode ?? beforeNode,
    properties,
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

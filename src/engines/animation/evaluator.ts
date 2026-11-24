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
import { evaluateEasing } from './easing';

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = Object.freeze([
  'x',
  'y',
  'opacity',
  'rotation',
  'scale',
  'fill',
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
  opacity: { label: 'Opacity', unit: '', step: 0.05, min: 0, max: 1, kind: 'number' },
  rotation: { label: 'Rotation', unit: 'deg', step: 1, kind: 'number' },
  scale: { label: 'Scale', unit: 'x', step: 0.05, min: 0.05, max: 5, kind: 'number' },
  fill: { label: 'Fill', unit: '', step: 0, kind: 'color' },
});

export interface AnimatedNodePose {
  x?: number;
  y?: number;
  opacity?: number;
  rotation?: number;
  scale?: number;
  fill?: string;
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

      if (track.property === 'fill') {
        return interpolateHexColor(String(start.value), String(end.value), easedT);
      }

      const startNum = Number(start.value);
      const endNum = Number(end.value);
      const interpolated = startNum + (endNum - startNum) * easedT;
      if (track.property === 'opacity') return roundTo2(clamp(interpolated, 0, 1));
      if (track.property === 'scale') return roundTo2(clamp(interpolated, 0.05, 10));
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

  let changed = false;
  const nextNodes = document.nodes.map((node) => {
    const pose = poses[node.id];
    if (!pose) return node;
    changed = true;

    const baseX = pose.x ?? node.x;
    const baseY = pose.y ?? node.y;
    const scale = pose.scale ?? 1;
    const scaledWidth = scale !== 1 ? Math.max(1, roundTo2(node.width * scale)) : node.width;
    const scaledHeight = scale !== 1 ? Math.max(1, roundTo2(node.height * scale)) : node.height;
    const centeredX = scale !== 1 ? roundTo2(baseX + (node.width - scaledWidth) / 2) : baseX;
    const centeredY = scale !== 1 ? roundTo2(baseY + (node.height - scaledHeight) / 2) : baseY;

    const basePatch = {
      x: centeredX,
      y: centeredY,
      width: scaledWidth,
      height: scaledHeight,
      rotation: pose.rotation ?? node.rotation,
      opacity: pose.opacity !== undefined ? clamp(pose.opacity, 0, 1) : node.opacity,
    };

    if (pose.fill !== undefined && 'style' in node) {
      return {
        ...node,
        ...basePatch,
        style: {
          ...node.style,
          fill: pose.fill,
        },
      } as DesignNode;
    }

    return {
      ...node,
      ...basePatch,
    } as DesignNode;
  });

  if (!changed) return document;
  return {
    ...document,
    nodes: nextNodes,
  };
}

export function getDefaultNodePropertyValue(node: DesignNode, property: AnimatableProperty): number | string {
  switch (property) {
    case 'x':
      return roundTo2(node.x);
    case 'y':
      return roundTo2(node.y);
    case 'opacity':
      return roundTo2(node.opacity ?? 1);
    case 'rotation':
      return roundTo2(node.rotation ?? 0);
    case 'scale':
      return 1;
    case 'fill':
      return 'style' in node && 'fill' in node.style && typeof node.style.fill === 'string' && node.style.fill.trim()
        ? node.style.fill
        : '#4f8cff';
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

import type {
  AnimationClip,
  AnimationTrack,
  DesignNode,
  FolioPage,
  FolioProject,
} from '../../core/document/types';
import { evaluateTrackAtTime, sortKeyframes } from './evaluator';
import { toCssTimingFunction } from './easing';

function slugifyMotionId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'clip';
}

export function getClipCssClassName(clip: Pick<AnimationClip, 'id' | 'name'>): string {
  return `folio-anim-play-${slugifyMotionId(clip.id)}`;
}

function getKeyframesName(clipId: string, nodeId: string): string {
  return `folio-kf-${slugifyMotionId(clipId)}-${slugifyMotionId(nodeId)}`;
}

function formatPct(timeMs: number, durationMs: number): string {
  if (durationMs <= 0) return '0%';
  const pct = Math.max(0, Math.min(100, (timeMs / durationMs) * 100));
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Compiles all AnimationClips belonging to `page` into deterministic CSS `@keyframes`
 * rules, trigger classes (`.folio-anim-play-<clipId>`), autoplay bindings, and
 * `@media (prefers-reduced-motion: reduce)` safeguards.
 */
export function compilePageAnimationsCss(project: FolioProject, page: FolioPage): string {
  const clips = (project.animations ?? []).filter((clip) => clip.pageId === page.id && clip.tracks.length > 0);
  if (clips.length === 0) return '';

  const nodesById = new Map<string, DesignNode>(page.document.nodes.map((node) => [node.id, node]));
  const lines: string[] = ['/* Folio Motion Engine — Compiled @keyframes */'];

  for (const clip of clips) {
    const tracksByNode = new Map<string, AnimationTrack[]>();
    for (const track of clip.tracks) {
      if (track.keyframes.length === 0) continue;
      if (!nodesById.has(track.targetNodeId)) continue;
      const list = tracksByNode.get(track.targetNodeId) ?? [];
      list.push(track);
      tracksByNode.set(track.targetNodeId, list);
    }

    if (tracksByNode.size === 0) continue;
    const playClass = getClipCssClassName(clip);
    const iteration = clip.loop ? 'infinite' : '1';
    const fillMode = clip.loop ? 'none' : 'both';

    for (const [nodeId, nodeTracks] of tracksByNode.entries()) {
      const node = nodesById.get(nodeId)!;
      const kfName = getKeyframesName(clip.id, nodeId);

      // Collect all unique normalized stop timestamps across this node's tracks
      const stopSet = new Set<number>([0, clip.durationMs]);
      for (const track of nodeTracks) {
        for (const kf of track.keyframes) {
          stopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
        }
      }
      const stops = [...stopSet].sort((a, b) => a - b);

      // Pick dominant easing from the first non-initial keyframe for overall timing
      let dominantEasing = 'ease-out';
      for (const track of nodeTracks) {
        const sorted = sortKeyframes(track.keyframes);
        if (sorted.length > 1) {
          dominantEasing = toCssTimingFunction(sorted[1].easing);
          break;
        }
      }

      lines.push(`@keyframes ${kfName} {`);
      for (const stopMs of stops) {
        const declarations: string[] = [];
        let dx = 0;
        let dy = 0;
        let rotation: number | undefined;
        let scale: number | undefined;
        let hasTransform = false;

        for (const track of nodeTracks) {
          const val = evaluateTrackAtTime(track, stopMs);
          if (val === undefined) continue;
          if (track.property === 'x') {
            dx = Math.round((Number(val) - node.x) * 100) / 100;
            hasTransform = true;
          } else if (track.property === 'y') {
            dy = Math.round((Number(val) - node.y) * 100) / 100;
            hasTransform = true;
          } else if (track.property === 'width') {
            declarations.push(`width: ${Math.max(1, Math.round(Number(val) * 100) / 100)}px;`);
          } else if (track.property === 'height') {
            declarations.push(`height: ${Math.max(1, Math.round(Number(val) * 100) / 100)}px;`);
          } else if (track.property === 'rotation') {
            rotation = Math.round(Number(val) * 100) / 100;
            hasTransform = true;
          } else if (track.property === 'scale') {
            scale = Math.round(Number(val) * 1000) / 1000;
            hasTransform = true;
          } else if (track.property === 'opacity') {
            declarations.push(`opacity: ${Math.max(0, Math.min(1, Number(val)))};`);
          } else if (track.property === 'radius' && node.type !== 'ellipse') {
            declarations.push(`border-radius: ${Math.max(0, Math.round(Number(val) * 100) / 100)}px;`);
          } else if (track.property === 'fill') {
            const prop = node.type === 'text' ? 'color' : 'background-color';
            declarations.push(`${prop}: ${String(val)};`);
          } else if (track.property === 'stroke') {
            declarations.push(`border-color: ${String(val)};`);
          } else if (track.property === 'strokeWidth') {
            declarations.push(`border-width: ${Math.max(0, Math.round(Number(val) * 100) / 100)}px;`);
          }
        }

        if (hasTransform) {
          const parts: string[] = [];
          if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
          if (rotation !== undefined) parts.push(`rotate(${rotation}deg)`);
          if (scale !== undefined) parts.push(`scale(${scale})`);
          declarations.push(`transform: ${parts.length > 0 ? parts.join(' ') : 'none'};`);
        }

        if (declarations.length > 0) {
          lines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${declarations.join(' ')} }`);
        }
      }
      lines.push('}');

      const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
      const selectors = clip.autoplay
        ? [`${attrSelector}`, `.${playClass} ${attrSelector}`, `${attrSelector}.${playClass}`]
        : [`.${playClass} ${attrSelector}`, `${attrSelector}.${playClass}`];
      lines.push(
        `${selectors.join(', ')} { animation: ${kfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}; will-change: transform, opacity; }`,
      );
    }
  }

  lines.push('@media (prefers-reduced-motion: reduce) {');
  lines.push('  [data-folio-id] { animation: none !important; transition: none !important; }');
  lines.push('}');

  return lines.join('\n');
}

export interface LivePreviewAnimationClipDescriptor {
  id: string;
  name: string;
  className: string;
  durationMs: number;
  loop: boolean;
  autoplay: boolean;
  targetNodeIds: string[];
}

export function buildLivePreviewAnimationPayload(
  project: FolioProject,
  page: FolioPage,
): LivePreviewAnimationClipDescriptor[] {
  return (project.animations ?? [])
    .filter((clip) => clip.pageId === page.id)
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      className: getClipCssClassName(clip),
      durationMs: clip.durationMs,
      loop: clip.loop,
      autoplay: clip.autoplay,
      targetNodeIds: [...new Set(clip.tracks.map((track) => track.targetNodeId))],
    }));
}

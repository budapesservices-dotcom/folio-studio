import type {
  AnimationClip,
  AnimationEasing,
  AnimationTrack,
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
  MotionPathBinding,
  TrimPathMode,
  VisualEffect,
} from '../../core/document/types';
import { resolveComponentInstanceNodes } from '../../core/document/components';
import { getProjectDesignTokens } from '../../core/document/tokens';
import {
  formatColorWithAlpha,
  getVisibleEffects,
  parseColorWithAlpha,
} from '../../core/document/styling';
import { applyAutoLayoutToNodes } from '../layout/autoLayout';
import { evaluateTrackAtTime, sortKeyframes } from './evaluator';
import { easingToCubicBezier, evaluateEasing, isMultiPointEasing, toCssTimingFunction } from './easing';
import { sanitizeCssValue } from '../codegen/sanitize';
import {
  parsePathMorphSnapshot,
  prepareMorphPair,
} from '../../core/document/pathMorph';
import {
  computeContourTrimIntervals,
  evaluateMotionPathAtProgress,
  evaluateMotionPathBindingAtTime,
  getNodeContourLengths,
  intervalsToSvgStrokeDash,
} from '../../core/document/pathStudio';

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

function roundCssNum(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getEffectiveStaticWorldRotation(node: DesignNode): number {
  return node.type === 'group' ? 0 : (node.rotation || 0);
}

function resolveSegmentEasing(
  nodeTracks: readonly AnimationTrack[],
  stopMs: number,
  nextStopMs: number,
): AnimationEasing | null {
  for (const track of nodeTracks) {
    const sorted = sortKeyframes(track.keyframes);
    const exactNext = sorted.find((kf) => Math.abs(Math.round(kf.timeMs) - nextStopMs) <= 1);
    if (exactNext && exactNext.timeMs > stopMs) {
      return exactNext.easing;
    }
  }
  for (const track of nodeTracks) {
    const sorted = sortKeyframes(track.keyframes);
    const after = sorted.find((kf) => kf.timeMs > stopMs);
    if (after) return after.easing;
  }
  return null;
}

function trackValuesVary(track: AnimationTrack): boolean {
  if (track.keyframes.length <= 1) return false;
  const first = track.keyframes[0].value;
  for (let i = 1; i < track.keyframes.length; i += 1) {
    const val = track.keyframes[i].value;
    if (typeof first === 'number' && typeof val === 'number') {
      if (Math.abs(first - val) > 1e-4) return true;
    } else if (String(first).trim().toLowerCase() !== String(val).trim().toLowerCase()) {
      return true;
    }
  }
  return false;
}

function getTrackNormalizedStops(track: AnimationTrack, durationMs: number): number[] {
  const sorted = sortKeyframes(track.keyframes);
  const set = new Set<number>([0, durationMs]);
  for (const kf of sorted) {
    set.add(Math.max(0, Math.min(durationMs, Math.round(kf.timeMs))));
  }
  return [...set].sort((a, b) => a - b);
}

function getTrackIntervalCssEasing(
  track: AnimationTrack,
  stopMs: number,
  nextStopMs: number,
): string | null {
  const sorted = sortKeyframes(track.keyframes);
  if (sorted.length < 2) return null;
  if (nextStopMs <= sorted[0].timeMs || stopMs >= sorted[sorted.length - 1].timeMs) {
    return null; // Constant hold outside track range
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (stopMs >= a.timeMs - 1 && nextStopMs <= b.timeMs + 1) {
      // Check whether value actually changes on this segment
      if (typeof a.value === 'number' && typeof b.value === 'number' && Math.abs(a.value - b.value) <= 1e-4) {
        return null;
      }
      if (typeof a.value === 'string' && typeof b.value === 'string' && a.value === b.value) {
        return null;
      }
      return toCssTimingFunction(b.easing);
    }
  }
  return null;
}

/**
 * Determines whether a set of tracks compiled into ONE `@keyframes` rule have
 * divergent stop timestamps or different per-interval easings (which would cause
 * double-easing or cross-track easing contamination if emitted as sparse stops).
 */
function tracksRequireDenseLinearSampling(
  tracks: readonly AnimationTrack[],
  durationMs: number,
  ancestorTracks: readonly AnimationTrack[],
  hasRotatingAnimatedParent: boolean,
): boolean {
  if (hasRotatingAnimatedParent) return true;
  const varying = tracks.filter((t) => t.keyframes.length >= 2 && trackValuesVary(t));
  const varyingAnc = ancestorTracks.filter((t) => t.keyframes.length >= 2 && trackValuesVary(t));
  const combined = [...varying, ...varyingAnc];
  if (combined.length <= 1) return false;

  // Build union of stop timestamps
  const stopSet = new Set<number>([0, durationMs]);
  for (const tr of combined) {
    for (const kf of tr.keyframes) {
      stopSet.add(Math.max(0, Math.min(durationMs, Math.round(kf.timeMs))));
    }
  }
  const stops = [...stopSet].sort((a, b) => a - b);

  // Check if any track has an interior stop that splits another track's eased segment!
  for (const tr of combined) {
    const sorted = sortKeyframes(tr.keyframes);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const valChanges =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? Math.abs(a.value - b.value) > 1e-4
          : String(a.value) !== String(b.value);
      if (!valChanges) continue;
      const isLinearSeg = b.easing === 'linear';
      if (isLinearSeg) continue;
      // If any union stop falls strictly inside (a.timeMs, b.timeMs), splitting this
      // non-linear segment into sub-segments would double-ease it!
      if (stops.some((s) => s > a.timeMs + 1 && s < b.timeMs - 1)) {
        return true;
      }
    }
  }

  // Check if two tracks have DIFFERENT CSS easings on any overlapping active interval
  for (let i = 0; i < stops.length - 1; i += 1) {
    let seenEasing: string | null = null;
    for (const tr of combined) {
      const e = getTrackIntervalCssEasing(tr, stops[i], stops[i + 1]);
      if (!e) continue;
      if (seenEasing === null) {
        seenEasing = e;
      } else if (seenEasing !== e) {
        return true;
      }
    }
  }

  // Also check if two tracks have different start/end hold boundaries around non-linear segments
  if (varying.length > 1) {
    const firstStops = getTrackNormalizedStops(varying[0], durationMs).join(',');
    for (let i = 1; i < varying.length; i += 1) {
      if (getTrackNormalizedStops(varying[i], durationMs).join(',') !== firstStops) {
        // Different stop sets with any non-linear easing -> sample cleanly
        const anyNonLinear = varying.some((tr) =>
          sortKeyframes(tr.keyframes).some((kf, idx) => idx > 0 && kf.easing !== 'linear'),
        );
        if (anyNonLinear) return true;
      }
    }
  }

  return false;
}

function buildDenseTimestamps(durationMs: number, exactStops: readonly number[]): number[] {
  const sampleCount = Math.max(24, Math.min(60, Math.round((durationMs / 1000) * 30)));
  const set = new Set<number>([0, durationMs]);
  for (let i = 1; i < sampleCount; i += 1) {
    set.add(Math.round((i / sampleCount) * durationMs));
  }
  for (const s of exactStops) {
    set.add(Math.max(0, Math.min(durationMs, Math.round(s))));
  }
  return [...set].sort((a, b) => a - b);
}

function pickDominantEasing(tracks: readonly AnimationTrack[]): string {
  for (const track of tracks) {
    const sorted = sortKeyframes(track.keyframes);
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const changes =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? Math.abs(a.value - b.value) > 1e-4
          : String(a.value) !== String(b.value);
      if (changes) {
        return toCssTimingFunction(b.easing);
      }
    }
  }
  for (const track of tracks) {
    const sorted = sortKeyframes(track.keyframes);
    if (sorted.length > 1) {
      return toCssTimingFunction(sorted[1].easing);
    }
  }
  return 'ease-out';
}

/**
 * Compiles all AnimationClips belonging to `page` into deterministic CSS `@keyframes`
 * rules, trigger classes (`.folio-anim-play-<clipId>`), autoplay bindings, and
 * `@media (prefers-reduced-motion: reduce)` safeguards.
 *
 * Maintains 1:1 visual parity with Canvas Motion playback across:
 * - Freeform & Auto-Layout nodes (preserving static rotation & constraints centering)
 * - Nested Groups & Frames (preventing double-translation, double-rotation, & double-fade)
 * - Vector `path` nodes (animating SVG `<path>` fill/stroke/stroke-width instead of wrapper box)
 * - Per-segment keyframe easing curves & border-style activation
 */
const MAX_COMPONENT_ANIM_DEPTH = 8;

/**
 * Recursively collects all embedded `ComponentDefinition.animations` for every
 * `component-instance` placed on `page` (including nested instances), rewriting
 * each child's `targetNodeId` to the exact `data-folio-id` emitted by `htmlCssCompiler`
 * (`${instanceId}__${childNodeId}`).
 */
function collectPageComponentInstanceAnimations(
  project: FolioProject,
  page: FolioPage,
): { scopedClips: AnimationClip[]; scopedNodesById: Map<string, DesignNode> } {
  const scopedClips: AnimationClip[] = [];
  const scopedNodesById = new Map<string, DesignNode>();
  if (!project.components || project.components.length === 0) {
    return { scopedClips, scopedNodesById };
  }

  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );
  const tokens = getProjectDesignTokens(project);

  const visitNodes = (
    nodes: readonly DesignNode[],
    idPrefix: string,
    visitedComponentIds: ReadonlySet<string>,
    depth: number,
  ) => {
    if (depth >= MAX_COMPONENT_ANIM_DEPTH) return;
    for (const node of nodes) {
      if (node.type !== 'component-instance' || node.onCanvas === false) continue;
      const master = componentsById.get(node.componentId);
      if (!master || visitedComponentIds.has(master.id)) continue;

      const emittedInstanceId = idPrefix ? `${idPrefix}${node.id}` : node.id;
      const childPrefix = `${emittedInstanceId}__`;
      const resolvedRaw = resolveComponentInstanceNodes(node, master, tokens);
      const resolvedChildren = resolvedRaw.some((child) => child.layout && child.layout.mode !== 'none')
        ? applyAutoLayoutToNodes(resolvedRaw, undefined, tokens)
        : resolvedRaw;

      const childIdSet = new Set(resolvedChildren.map((child) => child.id));
      for (const child of resolvedChildren) {
        const scopedId = `${childPrefix}${child.id}`;
        const scopedParentId =
          child.parentId && childIdSet.has(child.parentId)
            ? `${childPrefix}${child.parentId}`
            : undefined;
        scopedNodesById.set(scopedId, {
          ...child,
          id: scopedId,
          ...(scopedParentId ? { parentId: scopedParentId } : { parentId: undefined }),
        });
      }

      if (master.animations && master.animations.length > 0) {
        for (const clip of master.animations) {
          const mappedTracks = clip.tracks
            .filter((track) => track.keyframes.length > 0 && childIdSet.has(track.targetNodeId))
            .map((track) => ({
              ...track,
              id: `${childPrefix}${track.id}`,
              targetNodeId: `${childPrefix}${track.targetNodeId}`,
            }));
          const mappedMotionPaths = (clip.motionPaths ?? [])
            .filter((mp) => mp.points.length >= 2 && childIdSet.has(mp.targetNodeId))
            .map((mp) => ({
              ...mp,
              id: `${childPrefix}${mp.id}`,
              targetNodeId: `${childPrefix}${mp.targetNodeId}`,
            }));
          if (mappedTracks.length > 0 || mappedMotionPaths.length > 0) {
            scopedClips.push({
              ...clip,
              id: `${emittedInstanceId}__${clip.id}`,
              pageId: page.id,
              // Embedded component animations play continuously in Live Preview / HTML5 export,
              // matching `evaluateComponentDocumentAtTime` on the Studio Canvas.
              autoplay: true,
              loop: true,
              tracks: mappedTracks,
              ...(mappedMotionPaths.length > 0 ? { motionPaths: mappedMotionPaths } : {}),
            });
          }
        }
      }

      const nextVisited = new Set(visitedComponentIds);
      nextVisited.add(master.id);
      visitNodes(resolvedChildren, childPrefix, nextVisited, depth + 1);
    }
  };

  visitNodes(page.document.nodes, '', new Set<string>(), 0);
  return { scopedClips, scopedNodesById };
}

/**
 * Returns the set of emitted `data-folio-id`s on `page` (including children inside
 * animated component instances) that have an active `pathMorph` track.
 */
export function collectPageMorphNodeIds(
  project: FolioProject,
  page: FolioPage,
): Set<string> {
  const result = new Set<string>();
  const pageClips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
  const { scopedClips } = collectPageComponentInstanceAnimations(project, page);
  for (const clip of [...pageClips, ...scopedClips]) {
    for (const track of clip.tracks) {
      if (track.property === 'pathMorph' && track.keyframes.length > 0) {
        result.add(track.targetNodeId);
      }
    }
  }
  return result;
}

/**
 * Returns a map from emitted `data-folio-id` to the `t=0` serialized `pathMorph`
 * snapshot string so `htmlCssCompiler` can initialize `<path d="...">` with the
 * exact starting shape of the animation (avoiding flash of un-morphed base geometry).
 */
export function collectPageInitialMorphSnapshots(
  project: FolioProject,
  page: FolioPage,
): Map<string, string> {
  const result = new Map<string, string>();
  const pageClips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
  const { scopedClips } = collectPageComponentInstanceAnimations(project, page);
  for (const clip of [...pageClips, ...scopedClips]) {
    if (!clip.autoplay) continue;
    for (const track of clip.tracks) {
      if (track.property !== 'pathMorph' || track.keyframes.length === 0) continue;
      if (result.has(track.targetNodeId)) continue;
      const sorted = sortKeyframes(track.keyframes);
      if (typeof sorted[0]?.value === 'string') {
        result.set(track.targetNodeId, sorted[0].value);
      }
    }
  }
  return result;
}

export function collectPageTrimNodeIds(
  project: FolioProject,
  page: FolioPage,
): Set<string> {
  const result = new Set<string>();
  const pageClips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
  const { scopedClips } = collectPageComponentInstanceAnimations(project, page);
  for (const clip of [...pageClips, ...scopedClips]) {
    for (const track of clip.tracks) {
      if (
        (track.property === 'trimStart' ||
          track.property === 'trimEnd' ||
          track.property === 'trimOffset') &&
        track.keyframes.length > 0
      ) {
        result.add(track.targetNodeId);
      }
    }
  }
  return result;
}

export function compilePageAnimationsCss(project: FolioProject, page: FolioPage): string {
  const pageClips = (project.animations ?? []).filter(
    (clip) =>
      clip.pageId === page.id &&
      (clip.tracks.length > 0 || (clip.motionPaths !== undefined && clip.motionPaths.length > 0)),
  );
  const { scopedClips, scopedNodesById } = collectPageComponentInstanceAnimations(project, page);
  const clips = [...pageClips, ...scopedClips];
  if (clips.length === 0) return '';

  // Solve Auto-Layout first so animation baseline (node.x, node.y, width, height)
  // matches the exact CSS layout box emitted by compilePageHtmlCss!
  const tokens = getProjectDesignTokens(project);
  const solvedPageNodes = page.document.nodes.some((n) => n.layout && n.layout.mode !== 'none')
    ? applyAutoLayoutToNodes(page.document.nodes, undefined, tokens)
    : page.document.nodes;

  const nodesById = new Map<string, DesignNode>(solvedPageNodes.map((node) => [node.id, node]));
  for (const [scopedId, scopedNode] of scopedNodesById.entries()) {
    nodesById.set(scopedId, scopedNode);
  }
  const morphNodeIds = collectPageMorphNodeIds(project, page);
  const lines: string[] = ['/* Folio Motion Engine — Compiled @keyframes */'];
  if (morphNodeIds.size > 0) {
    lines.push(
      '/* Note: Shape Morph (`pathMorph`) tracks require geometry interpolation and are rendered via the Folio Motion Runtime (Live Preview, HTML5 export, React TSX `useFolioShapeMorph`, Video MP4/MOV/WebM, GIF, PNG Sequence, Animated SVG). Pure CSS @keyframes preserves transform/style tracks only. */',
    );
  }

  const getValidParent = (node: DesignNode): DesignNode | null => {
    if (!node.parentId || node.parentId === node.id) return null;
    const p = nodesById.get(node.parentId);
    return p && p.onCanvas !== false ? p : null;
  };

  // Aggregate autoplay animations per node so multiple autoplay clips targeting the
  // same node compose via comma-separated CSS `animation:` instead of overwriting each other.
  const autoplayWrapperSpecs = new Map<string, string[]>();
  const autoplaySvgPathSpecs = new Map<string, string[]>();
  const autoplaySvgPolySpecs = new Map<string, string[]>();
  const autoplayTrimSpecs = new Map<string, string[]>();

  for (const clip of clips) {
    const tracksByNode = new Map<string, AnimationTrack[]>();
    for (const track of clip.tracks) {
      if (track.keyframes.length === 0) continue;
      if (!nodesById.has(track.targetNodeId)) continue;
      const list = tracksByNode.get(track.targetNodeId) ?? [];
      list.push(track);
      tracksByNode.set(track.targetNodeId, list);
    }

    const motionPathByNode = new Map<string, MotionPathBinding>();
    for (const mp of clip.motionPaths ?? []) {
      if (mp.points.length < 2) continue;
      if (!nodesById.has(mp.targetNodeId)) continue;
      motionPathByNode.set(mp.targetNodeId, mp);
      if (!tracksByNode.has(mp.targetNodeId)) {
        tracksByNode.set(mp.targetNodeId, []);
      }
    }

    if (tracksByNode.size === 0) continue;
    const playClass = getClipCssClassName(clip);
    const iteration = clip.loop ? 'infinite' : '1';
    const fillMode = clip.loop ? 'none' : 'both';

    // Track which parent nodes have animated descendants in this clip
    const hasAnimatedDescendant = new Set<string>();
    for (const nodeId of tracksByNode.keys()) {
      let cur = nodesById.get(nodeId);
      const seen = new Set<string>([nodeId]);
      while (cur) {
        const parent = getValidParent(cur);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        hasAnimatedDescendant.add(parent.id);
        cur = parent;
      }
    }

    // Helper: evaluate a node's world animated delta for a given property at timeMs
    const evalProp = (nodeId: string, prop: AnimationTrack['property'], timeMs: number): number | string | undefined => {
      const tracks = tracksByNode.get(nodeId);
      if (!tracks) return undefined;
      const track = tracks.find((t) => t.property === prop);
      if (!track) return undefined;
      return evaluateTrackAtTime(track, timeMs);
    };

    const getAnimatedAncestors = (node: DesignNode): DesignNode[] => {
      const result: DesignNode[] = [];
      const seen = new Set<string>([node.id]);
      let cur = getValidParent(node);
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (tracksByNode.has(cur.id)) {
          result.push(cur);
        }
        cur = getValidParent(cur);
      }
      return result;
    };

    const getEffectiveAnimWorldRotation = (target: DesignNode, timeMs: number): number => {
      if (target.type === 'group') {
        if (hasAnimatedDescendant.has(target.id)) return 0;
        const val = evalProp(target.id, 'rotation', timeMs);
        return val !== undefined ? Number(val) : 0;
      }
      const val = evalProp(target.id, 'rotation', timeMs);
      return val !== undefined ? Number(val) : (target.rotation || 0);
    };

    const getEffectiveParentStaticWorldRotation = (node: DesignNode): number => {
      const parent = getValidParent(node);
      if (!parent) return 0;
      return getEffectiveStaticWorldRotation(parent);
    };

    for (const [nodeId, nodeTracks] of tracksByNode.entries()) {
      const node = nodesById.get(nodeId)!;
      const kfName = getKeyframesName(clip.id, nodeId);
      const animatedAncestors = getAnimatedAncestors(node);
      const nearestAnimatedAncestor = animatedAncestors[0] ?? null;
      const directParent = getValidParent(node);

      const isMorphSvgNode = morphNodeIds.has(node.id);
      const isPathNode = node.type === 'path' || isMorphSvgNode;
      const isBoxShadowNode =
        !isMorphSvgNode &&
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse' || node.type === 'image');
      const pathHasArrows =
        node.type === 'path' &&
        !node.closed &&
        node.points.length >= 2 &&
        Boolean(node.style.arrowStart || node.style.arrowEnd);

      const nodeMotionPath = motionPathByNode.get(nodeId);
      const trimTracks = nodeTracks.filter(
        (t) => t.property === 'trimStart' || t.property === 'trimEnd' || t.property === 'trimOffset',
      );

      // Partition tracks into wrapper-CSS tracks vs SVG-element tracks (`> svg path` / `polygon`)
      // so SVG color/stroke animations do not pollute wrapper transform timing or vice versa!
      const svgTargetedProps = new Set<AnimationTrack['property']>(
        isPathNode ? ['fill', 'stroke', 'strokeWidth'] : [],
      );
      const wrapperTracks = nodeTracks.filter(
        (t) =>
          t.property !== 'pathMorph' &&
          t.property !== 'trimStart' &&
          t.property !== 'trimEnd' &&
          t.property !== 'trimOffset' &&
          !(nodeMotionPath && (t.property === 'x' || t.property === 'y')) &&
          !svgTargetedProps.has(t.property),
      );
      const svgTracks = nodeTracks.filter((t) => svgTargetedProps.has(t.property));

      const ancestorTracksForWrapper: AnimationTrack[] = [];
      let hasMotionPathAncestor = false;
      for (const anc of animatedAncestors) {
        const ancHasMotionPath = motionPathByNode.has(anc.id);
        if (ancHasMotionPath) {
          hasMotionPathAncestor = true;
        }
        for (const ancTrack of tracksByNode.get(anc.id) ?? []) {
          if (ancHasMotionPath && (ancTrack.property === 'x' || ancTrack.property === 'y')) {
            continue;
          }
          if (
            ancTrack.property === 'x' ||
            ancTrack.property === 'y' ||
            ancTrack.property === 'width' ||
            ancTrack.property === 'height' ||
            ancTrack.property === 'rotation' ||
            ancTrack.property === 'scale' ||
            ancTrack.property === 'opacity' ||
            ancTrack.property === 'motionPathProgress' ||
            ancTrack.property === 'motionPathStart' ||
            ancTrack.property === 'motionPathEnd' ||
            ancTrack.property === 'motionPathOffset'
          ) {
            ancestorTracksForWrapper.push(ancTrack);
          }
        }
      }

      const directParentHasAnimRot = Boolean(
        directParent &&
          directParent.type !== 'group' &&
          (tracksByNode.get(directParent.id)?.some((t) => t.property === 'rotation' && trackValuesVary(t)) ||
            Boolean(motionPathByNode.get(directParent.id)?.autoOrient)),
      );

      // Build wrapper stop timestamps
      const wrapperStopSet = new Set<number>([0, clip.durationMs]);
      for (const track of wrapperTracks) {
        for (const kf of track.keyframes) {
          wrapperStopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
        }
      }
      if (nodeMotionPath?.pathKeyframes) {
        for (const pkf of nodeMotionPath.pathKeyframes) {
          wrapperStopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(pkf.timeMs))));
        }
      }
      for (const ancTrack of ancestorTracksForWrapper) {
        for (const kf of ancTrack.keyframes) {
          wrapperStopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
        }
      }
      const rawWrapperStops = [...wrapperStopSet].sort((a, b) => a - b);
      const useDenseWrapperLinear =
        Boolean(nodeMotionPath) ||
        hasMotionPathAncestor ||
        tracksRequireDenseLinearSampling(
          wrapperTracks,
          clip.durationMs,
          ancestorTracksForWrapper,
          directParentHasAnimRot,
        );
      const stops = useDenseWrapperLinear
        ? buildDenseTimestamps(clip.durationMs, rawWrapperStops)
        : rawWrapperStops;

      const dominantEasing = useDenseWrapperLinear ? 'linear' : pickDominantEasing(wrapperTracks);

      // Determine whether this node has static constraint centering that must be preserved in transform
      const parentIsAutoLayout = Boolean(directParent?.layout && directParent.layout.mode !== 'none');
      const isOutOfFlowInAutoLayout =
        parentIsAutoLayout &&
        (node.layoutChild?.position === 'absolute' || node.layoutChild?.position === 'fixed');
      const hasExplicitInsets = Boolean(
        node.layoutChild?.inset &&
          (node.layoutChild.inset.top ||
            node.layoutChild.inset.right ||
            node.layoutChild.inset.bottom ||
            node.layoutChild.inset.left),
      );
      const constraints = isOutOfFlowInAutoLayout && !hasExplicitInsets ? node.layoutChild?.constraints : undefined;
      const parentStaticWorldRot = getEffectiveParentStaticWorldRotation(node);
      const staticLocalRot = roundCssNum(getEffectiveStaticWorldRotation(node) - parentStaticWorldRot);

      // Check whether static CSS emitted a border on this node
      const hasStaticBorder =
        node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse'
          ? Boolean(
              node.style.borderSides ||
                (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none'),
            )
          : node.type === 'image'
            ? Boolean(
                node.style.borderSides ||
                  ((node.style.strokeWidth ?? 0) > 0 && node.style.stroke && node.style.stroke !== 'none'),
              )
            : false;

      const hasStaticMultiFill =
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') &&
        Array.isArray(node.style.fills) &&
        node.style.fills.some((f) => f.visible !== false && f.type !== 'solid');

      const heightTrack = wrapperTracks.find((t) => t.property === 'height');
      const textHeightActuallyChanges =
        node.type === 'text'
          ? Boolean(
              (heightTrack && trackValuesVary(heightTrack)) ||
                node.style.verticalAlign === 'middle' ||
                node.style.verticalAlign === 'bottom',
            )
          : true;

      const segmentEasings: Array<string | null> = useDenseWrapperLinear
        ? stops.map(() => null)
        : stops.map((stopMs, idx) => {
            if (idx >= stops.length - 1) return null;
            const seg = resolveSegmentEasing(wrapperTracks, stopMs, stops[idx + 1]);
            return seg ? toCssTimingFunction(seg) : null;
          });
      const hasMixedEasings = !useDenseWrapperLinear && segmentEasings.some((e) => e !== null && e !== dominantEasing);

      const trackedProps = new Set(wrapperTracks.map((t) => t.property));
      const hasShadowTracks =
        trackedProps.has('shadowOffsetX') ||
        trackedProps.has('shadowOffsetY') ||
        trackedProps.has('shadowBlur') ||
        trackedProps.has('shadowSpread') ||
        trackedProps.has('shadowOpacity');
      const hasFilterTracks =
        trackedProps.has('layerBlur') ||
        trackedProps.has('brightness') ||
        trackedProps.has('contrast') ||
        trackedProps.has('saturate') ||
        trackedProps.has('grayscale') ||
        (!isBoxShadowNode && hasShadowTracks);
      const hasBackdropBlurTrack = trackedProps.has('backdropBlur');

      const staticEffects = getVisibleEffects(node);
      const staticLayerBlur = staticEffects.find(
        (fx): fx is Extract<VisualEffect, { type: 'layer-blur' }> => fx.type === 'layer-blur',
      );
      const staticDropShadow = staticEffects.find(
        (fx): fx is Extract<VisualEffect, { type: 'drop-shadow' }> => fx.type === 'drop-shadow',
      );
      const staticShadowColor = staticDropShadow?.color ?? 'rgba(15, 23, 42, 0.32)';
      const parsedStaticShadow = parseColorWithAlpha(staticShadowColor, '#0F172A');
      const otherStaticBoxShadows = staticEffects
        .filter((fx) => fx !== staticDropShadow && (fx.type === 'drop-shadow' || fx.type === 'inner-shadow'))
        .map((fx) => {
          if (fx.type === 'inner-shadow') {
            return `inset ${roundCssNum(fx.x)}px ${roundCssNum(fx.y)}px ${Math.max(0, roundCssNum(fx.blur))}px ${roundCssNum(fx.spread ?? 0)}px ${sanitizeCssValue(fx.color, 'rgba(0,0,0,0.22)')}`;
          }
          if (fx.type === 'drop-shadow') {
            return `${roundCssNum(fx.x)}px ${roundCssNum(fx.y)}px ${Math.max(0, roundCssNum(fx.blur))}px ${roundCssNum(fx.spread ?? 0)}px ${sanitizeCssValue(fx.color, 'rgba(0,0,0,0.24)')}`;
          }
          return '';
        })
        .filter(Boolean);

      lines.push(`@keyframes ${kfName} {`);
      for (let stopIdx = 0; stopIdx < stops.length; stopIdx += 1) {
        const stopMs = stops[stopIdx];
        const declarations: string[] = [];
        let rawWorldDx = 0;
        let rawWorldDy = 0;
        let hasXTrack = false;
        let hasYTrack = false;
        let evalWidth: number | undefined;
        let evalHeight: number | undefined;
        let rotationVal: number | undefined;
        let scale: number | undefined;
        let hasTransform = false;
        let stopLayerBlur: number | undefined;
        let stopBackdropBlur: number | undefined;
        let stopShadowX: number | undefined;
        let stopShadowY: number | undefined;
        let stopShadowBlur: number | undefined;
        let stopShadowSpread: number | undefined;
        let stopShadowOpacity: number | undefined;
        let stopBrightness: number | undefined;
        let stopContrast: number | undefined;
        let stopSaturate: number | undefined;
        let stopGrayscale: number | undefined;

        for (const track of wrapperTracks) {
          const val = evaluateTrackAtTime(track, stopMs);
          if (val === undefined) continue;
          if (track.property === 'x') {
            rawWorldDx = Number(val) - node.x;
            hasXTrack = true;
            hasTransform = true;
          } else if (track.property === 'y') {
            rawWorldDy = Number(val) - node.y;
            hasYTrack = true;
            hasTransform = true;
          } else if (track.property === 'width') {
            evalWidth = Math.max(1, roundCssNum(Number(val)));
            if (node.type === 'component-instance') {
              hasTransform = true;
            } else {
              declarations.push(`width: ${evalWidth}px;`);
            }
          } else if (track.property === 'height') {
            evalHeight = Math.max(1, roundCssNum(Number(val)));
            if (node.type === 'component-instance') {
              hasTransform = true;
            } else if (textHeightActuallyChanges) {
              declarations.push(`height: ${evalHeight}px;`);
            }
          } else if (track.property === 'rotation') {
            if (!(node.type === 'group' && hasAnimatedDescendant.has(node.id))) {
              rotationVal = Number(val);
              hasTransform = true;
            }
          } else if (track.property === 'scale') {
            scale = Math.round(Number(val) * 1000) / 1000;
            hasTransform = true;
          } else if (track.property === 'opacity') {
            let targetOpacity = Math.max(0, Math.min(1, Number(val)));
            // Compensate animated ancestor opacity so nested children aren't double-faded
            for (const anc of animatedAncestors) {
              const ancOp = evalProp(anc.id, 'opacity', stopMs);
              if (ancOp !== undefined && Number(ancOp) > 0.001) {
                targetOpacity = Math.max(0, Math.min(1, targetOpacity / Number(ancOp)));
                break;
              }
            }
            declarations.push(`opacity: ${Math.round(targetOpacity * 1000) / 1000};`);
          } else if (track.property === 'radius' && node.type !== 'ellipse' && !isPathNode) {
            declarations.push(`border-radius: ${Math.max(0, roundCssNum(Number(val)))}px;`);
          } else if (track.property === 'fill') {
            const safeColor = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
            if (node.type === 'text') {
              declarations.push(`color: ${safeColor};`);
            } else {
              if (hasStaticMultiFill && trackValuesVary(track)) {
                declarations.push('background-image: none;');
              }
              declarations.push(`background-color: ${safeColor};`);
            }
          } else if (track.property === 'stroke') {
            const safeStroke = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
            declarations.push(`border-color: ${safeStroke};`);
          } else if (track.property === 'strokeWidth') {
            const sw = Math.max(0, roundCssNum(Number(val)));
            if (!hasStaticBorder && sw > 0) {
              declarations.push('border-style: solid;');
            }
            declarations.push(`border-width: ${sw}px;`);
          } else if (track.property === 'layerBlur') {
            stopLayerBlur = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'backdropBlur') {
            stopBackdropBlur = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'shadowOffsetX') {
            stopShadowX = roundCssNum(Number(val));
          } else if (track.property === 'shadowOffsetY') {
            stopShadowY = roundCssNum(Number(val));
          } else if (track.property === 'shadowBlur') {
            stopShadowBlur = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'shadowSpread') {
            stopShadowSpread = roundCssNum(Number(val));
          } else if (track.property === 'shadowOpacity') {
            stopShadowOpacity = Math.max(0, Math.min(1, Math.round(Number(val) * 1000) / 1000));
          } else if (track.property === 'brightness') {
            stopBrightness = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'contrast') {
            stopContrast = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'saturate') {
            stopSaturate = Math.max(0, roundCssNum(Number(val)));
          } else if (track.property === 'grayscale') {
            stopGrayscale = Math.max(0, roundCssNum(Number(val)));
          }
        }

        if (nodeMotionPath) {
          const progressVal = evalProp(nodeId, 'motionPathProgress', stopMs);
          const progressPct = progressVal !== undefined
            ? Number(progressVal)
            : clip.durationMs > 0
              ? (stopMs / clip.durationMs) * 100
              : 0;
          const startChVal = evalProp(nodeId, 'motionPathStart', stopMs);
          const endChVal = evalProp(nodeId, 'motionPathEnd', stopMs);
          const offsetChVal = evalProp(nodeId, 'motionPathOffset', stopMs);
          const timedMp = evaluateMotionPathBindingAtTime(nodeMotionPath, stopMs, evaluateEasing);
          const effectiveMp: MotionPathBinding =
            startChVal !== undefined || endChVal !== undefined || offsetChVal !== undefined
              ? {
                  ...timedMp,
                  startPct: startChVal !== undefined ? Math.max(0, Math.min(100, Number(startChVal))) : timedMp.startPct,
                  endPct: endChVal !== undefined ? Math.max(0, Math.min(100, Number(endChVal))) : timedMp.endPct,
                  offsetPx: offsetChVal !== undefined ? Math.max(-4000, Math.min(4000, Number(offsetChVal))) : timedMp.offsetPx,
                }
              : timedMp;
          const mpSample = evaluateMotionPathAtProgress(effectiveMp, progressPct);
          if (mpSample) {
            const effW = evalWidth ?? node.width;
            const effH = evalHeight ?? node.height;
            rawWorldDx = mpSample.x - effW / 2 - node.x;
            rawWorldDy = mpSample.y - effH / 2 - node.y;
            hasXTrack = true;
            hasYTrack = true;
            hasTransform = true;
            if (effectiveMp.autoOrient) {
              const rotDelta = rotationVal !== undefined ? rotationVal - (node.rotation || 0) : 0;
              rotationVal = roundCssNum(mpSample.tangentAngleDeg + (effectiveMp.orientOffsetDeg ?? 0) + rotDelta);
            }
          }
        }

        if (hasFilterTracks) {
          const filterTokens: string[] = [];
          const effBlur = stopLayerBlur !== undefined ? stopLayerBlur : (staticLayerBlur?.radius ?? 0);
          if (trackedProps.has('layerBlur') || effBlur > 0) {
            filterTokens.push(`blur(${Math.max(0, roundCssNum(effBlur))}px)`);
          }
          if (!isBoxShadowNode && hasShadowTracks) {
            const sx = stopShadowX ?? staticDropShadow?.x ?? 0;
            const sy = stopShadowY ?? staticDropShadow?.y ?? 12;
            const sb = stopShadowBlur ?? staticDropShadow?.blur ?? 24;
            const sa = stopShadowOpacity !== undefined ? stopShadowOpacity : parsedStaticShadow.alpha;
            const scolor = sanitizeCssValue(formatColorWithAlpha(parsedStaticShadow.hex, sa), 'rgba(15, 23, 42, 0)');
            filterTokens.push(`drop-shadow(${roundCssNum(sx)}px ${roundCssNum(sy)}px ${Math.max(0, roundCssNum(sb))}px ${scolor})`);
          }
          const effBrightness = stopBrightness !== undefined ? stopBrightness : (node.cssFilters?.brightness ?? 100);
          if (trackedProps.has('brightness') || Math.abs(effBrightness - 100) > 0.01) {
            filterTokens.push(`brightness(${roundCssNum(effBrightness)}%)`);
          }
          const effContrast = stopContrast !== undefined ? stopContrast : (node.cssFilters?.contrast ?? 100);
          if (trackedProps.has('contrast') || Math.abs(effContrast - 100) > 0.01) {
            filterTokens.push(`contrast(${roundCssNum(effContrast)}%)`);
          }
          const effSaturate = stopSaturate !== undefined ? stopSaturate : (node.cssFilters?.saturate ?? 100);
          if (trackedProps.has('saturate') || Math.abs(effSaturate - 100) > 0.01) {
            filterTokens.push(`saturate(${roundCssNum(effSaturate)}%)`);
          }
          const effGrayscale = stopGrayscale !== undefined ? stopGrayscale : (node.cssFilters?.grayscale ?? 0);
          if (trackedProps.has('grayscale') || effGrayscale > 0.01) {
            filterTokens.push(`grayscale(${roundCssNum(effGrayscale)}%)`);
          }
          declarations.push(`filter: ${filterTokens.length > 0 ? filterTokens.join(' ') : 'none'};`);
        }

        if (hasBackdropBlurTrack) {
          const effBackdrop = Math.max(0, roundCssNum(stopBackdropBlur ?? 0));
          const valStr = `blur(${effBackdrop}px)`;
          declarations.push(`backdrop-filter: ${valStr};`);
          declarations.push(`-webkit-backdrop-filter: ${valStr};`);
        }

        if (isBoxShadowNode && hasShadowTracks) {
          const sx = stopShadowX ?? staticDropShadow?.x ?? 0;
          const sy = stopShadowY ?? staticDropShadow?.y ?? 12;
          const sb = stopShadowBlur ?? staticDropShadow?.blur ?? 24;
          const ss = stopShadowSpread ?? staticDropShadow?.spread ?? 0;
          const sa = stopShadowOpacity !== undefined ? stopShadowOpacity : parsedStaticShadow.alpha;
          const scolor = sanitizeCssValue(formatColorWithAlpha(parsedStaticShadow.hex, sa), 'rgba(15, 23, 42, 0)');
          const primaryShadow = `${roundCssNum(sx)}px ${roundCssNum(sy)}px ${Math.max(0, roundCssNum(sb))}px ${roundCssNum(ss)}px ${scolor}`;
          const allShadows = [primaryShadow, ...otherStaticBoxShadows];
          declarations.push(`box-shadow: ${allShadows.join(', ')};`);
        }

        // For component-instance width/height animation, scale interior cleanly via transform
        // and shift center by half the size delta so top-left stays anchored to x/y like Canvas.
        let scaleX = scale;
        let scaleY = scale;
        if (node.type === 'component-instance' && (evalWidth !== undefined || evalHeight !== undefined)) {
          const wRatio = (evalWidth ?? node.width) / Math.max(1, node.width);
          const hRatio = (evalHeight ?? node.height) / Math.max(1, node.height);
          const baseScale = scale ?? 1;
          scaleX = Math.round(wRatio * baseScale * 1000) / 1000;
          scaleY = Math.round(hRatio * baseScale * 1000) / 1000;
          rawWorldDx += ((evalWidth ?? node.width) - node.width) / 2;
          rawWorldDy += ((evalHeight ?? node.height) - node.height) / 2;
          hasXTrack = true;
          hasYTrack = true;
        }

        // Subtract nearest animated ancestor's world translation so nested children never double-translate
        let ancWorldDx = 0;
        let ancWorldDy = 0;
        if (nearestAnimatedAncestor) {
          for (const anc of animatedAncestors) {
            const ax = evalProp(anc.id, 'x', stopMs);
            if (ax !== undefined) {
              ancWorldDx = Number(ax) - anc.x;
              break;
            }
          }
          for (const anc of animatedAncestors) {
            const ay = evalProp(anc.id, 'y', stopMs);
            if (ay !== undefined) {
              ancWorldDy = Number(ay) - anc.y;
              break;
            }
          }
        }

        const parentAnimWorldRot = directParent
          ? getEffectiveAnimWorldRotation(directParent, stopMs)
          : 0;

        // Project world delta into parent's rotated local coordinate space (handling animated parent rotation!)
        let localDx = hasXTrack ? rawWorldDx - ancWorldDx : 0;
        let localDy = hasYTrack ? rawWorldDy - ancWorldDy : 0;
        if (
          directParent &&
          directParent.type !== 'group' &&
          (hasXTrack || hasYTrack) &&
          Math.abs(parentAnimWorldRot - parentStaticWorldRot) > 0.01
        ) {
          const pcx0 = directParent.x + directParent.width / 2;
          const pcy0 = directParent.y + directParent.height / 2;
          const pEvalW = Number(evalProp(directParent.id, 'width', stopMs) ?? directParent.width);
          const pEvalH = Number(evalProp(directParent.id, 'height', stopMs) ?? directParent.height);
          const pcxAnim = Number(evalProp(directParent.id, 'x', stopMs) ?? directParent.x) + pEvalW / 2;
          const pcyAnim = Number(evalProp(directParent.id, 'y', stopMs) ?? directParent.y) + pEvalH / 2;

          const ccx0 = node.x + node.width / 2;
          const ccy0 = node.y + node.height / 2;
          const ccxAnim = node.x + rawWorldDx + (evalWidth ?? node.width) / 2;
          const ccyAnim = node.y + rawWorldDy + (evalHeight ?? node.height) / 2;

          const sRad = (parentStaticWorldRot * Math.PI) / 180;
          const sCos = Math.cos(sRad);
          const sSin = Math.sin(sRad);
          const c0LocalX = (ccx0 - pcx0) * sCos + (ccy0 - pcy0) * sSin;
          const c0LocalY = -(ccx0 - pcx0) * sSin + (ccy0 - pcy0) * sCos;

          const aRad = (parentAnimWorldRot * Math.PI) / 180;
          const aCos = Math.cos(aRad);
          const aSin = Math.sin(aRad);
          const targetLocalX = (ccxAnim - pcxAnim) * aCos + (ccyAnim - pcyAnim) * aSin;
          const targetLocalY = -(ccxAnim - pcxAnim) * aSin + (ccyAnim - pcyAnim) * aCos;

          const sizeShiftX = node.type === 'component-instance' ? 0 : ((evalWidth ?? node.width) - node.width) / 2;
          const sizeShiftY = node.type === 'component-instance' ? 0 : ((evalHeight ?? node.height) - node.height) / 2;
          localDx = targetLocalX - c0LocalX - sizeShiftX;
          localDy = targetLocalY - c0LocalY - sizeShiftY;
        } else if (
          (Math.abs(localDx) > 0.001 || Math.abs(localDy) > 0.001) &&
          Math.abs(parentStaticWorldRot) > 0.01
        ) {
          const rad = (parentStaticWorldRot * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const nextLocalDx = localDx * cos + localDy * sin;
          const nextLocalDy = -localDx * sin + localDy * cos;
          localDx = nextLocalDx;
          localDy = nextLocalDy;
        }
        const dx = roundCssNum(localDx);
        const dy = roundCssNum(localDy);

        // Compute effective local rotation (preserving static rotation when rotation isn't keyed,
        // and subtracting animated parent rotation to prevent double-rotation)
        let effectiveLocalRot: number | undefined;
        if (rotationVal !== undefined) {
          effectiveLocalRot = roundCssNum(rotationVal - parentAnimWorldRot);
        } else if (hasTransform && Math.abs(staticLocalRot) > 0.01) {
          effectiveLocalRot = staticLocalRot;
        }

        if (hasTransform) {
          const parts: string[] = [];
          if (constraints?.horizontal === 'center') parts.push('translateX(-50%)');
          if (constraints?.vertical === 'center') parts.push('translateY(-50%)');
          if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
          if (effectiveLocalRot !== undefined) parts.push(`rotate(${effectiveLocalRot}deg)`);
          if (scaleX !== undefined && scaleY !== undefined) {
            parts.push(Math.abs(scaleX - scaleY) < 0.001 ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`);
          }
          declarations.push(`transform: ${parts.length > 0 ? parts.join(' ') : 'none'};`);
        }

        if (hasMixedEasings && stopIdx < stops.length - 1 && segmentEasings[stopIdx]) {
          declarations.push(`animation-timing-function: ${segmentEasings[stopIdx]};`);
        }

        if (declarations.length > 0) {
          lines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${declarations.join(' ')} }`);
        }
      }
      lines.push('}');

      const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
      const animSpec = `${kfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}`;
      if (clip.autoplay) {
        const list = autoplayWrapperSpecs.get(nodeId) ?? [];
        list.push(animSpec);
        autoplayWrapperSpecs.set(nodeId, list);
      }
      const willChangeParts = ['transform', 'opacity'];
      if (hasFilterTracks) willChangeParts.push('filter');
      if (hasBackdropBlurTrack) willChangeParts.push('backdrop-filter');
      lines.push(
        `.${playClass} ${attrSelector}, ${attrSelector}.${playClass} { animation: ${animSpec}; will-change: ${willChangeParts.join(', ')}; }`,
      );
      lines.push(
        `.${playClass}--reverse ${attrSelector}, ${attrSelector}.${playClass}--reverse { animation-direction: reverse; }`,
      );
      lines.push(
        `.${playClass}--paused ${attrSelector}, ${attrSelector}.${playClass}--paused { animation-play-state: paused; }`,
      );
      lines.push(
        `.${playClass}--stopped ${attrSelector}, ${attrSelector}.${playClass}--stopped { animation: none; }`,
      );

      // Build independent SVG path & arrowhead polygon @keyframes with their own accurate timing!
      if (svgTracks.length > 0) {
        const svgStopSet = new Set<number>([0, clip.durationMs]);
        for (const track of svgTracks) {
          for (const kf of track.keyframes) {
            svgStopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
          }
        }
        const rawSvgStops = [...svgStopSet].sort((a, b) => a - b);
        const useDenseSvgLinear = tracksRequireDenseLinearSampling(svgTracks, clip.durationMs, [], false);
        const svgStops = useDenseSvgLinear
          ? buildDenseTimestamps(clip.durationMs, rawSvgStops)
          : rawSvgStops;
        const svgDominantEasing = useDenseSvgLinear ? 'linear' : pickDominantEasing(svgTracks);
        const svgSegmentEasings: Array<string | null> = useDenseSvgLinear
          ? svgStops.map(() => null)
          : svgStops.map((stopMs, idx) => {
              if (idx >= svgStops.length - 1) return null;
              const seg = resolveSegmentEasing(svgTracks, stopMs, svgStops[idx + 1]);
              return seg ? toCssTimingFunction(seg) : null;
            });
        const svgHasMixedEasings =
          !useDenseSvgLinear && svgSegmentEasings.some((e) => e !== null && e !== svgDominantEasing);

        const svgPathKeyframeLines: string[] = [];
        const svgPolygonKeyframeLines: string[] = [];

        for (let stopIdx = 0; stopIdx < svgStops.length; stopIdx += 1) {
          const stopMs = svgStops[stopIdx];
          const svgPathDecls: string[] = [];
          const svgPolyDecls: string[] = [];
          for (const track of svgTracks) {
            const val = evaluateTrackAtTime(track, stopMs);
            if (val === undefined) continue;
            if (track.property === 'fill') {
              const safeColor = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
              svgPathDecls.push(`fill: ${safeColor};`);
            } else if (track.property === 'stroke') {
              const safeStroke = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
              svgPathDecls.push(`stroke: ${safeStroke};`);
              if (pathHasArrows) {
                svgPolyDecls.push(`fill: ${safeStroke};`);
              }
            } else if (track.property === 'strokeWidth') {
              const sw = Math.max(0, roundCssNum(Number(val)));
              svgPathDecls.push(`stroke-width: ${sw}px;`);
            }
          }
          if (svgPathDecls.length > 0) {
            if (svgHasMixedEasings && stopIdx < svgStops.length - 1 && svgSegmentEasings[stopIdx]) {
              svgPathDecls.push(`animation-timing-function: ${svgSegmentEasings[stopIdx]};`);
            }
            svgPathKeyframeLines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${svgPathDecls.join(' ')} }`);
          }
          if (svgPolyDecls.length > 0) {
            if (svgHasMixedEasings && stopIdx < svgStops.length - 1 && svgSegmentEasings[stopIdx]) {
              svgPolyDecls.push(`animation-timing-function: ${svgSegmentEasings[stopIdx]};`);
            }
            svgPolygonKeyframeLines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${svgPolyDecls.join(' ')} }`);
          }
        }

        if (svgPathKeyframeLines.length > 0) {
          const svgKfName = `${kfName}--svg`;
          const pathSel = `${attrSelector} > svg path`;
          const svgAnimSpec = `${svgKfName} ${clip.durationMs}ms ${svgDominantEasing} ${iteration} ${fillMode}`;
          if (clip.autoplay) {
            const list = autoplaySvgPathSpecs.get(nodeId) ?? [];
            list.push(svgAnimSpec);
            autoplaySvgPathSpecs.set(nodeId, list);
          }
          lines.push(`@keyframes ${svgKfName} {`);
          lines.push(...svgPathKeyframeLines);
          lines.push('}');
          lines.push(
            `.${playClass} ${pathSel}, ${attrSelector}.${playClass} > svg path { animation: ${svgAnimSpec}; }`,
          );
          lines.push(
            `.${playClass}--reverse ${pathSel}, ${attrSelector}.${playClass}--reverse > svg path { animation-direction: reverse; }`,
          );
          lines.push(
            `.${playClass}--paused ${pathSel}, ${attrSelector}.${playClass}--paused > svg path { animation-play-state: paused; }`,
          );
          lines.push(
            `.${playClass}--stopped ${pathSel}, ${attrSelector}.${playClass}--stopped > svg path { animation: none; }`,
          );
        }

        if (svgPolygonKeyframeLines.length > 0) {
          const polyKfName = `${kfName}--poly`;
          const polySel = `${attrSelector} > svg polygon`;
          const polyAnimSpec = `${polyKfName} ${clip.durationMs}ms ${svgDominantEasing} ${iteration} ${fillMode}`;
          if (clip.autoplay) {
            const list = autoplaySvgPolySpecs.get(nodeId) ?? [];
            list.push(polyAnimSpec);
            autoplaySvgPolySpecs.set(nodeId, list);
          }
          lines.push(`@keyframes ${polyKfName} {`);
          lines.push(...svgPolygonKeyframeLines);
          lines.push('}');
          lines.push(
            `.${playClass} ${polySel}, ${attrSelector}.${playClass} > svg polygon { animation: ${polyAnimSpec}; }`,
          );
          lines.push(
            `.${playClass}--reverse ${polySel}, ${attrSelector}.${playClass}--reverse > svg polygon { animation-direction: reverse; }`,
          );
          lines.push(
            `.${playClass}--paused ${polySel}, ${attrSelector}.${playClass}--paused > svg polygon { animation-play-state: paused; }`,
          );
          lines.push(
            `.${playClass}--stopped ${polySel}, ${attrSelector}.${playClass}--stopped > svg polygon { animation: none; }`,
          );
        }
      }

      // Build Trim Path per-contour CSS @keyframes (`stroke-dasharray`, `stroke-dashoffset`, `stroke-opacity`)
      if (
        trimTracks.length > 0 &&
        (node.type === 'path' || node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse')
      ) {
        const contourLengths = getNodeContourLengths(node);
        const trimMode: TrimPathMode =
          trimTracks.find((t) => t.trimMode)?.trimMode ??
          ('style' in node && 'trimMode' in node.style ? node.style.trimMode : undefined) ??
          'simultaneous';
        const trimStopSet = new Set<number>([0, clip.durationMs]);
        for (const tr of trimTracks) {
          for (const kf of tr.keyframes) {
            trimStopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
          }
        }
        const trimStops = buildDenseTimestamps(clip.durationMs, [...trimStopSet]);
        const trimStartTrack = trimTracks.find((t) => t.property === 'trimStart');
        const trimEndTrack = trimTracks.find((t) => t.property === 'trimEnd');
        const trimOffsetTrack = trimTracks.find((t) => t.property === 'trimOffset');
        const baseTrimStart = 'style' in node && 'trimStart' in node.style ? (node.style.trimStart ?? 0) : 0;
        const baseTrimEnd = 'style' in node && 'trimEnd' in node.style ? (node.style.trimEnd ?? 100) : 100;
        const baseTrimOffset = 'style' in node && 'trimOffset' in node.style ? (node.style.trimOffset ?? 0) : 0;

        for (let cIdx = 0; cIdx < contourLengths.length; cIdx += 1) {
          const cLen = contourLengths[cIdx];
          if (cLen <= 0.01) continue;
          const trimKfName = `${kfName}--trim-${cIdx}`;
          const trimSel = `${attrSelector} [data-folio-trim-contour="${cIdx}"]`;
          lines.push(`@keyframes ${trimKfName} {`);
          for (const stopMs of trimStops) {
            const sVal = trimStartTrack ? Number(evaluateTrackAtTime(trimStartTrack, stopMs) ?? baseTrimStart) : baseTrimStart;
            const eVal = trimEndTrack ? Number(evaluateTrackAtTime(trimEndTrack, stopMs) ?? baseTrimEnd) : baseTrimEnd;
            const oVal = trimOffsetTrack ? Number(evaluateTrackAtTime(trimOffsetTrack, stopMs) ?? baseTrimOffset) : baseTrimOffset;
            const intervals = computeContourTrimIntervals(contourLengths, sVal, eVal, oVal, trimMode)[cIdx] ?? [];
            const dash = intervalsToSvgStrokeDash(cLen, intervals);
            const dashStr = dash.full
              ? `${roundCssNum(cLen)} ${roundCssNum(cLen + 4)}`
              : dash.dasharray ?? `0 ${roundCssNum(cLen + 4)}`;
            const offsetNum = dash.full ? 0 : (dash.dashoffset ?? 0);
            const opacityDecl = dash.visible ? 'stroke-opacity: 1;' : 'stroke-opacity: 0;';
            lines.push(
              `  ${formatPct(stopMs, clip.durationMs)} { stroke-dasharray: ${dashStr}; stroke-dashoffset: ${roundCssNum(offsetNum)}; ${opacityDecl} }`,
            );
          }
          lines.push('}');
          const trimAnimSpec = `${trimKfName} ${clip.durationMs}ms linear ${iteration} ${fillMode}`;
          if (clip.autoplay) {
            const key = `${nodeId}::${cIdx}`;
            const list = autoplayTrimSpecs.get(key) ?? [];
            list.push(trimAnimSpec);
            autoplayTrimSpecs.set(key, list);
          }
          lines.push(
            `.${playClass} ${trimSel}, ${attrSelector}.${playClass} [data-folio-trim-contour="${cIdx}"] { animation: ${trimAnimSpec}; }`,
          );
          lines.push(
            `.${playClass}--reverse ${trimSel}, ${attrSelector}.${playClass}--reverse [data-folio-trim-contour="${cIdx}"] { animation-direction: reverse; }`,
          );
          lines.push(
            `.${playClass}--paused ${trimSel}, ${attrSelector}.${playClass}--paused [data-folio-trim-contour="${cIdx}"] { animation-play-state: paused; }`,
          );
          lines.push(
            `.${playClass}--stopped ${trimSel}, ${attrSelector}.${playClass}--stopped [data-folio-trim-contour="${cIdx}"] { animation: none; }`,
          );
        }
      }
    }
  }

  // Emit composed autoplay rules before media queries so explicit `.folio-anim-play-*`
  // trigger classes (higher specificity) still override cleanly when triggered by Node Logic.
  for (const [nodeId, specs] of autoplayWrapperSpecs.entries()) {
    const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
    lines.push(`${attrSelector} { animation: ${specs.join(', ')}; will-change: transform, opacity; }`);
  }
  for (const [nodeId, specs] of autoplaySvgPathSpecs.entries()) {
    const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
    lines.push(`${attrSelector} > svg path { animation: ${specs.join(', ')}; }`);
  }
  for (const [nodeId, specs] of autoplaySvgPolySpecs.entries()) {
    const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
    lines.push(`${attrSelector} > svg polygon { animation: ${specs.join(', ')}; }`);
  }
  for (const [key, specs] of autoplayTrimSpecs.entries()) {
    const splitIdx = key.lastIndexOf('::');
    const nodeId = key.slice(0, splitIdx);
    const cIdx = key.slice(splitIdx + 2);
    const attrSelector = `[data-folio-id="${escapeAttrValue(nodeId)}"]`;
    lines.push(`${attrSelector} [data-folio-trim-contour="${cIdx}"] { animation: ${specs.join(', ')}; }`);
  }

  lines.push('@media (prefers-reduced-motion: reduce) {');
  lines.push('  [data-folio-id], [data-folio-id] > svg path, [data-folio-id] > svg polygon, [data-folio-id] [data-folio-trim-contour] { animation: none !important; transition: none !important; }');
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
      targetNodeIds: [
        ...new Set([
          ...clip.tracks.map((track) => track.targetNodeId),
          ...(clip.motionPaths ?? []).map((mp) => mp.targetNodeId),
        ]),
      ],
    }));
}

export type CompiledMorphEasing =
  | 'linear'
  | 'spring'
  | 'bounce-out'
  | 'elastic-out'
  | { t: 'cb'; b: readonly [number, number, number, number] }
  | { t: 'lut'; y: number[] };

export interface CompiledMorphContour {
  n: number;
  closed: boolean;
  /** Interleaved [x, y, hiX, hiY, hoX, hoY] * n (6 numbers per anchor) */
  from: number[];
  to: number[];
}

export interface CompiledMorphSegment {
  t0: number;
  t1: number;
  easing: CompiledMorphEasing;
  n: number;
  closed: boolean;
  /** Interleaved [x, y, hiX, hiY, hoX, hoY] * n (6 numbers per anchor) */
  from: number[];
  to: number[];
  /** Optional matched subpath / hole contours for multi-contour morphing. */
  subpaths?: CompiledMorphContour[];
}

export interface CompiledMorphTrack {
  nodeId: string;
  kfName: string;
  segments: CompiledMorphSegment[];
}

export interface CompiledMorphClip {
  id: string;
  className: string;
  kfPrefix: string;
  durationMs: number;
  loop: boolean;
  autoplay: boolean;
  tracks: CompiledMorphTrack[];
}

function compileMorphEasing(easing: AnimationEasing): CompiledMorphEasing {
  if (easing === 'linear' || easing === 'spring' || easing === 'bounce-out' || easing === 'elastic-out') {
    return easing;
  }
  if (isMultiPointEasing(easing)) {
    const steps = 32;
    const y: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      y.push(Math.round(evaluateEasing(easing, i / steps) * 10000) / 10000);
    }
    return { t: 'lut', y };
  }
  return { t: 'cb', b: easingToCubicBezier(easing) };
}

function packBuffer6(buf: Float64Array, flags: Uint8Array, count: number): number[] {
  const out: number[] = new Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    const src = i * 7;
    const dst = i * 6;
    const x = Math.round(buf[src] * 100) / 100;
    const y = Math.round(buf[src + 1] * 100) / 100;
    const f = flags[i];
    out[dst] = x;
    out[dst + 1] = y;
    out[dst + 2] = f & 1 ? Math.round(buf[src + 2] * 100) / 100 : x;
    out[dst + 3] = f & 1 ? Math.round(buf[src + 3] * 100) / 100 : y;
    out[dst + 4] = f & 2 ? Math.round(buf[src + 4] * 100) / 100 : x;
    out[dst + 5] = f & 2 ? Math.round(buf[src + 5] * 100) / 100 : y;
  }
  return out;
}

/**
 * Single canonical compiler for page + component-instance `pathMorph` animation clips.
 * Shared by Live Preview, standalone HTML5 export, AND React TSX runtime export so
 * all three targets produce 1:1 identical single-contour and multi-contour Bezier motion.
 */
export function compilePageMorphClips(
  project: FolioProject,
  page: FolioPage,
): CompiledMorphClip[] {
  const pageClips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
  const { scopedClips } = collectPageComponentInstanceAnimations(project, page);
  const clips = [...pageClips, ...scopedClips];
  const compiledClips: CompiledMorphClip[] = [];

  for (const clip of clips) {
    const morphTracks: CompiledMorphTrack[] = [];
    for (const track of clip.tracks) {
      if (track.property !== 'pathMorph' || track.keyframes.length === 0) continue;
      const sorted = sortKeyframes(track.keyframes);
      const segments: CompiledMorphSegment[] = [];

      if (sorted.length === 1) {
        const snapStr = String(sorted[0].value);
        const pair = prepareMorphPair(snapStr, snapStr);
        if (pair && pair.compatible && pair.pointCount >= 2) {
          const packed = packBuffer6(pair.fromBuf, pair.flags, pair.pointCount);
          const subpaths: CompiledMorphContour[] | undefined =
            pair.subpathPairs && pair.subpathPairs.length > 0
              ? pair.subpathPairs.map((sp) => {
                  const spPacked = packBuffer6(sp.fromBuf, sp.flags, sp.pointCount);
                  return { n: sp.pointCount, closed: sp.closed, from: spPacked, to: spPacked };
                })
              : undefined;
          segments.push({
            t0: 0,
            t1: Math.max(1, clip.durationMs),
            easing: 'linear',
            n: pair.pointCount,
            closed: pair.closed,
            from: packed,
            to: packed,
            ...(subpaths ? { subpaths } : {}),
          });
        }
      } else {
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const a = sorted[i];
          const b = sorted[i + 1];
          const fromStr = String(a.value);
          const toStr = String(b.value);
          const pair = prepareMorphPair(fromStr, toStr);
          if (!pair || !pair.compatible || pair.pointCount < 2) {
            const parsedA = parsePathMorphSnapshot(fromStr);
            if (!parsedA) continue;
            continue;
          }
          const subpaths: CompiledMorphContour[] | undefined =
            pair.subpathPairs && pair.subpathPairs.length > 0
              ? pair.subpathPairs.map((sp) => ({
                  n: sp.pointCount,
                  closed: sp.closed,
                  from: packBuffer6(sp.fromBuf, sp.flags, sp.pointCount),
                  to: packBuffer6(sp.toBuf, sp.flags, sp.pointCount),
                }))
              : undefined;
          segments.push({
            t0: Math.round(a.timeMs),
            t1: Math.round(b.timeMs),
            easing: compileMorphEasing(b.easing),
            n: pair.pointCount,
            closed: pair.closed,
            from: packBuffer6(pair.fromBuf, pair.flags, pair.pointCount),
            to: packBuffer6(pair.toBuf, pair.flags, pair.pointCount),
            ...(subpaths ? { subpaths } : {}),
          });
        }
      }

      if (segments.length > 0) {
        morphTracks.push({
          nodeId: track.targetNodeId,
          kfName: getKeyframesName(clip.id, track.targetNodeId),
          segments,
        });
      }
    }

    if (morphTracks.length > 0) {
      compiledClips.push({
        id: clip.id,
        className: getClipCssClassName(clip),
        kfPrefix: `folio-kf-${slugifyMotionId(clip.id)}-`,
        durationMs: Math.max(1, clip.durationMs),
        loop: clip.loop,
        autoplay: clip.autoplay,
        tracks: morphTracks,
      });
    }
  }

  return compiledClips;
}

/**
 * Generates a compact, zero-`eval`, CSP-safe inline `<script>` that drives real
 * cubic Bezier Native Shape Morph animations (single-contour and multi-contour/holes)
 * inside Live Preview and HTML5 exports, with exact Folio easing parity
 * (`cubic-bezier`, `spring`, `bounce-out`, `elastic-out`, `multi-point`) and live
 * Web Animations clock synchronization against CSS `@keyframes`.
 * Returns `''` when the page has no `pathMorph` tracks.
 */
export function buildLivePreviewMorphScript(
  project: FolioProject,
  page: FolioPage,
): string {
  const compiledClips = compilePageMorphClips(project, page);
  if (compiledClips.length === 0) return '';

  const serialized = JSON.stringify(compiledClips).replace(/</g, '\\u003c');
  return [
    '(function(){',
    `  var CLIPS=${serialized};`,
    '  var reduced=typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
    '  function solveBezier(b,x){',
    '    if(x<=0)return 0;if(x>=1)return 1;',
    '    var x1=Math.max(0,Math.min(1,b[0])),y1=b[1],x2=Math.max(0,Math.min(1,b[2])),y2=b[3];',
    '    if(Math.abs(x1-y1)<1e-6&&Math.abs(x2-y2)<1e-6)return x;',
    '    var cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx;',
    '    var cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;',
    '    var u=x;',
    '    for(var i=0;i<8;i++){',
    '      var xe=((ax*u+bx)*u+cx)*u-x;',
    '      if(Math.abs(xe)<1e-6)return((ay*u+by)*u+cy)*u;',
    '      var dx=(3*ax*u+2*bx)*u+cx;',
    '      if(Math.abs(dx)<1e-6)break;',
    '      u-=xe/dx;',
    '    }',
    '    var lo=0,hi=1;u=x;',
    '    for(var k=0;k<18;k++){',
    '      var xv=((ax*u+bx)*u+cx)*u;',
    '      if(Math.abs(xv-x)<1e-6)break;',
    '      if(x>xv)lo=u;else hi=u;u=0.5*(lo+hi);',
    '    }',
    '    return((ay*u+by)*u+cy)*u;',
    '  }',
    '  function evalEasing(e,x){',
    '    if(x<=0)return 0;if(x>=1)return 1;',
    '    if(e==="linear")return x;',
    '    if(e==="spring")return 1-Math.exp(-6*x)*Math.cos(x*Math.PI*2.5);',
    '    if(e==="elastic-out")return Math.pow(2,-10*x)*Math.sin((x*10-0.75)*(2*Math.PI/3))+1;',
    '    if(e==="bounce-out"){',
    '      var n1=7.5625,d1=2.75;',
    '      if(x<1/d1)return n1*x*x;',
    '      if(x<2/d1){x-=1.5/d1;return n1*x*x+0.75;}',
    '      if(x<2.5/d1){x-=2.25/d1;return n1*x*x+0.9375;}',
    '      x-=2.625/d1;return n1*x*x+0.984375;',
    '    }',
    '    if(e&&e.t==="cb")return solveBezier(e.b,x);',
    '    if(e&&e.t==="lut"&&e.y&&e.y.length>1){',
    '      var idx=x*(e.y.length-1),lo=Math.floor(idx),hi=Math.min(e.y.length-1,lo+1),f=idx-lo;',
    '      return e.y[lo]+(e.y[hi]-e.y[lo])*f;',
    '    }',
    '    return x;',
    '  }',
    '  function appendContourD(parts,n,closed,a,b,t){',
    '    if(n<2)return;',
    '    var x0=a[0]+(b[0]-a[0])*t,y0=a[1]+(b[1]-a[1])*t;',
    '    parts.push("M "+x0.toFixed(2)+" "+y0.toFixed(2));',
    '    for(var i=0;i<n;i++){',
    '      var j=(i+1)%n;if(!closed&&j===0)break;',
    '      var bi=i*6,bj=j*6;',
    '      var c1x=a[bi+4]+(b[bi+4]-a[bi+4])*t,c1y=a[bi+5]+(b[bi+5]-a[bi+5])*t;',
    '      var c2x=a[bj+2]+(b[bj+2]-a[bj+2])*t,c2y=a[bj+3]+(b[bj+3]-a[bj+3])*t;',
    '      var ex=a[bj]+(b[bj]-a[bj])*t,ey=a[bj+1]+(b[bj+1]-a[bj+1])*t;',
    '      parts.push("C "+c1x.toFixed(2)+" "+c1y.toFixed(2)+" "+c2x.toFixed(2)+" "+c2y.toFixed(2)+" "+ex.toFixed(2)+" "+ey.toFixed(2));',
    '    }',
    '    if(closed)parts.push("Z");',
    '  }',
    '  function buildPathD(seg,t){',
    '    var parts=[];',
    '    appendContourD(parts,seg.n,seg.closed,seg.from,seg.to,t);',
    '    if(seg.subpaths&&seg.subpaths.length){',
    '      for(var s=0;s<seg.subpaths.length;s++){',
    '        var sp=seg.subpaths[s];',
    '        appendContourD(parts,sp.n,sp.closed,sp.from,sp.to,t);',
    '      }',
    '    }',
    '    return parts.join(" ");',
    '  }',
    '  function evalTrack(tr,timeMs){',
    '    var segs=tr.segments;if(!segs.length)return null;',
    '    if(timeMs<=segs[0].t0)return buildPathD(segs[0],0);',
    '    var last=segs[segs.length-1];',
    '    if(timeMs>=last.t1)return buildPathD(last,1);',
    '    for(var i=0;i<segs.length;i++){',
    '      var s=segs[i];',
    '      if(timeMs>=s.t0&&timeMs<=s.t1){',
    '        var span=s.t1-s.t0;',
    '        var raw=span>0?(timeMs-s.t0)/span:1;',
    '        return buildPathD(s,evalEasing(s.easing,raw));',
    '      }',
    '    }',
    '    return buildPathD(last,1);',
    '  }',
    '  function findWrapEl(nodeId){',
    '    var esc=nodeId.replace(/"/g,"\\\\\\"");',
    '    return document.querySelector("[data-folio-id=\\""+esc+"\\"]");',
    '  }',
    '  function findPathEls(nodeId){',
    '    var wrap=findWrapEl(nodeId);',
    '    if(!wrap)return[];',
    '    var tagged=wrap.querySelectorAll("svg path[data-folio-morph-path]");',
    '    if(tagged&&tagged.length)return tagged;',
    '    var p=wrap.querySelector("svg path");',
    '    return p?[p]:[];',
    '  }',
    '  function readSyncedCssTime(st){',
    '    for(var i=0;i<st.clip.tracks.length;i++){',
    '      var tr=st.clip.tracks[i];',
    '      var wrap=findWrapEl(tr.nodeId);',
    '      if(!wrap||typeof wrap.getAnimations!=="function")continue;',
    '      var anims=wrap.getAnimations();',
    '      for(var j=0;j<anims.length;j++){',
    '        var an=anims[j];',
    '        if(an&&an.animationName===tr.kfName&&an.currentTime!==null&&typeof an.currentTime==="number"&&isFinite(an.currentTime)){',
    '          return{time:an.currentTime,state:an.playState};',
    '        }',
    '      }',
    '    }',
    '    if(st.clip.kfPrefix&&typeof document.getAnimations==="function"){',
    '      var allAnims=document.getAnimations();',
    '      for(var m=0;m<allAnims.length;m++){',
    '        var a=allAnims[m];',
    '        if(a&&typeof a.animationName==="string"&&a.animationName.indexOf(st.clip.kfPrefix)===0&&a.currentTime!==null&&typeof a.currentTime==="number"&&isFinite(a.currentTime)){',
    '          return{time:a.currentTime,state:a.playState};',
    '        }',
    '      }',
    '    }',
    '    return null;',
    '  }',
    '  var states=CLIPS.map(function(clip){',
    '    return{clip:clip,playing:Boolean(clip.autoplay)&&!reduced,startAt:0,elapsed:0,reverse:false};',
    '  });',
    '  function trackHasSubpaths(tr){',
    '    for(var i=0;i<tr.segments.length;i++){if(tr.segments[i].subpaths&&tr.segments[i].subpaths.length)return true;}',
    '    return false;',
    '  }',
    '  function renderAt(st,timeMs){',
    '    var t=st.reverse?(st.clip.durationMs-timeMs):timeMs;',
    '    if(t<0)t=0;if(t>st.clip.durationMs)t=st.clip.durationMs;',
    '    for(var i=0;i<st.clip.tracks.length;i++){',
    '      var tr=st.clip.tracks[i];',
    '      var els=findPathEls(tr.nodeId);',
    '      if(!els.length)continue;',
    '      var d=evalTrack(tr,t);',
    '      var multi=trackHasSubpaths(tr);',
    '      if(d){for(var k=0;k<els.length;k++){els[k].setAttribute("d",d);if(multi&&!els[k].getAttribute("fill-rule"))els[k].setAttribute("fill-rule","evenodd");}}',
    '    }',
    '  }',
    '  function syncClassState(){',
    '    var root=document.documentElement;',
    '    if(!root)return;',
    '    for(var i=0;i<states.length;i++){',
    '      var st=states[i],cls=st.clip.className;',
    '      var hasPlay=root.classList.contains(cls);',
    '      var hasRev=root.classList.contains(cls+"--reverse");',
    '      var hasPause=root.classList.contains(cls+"--paused");',
    '      var hasStop=root.classList.contains(cls+"--stopped");',
    '      st.reverse=hasRev;',
    '      if(hasStop){st.playing=false;st.elapsed=0;renderAt(st,0);continue;}',
    '      if(hasPause){st.playing=false;continue;}',
    '      if((hasPlay||st.clip.autoplay)&&!reduced){',
    '        if(!st.playing){st.playing=true;st.startAt=performance.now()-st.elapsed;}',
    '      }',
    '    }',
    '  }',
    '  function tick(now){',
    '    var anyActive=false;',
    '    for(var i=0;i<states.length;i++){',
    '      var st=states[i];',
    '      if(!st.playing)continue;',
    '      var synced=readSyncedCssTime(st);',
    '      var elapsed;',
    '      if(synced){',
    '        var ct=synced.time;',
    '        if(st.clip.loop){elapsed=((ct%st.clip.durationMs)+st.clip.durationMs)%st.clip.durationMs;anyActive=true;}',
    '        else if(ct>=st.clip.durationMs||synced.state==="finished"){elapsed=st.clip.durationMs;st.playing=false;}',
    '        else{elapsed=Math.max(0,ct);anyActive=true;}',
    '      }else{',
    '        if(!st.startAt)st.startAt=now;',
    '        elapsed=now-st.startAt;',
    '        if(st.clip.loop){elapsed=elapsed%st.clip.durationMs;anyActive=true;}',
    '        else if(elapsed>=st.clip.durationMs){elapsed=st.clip.durationMs;st.playing=false;}',
    '        else{anyActive=true;}',
    '      }',
    '      st.elapsed=elapsed;',
    '      renderAt(st,elapsed);',
    '    }',
    '    if(anyActive)requestAnimationFrame(tick);',
    '  }',
    '  function start(){',
    '    for(var i=0;i<states.length;i++)renderAt(states[i],0);',
    '    syncClassState();',
    '    if(!reduced&&states.some(function(s){return s.playing;})){requestAnimationFrame(tick);}',
    '    if(typeof MutationObserver!=="undefined"&&document.documentElement){',
    '      new MutationObserver(function(){',
    '        var wasPlaying=states.some(function(s){return s.playing;});',
    '        syncClassState();',
    '        if(!wasPlaying&&!reduced&&states.some(function(s){return s.playing;})){requestAnimationFrame(tick);}',
    '      }).observe(document.documentElement,{attributes:true,attributeFilter:["class"]});',
    '    }',
    '  }',
    '  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start);}else{start();}',
    '})();',
  ].join('\n');
}

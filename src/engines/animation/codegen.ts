import type {
  AnimationClip,
  AnimationEasing,
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
export function compilePageAnimationsCss(project: FolioProject, page: FolioPage): string {
  const clips = (project.animations ?? []).filter((clip) => clip.pageId === page.id && clip.tracks.length > 0);
  if (clips.length === 0) return '';

  const nodesById = new Map<string, DesignNode>(page.document.nodes.map((node) => [node.id, node]));
  const lines: string[] = ['/* Folio Motion Engine — Compiled @keyframes */'];

  const getValidParent = (node: DesignNode): DesignNode | null => {
    if (!node.parentId || node.parentId === node.id) return null;
    const p = nodesById.get(node.parentId);
    return p && p.onCanvas !== false ? p : null;
  };

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

      // Union this node's stop timestamps with any animated ancestor's stop timestamps
      // so child compensation stays locked to parent motion at every intermediate keyframe.
      const stopSet = new Set<number>([0, clip.durationMs]);
      for (const track of nodeTracks) {
        for (const kf of track.keyframes) {
          stopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
        }
      }
      for (const anc of animatedAncestors) {
        for (const ancTrack of tracksByNode.get(anc.id) ?? []) {
          for (const kf of ancTrack.keyframes) {
            stopSet.add(Math.max(0, Math.min(clip.durationMs, Math.round(kf.timeMs))));
          }
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

      // Determine whether this node has static constraint centering that must be preserved in transform
      const parentIsAutoLayout = Boolean(directParent?.layout && directParent.layout.mode !== 'none');
      const isOutOfFlowInAutoLayout =
        parentIsAutoLayout
        && (node.layoutChild?.position === 'absolute' || node.layoutChild?.position === 'fixed');
      const hasExplicitInsets = Boolean(
        node.layoutChild?.inset
        && (node.layoutChild.inset.top || node.layoutChild.inset.right || node.layoutChild.inset.bottom || node.layoutChild.inset.left),
      );
      const constraints = isOutOfFlowInAutoLayout && !hasExplicitInsets ? node.layoutChild?.constraints : undefined;
      const parentStaticWorldRot = getEffectiveParentStaticWorldRotation(node);
      const staticLocalRot = roundCssNum(getEffectiveStaticWorldRotation(node) - parentStaticWorldRot);

      // Check whether static CSS emitted a border on this node
      const hasStaticBorder =
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse')
          ? Boolean(
              node.style.borderSides
              || (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none'),
            )
          : node.type === 'image'
            ? Boolean(
                node.style.borderSides
                || ((node.style.strokeWidth ?? 0) > 0 && node.style.stroke && node.style.stroke !== 'none'),
              )
            : false;

      const hasStaticMultiFill =
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse')
        && Array.isArray(node.style.fills)
        && node.style.fills.some((f) => f.visible !== false && f.type !== 'solid');

      const heightTrack = nodeTracks.find((t) => t.property === 'height');
      const textHeightActuallyChanges =
        node.type === 'text'
          ? Boolean(
              (heightTrack && trackValuesVary(heightTrack))
              || node.style.verticalAlign === 'middle'
              || node.style.verticalAlign === 'bottom',
            )
          : true;

      // Check if segments use mixed easings so we only emit per-stop animation-timing-function when needed
      const segmentEasings: Array<string | null> = stops.map((stopMs, idx) => {
        if (idx >= stops.length - 1) return null;
        const seg = resolveSegmentEasing(nodeTracks, stopMs, stops[idx + 1]);
        return seg ? toCssTimingFunction(seg) : null;
      });
      const hasMixedEasings = segmentEasings.some((e) => e !== null && e !== dominantEasing);

      const svgPathKeyframeLines: string[] = [];
      const svgPolygonKeyframeLines: string[] = [];
      const isPathNode = node.type === 'path';
      const pathHasArrows = isPathNode && !node.closed && node.points.length >= 2 && Boolean(node.style.arrowStart || node.style.arrowEnd);

      lines.push(`@keyframes ${kfName} {`);
      for (let stopIdx = 0; stopIdx < stops.length; stopIdx += 1) {
        const stopMs = stops[stopIdx];
        const declarations: string[] = [];
        const svgPathDecls: string[] = [];
        const svgPolyDecls: string[] = [];
        let rawWorldDx = 0;
        let rawWorldDy = 0;
        let hasXTrack = false;
        let hasYTrack = false;
        let rotationVal: number | undefined;
        let scale: number | undefined;
        let hasTransform = false;

        for (const track of nodeTracks) {
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
            declarations.push(`width: ${Math.max(1, roundCssNum(Number(val)))}px;`);
          } else if (track.property === 'height') {
            if (textHeightActuallyChanges) {
              declarations.push(`height: ${Math.max(1, roundCssNum(Number(val)))}px;`);
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
            if (isPathNode) {
              svgPathDecls.push(`fill: ${String(val)};`);
            } else if (node.type === 'text') {
              declarations.push(`color: ${String(val)};`);
            } else {
              if (hasStaticMultiFill && trackValuesVary(track)) {
                declarations.push('background-image: none;');
              }
              declarations.push(`background-color: ${String(val)};`);
            }
          } else if (track.property === 'stroke') {
            if (isPathNode) {
              svgPathDecls.push(`stroke: ${String(val)};`);
              if (pathHasArrows) {
                svgPolyDecls.push(`fill: ${String(val)};`);
              }
            } else {
              declarations.push(`border-color: ${String(val)};`);
            }
          } else if (track.property === 'strokeWidth') {
            const sw = Math.max(0, roundCssNum(Number(val)));
            if (isPathNode) {
              svgPathDecls.push(`stroke-width: ${sw}px;`);
            } else {
              if (!hasStaticBorder && sw > 0) {
                declarations.push('border-style: solid;');
              }
              declarations.push(`border-width: ${sw}px;`);
            }
          }
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

        const netWorldDx = hasXTrack ? rawWorldDx - ancWorldDx : 0;
        const netWorldDy = hasYTrack ? rawWorldDy - ancWorldDy : 0;

        // Project world delta into parent's rotated local coordinate space if parent is rotated
        let localDx = netWorldDx;
        let localDy = netWorldDy;
        if ((Math.abs(netWorldDx) > 0.001 || Math.abs(netWorldDy) > 0.001) && Math.abs(parentStaticWorldRot) > 0.01) {
          const rad = (parentStaticWorldRot * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          localDx = netWorldDx * cos + netWorldDy * sin;
          localDy = -netWorldDx * sin + netWorldDy * cos;
        }
        const dx = roundCssNum(localDx);
        const dy = roundCssNum(localDy);

        // Compute effective local rotation (preserving static rotation when rotation isn't keyed,
        // and subtracting animated parent rotation to prevent double-rotation)
        let effectiveLocalRot: number | undefined;
        const parentAnimWorldRot = directParent
          ? getEffectiveAnimWorldRotation(directParent, stopMs)
          : 0;
        if (rotationVal !== undefined) {
          effectiveLocalRot = roundCssNum(rotationVal - parentAnimWorldRot);
        } else if (hasTransform) {
          const preservedRot = roundCssNum(getEffectiveStaticWorldRotation(node) - parentAnimWorldRot);
          if (Math.abs(preservedRot) > 0.01) {
            effectiveLocalRot = preservedRot;
          } else if (Math.abs(staticLocalRot) > 0.01) {
            effectiveLocalRot = staticLocalRot;
          }
        }

        if (hasTransform) {
          const parts: string[] = [];
          if (constraints?.horizontal === 'center') parts.push('translateX(-50%)');
          if (constraints?.vertical === 'center') parts.push('translateY(-50%)');
          if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
          if (effectiveLocalRot !== undefined) parts.push(`rotate(${effectiveLocalRot}deg)`);
          if (scale !== undefined) parts.push(`scale(${scale})`);
          declarations.push(`transform: ${parts.length > 0 ? parts.join(' ') : 'none'};`);
        }

        if (hasMixedEasings && stopIdx < stops.length - 1 && segmentEasings[stopIdx]) {
          declarations.push(`animation-timing-function: ${segmentEasings[stopIdx]};`);
        }

        if (declarations.length > 0) {
          lines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${declarations.join(' ')} }`);
        }
        if (svgPathDecls.length > 0) {
          if (hasMixedEasings && stopIdx < stops.length - 1 && segmentEasings[stopIdx]) {
            svgPathDecls.push(`animation-timing-function: ${segmentEasings[stopIdx]};`);
          }
          svgPathKeyframeLines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${svgPathDecls.join(' ')} }`);
        }
        if (svgPolyDecls.length > 0) {
          if (hasMixedEasings && stopIdx < stops.length - 1 && segmentEasings[stopIdx]) {
            svgPolyDecls.push(`animation-timing-function: ${segmentEasings[stopIdx]};`);
          }
          svgPolygonKeyframeLines.push(`  ${formatPct(stopMs, clip.durationMs)} { ${svgPolyDecls.join(' ')} }`);
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
      lines.push(
        `.${playClass}--reverse ${attrSelector}, ${attrSelector}.${playClass}--reverse { animation-direction: reverse; }`,
      );
      lines.push(
        `.${playClass}--paused ${attrSelector}, ${attrSelector}.${playClass}--paused { animation-play-state: paused; }`,
      );
      lines.push(
        `.${playClass}--stopped ${attrSelector}, ${attrSelector}.${playClass}--stopped { animation: none; }`,
      );

      if (svgPathKeyframeLines.length > 0) {
        const svgKfName = `${kfName}--svg`;
        const pathSel = `${attrSelector} > svg path`;
        const svgSelectors = clip.autoplay
          ? [pathSel, `.${playClass} ${pathSel}`, `${attrSelector}.${playClass} > svg path`]
          : [`.${playClass} ${pathSel}`, `${attrSelector}.${playClass} > svg path`];
        lines.push(`@keyframes ${svgKfName} {`);
        lines.push(...svgPathKeyframeLines);
        lines.push('}');
        lines.push(
          `${svgSelectors.join(', ')} { animation: ${svgKfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}; }`,
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
        const polySelectors = clip.autoplay
          ? [polySel, `.${playClass} ${polySel}`, `${attrSelector}.${playClass} > svg polygon`]
          : [`.${playClass} ${polySel}`, `${attrSelector}.${playClass} > svg polygon`];
        lines.push(`@keyframes ${polyKfName} {`);
        lines.push(...svgPolygonKeyframeLines);
        lines.push('}');
        lines.push(
          `${polySelectors.join(', ')} { animation: ${polyKfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}; }`,
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
  }

  lines.push('@media (prefers-reduced-motion: reduce) {');
  lines.push('  [data-folio-id], [data-folio-id] > svg path, [data-folio-id] > svg polygon { animation: none !important; transition: none !important; }');
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

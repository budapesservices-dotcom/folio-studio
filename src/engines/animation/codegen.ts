import type {
  AnimationClip,
  AnimationEasing,
  AnimationTrack,
  DesignNode,
  FolioPage,
  FolioProject,
  VisualEffect,
} from '../../core/document/types';
import {
  formatColorWithAlpha,
  getVisibleEffects,
  parseColorWithAlpha,
} from '../../core/document/styling';
import { evaluateTrackAtTime, sortKeyframes } from './evaluator';
import { easingToCubicBezier, toCssTimingFunction } from './easing';
import { sanitizeCssValue } from '../codegen/sanitize';
import {
  parsePathMorphSnapshot,
  prepareMorphPair,
} from '../../core/document/pathMorph';

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
/**
 * Returns the set of `nodeId`s on `page` that have an active `pathMorph` track.
 */
export function collectPageMorphNodeIds(
  project: FolioProject,
  page: FolioPage,
): Set<string> {
  const result = new Set<string>();
  const clips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
  for (const clip of clips) {
    for (const track of clip.tracks) {
      if (track.property === 'pathMorph' && track.keyframes.length > 0) {
        result.add(track.targetNodeId);
      }
    }
  }
  return result;
}

export function compilePageAnimationsCss(project: FolioProject, page: FolioPage): string {
  const clips = (project.animations ?? []).filter((clip) => clip.pageId === page.id && clip.tracks.length > 0);
  if (clips.length === 0) return '';

  const nodesById = new Map<string, DesignNode>(page.document.nodes.map((node) => [node.id, node]));
  const morphNodeIds = collectPageMorphNodeIds(project, page);
  const lines: string[] = ['/* Folio Motion Engine — Compiled @keyframes */'];
  if (morphNodeIds.size > 0) {
    lines.push(
      '/* Note: Shape Morph (`pathMorph`) tracks require geometry interpolation and are rendered via the Folio Motion Runtime (Live Preview, HTML5 export, Video MP4/MOV/WebM, GIF, PNG Sequence). Pure CSS @keyframes preserves transform/style tracks only. */',
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

      const trackedProps = new Set(nodeTracks.map((t) => t.property));
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
        const svgPathDecls: string[] = [];
        const svgPolyDecls: string[] = [];
        let rawWorldDx = 0;
        let rawWorldDy = 0;
        let hasXTrack = false;
        let hasYTrack = false;
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
            const safeColor = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
            if (isPathNode) {
              svgPathDecls.push(`fill: ${safeColor};`);
            } else if (node.type === 'text') {
              declarations.push(`color: ${safeColor};`);
            } else {
              if (hasStaticMultiFill && trackValuesVary(track)) {
                declarations.push('background-image: none;');
              }
              declarations.push(`background-color: ${safeColor};`);
            }
          } else if (track.property === 'stroke') {
            const safeStroke = sanitizeCssValue(String(val), 'rgba(0, 0, 0, 0)');
            if (isPathNode) {
              svgPathDecls.push(`stroke: ${safeStroke};`);
              if (pathHasArrows) {
                svgPolyDecls.push(`fill: ${safeStroke};`);
              }
            } else {
              declarations.push(`border-color: ${safeStroke};`);
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

      if (svgPathKeyframeLines.length > 0) {
        const svgKfName = `${kfName}--svg`;
        const pathSel = `${attrSelector} > svg path`;
        const svgAnimSpec = `${svgKfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}`;
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
        const polyAnimSpec = `${polyKfName} ${clip.durationMs}ms ${dominantEasing} ${iteration} ${fillMode}`;
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

interface CompiledMorphSegment {
  t0: number;
  t1: number;
  bezier: readonly [number, number, number, number];
  n: number;
  closed: boolean;
  /** Interleaved [x, y, hiX, hiY, hoX, hoY] * n (6 numbers per anchor) */
  from: number[];
  to: number[];
}

interface CompiledMorphTrack {
  nodeId: string;
  segments: CompiledMorphSegment[];
}

interface CompiledMorphClip {
  id: string;
  className: string;
  durationMs: number;
  loop: boolean;
  autoplay: boolean;
  tracks: CompiledMorphTrack[];
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
 * Generates a compact, zero-`eval`, CSP-safe inline `<script>` that drives real
 * cubic Bezier Native Shape Morph animations inside Live Preview and HTML5 exports.
 * Returns `''` when the page has no `pathMorph` tracks.
 */
export function buildLivePreviewMorphScript(
  project: FolioProject,
  page: FolioPage,
): string {
  const clips = (project.animations ?? []).filter((clip) => clip.pageId === page.id);
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
        if (pair && pair.compatible && pair.pointCount >= 3) {
          const packed = packBuffer6(pair.fromBuf, pair.flags, pair.pointCount);
          segments.push({
            t0: 0,
            t1: Math.max(1, clip.durationMs),
            bezier: [0, 0, 1, 1],
            n: pair.pointCount,
            closed: pair.closed,
            from: packed,
            to: packed,
          });
        }
      } else {
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const a = sorted[i];
          const b = sorted[i + 1];
          const fromStr = String(a.value);
          const toStr = String(b.value);
          const pair = prepareMorphPair(fromStr, toStr);
          if (!pair || !pair.compatible || pair.pointCount < 3) {
            const parsedA = parsePathMorphSnapshot(fromStr);
            if (!parsedA) continue;
            continue;
          }
          segments.push({
            t0: Math.round(a.timeMs),
            t1: Math.round(b.timeMs),
            bezier: easingToCubicBezier(b.easing),
            n: pair.pointCount,
            closed: pair.closed,
            from: packBuffer6(pair.fromBuf, pair.flags, pair.pointCount),
            to: packBuffer6(pair.toBuf, pair.flags, pair.pointCount),
          });
        }
      }

      if (segments.length > 0) {
        morphTracks.push({
          nodeId: track.targetNodeId,
          segments,
        });
      }
    }

    if (morphTracks.length > 0) {
      compiledClips.push({
        id: clip.id,
        className: getClipCssClassName(clip),
        durationMs: Math.max(1, clip.durationMs),
        loop: clip.loop,
        autoplay: clip.autoplay,
        tracks: morphTracks,
      });
    }
  }

  if (compiledClips.length === 0) return '';

  const serialized = JSON.stringify(compiledClips).replace(/</g, '\\u003c');
  return [
    '(function(){',
    `  var CLIPS=${serialized};`,
    '  var reduced=typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
    '  function solveBezier(b,x){',
    '    if(x<=0)return 0;if(x>=1)return 1;',
    '    var x1=b[0],y1=b[1],x2=b[2],y2=b[3];',
    '    if(x1===y1&&x2===y2)return x;',
    '    var t=x;',
    '    for(var i=0;i<6;i++){',
    '      var mt=1-t;',
    '      var cx=3*mt*mt*t*x1+3*mt*t*t*x2+t*t*t-x;',
    '      var dx=3*mt*mt*x1+6*mt*t*(x2-x1)+3*t*t*(1-x2);',
    '      if(Math.abs(dx)<1e-5)break;',
    '      t-=cx/dx;if(t<0)t=0;if(t>1)t=1;',
    '    }',
    '    var m=1-t;return 3*m*m*t*y1+3*m*t*t*y2+t*t*t;',
    '  }',
    '  function buildPathD(seg,t){',
    '    var n=seg.n,a=seg.from,b=seg.to,parts=[];',
    '    var x0=a[0]+(b[0]-a[0])*t,y0=a[1]+(b[1]-a[1])*t;',
    '    parts.push("M "+x0.toFixed(2)+" "+y0.toFixed(2));',
    '    for(var i=0;i<n;i++){',
    '      var j=(i+1)%n;if(!seg.closed&&j===0)break;',
    '      var bi=i*6,bj=j*6;',
    '      var c1x=a[bi+4]+(b[bi+4]-a[bi+4])*t,c1y=a[bi+5]+(b[bi+5]-a[bi+5])*t;',
    '      var c2x=a[bj+2]+(b[bj+2]-a[bj+2])*t,c2y=a[bj+3]+(b[bj+3]-a[bj+3])*t;',
    '      var ex=a[bj]+(b[bj]-a[bj])*t,ey=a[bj+1]+(b[bj+1]-a[bj+1])*t;',
    '      parts.push("C "+c1x.toFixed(2)+" "+c1y.toFixed(2)+" "+c2x.toFixed(2)+" "+c2y.toFixed(2)+" "+ex.toFixed(2)+" "+ey.toFixed(2));',
    '    }',
    '    if(seg.closed)parts.push("Z");',
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
    '        return buildPathD(s,solveBezier(s.bezier,raw));',
    '      }',
    '    }',
    '    return buildPathD(last,1);',
    '  }',
    '  function findPathEl(nodeId){',
    '    var esc=nodeId.replace(/"/g,"\\\\\\"");',
    '    var wrap=document.querySelector("[data-folio-id=\\""+esc+"\\"]");',
    '    if(!wrap)return null;',
    '    return wrap.querySelector("svg path[data-folio-morph-path]")||wrap.querySelector("svg path");',
    '  }',
    '  var states=CLIPS.map(function(clip){',
    '    return{clip:clip,playing:Boolean(clip.autoplay)&&!reduced,startAt:0,elapsed:0,reverse:false};',
    '  });',
    '  function renderAt(st,timeMs){',
    '    var t=st.reverse?(st.clip.durationMs-timeMs):timeMs;',
    '    if(t<0)t=0;if(t>st.clip.durationMs)t=st.clip.durationMs;',
    '    for(var i=0;i<st.clip.tracks.length;i++){',
    '      var tr=st.clip.tracks[i];',
    '      var el=findPathEl(tr.nodeId);',
    '      if(!el)continue;',
    '      var d=evalTrack(tr,t);',
    '      if(d)el.setAttribute("d",d);',
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
    '      if(!st.startAt)st.startAt=now;',
    '      var elapsed=now-st.startAt;',
    '      if(st.clip.loop){elapsed=elapsed%st.clip.durationMs;anyActive=true;}',
    '      else if(elapsed>=st.clip.durationMs){elapsed=st.clip.durationMs;st.playing=false;}',
    '      else{anyActive=true;}',
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

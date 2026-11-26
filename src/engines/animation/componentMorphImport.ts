/**
 * FOLIO Native Shape Morph — Component & Animated SVG Importer.
 *
 * Allows any closed vector object in FOLIO Studio to import morph geometry
 * directly from a saved `ComponentDefinition`:
 *
 *   1. Static Component:
 *      Extracts the component's primary closed vector shape (`ellipse`, `rect`,
 *      `frame`, or single-contour closed `path`), normalizes its cubic Bezier
 *      contour into the target object's `(targetWidth, targetHeight)` local box,
 *      and emits 1 `PathMorphSnapshot` keyframe at `offsetMs: 0`.
 *
 *   2. Animated Component with `pathMorph` track:
 *      Imports all serialized `pathMorph` keyframes from the component's primary
 *      morphed shape, scaling each snapshot cleanly into `(targetWidth, targetHeight)`
 *      while preserving relative timestamps (`offsetMs`), easing, and correspondence
 *      options.
 *
 *   3. Animated Component with SVG/transform/geometry tracks (`radius`, `width`,
 *      `height`, `scale`, `rotation`, etc.):
 *      Evaluates the component document at every unique keyframe timestamp
 *      (without modulo wrapping so the end pose is exact), bakes relative scale
 *      and rotation into the closed cubic Bezier contour, and emits an animated
 *      SVG morph keyframe sequence.
 *
 * Preserves FOLIO's core invariant: the destination object keeps ONE stable
 * `nodeId` and receives native `pathMorph` keyframes — never duplicating nodes
 * or switching visibility.
 */

import type {
  AnimationClip,
  AnimationEasing,
  AnimationTrack,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
} from '../../core/document/types';
import { resolveComponentDefaultNodes } from '../../core/document/components';
import {
  checkNodeMorphSupport,
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
  type PathMorphPoint,
  type PathMorphSnapshot,
} from '../../core/document/pathMorph';
import {
  applyAnimatedPosesToDocument,
  evaluateClipAtTime,
  sortKeyframes,
} from './evaluator';

export type ComponentMorphSourceKind = 'static' | 'animated-morph' | 'animated-svg';

export interface ComponentMorphInspection {
  readonly supported: boolean;
  readonly isAnimated: boolean;
  readonly sourceKind: ComponentMorphSourceKind;
  readonly keyframeCount: number;
  readonly durationMs: number;
  readonly sourceNodeId: string | null;
  readonly sourceNodeName: string | null;
  readonly reason: string;
}

export interface ImportedMorphKeyframe {
  readonly offsetMs: number;
  readonly value: string;
  readonly easing: AnimationEasing;
  readonly label: string;
}

export type ComponentMorphImportResult =
  | {
      readonly ok: true;
      readonly componentId: string;
      readonly componentName: string;
      readonly sourceNodeId: string;
      readonly sourceNodeName: string;
      readonly sourceKind: ComponentMorphSourceKind;
      readonly durationMs: number;
      readonly keyframes: readonly ImportedMorphKeyframe[];
    }
  | {
      readonly ok: false;
      readonly componentId: string;
      readonly componentName: string;
      readonly reason: string;
      readonly message: string;
    };

const GEOMETRY_AFFECTING_PROPERTIES = new Set<AnimationTrack['property']>([
  'pathMorph',
  'width',
  'height',
  'radius',
  'scale',
  'rotation',
]);

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function getActiveComponentClip(component: ComponentDefinition): AnimationClip | null {
  const clips = component.animations;
  if (!clips || clips.length === 0) return null;
  return clips.find((clip) => clip.tracks.length > 0) ?? null;
}

function getResolvedNodes(
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): DesignNode[] {
  try {
    const resolved = resolveComponentDefaultNodes(component, tokens);
    if (resolved.length > 0) return resolved;
  } catch {
    // Fallback to raw document nodes below.
  }
  return component.document.nodes;
}

function getSnapshotBounds(snapshot: PathMorphSnapshot): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pt of snapshot.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, width: 100, height: 100 };
  }
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function transformMorphPoint(
  pt: PathMorphPoint,
  scaleX: number,
  scaleY: number,
  offsetX = 0,
  offsetY = 0,
  rotateDeg = 0,
  pivotX = 0,
  pivotY = 0,
): PathMorphPoint {
  const uniformScale = Math.sqrt(Math.max(1e-4, Math.abs(scaleX * scaleY)));
  const rad = (rotateDeg * Math.PI) / 180;
  const hasRotation = Math.abs(rad) > 1e-5;
  const cos = hasRotation ? Math.cos(rad) : 1;
  const sin = hasRotation ? Math.sin(rad) : 0;

  const mapCoord = (x: number, y: number): [number, number] => {
    const sx = (x - offsetX) * scaleX;
    const sy = (y - offsetY) * scaleY;
    if (!hasRotation) {
      return [round2(sx), round2(sy)];
    }
    const dx = sx - pivotX;
    const dy = sy - pivotY;
    return [
      round2(pivotX + dx * cos - dy * sin),
      round2(pivotY + dx * sin + dy * cos),
    ];
  };

  const [nx, ny] = mapCoord(pt.x, pt.y);
  const next: PathMorphPoint = {
    x: nx,
    y: ny,
    pt: pt.pt,
  };
  if (pt.hi) {
    next.hi = mapCoord(pt.hi[0], pt.hi[1]);
  }
  if (pt.ho) {
    next.ho = mapCoord(pt.ho[0], pt.ho[1]);
  }
  if (pt.cr !== undefined && Number.isFinite(pt.cr)) {
    next.cr = round2(pt.cr * uniformScale);
  }
  return next;
}

function normalizeSnapshotToTargetBox(
  snapshot: PathMorphSnapshot,
  fallbackW: number,
  fallbackH: number,
  targetWidth: number,
  targetHeight: number,
  label: string,
  extraTransform?: {
    relScaleX?: number;
    relScaleY?: number;
    relRotateDeg?: number;
  },
): string {
  const safeTargetW = Math.max(1, targetWidth);
  const safeTargetH = Math.max(1, targetHeight);
  const bounds = getSnapshotBounds(snapshot);
  const srcW = snapshot.w && snapshot.w > 0 ? snapshot.w : Math.max(1, fallbackW || bounds.width);
  const srcH = snapshot.h && snapshot.h > 0 ? snapshot.h : Math.max(1, fallbackH || bounds.height);

  const baseScaleX = safeTargetW / Math.max(1, srcW);
  const baseScaleY = safeTargetH / Math.max(1, srcH);

  const relScaleX = extraTransform?.relScaleX ?? 1;
  const relScaleY = extraTransform?.relScaleY ?? 1;
  const relRotateDeg = extraTransform?.relRotateDeg ?? 0;
  const pivotX = safeTargetW / 2;
  const pivotY = safeTargetH / 2;

  const hasExtraScale = Math.abs(relScaleX - 1) > 1e-4 || Math.abs(relScaleY - 1) > 1e-4;
  const hasExtraRot = Math.abs(relRotateDeg) > 1e-4;

  const points = snapshot.points.map((pt) => {
    const fitted = transformMorphPoint(pt, baseScaleX, baseScaleY);
    if (!hasExtraScale && !hasExtraRot) return fitted;
    // Scale around target center, then rotate around target center so animated
    // component silhouettes preserve visual scale/spin cleanly inside the morph box.
    const rad = (relRotateDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const applyCenterTransform = (x: number, y: number): [number, number] => {
      const dx = (x - pivotX) * relScaleX;
      const dy = (y - pivotY) * relScaleY;
      return [
        round2(pivotX + dx * cos - dy * sin),
        round2(pivotY + dx * sin + dy * cos),
      ];
    };
    const [tx, ty] = applyCenterTransform(fitted.x, fitted.y);
    const out: PathMorphPoint = {
      x: tx,
      y: ty,
      pt: fitted.pt,
    };
    if (fitted.hi) out.hi = applyCenterTransform(fitted.hi[0], fitted.hi[1]);
    if (fitted.ho) out.ho = applyCenterTransform(fitted.ho[0], fitted.ho[1]);
    if (fitted.cr !== undefined) {
      out.cr = round2(fitted.cr * Math.sqrt(Math.max(1e-4, Math.abs(relScaleX * relScaleY))));
    }
    return out;
  });

  const normalized: PathMorphSnapshot = {
    v: 1,
    closed: snapshot.closed,
    points,
    label,
    w: round2(safeTargetW),
    h: round2(safeTargetH),
    ...(snapshot.morph ? { morph: { ...snapshot.morph } } : {}),
  };
  return JSON.stringify(normalized);
}

interface SelectedComponentSource {
  node: DesignNode;
  clip: AnimationClip | null;
  morphTrack: AnimationTrack | null;
  nodeTracks: AnimationTrack[];
  sourceKind: ComponentMorphSourceKind;
  sampleTimes: number[];
}

function selectComponentMorphSource(
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): { source: SelectedComponentSource | null; reason: string } {
  const nodes = getResolvedNodes(component, tokens);
  if (nodes.length === 0) {
    return {
      source: null,
      reason: `Component “${component.name}” has no vector shapes.`,
    };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const clip = getActiveComponentClip(component);

  // Priority 1: A node in the active clip that already has a valid closed pathMorph track.
  if (clip) {
    const morphTrack = clip.tracks.find((track) => {
      if (track.property !== 'pathMorph' || track.keyframes.length === 0) return false;
      const candidate = nodeById.get(track.targetNodeId);
      if (!candidate) return false;
      const validSnap = track.keyframes.some((kf) => {
        if (typeof kf.value !== 'string') return false;
        const parsed = parsePathMorphSnapshot(kf.value);
        return Boolean(parsed && parsed.closed && parsed.points.length >= 3 && (!parsed.subpaths || parsed.subpaths.length === 0));
      });
      return validSnap;
    });

    if (morphTrack) {
      const node = nodeById.get(morphTrack.targetNodeId)!;
      const sorted = sortKeyframes(morphTrack.keyframes);
      return {
        source: {
          node,
          clip,
          morphTrack,
          nodeTracks: clip.tracks.filter((t) => t.targetNodeId === node.id),
          sourceKind: sorted.length > 1 ? 'animated-morph' : 'static',
          sampleTimes: sorted.map((kf) => Math.max(0, Math.round(kf.timeMs))),
        },
        reason: 'ok',
      };
    }

    // Priority 2: A morph-supported closed vector node targeted by non-morph animation tracks
    // (preferring geometry/transform tracks like radius, width, height, scale, rotation).
    const animatedNodeIds = new Set(clip.tracks.filter((t) => t.keyframes.length > 0).map((t) => t.targetNodeId));
    const animatedSupportedNodes = nodes.filter(
      (n) => animatedNodeIds.has(n.id) && checkNodeMorphSupport(n).supported,
    );
    if (animatedSupportedNodes.length > 0) {
      animatedSupportedNodes.sort((a, b) => {
        const aHasGeom = clip.tracks.some(
          (t) => t.targetNodeId === a.id && GEOMETRY_AFFECTING_PROPERTIES.has(t.property) && t.keyframes.length > 0,
        );
        const bHasGeom = clip.tracks.some(
          (t) => t.targetNodeId === b.id && GEOMETRY_AFFECTING_PROPERTIES.has(t.property) && t.keyframes.length > 0,
        );
        if (aHasGeom !== bHasGeom) return aHasGeom ? -1 : 1;
        return b.width * b.height - a.width * a.height;
      });

      const primary = animatedSupportedNodes[0];
      const nodeTracks = clip.tracks.filter((t) => t.targetNodeId === primary.id && t.keyframes.length > 0);
      const geomTracks = nodeTracks.filter((t) => GEOMETRY_AFFECTING_PROPERTIES.has(t.property));
      const tracksForSampling = geomTracks.length > 0 ? geomTracks : nodeTracks;

      const timeSet = new Set<number>();
      for (const track of tracksForSampling) {
        for (const kf of track.keyframes) {
          timeSet.add(Math.max(0, Math.round(kf.timeMs)));
        }
      }
      const sampleTimes = [...timeSet].sort((a, b) => a - b);
      if (sampleTimes.length > 0 && sampleTimes[0] > 0) {
        sampleTimes.unshift(0);
      }

      return {
        source: {
          node: primary,
          clip,
          morphTrack: null,
          nodeTracks,
          sourceKind: sampleTimes.length > 1 ? 'animated-svg' : 'static',
          sampleTimes: sampleTimes.length > 0 ? sampleTimes : [0],
        },
        reason: 'ok',
      };
    }
  }

  // Priority 3: Largest supported closed vector shape in the component (preferring visible nodes).
  const supportedNodes = nodes.filter((node) => checkNodeMorphSupport(node).supported);
  if (supportedNodes.length === 0) {
    const firstIssue = nodes
      .map((n) => checkNodeMorphSupport(n))
      .find((check) => !check.supported);
    return {
      source: null,
      reason:
        firstIssue?.reason === 'multi-contour'
          ? `Component “${component.name}” only contains compound multi-contour paths, which are not yet supported for Shape Morph.`
          : firstIssue?.reason === 'open-path'
            ? `Component “${component.name}” only contains open paths. Close the vector contour to morph from it.`
            : `Component “${component.name}” has no closed vector shape (Circle, Rectangle, Frame, or closed Path) to morph into.`,
    };
  }

  supportedNodes.sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return b.width * b.height - a.width * a.height;
  });

  const primary = supportedNodes[0];
  return {
    source: {
      node: primary,
      clip: null,
      morphTrack: null,
      nodeTracks: [],
      sourceKind: 'static',
      sampleTimes: [0],
    },
    reason: 'ok',
  };
}

/**
 * Inspects a saved component to determine whether it can be used as a Shape Morph
 * source and whether importing it will bring in a single shape or an animated SVG
 * morph sequence.
 */
export function inspectComponentMorphSource(
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): ComponentMorphInspection {
  const { source, reason } = selectComponentMorphSource(component, tokens);
  if (!source) {
    return {
      supported: false,
      isAnimated: false,
      sourceKind: 'static',
      keyframeCount: 0,
      durationMs: 0,
      sourceNodeId: null,
      sourceNodeName: null,
      reason,
    };
  }

  const maxTime = source.sampleTimes.length > 0 ? source.sampleTimes[source.sampleTimes.length - 1] : 0;
  return {
    supported: true,
    isAnimated: source.sourceKind !== 'static',
    sourceKind: source.sourceKind,
    keyframeCount: source.sampleTimes.length,
    durationMs: maxTime,
    sourceNodeId: source.node.id,
    sourceNodeName: source.node.name,
    reason:
      source.sourceKind === 'animated-morph'
        ? `Imports ${source.sampleTimes.length} animated Shape Morph keyframes from “${component.name}”`
        : source.sourceKind === 'animated-svg'
          ? `Imports ${source.sampleTimes.length} animated SVG keyframes from “${component.name}”`
          : `Imports closed vector shape from “${component.name}”`,
  };
}

/**
 * Extracts a normalized Shape Morph keyframe sequence from a saved component,
 * fitted cleanly into `(targetWidth, targetHeight)` so the destination object
 * preserves its exact `nodeId` and bounding frame.
 */
export function extractMorphSequenceFromComponent(
  component: ComponentDefinition,
  targetWidth: number,
  targetHeight: number,
  tokens?: DesignTokenCollection,
): ComponentMorphImportResult {
  const { source, reason } = selectComponentMorphSource(component, tokens);
  if (!source) {
    return {
      ok: false,
      componentId: component.id,
      componentName: component.name,
      reason: 'unsupported-component',
      message: reason,
    };
  }

  const safeTargetW = Math.max(1, targetWidth);
  const safeTargetH = Math.max(1, targetHeight);

  // Case A: Component already has a native pathMorph track -> scale & import every keyframe!
  if (source.morphTrack) {
    const sorted = sortKeyframes(source.morphTrack.keyframes);
    const imported: ImportedMorphKeyframe[] = [];

    for (const kf of sorted) {
      if (typeof kf.value !== 'string') continue;
      const parsed = parsePathMorphSnapshot(kf.value);
      if (!parsed || !parsed.closed || parsed.points.length < 3 || (parsed.subpaths && parsed.subpaths.length > 0)) {
        continue;
      }
      const label = parsed.label
        ? `${component.name} · ${parsed.label}`
        : component.name;
      const value = normalizeSnapshotToTargetBox(
        parsed,
        source.node.width,
        source.node.height,
        safeTargetW,
        safeTargetH,
        label,
      );
      imported.push({
        offsetMs: Math.max(0, Math.round(kf.timeMs)),
        value,
        easing: kf.easing,
        label,
      });
    }

    if (imported.length === 0) {
      return {
        ok: false,
        componentId: component.id,
        componentName: component.name,
        reason: 'empty-morph-track',
        message: `Component “${component.name}” has no valid closed Shape Morph keyframes to import.`,
      };
    }

    const durationMs = imported[imported.length - 1].offsetMs;
    return {
      ok: true,
      componentId: component.id,
      componentName: component.name,
      sourceNodeId: source.node.id,
      sourceNodeName: source.node.name,
      sourceKind: imported.length > 1 ? 'animated-morph' : 'static',
      durationMs,
      keyframes: imported,
    };
  }

  // Case B: Animated component with non-morph tracks -> sample evaluated SVG poses at each keyframe time!
  if (source.clip && source.sourceKind === 'animated-svg' && source.sampleTimes.length > 1) {
    const resolvedNodes = getResolvedNodes(component, tokens);
    const evalDoc: FolioDocument = {
      ...component.document,
      nodes: resolvedNodes,
    };
    const baseNode = source.node;
    const baseW = Math.max(1, baseNode.width);
    const baseH = Math.max(1, baseNode.height);
    const baseRotation = baseNode.rotation ?? 0;

    const imported: ImportedMorphKeyframe[] = [];
    for (let idx = 0; idx < source.sampleTimes.length; idx += 1) {
      const timeMs = source.sampleTimes[idx];
      const poses = evaluateClipAtTime(source.clip, timeMs);
      const evaluatedDoc = applyAnimatedPosesToDocument(evalDoc, poses);
      const evalNode = evaluatedDoc.nodes.find((n) => n.id === baseNode.id) ?? baseNode;
      const rawSnap = extractMorphSnapshotFromNode(evalNode);
      if (!rawSnap) continue;
      const parsed = parsePathMorphSnapshot(rawSnap);
      if (!parsed || !parsed.closed || parsed.points.length < 3) continue;

      const relScaleX = Math.max(0.05, evalNode.width / baseW);
      const relScaleY = Math.max(0.05, evalNode.height / baseH);
      const relRotateDeg = (evalNode.rotation ?? 0) - baseRotation;

      // Pick easing from any geometry track that has a keyframe at this timestamp.
      let easing: AnimationEasing = timeMs === 0 ? 'linear' : 'ease-out';
      for (const track of source.nodeTracks) {
        const matched = track.keyframes.find((kf) => Math.abs(Math.round(kf.timeMs) - timeMs) <= 2);
        if (matched) {
          easing = matched.easing;
          if (GEOMETRY_AFFECTING_PROPERTIES.has(track.property)) break;
        }
      }

      const label = `${component.name} #${idx + 1}`;
      const value = normalizeSnapshotToTargetBox(
        parsed,
        evalNode.width,
        evalNode.height,
        safeTargetW,
        safeTargetH,
        label,
        {
          relScaleX,
          relScaleY,
          relRotateDeg,
        },
      );
      imported.push({
        offsetMs: timeMs,
        value,
        easing,
        label,
      });
    }

    if (imported.length > 0) {
      const durationMs = imported[imported.length - 1].offsetMs;
      return {
        ok: true,
        componentId: component.id,
        componentName: component.name,
        sourceNodeId: source.node.id,
        sourceNodeName: source.node.name,
        sourceKind: imported.length > 1 ? 'animated-svg' : 'static',
        durationMs,
        keyframes: imported,
      };
    }
  }

  // Case C: Static closed vector component -> single normalized Shape Morph keyframe.
  const rawStaticSnap = extractMorphSnapshotFromNode(source.node);
  const parsedStatic = rawStaticSnap ? parsePathMorphSnapshot(rawStaticSnap) : null;
  if (!parsedStatic || !parsedStatic.closed || parsedStatic.points.length < 3) {
    return {
      ok: false,
      componentId: component.id,
      componentName: component.name,
      reason: 'snapshot-extraction-failed',
      message: `Could not extract a closed vector contour from component “${component.name}”.`,
    };
  }

  const label = component.name;
  const value = normalizeSnapshotToTargetBox(
    parsedStatic,
    source.node.width,
    source.node.height,
    safeTargetW,
    safeTargetH,
    label,
  );

  return {
    ok: true,
    componentId: component.id,
    componentName: component.name,
    sourceNodeId: source.node.id,
    sourceNodeName: source.node.name,
    sourceKind: 'static',
    durationMs: 0,
    keyframes: [
      {
        offsetMs: 0,
        value,
        easing: 'ease-out',
        label,
      },
    ],
  };
}

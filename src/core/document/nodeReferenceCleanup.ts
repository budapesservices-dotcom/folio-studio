import type { AnimationClip, CodeModuleRecord, FolioProject, LogicGraph } from './types';

export interface CrossStudioLogicReference {
  readonly graphId: string;
  readonly graphName: string;
  readonly logicNodeId: string;
  readonly logicNodeType: string;
  readonly targetNodeId: string;
}

export interface CrossStudioMotionReference {
  readonly clipId: string;
  readonly clipName: string;
  readonly trackId: string;
  readonly property: string;
  readonly targetNodeId: string;
}

export interface CrossStudioCodeExtensionReference {
  readonly moduleId: string;
  readonly path: string;
  readonly targetNodeId: string;
}

export interface CrossStudioReferenceSummary {
  readonly removedNodeIds: ReadonlySet<string>;
  readonly logicBindings: readonly CrossStudioLogicReference[];
  readonly animationTracks: readonly CrossStudioMotionReference[];
  readonly codeExtensions: readonly CrossStudioCodeExtensionReference[];
  readonly totalCount: number;
}

export interface CrossStudioCleanupResult {
  readonly project: FolioProject;
  readonly unboundLogicCount: number;
  readonly removedTrackCount: number;
  readonly unboundCodeExtensionCount: number;
}

function isGraphTargetingPage(graph: LogicGraph, pageId: string): boolean {
  if (graph.scope === 'page') {
    return !graph.targetId || graph.targetId === pageId;
  }
  return graph.scope === 'project';
}

/**
 * Finds all Node Logic node bindings, Motion Timeline animation tracks, and
 * anchored Code Extension modules that reference any of `targetNodeIds`
 * present on the specified page.
 */
export function findCrossStudioNodeReferences(
  project: FolioProject,
  targetNodeIds: readonly string[],
  pageId: string = project.activePageId,
): CrossStudioReferenceSummary {
  const page = project.pages.find((item) => item.id === pageId) ?? project.pages[0];
  const pageNodeIds = new Set(page?.document.nodes.map((node) => node.id) ?? []);
  const expandedIds = new Set<string>(
    page ? targetNodeIds.filter((id) => pageNodeIds.has(id)) : targetNodeIds,
  );

  if (expandedIds.size === 0) {
    return {
      removedNodeIds: expandedIds,
      logicBindings: [],
      animationTracks: [],
      codeExtensions: [],
      totalCount: 0,
    };
  }

  const logicBindings: CrossStudioLogicReference[] = [];
  for (const graph of project.logicGraphs) {
    if (!isGraphTargetingPage(graph, pageId)) continue;
    for (const node of graph.nodes) {
      const targetRef = node.data?.targetNodeId;
      if (typeof targetRef === 'string' && targetRef.length > 0 && expandedIds.has(targetRef)) {
        logicBindings.push({
          graphId: graph.id,
          graphName: graph.name,
          logicNodeId: node.id,
          logicNodeType: node.type,
          targetNodeId: targetRef,
        });
      }
    }
  }

  const animationTracks: CrossStudioMotionReference[] = [];
  for (const clip of project.animations ?? []) {
    if (clip.pageId !== pageId) continue;
    for (const track of clip.tracks) {
      if (expandedIds.has(track.targetNodeId)) {
        animationTracks.push({
          clipId: clip.id,
          clipName: clip.name,
          trackId: track.id,
          property: track.property,
          targetNodeId: track.targetNodeId,
        });
      }
    }
  }

  const codeExtensions: CrossStudioCodeExtensionReference[] = [];
  for (const mod of project.codeModules ?? []) {
    if (mod.targetPageId && mod.targetPageId !== pageId) continue;
    if (mod.targetNodeId && expandedIds.has(mod.targetNodeId)) {
      codeExtensions.push({
        moduleId: mod.id,
        path: mod.path,
        targetNodeId: mod.targetNodeId,
      });
    }
  }

  return {
    removedNodeIds: expandedIds,
    logicBindings,
    animationTracks,
    codeExtensions,
    totalCount: logicBindings.length + animationTracks.length + codeExtensions.length,
  };
}

/**
 * Safely cleans up dangling cross-studio references after layers are deleted:
 * - Unbinds `data.targetNodeId` to `''` on affected Node Logic nodes while
 *   preserving the node and its wires so users can easily rebind or Undo.
 * - Removes affected tracks from Motion Timeline clips while preserving the
 *   clip and all remaining tracks.
 * - Detaches `targetNodeId` from anchored Code Extension modules while
 *   strictly preserving developer-authored CSS/JS code per Blueprint §7.
 * Returns the original `project` reference unchanged when no references exist.
 */
export function cleanupDeletedNodeReferences(
  project: FolioProject,
  removedNodeIds: ReadonlySet<string>,
  pageId: string = project.activePageId,
): CrossStudioCleanupResult {
  if (removedNodeIds.size === 0) {
    return { project, unboundLogicCount: 0, removedTrackCount: 0, unboundCodeExtensionCount: 0 };
  }

  const now = new Date().toISOString();
  let unboundLogicCount = 0;
  let logicChanged = false;

  const nextLogicGraphs: LogicGraph[] = project.logicGraphs.map((graph) => {
    if (!isGraphTargetingPage(graph, pageId)) return graph;
    let graphModified = false;
    const nextNodes = graph.nodes.map((node) => {
      const targetRef = node.data?.targetNodeId;
      if (typeof targetRef === 'string' && targetRef.length > 0 && removedNodeIds.has(targetRef)) {
        graphModified = true;
        unboundLogicCount += 1;
        return {
          ...node,
          data: {
            ...node.data,
            targetNodeId: '',
          },
        };
      }
      return node;
    });
    if (!graphModified) return graph;
    logicChanged = true;
    return {
      ...graph,
      nodes: nextNodes,
      updatedAt: now,
    };
  });

  let removedTrackCount = 0;
  let animationsChanged = false;
  const currentAnimations = project.animations;

  const nextAnimations: AnimationClip[] | undefined = currentAnimations
    ? currentAnimations.map((clip) => {
      if (clip.pageId !== pageId) return clip;
      const filteredTracks = clip.tracks.filter((track) => !removedNodeIds.has(track.targetNodeId));
      const delta = clip.tracks.length - filteredTracks.length;
      if (delta === 0) return clip;
      removedTrackCount += delta;
      animationsChanged = true;
      return {
        ...clip,
        tracks: filteredTracks,
        updatedAt: now,
      };
    })
    : undefined;

  let unboundCodeExtensionCount = 0;
  let codeModulesChanged = false;
  const currentCodeModules = project.codeModules;

  const nextCodeModules: CodeModuleRecord[] | undefined = currentCodeModules
    ? currentCodeModules.map((mod) => {
      if (mod.targetPageId && mod.targetPageId !== pageId) return mod;
      if (!mod.targetNodeId || !removedNodeIds.has(mod.targetNodeId)) return mod;
      unboundCodeExtensionCount += 1;
      codeModulesChanged = true;
      const detached: CodeModuleRecord = { ...mod, updatedAt: now };
      delete detached.targetNodeId;
      return detached;
    })
    : undefined;

  if (!logicChanged && !animationsChanged && !codeModulesChanged) {
    return { project, unboundLogicCount: 0, removedTrackCount: 0, unboundCodeExtensionCount: 0 };
  }

  return {
    project: {
      ...project,
      logicGraphs: logicChanged ? nextLogicGraphs : project.logicGraphs,
      ...(animationsChanged && nextAnimations ? { animations: nextAnimations } : {}),
      ...(codeModulesChanged && nextCodeModules ? { codeModules: nextCodeModules } : {}),
    },
    unboundLogicCount,
    removedTrackCount,
    unboundCodeExtensionCount,
  };
}

/**
 * Formats a concise English toast notice explaining cross-studio reference
 * cleanup performed alongside layer deletion.
 */
export function formatLayerDeletionCleanupNotice(
  deletedLayerNames: readonly string[],
  counts: { logicCount: number; motionCount: number; codeExtensionCount?: number },
): string | null {
  const codeCount = counts.codeExtensionCount ?? 0;
  if (counts.logicCount <= 0 && counts.motionCount <= 0 && codeCount <= 0) return null;

  const subject = deletedLayerNames.length === 1
    ? `“${deletedLayerNames[0]}”`
    : `${deletedLayerNames.length} layers`;

  const parts: string[] = [];
  if (counts.logicCount > 0) {
    parts.push(`${counts.logicCount} Node Logic ${counts.logicCount === 1 ? 'binding' : 'bindings'}`);
  }
  if (counts.motionCount > 0) {
    parts.push(`${counts.motionCount} Motion ${counts.motionCount === 1 ? 'track' : 'tracks'}`);
  }
  if (codeCount > 0) {
    parts.push(`${codeCount} Code ${codeCount === 1 ? 'extension anchor' : 'extension anchors'} (code preserved)`);
  }

  return `Deleted ${subject} and safely cleaned up ${parts.join(' & ')} (Undo to restore).`;
}

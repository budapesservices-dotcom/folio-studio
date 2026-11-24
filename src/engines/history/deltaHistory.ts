import type {
  AnimationClip,
  AssetReference,
  CodeModuleRecord,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  LogicGraph,
} from '../../core/document/types';

export const DEFAULT_DELTA_HISTORY_LIMIT = 200;

export interface DocumentNodesDelta {
  readonly documentId: string;
  readonly documentNameBefore: string;
  readonly documentNameAfter: string;
  readonly widthBefore: number;
  readonly widthAfter: number;
  readonly heightBefore: number;
  readonly heightAfter: number;
  readonly backgroundBefore: string;
  readonly backgroundAfter: string;
  /** Ordered IDs before/after enable O(changed nodes) reconstruction without cloning untouched nodes. */
  readonly beforeOrder: readonly string[];
  readonly afterOrder: readonly string[];
  /** Nodes removed or modified (pre-change reference). */
  readonly removedOrPreviousNodes: ReadonlyArray<readonly [string, DesignNode]>;
  /** Nodes added or modified (post-change reference). */
  readonly addedOrNextNodes: ReadonlyArray<readonly [string, DesignNode]>;
}

export interface PageDeltaEntry {
  readonly kind: 'added' | 'removed' | 'updated';
  readonly pageId: string;
  readonly beforePage?: FolioPage;
  readonly afterPage?: FolioPage;
  /** Present when only document/metadata fields changed on an existing page. */
  readonly documentDelta?: DocumentNodesDelta;
}

export interface ComponentDeltaEntry {
  readonly kind: 'added' | 'removed' | 'updated';
  readonly componentId: string;
  readonly beforeComponent?: ComponentDefinition;
  readonly afterComponent?: ComponentDefinition;
}

export interface ProjectDelta {
  readonly id: string;
  readonly label?: string;
  readonly coalesceKey?: string | null;
  readonly metadataBefore?: FolioProject['metadata'];
  readonly metadataAfter?: FolioProject['metadata'];
  readonly activePageIdBefore?: string;
  readonly activePageIdAfter?: string;
  readonly pageOrderBefore?: readonly string[];
  readonly pageOrderAfter?: readonly string[];
  readonly pages: readonly PageDeltaEntry[];
  readonly componentOrderBefore?: readonly string[];
  readonly componentOrderAfter?: readonly string[];
  readonly components: readonly ComponentDeltaEntry[];
  readonly designTokensChanged?: boolean;
  readonly designTokensBefore?: DesignTokenCollection;
  readonly designTokensAfter?: DesignTokenCollection;
  readonly codeModulesChanged?: boolean;
  readonly codeModulesBefore?: readonly CodeModuleRecord[];
  readonly codeModulesAfter?: readonly CodeModuleRecord[];
  readonly logicGraphsChanged?: boolean;
  readonly logicGraphsBefore?: readonly LogicGraph[];
  readonly logicGraphsAfter?: readonly LogicGraph[];
  readonly assetsChanged?: boolean;
  readonly assetsBefore?: readonly AssetReference[];
  readonly assetsAfter?: readonly AssetReference[];
  readonly animationsChanged?: boolean;
  readonly animationsBefore?: readonly AnimationClip[];
  readonly animationsAfter?: readonly AnimationClip[];
}

export interface DeltaHistoryTimeline {
  readonly current: FolioProject;
  readonly past: readonly ProjectDelta[];
  readonly future: readonly ProjectDelta[];
  readonly maxEntries: number;
  readonly activeCoalesceKey: string | null;
}

let deltaSequence = 0;

function nextDeltaId(): string {
  deltaSequence += 1;
  return `delta-${deltaSequence}`;
}

function computeDocumentNodesDelta(
  beforeDoc: FolioPage['document'],
  afterDoc: FolioPage['document'],
): DocumentNodesDelta {
  const beforeById = new Map<string, DesignNode>();
  const beforeOrder: string[] = new Array(beforeDoc.nodes.length);
  for (let i = 0; i < beforeDoc.nodes.length; i += 1) {
    const node = beforeDoc.nodes[i];
    beforeOrder[i] = node.id;
    beforeById.set(node.id, node);
  }

  const afterById = new Map<string, DesignNode>();
  const afterOrder: string[] = new Array(afterDoc.nodes.length);
  for (let i = 0; i < afterDoc.nodes.length; i += 1) {
    const node = afterDoc.nodes[i];
    afterOrder[i] = node.id;
    afterById.set(node.id, node);
  }

  const removedOrPreviousNodes: Array<readonly [string, DesignNode]> = [];
  const addedOrNextNodes: Array<readonly [string, DesignNode]> = [];

  for (const [id, beforeNode] of beforeById) {
    const afterNode = afterById.get(id);
    if (!afterNode || afterNode !== beforeNode) {
      removedOrPreviousNodes.push([id, beforeNode]);
    }
  }

  for (const [id, afterNode] of afterById) {
    const beforeNode = beforeById.get(id);
    if (!beforeNode || beforeNode !== afterNode) {
      addedOrNextNodes.push([id, afterNode]);
    }
  }

  return {
    documentId: afterDoc.id,
    documentNameBefore: beforeDoc.name,
    documentNameAfter: afterDoc.name,
    widthBefore: beforeDoc.width,
    widthAfter: afterDoc.width,
    heightBefore: beforeDoc.height,
    heightAfter: afterDoc.height,
    backgroundBefore: beforeDoc.background,
    backgroundAfter: afterDoc.background,
    beforeOrder,
    afterOrder,
    removedOrPreviousNodes,
    addedOrNextNodes,
  };
}

function applyDocumentNodesDelta(
  baseDoc: FolioPage['document'],
  delta: DocumentNodesDelta,
  direction: 'forward' | 'backward',
): FolioPage['document'] {
  const nodeMap = new Map<string, DesignNode>();
  for (let i = 0; i < baseDoc.nodes.length; i += 1) {
    const node = baseDoc.nodes[i];
    nodeMap.set(node.id, node);
  }

  const patches = direction === 'forward' ? delta.addedOrNextNodes : delta.removedOrPreviousNodes;
  for (let i = 0; i < patches.length; i += 1) {
    const [id, node] = patches[i];
    nodeMap.set(id, node);
  }

  const targetOrder = direction === 'forward' ? delta.afterOrder : delta.beforeOrder;
  const nextNodes: DesignNode[] = new Array(targetOrder.length);
  for (let i = 0; i < targetOrder.length; i += 1) {
    const node = nodeMap.get(targetOrder[i]);
    if (!node) {
      throw new Error(`Delta history could not resolve node "${targetOrder[i]}" in document "${delta.documentId}".`);
    }
    nextNodes[i] = node;
  }

  return {
    ...baseDoc,
    id: delta.documentId,
    name: direction === 'forward' ? delta.documentNameAfter : delta.documentNameBefore,
    width: direction === 'forward' ? delta.widthAfter : delta.widthBefore,
    height: direction === 'forward' ? delta.heightAfter : delta.heightBefore,
    background: direction === 'forward' ? delta.backgroundAfter : delta.backgroundBefore,
    nodes: nextNodes,
  };
}

export function isProjectDeltaEmpty(delta: ProjectDelta): boolean {
  return (
    delta.metadataAfter === undefined &&
    delta.activePageIdAfter === undefined &&
    delta.pageOrderAfter === undefined &&
    delta.pages.length === 0 &&
    delta.componentOrderAfter === undefined &&
    delta.components.length === 0 &&
    !delta.designTokensChanged &&
    !delta.codeModulesChanged &&
    !delta.logicGraphsChanged &&
    !delta.assetsChanged &&
    !delta.animationsChanged
  );
}

/**
 * Computes a minimal structural delta between two immutable FolioProject snapshots.
 * Untouched pages, components, and nodes are never copied.
 */
export function computeProjectDelta(
  before: FolioProject,
  after: FolioProject,
  options?: { label?: string; coalesceKey?: string | null },
): ProjectDelta {
  const pages: PageDeltaEntry[] = [];
  const beforePagesById = new Map(before.pages.map((p) => [p.id, p]));
  const afterPagesById = new Map(after.pages.map((p) => [p.id, p]));

  for (const afterPage of after.pages) {
    const beforePage = beforePagesById.get(afterPage.id);
    if (!beforePage) {
      pages.push({ kind: 'added', pageId: afterPage.id, afterPage });
    } else if (beforePage !== afterPage) {
      const docChanged = beforePage.document !== afterPage.document;
      const metaChanged = beforePage.name !== afterPage.name || beforePage.route !== afterPage.route;
      if (docChanged || metaChanged) {
        pages.push({
          kind: 'updated',
          pageId: afterPage.id,
          beforePage: metaChanged ? { ...beforePage, document: beforePage.document } : undefined,
          afterPage: metaChanged ? { ...afterPage, document: afterPage.document } : undefined,
          documentDelta: docChanged
            ? computeDocumentNodesDelta(beforePage.document, afterPage.document)
            : undefined,
        });
      }
    }
  }

  for (const beforePage of before.pages) {
    if (!afterPagesById.has(beforePage.id)) {
      pages.push({ kind: 'removed', pageId: beforePage.id, beforePage });
    }
  }

  const pageOrderBefore = before.pages.map((p) => p.id);
  const pageOrderAfter = after.pages.map((p) => p.id);
  const pageOrderChanged =
    pageOrderBefore.length !== pageOrderAfter.length ||
    pageOrderBefore.some((id, idx) => id !== pageOrderAfter[idx]);

  const components: ComponentDeltaEntry[] = [];
  const beforeCompsById = new Map(before.components.map((c) => [c.id, c]));
  const afterCompsById = new Map(after.components.map((c) => [c.id, c]));

  for (const afterComp of after.components) {
    const beforeComp = beforeCompsById.get(afterComp.id);
    if (!beforeComp) {
      components.push({ kind: 'added', componentId: afterComp.id, afterComponent: afterComp });
    } else if (beforeComp !== afterComp) {
      components.push({
        kind: 'updated',
        componentId: afterComp.id,
        beforeComponent: beforeComp,
        afterComponent: afterComp,
      });
    }
  }

  for (const beforeComp of before.components) {
    if (!afterCompsById.has(beforeComp.id)) {
      components.push({ kind: 'removed', componentId: beforeComp.id, beforeComponent: beforeComp });
    }
  }

  const componentOrderBefore = before.components.map((c) => c.id);
  const componentOrderAfter = after.components.map((c) => c.id);
  const componentOrderChanged =
    componentOrderBefore.length !== componentOrderAfter.length ||
    componentOrderBefore.some((id, idx) => id !== componentOrderAfter[idx]);

  return {
    id: nextDeltaId(),
    ...(options?.label ? { label: options.label } : {}),
    ...(options?.coalesceKey !== undefined ? { coalesceKey: options.coalesceKey } : {}),
    ...(before.metadata !== after.metadata
      ? { metadataBefore: before.metadata, metadataAfter: after.metadata }
      : {}),
    ...(before.activePageId !== after.activePageId
      ? { activePageIdBefore: before.activePageId, activePageIdAfter: after.activePageId }
      : {}),
    ...(pageOrderChanged ? { pageOrderBefore, pageOrderAfter } : {}),
    pages,
    ...(componentOrderChanged ? { componentOrderBefore, componentOrderAfter } : {}),
    components,
    ...(before.designTokens !== after.designTokens
      ? {
          designTokensChanged: true,
          designTokensBefore: before.designTokens,
          designTokensAfter: after.designTokens,
        }
      : {}),
    ...(before.codeModules !== after.codeModules
      ? {
          codeModulesChanged: true,
          codeModulesBefore: before.codeModules,
          codeModulesAfter: after.codeModules,
        }
      : {}),
    ...(before.logicGraphs !== after.logicGraphs
      ? {
          logicGraphsChanged: true,
          logicGraphsBefore: before.logicGraphs,
          logicGraphsAfter: after.logicGraphs,
        }
      : {}),
    ...(before.assets !== after.assets
      ? {
          assetsChanged: true,
          assetsBefore: before.assets,
          assetsAfter: after.assets,
        }
      : {}),
    ...(before.animations !== after.animations
      ? {
          animationsChanged: true,
          animationsBefore: before.animations,
          animationsAfter: after.animations,
        }
      : {}),
  };
}

export function applyProjectDelta(
  project: FolioProject,
  delta: ProjectDelta,
  direction: 'forward' | 'backward' = 'forward',
): FolioProject {
  if (isProjectDeltaEmpty(delta)) return project;

  let nextPages = project.pages;
  if (delta.pages.length > 0 || delta.pageOrderAfter) {
    const pageMap = new Map(project.pages.map((p) => [p.id, p]));
    for (const entry of delta.pages) {
      if (entry.kind === 'added') {
        if (direction === 'forward' && entry.afterPage) {
          pageMap.set(entry.pageId, entry.afterPage);
        } else {
          pageMap.delete(entry.pageId);
        }
      } else if (entry.kind === 'removed') {
        if (direction === 'forward') {
          pageMap.delete(entry.pageId);
        } else if (entry.beforePage) {
          pageMap.set(entry.pageId, entry.beforePage);
        }
      } else {
        const existing = pageMap.get(entry.pageId);
        if (!existing) continue;
        const metaTarget = direction === 'forward' ? entry.afterPage : entry.beforePage;
        const nextDoc = entry.documentDelta
          ? applyDocumentNodesDelta(existing.document, entry.documentDelta, direction)
          : existing.document;
        pageMap.set(entry.pageId, {
          ...existing,
          ...(metaTarget ? { name: metaTarget.name, route: metaTarget.route } : {}),
          document: nextDoc,
        });
      }
    }

    const order =
      direction === 'forward'
        ? (delta.pageOrderAfter ?? project.pages.map((p) => p.id))
        : (delta.pageOrderBefore ?? project.pages.map((p) => p.id));
    nextPages = order.map((id) => {
      const page = pageMap.get(id);
      if (!page) throw new Error(`Delta history could not resolve page "${id}".`);
      return page;
    });
  }

  let nextComponents = project.components;
  if (delta.components.length > 0 || delta.componentOrderAfter) {
    const compMap = new Map(project.components.map((c) => [c.id, c]));
    for (const entry of delta.components) {
      if (entry.kind === 'added') {
        if (direction === 'forward' && entry.afterComponent) {
          compMap.set(entry.componentId, entry.afterComponent);
        } else {
          compMap.delete(entry.componentId);
        }
      } else if (entry.kind === 'removed') {
        if (direction === 'forward') {
          compMap.delete(entry.componentId);
        } else if (entry.beforeComponent) {
          compMap.set(entry.componentId, entry.beforeComponent);
        }
      } else {
        const replacement = direction === 'forward' ? entry.afterComponent : entry.beforeComponent;
        if (replacement) compMap.set(entry.componentId, replacement);
      }
    }

    const order =
      direction === 'forward'
        ? (delta.componentOrderAfter ?? project.components.map((c) => c.id))
        : (delta.componentOrderBefore ?? project.components.map((c) => c.id));
    nextComponents = order.map((id) => {
      const comp = compMap.get(id);
      if (!comp) throw new Error(`Delta history could not resolve component "${id}".`);
      return comp;
    });
  }

  const nextProject: FolioProject = {
    ...project,
    metadata:
      direction === 'forward'
        ? (delta.metadataAfter ?? project.metadata)
        : (delta.metadataBefore ?? project.metadata),
    activePageId:
      direction === 'forward'
        ? (delta.activePageIdAfter ?? project.activePageId)
        : (delta.activePageIdBefore ?? project.activePageId),
    pages: nextPages,
    components: nextComponents,
    logicGraphs: delta.logicGraphsChanged
      ? [...((direction === 'forward' ? delta.logicGraphsAfter : delta.logicGraphsBefore) ?? [])]
      : project.logicGraphs,
    assets: delta.assetsChanged
      ? [...((direction === 'forward' ? delta.assetsAfter : delta.assetsBefore) ?? [])]
      : project.assets,
  };

  if (delta.designTokensChanged) {
    const nextTokens = direction === 'forward' ? delta.designTokensAfter : delta.designTokensBefore;
    if (nextTokens === undefined) delete nextProject.designTokens;
    else nextProject.designTokens = nextTokens;
  }

  if (delta.codeModulesChanged) {
    const nextModules = direction === 'forward' ? delta.codeModulesAfter : delta.codeModulesBefore;
    if (nextModules === undefined) delete nextProject.codeModules;
    else nextProject.codeModules = [...nextModules];
  }

  if (delta.animationsChanged) {
    const nextAnimations = direction === 'forward' ? delta.animationsAfter : delta.animationsBefore;
    if (nextAnimations === undefined) delete nextProject.animations;
    else nextProject.animations = [...nextAnimations];
  }

  return nextProject;
}

export function createDeltaHistoryTimeline(
  initialProject: FolioProject,
  maxEntries = DEFAULT_DELTA_HISTORY_LIMIT,
): DeltaHistoryTimeline {
  return {
    current: initialProject,
    past: [],
    future: [],
    maxEntries: Math.max(1, maxEntries),
    activeCoalesceKey: null,
  };
}

export function pushProjectDelta(
  timeline: DeltaHistoryTimeline,
  nextProject: FolioProject,
  options?: { label?: string; coalesceKey?: string | null },
): DeltaHistoryTimeline {
  if (nextProject === timeline.current) return timeline;

  const coalesceKey = options?.coalesceKey ?? null;
  if (
    coalesceKey &&
    timeline.activeCoalesceKey === coalesceKey &&
    timeline.past.length > 0
  ) {
    // Rebase against the pre-coalesced baseline so rapid slider/drag ticks
    // collapse into one clean atomic delta entry.
    const previousDelta = timeline.past[timeline.past.length - 1];
    const baselineProject = applyProjectDelta(timeline.current, previousDelta, 'backward');
    const mergedDelta = computeProjectDelta(baselineProject, nextProject, {
      label: options?.label ?? previousDelta.label,
      coalesceKey,
    });
    return {
      ...timeline,
      current: nextProject,
      past: [...timeline.past.slice(0, -1), mergedDelta],
      future: [],
      activeCoalesceKey: coalesceKey,
    };
  }

  const delta = computeProjectDelta(timeline.current, nextProject, {
    label: options?.label,
    coalesceKey,
  });
  if (isProjectDeltaEmpty(delta)) return timeline;

  const nextPast =
    timeline.past.length >= timeline.maxEntries
      ? [...timeline.past.slice(timeline.past.length - timeline.maxEntries + 1), delta]
      : [...timeline.past, delta];

  return {
    ...timeline,
    current: nextProject,
    past: nextPast,
    future: [],
    activeCoalesceKey: coalesceKey,
  };
}

export function commitDeltaCoalesceGroup(timeline: DeltaHistoryTimeline): DeltaHistoryTimeline {
  if (timeline.activeCoalesceKey === null) return timeline;
  return { ...timeline, activeCoalesceKey: null };
}

export function undoProjectDelta(timeline: DeltaHistoryTimeline): DeltaHistoryTimeline {
  if (timeline.past.length === 0) return timeline;
  const lastDelta = timeline.past[timeline.past.length - 1];
  const previousProject = applyProjectDelta(timeline.current, lastDelta, 'backward');
  return {
    ...timeline,
    current: previousProject,
    past: timeline.past.slice(0, -1),
    future: [lastDelta, ...timeline.future].slice(0, timeline.maxEntries),
    activeCoalesceKey: null,
  };
}

export function redoProjectDelta(timeline: DeltaHistoryTimeline): DeltaHistoryTimeline {
  if (timeline.future.length === 0) return timeline;
  const nextDelta = timeline.future[0];
  const restoredProject = applyProjectDelta(timeline.current, nextDelta, 'forward');
  return {
    ...timeline,
    current: restoredProject,
    past: [...timeline.past, nextDelta].slice(-timeline.maxEntries),
    future: timeline.future.slice(1),
    activeCoalesceKey: null,
  };
}

/**
 * Estimates changed-node footprint of a delta entry (useful for telemetry & tests
 * proving O(changed nodes) memory scaling vs O(total project nodes)).
 */
export function countDeltaTouchedNodes(delta: ProjectDelta): number {
  let count = 0;
  for (const page of delta.pages) {
    if (page.documentDelta) {
      count += page.documentDelta.addedOrNextNodes.length + page.documentDelta.removedOrPreviousNodes.length;
    } else if (page.afterPage) {
      count += page.afterPage.document.nodes.length;
    } else if (page.beforePage) {
      count += page.beforePage.document.nodes.length;
    }
  }
  return count;
}

/**
 * Validates that a candidate history entry is a well-formed ProjectDelta
 * and does not smuggle a disallowed project identity (e.g. Component Canvas buffer).
 */
export function isProjectDeltaEntry(
  value: unknown,
  options?: { disallowedProjectId?: string },
): value is ProjectDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false;
  if (!Array.isArray(candidate.pages) || !Array.isArray(candidate.components)) return false;
  // Reject full FolioProject snapshots passed into delta stacks.
  if ('format' in candidate || 'formatVersion' in candidate) return false;

  const disallowedId = options?.disallowedProjectId;
  const isValidMeta = (meta: unknown): boolean => {
    if (meta === undefined) return true;
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return false;
    const record = meta as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) return false;
    if (disallowedId && record.id === disallowedId) return false;
    return typeof record.name === 'string' && typeof record.createdAt === 'string' && typeof record.updatedAt === 'string';
  };
  if (!isValidMeta(candidate.metadataBefore) || !isValidMeta(candidate.metadataAfter)) {
    return false;
  }

  for (const entry of candidate.pages) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    if (
      (item.kind !== 'added' && item.kind !== 'removed' && item.kind !== 'updated') ||
      typeof item.pageId !== 'string' ||
      item.pageId.length === 0
    ) {
      return false;
    }
  }

  for (const entry of candidate.components) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    if (
      (item.kind !== 'added' && item.kind !== 'removed' && item.kind !== 'updated') ||
      typeof item.componentId !== 'string' ||
      item.componentId.length === 0
    ) {
      return false;
    }
  }

  return true;
}

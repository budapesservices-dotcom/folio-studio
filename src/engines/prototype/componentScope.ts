/**
 * Folio Node Logic — Component-Scoped Per-Instance Execution Contract.
 *
 * Pure, deterministic expansion layer shared by all 3 runtimes:
 * 1. Headless Prototype Simulator (`runtime.ts`)
 * 2. Live Preview Micro-Runtime (`parity.ts` + `codegen.ts`)
 * 3. Exported React TSX Codegen (`parity.ts` + `codegen.ts` + `reactCompiler.ts`)
 *
 * Key invariants:
 * - Never mutates `.flop` JSON v2 project documents; expansion is purely
 *   ephemeral at runtime/compile time so save/reload roundtrips remain untouched.
 * - Respects `component.nodeLogicEnabled === true`: components not enabled for
 *   Node Logic do NOT execute component-scoped graphs on pages.
 * - Enforces canonical component precedence (`Master -> Variants -> Slots ->
 *   Local Overrides -> Tokens`) via `resolveComponentInstanceNodes()`.
 * - Scopes internal targets deterministically as `${instancePathId}__${childId}`
 *   (recursively supporting nested component instances with cycle guard +
 *   max depth 16).
 * - Isolates component-local variables per instance (`${instancePathId}::${varId}`)
 *   and carries `instanceId` on every expanded graph so private memory
 *   (`state.toggle`, Baked Frames) and `firedOnce` guards are 100% isolated
 *   across sibling and nested instances of the same master.
 */

import { resolveComponentInstanceNodes } from '../../core/document/components';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  LogicGraph,
  LogicNode,
  LogicVariableDefinition,
} from '../../core/document/types';

export const COMPONENT_INSTANCE_NODE_SEP = '__';
export const COMPONENT_INSTANCE_VAR_SEP = '::';
export const COMPONENT_GRAPH_INSTANCE_MARKER = '::instance::';
const MAX_COMPONENT_EXPANSION_DEPTH = 16;

export interface ExpandedComponentInstance {
  readonly instanceId: string;
  readonly componentId: string;
  readonly instanceNode: ComponentInstanceNode;
  readonly master: ComponentDefinition;
  readonly parentInstanceId?: string;
  readonly resolvedNodes: readonly DesignNode[];
}

export interface ComponentInstanceGraphMeta {
  readonly sourceGraphId: string;
  readonly componentId: string;
  readonly instanceId: string;
  readonly localVariableIds: ReadonlySet<string>;
}

export interface ResolvedPageLogicGraphs {
  readonly graphs: readonly LogicGraph[];
  readonly expandedInstances: readonly ExpandedComponentInstance[];
  readonly scopedAstNodesById: ReadonlyMap<string, DesignNode>;
  readonly instanceMetaByGraphId: ReadonlyMap<string, ComponentInstanceGraphMeta>;
}

/**
 * Recursively traverses all component instances on `page` (including nested
 * component instances inside masters) with cycle protection and max depth 16,
 * applying `Master -> Variants -> Slots -> Local Overrides -> Tokens` at every
 * level via `resolveComponentInstanceNodes()`.
 */
export function collectPageComponentInstances(
  project: FolioProject,
  page: FolioPage,
): {
  readonly expandedInstances: readonly ExpandedComponentInstance[];
  readonly scopedAstNodesById: ReadonlyMap<string, DesignNode>;
} {
  const tokens: DesignTokenCollection = getProjectDesignTokens(project);
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );

  const expandedInstances: ExpandedComponentInstance[] = [];
  const scopedAstNodesById = new Map<string, DesignNode>();

  for (const pageNode of page.document.nodes) {
    scopedAstNodesById.set(pageNode.id, pageNode);
  }

  const expandInstance = (
    instanceNode: ComponentInstanceNode,
    instancePathId: string,
    parentInstanceId: string | undefined,
    visitedComponentIds: ReadonlySet<string>,
    depth: number,
  ): void => {
    if (depth >= MAX_COMPONENT_EXPANSION_DEPTH) return;
    const master = componentsById.get(instanceNode.componentId);
    if (!master || visitedComponentIds.has(master.id)) return;

    const nextVisited = new Set(visitedComponentIds);
    nextVisited.add(master.id);

    const resolvedNodes = resolveComponentInstanceNodes(instanceNode, master, tokens);
    expandedInstances.push({
      instanceId: instancePathId,
      componentId: master.id,
      instanceNode,
      master,
      ...(parentInstanceId ? { parentInstanceId } : {}),
      resolvedNodes,
    });

    for (const child of resolvedNodes) {
      const scopedChildId = `${instancePathId}${COMPONENT_INSTANCE_NODE_SEP}${child.id}`;
      scopedAstNodesById.set(scopedChildId, child);
      if (child.type === 'component-instance') {
        expandInstance(child, scopedChildId, instancePathId, nextVisited, depth + 1);
      }
    }
  };

  for (const pageNode of page.document.nodes) {
    if (pageNode.type === 'component-instance') {
      expandInstance(pageNode, pageNode.id, undefined, new Set<string>(), 0);
    }
  }

  return { expandedInstances, scopedAstNodesById };
}

function rewriteScopedNodeTarget(
  rawId: unknown,
  instanceId: string,
  masterNodeIds: ReadonlySet<string>,
): string | undefined {
  if (typeof rawId !== 'string') return undefined;
  const trimmed = rawId.trim();
  if (!trimmed) return undefined;
  if (masterNodeIds.has(trimmed)) {
    return `${instanceId}${COMPONENT_INSTANCE_NODE_SEP}${trimmed}`;
  }
  const sepIdx = trimmed.indexOf(COMPONENT_INSTANCE_NODE_SEP);
  if (sepIdx > 0) {
    const firstSeg = trimmed.slice(0, sepIdx);
    if (masterNodeIds.has(firstSeg)) {
      return `${instanceId}${COMPONENT_INSTANCE_NODE_SEP}${trimmed}`;
    }
  }
  return undefined;
}

function rewriteTemplateLocalVariables(
  template: string,
  localVarIdMap: ReadonlyMap<string, string>,
  localVarNameMap: ReadonlyMap<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (fullMatch, rawKey: string) => {
    const byId = localVarIdMap.get(rawKey);
    if (byId) return `{{${byId}}}`;
    const byName = localVarNameMap.get(rawKey) ?? localVarNameMap.get(rawKey.toLowerCase());
    if (byName) return `{{${byName}}}`;
    return fullMatch;
  });
}

function expandComponentGraphForInstance(
  graph: LogicGraph,
  instance: ExpandedComponentInstance,
): {
  readonly graph: LogicGraph;
  readonly meta: ComponentInstanceGraphMeta;
} {
  const instanceId = instance.instanceId;
  const expandedGraphId = `${graph.id}${COMPONENT_GRAPH_INSTANCE_MARKER}${instanceId}`;
  const masterNodeIds = new Set<string>(instance.master.document.nodes.map((node) => node.id));

  // Scope component-local variables per instance; preserve explicit global variables shared across instances
  const localVarIdMap = new Map<string, string>();
  const localVarNameMap = new Map<string, string>();
  const localVariableIds = new Set<string>();
  const expandedVariables: LogicVariableDefinition[] = (graph.variables ?? []).map((variable) => {
    if (variable.scope === 'global') {
      return variable;
    }
    const scopedVarId = `${instanceId}${COMPONENT_INSTANCE_VAR_SEP}${variable.id}`;
    localVarIdMap.set(variable.id, scopedVarId);
    localVarNameMap.set(variable.name, scopedVarId);
    localVarNameMap.set(variable.name.toLowerCase(), scopedVarId);
    localVariableIds.add(scopedVarId);
    return {
      ...variable,
      id: scopedVarId,
    };
  });

  const expandedNodes: LogicNode[] = graph.nodes.map((node) => {
    const nextData: LogicNode['data'] = { ...node.data };

    // 1. Rewrite AST node targets inside this master component to instance-scoped IDs
    const scopedTarget = rewriteScopedNodeTarget(nextData.targetNodeId, instanceId, masterNodeIds);
    if (scopedTarget) {
      nextData.targetNodeId = scopedTarget;
    } else if (
      node.type === 'action.set-variant'
      && nextData.targetMode !== 'pipeline'
      && (!nextData.targetNodeId || nextData.targetNodeId === instance.componentId)
    ) {
      // Allow component-scoped Set Variant to target the component instance itself
      nextData.targetNodeId = instanceId;
    }

    // 2. Rewrite pipelineChildId references pointing into this master's children
    const scopedPipelineChild = rewriteScopedNodeTarget(nextData.pipelineChildId, instanceId, masterNodeIds);
    if (scopedPipelineChild) {
      nextData.pipelineChildId = scopedPipelineChild;
    }

    // 3. Bind `source.component` matching this master strictly to THIS instance
    if (node.type === 'source.component' && nextData.componentId === instance.componentId) {
      nextData.targetNodeId = instanceId;
    }

    // 4. Rewrite component-local variable references
    if (typeof nextData.variableId === 'string') {
      const scopedVar = localVarIdMap.get(nextData.variableId.trim());
      if (scopedVar) {
        nextData.variableId = scopedVar;
      }
    }

    // 5. Rewrite `{{localVar}}` template tokens so multiple instances never collide on variable names
    if (localVarIdMap.size > 0) {
      for (const field of ['template', 'message', 'text'] as const) {
        const rawVal = nextData[field];
        if (typeof rawVal === 'string' && rawVal.includes('{{')) {
          nextData[field] = rewriteTemplateLocalVariables(
            rawVal,
            localVarIdMap,
            localVarNameMap,
          );
        }
      }
    }

    return {
      ...node,
      data: nextData,
    };
  });

  const expandedGraph: LogicGraph = {
    ...graph,
    id: expandedGraphId,
    nodes: expandedNodes,
    variables: expandedVariables,
  };

  return {
    graph: expandedGraph,
    meta: {
      sourceGraphId: graph.id,
      componentId: instance.componentId,
      instanceId,
      localVariableIds,
    },
  };
}

/**
 * Resolves all executable logic graphs for `page`:
 * 1. `scope === 'project'` graphs
 * 2. `scope === 'page'` graphs targeting `page.id`
 * 3. Per-instance expanded `scope === 'component'` graphs for every Component
 *    Instance (and nested instance) on `page` whose master has
 *    `nodeLogicEnabled === true`.
 */
export function resolveApplicableGraphsForPage(
  project: FolioProject,
  page: FolioPage,
): ResolvedPageLogicGraphs {
  const { expandedInstances, scopedAstNodesById } = collectPageComponentInstances(project, page);
  const instanceMetaByGraphId = new Map<string, ComponentInstanceGraphMeta>();

  const baseGraphs = project.logicGraphs.filter(
    (graph) => graph.scope === 'project' || (graph.scope === 'page' && graph.targetId === page.id),
  );

  const componentGraphsByCompId = new Map<string, LogicGraph[]>();
  for (const graph of project.logicGraphs) {
    if (graph.scope !== 'component' || !graph.targetId) continue;
    const list = componentGraphsByCompId.get(graph.targetId) ?? [];
    list.push(graph);
    componentGraphsByCompId.set(graph.targetId, list);
  }

  const expandedComponentGraphs: LogicGraph[] = [];
  for (const instance of expandedInstances) {
    if (!instance.master.nodeLogicEnabled) continue;
    const compGraphs = componentGraphsByCompId.get(instance.componentId);
    if (!compGraphs || compGraphs.length === 0) continue;
    for (const compGraph of compGraphs) {
      const expanded = expandComponentGraphForInstance(compGraph, instance);
      expandedComponentGraphs.push(expanded.graph);
      instanceMetaByGraphId.set(expanded.graph.id, expanded.meta);
    }
  }

  return {
    graphs: [...baseGraphs, ...expandedComponentGraphs],
    expandedInstances,
    scopedAstNodesById,
    instanceMetaByGraphId,
  };
}

/**
 * Extracts the owning component instance ID from an expanded component graph ID,
 * or returns `undefined` for project/page-scoped graphs.
 */
export function getInstanceIdFromExpandedGraphId(graphId: string): string | undefined {
  const idx = graphId.indexOf(COMPONENT_GRAPH_INSTANCE_MARKER);
  if (idx <= 0) return undefined;
  const instanceId = graphId.slice(idx + COMPONENT_GRAPH_INSTANCE_MARKER.length).trim();
  return instanceId || undefined;
}

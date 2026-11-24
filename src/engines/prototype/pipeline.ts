/**
 * Folio Node Logic — Scoped Data Pipeline (Context Accumulation) Utilities.
 *
 * Pure, framework-independent, cycle-safe graph traversal and runtime context
 * helpers shared across:
 * - Semantic Validator (`validator.ts`)
 * - Headless Prototype Simulator (`runtime.ts`)
 * - Live Preview & Codegen (`codegen.ts`)
 * - Node Logic Inspector UI (`NodeLogicNodeFields.tsx` / `NodeLogicInspector.tsx`)
 *
 * Key invariants:
 * - `PipelineOriginRef` is a lightweight reference (IDs, names, types, child refs,
 *   attached animation IDs) — never a deep clone of heavy AST geometry/styles.
 * - `PipelineContext` accumulates structured outputs in `steps[nodeId]` immutably
 *   per execution branch so disconnected flows and sibling branches never leak state.
 * - `Toggle State` private memory is keyed by `${nodeId}:${origin?.layerId ?? 'default'}`
 *   for target-bound Anti-Amnesia across clicks and duplicated components.
 */

import { resolveComponentInstanceNodes } from '../../core/document/components';
import type {
  AnimationClip,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  LogicConnection,
  LogicNode,
} from '../../core/document/types';
import { getLogicNodeDefinition, type LogicPortDataType } from './catalog';

export type PipelineTargetMode = 'pipeline' | 'override';

export interface PipelineOriginChildRef {
  readonly id: string;
  readonly name: string;
  readonly type: DesignNode['type'];
}

export interface PipelineOriginRef {
  readonly layerId: string;
  readonly name: string;
  readonly type: DesignNode['type'];
  readonly instanceId?: string;
  readonly animationIds: readonly string[];
  readonly children?: readonly PipelineOriginChildRef[];
}

export type PipelineStepOutput = Readonly<Record<string, unknown>>;

export interface PipelineContext {
  readonly executionId: string;
  readonly eventKind: string;
  readonly origin: PipelineOriginRef | null;
  readonly steps: Readonly<Record<string, PipelineStepOutput>>;
}

export interface UpstreamOutputOption {
  readonly refKey: string;
  readonly sourceNodeId: string | null;
  readonly sourceLabel: string;
  readonly field: string;
  readonly label: string;
  readonly valueType: LogicPortDataType;
}

export type ParsedPipelineRef =
  | { readonly kind: 'origin'; readonly field: string }
  | { readonly kind: 'step'; readonly sourceNodeId: string; readonly field: string };

export const PIPELINE_REF_DATA_KEYS = [
  'pipelineRef',
  'conditionRef',
  'leftRef',
  'rightRef',
  'valueRef',
] as const;

export type PipelineRefDataKey = (typeof PIPELINE_REF_DATA_KEYS)[number];

const MAX_SCOPED_COMPONENT_DEPTH = 16;

interface ResolvedScopedNodeInfo {
  readonly node: DesignNode;
  readonly owningInstanceId?: string;
  readonly owningInstanceResolvedNodes?: readonly DesignNode[];
}

function resolveScopedNodeDetails(
  nodeId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  tokens?: DesignTokenCollection,
): ResolvedScopedNodeInfo | undefined {
  if (!nodeId) return undefined;
  const direct = astNodesById.get(nodeId);
  if (direct) {
    return {
      node: direct,
      ...(direct.type === 'component-instance' ? { owningInstanceId: direct.id } : {}),
    };
  }
  if (!componentsById || !nodeId.includes('__')) return undefined;

  // Match the root component instance in astNodesById (supports IDs that may contain underscores)
  let rootInstanceId: string | null = null;
  let remainder = '';
  let searchFrom = 0;
  while (searchFrom < nodeId.length) {
    const idx = nodeId.indexOf('__', searchFrom);
    if (idx <= 0) break;
    const candidatePrefix = nodeId.slice(0, idx);
    const candidateNode = astNodesById.get(candidatePrefix);
    if (candidateNode && candidateNode.type === 'component-instance') {
      rootInstanceId = candidatePrefix;
      remainder = nodeId.slice(idx + 2);
      break;
    }
    searchFrom = idx + 2;
  }

  if (!rootInstanceId || !remainder) return undefined;
  let currentNode: DesignNode = astNodesById.get(rootInstanceId)!;
  let currentInstancePath = rootInstanceId;
  const visitedComponentIds = new Set<string>();
  let depth = 0;

  while (currentNode.type === 'component-instance' && remainder.length > 0) {
    if (depth >= MAX_SCOPED_COMPONENT_DEPTH) return undefined;
    const master = componentsById.get(currentNode.componentId);
    if (!master || visitedComponentIds.has(master.id)) return undefined;
    visitedComponentIds.add(master.id);
    depth += 1;

    const resolvedChildren = resolveComponentInstanceNodes(currentNode, master, tokens);

    // First check exact match on remaining suffix inside this instance's resolved nodes
    const exactMatch = resolvedChildren.find((item) => item.id === remainder);
    if (exactMatch) {
      return {
        node: exactMatch,
        owningInstanceId:
          exactMatch.type === 'component-instance'
            ? `${currentInstancePath}__${exactMatch.id}`
            : currentInstancePath,
        owningInstanceResolvedNodes: resolvedChildren,
      };
    }

    // Otherwise split for nested component-instance traversal
    let matchedChild: DesignNode | undefined;
    let nextRemainder = '';
    let childSearchFrom = 0;
    while (childSearchFrom < remainder.length) {
      const idx = remainder.indexOf('__', childSearchFrom);
      if (idx <= 0) break;
      const childPrefix = remainder.slice(0, idx);
      const found = resolvedChildren.find(
        (item) => item.id === childPrefix && item.type === 'component-instance',
      );
      if (found) {
        matchedChild = found;
        nextRemainder = remainder.slice(idx + 2);
        break;
      }
      childSearchFrom = idx + 2;
    }

    if (!matchedChild || !nextRemainder) return undefined;
    currentInstancePath = `${currentInstancePath}__${matchedChild.id}`;
    currentNode = matchedChild;
    remainder = nextRemainder;
  }

  return undefined;
}

/**
 * Resolves a DesignNode by ID, supporting direct page/component AST node IDs,
 * component-instance child IDs (`${instanceId}__${masterChildId}`), and nested
 * component-instance paths (`${outer}__${inner}__${leafId}`), respecting
 * canonical precedence: Master -> Variants -> Slots -> Local Overrides -> Tokens.
 */
export function resolveAstNodeById(
  nodeId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  tokens?: DesignTokenCollection,
): DesignNode | undefined {
  return resolveScopedNodeDetails(nodeId, astNodesById, componentsById, tokens)?.node;
}

/**
 * Extracts the owning component instance path ID for a component instance root
 * or any scoped child inside a component instance (including nested instances).
 * Returns `undefined` for regular non-component page layers.
 */
export function extractComponentInstanceIdFromScopedId(
  nodeId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
): string | undefined {
  return resolveScopedNodeDetails(nodeId, astNodesById, componentsById)?.owningInstanceId;
}

function collectResolvedComponentChildren(
  instanceNode: Extract<DesignNode, { type: 'component-instance' }>,
  prefixPath: string,
  componentsById: ReadonlyMap<string, ComponentDefinition>,
  tokens: DesignTokenCollection | undefined,
  children: PipelineOriginChildRef[],
  childIdSet: Set<string>,
  visitedComponentIds: ReadonlySet<string>,
  depth: number,
): void {
  if (depth >= MAX_SCOPED_COMPONENT_DEPTH) return;
  const master = componentsById.get(instanceNode.componentId);
  if (!master || visitedComponentIds.has(master.id)) return;
  const nextVisited = new Set(visitedComponentIds);
  nextVisited.add(master.id);
  const resolvedNodes = resolveComponentInstanceNodes(instanceNode, master, tokens);
  for (const child of resolvedNodes) {
    const scopedId = `${prefixPath}__${child.id}`;
    if (!childIdSet.has(scopedId)) {
      childIdSet.add(scopedId);
      children.push(
        Object.freeze({
          id: scopedId,
          name: child.name,
          type: child.type,
        }),
      );
    }
    if (child.type === 'component-instance') {
      collectResolvedComponentChildren(
        child,
        scopedId,
        componentsById,
        tokens,
        children,
        childIdSet,
        nextVisited,
        depth + 1,
      );
    }
  }
}

/**
 * Builds a lightweight `PipelineOriginRef` for a given layer ID.
 * - For Groups / Frames (any node with descendants via `parentId`), collects all
 *   descendant `{ id, name, type }` entries safely without deep-cloning AST styles.
 * - For Component Instances (and nested Component Instances), collects resolved
 *   master children with stable `${instanceId}__${childId}` IDs matching Live
 *   Preview `data-folio-id` markup and canonical component precedence.
 * - Carries `instanceId` whenever the origin is a component instance or a layer
 *   inside a component instance.
 * - Collects attached animation clip IDs whose tracks target the layer or its children.
 */
export function buildPipelineOriginRef(
  layerId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  animations?: readonly AnimationClip[],
  tokens?: DesignTokenCollection,
): PipelineOriginRef | null {
  if (!layerId) return null;
  const details = resolveScopedNodeDetails(layerId, astNodesById, componentsById, tokens);
  if (!details) return null;
  const root = details.node;
  const instanceId = details.owningInstanceId;

  const children: PipelineOriginChildRef[] = [];
  const childIdSet = new Set<string>();

  if (root.type === 'component-instance' && componentsById) {
    collectResolvedComponentChildren(
      root,
      layerId,
      componentsById,
      tokens,
      children,
      childIdSet,
      new Set<string>(),
      0,
    );
  } else if (details.owningInstanceResolvedNodes && instanceId) {
    // Descendants inside a component instance's resolved node tree
    const byParent = new Map<string, DesignNode[]>();
    for (const candidate of details.owningInstanceResolvedNodes) {
      const pid = candidate.parentId;
      if (!pid) continue;
      const list = byParent.get(pid) ?? [];
      list.push(candidate);
      byParent.set(pid, list);
    }
    const visited = new Set<string>([root.id]);
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of byParent.get(parentId) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        const scopedId = `${instanceId}__${child.id}`;
        childIdSet.add(scopedId);
        children.push(
          Object.freeze({
            id: scopedId,
            name: child.name,
            type: child.type,
          }),
        );
        if (child.type === 'component-instance' && componentsById) {
          collectResolvedComponentChildren(
            child,
            scopedId,
            componentsById,
            tokens,
            children,
            childIdSet,
            new Set<string>(),
            0,
          );
        }
        queue.push(child.id);
      }
    }
  } else {
    // Collect direct and nested children via parentId (cycle-safe BFS)
    const byParent = new Map<string, DesignNode[]>();
    for (const candidate of astNodesById.values()) {
      const pid = candidate.parentId;
      if (!pid) continue;
      const list = byParent.get(pid) ?? [];
      list.push(candidate);
      byParent.set(pid, list);
    }
    const visited = new Set<string>([root.id]);
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of byParent.get(parentId) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        childIdSet.add(child.id);
        children.push(
          Object.freeze({
            id: child.id,
            name: child.name,
            type: child.type,
          }),
        );
        queue.push(child.id);
      }
    }
  }

  const animationIds: string[] = [];
  if (animations && animations.length > 0) {
    for (const clip of animations) {
      const matchesOrigin = clip.tracks.some(
        (track) =>
          track.targetNodeId === layerId
          || track.targetNodeId === root.id
          || childIdSet.has(track.targetNodeId),
      );
      if (matchesOrigin) {
        animationIds.push(clip.id);
      }
    }
  }

  return Object.freeze({
    layerId,
    name: root.name,
    type: root.type,
    ...(instanceId ? { instanceId } : {}),
    animationIds: Object.freeze(animationIds),
    ...(children.length > 0 ? { children: Object.freeze(children) } : {}),
  });
}

/**
 * Cycle-safe reverse BFS traversal returning all upstream nodes connected
 * directly or transitively into `targetNodeId` (excluding `targetNodeId` itself).
 * Ordered nearest-first for intuitive data-picker presentation.
 */
export function getUpstreamNodes(
  nodes: readonly LogicNode[],
  connections: readonly LogicConnection[],
  targetNodeId: string,
): readonly LogicNode[] {
  const nodeById = new Map<string, LogicNode>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }
  if (!nodeById.has(targetNodeId)) return [];

  const incomingSources = new Map<string, string[]>();
  for (const conn of connections) {
    if (!nodeById.has(conn.sourceNodeId) || !nodeById.has(conn.targetNodeId)) continue;
    const list = incomingSources.get(conn.targetNodeId) ?? [];
    list.push(conn.sourceNodeId);
    incomingSources.set(conn.targetNodeId, list);
  }

  const visited = new Set<string>([targetNodeId]);
  const queue: string[] = [targetNodeId];
  const result: LogicNode[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const srcId of incomingSources.get(currentId) ?? []) {
      if (visited.has(srcId)) continue;
      visited.add(srcId);
      const srcNode = nodeById.get(srcId);
      if (srcNode) {
        result.push(srcNode);
        queue.push(srcId);
      }
    }
  }

  return result;
}

/**
 * Resolves the target layer ID bound to an origin-producing Event or Source node.
 */
export function getOriginProducerLayerId(
  node: LogicNode,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  tokens?: DesignTokenCollection,
): string | null {
  switch (node.type) {
    case 'event.on-click':
    case 'event.on-hover':
    case 'event.on-input':
    case 'event.on-drag':
    case 'event.on-scroll-view': {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      return targetId && resolveAstNodeById(targetId, astNodesById, componentsById, tokens) ? targetId : null;
    }
    case 'source.element': {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      if (targetId && resolveAstNodeById(targetId, astNodesById, componentsById, tokens)) return targetId;
      const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      if (compId) {
        for (const item of astNodesById.values()) {
          if (item.type === 'component-instance' && item.componentId === compId) {
            return item.id;
          }
        }
      }
      return null;
    }
    case 'source.component': {
      const explicitTarget = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';
      if (explicitTarget && resolveAstNodeById(explicitTarget, astNodesById, componentsById, tokens)) {
        return explicitTarget;
      }
      const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      if (!compId) return null;
      for (const item of astNodesById.values()) {
        if (item.type === 'component-instance' && item.componentId === compId) {
          return item.id;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Returns all active upstream `PipelineOriginRef` objects feeding into `targetNodeId`.
 */
export function getUpstreamPipelineOrigins(
  nodes: readonly LogicNode[],
  connections: readonly LogicConnection[],
  targetNodeId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  animations?: readonly AnimationClip[],
  tokens?: DesignTokenCollection,
): readonly PipelineOriginRef[] {
  const upstream = getUpstreamNodes(nodes, connections, targetNodeId);
  const origins: PipelineOriginRef[] = [];
  const seenLayerIds = new Set<string>();

  for (const src of upstream) {
    const layerId = getOriginProducerLayerId(src, astNodesById, componentsById, tokens);
    if (!layerId || seenLayerIds.has(layerId)) continue;
    const ref = buildPipelineOriginRef(layerId, astNodesById, componentsById, animations, tokens);
    if (ref) {
      seenLayerIds.add(layerId);
      origins.push(ref);
    }
  }

  return origins;
}

interface NodeOutputFieldSpec {
  readonly field: string;
  readonly label: string;
  readonly valueType: LogicPortDataType;
}

function getNodeStepOutputSpecs(node: LogicNode): readonly NodeOutputFieldSpec[] {
  switch (node.type) {
    case 'state.toggle':
      return [
        { field: 'value', label: 'value (current boolean)', valueType: 'boolean' },
        { field: 'previous', label: 'previous (prior boolean)', valueType: 'boolean' },
      ];
    case 'state.update':
    case 'state.set':
    case 'state.increment':
    case 'state.get':
      return [{ field: 'value', label: 'value', valueType: 'any' }];
    case 'event.on-click':
      return [
        { field: 'targetLayerId', label: 'targetLayerId', valueType: 'string' },
        { field: 'mode', label: 'mode', valueType: 'string' },
      ];
    case 'event.on-hover':
      return [
        { field: 'isHovered', label: 'isHovered', valueType: 'boolean' },
        { field: 'targetLayerId', label: 'targetLayerId', valueType: 'string' },
      ];
    case 'event.on-input':
      return [
        { field: 'value', label: 'value', valueType: 'string' },
        { field: 'targetLayerId', label: 'targetLayerId', valueType: 'string' },
      ];
    case 'event.on-key-press':
      return [{ field: 'key', label: 'key', valueType: 'string' }];
    case 'event.on-scroll-view':
      return [{ field: 'progress', label: 'progress', valueType: 'number' }];
    case 'event.on-state-change':
      return [{ field: 'value', label: 'value', valueType: 'any' }];
    case 'source.element':
      return [
        { field: 'value', label: 'property value', valueType: 'any' },
        { field: 'targetLayerId', label: 'targetLayerId', valueType: 'string' },
      ];
    case 'source.context':
      return [
        { field: 'value', label: 'value', valueType: 'any' },
        { field: 'route', label: 'route', valueType: 'string' },
        { field: 'themeId', label: 'themeId', valueType: 'string' },
      ];
    case 'source.external':
      return [
        { field: 'data', label: 'data', valueType: 'list' },
        { field: 'count', label: 'count', valueType: 'number' },
      ];
    case 'logic.branch':
      return [
        { field: 'matchedBranch', label: 'matchedBranch', valueType: 'string' },
        { field: 'condition', label: 'condition', valueType: 'boolean' },
      ];
    case 'logic.condition':
    case 'logic.compare':
      return [{ field: 'result', label: 'result', valueType: 'boolean' }];
    case 'logic.math':
      return [{ field: 'result', label: 'result', valueType: 'number' }];
    case 'logic.text':
    case 'logic.template':
      return [{ field: 'text', label: 'text', valueType: 'string' }];
    case 'logic.list':
      return [
        { field: 'result', label: 'result', valueType: 'list' },
        { field: 'count', label: 'count', valueType: 'number' },
      ];
    case 'flow.loop-timer':
      return [
        { field: 'item', label: 'item', valueType: 'any' },
        { field: 'index', label: 'index', valueType: 'number' },
      ];
    case 'network.http':
      return [
        { field: 'data', label: 'data', valueType: 'object' },
        { field: 'status', label: 'status', valueType: 'number' },
      ];
    case 'network.json':
      return [
        { field: 'result', label: 'result', valueType: 'any' },
        { field: 'valid', label: 'valid', valueType: 'boolean' },
      ];
    case 'network.socket':
      return [{ field: 'connected', label: 'connected', valueType: 'boolean' }];
    default:
      return [];
  }
}

/**
 * Returns all scoped upstream outputs available to `targetNodeId` for the
 * Node Inspector's Dynamic Scoped Data Picker.
 */
export function getScopedUpstreamOutputs(
  nodes: readonly LogicNode[],
  connections: readonly LogicConnection[],
  targetNodeId: string,
  astNodesById?: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  animations?: readonly AnimationClip[],
): readonly UpstreamOutputOption[] {
  const upstream = getUpstreamNodes(nodes, connections, targetNodeId);
  const options: UpstreamOutputOption[] = [];

  for (const src of upstream) {
    const def = getLogicNodeDefinition(src.type);
    const sourceLabel = def?.label ?? src.type;
    const specs = getNodeStepOutputSpecs(src);
    for (const spec of specs) {
      options.push({
        refKey: `step:${src.id}:${spec.field}`,
        sourceNodeId: src.id,
        sourceLabel,
        field: spec.field,
        label: `${sourceLabel} → ${spec.label}`,
        valueType: spec.valueType,
      });
    }
  }

  if (astNodesById) {
    const origins = getUpstreamPipelineOrigins(
      nodes,
      connections,
      targetNodeId,
      astNodesById,
      componentsById,
      animations,
    );
    if (origins.length > 0) {
      const primaryOrigin = origins[0];
      options.push(
        {
          refKey: 'origin:name',
          sourceNodeId: null,
          sourceLabel: `Origin (${primaryOrigin.name})`,
          field: 'name',
          label: `Origin (${primaryOrigin.name}) → name`,
          valueType: 'string',
        },
        {
          refKey: 'origin:layerId',
          sourceNodeId: null,
          sourceLabel: `Origin (${primaryOrigin.name})`,
          field: 'layerId',
          label: `Origin (${primaryOrigin.name}) → layerId`,
          valueType: 'string',
        },
        {
          refKey: 'origin:type',
          sourceNodeId: null,
          sourceLabel: `Origin (${primaryOrigin.name})`,
          field: 'type',
          label: `Origin (${primaryOrigin.name}) → type`,
          valueType: 'string',
        },
      );
    }
  }

  return options;
}

export function parsePipelineRef(ref: unknown): ParsedPipelineRef | null {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('origin:')) {
    const field = trimmed.slice('origin:'.length).trim();
    return field ? { kind: 'origin', field } : null;
  }
  if (trimmed.startsWith('step:')) {
    const rest = trimmed.slice('step:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return null;
    const sourceNodeId = rest.slice(0, sep).trim();
    const field = rest.slice(sep + 1).trim();
    if (!sourceNodeId || !field) return null;
    return { kind: 'step', sourceNodeId, field };
  }
  return null;
}

export function resolvePipelineRefValue(
  context: PipelineContext | null | undefined,
  ref: unknown,
): { readonly found: boolean; readonly value: unknown } {
  if (!context) return { found: false, value: undefined };
  const parsed = parsePipelineRef(ref);
  if (!parsed) return { found: false, value: undefined };

  if (parsed.kind === 'origin') {
    if (!context.origin) return { found: false, value: undefined };
    if (parsed.field === 'layerId') return { found: true, value: context.origin.layerId };
    if (parsed.field === 'name') return { found: true, value: context.origin.name };
    if (parsed.field === 'type') return { found: true, value: context.origin.type };
    if (parsed.field === 'instanceId') return { found: true, value: context.origin.instanceId ?? '' };
    if (parsed.field === 'animationIds') return { found: true, value: context.origin.animationIds };
    return { found: false, value: undefined };
  }

  const stepOutput = context.steps[parsed.sourceNodeId];
  if (!stepOutput || !Object.prototype.hasOwnProperty.call(stepOutput, parsed.field)) {
    return { found: false, value: undefined };
  }
  return { found: true, value: stepOutput[parsed.field] };
}

export function getNodeTargetMode(node: LogicNode): PipelineTargetMode {
  return node.data.targetMode === 'pipeline' ? 'pipeline' : 'override';
}

export function resolvePipelineTargetLayerId(
  node: LogicNode,
  context: PipelineContext | null | undefined,
): string {
  const mode = getNodeTargetMode(node);
  if (mode !== 'pipeline') {
    return typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
  }
  if (!context?.origin) return '';
  const childId = typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId.trim() : '';
  if (!childId) {
    return context.origin.layerId;
  }
  if (childId === context.origin.layerId) {
    return context.origin.layerId;
  }
  const hasChild = context.origin.children?.some((child) => child.id === childId) ?? false;
  return hasChild ? childId : '';
}

export function getPrivateToggleMemoryKey(
  nodeId: string,
  origin: PipelineOriginRef | null,
  frameId?: string | null,
  instanceId?: string | null,
): string {
  const originSegment = origin?.layerId ?? 'default';
  const effectiveInstanceId =
    (typeof instanceId === 'string' && instanceId.trim().length > 0 ? instanceId.trim() : '')
    || (typeof origin?.instanceId === 'string' && origin.instanceId.trim().length > 0 ? origin.instanceId.trim() : '');
  const trimmedFrameId = typeof frameId === 'string' && frameId.trim().length > 0 ? frameId.trim() : '';
  const parts: string[] = [];
  if (effectiveInstanceId) parts.push(effectiveInstanceId);
  if (trimmedFrameId) parts.push(trimmedFrameId);
  parts.push(nodeId, originSegment);
  return parts.join(':');
}

export function createPipelineContext(
  executionId: string,
  eventKind: string,
  origin: PipelineOriginRef | null,
): PipelineContext {
  return Object.freeze({
    executionId,
    eventKind,
    origin,
    steps: Object.freeze({}),
  });
}

/**
 * Returns a new immutable `PipelineContext` with `output` added to `steps[nodeId]`
 * without mutating prior contexts, ensuring sibling branches remain isolated.
 */
export function clonePipelineContextWithStep(
  context: PipelineContext,
  nodeId: string,
  output: PipelineStepOutput,
): PipelineContext {
  return Object.freeze({
    executionId: context.executionId,
    eventKind: context.eventKind,
    origin: context.origin,
    steps: Object.freeze({
      ...context.steps,
      [nodeId]: Object.freeze({ ...output }),
    }),
  });
}

export function formatPipelinePayloadSummary(payload: PipelineStepOutput | undefined): string {
  if (!payload) return '';
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (typeof value === 'string') {
        const clipped = value.length > 28 ? `${value.slice(0, 27)}…` : value;
        return `${key}: "${clipped}"`;
      }
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return `${key}: ${String(value)}`;
      }
      if (Array.isArray(value)) {
        return `${key}: [${value.length} items]`;
      }
      try {
        const serialized = JSON.stringify(value);
        return `${key}: ${serialized.length > 32 ? `${serialized.slice(0, 31)}…` : serialized}`;
      } catch {
        return `${key}: [object]`;
      }
    })
    .join(' · ');
}

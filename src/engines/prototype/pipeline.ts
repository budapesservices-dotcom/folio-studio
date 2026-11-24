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

import type {
  AnimationClip,
  ComponentDefinition,
  DesignNode,
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

/**
 * Resolves a DesignNode by ID, supporting both direct page/component AST node IDs
 * and expanded component-instance child IDs (`${instanceId}__${masterChildId}`).
 */
export function resolveAstNodeById(
  nodeId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
): DesignNode | undefined {
  if (!nodeId) return undefined;
  const direct = astNodesById.get(nodeId);
  if (direct) return direct;
  const sepIndex = nodeId.indexOf('__');
  if (sepIndex <= 0 || !componentsById) return undefined;
  const instanceId = nodeId.slice(0, sepIndex);
  const childId = nodeId.slice(sepIndex + 2);
  const instance = astNodesById.get(instanceId);
  if (!instance || instance.type !== 'component-instance') return undefined;
  const master = componentsById.get(instance.componentId);
  if (!master) return undefined;
  return master.document.nodes.find((item) => item.id === childId);
}

/**
 * Builds a lightweight `PipelineOriginRef` for a given layer ID.
 * - For Groups / Frames (any node with descendants via `parentId`), collects all
 *   descendant `{ id, name, type }` entries safely without deep-cloning AST styles.
 * - For Component Instances, collects master component children with stable
 *   `${instanceId}__${childId}` IDs matching Live Preview `data-folio-id` markup.
 * - Collects attached animation clip IDs whose tracks target the layer or its children.
 */
export function buildPipelineOriginRef(
  layerId: string,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById?: ReadonlyMap<string, ComponentDefinition>,
  animations?: readonly AnimationClip[],
): PipelineOriginRef | null {
  if (!layerId) return null;
  const root = astNodesById.get(layerId);
  if (!root) return null;

  const children: PipelineOriginChildRef[] = [];
  const childIdSet = new Set<string>();

  if (root.type === 'component-instance' && componentsById) {
    const master = componentsById.get(root.componentId);
    if (master) {
      for (const masterChild of master.document.nodes) {
        const scopedId = `${root.id}__${masterChild.id}`;
        if (childIdSet.has(scopedId)) continue;
        childIdSet.add(scopedId);
        children.push(
          Object.freeze({
            id: scopedId,
            name: masterChild.name,
            type: masterChild.type,
          }),
        );
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
        (track) => track.targetNodeId === root.id || childIdSet.has(track.targetNodeId),
      );
      if (matchesOrigin) {
        animationIds.push(clip.id);
      }
    }
  }

  return Object.freeze({
    layerId: root.id,
    name: root.name,
    type: root.type,
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
): string | null {
  switch (node.type) {
    case 'event.on-click':
    case 'event.on-hover':
    case 'event.on-input':
    case 'event.on-drag':
    case 'event.on-scroll-view': {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      return targetId && astNodesById.has(targetId) ? targetId : null;
    }
    case 'source.element': {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      if (targetId && astNodesById.has(targetId)) return targetId;
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
): readonly PipelineOriginRef[] {
  const upstream = getUpstreamNodes(nodes, connections, targetNodeId);
  const origins: PipelineOriginRef[] = [];
  const seenLayerIds = new Set<string>();

  for (const src of upstream) {
    const layerId = getOriginProducerLayerId(src, astNodesById);
    if (!layerId || seenLayerIds.has(layerId)) continue;
    const ref = buildPipelineOriginRef(layerId, astNodesById, componentsById, animations);
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
): string {
  return `${nodeId}:${origin?.layerId ?? 'default'}`;
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

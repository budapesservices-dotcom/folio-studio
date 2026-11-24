/**
 * Pure geometry, connection validation, immutable graph mutations, and starter
 * presets for Folio's Visual Node Logic Graph Editor (v1.1).
 *
 * Framework-independent and zero-DOM so every rule is fast, deterministic,
 * and directly unit-testable.
 */

import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  DesignNode,
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNetworkSettings,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariablePersist,
  LogicVariableScope,
  LogicVariableValue,
} from '../../core/document/types';
import {
  LOGIC_NODE_CATALOG,
  PRIMARY_LOGIC_NODE_TYPES,
  areLogicPortTypesCompatible,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  getLogicNodeDefinition,
  getLogicNodePort,
  type BuiltInLogicNodeType,
  type LogicNodeCategory,
  type LogicPortDataType,
  type LogicPortDefinition,
} from '../../engines/prototype';

export const LOGIC_NODE_WIDTH = 236;
export const LOGIC_NODE_HEADER_HEIGHT = 38;
export const LOGIC_NODE_SUBTITLE_HEIGHT = 22;
export const LOGIC_SOURCE_PICKER_HEIGHT = 34;
export const LOGIC_PORT_ROW_HEIGHT = 26;
export const LOGIC_NODE_BODY_PAD_Y = 8;

export type SourceLogicNodeType =
  | 'source.element'
  | 'source.context'
  | 'source.external'
  | 'source.page'
  | 'source.component'
  | 'source.theme';

export function isSourceLogicNodeType(type: string): type is SourceLogicNodeType {
  return (
    type === 'source.element'
    || type === 'source.context'
    || type === 'source.external'
    || type === 'source.page'
    || type === 'source.component'
    || type === 'source.theme'
  );
}

/**
 * Returns the set of entity IDs (pageId, componentId, targetNodeId, or themeId)
 * already bound to other source nodes of the same type in the graph so UI
 * dropdowns can grey out and disable already-used entries.
 */
export function getUsedSourceReferenceIds(
  graph: LogicGraph | null | undefined,
  nodeType: SourceLogicNodeType,
  excludeNodeId?: string,
): Set<string> {
  const used = new Set<string>();
  if (!graph) return used;
  const key =
    nodeType === 'source.page'
      ? 'pageId'
      : nodeType === 'source.component'
        ? 'componentId'
        : nodeType === 'source.element'
          ? 'targetNodeId'
          : nodeType === 'source.theme'
            ? 'themeId'
            : nodeType === 'source.context'
              ? 'pageId'
              : 'endpoint';
  for (const node of graph.nodes) {
    if (node.type !== nodeType) continue;
    if (excludeNodeId && node.id === excludeNodeId) continue;
    const raw = node.data[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      used.add(raw.trim());
    }
  }
  return used;
}

export interface LogicPoint {
  readonly x: number;
  readonly y: number;
}

export interface LogicViewportTransform {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

export interface LogicConnectionCheckResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly normalized?: {
    readonly sourceNodeId: string;
    readonly sourcePortId: string;
    readonly targetNodeId: string;
    readonly targetPortId: string;
  };
}

export type LogicPresetId = 'click-counter' | 'toggle-visibility' | 'theme-switcher' | 'api-fetch-list';

export interface LogicPresetMeta {
  readonly id: LogicPresetId;
  readonly name: string;
  readonly description: string;
}

export const LOGIC_PRESETS: readonly LogicPresetMeta[] = Object.freeze([
  {
    id: 'click-counter',
    name: 'Click Counter & Live Caption',
    description: 'Uses On Click, Update State (Increment), Text, and Set Layer to update a live counter.',
  },
  {
    id: 'toggle-visibility',
    name: 'Toggle Layer Visibility',
    description: 'Uses On Click and Set Layer (Visible + Transition) to show or hide any target layer.',
  },
  {
    id: 'theme-switcher',
    name: 'Light / Dark Theme Switcher',
    description: 'Uses On Click, Toggle State, Branch, and System & Form (Set Theme) to switch themes.',
  },
  {
    id: 'api-fetch-list',
    name: 'API Fetch & List Flow',
    description: 'Uses On Lifecycle, HTTP Request, JSON Tool, List Processor, and Overlay & Toast.',
  },
]);

let fallbackLogicIdSeq = 1;

export function createLogicId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}-${randomId.slice(0, 10)}`;
  return `${prefix}-${Date.now().toString(36)}-${fallbackLogicIdSeq++}`;
}

export function getLogicNodePorts(type: string): {
  readonly inputs: readonly LogicPortDefinition[];
  readonly outputs: readonly LogicPortDefinition[];
} {
  const def = getLogicNodeDefinition(type);
  if (!def) return { inputs: [], outputs: [] };
  return {
    inputs: def.ports.filter((port) => port.direction === 'in'),
    outputs: def.ports.filter((port) => port.direction === 'out'),
  };
}

export function getLogicNodeCategory(type: string): LogicNodeCategory | 'custom' {
  return getLogicNodeDefinition(type)?.category ?? 'custom';
}

export function getLogicNodeSubheaderHeight(type: string): number {
  return isSourceLogicNodeType(type) ? LOGIC_SOURCE_PICKER_HEIGHT : LOGIC_NODE_SUBTITLE_HEIGHT;
}

export function getLogicNodeHeight(node: Pick<LogicNode, 'type'>): number {
  const { inputs, outputs } = getLogicNodePorts(node.type);
  const rows = Math.max(1, inputs.length, outputs.length);
  return LOGIC_NODE_HEADER_HEIGHT + getLogicNodeSubheaderHeight(node.type) + LOGIC_NODE_BODY_PAD_Y * 2 + rows * LOGIC_PORT_ROW_HEIGHT;
}

export function getLogicPortLocalPosition(
  node: Pick<LogicNode, 'type'>,
  portId: string,
): LogicPoint | null {
  const { inputs, outputs } = getLogicNodePorts(node.type);
  const subheaderH = getLogicNodeSubheaderHeight(node.type);
  const inIdx = inputs.findIndex((port) => port.id === portId);
  if (inIdx >= 0) {
    return {
      x: 0,
      y:
        LOGIC_NODE_HEADER_HEIGHT
        + subheaderH
        + LOGIC_NODE_BODY_PAD_Y
        + inIdx * LOGIC_PORT_ROW_HEIGHT
        + LOGIC_PORT_ROW_HEIGHT / 2,
    };
  }
  const outIdx = outputs.findIndex((port) => port.id === portId);
  if (outIdx >= 0) {
    return {
      x: LOGIC_NODE_WIDTH,
      y:
        LOGIC_NODE_HEADER_HEIGHT
        + subheaderH
        + LOGIC_NODE_BODY_PAD_Y
        + outIdx * LOGIC_PORT_ROW_HEIGHT
        + LOGIC_PORT_ROW_HEIGHT / 2,
    };
  }
  return null;
}

export function getLogicPortWorldPosition(
  node: Pick<LogicNode, 'type' | 'x' | 'y'>,
  portId: string,
): LogicPoint | null {
  const local = getLogicPortLocalPosition(node, portId);
  if (!local) return null;
  return { x: node.x + local.x, y: node.y + local.y };
}

/**
 * Generates a smooth horizontal cubic Bezier SVG path connecting an output
 * port on the right of a node to an input port on the left of a target node.
 */
export function buildLogicWirePath(start: LogicPoint, end: LogicPoint): string {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);
  const handleOffset = dx >= 0
    ? Math.max(48, Math.min(180, dx * 0.5))
    : Math.max(72, Math.min(200, Math.abs(dx) * 0.45 + dy * 0.25));
  const c1x = start.x + handleOffset;
  const c1y = start.y;
  const c2x = end.x - handleOffset;
  const c2y = end.y;
  return `M ${Math.round(start.x * 10) / 10} ${Math.round(start.y * 10) / 10} C ${Math.round(c1x * 10) / 10} ${Math.round(c1y * 10) / 10}, ${Math.round(c2x * 10) / 10} ${Math.round(c2y * 10) / 10}, ${Math.round(end.x * 10) / 10} ${Math.round(end.y * 10) / 10}`;
}

export function getLogicWireMidpoint(start: LogicPoint, end: LogicPoint): LogicPoint {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

export function getLogicPortDataType(nodeType: string, portId: string): LogicPortDataType {
  return getLogicNodePort(nodeType, portId)?.dataType ?? 'any';
}

function wouldCreateDataflowCycle(
  graph: LogicGraph,
  sourceNodeId: string,
  targetNodeId: string,
  ignoreConnectionId?: string,
): boolean {
  const depsByNode = new Map<string, string[]>();
  for (const conn of graph.connections) {
    if (ignoreConnectionId && conn.id === ignoreConnectionId) continue;
    const srcNode = graph.nodes.find((n) => n.id === conn.sourceNodeId);
    const tgtNode = graph.nodes.find((n) => n.id === conn.targetNodeId);
    if (!srcNode || !tgtNode) continue;
    const tgtPort = getLogicNodePort(tgtNode.type, conn.targetPortId);
    if (!tgtPort || tgtPort.dataType === 'exec') continue;
    const deps = depsByNode.get(conn.targetNodeId) ?? [];
    deps.push(conn.sourceNodeId);
    depsByNode.set(conn.targetNodeId, deps);
  }

  const visited = new Set<string>();
  const stack = [sourceNodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === targetNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of depsByNode.get(current) ?? []) {
      stack.push(dep);
    }
  }
  return false;
}

/**
 * Validates whether two ports can be connected, automatically normalizing
 * input->output drag gestures into canonical output->input connections.
 */
export function canConnectLogicPorts(
  graph: LogicGraph,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
  ignoreConnectionId?: string,
): LogicConnectionCheckResult {
  if (fromNodeId === toNodeId) {
    return { ok: false, reason: 'A node cannot connect to itself.' };
  }

  const fromNode = graph.nodes.find((n) => n.id === fromNodeId);
  const toNode = graph.nodes.find((n) => n.id === toNodeId);
  if (!fromNode || !toNode) {
    return { ok: false, reason: 'One of the logic nodes no longer exists.' };
  }

  const fromPort = getLogicNodePort(fromNode.type, fromPortId);
  const toPort = getLogicNodePort(toNode.type, toPortId);
  if (!fromPort || !toPort) {
    return { ok: false, reason: 'Selected port is not defined on this node.' };
  }

  if (fromPort.direction === toPort.direction) {
    return {
      ok: false,
      reason: fromPort.direction === 'out'
        ? 'Connect an output port to an input port.'
        : 'Connect an input port to an output port.',
    };
  }

  const sourceNode = fromPort.direction === 'out' ? fromNode : toNode;
  const sourcePort = fromPort.direction === 'out' ? fromPort : toPort;
  const targetNode = fromPort.direction === 'out' ? toNode : fromNode;
  const targetPort = fromPort.direction === 'out' ? toPort : fromPort;

  if (!areLogicPortTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
    return {
      ok: false,
      reason: `Cannot connect ${sourcePort.dataType} output to ${targetPort.dataType} input.`,
    };
  }

  const duplicate = graph.connections.some(
    (conn) =>
      conn.id !== ignoreConnectionId
      && conn.sourceNodeId === sourceNode.id
      && conn.sourcePortId === sourcePort.id
      && conn.targetNodeId === targetNode.id
      && conn.targetPortId === targetPort.id,
  );
  if (duplicate) {
    return { ok: false, reason: 'These two ports are already connected.' };
  }

  if (targetPort.dataType !== 'exec' && wouldCreateDataflowCycle(graph, sourceNode.id, targetNode.id, ignoreConnectionId)) {
    return { ok: false, reason: 'Pure data connections cannot form a circular dependency.' };
  }

  return {
    ok: true,
    normalized: {
      sourceNodeId: sourceNode.id,
      sourcePortId: sourcePort.id,
      targetNodeId: targetNode.id,
      targetPortId: targetPort.id,
    },
  };
}

export interface SnapLogicPortMatch {
  readonly nodeId: string;
  readonly portId: string;
  readonly direction: 'in' | 'out';
  readonly position: LogicPoint;
  readonly distance: number;
}

/**
 * Finds the nearest compatible socket within `snapRadius` world units for
 * magnetic drag-and-patch wiring.
 */
export function findSnapLogicPort(
  graph: LogicGraph,
  nodes: readonly LogicNode[],
  anchorNodeId: string,
  anchorPortId: string,
  pointerWorld: LogicPoint,
  snapRadius = 26,
  ignoreConnectionId?: string,
): SnapLogicPortMatch | null {
  let best: SnapLogicPortMatch | null = null;
  const maxDistSq = snapRadius * snapRadius;

  for (const node of nodes) {
    if (node.id === anchorNodeId) continue;
    const { inputs, outputs } = getLogicNodePorts(node.type);
    const allPorts = [...inputs, ...outputs];
    for (const port of allPorts) {
      const pos = getLogicPortWorldPosition(node, port.id);
      if (!pos) continue;
      const dx = pos.x - pointerWorld.x;
      const dy = pos.y - pointerWorld.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) continue;
      const check = canConnectLogicPorts(
        graph,
        anchorNodeId,
        anchorPortId,
        node.id,
        port.id,
        ignoreConnectionId,
      );
      if (!check.ok) continue;
      const dist = Math.sqrt(distSq);
      if (!best || dist < best.distance) {
        best = {
          nodeId: node.id,
          portId: port.id,
          direction: port.direction,
          position: pos,
          distance: dist,
        };
      }
    }
  }
  return best;
}

export function touchLogicGraph(graph: LogicGraph, now = new Date().toISOString()): LogicGraph {
  return { ...graph, updatedAt: now };
}

export function computeNextNodePosition(
  graph: LogicGraph,
  viewportCenter: LogicPoint = { x: 260, y: 180 },
): LogicPoint {
  const baseX = Math.round(viewportCenter.x - LOGIC_NODE_WIDTH / 2);
  const baseY = Math.round(viewportCenter.y - 60);
  let x = baseX;
  let y = baseY;
  for (let step = 0; step < 16; step++) {
    const collides = graph.nodes.some(
      (node) => Math.abs(node.x - x) < 36 && Math.abs(node.y - y) < 36,
    );
    if (!collides) break;
    x += 32;
    y += 28;
  }
  return { x, y };
}

export function addNodeToGraph(
  graph: LogicGraph,
  type: BuiltInLogicNodeType,
  position: LogicPoint,
  initialData?: Record<string, string | number | boolean | null>,
): { graph: LogicGraph; node: LogicNode } {
  const node = createLogicNode({
    id: createLogicId('lnode'),
    type,
    x: Math.round(position.x),
    y: Math.round(position.y),
    data: initialData,
  });
  return {
    node,
    graph: touchLogicGraph({
      ...graph,
      nodes: [...graph.nodes, node],
    }),
  };
}

export function moveNodeInGraph(
  graph: LogicGraph,
  nodeId: string,
  x: number,
  y: number,
): LogicGraph {
  const nextX = Math.round(x);
  const nextY = Math.round(y);
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (node.x === nextX && node.y === nextY) return node;
    changed = true;
    return { ...node, x: nextX, y: nextY };
  });
  return changed ? touchLogicGraph({ ...graph, nodes }) : graph;
}

export function updateNodeDataInGraph(
  graph: LogicGraph,
  nodeId: string,
  patch: Record<string, string | number | boolean | null>,
): LogicGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        ...patch,
      },
    };
  });
  return changed ? touchLogicGraph({ ...graph, nodes }) : graph;
}

export function removeNodeFromGraph(graph: LogicGraph, nodeId: string): LogicGraph {
  const nextNodes = graph.nodes.filter((node) => node.id !== nodeId);
  if (nextNodes.length === graph.nodes.length) return graph;
  const nextConnections = graph.connections.filter(
    (conn) => conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId,
  );
  return touchLogicGraph({
    ...graph,
    nodes: nextNodes,
    connections: nextConnections,
  });
}

export function addConnectionToGraph(
  graph: LogicGraph,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
): { ok: true; graph: LogicGraph; connection: LogicConnection } | { ok: false; reason: string } {
  const check = canConnectLogicPorts(graph, fromNodeId, fromPortId, toNodeId, toPortId);
  if (!check.ok || !check.normalized) {
    return { ok: false, reason: check.reason ?? 'Invalid port connection.' };
  }

  const { sourceNodeId, sourcePortId, targetNodeId, targetPortId } = check.normalized;
  const targetNode = graph.nodes.find((n) => n.id === targetNodeId);
  const targetPort = targetNode ? getLogicNodePort(targetNode.type, targetPortId) : undefined;

  // Non-exec data inputs receive one upstream source; replace any previous wire cleanly.
  const filteredConnections = targetPort && targetPort.dataType !== 'exec'
    ? graph.connections.filter(
      (conn) => !(conn.targetNodeId === targetNodeId && conn.targetPortId === targetPortId),
    )
    : graph.connections;

  const connection = createLogicConnection({
    id: createLogicId('lconn'),
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  });

  return {
    ok: true,
    connection,
    graph: touchLogicGraph({
      ...graph,
      connections: [...filteredConnections, connection],
    }),
  };
}

export function removeConnectionFromGraph(graph: LogicGraph, connectionId: string): LogicGraph {
  const nextConnections = graph.connections.filter((conn) => conn.id !== connectionId);
  if (nextConnections.length === graph.connections.length) return graph;
  return touchLogicGraph({
    ...graph,
    connections: nextConnections,
  });
}

/**
 * Re-patches an existing connection from its original output anchor to a new
 * target input socket in one atomic update. Dropping back onto the exact same
 * target socket returns the original graph untouched.
 */
export function repatchConnectionInGraph(
  graph: LogicGraph,
  connectionId: string,
  newTargetNodeId: string,
  newTargetPortId: string,
): { ok: true; graph: LogicGraph; connection: LogicConnection; unchanged?: boolean } | { ok: false; reason: string } {
  const existing = graph.connections.find((conn) => conn.id === connectionId);
  if (!existing) {
    return { ok: false, reason: 'Connection no longer exists.' };
  }
  if (existing.targetNodeId === newTargetNodeId && existing.targetPortId === newTargetPortId) {
    return { ok: true, graph, connection: existing, unchanged: true };
  }
  const withoutExisting = {
    ...graph,
    connections: graph.connections.filter((conn) => conn.id !== connectionId),
  };
  return addConnectionToGraph(
    withoutExisting,
    existing.sourceNodeId,
    existing.sourcePortId,
    newTargetNodeId,
    newTargetPortId,
  );
}

export function getDefaultInitialValueForType(valueType: LogicValueType): LogicVariableValue {
  if (valueType === 'number') return 0;
  if (valueType === 'boolean') return false;
  if (valueType === 'list') return '[]';
  if (valueType === 'object') return '{}';
  return '';
}

export function addVariableToGraph(
  graph: LogicGraph,
  args: {
    name: string;
    valueType: LogicValueType;
    initialValue: LogicVariableValue;
    scope?: LogicVariableScope;
    persist?: LogicVariablePersist;
    computed?: boolean;
    computedExpression?: string;
  },
): { graph: LogicGraph; variable: LogicVariableDefinition } {
  const trimmedName = args.name.trim() || `var${(graph.variables?.length ?? 0) + 1}`;
  const variable = createLogicVariable({
    id: createLogicId('lvar'),
    name: trimmedName,
    valueType: args.valueType,
    initialValue: args.initialValue,
    scope: args.scope ?? 'local',
    persist: args.persist ?? 'none',
    ...(args.computed ? { computed: true, computedExpression: args.computedExpression ?? '' } : {}),
  });
  return {
    variable,
    graph: touchLogicGraph({
      ...graph,
      variables: [...(graph.variables ?? []), variable],
    }),
  };
}

export function updateVariableInGraph(
  graph: LogicGraph,
  variableId: string,
  patch: Partial<
    Pick<
      LogicVariableDefinition,
      'name' | 'valueType' | 'initialValue' | 'scope' | 'persist' | 'computed' | 'computedExpression'
    >
  >,
): LogicGraph {
  const currentVars = graph.variables ?? [];
  let changed = false;
  const nextVars = currentVars.map((variable) => {
    if (variable.id !== variableId) return variable;
    changed = true;
    const nextType = patch.valueType ?? variable.valueType;
    let nextInitial = patch.initialValue !== undefined ? patch.initialValue : variable.initialValue;
    if (patch.valueType && patch.valueType !== variable.valueType && patch.initialValue === undefined) {
      nextInitial = getDefaultInitialValueForType(nextType);
    }
    return {
      ...variable,
      ...(patch.name !== undefined ? { name: patch.name.trim() || variable.name } : {}),
      valueType: nextType,
      initialValue: nextInitial,
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.persist !== undefined ? { persist: patch.persist } : {}),
      ...(patch.computed !== undefined ? { computed: patch.computed } : {}),
      ...(patch.computedExpression !== undefined ? { computedExpression: patch.computedExpression } : {}),
    };
  });
  return changed ? touchLogicGraph({ ...graph, variables: nextVars }) : graph;
}

export function removeVariableFromGraph(graph: LogicGraph, variableId: string): LogicGraph {
  const currentVars = graph.variables ?? [];
  const nextVars = currentVars.filter((variable) => variable.id !== variableId);
  if (nextVars.length === currentVars.length) return graph;
  return touchLogicGraph({
    ...graph,
    variables: nextVars,
  });
}

export function updateNetworkSettingsInGraph(
  graph: LogicGraph,
  patch: Partial<LogicNetworkSettings>,
): LogicGraph {
  const current: LogicNetworkSettings = graph.networkSettings ?? {
    baseUrl: '',
    globalHeaders: '',
    authToken: '',
  };
  return touchLogicGraph({
    ...graph,
    networkSettings: {
      baseUrl: patch.baseUrl ?? current.baseUrl,
      globalHeaders: patch.globalHeaders ?? current.globalHeaders,
      authToken: patch.authToken ?? current.authToken,
    },
  });
}

export function computeFitViewTransform(
  nodes: readonly LogicNode[],
  viewportWidth: number,
  viewportHeight: number,
): LogicViewportTransform {
  if (nodes.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { panX: 48, panY: 48, zoom: 1 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const h = getLogicNodeHeight(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + LOGIC_NODE_WIDTH);
    maxY = Math.max(maxY, node.y + h);
  }
  const padding = Math.min(48, Math.max(20, Math.round(Math.min(viewportWidth, viewportHeight) * 0.08)));
  const contentW = Math.max(120, maxX - minX);
  const contentH = Math.max(100, maxY - minY);
  const rawZoom = Math.min(
    (viewportWidth - padding * 2) / contentW,
    (viewportHeight - padding * 2) / contentH,
  );
  const zoom = Math.max(0.15, Math.min(1.15, Math.round(rawZoom * 100) / 100));
  const panX = Math.round((viewportWidth - contentW * zoom) / 2 - minX * zoom);
  const panY = Math.round((viewportHeight - contentH * zoom) / 2 - minY * zoom);
  return { panX, panY, zoom };
}

export function getLogicNodeSummary(
  node: LogicNode,
  astNodes: readonly DesignNode[],
  variables: readonly LogicVariableDefinition[],
  themes: readonly { id: string; name: string }[],
  animations: readonly { id: string; name: string }[] = [],
  pages: readonly { id: string; name: string; route: string }[] = [],
  components: readonly { id: string; name: string }[] = [],
): string {
  const findNodeName = (id: unknown) => {
    if (typeof id !== 'string' || !id) return 'Unbound layer';
    return astNodes.find((item) => item.id === id)?.name ?? 'Missing layer';
  };
  const findVarName = (id: unknown) => {
    if (typeof id !== 'string' || !id) return 'Unbound variable';
    return variables.find((item) => item.id === id)?.name ?? 'Missing variable';
  };

  switch (node.type) {
    case 'source.element':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.property ?? 'value')}`;
    case 'source.context': {
      const kind = String(node.data.contextKind ?? 'page');
      if (kind === 'page') {
        const page = pages.find((p) => p.id === node.data.pageId);
        return page ? `Page · ${page.name}` : 'App · Active Page';
      }
      if (kind === 'theme') {
        const th = themes.find((t) => t.id === node.data.themeId);
        return th ? `Theme · ${th.name}` : 'App · Active Theme';
      }
      return `Context · ${kind}`;
    }
    case 'source.external':
      return `${String(node.data.sourceKind ?? 'api').toUpperCase()} · ${String(node.data.endpoint || node.data.collection || 'Unbound').slice(0, 24)}`;
    case 'source.page': {
      const pageId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
      const page = pages.find((p) => p.id === pageId);
      return page ? `${page.name} (${page.route})` : 'Select a page';
    }
    case 'source.component': {
      const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      const comp = components.find((c) => c.id === compId);
      return comp ? comp.name : 'Select a sent component';
    }
    case 'source.theme': {
      const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
      return themes.find((t) => t.id === themeId)?.name ?? (themeId || 'Select a theme');
    }
    case 'event.on-click':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.mode ?? 'click')}`;
    case 'event.on-hover':
      return `${findNodeName(node.data.targetNodeId)} · ${node.data.phase === 'leave' ? 'leave' : 'enter'}`;
    case 'event.on-input':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.mode ?? 'change')}`;
    case 'event.on-key-press':
      return `${String(node.data.keyCombo ?? 'Enter')} · ${String(node.data.phase ?? 'down')}`;
    case 'event.on-drag':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.phase ?? 'start')}`;
    case 'event.on-scroll-view':
      return `${String(node.data.mode ?? 'enter-view')}${node.data.targetNodeId ? ` · ${findNodeName(node.data.targetNodeId)}` : ''}`;
    case 'event.on-lifecycle':
      return `Lifecycle · ${String(node.data.trigger ?? 'page-load')}`;
    case 'event.on-page-load':
      return 'Page mount';
    case 'event.on-state-change':
    case 'state.get':
    case 'state.toggle':
      return findVarName(node.data.variableId);
    case 'state.update': {
      const op = String(node.data.operation ?? 'set');
      if (op === 'increment') {
        const step = Number(node.data.step ?? 1);
        return `${findVarName(node.data.variableId)} ${step >= 0 ? '+' : ''}${step}`;
      }
      return `${findVarName(node.data.variableId)} · ${op}`;
    }
    case 'state.set':
      return `${findVarName(node.data.variableId)} = ${node.data.value === null || node.data.value === undefined ? 'input' : String(node.data.value)}`;
    case 'state.increment':
      return `${findVarName(node.data.variableId)} ${Number(node.data.step ?? 1) >= 0 ? '+' : ''}${String(node.data.step ?? 1)}`;
    case 'logic.branch':
      return `Branch · ${String(node.data.mode ?? 'if-else')}`;
    case 'logic.condition':
      return node.data.mode === 'compare' || !node.data.mode
        ? `Left ${String(node.data.operator ?? '==')} Right`
        : `Condition · ${String(node.data.mode)}`;
    case 'logic.compare':
      return `Left ${String(node.data.operator ?? '==')} Right`;
    case 'logic.math':
      return `Math · ${String(node.data.operation ?? '+')}`;
    case 'logic.text':
      return node.data.mode === 'template' || !node.data.mode
        ? (String(node.data.template ?? '{{value}}').slice(0, 28) || 'Empty template')
        : `${String(node.data.mode)} (${String(node.data.currency ?? node.data.locale ?? '')})`;
    case 'logic.template':
      return String(node.data.template ?? '{{value}}').slice(0, 28) || 'Empty template';
    case 'logic.list':
      return `List · ${String(node.data.operation ?? 'filter')}`;
    case 'action.set-layer': {
      const prop = String(node.data.property ?? 'text');
      const extra = prop === 'fill' ? ` ${String(node.data.fill ?? '')}` : prop === 'visible' ? ` ${String(node.data.visibleMode ?? 'toggle')}` : '';
      return `${findNodeName(node.data.targetNodeId)} · ${prop}${extra}`;
    }
    case 'action.set-visible':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.mode ?? 'toggle')}`;
    case 'action.set-text':
      return findNodeName(node.data.targetNodeId);
    case 'action.set-fill':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.fill ?? '')}`;
    case 'action.set-variant':
      return findNodeName(node.data.targetNodeId);
    case 'action.media-animation': {
      const clipId = typeof node.data.clipId === 'string' ? node.data.clipId : '';
      const name = animations.find((clip) => clip.id === clipId)?.name ?? (clipId || findNodeName(node.data.targetNodeId));
      return `${String(node.data.command ?? 'play')} · ${name}`;
    }
    case 'action.navigate':
      return `${String(node.data.mode ?? 'internal')} · ${String(node.data.route ?? '/')}`;
    case 'action.overlay-toast':
      return `${String(node.data.mode ?? 'show-toast')}${node.data.mode === 'show-toast' ? ` · ${String(node.data.message ?? '').slice(0, 20)}` : ''}`;
    case 'action.system-form': {
      const act = String(node.data.action ?? 'set-theme');
      if (act === 'set-theme') {
        const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
        return `Theme · ${themes.find((t) => t.id === themeId)?.name ?? (themeId || 'Select theme')}`;
      }
      return `System · ${act}`;
    }
    case 'action.set-theme': {
      const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
      return themes.find((t) => t.id === themeId)?.name ?? (themeId || 'Unbound theme');
    }
    case 'action.play-animation': {
      const clipId = typeof node.data.clipId === 'string' ? node.data.clipId : '';
      return animations.find((clip) => clip.id === clipId)?.name ?? (clipId || 'Unbound clip');
    }
    case 'flow.delay':
      return `Wait ${String(node.data.duration ?? 300)}${String(node.data.unit ?? 'ms')}`;
    case 'flow.loop-timer':
      return node.data.mode === 'for-each'
        ? 'For Each item in list'
        : `${String(node.data.mode ?? 'interval')} · ${String(node.data.intervalMs ?? 1000)}ms`;
    case 'flow.control':
      return node.data.mode === 'parallel' ? 'Parallel / Wait All' : 'Sequence';
    case 'network.http':
      return `${String(node.data.method ?? 'GET')} ${String(node.data.url ?? '/api').slice(0, 22)}`;
    case 'network.json':
      return `${String(node.data.mode ?? 'get-field')}${node.data.path ? ` · ${String(node.data.path)}` : ''}`;
    case 'network.socket':
      return `${String(node.data.action ?? 'listen')} · #${String(node.data.channel ?? 'updates')}`;
    default:
      return node.type;
  }
}

export {
  createStarterMainPageLogicGraph,
  createInteractiveStarterProject,
} from './starterProject';

/**
 * Generates a valid, ready-to-run LogicGraph preset bound to real layers and
 * themes in the active project page.
 */
export function createLogicPresetGraph(
  presetId: LogicPresetId,
  project: FolioProject,
  page: FolioPage,
): LogicGraph {
  const firstInteractive =
    page.document.nodes.find((n) => n.type === 'rect' || n.type === 'frame' || n.type === 'ellipse')
    ?? page.document.nodes[0];
  const firstText = page.document.nodes.find((n) => n.type === 'text');
  const secondLayer =
    page.document.nodes.find((n) => n.id !== firstInteractive?.id)
    ?? firstInteractive;
  const tokens = getProjectDesignTokens(project);
  const lightTheme = tokens.themes[0]?.id ?? '';
  const darkTheme = tokens.themes[1]?.id ?? lightTheme;

  if (presetId === 'toggle-visibility') {
    const trigger = createLogicNode({
      id: createLogicId('lnode'),
      type: 'event.on-click',
      x: 48,
      y: 96,
      data: { targetNodeId: firstInteractive?.id ?? '', mode: 'click' },
    });
    const toggleVis = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.set-layer',
      x: 340,
      y: 96,
      data: { targetNodeId: secondLayer?.id ?? '', property: 'visible', visibleMode: 'toggle', transitionMs: 200 },
    });
    return createLogicGraph({
      id: createLogicId('lgraph'),
      name: 'Toggle Visibility',
      scope: 'page',
      targetId: page.id,
      nodes: [trigger, toggleVis],
      connections: [
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: trigger.id,
          sourcePortId: 'exec',
          targetNodeId: toggleVis.id,
          targetPortId: 'exec',
        }),
      ],
    });
  }

  if (presetId === 'theme-switcher') {
    const varDark = createLogicVariable({
      id: createLogicId('lvar'),
      name: 'isDarkTheme',
      valueType: 'boolean',
      initialValue: tokens.activeThemeId === darkTheme,
      scope: 'global',
      persist: 'local',
    });
    const trigger = createLogicNode({
      id: createLogicId('lnode'),
      type: 'event.on-click',
      x: 40,
      y: 88,
      data: { targetNodeId: firstInteractive?.id ?? '', mode: 'click' },
    });
    const toggle = createLogicNode({
      id: createLogicId('lnode'),
      type: 'state.toggle',
      x: 320,
      y: 88,
      data: { variableId: varDark.id },
    });
    const branch = createLogicNode({
      id: createLogicId('lnode'),
      type: 'logic.branch',
      x: 610,
      y: 88,
      data: { mode: 'if-else', condition: false },
    });
    const setDark = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.system-form',
      x: 900,
      y: 28,
      data: { action: 'set-theme', themeId: darkTheme },
    });
    const setLight = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.system-form',
      x: 900,
      y: 210,
      data: { action: 'set-theme', themeId: lightTheme },
    });
    return createLogicGraph({
      id: createLogicId('lgraph'),
      name: 'Theme Switcher',
      scope: 'page',
      targetId: page.id,
      variables: [varDark],
      nodes: [trigger, toggle, branch, setDark, setLight],
      connections: [
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: trigger.id,
          sourcePortId: 'exec',
          targetNodeId: toggle.id,
          targetPortId: 'exec',
        }),
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: toggle.id,
          sourcePortId: 'next',
          targetNodeId: branch.id,
          targetPortId: 'exec',
        }),
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: toggle.id,
          sourcePortId: 'result',
          targetNodeId: branch.id,
          targetPortId: 'condition',
        }),
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: branch.id,
          sourcePortId: 'true',
          targetNodeId: setDark.id,
          targetPortId: 'exec',
        }),
        createLogicConnection({
          id: createLogicId('lconn'),
          sourceNodeId: branch.id,
          sourcePortId: 'false',
          targetNodeId: setLight.id,
          targetPortId: 'exec',
        }),
      ],
    });
  }

  if (presetId === 'api-fetch-list') {
    const varItems = createLogicVariable({
      id: createLogicId('lvar'),
      name: 'items',
      valueType: 'list',
      initialValue: '[]',
      scope: 'local',
      persist: 'none',
    });
    const onLoad = createLogicNode({
      id: createLogicId('lnode'),
      type: 'event.on-lifecycle',
      x: 40,
      y: 96,
      data: { trigger: 'page-load', once: true },
    });
    const httpReq = createLogicNode({
      id: createLogicId('lnode'),
      type: 'network.http',
      x: 330,
      y: 72,
      data: { method: 'GET', url: '/items', useAuth: true, cache: 'default' },
    });
    const jsonPick = createLogicNode({
      id: createLogicId('lnode'),
      type: 'network.json',
      x: 630,
      y: 230,
      data: { mode: 'get-field', path: 'data.items' },
    });
    const saveState = createLogicNode({
      id: createLogicId('lnode'),
      type: 'state.update',
      x: 630,
      y: 44,
      data: { variableId: varItems.id, operation: 'set' },
    });
    const toast = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.overlay-toast',
      x: 930,
      y: 44,
      data: { mode: 'show-toast', message: 'Items synced!', tone: 'success' },
    });
    return createLogicGraph({
      id: createLogicId('lgraph'),
      name: 'API Fetch & Sync',
      scope: 'page',
      targetId: page.id,
      variables: [varItems],
      networkSettings: {
        baseUrl: 'https://api.example.com',
        globalHeaders: '{"Accept":"application/json"}',
        authToken: '',
      },
      nodes: [onLoad, httpReq, jsonPick, saveState, toast],
      connections: [
        createLogicConnection({ id: createLogicId('lconn'), sourceNodeId: onLoad.id, sourcePortId: 'exec', targetNodeId: httpReq.id, targetPortId: 'exec' }),
        createLogicConnection({ id: createLogicId('lconn'), sourceNodeId: httpReq.id, sourcePortId: 'success', targetNodeId: saveState.id, targetPortId: 'exec' }),
        createLogicConnection({ id: createLogicId('lconn'), sourceNodeId: httpReq.id, sourcePortId: 'data', targetNodeId: jsonPick.id, targetPortId: 'input' }),
        createLogicConnection({ id: createLogicId('lconn'), sourceNodeId: jsonPick.id, sourcePortId: 'result', targetNodeId: saveState.id, targetPortId: 'value' }),
        createLogicConnection({ id: createLogicId('lconn'), sourceNodeId: saveState.id, sourcePortId: 'next', targetNodeId: toast.id, targetPortId: 'exec' }),
      ],
    });
  }

  // Default: click-counter
  const varCount = createLogicVariable({
    id: createLogicId('lvar'),
    name: 'counter',
    valueType: 'number',
    initialValue: 0,
    scope: 'local',
    persist: 'none',
  });
  const trigger = createLogicNode({
    id: createLogicId('lnode'),
    type: 'event.on-click',
    x: 40,
    y: 84,
    data: { targetNodeId: firstInteractive?.id ?? '', mode: 'click' },
  });
  const inc = createLogicNode({
    id: createLogicId('lnode'),
    type: 'state.update',
    x: 320,
    y: 64,
    data: { variableId: varCount.id, operation: 'increment', step: 1, min: 0, max: 999 },
  });
  const tpl = createLogicNode({
    id: createLogicId('lnode'),
    type: 'logic.text',
    x: 320,
    y: 236,
    data: { mode: 'template', template: 'Clicked {{counter}} times' },
  });
  const setText = createLogicNode({
    id: createLogicId('lnode'),
    type: 'action.set-layer',
    x: 620,
    y: 84,
    data: { targetNodeId: firstText?.id ?? '', property: 'text', text: '' },
  });
  return createLogicGraph({
    id: createLogicId('lgraph'),
    name: 'Click Counter',
    scope: 'page',
    targetId: page.id,
    variables: [varCount],
    nodes: [trigger, inc, tpl, setText],
    connections: [
      createLogicConnection({
        id: createLogicId('lconn'),
        sourceNodeId: trigger.id,
        sourcePortId: 'exec',
        targetNodeId: inc.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: createLogicId('lconn'),
        sourceNodeId: inc.id,
        sourcePortId: 'next',
        targetNodeId: setText.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: createLogicId('lconn'),
        sourceNodeId: tpl.id,
        sourcePortId: 'text',
        targetNodeId: setText.id,
        targetPortId: 'value',
      }),
    ],
  });
}

const AUTO_ARRANGE_CATEGORY_ORDER: Record<LogicNodeCategory | 'custom', number> = {
  source: 0,
  event: 1,
  state: 2,
  logic: 3,
  action: 4,
  flow: 5,
  network: 6,
  custom: 7,
};

const AUTO_ARRANGE_START_X = 64;
const AUTO_ARRANGE_START_Y = 56;
const AUTO_ARRANGE_COL_GAP = 60;
const AUTO_ARRANGE_ROW_GAP = 28;
const AUTO_ARRANGE_COMPONENT_GAP = 52;
const AUTO_ARRANGE_ISOLATED_COLS = 3;

function compareNodesForLayout(a: LogicNode, b: LogicNode): number {
  const catDiff =
    AUTO_ARRANGE_CATEGORY_ORDER[getLogicNodeCategory(a.type)]
    - AUTO_ARRANGE_CATEGORY_ORDER[getLogicNodeCategory(b.type)];
  if (catDiff !== 0) return catDiff;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id.localeCompare(b.id);
}

function getSourcePortSortIndex(node: LogicNode, portId: string): number {
  const { outputs } = getLogicNodePorts(node.type);
  const idx = outputs.findIndex((p) => p.id === portId);
  return idx >= 0 ? idx : outputs.length;
}

/**
 * Organizes messy, overlapping, or disconnected nodes in a LogicGraph into a
 * clean, deterministic, left-to-right layered flow layout with zero node overlaps:
 * - Connected subgraphs are layered topologically (safely breaking cycles) with
 *   upstream pure-data providers right-aligned next to their consumers and
 *   barycenter vertical sorting to minimize wire crossings.
 * - Multiple connected components stack cleanly with clear vertical separation.
 * - Disconnected / isolated nodes are neatly arranged in a structured grid below
 *   connected flows.
 * - Returns the exact original graph reference if no node position changes.
 */
export function autoArrangeLogicGraph(graph: LogicGraph): LogicGraph {
  if (graph.nodes.length === 0) return graph;

  const nodeById = new Map<string, LogicNode>();
  const originalOrder = new Map<string, number>();
  graph.nodes.forEach((node, index) => {
    nodeById.set(node.id, node);
    originalOrder.set(node.id, index);
  });

  // Keep only valid edges between distinct existing nodes
  const validConnections = graph.connections.filter(
    (conn) =>
      conn.sourceNodeId !== conn.targetNodeId
      && nodeById.has(conn.sourceNodeId)
      && nodeById.has(conn.targetNodeId),
  );

  // Build undirected adjacency for connected-component partitioning
  const undirected = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    undirected.set(node.id, new Set());
  }
  for (const conn of validConnections) {
    undirected.get(conn.sourceNodeId)!.add(conn.targetNodeId);
    undirected.get(conn.targetNodeId)!.add(conn.sourceNodeId);
  }

  const visitedGlobal = new Set<string>();
  const connectedComponents: LogicNode[][] = [];
  const isolatedNodes: LogicNode[] = [];

  for (const node of graph.nodes) {
    if (visitedGlobal.has(node.id)) continue;
    const queue = [node.id];
    visitedGlobal.add(node.id);
    const component: LogicNode[] = [];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      component.push(nodeById.get(currentId)!);
      for (const neighborId of undirected.get(currentId) ?? []) {
        if (!visitedGlobal.has(neighborId)) {
          visitedGlobal.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    if (component.length === 1) {
      isolatedNodes.push(component[0]);
    } else {
      connectedComponents.push(component);
    }
  }

  // Sort connected components: source/event-driven flows first, then larger flows, then top-most
  connectedComponents.sort((compA, compB) => {
    const aHasEvent = compA.some((n) => {
      const cat = getLogicNodeCategory(n.type);
      return cat === 'source' || cat === 'event';
    }) ? 0 : 1;
    const bHasEvent = compB.some((n) => {
      const cat = getLogicNodeCategory(n.type);
      return cat === 'source' || cat === 'event';
    }) ? 0 : 1;
    if (aHasEvent !== bHasEvent) return aHasEvent - bHasEvent;
    if (compB.length !== compA.length) return compB.length - compA.length;
    const aMinY = Math.min(...compA.map((n) => n.y));
    const bMinY = Math.min(...compB.map((n) => n.y));
    if (aMinY !== bMinY) return aMinY - bMinY;
    const aMinIdx = Math.min(...compA.map((n) => originalOrder.get(n.id) ?? 0));
    const bMinIdx = Math.min(...compB.map((n) => originalOrder.get(n.id) ?? 0));
    return aMinIdx - bMinIdx;
  });

  const colStep = LOGIC_NODE_WIDTH + AUTO_ARRANGE_COL_GAP;
  const placedPositions = new Map<string, LogicPoint>();
  let cursorY = AUTO_ARRANGE_START_Y;

  for (const component of connectedComponents) {
    const compIds = new Set(component.map((n) => n.id));
    const compConns = validConnections.filter(
      (c) => compIds.has(c.sourceNodeId) && compIds.has(c.targetNodeId),
    );

    // Directed adjacency (deduplicated pairs for topological layering)
    const rawOut = new Map<string, string[]>();
    const rawInCount = new Map<string, number>();
    for (const node of component) {
      rawOut.set(node.id, []);
      rawInCount.set(node.id, 0);
    }
    const seenPairs = new Set<string>();
    for (const conn of compConns) {
      const key = `${conn.sourceNodeId}->${conn.targetNodeId}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      rawOut.get(conn.sourceNodeId)!.push(conn.targetNodeId);
      rawInCount.set(conn.targetNodeId, (rawInCount.get(conn.targetNodeId) ?? 0) + 1);
    }

    // Order roots deterministically so cycle breaking prefers natural event/leftmost roots
    const orderedNodes = [...component].sort((a, b) => {
      const aRoot = (rawInCount.get(a.id) ?? 0) === 0 ? 0 : 1;
      const bRoot = (rawInCount.get(b.id) ?? 0) === 0 ? 0 : 1;
      if (aRoot !== bRoot) return aRoot - bRoot;
      return compareNodesForLayout(a, b);
    });

    // Break cycles via DFS back-edge detection to obtain a clean DAG
    const dfsVisited = new Set<string>();
    const dfsOnStack = new Set<string>();
    const dagOut = new Map<string, string[]>();
    const dagIn = new Map<string, string[]>();
    for (const node of component) {
      dagOut.set(node.id, []);
      dagIn.set(node.id, []);
    }

    const dfs = (u: string) => {
      dfsVisited.add(u);
      dfsOnStack.add(u);
      const targets = [...(rawOut.get(u) ?? [])].sort((aId, bId) =>
        compareNodesForLayout(nodeById.get(aId)!, nodeById.get(bId)!),
      );
      for (const v of targets) {
        if (dfsOnStack.has(v)) {
          // Back-edge creates a cycle; omit from DAG ranking while preserving connection
          continue;
        }
        dagOut.get(u)!.push(v);
        dagIn.get(v)!.push(u);
        if (!dfsVisited.has(v)) {
          dfs(v);
        }
      }
      dfsOnStack.delete(u);
    };

    for (const node of orderedNodes) {
      if (!dfsVisited.has(node.id)) {
        dfs(node.id);
      }
    }

    // Kahn topological sort + longest-path column assignment
    const inDeg = new Map<string, number>();
    const colOf = new Map<string, number>();
    const queue: string[] = [];
    for (const node of orderedNodes) {
      const deg = dagIn.get(node.id)!.length;
      inDeg.set(node.id, deg);
      colOf.set(node.id, 0);
      if (deg === 0) queue.push(node.id);
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      topoOrder.push(u);
      const nextCol = (colOf.get(u) ?? 0) + 1;
      for (const v of dagOut.get(u) ?? []) {
        if (nextCol > (colOf.get(v) ?? 0)) {
          colOf.set(v, nextCol);
        }
        const rem = (inDeg.get(v) ?? 1) - 1;
        inDeg.set(v, rem);
        if (rem === 0) {
          queue.push(v);
        }
      }
    }

    // Identify nodes reachable from event roots so pure upstream data chains can
    // sit directly to the left of their consumers instead of stranded at col 0.
    const eventReachable = new Set<string>();
    const evQueue: string[] = [];
    for (const node of component) {
      const cat = getLogicNodeCategory(node.type);
      if (cat === 'source' || cat === 'event') {
        eventReachable.add(node.id);
        evQueue.push(node.id);
      }
    }
    while (evQueue.length > 0) {
      const u = evQueue.shift()!;
      for (const v of dagOut.get(u) ?? []) {
        if (!eventReachable.has(v)) {
          eventReachable.add(v);
          evQueue.push(v);
        }
      }
    }

    if (eventReachable.size > 0) {
      for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
        const u = topoOrder[i];
        if (eventReachable.has(u)) continue;
        const consumers = dagOut.get(u) ?? [];
        if (consumers.length === 0) continue;
        const minConsumerCol = Math.min(...consumers.map((v) => colOf.get(v) ?? 0));
        colOf.set(u, minConsumerCol - 1);
      }
      const minCol = Math.min(...component.map((n) => colOf.get(n.id) ?? 0));
      if (minCol < 0) {
        for (const node of component) {
          colOf.set(node.id, (colOf.get(node.id) ?? 0) - minCol);
        }
      }
    }

    // Group nodes into columns
    const maxCol = Math.max(...component.map((n) => colOf.get(n.id) ?? 0));
    const columns: LogicNode[][] = Array.from({ length: maxCol + 1 }, () => []);
    for (const node of component) {
      columns[colOf.get(node.id) ?? 0].push(node);
    }

    // Index incoming connections per node for barycenter crossing reduction
    const incomingConns = new Map<string, LogicConnection[]>();
    for (const node of component) {
      incomingConns.set(node.id, []);
    }
    for (const conn of compConns) {
      if ((colOf.get(conn.sourceNodeId) ?? 0) < (colOf.get(conn.targetNodeId) ?? 0)) {
        incomingConns.get(conn.targetNodeId)!.push(conn);
      }
    }

    // Sort column 0 naturally, then sort each subsequent column by predecessor barycenter
    const rowIndexOf = new Map<string, number>();
    columns[0].sort(compareNodesForLayout);
    columns[0].forEach((n, idx) => rowIndexOf.set(n.id, idx));

    for (let c = 1; c <= maxCol; c += 1) {
      const scoreOf = new Map<string, number>();
      for (const node of columns[c]) {
        const inList = incomingConns.get(node.id) ?? [];
        if (inList.length === 0) {
          // Pure upstream data providers placed neatly below the main execution spine
          const catScore = AUTO_ARRANGE_CATEGORY_ORDER[getLogicNodeCategory(node.type)];
          scoreOf.set(node.id, 1000 + catScore * 10 + (originalOrder.get(node.id) ?? 0) * 0.01);
        } else {
          let sum = 0;
          for (const conn of inList) {
            const srcNode = nodeById.get(conn.sourceNodeId)!;
            const srcRow = rowIndexOf.get(conn.sourceNodeId) ?? 0;
            const portOffset = getSourcePortSortIndex(srcNode, conn.sourcePortId) * 0.15;
            sum += srcRow + portOffset;
          }
          scoreOf.set(node.id, sum / inList.length);
        }
      }
      columns[c].sort((a, b) => {
        const diff = (scoreOf.get(a.id) ?? 0) - (scoreOf.get(b.id) ?? 0);
        if (Math.abs(diff) > 1e-6) return diff;
        return compareNodesForLayout(a, b);
      });
      columns[c].forEach((n, idx) => rowIndexOf.set(n.id, idx));
    }

    // Compute exact column heights and vertically center shorter columns within the component
    const columnHeights = columns.map((colNodes) => {
      if (colNodes.length === 0) return 0;
      const sumH = colNodes.reduce((acc, n) => acc + getLogicNodeHeight(n), 0);
      return sumH + (colNodes.length - 1) * AUTO_ARRANGE_ROW_GAP;
    });
    const componentHeight = Math.max(...columnHeights, 0);

    for (let c = 0; c <= maxCol; c += 1) {
      const colNodes = columns[c];
      if (colNodes.length === 0) continue;
      let y = cursorY + Math.round((componentHeight - columnHeights[c]) / 2);
      const x = AUTO_ARRANGE_START_X + c * colStep;
      for (const node of colNodes) {
        placedPositions.set(node.id, { x: Math.round(x), y: Math.round(y) });
        y += getLogicNodeHeight(node) + AUTO_ARRANGE_ROW_GAP;
      }
    }

    cursorY += componentHeight + AUTO_ARRANGE_COMPONENT_GAP;
  }

  // Place disconnected / isolated nodes in a clean multi-column grid below connected flows
  if (isolatedNodes.length > 0) {
    const sortedIsolated = [...isolatedNodes].sort(compareNodesForLayout);
    for (let i = 0; i < sortedIsolated.length; i += AUTO_ARRANGE_ISOLATED_COLS) {
      const rowNodes = sortedIsolated.slice(i, i + AUTO_ARRANGE_ISOLATED_COLS);
      let maxRowHeight = 0;
      rowNodes.forEach((node, colIdx) => {
        const x = AUTO_ARRANGE_START_X + colIdx * colStep;
        placedPositions.set(node.id, { x: Math.round(x), y: Math.round(cursorY) });
        maxRowHeight = Math.max(maxRowHeight, getLogicNodeHeight(node));
      });
      cursorY += maxRowHeight + AUTO_ARRANGE_ROW_GAP;
    }
  }

  // Only mutate / bump updatedAt if at least one node actually moved
  let changed = false;
  const nextNodes = graph.nodes.map((node) => {
    const nextPos = placedPositions.get(node.id);
    if (!nextPos) return node;
    if (node.x !== nextPos.x || node.y !== nextPos.y) {
      changed = true;
      return { ...node, x: nextPos.x, y: nextPos.y };
    }
    return node;
  });

  if (!changed) return graph;
  return touchLogicGraph({ ...graph, nodes: nextNodes });
}

export const LOGIC_CATALOG_LIST = Object.freeze(
  PRIMARY_LOGIC_NODE_TYPES.map((type) => LOGIC_NODE_CATALOG[type]),
);

/**
 * Pure geometry, connection validation, immutable graph mutations, and starter
 * presets for Folio's Visual Node Logic Graph Editor (v1.1).
 *
 * Framework-independent and zero-DOM so every rule is fast, deterministic,
 * and directly unit-testable.
 */

import { createInitialProject } from '../../core/document/factory';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  DesignNode,
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
} from '../../core/document/types';
import {
  LOGIC_NODE_CATALOG,
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
import { createStarterHeroEntranceClip } from '../../engines/animation';

export const LOGIC_NODE_WIDTH = 232;
export const LOGIC_NODE_HEADER_HEIGHT = 38;
export const LOGIC_NODE_SUBTITLE_HEIGHT = 22;
export const LOGIC_PORT_ROW_HEIGHT = 26;
export const LOGIC_NODE_BODY_PAD_Y = 8;

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

export type LogicPresetId = 'click-counter' | 'toggle-visibility' | 'theme-switcher';

export interface LogicPresetMeta {
  readonly id: LogicPresetId;
  readonly name: string;
  readonly description: string;
}

export const LOGIC_PRESETS: readonly LogicPresetMeta[] = Object.freeze([
  {
    id: 'click-counter',
    name: 'Click Counter & Live Caption',
    description: 'Counts clicks on a target layer and formats live text output.',
  },
  {
    id: 'toggle-visibility',
    name: 'Toggle Layer Visibility',
    description: 'Shows or hides a target layer whenever the trigger element is clicked.',
  },
  {
    id: 'theme-switcher',
    name: 'Light / Dark Theme Switcher',
    description: 'Toggles a boolean theme flag and switches active Design Token themes.',
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

export function getLogicNodeHeight(node: Pick<LogicNode, 'type'>): number {
  const { inputs, outputs } = getLogicNodePorts(node.type);
  const rows = Math.max(1, inputs.length, outputs.length);
  return LOGIC_NODE_HEADER_HEIGHT + LOGIC_NODE_SUBTITLE_HEIGHT + LOGIC_NODE_BODY_PAD_Y * 2 + rows * LOGIC_PORT_ROW_HEIGHT;
}

export function getLogicPortLocalPosition(
  node: Pick<LogicNode, 'type'>,
  portId: string,
): LogicPoint | null {
  const { inputs, outputs } = getLogicNodePorts(node.type);
  const inIdx = inputs.findIndex((port) => port.id === portId);
  if (inIdx >= 0) {
    return {
      x: 0,
      y:
        LOGIC_NODE_HEADER_HEIGHT
        + LOGIC_NODE_SUBTITLE_HEIGHT
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
        + LOGIC_NODE_SUBTITLE_HEIGHT
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
): boolean {
  // Adding data edge source -> target creates a cycle iff source is reachable
  // by traversing existing data dependencies starting at sourceNodeId? Wait:
  // A dataflow edge means target depends on source (target -> source in dep graph).
  // Adding target -> source creates a cycle iff target is already reachable from source
  // along existing dependency edges (i.e. source already depends on target).
  const depsByNode = new Map<string, string[]>();
  for (const conn of graph.connections) {
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
      conn.sourceNodeId === sourceNode.id
      && conn.sourcePortId === sourcePort.id
      && conn.targetNodeId === targetNode.id
      && conn.targetPortId === targetPort.id,
  );
  if (duplicate) {
    return { ok: false, reason: 'These two ports are already connected.' };
  }

  if (targetPort.dataType !== 'exec' && wouldCreateDataflowCycle(graph, sourceNode.id, targetNode.id)) {
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

export function addVariableToGraph(
  graph: LogicGraph,
  args: { name: string; valueType: LogicValueType; initialValue: LogicVariableValue },
): { graph: LogicGraph; variable: LogicVariableDefinition } {
  const trimmedName = args.name.trim() || `var${(graph.variables?.length ?? 0) + 1}`;
  const variable = createLogicVariable({
    id: createLogicId('lvar'),
    name: trimmedName,
    valueType: args.valueType,
    initialValue: args.initialValue,
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
  patch: Partial<Pick<LogicVariableDefinition, 'name' | 'valueType' | 'initialValue'>>,
): LogicGraph {
  const currentVars = graph.variables ?? [];
  let changed = false;
  const nextVars = currentVars.map((variable) => {
    if (variable.id !== variableId) return variable;
    changed = true;
    const nextType = patch.valueType ?? variable.valueType;
    let nextInitial = patch.initialValue !== undefined ? patch.initialValue : variable.initialValue;
    if (patch.valueType && patch.valueType !== variable.valueType && patch.initialValue === undefined) {
      nextInitial = nextType === 'number' ? 0 : nextType === 'boolean' ? false : '';
    }
    return {
      ...variable,
      ...(patch.name !== undefined ? { name: patch.name.trim() || variable.name } : {}),
      valueType: nextType,
      initialValue: nextInitial,
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
  const padding = 56;
  const contentW = Math.max(120, maxX - minX);
  const contentH = Math.max(100, maxY - minY);
  const rawZoom = Math.min(
    (viewportWidth - padding * 2) / contentW,
    (viewportHeight - padding * 2) / contentH,
  );
  const zoom = Math.max(0.25, Math.min(1.15, Math.round(rawZoom * 100) / 100));
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
    case 'event.on-click':
      return findNodeName(node.data.targetNodeId);
    case 'event.on-hover':
      return `${findNodeName(node.data.targetNodeId)} · ${node.data.phase === 'leave' ? 'leave' : 'enter'}`;
    case 'event.on-page-load':
      return 'Page mount';
    case 'event.on-state-change':
    case 'state.get':
    case 'state.toggle':
      return findVarName(node.data.variableId);
    case 'state.set':
      return `${findVarName(node.data.variableId)} = ${node.data.value === null || node.data.value === undefined ? 'input' : String(node.data.value)}`;
    case 'state.increment':
      return `${findVarName(node.data.variableId)} ${Number(node.data.step ?? 1) >= 0 ? '+' : ''}${String(node.data.step ?? 1)}`;
    case 'logic.branch':
      return 'If condition → True / False';
    case 'logic.compare':
      return `Left ${String(node.data.operator ?? '==')} Right`;
    case 'logic.template':
      return String(node.data.template ?? '{{value}}').slice(0, 28) || 'Empty template';
    case 'action.set-visible':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.mode ?? 'toggle')}`;
    case 'action.set-text':
      return findNodeName(node.data.targetNodeId);
    case 'action.set-fill':
      return `${findNodeName(node.data.targetNodeId)} · ${String(node.data.fill ?? '')}`;
    case 'action.set-variant':
      return findNodeName(node.data.targetNodeId);
    case 'action.navigate':
      return String(node.data.route ?? '/');
    case 'action.set-theme': {
      const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
      return themes.find((t) => t.id === themeId)?.name ?? (themeId || 'Unbound theme');
    }
    case 'action.play-animation': {
      const clipId = typeof node.data.clipId === 'string' ? node.data.clipId : '';
      return animations.find((clip) => clip.id === clipId)?.name ?? (clipId || 'Unbound clip');
    }
    default:
      return node.type;
  }
}

/**
 * Builds the default interactive starter logic graph wired directly to the
 * starter Main Page layers (`Visual card`, `Sun`, and `Card caption`).
 */
export function createStarterMainPageLogicGraph(page: FolioPage): LogicGraph | null {
  const visualCard = page.document.nodes.find((n) => n.name === 'Visual card')
    ?? page.document.nodes.find((n) => n.type === 'rect' || n.type === 'frame');
  const sun = page.document.nodes.find((n) => n.name === 'Sun')
    ?? page.document.nodes.find((n) => n.type === 'ellipse');
  const caption = page.document.nodes.find((n) => n.name === 'Card caption')
    ?? page.document.nodes.find((n) => n.type === 'text');

  if (!visualCard || !caption) return null;

  const varClicks = createLogicVariable({
    id: 'var-starter-clicks',
    name: 'clickCount',
    valueType: 'number',
    initialValue: 0,
    description: 'Tracks clicks on the starter artwork card.',
  });
  const varAccent = createLogicVariable({
    id: 'var-starter-accent',
    name: 'accentActive',
    valueType: 'boolean',
    initialValue: false,
    description: 'Toggles the Sun accent highlight on each click.',
  });

  const onClick = createLogicNode({
    id: 'lnode-starter-click',
    type: 'event.on-click',
    x: 40,
    y: 72,
    data: { targetNodeId: visualCard.id },
  });
  const incCount = createLogicNode({
    id: 'lnode-starter-inc',
    type: 'state.increment',
    x: 320,
    y: 44,
    data: { variableId: varClicks.id, step: 1, min: 0, max: 999 },
  });
  const toggleAccent = createLogicNode({
    id: 'lnode-starter-toggle',
    type: 'state.toggle',
    x: 600,
    y: 44,
    data: { variableId: varAccent.id },
  });
  const template = createLogicNode({
    id: 'lnode-starter-tpl',
    type: 'logic.template',
    x: 600,
    y: 230,
    data: { template: 'INTERACTIONS  ·  {{clickCount}}' },
  });
  const setCaption = createLogicNode({
    id: 'lnode-starter-text',
    type: 'action.set-text',
    x: 890,
    y: 72,
    data: { targetNodeId: caption.id, text: '' },
  });

  const nodes: LogicNode[] = [onClick, incCount, toggleAccent, template, setCaption];
  const connections: LogicConnection[] = [
    createLogicConnection({
      id: 'lconn-starter-1',
      sourceNodeId: onClick.id,
      sourcePortId: 'exec',
      targetNodeId: incCount.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-2',
      sourceNodeId: incCount.id,
      sourcePortId: 'next',
      targetNodeId: toggleAccent.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-3',
      sourceNodeId: toggleAccent.id,
      sourcePortId: 'next',
      targetNodeId: setCaption.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-4',
      sourceNodeId: template.id,
      sourcePortId: 'text',
      targetNodeId: setCaption.id,
      targetPortId: 'text',
    }),
  ];

  if (sun) {
    const getAccent = createLogicNode({
      id: 'lnode-starter-get-accent',
      type: 'state.get',
      x: 890,
      y: 248,
      data: { variableId: varAccent.id },
    });
    const branch = createLogicNode({
      id: 'lnode-starter-branch',
      type: 'logic.branch',
      x: 1170,
      y: 72,
      data: { condition: false },
    });
    const fillIndigo = createLogicNode({
      id: 'lnode-starter-fill-indigo',
      type: 'action.set-fill',
      x: 1450,
      y: 20,
      data: { targetNodeId: sun.id, fill: '#8B7CF6' },
    });
    const fillAmber = createLogicNode({
      id: 'lnode-starter-fill-amber',
      type: 'action.set-fill',
      x: 1450,
      y: 196,
      data: { targetNodeId: sun.id, fill: '#F4B27D' },
    });

    nodes.push(getAccent, branch, fillIndigo, fillAmber);
    connections.push(
      createLogicConnection({
        id: 'lconn-starter-5',
        sourceNodeId: setCaption.id,
        sourcePortId: 'next',
        targetNodeId: branch.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'lconn-starter-6',
        sourceNodeId: getAccent.id,
        sourcePortId: 'value',
        targetNodeId: branch.id,
        targetPortId: 'condition',
      }),
      createLogicConnection({
        id: 'lconn-starter-7',
        sourceNodeId: branch.id,
        sourcePortId: 'true',
        targetNodeId: fillIndigo.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'lconn-starter-8',
        sourceNodeId: branch.id,
        sourcePortId: 'false',
        targetNodeId: fillAmber.id,
        targetPortId: 'exec',
      }),
    );
  }

  return createLogicGraph({
    id: 'logic-graph-starter-main',
    name: 'Main Page Interactions',
    scope: 'page',
    targetId: page.id,
    variables: [varClicks, varAccent],
    nodes,
    connections,
  });
}

/**
 * Creates the default interactive starter project for first-launch Folio Studio
 * sessions while keeping `createInitialProject()` untouched for unit tests.
 */
export function createInteractiveStarterProject(name = 'First canvas'): FolioProject {
  const project = createInitialProject(name);
  const page = getActivePage(project);
  const starterGraph = createStarterMainPageLogicGraph(page);
  const starterClip = createStarterHeroEntranceClip(page);
  return {
    ...project,
    ...(starterGraph ? { logicGraphs: [starterGraph] } : {}),
    ...(starterClip.tracks.length > 0 ? { animations: [starterClip] } : {}),
  };
}

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
      data: { targetNodeId: firstInteractive?.id ?? '' },
    });
    const toggleVis = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.set-visible',
      x: 340,
      y: 96,
      data: { targetNodeId: secondLayer?.id ?? '', mode: 'toggle' },
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
    });
    const trigger = createLogicNode({
      id: createLogicId('lnode'),
      type: 'event.on-click',
      x: 40,
      y: 88,
      data: { targetNodeId: firstInteractive?.id ?? '' },
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
      data: { condition: false },
    });
    const setDark = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.set-theme',
      x: 900,
      y: 28,
      data: { themeId: darkTheme },
    });
    const setLight = createLogicNode({
      id: createLogicId('lnode'),
      type: 'action.set-theme',
      x: 900,
      y: 190,
      data: { themeId: lightTheme },
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

  // Default: click-counter
  const varCount = createLogicVariable({
    id: createLogicId('lvar'),
    name: 'counter',
    valueType: 'number',
    initialValue: 0,
  });
  const trigger = createLogicNode({
    id: createLogicId('lnode'),
    type: 'event.on-click',
    x: 40,
    y: 84,
    data: { targetNodeId: firstInteractive?.id ?? '' },
  });
  const inc = createLogicNode({
    id: createLogicId('lnode'),
    type: 'state.increment',
    x: 320,
    y: 64,
    data: { variableId: varCount.id, step: 1, min: 0, max: 999 },
  });
  const tpl = createLogicNode({
    id: createLogicId('lnode'),
    type: 'logic.template',
    x: 320,
    y: 236,
    data: { template: 'Clicked {{counter}} times' },
  });
  const setText = createLogicNode({
    id: createLogicId('lnode'),
    type: 'action.set-text',
    x: 620,
    y: 84,
    data: { targetNodeId: firstText?.id ?? '', text: '' },
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
        targetPortId: 'text',
      }),
    ],
  });
}

export const LOGIC_CATALOG_LIST = Object.freeze(Object.values(LOGIC_NODE_CATALOG));

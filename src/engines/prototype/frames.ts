/**
 * Folio Node Logic — Smart Logic Frame Engine (Grouping + Function Baking + Reusable Presets).
 *
 * Pure, framework-independent, deterministic engine module shared by:
 * - Node Logic Editor UI (`NodeLogicWorkspace.tsx`, `NodeLogicInspector.tsx`)
 * - Semantic Validator (`validator.ts`)
 * - Headless Prototype Runtime (`runtime.ts`)
 * - Live Preview Codegen (`codegen.ts`)
 * - Unit Tests (`tests/nodeLogicFrames.test.ts`)
 */

import {
  sanitizeLogicFramePresetNetworkSecrets,
  sanitizeLogicNodeDataRecord,
} from '../../core/document/networkSecrets';
import type {
  FolioProject,
  LogicConnection,
  LogicFrame,
  LogicFrameBakedData,
  LogicFrameBounds,
  LogicFrameCompiledDataInput,
  LogicFrameCompiledEdge,
  LogicFrameCompiledPlan,
  LogicFrameCompiledStep,
  LogicFrameExposedInput,
  LogicFrameExposedOutput,
  LogicFrameExposedParam,
  LogicFrameExposedParamType,
  LogicFramePreset,
  LogicGraph,
  LogicNode,
} from '../../core/document/types';
import {
  getLogicNodeDefinition,
  getLogicNodePort,
  type LogicPortDataType,
  type LogicPortDefinition,
} from './catalog';
import {
  PIPELINE_REF_DATA_KEYS,
  getNodeTargetMode,
  parsePipelineRef,
} from './pipeline';
import {
  validateLogicGraphSemantics,
  type LogicDiagnostic,
} from './validator';

export interface LogicFrameColorPreset {
  readonly id: string;
  readonly label: string;
  readonly accent: string;
  readonly bg: string;
  readonly border: string;
}

export const LOGIC_FRAME_COLORS: readonly LogicFrameColorPreset[] = Object.freeze([
  { id: 'teal', label: 'Teal', accent: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.08)', border: 'rgba(45, 212, 191, 0.42)' },
  { id: 'violet', label: 'Violet', accent: '#a78bfa', bg: 'rgba(167, 139, 250, 0.09)', border: 'rgba(167, 139, 250, 0.44)' },
  { id: 'blue', label: 'Blue', accent: '#60a5fa', bg: 'rgba(96, 165, 250, 0.08)', border: 'rgba(96, 165, 250, 0.42)' },
  { id: 'amber', label: 'Amber', accent: '#fbbf24', bg: 'rgba(251, 191, 36, 0.08)', border: 'rgba(251, 191, 36, 0.42)' },
  { id: 'emerald', label: 'Emerald', accent: '#34d399', bg: 'rgba(52, 211, 153, 0.08)', border: 'rgba(52, 211, 153, 0.42)' },
  { id: 'rose', label: 'Rose', accent: '#fb7185', bg: 'rgba(251, 113, 133, 0.08)', border: 'rgba(251, 113, 133, 0.42)' },
]);

export const LOGIC_FRAME_HEADER_HEIGHT = 34;
export const LOGIC_FRAME_PADDING_X = 28;
export const LOGIC_FRAME_PADDING_TOP = 54;
export const LOGIC_FRAME_PADDING_BOTTOM = 28;
export const LOGIC_FRAME_MIN_WIDTH = 300;
export const LOGIC_FRAME_MIN_HEIGHT = 190;
export const BAKED_FRAME_NODE_WIDTH = 264;

const DEFAULT_LOGIC_NODE_WIDTH = 228;
const DEFAULT_LOGIC_NODE_HEIGHT = 148;

const ACTION_NODE_TYPES_WITH_TARGET = new Set<string>([
  'action.set-layer',
  'action.set-visible',
  'action.set-text',
  'action.set-fill',
  'action.set-variant',
  'action.media-animation',
  'action.play-animation',
]);

let frameIdCounter = 0;

export function createLogicFrameId(prefix: 'lframe' | 'lfpreset' | 'lnode' | 'lconn' | 'fparam' = 'lframe'): string {
  frameIdCounter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}-${frameIdCounter.toString(36)}-${rand}`;
}

export function getLogicFrameColorPreset(colorIdOrHex: string): LogicFrameColorPreset {
  const normalized = colorIdOrHex.trim().toLowerCase();
  return (
    LOGIC_FRAME_COLORS.find((item) => item.id === normalized || item.accent.toLowerCase() === normalized)
    ?? LOGIC_FRAME_COLORS[0]
  );
}

function getPortsForNodeType(nodeType: string): {
  readonly inputs: readonly LogicPortDefinition[];
  readonly outputs: readonly LogicPortDefinition[];
} {
  const ports = getLogicNodeDefinition(nodeType)?.ports ?? [];
  return {
    inputs: ports.filter((p) => p.direction === 'in'),
    outputs: ports.filter((p) => p.direction === 'out'),
  };
}

export function estimateLogicNodeHeightForFrame(node: LogicNode): number {
  const { inputs, outputs } = getPortsForNodeType(node.type);
  const rowCount = Math.max(1, inputs.length, outputs.length);
  return 34 + 30 + rowCount * 28 + 14;
}

export function computeFrameBoundsFromNodes(
  nodes: readonly LogicNode[],
  childNodeIds: readonly string[],
  fallbackOrigin: { x: number; y: number } = { x: 80, y: 80 },
): LogicFrameBounds {
  const idSet = new Set(childNodeIds);
  const members = nodes.filter((n) => idSet.has(n.id));
  if (members.length === 0) {
    return {
      x: Math.round(fallbackOrigin.x),
      y: Math.round(fallbackOrigin.y),
      width: LOGIC_FRAME_MIN_WIDTH,
      height: LOGIC_FRAME_MIN_HEIGHT,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of members) {
    const h = estimateLogicNodeHeightForFrame(node) || DEFAULT_LOGIC_NODE_HEIGHT;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + DEFAULT_LOGIC_NODE_WIDTH);
    maxY = Math.max(maxY, node.y + h);
  }
  const x = Math.round(minX - LOGIC_FRAME_PADDING_X);
  const y = Math.round(minY - LOGIC_FRAME_PADDING_TOP);
  const width = Math.max(LOGIC_FRAME_MIN_WIDTH, Math.round(maxX - minX + LOGIC_FRAME_PADDING_X * 2));
  const height = Math.max(
    LOGIC_FRAME_MIN_HEIGHT,
    Math.round(maxY - minY + LOGIC_FRAME_PADDING_TOP + LOGIC_FRAME_PADDING_BOTTOM),
  );
  return { x, y, width, height };
}

export function isNodeCenterInsideFrame(node: LogicNode, bounds: LogicFrameBounds): boolean {
  const cx = node.x + DEFAULT_LOGIC_NODE_WIDTH / 2;
  const cy = node.y + estimateLogicNodeHeightForFrame(node) / 2;
  return (
    cx >= bounds.x &&
    cx <= bounds.x + bounds.width &&
    cy >= bounds.y &&
    cy <= bounds.y + bounds.height
  );
}

export interface ExposableFrameParamCandidate extends LogicFrameExposedParam {
  readonly nodeLabel: string;
  readonly currentValue: string | number | boolean | null;
  readonly selectOptions?: readonly { readonly value: string; readonly label: string }[];
}

function getBranchHintForNode(
  nodeId: string,
  childIdSet: ReadonlySet<string>,
  connections: readonly LogicConnection[],
  nodesById: ReadonlyMap<string, LogicNode>,
): string {
  for (const conn of connections) {
    if (conn.targetNodeId !== nodeId || !childIdSet.has(conn.sourceNodeId)) continue;
    const src = nodesById.get(conn.sourceNodeId);
    if (src?.type === 'logic.branch') {
      if (conn.sourcePortId === 'true') return 'True';
      if (conn.sourcePortId === 'false') return 'False';
      if (conn.sourcePortId === 'elseIf') return 'Else If';
    }
  }
  return '';
}

/**
 * Discovers editable parameters on nodes inside a Smart Logic Frame so users
 * can pin them into `exposedParams` and tweak them directly on a Baked Frame Node.
 */
export function getExposableParamsForFrame(
  graph: LogicGraph,
  frame: LogicFrame,
): readonly ExposableFrameParamCandidate[] {
  const childIdSet = new Set(frame.childNodeIds);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const candidates: ExposableFrameParamCandidate[] = [];

  // Count occurrences per node type for clean disambiguation
  const typeCounts = new Map<string, number>();
  for (const nid of frame.childNodeIds) {
    const n = nodesById.get(nid);
    if (!n) continue;
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);
  }
  const typeIndex = new Map<string, number>();

  for (const nid of frame.childNodeIds) {
    const node = nodesById.get(nid);
    if (!node) continue;
    const def = getLogicNodeDefinition(node.type);
    const baseLabel = def?.label ?? node.type;
    const idx = (typeIndex.get(node.type) ?? 0) + 1;
    typeIndex.set(node.type, idx);

    const branchHint = getBranchHintForNode(node.id, childIdSet, graph.connections, nodesById);
    const disambiguator = branchHint
      ? ` (${branchHint})`
      : (typeCounts.get(node.type) ?? 0) > 1
        ? ` #${idx}`
        : '';
    const nodeLabel = `${baseLabel}${disambiguator}`;

    const pushCandidate = (
      field: string,
      fieldLabel: string,
      type: LogicFrameExposedParamType,
      selectOptions?: readonly { readonly value: string; readonly label: string }[],
    ) => {
      candidates.push({
        paramId: `${node.id}:${field}`,
        nodeId: node.id,
        nodeLabel,
        field,
        label: `${nodeLabel} · ${fieldLabel}`,
        type,
        currentValue: node.data[field] ?? null,
        ...(selectOptions ? { selectOptions } : {}),
      });
    };

    switch (node.type) {
      case 'action.set-layer': {
        const prop = String(node.data.property ?? 'text');
        if (prop === 'fill') {
          pushCandidate('fill', 'Fill Color', 'color');
        } else if (prop === 'text') {
          pushCandidate('text', 'Text Content', 'string');
        } else if (prop === 'opacity') {
          pushCandidate('opacity', 'Opacity', 'number');
        } else if (prop === 'visible') {
          pushCandidate('visibleMode', 'Visibility', 'select', [
            { value: 'show', label: 'Show' },
            { value: 'hide', label: 'Hide' },
            { value: 'toggle', label: 'Toggle' },
          ]);
        } else if (prop === 'transform') {
          pushCandidate('transform', 'Transform', 'string');
        }
        pushCandidate('transitionMs', 'Transition (ms)', 'number');
        break;
      }
      case 'action.set-fill':
        pushCandidate('fill', 'Fill Color', 'color');
        break;
      case 'action.set-text':
        pushCandidate('text', 'Text Content', 'string');
        break;
      case 'action.set-visible':
        pushCandidate('mode', 'Visibility Mode', 'select', [
          { value: 'show', label: 'Show' },
          { value: 'hide', label: 'Hide' },
          { value: 'toggle', label: 'Toggle' },
        ]);
        break;
      case 'state.toggle':
        pushCandidate('initialValue', 'Initial State', 'boolean');
        break;
      case 'logic.branch':
        if (node.data.mode === 'switch-case') {
          pushCandidate('caseA', 'Case A', 'string');
          pushCandidate('caseB', 'Case B', 'string');
        } else {
          pushCandidate('condition', 'Default Condition', 'boolean');
        }
        break;
      case 'logic.condition':
      case 'logic.compare':
        pushCandidate('right', 'Compare Value', 'string');
        break;
      case 'logic.math':
        pushCandidate('b', 'Operand B', 'number');
        break;
      case 'logic.text':
      case 'logic.template':
        pushCandidate('template', 'Template', 'string');
        break;
      case 'action.overlay-toast':
        pushCandidate('message', 'Toast Message', 'string');
        pushCandidate('tone', 'Tone', 'select', [
          { value: 'info', label: 'Info' },
          { value: 'success', label: 'Success' },
          { value: 'warning', label: 'Warning' },
          { value: 'error', label: 'Error' },
        ]);
        break;
      case 'action.navigate':
        pushCandidate('route', 'Target Route / URL', 'string');
        break;
      case 'flow.delay':
        pushCandidate('duration', 'Delay Duration', 'number');
        break;
      default:
        break;
    }
  }

  return candidates;
}

/**
 * Detects any directed cycle (execution or dataflow) strictly within `childNodeIds`.
 */
export function detectFrameInternalCycle(
  graph: LogicGraph,
  childNodeIds: readonly string[],
): { readonly hasCycle: boolean; readonly cycleNodeIds: readonly string[] } {
  const childSet = new Set(childNodeIds);
  const adjacency = new Map<string, string[]>();
  for (const id of childSet) {
    adjacency.set(id, []);
  }
  for (const conn of graph.connections) {
    if (childSet.has(conn.sourceNodeId) && childSet.has(conn.targetNodeId)) {
      adjacency.get(conn.sourceNodeId)!.push(conn.targetNodeId);
    }
  }

  // 0 = unvisited, 1 = on recursion stack, 2 = completed
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const dfs = (nodeId: string): string[] | null => {
    state.set(nodeId, 1);
    stack.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      const nextState = state.get(nextId) ?? 0;
      if (nextState === 1) {
        const idx = stack.indexOf(nextId);
        return idx >= 0 ? [...stack.slice(idx), nextId] : [nodeId, nextId];
      }
      if (nextState === 0) {
        const found = dfs(nextId);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(nodeId, 2);
    return null;
  };

  for (const id of childNodeIds) {
    if ((state.get(id) ?? 0) === 0) {
      const cycle = dfs(id);
      if (cycle) {
        return { hasCycle: true, cycleNodeIds: cycle };
      }
    }
  }
  return { hasCycle: false, cycleNodeIds: [] };
}

export interface FrameBakeValidationResult {
  readonly ok: boolean;
  readonly errors: readonly LogicDiagnostic[];
  readonly warnings: readonly LogicDiagnostic[];
}

/**
 * Validates whether a Smart Logic Frame is safe to bake into a compiled function block.
 * - Blocks bake on empty frames, internal infinite cycles, or semantic errors on internal nodes.
 * - Emits non-blocking portability warnings (`HARDCODED_LAYER_IN_FRAME`) when internal actions
 *   target hardcoded static layers instead of `Inherit from Pipeline`.
 */
export function validateFrameForBaking(
  graph: LogicGraph,
  frame: LogicFrame,
  project: FolioProject,
): FrameBakeValidationResult {
  const errors: LogicDiagnostic[] = [];
  const warnings: LogicDiagnostic[] = [];

  if (frame.childNodeIds.length === 0) {
    errors.push({
      severity: 'error',
      code: 'EMPTY_FRAME',
      message: `Frame "${frame.title}" has no nodes. Add at least one node before baking.`,
      graphId: graph.id,
      frameId: frame.id,
    });
    return { ok: false, errors, warnings };
  }

  const childSet = new Set(frame.childNodeIds);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Check for internal cycles across both exec & data wires
  const cycleCheck = detectFrameInternalCycle(graph, frame.childNodeIds);
  if (cycleCheck.hasCycle) {
    errors.push({
      severity: 'error',
      code: 'FRAME_INTERNAL_CYCLE',
      message: `Cannot bake "${frame.title}": infinite cycle detected inside frame (${cycleCheck.cycleNodeIds.join(' -> ')}).`,
      graphId: graph.id,
      frameId: frame.id,
      nodeId: cycleCheck.cycleNodeIds[0],
    });
  }

  // Determine whether frame has any external incoming wires (standalone reusable frame vs wired frame)
  const hasExternalIncoming = graph.connections.some(
    (conn) => !childSet.has(conn.sourceNodeId) && childSet.has(conn.targetNodeId),
  );

  // Run semantic graph validation and filter diagnostics belonging to this frame
  const graphReport = validateLogicGraphSemantics(graph, project);
  for (const diag of graphReport.diagnostics) {
    const belongsToNode = Boolean(diag.nodeId && childSet.has(diag.nodeId));
    const belongsToConn = Boolean(
      diag.connectionId &&
        graph.connections.some(
          (c) =>
            c.id === diag.connectionId &&
            (childSet.has(c.sourceNodeId) || childSet.has(c.targetNodeId)),
        ),
    );
    if (!belongsToNode && !belongsToConn) continue;

    // Standalone reusable frames using "Inherit from Pipeline" are valid to bake before being wired to an Event
    if (diag.code === 'DISCONNECTED_PIPELINE_ORIGIN' && !hasExternalIncoming) {
      continue;
    }

    const scopedDiag: LogicDiagnostic = { ...diag, frameId: frame.id };
    if (diag.severity === 'error') {
      errors.push(scopedDiag);
    } else {
      warnings.push(scopedDiag);
    }
  }

  // Portability check: warn if internal action nodes hardcode a static layer target instead of Pipeline inheritance
  for (const childId of frame.childNodeIds) {
    const node = nodesById.get(childId);
    if (!node || !ACTION_NODE_TYPES_WITH_TARGET.has(node.type)) continue;
    const mode = getNodeTargetMode(node);
    const staticTarget = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';
    if (mode !== 'pipeline' && staticTarget.length > 0) {
      const def = getLogicNodeDefinition(node.type);
      warnings.push({
        severity: 'warning',
        code: 'HARDCODED_LAYER_IN_FRAME',
        message: `"${def?.label ?? node.type}" inside "${frame.title}" targets a hardcoded layer instead of "Inherit from Pipeline". Switch to Pipeline mode for full Preset portability.`,
        graphId: graph.id,
        frameId: frame.id,
        nodeId: node.id,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Scans boundary wires entering/leaving `frame`, detects fallback standalone
 * entry/exit ports for reusable presets, and compiles a pre-computed flat
 * topological execution plan (`compiledPlan`).
 */
export function compileLogicFramePlan(
  graph: LogicGraph,
  frame: LogicFrame,
): LogicFrameBakedData {
  const childSet = new Set(frame.childNodeIds);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const internalNodes = frame.childNodeIds
    .map((id) => nodesById.get(id))
    .filter((n): n is LogicNode => Boolean(n));

  const exposedInputs: LogicFrameExposedInput[] = [];
  const exposedInputKeyToPortId = new Map<string, string>();
  const exposedOutputs: LogicFrameExposedOutput[] = [];
  const exposedOutputKeyToPortId = new Map<string, string>();

  const registerExposedInput = (
    targetNode: LogicNode,
    targetPortId: string,
    portLabel: string,
    dataType: LogicPortDataType,
  ): string => {
    const key = `${targetNode.id}:${targetPortId}`;
    const existing = exposedInputKeyToPortId.get(key);
    if (existing) return existing;
    const kind: 'exec' | 'data' = dataType === 'exec' ? 'exec' : 'data';
    const portId = `in_${exposedInputs.length + 1}_${targetPortId}`;
    const def = getLogicNodeDefinition(targetNode.type);
    const label =
      kind === 'exec'
        ? (exposedInputs.filter((item) => item.kind === 'exec').length === 0
            ? `In (${def?.label ?? targetNode.type})`
            : `${def?.label ?? targetNode.type}.${portLabel}`)
        : `${def?.label ?? targetNode.type} · ${portLabel}`;
    exposedInputs.push({
      portId,
      targetNodeId: targetNode.id,
      targetPort: targetPortId,
      label,
      kind,
      dataType,
    });
    exposedInputKeyToPortId.set(key, portId);
    return portId;
  };

  const registerExposedOutput = (
    sourceNode: LogicNode,
    sourcePortId: string,
    portLabel: string,
    dataType: LogicPortDataType,
  ): string => {
    const key = `${sourceNode.id}:${sourcePortId}`;
    const existing = exposedOutputKeyToPortId.get(key);
    if (existing) return existing;
    const kind: 'exec' | 'data' = dataType === 'exec' ? 'exec' : 'data';
    const portId = `out_${exposedOutputs.length + 1}_${sourcePortId}`;
    const def = getLogicNodeDefinition(sourceNode.type);
    const label =
      kind === 'exec'
        ? `${def?.label ?? sourceNode.type} · ${portLabel}`
        : `${def?.label ?? sourceNode.type} · ${portLabel}`;
    exposedOutputs.push({
      portId,
      sourceNodeId: sourceNode.id,
      sourcePort: sourcePortId,
      label,
      kind,
      dataType,
    });
    exposedOutputKeyToPortId.set(key, portId);
    return portId;
  };

  // 1. Auto-boundary wire detection
  const internalConnections: LogicConnection[] = [];
  for (const conn of graph.connections) {
    const srcIn = childSet.has(conn.sourceNodeId);
    const tgtIn = childSet.has(conn.targetNodeId);
    if (srcIn && tgtIn) {
      internalConnections.push(conn);
      continue;
    }
    if (!srcIn && tgtIn) {
      const targetNode = nodesById.get(conn.targetNodeId);
      if (!targetNode) continue;
      const portDef = getLogicNodePort(targetNode.type, conn.targetPortId);
      registerExposedInput(
        targetNode,
        conn.targetPortId,
        portDef?.label ?? conn.targetPortId,
        portDef?.dataType ?? 'exec',
      );
      continue;
    }
    if (srcIn && !tgtIn) {
      const sourceNode = nodesById.get(conn.sourceNodeId);
      if (!sourceNode) continue;
      const portDef = getLogicNodePort(sourceNode.type, conn.sourcePortId);
      registerExposedOutput(
        sourceNode,
        conn.sourcePortId,
        portDef?.label ?? conn.sourcePortId,
        portDef?.dataType ?? 'exec',
      );
    }
  }

  // 2. Fallback standalone entry/exit discovery so Baked Frames & Presets are ALWAYS wireable
  const internalIncomingExecTargets = new Set<string>();
  const internalOutgoingExecSources = new Set<string>();
  for (const conn of internalConnections) {
    const srcNode = nodesById.get(conn.sourceNodeId);
    const portDef = srcNode ? getLogicNodePort(srcNode.type, conn.sourcePortId) : undefined;
    if (!portDef || portDef.dataType === 'exec') {
      internalIncomingExecTargets.add(conn.targetNodeId);
      internalOutgoingExecSources.add(`${conn.sourceNodeId}:${conn.sourcePortId}`);
    }
  }

  const hasExecInput = exposedInputs.some((inp) => inp.kind === 'exec');
  if (!hasExecInput) {
    for (const node of internalNodes) {
      if (internalIncomingExecTargets.has(node.id)) continue;
      const { inputs } = getPortsForNodeType(node.type);
      const execIn = inputs.find((p) => p.dataType === 'exec');
      if (execIn) {
        registerExposedInput(node, execIn.id, execIn.label, 'exec');
      }
    }
  }

  const hasExecOutput = exposedOutputs.some((outp) => outp.kind === 'exec');
  if (!hasExecOutput) {
    for (const node of internalNodes) {
      const { outputs } = getPortsForNodeType(node.type);
      const execOuts = outputs.filter((p) => p.dataType === 'exec');
      for (const execOut of execOuts) {
        if (!internalOutgoingExecSources.has(`${node.id}:${execOut.id}`)) {
          registerExposedOutput(node, execOut.id, execOut.label, 'exec');
        }
      }
    }
  }

  // 3. Build topological order of internal nodes (Kahn's algorithm, deterministic tie-breaking)
  const inDegree = new Map<string, number>();
  const outNeighbors = new Map<string, string[]>();
  for (const node of internalNodes) {
    inDegree.set(node.id, 0);
    outNeighbors.set(node.id, []);
  }
  const seenEdgePair = new Set<string>();
  for (const conn of internalConnections) {
    const pair = `${conn.sourceNodeId}->${conn.targetNodeId}`;
    if (seenEdgePair.has(pair)) continue;
    seenEdgePair.add(pair);
    outNeighbors.get(conn.sourceNodeId)?.push(conn.targetNodeId);
    inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) ?? 0) + 1);
  }

  const readyQueue = internalNodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((n) => n.id);

  const topoIds: string[] = [];
  const placed = new Set<string>();
  while (readyQueue.length > 0) {
    const current = readyQueue.shift()!;
    if (placed.has(current)) continue;
    placed.add(current);
    topoIds.push(current);
    for (const nextId of outNeighbors.get(current) ?? []) {
      const rem = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, rem);
      if (rem === 0 && !placed.has(nextId)) {
        readyQueue.push(nextId);
      }
    }
  }
  for (const node of internalNodes) {
    if (!placed.has(node.id)) {
      topoIds.push(node.id);
    }
  }

  // 4. Construct flat compiled steps with pre-indexed internal exec/data routing & external exits
  const steps: LogicFrameCompiledStep[] = topoIds.map((nodeId, order) => {
    const nextByPort: Record<string, LogicFrameCompiledEdge[]> = {};
    const dataInputs: Record<string, LogicFrameCompiledDataInput> = {};
    const externalExitsByPort: Record<string, string[]> = {};

    for (const conn of internalConnections) {
      if (conn.sourceNodeId === nodeId) {
        const srcNode = nodesById.get(conn.sourceNodeId);
        const srcPort = srcNode ? getLogicNodePort(srcNode.type, conn.sourcePortId) : undefined;
        if (!srcPort || srcPort.dataType === 'exec') {
          const list = nextByPort[conn.sourcePortId] ?? [];
          list.push({ targetNodeId: conn.targetNodeId, targetPort: conn.targetPortId });
          nextByPort[conn.sourcePortId] = list;
        }
      }
      if (conn.targetNodeId === nodeId) {
        const tgtNode = nodesById.get(conn.targetNodeId);
        const tgtPort = tgtNode ? getLogicNodePort(tgtNode.type, conn.targetPortId) : undefined;
        if (tgtPort && tgtPort.dataType !== 'exec') {
          dataInputs[conn.targetPortId] = {
            sourceNodeId: conn.sourceNodeId,
            sourcePort: conn.sourcePortId,
          };
        }
      }
    }

    for (const outp of exposedOutputs) {
      if (outp.sourceNodeId === nodeId) {
        const list = externalExitsByPort[outp.sourcePort] ?? [];
        list.push(outp.portId);
        externalExitsByPort[outp.sourcePort] = list;
      }
    }

    return {
      nodeId,
      order,
      nextByPort,
      dataInputs,
      externalExitsByPort,
    };
  });

  const entryRoutes: Record<string, { targetNodeId: string; targetPort: string }> = {};
  for (const inp of exposedInputs) {
    entryRoutes[inp.portId] = {
      targetNodeId: inp.targetNodeId,
      targetPort: inp.targetPort,
    };
  }

  // Keep only pinned exposedParams referencing existing internal nodes
  const validExposedParams: LogicFrameExposedParam[] = (frame.exposedParams ?? [])
    .filter((param) => childSet.has(param.nodeId))
    .map((param) => ({ ...param }));

  const compiledPlan: LogicFrameCompiledPlan = {
    version: 1,
    internalNodeIds: [...topoIds],
    entryRoutes,
    steps,
  };

  return {
    exposedInputs,
    exposedOutputs,
    compiledPlan,
    exposedParams: validExposedParams,
    bakedAt: new Date().toISOString(),
  };
}

export type BakeLogicFrameResult =
  | {
      readonly ok: true;
      readonly graph: LogicGraph;
      readonly frame: LogicFrame;
      readonly warnings: readonly LogicDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly graph: LogicGraph;
      readonly errors: readonly LogicDiagnostic[];
      readonly warnings: readonly LogicDiagnostic[];
    };

/**
 * Validates and bakes a Smart Logic Frame in `graph`, compiling its internal
 * sub-graph into a flat `compiledPlan` and collapsing it into a single Baked Node.
 */
export function bakeLogicFrame(
  graph: LogicGraph,
  frameId: string,
  project: FolioProject,
): BakeLogicFrameResult {
  const frames = graph.frames ?? [];
  const targetFrame = frames.find((f) => f.id === frameId);
  if (!targetFrame) {
    return {
      ok: false,
      graph,
      errors: [
        {
          severity: 'error',
          code: 'MISSING_FRAME',
          message: `Logic frame "${frameId}" not found.`,
          graphId: graph.id,
          frameId,
        },
      ],
      warnings: [],
    };
  }

  const validation = validateFrameForBaking(graph, targetFrame, project);
  if (!validation.ok) {
    return {
      ok: false,
      graph,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const bakedData = compileLogicFramePlan(graph, targetFrame);
  const nextFrame: LogicFrame = {
    ...targetFrame,
    isBaked: true,
    exposedParams: bakedData.exposedParams,
    bakedData,
  };

  const nextGraph: LogicGraph = {
    ...graph,
    frames: frames.map((f) => (f.id === frameId ? nextFrame : f)),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    graph: nextGraph,
    frame: nextFrame,
    warnings: validation.warnings,
  };
}

/**
 * Unbakes a Smart Logic Frame, restoring full visual editing of all internal
 * nodes and wires at their original coordinates without losing pinned `exposedParams`.
 */
export function unbakeLogicFrame(graph: LogicGraph, frameId: string): LogicGraph {
  const frames = graph.frames ?? [];
  const target = frames.find((f) => f.id === frameId);
  if (!target || !target.isBaked) return graph;

  const restoredBounds = computeFrameBoundsFromNodes(graph.nodes, target.childNodeIds, {
    x: target.bounds.x,
    y: target.bounds.y,
  });

  const nextFrame: LogicFrame = {
    id: target.id,
    title: target.title,
    color: target.color,
    bounds: restoredBounds,
    childNodeIds: [...target.childNodeIds],
    isBaked: false,
    ...(target.exposedParams && target.exposedParams.length > 0
      ? { exposedParams: target.exposedParams.map((p) => ({ ...p })) }
      : target.bakedData?.exposedParams && target.bakedData.exposedParams.length > 0
        ? { exposedParams: target.bakedData.exposedParams.map((p) => ({ ...p })) }
        : {}),
  };

  return {
    ...graph,
    frames: frames.map((f) => (f.id === frameId ? nextFrame : f)),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Snapshots a Baked (or Unbaked) Smart Logic Frame into a self-contained,
 * portable `LogicFramePreset` that can be stored in `.flop` v2 and reused
 * across any graph or page.
 */
export function createLogicFramePresetFromFrame(
  graph: LogicGraph,
  frame: LogicFrame,
  presetName?: string,
  description?: string,
): LogicFramePreset {
  const childSet = new Set(frame.childNodeIds);
  const originX = frame.bounds.x;
  const originY = frame.bounds.y;

  const clonedNodes: LogicNode[] = graph.nodes
    .filter((node) => childSet.has(node.id))
    .map((node) => ({
      id: node.id,
      type: node.type,
      x: Math.round(node.x - originX),
      y: Math.round(node.y - originY),
      data: { ...sanitizeLogicNodeDataRecord(node.type, node.data) },
    }));

  const clonedConnections: LogicConnection[] = graph.connections
    .filter((conn) => childSet.has(conn.sourceNodeId) && childSet.has(conn.targetNodeId))
    .map((conn) => ({ ...conn }));

  const normalizedFrame: LogicFrame = {
    id: frame.id,
    title: (presetName ?? frame.title).trim() || frame.title,
    color: frame.color,
    bounds: {
      x: 0,
      y: 0,
      width: frame.bounds.width,
      height: frame.bounds.height,
    },
    childNodeIds: clonedNodes.map((n) => n.id),
    isBaked: true,
    exposedParams: (frame.exposedParams ?? frame.bakedData?.exposedParams ?? []).map((p) => ({ ...p })),
  };

  // Recompile clean self-contained bakedData (free of external-only wires from source graph)
  const tempGraph: LogicGraph = {
    ...graph,
    nodes: clonedNodes,
    connections: clonedConnections,
    frames: [normalizedFrame],
  };
  const compiledBakedData = compileLogicFramePlan(tempGraph, normalizedFrame);
  normalizedFrame.bakedData = compiledBakedData;

  const finalName = (presetName ?? frame.title).trim() || 'Baked Frame Preset';
  const paramSummary =
    compiledBakedData.exposedParams.length > 0
      ? ` · ${compiledBakedData.exposedParams.length} exposed param${compiledBakedData.exposedParams.length === 1 ? '' : 's'}`
      : '';

  return {
    id: createLogicFrameId('lfpreset'),
    name: finalName,
    description:
      description?.trim()
      || `${clonedNodes.length} baked node${clonedNodes.length === 1 ? '' : 's'}${paramSummary}`,
    color: frame.color,
    createdAt: new Date().toISOString(),
    frame: normalizedFrame,
    nodes: clonedNodes,
    connections: clonedConnections,
  };
}

function remapNodePipelineRefs(
  data: Record<string, string | number | boolean | null>,
  nodeIdMap: ReadonlyMap<string, string>,
): Record<string, string | number | boolean | null> {
  const next: Record<string, string | number | boolean | null> = { ...data };
  for (const key of PIPELINE_REF_DATA_KEYS) {
    const raw = next[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const parsed = parsePipelineRef(raw);
    if (parsed && parsed.kind === 'step') {
      const remapped = nodeIdMap.get(parsed.sourceNodeId);
      if (remapped) {
        next[key] = `step:${remapped}:${parsed.field}`;
      }
    }
  }
  return next;
}

/**
 * Deep-clones a saved `LogicFramePreset` into `graph` at `insertOrigin`,
 * regenerating ALL Frame, Node, Connection, ExposedParam, and internal
 * `step:<nodeId>:<field>` PipelineRef IDs so multiple instances on the same
 * page/graph remain 100% independent with isolated `privateMemory`.
 */
export function instantiateLogicFramePreset(
  graph: LogicGraph,
  preset: LogicFramePreset,
  insertOrigin: { x: number; y: number } = { x: 320, y: 120 },
): { readonly graph: LogicGraph; readonly frame: LogicFrame; readonly nodes: readonly LogicNode[] } {
  const offsetX = Math.round(insertOrigin.x);
  const offsetY = Math.round(insertOrigin.y);
  const nodeIdMap = new Map<string, string>();
  for (const oldNode of preset.nodes) {
    nodeIdMap.set(oldNode.id, createLogicFrameId('lnode'));
  }

  const newNodes: LogicNode[] = preset.nodes.map((oldNode) => ({
    id: nodeIdMap.get(oldNode.id)!,
    type: oldNode.type,
    x: Math.round(oldNode.x + offsetX),
    y: Math.round(oldNode.y + offsetY),
    data: remapNodePipelineRefs(oldNode.data, nodeIdMap),
  }));

  const newConnections: LogicConnection[] = preset.connections
    .filter((conn) => nodeIdMap.has(conn.sourceNodeId) && nodeIdMap.has(conn.targetNodeId))
    .map((conn) => ({
      id: createLogicFrameId('lconn'),
      sourceNodeId: nodeIdMap.get(conn.sourceNodeId)!,
      sourcePortId: conn.sourcePortId,
      targetNodeId: nodeIdMap.get(conn.targetNodeId)!,
      targetPortId: conn.targetPortId,
    }));

  const newFrameId = createLogicFrameId('lframe');
  const remappedExposedParams: LogicFrameExposedParam[] = (
    preset.frame.exposedParams ??
    preset.frame.bakedData?.exposedParams ??
    []
  )
    .filter((param) => nodeIdMap.has(param.nodeId))
    .map((param) => {
      const nextNodeId = nodeIdMap.get(param.nodeId)!;
      return {
        paramId: `${nextNodeId}:${param.field}`,
        nodeId: nextNodeId,
        field: param.field,
        label: param.label,
        type: param.type,
      };
    });

  const draftFrame: LogicFrame = {
    id: newFrameId,
    title: preset.name,
    color: preset.color,
    bounds: {
      x: offsetX,
      y: offsetY,
      width: preset.frame.bounds.width,
      height: preset.frame.bounds.height,
    },
    childNodeIds: newNodes.map((n) => n.id),
    isBaked: true,
    exposedParams: remappedExposedParams,
  };

  const mergedGraph: LogicGraph = {
    ...graph,
    nodes: [...graph.nodes, ...newNodes],
    connections: [...graph.connections, ...newConnections],
    frames: [...(graph.frames ?? []), draftFrame],
    updatedAt: new Date().toISOString(),
  };

  const compiledBakedData = compileLogicFramePlan(mergedGraph, draftFrame);
  const finalizedFrame: LogicFrame = {
    ...draftFrame,
    bakedData: compiledBakedData,
  };

  const finalGraph: LogicGraph = {
    ...mergedGraph,
    frames: (mergedGraph.frames ?? []).map((f) => (f.id === newFrameId ? finalizedFrame : f)),
  };

  return {
    graph: finalGraph,
    frame: finalizedFrame,
    nodes: newNodes,
  };
}

const FRAME_PRESETS_STORAGE_KEY = 'folio.nodeLogic.framePresets.v1';

export function loadStoredLogicFramePresets(): LogicFramePreset[] {
  try {
    if (typeof globalThis.localStorage === 'undefined') return [];
    const raw = globalThis.localStorage.getItem(FRAME_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is LogicFramePreset =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as LogicFramePreset).id === 'string' &&
          typeof (item as LogicFramePreset).name === 'string' &&
          Array.isArray((item as LogicFramePreset).nodes) &&
          Array.isArray((item as LogicFramePreset).connections),
      )
      .map((preset) => sanitizeLogicFramePresetNetworkSecrets(preset));
  } catch {
    return [];
  }
}

export function saveStoredLogicFramePresets(presets: readonly LogicFramePreset[]): void {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    const sanitized = presets.map((preset) => sanitizeLogicFramePresetNetworkSecrets(preset));
    globalThis.localStorage.setItem(FRAME_PRESETS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore quota or storage restriction errors cleanly
  }
}

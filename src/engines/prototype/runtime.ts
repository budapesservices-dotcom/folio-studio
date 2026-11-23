/**
 * Folio Node Logic v1 — Deterministic Headless Prototype Runtime.
 *
 * Pure TypeScript, zero-DOM, zero-`eval` execution engine for Folio Logic Graphs.
 * Guarantees deterministic evaluation, acyclic dataflow guards, finite execution
 * step budgets (preventing infinite loops), CSS/URL sanitization, and structured
 * execution traces shared as the behavioral reference for Live Preview & React.
 */

import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens, isSafeCssColorValue } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableValue,
} from '../../core/document/types';
import { sanitizeHref } from '../codegen/sanitize';
import { isBuiltInLogicNodeType, type LogicCompareOperator } from './catalog';

export const MAX_LOGIC_EXECUTION_STEPS = 256;
const HARD_MAX_EXECUTION_STEPS = 1024;

export type LogicNodeEventKind = 'click' | 'hover-enter' | 'hover-leave';

export interface PrototypeNodeOverride {
  visible?: boolean;
  text?: string;
  fill?: string;
  variantSelection?: Record<string, string>;
}

export interface LogicExecutionTraceEntry {
  readonly step: number;
  readonly graphId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly detail: string;
}

export interface PrototypeRuntimeSnapshot {
  readonly pageId: string;
  readonly activeRoute: string;
  readonly activeThemeId: string;
  readonly mounted: boolean;
  readonly stepCount: number;
  readonly variables: Readonly<Record<string, LogicVariableValue>>;
  readonly nodeOverrides: Readonly<Record<string, PrototypeNodeOverride>>;
  readonly playedAnimations: readonly string[];
  readonly trace: readonly LogicExecutionTraceEntry[];
  readonly warnings: readonly string[];
}

export interface PrototypeRuntimeOptions {
  pageId?: string;
  maxSteps?: number;
}

export interface PrototypeRuntime {
  mount(): PrototypeRuntimeSnapshot;
  dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind): PrototypeRuntimeSnapshot;
  setVariable(variableId: string, value: LogicVariableValue): PrototypeRuntimeSnapshot;
  reset(): PrototypeRuntimeSnapshot;
  getSnapshot(): PrototypeRuntimeSnapshot;
}

interface IndexedGraph {
  readonly graph: LogicGraph;
  readonly nodesById: Map<string, LogicNode>;
  readonly outgoingBySource: Map<string, LogicConnection[]>;
  readonly incomingByTarget: Map<string, LogicConnection[]>;
}

function clampStepBudget(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_LOGIC_EXECUTION_STEPS;
  return Math.max(1, Math.min(HARD_MAX_EXECUTION_STEPS, Math.floor(raw)));
}

function indexGraph(graph: LogicGraph): IndexedGraph {
  const nodesById = new Map<string, LogicNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
  }
  const outgoingBySource = new Map<string, LogicConnection[]>();
  const incomingByTarget = new Map<string, LogicConnection[]>();
  for (const conn of graph.connections) {
    const outKey = `${conn.sourceNodeId}:${conn.sourcePortId}`;
    const outList = outgoingBySource.get(outKey) ?? [];
    outList.push(conn);
    outgoingBySource.set(outKey, outList);

    const inKey = `${conn.targetNodeId}:${conn.targetPortId}`;
    const inList = incomingByTarget.get(inKey) ?? [];
    inList.push(conn);
    incomingByTarget.set(inKey, inList);
  }
  return { graph, nodesById, outgoingBySource, incomingByTarget };
}

function coerceVariableValue(
  raw: unknown,
  expectedType: LogicValueType,
  fallback: LogicVariableValue,
): LogicVariableValue {
  if (expectedType === 'string') {
    if (raw === null || raw === undefined) return '';
    return String(raw);
  }
  if (expectedType === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    return typeof fallback === 'number' ? fallback : 0;
  }
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
    return true;
  }
  return Boolean(raw);
}

/**
 * Safely interpolates `{{token}}` placeholders against declared runtime
 * variables and optional connected `value` input without using `eval`.
 */
export function interpolateLogicTemplate(
  template: string,
  variables: Readonly<Record<string, LogicVariableValue>>,
  variableNameToId: ReadonlyMap<string, string>,
  connectedValue?: unknown,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, rawKey: string) => {
    if (rawKey === 'value' && connectedValue !== undefined && connectedValue !== null) {
      return String(connectedValue);
    }
    if (Object.prototype.hasOwnProperty.call(variables, rawKey)) {
      return String(variables[rawKey]);
    }
    const mappedId = variableNameToId.get(rawKey) ?? variableNameToId.get(rawKey.toLowerCase());
    if (mappedId && Object.prototype.hasOwnProperty.call(variables, mappedId)) {
      return String(variables[mappedId]);
    }
    return '';
  });
}

function evaluateComparison(
  operator: LogicCompareOperator,
  left: unknown,
  right: unknown,
): boolean {
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
  }
}

export function getApplicableGraphsForPage(
  project: FolioProject,
  pageId: string,
): LogicGraph[] {
  return project.logicGraphs.filter(
    (graph) => graph.scope === 'project' || (graph.scope === 'page' && graph.targetId === pageId),
  );
}

export function createPrototypeRuntime(
  project: FolioProject,
  options: PrototypeRuntimeOptions = {},
): PrototypeRuntime {
  const initialPage: FolioPage =
    (options.pageId ? project.pages.find((item) => item.id === options.pageId) : undefined) ??
    getActivePage(project);
  const maxSteps = clampStepBudget(options.maxSteps);
  const tokens = getProjectDesignTokens(project);
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );
  const pagesById = new Map<string, FolioPage>(
    project.pages.map((page) => [page.id, page]),
  );
  const pagesByRoute = new Map<string, FolioPage>(
    project.pages.map((page) => [page.route, page]),
  );
  const themeIds = new Set(tokens.themes.map((theme) => theme.id));
  const animationsById = new Map((project.animations ?? []).map((clip) => [clip.id, clip]));

  let activePageId = initialPage.id;
  let activeRoute = initialPage.route;
  let activeThemeId = tokens.activeThemeId;
  let mounted = false;
  let totalSteps = 0;

  let indexedGraphs: IndexedGraph[] = [];
  let astNodesById = new Map<string, DesignNode>();
  let variableTypes = new Map<string, LogicValueType>();
  let variableNameToId = new Map<string, string>();
  let variables: Record<string, LogicVariableValue> = {};
  let nodeOverrides: Record<string, PrototypeNodeOverride> = {};
  let playedAnimations: string[] = [];
  let trace: LogicExecutionTraceEntry[] = [];
  let warnings: string[] = [];

  // Step-scoped output values produced by action/state/trigger nodes during one dispatch.
  let ephemeralNodeOutputs = new Map<string, unknown>();

  const loadPageContext = (page: FolioPage, preserveVariables: boolean) => {
    activePageId = page.id;
    activeRoute = page.route;
    astNodesById = new Map(page.document.nodes.map((node) => [node.id, node]));
    const applicable = getApplicableGraphsForPage(project, page.id);
    indexedGraphs = applicable.map(indexGraph);

    if (!preserveVariables) {
      variables = {};
      variableTypes = new Map();
      variableNameToId = new Map();
    }

    for (const entry of indexedGraphs) {
      for (const variable of entry.graph.variables ?? []) {
        variableTypes.set(variable.id, variable.valueType);
        variableNameToId.set(variable.name, variable.id);
        variableNameToId.set(variable.name.toLowerCase(), variable.id);
        if (!Object.prototype.hasOwnProperty.call(variables, variable.id)) {
          variables[variable.id] = variable.initialValue;
        }
      }
    }
  };

  const resetState = () => {
    activeThemeId = tokens.activeThemeId;
    mounted = false;
    totalSteps = 0;
    nodeOverrides = {};
    playedAnimations = [];
    trace = [];
    warnings = [];
    ephemeralNodeOutputs = new Map();
    loadPageContext(initialPage, false);
  };

  resetState();

  const evaluateDataPort = (
    indexed: IndexedGraph,
    nodeId: string,
    portId: string,
    visiting: Set<string>,
  ): unknown => {
    const key = `${indexed.graph.id}:${nodeId}:${portId}`;
    if (ephemeralNodeOutputs.has(key)) {
      return ephemeralNodeOutputs.get(key);
    }
    if (visiting.has(key)) {
      warnings.push(`Dataflow cycle encountered while evaluating "${nodeId}.${portId}".`);
      return null;
    }
    const node = indexed.nodesById.get(nodeId);
    if (!node || !isBuiltInLogicNodeType(node.type)) return null;

    visiting.add(key);
    try {
      switch (node.type) {
        case 'state.get': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? variables[variableId] : null;
        }
        case 'state.set':
        case 'state.toggle':
        case 'state.increment': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? variables[variableId] : null;
        }
        case 'event.on-state-change': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? variables[variableId] : null;
        }
        case 'logic.compare': {
          const left = resolveInputValue(indexed, node, 'left', node.data.left ?? null, visiting);
          const right = resolveInputValue(indexed, node, 'right', node.data.right ?? null, visiting);
          const operator = String(node.data.operator ?? '==') as LogicCompareOperator;
          return evaluateComparison(operator, left, right);
        }
        case 'logic.template': {
          const template = typeof node.data.template === 'string' ? node.data.template : '';
          const connected = resolveInputValue(indexed, node, 'value', undefined, visiting);
          return interpolateLogicTemplate(template, variables, variableNameToId, connected);
        }
        default:
          return null;
      }
    } finally {
      visiting.delete(key);
    }
  };

  const resolveInputValue = (
    indexed: IndexedGraph,
    node: LogicNode,
    portId: string,
    fallback: unknown,
    visiting: Set<string>,
  ): unknown => {
    const incoming = indexed.incomingByTarget.get(`${node.id}:${portId}`);
    if (!incoming || incoming.length === 0) return fallback;
    const first = incoming[0];
    return evaluateDataPort(indexed, first.sourceNodeId, first.sourcePortId, visiting);
  };

  const ensureNodeOverride = (nodeId: string): PrototypeNodeOverride => {
    if (!nodeOverrides[nodeId]) {
      nodeOverrides[nodeId] = {};
    }
    return nodeOverrides[nodeId];
  };

  const runExecutionQueue = (
    initialQueue: Array<{ indexed: IndexedGraph; nodeId: string }>,
  ) => {
    const queue = [...initialQueue];
    let dispatchSteps = 0;

    const enqueueOutgoing = (indexed: IndexedGraph, nodeId: string, portId: string) => {
      const connections = indexed.outgoingBySource.get(`${nodeId}:${portId}`) ?? [];
      for (const conn of connections) {
        queue.push({ indexed, nodeId: conn.targetNodeId });
      }
    };

    const enqueueStateChangeListeners = (variableId: string, nextValue: LogicVariableValue) => {
      for (const candidateGraph of indexedGraphs) {
        for (const candidateNode of candidateGraph.graph.nodes) {
          if (
            candidateNode.type === 'event.on-state-change' &&
            candidateNode.data.variableId === variableId
          ) {
            ephemeralNodeOutputs.set(`${candidateGraph.graph.id}:${candidateNode.id}:value`, nextValue);
            queue.push({ indexed: candidateGraph, nodeId: candidateNode.id });
          }
        }
      }
    };

    while (queue.length > 0) {
      if (dispatchSteps >= maxSteps) {
        warnings.push(`Execution halted after reaching the deterministic step budget (${maxSteps}).`);
        break;
      }
      const next = queue.shift()!;
      const node = next.indexed.nodesById.get(next.nodeId);
      if (!node || !isBuiltInLogicNodeType(node.type)) continue;

      dispatchSteps += 1;
      totalSteps += 1;
      const visiting = new Set<string>();

      switch (node.type) {
        case 'event.on-click':
        case 'event.on-hover':
        case 'event.on-page-load':
        case 'event.on-state-change': {
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Triggered ${node.type}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'exec');
          break;
        }

        case 'state.set': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          const expectedType = variableTypes.get(variableId);
          if (!expectedType) {
            warnings.push(`Set State "${node.id}" references undeclared variable "${variableId}".`);
            break;
          }
          const rawVal = resolveInputValue(next.indexed, node, 'value', node.data.value ?? null, visiting);
          const prevVal = variables[variableId];
          const coerced = coerceVariableValue(rawVal, expectedType, prevVal);
          variables[variableId] = coerced;
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:result`, coerced);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set ${variableId} = ${JSON.stringify(coerced)}`,
          });
          if (coerced !== prevVal) {
            enqueueStateChangeListeners(variableId, coerced);
          }
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'state.toggle': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          if (variableTypes.get(variableId) !== 'boolean') {
            warnings.push(`Toggle State "${node.id}" requires a boolean variable ("${variableId}").`);
            break;
          }
          const nextVal = !Boolean(variables[variableId]);
          variables[variableId] = nextVal;
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:result`, nextVal);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Toggled ${variableId} -> ${String(nextVal)}`,
          });
          enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'state.increment': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          if (variableTypes.get(variableId) !== 'number') {
            warnings.push(`Increment State "${node.id}" requires a number variable ("${variableId}").`);
            break;
          }
          const rawStep = resolveInputValue(next.indexed, node, 'step', node.data.step ?? 1, visiting);
          const step = typeof rawStep === 'number' && Number.isFinite(rawStep) ? rawStep : 1;
          const prevVal = typeof variables[variableId] === 'number' ? (variables[variableId] as number) : 0;
          let nextVal = prevVal + step;
          if (typeof node.data.min === 'number' && Number.isFinite(node.data.min)) {
            nextVal = Math.max(node.data.min, nextVal);
          }
          if (typeof node.data.max === 'number' && Number.isFinite(node.data.max)) {
            nextVal = Math.min(node.data.max, nextVal);
          }
          variables[variableId] = nextVal;
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:result`, nextVal);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Incremented ${variableId} -> ${String(nextVal)}`,
          });
          if (nextVal !== prevVal) {
            enqueueStateChangeListeners(variableId, nextVal);
          }
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'logic.branch': {
          const condRaw = resolveInputValue(
            next.indexed,
            node,
            'condition',
            Boolean(node.data.condition),
            visiting,
          );
          const taken = Boolean(condRaw);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Branch -> ${taken ? 'true' : 'false'}`,
          });
          enqueueOutgoing(next.indexed, node.id, taken ? 'true' : 'false');
          break;
        }

        case 'action.set-visible': {
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          const astNode = astNodesById.get(targetNodeId);
          if (!astNode) {
            warnings.push(`Set Visible "${node.id}" target node "${targetNodeId}" not found.`);
            break;
          }
          const incomingConnected = (next.indexed.incomingByTarget.get(`${node.id}:visible`)?.length ?? 0) > 0;
          let nextVisible: boolean;
          if (incomingConnected) {
            nextVisible = Boolean(resolveInputValue(next.indexed, node, 'visible', true, visiting));
          } else {
            const mode = String(node.data.mode ?? 'toggle');
            const currentVisible = nodeOverrides[targetNodeId]?.visible ?? astNode.visible;
            nextVisible = mode === 'show' ? true : mode === 'hide' ? false : !currentVisible;
          }
          ensureNodeOverride(targetNodeId).visible = nextVisible;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set visible(${targetNodeId}) = ${String(nextVisible)}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.set-text': {
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          const astNode = astNodesById.get(targetNodeId);
          if (!astNode || astNode.type !== 'text') {
            warnings.push(`Set Text "${node.id}" target text node "${targetNodeId}" not found.`);
            break;
          }
          const rawText = resolveInputValue(next.indexed, node, 'text', node.data.text ?? '', visiting);
          const nextText = rawText === null || rawText === undefined ? '' : String(rawText);
          ensureNodeOverride(targetNodeId).text = nextText;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set text(${targetNodeId}) = ${JSON.stringify(nextText)}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.set-fill': {
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          const astNode = astNodesById.get(targetNodeId);
          if (!astNode || astNode.type === 'group' || astNode.type === 'component-instance') {
            warnings.push(`Set Fill "${node.id}" target node "${targetNodeId}" does not support fill.`);
            break;
          }
          const rawFill = resolveInputValue(next.indexed, node, 'fill', node.data.fill ?? '', visiting);
          const nextFill = typeof rawFill === 'string' ? rawFill.trim() : '';
          if (!isSafeCssColorValue(nextFill)) {
            warnings.push(`Set Fill "${node.id}" blocked unsafe CSS color value.`);
            break;
          }
          ensureNodeOverride(targetNodeId).fill = nextFill;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set fill(${targetNodeId}) = ${nextFill}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.set-variant': {
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          const astNode = astNodesById.get(targetNodeId);
          if (!astNode || astNode.type !== 'component-instance') {
            warnings.push(`Set Variant "${node.id}" target "${targetNodeId}" is not a component instance.`);
            break;
          }
          const master = componentsById.get(astNode.componentId);
          const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
          const rawOpt = resolveInputValue(next.indexed, node, 'optionId', node.data.optionId ?? '', visiting);
          const optionId = typeof rawOpt === 'string' ? rawOpt : '';
          const axis = master?.variants?.find((item) => item.id === axisId);
          if (!axis || !axis.options.some((opt) => opt.id === optionId)) {
            warnings.push(`Set Variant "${node.id}" invalid axis "${axisId}" or option "${optionId}".`);
            break;
          }
          const targetOverride = ensureNodeOverride(targetNodeId);
          targetOverride.variantSelection = {
            ...(targetOverride.variantSelection ?? {}),
            [axisId]: optionId,
          };
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set variant(${targetNodeId}, ${axisId}) = ${optionId}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.navigate': {
          const rawRoute = typeof node.data.route === 'string' ? node.data.route.trim() : '';
          const safeHref = sanitizeHref(rawRoute);
          if (!safeHref) {
            warnings.push(`Navigate "${node.id}" blocked unsafe URL.`);
            break;
          }
          activeRoute = safeHref;
          const matchingPage = pagesByRoute.get(safeHref);
          if (matchingPage && matchingPage.id !== activePageId) {
            loadPageContext(matchingPage, true);
          }
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Navigate -> ${safeHref}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.set-theme': {
          const rawTheme = resolveInputValue(next.indexed, node, 'themeId', node.data.themeId ?? '', visiting);
          const themeId = typeof rawTheme === 'string' ? rawTheme.trim() : '';
          if (!themeId || !themeIds.has(themeId)) {
            warnings.push(`Set Theme "${node.id}" references unknown theme "${themeId}".`);
            break;
          }
          activeThemeId = themeId;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set theme -> ${themeId}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.play-animation': {
          const clipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
          const clip = clipId ? animationsById.get(clipId) : undefined;
          if (!clip) {
            warnings.push(`Play Animation "${node.id}" references unknown clip "${clipId}".`);
            break;
          }
          playedAnimations.push(clip.id);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Play animation -> ${clip.name} (${clip.durationMs}ms)`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'state.get':
        case 'logic.compare':
        case 'logic.template':
          // Pure data nodes are evaluated lazily via evaluateDataPort.
          break;
      }
    }
  };

  const getSnapshot = (): PrototypeRuntimeSnapshot => {
    const clonedOverrides: Record<string, PrototypeNodeOverride> = {};
    for (const [id, override] of Object.entries(nodeOverrides)) {
      clonedOverrides[id] = {
        ...override,
        ...(override.variantSelection ? { variantSelection: { ...override.variantSelection } } : {}),
      };
    }
    return {
      pageId: activePageId,
      activeRoute,
      activeThemeId,
      mounted,
      stepCount: totalSteps,
      variables: { ...variables },
      nodeOverrides: clonedOverrides,
      playedAnimations: [...playedAnimations],
      trace: trace.map((entry) => ({ ...entry })),
      warnings: [...warnings],
    };
  };

  return {
    mount() {
      if (mounted) return getSnapshot();
      mounted = true;
      ephemeralNodeOutputs = new Map();
      const starters: Array<{ indexed: IndexedGraph; nodeId: string }> = [];
      for (const indexed of indexedGraphs) {
        for (const node of indexed.graph.nodes) {
          if (node.type === 'event.on-page-load') {
            starters.push({ indexed, nodeId: node.id });
          }
        }
      }
      if (starters.length > 0) {
        runExecutionQueue(starters);
      }
      return getSnapshot();
    },

    dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind) {
      ephemeralNodeOutputs = new Map();
      const starters: Array<{ indexed: IndexedGraph; nodeId: string }> = [];
      for (const indexed of indexedGraphs) {
        for (const node of indexed.graph.nodes) {
          if (event === 'click' && node.type === 'event.on-click' && node.data.targetNodeId === nodeId) {
            starters.push({ indexed, nodeId: node.id });
          } else if (
            event === 'hover-enter' &&
            node.type === 'event.on-hover' &&
            node.data.targetNodeId === nodeId &&
            (node.data.phase === undefined || node.data.phase === 'enter')
          ) {
            starters.push({ indexed, nodeId: node.id });
          } else if (
            event === 'hover-leave' &&
            node.type === 'event.on-hover' &&
            node.data.targetNodeId === nodeId &&
            node.data.phase === 'leave'
          ) {
            starters.push({ indexed, nodeId: node.id });
          }
        }
      }
      if (starters.length > 0) {
        runExecutionQueue(starters);
      }
      return getSnapshot();
    },

    setVariable(variableId: string, value: LogicVariableValue) {
      const expectedType = variableTypes.get(variableId);
      if (!expectedType) {
        warnings.push(`Cannot set undeclared variable "${variableId}".`);
        return getSnapshot();
      }
      const prev = variables[variableId];
      const coerced = coerceVariableValue(value, expectedType, prev);
      variables[variableId] = coerced;
      if (coerced !== prev) {
        ephemeralNodeOutputs = new Map();
        const starters: Array<{ indexed: IndexedGraph; nodeId: string }> = [];
        for (const indexed of indexedGraphs) {
          for (const node of indexed.graph.nodes) {
            if (node.type === 'event.on-state-change' && node.data.variableId === variableId) {
              ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:value`, coerced);
              starters.push({ indexed, nodeId: node.id });
            }
          }
        }
        if (starters.length > 0) {
          runExecutionQueue(starters);
        }
      }
      return getSnapshot();
    },

    reset() {
      const page = pagesById.get(initialPage.id) ?? initialPage;
      loadPageContext(page, false);
      resetState();
      return getSnapshot();
    },

    getSnapshot,
  };
}

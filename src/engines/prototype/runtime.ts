/**
 * Folio Node Logic v2 — Deterministic Headless Prototype Runtime.
 *
 * Pure TypeScript, zero-DOM, zero-`eval` execution engine supporting all 31
 * primary Folio Node Logic nodes (Sources, Events, State, Logic, Actions,
 * Flow & Timing, Network) plus 100% backward-compatible legacy v1 nodes.
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

export type LogicNodeEventKind =
  | 'click'
  | 'hover-enter'
  | 'hover-leave'
  | 'input'
  | 'key-press'
  | 'drag'
  | 'scroll-view';

export interface PrototypeNodeOverride {
  visible?: boolean;
  text?: string;
  fill?: string;
  opacity?: number;
  transform?: string;
  imageUrl?: string;
  disabled?: boolean;
  variantSelection?: Record<string, string>;
}

export interface LogicExecutionTraceEntry {
  readonly step: number;
  readonly graphId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly detail: string;
}

export interface PrototypeToastNotice {
  readonly message: string;
  readonly tone: string;
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
  readonly toasts?: readonly PrototypeToastNotice[];
  readonly trace: readonly LogicExecutionTraceEntry[];
  readonly warnings: readonly string[];
}

export interface PrototypeRuntimeOptions {
  pageId?: string;
  maxSteps?: number;
}

export interface PrototypeRuntime {
  mount(): PrototypeRuntimeSnapshot;
  dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind, payload?: unknown): PrototypeRuntimeSnapshot;
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

function parseListValue(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseObjectValue(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function coerceVariableValue(
  raw: unknown,
  expectedType: LogicValueType,
  fallback: LogicVariableValue,
): LogicVariableValue {
  if (expectedType === 'list') {
    return parseListValue(raw);
  }
  if (expectedType === 'object') {
    return parseObjectValue(raw);
  }
  if (expectedType === 'string') {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'object') return JSON.stringify(raw);
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

function getNestedField(target: unknown, path: string): unknown {
  if (!path.trim()) return target;
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let cur: unknown = target;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : null;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return cur ?? null;
}

function setNestedField(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return target;
  const clone: Record<string, unknown> = { ...target };
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const nextVal = cur[key];
    const nextObj =
      nextVal && typeof nextVal === 'object' && !Array.isArray(nextVal)
        ? { ...(nextVal as Record<string, unknown>) }
        : {};
    cur[key] = nextObj;
    cur = nextObj;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
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
      return typeof connectedValue === 'object' ? JSON.stringify(connectedValue) : String(connectedValue);
    }
    if (Object.prototype.hasOwnProperty.call(variables, rawKey)) {
      const v = variables[rawKey];
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const mappedId = variableNameToId.get(rawKey) ?? variableNameToId.get(rawKey.toLowerCase());
    if (mappedId && Object.prototype.hasOwnProperty.call(variables, mappedId)) {
      const v = variables[mappedId];
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
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
  let variableInitialValues = new Map<string, LogicVariableValue>();
  let variableNameToId = new Map<string, string>();
  let variables: Record<string, LogicVariableValue> = {};
  let nodeOverrides: Record<string, PrototypeNodeOverride> = {};
  let playedAnimations: string[] = [];
  let toasts: PrototypeToastNotice[] = [];
  let trace: LogicExecutionTraceEntry[] = [];
  let warnings: string[] = [];
  let firedOnceEvents = new Set<string>();
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
      variableInitialValues = new Map();
      variableNameToId = new Map();
    }

    for (const entry of indexedGraphs) {
      for (const variable of entry.graph.variables ?? []) {
        variableTypes.set(variable.id, variable.valueType);
        const normalizedInitial = coerceVariableValue(
          variable.initialValue,
          variable.valueType,
          variable.initialValue,
        );
        variableInitialValues.set(variable.id, normalizedInitial);
        variableNameToId.set(variable.name, variable.id);
        variableNameToId.set(variable.name.toLowerCase(), variable.id);
        if (!Object.prototype.hasOwnProperty.call(variables, variable.id)) {
          variables[variable.id] = normalizedInitial;
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
    toasts = [];
    trace = [];
    warnings = [];
    firedOnceEvents = new Set();
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
        case 'state.get':
        case 'state.set':
        case 'state.toggle':
        case 'state.increment':
        case 'state.update':
        case 'event.on-state-change': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? variables[variableId] : null;
        }

        case 'source.element': {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (portId === 'target') return targetId;
          const ast = astNodesById.get(targetId);
          const prop = String(node.data.property ?? 'value');
          const ov = nodeOverrides[targetId];
          if (prop === 'text' || prop === 'value') {
            if (ov?.text !== undefined) return ov.text;
            return ast && ast.type === 'text' ? ast.text : (ast?.name ?? '');
          }
          if (prop === 'visible') return ov?.visible ?? ast?.visible ?? true;
          if (prop === 'fill') return ov?.fill ?? (ast && 'fill' in ast ? ast.fill : '');
          if (prop === 'opacity') return ov?.opacity ?? ast?.opacity ?? 1;
          if (prop === 'componentId') return typeof node.data.componentId === 'string' ? node.data.componentId : '';
          return targetId;
        }

        case 'source.context': {
          const kind = String(node.data.contextKind ?? 'page');
          if (portId === 'route') {
            const pId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
            return (pId ? pagesById.get(pId)?.route : undefined) ?? activeRoute;
          }
          if (portId === 'themeId') {
            const tId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
            return tId || activeThemeId;
          }
          if (kind === 'theme') return (typeof node.data.themeId === 'string' && node.data.themeId) || activeThemeId;
          if (kind === 'viewport') return node.data.viewportMetric === 'height' ? 900 : 1440;
          if (kind === 'user-auth') return node.data.authField === 'email' ? 'guest@folio.app' : false;
          if (kind === 'url-params') return '';
          const pId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
          return (pId ? pagesById.get(pId)?.route : undefined) ?? activeRoute;
        }

        case 'source.external': {
          if (portId === 'count') return 0;
          return [];
        }

        case 'source.page': {
          const pageId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
          return pagesById.get(pageId)?.route ?? '';
        }
        case 'source.component':
          return typeof node.data.componentId === 'string' ? node.data.componentId : '';
        case 'source.theme':
          return typeof node.data.themeId === 'string' ? node.data.themeId : '';

        case 'logic.compare':
        case 'logic.condition': {
          const mode = node.type === 'logic.condition' ? String(node.data.mode ?? 'compare') : 'compare';
          const left = resolveInputValue(indexed, node, 'left', node.data.left ?? null, visiting);
          const right = resolveInputValue(indexed, node, 'right', node.data.right ?? null, visiting);
          if (mode === 'and') return Boolean(left) && Boolean(right);
          if (mode === 'or') return Boolean(left) || Boolean(right);
          if (mode === 'not') return !Boolean(left);
          if (mode === 'is-empty') {
            if (left === null || left === undefined || left === '') return true;
            if (Array.isArray(left)) return left.length === 0;
            if (typeof left === 'object') return Object.keys(left as Record<string, unknown>).length === 0;
            return false;
          }
          if (mode === 'regex') {
            const pattern = typeof node.data.pattern === 'string' ? node.data.pattern : '';
            if (!pattern) return false;
            try {
              return new RegExp(pattern).test(String(left ?? ''));
            } catch {
              return false;
            }
          }
          const operator = String(node.data.operator ?? '==') as LogicCompareOperator;
          return evaluateComparison(operator, left, right);
        }

        case 'logic.math': {
          const a = Number(resolveInputValue(indexed, node, 'a', node.data.a ?? 0, visiting));
          const b = Number(resolveInputValue(indexed, node, 'b', node.data.b ?? 0, visiting));
          const safeA = Number.isFinite(a) ? a : 0;
          const safeB = Number.isFinite(b) ? b : 0;
          const op = String(node.data.operation ?? '+');
          if (op === '+') return safeA + safeB;
          if (op === '-') return safeA - safeB;
          if (op === '*') return safeA * safeB;
          if (op === '/') return safeB === 0 ? 0 : safeA / safeB;
          if (op === '%') return safeB === 0 ? 0 : safeA % safeB;
          if (op === 'clamp') {
            const min = Number(node.data.min ?? 0);
            const max = Number(node.data.max ?? 100);
            return Math.max(min, Math.min(max, safeA));
          }
          if (op === 'map-range') {
            const inMin = Number(node.data.inMin ?? 0);
            const inMax = Number(node.data.inMax ?? 100);
            const outMin = Number(node.data.outMin ?? 0);
            const outMax = Number(node.data.outMax ?? 1);
            if (inMax === inMin) return outMin;
            return outMin + ((safeA - inMin) / (inMax - inMin)) * (outMax - outMin);
          }
          return safeA;
        }

        case 'logic.template':
        case 'logic.text': {
          const mode = node.type === 'logic.text' ? String(node.data.mode ?? 'template') : 'template';
          const connected = resolveInputValue(indexed, node, 'value', undefined, visiting);
          if (mode === 'format-number' || mode === 'format-currency') {
            const num = Number(connected ?? 0);
            const safeNum = Number.isFinite(num) ? num : 0;
            const locale = typeof node.data.locale === 'string' && node.data.locale ? node.data.locale : 'en-US';
            const decimals = typeof node.data.decimals === 'number' ? Math.max(0, Math.min(6, node.data.decimals)) : 2;
            try {
              if (mode === 'format-currency') {
                const currency = typeof node.data.currency === 'string' && node.data.currency ? node.data.currency : 'USD';
                return new Intl.NumberFormat(locale, {
                  style: 'currency',
                  currency,
                  maximumFractionDigits: decimals,
                }).format(safeNum);
              }
              return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(safeNum);
            } catch {
              return safeNum.toFixed(decimals);
            }
          }
          const template = typeof node.data.template === 'string' ? node.data.template : '';
          return interpolateLogicTemplate(template, variables, variableNameToId, connected);
        }

        case 'logic.list': {
          const rawList = resolveInputValue(indexed, node, 'list', [], visiting);
          const list = parseListValue(rawList);
          const op = String(node.data.operation ?? 'filter');
          const field = typeof node.data.field === 'string' ? node.data.field.trim() : '';
          const rawQuery = resolveInputValue(indexed, node, 'query', node.data.matchValue ?? '', visiting);
          const query = String(rawQuery ?? '').trim().toLowerCase();

          let outList = [...list];
          if (op === 'filter' && query) {
            outList = list.filter((item) => {
              const target = field ? getNestedField(item, field) : item;
              return String(target ?? '').toLowerCase().includes(query);
            });
          } else if (op === 'sort') {
            const desc = node.data.sortOrder === 'desc';
            outList.sort((a, b) => {
              const va = field ? getNestedField(a, field) : a;
              const vb = field ? getNestedField(b, field) : b;
              const cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
              return desc ? -cmp : cmp;
            });
          } else if (op === 'map' && field) {
            outList = list.map((item) => getNestedField(item, field));
          }
          if (portId === 'count') return outList.length;
          return outList;
        }

        case 'network.json': {
          const raw = resolveInputValue(indexed, node, 'input', null, visiting);
          const mode = String(node.data.mode ?? 'get-field');
          if (mode === 'stringify') {
            if (portId === 'valid') return true;
            try {
              return JSON.stringify(raw);
            } catch {
              return '';
            }
          }
          if (mode === 'parse') {
            if (typeof raw === 'string') {
              try {
                const parsed = JSON.parse(raw);
                return portId === 'valid' ? true : parsed;
              } catch {
                return portId === 'valid' ? false : null;
              }
            }
            return portId === 'valid' ? raw !== null : raw;
          }
          // get-field
          const path = typeof node.data.path === 'string' ? node.data.path : '';
          const baseObj = typeof raw === 'string' ? parseObjectValue(raw) : raw;
          const extracted = getNestedField(baseObj, path);
          return portId === 'valid' ? extracted !== null : extracted;
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
    initialQueue: Array<{ indexed: IndexedGraph; nodeId: string; outPortId?: string }>,
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

      // Respect Once flag on event nodes
      if (node.type.startsWith('event.') && node.data.once === true) {
        const onceKey = `${next.indexed.graph.id}:${node.id}`;
        if (firedOnceEvents.has(onceKey)) continue;
        firedOnceEvents.add(onceKey);
      }

      dispatchSteps += 1;
      totalSteps += 1;
      const visiting = new Set<string>();

      switch (node.type) {
        case 'source.page':
        case 'source.component':
        case 'source.element':
        case 'source.context':
        case 'source.external': {
          const defaultPort =
            node.type === 'source.page' || node.type === 'source.context'
              ? 'onLoad'
              : node.type === 'source.external'
                ? 'onReady'
                : 'onClick';
          const outPort = next.outPortId ?? defaultPort;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Triggered ${node.type}.${outPort}`,
          });
          enqueueOutgoing(next.indexed, node.id, outPort);
          break;
        }

        case 'source.theme':
          break;

        case 'event.on-click':
        case 'event.on-hover':
        case 'event.on-input':
        case 'event.on-key-press':
        case 'event.on-drag':
        case 'event.on-scroll-view':
        case 'event.on-lifecycle':
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
          if (coerced !== prevVal) enqueueStateChangeListeners(variableId, coerced);
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
          if (typeof node.data.min === 'number' && Number.isFinite(node.data.min)) nextVal = Math.max(node.data.min, nextVal);
          if (typeof node.data.max === 'number' && Number.isFinite(node.data.max)) nextVal = Math.min(node.data.max, nextVal);
          variables[variableId] = nextVal;
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:result`, nextVal);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Incremented ${variableId} -> ${String(nextVal)}`,
          });
          if (nextVal !== prevVal) enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'state.update': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          const expectedType = variableTypes.get(variableId);
          if (!expectedType) {
            warnings.push(`Update State "${node.id}" references undeclared variable "${variableId}".`);
            break;
          }
          const op = String(node.data.operation ?? 'set');
          const prevVal = variables[variableId];
          const incomingVal = resolveInputValue(next.indexed, node, 'value', node.data.value ?? null, visiting);
          let nextVal: LogicVariableValue = prevVal;

          if (op === 'reset') {
            nextVal = variableInitialValues.get(variableId) ?? prevVal;
          } else if (op === 'increment' && expectedType === 'number') {
            const step = Number(node.data.step ?? 1);
            const prevNum = typeof prevVal === 'number' ? prevVal : 0;
            let computed = prevNum + (Number.isFinite(step) ? step : 1);
            if (typeof node.data.min === 'number' && Number.isFinite(node.data.min)) computed = Math.max(node.data.min, computed);
            if (typeof node.data.max === 'number' && Number.isFinite(node.data.max)) computed = Math.min(node.data.max, computed);
            nextVal = computed;
          } else if (op === 'push' && expectedType === 'list') {
            nextVal = [...parseListValue(prevVal), incomingVal];
          } else if (op === 'remove' && expectedType === 'list') {
            const list = parseListValue(prevVal);
            if (typeof incomingVal === 'number' && Number.isInteger(incomingVal)) {
              nextVal = list.filter((_item, idx) => idx !== incomingVal);
            } else {
              nextVal = list.filter((item) => item !== incomingVal);
            }
          } else if (op === 'set-property' && expectedType === 'object') {
            const path = typeof node.data.propertyPath === 'string' ? node.data.propertyPath : '';
            nextVal = setNestedField(parseObjectValue(prevVal), path, incomingVal);
          } else if (op === 'cycle') {
            const items = String(node.data.cycleValues ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            if (items.length > 0) {
              const curIdx = items.findIndex((item) => item === String(prevVal));
              const rawNext = items[(curIdx + 1) % items.length];
              nextVal = coerceVariableValue(rawNext, expectedType, prevVal);
            }
          } else {
            nextVal = coerceVariableValue(incomingVal, expectedType, prevVal);
          }

          variables[variableId] = nextVal;
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:result`, nextVal);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Update(${op}) ${variableId} -> ${JSON.stringify(nextVal)}`,
          });
          if (nextVal !== prevVal) enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'logic.branch': {
          const mode = String(node.data.mode ?? 'if-else');
          let outPort = 'false';
          if (mode === 'switch-case') {
            const matchVal = String(resolveInputValue(next.indexed, node, 'value', '', visiting) ?? '');
            if (matchVal === String(node.data.caseA ?? '')) outPort = 'true';
            else if (matchVal === String(node.data.caseB ?? '')) outPort = 'elseIf';
            else outPort = 'false';
          } else {
            const condRaw = resolveInputValue(next.indexed, node, 'condition', Boolean(node.data.condition), visiting);
            if (Boolean(condRaw)) {
              outPort = 'true';
            } else if (mode === 'else-if' && Boolean(node.data.elseIfCondition)) {
              outPort = 'elseIf';
            } else {
              outPort = 'false';
            }
          }
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Branch (${mode}) -> ${outPort}`,
          });
          enqueueOutgoing(next.indexed, node.id, outPort);
          break;
        }

        case 'action.set-layer': {
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          const astNode = astNodesById.get(targetNodeId);
          if (!astNode) {
            warnings.push(`Set Layer "${node.id}" target node "${targetNodeId}" not found.`);
            break;
          }
          const property = String(node.data.property ?? 'text');
          const hasConnectedValue = (next.indexed.incomingByTarget.get(`${node.id}:value`)?.length ?? 0) > 0;
          const connectedVal = hasConnectedValue
            ? resolveInputValue(next.indexed, node, 'value', null, visiting)
            : undefined;
          const ov = ensureNodeOverride(targetNodeId);

          if (property === 'visible') {
            if (hasConnectedValue) {
              ov.visible = Boolean(connectedVal);
            } else {
              const mode = String(node.data.visibleMode ?? 'toggle');
              const curVis = ov.visible ?? astNode.visible;
              ov.visible = mode === 'show' ? true : mode === 'hide' ? false : !curVis;
            }
          } else if (property === 'fill') {
            const fill = String(hasConnectedValue ? connectedVal ?? '' : node.data.fill ?? '').trim();
            if (!isSafeCssColorValue(fill)) {
              warnings.push(`Set Layer "${node.id}" blocked unsafe CSS fill color.`);
              break;
            }
            ov.fill = fill;
          } else if (property === 'opacity') {
            const rawOp = Number(hasConnectedValue ? connectedVal : node.data.opacity ?? 1);
            ov.opacity = Number.isFinite(rawOp) ? Math.max(0, Math.min(1, rawOp)) : 1;
          } else if (property === 'transform') {
            ov.transform = String(hasConnectedValue ? connectedVal ?? '' : node.data.transform ?? '');
          } else if (property === 'text') {
            ov.text = String(hasConnectedValue ? connectedVal ?? '' : node.data.text ?? '');
          } else if (property === 'image') {
            const url = String(hasConnectedValue ? connectedVal ?? '' : node.data.imageUrl ?? '').trim();
            if (url && !sanitizeHref(url)) {
              warnings.push(`Set Layer "${node.id}" blocked unsafe image URL.`);
              break;
            }
            ov.imageUrl = url;
          } else if (property === 'disabled') {
            ov.disabled = hasConnectedValue ? Boolean(connectedVal) : Boolean(node.data.disabled);
          }

          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set Layer(${targetNodeId}).${property}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
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
          const mode = String(node.data.mode ?? 'internal');
          if (mode === 'back' || mode === 'forward' || mode === 'reload' || mode === 'scroll-to' || mode === 'url-params') {
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Navigate (${mode})`,
            });
            enqueueOutgoing(next.indexed, node.id, 'next');
            break;
          }
          const resolvedRoute = resolveInputValue(next.indexed, node, 'route', node.data.route ?? '', visiting);
          const rawRoute = typeof resolvedRoute === 'string' ? resolvedRoute.trim() : '';
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

        case 'action.overlay-toast': {
          const mode = String(node.data.mode ?? 'show-toast');
          const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (mode === 'show-toast') {
            const msg = String(resolveInputValue(next.indexed, node, 'message', node.data.message ?? '', visiting) ?? '');
            const tone = String(node.data.tone ?? 'info');
            toasts.push({ message: msg, tone });
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Toast(${tone}): ${msg}`,
            });
          } else if (targetNodeId && astNodesById.has(targetNodeId)) {
            const open = mode === 'open-modal' || mode === 'open-drawer';
            ensureNodeOverride(targetNodeId).visible = open;
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `${mode}(${targetNodeId})`,
            });
          }
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'action.system-form': {
          const sysAction = String(node.data.action ?? 'set-theme');
          if (sysAction === 'set-theme') {
            const rawTheme = resolveInputValue(next.indexed, node, 'value', node.data.themeId ?? '', visiting);
            const themeId = typeof rawTheme === 'string' ? rawTheme.trim() : '';
            if (!themeId || !themeIds.has(themeId)) {
              warnings.push(`System & Form "${node.id}" references unknown theme "${themeId}".`);
              break;
            }
            activeThemeId = themeId;
          }
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `System & Form (${sysAction})`,
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

        case 'action.media-animation':
        case 'action.play-animation': {
          const command = node.type === 'action.media-animation' ? String(node.data.command ?? 'play') : 'play';
          const clipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
          const clip = clipId ? animationsById.get(clipId) : undefined;
          if (clip && (command === 'play' || command === 'reverse')) {
            playedAnimations.push(clip.id);
          } else if (node.type === 'action.play-animation' && !clip) {
            warnings.push(`Play Animation "${node.id}" references unknown clip "${clipId}".`);
            break;
          }
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `${command} ${clip ? clip.name : String(node.data.targetNodeId ?? 'media')}`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'flow.delay': {
          const dur = Number(node.data.duration ?? 300);
          const unit = node.data.unit === 's' ? 's' : 'ms';
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Delay ${dur}${unit} (simulated)`,
          });
          enqueueOutgoing(next.indexed, node.id, 'next');
          break;
        }

        case 'flow.loop-timer': {
          const mode = String(node.data.mode ?? 'for-each');
          if (mode === 'for-each') {
            const list = parseListValue(resolveInputValue(next.indexed, node, 'list', [], visiting));
            const cap = Math.min(list.length, Math.max(1, Number(node.data.maxIterations ?? 50)));
            for (let idx = 0; idx < cap; idx += 1) {
              ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:item`, list[idx]);
              ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:index`, idx);
              enqueueOutgoing(next.indexed, node.id, 'tick');
            }
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `For Each (${cap} items)`,
            });
            enqueueOutgoing(next.indexed, node.id, 'done');
          } else {
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Timer ${mode} (${String(node.data.timerId ?? 'timer')})`,
            });
            if (mode === 'interval-start') enqueueOutgoing(next.indexed, node.id, 'tick');
            else enqueueOutgoing(next.indexed, node.id, 'done');
          }
          break;
        }

        case 'flow.control': {
          const mode = String(node.data.mode ?? 'sequence');
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Flow Control (${mode})`,
          });
          enqueueOutgoing(next.indexed, node.id, 'step1');
          enqueueOutgoing(next.indexed, node.id, 'step2');
          enqueueOutgoing(next.indexed, node.id, 'done');
          break;
        }

        case 'network.http': {
          const method = String(node.data.method ?? 'GET');
          const url = String(node.data.url ?? '/api/items');
          const simulatedPayload = { ok: true, method, url, data: { items: [] } };
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:data`, simulatedPayload);
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:status`, 200);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `HTTP ${method} ${url} -> 200 (simulated)`,
          });
          enqueueOutgoing(next.indexed, node.id, 'loading');
          enqueueOutgoing(next.indexed, node.id, 'success');
          break;
        }

        case 'network.socket': {
          const action = String(node.data.action ?? 'listen');
          const channel = String(node.data.channel ?? 'updates');
          ephemeralNodeOutputs.set(`${next.indexed.graph.id}:${node.id}:connected`, true);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Socket ${action} #${channel}`,
          });
          if (action === 'listen' || action === 'connect') {
            enqueueOutgoing(next.indexed, node.id, 'onMessage');
          }
          break;
        }

        case 'state.get':
        case 'logic.compare':
        case 'logic.condition':
        case 'logic.math':
        case 'logic.template':
        case 'logic.text':
        case 'logic.list':
        case 'network.json':
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
      ...(toasts.length > 0 ? { toasts: [...toasts] } : {}),
      trace: trace.map((entry) => ({ ...entry })),
      warnings: [...warnings],
    };
  };

  return {
    mount() {
      if (mounted) return getSnapshot();
      mounted = true;
      ephemeralNodeOutputs = new Map();
      const starters: Array<{ indexed: IndexedGraph; nodeId: string; outPortId?: string }> = [];
      for (const indexed of indexedGraphs) {
        for (const node of indexed.graph.nodes) {
          if (node.type === 'event.on-page-load') {
            starters.push({ indexed, nodeId: node.id });
          } else if (node.type === 'event.on-lifecycle' && (node.data.trigger === 'page-load' || !node.data.trigger)) {
            starters.push({ indexed, nodeId: node.id });
          } else if (node.type === 'source.page' && node.data.pageId === activePageId) {
            starters.push({ indexed, nodeId: node.id, outPortId: 'onLoad' });
          } else if (
            node.type === 'source.context' &&
            (node.data.contextKind === 'page' || !node.data.contextKind) &&
            (!node.data.pageId || node.data.pageId === activePageId)
          ) {
            starters.push({ indexed, nodeId: node.id, outPortId: 'onLoad' });
          }
        }
      }
      if (starters.length > 0) {
        runExecutionQueue(starters);
      }
      return getSnapshot();
    },

    dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind, payload?: unknown) {
      ephemeralNodeOutputs = new Map();
      const targetAstNode = astNodesById.get(nodeId);
      const targetComponentId =
        targetAstNode && targetAstNode.type === 'component-instance'
          ? targetAstNode.componentId
          : null;
      const starters: Array<{ indexed: IndexedGraph; nodeId: string; outPortId?: string }> = [];
      for (const indexed of indexedGraphs) {
        for (const node of indexed.graph.nodes) {
          if (event === 'click' && node.type === 'event.on-click' && node.data.targetNodeId === nodeId) {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:target`, nodeId);
            starters.push({ indexed, nodeId: node.id });
          } else if (
            event === 'hover-enter' &&
            node.type === 'event.on-hover' &&
            node.data.targetNodeId === nodeId &&
            (node.data.phase === undefined || node.data.phase === 'enter')
          ) {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:isHovered`, true);
            starters.push({ indexed, nodeId: node.id });
          } else if (
            event === 'hover-leave' &&
            node.type === 'event.on-hover' &&
            node.data.targetNodeId === nodeId &&
            node.data.phase === 'leave'
          ) {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:isHovered`, false);
            starters.push({ indexed, nodeId: node.id });
          } else if (event === 'input' && node.type === 'event.on-input' && node.data.targetNodeId === nodeId) {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:value`, payload ?? '');
            starters.push({ indexed, nodeId: node.id });
          } else if (event === 'key-press' && node.type === 'event.on-key-press') {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:key`, payload ?? node.data.keyCombo ?? 'Enter');
            starters.push({ indexed, nodeId: node.id });
          } else if (event === 'drag' && node.type === 'event.on-drag' && node.data.targetNodeId === nodeId) {
            starters.push({ indexed, nodeId: node.id });
          } else if (
            event === 'scroll-view' &&
            node.type === 'event.on-scroll-view' &&
            (node.data.mode === 'page-scroll' || node.data.targetNodeId === nodeId)
          ) {
            ephemeralNodeOutputs.set(`${indexed.graph.id}:${node.id}:progress`, typeof payload === 'number' ? payload : 1);
            starters.push({ indexed, nodeId: node.id });
          } else if (
            node.type === 'source.element' &&
            (node.data.targetNodeId === nodeId || (targetComponentId && node.data.componentId === targetComponentId))
          ) {
            if (event === 'click') starters.push({ indexed, nodeId: node.id, outPortId: 'onClick' });
            else if (event === 'hover-enter') starters.push({ indexed, nodeId: node.id, outPortId: 'onHover' });
          } else if (
            node.type === 'source.component' &&
            ((targetComponentId && node.data.componentId === targetComponentId) || node.data.componentId === nodeId)
          ) {
            if (event === 'click') starters.push({ indexed, nodeId: node.id, outPortId: 'onClick' });
            else if (event === 'hover-enter') starters.push({ indexed, nodeId: node.id, outPortId: 'onHover' });
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

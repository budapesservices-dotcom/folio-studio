/**
 * Folio Node Logic v2 — Deterministic Headless Prototype Runtime.
 *
 * Pure TypeScript, zero-DOM, zero-`eval` execution engine supporting all 31
 * primary Folio Node Logic nodes (Sources, Events, State, Logic, Actions,
 * Flow & Timing, Network) plus 100% backward-compatible legacy v1 nodes.
 */

import {
  isSensitiveHeaderName,
  sanitizeGlobalHeadersForPersistence,
  sanitizeUrlCredentials,
} from '../../core/document/networkSecrets';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens, isSafeCssColorValue } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicFrame,
  LogicFrameCompiledStep,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableValue,
} from '../../core/document/types';
import { safeRegexTest, sanitizeCssTransformValue, sanitizeHref, sanitizeImageUrl } from '../codegen/sanitize';
import { isBuiltInLogicNodeType, type LogicCompareOperator } from './catalog';
import {
  getInstanceIdFromExpandedGraphId,
  resolveApplicableGraphsForPage,
} from './componentScope';
import { evaluateComputedExpression } from './computedExpr';
import {
  buildPipelineOriginRef,
  clonePipelineContextWithStep,
  createPipelineContext,
  getNodeTargetMode,
  getPrivateToggleMemoryKey,
  resolveAstNodeById,
  resolvePipelineRefValue,
  resolvePipelineTargetLayerId,
  type PipelineContext,
  type PipelineStepOutput,
} from './pipeline';

export const MAX_LOGIC_EXECUTION_STEPS = 256;
const HARD_MAX_EXECUTION_STEPS = 1024;

export type LogicNodeEventKind =
  | 'click'
  | 'double-click'
  | 'click-outside'
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
  readonly originLayerId?: string | null;
  readonly payload?: PipelineStepOutput;
  readonly frameId?: string;
  readonly frameTitle?: string;
  readonly nestedSteps?: readonly LogicExecutionTraceEntry[];
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
  readonly privateMemory: Readonly<Record<string, boolean>>;
  readonly nodeOverrides: Readonly<Record<string, PrototypeNodeOverride>>;
  readonly playedAnimations: readonly string[];
  readonly toasts?: readonly PrototypeToastNotice[];
  readonly trace: readonly LogicExecutionTraceEntry[];
  readonly warnings: readonly string[];
}

export interface PrototypeStorageBucket {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  clear?(): void;
}

export interface PrototypeHttpProxyRequest {
  readonly url: string;
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly authSecretRef?: string;
}

export interface PrototypeHttpProxyResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType?: string;
  readonly data: unknown;
  readonly durationMs?: number;
  readonly error?: string;
}

export type PrototypeHttpProxyExecutor = (
  payload: PrototypeHttpProxyRequest,
) => Promise<PrototypeHttpProxyResponse>;

export interface PrototypeAuthContext {
  readonly isSignedIn?: boolean;
  readonly name?: string;
  readonly email?: string;
  readonly role?: string;
}

export interface PrototypeRuntimeOptions {
  pageId?: string;
  maxSteps?: number;
  urlParams?: Readonly<Record<string, string>>;
  storage?: {
    readonly local?: PrototypeStorageBucket;
    readonly session?: PrototypeStorageBucket;
  };
  httpProxyExecutor?: PrototypeHttpProxyExecutor;
  authContext?: PrototypeAuthContext;
}

export interface PrototypeRuntime {
  mount(): PrototypeRuntimeSnapshot;
  mountAsync(): Promise<PrototypeRuntimeSnapshot>;
  dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind, payload?: unknown): PrototypeRuntimeSnapshot;
  dispatchNodeEventAsync(
    nodeId: string,
    event: LogicNodeEventKind,
    payload?: unknown,
  ): Promise<PrototypeRuntimeSnapshot>;
  setVariable(variableId: string, value: LogicVariableValue): PrototypeRuntimeSnapshot;
  reset(): PrototypeRuntimeSnapshot;
  getSnapshot(): PrototypeRuntimeSnapshot;
}

interface BakedFrameNodeIndex {
  readonly frame: LogicFrame;
  readonly step: LogicFrameCompiledStep;
  readonly childSet: ReadonlySet<string>;
}

interface IndexedGraph {
  readonly graph: LogicGraph;
  readonly nodesById: Map<string, LogicNode>;
  readonly outgoingBySource: Map<string, LogicConnection[]>;
  readonly incomingByTarget: Map<string, LogicConnection[]>;
  readonly bakedFrameByNodeId: Map<string, LogicFrame>;
  readonly compiledStepByNodeId: Map<string, BakedFrameNodeIndex>;
  readonly instanceId?: string;
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
  const bakedFrameByNodeId = new Map<string, LogicFrame>();
  const compiledStepByNodeId = new Map<string, BakedFrameNodeIndex>();
  for (const frame of graph.frames ?? []) {
    if (!frame.isBaked || !frame.bakedData?.compiledPlan) continue;
    const childSet = new Set(frame.childNodeIds);
    for (const childId of frame.childNodeIds) {
      bakedFrameByNodeId.set(childId, frame);
    }
    for (const step of frame.bakedData.compiledPlan.steps) {
      compiledStepByNodeId.set(step.nodeId, { frame, step, childSet });
    }
  }
  const instanceId = getInstanceIdFromExpandedGraphId(graph.id);
  return {
    graph,
    nodesById,
    outgoingBySource,
    incomingByTarget,
    bakedFrameByNodeId,
    compiledStepByNodeId,
    ...(instanceId ? { instanceId } : {}),
  };
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

export type ListRemoveMode = 'value' | 'index';

function parseValidListIndex(raw: unknown, length: number): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw < length ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < length ? parsed : null;
  }
  return null;
}

export function applyListRemove(
  list: readonly unknown[],
  incomingVal: unknown,
  rawRemoveMode?: unknown,
): { readonly next: unknown[]; readonly changed: boolean } {
  const mode: ListRemoveMode | undefined =
    rawRemoveMode === 'index' || rawRemoveMode === 'value' ? rawRemoveMode : undefined;

  if (mode === 'index') {
    const idx = parseValidListIndex(incomingVal, list.length);
    if (idx === null) {
      return { next: [...list], changed: false };
    }
    const next = [...list];
    next.splice(idx, 1);
    return { next, changed: true };
  }

  if (mode === 'value') {
    const next = list.filter((item) => item !== incomingVal);
    return { next, changed: next.length !== list.length };
  }

  // Legacy compatibility when `removeMode` is not specified:
  // numbers are strictly treated as indices (invalid indices do NOT fall back to value removal),
  // while non-numbers are treated as values.
  if (typeof incomingVal === 'number') {
    const idx = parseValidListIndex(incomingVal, list.length);
    if (idx === null) {
      return { next: [...list], changed: false };
    }
    const next = [...list];
    next.splice(idx, 1);
    return { next, changed: true };
  }

  const next = list.filter((item) => item !== incomingVal);
  return { next, changed: next.length !== list.length };
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
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return null;
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
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return clone;
    const nextVal = cur[key];
    const nextObj =
      nextVal && typeof nextVal === 'object' && !Array.isArray(nextVal)
        ? { ...(nextVal as Record<string, unknown>) }
        : {};
    cur[key] = nextObj;
    cur = nextObj;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey !== '__proto__' && lastKey !== 'constructor' && lastKey !== 'prototype') {
    cur[lastKey] = value;
  }
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
  return template.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (_match, rawKey: string) => {
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
  const page = project.pages.find((item) => item.id === pageId);
  if (!page) {
    return project.logicGraphs.filter(
      (graph) => graph.scope === 'project' || (graph.scope === 'page' && graph.targetId === pageId),
    );
  }
  return [...resolveApplicableGraphsForPage(project, page).graphs];
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
  let variablePersist = new Map<string, 'local' | 'session'>();
  let variableComputed = new Map<string, string>();
  let variables: Record<string, LogicVariableValue> = {};
  let privateMemory: Record<string, boolean> = {};
  let memoryStorage: { local: Map<string, string>; session: Map<string, string> } = {
    local: new Map(),
    session: new Map(),
  };
  let nodeOverrides: Record<string, PrototypeNodeOverride> = {};
  let playedAnimations: string[] = [];
  let toasts: PrototypeToastNotice[] = [];
  let trace: LogicExecutionTraceEntry[] = [];
  let warnings: string[] = [];
  let firedOnceEvents = new Set<string>();
  let executionCounter = 0;

  const nextExecutionId = (prefix: string): string => {
    executionCounter += 1;
    return `${prefix}-${executionCounter}`;
  };

  const persistKeyForVariable = (variableId: string): string => `folio:var:${variableId}`;

  const readPersistedVariable = (
    variableId: string,
    scope: 'local' | 'session',
    expectedType: LogicValueType,
    fallback: LogicVariableValue,
  ): LogicVariableValue | undefined => {
    const key = persistKeyForVariable(variableId);
    let raw: string | null = null;
    const externalBucket = options.storage?.[scope];
    if (externalBucket) {
      try {
        raw = externalBucket.getItem(key);
      } catch {
        raw = null;
      }
    }
    if (raw === null && memoryStorage[scope].has(key)) {
      raw = memoryStorage[scope].get(key) ?? null;
    }
    if (raw === null) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return coerceVariableValue(parsed, expectedType, fallback);
    } catch {
      return coerceVariableValue(raw, expectedType, fallback);
    }
  };

  const writePersistedVariable = (variableId: string, value: LogicVariableValue) => {
    const scope = variablePersist.get(variableId);
    if (!scope) return;
    const key = persistKeyForVariable(variableId);
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
    memoryStorage[scope].set(key, serialized);
    const externalBucket = options.storage?.[scope];
    if (externalBucket) {
      try {
        externalBucket.setItem(key, serialized);
      } catch {
        // Safe fallback to in-memory storage
      }
    }
  };

  const recomputeComputedVariables = (
    onChanged?: (variableId: string, nextValue: LogicVariableValue) => void,
  ) => {
    if (variableComputed.size === 0) return;
    const maxPasses = Math.min(variableComputed.size, 6);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let anyChanged = false;
      for (const [varId, expr] of variableComputed.entries()) {
        const expectedType = variableTypes.get(varId);
        if (!expectedType) continue;
        const result = evaluateComputedExpression(expr, variables, variableNameToId);
        if (!result.ok) continue;
        const prev = variables[varId];
        const fallback = variableInitialValues.get(varId) ?? prev;
        const nextVal = coerceVariableValue(result.value, expectedType, fallback);
        if (JSON.stringify(nextVal) !== JSON.stringify(prev)) {
          variables[varId] = nextVal;
          writePersistedVariable(varId, nextVal);
          anyChanged = true;
          onChanged?.(varId, nextVal);
        }
      }
      if (!anyChanged) break;
    }
  };

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
      variablePersist = new Map();
      variableComputed = new Map();
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
        if (variable.persist === 'local' || variable.persist === 'session') {
          variablePersist.set(variable.id, variable.persist);
        }
        if (variable.computed && typeof variable.computedExpression === 'string' && variable.computedExpression.trim()) {
          variableComputed.set(variable.id, variable.computedExpression.trim());
        }
        if (!Object.prototype.hasOwnProperty.call(variables, variable.id)) {
          const persisted =
            variable.persist === 'local' || variable.persist === 'session'
              ? readPersistedVariable(variable.id, variable.persist, variable.valueType, normalizedInitial)
              : undefined;
          variables[variable.id] = persisted !== undefined ? persisted : normalizedInitial;
        }
      }
    }
    recomputeComputedVariables();
  };

  const resetState = () => {
    activeThemeId = tokens.activeThemeId;
    mounted = false;
    totalSteps = 0;
    privateMemory = {};
    memoryStorage = { local: new Map(), session: new Map() };
    nodeOverrides = {};
    playedAnimations = [];
    toasts = [];
    trace = [];
    warnings = [];
    firedOnceEvents = new Set();
    executionCounter = 0;
    loadPageContext(initialPage, false);
  };

  resetState();

  const evaluateDataPort = (
    indexed: IndexedGraph,
    nodeId: string,
    portId: string,
    visiting: Set<string>,
    context: PipelineContext,
  ): unknown => {
    const key = `${indexed.graph.id}:${nodeId}:${portId}`;
    // First check scoped PipelineContext steps (isolated per execution branch).
    const stepOut = context.steps[nodeId];
    if (stepOut) {
      if (Object.prototype.hasOwnProperty.call(stepOut, portId)) {
        return stepOut[portId];
      }
      if (portId === 'result' && Object.prototype.hasOwnProperty.call(stepOut, 'value')) {
        return stepOut.value;
      }
      if (portId === 'target' && Object.prototype.hasOwnProperty.call(stepOut, 'targetLayerId')) {
        return stepOut.targetLayerId;
      }
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
        case 'state.toggle': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId.trim() : '';
          if (!variableId) {
            const ownerFrame = indexed.bakedFrameByNodeId.get(node.id);
            const memKey = getPrivateToggleMemoryKey(node.id, context.origin, ownerFrame?.id, indexed.instanceId);
            return Object.prototype.hasOwnProperty.call(privateMemory, memKey)
              ? privateMemory[memKey]
              : Boolean(node.data.initialValue);
          }
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? Boolean(variables[variableId]) : false;
        }
        case 'state.get':
        case 'state.set':
        case 'state.increment':
        case 'state.update':
        case 'event.on-state-change': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          return Object.prototype.hasOwnProperty.call(variables, variableId) ? variables[variableId] : null;
        }

        case 'source.element': {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (portId === 'target') return targetId;
          const ast = resolveAstNodeById(targetId, astNodesById, componentsById, tokens);
          const prop = String(node.data.property ?? 'value');
          const ov = nodeOverrides[targetId];
          if (prop === 'text' || prop === 'value') {
            if (ov?.text !== undefined) return ov.text;
            return ast && ast.type === 'text' ? ast.text : (ast?.name ?? '');
          }
          if (prop === 'visible') return ov?.visible ?? ast?.visible ?? true;
          if (prop === 'fill') {
            if (ov?.fill !== undefined) return ov.fill;
            return ast && 'style' in ast && ast.style && 'fill' in ast.style && typeof ast.style.fill === 'string'
              ? ast.style.fill
              : '';
          }
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
          if (kind === 'user-auth') {
            const field = String(node.data.authField ?? 'isSignedIn');
            const auth = options.authContext;
            if (field === 'email') return auth?.email ?? 'guest@folio.app';
            if (field === 'name') return auth?.name ?? 'Guest';
            if (field === 'role') return auth?.role ?? 'guest';
            return Boolean(auth?.isSignedIn ?? false);
          }
          if (kind === 'url-params') {
            const paramKey = typeof node.data.paramKey === 'string' ? node.data.paramKey.trim() : '';
            return paramKey && options.urlParams ? (options.urlParams[paramKey] ?? '') : '';
          }
          if (kind === 'storage') {
            const storageKey = typeof node.data.storageKey === 'string' ? node.data.storageKey.trim() : '';
            const scope = node.data.storageScope === 'session' ? 'session' : 'local';
            const stored = storageKey ? memoryStorage[scope].get(storageKey) : undefined;
            return stored !== undefined ? stored : (node.data.value ?? '');
          }
          const pId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
          return (pId ? pagesById.get(pId)?.route : undefined) ?? activeRoute;
        }

        case 'source.external': {
          const cachedExt = latestExternalData.get(node.id);
          if (cachedExt) {
            if (portId === 'count') return cachedExt.count;
            return cachedExt.data;
          }
          if (portId === 'count') return 0;
          return [];
        }

        case 'network.http': {
          const cachedHttp = latestHttpResponses.get(node.id);
          if (cachedHttp) {
            if (portId === 'status') return cachedHttp.status;
            if (portId === 'error') return cachedHttp.error ?? '';
            return cachedHttp.data;
          }
          return portId === 'status' ? 0 : null;
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
          const left = resolveInputValue(indexed, node, 'left', node.data.left ?? null, visiting, context, 'leftRef');
          const right = resolveInputValue(indexed, node, 'right', node.data.right ?? null, visiting, context, 'rightRef');
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
            return safeRegexTest(pattern, String(left ?? ''));
          }
          const operator = String(node.data.operator ?? '==') as LogicCompareOperator;
          return evaluateComparison(operator, left, right);
        }

        case 'logic.math': {
          const a = Number(resolveInputValue(indexed, node, 'a', node.data.a ?? 0, visiting, context, 'leftRef'));
          const b = Number(resolveInputValue(indexed, node, 'b', node.data.b ?? 0, visiting, context, 'rightRef'));
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
          const connected = resolveInputValue(indexed, node, 'value', undefined, visiting, context, 'pipelineRef');
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
          const rawList = resolveInputValue(indexed, node, 'list', [], visiting, context, 'pipelineRef');
          const list = parseListValue(rawList);
          const op = String(node.data.operation ?? 'filter');
          const field = typeof node.data.field === 'string' ? node.data.field.trim() : '';
          const rawQuery = resolveInputValue(indexed, node, 'query', node.data.matchValue ?? '', visiting, context);
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
          const raw = resolveInputValue(indexed, node, 'input', null, visiting, context, 'pipelineRef');
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
    context: PipelineContext,
    refField?: string,
  ): unknown => {
    const bakedStep = indexed.compiledStepByNodeId.get(node.id)?.step;
    const compiledDataInput = bakedStep?.dataInputs[portId];
    if (compiledDataInput) {
      return evaluateDataPort(
        indexed,
        compiledDataInput.sourceNodeId,
        compiledDataInput.sourcePort,
        visiting,
        context,
      );
    }
    const incoming = indexed.incomingByTarget.get(`${node.id}:${portId}`);
    if (incoming && incoming.length > 0) {
      const first = incoming[0];
      return evaluateDataPort(indexed, first.sourceNodeId, first.sourcePortId, visiting, context);
    }
    if (refField) {
      const refVal = node.data[refField];
      if (typeof refVal === 'string' && refVal.trim().length > 0) {
        const resolved = resolvePipelineRefValue(context, refVal);
        if (resolved.found) return resolved.value;
      }
    }
    return fallback;
  };

  const hasDynamicInput = (
    indexed: IndexedGraph,
    node: LogicNode,
    portId: string,
    context: PipelineContext,
    refField?: string,
  ): boolean => {
    const bakedStep = indexed.compiledStepByNodeId.get(node.id)?.step;
    if (bakedStep?.dataInputs[portId]) return true;
    if ((indexed.incomingByTarget.get(`${node.id}:${portId}`)?.length ?? 0) > 0) return true;
    if (refField) {
      const refVal = node.data[refField];
      if (typeof refVal === 'string' && refVal.trim().length > 0) {
        return resolvePipelineRefValue(context, refVal).found;
      }
    }
    return false;
  };

  const ensureNodeOverride = (nodeId: string): PrototypeNodeOverride => {
    if (!nodeOverrides[nodeId]) {
      nodeOverrides[nodeId] = {};
    }
    return nodeOverrides[nodeId];
  };

  interface ExecutionQueueItem {
    readonly indexed: IndexedGraph;
    readonly nodeId: string;
    readonly outPortId?: string;
    readonly context: PipelineContext;
    readonly initialStepPayload?: PipelineStepOutput;
  }

  const latestHttpResponses = new Map<string, { readonly data: unknown; readonly status: number; readonly ok: boolean; readonly error?: string }>();
  const latestExternalData = new Map<string, { readonly data: unknown[]; readonly count: number; readonly status: number; readonly ok: boolean; readonly error?: string }>();

  const parseGraphSafeHeaders = (rawHeaders: string | undefined): Record<string, string> | undefined => {
    if (!rawHeaders || !rawHeaders.trim()) return undefined;
    const sanitized = sanitizeGlobalHeadersForPersistence(rawHeaders).trim();
    if (!sanitized) return undefined;
    try {
      const parsed = JSON.parse(sanitized) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = k.trim();
        if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (isSensitiveHeaderName(key)) continue;
        if (!/^[a-zA-Z0-9-]+$/.test(key)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          out[key] = String(v).replace(/[\r\n\u0000]/g, '').slice(0, 1024);
        }
      }
      return Object.keys(out).length > 0 ? out : undefined;
    } catch {
      return undefined;
    }
  };

  const resolveEndpointWithBaseUrl = (rawPathOrUrl: string, baseUrl: string | undefined): string => {
    const trimmed = sanitizeUrlCredentials(rawPathOrUrl.trim());
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const cleanBase = sanitizeUrlCredentials((baseUrl ?? '').trim());
    if (cleanBase) {
      return `${cleanBase.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
    }
    return trimmed;
  };

  const resolveExternalSourceUrl = (node: LogicNode, baseUrl: string | undefined): string => {
    const sourceKind = node.data.sourceKind === 'cms' ? 'cms' : 'api';
    const rawTarget =
      sourceKind === 'cms'
        ? (typeof node.data.endpoint === 'string' && node.data.endpoint.trim()
            ? node.data.endpoint.trim()
            : `/collections/${String(node.data.collection ?? '').trim().replace(/^\/+/, '')}`)
        : String(node.data.endpoint ?? '').trim();
    let fullUrl = resolveEndpointWithBaseUrl(rawTarget, baseUrl);
    const query = typeof node.data.query === 'string' ? node.data.query.trim().replace(/^\?/, '') : '';
    if (query && fullUrl) {
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + query;
    }
    return fullUrl;
  };

  const normalizeExternalListData = (raw: unknown): unknown[] => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const rec = raw as Record<string, unknown>;
      if (Array.isArray(rec.items)) return rec.items;
      if (Array.isArray(rec.data)) return rec.data;
    }
    if (raw !== null && raw !== undefined && raw !== '') return [raw];
    return [];
  };

  const invokeLiveHttpProxy = async (
    payload: PrototypeHttpProxyRequest,
  ): Promise<PrototypeHttpProxyResponse> => {
    if (options.httpProxyExecutor) {
      return options.httpProxyExecutor(payload);
    }
    if (typeof globalThis.fetch !== 'function') {
      return {
        status: 0,
        ok: false,
        data: null,
        error: 'Fetch API is unavailable in this environment for live HTTP requests.',
      };
    }
    try {
      const response = await globalThis.fetch('/api/logic/http-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as PrototypeHttpProxyResponse;
        return {
          status: typeof parsed.status === 'number' ? parsed.status : response.status,
          ok: Boolean(parsed.ok),
          contentType: parsed.contentType ?? response.headers.get('content-type') ?? 'application/json',
          data: parsed.data ?? null,
          durationMs: parsed.durationMs,
          error: parsed.error,
        };
      } catch {
        return {
          status: response.status,
          ok: false,
          contentType: response.headers.get('content-type') ?? 'text/plain',
          data: text,
          error: `Proxy returned non-JSON HTTP ${response.status}.`,
        };
      }
    } catch (err) {
      return {
        status: 0,
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : 'Network request failed.',
      };
    }
  };

  interface PendingLiveHttpJob {
    readonly kind: 'network.http' | 'source.external';
    readonly indexed: IndexedGraph;
    readonly node: LogicNode;
    readonly ctx: PipelineContext;
    readonly request: PrototypeHttpProxyRequest;
  }

  const runExecutionQueue = (
    initialQueue: ExecutionQueueItem[],
    pendingAsyncJobs?: PendingLiveHttpJob[],
  ) => {
    const queue: ExecutionQueueItem[] = [...initialQueue];
    let dispatchSteps = 0;

    interface ActiveFrameTraceGroup {
      readonly frame: LogicFrame;
      readonly traceIndex: number;
      readonly nestedSteps: LogicExecutionTraceEntry[];
      lastPayload?: PipelineStepOutput;
    }
    const activeFrameGroups = new Map<string, ActiveFrameTraceGroup>();

    const enqueueOutgoing = (
      indexed: IndexedGraph,
      nodeId: string,
      portId: string,
      nextContext: PipelineContext,
    ) => {
      const bakedEntry = indexed.compiledStepByNodeId.get(nodeId);
      if (bakedEntry) {
        // Execute internal sub-graph transitions directly via pre-compiled plan (zero raw graph edge scan)
        const internalNext = bakedEntry.step.nextByPort[portId] ?? [];
        for (const edge of internalNext) {
          queue.push({ indexed, nodeId: edge.targetNodeId, context: nextContext });
        }
        // Forward any boundary-exiting connections leaving the Baked Frame to external nodes
        const outgoingAll = indexed.outgoingBySource.get(`${nodeId}:${portId}`) ?? [];
        for (const conn of outgoingAll) {
          if (!bakedEntry.childSet.has(conn.targetNodeId)) {
            queue.push({ indexed, nodeId: conn.targetNodeId, context: nextContext });
          }
        }
        return;
      }
      const connections = indexed.outgoingBySource.get(`${nodeId}:${portId}`) ?? [];
      for (const conn of connections) {
        queue.push({ indexed, nodeId: conn.targetNodeId, context: nextContext });
      }
    };

    const enqueueStateChangeListeners = (variableId: string, nextValue: LogicVariableValue) => {
      for (const candidateGraph of indexedGraphs) {
        for (const candidateNode of candidateGraph.graph.nodes) {
          if (
            candidateNode.type === 'event.on-state-change' &&
            candidateNode.data.variableId === variableId
          ) {
            const stateOrigin = candidateGraph.instanceId
              ? buildPipelineOriginRef(
                  candidateGraph.instanceId,
                  astNodesById,
                  componentsById,
                  project.animations,
                  tokens,
                )
              : null;
            const freshCtx = createPipelineContext(
              nextExecutionId('state'),
              'state-change',
              stateOrigin,
            );
            queue.push({
              indexed: candidateGraph,
              nodeId: candidateNode.id,
              context: freshCtx,
              initialStepPayload: { variableId, value: nextValue },
            });
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
      const ctx = next.context;

      // Respect Once flag on event nodes
      if (node.type.startsWith('event.') && node.data.once === true) {
        const onceKey = `${next.indexed.graph.id}:${node.id}`;
        if (firedOnceEvents.has(onceKey)) continue;
        firedOnceEvents.add(onceKey);
      }

      dispatchSteps += 1;
      totalSteps += 1;
      const visiting = new Set<string>();
      const activeBakedEntry = next.indexed.compiledStepByNodeId.get(node.id);
      let activeFrameGroup: ActiveFrameTraceGroup | undefined;
      if (activeBakedEntry) {
        const groupKey = `${ctx.executionId}:${next.indexed.instanceId ?? ''}:${activeBakedEntry.frame.id}`;
        activeFrameGroup = activeFrameGroups.get(groupKey);
        if (!activeFrameGroup) {
          const traceIndex = trace.length;
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: activeBakedEntry.frame.id,
            nodeType: 'logic.frame.baked',
            frameId: activeBakedEntry.frame.id,
            frameTitle: activeBakedEntry.frame.title,
            detail: `Baked Frame “${activeBakedEntry.frame.title}” (0 steps)`,
            originLayerId: ctx.origin?.layerId ?? null,
            nestedSteps: [],
          });
          activeFrameGroup = {
            frame: activeBakedEntry.frame,
            traceIndex,
            nestedSteps: [],
          };
          activeFrameGroups.set(groupKey, activeFrameGroup);
        }
      }
      const traceLenBefore = trace.length;

      switch (node.type) {
        case 'source.page':
        case 'source.component':
        case 'source.element':
        case 'source.context': {
          const defaultPort =
            node.type === 'source.page' || node.type === 'source.context'
              ? 'onLoad'
              : 'onClick';
          const outPort = next.outPortId ?? defaultPort;
          const stepPayload: PipelineStepOutput = {
            ...(next.initialStepPayload ?? {}),
            ...(ctx.origin
              ? {
                  targetLayerId: ctx.origin.layerId,
                  originName: ctx.origin.name,
                  originType: ctx.origin.type,
                  ...(ctx.origin.children ? { childCount: ctx.origin.children.length } : {}),
                }
              : {}),
            port: outPort,
          };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Triggered ${node.type}.${outPort}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, outPort, nextCtx);
          break;
        }

        case 'source.external': {
          const isLiveExternal = node.data.executionMode === 'live';
          const netSettings = next.indexed.graph.networkSettings;
          const resolvedUrl = resolveExternalSourceUrl(node, netSettings?.baseUrl);
          if (isLiveExternal) {
            if (pendingAsyncJobs) {
              const safeHeaders = parseGraphSafeHeaders(netSettings?.globalHeaders);
              const authSecretRef =
                node.data.useAuth && netSettings?.authSecretRef ? netSettings.authSecretRef : undefined;
              trace.push({
                step: totalSteps,
                graphId: next.indexed.graph.id,
                nodeId: node.id,
                nodeType: node.type,
                detail: `External Data live fetch queued: GET ${resolvedUrl}`,
                originLayerId: ctx.origin?.layerId ?? null,
                payload: { url: resolvedUrl, mode: 'live' },
              });
              pendingAsyncJobs.push({
                kind: 'source.external',
                indexed: next.indexed,
                node,
                ctx,
                request: {
                  url: resolvedUrl,
                  method: 'GET',
                  ...(safeHeaders ? { headers: safeHeaders } : {}),
                  ...(authSecretRef ? { authSecretRef } : {}),
                },
              });
            } else {
              warnings.push(
                `External Data node "${node.id}" is in live mode; use mountAsync() for live HTTP requests.`,
              );
              trace.push({
                step: totalSteps,
                graphId: next.indexed.graph.id,
                nodeId: node.id,
                nodeType: node.type,
                detail: `External Data live fetch skipped in synchronous mount (use mountAsync): ${resolvedUrl}`,
                originLayerId: ctx.origin?.layerId ?? null,
                payload: { url: resolvedUrl, mode: 'live', skipped: true },
              });
            }
            break;
          }
          const outPort = next.outPortId ?? 'onReady';
          const stepPayload: PipelineStepOutput = {
            ...(next.initialStepPayload ?? {}),
            data: [],
            count: 0,
            port: outPort,
          };
          latestExternalData.set(node.id, { data: [], count: 0, status: 200, ok: true });
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Triggered source.external.${outPort} (simulated)`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, outPort, nextCtx);
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
          const stepPayload: PipelineStepOutput = {
            ...(next.initialStepPayload ?? {}),
            ...(ctx.origin
              ? {
                  targetLayerId: ctx.origin.layerId,
                  originName: ctx.origin.name,
                  originType: ctx.origin.type,
                  ...(ctx.origin.children ? { childCount: ctx.origin.children.length } : {}),
                }
              : {}),
          };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Triggered ${node.type}${ctx.origin ? ` (${ctx.origin.name})` : ''}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'exec', nextCtx);
          break;
        }

        case 'state.set': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          const expectedType = variableTypes.get(variableId);
          if (!expectedType) {
            warnings.push(`Set State "${node.id}" references undeclared variable "${variableId}".`);
            break;
          }
          const rawVal = resolveInputValue(next.indexed, node, 'value', node.data.value ?? null, visiting, ctx, 'pipelineRef');
          const prevVal = variables[variableId];
          const coerced = coerceVariableValue(rawVal, expectedType, prevVal);
          variables[variableId] = coerced;
          writePersistedVariable(variableId, coerced);
          recomputeComputedVariables((cId, cVal) => enqueueStateChangeListeners(cId, cVal));
          const stepPayload: PipelineStepOutput = { variableId, value: coerced, previous: prevVal };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set ${variableId} = ${JSON.stringify(coerced)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          if (coerced !== prevVal) enqueueStateChangeListeners(variableId, coerced);
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'state.toggle': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId.trim() : '';
          if (!variableId) {
            // Node-owned, target-bound private boolean memory (Anti-Amnesia + Baked Frame + Component Instance isolation)
            const ownerFrame = next.indexed.bakedFrameByNodeId.get(node.id);
            const memoryKey = getPrivateToggleMemoryKey(node.id, ctx.origin, ownerFrame?.id, next.indexed.instanceId);
            const initialBool = Boolean(node.data.initialValue);
            const prevVal = Object.prototype.hasOwnProperty.call(privateMemory, memoryKey)
              ? privateMemory[memoryKey]
              : initialBool;
            const nextVal = !prevVal;
            privateMemory[memoryKey] = nextVal;
            const stepPayload: PipelineStepOutput = {
              value: nextVal,
              previous: prevVal,
              memoryKey,
            };
            const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Toggled private (${ctx.origin?.name ?? 'default'}) -> ${String(nextVal)}`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: { value: nextVal, previous: prevVal },
            });
            enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
            break;
          }

          if (variableTypes.get(variableId) !== 'boolean') {
            warnings.push(`Toggle State "${node.id}" requires a boolean variable ("${variableId}").`);
            break;
          }
          const prevVal = Boolean(variables[variableId]);
          const nextVal = !prevVal;
          variables[variableId] = nextVal;
          writePersistedVariable(variableId, nextVal);
          recomputeComputedVariables((cId, cVal) => enqueueStateChangeListeners(cId, cVal));
          const stepPayload: PipelineStepOutput = { value: nextVal, previous: prevVal, variableId };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Toggled ${variableId} -> ${String(nextVal)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { value: nextVal, previous: prevVal },
          });
          enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'state.increment': {
          const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
          if (variableTypes.get(variableId) !== 'number') {
            warnings.push(`Increment State "${node.id}" requires a number variable ("${variableId}").`);
            break;
          }
          const rawStep = resolveInputValue(next.indexed, node, 'step', node.data.step ?? 1, visiting, ctx);
          const step = typeof rawStep === 'number' && Number.isFinite(rawStep) ? rawStep : 1;
          const prevVal = typeof variables[variableId] === 'number' ? (variables[variableId] as number) : 0;
          let nextVal = prevVal + step;
          if (typeof node.data.min === 'number' && Number.isFinite(node.data.min)) nextVal = Math.max(node.data.min, nextVal);
          if (typeof node.data.max === 'number' && Number.isFinite(node.data.max)) nextVal = Math.min(node.data.max, nextVal);
          variables[variableId] = nextVal;
          writePersistedVariable(variableId, nextVal);
          recomputeComputedVariables((cId, cVal) => enqueueStateChangeListeners(cId, cVal));
          const stepPayload: PipelineStepOutput = { variableId, value: nextVal, previous: prevVal };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Incremented ${variableId} -> ${String(nextVal)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { value: nextVal, previous: prevVal },
          });
          if (nextVal !== prevVal) enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
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
          const incomingVal = resolveInputValue(next.indexed, node, 'value', node.data.value ?? null, visiting, ctx, 'pipelineRef');
          let nextVal: LogicVariableValue = prevVal;

          if (op === 'reset') {
            nextVal = variableInitialValues.get(variableId) ?? prevVal;
          } else if (op === 'increment' && expectedType === 'number') {
            const rawStep = resolveInputValue(next.indexed, node, 'step', node.data.step ?? 1, visiting, ctx);
            const step = Number(rawStep ?? 1);
            const prevNum = typeof prevVal === 'number' ? prevVal : 0;
            let computed = prevNum + (Number.isFinite(step) ? step : 1);
            if (typeof node.data.min === 'number' && Number.isFinite(node.data.min)) computed = Math.max(node.data.min, computed);
            if (typeof node.data.max === 'number' && Number.isFinite(node.data.max)) computed = Math.min(node.data.max, computed);
            nextVal = computed;
          } else if (op === 'push' && expectedType === 'list') {
            nextVal = [...parseListValue(prevVal), incomingVal];
          } else if (op === 'remove' && expectedType === 'list') {
            const list = parseListValue(prevVal);
            const removed = applyListRemove(list, incomingVal, node.data.removeMode);
            nextVal = removed.changed ? removed.next : (Array.isArray(prevVal) ? prevVal : list);
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
          writePersistedVariable(variableId, nextVal);
          recomputeComputedVariables((cId, cVal) => enqueueStateChangeListeners(cId, cVal));
          const stepPayload: PipelineStepOutput = { variableId, operation: op, value: nextVal, previous: prevVal };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Update(${op}) ${variableId} -> ${JSON.stringify(nextVal)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { value: nextVal, operation: op },
          });
          if (nextVal !== prevVal) enqueueStateChangeListeners(variableId, nextVal);
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'logic.branch': {
          const mode = String(node.data.mode ?? 'if-else');
          let outPort = 'false';
          let condBool = false;
          if (mode === 'switch-case') {
            const matchVal = String(resolveInputValue(next.indexed, node, 'value', '', visiting, ctx, 'pipelineRef') ?? '');
            if (matchVal === String(node.data.caseA ?? '')) {
              outPort = 'true';
              condBool = true;
            } else if (matchVal === String(node.data.caseB ?? '')) {
              outPort = 'elseIf';
              condBool = true;
            } else {
              outPort = 'false';
              condBool = false;
            }
          } else {
            const condRaw = resolveInputValue(next.indexed, node, 'condition', Boolean(node.data.condition), visiting, ctx, 'pipelineRef');
            condBool = Boolean(condRaw);
            if (condBool) {
              outPort = 'true';
            } else if (mode === 'else-if' && Boolean(node.data.elseIfCondition)) {
              outPort = 'elseIf';
            } else {
              outPort = 'false';
            }
          }
          const stepPayload: PipelineStepOutput = { matchedBranch: outPort, condition: condBool, mode };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Branch (${mode}) -> ${outPort}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { matchedBranch: outPort, condition: condBool },
          });
          enqueueOutgoing(next.indexed, node.id, outPort, nextCtx);
          break;
        }

        case 'action.set-layer': {
          const targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          const astNode = resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens);
          if (!astNode) {
            warnings.push(`Set Layer "${node.id}" target node "${targetNodeId}" not found.`);
            break;
          }
          const property = String(node.data.property ?? 'text');
          const hasDynVal = hasDynamicInput(next.indexed, node, 'value', ctx, 'pipelineRef');
          const connectedVal = hasDynVal
            ? resolveInputValue(next.indexed, node, 'value', null, visiting, ctx, 'pipelineRef')
            : undefined;
          const ov = ensureNodeOverride(targetNodeId);
          let appliedValue: unknown = null;

          if (property === 'visible') {
            if (hasDynVal) {
              ov.visible = Boolean(connectedVal);
            } else {
              const mode = String(node.data.visibleMode ?? 'toggle');
              const curVis = ov.visible ?? astNode.visible;
              ov.visible = mode === 'show' ? true : mode === 'hide' ? false : !curVis;
            }
            appliedValue = ov.visible;
          } else if (property === 'fill') {
            const fill = String(hasDynVal ? connectedVal ?? '' : node.data.fill ?? '').trim();
            if (!isSafeCssColorValue(fill)) {
              warnings.push(`Set Layer "${node.id}" blocked unsafe CSS fill color.`);
              break;
            }
            ov.fill = fill;
            appliedValue = fill;
          } else if (property === 'opacity') {
            const rawOp = Number(hasDynVal ? connectedVal : node.data.opacity ?? 1);
            ov.opacity = Number.isFinite(rawOp) ? Math.max(0, Math.min(1, rawOp)) : 1;
            appliedValue = ov.opacity;
          } else if (property === 'transform') {
            const rawTransform = String(hasDynVal ? connectedVal ?? '' : node.data.transform ?? '').trim();
            const safeTransform = sanitizeCssTransformValue(rawTransform);
            if (rawTransform && !safeTransform) {
              warnings.push(`Set Layer "${node.id}" blocked unsafe CSS transform value.`);
            } else {
              ov.transform = safeTransform;
              appliedValue = safeTransform;
            }
          } else if (property === 'text') {
            ov.text = String(hasDynVal ? connectedVal ?? '' : node.data.text ?? '');
            appliedValue = ov.text;
          } else if (property === 'image') {
            const url = String(hasDynVal ? connectedVal ?? '' : node.data.imageUrl ?? '').trim();
            const safeUrl = url ? sanitizeImageUrl(url) : '';
            if (url && !safeUrl) {
              warnings.push(`Set Layer "${node.id}" blocked unsafe image URL.`);
            } else {
              ov.imageUrl = safeUrl ?? '';
              appliedValue = safeUrl ?? '';
            }
          } else if (property === 'disabled') {
            ov.disabled = hasDynVal ? Boolean(connectedVal) : Boolean(node.data.disabled);
            appliedValue = ov.disabled;
          }

          const stepPayload: PipelineStepOutput = {
            targetNodeId,
            targetName: astNode.name,
            property,
            value: appliedValue,
          };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set Layer(${astNode.name}).${property} = ${JSON.stringify(appliedValue)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { target: astNode.name, [property]: appliedValue },
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.set-visible': {
          const targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          const astNode = resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens);
          if (!astNode) {
            warnings.push(`Set Visible "${node.id}" target node "${targetNodeId}" not found.`);
            break;
          }
          const incomingConnected = hasDynamicInput(next.indexed, node, 'visible', ctx, 'pipelineRef');
          let nextVisible: boolean;
          if (incomingConnected) {
            nextVisible = Boolean(resolveInputValue(next.indexed, node, 'visible', true, visiting, ctx, 'pipelineRef'));
          } else {
            const mode = String(node.data.mode ?? 'toggle');
            const currentVisible = nodeOverrides[targetNodeId]?.visible ?? astNode.visible;
            nextVisible = mode === 'show' ? true : mode === 'hide' ? false : !currentVisible;
          }
          ensureNodeOverride(targetNodeId).visible = nextVisible;
          const stepPayload: PipelineStepOutput = { targetNodeId, targetName: astNode.name, visible: nextVisible };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set visible(${targetNodeId}) = ${String(nextVisible)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { target: astNode.name, visible: nextVisible },
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.set-text': {
          const targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          const astNode = resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens);
          if (!astNode || astNode.type !== 'text') {
            warnings.push(`Set Text "${node.id}" target text node "${targetNodeId}" not found.`);
            break;
          }
          const rawText = resolveInputValue(next.indexed, node, 'text', node.data.text ?? '', visiting, ctx, 'pipelineRef');
          const nextText = rawText === null || rawText === undefined ? '' : String(rawText);
          ensureNodeOverride(targetNodeId).text = nextText;
          const stepPayload: PipelineStepOutput = { targetNodeId, targetName: astNode.name, text: nextText };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set text(${targetNodeId}) = ${JSON.stringify(nextText)}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { target: astNode.name, text: nextText },
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.set-fill': {
          const targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          const astNode = resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens);
          if (!astNode || astNode.type === 'group' || astNode.type === 'component-instance') {
            warnings.push(`Set Fill "${node.id}" target node "${targetNodeId}" does not support fill.`);
            break;
          }
          const rawFill = resolveInputValue(next.indexed, node, 'fill', node.data.fill ?? '', visiting, ctx, 'pipelineRef');
          const nextFill = typeof rawFill === 'string' ? rawFill.trim() : '';
          if (!isSafeCssColorValue(nextFill)) {
            warnings.push(`Set Fill "${node.id}" blocked unsafe CSS color value.`);
            break;
          }
          ensureNodeOverride(targetNodeId).fill = nextFill;
          const stepPayload: PipelineStepOutput = { targetNodeId, targetName: astNode.name, fill: nextFill };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set fill(${targetNodeId}) = ${nextFill}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { target: astNode.name, fill: nextFill },
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.set-variant': {
          let targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          let astNode = resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens);
          if (
            (!astNode || astNode.type !== 'component-instance')
            && getNodeTargetMode(node) === 'pipeline'
            && ctx.origin?.instanceId
          ) {
            const owningAst = resolveAstNodeById(ctx.origin.instanceId, astNodesById, componentsById, tokens);
            if (owningAst && owningAst.type === 'component-instance') {
              targetNodeId = ctx.origin.instanceId;
              astNode = owningAst;
            }
          }
          if (!astNode || astNode.type !== 'component-instance') {
            warnings.push(`Set Variant "${node.id}" target "${targetNodeId}" is not a component instance.`);
            break;
          }
          const master = componentsById.get(astNode.componentId);
          const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
          const rawOpt = resolveInputValue(next.indexed, node, 'optionId', node.data.optionId ?? '', visiting, ctx, 'pipelineRef');
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
          const stepPayload: PipelineStepOutput = { targetNodeId, axisId, optionId };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set variant(${targetNodeId}, ${axisId}) = ${optionId}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.navigate': {
          const mode = String(node.data.mode ?? 'internal');
          if (mode === 'back' || mode === 'forward' || mode === 'reload' || mode === 'scroll-to' || mode === 'url-params') {
            const scrollTargetId = mode === 'scroll-to' ? resolvePipelineTargetLayerId(node, ctx) : '';
            const stepPayload: PipelineStepOutput = { mode, ...(scrollTargetId ? { targetNodeId: scrollTargetId } : {}) };
            const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Navigate (${mode})`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: stepPayload,
            });
            enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
            break;
          }
          const resolvedRoute = resolveInputValue(next.indexed, node, 'route', node.data.route ?? '', visiting, ctx, 'pipelineRef');
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
          const stepPayload: PipelineStepOutput = { mode, route: safeHref };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Navigate -> ${safeHref}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.overlay-toast': {
          const mode = String(node.data.mode ?? 'show-toast');
          const targetNodeId = resolvePipelineTargetLayerId(node, ctx);
          let stepPayload: PipelineStepOutput = { mode };
          if (mode === 'show-toast') {
            const msg = String(resolveInputValue(next.indexed, node, 'message', node.data.message ?? '', visiting, ctx, 'pipelineRef') ?? '');
            const tone = String(node.data.tone ?? 'info');
            toasts.push({ message: msg, tone });
            stepPayload = { mode, tone, message: msg };
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Toast(${tone}): ${msg}`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: { tone, message: msg },
            });
          } else if (targetNodeId && resolveAstNodeById(targetNodeId, astNodesById, componentsById, tokens)) {
            const open = mode === 'open-modal' || mode === 'open-drawer';
            ensureNodeOverride(targetNodeId).visible = open;
            stepPayload = { mode, targetNodeId, visible: open };
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `${mode}(${targetNodeId})`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: stepPayload,
            });
          }
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.system-form': {
          const sysAction = String(node.data.action ?? 'set-theme');
          let stepPayload: PipelineStepOutput = { action: sysAction };
          if (sysAction === 'set-theme') {
            const rawTheme = resolveInputValue(next.indexed, node, 'value', node.data.themeId ?? '', visiting, ctx, 'pipelineRef');
            const themeId = typeof rawTheme === 'string' ? rawTheme.trim() : '';
            if (!themeId || !themeIds.has(themeId)) {
              warnings.push(`System & Form "${node.id}" references unknown theme "${themeId}".`);
              break;
            }
            activeThemeId = themeId;
            stepPayload = { action: sysAction, themeId };
          } else if (
            sysAction === 'storage' ||
            sysAction === 'storage.set' ||
            sysAction === 'storage-set' ||
            sysAction === 'storage.write'
          ) {
            const storageKey = typeof node.data.storageKey === 'string' ? node.data.storageKey.trim() : '';
            const storageScope = node.data.storageScope === 'session' ? 'session' : 'local';
            const rawVal = resolveInputValue(next.indexed, node, 'value', node.data.value ?? '', visiting, ctx, 'pipelineRef');
            const serialized = typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal ?? '');
            if (storageKey) {
              memoryStorage[storageScope].set(storageKey, serialized);
            }
            stepPayload = {
              action: sysAction,
              storageKey,
              storageScope,
              value: rawVal,
              storageMode: 'memory',
            };
          } else if (sysAction === 'storage.get' || sysAction === 'storage-get' || sysAction === 'storage.read') {
            const storageKey = typeof node.data.storageKey === 'string' ? node.data.storageKey.trim() : '';
            const storageScope = node.data.storageScope === 'session' ? 'session' : 'local';
            const found = Boolean(storageKey && memoryStorage[storageScope].has(storageKey));
            const readVal = found ? memoryStorage[storageScope].get(storageKey)! : (node.data.value ?? '');
            stepPayload = {
              action: sysAction,
              storageKey,
              storageScope,
              value: readVal,
              found,
            };
          } else if (sysAction === 'storage.remove' || sysAction === 'storage-remove' || sysAction === 'storage.delete') {
            const storageKey = typeof node.data.storageKey === 'string' ? node.data.storageKey.trim() : '';
            const storageScope = node.data.storageScope === 'session' ? 'session' : 'local';
            if (storageKey) memoryStorage[storageScope].delete(storageKey);
            stepPayload = { action: sysAction, storageKey, storageScope, removed: true };
          } else if (sysAction === 'storage.clear' || sysAction === 'storage-clear') {
            const storageScope = node.data.storageScope === 'session' ? 'session' : 'local';
            memoryStorage[storageScope].clear();
            stepPayload = { action: sysAction, storageScope, cleared: true };
          }
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `System & Form (${sysAction})`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.set-theme': {
          const rawTheme = resolveInputValue(next.indexed, node, 'themeId', node.data.themeId ?? '', visiting, ctx, 'pipelineRef');
          const themeId = typeof rawTheme === 'string' ? rawTheme.trim() : '';
          if (!themeId || !themeIds.has(themeId)) {
            warnings.push(`Set Theme "${node.id}" references unknown theme "${themeId}".`);
            break;
          }
          activeThemeId = themeId;
          const stepPayload: PipelineStepOutput = { themeId };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Set theme -> ${themeId}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'action.media-animation':
        case 'action.play-animation': {
          const command = node.type === 'action.media-animation' ? String(node.data.command ?? 'play') : 'play';
          const explicitClipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
          const clipId =
            explicitClipId
            || (getNodeTargetMode(node) === 'pipeline' ? (ctx.origin?.animationIds[0] ?? '') : '');
          const clip = clipId ? animationsById.get(clipId) : undefined;
          if (clip && (command === 'play' || command === 'reverse')) {
            playedAnimations.push(clip.id);
          } else if (node.type === 'action.play-animation' && !clip) {
            warnings.push(`Play Animation "${node.id}" references unknown clip "${clipId}".`);
            break;
          }
          const targetId = resolvePipelineTargetLayerId(node, ctx);
          const stepPayload: PipelineStepOutput = {
            command,
            ...(clip ? { clipId: clip.id, clipName: clip.name } : { targetNodeId: targetId }),
          };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `${command} ${clip ? clip.name : String(targetId || 'media')}`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'flow.delay': {
          const dur = Number(node.data.duration ?? 300);
          const unit = node.data.unit === 's' ? 's' : 'ms';
          const stepPayload: PipelineStepOutput = { duration: dur, unit };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Delay ${dur}${unit} (simulated)`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'next', nextCtx);
          break;
        }

        case 'flow.loop-timer': {
          const mode = String(node.data.mode ?? 'for-each');
          if (mode === 'for-each') {
            const list = parseListValue(resolveInputValue(next.indexed, node, 'list', [], visiting, ctx, 'pipelineRef'));
            const cap = Math.min(list.length, Math.max(1, Number(node.data.maxIterations ?? 50)));
            for (let idx = 0; idx < cap; idx += 1) {
              const iterCtx = clonePipelineContextWithStep(ctx, node.id, { item: list[idx], index: idx });
              enqueueOutgoing(next.indexed, node.id, 'tick', iterCtx);
            }
            const donePayload: PipelineStepOutput = { mode, count: cap };
            const doneCtx = clonePipelineContextWithStep(ctx, node.id, donePayload);
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `For Each (${cap} items)`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: donePayload,
            });
            enqueueOutgoing(next.indexed, node.id, 'done', doneCtx);
          } else {
            const stepPayload: PipelineStepOutput = { mode, timerId: String(node.data.timerId ?? 'timer') };
            const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
            trace.push({
              step: totalSteps,
              graphId: next.indexed.graph.id,
              nodeId: node.id,
              nodeType: node.type,
              detail: `Timer ${mode} (${String(node.data.timerId ?? 'timer')})`,
              originLayerId: ctx.origin?.layerId ?? null,
              payload: stepPayload,
            });
            if (mode === 'interval-start') enqueueOutgoing(next.indexed, node.id, 'tick', nextCtx);
            else enqueueOutgoing(next.indexed, node.id, 'done', nextCtx);
          }
          break;
        }

        case 'flow.control': {
          const mode = String(node.data.mode ?? 'sequence');
          const stepPayload: PipelineStepOutput = { mode };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Flow Control (${mode})`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          enqueueOutgoing(next.indexed, node.id, 'step1', nextCtx);
          enqueueOutgoing(next.indexed, node.id, 'step2', nextCtx);
          enqueueOutgoing(next.indexed, node.id, 'done', nextCtx);
          break;
        }

        case 'network.http': {
          const method = String(node.data.method ?? 'GET').trim().toUpperCase();
          const netSettings = next.indexed.graph.networkSettings;
          const url = resolveEndpointWithBaseUrl(String(node.data.url ?? '/api/items'), netSettings?.baseUrl);
          if (node.data.executionMode === 'live') {
            const rawBody = resolveInputValue(next.indexed, node, 'body', node.data.body ?? '', visiting, ctx, 'pipelineRef');
            const bodyStr =
              typeof rawBody === 'string'
                ? rawBody
                : rawBody !== undefined && rawBody !== null && rawBody !== ''
                  ? JSON.stringify(rawBody)
                  : undefined;
            const loadPayload: PipelineStepOutput = { loading: true, method, url };
            const loadCtx = clonePipelineContextWithStep(ctx, node.id, loadPayload);
            enqueueOutgoing(next.indexed, node.id, 'loading', loadCtx);
            if (pendingAsyncJobs) {
              const safeHeaders = parseGraphSafeHeaders(netSettings?.globalHeaders);
              const authSecretRef =
                node.data.useAuth && netSettings?.authSecretRef ? netSettings.authSecretRef : undefined;
              trace.push({
                step: totalSteps,
                graphId: next.indexed.graph.id,
                nodeId: node.id,
                nodeType: node.type,
                detail: `HTTP ${method} ${url} -> loading (live)`,
                originLayerId: ctx.origin?.layerId ?? null,
                payload: { method, url, mode: 'live' },
              });
              pendingAsyncJobs.push({
                kind: 'network.http',
                indexed: next.indexed,
                node,
                ctx,
                request: {
                  url,
                  method,
                  ...(safeHeaders ? { headers: safeHeaders } : {}),
                  ...(bodyStr && method !== 'GET' && method !== 'HEAD' ? { body: bodyStr } : {}),
                  ...(authSecretRef ? { authSecretRef } : {}),
                },
              });
            } else {
              warnings.push(
                `HTTP Request node "${node.id}" is in live mode; use dispatchNodeEventAsync() for live HTTP execution.`,
              );
              const errPayload: PipelineStepOutput = {
                data: null,
                status: 0,
                error: 'Live HTTP requires async execution (dispatchNodeEventAsync).',
              };
              latestHttpResponses.set(node.id, {
                data: null,
                status: 0,
                ok: false,
                error: 'Live HTTP requires async execution (dispatchNodeEventAsync).',
              });
              const errCtx = clonePipelineContextWithStep(ctx, node.id, errPayload);
              trace.push({
                step: totalSteps,
                graphId: next.indexed.graph.id,
                nodeId: node.id,
                nodeType: node.type,
                detail: `HTTP ${method} ${url} -> live execution requires async runtime`,
                originLayerId: ctx.origin?.layerId ?? null,
                payload: { method, url, status: 0, error: errPayload.error },
              });
              enqueueOutgoing(next.indexed, node.id, 'error', errCtx);
            }
            break;
          }
          const simulatedPayload = { ok: true, method, url, data: { items: [] } };
          const stepPayload: PipelineStepOutput = { data: simulatedPayload, status: 200 };
          latestHttpResponses.set(node.id, { data: simulatedPayload, status: 200, ok: true });
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `HTTP ${method} ${url} -> 200 (simulated)`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: { method, url, status: 200 },
          });
          enqueueOutgoing(next.indexed, node.id, 'loading', nextCtx);
          enqueueOutgoing(next.indexed, node.id, 'success', nextCtx);
          break;
        }

        case 'network.socket': {
          const action = String(node.data.action ?? 'listen');
          const channel = String(node.data.channel ?? 'updates');
          const stepPayload: PipelineStepOutput = {
            action,
            channel,
            connected: false,
            simulated: true,
          };
          const nextCtx = clonePipelineContextWithStep(ctx, node.id, stepPayload);
          trace.push({
            step: totalSteps,
            graphId: next.indexed.graph.id,
            nodeId: node.id,
            nodeType: node.type,
            detail: `Socket ${action} #${channel} (simulated — live WebSocket unavailable)`,
            originLayerId: ctx.origin?.layerId ?? null,
            payload: stepPayload,
          });
          if (action === 'listen' || action === 'connect') {
            enqueueOutgoing(next.indexed, node.id, 'onMessage', nextCtx);
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

      if (activeFrameGroup && trace.length > traceLenBefore) {
        const addedEntries = trace.splice(traceLenBefore);
        for (const entry of addedEntries) {
          activeFrameGroup.nestedSteps.push(entry);
          if (entry.payload) {
            activeFrameGroup.lastPayload = entry.payload;
          }
        }
        const count = activeFrameGroup.nestedSteps.length;
        const existingGroup = trace[activeFrameGroup.traceIndex];
        if (existingGroup) {
          trace[activeFrameGroup.traceIndex] = {
            ...existingGroup,
            detail: `Baked Frame “${activeFrameGroup.frame.title}” (${count} step${count === 1 ? '' : 's'})`,
            ...(activeFrameGroup.lastPayload ? { payload: { ...activeFrameGroup.lastPayload } } : {}),
            nestedSteps: [...activeFrameGroup.nestedSteps],
          };
        }
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
      privateMemory: { ...privateMemory },
      nodeOverrides: clonedOverrides,
      playedAnimations: [...playedAnimations],
      ...(toasts.length > 0 ? { toasts: [...toasts] } : {}),
      trace: trace.map((entry) => ({
        ...entry,
        ...(entry.payload ? { payload: { ...entry.payload } } : {}),
        ...(entry.nestedSteps
          ? {
              nestedSteps: entry.nestedSteps.map((nested) => ({
                ...nested,
                ...(nested.payload ? { payload: { ...nested.payload } } : {}),
              })),
            }
          : {}),
      })),
      warnings: [...warnings],
    };
  };

  const collectOutgoingForPort = (
    indexed: IndexedGraph,
    nodeId: string,
    portId: string,
    nextCtx: PipelineContext,
  ): ExecutionQueueItem[] => {
    const items: ExecutionQueueItem[] = [];
    const bakedEntry = indexed.compiledStepByNodeId.get(nodeId);
    if (bakedEntry) {
      const internalNext = bakedEntry.step.nextByPort[portId] ?? [];
      for (const edge of internalNext) {
        items.push({ indexed, nodeId: edge.targetNodeId, context: nextCtx });
      }
      const outgoingAll = indexed.outgoingBySource.get(`${nodeId}:${portId}`) ?? [];
      for (const conn of outgoingAll) {
        if (!bakedEntry.childSet.has(conn.targetNodeId)) {
          items.push({ indexed, nodeId: conn.targetNodeId, context: nextCtx });
        }
      }
      return items;
    }
    const connections = indexed.outgoingBySource.get(`${nodeId}:${portId}`) ?? [];
    for (const conn of connections) {
      items.push({ indexed, nodeId: conn.targetNodeId, context: nextCtx });
    }
    return items;
  };

  const runExecutionQueueAsync = async (initialQueue: ExecutionQueueItem[]) => {
    let pending: PendingLiveHttpJob[] = [];
    runExecutionQueue(initialQueue, pending);
    let asyncDepth = 0;
    while (pending.length > 0 && asyncDepth < 16) {
      asyncDepth += 1;
      const batch = pending;
      pending = [];
      for (const job of batch) {
        const res = await invokeLiveHttpProxy(job.request);
        if (job.kind === 'network.http') {
          const ok = Boolean(res.ok);
          const stepOut: PipelineStepOutput = {
            data: res.data ?? null,
            status: res.status ?? 0,
            ok,
            ...(res.error ? { error: res.error } : {}),
          };
          latestHttpResponses.set(job.node.id, {
            data: res.data ?? null,
            status: res.status ?? 0,
            ok,
            error: res.error,
          });
          totalSteps += 1;
          trace.push({
            step: totalSteps,
            graphId: job.indexed.graph.id,
            nodeId: job.node.id,
            nodeType: job.node.type,
            detail: `HTTP ${job.request.method} ${job.request.url} -> ${res.status ?? 0} (${ok ? 'live ok' : 'live error'})`,
            originLayerId: job.ctx.origin?.layerId ?? null,
            payload: {
              method: job.request.method,
              url: job.request.url,
              status: res.status ?? 0,
              ok,
              ...(res.error ? { error: res.error } : {}),
            },
          });
          const resCtx = clonePipelineContextWithStep(job.ctx, job.node.id, stepOut);
          const nextItems = collectOutgoingForPort(
            job.indexed,
            job.node.id,
            ok ? 'success' : 'error',
            resCtx,
          );
          if (nextItems.length > 0) {
            runExecutionQueue(nextItems, pending);
          }
        } else {
          const ok = Boolean(res.ok);
          const listData = ok ? normalizeExternalListData(res.data) : [];
          const stepOut: PipelineStepOutput = {
            data: listData,
            count: listData.length,
            status: res.status ?? 0,
            ok,
            ...(res.error ? { error: res.error } : {}),
          };
          latestExternalData.set(job.node.id, {
            data: listData,
            count: listData.length,
            status: res.status ?? 0,
            ok,
            error: res.error,
          });
          totalSteps += 1;
          trace.push({
            step: totalSteps,
            graphId: job.indexed.graph.id,
            nodeId: job.node.id,
            nodeType: job.node.type,
            detail: `External Data GET ${job.request.url} -> ${res.status ?? 0} (${ok ? `${listData.length} items` : 'error'})`,
            originLayerId: job.ctx.origin?.layerId ?? null,
            payload: {
              url: job.request.url,
              status: res.status ?? 0,
              count: listData.length,
              ok,
              ...(res.error ? { error: res.error } : {}),
            },
          });
          if (!ok) {
            warnings.push(
              `External Data node "${job.node.id}" failed (${res.status ?? 0}): ${res.error ?? 'Request failed.'}`,
            );
          } else {
            const resCtx = clonePipelineContextWithStep(job.ctx, job.node.id, stepOut);
            const nextItems = collectOutgoingForPort(job.indexed, job.node.id, 'onReady', resCtx);
            if (nextItems.length > 0) {
              runExecutionQueue(nextItems, pending);
            }
          }
        }
      }
    }
  };

  const buildMountStarters = (): ExecutionQueueItem[] => {
    const starters: ExecutionQueueItem[] = [];
    for (const indexed of indexedGraphs) {
      const mountOrigin = indexed.instanceId
        ? buildPipelineOriginRef(
            indexed.instanceId,
            astNodesById,
            componentsById,
            project.animations,
            tokens,
          )
        : null;
      for (const node of indexed.graph.nodes) {
        if (node.type === 'event.on-page-load') {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('mount'), 'page-load', mountOrigin),
          });
        } else if (node.type === 'event.on-lifecycle' && (node.data.trigger === 'page-load' || !node.data.trigger)) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('lifecycle'), 'page-load', mountOrigin),
          });
        } else if (node.type === 'source.page' && node.data.pageId === activePageId) {
          starters.push({
            indexed,
            nodeId: node.id,
            outPortId: 'onLoad',
            context: createPipelineContext(nextExecutionId('page'), 'page-load', mountOrigin),
          });
        } else if (
          node.type === 'source.context' &&
          (node.data.contextKind === 'page' || !node.data.contextKind) &&
          (!node.data.pageId || node.data.pageId === activePageId)
        ) {
          starters.push({
            indexed,
            nodeId: node.id,
            outPortId: 'onLoad',
            context: createPipelineContext(nextExecutionId('context'), 'page-load', mountOrigin),
          });
        } else if (node.type === 'source.external') {
          starters.push({
            indexed,
            nodeId: node.id,
            outPortId: 'onReady',
            context: createPipelineContext(nextExecutionId('external'), 'page-load', mountOrigin),
          });
        }
      }
    }
    return starters;
  };

  const buildNodeEventStarters = (
    nodeId: string,
    event: LogicNodeEventKind,
    payload?: unknown,
  ): ExecutionQueueItem[] => {
    const targetAstNode = resolveAstNodeById(nodeId, astNodesById, componentsById, tokens);
    const targetComponentId =
      targetAstNode && targetAstNode.type === 'component-instance'
        ? targetAstNode.componentId
        : null;
    const originRef = buildPipelineOriginRef(
      nodeId,
      astNodesById,
      componentsById,
      project.animations,
      tokens,
    );
    const starters: ExecutionQueueItem[] = [];
    for (const indexed of indexedGraphs) {
      for (const node of indexed.graph.nodes) {
        if (
          (event === 'click' || event === 'double-click' || event === 'click-outside') &&
          node.type === 'event.on-click' &&
          node.data.targetNodeId === nodeId &&
          String(node.data.mode ?? 'click') === event
        ) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId(event), event, originRef),
            initialStepPayload: { targetLayerId: nodeId, mode: event },
          });
        } else if (
          event === 'hover-enter' &&
          node.type === 'event.on-hover' &&
          node.data.targetNodeId === nodeId &&
          (node.data.phase === undefined || node.data.phase === 'enter')
        ) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('hover'), 'hover-enter', originRef),
            initialStepPayload: { targetLayerId: nodeId, isHovered: true },
          });
        } else if (
          event === 'hover-leave' &&
          node.type === 'event.on-hover' &&
          node.data.targetNodeId === nodeId &&
          node.data.phase === 'leave'
        ) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('hover'), 'hover-leave', originRef),
            initialStepPayload: { targetLayerId: nodeId, isHovered: false },
          });
        } else if (event === 'input' && node.type === 'event.on-input' && node.data.targetNodeId === nodeId) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('input'), 'input', originRef),
            initialStepPayload: { targetLayerId: nodeId, value: payload ?? '' },
          });
        } else if (event === 'key-press' && node.type === 'event.on-key-press') {
          const expectedCombo = typeof node.data.keyCombo === 'string' ? node.data.keyCombo.trim().toLowerCase() : '';
          const actualCombo = typeof payload === 'string' ? payload.trim().toLowerCase() : '';
          if (actualCombo && expectedCombo && actualCombo !== expectedCombo) continue;
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('key'), 'key-press', originRef),
            initialStepPayload: { key: payload ?? node.data.keyCombo ?? 'Enter' },
          });
        } else if (event === 'drag' && node.type === 'event.on-drag' && node.data.targetNodeId === nodeId) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('drag'), 'drag', originRef),
            initialStepPayload: { targetLayerId: nodeId, phase: String(node.data.phase ?? 'start') },
          });
        } else if (
          event === 'scroll-view' &&
          node.type === 'event.on-scroll-view' &&
          (node.data.mode === 'page-scroll' || node.data.targetNodeId === nodeId)
        ) {
          starters.push({
            indexed,
            nodeId: node.id,
            context: createPipelineContext(nextExecutionId('scroll'), 'scroll-view', originRef),
            initialStepPayload: { progress: typeof payload === 'number' ? payload : 1 },
          });
        } else if (
          node.type === 'source.element' &&
          (node.data.targetNodeId === nodeId || (targetComponentId && node.data.componentId === targetComponentId))
        ) {
          if (event === 'click') {
            starters.push({
              indexed,
              nodeId: node.id,
              outPortId: 'onClick',
              context: createPipelineContext(nextExecutionId('src-click'), 'click', originRef),
            });
          } else if (event === 'hover-enter') {
            starters.push({
              indexed,
              nodeId: node.id,
              outPortId: 'onHover',
              context: createPipelineContext(nextExecutionId('src-hover'), 'hover-enter', originRef),
            });
          }
        } else if (
          node.type === 'source.component' &&
          (typeof node.data.targetNodeId === 'string' && node.data.targetNodeId.trim().length > 0
            ? node.data.targetNodeId.trim() === nodeId
            : ((targetComponentId && node.data.componentId === targetComponentId) || node.data.componentId === nodeId))
        ) {
          if (event === 'click') {
            starters.push({
              indexed,
              nodeId: node.id,
              outPortId: 'onClick',
              context: createPipelineContext(nextExecutionId('comp-click'), 'click', originRef),
            });
          } else if (event === 'hover-enter') {
            starters.push({
              indexed,
              nodeId: node.id,
              outPortId: 'onHover',
              context: createPipelineContext(nextExecutionId('comp-hover'), 'hover-enter', originRef),
            });
          }
        }
      }
    }
    return starters;
  };

  return {
    mount() {
      if (mounted) return getSnapshot();
      mounted = true;
      const starters = buildMountStarters();
      if (starters.length > 0) {
        runExecutionQueue(starters);
      }
      return getSnapshot();
    },

    async mountAsync() {
      if (mounted) return getSnapshot();
      mounted = true;
      const starters = buildMountStarters();
      if (starters.length > 0) {
        await runExecutionQueueAsync(starters);
      }
      return getSnapshot();
    },

    dispatchNodeEvent(nodeId: string, event: LogicNodeEventKind, payload?: unknown) {
      const starters = buildNodeEventStarters(nodeId, event, payload);
      if (starters.length > 0) {
        runExecutionQueue(starters);
      }
      return getSnapshot();
    },

    async dispatchNodeEventAsync(nodeId: string, event: LogicNodeEventKind, payload?: unknown) {
      const starters = buildNodeEventStarters(nodeId, event, payload);
      if (starters.length > 0) {
        await runExecutionQueueAsync(starters);
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
      writePersistedVariable(variableId, coerced);
      const changedIds: Array<{ id: string; val: LogicVariableValue }> = [];
      if (coerced !== prev) {
        changedIds.push({ id: variableId, val: coerced });
      }
      recomputeComputedVariables((cId, cVal) => {
        changedIds.push({ id: cId, val: cVal });
      });
      if (changedIds.length > 0) {
        const starters: ExecutionQueueItem[] = [];
        for (const changed of changedIds) {
          for (const indexed of indexedGraphs) {
            for (const node of indexed.graph.nodes) {
              if (node.type === 'event.on-state-change' && node.data.variableId === changed.id) {
                const stateOrigin = indexed.instanceId
                  ? buildPipelineOriginRef(
                      indexed.instanceId,
                      astNodesById,
                      componentsById,
                      project.animations,
                      tokens,
                    )
                  : null;
                starters.push({
                  indexed,
                  nodeId: node.id,
                  context: createPipelineContext(nextExecutionId('state'), 'state-change', stateOrigin),
                  initialStepPayload: { variableId: changed.id, value: changed.val },
                });
              }
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
      latestHttpResponses.clear();
      latestExternalData.clear();
      loadPageContext(page, false);
      resetState();
      return getSnapshot();
    },

    getSnapshot,
  };
}

/**
 * Folio Node Logic — Runtime Parity Unification Layer (Phase 2).
 *
 * Provides a single canonical compilation contract shared by:
 * 1. Headless Prototype Simulator (`runtime.ts`)
 * 2. Live Preview Micro-Runtime (`buildLivePreviewLogicScript` in `codegen.ts`)
 * 3. Exported React TSX Codegen (`buildReactPageLogicPlan` in `codegen.ts` + `reactCompiler.ts`)
 *
 * Guarantees:
 * - Zero credential leakage (strips legacy `authToken` fields if present).
 * - Identical Scoped Pipeline metadata (`nodeMeta`, `children`, `animationIds`).
 * - Identical Baked Logic Frame payloads (`compiledPlan`, `childNodeIds`).
 * - Pipeline-aware dynamic target discovery for React TSX (`targetMode: 'pipeline'` + `pipelineChildId`).
 * - Explicit, unit-testable capability parity matrix across all 31 primary nodes.
 */

import {
  isSensitiveHeaderName,
  sanitizeGlobalHeadersForPersistence,
  sanitizeLogicNodeDataRecord,
} from '../../core/document/networkSecrets';
import { getProjectDesignTokens, toDesignTokenThemeSlug } from '../../core/document/tokens';
import type {
  DesignNode,
  FolioPage,
  FolioProject,
  LogicFrameCompiledPlan,
  LogicGraph,
  LogicNode,
  LogicVariableValue,
} from '../../core/document/types';
import { toKebabCase } from '../codegen/sanitize';
import { buildLivePreviewAnimationPayload } from '../animation/codegen';
import { isBuiltInLogicNodeType, type BuiltInLogicNodeType } from './catalog';
import {
  COMPONENT_INSTANCE_NODE_SEP,
  collectPageComponentInstances,
  getInstanceIdFromExpandedGraphId,
} from './componentScope';
import { buildPipelineOriginRef, getNodeTargetMode, getUpstreamPipelineOrigins } from './pipeline';
import { MAX_LOGIC_EXECUTION_STEPS } from './runtime';

export type ParitySupportLevel = 'full' | 'simulated' | 'unsupported' | 'not-applicable';

export interface NodeRuntimeParityEntry {
  readonly type: BuiltInLogicNodeType;
  readonly headless: ParitySupportLevel;
  readonly livePreview: ParitySupportLevel;
  readonly reactCodegen: ParitySupportLevel;
  readonly notes: string;
}

export interface RuntimeFeatureParityEntry {
  readonly feature:
    | 'component.scoped-logic'
    | 'pipeline.scoped-context'
    | 'frame.baked'
    | 'legacy.v1-migration'
    | 'variable.persist'
    | 'variable.computed'
    | 'motion.shape-morph';
  readonly headless: ParitySupportLevel;
  readonly livePreview: ParitySupportLevel;
  readonly reactCodegen: ParitySupportLevel;
  readonly notes: string;
}

/**
 * Explicit capability parity matrix for cross-cutting Node Logic runtime
 * features (Component-Scoped Logic, Pipeline Context, Baked Frames, Legacy v1
 * compatibility, and Variable metadata capabilities).
 */
export const RUNTIME_FEATURE_PARITY_MATRIX: readonly RuntimeFeatureParityEntry[] = [
  {
    feature: 'component.scoped-logic',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Per-instance expansion with nodeLogicEnabled gate, Master->Variants->Slots->Local Overrides->Tokens precedence, and isolated memory/state',
  },
  {
    feature: 'pipeline.scoped-context',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Scoped PipelineContext (origin, instanceId, children, animationIds, steps) across page, group, and component instances',
  },
  {
    feature: 'frame.baked',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Pre-compiled compiledPlan execution with instance+frame+node+origin private memory isolation',
  },
  {
    feature: 'legacy.v1-migration',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: '13 legacy v1 node types executed natively with full .flop JSON v2 backward compatibility',
  },
  {
    feature: 'variable.persist',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Persists and hydrates declared local/session variables safely across Headless Simulator, Live Preview (with automatic sandbox in-memory fallback), and Exported React TSX',
  },
  {
    feature: 'variable.computed',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Evaluated reactively using FOLIO zero-eval recursive-descent expression evaluator across Headless Simulator, Live Preview, and Exported React TSX',
  },
  {
    feature: 'motion.shape-morph',
    headless: 'full',
    livePreview: 'full',
    reactCodegen: 'full',
    notes: 'Single-contour and multi-contour (compound paths & holes) closed shape morphing runs natively across Canvas/Headless Motion Evaluator, Animated SVG SMIL, Video/GIF/PNG Sequence export, CSP-safe Live Preview/HTML5 runtime, and React TSX export (`useFolioShapeMorph` hook)',
  },
] as const;

/**
 * Canonical runtime parity matrix for all 31 primary Node Logic types across
 * Headless Simulator, Live Preview Micro-Runtime, and React TSX Codegen.
 */
export const NODE_RUNTIME_PARITY_MATRIX: readonly NodeRuntimeParityEntry[] = [
  // Sources (3)
  { type: 'source.element', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Element triggers & property reads' },
  { type: 'source.context', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Page route, theme, viewport, URL params, auth context' },
  { type: 'source.external', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Live HTTP via /api/logic/http-proxy in Headless async (mountAsync), Live Preview, and React TSX; deterministic offline simulation when executionMode is simulated (zero embedded secrets)' },
  // Events (8)
  { type: 'event.on-click', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Click, Double Click, Click Outside + once guard' },
  { type: 'event.on-hover', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Hover enter/leave + once guard' },
  { type: 'event.on-input', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Input change/focus/blur/submit + once guard' },
  { type: 'event.on-key-press', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Key combo down/up + once guard' },
  { type: 'event.on-drag', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Drag start/move/drop + once guard' },
  { type: 'event.on-scroll-view', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Scroll / IntersectionObserver enter-view & leave-view' },
  { type: 'event.on-lifecycle', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Page load, route change, resize, animation end' },
  { type: 'event.on-state-change', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Reactive variable watch listener' },
  // State (3)
  { type: 'state.get', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Reads declared graph variable' },
  { type: 'state.toggle', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Private per-target+frame boolean memory OR shared boolean variable' },
  { type: 'state.update', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Set, increment, reset, push, remove, set-property, cycle' },
  // Logic (5)
  { type: 'logic.branch', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'If/Else, Else If, Switch/Case with pipelineRef support' },
  { type: 'logic.condition', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Compare, AND/OR/NOT, Is Empty, Regex with leftRef/rightRef' },
  { type: 'logic.math', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: '+, -, *, /, %, Clamp, Map Range' },
  { type: 'logic.text', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Template interpolation, Format Number, Format Currency' },
  { type: 'logic.list', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Filter, Sort, Count, Map over list values' },
  // Actions (6)
  { type: 'action.set-layer', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Visible, fill, opacity, transform, text, image, disabled + transitionMs + pipeline targeting' },
  { type: 'action.set-variant', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Component instance variant axis switching + pipeline targeting' },
  { type: 'action.media-animation', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Play/pause/stop/reverse animation clips + pipeline origin clip resolution' },
  { type: 'action.navigate', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Internal, external, scroll-to, url-params, back/forward/reload with SAFE_HREF guard' },
  { type: 'action.overlay-toast', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Open/close modal/drawer + safe zero-innerHTML toast notifications' },
  { type: 'action.system-form', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Theme switch, clipboard, focus/blur/reset form, web storage (with sandbox in-memory fallback)' },
  // Flow & Timing (3)
  { type: 'flow.delay', headless: 'simulated', livePreview: 'full', reactCodegen: 'simulated', notes: 'Timed delay (real setTimeout in Live Preview; deterministic synchronous execution in Headless & React TSX)' },
  { type: 'flow.loop-timer', headless: 'simulated', livePreview: 'full', reactCodegen: 'simulated', notes: 'For-each list iteration full across all 3; interval timer real in Live Preview and single-tick simulated in Headless & React TSX' },
  { type: 'flow.control', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Sequence, parallel, debounce/throttle fan-out' },
  // Network & Backend (3)
  { type: 'network.http', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Live HTTP via /api/logic/http-proxy in Headless async (dispatchNodeEventAsync), Live Preview, and React TSX; deterministic offline simulation when executionMode is simulated (zero embedded secrets)' },
  { type: 'network.json', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Get field, parse, stringify, validity check' },
  { type: 'network.socket', headless: 'simulated', livePreview: 'simulated', reactCodegen: 'simulated', notes: 'Simulated offline channel only — live WebSocket transport is not yet available (zero embedded secrets)' },
] as const;

export interface CompiledOriginChildMeta {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface CompiledRuntimeNodeMeta {
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly display: 'flex' | 'grid' | 'block';
  readonly text?: string;
  readonly fill?: string;
  readonly opacity?: number;
  readonly componentId?: string;
  readonly instanceId?: string;
  readonly animationIds?: readonly string[];
  readonly children?: readonly CompiledOriginChildMeta[];
  readonly baseText?: string;
  readonly baseFill?: string;
  readonly baseStroke?: string;
  readonly baseVisible?: boolean;
  readonly lockText?: boolean;
  readonly lockFill?: boolean;
  readonly lockStroke?: boolean;
  readonly lockVisible?: boolean;
  readonly variantSelection?: Readonly<Record<string, string>>;
}

export interface CompiledVariantPatch {
  readonly fill?: string;
  readonly stroke?: string;
  readonly text?: string;
  readonly visible?: boolean;
}

export interface CompiledVariantAxisMap {
  readonly dataAttr: string;
  readonly defaultOptionId: string;
  readonly options: Record<string, { readonly label: string; readonly overrides: Record<string, CompiledVariantPatch> }>;
}

export interface CompiledBakedFramePayload {
  readonly id: string;
  readonly title: string;
  readonly childNodeIds: readonly string[];
  readonly compiledPlan: LogicFrameCompiledPlan;
}

export interface CompiledRuntimeGraphPayload {
  readonly id: string;
  readonly instanceId?: string;
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly data: Record<string, unknown>;
  }>;
  readonly connections: ReadonlyArray<{
    readonly sourceNodeId: string;
    readonly sourcePortId: string;
    readonly targetNodeId: string;
    readonly targetPortId: string;
  }>;
  readonly bakedFrames: readonly CompiledBakedFramePayload[];
}

export interface CompiledPageLogicRuntimeConfig {
  readonly activePageId: string;
  readonly activeRoute: string;
  readonly activeThemeId: string;
  readonly maxSteps: number;
  readonly variables: Record<string, LogicVariableValue>;
  readonly variableInitialValues: Record<string, LogicVariableValue>;
  readonly variableTypes: Record<string, string>;
  readonly variableNameToId: Record<string, string>;
  readonly variablePersist: Record<string, 'local' | 'session'>;
  readonly variableComputed: Record<string, string>;
  readonly networkSettingsByGraphId: Record<
    string,
    {
      readonly baseUrl?: string;
      readonly authSecretRef?: string;
      readonly globalHeaders?: Readonly<Record<string, string>>;
    }
  >;
  readonly nodeMeta: Record<string, CompiledRuntimeNodeMeta>;
  readonly pageRouteById: Record<string, string>;
  readonly themeSlugById: Record<string, string>;
  readonly componentVariants: Record<string, Record<string, CompiledVariantAxisMap>>;
  readonly variantLabels: Record<string, Record<string, Record<string, string>>>;
  readonly animationClassById: Record<string, string>;
  readonly graphs: readonly CompiledRuntimeGraphPayload[];
}

/**
 * Strips any credential fields (`authToken`, sensitive headers, raw tokens,
 * embedded URL credentials) from node data using the single-source-of-truth
 * sanitizer so compiled Live Preview scripts and exported React TSX files can
 * never leak secrets.
 */
export function sanitizeNodeDataForRuntime(node: LogicNode): Record<string, unknown> {
  return { ...sanitizeLogicNodeDataRecord(node.type, node.data) };
}

function extractNodeFill(node: DesignNode): string | undefined {
  if ('style' in node && node.style && 'fill' in node.style && typeof node.style.fill === 'string') {
    return node.style.fill;
  }
  return undefined;
}

function extractNodeStroke(node: DesignNode): string | undefined {
  if ('style' in node && node.style && 'stroke' in node.style && typeof node.style.stroke === 'string') {
    return node.style.stroke;
  }
  return undefined;
}

/**
 * Compiles the canonical runtime configuration payload for a page's active
 * Node Logic graphs. Shared by both Live Preview and React TSX codegen to
 * prevent drift in variable types, Scoped Pipeline metadata, variant maps,
 * theme slugs, animation classes, and Baked Logic Frames.
 */
export function parseSafeRuntimeHeaders(
  rawGlobalHeaders: string | undefined,
): Record<string, string> | undefined {
  if (!rawGlobalHeaders || !rawGlobalHeaders.trim()) return undefined;
  const sanitized = sanitizeGlobalHeadersForPersistence(rawGlobalHeaders).trim();
  if (!sanitized) return undefined;
  try {
    const parsed = JSON.parse(sanitized) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const trimmedKey = key.trim();
      if (!trimmedKey || trimmedKey === '__proto__' || trimmedKey === 'constructor' || trimmedKey === 'prototype') {
        continue;
      }
      if (isSensitiveHeaderName(trimmedKey)) continue;
      if (!/^[a-zA-Z0-9-]+$/.test(trimmedKey)) continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[trimmedKey] = String(val).replace(/[\r\n\u0000]/g, '').slice(0, 1024);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function compilePageLogicRuntimeConfig(
  project: FolioProject,
  page: FolioPage,
  graphs: readonly LogicGraph[],
): CompiledPageLogicRuntimeConfig {
  const tokens = getProjectDesignTokens(project);
  const variables: Record<string, LogicVariableValue> = {};
  const variableInitialValues: Record<string, LogicVariableValue> = {};
  const variableTypes: Record<string, string> = {};
  const variableNameToId: Record<string, string> = {};
  const variablePersist: Record<string, 'local' | 'session'> = {};
  const variableComputed: Record<string, string> = {};
  const networkSettingsByGraphId: Record<
    string,
    {
      readonly baseUrl?: string;
      readonly authSecretRef?: string;
      readonly globalHeaders?: Readonly<Record<string, string>>;
    }
  > = {};

  for (const graph of graphs) {
    const isInstanceGraph = Boolean(getInstanceIdFromExpandedGraphId(graph.id));
    if (graph.networkSettings) {
      const parsedHeaders = parseSafeRuntimeHeaders(graph.networkSettings.globalHeaders);
      if (graph.networkSettings.baseUrl || graph.networkSettings.authSecretRef || parsedHeaders) {
        networkSettingsByGraphId[graph.id] = {
          ...(graph.networkSettings.baseUrl ? { baseUrl: graph.networkSettings.baseUrl } : {}),
          ...(graph.networkSettings.authSecretRef ? { authSecretRef: graph.networkSettings.authSecretRef } : {}),
          ...(parsedHeaders ? { globalHeaders: parsedHeaders } : {}),
        };
      }
    }
    for (const variable of graph.variables ?? []) {
      variableTypes[variable.id] = variable.valueType;
      if (variable.persist === 'local' || variable.persist === 'session') {
        variablePersist[variable.id] = variable.persist;
      }
      if (variable.computed && typeof variable.computedExpression === 'string' && variable.computedExpression.trim()) {
        variableComputed[variable.id] = variable.computedExpression.trim();
      }
      if (!isInstanceGraph || !Object.prototype.hasOwnProperty.call(variableNameToId, variable.name)) {
        variableNameToId[variable.name] = variable.id;
        variableNameToId[variable.name.toLowerCase()] = variable.id;
      }
      if (!Object.prototype.hasOwnProperty.call(variables, variable.id)) {
        variables[variable.id] = variable.initialValue;
        variableInitialValues[variable.id] = variable.initialValue;
      }
    }
  }

  const astNodesById = new Map(page.document.nodes.map((node) => [node.id, node]));
  const componentsById = new Map(project.components.map((comp) => [comp.id, comp]));
  const { expandedInstances } = collectPageComponentInstances(project, page);

  const nodeMeta: Record<string, CompiledRuntimeNodeMeta> = {};
  for (const node of page.document.nodes) {
    const originRef = buildPipelineOriginRef(
      node.id,
      astNodesById,
      componentsById,
      project.animations,
      tokens,
    );
    const fill = extractNodeFill(node);
    nodeMeta[node.id] = {
      name: node.name,
      type: node.type,
      visible: node.visible,
      display: node.layout?.mode === 'flex' ? 'flex' : node.layout?.mode === 'grid' ? 'grid' : 'block',
      ...(node.type === 'text' ? { text: node.text } : {}),
      ...(fill !== undefined ? { fill } : {}),
      opacity: node.opacity,
      ...(node.type === 'component-instance' ? { componentId: node.componentId } : {}),
      ...(node.type === 'component-instance' && node.variantSelection
        ? { variantSelection: { ...node.variantSelection } }
        : {}),
      ...(originRef?.instanceId ? { instanceId: originRef.instanceId } : {}),
      ...(originRef && originRef.animationIds.length > 0 ? { animationIds: originRef.animationIds } : {}),
      ...(originRef?.children && originRef.children.length > 0
        ? {
            children: originRef.children.map((child) => ({
              id: child.id,
              name: child.name,
              type: child.type,
            })),
          }
        : {}),
    };
  }

  // Populate resolved metadata for every expanded component instance (including nested instances)
  // respecting canonical precedence: Master -> Variants -> Slots -> Local Overrides -> Tokens.
  for (const instance of expandedInstances) {
    const masterNodesById = new Map(instance.master.document.nodes.map((n) => [n.id, n]));
    const slotByTargetId = new Map((instance.master.slots ?? []).map((s) => [s.targetNodeId, s]));
    for (const resolvedChild of instance.resolvedNodes) {
      const scopedId = `${instance.instanceId}${COMPONENT_INSTANCE_NODE_SEP}${resolvedChild.id}`;
      const childOrigin = buildPipelineOriginRef(
        scopedId,
        astNodesById,
        componentsById,
        project.animations,
        tokens,
      );
      const childFill = extractNodeFill(resolvedChild);
      const masterNode = masterNodesById.get(resolvedChild.id);
      const slotDef = slotByTargetId.get(resolvedChild.id);
      const slotAssign = slotDef ? instance.instanceNode.slotAssignments?.[slotDef.id] : undefined;
      const localOv = instance.instanceNode.overrides?.[resolvedChild.id];
      const hasTokenFill = Boolean(masterNode?.tokenBindings?.fill);
      const hasTokenStroke = Boolean(masterNode?.tokenBindings?.stroke);
      const lockText = localOv?.text !== undefined || slotAssign?.text !== undefined;
      const lockFill = hasTokenFill || localOv?.fill !== undefined || slotAssign?.fill !== undefined;
      const lockStroke = hasTokenStroke;
      const lockVisible = slotAssign?.visible !== undefined;
      const baseText =
        slotDef?.defaultText !== undefined
          ? slotDef.defaultText
          : masterNode?.type === 'text'
            ? masterNode.text
            : undefined;
      const baseFill = masterNode ? extractNodeFill(masterNode) : undefined;
      const baseStroke = masterNode ? extractNodeStroke(masterNode) : undefined;
      const baseVisible = masterNode?.visible ?? resolvedChild.visible;
      nodeMeta[scopedId] = {
        name: resolvedChild.name,
        type: resolvedChild.type,
        visible: resolvedChild.visible,
        display:
          resolvedChild.layout?.mode === 'flex'
            ? 'flex'
            : resolvedChild.layout?.mode === 'grid'
              ? 'grid'
              : 'block',
        ...(resolvedChild.type === 'text' ? { text: resolvedChild.text } : {}),
        ...(childFill !== undefined ? { fill: childFill } : {}),
        opacity: resolvedChild.opacity,
        ...(resolvedChild.type === 'component-instance' ? { componentId: resolvedChild.componentId } : {}),
        ...(resolvedChild.type === 'component-instance' && resolvedChild.variantSelection
          ? { variantSelection: { ...resolvedChild.variantSelection } }
          : {}),
        instanceId: childOrigin?.instanceId ?? instance.instanceId,
        ...(childOrigin && childOrigin.animationIds.length > 0 ? { animationIds: childOrigin.animationIds } : {}),
        ...(childOrigin?.children && childOrigin.children.length > 0
          ? {
              children: childOrigin.children.map((sub) => ({
                id: sub.id,
                name: sub.name,
                type: sub.type,
              })),
            }
          : {}),
        ...(baseText !== undefined ? { baseText } : {}),
        ...(baseFill !== undefined ? { baseFill } : {}),
        ...(baseStroke !== undefined ? { baseStroke } : {}),
        baseVisible,
        ...(lockText ? { lockText: true } : {}),
        ...(lockFill ? { lockFill: true } : {}),
        ...(lockStroke ? { lockStroke: true } : {}),
        ...(lockVisible ? { lockVisible: true } : {}),
      };
    }
  }

  const themeSlugById: Record<string, string> = {};
  const defaultThemeId = tokens.themes[0]?.id ?? '';
  for (const theme of tokens.themes) {
    themeSlugById[theme.id] = theme.id === defaultThemeId ? '' : toDesignTokenThemeSlug(theme.name);
  }

  const componentVariants: Record<string, Record<string, CompiledVariantAxisMap>> = {};
  const variantLabels: Record<string, Record<string, Record<string, string>>> = {};
  for (const comp of project.components) {
    if (!comp.variants || comp.variants.length === 0) continue;
    const axisMap: Record<string, CompiledVariantAxisMap> = {};
    const labelAxisMap: Record<string, Record<string, string>> = {};
    for (const axis of comp.variants) {
      const options: Record<string, { readonly label: string; readonly overrides: Record<string, CompiledVariantPatch> }> = {};
      const optLabels: Record<string, string> = {};
      for (const opt of axis.options) {
        const cleanedOverrides: Record<string, CompiledVariantPatch> = {};
        for (const [childId, patch] of Object.entries(opt.overrides)) {
          cleanedOverrides[childId] = {
            ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
            ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
            ...(patch.text !== undefined ? { text: patch.text } : {}),
            ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
          };
        }
        options[opt.id] = { label: opt.label, overrides: cleanedOverrides };
        optLabels[opt.id] = opt.label;
      }
      axisMap[axis.id] = {
        dataAttr: `data-variant-${toKebabCase(axis.name, 'variant')}`,
        defaultOptionId: axis.defaultOptionId,
        options,
      };
      labelAxisMap[axis.id] = optLabels;
    }
    componentVariants[comp.id] = axisMap;
    variantLabels[comp.id] = labelAxisMap;
  }

  const animationClassById: Record<string, string> = {};
  for (const desc of buildLivePreviewAnimationPayload(project, page)) {
    animationClassById[desc.id] = desc.className;
  }

  const pageRouteById: Record<string, string> = {};
  for (const p of project.pages) {
    pageRouteById[p.id] = p.route;
  }

  const compiledGraphs: CompiledRuntimeGraphPayload[] = graphs.map((graph) => {
    const instanceId = getInstanceIdFromExpandedGraphId(graph.id);
    return {
      id: graph.id,
      ...(instanceId ? { instanceId } : {}),
      nodes: graph.nodes
        .filter((node) => isBuiltInLogicNodeType(node.type))
        .map((node) => ({
          id: node.id,
          type: node.type,
          data: sanitizeNodeDataForRuntime(node),
        })),
      connections: graph.connections.map((conn) => ({
        sourceNodeId: conn.sourceNodeId,
        sourcePortId: conn.sourcePortId,
        targetNodeId: conn.targetNodeId,
        targetPortId: conn.targetPortId,
      })),
      bakedFrames: (graph.frames ?? [])
        .filter((frame) => frame.isBaked && frame.bakedData?.compiledPlan)
        .map((frame) => ({
          id: frame.id,
          title: frame.title,
          childNodeIds: [...frame.childNodeIds],
          compiledPlan: frame.bakedData!.compiledPlan,
        })),
    };
  });

  return {
    activePageId: page.id,
    activeRoute: page.route,
    activeThemeId: tokens.activeThemeId,
    maxSteps: MAX_LOGIC_EXECUTION_STEPS,
    variables,
    variableInitialValues,
    variableTypes,
    variableNameToId,
    variablePersist,
    variableComputed,
    networkSettingsByGraphId,
    nodeMeta,
    pageRouteById,
    themeSlugById,
    componentVariants,
    variantLabels,
    animationClassById,
    graphs: compiledGraphs,
  };
}

export interface DiscoveredReactLogicTargets {
  readonly clickNodes: ReadonlySet<string>;
  readonly doubleClickNodes: ReadonlySet<string>;
  readonly clickOutsideNodes: ReadonlySet<string>;
  readonly hoverEnterNodes: ReadonlySet<string>;
  readonly hoverLeaveNodes: ReadonlySet<string>;
  readonly inputChangeNodes: ReadonlySet<string>;
  readonly inputFocusNodes: ReadonlySet<string>;
  readonly inputBlurNodes: ReadonlySet<string>;
  readonly inputSubmitNodes: ReadonlySet<string>;
  readonly dragStartNodes: ReadonlySet<string>;
  readonly dragMoveNodes: ReadonlySet<string>;
  readonly dragDropNodes: ReadonlySet<string>;
  readonly scrollViewTargets: ReadonlySet<string>;
  readonly visibleTargets: ReadonlySet<string>;
  readonly textTargets: ReadonlySet<string>;
  readonly fillTargets: ReadonlySet<string>;
  readonly opacityTargets: ReadonlySet<string>;
  readonly transformTargets: ReadonlySet<string>;
  readonly imageTargets: ReadonlySet<string>;
  readonly disabledTargets: ReadonlySet<string>;
  readonly transitionTargets: ReadonlySet<string>;
  readonly variantTargets: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hasPageLoad: boolean;
  readonly hasKeyPress: boolean;
  readonly hasResize: boolean;
  readonly hasPageScroll: boolean;
  readonly hasNavigation: boolean;
  readonly hasThemeAction: boolean;
  readonly hasAnimationAction: boolean;
  readonly hasToastAction: boolean;
}

/**
 * Resolves all concrete AST node IDs an action node may mutate at runtime,
 * supporting both explicit Override targets (`targetNodeId`) AND Scoped
 * Pipeline inherited targets (`targetMode: 'pipeline'` + optional `pipelineChildId`).
 */
function resolvePossibleActionTargetIds(
  graph: LogicGraph,
  node: LogicNode,
  astNodesById: ReadonlyMap<string, DesignNode>,
  componentsById: ReadonlyMap<string, FolioProject['components'][number]>,
  project: FolioProject,
): string[] {
  if (getNodeTargetMode(node) === 'pipeline') {
    const tokens = getProjectDesignTokens(project);
    const origins = getUpstreamPipelineOrigins(
      graph.nodes,
      graph.connections,
      node.id,
      astNodesById,
      componentsById,
      project.animations,
      tokens,
    );
    const childId = typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId.trim() : '';
    const resolved = new Set<string>();
    for (const origin of origins) {
      if (!childId || childId === origin.layerId) {
        if (node.type === 'action.set-variant' && origin.type !== 'component-instance' && origin.instanceId) {
          resolved.add(origin.instanceId);
        } else {
          resolved.add(origin.layerId);
        }
      } else if (origin.children?.some((c) => c.id === childId)) {
        resolved.add(childId);
      }
    }
    return Array.from(resolved);
  }

  const explicit = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';
  return explicit ? [explicit] : [];
}

/**
 * Discovers all interactive DOM event targets and dynamic visual override
 * targets for React TSX codegen, covering static override targets, Scoped
 * Pipeline inherited targets (Origin + Group/Component children), and
 * per-instance expanded component-scoped targets.
 */
export function discoverDynamicReactTargets(
  project: FolioProject,
  page: FolioPage,
  graphs: readonly LogicGraph[],
): DiscoveredReactLogicTargets {
  const clickNodes = new Set<string>();
  const doubleClickNodes = new Set<string>();
  const clickOutsideNodes = new Set<string>();
  const hoverEnterNodes = new Set<string>();
  const hoverLeaveNodes = new Set<string>();
  const inputChangeNodes = new Set<string>();
  const inputFocusNodes = new Set<string>();
  const inputBlurNodes = new Set<string>();
  const inputSubmitNodes = new Set<string>();
  const dragStartNodes = new Set<string>();
  const dragMoveNodes = new Set<string>();
  const dragDropNodes = new Set<string>();
  const scrollViewTargets = new Set<string>();
  const visibleTargets = new Set<string>();
  const textTargets = new Set<string>();
  const fillTargets = new Set<string>();
  const opacityTargets = new Set<string>();
  const transformTargets = new Set<string>();
  const imageTargets = new Set<string>();
  const disabledTargets = new Set<string>();
  const transitionTargets = new Set<string>();
  const variantTargets = new Map<string, Set<string>>();

  let hasPageLoad = false;
  let hasKeyPress = false;
  let hasResize = false;
  let hasPageScroll = false;
  let hasNavigation = false;
  let hasThemeAction = false;
  let hasAnimationAction = false;
  let hasToastAction = false;

  const astNodesById = new Map(page.document.nodes.map((node) => [node.id, node]));
  const componentsById = new Map(project.components.map((comp) => [comp.id, comp]));
  const { expandedInstances } = collectPageComponentInstances(project, page);

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';

      if (node.type === 'event.on-click' && targetId) {
        const mode = String(node.data.mode ?? 'click');
        if (mode === 'double-click') doubleClickNodes.add(targetId);
        else if (mode === 'click-outside') clickOutsideNodes.add(targetId);
        else clickNodes.add(targetId);
      } else if (node.type === 'event.on-hover' && targetId) {
        if (node.data.phase === 'leave') hoverLeaveNodes.add(targetId);
        else hoverEnterNodes.add(targetId);
      } else if (node.type === 'event.on-input' && targetId) {
        const trig = String(node.data.mode ?? node.data.trigger ?? 'change');
        if (trig === 'focus') inputFocusNodes.add(targetId);
        else if (trig === 'blur') inputBlurNodes.add(targetId);
        else if (trig === 'submit') inputSubmitNodes.add(targetId);
        else inputChangeNodes.add(targetId);
      } else if (node.type === 'event.on-drag' && targetId) {
        const phase = String(node.data.phase ?? 'start');
        if (phase === 'move') dragMoveNodes.add(targetId);
        else if (phase === 'drop') dragDropNodes.add(targetId);
        else dragStartNodes.add(targetId);
      } else if (node.type === 'event.on-scroll-view') {
        const trig = String(node.data.mode ?? node.data.trigger ?? 'enter-view');
        if (trig === 'page-scroll') hasPageScroll = true;
        else if (targetId) scrollViewTargets.add(targetId);
      } else if (node.type === 'event.on-key-press') {
        hasKeyPress = true;
      } else if (node.type === 'source.element' && targetId) {
        clickNodes.add(targetId);
        hoverEnterNodes.add(targetId);
      } else if (node.type === 'source.component') {
        if (targetId) {
          clickNodes.add(targetId);
          hoverEnterNodes.add(targetId);
        } else {
          const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
          if (compId) {
            for (const inst of expandedInstances) {
              if (inst.componentId === compId) {
                clickNodes.add(inst.instanceId);
                hoverEnterNodes.add(inst.instanceId);
              }
            }
          }
        }
      }

      if (
        node.type === 'event.on-page-load' ||
        (node.type === 'event.on-lifecycle' && (!node.data.trigger || node.data.trigger === 'page-load'))
      ) {
        hasPageLoad = true;
      }
      if (node.type === 'event.on-lifecycle' && node.data.trigger === 'resize') {
        hasResize = true;
      }
      if (
        (node.type === 'source.page' || node.type === 'source.context') &&
        (!node.data.pageId || node.data.pageId === page.id)
      ) {
        hasPageLoad = true;
      }
      if (node.type === 'source.external') {
        hasPageLoad = true;
      }

      if (node.type === 'action.set-visible') {
        for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
          visibleTargets.add(tid);
        }
      } else if (node.type === 'action.set-text') {
        for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
          textTargets.add(tid);
        }
      } else if (node.type === 'action.set-fill') {
        for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
          fillTargets.add(tid);
        }
      } else if (node.type === 'action.set-layer') {
        const prop = String(node.data.property ?? 'text');
        const hasTransition = typeof node.data.transitionMs === 'number' && node.data.transitionMs > 0;
        for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
          if (prop === 'visible') visibleTargets.add(tid);
          else if (prop === 'fill') fillTargets.add(tid);
          else if (prop === 'text') textTargets.add(tid);
          else if (prop === 'opacity') opacityTargets.add(tid);
          else if (prop === 'transform') transformTargets.add(tid);
          else if (prop === 'image') imageTargets.add(tid);
          else if (prop === 'disabled') disabledTargets.add(tid);
          if (hasTransition) transitionTargets.add(tid);
        }
      } else if (node.type === 'action.set-variant') {
        const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
        for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
          const set = variantTargets.get(tid) ?? new Set<string>();
          if (axisId) set.add(axisId);
          variantTargets.set(tid, set);
        }
      } else if (node.type === 'action.overlay-toast') {
        const mode = String(node.data.mode ?? 'show-toast');
        if (mode === 'show-toast') {
          hasToastAction = true;
        } else {
          for (const tid of resolvePossibleActionTargetIds(graph, node, astNodesById, componentsById, project)) {
            visibleTargets.add(tid);
          }
        }
      } else if (node.type === 'action.navigate') {
        hasNavigation = true;
      } else if (
        node.type === 'action.set-theme' ||
        (node.type === 'action.system-form' && node.data.action === 'set-theme')
      ) {
        hasThemeAction = true;
      } else if (node.type === 'action.play-animation' || node.type === 'action.media-animation') {
        hasAnimationAction = true;
      }
    }
  }

  return {
    clickNodes,
    doubleClickNodes,
    clickOutsideNodes,
    hoverEnterNodes,
    hoverLeaveNodes,
    inputChangeNodes,
    inputFocusNodes,
    inputBlurNodes,
    inputSubmitNodes,
    dragStartNodes,
    dragMoveNodes,
    dragDropNodes,
    scrollViewTargets,
    visibleTargets,
    textTargets,
    fillTargets,
    opacityTargets,
    transformTargets,
    imageTargets,
    disabledTargets,
    transitionTargets,
    variantTargets,
    hasPageLoad,
    hasKeyPress,
    hasResize,
    hasPageScroll,
    hasNavigation,
    hasThemeAction,
    hasAnimationAction,
    hasToastAction,
  };
}

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

import { sanitizeLogicNodeDataRecord } from '../../core/document/networkSecrets';
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
import { buildPipelineOriginRef, getNodeTargetMode, getUpstreamPipelineOrigins } from './pipeline';
import { MAX_LOGIC_EXECUTION_STEPS } from './runtime';

export type ParitySupportLevel = 'full' | 'simulated' | 'not-applicable';

export interface NodeRuntimeParityEntry {
  readonly type: BuiltInLogicNodeType;
  readonly headless: ParitySupportLevel;
  readonly livePreview: ParitySupportLevel;
  readonly reactCodegen: ParitySupportLevel;
  readonly notes: string;
}

/**
 * Canonical runtime parity matrix for all 31 primary Node Logic types across
 * Headless Simulator, Live Preview Micro-Runtime, and React TSX Codegen.
 */
export const NODE_RUNTIME_PARITY_MATRIX: readonly NodeRuntimeParityEntry[] = [
  // Sources (3)
  { type: 'source.element', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Element triggers & property reads' },
  { type: 'source.context', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Page route, theme, viewport, URL params, auth context' },
  { type: 'source.external', headless: 'simulated', livePreview: 'simulated', reactCodegen: 'simulated', notes: 'Deterministic external collection payload (zero secrets)' },
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
  { type: 'action.system-form', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Theme switch, clipboard, focus/blur/reset form' },
  // Flow & Timing (3)
  { type: 'flow.delay', headless: 'simulated', livePreview: 'full', reactCodegen: 'full', notes: 'Timed delay (simulated synchronously in headless, timed in browser)' },
  { type: 'flow.loop-timer', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'For-each list iteration & interval timer management' },
  { type: 'flow.control', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Sequence, parallel, debounce/throttle fan-out' },
  // Network & Backend (3)
  { type: 'network.http', headless: 'simulated', livePreview: 'simulated', reactCodegen: 'simulated', notes: 'Safe structured HTTP step payload (zero embedded secrets/tokens)' },
  { type: 'network.json', headless: 'full', livePreview: 'full', reactCodegen: 'full', notes: 'Get field, parse, stringify, validity check' },
  { type: 'network.socket', headless: 'simulated', livePreview: 'simulated', reactCodegen: 'simulated', notes: 'Channel event simulation (zero embedded secrets)' },
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
  readonly animationIds?: readonly string[];
  readonly children?: readonly CompiledOriginChildMeta[];
}

export interface CompiledVariantPatch {
  readonly fill?: string;
  readonly text?: string;
  readonly visible?: boolean;
}

export interface CompiledVariantAxisMap {
  readonly dataAttr: string;
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
  readonly maxSteps: number;
  readonly variables: Record<string, LogicVariableValue>;
  readonly variableInitialValues: Record<string, LogicVariableValue>;
  readonly variableTypes: Record<string, string>;
  readonly variableNameToId: Record<string, string>;
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

/**
 * Compiles the canonical runtime configuration payload for a page's active
 * Node Logic graphs. Shared by both Live Preview and React TSX codegen to
 * prevent drift in variable types, Scoped Pipeline metadata, variant maps,
 * theme slugs, animation classes, and Baked Logic Frames.
 */
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

  for (const graph of graphs) {
    for (const variable of graph.variables ?? []) {
      variableTypes[variable.id] = variable.valueType;
      variableNameToId[variable.name] = variable.id;
      variableNameToId[variable.name.toLowerCase()] = variable.id;
      if (!Object.prototype.hasOwnProperty.call(variables, variable.id)) {
        variables[variable.id] = variable.initialValue;
        variableInitialValues[variable.id] = variable.initialValue;
      }
    }
  }

  const astNodesById = new Map(page.document.nodes.map((node) => [node.id, node]));
  const componentsById = new Map(project.components.map((comp) => [comp.id, comp]));

  const nodeMeta: Record<string, CompiledRuntimeNodeMeta> = {};
  for (const node of page.document.nodes) {
    const originRef = buildPipelineOriginRef(
      node.id,
      astNodesById,
      componentsById,
      project.animations,
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

    if (node.type === 'component-instance') {
      const master = componentsById.get(node.componentId);
      if (master) {
        for (const child of master.document.nodes) {
          const scopedId = `${node.id}__${child.id}`;
          const childFill = extractNodeFill(child);
          nodeMeta[scopedId] = {
            name: child.name,
            type: child.type,
            visible: child.visible,
            display: child.layout?.mode === 'flex' ? 'flex' : child.layout?.mode === 'grid' ? 'grid' : 'block',
            ...(child.type === 'text' ? { text: child.text } : {}),
            ...(childFill !== undefined ? { fill: childFill } : {}),
            opacity: child.opacity,
          };
        }
      }
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
            ...(patch.text !== undefined ? { text: patch.text } : {}),
            ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
          };
        }
        options[opt.id] = { label: opt.label, overrides: cleanedOverrides };
        optLabels[opt.id] = opt.label;
      }
      axisMap[axis.id] = {
        dataAttr: `data-variant-${toKebabCase(axis.name, 'variant')}`,
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

  const compiledGraphs: CompiledRuntimeGraphPayload[] = graphs.map((graph) => ({
    id: graph.id,
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
  }));

  return {
    activePageId: page.id,
    activeRoute: page.route,
    maxSteps: MAX_LOGIC_EXECUTION_STEPS,
    variables,
    variableInitialValues,
    variableTypes,
    variableNameToId,
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
  readonly hoverEnterNodes: ReadonlySet<string>;
  readonly hoverLeaveNodes: ReadonlySet<string>;
  readonly visibleTargets: ReadonlySet<string>;
  readonly textTargets: ReadonlySet<string>;
  readonly fillTargets: ReadonlySet<string>;
  readonly opacityTargets: ReadonlySet<string>;
  readonly transformTargets: ReadonlySet<string>;
  readonly disabledTargets: ReadonlySet<string>;
  readonly transitionTargets: ReadonlySet<string>;
  readonly variantTargets: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hasPageLoad: boolean;
  readonly hasKeyPress: boolean;
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
    const origins = getUpstreamPipelineOrigins(
      graph.nodes,
      graph.connections,
      node.id,
      astNodesById,
      componentsById,
      project.animations,
    );
    const childId = typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId.trim() : '';
    const resolved = new Set<string>();
    for (const origin of origins) {
      if (!childId || childId === origin.layerId) {
        resolved.add(origin.layerId);
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
 * targets for React TSX codegen, covering both static override targets and
 * Scoped Pipeline inherited targets (Origin + Group/Component children).
 */
export function discoverDynamicReactTargets(
  project: FolioProject,
  page: FolioPage,
  graphs: readonly LogicGraph[],
): DiscoveredReactLogicTargets {
  const clickNodes = new Set<string>();
  const doubleClickNodes = new Set<string>();
  const hoverEnterNodes = new Set<string>();
  const hoverLeaveNodes = new Set<string>();
  const visibleTargets = new Set<string>();
  const textTargets = new Set<string>();
  const fillTargets = new Set<string>();
  const opacityTargets = new Set<string>();
  const transformTargets = new Set<string>();
  const disabledTargets = new Set<string>();
  const transitionTargets = new Set<string>();
  const variantTargets = new Map<string, Set<string>>();

  let hasPageLoad = false;
  let hasKeyPress = false;
  let hasNavigation = false;
  let hasThemeAction = false;
  let hasAnimationAction = false;
  let hasToastAction = false;

  const astNodesById = new Map(page.document.nodes.map((node) => [node.id, node]));
  const componentsById = new Map(project.components.map((comp) => [comp.id, comp]));

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';

      if (node.type === 'event.on-click' && targetId) {
        const mode = String(node.data.mode ?? 'click');
        if (mode === 'double-click') doubleClickNodes.add(targetId);
        else clickNodes.add(targetId);
      } else if (node.type === 'event.on-hover' && targetId) {
        if (node.data.phase === 'leave') hoverLeaveNodes.add(targetId);
        else hoverEnterNodes.add(targetId);
      } else if (node.type === 'event.on-key-press') {
        hasKeyPress = true;
      } else if (node.type === 'source.element' && targetId) {
        clickNodes.add(targetId);
        hoverEnterNodes.add(targetId);
      } else if (node.type === 'source.component') {
        const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
        if (compId) {
          for (const pageNode of page.document.nodes) {
            if (pageNode.type === 'component-instance' && pageNode.componentId === compId) {
              clickNodes.add(pageNode.id);
              hoverEnterNodes.add(pageNode.id);
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
      if (
        (node.type === 'source.page' || node.type === 'source.context') &&
        (!node.data.pageId || node.data.pageId === page.id)
      ) {
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
    hoverEnterNodes,
    hoverLeaveNodes,
    visibleTargets,
    textTargets,
    fillTargets,
    opacityTargets,
    transformTargets,
    disabledTargets,
    transitionTargets,
    variantTargets,
    hasPageLoad,
    hasKeyPress,
    hasNavigation,
    hasThemeAction,
    hasAnimationAction,
    hasToastAction,
  };
}

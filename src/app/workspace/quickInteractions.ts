import type {
  ComponentDefinition,
  DesignNode,
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNode,
} from '../../core/document/types';
import { getLogicNodeDefinition, type BuiltInLogicNodeType } from '../../engines/prototype/catalog';

export type QuickInteractionTrigger = 'on-click' | 'on-hover' | 'on-submit';
export type QuickInteractionHoverPhase = 'enter' | 'leave';
export type QuickInteractionActionKind =
  | 'visibility'
  | 'navigate'
  | 'set-variant'
  | 'set-layer-property'
  | 'show-toast';
export type QuickInteractionVisibilityMode = 'toggle' | 'show' | 'hide';
export type QuickInteractionNavigateMode = 'internal' | 'external' | 'scroll-to' | 'back';
export type QuickInteractionLayerProperty = 'fill' | 'opacity' | 'text' | 'transform' | 'disabled';
export type QuickInteractionToastTone = 'info' | 'success' | 'warning' | 'error';

export interface QuickInteractionConfig {
  trigger: QuickInteractionTrigger;
  hoverPhase: QuickInteractionHoverPhase;
  actionKind: QuickInteractionActionKind;
  targetNodeId: string;
  visibleMode: QuickInteractionVisibilityMode;
  navMode: QuickInteractionNavigateMode;
  route: string;
  axisId: string;
  optionId: string;
  layerProperty: QuickInteractionLayerProperty;
  fill: string;
  opacity: number;
  text: string;
  transform: string;
  disabled: boolean;
  transitionMs: number;
  toastMessage: string;
  toastTone: QuickInteractionToastTone;
}

export interface QuickInteractionEntry {
  readonly id: string;
  readonly graphId: string;
  readonly graphName: string;
  readonly triggerNodeId: string;
  readonly actionNodeId: string | null;
  readonly connectionId: string | null;
  readonly focusNodeIds: readonly string[];
  readonly editable: boolean;
  readonly triggerLabel: string;
  readonly actionSummary: string;
  readonly nodeCountInFlow: number;
  readonly config: QuickInteractionConfig | null;
}

export interface QuickInteractionScopeContext {
  readonly scope: 'page' | 'component';
  readonly scopeTargetId: string;
  readonly scopeName: string;
  readonly layerId: string;
}

export interface QuickInteractionMutationResult {
  readonly mode: 'create' | 'update';
  readonly graph: LogicGraph;
  readonly triggerNodeId: string;
  readonly actionNodeId: string;
  readonly connectionId: string;
}

export interface VariantTargetCandidate {
  readonly node: DesignNode;
  readonly component: ComponentDefinition;
}

const TRIGGER_X = 60;
const ACTION_X = 360;
const FIRST_ROW_Y = 72;
const ROW_STEP_Y = 168;

const SUPPORTED_EDITABLE_LAYER_PROPERTIES: readonly QuickInteractionLayerProperty[] = [
  'fill',
  'opacity',
  'text',
  'transform',
  'disabled',
];

let idSequence = 0;

function createQuickId(prefix: string): string {
  idSequence += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${rand}`;
}

export function getVariantTargetCandidates(
  scopedNodes: readonly DesignNode[],
  components: readonly ComponentDefinition[],
): VariantTargetCandidate[] {
  const byId = new Map<string, ComponentDefinition>(components.map((comp) => [comp.id, comp]));
  const result: VariantTargetCandidate[] = [];
  for (const node of scopedNodes) {
    if (node.type !== 'component-instance') continue;
    const comp = byId.get(node.componentId);
    if (!comp || !comp.variants || comp.variants.length === 0) continue;
    if (!comp.variants.some((axis) => axis.options.length > 0)) continue;
    result.push({ node, component: comp });
  }
  return result;
}

function pickDefaultVisibilityTarget(scopedNodes: readonly DesignNode[], layerId: string): string {
  const others = scopedNodes.filter((node) => node.id !== layerId);
  const overlayPreferred = others.find((node) =>
    /\b(modal|drawer|dialog|popover|menu|sheet|panel|overlay|dropdown|tooltip)\b/i.test(node.name),
  );
  if (overlayPreferred) return overlayPreferred.id;
  if (others.length > 0) return others[0].id;
  return layerId;
}

function pickDefaultPropertyTarget(
  scopedNodes: readonly DesignNode[],
  layerId: string,
  property: QuickInteractionLayerProperty,
): string {
  const current = scopedNodes.find((n) => n.id === layerId);
  if (property === 'text') {
    if (current?.type === 'text') return current.id;
    const textNode = scopedNodes.find((n) => n.type === 'text');
    if (textNode) return textNode.id;
  }
  if (property === 'fill') {
    if (current && current.type !== 'group' && current.type !== 'component-instance') {
      return current.id;
    }
    const fillable = scopedNodes.find((n) => n.type !== 'group' && n.type !== 'component-instance');
    if (fillable) return fillable.id;
  }
  return layerId;
}

function pickDefaultRoute(pages: readonly FolioPage[], activePageId: string): string {
  const otherPage = pages.find((page) => page.id !== activePageId);
  if (otherPage) return otherPage.route || '/';
  return pages[0]?.route || '/';
}

export function createDefaultQuickInteractionConfig(options: {
  selectedNode: DesignNode;
  scopedNodes: readonly DesignNode[];
  pages: readonly FolioPage[];
  activePageId: string;
  components: readonly ComponentDefinition[];
}): QuickInteractionConfig {
  const { selectedNode, scopedNodes, pages, activePageId, components } = options;
  const isFormLike =
    selectedNode.semanticTag === 'form' || /\bform\b/i.test(selectedNode.name);
  const variantCandidates = getVariantTargetCandidates(scopedNodes, components);
  const firstVariantCandidate = variantCandidates[0];
  const firstAxis = firstVariantCandidate?.component.variants?.find((a) => a.options.length > 0);
  const firstOption = firstAxis?.options[0];

  return {
    trigger: isFormLike ? 'on-submit' : 'on-click',
    hoverPhase: 'enter',
    actionKind: 'visibility',
    targetNodeId: pickDefaultVisibilityTarget(scopedNodes, selectedNode.id),
    visibleMode: 'toggle',
    navMode: 'internal',
    route: pickDefaultRoute(pages, activePageId),
    axisId: firstAxis?.id ?? '',
    optionId: firstOption?.id ?? '',
    layerProperty: selectedNode.type === 'text' ? 'text' : 'fill',
    fill: '#2dd4bf',
    opacity: 0.65,
    text: 'Updated',
    transform: 'scale(1.04)',
    disabled: true,
    transitionMs: 180,
    toastMessage: `${selectedNode.name} clicked`,
    toastTone: 'success',
  };
}

export function adaptQuickInteractionConfigForActionKind(
  current: QuickInteractionConfig,
  nextKind: QuickInteractionActionKind,
  context: {
    layerId: string;
    scopedNodes: readonly DesignNode[];
    pages: readonly FolioPage[];
    activePageId: string;
    components: readonly ComponentDefinition[];
  },
): QuickInteractionConfig {
  const { layerId, scopedNodes, pages, activePageId, components } = context;
  const next: QuickInteractionConfig = { ...current, actionKind: nextKind };

  if (nextKind === 'visibility') {
    if (!next.targetNodeId || !scopedNodes.some((n) => n.id === next.targetNodeId)) {
      next.targetNodeId = pickDefaultVisibilityTarget(scopedNodes, layerId);
    }
    return next;
  }

  if (nextKind === 'navigate') {
    if (next.navMode === 'internal' && !next.route.trim()) {
      next.route = pickDefaultRoute(pages, activePageId);
    } else if (next.navMode === 'scroll-to' && !next.targetNodeId) {
      next.targetNodeId = pickDefaultVisibilityTarget(scopedNodes, layerId);
    }
    return next;
  }

  if (nextKind === 'set-variant') {
    const candidates = getVariantTargetCandidates(scopedNodes, components);
    const matching =
      candidates.find((c) => c.node.id === next.targetNodeId) ??
      candidates.find((c) => c.node.id === layerId) ??
      candidates[0];
    if (matching) {
      next.targetNodeId = matching.node.id;
      const axis =
        matching.component.variants?.find((a) => a.id === next.axisId && a.options.length > 0) ??
        matching.component.variants?.find((a) => a.options.length > 0);
      next.axisId = axis?.id ?? '';
      const opt = axis?.options.find((o) => o.id === next.optionId) ?? axis?.options[0];
      next.optionId = opt?.id ?? '';
    } else {
      next.axisId = '';
      next.optionId = '';
    }
    return next;
  }

  if (nextKind === 'set-layer-property') {
    if (!scopedNodes.some((n) => n.id === next.targetNodeId)) {
      next.targetNodeId = pickDefaultPropertyTarget(scopedNodes, layerId, next.layerProperty);
    } else if (next.layerProperty === 'fill') {
      const target = scopedNodes.find((n) => n.id === next.targetNodeId);
      if (target && (target.type === 'group' || target.type === 'component-instance')) {
        next.targetNodeId = pickDefaultPropertyTarget(scopedNodes, layerId, 'fill');
      }
    }
    return next;
  }

  if (nextKind === 'show-toast') {
    if (!next.toastMessage.trim()) {
      next.toastMessage = 'Action completed';
    }
    return next;
  }

  return next;
}

export function validateQuickInteractionConfig(
  config: QuickInteractionConfig,
  context: {
    scopedNodes: readonly DesignNode[];
    components: readonly ComponentDefinition[];
  },
): string | null {
  const { scopedNodes, components } = context;

  if (config.actionKind === 'visibility' || config.actionKind === 'set-layer-property') {
    if (!config.targetNodeId || !scopedNodes.some((n) => n.id === config.targetNodeId)) {
      return 'Choose a valid target layer.';
    }
    if (config.actionKind === 'set-layer-property' && config.layerProperty === 'fill') {
      const target = scopedNodes.find((n) => n.id === config.targetNodeId);
      if (target && (target.type === 'group' || target.type === 'component-instance')) {
        return 'Fill color requires a shape, frame, or text layer.';
      }
    }
    return null;
  }

  if (config.actionKind === 'navigate') {
    if (config.navMode === 'internal' || config.navMode === 'external') {
      const route = config.route.trim();
      if (!route) return 'Enter a target page route or URL.';
      if (/^(?:javascript|vbscript|data):/i.test(route)) {
        return 'Unsafe URL protocol is blocked.';
      }
    } else if (config.navMode === 'scroll-to') {
      if (!config.targetNodeId || !scopedNodes.some((n) => n.id === config.targetNodeId)) {
        return 'Choose a layer to scroll to.';
      }
    }
    return null;
  }

  if (config.actionKind === 'set-variant') {
    const candidates = getVariantTargetCandidates(scopedNodes, components);
    if (candidates.length === 0) {
      return 'Add a component instance with variants on this canvas first.';
    }
    const candidate = candidates.find((c) => c.node.id === config.targetNodeId);
    if (!candidate) return 'Choose a component instance with variants.';
    const axis = candidate.component.variants?.find((a) => a.id === config.axisId);
    if (!axis) return 'Choose a variant axis.';
    if (!axis.options.some((opt) => opt.id === config.optionId)) {
      return 'Choose a variant option.';
    }
    return null;
  }

  if (config.actionKind === 'show-toast') {
    if (!config.toastMessage.trim()) return 'Enter a toast message.';
    return null;
  }

  return null;
}

type LogicNodeDataMap = Record<string, string | number | boolean | null>;

function buildTriggerNodeSpec(
  layerId: string,
  config: QuickInteractionConfig,
): { type: BuiltInLogicNodeType; data: LogicNodeDataMap } {
  if (config.trigger === 'on-hover') {
    return {
      type: 'event.on-hover',
      data: {
        targetNodeId: layerId,
        phase: config.hoverPhase === 'leave' ? 'leave' : 'enter',
        once: false,
        debounceMs: 0,
        throttleMs: 0,
      },
    };
  }
  if (config.trigger === 'on-submit') {
    return {
      type: 'event.on-input',
      data: {
        targetNodeId: layerId,
        mode: 'submit',
        once: false,
        debounceMs: 0,
        throttleMs: 0,
      },
    };
  }
  return {
    type: 'event.on-click',
    data: {
      targetNodeId: layerId,
      mode: 'click',
      once: false,
      debounceMs: 0,
      throttleMs: 0,
    },
  };
}

function buildActionNodeSpec(
  config: QuickInteractionConfig,
): { type: BuiltInLogicNodeType; data: LogicNodeDataMap } {
  switch (config.actionKind) {
    case 'visibility':
      return {
        type: 'action.set-layer',
        data: {
          targetMode: 'override',
          targetNodeId: config.targetNodeId,
          property: 'visible',
          visibleMode: config.visibleMode,
          transitionMs: 0,
          transitionEasing: 'ease',
        },
      };
    case 'navigate':
      return {
        type: 'action.navigate',
        data: {
          mode: config.navMode,
          route: config.navMode === 'internal' || config.navMode === 'external' ? config.route.trim() : '',
          targetNodeId: config.navMode === 'scroll-to' ? config.targetNodeId : '',
        },
      };
    case 'set-variant':
      return {
        type: 'action.set-variant',
        data: {
          targetMode: 'override',
          targetNodeId: config.targetNodeId,
          axisId: config.axisId,
          optionId: config.optionId,
        },
      };
    case 'set-layer-property': {
      const baseData: LogicNodeDataMap = {
        targetMode: 'override',
        targetNodeId: config.targetNodeId,
        property: config.layerProperty,
        transitionMs: Math.max(0, Math.min(5000, Math.round(config.transitionMs || 0))),
        transitionEasing: 'ease',
      };
      if (config.layerProperty === 'fill') baseData.fill = config.fill.trim() || '#2dd4bf';
      else if (config.layerProperty === 'opacity') {
        baseData.opacity = Math.max(0, Math.min(1, Number.isFinite(config.opacity) ? config.opacity : 1));
      } else if (config.layerProperty === 'text') baseData.text = config.text;
      else if (config.layerProperty === 'transform') baseData.transform = config.transform;
      else if (config.layerProperty === 'disabled') baseData.disabled = Boolean(config.disabled);
      return {
        type: 'action.set-layer',
        data: baseData,
      };
    }
    case 'show-toast':
      return {
        type: 'action.overlay-toast',
        data: {
          mode: 'show-toast',
          targetMode: 'override',
          targetNodeId: '',
          message: config.toastMessage,
          tone: config.toastTone,
        },
      };
  }
}

function parseTriggerNode(
  node: LogicNode,
): { trigger: QuickInteractionTrigger; hoverPhase: QuickInteractionHoverPhase; label: string } | null {
  if (node.type === 'event.on-click') {
    const mode = String(node.data.mode ?? 'click');
    if (mode !== 'click') return null;
    return { trigger: 'on-click', hoverPhase: 'enter', label: 'On Click' };
  }
  if (node.type === 'event.on-hover') {
    const phase: QuickInteractionHoverPhase = node.data.phase === 'leave' ? 'leave' : 'enter';
    return {
      trigger: 'on-hover',
      hoverPhase: phase,
      label: phase === 'leave' ? 'On Hover Leave' : 'On Hover',
    };
  }
  if (node.type === 'event.on-input') {
    const mode = String(node.data.mode ?? node.data.trigger ?? 'change');
    if (mode !== 'submit') return null;
    return { trigger: 'on-submit', hoverPhase: 'enter', label: 'On Submit' };
  }
  return null;
}

function getAnyTriggerLabel(node: LogicNode): string {
  if (node.type === 'event.on-click') {
    const mode = String(node.data.mode ?? 'click');
    if (mode === 'double-click') return 'On Double Click';
    if (mode === 'click-outside') return 'On Click Outside';
    return 'On Click';
  }
  if (node.type === 'event.on-hover') {
    return node.data.phase === 'leave' ? 'On Hover Leave' : 'On Hover';
  }
  if (node.type === 'event.on-input') {
    const mode = String(node.data.mode ?? node.data.trigger ?? 'change');
    if (mode === 'submit') return 'On Submit';
    if (mode === 'focus') return 'On Focus';
    if (mode === 'blur') return 'On Blur';
    return 'On Input';
  }
  if (node.type === 'event.on-drag') return 'On Drag';
  if (node.type === 'event.on-scroll-view') return 'On Scroll View';
  if (node.type === 'source.element') return 'Canvas Layer Source';
  return getLogicNodeDefinition(node.type)?.label ?? node.type;
}

function parseActionNode(
  node: LogicNode,
  fallbackTargetNodeId: string,
): Partial<QuickInteractionConfig> & { actionKind: QuickInteractionActionKind } | null {
  if (typeof node.data.pipelineRef === 'string' && node.data.pipelineRef.trim().length > 0) {
    return null;
  }

  const resolveEffectiveTarget = (): string => {
    if (node.data.targetMode === 'pipeline') {
      const childId = typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId.trim() : '';
      return childId || fallbackTargetNodeId;
    }
    return typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
  };

  if (node.type === 'action.set-layer') {
    const prop = String(node.data.property ?? 'text');
    if (prop === 'visible') {
      const rawVis = String(node.data.visibleMode ?? 'toggle');
      const visibleMode: QuickInteractionVisibilityMode =
        rawVis === 'show' || rawVis === 'hide' ? rawVis : 'toggle';
      return {
        actionKind: 'visibility',
        targetNodeId: resolveEffectiveTarget(),
        visibleMode,
      };
    }
    if (SUPPORTED_EDITABLE_LAYER_PROPERTIES.includes(prop as QuickInteractionLayerProperty)) {
      return {
        actionKind: 'set-layer-property',
        targetNodeId: resolveEffectiveTarget(),
        layerProperty: prop as QuickInteractionLayerProperty,
        fill: typeof node.data.fill === 'string' ? node.data.fill : '#2dd4bf',
        opacity: typeof node.data.opacity === 'number' ? node.data.opacity : 1,
        text: typeof node.data.text === 'string' ? node.data.text : '',
        transform: typeof node.data.transform === 'string' ? node.data.transform : '',
        disabled: Boolean(node.data.disabled),
        transitionMs: typeof node.data.transitionMs === 'number' ? node.data.transitionMs : 0,
      };
    }
    return null;
  }

  if (node.type === 'action.set-visible') {
    const rawVis = String(node.data.mode ?? 'toggle');
    const visibleMode: QuickInteractionVisibilityMode =
      rawVis === 'show' || rawVis === 'hide' ? rawVis : 'toggle';
    return {
      actionKind: 'visibility',
      targetNodeId: resolveEffectiveTarget(),
      visibleMode,
    };
  }

  if (node.type === 'action.navigate') {
    const rawMode = String(node.data.mode ?? 'internal');
    const navMode: QuickInteractionNavigateMode =
      rawMode === 'external' || rawMode === 'scroll-to' || rawMode === 'back' ? rawMode : 'internal';
    if (rawMode !== 'internal' && rawMode !== 'external' && rawMode !== 'scroll-to' && rawMode !== 'back') {
      return null;
    }
    return {
      actionKind: 'navigate',
      navMode,
      route: typeof node.data.route === 'string' ? node.data.route : '/',
      targetNodeId: typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '',
    };
  }

  if (node.type === 'action.set-variant') {
    return {
      actionKind: 'set-variant',
      targetNodeId: resolveEffectiveTarget(),
      axisId: typeof node.data.axisId === 'string' ? node.data.axisId : '',
      optionId: typeof node.data.optionId === 'string' ? node.data.optionId : '',
    };
  }

  if (node.type === 'action.overlay-toast') {
    const mode = String(node.data.mode ?? 'show-toast');
    if (mode !== 'show-toast') return null;
    const rawTone = String(node.data.tone ?? 'info');
    const toastTone: QuickInteractionToastTone =
      rawTone === 'success' || rawTone === 'warning' || rawTone === 'error' ? rawTone : 'info';
    return {
      actionKind: 'show-toast',
      toastMessage: typeof node.data.message === 'string' ? node.data.message : '',
      toastTone,
    };
  }

  return null;
}

function summarizeQuickAction(
  config: QuickInteractionConfig,
  nodesById: ReadonlyMap<string, DesignNode>,
  pagesByRoute: ReadonlyMap<string, FolioPage>,
  componentsById: ReadonlyMap<string, ComponentDefinition>,
): string {
  const targetName = nodesById.get(config.targetNodeId)?.name ?? 'Layer';
  switch (config.actionKind) {
    case 'visibility': {
      const verb =
        config.visibleMode === 'show' ? 'Show' : config.visibleMode === 'hide' ? 'Hide' : 'Toggle';
      return `${verb} ${targetName}`;
    }
    case 'navigate': {
      if (config.navMode === 'back') return 'Navigate Back';
      if (config.navMode === 'scroll-to') return `Scroll to ${targetName}`;
      const page = pagesByRoute.get(config.route);
      return `Navigate to ${page ? page.name : config.route || '/'}`;
    }
    case 'set-variant': {
      const targetNode = nodesById.get(config.targetNodeId);
      const comp =
        targetNode?.type === 'component-instance' ? componentsById.get(targetNode.componentId) : undefined;
      const axis = comp?.variants?.find((a) => a.id === config.axisId);
      const opt = axis?.options.find((o) => o.id === config.optionId);
      if (axis && opt) return `${targetName} · ${axis.name} = ${opt.label}`;
      return `Set Variant on ${targetName}`;
    }
    case 'set-layer-property': {
      const propLabel =
        config.layerProperty === 'fill'
          ? 'Fill'
          : config.layerProperty === 'opacity'
            ? 'Opacity'
            : config.layerProperty === 'text'
              ? 'Text'
              : config.layerProperty === 'transform'
                ? 'Transform'
                : 'Disabled';
      return `Set ${propLabel} on ${targetName}`;
    }
    case 'show-toast': {
      const msg = config.toastMessage.trim();
      return msg ? `Toast “${msg.length > 22 ? `${msg.slice(0, 22)}…` : msg}”` : 'Show Toast';
    }
  }
}

function collectDownstreamFlowNodeIds(
  graph: LogicGraph,
  startNodeId: string,
): string[] {
  const visited = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const conn of graph.connections) {
      if (conn.sourceNodeId === current && !visited.has(conn.targetNodeId)) {
        visited.add(conn.targetNodeId);
        queue.push(conn.targetNodeId);
      }
    }
  }
  return Array.from(visited);
}

export function getApplicableGraphsForScope(
  project: FolioProject,
  scope: 'page' | 'component',
  scopeTargetId: string,
): LogicGraph[] {
  return project.logicGraphs.filter((graph) => {
    if (scope === 'component') {
      return graph.scope === 'component' && graph.targetId === scopeTargetId;
    }
    return (graph.scope === 'page' && graph.targetId === scopeTargetId) || graph.scope === 'project';
  });
}

export function extractLayerInteractions(
  project: FolioProject,
  scope: 'page' | 'component',
  scopeTargetId: string,
  layerId: string,
  scopedNodes: readonly DesignNode[],
): QuickInteractionEntry[] {
  const graphs = getApplicableGraphsForScope(project, scope, scopeTargetId);
  const nodesById = new Map<string, DesignNode>(scopedNodes.map((n) => [n.id, n]));
  const pagesByRoute = new Map<string, FolioPage>(project.pages.map((p) => [p.route, p]));
  const componentsById = new Map<string, ComponentDefinition>(project.components.map((c) => [c.id, c]));

  const entries: QuickInteractionEntry[] = [];

  for (const graph of graphs) {
    const graphNodesById = new Map<string, LogicNode>(graph.nodes.map((n) => [n.id, n]));
    for (const node of graph.nodes) {
      const isLayerTrigger =
        (node.type.startsWith('event.') || node.type === 'source.element') &&
        typeof node.data.targetNodeId === 'string' &&
        node.data.targetNodeId === layerId;
      if (!isLayerTrigger) continue;

      const outgoing = graph.connections.filter((c) => c.sourceNodeId === node.id);
      const parsedTrigger = parseTriggerNode(node);

      if (
        parsedTrigger &&
        outgoing.length === 1 &&
        outgoing[0].sourcePortId === 'exec' &&
        outgoing[0].targetPortId === 'exec'
      ) {
        const conn = outgoing[0];
        const targetLogicNode = graphNodesById.get(conn.targetNodeId);
        const targetIncoming = targetLogicNode
          ? graph.connections.filter((c) => c.targetNodeId === targetLogicNode.id)
          : [];
        const targetOutgoing = targetLogicNode
          ? graph.connections.filter((c) => c.sourceNodeId === targetLogicNode.id)
          : [];
        const parsedAction =
          targetLogicNode && targetIncoming.length === 1 && targetOutgoing.length === 0
            ? parseActionNode(targetLogicNode, layerId)
            : null;

        if (targetLogicNode && parsedAction) {
          const config: QuickInteractionConfig = {
            trigger: parsedTrigger.trigger,
            hoverPhase: parsedTrigger.hoverPhase,
            actionKind: parsedAction.actionKind,
            targetNodeId: parsedAction.targetNodeId ?? layerId,
            visibleMode: parsedAction.visibleMode ?? 'toggle',
            navMode: parsedAction.navMode ?? 'internal',
            route: parsedAction.route ?? (project.pages[0]?.route || '/'),
            axisId: parsedAction.axisId ?? '',
            optionId: parsedAction.optionId ?? '',
            layerProperty: parsedAction.layerProperty ?? 'fill',
            fill: parsedAction.fill ?? '#2dd4bf',
            opacity: parsedAction.opacity ?? 1,
            text: parsedAction.text ?? '',
            transform: parsedAction.transform ?? '',
            disabled: parsedAction.disabled ?? false,
            transitionMs: parsedAction.transitionMs ?? 0,
            toastMessage: parsedAction.toastMessage ?? '',
            toastTone: parsedAction.toastTone ?? 'info',
          };

          entries.push({
            id: `${graph.id}:${node.id}:${targetLogicNode.id}`,
            graphId: graph.id,
            graphName: graph.name,
            triggerNodeId: node.id,
            actionNodeId: targetLogicNode.id,
            connectionId: conn.id,
            focusNodeIds: [node.id, targetLogicNode.id],
            editable: true,
            triggerLabel: parsedTrigger.label,
            actionSummary: summarizeQuickAction(config, nodesById, pagesByRoute, componentsById),
            nodeCountInFlow: 2,
            config,
          });
          continue;
        }
      }

      // Complex or multi-node flow connected to this layer — surface cleanly without overwriting
      const flowNodeIds = collectDownstreamFlowNodeIds(graph, node.id);
      const downstreamCount = Math.max(0, flowNodeIds.length - 1);
      entries.push({
        id: `${graph.id}:${node.id}`,
        graphId: graph.id,
        graphName: graph.name,
        triggerNodeId: node.id,
        actionNodeId: null,
        connectionId: null,
        focusNodeIds: flowNodeIds,
        editable: false,
        triggerLabel: getAnyTriggerLabel(node),
        actionSummary:
          downstreamCount === 0
            ? 'Unconnected trigger in Node Graph'
            : `Custom graph (${flowNodeIds.length} nodes)`,
        nodeCountInFlow: flowNodeIds.length,
        config: null,
      });
    }
  }

  return entries;
}

function computeNextPairY(graph: LogicGraph): number {
  if (graph.nodes.length === 0) return FIRST_ROW_Y;
  let maxY = FIRST_ROW_Y;
  for (const node of graph.nodes) {
    if (node.y > maxY) {
      maxY = node.y;
    }
  }
  return Math.round(maxY + ROW_STEP_Y);
}

export function createQuickInteractionInProject(
  project: FolioProject,
  scopeContext: QuickInteractionScopeContext,
  config: QuickInteractionConfig,
): QuickInteractionMutationResult {
  const now = new Date().toISOString();
  const existingScopedGraph = project.logicGraphs.find(
    (g) => g.scope === scopeContext.scope && g.targetId === scopeContext.scopeTargetId,
  );

  const baseGraph: LogicGraph =
    existingScopedGraph ?? {
      id: createQuickId('lgraph'),
      name: `${scopeContext.scopeName} Interactions`,
      scope: scopeContext.scope,
      targetId: scopeContext.scopeTargetId,
      variables: [],
      nodes: [],
      connections: [],
      frames: [],
      createdAt: now,
      updatedAt: now,
    };

  const pairY = computeNextPairY(baseGraph);
  const triggerSpec = buildTriggerNodeSpec(scopeContext.layerId, config);
  const actionSpec = buildActionNodeSpec(config);

  const triggerNode: LogicNode = {
    id: createQuickId('lnode'),
    type: triggerSpec.type,
    x: TRIGGER_X,
    y: pairY,
    data: triggerSpec.data,
  };

  const actionNode: LogicNode = {
    id: createQuickId('lnode'),
    type: actionSpec.type,
    x: ACTION_X,
    y: pairY,
    data: actionSpec.data,
  };

  const connection: LogicConnection = {
    id: createQuickId('lconn'),
    sourceNodeId: triggerNode.id,
    sourcePortId: 'exec',
    targetNodeId: actionNode.id,
    targetPortId: 'exec',
  };

  const nextGraph: LogicGraph = {
    ...baseGraph,
    nodes: [...baseGraph.nodes, triggerNode, actionNode],
    connections: [...baseGraph.connections, connection],
    updatedAt: now,
  };

  return {
    mode: existingScopedGraph ? 'update' : 'create',
    graph: nextGraph,
    triggerNodeId: triggerNode.id,
    actionNodeId: actionNode.id,
    connectionId: connection.id,
  };
}

export function updateQuickInteractionInGraph(
  graph: LogicGraph,
  entry: QuickInteractionEntry,
  layerId: string,
  nextConfig: QuickInteractionConfig,
): LogicGraph {
  if (!entry.editable || !entry.actionNodeId) return graph;
  const triggerSpec = buildTriggerNodeSpec(layerId, nextConfig);
  const actionSpec = buildActionNodeSpec(nextConfig);

  const nextNodes = graph.nodes.map((node) => {
    if (node.id === entry.triggerNodeId) {
      return {
        ...node,
        type: triggerSpec.type,
        data: triggerSpec.data,
      };
    }
    if (node.id === entry.actionNodeId) {
      return {
        ...node,
        type: actionSpec.type,
        data: actionSpec.data,
      };
    }
    return node;
  });

  const nextConnections = graph.connections.map((conn) => {
    if (conn.id === entry.connectionId) {
      return {
        ...conn,
        sourcePortId: 'exec',
        targetPortId: 'exec',
      };
    }
    return conn;
  });

  return {
    ...graph,
    nodes: nextNodes,
    connections: nextConnections,
    updatedAt: new Date().toISOString(),
  };
}

export function deleteQuickInteractionFromGraph(
  graph: LogicGraph,
  entry: QuickInteractionEntry,
): LogicGraph {
  const removedNodeIds = new Set<string>([entry.triggerNodeId]);
  if (entry.actionNodeId) {
    removedNodeIds.add(entry.actionNodeId);
  }

  const nextNodes = graph.nodes.filter((n) => !removedNodeIds.has(n.id));
  const nextConnections = graph.connections.filter(
    (c) => !removedNodeIds.has(c.sourceNodeId) && !removedNodeIds.has(c.targetNodeId),
  );
  const nextFrames = (graph.frames ?? []).map((frame) => {
    const filteredChildren = frame.childNodeIds.filter((id) => !removedNodeIds.has(id));
    if (filteredChildren.length === frame.childNodeIds.length) return frame;
    return {
      ...frame,
      childNodeIds: filteredChildren,
      // Unbake if a child node was removed so compiledPlan cannot go stale
      baked: false,
      compiledPlan: undefined,
    };
  });

  return {
    ...graph,
    nodes: nextNodes,
    connections: nextConnections,
    frames: nextFrames,
    updatedAt: new Date().toISOString(),
  };
}

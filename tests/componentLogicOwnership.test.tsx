import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';

const hookMocks = vi.hoisted(() => ({
  useState: vi.fn((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ]),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
  useMemo: vi.fn((factory: () => unknown) => factory()),
  useCallback: vi.fn((fn: unknown) => fn),
}));

vi.mock('preact/hooks', () => hookMocks);

import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { NodeLogicNodeFields } from '../src/app/workspace/NodeLogicNodeFields';
import NodeLogicWorkspace from '../src/app/workspace/NodeLogicWorkspace';
import {
  createComponentVariantToggleStarterGraph,
  createOwnerScopedEmptyLogicGraph,
  deriveOwnerContextFromLogicGraph,
  formatNodeLogicOwnerBreadcrumb,
  getLogicNodeSummary,
  resolveActiveLogicGraphForOwner,
  resolveOwnerScopedLogicGraphs,
  type NodeLogicOwnerContext,
} from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  SELF_COMPONENT_VARIANT_TARGET,
  adaptQuickInteractionConfigForActionKind,
  createDefaultQuickInteractionConfig,
  createQuickInteractionInProject,
  extractLayerInteractions,
  getVariantTargetCandidates,
  validateQuickInteractionConfig,
} from '../src/app/workspace/quickInteractions';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { getActivePage } from '../src/core/document/project';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioProject,
  LogicGraph,
} from '../src/core/document/types';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';
import { createPreviewDomHarness, createReactTsxHarness } from './helpers/parityRuntimeHarness';

interface VNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function expandVNode(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expandVNode);
  const vnode = node as VNodeLike;
  if (typeof vnode.type === 'function') {
    return expandVNode((vnode.type as (props: unknown) => unknown)(vnode.props ?? {}));
  }
  if (vnode.props && 'children' in vnode.props) {
    return {
      ...vnode,
      props: {
        ...vnode.props,
        children: expandVNode(vnode.props.children),
      },
    };
  }
  return vnode;
}

function findNodes(
  tree: unknown,
  predicate: (node: VNodeLike) => boolean,
  out: VNodeLike[] = [],
): VNodeLike[] {
  if (!tree || typeof tree !== 'object') return out;
  if (Array.isArray(tree)) {
    for (const item of tree) findNodes(item, predicate, out);
    return out;
  }
  const node = tree as VNodeLike;
  if (predicate(node)) out.push(node);
  if (node.props && 'children' in node.props) {
    findNodes(node.props.children, predicate, out);
  }
  return out;
}

function collectText(tree: unknown): string {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(collectText).join('');
  if (typeof tree === 'object') {
    const node = tree as VNode<{ children?: unknown }>;
    if (typeof node.type === 'function') {
      return collectText((node.type as (props: unknown) => unknown)(node.props ?? {}));
    }
    if (node.props && 'children' in node.props) {
      return collectText(node.props.children);
    }
  }
  return '';
}

function buildSunMoonProject() {
  const base = createInitialProject('Sun Moon Ownership Studio');
  const page = getActivePage(base);
  const now = '2026-11-28T00:00:00.000Z';

  // Nested badge component inside Moon
  const badgePill: DesignNode = {
    ...createRectNode(1),
    id: 'badge-pill',
    name: 'Badge Pill',
    x: 0,
    y: 0,
    width: 72,
    height: 24,
    style: { fill: '#334155', stroke: 'none', strokeWidth: 0, radius: 12 },
  };
  const badgeLabel: DesignNode = {
    ...createTextNode(2),
    id: 'badge-label',
    name: 'Badge Label',
    x: 8,
    y: 4,
    width: 56,
    height: 16,
    text: 'Day',
  };
  const badgeMaster: ComponentDefinition = {
    id: 'comp-sky-badge',
    name: 'SkyBadge',
    nodeLogicEnabled: true,
    variants: [
      {
        id: 'axis-sky',
        name: 'sky',
        defaultOptionId: 'opt-day',
        options: [
          { id: 'opt-day', label: 'Day', overrides: {} },
          {
            id: 'opt-night',
            label: 'Night',
            overrides: {
              'badge-pill': { fill: '#1E1B4B' },
              'badge-label': { text: 'Night' },
            },
          },
        ],
      },
    ],
    document: {
      id: 'doc-sky-badge',
      name: 'SkyBadge',
      width: 72,
      height: 24,
      background: 'transparent',
      nodes: [badgePill, badgeLabel],
    },
    createdAt: now,
    updatedAt: now,
  };

  // Main Sun-Moon Component Master containing plain layers + a nested Component Instance
  const sunDisc: DesignNode = {
    ...createEllipseNode(3),
    id: 'sun-disc',
    name: 'Sun Disc',
    x: 20,
    y: 20,
    width: 80,
    height: 80,
    visible: true,
    style: { fill: '#FACC15', stroke: '#EAB308', strokeWidth: 2 },
  };
  const moonCrescent: DesignNode = {
    ...createRectNode(4),
    id: 'moon-card',
    name: 'Moon Backdrop',
    x: 0,
    y: 0,
    width: 140,
    height: 140,
    style: { fill: '#FEF3C7', stroke: '#F59E0B', strokeWidth: 1, radius: 16 },
  };
  const phaseLabel: DesignNode = {
    ...createTextNode(5),
    id: 'phase-label',
    name: 'Phase Label',
    x: 16,
    y: 108,
    width: 108,
    height: 22,
    text: 'Sun',
  };
  const nestedBadgeInst: ComponentInstanceNode = {
    id: 'nested-badge',
    type: 'component-instance',
    name: 'Sky Badge Child',
    componentId: badgeMaster.id,
    overrides: {},
    x: 60,
    y: 8,
    width: 72,
    height: 24,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  const moonMaster: ComponentDefinition = {
    id: 'comp-moon',
    name: 'Moon',
    nodeLogicEnabled: true,
    variants: [
      {
        id: 'axis-phase',
        name: 'Phase',
        defaultOptionId: 'opt-sun',
        options: [
          {
            id: 'opt-sun',
            label: 'Sun',
            overrides: {
              'sun-disc': { fill: '#FACC15' },
              'moon-card': { fill: '#FEF3C7' },
              'phase-label': { text: 'Sun' },
            },
          },
          {
            id: 'opt-moon',
            label: 'Moon',
            overrides: {
              'sun-disc': { fill: '#93C5FD' },
              'moon-card': { fill: '#0F172A' },
              'phase-label': { text: 'Moon' },
            },
          },
        ],
      },
    ],
    document: {
      id: 'doc-moon',
      name: 'Moon',
      width: 140,
      height: 140,
      background: 'transparent',
      nodes: [moonCrescent, sunDisc, phaseLabel, nestedBadgeInst],
    },
    createdAt: now,
    updatedAt: now,
  };

  const pageRect: DesignNode = {
    ...createRectNode(6),
    id: 'page-banner',
    name: 'Page Banner',
    x: 20,
    y: 20,
    width: 240,
    height: 48,
    style: { fill: '#2563EB', stroke: 'none', strokeWidth: 0, radius: 8 },
  };
  const moonInstA: ComponentInstanceNode = {
    id: 'moon-inst-a',
    type: 'component-instance',
    name: 'Moon A',
    componentId: moonMaster.id,
    overrides: {},
    x: 40,
    y: 100,
    width: 140,
    height: 140,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const moonInstB: ComponentInstanceNode = {
    id: 'moon-inst-b',
    type: 'component-instance',
    name: 'Moon B',
    componentId: moonMaster.id,
    overrides: {},
    x: 220,
    y: 100,
    width: 140,
    height: 140,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  const pageGraph = createLogicGraph({
    id: 'graph-page-main',
    name: 'Main Page Flow',
    scope: 'page',
    targetId: page.id,
    nodes: [
      createLogicNode({
        id: 'ev-page',
        type: 'event.on-click',
        x: 60,
        y: 80,
        data: { targetNodeId: pageRect.id, mode: 'click' },
      }),
    ],
    connections: [],
  });

  const projectGraph = createLogicGraph({
    id: 'graph-project-global',
    name: 'Project Global Flow',
    scope: 'project',
    targetId: null,
    nodes: [],
    connections: [],
  });

  const project: FolioProject = {
    ...base,
    components: [badgeMaster, moonMaster],
    pages: base.pages.map((p) =>
      p.id === page.id
        ? {
            ...p,
            document: {
              ...p.document,
              nodes: [pageRect, moonInstA, moonInstB],
            },
          }
        : p,
    ),
    logicGraphs: [pageGraph, projectGraph],
  };

  return {
    project,
    page,
    pageGraph,
    projectGraph,
    badgeMaster,
    moonMaster,
    moonInstA,
    moonInstB,
    sunDisc,
    nestedBadgeInst,
    pageRect,
  };
}

describe('Part A — Component Logic Ownership & Set Variant Target Repair', () => {
  it('strictly isolates Page, Project, and Component logic graphs and NEVER auto-selects project.logicGraphs[0] for a Component', () => {
    const { project, page, pageGraph, projectGraph, moonMaster, badgeMaster } = buildSunMoonProject();

    const moonOwner: NodeLogicOwnerContext = { scope: 'component', componentId: moonMaster.id };
    const badgeOwner: NodeLogicOwnerContext = { scope: 'component', componentId: badgeMaster.id };
    const pageOwner: NodeLogicOwnerContext = { scope: 'page', pageId: page.id };
    const projectOwner: NodeLogicOwnerContext = { scope: 'project' };

    // Moon has no graph yet — must resolve to empty / null, NEVER pageGraph (logicGraphs[0])!
    expect(resolveOwnerScopedLogicGraphs(project.logicGraphs, moonOwner)).toEqual([]);
    expect(resolveActiveLogicGraphForOwner(project.logicGraphs, moonOwner, null)).toBeNull();
    expect(resolveActiveLogicGraphForOwner(project.logicGraphs, moonOwner, pageGraph.id)).toBeNull();

    // Page & Project remain cleanly separated
    expect(resolveOwnerScopedLogicGraphs(project.logicGraphs, pageOwner).map((g) => g.id)).toEqual([pageGraph.id]);
    expect(resolveOwnerScopedLogicGraphs(project.logicGraphs, projectOwner).map((g) => g.id)).toEqual([projectGraph.id]);

    // Owner breadcrumbs clearly show owner identity
    expect(formatNodeLogicOwnerBreadcrumb(project, page.id, moonOwner).fullLabel).toBe('Component > Moon > Node Logic');
    expect(formatNodeLogicOwnerBreadcrumb(project, page.id, pageOwner).fullLabel).toBe(`Page > ${page.name} > Node Logic`);
    expect(formatNodeLogicOwnerBreadcrumb(project, page.id, projectOwner).fullLabel).toBe(
      `Project > ${project.metadata.name} > Node Logic`,
    );

    // Creating a new empty graph from Component Master produces scope: 'component' + targetId: moonMaster.id
    const moonEmptyGraph = createOwnerScopedEmptyLogicGraph(project, page, moonOwner);
    expect(moonEmptyGraph.scope).toBe('component');
    expect(moonEmptyGraph.targetId).toBe(moonMaster.id);
    expect(deriveOwnerContextFromLogicGraph(moonEmptyGraph, page.id)).toEqual(moonOwner);

    // After adding Moon's graph, reopening Moon returns Moon's graph while Badge still has none
    const updatedGraphs: LogicGraph[] = [...project.logicGraphs, moonEmptyGraph];
    expect(resolveActiveLogicGraphForOwner(updatedGraphs, moonOwner, null)?.id).toBe(moonEmptyGraph.id);
    expect(resolveActiveLogicGraphForOwner(updatedGraphs, badgeOwner, null)).toBeNull();
    expect(resolveActiveLogicGraphForOwner(updatedGraphs, pageOwner, null)?.id).toBe(pageGraph.id);
    expect(resolveActiveLogicGraphForOwner(updatedGraphs, projectOwner, null)?.id).toBe(projectGraph.id);
  });

  it('renders owner breadcrumb and creates Component-scoped LogicGraph when NodeLogicWorkspace is opened from Component Master', () => {
    const { project, page, moonMaster } = buildSunMoonProject();
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const onNotice = vi.fn();
    const onToggleComponentNodeLogic = vi.fn();

    // Open NodeLogicWorkspace in Moon Component Master context (before Moon has any graph)
    const moonTree = expandVNode(
      NodeLogicWorkspace({
        project: store.getSnapshot().editorState.project,
        activePageId: page.id,
        ownerContext: { scope: 'component', componentId: moonMaster.id },
        mainCommandClient: client,
        onNotice,
        onOpenLivePreview: vi.fn(),
        onToggleComponentNodeLogic,
      }),
    );

    // Breadcrumb displays Component > Moon > Node Logic
    const breadcrumb = findNodes(moonTree, (n) => n.props?.['data-testid'] === 'nl-owner-breadcrumb')[0];
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb?.props?.['data-owner-scope']).toBe('component');
    expect(collectText(breadcrumb)).toContain('Component');
    expect(collectText(breadcrumb)).toContain('Moon');
    expect(collectText(breadcrumb)).toContain('Node Logic');

    // Empty state is displayed (NOT the Page graph nodes!)
    const emptyState = findNodes(moonTree, (n) => n.props?.['data-testid'] === 'nl-empty-state')[0];
    expect(emptyState).toBeDefined();
    expect(collectText(emptyState)).toContain('Component “Moon”');

    // Clicking "Create Blank Component Graph" creates a graph owned by Moon (scope: 'component', targetId: comp-moon)
    const buttons = findNodes(moonTree, (n) => n.type === 'button');
    const newGraphBtn = buttons.find((b) => collectText(b).includes('Create Blank Component Graph'));
    expect(newGraphBtn).toBeDefined();
    (newGraphBtn!.props!.onClick as () => void)();

    const graphsAfter = store.getSnapshot().editorState.project.logicGraphs;
    const moonGraphs = graphsAfter.filter((g) => g.scope === 'component' && g.targetId === moonMaster.id);
    expect(moonGraphs).toHaveLength(1);
    expect(graphsAfter.filter((g) => g.scope === 'page')).toHaveLength(1);
    expect(graphsAfter.filter((g) => g.scope === 'project')).toHaveLength(1);

    // Reopening NodeLogicWorkspace for Moon displays Moon's graph (no longer empty)
    const reopenedTree = expandVNode(
      NodeLogicWorkspace({
        project: store.getSnapshot().editorState.project,
        activePageId: page.id,
        ownerContext: { scope: 'component', componentId: moonMaster.id },
        mainCommandClient: client,
        onNotice,
        onOpenLivePreview: vi.fn(),
        onToggleComponentNodeLogic,
      }),
    );
    expect(findNodes(reopenedTree, (n) => n.props?.['data-testid'] === 'nl-empty-state')).toHaveLength(0);
  });

  it('offers "This Component" and nested Component Instances in Set Variant UI, NEVER plain shapes, and separates Event Origin from Action Target', () => {
    const { project, page, moonMaster, badgeMaster, sunDisc, nestedBadgeInst } = buildSunMoonProject();

    const onSunClick = createLogicNode({
      id: 'ev-sun',
      type: 'event.on-click',
      x: 40,
      y: 80,
      data: { targetNodeId: sunDisc.id, mode: 'click' },
    });
    const setVariantSelf = createLogicNode({
      id: 'act-var-self',
      type: 'action.set-variant',
      x: 320,
      y: 80,
      data: {
        targetMode: 'override',
        targetNodeId: '',
        axisId: 'axis-phase',
        optionId: 'opt-moon',
      },
    });
    const moonGraph = createLogicGraph({
      id: 'graph-moon-ui',
      name: 'Moon Logic',
      scope: 'component',
      targetId: moonMaster.id,
      nodes: [onSunClick, setVariantSelf],
      connections: [
        createLogicConnection({
          id: 'c-ev-var',
          sourceNodeId: onSunClick.id,
          sourcePortId: 'exec',
          targetNodeId: setVariantSelf.id,
          targetPortId: 'exec',
        }),
      ],
    });

    const onUpdateNodeData = vi.fn();
    const fieldsTree = expandVNode(
      NodeLogicNodeFields({
        node: setVariantSelf,
        graph: moonGraph,
        scopedAstNodes: moonMaster.document.nodes,
        availableVariables: [],
        components: [badgeMaster, moonMaster],
        pages: [page],
        themes: [],
        animations: [],
        onChangeTab: vi.fn(),
        onUpdateNodeData,
      }),
    );

    const targetSelect = findNodes(fieldsTree, (n) => n.props?.['data-testid'] === 'nl-set-variant-target-select')[0];
    expect(targetSelect).toBeDefined();
    expect(targetSelect!.props!.value).toBe('__this_component__');

    const optionNodes = findNodes(targetSelect, (n) => n.type === 'option');
    const optionValues = optionNodes.map((o) => String(o.props?.value ?? ''));
    const optionLabels = optionNodes.map((o) => collectText(o));

    // Must offer This Component + nested Component Instance
    expect(optionValues).toContain('__this_component__');
    expect(optionLabels.some((l) => l.includes('This Component') && l.includes('Moon'))).toBe(true);
    expect(optionValues).toContain(nestedBadgeInst.id);
    expect(optionLabels.some((l) => l.includes('Sky Badge Child'))).toBe(true);

    // Must NEVER list plain shapes (ellipse, rect, text) as Set Variant targets!
    expect(optionValues).not.toContain('sun-disc');
    expect(optionValues).not.toContain('moon-card');
    expect(optionValues).not.toContain('phase-label');

    // Scope hint explicitly distinguishes Event origin (Sun Disc) from Action target (This Component)
    const scopeHint = findNodes(fieldsTree, (n) => n.props?.['data-testid'] === 'nl-set-variant-scope-hint')[0];
    expect(scopeHint).toBeDefined();
    const hintText = collectText(scopeHint);
    expect(hintText).toContain('Sun Disc');
    expect(hintText).toContain('This Component (Moon — Current Instance)');

    // Summary string reflects This Component · Phase = Moon
    const summary = getLogicNodeSummary(
      setVariantSelf,
      moonMaster.document.nodes,
      [],
      [],
      [],
      [page],
      [badgeMaster, moonMaster],
      moonGraph,
    );
    expect(summary).toContain('This Component');
    expect(summary).toContain('Phase');
    expect(summary).toContain('Moon');

    // Quick Interactions helper also supports This Component without listing plain shapes
    const qiCandidates = getVariantTargetCandidates(moonMaster.document.nodes, [badgeMaster, moonMaster], moonMaster);
    expect(qiCandidates.map((c) => c.id)).toEqual([SELF_COMPONENT_VARIANT_TARGET, nestedBadgeInst.id]);
    const qiBase = createDefaultQuickInteractionConfig({
      selectedNode: sunDisc,
      scopedNodes: moonMaster.document.nodes,
      pages: [page],
      activePageId: page.id,
      components: [badgeMaster, moonMaster],
      ownerComponent: moonMaster,
    });
    const setVarQi = {
      ...adaptQuickInteractionConfigForActionKind(qiBase, 'set-variant', {
        layerId: sunDisc.id,
        scopedNodes: moonMaster.document.nodes,
        pages: [page],
        activePageId: page.id,
        components: [badgeMaster, moonMaster],
        ownerComponent: moonMaster,
      }),
      targetNodeId: SELF_COMPONENT_VARIANT_TARGET,
      axisId: 'axis-phase',
      optionId: 'opt-moon',
    };
    expect(
      validateQuickInteractionConfig(setVarQi, {
        scopedNodes: moonMaster.document.nodes,
        components: [badgeMaster, moonMaster],
        ownerComponent: moonMaster,
      }),
    ).toBeNull();
    const qiCreated = createQuickInteractionInProject(
      project,
      {
        scope: 'component',
        scopeTargetId: moonMaster.id,
        scopeName: moonMaster.name,
        layerId: sunDisc.id,
      },
      setVarQi,
    );
    expect(qiCreated.graph.scope).toBe('component');
    expect(qiCreated.graph.targetId).toBe(moonMaster.id);
    const qiAction = qiCreated.graph.nodes.find((n) => n.id === qiCreated.actionNodeId)!;
    expect(qiAction.type).toBe('action.set-variant');
    expect(qiAction.data.targetMode).toBe('override');
    expect(qiAction.data.targetNodeId).toBe('');
    const qiProject: FolioProject = { ...project, logicGraphs: [...project.logicGraphs, qiCreated.graph] };
    const qiExtracted = extractLayerInteractions(
      qiProject,
      'component',
      moonMaster.id,
      sunDisc.id,
      moonMaster.document.nodes,
    );
    expect(qiExtracted).toHaveLength(1);
    expect(qiExtracted[0].config?.targetNodeId).toBe(SELF_COMPONENT_VARIANT_TARGET);
    expect(qiExtracted[0].actionSummary).toContain('This Component');

    // Semantic validator accepts This Component and nested component-instance, and REJECTS plain shape targets
    expect(validateLogicGraphSemantics(moonGraph, { ...project, logicGraphs: [moonGraph] }).ok).toBe(true);
    const badGraph = {
      ...moonGraph,
      nodes: [
        onSunClick,
        createLogicNode({
          id: 'act-bad',
          type: 'action.set-variant',
          data: { targetMode: 'override', targetNodeId: sunDisc.id, axisId: 'axis-phase', optionId: 'opt-moon' },
        }),
      ],
      connections: [
        createLogicConnection({
          id: 'c-bad',
          sourceNodeId: onSunClick.id,
          sourcePortId: 'exec',
          targetNodeId: 'act-bad',
          targetPortId: 'exec',
        }),
      ],
    };
    const badReport = validateLogicGraphSemantics(badGraph, { ...project, logicGraphs: [badGraph] });
    expect(badReport.ok).toBe(false);
    expect(badReport.errors.some((e) => e.code === 'INCOMPATIBLE_TARGET_NODE')).toBe(true);
  });

  it('executes Sun-Moon Set Variant (This Component + nested Component Instance) across Simulator, Sibling Instances, Live Preview, React TSX, and .flop reload', () => {
    const { project, page, moonMaster, sunDisc, nestedBadgeInst } = buildSunMoonProject();

    // Build Moon's starter toggle graph: On Click(sun-disc) -> Toggle -> Branch -> Set Variant(This Component: Moon / Sun)
    const moonStarter = createComponentVariantToggleStarterGraph(moonMaster);
    expect(moonStarter.scope).toBe('component');
    expect(moonStarter.targetId).toBe(moonMaster.id);

    // Also wire a nested component Set Variant action triggered by clicking moon-card -> switches nested SkyBadge to Night
    const onBackdropClick = createLogicNode({
      id: 'ev-backdrop',
      type: 'event.on-click',
      x: 60,
      y: 360,
      data: { targetNodeId: 'moon-card', mode: 'click' },
    });
    const setNestedNight = createLogicNode({
      id: 'act-nested-night',
      type: 'action.set-variant',
      x: 340,
      y: 360,
      data: {
        targetMode: 'override',
        targetNodeId: nestedBadgeInst.id,
        axisId: 'axis-sky',
        optionId: 'opt-night',
      },
    });
    // Ensure trigger is sun-disc so Event Origin is an internal ellipse layer
    const moonGraph: LogicGraph = {
      ...moonStarter,
      nodes: [
        ...moonStarter.nodes.map((n) =>
          n.type === 'event.on-click' ? { ...n, data: { ...n.data, targetNodeId: sunDisc.id } } : n,
        ),
        onBackdropClick,
        setNestedNight,
      ],
      connections: [
        ...moonStarter.connections,
        createLogicConnection({
          id: 'c-nested',
          sourceNodeId: onBackdropClick.id,
          sourcePortId: 'exec',
          targetNodeId: setNestedNight.id,
          targetPortId: 'exec',
        }),
      ],
    };

    const fullProject: FolioProject = {
      ...project,
      logicGraphs: [...project.logicGraphs, moonGraph],
    };

    // 1. Component Master Simulator (componentId: moonMaster.id)
    const compRt = createPrototypeRuntime(fullProject, { componentId: moonMaster.id });
    const sim1 = compRt.dispatchNodeEvent(sunDisc.id, 'click');
    expect(sim1.nodeOverrides[moonMaster.id]?.variantSelection?.['axis-phase']).toBe('opt-moon');
    // Internal child overrides are applied immediately in Master Simulator
    expect(sim1.nodeOverrides['sun-disc']?.fill).toBe('#93C5FD');
    expect(sim1.nodeOverrides['phase-label']?.text).toBe('Moon');

    const sim2 = compRt.dispatchNodeEvent(sunDisc.id, 'click');
    expect(sim2.nodeOverrides[moonMaster.id]?.variantSelection?.['axis-phase']).toBe('opt-sun');
    expect(sim2.nodeOverrides['sun-disc']?.fill).toBe('#FACC15');
    expect(sim2.nodeOverrides['phase-label']?.text).toBe('Sun');

    // Nested component target in Component Master Simulator
    const simNested = compRt.dispatchNodeEvent('moon-card', 'click');
    expect(simNested.nodeOverrides[nestedBadgeInst.id]?.variantSelection?.['axis-sky']).toBe('opt-night');

    // 2. Page Runtime: two sibling Moon instances stay completely isolated!
    const pageRt = createPrototypeRuntime(fullProject);
    const p1 = pageRt.dispatchNodeEvent('moon-inst-a__sun-disc', 'click');
    expect(p1.nodeOverrides['moon-inst-a']?.variantSelection?.['axis-phase']).toBe('opt-moon');
    expect(p1.nodeOverrides['moon-inst-b']?.variantSelection).toBeUndefined();

    // Clicking Moon A's backdrop updates ONLY Moon A's nested SkyBadge, NOT Moon B's nested SkyBadge
    const p2 = pageRt.dispatchNodeEvent('moon-inst-a__moon-card', 'click');
    expect(p2.nodeOverrides['moon-inst-a__nested-badge']?.variantSelection?.['axis-sky']).toBe('opt-night');
    expect(p2.nodeOverrides['moon-inst-b__nested-badge']?.variantSelection).toBeUndefined();

    // Clicking Moon B toggles Moon B independently without affecting Moon A
    const p3 = pageRt.dispatchNodeEvent('moon-inst-b__sun-disc', 'click');
    expect(p3.nodeOverrides['moon-inst-b']?.variantSelection?.['axis-phase']).toBe('opt-moon');
    expect(p3.nodeOverrides['moon-inst-a']?.variantSelection?.['axis-phase']).toBe('opt-moon');

    // 3. Live Preview HTML & Micro-Runtime parity
    const previewHtml = buildLivePreviewHtml(fullProject);
    expect(previewHtml).toContain('data-folio-id="moon-inst-a__sun-disc"');
    expect(previewHtml).toContain('data-folio-id="moon-inst-b__sun-disc"');

    const previewScript = buildLivePreviewLogicScript(fullProject, getActivePage(fullProject))!;
    expect(previewScript).toBeTruthy();
    const preview = createPreviewDomHarness(
      previewScript,
      [
        'moon-inst-a',
        'moon-inst-a__sun-disc',
        'moon-inst-a__moon-card',
        'moon-inst-a__phase-label',
        'moon-inst-a__nested-badge',
        'moon-inst-a__nested-badge__badge-pill',
        'moon-inst-a__nested-badge__badge-label',
        'moon-inst-b',
        'moon-inst-b__sun-disc',
        'moon-inst-b__phase-label',
        'moon-inst-b__nested-badge',
      ],
      {
        initialTextById: {
          'moon-inst-a__phase-label': 'Sun',
          'moon-inst-b__phase-label': 'Sun',
          'moon-inst-a__nested-badge__badge-label': 'Day',
        },
        initialAttrsById: {
          'moon-inst-a': { 'data-variant-phase': 'Sun' },
          'moon-inst-b': { 'data-variant-phase': 'Sun' },
          'moon-inst-a__nested-badge': { 'data-variant-sky': 'Day' },
          'moon-inst-b__nested-badge': { 'data-variant-sky': 'Day' },
        },
      },
    );

    preview.click('moon-inst-a__sun-disc');
    expect(preview.getAttr('moon-inst-a', 'data-variant-phase')).toBe('Moon');
    expect(preview.elements.get('moon-inst-a__phase-label')?.textContent).toBe('Moon');
    expect(preview.getAttr('moon-inst-b', 'data-variant-phase')).toBe('Sun');

    preview.click('moon-inst-a__moon-card');
    expect(preview.getAttr('moon-inst-a__nested-badge', 'data-variant-sky')).toBe('Night');
    expect(preview.getAttr('moon-inst-b__nested-badge', 'data-variant-sky')).toBe('Day');

    // 4. React TSX parity
    const reactHarness = createReactTsxHarness(fullProject, page.id);
    reactHarness.click('moon-inst-a__sun-disc');
    expect(reactHarness.getText('moon-inst-a__phase-label')).toBe('Moon');
    expect(reactHarness.getText('moon-inst-b__phase-label')).toBe('Sun');

    // 5. .flop JSON Save / Reload preserves component graph ownership & Set Variant target config
    const savedJson = serializeProjectToFlopJson(fullProject);
    const reloaded = migrateProjectToV2(JSON.parse(savedJson));
    const reloadedMoonGraph = resolveActiveLogicGraphForOwner(
      reloaded.logicGraphs,
      { scope: 'component', componentId: moonMaster.id },
      null,
    );
    expect(reloadedMoonGraph).not.toBeNull();
    expect(reloadedMoonGraph!.scope).toBe('component');
    expect(reloadedMoonGraph!.targetId).toBe(moonMaster.id);
    expect(resolveOwnerScopedLogicGraphs(reloaded.logicGraphs, { scope: 'page', pageId: page.id })).toHaveLength(1);
    expect(resolveOwnerScopedLogicGraphs(reloaded.logicGraphs, { scope: 'project' })).toHaveLength(1);

    const reloadedRt = createPrototypeRuntime(reloaded);
    const r1 = reloadedRt.dispatchNodeEvent('moon-inst-a__sun-disc', 'click');
    expect(r1.nodeOverrides['moon-inst-a']?.variantSelection?.['axis-phase']).toBe('opt-moon');
    expect(r1.nodeOverrides['moon-inst-b']?.variantSelection).toBeUndefined();
  });
});

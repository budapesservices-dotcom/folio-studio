import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type {
  DesignNode,
  FolioProject,
  GroupNode,
  LogicGraph,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  autoArrangeLogicGraph,
  createFrameInGraph,
  moveFrameWithChildrenInGraph,
  moveNodeInGraph,
  removeFrameFromGraph,
  resolveLogicPortWorldPosition,
  syncNodeFrameMembershipAfterDrag,
  updateFrameInGraph,
  updateNodeDataInGraph,
} from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  bakeLogicFrame,
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicFramePresetFromFrame,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
  detectFrameInternalCycle,
  getExposableParamsForFrame,
  getPrivateToggleMemoryKey,
  instantiateLogicFramePreset,
  unbakeLogicFrame,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';

function createSmartFrameFixture(): {
  project: FolioProject;
  pageId: string;
  cardAId: string;
  cardBId: string;
  groupId: string;
  childDotId: string;
  statusLabelId: string;
} {
  const base = createInitialProject('Smart Frame Fixture');
  const page = getActivePage(base);

  const baseRectA = createRectNode(1);
  const cardA: DesignNode = {
    ...baseRectA,
    id: 'card-a',
    name: 'Card A',
    x: 40,
    y: 40,
    width: 160,
    height: 90,
    style: { ...baseRectA.style, fill: '#334155' },
  };

  const baseRectB = createRectNode(2);
  const cardB: DesignNode = {
    ...baseRectB,
    id: 'card-b',
    name: 'Card B',
    x: 240,
    y: 40,
    width: 160,
    height: 90,
    style: { ...baseRectB.style, fill: '#475569' },
  };

  const group: GroupNode = {
    id: 'grp-badge',
    type: 'group',
    name: 'Badge Group',
    x: 440,
    y: 40,
    width: 180,
    height: 90,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  const baseDot = createEllipseNode(3);
  const childDot: DesignNode = {
    ...baseDot,
    id: 'dot-child',
    name: 'Badge Dot',
    parentId: group.id,
    x: 460,
    y: 60,
    width: 32,
    height: 32,
    style: { ...baseDot.style, fill: '#64748B' },
  };

  const statusLabel: DesignNode = {
    ...createTextNode(4),
    id: 'status-label',
    name: 'Status Text',
    x: 40,
    y: 180,
    width: 240,
    height: 32,
    text: 'Ready',
  };

  const project: FolioProject = {
    ...base,
    pages: base.pages.map((p) =>
      p.id === page.id
        ? {
            ...p,
            document: {
              ...p.document,
              nodes: [cardA, cardB, group, childDot, statusLabel],
            },
          }
        : p,
    ),
  };

  return {
    project,
    pageId: page.id,
    cardAId: cardA.id,
    cardBId: cardB.id,
    groupId: group.id,
    childDotId: childDot.id,
    statusLabelId: statusLabel.id,
  };
}

function buildToggleColorGraph(pageId: string, cardAId: string, statusLabelId: string): {
  graph: LogicGraph;
  evId: string;
  toggleId: string;
  branchId: string;
  setTrueId: string;
  setFalseId: string;
  afterActionId: string;
} {
  const ev = createLogicNode({
    id: 'n-ev-a',
    type: 'event.on-click',
    x: 40,
    y: 120,
    data: { targetNodeId: cardAId, mode: 'click' },
  });
  const toggle = createLogicNode({
    id: 'n-toggle',
    type: 'state.toggle',
    x: 340,
    y: 120,
    data: { variableId: '', initialValue: false },
  });
  const branch = createLogicNode({
    id: 'n-branch',
    type: 'logic.branch',
    x: 640,
    y: 120,
    data: { mode: 'if-else', pipelineRef: 'step:n-toggle:value', condition: false },
  });
  const setTrue = createLogicNode({
    id: 'n-set-true',
    type: 'action.set-layer',
    x: 940,
    y: 40,
    data: {
      targetMode: 'pipeline',
      targetNodeId: '',
      property: 'fill',
      fill: '#10b981',
    },
  });
  const setFalse = createLogicNode({
    id: 'n-set-false',
    type: 'action.set-layer',
    x: 940,
    y: 220,
    data: {
      targetMode: 'pipeline',
      targetNodeId: '',
      property: 'fill',
      fill: '#ef4444',
    },
  });
  const afterAction = createLogicNode({
    id: 'n-after',
    type: 'action.set-layer',
    x: 1280,
    y: 120,
    data: {
      targetMode: 'static',
      targetNodeId: statusLabelId,
      property: 'text',
      text: 'Updated',
    },
  });

  const graph = createLogicGraph({
    id: 'lg-frames-main',
    name: 'Smart Frame Graph',
    scope: 'page',
    targetId: pageId,
    variables: [],
    nodes: [ev, toggle, branch, setTrue, setFalse, afterAction],
    connections: [
      createLogicConnection({
        id: 'c-1',
        sourceNodeId: ev.id,
        sourcePortId: 'exec',
        targetNodeId: toggle.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-2',
        sourceNodeId: toggle.id,
        sourcePortId: 'next',
        targetNodeId: branch.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-3',
        sourceNodeId: branch.id,
        sourcePortId: 'true',
        targetNodeId: setTrue.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-4',
        sourceNodeId: branch.id,
        sourcePortId: 'false',
        targetNodeId: setFalse.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-5',
        sourceNodeId: setTrue.id,
        sourcePortId: 'next',
        targetNodeId: afterAction.id,
        targetPortId: 'exec',
      }),
    ],
  });

  return {
    graph,
    evId: ev.id,
    toggleId: toggle.id,
    branchId: branch.id,
    setTrueId: setTrue.id,
    setFalseId: setFalse.id,
    afterActionId: afterAction.id,
  };
}

interface MockDomElement {
  id: string;
  textContent: string;
  style: Record<string, string>;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  attributes: Record<string, string>;
  addEventListener: (type: string, cb: (ev: unknown) => void) => void;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  dispatch: (type: string) => void;
}

function createMockPreviewHarness(script: string, ids: readonly string[]) {
  const elements = new Map<string, MockDomElement>();
  for (const id of ids) {
    const el: MockDomElement = {
      id,
      textContent: '',
      style: {},
      listeners: {},
      attributes: { 'data-folio-id': id },
      addEventListener(type, cb) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
          ? this.attributes[name]
          : null;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      dispatch(type) {
        for (const cb of this.listeners[type] ?? []) {
          cb({ target: this, currentTarget: this });
        }
      },
    };
    elements.set(id, el);
  }

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: () => {} },
    },
    body: {
      appendChild: () => {},
    },
    querySelector(selector: string) {
      const match = /\[data-folio-id="([^"]+)"\]/.exec(selector);
      if (match) return elements.get(match[1]) ?? null;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-folio-id]') {
        return Array.from(elements.values());
      }
      return [];
    },
    createElement() {
      return { style: {}, textContent: '', remove: () => {} };
    },
    addEventListener: () => {},
  };

  const mockWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    location: { href: 'http://localhost/', search: '', pathname: '/' },
    history: { back: () => {}, forward: () => {}, replaceState: () => {} },
    addEventListener: () => {},
    dispatchEvent: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const runner = new Function(
    'document',
    'window',
    'CSS',
    'URLSearchParams',
    'console',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    script,
  );
  runner(
    mockDocument,
    mockWindow,
    { escape: (s: string) => s },
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  );

  return {
    elements,
    click(id: string) {
      elements.get(id)?.dispatch('click');
    },
  };
}

describe('Smart Logic Frame — Grouping, Baking, Compilation, Presets & Isolation', () => {
  it('wraps nodes into a frame, moves frame with children, syncs drag-in/out membership, and recalculates bounds on Auto-Arrange', () => {
    const { pageId, cardAId, statusLabelId } = createSmartFrameFixture();
    const { graph, toggleId, branchId, setTrueId, setFalseId, afterActionId } =
      buildToggleColorGraph(pageId, cardAId, statusLabelId);

    const { graph: framedGraph, frame } = createFrameInGraph(graph, {
      title: 'Color Toggle FX',
      color: 'violet',
      childNodeIds: [toggleId, branchId, setTrueId, setFalseId],
    });

    expect(framedGraph.frames?.length).toBe(1);
    expect(frame.childNodeIds).toEqual([toggleId, branchId, setTrueId, setFalseId]);
    expect(frame.isBaked).toBe(false);

    // Move frame header by (+60, +40) -> frame bounds AND every child move identically, external nodes stay put
    const origToggle = framedGraph.nodes.find((n) => n.id === toggleId)!;
    const origAfter = framedGraph.nodes.find((n) => n.id === afterActionId)!;
    const movedGraph = moveFrameWithChildrenInGraph(framedGraph, frame.id, 60, 40);
    const movedFrame = movedGraph.frames![0];
    const movedToggle = movedGraph.nodes.find((n) => n.id === toggleId)!;
    const movedAfter = movedGraph.nodes.find((n) => n.id === afterActionId)!;

    expect(movedFrame.bounds.x).toBe(frame.bounds.x + 60);
    expect(movedFrame.bounds.y).toBe(frame.bounds.y + 40);
    expect(movedToggle.x).toBe(origToggle.x + 60);
    expect(movedToggle.y).toBe(origToggle.y + 40);
    expect(movedAfter.x).toBe(origAfter.x);
    expect(movedAfter.y).toBe(origAfter.y);

    // Drag `setFalse` far outside frame -> auto-removes from frame membership
    const draggedOut = moveNodeInGraph(movedGraph, setFalseId, 2600, 1400);
    const syncedOut = syncNodeFrameMembershipAfterDrag(draggedOut, setFalseId);
    expect(syncedOut.frames![0].childNodeIds).not.toContain(setFalseId);

    // Drag `setFalse` back inside frame center -> auto-adds back to frame membership
    const insideX = movedFrame.bounds.x + 60;
    const insideY = movedFrame.bounds.y + 80;
    const draggedIn = moveNodeInGraph(syncedOut, setFalseId, insideX, insideY);
    const syncedIn = syncNodeFrameMembershipAfterDrag(draggedIn, setFalseId);
    expect(syncedIn.frames![0].childNodeIds).toContain(setFalseId);

    // Auto-Arrange updates node positions and recomputes frame bounds to wrap all children
    const arranged = autoArrangeLogicGraph(syncedIn);
    const arrangedFrame = arranged.frames![0];
    for (const cid of arrangedFrame.childNodeIds) {
      const child = arranged.nodes.find((n) => n.id === cid)!;
      expect(child.x).toBeGreaterThanOrEqual(arrangedFrame.bounds.x);
      expect(child.y).toBeGreaterThanOrEqual(arrangedFrame.bounds.y);
      expect(child.x).toBeLessThan(arrangedFrame.bounds.x + arrangedFrame.bounds.width);
      expect(child.y).toBeLessThan(arrangedFrame.bounds.y + arrangedFrame.bounds.height);
    }

    // Unwrap removes frame without deleting child nodes
    const unwrapped = removeFrameFromGraph(arranged, arrangedFrame.id);
    expect(unwrapped.frames?.length ?? 0).toBe(0);
    expect(unwrapped.nodes.length).toBe(arranged.nodes.length);
  });

  it('bakes a frame with auto-boundary wire detection, compiledPlan, exposed params, live param edits, and lossless Unbake', () => {
    const { project, pageId, cardAId, statusLabelId } = createSmartFrameFixture();
    const { graph, toggleId, branchId, setTrueId, setFalseId, afterActionId } =
      buildToggleColorGraph(pageId, cardAId, statusLabelId);

    const { graph: framedGraph, frame } = createFrameInGraph(graph, {
      title: 'Card Color Toggle',
      color: 'teal',
      childNodeIds: [toggleId, branchId, setTrueId, setFalseId],
    });

    // Discover exposable params & pin both Fill Color fields (branch-disambiguated labels!)
    const candidates = getExposableParamsForFrame(framedGraph, frame);
    const fillCandidates = candidates.filter((c) => c.field === 'fill');
    expect(fillCandidates.length).toBe(2);
    expect(fillCandidates.some((c) => c.label.includes('True'))).toBe(true);
    expect(fillCandidates.some((c) => c.label.includes('False'))).toBe(true);

    const withExposed = updateFrameInGraph(framedGraph, frame.id, {
      exposedParams: fillCandidates.map(({ paramId, nodeId, field, label, type }) => ({
        paramId,
        nodeId,
        field,
        label,
        type,
      })),
    });

    const bakeResult = bakeLogicFrame(withExposed, frame.id, {
      ...project,
      logicGraphs: [withExposed],
    });
    expect(bakeResult.ok).toBe(true);
    if (!bakeResult.ok) return;

    const bakedFrame = bakeResult.frame;
    expect(bakedFrame.isBaked).toBe(true);
    expect(bakedFrame.bakedData).toBeDefined();
    expect(bakedFrame.bakedData!.exposedInputs.length).toBe(1);
    expect(bakedFrame.bakedData!.exposedInputs[0].targetNodeId).toBe(toggleId);
    expect(bakedFrame.bakedData!.exposedInputs[0].targetPort).toBe('exec');
    expect(bakedFrame.bakedData!.exposedOutputs.length).toBe(1);
    expect(bakedFrame.bakedData!.exposedOutputs[0].sourceNodeId).toBe(setTrueId);
    expect(bakedFrame.bakedData!.exposedOutputs[0].sourcePort).toBe('next');

    // Verify compiledPlan topological ordering: toggle before branch before setTrue/setFalse
    const stepOrder = bakedFrame.bakedData!.compiledPlan.steps.map((s) => s.nodeId);
    expect(stepOrder.indexOf(toggleId)).toBeLessThan(stepOrder.indexOf(branchId));
    expect(stepOrder.indexOf(branchId)).toBeLessThan(stepOrder.indexOf(setTrueId));
    expect(stepOrder.indexOf(branchId)).toBeLessThan(stepOrder.indexOf(setFalseId));

    // Boundary wire endpoints resolve onto the Baked Frame Node card
    const displayNodesById = new Map(bakeResult.graph.nodes.map((n) => [n.id, n]));
    const resolvedIn = resolveLogicPortWorldPosition(
      displayNodesById,
      bakeResult.graph.frames ?? [],
      toggleId,
      'exec',
      'in',
    );
    expect(resolvedIn?.x).toBe(bakedFrame.bounds.x);

    // Execute baked graph via Headless Runtime: Click 1 -> True (#10b981) + downstream Status Text = 'Updated'
    const projectBaked: FolioProject = {
      ...project,
      logicGraphs: [bakeResult.graph],
    };
    const runtime = createPrototypeRuntime(projectBaked);
    let snap = runtime.dispatchNodeEvent(cardAId, 'click');
    expect(snap.nodeOverrides[cardAId]?.fill).toBe('#10b981');
    expect(snap.nodeOverrides[statusLabelId]?.text).toBe('Updated');

    // Verify trace collapses baked execution into a single grouped Baked Frame entry with nestedSteps
    const frameTraceEntry = snap.trace.find((entry) => entry.frameId === bakedFrame.id);
    expect(frameTraceEntry).toBeDefined();
    expect(frameTraceEntry?.frameTitle).toBe('Card Color Toggle');
    expect(frameTraceEntry?.nestedSteps?.length).toBeGreaterThanOrEqual(3);

    // Click 2 -> False (#ef4444) using frame-scoped private memory
    snap = runtime.dispatchNodeEvent(cardAId, 'click');
    expect(snap.nodeOverrides[cardAId]?.fill).toBe('#ef4444');
    const expectedKey = getPrivateToggleMemoryKey(
      toggleId,
      {
        layerId: cardAId,
        name: 'Card A',
        type: 'rect',
        animationIds: [],
      },
      bakedFrame.id,
    );
    expect(snap.privateMemory[expectedKey]).toBe(false);

    // Edit Exposed Parameter (True fill -> #8b5cf6) WITHOUT unbaking -> immediate effect!
    const editedBakedGraph = updateNodeDataInGraph(bakeResult.graph, setTrueId, {
      fill: '#8b5cf6',
    });
    const runtimeEdited = createPrototypeRuntime({
      ...project,
      logicGraphs: [editedBakedGraph],
    });
    const editedSnap = runtimeEdited.dispatchNodeEvent(cardAId, 'click');
    expect(editedSnap.nodeOverrides[cardAId]?.fill).toBe('#8b5cf6');

    // Lossless Unbake restores original coordinates, connections, and exposedParams
    const unbakedGraph = unbakeLogicFrame(editedBakedGraph, bakedFrame.id);
    const unbakedFrame = unbakedGraph.frames![0];
    expect(unbakedFrame.isBaked).toBe(false);
    expect(unbakedFrame.bakedData).toBeUndefined();
    expect(unbakedFrame.exposedParams?.length).toBe(2);
    expect(unbakedGraph.connections.length).toBe(graph.connections.length);
    expect(unbakedGraph.nodes.find((n) => n.id === afterActionId)).toBeDefined();
  });

  it('blocks baking on empty frames, internal cycles, or semantic errors, and emits non-blocking portability warning for hardcoded layers', () => {
    const { project, pageId, cardAId } = createSmartFrameFixture();

    // 1. Empty frame rejected
    const emptyGraph = createLogicGraph({
      id: 'lg-empty',
      name: 'Empty',
      scope: 'page',
      targetId: pageId,
      nodes: [],
      connections: [],
    });
    const { graph: withEmptyFrame, frame: emptyFrame } = createFrameInGraph(emptyGraph, {
      title: 'Empty Frame',
      childNodeIds: [],
    });
    const emptyRes = bakeLogicFrame(withEmptyFrame, emptyFrame.id, {
      ...project,
      logicGraphs: [withEmptyFrame],
    });
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.errors.some((e) => e.code === 'EMPTY_FRAME')).toBe(true);
    }

    // 2. Internal infinite exec cycle rejected
    const nA = createLogicNode({ id: 'cyc-a', type: 'state.toggle', x: 100, y: 100, data: { variableId: '' } });
    const nB = createLogicNode({ id: 'cyc-b', type: 'flow.delay', x: 380, y: 100, data: { durationMs: 100 } });
    const cyclicGraph = createLogicGraph({
      id: 'lg-cycle',
      name: 'Cycle',
      scope: 'page',
      targetId: pageId,
      nodes: [nA, nB],
      connections: [
        createLogicConnection({ id: 'cc-1', sourceNodeId: nA.id, sourcePortId: 'next', targetNodeId: nB.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'cc-2', sourceNodeId: nB.id, sourcePortId: 'next', targetNodeId: nA.id, targetPortId: 'exec' }),
      ],
    });
    const { graph: withCycleFrame, frame: cycleFrame } = createFrameInGraph(cyclicGraph, {
      title: 'Cyclic Frame',
      childNodeIds: [nA.id, nB.id],
    });
    expect(detectFrameInternalCycle(withCycleFrame, cycleFrame.childNodeIds)).not.toBeNull();
    const cycleRes = bakeLogicFrame(withCycleFrame, cycleFrame.id, {
      ...project,
      logicGraphs: [withCycleFrame],
    });
    expect(cycleRes.ok).toBe(false);
    if (!cycleRes.ok) {
      expect(cycleRes.errors.some((e) => e.code === 'FRAME_INTERNAL_CYCLE')).toBe(true);
    }

    // 3. Semantic error (unsafe CSS value) rejected
    const badAction = createLogicNode({
      id: 'bad-fill',
      type: 'action.set-layer',
      x: 100,
      y: 100,
      data: {
        targetMode: 'pipeline',
        targetNodeId: '',
        property: 'fill',
        fill: 'javascript:alert(1)',
      },
    });
    const badGraph = createLogicGraph({
      id: 'lg-bad',
      name: 'Bad CSS',
      scope: 'page',
      targetId: pageId,
      nodes: [badAction],
      connections: [],
    });
    const { graph: withBadFrame, frame: badFrame } = createFrameInGraph(badGraph, {
      title: 'Bad CSS Frame',
      childNodeIds: [badAction.id],
    });
    const badRes = bakeLogicFrame(withBadFrame, badFrame.id, {
      ...project,
      logicGraphs: [withBadFrame],
    });
    expect(badRes.ok).toBe(false);
    if (!badRes.ok) {
      expect(badRes.errors.some((e) => e.code === 'UNSAFE_CSS_VALUE')).toBe(true);
    }

    // 4. Hardcoded static layer inside frame succeeds with portability warning HARDCODED_LAYER_IN_FRAME
    const staticAction = createLogicNode({
      id: 'static-act',
      type: 'action.set-layer',
      x: 100,
      y: 100,
      data: {
        targetMode: 'static',
        targetNodeId: cardAId,
        property: 'fill',
        fill: '#22c55e',
      },
    });
    const warnGraph = createLogicGraph({
      id: 'lg-warn',
      name: 'Static Action',
      scope: 'page',
      targetId: pageId,
      nodes: [staticAction],
      connections: [],
    });
    const { graph: withWarnFrame, frame: warnFrame } = createFrameInGraph(warnGraph, {
      title: 'Hardcoded Frame',
      childNodeIds: [staticAction.id],
    });
    const warnRes = bakeLogicFrame(withWarnFrame, warnFrame.id, {
      ...project,
      logicGraphs: [withWarnFrame],
    });
    expect(warnRes.ok).toBe(true);
    expect(warnRes.warnings.some((w) => w.code === 'HARDCODED_LAYER_IN_FRAME')).toBe(true);

    // Semantic validator also surfaces HARDCODED_LAYER_IN_FRAME warning directly on graph
    const graphReport = validateLogicGraphSemantics(withWarnFrame, {
      ...project,
      logicGraphs: [withWarnFrame],
    });
    expect(graphReport.diagnostics.some((d) => d.code === 'HARDCODED_LAYER_IN_FRAME')).toBe(true);
  });

  it('saves a Baked Frame as a Preset and deep-clones independent instances with isolated privateMemory in BOTH Headless Runtime and Live Preview', () => {
    const { project, pageId, cardAId, cardBId, statusLabelId } = createSmartFrameFixture();
    const { graph, toggleId, branchId, setTrueId, setFalseId } =
      buildToggleColorGraph(pageId, cardAId, statusLabelId);

    const { graph: framedGraph, frame } = createFrameInGraph(graph, {
      title: 'Reusable Toggle Paint',
      color: 'emerald',
      childNodeIds: [toggleId, branchId, setTrueId, setFalseId],
    });
    const fillCandidates = getExposableParamsForFrame(framedGraph, frame).filter(
      (c) => c.field === 'fill',
    );
    const withExposed = updateFrameInGraph(framedGraph, frame.id, {
      exposedParams: fillCandidates.map(({ paramId, nodeId, field, label, type }) => ({
        paramId,
        nodeId,
        field,
        label,
        type,
      })),
    });
    const baked = bakeLogicFrame(withExposed, frame.id, {
      ...project,
      logicGraphs: [withExposed],
    });
    expect(baked.ok).toBe(true);
    if (!baked.ok) return;

    // Save Baked Frame as reusable Preset
    const preset = createLogicFramePresetFromFrame(baked.graph, baked.frame, 'Toggle Paint FX');
    expect(preset.nodes.length).toBe(4);
    expect(preset.connections.length).toBe(3); // internal edges only!
    expect(preset.frame.bakedData?.exposedInputs.length).toBeGreaterThanOrEqual(1);

    // Build fresh graph with THREE independent instances of the SAME Preset:
    // - Instance 1 wired to Card A click (True fill = #10b981)
    // - Instance 2 wired to Card B click (custom True fill = #3b82f6)
    // - Instance 3 wired to Card A double-click (custom True fill = #f59e0b -> proves frameId isolation on the SAME layer!)
    const evA = createLogicNode({
      id: 'ev-a',
      type: 'event.on-click',
      x: 40,
      y: 80,
      data: { targetNodeId: cardAId, mode: 'click' },
    });
    const evB = createLogicNode({
      id: 'ev-b',
      type: 'event.on-click',
      x: 40,
      y: 340,
      data: { targetNodeId: cardBId, mode: 'click' },
    });
    const evAHover = createLogicNode({
      id: 'ev-a-hover',
      type: 'event.on-hover',
      x: 40,
      y: 600,
      data: { targetNodeId: cardAId, phase: 'enter' },
    });

    let reuseGraph = createLogicGraph({
      id: 'lg-reuse',
      name: 'Preset Reuse',
      scope: 'page',
      targetId: pageId,
      variables: [],
      nodes: [evA, evB, evAHover],
      connections: [],
    });

    const inst1 = instantiateLogicFramePreset(reuseGraph, preset, { x: 360, y: 80 });
    reuseGraph = inst1.graph;
    const inst2 = instantiateLogicFramePreset(reuseGraph, preset, { x: 360, y: 340 });
    reuseGraph = inst2.graph;
    const inst3 = instantiateLogicFramePreset(reuseGraph, preset, { x: 360, y: 600 });
    reuseGraph = inst3.graph;

    // Verify 100% unique IDs across all instances & remapped step:<newToggleId>:value refs
    expect(inst1.frame.id).not.toBe(inst2.frame.id);
    expect(inst2.frame.id).not.toBe(inst3.frame.id);
    const inst1NodeIds = new Set(inst1.frame.childNodeIds);
    for (const cid of inst2.frame.childNodeIds) {
      expect(inst1NodeIds.has(cid)).toBe(false);
    }

    const inst1Toggle = inst1.nodes.find((n) => n.type === 'state.toggle')!;
    const inst1Branch = inst1.nodes.find((n) => n.type === 'logic.branch')!;
    expect(inst1Branch.data.pipelineRef).toBe(`step:${inst1Toggle.id}:value`);

    const inst2Toggle = inst2.nodes.find((n) => n.type === 'state.toggle')!;
    const inst2Branch = inst2.nodes.find((n) => n.type === 'logic.branch')!;
    expect(inst2Branch.data.pipelineRef).toBe(`step:${inst2Toggle.id}:value`);

    // Customize True fill color on Instance 2 (#3b82f6) and Instance 3 (#f59e0b) via exposedParams
    const inst2TrueParam = inst2.frame.bakedData!.exposedParams.find((p) => p.label.includes('True'))!;
    reuseGraph = updateNodeDataInGraph(reuseGraph, inst2TrueParam.nodeId, { fill: '#3b82f6' });
    const inst3TrueParam = inst3.frame.bakedData!.exposedParams.find((p) => p.label.includes('True'))!;
    reuseGraph = updateNodeDataInGraph(reuseGraph, inst3TrueParam.nodeId, { fill: '#f59e0b' });

    // Wire each event to its Baked Frame's exposed input
    const inp1 = inst1.frame.bakedData!.exposedInputs[0];
    const inp2 = inst2.frame.bakedData!.exposedInputs[0];
    const inp3 = inst3.frame.bakedData!.exposedInputs[0];
    reuseGraph = {
      ...reuseGraph,
      connections: [
        ...reuseGraph.connections,
        createLogicConnection({
          id: 'wire-a-1',
          sourceNodeId: evA.id,
          sourcePortId: 'exec',
          targetNodeId: inp1.targetNodeId,
          targetPortId: inp1.targetPort,
        }),
        createLogicConnection({
          id: 'wire-b-2',
          sourceNodeId: evB.id,
          sourcePortId: 'exec',
          targetNodeId: inp2.targetNodeId,
          targetPortId: inp2.targetPort,
        }),
        createLogicConnection({
          id: 'wire-a-3',
          sourceNodeId: evAHover.id,
          sourcePortId: 'exec',
          targetNodeId: inp3.targetNodeId,
          targetPortId: inp3.targetPort,
        }),
      ],
    };

    const reuseProject: FolioProject = {
      ...project,
      logicGraphs: [reuseGraph],
      logicFramePresets: [preset],
    };

    // 1. Headless Prototype Runtime verification
    const rt = createPrototypeRuntime(reuseProject);
    expect(rt.dispatchNodeEvent(cardAId, 'click').nodeOverrides[cardAId]?.fill).toBe('#10b981');
    expect(rt.getSnapshot().nodeOverrides[cardBId]?.fill).toBeUndefined();

    // Triggering Instance 3 on SAME Card A (hover-enter) has its OWN private toggle (starts false -> toggles to true -> #f59e0b)
    expect(rt.dispatchNodeEvent(cardAId, 'hover-enter').nodeOverrides[cardAId]?.fill).toBe('#f59e0b');

    // Clicking Card A again toggles Instance 1 from true -> false (#ef4444) unaffected by Instance 3
    expect(rt.dispatchNodeEvent(cardAId, 'click').nodeOverrides[cardAId]?.fill).toBe('#ef4444');

    // Clicking Card B toggles Instance 2 independently -> #3b82f6
    expect(rt.dispatchNodeEvent(cardBId, 'click').nodeOverrides[cardBId]?.fill).toBe('#3b82f6');

    // Reset clears all frame-scoped private memory keys
    rt.reset();
    expect(Object.keys(rt.getSnapshot().privateMemory)).toHaveLength(0);

    // 2. Live Preview Codegen runtime parity verification
    const page = getActivePage(reuseProject);
    const script = buildLivePreviewLogicScript(reuseProject, page);
    expect(script).not.toBeNull();
    expect(script ?? '').toContain('Generated by FOLIO Node Logic v1 Runtime');
    expect(script ?? '').toContain('bakedFrames');

    const preview = createMockPreviewHarness(script ?? '', [cardAId, cardBId]);
    preview.click(cardAId);
    expect(preview.elements.get(cardAId)?.style.background).toBe('#10b981');
    expect(preview.elements.get(cardBId)?.style.background).toBeUndefined();

    // Hovering Card A fires Instance 3 independently -> #f59e0b
    preview.elements.get(cardAId)?.dispatch('mouseenter');
    expect(preview.elements.get(cardAId)?.style.background).toBe('#f59e0b');

    // Second single click on Card A toggles Instance 1 to false -> #ef4444
    preview.click(cardAId);
    expect(preview.elements.get(cardAId)?.style.background).toBe('#ef4444');

    // First click on Card B toggles Instance 2 to true -> #3b82f6
    preview.click(cardBId);
    expect(preview.elements.get(cardBId)?.style.background).toBe('#3b82f6');
  });

  it('validates .flop v2 projects with frames & logicFramePresets while remaining 100% backward compatible with legacy projects', () => {
    const { project, pageId, cardAId, statusLabelId } = createSmartFrameFixture();
    const { graph, toggleId, branchId, setTrueId, setFalseId } =
      buildToggleColorGraph(pageId, cardAId, statusLabelId);

    // Legacy project without frames or logicFramePresets must remain valid
    const legacyProject: FolioProject = {
      ...project,
      logicGraphs: [graph],
    };
    expect(validateProject(legacyProject).ok).toBe(true);

    // Project WITH baked frames AND logicFramePresets must validate cleanly
    const { graph: framedGraph, frame } = createFrameInGraph(graph, {
      title: 'Persisted Frame',
      color: 'blue',
      childNodeIds: [toggleId, branchId, setTrueId, setFalseId],
    });
    const baked = bakeLogicFrame(framedGraph, frame.id, {
      ...project,
      logicGraphs: [framedGraph],
    });
    expect(baked.ok).toBe(true);
    if (!baked.ok) return;

    const preset = createLogicFramePresetFromFrame(baked.graph, baked.frame, 'Persisted Preset');
    const modernProject: FolioProject = {
      ...project,
      logicGraphs: [baked.graph],
      logicFramePresets: [preset],
    };
    expect(validateProject(modernProject).ok).toBe(true);

    // Malformed frame (unknown child node ID) must fail validation cleanly
    const malformedGraph: LogicGraph = {
      ...baked.graph,
      frames: [
        {
          ...baked.frame,
          childNodeIds: ['non-existent-node-id'],
        },
      ],
    };
    const malformedRes = validateProject({
      ...project,
      logicGraphs: [malformedGraph],
    });
    expect(malformedRes.ok).toBe(false);
  });
});

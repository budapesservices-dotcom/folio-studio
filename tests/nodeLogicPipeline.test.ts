import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { DesignNode, FolioProject, GroupNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  buildLivePreviewLogicScript,
  buildPipelineOriginRef,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
  formatPipelinePayloadSummary,
  getPrivateToggleMemoryKey,
  getScopedUpstreamOutputs,
  getUpstreamNodes,
  getUpstreamPipelineOrigins,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';

function createGroupScenarioFixture(): {
  project: FolioProject;
  pageId: string;
  groupAId: string;
  rectAId: string;
  ellipseAId: string;
  groupBId: string;
  rectBId: string;
  labelId: string;
} {
  const base = createInitialProject('Scoped Pipeline Fixture');
  const page = getActivePage(base);

  const groupA: GroupNode = {
    id: 'grp-card-a',
    type: 'group',
    name: 'Toggle Card A',
    x: 40,
    y: 40,
    width: 220,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const baseRectA = createRectNode(2);
  const rectA: DesignNode = {
    ...baseRectA,
    id: 'rect-a',
    name: 'Card Rect',
    parentId: groupA.id,
    x: 50,
    y: 50,
    width: 140,
    height: 80,
    style: { ...baseRectA.style, fill: '#3B82F6' },
  };
  const baseEllipseA = createEllipseNode(3);
  const ellipseA: DesignNode = {
    ...baseEllipseA,
    id: 'ellipse-a',
    name: 'Status Dot',
    parentId: groupA.id,
    x: 210,
    y: 64,
    width: 28,
    height: 28,
    style: { ...baseEllipseA.style, fill: '#F59E0B' },
  };

  const groupB: GroupNode = {
    id: 'grp-card-b',
    type: 'group',
    name: 'Toggle Card B',
    x: 320,
    y: 40,
    width: 220,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const baseRectB = createRectNode(5);
  const rectB: DesignNode = {
    ...baseRectB,
    id: 'rect-b',
    name: 'Card B Rect',
    parentId: groupB.id,
    x: 330,
    y: 50,
    width: 140,
    height: 80,
    style: { ...baseRectB.style, fill: '#64748B' },
  };

  const label: DesignNode = {
    ...createTextNode(6),
    id: 'txt-status',
    name: 'Status Label',
    x: 40,
    y: 200,
    width: 220,
    height: 32,
    text: 'Idle',
  };

  const project: FolioProject = {
    ...base,
    pages: base.pages.map((p) =>
      p.id === page.id
        ? {
            ...p,
            document: {
              ...p.document,
              nodes: [groupA, rectA, ellipseA, groupB, rectB, label],
            },
          }
        : p,
    ),
  };

  return {
    project,
    pageId: page.id,
    groupAId: groupA.id,
    rectAId: rectA.id,
    ellipseAId: ellipseA.id,
    groupBId: groupB.id,
    rectBId: rectB.id,
    labelId: label.id,
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

  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
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
    addEventListener(type: string, cb: (ev: unknown) => void) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(cb);
    },
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

describe('Folio Node Logic — Scoped Data Pipeline (Context Accumulation)', () => {
  it('performs cycle-safe upstream traversal across linear, diamond, cyclic, and disconnected graphs', () => {
    const n1 = createLogicNode({ id: 'n1', type: 'event.on-click', x: 0, y: 0 });
    const n2 = createLogicNode({ id: 'n2', type: 'state.toggle', x: 200, y: 0 });
    const n3 = createLogicNode({ id: 'n3', type: 'logic.branch', x: 400, y: 0 });
    const n4 = createLogicNode({ id: 'n4', type: 'action.set-layer', x: 600, y: 0 });
    const isolated = createLogicNode({ id: 'n-isolated', type: 'state.toggle', x: 0, y: 300 });

    const connections = [
      createLogicConnection({ id: 'c1', sourceNodeId: n1.id, sourcePortId: 'exec', targetNodeId: n2.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c2', sourceNodeId: n2.id, sourcePortId: 'next', targetNodeId: n3.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c3', sourceNodeId: n3.id, sourcePortId: 'true', targetNodeId: n4.id, targetPortId: 'exec' }),
      // Intentional cycle back from n4 -> n2 to test cycle safety
      createLogicConnection({ id: 'c-cycle', sourceNodeId: n4.id, sourcePortId: 'next', targetNodeId: n2.id, targetPortId: 'exec' }),
    ];

    const upstreamOfN4 = getUpstreamNodes([n1, n2, n3, n4, isolated], connections, n4.id);
    const upstreamIds = upstreamOfN4.map((n) => n.id);
    expect(upstreamIds).toEqual(['n3', 'n2', 'n1']);
    expect(upstreamIds).not.toContain('n4');
    expect(upstreamIds).not.toContain('n-isolated');

    // Disconnected isolated node has zero upstream nodes
    expect(getUpstreamNodes([n1, n2, n3, n4, isolated], connections, isolated.id)).toEqual([]);
  });

  it('builds a lightweight PipelineOriginRef for Groups including child refs without cloning AST styles', () => {
    const { project, groupAId, rectAId, ellipseAId } = createGroupScenarioFixture();
    const page = getActivePage(project);
    const astMap = new Map(page.document.nodes.map((n) => [n.id, n]));

    const origin = buildPipelineOriginRef(groupAId, astMap);
    expect(origin).not.toBeNull();
    expect(origin?.layerId).toBe(groupAId);
    expect(origin?.name).toBe('Toggle Card A');
    expect(origin?.type).toBe('group');
    expect(origin?.children).toEqual([
      { id: rectAId, name: 'Card Rect', type: 'rect' },
      { id: ellipseAId, name: 'Status Dot', type: 'ellipse' },
    ]);
    // Verify lightweight reference: does NOT carry heavy style/geometry fields
    const originKeys = Object.keys(origin ?? {});
    expect(originKeys).not.toContain('style');
    expect(originKeys).not.toContain('x');
  });

  it('executes On Click (Group: Rect + Ellipse) -> Toggle State (Private Memory) -> Branch -> Pipeline Child Actions identically in Headless Simulator and Live Preview', () => {
    const { project, pageId, groupAId, rectAId, ellipseAId } = createGroupScenarioFixture();

    const onClick = createLogicNode({
      id: 'node-click',
      type: 'event.on-click',
      x: 40,
      y: 80,
      data: { targetNodeId: groupAId, mode: 'click' },
    });
    // Zero manual variables declared! Toggle State uses target-bound private memory.
    const toggle = createLogicNode({
      id: 'node-toggle',
      type: 'state.toggle',
      x: 320,
      y: 80,
      data: { variableId: '', initialValue: false },
    });
    const branch = createLogicNode({
      id: 'node-branch',
      type: 'logic.branch',
      x: 600,
      y: 80,
      data: { mode: 'if-else', pipelineRef: `step:${toggle.id}:value`, condition: false },
    });
    const actRectOn = createLogicNode({
      id: 'node-rect-on',
      type: 'action.set-layer',
      x: 900,
      y: 20,
      data: {
        targetMode: 'pipeline',
        pipelineChildId: rectAId,
        targetNodeId: '',
        property: 'fill',
        fill: '#10B981',
      },
    });
    const actEllipseHide = createLogicNode({
      id: 'node-ellipse-hide',
      type: 'action.set-layer',
      x: 1180,
      y: 20,
      data: {
        targetMode: 'pipeline',
        pipelineChildId: ellipseAId,
        targetNodeId: '',
        property: 'visible',
        visibleMode: 'hide',
      },
    });
    const actRectOff = createLogicNode({
      id: 'node-rect-off',
      type: 'action.set-layer',
      x: 900,
      y: 180,
      data: {
        targetMode: 'pipeline',
        pipelineChildId: rectAId,
        targetNodeId: '',
        property: 'fill',
        fill: '#3B82F6',
      },
    });
    const actEllipseShow = createLogicNode({
      id: 'node-ellipse-show',
      type: 'action.set-layer',
      x: 1180,
      y: 180,
      data: {
        targetMode: 'pipeline',
        pipelineChildId: ellipseAId,
        targetNodeId: '',
        property: 'visible',
        visibleMode: 'show',
      },
    });

    const graph = createLogicGraph({
      id: 'graph-group-toggle',
      name: 'Group Pipeline Toggle',
      scope: 'page',
      targetId: pageId,
      variables: [], // No manual variables!
      nodes: [onClick, toggle, branch, actRectOn, actEllipseHide, actRectOff, actEllipseShow],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: toggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: toggle.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: actRectOn.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: actRectOn.id, sourcePortId: 'next', targetNodeId: actEllipseHide.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c5', sourceNodeId: branch.id, sourcePortId: 'false', targetNodeId: actRectOff.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c6', sourceNodeId: actRectOff.id, sourcePortId: 'next', targetNodeId: actEllipseShow.id, targetPortId: 'exec' }),
      ],
    });

    const fullProject: FolioProject = { ...project, logicGraphs: [graph] };

    // 1. Validate .flop v2 schema & semantic diagnostics (zero errors, zero warnings)
    expect(validateProject(fullProject).ok).toBe(true);
    const report = validateLogicGraphSemantics(graph, fullProject);
    expect(report.diagnostics).toEqual([]);

    // 2. Verify Dynamic Scoped Data Picker & Upstream Origins for Branch and Action
    const page = getActivePage(fullProject);
    const astMap = new Map(page.document.nodes.map((n) => [n.id, n]));
    const branchOutputs = getScopedUpstreamOutputs(graph.nodes, graph.connections, branch.id, astMap);
    expect(branchOutputs.some((opt) => opt.refKey === `step:${toggle.id}:value` && opt.valueType === 'boolean')).toBe(true);
    expect(branchOutputs.some((opt) => opt.refKey === `step:${toggle.id}:previous` && opt.valueType === 'boolean')).toBe(true);

    const actionOrigins = getUpstreamPipelineOrigins(graph.nodes, graph.connections, actRectOn.id, astMap);
    expect(actionOrigins).toHaveLength(1);
    expect(actionOrigins[0].layerId).toBe(groupAId);
    expect(actionOrigins[0].children?.map((c) => c.id)).toEqual([rectAId, ellipseAId]);

    // 3. Headless Prototype Simulator execution
    const runtime = createPrototypeRuntime(fullProject);
    const memKey = getPrivateToggleMemoryKey(toggle.id, actionOrigins[0]);
    expect(memKey).toBe(`${toggle.id}:${groupAId}`);

    // Click 1: false -> true => Rect turns #10B981, Ellipse hidden
    const snap1 = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(snap1.privateMemory[memKey]).toBe(true);
    expect(snap1.nodeOverrides[rectAId]?.fill).toBe('#10B981');
    expect(snap1.nodeOverrides[ellipseAId]?.visible).toBe(false);
    // Execution trace includes structured step payloads
    const toggleTrace = snap1.trace.find((entry) => entry.nodeId === toggle.id);
    expect(toggleTrace?.payload).toEqual({ value: true, previous: false });
    expect(formatPipelinePayloadSummary(toggleTrace?.payload)).toContain('value: true');

    // Click 2: true -> false => Rect turns #3B82F6, Ellipse visible
    const snap2 = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(snap2.privateMemory[memKey]).toBe(false);
    expect(snap2.nodeOverrides[rectAId]?.fill).toBe('#3B82F6');
    expect(snap2.nodeOverrides[ellipseAId]?.visible).toBe(true);

    // Reset clears privateMemory completely
    const resetSnap = runtime.reset();
    expect(resetSnap.privateMemory).toEqual({});
    expect(resetSnap.nodeOverrides).toEqual({});

    // Click after Reset starts fresh from initialValue=false -> true
    const snapAfterReset = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(snapAfterReset.privateMemory[memKey]).toBe(true);
    expect(snapAfterReset.nodeOverrides[rectAId]?.fill).toBe('#10B981');

    // 4. Live Preview compiled script executes identical semantics
    const previewScript = buildLivePreviewLogicScript(fullProject, page);
    expect(previewScript).not.toBeNull();
    expect(previewScript ?? '').toContain('privateMemory');
    const harness = createMockPreviewHarness(previewScript ?? '', [groupAId, rectAId, ellipseAId]);

    harness.click(groupAId);
    expect(harness.elements.get(rectAId)?.style.background).toBe('#10B981');
    expect(harness.elements.get(ellipseAId)?.style.display).toBe('none');

    harness.click(groupAId);
    expect(harness.elements.get(rectAId)?.style.background).toBe('#3B82F6');
    expect(harness.elements.get(ellipseAId)?.style.display).toBe('block');
  });

  it('isolates Target-Bound Private Memory across different origins and isolates disconnected flows', () => {
    const { project, pageId, groupAId, rectAId, groupBId, rectBId } = createGroupScenarioFixture();

    const clickA = createLogicNode({ id: 'click-a', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: groupAId } });
    const clickB = createLogicNode({ id: 'click-b', type: 'event.on-click', x: 0, y: 200, data: { targetNodeId: groupBId } });
    // Both events fan into the same Toggle State node — private memory key `${node.id}:${origin.layerId}` isolates them!
    const sharedToggle = createLogicNode({ id: 'toggle-shared', type: 'state.toggle', x: 260, y: 100, data: { variableId: '', initialValue: false } });
    const branch = createLogicNode({ id: 'branch-1', type: 'logic.branch', x: 520, y: 100, data: { mode: 'if-else', pipelineRef: `step:${sharedToggle.id}:value` } });
    const setFillOn = createLogicNode({ id: 'fill-on', type: 'action.set-layer', x: 800, y: 40, data: { targetMode: 'override', targetNodeId: rectAId, property: 'fill', fill: '#22C55E' } });
    const setFillOff = createLogicNode({ id: 'fill-off', type: 'action.set-layer', x: 800, y: 180, data: { targetMode: 'override', targetNodeId: rectBId, property: 'fill', fill: '#EF4444' } });

    const graph = createLogicGraph({
      id: 'graph-multi-origin',
      name: 'Multi Origin Isolation',
      scope: 'page',
      targetId: pageId,
      nodes: [clickA, clickB, sharedToggle, branch, setFillOn, setFillOff],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: clickA.id, sourcePortId: 'exec', targetNodeId: sharedToggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: clickB.id, sourcePortId: 'exec', targetNodeId: sharedToggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: sharedToggle.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setFillOn.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c5', sourceNodeId: branch.id, sourcePortId: 'false', targetNodeId: setFillOff.id, targetPortId: 'exec' }),
      ],
    });

    const runtime = createPrototypeRuntime({ ...project, logicGraphs: [graph] });

    // Click A -> A becomes true, B untouched
    const s1 = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(s1.privateMemory[`${sharedToggle.id}:${groupAId}`]).toBe(true);
    expect(s1.privateMemory[`${sharedToggle.id}:${groupBId}`]).toBeUndefined();

    // Click B -> B starts independently at false -> true (does NOT inherit A's true!)
    const s2 = runtime.dispatchNodeEvent(groupBId, 'click');
    expect(s2.privateMemory[`${sharedToggle.id}:${groupAId}`]).toBe(true);
    expect(s2.privateMemory[`${sharedToggle.id}:${groupBId}`]).toBe(true);

    // Click A again -> A flips to false while B stays true
    const s3 = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(s3.privateMemory[`${sharedToggle.id}:${groupAId}`]).toBe(false);
    expect(s3.privateMemory[`${sharedToggle.id}:${groupBId}`]).toBe(true);
  });

  it('reports clear NODE DIAGNOSTICS when upstream wires are disconnected or when Toggle State binds a non-boolean variable', () => {
    const { project, pageId, groupAId, rectAId } = createGroupScenarioFixture();
    const numVar = createLogicVariable({ id: 'var-count', name: 'count', valueType: 'number', initialValue: 0 });

    const onClick = createLogicNode({ id: 'ev-1', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: groupAId } });
    const toggle = createLogicNode({ id: 'tog-1', type: 'state.toggle', x: 260, y: 0, data: { variableId: numVar.id } });
    // Disconnected branch still referencing tog-1:value!
    const branch = createLogicNode({
      id: 'br-1',
      type: 'logic.branch',
      x: 520,
      y: 0,
      data: { mode: 'if-else', pipelineRef: `step:${toggle.id}:value` },
    });
    // Disconnected action set to Inherit from Pipeline with no upstream origin!
    const action = createLogicNode({
      id: 'act-1',
      type: 'action.set-layer',
      x: 780,
      y: 0,
      data: { targetMode: 'pipeline', pipelineChildId: rectAId, property: 'fill', fill: '#10B981' },
    });

    const graph = createLogicGraph({
      id: 'graph-diags',
      name: 'Disconnected Pipeline Diags',
      scope: 'page',
      targetId: pageId,
      variables: [numVar],
      nodes: [onClick, toggle, branch, action],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: toggle.id, targetPortId: 'exec' }),
        // Wire between toggle -> branch and branch -> action is intentionally unplugged!
      ],
    });

    const report = validateLogicGraphSemantics(graph, { ...project, logicGraphs: [graph] });
    const codes = report.diagnostics.map((d) => `${d.nodeId}:${d.code}`);

    // Strictly forbids non-boolean variable on Toggle State
    expect(codes).toContain(`${toggle.id}:VARIABLE_TYPE_MISMATCH`);
    // Flags disconnected upstream output reference on Branch
    expect(codes).toContain(`${branch.id}:DISCONNECTED_PIPELINE_REF`);
    // Flags disconnected pipeline origin on Action
    expect(codes).toContain(`${action.id}:DISCONNECTED_PIPELINE_ORIGIN`);
  });

  it('preserves 100% backward compatibility with legacy Shared Variable graphs', () => {
    const { project, pageId, groupAId, labelId } = createGroupScenarioFixture();
    const boolVar = createLogicVariable({ id: 'var-open', name: 'isOpen', valueType: 'boolean', initialValue: false });

    const onClick = createLogicNode({ id: 'ev-legacy', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: groupAId } });
    const toggle = createLogicNode({ id: 'tog-legacy', type: 'state.toggle', x: 260, y: 0, data: { variableId: boolVar.id } });
    const setText = createLogicNode({ id: 'txt-legacy', type: 'action.set-text', x: 520, y: 0, data: { targetNodeId: labelId, text: 'Opened' } });

    const graph = createLogicGraph({
      id: 'graph-legacy',
      name: 'Legacy Shared Var Flow',
      scope: 'page',
      targetId: pageId,
      variables: [boolVar],
      nodes: [onClick, toggle, setText],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: toggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: toggle.id, sourcePortId: 'next', targetNodeId: setText.id, targetPortId: 'exec' }),
      ],
    });

    const fullProject: FolioProject = { ...project, logicGraphs: [graph] };
    expect(validateLogicGraphSemantics(graph, fullProject).diagnostics).toEqual([]);

    const runtime = createPrototypeRuntime(fullProject);
    const snap = runtime.dispatchNodeEvent(groupAId, 'click');
    expect(snap.variables[boolVar.id]).toBe(true);
    expect(snap.nodeOverrides[labelId]?.text).toBe('Opened');
  });
});

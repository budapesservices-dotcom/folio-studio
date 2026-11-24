import { describe, expect, it } from 'vitest';
import {
  LOGIC_CATALOG_LIST,
  addVariableToGraph,
  createLogicPresetGraph,
  updateNetworkSettingsInGraph,
} from '../src/app/workspace/nodeLogicGraphHelpers';
import { createInteractiveStarterProject } from '../src/app/workspace/starterProject';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { FolioProject } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  LOGIC_NODE_CATALOG,
  PRIMARY_LOGIC_NODE_TYPES,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
  getLogicNodeGuide,
  validateLogicGraphSemantics,
  type LogicNodeCategory,
} from '../src/engines/prototype';

function createFixtureProject(): {
  project: FolioProject;
  pageId: string;
  buttonId: string;
  labelId: string;
  modalId: string;
} {
  const base = createInitialProject('V2 Architecture Test');
  const page = getActivePage(base);
  const btn = { ...createRectNode(1), id: 'btn-1', name: 'Action Button', x: 40, y: 40, width: 160, height: 48, fill: '#3B82F6' };
  const label = { ...createTextNode(2), id: 'txt-1', name: 'Status Label', x: 40, y: 110, width: 220, height: 32, text: 'Ready' };
  const modal = { ...createRectNode(3), id: 'modal-1', name: 'Modal Card', x: 100, y: 180, width: 280, height: 180, fill: '#1E293B', visible: false };

  const project: FolioProject = {
    ...base,
    pages: base.pages.map((p) =>
      p.id === page.id
        ? { ...p, document: { ...p.document, nodes: [btn, label, modal] } }
        : p,
    ),
  };
  return { project, pageId: page.id, buttonId: btn.id, labelId: label.id, modalId: modal.id };
}

describe('Folio Node Logic v2 — 31-Node, 7-Category Efficient Architecture', () => {
  it('exposes the exact 31 primary nodes across all 7 categories in LOGIC_CATALOG_LIST', () => {
    expect(PRIMARY_LOGIC_NODE_TYPES).toHaveLength(31);
    expect(LOGIC_CATALOG_LIST).toHaveLength(31);

    const counts: Record<LogicNodeCategory, number> = {
      source: 0,
      event: 0,
      state: 0,
      logic: 0,
      action: 0,
      flow: 0,
      network: 0,
    };
    for (const def of LOGIC_CATALOG_LIST) {
      expect(def.legacy).not.toBe(true);
      counts[def.category] += 1;
    }

    expect(counts).toEqual({
      source: 3,
      event: 8,
      state: 3,
      logic: 5,
      action: 6,
      flow: 3,
      network: 3,
    });
  });

  it('gives all 8 Event nodes default Once, Debounce, and Throttle settings and honors Once in runtime', () => {
    const eventDefs = LOGIC_CATALOG_LIST.filter((def) => def.category === 'event');
    expect(eventDefs).toHaveLength(8);
    for (const def of eventDefs) {
      expect(def.defaultData.once).toBe(false);
      expect(def.defaultData.debounceMs).toBe(0);
      expect(def.defaultData.throttleMs).toBe(0);
    }

    const { project, pageId, buttonId } = createFixtureProject();
    const countVar = createLogicVariable({
      id: 'v-count',
      name: 'clicks',
      valueType: 'number',
      initialValue: 0,
      scope: 'local',
      persist: 'none',
    });
    const onClick = createLogicNode({
      id: 'n-click',
      type: 'event.on-click',
      data: { targetNodeId: buttonId, mode: 'click', once: true, debounceMs: 0, throttleMs: 0 },
    });
    const inc = createLogicNode({
      id: 'n-inc',
      type: 'state.update',
      data: { variableId: countVar.id, operation: 'increment', step: 1 },
    });
    const graph = createLogicGraph({
      id: 'g-once',
      name: 'Once Guard',
      scope: 'page',
      targetId: pageId,
      variables: [countVar],
      nodes: [onClick, inc],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: inc.id, targetPortId: 'exec' }),
      ],
    });
    const runtime = createPrototypeRuntime({ ...project, logicGraphs: [graph] }, { pageId });
    runtime.mount();
    runtime.dispatchNodeEvent(buttonId, 'click');
    runtime.dispatchNodeEvent(buttonId, 'click');
    expect(runtime.getSnapshot().variables[countVar.id]).toBe(1);
  });

  it('validates and runs extended Variables (list, object, scope, persist, computed) and dynamic state.update operations', () => {
    const { project, pageId, buttonId } = createFixtureProject();
    let graph = createLogicGraph({
      id: 'g-vars',
      name: 'Dynamic State',
      scope: 'page',
      targetId: pageId,
      nodes: [],
      connections: [],
    });
    const addedList = addVariableToGraph(graph, {
      name: 'tags',
      valueType: 'list',
      initialValue: '["alpha"]',
      scope: 'global',
      persist: 'local',
    });
    graph = addedList.graph;

    const addedObj = addVariableToGraph(graph, {
      name: 'profile',
      valueType: 'object',
      initialValue: '{"role":"guest"}',
      scope: 'global',
      persist: 'session',
    });
    graph = addedObj.graph;

    const addedComputed = addVariableToGraph(graph, {
      name: 'summary',
      valueType: 'string',
      initialValue: '',
      computed: true,
      computedExpression: '{{tags}}',
    });
    graph = addedComputed.graph;

    graph = updateNetworkSettingsInGraph(graph, {
      baseUrl: 'https://api.folio.dev',
      globalHeaders: '{"X-App":"Folio"}',
      authToken: 'env:FOLIO_TOKEN',
    });

    const clickNode = createLogicNode({ id: 'n-click', type: 'event.on-click', data: { targetNodeId: buttonId } });
    const pushTag = createLogicNode({
      id: 'n-push',
      type: 'state.update',
      data: { variableId: addedList.variable.id, operation: 'push', value: 'beta' },
    });
    const setRole = createLogicNode({
      id: 'n-obj',
      type: 'state.update',
      data: { variableId: addedObj.variable.id, operation: 'set-property', propertyPath: 'role', value: 'admin' },
    });

    const fullGraph = {
      ...graph,
      nodes: [clickNode, pushTag, setRole],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: clickNode.id, sourcePortId: 'exec', targetNodeId: pushTag.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: pushTag.id, sourcePortId: 'next', targetNodeId: setRole.id, targetPortId: 'exec' }),
      ],
    };

    const fullProject: FolioProject = { ...project, logicGraphs: [fullGraph] };
    expect(validateProject(fullProject).ok).toBe(true);
    expect(validateLogicGraphSemantics(fullGraph, fullProject).errors).toHaveLength(0);

    const runtime = createPrototypeRuntime(fullProject, { pageId });
    runtime.mount();
    const snap = runtime.dispatchNodeEvent(buttonId, 'click');
    expect(snap.variables[addedList.variable.id]).toEqual(['alpha', 'beta']);
    expect(snap.variables[addedObj.variable.id]).toEqual({ role: 'admin' });
  });

  it('executes Math, Condition, Text (currency), List Processor, Set Layer, Overlay & Toast, Flow Control, and Network HTTP + JSON nodes', () => {
    const { project, pageId, buttonId, labelId, modalId } = createFixtureProject();
    const itemsVar = createLogicVariable({
      id: 'v-items',
      name: 'items',
      valueType: 'list',
      initialValue: '[{"title":"Pro Plan","price":49},{"title":"Starter","price":19}]',
    });

    const click = createLogicNode({ id: 'n-click', type: 'event.on-click', data: { targetNodeId: buttonId } });
    const flowCtrl = createLogicNode({ id: 'n-seq', type: 'flow.control', data: { mode: 'sequence' } });
    const httpReq = createLogicNode({
      id: 'n-http',
      type: 'network.http',
      data: { method: 'GET', url: '/pricing', useAuth: true, cache: 'default' },
    });
    const jsonTool = createLogicNode({
      id: 'n-json',
      type: 'network.json',
      data: { mode: 'get-field', path: 'ok' },
    });
    const mathNode = createLogicNode({
      id: 'n-math',
      type: 'logic.math',
      data: { operation: 'clamp', a: 140, min: 0, max: 100 },
    });
    const textFmt = createLogicNode({
      id: 'n-text',
      type: 'logic.text',
      data: { mode: 'format-currency', locale: 'en-US', currency: 'USD', decimals: 0 },
    });
    const setLayer = createLogicNode({
      id: 'n-layer',
      type: 'action.set-layer',
      data: { targetNodeId: labelId, property: 'text', transitionMs: 180 },
    });
    const openModal = createLogicNode({
      id: 'n-modal',
      type: 'action.overlay-toast',
      data: { mode: 'open-modal', targetNodeId: modalId },
    });
    const showToast = createLogicNode({
      id: 'n-toast',
      type: 'action.overlay-toast',
      data: { mode: 'show-toast', message: 'Synced!', tone: 'success' },
    });
    const getItems = createLogicNode({ id: 'n-get-items', type: 'state.get', data: { variableId: itemsVar.id } });
    const listProc = createLogicNode({
      id: 'n-list',
      type: 'logic.list',
      data: { operation: 'filter', field: 'title', matchValue: 'Pro' },
    });
    const condCheck = createLogicNode({
      id: 'n-cond',
      type: 'logic.condition',
      data: { mode: 'compare', operator: '==', right: 1 },
    });
    const branch = createLogicNode({ id: 'n-branch', type: 'logic.branch', data: { mode: 'if-else' } });

    const graph = createLogicGraph({
      id: 'g-full',
      name: 'Full V2 Flow',
      scope: 'page',
      targetId: pageId,
      variables: [itemsVar],
      networkSettings: { baseUrl: 'https://api.example.com', globalHeaders: '{}', authToken: '' },
      nodes: [
        click,
        flowCtrl,
        httpReq,
        jsonTool,
        mathNode,
        textFmt,
        setLayer,
        openModal,
        showToast,
        getItems,
        listProc,
        condCheck,
        branch,
      ],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: click.id, sourcePortId: 'exec', targetNodeId: flowCtrl.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: flowCtrl.id, sourcePortId: 'step1', targetNodeId: setLayer.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: mathNode.id, sourcePortId: 'result', targetNodeId: textFmt.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'c4', sourceNodeId: textFmt.id, sourcePortId: 'text', targetNodeId: setLayer.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'c5', sourceNodeId: flowCtrl.id, sourcePortId: 'step2', targetNodeId: httpReq.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c6', sourceNodeId: httpReq.id, sourcePortId: 'data', targetNodeId: jsonTool.id, targetPortId: 'input' }),
        createLogicConnection({ id: 'c7', sourceNodeId: httpReq.id, sourcePortId: 'success', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c8', sourceNodeId: getItems.id, sourcePortId: 'value', targetNodeId: listProc.id, targetPortId: 'list' }),
        createLogicConnection({ id: 'c9', sourceNodeId: listProc.id, sourcePortId: 'count', targetNodeId: condCheck.id, targetPortId: 'left' }),
        createLogicConnection({ id: 'c10', sourceNodeId: condCheck.id, sourcePortId: 'result', targetNodeId: branch.id, targetPortId: 'condition' }),
        createLogicConnection({ id: 'c11', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: openModal.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c12', sourceNodeId: openModal.id, sourcePortId: 'next', targetNodeId: showToast.id, targetPortId: 'exec' }),
      ],
    });

    const fullProject: FolioProject = { ...project, logicGraphs: [graph] };
    expect(validateLogicGraphSemantics(graph, fullProject).errors).toHaveLength(0);

    const runtime = createPrototypeRuntime(fullProject, { pageId });
    runtime.mount();
    const snap = runtime.dispatchNodeEvent(buttonId, 'click');

    expect(snap.nodeOverrides[labelId]?.text).toContain('100');
    expect(snap.nodeOverrides[modalId]?.visible).toBe(true);
    expect(snap.toasts?.some((t) => t.message === 'Synced!' && t.tone === 'success')).toBe(true);
  });

  it('provides Lightbulb Connection Guides for all 31 primary nodes and valid starter & preset graphs', () => {
    for (const type of PRIMARY_LOGIC_NODE_TYPES) {
      const guide = getLogicNodeGuide(type);
      expect(guide.label).toBe(LOGIC_NODE_CATALOG[type].label);
      expect(guide.roleSummary.length).toBeGreaterThan(10);
      expect(guide.exampleFlow.length).toBeGreaterThan(5);
    }

    const starter = createInteractiveStarterProject();
    expect(validateProject(starter).ok).toBe(true);
    expect(starter.logicGraphs).toHaveLength(1);
    expect(validateLogicGraphSemantics(starter.logicGraphs[0], starter).errors).toHaveLength(0);

    const page = getActivePage(starter);
    for (const presetId of ['click-counter', 'toggle-visibility', 'theme-switcher', 'api-fetch-list'] as const) {
      const preset = createLogicPresetGraph(presetId, starter, page);
      expect(validateLogicGraphSemantics(preset, starter).errors).toHaveLength(0);
    }
  });
});

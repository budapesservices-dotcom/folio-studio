import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { DesignNode, FolioProject, GroupNode } from '../src/core/document/types';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { createFrameInGraph } from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  bakeLogicFrame,
  buildLivePreviewLogicScript,
  compilePageLogicRuntimeConfig,
  createLogicConnection,
  createLogicFramePresetFromFrame,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
  discoverDynamicReactTargets,
  instantiateLogicFramePreset,
  LOGIC_NODE_CATALOG,
  NODE_RUNTIME_PARITY_MATRIX,
  RUNTIME_FEATURE_PARITY_MATRIX,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';
import { createPreviewDomHarness, createReactTsxHarness } from './helpers/parityRuntimeHarness';

interface MockDomElement {
  id: string;
  tagName: string;
  textContent: string;
  value: string;
  disabled: boolean;
  style: Record<string, string>;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  attributes: Record<string, string>;
  addEventListener: (type: string, cb: (ev: unknown) => void) => void;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  contains: (other: unknown) => boolean;
  dispatch: (type: string, ev?: Record<string, unknown>) => void;
}

interface MockToastElement {
  textContent: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  removed: boolean;
  setAttribute: (k: string, v: string) => void;
  remove: () => void;
}

function createParityPreviewHarness(script: string, ids: readonly string[]) {
  const elements = new Map<string, MockDomElement>();
  for (const id of ids) {
    const el: MockDomElement = {
      id,
      tagName: 'DIV',
      textContent: '',
      value: '',
      disabled: false,
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
      contains(other) {
        return other === this;
      },
      dispatch(type, ev = {}) {
        for (const cb of this.listeners[type] ?? []) {
          cb({ target: this, currentTarget: this, ...ev });
        }
      },
    };
    elements.set(id, el);
  }

  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const toasts: MockToastElement[] = [];
  const docElementAttrs: Record<string, string> = {};
  const docClassList = new Set<string>();

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      offsetWidth: 1440,
      classList: {
        add: (cls: string) => docClassList.add(cls),
        remove: (cls: string) => docClassList.delete(cls),
        has: (cls: string) => docClassList.has(cls),
      },
      setAttribute: (k: string, v: string) => {
        docElementAttrs[k] = v;
      },
      removeAttribute: (k: string) => {
        delete docElementAttrs[k];
      },
      getAttribute: (k: string) => docElementAttrs[k] ?? null,
    },
    body: {
      appendChild: (node: MockToastElement) => {
        toasts.push(node);
      },
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
      const toastEl: MockToastElement = {
        textContent: '',
        attributes: {},
        style: {},
        removed: false,
        setAttribute(k, v) {
          this.attributes[k] = v;
        },
        remove() {
          this.removed = true;
        },
      };
      return toastEl;
    },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(cb);
    },
  };

  const mockWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    location: { href: 'http://localhost/?tab=pricing', search: '?tab=pricing', pathname: '/' },
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
    toasts,
    docElementAttrs,
    docClassList,
    click(id: string) {
      elements.get(id)?.dispatch('click');
    },
    dblclick(id: string) {
      elements.get(id)?.dispatch('dblclick');
    },
    keydown(key: string) {
      for (const cb of docListeners.keydown ?? []) {
        cb({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
      }
    },
  };
}

function createParityFixture() {
  const base = createInitialProject('Phase 2 Parity Project');
  const page = getActivePage(base);

  const groupA: GroupNode = {
    id: 'grp-card-a',
    type: 'group',
    name: 'Card Group A',
    x: 40,
    y: 40,
    width: 240,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const rectA: DesignNode = {
    ...createRectNode(2),
    id: 'rect-a',
    name: 'Card Rect A',
    parentId: groupA.id,
    x: 50,
    y: 50,
    width: 140,
    height: 80,
  };
  const dotA: DesignNode = {
    ...createEllipseNode(3),
    id: 'dot-a',
    name: 'Status Dot A',
    parentId: groupA.id,
    x: 200,
    y: 60,
    width: 24,
    height: 24,
  };
  const cardB: DesignNode = {
    ...createRectNode(4),
    id: 'rect-b',
    name: 'Card B',
    x: 320,
    y: 40,
    width: 160,
    height: 80,
  };
  const modalBox: DesignNode = {
    ...createRectNode(5),
    id: 'modal-box',
    name: 'Promo Modal',
    x: 100,
    y: 200,
    width: 300,
    height: 180,
    visible: false,
  };
  const statusText: DesignNode = {
    ...createTextNode(6),
    id: 'txt-status',
    name: 'Status Text',
    x: 40,
    y: 420,
    width: 300,
    height: 32,
    text: 'Ready',
  };
  const triggerBtn: DesignNode = {
    ...createRectNode(7),
    id: 'btn-run',
    name: 'Run Button',
    semanticTag: 'button',
    x: 40,
    y: 480,
    width: 140,
    height: 44,
  };

  const project: FolioProject = {
    ...base,
    pages: base.pages.map((p) =>
      p.id === page.id
        ? {
            ...p,
            document: {
              ...p.document,
              nodes: [groupA, rectA, dotA, cardB, modalBox, statusText, triggerBtn],
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
    dotAId: dotA.id,
    cardBId: cardB.id,
    modalBoxId: modalBox.id,
    statusTextId: statusText.id,
    triggerBtnId: triggerBtn.id,
  };
}

function assertStrictTsxTranspiles(project: FolioProject) {
  const reactFiles = compileReactProjectFiles(project);
  const tsxFiles = reactFiles.filter((f) => f.language === 'tsx');
  expect(tsxFiles.length).toBeGreaterThanOrEqual(2);
  for (const file of tsxFiles) {
    const transpiled = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      },
    });
    expect(transpiled.diagnostics ?? [], `TSX diagnostics in ${file.path}`).toEqual([]);
    expect(transpiled.outputText.length).toBeGreaterThan(20);
  }
  return reactFiles;
}

describe('Phase 2 — Node Logic Parity Unification (Headless ↔ Live Preview ↔ React TSX)', () => {
  it('registers all 31 primary nodes in NODE_RUNTIME_PARITY_MATRIX with full 3-way coverage', () => {
    const primaryCatalog = Object.values(LOGIC_NODE_CATALOG).filter((def) => !def.deprecated);
    const matrixTypes = new Set(NODE_RUNTIME_PARITY_MATRIX.map((e) => e.type));
    expect(NODE_RUNTIME_PARITY_MATRIX.length).toBe(primaryCatalog.length);
    for (const def of primaryCatalog) {
      expect(matrixTypes.has(def.type), `Missing ${def.type} in parity matrix`).toBe(true);
    }
    for (const entry of NODE_RUNTIME_PARITY_MATRIX) {
      expect(['full', 'simulated']).toContain(entry.headless);
      expect(['full', 'simulated']).toContain(entry.livePreview);
      expect(['full', 'simulated']).toContain(entry.reactCodegen);
    }
  });

  it('achieves 3-way parity for Scoped Pipeline Target Inheritance, Group children, opacity/transform/transition/disabled, and private toggle memory', () => {
    const fx = createParityFixture();
    const click = createLogicNode({ id: 'ev-click', type: 'event.on-click', data: { targetNodeId: fx.groupAId, mode: 'click' } });
    const toggle = createLogicNode({ id: 'st-toggle', type: 'state.toggle', data: { variableId: '', initialValue: false } });
    const branch = createLogicNode({ id: 'lg-branch', type: 'logic.branch', data: { mode: 'if-else', pipelineRef: 'step:st-toggle:value' } });
    const setFill = createLogicNode({
      id: 'act-fill',
      type: 'action.set-layer',
      data: { targetMode: 'pipeline', pipelineChildId: fx.rectAId, property: 'fill', fill: '#10B981', transitionMs: 250 },
    });
    const setOpacity = createLogicNode({
      id: 'act-opacity',
      type: 'action.set-layer',
      data: { targetMode: 'pipeline', pipelineChildId: fx.dotAId, property: 'opacity', opacity: 0.35 },
    });
    const setTransform = createLogicNode({
      id: 'act-transform',
      type: 'action.set-layer',
      data: { targetMode: 'pipeline', pipelineChildId: fx.dotAId, property: 'transform', transform: 'scale(1.2)' },
    });
    const setDisabled = createLogicNode({
      id: 'act-disabled',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.triggerBtnId, property: 'disabled', disabled: true },
    });

    const graph = createLogicGraph({
      id: 'graph-pipeline-parity',
      name: 'Pipeline Parity',
      scope: 'page',
      targetId: fx.pageId,
      nodes: [click, toggle, branch, setFill, setOpacity, setTransform, setDisabled],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: click.id, sourcePortId: 'exec', targetNodeId: toggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: toggle.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setFill.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: setFill.id, sourcePortId: 'next', targetNodeId: setOpacity.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c5', sourceNodeId: setOpacity.id, sourcePortId: 'next', targetNodeId: setTransform.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c6', sourceNodeId: setTransform.id, sourcePortId: 'next', targetNodeId: setDisabled.id, targetPortId: 'exec' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Simulator
    const runtime = createPrototypeRuntime(project);
    const snap = runtime.dispatchNodeEvent(fx.groupAId, 'click');
    expect(snap.privateMemory[`${toggle.id}:${fx.groupAId}`]).toBe(true);
    expect(snap.nodeOverrides[fx.rectAId]?.fill).toBe('#10B981');
    expect(snap.nodeOverrides[fx.dotAId]?.opacity).toBe(0.35);
    expect(snap.nodeOverrides[fx.dotAId]?.transform).toBe('scale(1.2)');
    expect(snap.nodeOverrides[fx.triggerBtnId]?.disabled).toBe(true);

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page);
    expect(script).not.toBeNull();
    const harness = createParityPreviewHarness(script!, [fx.groupAId, fx.rectAId, fx.dotAId, fx.triggerBtnId]);
    harness.click(fx.groupAId);
    expect(harness.elements.get(fx.rectAId)?.style.background).toBe('#10B981');
    expect(harness.elements.get(fx.rectAId)?.style.transition).toBe('all 250ms ease');
    expect(harness.elements.get(fx.dotAId)?.style.opacity).toBe('0.35');
    expect(harness.elements.get(fx.dotAId)?.style.transform).toBe('scale(1.2)');
    expect(harness.elements.get(fx.triggerBtnId)?.disabled).toBe(true);
    expect(harness.elements.get(fx.triggerBtnId)?.getAttribute('aria-disabled')).toBe('true');

    // 3. React TSX Codegen (discovers pipeline-inherited children + emits bindings + transpiles cleanly)
    const discovered = discoverDynamicReactTargets(project, page, [graph]);
    expect(discovered.fillTargets.has(fx.rectAId)).toBe(true);
    expect(discovered.transitionTargets.has(fx.rectAId)).toBe(true);
    expect(discovered.opacityTargets.has(fx.dotAId)).toBe(true);
    expect(discovered.transformTargets.has(fx.dotAId)).toBe(true);
    expect(discovered.disabledTargets.has(fx.triggerBtnId)).toBe(true);

    const reactFiles = assertStrictTsxTranspiles(project);
    const pageTsx = reactFiles.find((f) => f.pageId === fx.pageId)!.content;
    expect(pageTsx).toContain('logicPrivateMemoryRef');
    expect(pageTsx).toContain('resolveTargetId');
    expect(pageTsx).toContain(`logicOverrides["${fx.rectAId}"]?.fill`);
    expect(pageTsx).toContain(`logicOverrides["${fx.rectAId}"]?.transitionMs`);
    expect(pageTsx).toContain(`logicOverrides["${fx.dotAId}"]?.opacity`);
    expect(pageTsx).toContain(`logicOverrides["${fx.dotAId}"]?.transform`);
    expect(pageTsx).toContain(`disabled={Boolean(logicOverrides["${fx.triggerBtnId}"]?.disabled)}`);
  });

  it('achieves 3-way parity for Baked Logic Frames (compiledPlan + isolated per-frame private memory) across Headless, Live Preview, and React TSX', () => {
    const fx = createParityFixture();
    const evA = createLogicNode({ id: 'ev-a', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: fx.rectAId } });
    const evB = createLogicNode({ id: 'ev-b', type: 'event.on-click', x: 0, y: 260, data: { targetNodeId: fx.cardBId } });
    const tog = createLogicNode({ id: 'tog-frame', type: 'state.toggle', x: 240, y: 0, data: { variableId: '', initialValue: false } });
    const br = createLogicNode({ id: 'br-frame', type: 'logic.branch', x: 460, y: 0, data: { mode: 'if-else', pipelineRef: 'step:tog-frame:value' } });
    const setOn = createLogicNode({ id: 'on-frame', type: 'action.set-layer', x: 700, y: -40, data: { targetMode: 'pipeline', property: 'fill', fill: '#22C55E' } });
    const setOff = createLogicNode({ id: 'off-frame', type: 'action.set-layer', x: 700, y: 60, data: { targetMode: 'pipeline', property: 'fill', fill: '#64748B' } });

    const baseGraph = createLogicGraph({
      id: 'graph-baked-parity',
      name: 'Baked Parity',
      scope: 'page',
      targetId: fx.pageId,
      nodes: [evA, evB, tog, br, setOn, setOff],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: evA.id, sourcePortId: 'exec', targetNodeId: tog.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: tog.id, sourcePortId: 'next', targetNodeId: br.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: br.id, sourcePortId: 'true', targetNodeId: setOn.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: br.id, sourcePortId: 'false', targetNodeId: setOff.id, targetPortId: 'exec' }),
      ],
    });

    const { graph: framed, frame } = createFrameInGraph(baseGraph, {
      title: 'Toggle Color',
      color: 'violet',
      childNodeIds: [tog.id, br.id, setOn.id, setOff.id],
    });
    const bakedRes = bakeLogicFrame(framed, frame.id, fx.project);
    expect(bakedRes.ok).toBe(true);
    const bakedFrame = bakedRes.graph.frames!.find((f) => f.id === frame.id)!;
    const preset = createLogicFramePresetFromFrame(bakedRes.graph, bakedFrame);
    expect(preset).not.toBeNull();
    const instRes = instantiateLogicFramePreset(bakedRes.graph, preset!, { x: 240, y: 260 });
    const frame2 = instRes.frame;
    const entry2 = frame2.bakedData!.exposedInputs[0];
    const finalGraph = {
      ...instRes.graph,
      connections: [
        ...instRes.graph.connections,
        createLogicConnection({
          id: 'c-ev-b-to-frame2',
          sourceNodeId: evB.id,
          sourcePortId: 'exec',
          targetNodeId: entry2.targetNodeId,
          targetPortId: entry2.targetPort,
        }),
      ],
    };

    const project: FolioProject = { ...fx.project, logicGraphs: [finalGraph] };
    const page = getActivePage(project);

    // 1. Headless Simulator
    const rt = createPrototypeRuntime(project);
    const s1 = rt.dispatchNodeEvent(fx.rectAId, 'click');
    expect(s1.nodeOverrides[fx.rectAId]?.fill).toBe('#22C55E');
    expect(s1.nodeOverrides[fx.cardBId]).toBeUndefined();
    const s2 = rt.dispatchNodeEvent(fx.cardBId, 'click');
    expect(s2.nodeOverrides[fx.cardBId]?.fill).toBe('#22C55E');

    // 2. Live Preview
    const script = buildLivePreviewLogicScript(project, page)!;
    const harness = createParityPreviewHarness(script, [fx.rectAId, fx.cardBId]);
    harness.click(fx.rectAId);
    expect(harness.elements.get(fx.rectAId)?.style.background).toBe('#22C55E');
    expect(harness.elements.get(fx.cardBId)?.style.background).toBeUndefined();
    harness.click(fx.cardBId);
    expect(harness.elements.get(fx.cardBId)?.style.background).toBe('#22C55E');

    // 3. React TSX includes bakedFrames + compiledPlan + dynamic fill targets for both cards
    const reactFiles = assertStrictTsxTranspiles(project);
    const pageTsx = reactFiles.find((f) => f.pageId === fx.pageId)!.content;
    expect(pageTsx).toContain('bakedFrames');
    expect(pageTsx).toContain('compiledPlan');
    expect(pageTsx).toContain(`logicOverrides["${fx.rectAId}"]?.fill`);
    expect(pageTsx).toContain(`logicOverrides["${fx.cardBId}"]?.fill`);
  });

  it('achieves 3-way parity for modern v2 nodes (state.update ops, math map-range, text currency, list filter/count, condition regex, json get-field, overlay-toast, once, double-click, key-press)', () => {
    const fx = createParityFixture();
    const listVar = createLogicVariable({ id: 'var-items', name: 'items', valueType: 'list', initialValue: ['Apple', 'Banana'] });
    const objVar = createLogicVariable({ id: 'var-user', name: 'user', valueType: 'object', initialValue: { profile: { plan: 'free' } } });
    const modeVar = createLogicVariable({ id: 'var-mode', name: 'mode', valueType: 'string', initialValue: 'draft' });

    const onDblClick = createLogicNode({ id: 'ev-dbl', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId, mode: 'double-click', once: true } });
    const onKey = createLogicNode({ id: 'ev-key', type: 'event.on-key-press', data: { keyCombo: 'Enter', direction: 'down' } });
    const pushItem = createLogicNode({ id: 'st-push', type: 'state.update', data: { variableId: listVar.id, operation: 'push', value: 'Apricot' } });
    const setObjProp = createLogicNode({ id: 'st-obj', type: 'state.update', data: { variableId: objVar.id, operation: 'set-property', propertyPath: 'profile.plan', value: 'pro' } });
    const cycleMode = createLogicNode({ id: 'st-cycle', type: 'state.update', data: { variableId: modeVar.id, operation: 'cycle', cycleValues: 'draft,review,live' } });
    const getList = createLogicNode({ id: 'st-get-list', type: 'state.get', data: { variableId: listVar.id } });
    const filterList = createLogicNode({ id: 'lg-list', type: 'logic.list', data: { operation: 'filter', matchValue: 'ap' } });
    const mapRange = createLogicNode({ id: 'lg-math', type: 'logic.math', data: { operation: 'map-range', inMin: 0, inMax: 10, outMin: 0, outMax: 100 } });
    const formatCurr = createLogicNode({ id: 'lg-curr', type: 'logic.text', data: { mode: 'format-currency', locale: 'en-US', currency: 'USD', decimals: 0 } });
    const getObj = createLogicNode({ id: 'st-get-obj', type: 'state.get', data: { variableId: objVar.id } });
    const jsonGet = createLogicNode({ id: 'net-json', type: 'network.json', data: { mode: 'get-field', path: 'profile.plan' } });
    const condRegex = createLogicNode({ id: 'lg-cond', type: 'logic.condition', data: { mode: 'regex', pattern: '^pro$' } });
    const branch = createLogicNode({ id: 'lg-br', type: 'logic.branch', data: { mode: 'if-else' } });
    const setStatus = createLogicNode({ id: 'act-status', type: 'action.set-layer', data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' } });
    const openModal = createLogicNode({ id: 'act-modal', type: 'action.overlay-toast', data: { mode: 'open-modal', targetNodeId: fx.modalBoxId } });
    const showToast = createLogicNode({ id: 'act-toast', type: 'action.overlay-toast', data: { mode: 'show-toast', tone: 'success', message: 'Upgraded to Pro!' } });
    const keyToast = createLogicNode({ id: 'act-key-toast', type: 'action.overlay-toast', data: { mode: 'show-toast', tone: 'info', message: 'Enter pressed' } });

    const graph = createLogicGraph({
      id: 'graph-v2-parity',
      name: 'Full v2 Node Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [listVar, objVar, modeVar],
      nodes: [
        onDblClick, onKey, pushItem, setObjProp, cycleMode,
        getList, filterList, mapRange, formatCurr,
        getObj, jsonGet, condRegex, branch,
        setStatus, openModal, showToast, keyToast,
      ],
      connections: [
        createLogicConnection({ id: 'e1', sourceNodeId: onDblClick.id, sourcePortId: 'exec', targetNodeId: pushItem.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e2', sourceNodeId: pushItem.id, sourcePortId: 'next', targetNodeId: setObjProp.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e3', sourceNodeId: setObjProp.id, sourcePortId: 'next', targetNodeId: cycleMode.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e4', sourceNodeId: cycleMode.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e5', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setStatus.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e6', sourceNodeId: setStatus.id, sourcePortId: 'next', targetNodeId: openModal.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'e7', sourceNodeId: openModal.id, sourcePortId: 'next', targetNodeId: showToast.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'ek', sourceNodeId: onKey.id, sourcePortId: 'exec', targetNodeId: keyToast.id, targetPortId: 'exec' }),
        // Data wires: items -> filter('ap') -> count (2) -> map-range(0..10 -> 0..100 => 20) -> format-currency ($20) -> setStatus
        createLogicConnection({ id: 'd1', sourceNodeId: getList.id, sourcePortId: 'value', targetNodeId: filterList.id, targetPortId: 'list' }),
        createLogicConnection({ id: 'd2', sourceNodeId: filterList.id, sourcePortId: 'count', targetNodeId: mapRange.id, targetPortId: 'a' }),
        createLogicConnection({ id: 'd3', sourceNodeId: mapRange.id, sourcePortId: 'result', targetNodeId: formatCurr.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'd4', sourceNodeId: formatCurr.id, sourcePortId: 'text', targetNodeId: setStatus.id, targetPortId: 'value' }),
        // Data wires: user -> json.get-field('profile.plan') -> regex('^pro$') -> branch.condition
        createLogicConnection({ id: 'd5', sourceNodeId: getObj.id, sourcePortId: 'value', targetNodeId: jsonGet.id, targetPortId: 'input' }),
        createLogicConnection({ id: 'd6', sourceNodeId: jsonGet.id, sourcePortId: 'output', targetNodeId: condRegex.id, targetPortId: 'left' }),
        createLogicConnection({ id: 'd7', sourceNodeId: condRegex.id, sourcePortId: 'result', targetNodeId: branch.id, targetPortId: 'condition' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Simulator
    const rt = createPrototypeRuntime(project);
    const snap1 = rt.dispatchNodeEvent(fx.triggerBtnId, 'double-click');
    expect(snap1.variables[listVar.id]).toEqual(['Apple', 'Banana', 'Apricot']);
    expect(snap1.variables[objVar.id]).toEqual({ profile: { plan: 'pro' } });
    expect(snap1.variables[modeVar.id]).toBe('review');
    expect(snap1.nodeOverrides[fx.statusTextId]?.text).toBe('$20');
    expect(snap1.nodeOverrides[fx.modalBoxId]?.visible).toBe(true);
    expect(snap1.toasts).toEqual([{ message: 'Upgraded to Pro!', tone: 'success' }]);

    // Once flag prevents second firing
    const snap2 = rt.dispatchNodeEvent(fx.triggerBtnId, 'double-click');
    expect(snap2.variables[listVar.id]).toEqual(['Apple', 'Banana', 'Apricot']);
    expect(snap2.toasts).toHaveLength(1);

    // 2. Live Preview Micro-Runtime produces identical results!
    const script = buildLivePreviewLogicScript(project, page)!;
    const harness = createParityPreviewHarness(script, [fx.triggerBtnId, fx.statusTextId, fx.modalBoxId]);
    harness.dblclick(fx.triggerBtnId);
    expect(harness.elements.get(fx.statusTextId)?.textContent).toBe('$20');
    expect(harness.elements.get(fx.modalBoxId)?.style.display).toBe('block');
    expect(harness.toasts).toHaveLength(1);
    expect(harness.toasts[0].textContent).toBe('Upgraded to Pro!');
    expect(harness.toasts[0].attributes['data-folio-toast']).toBe('success');

    // Second dblclick is ignored due to once: true
    harness.dblclick(fx.triggerBtnId);
    expect(harness.toasts).toHaveLength(1);

    // Keyboard shortcut fires Enter toast
    harness.keydown('Enter');
    expect(harness.toasts).toHaveLength(2);
    expect(harness.toasts[1].textContent).toBe('Enter pressed');

    // 3. React TSX Codegen compiles cleanly with all v2 features & toast stack
    const reactFiles = assertStrictTsxTranspiles(project);
    const pageTsx = reactFiles.find((f) => f.pageId === fx.pageId)!.content;
    expect(pageTsx).toContain('onDoubleClick={() => runLogicTrigger("double-click", "btn-run")}');
    expect(pageTsx).toContain('window.addEventListener("keydown"');
    expect(pageTsx).toContain('logicToasts');
    expect(pageTsx).toContain('data-folio-toast');
    expect(pageTsx).toContain(`logicOverrides["${fx.modalBoxId}"]?.visible === false`);
    expect(pageTsx).not.toContain('dangerouslySetInnerHTML');
  });

  it('enforces zero credential leakage, zero innerHTML/eval, safe href guards, and prototype-pollution protection across all 3 runtimes', () => {
    const fx = createParityFixture();
    const objVar = createLogicVariable({ id: 'var-sec', name: 'sec', valueType: 'object', initialValue: { ok: true } });

    const onClick = createLogicNode({ id: 'ev-sec', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } });
    // Legacy node with raw authToken field injected to verify defense-in-depth stripping
    const httpNode = createLogicNode({
      id: 'net-http',
      type: 'network.http',
      data: { method: 'GET', url: '/api/secret', authSecretRef: 'API_TOKEN', authToken: 'sk-live-SUPER-SECRET-999' },
    });
    const badProp = createLogicNode({
      id: 'st-proto',
      type: 'state.update',
      data: { variableId: objVar.id, operation: 'set-property', propertyPath: '__proto__.polluted', value: 'hacked' },
    });
    const badNav = createLogicNode({
      id: 'act-bad-nav',
      type: 'action.navigate',
      data: { mode: 'external', route: 'javascript:alert(1)' },
    });
    const xssToast = createLogicNode({
      id: 'act-xss-toast',
      type: 'action.overlay-toast',
      data: { mode: 'show-toast', tone: 'warning', message: '</script><img src=x onerror=alert(1)>' },
    });

    const graph = createLogicGraph({
      id: 'graph-sec',
      name: 'Security Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [objVar],
      nodes: [onClick, httpNode, badProp, badNav, xssToast],
      connections: [
        createLogicConnection({ id: 's1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: httpNode.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 's2', sourceNodeId: httpNode.id, sourcePortId: 'success', targetNodeId: badProp.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 's3', sourceNodeId: badProp.id, sourcePortId: 'next', targetNodeId: xssToast.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 's4', sourceNodeId: xssToast.id, sourcePortId: 'next', targetNodeId: badNav.id, targetPortId: 'exec' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Canonical config strips authToken
    const compiledConfig = compilePageLogicRuntimeConfig(project, page, [graph]);
    expect(JSON.stringify(compiledConfig)).not.toContain('sk-live-SUPER-SECRET-999');
    expect(JSON.stringify(compiledConfig)).not.toContain('authToken');

    // 2. Live Preview HTML & Script are completely safe
    const html = buildLivePreviewHtml(project);
    expect(html).not.toContain('sk-live-SUPER-SECRET-999');
    expect(html).not.toContain('authToken');
    expect(html).not.toContain('.innerHTML');
    expect(html).not.toContain('eval(');
    expect(html).not.toContain('new Function');
    expect(html).not.toContain('</script><img');

    const script = buildLivePreviewLogicScript(project, page)!;
    const harness = createParityPreviewHarness(script, [fx.triggerBtnId]);
    harness.click(fx.triggerBtnId);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(harness.docElementAttrs['data-folio-route']).toBeUndefined();
    expect(harness.toasts[0]?.textContent).toBe('</script><img src=x onerror=alert(1)>');

    // 3. Headless Simulator blocks javascript: href and prevents prototype pollution
    const rt = createPrototypeRuntime(project);
    const snap = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(snap.activeRoute).toBe('/');
    expect(snap.warnings.some((w) => w.includes('unsafe URL'))).toBe(true);

    // 4. React TSX omits authToken & transpiles cleanly
    const reactFiles = assertStrictTsxTranspiles(project);
    const pageTsx = reactFiles.find((f) => f.pageId === fx.pageId)!.content;
    expect(pageTsx).not.toContain('sk-live-SUPER-SECRET-999');
    expect(pageTsx).not.toContain('authToken');
    expect(pageTsx).not.toContain('dangerouslySetInnerHTML');
  });

  it('proves 3-runtime behavioral execution parity for Sources, Lifecycle, Hover, and State-Change events (Headless ↔ Live Preview ↔ Executed React TSX)', () => {
    const fx = createParityFixture();
    const hoveredVar = createLogicVariable({
      id: 'var-hovered',
      name: 'hovered',
      valueType: 'boolean',
      initialValue: false,
    });
    const widthVar = createLogicVariable({
      id: 'var-width',
      name: 'vw',
      valueType: 'number',
      initialValue: 0,
    });

    const onLifecycle = createLogicNode({
      id: 'ev-load',
      type: 'event.on-lifecycle',
      data: { trigger: 'page-load' },
    });
    const ctxViewport = createLogicNode({
      id: 'src-vp',
      type: 'source.context',
      data: { contextKind: 'viewport', viewportMetric: 'width' },
    });
    const readStatus = createLogicNode({
      id: 'src-el',
      type: 'source.element',
      data: { targetNodeId: fx.statusTextId, property: 'text' },
    });
    const setWidth = createLogicNode({
      id: 'st-set-vp',
      type: 'state.update',
      data: { variableId: widthVar.id, operation: 'set' },
    });
    const formatMount = createLogicNode({
      id: 'lg-mount-txt',
      type: 'logic.text',
      data: { mode: 'template', template: 'VP={{vw}}' },
    });
    const writeMount = createLogicNode({
      id: 'act-mount-txt',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });

    const onHoverEnter = createLogicNode({
      id: 'ev-hover-in',
      type: 'event.on-hover',
      data: { targetNodeId: fx.rectAId, phase: 'enter' },
    });
    const onHoverLeave = createLogicNode({
      id: 'ev-hover-out',
      type: 'event.on-hover',
      data: { targetNodeId: fx.rectAId, phase: 'leave' },
    });
    const setHoverTrue = createLogicNode({
      id: 'st-hover-on',
      type: 'state.update',
      data: { variableId: hoveredVar.id, operation: 'set', value: true },
    });
    const setHoverFalse = createLogicNode({
      id: 'st-hover-off',
      type: 'state.update',
      data: { variableId: hoveredVar.id, operation: 'set', value: false },
    });
    const onStateChange = createLogicNode({
      id: 'ev-state-chg',
      type: 'event.on-state-change',
      data: { variableId: hoveredVar.id },
    });
    const branchHover = createLogicNode({
      id: 'lg-br-hover',
      type: 'logic.branch',
      data: { mode: 'if-else' },
    });
    const getHover = createLogicNode({
      id: 'st-get-hover',
      type: 'state.get',
      data: { variableId: hoveredVar.id },
    });
    const fillCardOn = createLogicNode({
      id: 'act-card-on',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.cardBId, property: 'fill', fill: '#8B5CF6' },
    });
    const fillCardOff = createLogicNode({
      id: 'act-card-off',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.cardBId, property: 'fill', fill: '#334155' },
    });

    const graph = createLogicGraph({
      id: 'graph-sources-events-parity',
      name: 'Sources & Events Behavioral Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [hoveredVar, widthVar],
      nodes: [
        onLifecycle,
        ctxViewport,
        readStatus,
        setWidth,
        formatMount,
        writeMount,
        onHoverEnter,
        onHoverLeave,
        setHoverTrue,
        setHoverFalse,
        onStateChange,
        getHover,
        branchHover,
        fillCardOn,
        fillCardOff,
      ],
      connections: [
        createLogicConnection({ id: 'se1', sourceNodeId: onLifecycle.id, sourcePortId: 'exec', targetNodeId: setWidth.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'se2', sourceNodeId: setWidth.id, sourcePortId: 'next', targetNodeId: writeMount.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'sd1', sourceNodeId: ctxViewport.id, sourcePortId: 'value', targetNodeId: setWidth.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'sd2', sourceNodeId: formatMount.id, sourcePortId: 'text', targetNodeId: writeMount.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'se3', sourceNodeId: onHoverEnter.id, sourcePortId: 'exec', targetNodeId: setHoverTrue.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'se4', sourceNodeId: onHoverLeave.id, sourcePortId: 'exec', targetNodeId: setHoverFalse.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'se5', sourceNodeId: onStateChange.id, sourcePortId: 'exec', targetNodeId: branchHover.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'sd3', sourceNodeId: getHover.id, sourcePortId: 'value', targetNodeId: branchHover.id, targetPortId: 'condition' }),
        createLogicConnection({ id: 'se6', sourceNodeId: branchHover.id, sourcePortId: 'true', targetNodeId: fillCardOn.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'se7', sourceNodeId: branchHover.id, sourcePortId: 'false', targetNodeId: fillCardOff.id, targetPortId: 'exec' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project);
    const mountSnap = rt.mount();
    expect(mountSnap.variables[widthVar.id]).toBe(1440);
    expect(mountSnap.nodeOverrides[fx.statusTextId]?.text).toBe('VP=1440');

    const enterSnap = rt.dispatchNodeEvent(fx.rectAId, 'hover-enter');
    expect(enterSnap.variables[hoveredVar.id]).toBe(true);
    expect(enterSnap.nodeOverrides[fx.cardBId]?.fill).toBe('#8B5CF6');

    const leaveSnap = rt.dispatchNodeEvent(fx.rectAId, 'hover-leave');
    expect(leaveSnap.variables[hoveredVar.id]).toBe(false);
    expect(leaveSnap.nodeOverrides[fx.cardBId]?.fill).toBe('#334155');

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page)!;
    const preview = createPreviewDomHarness(script, [fx.statusTextId, fx.rectAId, fx.cardBId], {
      initialTextById: { [fx.statusTextId]: 'Ready' },
    });
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('VP=1440');
    preview.hoverEnter(fx.rectAId);
    expect(preview.elements.get(fx.cardBId)?.style.background).toBe('#8B5CF6');
    preview.hoverLeave(fx.rectAId);
    expect(preview.elements.get(fx.cardBId)?.style.background).toBe('#334155');

    // 3. Real Executed React TSX
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    expect(reactHarness.getText(fx.statusTextId)).toBe('VP=1440');
    reactHarness.hoverEnter(fx.rectAId);
    expect(reactHarness.getStyle(fx.cardBId).background).toBe('#8B5CF6');
    reactHarness.hoverLeave(fx.rectAId);
    expect(reactHarness.getStyle(fx.cardBId).background).toBe('#334155');
  });

  it('proves 3-runtime behavioral execution parity for Actions (navigate, media-animation), Flow (control), and Network (http/json/socket)', () => {
    const fx = createParityFixture();
    const pricingPage = {
      id: 'page-pricing',
      name: 'Pricing',
      route: '/pricing',
      document: {
        id: 'doc-pricing',
        name: 'Pricing',
        width: 1440,
        height: 900,
        background: '#0F172A',
        nodes: [],
      },
    };
    const projectWithPages: FolioProject = {
      ...fx.project,
      pages: [...fx.project.pages, pricingPage],
      animations: [
        {
          id: 'anim-pulse',
          name: 'Pulse',
          pageId: fx.pageId,
          durationMs: 400,
          loop: false,
          autoplay: false,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
          tracks: [
            {
              id: 'tr-1',
              targetNodeId: fx.rectAId,
              property: 'opacity',
              keyframes: [
                { id: 'kf-0', timeMs: 0, value: 1, easing: 'ease-out' },
                { id: 'kf-1', timeMs: 400, value: 0.4, easing: 'ease-out' },
              ],
            },
          ],
        },
      ],
    };

    const onClick = createLogicNode({ id: 'ev-run', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } });
    const seq = createLogicNode({ id: 'fl-seq', type: 'flow.control', data: { mode: 'sequence' } });
    const playAnim = createLogicNode({
      id: 'act-anim',
      type: 'action.media-animation',
      data: { command: 'play', clipId: 'anim-pulse', targetMode: 'override', targetNodeId: fx.rectAId },
    });
    const navPricing = createLogicNode({
      id: 'act-nav',
      type: 'action.navigate',
      data: { mode: 'internal', route: '/pricing' },
    });
    const jsonParse = createLogicNode({
      id: 'net-json-parse',
      type: 'network.json',
      data: { mode: 'get-field', path: 'plan.tier' },
    });
    const planVar = createLogicVariable({
      id: 'var-payload',
      name: 'payload',
      valueType: 'object',
      initialValue: { plan: { tier: 'enterprise' } },
    });
    const getPayload = createLogicNode({ id: 'st-get-payload', type: 'state.get', data: { variableId: planVar.id } });
    const setStatusTier = createLogicNode({
      id: 'act-tier',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });
    const socketNode = createLogicNode({
      id: 'net-sock',
      type: 'network.socket',
      data: { url: 'wss://example.com/ws', eventName: 'ping' },
    });

    const graph = createLogicGraph({
      id: 'graph-actions-flow-net',
      name: 'Actions, Flow & Network Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [planVar],
      nodes: [onClick, seq, playAnim, navPricing, getPayload, jsonParse, setStatusTier, socketNode],
      connections: [
        createLogicConnection({ id: 'af1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: seq.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'af2', sourceNodeId: seq.id, sourcePortId: 'step1', targetNodeId: setStatusTier.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'af3', sourceNodeId: setStatusTier.id, sourcePortId: 'next', targetNodeId: playAnim.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'af4', sourceNodeId: seq.id, sourcePortId: 'step2', targetNodeId: socketNode.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'af5', sourceNodeId: socketNode.id, sourcePortId: 'onMessage', targetNodeId: navPricing.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'afd1', sourceNodeId: getPayload.id, sourcePortId: 'value', targetNodeId: jsonParse.id, targetPortId: 'input' }),
        createLogicConnection({ id: 'afd2', sourceNodeId: jsonParse.id, sourcePortId: 'output', targetNodeId: setStatusTier.id, targetPortId: 'value' }),
      ],
    });

    const project: FolioProject = { ...projectWithPages, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project);
    const snap = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(snap.nodeOverrides[fx.statusTextId]?.text).toBe('enterprise');
    expect(snap.playedAnimations).toContain('anim-pulse');
    expect(snap.activeRoute).toBe('/pricing');

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page)!;
    const preview = createPreviewDomHarness(script, [fx.triggerBtnId, fx.statusTextId, fx.rectAId]);
    preview.click(fx.triggerBtnId);
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('enterprise');
    expect(preview.docElementAttrs['data-folio-route']).toBe('/pricing');

    // 3. Real Executed React TSX
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    reactHarness.click(fx.triggerBtnId);
    expect(reactHarness.getText(fx.statusTextId)).toBe('enterprise');
    expect(reactHarness.navigatedRoutes).toContain('/pricing');
  });

  it('proves 3-runtime behavioral execution parity for Legacy v1 nodes (on-page-load, state.set/increment, logic.compare/template, action.set-visible/text/fill/theme)', () => {
    const fx = createParityFixture();
    const countVar = createLogicVariable({ id: 'v-leg-count', name: 'legacyCount', valueType: 'number', initialValue: 0 });

    const onLoad = createLogicNode({ id: 'leg-load', type: 'event.on-page-load', data: {} });
    const setInit = createLogicNode({ id: 'leg-set', type: 'state.set', data: { variableId: countVar.id, value: 4 } });
    const onClick = createLogicNode({ id: 'leg-click', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } });
    const inc = createLogicNode({ id: 'leg-inc', type: 'state.increment', data: { variableId: countVar.id, step: 1 } });
    const getCount = createLogicNode({ id: 'leg-get', type: 'state.get', data: { variableId: countVar.id } });
    const cmp = createLogicNode({ id: 'leg-cmp', type: 'logic.compare', data: { operator: '==', right: 5 } });
    const tpl = createLogicNode({ id: 'leg-tpl', type: 'logic.template', data: { template: 'Legacy={{legacyCount}}' } });
    const setVis = createLogicNode({ id: 'leg-vis', type: 'action.set-visible', data: { targetNodeId: fx.modalBoxId, mode: 'show' } });
    const setText = createLogicNode({ id: 'leg-txt', type: 'action.set-text', data: { targetNodeId: fx.statusTextId } });
    const setFill = createLogicNode({ id: 'leg-fill', type: 'action.set-fill', data: { targetNodeId: fx.cardBId, fill: '#EC4899' } });
    const branch = createLogicNode({ id: 'leg-br', type: 'logic.branch', data: { mode: 'if-else' } });

    const graph = createLogicGraph({
      id: 'graph-legacy-v1-parity',
      name: 'Legacy v1 Behavioral Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [countVar],
      nodes: [onLoad, setInit, onClick, inc, getCount, cmp, tpl, branch, setVis, setText, setFill],
      connections: [
        createLogicConnection({ id: 'l1', sourceNodeId: onLoad.id, sourcePortId: 'exec', targetNodeId: setInit.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'l2', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: inc.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'l3', sourceNodeId: inc.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'l4', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setVis.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'l5', sourceNodeId: setVis.id, sourcePortId: 'next', targetNodeId: setText.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'l6', sourceNodeId: setText.id, sourcePortId: 'next', targetNodeId: setFill.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'ld1', sourceNodeId: getCount.id, sourcePortId: 'value', targetNodeId: cmp.id, targetPortId: 'left' }),
        createLogicConnection({ id: 'ld2', sourceNodeId: cmp.id, sourcePortId: 'result', targetNodeId: branch.id, targetPortId: 'condition' }),
        createLogicConnection({ id: 'ld3', sourceNodeId: tpl.id, sourcePortId: 'text', targetNodeId: setText.id, targetPortId: 'text' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project);
    rt.mount();
    const snap = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(snap.variables[countVar.id]).toBe(5);
    expect(snap.nodeOverrides[fx.modalBoxId]?.visible).toBe(true);
    expect(snap.nodeOverrides[fx.statusTextId]?.text).toBe('Legacy=5');
    expect(snap.nodeOverrides[fx.cardBId]?.fill).toBe('#EC4899');

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page)!;
    const preview = createPreviewDomHarness(script, [fx.triggerBtnId, fx.modalBoxId, fx.statusTextId, fx.cardBId], {
      initialDisplayById: { [fx.modalBoxId]: 'none' },
    });
    preview.click(fx.triggerBtnId);
    expect(preview.elements.get(fx.modalBoxId)?.style.display).toBe('block');
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Legacy=5');
    expect(preview.elements.get(fx.cardBId)?.style.background).toBe('#EC4899');

    // 3. Real Executed React TSX
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    reactHarness.click(fx.triggerBtnId);
    expect(reactHarness.getStyle(fx.modalBoxId).display).toBe('block');
    expect(reactHarness.getText(fx.statusTextId)).toBe('Legacy=5');
    expect(reactHarness.getStyle(fx.cardBId).background).toBe('#EC4899');
  });

  it('executes variable.persist and variable.computed with full zero-eval parity across Headless, Live Preview, and React TSX', () => {
    const byFeature = new Map(RUNTIME_FEATURE_PARITY_MATRIX.map((entry) => [entry.feature, entry]));
    for (const fullFeature of [
      'component.scoped-logic',
      'pipeline.scoped-context',
      'frame.baked',
      'legacy.v1-migration',
      'variable.persist',
      'variable.computed',
    ] as const) {
      const entry = byFeature.get(fullFeature);
      expect(entry, `Missing feature ${fullFeature}`).toBeDefined();
      expect(entry!.headless).toBe('full');
      expect(entry!.livePreview).toBe('full');
      expect(entry!.reactCodegen).toBe('full');
      expect(entry!.notes.length).toBeGreaterThan(10);
    }

    const fx = createParityFixture();
    const clicksVar = createLogicVariable({
      id: 'var-clicks',
      name: 'clicks',
      valueType: 'number',
      initialValue: 3,
      persist: 'local',
    });
    const computedVar = createLogicVariable({
      id: 'var-computed',
      name: 'doubled',
      valueType: 'number',
      initialValue: 0,
      computed: true,
      computedExpression: 'clicks * 2',
    });
    const badComputedVar = createLogicVariable({
      id: 'var-bad-computed',
      name: 'badExpr',
      valueType: 'number',
      initialValue: 0,
      computed: true,
      computedExpression: 'window.alert(1)',
    });
    const graph = createLogicGraph({
      id: 'graph-audit-vars',
      name: 'Persist & Computed Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [clicksVar, computedVar],
      nodes: [
        createLogicNode({ id: 'ev-audit', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } }),
        createLogicNode({
          id: 'st-inc',
          type: 'state.update',
          data: { variableId: clicksVar.id, operation: 'increment', step: 2 },
        }),
        createLogicNode({
          id: 'tpl-out',
          type: 'logic.text',
          data: { mode: 'template', template: 'Doubled={{doubled}}' },
        }),
        createLogicNode({
          id: 'act-audit',
          type: 'action.set-layer',
          data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
        }),
      ],
      connections: [
        createLogicConnection({ id: 'ca1', sourceNodeId: 'ev-audit', sourcePortId: 'exec', targetNodeId: 'st-inc', targetPortId: 'exec' }),
        createLogicConnection({ id: 'ca2', sourceNodeId: 'st-inc', sourcePortId: 'next', targetNodeId: 'act-audit', targetPortId: 'exec' }),
        createLogicConnection({ id: 'ca3', sourceNodeId: 'tpl-out', sourcePortId: 'text', targetNodeId: 'act-audit', targetPortId: 'value' }),
      ],
    });
    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };

    // Valid computed expression produces zero warnings; unsafe expression warns cleanly
    const report = validateLogicGraphSemantics(graph, project);
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === 'INVALID_COMPUTED_EXPRESSION')).toBe(false);

    const badGraph = { ...graph, variables: [...graph.variables!, badComputedVar] };
    const badReport = validateLogicGraphSemantics(badGraph, { ...project, logicGraphs: [badGraph] });
    expect(badReport.warnings.some((w) => w.code === 'INVALID_COMPUTED_EXPRESSION')).toBe(true);

    // 1. Headless Runtime with backing storage persists & hydrates + recomputes
    const storeMap = new Map<string, string>();
    const storageAdapter = {
      local: {
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => { storeMap.set(k, v); },
      },
    };
    const rt = createPrototypeRuntime(project, { storage: storageAdapter });
    expect(rt.getSnapshot().variables[computedVar.id]).toBe(6);
    const snap = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(snap.variables[clicksVar.id]).toBe(5);
    expect(snap.variables[computedVar.id]).toBe(10);
    expect(snap.nodeOverrides[fx.statusTextId]?.text).toBe('Doubled=10');

    // Re-mounting a fresh runtime hydrates persisted clicks=5 -> doubled=10 immediately
    const rtReloaded = createPrototypeRuntime(project, { storage: storageAdapter });
    expect(rtReloaded.getSnapshot().variables[clicksVar.id]).toBe(5);
    expect(rtReloaded.getSnapshot().variables[computedVar.id]).toBe(10);

    // 2. Live Preview Micro-Runtime (zero-eval, safe storage fallback)
    const page = getActivePage(project);
    const script = buildLivePreviewLogicScript(project, page)!;
    expect(script).not.toContain('eval(');
    const preview = createPreviewDomHarness(script, [fx.triggerBtnId, fx.statusTextId]);
    preview.click(fx.triggerBtnId);
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Doubled=10');

    // 3. Exported React TSX (zero-eval, reactive computed + storage)
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    expect(reactHarness.pageFile.content).not.toContain('eval(');
    reactHarness.click(fx.triggerBtnId);
    expect(reactHarness.getText(fx.statusTextId)).toBe('Doubled=10');
  });

  it('honestly reports flow.delay and flow.loop-timer as simulated in React TSX parity matrix and executes for-each + delay consistently across all 3 runtimes', () => {
    const byType = new Map(NODE_RUNTIME_PARITY_MATRIX.map((entry) => [entry.type, entry]));
    expect(byType.get('flow.delay')?.headless).toBe('simulated');
    expect(byType.get('flow.delay')?.livePreview).toBe('full');
    expect(byType.get('flow.delay')?.reactCodegen).toBe('simulated');
    expect(byType.get('flow.loop-timer')?.headless).toBe('simulated');
    expect(byType.get('flow.loop-timer')?.livePreview).toBe('full');
    expect(byType.get('flow.loop-timer')?.reactCodegen).toBe('simulated');

    const fx = createParityFixture();
    const listVar = createLogicVariable({ id: 'v-list', name: 'tags', valueType: 'list', initialValue: ['A', 'B', 'C'] });
    const countVar = createLogicVariable({ id: 'v-loop-count', name: 'loopCount', valueType: 'number', initialValue: 0 });

    const onClick = createLogicNode({ id: 'ev-loop', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } });
    const delayZero = createLogicNode({ id: 'fl-delay', type: 'flow.delay', data: { duration: 0, unit: 'ms' } });
    const getList = createLogicNode({ id: 'st-get-tags', type: 'state.get', data: { variableId: listVar.id } });
    const forEach = createLogicNode({ id: 'fl-each', type: 'flow.loop-timer', data: { mode: 'for-each' } });
    const incCount = createLogicNode({ id: 'st-inc-loop', type: 'state.update', data: { variableId: countVar.id, operation: 'increment', step: 1 } });
    const fmt = createLogicNode({ id: 'lg-fmt-loop', type: 'logic.text', data: { mode: 'template', template: 'Loop={{loopCount}}' } });
    const setStatus = createLogicNode({
      id: 'act-loop-status',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });

    const graph = createLogicGraph({
      id: 'graph-flow-delay-loop',
      name: 'Flow Delay & Loop Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [listVar, countVar],
      nodes: [onClick, delayZero, getList, forEach, incCount, fmt, setStatus],
      connections: [
        createLogicConnection({ id: 'fl1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: delayZero.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'fl2', sourceNodeId: delayZero.id, sourcePortId: 'next', targetNodeId: forEach.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'fl3', sourceNodeId: forEach.id, sourcePortId: 'tick', targetNodeId: incCount.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'fl4', sourceNodeId: forEach.id, sourcePortId: 'done', targetNodeId: setStatus.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'fld1', sourceNodeId: getList.id, sourcePortId: 'value', targetNodeId: forEach.id, targetPortId: 'list' }),
        createLogicConnection({ id: 'fld2', sourceNodeId: fmt.id, sourcePortId: 'text', targetNodeId: setStatus.id, targetPortId: 'value' }),
      ],
    });

    const project: FolioProject = { ...fx.project, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project);
    const snap = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(snap.variables[countVar.id]).toBe(3);
    expect(snap.nodeOverrides[fx.statusTextId]?.text).toBe('Loop=3');

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page)!;
    const preview = createPreviewDomHarness(script, [fx.triggerBtnId, fx.statusTextId]);
    preview.click(fx.triggerBtnId);
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Loop=3');

    // 3. Executed React TSX
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    reactHarness.click(fx.triggerBtnId);
    expect(reactHarness.getText(fx.statusTextId)).toBe('Loop=3');
  });

  it('proves 3-runtime behavioral execution parity for Input, Drag, Click-Outside, Key-Press modifiers (no stale closure), Context/External sources, wired increment step, and safe image action', () => {
    const fx = createParityFixture();
    const inputNode: DesignNode = {
      ...createRectNode(8),
      id: 'inp-search',
      name: 'Search Field',
      semanticTag: 'input',
      x: 40,
      y: 540,
      width: 200,
      height: 36,
    };
    const projectBase: FolioProject = {
      ...fx.project,
      pages: fx.project.pages.map((p) =>
        p.id === fx.pageId
          ? { ...p, document: { ...p.document, nodes: [...p.document.nodes, inputNode] } }
          : p,
      ),
    };

    const scoreVar = createLogicVariable({ id: 'v-score', name: 'score', valueType: 'number', initialValue: 0 });
    const tabVar = createLogicVariable({ id: 'v-tab', name: 'tab', valueType: 'string', initialValue: '' });
    const extCountVar = createLogicVariable({ id: 'v-ext-count', name: 'extCount', valueType: 'number', initialValue: -1 });
    const queryVar = createLogicVariable({ id: 'v-query', name: 'query', valueType: 'string', initialValue: '' });

    // Key combo Ctrl+K increments score by wired math step (2 + 3 = 5) and updates status text —
    // firing TWICE sequentially proves React TSX has zero stale closure in window keydown listener!
    const onKeyCombo = createLogicNode({ id: 'ev-ctrl-k', type: 'event.on-key-press', data: { keyCombo: 'Ctrl+K', direction: 'down' } });
    const mathStep = createLogicNode({ id: 'lg-step', type: 'logic.math', data: { operation: '+', a: 2, b: 3 } });
    const incWired = createLogicNode({ id: 'st-inc-wired', type: 'state.update', data: { variableId: scoreVar.id, operation: 'increment', step: 1 } });
    const fmtScore = createLogicNode({ id: 'lg-fmt-score', type: 'logic.text', data: { mode: 'template', template: 'Score={{score}}' } });
    const setScoreTxt = createLogicNode({
      id: 'act-score-txt',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });

    // Input change captures event value + updates query variable + formats into status text
    const onInput = createLogicNode({ id: 'ev-input', type: 'event.on-input', data: { targetNodeId: inputNode.id, mode: 'change' } });
    const setQuery = createLogicNode({ id: 'st-set-q', type: 'state.update', data: { variableId: queryVar.id, operation: 'set' } });
    const fmtQuery = createLogicNode({ id: 'lg-fmt-q', type: 'logic.text', data: { mode: 'template', template: 'Q={{query}}' } });
    const setQueryTxt = createLogicNode({
      id: 'act-q-txt',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });

    // Drag start sets valid image URL on rectA; click-outside attempts unsafe javascript: URL (must be blocked) and shows modal
    const onDrag = createLogicNode({ id: 'ev-drag', type: 'event.on-drag', data: { targetNodeId: fx.rectAId, phase: 'start' } });
    const setSafeImg = createLogicNode({
      id: 'act-safe-img',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.rectAId, property: 'image', imageUrl: 'https://cdn.example.com/hero.png' },
    });
    const onOutside = createLogicNode({ id: 'ev-outside', type: 'event.on-click', data: { targetNodeId: fx.cardBId, mode: 'click-outside' } });
    const setUnsafeImg = createLogicNode({
      id: 'act-unsafe-img',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.rectAId, property: 'image', imageUrl: 'javascript:alert(1)' },
    });
    const showModal = createLogicNode({
      id: 'act-outside-modal',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.modalBoxId, property: 'visible', visibleMode: 'show' },
    });

    // Click button reads source.context (url-params 'tab') and source.external (count -> 0) and writes into tabVar & status
    const onBtn = createLogicNode({ id: 'ev-ctx-btn', type: 'event.on-click', data: { targetNodeId: fx.triggerBtnId } });
    const ctxUrl = createLogicNode({ id: 'src-url', type: 'source.context', data: { contextKind: 'url-params', paramKey: 'tab' } });
    const extSrc = createLogicNode({ id: 'src-ext', type: 'source.external', data: { sourceName: 'products' } });
    const setTab = createLogicNode({ id: 'st-set-tab', type: 'state.update', data: { variableId: tabVar.id, operation: 'set' } });
    const setExtCount = createLogicNode({ id: 'st-set-ext', type: 'state.update', data: { variableId: extCountVar.id, operation: 'set' } });
    const fmtTab = createLogicNode({ id: 'lg-fmt-tab', type: 'logic.text', data: { mode: 'template', template: '{{tab}}:{{extCount}}' } });
    const setTabTxt = createLogicNode({
      id: 'act-tab-txt',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: fx.statusTextId, property: 'text' },
    });

    const graph = createLogicGraph({
      id: 'graph-extended-parity',
      name: 'Extended 3-Runtime Behavioral Parity',
      scope: 'page',
      targetId: fx.pageId,
      variables: [scoreVar, tabVar, extCountVar, queryVar],
      nodes: [
        onKeyCombo, mathStep, incWired, fmtScore, setScoreTxt,
        onInput, setQuery, fmtQuery, setQueryTxt,
        onDrag, setSafeImg, onOutside, setUnsafeImg, showModal,
        onBtn, ctxUrl, extSrc, setTab, setExtCount, fmtTab, setTabTxt,
      ],
      connections: [
        createLogicConnection({ id: 'xk1', sourceNodeId: onKeyCombo.id, sourcePortId: 'exec', targetNodeId: incWired.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xk2', sourceNodeId: incWired.id, sourcePortId: 'next', targetNodeId: setScoreTxt.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xkd1', sourceNodeId: mathStep.id, sourcePortId: 'result', targetNodeId: incWired.id, targetPortId: 'step' }),
        createLogicConnection({ id: 'xkd2', sourceNodeId: fmtScore.id, sourcePortId: 'text', targetNodeId: setScoreTxt.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'xi1', sourceNodeId: onInput.id, sourcePortId: 'exec', targetNodeId: setQuery.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xi2', sourceNodeId: setQuery.id, sourcePortId: 'next', targetNodeId: setQueryTxt.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xid1', sourceNodeId: onInput.id, sourcePortId: 'value', targetNodeId: setQuery.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'xid2', sourceNodeId: fmtQuery.id, sourcePortId: 'text', targetNodeId: setQueryTxt.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'xd1', sourceNodeId: onDrag.id, sourcePortId: 'exec', targetNodeId: setSafeImg.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xo1', sourceNodeId: onOutside.id, sourcePortId: 'exec', targetNodeId: setUnsafeImg.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xo2', sourceNodeId: setUnsafeImg.id, sourcePortId: 'next', targetNodeId: showModal.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xb1', sourceNodeId: onBtn.id, sourcePortId: 'exec', targetNodeId: setTab.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xb2', sourceNodeId: setTab.id, sourcePortId: 'next', targetNodeId: setExtCount.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xb3', sourceNodeId: setExtCount.id, sourcePortId: 'next', targetNodeId: setTabTxt.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'xbd1', sourceNodeId: ctxUrl.id, sourcePortId: 'value', targetNodeId: setTab.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'xbd2', sourceNodeId: extSrc.id, sourcePortId: 'count', targetNodeId: setExtCount.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'xbd3', sourceNodeId: fmtTab.id, sourcePortId: 'text', targetNodeId: setTabTxt.id, targetPortId: 'value' }),
      ],
    });

    const project: FolioProject = { ...projectBase, logicGraphs: [graph] };
    const page = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project, { urlParams: { tab: 'pricing' } });
    // Plain 'k' without Ctrl must NOT trigger Ctrl+K
    const sNoMod = rt.dispatchNodeEvent('', 'key-press', 'k');
    expect(sNoMod.variables[scoreVar.id]).toBe(0);
    // Two sequential Ctrl+K presses increment 0 -> 5 -> 10
    const sK1 = rt.dispatchNodeEvent('', 'key-press', 'Ctrl+K');
    expect(sK1.variables[scoreVar.id]).toBe(5);
    expect(sK1.nodeOverrides[fx.statusTextId]?.text).toBe('Score=5');
    const sK2 = rt.dispatchNodeEvent('', 'key-press', 'Ctrl+K');
    expect(sK2.variables[scoreVar.id]).toBe(10);
    expect(sK2.nodeOverrides[fx.statusTextId]?.text).toBe('Score=10');

    const sInp = rt.dispatchNodeEvent(inputNode.id, 'input', 'folio');
    expect(sInp.variables[queryVar.id]).toBe('folio');
    expect(sInp.nodeOverrides[fx.statusTextId]?.text).toBe('Q=folio');

    const sDrag = rt.dispatchNodeEvent(fx.rectAId, 'drag');
    expect(sDrag.nodeOverrides[fx.rectAId]?.imageUrl).toBe('https://cdn.example.com/hero.png');

    const sOut = rt.dispatchNodeEvent(fx.cardBId, 'click-outside');
    expect(sOut.nodeOverrides[fx.rectAId]?.imageUrl).toBe('https://cdn.example.com/hero.png');
    expect(sOut.nodeOverrides[fx.modalBoxId]?.visible).toBe(true);

    const sCtx = rt.dispatchNodeEvent(fx.triggerBtnId, 'click');
    expect(sCtx.variables[tabVar.id]).toBe('pricing');
    expect(sCtx.variables[extCountVar.id]).toBe(0);
    expect(sCtx.nodeOverrides[fx.statusTextId]?.text).toBe('pricing:0');

    // 2. Live Preview Micro-Runtime
    const script = buildLivePreviewLogicScript(project, page)!;
    const preview = createPreviewDomHarness(
      script,
      [fx.statusTextId, inputNode.id, fx.rectAId, fx.cardBId, fx.modalBoxId, fx.triggerBtnId],
      {
        tagNameById: { [inputNode.id]: 'INPUT' },
        initialDisplayById: { [fx.modalBoxId]: 'none' },
      },
    );
    preview.keydown('k');
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('');
    preview.keydown('k', { ctrlKey: true });
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Score=5');
    preview.keydown('k', { ctrlKey: true });
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Score=10');

    preview.input(inputNode.id, 'folio');
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('Q=folio');

    preview.dragStart(fx.rectAId);
    expect(preview.elements.get(fx.rectAId)?.style.backgroundImage).toContain('https://cdn.example.com/hero.png');

    preview.clickOutside();
    expect(preview.elements.get(fx.rectAId)?.style.backgroundImage).toContain('https://cdn.example.com/hero.png');
    expect(preview.elements.get(fx.modalBoxId)?.style.display).toBe('block');

    preview.click(fx.triggerBtnId);
    expect(preview.elements.get(fx.statusTextId)?.textContent).toBe('pricing:0');

    // 3. Real Executed React TSX
    const reactHarness = createReactTsxHarness(project, fx.pageId);
    reactHarness.keydown('k');
    expect(reactHarness.getText(fx.statusTextId)).toBe('Ready');
    reactHarness.keydown('k', { ctrlKey: true });
    expect(reactHarness.getText(fx.statusTextId)).toBe('Score=5');
    reactHarness.keydown('k', { ctrlKey: true });
    expect(reactHarness.getText(fx.statusTextId)).toBe('Score=10');

    reactHarness.input(inputNode.id, 'folio');
    expect(reactHarness.getText(fx.statusTextId)).toBe('Q=folio');

    reactHarness.dragStart(fx.rectAId);
    expect(String(reactHarness.getStyle(fx.rectAId).backgroundImage ?? '')).toContain('https://cdn.example.com/hero.png');

    reactHarness.clickOutside();
    expect(String(reactHarness.getStyle(fx.rectAId).backgroundImage ?? '')).toContain('https://cdn.example.com/hero.png');
    expect(reactHarness.getStyle(fx.modalBoxId).display).toBe('block');

    reactHarness.click(fx.triggerBtnId);
    expect(reactHarness.getText(fx.statusTextId)).toBe('pricing:0');
  });
});


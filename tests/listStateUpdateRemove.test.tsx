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

import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import type { FolioPage, FolioProject, LogicVariableDefinition } from '../src/core/document/types';
import {
  applyListRemove,
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
} from '../src/engines/prototype';
import { NodeLogicNodeFields } from '../src/app/workspace/NodeLogicNodeFields';

function findVNodes(node: unknown, predicate: (v: VNode<Record<string, unknown>>) => boolean): Array<VNode<Record<string, unknown>>> {
  const out: Array<VNode<Record<string, unknown>>> = [];
  const walk = (cur: unknown) => {
    if (!cur || typeof cur !== 'object') return;
    if (Array.isArray(cur)) {
      for (const item of cur) walk(item);
      return;
    }
    const vnode = cur as VNode<Record<string, unknown>>;
    if (predicate(vnode)) out.push(vnode);
    if (vnode.props && 'children' in vnode.props) {
      walk(vnode.props.children);
    }
  };
  walk(node);
  return out;
}

function collectText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object') {
    const vnode = node as VNode<Record<string, unknown>>;
    return collectText(vnode.props?.children);
  }
  return '';
}

function createListUpdateProject(
  initialList: unknown[],
  updateNodeData: Record<string, string | number | boolean | null>,
): { project: FolioProject; page: FolioPage; btnId: string; varId: string } {
  const base = createInitialProject('List Update Regression');
  const basePage = base.pages[0];
  const btn = { ...createRectNode(0), id: 'btn-run', name: 'Run' };
  const label = { ...createTextNode(0), id: 'txt-out', name: 'Out', text: '' };

  const listVar: LogicVariableDefinition = createLogicVariable({
    id: 'var-names',
    name: 'names',
    valueType: 'list',
    initialValue: JSON.stringify(initialList),
  });

  const graph = createLogicGraph({
    id: 'graph-list-remove',
    name: 'List Remove Graph',
    scope: 'page',
    targetId: basePage.id,
    variables: [listVar],
    nodes: [
      createLogicNode({
        id: 'n-click',
        type: 'event.on-click',
        x: 20,
        y: 40,
        data: { targetNodeId: btn.id, mode: 'click' },
      }),
      createLogicNode({
        id: 'n-update',
        type: 'state.update',
        x: 240,
        y: 40,
        data: {
          variableId: listVar.id,
          ...updateNodeData,
        },
      }),
      createLogicNode({
        id: 'n-set-text',
        type: 'action.set-layer',
        x: 460,
        y: 40,
        data: { targetMode: 'override', targetNodeId: label.id, property: 'text', text: '' },
      }),
    ],
    connections: [
      createLogicConnection({
        id: 'c1',
        sourceNodeId: 'n-click',
        sourcePortId: 'exec',
        targetNodeId: 'n-update',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c2',
        sourceNodeId: 'n-update',
        sourcePortId: 'next',
        targetNodeId: 'n-set-text',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c3',
        sourceNodeId: 'n-update',
        sourcePortId: 'value',
        targetNodeId: 'n-set-text',
        targetPortId: 'value',
      }),
    ],
  });

  const page: FolioPage = {
    ...basePage,
    document: { ...basePage.document, nodes: [btn, label] },
  };
  const project: FolioProject = {
    ...base,
    pages: [page],
    logicGraphs: [graph],
  };

  return { project, page, btnId: btn.id, varId: listVar.id };
}

describe('NodeLogicNodeFields — Update State List Remove UI', () => {
  const listVar = createLogicVariable({
    id: 'var-names',
    name: 'names',
    valueType: 'list',
    initialValue: '["Ayu","Bima","Citra"]',
  });

  const renderFields = (
    data: Record<string, string | number | boolean | null>,
    onUpdateNodeData: (nodeId: string, patch: Record<string, string | number | boolean | null>) => void,
  ) => {
    const base = createInitialProject('UI Fields Test');
    const page = base.pages[0];
    const node = createLogicNode({ id: 'n-upd', type: 'state.update', x: 0, y: 0, data });
    const graph = createLogicGraph({
      id: 'g-1',
      name: 'G1',
      scope: 'page',
      targetId: page.id,
      variables: [listVar],
      nodes: [node],
      connections: [],
    });
    return NodeLogicNodeFields({
      node,
      graph,
      scopedAstNodes: page.document.nodes,
      availableVariables: [listVar],
      components: [],
      pages: base.pages,
      themes: base.designTokens?.themes ?? [],
      animations: [],
      onChangeTab: () => {},
      onUpdateNodeData,
    });
  };

  it('shows Remove by Value and Remove by Index options and saves removeMode + JS Number index', () => {
    const patches: Array<Record<string, string | number | boolean | null>> = [];
    const onUpdate = (_id: string, patch: Record<string, string | number | boolean | null>) => {
      patches.push(patch);
    };

    // 1. Value mode renders text input and Remove mode select
    const valueTree = renderFields(
      { variableId: listVar.id, operation: 'remove', removeMode: 'value', value: 'Bima' },
      onUpdate,
    );
    const modeSelects = findVNodes(valueTree, (v) => v.type === 'select' && v.props['aria-label'] === 'List remove mode');
    expect(modeSelects).toHaveLength(1);
    const options = findVNodes(modeSelects[0], (v) => v.type === 'option');
    expect(options.map((o) => ({ value: o.props.value, label: collectText(o) }))).toEqual([
      { value: 'value', label: 'Remove by Value' },
      { value: 'index', label: 'Remove by Index' },
    ]);

    const valueInputs = findVNodes(valueTree, (v) => v.type === 'input' && v.props['aria-label'] === 'Value to remove');
    expect(valueInputs).toHaveLength(1);
    expect(valueInputs[0].props.type).toBe('text');

    // Switch dropdown to Remove by Index (from non-numeric "Bima" -> clears value to null)
    const onModeChange = modeSelects[0].props.onChange as (ev: { currentTarget: { value: string } }) => void;
    onModeChange({ currentTarget: { value: 'index' } });
    expect(patches[patches.length - 1]).toEqual({ removeMode: 'index', value: null });

    // 2. Index mode renders integer number input with min=0, step=1 and stores JavaScript Number (not String)
    const indexTree = renderFields(
      { variableId: listVar.id, operation: 'remove', removeMode: 'index', value: 0 },
      onUpdate,
    );
    const indexInputs = findVNodes(indexTree, (v) => v.type === 'input' && v.props['aria-label'] === 'Index to remove');
    expect(indexInputs).toHaveLength(1);
    expect(indexInputs[0].props.type).toBe('number');
    expect(indexInputs[0].props.min).toBe(0);
    expect(indexInputs[0].props.step).toBe(1);
    expect(indexInputs[0].props.value).toBe(0);

    const onIndexInput = indexInputs[0].props.onInput as (ev: { currentTarget: { value: string } }) => void;
    onIndexInput({ currentTarget: { value: '0' } });
    expect(patches[patches.length - 1]).toEqual({ removeMode: 'index', value: 0 });
    expect(typeof patches[patches.length - 1].value).toBe('number');

    onIndexInput({ currentTarget: { value: '2' } });
    expect(patches[patches.length - 1]).toEqual({ removeMode: 'index', value: 2 });
    expect(typeof patches[patches.length - 1].value).toBe('number');

    onIndexInput({ currentTarget: { value: '' } });
    expect(patches[patches.length - 1]).toEqual({ removeMode: 'index', value: null });
  });
});

describe('Prototype Runtime — Update State List Remove & Other List Operations', () => {
  it('removes first element with Remove by Index 0: ["Ayu", "Bima", "Citra"] -> ["Bima", "Citra"]', () => {
    const { project, btnId, varId } = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      removeMode: 'index',
      value: 0,
    });
    const runtime = createPrototypeRuntime(project);
    const snap = runtime.dispatchNodeEvent(btnId, 'click');
    expect(snap.variables[varId]).toEqual(['Bima', 'Citra']);
  });

  it('removes only the single second element with Remove by Index 1 (even with duplicates)', () => {
    const { project, btnId, varId } = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      removeMode: 'index',
      value: 1,
    });
    const snap = createPrototypeRuntime(project).dispatchNodeEvent(btnId, 'click');
    expect(snap.variables[varId]).toEqual(['Ayu', 'Citra']);

    const dup = createListUpdateProject(['Ayu', 'Ayu', 'Citra'], {
      operation: 'remove',
      removeMode: 'index',
      value: 1,
    });
    const dupSnap = createPrototypeRuntime(dup.project).dispatchNodeEvent(dup.btnId, 'click');
    expect(dupSnap.variables[dup.varId]).toEqual(['Ayu', 'Citra']);
  });

  it('removes matching value with Remove by Value "Bima"', () => {
    const { project, btnId, varId } = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      removeMode: 'value',
      value: 'Bima',
    });
    const snap = createPrototypeRuntime(project).dispatchNodeEvent(btnId, 'click');
    expect(snap.variables[varId]).toEqual(['Ayu', 'Citra']);
  });

  it('does NOT modify the list for invalid indices (-1, 1.5, empty, out-of-bounds, or non-numeric string) and never falls back to value removal', () => {
    const invalidInputs: Array<string | number | null> = [-1, 1.5, null, '', '   ', 3, 99, 'Bima'];
    for (const badIndex of invalidInputs) {
      const { project, btnId, varId } = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
        operation: 'remove',
        removeMode: 'index',
        value: badIndex,
      });
      const snap = createPrototypeRuntime(project).dispatchNodeEvent(btnId, 'click');
      expect(snap.variables[varId], `Invalid index ${JSON.stringify(badIndex)} must not mutate list`).toEqual([
        'Ayu',
        'Bima',
        'Citra',
      ]);
    }

    // Even when a numeric list literally contains -1 or 1.5, invalid index must NOT fall back to value removal!
    expect(applyListRemove([-1, 1.5, 99], -1, 'index')).toEqual({ next: [-1, 1.5, 99], changed: false });
    expect(applyListRemove([-1, 1.5, 99], 1.5, 'index')).toEqual({ next: [-1, 1.5, 99], changed: false });
    expect(applyListRemove([-1, 1.5, 99], 99, 'index')).toEqual({ next: [-1, 1.5, 99], changed: false });
  });

  it('preserves legacy compatibility when removeMode is omitted (number -> index, non-number -> value, invalid number does not remove by value)', () => {
    const legacyByIndex = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      value: 0,
    });
    expect(createPrototypeRuntime(legacyByIndex.project).dispatchNodeEvent(legacyByIndex.btnId, 'click').variables[legacyByIndex.varId]).toEqual([
      'Bima',
      'Citra',
    ]);

    const legacyByValue = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      value: 'Bima',
    });
    expect(createPrototypeRuntime(legacyByValue.project).dispatchNodeEvent(legacyByValue.btnId, 'click').variables[legacyByValue.varId]).toEqual([
      'Ayu',
      'Citra',
    ]);

    const legacyInvalidNumber = createListUpdateProject([-1, 1.5, 99], {
      operation: 'remove',
      value: 1.5,
    });
    expect(
      createPrototypeRuntime(legacyInvalidNumber.project).dispatchNodeEvent(legacyInvalidNumber.btnId, 'click').variables[
        legacyInvalidNumber.varId
      ],
    ).toEqual([-1, 1.5, 99]);
  });

  it('keeps Push, Replace List (JSON), and Reset to Initial working properly', () => {
    // Push
    const pushCase = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'push',
      value: 'Dina',
    });
    expect(createPrototypeRuntime(pushCase.project).dispatchNodeEvent(pushCase.btnId, 'click').variables[pushCase.varId]).toEqual([
      'Ayu',
      'Bima',
      'Citra',
      'Dina',
    ]);

    // Replace list (JSON)
    const replaceCase = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'set',
      value: '["Satu","Dua"]',
    });
    expect(createPrototypeRuntime(replaceCase.project).dispatchNodeEvent(replaceCase.btnId, 'click').variables[replaceCase.varId]).toEqual([
      'Satu',
      'Dua',
    ]);

    // Reset to initial (first remove index 0, then reset)
    const base = createInitialProject('Reset List Regression');
    const basePage = base.pages[0];
    const btnRemove = { ...createRectNode(0), id: 'btn-rem', name: 'Remove' };
    const btnReset = { ...createRectNode(1), id: 'btn-rst', name: 'Reset' };
    const listVar = createLogicVariable({
      id: 'var-items',
      name: 'items',
      valueType: 'list',
      initialValue: '["Ayu","Bima","Citra"]',
    });
    const graph = createLogicGraph({
      id: 'g-rst',
      name: 'Reset Graph',
      scope: 'page',
      targetId: basePage.id,
      variables: [listVar],
      nodes: [
        createLogicNode({ id: 'e-rem', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: btnRemove.id, mode: 'click' } }),
        createLogicNode({ id: 'u-rem', type: 'state.update', x: 200, y: 0, data: { variableId: listVar.id, operation: 'remove', removeMode: 'index', value: 0 } }),
        createLogicNode({ id: 'e-rst', type: 'event.on-click', x: 0, y: 120, data: { targetNodeId: btnReset.id, mode: 'click' } }),
        createLogicNode({ id: 'u-rst', type: 'state.update', x: 200, y: 120, data: { variableId: listVar.id, operation: 'reset' } }),
      ],
      connections: [
        createLogicConnection({ id: 'c-rem', sourceNodeId: 'e-rem', sourcePortId: 'exec', targetNodeId: 'u-rem', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c-rst', sourceNodeId: 'e-rst', sourcePortId: 'exec', targetNodeId: 'u-rst', targetPortId: 'exec' }),
      ],
    });
    const project: FolioProject = {
      ...base,
      pages: [{ ...basePage, document: { ...basePage.document, nodes: [btnRemove, btnReset] } }],
      logicGraphs: [graph],
    };
    const rt = createPrototypeRuntime(project);
    expect(rt.dispatchNodeEvent(btnRemove.id, 'click').variables[listVar.id]).toEqual(['Bima', 'Citra']);
    expect(rt.dispatchNodeEvent(btnReset.id, 'click').variables[listVar.id]).toEqual(['Ayu', 'Bima', 'Citra']);
  });

  it('maintains Live Preview script parity for Remove by Index', () => {
    const { project, page, btnId } = createListUpdateProject(['Ayu', 'Bima', 'Citra'], {
      operation: 'remove',
      removeMode: 'index',
      value: 0,
    });
    const script = buildLivePreviewLogicScript(project, page);
    expect(script).not.toBeNull();
    expect(script).toContain('removeMode');

    const listeners: Record<string, Array<(ev: unknown) => void>> = {};
    const outEl = {
      textContent: '',
      style: {},
      attributes: { 'data-folio-id': 'txt-out' } as Record<string, string>,
      addEventListener: () => {},
      getAttribute(k: string) { return this.attributes[k] ?? null; },
      setAttribute(k: string, v: string) { this.attributes[k] = v; },
      removeAttribute(k: string) { delete this.attributes[k]; },
    };
    const btnEl = {
      textContent: '',
      style: {},
      attributes: { 'data-folio-id': btnId } as Record<string, string>,
      addEventListener(t: string, cb: (ev: unknown) => void) {
        if (!listeners[t]) listeners[t] = [];
        listeners[t].push(cb);
      },
      getAttribute(k: string) { return this.attributes[k] ?? null; },
      setAttribute(k: string, v: string) { this.attributes[k] = v; },
      removeAttribute(k: string) { delete this.attributes[k]; },
    };

    const mockWin = { location: { origin: 'https://folio.local', href: 'https://folio.local/', hash: '' }, addEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval };
    const mockDoc = {
      readyState: 'complete',
      documentElement: { dataset: {}, style: {}, offsetWidth: 1440, classList: { add: () => {}, remove: () => {}, has: () => false }, setAttribute: () => {}, removeAttribute: () => {}, getAttribute: () => null },
      body: { appendChild: () => {}, style: {} },
      querySelectorAll: (sel: string) => (sel === '[data-folio-id]' ? [btnEl, outEl] : []),
      querySelector: () => null,
      addEventListener: () => {},
    };

    new Function('window', 'document', script!)(mockWin, mockDoc);
    for (const cb of listeners.click ?? []) cb({ target: btnEl, currentTarget: btnEl });
    expect(outEl.textContent).toBe('["Bima","Citra"]');
  });
});

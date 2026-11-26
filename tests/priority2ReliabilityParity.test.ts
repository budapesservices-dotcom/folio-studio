import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import type { LogicGraph, TextNode } from '../src/core/document/types';
import { downloadProject } from '../src/core/persistence/projectFile';
import { downloadSvgDocument } from '../src/app/visualExport';
import { triggerMotionBlobDownload } from '../src/engines/animation/videoExport';
import { buildLivePreviewLogicScript, buildReactPageLogicPlan } from '../src/engines/prototype/codegen';
import { createPrototypeRuntime } from '../src/engines/prototype/runtime';

function buildStorageTestProject(scope: 'local' | 'session' = 'local') {
  const project = createInitialProject();
  const page = project.pages[0];
  const buttonNode = page.document.nodes[0];
  const outputText: TextNode = {
    id: 'storage-output-text',
    type: 'text',
    name: 'Storage Output',
    x: 40,
    y: 40,
    width: 240,
    height: 32,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'Initial',
    style: {
      fill: '#ffffff',
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 500,
      letterSpacing: 0,
      lineHeight: 1.4,
    },
  };
  page.document.nodes.push(outputText);

  const graph: LogicGraph = {
    id: 'graph-storage-parity',
    name: 'Storage Fallback Graph',
    scope: 'page',
    targetId: page.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variables: [],
    nodes: [
      {
        id: 'ev-save',
        type: 'event.on-click',
        x: 0,
        y: 0,
        data: { targetNodeId: buttonNode.id, mode: 'click' },
      },
      {
        id: 'act-write',
        type: 'action.system-form',
        x: 200,
        y: 0,
        data: {
          action: 'storage',
          storageKey: 'folio_draft_title',
          storageScope: scope,
          value: 'Saved In Memory',
        },
      },
      {
        id: 'act-read',
        type: 'action.system-form',
        x: 400,
        y: 0,
        data: {
          action: 'storage.get',
          storageKey: 'folio_draft_title',
          storageScope: scope,
          value: 'Missing Fallback',
        },
      },
      {
        id: 'act-show',
        type: 'action.set-layer',
        x: 600,
        y: 0,
        data: {
          targetMode: 'override',
          targetNodeId: outputText.id,
          property: 'text',
          pipelineRef: 'step:act-read:value',
        },
      },
      {
        id: 'ev-clear',
        type: 'event.on-hover',
        x: 0,
        y: 220,
        data: { targetNodeId: buttonNode.id, phase: 'enter' },
      },
      {
        id: 'act-remove',
        type: 'action.system-form',
        x: 200,
        y: 220,
        data: {
          action: 'storage.remove',
          storageKey: 'folio_draft_title',
          storageScope: scope,
        },
      },
      {
        id: 'act-read-after-remove',
        type: 'action.system-form',
        x: 400,
        y: 220,
        data: {
          action: 'storage.get',
          storageKey: 'folio_draft_title',
          storageScope: scope,
          value: 'Cleared Default',
        },
      },
      {
        id: 'act-show-after-remove',
        type: 'action.set-layer',
        x: 600,
        y: 220,
        data: {
          targetMode: 'override',
          targetNodeId: outputText.id,
          property: 'text',
          pipelineRef: 'step:act-read-after-remove:value',
        },
      },
    ],
    connections: [
      { id: 'c1', sourceNodeId: 'ev-save', sourcePortId: 'exec', targetNodeId: 'act-write', targetPortId: 'exec' },
      { id: 'c2', sourceNodeId: 'act-write', sourcePortId: 'next', targetNodeId: 'act-read', targetPortId: 'exec' },
      { id: 'c3', sourceNodeId: 'act-read', sourcePortId: 'next', targetNodeId: 'act-show', targetPortId: 'exec' },
      { id: 'c4', sourceNodeId: 'ev-clear', sourcePortId: 'exec', targetNodeId: 'act-remove', targetPortId: 'exec' },
      { id: 'c5', sourceNodeId: 'act-remove', sourcePortId: 'next', targetNodeId: 'act-read-after-remove', targetPortId: 'exec' },
      { id: 'c6', sourceNodeId: 'act-read-after-remove', sourcePortId: 'next', targetNodeId: 'act-show-after-remove', targetPortId: 'exec' },
    ],
  };

  project.logicGraphs = [graph];
  return { project, page, buttonNode, outputText };
}

function runLivePreviewScriptInMockDom(
  script: string,
  nodeIds: string[],
  windowOverrides: Record<string, unknown>,
) {
  const listenersById = new Map<string, Map<string, Array<() => void>>>();
  const elements = nodeIds.map((id) => {
    const elListeners = new Map<string, Array<() => void>>();
    listenersById.set(id, elListeners);
    return {
      tagName: 'DIV',
      textContent: 'Initial',
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      attributes: new Map<string, string>([['data-folio-id', id]]),
      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.set(name, String(value));
      },
      removeAttribute(name: string) {
        this.attributes.delete(name);
      },
      addEventListener(eventName: string, fn: () => void) {
        const list = elListeners.get(eventName) ?? [];
        list.push(fn);
        elListeners.set(eventName, list);
      },
    };
  });

  const mockDocument = {
    documentElement: {
      classList: { add() {}, remove() {}, contains: () => false },
      setAttribute() {},
      removeAttribute() {},
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-folio-id]') return elements;
      return [];
    },
    addEventListener() {},
  };

  const mockWindow: Record<string, unknown> = {
    innerWidth: 1440,
    innerHeight: 900,
    location: { search: '' },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  Object.defineProperties(mockWindow, Object.getOwnPropertyDescriptors(windowOverrides));

  // Execute generated Live Preview micro-runtime with isolated window/document bindings
  const runner = new Function('window', 'document', script);
  runner(mockWindow, mockDocument);

  return {
    trigger(nodeId: string, eventName: string) {
      const fns = listenersById.get(nodeId)?.get(eventName) ?? [];
      for (const fn of fns) fn();
    },
    getElement(nodeId: string) {
      return elements.find((el) => el.getAttribute('data-folio-id') === nodeId);
    },
  };
}

describe('Priority 2 — Live Preview Storage Fallback & Large Export Reliability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('falls back seamlessly to in-memory storage in sandboxed Live Preview when localStorage/sessionStorage throw SecurityError', () => {
    const { project, page, buttonNode, outputText } = buildStorageTestProject('local');
    const script = buildLivePreviewLogicScript(project, page);
    expect(script).toBeTruthy();

    const blockedWindow = {};
    Object.defineProperty(blockedWindow, 'localStorage', {
      get() {
        throw new Error('SecurityError: The document is sandboxed and lacks allow-same-origin');
      },
      enumerable: true,
    });
    Object.defineProperty(blockedWindow, 'sessionStorage', {
      get() {
        throw new Error('SecurityError: The document is sandboxed and lacks allow-same-origin');
      },
      enumerable: true,
    });

    const env = runLivePreviewScriptInMockDom(script!, [buttonNode.id, outputText.id], blockedWindow);

    // Click writes to in-memory fallback -> reads back -> updates text layer with zero errors
    expect(() => env.trigger(buttonNode.id, 'click')).not.toThrow();
    expect(env.getElement(outputText.id)?.textContent).toBe('Saved In Memory');

    // Hover removes key from in-memory fallback -> subsequent read returns fallback default
    expect(() => env.trigger(buttonNode.id, 'mouseenter')).not.toThrow();
    expect(env.getElement(outputText.id)?.textContent).toBe('Cleared Default');
  });

  it('uses native browser storage when available in Live Preview while preserving parity with Headless Simulator & React TSX', () => {
    const { project, page, buttonNode, outputText } = buildStorageTestProject('session');
    const script = buildLivePreviewLogicScript(project, page);
    expect(script).toBeTruthy();

    const backingMap = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (k: string) => (backingMap.has(k) ? backingMap.get(k)! : null),
      setItem: (k: string, v: string) => {
        backingMap.set(k, v);
      },
      removeItem: (k: string) => {
        backingMap.delete(k);
      },
      clear: () => {
        backingMap.clear();
      },
    };

    const env = runLivePreviewScriptInMockDom(script!, [buttonNode.id, outputText.id], {
      sessionStorage: mockSessionStorage,
    });

    env.trigger(buttonNode.id, 'click');
    expect(backingMap.get('folio_draft_title')).toBe('Saved In Memory');
    expect(env.getElement(outputText.id)?.textContent).toBe('Saved In Memory');

    env.trigger(buttonNode.id, 'mouseenter');
    expect(backingMap.has('folio_draft_title')).toBe(false);
    expect(env.getElement(outputText.id)?.textContent).toBe('Cleared Default');

    // Headless Prototype Simulator matches Live Preview step-for-step
    const runtime = createPrototypeRuntime(project);
    const afterClick = runtime.dispatchNodeEvent(buttonNode.id, 'click');
    expect(afterClick.nodeOverrides[outputText.id]?.text).toBe('Saved In Memory');
    const afterHover = runtime.dispatchNodeEvent(buttonNode.id, 'hover-enter');
    expect(afterHover.nodeOverrides[outputText.id]?.text).toBe('Cleared Default');

    // React TSX codegen emits the same sandbox-safe memory fallback guard
    const reactPlan = buildReactPageLogicPlan(project, page);
    expect(reactPlan?.hookLines.join('\n')).toContain('logicMemoryStorageRef');
  });

  it('schedules URL.revokeObjectURL with at least a 60s safety delay on project, visual, and motion exports', () => {
    const setTimeoutSpy = vi.fn((_cb: () => void, _ms?: number) => 1 as unknown as ReturnType<typeof setTimeout>);
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: {
        append: vi.fn(),
        appendChild: vi.fn(),
      },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:folio-large-export'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('window', { setTimeout: setTimeoutSpy });
    vi.stubGlobal('setTimeout', setTimeoutSpy);

    const project = createInitialProject();
    downloadProject(project);
    downloadSvgDocument(project.pages[0].document, project.components, 'poster');
    triggerMotionBlobDownload(new Blob(['mp4-bytes'], { type: 'video/mp4' }), 'clip.mp4');

    const scheduledDelays = setTimeoutSpy.mock.calls.map((call) => Number(call[1]));
    expect(scheduledDelays).toHaveLength(3);
    for (const delayMs of scheduledDelays) {
      expect(delayMs).toBeGreaterThanOrEqual(60_000);
    }
  });
});

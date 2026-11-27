import { afterEach, describe, expect, it, vi } from 'vitest';
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

import { createInitialProject } from '../src/core/document/factory';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  clearSessionNetworkTestToken,
  createLogicGraph,
  createLogicNode,
  setSessionNetworkTestToken,
} from '../src/engines/prototype';
import { NodeLogicNodeFields } from '../src/app/workspace/NodeLogicNodeFields';

function findButtonByLabel(node: unknown, label: string): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonByLabel(child, label);
      if (found) return found;
    }
    return null;
  }
  const vnode = node as VNode<Record<string, unknown>>;
  if (vnode.type === 'button') {
    const text = collectText(vnode.props?.children);
    if (text.includes(label)) {
      return { props: vnode.props ?? {} };
    }
  }
  return findButtonByLabel(vnode.props?.children, label);
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

afterEach(() => {
  clearSessionNetworkTestToken();
  vi.restoreAllMocks();
});

describe('NodeLogicNodeFields — Test Live Request & Session-Only Local Test Token', () => {
  it('uses Session-Only Local Test Token + safe globalHeaders for Test Live Request and NEVER persists it anywhere', async () => {
    const base = createInitialProject('Session Token Test');
    const page = base.pages[0];
    const httpNode = createLogicNode({
      id: 'node-http-1',
      type: 'network.http',
      x: 40,
      y: 40,
      data: {
        method: 'POST',
        url: '/v1/orders',
        body: '{"item":"book"}',
        executionMode: 'live',
        useAuth: true,
      },
    });
    const graph = createLogicGraph({
      id: 'graph-session-test',
      name: 'Session Graph',
      scope: 'page',
      targetId: page.id,
      networkSettings: {
        baseUrl: 'https://api.example.com',
        globalHeaders: JSON.stringify({ Accept: 'application/json', 'X-App': 'folio' }),
        authSecretRef: 'API_TOKEN',
      },
      nodes: [httpNode],
      connections: [],
    });
    const project = { ...base, logicGraphs: [graph] };

    const TEMP_TOKEN = 'ephemeral_local_test_token_991122';
    setSessionNetworkTestToken(graph.id, 'API_TOKEN', TEMP_TOKEN);

    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ status: 200, ok: true, durationMs: 9, data: { id: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const tree = NodeLogicNodeFields({
        node: httpNode,
        graph,
        scopedAstNodes: page.document.nodes,
        availableVariables: [],
        components: [],
        pages: project.pages,
        themes: project.designTokens?.themes ?? [],
        animations: [],
        onChangeTab: () => {},
        onUpdateNodeData: () => {},
      });

      const testBtn = findButtonByLabel(tree, 'Test Live Request');
      expect(testBtn).not.toBeNull();
      const onClick = testBtn?.props.onClick as (() => void) | undefined;
      expect(typeof onClick).toBe('function');
      onClick?.();
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe('/api/logic/http-proxy');
      expect(fetchCalls[0].body.url).toBe('https://api.example.com/v1/orders');
      expect(fetchCalls[0].body.method).toBe('POST');
      expect((fetchCalls[0].body.headers as Record<string, string>)['X-App']).toBe('folio');
      expect((fetchCalls[0].body.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEMP_TOKEN}`);
      // Server secret ref is NOT sent when session test token overrides it
      expect(fetchCalls[0].body.authSecretRef).toBeUndefined();

      // Verify zero persistence across .flop JSON, Live Preview HTML, and React TSX export
      const flopJson = serializeProjectToFlopJson(project);
      expect(flopJson).not.toContain(TEMP_TOKEN);
      expect(flopJson).toContain('API_TOKEN');

      const previewHtml = buildLivePreviewHtml(project, { pageId: page.id });
      expect(previewHtml).not.toContain(TEMP_TOKEN);

      const reactFiles = compileReactProjectFiles(project);
      expect(reactFiles.map((f) => f.content).join('\n')).not.toContain(TEMP_TOKEN);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends authSecretRef when no session token is present, and supports Test Live Request on source.external', async () => {
    const base = createInitialProject('Server Ref Test');
    const page = base.pages[0];
    const extNode = createLogicNode({
      id: 'node-ext-1',
      type: 'source.external',
      x: 40,
      y: 40,
      data: {
        sourceKind: 'api',
        endpoint: '/catalog',
        query: 'page=1',
        executionMode: 'live',
        useAuth: true,
      },
    });
    const graph = createLogicGraph({
      id: 'graph-ext-ref',
      name: 'Ext Graph',
      scope: 'page',
      targetId: page.id,
      networkSettings: {
        baseUrl: 'https://cms.example.com',
        globalHeaders: '{}',
        authSecretRef: 'CMS_SECRET',
      },
      nodes: [extNode],
      connections: [],
    });

    const fetchCalls: Array<Record<string, unknown>> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ status: 200, ok: true, durationMs: 11, data: [{ id: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const tree = NodeLogicNodeFields({
        node: extNode,
        graph,
        scopedAstNodes: page.document.nodes,
        availableVariables: [],
        components: [],
        pages: base.pages,
        themes: base.designTokens?.themes ?? [],
        animations: [],
        onChangeTab: () => {},
        onUpdateNodeData: () => {},
      });
      const testBtn = findButtonByLabel(tree, 'Test Live Request');
      expect(testBtn).not.toBeNull();
      (testBtn?.props.onClick as () => void)();
      await new Promise((r) => setTimeout(r, 15));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe('https://cms.example.com/catalog?page=1');
      expect(fetchCalls[0].method).toBe('GET');
      expect(fetchCalls[0].authSecretRef).toBe('CMS_SECRET');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

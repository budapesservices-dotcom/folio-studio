import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import {
  clearProxyJwksCache,
  executeServerHttpProxy,
  handleHttpProxyWebRequest,
  isHostAllowedByRules,
  isPrivateOrReservedIp,
  MAX_PROXY_ENVELOPE_BYTES,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  parseAllowedHostsConfig,
  validateProxyTargetUrl,
} from '../src/server/httpProxyHandler';
import {
  onRequest,
  onRequestOptions,
  onRequestPost,
} from '../functions/api/logic/http-proxy';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import type { FolioPage, FolioProject } from '../src/core/document/types';
import {
  buildLivePreviewLogicScript,
  buildReactPageLogicPlan,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
  NODE_RUNTIME_PARITY_MATRIX,
} from '../src/engines/prototype';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';

import proxyHandlerSource from '../src/server/httpProxyHandler.ts?raw';
import cfFunctionSource from '../functions/api/logic/http-proxy.ts?raw';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createTestRsaJwtFixture() {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = {
    ...(await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey)),
    kid: 'test-cf-kid-1',
    alg: 'RS256',
    use: 'sig',
  };

  const signJwt = async (payload: Record<string, unknown>, headerOverrides: Record<string, unknown> = {}) => {
    const enc = new TextEncoder();
    const header = { alg: 'RS256', typ: 'JWT', kid: 'test-cf-kid-1', ...headerOverrides };
    const hSeg = toBase64Url(enc.encode(JSON.stringify(header)));
    const pSeg = toBase64Url(enc.encode(JSON.stringify(payload)));
    const sigBuf = await globalThis.crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      enc.encode(`${hSeg}.${pSeg}`),
    );
    const sSeg = toBase64Url(new Uint8Array(sigBuf));
    return `${hSeg}.${pSeg}.${sSeg}`;
  };

  return { publicJwk, signJwt };
}

function makeLiveHttpProject(): {
  project: FolioProject;
  page: FolioPage;
  btnId: string;
  statusId: string;
  outputId: string;
} {
  const base = createInitialProject('Live HTTP Parity Project');
  const basePage = base.pages[0];
  const btn = { ...createRectNode(0), id: 'btn-fetch', name: 'Fetch Button' };
  const statusTxt = { ...createTextNode(0), id: 'txt-status', name: 'Status', text: 'Idle' };
  const outTxt = { ...createTextNode(1), id: 'txt-output', name: 'Output', text: 'None' };

  const graph = createLogicGraph({
    id: 'graph-live-http',
    name: 'Live HTTP Graph',
    scope: 'page',
    targetId: basePage.id,
    networkSettings: {
      baseUrl: 'https://api.example.com',
      globalHeaders: JSON.stringify({ Accept: 'application/json', 'X-Client-App': 'folio-test' }),
      authSecretRef: 'API_TOKEN',
    },
    nodes: [
      createLogicNode({
        id: 'n-click',
        type: 'event.on-click',
        x: 40,
        y: 80,
        data: { targetNodeId: btn.id, mode: 'click' },
      }),
      createLogicNode({
        id: 'n-http',
        type: 'network.http',
        x: 280,
        y: 80,
        data: {
          method: 'POST',
          url: '/v1/users',
          body: '{"role":"designer"}',
          executionMode: 'live',
          useAuth: true,
        },
      }),
      createLogicNode({
        id: 'n-json',
        type: 'network.json',
        x: 520,
        y: 40,
        data: { mode: 'get-field', path: 'user.name' },
      }),
      createLogicNode({
        id: 'n-set-loading',
        type: 'action.set-layer',
        x: 520,
        y: 220,
        data: { targetMode: 'override', targetNodeId: statusTxt.id, property: 'text', text: 'Loading...' },
      }),
      createLogicNode({
        id: 'n-set-ok',
        type: 'action.set-layer',
        x: 760,
        y: 40,
        data: { targetMode: 'override', targetNodeId: outTxt.id, property: 'text', text: 'Fallback' },
      }),
      createLogicNode({
        id: 'n-set-err',
        type: 'action.set-layer',
        x: 760,
        y: 160,
        data: { targetMode: 'override', targetNodeId: statusTxt.id, property: 'text', text: 'Request Failed' },
      }),
    ],
    connections: [
      createLogicConnection({
        id: 'c-click-http',
        sourceNodeId: 'n-click',
        sourcePortId: 'exec',
        targetNodeId: 'n-http',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-http-loading',
        sourceNodeId: 'n-http',
        sourcePortId: 'loading',
        targetNodeId: 'n-set-loading',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-http-success',
        sourceNodeId: 'n-http',
        sourcePortId: 'success',
        targetNodeId: 'n-set-ok',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-http-error',
        sourceNodeId: 'n-http',
        sourcePortId: 'error',
        targetNodeId: 'n-set-err',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-http-data-json',
        sourceNodeId: 'n-http',
        sourcePortId: 'data',
        targetNodeId: 'n-json',
        targetPortId: 'input',
      }),
      createLogicConnection({
        id: 'c-json-out',
        sourceNodeId: 'n-json',
        sourcePortId: 'result',
        targetNodeId: 'n-set-ok',
        targetPortId: 'value',
      }),
    ],
  });

  const page: FolioPage = {
    ...basePage,
    document: { ...basePage.document, nodes: [btn, statusTxt, outTxt] },
  };
  const project: FolioProject = {
    ...base,
    pages: [page],
    logicGraphs: [graph],
  };
  return { project, page, btnId: btn.id, statusId: statusTxt.id, outputId: outTxt.id };
}

function makeLiveExternalDataProject(): {
  project: FolioProject;
  page: FolioPage;
  countId: string;
} {
  const base = createInitialProject('Live External Data Project');
  const basePage = base.pages[0];
  const countTxt = { ...createTextNode(0), id: 'txt-count', name: 'Count', text: '0' };

  const graph = createLogicGraph({
    id: 'graph-ext-live',
    name: 'External Live Graph',
    scope: 'page',
    targetId: basePage.id,
    networkSettings: {
      baseUrl: 'https://cms.example.com',
      globalHeaders: JSON.stringify({ Accept: 'application/json' }),
      authSecretRef: 'CMS_TOKEN',
    },
    nodes: [
      createLogicNode({
        id: 'n-ext',
        type: 'source.external',
        x: 40,
        y: 60,
        data: {
          sourceKind: 'api',
          endpoint: '/posts',
          query: 'limit=3',
          executionMode: 'live',
          useAuth: true,
        },
      }),
      createLogicNode({
        id: 'n-set-count',
        type: 'action.set-layer',
        x: 320,
        y: 60,
        data: { targetMode: 'override', targetNodeId: countTxt.id, property: 'text', text: '0' },
      }),
    ],
    connections: [
      createLogicConnection({
        id: 'c-ext-ready',
        sourceNodeId: 'n-ext',
        sourcePortId: 'onReady',
        targetNodeId: 'n-set-count',
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'c-ext-count',
        sourceNodeId: 'n-ext',
        sourcePortId: 'count',
        targetNodeId: 'n-set-count',
        targetPortId: 'value',
      }),
    ],
  });

  const page: FolioPage = {
    ...basePage,
    document: { ...basePage.document, nodes: [countTxt] },
  };
  const project: FolioProject = {
    ...base,
    pages: [page],
    logicGraphs: [graph],
  };
  return { project, page, countId: countTxt.id };
}

function runPreviewScriptInMockEnv(
  script: string,
  ids: readonly string[],
  options: {
    readonly sandboxedParentBridge?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
    readonly fetchMock?: (url: string, init?: RequestInit) => Promise<Response>;
  },
) {
  const elements = new Map<string, {
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
  }>();

  for (const id of ids) {
    elements.set(id, {
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
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
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
    });
  }

  const winListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const mockWindow: Record<string, unknown> = {
    location: {
      origin: options.sandboxedParentBridge ? 'null' : 'https://folio.example.com',
      href: options.sandboxedParentBridge ? 'about:srcdoc' : 'https://folio.example.com/',
      hash: '',
    },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      if (!winListeners[type]) winListeners[type] = [];
      winListeners[type].push(cb);
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  if (options.sandboxedParentBridge) {
    const bridgeHandler = options.sandboxedParentBridge;
    mockWindow.parent = {
      postMessage(msg: { type?: string; requestId?: string; payload?: Record<string, unknown> }) {
        if (msg?.type === 'folio:http-proxy-request' && typeof msg.requestId === 'string') {
          const requestId = msg.requestId;
          void bridgeHandler(msg.payload ?? {}).then((result) => {
            for (const cb of winListeners.message ?? []) {
              cb({ data: { type: 'folio:http-proxy-response', requestId, result } });
            }
          });
        }
      },
    };
  } else {
    mockWindow.parent = mockWindow;
  }

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      offsetWidth: 1440,
      classList: { add: () => {}, remove: () => {}, has: () => false },
      setAttribute: () => {},
      removeAttribute: () => {},
      getAttribute: () => null,
    },
    body: {
      appendChild: () => {},
      style: {},
    },
    querySelectorAll: (sel: string) => (sel === '[data-folio-id]' ? Array.from(elements.values()) : []),
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({
      textContent: '',
      style: {},
      setAttribute: () => {},
      remove: () => {},
    }),
  };

  const runner = new Function('window', 'document', 'fetch', script) as (
    w: unknown,
    d: unknown,
    f: unknown,
  ) => void;
  runner(mockWindow, mockDocument, options.fetchMock ?? (() => Promise.reject(new Error('fetch not configured'))));

  return { elements };
}

afterEach(() => {
  clearProxyJwksCache();
  vi.restoreAllMocks();
});

describe('Cloudflare Pages Function & Web-Standards Compatibility', () => {
  it('uses zero Node.js built-in module imports in shared proxy handler and Pages Function', () => {
    const nodeImportPattern = /\bfrom\s+['"](?:node:|fs|path|http|https|net|dns|crypto|buffer|stream|url)['"]|require\s*\(/;
    expect(proxyHandlerSource).not.toMatch(nodeImportPattern);
    expect(cfFunctionSource).not.toMatch(nodeImportPattern);
  });

  it('handles POST JSON, OPTIONS 204, non-POST 405, invalid JSON 400, and oversized envelope 413 with strict headers', async () => {
    const optResp = await onRequestOptions({
      request: new Request('https://studio.example.com/api/logic/http-proxy', { method: 'OPTIONS' }),
      env: {},
    });
    expect(optResp.status).toBe(204);
    expect(optResp.headers.get('cache-control')).toBe('no-store');
    expect(optResp.headers.get('x-content-type-options')).toBe('nosniff');

    const getResp = await onRequest({
      request: new Request('https://studio.example.com/api/logic/http-proxy', { method: 'GET' }),
      env: {},
    });
    expect(getResp.status).toBe(405);
    const getBody = (await getResp.json()) as { ok: boolean; error: string };
    expect(getBody.ok).toBe(false);
    expect(getBody.error).toMatch(/POST/i);

    const badJsonResp = await onRequestPost({
      request: new Request('https://studio.example.com/api/logic/http-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      }),
      env: {},
    });
    expect(badJsonResp.status).toBe(400);
    expect(badJsonResp.headers.get('cache-control')).toBe('no-store');
    expect(badJsonResp.headers.get('x-content-type-options')).toBe('nosniff');

    const hugeEnvelope = JSON.stringify({ url: 'https://api.example.com', body: 'x'.repeat(MAX_PROXY_ENVELOPE_BYTES + 128) });
    const hugeResp = await onRequestPost({
      request: new Request('https://studio.example.com/api/logic/http-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugeEnvelope,
      }),
      env: { FOLIO_PROXY_AUTH_TOKEN: 't', FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
    });
    expect(hugeResp.status).toBe(413);
  });

  it('executes an authenticated POST request through handleHttpProxyWebRequest and returns JSON with no-store', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ hello: 'cloudflare' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const req = new Request('https://studio.example.com/api/logic/http-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Folio-Proxy-Auth': 'backend-secret-token',
      },
      body: JSON.stringify({ url: 'https://api.example.com/ping', method: 'GET' }),
    });
    const resp = await handleHttpProxyWebRequest(
      req,
      {
        FOLIO_PROXY_AUTH_TOKEN: 'backend-secret-token',
        FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com',
      },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get('cache-control')).toBe('no-store');
    expect(resp.headers.get('x-content-type-options')).toBe('nosniff');
    const json = (await resp.json()) as { ok: boolean; status: number; data: { hello: string } };
    expect(json.ok).toBe(true);
    expect(json.status).toBe(200);
    expect(json.data).toEqual({ hello: 'cloudflare' });
  });
});

describe('HTTP Proxy Security — Authentication, Secrets, Allowlist, SSRF & Limits', () => {
  it('fails closed when no backend authentication is configured and NEVER trusts Origin or Sec-Fetch-Site alone', async () => {
    const spoofedHeaders = {
      Origin: 'https://studio.example.com',
      'Sec-Fetch-Site': 'same-origin',
      Referer: 'https://studio.example.com/',
    };
    const fetchMock = vi.fn();

    const noAuthPublic = await executeServerHttpProxy(
      { url: 'https://api.example.com/items', method: 'GET' },
      {
        env: { FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
        requestHeaders: spoofedHeaders,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(noAuthPublic.httpStatus).toBe(401);
    expect(noAuthPublic.body.ok).toBe(false);
    expect(noAuthPublic.body.error).toMatch(/authentication/i);
    expect(fetchMock).not.toHaveBeenCalled();

    // Even if FOLIO_PROXY_ALLOW_UNAUTHENTICATED_PUBLIC=true, authSecretRef MUST STILL be rejected!
    const secretWithoutAuth = await executeServerHttpProxy(
      { url: 'https://api.example.com/items', method: 'GET', authSecretRef: 'API_TOKEN' },
      {
        env: {
          FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com',
          FOLIO_PROXY_ALLOW_UNAUTHENTICATED_PUBLIC: 'true',
          FOLIO_SECRET_API_TOKEN: 'super_secret_value_never_leak',
        },
        requestHeaders: spoofedHeaders,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(secretWithoutAuth.httpStatus).toBe(401);
    expect(secretWithoutAuth.body.ok).toBe(false);
    expect(secretWithoutAuth.body.error).toMatch(/Server-side secrets require backend authentication/i);
    expect(JSON.stringify(secretWithoutAuth)).not.toContain('super_secret_value_never_leak');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies real Cloudflare Access RS256 JWT (header & cookie) and rejects forged/expired/wrong-aud/wrong-iss tokens', async () => {
    const { publicJwk, signJwt } = await createTestRsaJwtFixture();
    const nowSec = Math.floor(Date.now() / 1000);
    const teamDomain = 'myteam.cloudflareaccess.com';
    const aud = 'cf-aud-tag-12345';

    const jwksFetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const upstreamFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const env = {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: aud,
      FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com',
      FOLIO_SECRET_API_TOKEN: 'cf_verified_secret_xyz',
    };

    const validJwt = await signJwt({
      aud: [aud],
      iss: `https://${teamDomain}`,
      exp: nowSec + 300,
      iat: nowSec - 10,
      sub: 'user-1',
    });

    const okViaHeader = await executeServerHttpProxy(
      { url: 'https://api.example.com/private', method: 'GET', authSecretRef: 'API_TOKEN' },
      {
        env,
        requestHeaders: { 'Cf-Access-Jwt-Assertion': validJwt },
        jwksFetchImpl: jwksFetch as unknown as typeof fetch,
        fetchImpl: upstreamFetch as unknown as typeof fetch,
      },
    );
    expect(okViaHeader.httpStatus).toBe(200);
    expect(okViaHeader.body.ok).toBe(true);
    const sentInit = (upstreamFetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((sentInit.headers as Record<string, string>).Authorization).toBe('Bearer cf_verified_secret_xyz');

    // Cookie authentication also works
    const okViaCookie = await executeServerHttpProxy(
      { url: 'https://api.example.com/private', method: 'GET' },
      {
        env,
        requestHeaders: { Cookie: `foo=bar; CF_Authorization=${validJwt}` },
        jwksFetchImpl: jwksFetch as unknown as typeof fetch,
        fetchImpl: upstreamFetch as unknown as typeof fetch,
      },
    );
    expect(okViaCookie.httpStatus).toBe(200);

    // Wrong audience rejected
    const wrongAudJwt = await signJwt({ aud: ['other-aud'], iss: `https://${teamDomain}`, exp: nowSec + 300 });
    const badAudRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/private', method: 'GET' },
      {
        env,
        requestHeaders: { 'Cf-Access-Jwt-Assertion': wrongAudJwt },
        jwksFetchImpl: jwksFetch as unknown as typeof fetch,
        fetchImpl: upstreamFetch as unknown as typeof fetch,
      },
    );
    expect(badAudRes.httpStatus).toBe(401);

    // Expired JWT rejected
    const expiredJwt = await signJwt({ aud: [aud], iss: `https://${teamDomain}`, exp: nowSec - 600 });
    const expRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/private', method: 'GET' },
      {
        env,
        requestHeaders: { 'Cf-Access-Jwt-Assertion': expiredJwt },
        jwksFetchImpl: jwksFetch as unknown as typeof fetch,
        fetchImpl: upstreamFetch as unknown as typeof fetch,
      },
    );
    expect(expRes.httpStatus).toBe(401);

    // Tampered signature rejected
    const parts = validJwt.split('.');
    const tamperedJwt = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}AAAA`;
    const tamperedRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/private', method: 'GET' },
      {
        env,
        requestHeaders: { 'Cf-Access-Jwt-Assertion': tamperedJwt },
        jwksFetchImpl: jwksFetch as unknown as typeof fetch,
        fetchImpl: upstreamFetch as unknown as typeof fetch,
      },
    );
    expect(tamperedRes.httpStatus).toBe(401);
  });

  it('rejects wildcard allowlist entries and enforces exact + leading-dot subdomain boundary matching', async () => {
    expect(parseAllowedHostsConfig('*').ok).toBe(false);
    expect(parseAllowedHostsConfig('*.*').ok).toBe(false);
    expect(parseAllowedHostsConfig('*.example.com').ok).toBe(false);
    expect(parseAllowedHostsConfig('api.example.com,*').ok).toBe(false);
    expect(parseAllowedHostsConfig('localhost').ok).toBe(false);
    expect(parseAllowedHostsConfig('127.0.0.1').ok).toBe(false);

    const parsed = parseAllowedHostsConfig('api.github.com, .example.com');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(isHostAllowedByRules('api.github.com', parsed.rules)).toBe(true);
      expect(isHostAllowedByRules('api.example.com', parsed.rules)).toBe(true);
      expect(isHostAllowedByRules('v2.api.example.com', parsed.rules)).toBe(true);
      expect(isHostAllowedByRules('evil-example.com', parsed.rules)).toBe(false);
      expect(isHostAllowedByRules('example.com.evil.com', parsed.rules)).toBe(false);
      expect(isHostAllowedByRules('example.com', parsed.rules)).toBe(false);
    }

    const wildcardRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/data', method: 'GET' },
      {
        env: { FOLIO_PROXY_AUTH_TOKEN: 'tok', FOLIO_PROXY_ALLOWED_HOSTS: '*' },
        requestHeaders: { 'X-Folio-Proxy-Auth': 'tok' },
      },
    );
    expect(wildcardRes.httpStatus).toBe(500);
    expect(wildcardRes.body.error).toMatch(/wildcards/i);

    const disallowedRes = await executeServerHttpProxy(
      { url: 'https://not-allowed.org/data', method: 'GET' },
      {
        env: { FOLIO_PROXY_AUTH_TOKEN: 'tok', FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
        requestHeaders: { 'X-Folio-Proxy-Auth': 'tok' },
      },
    );
    expect(disallowedRes.httpStatus).toBe(403);
  });

  it('restricts server secret injection strictly to allowed secret hosts, fails on missing secret, and never logs tokens', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const SECRET = 'folio_ultra_secret_bearer_998877';
    const env = {
      FOLIO_PROXY_AUTH_TOKEN: 'proxy_tok_123',
      FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com,other.example.org',
      FOLIO_SECRET_API_TOKEN: SECRET,
      FOLIO_SECRET_API_TOKEN_HOSTS: 'api.example.com',
    };

    // Trying to send API_TOKEN to other.example.org MUST be rejected (403) even though other.example.org is in global allowlist!
    const crossHostRes = await executeServerHttpProxy(
      { url: 'https://other.example.org/steal', method: 'GET', authSecretRef: 'API_TOKEN' },
      {
        env,
        requestHeaders: { 'X-Folio-Proxy-Auth': 'proxy_tok_123' },
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(crossHostRes.httpStatus).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    // Missing secret returns 503 with clear message
    const missingSecretRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/data', method: 'GET', authSecretRef: 'MISSING_KEY' },
      {
        env,
        requestHeaders: { 'X-Folio-Proxy-Auth': 'proxy_tok_123' },
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(missingSecretRes.httpStatus).toBe(503);
    expect(missingSecretRes.body.error).toMatch(/MISSING_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();

    // Permitted host gets Authorization: Bearer <SECRET>
    const allowedRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/data', method: 'GET', authSecretRef: 'API_TOKEN' },
      {
        env,
        requestHeaders: { 'X-Folio-Proxy-Auth': 'proxy_tok_123' },
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(allowedRes.httpStatus).toBe(200);
    const headersSent = ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers) as Record<string, string>;
    expect(headersSent.Authorization).toBe(`Bearer ${SECRET}`);

    // Zero token leakage in response or console
    expect(JSON.stringify(allowedRes)).not.toContain(SECRET);
    expect(JSON.stringify(crossHostRes)).not.toContain(SECRET);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(SECRET);
  });

  it('blocks localhost, private/link-local/metadata/IPv6/obfuscated IPs, DNS rebinding, and HTTP redirects', async () => {
    const blockedUrls = [
      'http://localhost/admin',
      'http://localhost./admin',
      'http://127.0.0.1/admin',
      'http://10.0.0.1/internal',
      'http://172.16.0.1/internal',
      'http://192.168.1.1/router',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/loopback',
      'http://[0:0:0:0:0:0:0:1]/loopback',
      'http://[::ffff:127.0.0.1]/mapped',
      'http://[::ffff:169.254.169.254]/meta',
      'http://[64:ff9b::127.0.0.1]/nat64',
      'http://[fd00:ec2::254]/aws-v6',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.azure.com/metadata/instance',
      'http://host.docker.internal/secret',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'file:///etc/passwd',
      'https://user:pass@api.example.com/secret',
    ];
    for (const badUrl of blockedUrls) {
      const check = validateProxyTargetUrl(badUrl);
      expect(check.ok, `Expected SSRF URL to be blocked: ${badUrl}`).toBe(false);
    }

    expect(isPrivateOrReservedIp('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('fd00:ec2::254')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);

    // DNS rebinding to metadata IP blocked
    const rebindRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/data', method: 'GET' },
      {
        env: { FOLIO_PROXY_AUTH_TOKEN: 'tok', FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
        requestHeaders: { 'X-Folio-Proxy-Auth': 'tok' },
        dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
      },
    );
    expect(rebindRes.httpStatus).toBe(403);
    expect(rebindRes.body.error).toMatch(/private or reserved/i);

    // Redirect 302 blocked
    const redirectFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );
    const redirectRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/redirect', method: 'GET' },
      {
        env: { FOLIO_PROXY_AUTH_TOKEN: 'tok', FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
        requestHeaders: { 'X-Folio-Proxy-Auth': 'tok' },
        fetchImpl: redirectFetch as unknown as typeof fetch,
      },
    );
    expect(redirectRes.httpStatus).toBe(403);
    expect(redirectRes.body.error).toMatch(/redirect/i);
    expect(((redirectFetch.mock.calls[0] as unknown as [string, RequestInit])[1]).redirect).toBe('manual');
  });

  it('handles JSON, non-JSON, upstream failures, request/response size limits, and timeouts cleanly', async () => {
    const baseOpts = {
      env: { FOLIO_PROXY_AUTH_TOKEN: 'tok', FOLIO_PROXY_ALLOWED_HOSTS: 'api.example.com' },
      requestHeaders: { 'X-Folio-Proxy-Auth': 'tok' },
    };

    // Non-JSON text/plain
    const textRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/plain', method: 'GET' },
      {
        ...baseOpts,
        fetchImpl: (async () =>
          new Response('plain text hello', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })) as unknown as typeof fetch,
      },
    );
    expect(textRes.httpStatus).toBe(200);
    expect(textRes.body.ok).toBe(true);
    expect(textRes.body.data).toBe('plain text hello');

    // Upstream HTTP 500
    const err500Res = await executeServerHttpProxy(
      { url: 'https://api.example.com/fail', method: 'GET' },
      {
        ...baseOpts,
        fetchImpl: (async () =>
          new Response(JSON.stringify({ message: 'Internal failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })) as unknown as typeof fetch,
      },
    );
    expect(err500Res.httpStatus).toBe(200);
    expect(err500Res.body.ok).toBe(false);
    expect(err500Res.body.status).toBe(500);
    expect(err500Res.body.error).toMatch(/500/);

    // Request body > 256 KiB -> 413
    const oversizedReq = await executeServerHttpProxy(
      { url: 'https://api.example.com/upload', method: 'POST', body: 'a'.repeat(MAX_REQUEST_BODY_BYTES + 16) },
      baseOpts,
    );
    expect(oversizedReq.httpStatus).toBe(413);

    // Response > 1 MiB -> 413
    const oversizedResp = await executeServerHttpProxy(
      { url: 'https://api.example.com/huge', method: 'GET' },
      {
        ...baseOpts,
        fetchImpl: (async () =>
          new Response('b'.repeat(MAX_RESPONSE_BYTES + 64), {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })) as unknown as typeof fetch,
      },
    );
    expect(oversizedResp.httpStatus).toBe(413);
    expect(oversizedResp.body.error).toMatch(/1 MiB/i);

    // Timeout -> 504
    const timeoutRes = await executeServerHttpProxy(
      { url: 'https://api.example.com/slow', method: 'GET' },
      {
        ...baseOpts,
        timeoutMs: 60,
        fetchImpl: ((_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          })) as unknown as typeof fetch,
      },
    );
    expect(timeoutRes.httpStatus).toBe(504);
    expect(timeoutRes.body.error).toMatch(/timed out/i);
  });
});

describe('Node Logic Live HTTP & External Data — Headless, Live Preview, and React Codegen Parity', () => {
  it('executes live network.http loading -> success and loading -> error in Headless Async Runtime with downstream data', async () => {
    const { project, btnId, statusId, outputId } = makeLiveHttpProject();
    const receivedRequests: Array<{ url: string; method?: string; headers?: Record<string, string>; authSecretRef?: string }> = [];

    // 1. Success path
    const runtimeOk = createPrototypeRuntime(project, {
      httpProxyExecutor: async (req) => {
        receivedRequests.push(req);
        return {
          status: 200,
          ok: true,
          contentType: 'application/json',
          data: { user: { name: 'Ada Lovelace' } },
          durationMs: 12,
        };
      },
    });
    const snapOk = await runtimeOk.dispatchNodeEventAsync(btnId, 'click');
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].url).toBe('https://api.example.com/v1/users');
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].headers?.['X-Client-App']).toBe('folio-test');
    expect(receivedRequests[0].authSecretRef).toBe('API_TOKEN');
    expect(snapOk.nodeOverrides[statusId]?.text).toBe('Loading...');
    expect(snapOk.nodeOverrides[outputId]?.text).toBe('Ada Lovelace');

    // 2. Error path
    const runtimeErr = createPrototypeRuntime(project, {
      httpProxyExecutor: async () => ({
        status: 500,
        ok: false,
        contentType: 'application/json',
        data: null,
        durationMs: 8,
        error: 'Upstream HTTP 500',
      }),
    });
    const snapErr = await runtimeErr.dispatchNodeEventAsync(btnId, 'click');
    expect(snapErr.nodeOverrides[statusId]?.text).toBe('Request Failed');
    expect(snapErr.nodeOverrides[outputId]?.text).toBeUndefined();
  });

  it('executes live network.http in Live Preview micro-runtime via BOTH sandboxed postMessage bridge and direct fetch', async () => {
    const { project, page, btnId, statusId, outputId } = makeLiveHttpProject();
    const script = buildLivePreviewLogicScript(project, page);
    expect(script).not.toBeNull();
    expect(script).toContain('/api/logic/http-proxy');
    expect(script).toContain('folio:http-proxy-request');

    // Sandboxed iframe bridge (LivePreviewPane mode)
    const bridgeCalls: Array<Record<string, unknown>> = [];
    const sandboxed = runPreviewScriptInMockEnv(script!, [btnId, statusId, outputId], {
      sandboxedParentBridge: async (payload) => {
        bridgeCalls.push(payload);
        return { status: 200, ok: true, contentType: 'application/json', data: { user: { name: 'Grace Hopper' } } };
      },
    });
    sandboxed.elements.get(btnId)?.dispatch('click');
    expect(sandboxed.elements.get(statusId)?.textContent).toBe('Loading...');
    await new Promise((r) => setTimeout(r, 15));
    expect(bridgeCalls).toHaveLength(1);
    expect(bridgeCalls[0].url).toBe('https://api.example.com/v1/users');
    expect(bridgeCalls[0].authSecretRef).toBe('API_TOKEN');
    expect(sandboxed.elements.get(outputId)?.textContent).toBe('Grace Hopper');

    // Direct fetch mode (exported HTML hosted alongside /api/logic/http-proxy) with error branch
    const direct = runPreviewScriptInMockEnv(script!, [btnId, statusId, outputId], {
      fetchMock: async () =>
        new Response(JSON.stringify({ status: 502, ok: false, data: null, error: 'Bad Gateway' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    direct.elements.get(btnId)?.dispatch('click');
    await new Promise((r) => setTimeout(r, 15));
    expect(direct.elements.get(statusId)?.textContent).toBe('Request Failed');
  });

  it('executes live source.external across Headless Async Runtime and Live Preview, and compiles clean React TSX', async () => {
    const { project, page, countId } = makeLiveExternalDataProject();

    // 1. Headless Async Runtime
    const rt = createPrototypeRuntime(project, {
      httpProxyExecutor: async (req) => {
        expect(req.url).toBe('https://cms.example.com/posts?limit=3');
        expect(req.authSecretRef).toBe('CMS_TOKEN');
        return {
          status: 200,
          ok: true,
          contentType: 'application/json',
          data: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
          durationMs: 10,
        };
      },
    });
    const snap = await rt.mountAsync();
    expect(snap.nodeOverrides[countId]?.text).toBe('3');

    // 2. Live Preview micro-runtime via sandboxed bridge
    const previewScript = buildLivePreviewLogicScript(project, page);
    expect(previewScript).not.toBeNull();
    const preview = runPreviewScriptInMockEnv(previewScript!, [countId], {
      sandboxedParentBridge: async () => ({
        status: 200,
        ok: true,
        contentType: 'application/json',
        data: { items: [{ id: 'a' }, { id: 'b' }] },
      }),
    });
    await new Promise((r) => setTimeout(r, 15));
    expect(preview.elements.get(countId)?.textContent).toBe('2');

    // 3. React Codegen emits real /api/logic/http-proxy call and compiles valid TypeScript/TSX
    const httpProject = makeLiveHttpProject();
    const httpPlan = buildReactPageLogicPlan(httpProject.project, httpProject.page);
    expect(httpPlan.hasLogic).toBe(true);
    const httpHooks = httpPlan.hookLines.join('\n');
    expect(httpHooks).toContain('logicHttpResponsesRef');
    expect(httpHooks).toContain('/api/logic/http-proxy');
    expect(httpHooks).toContain('"authSecretRef":"API_TOKEN"');

    const extPlan = buildReactPageLogicPlan(project, page);
    expect(extPlan.hasLogic).toBe(true);
    const extHooks = extPlan.hookLines.join('\n');
    expect(extHooks).toContain('/api/logic/http-proxy');
    expect(extHooks).toContain('logicExternalDataRef');

    const reactFiles = compileReactProjectFiles(httpProject.project);
    const tsxFiles = reactFiles.filter((f) => f.path.endsWith('.tsx') || f.path.endsWith('.ts'));
    expect(tsxFiles.length).toBeGreaterThan(0);
    for (const file of tsxFiles) {
      const transpiled = ts.transpileModule(file.content, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      expect(transpiled.diagnostics ?? [], `TSX syntax errors in ${file.path}`).toHaveLength(0);
    }
  });

  it('honestly marks network.socket as simulated and keeps source.context user-auth at guest defaults unless host auth is injected', () => {
    const base = createInitialProject('Honest Fallback Project');
    const basePage = base.pages[0];
    const label = { ...createTextNode(0), id: 'txt-role', name: 'Role', text: '' };
    const graph = createLogicGraph({
      id: 'graph-honest',
      name: 'Honest Graph',
      scope: 'page',
      targetId: basePage.id,
      nodes: [
        createLogicNode({ id: 'n-load', type: 'event.on-page-load', x: 10, y: 10, data: {} }),
        createLogicNode({ id: 'n-sock', type: 'network.socket', x: 140, y: 10, data: { url: 'wss://example.com/ws', action: 'connect' } }),
        createLogicNode({ id: 'n-ctx', type: 'source.context', x: 140, y: 120, data: { contextKind: 'user-auth', authField: 'role' } }),
        createLogicNode({ id: 'n-set', type: 'action.set-layer', x: 340, y: 120, data: { targetMode: 'override', targetNodeId: label.id, property: 'text', text: '' } }),
      ],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: 'n-load', sourcePortId: 'exec', targetNodeId: 'n-sock', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: 'n-load', sourcePortId: 'exec', targetNodeId: 'n-set', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: 'n-ctx', sourcePortId: 'value', targetNodeId: 'n-set', targetPortId: 'value' }),
      ],
    });
    const page: FolioPage = { ...basePage, document: { ...basePage.document, nodes: [label] } };
    const project: FolioProject = { ...base, pages: [page], logicGraphs: [graph] };

    const rtGuest = createPrototypeRuntime(project);
    const snapGuest = rtGuest.mount();
    const sockStep = snapGuest.trace.find((t) => t.nodeType === 'network.socket');
    expect(sockStep?.payload?.simulated).toBe(true);
    expect(sockStep?.payload?.connected).toBe(false);
    expect(snapGuest.nodeOverrides[label.id]?.text).toBe('guest');

    const rtAuthed = createPrototypeRuntime(project, {
      authContext: { isSignedIn: true, role: 'admin', email: 'ceo@example.com' },
    });
    const snapAuthed = rtAuthed.mount();
    expect(snapAuthed.nodeOverrides[label.id]?.text).toBe('admin');

    // Parity matrix accurately reflects live HTTP + External Data and simulated WebSocket
    const httpParity = NODE_RUNTIME_PARITY_MATRIX.find((e) => e.type === 'network.http');
    const extParity = NODE_RUNTIME_PARITY_MATRIX.find((e) => e.type === 'source.external');
    const sockParity = NODE_RUNTIME_PARITY_MATRIX.find((e) => e.type === 'network.socket');
    expect(httpParity?.headless).toBe('full');
    expect(httpParity?.livePreview).toBe('full');
    expect(httpParity?.reactCodegen).toBe('full');
    expect(extParity?.livePreview).toBe('full');
    expect(extParity?.reactCodegen).toBe('full');
    expect(sockParity?.notes).toMatch(/Simulated offline channel only/i);
  });
});

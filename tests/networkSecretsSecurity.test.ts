/**
 * Security Regression Suite — Phase 1 (P0):
 * Proves that raw credentials inside `globalHeaders`, `authSecretRef`, legacy
 * `authToken`, embedded URL userinfo, or network node fields NEVER leak into:
 * 1. `.flop` JSON serialization (`serializeProjectToFlopJson`) & migrations (`migrateProjectToV2`)
 * 2. IndexedDB persisted records (`saveProject`, `saveProjectAndActivate`, `saveProjectIfRevisionCurrent`, `withProjectWriteLock`)
 * 3. Live Preview payloads (`buildLivePreviewHtml`, `buildLivePreviewLogicScript`)
 * 4. Code Export outputs (HTML/CSS, React TSX, and runnable ZIP archives)
 * 5. Project export snapshots (`createProjectExportSnapshot`)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import {
  containsRawSecretPattern,
  detectInlineSecretHeaders,
  hasEmbeddedUrlCredentials,
  sanitizeGlobalHeadersForPersistence,
  sanitizeNetworkSettingsForPersistence,
  sanitizeProjectNetworkSecrets,
  sanitizeUrlCredentials,
} from '../src/core/document/networkSecrets';
import type { FolioProject, LogicGraph } from '../src/core/document/types';
import {
  saveProject,
  saveProjectAndActivate,
  saveProjectIfRevisionCurrent,
  withProjectWriteLock,
} from '../src/core/persistence/indexedDb';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { createProjectExportSnapshot } from '../src/app/projectExport';
import {
  buildCompiledProjectBundle,
  buildLivePreviewHtml,
  compileFolioProject,
  parseZipArchive,
} from '../src/engines/codegen';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  buildLivePreviewLogicScript,
  buildReactPageLogicPlan,
} from '../src/engines/prototype/codegen';
import { createLogicGraph, createLogicNode } from '../src/engines/prototype/catalog';
import {
  createLogicFramePresetFromFrame,
  loadStoredLogicFramePresets,
  saveStoredLogicFramePresets,
} from '../src/engines/prototype/frames';
import { createPrototypeRuntime } from '../src/engines/prototype/runtime';
import { validateLogicGraphSemantics } from '../src/engines/prototype/validator';

const RAW_SECRETS = {
  bearer: 'Bearer live_bearer_secret_99182736',
  proxyBasic: 'Basic cHJveHl1c2VyOnByb3h5cGFzczk5',
  apiKey: 'secret-x-api-key-value-4455',
  altApiKey: 'secret-api-key-value-6677',
  authToken: 'secret-x-auth-token-8899',
  cookie: 'sessionid=ultra_secret_cookie_3311; HttpOnly',
  setCookie: 'auth=ultra_secret_set_cookie_2244; Secure',
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureSecretXYZ',
  stripeLike: 'sk-live-9876543210abcdef1234',
  githubPat: 'ghp_SecretTokenValue1234567890abcd',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  authSecretRefRaw: 'Bearer raw-secret-ref-leak-7744',
  urlPassword: 'url_embedded_password_5511',
  nodeHeaderSecret: 'Bearer node_http_header_secret_1122',
  nodeBodySecret: 'sk-proj-node_body_secret_33445566',
  nodeLegacyToken: 'legacy_node_auth_token_6677',
  externalHeaderSecret: 'xoxb-slack-secret-token-99887766',
} as const;

const ALL_RAW_SECRET_FRAGMENTS: readonly string[] = [
  'live_bearer_secret_99182736',
  'cHJveHl1c2VyOnByb3h5cGFzczk5',
  'secret-x-api-key-value-4455',
  'secret-api-key-value-6677',
  'secret-x-auth-token-8899',
  'ultra_secret_cookie_3311',
  'ultra_secret_set_cookie_2244',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'sk-live-9876543210abcdef1234',
  'ghp_SecretTokenValue1234567890abcd',
  'AKIAIOSFODNN7EXAMPLE',
  'raw-secret-ref-leak-7744',
  'url_embedded_password_5511',
  'node_http_header_secret_1122',
  'sk-proj-node_body_secret_33445566',
  'legacy_node_auth_token_6677',
  'xoxb-slack-secret-token-99887766',
];

function buildSecretLadenProject(): { project: FolioProject; graph: LogicGraph } {
  const base = createInitialProject('Security Audit Project');
  const pageId = base.pages[0].id;

  const poisonedHeaders = JSON.stringify({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    AUTHORIZATION: RAW_SECRETS.bearer,
    'Proxy-Authorization': RAW_SECRETS.proxyBasic,
    'x-api-key': RAW_SECRETS.apiKey,
    'API-KEY': RAW_SECRETS.altApiKey,
    'X-Auth-Token': RAW_SECRETS.authToken,
    Cookie: RAW_SECRETS.cookie,
    'Set-Cookie': RAW_SECRETS.setCookie,
    'X-Custom-JWT': RAW_SECRETS.jwt,
    'X-Vendor-Key': RAW_SECRETS.stripeLike,
    'X-GitHub-Header': RAW_SECRETS.githubPat,
    'X-Aws-Header': RAW_SECRETS.awsKey,
    'X-Safe-Placeholder': 'Bearer env:ALLOWED_RUNTIME_TOKEN',
  });

  const httpNode = createLogicNode({
    id: 'node-http-sec',
    type: 'network.http',
    x: 120,
    y: 120,
    data: {
      method: 'POST',
      url: `https://apiuser:${RAW_SECRETS.urlPassword}@api.example.com/orders`,
      headers: JSON.stringify({
        'Content-Type': 'application/json',
        Authorization: RAW_SECRETS.nodeHeaderSecret,
        'X-Client': 'folio-web',
      }),
      body: `{"token":"${RAW_SECRETS.nodeBodySecret}"}`,
      authToken: RAW_SECRETS.nodeLegacyToken,
    },
  });

  const externalNode = createLogicNode({
    id: 'node-external-sec',
    type: 'source.external',
    x: 420,
    y: 120,
    data: {
      endpoint: `https://extuser:${RAW_SECRETS.urlPassword}@data.example.com/feed`,
      headers: JSON.stringify({
        'X-Slack-Auth': RAW_SECRETS.externalHeaderSecret,
        Accept: 'application/json',
      }),
    },
  });

  const graph = createLogicGraph({
    id: 'graph-sec-audit',
    name: 'Security Audit Graph',
    scope: 'page',
    targetId: pageId,
    networkSettings: {
      baseUrl: `https://svcuser:${RAW_SECRETS.urlPassword}@api.example.com/v1`,
      globalHeaders: poisonedHeaders,
      authSecretRef: RAW_SECRETS.authSecretRefRaw,
    },
    nodes: [httpNode, externalNode],
  });

  const project: FolioProject = {
    ...base,
    logicGraphs: [graph],
  };

  return { project, graph };
}

function assertContainsZeroSecrets(output: string, channelName: string): void {
  for (const fragment of ALL_RAW_SECRET_FRAGMENTS) {
    expect(
      output,
      `Expected ${channelName} to never contain secret fragment "${fragment}"`,
    ).not.toContain(fragment);
  }
}

interface CapturedIndexedDb {
  readonly records: Map<string, Map<string, unknown>>;
  restore: () => void;
}

function installFakeIndexedDb(): CapturedIndexedDb {
  const originalIndexedDb = globalThis.indexedDB;
  const stores = new Map<string, Map<string, unknown>>();

  const fakeDb = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return {};
    },
    transaction: (_names: string | string[]) => {
      const tx: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        onabort: (() => void) | null;
        error: DOMException | null;
        abort: () => void;
        objectStore: (name: string) => {
          put: (value: unknown) => Record<string, unknown>;
          get: (key: string) => Record<string, unknown>;
          getAll: () => Record<string, unknown>;
          delete: (key: string) => Record<string, unknown>;
        };
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        abort: () => {
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore: (name: string) => {
          if (!stores.has(name)) stores.set(name, new Map());
          const store = stores.get(name)!;
          return {
            put: (value: unknown) => {
              const rec = value as { key?: string; metadata?: { id?: string } };
              const recordKey = rec.key ?? rec.metadata?.id ?? 'unknown';
              store.set(recordKey, structuredClone(value));
              return {};
            },
            get: (key: string) => {
              const req: { result?: unknown; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                req.result = store.get(key) ?? null;
                req.onsuccess?.();
              });
              return req;
            },
            getAll: () => {
              const req: { result?: unknown[]; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                req.result = Array.from(store.values());
                req.onsuccess?.();
              });
              return req;
            },
            delete: (key: string) => {
              store.delete(key);
              return {};
            },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close: () => undefined,
  };

  const fakeFactory = {
    open: () => {
      const req: {
        result: typeof fakeDb;
        error: null;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: fakeFactory,
  });

  return {
    records: stores,
    restore: () => {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
    },
  };
}

describe('P0 Security Hardening — Centralized globalHeaders & Network Secret Sanitization', () => {
  let activeFakeDb: CapturedIndexedDb | null = null;

  afterEach(() => {
    activeFakeDb?.restore();
    activeFakeDb = null;
  });

  it('detects and hard-gates sensitive headers (case-insensitive), raw token patterns, and malformed secret strings', () => {
    const rawHeaders = JSON.stringify({
      Accept: 'application/json',
      AUTHORIZATION: RAW_SECRETS.bearer,
      'Proxy-Authorization': RAW_SECRETS.proxyBasic,
      'x-api-key': RAW_SECRETS.apiKey,
      'API-KEY': RAW_SECRETS.altApiKey,
      'X-Auth-Token': RAW_SECRETS.authToken,
      Cookie: RAW_SECRETS.cookie,
      'Set-Cookie': RAW_SECRETS.setCookie,
      'X-Arbitrary-JWT': RAW_SECRETS.jwt,
      'X-Arbitrary-Stripe': RAW_SECRETS.stripeLike,
      'X-Arbitrary-GitHub': RAW_SECRETS.githubPat,
      'X-Arbitrary-AWS': RAW_SECRETS.awsKey,
    });

    const flagged = detectInlineSecretHeaders(rawHeaders);
    expect(flagged).toEqual(
      expect.arrayContaining([
        'AUTHORIZATION',
        'Proxy-Authorization',
        'x-api-key',
        'API-KEY',
        'X-Auth-Token',
        'Cookie',
        'Set-Cookie',
        'X-Arbitrary-JWT',
        'X-Arbitrary-Stripe',
        'X-Arbitrary-GitHub',
        'X-Arbitrary-AWS',
      ]),
    );
    expect(flagged).not.toContain('Accept');

    const sanitized = sanitizeGlobalHeadersForPersistence(rawHeaders);
    expect(JSON.parse(sanitized)).toEqual({ Accept: 'application/json' });

    // Malformed / non-JSON secret strings fail closed
    expect(detectInlineSecretHeaders(`Authorization: ${RAW_SECRETS.bearer}`).length).toBeGreaterThan(0);
    expect(sanitizeGlobalHeadersForPersistence(`Authorization: ${RAW_SECRETS.bearer}`)).toBe('');
    expect(sanitizeGlobalHeadersForPersistence(`X-API-Key: ${RAW_SECRETS.apiKey}`)).toBe('');
    expect(sanitizeGlobalHeadersForPersistence(`raw ${RAW_SECRETS.jwt}`)).toBe('');
  });

  it('preserves safe non-sensitive headers and explicitly allowed env/template placeholders', () => {
    const safeHeaders = JSON.stringify({
      Accept: 'application/json',
      'X-App-Version': '2.1.0',
      Authorization: 'Bearer env:PUBLIC_PROXY_TOKEN',
      'Proxy-Authorization': 'Basic {{PROXY_CREDS}}',
      'X-API-Key': 'env:EDGE_API_KEY',
      'X-Auth-Token': '{{SESSION_REF}}',
    });

    expect(detectInlineSecretHeaders(safeHeaders)).toEqual([]);
    expect(sanitizeGlobalHeadersForPersistence(safeHeaders)).toBe(safeHeaders);
    expect(containsRawSecretPattern('Bearer env:PUBLIC_PROXY_TOKEN')).toBe(false);
    expect(containsRawSecretPattern('Basic {{PROXY_CREDS}}')).toBe(false);
    expect(containsRawSecretPattern('Token env:MY_TOKEN')).toBe(false);
    expect(containsRawSecretPattern(RAW_SECRETS.bearer)).toBe(true);
    expect(containsRawSecretPattern(RAW_SECRETS.jwt)).toBe(true);

    const sanitizedSettings = sanitizeNetworkSettingsForPersistence({
      baseUrl: 'https://api.example.com/v2',
      globalHeaders: safeHeaders,
      authSecretRef: 'env:API_TOKEN',
    });
    expect(sanitizedSettings).toEqual({
      baseUrl: 'https://api.example.com/v2',
      globalHeaders: safeHeaders,
      authSecretRef: 'API_TOKEN',
    });
  });

  it('strips embedded URL user:pass credentials while preserving clean URLs and relative paths', () => {
    expect(hasEmbeddedUrlCredentials('https://user:pass@api.example.com/v1')).toBe(true);
    expect(sanitizeUrlCredentials('https://user:pass@api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(hasEmbeddedUrlCredentials('https://api.example.com/v1')).toBe(false);
    expect(sanitizeUrlCredentials('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(sanitizeUrlCredentials('/api/orders')).toBe('/api/orders');
  });

  it('flags all raw secret violations consistently in the semantic validator', () => {
    const { project, graph } = buildSecretLadenProject();
    const report = validateLogicGraphSemantics(graph, project);
    const errorCodes = report.errors.map((e) => e.code);
    expect(report.ok).toBe(false);
    expect(errorCodes).toContain('UNSAFE_AUTH_SECRET_REF');
    expect(errorCodes).toContain('HARDCODED_SECRET_HEADER');
    expect(errorCodes).toContain('UNSAFE_NETWORK_URL_CREDENTIALS');
  });

  it('never leaks raw credentials into .flop JSON output or migrated projects', () => {
    const { project } = buildSecretLadenProject();

    const flopJson = serializeProjectToFlopJson(project);
    assertContainsZeroSecrets(flopJson, '.flop serialized JSON');
    const parsedFlop = JSON.parse(flopJson) as FolioProject;
    expect(
      JSON.parse(parsedFlop.logicGraphs[0].networkSettings?.globalHeaders ?? '{}'),
    ).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Safe-Placeholder': 'Bearer env:ALLOWED_RUNTIME_TOKEN',
    });
    expect(parsedFlop.logicGraphs[0].networkSettings?.baseUrl).toBe('https://api.example.com/v1');
    expect(parsedFlop.logicGraphs[0].networkSettings?.authSecretRef).toBe('');
    expect(flopJson).not.toContain('"authToken"');

    // Also verify raw imported `.flop` JSON passed through migrateProjectToV2 is sanitized
    const rawImported = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const migrated = migrateProjectToV2(rawImported);
    assertContainsZeroSecrets(JSON.stringify(migrated), 'migrateProjectToV2 result');
    expect(migrated.logicGraphs[0].networkSettings?.baseUrl).toBe('https://api.example.com/v1');
    expect(migrated.logicGraphs[0].networkSettings?.authSecretRef).toBe('');
  });

  it('never persists raw credentials into IndexedDB across all write entry points', async () => {
    activeFakeDb = installFakeIndexedDb();
    const { project } = buildSecretLadenProject();

    await saveProject(project);
    const savedRecord = activeFakeDb.records.get('projects')?.get(project.metadata.id) as FolioProject;
    const afterSave = JSON.stringify(savedRecord);
    assertContainsZeroSecrets(afterSave, 'IndexedDB saveProject');
    expect(
      JSON.parse(savedRecord.logicGraphs[0].networkSettings?.globalHeaders ?? '{}'),
    ).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Safe-Placeholder': 'Bearer env:ALLOWED_RUNTIME_TOKEN',
    });

    await saveProjectAndActivate(project);
    const afterActivate = JSON.stringify(activeFakeDb.records.get('projects')?.get(project.metadata.id));
    assertContainsZeroSecrets(afterActivate, 'IndexedDB saveProjectAndActivate');

    const fenced = await saveProjectIfRevisionCurrent(
      project,
      1,
      () => 1,
      () => () => undefined,
    );
    expect(fenced.status).toBe('saved');
    const afterFenced = JSON.stringify(activeFakeDb.records.get('projects')?.get(project.metadata.id));
    assertContainsZeroSecrets(afterFenced, 'IndexedDB saveProjectIfRevisionCurrent');

    await withProjectWriteLock(async (persist) => {
      await persist(project, 2);
    });
    const afterLock = JSON.stringify(activeFakeDb.records.get('projects')?.get(project.metadata.id));
    assertContainsZeroSecrets(afterLock, 'IndexedDB withProjectWriteLock');
  });

  it('never leaks raw credentials into Live Preview HTML or compiled preview logic scripts', () => {
    const { project } = buildSecretLadenProject();
    const activePage = project.pages[0];

    const previewHtml = buildLivePreviewHtml(project, {
      pageId: activePage.id,
      includeLogicRuntime: true,
    });
    assertContainsZeroSecrets(previewHtml, 'Live Preview HTML');

    const previewScript = buildLivePreviewLogicScript(project, activePage) ?? '';
    assertContainsZeroSecrets(previewScript, 'Live Preview Logic Script');
  });

  it('never leaks raw credentials into HTML/CSS export, React TSX export, ZIP bundles, or export snapshots', () => {
    const { project } = buildSecretLadenProject();
    const activePage = project.pages[0];

    // 1. Export snapshot
    const snapshot = createProjectExportSnapshot(project, null, project);
    assertContainsZeroSecrets(JSON.stringify(snapshot), 'createProjectExportSnapshot');

    // 2. HTML/CSS export
    const htmlExport = compileFolioProject(project, {
      target: 'html-css',
      includeAllPages: true,
    });
    const htmlJoined = htmlExport.files.map((f) => `${f.path}\n${f.content}`).join('\n');
    assertContainsZeroSecrets(htmlJoined, 'HTML/CSS export');

    // 3. React TSX export & logic plan
    const reactExport = compileFolioProject(project, {
      target: 'react',
      includeAllPages: true,
    });
    const reactJoined = reactExport.files.map((f) => `${f.path}\n${f.content}`).join('\n');
    assertContainsZeroSecrets(reactJoined, 'React TSX export');

    const reactFilesDirect = compileReactProjectFiles(project, activePage.id);
    assertContainsZeroSecrets(
      reactFilesDirect.map((f) => f.content).join('\n'),
      'compileReactProjectFiles',
    );

    const reactPlan = buildReactPageLogicPlan(project, activePage);
    assertContainsZeroSecrets(reactPlan.hookLines.join('\n'), 'buildReactPageLogicPlan');

    // 4. ZIP bundles (both HTML/CSS and React TSX)
    const decoder = new TextDecoder();
    for (const target of ['html-css', 'react'] as const) {
      const bundle = buildCompiledProjectBundle(project, { target });
      const parsedEntries = parseZipArchive(bundle.zipBytes);
      const bundleText = parsedEntries
        .map((entry) => `${entry.path}\n${decoder.decode(entry.data)}`)
        .join('\n');
      assertContainsZeroSecrets(bundleText, `ZIP bundle (${target})`);
    }
  });

  it('blocks multi-header malformed bypasses and nested JSON object/array secret bypasses', () => {
    // 1. Safe sensitive header first, raw sensitive header second in malformed/non-JSON string
    const multiLineBypass = `Authorization: Bearer env:SAFE_TOKEN\nX-API-Key: ${RAW_SECRETS.apiKey}`;
    expect(detectInlineSecretHeaders(multiLineBypass).length).toBeGreaterThan(0);
    expect(sanitizeGlobalHeadersForPersistence(multiLineBypass)).toBe('');

    const brokenJsonBypass = `{"Authorization": "Bearer env:SAFE_TOKEN", "Cookie": "${RAW_SECRETS.cookie}"`;
    expect(detectInlineSecretHeaders(brokenJsonBypass).length).toBeGreaterThan(0);
    expect(sanitizeGlobalHeadersForPersistence(brokenJsonBypass)).toBe('');

    // 2. Nested JSON object/array values hiding credentials under non-sensitive keys
    const nestedSecretHeaders = JSON.stringify({
      Accept: 'application/json',
      'X-Nested-Object': {
        Authorization: RAW_SECRETS.bearer,
      },
      'X-Nested-Array': [{ Cookie: RAW_SECRETS.cookie }],
      'X-Nested-Token': {
        deep: [RAW_SECRETS.jwt],
      },
    });
    const flaggedNested = detectInlineSecretHeaders(nestedSecretHeaders);
    expect(flaggedNested).toEqual(
      expect.arrayContaining(['X-Nested-Object', 'X-Nested-Array', 'X-Nested-Token']),
    );
    expect(flaggedNested).not.toContain('Accept');

    const sanitizedNested = sanitizeGlobalHeadersForPersistence(nestedSecretHeaders);
    expect(JSON.parse(sanitizedNested)).toEqual({ Accept: 'application/json' });
    assertContainsZeroSecrets(sanitizedNested, 'sanitized nested globalHeaders');
  });

  it('never leaks raw credentials through logicFramePresets in .flop, migrations, IndexedDB, or localStorage', async () => {
    activeFakeDb = installFakeIndexedDb();
    const { project, graph } = buildSecretLadenProject();
    const poisonedFrame = {
      id: 'frame-sec-1',
      title: 'Auth Fetch Frame',
      color: 'blue',
      bounds: { x: 80, y: 80, width: 480, height: 260 },
      childNodeIds: graph.nodes.map((n) => n.id),
      isBaked: false,
    };
    const graphWithFrame: LogicGraph = {
      ...graph,
      frames: [poisonedFrame],
    };

    // Preset created directly from a frame with secret-laden nodes must already be sanitized
    const createdPreset = createLogicFramePresetFromFrame(
      graphWithFrame,
      poisonedFrame,
      'Poisoned Preset',
      'Test preset',
    );
    assertContainsZeroSecrets(JSON.stringify(createdPreset), 'createLogicFramePresetFromFrame');

    // Manually construct an unsanitized preset on the project to test persistence hard gates
    const rawUnsanitizedPreset = {
      ...createdPreset,
      nodes: graph.nodes.map((n) => ({
        ...n,
        data: { ...n.data },
      })),
    };
    const projectWithRawPreset: FolioProject = {
      ...project,
      logicFramePresets: [rawUnsanitizedPreset],
    };

    const flopJson = serializeProjectToFlopJson(projectWithRawPreset);
    assertContainsZeroSecrets(flopJson, '.flop logicFramePresets');

    const migrated = migrateProjectToV2(JSON.parse(JSON.stringify(projectWithRawPreset)));
    assertContainsZeroSecrets(JSON.stringify(migrated), 'migrateProjectToV2 logicFramePresets');

    await saveProject(projectWithRawPreset);
    const saved = activeFakeDb.records.get('projects')?.get(projectWithRawPreset.metadata.id);
    assertContainsZeroSecrets(JSON.stringify(saved), 'IndexedDB logicFramePresets');

    // Verify localStorage preset helpers sanitize on both write and read
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: fakeStorage,
    });
    try {
      saveStoredLogicFramePresets([rawUnsanitizedPreset]);
      const storedRaw = Array.from(store.values()).join('\n');
      assertContainsZeroSecrets(storedRaw, 'localStorage saveStoredLogicFramePresets');

      // Even if localStorage was tampered with raw secrets directly, loadStoredLogicFramePresets sanitizes on load
      store.set('folio.nodeLogic.framePresets.v1', JSON.stringify([rawUnsanitizedPreset]));
      const loaded = loadStoredLogicFramePresets();
      expect(loaded).toHaveLength(1);
      assertContainsZeroSecrets(JSON.stringify(loaded), 'localStorage loadStoredLogicFramePresets');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: originalStorage,
      });
    }
  });

  it('hard-gates direct compilePageHtmlCss and headless runtime HTTP traces against embedded URL credentials', () => {
    const { project } = buildSecretLadenProject();
    const activePage = project.pages[0];

    const compiledHtmlCss = compilePageHtmlCss(project, activePage);
    assertContainsZeroSecrets(
      `${compiledHtmlCss.htmlFile.content}\n${compiledHtmlCss.cssFile.content}`,
      'compilePageHtmlCss direct output',
    );

    // Wire an event -> network.http connection so headless runtime executes the network node
    const targetNodeId = activePage.document.nodes[0]?.id ?? 'node-1';
    const triggerNode = createLogicNode({
      id: 'node-click-http',
      type: 'event.on-click',
      x: 20,
      y: 120,
      data: { targetNodeId },
    });
    const graph = project.logicGraphs[0];
    const wiredProject: FolioProject = {
      ...project,
      logicGraphs: [
        {
          ...graph,
          nodes: [triggerNode, ...graph.nodes],
          connections: [
            {
              id: 'conn-click-http',
              sourceNodeId: triggerNode.id,
              sourcePortId: 'flow',
              targetNodeId: 'node-http-sec',
              targetPortId: 'flow',
            },
          ],
        },
      ],
    };

    const runtime = createPrototypeRuntime(wiredProject, { pageId: activePage.id });
    const snapshot = runtime.dispatchNodeEvent(targetNodeId, 'click');
    assertContainsZeroSecrets(JSON.stringify(snapshot.trace), 'headless runtime HTTP trace');
    assertContainsZeroSecrets(JSON.stringify(runtime.getSnapshot()), 'headless runtime HTTP snapshot');
  });

  it('preserves referential equality in sanitizeProjectNetworkSecrets when a project is already clean', () => {
    const clean = createInitialProject('Clean Project');
    expect(sanitizeProjectNetworkSecrets(clean)).toBe(clean);
  });
});

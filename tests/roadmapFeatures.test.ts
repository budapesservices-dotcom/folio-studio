import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { buildComponentDefinitionFromNodes } from '../src/core/document/components';
import {
  canUseComponentInApplication,
  createApplicationWithHomePage,
  DEFAULT_APPLICATION_ID,
  getActiveApplication,
  getActiveApplicationId,
  getComponentScope,
  getPagesForApplication,
  getProjectApplications,
} from '../src/core/document/applications';
import { validateProject } from '../src/core/document/validation';
import {
  isZipArchiveBytes,
  parseFlopZipArchive,
  serializeProjectToFlopZip,
} from '../src/core/persistence/flopArchive';
import { readProjectFile, serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import {
  listSavedProjects,
  summarizeLocalProject,
} from '../src/core/persistence/indexedDb';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { evaluateComputedExpression } from '../src/engines/prototype/computedExpr';
import { createPrototypeRuntime } from '../src/engines/prototype/runtime';
import { buildLivePreviewLogicScript, buildReactPageLogicPlan } from '../src/engines/prototype/codegen';
import {
  NODE_RUNTIME_PARITY_MATRIX,
  RUNTIME_FEATURE_PARITY_MATRIX,
} from '../src/engines/prototype/parity';
import {
  isPrivateOrReservedIp,
  validateProxyTargetUrl,
} from '../src/server/httpProxyHandler';
import type { LogicGraph } from '../src/core/document/types';

describe('Feature 1 — variable.persist & variable.computed runtime execution', () => {
  it('evaluates arithmetic, ternary, boolean, string, and identifier expressions without eval', () => {
    const scope = { price: 25, qty: 4, discount: 10, firstName: 'Folio', vip: true };
    const evalOk = (expr: string) => {
      const res = evaluateComputedExpression(expr, scope, {});
      expect(res.ok).toBe(true);
      return res.ok ? res.value : undefined;
    };
    expect(evalOk('price * qty - discount')).toBe(90);
    expect(evalOk('vip ? price * qty : 0')).toBe(100);
    expect(evalOk('firstName + " Studio"')).toBe('Folio Studio');
    expect(evalOk('(price > 20) && !false')).toBe(true);
    expect(evalOk('round(10 / 3)')).toBe(3);
    expect(evalOk('upper(firstName)')).toBe('FOLIO');
  });

  it('rejects prototype access and dangerous constructs in computed expressions', () => {
    const scope = { count: 2 };
    expect(evaluateComputedExpression('constructor', scope, {}).ok).toBe(false);
    expect(evaluateComputedExpression('__proto__', scope, {}).ok).toBe(false);
    expect(evaluateComputedExpression('prototype', scope, {}).ok).toBe(false);
  });

  it('hydrates and saves variable.persist via storage adapter and recomputes variable.computed reactively', () => {
    const project = createInitialProject('Persist & Computed Test');
    const page = project.pages[0];
    const button = { ...createRectNode(0), name: 'Add' };
    page.document.nodes.push(button);

    const graph: LogicGraph = {
      id: 'graph-1',
      name: 'Cart Logic',
      scope: 'page',
      targetId: page.id,
      variables: [
        { id: 'v-qty', name: 'qty', valueType: 'number', initialValue: 1, persist: 'local' },
        { id: 'v-price', name: 'price', valueType: 'number', initialValue: 15 },
        {
          id: 'v-total',
          name: 'total',
          valueType: 'number',
          initialValue: 0,
          computed: true,
          computedExpression: 'qty * price',
        },
      ],
      nodes: [
        { id: 'ev-click', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: button.id } },
        {
          id: 'st-inc',
          type: 'state.update',
          x: 200,
          y: 0,
          data: { variableId: 'v-qty', operation: 'increment', step: 1 },
        },
      ],
      connections: [
        {
          id: 'c1',
          sourceNodeId: 'ev-click',
          sourcePortId: 'exec',
          targetNodeId: 'st-inc',
          targetPortId: 'exec',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    project.logicGraphs.push(graph);

    const localBacking = new Map<string, string>();
    const storageKey = 'folio:var:v-qty';
    localBacking.set(storageKey, JSON.stringify(3));

    const runtime = createPrototypeRuntime(project, {
      pageId: page.id,
      storage: {
        local: {
          getItem: (key: string) => localBacking.get(key) ?? null,
          setItem: (key: string, value: string) => {
            localBacking.set(key, value);
          },
        },
      },
    });
    expect(runtime.getSnapshot().variables['v-qty']).toBe(3);
    expect(runtime.getSnapshot().variables['v-total']).toBe(45);

    runtime.dispatchNodeEvent(button.id, 'click');
    expect(runtime.getSnapshot().variables['v-qty']).toBe(4);
    expect(runtime.getSnapshot().variables['v-total']).toBe(60);
    expect(JSON.parse(localBacking.get(storageKey)!)).toBe(4);
  });

  it('emits computed evaluator and storage persistence in Live Preview and React TSX codegen', () => {
    const project = createInitialProject('Codegen Parity Test');
    const page = project.pages[0];
    const btn = { ...createRectNode(0), name: 'Btn' };
    page.document.nodes.push(btn);
    project.logicGraphs.push({
      id: 'g-cg',
      name: 'Parity Graph',
      scope: 'page',
      targetId: page.id,
      variables: [
        { id: 'v1', name: 'count', valueType: 'number', initialValue: 2, persist: 'session' },
        {
          id: 'v2',
          name: 'doubled',
          valueType: 'number',
          initialValue: 4,
          computed: true,
          computedExpression: 'count * 2',
        },
      ],
      nodes: [
        { id: 'n1', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: btn.id } },
        { id: 'n2', type: 'state.update', x: 200, y: 0, data: { variableId: 'v1', operation: 'increment', step: 1 } },
      ],
      connections: [
        { id: 'c-cg-1', sourceNodeId: 'n1', sourcePortId: 'exec', targetNodeId: 'n2', targetPortId: 'exec' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const script = buildLivePreviewLogicScript(project, page);
    expect(script).toBeTruthy();
    expect(script).not.toContain('eval(');
    expect(script).toContain('sessionStorage');

    const reactPlan = buildReactPageLogicPlan(project, page);
    expect(reactPlan.hookLines.join('\n')).not.toContain('eval(');
    expect(reactPlan.hookLines.join('\n')).toContain('sessionStorage');

    const persistEntry = RUNTIME_FEATURE_PARITY_MATRIX.find((e) => e.feature === 'variable.persist');
    const computedEntry = RUNTIME_FEATURE_PARITY_MATRIX.find((e) => e.feature === 'variable.computed');
    expect(persistEntry?.headless).toBe('full');
    expect(computedEntry?.reactCodegen).toBe('full');
  });
});

describe('Feature 2 — 100% Free Offline Local Project Library (IndexedDB, Zero Firebase)', () => {
  it('summarizes project metadata accurately for the Local Project Library', () => {
    const project = createInitialProject('Offline Portfolio');
    const summary = summarizeLocalProject(project);
    expect(summary.id).toBe(project.metadata.id);
    expect(summary.name).toBe('Offline Portfolio');
    expect(summary.pageCount).toBe(project.pages.length);
    expect(summary.componentCount).toBe(project.components.length);
    expect(summary.applicationCount).toBeGreaterThanOrEqual(1);
    expect(summary.assetCount).toBe(project.assets.length);
  });

  it('gracefully returns an empty list when IndexedDB is unavailable in headless Node environments', async () => {
    const items = await listSavedProjects();
    expect(Array.isArray(items)).toBe(true);
  });

  it('has zero Firebase dependencies so the app remains 100% free and offline-first', () => {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    expect(deps.firebase).toBeUndefined();
    expect(devDeps['@firebase/eslint-plugin-security-rules']).toBeUndefined();
  });
});

describe('Feature 3 — Live HTTP Proxy SSRF protection & Live execution codegen', () => {
  it('blocks loopback, link-local, metadata, and RFC1918 private IPs/hosts', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });

  it('validates target URLs and rejects non-HTTP schemes, internal hosts, or embedded credentials', () => {
    expect(validateProxyTargetUrl('https://api.github.com/users/octocat').ok).toBe(true);
    expect(validateProxyTargetUrl('http://localhost:3000/api').ok).toBe(false);
    expect(validateProxyTargetUrl('http://metadata.google.internal/computeMetadata').ok).toBe(false);
    expect(validateProxyTargetUrl('http://127.0.0.1:8080/admin').ok).toBe(false);
    expect(validateProxyTargetUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateProxyTargetUrl('https://user:pass@api.github.com/').ok).toBe(false);
  });

  it('marks network.http and source.external as full in Live Preview & React TSX', () => {
    const httpEntry = NODE_RUNTIME_PARITY_MATRIX.find((e) => e.type === 'network.http');
    const extEntry = NODE_RUNTIME_PARITY_MATRIX.find((e) => e.type === 'source.external');
    expect(httpEntry?.livePreview).toBe('full');
    expect(httpEntry?.reactCodegen).toBe('full');
    expect(extEntry?.livePreview).toBe('full');
  });
});

describe('Feature 4 — Archive-based .flop ZIP container with binary asset extraction', () => {
  it('round-trips a project with embedded PNG data URL asset into ZIP and back losslessly', async () => {
    const project = createInitialProject('Archive Test');
    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0sQAAAAASUVORK5CYII=';
    project.assets.push({
      id: 'asset-hero-png',
      name: 'hero.png',
      kind: 'image',
      mimeType: 'image/png',
      source: tinyPngDataUrl,
      width: 1,
      height: 1,
      createdAt: new Date().toISOString(),
    });

    const zipBytes = serializeProjectToFlopZip(project);
    expect(isZipArchiveBytes(zipBytes)).toBe(true);

    const restored = parseFlopZipArchive(zipBytes);
    expect(restored.metadata.name).toBe('Archive Test');
    expect(restored.assets).toHaveLength(1);
    expect(restored.assets[0].source).toBe(tinyPngDataUrl);

    // Also verify readProjectFile auto-detects both ZIP and legacy JSON
    const zipBuffer = zipBytes.slice().buffer;
    const zipFile = new File([zipBuffer], 'archive-test.flop', { type: 'application/zip' });
    const loadedFromZip = await readProjectFile(zipFile);
    expect(loadedFromZip.metadata.id).toBe(project.metadata.id);
    expect(loadedFromZip.assets[0].source).toBe(tinyPngDataUrl);

    const jsonText = serializeProjectToFlopJson(project);
    const jsonFile = new File([jsonText], 'legacy-test.flop', { type: 'application/json' });
    const loadedFromJson = await readProjectFile(jsonFile);
    expect(loadedFromJson.metadata.id).toBe(project.metadata.id);
  });
});

describe('Feature 5 — Multi-Application projects & Global/Local Component Scoping', () => {
  it('creates multiple applications, switches active app, scopes components, and supports full undo/redo', () => {
    const project = createInitialProject('Multi-App Suite');
    const rect = { ...createRectNode(0), name: 'Nav Bar' };
    project.pages[0].document.nodes.push(rect);
    const comp = buildComponentDefinitionFromNodes(project.pages[0].document.nodes, [rect.id], 'Shared Header');
    expect(comp).not.toBeNull();
    project.components.push(comp!);

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    // Initially implicit default application
    expect(getProjectApplications(store.getSnapshot().editorState.project)).toHaveLength(1);
    expect(getActiveApplicationId(store.getSnapshot().editorState.project)).toBe(DEFAULT_APPLICATION_ID);

    // Create second application ("Admin Portal")
    const { application: adminApp, homePage: adminHome } = createApplicationWithHomePage(
      store.getSnapshot().editorState.project,
      'Admin Portal',
    );
    const createRes = client.createApplication(adminApp, adminHome);
    expect(createRes.status).toBe('applied');

    let current = store.getSnapshot().editorState.project;
    expect(getProjectApplications(current)).toHaveLength(2);
    expect(getActiveApplication(current).name).toBe('Admin Portal');
    expect(current.activePageId).toBe(adminHome.id);
    expect(getPagesForApplication(current, adminApp.id)).toHaveLength(1);
    expect(validateProject(current).ok).toBe(true);

    // Scope component to local inside Admin Portal
    const scopeRes = client.setComponentScope(comp!.id, 'local', adminApp.id);
    expect(scopeRes.status).toBe('applied');
    current = store.getSnapshot().editorState.project;
    const scopedComp = current.components[0];
    expect(getComponentScope(scopedComp)).toBe('local');
    expect(canUseComponentInApplication(scopedComp, adminApp.id)).toBe(true);
    expect(canUseComponentInApplication(scopedComp, DEFAULT_APPLICATION_ID)).toBe(false);

    // Rename Admin Portal
    const renameRes = client.renameApplication(adminApp.id, 'Backoffice');
    expect(renameRes.status).toBe('applied');
    expect(getActiveApplication(store.getSnapshot().editorState.project).name).toBe('Backoffice');

    // Undo rename -> back to Admin Portal
    client.undo();
    expect(getActiveApplication(store.getSnapshot().editorState.project).name).toBe('Admin Portal');

    // Undo scope -> back to Global
    client.undo();
    expect(getComponentScope(store.getSnapshot().editorState.project.components[0])).toBe('global');
    expect(canUseComponentInApplication(store.getSnapshot().editorState.project.components[0], DEFAULT_APPLICATION_ID)).toBe(true);

    // Undo app creation -> back to 1 app and original page
    client.undo();
    expect(getProjectApplications(store.getSnapshot().editorState.project)).toHaveLength(1);
    expect(store.getSnapshot().editorState.project.activePageId).toBe(project.pages[0].id);

    // Redo restores second application cleanly
    client.redo();
    expect(getProjectApplications(store.getSnapshot().editorState.project)).toHaveLength(2);
    expect(store.getSnapshot().editorState.project.activePageId).toBe(adminHome.id);
  });
});

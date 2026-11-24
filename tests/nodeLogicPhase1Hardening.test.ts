import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { validateProject } from '../src/core/document/validation';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import type { FolioProject, LogicGraph } from '../src/core/document/types';
import {
  LOGIC_NODE_CATALOG,
  PRIMARY_LOGIC_NODE_TYPES,
  areLogicPortTypesCompatible,
  buildLivePreviewLogicScript,
  buildReactPageLogicPlan,
  clearSessionNetworkTestToken,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
  detectInlineSecretHeaders,
  getLogicNodeDefinition,
  getLogicWireKind,
  getSessionNetworkTestToken,
  hasSessionNetworkTestToken,
  isLegacyLogicNodeType,
  isSafeSecretRef,
  migrateLegacyLogicNode,
  normalizeSecretRef,
  setSessionNetworkTestToken,
  validateLogicGraphSemantics,
  type BuiltInLogicNodeType,
} from '../src/engines/prototype';
import {
  LOGIC_CATALOG_LIST,
  migrateLegacyNodeInGraph,
  updateNetworkSettingsInGraph,
} from '../src/app/workspace/nodeLogicGraphHelpers';

function buildFixtureProject(): {
  project: FolioProject;
  pageId: string;
  buttonId: string;
  labelId: string;
} {
  const base = createInitialProject('Phase 1 Hardening Fixture');
  const page = base.pages[0];
  const button = {
    ...createRectNode(1),
    id: 'btn-primary',
    name: 'Primary Button',
    x: 40,
    y: 40,
    width: 140,
    height: 44,
    fill: '#3B82F6',
  };
  const label = {
    ...createTextNode(2),
    id: 'txt-status',
    name: 'Status Label',
    x: 40,
    y: 100,
    width: 240,
    height: 32,
    text: 'Initial',
  };
  const project: FolioProject = {
    ...base,
    pages: [
      {
        ...page,
        document: {
          ...page.document,
          nodes: [button, label],
        },
      },
    ],
  };
  return { project, pageId: page.id, buttonId: button.id, labelId: label.id };
}

describe('Phase 1.1: Network Credential Security (Anti-Secret-Leakage)', () => {
  it('validates safe secret references and rejects raw tokens / inline secret headers', () => {
    expect(isSafeSecretRef('')).toBe(true);
    expect(isSafeSecretRef('API_TOKEN')).toBe(true);
    expect(isSafeSecretRef('env:STRIPE_PUBLIC_REF')).toBe(true);
    expect(normalizeSecretRef('env:API_TOKEN')).toBe('API_TOKEN');
    expect(normalizeSecretRef('  MY_KEY_2  ')).toBe('MY_KEY_2');

    // Raw tokens, Bearer prefixes, and JWTs must be rejected
    expect(isSafeSecretRef('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe(false);
    expect(isSafeSecretRef('sk-live-1234567890abcdef')).toBe(false);
    expect(isSafeSecretRef('ghp_1234567890abcdef1234567890')).toBe(false);
    expect(isSafeSecretRef('eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe(false);

    // Inline secret headers detection
    expect(detectInlineSecretHeaders('{"Accept":"application/json"}')).toEqual([]);
    expect(
      detectInlineSecretHeaders('{"Authorization":"Bearer secret123","X-API-Key":"abc"}'),
    ).toEqual(['Authorization', 'X-API-Key']);
  });

  it('rejects persisted raw authToken in validateProject and migrates legacy .flop v2 files safely', () => {
    const { project, pageId } = buildFixtureProject();
    const rawWithLegacyEnvRef = {
      ...project,
      logicGraphs: [
        {
          id: 'graph-legacy-env',
          name: 'Legacy Env Graph',
          scope: 'page',
          targetId: pageId,
          enabled: true,
          nodes: [],
          connections: [],
          variables: [],
          networkSettings: {
            baseUrl: 'https://api.example.com',
            globalHeaders: '{"Accept":"application/json"}',
            authToken: 'env:LEGACY_API_KEY',
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'graph-legacy-raw',
          name: 'Legacy Raw Secret Graph',
          scope: 'page',
          targetId: pageId,
          enabled: true,
          nodes: [],
          connections: [],
          variables: [],
          networkSettings: {
            baseUrl: 'https://api.example.com',
            globalHeaders: '{}',
            authToken: 'sk-live-super-secret-token-999',
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    // Strict schema validation rejects raw authToken key
    expect(validateProject(rawWithLegacyEnvRef).ok).toBe(false);

    // Migration cleanly upgrades env:KEY -> authSecretRef and strips raw tokens
    const migrated = migrateProjectToV2(rawWithLegacyEnvRef);
    const graphs = migrated.logicGraphs ?? [];
    expect(graphs[0].networkSettings?.authSecretRef).toBe('LEGACY_API_KEY');
    expect('authToken' in (graphs[0].networkSettings ?? {})).toBe(false);

    expect(graphs[1].networkSettings?.authSecretRef).toBe('');
    expect('authToken' in (graphs[1].networkSettings ?? {})).toBe(false);
    expect(validateProject(migrated).ok).toBe(true);
  });

  it('never leaks session-only test tokens or unsafe secret refs into .flop JSON, Live Preview, or React codegen', () => {
    const { project, pageId, buttonId } = buildFixtureProject();
    const graphId = 'graph-net-sec';
    const click = createLogicNode({ id: 'n-click', type: 'event.on-click', data: { targetNodeId: buttonId } });
    const httpNode = createLogicNode({
      id: 'n-http',
      type: 'network.http',
      data: { method: 'GET', url: '/items', useAuth: true },
    });

    const graph: LogicGraph = updateNetworkSettingsInGraph(
      createLogicGraph({
        id: graphId,
        name: 'Secure Network Graph',
        scope: 'page',
        targetId: pageId,
        nodes: [click, httpNode],
        connections: [
          createLogicConnection({
            id: 'c1',
            sourceNodeId: click.id,
            sourcePortId: 'exec',
            targetNodeId: httpNode.id,
            targetPortId: 'exec',
          }),
        ],
      }),
      {
        baseUrl: 'https://api.example.com',
        globalHeaders: '{"Accept":"application/json"}',
        authSecretRef: 'PUBLIC_PROXY_KEY',
      },
    );

    const secretSessionValue = 'sk-ephemeral-session-token-DO-NOT-EXPORT';
    setSessionNetworkTestToken(graphId, 'PUBLIC_PROXY_KEY', secretSessionValue);
    try {
      expect(hasSessionNetworkTestToken(graphId, 'PUBLIC_PROXY_KEY')).toBe(true);
      expect(getSessionNetworkTestToken(graphId, 'PUBLIC_PROXY_KEY')).toBe(secretSessionValue);

      const fullProject: FolioProject = { ...project, logicGraphs: [graph] };

      // 1. .flop serialization never contains the session token or authToken key
      const serialized = serializeProjectToFlopJson(fullProject);
      expect(serialized).not.toContain(secretSessionValue);
      expect(serialized).not.toContain('"authToken"');
      expect(serialized).toContain('"authSecretRef": "PUBLIC_PROXY_KEY"');

      // 2. Live Preview compiled script never embeds the session token
      const previewScript = buildLivePreviewLogicScript(fullProject, fullProject.pages[0]);
      expect(previewScript).not.toContain(secretSessionValue);

      // 3. React codegen plan never embeds the session token
      const reactPlan = buildReactPageLogicPlan(fullProject, fullProject.pages[0]);
      expect(reactPlan.hookLines.join('\n')).not.toContain(secretSessionValue);
    } finally {
      clearSessionNetworkTestToken(graphId, 'PUBLIC_PROXY_KEY');
      expect(hasSessionNetworkTestToken(graphId, 'PUBLIC_PROXY_KEY')).toBe(false);
    }
  });

  it('strips unsafe authSecretRef values during serializeProjectToFlopJson and flags them in semantic validator', () => {
    const { project, pageId } = buildFixtureProject();
    const unsafeGraph = createLogicGraph({
      id: 'graph-unsafe',
      name: 'Unsafe Network Graph',
      scope: 'page',
      targetId: pageId,
      networkSettings: {
        baseUrl: 'https://api.example.com',
        globalHeaders: '{"Authorization":"Bearer live-leak-123"}',
        authSecretRef: 'Bearer live-leak-456',
      },
    });
    const fullProject: FolioProject = { ...project, logicGraphs: [unsafeGraph] };

    const validation = validateLogicGraphSemantics(unsafeGraph, fullProject);
    const errorCodes = validation.errors.map((e) => e.code);
    expect(errorCodes).toContain('UNSAFE_AUTH_SECRET_REF');
    expect(errorCodes).toContain('HARDCODED_SECRET_HEADER');

    const serialized = serializeProjectToFlopJson(fullProject);
    expect(serialized).not.toContain('live-leak-456');
  });
});

describe('Phase 1.2: Node Catalog Cleanup, Legacy Migration & Strict 2-Wire Contract', () => {
  it('exposes exactly 31 primary nodes in LOGIC_CATALOG_LIST and keeps all 13 legacy nodes hidden & tagged', () => {
    expect(PRIMARY_LOGIC_NODE_TYPES).toHaveLength(31);
    expect(LOGIC_CATALOG_LIST).toHaveLength(31);
    expect(LOGIC_CATALOG_LIST.every((def) => !def.legacy && !def.deprecated)).toBe(true);

    const allCatalogDefs = Object.values(LOGIC_NODE_CATALOG);
    const legacyDefs = allCatalogDefs.filter((def) => def.legacy);
    expect(legacyDefs).toHaveLength(13);

    for (const legacyDef of legacyDefs) {
      expect(isLegacyLogicNodeType(legacyDef.type)).toBe(true);
      expect(legacyDef.deprecated).toBe(true);
      expect(legacyDef.replacementType).toBeTruthy();
      const replacement = getLogicNodeDefinition(legacyDef.replacementType as BuiltInLogicNodeType);
      expect(replacement).toBeDefined();
      expect(replacement?.legacy).toBeFalsy();
    }
  });

  it('clarifies UI subtitles between Event > On Click and Source > Element / Layer', () => {
    const onClick = getLogicNodeDefinition('event.on-click');
    const sourceEl = getLogicNodeDefinition('source.element');
    expect(onClick?.paletteSubtitle).toContain('Primary button trigger');
    expect(sourceEl?.paletteSubtitle).toContain('Advanced property reader');
    expect(onClick?.paletteSubtitle).not.toBe(sourceEl?.paletteSubtitle);
  });

  it('enforces the strict 2-wire contract (execution vs data only)', () => {
    expect(getLogicWireKind('exec')).toBe('execution');
    expect(getLogicWireKind('any')).toBe('data');
    expect(getLogicWireKind('string')).toBe('data');
    expect(getLogicWireKind('number')).toBe('data');
    expect(getLogicWireKind('boolean')).toBe('data');
    expect(getLogicWireKind('list')).toBe('data');
    expect(getLogicWireKind('object')).toBe('data');

    expect(areLogicPortTypesCompatible('exec', 'exec')).toBe(true);
    expect(areLogicPortTypesCompatible('exec', 'any')).toBe(false);
    expect(areLogicPortTypesCompatible('any', 'exec')).toBe(false);
    expect(areLogicPortTypesCompatible('string', 'any')).toBe(true);
  });

  it('losslessly upgrades legacy nodes in a graph, remapping wire ports and preserving runtime behavior', () => {
    const { project, pageId, buttonId, labelId } = buildFixtureProject();
    const click = createLogicNode({ id: 'n-click', type: 'event.on-click', data: { targetNodeId: buttonId } });
    const legacyTpl = createLogicNode({
      id: 'n-tpl',
      type: 'logic.template',
      x: 240,
      y: 120,
      data: { template: 'Hello Upgraded!' },
    });
    const legacySetText = createLogicNode({
      id: 'n-text',
      type: 'action.set-text',
      x: 520,
      y: 120,
      data: { targetNodeId: labelId, text: 'Fallback' },
    });

    const legacyGraph = createLogicGraph({
      id: 'g-legacy',
      name: 'Legacy Upgrade Graph',
      scope: 'page',
      targetId: pageId,
      nodes: [click, legacyTpl, legacySetText],
      connections: [
        createLogicConnection({
          id: 'c-exec',
          sourceNodeId: click.id,
          sourcePortId: 'exec',
          targetNodeId: legacySetText.id,
          targetPortId: 'exec',
        }),
        createLogicConnection({
          id: 'c-data',
          sourceNodeId: legacyTpl.id,
          sourcePortId: 'text',
          targetNodeId: legacySetText.id,
          targetPortId: 'text',
        }),
      ],
    });

    // Upgrade both legacy nodes one by one via migrateLegacyNodeInGraph
    let upgraded = migrateLegacyNodeInGraph(legacyGraph, legacyTpl.id);
    upgraded = migrateLegacyNodeInGraph(upgraded, legacySetText.id);

    const tplAfter = upgraded.nodes.find((n) => n.id === legacyTpl.id);
    const setLayerAfter = upgraded.nodes.find((n) => n.id === legacySetText.id);
    expect(tplAfter?.type).toBe('logic.text');
    expect(tplAfter?.x).toBe(240);
    expect(tplAfter?.y).toBe(120);
    expect(setLayerAfter?.type).toBe('action.set-layer');
    expect(setLayerAfter?.data.property).toBe('text');
    expect(setLayerAfter?.data.targetNodeId).toBe(labelId);

    // Wire port 'text' -> 'value' remapped automatically
    const dataWire = upgraded.connections.find((c) => c.id === 'c-data');
    expect(dataWire?.targetPortId).toBe('value');

    // Non-legacy nodes are untouched
    expect(migrateLegacyNodeInGraph(upgraded, click.id)).toBe(upgraded);
    expect(migrateLegacyLogicNode(click).migrated).toBe(false);

    // Upgraded graph validates cleanly and runs identically in PrototypeRuntime
    const fullProject: FolioProject = { ...project, logicGraphs: [upgraded] };
    expect(validateProject(fullProject).ok).toBe(true);
    expect(validateLogicGraphSemantics(upgraded, fullProject).errors).toHaveLength(0);

    const runtime = createPrototypeRuntime(fullProject, { pageId });
    runtime.mount();
    const snap = runtime.dispatchNodeEvent(buttonId, 'click');
    expect(snap.nodeOverrides[labelId]?.text).toBe('Hello Upgraded!');
  });
});

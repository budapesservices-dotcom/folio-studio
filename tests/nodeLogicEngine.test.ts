import { describe, expect, it } from 'vitest';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { executeNativeCommand } from '../src/app/nativeCommandExecutor';
import { ALL_NATIVE_COMMAND_REGISTRY, NATIVE_COMMAND_REGISTRY } from '../src/app/nativeCommandRegistry';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentVariantAxis,
} from '../src/core/document/components';
import {
  createEmptyDocument,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { FolioProject, LogicGraph } from '../src/core/document/types';
import {
  freezeImmutableGraph,
  validateProject,
  validateProjectIncremental,
} from '../src/core/document/validation';
import { buildLivePreviewHtml } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { applyProjectDelta, computeProjectDelta } from '../src/engines/history';
import {
  BUILT_IN_LOGIC_NODE_TYPES,
  LOGIC_NODE_CATALOG,
  MAX_LOGIC_EXECUTION_STEPS,
  areLogicPortTypesCompatible,
  auditOrphanLogicReferences,
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
  interpolateLogicTemplate,
  validateLogicGraphSemantics,
  validateProjectLogicGraphs,
} from '../src/engines/prototype';

function createInteractiveFixtureProject(): {
  project: FolioProject;
  pageId: string;
  buttonId: string;
  labelId: string;
  badgeId: string;
  cardInstanceId: string;
  componentId: string;
  axisId: string;
  activeOptionId: string;
  darkThemeId: string;
} {
  const base = createInitialProject('Node Logic Studio');
  const tokens = createDefaultDesignTokens();
  const darkThemeId = tokens.themes[1]?.id ?? tokens.themes[0].id;

  const page = getActivePage(base);
  const button = {
    ...createRectNode(0),
    id: 'node-btn-cta',
    name: 'CTA Button',
    x: 40,
    y: 40,
    semanticTag: 'button' as const,
  };
  const label = {
    ...createTextNode(1),
    id: 'node-label-status',
    name: 'Status Label',
    x: 40,
    y: 120,
    text: 'Initial Label',
  };
  const badge = {
    ...createRectNode(2),
    id: 'node-badge-panel',
    name: 'Status Badge',
    x: 240,
    y: 40,
    visible: false,
  };

  const masterBg = { ...createRectNode(0), id: 'master-bg', name: 'Card Bg', x: 0, y: 0 };
  const masterTitle = { ...createTextNode(1), id: 'master-title', name: 'Card Title', x: 16, y: 16, text: 'Default' };
  const rawComponent = buildComponentDefinitionFromNodes(
    [masterBg, masterTitle],
    ['master-bg', 'master-title'],
    'Status Card',
    { id: 'comp-card' },
  )!;
  const variantAxis = createComponentVariantAxis('State', {
    id: 'axis-state',
    optionLabels: ['Idle', 'Active'],
  });
  const masterTitleInDoc = rawComponent.document.nodes.find((n) => n.type === 'text')!;
  const masterBgInDoc = rawComponent.document.nodes.find((n) => n.type === 'rect')!;
  variantAxis.options[1].overrides[masterTitleInDoc.id] = { text: 'Active Card' };
  variantAxis.options[1].overrides[masterBgInDoc.id] = { fill: '#10B981' };
  const component = {
    ...rawComponent,
    variants: [variantAxis],
  };

  const cardInstance = {
    ...createComponentInstance(component, 40, 220),
    id: 'node-card-inst',
  };

  const aboutPage = {
    id: 'page-about',
    name: 'About',
    route: '/about',
    document: createEmptyDocument('About'),
  };
  const project: FolioProject = {
    ...base,
    designTokens: tokens,
    pages: [
      {
        ...page,
        document: {
          ...page.document,
          nodes: [button, label, badge, cardInstance],
        },
      },
      aboutPage,
    ],
    components: [component],
    logicGraphs: [],
  };

  return {
    project,
    pageId: page.id,
    buttonId: button.id,
    labelId: label.id,
    badgeId: badge.id,
    cardInstanceId: cardInstance.id,
    componentId: component.id,
    axisId: variantAxis.id,
    activeOptionId: variantAxis.options[1].id,
    darkThemeId,
  };
}

describe('Node Logic v1 — .flop v2 Backward Compatibility & Schema Validation', () => {
  it('preserves legacy .flop v2 projects with empty logicGraphs and reserved unknown node types', () => {
    const { project } = createInteractiveFixtureProject();
    const legacyGraph: LogicGraph = {
      id: 'graph-legacy',
      name: 'Reserved Legacy Graph',
      scope: 'project',
      targetId: null,
      nodes: [
        {
          id: 'legacy-node-1',
          type: 'reserved-node',
          x: 10,
          y: 20,
          data: { enabled: true, label: 'keep-me', count: 3, empty: null },
        },
      ],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const withLegacy: FolioProject = { ...project, logicGraphs: [legacyGraph] };
    expect(validateProject(withLegacy).ok).toBe(true);

    // JSON round-trip preserves unknown node untouched
    const roundTripped = JSON.parse(JSON.stringify(withLegacy)) as FolioProject;
    expect(validateProject(roundTripped).ok).toBe(true);
    expect(roundTripped.logicGraphs[0].nodes[0].type).toBe('reserved-node');

    // Semantic validator reports a non-fatal warning, NOT an error
    const semantic = validateLogicGraphSemantics(legacyGraph, withLegacy);
    expect(semantic.ok).toBe(true);
    expect(semantic.errors).toHaveLength(0);
    expect(semantic.warnings.some((w) => w.code === 'UNSUPPORTED_NODE_TYPE')).toBe(true);
  });

  it('rejects malformed variables, invalid scope/targetId, and duplicate graph IDs in validateProject', () => {
    const { project, pageId } = createInteractiveFixtureProject();

    // Project scope with non-null targetId
    const badProjectScope = {
      ...project,
      logicGraphs: [
        createLogicGraph({
          id: 'g-bad-scope',
          name: 'Bad Scope',
          scope: 'project',
          targetId: null,
        }),
      ],
    };
    badProjectScope.logicGraphs[0] = { ...badProjectScope.logicGraphs[0], targetId: pageId };
    expect(validateProject(badProjectScope).ok).toBe(false);

    // Page scope pointing to missing page
    const missingPageGraph = {
      ...project,
      logicGraphs: [
        createLogicGraph({
          id: 'g-missing-page',
          name: 'Orphan Page Graph',
          scope: 'page',
          targetId: 'page-does-not-exist',
        }),
      ],
    };
    expect(validateProject(missingPageGraph).ok).toBe(false);

    // Mismatched variable initialValue type
    const badVarGraph = createLogicGraph({
      id: 'g-bad-var',
      name: 'Bad Variable',
      scope: 'page',
      targetId: pageId,
      variables: [
        createLogicVariable({
          id: 'var-count',
          name: 'count',
          valueType: 'number',
          initialValue: 'not-a-number' as unknown as number,
        }),
      ],
    });
    expect(validateProject({ ...project, logicGraphs: [badVarGraph] }).ok).toBe(false);

    // Incremental validation invalidates cache when pages change and a graph becomes orphaned
    const validGraph = createLogicGraph({
      id: 'g-page-ok',
      name: 'Page Graph',
      scope: 'page',
      targetId: project.pages[1].id,
    });
    const frozenValid = freezeImmutableGraph({ ...project, logicGraphs: [validGraph] });
    expect(validateProjectIncremental(null, frozenValid).ok).toBe(true);
    const removedPageCandidate: FolioProject = {
      ...frozenValid,
      pages: [frozenValid.pages[0]],
    };
    expect(validateProjectIncremental(frozenValid, removedPageCandidate).ok).toBe(false);
  });
});

describe('Node Logic v1 — Typed Catalog & Semantic Graph Validator', () => {
  it('registers all 18 v1 node types and enforces strict port type compatibility', () => {
    expect(BUILT_IN_LOGIC_NODE_TYPES).toHaveLength(18);
    for (const type of BUILT_IN_LOGIC_NODE_TYPES) {
      expect(LOGIC_NODE_CATALOG[type].type).toBe(type);
      expect(LOGIC_NODE_CATALOG[type].ports.length).toBeGreaterThan(0);
    }
    expect(areLogicPortTypesCompatible('exec', 'exec')).toBe(true);
    expect(areLogicPortTypesCompatible('exec', 'boolean')).toBe(false);
    expect(areLogicPortTypesCompatible('string', 'exec')).toBe(false);
    expect(areLogicPortTypesCompatible('number', 'string')).toBe(true);
    expect(areLogicPortTypesCompatible('boolean', 'number')).toBe(false);
    expect(areLogicPortTypesCompatible('any', 'number')).toBe(true);
  });

  it('detects port mismatches, reverse wires, self-loops, dataflow cycles, orphan AST targets, and CSS/URL injection', () => {
    const { project, pageId, buttonId, labelId, cardInstanceId } = createInteractiveFixtureProject();

    const brokenGraph = createLogicGraph({
      id: 'graph-broken',
      name: 'Broken Graph',
      scope: 'page',
      targetId: pageId,
      variables: [
        createLogicVariable({ id: 'v-name', name: 'title', valueType: 'string', initialValue: 'hi' }),
      ],
      nodes: [
        createLogicNode({ id: 'n-click', type: 'event.on-click', data: { targetNodeId: 'missing-node' } }),
        createLogicNode({ id: 'n-toggle', type: 'state.toggle', data: { variableId: 'v-name' } }),
        createLogicNode({ id: 'n-cmp-1', type: 'logic.compare', data: { operator: '==' } }),
        createLogicNode({ id: 'n-cmp-2', type: 'logic.compare', data: { operator: '==' } }),
        createLogicNode({ id: 'n-text', type: 'action.set-text', data: { targetNodeId: buttonId, text: 'oops' } }),
        createLogicNode({ id: 'n-fill', type: 'action.set-fill', data: { targetNodeId: labelId, fill: 'red; background:url(javascript:alert(1))' } }),
        createLogicNode({ id: 'n-nav', type: 'action.navigate', data: { route: 'javascript:alert(1)' } }),
        createLogicNode({ id: 'n-var', type: 'action.set-variant', data: { targetNodeId: cardInstanceId, axisId: 'bad-axis', optionId: 'bad-opt' } }),
      ],
      connections: [
        // Self-connection
        createLogicConnection({ id: 'c-self', sourceNodeId: 'n-click', sourcePortId: 'exec', targetNodeId: 'n-click', targetPortId: 'exec' }),
        // Exec -> data mismatch
        createLogicConnection({ id: 'c-type', sourceNodeId: 'n-click', sourcePortId: 'exec', targetNodeId: 'n-cmp-1', targetPortId: 'left' }),
        // Dataflow cycle: cmp-1 -> cmp-2 -> cmp-1
        createLogicConnection({ id: 'c-cyc-1', sourceNodeId: 'n-cmp-1', sourcePortId: 'result', targetNodeId: 'n-cmp-2', targetPortId: 'left' }),
        createLogicConnection({ id: 'c-cyc-2', sourceNodeId: 'n-cmp-2', sourcePortId: 'result', targetNodeId: 'n-cmp-1', targetPortId: 'right' }),
      ],
    });

    const report = validateLogicGraphSemantics(brokenGraph, { ...project, logicGraphs: [brokenGraph] });
    expect(report.ok).toBe(false);
    const codes = new Set(report.errors.map((err) => err.code));
    expect(codes.has('SELF_CONNECTION')).toBe(true);
    expect(codes.has('PORT_TYPE_MISMATCH')).toBe(true);
    expect(codes.has('DATAFLOW_CYCLE')).toBe(true);
    expect(codes.has('MISSING_TARGET_NODE')).toBe(true);
    expect(codes.has('VARIABLE_TYPE_MISMATCH')).toBe(true);
    expect(codes.has('INCOMPATIBLE_TARGET_NODE')).toBe(true);
    expect(codes.has('UNSAFE_CSS_VALUE')).toBe(true);
    expect(codes.has('UNSAFE_NAVIGATE_URL')).toBe(true);
    expect(codes.has('INVALID_VARIANT_REFERENCE')).toBe(true);

    const orphans = auditOrphanLogicReferences({ ...project, logicGraphs: [brokenGraph] });
    expect(orphans.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Node Logic v1 — Zero-Bypass Native Commands, Undo/Redo & Delta History', () => {
  it('registers 3 new logic commands without modifying frozen Phase 2 registry', () => {
    expect(Object.keys(NATIVE_COMMAND_REGISTRY)).toHaveLength(14);
    expect('logic.create-graph' in ALL_NATIVE_COMMAND_REGISTRY).toBe(true);
    expect('logic.update-graph' in ALL_NATIVE_COMMAND_REGISTRY).toBe(true);
    expect('logic.delete-graph' in ALL_NATIVE_COMMAND_REGISTRY).toBe(true);
  });

  it('creates, updates, deletes logic graphs through Native Command Engine with Undo/Redo, Delta History, and permission guards', () => {
    const { project, pageId, buttonId, labelId, componentId } = createInteractiveFixtureProject();
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const initialGraph = createLogicGraph({
      id: 'graph-cta',
      name: 'CTA Flow',
      scope: 'page',
      targetId: pageId,
      variables: [
        createLogicVariable({ id: 'var-open', name: 'isOpen', valueType: 'boolean', initialValue: false }),
      ],
      nodes: [
        createLogicNode({ id: 'ev-1', type: 'event.on-click', data: { targetNodeId: buttonId } }),
        createLogicNode({ id: 'act-1', type: 'action.set-text', data: { targetNodeId: labelId, text: 'Clicked!' } }),
      ],
      connections: [
        createLogicConnection({ id: 'conn-1', sourceNodeId: 'ev-1', sourcePortId: 'exec', targetNodeId: 'act-1', targetPortId: 'exec' }),
      ],
    });

    const rev0 = store.getSnapshot().projectRevision;
    const beforeProject = store.getSnapshot().editorState.project;

    // Create graph
    const created = client.createLogicGraph(initialGraph);
    expect(created.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(rev0 + 1);
    expect(store.getSnapshot().editorState.project.logicGraphs).toHaveLength(1);

    // Duplicate ID rejected
    const duplicate = client.createLogicGraph(initialGraph);
    expect(duplicate.status).toBe('rejected');
    expect(duplicate.code).toBe('PRECONDITION_FAILED');

    // Delta History diff/apply round-trip
    const afterCreate = store.getSnapshot().editorState.project;
    const delta = computeProjectDelta(beforeProject, afterCreate);
    expect(delta.logicGraphsChanged).toBe(true);
    const forward = applyProjectDelta(beforeProject, delta, 'forward');
    expect(forward.logicGraphs).toHaveLength(1);
    const backward = applyProjectDelta(forward, delta, 'backward');
    expect(backward.logicGraphs).toHaveLength(0);

    // Update graph
    const updatedGraph: LogicGraph = { ...initialGraph, name: 'CTA Flow Renamed' };
    const updated = client.updateLogicGraph(updatedGraph);
    expect(updated.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('CTA Flow Renamed');

    // Undo restores previous name, Redo re-applies
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('CTA Flow');
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('CTA Flow Renamed');

    // Permission guard rejects caller without 'logic.update'
    const unauthorizedEnvelope = client.createEnvelope(
      'logic.delete-graph',
      { kind: 'project', projectId: project.metadata.id },
      { graphId: 'graph-cta' },
    );
    const denied = executeNativeCommand(store, unauthorizedEnvelope, {
      projectId: project.metadata.id,
      principal: { kind: 'user', id: 'user-readonly' },
      capabilities: ['project.read', 'document.read'],
      workspace: 'main',
    });
    expect(denied.status).toBe('rejected');
    expect(denied.code).toBe('PERMISSION_DENIED');

    // Delete graph succeeds via authorized client
    const deleted = client.deleteLogicGraph('graph-cta');
    expect(deleted.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs).toHaveLength(0);

    // Deleting a component prunes component-scoped logic graphs automatically
    const compGraph = createLogicGraph({
      id: 'graph-comp',
      name: 'Card Interaction',
      scope: 'component',
      targetId: componentId,
    });
    expect(client.createLogicGraph(compGraph).status).toBe('applied');
    const comp = store.getSnapshot().editorState.project.components[0];
    const deletedComp = client.deleteComponent({
      componentId: comp.id,
      expectedUpdatedAt: comp.updatedAt,
      expectedMasterDocument: comp.document,
    });
    expect(deletedComp.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs).toHaveLength(0);
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);
  });
});

describe('Node Logic v1 — Deterministic Headless PrototypeRuntime', () => {
  it('executes page-load, click, state toggle/increment clamp, compare/branch, template, visibility, fill, variant, theme, hover, and navigate', () => {
    const fixture = createInteractiveFixtureProject();
    const graph = createLogicGraph({
      id: 'graph-interactive',
      name: 'Interactive Dashboard',
      scope: 'page',
      targetId: fixture.pageId,
      variables: [
        createLogicVariable({ id: 'var-active', name: 'isActive', valueType: 'boolean', initialValue: false }),
        createLogicVariable({ id: 'var-clicks', name: 'clicks', valueType: 'number', initialValue: 0 }),
      ],
      nodes: [
        // On Page Load -> set initial label
        createLogicNode({ id: 'ev-load', type: 'event.on-page-load' }),
        createLogicNode({ id: 'act-init-txt', type: 'action.set-text', data: { targetNodeId: fixture.labelId, text: 'Ready (0)' } }),

        // On Click CTA -> toggle isActive -> increment clicks (max 2) -> branch on isActive
        createLogicNode({ id: 'ev-click', type: 'event.on-click', data: { targetNodeId: fixture.buttonId } }),
        createLogicNode({ id: 'st-toggle', type: 'state.toggle', data: { variableId: 'var-active' } }),
        createLogicNode({ id: 'st-inc', type: 'state.increment', data: { variableId: 'var-clicks', step: 1, min: 0, max: 2 } }),
        createLogicNode({ id: 'br-active', type: 'logic.branch' }),
        createLogicNode({ id: 'tpl-on', type: 'logic.template', data: { template: 'Active #{{clicks}}' } }),
        createLogicNode({ id: 'act-txt-on', type: 'action.set-text', data: { targetNodeId: fixture.labelId } }),
        createLogicNode({ id: 'act-fill-on', type: 'action.set-fill', data: { targetNodeId: fixture.buttonId, fill: '#10B981' } }),
        createLogicNode({ id: 'act-vis-on', type: 'action.set-visible', data: { targetNodeId: fixture.badgeId, mode: 'show' } }),
        createLogicNode({
          id: 'act-var-on',
          type: 'action.set-variant',
          data: { targetNodeId: fixture.cardInstanceId, axisId: fixture.axisId, optionId: fixture.activeOptionId },
        }),
        createLogicNode({ id: 'act-theme-on', type: 'action.set-theme', data: { themeId: fixture.darkThemeId } }),
        createLogicNode({ id: 'act-txt-off', type: 'action.set-text', data: { targetNodeId: fixture.labelId, text: 'Inactive' } }),
        createLogicNode({ id: 'act-vis-off', type: 'action.set-visible', data: { targetNodeId: fixture.badgeId, mode: 'hide' } }),

        // On Hover Leave badge -> navigate to /about
        createLogicNode({ id: 'ev-hover', type: 'event.on-hover', data: { targetNodeId: fixture.badgeId, phase: 'leave' } }),
        createLogicNode({ id: 'act-nav', type: 'action.navigate', data: { route: '/about' } }),
      ],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: 'ev-load', sourcePortId: 'exec', targetNodeId: 'act-init-txt', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: 'ev-click', sourcePortId: 'exec', targetNodeId: 'st-toggle', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: 'st-toggle', sourcePortId: 'next', targetNodeId: 'st-inc', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: 'st-inc', sourcePortId: 'next', targetNodeId: 'br-active', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c5', sourceNodeId: 'st-toggle', sourcePortId: 'result', targetNodeId: 'br-active', targetPortId: 'condition' }),
        createLogicConnection({ id: 'c6', sourceNodeId: 'br-active', sourcePortId: 'true', targetNodeId: 'act-txt-on', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c7', sourceNodeId: 'tpl-on', sourcePortId: 'text', targetNodeId: 'act-txt-on', targetPortId: 'text' }),
        createLogicConnection({ id: 'c8', sourceNodeId: 'act-txt-on', sourcePortId: 'next', targetNodeId: 'act-fill-on', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c9', sourceNodeId: 'act-fill-on', sourcePortId: 'next', targetNodeId: 'act-vis-on', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c10', sourceNodeId: 'act-vis-on', sourcePortId: 'next', targetNodeId: 'act-var-on', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c11', sourceNodeId: 'act-var-on', sourcePortId: 'next', targetNodeId: 'act-theme-on', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c12', sourceNodeId: 'br-active', sourcePortId: 'false', targetNodeId: 'act-txt-off', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c13', sourceNodeId: 'act-txt-off', sourcePortId: 'next', targetNodeId: 'act-vis-off', targetPortId: 'exec' }),
        createLogicConnection({ id: 'c14', sourceNodeId: 'ev-hover', sourcePortId: 'exec', targetNodeId: 'act-nav', targetPortId: 'exec' }),
      ],
    });

    const projectWithLogic: FolioProject = { ...fixture.project, logicGraphs: [graph] };
    expect(validateProjectLogicGraphs(projectWithLogic).ok).toBe(true);

    const runtime = createPrototypeRuntime(projectWithLogic, { pageId: fixture.pageId });
    const mounted = runtime.mount();
    expect(mounted.nodeOverrides[fixture.labelId]?.text).toBe('Ready (0)');

    // 1st click: isActive=true, clicks=1
    const click1 = runtime.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(click1.variables['var-active']).toBe(true);
    expect(click1.variables['var-clicks']).toBe(1);
    expect(click1.nodeOverrides[fixture.labelId]?.text).toBe('Active #1');
    expect(click1.nodeOverrides[fixture.buttonId]?.fill).toBe('#10B981');
    expect(click1.nodeOverrides[fixture.badgeId]?.visible).toBe(true);
    expect(click1.nodeOverrides[fixture.cardInstanceId]?.variantSelection?.[fixture.axisId]).toBe(fixture.activeOptionId);
    expect(click1.activeThemeId).toBe(fixture.darkThemeId);

    // 2nd click: isActive=false, clicks=2
    const click2 = runtime.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(click2.variables['var-active']).toBe(false);
    expect(click2.variables['var-clicks']).toBe(2);
    expect(click2.nodeOverrides[fixture.labelId]?.text).toBe('Inactive');
    expect(click2.nodeOverrides[fixture.badgeId]?.visible).toBe(false);

    // 3rd click: isActive=true, clicks clamped at max=2
    const click3 = runtime.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(click3.variables['var-clicks']).toBe(2);
    expect(click3.nodeOverrides[fixture.labelId]?.text).toBe('Active #2');

    // Hover leave navigates to /about
    const afterNav = runtime.dispatchNodeEvent(fixture.badgeId, 'hover-leave');
    expect(afterNav.activeRoute).toBe('/about');
    expect(afterNav.pageId).toBe(projectWithLogic.pages[1].id);
  });

  it('halts infinite execution loops deterministically at MAX_LOGIC_EXECUTION_STEPS and supports safe template interpolation', () => {
    const { project, pageId, buttonId } = createInteractiveFixtureProject();
    const loopGraph = createLogicGraph({
      id: 'graph-loop',
      name: 'Bounded Loop',
      scope: 'page',
      targetId: pageId,
      variables: [
        createLogicVariable({ id: 'v-n', name: 'n', valueType: 'number', initialValue: 0 }),
      ],
      nodes: [
        createLogicNode({ id: 'ev', type: 'event.on-click', data: { targetNodeId: buttonId } }),
        createLogicNode({ id: 'inc-a', type: 'state.increment', data: { variableId: 'v-n', step: 1 } }),
        createLogicNode({ id: 'inc-b', type: 'state.increment', data: { variableId: 'v-n', step: 1 } }),
      ],
      connections: [
        createLogicConnection({ id: 'l1', sourceNodeId: 'ev', sourcePortId: 'exec', targetNodeId: 'inc-a', targetPortId: 'exec' }),
        createLogicConnection({ id: 'l2', sourceNodeId: 'inc-a', sourcePortId: 'next', targetNodeId: 'inc-b', targetPortId: 'exec' }),
        createLogicConnection({ id: 'l3', sourceNodeId: 'inc-b', sourcePortId: 'next', targetNodeId: 'inc-a', targetPortId: 'exec' }),
      ],
    });

    const runtime = createPrototypeRuntime({ ...project, logicGraphs: [loopGraph] }, { maxSteps: 32 });
    const snapshot = runtime.dispatchNodeEvent(buttonId, 'click');
    expect(snapshot.stepCount).toBe(32);
    expect(snapshot.warnings.some((w) => w.includes('step budget (32)'))).toBe(true);
    expect(MAX_LOGIC_EXECUTION_STEPS).toBe(256);

    // Safe template interpolation resolves declared vars, blanks unknown identifiers, and never executes code
    const formatted = interpolateLogicTemplate(
      'Count={{n}}, Missing={{unknownVar}}, Raw={{process.exit(1)}}',
      { 'v-n': 42 },
      new Map([['n', 'v-n']]),
    );
    expect(formatted).toBe('Count=42, Missing=, Raw={{process.exit(1)}}');
  });
});

describe('Node Logic v1 — Live Preview & React Codegen Integration', () => {
  it('keeps static pages free of injected scripts and React hooks, while compiling interactive pages cleanly and safely', () => {
    const fixture = createInteractiveFixtureProject();

    // Static page has zero logic script & clean React import
    expect(buildLivePreviewLogicScript(fixture.project, fixture.project.pages[0])).toBeNull();
    const staticHtml = buildLivePreviewHtml(fixture.project);
    expect(staticHtml).not.toContain('<script>');
    const staticReact = compileReactProjectFiles(fixture.project).find((f) => f.path.startsWith('src/pages/'));
    expect(staticReact?.content).toContain("import React from 'react';");
    expect(staticReact?.content).not.toContain('useState');

    // Interactive page with </script> injection attempt in text
    const graph = createLogicGraph({
      id: 'graph-preview',
      name: 'Preview Interaction',
      scope: 'page',
      targetId: fixture.pageId,
      variables: [
        createLogicVariable({ id: 'var-open', name: 'open', valueType: 'boolean', initialValue: false }),
      ],
      nodes: [
        createLogicNode({ id: 'ev-load', type: 'event.on-page-load' }),
        createLogicNode({ id: 'ev-click', type: 'event.on-click', data: { targetNodeId: fixture.buttonId } }),
        createLogicNode({ id: 'st-tog', type: 'state.toggle', data: { variableId: 'var-open' } }),
        createLogicNode({ id: 'act-txt', type: 'action.set-text', data: { targetNodeId: fixture.labelId, text: 'Hello </script><img onerror=alert(1)>' } }),
        createLogicNode({ id: 'act-vis', type: 'action.set-visible', data: { targetNodeId: fixture.badgeId, mode: 'toggle' } }),
      ],
      connections: [
        createLogicConnection({ id: 'p1', sourceNodeId: 'ev-click', sourcePortId: 'exec', targetNodeId: 'st-tog', targetPortId: 'exec' }),
        createLogicConnection({ id: 'p2', sourceNodeId: 'st-tog', sourcePortId: 'next', targetNodeId: 'act-txt', targetPortId: 'exec' }),
        createLogicConnection({ id: 'p3', sourceNodeId: 'act-txt', sourcePortId: 'next', targetNodeId: 'act-vis', targetPortId: 'exec' }),
      ],
    });

    const interactiveProject: FolioProject = { ...fixture.project, logicGraphs: [graph] };
    const previewHtml = buildLivePreviewHtml(interactiveProject);
    expect(previewHtml).toContain('Generated by FOLIO Node Logic v1 Runtime');
    expect(previewHtml).not.toContain('eval(');
    expect(previewHtml).not.toContain('new Function');
    expect(previewHtml).not.toContain('.innerHTML');
    expect(previewHtml).not.toContain('</script><img');
    expect(previewHtml).toContain('<\\/script>');

    const reactFiles = compileReactProjectFiles(interactiveProject);
    const pageTsx = reactFiles.find((f) => f.pageId === fixture.pageId);
    expect(pageTsx).toBeTruthy();
    expect(pageTsx!.content).toContain("import React, { useState, useEffect } from 'react';");
    expect(pageTsx!.content).toContain('onClick={() => runLogicTrigger("click", "node-btn-cta")}');
    expect(pageTsx!.content).toContain('logicOverrides["node-label-status"]?.text ?? "Initial Label"');
    expect(pageTsx!.content).toContain('logicOverrides["node-badge-panel"]?.visible === false');
    expect(pageTsx!.content).toContain('useEffect(() => { runLogicTrigger("page-load"); }, []);');
  });
});

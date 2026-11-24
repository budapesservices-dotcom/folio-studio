import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { getActivePage } from '../src/core/document/project';
import { getProjectDesignTokens } from '../src/core/document/tokens';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioProject,
} from '../src/core/document/types';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createFrameInGraph } from '../src/app/workspace/nodeLogicGraphHelpers';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import {
  bakeLogicFrame,
  buildLivePreviewLogicScript,
  COMPONENT_GRAPH_INSTANCE_MARKER,
  compilePageLogicRuntimeConfig,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  createPrototypeRuntime,
  resolveApplicableGraphsForPage,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';
import { createPreviewDomHarness, createReactTsxHarness } from './helpers/parityRuntimeHarness';

function buildTwoInstanceToggleProject(options: { readonly nodeLogicEnabled?: boolean } = {}) {
  const base = createInitialProject('Component Logic Isolation Project');
  const page = getActivePage(base);
  const now = '2026-11-24T00:00:00.000Z';

  const btnBg: DesignNode = {
    ...createRectNode(1),
    id: 'btn-bg',
    name: 'Toggle Button BG',
    x: 12,
    y: 12,
    width: 140,
    height: 44,
    style: { fill: '#3B82F6', stroke: '#1D4ED8', strokeWidth: 1 },
  };
  const btnLabel: DesignNode = {
    ...createTextNode(2),
    id: 'btn-label',
    name: 'Toggle Label',
    x: 24,
    y: 22,
    width: 116,
    height: 24,
    text: 'Count: 0',
  };
  const statusDot: DesignNode = {
    ...createEllipseNode(3),
    id: 'status-dot',
    name: 'Status Dot',
    x: 164,
    y: 22,
    width: 24,
    height: 24,
    style: { fill: '#94A3B8', stroke: '#475569', strokeWidth: 1 },
  };

  const master: ComponentDefinition = {
    id: 'comp-toggle-card',
    name: 'ToggleCard',
    ...(options.nodeLogicEnabled !== undefined ? { nodeLogicEnabled: options.nodeLogicEnabled } : { nodeLogicEnabled: true }),
    document: {
      id: 'doc-toggle-card',
      name: 'ToggleCard',
      width: 220,
      height: 80,
      background: '#0F172A',
      nodes: [btnBg, btnLabel, statusDot],
    },
    createdAt: now,
    updatedAt: now,
  };

  const instA: ComponentInstanceNode = {
    id: 'inst-a',
    type: 'component-instance',
    name: 'ToggleCard A',
    componentId: master.id,
    overrides: {},
    x: 40,
    y: 40,
    width: 220,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const instB: ComponentInstanceNode = {
    id: 'inst-b',
    type: 'component-instance',
    name: 'ToggleCard B',
    componentId: master.id,
    overrides: {},
    x: 300,
    y: 40,
    width: 220,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  const clicksVar = createLogicVariable({
    id: 'var-clicks',
    name: 'clicks',
    valueType: 'number',
    initialValue: 0,
    scope: 'local',
  });
  const onceVar = createLogicVariable({
    id: 'var-once',
    name: 'onceFired',
    valueType: 'boolean',
    initialValue: false,
    scope: 'local',
  });
  const globalTotalVar = createLogicVariable({
    id: 'var-global-total',
    name: 'globalTotal',
    valueType: 'number',
    initialValue: 0,
    scope: 'global',
  });

  const onBtnClick = createLogicNode({
    id: 'ev-btn-click',
    type: 'event.on-click',
    data: { targetNodeId: 'btn-bg', mode: 'click' },
  });
  const togglePrivate = createLogicNode({
    id: 'st-toggle',
    type: 'state.toggle',
    data: { variableId: '', initialValue: false },
  });
  const incLocal = createLogicNode({
    id: 'st-inc-local',
    type: 'state.update',
    data: { variableId: clicksVar.id, operation: 'increment', step: 1 },
  });
  const incGlobal = createLogicNode({
    id: 'st-inc-global',
    type: 'state.update',
    data: { variableId: globalTotalVar.id, operation: 'increment', step: 1 },
  });
  const formatLabel = createLogicNode({
    id: 'lg-format',
    type: 'logic.text',
    data: { mode: 'template', template: 'Clicks: {{clicks}}' },
  });
  const setLabel = createLogicNode({
    id: 'act-label',
    type: 'action.set-layer',
    data: { targetMode: 'override', targetNodeId: 'btn-label', property: 'text' },
  });
  const branch = createLogicNode({
    id: 'lg-branch',
    type: 'logic.branch',
    data: { mode: 'if-else', pipelineRef: 'step:st-toggle:value' },
  });
  const setFillOn = createLogicNode({
    id: 'act-fill-on',
    type: 'action.set-layer',
    data: { targetMode: 'pipeline', property: 'fill', fill: '#10B981' },
  });
  const setFillOff = createLogicNode({
    id: 'act-fill-off',
    type: 'action.set-layer',
    data: { targetMode: 'pipeline', property: 'fill', fill: '#3B82F6' },
  });

  const onDotOnce = createLogicNode({
    id: 'ev-dot-once',
    type: 'event.on-click',
    data: { targetNodeId: 'status-dot', mode: 'click', once: true },
  });
  const markOnce = createLogicNode({
    id: 'st-mark-once',
    type: 'state.update',
    data: { variableId: onceVar.id, operation: 'set', value: true },
  });
  const incOnceClicks = createLogicNode({
    id: 'st-inc-once-clicks',
    type: 'state.update',
    data: { variableId: clicksVar.id, operation: 'increment', step: 10 },
  });
  const setDotFill = createLogicNode({
    id: 'act-dot-fill',
    type: 'action.set-layer',
    data: { targetMode: 'override', targetNodeId: 'status-dot', property: 'fill', fill: '#F59E0B' },
  });

  const compGraph = createLogicGraph({
    id: 'graph-toggle-card',
    name: 'ToggleCard Logic',
    scope: 'component',
    targetId: master.id,
    variables: [clicksVar, onceVar, globalTotalVar],
    nodes: [
      onBtnClick,
      togglePrivate,
      incLocal,
      incGlobal,
      formatLabel,
      setLabel,
      branch,
      setFillOn,
      setFillOff,
      onDotOnce,
      markOnce,
      incOnceClicks,
      setDotFill,
    ],
    connections: [
      createLogicConnection({ id: 'c1', sourceNodeId: onBtnClick.id, sourcePortId: 'exec', targetNodeId: togglePrivate.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c2', sourceNodeId: togglePrivate.id, sourcePortId: 'next', targetNodeId: incLocal.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c3', sourceNodeId: incLocal.id, sourcePortId: 'next', targetNodeId: incGlobal.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c4', sourceNodeId: incGlobal.id, sourcePortId: 'next', targetNodeId: setLabel.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c5', sourceNodeId: setLabel.id, sourcePortId: 'next', targetNodeId: branch.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c6', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setFillOn.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'c7', sourceNodeId: branch.id, sourcePortId: 'false', targetNodeId: setFillOff.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'd1', sourceNodeId: formatLabel.id, sourcePortId: 'text', targetNodeId: setLabel.id, targetPortId: 'value' }),
      createLogicConnection({ id: 'o1', sourceNodeId: onDotOnce.id, sourcePortId: 'exec', targetNodeId: markOnce.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'o2', sourceNodeId: markOnce.id, sourcePortId: 'next', targetNodeId: incOnceClicks.id, targetPortId: 'exec' }),
      createLogicConnection({ id: 'o3', sourceNodeId: incOnceClicks.id, sourcePortId: 'next', targetNodeId: setDotFill.id, targetPortId: 'exec' }),
    ],
  });

  const project: FolioProject = {
    ...base,
    components: [master],
    pages: base.pages.map((p) =>
      p.id === page.id
        ? {
            ...p,
            document: {
              ...p.document,
              nodes: [instA, instB],
            },
          }
        : p,
    ),
    logicGraphs: [compGraph],
  };

  return { project, pageId: page.id, master, compGraph, instA, instB };
}

describe('Phase 2 — Component-Scoped Per-Instance Logic Execution Contract', () => {
  it('isolates state, private toggle memory, local variables, and once guards across 2+ instances of the same master with 3-runtime parity (Headless ↔ Live Preview ↔ Executed React TSX)', () => {
    const { project, pageId } = buildTwoInstanceToggleProject({ nodeLogicEnabled: true });
    const page = getActivePage(project);

    // 1. Headless Prototype Simulator
    const rt = createPrototypeRuntime(project);
    const s1 = rt.dispatchNodeEvent('inst-a__btn-bg', 'click');
    expect(s1.variables['inst-a::var-clicks']).toBe(1);
    expect(s1.variables['inst-b::var-clicks']).toBe(0);
    expect(s1.variables['var-global-total']).toBe(1);
    expect(s1.privateMemory['inst-a:st-toggle:inst-a__btn-bg']).toBe(true);
    expect(s1.privateMemory['inst-b:st-toggle:inst-b__btn-bg']).toBeUndefined();
    expect(s1.nodeOverrides['inst-a__btn-label']?.text).toBe('Clicks: 1');
    expect(s1.nodeOverrides['inst-a__btn-bg']?.fill).toBe('#10B981');
    expect(s1.nodeOverrides['inst-b__btn-label']).toBeUndefined();
    expect(s1.nodeOverrides['inst-b__btn-bg']).toBeUndefined();

    // Second click on Instance A toggles A back to #3B82F6 without touching Instance B
    const s2 = rt.dispatchNodeEvent('inst-a__btn-bg', 'click');
    expect(s2.variables['inst-a::var-clicks']).toBe(2);
    expect(s2.variables['inst-b::var-clicks']).toBe(0);
    expect(s2.variables['var-global-total']).toBe(2);
    expect(s2.privateMemory['inst-a:st-toggle:inst-a__btn-bg']).toBe(false);
    expect(s2.nodeOverrides['inst-a__btn-label']?.text).toBe('Clicks: 2');
    expect(s2.nodeOverrides['inst-a__btn-bg']?.fill).toBe('#3B82F6');
    expect(s2.nodeOverrides['inst-b__btn-bg']).toBeUndefined();

    // First click on Instance B independently sets B to #10B981 while A stays unchanged
    const s3 = rt.dispatchNodeEvent('inst-b__btn-bg', 'click');
    expect(s3.variables['inst-a::var-clicks']).toBe(2);
    expect(s3.variables['inst-b::var-clicks']).toBe(1);
    expect(s3.variables['var-global-total']).toBe(3);
    expect(s3.privateMemory['inst-b:st-toggle:inst-b__btn-bg']).toBe(true);
    expect(s3.nodeOverrides['inst-b__btn-label']?.text).toBe('Clicks: 1');
    expect(s3.nodeOverrides['inst-b__btn-bg']?.fill).toBe('#10B981');
    expect(s3.nodeOverrides['inst-a__btn-bg']?.fill).toBe('#3B82F6');

    // `once: true` on Instance A fires once, ignores repeat on A, and STILL fires once on B
    const s4 = rt.dispatchNodeEvent('inst-a__status-dot', 'click');
    expect(s4.variables['inst-a::var-once']).toBe(true);
    expect(s4.variables['inst-a::var-clicks']).toBe(12);
    expect(s4.variables['inst-b::var-once']).toBe(false);
    expect(s4.nodeOverrides['inst-a__status-dot']?.fill).toBe('#F59E0B');
    expect(s4.nodeOverrides['inst-b__status-dot']).toBeUndefined();

    const s5 = rt.dispatchNodeEvent('inst-a__status-dot', 'click');
    expect(s5.variables['inst-a::var-clicks']).toBe(12);

    const s6 = rt.dispatchNodeEvent('inst-b__status-dot', 'click');
    expect(s6.variables['inst-b::var-once']).toBe(true);
    expect(s6.variables['inst-b::var-clicks']).toBe(11);
    expect(s6.nodeOverrides['inst-b__status-dot']?.fill).toBe('#F59E0B');

    // 2. Live Preview HTML + Micro-Runtime parity
    const previewHtml = buildLivePreviewHtml(project);
    expect(previewHtml).toContain('data-folio-id="inst-a__btn-bg"');
    expect(previewHtml).toContain('data-folio-id="inst-b__btn-bg"');

    const previewScript = buildLivePreviewLogicScript(project, page);
    expect(previewScript).not.toBeNull();
    const preview = createPreviewDomHarness(
      previewScript!,
      [
        'inst-a',
        'inst-a__btn-bg',
        'inst-a__btn-label',
        'inst-a__status-dot',
        'inst-b',
        'inst-b__btn-bg',
        'inst-b__btn-label',
        'inst-b__status-dot',
      ],
      {
        initialTextById: {
          'inst-a__btn-label': 'Count: 0',
          'inst-b__btn-label': 'Count: 0',
        },
      },
    );

    preview.click('inst-a__btn-bg');
    expect(preview.elements.get('inst-a__btn-label')?.textContent).toBe('Clicks: 1');
    expect(preview.elements.get('inst-a__btn-bg')?.style.background).toBe('#10B981');
    expect(preview.elements.get('inst-b__btn-label')?.textContent).toBe('Count: 0');
    expect(preview.elements.get('inst-b__btn-bg')?.style.background).toBeUndefined();

    preview.click('inst-a__btn-bg');
    expect(preview.elements.get('inst-a__btn-label')?.textContent).toBe('Clicks: 2');
    expect(preview.elements.get('inst-a__btn-bg')?.style.background).toBe('#3B82F6');

    preview.click('inst-b__btn-bg');
    expect(preview.elements.get('inst-b__btn-label')?.textContent).toBe('Clicks: 1');
    expect(preview.elements.get('inst-b__btn-bg')?.style.background).toBe('#10B981');
    expect(preview.elements.get('inst-a__btn-bg')?.style.background).toBe('#3B82F6');

    preview.click('inst-a__status-dot');
    expect(preview.elements.get('inst-a__status-dot')?.style.background).toBe('#F59E0B');
    expect(preview.elements.get('inst-b__status-dot')?.style.background).toBeUndefined();
    preview.click('inst-b__status-dot');
    expect(preview.elements.get('inst-b__status-dot')?.style.background).toBe('#F59E0B');

    // 3. Exported React TSX — real compiled & executed VDOM parity!
    const reactHarness = createReactTsxHarness(project, pageId);
    const compFile = reactHarness.reactFiles.find((f) => f.path.includes('ToggleCard.tsx'));
    expect(compFile).toBeDefined();
    expect(compFile!.content).toContain('instanceId?: string;');
    expect(compFile!.content).toContain('logicOverrides?:');
    expect(compFile!.content).toContain('onLogicEvent?:');

    expect(reactHarness.getText('inst-a__btn-label')).toBe('Count: 0');
    expect(reactHarness.getText('inst-b__btn-label')).toBe('Count: 0');

    reactHarness.click('inst-a__btn-bg');
    expect(reactHarness.getText('inst-a__btn-label')).toBe('Clicks: 1');
    expect(reactHarness.getStyle('inst-a__btn-bg').background).toBe('#10B981');
    expect(reactHarness.getText('inst-b__btn-label')).toBe('Count: 0');
    expect(reactHarness.getStyle('inst-b__btn-bg').background).toBeUndefined();

    reactHarness.click('inst-a__btn-bg');
    expect(reactHarness.getText('inst-a__btn-label')).toBe('Clicks: 2');
    expect(reactHarness.getStyle('inst-a__btn-bg').background).toBe('#3B82F6');

    reactHarness.click('inst-b__btn-bg');
    expect(reactHarness.getText('inst-b__btn-label')).toBe('Clicks: 1');
    expect(reactHarness.getStyle('inst-b__btn-bg').background).toBe('#10B981');
    expect(reactHarness.getStyle('inst-a__btn-bg').background).toBe('#3B82F6');

    reactHarness.click('inst-a__status-dot');
    expect(reactHarness.getStyle('inst-a__status-dot').background).toBe('#F59E0B');
    expect(reactHarness.getStyle('inst-b__status-dot').background).toBeUndefined();
    reactHarness.click('inst-b__status-dot');
    expect(reactHarness.getStyle('inst-b__status-dot').background).toBe('#F59E0B');
  });

  it('enforces nodeLogicEnabled gate and canonical precedence (Master -> Variants -> Slots -> Local Overrides -> Tokens)', () => {
    // Part A: Disabled master must NOT execute component-scoped graphs & validator emits warning
    const disabledFx = buildTwoInstanceToggleProject({ nodeLogicEnabled: false });
    const disabledPage = getActivePage(disabledFx.project);
    const resolvedDisabled = resolveApplicableGraphsForPage(disabledFx.project, disabledPage);
    expect(resolvedDisabled.graphs).toHaveLength(0);

    const disabledRt = createPrototypeRuntime(disabledFx.project);
    const disabledSnap = disabledRt.dispatchNodeEvent('inst-a__btn-bg', 'click');
    expect(disabledSnap.nodeOverrides['inst-a__btn-label']).toBeUndefined();
    expect(disabledSnap.variables['inst-a::var-clicks']).toBeUndefined();

    const report = validateLogicGraphSemantics(disabledFx.compGraph, disabledFx.project);
    expect(report.warnings.some((d) => d.code === 'COMPONENT_NOT_ENABLED_FOR_LOGIC')).toBe(true);

    // Part B: Enabled master with Variants + Slots + Local Overrides + Tokens
    const base = createInitialProject('Precedence Contract Project');
    const page = getActivePage(base);
    const now = '2026-11-24T00:00:00.000Z';

    const panel: DesignNode = {
      ...createRectNode(1),
      id: 'panel',
      name: 'Card Panel',
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      style: { fill: '#111827', stroke: '#334155', strokeWidth: 1 },
      tokenBindings: { fill: 'tok-brand-fill' },
    };
    const title: DesignNode = {
      ...createTextNode(2),
      id: 'title',
      name: 'Title',
      x: 16,
      y: 16,
      width: 200,
      height: 28,
      text: 'Master Title',
    };
    const badge: DesignNode = {
      ...createRectNode(3),
      id: 'badge',
      name: 'Badge',
      x: 16,
      y: 56,
      width: 80,
      height: 24,
      visible: true,
      style: { fill: '#F59E0B', stroke: 'none', strokeWidth: 0 },
    };

    const master: ComponentDefinition = {
      id: 'comp-prec-card',
      name: 'PrecedenceCard',
      nodeLogicEnabled: true,
      variants: [
        {
          id: 'axis-mode',
          name: 'mode',
          defaultOptionId: 'opt-default',
          options: [
            { id: 'opt-default', label: 'default', overrides: {} },
            {
              id: 'opt-compact',
              label: 'compact',
              overrides: {
                title: { text: 'Variant Title' },
                badge: { visible: false },
              },
            },
          ],
        },
      ],
      slots: [
        {
          id: 'slot-title',
          name: 'titleSlot',
          targetNodeId: 'title',
          defaultText: 'Slot Default Title',
        },
      ],
      document: {
        id: 'doc-prec-card',
        name: 'PrecedenceCard',
        width: 240,
        height: 100,
        background: '#0F172A',
        nodes: [panel, title, badge],
      },
      createdAt: now,
      updatedAt: now,
    };

    // Instance 1: Variant compact + Slot "Slot Assigned" + Local Override "Local Override Title"
    const instLocalOverride: ComponentInstanceNode = {
      id: 'inst-local',
      type: 'component-instance',
      name: 'Card Local',
      componentId: master.id,
      variantSelection: { 'axis-mode': 'opt-compact' },
      slotAssignments: { 'slot-title': { text: 'Slot Assigned Title' } },
      overrides: { title: { text: 'Local Override Title' } },
      x: 20,
      y: 20,
      width: 240,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };

    // Instance 2: Variant compact + Slot "Slot Assigned" (NO local override)
    const instSlotOnly: ComponentInstanceNode = {
      id: 'inst-slot',
      type: 'component-instance',
      name: 'Card Slot',
      componentId: master.id,
      variantSelection: { 'axis-mode': 'opt-compact' },
      slotAssignments: { 'slot-title': { text: 'Slot Assigned Title' } },
      overrides: {},
      x: 280,
      y: 20,
      width: 240,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };

    // Component-scoped graph reads title text & panel token-resolved fill via source.element,
    // and toggles badge visibility (which starts visible: false from variant!)
    const onPanelClick = createLogicNode({ id: 'ev-panel', type: 'event.on-click', data: { targetNodeId: 'panel' } });
    const readTitle = createLogicNode({ id: 'src-title', type: 'source.element', data: { targetNodeId: 'title', property: 'text' } });
    const readPanelFill = createLogicNode({ id: 'src-fill', type: 'source.element', data: { targetNodeId: 'panel', property: 'fill' } });
    const setCapturedText = createLogicNode({ id: 'st-cap-text', type: 'state.update', data: { variableId: 'var-cap-text', operation: 'set' } });
    const setCapturedFill = createLogicNode({ id: 'st-cap-fill', type: 'state.update', data: { variableId: 'var-cap-fill', operation: 'set' } });
    const toggleBadgeVis = createLogicNode({
      id: 'act-toggle-badge',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: 'badge', property: 'visible', visibleMode: 'toggle' },
    });

    const graph = createLogicGraph({
      id: 'graph-prec',
      name: 'Precedence Logic',
      scope: 'component',
      targetId: master.id,
      variables: [
        createLogicVariable({ id: 'var-cap-text', name: 'capturedText', valueType: 'string', initialValue: '', scope: 'local' }),
        createLogicVariable({ id: 'var-cap-fill', name: 'capturedFill', valueType: 'string', initialValue: '', scope: 'local' }),
      ],
      nodes: [onPanelClick, readTitle, readPanelFill, setCapturedText, setCapturedFill, toggleBadgeVis],
      connections: [
        createLogicConnection({ id: 'p1', sourceNodeId: onPanelClick.id, sourcePortId: 'exec', targetNodeId: setCapturedText.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'p2', sourceNodeId: setCapturedText.id, sourcePortId: 'next', targetNodeId: setCapturedFill.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'p3', sourceNodeId: setCapturedFill.id, sourcePortId: 'next', targetNodeId: toggleBadgeVis.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'pd1', sourceNodeId: readTitle.id, sourcePortId: 'value', targetNodeId: setCapturedText.id, targetPortId: 'value' }),
        createLogicConnection({ id: 'pd2', sourceNodeId: readPanelFill.id, sourcePortId: 'value', targetNodeId: setCapturedFill.id, targetPortId: 'value' }),
      ],
    });

    const baseTokens = getProjectDesignTokens(base);
    const project: FolioProject = {
      ...base,
      designTokens: {
        ...baseTokens,
        tokens: [
          ...baseTokens.tokens,
          {
            id: 'tok-brand-fill',
            name: 'brand.accent',
            layer: 'semantic',
            category: 'color',
            value: { kind: 'literal', value: '#6366F1' },
          },
        ],
      },
      components: [master],
      pages: base.pages.map((p) =>
        p.id === page.id
          ? { ...p, document: { ...p.document, nodes: [instLocalOverride, instSlotOnly] } }
          : p,
      ),
      logicGraphs: [graph],
    };

    const resolvedPage = getActivePage(project);
    const resolvedGraphs = resolveApplicableGraphsForPage(project, resolvedPage).graphs;
    const compiled = compilePageLogicRuntimeConfig(project, resolvedPage, resolvedGraphs);
    expect(compiled.nodeMeta['inst-local__title']?.text).toBe('Local Override Title');
    expect(compiled.nodeMeta['inst-slot__title']?.text).toBe('Slot Assigned Title');
    expect(compiled.nodeMeta['inst-local__panel']?.fill).toBe('#6366F1');
    expect(compiled.nodeMeta['inst-local__badge']?.visible).toBe(false);

    // Headless runtime confirms precedence + toggling from variant visible:false -> true
    const rt = createPrototypeRuntime(project);
    const sLocal = rt.dispatchNodeEvent('inst-local__panel', 'click');
    expect(sLocal.variables['inst-local::var-cap-text']).toBe('Local Override Title');
    expect(sLocal.variables['inst-local::var-cap-fill']).toBe('#6366F1');
    expect(sLocal.nodeOverrides['inst-local__badge']?.visible).toBe(true);
    expect(sLocal.nodeOverrides['inst-slot__badge']).toBeUndefined();

    const sSlot = rt.dispatchNodeEvent('inst-slot__panel', 'click');
    expect(sSlot.variables['inst-slot::var-cap-text']).toBe('Slot Assigned Title');
    expect(sSlot.nodeOverrides['inst-slot__badge']?.visible).toBe(true);

    // Live Preview + React TSX toggle badge visibility cleanly
    const previewScript = buildLivePreviewLogicScript(project, resolvedPage)!;
    const preview = createPreviewDomHarness(previewScript, ['inst-local__panel', 'inst-local__badge', 'inst-slot__panel', 'inst-slot__badge'], {
      initialDisplayById: { 'inst-local__badge': 'none', 'inst-slot__badge': 'none' },
    });
    preview.click('inst-local__panel');
    expect(preview.elements.get('inst-local__badge')?.style.display).toBe('block');
    expect(preview.elements.get('inst-slot__badge')?.style.display).toBe('none');

    const reactHarness = createReactTsxHarness(project, page.id);
    expect(reactHarness.getText('inst-local__title')).toBe('Local Override Title');
    expect(reactHarness.getText('inst-slot__title')).toBe('Slot Assigned Title');
    reactHarness.click('inst-local__panel');
    expect(reactHarness.getStyle('inst-local__badge').display).toBe('block');
    expect(reactHarness.getStyle('inst-slot__badge').display).toBeUndefined();
  });

  it('propagates PipelineContext.origin and isolates Baked Frame private memory across nested component instances in all 3 runtimes', () => {
    const base = createInitialProject('Nested Component Logic Project');
    const page = getActivePage(base);
    const now = '2026-11-24T00:00:00.000Z';

    const innerDot: DesignNode = {
      ...createRectNode(1),
      id: 'dot',
      name: 'Inner Dot',
      x: 8,
      y: 8,
      width: 32,
      height: 32,
      style: { fill: '#64748B', stroke: 'none', strokeWidth: 0 },
    };
    const innerLabel: DesignNode = {
      ...createTextNode(2),
      id: 'badge-text',
      name: 'Badge Text',
      x: 48,
      y: 12,
      width: 160,
      height: 24,
      text: 'Idle',
    };
    const innerMaster: ComponentDefinition = {
      id: 'comp-inner-badge',
      name: 'InnerBadge',
      nodeLogicEnabled: true,
      document: {
        id: 'doc-inner',
        name: 'InnerBadge',
        width: 220,
        height: 48,
        background: '#0F172A',
        nodes: [innerDot, innerLabel],
      },
      createdAt: now,
      updatedAt: now,
    };

    const nestedInst: ComponentInstanceNode = {
      id: 'inner-badge',
      type: 'component-instance',
      name: 'Nested Badge',
      componentId: innerMaster.id,
      overrides: {},
      x: 16,
      y: 16,
      width: 220,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    const outerMaster: ComponentDefinition = {
      id: 'comp-outer-card',
      name: 'OuterCard',
      nodeLogicEnabled: true,
      document: {
        id: 'doc-outer',
        name: 'OuterCard',
        width: 260,
        height: 96,
        background: '#0F172A',
        nodes: [nestedInst],
      },
      createdAt: now,
      updatedAt: now,
    };

    const outerA: ComponentInstanceNode = {
      id: 'outer-a',
      type: 'component-instance',
      name: 'Outer A',
      componentId: outerMaster.id,
      overrides: {},
      x: 20,
      y: 20,
      width: 260,
      height: 96,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    const outerB: ComponentInstanceNode = {
      id: 'outer-b',
      type: 'component-instance',
      name: 'Outer B',
      componentId: outerMaster.id,
      overrides: {},
      x: 320,
      y: 20,
      width: 260,
      height: 96,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };

    const evClick = createLogicNode({ id: 'ev-inner-click', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'dot' } });
    const tog = createLogicNode({ id: 'tog-inner', type: 'state.toggle', x: 240, y: 0, data: { variableId: '', initialValue: false } });
    const br = createLogicNode({ id: 'br-inner', type: 'logic.branch', x: 460, y: 0, data: { mode: 'if-else', pipelineRef: 'step:tog-inner:value' } });
    const setOn = createLogicNode({ id: 'act-inner-on', type: 'action.set-layer', x: 680, y: -40, data: { targetMode: 'pipeline', property: 'fill', fill: '#22C55E' } });
    const setOff = createLogicNode({ id: 'act-inner-off', type: 'action.set-layer', x: 680, y: 60, data: { targetMode: 'pipeline', property: 'fill', fill: '#64748B' } });
    const setOriginText = createLogicNode({
      id: 'act-origin-text',
      type: 'action.set-layer',
      x: 920,
      y: -40,
      data: { targetMode: 'override', targetNodeId: 'badge-text', property: 'text', pipelineRef: 'origin:instanceId' },
    });

    const rawGraph = createLogicGraph({
      id: 'graph-inner-badge',
      name: 'InnerBadge Logic',
      scope: 'component',
      targetId: innerMaster.id,
      nodes: [evClick, tog, br, setOn, setOff, setOriginText],
      connections: [
        createLogicConnection({ id: 'n1', sourceNodeId: evClick.id, sourcePortId: 'exec', targetNodeId: tog.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'n2', sourceNodeId: tog.id, sourcePortId: 'next', targetNodeId: br.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'n3', sourceNodeId: br.id, sourcePortId: 'true', targetNodeId: setOn.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'n4', sourceNodeId: br.id, sourcePortId: 'false', targetNodeId: setOff.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'n5', sourceNodeId: setOn.id, sourcePortId: 'next', targetNodeId: setOriginText.id, targetPortId: 'exec' }),
      ],
    });

    const draftProject: FolioProject = {
      ...base,
      components: [innerMaster, outerMaster],
      pages: base.pages.map((p) =>
        p.id === page.id ? { ...p, document: { ...p.document, nodes: [outerA, outerB] } } : p,
      ),
      logicGraphs: [rawGraph],
    };

    const { graph: framed, frame } = createFrameInGraph(rawGraph, {
      title: 'Inner Toggle Frame',
      color: 'emerald',
      childNodeIds: [tog.id, br.id, setOn.id, setOff.id],
    });
    const baked = bakeLogicFrame(framed, frame.id, draftProject);
    expect(baked.ok).toBe(true);

    const project: FolioProject = { ...draftProject, logicGraphs: [baked.graph] };
    const activePage = getActivePage(project);

    // 1. Headless Runtime
    const rt = createPrototypeRuntime(project);
    const s1 = rt.dispatchNodeEvent('outer-a__inner-badge__dot', 'click');
    const expectedMemKeyA = `outer-a__inner-badge:${frame.id}:${tog.id}:outer-a__inner-badge__dot`;
    const expectedMemKeyB = `outer-b__inner-badge:${frame.id}:${tog.id}:outer-b__inner-badge__dot`;
    expect(s1.privateMemory[expectedMemKeyA]).toBe(true);
    expect(s1.privateMemory[expectedMemKeyB]).toBeUndefined();
    expect(s1.nodeOverrides['outer-a__inner-badge__dot']?.fill).toBe('#22C55E');
    expect(s1.nodeOverrides['outer-a__inner-badge__badge-text']?.text).toBe('outer-a__inner-badge');
    expect(s1.nodeOverrides['outer-b__inner-badge__dot']).toBeUndefined();
    expect(s1.nodeOverrides['outer-b__inner-badge__badge-text']).toBeUndefined();

    // Clicking outer-b nested dot independently updates outer-b without affecting outer-a
    const s2 = rt.dispatchNodeEvent('outer-b__inner-badge__dot', 'click');
    expect(s2.privateMemory[expectedMemKeyB]).toBe(true);
    expect(s2.nodeOverrides['outer-b__inner-badge__dot']?.fill).toBe('#22C55E');
    expect(s2.nodeOverrides['outer-b__inner-badge__badge-text']?.text).toBe('outer-b__inner-badge');

    // 2. Live Preview HTML + Script
    const html = buildLivePreviewHtml(project);
    expect(html).toContain('data-folio-id="outer-a__inner-badge__dot"');
    expect(html).toContain('data-folio-id="outer-b__inner-badge__dot"');
    const script = buildLivePreviewLogicScript(project, activePage)!;
    const preview = createPreviewDomHarness(script, [
      'outer-a__inner-badge__dot',
      'outer-a__inner-badge__badge-text',
      'outer-b__inner-badge__dot',
      'outer-b__inner-badge__badge-text',
    ]);
    preview.click('outer-a__inner-badge__dot');
    expect(preview.elements.get('outer-a__inner-badge__dot')?.style.background).toBe('#22C55E');
    expect(preview.elements.get('outer-a__inner-badge__badge-text')?.textContent).toBe('outer-a__inner-badge');
    expect(preview.elements.get('outer-b__inner-badge__dot')?.style.background).toBeUndefined();
    preview.click('outer-b__inner-badge__dot');
    expect(preview.elements.get('outer-b__inner-badge__dot')?.style.background).toBe('#22C55E');
    expect(preview.elements.get('outer-b__inner-badge__badge-text')?.textContent).toBe('outer-b__inner-badge');

    // 3. Exported React TSX — real nested component execution parity!
    const reactHarness = createReactTsxHarness(project, page.id);
    reactHarness.click('outer-a__inner-badge__dot');
    expect(reactHarness.getStyle('outer-a__inner-badge__dot').background).toBe('#22C55E');
    expect(reactHarness.getText('outer-a__inner-badge__badge-text')).toBe('outer-a__inner-badge');
    expect(reactHarness.getStyle('outer-b__inner-badge__dot').background).toBeUndefined();
    reactHarness.click('outer-b__inner-badge__dot');
    expect(reactHarness.getStyle('outer-b__inner-badge__dot').background).toBe('#22C55E');
    expect(reactHarness.getText('outer-b__inner-badge__badge-text')).toBe('outer-b__inner-badge');
  });

  it('preserves .flop JSON v2 save/reload roundtrip without leaking expanded instance graphs and keeps Undo/Redo intact', () => {
    const { project, master, compGraph } = buildTwoInstanceToggleProject({ nodeLogicEnabled: true });

    // 1. .flop JSON v2 save/reload roundtrip
    const flopJson = serializeProjectToFlopJson(project);
    expect(flopJson).not.toContain(COMPONENT_GRAPH_INSTANCE_MARKER);
    expect(flopJson).not.toContain('inst-a__btn-bg');
    expect(flopJson).not.toContain('inst-a::var-clicks');

    const reloaded = migrateProjectToV2(JSON.parse(flopJson));
    expect(reloaded.logicGraphs).toHaveLength(1);
    expect(reloaded.logicGraphs[0].scope).toBe('component');
    expect(reloaded.logicGraphs[0].targetId).toBe(master.id);
    expect(reloaded.components[0].nodeLogicEnabled).toBe(true);

    // Reloaded project executes component-scoped per-instance logic identically
    const rt = createPrototypeRuntime(reloaded);
    const snap = rt.dispatchNodeEvent('inst-a__btn-bg', 'click');
    expect(snap.nodeOverrides['inst-a__btn-label']?.text).toBe('Clicks: 1');
    expect(snap.nodeOverrides['inst-b__btn-label']).toBeUndefined();

    // 2. Canonical Editor Store Undo/Redo for nodeLogicEnabled + component logic graph
    const store = createCanonicalEditorStore(createEditorState(reloaded));
    const currentComp = store.getSnapshot().editorState.project.components[0];

    store.dispatchLegacyAction({
      type: 'update-component-contract',
      componentId: currentComp.id,
      expectedMasterDocument: currentComp.document,
      expectedUpdatedAt: currentComp.updatedAt,
      nodeLogicEnabled: false,
    });
    expect(store.getSnapshot().editorState.project.components[0].nodeLogicEnabled).toBeFalsy();

    store.dispatchLegacyAction({
      type: 'update-logic-graph',
      graph: { ...compGraph, name: 'Renamed Component Logic' },
    });
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('Renamed Component Logic');

    // Undo graph rename
    store.dispatchLegacyAction({ type: 'undo' });
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('ToggleCard Logic');

    // Undo nodeLogicEnabled disable
    store.dispatchLegacyAction({ type: 'undo' });
    expect(store.getSnapshot().editorState.project.components[0].nodeLogicEnabled).toBe(true);

    // Redo both steps cleanly
    store.dispatchLegacyAction({ type: 'redo' });
    expect(store.getSnapshot().editorState.project.components[0].nodeLogicEnabled).toBeFalsy();
    store.dispatchLegacyAction({ type: 'redo' });
    expect(store.getSnapshot().editorState.project.logicGraphs[0].name).toBe('Renamed Component Logic');
  });
});

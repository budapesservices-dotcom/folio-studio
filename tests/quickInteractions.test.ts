import { describe, expect, it } from 'vitest';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { createInteractiveStarterProject } from '../src/app/workspace/starterProject';
import {
  adaptQuickInteractionConfigForActionKind,
  createDefaultQuickInteractionConfig,
  createQuickInteractionInProject,
  deleteQuickInteractionFromGraph,
  extractLayerInteractions,
  updateQuickInteractionInGraph,
  validateQuickInteractionConfig,
} from '../src/app/workspace/quickInteractions';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { ComponentDefinition, ComponentInstanceNode, FolioProject } from '../src/core/document/types';
import {
  buildLivePreviewLogicScript,
  createPrototypeRuntime,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';

function buildFixtureProject(): {
  project: FolioProject;
  pageId: string;
  buttonId: string;
  modalId: string;
  titleId: string;
  instanceId: string;
  axisId: string;
  primaryOptId: string;
  dangerOptId: string;
} {
  const project = createInitialProject('Quick Interactions Fixture');
  const homePage = project.pages[0];
  project.pages.push({
    id: 'page-about',
    name: 'About',
    route: '/about',
    document: {
      id: 'doc-about',
      name: 'About',
      width: 1440,
      height: 900,
      background: '#ffffff',
      nodes: [],
    },
  });

  const button = createRectNode(0);
  button.name = 'Open Modal Button';

  const modal = createRectNode(1);
  modal.name = 'Settings Modal';
  modal.visible = true;

  const title = createTextNode(2);
  title.name = 'Status Label';
  title.text = 'Hello';

  const masterRect = createRectNode(3);
  masterRect.name = 'Badge BG';

  const axisId = 'axis-tone';
  const primaryOptId = 'opt-primary';
  const dangerOptId = 'opt-danger';
  const badgeComponent: ComponentDefinition = {
    id: 'comp-badge',
    name: 'Status Badge',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    variants: [
      {
        id: axisId,
        name: 'Tone',
        defaultOptionId: primaryOptId,
        options: [
          { id: primaryOptId, label: 'Primary', overrides: {} },
          { id: dangerOptId, label: 'Danger', overrides: {} },
        ],
      },
    ],
    document: {
      id: 'doc-comp-badge',
      name: 'Status Badge',
      width: 120,
      height: 40,
      background: 'transparent',
      nodes: [masterRect],
    },
  };

  const instanceNode: ComponentInstanceNode = {
    id: 'inst-badge-1',
    type: 'component-instance',
    name: 'Header Badge',
    x: 40,
    y: 180,
    width: 120,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    componentId: badgeComponent.id,
    variantSelection: { [axisId]: primaryOptId },
    overrides: {},
  };

  homePage.document.nodes = [button, modal, title, instanceNode];
  project.components = [badgeComponent];
  project.logicGraphs = [];

  return {
    project,
    pageId: homePage.id,
    buttonId: button.id,
    modalId: modal.id,
    titleId: title.id,
    instanceId: instanceNode.id,
    axisId,
    primaryOptId,
    dangerOptId,
  };
}

describe('Quick Interaction Builder (Phase 3)', () => {
  it('auto-generates a clean 2-node, 1-wire visibility toggle graph with zero manual variables or NOT nodes and executes in runtime', () => {
    const fixture = buildFixtureProject();
    const page = fixture.project.pages[0];
    const button = page.document.nodes.find((n) => n.id === fixture.buttonId)!;

    const config = createDefaultQuickInteractionConfig({
      selectedNode: button,
      scopedNodes: page.document.nodes,
      pages: fixture.project.pages,
      activePageId: fixture.pageId,
      components: fixture.project.components,
    });

    // Smart default should pick "Settings Modal" for visibility toggle
    expect(config.trigger).toBe('on-click');
    expect(config.actionKind).toBe('visibility');
    expect(config.visibleMode).toBe('toggle');
    expect(config.targetNodeId).toBe(fixture.modalId);

    const created = createQuickInteractionInProject(
      fixture.project,
      {
        scope: 'page',
        scopeTargetId: fixture.pageId,
        scopeName: page.name,
        layerId: fixture.buttonId,
      },
      config,
    );

    expect(created.mode).toBe('create');
    expect(created.graph.nodes).toHaveLength(2);
    expect(created.graph.connections).toHaveLength(1);
    expect(created.graph.variables).toHaveLength(0);

    const [triggerNode, actionNode] = created.graph.nodes;
    const [wire] = created.graph.connections;
    expect(triggerNode.type).toBe('event.on-click');
    expect(triggerNode.data.targetNodeId).toBe(fixture.buttonId);
    expect(actionNode.type).toBe('action.set-layer');
    expect(actionNode.data.property).toBe('visible');
    expect(actionNode.data.visibleMode).toBe('toggle');
    expect(actionNode.data.targetNodeId).toBe(fixture.modalId);
    expect(wire.sourceNodeId).toBe(triggerNode.id);
    expect(wire.sourcePortId).toBe('exec');
    expect(wire.targetNodeId).toBe(actionNode.id);
    expect(wire.targetPortId).toBe('exec');

    const projectWithGraph: FolioProject = {
      ...fixture.project,
      logicGraphs: [created.graph],
    };

    const validation = validateLogicGraphSemantics(created.graph, projectWithGraph);
    expect(validation.ok).toBe(true);
    expect(validation.diagnostics).toHaveLength(0);

    // Verify deterministic runtime toggling: visible true -> false -> true
    const runtime = createPrototypeRuntime(projectWithGraph, { pageId: fixture.pageId });
    expect(runtime.getSnapshot().nodeOverrides[fixture.modalId]?.visible).toBeUndefined();

    runtime.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(runtime.getSnapshot().nodeOverrides[fixture.modalId]?.visible).toBe(false);

    runtime.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(runtime.getSnapshot().nodeOverrides[fixture.modalId]?.visible).toBe(true);
  });

  it('generates semantically valid 2-node/1-wire graphs for Navigate, Set Variant, Set Layer Property, Show Toast, On Hover, and On Submit', () => {
    const fixture = buildFixtureProject();
    const page = fixture.project.pages[0];
    const button = page.document.nodes.find((n) => n.id === fixture.buttonId)!;
    const base = createDefaultQuickInteractionConfig({
      selectedNode: button,
      scopedNodes: page.document.nodes,
      pages: fixture.project.pages,
      activePageId: fixture.pageId,
      components: fixture.project.components,
    });

    // 1. On Hover -> Show Toast
    const toastConfig = {
      ...adaptQuickInteractionConfigForActionKind(base, 'show-toast', {
        layerId: fixture.buttonId,
        scopedNodes: page.document.nodes,
        pages: fixture.project.pages,
        activePageId: fixture.pageId,
        components: fixture.project.components,
      }),
      trigger: 'on-hover' as const,
      hoverPhase: 'enter' as const,
      toastMessage: 'Saved successfully',
      toastTone: 'success' as const,
    };
    const resToast = createQuickInteractionInProject(
      fixture.project,
      { scope: 'page', scopeTargetId: fixture.pageId, scopeName: page.name, layerId: fixture.buttonId },
      toastConfig,
    );
    const projToast: FolioProject = { ...fixture.project, logicGraphs: [resToast.graph] };
    expect(validateLogicGraphSemantics(resToast.graph, projToast).ok).toBe(true);
    const rtToast = createPrototypeRuntime(projToast, { pageId: fixture.pageId });
    rtToast.dispatchNodeEvent(fixture.buttonId, 'hover-enter');
    expect(rtToast.getSnapshot().toasts?.[0]?.message).toBe('Saved successfully');

    // 2. On Click -> Navigate to /about
    const navConfig = adaptQuickInteractionConfigForActionKind(base, 'navigate', {
      layerId: fixture.buttonId,
      scopedNodes: page.document.nodes,
      pages: fixture.project.pages,
      activePageId: fixture.pageId,
      components: fixture.project.components,
    });
    expect(navConfig.route).toBe('/about');
    const resNav = createQuickInteractionInProject(
      fixture.project,
      { scope: 'page', scopeTargetId: fixture.pageId, scopeName: page.name, layerId: fixture.buttonId },
      navConfig,
    );
    const projNav: FolioProject = { ...fixture.project, logicGraphs: [resNav.graph] };
    expect(validateLogicGraphSemantics(resNav.graph, projNav).ok).toBe(true);
    const rtNav = createPrototypeRuntime(projNav, { pageId: fixture.pageId });
    rtNav.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(rtNav.getSnapshot().activeRoute).toBe('/about');

    // 3. On Click -> Set Variant
    const variantConfig = {
      ...adaptQuickInteractionConfigForActionKind(base, 'set-variant', {
        layerId: fixture.buttonId,
        scopedNodes: page.document.nodes,
        pages: fixture.project.pages,
        activePageId: fixture.pageId,
        components: fixture.project.components,
      }),
      optionId: fixture.dangerOptId,
    };
    expect(
      validateQuickInteractionConfig(variantConfig, {
        scopedNodes: page.document.nodes,
        components: fixture.project.components,
      }),
    ).toBeNull();
    const resVariant = createQuickInteractionInProject(
      fixture.project,
      { scope: 'page', scopeTargetId: fixture.pageId, scopeName: page.name, layerId: fixture.buttonId },
      variantConfig,
    );
    const projVariant: FolioProject = { ...fixture.project, logicGraphs: [resVariant.graph] };
    expect(validateLogicGraphSemantics(resVariant.graph, projVariant).ok).toBe(true);
    const rtVariant = createPrototypeRuntime(projVariant, { pageId: fixture.pageId });
    rtVariant.dispatchNodeEvent(fixture.buttonId, 'click');
    expect(rtVariant.getSnapshot().nodeOverrides[fixture.instanceId]?.variantSelection?.[fixture.axisId]).toBe(
      fixture.dangerOptId,
    );

    // 4. On Submit -> Set Layer Property (Text)
    const propConfig = {
      ...adaptQuickInteractionConfigForActionKind(base, 'set-layer-property', {
        layerId: fixture.buttonId,
        scopedNodes: page.document.nodes,
        pages: fixture.project.pages,
        activePageId: fixture.pageId,
        components: fixture.project.components,
      }),
      trigger: 'on-submit' as const,
      targetNodeId: fixture.titleId,
      layerProperty: 'text' as const,
      text: 'Submitted!',
    };
    const resSubmit = createQuickInteractionInProject(
      fixture.project,
      { scope: 'page', scopeTargetId: fixture.pageId, scopeName: page.name, layerId: fixture.buttonId },
      propConfig,
    );
    const projSubmit: FolioProject = { ...fixture.project, logicGraphs: [resSubmit.graph] };
    expect(validateLogicGraphSemantics(resSubmit.graph, projSubmit).ok).toBe(true);
    expect(resSubmit.graph.nodes[0].type).toBe('event.on-input');
    expect(resSubmit.graph.nodes[0].data.mode).toBe('submit');

    const rtSubmit = createPrototypeRuntime(projSubmit, { pageId: fixture.pageId });
    rtSubmit.dispatchNodeEvent(fixture.buttonId, 'input');
    expect(rtSubmit.getSnapshot().nodeOverrides[fixture.titleId]?.text).toBe('Submitted!');

    // Verify Live Preview HTML/JS codegen reads n.data.mode ("submit")
    const previewScript = buildLivePreviewLogicScript(projSubmit, page);
    expect(previewScript).toContain('n.data.mode || n.data.trigger');
  });

  it('maintains two-way sync with LogicGraph and supports full Undo/Redo via canonical store', () => {
    const fixture = buildFixtureProject();
    const page = fixture.project.pages[0];
    const button = page.document.nodes.find((n) => n.id === fixture.buttonId)!;

    const store = createCanonicalEditorStore(createEditorState(fixture.project));
    const client = createMainCanvasCommandClient(store);

    const initialConfig = createDefaultQuickInteractionConfig({
      selectedNode: button,
      scopedNodes: page.document.nodes,
      pages: fixture.project.pages,
      activePageId: fixture.pageId,
      components: fixture.project.components,
    });

    // 1. Create interaction via Native Command
    const created = createQuickInteractionInProject(
      store.getSnapshot().editorState.project,
      { scope: 'page', scopeTargetId: fixture.pageId, scopeName: page.name, layerId: fixture.buttonId },
      initialConfig,
    );
    const createRes = client.createLogicGraph(created.graph, 'Add quick interaction');
    expect(createRes.status).toBe('applied');

    let project = store.getSnapshot().editorState.project;
    let extracted = extractLayerInteractions(project, 'page', fixture.pageId, fixture.buttonId, page.document.nodes);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].editable).toBe(true);
    expect(extracted[0].config?.visibleMode).toBe('toggle');
    expect(extracted[0].focusNodeIds).toEqual([created.triggerNodeId, created.actionNodeId]);

    // 2. Edit in-place via Quick Interaction Builder (preserves IDs & positions, zero orphan nodes)
    const editedGraph = updateQuickInteractionInGraph(
      project.logicGraphs[0],
      extracted[0],
      fixture.buttonId,
      {
        ...extracted[0].config!,
        trigger: 'on-hover',
        hoverPhase: 'leave',
        visibleMode: 'hide',
      },
    );
    client.updateLogicGraph(editedGraph, 'Update quick interaction');

    project = store.getSnapshot().editorState.project;
    expect(project.logicGraphs[0].nodes).toHaveLength(2);
    expect(project.logicGraphs[0].connections).toHaveLength(1);
    expect(project.logicGraphs[0].nodes[0].id).toBe(created.triggerNodeId);
    expect(project.logicGraphs[0].nodes[1].id).toBe(created.actionNodeId);

    extracted = extractLayerInteractions(project, 'page', fixture.pageId, fixture.buttonId, page.document.nodes);
    expect(extracted[0].config?.trigger).toBe('on-hover');
    expect(extracted[0].config?.hoverPhase).toBe('leave');
    expect(extracted[0].config?.visibleMode).toBe('hide');

    // 3. Simulate external edit inside Node Logic Graph -> reflected back in Inspector extraction
    const externallyEditedGraph = {
      ...project.logicGraphs[0],
      nodes: project.logicGraphs[0].nodes.map((n) =>
        n.id === created.actionNodeId
          ? {
              ...n,
              type: 'action.overlay-toast',
              data: { mode: 'show-toast', message: 'From Node Graph', tone: 'warning' },
            }
          : n,
      ),
    };
    client.updateLogicGraph(externallyEditedGraph, 'Edit action in Node Graph');

    project = store.getSnapshot().editorState.project;
    extracted = extractLayerInteractions(project, 'page', fixture.pageId, fixture.buttonId, page.document.nodes);
    expect(extracted[0].editable).toBe(true);
    expect(extracted[0].config?.actionKind).toBe('show-toast');
    expect(extracted[0].config?.toastMessage).toBe('From Node Graph');
    expect(extracted[0].config?.toastTone).toBe('warning');

    // 4. Delete interaction -> Undo restores it -> Redo removes it again
    const afterDelete = deleteQuickInteractionFromGraph(project.logicGraphs[0], extracted[0]);
    client.updateLogicGraph(afterDelete, 'Remove quick interaction');
    project = store.getSnapshot().editorState.project;
    expect(project.logicGraphs[0].nodes).toHaveLength(0);
    expect(project.logicGraphs[0].connections).toHaveLength(0);
    expect(
      extractLayerInteractions(project, 'page', fixture.pageId, fixture.buttonId, page.document.nodes),
    ).toHaveLength(0);

    expect(client.undo().status).toBe('applied');
    project = store.getSnapshot().editorState.project;
    expect(project.logicGraphs[0].nodes).toHaveLength(2);
    expect(project.logicGraphs[0].connections).toHaveLength(1);
    const restored = extractLayerInteractions(project, 'page', fixture.pageId, fixture.buttonId, page.document.nodes);
    expect(restored).toHaveLength(1);
    expect(restored[0].config?.toastMessage).toBe('From Node Graph');

    expect(client.redo().status).toBe('applied');
    project = store.getSnapshot().editorState.project;
    expect(project.logicGraphs[0].nodes).toHaveLength(0);
  });

  it('coexists safely with complex multi-node starter flows without overwriting them', () => {
    const starterProject = createInteractiveStarterProject('First canvas');
    const activePage = getActivePage(starterProject);
    const visualCard = activePage.document.nodes.find((n) => n.name === 'Visual card')!;
    const sun = activePage.document.nodes.find((n) => n.name === 'Sun')!;
    expect(visualCard).toBeDefined();
    expect(sun).toBeDefined();

    // Starter graph has a multi-node flow triggered by Visual card
    const existingEntries = extractLayerInteractions(
      starterProject,
      'page',
      activePage.id,
      visualCard.id,
      activePage.document.nodes,
    );
    expect(existingEntries).toHaveLength(1);
    expect(existingEntries[0].editable).toBe(false);
    expect(existingEntries[0].nodeCountInFlow).toBeGreaterThan(2);
    expect(existingEntries[0].focusNodeIds.length).toBeGreaterThan(2);

    const existingNodeCount = starterProject.logicGraphs[0].nodes.length;
    const existingConnCount = starterProject.logicGraphs[0].connections.length;
    const maxExistingY = Math.max(...starterProject.logicGraphs[0].nodes.map((n) => n.y));

    // Adding a Quick Interaction appends cleanly below existing nodes
    const quickCfg = {
      ...createDefaultQuickInteractionConfig({
        selectedNode: visualCard,
        scopedNodes: activePage.document.nodes,
        pages: starterProject.pages,
        activePageId: activePage.id,
        components: starterProject.components,
      }),
      targetNodeId: sun.id,
      visibleMode: 'toggle' as const,
    };
    const appended = createQuickInteractionInProject(
      starterProject,
      { scope: 'page', scopeTargetId: activePage.id, scopeName: activePage.name, layerId: visualCard.id },
      quickCfg,
    );

    expect(appended.mode).toBe('update');
    expect(appended.graph.nodes).toHaveLength(existingNodeCount + 2);
    expect(appended.graph.connections).toHaveLength(existingConnCount + 1);
    const newTrigger = appended.graph.nodes.find((n) => n.id === appended.triggerNodeId)!;
    const newAction = appended.graph.nodes.find((n) => n.id === appended.actionNodeId)!;
    expect(newTrigger.y).toBeGreaterThan(maxExistingY);
    expect(newAction.y).toBe(newTrigger.y);

    const updatedProject: FolioProject = {
      ...starterProject,
      logicGraphs: [appended.graph],
    };
    expect(validateLogicGraphSemantics(appended.graph, updatedProject).ok).toBe(true);

    const combinedEntries = extractLayerInteractions(
      updatedProject,
      'page',
      activePage.id,
      visualCard.id,
      activePage.document.nodes,
    );
    expect(combinedEntries).toHaveLength(2);
    expect(combinedEntries.filter((e) => !e.editable)).toHaveLength(1);
    expect(combinedEntries.filter((e) => e.editable)).toHaveLength(1);
  });
});

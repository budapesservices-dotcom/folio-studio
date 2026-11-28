import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import {
  STUDIO_TEMPLATE_CATALOG,
  buildTemplateComponentAndInstance,
  buildTemplatePageBundle,
  buildTemplatePreviewDocument,
  computeTemplateInsertionOrigin,
  countMatchingTemplatesByCategory,
  filterStudioTemplates,
  getStudioTemplate,
  getTemplateLogicNodeCount,
  groupTemplatesByCategory,
  instantiateTemplateBundle,
  instantiateTemplateNodes,
  splitHighlightSegments,
  tokenizeTemplateSearch,
} from '../src/core/document/templates';
import { validateProject } from '../src/core/document/validation';
import { createPrototypeRuntime } from '../src/engines/prototype/runtime';
import { validateLogicGraphSemantics } from '../src/engines/prototype/validator';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import {
  createComponentCanvasCommandClient,
  createMainCanvasCommandClient,
} from '../src/app/mainCanvasCommandClient';

describe('Interactive UI, Section, Page & Vector Template Library', () => {
  it('provides UI, Sections, Pages, and Vector Starter Kits with valid .flop v2 geometry AND valid Node Logic graphs', () => {
    const categories = new Set(STUDIO_TEMPLATE_CATALOG.map((item) => item.category));
    expect(categories).toEqual(new Set(['ui', 'sections', 'pages', 'vectors']));
    expect(STUDIO_TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(23);

    for (const template of STUDIO_TEMPLATE_CATALOG) {
      const project = createInitialProject(`Validate ${template.name}`);
      const page = getActivePage(project);
      const origin = computeTemplateInsertionOrigin(page.document, template, 0);
      const bundle = instantiateTemplateBundle(template, origin, {
        scope: 'page',
        targetId: page.id,
      });
      expect(bundle.nodes.length, `Template ${template.id} must produce at least 1 node`).toBeGreaterThan(0);

      page.document.nodes = bundle.nodes;
      if (bundle.logicGraph) {
        project.logicGraphs = [bundle.logicGraph];
      }

      const validation = validateProject(project);
      expect(validation.ok, `Template ${template.id} failed project validation: ${validation.error ?? ''}`).toBe(true);

      // Every UI, Section, and Page template must come with working wired Node Logic
      if (template.category !== 'vectors') {
        expect(bundle.logicGraph, `Template ${template.id} must include a LogicGraph`).not.toBeNull();
        expect(bundle.logicNodeCount, `Template ${template.id} must have logic nodes`).toBeGreaterThanOrEqual(4);
        expect(getTemplateLogicNodeCount(template)).toBe(bundle.logicNodeCount);

        const semantics = validateLogicGraphSemantics(bundle.logicGraph!, project);
        const errors = semantics.diagnostics.filter((issue) => issue.severity === 'error');
        expect(
          errors,
          `Template ${template.id} logic graph semantic errors: ${JSON.stringify(errors)}`,
        ).toEqual([]);
      }

      const previewDoc = buildTemplatePreviewDocument(template);
      expect(previewDoc.nodes.length).toBe(bundle.nodes.length);
      expect(previewDoc.width).toBe(template.width);
      expect(previewDoc.height).toBe(template.height);
    }
  });

  it('executes interactive UI, Section, and Page template Node Logic cleanly in the Prototype Runtime', async () => {
    // 1. UI Quantity & Total Stepper (+ / + / Reset)
    {
      const template = getStudioTemplate('ui-quantity-stepper')!;
      const project = createInitialProject('Stepper Runtime');
      const page = getActivePage(project);
      const built = instantiateTemplateBundle(template, { x: 40, y: 40 }, { scope: 'page', targetId: page.id });
      page.document.nodes = built.nodes;
      project.logicGraphs = [built.logicGraph!];

      const plus = built.nodes.find((n) => n.name === 'Increase Button')!;
      const reset = built.nodes.find((n) => n.name === 'Reset Button')!;
      const qtyTxt = built.nodes.find((n) => n.name === 'Quantity Readout')!;
      const totalTxt = built.nodes.find((n) => n.name === 'Subtotal Amount')!;

      const runtime = createPrototypeRuntime(project);
      runtime.dispatchNodeEvent(plus.id, 'click');
      runtime.dispatchNodeEvent(plus.id, 'click');
      let snap = runtime.getSnapshot();
      expect(snap.nodeOverrides[qtyTxt.id]?.text).toBe('4');
      expect(snap.nodeOverrides[totalTxt.id]?.text).toBe('$196.00');

      runtime.dispatchNodeEvent(reset.id, 'click');
      snap = runtime.getSnapshot();
      expect(snap.nodeOverrides[qtyTxt.id]?.text).toBe('2');
      expect(snap.nodeOverrides[totalTxt.id]?.text).toBe('$98.00');
    }

    // 2. Section Pricing Tiers (Annual switch updates all 3 plan prices)
    {
      const template = getStudioTemplate('section-pricing-tiers')!;
      const project = createInitialProject('Pricing Runtime');
      const page = getActivePage(project);
      const built = instantiateTemplateBundle(template, { x: 0, y: 0 }, { scope: 'page', targetId: page.id });
      page.document.nodes = built.nodes;
      project.logicGraphs = [built.logicGraph!];

      const annualBtn = built.nodes.find((n) => n.name === 'Annual Button')!;
      const proPrice = built.nodes.find((n) => n.name === 'Pro Studio Price')!;
      const entPrice = built.nodes.find((n) => n.name === 'Enterprise Price')!;

      const runtime = createPrototypeRuntime(project);
      runtime.dispatchNodeEvent(annualBtn.id, 'click');
      const snap = runtime.getSnapshot();
      expect(snap.nodeOverrides[proPrice.id]?.text).toBe('$39');
      expect(snap.nodeOverrides[entPrice.id]?.text).toBe('$119');
    }

    // 3. Full Page Product Checkout (Finish Swatch + Stepper Math + Add to Bag counter & toast)
    {
      const template = getStudioTemplate('page-product-checkout')!;
      const project = createInitialProject('Checkout Runtime');
      const { page, logicGraph } = buildTemplatePageBundle(template, project.pages);
      project.pages.push(page);
      project.activePageId = page.id;
      project.logicGraphs = [logicGraph!];

      const swSand = page.document.nodes.find((n) => n.name === 'Swatch: Sandstone')!;
      const chassis = page.document.nodes.find((n) => n.name === 'Monitor Chassis')!;
      const qtyPlus = page.document.nodes.find((n) => n.name === 'Increase Quantity')!;
      const subtotal = page.document.nodes.find((n) => n.name === 'Subtotal Amount')!;
      const addBtn = page.document.nodes.find((n) => n.name === 'Add to Bag Button')!;
      const bagText = page.document.nodes.find((n) => n.name === 'Bag Count Readout')!;

      const runtime = createPrototypeRuntime(project);
      runtime.dispatchNodeEvent(swSand.id, 'click');
      runtime.dispatchNodeEvent(qtyPlus.id, 'click');
      runtime.dispatchNodeEvent(addBtn.id, 'click');

      const snap = runtime.getSnapshot();
      expect(snap.nodeOverrides[chassis.id]?.fill).toBe('#D6C7B2');
      expect(snap.nodeOverrides[subtotal.id]?.text).toBe('$378.00');
      expect(snap.nodeOverrides[bagText.id]?.text).toBe('Bag (2)');
      expect(snap.toasts?.length ?? 0).toBeGreaterThanOrEqual(1);
    }

    // 4. Full Page SaaS Landing (Stage Tab + Annual Pricing + FAQ Toggle)
    {
      const template = getStudioTemplate('page-saas-landing')!;
      const project = createInitialProject('SaaS Landing Runtime');
      const { page, logicGraph } = buildTemplatePageBundle(template, project.pages);
      project.pages.push(page);
      project.activePageId = page.id;
      project.logicGraphs = [logicGraph!];

      const logicTab = page.document.nodes.find((n) => n.name === 'Logic Mode Tab')!;
      const stageTitle = page.document.nodes.find((n) => n.name === 'Stage Title')!;
      const annualBtn = page.document.nodes.find((n) => n.name === 'Annual Billing Button')!;
      const proPrice = page.document.nodes.find((n) => n.name === 'Studio Pro Price')!;
      const faqBtn = page.document.nodes.find((n) => n.name === 'FAQ Toggle Row')!;
      const faqAns = page.document.nodes.find((n) => n.name === 'FAQ Answer Panel')!;

      const runtime = createPrototypeRuntime(project);
      runtime.dispatchNodeEvent(logicTab.id, 'click');
      runtime.dispatchNodeEvent(annualBtn.id, 'click');
      runtime.dispatchNodeEvent(faqBtn.id, 'click');

      const snap = runtime.getSnapshot();
      expect(snap.nodeOverrides[stageTitle.id]?.text).toBe('Visual Node Logic Engine');
      expect(snap.nodeOverrides[proPrice.id]?.text).toBe('$39 / mo');
      expect(snap.nodeOverrides[faqAns.id]?.visible).toBe(true);
    }
  });

  it('generates unique node IDs across repeated instantiations and staggers placement inside bounds', () => {
    const template = getStudioTemplate('ui-kpi-switcher');
    expect(template).toBeDefined();
    const project = createInitialProject('Stagger test');
    const doc = getActiveDocument(project);

    const originA = computeTemplateInsertionOrigin(doc, template!, 0);
    const originB = computeTemplateInsertionOrigin(doc, template!, 1);
    expect(originB.x).toBeGreaterThan(originA.x);
    expect(originB.y).toBeGreaterThan(originA.y);

    const nodesA = instantiateTemplateNodes(template!, originA);
    const nodesB = instantiateTemplateNodes(template!, originB);
    const idsA = new Set(nodesA.map((node) => node.id));
    for (const node of nodesB) {
      expect(idsA.has(node.id)).toBe(false);
    }
  });

  it('filters UI, Sections, Pages, and Vector Starter Kits in real time with multi-token matching and relevance ranking', () => {
    expect(tokenizeTemplateSearch('  Hero   SECTION hero ')).toEqual(['hero', 'section']);
    expect(tokenizeTemplateSearch('   ')).toEqual([]);

    const allCounts = countMatchingTemplatesByCategory(STUDIO_TEMPLATE_CATALOG, '');
    expect(allCounts).toEqual({
      all: 23,
      ui: 8,
      sections: 6,
      pages: 4,
      vectors: 5,
    });

    const pageSections = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'page sections');
    expect(pageSections.length).toBe(6);
    expect(pageSections.every((item) => item.category === 'sections')).toBe(true);

    const readyPages = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'ready-to-use pages');
    expect(readyPages.length).toBe(4);
    expect(readyPages.every((item) => item.category === 'pages')).toBe(true);

    const vectorKits = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'vector starter');
    expect(vectorKits.length).toBe(5);
    expect(vectorKits.every((item) => item.category === 'vectors')).toBe(true);

    const buttonMatches = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'action button');
    expect(buttonMatches.length).toBeGreaterThanOrEqual(1);
    expect(buttonMatches[0].id).toBe('ui-action-button');

    expect(filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'dashboard', 'pages').map((t) => t.id)).toEqual([
      'page-analytics-dashboard',
    ]);

    const allGroups = groupTemplatesByCategory(STUDIO_TEMPLATE_CATALOG.map((template) => ({ template })));
    expect(allGroups.map((g) => g.label)).toEqual([
      'Interactive UI',
      'Page Sections',
      'Ready-to-Use Pages',
      'Vector Starter Kits',
    ]);

    expect(splitHighlightSegments('Hero Section', ['hero', 'sec'])).toEqual([
      { text: 'Hero', match: true },
      { text: ' ', match: false },
      { text: 'Sec', match: true },
      { text: 'tion', match: false },
    ]);
  });

  it('inserts template layers + wired Node Logic atomically with single-step Undo/Redo', () => {
    const project = createInitialProject('Nodes + Logic Insert Test');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const activePage = getActivePage(store.getSnapshot().editorState.project);
    const beforeNodeCount = activePage.document.nodes.length;
    const beforeGraphCount = store.getSnapshot().editorState.project.logicGraphs.length;

    const template = getStudioTemplate('section-hero-studio')!;
    const origin = computeTemplateInsertionOrigin(activePage.document, template, 0);
    const { nodes, logicGraph } = instantiateTemplateBundle(template, origin, {
      scope: 'page',
      targetId: activePage.id,
    });
    const tx = client.insertTemplateWithLogic(nodes, logicGraph, `Insert "${template.name}"`);
    expect(tx.status).toBe('applied');

    const afterProject = store.getSnapshot().editorState.project;
    expect(getActiveDocument(afterProject).nodes.length).toBe(beforeNodeCount + nodes.length);
    expect(afterProject.logicGraphs.length).toBe(beforeGraphCount + 1);
    expect(validateProject(afterProject).ok).toBe(true);

    // Single Undo reverts BOTH inserted layers AND logic graph cleanly
    expect(client.undo().status).toBe('applied');
    const undone = store.getSnapshot().editorState.project;
    expect(getActiveDocument(undone).nodes.length).toBe(beforeNodeCount);
    expect(undone.logicGraphs.length).toBe(beforeGraphCount);

    // Single Redo restores BOTH layers AND logic graph
    expect(client.redo().status).toBe('applied');
    const redone = store.getSnapshot().editorState.project;
    expect(getActiveDocument(redone).nodes.length).toBe(beforeNodeCount + nodes.length);
    expect(redone.logicGraphs.length).toBe(beforeGraphCount + 1);
  });

  it('creates a standalone Ready-to-Use Page + wired Node Logic atomically in one transaction', () => {
    const project = createInitialProject('Page Template Test');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const beforePages = store.getSnapshot().editorState.project.pages.length;
    const beforeGraphs = store.getSnapshot().editorState.project.logicGraphs.length;

    const template = getStudioTemplate('page-analytics-dashboard')!;
    const { page, logicGraph } = buildTemplatePageBundle(template, store.getSnapshot().editorState.project.pages);

    const tx = client.createPageWithLogic(page, logicGraph, `Create page "${page.name}"`);
    expect(tx.status).toBe('applied');

    const after = store.getSnapshot().editorState.project;
    expect(after.pages.length).toBe(beforePages + 1);
    expect(after.activePageId).toBe(page.id);
    expect(after.logicGraphs.length).toBe(beforeGraphs + 1);
    expect(after.logicGraphs[beforeGraphs].targetId).toBe(page.id);
    expect(validateProject(after).ok).toBe(true);
  });

  it('inserts a template atomically as Master Component + Component Logic + linked Instance with single-step Undo/Redo', () => {
    const project = createInitialProject('Component Insert Test');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const beforeDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const beforeNodeCount = beforeDoc.nodes.length;
    const beforeComponentCount = store.getSnapshot().editorState.project.components.length;
    const beforeGraphCount = store.getSnapshot().editorState.project.logicGraphs.length;

    const template = getStudioTemplate('ui-smart-toggle')!;
    const origin = computeTemplateInsertionOrigin(beforeDoc, template, 0);
    const { component, instance, componentLogicGraph } = buildTemplateComponentAndInstance(template, origin, []);
    expect(component.nodeLogicEnabled).toBe(true);
    expect(componentLogicGraph?.scope).toBe('component');
    expect(componentLogicGraph?.targetId).toBe(component.id);

    const tx = client.createComponentWithInstance(
      component,
      instance,
      `Insert "${template.name}" as component`,
      componentLogicGraph,
    );
    expect(tx.status).toBe('applied');

    const afterProject = store.getSnapshot().editorState.project;
    expect(validateProject(afterProject).ok).toBe(true);
    expect(afterProject.components.length).toBe(beforeComponentCount + 1);
    expect(afterProject.logicGraphs.length).toBe(beforeGraphCount + 1);
    expect(getActiveDocument(afterProject).nodes.length).toBe(beforeNodeCount + 1);

    // Deduplicates master component names on subsequent insertions
    const second = buildTemplateComponentAndInstance(
      template,
      origin,
      afterProject.components.map((c) => c.name),
    );
    expect(second.component.name).toBe('Smart Toggle Switch Card 2');

    // Single Undo reverts Master Component, Component Logic Graph, AND Instance atomically
    expect(client.undo().status).toBe('applied');
    const undoneProject = store.getSnapshot().editorState.project;
    expect(undoneProject.components.length).toBe(beforeComponentCount);
    expect(undoneProject.logicGraphs.length).toBe(beforeGraphCount);
    expect(getActiveDocument(undoneProject).nodes.length).toBe(beforeNodeCount);

    // Single Redo restores all three atomically
    expect(client.redo().status).toBe('applied');
    const redoneProject = store.getSnapshot().editorState.project;
    expect(redoneProject.components.length).toBe(beforeComponentCount + 1);
    expect(redoneProject.logicGraphs.length).toBe(beforeGraphCount + 1);
    expect(getActiveDocument(redoneProject).nodes.length).toBe(beforeNodeCount + 1);
  });

  it('inserts Vector Starter Kits cleanly into Component Canvas workspace', () => {
    const bufferProject = createInitialProject('Component Canvas');
    bufferProject.metadata.id = 'folio-component-canvas';
    const page = getActivePage(bufferProject);
    page.document.width = 420;
    page.document.height = 280;
    page.document.nodes = [];

    const store = createCanonicalEditorStore(createEditorState(bufferProject), { workspace: 'component' });
    const client = createComponentCanvasCommandClient(store);
    const vectorKit = getStudioTemplate('vector-logo-mark')!;
    const origin = computeTemplateInsertionOrigin(page.document, vectorKit, 0);
    const nodes = instantiateTemplateNodes(vectorKit, origin);

    const res = client.createNodes(nodes, 'Insert Vector Starter Kit');
    expect(res.status).toBe('applied');
    const afterDoc = getActiveDocument(store.getSnapshot().editorState.project);
    expect(afterDoc.nodes.length).toBe(nodes.length);
    expect(afterDoc.nodes.some((n) => n.type === 'path')).toBe(true);
  });
});

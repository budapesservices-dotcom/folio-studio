import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import {
  STUDIO_TEMPLATE_CATALOG,
  buildTemplateComponentAndInstance,
  buildTemplatePreviewDocument,
  computeTemplateInsertionOrigin,
  countMatchingTemplatesByCategory,
  filterStudioTemplates,
  getStudioTemplate,
  groupTemplatesByCategory,
  instantiateTemplateNodes,
  splitHighlightSegments,
  tokenizeTemplateSearch,
} from '../src/core/document/templates';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import {
  createComponentCanvasCommandClient,
  createMainCanvasCommandClient,
} from '../src/app/mainCanvasCommandClient';

describe('Component & Section Template Library', () => {
  it('provides UI Components, Page Sections, and Vector Starter Kits with valid .flop v2 geometry', () => {
    const categories = new Set(STUDIO_TEMPLATE_CATALOG.map((item) => item.category));
    expect(categories).toEqual(new Set(['ui', 'sections', 'vectors']));
    expect(STUDIO_TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(15);

    for (const template of STUDIO_TEMPLATE_CATALOG) {
      const project = createInitialProject(`Validate ${template.name}`);
      const page = getActivePage(project);
      const origin = computeTemplateInsertionOrigin(page.document, template, 0);
      const nodes = instantiateTemplateNodes(template, origin);
      expect(nodes.length, `Template ${template.id} must produce at least 1 node`).toBeGreaterThan(0);

      page.document.nodes = nodes;
      const validation = validateProject(project);
      expect(validation.ok, `Template ${template.id} failed validation: ${validation.error ?? ''}`).toBe(true);

      const previewDoc = buildTemplatePreviewDocument(template);
      expect(previewDoc.nodes.length).toBe(nodes.length);
      expect(previewDoc.width).toBe(template.width);
      expect(previewDoc.height).toBe(template.height);
    }
  });

  it('generates unique node IDs across repeated instantiations and staggers placement inside bounds', () => {
    const template = getStudioTemplate('ui-kpi-card');
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

  it('filters UI Components, Page Sections, and Vector Starter Kits in real time with multi-token matching and relevance ranking', () => {
    expect(tokenizeTemplateSearch('  Hero   SECTION hero ')).toEqual(['hero', 'section']);
    expect(tokenizeTemplateSearch('   ')).toEqual([]);

    // Empty query returns full catalog and accurate category counts
    const allCounts = countMatchingTemplatesByCategory(STUDIO_TEMPLATE_CATALOG, '');
    expect(allCounts).toEqual({
      all: STUDIO_TEMPLATE_CATALOG.length,
      ui: 6,
      sections: 4,
      vectors: 5,
    });

    // Category label searches dynamically isolate each category
    const pageSections = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'page sections');
    expect(pageSections.length).toBe(4);
    expect(pageSections.every((item) => item.category === 'sections')).toBe(true);

    const vectorKits = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'vector starter');
    expect(vectorKits.length).toBe(5);
    expect(vectorKits.every((item) => item.category === 'vectors')).toBe(true);

    const uiComponents = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'ui components');
    expect(uiComponents.length).toBe(6);
    expect(uiComponents.every((item) => item.category === 'ui')).toBe(true);

    // Multi-token search narrows accurately and ranks direct name matches first
    const buttonMatches = filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'primary button');
    expect(buttonMatches.length).toBeGreaterThanOrEqual(1);
    expect(buttonMatches[0].id).toBe('ui-primary-button');

    const heroCounts = countMatchingTemplatesByCategory(STUDIO_TEMPLATE_CATALOG, 'hero');
    expect(heroCounts.sections).toBe(1);
    expect(heroCounts.ui).toBe(0);
    expect(heroCounts.vectors).toBe(0);
    expect(heroCounts.all).toBe(1);

    // Scoped category filter respects active category
    expect(filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'hero', 'ui')).toEqual([]);
    expect(filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'hero', 'sections').map((t) => t.id)).toEqual(['section-hero']);

    // Grouping preserves canonical order and omits empty sections dynamically
    const allGroups = groupTemplatesByCategory(STUDIO_TEMPLATE_CATALOG.map((template) => ({ template })));
    expect(allGroups.map((g) => g.label)).toEqual(['UI Components', 'Page Sections', 'Vector Starter Kits']);

    const heroGroups = groupTemplatesByCategory(
      filterStudioTemplates(STUDIO_TEMPLATE_CATALOG, 'hero').map((template) => ({ template })),
    );
    expect(heroGroups.map((g) => g.label)).toEqual(['Page Sections']);
    expect(heroGroups[0].items.length).toBe(1);

    // Safe highlight segmentation splits overlapping/multi-token matches accurately
    expect(splitHighlightSegments('Hero Section', ['hero', 'sec'])).toEqual([
      { text: 'Hero', match: true },
      { text: ' ', match: false },
      { text: 'Sec', match: true },
      { text: 'tion', match: false },
    ]);
    expect(splitHighlightSegments('Primary Button', [])).toEqual([
      { text: 'Primary Button', match: false },
    ]);
  });

  it('inserts a template as editable native nodes through Native Command Engine with single-step Undo/Redo', () => {
    const project = createInitialProject('Nodes Insert Test');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const beforeCount = getActiveDocument(store.getSnapshot().editorState.project).nodes.length;

    const template = getStudioTemplate('section-hero')!;
    const origin = computeTemplateInsertionOrigin(
      getActiveDocument(store.getSnapshot().editorState.project),
      template,
      0,
    );
    const nodes = instantiateTemplateNodes(template, origin);
    const result = client.createNodes(nodes, `Insert "${template.name}" template`);
    expect(result.status).toBe('applied');

    const afterInsert = getActiveDocument(store.getSnapshot().editorState.project);
    expect(afterInsert.nodes.length).toBe(beforeCount + nodes.length);
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Single Undo reverts all inserted layers cleanly
    expect(client.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.length).toBe(beforeCount);

    // Redo restores all inserted layers
    expect(client.redo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.length).toBe(beforeCount + nodes.length);
  });

  it('inserts a template atomically as Master Component + linked Instance with single-step Undo/Redo', () => {
    const project = createInitialProject('Component Insert Test');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const beforeDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const beforeNodeCount = beforeDoc.nodes.length;
    const beforeComponentCount = store.getSnapshot().editorState.project.components.length;

    const template = getStudioTemplate('ui-feature-card')!;
    const origin = computeTemplateInsertionOrigin(beforeDoc, template, 0);
    const { component, instance } = buildTemplateComponentAndInstance(template, origin, []);

    const tx = client.createComponentWithInstance(component, instance, `Insert "${template.name}" as component`);
    expect(tx.status).toBe('applied');

    const afterProject = store.getSnapshot().editorState.project;
    expect(validateProject(afterProject).ok).toBe(true);
    expect(afterProject.components.length).toBe(beforeComponentCount + 1);
    expect(afterProject.components[beforeComponentCount].id).toBe(component.id);
    expect(getActiveDocument(afterProject).nodes.length).toBe(beforeNodeCount + 1);
    const placedInstance = getActiveDocument(afterProject).nodes.find((node) => node.id === instance.id);
    expect(placedInstance?.type).toBe('component-instance');
    if (placedInstance?.type === 'component-instance') {
      expect(placedInstance.componentId).toBe(component.id);
    }

    // Deduplicates master component names on subsequent insertions
    const second = buildTemplateComponentAndInstance(
      template,
      origin,
      afterProject.components.map((c) => c.name),
    );
    expect(second.component.name).toBe('Feature Card 2');

    // Single Undo reverts BOTH Master Component and linked Instance atomically
    expect(client.undo().status).toBe('applied');
    const undoneProject = store.getSnapshot().editorState.project;
    expect(undoneProject.components.length).toBe(beforeComponentCount);
    expect(getActiveDocument(undoneProject).nodes.length).toBe(beforeNodeCount);

    // Single Redo restores BOTH Master Component and linked Instance
    expect(client.redo().status).toBe('applied');
    const redoneProject = store.getSnapshot().editorState.project;
    expect(redoneProject.components.length).toBe(beforeComponentCount + 1);
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

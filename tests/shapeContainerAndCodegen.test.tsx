import { describe, expect, it } from 'vitest';
import { buildComponentDefinitionFromNodes } from '../src/core/document/components';
import {
  createEllipseNode,
  createEmptyDocument,
  createInitialProject,
  createPolygonNode,
  createRectNode,
} from '../src/core/document/factory';
import {
  doesNodeClipChildren,
  expandSelectedLayerIds,
  getEffectiveLayerStates,
  getLayerRenderOrder,
  isContainerNode,
  isShapeContainerNode,
  moveLayers,
} from '../src/core/document/layers';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { getActivePage } from '../src/core/document/project';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  EllipseNode,
  PathNode,
  RectNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { DocumentArtworkContent } from '../src/engines/canvas/artwork';
import { hitTestNodesAtPoint } from '../src/engines/canvas/hitTest';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import { buildShapeContainerClipId, compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
} from '../src/engines/prototype';
import { createPreviewDomHarness, createReactTsxHarness } from './helpers/parityRuntimeHarness';

interface VNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function collectVNodes(node: unknown, out: VNodeLike[] = []): VNodeLike[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectVNodes(item, out);
    return out;
  }
  const vnode = node as VNodeLike;
  if (typeof vnode.type === 'function') {
    const rendered = (vnode.type as (props: Record<string, unknown>) => unknown)(vnode.props ?? {});
    collectVNodes(rendered, out);
    return out;
  }
  out.push(vnode);
  const children = vnode.props?.children;
  if (children !== undefined && children !== null) {
    collectVNodes(children, out);
  }
  return out;
}

function makeRect(
  overrides: Partial<RectNode> & { fill?: string; stroke?: string; strokeWidth?: number; radius?: number },
): RectNode {
  const base = createRectNode(0);
  const { fill, stroke, strokeWidth, radius, style, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    style: {
      ...base.style,
      ...(fill !== undefined ? { fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(style ?? {}),
    },
  };
}

function makeEllipse(
  overrides: Partial<EllipseNode> & { fill?: string; stroke?: string; strokeWidth?: number },
): EllipseNode {
  const base = createEllipseNode(0);
  const { fill, stroke, strokeWidth, style, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    style: {
      ...base.style,
      ...(fill !== undefined ? { fill } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      ...(style ?? {}),
    },
  };
}

function createCustomPentagonContainer(overrides: Partial<PathNode> = {}): PathNode {
  const base = createPolygonNode(40, 40, 120, 120, 5);
  return {
    ...base,
    id: 'shape-path-container',
    name: 'Pentagon Container',
    isContainer: true,
    clipContent: true,
    style: {
      ...base.style,
      fill: '#00000000',
      stroke: '#00000000',
      strokeWidth: 0,
    },
    ...overrides,
  };
}

describe('Shape Container — AST, Hierarchy, Clipping, Hit-Test, Promotion & Codegen', () => {
  it('supports Rect, Ellipse, and Custom Path as Shape Containers with child reparenting and collective movement', () => {
    const rectContainer = makeRect({
      id: 'rect-cont',
      name: 'Card Shape',
      x: 40,
      y: 40,
      width: 200,
      height: 120,
      radius: 16,
      isContainer: true,
      clipContent: true,
    });
    const ellipseContainer = makeEllipse({
      id: 'ellipse-cont',
      name: 'Orb Container',
      x: 280,
      y: 40,
      width: 100,
      height: 100,
      fill: '#00000000',
      stroke: '#00000000',
      strokeWidth: 0,
      isContainer: true,
      clipContent: true,
    });
    const pathContainer = createCustomPentagonContainer();
    const childSun = makeEllipse({
      id: 'child-sun',
      name: 'Sun',
      x: 300,
      y: 60,
      width: 50,
      height: 50,
      fill: '#FACC15',
    });

    expect(isShapeContainerNode(rectContainer)).toBe(true);
    expect(isShapeContainerNode(ellipseContainer)).toBe(true);
    expect(isShapeContainerNode(pathContainer)).toBe(true);
    expect(isContainerNode(ellipseContainer)).toBe(true);
    expect(doesNodeClipChildren(ellipseContainer)).toBe(true);
    expect(doesNodeClipChildren({ ...ellipseContainer, clipContent: false })).toBe(false);

    const reparented = moveLayers(
      [rectContainer, ellipseContainer, pathContainer, childSun],
      [childSun.id],
      ellipseContainer.id,
      'inside',
    );
    const movedChild = reparented.find((n) => n.id === childSun.id);
    expect(movedChild?.parentId).toBe(ellipseContainer.id);

    const expanded = expandSelectedLayerIds(reparented, [ellipseContainer.id]);
    expect(expanded).toContain(ellipseContainer.id);
    expect(expanded).toContain(childSun.id);
  });

  it('renders exact SVG <clipPath> for Rect, Ellipse, and Custom Path Shape Containers when clipContent is enabled and omits when disabled', () => {
    const rectCont = makeRect({
      id: 'rc-1',
      name: 'Rect Cont',
      x: 10,
      y: 10,
      width: 100,
      height: 80,
      radius: 12,
      isContainer: true,
      clipContent: true,
    });
    const rectChild = makeRect({
      id: 'rc-child',
      name: 'Rect Child',
      parentId: rectCont.id,
      x: 0,
      y: 0,
      width: 140,
      height: 100,
    });
    const ellCont = makeEllipse({
      id: 'ec-1',
      name: 'Ellipse Cont',
      x: 140,
      y: 10,
      width: 90,
      height: 90,
      isContainer: true,
      clipContent: true,
    });
    const ellChild = makeRect({
      id: 'ec-child',
      name: 'Ellipse Child',
      parentId: ellCont.id,
      x: 130,
      y: 0,
      width: 110,
      height: 110,
    });
    const pathCont = createCustomPentagonContainer({ id: 'pc-1', x: 260, y: 10 });
    const pathChild = makeRect({
      id: 'pc-child',
      name: 'Path Child',
      parentId: pathCont.id,
      x: 250,
      y: 0,
      width: 140,
      height: 140,
    });

    const docClipped = {
      ...createEmptyDocument('Clipped'),
      id: 'doc-clip',
      width: 480,
      height: 220,
      nodes: [rectCont, rectChild, ellCont, ellChild, pathCont, pathChild],
    };
    const clippedVNodes = collectVNodes(
      DocumentArtworkContent({ document: docClipped, maskPrefix: 'test-clip' }),
    );

    const clipPaths = clippedVNodes.filter((n) => n.type === 'clipPath');
    const clipPathIds = clipPaths.map((n) => n.props?.id);
    expect(clipPathIds).toContain('test-clip--frameclip--rc-1');
    expect(clipPathIds).toContain('test-clip--frameclip--ec-1');
    expect(clipPathIds).toContain('test-clip--frameclip--pc-1');

    const ellipseClip = clippedVNodes.find(
      (n) => n.type === 'ellipse' && n.props?.cx === 185 && n.props?.cy === 55 && n.props?.rx === 45,
    );
    expect(ellipseClip).toBeTruthy();

    const clippedGroups = clippedVNodes.filter(
      (n) => n.type === 'g' && n.props?.['clip-path'] === 'url(#test-clip--frameclip--pc-1)',
    );
    expect(clippedGroups.length).toBeGreaterThan(0);

    const docUnclipped = {
      ...createEmptyDocument('Unclipped'),
      id: 'doc-unclipped',
      width: 480,
      height: 220,
      nodes: [
        { ...rectCont, clipContent: false },
        rectChild,
        { ...ellCont, clipContent: false },
        ellChild,
        { ...pathCont, clipContent: false },
        pathChild,
      ],
    };
    const unclippedVNodes = collectVNodes(
      DocumentArtworkContent({ document: docUnclipped, maskPrefix: 'test-noclip' }),
    );
    const unclippedClipIds = unclippedVNodes
      .filter((n) => n.type === 'clipPath')
      .map((n) => n.props?.id);
    expect(unclippedClipIds).not.toContain('test-noclip--frameclip--rc-1');
    expect(unclippedClipIds).not.toContain('test-noclip--frameclip--ec-1');
    expect(unclippedClipIds).not.toContain('test-noclip--frameclip--pc-1');
  });

  it('keeps transparent and stroke-less Shape Containers hit-testable inside their geometry', () => {
    const transparentEllipse = makeEllipse({
      id: 'hit-orb',
      name: 'Hit Orb',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      fill: '#00000000',
      stroke: '#00000000',
      strokeWidth: 0,
      isContainer: true,
    });
    const transparentPath = createCustomPentagonContainer({
      id: 'hit-star',
      x: 260,
      y: 100,
      width: 100,
      height: 100,
    });
    const smallChild = makeRect({
      id: 'inner-badge',
      name: 'Inner Badge',
      parentId: transparentEllipse.id,
      x: 135,
      y: 135,
      width: 30,
      height: 30,
      fill: '#38BDF8',
    });

    const nodes: DesignNode[] = [transparentEllipse, smallChild, transparentPath];
    const ordered = getLayerRenderOrder(nodes);
    const states = getEffectiveLayerStates(ordered);

    // Inside ellipse interior (outside inner child) -> hits transparent Shape Container!
    expect(hitTestNodesAtPoint(ordered, { x: 115, y: 150 }, states)).toBe('hit-orb');

    // Inside inner child -> smaller child still wins hit-test
    expect(hitTestNodesAtPoint(ordered, { x: 150, y: 150 }, states)).toBe('inner-badge');

    // Outside ellipse corner (102, 102 is outside inscribed circle) -> misses
    expect(hitTestNodesAtPoint(ordered, { x: 102, y: 102 }, states)).toBeNull();

    // Inside transparent custom path container -> hits!
    expect(hitTestNodesAtPoint(ordered, { x: 310, y: 155 }, states)).toBe('hit-star');
  });

  it('preserves Shape Container, children, IDs, and clipping when promoted to a Component, and keeps On Click active across Sun/Moon variant swaps', () => {
    const orbContainer = makeEllipse({
      id: 'sun-moon-shell',
      name: 'Sun-Moon Container',
      x: 40,
      y: 40,
      width: 96,
      height: 96,
      fill: '#00000000',
      stroke: '#00000000',
      strokeWidth: 0,
      isContainer: true,
      clipContent: true,
    });
    const sunLayer = makeEllipse({
      id: 'sun-icon',
      name: 'Sun',
      parentId: orbContainer.id,
      x: 56,
      y: 56,
      width: 64,
      height: 64,
      fill: '#FACC15',
    });
    const moonLayer = makeEllipse({
      id: 'moon-icon',
      name: 'Moon',
      parentId: orbContainer.id,
      x: 56,
      y: 56,
      width: 64,
      height: 64,
      fill: '#CBD5E1',
      visible: false,
    });

    const createdComp = buildComponentDefinitionFromNodes(
      [orbContainer, sunLayer, moonLayer],
      [orbContainer.id],
      'SunMoon',
    );
    expect(createdComp).not.toBeNull();
    const compNodes = createdComp!.document.nodes;
    const promotedShell = compNodes.find((n: DesignNode) => n.id === orbContainer.id);
    const promotedSun = compNodes.find((n: DesignNode) => n.id === sunLayer.id);
    const promotedMoon = compNodes.find((n: DesignNode) => n.id === moonLayer.id);
    expect(promotedShell && isShapeContainerNode(promotedShell)).toBe(true);
    expect(promotedShell && doesNodeClipChildren(promotedShell)).toBe(true);
    expect(promotedSun?.parentId).toBe(orbContainer.id);
    expect(promotedMoon?.parentId).toBe(orbContainer.id);

    const comp: ComponentDefinition = {
      ...createdComp!,
      nodeLogicEnabled: true,
      variants: [
        {
          id: 'axis-mode',
          name: 'Mode',
          defaultOptionId: 'opt-sun',
          options: [
            {
              id: 'opt-sun',
              label: 'Sun',
              overrides: {
                [sunLayer.id]: { visible: true },
                [moonLayer.id]: { visible: false },
              },
            },
            {
              id: 'opt-moon',
              label: 'Moon',
              overrides: {
                [sunLayer.id]: { visible: false },
                [moonLayer.id]: { visible: true },
              },
            },
          ],
        },
      ],
    };

    const project = createInitialProject('SunMoon Parity');
    const page = getActivePage(project);
    const instance: ComponentInstanceNode = {
      id: 'inst-sun-moon',
      type: 'component-instance',
      name: 'SunMoon Instance',
      componentId: comp.id,
      x: 40,
      y: 40,
      width: 96,
      height: 96,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: {},
      variantSelection: { 'axis-mode': 'opt-sun' },
    };

    const nClick = createLogicNode({
      id: 'n-click',
      type: 'event.on-click',
      x: 40,
      y: 80,
      data: { targetNodeId: orbContainer.id, mode: 'click' },
    });
    const nToggle = createLogicNode({
      id: 'n-toggle',
      type: 'state.toggle',
      x: 280,
      y: 80,
      data: { initialValue: false },
    });
    const nBranch = createLogicNode({
      id: 'n-branch',
      type: 'logic.branch',
      x: 520,
      y: 80,
      data: { mode: 'if-else' },
    });
    const nToMoon = createLogicNode({
      id: 'n-moon',
      type: 'action.set-variant',
      x: 760,
      y: 40,
      data: { targetMode: 'override', targetNodeId: '', axisId: 'axis-mode', optionId: 'opt-moon' },
    });
    const nToSun = createLogicNode({
      id: 'n-sun',
      type: 'action.set-variant',
      x: 760,
      y: 160,
      data: { targetMode: 'override', targetNodeId: '', axisId: 'axis-mode', optionId: 'opt-sun' },
    });

    const compGraph = createLogicGraph({
      id: 'graph-sun-moon',
      name: 'SunMoon Logic',
      scope: 'component',
      targetId: comp.id,
      nodes: [nClick, nToggle, nBranch, nToMoon, nToSun],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: nClick.id, sourcePortId: 'exec', targetNodeId: nToggle.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: nToggle.id, sourcePortId: 'next', targetNodeId: nBranch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: nToggle.id, sourcePortId: 'value', targetNodeId: nBranch.id, targetPortId: 'condition' }),
        createLogicConnection({ id: 'c4', sourceNodeId: nBranch.id, sourcePortId: 'true', targetNodeId: nToMoon.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c5', sourceNodeId: nBranch.id, sourcePortId: 'false', targetNodeId: nToSun.id, targetPortId: 'exec' }),
      ],
    });

    const fullProject = {
      ...project,
      pages: [{ ...page, document: { ...page.document, nodes: [instance] } }],
      components: [comp],
      logicGraphs: [compGraph],
    };

    const expandedShellId = `${instance.id}__${orbContainer.id}`;
    const expandedSunId = `${instance.id}__${sunLayer.id}`;
    const expandedMoonId = `${instance.id}__${moonLayer.id}`;

    // 1) Prototype Runtime: clicking the Shape Container toggles Sun -> Moon -> Sun even though Sun hides!
    const runtime = createPrototypeRuntime(fullProject);
    const snap1 = runtime.dispatchNodeEvent(expandedShellId, 'click');
    expect(snap1.nodeOverrides[instance.id]?.variantSelection?.['axis-mode']).toBe('opt-moon');
    const snap2 = runtime.dispatchNodeEvent(expandedShellId, 'click');
    expect(snap2.nodeOverrides[instance.id]?.variantSelection?.['axis-mode']).toBe('opt-sun');

    // 2) Live Preview HTML/CSS parity
    const previewScript = buildLivePreviewLogicScript(fullProject, getActivePage(fullProject))!;
    expect(previewScript).toBeTruthy();
    const preview = createPreviewDomHarness(
      previewScript,
      [instance.id, expandedShellId, expandedSunId, expandedMoonId],
      {
        initialAttrsById: {
          [instance.id]: { 'data-variant-mode': 'Sun' },
        },
      },
    );
    preview.click(expandedShellId);
    expect(preview.getAttr(instance.id, 'data-variant-mode')).toBe('Moon');
    preview.click(expandedShellId);
    expect(preview.getAttr(instance.id, 'data-variant-mode')).toBe('Sun');

    // 3) React TSX parity
    const reactHarness = createReactTsxHarness(fullProject, page.id);
    reactHarness.click(expandedShellId);
    expect(reactHarness.getAttr(instance.id, 'data-variant-mode')).toBe('Moon');
    reactHarness.click(expandedShellId);
    expect(reactHarness.getAttr(instance.id, 'data-variant-mode')).toBe('Sun');
  });

  it('emits clean HTML/CSS and React TSX output for Rect, Ellipse, and Custom Path Shape Containers without wrapper divs or rasterization', () => {
    const rectCont = makeRect({
      id: 'clean-rect',
      name: 'Clean Rect',
      x: 20,
      y: 20,
      width: 160,
      height: 100,
      radius: 14,
      isContainer: true,
      clipContent: true,
    });
    const rectChild = makeRect({
      id: 'clean-rect-child',
      name: 'Rect Child',
      parentId: rectCont.id,
      x: 30,
      y: 30,
      width: 40,
      height: 40,
      fill: '#F97316',
    });

    const ellCont = makeEllipse({
      id: 'clean-ell',
      name: 'Clean Ellipse',
      x: 220,
      y: 20,
      width: 100,
      height: 100,
      fill: '#00000000',
      stroke: '#00000000',
      strokeWidth: 0,
      isContainer: true,
      clipContent: true,
    });
    const ellChild = makeRect({
      id: 'clean-ell-child',
      name: 'Ell Child',
      parentId: ellCont.id,
      x: 240,
      y: 40,
      width: 50,
      height: 50,
      fill: '#22C55E',
    });

    const pathCont = createCustomPentagonContainer({
      id: 'clean-path',
      name: 'Clean Star',
      x: 360,
      y: 20,
      width: 120,
      height: 120,
    });
    const pathChild = makeRect({
      id: 'clean-path-child',
      name: 'Path Child',
      parentId: pathCont.id,
      x: 380,
      y: 40,
      width: 60,
      height: 60,
      fill: '#38BDF8',
    });

    const baseProject = createInitialProject('Codegen Test');
    const basePage = getActivePage(baseProject);
    const targetPage = {
      ...basePage,
      name: 'Home',
      document: {
        ...basePage.document,
        width: 600,
        height: 240,
        nodes: [rectCont, rectChild, ellCont, ellChild, pathCont, pathChild],
      },
    };
    const project = {
      ...baseProject,
      pages: [targetPage],
    };

    const htmlCompiled = compilePageHtmlCss(project, targetPage);
    const expectedPathClipId = buildShapeContainerClipId('index', pathCont.id);

    expect(htmlCompiled.cssFile.content).toContain('overflow: hidden;');
    expect(htmlCompiled.cssFile.content).toContain('border-radius: 50%;');
    expect(htmlCompiled.cssFile.content).toContain('pointer-events: auto;');
    expect(htmlCompiled.cssFile.content).toContain(`clip-path: url(#${expectedPathClipId});`);
    expect(htmlCompiled.htmlFile.content).toContain(`<clipPath id="${expectedPathClipId}"`);
    expect(htmlCompiled.htmlFile.content).toContain(`data-folio-id="${pathChild.id}"`);
    expect(htmlCompiled.htmlFile.content).not.toContain('shape-container-wrapper');

    const liveHtml = buildLivePreviewHtml(project);
    expect(liveHtml).toContain(`clip-path: url(#${expectedPathClipId});`);
    expect(liveHtml).toContain(`data-folio-id="${pathChild.id}"`);

    const reactFiles = compileReactProjectFiles(project, targetPage.id);
    const pageTsx = reactFiles.find((f) => f.path.endsWith('.tsx') && f.content.includes(pathChild.id));
    expect(pageTsx).toBeTruthy();
    expect(pageTsx!.content).toContain(`id="${expectedPathClipId}"`);
    expect(pageTsx!.content).toContain(`data-folio-id="${pathChild.id}"`);
    expect(pageTsx!.content).toContain(`data-folio-id="${ellChild.id}"`);
    expect(pageTsx!.content).toContain(`data-folio-id="${rectChild.id}"`);
  });

  it('roundtrips Shape Container properties cleanly in .flop JSON and stays compatible with legacy .flop files without them', () => {
    const project = createInitialProject('Flop Roundtrip');
    const page = getActivePage(project);
    const shapeCont = makeEllipse({
      id: 'persist-ell',
      name: 'Persistent Container',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      isContainer: true,
      clipContent: true,
    });
    const legacyShape = makeRect({
      id: 'legacy-rect',
      name: 'Legacy Rect',
      x: 140,
      y: 10,
      width: 80,
      height: 60,
    });

    const nextProject = {
      ...project,
      pages: [{ ...page, document: { ...page.document, nodes: [shapeCont, legacyShape] } }],
    };

    expect(validateProject(nextProject).ok).toBe(true);

    const json = serializeProjectToFlopJson(nextProject);
    const reloaded = migrateProjectToV2(JSON.parse(json));
    const reloadedNodes = reloaded.pages[0].document.nodes;
    const reloadedCont = reloadedNodes.find((n: DesignNode) => n.id === 'persist-ell');
    const reloadedLegacy = reloadedNodes.find((n: DesignNode) => n.id === 'legacy-rect');
    expect(reloadedCont && isShapeContainerNode(reloadedCont)).toBe(true);
    expect(reloadedCont && doesNodeClipChildren(reloadedCont)).toBe(true);
    expect(reloadedLegacy && isShapeContainerNode(reloadedLegacy)).toBe(false);
  });
});

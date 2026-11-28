import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTriangleNode,
} from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioPage,
  GroupNode,
  LogicGraph,
} from '../src/core/document/types';
import { DocumentArtworkContent } from '../src/engines/canvas/artwork';
import {
  cssTransformToSvgTransform,
  resolveNodeEffectiveSvgTransform,
} from '../src/engines/canvas/transformUtils';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
} from '../src/engines/prototype';

type AnyVNode = VNode<Record<string, unknown>>;

/**
 * Recursively expands Preact function components into intrinsic SVG/HTML VNodes
 * so unit tests can inspect exact rendered `<mask>`, `<g>`, `<rect>`, `<ellipse>`,
 * and `transform` attributes produced by `DocumentArtworkContent` (Main Canvas &
 * Component Canvas renderer).
 */
function expandVNodeTree(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(expandVNodeTree);
  }
  const vnode = node as AnyVNode;
  if (typeof vnode.type === 'function') {
    const fn = vnode.type as (props: Record<string, unknown>) => unknown;
    return expandVNodeTree(fn(vnode.props ?? {}));
  }
  const props = vnode.props ?? {};
  if ('children' in props) {
    return {
      ...vnode,
      props: {
        ...props,
        children: expandVNodeTree(props.children),
      },
    };
  }
  return vnode;
}

function findVNodes(
  tree: unknown,
  predicate: (v: AnyVNode) => boolean,
): AnyVNode[] {
  const out: AnyVNode[] = [];
  const walk = (cur: unknown) => {
    if (cur == null || typeof cur !== 'object') return;
    if (Array.isArray(cur)) {
      for (const item of cur) walk(item);
      return;
    }
    const vnode = cur as AnyVNode;
    if (typeof vnode.type === 'string' && predicate(vnode)) {
      out.push(vnode);
    }
    if (vnode.props && 'children' in vnode.props) {
      walk(vnode.props.children);
    }
  };
  walk(tree);
  return out;
}

function collectAncestorTransforms(
  tree: unknown,
  targetPredicate: (v: AnyVNode) => boolean,
): string[][] {
  const results: string[][] = [];
  const walk = (cur: unknown, activeTransforms: string[]) => {
    if (cur == null || typeof cur !== 'object') return;
    if (Array.isArray(cur)) {
      for (const item of cur) walk(item, activeTransforms);
      return;
    }
    const vnode = cur as AnyVNode;
    const ownTransform =
      typeof vnode.props?.transform === 'string' && vnode.props.transform.trim().length > 0
        ? [vnode.props.transform]
        : [];
    const nextTransforms = [...activeTransforms, ...ownTransform];
    if (typeof vnode.type === 'string' && targetPredicate(vnode)) {
      results.push(nextTransforms);
    }
    if (vnode.props && 'children' in vnode.props) {
      walk(vnode.props.children, nextTransforms);
    }
  };
  walk(tree, []);
  return results;
}

interface MockDomElement {
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  addEventListener: (type: string, cb: (ev: unknown) => void) => void;
  getAttribute: (key: string) => string | null;
  setAttribute: (key: string, val: string) => void;
  removeAttribute: (key: string) => void;
}

function createMockDomFromCompiledHtml(html: string): {
  folioEls: Map<string, MockDomElement>;
  maskBaseEls: MockDomElement[];
  runScript: (script: string) => void;
  click: (folioId: string) => void;
} {
  const makeEl = (tagName: string, attrs: Record<string, string>): MockDomElement => ({
    tagName,
    textContent: '',
    style: {},
    attributes: { ...attrs },
    listeners: {},
    addEventListener(type: string, cb: (ev: unknown) => void) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(cb);
    },
    getAttribute(key: string) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
    },
    setAttribute(key: string, val: string) {
      this.attributes[key] = val;
    },
    removeAttribute(key: string) {
      delete this.attributes[key];
    },
  });

  const parseAttrs = (raw: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      attrs[m[1]] = m[2];
    }
    return attrs;
  };

  const folioEls = new Map<string, MockDomElement>();
  const folioTagRe = /<([a-zA-Z0-9-]+)\b([^>]*\bdata-folio-id="[^"]+"[^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = folioTagRe.exec(html)) !== null) {
    const attrs = parseAttrs(m[2]);
    const id = attrs['data-folio-id'];
    if (id && !folioEls.has(id)) {
      folioEls.set(id, makeEl(m[1].toUpperCase(), attrs));
    }
  }

  const maskBaseEls: MockDomElement[] = [];
  const maskGroupRe = /<g\b([^>]*\bdata-folio-mask-base="[^"]+"[^>]*)>/g;
  while ((m = maskGroupRe.exec(html)) !== null) {
    maskBaseEls.push(makeEl('G', parseAttrs(m[1])));
  }

  const allFolioList = Array.from(folioEls.values());
  const mockWin = {
    location: { origin: 'https://folio.local', href: 'https://folio.local/', hash: '' },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const mockDoc = {
    readyState: 'complete',
    documentElement: {
      dataset: {},
      style: {},
      offsetWidth: 1440,
      classList: { add: () => {}, remove: () => {}, has: () => false },
      setAttribute: () => {},
      removeAttribute: () => {},
      getAttribute: () => null,
    },
    body: { appendChild: () => {}, style: {} },
    querySelectorAll: (sel: string) => {
      if (sel === '[data-folio-id]') return allFolioList;
      if (sel === '[data-folio-mask-base]') return maskBaseEls;
      return [];
    },
    querySelector: () => null,
    addEventListener: () => {},
  };

  return {
    folioEls,
    maskBaseEls,
    runScript(script: string) {
      new Function('window', 'document', script)(mockWin, mockDoc);
    },
    click(folioId: string) {
      const target = folioEls.get(folioId);
      if (!target) throw new Error(`Mock DOM element not found: ${folioId}`);
      for (const cb of target.listeners.click ?? []) {
        cb({ target, currentTarget: target });
      }
    },
  };
}

function makeGroupNode(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): GroupNode {
  return {
    id,
    type: 'group',
    name,
    x,
    y,
    width,
    height,
    rotation,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

function makeInstanceNode(
  id: string,
  name: string,
  component: ComponentDefinition,
  x: number,
  y: number,
): ComponentInstanceNode {
  return {
    id,
    type: 'component-instance',
    name,
    componentId: component.id,
    x,
    y,
    width: component.document.width,
    height: component.document.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    overrides: {},
  };
}

function makeTransformClickGraph(
  graphId: string,
  scope: 'page' | 'component',
  targetId: string,
  actions: Array<{ triggerId: string; targetNodeId: string; transform: string }>,
): LogicGraph {
  const nodes = [];
  const connections = [];
  let idx = 0;
  for (const act of actions) {
    idx += 1;
    const clickId = `${graphId}-click-${idx}`;
    const setId = `${graphId}-set-${idx}`;
    nodes.push(
      createLogicNode({
        id: clickId,
        type: 'event.on-click',
        x: 20,
        y: idx * 100,
        data: { targetNodeId: act.triggerId, mode: 'click' },
      }),
      createLogicNode({
        id: setId,
        type: 'action.set-layer',
        x: 280,
        y: idx * 100,
        data: {
          targetMode: 'override',
          targetNodeId: act.targetNodeId,
          property: 'transform',
          transform: act.transform,
        },
      }),
    );
    connections.push(
      createLogicConnection({
        id: `${graphId}-conn-${idx}`,
        sourceNodeId: clickId,
        sourcePortId: 'exec',
        targetNodeId: setId,
        targetPortId: 'exec',
      }),
    );
  }
  return createLogicGraph({
    id: graphId,
    name: graphId,
    scope,
    targetId,
    nodes,
    connections,
  });
}

describe('Clip Mask + Node Logic Transform Integration', () => {
  it('converts CSS transforms to exact SVG transforms around center pivot and guards static group rotation', () => {
    expect(cssTransformToSvgTransform('translateX(80px)', 160, 140, 120, 80)).toBe('translate(80 0)');
    expect(cssTransformToSvgTransform('translate(20px, -10px)', 160, 140, 120, 80)).toBe('translate(20 -10)');
    expect(cssTransformToSvgTransform('rotate(30deg)', 160, 140, 120, 80)).toBe(
      'translate(160 140) rotate(30) translate(-160 -140)',
    );
    expect(cssTransformToSvgTransform('translateX(50px) scale(1.5)', 160, 140, 120, 80)).toBe(
      'translate(160 140) translate(50 0) scale(1.5 1.5) translate(-160 -140)',
    );
    expect(cssTransformToSvgTransform('', 160, 140, 120, 80)).toBeUndefined();
    expect(cssTransformToSvgTransform('none', 160, 140, 120, 80)).toBeUndefined();

    const rotatedRect = { ...createRectNode(0), id: 'r1', x: 100, y: 100, width: 100, height: 60, rotation: 25 };
    expect(resolveNodeEffectiveSvgTransform(rotatedRect).svgTransform).toBe('rotate(25 150 130)');
    expect(
      resolveNodeEffectiveSvgTransform(rotatedRect, { r1: { transform: 'rotate(45deg)' } }).svgTransform,
    ).toBe('translate(150 130) rotate(45) translate(-150 -130)');
    expect(resolveNodeEffectiveSvgTransform(rotatedRect, { r1: { transform: '' } }).svgTransform).toBe(
      'rotate(25 150 130)',
    );

    const groupWithMetaRot = makeGroupNode('g1', 'Meta Rot Group', 10, 20, 100, 80, 45);
    expect(resolveNodeEffectiveSvgTransform(groupWithMetaRot).svgTransform).toBeUndefined();
    expect(
      resolveNodeEffectiveSvgTransform(groupWithMetaRot, { g1: { transform: 'translateX(40px)' } }).svgTransform,
    ).toBe('translate(40 0)');
  });

  it('1) applies base layer transform in real-time to clipping mask across Main Canvas SVG, Live Preview, and React export', () => {
    const project = createInitialProject('Clip Mask Dynamic Transform');
    const page = project.pages[0];
    const maskBase: DesignNode = {
      ...createEllipseNode(0),
      id: 'mask-base',
      name: 'Mask Ellipse',
      x: 100,
      y: 100,
      width: 120,
      height: 80,
    };
    const clippedLayer: DesignNode = {
      ...createRectNode(1),
      id: 'clipped-rect',
      name: 'Clipped Artwork',
      x: 80,
      y: 80,
      width: 220,
      height: 200,
      clipMaskBaseId: 'mask-base',
      clipMaskMode: 'inside',
    };
    const triggerBtn: DesignNode = {
      ...createRectNode(2),
      id: 'btn-move',
      name: 'Move Mask',
      x: 20,
      y: 20,
      width: 80,
      height: 36,
    };
    const transformExpr = 'translateX(60px) rotate(30deg) scale(1.2)';
    page.document.nodes = [maskBase, clippedLayer, triggerBtn];
    project.logicGraphs = [
      makeTransformClickGraph('g-move', 'page', page.id, [
        { triggerId: 'btn-move', targetNodeId: 'mask-base', transform: transformExpr },
      ]),
    ];

    expect(validateProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);

    // Headless runtime -> Main Canvas SVG artwork
    const runtime = createPrototypeRuntime(project, { pageId: page.id });
    const snap = runtime.dispatchNodeEvent('btn-move', 'click');
    expect(snap.nodeOverrides['mask-base']?.transform).toBe(transformExpr);

    const expectedCanvasSvg = cssTransformToSvgTransform(transformExpr, 160, 140, 120, 80);
    const canvasTree = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-main',
        nodeOverrides: snap.nodeOverrides,
      }),
    );

    const maskNodes = findVNodes(
      canvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'mask-base',
    );
    expect(maskNodes.length).toBeGreaterThan(0);
    for (const maskNode of maskNodes) {
      expect(maskNode.props.transform).toBe(expectedCanvasSvg);
    }

    const visualBaseNodes = findVNodes(
      canvasTree,
      (v) => v.props?.['data-node-id'] === 'mask-base',
    );
    expect(visualBaseNodes.length).toBe(1);
    const visualBaseTransforms = findVNodes(
      visualBaseNodes[0],
      (v) => typeof v.props?.transform === 'string',
    ).map((v) => v.props.transform);
    expect(visualBaseTransforms).toEqual([expectedCanvasSvg]);

    // Live Preview HTML/CSS + script execution
    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.pageCssContent).toContain('mask: url(#folio-mask-');
    expect(compiled.pageCssContent).not.toContain('clip-path: ellipse(');
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="mask-base"');

    const script = buildLivePreviewLogicScript(project, page);
    expect(script).not.toBeNull();
    const dom = createMockDomFromCompiledHtml(compiled.htmlFile.content);
    dom.runScript(script!);
    dom.click('btn-move');

    const expectedMaskLocalSvg = cssTransformToSvgTransform(transformExpr, 80, 60, 120, 80);
    expect(dom.folioEls.get('mask-base')?.style.transform).toBe(transformExpr);
    expect(dom.maskBaseEls.length).toBe(1);
    expect(dom.maskBaseEls[0].getAttribute('transform')).toBe(expectedMaskLocalSvg);

    // React export parity
    const reactFiles = compileReactProjectFiles(project, page.id);
    const pageTsx = reactFiles.find((f) => f.path.startsWith('src/pages/'));
    expect(pageTsx?.content).toContain('function folioCssTransformToSvg(');
    expect(pageTsx?.content).toContain(
      'folioCssTransformToSvg(logicOverrides["mask-base"]?.transform, 80, 60, 120, 80)',
    );
  });

  it('2) moves forward and returns/resets cleanly ("" and "none") for both unrotated and statically rotated mask bases', () => {
    const project = createInitialProject('Forward And Reset');
    const page = project.pages[0];
    const maskBase: DesignNode = {
      ...createRectNode(0),
      id: 'rot-base',
      name: 'Rotated Mask',
      x: 100,
      y: 100,
      width: 100,
      height: 60,
      rotation: 15,
    };
    const clipped: DesignNode = {
      ...createRectNode(1),
      id: 'clipped-box',
      name: 'Clipped Box',
      x: 80,
      y: 80,
      width: 180,
      height: 160,
      clipMaskBaseId: 'rot-base',
      clipMaskMode: 'inside',
    };
    const btnForward = { ...createRectNode(2), id: 'btn-fwd', name: 'Forward' };
    const btnBackEmpty = { ...createRectNode(3), id: 'btn-back-empty', name: 'Reset Empty' };
    const btnBackNone = { ...createRectNode(4), id: 'btn-back-none', name: 'Reset None' };
    page.document.nodes = [maskBase, clipped, btnForward, btnBackEmpty, btnBackNone];
    project.logicGraphs = [
      makeTransformClickGraph('g-fwd-back', 'page', page.id, [
        { triggerId: 'btn-fwd', targetNodeId: 'rot-base', transform: 'translateX(90px) rotate(45deg)' },
        { triggerId: 'btn-back-empty', targetNodeId: 'rot-base', transform: '' },
        { triggerId: 'btn-back-none', targetNodeId: 'rot-base', transform: 'none' },
      ]),
    ];

    const runtime = createPrototypeRuntime(project, { pageId: page.id });
    const compiled = compilePageHtmlCss(project, page);
    const script = buildLivePreviewLogicScript(project, page)!;
    const dom = createMockDomFromCompiledHtml(compiled.htmlFile.content);
    dom.runScript(script);

    // Initial static rotation present before any interaction
    expect(dom.maskBaseEls[0].getAttribute('transform')).toBe('rotate(15 70 50)');

    // Move forward
    const snapFwd = runtime.dispatchNodeEvent('btn-fwd', 'click');
    dom.click('btn-fwd');
    const canvasFwd = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-fwd',
        nodeOverrides: snapFwd.nodeOverrides,
      }),
    );
    const fwdMask = findVNodes(canvasFwd, (v) => v.props?.['data-mask-base-id'] === 'rot-base')[0];
    expect(fwdMask.props.transform).toBe(
      cssTransformToSvgTransform('translateX(90px) rotate(45deg)', 150, 130, 100, 60),
    );
    expect(dom.maskBaseEls[0].getAttribute('transform')).toBe(
      cssTransformToSvgTransform('translateX(90px) rotate(45deg)', 70, 50, 100, 60),
    );

    // Reset back via ""
    const snapResetEmpty = runtime.dispatchNodeEvent('btn-back-empty', 'click');
    dom.click('btn-back-empty');
    const canvasResetEmpty = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-reset-empty',
        nodeOverrides: snapResetEmpty.nodeOverrides,
      }),
    );
    const resetEmptyMask = findVNodes(
      canvasResetEmpty,
      (v) => v.props?.['data-mask-base-id'] === 'rot-base',
    )[0];
    expect(resetEmptyMask.props.transform).toBe('rotate(15 150 130)');
    expect(dom.folioEls.get('rot-base')?.style.transform).toBe('');
    expect(dom.maskBaseEls[0].getAttribute('transform')).toBe('rotate(15 70 50)');

    // Move forward again, then reset via "none"
    runtime.dispatchNodeEvent('btn-fwd', 'click');
    dom.click('btn-fwd');
    const snapResetNone = runtime.dispatchNodeEvent('btn-back-none', 'click');
    dom.click('btn-back-none');
    const canvasResetNone = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-reset-none',
        nodeOverrides: snapResetNone.nodeOverrides,
      }),
    );
    const resetNoneMask = findVNodes(
      canvasResetNone,
      (v) => v.props?.['data-mask-base-id'] === 'rot-base',
    )[0];
    expect(resetNoneMask.props.transform).toBe('rotate(15 150 130)');
    expect(dom.maskBaseEls[0].getAttribute('transform')).toBe('rotate(15 70 50)');
  });

  it('3) supports Group as clipping mask base (static children + dynamic group transform + zero double-transform)', () => {
    const project = createInitialProject('Group Mask Base');
    const page = project.pages[0];
    const maskGroup: DesignNode = makeGroupNode('mask-group', 'Mask Group', 100, 100, 160, 100);
    const childRect: DesignNode = {
      ...createRectNode(1),
      id: 'group-child-rect',
      name: 'Child Rect',
      parentId: 'mask-group',
      x: 100,
      y: 100,
      width: 70,
      height: 100,
    };
    const childEllipse: DesignNode = {
      ...createEllipseNode(2),
      id: 'group-child-ellipse',
      name: 'Child Ellipse',
      parentId: 'mask-group',
      x: 180,
      y: 110,
      width: 80,
      height: 80,
    };
    const clipped: DesignNode = {
      ...createRectNode(3),
      id: 'group-clipped',
      name: 'Group Clipped Target',
      x: 80,
      y: 80,
      width: 260,
      height: 180,
      clipMaskBaseId: 'mask-group',
      clipMaskMode: 'inside',
    };
    const btnTransformGroup = { ...createRectNode(4), id: 'btn-grp', name: 'Move Group' };
    const btnResetGroup = { ...createRectNode(5), id: 'btn-grp-reset', name: 'Reset Group' };

    page.document.nodes = [
      maskGroup,
      childRect,
      childEllipse,
      clipped,
      btnTransformGroup,
      btnResetGroup,
    ];
    const groupTransform = 'translate(40px, -20px) scale(1.25)';
    project.logicGraphs = [
      makeTransformClickGraph('g-group-mask', 'page', page.id, [
        { triggerId: 'btn-grp', targetNodeId: 'mask-group', transform: groupTransform },
        { triggerId: 'btn-grp-reset', targetNodeId: 'mask-group', transform: '' },
      ]),
    ];

    // Static HTML/CSS emits real SVG group children inside <mask>, not a bbox rect
    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.pageCssContent).toContain('mask: url(#folio-mask-');
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="mask-group"');
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="group-child-rect"');
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="group-child-ellipse"');
    expect(compiled.htmlFile.content).toContain('<ellipse ');

    // Dynamic transform on Canvas SVG
    const runtime = createPrototypeRuntime(project, { pageId: page.id });
    const snap = runtime.dispatchNodeEvent('btn-grp', 'click');
    const canvasTree = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-group',
        nodeOverrides: snap.nodeOverrides,
      }),
    );
    const expectedGroupCanvasSvg = cssTransformToSvgTransform(groupTransform, 180, 150, 160, 100);

    // Mask group wrapper has transform ONCE; its direct children do NOT duplicate it
    const maskGroupVNodes = findVNodes(
      canvasTree,
      (v) => v.type === 'g' && v.props?.['data-mask-base-id'] === 'mask-group',
    );
    expect(maskGroupVNodes.length).toBe(1);
    expect(maskGroupVNodes[0].props.transform).toBe(expectedGroupCanvasSvg);

    const maskChildRectChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'group-child-rect',
    );
    expect(maskChildRectChain).toEqual([[expectedGroupCanvasSvg!]]);

    const maskChildEllipseChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'group-child-ellipse',
    );
    expect(maskChildEllipseChain).toEqual([[expectedGroupCanvasSvg!]]);

    // Visual children in Canvas also inherit mask-group transform strictly ONCE
    const visualChildRectChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-node-id'] === 'group-child-rect',
    );
    expect(visualChildRectChain).toEqual([[expectedGroupCanvasSvg!]]);

    // Live Preview execution: group wrapper moves ONCE, children inside mask stay clean
    const script = buildLivePreviewLogicScript(project, page)!;
    const dom = createMockDomFromCompiledHtml(compiled.htmlFile.content);
    dom.runScript(script);
    dom.click('btn-grp');

    const expectedGroupLocalSvg = cssTransformToSvgTransform(groupTransform, 100, 70, 160, 100);
    const maskGroupEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'mask-group',
    );
    const maskChildRectEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'group-child-rect',
    );
    const maskChildEllipseEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'group-child-ellipse',
    );
    expect(dom.folioEls.get('mask-group')?.style.transform).toBe(groupTransform);
    expect(maskGroupEl?.getAttribute('transform')).toBe(expectedGroupLocalSvg);
    expect(maskChildRectEl?.getAttribute('transform')).toBeNull();
    expect(maskChildEllipseEl?.getAttribute('transform')).toBeNull();

    // Resetting group mask clears transform cleanly
    dom.click('btn-grp-reset');
    expect(dom.folioEls.get('mask-group')?.style.transform).toBe('');
    expect(maskGroupEl?.getAttribute('transform')).toBeNull();
  });

  it('4) preserves static clipping masks without regressions (inside CSS clip-path, outside SVG mask, rotated path mask)', () => {
    const project = createInitialProject('Static Clip Masks');
    const page = project.pages[0];
    const staticEllipse: DesignNode = {
      ...createEllipseNode(0),
      id: 'static-ellipse',
      name: 'Static Ellipse',
      x: 100,
      y: 100,
      width: 140,
      height: 140,
    };
    const staticInside: DesignNode = {
      ...createRectNode(1),
      id: 'static-inside',
      name: 'Static Inside',
      x: 90,
      y: 90,
      width: 160,
      height: 160,
      clipMaskBaseId: 'static-ellipse',
      clipMaskMode: 'inside',
    };
    const staticOutside: DesignNode = {
      ...createRectNode(2),
      id: 'static-outside',
      name: 'Static Outside',
      x: 80,
      y: 80,
      width: 180,
      height: 180,
      clipMaskBaseId: 'static-ellipse',
      clipMaskMode: 'outside',
    };
    const rotatedPath: DesignNode = {
      ...createTriangleNode(320, 100, 100, 80),
      id: 'static-path',
      name: 'Rotated Path Mask',
      rotation: 20,
    };
    const pathClipped: DesignNode = {
      ...createRectNode(4),
      id: 'static-path-clipped',
      name: 'Path Clipped',
      x: 300,
      y: 80,
      width: 140,
      height: 120,
      clipMaskBaseId: 'static-path',
      clipMaskMode: 'inside',
    };

    page.document.nodes = [staticEllipse, staticInside, staticOutside, rotatedPath, pathClipped];

    const compiled = compilePageHtmlCss(project, page);
    // Static unrotated inside ellipse keeps lightweight CSS clip-path
    expect(compiled.pageCssContent).toContain('clip-path: ellipse(');
    // Outside mask and rotated path mask use SVG <mask>
    expect(compiled.pageCssContent).toContain('mask: url(#folio-mask-');
    expect(compiled.htmlFile.content).toContain('<mask id="folio-mask-');
    // Rotated path has rotation ONCE on <g>, NOT duplicated on <path>
    const pathMaskTag = compiled.htmlFile.content.match(
      /<g[^>]*data-folio-mask-base="static-path"[^>]*><path[^>]*\/>/,
    )?.[0];
    expect(pathMaskTag).toBeDefined();
    expect(pathMaskTag).toContain('transform="rotate(20 70 60)"');
    expect(pathMaskTag).toContain('<path d="');
    expect(pathMaskTag).toContain('transform="translate(20 20)"');
    expect(pathMaskTag).not.toMatch(/<path[^>]*rotate\(/);

    // Canvas static rendering with no overrides works identically
    const canvasTree = expandVNodeTree(
      DocumentArtworkContent({ document: page.document, maskPrefix: 'test-static' }),
    );
    const staticMasks = findVNodes(canvasTree, (v) => v.type === 'mask');
    expect(staticMasks.length).toBeGreaterThanOrEqual(3);
  });

  it('5) keeps Component Canvas, Main Canvas instance, Live Preview, and React export consistent', () => {
    const project = createInitialProject('Component Clip Mask Parity');
    const page: FolioPage = project.pages[0];

    const compMaskBase: DesignNode = {
      ...createRectNode(0),
      id: 'comp-mask-base',
      name: 'Comp Mask',
      x: 20,
      y: 20,
      width: 100,
      height: 80,
    };
    const compClipped: DesignNode = {
      ...createRectNode(1),
      id: 'comp-clipped',
      name: 'Comp Clipped',
      x: 10,
      y: 10,
      width: 140,
      height: 120,
      clipMaskBaseId: 'comp-mask-base',
      clipMaskMode: 'inside',
    };
    const compTrigger: DesignNode = {
      ...createRectNode(2),
      id: 'comp-trigger',
      name: 'Comp Trigger',
      x: 10,
      y: 140,
      width: 80,
      height: 30,
    };

    const masterComponent: ComponentDefinition = {
      id: 'comp-mask-card',
      name: 'Mask Card',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodeLogicEnabled: true,
      document: {
        id: 'doc-comp-mask-card',
        name: 'Mask Card',
        width: 200,
        height: 200,
        background: '#ffffff',
        nodes: [compMaskBase, compClipped, compTrigger],
      },
    };

    const instanceNode = makeInstanceNode('inst-1', 'Mask Card Instance', masterComponent, 60, 60);

    const compTransform = 'translateX(50px) rotate(20deg)';
    project.components = [masterComponent];
    page.document.nodes = [instanceNode];
    project.logicGraphs = [
      makeTransformClickGraph('g-comp-mask', 'component', masterComponent.id, [
        { triggerId: 'comp-trigger', targetNodeId: 'comp-mask-base', transform: compTransform },
      ]),
    ];

    // (a) Component Canvas runtime + SVG artwork
    const compRuntime = createPrototypeRuntime(project, { componentId: masterComponent.id });
    const compSnap = compRuntime.dispatchNodeEvent('comp-trigger', 'click');
    expect(compSnap.nodeOverrides['comp-mask-base']?.transform).toBe(compTransform);

    const expectedCompCanvasSvg = cssTransformToSvgTransform(compTransform, 70, 60, 100, 80);
    const compCanvasTree = expandVNodeTree(
      DocumentArtworkContent({
        document: masterComponent.document,
        components: [masterComponent],
        maskPrefix: 'test-comp',
        nodeOverrides: compSnap.nodeOverrides,
      }),
    );
    const compCanvasMask = findVNodes(
      compCanvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'comp-mask-base',
    )[0];
    const compCanvasVisualWrapper = findVNodes(
      compCanvasTree,
      (v) => v.props?.['data-node-id'] === 'comp-mask-base',
    )[0];
    const compCanvasVisualTransforms = findVNodes(
      compCanvasVisualWrapper,
      (v) => typeof v.props?.transform === 'string',
    ).map((v) => v.props.transform);
    expect(compCanvasMask?.props.transform).toBe(expectedCompCanvasSvg);
    expect(compCanvasVisualTransforms).toEqual([expectedCompCanvasSvg]);

    // (b) Main Canvas runtime (scoped instance ID) + SVG artwork
    const mainRuntime = createPrototypeRuntime(project, { pageId: page.id });
    const mainSnap = mainRuntime.dispatchNodeEvent('inst-1__comp-trigger', 'click');
    expect(mainSnap.nodeOverrides['inst-1__comp-mask-base']?.transform).toBe(compTransform);

    const mainCanvasTree = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        components: [masterComponent],
        maskPrefix: 'test-main-inst',
        nodeOverrides: mainSnap.nodeOverrides,
      }),
    );
    const mainInstanceMask = findVNodes(
      mainCanvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'inst-1__comp-mask-base',
    )[0];
    expect(mainInstanceMask?.props.transform).toBe(expectedCompCanvasSvg);

    // (c) Live Preview HTML/CSS + script execution
    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.pageCssContent).toContain('mask: url(#folio-mask-');
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="inst-1__comp-mask-base"');

    const script = buildLivePreviewLogicScript(project, page)!;
    const dom = createMockDomFromCompiledHtml(compiled.htmlFile.content);
    dom.runScript(script);
    dom.click('inst-1__comp-trigger');

    const expectedCompLocalSvg = cssTransformToSvgTransform(compTransform, 60, 50, 100, 80);
    expect(dom.folioEls.get('inst-1__comp-mask-base')?.style.transform).toBe(compTransform);
    const instMaskEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'inst-1__comp-mask-base',
    );
    expect(instMaskEl?.getAttribute('transform')).toBe(expectedCompLocalSvg);

    // (d) React export component TSX + CSS
    const reactFiles = compileReactProjectFiles(project, page.id);
    const compCss = reactFiles.find((f) => f.path === 'src/components/MaskCard.css');
    const compTsx = reactFiles.find((f) => f.path === 'src/components/MaskCard.tsx');
    expect(compCss?.content).toContain('mask: url(#folio-mask-');
    expect(compTsx?.content).toContain('function folioCssTransformToSvg(');
    expect(compTsx?.content).toContain(
      'folioCssTransformToSvg(logicOverrides?.[scopedId("comp-mask-base")]?.transform, 60, 50, 100, 80)',
    );
  });

  it('6) prevents double-transform for shared ancestor groups and propagates transform once for mask-only ancestor groups', () => {
    const project = createInitialProject('Zero Double Transform');
    const page = project.pages[0];

    // Case A: Shared ancestor group wraps BOTH base and clipped layer
    const sharedGroup: DesignNode = makeGroupNode('shared-group', 'Shared Group', 40, 40, 200, 160);
    const sharedBase: DesignNode = {
      ...createRectNode(1),
      id: 'shared-base',
      name: 'Shared Base',
      parentId: 'shared-group',
      x: 60,
      y: 60,
      width: 100,
      height: 80,
    };
    const sharedClipped: DesignNode = {
      ...createRectNode(2),
      id: 'shared-clipped',
      name: 'Shared Clipped',
      parentId: 'shared-group',
      x: 40,
      y: 40,
      width: 200,
      height: 160,
      clipMaskBaseId: 'shared-base',
      clipMaskMode: 'inside',
    };

    // Case B: Non-shared ancestor group wraps ONLY the mask base (clipped layer is sibling outside)
    const maskOnlyGroup: DesignNode = makeGroupNode('mask-only-group', 'Mask Only Group', 320, 60, 100, 80);
    const nestedBase: DesignNode = {
      ...createRectNode(4),
      id: 'nested-base',
      name: 'Nested Base',
      parentId: 'mask-only-group',
      x: 320,
      y: 60,
      width: 100,
      height: 80,
    };
    const outsideClipped: DesignNode = {
      ...createRectNode(5),
      id: 'outside-clipped',
      name: 'Outside Clipped',
      x: 300,
      y: 40,
      width: 200,
      height: 160,
      clipMaskBaseId: 'nested-base',
      clipMaskMode: 'inside',
    };

    const btnMoveShared = { ...createRectNode(6), id: 'btn-shared', name: 'Move Shared' };
    const btnMoveMaskOnly = { ...createRectNode(7), id: 'btn-mask-only', name: 'Move Mask Only' };

    page.document.nodes = [
      sharedGroup,
      sharedBase,
      sharedClipped,
      maskOnlyGroup,
      nestedBase,
      outsideClipped,
      btnMoveShared,
      btnMoveMaskOnly,
    ];
    project.logicGraphs = [
      makeTransformClickGraph('g-ancestors', 'page', page.id, [
        { triggerId: 'btn-shared', targetNodeId: 'shared-group', transform: 'translateX(75px)' },
        { triggerId: 'btn-mask-only', targetNodeId: 'mask-only-group', transform: 'translateX(45px)' },
      ]),
    ];

    // HTML/CSS + Live Preview verification
    const compiled = compilePageHtmlCss(project, page);
    // Shared ancestor group MUST NOT be duplicated inside <mask> (DOM transform on shared-group moves both)
    expect(compiled.htmlFile.content).not.toContain('data-folio-mask-base="shared-group"');
    // Mask-only ancestor group MUST be wrapped inside outside-clipped's <mask>
    expect(compiled.htmlFile.content).toContain('data-folio-mask-base="mask-only-group"');

    const script = buildLivePreviewLogicScript(project, page)!;
    const dom = createMockDomFromCompiledHtml(compiled.htmlFile.content);
    dom.runScript(script);

    dom.click('btn-shared');
    expect(dom.folioEls.get('shared-group')?.style.transform).toBe('translateX(75px)');
    const sharedBaseMaskEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'shared-base',
    );
    expect(sharedBaseMaskEl?.getAttribute('transform') ?? null).toBeNull();

    dom.click('btn-mask-only');
    expect(dom.folioEls.get('mask-only-group')?.style.transform).toBe('translateX(45px)');
    const maskOnlyGroupMaskEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'mask-only-group',
    );
    const nestedBaseMaskEl = dom.maskBaseEls.find(
      (el) => el.getAttribute('data-folio-mask-base') === 'nested-base',
    );
    expect(maskOnlyGroupMaskEl?.getAttribute('transform')).toBe('translate(45 0)');
    expect(nestedBaseMaskEl?.getAttribute('transform')).toBeNull();

    // Main Canvas SVG verification: shared-group transform appears ONCE on mask-base AND ONCE on clipped node (NOT on <g mask>)
    const runtime = createPrototypeRuntime(project, { pageId: page.id });
    runtime.dispatchNodeEvent('btn-shared', 'click');
    const snap = runtime.dispatchNodeEvent('btn-mask-only', 'click');
    const canvasTree = expandVNodeTree(
      DocumentArtworkContent({
        document: page.document,
        maskPrefix: 'test-double',
        nodeOverrides: snap.nodeOverrides,
      }),
    );

    const sharedMaskChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'shared-base',
    );
    expect(sharedMaskChain).toEqual([['translate(75 0)']]);

    const sharedClippedVisualChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-node-id'] === 'shared-clipped',
    );
    expect(sharedClippedVisualChain).toEqual([['translate(75 0)']]);

    const maskWrapperNodes = findVNodes(
      canvasTree,
      (v) => v.type === 'g' && typeof v.props?.mask === 'string',
    );
    expect(maskWrapperNodes.length).toBeGreaterThan(0);
    for (const wrapper of maskWrapperNodes) {
      expect(wrapper.props.transform).toBeUndefined();
    }

    const maskOnlyChain = collectAncestorTransforms(
      canvasTree,
      (v) => v.props?.['data-mask-base-id'] === 'nested-base',
    );
    expect(maskOnlyChain).toEqual([['translate(45 0)']]);
  });
});

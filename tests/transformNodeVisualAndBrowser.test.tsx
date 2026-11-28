import { describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useState: vi.fn((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ]),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
  useMemo: vi.fn((factory: () => unknown) => factory()),
  useCallback: vi.fn((fn: unknown) => fn),
}));

vi.mock('preact/hooks', () => hookMocks);

import { NodeLogicBrowser } from '../src/app/workspace/NodeLogicBrowser';
import { NodeLogicNodeFields } from '../src/app/workspace/NodeLogicNodeFields';
import { NodeLogicTransformPreview } from '../src/app/workspace/NodeLogicTransformPreview';
import type { NodeLogicOwnerContext } from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  createEllipseNode,
  createEmptyDocument,
  createInitialProject,
  createRectNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { ComponentDefinition, EllipseNode, FolioProject, LogicGraph, RectNode } from '../src/core/document/types';
import {
  computeVisualTransformDelta,
  createLogicGraph,
  createLogicNode,
  parseCssTransformForVisual,
  serializeVisualTransformToCss,
} from '../src/engines/prototype';

interface VNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function collectElements(node: unknown, predicate: (el: VNodeLike) => boolean, out: VNodeLike[] = []): VNodeLike[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, predicate, out);
    return out;
  }
  const vnode = node as VNodeLike;
  if (typeof vnode.type === 'function') {
    const rendered = (vnode.type as (props: Record<string, unknown>) => unknown)(vnode.props ?? {});
    collectElements(rendered, predicate, out);
    return out;
  }
  if (predicate(vnode)) out.push(vnode);
  const children = vnode.props?.children;
  if (children !== undefined && children !== null) {
    collectElements(children, predicate, out);
  }
  return out;
}

function findByTestId(tree: unknown, testId: string): VNodeLike | undefined {
  return collectElements(tree, (el) => el.props?.['data-testid'] === testId)[0];
}

function makeEllipse(overrides: Partial<EllipseNode> & { fill?: string }): EllipseNode {
  const base = createEllipseNode(0);
  const { fill, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    style: { ...base.style, ...(fill !== undefined ? { fill } : {}), ...(overrides.style ?? {}) },
  };
}

function makeRect(overrides: Partial<RectNode> & { fill?: string }): RectNode {
  const base = createRectNode(0);
  const { fill, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    style: { ...base.style, ...(fill !== undefined ? { fill } : {}), ...(overrides.style ?? {}) },
  };
}

function createBrowserFixtureProject(): {
  project: FolioProject;
  page1Id: string;
  page2Id: string;
  compSun: ComponentDefinition;
  compBadge: ComponentDefinition;
  projectGraph: LogicGraph;
  page1Graph: LogicGraph;
  compSunGraph: LogicGraph;
} {
  const base = createInitialProject('Transform & Browser Project');
  const page1 = getActivePage(base);
  const page2 = {
    id: 'page-settings',
    name: 'Settings',
    route: '/settings',
    document: { ...createEmptyDocument('Settings'), id: 'doc-settings' },
  };

  const sunCircle = makeEllipse({ id: 'sun-orb', name: 'Sun Orb', x: 20, y: 20, width: 64, height: 64, fill: '#FACC15' });
  const compSun: ComponentDefinition = {
    id: 'comp-sun-moon',
    name: 'Sun-Moon Toggle',
    scope: 'global',
    nodeLogicEnabled: true,
    document: { ...createEmptyDocument('Sun-Moon Toggle'), id: 'doc-sun-moon', width: 240, height: 140, nodes: [sunCircle] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const compBadge: ComponentDefinition = {
    id: 'comp-badge',
    name: 'Status Badge',
    scope: 'global',
    document: { ...createEmptyDocument('Status Badge'), id: 'doc-badge', width: 120, height: 48, nodes: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const projectGraph = createLogicGraph({
    id: 'graph-project-global',
    name: 'Global Theme Sync',
    scope: 'project',
    targetId: null,
    nodes: [],
    connections: [],
  });
  const page1Graph = createLogicGraph({
    id: 'graph-page-home',
    name: 'Home Hero Flow',
    scope: 'page',
    targetId: page1.id,
    nodes: [createLogicNode({ id: 'ln-home-1', type: 'event.on-click', x: 60, y: 80 })],
    connections: [],
  });
  const compSunGraph = createLogicGraph({
    id: 'graph-comp-sun',
    name: 'Sun-Moon Flip Logic',
    scope: 'component',
    targetId: compSun.id,
    nodes: [
      createLogicNode({ id: 'ln-sun-1', type: 'event.on-click', x: 60, y: 80, data: { targetNodeId: sunCircle.id } }),
      createLogicNode({
        id: 'ln-sun-xform',
        type: 'action.set-layer',
        x: 340,
        y: 80,
        data: { targetMode: 'override', targetNodeId: sunCircle.id, property: 'transform', transform: 'translate(80px, 0px) rotate(180deg)' },
      }),
    ],
    connections: [],
  });

  return {
    project: {
      ...base,
      pages: [page1, page2],
      components: [compSun, compBadge],
      logicGraphs: [projectGraph, page1Graph, compSunGraph],
    },
    page1Id: page1.id,
    page2Id: page2.id,
    compSun,
    compBadge,
    projectGraph,
    page1Graph,
    compSunGraph,
  };
}

describe('Transform Node Visual Mode & CSS Mode', () => {
  it('parses and serializes Visual Mode transform values consistently with CSS Mode', () => {
    const parsed = parseCssTransformForVisual('translate(40px, -20px) rotate(15deg) scale(1.25)');
    expect(parsed.supported).toBe(true);
    expect(parsed.values).toEqual({
      translateX: 40,
      translateY: -20,
      rotate: 15,
      scaleX: 1.25,
      scaleY: 1.25,
      uniformScale: true,
    });

    const css = serializeVisualTransformToCss({
      translateX: 40,
      translateY: -20,
      rotate: 15,
      scaleX: 1.25,
      scaleY: 1.25,
      uniformScale: true,
    });
    expect(css).toBe('translate(40px, -20px) rotate(15deg) scale(1.25)');

    const nonUniform = parseCssTransformForVisual('translateX(12px) scale(1.5, 0.8)');
    expect(nonUniform.supported).toBe(true);
    expect(nonUniform.values.uniformScale).toBe(false);
    expect(serializeVisualTransformToCss(nonUniform.values)).toBe('translateX(12px) scale(1.5, 0.8)');

    expect(parseCssTransformForVisual('none').supported).toBe(true);
    expect(serializeVisualTransformToCss(parseCssTransformForVisual('').values)).toBe('scale(1)');
  });

  it('preserves advanced CSS transform syntax in CSS Mode without corrupting it', () => {
    const complex = parseCssTransformForVisual('perspective(600px) rotateY(30deg) skewX(10deg)');
    expect(complex.supported).toBe(false);

    const calcExpr = parseCssTransformForVisual('translateX(50%)');
    expect(calcExpr.supported).toBe(false);
  });

  it('computes accurate pixel delta for Set in Canvas drag operations', () => {
    const delta = computeVisualTransformDelta({ x: 30, y: 40 }, { x: 112.5, y: 24.2 });
    expect(delta).toEqual({ translateX: 82.5, translateY: -15.8 });
  });

  it('renders Visual Mode by default with Move/Rotate/Scale + Set in Canvas, and writes back to node.data.transform', () => {
    const onUpdateNodeData = vi.fn();
    const onToggleTransformPreview = vi.fn();
    const rect = makeRect({ id: 'card-1', name: 'Card', x: 20, y: 30, width: 120, height: 80 });
    const logicNode = createLogicNode({
      id: 'ln-xform',
      type: 'action.set-layer',
      x: 100,
      y: 100,
      data: {
        targetMode: 'override',
        targetNodeId: rect.id,
        property: 'transform',
        transform: 'translate(24px, -12px) rotate(10deg) scale(1.2)',
      },
    });
    const graph = createLogicGraph({
      id: 'g-1',
      name: 'Test',
      scope: 'page',
      targetId: 'page-1',
      nodes: [logicNode],
      connections: [],
    });

    const tree = NodeLogicNodeFields({
      node: logicNode,
      graph,
      scopedAstNodes: [rect],
      availableVariables: [],
      components: [],
      pages: [],
      themes: [],
      animations: [],
      onChangeTab: vi.fn(),
      onUpdateNodeData,
      activeTransformPreviewNodeId: null,
      onToggleTransformPreview,
    });

    expect(findByTestId(tree, 'nl-transform-visual-panel')).toBeTruthy();
    const moveXInput = findByTestId(tree, 'nl-transform-move-x');
    expect(moveXInput?.props?.value).toBe(24);
    (moveXInput?.props?.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: '60' },
    });
    expect(onUpdateNodeData).toHaveBeenCalledWith('ln-xform', {
      transform: 'translate(60px, -12px) rotate(10deg) scale(1.2)',
    });

    const setInCanvasBtn = findByTestId(tree, 'nl-transform-set-in-canvas-btn');
    expect(setInCanvasBtn).toBeTruthy();
    (setInCanvasBtn?.props?.onClick as () => void)();
    expect(onToggleTransformPreview).toHaveBeenCalledWith('ln-xform');
  });

  it('defaults to CSS Mode when custom unsupported CSS transform is present', () => {
    const onUpdateNodeData = vi.fn();
    const logicNode = createLogicNode({
      id: 'ln-css-only',
      type: 'action.set-layer',
      x: 100,
      y: 100,
      data: {
        targetMode: 'override',
        targetNodeId: 'card-1',
        property: 'transform',
        transform: 'matrix(1, 0.2, -0.2, 1, 20, 10)',
      },
    });

    const tree = NodeLogicNodeFields({
      node: logicNode,
      graph: null,
      scopedAstNodes: [],
      availableVariables: [],
      components: [],
      pages: [],
      themes: [],
      animations: [],
      onChangeTab: vi.fn(),
      onUpdateNodeData,
    });

    const cssInput = findByTestId(tree, 'nl-transform-css-input');
    expect(cssInput).toBeTruthy();
    expect(cssInput?.props?.value).toBe('matrix(1, 0.2, -0.2, 1, 20, 10)');
  });

  it('renders contextual Set in Canvas preview with origin ghost, destination box, and Reset/Done actions', () => {
    const onUpdateNodeData = vi.fn();
    const onClose = vi.fn();
    const sunOrb = makeEllipse({ id: 'sun-orb', name: 'Sun Orb', x: 20, y: 30, width: 60, height: 60, fill: '#FACC15' });
    const doc = { ...createEmptyDocument('Sun-Moon'), id: 'doc-sun', width: 240, height: 140, nodes: [sunOrb] };
    const logicNode = createLogicNode({
      id: 'ln-xform-sun',
      type: 'action.set-layer',
      x: 0,
      y: 0,
      data: {
        targetMode: 'override',
        targetNodeId: sunOrb.id,
        property: 'transform',
        transform: 'translate(90px, 10px)',
      },
    });

    const tree = NodeLogicTransformPreview({
      document: doc,
      components: [],
      logicNode,
      ownerLabel: 'Sun-Moon Toggle',
      onUpdateNodeData,
      onClose,
    });

    const ghost = findByTestId(tree, 'nl-transform-ghost-origin');
    const targetBox = findByTestId(tree, 'nl-transform-target-box');
    expect(ghost?.props?.x).toBe(20);
    expect(ghost?.props?.y).toBe(30);
    expect(targetBox?.props?.x).toBe(110);
    expect(targetBox?.props?.y).toBe(40);

    const resetBtn = findByTestId(tree, 'nl-transform-preview-reset');
    (resetBtn?.props?.onClick as () => void)();
    expect(onUpdateNodeData).toHaveBeenCalledWith('ln-xform-sun', { transform: 'scale(1)' });

    const doneBtn = findByTestId(tree, 'nl-transform-preview-done');
    (doneBtn?.props?.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Node Logic Browser — Scope Navigation without Opening Owner First', () => {
  it('groups graphs into Project, Page, and Component sections and supports Open Logic + Open Owner directly', () => {
    const fixture = createBrowserFixtureProject();
    const onOpenLogic = vi.fn();
    const onOpenOwner = vi.fn();
    const onClose = vi.fn();
    const activeOwner: NodeLogicOwnerContext = { scope: 'page', pageId: fixture.page1Id };

    const tree = NodeLogicBrowser({
      project: fixture.project,
      activePageId: fixture.page1Id,
      activeOwnerContext: activeOwner,
      activeGraphId: fixture.page1Graph.id,
      onOpenLogic,
      onOpenOwner,
      onClose,
    });

    expect(findByTestId(tree, 'nl-browser-group-project')).toBeTruthy();
    expect(findByTestId(tree, 'nl-browser-group-page')).toBeTruthy();
    expect(findByTestId(tree, 'nl-browser-group-component')).toBeTruthy();

    expect(findByTestId(tree, `nl-browser-row-${fixture.projectGraph.id}`)).toBeTruthy();
    expect(findByTestId(tree, `nl-browser-row-${fixture.page1Graph.id}`)).toBeTruthy();
    expect(findByTestId(tree, `nl-browser-row-${fixture.compSunGraph.id}`)).toBeTruthy();

    expect(findByTestId(tree, `nl-browser-empty-page-${fixture.page2Id}`)).toBeTruthy();
    expect(findByTestId(tree, `nl-browser-empty-component-${fixture.compBadge.id}`)).toBeTruthy();

    const openCompLogicBtn = findByTestId(tree, `nl-browser-open-logic-${fixture.compSunGraph.id}`);
    (openCompLogicBtn?.props?.onClick as () => void)();
    expect(onOpenLogic).toHaveBeenCalledWith(
      { scope: 'component', componentId: fixture.compSun.id },
      fixture.compSunGraph.id,
    );

    const openCompOwnerBtn = findByTestId(tree, `nl-browser-open-owner-${fixture.compSunGraph.id}`);
    (openCompOwnerBtn?.props?.onClick as () => void)();
    expect(onOpenOwner).toHaveBeenCalledWith({
      scope: 'component',
      componentId: fixture.compSun.id,
    });

    const openEmptyCompBtn = findByTestId(tree, `nl-browser-open-logic-component-${fixture.compBadge.id}`);
    (openEmptyCompBtn?.props?.onClick as () => void)();
    expect(onOpenLogic).toHaveBeenCalledWith(
      { scope: 'component', componentId: fixture.compBadge.id },
      null,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { createFrameNode, createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { DesignNode, FrameNode, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { classifyNodeChange } from '../src/core/document/nodeChanges';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import {
  applyAutoLayoutToNodes,
  computeAutoLayoutNodes,
  createDefaultAutoLayout,
  getBreakpointCanvasWidth,
  resolveEffectiveNodeForBreakpoint,
} from '../src/engines/layout/autoLayout';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';

function makeContainerFrame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  layout: FrameNode['layout'],
  extra: Partial<FrameNode> = {},
): FrameNode {
  return {
    ...createFrameNode(0),
    id,
    name: id,
    x,
    y,
    width,
    height,
    layout,
    ...extra,
  };
}

function makeChildRect(
  id: string,
  parentId: string,
  width: number,
  height: number,
  extra: Partial<RectNode> = {},
): RectNode {
  return {
    ...createRectNode(0),
    id,
    name: id,
    parentId,
    x: 0,
    y: 0,
    width,
    height,
    ...extra,
  };
}

describe('Auto-Layout Engine (Flex & Grid)', () => {
  it('computes Flex row layout with padding, gap, justifyContent, and alignItems', () => {
    const container = makeContainerFrame('flex-row', 100, 50, 400, 120, {
      mode: 'flex',
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16,
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    const childA = makeChildRect('a', 'flex-row', 80, 40);
    const childB = makeChildRect('b', 'flex-row', 100, 60);

    const solved = computeAutoLayoutNodes([container, childA, childB]);
    const a = solved.find((n) => n.id === 'a')!;
    const b = solved.find((n) => n.id === 'b')!;

    // Inner width = 400 - 40 = 360; inner height = 120 - 40 = 80
    // Start X = 120; End of B = 120 + 360 = 480 => B.x = 380
    expect(a.x).toBe(120);
    expect(a.y).toBe(70 + (80 - 40) / 2); // 90
    expect(b.x).toBe(380);
    expect(b.y).toBe(70 + (80 - 60) / 2); // 80
  });

  it('supports Flex fill sizing, stretch alignment, wrapping, and container hug sizing', () => {
    const fillContainer = makeContainerFrame('flex-fill', 0, 0, 320, 100, {
      mode: 'flex',
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: 'start',
      alignItems: 'stretch',
      gap: 20,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const fixed = makeChildRect('fixed', 'flex-fill', 80, 30);
    const grow = makeChildRect('grow', 'flex-fill', 50, 30, {
      layoutChild: { widthMode: 'fill', heightMode: 'fill' },
    });

    const solvedFill = computeAutoLayoutNodes([fillContainer, fixed, grow]);
    const fixedOut = solvedFill.find((n) => n.id === 'fixed')!;
    const growOut = solvedFill.find((n) => n.id === 'grow')!;

    // Inner width = 300; minus fixed(80) and gap(20) => grow gets 200; inner height = 80
    expect(fixedOut.x).toBe(10);
    expect(fixedOut.height).toBe(80);
    expect(growOut.x).toBe(110);
    expect(growOut.width).toBe(200);
    expect(growOut.height).toBe(80);

    // Wrapping & container hug height
    const wrapContainer = makeContainerFrame(
      'flex-wrap',
      0,
      0,
      200,
      50,
      {
        mode: 'flex',
        direction: 'row',
        wrap: 'wrap',
        justifyContent: 'start',
        alignItems: 'start',
        gap: 10,
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      { layoutChild: { heightMode: 'hug' } },
    );
    const w1 = makeChildRect('w1', 'flex-wrap', 100, 40);
    const w2 = makeChildRect('w2', 'flex-wrap', 100, 40);
    const solvedWrap = computeAutoLayoutNodes([wrapContainer, w1, w2]);
    const cOut = solvedWrap.find((n) => n.id === 'flex-wrap')!;
    const w1Out = solvedWrap.find((n) => n.id === 'w1')!;
    const w2Out = solvedWrap.find((n) => n.id === 'w2')!;

    // 100 + 10 + 100 = 210 > 180 innerWidth -> w2 wraps to second line
    expect(w1Out.x).toBe(10);
    expect(w1Out.y).toBe(10);
    expect(w2Out.x).toBe(10);
    expect(w2Out.y).toBe(60); // 10 + 40 + 10
    expect(cOut.height).toBe(110); // 10 + 40 + 10 + 40 + 10
  });

  it('computes Grid layout across multiple rows with columnGap and rowGap', () => {
    const grid = makeContainerFrame('grid', 20, 40, 340, 260, {
      mode: 'grid',
      direction: 'row',
      gridColumns: 2,
      gap: 20,
      columnGap: 20,
      rowGap: 12,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const c1 = makeChildRect('c1', 'grid', 50, 60);
    const c2 = makeChildRect('c2', 'grid', 50, 80);
    const c3 = makeChildRect('c3', 'grid', 50, 50);

    const solved = computeAutoLayoutNodes([grid, c1, c2, c3]);
    const o1 = solved.find((n) => n.id === 'c1')!;
    const o2 = solved.find((n) => n.id === 'c2')!;
    const o3 = solved.find((n) => n.id === 'c3')!;

    // Inner width = 320; 2 cols with 20px colGap => cellWidth = 150
    expect(o1.x).toBe(30);
    expect(o1.y).toBe(50);
    expect(o1.width).toBe(150);
    expect(o1.height).toBe(80); // stretched to row max height (80)

    expect(o2.x).toBe(200); // 30 + 150 + 20
    expect(o2.y).toBe(50);
    expect(o2.width).toBe(150);

    expect(o3.x).toBe(30);
    expect(o3.y).toBe(142); // 50 + 80 + 12
    expect(o3.width).toBe(150);
  });

  it('shifts nested descendants cleanly and commits canonical geometry via applyAutoLayoutToNodes', () => {
    const outer = makeContainerFrame('outer', 50, 50, 400, 200, {
      ...createDefaultAutoLayout('flex'),
      direction: 'row',
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    });
    const inner = makeContainerFrame(
      'inner',
      0,
      0,
      160,
      100,
      {
        ...createDefaultAutoLayout('flex'),
        direction: 'column',
        gap: 8,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
      },
      { parentId: 'outer' },
    );
    const leaf = makeChildRect('leaf', 'inner', 80, 24);

    const committed = applyAutoLayoutToNodes([outer, inner, leaf], 'outer');
    const innerOut = committed.find((n) => n.id === 'inner')!;
    const leafOut = committed.find((n) => n.id === 'leaf')!;

    expect(innerOut.x).toBe(66);
    expect(innerOut.y).toBe(66);
    expect(leafOut.x).toBe(74); // inner.x(66) + pad.left(8)
    expect(leafOut.y).toBe(74);
  });
});

describe('Responsive Breakpoints & Web Semantics AST', () => {
  it('inherits Desktop -> Tablet -> Mobile responsive overrides deterministically', () => {
    const hero = makeContainerFrame(
      'hero',
      0,
      0,
      1200,
      300,
      {
        ...createDefaultAutoLayout('flex'),
        direction: 'row',
        gap: 24,
      },
      {
        semanticTag: 'section',
        ariaLabel: 'Hero Section',
        responsive: {
          tablet: { layoutDirection: 'column', gap: 16 },
          mobile: { gap: 8, visible: false },
        },
      },
    );

    expect(getBreakpointCanvasWidth(1440, 'desktop')).toBe(1440);
    expect(getBreakpointCanvasWidth(1440, 'tablet')).toBe(768);
    expect(getBreakpointCanvasWidth(1440, 'mobile')).toBe(390);

    const onTablet = resolveEffectiveNodeForBreakpoint(hero, 'tablet');
    expect(onTablet.layout?.direction).toBe('column');
    expect(onTablet.layout?.gap).toBe(16);
    expect(onTablet.visible).toBe(true);

    const onMobile = resolveEffectiveNodeForBreakpoint(hero, 'mobile');
    expect(onMobile.layout?.direction).toBe('column'); // inherited from tablet
    expect(onMobile.layout?.gap).toBe(8); // overridden on mobile
    expect(onMobile.visible).toBe(false);
  });

  it('validates semantic tags, layout configs, responsive overrides, and routes updates via Native Command Engine', () => {
    const project = createInitialProject();
    const page = getActivePage(project);
    const target = page.document.nodes[0];

    const store = createCanonicalEditorStore(createEditorState(project), { workspace: 'main' });
    const client = createMainCanvasCommandClient(store);

    const before: DesignNode = target;
    const after: DesignNode = {
      ...target,
      semanticTag: 'header',
      ariaLabel: 'Site Header',
      href: '/home',
      layout: createDefaultAutoLayout('grid'),
      layoutChild: { widthMode: 'fill', heightMode: 'hug', alignSelf: 'center' },
      responsive: { mobile: { gridColumns: 1, visible: true } },
    };
    expect(classifyNodeChange(before, after).kind).toBe('extended');

    const result = client.replaceNode({
      ...target,
      semanticTag: 'header',
      ariaLabel: 'Site Header',
      layout: createDefaultAutoLayout('grid'),
      responsive: { mobile: { gridColumns: 1 } },
    });
    expect(result.status).toBe('applied');

    const updatedProject = store.getSnapshot().editorState.project;
    expect(validateProject(updatedProject).ok).toBe(true);

    const updatedNode = getActivePage(updatedProject).document.nodes.find((n) => n.id === target.id)!;
    expect(updatedNode.semanticTag).toBe('header');
    expect(updatedNode.ariaLabel).toBe('Site Header');
    expect(updatedNode.layout?.mode).toBe('grid');
    expect(updatedNode.responsive?.mobile?.gridColumns).toBe(1);

    // Token-bound Auto-Layout gap resolves cleanly during layout solve
    const tokens = createDefaultDesignTokens();
    const gapContainer = makeContainerFrame(
      'gap-bound',
      0,
      0,
      300,
      100,
      { ...createDefaultAutoLayout('flex'), gap: 4, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      { tokenBindings: { gap: 'tok-space-lg' } }, // 24px
    );
    const k1 = makeChildRect('k1', 'gap-bound', 50, 40);
    const k2 = makeChildRect('k2', 'gap-bound', 50, 40);
    const solvedWithTokens = computeAutoLayoutNodes([gapContainer, k1, k2], { tokens });
    expect(solvedWithTokens.find((n) => n.id === 'k2')!.x).toBe(74); // 50 + 24
  });
});

import { describe, expect, it } from 'vitest';
import { createFrameNode, createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { FrameNode, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { getLayerFrameClipAncestorIds } from '../src/core/document/layers';
import { computeAutoLayoutNodes } from '../src/engines/layout/autoLayout';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';

function makeFrame(
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

function makeRect(
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

describe('Framer-Grade Frame Auto-Layout Engine', () => {
  it('resolves nested 2-pass Hug (Fit Content) containers accurately bottom-up then top-down', () => {
    const outer = makeFrame(
      'outer-hug',
      100,
      80,
      50,
      50,
      {
        mode: 'flex',
        direction: 'column',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'start',
        gap: 16,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      { layoutChild: { widthMode: 'hug', heightMode: 'hug' } },
    );

    const inner = makeFrame(
      'inner-hug',
      0,
      0,
      40,
      40,
      {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'center',
        gap: 10,
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
      },
      { parentId: 'outer-hug', layoutChild: { widthMode: 'hug', heightMode: 'hug' } },
    );

    const pillA = makeRect('pill-a', 'inner-hug', 60, 24);
    const pillB = makeRect('pill-b', 'inner-hug', 90, 32);
    const footer = makeRect('footer', 'outer-hug', 120, 40);

    const solved = computeAutoLayoutNodes([outer, inner, pillA, pillB, footer]);
    const outerOut = solved.find((n) => n.id === 'outer-hug')!;
    const innerOut = solved.find((n) => n.id === 'inner-hug')!;
    const pillAOut = solved.find((n) => n.id === 'pill-a')!;
    const pillBOut = solved.find((n) => n.id === 'pill-b')!;
    const footerOut = solved.find((n) => n.id === 'footer')!;

    // Inner Hug: width = 12 + 60 + 10 + 90 + 12 = 184; height = 8 + 32 + 8 = 48
    expect(innerOut.width).toBe(184);
    expect(innerOut.height).toBe(48);

    // Outer Hug: width = 20 + max(184, 120) + 20 = 224; height = 20 + 48 + 16 + 40 + 20 = 144
    expect(outerOut.width).toBe(224);
    expect(outerOut.height).toBe(144);

    // Child coordinates resolved after 2-pass reflow
    expect(innerOut.x).toBe(120);
    expect(innerOut.y).toBe(100);
    expect(pillAOut.x).toBe(132);
    expect(pillBOut.x).toBe(202);
    expect(footerOut.x).toBe(120);
    expect(footerOut.y).toBe(164); // 100 + 48 + 16
  });

  it('distributes children cleanly with space-evenly in Stack containers', () => {
    const row = makeFrame('even-row', 0, 0, 340, 100, {
      mode: 'flex',
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: 'space-evenly',
      alignItems: 'center',
      gap: 0,
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
    });
    // Inner width = 300; two 60px children => remaining 180 / 3 slots = 60px each
    const a = makeRect('a', 'even-row', 60, 40);
    const b = makeRect('b', 'even-row', 60, 40);

    const solved = computeAutoLayoutNodes([row, a, b]);
    const aOut = solved.find((n) => n.id === 'a')!;
    const bOut = solved.find((n) => n.id === 'b')!;

    expect(aOut.x).toBe(80); // padLeft(20) + 60
    expect(bOut.x).toBe(200); // 80 + 60 + 60
  });

  it('supports weighted Fill (fr) and Relative (%) sizing with Min/Max bounds', () => {
    const stack = makeFrame('sizing-row', 0, 0, 440, 200, {
      mode: 'flex',
      direction: 'row',
      wrap: 'nowrap',
      justifyContent: 'start',
      alignItems: 'start',
      gap: 20,
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    // Inner width = 400; inner height = 160
    // relItem: 25% of 400 = 100px width, 50% of 160 = 80px height
    const relItem = makeRect('rel', 'sizing-row', 50, 50, {
      layoutChild: {
        widthMode: 'relative',
        widthPercent: 25,
        heightMode: 'relative',
        heightPercent: 50,
      },
    });
    // Remaining for fill: 400 - 100 - 2*20 = 260? Wait: 3 children => 2 gaps = 40 => 260 split 1fr : 3fr => 65 & 195
    // Clamp fillHeavy maxWidth: 160
    const fill1 = makeRect('fill-1', 'sizing-row', 40, 40, {
      layoutChild: { widthMode: 'fill', flexGrow: 1, heightMode: 'fixed' },
    });
    const fill3 = makeRect('fill-3', 'sizing-row', 40, 40, {
      layoutChild: { widthMode: 'fill', flexGrow: 3, maxWidth: 160, heightMode: 'fixed' },
    });

    const solved = computeAutoLayoutNodes([stack, relItem, fill1, fill3]);
    const relOut = solved.find((n) => n.id === 'rel')!;
    const f1Out = solved.find((n) => n.id === 'fill-1')!;
    const f3Out = solved.find((n) => n.id === 'fill-3')!;

    expect(relOut.width).toBe(100);
    expect(relOut.height).toBe(80);
    expect(f1Out.width).toBe(65);
    expect(f3Out.width).toBe(160); // clamped by maxWidth: 160
  });

  it('pins position:absolute children via constraints without disturbing in-flow Stack siblings', () => {
    const card = makeFrame('card', 100, 100, 320, 200, {
      mode: 'flex',
      direction: 'column',
      wrap: 'nowrap',
      justifyContent: 'start',
      alignItems: 'start',
      gap: 12,
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    const title = makeRect('title', 'card', 180, 32);
    const body = makeRect('body', 'card', 240, 48);
    const badge = makeRect('badge', 'card', 40, 24, {
      layoutChild: {
        position: 'absolute',
        constraints: { horizontal: 'right', vertical: 'top' },
        zIndex: 12,
      },
    });
    const centerOrb = makeRect('orb', 'card', 30, 30, {
      layoutChild: {
        position: 'absolute',
        constraints: { horizontal: 'center', vertical: 'center' },
      },
    });

    const solved = computeAutoLayoutNodes([card, title, badge, body, centerOrb]);
    const titleOut = solved.find((n) => n.id === 'title')!;
    const bodyOut = solved.find((n) => n.id === 'body')!;
    const badgeOut = solved.find((n) => n.id === 'badge')!;
    const orbOut = solved.find((n) => n.id === 'orb')!;

    // In-flow siblings ignore badge & orb completely
    expect(titleOut.x).toBe(120);
    expect(titleOut.y).toBe(120);
    expect(bodyOut.x).toBe(120);
    expect(bodyOut.y).toBe(164); // 120 + 32 + 12

    // Badge pinned top-right inside padding box: 100 + 320 - 20 - 40 = 360, y = 120
    expect(badgeOut.x).toBe(360);
    expect(badgeOut.y).toBe(120);

    // Center orb pinned to center of container: x = 100 + (320 - 30)/2 = 245, y = 100 + (200 - 30)/2 = 185
    expect(orbOut.x).toBe(245);
    expect(orbOut.y).toBe(185);
  });

  it('packs Grid children with gridColumnSpan across columns cleanly', () => {
    const grid = makeFrame('bento', 0, 0, 340, 300, {
      mode: 'grid',
      direction: 'row',
      gridColumns: 3,
      gap: 10,
      columnGap: 10,
      rowGap: 12,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      alignItems: 'stretch',
    });
    // Inner width = 320; 3 cols with 2*10 = 20 gap => 100px per column
    const hero = makeRect('hero', 'bento', 50, 80, {
      layoutChild: { gridColumnSpan: 2, widthMode: 'fill', heightMode: 'fixed' },
    });
    const side = makeRect('side', 'bento', 50, 80);
    const nextRow = makeRect('next-row', 'bento', 50, 60);

    const solved = computeAutoLayoutNodes([grid, hero, side, nextRow]);
    const heroOut = solved.find((n) => n.id === 'hero')!;
    const sideOut = solved.find((n) => n.id === 'side')!;
    const nextOut = solved.find((n) => n.id === 'next-row')!;

    expect(heroOut.x).toBe(10);
    expect(heroOut.y).toBe(10);
    expect(heroOut.width).toBe(210); // 100 + 10 + 100

    expect(sideOut.x).toBe(230); // 10 + 210 + 10
    expect(sideOut.y).toBe(10);
    expect(sideOut.width).toBe(100);

    expect(nextOut.x).toBe(10);
    expect(nextOut.y).toBe(102); // 10 + 80 + 12
    expect(nextOut.width).toBe(100);
  });

  it('respects layout.overflow for canvas clipping and passes .flop validation + HTML/CSS codegen', () => {
    const project = createInitialProject();
    const page = getActivePage(project);

    const visibleFrame = makeFrame(
      'frame-visible',
      0,
      0,
      400,
      200,
      {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        gap: 16,
        padding: { top: 12, right: 24, bottom: 12, left: 24 },
        paddingMode: 'per-side',
        overflow: 'visible',
      },
      { clipContent: false },
    );

    const scrollGrid = makeFrame(
      'frame-scroll-grid',
      0,
      240,
      400,
      200,
      {
        mode: 'grid',
        direction: 'row',
        gridColumns: 3,
        gap: 12,
        columnGap: 12,
        rowGap: 16,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        paddingMode: 'uniform',
        overflow: 'scroll',
      },
      { clipContent: true },
    );

    const fillChild = makeRect('child-fill', 'frame-visible', 100, 40, {
      layoutChild: { widthMode: 'fill', flexGrow: 2, heightMode: 'relative', heightPercent: 50 },
    });
    const absChild = makeRect('child-abs', 'frame-visible', 32, 32, {
      layoutChild: {
        position: 'absolute',
        constraints: { horizontal: 'right', vertical: 'top' },
        zIndex: 15,
      },
    });
    const spanChild = makeRect('child-span', 'frame-scroll-grid', 100, 60, {
      layoutChild: { gridColumnSpan: 2, widthMode: 'fill', heightMode: 'fixed' },
    });

    page.document.nodes = [visibleFrame, fillChild, absChild, scrollGrid, spanChild];

    // Canvas clipping respects overflow: visible vs scroll
    expect(getLayerFrameClipAncestorIds(page.document.nodes, 'child-fill')).toEqual([]);
    expect(getLayerFrameClipAncestorIds(page.document.nodes, 'child-span')).toEqual([
      'frame-scroll-grid',
    ]);

    // Round-trip JSON + project schema validation passes cleanly
    const roundTripped = JSON.parse(JSON.stringify(project));
    const validation = validateProject(roundTripped);
    expect(validation.ok).toBe(true);

    // 1:1 HTML/CSS Codegen emits all Framer Auto-Layout CSS rules
    const compiled = compilePageHtmlCss(roundTripped, getActivePage(roundTripped));
    const css = compiled.cssFile.content;
    expect(css).toContain('justify-content: space-evenly;');
    expect(css).toContain('overflow: visible;');
    expect(css).toContain('overflow: auto;');
    expect(css).toContain('flex: 2 1 0%;');
    expect(css).toContain('height: 50%;');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('z-index: 15;');
    expect(css).toContain('grid-column: span 2;');
  });
});

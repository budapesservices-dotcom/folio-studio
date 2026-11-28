import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
} from '../src/core/document/components';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { FrameNode, PathNode } from '../src/core/document/types';
import {
  buildLivePreviewHtml,
  compilePageHtmlCss,
  getNodeBorderInset,
} from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';

describe('Canvas ↔ Live Preview & Codegen Layout Fidelity', () => {
  it('preserves exact Canvas X/Y/Width/Height for root Auto-Layout frames without forced flex-column stacking', () => {
    const project = createInitialProject('Root Auto-Layout Fidelity');
    const page = getActivePage(project);

    const leftCard: FrameNode = {
      ...createFrameNode(0),
      id: 'card-left',
      name: 'Left Card',
      x: 120,
      y: 180,
      width: 420,
      height: 300,
      layout: {
        mode: 'flex',
        direction: 'column',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'start',
        gap: 12,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
    };
    const rightCard: FrameNode = {
      ...createFrameNode(1),
      id: 'card-right',
      name: 'Right Card',
      x: 620,
      y: 180,
      width: 480,
      height: 300,
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'wrap',
        justifyContent: 'start',
        alignItems: 'center',
        gap: 16,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
    };

    page.document.nodes = [leftCard, rightCard];
    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;

    // Must NOT turn <main> into a forced vertical stack with gap: 24px
    expect(css).not.toMatch(/\.folio-page-index\s*\{[^}]*gap:\s*24px/);
    expect(css).toContain('box-sizing: border-box;');
    expect(css).toContain('overflow-x: clip;');

    // Both root Auto-Layout frames keep their exact Canvas coordinates & dimensions
    expect(css).toMatch(/\.f-left-card-[^{]+\{[^}]*position:\s*absolute;[^}]*left:\s*120px;[^}]*top:\s*180px;[^}]*width:\s*420px;[^}]*height:\s*300px;/);
    expect(css).toMatch(/\.f-right-card-[^{]+\{[^}]*position:\s*absolute;[^}]*left:\s*620px;[^}]*top:\s*180px;[^}]*width:\s*480px;[^}]*height:\s*300px;/);

    // Wrapping Flex containers pack wrapped rows from top like Canvas autoLayout.ts
    expect(css).toMatch(/\.f-right-card-[^{]+\{[^}]*flex-wrap:\s*wrap;[^}]*align-content:\s*flex-start;/);

    // Wide/overflowing root Auto-Layout containers clamp cleanly on Tablet/Mobile like Canvas
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('@media (max-width: 390px)');
  });

  it('matches Flex and Grid child sizing rules 1:1 with Canvas autoLayout.ts', () => {
    const project = createInitialProject('Flex Grid Parity');
    const page = getActivePage(project);

    const flexRow: FrameNode = {
      ...createFrameNode(0),
      id: 'row-box',
      name: 'Row Box',
      x: 40,
      y: 40,
      width: 600,
      height: 120,
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'center',
        gap: 16,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
      },
    };
    const fixedAvatar = {
      ...createRectNode(1),
      id: 'fixed-avatar',
      name: 'Fixed Avatar',
      parentId: 'row-box',
      width: 48,
      height: 48,
    };
    const fillBody = {
      ...createRectNode(2),
      id: 'fill-body',
      name: 'Fill Body',
      parentId: 'row-box',
      width: 200,
      height: 48,
      layoutChild: { widthMode: 'fill' as const, heightMode: 'fixed' as const, flexGrow: 1 },
    };
    const rowLabel = {
      ...createTextNode(3),
      id: 'row-label',
      name: 'Row Label',
      parentId: 'row-box',
      width: 140,
      height: 36,
      semanticTag: 'span' as const,
      text: 'Status Badge',
    };

    const gridBox: FrameNode = {
      ...createFrameNode(4),
      id: 'grid-box',
      name: 'Grid Box',
      x: 40,
      y: 200,
      width: 600,
      height: 320,
      layout: {
        mode: 'grid',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'space-between',
        alignItems: 'stretch',
        gridColumns: 3,
        gap: 16,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
      },
    };
    const defaultGridCard = {
      ...createRectNode(5),
      id: 'grid-card-1',
      name: 'Grid Card One',
      parentId: 'grid-box',
      width: 120,
      height: 100,
    };

    page.document.nodes = [flexRow, fixedAvatar, fillBody, rowLabel, gridBox, defaultGridCard];
    const css = compilePageHtmlCss(project, page).cssFile.content;

    // Fixed Flex item must not shrink and must keep exact height
    expect(css).toMatch(/\.f-fixed-avatar-[^{]+\{[^}]*width:\s*48px;[^}]*flex-shrink:\s*0;[^}]*height:\s*48px;/);
    // Fill Flex item gets min-width: 0 so long content never breaks flex share
    expect(css).toMatch(/\.f-fill-body-[^{]+\{[^}]*flex:\s*1 1 0%;[^}]*min-width:\s*0;/);
    // Text inside Auto-Layout preserves its vertical footprint and inline tags become block
    expect(css).toMatch(/\.f-row-label-[^{]+\{[^}]*min-height:\s*36px;[^}]*display:\s*block;/);
    // Grid container packs rows from top and never emits invalid `justify-items: space-between`
    expect(css).toMatch(/\.f-grid-box-[^{]+\{[^}]*align-content:\s*start;/);
    expect(css).not.toContain('justify-items: space-between;');
    expect(css).toMatch(/\.f-grid-box-[^{]+\{[^}]*justify-content:\s*space-between;/);
    // Grid child defaults to width: 100% (matching autoLayout.ts widthMode ?? 'fill')
    expect(css).toMatch(/\.f-grid-card-one-[^{]+\{[^}]*width:\s*100%;/);
  });

  it('compensates parent CSS border insets for absolute children and merges pinned constraint transforms cleanly', () => {
    const project = createInitialProject('Border & Constraints Fidelity');
    const page = getActivePage(project);

    const borderedFrame: FrameNode = {
      ...createFrameNode(0),
      id: 'bordered-parent',
      name: 'Bordered Parent',
      x: 100,
      y: 100,
      width: 400,
      height: 240,
      style: {
        fill: '#ffffff',
        stroke: '#111827',
        strokeWidth: 4,
        strokeAlign: 'inside',
        radius: 12,
      },
    };
    const innerChild = {
      ...createRectNode(1),
      id: 'inner-child',
      name: 'Inner Child',
      parentId: 'bordered-parent',
      x: 124,
      y: 130,
      width: 80,
      height: 40,
    };

    const pinnedContainer: FrameNode = {
      ...createFrameNode(2),
      id: 'pin-host',
      name: 'Pin Host',
      x: 100,
      y: 400,
      width: 400,
      height: 200,
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'center',
        gap: 12,
        padding: { top: 12, right: 16, bottom: 14, left: 18 },
      },
    };
    const centeredBadge = {
      ...createRectNode(3),
      id: 'centered-badge',
      name: 'Centered Badge',
      parentId: 'pin-host',
      x: 0,
      y: 0,
      width: 60,
      height: 24,
      rotation: 15,
      layoutChild: {
        position: 'absolute' as const,
        constraints: { horizontal: 'center' as const, vertical: 'bottom' as const },
      },
    };

    const vectorArrow: PathNode = {
      id: 'vec-icon',
      type: 'path',
      name: 'Vector Icon',
      x: 600,
      y: 100,
      width: 24,
      height: 24,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      points: [
        { id: 'p1', x: 0, y: 0, pointType: 'corner' },
        { id: 'p2', x: 24, y: 12, pointType: 'corner' },
        { id: 'p3', x: 0, y: 24, pointType: 'corner' },
      ],
      closed: true,
      style: { fill: '#7C6CF6', stroke: 'none', strokeWidth: 0 },
    };

    page.document.nodes = [borderedFrame, innerChild, pinnedContainer, centeredBadge, vectorArrow];
    expect(getNodeBorderInset(borderedFrame)).toEqual({ top: 4, left: 4 });

    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;

    // 124 - (100 + 4) = 20px, 130 - (100 + 4) = 26px
    expect(css).toMatch(/\.f-inner-child-[^{]+\{[^}]*left:\s*20px;[^}]*top:\s*26px;/);
    // Pinned child uses CSS right/bottom/center pins and merges translateX + rotate into ONE transform
    expect(css).toMatch(/\.f-centered-badge-[^{]+\{[^}]*left:\s*50%;[^}]*bottom:\s*14px;[^}]*transform:\s*translateX\(-50%\)\s+rotate\(15deg\);/);
    // Inline SVG uses display:block + fluid 100% sizing to avoid baseline descender shifts and scale smoothly during animations
    expect(compiled.htmlFile.content).toContain('preserveAspectRatio="none"');
    expect(compiled.htmlFile.content).toContain('style="display:block;width:100%;height:100%"');

    const reactFiles = compileReactProjectFiles(project);
    const reactPage = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))?.content ?? '';
    expect(reactPage).toContain('preserveAspectRatio="none"');
    expect(reactPage).toContain('style={{ display: "block", width: "100%", height: "100%" }}');
  });

  it('scales pure freeform artboards proportionally cross-browser via tan(atan2(...)) without script tags', () => {
    const project = createInitialProject('Freeform Poster');
    const page = getActivePage(project);
    // Default First canvas is 1440x900 pure freeform
    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;

    expect(css).toContain('width: 1440px;');
    expect(css).toContain('@media (max-width: 1439px)');
    expect(css).toContain('zoom: tan(atan2(100vw, 1440px));');
    expect(css).toContain('@supports not (zoom: 1)');
    expect(css).toContain('transform: scale(tan(atan2(100vw, 1440px)));');

    const previewHtml = buildLivePreviewHtml(project);
    expect(previewHtml).toContain('zoom: tan(atan2(100vw, 1440px));');
    expect(previewHtml).toContain('text-align: inherit;');
    expect(previewHtml).not.toContain('<script>');
  });

  it('solves internal Auto-Layout inside Component Instances before compiling HTML/CSS', () => {
    const project = createInitialProject('Component Instance Auto-Layout');
    const page = getActivePage(project);

    const cardRoot: FrameNode = {
      ...createFrameNode(0),
      id: 'comp-frame',
      name: 'Comp Frame',
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'center',
        gap: 12,
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
      },
    };
    const staleChild = {
      ...createRectNode(1),
      id: 'comp-dot',
      name: 'Comp Dot',
      parentId: 'comp-frame',
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      layoutChild: {
        position: 'absolute' as const,
        constraints: { horizontal: 'right' as const, vertical: 'top' as const },
      },
    };
    const master = buildComponentDefinitionFromNodes(
      [cardRoot, staleChild],
      ['comp-frame', 'comp-dot'],
      'BadgeCard',
      { id: 'comp-badge', now: '2026-01-01T00:00:00.000Z' },
    );
    if (!master) throw new Error('Expected master component');
    project.components = [master];

    const instance = createComponentInstance(master, 80, 120, 'inst-badge');
    page.document.nodes = [instance];

    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.cssFile.content).toMatch(/\.f-comp-dot-[^{]+\{[^}]*position:\s*absolute;[^}]*right:\s*12px;[^}]*top:\s*12px;/);
  });

  it('animates freeform vector paths via SVG @keyframes without turning wrapper divs into colored boxes', () => {
    const project = createInitialProject('Freeform Vector Motion');
    const page = getActivePage(project);

    const starPath: PathNode = {
      id: 'star-1',
      type: 'path',
      name: 'Star Shape',
      x: 200,
      y: 160,
      width: 120,
      height: 120,
      rotation: 15,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      points: [
        { id: 's1', x: 60, y: 0, pointType: 'corner' },
        { id: 's2', x: 120, y: 120, pointType: 'corner' },
        { id: 's3', x: 0, y: 120, pointType: 'corner' },
      ],
      closed: true,
      style: { fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 2 },
    };

    const ovalNode = {
      ...createRectNode(1),
      id: 'oval-1',
      type: 'ellipse' as const,
      name: 'Oval Halo',
      x: 420,
      y: 180,
      width: 240,
      height: 100,
      style: { fill: '#6366f1', stroke: 'none', strokeWidth: 0 },
    };

    page.document.nodes = [starPath, ovalNode];
    project.animations = [
      {
        id: 'clip-freeform',
        name: 'Freeform Orbit',
        pageId: page.id,
        durationMs: 1000,
        loop: true,
        autoplay: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tracks: [
          {
            id: 't-x',
            targetNodeId: 'star-1',
            property: 'x',
            keyframes: [
              { id: 'k1', timeMs: 0, value: 200, easing: 'ease-in' },
              { id: 'k2', timeMs: 500, value: 320, easing: 'ease-out' },
              { id: 'k3', timeMs: 1000, value: 200, easing: 'linear' },
            ],
          },
          {
            id: 't-fill',
            targetNodeId: 'star-1',
            property: 'fill',
            keyframes: [
              { id: 'k4', timeMs: 0, value: '#f59e0b', easing: 'linear' },
              { id: 'k5', timeMs: 1000, value: '#ec4899', easing: 'linear' },
            ],
          },
          {
            id: 't-sw',
            targetNodeId: 'oval-1',
            property: 'strokeWidth',
            keyframes: [
              { id: 'k6', timeMs: 0, value: 0, easing: 'linear' },
              { id: 'k7', timeMs: 1000, value: 6, easing: 'ease-out' },
            ],
          },
        ],
      },
    ];

    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;

    // Oval must use true ellipse border-radius: 50%, not pill 9999px
    expect(css).toMatch(/\.f-oval-halo-[^{]+\{[^}]*border-radius:\s*50%;/);
    expect(css).not.toMatch(/\.f-oval-halo-[^{]+\{[^}]*border-radius:\s*9999px;/);

    // Wrapper @keyframes for star-1 must preserve static rotate(15deg) and NEVER emit background-color/border on wrapper div
    const wrapperKfMatch = css.match(/@keyframes folio-kf-clip-freeform-star-1 \{[\s\S]*?\n\}/);
    expect(wrapperKfMatch).not.toBeNull();
    expect(wrapperKfMatch![0]).toContain('rotate(15deg)');
    expect(wrapperKfMatch![0]).not.toContain('background-color');
    expect(wrapperKfMatch![0]).not.toContain('border-width');
    // Mixed easings emit per-stop animation-timing-function
    expect(wrapperKfMatch![0]).toContain('animation-timing-function:');

    // Dedicated SVG path @keyframes animate fill directly on > svg path
    expect(css).toContain('@keyframes folio-kf-clip-freeform-star-1--svg');
    expect(css).toContain('[data-folio-id="star-1"] > svg path');
    expect(css).toMatch(/@keyframes folio-kf-clip-freeform-star-1--svg \{[\s\S]*fill:\s*#ec4899;/);

    // Oval animating strokeWidth from 0 -> 6 activates border-style: solid
    expect(css).toMatch(/@keyframes folio-kf-clip-freeform-oval-1 \{[\s\S]*border-style:\s*solid;/);
  });

  it('prevents double-translation and double-rotation for nested animated groups/frames and static rotated frames', async () => {
    const { applyAnimatedPosesToDocument, evaluateClipAtTime } = await import('../src/engines/animation/evaluator');

    const project = createInitialProject('Nested Group & Rotated Frame');
    const page = getActivePage(project);

    const groupNode = {
      id: 'grp-1',
      type: 'group' as const,
      name: 'Hero Group',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 30, // Groups in Canvas don't rotate children visually
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      style: { fill: 'transparent', stroke: 'none', strokeWidth: 0 },
    };
    const childKeyed = {
      ...createRectNode(0),
      id: 'child-keyed',
      name: 'Keyed Child',
      parentId: 'grp-1',
      x: 140,
      y: 150,
      width: 80,
      height: 60,
      rotation: 0,
    };
    const childUnkeyed = {
      ...createRectNode(1),
      id: 'child-unkeyed',
      name: 'Unkeyed Child',
      parentId: 'grp-1',
      x: 160,
      y: 180,
      width: 50,
      height: 50,
      rotation: 0,
    };

    const rotatedFrame: FrameNode = {
      ...createFrameNode(2),
      id: 'rot-frame',
      name: 'Rotated Frame',
      x: 500,
      y: 100,
      width: 200,
      height: 200,
      rotation: 90,
    };
    const rotChild = {
      ...createRectNode(3),
      id: 'rot-child',
      name: 'Rot Child',
      parentId: 'rot-frame',
      // Center of rot-frame is (600, 200). Put rotChild centered at (600, 200) with 40x40 -> x=580, y=180
      x: 580,
      y: 180,
      width: 40,
      height: 40,
      rotation: 90,
    };

    page.document.nodes = [groupNode, childKeyed, childUnkeyed, rotatedFrame, rotChild];
    const clip = {
      id: 'clip-nested',
      name: 'Group Slide',
      pageId: page.id,
      durationMs: 1000,
      loop: false,
      autoplay: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tracks: [
        {
          id: 'g-x',
          targetNodeId: 'grp-1',
          property: 'x' as const,
          keyframes: [
            { id: 'gx0', timeMs: 0, value: 100, easing: 'linear' as const },
            { id: 'gx1', timeMs: 1000, value: 200, easing: 'linear' as const },
          ],
        },
        {
          id: 'c-x',
          targetNodeId: 'child-keyed',
          property: 'x' as const,
          keyframes: [
            { id: 'cx0', timeMs: 0, value: 140, easing: 'linear' as const },
            { id: 'cx1', timeMs: 1000, value: 240, easing: 'linear' as const },
          ],
        },
      ],
    };
    project.animations = [clip];

    const css = compilePageHtmlCss(project, page).cssFile.content;

    // Group itself must NOT emit rotate(30deg) in CSS (Canvas groups don't rotate children)
    expect(css).not.toMatch(/\.f-hero-group-[^{]+\{[^}]*rotate\(30deg\)/);

    // Rotated frame child centered at parent's center stays at (79px, 79px) after 1px parent border inset, with localRotation = 90 - 90 = 0 (no double 90deg!)
    expect(css).toMatch(/\.f-rot-child-[^{]+\{[^}]*left:\s*79px;[^}]*top:\s*79px;/);
    expect(css).not.toMatch(/\.f-rot-child-[^{]+\{[^}]*rotate\(90deg\)/);

    // Keyed child moving +100px alongside group moving +100px has 0px relative CSS translate -> transform: none (no double-translation!)
    const childKfMatch = css.match(/@keyframes folio-kf-clip-nested-child-keyed \{[\s\S]*?\n\}/);
    expect(childKfMatch).not.toBeNull();
    expect(childKfMatch![0]).toContain('transform: none;');
    expect(childKfMatch![0]).not.toContain('translate(100px');

    // On Canvas, un-keyed child inherits group's +100px translation delta via applyAnimatedPosesToDocument
    const posesAtEnd = evaluateClipAtTime(clip, 1000);
    const evaluatedDoc = applyAnimatedPosesToDocument(page.document, posesAtEnd);
    const evalUnkeyed = evaluatedDoc.nodes.find((n) => n.id === 'child-unkeyed');
    expect(evalUnkeyed?.x).toBe(260); // 160 + 100
    const evalKeyed = evaluatedDoc.nodes.find((n) => n.id === 'child-keyed');
    expect(evalKeyed?.x).toBe(240); // Keeps its own explicit keyframe world coordinate, NOT 340!
  });

  it('composes multiple autoplay clips on the same node, propagates Frame rotation/opacity on Canvas, and blocks CSS/path injection', async () => {
    const { applyAnimatedPosesToDocument, evaluateClipAtTime } = await import('../src/engines/animation/evaluator');
    const { buildCompiledProjectBundle } = await import('../src/engines/codegen/projectBundle');

    const project = createInitialProject('Crucial Hardening & Composition');
    const page = getActivePage(project);

    const hostFrame: FrameNode = {
      ...createFrameNode(0),
      id: 'host-frame',
      name: 'Host Frame',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
    };
    const childBox = {
      ...createRectNode(1),
      id: 'child-box',
      name: 'Child Box',
      parentId: 'host-frame',
      // Center of hostFrame is (200, 200). Put childBox center at (250, 200) -> 50px right of center
      x: 230,
      y: 180,
      width: 40,
      height: 40,
      rotation: 0,
      opacity: 0.8,
    };
    const maskBase = {
      ...createRectNode(2),
      id: 'mask-base',
      name: 'Mask Base',
      x: 400,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
    };
    const rotatedMasked = {
      ...createRectNode(3),
      id: 'rot-masked',
      name: 'Rotated Masked',
      x: 410,
      y: 110,
      width: 100,
      height: 100,
      rotation: 45,
      clipMaskBaseId: 'mask-base',
    };

    const master = buildComponentDefinitionFromNodes(
      [{ ...createRectNode(4), id: 'm-rect', name: 'M Rect', x: 0, y: 0, width: 100, height: 60 }],
      ['m-rect'],
      'AnimCard',
      { id: 'comp-anim', now: '2026-01-01T00:00:00.000Z' },
    );
    if (!master) throw new Error('Expected master component');
    project.components = [master];
    const animInst = createComponentInstance(master, 600, 120, 'inst-anim');

    page.document.nodes = [hostFrame, childBox, maskBase, rotatedMasked, animInst];
    project.codeModules = [
      {
        id: 'mod-bad-quote',
        path: "styles/evil.css'; alert(1); //",
        language: 'css',
        mapping: 'custom',
        content: 'body { color: red; }',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'mod-bad-traversal',
        path: '../../etc/passwd',
        language: 'css',
        mapping: 'custom',
        content: 'body { color: blue; }',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'mod-good',
        path: 'styles/custom.css',
        language: 'css',
        mapping: 'custom',
        content: '.ok { color: green; }',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const clipA = {
      id: 'clip-a',
      name: 'Rotate & Fade Frame',
      pageId: page.id,
      durationMs: 1000,
      loop: false,
      autoplay: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tracks: [
        {
          id: 't-rot',
          targetNodeId: 'host-frame',
          property: 'rotation' as const,
          keyframes: [
            { id: 'kr0', timeMs: 0, value: 0, easing: 'linear' as const },
            { id: 'kr1', timeMs: 1000, value: 90, easing: 'linear' as const },
          ],
        },
        {
          id: 't-op',
          targetNodeId: 'host-frame',
          property: 'opacity' as const,
          keyframes: [
            { id: 'ko0', timeMs: 0, value: 1, easing: 'linear' as const },
            { id: 'ko1', timeMs: 1000, value: 0.5, easing: 'linear' as const },
          ],
        },
        {
          id: 't-inst',
          targetNodeId: 'inst-anim',
          property: 'y' as const,
          keyframes: [
            { id: 'ki0', timeMs: 0, value: 120, easing: 'linear' as const },
            { id: 'ki1', timeMs: 1000, value: 160, easing: 'linear' as const },
          ],
        },
      ],
    };
    const clipB = {
      id: 'clip-b',
      name: 'Second Autoplay Clip',
      pageId: page.id,
      durationMs: 2000,
      loop: true,
      autoplay: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tracks: [
        {
          id: 't-fill-xss',
          targetNodeId: 'host-frame',
          property: 'fill' as const,
          keyframes: [
            { id: 'kf0', timeMs: 0, value: '#ffffff', easing: 'linear' as const },
            { id: 'kf1', timeMs: 2000, value: 'red; } body { background: url(https://evil.test) } /*', easing: 'linear' as const },
          ],
        },
      ],
    };
    project.animations = [clipA, clipB];

    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;
    const html = compiled.htmlFile.content;

    // 1. Multiple autoplay clips on host-frame compose into ONE comma-separated animation rule
    expect(css).toMatch(/\[data-folio-id="host-frame"\] \{ animation: folio-kf-clip-a-host-frame [^;]+, folio-kf-clip-b-host-frame [^;]+;/);

    // 2. Malicious CSS injection in keyframe fill is neutralized
    expect(css).not.toContain('https://evil.test');
    expect(css).not.toContain('body { background:');

    // 3. Unsafe codeModule paths are rejected in HTML <link> and React imports
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('etc/passwd');
    expect(html).toContain('href="../styles/custom.css"');

    // 4. Rotated clipped node gets inverse-rotated SVG mask (<g transform="rotate(-45 50 50)">)
    expect(html).toContain('rotate(-45 50 50)');

    // 5. React compiler sanitizes module imports and emits data-folio-id wrapper for animated Component Instances
    const reactFiles = compileReactProjectFiles(project);
    const reactPage = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))?.content ?? '';
    expect(reactPage).not.toContain('alert(1)');
    expect(reactPage).not.toContain('etc/passwd');
    expect(reactPage).toContain("import '../../styles/custom.css';");
    expect(reactPage).toContain('data-folio-id="inst-anim"');

    // 6. Exported React ZIP index.html includes clean margin:0 body reset
    const cleanForZip = { ...project, codeModules: [project.codeModules![2]] };
    const reactBundle = buildCompiledProjectBundle(cleanForZip, { target: 'react' });
    const indexEntry = reactBundle.entries.find((e) => e.path === 'index.html');
    expect(typeof indexEntry?.content === 'string' && indexEntry.content).toContain('html, body { margin: 0; padding: 0;');

    // 7. Canvas Motion playback propagates Frame 90deg rotation orbit + 0.5x opacity to un-keyed childBox
    const endPoses = evaluateClipAtTime(clipA, 1000);
    const evalDoc = applyAnimatedPosesToDocument(page.document, endPoses);
    const evalChild = evalDoc.nodes.find((n) => n.id === 'child-box')!;
    // Rotating (250, 200) by +90deg around (200, 200) lands center at (200, 250) -> x=180, y=230
    expect(evalChild.x).toBe(180);
    expect(evalChild.y).toBe(230);
    expect(evalChild.rotation).toBe(90);
    expect(evalChild.opacity).toBe(0.4); // 0.8 * 0.5
  });
});

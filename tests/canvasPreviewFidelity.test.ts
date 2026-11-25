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
    // Inline SVG uses display:block to avoid baseline descender shifts
    expect(compiled.htmlFile.content).toContain('style="display:block"');

    const reactFiles = compileReactProjectFiles(project);
    const reactPage = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))?.content ?? '';
    expect(reactPage).toContain('style={{ display: "block" }}');
  });

  it('scales pure freeform artboards proportionally on narrower viewports so Tablet/Mobile preview never clips content', () => {
    const project = createInitialProject('Freeform Poster');
    const page = getActivePage(project);
    // Default First canvas is 1440x900 pure freeform
    const compiled = compilePageHtmlCss(project, page);
    const css = compiled.cssFile.content;

    expect(css).toContain('width: 1440px;');
    expect(css).toContain('@media (max-width: 1439px)');
    expect(css).toContain('zoom: calc(100vw / 1440px);');

    const previewHtml = buildLivePreviewHtml(project);
    expect(previewHtml).toContain('zoom: calc(100vw / 1440px);');
    expect(previewHtml).toContain('text-align: inherit;');
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
});

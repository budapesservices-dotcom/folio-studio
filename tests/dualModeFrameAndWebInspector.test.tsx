import { createRef } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateSimpleMathExpression,
  isSafeCssColorString,
  isSafeCssGridTemplate,
  isSafeHtmlClassName,
  isSafeHtmlId,
  normalizeCssAspectRatio,
  parseNumericUnitInput,
} from '../src/core/document/cssUnits';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { FrameNode, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient, stripUndefinedEntries } from '../src/app/mainCanvasCommandClient';
import { InspectorPanel, type InspectorPanelProps } from '../src/app/InspectorPanel';
import {
  computeAutoLayoutNodes,
  computeFrameModeConversion,
} from '../src/engines/layout/autoLayout';
import { compileFolioProject } from '../src/engines/codegen';
import {
  buildLivePreviewHtml,
  compilePageHtmlCss,
} from '../src/engines/codegen/htmlCssCompiler';

const RAW_SOURCE_FILES = import.meta.glob<string>(
  [
    '../src/app/workspace/NumericUnitInput.tsx',
    '../src/app/workspace/InspectorFrameLayoutSection.tsx',
    '../src/app/InspectorPanel.tsx',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const numericUnitInputSource = RAW_SOURCE_FILES['../src/app/workspace/NumericUnitInput.tsx'] ?? '';
const frameLayoutSectionSource = RAW_SOURCE_FILES['../src/app/workspace/InspectorFrameLayoutSection.tsx'] ?? '';
const inspectorPanelSource = RAW_SOURCE_FILES['../src/app/InspectorPanel.tsx'] ?? '';

describe('Part A — NumericUnitInput Parser, Safe Inline Math & CSS Safety', () => {
  it('evaluates safe inline math expressions without eval and rejects unsafe input', () => {
    expect(evaluateSimpleMathExpression('100/3')).toBeCloseTo(33.3333, 3);
    expect(evaluateSimpleMathExpression('(1280 - 64) / 2')).toBe(608);
    expect(evaluateSimpleMathExpression('16 * 2 + 8')).toBe(40);
    expect(evaluateSimpleMathExpression('-24 + 6')).toBe(-18);
    expect(evaluateSimpleMathExpression('100 / 0')).toBeNull();
    expect(evaluateSimpleMathExpression('alert(1)')).toBeNull();
    expect(evaluateSimpleMathExpression('calc(100% - 10px)')).toBeNull();
  });

  it('splits smart-pasted numeric+unit strings, evaluates math, handles keywords, and rejects invalid CSS', () => {
    const allowed = ['px', '%', 'vw', 'vh', 'dvh', 'rem', 'em', 'fit', 'fill'] as const;

    expect(parseNumericUnitInput('100vh', { fallbackUnit: 'px', allowedUnits: allowed })).toEqual({
      ok: true,
      kind: 'numeric',
      value: 100,
      unit: 'vh',
    });

    expect(parseNumericUnitInput('50%', { fallbackUnit: 'px', allowedUnits: allowed })).toEqual({
      ok: true,
      kind: 'numeric',
      value: 50,
      unit: '%',
    });

    expect(
      parseNumericUnitInput('100/3', { fallbackUnit: '%', allowedUnits: allowed, precision: 2 }),
    ).toEqual({
      ok: true,
      kind: 'numeric',
      value: 33.33,
      unit: '%',
    });

    expect(parseNumericUnitInput('1.5rem', { fallbackUnit: 'px', allowedUnits: allowed })).toEqual({
      ok: true,
      kind: 'numeric',
      value: 1.5,
      unit: 'rem',
    });

    expect(parseNumericUnitInput('fit', { fallbackUnit: 'px', allowedUnits: allowed })).toEqual({
      ok: true,
      kind: 'keyword',
      keyword: 'fit',
    });

    expect(parseNumericUnitInput('fill', { fallbackUnit: 'px', allowedUnits: allowed })).toEqual({
      ok: true,
      kind: 'keyword',
      keyword: 'fill',
    });

    // Rejects disallowed unit or injection
    expect(parseNumericUnitInput('100cm', { fallbackUnit: 'px', allowedUnits: allowed }).ok).toBe(false);
    expect(
      parseNumericUnitInput('expression(alert(1))', { fallbackUnit: 'px', allowedUnits: allowed }).ok,
    ).toBe(false);
    expect(
      parseNumericUnitInput('-50', { fallbackUnit: 'px', allowedUnits: allowed, allowNegative: false }).ok,
    ).toBe(false);
  });

  it('validates CSS Grid templates, aspect ratios, HTML IDs/classes, and color strings safely', () => {
    expect(isSafeCssGridTemplate('240px 1fr 300px')).toBe(true);
    expect(isSafeCssGridTemplate('repeat(auto-fit, minmax(220px, 1fr))')).toBe(true);
    expect(isSafeCssGridTemplate('1fr; background: url(evil)')).toBe(false);
    expect(isSafeCssGridTemplate('expression(1)')).toBe(false);

    expect(normalizeCssAspectRatio('16:9')).toBe('16 / 9');
    expect(normalizeCssAspectRatio('1 / 1')).toBe('1 / 1');
    expect(normalizeCssAspectRatio('0 / 9')).toBeNull();

    expect(isSafeHtmlId('hero-section_1')).toBe(true);
    expect(isSafeHtmlId('123-invalid')).toBe(false);
    expect(isSafeHtmlClassName('card-grid is-active')).toBe(true);
    expect(isSafeHtmlClassName('bad" onclick="x')).toBe(false);

    expect(isSafeCssColorString('#00E5FF')).toBe(true);
    expect(isSafeCssColorString('rgba(0, 229, 255, 0.45)')).toBe(true);
    expect(isSafeCssColorString('url(javascript:alert(1))')).toBe(false);
  });

  it('enforces NumericUnitInput single-commit contract (zero type=number, commits on blur/Enter, not per keystroke)', () => {
    expect(numericUnitInputSource).not.toMatch(/type=["']number["']/);
    expect(frameLayoutSectionSource).not.toMatch(/type=["']number["']/);
    expect(inspectorPanelSource).not.toMatch(/type=["']number["']/);
    expect(numericUnitInputSource).toContain('onBlur=');
    expect(numericUnitInputSource).toContain('commitDraft(event.currentTarget.value)');
    expect(numericUnitInputSource).toContain("event.key === 'Enter'");
  });
});

describe('Part B — Dual-Mode Frame Engine (Freeform <-> Stack <-> Full CSS Grid) & Atomic Undo/Redo', () => {
  it('smoothly converts Freeform -> Stack detecting axis, visual child order, gap, and supports 1-step Undo/Redo', () => {
    const project = createInitialProject();
    const page = getActivePage(project);

    const container: FrameNode = {
      ...createFrameNode(0),
      id: 'frame-dual',
      name: 'Hero Row',
      x: 40,
      y: 60,
      width: 600,
      height: 180,
      layout: {
        mode: 'none',
        direction: 'column',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'stretch',
        gap: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
      },
    };

    // Intentionally out of visual X order: child-b is right, child-a is left, child-c is middle
    const childB: RectNode = {
      ...createRectNode(0),
      id: 'child-b',
      name: 'Third Card',
      parentId: 'frame-dual',
      x: 340,
      y: 80,
      width: 100,
      height: 80,
    };
    const childA: RectNode = {
      ...createRectNode(1),
      id: 'child-a',
      name: 'First Card',
      parentId: 'frame-dual',
      x: 60,
      y: 82,
      width: 100,
      height: 80,
    };
    const childC: RectNode = {
      ...createRectNode(2),
      id: 'child-c',
      name: 'Second Card',
      parentId: 'frame-dual',
      x: 200,
      y: 78,
      width: 100,
      height: 80,
    };

    page.document.nodes = [container, childB, childA, childC];
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const beforeNodes = store.getSnapshot().editorState.project.pages[0].document.nodes;
    const conversion = computeFrameModeConversion(beforeNodes, 'frame-dual', 'flex');
    expect(conversion).not.toBeNull();
    const convertedCandidate = conversion!.nextNodes.find((n) => n.id === 'frame-dual') as FrameNode;
    expect(convertedCandidate.layout?.mode).toBe('flex');
    expect(conversion!.detectedDirection).toBe('row');
    expect(conversion!.estimatedGap).toBe(40);
    expect(conversion!.childOrderIds).toEqual(['child-a', 'child-c', 'child-b']);

    // Commit in 1 atomic Native Command transaction (matching useDesignSystemActions.convertFrameLayoutMode)
    const astView = client.getActiveAstView();
    const reorderEnvelopes = conversion!.childOrderIds.slice(1).map((currId, idx) =>
      client.createEnvelope(
        'layer.move',
        { kind: 'document', address: astView.address },
        {
          node: { document: astView.address, nodeId: currId },
          target: { document: astView.address, nodeId: conversion!.childOrderIds[idx] },
          position: 'before' as const,
        },
        'Convert frame to Stack',
      ),
    );
    const updateEnvelope = client.createEnvelope(
      'node.update-many',
      { kind: 'document', address: astView.address },
      {
        nodes: conversion!.nextNodes
          .filter((n) => n.id === 'frame-dual' || n.parentId === 'frame-dual')
          .map((n) => stripUndefinedEntries(n)),
      },
      'Convert frame to Stack',
    );
    const txRes = client.executeTransaction([...reorderEnvelopes, updateEnvelope]);
    expect(txRes.status).toBe('applied');

    const afterConvert = store.getSnapshot().editorState.project.pages[0].document.nodes;
    const convertedFrame = afterConvert.find((n) => n.id === 'frame-dual') as FrameNode;
    expect(convertedFrame.layout?.mode).toBe('flex');
    expect(convertedFrame.layout?.direction).toBe('row');
    const convertedChildIds = afterConvert
      .filter((n) => n.parentId === 'frame-dual')
      .map((n) => n.id);
    expect(convertedChildIds).toEqual(['child-a', 'child-c', 'child-b']);

    // 1 single Undo restores original Freeform mode, order, and coordinates cleanly
    expect(client.undo().status).toBe('applied');
    const afterUndo = store.getSnapshot().editorState.project.pages[0].document.nodes;
    const restoredFrame = afterUndo.find((n) => n.id === 'frame-dual') as FrameNode;
    expect(restoredFrame.layout?.mode).toBe('none');
    expect(afterUndo.filter((n) => n.parentId === 'frame-dual').map((n) => n.id)).toEqual([
      'child-b',
      'child-a',
      'child-c',
    ]);
    expect(afterUndo.find((n) => n.id === 'child-b')?.x).toBe(340);

    // 1 single Redo re-applies the Stack conversion
    expect(client.redo().status).toBe('applied');
    expect(
      (
        store
          .getSnapshot()
          .editorState.project.pages[0].document.nodes.find((n) => n.id === 'frame-dual') as FrameNode
      ).layout?.mode,
    ).toBe('flex');
  });

  it('solves Bento CSS Grid with auto-fit, col-span full (1/-1), and row-span 2 without overlapping cells', () => {
    const gridFrame: FrameNode = {
      ...createFrameNode(0),
      id: 'bento-grid',
      name: 'Bento Grid',
      x: 0,
      y: 0,
      width: 720,
      height: 520,
      layout: {
        mode: 'grid',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'stretch',
        gap: 16,
        columnGap: 16,
        rowGap: 16,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        gridColumns: 3,
        gridColumnsMode: 'auto-fit',
        gridMinColumnWidth: { value: 200, unit: 'px' },
        gridRowsMode: 'fixed',
        gridRows: 3,
      },
    };

    const banner: RectNode = {
      ...createRectNode(0),
      id: 'bento-banner',
      parentId: 'bento-grid',
      width: 100,
      height: 90,
      layoutChild: { widthMode: 'fill', heightMode: 'fixed', gridColumnSpanFull: true },
    };
    const tallHero: RectNode = {
      ...createRectNode(1),
      id: 'bento-tall',
      parentId: 'bento-grid',
      width: 100,
      height: 120,
      layoutChild: { widthMode: 'fill', heightMode: 'fixed', gridColumnSpan: 1, gridRowSpan: 2 },
    };
    const card1: RectNode = {
      ...createRectNode(2),
      id: 'bento-c1',
      parentId: 'bento-grid',
      width: 100,
      height: 80,
      layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
    };
    const card2: RectNode = {
      ...createRectNode(3),
      id: 'bento-c2',
      parentId: 'bento-grid',
      width: 100,
      height: 80,
      layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
    };

    const solved = computeAutoLayoutNodes([gridFrame, banner, tallHero, card1, card2], {
      onlyContainerId: 'bento-grid',
    });
    const byId = new Map(solved.map((n) => [n.id, n]));

    // Banner spans full inner width (720 - 40 = 680)
    expect(byId.get('bento-banner')!.width).toBeCloseTo(680, 1);
    // Tall hero starts on row 1, col 0, and spans 2 rows
    const tallBox = byId.get('bento-tall')!;
    const c1Box = byId.get('bento-c1')!;
    const c2Box = byId.get('bento-c2')!;
    expect(tallBox.y).toBeGreaterThan(byId.get('bento-banner')!.y + byId.get('bento-banner')!.height - 1);
    expect(c1Box.x).toBeGreaterThan(tallBox.x + tallBox.width - 1);
    expect(c2Box.x).toBeGreaterThan(c1Box.x + c1Box.width - 1);
    // Tall hero height spans across rows without colliding horizontally with c1
    expect(tallBox.height).toBeGreaterThan(c1Box.height);
  });
});

describe('Part C & D — Codegen Parity (HTML/CSS, Live Preview, React TSX) & .flop v2 Compatibility', () => {
  it('compiles Dual-Mode Grid auto-fit, Sticky insets, Scroll Snap, Pseudo-States, Per-Side Borders & Semantic Attrs identically across HTML/CSS, Live Preview, and React TSX', () => {
    const project = createInitialProject();
    const page = getActivePage(project);

    const gridContainer: FrameNode = {
      ...createFrameNode(0),
      id: 'sec-grid',
      name: 'Pricing Grid',
      semanticTag: 'section',
      htmlId: 'pricing-grid',
      className: 'folio-pricing-grid',
      x: 40,
      y: 40,
      width: 960,
      height: 480,
      layout: {
        mode: 'grid',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'start',
        alignItems: 'stretch',
        gap: 24,
        columnGap: 24,
        rowGap: 20,
        gapUnit: 'px',
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        paddingUnit: 'px',
        gridColumns: 3,
        gridColumnsMode: 'auto-fit',
        gridMinColumnWidth: { value: 240, unit: 'px' },
        gridRowsMode: 'custom',
        gridTemplateRows: 'auto 1fr',
        overflow: 'scroll-x',
        scrollSnapType: 'x',
      },
      layoutChild: {
        widthMode: 'fixed',
        heightMode: 'fixed',
        maxWidth: 1280,
        maxWidthValue: { value: 1280, unit: 'px' },
      },
    };

    const ctaCard: RectNode = {
      ...createRectNode(0),
      id: 'cta-card',
      name: 'CTA Card',
      parentId: 'sec-grid',
      semanticTag: 'a',
      href: 'https://example.com/pricing',
      linkTarget: '_blank',
      htmlId: 'cta-pro',
      className: 'btn-pro',
      cursor: 'pointer',
      pointerEvents: 'auto',
      userSelect: 'none',
      x: 64,
      y: 64,
      width: 300,
      height: 160,
      style: {
        fill: '#12161A',
        stroke: '#4A5568',
        strokeWidth: 1,
        radius: 12,
        borderSides: {
          top: { width: 2, color: '#00E5FF', style: 'solid' },
          bottom: { width: 1, color: '#4A5568', style: 'dashed' },
        },
        cornerRadii: { topLeft: 16, topRight: 16, bottomRight: 4, bottomLeft: 4 },
      },
      cssFilters: { brightness: 105, contrast: 110 },
      transition: { preset: 'smooth', durationMs: 240 },
      stateOverrides: {
        hover: {
          fill: '#1E293B',
          stroke: '#00E5FF',
          opacity: 0.95,
          scale: 1.03,
          translateY: -4,
        },
        focus: {
          stroke: '#00E5FF',
        },
      },
      layoutChild: {
        widthMode: 'fill',
        heightMode: 'fixed',
        position: 'sticky',
        inset: { top: { value: 16, unit: 'px' } },
        gridColumnSpanFull: true,
        gridRowSpan: 2,
        aspectRatio: '16/9',
        scrollSnapAlign: 'center',
        zIndex: 20,
      },
    };

    const heading = createTextNode(0);
    heading.id = 'cta-heading';
    heading.parentId = 'sec-grid';
    heading.semanticTag = 'h4';
    heading.style.fontSize = 1.5;
    heading.style.fontSizeUnit = 'rem';
    heading.style.letterSpacing = 0.05;
    heading.style.letterSpacingUnit = 'em';

    page.document.nodes = [gridContainer, ctaCard, heading];

    // 1. Validate .flop v2 round-trip serialization
    const roundTripped = JSON.parse(JSON.stringify(project));
    const validation = validateProject(roundTripped);
    expect(validation.ok).toBe(true);

    // 2. HTML/CSS Compiler assertions
    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.pageCssContent).toContain('repeat(auto-fit, minmax(240px, 1fr))');
    expect(compiled.pageCssContent).toContain('grid-template-rows: auto 1fr;');
    expect(compiled.pageCssContent).toContain('overflow-x: auto;');
    expect(compiled.pageCssContent).toContain('scroll-snap-type: x mandatory;');
    expect(compiled.pageCssContent).toContain('grid-column: 1 / -1;');
    expect(compiled.pageCssContent).toContain('grid-row: span 2;');
    expect(compiled.pageCssContent).toContain('position: sticky;');
    expect(compiled.pageCssContent).toContain('top: 16px;');
    expect(compiled.pageCssContent).toContain('aspect-ratio: 16 / 9;');
    expect(compiled.pageCssContent).toContain('scroll-snap-align: center;');
    expect(compiled.pageCssContent).toContain('border-top: 2px solid #00E5FF;');
    expect(compiled.pageCssContent).toContain('border-bottom: 1px dashed #4A5568;');
    expect(compiled.pageCssContent).toContain('border-radius: 16px 16px 4px 4px;');
    expect(compiled.pageCssContent).toContain('cursor: pointer;');
    expect(compiled.pageCssContent).toContain('user-select: none;');
    expect(compiled.pageCssContent).toContain('transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);');
    expect(compiled.pageCssContent).toContain(':hover');
    expect(compiled.pageCssContent).toContain('translateY(-4px) scale(1.03)');
    expect(compiled.pageCssContent).toContain(':focus');
    expect(compiled.pageCssContent).toContain('brightness(105%)');
    expect(compiled.pageCssContent).toContain('font-size: 1.5rem;');
    expect(compiled.pageCssContent).toContain('letter-spacing: 0.05em;');

    expect(compiled.htmlFile.content).toContain('id="pricing-grid"');
    expect(compiled.htmlFile.content).toContain('folio-pricing-grid');
    expect(compiled.htmlFile.content).toContain('id="cta-pro"');
    expect(compiled.htmlFile.content).toContain('target="_blank"');
    expect(compiled.htmlFile.content).toContain('rel="noopener noreferrer"');
    expect(compiled.htmlFile.content).toContain('<h4 ');

    // 3. Live Preview parity
    const previewHtml = buildLivePreviewHtml(project, { pageId: page.id });
    expect(previewHtml).toContain('repeat(auto-fit, minmax(240px, 1fr))');
    expect(previewHtml).toContain(':hover');
    expect(previewHtml).toContain('scroll-snap-type: x mandatory;');

    // 4. React TSX + Stylesheet parity
    const reactOutput = compileFolioProject(project, { target: 'react', pageId: page.id });
    const pageTsx = reactOutput.files.find(
      (f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'),
    );
    const pageCss = reactOutput.files.find(
      (f) => f.path.startsWith('src/styles/') && f.path.endsWith('.css') && f.path !== 'src/styles/tokens.css',
    );
    expect(pageTsx?.content).toContain('id="pricing-grid"');
    expect(pageTsx?.content).toContain('target="_blank"');
    expect(pageTsx?.content).toContain('rel="noopener noreferrer"');
    expect(pageCss?.content).toContain('repeat(auto-fit, minmax(240px, 1fr))');
    expect(pageCss?.content).toContain(':hover');
    expect(pageCss?.content).toContain('scroll-snap-align: center;');
  });

  it('maintains 100% .flop v2 backward compatibility for legacy projects without new optional fields', () => {
    const legacy = createInitialProject();
    // Strip any optional v2 extension fields to simulate an older .flop v2 file
    for (const page of legacy.pages) {
      for (const node of page.document.nodes) {
        delete node.cssFilters;
        delete node.transition;
        delete node.stateOverrides;
        delete node.htmlId;
        delete node.className;
        delete node.linkTarget;
        delete node.cursor;
        delete node.pointerEvents;
        delete node.userSelect;
      }
    }
    const validation = validateProject(JSON.parse(JSON.stringify(legacy)));
    expect(validation.ok).toBe(true);
  });

  it('renders InspectorPanel root hook-free with optional Dual-Mode props', () => {
    const props: InspectorPanelProps = {
      visible: true,
      width: 300,
      isResizing: false,
      resizeHandleRef: createRef<HTMLDivElement>(),
      activeEditorId: 'main',
      selectedNode: null,
      selectedNodes: [],
      selectedCount: 0,
      canRemoveFromCanvas: false,
      selectedInstanceComponent: null,
      editingMasterComponent: null,
      instanceOverrideTargets: null,
      activeBreakpoint: 'desktop',
      designTokens: createDefaultDesignTokens(),
      assets: [],
      defaultFillColor: '#00E5FF',
      renderIcon: () => <span />,
      onStartResize: vi.fn(),
      onResizeDoubleClick: vi.fn(),
      onResizeKeyDown: vi.fn(),
      onCommitEdit: vi.fn(),
      onHoverHint: vi.fn(),
      onRemoveFromCanvas: vi.fn(),
      onUpdateSelected: vi.fn(),
      onUpdateSelectedStyle: vi.fn(),
      onApplyAutoLayout: vi.fn(),
      onConvertFrameLayoutMode: vi.fn(),
      onSwitchBreakpoint: vi.fn(),
      onUpdateInstanceOverride: vi.fn(),
      onUpdateInstanceVariant: vi.fn(),
      onUpdateInstanceSlot: vi.fn(),
      onUpdateMasterContract: vi.fn(),
      onResetInstanceOverrides: vi.fn(),
      onDetachInstance: vi.fn(),
      onConvertToPath: vi.fn(),
      onTogglePathClosed: vi.fn(),
      onSimplifyPath: vi.fn(),
      onChooseTool: vi.fn(),
      onQuickAdd: vi.fn(),
      onDuplicateSelection: vi.fn(),
      onCopySelection: vi.fn(),
    };
    const tree = InspectorPanel(props);
    expect(tree).toBeTruthy();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDocument, createInitialProject } from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import { buildCustomFontFaceCss } from '../src/core/document/fonts';
import type {
  AssetReference,
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FrameNode,
  ImageNode,
  PathNode,
  RectNode,
} from '../src/core/document/types';
import {
  clearAssetMemoryCache,
  computeBytesSha256,
  materializeProjectAssetsForExport,
  putDeduplicatedAssetBlob,
  resolveAssetDisplayUrl,
  resolvePortableAssetUrl,
} from '../src/core/persistence/assetStore';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { deepCloneNode } from '../src/app/nodeClipboard';
import { compilePageAnimationsCss, getClipCssClassName } from '../src/engines/animation/codegen';
import { buildLivePreviewHtml, compileTokensCssFile, LIVE_PREVIEW_CSP } from '../src/engines/codegen/htmlCssCompiler';
import { buildCompiledProjectBundle } from '../src/engines/codegen/projectBundle';
import { parseZipArchive } from '../src/engines/codegen/zipArchive';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
} from '../src/engines/prototype';
import { createPreviewDomHarness, createReactTsxHarness } from './helpers/parityRuntimeHarness';

function makeRect(id: string, extra: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: 'rect',
    name: id,
    x: 16,
    y: 24,
    width: 140,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fill: '#2563eb',
      stroke: '#1d4ed8',
      strokeWidth: 2,
      radius: 8,
    },
    ...extra,
  };
}

function makeLargeWoff2Bytes(sizeBytes = 24 * 1024): Uint8Array {
  // Valid WOFF2 header signature ('wOF2') + deterministic bytes > 16 KB threshold
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00], 0);
  for (let i = 8; i < sizeBytes; i += 1) {
    bytes[i] = (i * 19 + 7) & 0xff;
  }
  return bytes;
}

afterEach(() => {
  clearAssetMemoryCache();
});

describe('P1-5: Multi-page Undo/Redo History Preservation', () => {
  it('preserves undo/redo history across add-page, set-active-page, and edits on multiple pages', () => {
    const project = createInitialProject('Multi-Page History');
    const homePageId = project.pages[0].id;
    let state = createEditorState(project);

    // Edit on Home page
    state = editorReducer(state, { type: 'add-node', node: makeRect('home-box', { x: 40 }) });
    expect(state.past).toHaveLength(1);

    // Add a second page — history MUST be preserved
    const aboutPage = {
      id: 'page-about',
      name: 'About',
      route: '/about',
      document: createEmptyDocument('About', 1440, 900),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state = editorReducer(state, { type: 'add-page', page: aboutPage });
    expect(state.project.activePageId).toBe('page-about');
    expect(state.past).toHaveLength(2);

    // Edit on About page
    state = editorReducer(state, { type: 'add-node', node: makeRect('about-hero', { x: 80 }) });
    expect(state.past).toHaveLength(3);

    // Switch back to Home page — history MUST be preserved
    state = editorReducer(state, { type: 'set-active-page', pageId: homePageId });
    expect(state.project.activePageId).toBe(homePageId);
    expect(state.past).toHaveLength(4);

    // Undo #1: reverts switch back to Home → activePageId returns to About
    state = editorReducer(state, { type: 'undo' });
    expect(state.project.activePageId).toBe('page-about');
    expect(state.project.pages.find((p) => p.id === 'page-about')?.document.nodes.some((n) => n.id === 'about-hero')).toBe(true);

    // Undo #2: removes about-hero on About
    state = editorReducer(state, { type: 'undo' });
    expect(state.project.pages.find((p) => p.id === 'page-about')?.document.nodes.some((n) => n.id === 'about-hero')).toBe(false);

    // Undo #3: removes About page and returns to Home
    state = editorReducer(state, { type: 'undo' });
    expect(state.project.pages.map((p) => p.id)).toEqual([homePageId]);
    expect(state.project.activePageId).toBe(homePageId);
    expect(state.project.pages[0].document.nodes.some((n) => n.id === 'home-box')).toBe(true);

    // Undo #4: removes home-box on Home
    state = editorReducer(state, { type: 'undo' });
    expect(state.project.pages[0].document.nodes.some((n) => n.id === 'home-box')).toBe(false);

    // Redo all 4 steps restores full multi-page state
    for (let i = 0; i < 4; i += 1) {
      state = editorReducer(state, { type: 'redo' });
    }
    expect(state.project.activePageId).toBe(homePageId);
    expect(state.project.pages.map((p) => p.id)).toEqual([homePageId, 'page-about']);
    expect(state.project.pages[0].document.nodes.some((n) => n.id === 'home-box')).toBe(true);
    expect(state.project.pages[1].document.nodes.some((n) => n.id === 'about-hero')).toBe(true);
  });
});

describe('P1-6: deepCloneNode prevents shared-object aliasing across all nested node properties', () => {
  function collectObjectRefs(value: unknown, refs = new Set<object>()): Set<object> {
    if (value && typeof value === 'object') {
      if (!refs.has(value)) {
        refs.add(value);
        if (Array.isArray(value)) {
          for (const item of value) collectObjectRefs(item, refs);
        } else {
          for (const v of Object.values(value as Record<string, unknown>)) {
            collectObjectRefs(v, refs);
          }
        }
      }
    }
    return refs;
  }

  it('produces completely disjoint object graphs for Frame, Image, Path, and ComponentInstance nodes', () => {
    const richFrame: FrameNode = {
      id: 'frame-rich',
      type: 'frame',
      name: 'Rich Frame',
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      style: {
        fill: '#ffffff',
        fills: [
          {
            id: 'fill-1',
            type: 'linear-gradient',
            visible: true,
            opacity: 1,
            angle: 45,
            stops: [
              { offset: 0, color: '#ffffff' },
              { offset: 1, color: '#e2e8f0' },
            ],
          },
        ],
        stroke: '#cbd5e1',
        strokeWidth: 1,
        borderSides: {
          top: { width: 1, color: '#cbd5e1', style: 'solid' },
          right: { width: 2, color: '#94a3b8', style: 'dashed' },
          bottom: { width: 3, color: '#64748b', style: 'dotted' },
          left: { width: 4, color: '#475569', style: 'solid' },
        },
        radius: 12,
        cornerRadii: { topLeft: 12, topRight: 8, bottomRight: 4, bottomLeft: 2 },
      },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: { top: 16, right: 20, bottom: 16, left: 20 },
        alignItems: 'center',
        justifyContent: 'space-between',
        wrap: 'wrap',
      },
      layoutChild: {
        position: 'relative',
        widthMode: 'fill',
        heightMode: 'fixed',
        widthValue: { value: 100, unit: '%' },
        inset: {
          top: { value: 4, unit: 'px' },
          right: { value: 8, unit: 'px' },
          bottom: { value: 4, unit: 'px' },
          left: { value: 8, unit: 'px' },
        },
        constraints: { horizontal: 'left-right', vertical: 'top' },
      },
      responsive: {
        tablet: {
          width: 320,
          padding: { top: 12, right: 12, bottom: 12, left: 12 },
        },
        mobile: {
          width: 240,
          visible: true,
        },
      },
      stateOverrides: {
        hover: { fill: '#f8fafc', scale: 1.02 },
        active: { opacity: 0.9 },
      },
      tokenBindings: {
        fill: 'tok-surface',
        radius: 'tok-radius-md',
      },
      cssFilters: {
        brightness: 105,
        contrast: 102,
        saturate: 110,
        grayscale: 0,
      },
      transition: {
        preset: 'smooth',
        durationMs: 250,
      },
      effects: [{ id: 'fx-shadow', type: 'drop-shadow', visible: true, x: 0, y: 8, blur: 24, color: 'rgba(0,0,0,0.2)' }],
    };

    const richImage: ImageNode = {
      id: 'img-rich',
      type: 'image',
      name: 'Rich Image',
      assetId: 'asset-1',
      alt: 'Banner',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      style: {
        fit: 'cover',
        radius: 8,
        cornerRadii: { topLeft: 8, topRight: 8, bottomRight: 0, bottomLeft: 0 },
        stroke: '#000',
        strokeWidth: 1,
        borderSides: {
          top: { width: 1, color: '#000000' },
          right: { width: 1, color: '#000000' },
          bottom: { width: 1, color: '#000000' },
          left: { width: 1, color: '#000000' },
        },
      },
    };

    const richPath: PathNode = {
      id: 'path-rich',
      type: 'path',
      name: 'Rich Path',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      closed: true,
      points: [
        { id: 'pt-1', pointType: 'smooth', x: 0, y: 0, handleIn: { x: -5, y: 0 }, handleOut: { x: 5, y: 0 } },
        { id: 'pt-2', pointType: 'corner', x: 100, y: 100 },
      ],
      subpaths: [
        {
          closed: false,
          points: [
            { id: 'sp-1', pointType: 'corner', x: 10, y: 10 },
            { id: 'sp-2', pointType: 'corner', x: 50, y: 50 },
          ],
        },
      ],
      shapeMeta: { kind: 'polygon', sides: 6 },
      style: {
        fill: '#10b981',
        stroke: '#047857',
        strokeWidth: 2,
      },
    };

    const richInstance: ComponentInstanceNode = {
      id: 'inst-rich',
      type: 'component-instance',
      name: 'Button Instance',
      componentId: 'comp-btn',
      x: 10,
      y: 10,
      width: 120,
      height: 44,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {
        'label-1': { text: 'Submit', fill: '#fff' },
      },
      variantSelection: {
        size: 'lg',
        tone: 'primary',
      },
      slotAssignments: {
        icon: { text: 'Star', visible: true },
      },
      tokenBindings: {
        fill: 'tok-surface',
      },
    };

    const nodes: DesignNode[] = [richFrame, richImage, richPath, richInstance];
    for (const orig of nodes) {
      const cloned = deepCloneNode(orig);
      expect(cloned).toEqual(orig);

      const origRefs = collectObjectRefs(orig);
      const cloneRefs = collectObjectRefs(cloned);
      for (const ref of cloneRefs) {
        expect(origRefs.has(ref)).toBe(false);
      }
    }

    // Explicitly mutate nested fields on cloned frame & instance to prove zero aliasing
    const clonedFrame = deepCloneNode(richFrame) as FrameNode;
    clonedFrame.layout!.padding!.top = 999;
    (clonedFrame.layoutChild!.inset!.left as { value: number }).value = 999;
    clonedFrame.responsive!.tablet!.padding!.bottom = 999;
    clonedFrame.stateOverrides!.hover!.fill = '#000000';
    clonedFrame.tokenBindings!.fill = 'mutated';
    clonedFrame.cssFilters!.brightness = 99;
    clonedFrame.transition!.durationMs = 9999;
    clonedFrame.style.borderSides!.top!.width = 99;
    clonedFrame.style.cornerRadii!.topLeft = 99;

    expect(richFrame.layout?.padding?.top).toBe(16);
    expect(richFrame.layoutChild?.inset?.left?.value).toBe(8);
    expect(richFrame.responsive?.tablet?.padding?.bottom).toBe(12);
    expect(richFrame.stateOverrides?.hover?.fill).toBe('#f8fafc');
    expect(richFrame.tokenBindings?.fill).toBe('tok-surface');
    expect(richFrame.cssFilters?.brightness).toBe(105);
    expect(richFrame.transition?.durationMs).toBe(250);
    expect(richFrame.style.borderSides?.top?.width).toBe(1);
    expect(richFrame.style.cornerRadii?.topLeft).toBe(12);

    const clonedInst = deepCloneNode(richInstance) as ComponentInstanceNode;
    clonedInst.variantSelection!.size = 'sm';
    clonedInst.slotAssignments!.icon.text = 'Changed';
    expect(richInstance.variantSelection?.size).toBe('lg');
    expect(richInstance.slotAssignments?.icon.text).toBe('Star');
  });
});

describe('P1-7: Custom Fonts > 16 KB (folio-asset://) work in Canvas, Live Preview, Standalone HTML & ZIP', () => {
  it('resolves folio-asset:// fonts across display, portable HTML, and HTML/React ZIP bundles', async () => {
    const globalWithWin = globalThis as unknown as {
      window?: unknown;
      URL: typeof URL;
    };
    const prevWindow = globalWithWin.window;
    const prevCreateObjectUrl = globalWithWin.URL.createObjectURL;
    const prevRevokeObjectUrl = globalWithWin.URL.revokeObjectURL;

    let blobCounter = 0;
    globalWithWin.window = {};
    globalWithWin.URL.createObjectURL = () => `blob:https://folio.test/font-${++blobCounter}`;
    globalWithWin.URL.revokeObjectURL = () => {};

    try {
      const fontBytes = makeLargeWoff2Bytes(24 * 1024);
      const sha256 = await computeBytesSha256(fontBytes);
      await putDeduplicatedAssetBlob({
        sha256,
        bytes: fontBytes,
        mimeType: 'font/woff2',
      });

      const folioFontAsset: AssetReference = {
        id: 'font-brand-display',
        name: 'Brand Display.woff2',
        kind: 'font',
        mimeType: 'font/woff2',
        sha256,
        byteLength: fontBytes.byteLength,
        source: `folio-asset://${sha256}`,
        createdAt: new Date().toISOString(),
      };

      // Display URL uses fast blob:, portable URL uses self-contained data:font/woff2;base64,
      expect(resolveAssetDisplayUrl(folioFontAsset)?.startsWith('blob:https://folio.test/')).toBe(true);
      expect(resolvePortableAssetUrl(folioFontAsset)?.startsWith('data:font/woff2;base64,')).toBe(true);

      // Display @font-face emits blob: URL for Canvas / Live Preview
      const displayCss = buildCustomFontFaceCss([folioFontAsset], { mode: 'display' });
      expect(displayCss).toContain('font-family: "Brand Display";');
      expect(displayCss).toContain('blob:https://folio.test/');
      expect(displayCss).toContain('format("woff2")');

      // Portable @font-face embeds data: URI and NEVER leaks blob:
      const portableCss = buildCustomFontFaceCss([folioFontAsset], { mode: 'portable' });
      expect(portableCss).toContain('font-family: "Brand Display";');
      expect(portableCss).toContain('data:font/woff2;base64,');
      expect(portableCss).not.toContain('blob:https://');

      // Live Preview CSP permits blob: font-src
      expect(LIVE_PREVIEW_CSP).toContain('font-src data: blob:');

      const project = createInitialProject('Custom Font Project');
      project.assets = [folioFontAsset];

      // Live Preview HTML (inline mode) emits @font-face with blob:
      const liveHtml = buildLivePreviewHtml(project, { pageId: project.pages[0].id });
      expect(liveHtml).toContain('font-family: "Brand Display";');
      expect(liveHtml).toContain('blob:https://folio.test/');

      // Materialized Standalone HTML (portable mode) emits @font-face with data: URI
      const materialized = await materializeProjectAssetsForExport(project);
      const portableHtml = buildLivePreviewHtml(materialized, {
        pageId: materialized.pages[0].id,
        assetMode: 'portable',
      });
      expect(portableHtml).toContain('font-family: "Brand Display";');
      expect(portableHtml).toContain('data:font/woff2;base64,');
      expect(portableHtml).not.toContain('blob:https://');

      // HTML/CSS and React ZIP bundles emit relative/root assets/ paths and package binary .woff2 even after LRU clear
      clearAssetMemoryCache();

      const htmlBundle = buildCompiledProjectBundle(materialized, {
        target: 'html-css',
        pageId: materialized.pages[0].id,
      });
      const htmlTokens = compileTokensCssFile(materialized, { assetMode: 'bundle', bundlePrefix: '../' });
      expect(htmlTokens.content).toContain('../assets/');
      expect(htmlTokens.content).not.toContain('blob:');
      const htmlZipEntries = parseZipArchive(htmlBundle.zipBytes);
      const htmlFontEntry = htmlZipEntries.find((e) => e.path.startsWith('assets/') && e.path.endsWith('.woff2'));
      expect(htmlFontEntry).toBeDefined();
      expect(htmlFontEntry!.data.byteLength).toBe(fontBytes.byteLength);

      const reactBundle = buildCompiledProjectBundle(materialized, {
        target: 'react',
        pageId: materialized.pages[0].id,
      });
      const reactTokens = compileTokensCssFile(materialized, { assetMode: 'bundle', bundlePrefix: '/' });
      expect(reactTokens.content).toContain('url("/assets/');
      const reactZipEntries = parseZipArchive(reactBundle.zipBytes);
      const reactFontEntry = reactZipEntries.find((e) => e.path.startsWith('public/assets/') && e.path.endsWith('.woff2'));
      expect(reactFontEntry).toBeDefined();
      expect(reactFontEntry!.data.byteLength).toBe(fontBytes.byteLength);
    } finally {
      globalWithWin.window = prevWindow;
      globalWithWin.URL.createObjectURL = prevCreateObjectUrl;
      globalWithWin.URL.revokeObjectURL = prevRevokeObjectUrl;
    }
  });
});

describe('P1-8: Node Logic action.media-animation play/pause/reverse/stop targets [data-folio-id] directly', () => {
  function buildAnimationControlProject() {
    const project = createInitialProject('Animation Control Parity');
    const page = project.pages[0];
    const now = new Date().toISOString();

    const btnPlay = makeRect('btn-play');
    const btnPause = makeRect('btn-pause');
    const btnReverse = makeRect('btn-reverse');
    const btnStop = makeRect('btn-stop');
    const box = makeRect('anim-box');
    page.document.nodes = [btnPlay, btnPause, btnReverse, btnStop, box];

    project.animations = [
      {
        id: 'clip-slide',
        name: 'Slide Box',
        pageId: page.id,
        durationMs: 1200,
        loop: true,
        autoplay: false,
        tracks: [
          {
            id: 'tr-x',
            targetNodeId: 'anim-box',
            property: 'x',
            keyframes: [
              { id: 'kf-0', timeMs: 0, value: 16, easing: 'linear' },
              { id: 'kf-1', timeMs: 1200, value: 316, easing: 'linear' },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];

    const evPlay = createLogicNode({ id: 'ev-play', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'btn-play' } });
    const actPlay = createLogicNode({ id: 'act-play', type: 'action.media-animation', x: 200, y: 0, data: { clipId: 'clip-slide', command: 'play' } });
    const evPause = createLogicNode({ id: 'ev-pause', type: 'event.on-click', x: 0, y: 100, data: { targetNodeId: 'btn-pause' } });
    const actPause = createLogicNode({ id: 'act-pause', type: 'action.media-animation', x: 200, y: 100, data: { clipId: 'clip-slide', command: 'pause' } });
    const evReverse = createLogicNode({ id: 'ev-reverse', type: 'event.on-click', x: 0, y: 200, data: { targetNodeId: 'btn-reverse' } });
    const actReverse = createLogicNode({ id: 'act-reverse', type: 'action.media-animation', x: 200, y: 200, data: { clipId: 'clip-slide', command: 'reverse' } });
    const evStop = createLogicNode({ id: 'ev-stop', type: 'event.on-click', x: 0, y: 300, data: { targetNodeId: 'btn-stop' } });
    const actStop = createLogicNode({ id: 'act-stop', type: 'action.media-animation', x: 200, y: 300, data: { clipId: 'clip-slide', command: 'stop' } });

    const graph = createLogicGraph({
      id: 'graph-anim-controls',
      name: 'Animation Controls',
      scope: 'page',
      targetId: page.id,
      nodes: [evPlay, actPlay, evPause, actPause, evReverse, actReverse, evStop, actStop],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: evPlay.id, sourcePortId: 'exec', targetNodeId: actPlay.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: evPause.id, sourcePortId: 'exec', targetNodeId: actPause.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: evReverse.id, sourcePortId: 'exec', targetNodeId: actReverse.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c4', sourceNodeId: evStop.id, sourcePortId: 'exec', targetNodeId: actStop.id, targetPortId: 'exec' }),
      ],
    });
    project.logicGraphs = [graph];

    return { project, page };
  }

  it('emits per-clip --reverse, --paused, and --stopped CSS rules targeting [data-folio-id]', () => {
    const { project, page } = buildAnimationControlProject();
    const css = compilePageAnimationsCss(project, page);
    const playClass = getClipCssClassName(project.animations![0]);

    expect(css).toContain(`.${playClass} [data-folio-id="anim-box"]`);
    expect(css).toContain(
      `.${playClass}--reverse [data-folio-id="anim-box"], [data-folio-id="anim-box"].${playClass}--reverse { animation-direction: reverse; }`,
    );
    expect(css).toContain(
      `.${playClass}--paused [data-folio-id="anim-box"], [data-folio-id="anim-box"].${playClass}--paused { animation-play-state: paused; }`,
    );
    expect(css).toContain(
      `.${playClass}--stopped [data-folio-id="anim-box"], [data-folio-id="anim-box"].${playClass}--stopped { animation: none; }`,
    );
  });

  it('keeps Live Preview JS and React TSX in full parity using per-clip modifier classes (not documentElement.style)', () => {
    const { project, page } = buildAnimationControlProject();
    const playClass = getClipCssClassName(project.animations![0]);

    const previewScript = buildLivePreviewLogicScript(project, page);
    expect(previewScript).not.toBeNull();
    expect(previewScript).not.toContain('documentElement.style.animationPlayState');
    expect(previewScript).not.toContain('documentElement.style.animationDirection');

    const preview = createPreviewDomHarness(previewScript!, [
      'btn-play',
      'btn-pause',
      'btn-reverse',
      'btn-stop',
      'anim-box',
    ]);
    const react = createReactTsxHarness(project, page.id);
    expect(react.pageFile.content).not.toContain('documentElement.style.animationPlayState');
    expect(react.pageFile.content).not.toContain('documentElement.style.animationDirection');

    const runParitySequence = (harness: { click: (id: string) => void; docClassList: Set<string> }) => {
      // 1. Play
      harness.click('btn-play');
      expect(harness.docClassList.has(playClass)).toBe(true);
      expect(harness.docClassList.has(`${playClass}--paused`)).toBe(false);
      expect(harness.docClassList.has(`${playClass}--reverse`)).toBe(false);
      expect(harness.docClassList.has(`${playClass}--stopped`)).toBe(false);

      // 2. Pause
      harness.click('btn-pause');
      expect(harness.docClassList.has(playClass)).toBe(true);
      expect(harness.docClassList.has(`${playClass}--paused`)).toBe(true);

      // 3. Play resumes from pause without stripping playClass
      harness.click('btn-play');
      expect(harness.docClassList.has(playClass)).toBe(true);
      expect(harness.docClassList.has(`${playClass}--paused`)).toBe(false);

      // 4. Reverse
      harness.click('btn-reverse');
      expect(harness.docClassList.has(playClass)).toBe(true);
      expect(harness.docClassList.has(`${playClass}--reverse`)).toBe(true);
      expect(harness.docClassList.has(`${playClass}--paused`)).toBe(false);

      // 5. Stop clears play/pause/reverse and sets stopped
      harness.click('btn-stop');
      expect(harness.docClassList.has(playClass)).toBe(false);
      expect(harness.docClassList.has(`${playClass}--paused`)).toBe(false);
      expect(harness.docClassList.has(`${playClass}--reverse`)).toBe(false);
      expect(harness.docClassList.has(`${playClass}--stopped`)).toBe(true);
    };

    runParitySequence(preview);
    runParitySequence(react);
  });
});

describe('P0-3 Hardening: deleting a nested master component also unbinds component-scoped LogicGraph targetNodeId', () => {
  it('clears targetNodeId inside outer component logicGraph when inner component instance is detached', () => {
    const now = new Date().toISOString();
    const innerDoc = createEmptyDocument('Inner', 80, 32);
    innerDoc.nodes = [makeRect('inner-bg', { width: 80, height: 32 })];
    const innerComp: ComponentDefinition = {
      id: 'comp-inner',
      name: 'Inner',
      document: innerDoc,
      createdAt: now,
      updatedAt: now,
    };

    const nestedInst: ComponentInstanceNode = {
      id: 'nested-inner-inst',
      type: 'component-instance',
      name: 'Inner Instance',
      componentId: 'comp-inner',
      x: 10,
      y: 10,
      width: 80,
      height: 32,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {},
    };
    const outerDoc = createEmptyDocument('Outer', 240, 120);
    outerDoc.nodes = [nestedInst];
    const outerComp: ComponentDefinition = {
      id: 'comp-outer',
      name: 'Outer',
      document: outerDoc,
      createdAt: now,
      updatedAt: now,
    };

    const project = createInitialProject('Nested Component Logic Cleanup');
    project.components = [innerComp, outerComp];
    const outerGraph = createLogicGraph({
      id: 'graph-outer',
      name: 'Outer Logic',
      scope: 'component',
      targetId: 'comp-outer',
      nodes: [createLogicNode({ id: 'ln-nested-click', type: 'event.on-click', x: 0, y: 0, data: { targetNodeId: 'nested-inner-inst' } })],
    });
    project.logicGraphs = [outerGraph];

    expect(validateProject(project).ok).toBe(true);

    const state = createEditorState(project);
    const liveInner = state.project.components.find((c) => c.id === 'comp-inner')!;
    const nextState = editorReducer(state, {
      type: 'delete-component',
      componentId: 'comp-inner',
      expectedMasterDocument: liveInner.document,
      expectedUpdatedAt: liveInner.updatedAt,
    });

    expect(validateProject(nextState.project).ok).toBe(true);
    expect(nextState.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('');
  });
});

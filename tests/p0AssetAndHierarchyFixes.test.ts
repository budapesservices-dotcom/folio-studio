import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDocument, createInitialProject } from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import { replaceComponentInstancesInDocument } from '../src/core/document/components';
import type {
  AssetReference,
  ComponentDefinition,
  ComponentInstanceNode,
  ImageNode,
  RectNode,
} from '../src/core/document/types';
import {
  clearAssetMemoryCache,
  extractAssetBinaryBytesSync,
  getAssetCacheRevision,
  hydrateProjectAssetsToStore,
  ingestImageBytes,
  materializeProjectAssetsForExport,
  resolveAssetDisplayUrl,
  resolvePortableAssetUrl,
  subscribeAssetCacheUpdates,
} from '../src/core/persistence/assetStore';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { buildLivePreviewHtml } from '../src/engines/codegen/htmlCssCompiler';
import { buildCompiledProjectBundle } from '../src/engines/codegen/projectBundle';
import { parseZipArchive } from '../src/engines/codegen/zipArchive';
import { createInitialEditorState, editorReducer } from '../src/app/editorReducer';
import { createClipboardPayload, prepareNodesForPaste } from '../src/app/nodeClipboard';

function makeRect(id: string, extra: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: 'rect',
    name: id,
    x: 10,
    y: 10,
    width: 120,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fill: '#3b82f6',
      stroke: 'none',
      strokeWidth: 0,
      radius: 8,
    },
    ...extra,
  };
}

function makeLargePngBytes(sizeBytes = 24 * 1024): Uint8Array {
  // Valid PNG signature followed by deterministic bytes > 16 KB threshold
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < sizeBytes; i += 1) {
    bytes[i] = (i * 31 + 17) & 0xff;
  }
  return bytes;
}

afterEach(() => {
  clearAssetMemoryCache();
});

describe('P0-1 & P0-2: Portable Asset Exports (SVG/PNG/HTML/ZIP) & Hydration Reactivity', () => {
  it('resolvePortableAssetUrl never returns ephemeral blob: URLs and SVG/HTML exports embed data URIs', async () => {
    // Simulate a browser environment where setMemoryAssetCache creates blob: URLs
    const globalWithWin = globalThis as unknown as {
      window?: unknown;
      URL: typeof URL;
    };
    const prevWindow = globalWithWin.window;
    const prevCreateObjectUrl = globalWithWin.URL.createObjectURL;
    const prevRevokeObjectUrl = globalWithWin.URL.revokeObjectURL;

    let blobCounter = 0;
    globalWithWin.window = {};
    globalWithWin.URL.createObjectURL = () => `blob:https://folio.test/ephemeral-${++blobCounter}`;
    globalWithWin.URL.revokeObjectURL = () => {};

    try {
      const largeBytes = makeLargePngBytes(20 * 1024);
      const ingested = await ingestImageBytes({
        name: 'hero-photo.png',
        mimeType: 'image/png',
        bytes: largeBytes,
        width: 400,
        height: 240,
      });

      const folioUriAsset: AssetReference = {
        ...ingested.asset,
        source: `folio-asset://${ingested.asset.sha256}`,
      };

      // In-tab display URL uses fast ephemeral blob: URL
      const displayUrl = resolveAssetDisplayUrl(folioUriAsset);
      expect(displayUrl?.startsWith('blob:https://folio.test/')).toBe(true);

      // Portable URL ALWAYS resolves to self-contained data: URI, never blob:
      const portableFromFolioUri = resolvePortableAssetUrl(folioUriAsset);
      expect(portableFromFolioUri?.startsWith('data:image/png;base64,')).toBe(true);
      expect(portableFromFolioUri?.startsWith('blob:')).toBe(false);

      // Even after materializeProjectAssetsForExport sets asset.source to data:,
      // resolvePortableAssetUrl returns data: (never shadowed by memoryUrlByHash blob:)
      const project = createInitialProject('Portable Export Test');
      const imgNode: ImageNode = {
        id: 'img-hero',
        type: 'image',
        name: 'Hero Photo',
        assetId: folioUriAsset.id,
        alt: 'Hero Photo',
        x: 20,
        y: 20,
        width: 300,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        onCanvas: true,
        style: { fit: 'cover', radius: 0, stroke: 'none', strokeWidth: 0 },
      };
      const blurCard = makeRect('blur-card', {
        x: 40,
        y: 40,
        effects: [{ id: 'fx-1', type: 'backdrop-blur', visible: true, radius: 12 }],
      });
      project.assets = [folioUriAsset];
      project.pages[0].document.nodes = [imgNode, blurCard];

      const materialized = await materializeProjectAssetsForExport(project);
      expect(materialized.assets[0].source.startsWith('data:image/png;base64,')).toBe(true);
      expect(resolvePortableAssetUrl(materialized.assets[0])?.startsWith('data:image/png;base64,')).toBe(true);

      // 1. Standalone SVG embeds data: URI (never blob:) and preserves backdropBlur <foreignObject>
      const svgStandalone = serializeDocumentToSvgString(
        materialized.pages[0].document,
        materialized.components,
        { assets: materialized.assets },
      );
      expect(svgStandalone).toContain('href="data:image/png;base64,');
      expect(svgStandalone).not.toContain('blob:https://');
      expect(svgStandalone).toContain('<foreignObject');

      // 2. PNG rasterizeSafe SVG omits <foreignObject> so Safari/WebKit canvas is never tainted
      const svgForPng = serializeDocumentToSvgString(
        materialized.pages[0].document,
        materialized.components,
        { assets: materialized.assets, rasterizeSafe: true },
      );
      expect(svgForPng).toContain('href="data:image/png;base64,');
      expect(svgForPng).not.toContain('blob:https://');
      expect(svgForPng).not.toContain('<foreignObject');

      // 3. Standalone HTML export (assetMode: 'portable') embeds data: URI (never blob:)
      const portableHtml = buildLivePreviewHtml(materialized, {
        pageId: materialized.pages[0].id,
        assetMode: 'portable',
      });
      expect(portableHtml).toContain('src="data:image/png;base64,');
      expect(portableHtml).not.toContain('blob:https://');

      // 4. Live Preview iframe (default assetMode: 'inline') still uses fast blob: URL
      const liveHtml = buildLivePreviewHtml(project, {
        pageId: project.pages[0].id,
      });
      expect(liveHtml).toContain('src="blob:https://folio.test/');

      // 5. ZIP bundle packages the materialized binary even if memory LRU was evicted!
      clearAssetMemoryCache();
      const bundle = buildCompiledProjectBundle(materialized, {
        target: 'html-css',
        pageId: materialized.pages[0].id,
      });
      const parsed = parseZipArchive(bundle.zipBytes);
      const assetEntry = parsed.find((entry) => entry.path.startsWith('assets/') && entry.path.endsWith('.png'));
      expect(assetEntry).toBeDefined();
      expect(assetEntry!.bytes.byteLength).toBe(largeBytes.byteLength);
    } finally {
      globalWithWin.window = prevWindow;
      globalWithWin.URL.createObjectURL = prevCreateObjectUrl;
      globalWithWin.URL.revokeObjectURL = prevRevokeObjectUrl;
    }
  });

  it('extractAssetBinaryBytesSync resolves folio-asset://<hash> even when asset.sha256 is omitted', async () => {
    const bytes = makeLargePngBytes(18 * 1024);
    const ingested = await ingestImageBytes({
      name: 'without-sha-field.png',
      mimeType: 'image/png',
      bytes,
    });
    const uriOnlyAsset: AssetReference = {
      id: ingested.asset.id,
      name: ingested.asset.name,
      kind: 'image',
      mimeType: 'image/png',
      source: `folio-asset://${ingested.asset.sha256}`,
      createdAt: ingested.asset.createdAt,
    };
    const extracted = extractAssetBinaryBytesSync(uriOnlyAsset);
    expect(extracted).not.toBeNull();
    expect(extracted!.byteLength).toBe(bytes.byteLength);
  });

  it('hydrateProjectAssetsToStore emits a single batched cache revision update so renderers repaint', async () => {
    const startRev = getAssetCacheRevision();
    let notifications = 0;
    const unsubscribe = subscribeAssetCacheUpdates(() => {
      notifications += 1;
    });

    try {
      const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=';
      const project = createInitialProject('Hydration Notify Test');
      project.assets = [
        {
          id: 'asset-a',
          name: 'a.png',
          kind: 'image',
          mimeType: 'image/png',
          source: `data:image/png;base64,${tinyPngBase64}`,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'asset-b',
          name: 'b.svg',
          kind: 'image',
          mimeType: 'image/svg+xml',
          source: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64')}`,
          createdAt: new Date().toISOString(),
        },
      ];

      await hydrateProjectAssetsToStore(project);

      // Batched into a single notification for both hydrated assets
      expect(notifications).toBe(1);
      expect(getAssetCacheRevision()).toBe(startRev + 1);

      clearAssetMemoryCache();
      expect(notifications).toBe(2);
      expect(getAssetCacheRevision()).toBe(startRev + 2);
    } finally {
      unsubscribe();
    }
  });
});

describe('P0-3: delete-component cleans orphan clipMaskBaseId & cross-studio references', () => {
  it('clears clipMaskBaseId on page & nested components and cleans Node Logic, Motion & Code Extensions', () => {
    const now = new Date().toISOString();
    const masterDoc = createEmptyDocument('Badge Master', 120, 40);
    masterDoc.nodes = [makeRect('master-bg', { width: 120, height: 40 })];
    const masterComp: ComponentDefinition = {
      id: 'comp-badge',
      name: 'Badge',
      document: masterDoc,
      createdAt: now,
      updatedAt: now,
    };

    const nestedInst: ComponentInstanceNode = {
      id: 'nested-inst',
      type: 'component-instance',
      name: 'Nested Badge',
      componentId: 'comp-badge',
      x: 10,
      y: 10,
      width: 120,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {},
    };
    const nestedClipped = makeRect('nested-clipped', { clipMaskBaseId: 'nested-inst' });
    const outerCompDoc = createEmptyDocument('Card Master', 300, 200);
    outerCompDoc.nodes = [nestedInst, nestedClipped];
    const outerComp: ComponentDefinition = {
      id: 'comp-card',
      name: 'Card',
      document: outerCompDoc,
      createdAt: now,
      updatedAt: now,
    };

    const pageInst: ComponentInstanceNode = {
      id: 'page-inst-1',
      type: 'component-instance',
      name: 'Hero Badge',
      componentId: 'comp-badge',
      x: 40,
      y: 40,
      width: 120,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {},
    };
    const pageClipped = makeRect('page-clipped', { clipMaskBaseId: 'page-inst-1' });
    const otherRect = makeRect('other-rect');

    const project = createInitialProject('Delete Component Integrity');
    const pageId = project.pages[0].id;
    project.pages[0].document.nodes = [pageInst, pageClipped, otherRect];
    project.components = [masterComp, outerComp];
    project.logicGraphs = [
      {
        id: 'graph-page-1',
        name: 'Page Logic',
        scope: 'page',
        pageId,
        nodes: [
          {
            id: 'ln-click',
            type: 'event.on-click',
            label: 'Click Badge',
            x: 10,
            y: 10,
            data: { targetNodeId: 'page-inst-1' },
          },
        ],
        connections: [],
        variables: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    project.animations = [
      {
        id: 'clip-1',
        name: 'Intro',
        pageId,
        durationMs: 1000,
        loop: false,
        autoplay: false,
        tracks: [
          {
            id: 'tr-inst',
            targetNodeId: 'page-inst-1',
            property: 'opacity',
            keyframes: [{ id: 'kf-1', timeMs: 0, value: 0, easing: 'ease-out' }],
          },
          {
            id: 'tr-other',
            targetNodeId: 'other-rect',
            property: 'opacity',
            keyframes: [{ id: 'kf-2', timeMs: 0, value: 1, easing: 'ease-out' }],
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];
    project.codeModules = [
      {
        id: 'mod-ext-1',
        path: 'src/extensions/badge.css',
        language: 'css',
        mapping: 'extension',
        targetPageId: pageId,
        targetNodeId: 'page-inst-1',
        content: '.badge { color: red; }',
        createdAt: now,
        updatedAt: now,
      },
    ];

    const preValidation = validateProject(project);
    expect(preValidation.ok, preValidation.ok ? '' : preValidation.error).toBe(true);

    const state = createInitialEditorState(project);
    const nextState = editorReducer(state, {
      type: 'delete-component',
      componentId: 'comp-badge',
      expectedMasterDocument: masterComp.document,
      expectedUpdatedAt: masterComp.updatedAt,
    });

    // Must remain 100% valid for IndexedDB autosave & .flop export
    expect(validateProject(nextState.project).ok).toBe(true);

    // Page clipped layer no longer has dangling clipMaskBaseId
    const nextPageClipped = nextState.project.pages[0].document.nodes.find((n) => n.id === 'page-clipped');
    expect(nextPageClipped?.clipMaskBaseId).toBeUndefined();

    // Nested component clipped layer no longer has dangling clipMaskBaseId
    const nextOuterComp = nextState.project.components.find((c) => c.id === 'comp-card');
    const nextNestedClipped = nextOuterComp?.document.nodes.find((n) => n.id === 'nested-clipped');
    expect(nextNestedClipped?.clipMaskBaseId).toBeUndefined();

    // Cross-studio references to page-inst-1 cleaned up cleanly
    expect(nextState.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('');
    expect(nextState.project.animations?.[0].tracks.map((t) => t.targetNodeId)).toEqual(['other-rect']);
    expect(nextState.project.codeModules?.[0].targetNodeId).toBeUndefined();
    expect(nextState.project.codeModules?.[0].content).toBe('.badge { color: red; }');
  });

  it('replaceComponentInstancesInDocument strips clipMaskBaseId and promotes parentId cleanly', () => {
    const now = new Date().toISOString();
    const masterDoc = createEmptyDocument('Box', 100, 100);
    masterDoc.nodes = [makeRect('m-rect')];
    const comp: ComponentDefinition = {
      id: 'comp-box',
      name: 'Box',
      document: masterDoc,
      createdAt: now,
      updatedAt: now,
    };

    const doc = createEmptyDocument('Page', 800, 600);
    const inst: ComponentInstanceNode = {
      id: 'inst-1',
      type: 'component-instance',
      name: 'Box Instance',
      componentId: 'comp-box',
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {},
    };
    const clipped = makeRect('clipped-1', { clipMaskBaseId: 'inst-1' });
    doc.nodes = [inst, clipped];

    const replaced = replaceComponentInstancesInDocument(doc, comp);
    expect(replaced.nodes.some((n) => n.id === 'inst-1')).toBe(false);
    expect(replaced.nodes.find((n) => n.id === 'clipped-1')?.clipMaskBaseId).toBeUndefined();
  });
});

describe('P0-4: prepareNodesForPaste strips orphan clipMaskBaseId on auto-detached circular instances', () => {
  it('produces valid hierarchy when pasting a layer clipped to a circular component instance', () => {
    const now = new Date().toISOString();
    const masterDoc = createEmptyDocument('Chip', 100, 40);
    masterDoc.nodes = [makeRect('chip-bg', { width: 100, height: 40 })];
    const chipComp: ComponentDefinition = {
      id: 'comp-chip',
      name: 'Chip',
      document: masterDoc,
      createdAt: now,
      updatedAt: now,
    };

    const inst: ComponentInstanceNode = {
      id: 'inst-chip',
      type: 'component-instance',
      name: 'Chip Instance',
      componentId: 'comp-chip',
      x: 20,
      y: 20,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: {},
    };
    const clippedSibling = makeRect('clipped-overlay', { clipMaskBaseId: 'inst-chip' });

    const clipboard = createClipboardPayload(
      [inst, clippedSibling],
      ['inst-chip', 'clipped-overlay'],
      { target: 'main', pageId: 'page-1', componentId: null },
    );
    expect(clipboard).not.toBeNull();

    let seq = 0;
    const prepared = prepareNodesForPaste(
      clipboard!,
      {
        target: 'component',
        componentId: 'comp-chip',
        components: [chipComp],
      },
      () => `pasted-${++seq}`,
    );

    expect(prepared.detachedCircularCount).toBe(1);
    const pastedOverlay = prepared.nodes.find((n) => n.name === 'clipped-overlay');
    expect(pastedOverlay).toBeDefined();
    expect(pastedOverlay?.clipMaskBaseId).toBeUndefined();

    // Inserting pasted nodes into the master component document must pass full project validation
    const project = createEmptyProject('Circular Paste Validation');
    project.components = [
      {
        ...chipComp,
        document: {
          ...chipComp.document,
          nodes: [...chipComp.document.nodes, ...prepared.nodes],
        },
      },
    ];
    expect(validateProject(project).ok).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import type { VNode } from 'preact';

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

import { ComponentThumbnail } from '../src/app/ComponentThumbnail';
import { createComponentCanvasBufferProject } from '../src/app/componentCanvasSync';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { executeRenderSelectionToSvg, renderSelectionToSvgAssetAndNode } from '../src/app/renderSelectionToSvg';
import { ComponentRackPanel } from '../src/app/workspace/ComponentRackPanel';
import { createBlankProject, createInitialProject } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type {
  AssetReference,
  ComponentDefinition,
  ComponentInstanceNode,
  ImageNode,
  RectNode,
} from '../src/core/document/types';
import { requireValidProject } from '../src/core/document/validation';
import {
  extractAssetBinaryBytesSync,
  hydrateProjectAssetsToStore,
  ingestImageBytes,
  materializeProjectAssetsForExport,
  resolveAssetDisplayUrl,
  resolvePortableAssetUrl,
} from '../src/core/persistence/assetStore';
import { parseFlopZipArchive, serializeProjectToFlopZip } from '../src/core/persistence/flopArchive';
import { parseProjectJsonSafe, serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { DocumentArtworkContent } from '../src/engines/canvas/artwork';
import { buildLivePreviewHtml } from '../src/engines/codegen';

interface VNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function expandVNode(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expandVNode);
  const vnode = node as VNodeLike;
  if (typeof vnode.type === 'function') {
    return expandVNode((vnode.type as (props: unknown) => unknown)(vnode.props ?? {}));
  }
  if (vnode.props && 'children' in vnode.props) {
    return {
      ...vnode,
      props: {
        ...vnode.props,
        children: expandVNode(vnode.props.children),
      },
    };
  }
  return vnode;
}

function findNodes(
  tree: unknown,
  predicate: (node: VNodeLike) => boolean,
  out: VNodeLike[] = [],
): VNodeLike[] {
  if (!tree || typeof tree !== 'object') return out;
  if (Array.isArray(tree)) {
    for (const item of tree) findNodes(item, predicate, out);
    return out;
  }
  const node = tree as VNodeLike;
  if (predicate(node)) out.push(node);
  if (node.props && 'children' in node.props) {
    findNodes(node.props.children, predicate, out);
  }
  return out;
}

function collectText(tree: unknown): string {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(collectText).join('');
  if (typeof tree === 'object') {
    const node = tree as VNode<{ children?: unknown }>;
    if (typeof node.type === 'function') {
      return collectText((node.type as (props: unknown) => unknown)(node.props ?? {}));
    }
    if (node.props && 'children' in node.props) {
      return collectText(node.props.children);
    }
  }
  return '';
}

function makeRect(id: string, x: number, y: number, width: number, height: number, fill: string): RectNode {
  return {
    id,
    name: id,
    type: 'rect',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: { fill, stroke: 'none', strokeWidth: 0, radius: 0 },
  };
}

function makeTinyPngAsset(id = 'asset-raster-png'): AssetReference {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return {
    id,
    name: 'badge-photo.png',
    kind: 'image',
    mimeType: 'image/png',
    source: `data:image/png;base64,${base64}`,
    width: 32,
    height: 32,
    byteLength: 68,
    createdAt: '2026-11-28T00:00:00.000Z',
  };
}

function makeSvgImageNode(id: string, assetId: string, name: string, x = 0, y = 0, width = 120, height = 120): ImageNode {
  return {
    id,
    name,
    type: 'image',
    assetId,
    alt: name,
    naturalWidth: width,
    naturalHeight: height,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: { fit: 'contain', radius: 0, stroke: 'none', strokeWidth: 0 },
  };
}

describe('Part B — SVG Asset Resolution & Rendering in Component Preview, Canvas, Instances, and Live Preview', () => {
  it('renders actual SVG <image> (never placeholder text "Rendered SVG (4)") across Main Canvas, Component Master, Component Preview, Component Instance, Nested Instance, and Live Preview HTML', async () => {
    const svgSource = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">',
      '  <circle cx="60" cy="60" r="46" fill="#FACC15" stroke="#EAB308" stroke-width="4" />',
      '  <path d="M68 24 A36 36 0 1 0 96 84 A28 28 0 1 1 68 24 Z" fill="#1E293B" />',
      '</svg>',
    ].join('\n');
    const svgBytes = new TextEncoder().encode(svgSource);

    // Ingest via real content-addressed assetStore (produces folio-asset:// or data: URL)
    const { asset: svgAsset } = await ingestImageBytes({
      name: 'Rendered SVG (4).svg',
      mimeType: 'image/svg+xml',
      bytes: svgBytes,
      width: 120,
      height: 120,
    });
    const pngAsset = makeTinyPngAsset('asset-png-companion');

    const now = '2026-11-28T00:00:00.000Z';
    const svgNodeInMaster = makeSvgImageNode('svg-moon-layer', svgAsset.id, 'Rendered SVG (4)', 10, 10, 120, 120);
    const pngNodeInMaster = makeSvgImageNode('png-layer', pngAsset.id, 'Raster Companion', 140, 20, 48, 48);

    const moonComponent: ComponentDefinition = {
      id: 'comp-svg-moon',
      name: 'Moon SVG',
      document: {
        id: 'doc-svg-moon',
        name: 'Moon SVG',
        width: 200,
        height: 140,
        background: 'transparent',
        nodes: [svgNodeInMaster, pngNodeInMaster],
      },
      createdAt: now,
      updatedAt: now,
    };

    // Nested component wrapper referencing Moon SVG
    const nestedMoonInstance: ComponentInstanceNode = {
      id: 'nested-moon-inst',
      type: 'component-instance',
      name: 'Nested Moon',
      componentId: moonComponent.id,
      overrides: {},
      x: 16,
      y: 16,
      width: 200,
      height: 140,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };
    const cardWrapperComponent: ComponentDefinition = {
      id: 'comp-wrapper-card',
      name: 'Moon Card Wrapper',
      document: {
        id: 'doc-wrapper-card',
        name: 'Moon Card Wrapper',
        width: 240,
        height: 180,
        background: 'transparent',
        nodes: [makeRect('card-frame', 0, 0, 240, 180, '#0F172A'), nestedMoonInstance],
      },
      createdAt: now,
      updatedAt: now,
    };

    const project = createBlankProject('SVG Preview Audit');
    project.assets = [svgAsset, pngAsset];
    project.components = [moonComponent, cardWrapperComponent];
    project.pages[0].document.nodes = [
      makeSvgImageNode('main-direct-svg', svgAsset.id, 'Rendered SVG (4)', 20, 20, 120, 120),
      {
        id: 'main-moon-inst',
        type: 'component-instance',
        name: 'Moon Instance',
        componentId: moonComponent.id,
        overrides: {},
        x: 180,
        y: 20,
        width: 200,
        height: 140,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        onCanvas: true,
      },
      {
        id: 'main-wrapper-inst',
        type: 'component-instance',
        name: 'Wrapper Instance',
        componentId: cardWrapperComponent.id,
        overrides: {},
        x: 420,
        y: 20,
        width: 240,
        height: 180,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        onCanvas: true,
      },
    ];

    await hydrateProjectAssetsToStore(project);

    // 1. Main Canvas artwork (direct SVG + Component Instance + Nested Component Instance)
    const mainCanvasTree = expandVNode(
      DocumentArtworkContent({
        document: project.pages[0].document,
        components: project.components,
        maskPrefix: 'main',
        assets: project.assets,
      }),
    );
    const mainImages = findNodes(mainCanvasTree, (n) => n.type === 'image');
    // Direct SVG (1) + Moon Instance (SVG + PNG = 2) + Wrapper Nested Instance (SVG + PNG = 2) = 5 <image> nodes
    expect(mainImages).toHaveLength(5);
    for (const img of mainImages) {
      expect(typeof img.props?.href).toBe('string');
      expect((img.props?.href as string).length).toBeGreaterThan(0);
    }
    expect(collectText(mainCanvasTree)).not.toContain('Rendered SVG (4)');

    // 2. Component Master Canvas buffer
    const masterBuffer = createComponentCanvasBufferProject(moonComponent, project.designTokens, project.assets);
    const masterTree = expandVNode(
      DocumentArtworkContent({
        document: getActiveDocument(masterBuffer),
        components: project.components,
        maskPrefix: 'master',
        assets: masterBuffer.assets,
      }),
    );
    const masterImages = findNodes(masterTree, (n) => n.type === 'image');
    expect(masterImages).toHaveLength(2);
    expect(collectText(masterTree)).not.toContain('Rendered SVG (4)');

    // 3. Component Preview (ComponentThumbnail) for BOTH Moon SVG and Nested Wrapper Card
    const moonThumbTree = expandVNode(
      ComponentThumbnail({
        component: moonComponent,
        components: project.components,
        designTokens: project.designTokens,
        assets: project.assets,
      }),
    );
    const moonThumbImages = findNodes(moonThumbTree, (n) => n.type === 'image');
    expect(moonThumbImages).toHaveLength(2);
    for (const img of moonThumbImages) {
      expect(typeof img.props?.href).toBe('string');
      expect((img.props?.href as string).length).toBeGreaterThan(0);
    }
    expect(collectText(moonThumbTree)).not.toContain('Rendered SVG (4)');

    const wrapperThumbTree = expandVNode(
      ComponentThumbnail({
        component: cardWrapperComponent,
        components: project.components,
        designTokens: project.designTokens,
        assets: project.assets,
      }),
    );
    const wrapperThumbImages = findNodes(wrapperThumbTree, (n) => n.type === 'image');
    expect(wrapperThumbImages).toHaveLength(2);
    expect(collectText(wrapperThumbTree)).not.toContain('Rendered SVG (4)');

    // 4. Component Rack Panel propagates project assets to every ComponentThumbnail card
    const rackTree = expandVNode(
      ComponentRackPanel({
        panelRef: createRef<HTMLElement>(),
        open: true,
        components: project.components,
        assets: project.assets,
        searchQuery: '',
        canSaveSelection: false,
        renamingComponentId: null,
        componentNameDraft: '',
        activeApplicationId: 'app-main',
        activeApplicationName: 'Main App',
        onSearchChange: vi.fn(),
        onCreateNewMaster: vi.fn(),
        onSaveSelection: vi.fn(),
        onClose: vi.fn(),
        onInsertComponent: vi.fn(),
        onEditMaster: vi.fn(),
        onStartRename: vi.fn(),
        onRenameDraftChange: vi.fn(),
        onCommitRename: vi.fn(),
        onCancelRename: vi.fn(),
        onDuplicateComponent: vi.fn(),
        onDeleteComponent: vi.fn(),
        onSetComponentScope: vi.fn(),
      }),
    );
    const rackImages = findNodes(rackTree, (n) => n.type === 'image');
    expect(rackImages).toHaveLength(4);
    expect(collectText(rackTree)).not.toContain('Rendered SVG (4)');

    // 5. Live Preview HTML emits portable data:image/svg+xml URLs (NEVER parent-origin blob: URLs blocked by srcDoc sandbox)
    const previewHtml = buildLivePreviewHtml(project);
    expect(previewHtml).toContain('src="data:image/svg+xml;base64,');
    expect(previewHtml).toContain('src="data:image/png;base64,');
    expect(previewHtml).not.toContain('src="blob:');

    // Portable URL keeps SVG vector markup (never rasterized to PNG/JPEG)
    const portableUrl = resolvePortableAssetUrl(svgAsset);
    expect(portableUrl?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const rawSvg = new TextDecoder().decode(extractAssetBinaryBytesSync(svgAsset)!);
    expect(rawSvg).toContain('<svg');
    expect(rawSvg).toContain('#FACC15');
  });

  it('shares a single AssetReference across multiple Components without binary duplication and survives .flop JSON & ZIP reload', async () => {
    const project = createInitialProject('Shared SVG Asset Test');
    const a = makeRect('a', 0, 0, 60, 60, '#EF4444');
    const b = makeRect('b', 40, 0, 60, 60, '#3B82F6');
    project.pages[0].document.nodes = [a, b];

    const rendered = await renderSelectionToSvgAssetAndNode({
      doc: project.pages[0].document,
      selectedIds: [a.id, b.id],
    });

    const now = '2026-11-28T00:00:00.000Z';
    const compOne: ComponentDefinition = {
      id: 'comp-one',
      name: 'Icon A',
      document: {
        id: 'doc-one',
        name: 'Icon A',
        width: 120,
        height: 80,
        background: 'transparent',
        nodes: [{ ...rendered.imageNode, id: 'img-in-one', x: 10, y: 10 }],
      },
      createdAt: now,
      updatedAt: now,
    };
    const compTwo: ComponentDefinition = {
      id: 'comp-two',
      name: 'Icon B',
      document: {
        id: 'doc-two',
        name: 'Icon B',
        width: 120,
        height: 80,
        background: 'transparent',
        nodes: [{ ...rendered.imageNode, id: 'img-in-two', x: 10, y: 10 }],
      },
      createdAt: now,
      updatedAt: now,
    };

    project.assets = [rendered.asset];
    project.components = [compOne, compTwo];
    project.pages[0].document.nodes = [];

    // Both components reference the exact same assetId, and project.assets stores only ONE AssetReference
    expect(project.assets).toHaveLength(1);
    expect((compOne.document.nodes[0] as ImageNode).assetId).toBe(rendered.asset.id);
    expect((compTwo.document.nodes[0] as ImageNode).assetId).toBe(rendered.asset.id);

    // .flop JSON round-trip (materialized + hydrated)
    const exportReady = await materializeProjectAssetsForExport(project);
    const json = serializeProjectToFlopJson(exportReady);
    const reloadedJson = requireValidProject(parseProjectJsonSafe(json));
    await hydrateProjectAssetsToStore(reloadedJson);
    expect(reloadedJson.assets).toHaveLength(1);
    expect(resolveAssetDisplayUrl(reloadedJson.assets[0])).toBeTruthy();

    for (const comp of reloadedJson.components) {
      const thumbTree = expandVNode(
        ComponentThumbnail({
          component: comp,
          components: reloadedJson.components,
          assets: reloadedJson.assets,
        }),
      );
      const imgs = findNodes(thumbTree, (n) => n.type === 'image');
      expect(imgs).toHaveLength(1);
      expect((imgs[0].props?.href as string).length).toBeGreaterThan(0);
    }

    // .flop ZIP round-trip
    const zipBytes = serializeProjectToFlopZip(exportReady);
    const reloadedZip = parseFlopZipArchive(zipBytes);
    await hydrateProjectAssetsToStore(reloadedZip);
    expect(reloadedZip.assets).toHaveLength(1);
    const zipThumbTree = expandVNode(
      ComponentThumbnail({
        component: reloadedZip.components[0],
        components: reloadedZip.components,
        assets: reloadedZip.assets,
      }),
    );
    expect(findNodes(zipThumbTree, (n) => n.type === 'image')).toHaveLength(1);
  });

  it('registers exact rendered SVG asset.id into mainProject.assets during Component Canvas Render to SVG even when another asset shares the same SHA-256', async () => {
    const project = createInitialProject('Duplicate Hash Asset ID Regression');
    const r1 = makeRect('s1', 10, 10, 80, 60, '#10B981');
    const r2 = makeRect('s2', 60, 20, 80, 60, '#8B5CF6');

    const master: ComponentDefinition = {
      id: 'comp-dup-hash',
      name: 'Badge SVG',
      document: {
        id: 'doc-dup-hash',
        name: 'Badge SVG',
        width: 160,
        height: 100,
        background: 'transparent',
        nodes: [r1, r2],
      },
      createdAt: '2026-11-28T00:00:00.000Z',
      updatedAt: '2026-11-28T00:00:00.000Z',
    };

    // Pre-populate mainProject.assets with an asset having the SAME SHA-256 hash but a DIFFERENT asset.id!
    const preRendered = await renderSelectionToSvgAssetAndNode({
      doc: master.document,
      selectedIds: [r1.id, r2.id],
    });
    const preexistingSameHashAsset: AssetReference = {
      ...preRendered.asset,
      id: 'asset-older-different-id',
    };
    project.assets = [preexistingSameHashAsset];
    project.components = [master];

    const mainStore = createCanonicalEditorStore(createEditorState(project));
    const mainClient = createMainCanvasCommandClient(mainStore);
    const bufferProject = createComponentCanvasBufferProject(master, project.designTokens, project.assets);
    const componentStore = createCanonicalEditorStore(createEditorState(bufferProject), { workspace: 'component' });
    const componentClient = createComponentCanvasCommandClient(componentStore);

    const outcome = await executeRenderSelectionToSvg({
      target: 'component',
      mainProject: mainStore.getSnapshot().editorState.project,
      componentProject: componentStore.getSnapshot().editorState.project,
      selectedIds: [r1.id, r2.id],
      mainCommandClient: mainClient,
      componentCommandClient: componentClient,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // mainProject.assets MUST contain the exact outcome.asset.id referenced by outcome.imageNode.assetId!
    const mainAfter = mainStore.getSnapshot().editorState.project;
    expect(mainAfter.assets.some((a) => a.id === outcome.imageNode.assetId)).toBe(true);

    // ComponentThumbnail using mainProject.assets MUST render <image>, NEVER placeholder text
    const updatedMaster: ComponentDefinition = {
      ...master,
      document: getActiveDocument(componentStore.getSnapshot().editorState.project),
    };
    const thumbTree = expandVNode(
      ComponentThumbnail({
        component: updatedMaster,
        components: [updatedMaster],
        assets: mainAfter.assets,
      }),
    );
    const imgs = findNodes(thumbTree, (n) => n.type === 'image');
    expect(imgs).toHaveLength(1);
    expect((imgs[0].props?.href as string).length).toBeGreaterThan(0);
    expect(collectText(thumbTree)).not.toContain('Rendered SVG');
  });
});

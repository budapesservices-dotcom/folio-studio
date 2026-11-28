import { describe, expect, it, vi } from 'vitest';
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

function collectVNodeText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectVNodeText).join('');
  if (typeof node === 'object') {
    const vnode = node as VNode<{ children?: unknown }>;
    if (typeof vnode.type === 'function') {
      return collectVNodeText((vnode.type as (props: unknown) => unknown)(vnode.props));
    }
    if (vnode.props && 'children' in vnode.props) {
      return collectVNodeText(vnode.props.children);
    }
  }
  return '';
}
import {
  buildRenderedSvgFromSelection,
  executeRenderSelectionToSvg,
  renderSelectionToSvgAssetAndNode,
} from '../src/app/renderSelectionToSvg';
import { createComponentCanvasBufferProject, createComponentCanvasSyncAction, createComponentCanvasSyncSession } from '../src/app/componentCanvasSync';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { InspectorMultiSelectionView } from '../src/app/workspace/InspectorSelectionStates';
import { InspectorVectorShapingSection } from '../src/app/workspace/InspectorVectorStudioSection';
import type { StudioVectorActions } from '../src/app/workspace/inspectorVectorHelpers';
import { createBlankProject, createInitialProject } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type {
  AssetReference,
  ComponentDefinition,
  ComponentInstanceNode,
  EllipseNode,
  FrameNode,
  GroupNode,
  ImageNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import { requireValidProject, validateProject } from '../src/core/document/validation';
import {
  applyPathfinderOperation,
  applyShapeBuilderAction,
  combineNodesIntoSingleObject,
  decomposeNodesForShapeBuilder,
  divideNodesWithPathfinder,
} from '../src/core/document/vector';
import {
  MAX_BINARY_ASSET_BYTES,
  extractAssetBinaryBytesSync,
  hydrateProjectAssetsToStore,
  ingestImageBytes,
  resolveAssetDisplayUrl,
} from '../src/core/persistence/assetStore';
import { parseFlopZipArchive, serializeProjectToFlopZip } from '../src/core/persistence/flopArchive';
import { parseProjectJsonSafe, serializeProjectToFlopJson } from '../src/core/persistence/projectFile';

function makeRect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  extra: Partial<RectNode> = {},
): RectNode {
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
    style: {
      fill,
      stroke: 'none',
      strokeWidth: 0,
      radius: 0,
    },
    ...extra,
  };
}

function makeEllipse(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  extra: Partial<EllipseNode> = {},
): EllipseNode {
  return {
    id,
    name: id,
    type: 'ellipse',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fill,
      stroke: 'none',
      strokeWidth: 0,
    },
    ...extra,
  };
}

function makeText(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  extra: Partial<TextNode> = {},
): TextNode {
  return {
    id,
    name: id,
    type: 'text',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    text,
    style: {
      fill: '#111827',
      fontSize: 20,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left',
    },
    ...extra,
  };
}

function makeGroup(id: string, x: number, y: number, width: number, height: number): GroupNode {
  return {
    id,
    name: id,
    type: 'group',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
  };
}

function makeFrame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = '#F8FAFC',
  extra: Partial<FrameNode> = {},
): FrameNode {
  return {
    id,
    name: id,
    type: 'frame',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    clipContent: true,
    style: {
      fill,
      stroke: 'none',
      strokeWidth: 0,
      radius: 0,
    },
    ...extra,
  };
}

function makeTinyPngAsset(id = 'asset-png-1'): AssetReference {
  // 1x1 transparent PNG
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return {
    id,
    name: 'photo.png',
    kind: 'image',
    mimeType: 'image/png',
    source: `data:image/png;base64,${base64}`,
    width: 1,
    height: 1,
    byteLength: 68,
    createdAt: '2026-11-28T00:00:00.000Z',
  };
}

function decodeSvgFromAsset(asset: AssetReference): string {
  const bytes = extractAssetBinaryBytesSync(asset);
  if (!bytes) throw new Error('Expected SVG bytes to be extractable from asset');
  return new TextDecoder().decode(bytes);
}

describe('Render to SVG (replacing Combine into 1 Object)', () => {
  it('renders 2+ shapes of different colors into 1 SVG ImageNode preserving original colors without color blending', async () => {
    const project = createBlankProject('Colors Test');
    const red = makeRect('red-box', 40, 60, 100, 80, '#EF4444');
    const blue = makeEllipse('blue-dot', 90, 90, 100, 100, '#3B82F6');
    project.pages[0].document.background = '#FFFFFF';
    project.pages[0].document.nodes = [red, blue];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const outcome = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [red.id, blue.id],
      mainCommandClient: client,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const afterState = store.getSnapshot().editorState;
    const afterDoc = getActiveDocument(afterState.project);
    expect(afterDoc.nodes).toHaveLength(1);
    const resultNode = afterDoc.nodes[0];
    expect(resultNode.type).toBe('image');
    expect(afterState.selectedNodeIds).toEqual([resultNode.id]);

    const img = resultNode as ImageNode;
    const storedAsset = afterState.project.assets.find((a) => a.id === img.assetId);
    expect(storedAsset).toBeDefined();
    expect(storedAsset!.mimeType).toBe('image/svg+xml');

    const svg = decodeSvgFromAsset(storedAsset!);
    // Both original colors are preserved intact — no color-blend linearGradient synthesized
    expect(svg).toContain('#EF4444');
    expect(svg).toContain('#3B82F6');
    expect(svg).not.toContain('<linearGradient');
    // No white document background rect injected into the SVG
    expect(svg).not.toContain('fill="#FFFFFF"');
    expect(validateProject(afterState.project).ok).toBe(true);
  });

  it('preserves exact relative positions and tight viewBox crop for separated objects', async () => {
    const project = createBlankProject('Separated Bounds');
    const left = makeRect('left', 120, 200, 80, 60, '#10B981');
    const right = makeRect('right', 400, 310, 90, 50, '#F59E0B');
    project.pages[0].document.nodes = [left, right];

    const res = await renderSelectionToSvgAssetAndNode({
      doc: project.pages[0].document,
      selectedIds: [left.id, right.id],
      components: [],
      assets: [],
    });

    // Bounding box spans [120..490] x [200..360] => width 370, height 160
    expect(res.bounds).toEqual({ x: 120, y: 200, width: 370, height: 160 });
    expect(res.imageNode.x).toBe(120);
    expect(res.imageNode.y).toBe(200);
    expect(res.imageNode.width).toBe(370);
    expect(res.imageNode.height).toBe(160);
    expect(res.imageNode.naturalWidth).toBe(370);
    expect(res.imageNode.naturalHeight).toBe(160);

    // SVG viewBox crops tightly to 120 200 370 160 while keeping exact node coords
    expect(res.svgMarkup).toContain('viewBox="120 200 370 160"');
    expect(res.svgMarkup).toContain('width="370"');
    expect(res.svgMarkup).toContain('height="160"');
    expect(res.svgMarkup).toContain('x="120"');
    expect(res.svgMarkup).toContain('x="400"');
    expect(res.svgMarkup).toContain('y="310"');
  });

  it('renders mixed selection (Text + Image + Shapes + Group children + Component Instance) into 1 SVG ImageNode and leaves unselected layers untouched', async () => {
    const project = createBlankProject('Mixed Composition');
    const pngAsset = makeTinyPngAsset('photo-asset');
    project.assets = [pngAsset];

    const badgeMaster: ComponentDefinition = {
      id: 'comp-badge',
      name: 'Badge',
      document: {
        id: 'doc-badge',
        name: 'Badge',
        width: 100,
        height: 40,
        background: 'transparent',
        nodes: [
          makeRect('badge-bg', 0, 0, 100, 40, '#6366F1'),
          makeText('badge-label', 10, 8, 80, 24, 'NEW'),
        ],
      },
      createdAt: '2026-11-28T00:00:00.000Z',
      updatedAt: '2026-11-28T00:00:00.000Z',
    };
    project.components = [badgeMaster];

    const untouchedBelow = makeRect('bg-untouched', 0, 0, 600, 400, '#E2E8F0');
    const grp = makeGroup('grp-1', 50, 50, 200, 100);
    const grpChildShape = makeRect('grp-rect', 50, 50, 100, 80, '#EC4899', { parentId: grp.id });
    const grpChildText = makeText('grp-text', 60, 60, 140, 30, 'Hello Studio', { parentId: grp.id });
    const imgLayer: ImageNode = {
      id: 'img-1',
      name: 'Photo',
      type: 'image',
      assetId: pngAsset.id,
      alt: 'Photo',
      naturalWidth: 100,
      naturalHeight: 80,
      x: 200,
      y: 60,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      style: { fit: 'cover', radius: 0, stroke: 'none', strokeWidth: 0 },
    };
    const instanceLayer: ComponentInstanceNode = {
      id: 'inst-1',
      name: 'Badge Instance',
      type: 'component-instance',
      componentId: badgeMaster.id,
      overrides: {},
      x: 50,
      y: 160,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };
    const untouchedAbove = makeRect('top-untouched', 500, 500, 40, 40, '#0F172A');

    project.pages[0].document.nodes = [
      untouchedBelow,
      grp,
      grpChildShape,
      grpChildText,
      imgLayer,
      instanceLayer,
      untouchedAbove,
    ];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const outcome = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [grp.id, imgLayer.id, instanceLayer.id],
      mainCommandClient: client,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const afterNodes = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    // Unselected below + 1 rendered SVG ImageNode + unselected above = 3 nodes total (preserving stacking slot!)
    expect(afterNodes.map((n) => n.id)).toEqual([untouchedBelow.id, outcome.imageNode.id, untouchedAbove.id]);
    expect(outcome.imageNode.type).toBe('image');
    expect(outcome.asset.mimeType).toBe('image/svg+xml');

    // Verify all mixed content is preserved inside the SVG
    expect(outcome.svgMarkup).toContain('#EC4899');
    expect(outcome.svgMarkup).toContain('Hello Studio');
    expect(outcome.svgMarkup).toContain('data:image/png;base64,');
    expect(outcome.svgMarkup).toContain('#6366F1');
    expect(outcome.svgMarkup).toContain('NEW');
    // Unselected layers were NOT rendered into the SVG
    expect(outcome.svgMarkup).not.toContain('#E2E8F0');
    expect(outcome.svgMarkup).not.toContain('#0F172A');
  });

  it('preserves gradients, opacity, blend mode, SVG effects, clipping masks (including unselected mask base), frame clips, rotations, and warns on backdrop-blur', () => {
    const project = createBlankProject('Visual Fidelity');
    const clipFrame = makeFrame('frame-clip', 50, 50, 260, 220, 'transparent');
    const maskBase = makeEllipse('mask-base', 70, 70, 120, 120, '#FFFFFF', { parentId: clipFrame.id });
    const maskedGradientRect = makeRect('masked-rect', 60, 60, 160, 140, '#FF0000', {
      parentId: clipFrame.id,
      clipMaskBaseId: maskBase.id,
      opacity: 0.75,
      rotation: 25,
      blendMode: 'multiply',
      style: {
        fill: '#FF0000',
        fills: [
          {
            id: 'grad-1',
            type: 'linear-gradient',
            angle: 45,
            stops: [
              { offset: 0, color: '#8B5CF6' },
              { offset: 1, color: '#06B6D4' },
            ],
          },
        ],
        stroke: '#111827',
        strokeWidth: 4,
        radius: 12,
      },
      effects: [
        {
          id: 'fx-shadow',
          type: 'drop-shadow',
          visible: true,
          color: '#000000',
          x: 4,
          y: 6,
          blur: 8,
          spread: 0,
        },
      ],
    });
    const blurAccent = makeRect('blur-accent', 200, 120, 80, 80, '#22C55E', {
      parentId: clipFrame.id,
      effects: [
        {
          id: 'fx-bg-blur',
          type: 'backdrop-blur',
          visible: true,
          radius: 10,
        },
      ],
    });

    project.pages[0].document.nodes = [clipFrame, maskBase, maskedGradientRect, blurAccent];

    // Select maskedGradientRect + blurAccent WITHOUT selecting maskBase or clipFrame!
    const built = buildRenderedSvgFromSelection({
      doc: project.pages[0].document,
      selectedIds: [maskedGradientRect.id, blurAccent.id],
    });

    // Only selected nodes are scheduled for removal — maskBase and clipFrame stay untouched!
    expect(built.sourceNodeIdsToRemove).toEqual([maskedGradientRect.id, blurAccent.id]);
    expect(built.commonParentId).toBe(clipFrame.id);

    // SVG preserves linearGradient, opacity, rotate transform, blend mode, drop-shadow filter, clip-path, and mask!
    expect(built.svgMarkup).toContain('<linearGradient');
    expect(built.svgMarkup).toContain('#8B5CF6');
    expect(built.svgMarkup).toContain('#06B6D4');
    expect(built.svgMarkup).toContain('opacity="0.75"');
    expect(built.svgMarkup).toContain('rotate(25');
    expect(built.svgMarkup).toContain('mix-blend-mode:multiply');
    expect(built.svgMarkup).toContain('<filter');
    expect(built.svgMarkup).toContain('feDropShadow');
    expect(built.svgMarkup).toContain('<mask');
    expect(built.svgMarkup).toContain('mask="url(#');
    expect(built.svgMarkup).toContain('<clipPath');
    expect(built.svgMarkup).toContain('clip-path="url(#');
    // Unselected maskBase is used in <mask>, NOT drawn visibly as a standalone white ellipse
    expect(built.svgMarkup).not.toContain('fill="#FFFFFF"');
    // Backdrop-blur is explicitly warned about (not silently lost)
    expect(built.warnings.length).toBeGreaterThan(0);
    expect(built.warnings[0]).toMatch(/backdrop blur/i);
  });

  it('supports rendering an existing SVG ImageNode together with another layer (nested SVG) cleanly', async () => {
    const project = createBlankProject('Nested SVG');
    const a = makeRect('a', 20, 20, 60, 60, '#EF4444');
    const b = makeRect('b', 100, 20, 60, 60, '#3B82F6');
    const c = makeRect('c', 200, 20, 60, 60, '#10B981');
    project.pages[0].document.nodes = [a, b, c];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const first = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [a.id, b.id],
      mainCommandClient: client,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [first.imageNode.id, c.id],
      mainCommandClient: client,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Nested SVG is embedded directly as inline <svg> preserving all 3 original colors!
    expect(second.svgMarkup).toContain('#EF4444');
    expect(second.svgMarkup).toContain('#3B82F6');
    expect(second.svgMarkup).toContain('#10B981');
  });

  it('persists SVG asset via assetStore and resolves cleanly after hydration / reload', async () => {
    const project = createBlankProject('Reload Persistence');
    const r1 = makeRect('r1', 10, 10, 80, 80, '#F43F5E');
    const r2 = makeRect('r2', 110, 10, 80, 80, '#0EA5E9');
    project.pages[0].document.nodes = [r1, r2];

    const rendered = await renderSelectionToSvgAssetAndNode({
      doc: project.pages[0].document,
      selectedIds: [r1.id, r2.id],
    });
    project.assets = [rendered.asset];
    project.pages[0].document.nodes = [rendered.imageNode];

    await hydrateProjectAssetsToStore(project);
    const displayUrl = resolveAssetDisplayUrl(rendered.asset);
    expect(displayUrl).toBeTruthy();
    const extracted = decodeSvgFromAsset(rendered.asset);
    expect(extracted).toContain('<svg');
    expect(extracted).toContain('#F43F5E');
    expect(extracted).toContain('#0EA5E9');
  });

  it('integrates with Component Canvas: updates master component, saves SVG asset to BOTH main project and buffer, survives reopen & .flop export/import', async () => {
    const project = createInitialProject('Component Canvas SVG');
    const masterId = 'comp-card';
    const c1 = makeRect('card-bg', 20, 20, 160, 100, '#1E293B');
    const c2 = makeText('card-title', 40, 45, 120, 30, 'Card Title');
    const master: ComponentDefinition = {
      id: masterId,
      name: 'Hero Card',
      document: {
        id: 'doc-card',
        name: 'Hero Card',
        width: 240,
        height: 160,
        background: 'transparent',
        nodes: [c1, c2],
      },
      createdAt: '2026-11-28T00:00:00.000Z',
      updatedAt: '2026-11-28T00:00:00.000Z',
    };
    project.components = [master];

    const mainStore = createCanonicalEditorStore(createEditorState(project));
    const mainClient = createMainCanvasCommandClient(mainStore);
    const canonicalMaster = mainStore.getSnapshot().editorState.project.components[0];

    const initialBuffer = createComponentCanvasBufferProject(
      canonicalMaster,
      mainStore.getSnapshot().editorState.project.designTokens,
      mainStore.getSnapshot().editorState.project.assets,
    );
    const componentStore = createCanonicalEditorStore(createEditorState(initialBuffer), { workspace: 'component' });
    const componentClient = createComponentCanvasCommandClient(componentStore);
    const session = createComponentCanvasSyncSession(canonicalMaster);

    // Execute Render to SVG inside Component Canvas
    const outcome = await executeRenderSelectionToSvg({
      target: 'component',
      mainProject: mainStore.getSnapshot().editorState.project,
      componentProject: componentStore.getSnapshot().editorState.project,
      selectedIds: [c1.id, c2.id],
      mainCommandClient: mainClient,
      componentCommandClient: componentClient,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 1. Component Canvas buffer contains 1 ImageNode AND the SVG asset
    const compProjectAfter = componentStore.getSnapshot().editorState.project;
    const compDocAfter = getActiveDocument(compProjectAfter);
    expect(compDocAfter.nodes).toHaveLength(1);
    expect(compDocAfter.nodes[0].type).toBe('image');
    expect(compProjectAfter.assets.some((a) => a.id === outcome.asset.id && a.mimeType === 'image/svg+xml')).toBe(true);

    // 2. Main project assets ALREADY contain the exact same SVG asset
    const mainProjectAfterAsset = mainStore.getSnapshot().editorState.project;
    expect(mainProjectAfterAsset.assets.some((a) => a.id === outcome.asset.id && a.mimeType === 'image/svg+xml')).toBe(true);

    // 3. Reconcile Component Canvas buffer into canonical master component via Native Command Engine
    const currentMaster = mainProjectAfterAsset.components.find((c) => c.id === masterId)!;
    const syncAction = createComponentCanvasSyncAction(currentMaster, compDocAfter, session);
    expect(syncAction).not.toBeNull();
    const syncResult = mainClient.syncComponentDocument({
      componentId: syncAction!.componentId,
      document: syncAction!.document,
      updatedAt: syncAction!.updatedAt,
      expectedUpdatedAt: syncAction!.expectedUpdatedAt,
      expectedMasterDocument: syncAction!.expectedMasterDocument,
    });
    expect(syncResult.status).toBe('applied');

    const finalMainProject = mainStore.getSnapshot().editorState.project;
    const syncedMaster = finalMainProject.components.find((c) => c.id === masterId)!;
    expect(syncedMaster.document.nodes).toHaveLength(1);
    expect((syncedMaster.document.nodes[0] as ImageNode).assetId).toBe(outcome.asset.id);

    // 4. Reopening the master component in Component Canvas preserves the SVG asset (no missing asset!)
    const reopenedBuffer = createComponentCanvasBufferProject(
      syncedMaster,
      finalMainProject.designTokens,
      finalMainProject.assets,
    );
    const reopenedAsset = reopenedBuffer.assets.find((a) => a.id === outcome.asset.id);
    expect(reopenedAsset).toBeDefined();
    expect(resolveAssetDisplayUrl(reopenedAsset)).toBeTruthy();

    // 5. .flop JSON and .flop ZIP export/import round-trip preserve the SVG asset and component reference
    const flopJson = serializeProjectToFlopJson(finalMainProject);
    const parsedFromJson = requireValidProject(parseProjectJsonSafe(flopJson));
    expect(validateProject(parsedFromJson).ok).toBe(true);
    const jsonAsset = parsedFromJson.assets.find((a) => a.id === outcome.asset.id);
    expect(jsonAsset).toBeDefined();
    expect(jsonAsset!.mimeType).toBe('image/svg+xml');
    expect(decodeSvgFromAsset(jsonAsset!)).toContain('Card Title');
    const jsonMaster = parsedFromJson.components.find((c) => c.id === masterId)!;
    expect((jsonMaster.document.nodes[0] as ImageNode).assetId).toBe(outcome.asset.id);

    const flopZipBytes = serializeProjectToFlopZip(finalMainProject);
    const parsedFromZip = parseFlopZipArchive(flopZipBytes);
    const zipAsset = parsedFromZip.assets.find((a) => a.id === outcome.asset.id);
    expect(zipAsset).toBeDefined();
    expect(zipAsset!.mimeType).toBe('image/svg+xml');
    expect(decodeSvgFromAsset(zipAsset!)).toContain('Card Title');

    // 6. Component Canvas Undo restores both original layers; Redo restores the 1 SVG ImageNode
    const undoRes = componentClient.undo();
    expect(undoRes.status).toBe('applied');
    expect(getActiveDocument(componentStore.getSnapshot().editorState.project).nodes.map((n) => n.id)).toEqual([
      c1.id,
      c2.id,
    ]);

    const redoRes = componentClient.redo();
    expect(redoRes.status).toBe('applied');
    const redoneCompNodes = getActiveDocument(componentStore.getSnapshot().editorState.project).nodes;
    expect(redoneCompNodes).toHaveLength(1);
    expect(redoneCompNodes[0].id).toBe(outcome.imageNode.id);
  });

  it('supports atomic Undo and Redo on Main Canvas restoring all source layers and re-applying the 1 SVG object', async () => {
    const project = createBlankProject('Undo Redo');
    const a = makeRect('a', 10, 10, 50, 50, '#EF4444');
    const b = makeRect('b', 80, 10, 50, 50, '#3B82F6');
    const c = makeRect('c', 200, 10, 50, 50, '#22C55E');
    project.pages[0].document.nodes = [a, b, c];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const outcome = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [a.id, b.id],
      mainCommandClient: client,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.map((n) => n.id)).toEqual([
      outcome.imageNode.id,
      c.id,
    ]);

    // Single Undo step restores BOTH original layers in exact order
    const undoRes = client.undo();
    expect(undoRes.status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.map((n) => n.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);

    // Single Redo step restores the single SVG ImageNode AND its SVG asset
    const redoRes = client.redo();
    expect(redoRes.status).toBe('applied');
    const redoneProject = store.getSnapshot().editorState.project;
    expect(getActiveDocument(redoneProject).nodes.map((n) => n.id)).toEqual([outcome.imageNode.id, c.id]);
    expect(redoneProject.assets.some((asset) => asset.id === outcome.asset.id)).toBe(true);
  });

  it('is atomic on failure: keeps all original layers untouched when selection is invalid or SVG exceeds asset safety limit', async () => {
    const project = createBlankProject('Atomic Failure');
    const a = makeRect('only-one', 10, 10, 50, 50, '#EF4444');
    project.pages[0].document.nodes = [a];
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    // 1. Fewer than 2 selected layers => rejected cleanly, node untouched
    const tooFew = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: store.getSnapshot().editorState.project,
      selectedIds: [a.id],
      mainCommandClient: client,
    });
    expect(tooFew.ok).toBe(false);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.map((n) => n.id)).toEqual([a.id]);

    // 2. Oversized SVG payload exceeding MAX_BINARY_ASSET_BYTES => fails fast without deleting source layers
    const bigBase64 = 'A'.repeat(Math.ceil(MAX_BINARY_ASSET_BYTES * 0.6));
    const bigAsset1: AssetReference = {
      id: 'big-png-1',
      name: 'big-1.png',
      kind: 'image',
      mimeType: 'image/png',
      source: `data:image/png;base64,${bigBase64}`,
      width: 100,
      height: 100,
      byteLength: Math.ceil(MAX_BINARY_ASSET_BYTES * 0.45),
      createdAt: '2026-11-28T00:00:00.000Z',
    };
    const bigAsset2: AssetReference = {
      ...bigAsset1,
      id: 'big-png-2',
      name: 'big-2.png',
    };
    const bigImg1: ImageNode = {
      id: 'big-1',
      name: 'Big 1',
      type: 'image',
      assetId: bigAsset1.id,
      alt: 'Big 1',
      naturalWidth: 100,
      naturalHeight: 100,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      style: { fit: 'cover', radius: 0, stroke: 'none', strokeWidth: 0 },
    };
    const bigImg2: ImageNode = {
      ...bigImg1,
      id: 'big-2',
      name: 'Big 2',
      assetId: bigAsset2.id,
      x: 120,
    };
    const hugeProject = createBlankProject('Oversized');
    hugeProject.assets = [bigAsset1, bigAsset2];
    hugeProject.pages[0].document.nodes = [bigImg1, bigImg2];
    const hugeStore = createCanonicalEditorStore(createEditorState(hugeProject));
    const hugeClient = createMainCanvasCommandClient(hugeStore);

    const oversized = await executeRenderSelectionToSvg({
      target: 'main',
      mainProject: hugeStore.getSnapshot().editorState.project,
      selectedIds: [bigImg1.id, bigImg2.id],
      mainCommandClient: hugeClient,
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.error).toMatch(/exceeds|limit/i);
    }
    // Original layers are completely untouched!
    expect(getActiveDocument(hugeStore.getSnapshot().editorState.project).nodes.map((n) => n.id)).toEqual([
      bigImg1.id,
      bigImg2.id,
    ]);

    // Also verify ingestImageBytes enforces the exact limit directly
    await expect(
      ingestImageBytes({
        name: 'too-big.svg',
        mimeType: 'image/svg+xml',
        bytes: new Uint8Array(MAX_BINARY_ASSET_BYTES + 16),
      }),
    ).rejects.toThrow(/exceeds/i);
  });

  it('keeps Pathfinder, Interactive Shape Builder, and Color Blending intact and renders "Render to SVG" in Inspector UI', () => {
    const r1 = makeRect('pf-1', 0, 0, 100, 100, '#EF4444');
    const r2 = makeRect('pf-2', 50, 0, 100, 100, '#3B82F6');

    // Pathfinder Unite / Subtract / Minus Back / Intersect / Exclude / Divide
    expect(applyPathfinderOperation([r1, r2], 'unite', 'u1', { colorBlendMode: 'linear' })?.style.fills?.[0].type).toBe(
      'linear-gradient',
    );
    expect(applyPathfinderOperation([r1, r2], 'subtract', 's1')).not.toBeNull();
    expect(applyPathfinderOperation([r1, r2], 'minus-back', 'mb1')).not.toBeNull();
    expect(applyPathfinderOperation([r1, r2], 'intersect', 'i1')).not.toBeNull();
    expect(applyPathfinderOperation([r1, r2], 'exclude', 'e1')).not.toBeNull();
    let divSeq = 0;
    const divided = divideNodesWithPathfinder([r1, r2], () => `div-${++divSeq}`);
    expect(divided).not.toBeNull();
    expect(divided!.length).toBeGreaterThanOrEqual(2);

    // Interactive Shape Builder + Color Blending
    const { candidates, arrangement } = decomposeNodesForShapeBuilder([r1, r2]);
    let seq = 0;
    const sbMerged = applyShapeBuilderAction(
      candidates,
      arrangement,
      arrangement.faces.map((f) => f.id),
      'merge',
      () => `sb-${++seq}`,
      { colorBlendMode: 'hard' },
    );
    expect(sbMerged).toHaveLength(1);
    expect(sbMerged![0].style.fills?.[0].type).toBe('linear-gradient');

    // Legacy engine helper combineNodesIntoSingleObject remains exported and functional
    expect(combineNodesIntoSingleObject([r1, r2], 'legacy-c', { colorBlendMode: 'linear' })).not.toBeNull();

    // UI renders "Render to SVG" (and not "Combine into 1 Object") for both vector and mixed selections
    const noop = () => {};
    const mockActions: StudioVectorActions = {
      onPathfinder: noop,
      onBooleanOp: noop,
      onDividePathfinder: noop,
      onCombineSelection: noop,
      onOffsetPath: noop,
      onReversePath: noop,
      onConvertAllAnchors: noop,
      onUpdateParametricShape: noop,
      onFlip: noop,
      onRotateBy: noop,
      onResetRotation: noop,
      onAlign: noop,
      onDistribute: noop,
      onArrange: noop,
      onStepAndRepeat: noop,
      onSwapFillAndStroke: noop,
      onResetDefaultColors: noop,
      onApplySwatch: noop,
      onGroupSelection: noop,
      onUngroupSelection: noop,
      onCreateClippingMask: noop,
      onDeselect: noop,
      onInvertSelection: noop,
      onSelectSimilar: noop,
      onSetDrawMode: noop,
      onPermanentSubtractOutside: noop,
    };

    const t1 = makeText('t1', 0, 0, 120, 30, 'Title');
    const t2 = makeText('t2', 0, 40, 120, 30, 'Body');

    const multiText = collectVNodeText(
      InspectorMultiSelectionView({
        activeEditorId: 'main',
        selectedNodes: [t1, t2],
        effectiveSelectedCount: 2,
        onDuplicateSelection: noop,
        onCopySelection: noop,
        onConvertToPath: noop,
        onSimplifyPath: noop,
        studioActions: mockActions,
      }),
    );
    expect(multiText).toContain('Render to SVG (2)');
    expect(multiText).not.toContain('Combine into 1 Object');

    const shapingText = collectVNodeText(
      InspectorVectorShapingSection({
        activeEditorId: 'main',
        selectedNode: null,
        selectedNodes: [t1, t2],
        studioActions: mockActions,
        onConvertToPath: noop,
        onSimplifyPath: noop,
        onTogglePathClosed: noop,
        onChooseTool: noop,
      }),
    );
    expect(shapingText).toContain('Render to SVG');
    expect(shapingText).not.toContain('Combine into 1 Object');
  });
});

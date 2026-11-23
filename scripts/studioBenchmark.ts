import { createDocumentAstView } from '../src/core/document/ast';
import { createComponentInstance } from '../src/core/document/components';
import { createEmptyDocument, createInitialProject } from '../src/core/document/factory';
import { getEffectiveLayerStates, getLayerPanelRows, getLayerRenderOrder } from '../src/core/document/layers';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import type {
  ComponentDefinition,
  DesignNode,
  EllipseNode,
  FolioDocument,
  FolioPage,
  FolioProject,
  FrameNode,
  PathNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  applyPathfinderOperation,
  createPolygonPathPoints,
  createStarPathPoints,
  type PathfinderOperation,
} from '../src/core/document/vector';
import { extractToolOperationsFromTransition } from '../src/core/tools/operationContract';
import { getBounds } from '../src/engines/canvas/geometry';
import { evaluateToolOperationBatch } from '../src/engines/canvas/geometryEngine';
import { handTool } from '../src/engines/canvas/tools/hand';
import { scrubbyZoomTool } from '../src/engines/canvas/tools/scrubby-zoom';
import { selectTool } from '../src/engines/canvas/tools/select';
import type { CanvasToolContext, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import { serializeDocumentToSvgString } from '../src/app/visualExport';

export type BenchmarkScale = 'small' | 'medium' | 'large';

export interface BenchmarkConfig {
  scale: BenchmarkScale;
  pageCount: number;
  nodesPerPage: number;
  componentCount: number;
  warmupRuns: number;
  iterations: number;
}

export interface BenchmarkCaseResult {
  id: string;
  category: 'render' | 'pan' | 'zoom' | 'drag' | 'boolean';
  label: string;
  iterations: number;
  unitsPerIteration: number;
  minMs: number;
  medianMs: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  perUnitMedianMs: number;
  opsPerSec: number;
  frameBudgetMs: number;
  withinFrameBudget: boolean;
  details: string;
}

export interface StudioBenchmarkReport {
  timestamp: string;
  scale: BenchmarkScale;
  config: BenchmarkConfig;
  projectStats: {
    pageCount: number;
    componentCount: number;
    activePageNodeCount: number;
    totalNodeCount: number;
    projectValid: boolean;
  };
  results: BenchmarkCaseResult[];
}

export const BENCHMARK_PRESETS: Record<BenchmarkScale, BenchmarkConfig> = {
  small: {
    scale: 'small',
    pageCount: 2,
    nodesPerPage: 80,
    componentCount: 4,
    warmupRuns: 1,
    iterations: 5,
  },
  medium: {
    scale: 'medium',
    pageCount: 4,
    nodesPerPage: 320,
    componentCount: 10,
    warmupRuns: 2,
    iterations: 10,
  },
  large: {
    scale: 'large',
    pageCount: 5,
    nodesPerPage: 650,
    componentCount: 16,
    warmupRuns: 2,
    iterations: 12,
  },
};

const PALETTE = ['#3b82f6', '#6366f1', '#14b8a6', '#f97316', '#ec4899', '#eab308', '#84cc16', '#22c55e'];

function makeStarPathNode(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  spikes: number,
  innerRatio: number,
  style: { fill: string; stroke: string; strokeWidth: number },
  parentId?: string,
): PathNode {
  return {
    id,
    type: 'path',
    name,
    ...(parentId ? { parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: true,
    points: createStarPathPoints(width, height, spikes, innerRatio),
    style,
  };
}

function makePolygonPathNode(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  sides: number,
  style: { fill: string; stroke: string; strokeWidth: number },
  parentId?: string,
): PathNode {
  return {
    id,
    type: 'path',
    name,
    ...(parentId ? { parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: true,
    points: createPolygonPathPoints(width, height, sides),
    style,
  };
}

function createMasterComponent(index: number, timestamp: string): ComponentDefinition {
  const id = `bench-comp-${index}`;
  const name = `UI Card ${index + 1}`;
  const doc = createEmptyDocument(name, 260, 140);
  doc.id = `bench-comp-doc-${index}`;
  const bg: RectNode = {
    id: `${id}-bg`,
    type: 'rect',
    name: 'Card Surface',
    x: 0,
    y: 0,
    width: 260,
    height: 140,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: '#ffffff',
      stroke: PALETTE[index % PALETTE.length],
      strokeWidth: 2,
      radius: 12,
    },
  };
  const badge: EllipseNode = {
    id: `${id}-badge`,
    type: 'ellipse',
    name: 'Badge',
    x: 16,
    y: 16,
    width: 28,
    height: 28,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: PALETTE[(index + 2) % PALETTE.length],
      stroke: 'none',
      strokeWidth: 0,
    },
  };
  const title: TextNode = {
    id: `${id}-title`,
    type: 'text',
    name: 'Card Title',
    x: 56,
    y: 20,
    width: 184,
    height: 28,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: `Component Metric #${index + 1}`,
    style: {
      fill: '#111827',
      fontSize: 16,
      fontWeight: 600,
      fontFamily: 'Inter, system-ui, sans-serif',
      letterSpacing: 0,
      lineHeight: 1.35,
    },
  };
  doc.nodes = [bg, badge, title];
  return {
    id,
    name,
    document: doc,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildRealisticPageNodes(
  pageIndex: number,
  targetCount: number,
  components: readonly ComponentDefinition[],
): DesignNode[] {
  const nodes: DesignNode[] = [];
  const columns = 10;
  const cellW = 160;
  const cellH = 110;

  // Create top-level section frames for realistic hierarchy depth
  const sectionCount = Math.max(2, Math.min(8, Math.floor(targetCount / 40)));
  const frameIds: string[] = [];
  for (let s = 0; s < sectionCount && nodes.length < targetCount; s += 1) {
    const frameId = `p${pageIndex}-frame-${s}`;
    frameIds.push(frameId);
    const frame: FrameNode = {
      id: frameId,
      type: 'frame',
      name: `Section ${s + 1}`,
      x: 40 + (s % 2) * 860,
      y: 40 + Math.floor(s / 2) * 520,
      width: 820,
      height: 480,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      clipContent: s % 2 === 0,
      isSection: s % 2 === 1,
      style: {
        fill: '#f8fafc',
        stroke: '#cbd5e1',
        strokeWidth: 1,
        radius: 12,
      },
    };
    nodes.push(frame);
  }

  let idx = 0;
  while (nodes.length < targetCount) {
    const col = idx % columns;
    const row = Math.floor(idx / columns);
    const x = 60 + col * cellW;
    const y = 60 + row * cellH;
    const parentId = frameIds.length > 0 && idx % 3 === 0 ? frameIds[idx % frameIds.length] : undefined;
    const color = PALETTE[idx % PALETTE.length];
    const kind = idx % 6;

    if (kind === 0) {
      const rect: RectNode = {
        id: `p${pageIndex}-rect-${idx}`,
        type: 'rect',
        name: `Card ${idx}`,
        parentId,
        x,
        y,
        width: 128,
        height: 76,
        rotation: (idx % 4) * 5,
        opacity: 0.95,
        visible: true,
        locked: false,
        style: {
          fill: color,
          stroke: '#0f172a',
          strokeWidth: 1,
          radius: 8,
        },
      };
      nodes.push(rect);
    } else if (kind === 1) {
      const ellipse: EllipseNode = {
        id: `p${pageIndex}-ellipse-${idx}`,
        type: 'ellipse',
        name: `Avatar ${idx}`,
        parentId,
        x,
        y,
        width: 68,
        height: 68,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: {
          fill: color,
          stroke: '#ffffff',
          strokeWidth: 2,
        },
      };
      nodes.push(ellipse);
    } else if (kind === 2) {
      const text: TextNode = {
        id: `p${pageIndex}-text-${idx}`,
        type: 'text',
        name: `Heading ${idx}`,
        parentId,
        x,
        y,
        width: 140,
        height: 36,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: `Block ${idx} Label`,
        style: {
          fill: '#0f172a',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          letterSpacing: 0,
          lineHeight: 1.3,
        },
      };
      nodes.push(text);
    } else if (kind === 3) {
      nodes.push(
        makeStarPathNode(
          `p${pageIndex}-star-${idx}`,
          `Star ${idx}`,
          x,
          y,
          84,
          84,
          5 + (idx % 3),
          0.46,
          { fill: color, stroke: '#1e293b', strokeWidth: 1.5 },
          parentId,
        ),
      );
    } else if (kind === 4) {
      nodes.push(
        makePolygonPathNode(
          `p${pageIndex}-poly-${idx}`,
          `Hex ${idx}`,
          x,
          y,
          88,
          88,
          6,
          { fill: color, stroke: '#0f172a', strokeWidth: 1.5 },
          parentId,
        ),
      );
    } else if (components.length > 0) {
      const master = components[idx % components.length];
      const instance = createComponentInstance(master, x, y);
      nodes.push({
        ...instance,
        id: `p${pageIndex}-inst-${idx}`,
        name: `${master.name} #${idx}`,
        width: 148,
        height: 82,
      });
    } else {
      const fallback: RectNode = {
        id: `p${pageIndex}-fallback-${idx}`,
        type: 'rect',
        name: `Tile ${idx}`,
        x,
        y,
        width: 120,
        height: 70,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: color, stroke: 'none', strokeWidth: 0, radius: 6 },
      };
      nodes.push(fallback);
    }
    idx += 1;
  }

  return nodes;
}

export function createRealisticBenchmarkProject(config: BenchmarkConfig): FolioProject {
  const timestamp = '2026-01-15T12:00:00.000Z';
  const base = createInitialProject(`Benchmark Studio (${config.scale})`);
  base.metadata.createdAt = timestamp;
  base.metadata.updatedAt = timestamp;

  const components: ComponentDefinition[] = [];
  for (let c = 0; c < config.componentCount; c += 1) {
    components.push(createMasterComponent(c, timestamp));
  }

  const pages: FolioPage[] = [];
  for (let p = 0; p < config.pageCount; p += 1) {
    const pageName = p === 0 ? 'Main Dashboard' : `Screen ${p + 1}`;
    const route = p === 0 ? '/' : `/screen-${p + 1}`;
    const pageNodesCount = p === 0 ? config.nodesPerPage : Math.max(24, Math.floor(config.nodesPerPage * 0.4));
    const doc: FolioDocument = {
      ...createEmptyDocument(pageName, 1920, 1440),
      id: `bench-doc-${p}`,
      background: '#f5f2ec',
      nodes: buildRealisticPageNodes(p, pageNodesCount, components),
    };
    pages.push({
      id: `bench-page-${p}`,
      name: pageName,
      route,
      document: doc,
    });
  }

  return {
    ...base,
    activePageId: pages[0].id,
    pages,
    components,
  };
}

function makePointer(overrides: Partial<CanvasToolPointerInput> = {}): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point: { x: 100, y: 100 },
    clientX: 100,
    clientY: 100,
    viewportAnchor: { x: 720, y: 450 },
    targetNodeId: null,
    resizeHandle: null,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

function makeToolContext(
  doc: FolioDocument,
  selectedNodeIds: string[],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const canvasNodes = doc.nodes.filter((node) => node.onCanvas !== false);
  const selectableNodes = canvasNodes.filter((node) => node.visible && !node.locked);
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = canvasNodes.filter((node) => selectedSet.has(node.id));
  const otherNodes = selectableNodes.filter((node) => !selectedSet.has(node.id));
  return {
    document: doc,
    canvasNodes,
    selectableNodes,
    otherNodes,
    selectedNodeIds,
    selectedNodes,
    selectionBounds: getBounds(selectedNodes),
    zoom: 1,
    canvasUnitsPerPixel: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1440,
    session: null,
    workspace: 'main',
    ...overrides,
  };
}

function measureCase(
  meta: {
    id: string;
    category: BenchmarkCaseResult['category'];
    label: string;
    unitsPerIteration: number;
    frameBudgetMs: number;
    details: string;
  },
  warmupRuns: number,
  iterations: number,
  fn: () => void,
): BenchmarkCaseResult {
  for (let w = 0; w < warmupRuns; w += 1) {
    fn();
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted[p95Index] ?? maxMs;
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  const perUnitMedianMs = medianMs / Math.max(1, meta.unitsPerIteration);
  const opsPerSec = meanMs > 0 ? 1000 / meanMs : 0;

  return {
    ...meta,
    iterations,
    minMs: round3(minMs),
    medianMs: round3(medianMs),
    meanMs: round3(meanMs),
    p95Ms: round3(p95Ms),
    maxMs: round3(maxMs),
    perUnitMedianMs: round3(perUnitMedianMs),
    opsPerSec: Math.round(opsPerSec * 10) / 10,
    withinFrameBudget: perUnitMedianMs <= meta.frameBudgetMs,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function runStudioBenchmark(overrides: Partial<BenchmarkConfig> = {}): StudioBenchmarkReport {
  const scale: BenchmarkScale = overrides.scale ?? 'medium';
  const preset = BENCHMARK_PRESETS[scale];
  const config: BenchmarkConfig = {
    ...preset,
    ...overrides,
    scale,
  };

  const project = createRealisticBenchmarkProject(config);
  const validation = validateProject(project);
  const activePage = getActivePage(project);
  const activeDoc = activePage.document;
  const totalNodeCount =
    project.pages.reduce((sum, page) => sum + page.document.nodes.length, 0) +
    project.components.reduce((sum, comp) => sum + comp.document.nodes.length, 0);

  const results: BenchmarkCaseResult[] = [];

  // 1. Rendering: Layer Tree + AST Indexing + Full SVG Serialization (with instances, masks, paths)
  let lastSvgLength = 0;
  results.push(
    measureCase(
      {
        id: 'render:svg-and-layer-tree',
        category: 'render',
        label: `Full scene render (${activeDoc.nodes.length} nodes -> AST + Layers + SVG)`,
        unitsPerIteration: 1,
        frameBudgetMs: 16.67,
        details: `${activeDoc.nodes.length} nodes, ${project.components.length} components`,
      },
      config.warmupRuns,
      config.iterations,
      () => {
        getEffectiveLayerStates(activeDoc.nodes);
        getLayerPanelRows(activeDoc.nodes, []);
        getLayerRenderOrder(activeDoc.nodes);
        createDocumentAstView(activeDoc, {
          projectId: project.metadata.id,
          owner: { kind: 'page', id: activePage.id },
          documentId: activeDoc.id,
        });
        const svg = serializeDocumentToSvgString(activeDoc, project.components, { title: activeDoc.name });
        lastSvgLength = svg.length;
      },
    ),
  );
  if (lastSvgLength === 0) {
    throw new Error('Render benchmark produced empty SVG output.');
  }

  // Shared store + client + executor for interactive benchmarks
  const store = createCanonicalEditorStore(createEditorState(project));
  const commandClient = createMainCanvasCommandClient(store);
  let viewportPan = { x: 0, y: 0 };
  let viewportZoom = 1;
  const executor = createToolOperationExecutor({
    workspace: 'main',
    commandClient,
    shell: {
      onSelectionChange: (nodeIds) => {
        commandClient.selectNodes(nodeIds);
      },
      onPanChange: (nextPan) => {
        viewportPan = nextPan;
      },
      onZoomChange: (nextZoom) => {
        viewportZoom = nextZoom;
      },
    },
  });

  // 2. Pan Interaction: 60 pointer-move frames through Hand Tool -> Contract -> Geometry Engine -> Executor
  const panFrames = 60;
  results.push(
    measureCase(
      {
        id: 'interaction:pan-60-frames',
        category: 'pan',
        label: `Hand pan gesture (${panFrames} frames @ ${activeDoc.nodes.length} nodes)`,
        unitsPerIteration: panFrames,
        frameBudgetMs: 16.67,
        details: `${panFrames} frames/gesture`,
      },
      config.warmupRuns,
      config.iterations,
      () => {
        const doc = getActiveDocument(store.getSnapshot().editorState.project);
        let ctx = makeToolContext(doc, [], { pan: viewportPan, zoom: viewportZoom });
        const down = handTool.onPointerDown(makePointer({ clientX: 400, clientY: 300 }), ctx);
        ctx = { ...ctx, session: down.session ?? null };

        for (let frame = 1; frame <= panFrames; frame += 1) {
          const move = handTool.onPointerMove(
            makePointer({ clientX: 400 + frame * 4, clientY: 300 + frame * 2 }),
            ctx,
          );
          const ops = extractToolOperationsFromTransition('hand', 'main', move);
          const evaluated = evaluateToolOperationBatch(ops, { document: doc, selectedNodeIds: [] });
          executor.executeBatch(evaluated.ready);
        }

        handTool.onPointerUp(
          makePointer({ clientX: 400 + panFrames * 4, clientY: 300 + panFrames * 2 }),
          ctx,
        );
      },
    ),
  );

  // 3. Zoom Interaction: 40 pointer-move frames through Scrubby Zoom -> Contract -> Geometry Engine -> Executor
  const zoomFrames = 40;
  results.push(
    measureCase(
      {
        id: 'interaction:zoom-40-frames',
        category: 'zoom',
        label: `Scrubby zoom gesture (${zoomFrames} frames @ ${activeDoc.nodes.length} nodes)`,
        unitsPerIteration: zoomFrames,
        frameBudgetMs: 16.67,
        details: `${zoomFrames} frames/gesture`,
      },
      config.warmupRuns,
      config.iterations,
      () => {
        const doc = getActiveDocument(store.getSnapshot().editorState.project);
        let ctx = makeToolContext(doc, [], { pan: { x: 0, y: 0 }, zoom: 1 });
        const down = scrubbyZoomTool.onPointerDown(makePointer({ clientX: 600, clientY: 400 }), ctx);
        ctx = { ...ctx, session: down.session ?? null };

        for (let frame = 1; frame <= zoomFrames; frame += 1) {
          const move = scrubbyZoomTool.onPointerMove(
            makePointer({ clientX: 600 + frame * 5, clientY: 400 }),
            ctx,
          );
          const ops = extractToolOperationsFromTransition('scrubby-zoom', 'main', move);
          const evaluated = evaluateToolOperationBatch(ops, { document: doc, selectedNodeIds: [] });
          executor.executeBatch(evaluated.ready);
        }

        scrubbyZoomTool.onPointerUp(makePointer({ clientX: 600 + zoomFrames * 5, clientY: 400 }), ctx);
      },
    ),
  );

  // 4A. Single-Node Drag Preview (30 frames with snapping) + Native Command Commit + Undo
  const draggableCandidates = activeDoc.nodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'path',
  );
  const singleTarget = draggableCandidates[0];
  const dragFrames = 30;

  results.push(
    measureCase(
      {
        id: 'interaction:drag-single-commit',
        category: 'drag',
        label: `Single-node drag (${dragFrames} snap frames + Native Command commit + Undo)`,
        unitsPerIteration: dragFrames,
        frameBudgetMs: 16.67,
        details: `Snapping against ${activeDoc.nodes.length - 1} siblings`,
      },
      config.warmupRuns,
      config.iterations,
      () => {
        const doc = getActiveDocument(store.getSnapshot().editorState.project);
        const liveTarget = doc.nodes.find((n) => n.id === singleTarget.id)!;
        let ctx = makeToolContext(doc, [liveTarget.id]);
        const startPt = { x: liveTarget.x + 12, y: liveTarget.y + 12 };
        const down = selectTool.onPointerDown(
          makePointer({ point: startPt, targetNodeId: liveTarget.id }),
          ctx,
        );
        ctx = { ...ctx, session: down.session ?? null };

        for (let frame = 1; frame <= dragFrames; frame += 1) {
          const move = selectTool.onPointerMove(
            makePointer({ point: { x: startPt.x + frame * 3, y: startPt.y + frame * 2 }, targetNodeId: liveTarget.id }),
            ctx,
          );
          if (move.session !== undefined) ctx = { ...ctx, session: move.session };
        }

        const up = selectTool.onPointerUp(
          makePointer({ point: { x: startPt.x + dragFrames * 3, y: startPt.y + dragFrames * 2 }, targetNodeId: liveTarget.id }),
          ctx,
        );
        const ops = extractToolOperationsFromTransition('select', 'main', up);
        const evaluated = evaluateToolOperationBatch(ops, { document: doc, selectedNodeIds: [liveTarget.id] });
        executor.executeBatch(evaluated.ready);
        commandClient.undo('Revert benchmark drag');
      },
    ),
  );

  // 4B. Multi-Node Batch Drag (25 nodes) + Native Command node.update-many + Undo
  const multiTargets = draggableCandidates.slice(0, Math.min(25, draggableCandidates.length));
  const multiIds = multiTargets.map((n) => n.id);
  const multiAnchor = multiTargets[0];

  results.push(
    measureCase(
      {
        id: 'interaction:drag-multi-commit',
        category: 'drag',
        label: `Multi-node drag (${multiIds.length} nodes, ${dragFrames} frames + node.update-many + Undo)`,
        unitsPerIteration: dragFrames,
        frameBudgetMs: 16.67,
        details: `${multiIds.length} selected nodes`,
      },
      config.warmupRuns,
      config.iterations,
      () => {
        const doc = getActiveDocument(store.getSnapshot().editorState.project);
        const liveAnchor = doc.nodes.find((n) => n.id === multiAnchor.id)!;
        let ctx = makeToolContext(doc, multiIds);
        const startPt = { x: liveAnchor.x + 10, y: liveAnchor.y + 10 };
        const down = selectTool.onPointerDown(
          makePointer({ point: startPt, targetNodeId: liveAnchor.id }),
          ctx,
        );
        ctx = { ...ctx, session: down.session ?? null };

        for (let frame = 1; frame <= dragFrames; frame += 1) {
          const move = selectTool.onPointerMove(
            makePointer({ point: { x: startPt.x + frame * 2, y: startPt.y + frame * 2 }, targetNodeId: liveAnchor.id }),
            ctx,
          );
          if (move.session !== undefined) ctx = { ...ctx, session: move.session };
        }

        const up = selectTool.onPointerUp(
          makePointer({ point: { x: startPt.x + dragFrames * 2, y: startPt.y + dragFrames * 2 }, targetNodeId: liveAnchor.id }),
          ctx,
        );
        const ops = extractToolOperationsFromTransition('select', 'main', up);
        const evaluated = evaluateToolOperationBatch(ops, { document: doc, selectedNodeIds: multiIds });
        executor.executeBatch(evaluated.ready);
        commandClient.undo('Revert multi-drag');
      },
    ),
  );

  // 5. Planar Boolean / Pathfinder Operations (unite, subtract, intersect, exclude) + Native Command commit
  const starA: PathNode = makeStarPathNode(
    'bench-bool-star-a',
    'Star A',
    120,
    120,
    220,
    220,
    7,
    0.45,
    { fill: '#3b82f6', stroke: '#0f172a', strokeWidth: 2 },
  );
  const polyB: PathNode = makePolygonPathNode(
    'bench-bool-poly-b',
    'Hex B',
    210,
    160,
    210,
    210,
    8,
    { fill: '#ec4899', stroke: '#0f172a', strokeWidth: 2 },
  );
  const roundedC: RectNode = {
    id: 'bench-bool-rect-c',
    type: 'rect',
    name: 'Rounded C',
    x: 170,
    y: 190,
    width: 190,
    height: 150,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fill: '#14b8a6', stroke: '#0f172a', strokeWidth: 2, radius: 24 },
  };
  const ellipseD: EllipseNode = {
    id: 'bench-bool-ellipse-d',
    type: 'ellipse',
    name: 'Ellipse D',
    x: 240,
    y: 140,
    width: 180,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fill: '#f97316', stroke: '#0f172a', strokeWidth: 2 },
  };

  // Seed boolean operand nodes once in the canonical store for real command-commit testing
  commandClient.createNodes([starA, polyB], 'Seed boolean pair');

  const booleanOps: PathfinderOperation[] = ['unite', 'subtract', 'intersect', 'exclude'];
  for (const op of booleanOps) {
    let generatedContours = 0;
    results.push(
      measureCase(
        {
          id: `boolean:${op}`,
          category: 'boolean',
          label: `Pathfinder ${op} (7-pt Star + 8-gon + node.replace-many + Undo)`,
          unitsPerIteration: 1,
          frameBudgetMs: 16.67,
          details: 'Planar Bezier boolean + Native Command commit',
        },
        config.warmupRuns,
        config.iterations,
        () => {
          const resultNode = applyPathfinderOperation([starA, polyB], op, `bench-bool-out-${op}`);
          if (!resultNode) {
            throw new Error(`Pathfinder ${op} unexpectedly returned null.`);
          }
          generatedContours = 1 + (resultNode.subpaths?.length ?? 0);
          const commit = commandClient.replaceNodes(
            [starA.id, polyB.id],
            [resultNode],
            `Benchmark Pathfinder ${op}`,
          );
          if (commit.status !== 'applied') {
            throw new Error(`Pathfinder ${op} command failed: ${commit.message}`);
          }
          commandClient.undo(`Revert Pathfinder ${op}`);
        },
      ),
    );
    if (generatedContours < 1) {
      throw new Error(`Pathfinder ${op} generated zero contours.`);
    }
  }

  // Compound 4-shape multi-operand Pathfinder Unite (realistic complex illustration boolean)
  results.push(
    measureCase(
      {
        id: 'boolean:compound-4-shapes',
        category: 'boolean',
        label: 'Pathfinder compound unite (4 overlapping shapes: Star + 8-gon + RoundedRect + Ellipse)',
        unitsPerIteration: 1,
        frameBudgetMs: 50,
        details: '4-operand planar boolean union',
      },
      config.warmupRuns,
      config.iterations,
      () => {
        const union = applyPathfinderOperation([starA, polyB, roundedC, ellipseD], 'unite', 'bench-bool-compound');
        if (!union || union.points.length < 3) {
          throw new Error('Compound 4-shape Pathfinder unite produced invalid geometry.');
        }
      },
    ),
  );

  return {
    timestamp: new Date().toISOString(),
    scale,
    config,
    projectStats: {
      pageCount: project.pages.length,
      componentCount: project.components.length,
      activePageNodeCount: activeDoc.nodes.length,
      totalNodeCount,
      projectValid: validation.ok,
    },
    results,
  };
}

export function formatBenchmarkReport(report: StudioBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`FOLIO Studio Performance Benchmark (${report.scale.toUpperCase()})`);
  lines.push(
    `Project: ${report.projectStats.pageCount} pages · ${report.projectStats.activePageNodeCount} active-page nodes · ` +
    `${report.projectStats.totalNodeCount} total nodes · ${report.projectStats.componentCount} master components · valid=${report.projectStats.projectValid}`,
  );
  lines.push('─'.repeat(118));
  lines.push(
    `${'Benchmark'.padEnd(56)} ${'Median'.padStart(10)} ${'P95'.padStart(10)} ${'Per-Frame'.padStart(11)} ${'Ops/s'.padStart(9)} ${'Budget'.padStart(12)}`,
  );
  lines.push('─'.repeat(118));

  for (const row of report.results) {
    const label = row.label.length > 55 ? `${row.label.slice(0, 52)}...` : row.label;
    const medianStr = `${row.medianMs.toFixed(2)} ms`;
    const p95Str = `${row.p95Ms.toFixed(2)} ms`;
    const perFrameStr = `${row.perUnitMedianMs.toFixed(3)} ms`;
    const opsStr = `${row.opsPerSec.toFixed(1)}`;
    const budgetStr = row.withinFrameBudget ? `PASS <=${row.frameBudgetMs}ms` : `OVER >${row.frameBudgetMs}ms`;
    lines.push(
      `${label.padEnd(56)} ${medianStr.padStart(10)} ${p95Str.padStart(10)} ${perFrameStr.padStart(11)} ${opsStr.padStart(9)} ${budgetStr.padStart(12)}`,
    );
  }

  lines.push('─'.repeat(118));
  return lines.join('\n');
}

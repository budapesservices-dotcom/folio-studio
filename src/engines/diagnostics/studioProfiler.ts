import { createDocumentAstView } from '../../core/document/ast';
import { getLayerPanelRows } from '../../core/document/layers';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type { DesignNode, FolioProject } from '../../core/document/types';
import { validateProjectIncremental } from '../../core/document/validation';
import {
  getComputeKernelRuntimeStatus,
  getComputeKernels,
  type ComputeKernelRuntimeStatus,
} from '../../core/kernels';
import { packSceneToGpuBatches } from '../canvas/gpu/scenePacker';
import { GPU_HYBRID_AUTO_THRESHOLD } from '../canvas/gpu/types';
import { auditPageAccessibility } from '../codegen/a11yAudit';
import { compileFolioProject } from '../codegen';
import { computeAutoLayoutNodes } from '../layout/autoLayout';
import { validateProjectLogicGraphs } from '../prototype/validator';

export const SPATIAL_CULLING_THRESHOLD = 250;

export type DiagnosticStatus = 'healthy' | 'warning' | 'error';

export interface ProjectHealthCheck {
  readonly id: string;
  readonly label: string;
  readonly status: DiagnosticStatus;
  readonly summary: string;
}

export interface NodeTypeBreakdown {
  readonly frame: number;
  readonly rect: number;
  readonly ellipse: number;
  readonly path: number;
  readonly text: number;
  readonly image: number;
  readonly group: number;
  readonly componentInstance: number;
}

export interface ProjectHealthSnapshot {
  readonly projectName: string;
  readonly activePageId: string;
  readonly activePageName: string;
  readonly pageCount: number;
  readonly totalProjectNodes: number;
  readonly activePageNodeCount: number;
  readonly maxNestingDepth: number;
  readonly componentMasterCount: number;
  readonly componentInstanceCount: number;
  readonly designTokenCount: number;
  readonly themeCount: number;
  readonly logicGraphCount: number;
  readonly animationClipCount: number;
  readonly customCodeModuleCount: number;
  readonly spatialCullingActive: boolean;
  readonly spatialCullingThreshold: number;
  readonly historyUndoCount: number;
  readonly historyRedoCount: number;
  readonly a11yScore: number;
  readonly computeKernels: ComputeKernelRuntimeStatus;
  readonly nodeBreakdown: NodeTypeBreakdown;
  readonly checks: readonly ProjectHealthCheck[];
}

export interface SceneProfileStageResult {
  readonly id: string;
  readonly label: string;
  readonly durationMs: number;
  readonly detail: string;
}

export interface LiveSceneProfileResult {
  readonly ranAtIso: string;
  readonly totalDurationMs: number;
  readonly rating: 'fast' | 'moderate' | 'heavy';
  readonly stages: readonly SceneProfileStageResult[];
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function roundMs(ms: number): number {
  return Math.round(Math.max(0, ms) * 100) / 100;
}

function computeMaxNestingDepth(nodes: readonly DesignNode[]): number {
  const parentById = new Map<string, string | null | undefined>();
  for (const node of nodes) {
    parentById.set(node.id, node.parentId);
  }
  let maxDepth = 0;
  for (const node of nodes) {
    let depth = 1;
    let current = node.parentId;
    const seen = new Set<string>([node.id]);
    while (current && !seen.has(current) && depth < 64) {
      seen.add(current);
      depth += 1;
      current = parentById.get(current);
    }
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
}

function countNodeBreakdown(nodes: readonly DesignNode[]): NodeTypeBreakdown {
  let frame = 0;
  let rect = 0;
  let ellipse = 0;
  let path = 0;
  let text = 0;
  let image = 0;
  let group = 0;
  let componentInstance = 0;

  for (const node of nodes) {
    switch (node.type) {
      case 'frame':
        frame += 1;
        break;
      case 'rect':
        rect += 1;
        break;
      case 'ellipse':
        ellipse += 1;
        break;
      case 'path':
        path += 1;
        break;
      case 'text':
        text += 1;
        break;
      case 'image':
        image += 1;
        break;
      case 'group':
        group += 1;
        break;
      case 'component-instance':
        componentInstance += 1;
        break;
    }
  }

  return { frame, rect, ellipse, path, text, image, group, componentInstance };
}

/**
 * Computes a deterministic structural & cross-studio health snapshot for a FolioProject.
 */
export function analyzeProjectHealth(
  project: FolioProject,
  options: {
    activePageId?: string;
    historyUndoCount?: number;
    historyRedoCount?: number;
  } = {},
): ProjectHealthSnapshot {
  const activePage =
    (options.activePageId ? project.pages.find((page) => page.id === options.activePageId) : undefined)
    ?? getActivePage(project);

  const activeNodes = activePage.document.nodes;
  const totalProjectNodes = project.pages.reduce((sum, page) => sum + page.document.nodes.length, 0);
  const componentInstanceCount = project.pages.reduce(
    (sum, page) => sum + page.document.nodes.filter((n) => n.type === 'component-instance').length,
    0,
  );
  const designTokens = getProjectDesignTokens(project);
  const nodeBreakdown = countNodeBreakdown(activeNodes);
  const maxNestingDepth = computeMaxNestingDepth(activeNodes);

  const validationResult = validateProjectIncremental(null, project);
  const logicReport = validateProjectLogicGraphs(project);
  const logicErrors = logicReport.errors;
  const logicWarnings = logicReport.warnings;

  const a11y = auditPageAccessibility(project, activePage);

  // Check orphan animation target nodes across all pages
  const nodeIdsByPage = new Map<string, Set<string>>();
  for (const page of project.pages) {
    nodeIdsByPage.set(page.id, new Set(page.document.nodes.map((node) => node.id)));
  }
  let orphanAnimationTracks = 0;
  for (const clip of project.animations ?? []) {
    const validIds = nodeIdsByPage.get(clip.pageId);
    for (const track of clip.tracks) {
      if (!validIds || !validIds.has(track.targetNodeId)) {
        orphanAnimationTracks += 1;
      }
    }
  }

  const computeKernels = getComputeKernelRuntimeStatus();

  const checks: ProjectHealthCheck[] = [
    {
      id: 'schema-validation',
      label: '.flop v2 Schema & Referential Integrity',
      status: validationResult.ok ? 'healthy' : 'error',
      summary: validationResult.ok
        ? 'All pages, components, tokens, and references passed incremental validation.'
        : `Schema validation failed: ${validationResult.error ?? 'Invalid project structure.'}`,
    },
    {
      id: 'accessibility-score',
      label: `WCAG 2.1 AA Accessibility (${activePage.name})`,
      status: a11y.errorCount > 0 ? 'error' : a11y.warningCount > 0 ? 'warning' : 'healthy',
      summary:
        a11y.issues.length === 0
          ? `Score 100/100 · ${a11y.passedChecks} checks passed.`
          : `Score ${a11y.score}/100 · ${a11y.errorCount} error(s), ${a11y.warningCount} warning(s), ${a11y.infoCount} info.`,
    },
    {
      id: 'node-logic-health',
      label: 'Node Logic Graph Semantics',
      status: logicErrors.length > 0 ? 'error' : logicWarnings.length > 0 ? 'warning' : 'healthy',
      summary:
        (project.logicGraphs?.length ?? 0) === 0
          ? 'No logic graphs authored yet.'
          : logicErrors.length === 0 && logicWarnings.length === 0
            ? `${project.logicGraphs.length} graph(s) verified with 0 semantic issues.`
            : `${logicErrors.length} error(s), ${logicWarnings.length} warning(s) across ${project.logicGraphs.length} graph(s).`,
    },
    {
      id: 'motion-health',
      label: 'Motion & Keyframe Targets',
      status: orphanAnimationTracks > 0 ? 'warning' : 'healthy',
      summary:
        (project.animations?.length ?? 0) === 0
          ? 'No animation clips authored yet.'
          : orphanAnimationTracks === 0
            ? `${project.animations!.length} clip(s) cleanly bound to existing AST nodes.`
            : `${orphanAnimationTracks} animation track(s) reference missing layer IDs.`,
    },
    {
      id: 'spatial-culling',
      label: 'Canvas Viewport Spatial Culling & Hybrid GPU',
      status: 'healthy',
      summary:
        activeNodes.length >= GPU_HYBRID_AUTO_THRESHOLD
          ? `Active (${activeNodes.length} >= ${GPU_HYBRID_AUTO_THRESHOLD} nodes · Hybrid GPU SDF + 512px Tile Cache).`
          : `Standby (${activeNodes.length} / ${GPU_HYBRID_AUTO_THRESHOLD} node auto-GPU threshold).`,
    },
    {
      id: 'compute-kernels',
      label: 'WASM Spatial & Worker Compute Engine',
      status: 'healthy',
      summary: `Spatial: ${computeKernels.spatialBackend.toUpperCase()} · Worker: ${computeKernels.workerActive ? 'Active' : computeKernels.workerSupported ? 'Standby' : 'Sync Fallback'} · WASM: ${computeKernels.wasmSupported ? 'Supported' : 'Fallback'}.`,
    },
  ];

  return {
    projectName: project.metadata.name,
    activePageId: activePage.id,
    activePageName: activePage.name,
    pageCount: project.pages.length,
    totalProjectNodes,
    activePageNodeCount: activeNodes.length,
    maxNestingDepth,
    componentMasterCount: project.components.length,
    componentInstanceCount,
    designTokenCount: designTokens.tokens.length,
    themeCount: designTokens.themes.length,
    logicGraphCount: project.logicGraphs.length,
    animationClipCount: project.animations?.length ?? 0,
    customCodeModuleCount: project.codeModules?.length ?? 0,
    spatialCullingActive: activeNodes.length >= SPATIAL_CULLING_THRESHOLD,
    spatialCullingThreshold: SPATIAL_CULLING_THRESHOLD,
    historyUndoCount: options.historyUndoCount ?? 0,
    historyRedoCount: options.historyRedoCount ?? 0,
    a11yScore: a11y.score,
    computeKernels,
    nodeBreakdown,
    checks,
  };
}

/**
 * Executes a non-destructive on-demand micro-profile across Folio's core runtime engines
 * for the active page and returns deterministic stage timings in milliseconds.
 */
export function runLiveSceneProfile(
  project: FolioProject,
  activePageId?: string,
): LiveSceneProfileResult {
  const activePage =
    (activePageId ? project.pages.find((page) => page.id === activePageId) : undefined)
    ?? getActivePage(project);
  const doc = activePage.document;

  const stages: SceneProfileStageResult[] = [];

  const measure = (id: string, label: string, fn: () => string) => {
    const start = nowMs();
    const detail = fn();
    const durationMs = roundMs(nowMs() - start);
    stages.push({ id, label, durationMs, detail });
  };

  measure('ast-view', 'AST Document View', () => {
    const view = createDocumentAstView(doc, {
      projectId: project.metadata.id,
      owner: { kind: 'page', id: activePage.id },
      documentId: doc.id,
    });
    return `${view.getPaintOrder().length} indexed nodes`;
  });

  measure('layer-tree', 'Layer Tree Derivation', () => {
    const rows = getLayerPanelRows(doc.nodes, []);
    return `${rows.length} flattened rows`;
  });

  measure('auto-layout', 'Auto-Layout Solver', () => {
    const solved = computeAutoLayoutNodes(doc.nodes, { breakpoint: 'desktop' });
    return `${solved.length} nodes solved`;
  });

  measure('spatial-index', 'FlatGrid Spatial Index', () => {
    const kernel = getComputeKernels().spatial;
    const index = kernel.buildIndex(
      doc.nodes.map((node, zIndex) => ({
        id: node.id,
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.width,
        maxY: node.y + node.height,
        zIndex,
      })),
    );
    const hits = index.queryRect({
      minX: 0,
      minY: 0,
      maxX: doc.width,
      maxY: doc.height,
    });
    return `${hits.length} hits (${kernel.backend})`;
  });

  measure('gpu-scene-pack', 'Hybrid GPU Batch Packer', () => {
    const packed = packSceneToGpuBatches(doc.nodes, {
      viewportRect: { x: 0, y: 0, width: doc.width, height: doc.height },
    });
    const kb = Math.round((packed.instanceData.byteLength / 1024) * 10) / 10;
    return `${packed.instanceCount} GPU quads (${kb} KB) · ${packed.richNodes.length} tiled`;
  });

  measure('a11y-audit', 'WCAG 2.1 AA Audit', () => {
    const report = auditPageAccessibility(project, activePage);
    return `Score ${report.score}/100 (${report.issues.length} findings)`;
  });

  measure('compile-html', 'HTML / CSS Compiler', () => {
    const output = compileFolioProject(project, {
      target: 'html-css',
      pageId: activePage.id,
      includeAllPages: true,
    });
    return `${output.files.length} files · ${output.summary.mappedNodeCount} mapped`;
  });

  measure('compile-react', 'React TSX Compiler', () => {
    const output = compileFolioProject(project, {
      target: 'react',
      pageId: activePage.id,
      includeAllPages: true,
    });
    return `${output.files.length} files · ${project.components.length} components`;
  });

  measure('incremental-validation', 'Incremental Project Validation', () => {
    const res = validateProjectIncremental(null, project);
    return res.ok ? 'Valid (.flop v2)' : (res.error ?? 'Validation error');
  });

  const totalDurationMs = roundMs(stages.reduce((sum, stage) => sum + stage.durationMs, 0));
  const rating: LiveSceneProfileResult['rating'] =
    totalDurationMs <= 25 ? 'fast' : totalDurationMs <= 80 ? 'moderate' : 'heavy';

  return {
    ranAtIso: new Date().toISOString(),
    totalDurationMs,
    rating,
    stages,
  };
}

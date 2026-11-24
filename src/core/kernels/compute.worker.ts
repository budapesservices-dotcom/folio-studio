/**
 * Folio Dedicated Compute Web Worker.
 *
 * Executes heavy CPU kernels off the main UI thread so 120Hz canvas pan/zoom/drag
 * never drops frames:
 *   1. WASM-accelerated FlatGridSpatialIndex build & viewport/snap queries
 *   2. Planar Boolean / Pathfinder & Shape Builder decomposition
 *   3. Responsive Auto-Layout solver
 *   4. WCAG 2.1 AA Accessibility Audit
 */

import type {
  BreakpointId,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  PathNode,
} from '../document/types';
import { getActivePage } from '../document/project';
import {
  applyPathfinderOperation,
  decomposeNodesForShapeBuilder,
  type PathfinderOperation,
  type PlanarArrangement,
} from '../document/vector';
import { computeAutoLayoutNodes } from '../../engines/layout/autoLayout';
import { auditPageAccessibility, type A11yAuditReport } from '../../engines/codegen/a11yAudit';
import { FlatGridSpatialIndex } from './spatialIndex';
import { createWasmSpatialIndexKernel } from './wasmSpatialKernel';
import type {
  SpatialBoundsEntry,
  SpatialIndexHandle,
  SpatialQueryRect,
} from './types';

export type ComputeWorkerRequest =
  | {
      readonly id: number;
      readonly type: 'spatial.sync';
      readonly entries: readonly SpatialBoundsEntry[];
      readonly cellSize?: number;
    }
  | {
      readonly id: number;
      readonly type: 'spatial.queryRect';
      readonly rect: SpatialQueryRect;
    }
  | {
      readonly id: number;
      readonly type: 'spatial.querySnap';
      readonly rect: SpatialQueryRect;
      readonly margin: number;
      readonly excludeIds?: readonly string[];
    }
  | {
      readonly id: number;
      readonly type: 'vector.pathfinder';
      readonly nodes: readonly DesignNode[];
      readonly operation: PathfinderOperation;
      readonly resultId: string;
    }
  | {
      readonly id: number;
      readonly type: 'vector.shapeBuilder';
      readonly nodes: readonly DesignNode[];
    }
  | {
      readonly id: number;
      readonly type: 'layout.autoLayout';
      readonly nodes: readonly DesignNode[];
      readonly breakpoint?: BreakpointId;
      readonly tokens?: DesignTokenCollection;
      readonly canvasWidth?: number;
    }
  | {
      readonly id: number;
      readonly type: 'a11y.audit';
      readonly project: FolioProject;
      readonly page?: FolioPage;
      readonly pageId?: string;
      readonly themeId?: string;
    };

export type ComputeWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly durationMs: number;
      readonly backend: 'wasm' | 'worker';
      readonly payload:
        | { readonly count: number; readonly indexedCount: number; readonly wasmActive: boolean }
        | { readonly ids: string[] }
        | { readonly node: PathNode | null }
        | { readonly arrangement: PlanarArrangement }
        | { readonly nodes: DesignNode[] }
        | { readonly report: A11yAuditReport };
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

const wasmKernel = createWasmSpatialIndexKernel();
let activeSpatialIndex: SpatialIndexHandle = wasmKernel
  ? wasmKernel.buildIndex([])
  : new FlatGridSpatialIndex([]);

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function handleComputeWorkerMessage(request: ComputeWorkerRequest): ComputeWorkerResponse {
  const start = nowMs();
  try {
    switch (request.type) {
      case 'spatial.sync': {
        activeSpatialIndex = wasmKernel
          ? wasmKernel.buildIndex(request.entries, request.cellSize)
          : new FlatGridSpatialIndex(request.entries, request.cellSize);
        const count = activeSpatialIndex.count;
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: wasmKernel ? 'wasm' : 'worker',
          payload: { count, indexedCount: count, wasmActive: Boolean(wasmKernel) },
        };
      }
      case 'spatial.queryRect': {
        const ids = activeSpatialIndex.queryRect(request.rect);
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: wasmKernel ? 'wasm' : 'worker',
          payload: { ids },
        };
      }
      case 'spatial.querySnap': {
        const exclude = request.excludeIds ? new Set(request.excludeIds) : undefined;
        const ids = activeSpatialIndex.querySnapCandidates(request.rect, request.margin, exclude);
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: wasmKernel ? 'wasm' : 'worker',
          payload: { ids },
        };
      }
      case 'vector.pathfinder': {
        const node = applyPathfinderOperation(request.nodes, request.operation, request.resultId);
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: 'worker',
          payload: { node },
        };
      }
      case 'vector.shapeBuilder': {
        const { arrangement } = decomposeNodesForShapeBuilder(request.nodes);
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: 'worker',
          payload: { arrangement },
        };
      }
      case 'layout.autoLayout': {
        const nodes = computeAutoLayoutNodes(request.nodes, {
          breakpoint: request.breakpoint,
          tokens: request.tokens,
          canvasWidth: request.canvasWidth,
        });
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: 'worker',
          payload: { nodes },
        };
      }
      case 'a11y.audit': {
        const targetPage =
          request.page
          ?? (request.pageId
            ? request.project.pages.find((p) => p.id === request.pageId)
            : undefined)
          ?? getActivePage(request.project);
        const report = auditPageAccessibility(request.project, targetPage, request.themeId);
        return {
          id: request.id,
          ok: true,
          durationMs: nowMs() - start,
          backend: 'worker',
          payload: { report },
        };
      }
      default: {
        const unknownType = String((request as { type?: unknown })?.type ?? 'unknown');
        return {
          id: (request as { id?: number })?.id ?? -1,
          ok: false,
          error: `Unsupported compute worker request type: "${unknownType}".`,
        };
      }
    }
  } catch (error) {
    return {
      id: (request as { id?: number })?.id ?? -1,
      ok: false,
      error: error instanceof Error ? error.message : 'Compute worker execution failed.',
    };
  }
}

// Wire listener only when running inside a real DedicatedWorkerGlobalScope
const workerScope = typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function'
  && typeof window === 'undefined'
  ? (self as unknown as {
      onmessage: ((event: MessageEvent<ComputeWorkerRequest>) => void) | null;
      postMessage: (message: ComputeWorkerResponse) => void;
    })
  : null;

if (workerScope) {
  workerScope.onmessage = (event) => {
    const response = handleComputeWorkerMessage(event.data);
    workerScope.postMessage(response);
  };
}

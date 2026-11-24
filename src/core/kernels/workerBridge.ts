import type {
  BreakpointId,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  PathNode,
} from '../document/types';
import type { PathfinderOperation, PlanarArrangement } from '../document/vector';
import type { A11yAuditReport } from '../../engines/codegen/a11yAudit';
import type { SpatialBoundsEntry, SpatialQueryRect } from './types';
import {
  handleComputeWorkerMessage,
  type ComputeWorkerRequest,
  type ComputeWorkerResponse,
} from './compute.worker';

interface PendingJob {
  resolve: (response: ComputeWorkerResponse) => void;
  reject: (reason: Error) => void;
}

export interface ComputeWorkerStats {
  readonly workerSupported: boolean;
  readonly workerActive: boolean;
  readonly completedJobs: number;
  readonly lastDurationMs: number;
}

/**
 * Typed async bridge to Folio's dedicated Compute Web Worker.
 * - Uses a real ES Module Web Worker in browsers so heavy Spatial, Boolean,
 *   Auto-Layout, and A11y computations never stall 120Hz canvas interactions.
 * - Falls back seamlessly to direct local execution in headless Node/Vitest
 *   or if a browser restricts Worker instantiation.
 */
export class ComputeWorkerClient {
  private worker: Worker | null = null;
  private workerInitAttempted = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingJob>();
  private completedJobs = 0;
  private lastDurationMs = 0;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerInitAttempted) return null;
    this.workerInitAttempted = true;
    if (typeof Worker === 'undefined' || typeof window === 'undefined') {
      return null;
    }
    try {
      const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), {
        type: 'module',
        name: 'folio-compute-kernels',
      });
      worker.onmessage = (event: MessageEvent<ComputeWorkerResponse>) => {
        const response = event.data;
        const job = this.pending.get(response.id);
        if (!job) return;
        this.pending.delete(response.id);
        if (response.ok) {
          this.completedJobs += 1;
          this.lastDurationMs = response.durationMs;
        }
        job.resolve(response);
      };
      worker.onerror = () => {
        // Tear down broken worker and fall back cleanly to local execution
        this.terminate();
      };
      this.worker = worker;
      return worker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  getStats(): ComputeWorkerStats {
    return {
      workerSupported: typeof Worker !== 'undefined',
      workerActive: this.worker !== null,
      completedJobs: this.completedJobs,
      lastDurationMs: this.lastDurationMs,
    };
  }

  /** Eagerly warms up the background Worker in browser environments. */
  warmup(): boolean {
    return this.ensureWorker() !== null;
  }

  private dispatch(requestWithoutId: Omit<ComputeWorkerRequest, 'id'>): Promise<ComputeWorkerResponse> {
    const id = this.nextRequestId++;
    const request = { ...requestWithoutId, id } as ComputeWorkerRequest;
    const worker = this.ensureWorker();
    if (!worker) {
      const response = handleComputeWorkerMessage(request);
      if (response.ok) {
        this.completedJobs += 1;
        this.lastDurationMs = response.durationMs;
      }
      return Promise.resolve(response);
    }

    return new Promise<ComputeWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch {
        this.pending.delete(id);
        const fallback = handleComputeWorkerMessage(request);
        if (fallback.ok) {
          this.completedJobs += 1;
          this.lastDurationMs = fallback.durationMs;
        }
        resolve(fallback);
      }
    });
  }

  async syncSpatialIndexAsync(
    entries: readonly SpatialBoundsEntry[],
    cellSize?: number,
  ): Promise<{ count: number; wasmActive: boolean; durationMs: number }> {
    const res = await this.dispatch({ type: 'spatial.sync', entries, cellSize });
    if (!res.ok) throw new Error(res.error);
    const payload = res.payload as { count: number; wasmActive: boolean };
    return { ...payload, durationMs: res.durationMs };
  }

  async querySpatialRectAsync(rect: SpatialQueryRect): Promise<string[]> {
    const res = await this.dispatch({ type: 'spatial.queryRect', rect });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { ids: string[] }).ids;
  }

  async querySnapCandidatesAsync(
    rect: SpatialQueryRect,
    margin: number,
    excludeIds?: readonly string[],
  ): Promise<string[]> {
    const res = await this.dispatch({ type: 'spatial.querySnap', rect, margin, excludeIds });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { ids: string[] }).ids;
  }

  async applyPathfinderAsync(
    nodes: readonly DesignNode[],
    operation: PathfinderOperation,
    resultId: string,
  ): Promise<PathNode | null> {
    const res = await this.dispatch({ type: 'vector.pathfinder', nodes, operation, resultId });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { node: PathNode | null }).node;
  }

  async decomposeShapeBuilderAsync(nodes: readonly DesignNode[]): Promise<PlanarArrangement> {
    const res = await this.dispatch({ type: 'vector.shapeBuilder', nodes });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { arrangement: PlanarArrangement }).arrangement;
  }

  async computeAutoLayoutAsync(
    nodes: readonly DesignNode[],
    options: {
      breakpoint?: BreakpointId;
      tokens?: DesignTokenCollection;
      canvasWidth?: number;
    } = {},
  ): Promise<DesignNode[]> {
    const res = await this.dispatch({
      type: 'layout.autoLayout',
      nodes,
      breakpoint: options.breakpoint,
      tokens: options.tokens,
      canvasWidth: options.canvasWidth,
    });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { nodes: DesignNode[] }).nodes;
  }

  async auditAccessibilityAsync(
    project: FolioProject,
    page: FolioPage,
  ): Promise<A11yAuditReport> {
    const res = await this.dispatch({ type: 'a11y.audit', project, page });
    if (!res.ok) throw new Error(res.error);
    return (res.payload as { report: A11yAuditReport }).report;
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, job] of this.pending) {
      job.reject(new Error('Compute worker was terminated.'));
    }
    this.pending.clear();
  }
}

let singletonClient: ComputeWorkerClient | null = null;

export function getComputeWorkerClient(): ComputeWorkerClient {
  if (!singletonClient) {
    singletonClient = new ComputeWorkerClient();
  }
  return singletonClient;
}

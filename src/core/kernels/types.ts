import type {
  BreakpointId,
  DesignNode,
  FolioDocument,
  FolioPage,
  FolioProject,
  PathNode,
} from '../document/types';
import type { PathfinderOperation, PlanarArrangement, PlanarFace } from '../document/vector';
import type { A11yAuditReport } from '../../engines/codegen/a11yAudit';

export type ComputeKernelBackend = 'ts-default' | 'wasm' | 'worker';

export interface SpatialBoundsEntry {
  readonly id: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly zIndex: number;
}

export interface SpatialQueryRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Flat, typed-array-friendly spatial index interface designed to drop in a
 * Rust -> WASM R-tree/BVH or linear-memory WASM AABB kernel behind the exact same contract.
 */
export interface SpatialIndexHandle {
  readonly count: number;
  queryRect(rect: SpatialQueryRect): string[];
  queryPoint(x: number, y: number, tolerance?: number): string[];
  querySnapCandidates(
    subjectRect: SpatialQueryRect,
    margin: number,
    excludeIds?: ReadonlySet<string>,
  ): string[];
  getBounds(id: string): SpatialBoundsEntry | undefined;
}

export interface SpatialIndexKernel {
  readonly backend: ComputeKernelBackend;
  buildIndex(entries: readonly SpatialBoundsEntry[], cellSize?: number): SpatialIndexHandle;
}

export interface VectorGeometryKernel {
  readonly backend: ComputeKernelBackend;
  applyPathfinder(
    nodes: readonly DesignNode[],
    operation: PathfinderOperation,
    resultId: string,
  ): PathNode | null;
  booleanOp(
    nodes: readonly DesignNode[],
    operation: PathfinderOperation,
    resultId?: string,
  ): PathNode | null;
  decomposeForShapeBuilder(nodes: readonly DesignNode[]): PlanarArrangement;
  hitTestFace(arrangement: PlanarArrangement, x: number, y: number): PlanarFace | null;
}

export interface LayoutComputeKernel {
  readonly backend: ComputeKernelBackend;
  computeAutoLayout(
    document: FolioDocument,
    activeBreakpoint?: BreakpointId,
  ): DesignNode[];
}

export interface A11yAuditKernel {
  readonly backend: ComputeKernelBackend;
  auditPage(project: FolioProject, page: FolioPage): A11yAuditReport;
}

export interface ComputeKernelRegistry {
  readonly spatial: SpatialIndexKernel;
  readonly vector: VectorGeometryKernel;
  readonly layout: LayoutComputeKernel;
  readonly a11y: A11yAuditKernel;
}

export interface ComputeKernelRuntimeStatus {
  readonly spatialBackend: ComputeKernelBackend;
  readonly vectorBackend: ComputeKernelBackend;
  readonly layoutBackend: ComputeKernelBackend;
  readonly a11yBackend: ComputeKernelBackend;
  readonly wasmSupported: boolean;
  readonly wasmSpatialActive: boolean;
  readonly wasmModuleBytes: number;
  readonly workerSupported: boolean;
  readonly workerActive: boolean;
  readonly workerCompletedJobs: number;
}

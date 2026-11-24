import {
  applyPathfinderOperation,
  decomposeNodesForShapeBuilder,
  hitTestPlanarFace,
} from '../document/vector';
import { computeAutoLayoutNodes } from '../../engines/layout/autoLayout';
import { auditPageAccessibility } from '../../engines/codegen/a11yAudit';
import { defaultSpatialIndexKernel } from './spatialIndex';
import {
  WASM_SPATIAL_MODULE_BYTES,
  createWasmSpatialIndexKernel,
  createWasmSpatialIndexKernelAsync,
  isWebAssemblySupported,
} from './wasmSpatialKernel';
import { getComputeWorkerClient } from './workerBridge';
import type {
  A11yAuditKernel,
  ComputeKernelRegistry,
  ComputeKernelRuntimeStatus,
  LayoutComputeKernel,
  VectorGeometryKernel,
} from './types';

export const defaultVectorGeometryKernel: VectorGeometryKernel = {
  backend: 'ts-default',
  applyPathfinder(nodes, operation, resultId) {
    return applyPathfinderOperation(nodes, operation, resultId);
  },
  decomposeForShapeBuilder(nodes) {
    return decomposeNodesForShapeBuilder(nodes).arrangement;
  },
  hitTestFace(arrangement, x, y) {
    return hitTestPlanarFace(arrangement, { x, y });
  },
};

export const defaultLayoutComputeKernel: LayoutComputeKernel = {
  backend: 'ts-default',
  computeAutoLayout(document, activeBreakpoint) {
    return computeAutoLayoutNodes(document.nodes, { breakpoint: activeBreakpoint });
  },
};

export const defaultA11yAuditKernel: A11yAuditKernel = {
  backend: 'ts-default',
  auditPage(project, page) {
    return auditPageAccessibility(project, page);
  },
};

const DEFAULT_KERNELS: ComputeKernelRegistry = Object.freeze({
  spatial: defaultSpatialIndexKernel,
  vector: defaultVectorGeometryKernel,
  layout: defaultLayoutComputeKernel,
  a11y: defaultA11yAuditKernel,
});

let activeKernels: ComputeKernelRegistry = DEFAULT_KERNELS;

/**
 * Returns the active compute kernel suite (default optimized TypeScript,
 * upgradeable at runtime to Folio's embedded WASM & Web Worker compute kernels).
 */
export function getComputeKernels(): ComputeKernelRegistry {
  return activeKernels;
}

export function registerComputeKernel(partial: Partial<ComputeKernelRegistry>): ComputeKernelRegistry {
  activeKernels = Object.freeze({
    spatial: partial.spatial ?? activeKernels.spatial,
    vector: partial.vector ?? activeKernels.vector,
    layout: partial.layout ?? activeKernels.layout,
    a11y: partial.a11y ?? activeKernels.a11y,
  });
  return activeKernels;
}

export function resetComputeKernels(): ComputeKernelRegistry {
  activeKernels = DEFAULT_KERNELS;
  return activeKernels;
}

/**
 * Compiles and activates Folio's embedded WebAssembly spatial AABB kernel and
 * warms up the off-main-thread Compute Web Worker in browser environments.
 */
export async function bootMonsterComputeKernels(): Promise<ComputeKernelRuntimeStatus> {
  const wasmSpatial = await createWasmSpatialIndexKernelAsync();
  if (wasmSpatial) {
    registerComputeKernel({ spatial: wasmSpatial });
  }
  getComputeWorkerClient().warmup();
  return getComputeKernelRuntimeStatus();
}

export function getComputeKernelRuntimeStatus(): ComputeKernelRuntimeStatus {
  const workerStats = getComputeWorkerClient().getStats();
  return {
    spatialBackend: activeKernels.spatial.backend,
    vectorBackend: activeKernels.vector.backend,
    layoutBackend: activeKernels.layout.backend,
    a11yBackend: activeKernels.a11y.backend,
    wasmSupported: isWebAssemblySupported(),
    wasmSpatialActive: activeKernels.spatial.backend === 'wasm',
    wasmModuleBytes: WASM_SPATIAL_MODULE_BYTES.byteLength,
    workerSupported: workerStats.workerSupported,
    workerActive: workerStats.workerActive,
    workerCompletedJobs: workerStats.completedJobs,
  };
}

export { FlatGridSpatialIndex, defaultSpatialIndexKernel } from './spatialIndex';
export {
  WASM_SPATIAL_MODULE_BYTES,
  WasmAcceleratedSpatialIndex,
  createWasmSpatialIndexKernel,
  createWasmSpatialIndexKernelAsync,
  isWebAssemblySupported,
} from './wasmSpatialKernel';
export { ComputeWorkerClient, getComputeWorkerClient, type ComputeWorkerStats } from './workerBridge';
export type {
  A11yAuditKernel,
  ComputeKernelBackend,
  ComputeKernelRegistry,
  ComputeKernelRuntimeStatus,
  LayoutComputeKernel,
  SpatialBoundsEntry,
  SpatialIndexHandle,
  SpatialIndexKernel,
  SpatialQueryRect,
  VectorGeometryKernel,
} from './types';

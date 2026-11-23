import {
  applyPathfinderOperation,
  decomposeNodesForShapeBuilder,
  hitTestPlanarFace,
} from '../document/vector';
import { computeAutoLayoutNodes } from '../../engines/layout/autoLayout';
import { defaultSpatialIndexKernel } from './spatialIndex';
import type {
  ComputeKernelRegistry,
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

const DEFAULT_KERNELS: ComputeKernelRegistry = Object.freeze({
  spatial: defaultSpatialIndexKernel,
  vector: defaultVectorGeometryKernel,
  layout: defaultLayoutComputeKernel,
});

let activeKernels: ComputeKernelRegistry = DEFAULT_KERNELS;

/**
 * Returns the active compute kernel suite (default optimized TypeScript,
 * pluggable at runtime for future Rust -> WASM drop-in modules).
 */
export function getComputeKernels(): ComputeKernelRegistry {
  return activeKernels;
}

export function registerComputeKernel(partial: Partial<ComputeKernelRegistry>): ComputeKernelRegistry {
  activeKernels = Object.freeze({
    spatial: partial.spatial ?? activeKernels.spatial,
    vector: partial.vector ?? activeKernels.vector,
    layout: partial.layout ?? activeKernels.layout,
  });
  return activeKernels;
}

export function resetComputeKernels(): ComputeKernelRegistry {
  activeKernels = DEFAULT_KERNELS;
  return activeKernels;
}

export { FlatGridSpatialIndex, defaultSpatialIndexKernel } from './spatialIndex';
export type {
  ComputeKernelBackend,
  ComputeKernelRegistry,
  LayoutComputeKernel,
  SpatialBoundsEntry,
  SpatialIndexHandle,
  SpatialIndexKernel,
  SpatialQueryRect,
  VectorGeometryKernel,
} from './types';

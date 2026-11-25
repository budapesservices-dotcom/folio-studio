/**
 * Lazy dynamic-import loader for Folio's Vector Drawing Engine (`vectorDrawing.ts`).
 * Keeps heavy brush/eraser/live-fill geometry algorithms out of the main Canvas chunk
 * while ensuring synchronous tool handlers have instant access once preloaded.
 */

export type VectorDrawingEngineModule = typeof import('../../../core/document/vectorDrawing');

let loadedModule: VectorDrawingEngineModule | null = null;
let loadPromise: Promise<VectorDrawingEngineModule> | null = null;

export function preloadVectorDrawingEngine(): Promise<VectorDrawingEngineModule> {
  if (loadedModule) return Promise.resolve(loadedModule);
  if (!loadPromise) {
    loadPromise = import('../../../core/document/vectorDrawing').then((mod) => {
      loadedModule = mod;
      return mod;
    });
  }
  return loadPromise;
}

export function getLoadedVectorDrawingEngine(): VectorDrawingEngineModule | null {
  return loadedModule;
}

export function registerVectorDrawingEngine(mod: VectorDrawingEngineModule): void {
  loadedModule = mod;
}

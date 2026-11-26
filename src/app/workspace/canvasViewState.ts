import { getActivePage } from '../../core/document/project';
import type { FolioDocument, FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';

export interface CanvasViewState {
  zoom: number;
  pan: { x: number; y: number };
}

export const MIN_CANVAS_ZOOM = 0.15;
export const MAX_CANVAS_ZOOM = 8;
export const DEFAULT_CANVAS_ZOOM = 0.82;
export const ZOOM_STEP_FACTOR = 1.2;

export const DEFAULT_CANVAS_VIEW: CanvasViewState = {
  zoom: DEFAULT_CANVAS_ZOOM,
  pan: { x: 0, y: 0 },
};

export function clampCanvasZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CANVAS_ZOOM;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value));
}

export function stepCanvasZoom(currentZoom: number, direction: 'in' | 'out'): number {
  const raw = direction === 'in'
    ? currentZoom * ZOOM_STEP_FACTOR
    : currentZoom / ZOOM_STEP_FACTOR;
  return clampCanvasZoom(Number(raw.toFixed(2)));
}

/**
 * Computes a centered, aspect-fitted CanvasViewState (`pan: { x: 0, y: 0 }`) so any
 * Component Master (tiny icon, square badge, tall card, or wide banner) opens dead-center
 * inside the Component Canvas viewport without overflowing vertically or horizontally.
 *
 * `.canvas-stage` uses `width: zoom * 100%` of `.canvas-scroll-area`, so:
 *   stageWidth  = zoom * availW
 *   stageHeight = stageWidth * (docHeight / docWidth)
 */
export function computeCenteredComponentView(
  docWidth: number,
  docHeight: number,
  viewportWidth = 900,
  viewportHeight = 560,
): CanvasViewState {
  const safeDocW = Math.max(1, Number.isFinite(docWidth) ? docWidth : 420);
  const safeDocH = Math.max(1, Number.isFinite(docHeight) ? docHeight : 280);
  const availW = Math.max(240, (Number.isFinite(viewportWidth) ? viewportWidth : 900) - 64);
  const availH = Math.max(200, (Number.isFinite(viewportHeight) ? viewportHeight : 560) - 116);
  const maxZoomByWidth = 0.78;
  const maxZoomByHeight = (0.74 * availH) / (availW * (safeDocH / safeDocW));
  const rawZoom = Math.min(maxZoomByWidth, maxZoomByHeight);
  return {
    zoom: clampCanvasZoom(Number(rawZoom.toFixed(2))),
    pan: { x: 0, y: 0 },
  };
}

export function parseCanvasViewState(raw: string | null): CanvasViewState {
  if (!raw) {
    return { zoom: DEFAULT_CANVAS_ZOOM, pan: { x: 0, y: 0 } };
  }
  try {
    const value = JSON.parse(raw) as { zoom?: unknown; pan?: { x?: unknown; y?: unknown } } | null;
    const zoom = typeof value?.zoom === 'number' && Number.isFinite(value.zoom)
      ? clampCanvasZoom(value.zoom)
      : DEFAULT_CANVAS_ZOOM;
    const panX = typeof value?.pan?.x === 'number' && Number.isFinite(value.pan.x) ? value.pan.x : 0;
    const panY = typeof value?.pan?.y === 'number' && Number.isFinite(value.pan.y) ? value.pan.y : 0;
    return { zoom, pan: { x: panX, y: panY } };
  } catch {
    return { zoom: DEFAULT_CANVAS_ZOOM, pan: { x: 0, y: 0 } };
  }
}

export function readCanvasViewState(key: string): CanvasViewState {
  try {
    return parseCanvasViewState(window.localStorage.getItem(key));
  } catch {
    return { zoom: DEFAULT_CANVAS_ZOOM, pan: { x: 0, y: 0 } };
  }
}

export interface ActiveExportTarget {
  document: FolioDocument;
  name: string;
}

export function resolveActiveExportTarget(
  activeEditorId: EditorTarget,
  project: FolioProject,
  componentDocument: FolioDocument,
  editingComponentId: string | null,
): ActiveExportTarget {
  if (activeEditorId === 'component') {
    const activeComp = editingComponentId
      ? project.components.find((component) => component.id === editingComponentId)
      : null;
    return {
      document: componentDocument,
      name: activeComp?.name ?? `${project.metadata.name}-component`,
    };
  }
  const activePage = getActivePage(project);
  return {
    document: activePage.document,
    name: `${project.metadata.name}-${activePage.name}`,
  };
}

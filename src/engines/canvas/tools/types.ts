import type { DesignNode, FolioDocument } from '../../../core/document/types';
import type { Bounds, ResizeHandle, SnapGuide } from '../geometry';

export type CanvasToolId = 'select' | 'direct-selection' | 'lasso-selection' | 'magic-wand' | 'hand' | 'scrubby-zoom';
export type CanvasToolGroupId = 'selection' | 'navigation';

export interface CanvasToolPointerInput {
  pointerId: number;
  button: number;
  point: { x: number; y: number };
  clientX: number;
  clientY: number;
  viewportAnchor: { x: number; y: number };
  targetNodeId: string | null;
  resizeHandle: ResizeHandle | null;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}
export interface CanvasToolKeyInput {
  key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
}
export interface SelectTransformSession {
  kind: 'select-transform'; pointerId: number; mode: 'move' | 'resize';
  start: { x: number; y: number }; nodes: DesignNode[]; bounds: Bounds; ids: string[];
  handle?: ResizeHandle; previewNodes?: DesignNode[];
}
export interface MarqueeSelectionSession {
  kind: 'marquee-selection'; pointerId: number; start: { x: number; y: number };
  current: { x: number; y: number }; additive: boolean; subtractive: boolean; initialIds: string[];
}
export interface LassoSelectionSession {
  kind: 'lasso-selection'; pointerId: number; points: Array<{ x: number; y: number }>;
  additive: boolean; subtractive: boolean; initialIds: string[];
}
export interface HandSession {
  kind: 'hand'; pointerId: number; startClientX: number; startClientY: number; startPan: { x: number; y: number };
}
export interface ScrubbyZoomSession {
  kind: 'scrubby-zoom'; pointerId: number; startClientX: number; startZoom: number;
  startPan: { x: number; y: number }; anchor: { x: number; y: number };
}
export type CanvasToolSession = SelectTransformSession | MarqueeSelectionSession | LassoSelectionSession | HandSession | ScrubbyZoomSession;

export interface CanvasToolContext {
  document: FolioDocument;
  canvasNodes: DesignNode[];
  selectableNodes: DesignNode[];
  otherNodes: DesignNode[];
  selectedNodeIds: string[];
  selectedNodes: DesignNode[];
  selectionBounds: Bounds | null;
  zoom: number;
  pan: { x: number; y: number };
  viewportWidth: number;
  session: CanvasToolSession | null;
}
export type CanvasToolOverlay =
  | { kind: 'marquee'; bounds: Bounds }
  | { kind: 'lasso'; points: Array<{ x: number; y: number }> };
export interface CanvasToolTransition {
  session?: CanvasToolSession | null;
  selection?: string[];
  previewNodes?: DesignNode[] | null;
  commitNodes?: DesignNode[];
  pan?: { x: number; y: number };
  zoom?: number;
  guides?: SnapGuide[];
  capturePointer?: boolean;
  preventDefault?: boolean;
}
export interface CanvasToolHandler {
  readonly id: CanvasToolId;
  readonly label: string;
  readonly description: string;
  readonly group: CanvasToolGroupId;
  readonly icon: string;
  onPointerDown(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerMove(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerUp(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerCancel(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onKeyDown(event: CanvasToolKeyInput, context: CanvasToolContext): CanvasToolTransition;
  renderOverlay(context: CanvasToolContext): CanvasToolOverlay | null;
  cursorStyle(context: CanvasToolContext): string;
}

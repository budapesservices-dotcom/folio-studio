import type { DesignNode, FolioDocument, PathNode, VectorAnchorPoint } from '../../../core/document/types';
import type { Bounds, ResizeHandle, SnapGuide } from '../geometry';

export type Wave1CanvasToolId =
  | 'select'
  | 'direct-selection'
  | 'lasso-selection'
  | 'magic-wand'
  | 'hand'
  | 'scrubby-zoom';

export type StudioCanvasToolId =
  | Wave1CanvasToolId
  | 'scale'
  | 'frame'
  | 'section'
  | 'draw-rect'
  | 'draw-ellipse'
  | 'draw-line'
  | 'draw-arrow'
  | 'draw-polygon'
  | 'draw-star'
  | 'pen'
  | 'curvature'
  | 'anchor-point'
  | 'pencil'
  | 'smooth'
  | 'scissors'
  | 'draw-text'
  | 'rotate'
  | 'eyedropper'
  | 'measure';

export type CanvasToolId = StudioCanvasToolId;

export type CanvasToolGroupId =
  | 'selection'
  | 'layout'
  | 'shapes'
  | 'vector'
  | 'type'
  | 'transform'
  | 'inspect'
  | 'navigation';

export type ToolWorkspaceScope = 'main' | 'component';

export interface CanvasToolOptions {
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
  strokeWidth: number;
  strokeColor: string;
  fillColor: string;
  keepToolActive: boolean;
  smoothRadius: number;
}

export const DEFAULT_CANVAS_TOOL_OPTIONS: CanvasToolOptions = {
  polygonSides: 6,
  starPoints: 5,
  starInnerRatio: 0.44,
  strokeWidth: 2.5,
  strokeColor: '#20212A',
  fillColor: '#8B7CF6',
  keepToolActive: false,
  smoothRadius: 34,
};

export interface VectorAnchorHit {
  nodeId: string;
  pointIndex: number;
  part: 'anchor' | 'handle-in' | 'handle-out';
}

export interface CanvasToolPointerInput {
  pointerId: number;
  button: number;
  point: { x: number; y: number };
  clientX: number;
  clientY: number;
  viewportAnchor: { x: number; y: number };
  targetNodeId: string | null;
  resizeHandle: ResizeHandle | null;
  rotateHandle?: boolean;
  anchorHit?: VectorAnchorHit | null;
  detail?: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface CanvasToolKeyInput {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface SelectTransformSession {
  kind: 'select-transform';
  pointerId: number;
  mode: 'move' | 'resize' | 'rotate';
  start: { x: number; y: number };
  nodes: DesignNode[];
  bounds: Bounds;
  ids: string[];
  handle?: ResizeHandle;
  uniformScale?: boolean;
  startAngle?: number;
  currentAngle?: number;
  previewNodes?: DesignNode[];
}

export interface AnchorEditSession {
  kind: 'anchor-edit';
  pointerId: number;
  node: PathNode;
  pointIndex: number;
  part: 'anchor' | 'handle-in' | 'handle-out';
  start: { x: number; y: number };
  previewNode?: PathNode;
  symmetricConvert?: boolean;
}

export interface MarqueeSelectionSession {
  kind: 'marquee-selection';
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  additive: boolean;
  subtractive: boolean;
  initialIds: string[];
}

export interface LassoSelectionSession {
  kind: 'lasso-selection';
  pointerId: number;
  points: Array<{ x: number; y: number }>;
  additive: boolean;
  subtractive: boolean;
  initialIds: string[];
}

export interface HandSession {
  kind: 'hand';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPan: { x: number; y: number };
}

export interface ScrubbyZoomSession {
  kind: 'scrubby-zoom';
  pointerId: number;
  startClientX: number;
  startZoom: number;
  startPan: { x: number; y: number };
  anchor: { x: number; y: number };
}

export interface DrawShapeSession {
  kind: 'draw-shape';
  pointerId: number;
  toolId: CanvasToolId;
  start: { x: number; y: number };
  current: { x: number; y: number };
  constrain: boolean;
  fromCenter: boolean;
}

export interface PenDraftSession {
  kind: 'pen-draft';
  mode: 'pen' | 'curvature';
  points: VectorAnchorPoint[];
  rawCurvaturePoints?: Array<{ x: number; y: number; corner?: boolean }>;
  draggingHandle: boolean;
  pointerId: number | null;
  cursor: { x: number; y: number };
  hoverClose: boolean;
}

export interface FreehandSession {
  kind: 'freehand';
  mode: 'pencil' | 'smooth';
  pointerId: number;
  points: Array<{ x: number; y: number }>;
  targetNode?: PathNode;
  previewNode?: PathNode;
}

export interface MeasureSession {
  kind: 'measure';
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  active: boolean;
}

export type CanvasToolSession =
  | SelectTransformSession
  | AnchorEditSession
  | MarqueeSelectionSession
  | LassoSelectionSession
  | HandSession
  | ScrubbyZoomSession
  | DrawShapeSession
  | PenDraftSession
  | FreehandSession
  | MeasureSession;

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
  toolOptions?: CanvasToolOptions;
  workspace?: ToolWorkspaceScope;
}

export type CanvasToolOverlay =
  | { kind: 'marquee'; bounds: Bounds }
  | { kind: 'lasso'; points: Array<{ x: number; y: number }> }
  | { kind: 'draw-preview'; node: DesignNode; label: string; labelX: number; labelY: number }
  | { kind: 'pen-draft'; points: VectorAnchorPoint[]; cursor: { x: number; y: number }; hoverClose: boolean; closedPreview?: boolean }
  | { kind: 'freehand'; points: Array<{ x: number; y: number }>; mode: 'pencil' | 'smooth' }
  | { kind: 'rotate-ring'; center: { x: number; y: number }; radius: number; angleDeg: number }
  | { kind: 'measure'; start: { x: number; y: number }; end: { x: number; y: number }; dx: number; dy: number; distance: number; angleDeg: number };

export interface CanvasToolTransition {
  session?: CanvasToolSession | null;
  selection?: string[];
  previewNodes?: DesignNode[] | null;
  commitNodes?: DesignNode[];
  createNodes?: DesignNode[];
  replaceNodeWithNodes?: { nodeId: string; nodes: DesignNode[] };
  sampledColor?: { color: string; sourceName: string };
  nextToolId?: CanvasToolId;
  notice?: string;
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
  readonly shortcut?: string;
  readonly workspaces?: readonly ToolWorkspaceScope[];
  onPointerDown(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerMove(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerUp(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onPointerCancel(event: CanvasToolPointerInput, context: CanvasToolContext): CanvasToolTransition;
  onKeyDown(event: CanvasToolKeyInput, context: CanvasToolContext): CanvasToolTransition;
  renderOverlay(context: CanvasToolContext): CanvasToolOverlay | null;
  cursorStyle(context: CanvasToolContext): string;
}

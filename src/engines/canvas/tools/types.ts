import type { DesignNode, FolioDocument, PathNode, VectorAnchorPoint } from '../../../core/document/types';
import type { PlanarArrangement } from '../../../core/document/vector';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolGroupId,
  type CanvasToolId,
  type CanvasToolOptions,
  type StudioCanvasToolId,
  type ToolOperation,
  type ToolWorkspaceScope,
  type Wave1CanvasToolId,
} from '../../../core/tools/operationContract';
import type { Bounds, ResizeHandle, SnapGuide } from '../geometry';

export {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolGroupId,
  type CanvasToolId,
  type CanvasToolOptions,
  type StudioCanvasToolId,
  type ToolOperation,
  type ToolWorkspaceScope,
  type Wave1CanvasToolId,
};

export interface VectorAnchorHit {
  nodeId: string;
  pointIndex: number;
  part: 'anchor' | 'handle-in' | 'handle-out';
}

export type SmartHandleHit =
  | { kind: 'corner-radius'; nodeId: string; corner: 'nw' | 'ne' | 'se' | 'sw' }
  | { kind: 'star-inner'; nodeId: string }
  | { kind: 'pivot' };

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
  smartHandleHit?: SmartHandleHit | null;
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
  pivot?: { x: number; y: number };
  startAngle?: number;
  currentAngle?: number;
  cloneMode?: boolean;
  cloneIdMap?: Record<string, string>;
  previewNodes?: DesignNode[];
  hudLabel?: string;
}

export interface SmartHandleSession {
  kind: 'smart-handle';
  pointerId: number;
  handle: SmartHandleHit;
  start: { x: number; y: number };
  node?: DesignNode;
  previewNode?: DesignNode;
  pivot?: { x: number; y: number };
  initialPivot?: { x: number; y: number } | null;
  hudLabel?: string;
  hudPoint?: { x: number; y: number };
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
  sidesOverride?: number;
  spikesOverride?: number;
  innerRatioOverride?: number;
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

export interface ShapeBuilderSession {
  kind: 'shape-builder';
  pointerId: number;
  mode: 'merge' | 'punch';
  candidateIds: string[];
  candidates: DesignNode[];
  arrangement: PlanarArrangement;
  strokePoints: Array<{ x: number; y: number }>;
  touchedFaceIds: number[];
}

export interface MeasureSession {
  kind: 'measure';
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  active: boolean;
  snappedStart?: boolean;
  snappedEnd?: boolean;
  targetNodeId?: string | null;
  inspectedBounds?: Bounds;
  inspectedLabel?: string;
}

export type CanvasToolSession =
  | SelectTransformSession
  | SmartHandleSession
  | AnchorEditSession
  | MarqueeSelectionSession
  | LassoSelectionSession
  | HandSession
  | ScrubbyZoomSession
  | DrawShapeSession
  | PenDraftSession
  | FreehandSession
  | ShapeBuilderSession
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
  canvasUnitsPerPixel?: number;
  pan: { x: number; y: number };
  viewportWidth: number;
  session: CanvasToolSession | null;
  toolOptions?: CanvasToolOptions;
  workspace?: ToolWorkspaceScope;
  customPivot?: { x: number; y: number } | null;
  activeAnchor?: { nodeId: string; pointIndex: number } | null;
}

export type CanvasToolOverlay =
  | { kind: 'marquee'; bounds: Bounds }
  | { kind: 'lasso'; points: Array<{ x: number; y: number }> }
  | { kind: 'draw-preview'; node: DesignNode; label: string; labelX: number; labelY: number }
  | { kind: 'pen-draft'; points: VectorAnchorPoint[]; cursor: { x: number; y: number }; hoverClose: boolean; closedPreview?: boolean; previewPoints?: VectorAnchorPoint[]; segmentHud?: string }
  | { kind: 'freehand'; points: Array<{ x: number; y: number }>; mode: 'pencil' | 'smooth' }
  | { kind: 'rotate-ring'; center: { x: number; y: number }; radius: number; angleDeg: number }
  | { kind: 'measure'; start: { x: number; y: number }; end: { x: number; y: number }; dx: number; dy: number; distance: number; angleDeg: number; snappedStart?: boolean; snappedEnd?: boolean; inspectedBounds?: Bounds; inspectedLabel?: string }
  | { kind: 'smart-hud'; x: number; y: number; text: string; variant?: 'default' | 'measure' | 'rotate' }
  | { kind: 'shape-builder'; arrangement: PlanarArrangement; touchedFaceIds: number[]; strokePoints: Array<{ x: number; y: number }>; mode: 'merge' | 'punch' };

export interface CanvasToolTransition {
  session?: CanvasToolSession | null;
  selection?: string[];
  previewNodes?: DesignNode[] | null;
  previewCreateNodes?: DesignNode[] | null;
  commitNodes?: DesignNode[];
  createNodes?: DesignNode[];
  replaceNodeWithNodes?: { nodeId: string; nodes: DesignNode[] };
  replaceNodes?: { removeIds: string[]; insertNodes: DesignNode[] };
  sampledColor?: { color: string; sourceName: string; target?: 'fill' | 'stroke' };
  customPivot?: { x: number; y: number } | null;
  activeAnchor?: { nodeId: string; pointIndex: number } | null;
  editTextNodeId?: string;
  nextToolId?: CanvasToolId;
  notice?: string;
  pan?: { x: number; y: number };
  zoom?: number;
  operations?: readonly ToolOperation[];
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

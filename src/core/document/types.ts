/**
 * The native Folio project model.
 * Keep this layer independent from Preact and browser rendering APIs.
 */

export const FOLIO_FORMAT = 'folio-project' as const;
export const FOLIO_LEGACY_FORMAT_VERSION = 1 as const;
export const FOLIO_FORMAT_VERSION = 2 as const;

export interface NodeBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Optional label color used by the Layers panel, independent of canvas fill. */
  layerColor?: string;
  /** Optional parent layer ID. Missing/null means top-level for backward compatibility. */
  parentId?: string | null;
  /** Whether this source layer is currently placed on the Canvas. Missing means true for older projects. */
  onCanvas?: boolean;
  /** Base layer ID whose alpha bounds this layer as a Photoshop-style clipping layer. */
  clipMaskBaseId?: string;
}

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
}

export interface VectorPointHandle {
  x: number;
  y: number;
}

export type VectorPointType = 'corner' | 'smooth' | 'symmetric';

export interface VectorAnchorPoint {
  id: string;
  /** Local X coordinate relative to the PathNode's x origin. */
  x: number;
  /** Local Y coordinate relative to the PathNode's y origin. */
  y: number;
  /** Incoming cubic Bezier control handle in local coordinates. */
  handleIn?: VectorPointHandle;
  /** Outgoing cubic Bezier control handle in local coordinates. */
  handleOut?: VectorPointHandle;
  pointType: VectorPointType;
}

export interface VectorSubpath {
  points: VectorAnchorPoint[];
  closed: boolean;
}

export interface PathStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeDasharray?: string;
  fillRule?: 'nonzero' | 'evenodd';
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export type VectorPathKind =
  | 'pen'
  | 'curvature'
  | 'pencil'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'star'
  | 'boolean'
  | 'outline';

export interface GroupNode extends NodeBase {
  type: 'group';
}

export interface FrameNode extends NodeBase {
  type: 'frame';
  style: ShapeStyle;
  clipContent?: boolean;
  isSection?: boolean;
}

export interface RectNode extends NodeBase {
  type: 'rect';
  style: ShapeStyle;
}

export interface EllipseNode extends NodeBase {
  type: 'ellipse';
  style: ShapeStyle;
}

export interface PathNode extends NodeBase {
  type: 'path';
  points: VectorAnchorPoint[];
  closed: boolean;
  style: PathStyle;
  pathKind?: VectorPathKind;
  /** Optional compound subpaths for Illustrator Pathfinder cutouts/exclusions. */
  subpaths?: VectorSubpath[];
}

export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
  style: {
    fill: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    letterSpacing: number;
    lineHeight: number;
  };
}

export interface ComponentNodeOverride { fill?: string; text?: string; }
export type ComponentInstanceOverrides = Record<string, ComponentNodeOverride>;
export interface ComponentInstanceNode extends NodeBase {
  type: 'component-instance';
  componentId: string;
  overrides: ComponentInstanceOverrides;
}
export type DesignNode =
  | GroupNode
  | FrameNode
  | RectNode
  | EllipseNode
  | PathNode
  | TextNode
  | ComponentInstanceNode;

export interface FolioDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  nodes: DesignNode[];
}

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolioPage {
  id: string;
  name: string;
  route: string;
  document: FolioDocument;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  document: FolioDocument;
  createdAt: string;
  updatedAt: string;
}

/** Reserved, versioned node graph contract for the upcoming Node Logic engine. */
export interface LogicNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data: Record<string, string | number | boolean | null>;
}

export interface LogicConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface LogicGraph {
  id: string;
  name: string;
  scope: 'project' | 'page' | 'component';
  targetId: string | null;
  nodes: LogicNode[];
  connections: LogicConnection[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetReference {
  id: string;
  name: string;
  kind: 'image' | 'font' | 'file';
  mimeType: string;
  source: string;
  createdAt: string;
}

/** Legacy single-document project accepted only at migration boundaries. */
export interface FolioProjectV1 {
  format: typeof FOLIO_FORMAT;
  formatVersion: typeof FOLIO_LEGACY_FORMAT_VERSION;
  appVersion: string;
  metadata: ProjectMetadata;
  document: FolioDocument;
}

/** Unified native project. All workspace content belongs to this aggregate. */
export interface FolioProjectV2 {
  format: typeof FOLIO_FORMAT;
  formatVersion: typeof FOLIO_FORMAT_VERSION;
  appVersion: string;
  metadata: ProjectMetadata;
  activePageId: string;
  pages: FolioPage[];
  components: ComponentDefinition[];
  logicGraphs: LogicGraph[];
  assets: AssetReference[];
}

/** Current project alias used by the editor, persistence and file I/O. */
export type FolioProject = FolioProjectV2;

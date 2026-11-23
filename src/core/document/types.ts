/**
 * The native Folio project model.
 * Keep this layer independent from Preact and browser rendering APIs.
 */

export const FOLIO_FORMAT = 'folio-project' as const;
export const FOLIO_LEGACY_FORMAT_VERSION = 1 as const;
export const FOLIO_FORMAT_VERSION = 2 as const;

export type SemanticHtmlTag =
  | 'div'
  | 'section'
  | 'header'
  | 'footer'
  | 'nav'
  | 'main'
  | 'article'
  | 'aside'
  | 'button'
  | 'a'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'p'
  | 'span'
  | 'ul'
  | 'li'
  | 'form'
  | 'input';

export type BreakpointId = 'desktop' | 'tablet' | 'mobile';

export interface NodePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type LayoutMode = 'none' | 'flex' | 'grid';
export type LayoutDirection = 'row' | 'column';
export type LayoutWrap = 'nowrap' | 'wrap';
export type LayoutJustifyContent = 'start' | 'center' | 'end' | 'space-between' | 'space-around';
export type LayoutAlignItems = 'start' | 'center' | 'end' | 'stretch';

export interface NodeLayoutConfig {
  mode: LayoutMode;
  direction: LayoutDirection;
  wrap?: LayoutWrap;
  justifyContent?: LayoutJustifyContent;
  alignItems?: LayoutAlignItems;
  gap: number;
  columnGap?: number;
  rowGap?: number;
  gridColumns?: number;
  padding: NodePadding;
}

export type LayoutSizingMode = 'fixed' | 'hug' | 'fill';
export type HorizontalConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type VerticalConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

export interface NodeLayoutChildConfig {
  widthMode?: LayoutSizingMode;
  heightMode?: LayoutSizingMode;
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  flexGrow?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  constraints?: {
    horizontal: HorizontalConstraint;
    vertical: VerticalConstraint;
  };
}

export interface ResponsiveNodeOverride {
  visible?: boolean;
  width?: number;
  height?: number;
  layoutDirection?: LayoutDirection;
  gridColumns?: number;
  gap?: number;
  padding?: NodePadding;
}

export interface NodeTokenBindings {
  fill?: string;
  stroke?: string;
  radius?: string;
  gap?: string;
  padding?: string;
  fontSize?: string;
}

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
  /** Optional web semantic HTML tag (defaults to structural role when omitted). */
  semanticTag?: SemanticHtmlTag;
  /** Optional accessible label (aria-label) for semantic HTML export & a11y. */
  ariaLabel?: string;
  /** Optional link href when semanticTag is 'a'. */
  href?: string;
  /** Optional container Auto-Layout (Flex / Grid) configuration. */
  layout?: NodeLayoutConfig;
  /** Optional child sizing & constraint rules inside an Auto-Layout or responsive parent. */
  layoutChild?: NodeLayoutChildConfig;
  /** Optional per-breakpoint responsive overrides (desktop is the canonical base). */
  responsive?: Partial<Record<BreakpointId, ResponsiveNodeOverride>>;
  /** Optional explicit Design Token ID bindings (literals remain untouched unless bound). */
  tokenBindings?: NodeTokenBindings;
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

export type VectorShapeMeta =
  | { kind: 'polygon'; sides: number }
  | { kind: 'star'; spikes: number; innerRatio: number };

export interface PathNode extends NodeBase {
  type: 'path';
  points: VectorAnchorPoint[];
  closed: boolean;
  style: PathStyle;
  pathKind?: VectorPathKind;
  /** Optional compound subpaths for Illustrator Pathfinder cutouts/exclusions. */
  subpaths?: VectorSubpath[];
  /** Optional parametric metadata for live on-canvas polygon/star Smart Handles. */
  shapeMeta?: VectorShapeMeta;
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

export interface ComponentNodeOverride {
  fill?: string;
  text?: string;
}

export type ComponentInstanceOverrides = Record<string, ComponentNodeOverride>;

export interface ComponentSlotAssignment {
  text?: string;
  fill?: string;
  visible?: boolean;
}

export interface ComponentInstanceNode extends NodeBase {
  type: 'component-instance';
  componentId: string;
  overrides: ComponentInstanceOverrides;
  /** Optional selected option ID per ComponentVariantAxis ID. */
  variantSelection?: Record<string, string>;
  /** Optional content/visibility assignment per ComponentSlotDefinition ID. */
  slotAssignments?: Record<string, ComponentSlotAssignment>;
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

export interface ComponentVariantOverride {
  fill?: string;
  stroke?: string;
  text?: string;
  visible?: boolean;
}

export interface ComponentVariantOption {
  id: string;
  label: string;
  /** Per master-layer ID overrides applied when this variant option is active. */
  overrides: Record<string, ComponentVariantOverride>;
}

export interface ComponentVariantAxis {
  id: string;
  name: string;
  defaultOptionId: string;
  options: ComponentVariantOption[];
}

export interface ComponentSlotDefinition {
  id: string;
  name: string;
  /** Internal master node ID targeted by this slot. */
  targetNodeId: string;
  description?: string;
  defaultText?: string;
}

export interface ComponentDefinition {
  id: string;
  name: string;
  document: FolioDocument;
  createdAt: string;
  updatedAt: string;
  /** Optional named variant axes defining typed visual/content states. */
  variants?: ComponentVariantAxis[];
  /** Optional named slots enabling structured content insertion on instances. */
  slots?: ComponentSlotDefinition[];
}

export type DesignTokenLayer = 'primitive' | 'semantic';
export type DesignTokenCategory = 'color' | 'spacing' | 'radius' | 'typography';
export type DesignTokenUnit = 'px' | 'rem' | '%' | 'em';

export type DesignTokenValue =
  | { kind: 'literal'; value: string | number; unit?: DesignTokenUnit }
  | { kind: 'alias'; tokenId: string };

export interface DesignTokenDefinition {
  /** Stable internal token ID independent of editable token name. */
  id: string;
  name: string;
  layer: DesignTokenLayer;
  category: DesignTokenCategory;
  value: DesignTokenValue;
  description?: string;
  /** Optional theme-specific value overrides keyed by DesignThemeDefinition.id. */
  themeValues?: Record<string, DesignTokenValue>;
}

export interface DesignThemeDefinition {
  id: string;
  name: string;
}

export interface DesignTokenCollection {
  activeThemeId: string;
  themes: DesignThemeDefinition[];
  tokens: DesignTokenDefinition[];
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

export type CodeMappingCategory = 'generated' | 'mapped' | 'custom' | 'extension';
export type CodeModuleLanguage = 'html' | 'css' | 'tsx' | 'ts' | 'js';

/**
 * Developer-authored custom code or node/page extension stored inside the
 * unified `.flop` v2 project. Visual edits never overwrite custom or extension
 * modules, and stable IDs (`targetNodeId`, `targetPageId`) anchor extensions
 * safely across visual hierarchy updates.
 */
export interface CodeModuleRecord {
  id: string;
  path: string;
  language: CodeModuleLanguage;
  mapping: 'custom' | 'extension';
  content: string;
  targetNodeId?: string;
  targetPageId?: string;
  description?: string;
  updatedAt: string;
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
  /** Optional project-level Design Tokens & Theme definitions. */
  designTokens?: DesignTokenCollection;
  /** Optional developer-authored Custom & Extension code modules. */
  codeModules?: CodeModuleRecord[];
}

/** Current project alias used by the editor, persistence and file I/O. */
export type FolioProject = FolioProjectV2;

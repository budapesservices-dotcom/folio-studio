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
  | 'input'
  | 'img';

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

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface GradientStop {
  /** Stop position along gradient axis in [0, 1]. */
  offset: number;
  color: string;
  opacity?: number;
}

export type FillPaint =
  | {
      id: string;
      type: 'solid';
      color: string;
      opacity?: number;
      visible?: boolean;
    }
  | {
      id: string;
      type: 'linear-gradient';
      /** CSS gradient angle in degrees (0 = bottom-to-top, 90 = left-to-right, 135 = diagonal). */
      angle: number;
      stops: GradientStop[];
      opacity?: number;
      visible?: boolean;
    }
  | {
      id: string;
      type: 'radial-gradient';
      /** Normalized center coordinates & radius in [0, 1] (default 0.5, 0.5, 0.5). */
      cx?: number;
      cy?: number;
      r?: number;
      stops: GradientStop[];
      opacity?: number;
      visible?: boolean;
    };

export type VisualEffect =
  | {
      id: string;
      type: 'drop-shadow';
      x: number;
      y: number;
      blur: number;
      spread?: number;
      color: string;
      visible?: boolean;
    }
  | {
      id: string;
      type: 'inner-shadow';
      x: number;
      y: number;
      blur: number;
      spread?: number;
      color: string;
      visible?: boolean;
    }
  | {
      id: string;
      type: 'layer-blur';
      radius: number;
      visible?: boolean;
    }
  | {
      id: string;
      type: 'backdrop-blur';
      radius: number;
      visible?: boolean;
    };

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
  /** Optional CSS mix-blend-mode compositing mode (default 'normal'). */
  blendMode?: BlendMode;
  /** Optional visual effects stack (Drop Shadow, Inner Shadow, Layer Blur, Backdrop Blur). */
  effects?: VisualEffect[];
  /** When true, W and H scale proportionally in the Inspector and across all canvas resize handles. */
  aspectRatioLocked?: boolean;
}

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
  /** Optional ordered multi-fill paint stack (bottom-to-top; falls back to `fill` when omitted). */
  fills?: FillPaint[];
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
  /** Optional ordered multi-fill paint stack (bottom-to-top; falls back to `fill` when omitted). */
  fills?: FillPaint[];
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

export type TextAlign = 'left' | 'center' | 'right';
export type TextWrapMode = 'wrap' | 'nowrap';
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';
export type TextDecoration = 'none' | 'underline' | 'line-through';

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
    textAlign?: TextAlign;
    textWrap?: TextWrapMode;
    textTransform?: TextTransform;
    textDecoration?: TextDecoration;
  };
}

export type ImageFitMode = 'cover' | 'contain' | 'fill';

export interface ImageStyle {
  fit: ImageFitMode;
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
}

export interface ImageNode extends NodeBase {
  type: 'image';
  /** References an AssetReference.id inside project.assets. */
  assetId: string;
  /** Accessible alternative text for semantic <img> export. */
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  style: ImageStyle;
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
  | ImageNode
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
  /** Optional opt-in flag exposing this component inside Node Logic Component nodes. */
  nodeLogicEnabled?: boolean;
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

/** Typed values supported by Folio Node Logic variables and data ports. */
export type LogicValueType = 'string' | 'number' | 'boolean' | 'list' | 'object';
export type LogicVariableValue = string | number | boolean | readonly unknown[] | Readonly<Record<string, unknown>>;
export type LogicVariableScope = 'local' | 'global';
export type LogicVariablePersist = 'none' | 'local' | 'session';

/** Declared graph-scoped or project-scoped variable for Node Logic. */
export interface LogicVariableDefinition {
  /** Stable internal variable ID independent of editable display name. */
  id: string;
  name: string;
  valueType: LogicValueType;
  initialValue: LogicVariableValue;
  description?: string;
  scope?: LogicVariableScope;
  persist?: LogicVariablePersist;
  computed?: boolean;
  computedExpression?: string;
}

/**
 * Project/graph-level network defaults used by HTTP Request and Realtime Socket nodes.
 * Stores only an environment/secret key reference (`authSecretRef`, e.g. `API_TOKEN`),
 * never raw tokens or credentials in `.flop` files or exported bundles.
 */
export interface LogicNetworkSettings {
  baseUrl: string;
  globalHeaders: string;
  authSecretRef: string;
}

/** Versioned node graph contract for the Folio Node Logic engine (.flop v2 compatible). */
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

export interface LogicFrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LogicFrameExposedInput {
  portId: string;
  targetNodeId: string;
  targetPort: string;
  label: string;
  kind: 'exec' | 'data';
  dataType?: string;
}

export interface LogicFrameExposedOutput {
  portId: string;
  sourceNodeId: string;
  sourcePort: string;
  label: string;
  kind: 'exec' | 'data';
  dataType?: string;
}

export type LogicFrameExposedParamType = 'string' | 'number' | 'boolean' | 'color' | 'select';

export interface LogicFrameExposedParam {
  paramId: string;
  nodeId: string;
  field: string;
  label: string;
  type: LogicFrameExposedParamType;
}

export interface LogicFrameCompiledEdge {
  targetNodeId: string;
  targetPort: string;
}

export interface LogicFrameCompiledDataInput {
  sourceNodeId: string;
  sourcePort: string;
}

export interface LogicFrameCompiledStep {
  nodeId: string;
  order: number;
  nextByPort: Record<string, LogicFrameCompiledEdge[]>;
  dataInputs: Record<string, LogicFrameCompiledDataInput>;
  externalExitsByPort: Record<string, string[]>;
}

export interface LogicFrameCompiledPlan {
  version: 1;
  internalNodeIds: string[];
  entryRoutes: Record<string, { targetNodeId: string; targetPort: string }>;
  steps: LogicFrameCompiledStep[];
}

export interface LogicFrameBakedData {
  exposedInputs: LogicFrameExposedInput[];
  exposedOutputs: LogicFrameExposedOutput[];
  compiledPlan: LogicFrameCompiledPlan;
  exposedParams: LogicFrameExposedParam[];
  bakedAt?: string;
}

/** Smart Logic Frame grouping visual nodes and supporting Function Baking (.flop v2 compatible). */
export interface LogicFrame {
  id: string;
  title: string;
  color: string;
  bounds: LogicFrameBounds;
  childNodeIds: string[];
  isBaked: boolean;
  /** Pinned editable parameters preserved across unbake/bake transitions. */
  exposedParams?: LogicFrameExposedParam[];
  bakedData?: LogicFrameBakedData;
}

/** Reusable baked Smart Logic Frame preset persisted inside `.flop` v2 or local studio presets. */
export interface LogicFramePreset {
  id: string;
  name: string;
  description?: string;
  color: string;
  createdAt: string;
  frame: LogicFrame;
  nodes: LogicNode[];
  connections: LogicConnection[];
}

export interface LogicGraph {
  id: string;
  name: string;
  scope: 'project' | 'page' | 'component';
  targetId: string | null;
  /** Optional typed variables declared for this graph (omitted in legacy .flop v2 files). */
  variables?: LogicVariableDefinition[];
  /** Optional network settings (Base URL, Global Headers, Auth Token) for Network nodes. */
  networkSettings?: LogicNetworkSettings;
  /** Optional Smart Logic Frames (visual grouping & baked function blocks). */
  frames?: LogicFrame[];
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
  /** Optional SHA-256 content hash for deduplicated IndexedDB binary blob storage. */
  sha256?: string;
  /** Optional decoded binary byte length. */
  byteLength?: number;
  /** Optional natural pixel width/height for image assets. */
  width?: number;
  height?: number;
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

export type AnimationEasing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'spring';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'opacity'
  | 'rotation'
  | 'scale'
  | 'radius'
  | 'fill'
  | 'stroke'
  | 'strokeWidth';

export interface AnimationKeyframe {
  id: string;
  /** Time offset in milliseconds within [0, clip.durationMs]. */
  timeMs: number;
  /** Numeric value for geometry/opacity/scale/rotation/radius/strokeWidth, or CSS color string for fill/stroke. */
  value: number | string;
  easing: AnimationEasing;
}

export interface AnimationTrack {
  id: string;
  targetNodeId: string;
  property: AnimatableProperty;
  keyframes: AnimationKeyframe[];
}

export interface AnimationClip {
  id: string;
  name: string;
  pageId: string;
  durationMs: number;
  loop: boolean;
  autoplay: boolean;
  tracks: AnimationTrack[];
  createdAt: string;
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
  /** Optional Motion & Animation timeline clips anchored to pages & stable node IDs. */
  animations?: AnimationClip[];
  /** Optional reusable Smart Logic Frame presets saved by the user. */
  logicFramePresets?: LogicFramePreset[];
}

/** Current project alias used by the editor, persistence and file I/O. */
export type FolioProject = FolioProjectV2;

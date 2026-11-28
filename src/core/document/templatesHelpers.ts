import {
  createEllipseNode,
  createFrameNode,
  createRectNode,
  createTextNode,
} from './factory';
import type {
  DesignNode,
  EllipseNode,
  FillPaint,
  FrameNode,
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
  NodeTransitionConfig,
  PathNode,
  RectNode,
  SemanticHtmlTag,
  TextNode,
  VectorAnchorPoint,
  VisualEffect,
} from './types';

export interface SimplePathPoint {
  x: number;
  y: number;
  type?: 'corner' | 'smooth' | 'symmetric';
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export type TemplateCategory = 'ui' | 'sections' | 'pages' | 'vectors';
export type TemplateInsertMode = 'nodes' | 'component' | 'page';
export type TemplateWorkspaceScope = 'main' | 'component';

export interface TemplateOrigin {
  readonly x: number;
  readonly y: number;
}

export type TemplateIdFactory = (suffix: string) => string;

export interface TemplateLogicBuildContext {
  readonly scope: 'page' | 'component';
  readonly targetId: string;
  readonly nodes: readonly DesignNode[];
  readonly nodeByKey: Readonly<Record<string, DesignNode>>;
  readonly makeId: TemplateIdFactory;
}

export interface TemplateBuiltBundle {
  readonly nodes: DesignNode[];
  readonly nodeByKey: Readonly<Record<string, DesignNode>>;
  readonly logicGraph: LogicGraph | null;
}

export interface StudioTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly previewSurface: 'dark' | 'light';
  readonly pageBackground?: string;
  readonly logicHighlights?: readonly string[];
  readonly buildNodes: (origin: TemplateOrigin, makeId: TemplateIdFactory) => DesignNode[];
  readonly buildBundle?: (
    origin: TemplateOrigin,
    makeId: TemplateIdFactory,
    logicTarget?: { scope: 'page' | 'component'; targetId: string },
  ) => TemplateBuiltBundle;
}

export const FONT_DISPLAY = '"Space Grotesk", Inter, system-ui, sans-serif';
export const FONT_SANS = '"Plus Jakarta Sans", Inter, system-ui, sans-serif';
export const FONT_EDITORIAL = '"Instrument Serif", Georgia, serif';
export const FONT_BODY = '"DM Sans", Inter, system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

export function makeLinearGradient(
  id: string,
  angle: number,
  stops: readonly { offset: number; color: string }[],
): FillPaint {
  return {
    id,
    type: 'linear-gradient',
    angle,
    stops: stops.map((s) => ({ offset: s.offset, color: s.color })),
    opacity: 1,
    visible: true,
  };
}

export function makeDropShadow(
  id: string,
  offsetY: number,
  blur: number,
  color: string,
  spread = 0,
  offsetX = 0,
): VisualEffect {
  return {
    id,
    type: 'drop-shadow',
    x: offsetX,
    y: offsetY,
    blur,
    spread,
    color,
    visible: true,
  };
}

export function makeInnerShadow(
  id: string,
  offsetY: number,
  blur: number,
  color: string,
): VisualEffect {
  return {
    id,
    type: 'inner-shadow',
    x: 0,
    y: offsetY,
    blur,
    spread: 0,
    color,
    visible: true,
  };
}

function normalizeTransition(
  input?: string | NodeTransitionConfig,
): NodeTransitionConfig | undefined {
  if (!input) return undefined;
  if (typeof input !== 'string') return input;
  const msMatch = input.match(/(\d+)\s*ms/i);
  const durationMs = msMatch ? Math.max(50, Math.min(2000, Number(msMatch[1]))) : 200;
  const preset: NodeTransitionConfig['preset'] =
    durationMs <= 160 ? 'fast' : input.includes('spring') ? 'bouncy' : 'smooth';
  return { preset, durationMs };
}

export function makeFrame(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: {
    parentId?: string;
    fill?: string;
    fills?: FillPaint[];
    stroke?: string;
    strokeWidth?: number;
    radius?: number;
    clipContent?: boolean;
    isSection?: boolean;
    semanticTag?: SemanticHtmlTag;
    cursor?: 'pointer' | 'default';
    effects?: VisualEffect[];
    visible?: boolean;
    opacity?: number;
    hoverFill?: string;
    hoverStroke?: string;
    transition?: string | NodeTransitionConfig;
  } = {},
): FrameNode {
  const base = createFrameNode(x, y, width, height);
  const transition = normalizeTransition(opts.transition);
  return {
    ...base,
    id,
    name,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.visible === false ? { visible: false } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    clipContent: opts.clipContent ?? false,
    ...(opts.isSection ? { isSection: true } : {}),
    ...(opts.semanticTag ? { semanticTag: opts.semanticTag } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.effects ? { effects: opts.effects } : {}),
    ...(transition ? { transition } : {}),
    ...(opts.hoverFill || opts.hoverStroke
      ? {
          stateOverrides: {
            hover: {
              ...(opts.hoverFill ? { fill: opts.hoverFill } : {}),
              ...(opts.hoverStroke ? { stroke: opts.hoverStroke } : {}),
            },
          },
        }
      : {}),
    style: {
      ...base.style,
      fill: opts.fill ?? '#141923',
      ...(opts.fills ? { fills: opts.fills } : {}),
      stroke: opts.stroke ?? 'none',
      strokeWidth: opts.strokeWidth ?? (opts.stroke && opts.stroke !== 'none' ? 1 : 0),
      radius: opts.radius ?? 14,
    },
  };
}

export function makeRect(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: {
    parentId?: string;
    fill?: string;
    fills?: FillPaint[];
    stroke?: string;
    strokeWidth?: number;
    radius?: number;
    opacity?: number;
    visible?: boolean;
    semanticTag?: SemanticHtmlTag;
    cursor?: 'pointer' | 'default';
    pointerEvents?: 'auto' | 'none';
    effects?: VisualEffect[];
    hoverFill?: string;
    hoverStroke?: string;
    hoverOpacity?: number;
    transition?: string | NodeTransitionConfig;
  } = {},
): RectNode {
  const base = createRectNode(0);
  const transition = normalizeTransition(opts.transition);
  return {
    ...base,
    id,
    name,
    x,
    y,
    width,
    height,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.visible === false ? { visible: false } : {}),
    ...(opts.semanticTag ? { semanticTag: opts.semanticTag } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.pointerEvents ? { pointerEvents: opts.pointerEvents } : {}),
    ...(opts.effects ? { effects: opts.effects } : {}),
    ...(transition ? { transition } : {}),
    ...(opts.hoverFill || opts.hoverStroke || opts.hoverOpacity !== undefined
      ? {
          stateOverrides: {
            hover: {
              ...(opts.hoverFill ? { fill: opts.hoverFill } : {}),
              ...(opts.hoverStroke ? { stroke: opts.hoverStroke } : {}),
              ...(opts.hoverOpacity !== undefined ? { opacity: opts.hoverOpacity } : {}),
            },
          },
        }
      : {}),
    style: {
      ...base.style,
      fill: opts.fill ?? '#6366f1',
      ...(opts.fills ? { fills: opts.fills } : {}),
      stroke: opts.stroke ?? 'none',
      strokeWidth: opts.strokeWidth ?? (opts.stroke && opts.stroke !== 'none' ? 1 : 0),
      radius: opts.radius ?? 8,
    },
  };
}

export function makeEllipse(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: {
    parentId?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
    cursor?: 'pointer' | 'default';
    pointerEvents?: 'auto' | 'none';
    effects?: VisualEffect[];
    transition?: string | NodeTransitionConfig;
  } = {},
): EllipseNode {
  const base = createEllipseNode(0);
  const transition = normalizeTransition(opts.transition);
  return {
    ...base,
    id,
    name,
    x,
    y,
    width,
    height,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.pointerEvents ? { pointerEvents: opts.pointerEvents } : {}),
    ...(opts.effects ? { effects: opts.effects } : {}),
    ...(transition ? { transition } : {}),
    style: {
      ...base.style,
      fill: opts.fill ?? '#6366f1',
      stroke: opts.stroke ?? 'none',
      strokeWidth: opts.strokeWidth ?? (opts.stroke && opts.stroke !== 'none' ? 1 : 0),
    },
  };
}

export function makeText(
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: {
    parentId?: string;
    fill?: string;
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: 'left' | 'center' | 'right';
    verticalAlign?: 'top' | 'middle' | 'bottom';
    textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    semanticTag?: SemanticHtmlTag;
    cursor?: 'pointer' | 'default';
    pointerEvents?: 'auto' | 'none';
    visible?: boolean;
    opacity?: number;
  } = {},
): TextNode {
  const base = createTextNode(0);
  return {
    ...base,
    id,
    name,
    text,
    x,
    y,
    width,
    height,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.visible === false ? { visible: false } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.semanticTag ? { semanticTag: opts.semanticTag } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.pointerEvents ? { pointerEvents: opts.pointerEvents } : {}),
    style: {
      ...base.style,
      fill: opts.fill ?? '#F8FAFC',
      fontSize: opts.fontSize ?? 15,
      fontWeight: opts.fontWeight ?? 500,
      fontFamily: opts.fontFamily ?? FONT_SANS,
      lineHeight: opts.lineHeight ?? 1.4,
      ...(opts.letterSpacing !== undefined ? { letterSpacing: opts.letterSpacing } : {}),
      ...(opts.textAlign ? { textAlign: opts.textAlign } : {}),
      ...(opts.verticalAlign ? { verticalAlign: opts.verticalAlign } : {}),
      ...(opts.textTransform ? { textTransform: opts.textTransform } : {}),
    },
  };
}

export function makePath(
  id: string,
  name: string,
  points: readonly SimplePathPoint[],
  opts: {
    parentId?: string;
    closed?: boolean;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'miter' | 'round' | 'bevel';
    opacity?: number;
  } = {},
): PathNode {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 0;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 0;
  const width = Math.max(1, Math.round((maxX - minX) * 100) / 100);
  const height = Math.max(1, Math.round((maxY - minY) * 100) / 100);

  const anchors: VectorAnchorPoint[] = points.map((p, index) => ({
    id: `${id}-pt-${index + 1}`,
    x: Math.round((p.x - minX) * 100) / 100,
    y: Math.round((p.y - minY) * 100) / 100,
    pointType: p.type ?? 'corner',
    ...(p.handleIn
      ? {
          handleIn: {
            x: Math.round((p.handleIn.x - minX) * 100) / 100,
            y: Math.round((p.handleIn.y - minY) * 100) / 100,
          },
        }
      : {}),
    ...(p.handleOut
      ? {
          handleOut: {
            x: Math.round((p.handleOut.x - minX) * 100) / 100,
            y: Math.round((p.handleOut.y - minY) * 100) / 100,
          },
        }
      : {}),
  }));

  return {
    id,
    type: 'path',
    name,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    x: Math.round(minX * 100) / 100,
    y: Math.round(minY * 100) / 100,
    width,
    height,
    rotation: 0,
    opacity: opts.opacity ?? 1,
    visible: true,
    locked: false,
    closed: opts.closed ?? true,
    points: anchors,
    style: {
      fill: opts.fill ?? 'none',
      stroke: opts.stroke ?? '#e2e8f0',
      strokeWidth: opts.strokeWidth ?? 2,
      strokeLinecap: opts.strokeLinecap ?? 'round',
      strokeLinejoin: opts.strokeLinejoin ?? 'round',
    },
  };
}

/**
 * Helper for assembling structured templates with named node keys and a clean,
 * validated Node Logic graph.
 */
export class TemplateBuilder {
  private readonly nodes: DesignNode[] = [];
  private readonly keyMap: Record<string, DesignNode> = {};

  constructor(
    public readonly origin: TemplateOrigin,
    public readonly makeId: TemplateIdFactory,
  ) {}

  add<T extends DesignNode>(key: string, node: T): T {
    this.nodes.push(node);
    this.keyMap[key] = node;
    return node;
  }

  id(key: string): string {
    const node = this.keyMap[key];
    if (!node) {
      throw new Error(`TemplateBuilder: unknown node key "${key}"`);
    }
    return node.id;
  }

  getNodes(): DesignNode[] {
    return this.nodes;
  }

  getKeyMap(): Readonly<Record<string, DesignNode>> {
    return this.keyMap;
  }
}

/**
 * Ergonomic, deterministic Folio Node Logic v2 Graph Builder.
 * Automatically places nodes on a clean grid (column × row) so the resulting
 * graph is immediately readable in the Node Logic workspace.
 */
export class LogicGraphBuilder {
  private readonly variables: LogicVariableDefinition[] = [];
  private readonly nodes: LogicNode[] = [];
  private readonly connections: LogicConnection[] = [];
  private readonly now = new Date().toISOString();

  constructor(
    private readonly makeId: TemplateIdFactory,
    private readonly graphName: string,
    private readonly scope: 'page' | 'component',
    private readonly targetId: string,
  ) {}

  variable(
    key: string,
    name: string,
    valueType: LogicValueType,
    initialValue: LogicVariableValue,
  ): string {
    const id = this.makeId(`var-${key}`);
    this.variables.push({
      id,
      name,
      valueType,
      initialValue,
      scope: 'local',
      persist: 'none',
    });
    return id;
  }

  node(
    key: string,
    type: string,
    col: number,
    row: number,
    data: Record<string, string | number | boolean | null>,
    label?: string,
  ): string {
    const id = this.makeId(`ln-${key}`);
    this.nodes.push({
      id,
      type,
      ...(label ? { label } : {}),
      x: 48 + Math.round(col * 280),
      y: 48 + Math.round(row * 148),
      data,
    });
    return id;
  }

  connect(
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string,
  ): void {
    const idx = this.connections.length + 1;
    this.connections.push({
      id: this.makeId(`lc-${idx}`),
      sourceNodeId,
      sourcePortId,
      targetNodeId,
      targetPortId,
    });
  }

  chain(steps: readonly string[], startPort = 'exec'): void {
    for (let i = 0; i < steps.length - 1; i += 1) {
      const fromPort = i === 0 ? startPort : 'next';
      this.connect(steps[i], fromPort, steps[i + 1], 'exec');
    }
  }

  build(): LogicGraph {
    return {
      id: this.makeId('logic-graph'),
      name: this.graphName,
      scope: this.scope,
      targetId: this.targetId,
      variables: this.variables,
      nodes: this.nodes,
      connections: this.connections,
      createdAt: this.now,
      updatedAt: this.now,
    };
  }
}

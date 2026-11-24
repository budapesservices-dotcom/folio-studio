/**
 * Folio Node Logic v1 — Typed Node & Port Catalog.
 *
 * Framework-independent domain vocabulary for Folio's visual behavior engine.
 * Every built-in v1 node serializes strictly into `.flop` v2 `LogicNode`
 * records (`data: Record<string, string | number | boolean | null>`),
 * preserving 100% backward compatibility with existing `.flop` v2 projects.
 */

import type {
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
} from '../../core/document/types';

export type LogicPortDirection = 'in' | 'out';
export type LogicPortDataType = 'exec' | 'string' | 'number' | 'boolean' | 'any';
export type LogicNodeCategory = 'source' | 'event' | 'state' | 'logic' | 'action';

export type LogicCompareOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';
export type LogicHoverPhase = 'enter' | 'leave';
export type LogicVisibilityMode = 'show' | 'hide' | 'toggle';

export const BUILT_IN_LOGIC_NODE_TYPES = [
  // Source Anchor Nodes (identify Page, Component, Layer, or Theme in the graph)
  'source.page',
  'source.component',
  'source.element',
  'source.theme',
  // Event Triggers
  'event.on-click',
  'event.on-hover',
  'event.on-page-load',
  'event.on-state-change',
  // State & Variables
  'state.get',
  'state.set',
  'state.toggle',
  'state.increment',
  // Logic & Conditions
  'logic.branch',
  'logic.compare',
  'logic.template',
  // UI & Navigation Actions
  'action.set-visible',
  'action.set-text',
  'action.set-fill',
  'action.set-variant',
  'action.navigate',
  'action.set-theme',
  'action.play-animation',
] as const;

export type BuiltInLogicNodeType = (typeof BUILT_IN_LOGIC_NODE_TYPES)[number];

export const LOGIC_COMPARE_OPERATORS: readonly LogicCompareOperator[] = Object.freeze([
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
]);

export interface LogicPortDefinition {
  readonly id: string;
  readonly label: string;
  readonly direction: LogicPortDirection;
  readonly dataType: LogicPortDataType;
}

export interface LogicNodeTypeDefinition {
  readonly type: BuiltInLogicNodeType;
  readonly category: LogicNodeCategory;
  readonly label: string;
  readonly description: string;
  readonly ports: readonly LogicPortDefinition[];
  readonly defaultData: Readonly<Record<string, string | number | boolean | null>>;
}

function defineNode(def: LogicNodeTypeDefinition): LogicNodeTypeDefinition {
  return Object.freeze({
    ...def,
    ports: Object.freeze(def.ports.map((port) => Object.freeze({ ...port }))),
    defaultData: Object.freeze({ ...def.defaultData }),
  });
}

export const LOGIC_NODE_CATALOG: Readonly<Record<BuiltInLogicNodeType, LogicNodeTypeDefinition>> = Object.freeze({
  'source.page': defineNode({
    type: 'source.page',
    category: 'source',
    label: 'Page',
    description: 'Identifies a project page in this graph. Emits On Load when active and exposes its Route for Navigate.',
    ports: [
      { id: 'onLoad', label: 'On Load', direction: 'out', dataType: 'exec' },
      { id: 'route', label: 'Route', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      pageId: '',
    },
  }),
  'source.component': defineNode({
    type: 'source.component',
    category: 'source',
    label: 'Component',
    description: 'Represents a component sent to Node Logic. Fires On Click or On Hover whenever an instance is interacted with.',
    ports: [
      { id: 'onClick', label: 'On Click', direction: 'out', dataType: 'exec' },
      { id: 'onHover', label: 'On Hover', direction: 'out', dataType: 'exec' },
      { id: 'componentId', label: 'Component ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      componentId: '',
    },
  }),
  'source.element': defineNode({
    type: 'source.element',
    category: 'source',
    label: 'Canvas Layer',
    description: 'Represents a specific canvas layer (button, card, text) in this graph with direct On Click and On Hover outputs.',
    ports: [
      { id: 'onClick', label: 'On Click', direction: 'out', dataType: 'exec' },
      { id: 'onHover', label: 'On Hover', direction: 'out', dataType: 'exec' },
      { id: 'target', label: 'Layer ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      targetNodeId: '',
    },
  }),
  'source.theme': defineNode({
    type: 'source.theme',
    category: 'source',
    label: 'Theme',
    description: 'Identifies a Design Token theme in this graph so you can patch its Theme ID directly into Set Theme.',
    ports: [
      { id: 'themeId', label: 'Theme ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      themeId: '',
    },
  }),
  'event.on-click': defineNode({
    type: 'event.on-click',
    category: 'event',
    label: 'On Click',
    description: 'Fires when the targeted design node is clicked.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
    },
  }),
  'event.on-hover': defineNode({
    type: 'event.on-hover',
    category: 'event',
    label: 'On Hover',
    description: 'Fires when the pointer enters or leaves the targeted design node.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      phase: 'enter',
    },
  }),
  'event.on-page-load': defineNode({
    type: 'event.on-page-load',
    category: 'event',
    label: 'On Page Load',
    description: 'Fires once when the page mounts in preview or runtime.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {},
  }),
  'event.on-state-change': defineNode({
    type: 'event.on-state-change',
    category: 'event',
    label: 'On State Change',
    description: 'Fires whenever the selected graph or project variable changes value.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
    },
  }),
  'state.get': defineNode({
    type: 'state.get',
    category: 'state',
    label: 'Get State',
    description: 'Reads the current value of a declared variable.',
    ports: [
      { id: 'value', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
    },
  }),
  'state.set': defineNode({
    type: 'state.set',
    category: 'state',
    label: 'Set State',
    description: 'Updates a declared variable from a connected input or literal value.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
      value: null,
    },
  }),
  'state.toggle': defineNode({
    type: 'state.toggle',
    category: 'state',
    label: 'Toggle State',
    description: 'Flips a boolean variable between true and false.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      variableId: '',
    },
  }),
  'state.increment': defineNode({
    type: 'state.increment',
    category: 'state',
    label: 'Increment State',
    description: 'Adds a finite numeric step to a number variable with optional min/max clamping.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'step', label: 'Step', direction: 'in', dataType: 'number' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      variableId: '',
      step: 1,
      min: null,
      max: null,
    },
  }),
  'logic.branch': defineNode({
    type: 'logic.branch',
    category: 'logic',
    label: 'Branch (If / Else)',
    description: 'Routes execution to the True or False branch based on a boolean condition.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'condition', label: 'Condition', direction: 'in', dataType: 'boolean' },
      { id: 'true', label: 'True', direction: 'out', dataType: 'exec' },
      { id: 'false', label: 'False', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      condition: false,
    },
  }),
  'logic.compare': defineNode({
    type: 'logic.compare',
    category: 'logic',
    label: 'Compare',
    description: 'Compares two values using a deterministic operator and outputs a boolean.',
    ports: [
      { id: 'left', label: 'Left', direction: 'in', dataType: 'any' },
      { id: 'right', label: 'Right', direction: 'in', dataType: 'any' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      operator: '==',
      left: null,
      right: null,
    },
  }),
  'logic.template': defineNode({
    type: 'logic.template',
    category: 'logic',
    label: 'Text Template',
    description: 'Formats text safely using {{variable}} placeholders and optional connected input.',
    ports: [
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'text', label: 'Text', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      template: '{{value}}',
    },
  }),
  'action.set-visible': defineNode({
    type: 'action.set-visible',
    category: 'action',
    label: 'Set Visible',
    description: 'Shows, hides, or toggles the visibility of a targeted design node.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'visible', label: 'Visible', direction: 'in', dataType: 'boolean' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      mode: 'toggle',
    },
  }),
  'action.set-text': defineNode({
    type: 'action.set-text',
    category: 'action',
    label: 'Set Text',
    description: 'Updates the displayed text content of a targeted text node.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'text', label: 'Text', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      text: '',
    },
  }),
  'action.set-fill': defineNode({
    type: 'action.set-fill',
    category: 'action',
    label: 'Set Fill Color',
    description: 'Updates the sanitized CSS fill color of a targeted design node.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'fill', label: 'Color', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      fill: '#3B82F6',
    },
  }),
  'action.set-variant': defineNode({
    type: 'action.set-variant',
    category: 'action',
    label: 'Set Variant',
    description: 'Switches the active variant option of a targeted component instance.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'optionId', label: 'Option ID', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      axisId: '',
      optionId: '',
    },
  }),
  'action.navigate': defineNode({
    type: 'action.navigate',
    category: 'action',
    label: 'Navigate',
    description: 'Navigates to another Folio page route or an allowlisted safe URL.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'route', label: 'Route', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      route: '/',
    },
  }),
  'action.set-theme': defineNode({
    type: 'action.set-theme',
    category: 'action',
    label: 'Set Theme',
    description: 'Switches the active Design Token theme in runtime and preview.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'themeId', label: 'Theme ID', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      themeId: '',
    },
  }),
  'action.play-animation': defineNode({
    type: 'action.play-animation',
    category: 'action',
    label: 'Play Animation',
    description: 'Plays a Motion Timeline animation clip on the active page in runtime and Live Preview.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      clipId: '',
    },
  }),
});

export function isBuiltInLogicNodeType(type: string): type is BuiltInLogicNodeType {
  return Object.prototype.hasOwnProperty.call(LOGIC_NODE_CATALOG, type);
}

export function getLogicNodeDefinition(type: string): LogicNodeTypeDefinition | undefined {
  if (!isBuiltInLogicNodeType(type)) return undefined;
  return LOGIC_NODE_CATALOG[type];
}

export function getLogicNodePort(
  type: string,
  portId: string,
): LogicPortDefinition | undefined {
  const def = getLogicNodeDefinition(type);
  if (!def) return undefined;
  return def.ports.find((port) => port.id === portId);
}

/**
 * Checks whether a connection from `sourceType` to `targetType` is allowed.
 * Control-flow (`exec`) ports may only connect to `exec` ports.
 * Data ports allow exact type matches or wildcard `'any'` ports, plus
 * string coercion into `'string'` inputs (e.g. number/boolean -> text).
 */
export function areLogicPortTypesCompatible(
  sourceType: LogicPortDataType,
  targetType: LogicPortDataType,
): boolean {
  if (sourceType === 'exec' || targetType === 'exec') {
    return sourceType === 'exec' && targetType === 'exec';
  }
  if (sourceType === 'any' || targetType === 'any') return true;
  if (sourceType === targetType) return true;
  if (targetType === 'string' && (sourceType === 'number' || sourceType === 'boolean')) {
    return true;
  }
  return false;
}

export function createLogicVariable(args: {
  id: string;
  name: string;
  valueType: LogicValueType;
  initialValue: LogicVariableValue;
  description?: string;
}): LogicVariableDefinition {
  return {
    id: args.id,
    name: args.name,
    valueType: args.valueType,
    initialValue: args.initialValue,
    ...(args.description !== undefined ? { description: args.description } : {}),
  };
}

export function createLogicNode(args: {
  id: string;
  type: BuiltInLogicNodeType;
  x?: number;
  y?: number;
  data?: Record<string, string | number | boolean | null>;
}): LogicNode {
  const def = LOGIC_NODE_CATALOG[args.type];
  return {
    id: args.id,
    type: args.type,
    x: args.x ?? 0,
    y: args.y ?? 0,
    data: {
      ...def.defaultData,
      ...(args.data ?? {}),
    },
  };
}

export function createLogicConnection(args: {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}): LogicConnection {
  return {
    id: args.id,
    sourceNodeId: args.sourceNodeId,
    sourcePortId: args.sourcePortId,
    targetNodeId: args.targetNodeId,
    targetPortId: args.targetPortId,
  };
}

export function createLogicGraph(args: {
  id: string;
  name: string;
  scope: 'project' | 'page' | 'component';
  targetId: string | null;
  variables?: LogicVariableDefinition[];
  nodes?: LogicNode[];
  connections?: LogicConnection[];
  now?: string;
}): LogicGraph {
  const timestamp = args.now ?? new Date().toISOString();
  return {
    id: args.id,
    name: args.name,
    scope: args.scope,
    targetId: args.scope === 'project' ? null : args.targetId,
    ...(args.variables && args.variables.length > 0 ? { variables: args.variables } : {}),
    nodes: args.nodes ?? [],
    connections: args.connections ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

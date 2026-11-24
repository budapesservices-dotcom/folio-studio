/**
 * Folio Node Logic v2 — Efficient 31-Node, 7-Category Typed Catalog.
 *
 * Categories (31 primary nodes):
 * 1. Sources (3)       — Element / Layer, App / Context, External Data
 * 2. Events (8)        — On Click, On Hover, On Input, On Key Press, On Drag,
 *                        On Scroll / View, On Lifecycle, On State Change
 *                        (all events include Once, Debounce ms, Throttle ms)
 * 3. State (3)         — Get State, Toggle State, Update State (dynamic by type)
 * 4. Logic (5)         — Branch, Condition, Math, Text, List Processor
 * 5. Actions (6)       — Set Layer, Set Variant, Media & Animation, Navigate,
 *                        Overlay & Toast, System & Form
 * 6. Flow & Timing (3) — Delay, Loop / Timer, Flow Control
 * 7. Network (3)       — HTTP Request, JSON Tool, Realtime Socket
 *
 * Legacy v1 node types remain registered (`legacy: true`) so existing `.flop` v2
 * projects load, validate, simulate, and compile without data loss while the
 * editor palette showcases the clean 31-node architecture.
 */

import type {
  LogicConnection,
  LogicGraph,
  LogicNetworkSettings,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariablePersist,
  LogicVariableScope,
  LogicVariableValue,
} from '../../core/document/types';

export type LogicPortDirection = 'in' | 'out';
export type LogicPortDataType = 'exec' | 'string' | 'number' | 'boolean' | 'list' | 'object' | 'any';
export type LogicNodeCategory =
  | 'source'
  | 'event'
  | 'state'
  | 'logic'
  | 'action'
  | 'flow'
  | 'network';

export type LogicCompareOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';
export type LogicHoverPhase = 'enter' | 'leave';
export type LogicVisibilityMode = 'show' | 'hide' | 'toggle';

export const PRIMARY_LOGIC_NODE_TYPES = [
  // 1. SOURCES (3)
  'source.element',
  'source.context',
  'source.external',
  // 2. EVENTS (8)
  'event.on-click',
  'event.on-hover',
  'event.on-input',
  'event.on-key-press',
  'event.on-drag',
  'event.on-scroll-view',
  'event.on-lifecycle',
  'event.on-state-change',
  // 3. STATE (3)
  'state.get',
  'state.toggle',
  'state.update',
  // 4. LOGIC (5)
  'logic.branch',
  'logic.condition',
  'logic.math',
  'logic.text',
  'logic.list',
  // 5. ACTIONS (6)
  'action.set-layer',
  'action.set-variant',
  'action.media-animation',
  'action.navigate',
  'action.overlay-toast',
  'action.system-form',
  // 6. FLOW & TIMING (3)
  'flow.delay',
  'flow.loop-timer',
  'flow.control',
  // 7. NETWORK (3)
  'network.http',
  'network.json',
  'network.socket',
] as const;

export const LEGACY_LOGIC_NODE_TYPES = [
  'source.page',
  'source.component',
  'source.theme',
  'event.on-page-load',
  'state.set',
  'state.increment',
  'logic.compare',
  'logic.template',
  'action.set-visible',
  'action.set-text',
  'action.set-fill',
  'action.set-theme',
  'action.play-animation',
] as const;

export const BUILT_IN_LOGIC_NODE_TYPES = [
  ...PRIMARY_LOGIC_NODE_TYPES,
  ...LEGACY_LOGIC_NODE_TYPES,
] as const;

export type PrimaryLogicNodeType = (typeof PRIMARY_LOGIC_NODE_TYPES)[number];
export type LegacyLogicNodeType = (typeof LEGACY_LOGIC_NODE_TYPES)[number];
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
  readonly legacy?: boolean;
}

const EVENT_COMMON_DEFAULT_DATA = Object.freeze({
  once: false,
  debounceMs: 0,
  throttleMs: 0,
});

function defineNode(def: LogicNodeTypeDefinition): LogicNodeTypeDefinition {
  return Object.freeze({
    ...def,
    ports: Object.freeze(def.ports.map((port) => Object.freeze({ ...port }))),
    defaultData: Object.freeze({ ...def.defaultData }),
  });
}

export const LOGIC_NODE_CATALOG: Readonly<Record<BuiltInLogicNodeType, LogicNodeTypeDefinition>> = Object.freeze({
  // =========================================================================
  // 1. SOURCES (3)
  // =========================================================================
  'source.element': defineNode({
    type: 'source.element',
    category: 'source',
    label: 'Element / Layer',
    description: 'Reads live properties (value, text, fill, visibility, bounds) or listens to clicks/hovers on a target layer, form input, or sent component.',
    ports: [
      { id: 'onClick', label: 'On Click', direction: 'out', dataType: 'exec' },
      { id: 'onHover', label: 'On Hover', direction: 'out', dataType: 'exec' },
      { id: 'value', label: 'Property', direction: 'out', dataType: 'any' },
      { id: 'target', label: 'Layer ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      targetNodeId: '',
      componentId: '',
      property: 'value',
    },
  }),
  'source.context': defineNode({
    type: 'source.context',
    category: 'source',
    label: 'App / Context',
    description: 'Exposes app-wide context: active Page, Theme, URL / Query Params, Viewport dimensions, or User / Auth info.',
    ports: [
      { id: 'onLoad', label: 'On Load', direction: 'out', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'out', dataType: 'any' },
      { id: 'route', label: 'Route', direction: 'out', dataType: 'string' },
      { id: 'themeId', label: 'Theme ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      contextKind: 'page',
      pageId: '',
      themeId: '',
      paramKey: '',
      viewportMetric: 'width',
      authField: 'isSignedIn',
    },
  }),
  'source.external': defineNode({
    type: 'source.external',
    category: 'source',
    label: 'External Data',
    description: 'Connects an external REST API endpoint or CMS collection as a live data source.',
    ports: [
      { id: 'onReady', label: 'On Ready', direction: 'out', dataType: 'exec' },
      { id: 'data', label: 'Data', direction: 'out', dataType: 'list' },
      { id: 'count', label: 'Count', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      sourceKind: 'api',
      endpoint: '/items',
      collection: '',
      query: '',
    },
  }),

  // =========================================================================
  // 2. EVENTS (8) — All share Once, Debounce (ms), Throttle (ms)
  // =========================================================================
  'event.on-click': defineNode({
    type: 'event.on-click',
    category: 'event',
    label: 'On Click',
    description: 'Fires on Click, Double Click, or Click Outside for the targeted design layer.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'target', label: 'Target ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      targetNodeId: '',
      mode: 'click',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-hover': defineNode({
    type: 'event.on-hover',
    category: 'event',
    label: 'On Hover',
    description: 'Fires when the pointer enters or leaves the targeted design layer.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'isHovered', label: 'Hovered', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      targetNodeId: '',
      phase: 'enter',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-input': defineNode({
    type: 'event.on-input',
    category: 'event',
    label: 'On Input',
    description: 'Fires on input Change, Focus, Blur, or Form Submit and outputs the live field value.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      targetNodeId: '',
      mode: 'change',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-key-press': defineNode({
    type: 'event.on-key-press',
    category: 'event',
    label: 'On Key Press',
    description: 'Fires when a keyboard key or shortcut combo (e.g. Enter, Escape, Ctrl+K) is pressed or released.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'key', label: 'Key', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      keyCombo: 'Enter',
      phase: 'down',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-drag': defineNode({
    type: 'event.on-drag',
    category: 'event',
    label: 'On Drag',
    description: 'Fires on Drag Start, Drag Move, or Drop for the targeted layer with pointer coordinates.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'x', label: 'X', direction: 'out', dataType: 'number' },
      { id: 'y', label: 'Y', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      targetNodeId: '',
      phase: 'start',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-scroll-view': defineNode({
    type: 'event.on-scroll-view',
    category: 'event',
    label: 'On Scroll / View',
    description: 'Fires on Page Scroll or when a target layer Enters or Leaves the viewport.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'progress', label: 'Progress', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      targetNodeId: '',
      mode: 'enter-view',
      threshold: 0.2,
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-lifecycle': defineNode({
    type: 'event.on-lifecycle',
    category: 'event',
    label: 'On Lifecycle',
    description: 'Fires on Page Load, Route Change, Viewport Resize, or Animation End.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'detail', label: 'Detail', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      trigger: 'page-load',
      clipId: '',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),
  'event.on-state-change': defineNode({
    type: 'event.on-state-change',
    category: 'event',
    label: 'On State Change',
    description: 'Watches a state variable and fires whenever its value changes.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
      ...EVENT_COMMON_DEFAULT_DATA,
    },
  }),

  // =========================================================================
  // 3. STATE (3)
  // =========================================================================
  'state.get': defineNode({
    type: 'state.get',
    category: 'state',
    label: 'Get State',
    description: 'Reads the current value of a declared state variable (Number, Boolean, String, List, or Object).',
    ports: [
      { id: 'value', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
    },
  }),
  'state.toggle': defineNode({
    type: 'state.toggle',
    category: 'state',
    label: 'Toggle State',
    description: 'Flips a Boolean state variable between true and false.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      variableId: '',
    },
  }),
  'state.update': defineNode({
    type: 'state.update',
    category: 'state',
    label: 'Update State',
    description: 'Dynamically updates any variable by type: Set, Increment, Push/Remove (List), Set Property (Object), Cycle, or Reset.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'any' },
    ],
    defaultData: {
      variableId: '',
      operation: 'set',
      value: null,
      step: 1,
      min: null,
      max: null,
      propertyPath: '',
      cycleValues: '',
    },
  }),

  // =========================================================================
  // 4. LOGIC (5)
  // =========================================================================
  'logic.branch': defineNode({
    type: 'logic.branch',
    category: 'logic',
    label: 'Branch',
    description: 'Routes execution using If / Else, Else If, or Switch / Case matching.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'condition', label: 'Condition', direction: 'in', dataType: 'boolean' },
      { id: 'value', label: 'Match Val', direction: 'in', dataType: 'any' },
      { id: 'true', label: 'True / Case A', direction: 'out', dataType: 'exec' },
      { id: 'elseIf', label: 'Else If / B', direction: 'out', dataType: 'exec' },
      { id: 'false', label: 'Else / Default', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      mode: 'if-else',
      condition: false,
      elseIfCondition: false,
      caseA: '',
      caseB: '',
    },
  }),
  'logic.condition': defineNode({
    type: 'logic.condition',
    category: 'logic',
    label: 'Condition',
    description: 'Evaluates multi-rule comparisons, boolean AND / OR / NOT, Is Empty checks, or Regex matching.',
    ports: [
      { id: 'left', label: 'Left / A', direction: 'in', dataType: 'any' },
      { id: 'right', label: 'Right / B', direction: 'in', dataType: 'any' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      mode: 'compare',
      operator: '==',
      left: null,
      right: null,
      pattern: '',
      rulesJson: '',
    },
  }),
  'logic.math': defineNode({
    type: 'logic.math',
    category: 'logic',
    label: 'Math',
    description: 'Computes +, -, *, /, %, Clamp, or Map Range on numeric values.',
    ports: [
      { id: 'a', label: 'A / Value', direction: 'in', dataType: 'number' },
      { id: 'b', label: 'B', direction: 'in', dataType: 'number' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      operation: '+',
      a: 0,
      b: 1,
      min: 0,
      max: 100,
      inMin: 0,
      inMax: 100,
      outMin: 0,
      outMax: 1,
    },
  }),
  'logic.text': defineNode({
    type: 'logic.text',
    category: 'logic',
    label: 'Text',
    description: 'Formats dynamic text via {{variable}} Templates, Number formatting, or Currency formatting.',
    ports: [
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'text', label: 'Text', direction: 'out', dataType: 'string' },
    ],
    defaultData: {
      mode: 'template',
      template: '{{value}}',
      locale: 'en-US',
      currency: 'USD',
      decimals: 2,
    },
  }),
  'logic.list': defineNode({
    type: 'logic.list',
    category: 'logic',
    label: 'List Processor',
    description: 'Transforms arrays using Filter, Sort, Count, or Map by property field.',
    ports: [
      { id: 'list', label: 'List', direction: 'in', dataType: 'list' },
      { id: 'query', label: 'Query', direction: 'in', dataType: 'string' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'list' },
      { id: 'count', label: 'Count', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      operation: 'filter',
      field: '',
      matchValue: '',
      sortOrder: 'asc',
    },
  }),

  // =========================================================================
  // 5. ACTIONS (6)
  // =========================================================================
  'action.set-layer': defineNode({
    type: 'action.set-layer',
    category: 'action',
    label: 'Set Layer',
    description: 'Updates layer properties (Visible, Fill, Opacity, Transform, Text, Image, Disabled) with optional smooth Transition.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetNodeId: '',
      property: 'text',
      visibleMode: 'toggle',
      fill: '#3B82F6',
      opacity: 1,
      transform: 'scale(1)',
      text: '',
      imageUrl: '',
      disabled: false,
      transitionMs: 0,
      transitionEasing: 'ease-out',
    },
  }),
  'action.set-variant': defineNode({
    type: 'action.set-variant',
    category: 'action',
    label: 'Set Variant',
    description: 'Switches the active variant axis option of a targeted component instance.',
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
  'action.media-animation': defineNode({
    type: 'action.media-animation',
    category: 'action',
    label: 'Media & Animation',
    description: 'Controls a Motion Timeline clip or media layer: Play, Pause, Stop, or Reverse.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      targetKind: 'animation',
      clipId: '',
      targetNodeId: '',
      command: 'play',
    },
  }),
  'action.navigate': defineNode({
    type: 'action.navigate',
    category: 'action',
    label: 'Navigate',
    description: 'Navigates to Internal pages, External URLs, Scroll To layer, URL Params, Back/Forward, or Reload.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'route', label: 'Route / URL', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      mode: 'internal',
      route: '/',
      targetNodeId: '',
      params: '',
      openInNewTab: false,
    },
  }),
  'action.overlay-toast': defineNode({
    type: 'action.overlay-toast',
    category: 'action',
    label: 'Overlay & Toast',
    description: 'Opens or closes a Modal / Drawer layer, or displays a Toast notification.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'message', label: 'Message', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      mode: 'show-toast',
      targetNodeId: '',
      message: 'Saved changes',
      tone: 'info',
    },
  }),
  'action.system-form': defineNode({
    type: 'action.system-form',
    category: 'action',
    label: 'System & Form',
    description: 'Performs Set Theme, Focus/Blur/Reset Form, Copy to Clipboard, Download File, or Web Storage read/write.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      action: 'set-theme',
      themeId: '',
      targetNodeId: '',
      storageKey: '',
      storageScope: 'local',
      filename: 'export.json',
      value: '',
    },
  }),

  // =========================================================================
  // 6. FLOW & TIMING (3)
  // =========================================================================
  'flow.delay': defineNode({
    type: 'flow.delay',
    category: 'flow',
    label: 'Delay',
    description: 'Waits for a configured duration (ms or seconds) before continuing, with optional Cancel Previous.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      duration: 300,
      unit: 'ms',
      cancelPrevious: true,
    },
  }),
  'flow.loop-timer': defineNode({
    type: 'flow.loop-timer',
    category: 'flow',
    label: 'Loop / Timer',
    description: 'Iterates For Each item in a List, or Starts / Stops a repeating Interval timer.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'list', label: 'List', direction: 'in', dataType: 'list' },
      { id: 'tick', label: 'Item / Tick', direction: 'out', dataType: 'exec' },
      { id: 'item', label: 'Item', direction: 'out', dataType: 'any' },
      { id: 'index', label: 'Index', direction: 'out', dataType: 'number' },
      { id: 'done', label: 'Done', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      mode: 'for-each',
      timerId: 'timer-1',
      intervalMs: 1000,
      maxIterations: 50,
    },
  }),
  'flow.control': defineNode({
    type: 'flow.control',
    category: 'flow',
    label: 'Flow Control',
    description: 'Orchestrates multi-branch execution in Sequence (step-by-step) or Parallel / Wait All.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'step1', label: 'Branch 1', direction: 'out', dataType: 'exec' },
      { id: 'step2', label: 'Branch 2', direction: 'out', dataType: 'exec' },
      { id: 'done', label: 'Done / All', direction: 'out', dataType: 'exec' },
    ],
    defaultData: {
      mode: 'sequence',
    },
  }),

  // =========================================================================
  // 7. NETWORK (3)
  // =========================================================================
  'network.http': defineNode({
    type: 'network.http',
    category: 'network',
    label: 'HTTP Request',
    description: 'Calls REST APIs (GET/POST/PUT/PATCH/DELETE, JSON or File Upload) using Project Network Auth & Cache with Loading/Success/Error outputs.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'body', label: 'Body', direction: 'in', dataType: 'any' },
      { id: 'loading', label: 'Loading', direction: 'out', dataType: 'exec' },
      { id: 'success', label: 'Success', direction: 'out', dataType: 'exec' },
      { id: 'error', label: 'Error', direction: 'out', dataType: 'exec' },
      { id: 'data', label: 'Response', direction: 'out', dataType: 'any' },
      { id: 'status', label: 'Status', direction: 'out', dataType: 'number' },
    ],
    defaultData: {
      method: 'GET',
      url: '/api/items',
      bodyType: 'json',
      body: '',
      useAuth: true,
      cache: 'no-store',
    },
  }),
  'network.json': defineNode({
    type: 'network.json',
    category: 'network',
    label: 'JSON Tool',
    description: 'Extracts a nested field by dot-path (Get Field/Path), Parses JSON text, or Stringifies data.',
    ports: [
      { id: 'input', label: 'Input', direction: 'in', dataType: 'any' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'any' },
      { id: 'valid', label: 'Valid', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      mode: 'get-field',
      path: 'data.items',
    },
  }),
  'network.socket': defineNode({
    type: 'network.socket',
    category: 'network',
    label: 'Realtime Socket',
    description: 'Connects to a WebSocket channel, Listens for live messages, or Sends realtime payloads.',
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'payload', label: 'Payload', direction: 'in', dataType: 'any' },
      { id: 'onMessage', label: 'On Message', direction: 'out', dataType: 'exec' },
      { id: 'message', label: 'Message', direction: 'out', dataType: 'any' },
      { id: 'connected', label: 'Connected', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: {
      action: 'listen',
      channel: 'updates',
      eventName: 'message',
    },
  }),

  // =========================================================================
  // LEGACY v1 COMPATIBILITY NODES (Hidden from palette; kept for .flop v2 files)
  // =========================================================================
  'source.page': defineNode({
    type: 'source.page',
    category: 'source',
    label: 'Page (Legacy)',
    description: 'Legacy v1 Page source node preserved for backward compatibility. Prefer App / Context.',
    legacy: true,
    ports: [
      { id: 'onLoad', label: 'On Load', direction: 'out', dataType: 'exec' },
      { id: 'route', label: 'Route', direction: 'out', dataType: 'string' },
    ],
    defaultData: { pageId: '' },
  }),
  'source.component': defineNode({
    type: 'source.component',
    category: 'source',
    label: 'Component (Legacy)',
    description: 'Legacy v1 Component source node preserved for backward compatibility. Prefer Element / Layer.',
    legacy: true,
    ports: [
      { id: 'onClick', label: 'On Click', direction: 'out', dataType: 'exec' },
      { id: 'onHover', label: 'On Hover', direction: 'out', dataType: 'exec' },
      { id: 'componentId', label: 'Component ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: { componentId: '' },
  }),
  'source.theme': defineNode({
    type: 'source.theme',
    category: 'source',
    label: 'Theme (Legacy)',
    description: 'Legacy v1 Theme source node preserved for backward compatibility. Prefer App / Context.',
    legacy: true,
    ports: [
      { id: 'themeId', label: 'Theme ID', direction: 'out', dataType: 'string' },
    ],
    defaultData: { themeId: '' },
  }),
  'event.on-page-load': defineNode({
    type: 'event.on-page-load',
    category: 'event',
    label: 'On Page Load (Legacy)',
    description: 'Legacy v1 Page Load trigger preserved for backward compatibility. Prefer On Lifecycle.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { ...EVENT_COMMON_DEFAULT_DATA },
  }),
  'state.set': defineNode({
    type: 'state.set',
    category: 'state',
    label: 'Set State (Legacy)',
    description: 'Legacy v1 Set State node preserved for backward compatibility. Prefer Update State.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'any' },
    ],
    defaultData: { variableId: '', value: null },
  }),
  'state.increment': defineNode({
    type: 'state.increment',
    category: 'state',
    label: 'Increment State (Legacy)',
    description: 'Legacy v1 Increment State node preserved for backward compatibility. Prefer Update State.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'step', label: 'Step', direction: 'in', dataType: 'number' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
      { id: 'result', label: 'Value', direction: 'out', dataType: 'number' },
    ],
    defaultData: { variableId: '', step: 1, min: null, max: null },
  }),
  'logic.compare': defineNode({
    type: 'logic.compare',
    category: 'logic',
    label: 'Compare (Legacy)',
    description: 'Legacy v1 Compare node preserved for backward compatibility. Prefer Condition.',
    legacy: true,
    ports: [
      { id: 'left', label: 'Left', direction: 'in', dataType: 'any' },
      { id: 'right', label: 'Right', direction: 'in', dataType: 'any' },
      { id: 'result', label: 'Result', direction: 'out', dataType: 'boolean' },
    ],
    defaultData: { operator: '==', left: null, right: null },
  }),
  'logic.template': defineNode({
    type: 'logic.template',
    category: 'logic',
    label: 'Text Template (Legacy)',
    description: 'Legacy v1 Text Template node preserved for backward compatibility. Prefer Text.',
    legacy: true,
    ports: [
      { id: 'value', label: 'Value', direction: 'in', dataType: 'any' },
      { id: 'text', label: 'Text', direction: 'out', dataType: 'string' },
    ],
    defaultData: { template: '{{value}}' },
  }),
  'action.set-visible': defineNode({
    type: 'action.set-visible',
    category: 'action',
    label: 'Set Visible (Legacy)',
    description: 'Legacy v1 Set Visible node preserved for backward compatibility. Prefer Set Layer.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'visible', label: 'Visible', direction: 'in', dataType: 'boolean' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { targetNodeId: '', mode: 'toggle' },
  }),
  'action.set-text': defineNode({
    type: 'action.set-text',
    category: 'action',
    label: 'Set Text (Legacy)',
    description: 'Legacy v1 Set Text node preserved for backward compatibility. Prefer Set Layer.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'text', label: 'Text', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { targetNodeId: '', text: '' },
  }),
  'action.set-fill': defineNode({
    type: 'action.set-fill',
    category: 'action',
    label: 'Set Fill Color (Legacy)',
    description: 'Legacy v1 Set Fill Color node preserved for backward compatibility. Prefer Set Layer.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'fill', label: 'Color', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { targetNodeId: '', fill: '#3B82F6' },
  }),
  'action.set-theme': defineNode({
    type: 'action.set-theme',
    category: 'action',
    label: 'Set Theme (Legacy)',
    description: 'Legacy v1 Set Theme node preserved for backward compatibility. Prefer System & Form.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'themeId', label: 'Theme ID', direction: 'in', dataType: 'string' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { themeId: '' },
  }),
  'action.play-animation': defineNode({
    type: 'action.play-animation',
    category: 'action',
    label: 'Play Animation (Legacy)',
    description: 'Legacy v1 Play Animation node preserved for backward compatibility. Prefer Media & Animation.',
    legacy: true,
    ports: [
      { id: 'exec', label: 'Exec', direction: 'in', dataType: 'exec' },
      { id: 'next', label: 'Next', direction: 'out', dataType: 'exec' },
    ],
    defaultData: { clipId: '' },
  }),
});

export function isBuiltInLogicNodeType(type: string): type is BuiltInLogicNodeType {
  return Object.prototype.hasOwnProperty.call(LOGIC_NODE_CATALOG, type);
}

export function isPrimaryLogicNodeType(type: string): type is PrimaryLogicNodeType {
  return isBuiltInLogicNodeType(type) && !LOGIC_NODE_CATALOG[type].legacy;
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
  scope?: LogicVariableScope;
  persist?: LogicVariablePersist;
  computed?: boolean;
  computedExpression?: string;
}): LogicVariableDefinition {
  return {
    id: args.id,
    name: args.name,
    valueType: args.valueType,
    initialValue: args.initialValue,
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.scope !== undefined ? { scope: args.scope } : {}),
    ...(args.persist !== undefined ? { persist: args.persist } : {}),
    ...(args.computed !== undefined ? { computed: args.computed } : {}),
    ...(args.computedExpression !== undefined ? { computedExpression: args.computedExpression } : {}),
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
  networkSettings?: LogicNetworkSettings;
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
    ...(args.networkSettings ? { networkSettings: args.networkSettings } : {}),
    nodes: args.nodes ?? [],
    connections: args.connections ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

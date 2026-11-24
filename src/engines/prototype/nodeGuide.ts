import {
  LOGIC_NODE_CATALOG,
  PRIMARY_LOGIC_NODE_TYPES,
  areLogicPortTypesCompatible,
  getLogicNodeDefinition,
  type BuiltInLogicNodeType,
  type LogicNodeCategory,
  type LogicPortDataType,
} from './catalog';

export interface LogicPortConnectionHint {
  readonly portId: string;
  readonly portLabel: string;
  readonly dataType: LogicPortDataType;
  readonly compatibleNodeTypes: readonly string[];
  readonly compatibleLabels: readonly string[];
  readonly summary: string;
}

export interface LogicNodeConnectionGuide {
  readonly nodeType: string;
  readonly label: string;
  readonly category: LogicNodeCategory;
  readonly roleSummary: string;
  readonly inHints: readonly LogicPortConnectionHint[];
  readonly outHints: readonly LogicPortConnectionHint[];
  readonly exampleFlow: string;
}

const EXAMPLE_FLOWS: Readonly<Record<BuiltInLogicNodeType, string>> = Object.freeze({
  // 1. SOURCES (3)
  'source.element': 'Element / Layer (On Click / Property) -> Update State or Set Layer',
  'source.context': 'App / Context (On Load / Theme ID) -> System & Form or Navigate',
  'source.external': 'External Data (Data) -> List Processor -> Loop / Timer',
  // 2. EVENTS (8)
  'event.on-click': 'On Click -> Toggle State -> Branch -> Set Layer',
  'event.on-hover': 'On Hover -> Set Layer (Fill / Opacity) or Set Variant',
  'event.on-input': 'On Input (Value) -> Condition -> Update State -> Set Layer',
  'event.on-key-press': 'On Key Press (Escape) -> Overlay & Toast (Close Modal)',
  'event.on-drag': 'On Drag (X / Y) -> Math (Clamp) -> Set Layer (Transform)',
  'event.on-scroll-view': 'On Scroll / View (Enter View) -> Media & Animation (Play)',
  'event.on-lifecycle': 'On Lifecycle (Page Load) -> HTTP Request -> Update State',
  'event.on-state-change': 'On State Change (Value) -> Text -> Set Layer (Text)',
  // 3. STATE (3)
  'state.get': 'Get State (Value) -> Condition / Math / Text / List Processor',
  'state.toggle': 'On Click -> Toggle State -> Branch -> Set Layer (Visible)',
  'state.update': 'On Click -> Update State (Increment / Push / Set Property) -> Set Layer',
  // 4. LOGIC (5)
  'logic.branch': 'Toggle State -> Branch (True -> Set Layer, Else -> Overlay & Toast)',
  'logic.condition': 'Get State -> Condition (Compare / Regex / Is Empty) -> Branch',
  'logic.math': 'Get State -> Math (Clamp / Map Range) -> Update State or Set Layer',
  'logic.text': 'Get State -> Text (Template / Currency) -> Set Layer (Text)',
  'logic.list': 'External Data -> List Processor (Filter / Sort) -> Loop / Timer',
  // 5. ACTIONS (6)
  'action.set-layer': 'Branch (True) -> Set Layer (Text / Fill / Visible / Opacity + Transition)',
  'action.set-variant': 'On Click -> Set Variant (switches component axis option)',
  'action.media-animation': 'On Scroll / View -> Media & Animation (Play / Pause / Reverse)',
  'action.navigate': 'On Click -> Navigate (Internal Page / External URL / Scroll To)',
  'action.overlay-toast': 'HTTP Request (Success) -> Overlay & Toast (Show Toast / Open Modal)',
  'action.system-form': 'On Click -> System & Form (Set Theme / Clipboard / Reset Form / Storage)',
  // 6. FLOW & TIMING (3)
  'flow.delay': 'On Click -> Delay (300ms) -> Overlay & Toast or Set Layer',
  'flow.loop-timer': 'List Processor -> Loop / Timer (For Each / Interval) -> Set Layer',
  'flow.control': 'On Lifecycle -> Flow Control (Sequence / Parallel) -> HTTP Request + Animation',
  // 7. NETWORK (3)
  'network.http': 'On Click -> HTTP Request (Loading -> Spinner, Success -> JSON Tool -> Update State)',
  'network.json': 'HTTP Request (Response) -> JSON Tool (Get Field/Path) -> Update State',
  'network.socket': 'On Lifecycle -> Realtime Socket (Listen -> Message) -> Update State',
  // Legacy v1 fallbacks
  'source.page': 'Page (On Load) -> Media & Animation or Set Layer',
  'source.component': 'Component (On Click) -> Set Variant or Navigate',
  'source.theme': 'Theme (Theme ID) -> System & Form (Set Theme)',
  'event.on-page-load': 'On Page Load -> Media & Animation or Set Layer',
  'state.set': 'On Click -> Set State -> Set Layer',
  'state.increment': 'On Click -> Increment State -> Text -> Set Layer',
  'logic.compare': 'Get State -> Compare -> Branch',
  'logic.template': 'Get State -> Text Template -> Set Layer',
  'action.set-visible': 'Branch -> Set Visible',
  'action.set-text': 'Text -> Set Text',
  'action.set-fill': 'On Hover -> Set Fill Color',
  'action.set-theme': 'App / Context -> Set Theme',
  'action.play-animation': 'On Lifecycle -> Play Animation',
});

function formatCompactNodeList(labels: readonly string[], maxVisible = 6): string {
  if (labels.length === 0) return 'No matching nodes';
  if (labels.length <= maxVisible) return labels.join(', ');
  const shown = labels.slice(0, maxVisible).join(', ');
  return `${shown}, +${labels.length - maxVisible} more`;
}

function summarizeCompatibleSources(
  dataType: LogicPortDataType,
  compatibleLabels: readonly string[],
): string {
  if (dataType === 'exec') {
    return `Triggers or previous steps: ${formatCompactNodeList(compatibleLabels, 7)}`;
  }
  if (dataType === 'boolean') {
    return `Condition / Toggle outputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'list') {
    return `List / Array outputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'object') {
    return `Object / JSON outputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'string') {
    return `Text / Route / Key outputs or inline value: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'number') {
    return `Math / Count / Scroll outputs or inline number: ${formatCompactNodeList(compatibleLabels, 5)}`;
  }
  return `Any data output: ${formatCompactNodeList(compatibleLabels, 6)}`;
}

function summarizeCompatibleTargets(
  dataType: LogicPortDataType,
  compatibleLabels: readonly string[],
): string {
  if (dataType === 'exec') {
    return `Actions, State updates, Flow, or Network: ${formatCompactNodeList(compatibleLabels, 7)}`;
  }
  if (dataType === 'boolean') {
    return `Branch or Condition inputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'list') {
    return `List Processor, Loop / Timer, or Update State: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'object') {
    return `JSON Tool, HTTP Request, or Update State: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'string') {
    return `Set Layer, Navigate, Overlay & Toast, Text, or Condition: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'number') {
    return `Math, Condition, Text, or Update State: ${formatCompactNodeList(compatibleLabels, 5)}`;
  }
  return `Logic, State, Action, or Network inputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
}

/**
 * Dynamically computes the IN / OUT connection guide for any Node Logic node type
 * strictly against the 31 primary canonical nodes and `areLogicPortTypesCompatible`.
 */
export function getLogicNodeGuide(nodeType: string): LogicNodeConnectionGuide {
  const def = getLogicNodeDefinition(nodeType);
  if (!def) {
    return {
      nodeType,
      label: nodeType,
      category: 'logic',
      roleSummary: 'Custom or unrecognized logic node.',
      inHints: [],
      outHints: [],
      exampleFlow: 'Connect matching port types from left (IN) to right (OUT).',
    };
  }

  const primaryDefs = PRIMARY_LOGIC_NODE_TYPES.map((type) => LOGIC_NODE_CATALOG[type]);
  const inputPorts = def.ports.filter((port) => port.direction === 'in');
  const outputPorts = def.ports.filter((port) => port.direction === 'out');

  const inHints: LogicPortConnectionHint[] = inputPorts.map((inPort) => {
    const compatibleNodeTypes: string[] = [];
    const compatibleLabels: string[] = [];

    for (const candidate of primaryDefs) {
      if (candidate.type === def.type) continue;
      const hasMatchingOut = candidate.ports.some(
        (p) => p.direction === 'out' && areLogicPortTypesCompatible(p.dataType, inPort.dataType),
      );
      if (hasMatchingOut) {
        compatibleNodeTypes.push(candidate.type);
        compatibleLabels.push(candidate.label);
      }
    }

    return {
      portId: inPort.id,
      portLabel: inPort.label,
      dataType: inPort.dataType,
      compatibleNodeTypes,
      compatibleLabels,
      summary: summarizeCompatibleSources(inPort.dataType, compatibleLabels),
    };
  });

  const outHints: LogicPortConnectionHint[] = outputPorts.map((outPort) => {
    const compatibleNodeTypes: string[] = [];
    const compatibleLabels: string[] = [];

    for (const candidate of primaryDefs) {
      if (candidate.type === def.type) continue;
      const hasMatchingIn = candidate.ports.some(
        (p) => p.direction === 'in' && areLogicPortTypesCompatible(outPort.dataType, p.dataType),
      );
      if (hasMatchingIn) {
        compatibleNodeTypes.push(candidate.type);
        compatibleLabels.push(candidate.label);
      }
    }

    return {
      portId: outPort.id,
      portLabel: outPort.label,
      dataType: outPort.dataType,
      compatibleNodeTypes,
      compatibleLabels,
      summary: summarizeCompatibleTargets(outPort.dataType, compatibleLabels),
    };
  });

  return {
    nodeType: def.type,
    label: def.label,
    category: def.category,
    roleSummary: def.description,
    inHints,
    outHints,
    exampleFlow:
      EXAMPLE_FLOWS[def.type] ?? 'Connect an Event or Source on the left to Actions on the right.',
  };
}

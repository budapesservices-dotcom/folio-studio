import {
  LOGIC_NODE_CATALOG,
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
  'source.page': 'Page (On Load) -> Play Animation or Set Text',
  'source.component': 'Component (On Click) -> Set Variant or Navigate',
  'source.element': 'Canvas Layer (On Click) -> Set Fill Color or Toggle State',
  'source.theme': 'Theme (Theme Name) -> Set Theme (Theme)',
  'event.on-page-load': 'On Page Load -> Set Text or Play Animation',
  'event.on-click': 'On Click -> Toggle State -> Branch -> Set Visible',
  'event.on-hover': 'On Hover -> Set Fill Color or Set Variant',
  'event.on-state-change': 'On State Change -> Branch -> Set Visible or Set Text',
  'state.get': 'Get State (Value) -> Compare (Left) or Text Template (Value)',
  'state.set': 'Component (On Click) -> Set State -> Set Text',
  'state.toggle': 'On Click -> Toggle State -> Branch -> Set Visible',
  'state.increment': 'On Click -> Increment State -> Text Template -> Set Text',
  'logic.branch': 'Toggle State -> Branch (True -> Set Visible, False -> Set Fill)',
  'logic.compare': 'Get State (Value) -> Compare (Left) -> Branch (Condition)',
  'logic.template': 'Get State (Value) -> Text Template -> Set Text (Text)',
  'action.set-visible': 'Branch (True) -> Set Visible (shows or hides target layer)',
  'action.set-text': 'Text Template (Text) -> Set Text (Text) + On Click -> Exec',
  'action.set-fill': 'On Hover -> Set Fill Color -> Next Action',
  'action.set-variant': 'Component (On Click) -> Set Variant (switches component state)',
  'action.navigate': 'Component (On Click) -> Navigate (jumps to target page)',
  'action.set-theme': 'Theme (Theme Name) -> Set Theme (Theme) + On Click -> Exec',
  'action.play-animation': 'Page (On Load) or On Click -> Play Animation',
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
    return `Condition outputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'string') {
    return `Text/route/theme outputs or inline value: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'number') {
    return `Numeric/state outputs or inline number: ${formatCompactNodeList(compatibleLabels, 5)}`;
  }
  return `Any value output: ${formatCompactNodeList(compatibleLabels, 6)}`;
}

function summarizeCompatibleTargets(
  dataType: LogicPortDataType,
  compatibleLabels: readonly string[],
): string {
  if (dataType === 'exec') {
    return `Actions, State updates, or Branch: ${formatCompactNodeList(compatibleLabels, 7)}`;
  }
  if (dataType === 'boolean') {
    return `Condition or visibility inputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'string') {
    return `Text, Color, Route, Theme, or Compare inputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
  }
  if (dataType === 'number') {
    return `Compare, Template, or Set State inputs: ${formatCompactNodeList(compatibleLabels, 5)}`;
  }
  return `Logic or Action value inputs: ${formatCompactNodeList(compatibleLabels, 6)}`;
}

/**
 * Dynamically computes the IN / OUT connection guide for any Node Logic node type
 * directly from LOGIC_NODE_CATALOG and areLogicPortTypesCompatible so the guide
 * always stays 100% accurate with the engine's actual wiring rules.
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

  const allDefs = Object.values(LOGIC_NODE_CATALOG);
  const inputPorts = def.ports.filter((port) => port.direction === 'in');
  const outputPorts = def.ports.filter((port) => port.direction === 'out');

  const inHints: LogicPortConnectionHint[] = inputPorts.map((inputPort) => {
    const matchedTypes: string[] = [];
    const matchedLabels: string[] = [];
    for (const candidate of allDefs) {
      if (candidate.type === def.type && inputPort.dataType === 'exec') continue;
      const hasCompatibleOutput = candidate.ports.some(
        (outPort) =>
          outPort.direction === 'out' &&
          areLogicPortTypesCompatible(outPort.dataType, inputPort.dataType),
      );
      if (hasCompatibleOutput) {
        matchedTypes.push(candidate.type);
        matchedLabels.push(candidate.label);
      }
    }
    return {
      portId: inputPort.id,
      portLabel: inputPort.label,
      dataType: inputPort.dataType,
      compatibleNodeTypes: matchedTypes,
      compatibleLabels: matchedLabels,
      summary: summarizeCompatibleSources(inputPort.dataType, matchedLabels),
    };
  });

  const outHints: LogicPortConnectionHint[] = outputPorts.map((outputPort) => {
    const matchedTypes: string[] = [];
    const matchedLabels: string[] = [];
    for (const candidate of allDefs) {
      if (candidate.type === def.type && outputPort.dataType === 'exec') continue;
      const hasCompatibleInput = candidate.ports.some(
        (inPort) =>
          inPort.direction === 'in' &&
          areLogicPortTypesCompatible(outputPort.dataType, inPort.dataType),
      );
      if (hasCompatibleInput) {
        matchedTypes.push(candidate.type);
        matchedLabels.push(candidate.label);
      }
    }
    return {
      portId: outputPort.id,
      portLabel: outputPort.label,
      dataType: outputPort.dataType,
      compatibleNodeTypes: matchedTypes,
      compatibleLabels: matchedLabels,
      summary: summarizeCompatibleTargets(outputPort.dataType, matchedLabels),
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
      EXAMPLE_FLOWS[def.type] ??
      'Wire matching output ports (right) into compatible input ports (left).',
  };
}

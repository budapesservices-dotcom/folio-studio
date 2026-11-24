import { useState } from 'preact/hooks';
import { isSafeCssColorValue } from '../../core/document/tokens';
import type {
  AnimationClip,
  ComponentDefinition,
  DesignNode,
  DesignThemeDefinition,
  FolioPage,
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
} from '../../core/document/types';
import {
  LOGIC_COMPARE_OPERATORS,
  getLogicNodeDefinition,
  type LogicDiagnostic,
  type LogicNodeEventKind,
  type PrototypeRuntimeSnapshot,
} from '../../engines/prototype';
import { getUsedSourceReferenceIds } from './nodeLogicGraphHelpers';
import { StudioIcon } from './StudioIcon';

export type NodeLogicInspectorTab = 'node' | 'variables' | 'simulate';

export interface NodeLogicInspectorProps {
  activeTab: NodeLogicInspectorTab;
  graph: LogicGraph | null;
  selectedNode: LogicNode | null;
  selectedConnection: LogicConnection | null;
  scopedAstNodes: readonly DesignNode[];
  availableVariables: readonly LogicVariableDefinition[];
  components: readonly ComponentDefinition[];
  pages: readonly FolioPage[];
  themes: readonly DesignThemeDefinition[];
  animations: readonly AnimationClip[];
  diagnostics: readonly LogicDiagnostic[];
  runtimeSnapshot: PrototypeRuntimeSnapshot | null;
  onChangeTab: (tab: NodeLogicInspectorTab) => void;
  onUpdateNodeData: (nodeId: string, patch: Record<string, string | number | boolean | null>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteConnection: (connectionId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onAddVariable: (args: { name: string; valueType: LogicValueType; initialValue: LogicVariableValue }) => void;
  onUpdateVariable: (
    variableId: string,
    patch: Partial<Pick<LogicVariableDefinition, 'name' | 'valueType' | 'initialValue'>>,
  ) => void;
  onDeleteVariable: (variableId: string) => void;
  onRunMount: () => void;
  onTriggerNodeEvent: (nodeId: string, event: LogicNodeEventKind) => void;
  onResetRuntime: () => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
}

function parseLiteralForType(raw: string, valueType: LogicValueType): LogicVariableValue {
  if (valueType === 'boolean') return raw === 'true';
  if (valueType === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return raw;
}

export function NodeLogicInspector({
  activeTab,
  graph,
  selectedNode,
  selectedConnection,
  scopedAstNodes,
  availableVariables,
  components,
  pages,
  themes,
  animations,
  diagnostics,
  runtimeSnapshot,
  onChangeTab,
  onUpdateNodeData,
  onDeleteNode,
  onDeleteConnection,
  onFocusNode,
  onAddVariable,
  onUpdateVariable,
  onDeleteVariable,
  onRunMount,
  onTriggerNodeEvent,
  onResetRuntime,
  onToggleComponentNodeLogic,
}: NodeLogicInspectorProps) {
  const [newVarName, setNewVarName] = useState('');
  const [newVarType, setNewVarType] = useState<LogicValueType>('number');
  const [newVarInitial, setNewVarInitial] = useState('0');

  const nodeDef = selectedNode ? getLogicNodeDefinition(selectedNode.type) : undefined;
  const nodeDiagnostics = selectedNode
    ? diagnostics.filter((item) => item.nodeId === selectedNode.id)
    : [];

  const graphVariables = graph?.variables ?? [];

  const interactiveTriggers = graph
    ? graph.nodes.flatMap((node) => {
        if (node.type === 'event.on-click' || node.type === 'event.on-hover') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          const eventKind: LogicNodeEventKind =
            node.type === 'event.on-click'
              ? 'click'
              : node.data.phase === 'leave'
                ? 'hover-leave'
                : 'hover-enter';
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              targetName: targetAst?.name ?? 'Unbound layer',
              eventKind,
              label:
                eventKind === 'click'
                  ? `Click “${targetAst?.name ?? 'Unbound'}”`
                  : eventKind === 'hover-leave'
                    ? `Hover Leave “${targetAst?.name ?? 'Unbound'}”`
                    : `Hover Enter “${targetAst?.name ?? 'Unbound'}”`,
            },
          ];
        }
        if (node.type === 'source.element') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          const name = targetAst?.name ?? 'Layer';
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              targetName: name,
              eventKind: 'click' as LogicNodeEventKind,
              label: `Click Layer “${name}”`,
            },
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              targetName: name,
              eventKind: 'hover-enter' as LogicNodeEventKind,
              label: `Hover Layer “${name}”`,
            },
          ];
        }
        if (node.type === 'source.component') {
          const compId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
          if (!compId) return [];
          const comp = components.find((item) => item.id === compId);
          const instance = scopedAstNodes.find(
            (item) => item.type === 'component-instance' && item.componentId === compId,
          );
          if (!instance) return [];
          const name = comp?.name ?? instance.name;
          return [
            {
              logicNodeId: node.id,
              targetNodeId: instance.id,
              targetName: name,
              eventKind: 'click' as LogicNodeEventKind,
              label: `Click Component “${name}”`,
            },
            {
              logicNodeId: node.id,
              targetNodeId: instance.id,
              targetName: name,
              eventKind: 'hover-enter' as LogicNodeEventKind,
              label: `Hover Component “${name}”`,
            },
          ];
        }
        return [];
      })
    : [];

  const handleCreateVariable = (event: Event) => {
    event.preventDefault();
    onAddVariable({
      name: newVarName.trim() || `state${graphVariables.length + 1}`,
      valueType: newVarType,
      initialValue: parseLiteralForType(newVarInitial, newVarType),
    });
    setNewVarName('');
    setNewVarInitial(newVarType === 'number' ? '0' : newVarType === 'boolean' ? 'false' : '');
  };

  const renderNodeFields = (node: LogicNode) => {
    const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
    const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';

    const textNodes = scopedAstNodes.filter((item) => item.type === 'text');
    const fillableNodes = scopedAstNodes.filter(
      (item) => item.type !== 'group' && item.type !== 'component-instance',
    );
    const instanceNodes = scopedAstNodes.filter((item) => item.type === 'component-instance');

    const renderAstTargetPicker = (label: string, candidates: readonly DesignNode[]) => (
      <label class="nl-field">
        <span>{label}</span>
        <select
          class="select-field"
          value={targetNodeId}
          onChange={(event) => onUpdateNodeData(node.id, { targetNodeId: event.currentTarget.value })}
        >
          <option value="">Select layer…</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.type})
            </option>
          ))}
        </select>
      </label>
    );

    const renderVariablePicker = (filterType?: LogicValueType) => {
      const candidates = filterType
        ? availableVariables.filter((item) => item.valueType === filterType)
        : availableVariables;
      return (
        <div class="nl-field-group">
          <label class="nl-field">
            <span>Variable{filterType ? ` (${filterType})` : ''}</span>
            <select
              class="select-field"
              value={variableId}
              onChange={(event) => onUpdateNodeData(node.id, { variableId: event.currentTarget.value })}
            >
              <option value="">Select variable…</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.valueType})
                </option>
              ))}
            </select>
          </label>
          {candidates.length === 0 && (
            <button
              type="button"
              class="nl-inline-link"
              onClick={() => onChangeTab('variables')}
            >
              + Declare a {filterType ?? 'state'} variable
            </button>
          )}
        </div>
      );
    };

    switch (node.type) {
      case 'source.page': {
        const pageId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
        const usedPageIds = graph ? getUsedSourceReferenceIds(graph, 'source.page', node.id) : new Set<string>();
        return (
          <>
            <label class="nl-field">
              <span>Project page</span>
              <select
                class="select-field nl-source-select"
                aria-label="Source page"
                value={pageId}
                onChange={(event) => onUpdateNodeData(node.id, { pageId: event.currentTarget.value })}
              >
                <option value="">Select available page…</option>
                {pages.map((page) => {
                  const isUsed = usedPageIds.has(page.id);
                  return (
                    <option key={page.id} value={page.id} disabled={isUsed}>
                      {page.name} ({page.route}){isUsed ? ' — In graph' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <p class="nl-inspector-hint">
              Pages already placed in another Page node are greyed out. Wire On Load to run actions on mount, or drag Route into a Navigate node.
            </p>
          </>
        );
      }

      case 'source.component': {
        const componentId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
        const usedComponentIds = graph
          ? getUsedSourceReferenceIds(graph, 'source.component', node.id)
          : new Set<string>();
        const enabledComponents = components.filter((c) => c.nodeLogicEnabled || c.id === componentId);
        const disabledComponents = components.filter((c) => !c.nodeLogicEnabled);
        return (
          <>
            <label class="nl-field">
              <span>Component (sent to Node Logic)</span>
              <select
                class="select-field nl-source-select"
                aria-label="Source component"
                value={componentId}
                onChange={(event) => onUpdateNodeData(node.id, { componentId: event.currentTarget.value })}
              >
                <option value="">
                  {enabledComponents.length === 0 ? 'No components sent to Node yet…' : 'Select component…'}
                </option>
                {enabledComponents.map((comp) => {
                  const isUsed = usedComponentIds.has(comp.id);
                  const suffix = !comp.nodeLogicEnabled
                    ? ' — Disabled'
                    : isUsed
                      ? ' — In graph'
                      : '';
                  return (
                    <option key={comp.id} value={comp.id} disabled={isUsed}>
                      {comp.name}{suffix}
                    </option>
                  );
                })}
              </select>
            </label>
            <p class="nl-inspector-hint">
              Only components enabled with “Send to Node” appear here. Components already assigned to another node are greyed out.
            </p>
            {onToggleComponentNodeLogic && disabledComponents.length > 0 && (
              <div class="nl-quick-enable-box">
                <div class="nl-section-label">Send Component to Node Logic</div>
                <div class="nl-quick-enable-list">
                  {disabledComponents.map((comp) => (
                    <div key={comp.id} class="nl-quick-enable-row">
                      <span>{comp.name}</span>
                      <button
                        type="button"
                        class="nl-quick-enable-btn"
                        onClick={() => {
                          onToggleComponentNodeLogic(comp, true);
                          if (!componentId && !usedComponentIds.has(comp.id)) {
                            onUpdateNodeData(node.id, { componentId: comp.id });
                          }
                        }}
                      >
                        Send to Node
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      }

      case 'source.element': {
        const usedElementIds = graph
          ? getUsedSourceReferenceIds(graph, 'source.element', node.id)
          : new Set<string>();
        return (
          <>
            <label class="nl-field">
              <span>Canvas layer</span>
              <select
                class="select-field nl-source-select"
                aria-label="Source canvas layer"
                value={targetNodeId}
                onChange={(event) => onUpdateNodeData(node.id, { targetNodeId: event.currentTarget.value })}
              >
                <option value="">Select available layer…</option>
                {scopedAstNodes.map((item) => {
                  const isUsed = usedElementIds.has(item.id);
                  return (
                    <option key={item.id} value={item.id} disabled={isUsed}>
                      {item.name} ({item.type}){isUsed ? ' — In graph' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <p class="nl-inspector-hint">
              Layers already bound to another Canvas Layer node are greyed out. Drag On Click or On Hover directly to any action.
            </p>
          </>
        );
      }

      case 'source.theme': {
        const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
        const usedThemeIds = graph ? getUsedSourceReferenceIds(graph, 'source.theme', node.id) : new Set<string>();
        return (
          <>
            <label class="nl-field">
              <span>Design Token theme</span>
              <select
                class="select-field nl-source-select"
                aria-label="Source theme"
                value={themeId}
                onChange={(event) => onUpdateNodeData(node.id, { themeId: event.currentTarget.value })}
              >
                <option value="">Select available theme…</option>
                {themes.map((theme) => {
                  const isUsed = usedThemeIds.has(theme.id);
                  return (
                    <option key={theme.id} value={theme.id} disabled={isUsed}>
                      {theme.name}{isUsed ? ' — In graph' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <p class="nl-inspector-hint">
              Themes already assigned to another Theme node are greyed out.
            </p>
          </>
        );
      }

      case 'event.on-click':
        return renderAstTargetPicker('Target layer', scopedAstNodes);

      case 'event.on-hover':
        return (
          <>
            {renderAstTargetPicker('Target layer', scopedAstNodes)}
            <label class="nl-field">
              <span>Hover phase</span>
              <select
                class="select-field"
                value={node.data.phase === 'leave' ? 'leave' : 'enter'}
                onChange={(event) => onUpdateNodeData(node.id, { phase: event.currentTarget.value })}
              >
                <option value="enter">Pointer enter</option>
                <option value="leave">Pointer leave</option>
              </select>
            </label>
          </>
        );

      case 'event.on-page-load':
        return (
          <p class="nl-inspector-hint">
            Runs automatically once when this page mounts in Simulate or Live Preview.
          </p>
        );

      case 'event.on-state-change':
      case 'state.get':
        return renderVariablePicker();

      case 'state.toggle':
        return renderVariablePicker('boolean');

      case 'state.set': {
        const selectedVar = availableVariables.find((item) => item.id === variableId);
        return (
          <>
            {renderVariablePicker()}
            {selectedVar && (
              <label class="nl-field">
                <span>Literal value (fallback when Value port is unwired)</span>
                {selectedVar.valueType === 'boolean' ? (
                  <select
                    class="select-field"
                    value={String(Boolean(node.data.value))}
                    onChange={(event) =>
                      onUpdateNodeData(node.id, { value: event.currentTarget.value === 'true' })
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : selectedVar.valueType === 'number' ? (
                  <input
                    class="nl-input"
                    type="number"
                    value={typeof node.data.value === 'number' ? node.data.value : 0}
                    onInput={(event) => {
                      const next = Number(event.currentTarget.value);
                      onUpdateNodeData(node.id, { value: Number.isFinite(next) ? next : 0 });
                    }}
                  />
                ) : (
                  <input
                    class="nl-input"
                    type="text"
                    value={node.data.value === null || node.data.value === undefined ? '' : String(node.data.value)}
                    onInput={(event) => onUpdateNodeData(node.id, { value: event.currentTarget.value })}
                  />
                )}
              </label>
            )}
          </>
        );
      }

      case 'state.increment':
        return (
          <>
            {renderVariablePicker('number')}
            <div class="nl-field-grid">
              <label class="nl-field">
                <span>Step</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  value={typeof node.data.step === 'number' ? node.data.step : 1}
                  onInput={(event) => {
                    const next = Number(event.currentTarget.value);
                    onUpdateNodeData(node.id, { step: Number.isFinite(next) ? next : 1 });
                  }}
                />
              </label>
              <label class="nl-field">
                <span>Min</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  placeholder="none"
                  value={typeof node.data.min === 'number' ? node.data.min : ''}
                  onInput={(event) => {
                    const raw = event.currentTarget.value.trim();
                    const parsed = raw === '' ? null : Number(raw);
                    onUpdateNodeData(node.id, {
                      min: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                    });
                  }}
                />
              </label>
              <label class="nl-field">
                <span>Max</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  placeholder="none"
                  value={typeof node.data.max === 'number' ? node.data.max : ''}
                  onInput={(event) => {
                    const raw = event.currentTarget.value.trim();
                    const parsed = raw === '' ? null : Number(raw);
                    onUpdateNodeData(node.id, {
                      max: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                    });
                  }}
                />
              </label>
            </div>
          </>
        );

      case 'logic.branch':
        return (
          <label class="nl-field">
            <span>Fallback condition (when Condition port is unwired)</span>
            <select
              class="select-field"
              value={String(Boolean(node.data.condition))}
              onChange={(event) =>
                onUpdateNodeData(node.id, { condition: event.currentTarget.value === 'true' })
              }
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </label>
        );

      case 'logic.compare':
        return (
          <>
            <label class="nl-field">
              <span>Operator</span>
              <select
                class="select-field"
                value={String(node.data.operator ?? '==')}
                onChange={(event) => onUpdateNodeData(node.id, { operator: event.currentTarget.value })}
              >
                {LOGIC_COMPARE_OPERATORS.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </label>
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Left fallback</span>
                <input
                  class="nl-input"
                  type="text"
                  value={node.data.left === null || node.data.left === undefined ? '' : String(node.data.left)}
                  onInput={(event) => {
                    const raw = event.currentTarget.value;
                    const asNum = raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
                    onUpdateNodeData(node.id, { left: asNum });
                  }}
                />
              </label>
              <label class="nl-field">
                <span>Right fallback</span>
                <input
                  class="nl-input"
                  type="text"
                  value={node.data.right === null || node.data.right === undefined ? '' : String(node.data.right)}
                  onInput={(event) => {
                    const raw = event.currentTarget.value;
                    const asNum = raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
                    onUpdateNodeData(node.id, { right: asNum });
                  }}
                />
              </label>
            </div>
          </>
        );

      case 'logic.template':
        return (
          <label class="nl-field">
            <span>Template (use {'{{variableName}}'} or {'{{value}}'})</span>
            <input
              class="nl-input"
              type="text"
              value={typeof node.data.template === 'string' ? node.data.template : '{{value}}'}
              onInput={(event) => onUpdateNodeData(node.id, { template: event.currentTarget.value })}
            />
          </label>
        );

      case 'action.set-visible':
        return (
          <>
            {renderAstTargetPicker('Target layer', scopedAstNodes)}
            <label class="nl-field">
              <span>Visibility mode</span>
              <select
                class="select-field"
                value={String(node.data.mode ?? 'toggle')}
                onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
              >
                <option value="toggle">Toggle</option>
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </label>
          </>
        );

      case 'action.set-text':
        return (
          <>
            {renderAstTargetPicker('Target text layer', textNodes)}
            <label class="nl-field">
              <span>Fallback text (when Text port is unwired)</span>
              <input
                class="nl-input"
                type="text"
                value={typeof node.data.text === 'string' ? node.data.text : ''}
                onInput={(event) => onUpdateNodeData(node.id, { text: event.currentTarget.value })}
              />
            </label>
          </>
        );

      case 'action.set-fill': {
        const fillValue = typeof node.data.fill === 'string' ? node.data.fill : '#8B7CF6';
        const isHex = /^#[0-9a-fA-F]{6}$/.test(fillValue);
        return (
          <>
            {renderAstTargetPicker('Target fillable layer', fillableNodes)}
            <div class="nl-field">
              <span>Fill color</span>
              <div class="nl-color-row">
                <input
                  type="color"
                  class="nl-color-swatch"
                  aria-label="Pick fill color"
                  value={isHex ? fillValue : '#8B7CF6'}
                  onInput={(event) => onUpdateNodeData(node.id, { fill: event.currentTarget.value })}
                />
                <input
                  class="nl-input nl-tabular"
                  type="text"
                  value={fillValue}
                  onInput={(event) => onUpdateNodeData(node.id, { fill: event.currentTarget.value })}
                />
              </div>
              {!isSafeCssColorValue(fillValue) && (
                <span class="nl-field-error">Enter a valid hex, rgb(), or hsl() color.</span>
              )}
            </div>
          </>
        );
      }

      case 'action.set-variant': {
        const targetInstance = instanceNodes.find((item) => item.id === targetNodeId);
        const master =
          targetInstance && targetInstance.type === 'component-instance'
            ? components.find((comp) => comp.id === targetInstance.componentId)
            : undefined;
        const axes = master?.variants ?? [];
        const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
        const selectedAxis = axes.find((axis) => axis.id === axisId);
        const optionId = typeof node.data.optionId === 'string' ? node.data.optionId : '';

        return (
          <>
            {renderAstTargetPicker('Component instance', instanceNodes)}
            <label class="nl-field">
              <span>Variant axis</span>
              <select
                class="select-field"
                value={axisId}
                onChange={(event) => {
                  const nextAxisId = event.currentTarget.value;
                  const nextAxis = axes.find((a) => a.id === nextAxisId);
                  onUpdateNodeData(node.id, {
                    axisId: nextAxisId,
                    optionId: nextAxis?.options[0]?.id ?? '',
                  });
                }}
              >
                <option value="">Select axis…</option>
                {axes.map((axis) => (
                  <option key={axis.id} value={axis.id}>{axis.name}</option>
                ))}
              </select>
            </label>
            <label class="nl-field">
              <span>Variant option</span>
              <select
                class="select-field"
                value={optionId}
                onChange={(event) => onUpdateNodeData(node.id, { optionId: event.currentTarget.value })}
              >
                <option value="">Select option…</option>
                {(selectedAxis?.options ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </label>
          </>
        );
      }

      case 'action.navigate':
        return (
          <>
            <label class="nl-field">
              <span>Project page route</span>
              <select
                class="select-field"
                value={pages.some((p) => p.route === node.data.route) ? String(node.data.route) : ''}
                onChange={(event) => {
                  if (event.currentTarget.value) {
                    onUpdateNodeData(node.id, { route: event.currentTarget.value });
                  }
                }}
              >
                <option value="">Custom route or URL…</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.route}>
                    {page.name} ({page.route})
                  </option>
                ))}
              </select>
            </label>
            <label class="nl-field">
              <span>Route / safe URL (fallback when Route port is unwired)</span>
              <input
                class="nl-input"
                type="text"
                value={typeof node.data.route === 'string' ? node.data.route : '/'}
                onInput={(event) => onUpdateNodeData(node.id, { route: event.currentTarget.value })}
              />
            </label>
          </>
        );

      case 'action.set-theme':
        return (
          <label class="nl-field">
            <span>Design Token theme</span>
            <select
              class="select-field"
              value={typeof node.data.themeId === 'string' ? node.data.themeId : ''}
              onChange={(event) => onUpdateNodeData(node.id, { themeId: event.currentTarget.value })}
            >
              <option value="">Select theme…</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </label>
        );

      case 'action.play-animation':
        return (
          <label class="nl-field">
            <span>Motion Timeline clip</span>
            <select
              class="select-field"
              value={typeof node.data.clipId === 'string' ? node.data.clipId : ''}
              onChange={(event) => onUpdateNodeData(node.id, { clipId: event.currentTarget.value })}
            >
              <option value="">Select animation clip…</option>
              {animations.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.name} ({(clip.durationMs / 1000).toFixed(2)}s)
                </option>
              ))}
            </select>
          </label>
        );

      default:
        return (
          <p class="nl-inspector-hint">
            Non-v1 node type “{node.type}” is preserved safely inside this .flop v2 project.
          </p>
        );
    }
  };

  return (
    <aside class="nl-inspector" aria-label="Node Logic Inspector">
      <div class="nl-inspector-tabs" role="tablist" aria-label="Inspector sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'node'}
          class={`nl-tab-btn ${activeTab === 'node' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('node')}
        >
          Node
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'variables'}
          class={`nl-tab-btn ${activeTab === 'variables' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('variables')}
        >
          Variables ({graphVariables.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'simulate'}
          class={`nl-tab-btn ${activeTab === 'simulate' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('simulate')}
        >
          Simulate
        </button>
      </div>

      <div class="nl-inspector-body">
        {activeTab === 'node' && (
          <div class="nl-inspector-section">
            {selectedNode ? (
              <>
                <div class="nl-inspector-head">
                  <div>
                    <div class="nl-inspector-title">{nodeDef?.label ?? selectedNode.type}</div>
                    <div class="nl-inspector-meta nl-tabular">
                      {nodeDef?.category ?? 'custom'} · x {selectedNode.x} · y {selectedNode.y}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="nl-icon-danger"
                    title="Delete logic node"
                    aria-label={`Delete ${nodeDef?.label ?? selectedNode.type} node`}
                    onClick={() => onDeleteNode(selectedNode.id)}
                  >
                    <StudioIcon name="trash" />
                  </button>
                </div>
                {nodeDef?.description && (
                  <p class="nl-inspector-desc">{nodeDef.description}</p>
                )}

                <div class="nl-inspector-fields">
                  {renderNodeFields(selectedNode)}
                </div>

                {nodeDiagnostics.length > 0 && (
                  <div class="nl-diag-block" role="status">
                    <div class="nl-section-label">Node Diagnostics</div>
                    {nodeDiagnostics.map((diag, idx) => (
                      <div key={`${diag.code}-${idx}`} class={`nl-diag-item is-${diag.severity}`}>
                        <span class="nl-diag-severity">{diag.severity === 'error' ? 'Error' : 'Warning'}</span>
                        <span>{diag.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : selectedConnection && graph ? (
              <div class="nl-wire-inspector">
                <div class="nl-inspector-title">Selected Connection</div>
                <div class="nl-wire-summary">
                  <span>
                    {getLogicNodeDefinition(
                      graph.nodes.find((n) => n.id === selectedConnection.sourceNodeId)?.type ?? '',
                    )?.label ?? selectedConnection.sourceNodeId}
                    .{selectedConnection.sourcePortId}
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    {getLogicNodeDefinition(
                      graph.nodes.find((n) => n.id === selectedConnection.targetNodeId)?.type ?? '',
                    )?.label ?? selectedConnection.targetNodeId}
                    .{selectedConnection.targetPortId}
                  </span>
                </div>
                <button
                  type="button"
                  class="nl-danger-btn"
                  onClick={() => onDeleteConnection(selectedConnection.id)}
                >
                  Disconnect Wire
                </button>
                <p class="nl-inspector-hint">
                  Tip: Drag this wire or its connected input socket onto empty canvas to unplug, or onto another compatible port to re-patch.
                </p>
              </div>
            ) : graph ? (
              <div class="nl-graph-overview">
                <div class="nl-inspector-title">{graph.name}</div>
                <div class="nl-inspector-meta nl-tabular">
                  Scope: {graph.scope} · {graph.nodes.length} nodes · {graph.connections.length} wires
                </div>
                <p class="nl-inspector-hint">
                  Drag from an output socket to a compatible input socket to patch a wire. Drag a connected input socket or wire onto empty canvas to disconnect.
                </p>

                <div class="nl-diag-block">
                  <div class="nl-section-label">
                    Diagnostics ({diagnostics.length})
                  </div>
                  {diagnostics.length === 0 ? (
                    <div class="nl-diag-clean">All ports, variables, and layer bindings are valid.</div>
                  ) : (
                    <div class="nl-diag-list">
                      {diagnostics.map((diag, idx) => (
                        <button
                          key={`${diag.code}-${idx}`}
                          type="button"
                          class={`nl-diag-item nl-diag-button is-${diag.severity}`}
                          onClick={() => {
                            if (diag.nodeId) onFocusNode(diag.nodeId);
                          }}
                        >
                          <span class="nl-diag-severity">{diag.severity === 'error' ? 'Error' : 'Warn'}</span>
                          <span>{diag.message}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p class="nl-inspector-hint">Create or select a logic graph to start authoring interactions.</p>
            )}
          </div>
        )}

        {activeTab === 'variables' && (
          <div class="nl-inspector-section">
            <div class="nl-section-label">Graph State Variables</div>
            {!graph ? (
              <p class="nl-inspector-hint">Create a logic graph before declaring variables.</p>
            ) : (
              <>
                <form class="nl-var-form" onSubmit={handleCreateVariable}>
                  <input
                    class="nl-input"
                    type="text"
                    aria-label="New variable name"
                    placeholder="Variable name (e.g. isOpen)"
                    value={newVarName}
                    onInput={(event) => setNewVarName(event.currentTarget.value)}
                  />
                  <div class="nl-field-grid nl-field-grid-2">
                    <select
                      class="select-field"
                      aria-label="New variable type"
                      value={newVarType}
                      onChange={(event) => {
                        const nextType = event.currentTarget.value as LogicValueType;
                        setNewVarType(nextType);
                        setNewVarInitial(nextType === 'number' ? '0' : nextType === 'boolean' ? 'false' : '');
                      }}
                    >
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="string">String</option>
                    </select>
                    {newVarType === 'boolean' ? (
                      <select
                        class="select-field"
                        aria-label="New variable initial value"
                        value={newVarInitial}
                        onChange={(event) => setNewVarInitial(event.currentTarget.value)}
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : (
                      <input
                        class="nl-input nl-tabular"
                        type={newVarType === 'number' ? 'number' : 'text'}
                        aria-label="New variable initial value"
                        placeholder="Initial"
                        value={newVarInitial}
                        onInput={(event) => setNewVarInitial(event.currentTarget.value)}
                      />
                    )}
                  </div>
                  <button type="submit" class="nl-primary-btn">
                    Add Variable
                  </button>
                </form>

                {graphVariables.length === 0 ? (
                  <p class="nl-inspector-hint">No variables declared in this graph yet.</p>
                ) : (
                  <div class="nl-var-list">
                    {graphVariables.map((variable) => (
                      <div key={variable.id} class="nl-var-row">
                        <div class="nl-var-row-head">
                          <strong class="nl-var-name">{variable.name}</strong>
                          <span class="nl-var-type">{variable.valueType}</span>
                          <button
                            type="button"
                            class="nl-icon-danger"
                            aria-label={`Delete variable ${variable.name}`}
                            onClick={() => onDeleteVariable(variable.id)}
                          >
                            <StudioIcon name="trash" />
                          </button>
                        </div>
                        <div class="nl-var-row-edit">
                          <span class="nl-var-initial-label">Initial</span>
                          {variable.valueType === 'boolean' ? (
                            <select
                              class="select-field"
                              aria-label={`Initial value for ${variable.name}`}
                              value={String(Boolean(variable.initialValue))}
                              onChange={(event) =>
                                onUpdateVariable(variable.id, {
                                  initialValue: event.currentTarget.value === 'true',
                                })
                              }
                            >
                              <option value="false">false</option>
                              <option value="true">true</option>
                            </select>
                          ) : (
                            <input
                              class="nl-input nl-tabular"
                              type={variable.valueType === 'number' ? 'number' : 'text'}
                              aria-label={`Initial value for ${variable.name}`}
                              value={String(variable.initialValue)}
                              onInput={(event) =>
                                onUpdateVariable(variable.id, {
                                  initialValue: parseLiteralForType(event.currentTarget.value, variable.valueType),
                                })
                              }
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'simulate' && (
          <div class="nl-inspector-section">
            <div class="nl-section-label">Headless Prototype Simulator</div>
            <div class="nl-sim-actions">
              <button type="button" class="nl-secondary-btn" onClick={onRunMount}>
                Mount Page
              </button>
              <button type="button" class="nl-secondary-btn" onClick={onResetRuntime}>
                Reset
              </button>
            </div>

            {interactiveTriggers.length > 0 ? (
              <div class="nl-sim-triggers">
                <div class="nl-section-label">Trigger Events</div>
                {interactiveTriggers.map((trigger) => (
                  <button
                    key={`${trigger.logicNodeId}-${trigger.eventKind}`}
                    type="button"
                    class="nl-trigger-btn"
                    onClick={() => onTriggerNodeEvent(trigger.targetNodeId, trigger.eventKind)}
                  >
                    <StudioIcon name="preview" />
                    <span>{trigger.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p class="nl-inspector-hint">
                Add a Page, Component, Canvas Layer, On Click, or On Hover node to trigger interactive flows here.
              </p>
            )}

            {runtimeSnapshot && (
              <>
                <div class="nl-sim-state">
                  <div class="nl-section-label">Live State</div>
                  <div class="nl-sim-kv-list nl-tabular">
                    <div class="nl-sim-kv">
                      <span>Route</span>
                      <strong>{runtimeSnapshot.activeRoute}</strong>
                    </div>
                    <div class="nl-sim-kv">
                      <span>Theme</span>
                      <strong>
                        {themes.find((t) => t.id === runtimeSnapshot.activeThemeId)?.name ?? runtimeSnapshot.activeThemeId}
                      </strong>
                    </div>
                    {Object.entries(runtimeSnapshot.variables).map(([varId, val]) => {
                      const varMeta = availableVariables.find((v) => v.id === varId);
                      return (
                        <div key={varId} class="nl-sim-kv">
                          <span>{varMeta?.name ?? varId}</span>
                          <strong>{String(val)}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {Object.keys(runtimeSnapshot.nodeOverrides).length > 0 && (
                  <div class="nl-sim-overrides">
                    <div class="nl-section-label">Visual Overrides</div>
                    {Object.entries(runtimeSnapshot.nodeOverrides).map(([astId, override]) => {
                      const layerName = scopedAstNodes.find((n) => n.id === astId)?.name ?? astId;
                      return (
                        <div key={astId} class="nl-sim-override-row">
                          <strong>{layerName}</strong>
                          <span class="nl-tabular">
                            {[
                              override.text !== undefined ? `text: "${override.text}"` : null,
                              override.fill !== undefined ? `fill: ${override.fill}` : null,
                              override.visible !== undefined ? `visible: ${String(override.visible)}` : null,
                              override.variantSelection
                                ? `variant: ${Object.values(override.variantSelection).join(', ')}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div class="nl-sim-trace">
                  <div class="nl-section-label">
                    Execution Trace ({runtimeSnapshot.trace.length} steps)
                  </div>
                  {runtimeSnapshot.trace.length === 0 ? (
                    <div class="nl-inspector-hint">Click Mount Page or a trigger button above to inspect execution steps.</div>
                  ) : (
                    <div class="nl-trace-list nl-tabular">
                      {runtimeSnapshot.trace.slice(-16).map((entry) => (
                        <div key={`${entry.step}-${entry.nodeId}`} class="nl-trace-row">
                          <span class="nl-trace-step">#{entry.step}</span>
                          <span class="nl-trace-detail">{entry.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

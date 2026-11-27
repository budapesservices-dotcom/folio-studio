import { useState } from 'preact/hooks';
import type {
  AnimationClip,
  ComponentDefinition,
  DesignNode,
  DesignThemeDefinition,
  FolioPage,
  LogicConnection,
  LogicFrame,
  LogicGraph,
  LogicNetworkSettings,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariablePersist,
  LogicVariableScope,
  LogicVariableValue,
} from '../../core/document/types';
import {
  clearSessionNetworkTestToken,
  formatPipelinePayloadSummary,
  getLogicNodeDefinition,
  getSessionNetworkTestToken,
  hasSessionNetworkTestToken,
  isSafeSecretRef,
  resolveAstNodeById,
  setSessionNetworkTestToken,
  type LogicDiagnostic,
  type LogicNodeEventKind,
  type PrototypeRuntimeSnapshot,
} from '../../engines/prototype';
import { getDefaultInitialValueForType } from './nodeLogicGraphHelpers';
import { NodeLogicFrameInspector } from './NodeLogicFrameInspector';
import { NodeLogicNodeFields } from './NodeLogicNodeFields';
import { StudioIcon } from './StudioIcon';

export type NodeLogicInspectorTab = 'node' | 'variables' | 'simulate' | 'network';

export interface NodeLogicInspectorProps {
  activeTab: NodeLogicInspectorTab;
  graph: LogicGraph | null;
  selectedNode: LogicNode | null;
  selectedFrame: LogicFrame | null;
  selectedConnection: LogicConnection | null;
  frameBakeErrors: readonly LogicDiagnostic[];
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
  onUpdateFrame: (
    frameId: string,
    patch: Partial<Pick<LogicFrame, 'title' | 'color' | 'exposedParams'>>,
  ) => void;
  onBakeFrame: (frameId: string) => void;
  onUnbakeFrame: (frameId: string) => void;
  onSaveFramePreset: (frameId: string) => void;
  onDeleteFrame: (frameId: string, deleteChildren?: boolean) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteConnection: (connectionId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onAddVariable: (args: {
    name: string;
    valueType: LogicValueType;
    initialValue: LogicVariableValue;
    scope?: LogicVariableScope;
    persist?: LogicVariablePersist;
    computed?: boolean;
    computedExpression?: string;
  }) => void;
  onUpdateVariable: (
    variableId: string,
    patch: Partial<
      Pick<
        LogicVariableDefinition,
        'name' | 'valueType' | 'initialValue' | 'scope' | 'persist' | 'computed' | 'computedExpression'
      >
    >,
  ) => void;
  onDeleteVariable: (variableId: string) => void;
  onUpdateNetworkSettings: (patch: Partial<LogicNetworkSettings>) => void;
  onRunMount: () => void;
  onTriggerNodeEvent: (nodeId: string, event: LogicNodeEventKind) => void;
  onResetRuntime: () => void;
  onUpgradeLegacyNode?: (nodeId: string) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
}

function parseLiteralForType(raw: string, valueType: LogicValueType): LogicVariableValue {
  if (valueType === 'boolean') return raw === 'true';
  if (valueType === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (valueType === 'list') {
    const trimmed = raw.trim();
    return trimmed || '[]';
  }
  if (valueType === 'object') {
    const trimmed = raw.trim();
    return trimmed || '{}';
  }
  return raw;
}

function formatVariableValue(val: LogicVariableValue): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

export function NodeLogicInspector({
  activeTab,
  graph,
  selectedNode,
  selectedFrame,
  selectedConnection,
  frameBakeErrors,
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
  onUpdateFrame,
  onBakeFrame,
  onUnbakeFrame,
  onSaveFramePreset,
  onDeleteFrame,
  onDeleteNode,
  onDeleteConnection,
  onFocusNode,
  onAddVariable,
  onUpdateVariable,
  onDeleteVariable,
  onUpdateNetworkSettings,
  onRunMount,
  onTriggerNodeEvent,
  onResetRuntime,
  onUpgradeLegacyNode,
  onToggleComponentNodeLogic,
}: NodeLogicInspectorProps) {
  const [newVarName, setNewVarName] = useState('');
  const [newVarType, setNewVarType] = useState<LogicValueType>('number');
  const [newVarInitial, setNewVarInitial] = useState('0');
  const [newVarScope, setNewVarScope] = useState<LogicVariableScope>('local');
  const [newVarPersist, setNewVarPersist] = useState<LogicVariablePersist>('none');
  const [newVarComputed, setNewVarComputed] = useState(false);
  const [newVarComputedExpr, setNewVarComputedExpr] = useState('');
  const [expandedTraceGroups, setExpandedTraceGroups] = useState<Record<string, boolean>>({});
  const [, setSessionTokenVersion] = useState(0);

  const nodeDef = selectedNode ? getLogicNodeDefinition(selectedNode.type) : undefined;
  const replacementDef = nodeDef?.replacementType
    ? getLogicNodeDefinition(nodeDef.replacementType)
    : undefined;
  const nodeDiagnostics = selectedNode
    ? diagnostics.filter((item) => item.nodeId === selectedNode.id)
    : [];
  const networkDiagnostics = diagnostics.filter(
    (item) =>
      item.code === 'UNSAFE_AUTH_SECRET_REF' ||
      item.code === 'HARDCODED_SECRET_HEADER' ||
      item.code === 'UNSAFE_NETWORK_URL_CREDENTIALS',
  );

  const graphVariables = graph?.variables ?? [];
  const networkSettings: LogicNetworkSettings = graph?.networkSettings ?? {
    baseUrl: '',
    globalHeaders: '',
    authSecretRef: '',
  };
  const sessionTestToken = graph
    ? getSessionNetworkTestToken(graph.id, networkSettings.authSecretRef)
    : '';
  const hasSessionToken = graph
    ? hasSessionNetworkTestToken(graph.id, networkSettings.authSecretRef)
    : false;
  const authSecretRefValid = isSafeSecretRef(networkSettings.authSecretRef);

  const interactiveTriggers = graph
    ? graph.nodes.flatMap((node) => {
        if (node.type === 'event.on-click') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              eventKind: 'click' as LogicNodeEventKind,
              label: `Click “${targetAst?.name ?? 'Unbound'}”`,
            },
          ];
        }
        if (node.type === 'event.on-hover') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          const eventKind: LogicNodeEventKind = node.data.phase === 'leave' ? 'hover-leave' : 'hover-enter';
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              eventKind,
              label:
                eventKind === 'hover-leave'
                  ? `Hover Leave “${targetAst?.name ?? 'Unbound'}”`
                  : `Hover Enter “${targetAst?.name ?? 'Unbound'}”`,
            },
          ];
        }
        if (node.type === 'event.on-input') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              eventKind: 'input' as LogicNodeEventKind,
              label: `Input (${String(node.data.mode ?? 'change')}) “${targetAst?.name ?? 'Layer'}”`,
            },
          ];
        }
        if (node.type === 'event.on-key-press') {
          return [
            {
              logicNodeId: node.id,
              targetNodeId: node.id,
              eventKind: 'key-press' as LogicNodeEventKind,
              label: `Key Press “${String(node.data.keyCombo ?? 'Enter')}”`,
            },
          ];
        }
        if (node.type === 'event.on-drag') {
          const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
          if (!targetId) return [];
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              eventKind: 'drag' as LogicNodeEventKind,
              label: `Drag (${String(node.data.phase ?? 'start')}) “${targetAst?.name ?? 'Layer'}”`,
            },
          ];
        }
        if (node.type === 'event.on-scroll-view') {
          const targetId = typeof node.data.targetNodeId === 'string' && node.data.targetNodeId
            ? node.data.targetNodeId
            : node.id;
          const targetAst = scopedAstNodes.find((item) => item.id === targetId);
          return [
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
              eventKind: 'scroll-view' as LogicNodeEventKind,
              label: `Scroll / View (${String(node.data.mode ?? 'enter-view')})${targetAst ? ` “${targetAst.name}”` : ''}`,
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
              eventKind: 'click' as LogicNodeEventKind,
              label: `Click Layer “${name}”`,
            },
            {
              logicNodeId: node.id,
              targetNodeId: targetId,
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
              eventKind: 'click' as LogicNodeEventKind,
              label: `Click Component “${name}”`,
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
      scope: newVarScope,
      persist: newVarPersist,
      ...(newVarComputed ? { computed: true, computedExpression: newVarComputedExpr.trim() } : {}),
    });
    setNewVarName('');
    setNewVarInitial(String(getDefaultInitialValueForType(newVarType)));
    setNewVarComputed(false);
    setNewVarComputedExpr('');
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
          Shared ({graphVariables.length})
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'network'}
          class={`nl-tab-btn ${activeTab === 'network' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('network')}
        >
          Network
        </button>
      </div>

      <div class="nl-inspector-body">
        {activeTab === 'node' && (
          <div class="nl-inspector-section">
            {selectedFrame && graph ? (
              <NodeLogicFrameInspector
                graph={graph}
                frame={selectedFrame}
                diagnostics={diagnostics}
                bakeErrors={frameBakeErrors}
                onUpdateFrame={onUpdateFrame}
                onUpdateNodeData={onUpdateNodeData}
                onBakeFrame={onBakeFrame}
                onUnbakeFrame={onUnbakeFrame}
                onSaveFramePreset={onSaveFramePreset}
                onDeleteFrame={onDeleteFrame}
                onFocusNode={onFocusNode}
              />
            ) : selectedNode ? (
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

                {nodeDef?.deprecated && replacementDef && onUpgradeLegacyNode && (
                  <div class="nl-legacy-banner" role="note" data-testid="nl-legacy-upgrade-banner">
                    <div class="nl-legacy-banner-copy">
                      <strong>Legacy v1 Node</strong>
                      <span>
                        Kept for older <code>.flop</code> files. Upgrade to{' '}
                        <strong>{replacementDef.label}</strong> to use the modern node contract.
                      </span>
                    </div>
                    <button
                      type="button"
                      class="nl-primary-btn"
                      data-testid="nl-upgrade-legacy-btn"
                      onClick={() => onUpgradeLegacyNode(selectedNode.id)}
                    >
                      Upgrade to {replacementDef.label}
                    </button>
                  </div>
                )}

                <div class="nl-inspector-fields">
                  <NodeLogicNodeFields
                    node={selectedNode}
                    graph={graph}
                    scopedAstNodes={scopedAstNodes}
                    availableVariables={availableVariables}
                    components={components}
                    pages={pages}
                    themes={themes}
                    animations={animations}
                    onChangeTab={onChangeTab}
                    onUpdateNodeData={onUpdateNodeData}
                    onToggleComponentNodeLogic={onToggleComponentNodeLogic}
                  />
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
            <div class="nl-section-label">Shared / Global Variables (Optional)</div>
            <p class="nl-inspector-hint">
              Stateful nodes like <strong>Toggle State</strong> keep private per-target memory automatically. Declare Shared Variables only when unconnected flows need to share state.
            </p>
            {!graph ? (
              <p class="nl-inspector-hint">Create a logic graph before declaring shared variables.</p>
            ) : (
              <>
                <form class="nl-var-form" onSubmit={handleCreateVariable}>
                  <input
                    class="nl-input"
                    type="text"
                    aria-label="New variable name"
                    placeholder="Variable name (e.g. cartItems)"
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
                        setNewVarInitial(String(getDefaultInitialValueForType(nextType)));
                      }}
                    >
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="string">String</option>
                      <option value="list">List (Array)</option>
                      <option value="object">Object (JSON)</option>
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
                        placeholder={newVarType === 'list' ? '[]' : newVarType === 'object' ? '{}' : 'Initial'}
                        value={newVarInitial}
                        onInput={(event) => setNewVarInitial(event.currentTarget.value)}
                      />
                    )}
                  </div>
                  <div class="nl-field-grid nl-field-grid-2">
                    <label class="nl-field">
                      <span>Scope</span>
                      <select
                        class="select-field"
                        aria-label="New variable scope"
                        value={newVarScope}
                        onChange={(event) => setNewVarScope(event.currentTarget.value as LogicVariableScope)}
                      >
                        <option value="local">Local</option>
                        <option value="global">Global</option>
                      </select>
                    </label>
                    <label class="nl-field">
                      <span>Persist (metadata)</span>
                      <select
                        class="select-field"
                        aria-label="New variable persistence"
                        value={newVarPersist}
                        onChange={(event) => setNewVarPersist(event.currentTarget.value as LogicVariablePersist)}
                      >
                        <option value="none">None</option>
                        <option value="local">LocalStorage (metadata only)</option>
                        <option value="session">SessionStorage (metadata only)</option>
                      </select>
                    </label>
                  </div>
                  {newVarPersist !== 'none' && (
                    <p class="nl-inspector-hint">
                      Metadata only · runtime persistence is not yet executed (storage is disabled in sandboxed Live Preview).
                    </p>
                  )}
                  <label class="nl-checkbox-row">
                    <input
                      type="checkbox"
                      checked={newVarComputed}
                      onChange={(event) => setNewVarComputed(event.currentTarget.checked)}
                    />
                    <span>Computed variable (metadata only)</span>
                  </label>
                  {newVarComputed && (
                    <>
                      <input
                        class="nl-input"
                        type="text"
                        aria-label="Computed expression"
                        placeholder="e.g. {{price}} * {{qty}}"
                        value={newVarComputedExpr}
                        onInput={(event) => setNewVarComputedExpr(event.currentTarget.value)}
                      />
                      <p class="nl-inspector-hint">
                        Metadata only · computed expressions are not evaluated at runtime (zero-eval policy).
                      </p>
                    </>
                  )}
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
                        <div class="nl-var-meta-grid">
                          <select
                            class="select-field"
                            aria-label={`Scope for ${variable.name}`}
                            value={variable.scope ?? 'local'}
                            onChange={(event) =>
                              onUpdateVariable(variable.id, {
                                scope: event.currentTarget.value as LogicVariableScope,
                              })
                            }
                          >
                            <option value="local">Local</option>
                            <option value="global">Global</option>
                          </select>
                          <select
                            class="select-field"
                            aria-label={`Persist for ${variable.name}`}
                            value={variable.persist ?? 'none'}
                            onChange={(event) =>
                              onUpdateVariable(variable.id, {
                                persist: event.currentTarget.value as LogicVariablePersist,
                              })
                            }
                          >
                            <option value="none">No persist</option>
                            <option value="local">LocalStorage (persisted)</option>
                            <option value="session">SessionStorage (tab)</option>
                          </select>
                        </div>
                        {variable.persist && variable.persist !== 'none' && (
                          <p class="nl-inspector-hint">
                            Active · hydrates &amp; persists automatically in Simulator, Live Preview, and React TSX.
                          </p>
                        )}
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
                              value={formatVariableValue(variable.initialValue)}
                              onInput={(event) =>
                                onUpdateVariable(variable.id, {
                                  initialValue: parseLiteralForType(event.currentTarget.value, variable.valueType),
                                })
                              }
                            />
                          )}
                        </div>
                        <label class="nl-checkbox-row">
                          <input
                            type="checkbox"
                            checked={Boolean(variable.computed)}
                            onChange={(event) =>
                              onUpdateVariable(variable.id, { computed: event.currentTarget.checked })
                            }
                          />
                          <span>Computed (reactive zero-eval)</span>
                        </label>
                        {variable.computed && (
                          <>
                            <input
                              class="nl-input"
                              type="text"
                              aria-label={`Computed expression for ${variable.name}`}
                              placeholder="Expression (e.g. clicks * 2 or {{count}} items)"
                              value={variable.computedExpression ?? ''}
                              onInput={(event) =>
                                onUpdateVariable(variable.id, { computedExpression: event.currentTarget.value })
                              }
                            />
                            <p class="nl-inspector-hint">
                              Active · supports math, ternary, comparisons, min/max/round/clamp/len, and {'{{var}}'} templates.
                            </p>
                          </>
                        )}
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
                Add any Event or Element / Layer source node to trigger interactive flows here.
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
                          <strong>{formatVariableValue(val)}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(() => {
                  const privateEntries = Object.entries(runtimeSnapshot.privateMemory ?? {});
                  const astMap = new Map(scopedAstNodes.map((n) => [n.id, n]));
                  const compMap = new Map(components.map((c) => [c.id, c]));
                  return (
                    <div class="nl-sim-private-mem" data-testid="nl-sim-private-memory">
                      <div class="nl-section-label">
                        Private Node Memory ({privateEntries.length})
                      </div>
                      {privateEntries.length === 0 ? (
                        <div class="nl-inspector-hint">
                          No private node memory recorded yet. Trigger a Toggle State flow to inspect target-bound memory.
                        </div>
                      ) : (
                        <div class="nl-sim-kv-list nl-tabular">
                          {privateEntries.map(([memKey, memVal]) => {
                            const parts = memKey.split(':');
                            let memFrameId: string | null = null;
                            let memNodeId = memKey;
                            let memOriginId = 'default';
                            if (parts.length >= 3) {
                              memFrameId = parts[0];
                              memNodeId = parts[1];
                              memOriginId = parts.slice(2).join(':');
                            } else if (parts.length === 2) {
                              memNodeId = parts[0];
                              memOriginId = parts[1];
                            }
                            const ownerFrame = memFrameId
                              ? graph?.frames?.find((f) => f.id === memFrameId)
                              : undefined;
                            const logicNode = graph?.nodes.find((n) => n.id === memNodeId);
                            const logicLabel = logicNode
                              ? (getLogicNodeDefinition(logicNode.type)?.label ?? logicNode.type)
                              : memNodeId;
                            const originName =
                              memOriginId === 'default'
                                ? 'default'
                                : (resolveAstNodeById(memOriginId, astMap, compMap)?.name ?? memOriginId);
                            const displayLabel = ownerFrame
                              ? `${ownerFrame.title} / ${logicLabel} · ${originName}`
                              : `${logicLabel} · ${originName}`;
                            return (
                              <div key={memKey} class="nl-sim-kv">
                                <span>{displayLabel}</span>
                                <strong>{String(memVal)}</strong>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {runtimeSnapshot.toasts && runtimeSnapshot.toasts.length > 0 && (
                  <div class="nl-sim-toasts">
                    <div class="nl-section-label">Toasts ({runtimeSnapshot.toasts.length})</div>
                    {runtimeSnapshot.toasts.map((toast, idx) => (
                      <div key={`${toast.message}-${idx}`} class={`nl-sim-toast is-${toast.tone}`}>
                        <span>{toast.tone.toUpperCase()}</span>
                        <strong>{toast.message}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {Object.keys(runtimeSnapshot.nodeOverrides).length > 0 && (
                  <div class="nl-sim-overrides">
                    <div class="nl-section-label">Visual Overrides</div>
                    {Object.entries(runtimeSnapshot.nodeOverrides).map(([astId, override]) => {
                      const astMap = new Map(scopedAstNodes.map((n) => [n.id, n]));
                      const compMap = new Map(components.map((c) => [c.id, c]));
                      const layerName = resolveAstNodeById(astId, astMap, compMap)?.name ?? astId;
                      return (
                        <div key={astId} class="nl-sim-override-row">
                          <strong>{layerName}</strong>
                          <span class="nl-tabular">
                            {[
                              override.text !== undefined ? `text: "${override.text}"` : null,
                              override.fill !== undefined ? `fill: ${override.fill}` : null,
                              override.visible !== undefined ? `visible: ${String(override.visible)}` : null,
                              override.opacity !== undefined ? `opacity: ${override.opacity}` : null,
                              override.transform !== undefined ? `transform: ${override.transform}` : null,
                              override.imageUrl !== undefined ? `image: ${override.imageUrl}` : null,
                              override.disabled !== undefined ? `disabled: ${String(override.disabled)}` : null,
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
                      {runtimeSnapshot.trace.slice(-16).map((entry) => {
                        const payloadSummary = formatPipelinePayloadSummary(entry.payload);
                        const hasNested = Boolean(entry.nestedSteps && entry.nestedSteps.length > 0);
                        const groupKey = `${entry.step}-${entry.nodeId}`;
                        const isExpanded = Boolean(expandedTraceGroups[groupKey]);
                        if (hasNested) {
                          return (
                            <div key={groupKey} class="nl-trace-group" data-testid={`nl-trace-group-${entry.frameId ?? entry.nodeId}`}>
                              <button
                                type="button"
                                class="nl-trace-group-toggle"
                                aria-expanded={isExpanded}
                                onClick={() =>
                                  setExpandedTraceGroups((prev) => ({
                                    ...prev,
                                    [groupKey]: !prev[groupKey],
                                  }))
                                }
                              >
                                <span class="nl-trace-step">#{entry.step}</span>
                                <span class="nl-trace-group-title">{entry.detail}</span>
                                <span class="nl-trace-chevron" aria-hidden="true">
                                  {isExpanded ? '▾' : '▸'}
                                </span>
                              </button>
                              {isExpanded && entry.nestedSteps && (
                                <div class="nl-trace-nested-list">
                                  {entry.nestedSteps.map((sub) => {
                                    const subPayload = formatPipelinePayloadSummary(sub.payload);
                                    return (
                                      <div key={`${sub.step}-${sub.nodeId}`} class="nl-trace-row is-nested">
                                        <span class="nl-trace-step">#{sub.step}</span>
                                        <span class="nl-trace-detail">{sub.detail}</span>
                                        {subPayload && (
                                          <span class="nl-trace-payload">{subPayload}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div key={groupKey} class="nl-trace-row">
                            <span class="nl-trace-step">#{entry.step}</span>
                            <span class="nl-trace-detail">{entry.detail}</span>
                            {payloadSummary && (
                              <span class="nl-trace-payload">{payloadSummary}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'network' && (
          <div class="nl-inspector-section" data-testid="nl-network-settings-panel">
            <div class="nl-section-label">Project Network Settings</div>
            {!graph ? (
              <p class="nl-inspector-hint">Create a logic graph before configuring network settings.</p>
            ) : (
              <>
                <p class="nl-inspector-hint">
                  Shared by all HTTP Request, External Data, and Realtime Socket nodes in this graph.
                </p>
                <label class="nl-field">
                  <span>Base URL</span>
                  <input
                    class="nl-input"
                    type="text"
                    aria-label="Network Base URL"
                    placeholder="https://api.example.com/v1"
                    value={networkSettings.baseUrl}
                    onInput={(event) => onUpdateNetworkSettings({ baseUrl: event.currentTarget.value })}
                  />
                </label>
                <label class="nl-field">
                  <span>Global Headers (JSON)</span>
                  <textarea
                    class="nl-textarea nl-tabular"
                    rows={3}
                    aria-label="Network Global Headers"
                    placeholder={'{"Accept": "application/json"}'}
                    value={networkSettings.globalHeaders}
                    onInput={(event) => onUpdateNetworkSettings({ globalHeaders: event.currentTarget.value })}
                  />
                </label>
                <label class="nl-field">
                  <span>Auth Secret Reference (Env Key)</span>
                  <input
                    class="nl-input nl-tabular"
                    type="text"
                    aria-label="Auth Secret Reference"
                    placeholder="API_TOKEN"
                    value={networkSettings.authSecretRef}
                    onInput={(event) => onUpdateNetworkSettings({ authSecretRef: event.currentTarget.value })}
                  />
                </label>
                {!authSecretRefValid && (
                  <div class="nl-diag-item is-error" role="alert">
                    <span class="nl-diag-severity">Error</span>
                    <span>
                      Enter an environment key name only (e.g. <code>API_TOKEN</code>), never a raw token or secret value.
                    </span>
                  </div>
                )}

                <div class="nl-field">
                  <div class="nl-session-token-head">
                    <span>Local Test Token (Session-Only)</span>
                    {hasSessionToken && (
                      <span class="nl-session-badge" data-testid="nl-session-token-badge">
                        Active in RAM
                      </span>
                    )}
                  </div>
                  <div class="nl-session-token-row">
                    <input
                      class="nl-input"
                      type="password"
                      autocomplete="off"
                      aria-label="Local Session Test Token"
                      placeholder="Temporary Bearer token (not saved)"
                      value={sessionTestToken}
                      onInput={(event) => {
                        setSessionNetworkTestToken(
                          graph.id,
                          networkSettings.authSecretRef,
                          event.currentTarget.value,
                        );
                        setSessionTokenVersion((v) => v + 1);
                      }}
                    />
                    {hasSessionToken && (
                      <button
                        type="button"
                        class="nl-secondary-btn"
                        onClick={() => {
                          clearSessionNetworkTestToken(graph.id, networkSettings.authSecretRef);
                          setSessionTokenVersion((v) => v + 1);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div class="nl-security-banner" role="note" data-testid="nl-network-security-warning">
                  <strong>Security Notice:</strong> Never embed live API keys or sensitive credentials in public frontend apps.
                  Only the <code>Auth Secret Reference</code> key name is saved to <code>.flop</code> files; your Local Test Token stays strictly in browser memory for this session and is never written to <code>.flop</code>, Live Preview, or exported code.
                </div>

                {networkDiagnostics.length > 0 && (
                  <div class="nl-diag-block" role="status">
                    <div class="nl-section-label">Network Security Checks</div>
                    {networkDiagnostics.map((diag, idx) => (
                      <div key={`${diag.code}-${idx}`} class={`nl-diag-item is-${diag.severity}`}>
                        <span class="nl-diag-severity">{diag.severity === 'error' ? 'Error' : 'Warning'}</span>
                        <span>{diag.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

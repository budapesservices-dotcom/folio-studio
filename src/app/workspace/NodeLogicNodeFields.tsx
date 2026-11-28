import { useState } from 'preact/hooks';
import { isSafeCssColorValue } from '../../core/document/tokens';
import type {
  AnimationClip,
  ComponentDefinition,
  DesignNode,
  DesignThemeDefinition,
  FolioPage,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
} from '../../core/document/types';
import {
  getNodeTargetMode,
  getScopedUpstreamOutputs,
  getSessionNetworkTestToken,
  getUpstreamPipelineOrigins,
  LOGIC_COMPARE_OPERATORS,
  parsePipelineRef,
  parseSafeRuntimeHeaders,
  resolveAstNodeById,
  type LogicPortDataType,
  type PipelineOriginChildRef,
  type PipelineTargetMode,
} from '../../engines/prototype';
import { analyzeRegexPattern } from '../../engines/codegen/sanitize';
import { getUsedSourceReferenceIds } from './nodeLogicGraphHelpers';
import type { NodeLogicInspectorTab } from './NodeLogicInspector';

export interface NodeLogicNodeFieldsProps {
  node: LogicNode;
  graph: LogicGraph | null;
  scopedAstNodes: readonly DesignNode[];
  availableVariables: readonly LogicVariableDefinition[];
  components: readonly ComponentDefinition[];
  pages: readonly FolioPage[];
  themes: readonly DesignThemeDefinition[];
  animations: readonly AnimationClip[];
  onChangeTab: (tab: NodeLogicInspectorTab) => void;
  onUpdateNodeData: (nodeId: string, patch: Record<string, string | number | boolean | null>) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
}

const UPDATE_OPERATIONS_BY_TYPE: Record<LogicValueType, readonly { value: string; label: string }[]> = {
  number: [
    { value: 'set', label: 'Set' },
    { value: 'increment', label: 'Increment' },
    { value: 'cycle', label: 'Cycle values' },
    { value: 'reset', label: 'Reset to initial' },
  ],
  boolean: [
    { value: 'set', label: 'Set' },
    { value: 'reset', label: 'Reset to initial' },
  ],
  string: [
    { value: 'set', label: 'Set' },
    { value: 'cycle', label: 'Cycle values' },
    { value: 'reset', label: 'Reset to initial' },
  ],
  list: [
    { value: 'push', label: 'Push item' },
    { value: 'remove', label: 'Remove item / index' },
    { value: 'set', label: 'Replace list (JSON)' },
    { value: 'reset', label: 'Reset to initial' },
  ],
  object: [
    { value: 'set-property', label: 'Set property (path)' },
    { value: 'set', label: 'Replace object (JSON)' },
    { value: 'reset', label: 'Reset to initial' },
  ],
};

function parseLooseValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
}

export function NodeLogicNodeFields({
  node,
  graph,
  scopedAstNodes,
  availableVariables,
  components,
  pages,
  themes,
  animations,
  onChangeTab,
  onUpdateNodeData,
  onToggleComponentNodeLogic,
}: NodeLogicNodeFieldsProps) {
  const [liveTestState, setLiveTestState] = useState<{
    readonly nodeId: string;
    readonly loading: boolean;
    readonly status?: number;
    readonly ok?: boolean;
    readonly durationMs?: number;
    readonly preview?: string;
    readonly error?: string;
    readonly authMode?: 'session-token' | 'server-secret' | 'none';
  } | null>(null);

  const runLiveProxyTest = async (rawUrl: string, method: string, body?: string, useAuth?: boolean) => {
    const baseUrl = graph?.networkSettings?.baseUrl?.trim() ?? '';
    const trimmed = rawUrl.trim();
    const resolvedUrl =
      /^https?:\/\//i.test(trimmed)
        ? trimmed
        : baseUrl
          ? `${baseUrl.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`
          : trimmed;

    const safeGlobalHeaders = parseSafeRuntimeHeaders(graph?.networkSettings?.globalHeaders);
    const authSecretRef = graph?.networkSettings?.authSecretRef?.trim() ?? '';
    const sessionTestToken = graph ? getSessionNetworkTestToken(graph.id, authSecretRef).trim() : '';

    const requestHeaders: Record<string, string> = { ...(safeGlobalHeaders ?? {}) };
    let authMode: 'session-token' | 'server-secret' | 'none' = 'none';
    let effectiveAuthSecretRef: string | undefined;

    if (useAuth && sessionTestToken) {
      // Strictly session-only in-memory token used ONLY for this live test request when auth is enabled.
      requestHeaders.Authorization = /^(?:Bearer|Basic|Token)\s+/i.test(sessionTestToken)
        ? sessionTestToken
        : `Bearer ${sessionTestToken}`;
      authMode = 'session-token';
    } else if (useAuth && authSecretRef) {
      effectiveAuthSecretRef = authSecretRef;
      authMode = 'server-secret';
    }

    setLiveTestState({ nodeId: node.id, loading: true, authMode });
    try {
      const response = await fetch('/api/logic/http-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: resolvedUrl,
          method,
          ...(Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
          ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
          ...(effectiveAuthSecretRef ? { authSecretRef: effectiveAuthSecretRef } : {}),
        }),
      });
      const text = await response.text();
      let json: {
        status?: number;
        ok?: boolean;
        durationMs?: number;
        data?: unknown;
        error?: string;
      };
      try {
        json = JSON.parse(text) as {
          status?: number;
          ok?: boolean;
          durationMs?: number;
          data?: unknown;
          error?: string;
        };
      } catch {
        json = {
          status: response.status,
          ok: false,
          error: `Proxy returned non-JSON HTTP ${response.status}.`,
        };
      }
      const rawPreview =
        json.data !== undefined && json.data !== null
          ? (typeof json.data === 'string' ? json.data : JSON.stringify(json.data, null, 2))
          : '';
      setLiveTestState({
        nodeId: node.id,
        loading: false,
        status: json.status ?? response.status,
        ok: Boolean(json.ok),
        durationMs: json.durationMs,
        preview: rawPreview.slice(0, 600),
        error: json.error,
        authMode,
      });
    } catch (err) {
      setLiveTestState({
        nodeId: node.id,
        loading: false,
        ok: false,
        error: err instanceof Error ? err.message : 'Proxy request failed.',
        authMode,
      });
    }
  };
  const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
  const variableId = typeof node.data.variableId === 'string' ? node.data.variableId : '';
  const targetMode: PipelineTargetMode = getNodeTargetMode(node);
  const pipelineChildId = typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId : '';

  const astNodesById = new Map<string, DesignNode>(scopedAstNodes.map((item) => [item.id, item]));
  const componentsById = new Map<string, ComponentDefinition>(components.map((item) => [item.id, item]));

  const upstreamOrigins = graph
    ? getUpstreamPipelineOrigins(
        graph.nodes,
        graph.connections,
        node.id,
        astNodesById,
        componentsById,
        animations,
      )
    : [];
  const upstreamOutputs = graph
    ? getScopedUpstreamOutputs(
        graph.nodes,
        graph.connections,
        node.id,
        astNodesById,
        componentsById,
        animations,
      )
    : [];

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

  /**
   * Scoped Pipeline target selector: defaults to `Inherit from Pipeline`
   * (allowing Origin or any direct/nested Child of an upstream Group/Component)
   * with an explicit `Override Target` toggle for manual layer selection.
   */
  const renderPipelineTargetField = (label: string, overrideCandidates: readonly DesignNode[]) => {
    const primaryOrigin = upstreamOrigins[0] ?? null;
    const allChildren: PipelineOriginChildRef[] = [];
    const seenChildIds = new Set<string>();
    for (const origin of upstreamOrigins) {
      for (const child of origin.children ?? []) {
        if (seenChildIds.has(child.id)) continue;
        seenChildIds.add(child.id);
        allChildren.push(child);
      }
    }
    const missingSavedChild =
      pipelineChildId !== '' && !seenChildIds.has(pipelineChildId);

    return (
      <div class="nl-pipeline-target-box" data-testid="nl-pipeline-target-box">
        <div class="nl-field">
          <span>Target resolution</span>
          <div class="nl-target-mode-toggle" role="group" aria-label="Target resolution mode">
            <button
              type="button"
              class={`nl-target-mode-btn ${targetMode === 'pipeline' ? 'is-active' : ''}`}
              aria-pressed={targetMode === 'pipeline'}
              title="Inherit from Pipeline"
              onClick={() => onUpdateNodeData(node.id, { targetMode: 'pipeline' })}
            >
              Inherit Pipeline
            </button>
            <button
              type="button"
              class={`nl-target-mode-btn ${targetMode === 'override' ? 'is-active' : ''}`}
              aria-pressed={targetMode === 'override'}
              title="Override Target"
              onClick={() => onUpdateNodeData(node.id, { targetMode: 'override' })}
            >
              Override Target
            </button>
          </div>
        </div>

        {targetMode === 'pipeline' ? (
          primaryOrigin ? (
            <>
              <div class="nl-pipeline-origin-chip">
                <strong>Origin: {primaryOrigin.name}</strong>
                <span>
                  {primaryOrigin.type}
                  {allChildren.length > 0 ? ` · ${allChildren.length} children` : ''}
                  {upstreamOrigins.length > 1 ? ` · +${upstreamOrigins.length - 1} more` : ''}
                </span>
              </div>
              <label class="nl-field">
                <span>Pipeline layer (Origin or Child)</span>
                <select
                  class={`select-field ${missingSavedChild ? 'is-disconnected' : ''}`}
                  aria-label="Pipeline target layer"
                  value={pipelineChildId}
                  onChange={(event) =>
                    onUpdateNodeData(node.id, { pipelineChildId: event.currentTarget.value })
                  }
                >
                  <option value="">
                    Origin · {primaryOrigin.name} ({primaryOrigin.type})
                  </option>
                  {allChildren.map((child) => (
                    <option key={child.id} value={child.id}>
                      Child · {child.name} ({child.type})
                    </option>
                  ))}
                  {missingSavedChild && (
                    <option value={pipelineChildId}>
                      ⚠ Missing child ({pipelineChildId})
                    </option>
                  )}
                </select>
              </label>
            </>
          ) : (
            <div class="nl-pipeline-origin-chip is-disconnected">
              <strong>No upstream pipeline origin</strong>
              <span>
                Connect an upstream Event (e.g. On Click) or switch to Override Target.
              </span>
            </div>
          )
        ) : (
          renderAstTargetPicker(label, overrideCandidates)
        )}
      </div>
    );
  };

  /**
   * Dynamic Scoped Data Picker: shows only outputs from actively connected
   * upstream nodes (cycle-safe), plus a clear diagnostic state if a saved ref
   * became disconnected after unplugging a wire.
   */
  const renderScopedDataPicker = (
    label: string,
    refField: 'pipelineRef' | 'leftRef' | 'rightRef',
    allowedTypes?: readonly LogicPortDataType[],
  ) => {
    const currentRef = typeof node.data[refField] === 'string' ? node.data[refField] : '';
    const filteredOutputs = allowedTypes
      ? upstreamOutputs.filter(
          (opt) =>
            opt.valueType === 'any'
            || allowedTypes.includes(opt.valueType)
            || opt.refKey === currentRef,
        )
      : upstreamOutputs;
    const isDisconnected =
      currentRef !== '' && !upstreamOutputs.some((opt) => opt.refKey === currentRef);
    const parsedSaved = parsePipelineRef(currentRef);

    return (
      <div class="nl-scoped-picker" data-testid={`nl-scoped-picker-${refField}`}>
        <label class="nl-field">
          <span>{label}</span>
          <select
            class={`select-field ${isDisconnected ? 'is-disconnected' : ''}`}
            aria-label={label}
            value={currentRef}
            onChange={(event) =>
              onUpdateNodeData(node.id, { [refField]: event.currentTarget.value })
            }
          >
            <option value="">Manual / Literal (or wired port)</option>
            {filteredOutputs.map((opt) => (
              <option key={opt.refKey} value={opt.refKey}>
                {opt.label} ({opt.valueType})
              </option>
            ))}
            {isDisconnected && (
              <option value={currentRef}>
                ⚠ Disconnected ({parsedSaved ? parsedSaved.field : currentRef})
              </option>
            )}
          </select>
        </label>
        {isDisconnected ? (
          <span class="nl-scoped-disconnected">
            Referenced upstream node is disconnected. Reconnect wire or clear selection — see Node Diagnostics.
          </span>
        ) : filteredOutputs.length === 0 ? (
          <span class="nl-scoped-empty-hint">
            Connect upstream nodes (e.g. Toggle State, Condition) to pick their outputs here.
          </span>
        ) : null}
      </div>
    );
  };

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

  /** Built-in controls shared across all 8 Event nodes: Once, Debounce (ms), Throttle (ms). */
  const renderEventControls = () => (
    <div class="nl-event-common-box" data-testid="nl-event-common-controls">
      <div class="nl-section-label">Event Controls</div>
      <label class="nl-checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(node.data.once)}
          onChange={(event) => onUpdateNodeData(node.id, { once: event.currentTarget.checked })}
        />
        <span>Once (fire only on first trigger)</span>
      </label>
      <div class="nl-field-grid nl-field-grid-2">
        <label class="nl-field">
          <span>Debounce (ms)</span>
          <input
            class="nl-input nl-tabular"
            type="number"
            min={0}
            step={50}
            aria-label="Debounce milliseconds"
            value={typeof node.data.debounceMs === 'number' ? node.data.debounceMs : 0}
            onInput={(event) => {
              const next = Math.max(0, Number(event.currentTarget.value));
              onUpdateNodeData(node.id, { debounceMs: Number.isFinite(next) ? next : 0 });
            }}
          />
        </label>
        <label class="nl-field">
          <span>Throttle (ms)</span>
          <input
            class="nl-input nl-tabular"
            type="number"
            min={0}
            step={50}
            aria-label="Throttle milliseconds"
            value={typeof node.data.throttleMs === 'number' ? node.data.throttleMs : 0}
            onInput={(event) => {
              const next = Math.max(0, Number(event.currentTarget.value));
              onUpdateNodeData(node.id, { throttleMs: Number.isFinite(next) ? next : 0 });
            }}
          />
        </label>
      </div>
    </div>
  );

  switch (node.type) {
    // =========================================================================
    // 1. SOURCES (3)
    // =========================================================================
    case 'source.element': {
      const usedElementIds = graph
        ? getUsedSourceReferenceIds(graph, 'source.element', node.id)
        : new Set<string>();
      const componentId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      const enabledComponents = components.filter((c) => c.nodeLogicEnabled || c.id === componentId);
      const disabledComponents = components.filter((c) => !c.nodeLogicEnabled);
      const property = typeof node.data.property === 'string' ? node.data.property : 'value';
      return (
        <>
          <label class="nl-field">
            <span>Target layer / form element</span>
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

          {enabledComponents.length > 0 && (
            <label class="nl-field">
              <span>Or sent component (optional)</span>
              <select
                class="select-field nl-source-select"
                aria-label="Source sent component"
                value={componentId}
                onChange={(event) => onUpdateNodeData(node.id, { componentId: event.currentTarget.value })}
              >
                <option value="">None (use layer above)</option>
                {enabledComponents.map((comp) => (
                  <option key={comp.id} value={comp.id}>
                    {comp.name}{!comp.nodeLogicEnabled ? ' — Disabled' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label class="nl-field">
            <span>Property to read</span>
            <select
              class="select-field"
              aria-label="Property to read"
              value={property}
              onChange={(event) => onUpdateNodeData(node.id, { property: event.currentTarget.value })}
            >
              <option value="value">Value / Text</option>
              <option value="text">Text content</option>
              <option value="visible">Visible (boolean)</option>
              <option value="fill">Fill color</option>
              <option value="opacity">Opacity</option>
              <option value="bounds">Bounds (x, y, w, h)</option>
              <option value="checked">Checked (boolean)</option>
              <option value="componentId">Component ID</option>
            </select>
          </label>

          <p class="nl-inspector-hint">
            Layers already bound to another Element / Layer node are greyed out. Wire Property into Condition, Text, or Update State.
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
                        if (!componentId) {
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

    case 'source.context': {
      const contextKind = typeof node.data.contextKind === 'string' ? node.data.contextKind : 'page';
      const usedPageIds = graph ? getUsedSourceReferenceIds(graph, 'source.context', node.id) : new Set<string>();
      return (
        <>
          <label class="nl-field">
            <span>App context</span>
            <select
              class="select-field"
              aria-label="App context kind"
              value={contextKind}
              onChange={(event) => onUpdateNodeData(node.id, { contextKind: event.currentTarget.value })}
            >
              <option value="page">Page (route & On Load)</option>
              <option value="theme">Theme (active Design Token theme)</option>
              <option value="url-params">URL / Query Params</option>
              <option value="viewport">Viewport (width / height)</option>
              <option value="user-auth">User / Auth</option>
            </select>
          </label>

          {contextKind === 'page' && (
            <label class="nl-field">
              <span>Project page</span>
              <select
                class="select-field nl-source-select"
                aria-label="Context page"
                value={typeof node.data.pageId === 'string' ? node.data.pageId : ''}
                onChange={(event) => onUpdateNodeData(node.id, { pageId: event.currentTarget.value })}
              >
                <option value="">Active page (automatic)</option>
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
          )}

          {contextKind === 'theme' && (
            <label class="nl-field">
              <span>Reference theme (optional)</span>
              <select
                class="select-field"
                aria-label="Context theme"
                value={typeof node.data.themeId === 'string' ? node.data.themeId : ''}
                onChange={(event) => onUpdateNodeData(node.id, { themeId: event.currentTarget.value })}
              >
                <option value="">Active runtime theme</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>
            </label>
          )}

          {contextKind === 'url-params' && (
            <label class="nl-field">
              <span>Query parameter key</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. tab, id, ref"
                value={typeof node.data.paramKey === 'string' ? node.data.paramKey : ''}
                onInput={(event) => onUpdateNodeData(node.id, { paramKey: event.currentTarget.value })}
              />
            </label>
          )}

          {contextKind === 'viewport' && (
            <label class="nl-field">
              <span>Viewport metric</span>
              <select
                class="select-field"
                value={node.data.viewportMetric === 'height' ? 'height' : 'width'}
                onChange={(event) => onUpdateNodeData(node.id, { viewportMetric: event.currentTarget.value })}
              >
                <option value="width">Viewport width (px)</option>
                <option value="height">Viewport height (px)</option>
              </select>
            </label>
          )}

          {contextKind === 'user-auth' && (
            <>
              <label class="nl-field">
                <span>Auth field</span>
                <select
                  class="select-field"
                  value={typeof node.data.authField === 'string' ? node.data.authField : 'isSignedIn'}
                  onChange={(event) => onUpdateNodeData(node.id, { authField: event.currentTarget.value })}
                >
                  <option value="isSignedIn">Is Signed In (boolean)</option>
                  <option value="name">Display Name</option>
                  <option value="email">Email</option>
                  <option value="role">Role</option>
                </select>
              </label>
              <p class="nl-hint">
                Returns guest defaults unless your host app supplies an auth context — live user authentication is not connected.
              </p>
            </>
          )}
        </>
      );
    }

    case 'source.external': {
      const sourceKind = node.data.sourceKind === 'cms' ? 'cms' : 'api';
      return (
        <>
          <label class="nl-field">
            <span>Data provider</span>
            <select
              class="select-field"
              value={sourceKind}
              onChange={(event) => onUpdateNodeData(node.id, { sourceKind: event.currentTarget.value })}
            >
              <option value="api">REST API Endpoint</option>
              <option value="cms">CMS Collection</option>
            </select>
          </label>
          {sourceKind === 'api' ? (
            <label class="nl-field">
              <span>Endpoint path or URL</span>
              <input
                class="nl-input"
                type="text"
                placeholder="/items or https://api.example.com/items"
                value={typeof node.data.endpoint === 'string' ? node.data.endpoint : ''}
                onInput={(event) => onUpdateNodeData(node.id, { endpoint: event.currentTarget.value })}
              />
            </label>
          ) : (
            <label class="nl-field">
              <span>CMS collection slug</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. products, blog-posts"
                value={typeof node.data.collection === 'string' ? node.data.collection : ''}
                onInput={(event) => onUpdateNodeData(node.id, { collection: event.currentTarget.value })}
              />
            </label>
          )}
          <label class="nl-field">
            <span>Query / filter (optional)</span>
            <input
              class="nl-input"
              type="text"
              placeholder="e.g. status=published&limit=20"
              value={typeof node.data.query === 'string' ? node.data.query : ''}
              onInput={(event) => onUpdateNodeData(node.id, { query: event.currentTarget.value })}
            />
          </label>
          <label class="nl-field">
            <span>Execution mode</span>
            <select
              class="select-field"
              aria-label="External data execution mode"
              value={node.data.executionMode === 'live' ? 'live' : 'simulated'}
              onChange={(event) => onUpdateNodeData(node.id, { executionMode: event.currentTarget.value })}
            >
              <option value="simulated">Simulated (Deterministic Offline)</option>
              <option value="live">Live HTTP (via /api/logic/http-proxy)</option>
            </select>
          </label>
          <label class="nl-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(node.data.useAuth)}
              onChange={(event) => onUpdateNodeData(node.id, { useAuth: event.currentTarget.checked })}
            />
            <span>Use Project Auth Secret Ref (server-side)</span>
          </label>
          <div class="nl-live-http-test">
            <button
              type="button"
              class="nl-secondary-btn"
              disabled={liveTestState?.nodeId === node.id && liveTestState.loading}
              onClick={() => {
                const rawTarget =
                  sourceKind === 'cms'
                    ? `/collections/${String(node.data.collection ?? '').trim().replace(/^\/+/, '')}`
                    : String(node.data.endpoint ?? '').trim();
                const query = typeof node.data.query === 'string' ? node.data.query.trim().replace(/^\?/, '') : '';
                const targetWithQuery = query && rawTarget ? `${rawTarget}${rawTarget.includes('?') ? '&' : '?'}${query}` : rawTarget;
                void runLiveProxyTest(targetWithQuery, 'GET', undefined, Boolean(node.data.useAuth));
              }}
            >
              {liveTestState?.nodeId === node.id && liveTestState.loading
                ? 'Testing via Proxy…'
                : 'Test Live Request'}
            </button>
            {liveTestState?.nodeId === node.id && !liveTestState.loading && (
              <div class={`nl-live-http-result ${liveTestState.ok ? 'is-ok' : 'is-err'}`} data-testid="nl-live-http-result">
                <div class="nl-live-http-result-head">
                  <strong>{liveTestState.ok ? `HTTP ${liveTestState.status ?? 200}` : `Error (${liveTestState.status ?? 'Blocked'})`}</strong>
                  {typeof liveTestState.durationMs === 'number' && <span>{liveTestState.durationMs}ms</span>}
                </div>
                {liveTestState.authMode === 'session-token' && (
                  <p class="nl-hint">Used Session-Only Local Test Token (in-memory only).</p>
                )}
                {liveTestState.error ? (
                  <p class="nl-live-http-result-msg">{liveTestState.error}</p>
                ) : (
                  <pre class="nl-live-http-result-pre">{liveTestState.preview || '(empty response)'}</pre>
                )}
              </div>
            )}
          </div>
          <button type="button" class="nl-inline-link" onClick={() => onChangeTab('network')}>
            Configure Base URL & Auth in Network Settings →
          </button>
        </>
      );
    }

    // =========================================================================
    // 2. EVENTS (8) — All include shared Once / Debounce / Throttle controls
    // =========================================================================
    case 'event.on-click':
      return (
        <>
          {renderAstTargetPicker('Target layer', scopedAstNodes)}
          <label class="nl-field">
            <span>Click mode</span>
            <select
              class="select-field"
              value={typeof node.data.mode === 'string' ? node.data.mode : 'click'}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="click">Click</option>
              <option value="double-click">Double Click</option>
              <option value="click-outside">Click Outside</option>
            </select>
          </label>
          {renderEventControls()}
        </>
      );

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
              <option value="enter">Enter</option>
              <option value="leave">Leave</option>
            </select>
          </label>
          {renderEventControls()}
        </>
      );

    case 'event.on-input':
      return (
        <>
          {renderAstTargetPicker('Target input / form layer', scopedAstNodes)}
          <label class="nl-field">
            <span>Input event</span>
            <select
              class="select-field"
              value={typeof node.data.mode === 'string' ? node.data.mode : 'change'}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="change">Change</option>
              <option value="focus">Focus</option>
              <option value="blur">Blur</option>
              <option value="submit">Submit</option>
            </select>
          </label>
          {renderEventControls()}
        </>
      );

    case 'event.on-key-press':
      return (
        <>
          <label class="nl-field">
            <span>Key / Shortcut combo</span>
            <input
              class="nl-input"
              type="text"
              placeholder="e.g. Enter, Escape, Ctrl+K"
              value={typeof node.data.keyCombo === 'string' ? node.data.keyCombo : 'Enter'}
              onInput={(event) => onUpdateNodeData(node.id, { keyCombo: event.currentTarget.value })}
            />
          </label>
          <label class="nl-field">
            <span>Key phase</span>
            <select
              class="select-field"
              value={node.data.phase === 'up' ? 'up' : 'down'}
              onChange={(event) => onUpdateNodeData(node.id, { phase: event.currentTarget.value })}
            >
              <option value="down">Key Down</option>
              <option value="up">Key Up</option>
            </select>
          </label>
          {renderEventControls()}
        </>
      );

    case 'event.on-drag':
      return (
        <>
          {renderAstTargetPicker('Draggable layer', scopedAstNodes)}
          <label class="nl-field">
            <span>Drag phase</span>
            <select
              class="select-field"
              value={typeof node.data.phase === 'string' ? node.data.phase : 'start'}
              onChange={(event) => onUpdateNodeData(node.id, { phase: event.currentTarget.value })}
            >
              <option value="start">Drag Start</option>
              <option value="move">Drag Move</option>
              <option value="drop">Drop</option>
            </select>
          </label>
          {renderEventControls()}
        </>
      );

    case 'event.on-scroll-view': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'enter-view';
      return (
        <>
          <label class="nl-field">
            <span>Scroll trigger</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="page-scroll">Page Scroll</option>
              <option value="enter-view">Enter View</option>
              <option value="leave-view">Leave View</option>
            </select>
          </label>
          {mode !== 'page-scroll' && renderAstTargetPicker('Observed layer', scopedAstNodes)}
          <label class="nl-field">
            <span>Visibility threshold (0 – 1)</span>
            <input
              class="nl-input nl-tabular"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={typeof node.data.threshold === 'number' ? node.data.threshold : 0.2}
              onInput={(event) => {
                const next = Math.max(0, Math.min(1, Number(event.currentTarget.value)));
                onUpdateNodeData(node.id, { threshold: Number.isFinite(next) ? next : 0.2 });
              }}
            />
          </label>
          {renderEventControls()}
        </>
      );
    }

    case 'event.on-lifecycle': {
      const trigger = typeof node.data.trigger === 'string' ? node.data.trigger : 'page-load';
      return (
        <>
          <label class="nl-field">
            <span>Lifecycle trigger</span>
            <select
              class="select-field"
              value={trigger}
              onChange={(event) => onUpdateNodeData(node.id, { trigger: event.currentTarget.value })}
            >
              <option value="page-load">Page Load</option>
              <option value="route-change">Route Change</option>
              <option value="resize">Viewport Resize</option>
              <option value="animation-end">Animation End</option>
            </select>
          </label>
          {trigger === 'animation-end' && (
            <label class="nl-field">
              <span>Watched animation clip</span>
              <select
                class="select-field"
                value={typeof node.data.clipId === 'string' ? node.data.clipId : ''}
                onChange={(event) => onUpdateNodeData(node.id, { clipId: event.currentTarget.value })}
              >
                <option value="">Any animation clip</option>
                {animations.map((clip) => (
                  <option key={clip.id} value={clip.id}>{clip.name}</option>
                ))}
              </select>
            </label>
          )}
          {renderEventControls()}
        </>
      );
    }

    case 'event.on-state-change':
      return (
        <>
          {renderVariablePicker()}
          {renderEventControls()}
        </>
      );

    // =========================================================================
    // 3. STATE (3)
    // =========================================================================
    case 'state.get':
      return renderVariablePicker();

    case 'state.toggle': {
      const booleanVariables = availableVariables.filter((item) => item.valueType === 'boolean');
      const usingPrivateMemory = variableId.trim() === '';
      return (
        <div class="nl-field-group" data-testid="nl-toggle-state-fields">
          <div class="nl-private-mem-badge">
            <strong>{usingPrivateMemory ? 'Private Node Memory (Boolean)' : 'Shared Global Variable (Boolean)'}</strong>
            <span>
              {usingPrivateMemory
                ? 'Target-bound per origin layer — persists across clicks without declaring a global variable.'
                : 'Synced to a shared boolean variable so separate flows can read the same state.'}
            </span>
          </div>

          {usingPrivateMemory && (
            <label class="nl-field">
              <span>Initial boolean value</span>
              <select
                class="select-field"
                aria-label="Initial boolean value"
                value={String(Boolean(node.data.initialValue))}
                onChange={(event) =>
                  onUpdateNodeData(node.id, { initialValue: event.currentTarget.value === 'true' })
                }
              >
                <option value="false">false (off)</option>
                <option value="true">true (on)</option>
              </select>
            </label>
          )}

          <label class="nl-field">
            <span>Shared boolean variable (optional)</span>
            <select
              class="select-field"
              aria-label="Shared boolean variable (optional)"
              value={variableId}
              onChange={(event) => onUpdateNodeData(node.id, { variableId: event.currentTarget.value })}
            >
              <option value="">None — Private Memory (Default)</option>
              {booleanVariables.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} (boolean)
                </option>
              ))}
            </select>
          </label>
          <p class="nl-inspector-hint">
            Toggle State strictly stores boolean values and publishes <code>value</code> &amp; <code>previous</code> directly to downstream pipeline nodes.
          </p>
        </div>
      );
    }

    case 'state.update': {
      const selectedVar = availableVariables.find((item) => item.id === variableId);
      const varType: LogicValueType = selectedVar?.valueType ?? 'string';
      const allowedOps = UPDATE_OPERATIONS_BY_TYPE[varType];
      const currentOp = typeof node.data.operation === 'string' ? node.data.operation : allowedOps[0].value;
      const effectiveOp = allowedOps.some((op) => op.value === currentOp) ? currentOp : allowedOps[0].value;
      const removeMode: 'value' | 'index' =
        node.data.removeMode === 'index'
          ? 'index'
          : node.data.removeMode === 'value'
            ? 'value'
            : typeof node.data.value === 'number'
              ? 'index'
              : 'value';

      return (
        <>
          <div class="nl-field-group">
            <label class="nl-field">
              <span>Variable</span>
              <select
                class="select-field"
                aria-label="State variable to update"
                value={variableId}
                onChange={(event) => {
                  const nextId = event.currentTarget.value;
                  const nextVar = availableVariables.find((v) => v.id === nextId);
                  const nextAllowed = nextVar ? UPDATE_OPERATIONS_BY_TYPE[nextVar.valueType] : allowedOps;
                  const nextOp = nextAllowed.some((op) => op.value === currentOp)
                    ? currentOp
                    : nextAllowed[0].value;
                  onUpdateNodeData(node.id, { variableId: nextId, operation: nextOp });
                }}
              >
                <option value="">Select variable…</option>
                {availableVariables.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.valueType})
                  </option>
                ))}
              </select>
            </label>
            {availableVariables.length === 0 && (
              <button type="button" class="nl-inline-link" onClick={() => onChangeTab('variables')}>
                + Declare a state variable
              </button>
            )}
          </div>

          <label class="nl-field">
            <span>Operation ({selectedVar ? selectedVar.valueType : 'dynamic'})</span>
            <select
              class="select-field"
              aria-label="Update operation"
              value={effectiveOp}
              onChange={(event) => {
                const nextOp = event.currentTarget.value;
                if (nextOp === 'remove' && varType === 'list') {
                  onUpdateNodeData(node.id, { operation: nextOp, removeMode });
                  return;
                }
                onUpdateNodeData(node.id, { operation: nextOp });
              }}
            >
              {allowedOps.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </label>

          {effectiveOp === 'remove' && varType === 'list' && (
            <label class="nl-field">
              <span>Remove mode</span>
              <select
                class="select-field"
                aria-label="List remove mode"
                value={removeMode}
                onChange={(event) => {
                  const nextMode = event.currentTarget.value === 'index' ? 'index' : 'value';
                  if (nextMode === 'index') {
                    const cur = node.data.value;
                    let nextIndex: number | null = null;
                    if (typeof cur === 'number' && Number.isInteger(cur) && cur >= 0) {
                      nextIndex = cur;
                    } else if (typeof cur === 'string' && /^\d+$/.test(cur.trim())) {
                      const parsed = Number(cur.trim());
                      if (Number.isSafeInteger(parsed) && parsed >= 0) nextIndex = parsed;
                    }
                    onUpdateNodeData(node.id, { removeMode: 'index', value: nextIndex });
                  } else {
                    const cur = node.data.value;
                    onUpdateNodeData(node.id, {
                      removeMode: 'value',
                      value: cur === null || cur === undefined ? '' : String(cur),
                    });
                  }
                }}
              >
                <option value="value">Remove by Value</option>
                <option value="index">Remove by Index</option>
              </select>
            </label>
          )}

          {effectiveOp === 'increment' && (
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
                    onUpdateNodeData(node.id, { min: parsed !== null && Number.isFinite(parsed) ? parsed : null });
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
                    onUpdateNodeData(node.id, { max: parsed !== null && Number.isFinite(parsed) ? parsed : null });
                  }}
                />
              </label>
            </div>
          )}

          {effectiveOp === 'set-property' && (
            <label class="nl-field">
              <span>Property path</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. user.name or theme"
                value={typeof node.data.propertyPath === 'string' ? node.data.propertyPath : ''}
                onInput={(event) => onUpdateNodeData(node.id, { propertyPath: event.currentTarget.value })}
              />
            </label>
          )}

          {effectiveOp === 'cycle' && (
            <label class="nl-field">
              <span>Cycle list (comma-separated)</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. small, medium, large"
                value={typeof node.data.cycleValues === 'string' ? node.data.cycleValues : ''}
                onInput={(event) => onUpdateNodeData(node.id, { cycleValues: event.currentTarget.value })}
              />
            </label>
          )}

          {(effectiveOp === 'set' || effectiveOp === 'push' || effectiveOp === 'remove' || effectiveOp === 'set-property') && (
            <label class="nl-field">
              <span>
                {effectiveOp === 'push'
                  ? 'Item to push (fallback if Value unwired)'
                  : effectiveOp === 'remove'
                    ? removeMode === 'index'
                      ? 'Index to remove (0-based, fallback if Value unwired)'
                      : 'Value to remove (fallback if Value unwired)'
                    : effectiveOp === 'set-property'
                      ? 'New property value (fallback)'
                      : 'Fallback value (when Value port is unwired)'}
              </span>
              {varType === 'boolean' && effectiveOp === 'set' ? (
                <select
                  class="select-field"
                  value={String(Boolean(node.data.value))}
                  onChange={(event) => onUpdateNodeData(node.id, { value: event.currentTarget.value === 'true' })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : varType === 'number' && effectiveOp === 'set' ? (
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  value={typeof node.data.value === 'number' ? node.data.value : 0}
                  onInput={(event) => {
                    const next = Number(event.currentTarget.value);
                    onUpdateNodeData(node.id, { value: Number.isFinite(next) ? next : 0 });
                  }}
                />
              ) : varType === 'list' && effectiveOp === 'remove' && removeMode === 'index' ? (
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  aria-label="Index to remove"
                  placeholder="0"
                  value={typeof node.data.value === 'number' && Number.isFinite(node.data.value) ? node.data.value : ''}
                  onInput={(event) => {
                    const raw = event.currentTarget.value.trim();
                    if (raw === '') {
                      onUpdateNodeData(node.id, { removeMode: 'index', value: null });
                      return;
                    }
                    const next = Number(raw);
                    onUpdateNodeData(node.id, {
                      removeMode: 'index',
                      value: Number.isFinite(next) ? next : null,
                    });
                  }}
                />
              ) : (
                <input
                  class="nl-input"
                  type="text"
                  aria-label={effectiveOp === 'remove' ? 'Value to remove' : undefined}
                  placeholder={varType === 'list' && effectiveOp === 'set' ? '["a","b"]' : varType === 'object' && effectiveOp === 'set' ? '{"key":"val"}' : ''}
                  value={node.data.value === null || node.data.value === undefined ? '' : String(node.data.value)}
                  onInput={(event) =>
                    onUpdateNodeData(
                      node.id,
                      effectiveOp === 'remove' && varType === 'list'
                        ? { removeMode: 'value', value: event.currentTarget.value }
                        : { value: event.currentTarget.value },
                    )
                  }
                />
              )}
            </label>
          )}
        </>
      );
    }

    // =========================================================================
    // 4. LOGIC (5)
    // =========================================================================
    case 'logic.branch': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'if-else';
      return (
        <>
          <label class="nl-field">
            <span>Branch mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="if-else">If / Else</option>
              <option value="else-if">If / Else If / Else</option>
              <option value="switch-case">Switch / Case</option>
            </select>
          </label>
          {renderScopedDataPicker(
            mode === 'switch-case'
              ? 'Switch value from Pipeline (Scoped)'
              : 'Condition from Pipeline (Scoped)',
            'pipelineRef',
            mode === 'switch-case' ? undefined : ['boolean'],
          )}
          {mode === 'switch-case' ? (
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Case A match</span>
                <input
                  class="nl-input"
                  type="text"
                  placeholder="e.g. admin"
                  value={typeof node.data.caseA === 'string' ? node.data.caseA : ''}
                  onInput={(event) => onUpdateNodeData(node.id, { caseA: event.currentTarget.value })}
                />
              </label>
              <label class="nl-field">
                <span>Case B match</span>
                <input
                  class="nl-input"
                  type="text"
                  placeholder="e.g. editor"
                  value={typeof node.data.caseB === 'string' ? node.data.caseB : ''}
                  onInput={(event) => onUpdateNodeData(node.id, { caseB: event.currentTarget.value })}
                />
              </label>
            </div>
          ) : (
            <label class="nl-field">
              <span>Fallback condition (when Pipeline &amp; Condition port are unset)</span>
              <select
                class="select-field"
                value={String(Boolean(node.data.condition))}
                onChange={(event) => onUpdateNodeData(node.id, { condition: event.currentTarget.value === 'true' })}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
          )}
        </>
      );
    }

    case 'logic.condition': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'compare';
      return (
        <>
          <label class="nl-field">
            <span>Evaluation mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="compare">Compare (==, !=, &gt;, &lt;…)</option>
              <option value="and">AND (Left &amp;&amp; Right)</option>
              <option value="or">OR (Left || Right)</option>
              <option value="not">NOT (!Left)</option>
              <option value="is-empty">Is Empty</option>
              <option value="regex">Regex Match</option>
            </select>
          </label>
          {mode === 'compare' && (
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
          )}
          {renderScopedDataPicker('Left / A from Pipeline (Scoped)', 'leftRef')}
          {mode !== 'not' && mode !== 'is-empty' && mode !== 'regex' && (
            renderScopedDataPicker('Right / B from Pipeline (Scoped)', 'rightRef')
          )}
          {mode === 'regex' ? (
            <>
              <label class="nl-field">
                <span>Regex pattern</span>
                <input
                  class="nl-input"
                  type="text"
                  placeholder="e.g. ^[^@]+@[^@]+\.[^@]+$"
                  value={typeof node.data.pattern === 'string' ? node.data.pattern : ''}
                  onInput={(event) => onUpdateNodeData(node.id, { pattern: event.currentTarget.value })}
                />
                {typeof node.data.pattern === 'string' && node.data.pattern.length > 0 && (() => {
                  const regexCheck = analyzeRegexPattern(node.data.pattern);
                  if (regexCheck.ok) return null;
                  return (
                    <span class="nl-field-error" role="alert">
                      {regexCheck.reason ?? 'Invalid or unsafe regular expression.'}
                    </span>
                  );
                })()}
              </label>
              <label class="nl-field">
                <span>Left / A fallback</span>
                <input
                  class="nl-input"
                  type="text"
                  placeholder="Value to test when no pipeline source is connected"
                  value={node.data.left === null || node.data.left === undefined ? '' : String(node.data.left)}
                  onInput={(event) => onUpdateNodeData(node.id, { left: event.currentTarget.value })}
                />
              </label>
            </>
          ) : (
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Left / A fallback</span>
                <input
                  class="nl-input"
                  type="text"
                  value={node.data.left === null || node.data.left === undefined ? '' : String(node.data.left)}
                  onInput={(event) => onUpdateNodeData(node.id, { left: parseLooseValue(event.currentTarget.value) })}
                />
              </label>
              {mode !== 'not' && mode !== 'is-empty' && (
                <label class="nl-field">
                  <span>Right / B fallback</span>
                  <input
                    class="nl-input"
                    type="text"
                    value={node.data.right === null || node.data.right === undefined ? '' : String(node.data.right)}
                    onInput={(event) => onUpdateNodeData(node.id, { right: parseLooseValue(event.currentTarget.value) })}
                  />
                </label>
              )}
            </div>
          )}
        </>
      );
    }

    case 'logic.math': {
      const op = typeof node.data.operation === 'string' ? node.data.operation : '+';
      return (
        <>
          <label class="nl-field">
            <span>Operation</span>
            <select
              class="select-field"
              value={op}
              onChange={(event) => onUpdateNodeData(node.id, { operation: event.currentTarget.value })}
            >
              <option value="+">Add (A + B)</option>
              <option value="-">Subtract (A - B)</option>
              <option value="*">Multiply (A * B)</option>
              <option value="/">Divide (A / B)</option>
              <option value="%">Modulo (A % B)</option>
              <option value="clamp">Clamp (Min – Max)</option>
              <option value="map-range">Map Range</option>
            </select>
          </label>
          <div class="nl-field-grid nl-field-grid-2">
            <label class="nl-field">
              <span>A fallback</span>
              <input
                class="nl-input nl-tabular"
                type="number"
                value={typeof node.data.a === 'number' ? node.data.a : 0}
                onInput={(event) => onUpdateNodeData(node.id, { a: Number(event.currentTarget.value) || 0 })}
              />
            </label>
            {op !== 'clamp' && op !== 'map-range' && (
              <label class="nl-field">
                <span>B fallback</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  value={typeof node.data.b === 'number' ? node.data.b : 1}
                  onInput={(event) => onUpdateNodeData(node.id, { b: Number(event.currentTarget.value) || 0 })}
                />
              </label>
            )}
          </div>
          {op === 'clamp' && (
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Min</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  value={typeof node.data.min === 'number' ? node.data.min : 0}
                  onInput={(event) => onUpdateNodeData(node.id, { min: Number(event.currentTarget.value) || 0 })}
                />
              </label>
              <label class="nl-field">
                <span>Max</span>
                <input
                  class="nl-input nl-tabular"
                  type="number"
                  value={typeof node.data.max === 'number' ? node.data.max : 100}
                  onInput={(event) => onUpdateNodeData(node.id, { max: Number(event.currentTarget.value) || 0 })}
                />
              </label>
            </div>
          )}
          {op === 'map-range' && (
            <>
              <div class="nl-field-grid nl-field-grid-2">
                <label class="nl-field">
                  <span>In Min</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    value={typeof node.data.inMin === 'number' ? node.data.inMin : 0}
                    onInput={(event) => onUpdateNodeData(node.id, { inMin: Number(event.currentTarget.value) || 0 })}
                  />
                </label>
                <label class="nl-field">
                  <span>In Max</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    value={typeof node.data.inMax === 'number' ? node.data.inMax : 100}
                    onInput={(event) => onUpdateNodeData(node.id, { inMax: Number(event.currentTarget.value) || 0 })}
                  />
                </label>
              </div>
              <div class="nl-field-grid nl-field-grid-2">
                <label class="nl-field">
                  <span>Out Min</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    value={typeof node.data.outMin === 'number' ? node.data.outMin : 0}
                    onInput={(event) => onUpdateNodeData(node.id, { outMin: Number(event.currentTarget.value) || 0 })}
                  />
                </label>
                <label class="nl-field">
                  <span>Out Max</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    value={typeof node.data.outMax === 'number' ? node.data.outMax : 1}
                    onInput={(event) => onUpdateNodeData(node.id, { outMax: Number(event.currentTarget.value) || 0 })}
                  />
                </label>
              </div>
            </>
          )}
        </>
      );
    }

    case 'logic.text': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'template';
      return (
        <>
          <label class="nl-field">
            <span>Text mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="template">Template ({'{{variable}}'})</option>
              <option value="format-number">Format Number</option>
              <option value="format-currency">Format Currency</option>
            </select>
          </label>
          {renderScopedDataPicker('Input value from Pipeline (Scoped)', 'pipelineRef')}
          {mode === 'template' ? (
            <label class="nl-field">
              <span>Template string</span>
              <input
                class="nl-input"
                type="text"
                value={typeof node.data.template === 'string' ? node.data.template : '{{value}}'}
                onInput={(event) => onUpdateNodeData(node.id, { template: event.currentTarget.value })}
              />
            </label>
          ) : (
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Locale</span>
                <input
                  class="nl-input"
                  type="text"
                  placeholder="en-US or id-ID"
                  value={typeof node.data.locale === 'string' ? node.data.locale : 'en-US'}
                  onInput={(event) => onUpdateNodeData(node.id, { locale: event.currentTarget.value })}
                />
              </label>
              {mode === 'format-currency' ? (
                <label class="nl-field">
                  <span>Currency</span>
                  <input
                    class="nl-input"
                    type="text"
                    placeholder="USD, IDR, EUR"
                    value={typeof node.data.currency === 'string' ? node.data.currency : 'USD'}
                    onInput={(event) => onUpdateNodeData(node.id, { currency: event.currentTarget.value })}
                  />
                </label>
              ) : (
                <label class="nl-field">
                  <span>Decimals</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    min={0}
                    max={6}
                    value={typeof node.data.decimals === 'number' ? node.data.decimals : 2}
                    onInput={(event) => onUpdateNodeData(node.id, { decimals: Math.max(0, Math.min(6, Number(event.currentTarget.value) || 0)) })}
                  />
                </label>
              )}
            </div>
          )}
        </>
      );
    }

    case 'logic.list': {
      const op = typeof node.data.operation === 'string' ? node.data.operation : 'filter';
      return (
        <>
          <label class="nl-field">
            <span>List operation</span>
            <select
              class="select-field"
              value={op}
              onChange={(event) => onUpdateNodeData(node.id, { operation: event.currentTarget.value })}
            >
              <option value="filter">Filter</option>
              <option value="sort">Sort</option>
              <option value="count">Count</option>
              <option value="map">Map (extract field)</option>
            </select>
          </label>
          {op !== 'count' && (
            <label class="nl-field">
              <span>Item field (optional for primitives)</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. title, price, category"
                value={typeof node.data.field === 'string' ? node.data.field : ''}
                onInput={(event) => onUpdateNodeData(node.id, { field: event.currentTarget.value })}
              />
            </label>
          )}
          {op === 'filter' && (
            <label class="nl-field">
              <span>Match value (fallback if Query unwired)</span>
              <input
                class="nl-input"
                type="text"
                placeholder="Substring or exact match"
                value={typeof node.data.matchValue === 'string' ? node.data.matchValue : ''}
                onInput={(event) => onUpdateNodeData(node.id, { matchValue: event.currentTarget.value })}
              />
            </label>
          )}
          {op === 'sort' && (
            <label class="nl-field">
              <span>Sort order</span>
              <select
                class="select-field"
                value={node.data.sortOrder === 'desc' ? 'desc' : 'asc'}
                onChange={(event) => onUpdateNodeData(node.id, { sortOrder: event.currentTarget.value })}
              >
                <option value="asc">Ascending (A → Z / 0 → 9)</option>
                <option value="desc">Descending (Z → A / 9 → 0)</option>
              </select>
            </label>
          )}
        </>
      );
    }

    // =========================================================================
    // 5. ACTIONS (6)
    // =========================================================================
    case 'action.set-layer': {
      const property = typeof node.data.property === 'string' ? node.data.property : 'text';
      const fillValue = typeof node.data.fill === 'string' ? node.data.fill : '#3B82F6';
      const isHex = /^#[0-9a-fA-F]{6}$/.test(fillValue);
      const targetPool =
        property === 'text' ? textNodes : property === 'fill' ? fillableNodes : scopedAstNodes;
      return (
        <>
          {renderPipelineTargetField('Target layer', targetPool.length > 0 ? targetPool : scopedAstNodes)}
          <label class="nl-field">
            <span>Property to update</span>
            <select
              class="select-field"
              value={property}
              onChange={(event) => onUpdateNodeData(node.id, { property: event.currentTarget.value })}
            >
              <option value="visible">Visible (Show / Hide / Toggle)</option>
              <option value="fill">Fill Color</option>
              <option value="opacity">Opacity (0 – 1)</option>
              <option value="transform">Transform (scale / rotate / translate)</option>
              <option value="text">Text Content</option>
              <option value="image">Image Source URL</option>
              <option value="disabled">Disabled State</option>
            </select>
          </label>
          {renderScopedDataPicker('Value from Pipeline (optional)', 'pipelineRef')}

          {property === 'visible' && (
            <label class="nl-field">
              <span>Visibility mode</span>
              <select
                class="select-field"
                value={typeof node.data.visibleMode === 'string' ? node.data.visibleMode : 'toggle'}
                onChange={(event) => onUpdateNodeData(node.id, { visibleMode: event.currentTarget.value })}
              >
                <option value="toggle">Toggle</option>
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </label>
          )}

          {property === 'fill' && (
            <div class="nl-field">
              <span>Fill color</span>
              <div class="nl-color-row">
                <input
                  type="color"
                  class="nl-color-swatch"
                  aria-label="Pick fill color"
                  value={isHex ? fillValue : '#3B82F6'}
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
          )}

          {property === 'opacity' && (
            <label class="nl-field">
              <span>Opacity (0 – 1)</span>
              <input
                class="nl-input nl-tabular"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={typeof node.data.opacity === 'number' ? node.data.opacity : 1}
                onInput={(event) => {
                  const next = Math.max(0, Math.min(1, Number(event.currentTarget.value)));
                  onUpdateNodeData(node.id, { opacity: Number.isFinite(next) ? next : 1 });
                }}
              />
            </label>
          )}

          {property === 'transform' && (
            <label class="nl-field">
              <span>CSS Transform</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. scale(1.05) translateY(-4px)"
                value={typeof node.data.transform === 'string' ? node.data.transform : 'scale(1)'}
                onInput={(event) => onUpdateNodeData(node.id, { transform: event.currentTarget.value })}
              />
            </label>
          )}

          {property === 'text' && (
            <label class="nl-field">
              <span>Fallback text (when Value port is unwired)</span>
              <input
                class="nl-input"
                type="text"
                value={typeof node.data.text === 'string' ? node.data.text : ''}
                onInput={(event) => onUpdateNodeData(node.id, { text: event.currentTarget.value })}
              />
            </label>
          )}

          {property === 'image' && (
            <label class="nl-field">
              <span>Image URL</span>
              <input
                class="nl-input"
                type="text"
                placeholder="https://… or /assets/photo.png"
                value={typeof node.data.imageUrl === 'string' ? node.data.imageUrl : ''}
                onInput={(event) => onUpdateNodeData(node.id, { imageUrl: event.currentTarget.value })}
              />
            </label>
          )}

          {property === 'disabled' && (
            <label class="nl-checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(node.data.disabled)}
                onChange={(event) => onUpdateNodeData(node.id, { disabled: event.currentTarget.checked })}
              />
              <span>Disable layer interaction</span>
            </label>
          )}

          <div class="nl-field-grid nl-field-grid-2">
            <label class="nl-field">
              <span>Transition (ms)</span>
              <input
                class="nl-input nl-tabular"
                type="number"
                min={0}
                step={50}
                value={typeof node.data.transitionMs === 'number' ? node.data.transitionMs : 0}
                onInput={(event) => {
                  const next = Math.max(0, Number(event.currentTarget.value));
                  onUpdateNodeData(node.id, { transitionMs: Number.isFinite(next) ? next : 0 });
                }}
              />
            </label>
            <label class="nl-field">
              <span>Easing</span>
              <select
                class="select-field"
                value={typeof node.data.transitionEasing === 'string' ? node.data.transitionEasing : 'ease-out'}
                onChange={(event) => onUpdateNodeData(node.id, { transitionEasing: event.currentTarget.value })}
              >
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Ease In-Out</option>
                <option value="linear">Linear</option>
                <option value="spring">Spring</option>
              </select>
            </label>
          </div>
        </>
      );
    }

    case 'action.set-variant': {
      const SELF_TARGET_OPTION = '__this_component__';
      const isComponentScope = graph?.scope === 'component';
      const ownerComponent = isComponentScope && graph?.targetId
        ? components.find((comp) => comp.id === graph.targetId)
        : undefined;
      const trimmedTargetId = targetNodeId.trim();
      const directResolved = trimmedTargetId
        ? resolveAstNodeById(trimmedTargetId, astNodesById, componentsById)
        : undefined;
      const directInstance =
        directResolved && directResolved.type === 'component-instance'
          ? directResolved
          : instanceNodes.find((item) => item.id === trimmedTargetId);

      // In Component Master graphs, default/empty target (or legacy pipeline from an internal non-instance layer)
      // resolves to This Component (Current Component Instance) rather than any plain shape.
      const isTargetingSelf = Boolean(
        isComponentScope
        && ownerComponent
        && (
          (targetMode !== 'pipeline' && (!trimmedTargetId || trimmedTargetId === ownerComponent.id))
          || (targetMode === 'pipeline' && !directInstance)
        ),
      );

      // In Page/Project graphs, only allow Component Instances (never plain shapes/groups).
      const upstreamInstanceId =
        targetMode === 'pipeline'
          ? (pipelineChildId || upstreamOrigins[0]?.layerId || '')
          : '';
      const upstreamResolved = upstreamInstanceId
        ? resolveAstNodeById(upstreamInstanceId, astNodesById, componentsById)
        : undefined;
      const upstreamInstance =
        upstreamResolved && upstreamResolved.type === 'component-instance'
          ? upstreamResolved
          : instanceNodes.find((item) => item.id === upstreamInstanceId);

      const targetInstance = isTargetingSelf
        ? undefined
        : directInstance ?? (!isComponentScope ? upstreamInstance : undefined);

      const master = isTargetingSelf
        ? ownerComponent
        : targetInstance
          ? components.find((comp) => comp.id === targetInstance.componentId)
          : undefined;

      const axes = master?.variants ?? [];
      const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
      const selectedAxis = axes.find((axis) => axis.id === axisId);
      const optionId = typeof node.data.optionId === 'string' ? node.data.optionId : '';

      const selectValue = isTargetingSelf
        ? SELF_TARGET_OPTION
        : targetInstance
          ? targetInstance.id
          : '';

      const eventOriginSummary = upstreamOrigins
        .map((origin) => origin.name)
        .filter((name, idx, arr) => Boolean(name) && arr.indexOf(name) === idx)
        .join(', ');

      return (
        <>
          <label class="nl-field">
            <span>Variant target (Component Instance)</span>
            <select
              class="select-field"
              aria-label="Variant target component instance"
              data-testid="nl-set-variant-target-select"
              value={selectValue}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                if (nextValue === SELF_TARGET_OPTION) {
                  const firstAxis = ownerComponent?.variants?.find((a) => a.options.length > 0);
                  const keepAxis = ownerComponent?.variants?.find((a) => a.id === axisId);
                  onUpdateNodeData(node.id, {
                    targetMode: 'override',
                    targetNodeId: '',
                    pipelineChildId: '',
                    ...(keepAxis
                      ? {}
                      : {
                          axisId: firstAxis?.id ?? '',
                          optionId: firstAxis?.options[0]?.id ?? '',
                        }),
                  });
                  return;
                }
                const nextInst = instanceNodes.find((item) => item.id === nextValue);
                const nextComp = nextInst
                  ? components.find((comp) => comp.id === nextInst.componentId)
                  : undefined;
                const firstAxis = nextComp?.variants?.find((a) => a.options.length > 0);
                const keepAxis = nextComp?.variants?.find((a) => a.id === axisId);
                onUpdateNodeData(node.id, {
                  targetMode: 'override',
                  targetNodeId: nextValue,
                  pipelineChildId: '',
                  ...(keepAxis
                    ? {}
                    : {
                        axisId: firstAxis?.id ?? '',
                        optionId: firstAxis?.options[0]?.id ?? '',
                      }),
                });
              }}
            >
              {!isComponentScope && <option value="">Select component instance…</option>}
              {isComponentScope && ownerComponent && (
                <option value={SELF_TARGET_OPTION}>
                  This Component ({ownerComponent.name} — Current Instance)
                </option>
              )}
              {instanceNodes.map((inst) => {
                const instMaster = components.find((comp) => comp.id === inst.componentId);
                return (
                  <option key={inst.id} value={inst.id}>
                    {isComponentScope ? `Nested: ${inst.name}` : inst.name}
                    {instMaster ? ` (${instMaster.name})` : ' (Component)'}
                  </option>
                );
              })}
            </select>
          </label>
          {isComponentScope && ownerComponent && (
            <div class="nl-field-hint" data-testid="nl-set-variant-scope-hint">
              {eventOriginSummary
                ? `Event origin: ${eventOriginSummary}. Action target: ${
                    isTargetingSelf
                      ? `This Component (${ownerComponent.name} — Current Instance)`
                      : targetInstance?.name ?? 'Select component instance'
                  }.`
                : 'Targets the Component Instance executing this logic, or an explicit nested Component Instance.'}
            </div>
          )}
          <label class="nl-field">
            <span>Variant axis</span>
            <select
              class="select-field"
              aria-label="Variant axis"
              data-testid="nl-set-variant-axis-select"
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
              aria-label="Variant option"
              data-testid="nl-set-variant-option-select"
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

    case 'action.media-animation': {
      const targetKind = node.data.targetKind === 'media' ? 'media' : 'animation';
      const originClipIds = new Set(upstreamOrigins.flatMap((o) => o.animationIds));
      const attachedClips = animations.filter((clip) => originClipIds.has(clip.id));
      return (
        <>
          <label class="nl-field">
            <span>Target kind</span>
            <select
              class="select-field"
              value={targetKind}
              onChange={(event) => onUpdateNodeData(node.id, { targetKind: event.currentTarget.value })}
            >
              <option value="animation">Motion Timeline Clip</option>
              <option value="media">Media Layer (Audio / Video)</option>
            </select>
          </label>
          {targetKind === 'animation' ? (
            <>
              <div class="nl-field">
                <span>Clip source</span>
                <div class="nl-target-mode-toggle" role="group" aria-label="Clip resolution mode">
                  <button
                    type="button"
                    class={`nl-target-mode-btn ${targetMode === 'pipeline' ? 'is-active' : ''}`}
                    aria-pressed={targetMode === 'pipeline'}
                    title="Inherit from Pipeline"
                    onClick={() => onUpdateNodeData(node.id, { targetMode: 'pipeline' })}
                  >
                    Inherit Pipeline
                  </button>
                  <button
                    type="button"
                    class={`nl-target-mode-btn ${targetMode === 'override' ? 'is-active' : ''}`}
                    aria-pressed={targetMode === 'override'}
                    title="Override Clip"
                    onClick={() => onUpdateNodeData(node.id, { targetMode: 'override' })}
                  >
                    Override Clip
                  </button>
                </div>
              </div>
              <label class="nl-field">
                <span>Animation clip</span>
                <select
                  class="select-field"
                  value={typeof node.data.clipId === 'string' ? node.data.clipId : ''}
                  onChange={(event) => onUpdateNodeData(node.id, { clipId: event.currentTarget.value })}
                >
                  <option value="">
                    {targetMode === 'pipeline'
                      ? attachedClips.length > 0
                        ? `Auto · Origin clip (${attachedClips[0].name})`
                        : 'Auto · Origin attached clip'
                      : 'Select animation clip…'}
                  </option>
                  {animations.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.name} ({(clip.durationMs / 1000).toFixed(2)}s)
                      {originClipIds.has(clip.id) ? ' ★ Origin' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            renderPipelineTargetField('Media layer', scopedAstNodes)
          )}
          <label class="nl-field">
            <span>Playback command</span>
            <select
              class="select-field"
              value={typeof node.data.command === 'string' ? node.data.command : 'play'}
              onChange={(event) => onUpdateNodeData(node.id, { command: event.currentTarget.value })}
            >
              <option value="play">Play</option>
              <option value="pause">Pause</option>
              <option value="stop">Stop</option>
              <option value="reverse">Reverse</option>
            </select>
          </label>
        </>
      );
    }

    case 'action.navigate': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'internal';
      return (
        <>
          <label class="nl-field">
            <span>Navigation mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="internal">Internal Page</option>
              <option value="external">External URL</option>
              <option value="scroll-to">Scroll To Layer</option>
              <option value="url-params">Update URL Params</option>
              <option value="back">Browser Back</option>
              <option value="forward">Browser Forward</option>
              <option value="reload">Reload Page</option>
            </select>
          </label>
          {mode === 'internal' && (
            <label class="nl-field">
              <span>Project page</span>
              <select
                class="select-field"
                value={pages.some((p) => p.route === node.data.route) ? String(node.data.route) : ''}
                onChange={(event) => {
                  if (event.currentTarget.value) {
                    onUpdateNodeData(node.id, { route: event.currentTarget.value });
                  }
                }}
              >
                <option value="">Custom route…</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.route}>
                    {page.name} ({page.route})
                  </option>
                ))}
              </select>
            </label>
          )}
          {(mode === 'internal' || mode === 'external') && (
            <label class="nl-field">
              <span>{mode === 'external' ? 'External URL (https://…)' : 'Route path'}</span>
              <input
                class="nl-input"
                type="text"
                value={typeof node.data.route === 'string' ? node.data.route : '/'}
                onInput={(event) => onUpdateNodeData(node.id, { route: event.currentTarget.value })}
              />
            </label>
          )}
          {mode === 'scroll-to' && renderPipelineTargetField('Scroll target layer', scopedAstNodes)}
          {mode === 'url-params' && (
            <label class="nl-field">
              <span>Query params</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. tab=pricing&plan=pro"
                value={typeof node.data.params === 'string' ? node.data.params : ''}
                onInput={(event) => onUpdateNodeData(node.id, { params: event.currentTarget.value })}
              />
            </label>
          )}
        </>
      );
    }

    case 'action.overlay-toast': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'show-toast';
      return (
        <>
          <label class="nl-field">
            <span>Overlay / Toast mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="show-toast">Show Toast</option>
              <option value="open-modal">Open Modal</option>
              <option value="close-modal">Close Modal</option>
              <option value="open-drawer">Open Drawer</option>
              <option value="close-drawer">Close Drawer</option>
            </select>
          </label>
          {mode === 'show-toast' ? (
            <>
              {renderScopedDataPicker('Message from Pipeline (optional)', 'pipelineRef')}
              <label class="nl-field">
                <span>Toast message (fallback if Pipeline &amp; Message port unset)</span>
                <input
                  class="nl-input"
                  type="text"
                  value={typeof node.data.message === 'string' ? node.data.message : ''}
                  onInput={(event) => onUpdateNodeData(node.id, { message: event.currentTarget.value })}
                />
              </label>
              <label class="nl-field">
                <span>Toast tone</span>
                <select
                  class="select-field"
                  value={typeof node.data.tone === 'string' ? node.data.tone : 'info'}
                  onChange={(event) => onUpdateNodeData(node.id, { tone: event.currentTarget.value })}
                >
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </label>
            </>
          ) : (
            renderPipelineTargetField('Target modal / drawer layer', scopedAstNodes)
          )}
        </>
      );
    }

    case 'action.system-form': {
      const action = typeof node.data.action === 'string' ? node.data.action : 'set-theme';
      return (
        <>
          <label class="nl-field">
            <span>System / Form action</span>
            <select
              class="select-field"
              value={action}
              onChange={(event) => onUpdateNodeData(node.id, { action: event.currentTarget.value })}
            >
              <option value="set-theme">Set Theme</option>
              <option value="focus">Focus Input</option>
              <option value="blur">Blur Input</option>
              <option value="reset-form">Reset Form</option>
              <option value="clipboard">Copy to Clipboard</option>
              <option value="download">Download File</option>
              <option value="storage">Save to Web Storage</option>
              <option value="storage.get">Read from Web Storage</option>
              <option value="storage.remove">Remove from Web Storage</option>
              <option value="storage.clear">Clear Web Storage</option>
            </select>
          </label>
          {action === 'set-theme' && (
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
          )}
          {(action === 'focus' || action === 'blur' || action === 'reset-form') &&
            renderPipelineTargetField('Target form / input layer', scopedAstNodes)}
          {(action === 'clipboard' || action === 'download' || action === 'storage' || action === 'storage.set' || action === 'storage.get') && (
            <>
              {renderScopedDataPicker('Payload from Pipeline (optional)', 'pipelineRef')}
              <label class="nl-field">
                <span>{action === 'storage.get' ? 'Default fallback (if key not found)' : 'Payload fallback (if Pipeline & Value port unset)'}</span>
                <input
                  class="nl-input"
                  type="text"
                  value={typeof node.data.value === 'string' ? node.data.value : ''}
                  onInput={(event) => onUpdateNodeData(node.id, { value: event.currentTarget.value })}
                />
              </label>
            </>
          )}
          {action === 'download' && (
            <label class="nl-field">
              <span>Filename</span>
              <input
                class="nl-input"
                type="text"
                placeholder="export.json"
                value={typeof node.data.filename === 'string' ? node.data.filename : 'export.json'}
                onInput={(event) => onUpdateNodeData(node.id, { filename: event.currentTarget.value })}
              />
            </label>
          )}
          {(action === 'storage' || action.startsWith('storage.')) && (
            <div class="nl-field-grid nl-field-grid-2">
              {action !== 'storage.clear' && (
                <label class="nl-field">
                  <span>Storage key</span>
                  <input
                    class="nl-input"
                    type="text"
                    placeholder="folio_draft"
                    value={typeof node.data.storageKey === 'string' ? node.data.storageKey : ''}
                    onInput={(event) => onUpdateNodeData(node.id, { storageKey: event.currentTarget.value })}
                  />
                </label>
              )}
              <label class="nl-field">
                <span>Storage scope</span>
                <select
                  class="select-field"
                  value={node.data.storageScope === 'session' ? 'session' : 'local'}
                  onChange={(event) => onUpdateNodeData(node.id, { storageScope: event.currentTarget.value })}
                >
                  <option value="local">LocalStorage</option>
                  <option value="session">SessionStorage</option>
                </select>
              </label>
            </div>
          )}
        </>
      );
    }

    // =========================================================================
    // 6. FLOW & TIMING (3)
    // =========================================================================
    case 'flow.delay':
      return (
        <>
          <div class="nl-field-grid nl-field-grid-2">
            <label class="nl-field">
              <span>Duration</span>
              <input
                class="nl-input nl-tabular"
                type="number"
                min={0}
                value={typeof node.data.duration === 'number' ? node.data.duration : 300}
                onInput={(event) => {
                  const next = Math.max(0, Number(event.currentTarget.value));
                  onUpdateNodeData(node.id, { duration: Number.isFinite(next) ? next : 0 });
                }}
              />
            </label>
            <label class="nl-field">
              <span>Unit</span>
              <select
                class="select-field"
                value={node.data.unit === 's' ? 's' : 'ms'}
                onChange={(event) => onUpdateNodeData(node.id, { unit: event.currentTarget.value })}
              >
                <option value="ms">Milliseconds (ms)</option>
                <option value="s">Seconds (s)</option>
              </select>
            </label>
          </div>
          <label class="nl-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(node.data.cancelPrevious)}
              onChange={(event) => onUpdateNodeData(node.id, { cancelPrevious: event.currentTarget.checked })}
            />
            <span>Cancel previous pending timer</span>
          </label>
        </>
      );

    case 'flow.loop-timer': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'for-each';
      return (
        <>
          <label class="nl-field">
            <span>Mode</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="for-each">For Each (List)</option>
              <option value="interval-start">Interval — Start</option>
              <option value="interval-stop">Interval — Stop</option>
            </select>
          </label>
          {mode === 'for-each' ? (
            <label class="nl-field">
              <span>Max iterations safety cap</span>
              <input
                class="nl-input nl-tabular"
                type="number"
                min={1}
                max={200}
                value={typeof node.data.maxIterations === 'number' ? node.data.maxIterations : 50}
                onInput={(event) => onUpdateNodeData(node.id, { maxIterations: Math.max(1, Math.min(200, Number(event.currentTarget.value) || 50)) })}
              />
            </label>
          ) : (
            <div class="nl-field-grid nl-field-grid-2">
              <label class="nl-field">
                <span>Timer ID</span>
                <input
                  class="nl-input"
                  type="text"
                  value={typeof node.data.timerId === 'string' ? node.data.timerId : 'timer-1'}
                  onInput={(event) => onUpdateNodeData(node.id, { timerId: event.currentTarget.value })}
                />
              </label>
              {mode === 'interval-start' && (
                <label class="nl-field">
                  <span>Interval (ms)</span>
                  <input
                    class="nl-input nl-tabular"
                    type="number"
                    min={50}
                    step={50}
                    value={typeof node.data.intervalMs === 'number' ? node.data.intervalMs : 1000}
                    onInput={(event) => onUpdateNodeData(node.id, { intervalMs: Math.max(50, Number(event.currentTarget.value) || 1000) })}
                  />
                </label>
              )}
            </div>
          )}
        </>
      );
    }

    case 'flow.control':
      return (
        <label class="nl-field">
          <span>Execution strategy</span>
          <select
            class="select-field"
            value={node.data.mode === 'parallel' ? 'parallel' : 'sequence'}
            onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
          >
            <option value="sequence">Sequence (Branch 1 → Branch 2 → Done)</option>
            <option value="parallel">Parallel / Wait All</option>
          </select>
        </label>
      );

    // =========================================================================
    // 7. NETWORK (3)
    // =========================================================================
    case 'network.http':
      return (
        <>
          <div class="nl-field-grid nl-field-grid-2">
            <label class="nl-field">
              <span>Method</span>
              <select
                class="select-field"
                value={typeof node.data.method === 'string' ? node.data.method : 'GET'}
                onChange={(event) => onUpdateNodeData(node.id, { method: event.currentTarget.value })}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <label class="nl-field">
              <span>Cache</span>
              <select
                class="select-field"
                value={typeof node.data.cache === 'string' ? node.data.cache : 'no-store'}
                onChange={(event) => onUpdateNodeData(node.id, { cache: event.currentTarget.value })}
              >
                <option value="no-store">No Store</option>
                <option value="default">Default</option>
                <option value="memory">Memory</option>
              </select>
            </label>
          </div>
          <label class="nl-field">
            <span>Endpoint path or URL</span>
            <input
              class="nl-input"
              type="text"
              placeholder="/api/items or https://…"
              value={typeof node.data.url === 'string' ? node.data.url : '/api/items'}
              onInput={(event) => onUpdateNodeData(node.id, { url: event.currentTarget.value })}
            />
          </label>
          <label class="nl-field">
            <span>Payload format</span>
            <select
              class="select-field"
              value={node.data.bodyType === 'file-upload' ? 'file-upload' : 'json'}
              onChange={(event) => onUpdateNodeData(node.id, { bodyType: event.currentTarget.value })}
            >
              <option value="json">JSON</option>
              <option value="file-upload">File Upload (FormData)</option>
            </select>
          </label>
          {String(node.data.method ?? 'GET') !== 'GET' && (
            <label class="nl-field">
              <span>Fallback body (when Body port is unwired)</span>
              <input
                class="nl-input"
                type="text"
                placeholder='{"name":"Folio"}'
                value={typeof node.data.body === 'string' ? node.data.body : ''}
                onInput={(event) => onUpdateNodeData(node.id, { body: event.currentTarget.value })}
              />
            </label>
          )}
          <label class="nl-field">
            <span>Execution mode</span>
            <select
              class="select-field"
              aria-label="HTTP request execution mode"
              value={node.data.executionMode === 'live' ? 'live' : 'simulated'}
              onChange={(event) => onUpdateNodeData(node.id, { executionMode: event.currentTarget.value })}
            >
              <option value="simulated">Simulated (Deterministic Offline)</option>
              <option value="live">Live HTTP (via /api/logic/http-proxy)</option>
            </select>
          </label>
          <label class="nl-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(node.data.useAuth)}
              onChange={(event) => onUpdateNodeData(node.id, { useAuth: event.currentTarget.checked })}
            />
            <span>Use Project Auth Secret Ref (server-side)</span>
          </label>
          <div class="nl-live-http-test">
            <button
              type="button"
              class="nl-secondary-btn"
              disabled={liveTestState?.nodeId === node.id && liveTestState.loading}
              onClick={() =>
                void runLiveProxyTest(
                  typeof node.data.url === 'string' ? node.data.url : '',
                  typeof node.data.method === 'string' ? node.data.method : 'GET',
                  typeof node.data.body === 'string' ? node.data.body : undefined,
                  Boolean(node.data.useAuth),
                )
              }
            >
              {liveTestState?.nodeId === node.id && liveTestState.loading
                ? 'Testing via Proxy…'
                : 'Test Live Request'}
            </button>
            {liveTestState?.nodeId === node.id && !liveTestState.loading && (
              <div class={`nl-live-http-result ${liveTestState.ok ? 'is-ok' : 'is-err'}`} data-testid="nl-live-http-result">
                <div class="nl-live-http-result-head">
                  <strong>{liveTestState.ok ? `HTTP ${liveTestState.status ?? 200}` : `Error (${liveTestState.status ?? 'Blocked'})`}</strong>
                  {typeof liveTestState.durationMs === 'number' && <span>{liveTestState.durationMs}ms</span>}
                </div>
                {liveTestState.authMode === 'session-token' && (
                  <p class="nl-hint">Used Session-Only Local Test Token (in-memory only).</p>
                )}
                {liveTestState.error ? (
                  <p class="nl-live-http-result-msg">{liveTestState.error}</p>
                ) : (
                  <pre class="nl-live-http-result-pre">{liveTestState.preview || '(empty response)'}</pre>
                )}
              </div>
            )}
          </div>
          <button type="button" class="nl-inline-link" onClick={() => onChangeTab('network')}>
            Open Project Network Settings →
          </button>
        </>
      );

    case 'network.json': {
      const mode = typeof node.data.mode === 'string' ? node.data.mode : 'get-field';
      return (
        <>
          <label class="nl-field">
            <span>JSON operation</span>
            <select
              class="select-field"
              value={mode}
              onChange={(event) => onUpdateNodeData(node.id, { mode: event.currentTarget.value })}
            >
              <option value="get-field">Get Field / Path</option>
              <option value="parse">Parse JSON String</option>
              <option value="stringify">Stringify Value</option>
            </select>
          </label>
          {mode === 'get-field' && (
            <label class="nl-field">
              <span>Dot path</span>
              <input
                class="nl-input"
                type="text"
                placeholder="e.g. data.items.0.title"
                value={typeof node.data.path === 'string' ? node.data.path : ''}
                onInput={(event) => onUpdateNodeData(node.id, { path: event.currentTarget.value })}
              />
            </label>
          )}
        </>
      );
    }

    case 'network.socket':
      return (
        <>
          <label class="nl-field">
            <span>Socket action</span>
            <select
              class="select-field"
              value={typeof node.data.action === 'string' ? node.data.action : 'listen'}
              onChange={(event) => onUpdateNodeData(node.id, { action: event.currentTarget.value })}
            >
              <option value="connect">Connect</option>
              <option value="listen">Listen</option>
              <option value="send">Send Message</option>
            </select>
          </label>
          <label class="nl-field">
            <span>Channel</span>
            <input
              class="nl-input"
              type="text"
              placeholder="e.g. room:lobby, updates"
              value={typeof node.data.channel === 'string' ? node.data.channel : 'updates'}
              onInput={(event) => onUpdateNodeData(node.id, { channel: event.currentTarget.value })}
            />
          </label>
          <label class="nl-field">
            <span>Event name</span>
            <input
              class="nl-input"
              type="text"
              placeholder="message"
              value={typeof node.data.eventName === 'string' ? node.data.eventName : 'message'}
              onInput={(event) => onUpdateNodeData(node.id, { eventName: event.currentTarget.value })}
            />
          </label>
          <p class="nl-hint">
            Simulated offline channel only — live WebSocket transport is not yet available.
          </p>
        </>
      );

    // =========================================================================
    // LEGACY v1 COMPATIBILITY EDITORS
    // =========================================================================
    case 'source.page': {
      const pageId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
      const usedPageIds = graph ? getUsedSourceReferenceIds(graph, 'source.page', node.id) : new Set<string>();
      return (
        <label class="nl-field">
          <span>Project page (Legacy)</span>
          <select
            class="select-field nl-source-select"
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
      );
    }

    case 'source.component': {
      const componentId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      const usedIds = graph ? getUsedSourceReferenceIds(graph, 'source.component', node.id) : new Set<string>();
      return (
        <label class="nl-field">
          <span>Component (Legacy)</span>
          <select
            class="select-field nl-source-select"
            value={componentId}
            onChange={(event) => onUpdateNodeData(node.id, { componentId: event.currentTarget.value })}
          >
            <option value="">Select component…</option>
            {components.map((comp) => {
              const isUsed = usedIds.has(comp.id);
              return (
                <option key={comp.id} value={comp.id} disabled={isUsed}>
                  {comp.name}{isUsed ? ' — In graph' : ''}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    case 'source.theme': {
      const themeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
      return (
        <label class="nl-field">
          <span>Theme (Legacy)</span>
          <select
            class="select-field"
            value={themeId}
            onChange={(event) => onUpdateNodeData(node.id, { themeId: event.currentTarget.value })}
          >
            <option value="">Select theme…</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>{theme.name}</option>
            ))}
          </select>
        </label>
      );
    }

    case 'event.on-page-load':
      return (
        <>
          <p class="nl-inspector-hint">Legacy Page Load trigger. Runs once when this page mounts.</p>
          {renderEventControls()}
        </>
      );

    case 'state.set':
      return (
        <>
          {renderVariablePicker()}
          <label class="nl-field">
            <span>Fallback value</span>
            <input
              class="nl-input"
              type="text"
              value={node.data.value === null || node.data.value === undefined ? '' : String(node.data.value)}
              onInput={(event) => onUpdateNodeData(node.id, { value: event.currentTarget.value })}
            />
          </label>
        </>
      );

    case 'state.increment':
      return (
        <>
          {renderVariablePicker('number')}
          <label class="nl-field">
            <span>Step</span>
            <input
              class="nl-input nl-tabular"
              type="number"
              value={typeof node.data.step === 'number' ? node.data.step : 1}
              onInput={(event) => onUpdateNodeData(node.id, { step: Number(event.currentTarget.value) || 1 })}
            />
          </label>
        </>
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
          {renderScopedDataPicker('Left / A from Pipeline (Scoped)', 'leftRef')}
          {renderScopedDataPicker('Right / B from Pipeline (Scoped)', 'rightRef')}
        </>
      );

    case 'logic.template':
      return (
        <>
          {renderScopedDataPicker('Value from Pipeline (Scoped)', 'pipelineRef')}
          <label class="nl-field">
            <span>Template</span>
            <input
              class="nl-input"
              type="text"
              value={typeof node.data.template === 'string' ? node.data.template : '{{value}}'}
              onInput={(event) => onUpdateNodeData(node.id, { template: event.currentTarget.value })}
            />
          </label>
        </>
      );

    case 'action.set-visible':
      return (
        <>
          {renderPipelineTargetField('Target layer', scopedAstNodes)}
          {renderScopedDataPicker('Visibility from Pipeline (optional)', 'pipelineRef', ['boolean'])}
          <label class="nl-field">
            <span>Mode</span>
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
          {renderPipelineTargetField('Target text layer', textNodes)}
          {renderScopedDataPicker('Text from Pipeline (optional)', 'pipelineRef')}
          <label class="nl-field">
            <span>Fallback text</span>
            <input
              class="nl-input"
              type="text"
              value={typeof node.data.text === 'string' ? node.data.text : ''}
              onInput={(event) => onUpdateNodeData(node.id, { text: event.currentTarget.value })}
            />
          </label>
        </>
      );

    case 'action.set-fill':
      return (
        <>
          {renderPipelineTargetField('Target fillable layer', fillableNodes)}
          {renderScopedDataPicker('Fill color from Pipeline (optional)', 'pipelineRef', ['string'])}
          <label class="nl-field">
            <span>Fill color</span>
            <input
              class="nl-input"
              type="text"
              value={typeof node.data.fill === 'string' ? node.data.fill : '#3B82F6'}
              onInput={(event) => onUpdateNodeData(node.id, { fill: event.currentTarget.value })}
            />
          </label>
        </>
      );

    case 'action.set-theme':
      return (
        <label class="nl-field">
          <span>Theme</span>
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
        <>
          <div class="nl-field">
            <span>Clip source</span>
            <div class="nl-target-mode-toggle" role="group" aria-label="Clip resolution mode">
              <button
                type="button"
                class={`nl-target-mode-btn ${targetMode === 'pipeline' ? 'is-active' : ''}`}
                aria-pressed={targetMode === 'pipeline'}
                title="Inherit from Pipeline"
                onClick={() => onUpdateNodeData(node.id, { targetMode: 'pipeline' })}
              >
                Inherit Pipeline
              </button>
              <button
                type="button"
                class={`nl-target-mode-btn ${targetMode === 'override' ? 'is-active' : ''}`}
                aria-pressed={targetMode === 'override'}
                title="Override Clip"
                onClick={() => onUpdateNodeData(node.id, { targetMode: 'override' })}
              >
                Override Clip
              </button>
            </div>
          </div>
          <label class="nl-field">
            <span>Animation clip</span>
            <select
              class="select-field"
              value={typeof node.data.clipId === 'string' ? node.data.clipId : ''}
              onChange={(event) => onUpdateNodeData(node.id, { clipId: event.currentTarget.value })}
            >
              <option value="">
                {targetMode === 'pipeline' ? 'Auto · Origin attached clip' : 'Select clip…'}
              </option>
              {animations.map((clip) => (
                <option key={clip.id} value={clip.id}>{clip.name}</option>
              ))}
            </select>
          </label>
        </>
      );

    default:
      return (
        <p class="nl-inspector-hint">
          Custom node type “{node.type}” is preserved safely inside this .flop v2 project.
        </p>
      );
  }
}

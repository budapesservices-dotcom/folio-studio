import { useMemo } from 'preact/hooks';
import type {
  LogicFrame,
  LogicFrameExposedParam,
  LogicGraph,
} from '../../core/document/types';
import {
  LOGIC_FRAME_COLORS,
  getExposableParamsForFrame,
  getLogicFrameColorPreset,
  type LogicDiagnostic,
} from '../../engines/prototype';
import { StudioIcon } from './StudioIcon';

export interface NodeLogicFrameInspectorProps {
  graph: LogicGraph;
  frame: LogicFrame;
  diagnostics: readonly LogicDiagnostic[];
  bakeErrors: readonly LogicDiagnostic[];
  onUpdateFrame: (
    frameId: string,
    patch: Partial<Pick<LogicFrame, 'title' | 'color' | 'exposedParams'>>,
  ) => void;
  onUpdateNodeData: (nodeId: string, patch: Record<string, string | number | boolean | null>) => void;
  onBakeFrame: (frameId: string) => void;
  onUnbakeFrame: (frameId: string) => void;
  onSaveFramePreset: (frameId: string) => void;
  onDeleteFrame: (frameId: string, deleteChildren?: boolean) => void;
  onFocusNode: (nodeId: string) => void;
}

export function NodeLogicFrameInspector({
  graph,
  frame,
  diagnostics,
  bakeErrors,
  onUpdateFrame,
  onUpdateNodeData,
  onBakeFrame,
  onUnbakeFrame,
  onSaveFramePreset,
  onDeleteFrame,
  onFocusNode,
}: NodeLogicFrameInspectorProps) {
  const colorPreset = getLogicFrameColorPreset(frame.color);
  const childSet = useMemo(() => new Set(frame.childNodeIds), [frame.childNodeIds]);

  const candidates = useMemo(
    () => getExposableParamsForFrame(graph, frame),
    [graph, frame],
  );

  const pinnedParams: readonly LogicFrameExposedParam[] =
    frame.isBaked && frame.bakedData
      ? frame.bakedData.exposedParams
      : (frame.exposedParams ?? []);

  const pinnedIdSet = useMemo(
    () => new Set(pinnedParams.map((p) => p.paramId)),
    [pinnedParams],
  );

  const frameDiagnostics = useMemo(() => {
    const merged: LogicDiagnostic[] = [...bakeErrors];
    const seen = new Set(bakeErrors.map((d) => `${d.code}:${d.nodeId ?? ''}:${d.message}`));
    for (const diag of diagnostics) {
      const matches = diag.frameId === frame.id || (diag.nodeId !== undefined && childSet.has(diag.nodeId));
      if (!matches) continue;
      const key = `${diag.code}:${diag.nodeId ?? ''}:${diag.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(diag);
    }
    return merged;
  }, [bakeErrors, diagnostics, frame.id, childSet]);

  const toggleExposedParam = (candidate: (typeof candidates)[number], checked: boolean) => {
    if (checked) {
      if (pinnedIdSet.has(candidate.paramId)) return;
      const next: LogicFrameExposedParam[] = [
        ...pinnedParams,
        {
          paramId: candidate.paramId,
          nodeId: candidate.nodeId,
          field: candidate.field,
          label: candidate.label,
          type: candidate.type,
        },
      ];
      onUpdateFrame(frame.id, { exposedParams: next });
    } else {
      const next = pinnedParams.filter((p) => p.paramId !== candidate.paramId);
      onUpdateFrame(frame.id, { exposedParams: next });
    }
  };

  const nodesById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );

  return (
    <div class="nl-frame-inspector" data-testid="nl-frame-inspector">
      <div class="nl-inspector-head">
        <div>
          <div class="nl-inspector-title">
            {frame.isBaked ? 'Baked Logic Function' : 'Smart Logic Frame'}
          </div>
          <div class="nl-inspector-meta nl-tabular">
            {frame.childNodeIds.length} node{frame.childNodeIds.length === 1 ? '' : 's'} ·{' '}
            {frame.isBaked
              ? `${frame.bakedData?.compiledPlan.steps.length ?? 0} compiled steps`
              : 'Edit mode'}
          </div>
        </div>
        <button
          type="button"
          class="nl-icon-danger"
          title={frame.isBaked ? 'Delete baked frame and internal nodes' : 'Unwrap frame (keep nodes)'}
          aria-label={frame.isBaked ? `Delete baked frame ${frame.title}` : `Unwrap frame ${frame.title}`}
          onClick={() => onDeleteFrame(frame.id, frame.isBaked)}
        >
          <StudioIcon name="trash" />
        </button>
      </div>

      {/* Primary Bake / Unbake / Save Preset Actions */}
      <div class="nl-frame-action-bar">
        {!frame.isBaked ? (
          <>
            <button
              type="button"
              class="nl-primary-btn"
              data-testid="nl-inspector-bake-btn"
              onClick={() => onBakeFrame(frame.id)}
            >
              Bake Frame
            </button>
            <button
              type="button"
              class="nl-secondary-btn"
              onClick={() => onDeleteFrame(frame.id, false)}
            >
              Unwrap
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              class="nl-secondary-btn"
              data-testid="nl-inspector-unbake-btn"
              onClick={() => onUnbakeFrame(frame.id)}
            >
              Unbake / Edit
            </button>
            <button
              type="button"
              class="nl-primary-btn"
              data-testid="nl-inspector-save-preset-btn"
              onClick={() => onSaveFramePreset(frame.id)}
            >
              Save as Preset
            </button>
          </>
        )}
      </div>

      {/* Frame Title & Accent Color */}
      <label class="nl-field">
        <span>Frame Title</span>
        <input
          class="nl-input"
          type="text"
          aria-label="Logic frame title"
          value={frame.title}
          onInput={(event) => onUpdateFrame(frame.id, { title: event.currentTarget.value })}
        />
      </label>

      <div class="nl-field">
        <span>Accent Color</span>
        <div class="nl-frame-color-swatches" role="group" aria-label="Frame accent color">
          {LOGIC_FRAME_COLORS.map((swatch) => {
            const isSelected = swatch.id === colorPreset.id;
            return (
              <button
                key={swatch.id}
                type="button"
                class={`nl-frame-swatch ${isSelected ? 'is-active' : ''}`}
                style={{ backgroundColor: swatch.accent }}
                aria-label={`Set frame color to ${swatch.label}`}
                aria-pressed={isSelected}
                title={swatch.label}
                onClick={() => onUpdateFrame(frame.id, { color: swatch.id })}
              />
            );
          })}
        </div>
      </div>

      {/* Baked Mode: Live Editable Exposed Parameters */}
      {frame.isBaked && frame.bakedData && (
        <div class="nl-frame-section" data-testid="nl-baked-exposed-params">
          <div class="nl-section-label">
            Exposed Parameters ({pinnedParams.length})
          </div>
          {pinnedParams.length === 0 ? (
            <p class="nl-inspector-hint">
              No parameters pinned yet. Click <strong>Unbake / Edit</strong> to pin internal node properties (like fill colors or text) for quick editing here.
            </p>
          ) : (
            <div class="nl-exposed-param-editors">
              {pinnedParams.map((param) => {
                const targetNode = nodesById.get(param.nodeId);
                if (!targetNode) return null;
                const rawValue = targetNode.data[param.field];
                const candidateMeta = candidates.find((c) => c.paramId === param.paramId);

                return (
                  <label key={param.paramId} class="nl-field nl-exposed-param-field">
                    <span>{param.label}</span>
                    {param.type === 'color' ? (
                      <div class="nl-color-input-row">
                        <input
                          type="color"
                          class="nl-color-swatch-input"
                          aria-label={`${param.label} color picker`}
                          value={
                            typeof rawValue === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawValue.trim())
                              ? rawValue.trim()
                              : '#2dd4bf'
                          }
                          onInput={(event) =>
                            onUpdateNodeData(param.nodeId, { [param.field]: event.currentTarget.value })
                          }
                        />
                        <input
                          type="text"
                          class="nl-input nl-tabular"
                          aria-label={param.label}
                          value={typeof rawValue === 'string' ? rawValue : ''}
                          onInput={(event) =>
                            onUpdateNodeData(param.nodeId, { [param.field]: event.currentTarget.value })
                          }
                        />
                      </div>
                    ) : param.type === 'boolean' ? (
                      <select
                        class="select-field"
                        aria-label={param.label}
                        value={String(Boolean(rawValue))}
                        onChange={(event) =>
                          onUpdateNodeData(param.nodeId, {
                            [param.field]: event.currentTarget.value === 'true',
                          })
                        }
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : param.type === 'number' ? (
                      <input
                        type="number"
                        class="nl-input nl-tabular"
                        aria-label={param.label}
                        value={typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)}
                        onInput={(event) => {
                          const parsed = Number(event.currentTarget.value);
                          if (Number.isFinite(parsed)) {
                            onUpdateNodeData(param.nodeId, { [param.field]: parsed });
                          }
                        }}
                      />
                    ) : param.type === 'select' && candidateMeta?.selectOptions ? (
                      <select
                        class="select-field"
                        aria-label={param.label}
                        value={typeof rawValue === 'string' ? rawValue : candidateMeta.selectOptions[0]?.value ?? ''}
                        onChange={(event) =>
                          onUpdateNodeData(param.nodeId, { [param.field]: event.currentTarget.value })
                        }
                      >
                        {candidateMeta.selectOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        class="nl-input"
                        aria-label={param.label}
                        value={rawValue === null || rawValue === undefined ? '' : String(rawValue)}
                        onInput={(event) =>
                          onUpdateNodeData(param.nodeId, { [param.field]: event.currentTarget.value })
                        }
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div class="nl-frame-ports-summary nl-tabular">
            <span>{frame.bakedData.exposedInputs.length} input port{frame.bakedData.exposedInputs.length === 1 ? '' : 's'}</span>
            <span>{frame.bakedData.exposedOutputs.length} output port{frame.bakedData.exposedOutputs.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}

      {/* Unbaked Mode: Pinning Checkboxes for Exposable Internal Node Params */}
      {!frame.isBaked && (
        <div class="nl-frame-section" data-testid="nl-frame-pin-params">
          <div class="nl-section-label">
            Pin Exposed Parameters ({pinnedParams.length})
          </div>
          {candidates.length === 0 ? (
            <p class="nl-inspector-hint">
              Drag nodes into this Frame to expose their editable properties when baked.
            </p>
          ) : (
            <div class="nl-exposed-param-list">
              {candidates.map((cand) => {
                const isPinned = pinnedIdSet.has(cand.paramId);
                return (
                  <label key={cand.paramId} class="nl-checkbox-row nl-exposed-pin-item">
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={(event) => toggleExposedParam(cand, event.currentTarget.checked)}
                    />
                    <span class="nl-exposed-pin-label">{cand.label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Frame Diagnostics & Portability Warnings */}
      {frameDiagnostics.length > 0 && (
        <div class="nl-diag-block" role="status" data-testid="nl-frame-diagnostics">
          <div class="nl-section-label">Node Diagnostics ({frameDiagnostics.length})</div>
          <div class="nl-diag-list">
            {frameDiagnostics.map((diag, idx) => (
              <button
                key={`${diag.code}-${idx}`}
                type="button"
                class={`nl-diag-item nl-diag-button is-${diag.severity}`}
                onClick={() => {
                  if (!frame.isBaked && diag.nodeId) onFocusNode(diag.nodeId);
                }}
              >
                <span class="nl-diag-severity">{diag.severity === 'error' ? 'Error' : 'Warn'}</span>
                <span>{diag.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

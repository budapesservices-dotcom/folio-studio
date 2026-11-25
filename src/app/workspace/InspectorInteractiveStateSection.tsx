import type {
  DesignNode,
  InteractiveStateId,
  NodeStateOverride,
  NodeTransitionConfig,
  PseudoStateKey,
  TransitionPreset,
} from '../../core/document/types';
import type { CssUnitOption } from '../../core/document/cssUnits';
import type { StudioVectorActions } from './inspectorVectorHelpers';
import { NumericUnitInput } from './NumericUnitInput';

export const INTERACTIVE_STATES: ReadonlyArray<{ id: InteractiveStateId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'hover', label: 'Hover' },
  { id: 'active', label: 'Active' },
  { id: 'focus', label: 'Focus' },
  { id: 'disabled', label: 'Dis' },
];

export const TRANSITION_PRESET_DEFAULTS: Record<TransitionPreset, { durationMs: number }> = {
  none: { durationMs: 0 },
  fast: { durationMs: 150 },
  smooth: { durationMs: 240 },
  bouncy: { durationMs: 360 },
};

const DURATION_UNITS: readonly CssUnitOption[] = ['ms', 's'];

export function hasAnyStateOverrides(
  node: Pick<DesignNode, 'stateOverrides'>,
  stateId: InteractiveStateId,
): boolean {
  if (stateId === 'default') return false;
  const entry = node.stateOverrides?.[stateId];
  return Boolean(entry && Object.keys(entry).length > 0);
}

export function buildNextStateOverrides(
  currentOverrides: DesignNode['stateOverrides'],
  pseudoKey: PseudoStateKey,
  patch: Partial<NodeStateOverride>,
): NonNullable<DesignNode['stateOverrides']> {
  const nextEntry: NodeStateOverride = {
    ...(currentOverrides?.[pseudoKey] ?? {}),
    ...patch,
  };
  return {
    ...(currentOverrides ?? {}),
    [pseudoKey]: nextEntry,
  };
}

export function removeStateOverride(
  currentOverrides: DesignNode['stateOverrides'],
  pseudoKey: PseudoStateKey,
): DesignNode['stateOverrides'] {
  if (!currentOverrides) return undefined;
  const nextOverrides = { ...currentOverrides };
  delete nextOverrides[pseudoKey];
  return Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined;
}

export interface InspectorInteractiveStateSectionProps {
  selectedNode: DesignNode;
  activeState: InteractiveStateId;
  onSelectState: (state: InteractiveStateId) => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
}

export function InspectorInteractiveStateSection({
  selectedNode,
  activeState,
  onSelectState,
  onUpdateSelected,
  onCommitEdit,
}: InspectorInteractiveStateSectionProps) {
  const isPseudoState = activeState !== 'default';
  const pseudoKey = activeState as PseudoStateKey;
  const activeStateOverride: NodeStateOverride | undefined = isPseudoState
    ? selectedNode.stateOverrides?.[pseudoKey]
    : undefined;

  const currentTransition: NodeTransitionConfig = selectedNode.transition ?? {
    preset: 'none',
    durationMs: 0,
    durationUnit: 'ms',
  };

  const updateActiveStateOverride = (patch: Partial<NodeStateOverride>, commit = true) => {
    if (!isPseudoState) return;
    onUpdateSelected({
      stateOverrides: buildNextStateOverrides(selectedNode.stateOverrides, pseudoKey, patch),
    });
    if (commit) onCommitEdit();
  };

  const resetActiveStateOverride = () => {
    if (!isPseudoState || !selectedNode.stateOverrides) return;
    onUpdateSelected({
      stateOverrides: removeStateOverride(selectedNode.stateOverrides, pseudoKey),
    });
    onCommitEdit();
  };

  return (
    <div class="folio-state-block">
      <div class="folio-state-switcher-pill" role="tablist" aria-label="Interactive state switcher">
        {INTERACTIVE_STATES.map((st) => {
          const active = activeState === st.id;
          const overridden = hasAnyStateOverrides(selectedNode, st.id);
          return (
            <button
              key={st.id}
              type="button"
              role="tab"
              aria-selected={active}
              class={`folio-state-pill-btn${active ? ' is-active' : ''}${
                active && st.id !== 'default' ? ' is-pseudo-active' : ''
              }`}
              title={st.id === 'disabled' ? 'Disabled State (:disabled)' : `${st.label} State`}
              onClick={() => onSelectState(st.id)}
            >
              <span>{st.label}</span>
              {overridden && <span class="folio-override-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {isPseudoState && (
        <div class="folio-pseudo-banner" role="status">
          <div class="folio-pseudo-banner-row">
            <span class="folio-pseudo-badge">Editing :{activeState}</span>
            <button
              type="button"
              class="inspector-mini-btn"
              disabled={!activeStateOverride}
              onClick={resetActiveStateOverride}
            >
              Reset :{activeState}
            </button>
          </div>
          <div class="folio-triple-grid">
            <NumericUnitInput
              label="Op"
              ariaLabel={`${activeState} opacity`}
              value={Math.round((activeStateOverride?.opacity ?? selectedNode.opacity) * 100)}
              unit="%"
              units={['%']}
              min={0}
              max={100}
              step={5}
              hasOverrideDot={typeof activeStateOverride?.opacity === 'number'}
              onChange={(p) =>
                updateActiveStateOverride({ opacity: Math.max(0, Math.min(1, p.value / 100)) })
              }
            />
            <NumericUnitInput
              label="Scl"
              ariaLabel={`${activeState} scale`}
              value={activeStateOverride?.scale ?? 1}
              unit=""
              units={['']}
              min={0.2}
              max={2}
              step={0.02}
              precision={2}
              hasOverrideDot={typeof activeStateOverride?.scale === 'number'}
              onChange={(p) => updateActiveStateOverride({ scale: p.value })}
            />
            <NumericUnitInput
              label="dY"
              ariaLabel={`${activeState} translate Y`}
              value={activeStateOverride?.translateY ?? 0}
              unit="px"
              units={['px']}
              min={-120}
              max={120}
              step={1}
              allowNegative
              hasOverrideDot={typeof activeStateOverride?.translateY === 'number'}
              onChange={(p) => updateActiveStateOverride({ translateY: p.value })}
            />
          </div>
        </div>
      )}

      {/* CSS Transition Preset & Duration */}
      <div class="folio-transition-row">
        <select
          class="select-field folio-compact-select"
          aria-label="CSS Transition Preset"
          value={currentTransition.preset}
          onChange={(event) => {
            const preset = event.currentTarget.value as TransitionPreset;
            if (preset === 'none') {
              onUpdateSelected({ transition: undefined });
            } else {
              const def = TRANSITION_PRESET_DEFAULTS[preset];
              onUpdateSelected({
                transition: {
                  preset,
                  durationMs: def.durationMs,
                  durationUnit: 'ms',
                },
              });
            }
            onCommitEdit();
          }}
        >
          <option value="none">Transition: None</option>
          <option value="fast">Fast (150ms)</option>
          <option value="smooth">Smooth (240ms)</option>
          <option value="bouncy">Bouncy (360ms)</option>
        </select>
        {currentTransition.preset !== 'none' && (
          <NumericUnitInput
            label="Dur"
            ariaLabel="Transition Duration"
            value={
              currentTransition.durationUnit === 's'
                ? Number(((currentTransition.durationMs ?? 240) / 1000).toFixed(2))
                : (currentTransition.durationMs ?? 240)
            }
            unit={currentTransition.durationUnit ?? 'ms'}
            units={DURATION_UNITS}
            min={0}
            max={3000}
            step={20}
            onChange={(p) => {
              const durationUnit: 'ms' | 's' = p.unit === 's' ? 's' : 'ms';
              const ms = durationUnit === 's' ? Math.round(p.value * 1000) : Math.round(p.value);
              onUpdateSelected({
                transition: {
                  ...currentTransition,
                  durationMs: Math.max(0, ms),
                  durationUnit,
                },
              });
              onCommitEdit();
            }}
          />
        )}
      </div>
    </div>
  );
}

export interface InspectorQuickHeaderActionsProps {
  selectedNode: DesignNode;
  studioActions?: StudioVectorActions;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onDuplicateSelection: () => void;
  onCommitEdit: () => void;
}

export function InspectorQuickHeaderActions({
  selectedNode,
  studioActions,
  onUpdateSelected,
  onDuplicateSelection,
  onCommitEdit,
}: InspectorQuickHeaderActionsProps) {
  return (
    <div class="inspector-quick-actions-row">
      <button
        type="button"
        class={`inspector-quick-icon-btn${selectedNode.locked ? ' is-active' : ''}`}
        aria-pressed={selectedNode.locked}
        title={selectedNode.locked ? 'Unlock layer' : 'Lock layer'}
        onClick={() => {
          onUpdateSelected({ locked: !selectedNode.locked });
          onCommitEdit();
        }}
      >
        {selectedNode.locked ? 'Locked' : 'Lock'}
      </button>
      <button
        type="button"
        class={`inspector-quick-icon-btn${!selectedNode.visible ? ' is-active' : ''}`}
        aria-pressed={!selectedNode.visible}
        title={selectedNode.visible ? 'Hide layer' : 'Show layer'}
        onClick={() => {
          onUpdateSelected({ visible: !selectedNode.visible });
          onCommitEdit();
        }}
      >
        {selectedNode.visible ? 'Hide' : 'Show'}
      </button>
      <button
        type="button"
        class="inspector-quick-icon-btn"
        title="Duplicate selection (Ctrl+Shift+D)"
        onClick={onDuplicateSelection}
      >
        Dup
      </button>
      {studioActions && (
        <>
          <button
            type="button"
            class="inspector-quick-icon-btn"
            title="Deselect all (Esc / Ctrl+D)"
            onClick={studioActions.onDeselect}
          >
            Deselect
          </button>
          <button
            type="button"
            class="inspector-quick-icon-btn"
            title="Invert selection (Ctrl+Shift+I)"
            onClick={studioActions.onInvertSelection}
          >
            Invert
          </button>
        </>
      )}
    </div>
  );
}

export function InspectorSelectSimilarControl({
  studioActions,
}: {
  studioActions: StudioVectorActions;
}) {
  return (
    <div class="inspector-similar-row">
      <select
        class="select-field inspector-similar-select"
        aria-label="Select Similar"
        value=""
        onChange={(event) => {
          const value = event.currentTarget.value as '' | 'fill' | 'stroke' | 'type';
          if (!value) return;
          studioActions.onSelectSimilar(value);
          event.currentTarget.value = '';
        }}
      >
        <option value="">Select Similar…</option>
        <option value="fill">Select Same Fill</option>
        <option value="stroke">Select Same Stroke</option>
        <option value="type">Select Same Type</option>
      </select>
    </div>
  );
}

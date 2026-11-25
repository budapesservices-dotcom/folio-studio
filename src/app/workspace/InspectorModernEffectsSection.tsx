import {
  BLEND_MODES,
  SHADOW_PRESETS,
  applyShadowPresetToEffects,
  detectShadowPreset,
  parseColorWithAlpha,
  type ShadowPresetId,
} from '../../core/document/styling';
import type {
  BlendMode,
  DesignNode,
  InteractiveStateId,
  NodeCssFilters,
  NodeStateOverride,
  PseudoStateKey,
  VisualEffect,
} from '../../core/document/types';
import { NumericUnitInput } from './NumericUnitInput';

export interface InspectorModernEffectsSectionProps {
  selectedNode: DesignNode;
  activeState: InteractiveStateId;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
}

const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

export function InspectorModernEffectsSection({
  selectedNode,
  activeState,
  onUpdateSelected,
  onCommitEdit,
}: InspectorModernEffectsSectionProps) {
  if (selectedNode.type === 'group') return null;

  const isPseudoState = activeState !== 'default';
  const pseudoKey = activeState as PseudoStateKey;
  const stateOverride = isPseudoState ? selectedNode.stateOverrides?.[pseudoKey] : undefined;

  const currentEffects: VisualEffect[] = Array.isArray(selectedNode.effects) ? selectedNode.effects : [];
  const activeDropShadow = currentEffects.find(
    (fx): fx is Extract<VisualEffect, { type: 'drop-shadow' }> => fx.type === 'drop-shadow' && fx.visible !== false,
  );
  const activeLayerBlur = currentEffects.find(
    (fx): fx is Extract<VisualEffect, { type: 'layer-blur' }> => fx.type === 'layer-blur' && fx.visible !== false,
  );
  const activeBackdropBlur = currentEffects.find(
    (fx): fx is Extract<VisualEffect, { type: 'backdrop-blur' }> => fx.type === 'backdrop-blur' && fx.visible !== false,
  );

  const shadowPreset = detectShadowPreset(currentEffects);
  const cssFilters: NodeCssFilters = selectedNode.cssFilters ?? {};

  const updateDropShadow = (patch: Partial<Extract<VisualEffect, { type: 'drop-shadow' }>>) => {
    const others = currentEffects.filter((fx) => fx.type !== 'drop-shadow');
    const base: Extract<VisualEffect, { type: 'drop-shadow' }> = activeDropShadow ?? {
      id: 'fx-shadow-custom',
      type: 'drop-shadow',
      x: 0,
      y: 8,
      blur: 20,
      spread: 0,
      color: 'rgba(15, 23, 42, 0.3)',
      visible: true,
    };
    onUpdateSelected({ effects: [{ ...base, ...patch }, ...others] });
    onCommitEdit();
  };

  const setBlurEffect = (type: 'layer-blur' | 'backdrop-blur', radius: number) => {
    const others = currentEffects.filter((fx) => fx.type !== type);
    if (radius <= 0) {
      onUpdateSelected({ effects: others.length > 0 ? others : undefined });
    } else {
      onUpdateSelected({
        effects: [...others, { id: `fx-${type}`, type, radius, visible: true }],
      });
    }
    onCommitEdit();
  };

  const updateCssFilters = (patch: Partial<NodeCssFilters>) => {
    const next: NodeCssFilters = { ...cssFilters, ...patch };
    if (next.brightness === 100) delete next.brightness;
    if (next.contrast === 100) delete next.contrast;
    if (next.saturate === 100) delete next.saturate;
    if (next.grayscale === 0) delete next.grayscale;
    onUpdateSelected({
      cssFilters: Object.keys(next).length > 0 ? next : undefined,
    });
    onCommitEdit();
  };

  const updateStateShadow = (preset: NodeStateOverride['shadowPreset']) => {
    if (!isPseudoState) return;
    const prevAll = selectedNode.stateOverrides ?? {};
    const nextState: NodeStateOverride = { ...(prevAll[pseudoKey] ?? {}), shadowPreset: preset };
    if (!preset) delete nextState.shadowPreset;
    const nextAll: Partial<Record<PseudoStateKey, NodeStateOverride>> = { ...prevAll };
    if (Object.keys(nextState).length === 0) delete nextAll[pseudoKey];
    else nextAll[pseudoKey] = nextState;
    onUpdateSelected({ stateOverrides: Object.keys(nextAll).length > 0 ? nextAll : undefined });
    onCommitEdit();
  };

  return (
    <div class="folio-effects-stack">
      {/* SHADOW PRESET + CUSTOM */}
      <div class="folio-prop-group">
        <span class="folio-prop-label">
          {isPseudoState && stateOverride?.shadowPreset !== undefined && (
            <span class="folio-override-dot" aria-hidden="true" />
          )}
          Box Shadow
        </span>
        {isPseudoState ? (
          <select
            class="select-field"
            aria-label="State shadow preset"
            value={stateOverride?.shadowPreset ?? ''}
            onChange={(e) => {
              const val = e.currentTarget.value;
              updateStateShadow(val ? (val as NodeStateOverride['shadowPreset']) : undefined);
            }}
          >
            <option value="">Inherit Base Shadow</option>
            <option value="none">None</option>
            <option value="soft">Soft</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard / Deep</option>
            <option value="neon-glow">Neon Glow (#00E5FF)</option>
          </select>
        ) : (
          <>
            <select
              class="select-field"
              aria-label="Shadow preset"
              value={shadowPreset}
              onChange={(event) => {
                const next = applyShadowPresetToEffects(currentEffects, event.currentTarget.value as ShadowPresetId);
                onUpdateSelected({ effects: next });
                onCommitEdit();
              }}
            >
              {SHADOW_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>

            {activeDropShadow && (
              <div class="folio-shadow-custom-box">
                <div class="folio-two-col">
                  <NumericUnitInput
                    label="X"
                    ariaLabel="Shadow X offset"
                    value={activeDropShadow.x}
                    unit="px"
                    units={['px']}
                    min={-120}
                    max={120}
                    allowNegative
                    onChange={(res) => updateDropShadow({ x: res.value })}
                  />
                  <NumericUnitInput
                    label="Y"
                    ariaLabel="Shadow Y offset"
                    value={activeDropShadow.y}
                    unit="px"
                    units={['px']}
                    min={-120}
                    max={120}
                    allowNegative
                    onChange={(res) => updateDropShadow({ y: res.value })}
                  />
                  <NumericUnitInput
                    label="Blur"
                    ariaLabel="Shadow blur"
                    value={activeDropShadow.blur}
                    unit="px"
                    units={['px']}
                    min={0}
                    max={160}
                    onChange={(res) => updateDropShadow({ blur: res.value })}
                  />
                  <NumericUnitInput
                    label="Spr"
                    ariaLabel="Shadow spread"
                    value={activeDropShadow.spread ?? 0}
                    unit="px"
                    units={['px']}
                    min={-60}
                    max={60}
                    allowNegative
                    onChange={(res) => updateDropShadow({ spread: res.value })}
                  />
                </div>
                <div class="folio-color-row">
                  <input
                    class="color-swatch"
                    type="color"
                    aria-label="Shadow color"
                    value={parseColorWithAlpha(activeDropShadow.color, '#0F172A').hex}
                    onInput={(e) => updateDropShadow({ color: e.currentTarget.value })}
                  />
                  <span class="folio-mini-label">{activeDropShadow.color}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* BLUR & GLASSMORPHISM */}
      {!isPseudoState && (
        <>
          <div class="folio-two-col">
            <NumericUnitInput
              label="Blur"
              ariaLabel="Layer blur"
              value={activeLayerBlur?.radius ?? 0}
              unit="px"
              units={['px']}
              min={0}
              max={80}
              presets={[
                { label: '0 px', value: 0, unit: 'px' },
                { label: '4 px', value: 4, unit: 'px' },
                { label: '12 px', value: 12, unit: 'px' },
                { label: '24 px', value: 24, unit: 'px' },
              ]}
              onChange={(res) => setBlurEffect('layer-blur', res.value)}
            />
            <NumericUnitInput
              label="Glass"
              ariaLabel="Backdrop blur"
              value={activeBackdropBlur?.radius ?? 0}
              unit="px"
              units={['px']}
              min={0}
              max={80}
              presets={[
                { label: '0 px', value: 0, unit: 'px' },
                { label: '8 px', value: 8, unit: 'px' },
                { label: '16 px', value: 16, unit: 'px' },
                { label: '28 px', value: 28, unit: 'px' },
              ]}
              onChange={(res) => setBlurEffect('backdrop-blur', res.value)}
            />
          </div>

          {/* BLEND MODE */}
          <div class="folio-prop-group">
            <span class="folio-prop-label">Blend Mode</span>
            <select
              class="select-field"
              aria-label="Blend mode"
              value={selectedNode.blendMode ?? 'normal'}
              onChange={(e) => {
                const mode = e.currentTarget.value as BlendMode;
                onUpdateSelected({ blendMode: mode === 'normal' ? undefined : mode });
                onCommitEdit();
              }}
            >
              {BLEND_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {BLEND_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>

          {/* CSS FILTERS */}
          <div class="folio-prop-group">
            <div class="folio-prop-header-row">
              <span class="folio-prop-label">CSS Filters</span>
              {selectedNode.cssFilters && (
                <button
                  type="button"
                  class="folio-chip-btn"
                  onClick={() => {
                    onUpdateSelected({ cssFilters: undefined });
                    onCommitEdit();
                  }}
                >
                  Reset
                </button>
              )}
            </div>
            <div class="folio-two-col">
              <NumericUnitInput
                label="Bri"
                ariaLabel="Filter brightness"
                value={cssFilters.brightness ?? 100}
                unit="%"
                units={['%']}
                min={0}
                max={250}
                step={5}
                onChange={(res) => updateCssFilters({ brightness: res.value })}
              />
              <NumericUnitInput
                label="Con"
                ariaLabel="Filter contrast"
                value={cssFilters.contrast ?? 100}
                unit="%"
                units={['%']}
                min={0}
                max={250}
                step={5}
                onChange={(res) => updateCssFilters({ contrast: res.value })}
              />
              <NumericUnitInput
                label="Sat"
                ariaLabel="Filter saturate"
                value={cssFilters.saturate ?? 100}
                unit="%"
                units={['%']}
                min={0}
                max={250}
                step={5}
                onChange={(res) => updateCssFilters({ saturate: res.value })}
              />
              <NumericUnitInput
                label="Gray"
                ariaLabel="Filter grayscale"
                value={cssFilters.grayscale ?? 0}
                unit="%"
                units={['%']}
                min={0}
                max={100}
                step={5}
                onChange={(res) => updateCssFilters({ grayscale: res.value })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

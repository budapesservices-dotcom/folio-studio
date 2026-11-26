import {
  BLEND_MODES,
  SHADOW_PRESETS,
  applyShadowPresetToEffects,
  detectShadowPreset,
  formatColorWithAlpha,
  parseColorWithAlpha,
  type ShadowPresetId,
} from '../../core/document/styling';
import type {
  AnimatableProperty,
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
  onUpdateSelected: (patch: Partial<DesignNode>, coalesceKey?: string) => void;
  onCommitEdit: () => void;
  onTogglePropertyKeyframe?: (nodeId: string, property: AnimatableProperty) => void;
  isPropertyKeyedAtPlayhead?: (nodeId: string, property: AnimatableProperty) => boolean;
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

interface KeyframeDiamondButtonProps {
  nodeId: string;
  property: AnimatableProperty;
  label: string;
  active: boolean;
  onToggle?: (nodeId: string, property: AnimatableProperty) => void;
}

function KeyframeDiamondButton({
  nodeId,
  property,
  label,
  active,
  onToggle,
}: KeyframeDiamondButtonProps) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      class={`folio-kf-diamond-btn${active ? ' is-active' : ''}`}
      aria-label={`${active ? 'Remove' : 'Add'} ${label} keyframe at playhead`}
      aria-pressed={active}
      data-keyframe-prop={property}
      title={active ? `Remove ${label} keyframe at playhead` : `Keyframe ${label} at playhead`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(nodeId, property);
      }}
    >
      <span class="folio-kf-diamond-glyph" aria-hidden="true" />
    </button>
  );
}

export function InspectorModernEffectsSection({
  selectedNode,
  activeState,
  onUpdateSelected,
  onCommitEdit,
  onTogglePropertyKeyframe,
  isPropertyKeyedAtPlayhead,
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
  const parsedShadowColor = parseColorWithAlpha(activeDropShadow?.color ?? 'rgba(15, 23, 42, 0.3)', '#0F172A');
  const shadowOpacityPct = Math.round(parsedShadowColor.alpha * 100);
  const isKeyed = (prop: AnimatableProperty): boolean =>
    Boolean(!isPseudoState && isPropertyKeyedAtPlayhead?.(selectedNode.id, prop));

  const updateDropShadow = (
    patch: Partial<Extract<VisualEffect, { type: 'drop-shadow' }>>,
    options?: { commit?: boolean; coalesceKey?: string },
  ) => {
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
    onUpdateSelected({ effects: [{ ...base, ...patch }, ...others] }, options?.coalesceKey);
    if (options?.commit !== false) onCommitEdit();
  };

  const setBlurEffect = (
    type: 'layer-blur' | 'backdrop-blur',
    radius: number,
    options?: { commit?: boolean; coalesceKey?: string },
  ) => {
    const clamped = Math.max(0, Math.min(80, Math.round(radius * 100) / 100));
    const others = currentEffects.filter((fx) => fx.type !== type);
    if (clamped <= 0) {
      onUpdateSelected({ effects: others.length > 0 ? others : undefined }, options?.coalesceKey);
    } else {
      onUpdateSelected(
        {
          effects: [...others, { id: `fx-${type}`, type, radius: clamped, visible: true }],
        },
        options?.coalesceKey,
      );
    }
    if (options?.commit !== false) onCommitEdit();
  };

  const updateCssFilters = (
    patch: Partial<NodeCssFilters>,
    options?: { commit?: boolean; coalesceKey?: string },
  ) => {
    const next: NodeCssFilters = { ...cssFilters, ...patch };
    if (next.brightness === 100) delete next.brightness;
    if (next.contrast === 100) delete next.contrast;
    if (next.saturate === 100) delete next.saturate;
    if (next.grayscale === 0) delete next.grayscale;
    onUpdateSelected(
      {
        cssFilters: Object.keys(next).length > 0 ? next : undefined,
      },
      options?.coalesceKey,
    );
    if (options?.commit !== false) onCommitEdit();
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
                  <div class="folio-kf-field-wrap">
                    <NumericUnitInput
                      label="X"
                      ariaLabel="Shadow X offset"
                      value={activeDropShadow.x}
                      unit="px"
                      units={['px']}
                      min={-120}
                      max={120}
                      allowNegative
                      onPreview={(res) => updateDropShadow({ x: res.value }, { commit: false, coalesceKey: 'shadowOffsetX' })}
                      onChange={(res) => updateDropShadow({ x: res.value }, { commit: true, coalesceKey: 'shadowOffsetX' })}
                    />
                    <KeyframeDiamondButton
                      nodeId={selectedNode.id}
                      property="shadowOffsetX"
                      label="Shadow X"
                      active={isKeyed('shadowOffsetX')}
                      onToggle={onTogglePropertyKeyframe}
                    />
                  </div>
                  <div class="folio-kf-field-wrap">
                    <NumericUnitInput
                      label="Y"
                      ariaLabel="Shadow Y offset"
                      value={activeDropShadow.y}
                      unit="px"
                      units={['px']}
                      min={-120}
                      max={120}
                      allowNegative
                      onPreview={(res) => updateDropShadow({ y: res.value }, { commit: false, coalesceKey: 'shadowOffsetY' })}
                      onChange={(res) => updateDropShadow({ y: res.value }, { commit: true, coalesceKey: 'shadowOffsetY' })}
                    />
                    <KeyframeDiamondButton
                      nodeId={selectedNode.id}
                      property="shadowOffsetY"
                      label="Shadow Y"
                      active={isKeyed('shadowOffsetY')}
                      onToggle={onTogglePropertyKeyframe}
                    />
                  </div>
                  <div class="folio-kf-field-wrap">
                    <NumericUnitInput
                      label="Blur"
                      ariaLabel="Shadow blur"
                      value={activeDropShadow.blur}
                      unit="px"
                      units={['px']}
                      min={0}
                      max={160}
                      onPreview={(res) => updateDropShadow({ blur: res.value }, { commit: false, coalesceKey: 'shadowBlur' })}
                      onChange={(res) => updateDropShadow({ blur: res.value }, { commit: true, coalesceKey: 'shadowBlur' })}
                    />
                    <KeyframeDiamondButton
                      nodeId={selectedNode.id}
                      property="shadowBlur"
                      label="Shadow Blur"
                      active={isKeyed('shadowBlur')}
                      onToggle={onTogglePropertyKeyframe}
                    />
                  </div>
                  <div class="folio-kf-field-wrap">
                    <NumericUnitInput
                      label="Spr"
                      ariaLabel="Shadow spread"
                      value={activeDropShadow.spread ?? 0}
                      unit="px"
                      units={['px']}
                      min={-60}
                      max={60}
                      allowNegative
                      onPreview={(res) => updateDropShadow({ spread: res.value }, { commit: false, coalesceKey: 'shadowSpread' })}
                      onChange={(res) => updateDropShadow({ spread: res.value }, { commit: true, coalesceKey: 'shadowSpread' })}
                    />
                    <KeyframeDiamondButton
                      nodeId={selectedNode.id}
                      property="shadowSpread"
                      label="Shadow Spread"
                      active={isKeyed('shadowSpread')}
                      onToggle={onTogglePropertyKeyframe}
                    />
                  </div>
                </div>
                <div class="folio-color-row">
                  <input
                    class="color-swatch"
                    type="color"
                    aria-label="Shadow color"
                    value={parsedShadowColor.hex}
                    onInput={(e) =>
                      updateDropShadow(
                        { color: formatColorWithAlpha(e.currentTarget.value, parsedShadowColor.alpha) },
                        { commit: false, coalesceKey: 'shadowColor' },
                      )
                    }
                    onPointerUp={onCommitEdit}
                    onBlur={onCommitEdit}
                  />
                  <span class="folio-mini-label">{`${parsedShadowColor.hex.toUpperCase()} · ${shadowOpacityPct}%`}</span>
                </div>
                <div class="folio-slider-inline-row">
                  <span class="folio-mini-label">Opacity</span>
                  <input
                    class="folio-range-slider"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="Shadow opacity slider"
                    value={shadowOpacityPct}
                    onInput={(e) => {
                      const pct = Math.min(100, Math.max(0, Number(e.currentTarget.value))) / 100;
                      updateDropShadow(
                        { color: formatColorWithAlpha(parsedShadowColor.hex, pct) },
                        { commit: false, coalesceKey: 'shadowOpacity' },
                      );
                    }}
                    onPointerUp={onCommitEdit}
                    onKeyUp={onCommitEdit}
                    onBlur={onCommitEdit}
                  />
                  <span class="folio-slider-readout">{`${shadowOpacityPct}%`}</span>
                  <KeyframeDiamondButton
                    nodeId={selectedNode.id}
                    property="shadowOpacity"
                    label="Shadow Opacity"
                    active={isKeyed('shadowOpacity')}
                    onToggle={onTogglePropertyKeyframe}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* BLUR & GLASSMORPHISM */}
      {!isPseudoState && (
        <>
          <div class="folio-prop-group">
            <div class="folio-slider-inline-row">
              <span class="folio-mini-label">Layer Blur</span>
              <input
                class="folio-range-slider"
                type="range"
                min="0"
                max="80"
                step="1"
                aria-label="Layer blur slider"
                value={Math.round(activeLayerBlur?.radius ?? 0)}
                onInput={(e) =>
                  setBlurEffect('layer-blur', Number(e.currentTarget.value), {
                    commit: false,
                    coalesceKey: 'layerBlur',
                  })
                }
                onPointerUp={onCommitEdit}
                onKeyUp={onCommitEdit}
                onBlur={onCommitEdit}
              />
              <span class="folio-slider-readout">{`${Math.round(activeLayerBlur?.radius ?? 0)}px`}</span>
              <KeyframeDiamondButton
                nodeId={selectedNode.id}
                property="layerBlur"
                label="Layer Blur"
                active={isKeyed('layerBlur')}
                onToggle={onTogglePropertyKeyframe}
              />
            </div>

            <div class="folio-slider-inline-row">
              <span class="folio-mini-label">Glass Blur</span>
              <input
                class="folio-range-slider"
                type="range"
                min="0"
                max="80"
                step="1"
                aria-label="Backdrop blur slider"
                value={Math.round(activeBackdropBlur?.radius ?? 0)}
                onInput={(e) =>
                  setBlurEffect('backdrop-blur', Number(e.currentTarget.value), {
                    commit: false,
                    coalesceKey: 'backdropBlur',
                  })
                }
                onPointerUp={onCommitEdit}
                onKeyUp={onCommitEdit}
                onBlur={onCommitEdit}
              />
              <span class="folio-slider-readout">{`${Math.round(activeBackdropBlur?.radius ?? 0)}px`}</span>
              <KeyframeDiamondButton
                nodeId={selectedNode.id}
                property="backdropBlur"
                label="Backdrop Blur"
                active={isKeyed('backdropBlur')}
                onToggle={onTogglePropertyKeyframe}
              />
            </div>

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
                onPreview={(res) => setBlurEffect('layer-blur', res.value, { commit: false, coalesceKey: 'layerBlur' })}
                onChange={(res) => setBlurEffect('layer-blur', res.value, { commit: true, coalesceKey: 'layerBlur' })}
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
                onPreview={(res) => setBlurEffect('backdrop-blur', res.value, { commit: false, coalesceKey: 'backdropBlur' })}
                onChange={(res) => setBlurEffect('backdrop-blur', res.value, { commit: true, coalesceKey: 'backdropBlur' })}
              />
            </div>
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
            <div class="folio-filter-sliders">
              {(
                [
                  { key: 'brightness', label: 'Brightness', min: 0, max: 250, def: 100 },
                  { key: 'contrast', label: 'Contrast', min: 0, max: 250, def: 100 },
                  { key: 'saturate', label: 'Saturate', min: 0, max: 250, def: 100 },
                  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, def: 0 },
                ] as const
              ).map((item) => {
                const val = cssFilters[item.key] ?? item.def;
                return (
                  <div key={item.key} class="folio-slider-inline-row">
                    <span class="folio-mini-label">{item.label}</span>
                    <input
                      class="folio-range-slider"
                      type="range"
                      min={item.min}
                      max={item.max}
                      step="1"
                      aria-label={`Filter ${item.key}`}
                      value={Math.round(val)}
                      onInput={(e) =>
                        updateCssFilters(
                          { [item.key]: Number(e.currentTarget.value) },
                          { commit: false, coalesceKey: item.key },
                        )
                      }
                      onPointerUp={onCommitEdit}
                      onKeyUp={onCommitEdit}
                      onBlur={onCommitEdit}
                    />
                    <span class="folio-slider-readout">{`${Math.round(val)}%`}</span>
                    <KeyframeDiamondButton
                      nodeId={selectedNode.id}
                      property={item.key}
                      label={item.label}
                      active={isKeyed(item.key)}
                      onToggle={onTogglePropertyKeyframe}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

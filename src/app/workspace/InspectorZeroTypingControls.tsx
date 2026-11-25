import {
  formatColorWithAlpha,
  isTransparentColor,
  parseColorWithAlpha,
} from '../../core/document/styling';
import type { DesignTokenCollection } from '../../core/document/types';

export interface PresetStepperSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  presets: readonly number[];
  ariaLabel?: string;
  onChange: (nextValue: number) => void;
  onCommit?: () => void;
}

export function PresetStepperSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'px',
  presets,
  ariaLabel,
  onChange,
  onCommit,
}: PresetStepperSliderProps) {
  const safeVal = Number.isFinite(value) ? value : min;
  const clampedSlider = Math.min(max, Math.max(min, safeVal));
  const roundedDisplay = Math.round(safeVal * 100) / 100;
  const matchingPreset = presets.find((preset) => Math.abs(preset - roundedDisplay) < 0.01);

  const applyValue = (next: number, commit = false) => {
    const bounded = Math.min(max, Math.max(min, Math.round(next * 100) / 100));
    onChange(bounded);
    if (commit) onCommit?.();
  };

  return (
    <div class="zt-control">
      <div class="zt-control-header">
        <span class="zt-control-label">{label}</span>
        <div class="zt-control-right">
          <select
            class="zt-preset-select"
            aria-label={`${ariaLabel ?? label} preset`}
            value={matchingPreset !== undefined ? String(matchingPreset) : '__custom__'}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (raw === '__custom__') return;
              const num = Number(raw);
              if (Number.isFinite(num)) applyValue(num, true);
            }}
          >
            {matchingPreset === undefined && (
              <option value="__custom__">
                {roundedDisplay}
                {unit}
              </option>
            )}
            {presets.map((preset) => (
              <option key={preset} value={String(preset)}>
                {preset}
                {unit}
              </option>
            ))}
          </select>
          <div class="zt-stepper-group">
            <button
              type="button"
              class="zt-stepper-btn"
              aria-label={`Decrease ${ariaLabel ?? label}`}
              onClick={() => applyValue(safeVal - step, true)}
            >
              −
            </button>
            <span class="zt-value-readout" aria-live="polite">
              {roundedDisplay}
              {unit}
            </span>
            <button
              type="button"
              class="zt-stepper-btn"
              aria-label={`Increase ${ariaLabel ?? label}`}
              onClick={() => applyValue(safeVal + step, true)}
            >
              +
            </button>
          </div>
        </div>
      </div>
      <input
        type="range"
        class="zt-range-slider"
        aria-label={ariaLabel ?? label}
        min={min}
        max={max}
        step={step}
        value={clampedSlider}
        style={{
          '--slider-pct': `${Math.max(0, Math.min(100, ((clampedSlider - min) / Math.max(1e-6, max - min)) * 100))}%`,
        } as Record<string, string>}
        onInput={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
        onBlur={() => onCommit?.()}
      />
    </div>
  );
}

export const QUICK_COLOR_SWATCHES = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#F43F5E',
  '#06B6D4',
  '#FFFFFF',
  '#94A3B8',
  '#0F172A',
] as const;

export interface VisualColorAlphaControlProps {
  label: string;
  value: string;
  fallbackHex?: string;
  boundTokenId?: string;
  designTokens: DesignTokenCollection;
  onChangeColor: (nextColor: string) => void;
  onBindToken?: (tokenId: string | undefined) => void;
  onCommit?: () => void;
}

export function VisualColorAlphaControl({
  label,
  value,
  fallbackHex = '#3B82F6',
  boundTokenId,
  designTokens,
  onChangeColor,
  onBindToken,
  onCommit,
}: VisualColorAlphaControlProps) {
  const transparent = isTransparentColor(value);
  const parsed = parseColorWithAlpha(value, fallbackHex);
  const alphaPercent = Math.round(parsed.alpha * 100);
  const colorTokens = designTokens.tokens.filter((token) => token.category === 'color');

  const handleHexChange = (nextHex: string) => {
    const nextAlpha = transparent ? 1 : parsed.alpha;
    onChangeColor(formatColorWithAlpha(nextHex, nextAlpha));
  };

  const handleAlphaChange = (percent: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    if (clamped === 0) {
      onChangeColor('transparent');
      return;
    }
    const baseHex = parsed.hex || fallbackHex;
    onChangeColor(formatColorWithAlpha(baseHex, clamped / 100));
  };

  return (
    <div class="zt-color-block">
      <div class="zt-color-top-row">
        <span class="zt-control-label">{label}</span>
        <div class="zt-color-actions">
          <label class="zt-color-swatch-picker" title={`Pick ${label.toLowerCase()} color`}>
            <span
              class={`zt-color-swatch-preview${transparent ? ' is-transparent' : ''}`}
              style={transparent ? undefined : { background: value }}
            />
            <input
              type="color"
              class="zt-color-native-input"
              aria-label={`${label} color picker`}
              value={parsed.hex}
              onInput={(event) => handleHexChange(event.currentTarget.value)}
              onPointerUp={() => onCommit?.()}
              onKeyUp={() => onCommit?.()}
              onBlur={() => onCommit?.()}
            />
          </label>
          <span class="zt-color-badge" title={value}>
            {transparent ? 'NONE' : `${parsed.hex.toUpperCase()} · ${alphaPercent}%`}
          </span>
          <button
            type="button"
            class={`zt-none-btn${transparent ? ' is-active' : ''}`}
            aria-pressed={transparent}
            title={`Set ${label.toLowerCase()} to Transparent / None`}
            onClick={() => {
              onChangeColor(transparent ? fallbackHex : 'transparent');
              onCommit?.();
            }}
          >
            {transparent ? 'Restore' : 'None'}
          </button>
        </div>
      </div>

      <div class="zt-alpha-row">
        <span class="zt-alpha-label">Alpha</span>
        <div
          class="zt-alpha-track-wrap"
          style={{
            '--zt-alpha-color': parsed.hex,
          } as Record<string, string>}
        >
          <input
            type="range"
            class="zt-alpha-slider"
            aria-label={`${label} opacity alpha`}
            min={0}
            max={100}
            step={1}
            value={alphaPercent}
            style={{ '--slider-pct': `${alphaPercent}%` } as Record<string, string>}
            onInput={(event) => handleAlphaChange(Number(event.currentTarget.value))}
            onPointerUp={() => onCommit?.()}
            onKeyUp={() => onCommit?.()}
            onBlur={() => onCommit?.()}
          />
        </div>
        <span class="zt-value-readout">{alphaPercent}%</span>
      </div>

      <div class="zt-swatch-strip" role="group" aria-label={`${label} quick swatches`}>
        {QUICK_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            class={`zt-swatch-chip${!transparent && parsed.hex.toUpperCase() === swatch ? ' is-active' : ''}`}
            style={{ background: swatch }}
            title={`Apply ${swatch}`}
            aria-label={`Apply ${label.toLowerCase()} ${swatch}`}
            onClick={() => {
              onChangeColor(formatColorWithAlpha(swatch, transparent ? 1 : parsed.alpha));
              onCommit?.();
            }}
          />
        ))}
        {onBindToken && colorTokens.length > 0 && (
          <select
            class="zt-token-select"
            aria-label={`Bind ${label.toLowerCase()} design token`}
            value={boundTokenId ?? ''}
            onChange={(event) => {
              const nextTokenId = event.currentTarget.value || undefined;
              onBindToken(nextTokenId);
              onCommit?.();
            }}
          >
            <option value="">Token…</option>
            {colorTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

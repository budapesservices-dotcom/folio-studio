import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CSS_KEYWORD_UNITS,
  isCssLengthUnit,
  parseNumericUnitInput,
  roundNumericValue,
  type CssKeywordUnit,
  type CssLengthUnit,
  type CssUnitOption,
} from '../../core/document/cssUnits';

export interface NumericUnitPreset {
  readonly label: string;
  readonly value: number;
  readonly unit?: CssLengthUnit;
  readonly keyword?: CssKeywordUnit;
}

export interface NumericUnitCommitPayload {
  readonly kind: 'numeric' | 'keyword';
  readonly value: number;
  readonly unit: CssUnitOption;
}

export interface NumericUnitInputProps {
  /** Short scrubbable label shown on the left (e.g. "W", "H", "Gap", "R"). */
  label: string;
  ariaLabel: string;
  /** Current committed numeric value (used when unit is numeric). */
  value: number;
  /** Current active unit or keyword ('px', '%', 'vw', 'vh', 'dvh', 'rem', 'em', 'fr', 'deg', 'ms', 's', '', 'auto', 'fit', 'fill'). */
  unit: CssUnitOption;
  /** Pinned dropdown units allowed for this property. */
  units: readonly CssUnitOption[];
  /** Optional quick presets dropdown button. */
  presets?: readonly NumericUnitPreset[];
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  allowNegative?: boolean;
  disabled?: boolean;
  /** Displays Folio cyan (#00E5FF) indicator dot when overridden on active state/breakpoint. */
  hasOverrideDot?: boolean;
  /** Optional live preview callback during label drag/scrub (must not push history per frame). */
  onPreview?: (payload: NumericUnitCommitPayload) => void;
  /** Called once on atomic commit (Enter, blur, preset pick, unit switch, or scrub end). */
  onChange: (payload: NumericUnitCommitPayload) => void;
  /** Optional explicit history commit callback invoked immediately after atomic onChange. */
  onCommit?: () => void;
}

function formatUnitLabel(unit: CssUnitOption): string {
  if (unit === '') return '—';
  if (unit === 'fit') return 'Fit';
  if (unit === 'fill') return 'Fill';
  if (unit === 'auto') return 'Auto';
  return unit;
}

function isKeywordUnit(unit: CssUnitOption): unit is CssKeywordUnit {
  return CSS_KEYWORD_UNITS.has(unit);
}

/**
 * Folio Standard Hybrid Numeric + Pinned Unit Input (Part A):
 * [ Scrubbable Label + Numeric Input | Optional Preset Dropdown | Pinned Unit Dropdown ]
 *
 * - Never fires Native Command mutations per keystroke.
 * - Commits 1 atomic update on Enter, blur, preset select, unit switch, or scrub release.
 * - Supports smart-paste ("100vh", "50%"), inline math ("100/3" -> 33.33), and safe invalid revert.
 */
export function NumericUnitInput({
  label,
  ariaLabel,
  value,
  unit,
  units,
  presets,
  min,
  max,
  step = 1,
  precision = 2,
  allowNegative,
  disabled = false,
  hasOverrideDot = false,
  onPreview,
  onChange,
  onCommit,
}: NumericUnitInputProps) {
  const isKeyword = isKeywordUnit(unit);
  const formattedCommitted = isKeyword ? formatUnitLabel(unit) : String(roundNumericValue(value, precision));

  const [draft, setDraft] = useState<string>(formattedCommitted);
  const [isEditing, setIsEditing] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const invalidTimerRef = useRef<number | null>(null);
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    lastValue: number;
    moved: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(formattedCommitted);
    }
  }, [formattedCommitted, isEditing]);

  useEffect(() => {
    return () => {
      if (invalidTimerRef.current !== null) {
        window.clearTimeout(invalidTimerRef.current);
      }
    };
  }, []);

  const flashInvalid = () => {
    setIsInvalid(true);
    if (invalidTimerRef.current !== null) {
      window.clearTimeout(invalidTimerRef.current);
    }
    invalidTimerRef.current = window.setTimeout(() => {
      setIsInvalid(false);
      invalidTimerRef.current = null;
    }, 900);
  };

  const commitDraft = (rawText: string) => {
    setIsEditing(false);
    const trimmed = rawText.trim();
    if (!trimmed) {
      setDraft(formattedCommitted);
      return;
    }

    const parsed = parseNumericUnitInput(trimmed, {
      allowedUnits: units,
      fallbackUnit: isCssLengthUnit(unit) ? unit : (units.find(isCssLengthUnit) ?? 'px'),
      min,
      max,
      allowNegative,
      precision,
    });

    if (!parsed.ok) {
      setDraft(formattedCommitted);
      flashInvalid();
      return;
    }

    if (parsed.kind === 'keyword') {
      setDraft(formatUnitLabel(parsed.keyword));
      if (parsed.keyword !== unit) {
        onChange({ kind: 'keyword', value, unit: parsed.keyword });
        onCommit?.();
      }
      return;
    }

    const nextText = String(parsed.value);
    setDraft(nextText);
    const changed =
      isKeyword ||
      Math.abs(parsed.value - value) > 1e-6 ||
      parsed.unit !== unit;
    if (changed) {
      onChange({ kind: 'numeric', value: parsed.value, unit: parsed.unit });
      onCommit?.();
    }
  };

  const handleUnitSelect = (nextUnitRaw: string) => {
    const nextUnit = nextUnitRaw as CssUnitOption;
    if (!units.includes(nextUnit) || nextUnit === unit) return;

    if (isKeywordUnit(nextUnit)) {
      setDraft(formatUnitLabel(nextUnit));
      onChange({ kind: 'keyword', value, unit: nextUnit });
      onCommit?.();
      return;
    }

    // Switching from keyword or another unit to a numeric unit keeps a sensible positive value
    const nextVal = Number.isFinite(value)
      ? roundNumericValue(
          Math.max(
            min ?? -Infinity,
            Math.min(max ?? Infinity, value),
          ),
          precision,
        )
      : 0;
    setDraft(String(nextVal));
    onChange({ kind: 'numeric', value: nextVal, unit: nextUnit });
    onCommit?.();
  };

  const handlePresetPick = (preset: NumericUnitPreset) => {
    setPresetsOpen(false);
    if (preset.keyword) {
      setDraft(formatUnitLabel(preset.keyword));
      onChange({ kind: 'keyword', value: preset.value, unit: preset.keyword });
      onCommit?.();
      return;
    }
    const targetUnit: CssLengthUnit =
      preset.unit ?? (isCssLengthUnit(unit) ? unit : (units.find(isCssLengthUnit) ?? 'px'));
    const nextVal = roundNumericValue(preset.value, precision);
    setDraft(String(nextVal));
    onChange({ kind: 'numeric', value: nextVal, unit: targetUnit });
    onCommit?.();
  };

  const handleScrubPointerDown = (event: PointerEvent) => {
    if (disabled || event.button !== 0) return;
    const numericUnit = isCssLengthUnit(unit) ? unit : units.find(isCssLengthUnit);
    if (numericUnit === undefined) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    scrubRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: Number.isFinite(value) ? value : 0,
      lastValue: Number.isFinite(value) ? value : 0,
      moved: false,
    };
  };

  const handleScrubPointerMove = (event: PointerEvent) => {
    const state = scrubRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < 2) return;
    state.moved = true;

    const multiplier = event.shiftKey ? step * 10 : event.altKey ? step * 0.1 : step;
    const rawNext = state.startValue + Math.round(dx / 2) * multiplier;
    const effectiveMin = min ?? (allowNegative ? -Infinity : 0);
    const effectiveMax = max ?? Infinity;
    const clamped = roundNumericValue(Math.max(effectiveMin, Math.min(effectiveMax, rawNext)), precision);

    if (Math.abs(clamped - state.lastValue) < 1e-6) return;
    state.lastValue = clamped;
    setDraft(String(clamped));

    const numericUnit = isCssLengthUnit(unit) ? unit : (units.find(isCssLengthUnit) ?? 'px');
    const payload: NumericUnitCommitPayload = { kind: 'numeric', value: clamped, unit: numericUnit };
    if (onPreview) {
      onPreview(payload);
    } else {
      onChange(payload);
    }
  };

  const handleScrubPointerUp = (event: PointerEvent) => {
    const state = scrubRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);

    if (!state.moved) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }

    const numericUnit = isCssLengthUnit(unit) ? unit : (units.find(isCssLengthUnit) ?? 'px');
    onChange({ kind: 'numeric', value: state.lastValue, unit: numericUnit });
    onCommit?.();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft(draft);
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsEditing(false);
      setDraft(formattedCommitted);
      (event.currentTarget as HTMLInputElement).blur();
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !isKeyword) {
      event.preventDefault();
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? step * 10 : step);
      const effectiveMin = min ?? (allowNegative ? -Infinity : 0);
      const effectiveMax = max ?? Infinity;
      const nextVal = roundNumericValue(Math.max(effectiveMin, Math.min(effectiveMax, value + delta)), precision);
      setDraft(String(nextVal));
      setIsEditing(false);
      onChange({ kind: 'numeric', value: nextVal, unit });
      onCommit?.();
    }
  };

  return (
    <div
      class={`folio-num-unit${isInvalid ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}${hasOverrideDot ? ' has-override' : ''}`}
      data-numeric-unit-input={ariaLabel}
    >
      <span
        class="folio-num-unit-label"
        title={`Drag horizontally to scrub ${ariaLabel}`}
        onPointerDown={handleScrubPointerDown}
        onPointerMove={handleScrubPointerMove}
        onPointerUp={handleScrubPointerUp}
        onPointerCancel={handleScrubPointerUp}
      >
        {hasOverrideDot && <span class="folio-override-dot" aria-hidden="true" />}
        {label}
      </span>

      <input
        ref={inputRef}
        class="folio-num-unit-field"
        type="text"
        inputMode="decimal"
        spellcheck={false}
        autocomplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft}
        onFocus={(event) => {
          setIsEditing(true);
          setPresetsOpen(false);
          event.currentTarget.select();
        }}
        onInput={(event) => {
          setIsEditing(true);
          setDraft(event.currentTarget.value);
        }}
        onBlur={(event) => {
          if (isEditing) {
            commitDraft(event.currentTarget.value);
          }
        }}
        onKeyDown={handleKeyDown}
      />

      {presets && presets.length > 0 && (
        <div class="folio-num-unit-preset-wrap">
          <button
            type="button"
            class="folio-num-unit-preset-btn"
            aria-label={`${ariaLabel} presets`}
            title={`Quick presets for ${ariaLabel}`}
            disabled={disabled}
            onClick={() => setPresetsOpen((open) => !open)}
          >
            ▾
          </button>
          {presetsOpen && (
            <div class="folio-num-unit-preset-menu" role="listbox" aria-label={`${ariaLabel} preset options`}>
              {presets.map((preset) => (
                <button
                  key={`${preset.label}-${preset.value}-${preset.unit ?? preset.keyword ?? ''}`}
                  type="button"
                  class="folio-num-unit-preset-item"
                  onClick={() => handlePresetPick(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {units.length > 1 ? (
        <select
          class="folio-num-unit-select"
          aria-label={`${ariaLabel} unit`}
          disabled={disabled}
          value={unit}
          onChange={(event) => handleUnitSelect(event.currentTarget.value)}
        >
          {units.map((u) => (
            <option key={u || 'unitless'} value={u}>
              {formatUnitLabel(u)}
            </option>
          ))}
        </select>
      ) : (
        <span class="folio-num-unit-pinned-badge" aria-label={`${ariaLabel} unit`}>
          {formatUnitLabel(units[0] ?? unit)}
        </span>
      )}
    </div>
  );
}

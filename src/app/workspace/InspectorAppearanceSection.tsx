import { useState } from 'preact/hooks';
import {
  isSafeCssColorString,
  type CssLengthUnit,
} from '../../core/document/cssUnits';
import {
  convertLinearGradientTransitionStyle,
  detectLinearGradientTransitionStyle,
} from '../../core/document/colorBlend';
import {
  createDefaultLinearGradientFill,
  createDefaultRadialGradientFill,
  formatColorWithAlpha,
  getVisibleFillPaints,
  isTransparentColor,
  parseColorWithAlpha,
} from '../../core/document/styling';
import type {
  BorderLineStyle,
  BorderSidesConfig,
  BorderSideStyle,
  CornerRadiiConfig,
  DesignNode,
  DesignTokenCollection,
  FillPaint,
  ImageFitMode,
  InteractiveStateId,
  NodeStateOverride,
  PseudoStateKey,
  StrokeAlign,
} from '../../core/document/types';
import { NumericUnitInput } from './NumericUnitInput';

export interface InspectorAppearanceSectionProps {
  selectedNode: DesignNode;
  activeState: InteractiveStateId;
  designTokens: DesignTokenCollection;
  defaultFillColor: string;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, unknown>) => void;
  onCommitEdit: () => void;
}

const RADIUS_PRESETS = [
  { label: 'Sharp (0)', value: 0, unit: 'px' as const },
  { label: 'Soft (8)', value: 8, unit: 'px' as const },
  { label: 'Card (16)', value: 16, unit: 'px' as const },
  { label: 'Pill (9999)', value: 9999, unit: 'px' as const },
];

const BORDER_WIDTH_PRESETS = [
  { label: '0 px', value: 0, unit: 'px' as const },
  { label: '1 px', value: 1, unit: 'px' as const },
  { label: '2 px', value: 2, unit: 'px' as const },
  { label: '4 px', value: 4, unit: 'px' as const },
];

const STROKE_STYLE_DASH: Record<BorderLineStyle, string | undefined> = {
  solid: undefined,
  dashed: '8 5',
  dotted: '2 4',
};

type BorderSideKey = 'top' | 'right' | 'bottom' | 'left';
const BORDER_SIDES: ReadonlyArray<{ key: BorderSideKey; label: string }> = [
  { key: 'top', label: 'T' },
  { key: 'right', label: 'R' },
  { key: 'bottom', label: 'B' },
  { key: 'left', label: 'L' },
];

export function InspectorAppearanceSection({
  selectedNode,
  activeState,
  designTokens,
  defaultFillColor,
  onUpdateSelected,
  onUpdateSelectedStyle,
  onCommitEdit,
}: InspectorAppearanceSectionProps) {
  const isShape = selectedNode.type === 'rect' || selectedNode.type === 'frame' || selectedNode.type === 'ellipse';
  const isPath = selectedNode.type === 'path';
  const isImage = selectedNode.type === 'image';
  const isText = selectedNode.type === 'text';

  const hasPerSideBorders = Boolean(
    (isShape || isImage) && selectedNode.style.borderSides && Object.keys(selectedNode.style.borderSides).length > 0,
  );
  const hasPerCornerRadii = Boolean((isShape || isImage) && selectedNode.style.cornerRadii);

  const [borderMode, setBorderMode] = useState<'all' | 'per-side'>(hasPerSideBorders ? 'per-side' : 'all');
  const [activeSide, setActiveSide] = useState<BorderSideKey>('top');
  const [radiusMode, setRadiusMode] = useState<'uniform' | 'per-corner'>(hasPerCornerRadii ? 'per-corner' : 'uniform');
  const [fillPasteDraft, setFillPasteDraft] = useState<string | null>(null);
  const [strokePasteDraft, setStrokePasteDraft] = useState<string | null>(null);

  if (selectedNode.type === 'group' || selectedNode.type === 'component-instance') {
    return null;
  }

  const isPseudoState = activeState !== 'default';
  const pseudoKey = activeState as PseudoStateKey;
  const activeStateOverride: NodeStateOverride | undefined = isPseudoState
    ? selectedNode.stateOverrides?.[pseudoKey]
    : undefined;

  const updatePseudoOverride = (patch: Partial<NodeStateOverride>) => {
    if (!isPseudoState) return;
    const prevAll = selectedNode.stateOverrides ?? {};
    const nextState: NodeStateOverride = { ...(prevAll[pseudoKey] ?? {}), ...patch };
    for (const [k, v] of Object.entries(nextState)) {
      if (v === undefined) delete (nextState as Record<string, unknown>)[k];
    }
    const nextAll: Partial<Record<PseudoStateKey, NodeStateOverride>> = { ...prevAll };
    if (Object.keys(nextState).length === 0) {
      delete nextAll[pseudoKey];
    } else {
      nextAll[pseudoKey] = nextState;
    }
    onUpdateSelected({
      stateOverrides: Object.keys(nextAll).length > 0 ? nextAll : undefined,
    });
    onCommitEdit();
  };

  const colorTokens = designTokens.tokens.filter((t) => t.category === 'color');
  const radiusTokens = designTokens.tokens.filter((t) => t.category === 'radius');

  const rawFill = isPseudoState && activeStateOverride?.fill !== undefined
    ? activeStateOverride.fill
    : (isImage ? 'transparent' : selectedNode.style.fill);
  const parsedFill = parseColorWithAlpha(rawFill, defaultFillColor || '#00E5FF');

  const currentFills: FillPaint[] = isShape || isPath
    ? (Array.isArray(selectedNode.style.fills) ? selectedNode.style.fills : getVisibleFillPaints(selectedNode))
    : [];
  const activeGradient = currentFills.find(
    (p): p is Extract<FillPaint, { type: 'linear-gradient' | 'radial-gradient' }> =>
      p.visible !== false && (p.type === 'linear-gradient' || p.type === 'radial-gradient'),
  );
  const fillKind: 'solid' | 'linear-gradient' | 'radial-gradient' = activeGradient?.type ?? 'solid';

  const commitFillColor = (nextColor: string, commit = true) => {
    if (isPseudoState) {
      updatePseudoOverride({ fill: nextColor });
      return;
    }
    if (isShape || isPath) {
      onUpdateSelectedStyle({
        fill: nextColor,
        fills: [{ id: 'fill-base', type: 'solid', color: nextColor, opacity: 1, visible: true }],
      });
    } else if (isText) {
      onUpdateSelectedStyle({ fill: nextColor });
    }
    if (commit) onCommitEdit();
  };

  const switchFillKind = (kind: 'solid' | 'linear-gradient' | 'radial-gradient') => {
    if (!isShape && !isPath) return;
    if (kind === 'solid') {
      const baseHex = activeGradient?.stops[0]?.color ?? parsedFill.hex;
      onUpdateSelectedStyle({
        fill: baseHex,
        fills: [{ id: 'fill-base', type: 'solid', color: baseHex, opacity: 1, visible: true }],
      });
    } else if (kind === 'linear-gradient') {
      const grad = createDefaultLinearGradientFill('fill-grad');
      grad.stops[0] = { offset: 0, color: parsedFill.hex, opacity: 1 };
      onUpdateSelectedStyle({ fill: grad.stops[0].color, fills: [grad] });
    } else {
      const grad = createDefaultRadialGradientFill('fill-grad');
      grad.stops[0] = { offset: 0, color: parsedFill.hex, opacity: 1 };
      onUpdateSelectedStyle({ fill: grad.stops[0].color, fills: [grad] });
    }
    onCommitEdit();
  };

  const updateGradient = (updater: (g: Extract<FillPaint, { type: 'linear-gradient' | 'radial-gradient' }>) => FillPaint) => {
    if (!activeGradient) return;
    const nextFills = currentFills.map((p) => (p.id === activeGradient.id ? updater(activeGradient) : p));
    onUpdateSelectedStyle({ fills: nextFills });
    onCommitEdit();
  };

  // Stroke / Border state
  const supportsBorder = isShape || isPath || isImage;
  const rawStroke = isPseudoState && activeStateOverride?.stroke !== undefined
    ? activeStateOverride.stroke
    : (supportsBorder ? (selectedNode.style.stroke ?? 'none') : 'none');
  const rawStrokeWidth = isPseudoState && activeStateOverride?.strokeWidth !== undefined
    ? activeStateOverride.strokeWidth
    : (supportsBorder ? (selectedNode.style.strokeWidth ?? 0) : 0);
  const strokeWidthUnit: CssLengthUnit =
    (isShape || isImage) && selectedNode.style.strokeWidthUnit ? selectedNode.style.strokeWidthUnit : 'px';
  const strokeStyle: BorderLineStyle =
    (isShape || isImage) && selectedNode.style.strokeStyle
      ? selectedNode.style.strokeStyle
      : (isShape || isPath) && selectedNode.style.strokeDasharray
        ? (selectedNode.style.strokeDasharray.startsWith('2') ? 'dotted' : 'dashed')
        : 'solid';
  const parsedStroke = parseColorWithAlpha(rawStroke, '#4A5568');
  const strokeAlphaPct = Math.round(parsedStroke.alpha * 100);
  const strokeIsLegacyKeyword = rawStroke.trim().toLowerCase() === 'none' || rawStroke.trim().toLowerCase() === 'transparent';

  const commitStrokeColor = (nextColor: string, commit = true) => {
    if (isPseudoState) {
      updatePseudoOverride({ stroke: nextColor });
      return;
    }
    onUpdateSelectedStyle({
      stroke: nextColor,
      strokeWidth: rawStrokeWidth <= 0 ? 1 : rawStrokeWidth,
    });
    if (commit) onCommitEdit();
  };

  const currentBorderSides: BorderSidesConfig = (isShape || isImage) ? (selectedNode.style.borderSides ?? {}) : {};
  const activeSideCfg: BorderSideStyle = currentBorderSides[activeSide] ?? {
    width: 0,
    widthUnit: 'px',
    color: parsedStroke.hex,
    style: 'solid',
  };

  const updateSideBorder = (side: BorderSideKey, patch: Partial<BorderSideStyle>) => {
    if (!isShape && !isImage) return;
    const existing = currentBorderSides[side] ?? {
      width: 1,
      widthUnit: 'px',
      color: parsedStroke.hex,
      style: 'solid' as const,
    };
    const nextSide: BorderSideStyle = { ...existing, ...patch };
    const nextSides: BorderSidesConfig = { ...currentBorderSides };
    if (nextSide.width <= 0 || isTransparentColor(nextSide.color)) {
      delete nextSides[side];
    } else {
      nextSides[side] = nextSide;
    }
    onUpdateSelectedStyle({
      borderSides: Object.keys(nextSides).length > 0 ? nextSides : undefined,
    });
    onCommitEdit();
  };

  // Radius state
  const supportsRadius = selectedNode.type === 'rect' || selectedNode.type === 'frame' || isImage;
  const currentRadius = isPseudoState && activeStateOverride?.radius !== undefined
    ? activeStateOverride.radius
    : (supportsRadius ? (selectedNode.style.radius ?? 0) : 0);
  const currentRadiusUnit: CssLengthUnit =
    supportsRadius && selectedNode.style.radiusUnit ? selectedNode.style.radiusUnit : 'px';
  const currentCornerRadii: CornerRadiiConfig =
    supportsRadius && selectedNode.style.cornerRadii
      ? selectedNode.style.cornerRadii
      : {
          topLeft: currentRadius,
          topRight: currentRadius,
          bottomRight: currentRadius,
          bottomLeft: currentRadius,
        };

  return (
    <div class="folio-appearance-stack">
      {/* IMAGE FIT */}
      {isImage && !isPseudoState && (
        <div class="folio-prop-group">
          <span class="folio-prop-label">Image Fit</span>
          <div class="folio-seg-3" role="group" aria-label="Image object-fit mode">
            {(['cover', 'contain', 'fill'] as ImageFitMode[]).map((fit) => (
              <button
                key={fit}
                type="button"
                class={`folio-seg-btn${selectedNode.style.fit === fit ? ' is-active' : ''}`}
                onClick={() => {
                  onUpdateSelectedStyle({ fit });
                  onCommitEdit();
                }}
              >
                {fit === 'cover' ? 'Cover' : fit === 'contain' ? 'Contain' : 'Fill'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FILL */}
      {!isImage && (
        <div class="folio-prop-group">
          <div class="folio-prop-header-row">
            <span class="folio-prop-label">
              {isPseudoState && activeStateOverride?.fill !== undefined && (
                <span class="folio-override-dot" aria-hidden="true" />
              )}
              {isText ? 'Text Color' : 'Fill'}
            </span>
            <div class="folio-inline-actions">
              {(isShape || isPath) && !isPseudoState && (
                <div class="folio-mini-seg" role="group" aria-label="Fill type">
                  <button
                    type="button"
                    class={`folio-mini-seg-btn${fillKind === 'solid' ? ' is-active' : ''}`}
                    onClick={() => switchFillKind('solid')}
                  >
                    Solid
                  </button>
                  <button
                    type="button"
                    class={`folio-mini-seg-btn${fillKind === 'linear-gradient' ? ' is-active' : ''}`}
                    onClick={() => switchFillKind('linear-gradient')}
                  >
                    Linear
                  </button>
                  <button
                    type="button"
                    class={`folio-mini-seg-btn${fillKind === 'radial-gradient' ? ' is-active' : ''}`}
                    onClick={() => switchFillKind('radial-gradient')}
                  >
                    Radial
                  </button>
                </div>
              )}
            </div>
          </div>

          {fillKind === 'solid' || isPseudoState || isText ? (
            <>
              <div class="folio-color-row">
                <input
                  class="color-swatch"
                  type="color"
                  aria-label="Fill color picker"
                  value={parsedFill.hex}
                  onInput={(event) => {
                    const isLegacyNone = rawFill.trim().toLowerCase() === 'transparent' || rawFill.trim().toLowerCase() === 'none';
                    const alpha = isLegacyNone ? 1 : parsedFill.alpha;
                    commitFillColor(formatColorWithAlpha(event.currentTarget.value, alpha), false);
                  }}
                  onPointerUp={onCommitEdit}
                  onBlur={onCommitEdit}
                />
                <input
                  class="folio-color-paste-input"
                  type="text"
                  aria-label="Fill hex or CSS color"
                  placeholder="#00E5FF / rgba(...) / var(--...)"
                  value={fillPasteDraft ?? rawFill}
                  onFocus={(e) => setFillPasteDraft(e.currentTarget.value)}
                  onInput={(e) => setFillPasteDraft(e.currentTarget.value)}
                  onBlur={(e) => {
                    const val = e.currentTarget.value.trim();
                    setFillPasteDraft(null);
                    if (val && isSafeCssColorString(val)) {
                      commitFillColor(val, true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = e.currentTarget.value.trim();
                      setFillPasteDraft(null);
                      if (val && isSafeCssColorString(val)) {
                        commitFillColor(val, true);
                      }
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setFillPasteDraft(null);
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>

              <div class="folio-slider-inline-row">
                <span class="folio-mini-label">Fill Opacity</span>
                <input
                  class="folio-range-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Fill opacity slider"
                  value={Math.round(parsedFill.alpha * 100)}
                  onInput={(event) => {
                    const pct = Math.min(100, Math.max(0, Number(event.currentTarget.value))) / 100;
                    commitFillColor(formatColorWithAlpha(parsedFill.hex, pct), false);
                  }}
                  onPointerUp={onCommitEdit}
                  onKeyUp={onCommitEdit}
                  onBlur={onCommitEdit}
                />
                <span class="folio-slider-readout">{`${Math.round(parsedFill.alpha * 100)}%`}</span>
              </div>

              {!isPseudoState && colorTokens.length > 0 && (
                <select
                  class="select-field folio-token-select"
                  aria-label="Fill design token"
                  value={selectedNode.tokenBindings?.fill ?? ''}
                  onChange={(event) => {
                    const tokenId = event.currentTarget.value || undefined;
                    const nextBindings = { ...(selectedNode.tokenBindings ?? {}) };
                    if (tokenId) nextBindings.fill = tokenId;
                    else delete nextBindings.fill;
                    onUpdateSelected({
                      tokenBindings: Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
                    });
                    onCommitEdit();
                  }}
                >
                  <option value="">Token: Custom Fill</option>
                  {colorTokens.map((t) => (
                    <option key={t.id} value={t.id}>
                      Token: {t.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : activeGradient ? (
            <div class="folio-gradient-box">
              {activeGradient.type === 'linear-gradient' && (() => {
                const transitionStyle = detectLinearGradientTransitionStyle(activeGradient.stops);
                return (
                  <>
                    <div class="folio-prop-header-row">
                      <span class="folio-mini-label">Color Transition</span>
                      <div class="folio-mini-seg" role="group" aria-label="Gradient transition style">
                        <button
                          type="button"
                          data-testid="gradient-transition-linear"
                          class={`folio-mini-seg-btn${transitionStyle === 'linear' ? ' is-active' : ''}`}
                          aria-pressed={transitionStyle === 'linear'}
                          onClick={() => {
                            updateGradient((g) =>
                              g.type === 'linear-gradient'
                                ? convertLinearGradientTransitionStyle(g, 'linear')
                                : g,
                            );
                          }}
                        >
                          Linear
                        </button>
                        <button
                          type="button"
                          data-testid="gradient-transition-hard"
                          class={`folio-mini-seg-btn${transitionStyle === 'hard' ? ' is-active' : ''}`}
                          aria-pressed={transitionStyle === 'hard'}
                          onClick={() => {
                            updateGradient((g) =>
                              g.type === 'linear-gradient'
                                ? convertLinearGradientTransitionStyle(g, 'hard')
                                : g,
                            );
                          }}
                        >
                          Sharp Split
                        </button>
                      </div>
                    </div>
                    <NumericUnitInput
                      label="Angle"
                      ariaLabel="Gradient angle"
                      value={Math.round(activeGradient.angle)}
                      unit="deg"
                      units={['deg']}
                      min={0}
                      max={360}
                      step={15}
                      presets={[
                        { label: '0 deg', value: 0, unit: 'deg' },
                        { label: '90 deg', value: 90, unit: 'deg' },
                        { label: '135 deg', value: 135, unit: 'deg' },
                        { label: '180 deg', value: 180, unit: 'deg' },
                      ]}
                      onChange={(res) => {
                        updateGradient((g) =>
                          g.type === 'linear-gradient'
                            ? { ...g, angle: ((res.value % 360) + 360) % 360 }
                            : g,
                        );
                      }}
                    />
                  </>
                );
              })()}
              <div class="folio-gradient-stops">
                {activeGradient.stops.map((stop, idx) => (
                  <div key={`stop-${idx}`} class="folio-gradient-stop-row">
                    <input
                      class="color-swatch"
                      type="color"
                      aria-label={`Gradient stop ${idx + 1} color`}
                      value={parseColorWithAlpha(stop.color, '#00E5FF').hex}
                      onInput={(e) => {
                        const nextColor = e.currentTarget.value;
                        updateGradient((g) => ({
                          ...g,
                          stops: g.stops.map((s, sIdx) => (sIdx === idx ? { ...s, color: nextColor } : s)),
                        }));
                      }}
                    />
                    <NumericUnitInput
                      label={`S${idx + 1}`}
                      ariaLabel={`Gradient stop ${idx + 1} position`}
                      value={Math.round(stop.offset * 100)}
                      unit="%"
                      units={['%']}
                      min={0}
                      max={100}
                      step={5}
                      onChange={(res) => {
                        updateGradient((g) => ({
                          ...g,
                          stops: g.stops.map((s, sIdx) =>
                            sIdx === idx ? { ...s, offset: Math.max(0, Math.min(1, res.value / 100)) } : s,
                          ),
                        }));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* BORDER / STROKE */}
      {supportsBorder && (
        <div class="folio-prop-group">
          <div class="folio-prop-header-row">
            <span class="folio-prop-label">
              {isPseudoState && (activeStateOverride?.stroke !== undefined || activeStateOverride?.strokeWidth !== undefined) && (
                <span class="folio-override-dot" aria-hidden="true" />
              )}
              Border &amp; Stroke
            </span>
            <div class="folio-inline-actions">
              {(isShape || isImage) && !isPseudoState && (
                <div class="folio-mini-seg" role="group" aria-label="Border side mode">
                  <button
                    type="button"
                    class={`folio-mini-seg-btn${borderMode === 'all' ? ' is-active' : ''}`}
                    onClick={() => {
                      setBorderMode('all');
                      if (selectedNode.style.borderSides) {
                        onUpdateSelectedStyle({ borderSides: undefined });
                        onCommitEdit();
                      }
                    }}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class={`folio-mini-seg-btn${borderMode === 'per-side' ? ' is-active' : ''}`}
                    onClick={() => {
                      setBorderMode('per-side');
                      if (!selectedNode.style.borderSides && rawStrokeWidth > 0 && !isTransparentColor(rawStroke)) {
                        const base: BorderSideStyle = {
                          width: rawStrokeWidth,
                          widthUnit: strokeWidthUnit,
                          color: rawStroke,
                          style: strokeStyle,
                        };
                        onUpdateSelectedStyle({
                          borderSides: { top: base, right: base, bottom: base, left: base },
                        });
                        onCommitEdit();
                      }
                    }}
                  >
                    Sides
                  </button>
                </div>
              )}
            </div>
          </div>

          {borderMode === 'per-side' && (isShape || isImage) && !isPseudoState ? (
            <div class="folio-perside-box">
              <div class="folio-seg-4" role="group" aria-label="Select border side">
                {BORDER_SIDES.map((s) => {
                  const hasSide = Boolean(currentBorderSides[s.key] && (currentBorderSides[s.key]?.width ?? 0) > 0);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      class={`folio-seg-btn${activeSide === s.key ? ' is-active' : ''}${hasSide ? ' has-side-val' : ''}`}
                      onClick={() => setActiveSide(s.key)}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div class="folio-two-col">
                <NumericUnitInput
                  label={activeSide.slice(0, 1).toUpperCase()}
                  ariaLabel={`Border ${activeSide} width`}
                  value={activeSideCfg.width}
                  unit={activeSideCfg.widthUnit ?? 'px'}
                  units={['px', 'rem', 'em']}
                  presets={BORDER_WIDTH_PRESETS}
                  min={0}
                  max={64}
                  step={1}
                  onChange={(res) => {
                    updateSideBorder(activeSide, {
                      width: res.value,
                      widthUnit: res.unit as CssLengthUnit,
                      color: isTransparentColor(activeSideCfg.color) ? '#4A5568' : activeSideCfg.color,
                    });
                  }}
                />
                <select
                  class="select-field"
                  aria-label={`Border ${activeSide} style`}
                  value={activeSideCfg.style ?? 'solid'}
                  onChange={(e) => updateSideBorder(activeSide, { style: e.currentTarget.value as BorderLineStyle })}
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </div>
              <div class="folio-color-row">
                <input
                  class="color-swatch"
                  type="color"
                  aria-label={`Border ${activeSide} color`}
                  value={parseColorWithAlpha(activeSideCfg.color, '#4A5568').hex}
                  onInput={(e) => updateSideBorder(activeSide, { color: e.currentTarget.value, width: Math.max(1, activeSideCfg.width) })}
                />
                <button
                  type="button"
                  class="folio-chip-btn"
                  onClick={() => updateSideBorder(activeSide, { width: 0 })}
                >
                  Clear {activeSide}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div class="folio-color-row">
                <input
                  class="color-swatch"
                  type="color"
                  aria-label="Border color picker"
                  value={parsedStroke.hex}
                  onInput={(event) => {
                    const alpha = strokeIsLegacyKeyword ? 1 : parsedStroke.alpha;
                    commitStrokeColor(formatColorWithAlpha(event.currentTarget.value, alpha), false);
                  }}
                  onPointerUp={onCommitEdit}
                  onBlur={onCommitEdit}
                />
                <input
                  class="folio-color-paste-input"
                  type="text"
                  aria-label="Border hex or CSS color"
                  placeholder="#4A5568 / rgba(...)"
                  value={strokePasteDraft ?? (strokeIsLegacyKeyword ? formatColorWithAlpha(parsedStroke.hex, 0) : rawStroke)}
                  onFocus={(e) => setStrokePasteDraft(e.currentTarget.value)}
                  onInput={(e) => setStrokePasteDraft(e.currentTarget.value)}
                  onBlur={(e) => {
                    const val = e.currentTarget.value.trim();
                    setStrokePasteDraft(null);
                    if (val && isSafeCssColorString(val)) {
                      if (isPseudoState) updatePseudoOverride({ stroke: val });
                      else {
                        onUpdateSelectedStyle({
                          stroke: val,
                          strokeWidth: Math.max(1, rawStrokeWidth),
                        });
                        onCommitEdit();
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setStrokePasteDraft(null);
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>

              <div class="folio-slider-inline-row">
                <span class="folio-mini-label">Stroke Opacity</span>
                <input
                  class="folio-range-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Stroke opacity slider"
                  value={strokeAlphaPct}
                  onInput={(event) => {
                    const pct = Math.min(100, Math.max(0, Number(event.currentTarget.value))) / 100;
                    commitStrokeColor(formatColorWithAlpha(parsedStroke.hex, pct), false);
                  }}
                  onPointerUp={onCommitEdit}
                  onKeyUp={onCommitEdit}
                  onBlur={onCommitEdit}
                />
                <span class="folio-slider-readout">{`${strokeAlphaPct}%`}</span>
              </div>

              <div class="folio-two-col">
                <NumericUnitInput
                  label="W"
                  ariaLabel="Border width"
                  value={rawStrokeWidth}
                  unit={strokeWidthUnit}
                  units={['px', 'rem', 'em']}
                  presets={BORDER_WIDTH_PRESETS}
                  min={0}
                  max={64}
                  step={1}
                  hasOverrideDot={isPseudoState && activeStateOverride?.strokeWidth !== undefined}
                  onChange={(res) => {
                    if (isPseudoState) {
                      updatePseudoOverride({ strokeWidth: res.value });
                    } else {
                      onUpdateSelectedStyle({
                        strokeWidth: res.value,
                        ...(isShape || isImage ? { strokeWidthUnit: res.unit as CssLengthUnit } : {}),
                        ...(res.value > 0 && isTransparentColor(rawStroke) ? { stroke: '#4A5568' } : {}),
                      });
                      onCommitEdit();
                    }
                  }}
                />
                {!isPseudoState && (
                  <select
                    class="select-field"
                    aria-label="Border line style"
                    value={strokeStyle}
                    onChange={(event) => {
                      const nextStyle = event.currentTarget.value as BorderLineStyle;
                      onUpdateSelectedStyle({
                        ...(isShape || isImage ? { strokeStyle: nextStyle } : {}),
                        ...(isShape || isPath ? { strokeDasharray: STROKE_STYLE_DASH[nextStyle] } : {}),
                      });
                      onCommitEdit();
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                )}
              </div>

              {(isShape || isPath) && !isPseudoState && (
                <div class="folio-seg-3" role="group" aria-label="Stroke alignment">
                  {(['inside', 'center', 'outside'] as StrokeAlign[]).map((align) => (
                    <button
                      key={align}
                      type="button"
                      class={`folio-seg-btn${(selectedNode.style.strokeAlign ?? 'center') === align ? ' is-active' : ''}`}
                      onClick={() => {
                        onUpdateSelectedStyle({ strokeAlign: align });
                        onCommitEdit();
                      }}
                    >
                      {align === 'inside' ? 'Inside' : align === 'center' ? 'Center' : 'Outside'}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* CORNER RADIUS */}
      {supportsRadius && (
        <div class="folio-prop-group">
          <div class="folio-prop-header-row">
            <span class="folio-prop-label">
              {isPseudoState && activeStateOverride?.radius !== undefined && (
                <span class="folio-override-dot" aria-hidden="true" />
              )}
              Corner Radius
            </span>
            {!isPseudoState && (
              <div class="folio-mini-seg" role="group" aria-label="Corner radius mode">
                <button
                  type="button"
                  class={`folio-mini-seg-btn${radiusMode === 'uniform' ? ' is-active' : ''}`}
                  onClick={() => {
                    setRadiusMode('uniform');
                    if (selectedNode.style.cornerRadii) {
                      onUpdateSelectedStyle({
                        radius: currentCornerRadii.topLeft,
                        cornerRadii: undefined,
                      });
                      onCommitEdit();
                    }
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  class={`folio-mini-seg-btn${radiusMode === 'per-corner' ? ' is-active' : ''}`}
                  onClick={() => {
                    setRadiusMode('per-corner');
                    if (!selectedNode.style.cornerRadii) {
                      onUpdateSelectedStyle({
                        cornerRadii: {
                          topLeft: currentRadius,
                          topRight: currentRadius,
                          bottomRight: currentRadius,
                          bottomLeft: currentRadius,
                        },
                      });
                      onCommitEdit();
                    }
                  }}
                >
                  4 Corners
                </button>
              </div>
            )}
          </div>

          {radiusMode === 'per-corner' && !isPseudoState ? (
            <div class="folio-two-col">
              {(
                [
                  ['topLeft', 'TL'],
                  ['topRight', 'TR'],
                  ['bottomRight', 'BR'],
                  ['bottomLeft', 'BL'],
                ] as const
              ).map(([cornerKey, shortLabel]) => (
                <NumericUnitInput
                  key={cornerKey}
                  label={shortLabel}
                  ariaLabel={`Corner radius ${shortLabel}`}
                  value={currentCornerRadii[cornerKey]}
                  unit={currentRadiusUnit}
                  units={['px', '%', 'rem']}
                  min={0}
                  max={9999}
                  step={2}
                  onChange={(res) => {
                    const nextCorners: CornerRadiiConfig = {
                      ...currentCornerRadii,
                      [cornerKey]: res.value,
                    };
                    onUpdateSelectedStyle({
                      cornerRadii: nextCorners,
                      radius: nextCorners.topLeft,
                      radiusUnit: res.unit as CssLengthUnit,
                    });
                    onCommitEdit();
                  }}
                />
              ))}
            </div>
          ) : (
            <NumericUnitInput
              label="R"
              ariaLabel="Corner radius"
              value={currentRadius}
              unit={currentRadiusUnit}
              units={['px', '%', 'rem']}
              presets={RADIUS_PRESETS}
              min={0}
              max={9999}
              step={2}
              hasOverrideDot={isPseudoState && activeStateOverride?.radius !== undefined}
              onChange={(res) => {
                if (isPseudoState) {
                  updatePseudoOverride({ radius: res.value });
                } else {
                  onUpdateSelectedStyle({
                    radius: res.value,
                    radiusUnit: res.unit as CssLengthUnit,
                    cornerRadii: undefined,
                  });
                  onCommitEdit();
                }
              }}
            />
          )}

          {!isPseudoState && radiusTokens.length > 0 && (
            <select
              class="select-field folio-token-select"
              aria-label="Radius design token"
              value={selectedNode.tokenBindings?.radius ?? ''}
              onChange={(event) => {
                const tokenId = event.currentTarget.value || undefined;
                const nextBindings = { ...(selectedNode.tokenBindings ?? {}) };
                if (tokenId) nextBindings.radius = tokenId;
                else delete nextBindings.radius;
                onUpdateSelected({
                  tokenBindings: Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
                });
                onCommitEdit();
              }}
            >
              <option value="">Token: Custom Radius</option>
              {radiusTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  Token: {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

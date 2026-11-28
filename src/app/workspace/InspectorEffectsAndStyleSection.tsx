import {
  BLEND_MODES,
  createDefaultLinearGradientFill,
  createDefaultRadialGradientFill,
  createDefaultVisualEffect,
  getVisibleFillPaints,
} from '../../core/document/styling';
import type {
  BlendMode,
  DesignNode,
  EllipseNode,
  FillPaint,
  FrameNode,
  GradientStop,
  PathNode,
  RectNode,
  VisualEffect,
} from '../../core/document/types';

type FillCapableNode = FrameNode | RectNode | EllipseNode | PathNode;

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

const EFFECT_TYPE_LABELS: Record<VisualEffect['type'], string> = {
  'drop-shadow': 'Drop Shadow',
  'inner-shadow': 'Inner Shadow',
  'layer-blur': 'Layer Blur',
  'backdrop-blur': 'Glass Blur',
};

function isFillCapable(node: DesignNode): node is FillCapableNode {
  return node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse' || node.type === 'path';
}

function parseFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function toSwatchHex(color: string, fallback = '#6366F1'): string {
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return fallback;
}

function deriveLegacyFill(fills: readonly FillPaint[]): string {
  const visible = fills.filter((paint) => paint.visible !== false);
  if (visible.length === 0) return 'none';
  const base = visible[0];
  if (base.type === 'solid') return base.color;
  return base.stops[0]?.color ?? '#6366F1';
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface InspectorEffectsAndStyleSectionProps {
  selectedNode: DesignNode;
  defaultFillColor: string;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
}

export function InspectorEffectsAndStyleSection({
  selectedNode,
  defaultFillColor,
  onUpdateSelected,
}: InspectorEffectsAndStyleSectionProps) {
  if (selectedNode.type === 'group') return null;

  const canMultiFill = isFillCapable(selectedNode);
  const currentFills: FillPaint[] = canMultiFill
    ? Array.isArray(selectedNode.style.fills)
      ? selectedNode.style.fills
      : getVisibleFillPaints(selectedNode)
    : [];
  const currentEffects: VisualEffect[] = Array.isArray(selectedNode.effects) ? selectedNode.effects : [];
  const currentBlendMode: BlendMode = selectedNode.blendMode ?? 'normal';

  const commitFills = (nextFills: FillPaint[]) => {
    if (!canMultiFill) return;
    onUpdateSelected({
      style: {
        ...selectedNode.style,
        fill: deriveLegacyFill(nextFills),
        fills: nextFills,
      },
    } as Partial<DesignNode>);
  };

  const commitEffects = (nextEffects: VisualEffect[]) => {
    onUpdateSelected({
      effects: nextEffects.length > 0 ? nextEffects : undefined,
    });
  };

  const addFill = (kind: 'solid' | 'linear-gradient' | 'radial-gradient') => {
    if (!canMultiFill) return;
    const baseList = currentFills.length > 0
      ? [...currentFills]
      : (selectedNode.style.fill && selectedNode.style.fill !== 'none'
          ? [{
              id: createId('fill'),
              type: 'solid' as const,
              color: selectedNode.style.fill,
              opacity: 1,
              visible: true,
            }]
          : []);

    let nextPaint: FillPaint;
    if (kind === 'solid') {
      nextPaint = {
        id: createId('fill'),
        type: 'solid',
        color: toSwatchHex(defaultFillColor, '#6366F1'),
        opacity: 1,
        visible: true,
      };
    } else if (kind === 'linear-gradient') {
      nextPaint = createDefaultLinearGradientFill(createId('fill'));
    } else {
      nextPaint = createDefaultRadialGradientFill(createId('fill'));
    }
    commitFills([...baseList, nextPaint]);
  };

  const updateFillAt = (index: number, updater: (paint: FillPaint) => FillPaint) => {
    const next = currentFills.map((paint, idx) => (idx === index ? updater(paint) : paint));
    commitFills(next);
  };

  const removeFillAt = (index: number) => {
    const next = currentFills.filter((_, idx) => idx !== index);
    commitFills(next);
  };

  const updateStopAt = (
    fillIndex: number,
    stopIndex: number,
    patch: Partial<GradientStop>,
  ) => {
    updateFillAt(fillIndex, (paint) => {
      if (paint.type === 'solid') return paint;
      const nextStops = paint.stops.map((stop, idx) =>
        idx === stopIndex ? { ...stop, ...patch } : stop,
      );
      return { ...paint, stops: nextStops };
    });
  };

  const addStopToFill = (fillIndex: number) => {
    updateFillAt(fillIndex, (paint) => {
      if (paint.type === 'solid' || paint.stops.length >= 6) return paint;
      return {
        ...paint,
        stops: [...paint.stops, { offset: 0.5, color: '#F472B6', opacity: 1 }],
      };
    });
  };

  const removeStopFromFill = (fillIndex: number, stopIndex: number) => {
    updateFillAt(fillIndex, (paint) => {
      if (paint.type === 'solid' || paint.stops.length <= 2) return paint;
      return {
        ...paint,
        stops: paint.stops.filter((_, idx) => idx !== stopIndex),
      };
    });
  };

  const addEffect = (type: VisualEffect['type']) => {
    const next = createDefaultVisualEffect(type, createId('fx'));
    commitEffects([...currentEffects, next]);
  };

  const updateEffectAt = (index: number, updater: (fx: VisualEffect) => VisualEffect) => {
    commitEffects(currentEffects.map((fx, idx) => (idx === index ? updater(fx) : fx)));
  };

  const removeEffectAt = (index: number) => {
    commitEffects(currentEffects.filter((_, idx) => idx !== index));
  };

  return (
    <>
      <section class="property-section" aria-label="Blend mode and fill layers">
        <div class="section-title-row">
          <span class="section-title">Compositing</span>
        </div>
        <label class="field-label">
          Blend mode
          <select
            class="select-field"
            aria-label="Blend mode"
            value={currentBlendMode}
            onChange={(event) => {
              const mode = event.currentTarget.value as BlendMode;
              onUpdateSelected({ blendMode: mode === 'normal' ? undefined : mode });
            }}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {BLEND_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        {canMultiFill && (
          <div class="style-stack-block">
            <div class="section-title-row">
              <span class="section-subtitle">Fills &amp; Gradients</span>
              <div class="style-add-group">
                <button
                  type="button"
                  class="inspector-inline-chip"
                  title="Add solid fill layer"
                  onClick={() => addFill('solid')}
                >
                  + Solid
                </button>
                <button
                  type="button"
                  class="inspector-inline-chip"
                  title="Add linear gradient layer"
                  onClick={() => addFill('linear-gradient')}
                >
                  + Linear
                </button>
                <button
                  type="button"
                  class="inspector-inline-chip"
                  title="Add radial gradient layer"
                  onClick={() => addFill('radial-gradient')}
                >
                  + Radial
                </button>
              </div>
            </div>

            {currentFills.length > 0 && (
              <div class="style-stack-list">
                {currentFills.map((paint, fillIndex) => (
                  <div class={`style-layer-card${paint.visible === false ? ' is-muted' : ''}`} key={paint.id}>
                    <div class="style-layer-header">
                      <input
                        type="checkbox"
                        aria-label={`Toggle fill ${fillIndex + 1} visibility`}
                        checked={paint.visible !== false}
                        onChange={(event) =>
                          updateFillAt(fillIndex, (item) => ({
                            ...item,
                            visible: event.currentTarget.checked,
                          }))
                        }
                      />
                      <span class="style-layer-kind">
                        {paint.type === 'solid'
                          ? 'Solid'
                          : paint.type === 'linear-gradient'
                            ? 'Linear'
                            : 'Radial'}
                      </span>
                      <div class="style-layer-opacity">
                        <input
                          class="number-field style-mini-number"
                          type="number"
                          min="0"
                          max="100"
                          step="5"
                          aria-label={`Fill ${fillIndex + 1} opacity`}
                          value={Math.round((paint.opacity ?? 1) * 100)}
                          onInput={(event) => {
                            const val = parseFinite(event.currentTarget.value);
                            if (val !== null) {
                              updateFillAt(fillIndex, (item) => ({
                                ...item,
                                opacity: Math.min(1, Math.max(0, Math.round(val) / 100)),
                              }));
                            }
                          }}
                        />
                        <span class="opacity-unit">%</span>
                      </div>
                      <button
                        type="button"
                        class="style-layer-remove"
                        title="Remove fill layer"
                        aria-label={`Remove fill ${fillIndex + 1}`}
                        onClick={() => removeFillAt(fillIndex)}
                      >
                        ×
                      </button>
                    </div>

                    {paint.type === 'solid' ? (
                      <div class="color-field-wrap style-layer-body">
                        <input
                          class="color-swatch"
                          type="color"
                          aria-label={`Fill ${fillIndex + 1} color`}
                          value={toSwatchHex(paint.color)}
                          onInput={(event) =>
                            updateFillAt(fillIndex, (item) =>
                              item.type === 'solid'
                                ? { ...item, color: event.currentTarget.value }
                                : item,
                            )
                          }
                        />
                        <span class="color-value">{paint.color.toUpperCase()}</span>
                      </div>
                    ) : (
                      <div class="style-gradient-editor">
                        {paint.type === 'linear-gradient' && (
                          <div class="style-inline-row">
                            <span class="style-inline-label">Angle</span>
                            <input
                              class="number-field style-mini-number"
                              type="number"
                              min="0"
                              max="360"
                              step="15"
                              aria-label={`Gradient ${fillIndex + 1} angle`}
                              value={Math.round(paint.angle)}
                              onInput={(event) => {
                                const val = parseFinite(event.currentTarget.value);
                                if (val !== null) {
                                  updateFillAt(fillIndex, (item) =>
                                    item.type === 'linear-gradient'
                                      ? { ...item, angle: ((val % 360) + 360) % 360 }
                                      : item,
                                  );
                                }
                              }}
                            />
                            <span class="opacity-unit">°</span>
                          </div>
                        )}
                        <div class="style-stops-list">
                          {paint.stops.map((stop, stopIndex) => (
                            <div class="style-stop-row" key={`${paint.id}-stop-${stopIndex}`}>
                              <input
                                class="color-swatch style-stop-swatch"
                                type="color"
                                aria-label={`Gradient stop ${stopIndex + 1} color`}
                                value={toSwatchHex(stop.color)}
                                onInput={(event) =>
                                  updateStopAt(fillIndex, stopIndex, { color: event.currentTarget.value })
                                }
                              />
                              <input
                                class="number-field style-mini-number"
                                type="number"
                                min="0"
                                max="100"
                                step="5"
                                aria-label={`Gradient stop ${stopIndex + 1} position`}
                                value={Math.round(stop.offset * 100)}
                                onInput={(event) => {
                                  const val = parseFinite(event.currentTarget.value);
                                  if (val !== null) {
                                    updateStopAt(fillIndex, stopIndex, {
                                      offset: Math.min(1, Math.max(0, val / 100)),
                                    });
                                  }
                                }}
                              />
                              <span class="opacity-unit">%</span>
                              {paint.stops.length > 2 && (
                                <button
                                  type="button"
                                  class="style-layer-remove"
                                  title="Remove stop"
                                  aria-label={`Remove gradient stop ${stopIndex + 1}`}
                                  onClick={() => removeStopFromFill(fillIndex, stopIndex)}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {paint.stops.length < 6 && (
                          <button
                            type="button"
                            class="inspector-inline-chip style-add-stop-btn"
                            onClick={() => addStopToFill(fillIndex)}
                          >
                            + Add Stop
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section class="property-section" aria-label="Visual effects">
        <div class="section-title-row">
          <span class="section-title">Effects</span>
          <div class="style-add-group">
            <button
              type="button"
              class="inspector-inline-chip"
              title="Add drop shadow"
              onClick={() => addEffect('drop-shadow')}
            >
              + Shadow
            </button>
            <button
              type="button"
              class="inspector-inline-chip"
              title="Add inner shadow"
              onClick={() => addEffect('inner-shadow')}
            >
              + Inner
            </button>
            <button
              type="button"
              class="inspector-inline-chip"
              title="Add layer blur"
              onClick={() => addEffect('layer-blur')}
            >
              + Blur
            </button>
            <button
              type="button"
              class="inspector-inline-chip"
              title="Add glassmorphism backdrop blur"
              onClick={() => addEffect('backdrop-blur')}
            >
              + Glass
            </button>
          </div>
        </div>

        {currentEffects.length === 0 ? (
          <span class="field-help">No shadows or blur filters applied.</span>
        ) : (
          <div class="style-stack-list">
            {currentEffects.map((fx, fxIndex) => (
              <div class={`style-layer-card${fx.visible === false ? ' is-muted' : ''}`} key={fx.id}>
                <div class="style-layer-header">
                  <input
                    type="checkbox"
                    aria-label={`Toggle ${EFFECT_TYPE_LABELS[fx.type]} visibility`}
                    checked={fx.visible !== false}
                    onChange={(event) =>
                      updateEffectAt(fxIndex, (item) => ({
                        ...item,
                        visible: event.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="style-layer-kind">{EFFECT_TYPE_LABELS[fx.type]}</span>
                  <button
                    type="button"
                    class="style-layer-remove"
                    title="Remove effect"
                    aria-label={`Remove ${EFFECT_TYPE_LABELS[fx.type]}`}
                    onClick={() => removeEffectAt(fxIndex)}
                  >
                    ×
                  </button>
                </div>

                {fx.type === 'drop-shadow' || fx.type === 'inner-shadow' ? (
                  <div class="style-effect-body">
                    <div class="field-grid style-effect-grid">
                      <label class="field-label">
                        X
                        <input
                          class="number-field"
                          type="number"
                          aria-label={`${EFFECT_TYPE_LABELS[fx.type]} X offset`}
                          value={fx.x}
                          onInput={(event) => {
                            const val = parseFinite(event.currentTarget.value);
                            if (val !== null) {
                              updateEffectAt(fxIndex, (item) =>
                                item.type === 'drop-shadow' || item.type === 'inner-shadow'
                                  ? { ...item, x: val }
                                  : item,
                              );
                            }
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Y
                        <input
                          class="number-field"
                          type="number"
                          aria-label={`${EFFECT_TYPE_LABELS[fx.type]} Y offset`}
                          value={fx.y}
                          onInput={(event) => {
                            const val = parseFinite(event.currentTarget.value);
                            if (val !== null) {
                              updateEffectAt(fxIndex, (item) =>
                                item.type === 'drop-shadow' || item.type === 'inner-shadow'
                                  ? { ...item, y: val }
                                  : item,
                              );
                            }
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Blur
                        <input
                          class="number-field"
                          type="number"
                          min="0"
                          max="120"
                          aria-label={`${EFFECT_TYPE_LABELS[fx.type]} blur`}
                          value={fx.blur}
                          onInput={(event) => {
                            const val = parseFinite(event.currentTarget.value);
                            if (val !== null) {
                              updateEffectAt(fxIndex, (item) =>
                                item.type === 'drop-shadow' || item.type === 'inner-shadow'
                                  ? { ...item, blur: Math.max(0, val) }
                                  : item,
                              );
                            }
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Spread
                        <input
                          class="number-field"
                          type="number"
                          min="-60"
                          max="60"
                          aria-label={`${EFFECT_TYPE_LABELS[fx.type]} spread`}
                          value={fx.spread ?? 0}
                          onInput={(event) => {
                            const val = parseFinite(event.currentTarget.value);
                            if (val !== null) {
                              updateEffectAt(fxIndex, (item) =>
                                item.type === 'drop-shadow' || item.type === 'inner-shadow'
                                  ? { ...item, spread: val }
                                  : item,
                              );
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div class="color-field-wrap style-layer-body">
                      <input
                        class="color-swatch"
                        type="color"
                        aria-label={`${EFFECT_TYPE_LABELS[fx.type]} color`}
                        value={toSwatchHex(fx.color, '#090D16')}
                        onInput={(event) =>
                          updateEffectAt(fxIndex, (item) =>
                            item.type === 'drop-shadow' || item.type === 'inner-shadow'
                              ? { ...item, color: event.currentTarget.value }
                              : item,
                          )
                        }
                      />
                      <span class="color-value">{fx.color.toUpperCase()}</span>
                    </div>
                  </div>
                ) : (
                  <div class="style-inline-row style-layer-body">
                    <span class="style-inline-label">Radius</span>
                    <input
                      class="number-field style-mini-number"
                      type="number"
                      min="0"
                      max="80"
                      step="1"
                      aria-label={`${EFFECT_TYPE_LABELS[fx.type]} radius`}
                      value={fx.radius}
                      onInput={(event) => {
                        const val = parseFinite(event.currentTarget.value);
                        if (val !== null) {
                          updateEffectAt(fxIndex, (item) =>
                            item.type === 'layer-blur' || item.type === 'backdrop-blur'
                              ? { ...item, radius: Math.max(0, Math.min(80, val)) }
                              : item,
                          );
                        }
                      }}
                    />
                    <span class="opacity-unit">px</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

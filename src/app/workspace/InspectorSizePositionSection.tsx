import { useState } from 'preact/hooks';
import {
  parseAspectRatioNumeric,
  type CssLengthUnit,
  type CssLengthValue,
  type CssUnitOption,
} from '../../core/document/cssUnits';
import type {
  DesignNode,
  LayoutChildPosition,
  LayoutSizingMode,
  NodeInsetOffsets,
  NodeLayoutChildConfig,
} from '../../core/document/types';
import { computeProportionalDimensions } from '../../engines/canvas/geometry';
import { normalizePositiveDimension } from '../editorReducer';
import {
  computePositionPatchForOrigin,
  computeResizePatchForOrigin,
  getAnchorCoordinates,
  type StudioVectorActions,
  type TransformOriginAnchor,
} from './inspectorVectorHelpers';
import { TransformOriginSelector } from './InspectorVectorStudioSection';
import { NumericUnitInput, type NumericUnitPreset } from './NumericUnitInput';

const DIMENSION_UNITS: readonly CssUnitOption[] = ['px', '%', 'vw', 'vh', 'dvh', 'rem', 'em', 'fit', 'fill'];
const BOUND_UNITS: readonly CssUnitOption[] = ['auto', 'px', '%', 'vw', 'vh', 'dvh', 'rem'];
const INSET_UNITS: readonly CssUnitOption[] = ['auto', 'px', '%', 'rem'];
const POSITION_UNITS: readonly CssUnitOption[] = ['px'];
const ROTATION_UNITS: readonly CssUnitOption[] = ['deg'];

const CONTAINER_MAX_WIDTH_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Auto (None)', value: 0, keyword: 'auto' },
  { label: 'SM (640px)', value: 640, unit: 'px' },
  { label: 'MD (768px)', value: 768, unit: 'px' },
  { label: 'LG (1024px)', value: 1024, unit: 'px' },
  { label: 'XL (1280px)', value: 1280, unit: 'px' },
  { label: '2XL (1440px)', value: 1440, unit: 'px' },
];

const BOUND_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Auto (None)', value: 0, keyword: 'auto' },
  { label: '160 px', value: 160, unit: 'px' },
  { label: '320 px', value: 320, unit: 'px' },
  { label: '640 px', value: 640, unit: 'px' },
  { label: '100 %', value: 100, unit: '%' },
  { label: '100 vh', value: 100, unit: 'vh' },
];

const DIMENSION_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Fit Content', value: 0, keyword: 'fit' },
  { label: 'Fill Container', value: 0, keyword: 'fill' },
  { label: '100 %', value: 100, unit: '%' },
  { label: '100 vw', value: 100, unit: 'vw' },
  { label: '100 dvh', value: 100, unit: 'dvh' },
  { label: '320 px', value: 320, unit: 'px' },
  { label: '640 px', value: 640, unit: 'px' },
  { label: '1280 px', value: 1280, unit: 'px' },
];

const Z_INDEX_PRESETS: readonly NumericUnitPreset[] = [
  { label: 'Base (0)', value: 0 },
  { label: 'Sticky (10)', value: 10 },
  { label: 'Dropdown (20)', value: 20 },
  { label: 'Modal (50)', value: 50 },
  { label: 'Top (100)', value: 100 },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: '1/1', label: '1 : 1 (Square)' },
  { value: '4/3', label: '4 : 3 (Classic)' },
  { value: '16/9', label: '16 : 9 (Widescreen)' },
  { value: '21/9', label: '21 : 9 (Ultrawide)' },
  { value: '9/16', label: '9 : 16 (Vertical)' },
] as const;

export type LayoutChildConstraints = NonNullable<NodeLayoutChildConfig['constraints']>;
export type PinPresetId = 'tl' | 'tc' | 'tr' | 'center' | 'bl' | 'br' | 'stretch';

export const PIN_PRESETS: readonly {
  id: PinPresetId;
  label: string;
  title: string;
  constraints: LayoutChildConstraints;
}[] = [
  { id: 'tl', label: 'TL', title: 'Pin Top-Left', constraints: { horizontal: 'left', vertical: 'top' } },
  { id: 'tc', label: 'TC', title: 'Pin Top-Center', constraints: { horizontal: 'center', vertical: 'top' } },
  { id: 'tr', label: 'TR', title: 'Pin Top-Right', constraints: { horizontal: 'right', vertical: 'top' } },
  { id: 'center', label: 'Ctr', title: 'Pin Center', constraints: { horizontal: 'center', vertical: 'center' } },
  { id: 'bl', label: 'BL', title: 'Pin Bottom-Left', constraints: { horizontal: 'left', vertical: 'bottom' } },
  { id: 'br', label: 'BR', title: 'Pin Bottom-Right', constraints: { horizontal: 'right', vertical: 'bottom' } },
  { id: 'stretch', label: 'Fill', title: 'Pin All Sides', constraints: { horizontal: 'left-right', vertical: 'top-bottom' } },
];

export function detectActivePinPreset(constraints?: LayoutChildConstraints): PinPresetId | null {
  const h = constraints?.horizontal ?? 'left';
  const v = constraints?.vertical ?? 'top';
  const match = PIN_PRESETS.find((p) => p.constraints.horizontal === h && p.constraints.vertical === v);
  return match?.id ?? null;
}

export function toLengthUnit(unit: CssUnitOption, fallback: CssLengthUnit = 'px'): CssLengthUnit {
  if (
    unit === 'px' ||
    unit === '%' ||
    unit === 'vw' ||
    unit === 'vh' ||
    unit === 'dvh' ||
    unit === 'rem' ||
    unit === 'em' ||
    unit === 'fr'
  ) {
    return unit;
  }
  return fallback;
}

export function resolveDimensionUnit(
  layoutChild: NodeLayoutChildConfig,
  axis: 'width' | 'height',
): CssUnitOption {
  const mode: LayoutSizingMode =
    (axis === 'width' ? layoutChild.widthMode : layoutChild.heightMode) ?? 'fixed';
  if (mode === 'hug') return 'fit';
  if (mode === 'fill') return 'fill';
  if (mode === 'relative') return '%';
  const cssVal = axis === 'width' ? layoutChild.widthValue : layoutChild.heightValue;
  return cssVal?.unit ?? 'px';
}

export function resolveDimensionNumeric(
  selectedNode: Pick<DesignNode, 'width' | 'height'>,
  layoutChild: NodeLayoutChildConfig,
  axis: 'width' | 'height',
): number {
  const mode: LayoutSizingMode =
    (axis === 'width' ? layoutChild.widthMode : layoutChild.heightMode) ?? 'fixed';
  if (mode === 'relative') {
    return axis === 'width' ? (layoutChild.widthPercent ?? 100) : (layoutChild.heightPercent ?? 100);
  }
  const cssVal = axis === 'width' ? layoutChild.widthValue : layoutChild.heightValue;
  if (cssVal && cssVal.unit !== 'px') return cssVal.value;
  return axis === 'width' ? Math.round(selectedNode.width) : Math.round(selectedNode.height);
}

export function resolveBound(
  layoutChild: NodeLayoutChildConfig,
  key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
): { value: number; unit: CssUnitOption } {
  const cssKey = `${key}Value` as const;
  const cssVal = layoutChild[cssKey];
  if (cssVal) return { value: cssVal.value, unit: cssVal.unit };
  const pxVal = layoutChild[key];
  if (typeof pxVal === 'number' && pxVal > 0) return { value: pxVal, unit: 'px' };
  return { value: 0, unit: 'auto' };
}

export function countActiveBounds(layoutChild: NodeLayoutChildConfig): number {
  return (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const).filter(
    (k) => resolveBound(layoutChild, k).unit !== 'auto',
  ).length;
}

export interface InspectorSizePositionSectionProps {
  selectedNode: DesignNode;
  parentNode: DesignNode | null;
  studioActions?: StudioVectorActions;
  positionLockedByMotionPath?: boolean;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onCommitEdit: () => void;
}

export function InspectorSizePositionSection({
  selectedNode,
  parentNode,
  studioActions,
  positionLockedByMotionPath = false,
  onUpdateSelected,
  onApplyAutoLayout,
  onCommitEdit,
}: InspectorSizePositionSectionProps) {
  const [transformOrigin, setTransformOrigin] = useState<TransformOriginAnchor>('tl');
  const [showMinMax, setShowMinMax] = useState(false);

  const parentLayout = parentNode?.layout;
  const isInsideAutoLayout = Boolean(parentLayout && parentLayout.mode !== 'none');

  const layoutChild: NodeLayoutChildConfig = {
    widthMode: 'fixed',
    heightMode: 'fixed',
    flexGrow: 1,
    position: 'relative',
    alignSelf: 'auto',
    ...(selectedNode.layoutChild ?? {}),
  };

  const commitLayoutChild = (patch: Partial<NodeLayoutChildConfig>, commit = true) => {
    const nextChild: NodeLayoutChildConfig = { ...layoutChild, ...patch };
    onUpdateSelected({ layoutChild: nextChild });
    if (
      (selectedNode.type === 'frame' || selectedNode.type === 'group') &&
      selectedNode.layout?.mode &&
      selectedNode.layout.mode !== 'none'
    ) {
      onApplyAutoLayout(selectedNode.id);
    }
    if (parentNode && isInsideAutoLayout) {
      onApplyAutoLayout(parentNode.id);
    }
    if (commit) onCommitEdit();
  };

  const isAspectRatioLocked = Boolean(selectedNode.aspectRatioLocked);
  const anchorCoords = getAnchorCoordinates(selectedNode, transformOrigin);

  const handleDimensionChange = (axis: 'width' | 'height', nextValue: number) => {
    const currentAxisValue = axis === 'width' ? selectedNode.width : selectedNode.height;
    const safeNext = normalizePositiveDimension(nextValue, currentAxisValue);
    let nextW = axis === 'width' ? safeNext : selectedNode.width;
    let nextH = axis === 'height' ? safeNext : selectedNode.height;
    if (isAspectRatioLocked) {
      const explicitRatio = parseAspectRatioNumeric(layoutChild.aspectRatio);
      const anchor = explicitRatio ?? (selectedNode.height > 0 ? selectedNode.width / selectedNode.height : 1);
      const next = computeProportionalDimensions({
        currentWidth: selectedNode.width,
        currentHeight: selectedNode.height,
        axis,
        nextValue: safeNext,
        lockAspectRatio: true,
        anchorRatio: anchor,
      });
      nextW = next.width;
      nextH = next.height;
    }
    if (transformOrigin === 'tl') {
      onUpdateSelected(
        isAspectRatioLocked
          ? { width: nextW, height: nextH }
          : axis === 'width'
            ? { width: nextW }
            : { height: nextH },
      );
      return;
    }
    onUpdateSelected(computeResizePatchForOrigin(selectedNode, transformOrigin, nextW, nextH));
  };

  const applyDimensionPayload = (
    axis: 'width' | 'height',
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const modeKey = axis === 'width' ? 'widthMode' : 'heightMode';
    const pctKey = axis === 'width' ? 'widthPercent' : 'heightPercent';
    const cssValKey = axis === 'width' ? 'widthValue' : 'heightValue';

    if (payload.unit === 'fit') {
      commitLayoutChild({ [modeKey]: 'hug', [cssValKey]: undefined }, commit);
      return;
    }
    if (payload.unit === 'fill') {
      commitLayoutChild({ [modeKey]: 'fill', [cssValKey]: undefined }, commit);
      return;
    }
    if (payload.unit === '%') {
      commitLayoutChild(
        {
          [modeKey]: 'relative',
          [pctKey]: Math.max(1, Math.min(100, payload.value)),
          [cssValKey]: { value: Math.max(1, Math.min(100, payload.value)), unit: '%' },
        },
        commit,
      );
      return;
    }
    const lenUnit = toLengthUnit(payload.unit, 'px');
    const nextCssVal: CssLengthValue = { value: payload.value, unit: lenUnit };
    if (lenUnit === 'px') {
      handleDimensionChange(axis, payload.value);
      if (layoutChild[modeKey] !== 'fixed' || layoutChild[cssValKey]) {
        commitLayoutChild({ [modeKey]: 'fixed', [cssValKey]: undefined }, false);
      }
      if (commit) onCommitEdit();
      return;
    }
    commitLayoutChild({ [modeKey]: 'fixed', [cssValKey]: nextCssVal }, commit);
  };

  const applyBound = (
    key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const cssKey = `${key}Value` as const;
    if (payload.unit === 'auto' || payload.value <= 0) {
      commitLayoutChild({ [key]: undefined, [cssKey]: undefined }, commit);
      return;
    }
    const lenUnit = toLengthUnit(payload.unit, 'px');
    commitLayoutChild(
      {
        [key]: lenUnit === 'px' ? payload.value : layoutChild[key],
        [cssKey]: { value: payload.value, unit: lenUnit },
      },
      commit,
    );
  };

  const activeBoundsCount = countActiveBounds(layoutChild);
  const positionType: LayoutChildPosition = layoutChild.position ?? 'relative';
  const showInsets = positionType !== 'relative';
  const showPinPresets = !isInsideAutoLayout || positionType === 'absolute';
  const activePinPreset = detectActivePinPreset(layoutChild.constraints);

  const updateInset = (
    side: keyof NodeInsetOffsets,
    payload: { kind: 'numeric' | 'keyword'; value: number; unit: CssUnitOption },
    commit: boolean,
  ) => {
    const nextInset: NodeInsetOffsets = { ...(layoutChild.inset ?? {}) };
    if (payload.unit === 'auto') {
      delete nextInset[side];
    } else {
      nextInset[side] = { value: payload.value, unit: toLengthUnit(payload.unit, 'px') };
    }
    commitLayoutChild(
      { inset: Object.keys(nextInset).length > 0 ? nextInset : undefined },
      commit,
    );
  };

  return (
    <>
      {studioActions && (
        <div class="inspector-acc-group">
          <div class="inspector-align-grid" role="group" aria-label="Align and distribute">
            <button type="button" class="inspector-icon-btn" title="Align Left" onClick={() => studioActions.onAlign('left')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 2V14M5 4H12V6.5H5V4ZM5 9.5H9.5V12H5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Align Center X" onClick={() => studioActions.onAlign('horizontal-center')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M8 2V14M4 4H12V6.5H4V4ZM5.5 9.5H10.5V12H5.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Align Right" onClick={() => studioActions.onAlign('right')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M13.5 2V14M4 4H11V6.5H4V4ZM6.5 9.5H11V12H6.5V9.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Align Top" onClick={() => studioActions.onAlign('top')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2 2.5H14M4 5H6.5V12H4V5ZM9.5 5H12V9.5H9.5V5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Align Middle Y" onClick={() => studioActions.onAlign('vertical-center')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2 8H14M4 4H6.5V12H4V4ZM9.5 5.5H12V10.5H9.5V5.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Align Bottom" onClick={() => studioActions.onAlign('bottom')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2 13.5H14M4 4H6.5V11H4V4ZM9.5 6.5H12V11H9.5V6.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Distribute Horizontally" onClick={() => studioActions.onDistribute('horizontal')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2 2.5V13.5M14 2.5V13.5M6.5 4.5H9.5V11.5H6.5V4.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button type="button" class="inspector-icon-btn" title="Distribute Vertically" onClick={() => studioActions.onDistribute('vertical')}>
              <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 2H13.5M2.5 14H13.5M4.5 6.5H11.5V9.5H4.5V6.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Width & Height with Pinned Units (px/%/vw/vh/dvh/rem/em/Fit/Fill) + Aspect Ratio */}
      <div class="inspector-acc-group">
        <div class="folio-dual-grid">
          <NumericUnitInput
            label="W"
            ariaLabel="Width"
            value={resolveDimensionNumeric(selectedNode, layoutChild, 'width')}
            unit={resolveDimensionUnit(layoutChild, 'width')}
            units={DIMENSION_UNITS}
            presets={DIMENSION_PRESETS}
            min={1}
            max={10000}
            step={2}
            onPreview={(p) => applyDimensionPayload('width', p, false)}
            onChange={(p) => applyDimensionPayload('width', p, true)}
          />
          <NumericUnitInput
            label="H"
            ariaLabel="Height"
            value={resolveDimensionNumeric(selectedNode, layoutChild, 'height')}
            unit={resolveDimensionUnit(layoutChild, 'height')}
            units={DIMENSION_UNITS}
            presets={DIMENSION_PRESETS}
            min={1}
            max={10000}
            step={2}
            onPreview={(p) => applyDimensionPayload('height', p, false)}
            onChange={(p) => applyDimensionPayload('height', p, true)}
          />
        </div>

        <div class="folio-aspect-row">
          <button
            type="button"
            class={`inspector-mini-btn${isAspectRatioLocked ? ' is-accent' : ''}`}
            aria-pressed={isAspectRatioLocked}
            title="Lock proportional aspect ratio"
            onClick={() => {
              onUpdateSelected({ aspectRatioLocked: !isAspectRatioLocked });
              onCommitEdit();
            }}
          >
            {isAspectRatioLocked ? '🔒 Locked' : '🔓 Unlock'}
          </button>
          <select
            class="select-field folio-compact-select"
            aria-label="Aspect Ratio Preset"
            value={layoutChild.aspectRatio ?? ''}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (!raw) {
                commitLayoutChild({ aspectRatio: undefined }, true);
                return;
              }
              const numeric = parseAspectRatioNumeric(raw);
              if (numeric && selectedNode.width > 0) {
                const nextHeight = Math.max(8, Math.round(selectedNode.width / numeric));
                onUpdateSelected({
                  height: nextHeight,
                  aspectRatioLocked: true,
                  layoutChild: { ...layoutChild, aspectRatio: raw },
                });
                if (parentNode && isInsideAutoLayout) onApplyAutoLayout(parentNode.id);
                onCommitEdit();
              } else {
                commitLayoutChild({ aspectRatio: raw }, true);
              }
            }}
          >
            {ASPECT_RATIO_OPTIONS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>
                Ratio: {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Min / Max Bounds (Container Presets 640/768/1024/1280/1440px) */}
        <div class="framer-minmax-wrap">
          <button
            type="button"
            class={`framer-minmax-toggle${showMinMax || activeBoundsCount > 0 ? ' is-active' : ''}`}
            aria-expanded={showMinMax}
            onClick={() => setShowMinMax((prev) => !prev)}
          >
            <span>Min / Max Bounds</span>
            <span class="framer-minmax-meta">
              {activeBoundsCount > 0 ? `${activeBoundsCount} active` : showMinMax ? 'Hide' : 'Set'}
            </span>
          </button>
          {showMinMax && (
            <div class="framer-minmax-panel">
              <div class="folio-dual-grid">
                <NumericUnitInput
                  label="MinW"
                  ariaLabel="Min Width"
                  value={resolveBound(layoutChild, 'minWidth').value}
                  unit={resolveBound(layoutChild, 'minWidth').unit}
                  units={BOUND_UNITS}
                  presets={BOUND_PRESETS}
                  min={0}
                  max={4000}
                  step={8}
                  onChange={(p) => applyBound('minWidth', p, true)}
                />
                <NumericUnitInput
                  label="MaxW"
                  ariaLabel="Max Width"
                  value={resolveBound(layoutChild, 'maxWidth').value}
                  unit={resolveBound(layoutChild, 'maxWidth').unit}
                  units={BOUND_UNITS}
                  presets={CONTAINER_MAX_WIDTH_PRESETS}
                  min={0}
                  max={4000}
                  step={8}
                  onChange={(p) => applyBound('maxWidth', p, true)}
                />
                <NumericUnitInput
                  label="MinH"
                  ariaLabel="Min Height"
                  value={resolveBound(layoutChild, 'minHeight').value}
                  unit={resolveBound(layoutChild, 'minHeight').unit}
                  units={BOUND_UNITS}
                  presets={BOUND_PRESETS}
                  min={0}
                  max={4000}
                  step={8}
                  onChange={(p) => applyBound('minHeight', p, true)}
                />
                <NumericUnitInput
                  label="MaxH"
                  ariaLabel="Max Height"
                  value={resolveBound(layoutChild, 'maxHeight').value}
                  unit={resolveBound(layoutChild, 'maxHeight').unit}
                  units={BOUND_UNITS}
                  presets={BOUND_PRESETS}
                  min={0}
                  max={4000}
                  step={8}
                  onChange={(p) => applyBound('maxHeight', p, true)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Position Type (Relative | Absolute | Fixed | Sticky) + Insets + Pinning */}
      <div class="inspector-acc-group">
        <span class="framer-mini-kicker">Position Type</span>
        <div class="framer-seg-row cols-4" role="group" aria-label="CSS Position Type">
          {(
            [
              { value: 'relative', label: 'Relative' },
              { value: 'absolute', label: 'Absolute' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'sticky', label: 'Sticky' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              class={`framer-seg-btn${positionType === opt.value ? ' is-active' : ''}`}
              aria-pressed={positionType === opt.value}
              onClick={() =>
                commitLayoutChild({
                  position: opt.value as LayoutChildPosition,
                  ...(opt.value === 'sticky' && !layoutChild.inset?.top
                    ? { inset: { ...(layoutChild.inset ?? {}), top: { value: 0, unit: 'px' } } }
                    : {}),
                })
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {showInsets && (
          <div class="folio-dual-grid">
            {(
              [
                { side: 'top', label: 'Top' },
                { side: 'right', label: 'Right' },
                { side: 'bottom', label: 'Bot' },
                { side: 'left', label: 'Left' },
              ] as const
            ).map((item) => {
              const current = layoutChild.inset?.[item.side];
              return (
                <NumericUnitInput
                  key={item.side}
                  label={item.label}
                  ariaLabel={`Inset ${item.side}`}
                  value={current?.value ?? 0}
                  unit={current?.unit ?? 'auto'}
                  units={INSET_UNITS}
                  min={-2000}
                  max={2000}
                  step={2}
                  allowNegative
                  onChange={(p) => updateInset(item.side, p, true)}
                />
              );
            })}
          </div>
        )}

        {showPinPresets && (
          <div class="framer-subcontrol">
            <span class="framer-mini-kicker">Pin Anchor</span>
            <div class="framer-pin-grid" role="group" aria-label="Pin anchor constraints">
              {PIN_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  class={`framer-seg-btn${activePinPreset === preset.id ? ' is-active' : ''}`}
                  title={preset.title}
                  aria-pressed={activePinPreset === preset.id}
                  onClick={() => commitLayoutChild({ constraints: preset.constraints })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Canvas X / Y, Rotation, Flip, Transform Origin, Opacity & Z-Index */}
      <div class="inspector-acc-group">
        {positionLockedByMotionPath && (
          <div
            class="inspector-motion-path-lock-banner"
            data-testid="inspector-motion-path-pos-lock"
            title="Position (X/Y) is driven by Motion Path to prevent keyframe conflicts. Rotation, size, color, opacity, and effects remain freely editable."
          >
            <span class="inspector-mp-lock-dot" aria-hidden="true" />
            <span>Motion Path drives X / Y · Rot, size &amp; style active</span>
          </div>
        )}
        <div class="folio-dual-grid">
          <NumericUnitInput
            label="X"
            ariaLabel="Position X"
            value={Math.round(anchorCoords.x)}
            unit="px"
            units={POSITION_UNITS}
            min={-4000}
            max={8000}
            step={2}
            allowNegative
            disabled={positionLockedByMotionPath}
            onPreview={(p) =>
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'x', p.value))
            }
            onChange={(p) => {
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'x', p.value));
              onCommitEdit();
            }}
          />
          <NumericUnitInput
            label="Y"
            ariaLabel="Position Y"
            value={Math.round(anchorCoords.y)}
            unit="px"
            units={POSITION_UNITS}
            min={-4000}
            max={8000}
            step={2}
            allowNegative
            disabled={positionLockedByMotionPath}
            onPreview={(p) =>
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'y', p.value))
            }
            onChange={(p) => {
              onUpdateSelected(computePositionPatchForOrigin(selectedNode, transformOrigin, 'y', p.value));
              onCommitEdit();
            }}
          />
        </div>

        <div class="folio-dual-grid">
          <NumericUnitInput
            label="Rot"
            ariaLabel="Rotation angle"
            value={Math.round(selectedNode.rotation)}
            unit="deg"
            units={ROTATION_UNITS}
            min={-360}
            max={360}
            step={1}
            allowNegative
            onPreview={(p) => onUpdateSelected({ rotation: p.value })}
            onChange={(p) => {
              onUpdateSelected({ rotation: p.value });
              onCommitEdit();
            }}
          />
          <NumericUnitInput
            label="Z"
            ariaLabel="Z-Index"
            value={Math.round(layoutChild.zIndex ?? 0)}
            unit=""
            units={['']}
            presets={Z_INDEX_PRESETS}
            min={-100}
            max={9999}
            step={1}
            precision={0}
            allowNegative
            onChange={(p) => commitLayoutChild({ zIndex: Math.round(p.value) })}
          />
        </div>

        <div class="folio-origin-flip-row">
          <TransformOriginSelector value={transformOrigin} onChange={setTransformOrigin} />
          <div class="folio-flip-col">
            {studioActions && (
              <div class="inspector-quick-row cols-2">
                <button
                  type="button"
                  class="inspector-mini-btn"
                  title="Flip Horizontal"
                  onClick={() => studioActions.onFlip('horizontal')}
                >
                  ⇄ Flip H
                </button>
                <button
                  type="button"
                  class="inspector-mini-btn"
                  title="Flip Vertical"
                  onClick={() => studioActions.onFlip('vertical')}
                >
                  ⇅ Flip V
                </button>
              </div>
            )}
            <div class="folio-opacity-compact">
              <div class="inspector-sublabel-row">
                <span class="framer-mini-kicker">Opacity</span>
                <span class="zt-value-readout">{Math.round(selectedNode.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                class="zt-range-slider"
                aria-label="Opacity percentage"
                min={0}
                max={100}
                step={1}
                value={Math.round(selectedNode.opacity * 100)}
                style={{
                  '--slider-pct': `${Math.max(0, Math.min(100, Math.round(selectedNode.opacity * 100)))}%`,
                } as Record<string, string>}
                onInput={(event) =>
                  onUpdateSelected({
                    opacity: Math.min(1, Math.max(0, Number(event.currentTarget.value) / 100)),
                  })
                }
                onPointerUp={onCommitEdit}
                onKeyUp={onCommitEdit}
                onBlur={onCommitEdit}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

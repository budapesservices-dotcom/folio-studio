import { useState } from 'preact/hooks';
import type {
  DesignNode,
  LayoutAlignItems,
  LayoutChildPosition,
  LayoutJustifyContent,
  LayoutOverflow,
  LayoutPaddingMode,
  LayoutSizingMode,
  NodeLayoutChildConfig,
  NodeLayoutConfig,
} from '../../core/document/types';
import { PresetStepperSlider } from './InspectorZeroTypingControls';

type LayoutChildConstraints = NonNullable<NodeLayoutChildConfig['constraints']>;

const SPACING_PRESETS = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
const GRID_COL_PRESETS = [1, 2, 3, 4, 6, 12] as const;
const FILL_WEIGHT_PRESETS = [1, 2, 3, 4, 6] as const;
const RELATIVE_PCT_PRESETS = [25, 33, 50, 75, 100] as const;
const Z_INDEX_PRESETS = [0, 1, 5, 10, 20, 50] as const;
const BOUND_SIZE_PRESETS = [40, 80, 120, 160, 240, 320, 480, 640, 800, 1024, 1200] as const;
const SIDE_PADDING_PRESETS = [0, 4, 8, 12, 16, 20, 24, 32, 48, 64] as const;

const DEFAULT_LAYOUT: NodeLayoutConfig = {
  mode: 'none',
  direction: 'column',
  wrap: 'nowrap',
  gap: 12,
  padding: { top: 16, right: 16, bottom: 16, left: 16 },
  paddingMode: 'uniform',
  justifyContent: 'start',
  alignItems: 'stretch',
  gridColumns: 2,
  overflow: 'hidden',
};

const DEFAULT_LAYOUT_CHILD: NodeLayoutChildConfig = {
  widthMode: 'fixed',
  heightMode: 'fixed',
  flexGrow: 1,
  position: 'relative',
  alignSelf: 'auto',
};

const MATRIX_AXIS_VALUES: readonly ('start' | 'center' | 'end')[] = ['start', 'center', 'end'];

type PinPresetId = 'tl' | 'tc' | 'tr' | 'center' | 'bl' | 'br' | 'stretch';

const PIN_PRESETS: readonly {
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

export interface InspectorFrameLayoutSectionProps {
  selectedNode: DesignNode;
  parentNode: DesignNode | null;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onCommitEdit: () => void;
}

function getEffectiveOverflow(node: DesignNode): LayoutOverflow {
  if (node.layout?.overflow) return node.layout.overflow;
  if (node.type === 'frame') {
    return node.clipContent === false ? 'visible' : 'hidden';
  }
  return 'visible';
}

function getEffectivePaddingMode(layout: NodeLayoutConfig): LayoutPaddingMode {
  if (layout.paddingMode) return layout.paddingMode;
  const p = layout.padding;
  const isUniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left;
  return isUniform ? 'uniform' : 'per-side';
}

function detectActivePinPreset(constraints?: LayoutChildConstraints): PinPresetId | null {
  const h = constraints?.horizontal ?? 'left';
  const v = constraints?.vertical ?? 'top';
  const match = PIN_PRESETS.find((preset) => preset.constraints.horizontal === h && preset.constraints.vertical === v);
  return match?.id ?? null;
}

export function InspectorFrameLayoutSection({
  selectedNode,
  parentNode,
  onUpdateSelected,
  onApplyAutoLayout,
  onCommitEdit,
}: InspectorFrameLayoutSectionProps) {
  const [showMinMax, setShowMinMax] = useState(false);

  const isContainer = selectedNode.type === 'frame' || selectedNode.type === 'group';
  const parentLayout = parentNode?.layout;
  const isInsideAutoLayout = Boolean(parentLayout && parentLayout.mode !== 'none');
  const showSizingCard = isContainer || Boolean(parentNode);

  if (!isContainer && !showSizingCard) {
    return null;
  }

  const layout: NodeLayoutConfig = {
    ...DEFAULT_LAYOUT,
    ...(selectedNode.layout ?? {}),
    padding: {
      ...DEFAULT_LAYOUT.padding,
      ...(selectedNode.layout?.padding ?? {}),
    },
  };

  const layoutChild: NodeLayoutChildConfig = {
    ...DEFAULT_LAYOUT_CHILD,
    ...(selectedNode.layoutChild ?? {}),
  };

  const mode = layout.mode;
  const direction = layout.direction;
  const isDistributed =
    layout.justifyContent === 'space-between' ||
    layout.justifyContent === 'space-around' ||
    layout.justifyContent === 'space-evenly';
  const paddingMode = getEffectivePaddingMode(layout);
  const overflow = getEffectiveOverflow(selectedNode);

  const commitContainerLayout = (
    patch: Partial<NodeLayoutConfig>,
    extraNodePatch?: Partial<DesignNode>,
    commit = true,
  ) => {
    const nextLayout: NodeLayoutConfig = {
      ...layout,
      ...patch,
      padding: patch.padding ? { ...layout.padding, ...patch.padding } : layout.padding,
    };
    const nodePatch: Partial<DesignNode> = {
      ...(extraNodePatch ?? {}),
      layout: nextLayout,
    };
    onUpdateSelected(nodePatch);
    if (nextLayout.mode !== 'none') {
      onApplyAutoLayout(selectedNode.id);
    }
    if (parentNode && isInsideAutoLayout) {
      onApplyAutoLayout(parentNode.id);
    }
    if (commit) onCommitEdit();
  };

  const commitChildConfig = (patch: Partial<NodeLayoutChildConfig>, commit = true) => {
    const nextChild: NodeLayoutChildConfig = {
      ...layoutChild,
      ...patch,
    };
    onUpdateSelected({ layoutChild: nextChild });
    if (isContainer && mode !== 'none') {
      onApplyAutoLayout(selectedNode.id);
    }
    if (parentNode && isInsideAutoLayout) {
      onApplyAutoLayout(parentNode.id);
    }
    if (commit) onCommitEdit();
  };

  const handleOverflowChange = (nextOverflow: LayoutOverflow) => {
    const clipPatch =
      selectedNode.type === 'frame'
        ? ({ clipContent: nextOverflow !== 'visible' } as Partial<DesignNode>)
        : undefined;
    commitContainerLayout({ overflow: nextOverflow }, clipPatch, true);
  };

  const handleMatrixCellClick = (rowIdx: number, colIdx: number) => {
    const rowVal = MATRIX_AXIS_VALUES[rowIdx];
    const colVal = MATRIX_AXIS_VALUES[colIdx];
    if (direction === 'row') {
      commitContainerLayout({ justifyContent: colVal, alignItems: rowVal });
    } else {
      commitContainerLayout({ justifyContent: rowVal, alignItems: colVal });
    }
  };

  const isCellActive = (rowIdx: number, colIdx: number): boolean => {
    const rowVal = MATRIX_AXIS_VALUES[rowIdx];
    const colVal = MATRIX_AXIS_VALUES[colIdx];
    const effectiveAlign = layout.alignItems === 'stretch' ? 'center' : layout.alignItems;
    if (isDistributed) {
      return direction === 'row' ? rowVal === effectiveAlign : colVal === effectiveAlign;
    }
    if (direction === 'row') {
      return layout.justifyContent === colVal && effectiveAlign === rowVal;
    }
    return layout.justifyContent === rowVal && effectiveAlign === colVal;
  };

  const activeBoundsCount = [
    layoutChild.minWidth,
    layoutChild.maxWidth,
    layoutChild.minHeight,
    layoutChild.maxHeight,
  ].filter((v) => typeof v === 'number' && v > 0).length;

  const parentGridCols = Math.max(1, Math.round(parentLayout?.gridColumns ?? 2));
  const isChildAbsolute = isInsideAutoLayout && layoutChild.position === 'absolute';
  const activePinPreset = detectActivePinPreset(layoutChild.constraints);
  const parentBadge = parentLayout?.mode === 'flex'
    ? 'IN STACK'
    : parentLayout?.mode === 'grid'
      ? 'IN GRID'
      : isContainer
        ? 'FRAME'
        : 'LAYER';

  const renderPaddingSideControl = (side: 'top' | 'right' | 'bottom' | 'left', label: string) => {
    const val = Math.round(layout.padding[side] ?? 0);
    const matchingPreset = SIDE_PADDING_PRESETS.find((p) => p === val);
    const updateSide = (next: number) => {
      const clamped = Math.max(0, Math.min(256, Math.round(next)));
      commitContainerLayout({
        paddingMode: 'per-side',
        padding: { ...layout.padding, [side]: clamped },
      });
    };

    return (
      <div class="framer-pad-cell" key={side}>
        <span class="framer-pad-label">{label}</span>
        <div class="framer-pad-stepper">
          <button
            type="button"
            class="framer-pad-step-btn"
            aria-label={`Decrease padding ${label}`}
            onClick={() => updateSide(val - 4)}
          >
            −
          </button>
          <select
            class="framer-pad-select"
            aria-label={`Padding ${label}`}
            value={matchingPreset !== undefined ? String(matchingPreset) : '__custom__'}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (raw === '__custom__') return;
              updateSide(Number(raw));
            }}
          >
            {matchingPreset === undefined && <option value="__custom__">{val}</option>}
            {SIDE_PADDING_PRESETS.map((preset) => (
              <option key={preset} value={String(preset)}>
                {preset}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="framer-pad-step-btn"
            aria-label={`Increase padding ${label}`}
            onClick={() => updateSide(val + 4)}
          >
            +
          </button>
        </div>
      </div>
    );
  };

  const renderBoundSelect = (
    key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight',
    label: string,
  ) => {
    const current = layoutChild[key];
    const hasVal = typeof current === 'number' && current > 0;
    const isPreset = hasVal && BOUND_SIZE_PRESETS.includes(current as (typeof BOUND_SIZE_PRESETS)[number]);
    return (
      <label class="framer-bound-field" key={key}>
        <span>{label}</span>
        <select
          class="select-field framer-bound-select"
          aria-label={label}
          value={hasVal ? (isPreset ? String(current) : '__custom__') : ''}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            if (!raw) {
              commitChildConfig({ [key]: undefined });
              return;
            }
            if (raw === '__custom__') return;
            const num = Number(raw);
            if (Number.isFinite(num) && num > 0) {
              commitChildConfig({ [key]: num });
            }
          }}
        >
          <option value="">None</option>
          {hasVal && !isPreset && <option value="__custom__">{Math.round(current)}px</option>}
          {BOUND_SIZE_PRESETS.map((preset) => (
            <option key={preset} value={String(preset)}>
              {preset}px
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div class="framer-layout-stack">
      {/* 1. FRAME AUTO-LAYOUT CONTAINER CARD */}
      {isContainer && (
        <div class="inspector-acc-group inspector-autolayout-block framer-layout-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Frame Auto-Layout</span>
            <div class="framer-header-actions">
              <span class={`inspector-accordion-badge${mode !== 'none' ? ' is-live' : ''}`}>
                {mode === 'flex' ? 'STACK' : mode === 'grid' ? 'GRID' : 'FREE'}
              </span>
              {mode !== 'none' && (
                <button
                  type="button"
                  class="framer-reflow-btn"
                  title="Reflow auto-layout children now"
                  onClick={() => {
                    onApplyAutoLayout(selectedNode.id);
                    onCommitEdit();
                  }}
                >
                  Reflow
                </button>
              )}
            </div>
          </div>

          {/* Layout Type Segmented Control: Free | Stack | Grid */}
          <div class="framer-seg-row cols-3" role="group" aria-label="Auto-Layout mode">
            {(
              [
                { value: 'none', label: 'Free' },
                { value: 'flex', label: 'Stack' },
                { value: 'grid', label: 'Grid' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                class={`framer-seg-btn${mode === opt.value ? ' is-active' : ''}`}
                aria-pressed={mode === opt.value}
                onClick={() =>
                  commitContainerLayout({
                    mode: opt.value,
                    ...(opt.value === 'grid' && isDistributed ? { justifyContent: 'start' } : {}),
                  })
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* STACK (FLEX) CONTROLS */}
          {mode === 'flex' && (
            <>
              <div class="framer-row-split">
                <div class="framer-seg-row cols-2" role="group" aria-label="Stack direction">
                  <button
                    type="button"
                    class={`framer-seg-btn${direction === 'row' ? ' is-active' : ''}`}
                    aria-pressed={direction === 'row'}
                    title="Horizontal Stack (Row)"
                    onClick={() => commitContainerLayout({ direction: 'row' })}
                  >
                    → Row
                  </button>
                  <button
                    type="button"
                    class={`framer-seg-btn${direction === 'column' ? ' is-active' : ''}`}
                    aria-pressed={direction === 'column'}
                    title="Vertical Stack (Column)"
                    onClick={() => commitContainerLayout({ direction: 'column' })}
                  >
                    ↓ Col
                  </button>
                </div>
                <button
                  type="button"
                  class={`framer-seg-btn framer-wrap-btn${layout.wrap === 'wrap' ? ' is-active' : ''}`}
                  aria-pressed={layout.wrap === 'wrap'}
                  title="Allow children to wrap onto multiple lines"
                  onClick={() =>
                    commitContainerLayout({
                      wrap: layout.wrap === 'wrap' ? 'nowrap' : 'wrap',
                    })
                  }
                >
                  Wrap
                </button>
              </div>

              {/* Framer 3x3 Interactive Alignment Matrix + Distribution Controls */}
              <div class="framer-matrix-block">
                <div
                  class={`framer-align-matrix${isDistributed ? ' is-distributed' : ''}${
                    direction === 'row' ? ' is-row' : ' is-col'
                  }`}
                  role="group"
                  aria-label="Stack alignment matrix"
                >
                  {[0, 1, 2].map((rowIdx) =>
                    [0, 1, 2].map((colIdx) => {
                      const active = isCellActive(rowIdx, colIdx);
                      const rLabel = MATRIX_AXIS_VALUES[rowIdx];
                      const cLabel = MATRIX_AXIS_VALUES[colIdx];
                      return (
                        <button
                          key={`${rowIdx}-${colIdx}`}
                          type="button"
                          class={`framer-align-cell${active ? ' is-active' : ''}`}
                          aria-label={`Align ${rLabel} ${cLabel}`}
                          aria-pressed={active}
                          onClick={() => handleMatrixCellClick(rowIdx, colIdx)}
                        >
                          {active ? (
                            <span class="framer-align-bars" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : (
                            <span class="framer-align-dot" aria-hidden="true" />
                          )}
                        </button>
                      );
                    }),
                  )}
                </div>

                <div class="framer-distribute-col">
                  <span class="framer-mini-kicker">Distribute</span>
                  <div class="framer-seg-row cols-2" role="group" aria-label="Stack distribution">
                    {(
                      [
                        { value: 'packed', label: 'Packed' },
                        { value: 'space-between', label: 'Between' },
                        { value: 'space-around', label: 'Around' },
                        { value: 'space-evenly', label: 'Evenly' },
                      ] as const
                    ).map((item) => {
                      const active =
                        item.value === 'packed' ? !isDistributed : layout.justifyContent === item.value;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          class={`framer-seg-btn${active ? ' is-active' : ''}`}
                          aria-pressed={active}
                          onClick={() => {
                            if (item.value === 'packed') {
                              commitContainerLayout({ justifyContent: 'start' });
                            } else {
                              commitContainerLayout({
                                justifyContent: item.value as LayoutJustifyContent,
                              });
                            }
                          }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    class={`framer-seg-btn framer-stretch-btn${
                      layout.alignItems === 'stretch' ? ' is-active' : ''
                    }`}
                    aria-pressed={layout.alignItems === 'stretch'}
                    title="Stretch children across cross-axis"
                    onClick={() =>
                      commitContainerLayout({
                        alignItems: layout.alignItems === 'stretch' ? 'start' : 'stretch',
                      })
                    }
                  >
                    {layout.alignItems === 'stretch' ? '✓ Stretch Cross-Axis' : 'Stretch Cross-Axis'}
                  </button>
                </div>
              </div>

              {/* Stack Gap & Wrapped Row Gap */}
              <PresetStepperSlider
                label={layout.wrap === 'wrap' ? 'Col Gap' : 'Gap'}
                ariaLabel="Auto-Layout Gap"
                value={Math.round(layout.gap ?? 12)}
                min={0}
                max={96}
                step={4}
                presets={SPACING_PRESETS}
                onChange={(next) =>
                  commitContainerLayout(
                    layout.wrap === 'wrap' ? { gap: next, columnGap: next } : { gap: next },
                    undefined,
                    false,
                  )
                }
                onCommit={onCommitEdit}
              />
              {layout.wrap === 'wrap' && (
                <PresetStepperSlider
                  label="Row Gap"
                  ariaLabel="Wrapped Stack Row Gap"
                  value={Math.round(layout.rowGap ?? layout.gap ?? 12)}
                  min={0}
                  max={96}
                  step={4}
                  presets={SPACING_PRESETS}
                  onChange={(next) => commitContainerLayout({ rowGap: next }, undefined, false)}
                  onCommit={onCommitEdit}
                />
              )}
            </>
          )}

          {/* GRID CONTROLS */}
          {mode === 'grid' && (
            <>
              <PresetStepperSlider
                label="Columns"
                ariaLabel="Grid Columns"
                value={Math.max(1, Math.round(layout.gridColumns ?? 2))}
                min={1}
                max={12}
                step={1}
                unit="col"
                presets={GRID_COL_PRESETS}
                onChange={(next) => commitContainerLayout({ gridColumns: next }, undefined, false)}
                onCommit={onCommitEdit}
              />
              <PresetStepperSlider
                label="Col Gap"
                ariaLabel="Grid Column Gap"
                value={Math.round(layout.columnGap ?? layout.gap ?? 12)}
                min={0}
                max={96}
                step={4}
                presets={SPACING_PRESETS}
                onChange={(next) =>
                  commitContainerLayout({ columnGap: next, gap: next }, undefined, false)
                }
                onCommit={onCommitEdit}
              />
              <PresetStepperSlider
                label="Row Gap"
                ariaLabel="Grid Row Gap"
                value={Math.round(layout.rowGap ?? layout.gap ?? 12)}
                min={0}
                max={96}
                step={4}
                presets={SPACING_PRESETS}
                onChange={(next) => commitContainerLayout({ rowGap: next }, undefined, false)}
                onCommit={onCommitEdit}
              />
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Cell Align</span>
                <div class="framer-seg-row cols-4" role="group" aria-label="Grid cell alignment">
                  {(['start', 'center', 'end', 'stretch'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      class={`framer-seg-btn${layout.alignItems === val ? ' is-active' : ''}`}
                      aria-pressed={layout.alignItems === val}
                      onClick={() => commitContainerLayout({ alignItems: val as LayoutAlignItems })}
                    >
                      {val[0].toUpperCase() + val.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Cell Justify</span>
                <div class="framer-seg-row cols-3" role="group" aria-label="Grid cell justify">
                  {(['start', 'center', 'end'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      class={`framer-seg-btn${layout.justifyContent === val ? ' is-active' : ''}`}
                      aria-pressed={layout.justifyContent === val}
                      onClick={() =>
                        commitContainerLayout({ justifyContent: val as LayoutJustifyContent })
                      }
                    >
                      {val[0].toUpperCase() + val.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* PADDING (UNIFORM <-> PER-SIDE T/R/B/L) */}
          {mode !== 'none' && (
            <div class="framer-padding-block">
              <div class="framer-sublabel-inline">
                <span class="framer-mini-kicker">Padding</span>
                <div class="framer-seg-row cols-2 framer-compact-seg" role="group" aria-label="Padding mode">
                  <button
                    type="button"
                    class={`framer-seg-btn${paddingMode === 'uniform' ? ' is-active' : ''}`}
                    aria-pressed={paddingMode === 'uniform'}
                    onClick={() => {
                      const val = Math.round(layout.padding.top ?? 16);
                      commitContainerLayout({
                        paddingMode: 'uniform',
                        padding: { top: val, right: val, bottom: val, left: val },
                      });
                    }}
                  >
                    Uniform
                  </button>
                  <button
                    type="button"
                    class={`framer-seg-btn${paddingMode === 'per-side' ? ' is-active' : ''}`}
                    aria-pressed={paddingMode === 'per-side'}
                    onClick={() => commitContainerLayout({ paddingMode: 'per-side' })}
                  >
                    T/R/B/L
                  </button>
                </div>
              </div>

              {paddingMode === 'uniform' ? (
                <PresetStepperSlider
                  label="All Sides"
                  ariaLabel="Auto-Layout Padding"
                  value={Math.round(layout.padding.top ?? 16)}
                  min={0}
                  max={96}
                  step={4}
                  presets={SPACING_PRESETS}
                  onChange={(next) =>
                    commitContainerLayout(
                      {
                        paddingMode: 'uniform',
                        padding: { top: next, right: next, bottom: next, left: next },
                      },
                      undefined,
                      false,
                    )
                  }
                  onCommit={onCommitEdit}
                />
              ) : (
                <div class="framer-padding-quad">
                  {renderPaddingSideControl('top', 'Top')}
                  {renderPaddingSideControl('right', 'Right')}
                  {renderPaddingSideControl('bottom', 'Bottom')}
                  {renderPaddingSideControl('left', 'Left')}
                </div>
              )}
            </div>
          )}

          {/* OVERFLOW: VISIBLE | HIDDEN | SCROLL */}
          {selectedNode.type === 'frame' && (
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Overflow</span>
              <div class="framer-seg-row cols-3" role="group" aria-label="Frame overflow">
                {(
                  [
                    { value: 'visible', label: 'Visible' },
                    { value: 'hidden', label: 'Hidden' },
                    { value: 'scroll', label: 'Scroll' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    class={`framer-seg-btn${overflow === opt.value ? ' is-active' : ''}`}
                    aria-pressed={overflow === opt.value}
                    onClick={() => handleOverflowChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. FRAMER SIZING & POSITION CARD */}
      {showSizingCard && (
        <div class="inspector-acc-group inspector-autolayout-block framer-layout-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Sizing &amp; Position</span>
            <span class="inspector-accordion-badge">{parentBadge}</span>
          </div>

          {/* POSITION: RELATIVE (FLOW) | ABSOLUTE (PIN) — inside Auto-Layout parent */}
          {isInsideAutoLayout && (
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Position</span>
              <div class="framer-seg-row cols-2" role="group" aria-label="Child layout position">
                {(
                  [
                    { value: 'relative', label: 'Relative (Flow)' },
                    { value: 'absolute', label: 'Absolute (Pin)' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    class={`framer-seg-btn${(layoutChild.position ?? 'relative') === opt.value ? ' is-active' : ''}`}
                    aria-pressed={(layoutChild.position ?? 'relative') === opt.value}
                    onClick={() =>
                      commitChildConfig({
                        position: opt.value as LayoutChildPosition,
                        ...(opt.value === 'absolute' && !layoutChild.constraints
                          ? { constraints: { horizontal: 'left', vertical: 'top' } }
                          : {}),
                      })
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ABSOLUTE PIN CONSTRAINTS & Z-INDEX */}
          {isChildAbsolute && (
            <>
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Pin Anchor</span>
                <div class="framer-pin-grid" role="group" aria-label="Absolute pin anchor">
                  {PIN_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      class={`framer-seg-btn${activePinPreset === preset.id ? ' is-active' : ''}`}
                      title={preset.title}
                      aria-pressed={activePinPreset === preset.id}
                      onClick={() => commitChildConfig({ constraints: preset.constraints })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <PresetStepperSlider
                label="Z-Index"
                ariaLabel="Layer Z-Index"
                value={Math.round(layoutChild.zIndex ?? 0)}
                min={-10}
                max={50}
                step={1}
                unit="z"
                presets={Z_INDEX_PRESETS}
                onChange={(next) => commitChildConfig({ zIndex: next }, false)}
                onCommit={onCommitEdit}
              />
            </>
          )}

          {/* WIDTH SIZING: FIXED | FILL | FIT (HUG) | REL % */}
          <div class="framer-subcontrol">
            <span class="framer-mini-kicker">Width Sizing</span>
            <div class="framer-seg-row cols-4" role="group" aria-label="Width sizing mode">
              {(
                [
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'fill', label: 'Fill' },
                  { value: 'hug', label: 'Fit' },
                  { value: 'relative', label: 'Rel %' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  class={`framer-seg-btn${layoutChild.widthMode === opt.value ? ' is-active' : ''}`}
                  aria-pressed={layoutChild.widthMode === opt.value}
                  onClick={() =>
                    commitChildConfig({
                      widthMode: opt.value as LayoutSizingMode,
                      ...(opt.value === 'relative' && !layoutChild.widthPercent
                        ? { widthPercent: 50 }
                        : {}),
                    })
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {layoutChild.widthMode === 'fill' &&
            parentLayout?.mode === 'flex' &&
            parentLayout.direction === 'row' &&
            !isChildAbsolute && (
              <PresetStepperSlider
                label="Fill Weight"
                ariaLabel="Horizontal Fill Weight"
                value={Math.max(1, Math.round(layoutChild.flexGrow ?? 1))}
                min={1}
                max={6}
                step={1}
                unit="fr"
                presets={FILL_WEIGHT_PRESETS}
                onChange={(next) => commitChildConfig({ flexGrow: next }, false)}
                onCommit={onCommitEdit}
              />
            )}

          {layoutChild.widthMode === 'relative' && (
            <PresetStepperSlider
              label="Width %"
              ariaLabel="Relative Width Percent"
              value={Math.round(layoutChild.widthPercent ?? 50)}
              min={5}
              max={100}
              step={5}
              unit="%"
              presets={RELATIVE_PCT_PRESETS}
              onChange={(next) => commitChildConfig({ widthPercent: next }, false)}
              onCommit={onCommitEdit}
            />
          )}

          {/* HEIGHT SIZING: FIXED | FILL | FIT (HUG) | REL % */}
          <div class="framer-subcontrol">
            <span class="framer-mini-kicker">Height Sizing</span>
            <div class="framer-seg-row cols-4" role="group" aria-label="Height sizing mode">
              {(
                [
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'fill', label: 'Fill' },
                  { value: 'hug', label: 'Fit' },
                  { value: 'relative', label: 'Rel %' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  class={`framer-seg-btn${layoutChild.heightMode === opt.value ? ' is-active' : ''}`}
                  aria-pressed={layoutChild.heightMode === opt.value}
                  onClick={() =>
                    commitChildConfig({
                      heightMode: opt.value as LayoutSizingMode,
                      ...(opt.value === 'relative' && !layoutChild.heightPercent
                        ? { heightPercent: 50 }
                        : {}),
                    })
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {layoutChild.heightMode === 'fill' &&
            parentLayout?.mode === 'flex' &&
            parentLayout.direction === 'column' &&
            !isChildAbsolute && (
              <PresetStepperSlider
                label="Fill Weight"
                ariaLabel="Vertical Fill Weight"
                value={Math.max(1, Math.round(layoutChild.flexGrow ?? 1))}
                min={1}
                max={6}
                step={1}
                unit="fr"
                presets={FILL_WEIGHT_PRESETS}
                onChange={(next) => commitChildConfig({ flexGrow: next }, false)}
                onCommit={onCommitEdit}
              />
            )}

          {layoutChild.heightMode === 'relative' && (
            <PresetStepperSlider
              label="Height %"
              ariaLabel="Relative Height Percent"
              value={Math.round(layoutChild.heightPercent ?? 50)}
              min={5}
              max={100}
              step={5}
              unit="%"
              presets={RELATIVE_PCT_PRESETS}
              onChange={(next) => commitChildConfig({ heightPercent: next }, false)}
              onCommit={onCommitEdit}
            />
          )}

          {/* GRID COLUMN SPAN */}
          {parentLayout?.mode === 'grid' && !isChildAbsolute && (
            <PresetStepperSlider
              label="Col Span"
              ariaLabel="Grid Column Span"
              value={Math.max(1, Math.min(parentGridCols, Math.round(layoutChild.gridColumnSpan ?? 1)))}
              min={1}
              max={parentGridCols}
              step={1}
              unit="col"
              presets={[1, 2, 3, 4, 6].filter((p) => p <= parentGridCols)}
              onChange={(next) => commitChildConfig({ gridColumnSpan: next }, false)}
              onCommit={onCommitEdit}
            />
          )}

          {/* ALIGN SELF */}
          {isInsideAutoLayout && !isChildAbsolute && (
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Align Self</span>
              <div class="framer-seg-row cols-5" role="group" aria-label="Child align self">
                {(
                  [
                    { value: 'auto', label: 'Auto' },
                    { value: 'start', label: 'Start' },
                    { value: 'center', label: 'Ctr' },
                    { value: 'end', label: 'End' },
                    { value: 'stretch', label: 'Fill' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    class={`framer-seg-btn${(layoutChild.alignSelf ?? 'auto') === opt.value ? ' is-active' : ''}`}
                    aria-pressed={(layoutChild.alignSelf ?? 'auto') === opt.value}
                    onClick={() => commitChildConfig({ alignSelf: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* MIN / MAX CONSTRAINTS (COLLAPSIBLE ZERO-TYPING) */}
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
                <div class="framer-minmax-grid">
                  {renderBoundSelect('minWidth', 'Min W')}
                  {renderBoundSelect('maxWidth', 'Max W')}
                  {renderBoundSelect('minHeight', 'Min H')}
                  {renderBoundSelect('maxHeight', 'Max H')}
                </div>
                {activeBoundsCount > 0 && (
                  <button
                    type="button"
                    class="inspector-mini-btn"
                    onClick={() =>
                      commitChildConfig({
                        minWidth: undefined,
                        maxWidth: undefined,
                        minHeight: undefined,
                        maxHeight: undefined,
                      })
                    }
                  >
                    Clear Min/Max Bounds
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

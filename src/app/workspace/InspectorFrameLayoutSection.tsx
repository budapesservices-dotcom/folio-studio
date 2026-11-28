import { useState } from 'preact/hooks';
import {
  isSafeCssGridTemplate,
  type CssLengthUnit,
  type CssUnitOption,
} from '../../core/document/cssUnits';
import type {
  DesignNode,
  GridColumnsMode,
  GridRowsMode,
  LayoutAlignItems,
  LayoutDirection,
  LayoutJustifyContent,
  LayoutMode,
  LayoutOverflow,
  LayoutPaddingMode,
  NodeCursorType,
  NodeLayoutChildConfig,
  NodeLayoutConfig,
  ScrollSnapAlign,
  ScrollSnapType,
} from '../../core/document/types';
import { isShapeContainerNode } from '../../core/document/layers';
import { NumericUnitInput, type NumericUnitPreset } from './NumericUnitInput';

const SPACING_UNITS: readonly CssUnitOption[] = ['px', 'rem', 'em', '%'];
const SPACING_PRESETS: readonly NumericUnitPreset[] = [
  { label: '0 px', value: 0, unit: 'px' },
  { label: '4 px', value: 4, unit: 'px' },
  { label: '8 px', value: 8, unit: 'px' },
  { label: '12 px', value: 12, unit: 'px' },
  { label: '16 px', value: 16, unit: 'px' },
  { label: '24 px', value: 24, unit: 'px' },
  { label: '32 px', value: 32, unit: 'px' },
  { label: '48 px', value: 48, unit: 'px' },
  { label: '64 px', value: 64, unit: 'px' },
];

const GRID_COUNT_UNITS: readonly CssUnitOption[] = [''];
const GRID_COL_PRESETS: readonly NumericUnitPreset[] = [
  { label: '1 col', value: 1 },
  { label: '2 cols', value: 2 },
  { label: '3 cols', value: 3 },
  { label: '4 cols', value: 4 },
  { label: '6 cols', value: 6 },
  { label: '12 cols', value: 12 },
];

const GRID_MIN_WIDTH_UNITS: readonly CssUnitOption[] = ['px', 'rem', '%'];
const GRID_MIN_WIDTH_PRESETS: readonly NumericUnitPreset[] = [
  { label: '160 px (Compact)', value: 160, unit: 'px' },
  { label: '220 px (Card)', value: 220, unit: 'px' },
  { label: '280 px (Standard)', value: 280, unit: 'px' },
  { label: '320 px (Wide)', value: 320, unit: 'px' },
  { label: '360 px (Feature)', value: 360, unit: 'px' },
];

const FILL_WEIGHT_PRESETS: readonly NumericUnitPreset[] = [
  { label: '1 fr', value: 1, unit: 'fr' },
  { label: '2 fr', value: 2, unit: 'fr' },
  { label: '3 fr', value: 3, unit: 'fr' },
  { label: '4 fr', value: 4, unit: 'fr' },
  { label: '6 fr', value: 6, unit: 'fr' },
];

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
  gridColumnsMode: 'fixed',
  gridMinColumnWidth: { value: 220, unit: 'px' },
  gridRowsMode: 'auto',
  gridRows: 2,
  overflow: 'hidden',
  scrollSnapType: 'none',
};

const DEFAULT_LAYOUT_CHILD: NodeLayoutChildConfig = {
  widthMode: 'fixed',
  heightMode: 'fixed',
  flexGrow: 1,
  position: 'relative',
  alignSelf: 'auto',
};

const MATRIX_AXIS_VALUES: readonly ('start' | 'center' | 'end')[] = ['start', 'center', 'end'];

const CURSOR_OPTIONS: ReadonlyArray<{ value: NodeCursorType; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'pointer', label: 'Pointer (Hand)' },
  { value: 'grab', label: 'Grab' },
  { value: 'text', label: 'Text (I-Beam)' },
  { value: 'not-allowed', label: 'Not Allowed' },
];

export interface InspectorFrameLayoutSectionProps {
  selectedNode: DesignNode;
  parentNode: DesignNode | null;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onConvertFrameLayoutMode?: (containerId: string, mode: LayoutMode) => void;
  onCommitEdit: () => void;
}

function getEffectiveOverflow(node: DesignNode): LayoutOverflow {
  if (node.layout?.overflow) return node.layout.overflow;
  if (node.type === 'frame') {
    return node.clipContent === false ? 'visible' : 'hidden';
  }
  if (isShapeContainerNode(node)) {
    return node.clipContent === true ? 'hidden' : 'visible';
  }
  return 'visible';
}

function getEffectivePaddingMode(layout: NodeLayoutConfig): LayoutPaddingMode {
  if (layout.paddingMode) return layout.paddingMode;
  const p = layout.padding;
  const isUniform = p.top === p.right && p.right === p.bottom && p.bottom === p.left;
  return isUniform ? 'uniform' : 'per-side';
}

function isHorizontalDirection(direction: LayoutDirection): boolean {
  return direction === 'row' || direction === 'row-reverse';
}

function toLengthUnit(unit: CssUnitOption, fallback: CssLengthUnit = 'px'): CssLengthUnit {
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

export function InspectorFrameLayoutSection({
  selectedNode,
  parentNode,
  onUpdateSelected,
  onApplyAutoLayout,
  onConvertFrameLayoutMode,
  onCommitEdit,
}: InspectorFrameLayoutSectionProps) {
  const [customColsDraft, setCustomColsDraft] = useState<string | null>(null);
  const [customColsInvalid, setCustomColsInvalid] = useState(false);
  const [customRowsDraft, setCustomRowsDraft] = useState<string | null>(null);
  const [customRowsInvalid, setCustomRowsInvalid] = useState(false);

  const isShapeContainer = isShapeContainerNode(selectedNode);
  const isContainer = selectedNode.type === 'frame' || selectedNode.type === 'group' || isShapeContainer;
  const parentLayout = parentNode?.layout;
  const isInsideAutoLayout = Boolean(parentLayout && parentLayout.mode !== 'none');

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
  const isRowAxis = isHorizontalDirection(direction);
  const isDistributed =
    layout.justifyContent === 'space-between' ||
    layout.justifyContent === 'space-around' ||
    layout.justifyContent === 'space-evenly';
  const paddingMode = getEffectivePaddingMode(layout);
  const overflow = getEffectiveOverflow(selectedNode);
  const gridColsMode: GridColumnsMode = layout.gridColumnsMode ?? 'fixed';
  const gridRowsMode: GridRowsMode = layout.gridRowsMode ?? 'auto';
  const gapUnit: CssLengthUnit = layout.gapUnit ?? 'px';
  const paddingUnit: CssLengthUnit = layout.paddingUnit ?? 'px';
  const minColUnit: CssLengthUnit = layout.gridMinColumnWidth?.unit ?? 'px';
  const minColWidth = Math.max(1, Math.round((layout.gridMinColumnWidth?.value ?? 220) * 100) / 100);
  const scrollSnapType: ScrollSnapType = layout.scrollSnapType ?? 'none';

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

  const handleModeSwitch = (targetMode: LayoutMode) => {
    if (targetMode === mode) return;
    if (onConvertFrameLayoutMode) {
      onConvertFrameLayoutMode(selectedNode.id, targetMode);
      return;
    }
    commitContainerLayout({
      mode: targetMode,
      ...(targetMode === 'grid' && isDistributed ? { justifyContent: 'start' } : {}),
    });
  };

  const handleOverflowChange = (nextOverflow: LayoutOverflow) => {
    const clipPatch =
      selectedNode.type === 'frame' || isShapeContainer
        ? ({ clipContent: nextOverflow !== 'visible' } as Partial<DesignNode>)
        : undefined;
    commitContainerLayout({ overflow: nextOverflow }, clipPatch, true);
  };

  const handleMatrixCellClick = (rowIdx: number, colIdx: number) => {
    const rowVal = MATRIX_AXIS_VALUES[rowIdx];
    const colVal = MATRIX_AXIS_VALUES[colIdx];
    if (isRowAxis) {
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
      return isRowAxis ? rowVal === effectiveAlign : colVal === effectiveAlign;
    }
    if (isRowAxis) {
      return layout.justifyContent === colVal && effectiveAlign === rowVal;
    }
    return layout.justifyContent === rowVal && effectiveAlign === colVal;
  };

  const isChildOutOfFlow =
    isInsideAutoLayout && (layoutChild.position === 'absolute' || layoutChild.position === 'fixed');
  const parentGridCols = Math.max(1, Math.round(parentLayout?.gridColumns ?? 2));
  const isChildInGrid = parentLayout?.mode === 'grid' && !isChildOutOfFlow;
  const isChildInStack = parentLayout?.mode === 'flex' && !isChildOutOfFlow;
  const parentHasScrollSnap = Boolean(
    parentLayout?.scrollSnapType && parentLayout.scrollSnapType !== 'none',
  );

  const commitCustomGridColumns = () => {
    const raw = (customColsDraft ?? layout.gridTemplateColumns ?? '').trim();
    if (!raw) {
      setCustomColsDraft(null);
      setCustomColsInvalid(false);
      commitContainerLayout({ gridTemplateColumns: undefined });
      return;
    }
    if (!isSafeCssGridTemplate(raw)) {
      setCustomColsInvalid(true);
      setCustomColsDraft(null);
      return;
    }
    setCustomColsInvalid(false);
    setCustomColsDraft(null);
    commitContainerLayout({ gridColumnsMode: 'custom', gridTemplateColumns: raw });
  };

  const commitCustomGridRows = () => {
    const raw = (customRowsDraft ?? layout.gridTemplateRows ?? '').trim();
    if (!raw) {
      setCustomRowsDraft(null);
      setCustomRowsInvalid(false);
      commitContainerLayout({ gridTemplateRows: undefined });
      return;
    }
    if (!isSafeCssGridTemplate(raw)) {
      setCustomRowsInvalid(true);
      setCustomRowsDraft(null);
      return;
    }
    setCustomRowsInvalid(false);
    setCustomRowsDraft(null);
    commitContainerLayout({ gridRowsMode: 'custom', gridTemplateRows: raw });
  };

  return (
    <div class="framer-layout-stack">
      {/* 1. DUAL-MODE FRAME ENGINE (FREEFORM | STACK | GRID) */}
      {isContainer && (
        <div class="inspector-acc-group inspector-autolayout-block framer-layout-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Frame Mode</span>
            <div class="framer-header-actions">
              <span class={`inspector-accordion-badge${mode !== 'none' ? ' is-live' : ''}`}>
                {mode === 'flex' ? 'STACK' : mode === 'grid' ? 'GRID' : 'FREEFORM'}
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

          {/* 1-Click Dual-Mode Switch: Freeform | Stack | Grid */}
          <div class="framer-seg-row cols-3" role="group" aria-label="Dual-mode frame switch">
            {(
              [
                { value: 'none', label: 'Freeform' },
                { value: 'flex', label: 'Stack' },
                { value: 'grid', label: 'Grid' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                class={`framer-seg-btn${mode === opt.value ? ' is-active' : ''}`}
                aria-pressed={mode === opt.value}
                onClick={() => handleModeSwitch(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* STACK (FLEXBOX) CONTROLS */}
          {mode === 'flex' && (
            <>
              <div class="framer-subcontrol">
                <div class="framer-sublabel-inline">
                  <span class="framer-mini-kicker">Direction</span>
                  <button
                    type="button"
                    class={`framer-seg-btn framer-wrap-chip${layout.wrap === 'wrap' ? ' is-active' : ''}`}
                    aria-pressed={layout.wrap === 'wrap'}
                    title="Allow children to wrap onto multiple lines"
                    onClick={() =>
                      commitContainerLayout({
                        wrap: layout.wrap === 'wrap' ? 'nowrap' : 'wrap',
                      })
                    }
                  >
                    {layout.wrap === 'wrap' ? '✓ Wrap' : 'Wrap'}
                  </button>
                </div>
                <div class="framer-seg-row cols-4" role="group" aria-label="Stack direction">
                  {(
                    [
                      { value: 'row', label: '→ Row', title: 'Horizontal Stack (Row)' },
                      { value: 'column', label: '↓ Col', title: 'Vertical Stack (Column)' },
                      { value: 'row-reverse', label: '← Rev', title: 'Reverse Row' },
                      { value: 'column-reverse', label: '↑ Rev', title: 'Reverse Column' },
                    ] as const
                  ).map((dir) => (
                    <button
                      key={dir.value}
                      type="button"
                      class={`framer-seg-btn${direction === dir.value ? ' is-active' : ''}`}
                      aria-pressed={direction === dir.value}
                      title={dir.title}
                      onClick={() => commitContainerLayout({ direction: dir.value })}
                    >
                      {dir.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3x3 Interactive Alignment Matrix + Distribute */}
              <div class="framer-matrix-block">
                <div
                  class={`framer-align-matrix${isDistributed ? ' is-distributed' : ''}${
                    isRowAxis ? ' is-row' : ' is-col'
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

              {/* Stack Gap via NumericUnitInput */}
              <div class={layout.wrap === 'wrap' ? 'folio-dual-grid' : ''}>
                <NumericUnitInput
                  label={layout.wrap === 'wrap' ? 'Col' : 'Gap'}
                  ariaLabel="Stack Gap"
                  value={layout.gap ?? 12}
                  unit={gapUnit}
                  units={SPACING_UNITS}
                  presets={SPACING_PRESETS}
                  min={0}
                  max={256}
                  step={2}
                  onPreview={(p) =>
                    commitContainerLayout(
                      {
                        gap: p.value,
                        ...(layout.wrap === 'wrap' ? { columnGap: p.value } : {}),
                        gapUnit: toLengthUnit(p.unit, gapUnit),
                      },
                      undefined,
                      false,
                    )
                  }
                  onChange={(p) =>
                    commitContainerLayout({
                      gap: p.value,
                      ...(layout.wrap === 'wrap' ? { columnGap: p.value } : {}),
                      gapUnit: toLengthUnit(p.unit, gapUnit),
                    })
                  }
                />
                {layout.wrap === 'wrap' && (
                  <NumericUnitInput
                    label="Row"
                    ariaLabel="Wrapped Stack Row Gap"
                    value={layout.rowGap ?? layout.gap ?? 12}
                    unit={gapUnit}
                    units={SPACING_UNITS}
                    presets={SPACING_PRESETS}
                    min={0}
                    max={256}
                    step={2}
                    onPreview={(p) =>
                      commitContainerLayout(
                        { rowGap: p.value, gapUnit: toLengthUnit(p.unit, gapUnit) },
                        undefined,
                        false,
                      )
                    }
                    onChange={(p) =>
                      commitContainerLayout({
                        rowGap: p.value,
                        gapUnit: toLengthUnit(p.unit, gapUnit),
                      })
                    }
                  />
                )}
              </div>
            </>
          )}

          {/* FULL CSS GRID CONTROLS */}
          {mode === 'grid' && (
            <>
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Columns</span>
                <div class="framer-seg-row cols-3" role="group" aria-label="Grid columns mode">
                  {(
                    [
                      { value: 'fixed', label: 'Fixed' },
                      { value: 'auto-fit', label: 'Auto-Fit' },
                      { value: 'custom', label: 'Custom' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      class={`framer-seg-btn${gridColsMode === opt.value ? ' is-active' : ''}`}
                      aria-pressed={gridColsMode === opt.value}
                      onClick={() =>
                        commitContainerLayout({
                          gridColumnsMode: opt.value,
                          ...(opt.value === 'auto-fit' && !layout.gridMinColumnWidth
                            ? { gridMinColumnWidth: { value: 220, unit: 'px' } }
                            : {}),
                          ...(opt.value === 'custom' && !layout.gridTemplateColumns
                            ? { gridTemplateColumns: '240px 1fr' }
                            : {}),
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {gridColsMode === 'fixed' && (
                <NumericUnitInput
                  label="Cols"
                  ariaLabel="Grid Fixed Columns"
                  value={Math.max(1, Math.round(layout.gridColumns ?? 2))}
                  unit=""
                  units={GRID_COUNT_UNITS}
                  presets={GRID_COL_PRESETS}
                  min={1}
                  max={12}
                  step={1}
                  precision={0}
                  onPreview={(p) =>
                    commitContainerLayout({ gridColumns: Math.max(1, Math.round(p.value)) }, undefined, false)
                  }
                  onChange={(p) =>
                    commitContainerLayout({ gridColumns: Math.max(1, Math.round(p.value)) })
                  }
                />
              )}

              {gridColsMode === 'auto-fit' && (
                <>
                  <NumericUnitInput
                    label="Min"
                    ariaLabel="Grid Auto-Fit Min Card Width"
                    value={minColWidth}
                    unit={minColUnit}
                    units={GRID_MIN_WIDTH_UNITS}
                    presets={GRID_MIN_WIDTH_PRESETS}
                    min={minColUnit === 'px' ? 40 : 1}
                    max={1200}
                    step={10}
                    onPreview={(p) =>
                      commitContainerLayout(
                        {
                          gridColumnsMode: 'auto-fit',
                          gridMinColumnWidth: {
                            value: p.value,
                            unit: toLengthUnit(p.unit, minColUnit),
                          },
                        },
                        undefined,
                        false,
                      )
                    }
                    onChange={(p) =>
                      commitContainerLayout({
                        gridColumnsMode: 'auto-fit',
                        gridMinColumnWidth: {
                          value: p.value,
                          unit: toLengthUnit(p.unit, minColUnit),
                        },
                      })
                    }
                  />
                  <div class="folio-css-readout" title="Compiled CSS grid-template-columns">
                    repeat(auto-fit, minmax({minColWidth}{minColUnit}, 1fr))
                  </div>
                </>
              )}

              {gridColsMode === 'custom' && (
                <div class="framer-subcontrol">
                  <input
                    type="text"
                    class={`text-field folio-code-input${customColsInvalid ? ' is-invalid' : ''}`}
                    aria-label="Custom Grid Columns Template"
                    placeholder="e.g. 240px 1fr 300px"
                    value={customColsDraft ?? layout.gridTemplateColumns ?? '240px 1fr'}
                    onInput={(event) => {
                      setCustomColsDraft(event.currentTarget.value);
                      setCustomColsInvalid(false);
                    }}
                    onBlur={commitCustomGridColumns}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitCustomGridColumns();
                      } else if (event.key === 'Escape') {
                        setCustomColsDraft(null);
                        setCustomColsInvalid(false);
                      }
                    }}
                  />
                </div>
              )}

              {/* Grid Rows Mode */}
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Rows</span>
                <div class="framer-seg-row cols-3" role="group" aria-label="Grid rows mode">
                  {(
                    [
                      { value: 'auto', label: 'Auto' },
                      { value: 'fixed', label: 'Fixed' },
                      { value: 'custom', label: 'Custom' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      class={`framer-seg-btn${gridRowsMode === opt.value ? ' is-active' : ''}`}
                      aria-pressed={gridRowsMode === opt.value}
                      onClick={() =>
                        commitContainerLayout({
                          gridRowsMode: opt.value,
                          ...(opt.value === 'fixed' && !layout.gridRows ? { gridRows: 2 } : {}),
                          ...(opt.value === 'custom' && !layout.gridTemplateRows
                            ? { gridTemplateRows: 'auto 1fr' }
                            : {}),
                        })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {gridRowsMode === 'fixed' && (
                <NumericUnitInput
                  label="Rows"
                  ariaLabel="Grid Fixed Rows"
                  value={Math.max(1, Math.round(layout.gridRows ?? 2))}
                  unit=""
                  units={GRID_COUNT_UNITS}
                  min={1}
                  max={12}
                  step={1}
                  precision={0}
                  onPreview={(p) =>
                    commitContainerLayout({ gridRows: Math.max(1, Math.round(p.value)) }, undefined, false)
                  }
                  onChange={(p) =>
                    commitContainerLayout({ gridRows: Math.max(1, Math.round(p.value)) })
                  }
                />
              )}

              {gridRowsMode === 'custom' && (
                <div class="framer-subcontrol">
                  <input
                    type="text"
                    class={`text-field folio-code-input${customRowsInvalid ? ' is-invalid' : ''}`}
                    aria-label="Custom Grid Rows Template"
                    placeholder="e.g. auto 1fr 120px"
                    value={customRowsDraft ?? layout.gridTemplateRows ?? 'auto 1fr'}
                    onInput={(event) => {
                      setCustomRowsDraft(event.currentTarget.value);
                      setCustomRowsInvalid(false);
                    }}
                    onBlur={commitCustomGridRows}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitCustomGridRows();
                      } else if (event.key === 'Escape') {
                        setCustomRowsDraft(null);
                        setCustomRowsInvalid(false);
                      }
                    }}
                  />
                </div>
              )}

              {/* Separate Col Gap & Row Gap */}
              <div class="folio-dual-grid">
                <NumericUnitInput
                  label="Col"
                  ariaLabel="Grid Column Gap"
                  value={layout.columnGap ?? layout.gap ?? 12}
                  unit={gapUnit}
                  units={SPACING_UNITS}
                  presets={SPACING_PRESETS}
                  min={0}
                  max={256}
                  step={2}
                  onPreview={(p) =>
                    commitContainerLayout(
                      { columnGap: p.value, gap: p.value, gapUnit: toLengthUnit(p.unit, gapUnit) },
                      undefined,
                      false,
                    )
                  }
                  onChange={(p) =>
                    commitContainerLayout({
                      columnGap: p.value,
                      gap: p.value,
                      gapUnit: toLengthUnit(p.unit, gapUnit),
                    })
                  }
                />
                <NumericUnitInput
                  label="Row"
                  ariaLabel="Grid Row Gap"
                  value={layout.rowGap ?? layout.gap ?? 12}
                  unit={gapUnit}
                  units={SPACING_UNITS}
                  presets={SPACING_PRESETS}
                  min={0}
                  max={256}
                  step={2}
                  onPreview={(p) =>
                    commitContainerLayout(
                      { rowGap: p.value, gapUnit: toLengthUnit(p.unit, gapUnit) },
                      undefined,
                      false,
                    )
                  }
                  onChange={(p) =>
                    commitContainerLayout({
                      rowGap: p.value,
                      gapUnit: toLengthUnit(p.unit, gapUnit),
                    })
                  }
                />
              </div>

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

          {/* PADDING (UNIFORM <-> PER-SIDE T/R/B/L) via NumericUnitInput */}
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
                      const val = layout.padding.top ?? 16;
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
                <NumericUnitInput
                  label="Pad"
                  ariaLabel="Uniform Padding"
                  value={layout.padding.top ?? 16}
                  unit={paddingUnit}
                  units={SPACING_UNITS}
                  presets={SPACING_PRESETS}
                  min={0}
                  max={256}
                  step={2}
                  onPreview={(p) =>
                    commitContainerLayout(
                      {
                        paddingMode: 'uniform',
                        padding: { top: p.value, right: p.value, bottom: p.value, left: p.value },
                        paddingUnit: toLengthUnit(p.unit, paddingUnit),
                      },
                      undefined,
                      false,
                    )
                  }
                  onChange={(p) =>
                    commitContainerLayout({
                      paddingMode: 'uniform',
                      padding: { top: p.value, right: p.value, bottom: p.value, left: p.value },
                      paddingUnit: toLengthUnit(p.unit, paddingUnit),
                    })
                  }
                />
              ) : (
                <div class="folio-dual-grid">
                  {(
                    [
                      { key: 'top', label: 'T', aria: 'Padding Top' },
                      { key: 'right', label: 'R', aria: 'Padding Right' },
                      { key: 'bottom', label: 'B', aria: 'Padding Bottom' },
                      { key: 'left', label: 'L', aria: 'Padding Left' },
                    ] as const
                  ).map((side) => (
                    <NumericUnitInput
                      key={side.key}
                      label={side.label}
                      ariaLabel={side.aria}
                      value={layout.padding[side.key] ?? 0}
                      unit={paddingUnit}
                      units={SPACING_UNITS}
                      min={0}
                      max={256}
                      step={2}
                      onPreview={(p) =>
                        commitContainerLayout(
                          {
                            paddingMode: 'per-side',
                            padding: { ...layout.padding, [side.key]: p.value },
                            paddingUnit: toLengthUnit(p.unit, paddingUnit),
                          },
                          undefined,
                          false,
                        )
                      }
                      onChange={(p) =>
                        commitContainerLayout({
                          paddingMode: 'per-side',
                          padding: { ...layout.padding, [side.key]: p.value },
                          paddingUnit: toLengthUnit(p.unit, paddingUnit),
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OVERFLOW & CSS SCROLL SNAP */}
          {(selectedNode.type === 'frame' || isShapeContainer) && (
            <>
              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">Overflow</span>
                <div class="framer-seg-row cols-5" role="group" aria-label="Frame overflow">
                  {(
                    [
                      { value: 'visible', label: 'Vis' },
                      { value: 'hidden', label: 'Clip' },
                      { value: 'scroll-y', label: 'Scr Y' },
                      { value: 'scroll-x', label: 'Scr X' },
                      { value: 'auto', label: 'Auto' },
                    ] as const
                  ).map((opt) => {
                    const isActive =
                      overflow === opt.value || (overflow === 'scroll' && opt.value === 'scroll-y');
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        class={`framer-seg-btn${isActive ? ' is-active' : ''}`}
                        aria-pressed={isActive}
                        title={`Overflow: ${opt.value}`}
                        onClick={() => handleOverflowChange(opt.value)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div class="framer-subcontrol">
                <span class="framer-mini-kicker">CSS Scroll Snap</span>
                <div class="framer-seg-row cols-3" role="group" aria-label="Container scroll snap">
                  {(
                    [
                      { value: 'none', label: 'Off' },
                      { value: 'x', label: 'Horizontal (X)' },
                      { value: 'y', label: 'Vertical (Y)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      class={`framer-seg-btn${scrollSnapType === opt.value ? ' is-active' : ''}`}
                      aria-pressed={scrollSnapType === opt.value}
                      onClick={() => commitContainerLayout({ scrollSnapType: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 2. CONTEXTUAL GRID CHILD & STACK ITEM CONTROLS */}
      {(isChildInGrid || isChildInStack || parentHasScrollSnap) && (
        <div class="inspector-acc-group inspector-autolayout-block framer-layout-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">
              {isChildInGrid ? 'Grid Item Placement' : 'Layout Item'}
            </span>
            <span class="inspector-accordion-badge is-live">
              {isChildInGrid ? 'GRID CHILD' : isChildInStack ? 'STACK ITEM' : 'SNAP'}
            </span>
          </div>

          {isChildInGrid && (
            <>
              <div class="framer-sublabel-inline">
                <span class="framer-mini-kicker">Column Span</span>
                <button
                  type="button"
                  class={`framer-seg-btn framer-wrap-chip${layoutChild.gridColumnSpanFull ? ' is-active' : ''}`}
                  aria-pressed={Boolean(layoutChild.gridColumnSpanFull)}
                  title="Span all columns (grid-column: 1 / -1)"
                  onClick={() =>
                    commitChildConfig({
                      gridColumnSpanFull: !layoutChild.gridColumnSpanFull,
                    })
                  }
                >
                  {layoutChild.gridColumnSpanFull ? '✓ Full (1/-1)' : 'Full Row'}
                </button>
              </div>
              <div class="folio-dual-grid">
                <NumericUnitInput
                  label="Col"
                  ariaLabel="Grid Column Span"
                  value={Math.max(1, Math.min(12, Math.round(layoutChild.gridColumnSpan ?? 1)))}
                  unit=""
                  units={GRID_COUNT_UNITS}
                  min={1}
                  max={Math.max(parentGridCols, 12)}
                  step={1}
                  precision={0}
                  disabled={Boolean(layoutChild.gridColumnSpanFull)}
                  onChange={(p) =>
                    commitChildConfig({
                      gridColumnSpan: Math.max(1, Math.min(12, Math.round(p.value))),
                      gridColumnSpanFull: false,
                    })
                  }
                />
                <NumericUnitInput
                  label="Row"
                  ariaLabel="Grid Row Span"
                  value={Math.max(1, Math.min(6, Math.round(layoutChild.gridRowSpan ?? 1)))}
                  unit=""
                  units={GRID_COUNT_UNITS}
                  min={1}
                  max={6}
                  step={1}
                  precision={0}
                  onChange={(p) =>
                    commitChildConfig({
                      gridRowSpan: Math.max(1, Math.min(6, Math.round(p.value))),
                    })
                  }
                />
              </div>
            </>
          )}

          {isChildInStack &&
            ((layoutChild.widthMode === 'fill' && isHorizontalDirection(parentLayout.direction)) ||
              (layoutChild.heightMode === 'fill' && !isHorizontalDirection(parentLayout.direction))) && (
              <NumericUnitInput
                label="Grow"
                ariaLabel="Stack Fill Weight"
                value={Math.max(1, Math.round(layoutChild.flexGrow ?? 1))}
                unit="fr"
                units={['fr']}
                presets={FILL_WEIGHT_PRESETS}
                min={1}
                max={12}
                step={1}
                precision={0}
                onChange={(p) => commitChildConfig({ flexGrow: Math.max(1, Math.round(p.value)) })}
              />
            )}

          {(isChildInStack || isChildInGrid) && (
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

          {parentHasScrollSnap && (
            <div class="framer-subcontrol">
              <span class="framer-mini-kicker">Scroll Snap Align</span>
              <div class="framer-seg-row cols-4" role="group" aria-label="Child scroll snap align">
                {(
                  [
                    { value: 'none', label: 'None' },
                    { value: 'start', label: 'Start' },
                    { value: 'center', label: 'Center' },
                    { value: 'end', label: 'End' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    class={`framer-seg-btn${(layoutChild.scrollSnapAlign ?? 'none') === opt.value ? ' is-active' : ''}`}
                    aria-pressed={(layoutChild.scrollSnapAlign ?? 'none') === opt.value}
                    onClick={() => commitChildConfig({ scrollSnapAlign: opt.value as ScrollSnapAlign })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. WEB INTERACTION (CURSOR, POINTER EVENTS, USER SELECT) */}
      <div class="inspector-acc-group framer-layout-card">
        <div class="inspector-sublabel-row">
          <span class="inspector-sublabel">Web Interaction</span>
        </div>

        <label class="field-label">
          Cursor
          <select
            class="select-field"
            aria-label="CSS Cursor"
            value={selectedNode.cursor ?? 'default'}
            onChange={(event) => {
              const next = event.currentTarget.value as NodeCursorType;
              onUpdateSelected({ cursor: next === 'default' ? undefined : next });
              onCommitEdit();
            }}
          >
            {CURSOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div class="folio-dual-grid">
          <div class="framer-subcontrol">
            <span class="framer-mini-kicker">Pointer Events</span>
            <div class="framer-seg-row cols-2" role="group" aria-label="Pointer events">
              {(
                [
                  { value: 'auto', label: 'Auto' },
                  { value: 'none', label: 'None' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  class={`framer-seg-btn${(selectedNode.pointerEvents ?? 'auto') === opt.value ? ' is-active' : ''}`}
                  aria-pressed={(selectedNode.pointerEvents ?? 'auto') === opt.value}
                  onClick={() => {
                    onUpdateSelected({
                      pointerEvents: opt.value === 'auto' ? undefined : opt.value,
                    });
                    onCommitEdit();
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div class="framer-subcontrol">
            <span class="framer-mini-kicker">User Select</span>
            <div class="framer-seg-row cols-2" role="group" aria-label="User select">
              {(
                [
                  { value: 'auto', label: 'Auto' },
                  { value: 'none', label: 'None' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  class={`framer-seg-btn${(selectedNode.userSelect ?? 'auto') === opt.value ? ' is-active' : ''}`}
                  aria-pressed={(selectedNode.userSelect ?? 'auto') === opt.value}
                  onClick={() => {
                    onUpdateSelected({
                      userSelect: opt.value === 'auto' ? undefined : opt.value,
                    });
                    onCommitEdit();
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

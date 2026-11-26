/**
 * Pure presentation sub-modules for the Adobe Illustrator & CorelDRAW
 * right-hand Inspector Studio:
 * - Studio Mode Tabs (All / Transform / Style / Vector / Layout)
 * - 9-Point Reference Origin Matrix, Quick Transform, Arrange Z-Order & Step & Repeat
 * - Align & Distribute (Artboard vs. Selection aware)
 * - Color Swatches Palette & Document Colors (Fill / Shift+Click Stroke)
 * - Stroke / Outline Pen Controls (Cap, Join, Dash Presets, Fill Rule, Arrowheads)
 * - Pathfinder / Shaping Suite, Parametric Polygon/Star Editor, Offset/Contour & Bezier Craft
 */

import { useState } from 'preact/hooks';
import type { DesignNode, PathNode } from '../../core/document/types';
import type { PathfinderOperation } from '../../core/document/vector';
import type { CanvasToolId } from '../../core/tools/operationContract';
import type { EditorTarget } from '../editorContext';
import {
  extractDocumentSwatches,
  STROKE_DASH_PRESETS,
  STROKE_WIDTH_PRESETS,
  STUDIO_COLOR_SWATCHES,
  type ArrangeOrderAction,
  type StudioVectorActions,
  type TransformOriginAnchor,
} from './inspectorVectorHelpers';

export type InspectorStudioTab = 'all' | 'transform' | 'style' | 'vector' | 'layout';

const ORIGIN_GRID: readonly { readonly id: TransformOriginAnchor; readonly label: string }[] = [
  { id: 'tl', label: 'Top-Left Origin' },
  { id: 'tc', label: 'Top-Center Origin' },
  { id: 'tr', label: 'Top-Right Origin' },
  { id: 'ml', label: 'Middle-Left Origin' },
  { id: 'c', label: 'Center Origin' },
  { id: 'mr', label: 'Middle-Right Origin' },
  { id: 'bl', label: 'Bottom-Left Origin' },
  { id: 'bc', label: 'Bottom-Center Origin' },
  { id: 'br', label: 'Bottom-Right Origin' },
];

export interface InspectorStudioTabBarProps {
  activeTab: InspectorStudioTab;
  onChangeTab: (tab: InspectorStudioTab) => void;
}

export function InspectorStudioTabBar({ activeTab, onChangeTab }: InspectorStudioTabBarProps) {
  const tabs: readonly { readonly id: InspectorStudioTab; readonly label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'transform', label: 'Transform' },
    { id: 'style', label: 'Style' },
    { id: 'vector', label: 'Vector' },
    { id: 'layout', label: 'Layout' },
  ];

  return (
    <div class="inspector-studio-tabs" role="tablist" aria-label="Inspector sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          class={`inspector-studio-tab${activeTab === tab.id ? ' is-active' : ''}`}
          onClick={() => onChangeTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export interface TransformOriginSelectorProps {
  value: TransformOriginAnchor;
  onChange: (origin: TransformOriginAnchor) => void;
}

export function TransformOriginSelector({ value, onChange }: TransformOriginSelectorProps) {
  return (
    <div
      class="transform-origin-matrix"
      role="radiogroup"
      aria-label="Reference origin point"
      title="9-Point Reference Origin (pins this anchor during W/H resize & X/Y readout)"
    >
      {ORIGIN_GRID.map((point) => (
        <button
          key={point.id}
          type="button"
          role="radio"
          aria-checked={value === point.id}
          aria-label={point.label}
          title={point.label}
          class={`transform-origin-dot${value === point.id ? ' is-active' : ''}`}
          onClick={() => onChange(point.id)}
        />
      ))}
    </div>
  );
}

export interface InspectorTransformActionsProps {
  studioActions: StudioVectorActions;
  selectedCount: number;
  hasGroupSelected?: boolean;
}

export function InspectorTransformActions({
  studioActions,
  selectedCount,
  hasGroupSelected = false,
}: InspectorTransformActionsProps) {
  const [stepOpen, setStepOpen] = useState(false);
  const [copies, setCopies] = useState(3);
  const [offsetX, setOffsetX] = useState(40);
  const [offsetY, setOffsetY] = useState(0);
  const [rotateDeg, setRotateDeg] = useState(0);

  const arrangeItems: readonly { readonly id: ArrangeOrderAction; readonly label: string; readonly title: string }[] = [
    { id: 'front', label: 'Front', title: 'Bring to Front' },
    { id: 'forward', label: 'Up', title: 'Bring Forward' },
    { id: 'backward', label: 'Down', title: 'Send Backward' },
    { id: 'back', label: 'Back', title: 'Send to Back' },
  ];

  return (
    <div class="inspector-vector-stack">
      <div class="inspector-quick-row" role="group" aria-label="Quick flip and rotate">
        <button type="button" class="inspector-mini-btn" title="Flip horizontal" onClick={() => studioActions.onFlip('horizontal')}>
          Flip H
        </button>
        <button type="button" class="inspector-mini-btn" title="Flip vertical" onClick={() => studioActions.onFlip('vertical')}>
          Flip V
        </button>
        <button type="button" class="inspector-mini-btn" title="Rotate 90° counter-clockwise" onClick={() => studioActions.onRotateBy(-90)}>
          -90°
        </button>
        <button type="button" class="inspector-mini-btn" title="Rotate 90° clockwise" onClick={() => studioActions.onRotateBy(90)}>
          +90°
        </button>
        <button type="button" class="inspector-mini-btn" title="Reset rotation to 0°" onClick={studioActions.onResetRotation}>
          0°
        </button>
      </div>

      <div class="inspector-sublabel-row">
        <span class="inspector-sublabel">Arrange (Z-Order)</span>
        <div class="inspector-mini-inline">
          {selectedCount >= 2 && (
            <button type="button" class="inspector-inline-chip" title="Group selection (Ctrl+G)" onClick={studioActions.onGroupSelection}>
              Group
            </button>
          )}
          {hasGroupSelected && (
            <button type="button" class="inspector-inline-chip" title="Ungroup selection" onClick={studioActions.onUngroupSelection}>
              Ungroup
            </button>
          )}
          <button type="button" class="inspector-inline-chip" title="Clip selection to layer below" onClick={studioActions.onCreateClippingMask}>
            Mask
          </button>
        </div>
      </div>

      <div class="inspector-quick-row cols-4" role="group" aria-label="Arrange layer order">
        {arrangeItems.map((item) => (
          <button
            key={item.id}
            type="button"
            class="inspector-mini-btn"
            title={item.title}
            onClick={() => studioActions.onArrange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div class="step-repeat-card">
        <button
          type="button"
          class="step-repeat-toggle"
          aria-expanded={stepOpen}
          onClick={() => setStepOpen((open) => !open)}
        >
          <span>Step &amp; Repeat</span>
          <span class="step-repeat-caret">{stepOpen ? '−' : '+'}</span>
        </button>
        {stepOpen && (
          <div class="step-repeat-body">
            <div class="step-repeat-grid">
              <label class="field-label">
                Copies
                <input
                  class="number-field"
                  type="number"
                  min="1"
                  max="24"
                  value={copies}
                  onInput={(event) => {
                    const next = Math.max(1, Math.min(24, Math.round(Number(event.currentTarget.value) || 1)));
                    setCopies(next);
                  }}
                />
              </label>
              <label class="field-label">
                ΔX
                <input
                  class="number-field"
                  type="number"
                  value={offsetX}
                  onInput={(event) => setOffsetX(Number(event.currentTarget.value) || 0)}
                />
              </label>
              <label class="field-label">
                ΔY
                <input
                  class="number-field"
                  type="number"
                  value={offsetY}
                  onInput={(event) => setOffsetY(Number(event.currentTarget.value) || 0)}
                />
              </label>
              <label class="field-label">
                Rot°
                <input
                  class="number-field"
                  type="number"
                  value={rotateDeg}
                  onInput={(event) => setRotateDeg(Number(event.currentTarget.value) || 0)}
                />
              </label>
            </div>
            <button
              type="button"
              class="inspector-studio-primary-btn"
              onClick={() => studioActions.onStepAndRepeat({ copies, offsetX, offsetY, rotateDeg })}
            >
              Apply Step &amp; Repeat ({copies}×)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface InspectorAlignDistributeSectionProps {
  selectedCount: number;
  studioActions: StudioVectorActions;
}

export function InspectorAlignDistributeSection({
  selectedCount,
  studioActions,
}: InspectorAlignDistributeSectionProps) {
  const canDistribute = selectedCount >= 3;
  const scopeLabel = selectedCount <= 1 ? 'ARTBOARD' : 'SELECTION';

  return (
    <section class="property-section" aria-label="Align and Distribute">
      <div class="section-title-row">
        <span class="section-title">Align &amp; Distribute</span>
        <span class="inspector-scope-badge" title={selectedCount <= 1 ? 'Aligns single object to artboard bounds' : 'Aligns selected objects to each other'}>
          {scopeLabel}
        </span>
      </div>
      <div class="inspector-align-grid" role="group" aria-label="Alignment controls">
        <button type="button" class="inspector-icon-btn" title="Align Left" aria-label="Align Left" onClick={() => studioActions.onAlign('left')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2v12M5 4h8v3H5V4zm0 5h5v3H5V9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button type="button" class="inspector-icon-btn" title="Align Horizontal Center" aria-label="Align Horizontal Center" onClick={() => studioActions.onAlign('horizontal-center')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13" stroke="currentColor" stroke-width="1.2" /><rect x="3" y="4" width="10" height="3" fill="currentColor" /><rect x="5" y="9" width="6" height="3" fill="currentColor" /></svg>
        </button>
        <button type="button" class="inspector-icon-btn" title="Align Right" aria-label="Align Right" onClick={() => studioActions.onAlign('right')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2v12M3 4h8v3H3V4zm3 5h5v3H6V9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button type="button" class="inspector-icon-btn" title="Align Top" aria-label="Align Top" onClick={() => studioActions.onAlign('top')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h12" stroke="currentColor" stroke-width="1.3" /><rect x="4" y="4.5" width="3" height="8" fill="currentColor" /><rect x="9" y="4.5" width="3" height="5" fill="currentColor" /></svg>
        </button>
        <button type="button" class="inspector-icon-btn" title="Align Vertical Middle" aria-label="Align Vertical Middle" onClick={() => studioActions.onAlign('vertical-center')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.2" /><rect x="4" y="3" width="3" height="10" fill="currentColor" /><rect x="9" y="5" width="3" height="6" fill="currentColor" /></svg>
        </button>
        <button type="button" class="inspector-icon-btn" title="Align Bottom" aria-label="Align Bottom" onClick={() => studioActions.onAlign('bottom')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 14h12" stroke="currentColor" stroke-width="1.3" /><rect x="4" y="3.5" width="3" height="8" fill="currentColor" /><rect x="9" y="6.5" width="3" height="5" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          class="inspector-icon-btn"
          disabled={!canDistribute}
          title={canDistribute ? 'Distribute Horizontal Centers' : 'Select 3+ layers to distribute horizontally'}
          aria-label="Distribute Horizontally"
          onClick={() => studioActions.onDistribute('horizontal')}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1.2" /><rect x="6" y="4.5" width="4" height="7" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          class="inspector-icon-btn"
          disabled={!canDistribute}
          title={canDistribute ? 'Distribute Vertical Centers' : 'Select 3+ layers to distribute vertically'}
          aria-label="Distribute Vertically"
          onClick={() => studioActions.onDistribute('vertical')}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1.2" /><rect x="4.5" y="6" width="7" height="4" fill="currentColor" /></svg>
        </button>
      </div>
    </section>
  );
}

export interface InspectorColorSwatchesSectionProps {
  documentNodes: readonly DesignNode[];
  studioActions: StudioVectorActions;
  activeFill?: string;
  activeStroke?: string;
}

export function InspectorColorSwatchesSection({
  documentNodes,
  studioActions,
  activeFill,
  activeStroke,
}: InspectorColorSwatchesSectionProps) {
  const docSwatches = extractDocumentSwatches(documentNodes, 10);
  const normalizedFill = activeFill?.toUpperCase();
  const normalizedStroke = activeStroke?.toUpperCase();

  return (
    <section class="property-section" aria-label="Color Swatches">
      <div class="section-title-row">
        <span class="section-title">Swatches</span>
        <div class="inspector-mini-inline">
          <button
            type="button"
            class="inspector-inline-chip"
            title="Swap Fill and Stroke colors (Illustrator Shift+X)"
            onClick={studioActions.onSwapFillAndStroke}
          >
            Swap ⇄
          </button>
          <button
            type="button"
            class="inspector-inline-chip"
            title="Reset default White Fill / Dark Stroke (Illustrator D)"
            onClick={studioActions.onResetDefaultColors}
          >
            Default
          </button>
        </div>
      </div>

      <div class="swatch-palette-grid" role="group" aria-label="Studio color palette">
        <button
          type="button"
          class="swatch-cell swatch-cell-none"
          title="No Fill (Right-click or Shift+Click for No Stroke)"
          aria-label="Remove fill or stroke"
          onClick={(event) => studioActions.onApplySwatch('none', event.shiftKey ? 'stroke' : 'fill')}
          onContextMenu={(event) => {
            event.preventDefault();
            studioActions.onApplySwatch('none', 'stroke');
          }}
        />
        {STUDIO_COLOR_SWATCHES.map((swatch) => {
          const isFillMatch = normalizedFill === swatch.hex;
          const isStrokeMatch = normalizedStroke === swatch.hex;
          return (
            <button
              key={swatch.hex}
              type="button"
              class={`swatch-cell${isFillMatch ? ' is-fill-active' : ''}${isStrokeMatch ? ' is-stroke-active' : ''}`}
              style={{ backgroundColor: swatch.hex }}
              title={`${swatch.name} (${swatch.hex}) · Click: Fill · Right-click / Shift+Click: Stroke`}
              aria-label={`Apply ${swatch.name} swatch`}
              onClick={(event) => studioActions.onApplySwatch(swatch.hex, event.shiftKey ? 'stroke' : 'fill')}
              onContextMenu={(event) => {
                event.preventDefault();
                studioActions.onApplySwatch(swatch.hex, 'stroke');
              }}
            />
          );
        })}
      </div>

      {docSwatches.length > 0 && (
        <div class="swatch-doc-group">
          <span class="inspector-sublabel">Document Colors</span>
          <div class="swatch-doc-row">
            {docSwatches.map((hex) => (
              <button
                key={hex}
                type="button"
                class={`swatch-cell${normalizedFill === hex ? ' is-fill-active' : ''}`}
                style={{ backgroundColor: hex }}
                title={`Document color ${hex} · Click: Fill · Right-click / Shift+Click: Stroke`}
                aria-label={`Apply document color ${hex}`}
                onClick={(event) => studioActions.onApplySwatch(hex, event.shiftKey ? 'stroke' : 'fill')}
                onContextMenu={(event) => {
                  event.preventDefault();
                  studioActions.onApplySwatch(hex, 'stroke');
                }}
              />
            ))}
          </div>
        </div>
      )}
      <p class="inspector-swatch-tip">Click = Fill · Right-click or Shift+Click = Stroke</p>
    </section>
  );
}

export interface InspectorStrokePenSectionProps {
  selectedNode: DesignNode;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
  studioActions?: StudioVectorActions;
}

export function InspectorStrokePenSection({
  selectedNode,
  onUpdateSelected,
  onUpdateSelectedStyle,
  studioActions,
}: InspectorStrokePenSectionProps) {
  if (
    selectedNode.type !== 'rect' &&
    selectedNode.type !== 'ellipse' &&
    selectedNode.type !== 'frame' &&
    selectedNode.type !== 'path' &&
    selectedNode.type !== 'image'
  ) {
    return null;
  }

  const currentStrokeWidth = selectedNode.style.strokeWidth ?? 0;
  const isPath = selectedNode.type === 'path';
  const pathNode: PathNode | null = isPath ? selectedNode : null;

  const caps: readonly { readonly id: NonNullable<PathNode['style']['strokeLinecap']>; readonly label: string }[] = [
    { id: 'butt', label: 'Butt' },
    { id: 'round', label: 'Round' },
    { id: 'square', label: 'Square' },
  ];

  const joins: readonly { readonly id: NonNullable<PathNode['style']['strokeLinejoin']>; readonly label: string }[] = [
    { id: 'miter', label: 'Miter' },
    { id: 'round', label: 'Round' },
    { id: 'bevel', label: 'Bevel' },
  ];

  const fillRules: readonly { readonly id: NonNullable<PathNode['style']['fillRule']>; readonly label: string }[] = [
    { id: 'nonzero', label: 'Non-Zero' },
    { id: 'evenodd', label: 'Even-Odd' },
  ];

  return (
    <div class="stroke-pen-block">
      <div class="inspector-sublabel-row">
        <span class="inspector-sublabel">Outline Pen Width</span>
        <span class="inspector-sublabel-val">{currentStrokeWidth}px</span>
      </div>
      <div class="stroke-preset-row" role="group" aria-label="Stroke width presets">
        {STROKE_WIDTH_PRESETS.map((widthPx) => (
          <button
            key={widthPx}
            type="button"
            class={`inspector-mini-btn${currentStrokeWidth === widthPx ? ' is-active' : ''}`}
            aria-pressed={currentStrokeWidth === widthPx}
            onClick={() => {
              const hasStrokeColor = selectedNode.style.stroke && selectedNode.style.stroke !== '#00000000';
              onUpdateSelectedStyle({
                strokeWidth: widthPx,
                ...(widthPx > 0 && !hasStrokeColor ? { stroke: '#1E293B' } : {}),
              });
            }}
          >
            {widthPx === 0 ? 'None' : `${widthPx}px`}
          </button>
        ))}
      </div>

      {pathNode && (
        <>
          <div class="stroke-seg-row">
            <span class="inspector-sublabel">Line Cap</span>
            <div class="style-segmented-row cols-3" role="group" aria-label="Stroke line cap">
              {caps.map((cap) => {
                const active = (pathNode.style.strokeLinecap ?? 'round') === cap.id;
                return (
                  <button
                    key={cap.id}
                    type="button"
                    class={`style-seg-btn${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => onUpdateSelectedStyle({ strokeLinecap: cap.id })}
                  >
                    {cap.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div class="stroke-seg-row">
            <span class="inspector-sublabel">Corner Join</span>
            <div class="style-segmented-row cols-3" role="group" aria-label="Stroke corner join">
              {joins.map((join) => {
                const active = (pathNode.style.strokeLinejoin ?? 'round') === join.id;
                return (
                  <button
                    key={join.id}
                    type="button"
                    class={`style-seg-btn${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => onUpdateSelectedStyle({ strokeLinejoin: join.id })}
                  >
                    {join.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Dash Pattern</span>
          </div>
          <div class="stroke-preset-row" role="group" aria-label="Stroke dash pattern presets">
            {STROKE_DASH_PRESETS.map((preset) => {
              const active = (pathNode.style.strokeDasharray ?? '') === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  class={`inspector-mini-btn${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => onUpdateSelectedStyle({ strokeDasharray: preset.value })}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div class="field-grid single-row">
            <label class="field-label">
              Custom Dash
              <input
                class="text-field"
                placeholder="e.g. 8 4 2 4"
                value={pathNode.style.strokeDasharray ?? ''}
                onInput={(event) => onUpdateSelectedStyle({ strokeDasharray: event.currentTarget.value })}
              />
            </label>
            <div class="field-label">
              Fill Rule
              <div class="style-segmented-row cols-2" role="group" aria-label="Vector fill rule">
                {fillRules.map((rule) => {
                  const active = (pathNode.style.fillRule ?? 'nonzero') === rule.id;
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      class={`style-seg-btn${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => onUpdateSelectedStyle({ fillRule: rule.id })}
                    >
                      {rule.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!pathNode.closed && (
            <div class="stroke-arrow-row">
              <label class="toggle-row compact-toggle">
                <span>Start Arrow</span>
                <input
                  type="checkbox"
                  checked={Boolean(pathNode.style.arrowStart)}
                  onChange={(event) =>
                    onUpdateSelected({
                      style: { ...pathNode.style, arrowStart: event.currentTarget.checked },
                    } as Partial<DesignNode>)
                  }
                />
              </label>
              <label class="toggle-row compact-toggle">
                <span>End Arrow</span>
                <input
                  type="checkbox"
                  checked={Boolean(pathNode.style.arrowEnd)}
                  onChange={(event) =>
                    onUpdateSelected({
                      style: { ...pathNode.style, arrowEnd: event.currentTarget.checked },
                    } as Partial<DesignNode>)
                  }
                />
              </label>
              {studioActions && (
                <button
                  type="button"
                  class="inspector-mini-btn"
                  title="Reverse vector path direction (flips start/end arrowheads)"
                  onClick={studioActions.onReversePath}
                >
                  Reverse ⇄
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShapingGlyph({ op }: { op: PathfinderOperation | 'divide' | 'builder' }) {
  if (op === 'unite') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4h4v8H7v-4H3V3z" fill="currentColor" />
      </svg>
    );
  }
  if (op === 'subtract') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4H7v4H3V3z" fill="currentColor" />
        <rect x="7" y="7" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5" />
      </svg>
    );
  }
  if (op === 'minus-back') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5" />
        <path d="M11 7h4v8H7v-4h4V7z" fill="currentColor" />
      </svg>
    );
  }
  if (op === 'intersect') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.15" opacity="0.55" />
        <rect x="7" y="7" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.15" opacity="0.55" />
        <rect x="7" y="7" width="4" height="4" fill="currentColor" />
      </svg>
    );
  }
  if (op === 'exclude') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4H7v4H3V3zm8 4h4v8H7v-4h4V7z" fill="currentColor" />
      </svg>
    );
  }
  if (op === 'divide') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4H7v4H3V3z" fill="currentColor" opacity="0.65" />
        <rect x="7" y="7" width="4" height="4" fill="currentColor" />
        <path d="M11 7h4v8H7v-4h4V7z" fill="currentColor" opacity="0.65" />
        <path d="M7 7v4h4V7H7z" fill="none" stroke="#11141b" stroke-width="1.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="7" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.35" />
      <circle cx="11.5" cy="10" r="4.5" fill="currentColor" opacity="0.45" stroke="currentColor" stroke-width="1.2" />
    </svg>
  );
}

export interface InspectorVectorShapingSectionProps {
  activeEditorId: EditorTarget;
  selectedNode: DesignNode | null;
  selectedNodes: readonly DesignNode[];
  studioActions: StudioVectorActions;
  onConvertToPath: (target: EditorTarget) => void;
  onTogglePathClosed: (target: EditorTarget) => void;
  onSimplifyPath: (target: EditorTarget) => void;
  onChooseTool: (toolId: CanvasToolId, target: EditorTarget) => void;
}

export function InspectorVectorShapingSection({
  activeEditorId,
  selectedNode,
  selectedNodes,
  studioActions,
  onConvertToPath,
  onTogglePathClosed,
  onSimplifyPath,
  onChooseTool,
}: InspectorVectorShapingSectionProps) {
  const [offsetDistance, setOffsetDistance] = useState(8);
  const [keepOriginalOffset, setKeepOriginalOffset] = useState(true);

  const booleanCandidates = selectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path',
  );
  const canPathfinder = booleanCandidates.length >= 2;
  const convertibleCount = selectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  ).length;
  const pathNodes = selectedNodes.filter((node): node is PathNode => node.type === 'path');
  const firstPath = selectedNode?.type === 'path' ? selectedNode : (pathNodes[0] ?? null);
  const canOffset = booleanCandidates.length > 0;

  if (!canPathfinder && !canOffset && pathNodes.length === 0) return null;

  return (
    <section class="property-section" aria-label="Vector Shaping and Path Craft">
      <div class="section-title-row">
        <span class="section-title">Pathfinder &amp; Vector Craft</span>
        {firstPath && <span class="inspector-scope-badge">{firstPath.points.length} PTS</span>}
      </div>

      {(canPathfinder || activeEditorId === 'component') && (
        <>
          <div class="shaping-grid" role="group" aria-label="Pathfinder boolean shaping operations">
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Unite / Weld — combine shapes into one vector contour"
              onClick={() => studioActions.onPathfinder('unite')}
            >
              <ShapingGlyph op="unite" />
              <span>Unite</span>
            </button>
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Subtract / Minus Front — trim top shape from back shape"
              onClick={() => studioActions.onPathfinder('subtract')}
            >
              <ShapingGlyph op="subtract" />
              <span>Subtract</span>
            </button>
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Minus Back — trim back shape from top shape"
              onClick={() => studioActions.onPathfinder('minus-back')}
            >
              <ShapingGlyph op="minus-back" />
              <span>Minus Back</span>
            </button>
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Intersect — keep only overlapping region"
              onClick={() => studioActions.onPathfinder('intersect')}
            >
              <ShapingGlyph op="intersect" />
              <span>Intersect</span>
            </button>
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Exclude — punch out overlapping area"
              onClick={() => studioActions.onPathfinder('exclude')}
            >
              <ShapingGlyph op="exclude" />
              <span>Exclude</span>
            </button>
            <button
              type="button"
              class="shaping-btn"
              disabled={!canPathfinder}
              title="Divide — break overlapping shapes into individual editable regions"
              onClick={studioActions.onDividePathfinder}
            >
              <ShapingGlyph op="divide" />
              <span>Divide</span>
            </button>
          </div>
          <button
            type="button"
            class="inspector-studio-secondary-btn"
            disabled={!canPathfinder}
            title="Shape Builder (Shift+M) — interactively merge or punch overlapping regions on canvas"
            onClick={() => onChooseTool('shape-builder', activeEditorId)}
          >
            <ShapingGlyph op="builder" />
            <span>Interactive Shape Builder (Shift+M)</span>
          </button>
          {studioActions.onCombineSelection && (
            <button
              type="button"
              class="inspector-studio-secondary-btn"
              disabled={selectedNodes.length < 2}
              title="Combine into 1 Object — unify all selected objects into a single object"
              onClick={studioActions.onCombineSelection}
            >
              <ShapingGlyph op="unite" />
              <span>Combine into 1 Object</span>
            </button>
          )}
        </>
      )}

      {selectedNode?.type === 'path' && selectedNode.shapeMeta && (
        <div class="parametric-shape-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">
              {selectedNode.shapeMeta.kind === 'polygon' ? 'Live Polygon' : 'Live Star'}
            </span>
          </div>
          {selectedNode.shapeMeta.kind === 'polygon' ? (
            <label class="field-label">
              Sides
              <input
                class="number-field"
                type="number"
                min="3"
                max="24"
                value={selectedNode.shapeMeta.sides}
                onInput={(event) => {
                  const sides = Math.max(3, Math.min(24, Math.round(Number(event.currentTarget.value) || 6)));
                  studioActions.onUpdateParametricShape({ kind: 'polygon', sides });
                }}
              />
            </label>
          ) : (
            <div class="field-grid single-row">
              <label class="field-label">
                Spikes
                <input
                  class="number-field"
                  type="number"
                  min="3"
                  max="24"
                  value={selectedNode.shapeMeta.spikes}
                  onInput={(event) => {
                    if (selectedNode.shapeMeta?.kind !== 'star') return;
                    const spikes = Math.max(3, Math.min(24, Math.round(Number(event.currentTarget.value) || 5)));
                    studioActions.onUpdateParametricShape({
                      kind: 'star',
                      spikes,
                      innerRatio: selectedNode.shapeMeta.innerRatio,
                    });
                  }}
                />
              </label>
              <label class="field-label">
                Inner Ratio %
                <input
                  class="number-field"
                  type="number"
                  min="15"
                  max="90"
                  value={Math.round(selectedNode.shapeMeta.innerRatio * 100)}
                  onInput={(event) => {
                    if (selectedNode.shapeMeta?.kind !== 'star') return;
                    const pct = Math.max(15, Math.min(90, Math.round(Number(event.currentTarget.value) || 44)));
                    studioActions.onUpdateParametricShape({
                      kind: 'star',
                      spikes: selectedNode.shapeMeta.spikes,
                      innerRatio: Number((pct / 100).toFixed(2)),
                    });
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {canOffset && (
        <div class="offset-path-card">
          <div class="inspector-sublabel-row">
            <span class="inspector-sublabel">Offset / Contour Path</span>
            <label class="offset-keep-toggle">
              <input
                type="checkbox"
                checked={keepOriginalOffset}
                onChange={(event) => setKeepOriginalOffset(event.currentTarget.checked)}
              />
              <span>Keep original</span>
            </label>
          </div>
          <div class="offset-path-row">
            <input
              class="number-field"
              type="number"
              min="-64"
              max="64"
              step="1"
              aria-label="Offset distance in pixels"
              value={offsetDistance}
              onInput={(event) => {
                const parsed = Number(event.currentTarget.value);
                if (Number.isFinite(parsed)) setOffsetDistance(Math.max(-64, Math.min(64, parsed)));
              }}
            />
            <span class="offset-unit">px</span>
            <button
              type="button"
              class="inspector-mini-btn is-accent"
              onClick={() => studioActions.onOffsetPath(offsetDistance, keepOriginalOffset)}
            >
              Apply Offset
            </button>
          </div>
        </div>
      )}

      <div class="inspector-path-craft-grid" role="group" aria-label="Bezier path operations">
        {convertibleCount > 0 && (
          <button type="button" class="inspector-mini-btn" onClick={() => onConvertToPath(activeEditorId)}>
            To Path
          </button>
        )}
        {firstPath && (
          <>
            <button type="button" class="inspector-mini-btn" onClick={() => onChooseTool('direct-selection', activeEditorId)}>
              Anchors (A)
            </button>
            <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onConvertAllAnchors('smooth')}>
              Smooth All
            </button>
            <button type="button" class="inspector-mini-btn" onClick={() => studioActions.onConvertAllAnchors('corner')}>
              Sharpen All
            </button>
            <button type="button" class="inspector-mini-btn" onClick={() => onSimplifyPath(activeEditorId)}>
              Simplify
            </button>
            <button type="button" class="inspector-mini-btn" onClick={studioActions.onReversePath}>
              Reverse
            </button>
            <button type="button" class="inspector-mini-btn" onClick={() => onTogglePathClosed(activeEditorId)}>
              {firstPath.closed ? 'Open Path' : 'Close Path'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

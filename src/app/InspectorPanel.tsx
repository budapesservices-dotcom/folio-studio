import type { JSX, RefObject } from 'preact';
import { CURATED_FONT_FAMILIES } from '../core/document/fonts';
import type {
  AssetReference,
  BreakpointId,
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DesignTokenCollection,
  EllipseNode,
  FrameNode,
  ImageFitMode,
  PathNode,
  RectNode,
  TextNode,
} from '../core/document/types';
import { PANEL_RESIZE_CONSTRAINTS, type ResizablePanelId } from './panelResize';
import { normalizePositiveDimension } from './editorReducer';
import type { EditorTarget } from './editorContext';
import type { CanvasToolId } from '../core/tools/operationContract';
import { InspectorWebLayoutSection } from './workspace/InspectorWebLayoutSection';
import { InspectorComponentContractSection } from './workspace/InspectorComponentContractSection';
import { InspectorEffectsAndStyleSection } from './workspace/InspectorEffectsAndStyleSection';

export const INSPECTOR_FONT_FAMILIES = CURATED_FONT_FAMILIES.map((entry) => ({
  label: entry.label,
  value: entry.value,
}));

export interface InspectorOverrideTargets {
  fillNode?: FrameNode | RectNode | EllipseNode | PathNode | TextNode | null;
  textNode?: TextNode | null;
}

export interface InspectorPanelProps {
  visible: boolean;
  width: number;
  isResizing: boolean;
  resizeHandleRef: RefObject<HTMLDivElement>;
  activeEditorId: EditorTarget;
  selectedNode: DesignNode | null;
  selectedNodes: readonly DesignNode[];
  selectedCount: number;
  canRemoveFromCanvas: boolean;
  selectedInstanceComponent: ComponentDefinition | null;
  editingMasterComponent?: ComponentDefinition | null;
  instanceOverrideTargets: InspectorOverrideTargets | null;
  activeBreakpoint: BreakpointId;
  designTokens: DesignTokenCollection;
  assets?: readonly AssetReference[];
  defaultFillColor: string;
  renderIcon: (name: 'trash' | 'layers' | 'cursor') => JSX.Element;
  onStartResize: (panel: ResizablePanelId, event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  onResizeDoubleClick: (panel: ResizablePanelId, event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (panel: ResizablePanelId, event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
  onCommitEdit: () => void;
  onHoverHint: () => void;
  onRemoveFromCanvas: (nodeId: string) => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyle: (patch: Record<string, string | number>) => void;
  onApplyAutoLayout: (containerId: string) => void;
  onUpdateInstanceOverride: (childNodeId: string, patch: { fill?: string; text?: string }) => void;
  onUpdateInstanceVariant: (axisId: string, optionId: string) => void;
  onUpdateInstanceSlot: (slotId: string, patch: { text?: string; visible?: boolean }) => void;
  onUpdateMasterContract: (
    component: ComponentDefinition,
    patch: {
      variants?: ComponentVariantAxis[];
      slots?: ComponentSlotDefinition[];
      nodeLogicEnabled?: boolean;
    },
  ) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  onResetInstanceOverrides: () => void;
  onDetachInstance: () => void;
  onConvertToPath: (target: EditorTarget) => void;
  onTogglePathClosed: (target: EditorTarget) => void;
  onSimplifyPath: (target: EditorTarget) => void;
  onChooseTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  onQuickAdd: (type: 'rect' | 'text') => void;
  onInsertImageFiles?: (files: readonly File[]) => void;
  onDuplicateSelection: () => void;
  onCopySelection: () => void;
}

function parseNumericInput(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function InspectorPanel({
  visible,
  width,
  isResizing,
  resizeHandleRef,
  activeEditorId,
  selectedNode,
  selectedNodes,
  selectedCount,
  canRemoveFromCanvas,
  selectedInstanceComponent,
  editingMasterComponent = null,
  instanceOverrideTargets,
  activeBreakpoint,
  designTokens,
  assets = [],
  defaultFillColor,
  renderIcon,
  onStartResize,
  onResizeDoubleClick,
  onResizeKeyDown,
  onCommitEdit,
  onHoverHint,
  onRemoveFromCanvas,
  onUpdateSelected,
  onUpdateSelectedStyle,
  onApplyAutoLayout,
  onUpdateInstanceOverride,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
  onUpdateMasterContract,
  onToggleComponentNodeLogic,
  onResetInstanceOverrides,
  onDetachInstance,
  onConvertToPath,
  onTogglePathClosed,
  onSimplifyPath,
  onChooseTool,
  onQuickAdd,
  onInsertImageFiles,
  onDuplicateSelection,
  onCopySelection,
}: InspectorPanelProps) {
  const triggerImagePicker = () => {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('folio-inspector-image-input') as HTMLInputElement | null;
    input?.click();
  };
  const safeSelectedNodes = Array.isArray(selectedNodes) ? selectedNodes : [];
  const effectiveSelectedCount = Math.min(selectedCount, safeSelectedNodes.length);
  const hasConvertibleInMulti = safeSelectedNodes.some(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  );
  const hasPathsInMulti = safeSelectedNodes.some((node) => node.type === 'path');
  const selectedIdsSet = new Set(safeSelectedNodes.map((n) => n.id));
  const selectedRootNodes = safeSelectedNodes.filter((n) => !n.parentId || !selectedIdsSet.has(n.parentId));
  const singleRootContainer =
    !selectedNode &&
    selectedRootNodes.length === 1 &&
    (selectedRootNodes[0].type === 'frame' || selectedRootNodes[0].type === 'group')
      ? selectedRootNodes[0]
      : null;

  return (
    <aside
      class={`inspector-panel ${visible ? '' : 'is-hidden'}`}
      aria-hidden={!visible}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onCommitEdit();
        }
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key === 'Enter' && target.matches('input:not([type="checkbox"]):not([type="range"])')) {
          event.preventDefault();
          target.blur();
          onCommitEdit();
        }
      }}
      onMouseEnter={onHoverHint}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Inspector panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_RESIZE_CONSTRAINTS.inspector.minWidth}
        aria-valuemax={PANEL_RESIZE_CONSTRAINTS.inspector.maxWidth}
        tabIndex={visible ? 0 : -1}
        data-resize-panel="inspector"
        class={`panel-resize-handle panel-resize-handle-left ${isResizing ? 'is-active' : ''}`}
        title="Drag to resize Inspector panel (double-click to reset)"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => onStartResize('inspector', event)}
        onDblClick={(event) => onResizeDoubleClick('inspector', event)}
        onKeyDown={(event) => onResizeKeyDown('inspector', event)}
      />
      <input
        id="folio-inspector-image-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          const fileList = event.currentTarget.files;
          if (fileList && fileList.length > 0 && onInsertImageFiles) {
            onInsertImageFiles(Array.from(fileList));
          }
          event.currentTarget.value = '';
        }}
      />
      <div class="panel-heading inspector-heading">
        <div>
          <span class="panel-kicker">PROPERTIES</span>
          <h2>Inspector</h2>
          <span class={`panel-context-indicator${activeEditorId === 'component' ? ' is-component' : ''}`}>
            {activeEditorId === 'component' ? 'COMPONENT CANVAS' : 'MAIN PAGE'}
          </span>
        </div>
        {selectedNode && canRemoveFromCanvas && (
          <button
            class="icon-button danger"
            title="Remove from Canvas only"
            aria-label="Remove from Canvas only"
            onClick={() => onRemoveFromCanvas(selectedNode.id)}
          >
            {renderIcon('trash')}
          </button>
        )}
      </div>

      {selectedNode ? (
        <div class="inspector-content">
          <section class="property-section">
            <div class="section-title">Layer</div>
            <label class="field-label">
              Name
              <input
                class="text-field"
                value={selectedNode.name}
                onInput={(event) => onUpdateSelected({ name: event.currentTarget.value })}
              />
            </label>
          </section>

          <section class="property-section">
            <div class="section-title">Position</div>
            <div class="field-grid">
              <label class="field-label">
                X
                <input
                  class="number-field"
                  type="number"
                  value={Math.round(selectedNode.x)}
                  onInput={(event) => {
                    const value = parseNumericInput(event.currentTarget.value);
                    if (value !== null) onUpdateSelected({ x: value });
                  }}
                />
              </label>
              <label class="field-label">
                Y
                <input
                  class="number-field"
                  type="number"
                  value={Math.round(selectedNode.y)}
                  onInput={(event) => {
                    const value = parseNumericInput(event.currentTarget.value);
                    if (value !== null) onUpdateSelected({ y: value });
                  }}
                />
              </label>
              <label class="field-label">
                W
                <input
                  class="number-field"
                  type="number"
                  min="1"
                  value={Math.round(selectedNode.width)}
                  onInput={(event) => {
                    const value = parseNumericInput(event.currentTarget.value);
                    if (value !== null) {
                      onUpdateSelected({ width: normalizePositiveDimension(value, selectedNode.width) });
                    }
                  }}
                />
              </label>
              <label class="field-label">
                H
                <input
                  class="number-field"
                  type="number"
                  min="1"
                  value={Math.round(selectedNode.height)}
                  onInput={(event) => {
                    const value = parseNumericInput(event.currentTarget.value);
                    if (value !== null) {
                      onUpdateSelected({ height: normalizePositiveDimension(value, selectedNode.height) });
                    }
                  }}
                />
              </label>
            </div>
            <label class="field-label rotation-field">
              Rotation
              <input
                class="number-field"
                type="number"
                value={selectedNode.rotation}
                onInput={(event) => {
                  const value = parseNumericInput(event.currentTarget.value);
                  if (value !== null) onUpdateSelected({ rotation: value });
                }}
              />
            </label>
          </section>

          <section class="property-section">
            <div class="section-title">Appearance</div>
            <label class="field-label">
              Opacity
              <div class="opacity-control-row">
                <input
                  class="opacity-range"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Opacity percentage slider"
                  value={Math.round(selectedNode.opacity * 100)}
                  onInput={(event) => {
                    const value = parseNumericInput(event.currentTarget.value);
                    if (value !== null) {
                      onUpdateSelected({ opacity: Math.min(1, Math.max(0, Math.round(value) / 100)) });
                    }
                  }}
                />
                <div class="opacity-number-wrap">
                  <input
                    class="number-field opacity-number-field"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="Opacity percentage"
                    value={Math.round(selectedNode.opacity * 100)}
                    onInput={(event) => {
                      const value = parseNumericInput(event.currentTarget.value);
                      if (value !== null) {
                        onUpdateSelected({ opacity: Math.min(1, Math.max(0, Math.round(value) / 100)) });
                      }
                    }}
                  />
                  <span class="opacity-unit">%</span>
                </div>
              </div>
            </label>

            {selectedNode.type === 'component-instance' ? (
              <>
                <span class="field-help">
                  LINKED MASTER · {selectedInstanceComponent?.name ?? 'Missing component'}
                </span>
                {instanceOverrideTargets?.fillNode && (() => {
                  const target = instanceOverrideTargets.fillNode;
                  const value = selectedNode.overrides[target.id]?.fill ?? target.style.fill;
                  return (
                    <>
                      <label class="field-label">Instance fill override</label>
                      <div class="color-field-wrap">
                        <input
                          class="color-swatch"
                          type="color"
                          value={value.startsWith('#') && value.length === 7 ? value : '#8B7CF6'}
                          onInput={(event) => onUpdateInstanceOverride(target.id, { fill: event.currentTarget.value })}
                        />
                        <span class="color-value">{value.toUpperCase()}</span>
                      </div>
                    </>
                  );
                })()}
                {instanceOverrideTargets?.textNode && (() => {
                  const target = instanceOverrideTargets.textNode;
                  return (
                    <>
                      <label class="field-label text-content-label">Instance text override</label>
                      <textarea
                        class="text-area-field"
                        rows={3}
                        value={selectedNode.overrides[target.id]?.text ?? target.text}
                        onInput={(event) => onUpdateInstanceOverride(target.id, { text: event.currentTarget.value })}
                      />
                    </>
                  );
                })()}
                <div class="instance-actions">
                  <button
                    type="button"
                    onClick={onResetInstanceOverrides}
                    disabled={Object.keys(selectedNode.overrides).length === 0}
                  >
                    Reset Overrides
                  </button>
                  <button type="button" onClick={onDetachInstance}>
                    Detach Instance
                  </button>
                </div>
              </>
            ) : selectedNode.type === 'group' ? (
              <span class="field-help">GROUP CONTAINER · Holds child layers as one hierarchy.</span>
            ) : selectedNode.type === 'image' ? (
              <>
                {(() => {
                  const linkedAsset = assets.find((item) => item.id === selectedNode.assetId);
                  return (
                    <div class="vector-meta-row">
                      <span>Image Asset</span>
                      <strong>
                        {linkedAsset?.width && linkedAsset?.height
                          ? `${linkedAsset.width}×${linkedAsset.height}px`
                          : (linkedAsset?.name ?? selectedNode.assetId)}
                      </strong>
                    </div>
                  );
                })()}
                <label class="field-label range-label">
                  Object fit
                  <select
                    class="select-field"
                    aria-label="Image fit mode"
                    value={selectedNode.style.fit}
                    onChange={(event) =>
                      onUpdateSelectedStyle({ fit: event.currentTarget.value as ImageFitMode })
                    }
                  >
                    <option value="cover">Cover (Crop to fill)</option>
                    <option value="contain">Contain (Fit inside)</option>
                    <option value="fill">Fill (Stretch)</option>
                  </select>
                </label>
                <label class="field-label range-label">
                  Alt text
                  <input
                    class="text-field"
                    placeholder="Describe this image for accessibility"
                    value={selectedNode.alt ?? ''}
                    onInput={(event) => onUpdateSelected({ alt: event.currentTarget.value } as Partial<DesignNode>)}
                  />
                </label>
                <label class="field-label range-label">Stroke</label>
                <div class="color-field-wrap">
                  <input
                    class="color-swatch"
                    type="color"
                    value={
                      selectedNode.style.stroke && selectedNode.style.stroke.startsWith('#') && selectedNode.style.stroke.length >= 7
                        ? selectedNode.style.stroke.slice(0, 7)
                        : '#20212A'
                    }
                    onInput={(event) =>
                      onUpdateSelectedStyle({
                        stroke: event.currentTarget.value,
                        strokeWidth: Math.max(1, selectedNode.style.strokeWidth ?? 0),
                      })
                    }
                  />
                  <span class="color-value">{(selectedNode.style.stroke ?? 'none').toUpperCase()}</span>
                  <input
                    class="number-field inspector-stroke-width"
                    type="number"
                    min="0"
                    max="32"
                    step="0.5"
                    aria-label="Stroke width"
                    value={selectedNode.style.strokeWidth ?? 0}
                    onInput={(event) => {
                      const value = parseNumericInput(event.currentTarget.value);
                      if (value !== null) onUpdateSelectedStyle({ strokeWidth: Math.max(0, value) });
                    }}
                  />
                </div>
                <label class="field-label range-label">
                  Corner radius
                  <input
                    class="number-field"
                    type="number"
                    min="0"
                    value={selectedNode.style.radius ?? 0}
                    onInput={(event) => {
                      const value = parseNumericInput(event.currentTarget.value);
                      if (value !== null) onUpdateSelectedStyle({ radius: Math.max(0, value) });
                    }}
                  />
                </label>
              </>
            ) : (
              <>
                <label class="field-label range-label">Fill</label>
                <div class="color-field-wrap">
                  <input
                    class="color-swatch"
                    type="color"
                    value={
                      selectedNode.style.fill.startsWith('#') && selectedNode.style.fill.length >= 7
                        ? selectedNode.style.fill.slice(0, 7)
                        : '#8B7CF6'
                    }
                    onInput={(event) => onUpdateSelectedStyle({ fill: event.currentTarget.value })}
                  />
                  <span class="color-value">{selectedNode.style.fill.toUpperCase()}</span>
                  {(selectedNode.type === 'path' || selectedNode.type === 'frame') && (
                    <button
                      type="button"
                      class="inspector-inline-chip"
                      onClick={() =>
                        onUpdateSelectedStyle({
                          fill: selectedNode.style.fill === 'none' ? defaultFillColor : 'none',
                        })
                      }
                    >
                      {selectedNode.style.fill === 'none' ? 'Add Fill' : 'None'}
                    </button>
                  )}
                </div>
                {(selectedNode.type === 'rect' ||
                  selectedNode.type === 'ellipse' ||
                  selectedNode.type === 'frame' ||
                  selectedNode.type === 'path') && (
                  <>
                    <label class="field-label range-label">Stroke</label>
                    <div class="color-field-wrap">
                      <input
                        class="color-swatch"
                        type="color"
                        value={
                          selectedNode.style.stroke.startsWith('#') && selectedNode.style.stroke.length >= 7
                            ? selectedNode.style.stroke.slice(0, 7)
                            : '#20212A'
                        }
                        onInput={(event) =>
                          onUpdateSelectedStyle({
                            stroke: event.currentTarget.value,
                            strokeWidth: Math.max(1, selectedNode.style.strokeWidth),
                          })
                        }
                      />
                      <span class="color-value">{selectedNode.style.stroke.toUpperCase()}</span>
                      <input
                        class="number-field inspector-stroke-width"
                        type="number"
                        min="0"
                        max="32"
                        step="0.5"
                        aria-label="Stroke width"
                        value={selectedNode.style.strokeWidth}
                        onInput={(event) => {
                          const value = parseNumericInput(event.currentTarget.value);
                          if (value !== null) onUpdateSelectedStyle({ strokeWidth: Math.max(0, value) });
                        }}
                      />
                    </div>
                  </>
                )}
                {(selectedNode.type === 'rect' || selectedNode.type === 'frame') && (
                  <label class="field-label range-label">
                    Corner radius
                    <input
                      class="number-field"
                      type="number"
                      min="0"
                      value={selectedNode.style.radius ?? 0}
                      onInput={(event) => {
                        const value = parseNumericInput(event.currentTarget.value);
                        if (value !== null) onUpdateSelectedStyle({ radius: Math.max(0, value) });
                      }}
                    />
                  </label>
                )}
                {selectedNode.type === 'frame' && (
                  <label class="toggle-row">
                    <span>Clip content</span>
                    <input
                      type="checkbox"
                      checked={selectedNode.clipContent !== false}
                      onChange={(event) =>
                        onUpdateSelected({ clipContent: event.currentTarget.checked } as Partial<DesignNode>)
                      }
                    />
                  </label>
                )}
                {(selectedNode.type === 'rect' || selectedNode.type === 'ellipse' || selectedNode.type === 'frame') && (
                  <div class="instance-actions">
                    <button type="button" onClick={() => onConvertToPath(activeEditorId)}>
                      Convert to Vector Path
                    </button>
                  </div>
                )}
                {selectedNode.type === 'path' && (
                  <>
                    <div class="vector-meta-row">
                      <span>Vector Path</span>
                      <strong>{selectedNode.points.length} anchors</strong>
                    </div>
                    <label class="toggle-row">
                      <span>Closed contour</span>
                      <input
                        type="checkbox"
                        checked={selectedNode.closed}
                        onChange={() => onTogglePathClosed(activeEditorId)}
                      />
                    </label>
                    <label class="toggle-row">
                      <span>Dashed stroke</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.style.strokeDasharray)}
                        onChange={(event) =>
                          onUpdateSelectedStyle({ strokeDasharray: event.currentTarget.checked ? '8 5' : '' })
                        }
                      />
                    </label>
                    {!selectedNode.closed && (
                      <div class="field-grid single-row">
                        <label class="toggle-row">
                          <span>Start Arrow</span>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedNode.style.arrowStart)}
                            onChange={(event) =>
                              onUpdateSelected({
                                style: { ...selectedNode.style, arrowStart: event.currentTarget.checked },
                              } as Partial<DesignNode>)
                            }
                          />
                        </label>
                        <label class="toggle-row">
                          <span>End Arrow</span>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedNode.style.arrowEnd)}
                            onChange={(event) =>
                              onUpdateSelected({
                                style: { ...selectedNode.style, arrowEnd: event.currentTarget.checked },
                              } as Partial<DesignNode>)
                            }
                          />
                        </label>
                      </div>
                    )}
                    <div class="instance-actions">
                      <button type="button" onClick={() => onChooseTool('direct-selection', activeEditorId)}>
                        Edit Anchors (A)
                      </button>
                      <button type="button" onClick={() => onSimplifyPath(activeEditorId)}>
                        Simplify
                      </button>
                    </div>
                  </>
                )}
                {selectedNode.type === 'text' && (
                  <>
                    <label class="field-label text-content-label">
                      Text content
                      <textarea
                        class="text-area-field"
                        rows={3}
                        value={selectedNode.text}
                        onInput={(event) => onUpdateSelected({ text: event.currentTarget.value })}
                      />
                    </label>
                    <label class="field-label range-label">
                      Font family
                      <select
                        class="select-field"
                        aria-label="Font family"
                        value={selectedNode.style.fontFamily}
                        onChange={(event) => onUpdateSelectedStyle({ fontFamily: event.currentTarget.value })}
                      >
                        {!INSPECTOR_FONT_FAMILIES.some((opt) => opt.value === selectedNode.style.fontFamily) && (
                          <option value={selectedNode.style.fontFamily}>{selectedNode.style.fontFamily}</option>
                        )}
                        {INSPECTOR_FONT_FAMILIES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div class="field-grid single-row">
                      <label class="field-label">
                        Font size
                        <input
                          class="number-field"
                          type="number"
                          min="1"
                          value={selectedNode.style.fontSize}
                          onInput={(event) => {
                            const value = parseNumericInput(event.currentTarget.value);
                            if (value !== null) onUpdateSelectedStyle({ fontSize: Math.max(1, value) });
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Weight
                        <input
                          class="number-field"
                          type="number"
                          min="100"
                          max="900"
                          step="100"
                          value={selectedNode.style.fontWeight}
                          onInput={(event) => {
                            const value = parseNumericInput(event.currentTarget.value);
                            if (value !== null) {
                              onUpdateSelectedStyle({ fontWeight: Math.min(900, Math.max(100, value)) });
                            }
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Line height
                        <input
                          class="number-field"
                          type="number"
                          min="0.6"
                          max="4"
                          step="0.05"
                          value={selectedNode.style.lineHeight}
                          onInput={(event) => {
                            const value = parseNumericInput(event.currentTarget.value);
                            if (value !== null) {
                              onUpdateSelectedStyle({ lineHeight: Math.min(4, Math.max(0.6, Math.round(value * 100) / 100)) });
                            }
                          }}
                        />
                      </label>
                      <label class="field-label">
                        Letter spacing
                        <input
                          class="number-field"
                          type="number"
                          min="-10"
                          max="40"
                          step="0.5"
                          value={selectedNode.style.letterSpacing}
                          onInput={(event) => {
                            const value = parseNumericInput(event.currentTarget.value);
                            if (value !== null) {
                              onUpdateSelectedStyle({ letterSpacing: Math.min(40, Math.max(-10, Math.round(value * 100) / 100)) });
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div class="field-label range-label">
                      Alignment &amp; Wrap
                      <div class="style-segmented-row" role="group" aria-label="Text alignment">
                        {(['left', 'center', 'right'] as const).map((align) => (
                          <button
                            key={align}
                            type="button"
                            class={`style-seg-btn${(selectedNode.style.textAlign ?? 'left') === align ? ' is-active' : ''}`}
                            aria-pressed={(selectedNode.style.textAlign ?? 'left') === align}
                            onClick={() => onUpdateSelectedStyle({ textAlign: align })}
                          >
                            {align === 'left' ? 'Left' : align === 'center' ? 'Center' : 'Right'}
                          </button>
                        ))}
                        <button
                          type="button"
                          class={`style-seg-btn${(selectedNode.style.textWrap ?? 'wrap') === 'wrap' ? ' is-active' : ''}`}
                          aria-pressed={(selectedNode.style.textWrap ?? 'wrap') === 'wrap'}
                          title="Toggle automatic text wrapping inside width"
                          onClick={() =>
                            onUpdateSelectedStyle({
                              textWrap: (selectedNode.style.textWrap ?? 'wrap') === 'wrap' ? 'nowrap' : 'wrap',
                            })
                          }
                        >
                          {(selectedNode.style.textWrap ?? 'wrap') === 'wrap' ? 'Wrap' : 'No Wrap'}
                        </button>
                      </div>
                    </div>
                    <div class="field-grid single-row">
                      <label class="field-label">
                        Case
                        <select
                          class="select-field"
                          aria-label="Text transform"
                          value={selectedNode.style.textTransform ?? 'none'}
                          onChange={(event) => onUpdateSelectedStyle({ textTransform: event.currentTarget.value })}
                        >
                          <option value="none">Normal</option>
                          <option value="uppercase">UPPERCASE</option>
                          <option value="lowercase">lowercase</option>
                          <option value="capitalize">Title Case</option>
                        </select>
                      </label>
                      <label class="field-label">
                        Decoration
                        <select
                          class="select-field"
                          aria-label="Text decoration"
                          value={selectedNode.style.textDecoration ?? 'none'}
                          onChange={(event) => onUpdateSelectedStyle({ textDecoration: event.currentTarget.value })}
                        >
                          <option value="none">None</option>
                          <option value="underline">Underline</option>
                          <option value="line-through">Strike</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <InspectorEffectsAndStyleSection
            selectedNode={selectedNode}
            defaultFillColor={defaultFillColor}
            onUpdateSelected={onUpdateSelected}
          />

          <InspectorWebLayoutSection
            selectedNode={selectedNode}
            activeBreakpoint={activeBreakpoint}
            designTokens={designTokens}
            onUpdateSelected={onUpdateSelected}
            onApplyAutoLayout={onApplyAutoLayout}
          />

          <InspectorComponentContractSection
            instanceNode={selectedNode.type === 'component-instance' ? selectedNode : null}
            instanceComponent={selectedNode.type === 'component-instance' ? selectedInstanceComponent : null}
            editingMasterComponent={activeEditorId === 'component' ? editingMasterComponent : null}
            onUpdateInstanceVariant={onUpdateInstanceVariant}
            onUpdateInstanceSlot={onUpdateInstanceSlot}
            onUpdateMasterContract={onUpdateMasterContract}
            onToggleComponentNodeLogic={onToggleComponentNodeLogic}
          />

          <section class="property-section last-section">
            <div class="section-title">Layer options</div>
            <label class="toggle-row">
              <span>Visible</span>
              <input
                type="checkbox"
                checked={selectedNode.visible}
                onChange={(event) => onUpdateSelected({ visible: event.currentTarget.checked })}
              />
            </label>
            <label class="toggle-row">
              <span>Locked</span>
              <input
                type="checkbox"
                checked={selectedNode.locked}
                onChange={(event) => onUpdateSelected({ locked: event.currentTarget.checked })}
              />
            </label>
          </section>
        </div>
      ) : effectiveSelectedCount > 1 ? (
        singleRootContainer ? (
          <div class="inspector-content">
            <section class="property-section">
              <div class="section-title-row">
                <span class="section-title">{singleRootContainer.name}</span>
                <span class="contract-card-meta">{effectiveSelectedCount} layers</span>
              </div>
              <div class="inspector-multi-actions">
                <button type="button" onClick={onDuplicateSelection}>
                  Duplicate (Ctrl+D)
                </button>
                <button type="button" onClick={onCopySelection}>
                  Copy (Ctrl+C)
                </button>
              </div>
            </section>
            <InspectorWebLayoutSection
              selectedNode={singleRootContainer}
              activeBreakpoint={activeBreakpoint}
              designTokens={designTokens}
              onUpdateSelected={onUpdateSelected}
              onApplyAutoLayout={onApplyAutoLayout}
            />
          </div>
        ) : (
          <div class="inspector-empty multi-inspector">
            <div class="empty-icon">{renderIcon('layers')}</div>
            <strong>{effectiveSelectedCount} layers selected</strong>
            <p>Drag to move, use the resize handles, align above the canvas, or run a batch action below.</p>
            <div class="inspector-multi-actions">
              <button type="button" onClick={onDuplicateSelection}>
                Duplicate (Ctrl+D)
              </button>
              <button type="button" onClick={onCopySelection}>
                Copy (Ctrl+C)
              </button>
              {hasConvertibleInMulti && (
                <button type="button" onClick={() => onConvertToPath(activeEditorId)}>
                  Convert to Vector Path
                </button>
              )}
              {hasPathsInMulti && (
                <button type="button" onClick={() => onSimplifyPath(activeEditorId)}>
                  Simplify Paths
                </button>
              )}
            </div>
          </div>
        )
      ) : activeEditorId === 'component' && editingMasterComponent ? (
        <div class="inspector-content">
          <InspectorComponentContractSection
            instanceNode={null}
            instanceComponent={null}
            editingMasterComponent={editingMasterComponent}
            onUpdateInstanceVariant={onUpdateInstanceVariant}
            onUpdateInstanceSlot={onUpdateInstanceSlot}
            onUpdateMasterContract={onUpdateMasterContract}
            onToggleComponentNodeLogic={onToggleComponentNodeLogic}
          />
          <div class="inspector-empty">
            <div class="empty-icon">{renderIcon('cursor')}</div>
            <strong>Master: {editingMasterComponent.name}</strong>
            <p>Select a layer inside Component Canvas to edit its styles, semantics, or layout.</p>
            <div class="quick-add">
              <button type="button" onClick={() => onQuickAdd('rect')}>+ Rectangle</button>
              <button type="button" onClick={() => onQuickAdd('text')}>+ Text</button>
              {onInsertImageFiles && (
                <button type="button" onClick={triggerImagePicker}>+ Image</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div class="inspector-empty">
          <div class="empty-icon">{renderIcon('cursor')}</div>
          <strong>Nothing selected</strong>
          <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
          <div class="quick-add">
            <button type="button" onClick={() => onQuickAdd('rect')}>+ Rectangle</button>
            <button type="button" onClick={() => onQuickAdd('text')}>+ Text</button>
            {onInsertImageFiles && (
              <button type="button" onClick={triggerImagePicker}>+ Image</button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

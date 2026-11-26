import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { DesignNode, DesignTokenCollection, PathNode } from '../core/document/types';
import { formatColorWithAlpha, isTransparentColor, parseColorWithAlpha } from '../core/document/styling';
import { resolveDesignTokenValue } from '../core/document/tokens';
import type { PathfinderOperation } from '../core/document/vector';
import type {
  CanvasToolId,
  CanvasToolOptions,
  PaintBucketGapTolerance,
  PaintBucketTarget,
  ShapeColorBlendMode,
  ToolWorkspaceScope,
  VectorBrushCap,
  VectorBrushPreset,
  VectorEraserMode,
  VectorEraserTarget,
} from '../core/tools/operationContract';
import type { StudioVectorActions } from './workspace/inspectorVectorHelpers';
import { clampContextMenuPosition } from './workspace/StudioContextMenu';

export interface ToolOptionsBarProps {
  workspace: ToolWorkspaceScope;
  toolId: CanvasToolId;
  toolOptions: CanvasToolOptions;
  selectedNodes: DesignNode[];
  designTokens?: DesignTokenCollection;
  onChangeOptions: (patch: Partial<CanvasToolOptions>) => void;
  onPathfinder: (operation: PathfinderOperation) => void;
  onConvertToPath: () => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onRotate90: () => void;
  onSimplifyPath: () => void;
  onTogglePathClosed: () => void;
  onSelectTool?: (toolId: CanvasToolId) => void;
  studioActions?: StudioVectorActions;
}

const OPTION_TOOLS = new Set<CanvasToolId>([
  'frame',
  'section',
  'draw-rect',
  'draw-ellipse',
  'draw-triangle',
  'draw-line',
  'draw-arrow',
  'draw-polygon',
  'draw-star',
  'pen',
  'curvature',
  'pencil',
  'brush',
  'eraser',
  'paint-bucket',
  'smooth',
  'shape-builder',
  'draw-text',
  'eyedropper',
  'measure',
]);

const BRUSH_SIZE_PRESETS = [2, 4, 8, 12, 18, 28, 44, 64, 100] as const;
const ERASER_SIZE_PRESETS = [6, 12, 24, 36, 56, 80, 100] as const;
const QUICK_COLOR_SWATCHES = ['#ffffff', '#111827', '#8b7cf6', '#38bdf8', '#22c55e', '#f59e0b', '#f43f5e'] as const;

interface ZeroTypingColorControlProps {
  label: string;
  color: string;
  tokenId?: string;
  designTokens?: DesignTokenCollection;
  onChangeColor: (nextColor: string, nextTokenId?: string) => void;
}

function ZeroTypingColorControl({
  label,
  color,
  tokenId,
  designTokens,
  onChangeColor,
}: ZeroTypingColorControlProps) {
  const transparent = isTransparentColor(color);
  const parsed = parseColorWithAlpha(color, '#8b7cf6');
  const alphaPct = transparent ? 0 : Math.round(parsed.alpha * 100);
  const colorTokens = (designTokens?.tokens ?? []).filter((token) => token.category === 'color');

  return (
    <div class="studio-opt-color-group" role="group" aria-label={`${label} color and opacity`}>
      <label class="studio-opt-swatch" title={`${label} visual color picker`}>
        <span>{label}</span>
        <span class="studio-opt-checker">
          <input
            type="color"
            aria-label={`${label} color picker`}
            value={parsed.hex}
            style={{ opacity: transparent ? 0 : Math.max(0.15, parsed.alpha) }}
            onInput={(event) => {
              const nextHex = (event.target as HTMLInputElement).value;
              const nextAlpha = transparent ? 1 : Math.max(0.05, parsed.alpha);
              onChangeColor(formatColorWithAlpha(nextHex, nextAlpha), undefined);
            }}
          />
          {transparent && <span class="studio-opt-transparent-slash" aria-hidden="true" />}
        </span>
      </label>

      <div class="studio-opt-swatches" role="group" aria-label={`${label} quick swatches`}>
        {QUICK_COLOR_SWATCHES.map((swatch) => {
          const isActive = !transparent && parsed.hex.toLowerCase() === swatch;
          return (
            <button
              key={swatch}
              type="button"
              class={'studio-opt-swatch-dot' + (isActive ? ' is-active' : '')}
              style={{ backgroundColor: swatch }}
              aria-label={`Set ${label} color ${swatch}`}
              aria-pressed={isActive}
              title={swatch.toUpperCase()}
              onClick={() => onChangeColor(formatColorWithAlpha(swatch, transparent ? 1 : parsed.alpha), undefined)}
            />
          );
        })}
      </div>

      <button
        type="button"
        class={'studio-opt-btn studio-opt-transparent-btn' + (transparent ? ' is-active' : '')}
        aria-pressed={transparent}
        onClick={() => {
          if (transparent) {
            onChangeColor(formatColorWithAlpha(parsed.hex, 1), undefined);
          } else {
            onChangeColor('transparent', undefined);
          }
        }}
        title={transparent ? `Restore solid ${label.toLowerCase()} color` : `Set ${label.toLowerCase()} to Transparent`}
      >
        <span>Transparent</span>
      </button>

      <label class="studio-opt-slider-field" title={`${label} opacity (${alphaPct}%)`}>
        <span>Opacity</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          aria-label={`${label} opacity`}
          value={alphaPct}
          onInput={(event) => {
            const pct = Math.max(0, Math.min(100, Number((event.target as HTMLInputElement).value)));
            if (pct <= 0) {
              onChangeColor('transparent', undefined);
            } else {
              onChangeColor(formatColorWithAlpha(parsed.hex, pct / 100), undefined);
            }
          }}
        />
        <em>{alphaPct}%</em>
      </label>

      {colorTokens.length > 0 && (
        <label class="studio-opt-select-field" title={`Bind ${label.toLowerCase()} to a Design Token`}>
          <span>Token</span>
          <select
            aria-label={`${label} design token`}
            value={tokenId ?? ''}
            onChange={(event) => {
              const nextId = (event.target as HTMLSelectElement).value;
              if (!nextId || !designTokens) {
                onChangeColor(color, undefined);
                return;
              }
              const resolved = resolveDesignTokenValue(designTokens, nextId);
              if (resolved.ok && resolved.cssValue.trim().length > 0) {
                onChangeColor(resolved.cssValue, nextId);
              } else {
                onChangeColor(color, nextId);
              }
            }}
          >
            <option value="">Custom</option>
            {colorTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function PathfinderIcon({ op }: { op: PathfinderOperation }) {
  if (op === 'unite') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4h4v8H7v-4H3V3z" fill="currentColor" opacity="0.9" />
      </svg>
    );
  }
  if (op === 'subtract') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 3h8v4H7v4H3V3z" fill="currentColor" opacity="0.92" />
        <rect x="7" y="7" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5" />
      </svg>
    );
  }
  if (op === 'minus-back') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5" />
        <path d="M11 7h4v8H7v-4h4V7z" fill="currentColor" opacity="0.92" />
      </svg>
    );
  }
  if (op === 'intersect') {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.55" />
        <rect x="7" y="7" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.55" />
        <rect x="7" y="7" width="4" height="4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 3h8v4H7v4H3V3zm8 4h4v8H7v-4h4V7z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function isBooleanCandidate(node: DesignNode): boolean {
  return node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path';
}

export function ToolOptionsBar({
  workspace,
  toolId,
  toolOptions,
  selectedNodes,
  designTokens,
  onChangeOptions,
  onPathfinder,
  onConvertToPath,
  onFlip,
  onRotate90,
  onSimplifyPath,
  onTogglePathClosed,
  onSelectTool,
  studioActions,
}: ToolOptionsBarProps) {
  const [openMenu, setOpenMenu] = useState<'pathfinder' | 'vector' | null>(null);
  const [popoverCoords, setPopoverCoords] = useState<{ x: number; y: number }>({ x: 16, y: 80 });
  const barRef = useRef<HTMLDivElement | null>(null);
  const pathfinderBtnRef = useRef<HTMLButtonElement | null>(null);
  const vectorBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverMenuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!openMenu) return;
    const anchor = openMenu === 'pathfinder' ? pathfinderBtnRef.current : vectorBtnRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const menuEl = popoverMenuRef.current;
    const menuWidth = menuEl ? menuEl.offsetWidth || 228 : 228;
    const menuHeight = menuEl ? menuEl.offsetHeight || 290 : 290;
    setPopoverCoords(clampContextMenuPosition(rect.left, rect.bottom + 6, menuWidth, menuHeight, vw, vh));
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node) {
        if (barRef.current?.contains(event.target)) return;
        if (popoverMenuRef.current?.contains(event.target)) return;
      }
      setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenMenu(null);
      }
    };
    const onWindowChange = () => setOpenMenu(null);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onWindowChange);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onWindowChange);
    };
  }, [openMenu]);

  const booleanCandidates = selectedNodes.filter(isBooleanCandidate);
  const canPathfinder = booleanCandidates.length >= 2;
  const canCombine = selectedNodes.length >= 2;
  const convertibleNodes = selectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  );
  const pathNodes = selectedNodes.filter((node): node is PathNode => node.type === 'path');
  const firstPath = pathNodes[0] ?? null;
  const hasSelection = selectedNodes.length > 0;
  const hasToolControls = OPTION_TOOLS.has(toolId);
  const activeColorBlendMode: ShapeColorBlendMode = toolOptions.colorBlendMode ?? 'linear';
  const colorBlendLabel =
    activeColorBlendMode === 'linear' ? 'Linear' : activeColorBlendMode === 'hard' ? 'Sharp' : 'Solid';

  const showBar =
    workspace === 'component' ||
    hasToolControls ||
    canPathfinder ||
    canCombine ||
    pathNodes.length > 0;

  if (!showBar) return null;

  const showStrokeWidth =
    toolId === 'draw-line' ||
    toolId === 'draw-arrow' ||
    toolId === 'pen' ||
    toolId === 'curvature' ||
    toolId === 'pencil' ||
    toolId === 'draw-rect' ||
    toolId === 'draw-ellipse' ||
    toolId === 'draw-triangle' ||
    toolId === 'draw-polygon' ||
    toolId === 'draw-star';

  const showFillSwatch =
    toolId === 'draw-rect' ||
    toolId === 'draw-ellipse' ||
    toolId === 'draw-triangle' ||
    toolId === 'draw-polygon' ||
    toolId === 'draw-star' ||
    toolId === 'pen' ||
    toolId === 'curvature' ||
    toolId === 'frame';

  const showPinToggle =
    toolId === 'frame' ||
    toolId === 'section' ||
    toolId.startsWith('draw-');

  const runAndClose = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  return (
    <div
      ref={barRef}
      class={'studio-options-bar' + (workspace === 'component' ? ' is-component-bar' : '')}
      role="toolbar"
      aria-label={workspace === 'component' ? 'Vector craft and Pathfinder tools' : 'Active tool options'}
    >
      {(workspace === 'component' || canPathfinder) && (
        <div class="studio-options-group" role="group" aria-label="Boolean and combine tools">
          <div class="studio-opt-popover-anchor">
            <button
              ref={pathfinderBtnRef}
              type="button"
              class={'studio-opt-btn' + (openMenu === 'pathfinder' ? ' is-active' : '')}
              data-testid="toolbar-pathfinder-menu-btn"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'pathfinder'}
              onClick={() => setOpenMenu((cur) => (cur === 'pathfinder' ? null : 'pathfinder'))}
              title="Boolean Pathfinder operations & color blend mode (Unite, Subtract, Intersect, Exclude, Divide, Builder)"
            >
              <PathfinderIcon op="unite" />
              <span>Pathfinder ▾</span>
            </button>
            {openMenu === 'pathfinder' && (() => {
              const menuContent = (
                <div
                  ref={popoverMenuRef}
                  class="studio-opt-popover-menu"
                  role="menu"
                  aria-label="Pathfinder operations"
                  data-testid="toolbar-pathfinder-popover"
                  style={{ position: 'fixed', left: `${popoverCoords.x}px`, top: `${popoverCoords.y}px` }}
                >
                  <div class="studio-opt-popover-title">Boolean Shapes {canPathfinder ? '' : '(Select 2+ shapes)'}</div>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(() => onPathfinder('unite'))}>
                    <PathfinderIcon op="unite" /><span>Unite (Merge)</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(() => onPathfinder('subtract'))}>
                    <PathfinderIcon op="subtract" /><span>Subtract Front</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(() => onPathfinder('minus-back'))}>
                    <PathfinderIcon op="minus-back" /><span>Minus Back</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(() => onPathfinder('intersect'))}>
                    <PathfinderIcon op="intersect" /><span>Intersect</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(() => onPathfinder('exclude'))}>
                    <PathfinderIcon op="exclude" /><span>Exclude</span>
                  </button>
                  {studioActions && (
                    <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!canPathfinder} onClick={() => runAndClose(studioActions.onDividePathfinder)}>
                      <PathfinderIcon op="exclude" /><span>Divide into Regions</span>
                    </button>
                  )}
                  {onSelectTool && (
                    <button
                      type="button"
                      role="menuitem"
                      class={'studio-opt-popover-item' + (toolId === 'shape-builder' ? ' is-active' : '')}
                      disabled={!canPathfinder}
                      onClick={() => runAndClose(() => onSelectTool('shape-builder'))}
                    >
                      <PathfinderIcon op="unite" /><span>Shape Builder</span><kbd>Shift+M</kbd>
                    </button>
                  )}
                  {toolId !== 'shape-builder' && (
                    <>
                      <div class="studio-opt-popover-divider" role="separator" />
                      <div class="studio-opt-popover-title">Multi-Color Blend</div>
                      <div class="studio-opt-popover-seg" role="group" aria-label="Color blend mode when merging different-colored shapes">
                        {([
                          { id: 'linear', label: 'Linear', tip: 'Smooth linear color gradient across merged shapes' },
                          { id: 'hard', label: 'Sharp', tip: 'Crisp hard-edge split between source colors' },
                          { id: 'single', label: 'Solid', tip: 'Single solid fill from base shape' },
                        ] as const).map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            data-testid={`toolbar-color-blend-${mode.id}`}
                            class={'studio-opt-btn' + (activeColorBlendMode === mode.id ? ' is-active' : '')}
                            aria-pressed={activeColorBlendMode === mode.id}
                            title={mode.tip}
                            onClick={() => onChangeOptions({ colorBlendMode: mode.id })}
                          >
                            <span>{mode.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
              return typeof document !== 'undefined' && document.body ? createPortal(menuContent, document.body) : menuContent;
            })()}
          </div>

          {studioActions?.onCombineSelection && (
            <button
              type="button"
              class="studio-opt-btn is-combine-btn"
              data-testid="toolbar-combine-btn"
              disabled={!canCombine}
              onClick={studioActions.onCombineSelection}
              title="Combine into 1 Object — unify all selected objects into one single object"
            >
              <PathfinderIcon op="unite" />
              <span>Combine</span>
            </button>
          )}

          {canPathfinder && toolId !== 'shape-builder' && (
            <button
              type="button"
              class="studio-opt-btn"
              onClick={() => {
                const order: ShapeColorBlendMode[] = ['linear', 'hard', 'single'];
                const next = order[(order.indexOf(activeColorBlendMode) + 1) % order.length];
                onChangeOptions({ colorBlendMode: next });
              }}
              title="Cycle multi-color blend mode (Linear → Sharp → Solid)"
            >
              <span>Blend: {colorBlendLabel}</span>
            </button>
          )}
        </div>
      )}

      {!canPathfinder && workspace !== 'component' && canCombine && studioActions?.onCombineSelection && (
        <div class="studio-options-group" role="group" aria-label="Combine selected objects">
          <button
            type="button"
            class="studio-opt-btn is-combine-btn"
            data-testid="toolbar-combine-btn"
            onClick={studioActions.onCombineSelection}
            title="Combine into 1 Object — unify all selected objects into one single object"
          >
            <PathfinderIcon op="unite" />
            <span>Combine into 1 Object</span>
          </button>
        </div>
      )}

      {(workspace === 'component' || firstPath !== null) && (
        <div class="studio-options-group" role="group" aria-label="Vector path and transform actions">
          {firstPath && (
            <>
              <button
                type="button"
                class="studio-opt-btn"
                onClick={onSimplifyPath}
                title="Simplify vector path anchors while preserving curve silhouette"
              >
                <span>Simplify</span>
              </button>
              <button
                type="button"
                class="studio-opt-btn"
                onClick={onTogglePathClosed}
                title={firstPath.closed ? 'Open closed vector contour' : 'Close open vector contour'}
              >
                <span>{firstPath.closed ? 'Open' : 'Close'}</span>
              </button>
            </>
          )}

          {workspace === 'component' && convertibleNodes.length > 0 && (
            <button
              type="button"
              class="studio-opt-btn"
              onClick={onConvertToPath}
              title="Convert selected Rectangle, Ellipse, or Frame into editable cubic Bezier anchors"
            >
              <span>To Path</span>
            </button>
          )}

          <div class="studio-opt-popover-anchor">
            <button
              ref={vectorBtnRef}
              type="button"
              class={'studio-opt-btn' + (openMenu === 'vector' ? ' is-active' : '')}
              data-testid="toolbar-vector-menu-btn"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'vector'}
              onClick={() => setOpenMenu((cur) => (cur === 'vector' ? null : 'vector'))}
              title="More path craft, flip, rotate, offset, and arrange tools"
            >
              <span>Transform &amp; Path ▾</span>
            </button>
            {openMenu === 'vector' && (() => {
              const menuContent = (
                <div
                  ref={popoverMenuRef}
                  class="studio-opt-popover-menu"
                  role="menu"
                  aria-label="Transform and path tools"
                  data-testid="toolbar-vector-popover"
                  style={{ position: 'fixed', left: `${popoverCoords.x}px`, top: `${popoverCoords.y}px` }}
                >
                  <div class="studio-opt-popover-title">Vector Craft</div>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={convertibleNodes.length === 0} onClick={() => runAndClose(onConvertToPath)}>
                    <span>Convert to Editable Path</span>
                  </button>
                  {studioActions && (
                    <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={booleanCandidates.length === 0} onClick={() => runAndClose(() => studioActions.onOffsetPath(8, true))}>
                      <span>Offset Contour (+8px)</span>
                    </button>
                  )}
                  {firstPath && studioActions && (
                    <>
                      <button type="button" role="menuitem" class="studio-opt-popover-item" onClick={() => runAndClose(() => studioActions.onConvertAllAnchors('smooth'))}>
                        <span>Smooth All Curves</span>
                      </button>
                      <button type="button" role="menuitem" class="studio-opt-popover-item" onClick={() => runAndClose(studioActions.onReversePath)}>
                        <span>Reverse Path Direction</span>
                      </button>
                    </>
                  )}
                  <div class="studio-opt-popover-divider" role="separator" />
                  <div class="studio-opt-popover-title">Transform &amp; Arrange</div>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!hasSelection} onClick={() => runAndClose(() => onFlip('horizontal'))}>
                    <span>Flip Horizontal</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!hasSelection} onClick={() => runAndClose(() => onFlip('vertical'))}>
                    <span>Flip Vertical</span>
                  </button>
                  <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!hasSelection} onClick={() => runAndClose(onRotate90)}>
                    <span>Rotate +90°</span>
                  </button>
                  {studioActions && (
                    <>
                      <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!hasSelection} onClick={() => runAndClose(() => studioActions.onArrange('front'))}>
                        <span>Bring to Front</span><kbd>Ctrl+]</kbd>
                      </button>
                      <button type="button" role="menuitem" class="studio-opt-popover-item" disabled={!hasSelection} onClick={() => runAndClose(() => studioActions.onArrange('back'))}>
                        <span>Send to Back</span><kbd>Ctrl+[</kbd>
                      </button>
                    </>
                  )}
                </div>
              );
              return typeof document !== 'undefined' && document.body ? createPortal(menuContent, document.body) : menuContent;
            })()}
          </div>
        </div>
      )}

      {hasToolControls && (
        <div class="studio-options-group studio-options-fields" role="group" aria-label="Active tool parameters">
          {toolId === 'draw-polygon' && (
            <label class="studio-opt-field">
              <span>Sides</span>
              <input
                type="number"
                min="3"
                max="12"
                value={toolOptions.polygonSides}
                onInput={(event) => {
                  const val = Math.max(3, Math.min(12, Math.round(Number((event.target as HTMLInputElement).value) || 6)));
                  onChangeOptions({ polygonSides: val });
                }}
              />
            </label>
          )}
          {toolId === 'draw-star' && (
            <>
              <label class="studio-opt-field">
                <span>Points</span>
                <input
                  type="number"
                  min="3"
                  max="16"
                  value={toolOptions.starPoints}
                  onInput={(event) => {
                    const val = Math.max(3, Math.min(16, Math.round(Number((event.target as HTMLInputElement).value) || 5)));
                    onChangeOptions({ starPoints: val });
                  }}
                />
              </label>
              <label class="studio-opt-field">
                <span>Ratio</span>
                <input
                  type="number"
                  min="20"
                  max="85"
                  value={Math.round(toolOptions.starInnerRatio * 100)}
                  onInput={(event) => {
                    const pct = Math.max(20, Math.min(85, Number((event.target as HTMLInputElement).value) || 44));
                    onChangeOptions({ starInnerRatio: Number((pct / 100).toFixed(2)) });
                  }}
                />
                <em>%</em>
              </label>
            </>
          )}
          {toolId === 'smooth' && (
            <label class="studio-opt-field">
              <span>Radius</span>
              <input
                type="number"
                min="12"
                max="96"
                value={toolOptions.smoothRadius}
                onInput={(event) => {
                  const val = Math.max(12, Math.min(96, Math.round(Number((event.target as HTMLInputElement).value) || 34)));
                  onChangeOptions({ smoothRadius: val });
                }}
              />
            </label>
          )}
          {showFillSwatch && (
            <label class="studio-opt-swatch" title="Active draw fill color">
              <span>Fill</span>
              <input
                type="color"
                value={toolOptions.fillColor.startsWith('#') ? toolOptions.fillColor.slice(0, 7) : '#8b7cf6'}
                onInput={(event) => onChangeOptions({ fillColor: (event.target as HTMLInputElement).value })}
              />
            </label>
          )}
          {showStrokeWidth && (
            <>
              <label class="studio-opt-swatch" title="Active draw stroke color">
                <span>Stroke</span>
                <input
                  type="color"
                  value={toolOptions.strokeColor.startsWith('#') ? toolOptions.strokeColor.slice(0, 7) : '#20212a'}
                  onInput={(event) => onChangeOptions({ strokeColor: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="studio-opt-field">
                <span>W</span>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={toolOptions.strokeWidth}
                  onInput={(event) => {
                    const val = Math.max(0, Math.min(24, Number((event.target as HTMLInputElement).value) || 0));
                    onChangeOptions({ strokeWidth: val });
                  }}
                />
              </label>
            </>
          )}
          {showPinToggle && (
            <button
              type="button"
              class={'studio-opt-btn' + (toolOptions.keepToolActive ? ' is-active' : '')}
              aria-pressed={toolOptions.keepToolActive}
              onClick={() => onChangeOptions({ keepToolActive: !toolOptions.keepToolActive })}
              title="Keep drawing tool active after placing a shape"
            >
              <span>Keep Tool</span>
            </button>
          )}
          {toolId === 'brush' && (
            <div class="studio-opt-drawing-row" data-testid="brush-options">
              <span class="studio-options-label">Brush</span>
              <label class="studio-opt-select-field" title="Vector brush nib preset">
                <span>Preset</span>
                <select
                  aria-label="Brush preset"
                  value={toolOptions.brushPreset}
                  onChange={(event) =>
                    onChangeOptions({ brushPreset: (event.target as HTMLSelectElement).value as VectorBrushPreset })
                  }
                >
                  <option value="round">Round</option>
                  <option value="calligraphy">Calligraphy</option>
                  <option value="tapered">Tapered</option>
                  <option value="marker">Marker</option>
                </select>
              </label>

              <label class="studio-opt-slider-field" title="Brush width (2px–100px)">
                <span>Size</span>
                <input
                  type="range"
                  min="2"
                  max="100"
                  step="1"
                  aria-label="Brush size slider"
                  value={toolOptions.brushSize}
                  onInput={(event) =>
                    onChangeOptions({
                      brushSize: Math.max(2, Math.min(100, Math.round(Number((event.target as HTMLInputElement).value)))),
                    })
                  }
                />
                <select
                  aria-label="Brush size preset"
                  class="studio-opt-inline-preset"
                  value={BRUSH_SIZE_PRESETS.includes(toolOptions.brushSize as (typeof BRUSH_SIZE_PRESETS)[number])
                    ? String(toolOptions.brushSize)
                    : ''}
                  onChange={(event) => {
                    const next = Number((event.target as HTMLSelectElement).value);
                    if (Number.isFinite(next) && next >= 2) onChangeOptions({ brushSize: next });
                  }}
                >
                  {!BRUSH_SIZE_PRESETS.includes(toolOptions.brushSize as (typeof BRUSH_SIZE_PRESETS)[number]) && (
                    <option value="">{toolOptions.brushSize}px</option>
                  )}
                  {BRUSH_SIZE_PRESETS.map((size) => (
                    <option key={size} value={String(size)}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>

              <label class="studio-opt-slider-field" title="Pointer stabilizer smoothing (0%–100%)">
                <span>Stabilizer</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  aria-label="Brush stabilizer"
                  value={toolOptions.brushStabilizer}
                  onInput={(event) =>
                    onChangeOptions({
                      brushStabilizer: Math.max(0, Math.min(100, Math.round(Number((event.target as HTMLInputElement).value)))),
                    })
                  }
                />
                <em>{toolOptions.brushStabilizer}%</em>
              </label>

              <label class="studio-opt-select-field" title="Stroke line cap shape">
                <span>Cap</span>
                <select
                  aria-label="Brush line cap"
                  value={toolOptions.brushCap}
                  onChange={(event) =>
                    onChangeOptions({ brushCap: (event.target as HTMLSelectElement).value as VectorBrushCap })
                  }
                >
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                  <option value="butt">Butt</option>
                </select>
              </label>

              <ZeroTypingColorControl
                label="Ink"
                color={toolOptions.brushColor}
                tokenId={toolOptions.brushTokenId}
                designTokens={designTokens}
                onChangeColor={(nextColor, nextTokenId) =>
                  onChangeOptions({ brushColor: nextColor, brushTokenId: nextTokenId })
                }
              />
            </div>
          )}

          {toolId === 'eraser' && (
            <div class="studio-opt-drawing-row" data-testid="eraser-options">
              <span class="studio-options-label">Eraser</span>
              <label class="studio-opt-slider-field" title="Vector eraser diameter (4px–100px)">
                <span>Size</span>
                <input
                  type="range"
                  min="4"
                  max="100"
                  step="2"
                  aria-label="Eraser size slider"
                  value={toolOptions.eraserSize}
                  onInput={(event) =>
                    onChangeOptions({
                      eraserSize: Math.max(4, Math.min(100, Math.round(Number((event.target as HTMLInputElement).value)))),
                    })
                  }
                />
                <select
                  aria-label="Eraser size preset"
                  class="studio-opt-inline-preset"
                  value={ERASER_SIZE_PRESETS.includes(toolOptions.eraserSize as (typeof ERASER_SIZE_PRESETS)[number])
                    ? String(toolOptions.eraserSize)
                    : ''}
                  onChange={(event) => {
                    const next = Number((event.target as HTMLSelectElement).value);
                    if (Number.isFinite(next) && next >= 4) onChangeOptions({ eraserSize: next });
                  }}
                >
                  {!ERASER_SIZE_PRESETS.includes(toolOptions.eraserSize as (typeof ERASER_SIZE_PRESETS)[number]) && (
                    <option value="">{toolOptions.eraserSize}px</option>
                  )}
                  {ERASER_SIZE_PRESETS.map((size) => (
                    <option key={size} value={String(size)}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>

              <label class="studio-opt-select-field" title="How the vector eraser modifies touched paths">
                <span>Mode</span>
                <select
                  aria-label="Eraser mode"
                  value={toolOptions.eraserMode}
                  onChange={(event) =>
                    onChangeOptions({ eraserMode: (event.target as HTMLSelectElement).value as VectorEraserMode })
                  }
                >
                  <option value="slice">Slice / Cut</option>
                  <option value="object">Object Erase</option>
                </select>
              </label>

              <label class="studio-opt-select-field" title="Which layers the eraser can affect">
                <span>Target</span>
                <select
                  aria-label="Eraser target"
                  value={toolOptions.eraserTarget}
                  onChange={(event) =>
                    onChangeOptions({ eraserTarget: (event.target as HTMLSelectElement).value as VectorEraserTarget })
                  }
                >
                  <option value="selected">Selected Only</option>
                  <option value="all">All Active Layers</option>
                </select>
              </label>
            </div>
          )}

          {toolId === 'paint-bucket' && (
            <div class="studio-opt-drawing-row" data-testid="paint-bucket-options">
              <span class="studio-options-label">Bucket</span>
              <ZeroTypingColorControl
                label="Fill"
                color={toolOptions.paintBucketColor}
                tokenId={toolOptions.paintBucketTokenId}
                designTokens={designTokens}
                onChangeColor={(nextColor, nextTokenId) =>
                  onChangeOptions({ paintBucketColor: nextColor, paintBucketTokenId: nextTokenId })
                }
              />

              <label class="studio-opt-select-field" title="What clicking with Paint Bucket fills">
                <span>Target</span>
                <select
                  aria-label="Paint Bucket target"
                  value={toolOptions.paintBucketTarget}
                  onChange={(event) =>
                    onChangeOptions({
                      paintBucketTarget: (event.target as HTMLSelectElement).value as PaintBucketTarget,
                    })
                  }
                >
                  <option value="fill">Fill</option>
                  <option value="stroke">Stroke</option>
                  <option value="smart-region">Smart Region</option>
                </select>
              </label>

              <label class="studio-opt-select-field" title="Gap closing tolerance when filling enclosed empty regions">
                <span>Gap Closing</span>
                <select
                  aria-label="Paint Bucket gap closing"
                  value={toolOptions.paintBucketGapTolerance}
                  onChange={(event) =>
                    onChangeOptions({
                      paintBucketGapTolerance: (event.target as HTMLSelectElement).value as PaintBucketGapTolerance,
                    })
                  }
                >
                  <option value="tight">Tight (0px)</option>
                  <option value="medium">Medium</option>
                  <option value="loose">Loose</option>
                </select>
              </label>
            </div>
          )}

          {toolId === 'shape-builder' && (
            <div class="studio-opt-drawing-row" data-testid="shape-builder-options">
              <span class="studio-options-label">Color Blend</span>
              <div class="studio-opt-color-blend-group" role="group" aria-label="Shape Builder color blend mode">
                {([
                  { id: 'linear', label: 'Linear Blend', tip: 'Smooth linear gradient blending source colors together' },
                  { id: 'hard', label: 'Sharp Split', tip: 'Hard-edge color split keeping both colors crisp without gradient fade' },
                  { id: 'single', label: 'Single Fill', tip: 'Flatten merged shape to one solid color' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    data-testid={`shape-builder-blend-${mode.id}`}
                    class={'studio-opt-btn' + (activeColorBlendMode === mode.id ? ' is-active' : '')}
                    aria-pressed={activeColorBlendMode === mode.id}
                    title={mode.tip}
                    onClick={() => onChangeOptions({ colorBlendMode: mode.id })}
                  >
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
              <span class="studio-opt-hint">Drag across regions to merge · Hold Alt to punch out</span>
            </div>
          )}
          {toolId === 'eyedropper' && (() => {
            const activeColor = toolOptions.brushColor;
            const transparent = isTransparentColor(activeColor);
            const parsed = parseColorWithAlpha(activeColor, '#8b7cf6');
            const alphaPct = transparent ? 0 : Math.round(parsed.alpha * 100);
            return (
              <div class="studio-opt-drawing-row" data-testid="eyedropper-options">
                <span class="studio-options-label">Eyedropper</span>
                <span class="studio-opt-sampled-readout" title="Last sampled color synced to Brush and Paint Bucket">
                  <span class="studio-opt-checker">
                    <span
                      class="studio-opt-checker-fill"
                      style={{ backgroundColor: transparent ? 'transparent' : activeColor }}
                    />
                    {transparent && <span class="studio-opt-transparent-slash" aria-hidden="true" />}
                  </span>
                  <span>{transparent ? 'Transparent' : `${alphaPct}%`}</span>
                </span>
                <span class="studio-opt-hint">
                  Hover for live magnifier · Click samples Fill · Shift+Click samples Stroke · Syncs Brush &amp; Bucket
                </span>
              </div>
            );
          })()}
          {toolId === 'measure' && (
            <span class="studio-opt-hint">Drag to measure ΔX, ΔY, distance &amp; angle with smart snap (Shift snaps 45°)</span>
          )}
        </div>
      )}
    </div>
  );
}

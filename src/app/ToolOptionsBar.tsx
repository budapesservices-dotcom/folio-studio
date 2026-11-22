import type { DesignNode, PathNode } from '../core/document/types';
import type { PathfinderOperation } from '../core/document/vector';
import type { CanvasToolId, CanvasToolOptions, ToolWorkspaceScope } from '../engines/canvas/tools/types';

export interface ToolOptionsBarProps {
  workspace: ToolWorkspaceScope;
  toolId: CanvasToolId;
  toolOptions: CanvasToolOptions;
  selectedNodes: DesignNode[];
  onChangeOptions: (patch: Partial<CanvasToolOptions>) => void;
  onPathfinder: (operation: PathfinderOperation) => void;
  onConvertToPath: () => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onRotate90: () => void;
  onSimplifyPath: () => void;
  onTogglePathClosed: () => void;
  onSelectTool?: (toolId: CanvasToolId) => void;
}

const OPTION_TOOLS = new Set<CanvasToolId>([
  'frame',
  'section',
  'draw-rect',
  'draw-ellipse',
  'draw-line',
  'draw-arrow',
  'draw-polygon',
  'draw-star',
  'pen',
  'curvature',
  'pencil',
  'smooth',
  'shape-builder',
  'draw-text',
  'eyedropper',
  'measure',
]);

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
  onChangeOptions,
  onPathfinder,
  onConvertToPath,
  onFlip,
  onRotate90,
  onSimplifyPath,
  onTogglePathClosed,
  onSelectTool,
}: ToolOptionsBarProps) {
  const booleanCandidates = selectedNodes.filter(isBooleanCandidate);
  const canPathfinder = booleanCandidates.length >= 2;
  const convertibleNodes = selectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  );
  const pathNodes = selectedNodes.filter((node): node is PathNode => node.type === 'path');
  const firstPath = pathNodes[0] ?? null;
  const hasSelection = selectedNodes.length > 0;
  const hasToolControls = OPTION_TOOLS.has(toolId);

  const showBar =
    workspace === 'component' ||
    hasToolControls ||
    canPathfinder ||
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
    toolId === 'draw-polygon' ||
    toolId === 'draw-star';

  const showFillSwatch =
    toolId === 'draw-rect' ||
    toolId === 'draw-ellipse' ||
    toolId === 'draw-polygon' ||
    toolId === 'draw-star' ||
    toolId === 'pen' ||
    toolId === 'curvature' ||
    toolId === 'frame';

  const showPinToggle =
    toolId === 'frame' ||
    toolId === 'section' ||
    toolId.startsWith('draw-');

  return (
    <div
      class={'studio-options-bar' + (workspace === 'component' ? ' is-component-bar' : '')}
      role="toolbar"
      aria-label={workspace === 'component' ? 'Vector craft and Pathfinder tools' : 'Active tool options'}
    >
      {(workspace === 'component' || canPathfinder) && (
        <div class="studio-options-group" role="group" aria-label="Pathfinder boolean operations">
          <span class="studio-options-label">Pathfinder</span>
          <button
            type="button"
            class="studio-opt-btn"
            disabled={!canPathfinder}
            onClick={() => onPathfinder('unite')}
            title="Pathfinder Unite — merge selected shapes into one vector path"
          >
            <PathfinderIcon op="unite" />
            <span>Unite</span>
          </button>
          <button
            type="button"
            class="studio-opt-btn"
            disabled={!canPathfinder}
            onClick={() => onPathfinder('subtract')}
            title="Pathfinder Minus Front — subtract top shape from base shape"
          >
            <PathfinderIcon op="subtract" />
            <span>Subtract</span>
          </button>
          <button
            type="button"
            class="studio-opt-btn"
            disabled={!canPathfinder}
            onClick={() => onPathfinder('intersect')}
            title="Pathfinder Intersect — keep overlapping area of selected shapes"
          >
            <PathfinderIcon op="intersect" />
            <span>Intersect</span>
          </button>
          <button
            type="button"
            class="studio-opt-btn"
            disabled={!canPathfinder}
            onClick={() => onPathfinder('exclude')}
            title="Pathfinder Exclude — punch out overlapping regions"
          >
            <PathfinderIcon op="exclude" />
            <span>Exclude</span>
          </button>
          {onSelectTool && (
            <button
              type="button"
              class={'studio-opt-btn' + (toolId === 'shape-builder' ? ' is-active' : '')}
              disabled={!canPathfinder}
              aria-pressed={toolId === 'shape-builder'}
              onClick={() => onSelectTool('shape-builder')}
              title="Shape Builder (Shift+M) — drag across overlapping regions to merge, hold Alt to punch"
            >
              <span>Builder</span>
            </button>
          )}
        </div>
      )}

      {(workspace === 'component' || pathNodes.length > 0) && (
        <div class="studio-options-group" role="group" aria-label="Vector path actions">
          {workspace === 'component' && (
            <>
              <button
                type="button"
                class="studio-opt-btn"
                disabled={convertibleNodes.length === 0}
                onClick={onConvertToPath}
                title="Convert selected Rectangle, Ellipse, or Frame into editable cubic Bezier anchors"
              >
                <span>To Path</span>
              </button>
              <button
                type="button"
                class="studio-opt-btn"
                disabled={!hasSelection}
                onClick={() => onFlip('horizontal')}
                title="Flip selected artwork horizontally"
              >
                <span>Flip H</span>
              </button>
              <button
                type="button"
                class="studio-opt-btn"
                disabled={!hasSelection}
                onClick={() => onFlip('vertical')}
                title="Flip selected artwork vertically"
              >
                <span>Flip V</span>
              </button>
              <button
                type="button"
                class="studio-opt-btn"
                disabled={!hasSelection}
                onClick={onRotate90}
                title="Rotate selected artwork 90 degrees clockwise"
              >
                <span>+90°</span>
              </button>
            </>
          )}
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
          {toolId === 'shape-builder' && (
            <span class="studio-opt-hint">Drag across regions to merge · Hold Alt to punch out regions</span>
          )}
          {toolId === 'eyedropper' && (
            <span class="studio-opt-hint">Hover for live loupe · Click applies Fill · Shift+Click applies Stroke</span>
          )}
          {toolId === 'measure' && (
            <span class="studio-opt-hint">Drag to measure ΔX, ΔY, distance &amp; angle with smart snap (Shift snaps 45°)</span>
          )}
        </div>
      )}
    </div>
  );
}

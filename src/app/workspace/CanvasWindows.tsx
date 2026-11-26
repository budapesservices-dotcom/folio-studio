import { lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import type { AssetReference, BreakpointId, ComponentDefinition, DesignNode, DesignTokenCollection, FolioDocument, FolioProject } from '../../core/document/types';
import type { PathfinderOperation } from '../../core/document/vector';
import type { CanvasToolId, CanvasToolOptions } from '../../core/tools/operationContract';
import { Canvas } from '../../engines/canvas/Canvas';
import type { GpuSceneMetrics, ViewportRendererMode } from '../../engines/canvas/gpu/types';
import type { Alignment, DistributionAxis } from '../../engines/canvas/geometry';
import type { ValidatedToolOperation } from '../../engines/canvas/geometryEngine';
import { FloatingWindow } from '../FloatingWindow';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { ToolOptionsBar } from '../ToolOptionsBar';
import { stepCanvasZoom } from './canvasViewState';
import { StudioIcon } from './StudioIcon';
import { isTransparentColor, parseColorWithAlpha } from '../../core/document/styling';
import type { StudioVectorActions } from './inspectorVectorHelpers';
import type { ComponentRecoveryStatus } from './useComponentMasterLifecycle';

const CANVAS_BG_PRESETS = ['#FFFFFF', '#111827'] as const;

interface CanvasBackgroundControlProps {
  background: string;
  onChangeBackground: (background: string) => void;
  scope: 'main' | 'component';
}

function CanvasBackgroundControl({ background, onChangeBackground, scope }: CanvasBackgroundControlProps) {
  const isTransparent = isTransparentColor(background);
  const parsed = parseColorWithAlpha(background, '#FFFFFF');
  return (
    <div
      class="canvas-bg-control"
      role="group"
      aria-label={`${scope === 'component' ? 'Component canvas' : 'Canvas'} background`}
      data-testid="canvas-bg-control"
      data-canvas-bg-scope={scope}
    >
      <button
        type="button"
        class={`canvas-bg-checker-btn${isTransparent ? ' is-active' : ''}`}
        data-testid="canvas-bg-transparent"
        title="Transparent checkerboard background"
        aria-label="Transparent canvas background"
        aria-pressed={isTransparent}
        onClick={() => onChangeBackground('#00000000')}
      />
      <label class="canvas-bg-color-wrap" title={isTransparent ? 'Pick solid background color' : `Background color (${background})`}>
        <input
          type="color"
          class="canvas-bg-color-input"
          data-testid="canvas-bg-color"
          aria-label="Canvas background color"
          value={parsed.hex}
          onInput={(event) => onChangeBackground(event.currentTarget.value)}
        />
      </label>
      <div class="canvas-bg-presets" aria-label="Quick background colors">
        {CANVAS_BG_PRESETS.map((hex) => {
          const active = !isTransparent && parsed.hex.toUpperCase() === hex;
          return (
            <button
              key={hex}
              type="button"
              class={`canvas-bg-preset-dot${active ? ' is-active' : ''}`}
              style={{ backgroundColor: hex }}
              title={`Set canvas background to ${hex}`}
              aria-label={`Set canvas background to ${hex}`}
              aria-pressed={active}
              onClick={() => onChangeBackground(hex)}
            />
          );
        })}
      </div>
    </div>
  );
}

const LazyNodeLogicWorkspace = lazy(() => import('./NodeLogicWorkspace'));

interface AlignmentToolsProps {
  selectedCount: number;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: DistributionAxis) => void;
}

function AlignmentTools({ selectedCount, onAlign, onDistribute }: AlignmentToolsProps) {
  if (selectedCount <= 1) return null;
  return (
    <div class="alignment-tools" aria-label="Align selected layers">
      <button title="Align left" aria-label="Align left" onClick={() => onAlign('left')}>⇤</button>
      <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => onAlign('horizontal-center')}>↔</button>
      <button title="Align right" aria-label="Align right" onClick={() => onAlign('right')}>⇥</button>
      <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={selectedCount < 3} onClick={() => onDistribute('horizontal')}>⇌</button>
      <button title="Align top" aria-label="Align top" onClick={() => onAlign('top')}>⇡</button>
      <button title="Align vertical center" aria-label="Align vertical center" onClick={() => onAlign('vertical-center')}>↕</button>
      <button title="Align bottom" aria-label="Align bottom" onClick={() => onAlign('bottom')}>⇣</button>
      <button title="Distribute vertically" aria-label="Distribute vertically" disabled={selectedCount < 3} onClick={() => onDistribute('vertical')}>⇅</button>
    </div>
  );
}

export interface MainCanvasWindowProps {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  floating: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  document: FolioDocument;
  components: ComponentDefinition[];
  designTokens: DesignTokenCollection;
  assets?: readonly AssetReference[];
  activeBreakpoint: BreakpointId;
  selectedNodeIds: string[];
  selectedNodes: DesignNode[];
  toolId: CanvasToolId;
  toolOptions: CanvasToolOptions;
  zoom: number;
  pan: { x: number; y: number };
  canUndo: boolean;
  canRedo: boolean;
  onChangeBreakpoint: (bp: BreakpointId) => void;
  onPositionChange: (position: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onFocus: () => void;
  onFocusMinimized: () => void;
  onHoverHint: () => void;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: DistributionAxis) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleFloating: () => void;
  onClose: () => void;
  onCloseMinimized: () => void;
  onChangeToolOptions: (patch: Partial<CanvasToolOptions>) => void;
  onPathfinder: (op: PathfinderOperation) => void;
  onConvertToPath: () => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onRotate90: () => void;
  onSimplifyPath: () => void;
  onTogglePathClosed: () => void;
  onSelectTool: (nextTool: CanvasToolId) => void;
  onToolOperation: (operation: ValidatedToolOperation) => void;
  onToolOperationBatch: (operations: readonly ValidatedToolOperation[]) => void;
  onLayerDrop: (nodeIds: string[]) => void;
  onDropImageFiles?: (files: readonly File[], point: { x: number; y: number }) => void;
  onChangeBackground?: (background: string) => void;
  animationTimeMs?: number;
  hasAnimatedComponents?: boolean;
  componentAnimPlaying?: boolean;
  onToggleComponentAnimPlaying?: () => void;
  studioActions?: StudioVectorActions;
}

export function MainCanvasWindow({
  visible,
  minimized,
  closed,
  floating,
  position,
  size,
  zIndex,
  document,
  components,
  designTokens,
  assets,
  activeBreakpoint,
  selectedNodeIds,
  selectedNodes,
  toolId,
  toolOptions,
  zoom,
  pan,
  canUndo,
  canRedo,
  onChangeBreakpoint,
  onPositionChange,
  onSizeChange,
  onFocus,
  onFocusMinimized,
  onHoverHint,
  onAlign,
  onDistribute,
  onUndo,
  onRedo,
  onZoomChange,
  onMinimize,
  onRestore,
  onToggleFloating,
  onClose,
  onCloseMinimized,
  onChangeToolOptions,
  onPathfinder,
  onConvertToPath,
  onFlip,
  onRotate90,
  onSimplifyPath,
  onTogglePathClosed,
  onSelectTool,
  onToolOperation,
  onToolOperationBatch,
  onLayerDrop,
  onDropImageFiles,
  onChangeBackground,
  animationTimeMs,
  hasAnimatedComponents = false,
  componentAnimPlaying = true,
  onToggleComponentAnimPlaying,
  studioActions,
}: MainCanvasWindowProps) {
  const [rendererMode, setRendererMode] = useState<ViewportRendererMode>('auto');
  const [gpuMetrics, setGpuMetrics] = useState<GpuSceneMetrics | null>(null);

  return (
    <>
      {visible && (
        <FloatingWindow
          as="main"
          id="main-canvas"
          className={`workspace${floating ? ' canvas-floating' : ''}`}
          floating={floating}
          draggable={floating}
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocus}
          onMouseEnter={onHoverHint}
        >
          <div class={`workspace-toolbar${floating ? ' workspace-toolbar-draggable' : ''}`}>
            <div class="breadcrumb">
              <strong>{document.name}</strong>
              <div class="breakpoint-switcher" role="group" aria-label="Responsive breakpoint preview">
                {([
                  { id: 'desktop', label: 'Desktop', icon: 'desktop', width: '1440' },
                  { id: 'tablet', label: 'Tablet', icon: 'tablet', width: '768' },
                  { id: 'mobile', label: 'Mobile', icon: 'mobile', width: '390' },
                ] as const).map((bp) => (
                  <button
                    key={bp.id}
                    type="button"
                    class={`breakpoint-btn ${activeBreakpoint === bp.id ? 'is-active' : ''}`}
                    title={`${bp.label} (${bp.width}px)`}
                    aria-label={`${bp.label} breakpoint (${bp.width}px)`}
                    aria-pressed={activeBreakpoint === bp.id}
                    onClick={() => onChangeBreakpoint(bp.id)}
                  >
                    <StudioIcon name={bp.icon} />
                    <span>{bp.label}</span>
                  </button>
                ))}
              </div>
              <div
                class="renderer-mode-switcher"
                role="group"
                aria-label="Canvas viewport renderer"
                title={
                  gpuMetrics
                    ? `Hybrid GPU (${gpuMetrics.backend}) · ${gpuMetrics.instancedPrimitives} instanced · ${gpuMetrics.richNodes} tiled · ${gpuMetrics.lastFrameMs.toFixed(1)} ms`
                    : 'Auto switches to Hybrid GPU + Tile Cache at 250+ layers'
                }
              >
                {([
                  { id: 'auto', label: 'Auto', tip: 'Auto: SVG < 250 nodes, Hybrid GPU >= 250 nodes' },
                  { id: 'gpu-hybrid', label: 'GPU', tip: 'Force Hybrid GPU (WebGL2 SDF + 512px Tile Cache)' },
                  { id: 'svg-dom', label: 'SVG', tip: 'Force SVG DOM renderer' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    class={`renderer-mode-btn${rendererMode === mode.id ? ' is-active' : ''}`}
                    title={mode.tip}
                    aria-pressed={rendererMode === mode.id}
                    onClick={() => setRendererMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div class="canvas-window-tools">
              <AlignmentTools
                selectedCount={selectedNodeIds.length}
                onAlign={onAlign}
                onDistribute={onDistribute}
              />
              {hasAnimatedComponents && onToggleComponentAnimPlaying && (
                <button
                  type="button"
                  class={`canvas-anim-toggle-btn${componentAnimPlaying ? ' is-playing' : ''}`}
                  data-testid="canvas-component-anim-toggle"
                  title={componentAnimPlaying ? 'Pause animated components on page' : 'Play animated components on page'}
                  aria-label={componentAnimPlaying ? 'Pause animated components on page' : 'Play animated components on page'}
                  aria-pressed={componentAnimPlaying}
                  onClick={onToggleComponentAnimPlaying}
                >
                  <StudioIcon name={componentAnimPlaying ? 'pause' : 'play'} />
                </button>
              )}
              {onChangeBackground && (
                <CanvasBackgroundControl
                  background={document.background}
                  onChangeBackground={onChangeBackground}
                  scope="main"
                />
              )}
              <div class="workspace-tools">
                <button class="history-button" title="Undo" disabled={!canUndo} onClick={onUndo}>
                  <StudioIcon name="undo" />
                </button>
                <button class="history-button" title="Redo" disabled={!canRedo} onClick={onRedo}>
                  <StudioIcon name="redo" />
                </button>
                <span class="workspace-divider" />
                <button class="zoom-button" title="Zoom out" onClick={() => onZoomChange((value) => stepCanvasZoom(value, 'out'))}>
                  <StudioIcon name="minus" />
                </button>
                <span class="zoom-value">{Math.round(zoom * 100)}%</span>
                <button class="zoom-button" title="Zoom in" onClick={() => onZoomChange((value) => stepCanvasZoom(value, 'in'))}>
                  <StudioIcon name="plus" />
                </button>
              </div>
              <div class="workspace-window-controls" aria-label="Canvas window controls">
                <button type="button" class="window-control window-control-minimize" title="Minimize canvas" aria-label="Minimize canvas" onClick={onMinimize} />
                <button
                  type="button"
                  class="window-control"
                  title={floating ? 'Dock Canvas' : 'Float Canvas'}
                  aria-label={floating ? 'Dock Canvas' : 'Float Canvas'}
                  aria-pressed={floating}
                  onClick={onToggleFloating}
                >
                  {floating ? '▣' : '□'}
                </button>
                <button type="button" class="window-control window-control-close" title="Close Canvas window" aria-label="Close Canvas window" onClick={onClose}>
                  ×
                </button>
              </div>
            </div>
          </div>
          <div class="canvas-workspace">
            <ToolOptionsBar
              workspace="main"
              toolId={toolId}
              toolOptions={toolOptions}
              selectedNodes={selectedNodes}
              designTokens={designTokens}
              onChangeOptions={onChangeToolOptions}
              onPathfinder={onPathfinder}
              onConvertToPath={onConvertToPath}
              onFlip={onFlip}
              onRotate90={onRotate90}
              onSimplifyPath={onSimplifyPath}
              onTogglePathClosed={onTogglePathClosed}
              onSelectTool={onSelectTool}
              studioActions={studioActions}
            />
            <Canvas
              document={document}
              components={components}
              designTokens={designTokens}
              assets={assets}
              activeBreakpoint={activeBreakpoint}
              selectedNodeIds={selectedNodeIds as string[]}
              toolId={toolId}
              workspace="main"
              toolOptions={toolOptions}
              zoom={zoom}
              pan={pan}
              onToolOperation={onToolOperation}
              onToolOperationBatch={onToolOperationBatch}
              onLayerDrop={onLayerDrop}
              onDropImageFiles={onDropImageFiles}
              rendererMode={rendererMode}
              onGpuMetrics={setGpuMetrics}
              animationTimeMs={animationTimeMs}
              contextMenuActions={studioActions}
            />
          </div>
        </FloatingWindow>
      )}

      {minimized && !closed && (
        <FloatingWindow
          as="div"
          id="main-canvas"
          className="canvas-minimized-window"
          minimized
          draggable
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocusMinimized}
        >
          <div class="canvas-minimized-titlebar">
            <StudioIcon name="canvas" />
            <strong>{document.name}</strong>
            <button type="button" class="minimized-restore-control" title="Restore Canvas" aria-label="Restore Canvas" onClick={onRestore} />
            <button type="button" title="Close Canvas" aria-label="Close Canvas" onClick={onCloseMinimized}>×</button>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}

export function normalizeCanvasDocument(document: FolioDocument | null | undefined): FolioDocument | null {
  if (!document) return null;
  if (Array.isArray(document.nodes)) return document;
  return { ...document, nodes: [] };
}

export interface ComponentCanvasWindowProps {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  floating: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  document: FolioDocument | null;
  components: ComponentDefinition[];
  designTokens: DesignTokenCollection;
  assets?: readonly AssetReference[];
  editingComponent: ComponentDefinition | null;
  selectedNodeIds: string[];
  selectedComponentNodes: DesignNode[];
  toolId: CanvasToolId;
  toolOptions: CanvasToolOptions;
  zoom: number;
  pan: { x: number; y: number };
  canUndo: boolean;
  canRedo: boolean;
  recoveryStatus: ComponentRecoveryStatus;
  pendingOpenComponentName: string | null;
  hasPendingDeletion: boolean;
  showRetryCleanupButton: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onFocus: () => void;
  onFocusMinimized: () => void;
  onHoverHint: () => void;
  onReloadRecoveredMaster: () => void;
  onKeepCurrentBuffer: () => void;
  onDiscardAndOpenPending: () => void;
  onOpenCleanupDialog: () => void;
  onSaveMaster: () => void;
  onSaveSelectionAsNew: () => void;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (axis: DistributionAxis) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleFloating: () => void;
  onClose: () => void;
  onCloseMinimized: () => void;
  onChangeToolOptions: (patch: Partial<CanvasToolOptions>) => void;
  onPathfinder: (op: PathfinderOperation) => void;
  onConvertToPath: () => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onRotate90: () => void;
  onSimplifyPath: () => void;
  onTogglePathClosed: () => void;
  onSelectTool: (nextTool: CanvasToolId) => void;
  onToolOperation: (operation: ValidatedToolOperation) => void;
  onToolOperationBatch: (operations: readonly ValidatedToolOperation[]) => void;
  onLayerDrop: (nodeIds: string[]) => void;
  onDropImageFiles?: (files: readonly File[], point: { x: number; y: number }) => void;
  onChangeBackground?: (background: string) => void;
  studioActions?: StudioVectorActions;
}

export function ComponentCanvasWindow({
  visible,
  minimized,
  closed,
  floating,
  position,
  size,
  zIndex,
  document,
  components,
  designTokens,
  assets,
  editingComponent,
  selectedNodeIds,
  selectedComponentNodes,
  toolId,
  toolOptions,
  zoom,
  pan,
  canUndo,
  canRedo,
  recoveryStatus,
  pendingOpenComponentName,
  hasPendingDeletion,
  showRetryCleanupButton,
  onPositionChange,
  onSizeChange,
  onFocus,
  onFocusMinimized,
  onHoverHint,
  onReloadRecoveredMaster,
  onKeepCurrentBuffer,
  onDiscardAndOpenPending,
  onOpenCleanupDialog,
  onSaveMaster,
  onSaveSelectionAsNew,
  onAlign,
  onDistribute,
  onUndo,
  onRedo,
  onZoomChange,
  onMinimize,
  onRestore,
  onToggleFloating,
  onClose,
  onCloseMinimized,
  onChangeToolOptions,
  onPathfinder,
  onConvertToPath,
  onFlip,
  onRotate90,
  onSimplifyPath,
  onTogglePathClosed,
  onSelectTool,
  onToolOperation,
  onToolOperationBatch,
  onLayerDrop,
  onDropImageFiles,
  onChangeBackground,
  studioActions,
}: ComponentCanvasWindowProps) {
  const safeDocument = normalizeCanvasDocument(document);
  const safeNodes = safeDocument?.nodes ?? [];
  const safeSelectedNodeIds = Array.isArray(selectedNodeIds) ? selectedNodeIds : [];
  const safeSelectedComponentNodes = Array.isArray(selectedComponentNodes) ? selectedComponentNodes : [];

  return (
    <>
      {visible && (
        <FloatingWindow
          as="main"
          id="component-canvas"
          className={`workspace component-canvas-window${floating ? ' canvas-floating' : ' component-canvas-docked'}`}
          floating={floating}
          draggable={floating}
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocus}
          onMouseEnter={onHoverHint}
        >
          <div class={`workspace-toolbar component-canvas-toolbar${floating ? ' workspace-toolbar-draggable' : ''}`}>
            <div class="breadcrumb">
              <StudioIcon name="componentCanvas" />
              <strong>{editingComponent ? editingComponent.name + ' · Master' : 'Component Canvas'}</strong>
            </div>
            {recoveryStatus === 'missing' && (
              <span class="component-recovery-status" role="status">
                Master temporarily missing · local buffer preserved
              </span>
            )}
            {(recoveryStatus === 'returned' || recoveryStatus === 'conflict') && (
              <button
                type="button"
                class="component-recovery-action"
                disabled={hasPendingDeletion}
                onClick={onReloadRecoveredMaster}
              >
                Discard local edits and reload current master
              </button>
            )}
            {pendingOpenComponentName !== null && (
              <div class="component-recovery-panel" role="alert">
                <span>
                  Opening {pendingOpenComponentName} would replace the current local buffer.
                </span>
                <button type="button" class="component-recovery-action" onClick={onKeepCurrentBuffer}>
                  Keep current buffer
                </button>
                <button type="button" class="component-recovery-action" onClick={onDiscardAndOpenPending}>
                  Discard local edits and open requested master
                </button>
              </div>
            )}
            {showRetryCleanupButton && (
              <button type="button" class="component-recovery-action" onClick={onOpenCleanupDialog}>
                Retry durable Component Canvas cleanup
              </button>
            )}
            <div class="canvas-window-tools">
              <div class="workspace-tools component-canvas-create-tools" aria-label="Component actions">
                <button
                  type="button"
                  class="component-master-save-button"
                  title={editingComponent ? `Update master “${editingComponent.name}”` : 'Save Component Canvas as new component'}
                  aria-label={editingComponent ? `Update master ${editingComponent.name}` : 'Save Component Canvas as new component'}
                  disabled={!safeDocument || (!editingComponent && safeNodes.length === 0)}
                  onClick={onSaveMaster}
                >
                  <StudioIcon name="save" />
                </button>
                <button
                  type="button"
                  class="component-save-new-button"
                  title="Save selected layers as a new component"
                  aria-label="Save selected layers as a new component"
                  disabled={!safeDocument || safeSelectedComponentNodes.length === 0}
                  onClick={onSaveSelectionAsNew}
                >
                  <StudioIcon name="copyPlus" />
                </button>
              </div>
              <AlignmentTools
                selectedCount={safeSelectedNodeIds.length}
                onAlign={onAlign}
                onDistribute={onDistribute}
              />
              {safeDocument && onChangeBackground && (
                <CanvasBackgroundControl
                  background={safeDocument.background}
                  onChangeBackground={onChangeBackground}
                  scope="component"
                />
              )}
              <div class="workspace-tools">
                <button class="history-button" title="Undo" disabled={!canUndo} onClick={onUndo}>
                  <StudioIcon name="undo" />
                </button>
                <button class="history-button" title="Redo" disabled={!canRedo} onClick={onRedo}>
                  <StudioIcon name="redo" />
                </button>
                <span class="workspace-divider" />
                <button class="zoom-button" title="Zoom out" onClick={() => onZoomChange((value) => stepCanvasZoom(value, 'out'))}>
                  <StudioIcon name="minus" />
                </button>
                <span class="zoom-value">{Math.round(zoom * 100)}%</span>
                <button class="zoom-button" title="Zoom in" onClick={() => onZoomChange((value) => stepCanvasZoom(value, 'in'))}>
                  <StudioIcon name="plus" />
                </button>
              </div>
              <div class="workspace-window-controls" aria-label="Component Canvas window controls">
                <button
                  type="button"
                  class="window-control window-control-minimize"
                  title="Minimize Component Canvas"
                  aria-label="Minimize Component Canvas"
                  disabled={hasPendingDeletion}
                  onClick={onMinimize}
                />
                <button
                  type="button"
                  class="window-control"
                  title={floating ? 'Dock Component Canvas' : 'Float Component Canvas'}
                  aria-label={floating ? 'Dock Component Canvas' : 'Float Component Canvas'}
                  aria-pressed={floating}
                  onClick={onToggleFloating}
                >
                  {floating ? '▣' : '□'}
                </button>
                <button
                  type="button"
                  class="window-control window-control-close"
                  title="Close Component Canvas window"
                  aria-label="Close Component Canvas window"
                  disabled={hasPendingDeletion}
                  onClick={onClose}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
          <div class="canvas-workspace">
            <ToolOptionsBar
              workspace="component"
              toolId={toolId}
              toolOptions={toolOptions}
              selectedNodes={safeSelectedComponentNodes}
              designTokens={designTokens}
              onChangeOptions={onChangeToolOptions}
              onPathfinder={onPathfinder}
              onConvertToPath={onConvertToPath}
              onFlip={onFlip}
              onRotate90={onRotate90}
              onSimplifyPath={onSimplifyPath}
              onTogglePathClosed={onTogglePathClosed}
              onSelectTool={onSelectTool}
              studioActions={studioActions}
            />
            {safeDocument ? (
              <Canvas
                document={safeDocument}
                components={components}
                designTokens={designTokens}
                assets={assets}
                selectedNodeIds={safeSelectedNodeIds}
                toolId={toolId}
                workspace="component"
                toolOptions={toolOptions}
                zoom={zoom}
                pan={pan}
                onToolOperation={onToolOperation}
                onToolOperationBatch={onToolOperationBatch}
                onLayerDrop={onLayerDrop}
                onDropImageFiles={onDropImageFiles}
                contextMenuActions={studioActions}
              />
            ) : (
              <div class="component-canvas-empty" role="status">
                No active component document.
              </div>
            )}
          </div>
        </FloatingWindow>
      )}

      {minimized && !closed && (
        <FloatingWindow
          as="div"
          id="component-canvas"
          className="canvas-minimized-window component-canvas-minimized"
          minimized
          draggable
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocusMinimized}
        >
          <div class="canvas-minimized-titlebar">
            <StudioIcon name="componentCanvas" />
            <strong>Component Canvas</strong>
            <button type="button" class="minimized-restore-control" title="Restore Component Canvas" aria-label="Restore Component Canvas" onClick={onRestore} />
            <button type="button" title="Close Component Canvas" aria-label="Close Component Canvas" onClick={onCloseMinimized}>×</button>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}

export interface NodeLogicWindowProps {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  floating: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  project: FolioProject;
  activePageId: string;
  mainCommandClient: MainCanvasCommandClient;
  onNotice: (message: string) => void;
  onOpenLivePreview: (pageId?: string) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  focusRequest?: {
    readonly graphId: string;
    readonly nodeIds: readonly string[];
    readonly nonce: number;
  } | null;
  onPositionChange: (position: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onFocus: () => void;
  onHoverHint: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleFloating: () => void;
  onClose: () => void;
  onCloseMinimized: () => void;
}

export function NodeLogicWindow({
  visible,
  minimized,
  closed,
  floating,
  position,
  size,
  zIndex,
  project,
  activePageId,
  mainCommandClient,
  onNotice,
  onOpenLivePreview,
  onToggleComponentNodeLogic,
  focusRequest = null,
  onPositionChange,
  onSizeChange,
  onFocus,
  onHoverHint,
  onMinimize,
  onRestore,
  onToggleFloating,
  onClose,
  onCloseMinimized,
}: NodeLogicWindowProps) {
  const [autoArrangeRequestNonce, setAutoArrangeRequestNonce] = useState(0);
  const [activeGraphNodeCount, setActiveGraphNodeCount] = useState<number | null>(null);
  const effectiveNodeCount = activeGraphNodeCount ?? (project.logicGraphs[0]?.nodes.length ?? 0);

  return (
    <>
      {visible && (
        <FloatingWindow
          as="main"
          id="node-logic"
          className={`workspace node-logic-window${floating ? ' canvas-floating' : ' node-logic-docked'}`}
          floating={floating}
          draggable={floating}
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocus}
          onMouseEnter={onHoverHint}
        >
          <div class={`workspace-toolbar${floating ? ' workspace-toolbar-draggable' : ''}`}>
            <div class="breadcrumb">
              <StudioIcon name="logicNodes" />
              <strong>Node Logic</strong>
            </div>
            <div class="canvas-window-tools">
              <button
                type="button"
                class="node-logic-header-action"
                title="Auto-arrange logic nodes into a clean flow layout"
                aria-label="Auto-Arrange"
                disabled={effectiveNodeCount === 0}
                onClick={() => setAutoArrangeRequestNonce((current) => current + 1)}
              >
                <StudioIcon name="autoArrange" />
                <span>Auto-Arrange</span>
              </button>
              <div class="workspace-window-controls" aria-label="Node Logic window controls">
                <button type="button" class="window-control window-control-minimize" title="Minimize Node Logic" aria-label="Minimize Node Logic" onClick={onMinimize} />
                <button
                  type="button"
                  class="window-control"
                  title={floating ? 'Dock Node Logic' : 'Float Node Logic'}
                  aria-label={floating ? 'Dock Node Logic' : 'Float Node Logic'}
                  aria-pressed={floating}
                  onClick={onToggleFloating}
                >
                  {floating ? '▣' : '□'}
                </button>
                <button type="button" class="window-control window-control-close" title="Close Node Logic window" aria-label="Close Node Logic window" onClick={onClose}>
                  ×
                </button>
              </div>
            </div>
          </div>
          <div class="node-logic-workspace">
            <Suspense
              fallback={(
                <div class="node-logic-empty" role="status" aria-live="polite">
                  <div class="node-logic-empty-icon"><StudioIcon name="logicNodes" /></div>
                  <span class="panel-kicker">VISUAL LOGIC</span>
                  <strong>Loading Node Logic…</strong>
                </div>
              )}
            >
              <LazyNodeLogicWorkspace
                project={project}
                activePageId={activePageId}
                mainCommandClient={mainCommandClient}
                onNotice={onNotice}
                onOpenLivePreview={onOpenLivePreview}
                onToggleComponentNodeLogic={onToggleComponentNodeLogic}
                focusRequest={focusRequest}
                autoArrangeRequestNonce={autoArrangeRequestNonce}
                onActiveGraphNodeCountChange={setActiveGraphNodeCount}
              />
            </Suspense>
          </div>
        </FloatingWindow>
      )}

      {minimized && !closed && (
        <FloatingWindow
          as="div"
          id="node-logic"
          className="canvas-minimized-window node-logic-minimized"
          minimized
          draggable={floating}
          position={position}
          size={size}
          zIndex={zIndex}
          onPositionChange={onPositionChange}
          onSizeChange={onSizeChange}
          onFocus={onFocus}
        >
          <div class="canvas-minimized-titlebar">
            <StudioIcon name="logicNodes" />
            <strong>Node Logic</strong>
            <button type="button" class="minimized-restore-control" title="Restore Node Logic" aria-label="Restore Node Logic" onClick={onRestore} />
            <button type="button" title="Close Node Logic" aria-label="Close Node Logic" onClick={onCloseMinimized}>×</button>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}

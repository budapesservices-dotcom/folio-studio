import type { ComponentDefinition, DesignNode, FolioDocument } from '../../core/document/types';
import type { PathfinderOperation } from '../../core/document/vector';
import type { CanvasToolId, CanvasToolOptions } from '../../core/tools/operationContract';
import { Canvas } from '../../engines/canvas/Canvas';
import type { Alignment, DistributionAxis } from '../../engines/canvas/geometry';
import type { ValidatedToolOperation } from '../../engines/canvas/geometryEngine';
import { FloatingWindow } from '../FloatingWindow';
import { ToolOptionsBar } from '../ToolOptionsBar';
import { stepCanvasZoom } from './canvasViewState';
import { StudioIcon } from './StudioIcon';
import type { ComponentRecoveryStatus } from './useComponentMasterLifecycle';

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
  selectedNodeIds: string[];
  selectedNodes: DesignNode[];
  toolId: CanvasToolId;
  toolOptions: CanvasToolOptions;
  zoom: number;
  pan: { x: number; y: number };
  canUndo: boolean;
  canRedo: boolean;
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
  selectedNodeIds,
  selectedNodes,
  toolId,
  toolOptions,
  zoom,
  pan,
  canUndo,
  canRedo,
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
}: MainCanvasWindowProps) {
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
            </div>
            <div class="canvas-window-tools">
              <AlignmentTools
                selectedCount={selectedNodeIds.length}
                onAlign={onAlign}
                onDistribute={onDistribute}
              />
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
              onChangeOptions={onChangeToolOptions}
              onPathfinder={onPathfinder}
              onConvertToPath={onConvertToPath}
              onFlip={onFlip}
              onRotate90={onRotate90}
              onSimplifyPath={onSimplifyPath}
              onTogglePathClosed={onTogglePathClosed}
              onSelectTool={onSelectTool}
            />
            <Canvas
              document={document}
              components={components}
              selectedNodeIds={selectedNodeIds as string[]}
              toolId={toolId}
              workspace="main"
              toolOptions={toolOptions}
              zoom={zoom}
              pan={pan}
              onToolOperation={onToolOperation}
              onToolOperationBatch={onToolOperationBatch}
              onLayerDrop={onLayerDrop}
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

export interface ComponentCanvasWindowProps {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  floating: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  document: FolioDocument;
  components: ComponentDefinition[];
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
}: ComponentCanvasWindowProps) {
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
                  disabled={!editingComponent && document.nodes.length === 0}
                  onClick={onSaveMaster}
                >
                  <StudioIcon name="save" />
                </button>
                <button
                  type="button"
                  class="component-save-new-button"
                  title="Save selected layers as a new component"
                  aria-label="Save selected layers as a new component"
                  disabled={selectedComponentNodes.length === 0}
                  onClick={onSaveSelectionAsNew}
                >
                  <StudioIcon name="copyPlus" />
                </button>
              </div>
              <AlignmentTools
                selectedCount={selectedNodeIds.length}
                onAlign={onAlign}
                onDistribute={onDistribute}
              />
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
              selectedNodes={selectedComponentNodes}
              onChangeOptions={onChangeToolOptions}
              onPathfinder={onPathfinder}
              onConvertToPath={onConvertToPath}
              onFlip={onFlip}
              onRotate90={onRotate90}
              onSimplifyPath={onSimplifyPath}
              onTogglePathClosed={onTogglePathClosed}
              onSelectTool={onSelectTool}
            />
            <Canvas
              document={document}
              components={components}
              selectedNodeIds={selectedNodeIds as string[]}
              toolId={toolId}
              workspace="component"
              toolOptions={toolOptions}
              zoom={zoom}
              pan={pan}
              onToolOperation={onToolOperation}
              onToolOperationBatch={onToolOperationBatch}
              onLayerDrop={onLayerDrop}
            />
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
            <div class="node-logic-empty">
              <div class="node-logic-empty-icon"><StudioIcon name="logicNodes" /></div>
              <span class="panel-kicker">VISUAL LOGIC</span>
              <strong>Node Logic</strong>
              <p>Build and connect logic nodes in this independent workspace.</p>
              <span class="node-logic-empty-note">NODE EDITOR · SEPARATE FROM DESIGN CANVAS</span>
            </div>
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

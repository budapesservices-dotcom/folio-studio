import type {
  ComponentDefinition,
  DesignNode,
  FolioDocument,
  FolioProject,
} from '../../core/document/types';
import type { getComponentOverrideTargets } from '../../core/document/components';
import type { CanvasToolId, CanvasToolOptions } from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { InspectorPanel } from '../InspectorPanel';
import { StudioIcon } from './StudioIcon';
import type { CanvasPathStudioBridge } from './useCanvasPathStudioBridge';
import type { MotionPlaybackController } from './useMotionPlayback';
import type { useComponentMasterLifecycle } from './useComponentMasterLifecycle';
import type { useDesignSystemActions } from './useDesignSystemActions';
import type { usePageAndTemplateActions } from './usePageAndTemplateActions';
import type { usePanelResizeController } from './usePanelResizeController';
import type { useQuickInteractionActions } from './useQuickInteractionActions';
import type { useSelectionAndVectorActions } from './useSelectionAndVectorActions';
import type { useWorkspaceMotionBridge } from './useWorkspaceMotionBridge';
import type { useWorkspaceWindows } from './useWorkspaceWindows';

export interface WorkspaceInspectorHostProps {
  project: FolioProject;
  activePageId: string;
  focusedDocument: FolioDocument;
  activeEditorId: EditorTarget;
  inspectorSelectedNode: DesignNode | null;
  inspectorSelectedNodes: readonly DesignNode[];
  selectedInstanceComponent: ComponentDefinition | null;
  instanceOverrideTargets: ReturnType<typeof getComponentOverrideTargets> | null;
  canRemoveFromCanvas: boolean;
  toolOptions: CanvasToolOptions;
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient: MainCanvasCommandClient;
  focusedCommandClient: MainCanvasCommandClient;
  windows: ReturnType<typeof useWorkspaceWindows>;
  panelResize: ReturnType<typeof usePanelResizeController>;
  designSystem: ReturnType<typeof useDesignSystemActions>;
  selectionActions: ReturnType<typeof useSelectionAndVectorActions>;
  pageActions: ReturnType<typeof usePageAndTemplateActions>;
  componentMaster: ReturnType<typeof useComponentMasterLifecycle>;
  quickInteractions: ReturnType<typeof useQuickInteractionActions>;
  motion: MotionPlaybackController;
  motionAutoKeyBridge: ReturnType<typeof useWorkspaceMotionBridge>['motionAutoKeyBridge'];
  pathStudio: CanvasPathStudioBridge;
  activeStudioActions: ReturnType<ReturnType<typeof useSelectionAndVectorActions>['createStudioActionsForTarget']>;
  onChooseTool: (toolId: CanvasToolId, target?: EditorTarget) => void;
  onUpdateToolOptions: (patch: Partial<CanvasToolOptions>) => void;
  onUpdateToolbarHint: (panel: string, description: string, shortcuts?: string[]) => void;
  onInsertImageFiles: (files: readonly File[], targetEditor?: EditorTarget, dropPoint?: { x: number; y: number }) => Promise<void>;
  onImportFontFiles: (files: readonly File[], targetEditor?: EditorTarget) => Promise<void>;
}

export function WorkspaceInspectorHost({
  project,
  activePageId,
  focusedDocument,
  activeEditorId,
  inspectorSelectedNode,
  inspectorSelectedNodes,
  selectedInstanceComponent,
  instanceOverrideTargets,
  canRemoveFromCanvas,
  toolOptions,
  mainCommandClient,
  componentCommandClient,
  focusedCommandClient,
  windows,
  panelResize,
  designSystem,
  selectionActions,
  pageActions,
  componentMaster,
  quickInteractions,
  motion,
  motionAutoKeyBridge,
  pathStudio,
  activeStudioActions,
  onChooseTool,
  onUpdateToolOptions,
  onUpdateToolbarHint,
  onInsertImageFiles,
  onImportFontFiles,
}: WorkspaceInspectorHostProps) {
  return (
    <InspectorPanel
      visible={windows.inspectorVisible}
      width={panelResize.panelWidths.inspector}
      isResizing={panelResize.resizingPanel === 'inspector'}
      resizeHandleRef={panelResize.inspectorResizeHandleRef}
      activeEditorId={activeEditorId}
      selectedNode={inspectorSelectedNode}
      selectedNodes={[...inspectorSelectedNodes]}
      selectedCount={inspectorSelectedNodes.length}
      canRemoveFromCanvas={canRemoveFromCanvas}
      selectedInstanceComponent={selectedInstanceComponent}
      editingMasterComponent={componentMaster.editingComponent}
      instanceOverrideTargets={instanceOverrideTargets}
      activeBreakpoint={designSystem.activeBreakpoint}
      designTokens={designSystem.designTokens}
      assets={project.assets}
      defaultFillColor={toolOptions.fillColor}
      renderIcon={(name) => <StudioIcon name={name} />}
      onStartResize={panelResize.startPanelResize}
      onResizeDoubleClick={panelResize.handlePanelResizeDoubleClick}
      onResizeKeyDown={panelResize.handlePanelResizeKeyDown}
      onCommitEdit={() => {
        mainCommandClient.commitEdit();
        componentCommandClient.commitEdit();
      }}
      onHoverHint={() =>
        onUpdateToolbarHint(
          'INSPECTOR',
          'Edit the selected layer’s position, dimensions, fills, gradients, effects, typography, layout, and contract.',
        )
      }
      onRemoveFromCanvas={(nodeId) => {
        focusedCommandClient.setNodesCanvasState([nodeId], false, 'Remove from canvas');
      }}
      onUpdateSelected={motionAutoKeyBridge.handleInspectorUpdateSelected}
      onUpdateSelectedStyle={motionAutoKeyBridge.handleInspectorUpdateSelectedStyle}
      onTogglePropertyKeyframe={motion.togglePropertyKeyframe}
      isPropertyKeyedAtPlayhead={motion.isPropertyKeyedAtPlayhead}
      positionLockedByMotionPath={pathStudio.positionLockedByMotionPath}
      autoOrientByMotionPath={pathStudio.autoOrientByMotionPath}
      onApplyAutoLayout={designSystem.applyAutoLayout}
      onConvertFrameLayoutMode={designSystem.convertFrameLayoutMode}
      onSwitchBreakpoint={designSystem.setActiveBreakpoint}
      onUpdateInstanceOverride={selectionActions.updateInstanceOverride}
      onUpdateInstanceVariant={designSystem.updateInstanceVariant}
      onUpdateInstanceSlot={designSystem.updateInstanceSlot}
      onUpdateMasterContract={designSystem.updateMasterContract}
      onToggleComponentNodeLogic={designSystem.toggleComponentNodeLogic}
      onResetInstanceOverrides={selectionActions.resetInstanceOverrides}
      onDetachInstance={selectionActions.detachSelectedInstance}
      onConvertToPath={selectionActions.handleConvertToPath}
      onTogglePathClosed={selectionActions.handleTogglePathClosed}
      onSimplifyPath={selectionActions.handleSimplifyPath}
      onChooseTool={onChooseTool}
      onQuickAdd={pageActions.addNode}
      onInsertImageFiles={(files) => { void onInsertImageFiles(files, activeEditorId); }}
      onImportFontFiles={(files) => { void onImportFontFiles(files, activeEditorId); }}
      onDuplicateSelection={() => selectionActions.duplicateSelection(activeEditorId)}
      onCopySelection={() => selectionActions.copySelection(activeEditorId)}
      project={project}
      activePageId={activePageId}
      scopedNodes={focusedDocument.nodes}
      onCreateQuickInteraction={quickInteractions.createQuickInteraction}
      onUpdateQuickInteraction={quickInteractions.updateQuickInteraction}
      onDeleteQuickInteraction={quickInteractions.deleteQuickInteraction}
      onOpenInteractionInNodeGraph={quickInteractions.openInteractionInNodeGraph}
      colorBlendMode={toolOptions.colorBlendMode}
      onChangeColorBlendMode={(colorBlendMode) => onUpdateToolOptions({ colorBlendMode })}
      studioActions={activeStudioActions}
    />
  );
}

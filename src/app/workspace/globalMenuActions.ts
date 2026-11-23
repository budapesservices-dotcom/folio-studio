import type { DesignNode, DesignTokenCollection, FolioDocument } from '../../core/document/types';
import type { PathfinderOperation } from '../../core/document/vector';
import type { CanvasToolId } from '../../core/tools/operationContract';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { stepCanvasZoom } from './canvasViewState';
import type { GlobalToolbarMenuActions } from './GlobalToolbar';
import { getLayerContextMenuCapabilities } from './layerOperations';

export interface BuildGlobalToolbarMenuActionsArgs {
  activeEditorId: EditorTarget;
  focusedDocument: FolioDocument;
  focusedSelectedNodeIds: string[];
  focusedSelectedNodes: DesignNode[];
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
  activeToolId: CanvasToolId;
  designTokens: DesignTokenCollection;
  focusedCommandClient: MainCanvasCommandClient;
  setActiveZoom: (next: number | ((current: number) => number)) => void;
  onCut: (target: EditorTarget) => void;
  onCopy: (target: EditorTarget) => void;
  onPaste: (target: EditorTarget) => void;
  onDuplicate: (target: EditorTarget) => void;
  onSelectTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  onPathfinder: (target: EditorTarget, operation: PathfinderOperation) => void;
  onConvertToPath: (target: EditorTarget) => void;
  onRotate90: (target: EditorTarget) => void;
  onUpdateDesignTokens: (next: DesignTokenCollection, unbindTokenIds?: string[], description?: string) => void;
  onNotice: (message: string) => void;
}

export function buildGlobalToolbarMenuActions({
  activeEditorId,
  focusedDocument,
  focusedSelectedNodeIds,
  focusedSelectedNodes,
  canUndo,
  canRedo,
  hasClipboard,
  activeToolId,
  designTokens,
  focusedCommandClient,
  setActiveZoom,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onSelectTool,
  onPathfinder,
  onConvertToPath,
  onRotate90,
  onUpdateDesignTokens,
  onNotice,
}: BuildGlobalToolbarMenuActionsArgs): GlobalToolbarMenuActions {
  const layerCapabilities = getLayerContextMenuCapabilities(focusedDocument.nodes, focusedSelectedNodeIds);
  const pathfinderEligibleCount = focusedSelectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path',
  ).length;
  const convertibleShapeCount = focusedSelectedNodes.filter(
    (node) => node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame',
  ).length;

  return {
    canUndo,
    canRedo,
    hasSelection: focusedSelectedNodeIds.length > 0,
    hasClipboard,
    canGroup: layerCapabilities.canGroup,
    canUngroup: layerCapabilities.canUngroup,
    canMask: layerCapabilities.canMask,
    canUnmask: layerCapabilities.canUnmask,
    canPathfinder: pathfinderEligibleCount >= 2,
    canConvertToPath: convertibleShapeCount > 0,
    activeToolId,
    activeThemeId: designTokens.activeThemeId,
    themes: designTokens.themes,
    onUndo: () => focusedCommandClient.undo(),
    onRedo: () => focusedCommandClient.redo(),
    onCut: () => onCut(activeEditorId),
    onCopy: () => onCopy(activeEditorId),
    onPaste: () => onPaste(activeEditorId),
    onDuplicate: () => onDuplicate(activeEditorId),
    onSelectAll: () => {
      const visibleIds = focusedDocument.nodes
        .filter((node) => node.onCanvas !== false)
        .map((node) => node.id);
      focusedCommandClient.selectNodes(visibleIds, 'Select all layers');
    },
    onGroup: () => focusedCommandClient.groupLayers(layerCapabilities.rootIds),
    onUngroup: () => focusedCommandClient.ungroupLayers(layerCapabilities.rootIds),
    onCreateMask: () => {
      if (layerCapabilities.rootIds[0]) focusedCommandClient.createClippingMask(layerCapabilities.rootIds[0]);
    },
    onRemoveMask: () => {
      if (layerCapabilities.rootIds[0]) focusedCommandClient.removeClippingMask(layerCapabilities.rootIds[0]);
    },
    onDelete: () => focusedCommandClient.deleteNodes(focusedSelectedNodeIds),
    onZoomIn: () => setActiveZoom((current) => stepCanvasZoom(current, 'in')),
    onZoomOut: () => setActiveZoom((current) => stepCanvasZoom(current, 'out')),
    onZoomReset: () => setActiveZoom(1),
    onSelectTool: (toolId) => onSelectTool(toolId, activeEditorId),
    onPathfinder: (operation) => onPathfinder(activeEditorId, operation),
    onConvertToPath: () => onConvertToPath(activeEditorId),
    onRotate90: () => onRotate90(activeEditorId),
    onSelectTheme: (themeId) => {
      if (themeId === designTokens.activeThemeId) return;
      onUpdateDesignTokens({ ...designTokens, activeThemeId: themeId }, undefined, 'Switch design token theme');
      const themeName = designTokens.themes.find((theme) => theme.id === themeId)?.name ?? themeId;
      onNotice(`Active theme switched to ${themeName}.`);
    },
  };
}

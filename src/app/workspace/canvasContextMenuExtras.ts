import type { DesignNode } from '../../core/document/types';
import type { CanvasContextMenuActions } from '../../engines/canvas/Canvas';
import type { CanvasToolId } from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { createToolOperationExecutor } from '../toolOperationExecutor';

export interface BuildCanvasContextMenuExtrasOptions {
  workspace: EditorTarget;
  documentNodes: readonly DesignNode[];
  selectedNodeIds: readonly string[];
  canPaste: boolean;
  commandClient: MainCanvasCommandClient;
  onCopy: (target: EditorTarget) => void;
  onCut: (target: EditorTarget) => void;
  onPaste: (target: EditorTarget) => void;
  onDuplicate: (target: EditorTarget) => void;
  onToggleLayerProperty: (nodeId: string, property: 'visible' | 'locked') => void;
  onSaveAsComponent?: (selectedNodes: DesignNode[], allNodes: readonly DesignNode[]) => void;
  onUnpackComponent: (target: EditorTarget, nodeId: string) => void;
  onQuickAdd: (kind: 'rect' | 'ellipse' | 'triangle' | 'text' | 'frame') => void;
}

export function buildCanvasContextMenuExtras(
  options: BuildCanvasContextMenuExtrasOptions,
): Partial<CanvasContextMenuActions> {
  const {
    workspace,
    documentNodes,
    selectedNodeIds,
    canPaste,
    commandClient,
    onCopy,
    onCut,
    onPaste,
    onDuplicate,
    onToggleLayerProperty,
    onSaveAsComponent,
    onUnpackComponent,
    onQuickAdd,
  } = options;

  return {
    onCopy: () => onCopy(workspace),
    onCut: () => onCut(workspace),
    onPaste: () => onPaste(workspace),
    canPaste,
    onDuplicate: () => onDuplicate(workspace),
    onSelectAll: () => commandClient.selectNodes(documentNodes.map((n) => n.id), 'Select all layers'),
    onToggleVisible: () => {
      const firstId = selectedNodeIds[0];
      if (firstId) onToggleLayerProperty(firstId, 'visible');
    },
    onToggleLock: () => {
      const firstId = selectedNodeIds[0];
      if (firstId) onToggleLayerProperty(firstId, 'locked');
    },
    onRemoveFromCanvas: () => {
      if (selectedNodeIds.length > 0) {
        commandClient.setNodesCanvasState(selectedNodeIds, false, 'Remove from canvas');
      }
    },
    ...(onSaveAsComponent
      ? {
          onSaveAsComponent: () => onSaveAsComponent(
            documentNodes.filter((n) => selectedNodeIds.includes(n.id)),
            documentNodes,
          ),
        }
      : {}),
    onUnpackComponent: (nodeId) => onUnpackComponent(workspace, nodeId),
    onToggleShapeContainer: (nodeId, nextContainer) => {
      const target = documentNodes.find((n) => n.id === nodeId);
      if (!target || (target.type !== 'rect' && target.type !== 'ellipse' && target.type !== 'path')) return;
      const updated: DesignNode = nextContainer
        ? { ...target, isContainer: true, clipContent: Boolean(target.clipContent) }
        : { ...target, isContainer: false, clipContent: false };
      commandClient.replaceNode(
        updated,
        nextContainer ? 'Set shape as container' : 'Release shape container',
      );
    },
    onQuickAdd,
  };
}

export interface BuildWorkspaceToolExecutorOptions {
  workspace: EditorTarget;
  commandClient: MainCanvasCommandClient;
  isHydrating: boolean;
  onMarkCanvasSelectionSource: () => void;
  onShowInspectorOnMain: () => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onToolChange: (toolId: CanvasToolId, target: EditorTarget) => void;
  onNotice: (message: string) => void;
  onSampledColorOptionChange: (color: string, colorTarget: 'fill' | 'stroke') => void;
}

export function buildWorkspaceToolExecutor(options: BuildWorkspaceToolExecutorOptions) {
  const {
    workspace,
    commandClient,
    isHydrating,
    onMarkCanvasSelectionSource,
    onShowInspectorOnMain,
    onPanChange,
    onZoomChange,
    onToolChange,
    onNotice,
    onSampledColorOptionChange,
  } = options;
  const isMain = workspace === 'main';

  return createToolOperationExecutor({
    workspace,
    commandClient,
    shell: {
      isHydrating: () => isHydrating,
      onSelectionChange: (nodeIds) => {
        onMarkCanvasSelectionSource();
        commandClient.selectNodes(
          nodeIds,
          isMain ? 'Select layers on canvas' : 'Select layers on component canvas',
        );
        if (isMain && nodeIds.length > 0) onShowInspectorOnMain();
      },
      onPanChange,
      onZoomChange,
      onToolChange: (nextTool) => onToolChange(nextTool, workspace),
      onNotice,
      onSampledColorOptionChange,
      onCanvasMutationCommitted: (kind) => {
        onMarkCanvasSelectionSource();
        if (isMain && kind === 'create') onShowInspectorOnMain();
      },
    },
  });
}

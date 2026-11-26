import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import {
  getClippingMaskBaseId,
  getEffectiveLayerStates,
  getSelectedLayerRootIds,
} from '../../core/document/layers';
import { alignNodes, distributeNodes, type Alignment } from '../../engines/canvas/geometry';
import { findStudioToolByShortcut } from '../../engines/canvas/tools/studioRegistry';
import type { CanvasToolId } from '../../engines/canvas/tools/types';
import { getActiveEditorContext, getTransformableNodes, type EditorTarget } from '../editorContext';
import type { EditorState } from '../editorReducer';
import type { MainCanvasCommandClient, WorkspaceCommandClient } from '../mainCanvasCommandClient';
import type { StudioClipboardPayload } from '../nodeClipboard';
import { isShortcutHelpTrigger } from '../keyboardShortcuts';

export interface UseWorkspaceShortcutsOptions {
  activeEditorId: EditorTarget;
  editingComponentId: string | null;
  state: EditorState;
  componentState: EditorState;
  isHydrating: boolean;
  componentDeletionDialogOpen: boolean;
  shortcutsModalOpen: boolean;
  newProjectDialogOpen?: boolean;
  selectionSourceRef: RefObject<'layers' | 'canvas'>;
  clipboardRef: RefObject<StudioClipboardPayload | null>;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient | WorkspaceCommandClient;
  openShortcutsModal: () => void;
  copySelection: (target: EditorTarget) => boolean;
  cutSelection: (target: EditorTarget) => void;
  pasteSelection: (target: EditorTarget) => void;
  duplicateSelection: (target: EditorTarget) => void;
  chooseCanvasTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  setNotice: (message: string) => void;
}

export function useWorkspaceShortcuts({
  activeEditorId,
  editingComponentId,
  state,
  componentState,
  isHydrating,
  componentDeletionDialogOpen,
  shortcutsModalOpen,
  newProjectDialogOpen = false,
  selectionSourceRef,
  clipboardRef,
  getCommandClient,
  openShortcutsModal,
  copySelection,
  cutSelection,
  pasteSelection,
  duplicateSelection,
  chooseCanvasTool,
  setNotice,
}: UseWorkspaceShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isHydrating || componentDeletionDialogOpen || shortcutsModalOpen || newProjectDialogOpen) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        (target instanceof HTMLElement && target.isContentEditable) ||
        target?.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      if (isShortcutHelpTrigger(event)) {
        event.preventDefault();
        openShortcutsModal();
        return;
      }

      const context = getActiveEditorContext(activeEditorId, state, componentState);
      const activeClient = getCommandClient(activeEditorId);
      const layerStates = getEffectiveLayerStates(context.document.nodes);
      const nodes = getTransformableNodes(
        context.document.nodes
          .filter((node) => context.state.selectedNodeIds.includes(node.id))
          .filter((node) => {
            const effective = layerStates.get(node.id);
            return effective?.visible && !effective.locked;
          }),
      );
      const ids = context.state.selectedNodeIds;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const inSecondaryStudioSurface = Boolean(
        target?.closest('.node-logic-window, .code-workspace-overlay, .motion-timeline-dock'),
      );

      // Undo / Redo always work across every studio window (Main Canvas, Component Canvas,
      // Node Logic, Motion Timeline, and Code & Preview Studio).
      if (modifier && key === 'z') {
        event.preventDefault();
        const historyClient = inSecondaryStudioSurface ? getCommandClient('main') : activeClient;
        if (event.shiftKey) historyClient.redo();
        else historyClient.undo();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        const historyClient = inSecondaryStudioSurface ? getCommandClient('main') : activeClient;
        historyClient.redo();
        return;
      }

      // Do not bleed canvas-only shortcuts (Select All, Group, Mask, Delete layer,
      // alignment, or single-key canvas tools) into Node Logic, Code, or Motion Timeline.
      if (inSecondaryStudioSurface) {
        return;
      }

      if (modifier && !event.shiftKey && key === 'a') {
        event.preventDefault();
        activeClient.selectNodes(context.document.nodes.map((node) => node.id), 'Select all layers');
        return;
      }
      if (modifier && event.shiftKey && key === 'g') {
        if (ids.length > 0) {
          event.preventDefault();
          activeClient.ungroupLayers(ids);
        }
        return;
      }
      if (modifier && !event.shiftKey && key === 'g') {
        if (ids.length > 0) {
          event.preventDefault();
          activeClient.groupLayers(ids);
        }
        return;
      }
      if (modifier && event.shiftKey && key === 'm') {
        event.preventDefault();
        const roots = getSelectedLayerRootIds(context.document.nodes, ids);
        if (roots.length !== 1) {
          setNotice('Select one layer or Group to unmask.');
          return;
        }
        const maskedTarget = context.document.nodes.find((node) => node.id === roots[0]);
        if (!maskedTarget?.clipMaskBaseId) {
          setNotice('The selected layer is not masked.');
          return;
        }
        activeClient.removeClippingMask(maskedTarget.id);
        return;
      }
      if (modifier && !event.shiftKey && key === 'm') {
        event.preventDefault();
        const roots = getSelectedLayerRootIds(context.document.nodes, ids);
        if (roots.length !== 1) {
          setNotice('Multiple layers cannot be masked. Group them first.');
          return;
        }
        const baseId = getClippingMaskBaseId(context.document.nodes, roots[0]);
        if (!baseId) {
          setNotice('No layer directly below to use as a clipping mask.');
          return;
        }
        activeClient.createClippingMask(roots[0]);
        return;
      }
      if (modifier && !event.shiftKey && key === 'c' && ids.length > 0) {
        event.preventDefault();
        copySelection(activeEditorId);
        return;
      }
      if (modifier && !event.shiftKey && key === 'x' && ids.length > 0) {
        event.preventDefault();
        cutSelection(activeEditorId);
        return;
      }
      if (modifier && !event.shiftKey && key === 'v' && clipboardRef.current) {
        event.preventDefault();
        pasteSelection(activeEditorId);
        return;
      }
      if (event.key === 'Escape' && !event.defaultPrevented && ids.length > 0) {
        event.preventDefault();
        activeClient.deselectAll('Deselect layers');
        return;
      }
      if (modifier && !event.shiftKey && key === 'd') {
        event.preventDefault();
        if (ids.length > 0) {
          activeClient.deselectAll('Deselect layers');
        }
        return;
      }
      if (modifier && event.shiftKey && key === 'd' && ids.length > 0) {
        event.preventDefault();
        duplicateSelection(activeEditorId);
        return;
      }
      if (modifier && event.shiftKey && key === 'i') {
        event.preventDefault();
        activeClient.invertSelection('Invert selection');
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.length > 0) {
        if (event.defaultPrevented) return;
        if (selectionSourceRef.current === 'layers') {
          event.preventDefault();
          setNotice('Right-click a layer and choose Delete to remove it from Layers and Canvas.');
        } else {
          event.preventDefault();
          activeClient.setNodesCanvasState(ids, false, 'Remove from canvas');
        }
        return;
      }
      if (event.altKey && !event.shiftKey) {
        const alignmentByKey: Record<string, Alignment> = {
          arrowleft: 'left',
          arrowright: 'right',
          arrowup: 'top',
          arrowdown: 'bottom',
        };
        const alignment = alignmentByKey[key];
        if (alignment && nodes.length > 1) {
          event.preventDefault();
          const aligned = alignNodes(nodes, alignment);
          activeClient.transformNodes(aligned, `Align layers ${alignment}`);
        }
      } else if (event.altKey && event.shiftKey && (key === 'h' || key === 'v') && nodes.length > 2) {
        event.preventDefault();
        const axis = key === 'h' ? 'horizontal' : 'vertical';
        const distributed = distributeNodes(nodes, axis);
        activeClient.transformNodes(distributed, `Distribute layers ${axis}`);
      } else if (!modifier && !event.altKey && !event.repeat && event.key.length === 1) {
        const matchedTool = findStudioToolByShortcut(event.key, event.shiftKey, activeEditorId);
        if (matchedTool) {
          event.preventDefault();
          chooseCanvasTool(matchedTool, activeEditorId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeEditorId,
    editingComponentId,
    state,
    componentState,
    isHydrating,
    componentDeletionDialogOpen,
    shortcutsModalOpen,
    newProjectDialogOpen,
    openShortcutsModal,
    getCommandClient,
    copySelection,
    cutSelection,
    pasteSelection,
    duplicateSelection,
    chooseCanvasTool,
    setNotice,
    selectionSourceRef,
    clipboardRef,
  ]);
}

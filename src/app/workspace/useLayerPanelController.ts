import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { DesignNode, FolioDocument } from '../../core/document/types';
import {
  expandSelectedLayerIds,
  getEffectiveLayerStates,
  type LayerDropPosition,
} from '../../core/document/layers';
import { getActiveEditorContext, type EditorTarget } from '../editorContext';
import type { EditorState } from '../editorReducer';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  computeClampedContextMenuPosition,
  computeClampedPopoverPosition,
  computeLayerRenameUpdates,
  computeLayerSelection,
  filterLayerPanelRows,
  getLayerContextMenuCapabilities,
  getLayerDropPosition,
  type LayerContextMenuState,
  type LayerRenameSession,
} from './layerOperations';

export interface UseLayerPanelControllerOptions {
  activeEditorId: EditorTarget;
  state: EditorState;
  componentState: EditorState;
  activeDocument: FolioDocument;
  componentDocument: FolioDocument;
  focusedDocument: FolioDocument;
  focusedSelectedNodeIds: string[];
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  selectionSourceRef: { current: 'layers' | 'canvas' };
  setActiveEditorId: (target: EditorTarget) => void;
  setInspectorVisible: (visible: boolean) => void;
  setNotice: (message: string) => void;
}

export function useLayerPanelController({
  activeEditorId,
  state,
  componentState,
  activeDocument,
  componentDocument,
  focusedDocument,
  focusedSelectedNodeIds,
  focusedCommandClient,
  getCommandClient,
  selectionSourceRef,
  setActiveEditorId,
  setInspectorVisible,
  setNotice,
}: UseLayerPanelControllerOptions) {
  const [collapsedLayers, setCollapsedLayers] = useState<Record<EditorTarget, string[]>>({
    main: [],
    component: [],
  });
  const [layerDropTarget, setLayerDropTarget] = useState<{
    nodeId: string;
    position: LayerDropPosition;
  } | null>(null);
  const [layerContextMenu, setLayerContextMenu] = useState<LayerContextMenuState | null>(null);
  const layerContextMenuRef = useRef<HTMLDivElement | null>(null);
  const layerDragSourceRef = useRef<string[] | null>(null);
  const layerDragEditorRef = useRef<EditorTarget | null>(null);
  const layerSelectionAnchorRef = useRef<Record<EditorTarget, string | null>>({
    main: null,
    component: null,
  });
  const [layerRename, setLayerRename] = useState<LayerRenameSession | null>(null);
  const layerRenameRef = useRef<LayerRenameSession | null>(null);
  const layerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const [layerColorPickerKey, setLayerColorPickerKey] = useState<string | null>(null);
  const layerColorAnchorRef = useRef<HTMLButtonElement | null>(null);
  const layerColorPaletteRef = useRef<HTMLDivElement | null>(null);
  const [layerColorPickerPosition, setLayerColorPickerPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const [layerSearchQuery, setLayerSearchQuery] = useState('');

  // Clear active filter when switching pages or between Main/Component Canvas
  // so layers in the newly focused document are immediately visible.
  useEffect(() => {
    setLayerSearchQuery('');
  }, [activeEditorId, focusedDocument.id]);

  const layerSourceNodes: DesignNode[] = focusedDocument.nodes;
  const activeCollapsedLayers = collapsedLayers[activeEditorId];
  const layerSourceIds = useMemo(
    () => new Set(layerSourceNodes.map((node) => node.id)),
    [layerSourceNodes],
  );
  const filteredLayers = useMemo(
    () => filterLayerPanelRows(layerSourceNodes, activeCollapsedLayers, layerSearchQuery),
    [layerSourceNodes, activeCollapsedLayers, layerSearchQuery],
  );
  const layerRows = filteredLayers.rows;
  const layerEffectiveStates = useMemo(
    () => getEffectiveLayerStates(layerSourceNodes),
    [layerSourceNodes],
  );
  const contextMenuEditor = layerContextMenu
    ? getActiveEditorContext(layerContextMenu.editorId, state, componentState)
    : null;
  const contextMenuNodes = contextMenuEditor?.document.nodes ?? [];
  const contextMenuCapabilities = useMemo(
    () => getLayerContextMenuCapabilities(contextMenuNodes, layerContextMenu?.nodeIds ?? []),
    [contextMenuNodes, layerContextMenu],
  );

  // Keep root-mounted Layer Color Palette positioned and dismissible
  useEffect(() => {
    if (!layerColorPickerKey) return;
    const updatePalettePosition = () => {
      const anchor = layerColorAnchorRef.current;
      const palette = layerColorPaletteRef.current;
      if (!anchor || !palette) return;
      const next = computeClampedPopoverPosition(
        anchor.getBoundingClientRect(),
        palette.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      setLayerColorPickerPosition((current) => (
        current && Math.abs(current.top - next.top) < 0.5 && Math.abs(current.left - next.left) < 0.5
          ? current
          : next
      ));
    };
    const closePalette = () => {
      setLayerColorPickerKey(null);
      setLayerColorPickerPosition(null);
      layerColorAnchorRef.current = null;
    };
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layerColorPaletteRef.current?.contains(target)) return;
      if (layerColorAnchorRef.current?.contains(target)) return;
      closePalette();
    };
    const handlePaletteKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      if (event.target instanceof Node && layerColorPaletteRef.current?.contains(event.target)) {
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        closePalette();
      }
    };
    updatePalettePosition();
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true, signal });
    document.addEventListener('keydown', handlePaletteKeyDown, { capture: true, signal });
    window.addEventListener('resize', updatePalettePosition, { signal });
    window.addEventListener('scroll', updatePalettePosition, { capture: true, signal });
    return () => controller.abort();
  }, [layerColorPickerKey]);

  // Dismiss Layer Context Menu on outside pointerdown, Escape, resize, or scroll
  useEffect(() => {
    if (!layerContextMenu) return;
    const dismiss = () => setLayerContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && layerContextMenuRef.current?.contains(target)) return;
      dismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal });
    document.addEventListener('keydown', handleKeyDown, { capture: true, signal });
    window.addEventListener('resize', dismiss, { signal });
    window.addEventListener('scroll', dismiss, { capture: true, signal });
    return () => controller.abort();
  }, [layerContextMenu]);

  const beginLayerRename = (nodeId: string, batch: boolean) => {
    const selectedIds = focusedSelectedNodeIds;
    const nodeIds = batch
      ? layerRows.filter(({ node }) => selectedIds.includes(node.id)).map(({ node }) => node.id)
      : [nodeId];
    const clickedNode = layerSourceNodes.find((node) => node.id === nodeId);
    if (!clickedNode || nodeIds.length === 0) return;
    const selectedSet = new Set(nodeIds);
    const session: LayerRenameSession = {
      anchorId: nodeId,
      nodeIds,
      value: batch ? clickedNode.name.replace(/\s+\d+$/, '') : clickedNode.name,
      batch,
      editorId: activeEditorId,
      existingNames: layerSourceNodes.filter((node) => !selectedSet.has(node.id)).map((node) => node.name),
    };
    layerRenameRef.current = session;
    setLayerRename(session);
  };

  const updateLayerRenameDraft = (value: string) => {
    const current = layerRenameRef.current;
    if (!current) return;
    const next = { ...current, value };
    layerRenameRef.current = next;
    setLayerRename(next);
  };

  const finishLayerRename = (save: boolean) => {
    const session = layerRenameRef.current;
    if (!session) {
      setLayerRename(null);
      return;
    }
    layerRenameRef.current = null;
    setLayerRename(null);
    if (!save) return;

    const updates = computeLayerRenameUpdates(session);
    if (updates.length === 0) return;
    getCommandClient(session.editorId).renameNodes(
      updates,
      session.batch ? 'Batch rename layers' : 'Rename layer',
    );
  };

  useEffect(() => {
    if (!layerRename) return;
    const input = layerRenameInputRef.current;
    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(0, input.value.length);
    }
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const activeInput = layerRenameInputRef.current;
      if (!activeInput) {
        finishLayerRename(true);
        return;
      }
      if (event.target instanceof Node && activeInput.contains(event.target)) return;
      finishLayerRename(true);
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handleOutsidePointerDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [layerRename?.anchorId]);

  const setLayerColorFromRow = (nodeId: string, color: string) => {
    const selectedIds = focusedSelectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const validIds = layerSourceNodes.filter((node) => targetIds.includes(node.id)).map((node) => node.id);
    if (validIds.length === 0) return;
    focusedCommandClient.setNodesProperties(validIds, { layerColor: color }, 'Set layer color');
    setLayerColorPickerKey(null);
  };

  const toggleLayerPropertyFromRow = (nodeId: string, property: 'visible' | 'locked') => {
    const selectedIds = focusedSelectedNodeIds;
    const targetIds = selectedIds.includes(nodeId) ? selectedIds : [nodeId];
    const targets = layerSourceNodes.filter((node) => targetIds.includes(node.id));
    if (targets.length === 0) return;
    const shouldEnable = !targets.every((node) => node[property]);
    focusedCommandClient.setNodesProperties(
      targets.map((node) => node.id),
      { [property]: shouldEnable },
      property === 'visible' ? 'Toggle layer visibility' : 'Toggle layer lock',
    );
  };

  const selectLayerFromPanel = (
    nodeId: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ) => {
    selectionSourceRef.current = 'layers';
    const result = computeLayerSelection({
      nodeId,
      modifiers,
      nodes: layerSourceNodes,
      rows: layerRows,
      selectedNodeIds: focusedSelectedNodeIds,
      currentAnchorId: layerSelectionAnchorRef.current[activeEditorId],
    });
    if (result.action === 'rename-batch') {
      beginLayerRename(nodeId, true);
      return;
    }
    if (result.action === 'rename-single') {
      beginLayerRename(nodeId, false);
      return;
    }
    if (result.nextAnchorId !== undefined) {
      layerSelectionAnchorRef.current[activeEditorId] = result.nextAnchorId;
    }
    focusedCommandClient.selectNodes(result.nodeIds ?? [], result.description ?? 'Select layer');
    setInspectorVisible(true);
  };

  const openLayerContextMenu = (nodeId: string, event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    selectionSourceRef.current = 'layers';
    const currentSelection = focusedSelectedNodeIds.filter((id) => layerSourceIds.has(id));
    const menuNodeIds = currentSelection.includes(nodeId)
      ? currentSelection
      : expandSelectedLayerIds(layerSourceNodes, [nodeId]);
    if (!currentSelection.includes(nodeId)) {
      layerSelectionAnchorRef.current[activeEditorId] = nodeId;
      focusedCommandClient.selectNodes(menuNodeIds, 'Select layer for context menu');
      setInspectorVisible(true);
    }
    const pos = computeClampedContextMenuPosition(
      event.clientX,
      event.clientY,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setLayerContextMenu({ nodeId, nodeIds: menuNodeIds, editorId: activeEditorId, x: pos.x, y: pos.y });
  };

  const toggleLayerCollapsed = (nodeId: string) => {
    setCollapsedLayers((current) => {
      const ids = current[activeEditorId] ?? [];
      return {
        ...current,
        [activeEditorId]: ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId],
      };
    });
  };

  const startLayerDrag = (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    selectionSourceRef.current = 'layers';
    layerDragEditorRef.current = activeEditorId;
    const currentSelection = focusedSelectedNodeIds.filter((id) => layerSourceIds.has(id));
    const draggedIds = expandSelectedLayerIds(
      layerSourceNodes,
      currentSelection.includes(nodeId) ? currentSelection : [nodeId],
    );
    layerDragSourceRef.current = draggedIds;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-folio-layer-ids', JSON.stringify(draggedIds));
      event.dataTransfer.setData('text/plain', draggedIds.join(','));
    }
  };

  const updateLayerDropTarget = (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    if (!layerDragSourceRef.current?.length) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setLayerDropTarget({
      nodeId,
      position: getLayerDropPosition(event.currentTarget.getBoundingClientRect(), event.clientY),
    });
  };

  const dropLayer = (targetId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    let draggedIds = layerDragSourceRef.current ?? [];
    const transferred = event.dataTransfer?.getData('application/x-folio-layer-ids');
    if (transferred) {
      try {
        const parsed: unknown = JSON.parse(transferred);
        if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) draggedIds = parsed;
      } catch {
        // Keep the in-memory drag selection as a safe fallback.
      }
    } else if (!draggedIds.length) {
      draggedIds = (event.dataTransfer?.getData('text/plain') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }
    const position = getLayerDropPosition(event.currentTarget.getBoundingClientRect(), event.clientY);
    if (draggedIds.length > 0) {
      const result = focusedCommandClient.moveLayers(draggedIds, targetId, position);
      if (result.status === 'applied' && position === 'inside') {
        setCollapsedLayers((current) => ({
          ...current,
          [activeEditorId]: (current[activeEditorId] ?? []).filter((id) => id !== targetId),
        }));
      }
    }
    layerDragSourceRef.current = null;
    layerDragEditorRef.current = null;
    setLayerDropTarget(null);
  };

  const endLayerDrag = () => {
    layerDragSourceRef.current = null;
    layerDragEditorRef.current = null;
    setLayerDropTarget(null);
  };

  const clearLayerDropTarget = (nodeId: string) => {
    setLayerDropTarget((current) => (current?.nodeId === nodeId ? null : current));
  };

  const dropLayersOnCanvas = (nodeIds: string[], target: EditorTarget) => {
    const source = layerDragEditorRef.current;
    const clearDrag = () => {
      layerDragSourceRef.current = null;
      layerDragEditorRef.current = null;
      setLayerDropTarget(null);
    };
    if (source && source !== target) {
      setNotice('Drag layers into the Canvas that belongs to the active Layers editor.');
      clearDrag();
      return;
    }
    const targetDocument = target === 'main' ? activeDocument : componentDocument;
    const targetClient = getCommandClient(target);
    const requested = new Set(nodeIds);
    const droppedNodes = targetDocument.nodes.filter((node) => requested.has(node.id));
    if (droppedNodes.length === 0) {
      clearDrag();
      return;
    }
    const ids = droppedNodes.map((node) => node.id);
    const existing = droppedNodes.find((node) => node.onCanvas !== false);
    selectionSourceRef.current = 'canvas';
    setActiveEditorId(target);
    setInspectorVisible(true);
    targetClient.selectNodes(ids, 'Select dropped layers');
    if (existing) {
      setNotice(`“${existing.name}” is already on the Canvas. Duplicate objects are not allowed.`);
      clearDrag();
      return;
    }
    const result = targetClient.setNodesCanvasState(ids, true, 'Restore layers to canvas');
    if (result.status === 'applied') {
      setNotice(`“${droppedNodes[0].name}” has been restored to the Canvas with its previous properties.`);
    }
    clearDrag();
  };

  const toggleLayerColorPicker = (nodeId: string, anchor: HTMLButtonElement) => {
    const key = `${activeEditorId}:${nodeId}`;
    if (layerColorPickerKey === key) {
      setLayerColorPickerKey(null);
      setLayerColorPickerPosition(null);
      layerColorAnchorRef.current = null;
      return;
    }
    layerColorAnchorRef.current = anchor;
    const pos = computeClampedPopoverPosition(
      anchor.getBoundingClientRect(),
      { width: 170, height: 160 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setLayerColorPickerPosition(pos);
    setLayerColorPickerKey(key);
  };

  const closeLayerColorPicker = () => {
    setLayerColorPickerKey(null);
    setLayerColorPickerPosition(null);
    layerColorAnchorRef.current = null;
  };

  return {
    layerSourceNodes,
    activeCollapsedLayers,
    layerRows,
    layerSearchQuery,
    setLayerSearchQuery,
    isSearchActive: filteredLayers.isFiltering,
    searchMatchedIds: filteredLayers.matchedIds,
    searchMatchCount: filteredLayers.matchCount,
    layerEffectiveStates,
    layerDropTarget,
    layerContextMenu,
    setLayerContextMenu,
    layerContextMenuRef,
    contextMenuNodes,
    contextMenuCapabilities,
    layerRename,
    layerRenameInputRef,
    layerColorPickerKey,
    layerColorPaletteRef,
    layerColorPickerPosition,
    beginLayerRename,
    updateLayerRenameDraft,
    finishLayerRename,
    setLayerColorFromRow,
    toggleLayerPropertyFromRow,
    selectLayerFromPanel,
    openLayerContextMenu,
    toggleLayerCollapsed,
    startLayerDrag,
    updateLayerDropTarget,
    dropLayer,
    endLayerDrag,
    clearLayerDropTarget,
    dropLayersOnCanvas,
    toggleLayerColorPicker,
    closeLayerColorPicker,
  };
}

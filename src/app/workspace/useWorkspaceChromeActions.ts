import { useRef, useState } from 'preact/hooks';
import type { EditorTarget } from '../editorContext';
import type { TopMenuId } from './GlobalToolbar';

export interface WorkspaceChromeWindowsSlice {
  layersVisible: boolean;
  setLayersVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  inspectorVisible: boolean;
  setInspectorVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  pagesRackOpen: boolean;
  setPagesRackOpen: (value: boolean) => void;
  componentRackOpen: boolean;
  setComponentRackOpen: (value: boolean) => void;
  canvasClosed: boolean;
  setCanvasClosed: (value: boolean) => void;
  canvasMinimized: boolean;
  setCanvasMinimized: (value: boolean) => void;
  componentCanvasClosed: boolean;
  setComponentCanvasClosed: (value: boolean) => void;
  componentCanvasMinimized: boolean;
  setComponentCanvasMinimized: (value: boolean) => void;
  nodeLogicClosed: boolean;
  setNodeLogicClosed: (value: boolean) => void;
  nodeLogicMinimized: boolean;
  setNodeLogicMinimized: (value: boolean) => void;
  zoom: number;
  setZoom: (value: number) => void;
  resetMainView: () => void;
  componentCanvasZoom: number;
  setComponentCanvasZoom: (value: number) => void;
  focusWindow: (windowId: 'main-canvas' | 'component-canvas' | 'node-logic' | 'pages') => void;
  openMainCanvas: () => void;
  openComponentCanvas: () => void;
  openNodeLogic: () => void;
  resetAllWindowLayouts: () => void;
}

export interface UseWorkspaceChromeActionsOptions {
  projectName: string;
  windows: WorkspaceChromeWindowsSlice;
  tokensRackOpen: boolean;
  setTokensRackOpen: (value: boolean) => void;
  closeTokensRack: () => void;
  closePagesRack: () => void;
  closeComponentRack: () => void;
  resetAllPanelWidths: () => void;
  motionOpen: boolean;
  toggleMotionOpen: () => void;
  setOpenMenu: (value: TopMenuId | null) => void;
  setToolRackOpen: (value: string | null) => void;
  setActiveEditorId: (target: EditorTarget) => void;
  setCodeWorkspaceOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  onResetComponentView?: () => void;
  onOpenNodeLogic?: () => void;
  onCommitProjectName: (draft: string) => void;
  setNotice: (message: string) => void;
}

export function useWorkspaceChromeActions(options: UseWorkspaceChromeActionsOptions) {
  const {
    projectName,
    windows,
    tokensRackOpen,
    setTokensRackOpen,
    closeTokensRack,
    closePagesRack,
    closeComponentRack,
    resetAllPanelWidths,
    motionOpen,
    toggleMotionOpen,
    setOpenMenu,
    setToolRackOpen,
    setActiveEditorId,
    setCodeWorkspaceOpen,
    onResetComponentView,
    onOpenNodeLogic,
    onCommitProjectName,
    setNotice,
  } = options;

  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameCancelRef = useRef(false);

  const startProjectRename = () => {
    setProjectNameDraft(projectName);
    projectNameCancelRef.current = false;
    setProjectNameEditing(true);
  };

  const commitProjectRename = () => {
    if (!projectNameCancelRef.current) onCommitProjectName(projectNameDraft);
    projectNameCancelRef.current = false;
    setProjectNameEditing(false);
  };

  const cancelProjectRename = () => {
    projectNameCancelRef.current = true;
    setProjectNameDraft(projectName);
    setProjectNameEditing(false);
  };

  const enterFullscreen = () => {
    const root = document.querySelector('.app-shell') as HTMLElement | null;
    if (!document.fullscreenElement) {
      root?.requestFullscreen?.().catch(() => setNotice('Fullscreen is unavailable in this browser.'));
    } else {
      document.exitFullscreen?.();
    }
  };

  const resetWindowLayout = () => {
    windows.resetAllWindowLayouts();
    resetAllPanelWidths();
    setOpenMenu(null);
    setNotice('Window layout has been reset.');
  };

  const stepWorkspaceZoom = (target: EditorTarget, action: 'in' | 'out' | 'reset') => {
    const currentZoom = target === 'main' ? windows.zoom : windows.componentCanvasZoom;
    const setTargetZoom = target === 'main' ? windows.setZoom : windows.setComponentCanvasZoom;
    if (action === 'reset') {
      if (target === 'main') {
        windows.resetMainView();
      } else if (onResetComponentView) {
        onResetComponentView();
      } else {
        setTargetZoom(1);
      }
      setNotice('Zoom reset to 100%.');
      return;
    }
    const next = action === 'in'
      ? Math.min(4, Math.round(currentZoom * 1.15 * 100) / 100)
      : Math.max(0.2, Math.round((currentZoom / 1.15) * 100) / 100);
    setTargetZoom(next);
  };

  const toggleFocusCanvas = () => {
    const anySidebarOpen = windows.layersVisible || windows.inspectorVisible;
    windows.setLayersVisible(!anySidebarOpen);
    windows.setInspectorVisible(!anySidebarOpen);
    setNotice(anySidebarOpen ? 'Focus Canvas enabled (Ctrl+\\ to restore panels).' : 'Studio sidebars restored.');
  };

  const togglePagesRack = () => {
    setToolRackOpen(null);
    if (windows.pagesRackOpen) closePagesRack();
    else {
      windows.focusWindow('pages');
      windows.setPagesRackOpen(true);
      closeComponentRack();
      closeTokensRack();
    }
  };

  const toggleComponentRack = () => {
    setToolRackOpen(null);
    if (windows.componentRackOpen) closeComponentRack();
    else {
      windows.setComponentRackOpen(true);
      closePagesRack();
      closeTokensRack();
    }
  };

  const toggleTokensRack = () => {
    setToolRackOpen(null);
    if (tokensRackOpen) closeTokensRack();
    else {
      setTokensRackOpen(true);
      closePagesRack();
      closeComponentRack();
    }
  };

  const toggleMotionTimeline = () => {
    if (!motionOpen) {
      closePagesRack();
      closeComponentRack();
      closeTokensRack();
    }
    toggleMotionOpen();
  };

  const toggleStudioPanel = (panel: 'layers' | 'inspector' | 'pages' | 'components' | 'motion' | 'code') => {
    if (panel === 'layers') {
      windows.setLayersVisible(!windows.layersVisible);
    } else if (panel === 'inspector') {
      windows.setInspectorVisible(!windows.inspectorVisible);
    } else if (panel === 'pages') {
      togglePagesRack();
    } else if (panel === 'components') {
      toggleComponentRack();
    } else if (panel === 'motion') {
      toggleMotionTimeline();
    } else if (panel === 'code') {
      setCodeWorkspaceOpen((prev) => {
        if (!prev) setActiveEditorId('main');
        return !prev;
      });
    }
  };

  const toggleMainCanvas = () => {
    if (windows.canvasClosed || windows.canvasMinimized) windows.openMainCanvas();
    else {
      windows.setCanvasClosed(true);
      windows.setCanvasMinimized(false);
    }
  };

  const toggleComponentCanvas = () => {
    if (windows.componentCanvasClosed || windows.componentCanvasMinimized) windows.openComponentCanvas();
    else {
      windows.setComponentCanvasClosed(true);
      windows.setComponentCanvasMinimized(false);
      setActiveEditorId('main');
      if (!windows.canvasClosed && !windows.canvasMinimized) windows.focusWindow('main-canvas');
    }
  };

  const toggleNodeLogic = () => {
    if (windows.nodeLogicClosed || windows.nodeLogicMinimized) {
      if (onOpenNodeLogic) onOpenNodeLogic();
      else windows.openNodeLogic();
    } else {
      windows.setNodeLogicClosed(true);
      windows.setNodeLogicMinimized(false);
    }
  };

  return {
    projectNameEditing,
    setProjectNameEditing,
    projectNameDraft,
    setProjectNameDraft,
    startProjectRename,
    commitProjectRename,
    cancelProjectRename,
    enterFullscreen,
    resetWindowLayout,
    stepWorkspaceZoom,
    toggleFocusCanvas,
    toggleStudioPanel,
    togglePagesRack,
    toggleComponentRack,
    toggleTokensRack,
    toggleMainCanvas,
    toggleComponentCanvas,
    toggleNodeLogic,
    toggleMotionTimeline,
  };
}

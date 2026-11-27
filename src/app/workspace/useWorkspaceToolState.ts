import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import {
  getStudioTool,
  getStudioToolGroupsForWorkspace,
  isToolAvailableInWorkspace,
} from '../../engines/canvas/tools/studioRegistry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolId,
  type CanvasToolOptions,
} from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import { createToolbarHintStore } from '../ToolbarHintBar';
import type { TopMenuId } from './GlobalToolbar';
import type { CodeWorkspaceViewMode } from './useCodeWorkspace';

export interface UseWorkspaceToolStateOptions {
  activeEditorId: EditorTarget;
  resizingPanelRef: { current: 'layers' | 'inspector' | null };
  setActiveEditorId: (target: EditorTarget) => void;
  setPagesRackOpen: (open: boolean) => void;
  setComponentRackOpen: (open: boolean) => void;
}

export function useWorkspaceToolState({
  activeEditorId,
  resizingPanelRef,
  setActiveEditorId,
  setPagesRackOpen,
  setComponentRackOpen,
}: UseWorkspaceToolStateOptions) {
  const toolbarHintStore = useMemo(() => createToolbarHintStore(), []);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const toolRailRef = useRef<HTMLElement | null>(null);
  const pagesRackRef = useRef<HTMLElement | null>(null);
  const componentRackRef = useRef<HTMLElement | null>(null);
  const pagesRackToggleRef = useRef<HTMLButtonElement | null>(null);
  const componentRackToggleRef = useRef<HTMLButtonElement | null>(null);

  const [openMenu, setOpenMenu] = useState<TopMenuId | null>(null);
  const [toolRackOpen, setToolRackOpen] = useState<string | null>(null);
  const [codeWorkspaceOpen, setCodeWorkspaceOpen] = useState(false);
  const [motionExportOpen, setMotionExportOpen] = useState(false);
  const [codeWorkspaceLaunch, setCodeWorkspaceLaunch] = useState<{
    viewMode: CodeWorkspaceViewMode;
    pageId?: string;
    nonce: number;
  }>({ viewMode: 'code', nonce: 0 });
  const [workspaceTools, setWorkspaceTools] = useState<Record<EditorTarget, CanvasToolId>>({
    main: 'select',
    component: 'select',
  });
  const [toolOptions, setToolOptions] = useState<CanvasToolOptions>(DEFAULT_CANVAS_TOOL_OPTIONS);
  const [componentRackSearch, setComponentRackSearch] = useState('');

  const closePagesRack = useCallback(() => {
    if (pagesRackRef.current?.contains(document.activeElement)) {
      pagesRackToggleRef.current?.focus({ preventScroll: true });
    }
    setPagesRackOpen(false);
  }, [setPagesRackOpen]);

  const closeComponentRack = useCallback(() => {
    if (componentRackRef.current?.contains(document.activeElement)) {
      componentRackToggleRef.current?.focus({ preventScroll: true });
    }
    setComponentRackOpen(false);
  }, [setComponentRackOpen]);

  const updateToolbarHint = useCallback(
    (panel: string, description: string, shortcuts: string[] = []) => {
      if (resizingPanelRef.current !== null) return;
      toolbarHintStore.setHint({ panel, description, shortcuts });
    },
    [toolbarHintStore, resizingPanelRef],
  );

  const activeCanvasToolId = workspaceTools[activeEditorId];
  const activeToolGroups = getStudioToolGroupsForWorkspace(activeEditorId);

  const setWorkspaceToolId = useCallback((target: EditorTarget, toolId: CanvasToolId) => {
    const resolvedToolId = isToolAvailableInWorkspace(toolId, target) ? toolId : 'select';
    setWorkspaceTools((current) =>
      current[target] === resolvedToolId ? current : { ...current, [target]: resolvedToolId },
    );
  }, []);

  const updateToolOptions = useCallback((patch: Partial<CanvasToolOptions>) => {
    setToolOptions((current) => ({ ...current, ...patch }));
  }, []);

  const applySampledColorOption = useCallback((color: string, colorTarget: 'fill' | 'stroke') => {
    setToolOptions((current) => ({
      ...current,
      ...(colorTarget === 'stroke' ? { strokeColor: color } : { fillColor: color }),
      brushColor: color,
      brushTokenId: undefined,
      paintBucketColor: color,
      paintBucketTokenId: undefined,
    }));
  }, []);

  const chooseCanvasTool = useCallback(
    (toolId: CanvasToolId, target: EditorTarget = activeEditorId) => {
      const resolvedToolId = isToolAvailableInWorkspace(toolId, target) ? toolId : 'select';
      const tool = getStudioTool(resolvedToolId);
      setWorkspaceToolId(target, resolvedToolId);
      setToolRackOpen(null);
      updateToolbarHint(
        tool.label.toUpperCase(),
        tool.description,
        tool.shortcut ? [`KEY: ${tool.shortcut.toUpperCase()}`] : [],
      );
    },
    [activeEditorId, setWorkspaceToolId, updateToolbarHint],
  );

  const openLivePreviewForPage = useCallback(
    (pageId?: string) => {
      setActiveEditorId('main');
      setCodeWorkspaceLaunch((current) => ({ viewMode: 'preview', pageId, nonce: current.nonce + 1 }));
      setCodeWorkspaceOpen(true);
    },
    [setActiveEditorId],
  );

  return {
    toolbarHintStore,
    projectFileInputRef,
    menuBarRef,
    toolRailRef,
    pagesRackRef,
    componentRackRef,
    pagesRackToggleRef,
    componentRackToggleRef,
    openMenu,
    setOpenMenu,
    toolRackOpen,
    setToolRackOpen,
    codeWorkspaceOpen,
    setCodeWorkspaceOpen,
    motionExportOpen,
    setMotionExportOpen,
    codeWorkspaceLaunch,
    workspaceTools,
    setWorkspaceTools,
    toolOptions,
    componentRackSearch,
    setComponentRackSearch,
    closePagesRack,
    closeComponentRack,
    updateToolbarHint,
    activeCanvasToolId,
    activeToolGroups,
    setWorkspaceToolId,
    updateToolOptions,
    applySampledColorOption,
    chooseCanvasTool,
    openLivePreviewForPage,
  };
}

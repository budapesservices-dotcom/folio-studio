import { useEffect, useMemo, useState } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  BreakpointId,
  CodeModuleLanguage,
  DesignNode,
  FolioProject,
} from '../../core/document/types';
import {
  applyMappedNodeEdit,
  buildLivePreviewHtml,
  compileFolioProject,
  createCustomCodeModule,
  createNodeExtensionModule,
  type CodeOutputTarget,
  type CompiledCodeFile,
  type CompiledProjectOutput,
  type MappedNodeEditPatch,
} from '../../engines/codegen';
import { toPageFileSlug } from '../../engines/codegen/sanitize';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';

export type CodeWorkspaceViewMode = 'split' | 'code' | 'preview';

export interface MappedSyncFeedback {
  tone: 'ok' | 'error';
  message: string;
}

export interface UseCodeWorkspaceOptions {
  project: FolioProject;
  selectedNodeId: string | null;
  activeBreakpoint: BreakpointId;
  mainCommandClient: MainCanvasCommandClient;
  onNotice: (message: string) => void;
  onJumpToCanvasNode?: (nodeId: string) => void;
  controlledOpen?: boolean;
  onControlledClose?: () => void;
  initialViewMode?: CodeWorkspaceViewMode;
  initialPageId?: string;
}

export interface UseCodeWorkspaceResult {
  open: boolean;
  viewMode: CodeWorkspaceViewMode;
  outputTarget: CodeOutputTarget;
  selectedFilePath: string;
  selectedFile: CompiledCodeFile | null;
  compiled: CompiledProjectOutput;
  previewHtml: string;
  previewPageId: string;
  previewThemeId: string;
  previewBreakpoint: BreakpointId;
  includeCustomScripts: boolean;
  refreshNonce: number;
  mappedTargetNodeId: string | null;
  mappedTargetNode: DesignNode | null;
  previewPageNodes: readonly DesignNode[];
  mappedFeedback: MappedSyncFeedback | null;
  toggleOpen: () => void;
  close: () => void;
  setViewMode: (mode: CodeWorkspaceViewMode) => void;
  setOutputTarget: (target: CodeOutputTarget) => void;
  setSelectedFilePath: (path: string) => void;
  setPreviewPageId: (pageId: string) => void;
  setPreviewThemeId: (themeId: string) => void;
  setPreviewBreakpoint: (breakpoint: BreakpointId) => void;
  setIncludeCustomScripts: (enabled: boolean) => void;
  setMappedTargetNodeId: (nodeId: string | null) => void;
  refreshPreview: () => void;
  applyMappedPatch: (nodeId: string, patch: MappedNodeEditPatch) => void;
  addCustomModule: (language: Extract<CodeModuleLanguage, 'css' | 'js'>) => void;
  addNodeExtension: (nodeId?: string) => void;
  updateModuleContent: (moduleId: string, content: string) => void;
  commitModuleEdit: () => void;
  deleteModule: (moduleId: string) => void;
  focusNodeInCanvas: (nodeId: string) => void;
  copySelectedFile: () => void;
  downloadPreviewHtml: () => void;
}

export function useCodeWorkspace({
  project,
  selectedNodeId,
  activeBreakpoint,
  mainCommandClient,
  onNotice,
  onJumpToCanvasNode,
  controlledOpen,
  onControlledClose,
  initialViewMode = 'split',
  initialPageId,
}: UseCodeWorkspaceOptions): UseCodeWorkspaceResult {
  const activePage = getActivePage(project);
  const designTokens = getProjectDesignTokens(project);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [viewMode, setViewMode] = useState<CodeWorkspaceViewMode>(initialViewMode);
  const [outputTarget, setOutputTarget] = useState<CodeOutputTarget>('html-css');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [previewPageId, setPreviewPageId] = useState<string>(initialPageId ?? activePage.id);
  const [previewThemeId, setPreviewThemeId] = useState<string>(designTokens.activeThemeId);
  const [previewBreakpoint, setPreviewBreakpoint] = useState<BreakpointId>(activeBreakpoint);
  const [includeCustomScripts, setIncludeCustomScripts] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [mappedTargetNodeId, setMappedTargetNodeId] = useState<string | null>(selectedNodeId);
  const [mappedFeedback, setMappedFeedback] = useState<MappedSyncFeedback | null>(null);

  // Keep preview page synced when project active page changes or page list changes
  useEffect(() => {
    if (!project.pages.some((page) => page.id === previewPageId)) {
      setPreviewPageId(activePage.id);
    }
  }, [project.pages, previewPageId, activePage.id]);

  // Keep preview theme synced when active token theme changes
  useEffect(() => {
    setPreviewThemeId(designTokens.activeThemeId);
  }, [designTokens.activeThemeId]);

  // Sync canvas breakpoint into preview when workspace opens
  useEffect(() => {
    if (open) {
      setPreviewBreakpoint(activeBreakpoint);
    }
  }, [open, activeBreakpoint]);

  const previewPage = useMemo(
    () => project.pages.find((page) => page.id === previewPageId) ?? activePage,
    [project.pages, previewPageId, activePage],
  );

  const previewPageNodes = useMemo(
    () => previewPage.document.nodes.filter((node) => node.onCanvas !== false),
    [previewPage.document.nodes],
  );

  // Keep mapped target node synced with canvas selection when valid on preview page
  useEffect(() => {
    if (selectedNodeId && previewPageNodes.some((node) => node.id === selectedNodeId)) {
      setMappedTargetNodeId(selectedNodeId);
      setMappedFeedback(null);
    } else if (
      !mappedTargetNodeId ||
      !previewPageNodes.some((node) => node.id === mappedTargetNodeId)
    ) {
      const preferred =
        previewPageNodes.find((node) => node.type === 'text') ?? previewPageNodes[0] ?? null;
      setMappedTargetNodeId(preferred?.id ?? null);
    }
  }, [selectedNodeId, previewPageNodes, mappedTargetNodeId]);

  const compiled = useMemo(
    () =>
      compileFolioProject(project, {
        target: outputTarget,
        pageId: previewPage.id,
        themeId: previewThemeId,
        includeAllPages: true,
      }),
    [project, outputTarget, previewPage.id, previewThemeId],
  );

  const selectedFile = useMemo(() => {
    const exact = compiled.files.find((file) => file.path === selectedFilePath);
    if (exact) return exact;
    const activePageFile = compiled.files.find(
      (file) => file.pageId === previewPage.id && file.category === 'mapped',
    );
    return activePageFile ?? compiled.files[0] ?? null;
  }, [compiled.files, selectedFilePath, previewPage.id]);

  useEffect(() => {
    if (selectedFile && selectedFile.path !== selectedFilePath) {
      setSelectedFilePath(selectedFile.path);
    }
  }, [selectedFile, selectedFilePath]);

  const previewHtml = useMemo(
    () =>
      open
        ? buildLivePreviewHtml(project, {
            pageId: previewPage.id,
            themeId: previewThemeId,
            includeCustomScripts,
          })
        : '',
    [open, project, previewPage.id, previewThemeId, includeCustomScripts],
  );

  const mappedTargetNode = useMemo(
    () => previewPageNodes.find((node) => node.id === mappedTargetNodeId) ?? null,
    [previewPageNodes, mappedTargetNodeId],
  );

  const ensurePreviewPageActive = () => {
    if (project.activePageId !== previewPage.id) {
      mainCommandClient.setActivePage(previewPage.id, 'Switch to mapped page');
    }
  };

  const applyMappedPatch = (nodeId: string, patch: MappedNodeEditPatch) => {
    const node = previewPage.document.nodes.find((item) => item.id === nodeId);
    if (!node) {
      setMappedFeedback({
        tone: 'error',
        message: 'Target AST node no longer exists on this page.',
      });
      return;
    }

    const result = applyMappedNodeEdit(node, patch);
    if (result.status === 'unsupported') {
      setMappedFeedback({ tone: 'error', message: result.reason });
      return;
    }
    if (result.status === 'no-op') {
      setMappedFeedback({ tone: 'ok', message: result.reason });
      return;
    }

    ensurePreviewPageActive();
    const commandResult = mainCommandClient.editNode(
      result.node,
      `mapped-code:${nodeId}:${Date.now()}`,
      `Sync mapped code (${result.changedFields.join(', ')})`,
    );
    if (commandResult.status === 'rejected') {
      setMappedFeedback({ tone: 'error', message: commandResult.message });
      return;
    }
    mainCommandClient.commitEdit('Commit mapped code edit');
    setMappedFeedback({ tone: 'ok', message: result.summary });
    onNotice(result.summary);
  };

  const addCustomModule = (language: Extract<CodeModuleLanguage, 'css' | 'js'>) => {
    const existing = project.codeModules ?? [];
    const created = createCustomCodeModule(existing, language);
    const result = mainCommandClient.updateCodeModules(
      [...existing, created],
      `Create custom ${language.toUpperCase()} module`,
    );
    if (result.status === 'applied') {
      setSelectedFilePath(created.path);
      if (viewMode === 'preview') setViewMode('split');
      onNotice(`Created Custom module ${created.path}.`);
    }
  };

  const addNodeExtension = (nodeId?: string) => {
    const targetNode =
      (nodeId ? previewPageNodes.find((item) => item.id === nodeId) : undefined) ??
      mappedTargetNode ??
      previewPageNodes[0];
    if (!targetNode) {
      onNotice('Select or add a layer on the page before creating a Node Extension.');
      return;
    }
    const existing = project.codeModules ?? [];
    const created = createNodeExtensionModule(targetNode, previewPage.id, existing);
    const result = mainCommandClient.updateCodeModules(
      [...existing, created],
      `Add extension for ${targetNode.name}`,
    );
    if (result.status === 'applied') {
      setSelectedFilePath(created.path);
      if (viewMode === 'preview') setViewMode('split');
      onNotice(`Created Node Extension ${created.path} anchored to "${targetNode.name}".`);
    }
  };

  const updateModuleContent = (moduleId: string, content: string) => {
    const existing = project.codeModules ?? [];
    const nextModules = existing.map((mod) =>
      mod.id === moduleId
        ? { ...mod, content, updatedAt: new Date().toISOString() }
        : mod,
    );
    mainCommandClient.updateCodeModules(
      nextModules,
      'Edit custom/extension code module',
      `code-module:${moduleId}`,
    );
  };

  const commitModuleEdit = () => {
    mainCommandClient.commitEdit('Commit custom/extension code edit');
  };

  const deleteModule = (moduleId: string) => {
    const existing = project.codeModules ?? [];
    const target = existing.find((mod) => mod.id === moduleId);
    if (!target) return;
    const nextModules = existing.filter((mod) => mod.id !== moduleId);
    const result = mainCommandClient.updateCodeModules(
      nextModules,
      `Delete code module ${target.path}`,
    );
    if (result.status === 'applied') {
      onNotice(`Deleted ${target.path}.`);
    }
  };

  const focusNodeInCanvas = (nodeId: string) => {
    ensurePreviewPageActive();
    mainCommandClient.selectNodes([nodeId], 'Select mapped node from Code Studio');
    onJumpToCanvasNode?.(nodeId);
    if (controlledOpen !== undefined) {
      onControlledClose?.();
    } else {
      setInternalOpen(false);
    }
    const target = previewPageNodes.find((node) => node.id === nodeId);
    onNotice(target ? `Focused "${target.name}" on Canvas.` : 'Focused node on Canvas.');
  };

  const copySelectedFile = () => {
    if (!selectedFile) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(selectedFile.content).then(
        () => onNotice(`Copied ${selectedFile.path} to clipboard.`),
        () => onNotice('Clipboard access was denied by the browser.'),
      );
    } else {
      onNotice('Clipboard API is unavailable in this environment.');
    }
  };

  const downloadPreviewHtml = () => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const html = buildLivePreviewHtml(project, {
      pageId: previewPage.id,
      themeId: previewThemeId,
      includeCustomScripts,
    });
    const slug = toPageFileSlug(previewPage.route, previewPage.name);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${toPageFileSlug('', project.metadata.name)}-${slug}.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice(`Exported standalone HTML (${anchor.download}).`);
  };

  return {
    open,
    viewMode,
    outputTarget,
    selectedFilePath,
    selectedFile,
    compiled,
    previewHtml,
    previewPageId: previewPage.id,
    previewThemeId,
    previewBreakpoint,
    includeCustomScripts,
    refreshNonce,
    mappedTargetNodeId,
    mappedTargetNode,
    previewPageNodes,
    mappedFeedback,
    toggleOpen: () => {
      if (controlledOpen !== undefined) {
        if (controlledOpen) onControlledClose?.();
      } else {
        setInternalOpen((current) => !current);
      }
    },
    close: () => {
      commitModuleEdit();
      if (controlledOpen !== undefined) {
        onControlledClose?.();
      } else {
        setInternalOpen(false);
      }
    },
    setViewMode,
    setOutputTarget,
    setSelectedFilePath: (path) => {
      commitModuleEdit();
      setSelectedFilePath(path);
    },
    setPreviewPageId,
    setPreviewThemeId,
    setPreviewBreakpoint,
    setIncludeCustomScripts,
    setMappedTargetNodeId: (nodeId) => {
      setMappedTargetNodeId(nodeId);
      setMappedFeedback(null);
    },
    refreshPreview: () => setRefreshNonce((count) => count + 1),
    applyMappedPatch,
    addCustomModule,
    addNodeExtension,
    updateModuleContent,
    commitModuleEdit,
    deleteModule,
    focusNodeInCanvas,
    copySelectedFile,
    downloadPreviewHtml,
  };
}

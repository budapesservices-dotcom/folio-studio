import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import { getComputeWorkerClient } from '../../core/kernels';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  BreakpointId,
  CodeModuleLanguage,
  DesignNode,
  FolioProject,
} from '../../core/document/types';
import {
  getAssetCacheRevision,
  materializeProjectAssetsForExport,
  subscribeAssetCacheUpdates,
} from '../../core/persistence/assetStore';
import {
  applyA11yQuickFixToNode,
  applyMappedNodeEdit,
  auditPageAccessibility,
  buildCompiledProjectBundle,
  buildLivePreviewHtml,
  compileFolioProject,
  createCustomCodeModule,
  createNodeExtensionModule,
  type A11yAuditReport,
  type A11yQuickFix,
  type CodeOutputTarget,
  type CompiledCodeFile,
  type CompiledProjectOutput,
  type MappedNodeEditPatch,
} from '../../engines/codegen';
import { toPageFileSlug } from '../../engines/codegen/sanitize';
import { stripUndefinedEntries, type MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  computePreviewDebounceMs,
  createDeferredTaskScheduler,
  type DeferredTaskScheduler,
} from './previewCompilationScheduler';

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
  a11yReport: A11yAuditReport;
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
  downloadProjectZip: () => void;
  applyA11yFix: (fix: A11yQuickFix) => void;
  applyAllA11yFixes: () => void;
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
  const [assetCacheRevision, setAssetCacheRevision] = useState(() => getAssetCacheRevision());
  const [mappedTargetNodeId, setMappedTargetNodeId] = useState<string | null>(selectedNodeId);
  const [mappedFeedback, setMappedFeedback] = useState<MappedSyncFeedback | null>(null);

  useEffect(() => subscribeAssetCacheUpdates(() => {
    setAssetCacheRevision(getAssetCacheRevision());
  }), []);

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

  const shouldRenderPreview = open && viewMode !== 'code';

  const compileProjectSnapshot = (
    proj: FolioProject,
    target: CodeOutputTarget,
    pageId: string,
    themeId: string,
  ): CompiledProjectOutput =>
    compileFolioProject(proj, {
      target,
      pageId,
      themeId,
      includeAllPages: true,
    });

  const compilePreviewSnapshot = (
    proj: FolioProject,
    pageId: string,
    themeId: string,
    scripts: boolean,
  ): string =>
    buildLivePreviewHtml(proj, {
      pageId,
      themeId,
      includeCustomScripts: scripts,
    });

  const [compiled, setCompiled] = useState<CompiledProjectOutput>(() =>
    open
      ? compileProjectSnapshot(project, outputTarget, previewPage.id, previewThemeId)
      : {
          target: outputTarget,
          activePageId: previewPage.id,
          activeThemeId: previewThemeId,
          files: [],
          summary: {
            totalFiles: 0,
            generatedCount: 0,
            mappedCount: 0,
            customCount: 0,
            extensionCount: 0,
            mappedNodeCount: 0,
          },
        },
  );

  const [previewHtml, setPreviewHtml] = useState<string>(() =>
    shouldRenderPreview
      ? compilePreviewSnapshot(project, previewPage.id, previewThemeId, includeCustomScripts)
      : '',
  );

  const compileSchedulerRef = useRef<DeferredTaskScheduler | null>(null);
  if (!compileSchedulerRef.current) {
    compileSchedulerRef.current = createDeferredTaskScheduler();
  }

  // Track last-committed explicit control keys so user clicks (open, page, theme,
  // target, viewMode, scripts) flush immediately while rapid Canvas drags debounce.
  const prevCompileContextRef = useRef({
    open,
    outputTarget,
    pageId: previewPage.id,
    themeId: previewThemeId,
    includeCustomScripts,
    shouldRenderPreview,
    assetCacheRevision,
    project,
  });

  useEffect(() => {
    const scheduler = compileSchedulerRef.current!;
    const prev = prevCompileContextRef.current;
    const explicitControlChanged =
      prev.open !== open ||
      prev.outputTarget !== outputTarget ||
      prev.pageId !== previewPage.id ||
      prev.themeId !== previewThemeId ||
      prev.includeCustomScripts !== includeCustomScripts ||
      prev.shouldRenderPreview !== shouldRenderPreview ||
      prev.assetCacheRevision !== assetCacheRevision;
    const projectChanged = prev.project !== project;

    prevCompileContextRef.current = {
      open,
      outputTarget,
      pageId: previewPage.id,
      themeId: previewThemeId,
      includeCustomScripts,
      shouldRenderPreview,
      assetCacheRevision,
      project,
    };

    if (!open) {
      scheduler.cancel();
      return;
    }

    if (!explicitControlChanged && !projectChanged) {
      return;
    }

    const delayMs = explicitControlChanged
      ? 0
      : computePreviewDebounceMs(previewPage.document.nodes.length);

    scheduler.schedule(
      delayMs,
      () => {
        setCompiled(compileProjectSnapshot(project, outputTarget, previewPage.id, previewThemeId));
        if (shouldRenderPreview) {
          setPreviewHtml(
            compilePreviewSnapshot(project, previewPage.id, previewThemeId, includeCustomScripts),
          );
        }
      },
      { immediate: explicitControlChanged },
    );
  }, [
    open,
    project,
    outputTarget,
    previewPage.id,
    previewPage.document.nodes.length,
    previewThemeId,
    includeCustomScripts,
    shouldRenderPreview,
    assetCacheRevision,
  ]);

  useEffect(() => () => {
    compileSchedulerRef.current?.cancel();
  }, []);

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

  const WORKER_A11Y_NODE_THRESHOLD = 100;
  const shouldOffloadA11y = previewPage.document.nodes.length >= WORKER_A11Y_NODE_THRESHOLD;

  const syncA11yReport = useMemo(
    () => (shouldOffloadA11y ? null : auditPageAccessibility(project, previewPage, previewThemeId)),
    [shouldOffloadA11y, project, previewPage, previewThemeId],
  );

  const [asyncA11yReport, setAsyncA11yReport] = useState<A11yAuditReport | null>(null);
  const a11yRequestSeqRef = useRef(0);

  useEffect(() => {
    if (!shouldOffloadA11y) {
      setAsyncA11yReport(null);
      return;
    }
    const seq = ++a11yRequestSeqRef.current;
    let cancelled = false;
    void getComputeWorkerClient()
      .auditAccessibilityAsync(project, previewPage.id, previewThemeId)
      .then((report) => {
        if (!cancelled && a11yRequestSeqRef.current === seq) {
          setAsyncA11yReport(report);
        }
      })
      .catch(() => {
        if (!cancelled && a11yRequestSeqRef.current === seq) {
          setAsyncA11yReport(auditPageAccessibility(project, previewPage, previewThemeId));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldOffloadA11y, project, previewPage, previewThemeId]);

  const a11yReport = useMemo<A11yAuditReport>(
    () =>
      syncA11yReport ??
      asyncA11yReport ?? {
        pageId: previewPage.id,
        pageName: previewPage.name,
        score: 100,
        passedChecks: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        issues: [],
      },
    [syncA11yReport, asyncA11yReport, previewPage.id, previewPage.name],
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
    const fallbackCopy = (): boolean => {
      if (typeof document === 'undefined' || !document.body) return false;
      const textarea = document.createElement('textarea');
      textarea.value = selectedFile.content;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }
      return copied;
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(selectedFile.content).then(
        () => onNotice(`Copied ${selectedFile.path} to clipboard.`),
        () => {
          if (fallbackCopy()) {
            onNotice(`Copied ${selectedFile.path} to clipboard.`);
          } else {
            onNotice('Clipboard access was denied by the browser.');
          }
        },
      );
    } else if (fallbackCopy()) {
      onNotice(`Copied ${selectedFile.path} to clipboard.`);
    } else {
      onNotice('Clipboard API is unavailable in this environment.');
    }
  };

  const downloadPreviewHtml = () => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    void (async () => {
      try {
        const portableProject = await materializeProjectAssetsForExport(project);
        const html = buildLivePreviewHtml(portableProject, {
          pageId: previewPage.id,
          themeId: previewThemeId,
          includeCustomScripts,
          assetMode: 'portable',
        });
        const slug = toPageFileSlug(previewPage.route, previewPage.name);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${toPageFileSlug('', portableProject.metadata.name)}-${slug}.html`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onNotice(`Exported standalone HTML (${anchor.download}).`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
        onNotice(`Unable to export standalone HTML: ${detail}`);
      }
    })();
  };

  const downloadProjectZip = () => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    void (async () => {
      try {
        const portableProject = await materializeProjectAssetsForExport(project);
        const bundle = buildCompiledProjectBundle(portableProject, {
          target: outputTarget,
          pageId: previewPage.id,
          themeId: previewThemeId,
        });
        const zipBuffer = new Uint8Array(bundle.zipBytes).buffer;
        const blob = new Blob([zipBuffer], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = bundle.fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onNotice(`Exported ${bundle.fileName} (${bundle.entries.length} files).`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
        onNotice(`Unable to export project ZIP: ${detail}`);
      }
    })();
  };

  const applyA11yFix = (fix: A11yQuickFix) => {
    const targetNode = previewPage.document.nodes.find((item) => item.id === fix.nodeId);
    if (!targetNode) {
      onNotice('Target layer no longer exists on this page.');
      return;
    }
    ensurePreviewPageActive();
    const updatedNode = applyA11yQuickFixToNode(targetNode, fix);
    const result = mainCommandClient.replaceNode(updatedNode, fix.description);
    if (result.status === 'rejected') {
      onNotice(result.message);
      return;
    }
    onNotice(`${fix.description}.`);
  };

  const applyAllA11yFixes = () => {
    const fixes = a11yReport.issues
      .map((issue) => issue.fix)
      .filter((fix): fix is A11yQuickFix => Boolean(fix));
    if (fixes.length === 0) return;

    ensurePreviewPageActive();
    const mergedNodesById = new Map<string, DesignNode>();
    for (const fix of fixes) {
      const existing =
        mergedNodesById.get(fix.nodeId)
        ?? previewPage.document.nodes.find((item) => item.id === fix.nodeId);
      if (!existing) continue;
      mergedNodesById.set(fix.nodeId, applyA11yQuickFixToNode(existing, fix));
    }
    if (mergedNodesById.size === 0) return;

    const astView = mainCommandClient.getActiveAstView();
    const transactionId = globalThis.crypto?.randomUUID?.() ?? `a11y-fix-${Date.now().toString(36)}`;
    const envelopes = [...mergedNodesById.values()].map((updatedNode) => {
      const ref = astView.getNodeRef(updatedNode.id) ?? {
        document: astView.address,
        nodeId: updatedNode.id,
      };
      return mainCommandClient.createEnvelope(
        'node.replace',
        { kind: 'node', ref },
        { node: stripUndefinedEntries(updatedNode) },
        'Auto-fix accessibility issues',
        transactionId,
      );
    });

    const txResult = mainCommandClient.executeTransaction(envelopes);
    if (txResult.status === 'rejected') {
      onNotice(txResult.message);
      return;
    }
    onNotice(`Applied ${fixes.length} accessibility fix${fixes.length === 1 ? '' : 'es'}.`);
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
    a11yReport,
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
    refreshPreview: () => {
      compileSchedulerRef.current?.flush();
      setRefreshNonce((count) => count + 1);
    },
    applyMappedPatch,
    addCustomModule,
    addNodeExtension,
    updateModuleContent,
    commitModuleEdit,
    deleteModule,
    focusNodeInCanvas,
    copySelectedFile,
    downloadPreviewHtml,
    downloadProjectZip,
    applyA11yFix,
    applyAllA11yFixes,
  };
}

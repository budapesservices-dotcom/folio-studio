import { useEffect, useState } from 'preact/hooks';
import type { BreakpointId, FolioDocument, FolioProject } from '../../core/document/types';
import {
  isStorageQuotaExceededError,
  loadMostRecentProject,
  saveProjectAndActivate,
  saveProjectIfRevisionCurrent,
  subscribeExternalPersistenceSync,
} from '../../core/persistence/indexedDb';
import {
  hydrateProjectAssetsToStore,
  materializeProjectAssetsForExport,
} from '../../core/persistence/assetStore';
import { downloadProject } from '../../core/persistence/projectFile';
import { setRevisionFencedAutosaveStatus } from '../debouncedAutosave';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { createProjectExportSnapshot } from '../projectExport';
import { openProjectFile } from '../projectFileActions';
import { resolveActiveExportTarget } from './canvasViewState';

export interface UseProjectFileLifecycleOptions {
  project: FolioProject;
  componentProject: FolioProject;
  componentDocument: FolioDocument;
  activeEditorId: EditorTarget;
  getActiveBreakpoint?: () => BreakpointId;
  getEditingComponentId: () => string | null;
  onResetEditingComponent: () => void;
  mainCommandClient: MainCanvasCommandClient;
  getCanonicalRevision: () => number;
  getCanonicalProject: () => FolioProject;
  subscribeCanonicalStore: (listener: () => void) => () => void;
  setActiveEditorId: (target: EditorTarget) => void;
  setComponentCanvasClosed: (closed: boolean) => void;
  setComponentCanvasMinimized: (minimized: boolean) => void;
  setFileMenuOpen: (open: boolean) => void;
  setNotice: (message: string) => void;
}

export function useProjectFileLifecycle({
  project,
  componentProject,
  componentDocument,
  activeEditorId,
  getActiveBreakpoint,
  getEditingComponentId,
  onResetEditingComponent,
  mainCommandClient,
  getCanonicalRevision,
  getCanonicalProject,
  subscribeCanonicalStore,
  setActiveEditorId,
  setComponentCanvasClosed,
  setComponentCanvasMinimized,
  setFileMenuOpen,
  setNotice,
}: UseProjectFileLifecycleOptions) {
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');

  // Hydrate primary project from IndexedDB
  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((loadedProject) => {
        if (!active || !loadedProject) return;
        const activePage = loadedProject.pages.find((page) => page.id === loadedProject.activePageId)
          ?? loadedProject.pages[0];
        if (!activePage) throw new Error('The saved project does not contain a page.');
        mainCommandClient.replaceProject(
          { ...loadedProject, activePageId: activePage.id },
          'Restore project from IndexedDB',
        );
        void hydrateProjectAssetsToStore(loadedProject);
      })
      .catch((error: unknown) => {
        console.error('Folio could not restore the project from IndexedDB:', error);
        if (active) setNotice('The saved project could not be restored. A new project is available.');
      })
      .finally(() => {
        if (active) setIsProjectLoaded(true);
      });
    return () => { active = false; };
  }, [mainCommandClient]);

  // Multi-tab persistence awareness: warn immediately if another tab commits newer changes
  useEffect(() => {
    return subscribeExternalPersistenceSync((event) => {
      const currentProject = getCanonicalProject();
      if (event.projectId === currentProject.metadata.id) {
        setNotice(
          'Another Folio tab saved newer changes to this project. Reload or export a .flop backup to avoid overwriting newer work.',
        );
      } else if (event.activated) {
        setNotice(
          'Another Folio tab opened a different project. Export a .flop backup before closing if you want to keep this tab.',
        );
      }
    });
  }, [getCanonicalProject, setNotice]);

  // Revision-fenced debounced autosave for primary project with pagehide/visibility flush
  useEffect(() => {
    if (!isProjectLoaded) return;
    setSaveStatus('saving');
    const projectRevision = getCanonicalRevision();
    const canonicalProject = getCanonicalProject();
    let flushed = false;

    const persistNow = () => {
      if (flushed) return;
      flushed = true;
      window.clearTimeout(timer);
      saveProjectIfRevisionCurrent(
        canonicalProject,
        projectRevision,
        getCanonicalRevision,
        subscribeCanonicalStore,
      )
        .then((result) => {
          if (result.status === 'saved') {
            setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'saved', setSaveStatus);
          }
        })
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setRevisionFencedAutosaveStatus(projectRevision, getCanonicalRevision, 'error', setSaveStatus);
          if (isStorageQuotaExceededError(error)) {
            setNotice(
              'Browser storage quota is full. Export a .flop backup now (File -> Export .flop) to avoid losing your changes.',
            );
          }
        });
    };

    const timer = window.setTimeout(persistNow, 450);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistNow();
    };
    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', persistNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [project, isProjectLoaded, getCanonicalRevision, getCanonicalProject, subscribeCanonicalStore, setNotice]);

  const handleProjectFileSelected = async (file: File) => {
    try {
      const loaded = await openProjectFile(file, async (loadedProject) => {
        await saveProjectAndActivate(loadedProject);
        mainCommandClient.replaceProject(loadedProject, 'Open .flop project');
        void hydrateProjectAssetsToStore(loadedProject);
      });
      if (!loaded) return;
      setActiveEditorId('main');
      onResetEditingComponent();
      setComponentCanvasClosed(true);
      setComponentCanvasMinimized(false);
      setNotice('Opened "' + loaded.metadata.name + '".');
    } catch (error) {
      console.error('Folio could not open the selected project file:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to open project: ' + detail);
    }
  };

  const exportCurrentProject = async (isHydrating: boolean) => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const exportSnapshot = createProjectExportSnapshot(
        project,
        getEditingComponentId(),
        componentProject,
      );
      const portableSnapshot = await materializeProjectAssetsForExport(exportSnapshot);
      downloadProject(portableSnapshot);
      setNotice('Project exported successfully as a .flop file.');
    } catch (error) {
      console.error('Folio could not export the current project:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export project: ' + detail);
    }
  };

  // Dynamically import visualExport so PNG/SVG export code stays off the critical startup chunk.
  const exportActiveCanvasSvg = async (isHydrating: boolean) => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const { downloadSvgDocument } = await import('../visualExport');
      const target = resolveActiveExportTarget(
        activeEditorId,
        project,
        componentDocument,
        getEditingComponentId(),
      );
      const exportBreakpoint = activeEditorId === 'main' ? (getActiveBreakpoint?.() ?? 'desktop') : 'desktop';
      downloadSvgDocument(target.document, project.components, target.name, {
        designTokens: project.designTokens,
        breakpoint: exportBreakpoint,
        assets: project.assets,
      });
      setNotice(`Exported "${target.name}" as standalone SVG.`);
    } catch (error) {
      console.error('Folio could not export SVG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export SVG: ' + detail);
    }
  };

  const exportActiveCanvasPng = async (isHydrating: boolean) => {
    setFileMenuOpen(false);
    if (isHydrating) return;
    try {
      const { downloadPngDocument } = await import('../visualExport');
      const target = resolveActiveExportTarget(
        activeEditorId,
        project,
        componentDocument,
        getEditingComponentId(),
      );
      const exportBreakpoint = activeEditorId === 'main' ? (getActiveBreakpoint?.() ?? 'desktop') : 'desktop';
      const result = await downloadPngDocument(target.document, project.components, target.name, 2, {
        designTokens: project.designTokens,
        breakpoint: exportBreakpoint,
        assets: project.assets,
      });
      setNotice(`Exported "${target.name}" as PNG (${result.width}×${result.height}px @2×).`);
    } catch (error) {
      console.error('Folio could not export PNG:', error);
      const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setNotice('Unable to export PNG: ' + detail);
    }
  };

  return {
    isProjectLoaded,
    saveStatus,
    handleProjectFileSelected,
    exportCurrentProject,
    exportActiveCanvasSvg,
    exportActiveCanvasPng,
  };
}

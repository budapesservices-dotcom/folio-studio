import { useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { AnimationClip, BreakpointId, FolioPage, FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { KeyboardShortcutsModalProps } from '../KeyboardShortcutsModal';
import { summarizeProjectForNewProjectDialog, type NewProjectActionMode } from '../newProjectFlow';
import { NewProjectConfirmDialog } from './NewProjectConfirmDialog';

const LazyMotionExportModal = lazy(() =>
  import('./MotionExportModal').then((module) => ({ default: module.MotionExportModal })),
);
const LazyDiagnosticsModal = lazy(() => import('./DiagnosticsModal'));
const LazyProjectLibraryModal = lazy(() =>
  import('./ProjectLibraryModal').then((module) => ({ default: module.ProjectLibraryModal })),
);
const LazyKeyboardShortcutsModal = lazy(async () => {
  const module = await import('../KeyboardShortcutsModal');
  return {
    default: function ShortcutsModalBridge(props: KeyboardShortcutsModalProps & { onReady: () => void }) {
      const { onReady, ...modalProps } = props;
      useEffect(() => {
        onReady();
      }, [onReady]);
      return <module.KeyboardShortcutsModal {...modalProps} />;
    },
  };
});

export interface WorkspaceModalsProps {
  project: FolioProject;
  activePage: FolioPage;
  motionExportProject?: FolioProject;
  motionExportPage?: FolioPage;
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  breakpoint: BreakpointId;
  activeWorkspace: EditorTarget;
  componentDeletionDialogOpen: boolean;
  newProjectDialogOpen: boolean;
  newProjectBusyMode: NewProjectActionMode | null;
  newProjectError: string | null;
  newProjectModalHostRef: { current: HTMLDivElement | null };
  newProjectDialogRef: { current: HTMLElement | null };
  onSaveAndCreateNewProject: () => void;
  onDeleteAndCreateNewProject: () => void;
  onCancelNewProject: () => void;
  motionExportOpen: boolean;
  shortcutsModalOpen: boolean;
  diagnosticsModalOpen: boolean;
  projectLibraryOpen?: boolean;
  historyUndoCount: number;
  historyRedoCount: number;
  shortcutsModalHostRef: { current: HTMLDivElement | null };
  shortcutsDialogRef: { current: HTMLElement | null };
  onNotice: (message: string) => void;
  onCloseMotionExport: () => void;
  onCloseShortcuts: () => void;
  onShortcutsReady: () => void;
  onOpenCodeStudio: () => void;
  onCloseDiagnostics: () => void;
  onLoadStoredProject?: (project: FolioProject) => Promise<void>;
  onOpenProjectFilePicker?: () => void;
  onCloseProjectLibrary?: () => void;
}

export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    project,
    activePage,
    motionExportProject,
    motionExportPage,
    pageClips,
    activeClip,
    breakpoint,
    activeWorkspace,
    componentDeletionDialogOpen,
    newProjectDialogOpen,
    newProjectBusyMode,
    newProjectError,
    newProjectModalHostRef,
    newProjectDialogRef,
    onSaveAndCreateNewProject,
    onDeleteAndCreateNewProject,
    onCancelNewProject,
    motionExportOpen,
    shortcutsModalOpen,
    diagnosticsModalOpen,
    projectLibraryOpen = false,
    historyUndoCount,
    historyRedoCount,
    shortcutsModalHostRef,
    shortcutsDialogRef,
    onNotice,
    onCloseMotionExport,
    onCloseShortcuts,
    onShortcutsReady,
    onOpenCodeStudio,
    onCloseDiagnostics,
    onLoadStoredProject,
    onOpenProjectFilePicker,
    onCloseProjectLibrary,
  } = props;

  return (
    <>
      {newProjectDialogOpen && !componentDeletionDialogOpen && (
        <NewProjectConfirmDialog
          open
          summary={summarizeProjectForNewProjectDialog(project)}
          busyMode={newProjectBusyMode}
          errorMessage={newProjectError}
          hostRef={newProjectModalHostRef}
          dialogRef={newProjectDialogRef}
          onSaveAndCreateNew={onSaveAndCreateNewProject}
          onDeleteAndCreateNew={onDeleteAndCreateNewProject}
          onCancel={onCancelNewProject}
        />
      )}

      {motionExportOpen && !componentDeletionDialogOpen && !newProjectDialogOpen && (
        <Suspense fallback={null}>
          <LazyMotionExportModal
            project={motionExportProject ?? project}
            activePage={motionExportPage ?? activePage}
            pageClips={pageClips}
            activeClip={activeClip}
            breakpoint={breakpoint}
            onNotice={onNotice}
            onClose={onCloseMotionExport}
          />
        </Suspense>
      )}

      {shortcutsModalOpen && !componentDeletionDialogOpen && !newProjectDialogOpen && (
        <Suspense fallback={null}>
          <LazyKeyboardShortcutsModal
            open
            activeWorkspace={activeWorkspace}
            onClose={onCloseShortcuts}
            hostRef={shortcutsModalHostRef}
            dialogRef={shortcutsDialogRef}
            onReady={onShortcutsReady}
          />
        </Suspense>
      )}

      {diagnosticsModalOpen && !componentDeletionDialogOpen && !newProjectDialogOpen && (
        <Suspense fallback={null}>
          <LazyDiagnosticsModal
            open
            project={project}
            activePageId={activePage.id}
            historyUndoCount={historyUndoCount}
            historyRedoCount={historyRedoCount}
            onOpenCodeStudio={onOpenCodeStudio}
            onClose={onCloseDiagnostics}
          />
        </Suspense>
      )}

      {projectLibraryOpen && !componentDeletionDialogOpen && !newProjectDialogOpen && onLoadStoredProject && onCloseProjectLibrary && (
        <Suspense fallback={null}>
          <LazyProjectLibraryModal
            open
            project={project}
            onLoadProject={onLoadStoredProject}
            onOpenFilePicker={onOpenProjectFilePicker ?? (() => undefined)}
            onNotice={onNotice}
            onClose={onCloseProjectLibrary}
          />
        </Suspense>
      )}
    </>
  );
}

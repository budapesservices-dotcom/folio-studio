import { useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { AnimationClip, BreakpointId, FolioPage, FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { KeyboardShortcutsModalProps } from '../KeyboardShortcutsModal';

const LazyMotionExportModal = lazy(() => import('./MotionExportModal').then((m) => ({ default: m.MotionExportModal })));
const LazyDiagnosticsModal = lazy(() => import('./DiagnosticsModal'));
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
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  breakpoint: BreakpointId;
  activeWorkspace: EditorTarget;
  componentDeletionDialogOpen: boolean;
  motionExportOpen: boolean;
  shortcutsModalOpen: boolean;
  diagnosticsModalOpen: boolean;
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
}

export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    project,
    activePage,
    pageClips,
    activeClip,
    breakpoint,
    activeWorkspace,
    componentDeletionDialogOpen,
    motionExportOpen,
    shortcutsModalOpen,
    diagnosticsModalOpen,
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
  } = props;

  return (
    <>
      {motionExportOpen && (
        <Suspense fallback={null}>
          <LazyMotionExportModal
            project={project}
            activePage={activePage}
            pageClips={pageClips}
            activeClip={activeClip}
            breakpoint={breakpoint}
            onNotice={onNotice}
            onClose={onCloseMotionExport}
          />
        </Suspense>
      )}

      {shortcutsModalOpen && !componentDeletionDialogOpen && (
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

      {diagnosticsModalOpen && !componentDeletionDialogOpen && (
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
    </>
  );
}

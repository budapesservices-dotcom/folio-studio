import { useCallback, useRef, useState } from 'preact/hooks';
import type { NewProjectActionMode } from '../newProjectFlow';

export interface UseWorkspaceDialogsOptions {
  isHydrating: boolean;
  onDismissPopovers: () => void;
  onCreateNewProject: (
    mode: NewProjectActionMode,
    isHydrating: boolean,
    onBeforeReset: () => void,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onAfterNewProjectReset: () => void;
}

export function useWorkspaceDialogs(options: UseWorkspaceDialogsOptions) {
  const { isHydrating, onDismissPopovers, onCreateNewProject, onAfterNewProjectReset } = options;

  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [diagnosticsModalOpen, setDiagnosticsModalOpen] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectBusyMode, setNewProjectBusyMode] = useState<NewProjectActionMode | null>(null);
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const [shortcutsMountTick, setShortcutsMountTick] = useState(0);

  const shortcutsModalHostRef = useRef<HTMLDivElement | null>(null);
  const shortcutsDialogRef = useRef<HTMLElement | null>(null);
  const shortcutsFocusReturnRef = useRef<HTMLElement | null>(null);
  const newProjectModalHostRef = useRef<HTMLDivElement | null>(null);
  const newProjectDialogRef = useRef<HTMLElement | null>(null);
  const newProjectFocusReturnRef = useRef<HTMLElement | null>(null);

  const openShortcutsModal = useCallback(() => {
    shortcutsFocusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onDismissPopovers();
    setShortcutsModalOpen(true);
  }, [onDismissPopovers]);

  const closeShortcutsModal = useCallback(() => {
    setShortcutsModalOpen(false);
  }, []);

  const handleShortcutsModalReady = useCallback(() => {
    setShortcutsMountTick((tick) => tick + 1);
  }, []);

  const openNewProjectDialog = useCallback(() => {
    if (isHydrating) return;
    newProjectFocusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onDismissPopovers();
    setNewProjectError(null);
    setNewProjectBusyMode(null);
    setNewProjectDialogOpen(true);
  }, [isHydrating, onDismissPopovers]);

  const closeNewProjectDialog = useCallback(() => {
    if (newProjectBusyMode !== null) return;
    setNewProjectError(null);
    setNewProjectDialogOpen(false);
  }, [newProjectBusyMode]);

  const confirmNewProject = useCallback(async (mode: NewProjectActionMode) => {
    if (newProjectBusyMode !== null) return;
    setNewProjectError(null);
    setNewProjectBusyMode(mode);
    try {
      const outcome = await onCreateNewProject(mode, isHydrating, onAfterNewProjectReset);
      if (outcome.ok) {
        setNewProjectDialogOpen(false);
      } else {
        setNewProjectError(outcome.error);
      }
    } finally {
      setNewProjectBusyMode(null);
    }
  }, [isHydrating, newProjectBusyMode, onAfterNewProjectReset, onCreateNewProject]);

  return {
    shortcutsModalOpen,
    diagnosticsModalOpen,
    setDiagnosticsModalOpen,
    newProjectDialogOpen,
    newProjectBusyMode,
    newProjectError,
    shortcutsMountTick,
    shortcutsModalHostRef,
    shortcutsDialogRef,
    shortcutsFocusReturnRef,
    newProjectModalHostRef,
    newProjectDialogRef,
    newProjectFocusReturnRef,
    openShortcutsModal,
    closeShortcutsModal,
    handleShortcutsModalReady,
    openNewProjectDialog,
    closeNewProjectDialog,
    confirmNewProject,
  };
}

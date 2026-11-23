import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { createEmptyDocument } from '../../core/document/factory';
import { buildComponentDefinitionFromNodes } from '../../core/document/components';
import { getActiveDocument } from '../../core/document/project';
import type { ComponentDefinition, DesignNode, FolioDocument, FolioProject } from '../../core/document/types';
import { loadProjectById, saveProject, withProjectWriteLock } from '../../core/persistence/indexedDb';
import { createDebouncedAutosave } from '../debouncedAutosave';
import { activateModalDialog, trapModalDialogKeydown } from '../modalFocus';
import type { CanonicalEditorStore } from '../editorStore';
import type { EditorState } from '../editorReducer';
import type { MainCanvasCommandClient, WorkspaceCommandClient } from '../mainCanvasCommandClient';
import type { EditorTarget } from '../editorContext';
import type { WindowId } from '../windowManager';
import {
  advanceComponentCanvasSyncSession,
  createComponentCanvasBufferProject,
  createComponentCanvasSyncAction,
  createComponentCanvasSyncSession,
  markComponentCanvasMasterMissing,
  reconcileComponentCanvasSyncSession,
  shouldProtectComponentCanvasBuffer,
  type ComponentCanvasSyncSession,
} from '../componentCanvasSync';
import {
  deleteComponentAfterDurableRecovery,
  deleteComponentDurably,
  recoverAndDeleteComponentDurably,
  requestComponentDeletion,
} from '../componentDeletion';

export type ComponentRecoveryStatus = 'none' | 'missing' | 'returned' | 'conflict' | 'switch-pending';
export type ComponentDeletionMode = 'recovery' | 'clean' | 'cleanup';

export interface UseComponentMasterLifecycleOptions {
  canonicalStore: CanonicalEditorStore;
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient: WorkspaceCommandClient;
  state: EditorState;
  componentState: EditorState;
  componentInitialProject: FolioProject;
  isProjectLoaded: boolean;
  appShellRef: RefObject<HTMLDivElement>;
  focusWindow: (id: WindowId) => void;
  setActiveEditorId: (target: EditorTarget) => void;
  setComponentCanvasClosed: (closed: boolean) => void;
  setComponentCanvasMinimized: (minimized: boolean) => void;
  setInspectorVisible: (visible: boolean) => void;
  setComponentRackOpen: (open: boolean) => void;
  closePagesRack: () => void;
  closeComponentRack: () => void;
  setNotice: (message: string) => void;
}

export function useComponentMasterLifecycle({
  canonicalStore,
  mainCommandClient,
  componentCommandClient,
  state,
  componentState,
  componentInitialProject,
  isProjectLoaded,
  appShellRef,
  focusWindow,
  setActiveEditorId,
  setComponentCanvasClosed,
  setComponentCanvasMinimized,
  setInspectorVisible,
  setComponentRackOpen,
  closePagesRack,
  closeComponentRack,
  setNotice,
}: UseComponentMasterLifecycleOptions) {
  const [componentReady, setComponentReady] = useState(false);
  const componentSyncSessionRef = useRef<ComponentCanvasSyncSession | null>(null);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [renamingComponentId, setRenamingComponentId] = useState<string | null>(null);
  const [componentNameDraft, setComponentNameDraft] = useState('');
  const [componentRecoveryStatus, setComponentRecoveryStatus] = useState<ComponentRecoveryStatus>('none');
  const [pendingComponentOpenId, setPendingComponentOpenId] = useState<string | null>(null);
  const [pendingComponentDeletion, setPendingComponentDeletion] = useState<ComponentDefinition | null>(null);
  const [componentDeletionDialogOpen, setComponentDeletionDialogOpen] = useState(false);
  const [componentDeletionMode, setComponentDeletionMode] = useState<ComponentDeletionMode>('recovery');
  const [componentDeletionBusy, setComponentDeletionBusy] = useState(false);
  const [componentCleanupPending, setComponentCleanupPending] = useState(false);
  const [durableRecoveryComponentId, setDurableRecoveryComponentId] = useState<string | null>(null);
  const pendingComponentDeletionRef = useRef(false);
  const componentSyncPauseAfterCancelRef = useRef<FolioDocument | null>(null);
  const deletionModalHostRef = useRef<HTMLDivElement | null>(null);
  const deletionDialogRef = useRef<HTMLElement | null>(null);
  const deletionFocusReturnRef = useRef<HTMLElement | null>(null);
  const [componentSaveStatus, setComponentSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [componentSaveError, setComponentSaveError] = useState<string | null>(null);

  const componentAutosave = useMemo(() => createDebouncedAutosave<FolioProject>(
    (project) => saveProject(project),
    (status, error) => {
      setComponentSaveStatus(status);
      setComponentSaveError(status === 'error'
        ? (error instanceof Error ? error.message : 'The Component Canvas buffer could not be saved.')
        : null);
    },
    450,
  ), []);

  const isHydrating = !isProjectLoaded || !componentReady;
  const ownedComponents = state.project.components;
  const editingComponent = ownedComponents.find((component) => component.id === editingComponentId) ?? null;
  const activeDocument = getActiveDocument(state.project);
  const componentDocument = getActiveDocument(componentState.project);
  const selectedComponentNodes = componentDocument.nodes.filter(
    (node) => componentState.selectedNodeIds.includes(node.id),
  );

  // Hydrate Component Canvas buffer from IndexedDB
  useEffect(() => {
    let active = true;
    loadProjectById('folio-component-canvas')
      .then((project) => {
        if (active && project) {
          componentCommandClient.replaceProject(project, 'Restore Component Canvas buffer');
        }
      })
      .catch((error: unknown) => {
        console.warn('Folio could not read Component Canvas autosave:', error);
      })
      .finally(() => {
        if (active) setComponentReady(true);
      });
    return () => { active = false; };
  }, [componentCommandClient]);

  // Schedule debounced Component Canvas buffer autosave
  useEffect(() => {
    if (!componentReady) return;
    componentAutosave.schedule(componentState.project);
    return () => componentAutosave.cancel();
  }, [componentState.project, componentReady, componentAutosave]);

  const saveNodesAsComponent = (
    nodes: DesignNode[],
    sourceNodes: readonly DesignNode[] = activeDocument.nodes,
  ) => {
    if (isHydrating || nodes.length === 0) return;
    const component = buildComponentDefinitionFromNodes(
      sourceNodes,
      nodes.map((node) => node.id),
      `Component ${ownedComponents.length + 1}`,
    );
    if (!component) return;
    mainCommandClient.createComponent(component, 'Save selection as component');
    closePagesRack();
    setComponentRackOpen(true);
    setNotice(`“${component.name}” saved to this project’s Component Rack.`);
  };

  const saveComponentCanvasMaster = () => {
    if (isHydrating || pendingComponentDeletionRef.current) return;
    const bufferDocument = getActiveDocument(componentState.project);

    if (editingComponent) {
      const session = componentSyncSessionRef.current;
      if (componentRecoveryStatus !== 'none' || !session || session.conflicted || session.masterStatus !== 'present') {
        setNotice('Resolve the active Component Canvas recovery state before updating this master.');
        return;
      }
      const syncAction = createComponentCanvasSyncAction(editingComponent, bufferDocument, session);
      if (!syncAction) {
        void componentAutosave.flush(componentState.project);
        setNotice(`“${editingComponent.name}” master is up to date.`);
        return;
      }
      const syncResult = mainCommandClient.syncComponentDocument(
        {
          componentId: syncAction.componentId,
          document: syncAction.document,
          updatedAt: syncAction.updatedAt,
          expectedUpdatedAt: syncAction.expectedUpdatedAt,
          expectedMasterDocument: syncAction.expectedMasterDocument,
        },
        'Update component master',
      );
      if (syncResult.status === 'applied' || syncResult.status === 'no-op') {
        const committedMaster = canonicalStore.getSnapshot().editorState.project.components
          .find((component) => component.id === editingComponent.id);
        if (committedMaster) {
          componentSyncSessionRef.current = advanceComponentCanvasSyncSession(session, committedMaster);
        }
        void componentAutosave.flush(componentState.project);
        setNotice(`Updated master “${editingComponent.name}”.`);
      } else {
        componentSyncSessionRef.current = { ...session, conflicted: true };
        setComponentRecoveryStatus('conflict');
        setNotice('The master changed before this update could be applied. Review the latest master before saving.');
      }
      return;
    }

    const sourceIds = selectedComponentNodes.length > 0
      ? selectedComponentNodes.map((node) => node.id)
      : bufferDocument.nodes.map((node) => node.id);
    const component = buildComponentDefinitionFromNodes(
      bufferDocument.nodes,
      sourceIds,
      `Component ${ownedComponents.length + 1}`,
    );
    if (!component) return;
    mainCommandClient.createComponent(component, 'Create master component');
    const committedMaster = canonicalStore.getSnapshot().editorState.project.components
      .find((item) => item.id === component.id) ?? component;
    componentSyncSessionRef.current = createComponentCanvasSyncSession(committedMaster);
    setEditingComponentId(committedMaster.id);
    setComponentRecoveryStatus('none');
    closePagesRack();
    setComponentRackOpen(true);
    setNotice(`Created master “${component.name}” in Component Rack.`);
  };

  const loadMasterComponent = (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current) {
      setNotice('Resolve the active component deletion recovery decision before replacing the Component Canvas buffer.');
      return;
    }
    componentSyncPauseAfterCancelRef.current = null;
    componentSyncSessionRef.current = createComponentCanvasSyncSession(component);
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    componentCommandClient.replaceProject(
      createComponentCanvasBufferProject(component),
      'Load master component into Component Canvas',
    );
    setEditingComponentId(component.id);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
    closeComponentRack();
    setNotice(`Editing master: ${component.name}.`);
  };

  const openMasterComponent = (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current) {
      setNotice('Resolve the active component deletion recovery decision before opening another master.');
      return;
    }
    const session = componentSyncSessionRef.current;
    const bufferDocument = getActiveDocument(componentState.project);
    const hasActiveBuffer = editingComponentId !== null;
    const mustProtectBuffer = hasActiveBuffer && (
      !session || shouldProtectComponentCanvasBuffer(session, bufferDocument)
    );
    if (mustProtectBuffer) {
      setPendingComponentOpenId(component.id);
      setComponentCanvasClosed(false);
      setComponentCanvasMinimized(false);
      setActiveEditorId('component');
      focusWindow('component-canvas');
      setComponentRecoveryStatus('switch-pending');
      setNotice(
        'The current Component Canvas has local edits or a recovery conflict. Keep editing, or explicitly discard its buffer before opening another master.',
      );
      return;
    }
    loadMasterComponent(component);
  };

  const keepCurrentComponentBuffer = () => {
    setPendingComponentOpenId(null);
    const session = componentSyncSessionRef.current;
    if (!session) {
      setComponentRecoveryStatus('none');
    } else if (session.masterStatus === 'missing') {
      setComponentRecoveryStatus('missing');
    } else if (session.masterStatus === 'returned') {
      setComponentRecoveryStatus('returned');
    } else if (session.conflicted) {
      setComponentRecoveryStatus('conflict');
    } else {
      setComponentRecoveryStatus('none');
    }
  };

  const discardBufferAndOpenPendingMaster = () => {
    const pending = pendingComponentOpenId
      ? state.project.components.find((item) => item.id === pendingComponentOpenId)
      : undefined;
    if (!pending) {
      setPendingComponentOpenId(null);
      setNotice('The requested master is no longer available. The current Component Canvas buffer was kept.');
      return;
    }
    loadMasterComponent(pending);
  };

  const createNewMasterComponent = () => {
    if (isHydrating) return;
    const now = new Date().toISOString();
    const name = `Component ${ownedComponents.length + 1}`;
    const component: ComponentDefinition = {
      id: globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`,
      name,
      document: { ...createEmptyDocument(name, 420, 280), background: '#00000000' },
      createdAt: now,
      updatedAt: now,
    };
    mainCommandClient.createComponent(component, 'Create new master component');
    const committedMaster = canonicalStore.getSnapshot().editorState.project.components
      .find((item) => item.id === component.id) ?? component;
    openMasterComponent(committedMaster);
  };

  const renameComponent = (componentId: string) => {
    const name = componentNameDraft.trim();
    if (!name) return;
    const current = state.project.components.find((item) => item.id === componentId);
    if (!current) {
      setNotice('This component is no longer available in the current project.');
      return;
    }
    const renameResult = mainCommandClient.renameComponent(
      {
        componentId,
        expectedMasterDocument: current.document,
        expectedUpdatedAt: current.updatedAt,
        name,
      },
      'Rename component',
    );
    if (renameResult.status === 'rejected') {
      setNotice('The component changed before the rename could be applied. Review the latest master and retry.');
      return;
    }
    setRenamingComponentId(null);
    setNotice(`Component renamed to “${name}”.`);
  };

  const duplicateComponent = (component: ComponentDefinition) => {
    const now = new Date().toISOString();
    const copy: ComponentDefinition = {
      ...component,
      id: globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`,
      name: `${component.name} copy`,
      document: {
        ...component.document,
        id: globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}`,
        name: `${component.name} copy`,
        nodes: component.document.nodes.map((node) => ({ ...node })),
      },
      createdAt: now,
      updatedAt: now,
    };
    mainCommandClient.createComponent(copy, 'Duplicate component');
    setNotice(`“${component.name}” duplicated.`);
  };

  const componentDeletionTarget = (component: ComponentDefinition) => ({
    componentId: component.id,
    expectedMasterDocument: component.document,
    expectedUpdatedAt: component.updatedAt,
  });

  const clearPendingComponentDeletion = () => {
    pendingComponentDeletionRef.current = false;
    setPendingComponentDeletion(null);
    setComponentDeletionDialogOpen(false);
    setComponentDeletionBusy(false);
    setComponentCleanupPending(false);
    setDurableRecoveryComponentId(null);
  };

  const keepComponentAfterStaleDeletion = (message: string) => {
    clearPendingComponentDeletion();
    const session = componentSyncSessionRef.current;
    if (session) componentSyncSessionRef.current = { ...session, conflicted: true };
    setComponentRecoveryStatus('conflict');
    setNotice(message);
  };

  const finishDeletedActiveComponent = (component: ComponentDefinition) => {
    if (editingComponentId !== component.id) return;
    setEditingComponentId(null);
    componentSyncSessionRef.current = null;
    componentSyncPauseAfterCancelRef.current = null;
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    componentCommandClient.replaceProject(
      componentInitialProject,
      'Reset Component Canvas buffer',
    );
    setComponentCanvasClosed(true);
    setComponentCanvasMinimized(false);
    setActiveEditorId('main');
  };

  const openComponentDeletionDialog = (component: ComponentDefinition, mode: 'recovery' | 'clean' = 'recovery') => {
    pendingComponentDeletionRef.current = true;
    setPendingComponentDeletion(component);
    setComponentDeletionMode(mode);
    setComponentDeletionDialogOpen(true);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
  };

  const showComponentCleanupPending = (component: ComponentDefinition) => {
    pendingComponentDeletionRef.current = true;
    setPendingComponentDeletion(component);
    setComponentCleanupPending(true);
    setComponentDeletionMode('cleanup');
    setComponentDeletionDialogOpen(true);
    setComponentCanvasClosed(false);
    setComponentCanvasMinimized(false);
    setActiveEditorId('component');
    focusWindow('component-canvas');
    setInspectorVisible(true);
  };

  const completeDurableComponentDeletion = (component: ComponentDefinition, message: string) => {
    clearPendingComponentDeletion();
    finishDeletedActiveComponent(component);
    setNotice(message);
  };

  const deleteComponent = async (component: ComponentDefinition) => {
    if (pendingComponentDeletionRef.current || componentCleanupPending) return;
    const isActiveMaster = editingComponentId === component.id;
    const trigger = document.activeElement;
    deletionFocusReturnRef.current = trigger instanceof HTMLElement ? trigger : null;
    const protection = {
      activeMaster: isActiveMaster,
      bufferDocument: isActiveMaster ? getActiveDocument(componentState.project) : null,
      session: isActiveMaster ? componentSyncSessionRef.current : null,
      recoveryPending: isActiveMaster && (
        componentRecoveryStatus !== 'none' || pendingComponentOpenId !== null
      ),
    };
    const result = requestComponentDeletion(
      canonicalStore, componentDeletionTarget(component), protection, isActiveMaster,
    );

    if (result.status === 'recovery-required') {
      openComponentDeletionDialog(component);
      return;
    }
    if (result.status === 'stale-master') {
      if (isActiveMaster) {
        const session = componentSyncSessionRef.current;
        if (session) componentSyncSessionRef.current = { ...session, conflicted: true };
        setComponentRecoveryStatus('conflict');
      }
      setNotice('The master changed before deletion could be applied. Review the latest master and retry; the Component Canvas buffer was kept.');
      return;
    }

    if (result.status === 'ready' && isActiveMaster) {
      openComponentDeletionDialog(component, 'clean');
      setComponentDeletionBusy(true);
      const bufferSaved = await componentAutosave.flush(componentState.project);
      if (!bufferSaved) {
        setComponentDeletionBusy(false);
        clearPendingComponentDeletion();
        setNotice('Component Canvas buffer could not be saved durably. The master and buffer are unchanged; retry the buffer save before deleting.');
        return;
      }
      const deletion = await deleteComponentDurably(
        canonicalStore, componentDeletionTarget(component), componentInitialProject, withProjectWriteLock,
      );
      setComponentDeletionBusy(false);
      if (deletion.status === 'deleted') {
        completeDurableComponentDeletion(component, `“${component.name}” deleted; linked instances were detached and Component Canvas cleanup is durable.`);
      } else if (deletion.status === 'cleanup-persist-failed') {
        showComponentCleanupPending(component);
        componentAutosave.schedule(componentState.project);
        setNotice('The master deletion is durable, but Component Canvas cleanup failed. Your local buffer is preserved; retry cleanup before discarding it.');
      } else {
        clearPendingComponentDeletion();
        componentAutosave.schedule(componentState.project);
        setNotice('The master deletion could not be made durable. The canonical master and Component Canvas buffer were preserved; retry is safe.');
      }
      return;
    }

    if (result.status !== 'deleted') {
      setNotice('The master could not be deleted. The Component Canvas buffer was kept; review the latest master and retry.');
      return;
    }
    setNotice(`“${component.name}” deleted; any linked instances were detached.`);
  };

  const cancelComponentDeletion = () => {
    if (!pendingComponentDeletion || componentDeletionBusy) return;
    if (componentCleanupPending) {
      setNotice('The master deletion is already durable. Keep this recovery dialog open and retry the buffer cleanup; the protected buffer has not been discarded.');
      return;
    }
    componentSyncPauseAfterCancelRef.current = getActiveDocument(componentState.project);
    clearPendingComponentDeletion();
    setNotice('Deletion cancelled. The master, local Component Canvas buffer, and recovery session were kept.');
  };

  const saveBufferAsNewAndDelete = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || componentCleanupPending) return;
    setComponentDeletionBusy(true);
    const bufferSaved = await componentAutosave.flush(componentState.project);
    if (!bufferSaved) {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas buffer could not be saved durably. No recovery or deletion commit was attempted; retry the buffer save.');
      return;
    }
    const target = componentDeletionTarget(pending);
    const bufferDocument = getActiveDocument(componentState.project);
    const protection = {
      activeMaster: editingComponentId === pending.id,
      bufferDocument,
      session: componentSyncSessionRef.current,
      recoveryPending: true,
    };
    const result = durableRecoveryComponentId
      ? await deleteComponentAfterDurableRecovery(
          canonicalStore, target, durableRecoveryComponentId, componentInitialProject, withProjectWriteLock,
        )
      : await recoverAndDeleteComponentDurably(
          canonicalStore, target, protection, bufferDocument, componentInitialProject, withProjectWriteLock,
        );
    setComponentDeletionBusy(false);

    if (result.status === 'deleted') {
      const savedName = result.recoveryComponent?.name ?? 'Recovered component';
      completeDurableComponentDeletion(pending, `“${savedName}” was saved durably and “${pending.name}” was deleted. Component Canvas cleanup is durable.`);
    } else if (result.status === 'stale-master') {
      const message = result.recoveryComponent
        ? `“${result.recoveryComponent.name}” is durably saved; the original master changed, so it and the local buffer were kept.`
        : 'The master changed before recovery could be applied. The master and local buffer were kept.';
      keepComponentAfterStaleDeletion(message);
      componentAutosave.schedule(componentState.project);
    } else if (result.status === 'recovery-persist-failed') {
      componentAutosave.schedule(componentState.project);
      setNotice('Recovery-copy persistence failed. No deletion was attempted; the master and local buffer remain. Retry is safe.');
    } else if (result.status === 'deletion-persist-failed') {
      if (result.recoveryComponent) setDurableRecoveryComponentId(result.recoveryComponent.id);
      componentAutosave.schedule(componentState.project);
      setNotice('The recovery copy is durable, but deletion persistence failed. The master and buffer remain in memory; retry deletion without creating another recovery copy.');
    } else if (result.status === 'cleanup-persist-failed') {
      showComponentCleanupPending(pending);
      if (result.recoveryComponent) setDurableRecoveryComponentId(result.recoveryComponent.id);
      componentAutosave.schedule(componentState.project);
      setNotice('The recovered component and master deletion are durable, but buffer cleanup failed. The local buffer remains preserved; retry cleanup.');
    } else {
      componentAutosave.schedule(componentState.project);
      setNotice('The durable recovery operation failed. The local buffer remains protected; retry or cancel safely.');
    }
  };

  const discardBufferAndDelete = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || componentCleanupPending) return;
    setComponentDeletionBusy(true);
    const bufferSaved = await componentAutosave.flush(componentState.project);
    if (!bufferSaved) {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas buffer could not be saved durably. No deletion was attempted; retry the buffer save.');
      return;
    }
    const deletion = await deleteComponentDurably(
      canonicalStore, componentDeletionTarget(pending), componentInitialProject, withProjectWriteLock,
    );
    setComponentDeletionBusy(false);
    if (deletion.status === 'deleted') {
      completeDurableComponentDeletion(pending, `“${pending.name}” was deleted durably after discarding the protected local buffer; linked instances were detached.`);
    } else if (deletion.status === 'cleanup-persist-failed') {
      showComponentCleanupPending(pending);
      setNotice('The master deletion is durable, but buffer cleanup failed. The local buffer remains preserved; retry cleanup.');
    } else if (deletion.status === 'stale-master') {
      keepComponentAfterStaleDeletion('The master changed while the recovery choice was open. Deletion was cancelled; the local buffer was kept. Review the latest master.');
    } else {
      componentAutosave.schedule(componentState.project);
      setNotice('The master deletion could not be made durable. The original master and local buffer remain; retry or cancel safely.');
    }
  };

  const retryComponentBufferCleanup = async () => {
    const pending = pendingComponentDeletion;
    if (!pending || componentDeletionBusy || !componentCleanupPending) return;
    setComponentDeletionBusy(true);
    await componentAutosave.cancelAndWait();
    try {
      await withProjectWriteLock((persist) => persist(componentInitialProject));
      setComponentDeletionBusy(false);
      completeDurableComponentDeletion(pending, 'Component Canvas cleanup is now durable. The recovered component and master deletion remain saved.');
    } catch {
      setComponentDeletionBusy(false);
      setNotice('Component Canvas cleanup is still failing. The local buffer remains intact; retry is safe.');
    }
  };

  const retryComponentCanvasSave = () => {
    void componentAutosave.flush(componentState.project);
  };

  const reloadRecoveredComponentMaster = () => {
    if (!editingComponentId || pendingComponentDeletionRef.current) return;
    componentSyncPauseAfterCancelRef.current = null;
    const master = state.project.components.find((component) => component.id === editingComponentId);
    if (!master) {
      setComponentRecoveryStatus('missing');
      setNotice('The canonical master is still missing. The local Component Canvas buffer remains preserved.');
      return;
    }
    componentSyncSessionRef.current = createComponentCanvasSyncSession(master);
    componentCommandClient.replaceProject(
      createComponentCanvasBufferProject(master),
      'Reload recovered canonical component master',
    );
    setPendingComponentOpenId(null);
    setComponentRecoveryStatus('none');
    setNotice('The latest canonical master was reloaded. The previous local Component Canvas edits were discarded by explicit request.');
  };

  // Continuous reconciliation between Component Canvas buffer and canonical master
  useEffect(() => {
    if (!componentReady || !editingComponentId || pendingComponentDeletionRef.current) return;
    const editedDocument = getActiveDocument(componentState.project);
    const pausedAfterCancel = componentSyncPauseAfterCancelRef.current;
    if (pausedAfterCancel) {
      if (pausedAfterCancel === editedDocument) return;
      componentSyncPauseAfterCancelRef.current = null;
    }
    const master = state.project.components.find((component) => component.id === editingComponentId);
    if (!master) {
      const session = componentSyncSessionRef.current;
      if (session && session.masterStatus !== 'missing') {
        componentSyncSessionRef.current = markComponentCanvasMasterMissing(session);
        setComponentRecoveryStatus('missing');
        setNotice('The master is temporarily missing from Main Canvas history. The Component Canvas buffer and local edits are preserved; synchronization is paused.');
      }
      return;
    }

    let session = componentSyncSessionRef.current;
    if (!session || session.componentId !== master.id) {
      session = createComponentCanvasSyncSession(master);
      componentSyncSessionRef.current = session;
      componentCommandClient.replaceProject(
        createComponentCanvasBufferProject(master),
        'Initialize Component Canvas buffer',
      );
      return;
    }

    const reconciliation = reconcileComponentCanvasSyncSession(session, master, editedDocument);
    if (reconciliation.status === 'orphaned-master-returned') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('returned');
      setNotice('The master has returned, but the previous Component Canvas buffer remains untouched. Reloading it would discard local edits; use the explicit recovery action only when ready.');
      return;
    }
    if (reconciliation.status === 'orphaned') {
      componentSyncSessionRef.current = reconciliation.session;
      return;
    }
    if (reconciliation.status === 'reload-buffer') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('none');
      componentCommandClient.replaceProject(
        createComponentCanvasBufferProject(master),
        'Reload Component Canvas buffer from canonical master',
      );
      return;
    }
    if (reconciliation.status === 'conflict') {
      componentSyncSessionRef.current = reconciliation.session;
      setComponentRecoveryStatus('conflict');
      if (!session.conflicted) {
        setNotice(
          'The master changed in Main Canvas while this buffer had unsynchronized edits. ' +
          'Local edits were kept and synchronization is paused. Reopen the master to discard this buffer and load the canonical version.',
        );
      }
      return;
    }
    if (reconciliation.status === 'master-mismatch') return;

    componentSyncSessionRef.current = reconciliation.session;
    const syncAction = createComponentCanvasSyncAction(master, editedDocument, session);
    if (!syncAction) return;

    const syncResult = mainCommandClient.syncComponentDocument(
      {
        componentId: syncAction.componentId,
        document: syncAction.document,
        updatedAt: syncAction.updatedAt,
        expectedUpdatedAt: syncAction.expectedUpdatedAt,
        expectedMasterDocument: syncAction.expectedMasterDocument,
      },
      'Sync Component Canvas to master',
    );
    if (syncResult.status === 'applied' || syncResult.status === 'no-op') {
      const committedMaster = canonicalStore.getSnapshot().editorState.project.components
        .find((component) => component.id === master.id);
      if (committedMaster) {
        componentSyncSessionRef.current = advanceComponentCanvasSyncSession(session, committedMaster);
      }
    } else {
      componentSyncSessionRef.current = { ...session, conflicted: true };
      setComponentRecoveryStatus('conflict');
      setNotice(
        'The component master changed before this edit could synchronize. ' +
        'Local edits were kept and synchronization is paused; reopen the master to reload the canonical version.',
      );
    }
  }, [
    componentState.project.pages,
    editingComponentId,
    componentReady,
    state.project.components,
    pendingComponentDeletion,
    canonicalStore,
    mainCommandClient,
    componentCommandClient,
    setNotice,
  ]);

  // Modal focus trap for component deletion / recovery dialog
  useEffect(() => {
    if (!componentDeletionDialogOpen) return;
    const shell = appShellRef.current;
    const host = deletionModalHostRef.current;
    const dialog = deletionDialogRef.current;
    if (!shell || !host || !dialog) return;
    const restoreFocus = activateModalDialog(shell, host, dialog, deletionFocusReturnRef.current);
    const onKeyDown = (event: KeyboardEvent) => trapModalDialogKeydown(dialog, event, cancelComponentDeletion);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus();
    };
  }, [componentDeletionDialogOpen, pendingComponentDeletion, componentCleanupPending, componentDeletionMode, appShellRef]);

  return {
    componentReady,
    editingComponentId,
    setEditingComponentId,
    editingComponent,
    renamingComponentId,
    setRenamingComponentId,
    componentNameDraft,
    setComponentNameDraft,
    componentRecoveryStatus,
    pendingComponentOpenId,
    pendingComponentDeletion,
    componentDeletionDialogOpen,
    setComponentDeletionDialogOpen,
    componentDeletionMode,
    componentDeletionBusy,
    componentCleanupPending,
    durableRecoveryComponentId,
    deletionModalHostRef,
    deletionDialogRef,
    componentSaveStatus,
    componentSaveError,
    selectedComponentNodes,
    saveNodesAsComponent,
    saveComponentCanvasMaster,
    openMasterComponent,
    keepCurrentComponentBuffer,
    discardBufferAndOpenPendingMaster,
    createNewMasterComponent,
    renameComponent,
    duplicateComponent,
    deleteComponent,
    cancelComponentDeletion,
    saveBufferAsNewAndDelete,
    discardBufferAndDelete,
    retryComponentBufferCleanup,
    retryComponentCanvasSave,
    reloadRecoveredComponentMaster,
  };
}

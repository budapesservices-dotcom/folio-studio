import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createInitialProject } from '../core/document/factory';
import { getActivePage } from '../core/document/project';
import { createEditorState } from './editorReducer';
import { createCanonicalEditorStore } from './editorStore';
import { createComponentCanvasCommandClient, createMainCanvasCommandClient } from './mainCanvasCommandClient';
import type { EditorTarget } from './editorContext';
import { createInteractiveStarterProject } from './workspace/starterProject';

export interface UseWorkspaceStoresOptions {
  onRejectedNotice: (message: string) => void;
}

export function useWorkspaceStores({ onRejectedNotice }: UseWorkspaceStoresOptions) {
  const commandRejectNoticeRef = useRef<(message: string) => void>(onRejectedNotice);
  commandRejectNoticeRef.current = onRejectedNotice;

  const initialEditorState = useMemo(() => createEditorState(createInteractiveStarterProject('First canvas')), []);
  const canonicalStore = useMemo(() => createCanonicalEditorStore(initialEditorState), []);
  const [state, setState] = useState(() => canonicalStore.getSnapshot().editorState);
  const syncStateFromStore = useCallback(() => {
    const next = canonicalStore.getSnapshot().editorState;
    setState((current) => (current === next ? current : next));
  }, [canonicalStore]);
  useEffect(() => canonicalStore.subscribe(syncStateFromStore), [canonicalStore, syncStateFromStore]);
  const mainCommandClient = useMemo(
    () =>
      createMainCanvasCommandClient(canonicalStore, {
        onRejected: (result) => commandRejectNoticeRef.current(result.message),
      }),
    [canonicalStore],
  );

  const componentInitialState = useMemo(() => {
    const project = createInitialProject('Component Canvas');
    project.metadata.id = 'folio-component-canvas';
    const page = getActivePage(project);
    page.name = 'Component Canvas';
    page.document.name = 'Component Canvas';
    page.document.width = 420;
    page.document.height = 280;
    page.document.nodes = [];
    return createEditorState(project);
  }, []);
  const componentStore = useMemo(
    () => createCanonicalEditorStore(componentInitialState, { workspace: 'component' }),
    [componentInitialState],
  );
  const [componentState, setComponentState] = useState(() => componentStore.getSnapshot().editorState);
  const syncComponentStateFromStore = useCallback(() => {
    const next = componentStore.getSnapshot().editorState;
    setComponentState((current) => (current === next ? current : next));
  }, [componentStore]);
  useEffect(() => componentStore.subscribe(syncComponentStateFromStore), [componentStore, syncComponentStateFromStore]);
  const componentCommandClient = useMemo(
    () =>
      createComponentCanvasCommandClient(componentStore, {
        onRejected: (result) => commandRejectNoticeRef.current(result.message),
      }),
    [componentStore],
  );

  const getCommandClient = useCallback(
    (target: EditorTarget) => (target === 'main' ? mainCommandClient : componentCommandClient),
    [mainCommandClient, componentCommandClient],
  );

  const getCanonicalRevision = useCallback(() => canonicalStore.getSnapshot().projectRevision, [canonicalStore]);
  const getCanonicalProject = useCallback(() => canonicalStore.getSnapshot().editorState.project, [canonicalStore]);
  const subscribeCanonicalStore = useCallback(
    (listener: () => void) => canonicalStore.subscribe(listener),
    [canonicalStore],
  );

  return {
    canonicalStore,
    componentStore,
    state,
    componentState,
    componentInitialProject: componentInitialState.project,
    mainCommandClient,
    componentCommandClient,
    getCommandClient,
    getCanonicalRevision,
    getCanonicalProject,
    subscribeCanonicalStore,
  };
}

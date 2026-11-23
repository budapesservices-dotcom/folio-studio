import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, createInitialProject, createNodeForDocument } from '../src/core/document/factory';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import { createComponentInstance } from '../src/core/document/components';
import type { ComponentDefinition, FolioPage, RectNode } from '../src/core/document/types';
import type { NativeChangeEvent } from '../src/core/commands/types';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import {
  createComponentCanvasCommandClient,
  createMainCanvasCommandClient,
} from '../src/app/mainCanvasCommandClient';
import { executeNativeCommand, executeNativeCommandTransaction } from '../src/app/nativeCommandExecutor';
import { deleteComponentDurably } from '../src/app/componentDeletion';
import { createToolOperation } from '../src/core/tools/operationContract';
import { evaluateToolOperation } from '../src/engines/canvas/geometryEngine';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';

const RESERVED_COMPONENT_CANVAS_ID = 'folio-component-canvas';

const RAW_SRC_FILES = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function createComponentWorkspaceProject() {
  const project = createInitialProject('Component Canvas');
  project.metadata.id = RESERVED_COMPONENT_CANVAS_ID;
  const page = getActivePage(project);
  page.name = 'Component Canvas';
  page.document.name = 'Component Canvas';
  page.document.nodes = [];
  return project;
}

function makeComponentDefinition(id: string, name: string, updatedAt = '2026-01-01T00:00:00.000Z'): ComponentDefinition {
  const doc = createEmptyDocument(name, 320, 200);
  const rect = { ...(createNodeForDocument('rect', doc) as RectNode), id: `${id}-rect`, name: `${name} Surface` };
  return {
    id,
    name,
    document: { ...doc, nodes: [rect] },
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('P1.1 Native Command Engine Migration — Main Canvas Extended Operations', () => {
  it('executes replaceNodes, replaceNodeWithNodes, and multi-node transformNodes via Native Commands with events and atomic Undo/Redo', () => {
    const project = createInitialProject('Main Extended');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const doc0 = getActiveDocument(store.getSnapshot().editorState.project);
    const r1 = { ...(createNodeForDocument('rect', doc0) as RectNode), id: 'r1', x: 10, y: 10, width: 80, height: 60 };
    const r2 = { ...(createNodeForDocument('rect', doc0) as RectNode), id: 'r2', x: 120, y: 10, width: 80, height: 60 };
    expect(client.createNodes([r1, r2], 'Create pair').status).toBe('applied');

    // Multi-node transform -> node.update-many (single revision bump, single event, single Undo)
    const revBeforeTransform = store.getSnapshot().projectRevision;
    const eventsBeforeTransform = events.length;
    const transformResult = client.transformNodes([
      { ...r1, x: 50 },
      { ...r2, x: 160 },
    ], 'Shift pair');
    expect(transformResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeTransform + 1);
    expect(events).toHaveLength(eventsBeforeTransform + 1);
    expect(events.at(-1)?.change.documents[0]?.nodeIds.updated).toEqual(expect.arrayContaining(['r1', 'r2']));

    // replaceNodes -> node.replace-many
    const merged = { ...(createNodeForDocument('rect', doc0) as RectNode), id: 'merged-1', x: 50, y: 10, width: 190, height: 60 };
    const revBeforeReplace = store.getSnapshot().projectRevision;
    const replaceResult = client.replaceNodes(['r1', 'r2'], [merged], 'Merge pair', ['merged-1']);
    expect(replaceResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeReplace + 1);
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['merged-1']);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'merged-1')).toBe(true);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'r1')).toBe(false);

    // replaceNodeWithNodes -> node.split
    const splitA = { ...(createNodeForDocument('rect', doc0) as RectNode), id: 'split-a', x: 50, y: 10, width: 90, height: 60 };
    const splitB = { ...(createNodeForDocument('rect', doc0) as RectNode), id: 'split-b', x: 150, y: 10, width: 90, height: 60 };
    const splitResult = client.replaceNodeWithNodes('merged-1', [splitA, splitB], 'Split node');
    expect(splitResult.status).toBe('applied');
    const nodesAfterSplit = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(nodesAfterSplit.some((n) => n.id === 'merged-1')).toBe(false);
    expect(nodesAfterSplit.some((n) => n.id === 'split-a')).toBe(true);
    expect(nodesAfterSplit.some((n) => n.id === 'split-b')).toBe(true);

    // Undo/Redo through Native Command Engine emits NativeChangeEvent and bumps revision monotonically
    const revBeforeUndo = store.getSnapshot().projectRevision;
    const eventsBeforeUndo = events.length;
    const undoResult = client.undo('Undo split');
    expect(undoResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeUndo + 1);
    expect(events).toHaveLength(eventsBeforeUndo + 1);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'merged-1')).toBe(true);

    const redoResult = client.redo('Redo split');
    expect(redoResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeUndo + 2);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'split-a')).toBe(true);
  });

  it('coalesces rapid inspector node.edit commands into one Undo entry and seals via history.commit-edit without bumping projectRevision', () => {
    const project = createInitialProject('Coalesce Edit');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const firstNode = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    const originalX = firstNode.x;

    expect(client.editNode({ ...firstNode, x: originalX + 10 }, `inspector:${firstNode.id}`).status).toBe('applied');
    expect(client.editNode({ ...firstNode, x: originalX + 20 }, `inspector:${firstNode.id}`).status).toBe('applied');
    expect(client.editNode({ ...firstNode, x: originalX + 35 }, `inspector:${firstNode.id}`).status).toBe('applied');
    expect(store.getSnapshot().editorState.past).toHaveLength(1);

    const revBeforeCommit = store.getSnapshot().projectRevision;
    const eventsBeforeCommit = events.length;
    const commitResult = client.commitEdit();
    expect(commitResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeCommit);
    expect(events).toHaveLength(eventsBeforeCommit);

    // Next edit after commitEdit starts a new Undo snapshot
    expect(client.editNode({ ...firstNode, x: originalX + 60 }, `inspector:${firstNode.id}`).status).toBe('applied');
    expect(store.getSnapshot().editorState.past).toHaveLength(2);

    // Undo once returns to +35, undo twice returns to originalX
    expect(client.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes[0].x).toBe(originalX + 35);
    expect(client.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes[0].x).toBe(originalX);
  });
});

describe('P1.1 Native Command Engine Migration — Component Canvas Workspace', () => {
  it('runs Component Canvas on its own CanonicalEditorStore, permits reserved component canvas ID, enforces workspace isolation, and executes tool operations', () => {
    const compProject = createComponentWorkspaceProject();

    // Main workspace store still refuses the reserved component canvas ID
    expect(() => createCanonicalEditorStore(createEditorState(compProject))).toThrow();

    // Component workspace store accepts it and publishes workspace: 'component' events
    const compStore = createCanonicalEditorStore(createEditorState(compProject), { workspace: 'component' });
    expect(compStore.workspace).toBe('component');

    const compClient = createComponentCanvasCommandClient(compStore);
    const events: NativeChangeEvent[] = [];
    compStore.subscribeChanges((event) => events.push(event));

    const doc = getActiveDocument(compStore.getSnapshot().editorState.project);
    const rect = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'comp-rect-1', x: 20, y: 20, width: 100, height: 80 };

    // Execute through Tool Operation Executor -> Geometry Engine -> Native Command Engine
    const selectionSpy = vi.fn();
    const executor = createToolOperationExecutor({
      workspace: 'component',
      commandClient: compClient,
      shell: {
        onSelectionChange: (nodeIds) => {
          selectionSpy(nodeIds);
          compClient.selectNodes(nodeIds);
        },
        onPanChange: () => {},
        onZoomChange: () => {},
      },
    });

    const evalCreate = evaluateToolOperation(
      createToolOperation('draw-rect', 'component', { kind: 'create-nodes', nodes: [rect] }),
      { document: doc, selectedNodeIds: [] },
    );
    expect(evalCreate.status).toBe('ready');
    if (evalCreate.status === 'ready') {
      const report = executor.execute(evalCreate.operation);
      expect(report.status).toBe('applied');
    }

    expect(events).toHaveLength(1);
    expect(events[0].source.workspace).toBe('component');
    expect(events[0].projectId).toBe(RESERVED_COMPONENT_CANVAS_ID);
    expect(getActiveDocument(compStore.getSnapshot().editorState.project).nodes).toHaveLength(1);

    // Cross-workspace forgery rejected (a 'main' client cannot mutate a 'component' store)
    const forgedMainClient = createMainCanvasCommandClient(compStore);
    const forgedResult = forgedMainClient.renameProject('Hijacked');
    expect(forgedResult.status).toBe('rejected');
    expect(forgedResult.code).toBe('PERMISSION_DENIED');

    // Undo in Component Canvas emits component workspace event
    expect(compClient.undo().status).toBe('applied');
    expect(getActiveDocument(compStore.getSnapshot().editorState.project).nodes).toHaveLength(0);
    expect(events.at(-1)?.source.workspace).toBe('component');
  });
});

describe('P1.1 Native Command Engine Migration — Page, Project & Component Operations', () => {
  it('migrates page.create, page.set-active, and project.replace with full event publication and revision monotonicity', () => {
    const project = createInitialProject('Multi Page');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const firstPageId = store.getSnapshot().editorState.project.activePageId;
    const newPage: FolioPage = {
      id: 'page-about',
      name: 'About',
      route: '/about',
      document: createEmptyDocument('About', 1280, 720),
    };

    const createPageResult = client.createPage(newPage, 'Create About page');
    expect(createPageResult.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.activePageId).toBe('page-about');
    expect(store.getSnapshot().editorState.project.pages).toHaveLength(2);
    expect(events.at(-1)?.change.documents.some((d) => d.address.owner.id === 'page-about')).toBe(true);

    const switchResult = client.setActivePage(firstPageId, 'Switch back to Home');
    expect(switchResult.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.activePageId).toBe(firstPageId);

    const missingSwitch = client.setActivePage('non-existent-page');
    expect(missingSwitch.status).toBe('rejected');
    expect(missingSwitch.code).toBe('TARGET_NOT_FOUND');

    // project.replace switches to a brand-new projectId cleanly
    const replacement = createInitialProject('Imported Project');
    const revBeforeReplace = store.getSnapshot().projectRevision;
    const replaceResult = client.replaceProject(replacement, 'Open imported .flop');
    expect(replaceResult.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeReplace + 1);
    expect(store.getSnapshot().editorState.project.metadata.id).toBe(replacement.metadata.id);
    expect(store.getSnapshot().editorState.past).toHaveLength(0);
    expect(events.at(-1)?.projectId).toBe(replacement.metadata.id);
  });

  it('migrates component.create, component.sync-document, component.rename, component.delete with CAS conflict protection and durable rollback events', async () => {
    const project = createInitialProject('Components Studio');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const comp = makeComponentDefinition('comp-card', 'Card');
    expect(client.createComponent(comp, 'Create Card').status).toBe('applied');
    expect(events.at(-1)?.change.components.some((c) => c.componentId === 'comp-card')).toBe(true);

    // Insert a linked instance on Main Canvas
    const instance = createComponentInstance(comp, 100, 100);
    expect(client.createNodes([instance], 'Insert Card instance').status).toBe('applied');

    // Rename with matching CAS succeeds
    const renameOk = client.renameComponent({
      componentId: comp.id,
      name: 'Hero Card',
      expectedUpdatedAt: comp.updatedAt,
      expectedMasterDocument: comp.document,
    });
    expect(renameOk.status).toBe('applied');
    const renamedComp = store.getSnapshot().editorState.project.components.find((c) => c.id === comp.id)!;
    expect(renamedComp.name).toBe('Hero Card');

    // Stale CAS sync fails with COMPONENT_CONFLICT
    const staleSync = client.syncComponentDocument({
      componentId: comp.id,
      document: { ...comp.document, name: 'Stale Edit' },
      updatedAt: '2026-01-02T00:00:00.000Z',
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
      expectedMasterDocument: comp.document,
    });
    expect(staleSync.status).toBe('rejected');
    expect(staleSync.code).toBe('COMPONENT_CONFLICT');

    // Fresh CAS sync succeeds
    const syncedDoc = {
      ...renamedComp.document,
      nodes: renamedComp.document.nodes.map((node) => ({ ...node, x: 42 })),
    };
    const syncOk = client.syncComponentDocument({
      componentId: comp.id,
      document: syncedDoc,
      updatedAt: '2026-01-03T00:00:00.000Z',
      expectedUpdatedAt: renamedComp.updatedAt,
      expectedMasterDocument: renamedComp.document,
    });
    expect(syncOk.status).toBe('applied');
    expect(
      events.at(-1)?.change.components.some((c) => c.componentId === 'comp-card' && c.documentContentChanged),
    ).toBe(true);

    // Durable delete failure triggers executor-authenticated rollback with NativeChangeEvent
    const currentComp = store.getSnapshot().editorState.project.components.find((c) => c.id === comp.id)!;
    const eventsBeforeFailDelete = events.length;
    const durableFail = await deleteComponentDurably(
      store,
      {
        componentId: currentComp.id,
        expectedUpdatedAt: currentComp.updatedAt,
        expectedMasterDocument: currentComp.document,
      },
      createComponentWorkspaceProject(),
      async (operation) =>
        operation(async () => {
          throw new Error('Simulated IndexedDB write failure');
        }),
    );
    expect(durableFail.status).toBe('deletion-persist-failed');
    expect(store.getSnapshot().editorState.project.components.some((c) => c.id === comp.id)).toBe(true);
    // Delete event + rollback event both emitted through Native Command Engine
    expect(events.length).toBeGreaterThanOrEqual(eventsBeforeFailDelete + 2);

    // Direct delete succeeds, detaches linked instance, and emits component change
    const liveComp = store.getSnapshot().editorState.project.components.find((c) => c.id === comp.id)!;
    const deleteOk = client.deleteComponent({
      componentId: liveComp.id,
      expectedUpdatedAt: liveComp.updatedAt,
      expectedMasterDocument: liveComp.document,
    });
    expect(deleteOk.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(0);
    expect(events.at(-1)?.change.components.some((c) => c.componentId === 'comp-card')).toBe(true);
    expect(
      getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.type === 'component-instance'),
    ).toBe(false);
  });
});

describe('P1.1 Native Command Engine Migration — Selection, Transactions & Event Stream', () => {
  it('executes selection.set without bumping projectRevision or publishing project NativeChangeEvents', () => {
    const project = createInitialProject('Selection Command');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const targetId = getActiveDocument(store.getSnapshot().editorState.project).nodes[0].id;
    const revBefore = store.getSnapshot().projectRevision;
    const result = client.selectNodes([targetId], 'Select initial node');
    expect(result.status).toBe('applied');
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual([targetId]);
    expect(store.getSnapshot().projectRevision).toBe(revBefore);
    expect(events).toHaveLength(0);

    // Re-selecting identical selection is a no-op
    expect(client.selectNodes([targetId]).status).toBe('no-op');
  });

  it('commits multi-command transactions atomically (single revision, single Undo step, single NativeChangeEvent) and rolls back completely on failure', () => {
    const project = createInitialProject('Atomic Tx');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const ast = client.getActiveAstView();
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const rectA = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'tx-rect-a' };
    const comp = makeComponentDefinition('tx-comp-1', 'Tx Component');
    const txId = 'tx-atomic-1';

    const revBefore = store.getSnapshot().projectRevision;
    const txResult = client.executeTransaction([
      client.createEnvelope(
        'node.create',
        { kind: 'document', address: ast.address },
        { nodes: [rectA] },
        'Tx create node',
        txId,
      ),
      client.createEnvelope(
        'project.rename',
        { kind: 'project', projectId: project.metadata.id },
        { name: 'Atomic Tx Renamed' },
        'Tx rename project',
        txId,
      ),
      client.createEnvelope(
        'component.create',
        { kind: 'project', projectId: project.metadata.id },
        { component: comp },
        'Tx create component',
        txId,
      ),
    ]);

    expect(txResult.status).toBe('applied');
    expect(txResult.transactionId).toBe(txId);
    expect(txResult.commandResults).toHaveLength(3);
    expect(store.getSnapshot().projectRevision).toBe(revBefore + 1);
    expect(events).toHaveLength(1);
    expect(events[0].transactionId).toBe(txId);
    expect(events[0].change.commandIds).toEqual(txResult.commandResults.map((r) => r.commandId));
    expect(store.getSnapshot().editorState.project.metadata.name).toBe('Atomic Tx Renamed');
    expect(store.getSnapshot().editorState.project.components.some((c) => c.id === 'tx-comp-1')).toBe(true);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'tx-rect-a')).toBe(true);

    // Single Undo reverts ALL 3 commands in the transaction together!
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.metadata.name).toBe('Atomic Tx');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(0);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'tx-rect-a')).toBe(false);

    // Failing second command rolls back first command completely (0 revision bump, 0 events)
    const revBeforeFail = store.getSnapshot().projectRevision;
    const eventsBeforeFail = events.length;
    const rectB = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'tx-rect-rollback' };
    const failedTx = executeNativeCommandTransaction(
      store,
      [
        client.createEnvelope(
          'node.create',
          { kind: 'document', address: client.getActiveAstView().address },
          { nodes: [rectB] },
          'Should roll back',
          'tx-fail-1',
        ),
        client.createEnvelope(
          'page.set-active',
          { kind: 'project', projectId: project.metadata.id },
          { pageId: 'missing-page-id' },
          'Invalid page switch',
          'tx-fail-1',
        ),
      ],
      {
        projectId: project.metadata.id,
        principal: { kind: 'user', id: 'local-main-user' },
        capabilities: ['node.create', 'page.switch'],
        workspace: 'main',
      },
    );

    expect(failedTx.status).toBe('rejected');
    expect(failedTx.failedCommandIndex).toBe(1);
    expect(failedTx.code).toBe('TARGET_NOT_FOUND');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeFail);
    expect(events).toHaveLength(eventsBeforeFail);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'tx-rect-rollback')).toBe(false);
  });

  it('returns no-op on empty Undo/Redo and validates unknown command rejection cleanly', () => {
    const project = createInitialProject('No-op History');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const rev0 = store.getSnapshot().projectRevision;

    expect(client.undo().status).toBe('no-op');
    expect(client.redo().status).toBe('no-op');
    expect(store.getSnapshot().projectRevision).toBe(rev0);

    const unknown = executeNativeCommand(
      store,
      client.createEnvelope(
        'unknown.command',
        { kind: 'project', projectId: project.metadata.id },
        {},
      ),
      {
        projectId: project.metadata.id,
        principal: { kind: 'user', id: 'local-main-user' },
        capabilities: ['project.rename'],
        workspace: 'main',
      },
    );
    expect(unknown.status).toBe('rejected');
    expect(unknown.code).toBe('UNKNOWN_COMMAND');
  });
});

describe('P1.1 Native Command Engine Migration — Static Zero-Bypass Enforcement', () => {
  it('guarantees ZERO project mutations bypass the Native Command Engine across all production source files', () => {
    const entries = Object.entries(RAW_SRC_FILES);
    expect(entries.length).toBeGreaterThan(20);

    for (const [filePath, source] of entries) {
      const normalized = filePath.replace(/^\.\.\/src\//, '');

      // 1. dispatchLegacyAction may ONLY exist inside editorStore.ts (retained for backward-compat tests)
      if (normalized !== 'app/editorStore.ts') {
        expect(
          source.includes('dispatchLegacyAction('),
          `Production file "${normalized}" must NOT call dispatchLegacyAction()`,
        ).toBe(false);
      }

      // 2. No production file may mount useReducer(editorReducer, ...)
      expect(
        /useReducer\s*\(\s*editorReducer/.test(source),
        `Production file "${normalized}" must NOT use useReducer(editorReducer, ...)`,
      ).toBe(false);

      // 3. Direct editorReducer() invocation is strictly confined to editorReducer.ts, editorStore.ts, and nativeCommandExecutor.ts
      if (
        normalized !== 'app/editorReducer.ts' &&
        normalized !== 'app/editorStore.ts' &&
        normalized !== 'app/nativeCommandExecutor.ts'
      ) {
        expect(
          /\beditorReducer\s*\(/.test(source),
          `Production file "${normalized}" must NOT call editorReducer() directly`,
        ).toBe(false);
      }

      // 4. Direct commitEditorTransition() is strictly confined to editorStore.ts and nativeCommandExecutor.ts
      if (
        normalized !== 'app/editorStore.ts' &&
        normalized !== 'app/nativeCommandExecutor.ts'
      ) {
        expect(
          /\bcommitEditorTransition\s*\(/.test(source),
          `Production file "${normalized}" must NOT call commitEditorTransition() directly`,
        ).toBe(false);
      }
    }
  });
});

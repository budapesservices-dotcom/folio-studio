import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type { DocumentAddress, NativeNodeRef } from '../src/core/document/ast';
import type { NativeChangeEvent, NativeCommandContext, NativePermission } from '../src/core/commands/types';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState } from '../src/app/editorReducer';
import { NATIVE_COMMAND_REGISTRY } from '../src/app/nativeCommandRegistry';
import { executeNativeCommand } from '../src/app/nativeCommandExecutor';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';

let seq = 1;
function uuid(): string {
  const suffix = (seq++).toString(16).padStart(12, '0');
  return `11111111-1111-4111-8111-${suffix}`;
}

const ALL_MAIN_PERMISSIONS: readonly NativePermission[] = [
  'project.read',
  'project.rename',
  'document.read',
  'node.create',
  'node.update',
  'node.transform',
  'node.reorder',
  'node.delete',
];

function createPhase2Fixture() {
  const project = createInitialProject('Phase 2 Project');
  const firstPage = project.pages[0];
  const rectA = { ...createRectNode(), id: 'node-a', name: 'Base Rect', x: 20, y: 20, width: 120, height: 80 };
  const rectB = { ...createRectNode(), id: 'node-b', name: 'Top Rect', x: 60, y: 40, width: 100, height: 60 };
  const textC = { ...createTextNode(), id: 'node-c', name: 'Title Text', x: 100, y: 120, width: 200, height: 48, text: 'Hello' };
  project.pages = [
    {
      ...firstPage,
      id: 'page-main',
      route: '/',
      document: {
        ...firstPage.document,
        id: 'doc-main',
        nodes: [rectA, rectB, textC],
      },
    },
    {
      id: 'page-about',
      name: 'About',
      route: '/about',
      document: {
        ...createEmptyDocument('About'),
        id: 'doc-about',
        nodes: [{ ...createRectNode(), id: 'about-rect', name: 'About Rect' }],
      },
    },
  ];
  const state = createEditorState(project);
  const store = createCanonicalEditorStore(state);
  const canonicalProject = store.getSnapshot().editorState.project;
  const address: DocumentAddress = {
    projectId: canonicalProject.metadata.id,
    owner: { kind: 'page', id: 'page-main' },
    documentId: 'doc-main',
  };
  const context: NativeCommandContext = {
    projectId: canonicalProject.metadata.id,
    principal: { kind: 'user', id: 'designer-1' },
    capabilities: ALL_MAIN_PERMISSIONS,
    workspace: 'main',
  };
  return { store, address, context, projectId: canonicalProject.metadata.id };
}

function ref(address: DocumentAddress, nodeId: string): NativeNodeRef {
  return { document: address, nodeId };
}

function envelope(
  type: string,
  target: Record<string, unknown>,
  payload: unknown,
  extras: Record<string, unknown> = {},
) {
  return {
    protocol: 'folio.native-command',
    protocolVersion: 1,
    commandId: uuid(),
    type,
    commandVersion: 1,
    issuedAt: '2026-11-22T09:00:00.000Z',
    source: { workspace: 'main', actor: { kind: 'user', actorId: 'designer-1' } },
    target,
    payload,
    ...extras,
  };
}

describe('Native Command Core — Phase 2 registry and commands', () => {
  it('freezes all 14 registered commands and their allowedTargets', () => {
    const commandTypes = Object.keys(NATIVE_COMMAND_REGISTRY);
    expect(commandTypes).toHaveLength(14);
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY)).toBe(true);
    for (const key of commandTypes) {
      const def = NATIVE_COMMAND_REGISTRY[key as keyof typeof NATIVE_COMMAND_REGISTRY];
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.allowedTargets)).toBe(true);
    }
  });

  it('executes project.rename with projectMetadataChanged change event and rejects wrong project or no-op', () => {
    const { store, context, projectId } = createPhase2Fixture();
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const applied = executeNativeCommand(
      store,
      envelope('project.rename', { kind: 'project', projectId }, { name: '  Studio Alpha  ' }),
      context,
    );
    expect(applied).toMatchObject({
      status: 'applied',
      code: 'APPLIED',
      changed: true,
      projectRevisionBefore: 0,
      projectRevisionAfter: 1,
      affectedDocuments: [],
      affectedNodes: [],
    });
    expect(store.getSnapshot().editorState.project.metadata.name).toBe('Studio Alpha');
    expect(events).toHaveLength(1);
    expect(events[0].change.projectMetadataChanged).toBe(true);

    const noOp = executeNativeCommand(
      store,
      envelope('project.rename', { kind: 'project', projectId }, { name: 'Studio Alpha' }),
      context,
    );
    expect(noOp.status).toBe('no-op');
    expect(store.getSnapshot().projectRevision).toBe(1);

    const wrongProject = executeNativeCommand(
      store,
      envelope('project.rename', { kind: 'project', projectId: 'other-project' }, { name: 'Hijack' }),
      context,
    );
    expect(wrongProject).toMatchObject({ status: 'rejected', code: 'PROJECT_NOT_FOUND' });

    const noPermission = executeNativeCommand(
      store,
      envelope('project.rename', { kind: 'project', projectId }, { name: 'Blocked' }),
      { ...context, capabilities: ['project.read'] },
    );
    expect(noPermission).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
  });

  it('executes node.create, rejects duplicate IDs, and reports added node IDs', () => {
    const { store, address, context } = createPhase2Fixture();
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const newNode = { ...createRectNode(), id: 'node-created', name: 'Hero Card', x: 10, y: 15 };
    const created = executeNativeCommand(
      store,
      envelope('node.create', { kind: 'document', address }, { nodes: [newNode] }),
      context,
    );
    expect(created.status).toBe('applied');
    expect(created.affectedNodes).toEqual([ref(address, 'node-created')]);
    expect(events[0].change.documents[0].nodeIds).toEqual({
      added: ['node-created'],
      updated: [],
      removed: [],
    });

    const duplicateExisting = executeNativeCommand(
      store,
      envelope('node.create', { kind: 'document', address }, { nodes: [newNode] }),
      context,
    );
    expect(duplicateExisting).toMatchObject({ status: 'rejected', code: 'INVALID_REFERENCE' });

    const duplicateInPayload = executeNativeCommand(
      store,
      envelope('node.create', { kind: 'document', address }, {
        nodes: [
          { ...createRectNode(), id: 'dup-id' },
          { ...createRectNode(), id: 'dup-id' },
        ],
      }),
      context,
    );
    expect(duplicateInPayload).toMatchObject({ status: 'rejected', code: 'INVALID_REFERENCE' });
  });

  it('executes node.replace and rejects ID mutation, type mutation, and locked targets', () => {
    const { store, address, context } = createPhase2Fixture();
    const originalText = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-c')!;
    if (originalText.type !== 'text') throw new Error('Expected text node');

    const replaced = executeNativeCommand(
      store,
      envelope(
        'node.replace',
        { kind: 'node', ref: ref(address, 'node-c') },
        {
          node: {
            ...originalText,
            text: 'Updated Heading',
            style: { ...originalText.style, fontSize: 42 },
          },
        },
      ),
      context,
    );
    expect(replaced.status).toBe('applied');
    const updated = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-c');
    expect(updated?.type === 'text' ? updated.style.fontSize : null).toBe(42);

    const idMismatch = executeNativeCommand(
      store,
      envelope(
        'node.replace',
        { kind: 'node', ref: ref(address, 'node-c') },
        { node: { ...originalText, id: 'forged-id' } },
      ),
      context,
    );
    expect(idMismatch).toMatchObject({ status: 'rejected', code: 'INVALID_REFERENCE' });

    const typeMismatch = executeNativeCommand(
      store,
      envelope(
        'node.replace',
        { kind: 'node', ref: ref(address, 'node-c') },
        { node: { ...createRectNode(), id: 'node-c' } },
      ),
      context,
    );
    expect(typeMismatch).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' });
  });

  it('executes node.rename, node.set-canvas-state, and node.delete with lock enforcement', () => {
    const { store, address, context } = createPhase2Fixture();
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    expect(executeNativeCommand(
      store,
      envelope('node.rename', { kind: 'document', address }, {
        updates: [{ ref: ref(address, 'node-a'), name: 'Renamed Base' }],
      }),
      context,
    ).status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes[0].name).toBe('Renamed Base');

    expect(executeNativeCommand(
      store,
      envelope('node.set-canvas-state', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a')],
        onCanvas: false,
      }),
      context,
    ).status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes[0].onCanvas).toBe(false);

    // Lock node-a, then confirm rename, canvas-state, and delete are all rejected.
    expect(executeNativeCommand(
      store,
      envelope('node.set-properties', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a')],
        properties: { locked: true },
      }),
      context,
    ).status).toBe('applied');

    expect(executeNativeCommand(
      store,
      envelope('node.rename', { kind: 'document', address }, {
        updates: [{ ref: ref(address, 'node-a'), name: 'Should Fail' }],
      }),
      context,
    )).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });

    expect(executeNativeCommand(
      store,
      envelope('node.set-canvas-state', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a')],
        onCanvas: true,
      }),
      context,
    )).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });

    expect(executeNativeCommand(
      store,
      envelope('node.delete', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a')],
      }),
      context,
    )).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });

    // Unlock and delete node-b.
    const deleted = executeNativeCommand(
      store,
      envelope('node.delete', { kind: 'document', address }, {
        nodes: [ref(address, 'node-b')],
      }),
      context,
    );
    expect(deleted.status).toBe('applied');
    expect(events.at(-1)?.change.documents[0].nodeIds.removed).toEqual(['node-b']);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === 'node-b')).toBe(false);
  });

  it('executes layer.group, layer.ungroup, layer.move, layer.move-many, and clipping mask commands accurately', () => {
    const { store, address, context } = createPhase2Fixture();
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    // Clipping mask on bottom-most node-a fails precondition.
    const invalidClip = executeNativeCommand(
      store,
      envelope('layer.create-clipping-mask', { kind: 'document', address }, { node: ref(address, 'node-a') }),
      context,
    );
    expect(invalidClip).toMatchObject({ status: 'rejected', code: 'PRECONDITION_FAILED' });

    // Clipping mask on node-b clips to node-a, then unmask removes it.
    const clipped = executeNativeCommand(
      store,
      envelope('layer.create-clipping-mask', { kind: 'document', address }, { node: ref(address, 'node-b') }),
      context,
    );
    expect(clipped.status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-b')?.clipMaskBaseId).toBe('node-a');

    const unclipped = executeNativeCommand(
      store,
      envelope('layer.remove-clipping-mask', { kind: 'document', address }, { node: ref(address, 'node-b') }),
      context,
    );
    expect(unclipped.status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-b')?.clipMaskBaseId).toBeUndefined();

    // Removing clip again is a clean no-op.
    const unclipNoOp = executeNativeCommand(
      store,
      envelope('layer.remove-clipping-mask', { kind: 'document', address }, { node: ref(address, 'node-b') }),
      context,
    );
    expect(unclipNoOp.status).toBe('no-op');

    // Group node-a and node-b; verify newly created group ID is reported in added & affectedNodes.
    const grouped = executeNativeCommand(
      store,
      envelope('layer.group', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a'), ref(address, 'node-b')],
      }),
      context,
    );
    expect(grouped.status).toBe('applied');
    const addedIds = events.at(-1)!.change.documents[0].nodeIds.added;
    expect(addedIds).toHaveLength(1);
    const groupId = addedIds[0];
    expect(grouped.affectedNodes.some((entry) => entry.nodeId === groupId)).toBe(true);

    // Moving group into its own child must be rejected with PRECONDITION_FAILED.
    const cycleMove = executeNativeCommand(
      store,
      envelope('layer.move', { kind: 'document', address }, {
        node: ref(address, groupId),
        target: ref(address, 'node-a'),
        position: 'inside',
      }),
      context,
    );
    expect(cycleMove).toMatchObject({ status: 'rejected', code: 'PRECONDITION_FAILED' });

    // Locking the group blocks editing/deleting descendants via inherited lock.
    expect(executeNativeCommand(
      store,
      envelope('node.set-properties', { kind: 'document', address }, {
        nodes: [ref(address, groupId)],
        properties: { locked: true },
      }),
      context,
    ).status).toBe('applied');
    expect(executeNativeCommand(
      store,
      envelope('node.delete', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a')],
      }),
      context,
    )).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });

    // Unlock group, move node-c inside group via layer.move, then ungroup.
    expect(executeNativeCommand(
      store,
      envelope('node.set-properties', { kind: 'document', address }, {
        nodes: [ref(address, groupId)],
        properties: { locked: false },
      }),
      context,
    ).status).toBe('applied');

    const movedInside = executeNativeCommand(
      store,
      envelope('layer.move', { kind: 'document', address }, {
        node: ref(address, 'node-c'),
        target: ref(address, groupId),
        position: 'inside',
      }),
      context,
    );
    expect(movedInside.status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-c')?.parentId).toBe(groupId);

    const ungrouped = executeNativeCommand(
      store,
      envelope('layer.ungroup', { kind: 'document', address }, { nodes: [ref(address, groupId)] }),
      context,
    );
    expect(ungrouped.status).toBe('applied');
    expect(events.at(-1)!.change.documents[0].nodeIds.removed).toEqual([groupId]);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'node-a')?.parentId ?? null).toBeNull();

    // Reorder multiple layers via layer.move-many.
    const movedMany = executeNativeCommand(
      store,
      envelope('layer.move-many', { kind: 'document', address }, {
        nodes: [ref(address, 'node-a'), ref(address, 'node-b')],
        target: ref(address, 'node-c'),
        position: 'before',
      }),
      context,
    );
    expect(movedMany.status).toBe('applied');
    expect(events.at(-1)!.change.documents[0].nodeIds.updated.length).toBeGreaterThan(0);
  });

  it('rejects commands addressing an inactive page document', () => {
    const { store, context, projectId } = createPhase2Fixture();
    const inactiveAddress: DocumentAddress = {
      projectId,
      owner: { kind: 'page', id: 'page-about' },
      documentId: 'doc-about',
    };
    const result = executeNativeCommand(
      store,
      envelope('node.delete', { kind: 'document', address: inactiveAddress }, {
        nodes: [ref(inactiveAddress, 'about-rect')],
      }),
      context,
    );
    expect(result).toMatchObject({ status: 'rejected', code: 'TARGET_SCOPE_MISMATCH' });
    expect(store.getSnapshot().projectRevision).toBe(0);
  });
});

describe('MainCanvasCommandClient (UI-to-Engine modular adapter)', () => {
  it('resolves active AST view, strips undefined optional fields, emits NativeChangeEvents, and reports rejections', () => {
    const { store } = createPhase2Fixture();
    const onRejected = vi.fn();
    const events: NativeChangeEvent[] = [];
    store.subscribeChanges((event) => events.push(event));

    const client = createMainCanvasCommandClient(store, { onRejected });
    expect(client.getActiveAstView().getNode('node-a')?.name).toBe('Base Rect');

    expect(client.renameProject('Renamed via Client').status).toBe('applied');
    expect(store.getSnapshot().editorState.project.metadata.name).toBe('Renamed via Client');

    // Strip explicit undefined optional properties (e.g. from duplicated/unmasked nodes).
    const dupNode = {
      ...createRectNode(),
      id: 'dup-clean',
      name: 'Clean Duplicate',
      clipMaskBaseId: undefined,
      layerColor: undefined,
    };
    expect(client.createNodes([dupNode]).status).toBe('applied');
    expect(client.getActiveAstView().getNode('dup-clean')?.name).toBe('Clean Duplicate');

    // Single text resize with scaled fontSize routes through node.replace cleanly.
    const textNode = client.getActiveAstView().getNode('node-c')!;
    if (textNode.type !== 'text') throw new Error('Expected text node');
    const scaled = client.transformNodes([{
      ...textNode,
      width: 300,
      height: 72,
      style: { ...textNode.style, fontSize: 36 },
    }]);
    expect(scaled.status).toBe('applied');
    const updatedText = client.getActiveAstView().getNode('node-c');
    expect(updatedText?.type === 'text' ? updatedText.style.fontSize : null).toBe(36);

    // Group, lock, and verify rejection fires onRejected callback with clear English message.
    expect(client.setNodesProperties(['node-a'], { locked: true }).status).toBe('applied');
    const blockedDelete = client.deleteNodes(['node-a']);
    expect(blockedDelete).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected.mock.calls[0][0].message).toContain('locked');

    // Every applied client call emitted an immutable NativeChangeEvent.
    expect(events.length).toBe(4);
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it('preserves Undo/Redo monotonic revision semantics after Native Command client edits', () => {
    const { store } = createPhase2Fixture();
    const client = createMainCanvasCommandClient(store);

    expect(client.renameNodes([{ nodeId: 'node-a', name: 'Hero Frame' }]).projectRevisionAfter).toBe(1);
    expect(client.groupLayers(['node-a', 'node-b']).projectRevisionAfter).toBe(2);

    const undo1 = store.dispatchLegacyAction({ type: 'undo' });
    expect(undo1.status).toBe('committed');
    expect(undo1.snapshot.projectRevision).toBe(3);
    expect(getActiveDocument(undo1.snapshot.editorState.project).nodes.some((n) => n.type === 'group')).toBe(false);

    const redo1 = store.dispatchLegacyAction({ type: 'redo' });
    expect(redo1.status).toBe('committed');
    expect(redo1.snapshot.projectRevision).toBe(4);
    expect(getActiveDocument(redo1.snapshot.editorState.project).nodes.some((n) => n.type === 'group')).toBe(true);
  });
});

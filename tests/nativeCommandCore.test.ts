import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type { DocumentAddress, NativeNodeRef } from '../src/core/document/ast';
import type { NativeCommandContext } from '../src/core/commands/types';
import {
  isRuntimeCommandDataWithinLimits,
  NATIVE_COMMAND_RUNTIME_LIMITS,
  validateNativeCommandEnvelope,
} from '../src/core/commands/validation';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { NATIVE_COMMAND_REGISTRY } from '../src/app/nativeCommandRegistry';
import { editorReducer, createEditorState } from '../src/app/editorReducer';
import {
  commitPreparedCommand,
  executeNativeCommand,
  prepareNativeCommand,
} from '../src/app/nativeCommandExecutor';

let commandSequence = 1;
function nextCommandId(): string {
  const suffix = (commandSequence++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

function createFixture() {
  const project = createInitialProject('Native command project');
  const node = { ...createRectNode(), id: 'shared-node', name: 'Target layer', x: 10, y: 20 };
  const firstPage = project.pages[0];
  project.pages = [{
    ...firstPage,
    id: 'page-main',
    route: '/',
    document: { ...firstPage.document, id: 'document-main', nodes: [node] },
  }];
  const state = createEditorState(project);
  const canonicalProject = state.project;
  const page = canonicalProject.pages[0];
  const address: DocumentAddress = {
    projectId: canonicalProject.metadata.id,
    owner: { kind: 'page', id: page.id },
    documentId: page.document.id,
  };
  const store = createCanonicalEditorStore(state);
  const context: NativeCommandContext = {
    projectId: canonicalProject.metadata.id,
    principal: { kind: 'user', id: 'tester' },
    capabilities: ['node.transform', 'node.update'],
    workspace: 'main',
  };
  return { store, context, address, node: page.document.nodes[0], project: canonicalProject };
}

function nodeRef(address: DocumentAddress, nodeId = 'shared-node'): NativeNodeRef {
  return { document: address, nodeId };
}

function makeCommand(
  type: 'node.transform' | 'node.set-properties',
  address: DocumentAddress,
  payload: unknown,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol: 'folio.native-command',
    protocolVersion: 1,
    commandId: nextCommandId(),
    type,
    commandVersion: 1,
    issuedAt: '2026-11-20T06:30:00.000Z',
    source: { workspace: 'main', actor: { kind: 'user', actorId: 'tester' } },
    target: { kind: 'document', address },
    payload,
    ...extras,
  };
}

function currentNode(store: ReturnType<typeof createCanonicalEditorStore>, nodeId = 'shared-node') {
  return getActiveDocument(store.getSnapshot().editorState.project).nodes.find((node) => node.id === nodeId);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Native Command envelope and registry', () => {
  it('keeps the static command registry and nested target allowlists immutable', () => {
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY)).toBe(true);
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY['node.transform'])).toBe(true);
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY['node.transform'].allowedTargets)).toBe(true);
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY['node.set-properties'])).toBe(true);
    expect(Object.isFrozen(NATIVE_COMMAND_REGISTRY['node.set-properties'].allowedTargets)).toBe(true);
  });

  it('accepts a valid v1 command envelope', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 100 } }],
    });

    expect(validateNativeCommandEnvelope(command).ok).toBe(true);
  });

  it('rejects malformed, unsupported and unknown envelope data with stable errors', () => {
    const fixture = createFixture();
    const valid = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 100 } }],
    });

    expect(validateNativeCommandEnvelope({ ...valid, commandId: 'not-a-uuid' })).toMatchObject({
      ok: false, code: 'INVALID_ENVELOPE',
    });
    expect(validateNativeCommandEnvelope({ ...valid, protocolVersion: 99 })).toMatchObject({
      ok: false, code: 'UNSUPPORTED_PROTOCOL',
    });
    expect(validateNativeCommandEnvelope({ ...valid, unapprovedField: true })).toMatchObject({
      ok: false, code: 'INVALID_ENVELOPE',
    });
    expect(validateNativeCommandEnvelope({ ...valid, issuedAt: '2026-02-30T25:61:00Z' })).toMatchObject({
      ok: false, code: 'INVALID_ENVELOPE',
    });
    expect(validateNativeCommandEnvelope({ ...valid, commandVersion: 2 }).ok).toBe(true);
    expect(executeNativeCommand(fixture.store, { ...valid, commandVersion: 2 }, fixture.context)).toMatchObject({
      status: 'rejected', code: 'UNSUPPORTED_COMMAND_VERSION',
    });
    expect(executeNativeCommand(fixture.store, { ...valid, commandId: nextCommandId(), type: 'logic.create-node' }, fixture.context)).toMatchObject({
      status: 'rejected', code: 'UNKNOWN_COMMAND',
    });
    const inheritedRegistryKey = prepareNativeCommand(
      fixture.store.getSnapshot(),
      { ...valid, commandId: nextCommandId(), type: 'toString' },
      fixture.context,
    );
    expect(inheritedRegistryKey).toMatchObject({
      status: 'rejected',
      result: { code: 'UNKNOWN_COMMAND' },
    });
  });


  it('rejects a stale expectedProjectRevision during preparation', () => {
    const fixture = createFixture();
    fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'New canonical revision' });
    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 999 } }],
    }, { preconditions: { expectedProjectRevision: 0 } }), fixture.context);

    expect(result).toMatchObject({ status: 'rejected', code: 'REVISION_CONFLICT' });
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });

  it('rejects duplicate command IDs within the active store session', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 200 } }],
    });

    expect(executeNativeCommand(fixture.store, command, fixture.context).status).toBe('applied');
    expect(executeNativeCommand(fixture.store, command, fixture.context)).toMatchObject({
      status: 'rejected', code: 'DUPLICATE_COMMAND_ID',
    });
    expect(currentNode(fixture.store)?.x).toBe(200);
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });
});

describe('node.transform', () => {
  it('prepares without mutating live state and applies only after the store confirms commit', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 144, y: 233, width: 300, rotation: 18 } }],
    });
    const before = fixture.store.getSnapshot();
    const preparation = prepareNativeCommand(before, command, fixture.context);

    expect(preparation.status).toBe('prepared');
    if (preparation.status !== 'prepared') throw new Error('Expected a prepared command.');
    expect(currentNode(fixture.store)).toMatchObject({ x: 10, y: 20 });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(before.projectRevision).toBe(0);

    const committed = commitPreparedCommand(fixture.store, preparation);
    expect(committed.status).toBe('applied');
    expect(committed.result).toMatchObject({
      status: 'applied',
      changed: true,
      projectRevisionBefore: 0,
      projectRevisionAfter: 1,
    });
    expect(currentNode(fixture.store)).toMatchObject({ x: 144, y: 233, width: 300, rotation: 18 });
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(1);
  });

  it('supports Canvas placement only through the existing onCanvas transform field', () => {
    const fixture = createFixture();
    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 45, onCanvas: false } }],
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(currentNode(fixture.store)).toMatchObject({ x: 45, onCanvas: false });
  });
});

describe('node.set-properties', () => {
  it('applies only the explicit visible, locked and layerColor allowlist', () => {
    const fixture = createFixture();
    const result = executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { visible: false, locked: true, layerColor: '#AABBCC' },
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(currentNode(fixture.store)).toMatchObject({ visible: false, locked: true, layerColor: '#AABBCC' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });

  it('maps layerColor null to the existing reducer clear behavior', () => {
    const fixture = createFixture();
    executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { layerColor: '#abcdef' },
    }), fixture.context);
    const result = executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { layerColor: null },
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(currentNode(fixture.store)?.layerColor).toBeUndefined();
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
  });

  it('rejects arbitrary object merging and invalid property values', () => {
    const fixture = createFixture();
    const invalid = [
      { nodes: [nodeRef(fixture.address)], properties: { id: 'forged-id' } },
      { nodes: [nodeRef(fixture.address)], properties: { type: 'text' } },
      { nodes: [nodeRef(fixture.address)], properties: { visible: 'false' } },
      { nodes: [nodeRef(fixture.address)], properties: { layerColor: 42 } },
      { nodes: [nodeRef(fixture.address)], properties: {} },
    ];

    for (const payload of invalid) {
      expect(executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, payload), fixture.context).status)
        .toBe('rejected');
    }
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(0);
  });
});

describe('Exact document and node addressing', () => {
  it('does not confuse the same node ID in different page documents', () => {
    const fixture = createFixture();
    const project = fixture.project;
    const firstPage = project.pages[0];
    const secondPage = {
      ...firstPage,
      id: 'page-inactive',
      name: 'Inactive page',
      route: '/inactive',
      document: {
        ...firstPage.document,
        id: 'document-inactive',
        nodes: [{ ...firstPage.document.nodes[0], x: 900 }],
      },
    };
    const expandedState = createEditorState({
      ...project,
      pages: [...project.pages, secondPage],
    });
    const store = createCanonicalEditorStore(expandedState);
    const inactiveAddress: DocumentAddress = {
      projectId: expandedState.project.metadata.id,
      owner: { kind: 'page', id: 'page-inactive' },
      documentId: 'document-inactive',
    };

    const inactiveTarget = executeNativeCommand(store, makeCommand('node.transform', inactiveAddress, {
      nodes: [{ ref: nodeRef(inactiveAddress), transform: { x: 777 } }],
    }), { ...fixture.context, projectId: expandedState.project.metadata.id });

    expect(inactiveTarget).toMatchObject({ status: 'rejected', code: 'TARGET_SCOPE_MISMATCH' });
    expect(currentNode(store)?.x).toBe(10);

    const mixedTarget = executeNativeCommand(store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(inactiveAddress), transform: { x: 555 } }],
    }), { ...fixture.context, projectId: expandedState.project.metadata.id });

    expect(mixedTarget).toMatchObject({ status: 'rejected', code: 'TARGET_SCOPE_MISMATCH' });
    expect(currentNode(store)?.x).toBe(10);
    expect(store.getSnapshot().projectRevision).toBe(0);
  });

  it('rejects missing nodes, wrong project IDs and mismatched document IDs', () => {
    const fixture = createFixture();
    const missing = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address, 'missing-node'), transform: { x: 100 } }],
    }), fixture.context);
    const wrongProjectAddress = { ...fixture.address, projectId: 'another-project' };
    const wrongProject = executeNativeCommand(fixture.store, makeCommand('node.transform', wrongProjectAddress, {
      nodes: [{ ref: nodeRef(wrongProjectAddress), transform: { x: 100 } }],
    }), fixture.context);
    const wrongDocumentAddress = { ...fixture.address, documentId: 'wrong-document-id' };
    const wrongDocument = executeNativeCommand(fixture.store, makeCommand('node.transform', wrongDocumentAddress, {
      nodes: [{ ref: nodeRef(wrongDocumentAddress), transform: { x: 100 } }],
    }), fixture.context);

    expect(missing).toMatchObject({ status: 'rejected', code: 'INVALID_REFERENCE' });
    expect(wrongProject).toMatchObject({ status: 'rejected', code: 'PROJECT_NOT_FOUND' });
    expect(wrongDocument).toMatchObject({ status: 'rejected', code: 'TARGET_SCOPE_MISMATCH' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });


  it('does not allow the reserved Component Canvas workspace project to own the canonical store', () => {
    const fixture = createFixture();
    const temporaryProject = {
      ...fixture.project,
      metadata: { ...fixture.project.metadata, id: 'folio-component-canvas' },
    };
    expect(() => createCanonicalEditorStore(createEditorState(temporaryProject)))
      .toThrow('The temporary Component Canvas buffer cannot become the canonical Main Canvas project.');
  });

  it('rejects component-definition and temporary Component Canvas targets in Phase 1', () => {
    const fixture = createFixture();
    const componentProject = {
      ...fixture.project,
      components: [{
        id: 'component-card',
        name: 'Card',
        createdAt: fixture.project.metadata.createdAt,
        updatedAt: fixture.project.metadata.updatedAt,
        document: {
          ...fixture.project.pages[0].document,
          id: 'component-document',
          nodes: [{ ...fixture.node, id: 'shared-node' }],
        },
      }],
    };
    const componentStore = createCanonicalEditorStore(createEditorState(componentProject));
    const componentAddress: DocumentAddress = {
      projectId: componentProject.metadata.id,
      owner: { kind: 'component', id: 'component-card' },
      documentId: 'component-document',
    };
    const componentResult = executeNativeCommand(componentStore, makeCommand('node.transform', componentAddress, {
      nodes: [{ ref: nodeRef(componentAddress), transform: { x: 200 } }],
    }), { ...fixture.context, projectId: componentProject.metadata.id });

    const temporaryAddress: DocumentAddress = {
      ...fixture.address,
      projectId: 'folio-component-canvas',
    };
    const temporaryResult = executeNativeCommand(fixture.store, makeCommand('node.transform', temporaryAddress, {
      nodes: [{ ref: nodeRef(temporaryAddress), transform: { x: 200 } }],
    }), fixture.context);

    expect(componentResult).toMatchObject({ status: 'rejected', code: 'TARGET_SCOPE_MISMATCH' });
    expect(temporaryResult).toMatchObject({ status: 'rejected', code: 'PROJECT_NOT_FOUND' });
    expect(componentStore.getSnapshot().projectRevision).toBe(0);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });

  it('rejects a multi-node operation as a whole when one reference is invalid', () => {
    const fixture = createFixture();
    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [
        { ref: nodeRef(fixture.address), transform: { x: 300 } },
        { ref: nodeRef(fixture.address, 'missing-node'), transform: { x: 400 } },
      ],
    }), fixture.context);

    expect(result).toMatchObject({ status: 'rejected', code: 'INVALID_REFERENCE' });
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(0);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });
});

describe('Payload, lock and no-op behavior', () => {
  it('rejects non-finite values, invalid dimensions and unsupported transform fields', () => {
    const fixture = createFixture();
    const invalidTransforms = [
      { x: Number.NaN },
      { y: Number.POSITIVE_INFINITY },
      { width: 0 },
      { height: -2 },
      { id: 'other-id' },
      { parentId: 'other-parent' },
      { type: 'text' },
      { style: { fill: '#fff' } },
    ];

    for (const transform of invalidTransforms) {
      const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
        nodes: [{ ref: nodeRef(fixture.address), transform }],
      }), fixture.context);
      expect(result.status).toBe('rejected');
    }
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });

  it('rejects transforms of nodes under a locked ancestor', () => {
    const fixture = createFixture();
    const group = {
      id: 'locked-group',
      type: 'group' as const,
      name: 'Locked group',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: true,
    };
    const child = { ...fixture.node, parentId: group.id };
    const project = {
      ...fixture.project,
      pages: fixture.project.pages.map((page) => ({
        ...page,
        document: { ...page.document, nodes: [group, child] },
      })),
    };
    const state = createEditorState(project);
    const store = createCanonicalEditorStore(state);
    const address = {
      projectId: state.project.metadata.id,
      owner: { kind: 'page' as const, id: state.project.pages[0].id },
      documentId: state.project.pages[0].document.id,
    };

    const result = executeNativeCommand(store, makeCommand('node.transform', address, {
      nodes: [{ ref: nodeRef(address), transform: { x: 500 } }],
    }), fixture.context);

    expect(result).toMatchObject({ status: 'rejected', code: 'LOCKED_TARGET' });
    expect(currentNode(store)?.x).toBe(10);
    expect(store.getSnapshot().projectRevision).toBe(0);
  });

  it('returns no-op for an already satisfied valid transform and property command', () => {
    const fixture = createFixture();
    const sameTransform = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 10, y: 20 } }],
    }), fixture.context);
    const sameProperties = executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { visible: true, locked: false },
    }), fixture.context);

    expect(sameTransform.status).toBe('no-op');
    expect(sameProperties.status).toBe('no-op');
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(0);
  });

  it('does not emit mutation notifications for rejected or no-op commands', () => {
    const fixture = createFixture();
    const events: unknown[] = [];
    fixture.store.subscribeChanges((event) => events.push(event));

    executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 10 } }],
    }), fixture.context);
    executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address, 'missing-node'), transform: { x: 200 } }],
    }), fixture.context);

    expect(events).toEqual([]);
  });

  it('rejects commands when the trusted host permission or source workspace is wrong', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 200 } }],
    });
    const denied = executeNativeCommand(fixture.store, command, {
      ...fixture.context,
      capabilities: ['node.update'],
    });
    const wrongWorkspace = executeNativeCommand(fixture.store, {
      ...makeCommand('node.transform', fixture.address, {
        nodes: [{ ref: nodeRef(fixture.address), transform: { x: 200 } }],
      }),
      source: { workspace: 'plugin', actor: { kind: 'user', actorId: 'tester' } },
    }, fixture.context);

    const unknownCapability = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 250 } }],
    }), {
      ...fixture.context,
      capabilities: ['node.transform', 'project.admin'] as unknown as NativeCommandContext['capabilities'],
    });

    expect(denied).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
    expect(wrongWorkspace).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
    expect(unknownCapability).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });
});

describe('Reducer parity, history and canonical revision', () => {
  it('matches the legacy transform reducer result and records one history snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T06:30:00.000Z'));
    const fixture = createFixture();
    const replacement = { ...fixture.node, x: 333, y: 444, rotation: 32 };
    const legacyCandidate = editorReducer(fixture.store.getSnapshot().editorState, {
      type: 'transform-nodes',
      nodes: [replacement],
    });
    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 333, y: 444, rotation: 32 } }],
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(getActiveDocument(fixture.store.getSnapshot().editorState.project).nodes)
      .toEqual(getActiveDocument(legacyCandidate.project).nodes);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(1);
    expect(fixture.store.getSnapshot().editorState.future).toHaveLength(0);
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });

  it('reports only the nodes changed by a mixed multi-target command', () => {
    const fixture = createFixture();
    const initial = fixture.store.getSnapshot().editorState;
    const unchanged = { ...createRectNode(), id: 'already-hidden', visible: false };
    const project = {
      ...initial.project,
      pages: initial.project.pages.map((page) => ({
        ...page,
        document: { ...page.document, nodes: [...page.document.nodes, unchanged] },
      })),
    };
    const store = createCanonicalEditorStore(createEditorState(project));
    let emittedUpdatedIds: string[] | undefined;
    store.subscribeChanges((event) => {
      emittedUpdatedIds = event.change.documents[0].nodeIds.updated;
    });
    const result = executeNativeCommand(store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address), nodeRef(fixture.address, 'already-hidden')],
      properties: { visible: false },
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(emittedUpdatedIds).toEqual(['shared-node']);
  });

  it('matches the legacy set-properties reducer result', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T07:30:00.000Z'));
    const fixture = createFixture();
    const legacyCandidate = editorReducer(fixture.store.getSnapshot().editorState, {
      type: 'set-nodes-properties',
      nodeIds: ['shared-node'],
      properties: { visible: false, locked: true, layerColor: '#123456' },
    });
    const result = executeNativeCommand(fixture.store, makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { visible: false, locked: true, layerColor: '#123456' },
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(getActiveDocument(fixture.store.getSnapshot().editorState.project).nodes)
      .toEqual(getActiveDocument(legacyCandidate.project).nodes);
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });

  it('increments once for a command, once for Undo and once for Redo', () => {
    const fixture = createFixture();
    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 300 } }],
    }), fixture.context);

    expect(result.projectRevisionBefore).toBe(0);
    expect(result.projectRevisionAfter).toBe(1);
    expect(fixture.store.dispatchLegacyAction({ type: 'undo' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.dispatchLegacyAction({ type: 'redo' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().projectRevision).toBe(3);
    expect(currentNode(fixture.store)?.x).toBe(300);
  });

  it('routes selection and commit-edit-only transitions without advancing projectRevision', () => {
    const fixture = createFixture();
    fixture.store.dispatchLegacyAction({ type: 'select-node', nodeId: 'shared-node' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
    fixture.store.dispatchLegacyAction({ type: 'commit-edit' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
    expect(fixture.store.getSnapshot().editorState.selectedNodeId).toBe('shared-node');
  });

  it('increments once for accepted legacy project replacement and does not import a revision value', () => {
    const fixture = createFixture();
    const replacement = createInitialProject('Imported replacement');
    const result = fixture.store.dispatchLegacyAction({ type: 'replace-project', project: replacement });

    expect(result.status).toBe('committed');
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
    expect(fixture.store.getSnapshot().editorState.project.metadata.name).toBe('Imported replacement');
    expect('projectRevision' in fixture.store.getSnapshot().editorState.project).toBe(false);
  });

  it('keeps projectRevision monotonic while page addition and page switching reset history as before', () => {
    const fixture = createFixture();
    fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'Changed' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
    const project = fixture.store.getSnapshot().editorState.project;
    const secondPage = {
      ...project.pages[0],
      id: 'page-second',
      name: 'Second',
      route: '/second',
      document: { ...project.pages[0].document, id: 'document-second' },
    };
    fixture.store.dispatchLegacyAction({ type: 'add-page', page: secondPage });
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(0);
    fixture.store.dispatchLegacyAction({ type: 'set-active-page', pageId: 'page-main' });
    expect(fixture.store.getSnapshot().projectRevision).toBe(3);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(0);
  });

  it('keeps the existing 60-snapshot history limit', () => {
    const fixture = createFixture();
    for (let index = 0; index < 65; index += 1) {
      fixture.store.dispatchLegacyAction({ type: 'rename-project', name: `Rename ${index}` });
    }
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(60);
    expect(fixture.store.getSnapshot().projectRevision).toBe(65);
  });
});

describe('Component Canvas isolation at the canonical boundary', () => {
  it('does not allow the temporary Component Canvas project to own a canonical store', () => {
    const project = createInitialProject('Temporary buffer');
    project.metadata.id = 'folio-component-canvas';

    expect(() => createCanonicalEditorStore(createEditorState(project))).toThrow(
      'The temporary Component Canvas buffer cannot become the canonical Main Canvas project.',
    );
  });

  it('rejects replacement with the reserved buffer identity without changing state or revision', () => {
    const fixture = createFixture();
    const before = fixture.store.getSnapshot();
    const reservedProject = createInitialProject('Reserved buffer');
    reservedProject.metadata.id = 'folio-component-canvas';
    const candidate = editorReducer(before.editorState, {
      type: 'replace-project',
      project: reservedProject,
    });

    const result = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      expectedEditorState: before.editorState,
      candidateState: candidate,
    });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'INVALID_CANONICAL_PROJECT' });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });
});

describe('Native change event publication', () => {
  it('emits one scoped notification only after the command project is committed', () => {
    const fixture = createFixture();
    const events: Array<{ projectRevision: number; nodeX: number; event: unknown }> = [];
    fixture.store.subscribeChanges((event) => {
      events.push({
        projectRevision: fixture.store.getSnapshot().projectRevision,
        nodeX: currentNode(fixture.store)?.x ?? -1,
        event,
      });
    });
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 640 } }],
    });
    const result = executeNativeCommand(fixture.store, command, fixture.context);

    expect(result).toMatchObject({ status: 'applied', changed: true, projectRevisionBefore: 0, projectRevisionAfter: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].projectRevision).toBe(1);
    expect(events[0].nodeX).toBe(640);
    expect(events[0].event).toMatchObject({
      projectId: fixture.project.metadata.id,
      projectRevision: 1,
      commandId: command.commandId,
      change: {
        projectId: fixture.project.metadata.id,
        projectRevision: 1,
        commandIds: [command.commandId],
        documents: [{
          address: fixture.address,
          nodeIds: { added: [], updated: ['shared-node'], removed: [] },
        }],
      },
    });
  });
});

describe('Canonical commit conflict, failure and immutability', () => {
  it('rejects malformed full EditorState candidates on editor-only commits without mutating any live snapshot', () => {
    const fixture = createFixture();
    const before = fixture.store.getSnapshot();
    const invalidHistoryProject = { ...before.editorState.project, pages: [] };
    const invalidCandidates: unknown[] = [
      { ...before.editorState, selectedNodeId: 'missing-node', selectedNodeIds: ['missing-node'] },
      { ...before.editorState, selectedNodeId: 'shared-node', selectedNodeIds: [] },
      { ...before.editorState, selectedNodeId: null, selectedNodeIds: ['shared-node', 'shared-node'] },
      { ...before.editorState, past: new Array(61).fill(before.editorState.project) },
      {
        ...before.editorState,
        past: new Array(30).fill(before.editorState.project),
        future: new Array(31).fill(before.editorState.project),
      },
      { ...before.editorState, past: [invalidHistoryProject] },
      { ...before.editorState, future: [invalidHistoryProject] },
    ];

    for (const candidateState of invalidCandidates) {
      const rejected = fixture.store.commitEditorTransition({
        expectedProjectRevision: before.projectRevision,
        expectedEditorState: before.editorState,
        candidateState: candidateState as never,
      });
      expect(rejected).toMatchObject({ status: 'failed', errorCode: 'INVALID_EDITOR_STATE' });
      expect(fixture.store.getSnapshot()).toBe(before);
      expect(fixture.store.getSnapshot().editorState).toBe(before.editorState);
      expect(fixture.store.getSnapshot().editorState.project).toBe(before.editorState.project);
      expect(fixture.store.getSnapshot().editorState.past).toBe(before.editorState.past);
      expect(fixture.store.getSnapshot().editorState.future).toBe(before.editorState.future);
      expect(fixture.store.getSnapshot().projectRevision).toBe(before.projectRevision);
    }
  });

  it('accepts valid selection-only and history transitions under full EditorState validation', () => {
    const fixture = createFixture();
    expect(fixture.store.dispatchLegacyAction({ type: 'select-node', nodeId: 'shared-node' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
    expect(fixture.store.getSnapshot().editorState.selectedNodeId).toBe('shared-node');
    expect(fixture.store.getSnapshot().editorState.selectedNodeIds).toEqual(['shared-node']);

    expect(fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'Valid history snapshot' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(1);
    expect(fixture.store.dispatchLegacyAction({ type: 'undo' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().editorState.future).toHaveLength(1);
    expect(fixture.store.dispatchLegacyAction({ type: 'redo' }).status).toBe('committed');
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(1);
    expect(fixture.store.getSnapshot().editorState.future).toHaveLength(0);
    expect(fixture.store.getSnapshot().projectRevision).toBe(3);
  });

  it('rejects construction from an EditorState containing a malformed historical project', () => {
    const project = createInitialProject('Malformed history');
    const initial = createEditorState(project);
    const malformed = {
      ...initial,
      past: [{ ...initial.project, pages: [] }],
    };
    expect(() => createCanonicalEditorStore(malformed as never)).toThrow(
      'Cannot create the Main Canvas store from an invalid editor state.',
    );
  });

  it('rejects a prepared candidate after a selection-only editor transition without overwriting the latest snapshot', () => {
    const fixture = createFixture();
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 700 } }],
    }), fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected command preparation to succeed.');

    const beforeSelection = fixture.store.getSnapshot();
    fixture.store.dispatchLegacyAction({ type: 'select-node', nodeId: 'shared-node' });
    const selectedSnapshot = fixture.store.getSnapshot();
    expect(selectedSnapshot.projectRevision).toBe(beforeSelection.projectRevision);
    expect(selectedSnapshot.editorState.selectedNodeId).toBe('shared-node');

    const rejected = commitPreparedCommand(fixture.store, preparation);
    expect(rejected).toMatchObject({
      status: 'rejected',
      result: { code: 'EDITOR_STATE_CONFLICT', projectRevisionBefore: 0, projectRevisionAfter: 0 },
      currentProjectRevision: 0,
    });
    expect(rejected.status === 'rejected' ? rejected.currentState : null).toBe(selectedSnapshot.editorState);
    expect(fixture.store.getSnapshot()).toBe(selectedSnapshot);
    expect(selectedSnapshot.editorState.project).toBe(beforeSelection.editorState.project);
    expect(selectedSnapshot.editorState.past).toBe(beforeSelection.editorState.past);
    expect(selectedSnapshot.editorState.future).toBe(beforeSelection.editorState.future);
    expect(selectedSnapshot.editorState.historyGroup).toBe(beforeSelection.editorState.historyGroup);
  });

  it('rejects a prepared candidate after commit-edit changes only editor history state', () => {
    const fixture = createFixture();
    fixture.store.dispatchLegacyAction({
      type: 'edit-node',
      node: { ...currentNode(fixture.store)!, x: 44 },
      coalesceKey: 'component-inspector-edit',
    });
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 701 } }],
    }), fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected command preparation to succeed.');

    const beforeCommitEdit = fixture.store.getSnapshot();
    expect(beforeCommitEdit.editorState.historyGroup).toBe('component-inspector-edit');
    fixture.store.dispatchLegacyAction({ type: 'commit-edit' });
    const committedEditSnapshot = fixture.store.getSnapshot();
    expect(committedEditSnapshot.projectRevision).toBe(beforeCommitEdit.projectRevision);
    expect(committedEditSnapshot.editorState.historyGroup).toBeNull();
    expect(committedEditSnapshot.editorState.project).toBe(beforeCommitEdit.editorState.project);
    expect(committedEditSnapshot.editorState.past).toBe(beforeCommitEdit.editorState.past);
    expect(committedEditSnapshot.editorState.future).toBe(beforeCommitEdit.editorState.future);

    const rejected = commitPreparedCommand(fixture.store, preparation);
    expect(rejected).toMatchObject({ status: 'rejected', result: { code: 'EDITOR_STATE_CONFLICT' } });
    expect(rejected.status === 'rejected' ? rejected.currentState : null).toBe(committedEditSnapshot.editorState);
    expect(fixture.store.getSnapshot()).toBe(committedEditSnapshot);
    expect(currentNode(fixture.store)?.x).toBe(44);
  });

  it('freezes the prepared candidate and detaches command/event metadata from mutable input aliases', () => {
    const fixture = createFixture();
    const input = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 144, y: 233 } }],
    });
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), input, fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected command preparation to succeed.');
    const originalCommandId = preparation.commandId;
    const expectedAddress = { ...fixture.address, owner: { ...fixture.address.owner } };
    const candidateNode = getActiveDocument(preparation.candidateState.project).nodes[0];
    const events: unknown[] = [];
    fixture.store.subscribeChanges((event) => events.push(event));

    expect(Object.isFrozen(preparation)).toBe(true);
    expect(Object.isFrozen(preparation.candidateState)).toBe(true);
    expect(Object.isFrozen(preparation.candidateState.project)).toBe(true);
    expect(Object.isFrozen(candidateNode)).toBe(true);
    expect(() => { candidateNode.x = 999; }).toThrow();
    expect(() => { preparation.baseProjectRevision = 999; }).toThrow();
    const preparedTarget = preparation.command.target;
    if (preparedTarget.kind !== 'document') throw new Error('Expected an exact document target.');
    const mutablePreparedAddress = preparedTarget.address as any;
    const mutableDraftAddress = preparation.changeDraft.documents[0].address as any;
    expect(() => { mutablePreparedAddress.documentId = 'forged-document'; }).toThrow();
    expect(() => { mutableDraftAddress.documentId = 'forged-document'; }).toThrow();

    const mutableInput = input as any;
    mutableInput.commandId = nextCommandId();
    mutableInput.source.actor.actorId = 'attacker';
    mutableInput.target.address.documentId = 'forged-document';
    mutableInput.payload.nodes[0].transform.x = 999;

    const committed = commitPreparedCommand(fixture.store, preparation);
    expect(committed.status).toBe('applied');
    expect(currentNode(fixture.store)).toMatchObject({ x: 144, y: 233 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      commandId: originalCommandId,
      source: { actor: { actorId: 'tester' } },
      change: { documents: [{ address: expectedAddress }] },
    });
  });

  it('rejects a forged preparation and never commits its structurally valid unauthorized candidate', () => {
    const fixture = createFixture();
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 600 } }],
    }), fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected command preparation to succeed.');
    const before = fixture.store.getSnapshot();
    const forgedCandidate = {
      ...preparation.candidateState,
      project: {
        ...preparation.candidateState.project,
        pages: preparation.candidateState.project.pages.map((page) => ({
          ...page,
          document: {
            ...page.document,
            nodes: page.document.nodes.map((node) => node.id === 'shared-node' ? { ...node, x: 987 } : node),
          },
        })),
      },
    };
    const forgedPreparation = { ...preparation, candidateState: forgedCandidate } as typeof preparation;

    const rejected = commitPreparedCommand(fixture.store, forgedPreparation);
    expect(rejected).toMatchObject({ status: 'rejected', result: { code: 'INVALID_PREPARATION' } });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);

    const authenticCommit = commitPreparedCommand(fixture.store, preparation);
    expect(authenticCommit.status).toBe('applied');
    expect(currentNode(fixture.store)?.x).toBe(600);
  });

  it('rejects a prepared command when the project revision changes before commit', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 600 } }],
    });
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), command, fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected command preparation to succeed.');

    fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'Committed after preparation' });
    const latest = fixture.store.getSnapshot();
    const rejected = commitPreparedCommand(fixture.store, preparation);

    expect(rejected).toMatchObject({
      status: 'rejected',
      result: { code: 'REVISION_CONFLICT', projectRevisionBefore: 1, projectRevisionAfter: 1 },
      currentProjectRevision: 1,
    });
    expect(fixture.store.getSnapshot()).toBe(latest);
    expect(currentNode(fixture.store)?.x).toBe(10);
    expect(fixture.store.getSnapshot().editorState.past).toHaveLength(1);
  });

  it('preserves EditorState, past, future and revision after a failed candidate commit', () => {
    const fixture = createFixture();
    fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'History item' });
    fixture.store.dispatchLegacyAction({ type: 'undo' });
    const before = fixture.store.getSnapshot();
    const emittedEvents: unknown[] = [];
    fixture.store.subscribeChanges((event) => emittedEvents.push(event));
    const invalidProject = { ...before.editorState.project, pages: [] };
    const invalidCandidate = { ...before.editorState, project: invalidProject };

    const failed = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      expectedEditorState: before.editorState,
      candidateState: invalidCandidate,
    });

    expect(failed.status).toBe('failed');
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().editorState.past).toEqual(before.editorState.past);
    expect(fixture.store.getSnapshot().editorState.future).toEqual(before.editorState.future);
    expect(fixture.store.getSnapshot().projectRevision).toBe(before.projectRevision);
    expect(emittedEvents).toEqual([]);
  });

  it('rejects caller-supplied projectMutation classification instead of trusting it', () => {
    const fixture = createFixture();
    const before = fixture.store.getSnapshot();
    const changedState = editorReducer(before.editorState, { type: 'rename-project', name: 'New name' });
    const failed = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      expectedEditorState: before.editorState,
      candidateState: changedState,
      projectMutation: false,
    } as never);

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'INVALID_COMMIT_INPUT' });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });

  it('prevents retained project aliases from mutating initial and committed project data', () => {
    const project = createInitialProject('Alias protection');
    const initialState = createEditorState(project);
    const initialNode = getActiveDocument(initialState.project).nodes[0];
    const store = createCanonicalEditorStore(initialState);

    expect(Object.isFrozen(store.getSnapshot().editorState.project)).toBe(true);
    expect(() => { initialNode.x = 777; }).toThrow();

    const inserted = { ...createRectNode(), id: 'retained-inserted-node' };
    store.dispatchLegacyAction({ type: 'add-node', node: inserted });
    expect(Object.isFrozen(inserted)).toBe(true);
    expect(() => { inserted.x = 888; }).toThrow();
    expect(store.getSnapshot().projectRevision).toBe(1);
  });

  it('does not allow notification callbacks to commit re-entrantly', () => {
    const fixture = createFixture();
    let nestedStatus: string | undefined;
    fixture.store.subscribeChanges(() => {
      nestedStatus = fixture.store.dispatchLegacyAction({ type: 'rename-project', name: 'Reentrant write' }).status;
    });

    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 420 } }],
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(nestedStatus).toBe('failed');
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
    expect(fixture.store.getSnapshot().editorState.project.metadata.name).toBe('Native command project');
  });
});


describe('Strict runtime object validation', () => {
  function expectRejectedWithoutMutation(
    fixture: ReturnType<typeof createFixture>,
    input: unknown,
  ) {
    const before = fixture.store.getSnapshot();
    const events: unknown[] = [];
    const unsubscribe = fixture.store.subscribeChanges((event) => events.push(event));
    const result = executeNativeCommand(fixture.store, input, fixture.context);
    unsubscribe();

    expect(result.status).toBe('rejected');
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().editorState).toBe(before.editorState);
    expect(fixture.store.getSnapshot().editorState.project).toBe(before.editorState.project);
    expect(fixture.store.getSnapshot().editorState.past).toBe(before.editorState.past);
    expect(fixture.store.getSnapshot().editorState.future).toBe(before.editorState.future);
    expect(fixture.store.getSnapshot().projectRevision).toBe(before.projectRevision);
    expect(events).toEqual([]);
    return result;
  }

  it('rejects an envelope inheriting all command fields from another object', () => {
    const fixture = createFixture();
    const valid = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 700 } }],
    });
    const inheritedEnvelope = Object.create(valid) as unknown;

    expect(expectRejectedWithoutMutation(fixture, inheritedEnvelope)).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ENVELOPE',
    });
    expect(currentNode(fixture.store)?.x).toBe(10);
  });

  it('rejects inherited locked and layerColor properties instead of applying them', () => {
    const fixture = createFixture();
    const inheritedLocked = Object.create({ locked: true }) as Record<string, unknown>;
    const inheritedLayerColor = Object.create({ layerColor: '#ff00ff' }) as Record<string, unknown>;

    const lockedResult = expectRejectedWithoutMutation(fixture, makeCommand(
      'node.set-properties',
      fixture.address,
      { nodes: [nodeRef(fixture.address)], properties: inheritedLocked },
    ));
    const layerColorResult = expectRejectedWithoutMutation(fixture, makeCommand(
      'node.set-properties',
      fixture.address,
      { nodes: [nodeRef(fixture.address)], properties: inheritedLayerColor },
    ));

    expect(lockedResult.code).toBe('INVALID_ENVELOPE');
    expect(layerColorResult.code).toBe('INVALID_ENVELOPE');
    expect(currentNode(fixture.store)).toMatchObject({ locked: false });
    expect(currentNode(fixture.store)?.layerColor).toBeUndefined();
  });

  it('rejects accessors in source, target and payload without invoking getters', () => {
    const fixture = createFixture();
    let getterCalls = 0;

    const sourceAccessor = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 711 } }],
    });
    Object.defineProperty(sourceAccessor, 'source', {
      enumerable: true,
      configurable: true,
      get() { getterCalls += 1; return { workspace: 'main', actor: { kind: 'user', actorId: 'tester' } }; },
    });

    const targetAccessor = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 712 } }],
    });
    Object.defineProperty(targetAccessor.target as object, 'address', {
      enumerable: true,
      configurable: true,
      get() { getterCalls += 1; return fixture.address; },
    });

    const payloadAccessor = makeCommand('node.set-properties', fixture.address, {
      nodes: [nodeRef(fixture.address)],
      properties: { locked: true },
    });
    Object.defineProperty(payloadAccessor.payload as object, 'properties', {
      enumerable: true,
      configurable: true,
      get() { getterCalls += 1; return { locked: true }; },
    });

    for (const command of [sourceAccessor, targetAccessor, payloadAccessor]) {
      expect(expectRejectedWithoutMutation(fixture, command)).toMatchObject({
        status: 'rejected',
        code: 'INVALID_ENVELOPE',
      });
    }
    expect(getterCalls).toBe(0);
    expect(currentNode(fixture.store)).toMatchObject({ x: 10, locked: false });
  });

  it('rejects symbol keys and unexpected non-enumerable own properties', () => {
    const fixture = createFixture();
    const symbolKeyed = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 713 } }],
    });
    Object.defineProperty(symbolKeyed, Symbol('hidden-command-field'), {
      enumerable: true,
      value: true,
    });

    const nonEnumerable = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 714 } }],
    });
    Object.defineProperty(nonEnumerable, 'unapprovedHiddenField', {
      configurable: true,
      enumerable: false,
      value: true,
    });

    expect(expectRejectedWithoutMutation(fixture, symbolKeyed)).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ENVELOPE',
    });
    expect(expectRejectedWithoutMutation(fixture, nonEnumerable)).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ENVELOPE',
    });
    expect(currentNode(fixture.store)?.x).toBe(10);
  });

  it('rejects explicit undefined values even on otherwise optional fields', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 715 } }],
    }, {
      metadata: { description: undefined },
    });

    expect(expectRejectedWithoutMutation(fixture, command)).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ENVELOPE',
    });
  });

  it('converts Proxy reflection failures into structured rejection without changing editor state', () => {
    const fixture = createFixture();
    const valid = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 716 } }],
    });
    const hostileProxy = new Proxy(valid, {
      ownKeys() { throw new Error('blocked reflection'); },
    });

    expect(expectRejectedWithoutMutation(fixture, hostileProxy)).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ENVELOPE',
    });
    expect(currentNode(fixture.store)?.x).toBe(10);
  });

  it('normalizes omitted user actorId from the trusted principal in change attribution', () => {
    const fixture = createFixture();
    const command = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 717 } }],
    });
    delete (command.source as { actor: { actorId?: string } }).actor.actorId;
    const events: Array<{ source: { actor: { actorId?: string } } }> = [];
    fixture.store.subscribeChanges((event) => events.push(event as typeof events[number]));

    const result = executeNativeCommand(fixture.store, command, fixture.context);

    expect(result.status).toBe('applied');
    expect(events).toHaveLength(1);
    expect(events[0].source.actor.actorId).toBe('tester');
  });
});


describe('Prepared command originating-store ownership', () => {
  it('rejects Store A preparation in Store B even when both start from the same EditorState object', () => {
    const fixture = createFixture();
    const sharedInitialState = fixture.store.getSnapshot().editorState;
    const storeB = createCanonicalEditorStore(sharedInitialState);
    const beforeB = storeB.getSnapshot();
    const preparation = prepareNativeCommand(fixture.store.getSnapshot(), makeCommand(
      'node.transform',
      fixture.address,
      { nodes: [{ ref: nodeRef(fixture.address), transform: { x: 955 } }] },
    ), fixture.context);
    if (preparation.status !== 'prepared') throw new Error('Expected Store A preparation.');

    const crossStore = commitPreparedCommand(storeB, preparation);
    expect(crossStore).toMatchObject({ status: 'rejected', result: { code: 'STORE_OWNERSHIP_MISMATCH' } });
    expect(storeB.getSnapshot()).toBe(beforeB);
    expect(storeB.getSnapshot().projectRevision).toBe(0);
    expect(currentNode(storeB)?.x).toBe(10);

    const legitimate = commitPreparedCommand(fixture.store, preparation);
    expect(legitimate.status).toBe('applied');
    expect(currentNode(fixture.store)?.x).toBe(955);
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
  });
});

describe('Authorized immutable Native change publication', () => {
  it('rejects caller-authored event publication data without changing state', () => {
    const fixture = createFixture();
    const before = fixture.store.getSnapshot();
    expect((fixture.store as unknown as { publishChange?: unknown }).publishChange).toBeUndefined();

    const candidate = editorReducer(before.editorState, { type: 'rename-project', name: 'Unauthorized change' });
    const attempted = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      expectedEditorState: before.editorState,
      candidateState: candidate,
      changeDraft: {
        projectId: fixture.project.metadata.id,
        commandIds: [nextCommandId()],
        documents: [],
        components: [],
        projectMetadataChanged: true,
      },
      changeSource: { workspace: 'main', actor: { kind: 'user', actorId: 'tester' } },
    } as never);

    expect(attempted).toMatchObject({ status: 'failed', errorCode: 'INVALID_COMMIT_INPUT' });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);

    const forgedPreparation = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      expectedEditorState: before.editorState,
      candidateState: candidate,
      nativeCommandPreparation: {},
    });
    expect(forgedPreparation).toMatchObject({
      status: 'failed',
      errorCode: 'UNAUTHORIZED_EVENT_PUBLICATION',
    });
    expect(fixture.store.getSnapshot()).toBe(before);
  });

  it('freezes the complete event graph and isolates subscriber mutation and exceptions', () => {
    const fixture = createFixture();
    let blockedMutations = 0;
    let deliveredEvent: any;
    fixture.store.subscribeChanges((event) => {
      try { (event.change.documents[0].address as any).documentId = 'attacker-document'; }
      catch { blockedMutations += 1; }
      try { (event.change.documents[0].nodeIds.updated as any).push('attacker-node'); }
      catch { blockedMutations += 1; }
      try { (event.source.actor as any).actorId = 'attacker'; }
      catch { blockedMutations += 1; }
    });
    fixture.store.subscribeChanges(() => { throw new Error('subscriber failure'); });
    fixture.store.subscribeChanges((event) => { deliveredEvent = event; });

    const result = executeNativeCommand(fixture.store, makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 966 } }],
    }), fixture.context);

    expect(result.status).toBe('applied');
    expect(result.code).toBe('APPLIED');
    expect(fixture.store.getSnapshot().projectRevision).toBe(1);
    expect(currentNode(fixture.store)?.x).toBe(966);
    expect(blockedMutations).toBe(3);
    expect(deliveredEvent).toBeDefined();
    expect(Object.isFrozen(deliveredEvent)).toBe(true);
    expect(Object.isFrozen(deliveredEvent.change)).toBe(true);
    expect(Object.isFrozen(deliveredEvent.change.documents[0])).toBe(true);
    expect(Object.isFrozen(deliveredEvent.change.documents[0].address)).toBe(true);
    expect(Object.isFrozen(deliveredEvent.change.documents[0].nodeIds.updated)).toBe(true);
    expect(deliveredEvent.change.documents[0].address.documentId).toBe('document-main');
    expect(deliveredEvent.change.documents[0].nodeIds.updated).toEqual(['shared-node']);
    expect(deliveredEvent.source.actor.actorId).toBe('tester');
    expect(result.affectedDocuments[0].documentId).toBe('document-main');
    expect(result.affectedNodes[0].nodeId).toBe('shared-node');
  });
});

describe('Native command runtime resource budgets', () => {
  it('accepts nesting at the depth boundary and rejects one level beyond it', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = null;
      for (let index = 0; index < depth; index += 1) value = { child: value };
      return value;
    };
    expect(isRuntimeCommandDataWithinLimits(nested(NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth - 1))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(nested(NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(nested(NATIVE_COMMAND_RUNTIME_LIMITS.maxDepth + 1))).toBe(false);
  });


  it('checks every shared DAG path depth even when the shared subtree was memoized shallow-first', () => {
    const chain = (length: number, tail: unknown): unknown => {
      let value = tail;
      for (let index = 0; index < length; index += 1) value = { next: value };
      return value;
    };
    const sharedSubtree = chain(10, true);

    // Property insertion order makes the shallow path populate memoization first.
    const withinBoundary = {
      shallow: sharedSubtree,
      deep: chain(53, sharedSubtree),
    };
    const overBoundary = {
      shallow: sharedSubtree,
      deep: chain(54, sharedSubtree),
    };

    expect(isRuntimeCommandDataWithinLimits(withinBoundary)).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(overBoundary)).toBe(false);
  });

  it('accepts the object-node budget boundary and rejects the first object beyond it', () => {
    const graph = (children: number) => {
      const root = Object.create(null) as Record<string, unknown>;
      for (let index = 0; index < children; index += 1) root['node-' + index] = {};
      return root;
    };
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxObjects - 2))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxObjects - 1))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxObjects))).toBe(false);
  });

  it('accepts the aggregate property budget boundary and rejects one additional property', () => {
    const graph = (count: number) => {
      const value = Object.create(null) as Record<string, unknown>;
      for (let index = 0; index < count; index += 1) value['property-' + index] = null;
      return value;
    };
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties - 1))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(NATIVE_COMMAND_RUNTIME_LIMITS.maxProperties + 1))).toBe(false);
  });

  it('bounds aggregate array elements even when each individual array is valid', () => {
    const graph = (lastArrayLength: number) => {
      const value = Object.create(null) as Record<string, unknown>;
      [1000, 1000, 1000, 1000, lastArrayLength].forEach((length, index) => {
        value['array-' + index] = new Array(length).fill(null);
      });
      return value;
    };
    expect(isRuntimeCommandDataWithinLimits(graph(95))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(96))).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(graph(97))).toBe(false);
  });

  it('memoizes shared references without amplification while rejecting cycles, sparse arrays and Proxy failures', () => {
    const shared = { expensive: { leaf: true } };
    expect(isRuntimeCommandDataWithinLimits([shared, shared])).toBe(true);
    const fixture = createFixture();
    const sharedAddressCommand = makeCommand('node.transform', fixture.address, {
      nodes: [{ ref: nodeRef(fixture.address), transform: { x: 80 } }],
    });
    const normalized = validateNativeCommandEnvelope(sharedAddressCommand);
    expect(normalized.ok).toBe(true);
    if (normalized.ok && normalized.value.target.kind === 'document') {
      const payload = normalized.value.payload as { nodes: Array<{ ref: { document: DocumentAddress } }> };
      expect(normalized.value.target.address).toBe(payload.nodes[0].ref.document);
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(isRuntimeCommandDataWithinLimits(circular)).toBe(false);
    expect(isRuntimeCommandDataWithinLimits(new Array(2))).toBe(false);
    const hostileProxy = new Proxy({ value: true }, {
      ownKeys() { throw new Error('blocked reflection'); },
    });
    expect(isRuntimeCommandDataWithinLimits(hostileProxy)).toBe(false);
  });

  it('accepts null-prototype records and rejects arrays over the per-array bound', () => {
    const valid = makeCommand('node.transform', {
      projectId: 'project-id',
      owner: { kind: 'page', id: 'page-id' },
      documentId: 'document-id',
    }, { nodes: [] });
    const nullPrototypeEnvelope = Object.assign(Object.create(null), valid);
    expect(validateNativeCommandEnvelope(nullPrototypeEnvelope).ok).toBe(true);
    expect(isRuntimeCommandDataWithinLimits(new Array(NATIVE_COMMAND_RUNTIME_LIMITS.maxArrayLength + 1).fill(null))).toBe(false);
  });
});


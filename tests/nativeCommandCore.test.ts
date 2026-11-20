import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type { DocumentAddress, NativeNodeRef } from '../src/core/document/ast';
import type { NativeCommandContext } from '../src/core/commands/types';
import { validateNativeCommandEnvelope } from '../src/core/commands/validation';
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
    expect(executeNativeCommand(fixture.store, { ...valid, commandId: nextCommandId(), type: 'node.delete' }, fixture.context)).toMatchObject({
      status: 'rejected', code: 'UNKNOWN_COMMAND',
    });
    expect(executeNativeCommand(fixture.store, { ...valid, type: 'toString' }, fixture.context)).toMatchObject({
      status: 'rejected', code: 'UNKNOWN_COMMAND',
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

    expect(denied).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
    expect(wrongWorkspace).toMatchObject({ status: 'rejected', code: 'PERMISSION_DENIED' });
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
      candidateState: candidate,
    });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'INVALID_CANONICAL_PROJECT' });
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().projectRevision).toBe(0);
  });
});

describe('Canonical commit conflict, failure and immutability', () => {
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
    const invalidProject = { ...before.editorState.project, pages: [] };
    const invalidCandidate = { ...before.editorState, project: invalidProject };

    const failed = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
      candidateState: invalidCandidate,
    });

    expect(failed.status).toBe('failed');
    expect(fixture.store.getSnapshot()).toBe(before);
    expect(fixture.store.getSnapshot().editorState.past).toEqual(before.editorState.past);
    expect(fixture.store.getSnapshot().editorState.future).toEqual(before.editorState.future);
    expect(fixture.store.getSnapshot().projectRevision).toBe(before.projectRevision);
  });

  it('rejects caller-supplied projectMutation classification instead of trusting it', () => {
    const fixture = createFixture();
    const before = fixture.store.getSnapshot();
    const changedState = editorReducer(before.editorState, { type: 'rename-project', name: 'New name' });
    const failed = fixture.store.commitEditorTransition({
      expectedProjectRevision: before.projectRevision,
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

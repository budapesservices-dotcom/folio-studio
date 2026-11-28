import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProjectFile } from '../src/app/projectFileActions';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentDefinition, FolioDocument, FolioProject } from '../src/core/document/types';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState } from '../src/app/editorReducer';
import { setRevisionFencedAutosaveStatus } from '../src/app/debouncedAutosave';
import { createComponentCanvasSyncSession } from '../src/app/componentCanvasSync';
import {
  deleteComponentDurably,
  recoverAndDeleteComponentDurably,
  type ComponentProjectWriteLock,
} from '../src/app/componentDeletion';
import {
  loadMostRecentProject,
  loadProjectById,
  saveProject,
  saveProjectIfRevisionCurrent,
  saveProjectAndActivate,
  withProjectWriteLock,
} from '../src/core/persistence/indexedDb';

type FakeRequest<T> = {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

class FakeDatabase {
  version = 0;
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly metrics = {
    scheduledWrites: 0,
    committedWrites: 0,
    rolledBackWrites: 0,
    readwriteTransactions: 0,
  };
  private readonly keyPaths = new Map<string, string>();
  private readonly putFailures = new Map<string, DOMException>();
  private nextReadwriteCompletionGate: { notifyStarted: () => void; wait: Promise<void> } | null = null;
  private nextReadwriteCompletionEventGate: { notifyStarted: () => void; wait: Promise<void> } | null = null;
  private nextQuotaErrorEventGate: { notifyStarted: () => void; wait: Promise<void> } | null = null;

  holdNextQuotaErrorEvents(): { entered: Promise<void>; release: () => void } {
    if (this.nextQuotaErrorEventGate) {
      throw new Error('A QuotaExceededError event gate is already installed.');
    }

    let notifyEntered!: () => void;
    let releaseGate!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const wait = new Promise<void>((resolve) => { releaseGate = resolve; });
    this.nextQuotaErrorEventGate = { notifyStarted: notifyEntered, wait };
    return { entered, release: releaseGate };
  }

  private takeQuotaErrorEventGate() {
    const gate = this.nextQuotaErrorEventGate;
    this.nextQuotaErrorEventGate = null;
    return gate;
  }

  holdNextReadwriteCompletionEvent(): { entered: Promise<void>; release: () => void } {
    if (this.nextReadwriteCompletionEventGate) {
      throw new Error('A readwrite completion-event gate is already installed.');
    }

    let notifyEntered!: () => void;
    let releaseGate!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const wait = new Promise<void>((resolve) => { releaseGate = resolve; });
    this.nextReadwriteCompletionEventGate = { notifyStarted: notifyEntered, wait };
    return { entered, release: releaseGate };
  }

  private takeReadwriteCompletionEventGate() {
    const gate = this.nextReadwriteCompletionEventGate;
    this.nextReadwriteCompletionEventGate = null;
    return gate;
  }

  holdNextReadwriteCompletion(): { entered: Promise<void>; release: () => void } {
    if (this.nextReadwriteCompletionGate) {
      throw new Error('A readwrite transaction completion gate is already installed.');
    }

    let notifyEntered!: () => void;
    let releaseGate!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const wait = new Promise<void>((resolve) => { releaseGate = resolve; });
    this.nextReadwriteCompletionGate = { notifyStarted: notifyEntered, wait };
    return { entered, release: releaseGate };
  }

  private takeReadwriteCompletionGate() {
    const gate = this.nextReadwriteCompletionGate;
    this.nextReadwriteCompletionGate = null;
    return gate;
  }

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    this.stores.set(name, new Map());
    this.keyPaths.set(name, options.keyPath);
    return {};
  }

  transaction(_names: string | string[], mode: IDBTransactionMode): IDBTransaction {
    if (mode === 'readwrite') this.metrics.readwriteTransactions += 1;
    const completionGate = mode === 'readwrite' ? this.takeReadwriteCompletionGate() : null;
    const completionEventGate = mode === 'readwrite' ? this.takeReadwriteCompletionEventGate() : null;
    const quotaErrorEventGate = mode === 'readwrite' ? this.takeQuotaErrorEventGate() : null;
    return new FakeTransaction(
      this, mode, completionGate, completionEventGate, quotaErrorEventGate,
    ) as unknown as IDBTransaction;
  }

  keyPathFor(name: string): string {
    return this.keyPaths.get(name) ?? '';
  }

  failNextPutForStore(name: string, error = new DOMException(
    'Simulated IndexedDB write failure.',
    'QuotaExceededError',
  )): void {
    this.putFailures.set(name, error);
  }

  takePutFailure(name: string): DOMException | null {
    const error = this.putFailures.get(name) ?? null;
    this.putFailures.delete(name);
    return error;
  }

  recordWriteScheduled(): void {
    this.metrics.scheduledWrites += 1;
  }

  recordWriteCommitted(): void {
    this.metrics.committedWrites += 1;
  }

  recordWritesRolledBack(count: number): void {
    this.metrics.rolledBackWrites += count;
  }

  close(): void {}
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  error: DOMException | null = null;
  private pending = 0;
  private completionScheduled = false;
  private aborted = false;
  private committed = false;
  private readonly pendingWrites: Array<() => void> = [];

  constructor(
    private readonly database: FakeDatabase,
    private readonly mode: IDBTransactionMode,
    private completionGate: { notifyStarted: () => void; wait: Promise<void> } | null = null,
    private completionEventGate: { notifyStarted: () => void; wait: Promise<void> } | null = null,
    private quotaErrorEventGate: { notifyStarted: () => void; wait: Promise<void> } | null = null,
  ) {}

  objectStore(name: string) {
    const records = this.database.stores.get(name);
    if (!records) throw new Error('Missing fake object store: ' + name);

    return {
      put: (value: unknown) => this.request(() => {
        const failure = this.database.takePutFailure(name);
        if (failure) throw failure;

        const path = this.database.keyPathFor(name);
        const key = path.split('.').reduce<unknown>((current, part) =>
          typeof current === 'object' && current !== null
            ? (current as Record<string, unknown>)[part]
            : undefined, value);
        if (typeof key !== 'string') throw new Error('Fake IndexedDB record has no string key.');

        // IndexedDB writes are staged until transaction commit. A later request
        // error aborts the transaction and discards every staged operation.
        this.pendingWrites.push(() => records.set(key, structuredClone(value)));
        this.database.recordWriteScheduled();
        return key;
      }),
      get: (key: string) => this.request(() => {
        const value = records.get(key);
        return value === undefined ? undefined : structuredClone(value);
      }),
      getAll: () => this.request(() => [...records.values()].map((value) => structuredClone(value))),
      delete: (key: string) => this.request(() => {
        this.pendingWrites.push(() => records.delete(key));
        this.database.recordWriteScheduled();
        return undefined;
      }),
    };
  }

  abort(error = new DOMException('The transaction was aborted.', 'AbortError')): void {
    if (this.committed) {
      throw new DOMException('The transaction has already committed.', 'InvalidStateError');
    }
    if (this.aborted) return;
    this.aborted = true;
    this.error = error;
    this.database.recordWritesRolledBack(this.pendingWrites.length);
    this.pendingWrites.length = 0;

    const dispatchAbortEvents = () => {
      this.onerror?.call(this, new Event('error'));
      this.onabort?.call(this, new Event('abort'));
    };
    const errorGate = error.name === 'QuotaExceededError' ? this.quotaErrorEventGate : null;
    if (errorGate) {
      this.quotaErrorEventGate = null;
      // Abort and rollback have already happened. Only transaction event
      // delivery is held so the canonical revision can change first.
      errorGate.notifyStarted();
      void errorGate.wait.then(dispatchAbortEvents);
    } else {
      dispatchAbortEvents();
    }
  }

  private request<T>(operation: () => T): FakeRequest<T> {
    const request: FakeRequest<T> = {
      result: undefined as T,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    this.pending += 1;
    queueMicrotask(() => {
      try {
        if (this.aborted) return;

        request.result = operation();
        request.onsuccess?.call(request as unknown as FakeRequest<T>, new Event('success'));
      } catch (error) {
        request.error = error instanceof DOMException
          ? error
          : new DOMException(String(error), 'UnknownError');
        const event = new Event('error', { cancelable: true });
        request.onerror?.call(request as unknown as FakeRequest<T>, event);
        if (!event.defaultPrevented) this.abort(request.error);
      } finally {
        this.pending -= 1;
        this.completeWhenIdle();
      }
    });

    return request;
  }

  private completeWhenIdle(): void {
    if (this.aborted || this.pending > 0 || this.completionScheduled) return;

    this.completionScheduled = true;
    queueMicrotask(async () => {
      if (this.aborted || this.pending > 0) {
        this.completionScheduled = false;
        return;
      }

      const gate = this.completionGate;
      this.completionGate = null;
      if (this.mode === 'readwrite' && gate) {
        // Requests (including put staging) have completed, but no writes have
        // committed. The test can invalidate the canonical revision here.
        gate.notifyStarted();
        await gate.wait;
      }

      this.completionScheduled = false;
      if (this.aborted) return;
      if (this.pending > 0) {
        this.completeWhenIdle();
        return;
      }

      if (this.mode === 'readwrite') {
        const writes = this.pendingWrites.splice(0);
        writes.forEach((write) => {
          // Apply writes to the actual fake object store before signalling the
          // completion-event gate. This is the modeled durable-commit point.
          write();
          this.database.recordWriteCommitted();
        });
        this.committed = true;

        const completionEventGate = this.completionEventGate;
        this.completionEventGate = null;
        if (completionEventGate) {
          // The records are already durable; only transaction.oncomplete is
          // withheld. abort() must now behave as too-late / InvalidStateError.
          completionEventGate.notifyStarted();
          await completionEventGate.wait;
        }
      }
      this.oncomplete?.call(this, new Event('complete'));
    });
  }
}

class FakeIndexedDB {
  database: FakeDatabase | null = null;
  private nextOpenGate: { notifyStarted: () => void; wait: Promise<void> } | null = null;

  /** Hold the next open() completion until release() is called by the test. */
  holdNextOpen(): { entered: Promise<void>; release: () => void } {
    if (this.nextOpenGate) throw new Error('An IndexedDB open gate is already installed.');

    let notifyEntered!: () => void;
    let releaseGate!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const wait = new Promise<void>((resolve) => { releaseGate = resolve; });
    this.nextOpenGate = { notifyStarted: notifyEntered, wait };
    return { entered, release: releaseGate };
  }

  open(_name: string, version = 1): IDBOpenDBRequest {
    const request: {
      result?: FakeDatabase;
      error?: DOMException | null;
      onupgradeneeded?: ((event: IDBVersionChangeEvent) => void) | null;
      onsuccess?: ((event: Event) => void) | null;
      onerror?: ((event: Event) => void) | null;
      onblocked?: ((event: Event) => void) | null;
    } = {};
    queueMicrotask(async () => {
      const heldOpen = this.nextOpenGate;
      if (heldOpen) {
        this.nextOpenGate = null;
        heldOpen.notifyStarted();
        await heldOpen.wait;
      }

      const database = this.database ?? (this.database = new FakeDatabase());
      if (version > database.version) {
        const oldVersion = database.version;
        database.version = version;
        request.result = database;
        request.onupgradeneeded?.call(request as unknown as IDBOpenDBRequest, {
          oldVersion,
          newVersion: version,
        } as IDBVersionChangeEvent);
      }
      request.result = database;
      request.onsuccess?.call(request as unknown as IDBOpenDBRequest, new Event('success'));
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

function projectWithId(id: string, name: string, updatedAt: string): FolioProject {
  const project = createInitialProject(name);
  project.metadata = {
    ...project.metadata,
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
  return project;
}

function fileFromContent(content: string): File {
  return { text: async () => content } as File;
}

function fileFromProject(project: unknown): File {
  return fileFromContent(JSON.stringify(project));
}

let fakeIndexedDB: FakeIndexedDB;

beforeEach(() => {
  fakeIndexedDB = new FakeIndexedDB();
  vi.stubGlobal('indexedDB', fakeIndexedDB as unknown as IDBFactory);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistent active-project selection', () => {
  it('restores an older imported project after reload without changing its metadata or extensions', async () => {
    const projectA = projectWithId('project-a', 'Newer project A', '2026-11-19T12:00:00.000Z');
    const projectB = projectWithId('project-b', 'Imported project B', '2026-09-01T08:30:00.000Z');
    const imported = {
      ...projectB,
      futureProjectData: { keep: 'exactly' },
    } as FolioProject & Record<string, unknown>;
    const originalMetadata = structuredClone(imported.metadata);

    await saveProject(projectA);
    const opened = await openProjectFile(fileFromProject(imported), async (project) => {
      await saveProjectAndActivate(project);
    });

    expect(opened?.metadata).toEqual(originalMetadata);
    expect((opened as unknown as Record<string, unknown>).futureProjectData)
      .toEqual({ keep: 'exactly' });

    const restored = await loadMostRecentProject();
    expect(restored?.metadata.id).toBe('project-b');
    expect(restored?.metadata).toEqual(originalMetadata);
    expect((restored as unknown as Record<string, unknown>).futureProjectData)
      .toEqual({ keep: 'exactly' });
  });

  it('falls back to updatedAt ordering when the pointer is missing or invalid', async () => {
    const projectA = projectWithId('project-a', 'Newer project A', '2026-11-19T12:00:00.000Z');
    const projectB = projectWithId('project-b', 'Older project B', '2026-09-01T08:30:00.000Z');
    await saveProject(projectA);
    await saveProject(projectB);

    expect((await loadMostRecentProject())?.metadata.id).toBe('project-a');

    fakeIndexedDB.database?.stores.get('app-state')?.set('active-project', {
      key: 'active-project',
      projectId: 'project-that-does-not-exist',
    });
    expect((await loadMostRecentProject())?.metadata.id).toBe('project-a');
  });

  it('does not select the reserved Component Canvas record as a root project', async () => {
    const project = projectWithId('project-a', 'Root project', '2026-09-01T08:30:00.000Z');
    const componentCanvas = projectWithId(
      'folio-component-canvas',
      'Component Canvas',
      '2026-11-20T12:00:00.000Z',
    );
    await saveProject(project);
    await saveProject(componentCanvas);
    fakeIndexedDB.database?.stores.get('app-state')?.set('active-project', {
      key: 'active-project',
      projectId: 'folio-component-canvas',
    });

    expect((await loadMostRecentProject())?.metadata.id).toBe('project-a');
    await expect(saveProjectAndActivate(componentCanvas)).rejects.toThrow('cannot be activated');
  });

  it('leaves the previous active project and pointer intact when the import transaction aborts', async () => {
    const active = projectWithId('project-active', 'Active project', '2026-11-18T00:00:00.000Z');
    const imported = projectWithId('project-imported', 'Imported project', '2026-09-01T00:00:00.000Z');
    await saveProjectAndActivate(active);

    const database = fakeIndexedDB.database!;
    const metricsBefore = { ...database.metrics };
    database.failNextPutForStore('app-state');

    const replacement = vi.fn();
    const openAndActivate = async (project: FolioProject) => {
      await saveProjectAndActivate(project);
      replacement(project);
    };

    await expect(openProjectFile(fileFromProject(imported), openAndActivate))
      .rejects.toThrow('Simulated IndexedDB write failure.');

    expect(database.metrics.scheduledWrites - metricsBefore.scheduledWrites).toBe(1);
    expect(database.metrics.rolledBackWrites - metricsBefore.rolledBackWrites).toBe(1);
    expect(database.metrics.committedWrites - metricsBefore.committedWrites).toBe(0);
    expect(await loadProjectById(active.metadata.id)).toMatchObject({
      metadata: { id: active.metadata.id },
    });
    expect(await loadProjectById(imported.metadata.id)).toBeNull();
    expect(database.stores.get('app-state')?.get('active-project')).toEqual({
      key: 'active-project',
      projectId: active.metadata.id,
    });
    expect((await loadMostRecentProject())?.metadata.id).toBe(active.metadata.id);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('recovers from an older valid project when the pointed or newest record is corrupted', async () => {
    const olderValid = projectWithId('project-valid-older', 'Older Valid Backup', '2026-09-01T08:30:00.000Z');
    await saveProject(olderValid);

    fakeIndexedDB.database?.stores.get('projects')?.set('project-corrupted-newer', {
      id: 'project-corrupted-newer',
      updatedAt: '2026-11-22T12:00:00.000Z',
      project: { broken: true, pages: 'not-an-array' },
    });
    fakeIndexedDB.database?.stores.get('app-state')?.set('active-project', {
      key: 'active-project',
      projectId: 'project-corrupted-newer',
    });

    const recovered = await loadMostRecentProject();
    expect(recovered?.metadata.id).toBe('project-valid-older');
    expect(recovered?.metadata.name).toBe('Older Valid Backup');
  });
});


function createDurableComponentFixture(mainProjectId = 'durable-main') {
  const mainProject = projectWithId(mainProjectId, 'Durable Main', '2026-11-20T12:00:00.000Z');
  const masterDocument: FolioDocument = {
    ...mainProject.pages[0].document,
    id: 'durable-master-document',
    name: 'Durable Master',
    nodes: [{ ...createRectNode(), id: 'durable-master-node' }],
  };
  const master: ComponentDefinition = {
    id: 'durable-master',
    name: 'Durable Master',
    document: masterDocument,
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
  };
  mainProject.components = [master];
  const store = createCanonicalEditorStore(createEditorState(mainProject));
  const canonicalMaster = store.getSnapshot().editorState.project.components[0];
  const bufferDocument: FolioDocument = {
    ...masterDocument,
    nodes: masterDocument.nodes.map((node) => ({ ...node, x: node.x + 73 })),
  };
  const bufferProject = projectWithId('folio-component-canvas', 'Component Canvas', '2026-11-20T12:00:01.000Z');
  bufferProject.pages[0].document = { ...bufferDocument, id: 'durable-buffer-document' };
  const emptyBuffer = projectWithId('folio-component-canvas', 'Component Canvas', '2026-11-20T12:00:02.000Z');
  emptyBuffer.pages[0].document.nodes = [];
  emptyBuffer.pages[0].document.id = 'empty-buffer-document';
  const target = {
    componentId: canonicalMaster.id,
    expectedMasterDocument: canonicalMaster.document,
    expectedUpdatedAt: canonicalMaster.updatedAt,
  };
  const protection = {
    activeMaster: true,
    session: createComponentCanvasSyncSession(canonicalMaster),
    bufferDocument,
    recoveryPending: true,
  };
  const idFactory = (prefix: string) => 'durable-recovered-' + prefix;
  return { mainProject, store, master: canonicalMaster, bufferDocument, bufferProject, emptyBuffer, target, protection, idFactory };
}

describe('Component Canvas recovery with the real IndexedDB adapter', () => {
  it('keeps the original project and durable local buffer when recovery-copy transaction aborts', async () => {
    const fixture = createDurableComponentFixture();
    await saveProject(fixture.mainProject);
    await saveProject(fixture.bufferProject);
    fakeIndexedDB.database!.failNextPutForStore('projects');

    const result = await recoverAndDeleteComponentDurably(
      fixture.store, fixture.target, fixture.protection, fixture.bufferDocument,
      fixture.emptyBuffer, withProjectWriteLock, '2026-11-20T12:01:00.000Z', fixture.idFactory,
    );

    expect(result.status).toBe('recovery-persist-failed');
    const durableMain = await loadProjectById(fixture.mainProject.metadata.id);
    const durableBuffer = await loadProjectById('folio-component-canvas');
    expect(durableMain?.components.map((component) => component.id)).toEqual([fixture.master.id]);
    expect(durableBuffer?.pages[0].document.nodes[0].x).toBe(fixture.bufferDocument.nodes[0].x);
    expect(fixture.store.getSnapshot().editorState.project.components.map((component) => component.id))
      .toEqual([fixture.master.id]);
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
  });

  it('retains the durable recovery snapshot and dirty buffer when the final deletion transaction aborts', async () => {
    const fixture = createDurableComponentFixture();
    await saveProject(fixture.mainProject);
    await saveProject(fixture.bufferProject);

    const failSecondBarrier: ComponentProjectWriteLock = (operation) =>
      withProjectWriteLock(async (persist) => {
        let writes = 0;
        return operation(async (project, revision) => {
          writes += 1;
          if (writes === 2) fakeIndexedDB.database!.failNextPutForStore('projects');
          await persist(project, revision);
        });
      });

    const result = await recoverAndDeleteComponentDurably(
      fixture.store, fixture.target, fixture.protection, fixture.bufferDocument,
      fixture.emptyBuffer, failSecondBarrier, '2026-11-20T12:02:00.000Z', fixture.idFactory,
    );

    expect(result.status).toBe('deletion-persist-failed');
    const durableMain = await loadProjectById(fixture.mainProject.metadata.id);
    const durableBuffer = await loadProjectById('folio-component-canvas');
    expect(durableMain?.components).toHaveLength(2);
    expect(durableMain?.components.some((component) => component.id === fixture.master.id)).toBe(true);
    expect(durableMain?.components.some((component) => component.id === result.recoveryComponent?.id)).toBe(true);
    expect(durableBuffer?.pages[0].document.nodes[0].x).toBe(fixture.bufferDocument.nodes[0].x);
    expect(fixture.store.getSnapshot().editorState.project.components).toHaveLength(2);
    expect(fixture.store.getSnapshot().projectRevision).toBe(3);
  });

  it('keeps the local buffer durable when cleanup transaction fails after master deletion', async () => {
    const fixture = createDurableComponentFixture();
    await saveProject(fixture.mainProject);
    await saveProject(fixture.bufferProject);

    const failCleanup: ComponentProjectWriteLock = (operation) =>
      withProjectWriteLock(async (persist) => {
        let writes = 0;
        return operation(async (project, revision) => {
          writes += 1;
          if (writes === 3) fakeIndexedDB.database!.failNextPutForStore('projects');
          await persist(project, revision);
        });
      });

    const result = await recoverAndDeleteComponentDurably(
      fixture.store, fixture.target, fixture.protection, fixture.bufferDocument,
      fixture.emptyBuffer, failCleanup, '2026-11-20T12:03:00.000Z', fixture.idFactory,
    );

    expect(result.status).toBe('cleanup-persist-failed');
    const durableMain = await loadProjectById(fixture.mainProject.metadata.id);
    const durableBuffer = await loadProjectById('folio-component-canvas');
    expect(durableMain?.components).toHaveLength(1);
    expect(durableMain?.components[0].id).toBe(result.recoveryComponent?.id);
    expect(durableBuffer?.pages[0].document.nodes[0].x).toBe(fixture.bufferDocument.nodes[0].x);
    expect(fixture.store.getSnapshot().editorState.project.components).toHaveLength(1);
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
  });
});


describe('Main Canvas revision-fenced autosave', () => {
  it('rejects a queued deletion snapshot after failed persistence rolls canonical state back', async () => {
    const fixture = createDurableComponentFixture('main-autosave-rollback-fence');
    await saveProject(fixture.mainProject, 0);
    const database = fakeIndexedDB.database!;
    const writesBeforeDeletion = database.metrics.scheduledWrites;

    let enterControlledBarrier!: () => void;
    let releaseControlledBarrier!: () => void;
    const barrierEntered = new Promise<void>((resolve) => { enterControlledBarrier = resolve; });
    const barrierGate = new Promise<void>((resolve) => { releaseControlledBarrier = resolve; });
    let staleAutosave: Promise<Awaited<ReturnType<typeof saveProjectIfRevisionCurrent>>> | undefined;
    let staleAutosaveSettled = false;

    // The deletion operation owns the shared queue. Its failing transaction
    // queues the already-fired Main Canvas autosave behind the barrier, then
    // completes the monotonic in-memory rollback before the barrier is released.
    const controlledWriteBarrier: ComponentProjectWriteLock = (operation) =>
      withProjectWriteLock(async (persist) => {
        const result = await operation(async (project, revision) => {
          if (!staleAutosave) {
            expect(revision).toBe(1);
            staleAutosave = saveProjectIfRevisionCurrent(
              project,
              revision!,
              () => fixture.store.getSnapshot().projectRevision,
              (listener) => fixture.store.subscribe(listener),
            );
            void staleAutosave.then(() => { staleAutosaveSettled = true; });
            database.failNextPutForStore('projects');
          }
          await persist(project, revision);
        });

        enterControlledBarrier();
        await barrierGate;
        return result;
      });

    const deletionPromise = deleteComponentDurably(
      fixture.store,
      fixture.target,
      fixture.emptyBuffer,
      controlledWriteBarrier,
    );

    await barrierEntered;
    expect(fixture.store.getSnapshot().projectRevision).toBe(2);
    expect(fixture.store.getSnapshot().editorState.project.components.map((item) => item.id))
      .toEqual([fixture.master.id]);
    expect(staleAutosave).toBeDefined();
    expect(staleAutosaveSettled).toBe(false);

    releaseControlledBarrier();
    const deletion = await deletionPromise;
    expect(deletion.status).toBe('deletion-persist-failed');

    const staleResult = await staleAutosave!;
    expect(staleResult).toEqual({ status: 'stale' });
    expect(staleAutosaveSettled).toBe(true);

    // Neither the failed delete nor the stale queued snapshot reached durable storage.
    expect(database.metrics.scheduledWrites).toBe(writesBeforeDeletion);
    expect((await loadProjectById(fixture.mainProject.metadata.id))?.components.map((item) => item.id))
      .toEqual([fixture.master.id]);

    // The post-rollback canonical snapshot has a newer monotonic revision and
    // remains eligible for persistence.
    const latest = fixture.store.getSnapshot();
    const latestResult = await saveProjectIfRevisionCurrent(
      latest.editorState.project,
      latest.projectRevision,
      () => fixture.store.getSnapshot().projectRevision,
      (listener) => fixture.store.subscribe(listener),
    );
    expect(latestResult).toEqual({ status: 'saved' });
    expect(database.metrics.scheduledWrites).toBe(writesBeforeDeletion + 1);
    expect((await loadProjectById(fixture.mainProject.metadata.id))?.components.map((item) => item.id))
      .toEqual([fixture.master.id]);
  });

  it('rechecks canonical revision after indexedDB.open and before creating a readwrite transaction', async () => {
    const project = projectWithId(
      'main-autosave-pre-transaction-fence',
      'Durable revision R',
      '2026-11-20T12:30:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    const revisionR = store.getSnapshot().projectRevision;
    await saveProject(project, revisionR);

    const database = fakeIndexedDB.database!;
    const durableBefore = await loadProjectById(project.metadata.id);
    expect(durableBefore?.metadata.name).toBe('Durable revision R');
    const readwriteTransactionsBefore = database.metrics.readwriteTransactions;
    const scheduledPutsBefore = database.metrics.scheduledWrites;

    const openGate = fakeIndexedDB.holdNextOpen();
    const revisionReads: number[] = [];
    const getCanonicalRevision = () => {
      const revision = store.getSnapshot().projectRevision;
      revisionReads.push(revision);
      return revision;
    };
    const candidateAtR = store.getSnapshot().editorState.project;
    const pendingSave = saveProjectIfRevisionCurrent(
      candidateAtR,
      revisionR,
      getCanonicalRevision,
      (listener) => store.subscribe(listener),
    );

    try {
      // open() is invoked only after the queued operation's first revision
      // comparison has passed. Holding its completion puts the candidate
      // between the first check and the pre-transaction check.
      await openGate.entered;
      expect(revisionReads).toEqual([revisionR]);
      expect(store.getSnapshot().projectRevision).toBe(revisionR);

      const mutation = store.dispatchLegacyAction({
        type: 'rename-project',
        name: 'Canonical revision R+1',
      });
      expect(mutation.status).toBe('committed');
      expect(mutation.snapshot.projectRevision).toBe(revisionR + 1);

      openGate.release();
      const result = await pendingSave;

      // The second getter call occurs in persistProjectUnlocked after open()
      // resolves and rejects the now-stale candidate before transaction().
      expect(revisionReads).toEqual([revisionR, revisionR + 1]);
      expect(result).toEqual({ status: 'stale' });
      expect(database.metrics.readwriteTransactions).toBe(readwriteTransactionsBefore);
      expect(database.metrics.scheduledWrites).toBe(scheduledPutsBefore);
      expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Durable revision R');

      const latest = store.getSnapshot();
      const latestSave = await saveProjectIfRevisionCurrent(
        latest.editorState.project,
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );
      expect(latestSave).toEqual({ status: 'saved' });
      expect(database.metrics.readwriteTransactions).toBe(readwriteTransactionsBefore + 1);
      expect(database.metrics.scheduledWrites).toBe(scheduledPutsBefore + 1);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical revision R+1');
    } finally {
      // Idempotently release even if an earlier assertion fails so the fake
      // open() promise and shared write queue cannot leak into another test.
      openGate.release();
      await pendingSave.catch(() => undefined);
    }
  });

  it('aborts an in-flight Main Canvas transaction when the canonical revision changes', async () => {
    const project = projectWithId(
      'main-autosave-inflight-abort',
      'Durable revision R',
      '2026-11-20T12:40:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    const revisionR = store.getSnapshot().projectRevision;
    await saveProject(project, revisionR);

    const database = fakeIndexedDB.database!;
    const committedBefore = database.metrics.committedWrites;
    const rolledBackBefore = database.metrics.rolledBackWrites;
    const scheduledBefore = database.metrics.scheduledWrites;
    const readwriteBefore = database.metrics.readwriteTransactions;
    const completionGate = database.holdNextReadwriteCompletion();
    let pendingSave: Promise<Awaited<ReturnType<typeof saveProjectIfRevisionCurrent>>> | undefined;

    try {
      pendingSave = saveProjectIfRevisionCurrent(
        project,
        revisionR,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );

      // The readwrite transaction exists and its put request has been staged,
      // but the fake IndexedDB has not committed any staged write.
      await completionGate.entered;
      expect(database.metrics.readwriteTransactions).toBe(readwriteBefore + 1);
      expect(database.metrics.scheduledWrites).toBe(scheduledBefore + 1);
      expect(database.metrics.committedWrites).toBe(committedBefore);
      expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Durable revision R');

      const mutation = store.dispatchLegacyAction({
        type: 'rename-project',
        name: 'Canonical revision R+1',
      });
      expect(mutation.status).toBe('committed');
      expect(mutation.snapshot.projectRevision).toBe(revisionR + 1);

      // The subscription aborts the active transaction before its completion
      // gate is released, discarding the staged stale put.
      expect(database.metrics.rolledBackWrites).toBe(rolledBackBefore + 1);
      completionGate.release();
      const result = await pendingSave;
      expect(result).toEqual({ status: 'stale' });
      expect(database.metrics.committedWrites).toBe(committedBefore);
      expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Durable revision R');

      const latest = store.getSnapshot();
      const latestResult = await saveProjectIfRevisionCurrent(
        latest.editorState.project,
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );
      expect(latestResult).toEqual({ status: 'saved' });
      expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Canonical revision R+1');
    } finally {
      completionGate.release();
      await pendingSave?.catch(() => undefined);
    }
  });

  it('does not publish saved when revision changes after transaction completion but before the UI callback', async () => {
    const project = projectWithId(
      'main-autosave-late-ui-callback',
      'Durable revision R',
      '2026-11-20T12:45:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    const revisionR = store.getSnapshot().projectRevision;
    await saveProject(project, revisionR);

    let saveStatus: 'saving' | 'saved' | 'error' = 'saving';
    let enterUiCallback!: () => void;
    let releaseUiCallback!: () => void;
    const uiCallbackEntered = new Promise<void>((resolve) => { enterUiCallback = resolve; });
    const uiCallbackGate = new Promise<void>((resolve) => { releaseUiCallback = resolve; });

    const save = saveProjectIfRevisionCurrent(
      project,
      revisionR,
      () => store.getSnapshot().projectRevision,
      (listener) => store.subscribe(listener),
    );
    const lateUiCallback = save.then(async (result) => {
      enterUiCallback();
      await uiCallbackGate;
      if (result.status === 'saved') {
        setRevisionFencedAutosaveStatus(
          revisionR,
          () => store.getSnapshot().projectRevision,
          'saved',
          (status) => { saveStatus = status; },
        );
      }
    });

    try {
      await uiCallbackEntered;
      expect(await save).toEqual({ status: 'saved' });
      const mutation = store.dispatchLegacyAction({
        type: 'rename-project',
        name: 'Canonical revision R+1',
      });
      expect(mutation.status).toBe('committed');
      saveStatus = 'saving';
      releaseUiCallback();
      await lateUiCallback;
      expect(saveStatus).toBe('saving');
      expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Durable revision R');
    } finally {
      releaseUiCallback();
      await lateUiCallback.catch(() => undefined);
    }
  });

  it('preserves actual IndexedDB persistence errors instead of reporting revision staleness', async () => {
    const project = projectWithId(
      'main-autosave-persistence-error',
      'Durable before failure',
      '2026-11-20T12:50:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    const revision = store.getSnapshot().projectRevision;
    await saveProject(project, revision);
    fakeIndexedDB.database!.failNextPutForStore('projects');

    await expect(saveProjectIfRevisionCurrent(
      project,
      revision,
      () => store.getSnapshot().projectRevision,
      (listener) => store.subscribe(listener),
    )).rejects.toThrow('Simulated IndexedDB write failure.');

    expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Durable before failure');
  });

  it('preserves QuotaExceededError when canonical revision invalidates the already-aborted transaction', async () => {
    const project = projectWithId(
      'main-autosave-quota-revision-race',
      'Durable snapshot before quota failure',
      '2026-11-21T04:10:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    await saveProject(project, 0);

    const candidateMutation = store.dispatchLegacyAction({
      type: 'rename-project',
      name: 'Candidate revision R',
    });
    expect(candidateMutation.status).toBe('committed');
    const revisionR = candidateMutation.snapshot.projectRevision;
    const candidateR = candidateMutation.snapshot.editorState.project;

    const database = fakeIndexedDB.database!;
    const durableBefore = await loadProjectById(project.metadata.id);
    expect(durableBefore?.metadata.name).toBe('Durable snapshot before quota failure');
    const scheduledBefore = database.metrics.scheduledWrites;
    const committedBefore = database.metrics.committedWrites;
    const rolledBackBefore = database.metrics.rolledBackWrites;
    const readwriteBefore = database.metrics.readwriteTransactions;

    const quotaError = new DOMException(
      'Simulated quota exhaustion during Main Canvas autosave.',
      'QuotaExceededError',
    );
    database.failNextPutForStore('projects', quotaError);
    const quotaEventGate = database.holdNextQuotaErrorEvents();

    let saveStatus: 'saving' | 'saved' | 'error' = 'saving';
    const statusHistory: string[] = ['saving'];
    let pendingSave: Promise<Awaited<ReturnType<typeof saveProjectIfRevisionCurrent>>> | undefined;
    let errorCallbackOutcome: Promise<{ error: unknown; statusApplied: boolean }> | undefined;

    try {
      pendingSave = saveProjectIfRevisionCurrent(
        candidateR,
        revisionR,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );

      // The put request has thrown QuotaExceededError; the fake transaction is
      // already aborted and its staged writes rolled back, but event delivery
      // is held. This is not a successful/staged-only transaction.
      await quotaEventGate.entered;
      expect(database.metrics.readwriteTransactions).toBe(readwriteBefore + 1);
      expect(database.metrics.scheduledWrites).toBe(scheduledBefore);
      expect(database.metrics.committedWrites).toBe(committedBefore);
      expect(database.metrics.rolledBackWrites).toBe(rolledBackBefore);

      const currentDurableAfterQuota = await loadProjectById(project.metadata.id);
      expect(currentDurableAfterQuota?.metadata.name).toBe('Durable snapshot before quota failure');

      const nextMutation = store.dispatchLegacyAction({
        type: 'rename-project',
        name: 'Canonical revision R+1',
      });
      expect(nextMutation.status).toBe('committed');
      expect(nextMutation.snapshot.projectRevision).toBe(revisionR + 1);

      // Newer revision status is already active before the old transaction's
      // error callback is allowed to run.
      saveStatus = 'saving';
      statusHistory.push('saving');

      errorCallbackOutcome = pendingSave.then(
        () => ({ error: new Error('Expected autosave to reject with QuotaExceededError.'), statusApplied: false }),
        (error: unknown) => {
          const statusApplied = setRevisionFencedAutosaveStatus(
            revisionR,
            () => store.getSnapshot().projectRevision,
            'error',
            (status) => { saveStatus = status; statusHistory.push(status); },
          );
          return { error, statusApplied };
        },
      );

      quotaEventGate.release();
      const outcome = await errorCallbackOutcome;
      expect(outcome.error).toBe(quotaError);
      expect(outcome.error).toMatchObject({
        name: 'QuotaExceededError',
        message: 'Simulated quota exhaustion during Main Canvas autosave.',
      });
      expect(outcome.statusApplied).toBe(false);
      expect(saveStatus).toBe('saving');
      expect(statusHistory).toEqual(['saving', 'saving']);

      // A quota failure is a real persistence error, not a stale success. No
      // put was staged or committed and the previous durable project survived.
      expect(database.metrics.scheduledWrites).toBe(scheduledBefore);
      expect(database.metrics.committedWrites).toBe(committedBefore);
      expect(database.metrics.rolledBackWrites).toBe(rolledBackBefore);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Durable snapshot before quota failure');

      const latest = store.getSnapshot();
      const latestSave = await saveProjectIfRevisionCurrent(
        latest.editorState.project,
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );
      expect(latestSave).toEqual({ status: 'saved' });
      setRevisionFencedAutosaveStatus(
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        'saved',
        (status) => { saveStatus = status; statusHistory.push(status); },
      );
      expect(saveStatus).toBe('saved');
      expect(statusHistory).toEqual(['saving', 'saving', 'saved']);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical revision R+1');
    } finally {
      quotaEventGate.release();
      await pendingSave?.catch(() => undefined);
      await errorCallbackOutcome?.catch(() => undefined);
    }
  });

  it('returns stale when canonical revision changes after durable commit but before completion notification', async () => {
    const project = projectWithId(
      'main-autosave-post-commit-event-race',
      'Durable revision R-1',
      '2026-11-21T03:40:00.000Z',
    );
    const store = createCanonicalEditorStore(createEditorState(project));
    await saveProject(project, 0);

    const candidateMutation = store.dispatchLegacyAction({
      type: 'rename-project',
      name: 'Canonical candidate revision R',
    });
    expect(candidateMutation.status).toBe('committed');
    const revisionR = candidateMutation.snapshot.projectRevision;
    const candidateR = candidateMutation.snapshot.editorState.project;

    const database = fakeIndexedDB.database!;
    const scheduledBefore = database.metrics.scheduledWrites;
    const committedBefore = database.metrics.committedWrites;
    const rolledBackBefore = database.metrics.rolledBackWrites;
    const readwriteBefore = database.metrics.readwriteTransactions;
    const completionEventGate = database.holdNextReadwriteCompletionEvent();

    let saveStatus: 'saving' | 'saved' | 'error' = 'saving';
    const statusHistory: string[] = ['saving'];
    let notifyUiCallbackEntered!: () => void;
    let releaseUiCallback!: () => void;
    const uiCallbackEntered = new Promise<void>((resolve) => { notifyUiCallbackEntered = resolve; });
    const uiCallbackGate = new Promise<void>((resolve) => { releaseUiCallback = resolve; });
    let pendingSave: Promise<Awaited<ReturnType<typeof saveProjectIfRevisionCurrent>>> | undefined;

    try {
      pendingSave = saveProjectIfRevisionCurrent(
        candidateR,
        revisionR,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );

      // This gate fires only after put has executed AND its staged write has
      // been applied to the backing store. It withholds only oncomplete.
      await completionEventGate.entered;
      expect(database.metrics.readwriteTransactions).toBe(readwriteBefore + 1);
      expect(database.metrics.scheduledWrites).toBe(scheduledBefore + 1);
      expect(database.metrics.committedWrites).toBe(committedBefore + 1);
      expect(database.metrics.rolledBackWrites).toBe(rolledBackBefore);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical candidate revision R');

      const nextMutation = store.dispatchLegacyAction({
        type: 'rename-project',
        name: 'Canonical revision R+1',
      });
      expect(nextMutation.status).toBe('committed');
      expect(nextMutation.snapshot.projectRevision).toBe(revisionR + 1);

      // The persistence listener attempts invalidation, but the fake
      // transaction models a completed durable commit: abort cannot undo it.
      // The committed R record remains visible while oncomplete is withheld.
      expect(database.metrics.rolledBackWrites).toBe(rolledBackBefore);
      expect(database.metrics.committedWrites).toBe(committedBefore + 1);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical candidate revision R');

      // The new revision has already moved the UI to saving. A delayed callback
      // from revision R must not be able to announce that old snapshot as saved.
      saveStatus = 'saving';
      statusHistory.push('saving');
      const lateUiCallback = pendingSave.then(async (result) => {
        notifyUiCallbackEntered();
        await uiCallbackGate;
        if (result.status === 'saved') {
          setRevisionFencedAutosaveStatus(
            revisionR,
            () => store.getSnapshot().projectRevision,
            'saved',
            (status) => { saveStatus = status; statusHistory.push(status); },
          );
        }
      });

      completionEventGate.release();
      const resultR = await pendingSave;
      expect(resultR).toEqual({ status: 'stale' });
      await uiCallbackEntered;
      releaseUiCallback();
      await lateUiCallback;

      expect(saveStatus).toBe('saving');
      expect(statusHistory).toEqual(['saving', 'saving']);
      // The old committed snapshot was not retroactively rolled back; this is
      // the exact post-commit race that requires the final revision fence.
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical candidate revision R');

      const latest = store.getSnapshot();
      const resultR1 = await saveProjectIfRevisionCurrent(
        latest.editorState.project,
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        (listener) => store.subscribe(listener),
      );
      expect(resultR1).toEqual({ status: 'saved' });
      setRevisionFencedAutosaveStatus(
        latest.projectRevision,
        () => store.getSnapshot().projectRevision,
        'saved',
        (status) => { saveStatus = status; statusHistory.push(status); },
      );

      expect(saveStatus).toBe('saved');
      expect(statusHistory).toEqual(['saving', 'saving', 'saved']);
      expect(database.metrics.committedWrites).toBe(committedBefore + 2);
      expect((await loadProjectById(project.metadata.id))?.metadata.name)
        .toBe('Canonical revision R+1');
    } finally {
      completionEventGate.release();
      releaseUiCallback();
      await pendingSave?.catch(() => undefined);
    }
  });

  it('persists a Main Canvas candidate when its revision is still canonical', async () => {
    const project = projectWithId('main-autosave-current', 'Canonical snapshot', '2026-11-20T12:20:00.000Z');
    const store = createCanonicalEditorStore(createEditorState(project));
    const revision = store.getSnapshot().projectRevision;

    const result = await saveProjectIfRevisionCurrent(
      project,
      revision,
      () => store.getSnapshot().projectRevision,
      (listener) => store.subscribe(listener),
    );

    expect(result).toEqual({ status: 'saved' });
    expect((await loadProjectById(project.metadata.id))?.metadata.name).toBe('Canonical snapshot');
  });
});

describe('serialized IndexedDB write barriers', () => {
  it('waits for each transaction to complete and blocks stale autosaves between barrier writes', async () => {
    const initial = projectWithId('barrier-order-project', 'Before', '2026-11-20T12:00:00.000Z');
    const recovery = { ...initial, metadata: { ...initial.metadata, name: 'Recovery durable' } };
    const deletion = { ...initial, metadata: { ...initial.metadata, name: 'Deletion durable' } };
    await saveProject(initial, 0);

    let enterBarrier!: () => void;
    let releaseBarrierGate!: () => void;
    const entered = new Promise<void>((resolve) => { enterBarrier = resolve; });
    const gate = new Promise<void>((resolve) => { releaseBarrierGate = resolve; });
    let gateReleased = false;
    const releaseBarrier = () => {
      if (gateReleased) return;
      gateReleased = true;
      releaseBarrierGate();
    };

    let recoveryVisibleAfterTransactionCompletion = false;
    let staleSaveFinished = false;
    let staleSaveOutcome: Promise<
      | { status: 'fulfilled' }
      | { status: 'rejected'; error: unknown }
    > | undefined;

    const barrier = withProjectWriteLock(async (persist) => {
      await persist(recovery, 1);
      recoveryVisibleAfterTransactionCompletion =
        (await loadProjectById(initial.metadata.id))?.metadata.name === 'Recovery durable';
      enterBarrier();
      await gate;
      await persist(deletion, 2);
    });
    // Attach a rejection handler immediately so every exit path owns the
    // module-global queue operation until it has settled.
    const barrierOutcome = barrier.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    try {
      // If the first persist fails before enterBarrier(), observe that barrier
      // rejection instead of hanging forever on the unsignalled entered gate.
      const barrierStart = await Promise.race([
        entered.then(() => ({ kind: 'entered' as const })),
        barrierOutcome.then((outcome) => ({ kind: 'settled' as const, outcome })),
      ]);
      if (barrierStart.kind === 'settled') {
        if (barrierStart.outcome.status === 'rejected') throw barrierStart.outcome.error;
        throw new Error('Write barrier completed without emitting its entered signal.');
      }

      const staleSave = saveProject(initial, 0).then(() => { staleSaveFinished = true; });
      staleSaveOutcome = staleSave.then(
        () => ({ status: 'fulfilled' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );

      await Promise.resolve();
      expect(staleSaveFinished).toBe(false);
      expect(recoveryVisibleAfterTransactionCompletion).toBe(true);

      releaseBarrier();
      const completedBarrier = await barrierOutcome;
      expect(completedBarrier.status).toBe('fulfilled');
      const completedStaleSave = await staleSaveOutcome;
      expect(completedStaleSave.status).toBe('fulfilled');
      expect(staleSaveFinished).toBe(true);

      expect(recoveryVisibleAfterTransactionCompletion).toBe(true);
      expect((await loadProjectById(initial.metadata.id))?.metadata.name).toBe('Deletion durable');
    } finally {
      // Idempotent release and draining of every started queue operation keep
      // a failed assertion from leaking a pending promise into later tests.
      releaseBarrier();
      await barrierOutcome;
      if (staleSaveOutcome) await staleSaveOutcome;
    }
  });

  it('rejects an aborted barrier transaction and leaves the previous durable snapshot intact', async () => {
    const initial = projectWithId('barrier-failure-project', 'Durable before failure', '2026-11-20T12:10:00.000Z');
    const candidate = { ...initial, metadata: { ...initial.metadata, name: 'Must not be durable' } };
    await saveProject(initial);
    fakeIndexedDB.database!.failNextPutForStore('projects');

    await expect(withProjectWriteLock((persist) => persist(candidate, 1)))
      .rejects.toThrow('Simulated IndexedDB write failure.');
    expect((await loadProjectById(initial.metadata.id))?.metadata.name)
      .toBe('Durable before failure');
  });
});

describe('Component Canvas recovery with the real IndexedDB adapter', () => {
  it('persists the recovery copy before delete and persists an empty buffer only after deletion is durable', async () => {
    const fixture = createDurableComponentFixture();
    await saveProject(fixture.mainProject);
    await saveProject(fixture.bufferProject);

    let recoveryBarrierCompleted = false;
    const tracedWrite: ComponentProjectWriteLock = (operation) =>
      withProjectWriteLock(async (persist) => operation(async (project, revision) => {
        await persist(project, revision);
        if (project.metadata.id === fixture.mainProject.metadata.id &&
            project.components.some((item) => item.id === fixture.master.id) &&
            project.components.length === 2) {
          recoveryBarrierCompleted = true;
        }
        if (project.metadata.id === fixture.mainProject.metadata.id &&
            !project.components.some((item) => item.id === fixture.master.id)) {
          expect(recoveryBarrierCompleted).toBe(true);
        }
      }));

    const result = await recoverAndDeleteComponentDurably(
      fixture.store, fixture.target, fixture.protection, fixture.bufferDocument,
      fixture.emptyBuffer, tracedWrite, '2026-11-20T12:00:30.000Z', fixture.idFactory,
    );

    expect(result.status).toBe('deleted');
    expect(recoveryBarrierCompleted).toBe(true);
    const durableMain = await loadProjectById(fixture.mainProject.metadata.id);
    const durableBuffer = await loadProjectById('folio-component-canvas');
    expect(durableMain?.components).toHaveLength(1);
    expect(durableMain?.components[0].id).toBe(result.recoveryComponent?.id);
    expect(durableBuffer?.pages[0].document.nodes).toEqual([]);
  });
});

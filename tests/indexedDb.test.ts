import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProjectFile } from '../src/app/projectFileActions';
import { createInitialProject } from '../src/core/document/factory';
import type { FolioProject } from '../src/core/document/types';
import {
  loadMostRecentProject,
  loadProjectById,
  saveProject,
  saveProjectAndActivate,
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
  readonly metrics = { scheduledWrites: 0, committedWrites: 0, rolledBackWrites: 0 };
  private readonly keyPaths = new Map<string, string>();
  private readonly putFailures = new Map<string, DOMException>();

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    this.stores.set(name, new Map());
    this.keyPaths.set(name, options.keyPath);
    return {};
  }

  transaction(_names: string | string[], mode: IDBTransactionMode): IDBTransaction {
    return new FakeTransaction(this, mode) as unknown as IDBTransaction;
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
  private readonly pendingWrites: Array<() => void> = [];

  constructor(private readonly database: FakeDatabase, private readonly mode: IDBTransactionMode) {}

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
    if (this.aborted) return;
    this.aborted = true;
    this.error = error;
    this.database.recordWritesRolledBack(this.pendingWrites.length);
    this.pendingWrites.length = 0;
    this.onerror?.call(this, new Event('error'));
    this.onabort?.call(this, new Event('abort'));
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
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.aborted || this.pending > 0) return;

      if (this.mode === 'readwrite') {
        const writes = this.pendingWrites.splice(0);
        writes.forEach((write) => {
          write();
          this.database.recordWriteCommitted();
        });
      }
      this.oncomplete?.call(this, new Event('complete'));
    });
  }
}

class FakeIndexedDB {
  database: FakeDatabase | null = null;

  open(_name: string, version = 1): IDBOpenDBRequest {
    const request: {
      result?: FakeDatabase;
      error?: DOMException | null;
      onupgradeneeded?: ((event: IDBVersionChangeEvent) => void) | null;
      onsuccess?: ((event: Event) => void) | null;
      onerror?: ((event: Event) => void) | null;
      onblocked?: ((event: Event) => void) | null;
    } = {};
    queueMicrotask(() => {
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
});

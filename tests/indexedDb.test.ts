import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProjectFile } from '../src/app/projectFileActions';
import { createInitialProject } from '../src/core/document/factory';
import type { FolioProject } from '../src/core/document/types';
import {
  loadMostRecentProject,
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
  private readonly keyPaths = new Map<string, string>();

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

  close(): void {}
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  private pending = 0;
  private completionScheduled = false;
  private readonly writes: Array<() => void> = [];

  constructor(private readonly database: FakeDatabase, private readonly mode: IDBTransactionMode) {}

  objectStore(name: string) {
    const records = this.database.stores.get(name);
    if (!records) throw new Error('Missing fake object store: ' + name);

    return {
      put: (value: unknown) => this.request(() => {
        const path = this.database.keyPathFor(name);
        const key = path.split('.').reduce<unknown>((current, part) =>
          typeof current === 'object' && current !== null
            ? (current as Record<string, unknown>)[part]
            : undefined, value);
        if (typeof key !== 'string') throw new Error('Fake IndexedDB record has no string key.');
        this.writes.push(() => records.set(key, structuredClone(value)));
        return key;
      }),
      get: (key: string) => this.request(() => {
        const value = records.get(key);
        return value === undefined ? undefined : structuredClone(value);
      }),
      getAll: () => this.request(() => [...records.values()].map((value) => structuredClone(value))),
      delete: (key: string) => this.request(() => {
        this.writes.push(() => records.delete(key));
        return undefined;
      }),
    };
  }

  private request<T>(read: () => T): FakeRequest<T> {
    const request: FakeRequest<T> = {
      result: undefined as T,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.result = read();
        request.onsuccess?.call(request as unknown as FakeRequest<T>, new Event('success'));
      } catch (error) {
        request.error = error instanceof DOMException ? error : new DOMException(String(error));
        request.onerror?.call(request as unknown as FakeRequest<T>, new Event('error'));
        this.onabort?.call(this, new Event('abort'));
      } finally {
        this.pending -= 1;
        this.completeWhenIdle();
      }
    });
    return request;
  }

  private completeWhenIdle(): void {
    if (this.pending > 0 || this.completionScheduled) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.pending > 0) {
        this.completeWhenIdle();
        return;
      }
      if (this.mode === 'readwrite') this.writes.forEach((write) => write());
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

    // A fresh load represents a browser reload and a new IndexedDB connection.
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

  it('leaves the previous active project intact after cancellation, import failure or failed save', async () => {
    const active = projectWithId('project-active', 'Active project', '2026-11-18T00:00:00.000Z');
    await saveProjectAndActivate(active);
    const replaceProject = vi.fn(async (project: FolioProject) => {
      await saveProjectAndActivate(project);
    });

    await expect(openProjectFile(null, replaceProject)).resolves.toBeNull();
    await expect(openProjectFile(fileFromContent('{invalid json'), replaceProject))
      .rejects.toThrow('not valid JSON');
    expect(replaceProject).not.toHaveBeenCalled();

    const invalid = { ...projectWithId('project-invalid', 'Invalid', '2026-11-20T00:00:00.000Z'), pages: [] };
    await expect(saveProjectAndActivate(invalid as unknown as FolioProject)).rejects.toThrow();

    expect((await loadMostRecentProject())?.metadata.id).toBe('project-active');
  });
});

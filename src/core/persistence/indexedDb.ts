import type { FolioProject } from '../document/types';
import { migrateProjectToV2 } from '../document/migrations';
import { requireValidProject } from '../document/validation';

const DATABASE_NAME = 'folio-studio';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: 'metadata.id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the Folio database.'));
    request.onblocked = () => reject(new Error('The Folio database is blocked by another open tab.'));
  });
}

export async function saveProject(input: FolioProject): Promise<void> {
  const project = requireValidProject(input);
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readwrite');
      transaction.objectStore(PROJECT_STORE).put(project);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the project.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project save was cancelled.'));
    });
  } finally {
    database.close();
  }
}

export async function loadProjectById(projectId: string): Promise<FolioProject | null> {
  const database = await openDatabase();
  let stored: unknown;

  try {
    stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly');
      const request = transaction.objectStore(PROJECT_STORE).get(projectId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not load the requested project.'));
    });
  } finally {
    database.close();
  }

  if (stored === null) return null;
  const project = migrateProjectToV2(stored);
  if ((stored as { formatVersion?: unknown }).formatVersion !== project.formatVersion) {
    await saveProject(project);
  }
  return project;
}

export async function loadMostRecentProject(): Promise<FolioProject | null> {
  const database = await openDatabase();
  let storedProjects: unknown[];

  try {
    storedProjects = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly');
      const request = transaction.objectStore(PROJECT_STORE).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error('Could not load saved projects.'));
    });
  } finally {
    database.close();
  }

  const projects = storedProjects
    .filter((stored) => {
      if (typeof stored !== 'object' || stored === null) return false;
      const id = (stored as { metadata?: { id?: unknown } }).metadata?.id;
      return id !== 'folio-component-canvas';
    })
    .map((stored) => migrateProjectToV2(stored));

  // Persist v1 migrations back into the same IndexedDB records. The object
  // store keyPath remains metadata.id, so no database rebuild is required.
  const migrations = storedProjects
    .filter((stored) => typeof stored === 'object' && stored !== null)
    .filter((stored) => (stored as { formatVersion?: unknown }).formatVersion !== 2)
    .map((stored) => migrateProjectToV2(stored));
  await Promise.all(migrations.map((project) => saveProject(project)));

  projects.sort((a, b) => Date.parse(b.metadata.updatedAt) - Date.parse(a.metadata.updatedAt));
  return projects[0] ?? null;
}

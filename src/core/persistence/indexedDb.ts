import type { FolioProject } from '../document/types';

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

export async function saveProject(project: FolioProject): Promise<void> {
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
  try {
    return await new Promise<FolioProject | null>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly');
      const request = transaction.objectStore(PROJECT_STORE).get(projectId);
      request.onsuccess = () => resolve((request.result as FolioProject | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not load the requested project.'));
    });
  } finally {
    database.close();
  }
}

export async function loadMostRecentProject(): Promise<FolioProject | null> {
  const database = await openDatabase();

  try {
    return await new Promise<FolioProject | null>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readonly');
      const request = transaction.objectStore(PROJECT_STORE).getAll();
      request.onsuccess = () => {
        const projects = (request.result as FolioProject[]).filter(
          (project) => project.metadata.id !== 'folio-component-canvas',
        );
        projects.sort((a, b) => Date.parse(b.metadata.updatedAt) - Date.parse(a.metadata.updatedAt));
        resolve(projects[0] ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not load saved projects.'));
    });
  } finally {
    database.close();
  }
}

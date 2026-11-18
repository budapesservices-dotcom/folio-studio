import type { ComponentDefinition, FolioPage, FolioProject } from '../document/types';
import { createEmptyDocument } from '../document/factory';
import { getActiveDocument } from '../document/project';
import { migrateProjectToV2 } from '../document/migrations';
import { requireValidProject, validateProject } from '../document/validation';

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

function readLegacyWorkspacePages(): Array<{ id: string; name: string; route: string }> {
  try {
    const raw = window.localStorage.getItem('folio.pages');
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((page): page is { id: string; name: string; route: string } => {
      if (typeof page !== 'object' || page === null) return false;
      const item = page as Record<string, unknown>;
      return typeof item.id === 'string' && typeof item.name === 'string' &&
        typeof (item.path ?? item.route) === 'string';
    }).map((page) => {
      const item = page as unknown as Record<string, unknown>;
      return {
        id: String(item.id),
        name: String(item.name),
        route: String(item.path ?? item.route),
      };
    });
  } catch {
    return [];
  }
}

function readLegacyPageSnapshot(pageId: string): unknown | null {
  try {
    const raw = window.localStorage.getItem(`folio.page-project:${pageId}`);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch {
    return null;
  }
}

function migrateLegacyWorkspace(
  baseProject: FolioProject,
  legacyPageRecords: Array<{ id: string; metadata: { id: string }; project: FolioProject }>,
): FolioProject {
  let legacyPages = readLegacyWorkspacePages();
  if (legacyPages.length === 0) {
    legacyPages = legacyPageRecords.map(({ id, project }) => ({
      id: id.slice('folio-page-'.length),
      name: getActiveDocument(project).name,
      route: `/${getActiveDocument(project).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    }));
  }
  if (!legacyPages.some((page) => page.id === 'main')) {
    legacyPages.unshift({ id: 'main', name: 'Main Page', route: '/' });
  }

  const pageById = new Map(legacyPageRecords.map((record) => [record.id, record.project]));
  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();
  const pages: FolioPage[] = [];

  for (const legacyPage of legacyPages) {
    if (seenIds.has(legacyPage.id)) continue;
    let route = legacyPage.route.startsWith('/') ? legacyPage.route : `/${legacyPage.route}`;
    if (seenRoutes.has(route)) continue;

    const snapshot = readLegacyPageSnapshot(legacyPage.id);
    let sourceProject: FolioProject | null = null;
    if (snapshot) {
      try { sourceProject = migrateProjectToV2(snapshot); } catch { sourceProject = null; }
    }
    sourceProject ??= pageById.get(`folio-page-${legacyPage.id}`) ?? null;

    const sourceDocument = sourceProject
      ? getActiveDocument(sourceProject)
      : legacyPage.id === 'main'
        ? getActiveDocument(baseProject)
        : null;
    const pageDocument = sourceDocument
      ? { ...sourceDocument, name: legacyPage.name, nodes: sourceDocument.nodes.map((node) => ({ ...node })) }
      : { ...createEmptyDocument(legacyPage.name, getActiveDocument(baseProject).width, getActiveDocument(baseProject).height),
          background: getActiveDocument(baseProject).background };

    pages.push({
      id: legacyPage.id,
      name: legacyPage.name,
      route,
      document: pageDocument,
    });
    seenIds.add(legacyPage.id);
    seenRoutes.add(route);
  }

  if (pages.length === 0) pages.push(...baseProject.pages);
  const requestedActivePage = (() => {
    try { return window.localStorage.getItem('folio.active-page'); } catch { return null; }
  })();
  const activePageId = pages.some((page) => page.id === requestedActivePage)
    ? requestedActivePage as string
    : pages.some((page) => page.id === baseProject.activePageId)
      ? baseProject.activePageId
      : pages[0].id;

  const components: ComponentDefinition[] = [...baseProject.components];
  try {
    const raw = window.localStorage.getItem('folio.component-rack');
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const migrated: ComponentDefinition[] = [];
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        const legacy = item as Record<string, unknown>;
        if (typeof legacy.id !== 'string' || typeof legacy.name !== 'string' ||
            !Array.isArray(legacy.nodes) || legacy.nodes.length === 0) continue;
        const nodes = legacy.nodes as FolioProject['pages'][number]['document']['nodes'];
        const minX = Math.min(...nodes.map((node) => node.x));
        const minY = Math.min(...nodes.map((node) => node.y));
        const maxX = Math.max(...nodes.map((node) => node.x + node.width));
        const maxY = Math.max(...nodes.map((node) => node.y + node.height));
        const updatedAt = typeof legacy.updatedAt === 'string' ? legacy.updatedAt : new Date().toISOString();
        const candidate: ComponentDefinition = {
          id: legacy.id,
          name: legacy.name,
          document: {
            ...createEmptyDocument(legacy.name, Math.max(1, maxX - minX), Math.max(1, maxY - minY)),
            background: '#00000000',
            nodes: nodes.map((node) => ({ ...node, x: node.x - minX, y: node.y - minY })),
          },
          createdAt: updatedAt,
          updatedAt,
        };
        if (components.some((component) => component.id === candidate.id) ||
            migrated.some((component) => component.id === candidate.id)) continue;
        const candidateProject = {
          ...baseProject,
          activePageId,
          pages,
          components: [...components, ...migrated, candidate],
        };
        if (validateProject(candidateProject).ok) migrated.push(candidate);
      }
      components.push(...migrated);
    }
  } catch {
    // An invalid legacy rack is ignored; the project document remains usable.
  }

  let projectName = baseProject.metadata.name;
  try {
    projectName = window.localStorage.getItem('folio.project-name')?.trim() || projectName;
  } catch { /* use the name already stored in IndexedDB */ }

  return {
    ...baseProject,
    metadata: { ...baseProject.metadata, name: projectName },
    activePageId,
    pages,
    components,
  };
}

async function deleteLegacyPageProjects(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, 'readwrite');
      const store = transaction.objectStore(PROJECT_STORE);
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean up migrated page records.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Page record cleanup was cancelled.'));
    });
  } finally {
    database.close();
  }
}

function clearLegacyWorkspaceStorage(pageIds: string[]): void {
  try {
    window.localStorage.removeItem('folio.pages');
    window.localStorage.removeItem('folio.active-page');
    window.localStorage.removeItem('folio.component-rack');
    window.localStorage.removeItem('folio.project-name');
    pageIds.forEach((pageId) => window.localStorage.removeItem(`folio.page-project:${pageId}`));
  } catch {
    // The migrated project is already persisted; stale legacy keys are harmless.
  }
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

  const records = storedProjects.filter((stored) => {
    if (typeof stored !== 'object' || stored === null) return false;
    const id = (stored as { metadata?: { id?: unknown } }).metadata?.id;
    return typeof id === 'string' && id !== 'folio-component-canvas';
  });
  if (records.length === 0) return null;

  const rootRecords = records.filter((stored) => {
    const id = (stored as { metadata: { id: string } }).metadata.id;
    return !id.startsWith('folio-page-');
  });
  const candidates = rootRecords.length > 0 ? rootRecords : records;
  candidates.sort((a, b) => {
    const aDate = Date.parse((a as { metadata?: { updatedAt?: string } }).metadata?.updatedAt ?? '');
    const bDate = Date.parse((b as { metadata?: { updatedAt?: string } }).metadata?.updatedAt ?? '');
    return bDate - aDate;
  });

  const baseStored = candidates[0];
  let project = migrateProjectToV2(baseStored);
  const legacyPageRecords = records
    .filter((stored) => {
      const id = (stored as { metadata: { id: string } }).metadata.id;
      return id.startsWith('folio-page-') && id !== project.metadata.id;
    })
    .map((stored) => {
      const id = (stored as { metadata: { id: string } }).metadata.id;
      return { id, metadata: (stored as { metadata: { id: string } }).metadata, project: migrateProjectToV2(stored) };
    });

  const isLegacyProject = (baseStored as { formatVersion?: unknown }).formatVersion !== 2;
  const hasLegacySplitWorkspace = legacyPageRecords.length > 0 || (() => {
    try {
      return Boolean(window.localStorage.getItem('folio.pages') ||
        window.localStorage.getItem('folio.component-rack') ||
        window.localStorage.getItem('folio.page-project:main'));
    } catch { return false; }
  })();

  if (isLegacyProject || hasLegacySplitWorkspace) {
    const oldPageIds = [...new Set([
      ...readLegacyWorkspacePages().map((page) => page.id),
      ...legacyPageRecords.map((record) => record.id.slice('folio-page-'.length)),
    ])];
    project = migrateLegacyWorkspace(project, legacyPageRecords);
    await saveProject(project);
    try {
      await deleteLegacyPageProjects(legacyPageRecords.map((record) => record.id));
    } catch (error) {
      // The unified project is already safe; a cleanup failure must not abort hydration.
      console.warn('Folio could not remove stale legacy page records:', error);
    }
    clearLegacyWorkspaceStorage(oldPageIds.length > 0 ? oldPageIds : ['main', '404']);
  } else if ((baseStored as { formatVersion?: unknown }).formatVersion !== 2) {
    await saveProject(project);
  }

  return project;
}

import type { ComponentDefinition, FolioPage, FolioProject } from '../document/types';
import { createEmptyDocument } from '../document/factory';
import { getActiveDocument } from '../document/project';
import { migrateProjectToV2 } from '../document/migrations';
import { requireValidProject, validateProject } from '../document/validation';

const DATABASE_NAME = 'folio-studio';
const DATABASE_VERSION = 2;
const PROJECT_STORE = 'projects';
const APP_STATE_STORE = 'app-state';
const ACTIVE_PROJECT_RECORD_KEY = 'active-project';
const RESERVED_COMPONENT_PROJECT_ID = 'folio-component-canvas';

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
      if (!database.objectStoreNames.contains(APP_STATE_STORE)) {
        database.createObjectStore(APP_STATE_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the Folio database.'));
    request.onblocked = () => reject(new Error('The Folio database is blocked by another open tab.'));
  });
}

let projectWriteQueue: Promise<void> = Promise.resolve();
const persistedProjectRevisions = new Map<string, number>();

function enqueueProjectWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = projectWriteQueue.then(operation);
  projectWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

interface ProjectRevisionFence {
  isCurrent: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

async function persistProjectUnlocked(
  input: FolioProject,
  activate: boolean,
  revisionFence?: ProjectRevisionFence,
): Promise<boolean> {
  const project = requireValidProject(input);
  if (activate && project.metadata.id === RESERVED_COMPONENT_PROJECT_ID) {
    throw new Error('The Component Canvas workspace cannot be activated as a root project.');
  }

  const database = await openDatabase();
  let revisionInvalidated = false;
  let activeTransaction: IDBTransaction | null = null;
  let unsubscribe: () => void = () => undefined;

  const invalidateRevision = () => {
    if (revisionInvalidated) return;
    revisionInvalidated = true;
    try {
      activeTransaction?.abort();
    } catch {
      // A transaction that has already completed cannot be rolled back.
      // The post-transaction revision fence still prevents a false "saved".
    }
  };

  try {
    if (revisionFence) {
      // Subscribe before the post-open check. The active listener then remains
      // installed until the transaction settles, allowing revision changes to
      // abort a staged readwrite transaction rather than merely relabel it.
      unsubscribe = revisionFence.subscribe(() => {
        if (!revisionFence.isCurrent()) invalidateRevision();
      });
      if (!revisionFence.isCurrent()) {
        invalidateRevision();
        return false;
      }
    }

    await new Promise<void>((resolve, reject) => {
      const stores = activate ? [PROJECT_STORE, APP_STATE_STORE] : PROJECT_STORE;
      const transaction = database.transaction(stores, 'readwrite');
      activeTransaction = transaction;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        const error = transaction.error;
        // Ignore only the AbortError caused by our own revision invalidation.
        // A quota, I/O, or other real transaction failure remains an error,
        // even if a revision update happens around the same time.
        if (!(revisionInvalidated && (!error || error.name === 'AbortError'))) {
          reject(error ?? new Error('Could not save the project.'));
        }
      };
      transaction.onabort = () => {
        const error = transaction.error;
        if (revisionInvalidated && (!error || error.name === 'AbortError')) resolve();
        else reject(error ?? new Error('Project save was cancelled.'));
      };

      if (revisionInvalidated) {
        try { transaction.abort(); } catch { /* onabort / final fence decides the result. */ }
        return;
      }

      transaction.objectStore(PROJECT_STORE).put(project);
      if (activate) {
        transaction.objectStore(APP_STATE_STORE).put({
          key: ACTIVE_PROJECT_RECORD_KEY,
          projectId: project.metadata.id,
        });
      }
    });
    return !revisionInvalidated;
  } finally {
    unsubscribe();
    database.close();
  }
}

export function saveProject(input: FolioProject, projectRevision?: number): Promise<void> {
  const project = requireValidProject(input);
  return enqueueProjectWrite(async () => {
    const persistedRevision = persistedProjectRevisions.get(project.metadata.id);
    if (projectRevision !== undefined && persistedRevision !== undefined && projectRevision < persistedRevision) return;
    await persistProjectUnlocked(project, false);
    if (projectRevision !== undefined) {
      persistedProjectRevisions.set(project.metadata.id, Math.max(projectRevision, persistedRevision ?? projectRevision));
    }
  });
}

/**
 * Main Canvas autosaves are fenced at queue entry, after openDatabase(), while
 * the readwrite transaction is active, and once more after transaction
 * completion. A canonical revision notification aborts an in-flight write;
 * a change after transaction completion is reported as stale so the newer
 * canonical snapshot can be autosaved by its own effect.
 *
 * Component Canvas deliberately continues to use its independent saveProject
 * path and does not participate in the canonical Main Canvas revision fence.
 */
export interface RevisionFencedProjectSaveResult {
  readonly status: 'saved' | 'stale';
}

export function saveProjectIfRevisionCurrent(
  input: FolioProject,
  projectRevision: number,
  getCanonicalRevision: () => number,
  subscribeToCanonicalRevision: (listener: () => void) => () => void,
): Promise<RevisionFencedProjectSaveResult> {
  const project = requireValidProject(input);
  return enqueueProjectWrite(async () => {
    const persistedRevision = persistedProjectRevisions.get(project.metadata.id);
    const isCurrent = () => getCanonicalRevision() === projectRevision;
    if (!isCurrent() ||
        (persistedRevision !== undefined && projectRevision < persistedRevision)) {
      return { status: 'stale' };
    }

    const persisted = await persistProjectUnlocked(project, false, {
      isCurrent,
      subscribe: subscribeToCanonicalRevision,
    });
    // The transaction may have committed just before a newer revision was
    // published. Never return saved unless this final read still matches.
    if (!persisted || !isCurrent()) return { status: 'stale' };

    persistedProjectRevisions.set(
      project.metadata.id,
      Math.max(projectRevision, persistedRevision ?? projectRevision),
    );
    return { status: 'saved' };
  });
}

/** Serializes a multi-transaction barrier against every ordinary project save. */
export function withProjectWriteLock<T>(
  operation: (persist: (project: FolioProject, projectRevision?: number) => Promise<void>) => Promise<T>,
): Promise<T> {
  return enqueueProjectWrite(() => operation(async (input, projectRevision) => {
    const project = requireValidProject(input);
    const persistedRevision = persistedProjectRevisions.get(project.metadata.id);
    if (projectRevision !== undefined && persistedRevision !== undefined && projectRevision < persistedRevision) return;
    await persistProjectUnlocked(project, false);
    if (projectRevision !== undefined) {
      persistedProjectRevisions.set(project.metadata.id, Math.max(projectRevision, persistedRevision ?? projectRevision));
    }
  }));
}

/**
 * Persist a project and mark it active in the same IndexedDB transaction.
 * The pointer cannot commit unless the validated project record commits too.
 */
export function saveProjectAndActivate(input: FolioProject): Promise<void> {
  const project = requireValidProject(input);
  return enqueueProjectWrite(async () => {
    await persistProjectUnlocked(project, true);
    persistedProjectRevisions.delete(project.metadata.id);
  });
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
  let activePointer: unknown;

  try {
    const storedState = await new Promise<{ projects: unknown[]; activePointer: unknown }>((resolve, reject) => {
      const transaction = database.transaction([PROJECT_STORE, APP_STATE_STORE], 'readonly');
      const projectsRequest = transaction.objectStore(PROJECT_STORE).getAll();
      const activeRequest = transaction.objectStore(APP_STATE_STORE).get(ACTIVE_PROJECT_RECORD_KEY);
      let projects: unknown[] = [];
      let pointer: unknown;

      projectsRequest.onsuccess = () => { projects = projectsRequest.result as unknown[]; };
      activeRequest.onsuccess = () => { pointer = activeRequest.result; };
      transaction.oncomplete = () => resolve({ projects, activePointer: pointer });
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not load saved projects.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Project loading was cancelled.'));
    });
    storedProjects = storedState.projects;
    activePointer = storedState.activePointer;
  } finally {
    database.close();
  }

  const records = storedProjects.filter((stored) => {
    if (typeof stored !== 'object' || stored === null) return false;
    const id = (stored as { metadata?: { id?: unknown } }).metadata?.id;
    return typeof id === 'string' && id !== RESERVED_COMPONENT_PROJECT_ID;
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

  const activeProjectId = typeof activePointer === 'object' && activePointer !== null
    && typeof (activePointer as { projectId?: unknown }).projectId === 'string'
    ? (activePointer as { projectId: string }).projectId
    : null;
  const pointedProject = activeProjectId
    ? rootRecords.find((stored) => (stored as { metadata: { id: string } }).metadata.id === activeProjectId)
    : undefined;

  // Ignore dangling, malformed and reserved-workspace pointers. Fall back across
  // candidates in newest-first order so a single corrupted record never blocks
  // recovery of an older valid autosave.
  let baseStored: unknown | undefined;
  let project: FolioProject | null = null;
  const orderedCandidates = pointedProject
    ? [pointedProject, ...candidates.filter((item) => item !== pointedProject)]
    : candidates;
  for (const candidate of orderedCandidates) {
    try {
      project = migrateProjectToV2(candidate);
      baseStored = candidate;
      break;
    } catch {
      continue;
    }
  }
  if (!baseStored || !project) return null;

  const legacyPageRecords = records
    .filter((stored) => {
      const id = (stored as { metadata: { id: string } }).metadata.id;
      return id.startsWith('folio-page-') && id !== project!.metadata.id;
    })
    .flatMap((stored) => {
      const id = (stored as { metadata: { id: string } }).metadata.id;
      try {
        return [{ id, metadata: (stored as { metadata: { id: string } }).metadata, project: migrateProjectToV2(stored) }];
      } catch {
        return [];
      }
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

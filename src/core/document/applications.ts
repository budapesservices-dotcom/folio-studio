import { createEmptyDocument } from './factory';
import type {
  ComponentDefinition,
  ComponentScope,
  FolioApplication,
  FolioPage,
  FolioProject,
} from './types';

export const DEFAULT_APPLICATION_ID = 'app-main';
export const DEFAULT_APPLICATION_NAME = 'Main App';
export const DEFAULT_APPLICATION_SLUG = 'main-app';
export const DEFAULT_APPLICATION_BASE_PATH = '/';

export function createDefaultApplication(): FolioApplication {
  return {
    id: DEFAULT_APPLICATION_ID,
    name: DEFAULT_APPLICATION_NAME,
    slug: DEFAULT_APPLICATION_SLUG,
    basePath: DEFAULT_APPLICATION_BASE_PATH,
  };
}

export function slugifyApplicationName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'app';
}

/**
 * Returns the explicit application list for a project, synthesizing a single
 * default Main App when reading legacy `.flop` v2 projects without `applications`.
 */
export function getProjectApplications(project: FolioProject): readonly FolioApplication[] {
  if (Array.isArray(project.applications) && project.applications.length > 0) {
    return project.applications;
  }
  return [createDefaultApplication()];
}

export function getActiveApplicationId(project: FolioProject): string {
  const apps = getProjectApplications(project);
  if (project.activeApplicationId && apps.some((app) => app.id === project.activeApplicationId)) {
    return project.activeApplicationId;
  }
  const activePage = project.pages.find((page) => page.id === project.activePageId);
  if (activePage?.applicationId && apps.some((app) => app.id === activePage.applicationId)) {
    return activePage.applicationId;
  }
  return apps[0].id;
}

export function getActiveApplication(project: FolioProject): FolioApplication {
  const apps = getProjectApplications(project);
  const activeId = getActiveApplicationId(project);
  return apps.find((app) => app.id === activeId) ?? apps[0];
}

export function getPageApplicationId(project: FolioProject, page: FolioPage): string {
  const apps = getProjectApplications(project);
  if (page.applicationId && apps.some((app) => app.id === page.applicationId)) {
    return page.applicationId;
  }
  return apps[0].id;
}

export function getPagesForApplication(project: FolioProject, applicationId?: string): FolioPage[] {
  const targetAppId = applicationId ?? getActiveApplicationId(project);
  return project.pages.filter((page) => getPageApplicationId(project, page) === targetAppId);
}

/**
 * Returns the effective component scope (`'global'` by default for backward compatibility
 * with existing `.flop` v2 projects).
 */
export function getComponentScope(component: ComponentDefinition): ComponentScope {
  return component.scope === 'local' ? 'local' : 'global';
}

export function getComponentApplicationId(component: ComponentDefinition): string | null {
  if (getComponentScope(component) !== 'local') return null;
  return typeof component.applicationId === 'string' && component.applicationId.trim().length > 0
    ? component.applicationId
    : null;
}

/**
 * Global components are available in every application within the project.
 * Local components are scoped to their owning application.
 */
export function canUseComponentInApplication(
  component: ComponentDefinition,
  applicationId: string,
): boolean {
  if (getComponentScope(component) === 'global') return true;
  const ownerAppId = getComponentApplicationId(component);
  return ownerAppId === null || ownerAppId === applicationId;
}

export function getComponentsForApplication(
  project: FolioProject,
  applicationId?: string,
): ComponentDefinition[] {
  const targetAppId = applicationId ?? getActiveApplicationId(project);
  return project.components.filter((component) => canUseComponentInApplication(component, targetAppId));
}

export function createApplicationWithHomePage(
  project: FolioProject,
  rawName: string,
  options: { width?: number; height?: number; background?: string } = {},
): { readonly application: FolioApplication; readonly homePage: FolioPage } {
  const name = rawName.trim() || `App ${getProjectApplications(project).length + 1}`;
  const existingApps = getProjectApplications(project);
  const existingIds = new Set(existingApps.map((app) => app.id));
  const existingSlugs = new Set(existingApps.map((app) => app.slug));
  const existingRoutes = new Set(project.pages.map((page) => page.route));

  const baseSlug = slugifyApplicationName(name);
  let slug = baseSlug;
  let suffix = 2;
  while (existingSlugs.has(slug) || existingRoutes.has(`/${slug}`)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  let appId = `app-${slug}`;
  let idSuffix = 2;
  while (existingIds.has(appId)) {
    appId = `app-${slug}-${idSuffix}`;
    idSuffix += 1;
  }

  const basePath = `/${slug}`;
  const application: FolioApplication = {
    id: appId,
    name,
    slug,
    basePath,
  };

  const pageId = globalThis.crypto?.randomUUID?.() ?? `page-${slug}-${Date.now()}`;
  const width = options.width ?? 1280;
  const height = options.height ?? 800;
  const background = options.background ?? '#ffffff';
  const homePage: FolioPage = {
    id: pageId,
    name: `${name} Home`,
    route: basePath,
    applicationId: appId,
    document: {
      ...createEmptyDocument(`${name} Home`, width, height),
      background,
    },
  };

  return { application, homePage };
}

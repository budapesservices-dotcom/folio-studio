import type { FolioDocument, FolioPage, FolioProject } from './types';

export function getActivePage(project: FolioProject): FolioPage {
  return project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0];
}

export function getActiveDocument(project: FolioProject): FolioDocument {
  const page = getActivePage(project);
  if (!page) throw new Error('A Folio project must contain at least one page.');
  return page.document;
}

export function updateActiveDocument(project: FolioProject, document: FolioDocument): FolioProject {
  const activePage = getActivePage(project);
  if (!activePage) return project;
  return {
    ...project,
    pages: project.pages.map((page) =>
      page.id === activePage.id ? { ...page, document } : page,
    ),
  };
}

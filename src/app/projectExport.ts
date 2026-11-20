import { getActiveDocument } from '../core/document/project';
import { requireValidProject } from '../core/document/validation';
import type { FolioProject } from '../core/document/types';

/**
 * Build the exact project snapshot to export. While a master component is
 * open, its independent Canvas buffer is newer than the effect-synchronized
 * canonical definition, so overlay that document immutably for this export.
 */
export function createProjectExportSnapshot(
  project: FolioProject,
  editingComponentId: string | null,
  componentCanvasProject: FolioProject,
): FolioProject {
  if (!editingComponentId) return project;

  const editedDocument = getActiveDocument(componentCanvasProject);
  const componentExists = project.components.some((component) => component.id === editingComponentId);
  if (!componentExists) return project;

  const snapshot: FolioProject = {
    ...project,
    components: project.components.map((component) => component.id === editingComponentId
      ? { ...component, document: editedDocument }
      : component),
  };
  return requireValidProject(snapshot);
}

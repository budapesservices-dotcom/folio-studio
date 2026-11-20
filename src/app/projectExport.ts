import { getActiveDocument } from '../core/document/project';
import { requireValidProject } from '../core/document/validation';
import type { FolioDocument, FolioProject } from '../core/document/types';

function areDocumentsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => areDocumentsEqual(value, right[index]));
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false;
  }
  return leftKeys.every((key) => areDocumentsEqual(leftRecord[key], rightRecord[key]));
}

/**
 * Build the exact project snapshot to export. While a master component is
 * open, its independent Canvas buffer is newer than the effect-synchronized
 * canonical definition. Only a changed document produces modification
 * timestamps, shared by the edited component and the exported project.
 */
export function createProjectExportSnapshot(
  project: FolioProject,
  editingComponentId: string | null,
  componentCanvasProject: FolioProject,
): FolioProject {
  if (!editingComponentId) return project;

  const component = project.components.find((item) => item.id === editingComponentId);
  if (!component) return project;

  const editedDocument: FolioDocument = getActiveDocument(componentCanvasProject);
  if (areDocumentsEqual(component.document, editedDocument)) return project;

  const updatedAt = new Date().toISOString();
  const snapshot: FolioProject = {
    ...project,
    metadata: { ...project.metadata, updatedAt },
    components: project.components.map((item) => item.id === editingComponentId
      ? { ...item, document: editedDocument, updatedAt }
      : item),
  };
  return requireValidProject(snapshot);
}

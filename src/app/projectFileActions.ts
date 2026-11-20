import type { FolioProject } from '../core/document/types';
import { readProjectFile } from '../core/persistence/projectFile';

/**
 * Read and validate a native project before asking the editor to replace its
 * current project. The callback is unreachable on import failure or cancellation.
 */
export async function openProjectFile(
  file: File | null | undefined,
  replaceProject: (project: FolioProject) => void | Promise<void>,
): Promise<FolioProject | null> {
  if (!file) return null;

  const project = await readProjectFile(file);
  await replaceProject(project);
  return project;
}

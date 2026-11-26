import { createBlankProject } from '../core/document/factory';
import type { FolioProject } from '../core/document/types';

export type NewProjectActionMode = 'save' | 'delete';

export interface NewProjectSummary {
  readonly projectName: string;
  readonly pageCount: number;
  readonly layerCount: number;
  readonly componentCount: number;
}

export interface NewProjectExportResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface ExecuteNewProjectDependencies {
  readonly currentProject: FolioProject;
  readonly createProject?: (name?: string) => FolioProject;
  readonly exportCurrentProject: () => Promise<NewProjectExportResult>;
  readonly persistAndActivateProject: (project: FolioProject) => Promise<void>;
  readonly deleteStoredProject: (projectId: string) => Promise<void>;
  readonly replaceCanonicalProject: (project: FolioProject, description: string) => { status: string; message?: string };
  readonly resetWorkspaceAfterProjectSwitch: () => void;
}

export type NewProjectActionOutcome =
  | {
      readonly ok: true;
      readonly mode: NewProjectActionMode;
      readonly project: FolioProject;
      readonly previousProjectId: string;
      readonly previousProjectName: string;
      readonly notice: string;
      readonly warning?: string;
    }
  | {
      readonly ok: false;
      readonly mode: NewProjectActionMode;
      readonly stage: 'export' | 'persist' | 'replace';
      readonly error: string;
    };

export function summarizeProjectForNewProjectDialog(project: FolioProject): NewProjectSummary {
  const pageCount = project.pages.length;
  const layerCount = project.pages.reduce((total, page) => total + page.document.nodes.length, 0);
  const componentCount = project.components.length;
  return {
    projectName: project.metadata.name || 'Untitled project',
    pageCount,
    layerCount,
    componentCount,
  };
}

/**
 * Executes the verified File -> New Project workflow:
 * - `save`: exports the current project as `.flop` first. If export fails, aborts
 *   without modifying or deleting the active project.
 * - `delete`: persists and activates a fresh blank project, switches the canonical
 *   store, and deletes the previous project record from local storage.
 */
export async function executeNewProjectAction(
  mode: NewProjectActionMode,
  deps: ExecuteNewProjectDependencies,
): Promise<NewProjectActionOutcome> {
  const previousProjectId = deps.currentProject.metadata.id;
  const previousProjectName = deps.currentProject.metadata.name || 'Untitled project';

  if (mode === 'save') {
    let exportResult: NewProjectExportResult;
    try {
      exportResult = await deps.exportCurrentProject();
    } catch (error: unknown) {
      const detail = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to save the current project before starting a new one.';
      return { ok: false, mode, stage: 'export', error: detail };
    }
    if (!exportResult.ok) {
      return {
        ok: false,
        mode,
        stage: 'export',
        error: exportResult.error?.trim() || 'Unable to save the current project before starting a new one.',
      };
    }
  }

  const nextProject = (deps.createProject ?? createBlankProject)('Untitled project');

  try {
    await deps.persistAndActivateProject(nextProject);
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unable to initialize the new project in local storage.';
    return { ok: false, mode, stage: 'persist', error: detail };
  }

  const commandResult = deps.replaceCanonicalProject(nextProject, 'Create new project');
  if (commandResult.status === 'rejected') {
    return {
      ok: false,
      mode,
      stage: 'replace',
      error: commandResult.message?.trim() || 'Unable to switch the workspace to the new project.',
    };
  }

  deps.resetWorkspaceAfterProjectSwitch();

  let warning: string | undefined;
  if (mode === 'delete' && previousProjectId && previousProjectId !== nextProject.metadata.id) {
    try {
      await deps.deleteStoredProject(previousProjectId);
    } catch (error: unknown) {
      warning = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'The previous project record could not be removed from local storage.';
    }
  }

  const notice = mode === 'save'
    ? `Saved "${previousProjectName}.flop" and started a new project.`
    : warning
      ? `Started a new project. Note: ${warning}`
      : `Deleted "${previousProjectName}" and started a new project.`;

  return {
    ok: true,
    mode,
    project: nextProject,
    previousProjectId,
    previousProjectName,
    notice,
    ...(warning ? { warning } : {}),
  };
}

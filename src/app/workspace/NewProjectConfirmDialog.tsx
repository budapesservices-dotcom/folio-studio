import type { RefObject } from 'preact';
import type { NewProjectActionMode, NewProjectSummary } from '../newProjectFlow';
import { StudioIcon } from './StudioIcon';

export interface NewProjectConfirmDialogProps {
  open: boolean;
  summary: NewProjectSummary;
  busyMode: NewProjectActionMode | null;
  errorMessage: string | null;
  hostRef: RefObject<HTMLDivElement>;
  dialogRef: RefObject<HTMLElement>;
  onSaveAndCreateNew: () => void;
  onDeleteAndCreateNew: () => void;
  onCancel: () => void;
}

export function NewProjectConfirmDialog({
  open,
  summary,
  busyMode,
  errorMessage,
  hostRef,
  dialogRef,
  onSaveAndCreateNew,
  onDeleteAndCreateNew,
  onCancel,
}: NewProjectConfirmDialogProps) {
  if (!open) return null;

  const busy = busyMode !== null;
  const pageLabel = `${summary.pageCount} ${summary.pageCount === 1 ? 'page' : 'pages'}`;
  const layerLabel = `${summary.layerCount} ${summary.layerCount === 1 ? 'layer' : 'layers'}`;
  const componentLabel = summary.componentCount > 0
    ? ` · ${summary.componentCount} ${summary.componentCount === 1 ? 'component' : 'components'}`
    : '';

  return (
    <div class="new-project-modal-host" ref={hostRef}>
      <div
        class="new-project-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <section
        class="new-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
        aria-describedby="new-project-dialog-description"
        data-testid="new-project-confirm-dialog"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header class="new-project-dialog-header">
          <div class="new-project-dialog-title-row">
            <span class="new-project-dialog-icon" aria-hidden="true">
              <StudioIcon name="pages" />
            </span>
            <div>
              <h2 id="new-project-dialog-title">Start a New Project?</h2>
              <p class="new-project-dialog-meta">
                <span class="new-project-dialog-filename">{summary.projectName}.flop</span>
                <span> · {pageLabel} · {layerLabel}{componentLabel}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            class="new-project-dialog-close"
            aria-label="Close new project confirmation"
            onClick={onCancel}
            disabled={busy}
          >
            <StudioIcon name="close" />
          </button>
        </header>

        <p id="new-project-dialog-description" class="new-project-dialog-description">
          Creating a new blank project will replace “{summary.projectName}” in this workspace.
          Choose whether to save a <code>.flop</code> backup first, delete the current project and start fresh, or cancel.
        </p>

        {errorMessage && (
          <div class="new-project-dialog-error" role="alert" aria-live="assertive">
            {errorMessage}
          </div>
        )}

        <div class="new-project-dialog-actions" role="group" aria-label="New project confirmation actions">
          <button
            type="button"
            class="new-project-action new-project-action-primary"
            data-testid="new-project-save-btn"
            onClick={onSaveAndCreateNew}
            disabled={busy}
          >
            <span class="new-project-action-head">
              <StudioIcon name="save" />
              <span class="new-project-action-label">
                {busyMode === 'save' ? 'Saving backup & creating project…' : 'Save & New Project'}
              </span>
            </span>
            <span class="new-project-action-hint">
              Download “{summary.projectName}.flop” first, then open a blank canvas.
            </span>
          </button>

          <button
            type="button"
            class="new-project-action new-project-action-danger"
            data-testid="new-project-delete-btn"
            onClick={onDeleteAndCreateNew}
            disabled={busy}
          >
            <span class="new-project-action-head">
              <StudioIcon name="trash" />
              <span class="new-project-action-label">
                {busyMode === 'delete' ? 'Deleting & creating project…' : 'Delete & Start New'}
              </span>
            </span>
            <span class="new-project-action-hint">
              Remove the current project from local storage without saving and start blank.
            </span>
          </button>

          <button
            type="button"
            class="new-project-action new-project-action-cancel"
            data-testid="new-project-cancel-btn"
            data-dialog-initial-focus
            onClick={onCancel}
            disabled={busy}
          >
            <span class="new-project-action-head">
              <StudioIcon name="close" />
              <span class="new-project-action-label">Cancel</span>
            </span>
            <span class="new-project-action-hint">
              Keep working on “{summary.projectName}”.
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

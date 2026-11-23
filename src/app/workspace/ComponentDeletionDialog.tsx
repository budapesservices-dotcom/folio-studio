import type { RefObject } from 'preact';
import type { ComponentDefinition } from '../../core/document/types';
import type { ComponentDeletionMode } from './useComponentMasterLifecycle';

export interface ComponentDeletionDialogProps {
  open: boolean;
  pendingComponent: ComponentDefinition | null;
  mode: ComponentDeletionMode;
  busy: boolean;
  cleanupPending: boolean;
  durableRecoveryComponentId: string | null;
  componentSaveStatus: 'saving' | 'saved' | 'error';
  hostRef: RefObject<HTMLDivElement>;
  dialogRef: RefObject<HTMLElement>;
  onCancel: () => void;
  onSaveBufferAsNewAndDelete: () => void;
  onDiscardBufferAndDelete: () => void;
  onRetryCleanup: () => void;
  onRetryComponentSave: () => void;
}

export function ComponentDeletionDialog({
  open,
  pendingComponent,
  mode,
  busy,
  cleanupPending,
  durableRecoveryComponentId,
  componentSaveStatus,
  hostRef,
  dialogRef,
  onCancel,
  onSaveBufferAsNewAndDelete,
  onDiscardBufferAndDelete,
  onRetryCleanup,
  onRetryComponentSave,
}: ComponentDeletionDialogProps) {
  if (!open || !pendingComponent) return null;

  return (
    <div class="component-deletion-modal-host" ref={hostRef}>
      <div class="component-deletion-backdrop" aria-hidden="true" />
      <section
        class="component-deletion-dialog"
        key={mode}
        role="dialog"
        aria-modal="true"
        aria-labelledby="component-delete-recovery-title"
        aria-describedby="component-delete-recovery-description"
        tabIndex={-1}
        ref={dialogRef}
      >
        {mode === 'clean' ? (
          <>
            <h2 id="component-delete-recovery-title">Deleting “{pendingComponent.name}”</h2>
            <p id="component-delete-recovery-description">
              The clean master deletion is being committed and saved to IndexedDB. The Component Canvas buffer will only be cleared after both the project and buffer cleanup transactions complete.
            </p>
            <div class="component-deletion-progress" role="status" aria-live="polite">
              Saving canonical project and buffer cleanup…
            </div>
          </>
        ) : cleanupPending ? (
          <>
            <h2 id="component-delete-recovery-title">Deletion saved; buffer cleanup pending</h2>
            <p id="component-delete-recovery-description">
              The master deletion and any recovery copy are durable. The local Component Canvas buffer has not been cleared because its cleanup transaction failed. Your buffer remains preserved.
            </p>
            <button
              type="button"
              class="component-recovery-action component-recovery-action-primary"
              data-dialog-initial-focus
              onClick={onRetryCleanup}
              disabled={busy}
            >
              {busy ? 'Saving cleanup…' : 'Retry durable cleanup'}
            </button>
            <p>
              Keep this dialog open until cleanup succeeds. Your protected buffer remains durable and will not be removed on failure.
            </p>
          </>
        ) : mode === 'recovery' && durableRecoveryComponentId ? (
          <>
            <h2 id="component-delete-recovery-title">Recovery copy saved; deletion needs retry</h2>
            <p id="component-delete-recovery-description">
              The recovery copy is already durable. The original master and local buffer were preserved after deletion persistence failed. Retry the second canonical commit without creating another recovery copy.
            </p>
            <button
              type="button"
              class="component-recovery-action component-recovery-action-primary"
              data-dialog-initial-focus
              onClick={onSaveBufferAsNewAndDelete}
              disabled={busy}
            >
              {busy ? 'Retrying deletion…' : 'Retry deletion using saved recovery'}
            </button>
            <button
              type="button"
              class="component-recovery-action"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel and keep both
            </button>
          </>
        ) : (
          <>
            <h2 id="component-delete-recovery-title">Delete “{pendingComponent.name}” master?</h2>
            <p id="component-delete-recovery-description">
              The active Component Canvas buffer is protected by local edits or recovery state. Choose how to continue. No deletion happens until you choose an action.
            </p>
            <button
              type="button"
              class="component-recovery-action"
              data-dialog-initial-focus
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              class="component-recovery-action component-recovery-action-primary"
              onClick={onSaveBufferAsNewAndDelete}
              disabled={busy}
            >
              {busy ? 'Saving recovery…' : 'Save buffer as a new component'}
            </button>
            <button
              type="button"
              class="component-recovery-action component-recovery-action-danger"
              onClick={onDiscardBufferAndDelete}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Discard buffer and delete'}
            </button>
          </>
        )}
        {componentSaveStatus === 'error' && !cleanupPending && mode !== 'clean' && (
          <button type="button" class="component-recovery-action" onClick={onRetryComponentSave}>
            Retry Component Canvas buffer save
          </button>
        )}
      </section>
    </div>
  );
}

export function ProjectHydrationOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div class="project-hydration-overlay" role="status" aria-live="polite">
      <div class="project-hydration-indicator" />
      <strong>RESTORING PROJECT</strong>
      <span>Loading your pages and component library from local storage</span>
    </div>
  );
}

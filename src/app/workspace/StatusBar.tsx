export interface StatusBarProps {
  layerCount: number;
  documentWidth: number;
  documentHeight: number;
  isHydrating: boolean;
  saveStatus: 'loading' | 'saving' | 'saved' | 'error';
  componentSaveStatus: 'saving' | 'saved' | 'error';
  componentSaveError: string | null;
  componentCleanupPending: boolean;
  onRetryComponentSave: () => void;
  onRetryComponentCleanup: () => void;
}

export function StatusBar({
  layerCount,
  documentWidth,
  documentHeight,
  isHydrating,
  saveStatus,
  componentSaveStatus,
  componentSaveError,
  componentCleanupPending,
  onRetryComponentSave,
  onRetryComponentCleanup,
}: StatusBarProps) {
  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <footer class="statusbar">
      <div class="status-left">
        <span class="status-brand">F</span>
        <span>Folio Studio <b>0.1.0</b></span>
      </div>
      <div class="status-center">
        {layerCount} LAYERS <span>·</span> {documentWidth} × {documentHeight} PX
      </div>
      <div class={`status-right save-${saveStatus}`} role="status" aria-live="polite">
        <span class="status-ready-dot" /> {isHydrating ? 'RESTORING PROJECT…' : statusLabel}
      </div>
      <div class={`component-buffer-save component-save-${componentSaveStatus}`}>
        <span role="status" aria-live="polite" aria-atomic="true">
          Component Canvas: {componentSaveStatus === 'saving' ? 'Saving…' : componentSaveStatus === 'saved' ? 'Saved' : 'Save error'}
          {componentSaveError && <span class="component-buffer-save-error"> — {componentSaveError}</span>}
        </span>
        {componentSaveStatus === 'error' && (
          <button type="button" onClick={onRetryComponentSave}>Retry buffer save</button>
        )}
        {componentCleanupPending && (
          <button type="button" onClick={onRetryComponentCleanup}>Retry buffer cleanup</button>
        )}
      </div>
    </footer>
  );
}

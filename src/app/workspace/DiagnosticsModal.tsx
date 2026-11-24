import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FolioProject } from '../../core/document/types';
import {
  analyzeProjectHealth,
  runLiveSceneProfile,
  type LiveSceneProfileResult,
} from '../../engines/diagnostics/studioProfiler';
import { activateModalDialog, trapModalDialogKeydown } from '../modalFocus';

export interface DiagnosticsModalProps {
  open: boolean;
  project: FolioProject;
  activePageId: string;
  historyUndoCount: number;
  historyRedoCount: number;
  onOpenCodeStudio: () => void;
  onClose: () => void;
}

export default function DiagnosticsModal({
  open,
  project,
  activePageId,
  historyUndoCount,
  historyRedoCount,
  onOpenCodeStudio,
  onClose,
}: DiagnosticsModalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<LiveSceneProfileResult | null>(null);

  const health = useMemo(
    () =>
      analyzeProjectHealth(project, {
        activePageId,
        historyUndoCount,
        historyRedoCount,
      }),
    [project, activePageId, historyUndoCount, historyRedoCount],
  );

  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    const dialog = dialogRef.current;
    const shell = host?.parentElement;
    if (!host || !dialog || !shell) return;

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cleanupModal = activateModalDialog(shell, host, dialog, returnFocus);
    const onKeyDown = (event: KeyboardEvent) => {
      trapModalDialogKeydown(dialog, event, onClose);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      cleanupModal();
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleRunProfile = () => {
    setProfile(runLiveSceneProfile(project, activePageId));
  };

  const maxStageMs = profile
    ? Math.max(0.5, ...profile.stages.map((stage) => stage.durationMs))
    : 1;

  return (
    <div
      ref={hostRef}
      class="diagnostics-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        class="diagnostics-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-modal-title"
        tabIndex={-1}
      >
        <header class="diagnostics-modal-header">
          <div>
            <h2 id="diagnostics-modal-title" class="diagnostics-modal-title">
              Scene Profiler &amp; Project Health
            </h2>
            <p class="diagnostics-modal-subtitle">
              {health.projectName}.flop · {health.activePageName} · {health.pageCount} page{health.pageCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            class="code-text-action"
            onClick={onClose}
            aria-label="Close Scene Profiler"
          >
            Close
          </button>
        </header>

        <div class="diagnostics-modal-body">
          <div class="diagnostics-kpi-grid">
            <div class="diagnostics-kpi-card">
              <span class="diagnostics-kpi-label">Active Layers</span>
              <strong class="diagnostics-kpi-value">{health.activePageNodeCount}</strong>
              <span class="diagnostics-kpi-meta">
                {health.totalProjectNodes} project total · depth {health.maxNestingDepth}
              </span>
            </div>
            <div class="diagnostics-kpi-card">
              <span class="diagnostics-kpi-label">Components &amp; Tokens</span>
              <strong class="diagnostics-kpi-value">
                {health.componentMasterCount} / {health.designTokenCount}
              </strong>
              <span class="diagnostics-kpi-meta">
                {health.componentInstanceCount} instances · {health.themeCount} themes
              </span>
            </div>
            <div class="diagnostics-kpi-card">
              <span class="diagnostics-kpi-label">WCAG 2.1 AA Score</span>
              <strong
                class={`diagnostics-kpi-value${health.a11yScore >= 90 ? ' is-good' : health.a11yScore >= 70 ? ' is-warn' : ' is-bad'}`}
              >
                {health.a11yScore}/100
              </strong>
              <span class="diagnostics-kpi-meta">
                {health.logicGraphCount} logic · {health.animationClipCount} motion · {health.customCodeModuleCount} code
              </span>
            </div>
            <div class="diagnostics-kpi-card">
              <span class="diagnostics-kpi-label">Delta History &amp; Engine</span>
              <strong class="diagnostics-kpi-value">
                {health.historyUndoCount} / {health.historyRedoCount}
              </strong>
              <span class="diagnostics-kpi-meta">
                {health.computeKernels.spatialBackend.toUpperCase()} · {health.computeKernels.workerReady ? 'Worker' : 'Sync'} · GPU &ge;{health.spatialCullingThreshold}
              </span>
            </div>
          </div>

          <section class="diagnostics-section" aria-label="Layer breakdown">
            <h3 class="diagnostics-section-title">Active Page Node Breakdown</h3>
            <div class="diagnostics-breakdown-row">
              <span>Frames: <strong>{health.nodeBreakdown.frame}</strong></span>
              <span>Rects: <strong>{health.nodeBreakdown.rect}</strong></span>
              <span>Ellipses: <strong>{health.nodeBreakdown.ellipse}</strong></span>
              <span>Paths: <strong>{health.nodeBreakdown.path}</strong></span>
              <span>Text: <strong>{health.nodeBreakdown.text}</strong></span>
              <span>Images: <strong>{health.nodeBreakdown.image}</strong></span>
              <span>Groups: <strong>{health.nodeBreakdown.group}</strong></span>
              <span>Instances: <strong>{health.nodeBreakdown.componentInstance}</strong></span>
            </div>
          </section>

          <section class="diagnostics-section" aria-label="Project health checks">
            <h3 class="diagnostics-section-title">Cross-Studio Health Checks</h3>
            <ul class="diagnostics-check-list">
              {health.checks.map((check) => (
                <li key={check.id} class={`diagnostics-check-item is-${check.status}`}>
                  <span class={`diagnostics-status-badge is-${check.status}`}>
                    {check.status === 'healthy' ? 'OK' : check.status === 'warning' ? 'WARN' : 'ERR'}
                  </span>
                  <div class="diagnostics-check-copy">
                    <div class="diagnostics-check-label">{check.label}</div>
                    <div class="diagnostics-check-summary">{check.summary}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section class="diagnostics-section" aria-label="On-demand live engine profiler">
            <div class="diagnostics-section-header">
              <div>
                <h3 class="diagnostics-section-title">On-Demand Engine Micro-Profiler</h3>
                <p class="diagnostics-section-hint">
                  Measures non-destructive AST, Auto-Layout, Spatial Index, A11y, and Codegen latency on this page.
                </p>
              </div>
              <button
                type="button"
                class="code-text-action code-text-action-primary"
                onClick={handleRunProfile}
              >
                {profile ? 'Re-Run Profile' : 'Run Live Profile'}
              </button>
            </div>

            {profile && (
              <div class="diagnostics-profile-results">
                <div class="diagnostics-profile-summary">
                  <span>
                    Total pass: <strong>{profile.totalDurationMs.toFixed(2)} ms</strong>
                  </span>
                  <span class={`diagnostics-status-badge is-${profile.rating === 'fast' ? 'healthy' : profile.rating === 'moderate' ? 'warning' : 'error'}`}>
                    {profile.rating.toUpperCase()}
                  </span>
                </div>
                <ul class="diagnostics-stage-list">
                  {profile.stages.map((stage) => {
                    const widthPct = Math.max(4, Math.min(100, Math.round((stage.durationMs / maxStageMs) * 100)));
                    return (
                      <li key={stage.id} class="diagnostics-stage-row">
                        <div class="diagnostics-stage-meta">
                          <span class="diagnostics-stage-label">{stage.label}</span>
                          <span class="diagnostics-stage-detail">{stage.detail}</span>
                        </div>
                        <div class="diagnostics-stage-bar-wrap" aria-hidden="true">
                          <div class="diagnostics-stage-bar" style={{ width: `${widthPct}%` }} />
                        </div>
                        <span class="diagnostics-stage-ms">{stage.durationMs.toFixed(2)} ms</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>

        <footer class="diagnostics-modal-footer">
          <button
            type="button"
            class="code-text-action"
            onClick={() => {
              onClose();
              onOpenCodeStudio();
            }}
          >
            Open Code &amp; A11y Studio
          </button>
          <button
            type="button"
            class="code-text-action code-text-action-primary"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

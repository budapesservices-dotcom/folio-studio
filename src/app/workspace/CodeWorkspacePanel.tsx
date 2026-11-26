import { useEffect, useState } from 'preact/hooks';
import type {
  CodeMappingCategory,
  CodeModuleLanguage,
  DesignNode,
  DesignThemeDefinition,
  FolioPage,
  SemanticHtmlTag,
} from '../../core/document/types';
import { SEMANTIC_HTML_TAGS } from '../../core/document/validation';
import type {
  A11yAuditReport,
  A11yQuickFix,
  CodeOutputTarget,
  CompiledCodeFile,
  CompiledProjectOutput,
  MappedNodeEditPatch,
} from '../../engines/codegen';
import { LivePreviewPane } from './LivePreviewPane';
import { StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';
import type { CodeWorkspaceViewMode, MappedSyncFeedback } from './useCodeWorkspace';

export interface CodeWorkspacePanelProps {
  open: boolean;
  projectName: string;
  pages: readonly FolioPage[];
  themes: readonly DesignThemeDefinition[];
  viewMode: CodeWorkspaceViewMode;
  outputTarget: CodeOutputTarget;
  compiled: CompiledProjectOutput;
  selectedFile: CompiledCodeFile | null;
  previewHtml: string;
  previewPageId: string;
  previewThemeId: string;
  previewBreakpoint: 'desktop' | 'tablet' | 'mobile';
  includeCustomScripts: boolean;
  refreshNonce: number;
  mappedTargetNodeId: string | null;
  mappedTargetNode: DesignNode | null;
  previewPageNodes: readonly DesignNode[];
  mappedFeedback: MappedSyncFeedback | null;
  a11yReport?: A11yAuditReport;
  onClose: () => void;
  onChangeViewMode: (mode: CodeWorkspaceViewMode) => void;
  onChangeOutputTarget: (target: CodeOutputTarget) => void;
  onSelectFile: (path: string) => void;
  onSelectPreviewPage: (pageId: string) => void;
  onSelectPreviewTheme: (themeId: string) => void;
  onSelectPreviewBreakpoint: (bp: 'desktop' | 'tablet' | 'mobile') => void;
  onToggleCustomScripts: (enabled: boolean) => void;
  onSelectMappedNode: (nodeId: string | null) => void;
  onRefreshPreview: () => void;
  onApplyMappedPatch: (nodeId: string, patch: MappedNodeEditPatch) => void;
  onAddCustomModule: (language: Extract<CodeModuleLanguage, 'css' | 'js'>) => void;
  onAddNodeExtension: (nodeId?: string) => void;
  onUpdateModuleContent: (moduleId: string, content: string) => void;
  onCommitModuleEdit?: () => void;
  onDeleteModule: (moduleId: string) => void;
  onFocusNodeInCanvas: (nodeId: string) => void;
  onCopySelectedFile: () => void;
  onDownloadPreviewHtml: () => void;
  onDownloadProjectZip?: () => void;
  onApplyA11yFix?: (fix: A11yQuickFix) => void;
  onApplyAllA11yFixes?: () => void;
}

const CATEGORY_LABEL: Record<CodeMappingCategory, string> = {
  generated: 'Generated',
  mapped: 'Mapped',
  custom: 'Custom',
  extension: 'Extension',
};

const CATEGORY_OWNERSHIP: Record<CodeMappingCategory, string> = {
  generated: 'Read-only · Compiled deterministically from Folio AST & Design Tokens',
  mapped: 'AST-Synced · Use Mapped Sync below for safe Code → Canvas edits',
  custom: 'Editable · Preserved across all visual Canvas edits',
  extension: 'Editable · Anchored by stable data-folio-id across visual edits',
};

export function CodeWorkspacePanel({
  open,
  projectName,
  pages,
  themes,
  viewMode,
  outputTarget,
  compiled,
  selectedFile,
  previewHtml,
  previewPageId,
  previewThemeId,
  previewBreakpoint,
  includeCustomScripts,
  refreshNonce,
  mappedTargetNodeId,
  mappedTargetNode,
  previewPageNodes,
  mappedFeedback,
  a11yReport,
  onClose,
  onChangeViewMode,
  onChangeOutputTarget,
  onSelectFile,
  onSelectPreviewPage,
  onSelectPreviewTheme,
  onSelectPreviewBreakpoint,
  onToggleCustomScripts,
  onSelectMappedNode,
  onRefreshPreview,
  onApplyMappedPatch,
  onAddCustomModule,
  onAddNodeExtension,
  onUpdateModuleContent,
  onCommitModuleEdit,
  onDeleteModule,
  onFocusNodeInCanvas,
  onCopySelectedFile,
  onDownloadPreviewHtml,
  onDownloadProjectZip,
  onApplyA11yFix,
  onApplyAllA11yFixes,
}: CodeWorkspacePanelProps) {
  const [textDraft, setTextDraft] = useState('');
  const [tagDraft, setTagDraft] = useState<SemanticHtmlTag | ''>('');
  const [ariaDraft, setAriaDraft] = useState('');
  const [hrefDraft, setHrefDraft] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (viewMode === 'code' && previewFullscreen) {
      setPreviewFullscreen(false);
    }
  }, [viewMode, previewFullscreen]);

  useEffect(() => {
    if (!previewFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPreviewFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [previewFullscreen]);

  // Sync mapped form fields whenever targeted AST node updates
  useEffect(() => {
    if (!mappedTargetNode) {
      setTextDraft('');
      setTagDraft('');
      setAriaDraft('');
      setHrefDraft('');
      return;
    }
    setTextDraft(mappedTargetNode.type === 'text' ? mappedTargetNode.text : '');
    setTagDraft(mappedTargetNode.semanticTag ?? '');
    setAriaDraft(mappedTargetNode.ariaLabel ?? '');
    setHrefDraft(mappedTargetNode.href ?? '');
  }, [mappedTargetNode]);

  if (!open) return null;

  const compiledFiles = compiled.files.filter(
    (file) => file.category === 'mapped' || file.category === 'generated',
  );
  const userFiles = compiled.files.filter(
    (file) => file.category === 'custom' || file.category === 'extension',
  );

  const isEditableModule = Boolean(
    selectedFile &&
      selectedFile.moduleId &&
      (selectedFile.category === 'custom' || selectedFile.category === 'extension'),
  );

  const isMappedFile = selectedFile?.category === 'mapped';
  const codeLines = selectedFile ? selectedFile.content.split('\n') : [];

  const handleApplyMapped = (event: Event) => {
    event.preventDefault();
    if (!mappedTargetNode) return;
    const patch: MappedNodeEditPatch = {
      semanticTag: tagDraft,
      ariaLabel: ariaDraft,
      ...(tagDraft === 'a' || mappedTargetNode.href ? { href: hrefDraft } : {}),
      ...(mappedTargetNode.type === 'text' ? { text: textDraft } : {}),
    };
    onApplyMappedPatch(mappedTargetNode.id, patch);
  };

  const effectiveViewMode = previewFullscreen ? 'preview' : viewMode;

  return (
    <section
      class={`code-studio-overlay${previewFullscreen ? ' is-preview-fullscreen' : ''}`}
      role="region"
      aria-label="FOLIO Code and Live Preview Studio"
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('textarea, input, select')) return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {!previewFullscreen && (
        <header class="code-studio-header">
        <div class="code-studio-title-group">
          <span class="code-studio-title">
            <StudioIcon name="code" />
            <span>Code &amp; Preview</span>
          </span>
          <span class="code-studio-meta">
            {projectName}.flop · {compiled.summary.totalFiles} files · {compiled.summary.mappedNodeCount} mapped nodes
            {userFiles.length > 0 ? ` · ${userFiles.length} custom` : ''}
          </span>
        </div>

        <div class="code-studio-mode-bar">
          <div class="code-segmented" role="group" aria-label="Developer workspace view">
            {(['split', 'code', 'preview'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                class={`code-segment-btn ${viewMode === mode ? 'is-active' : ''}`}
                aria-pressed={viewMode === mode}
                onClick={() => onChangeViewMode(mode)}
              >
                {mode === 'split' ? 'Split' : mode === 'code' ? 'Code' : 'Preview'}
              </button>
            ))}
          </div>

          <div class="code-segmented" role="group" aria-label="Compiled code target">
            <button
              type="button"
              class={`code-segment-btn ${outputTarget === 'html-css' ? 'is-active' : ''}`}
              aria-pressed={outputTarget === 'html-css'}
              onClick={() => onChangeOutputTarget('html-css')}
            >
              HTML / CSS
            </button>
            <button
              type="button"
              class={`code-segment-btn ${outputTarget === 'react' ? 'is-active' : ''}`}
              aria-pressed={outputTarget === 'react'}
              onClick={() => onChangeOutputTarget('react')}
            >
              React TSX
            </button>
          </div>
        </div>

        <div class="code-studio-actions">
          {a11yReport && (
            <button
              type="button"
              class={`code-text-action code-a11y-toggle${auditOpen ? ' is-active' : ''}${a11yReport.errorCount > 0 ? ' has-errors' : a11yReport.warningCount > 0 ? ' has-warnings' : ' is-clean'}`}
              aria-pressed={auditOpen}
              aria-label="Toggle Accessibility Audit"
              title={`WCAG 2.1 AA & semantic audit score: ${a11yReport.score}/100`}
              onClick={() => setAuditOpen((openState) => !openState)}
            >
              {a11yReport.issues.length > 0 ? `A11y · ${a11yReport.issues.length}` : 'A11y · Pass'}
            </button>
          )}
          {onDownloadProjectZip && (
            <button
              type="button"
              class="code-text-action"
              onClick={onDownloadProjectZip}
              title={
                outputTarget === 'react'
                  ? 'Export runnable React + TypeScript + Vite project ZIP'
                  : 'Export static HTML5 + CSS multi-page project ZIP'
              }
            >
              Export ZIP
            </button>
          )}
          <button
            type="button"
            class="code-text-action"
            onClick={onCopySelectedFile}
            disabled={!selectedFile}
          >
            Copy File
          </button>
          <button
            type="button"
            class="code-text-action code-text-action-primary"
            onClick={onClose}
            aria-label="Back to Canvas"
          >
            Back to Canvas
          </button>
        </div>
      </header>
      )}

      {!previewFullscreen && auditOpen && a11yReport && (
        <section class="code-a11y-drawer" aria-label="Accessibility Audit">
          <div class="code-a11y-header">
            <div class="code-a11y-title-group">
              <strong>Accessibility Audit · {a11yReport.pageName}</strong>
              <span class={`code-a11y-score${a11yReport.score >= 90 ? ' is-good' : a11yReport.score >= 70 ? ' is-warn' : ' is-bad'}`}>
                Score {a11yReport.score}/100
              </span>
              <span class="code-a11y-counts">
                {a11yReport.errorCount} errors · {a11yReport.warningCount} warnings · {a11yReport.passedChecks} passed
              </span>
            </div>
            <div class="code-a11y-header-actions">
              {onApplyAllA11yFixes && a11yReport.issues.filter((issue) => Boolean(issue.fix)).length > 0 && (
                <button
                  type="button"
                  class="code-text-action code-text-action-primary"
                  onClick={onApplyAllA11yFixes}
                >
                  Fix All ({a11yReport.issues.filter((issue) => Boolean(issue.fix)).length})
                </button>
              )}
              <button
                type="button"
                class="code-text-action"
                onClick={() => setAuditOpen(false)}
                aria-label="Close Accessibility Audit"
              >
                Hide
              </button>
            </div>
          </div>
          {a11yReport.issues.length === 0 ? (
            <p class="code-a11y-empty">
              All WCAG 2.1 AA contrast, heading hierarchy, and interactive control checks passed on this page.
            </p>
          ) : (
            <ul class="code-a11y-list">
              {a11yReport.issues.map((issue) => (
                <li key={issue.id} class={`code-a11y-item is-${issue.severity}`}>
                  <span class={`code-a11y-badge is-${issue.severity}`}>
                    {issue.severity === 'error' ? 'ERROR' : issue.severity === 'warning' ? 'WARN' : 'INFO'}
                  </span>
                  <div class="code-a11y-item-copy">
                    <div class="code-a11y-item-title">{issue.title}</div>
                    <div class="code-a11y-item-msg">{issue.message}</div>
                    {issue.detail && <div class="code-a11y-item-detail">{issue.detail}</div>}
                  </div>
                  <div class="code-a11y-item-actions">
                    {issue.fix && onApplyA11yFix && (
                      <button
                        type="button"
                        class="code-text-action code-text-action-primary"
                        onClick={() => onApplyA11yFix(issue.fix!)}
                      >
                        {issue.fix.label}
                      </button>
                    )}
                    {issue.nodeId && (
                      <button
                        type="button"
                        class="code-text-action"
                        onClick={() => onFocusNodeInCanvas(issue.nodeId!)}
                      >
                        Focus
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div class={`code-studio-body is-mode-${effectiveViewMode}`}>
        {effectiveViewMode !== 'preview' && (
          <aside class="code-file-sidebar" aria-label="Compiled and custom code files">
            <div class="code-sidebar-section">
              <div class="code-sidebar-heading">Compiled Project</div>
              <ul class="code-file-list">
                {compiledFiles.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      class={`code-file-row ${selectedFile?.path === file.path ? 'is-active' : ''}`}
                      onClick={() => onSelectFile(file.path)}
                    >
                      <span class="code-file-path" title={file.path}>{file.path}</span>
                      <span class={`code-mapping-label is-${file.category}`}>
                        {CATEGORY_LABEL[file.category]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div class="code-sidebar-section">
              <div class="code-sidebar-heading-row">
                <span class="code-sidebar-heading">Custom &amp; Extensions</span>
                <div class="code-sidebar-add-group">
                  <button
                    type="button"
                    class="code-mini-btn"
                    title="Add custom CSS file"
                    onClick={() => onAddCustomModule('css')}
                  >
                    + CSS
                  </button>
                  <button
                    type="button"
                    class="code-mini-btn"
                    title="Add custom JS file"
                    onClick={() => onAddCustomModule('js')}
                  >
                    + JS
                  </button>
                  <button
                    type="button"
                    class="code-mini-btn"
                    title="Add CSS extension anchored to selected AST node"
                    onClick={() => onAddNodeExtension(mappedTargetNodeId ?? undefined)}
                  >
                    + Ext
                  </button>
                </div>
              </div>

              {userFiles.length === 0 ? (
                <p class="code-sidebar-empty">
                  Add a Custom stylesheet or Node Extension. Visual edits never overwrite custom files.
                </p>
              ) : (
                <ul class="code-file-list">
                  {userFiles.map((file) => (
                    <li key={file.id} class="code-file-item-wrap">
                      <button
                        type="button"
                        class={`code-file-row ${selectedFile?.path === file.path ? 'is-active' : ''}`}
                        onClick={() => onSelectFile(file.path)}
                      >
                        <span class="code-file-path" title={file.path}>{file.path}</span>
                        <span class={`code-mapping-label is-${file.category}`}>
                          {CATEGORY_LABEL[file.category]}
                        </span>
                      </button>
                      {file.moduleId && (
                        <button
                          type="button"
                          class="code-file-delete"
                          title={`Delete ${file.path}`}
                          aria-label={`Delete ${file.path}`}
                          onClick={() => onDeleteModule(file.moduleId!)}
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div class="code-sidebar-footer">
              <div class="code-legend-row">
                <span class="code-mapping-label is-mapped">Mapped</span>
                <span>AST-linked</span>
              </div>
              <div class="code-legend-row">
                <span class="code-mapping-label is-generated">Generated</span>
                <span>Deterministic</span>
              </div>
              <div class="code-legend-row">
                <span class="code-mapping-label is-custom">Custom</span>
                <span>Never overwritten</span>
              </div>
              <div class="code-legend-row">
                <span class="code-mapping-label is-extension">Extension</span>
                <span>ID-anchored override</span>
              </div>
            </div>
          </aside>
        )}

        {effectiveViewMode !== 'preview' && (
          <section class="code-editor-pane" aria-label="Code editor">
            {selectedFile ? (
              <>
                <div class="code-editor-header">
                  <div class="code-editor-file-meta">
                    <span class="code-editor-filepath">{selectedFile.path}</span>
                    <span class={`code-mapping-label is-${selectedFile.category}`}>
                      {CATEGORY_LABEL[selectedFile.category]}
                    </span>
                    <span class="code-editor-ownership">
                      {CATEGORY_OWNERSHIP[selectedFile.category]}
                    </span>
                  </div>
                  {selectedFile.language === 'js' && isEditableModule && (
                    <label class="code-sandbox-js-toggle">
                      <input
                        type="checkbox"
                        checked={includeCustomScripts}
                        onChange={(event) => onToggleCustomScripts(event.currentTarget.checked)}
                      />
                      <span>Run JS in sandbox</span>
                    </label>
                  )}
                </div>

                {isMappedFile && previewPageNodes.length > 0 && (
                  <form class="mapped-sync-bar" onSubmit={handleApplyMapped} aria-label="Mapped Code to Canvas Sync">
                    <div class="mapped-sync-row">
                      <label class="mapped-sync-field mapped-sync-node-select">
                        <span>AST Node</span>
                        <select
                          class="select-field"
                          aria-label="Mapped AST node"
                          value={mappedTargetNode?.id ?? ''}
                          onChange={(event) => onSelectMappedNode(event.currentTarget.value || null)}
                        >
                          {previewPageNodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.name} ({node.type})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label class="mapped-sync-field mapped-sync-tag">
                        <span>Tag</span>
                        <select
                          class="select-field"
                          aria-label="Mapped semantic tag"
                          value={tagDraft}
                          onChange={(event) => setTagDraft(event.currentTarget.value as SemanticHtmlTag | '')}
                        >
                          <option value="">Auto</option>
                          {[...SEMANTIC_HTML_TAGS].map((tag) => (
                            <option key={tag} value={tag}>&lt;{tag}&gt;</option>
                          ))}
                        </select>
                      </label>

                      {mappedTargetNode?.type === 'text' && (
                        <label class="mapped-sync-field mapped-sync-text">
                          <span>Text</span>
                          <input
                            type="text"
                            class="text-field"
                            aria-label="Mapped node text"
                            value={textDraft}
                            onInput={(event) => setTextDraft(event.currentTarget.value)}
                          />
                        </label>
                      )}

                      <label class="mapped-sync-field mapped-sync-aria">
                        <span>aria-label</span>
                        <input
                          type="text"
                          class="text-field"
                          aria-label="Mapped aria label"
                          placeholder="Accessible label"
                          value={ariaDraft}
                          onInput={(event) => setAriaDraft(event.currentTarget.value)}
                        />
                      </label>

                      {tagDraft === 'a' && (
                        <label class="mapped-sync-field mapped-sync-href">
                          <span>href</span>
                          <input
                            type="text"
                            class="text-field"
                            aria-label="Mapped link href"
                            placeholder="/pricing or https://..."
                            value={hrefDraft}
                            onInput={(event) => setHrefDraft(event.currentTarget.value)}
                          />
                        </label>
                      )}

                      <div class="mapped-sync-actions">
                        <button type="submit" class="code-text-action code-text-action-primary">
                          Apply to Canvas
                        </button>
                        {mappedTargetNode && (
                          <button
                            type="button"
                            class="code-text-action"
                            onClick={() => onFocusNodeInCanvas(mappedTargetNode.id)}
                          >
                            Focus Node
                          </button>
                        )}
                      </div>
                    </div>

                    {mappedFeedback && (
                      <div
                        class={`mapped-sync-feedback is-${mappedFeedback.tone}`}
                        role="status"
                        aria-live="polite"
                      >
                        {mappedFeedback.message}
                      </div>
                    )}
                  </form>
                )}

                {isEditableModule && selectedFile.moduleId ? (
                  <div class="code-editable-wrap">
                    <textarea
                      class="code-editor-textarea"
                      aria-label={`Edit ${selectedFile.path}`}
                      spellcheck={false}
                      value={selectedFile.content}
                      onInput={(event) => {
                        onUpdateModuleContent(selectedFile.moduleId!, event.currentTarget.value);
                      }}
                      onBlur={() => onCommitModuleEdit?.()}
                    />
                  </div>
                ) : (
                  <div class="code-readonly-scroll">
                    <ol class="code-lines" aria-label={`Source code for ${selectedFile.path}`}>
                      {codeLines.map((line, index) => {
                        const lineNum = index + 1;
                        const mappedEntry = selectedFile.mappings.find(
                          (entry) => lineNum >= entry.startLine && lineNum <= entry.endLine,
                        );
                        const isSelectedLine =
                          Boolean(mappedEntry && mappedTargetNodeId && mappedEntry.nodeId === mappedTargetNodeId);
                        return (
                          <li
                            key={lineNum}
                            class={`code-line-row ${mappedEntry ? 'is-mapped-line' : ''} ${isSelectedLine ? 'is-selected-line' : ''}`}
                            onClick={
                              mappedEntry
                                ? () => onSelectMappedNode(mappedEntry.nodeId)
                                : undefined
                            }
                            title={mappedEntry ? `Mapped to AST node "${mappedEntry.nodeName}"` : undefined}
                          >
                            <span class="code-line-num" aria-hidden="true">{lineNum}</span>
                            <code class="code-line-text">{line || ' '}</code>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </>
            ) : (
              <div class="code-empty-state">No compiled files available for this page.</div>
            )}
          </section>
        )}

        {effectiveViewMode !== 'code' && (
          <LivePreviewPane
            pages={pages}
            activePageId={previewPageId}
            themes={themes}
            activeThemeId={previewThemeId}
            breakpoint={previewBreakpoint}
            previewHtml={previewHtml}
            refreshNonce={refreshNonce}
            isPreviewOnly={effectiveViewMode === 'preview'}
            isFullscreen={previewFullscreen}
            onToggleFullscreen={() => setPreviewFullscreen((prev) => !prev)}
            onSelectPage={onSelectPreviewPage}
            onSelectTheme={onSelectPreviewTheme}
            onSelectBreakpoint={onSelectPreviewBreakpoint}
            onRefresh={onRefreshPreview}
            onDownloadHtml={onDownloadPreviewHtml}
          />
        )}
      </div>
      {contextMenu && (
        <StudioContextMenu
          open={true}
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Code and Preview Studio actions"
          testId="code-workspace-context-menu"
          onClose={() => setContextMenu(null)}
          items={(() => {
            const items: StudioContextMenuItem[] = [
              { kind: 'header', id: 'hdr', label: selectedFile ? selectedFile.path : 'Code & Preview' },
              {
                kind: 'item',
                id: 'copy-file',
                label: 'Copy Active File',
                disabled: !selectedFile,
                onSelect: onCopySelectedFile,
              },
              { kind: 'item', id: 'refresh', label: 'Refresh Live Preview', onSelect: onRefreshPreview },
              { kind: 'divider', id: 'div-view' },
              { kind: 'item', id: 'view-split', label: 'Split View', active: viewMode === 'split', onSelect: () => onChangeViewMode('split') },
              { kind: 'item', id: 'view-code', label: 'Code Only', active: viewMode === 'code', onSelect: () => onChangeViewMode('code') },
              { kind: 'item', id: 'view-preview', label: 'Preview Only', active: viewMode === 'preview', onSelect: () => onChangeViewMode('preview') },
              { kind: 'divider', id: 'div-add' },
              { kind: 'item', id: 'add-css', label: 'Add Custom CSS Module', onSelect: () => onAddCustomModule('css') },
              { kind: 'item', id: 'add-js', label: 'Add Custom JS Module', onSelect: () => onAddCustomModule('js') },
            ];
            if (onDownloadProjectZip) {
              items.push({ kind: 'divider', id: 'div-export' });
              items.push({ kind: 'item', id: 'export-zip', label: 'Export Project ZIP', accent: true, onSelect: onDownloadProjectZip });
            }
            items.push({ kind: 'divider', id: 'div-back' });
            items.push({ kind: 'item', id: 'close', label: 'Back to Canvas', shortcut: ['Esc'], onSelect: onClose });
            return items;
          })()}
        />
      )}
    </section>
  );
}

export interface CodeWorkspaceViewProps {
  projectName: string;
  pages: readonly FolioPage[];
  themes: readonly DesignThemeDefinition[];
  workspace: import('./useCodeWorkspace').UseCodeWorkspaceResult;
}

export function CodeWorkspaceView({
  projectName,
  pages,
  themes,
  workspace,
}: CodeWorkspaceViewProps) {
  return (
    <CodeWorkspacePanel
      open={workspace.open}
      projectName={projectName}
      pages={pages}
      themes={themes}
      viewMode={workspace.viewMode}
      outputTarget={workspace.outputTarget}
      compiled={workspace.compiled}
      selectedFile={workspace.selectedFile}
      previewHtml={workspace.previewHtml}
      previewPageId={workspace.previewPageId}
      previewThemeId={workspace.previewThemeId}
      previewBreakpoint={workspace.previewBreakpoint}
      includeCustomScripts={workspace.includeCustomScripts}
      refreshNonce={workspace.refreshNonce}
      mappedTargetNodeId={workspace.mappedTargetNodeId}
      mappedTargetNode={workspace.mappedTargetNode}
      previewPageNodes={workspace.previewPageNodes}
      mappedFeedback={workspace.mappedFeedback}
      a11yReport={workspace.a11yReport}
      onClose={workspace.close}
      onChangeViewMode={workspace.setViewMode}
      onChangeOutputTarget={workspace.setOutputTarget}
      onSelectFile={workspace.setSelectedFilePath}
      onSelectPreviewPage={workspace.setPreviewPageId}
      onSelectPreviewTheme={workspace.setPreviewThemeId}
      onSelectPreviewBreakpoint={workspace.setPreviewBreakpoint}
      onToggleCustomScripts={workspace.setIncludeCustomScripts}
      onSelectMappedNode={workspace.setMappedTargetNodeId}
      onRefreshPreview={workspace.refreshPreview}
      onApplyMappedPatch={workspace.applyMappedPatch}
      onAddCustomModule={workspace.addCustomModule}
      onAddNodeExtension={workspace.addNodeExtension}
      onUpdateModuleContent={workspace.updateModuleContent}
      onCommitModuleEdit={workspace.commitModuleEdit}
      onDeleteModule={workspace.deleteModule}
      onFocusNodeInCanvas={workspace.focusNodeInCanvas}
      onCopySelectedFile={workspace.copySelectedFile}
      onDownloadPreviewHtml={workspace.downloadPreviewHtml}
      onDownloadProjectZip={workspace.downloadProjectZip}
      onApplyA11yFix={workspace.applyA11yFix}
      onApplyAllA11yFixes={workspace.applyAllA11yFixes}
    />
  );
}

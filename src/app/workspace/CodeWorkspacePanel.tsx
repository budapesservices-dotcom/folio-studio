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
  CodeOutputTarget,
  CompiledCodeFile,
  CompiledProjectOutput,
  MappedNodeEditPatch,
} from '../../engines/codegen';
import { LivePreviewPane } from './LivePreviewPane';
import { StudioIcon } from './StudioIcon';
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
}: CodeWorkspacePanelProps) {
  const [textDraft, setTextDraft] = useState('');
  const [tagDraft, setTagDraft] = useState<SemanticHtmlTag | ''>('');
  const [ariaDraft, setAriaDraft] = useState('');
  const [hrefDraft, setHrefDraft] = useState('');

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

  return (
    <section
      class="code-studio-overlay"
      role="region"
      aria-label="FOLIO Code and Live Preview Studio"
    >
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

      <div class={`code-studio-body is-mode-${viewMode}`}>
        {viewMode !== 'preview' && (
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

        {viewMode !== 'preview' && (
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

        {viewMode !== 'code' && (
          <LivePreviewPane
            pages={pages}
            activePageId={previewPageId}
            themes={themes}
            activeThemeId={previewThemeId}
            breakpoint={previewBreakpoint}
            previewHtml={previewHtml}
            refreshNonce={refreshNonce}
            onSelectPage={onSelectPreviewPage}
            onSelectTheme={onSelectPreviewTheme}
            onSelectBreakpoint={onSelectPreviewBreakpoint}
            onRefresh={onRefreshPreview}
            onDownloadHtml={onDownloadPreviewHtml}
          />
        )}
      </div>
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
    />
  );
}

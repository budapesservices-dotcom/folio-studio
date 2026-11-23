import type { JSX, RefObject } from 'preact';
import { ToolbarHintBar, type ToolbarHintStore } from '../ToolbarHintBar';
import type { WorkspacePreferencesLoadResult } from '../workspacePreferences';
import { StudioIcon } from './StudioIcon';

export interface GlobalToolbarProps {
  projectName: string;
  isHydrating: boolean;
  fileMenuOpen: boolean;
  viewMenuOpen: boolean;
  helpMenuOpen: boolean;
  menuBarRef: RefObject<HTMLDivElement>;
  projectFileInputRef: RefObject<HTMLInputElement>;
  pagesRackToggleRef: RefObject<HTMLButtonElement>;
  componentRackToggleRef: RefObject<HTMLButtonElement>;
  projectNameEditing: boolean;
  projectNameDraft: string;
  pagesRackOpen: boolean;
  componentRackOpen: boolean;
  layersVisible: boolean;
  inspectorVisible: boolean;
  canvasClosed: boolean;
  canvasMinimized: boolean;
  componentCanvasOpen: boolean;
  componentCanvasClosed: boolean;
  componentCanvasMinimized: boolean;
  nodeLogicOpen: boolean;
  nodeLogicClosed: boolean;
  nodeLogicMinimized: boolean;
  shortcutsModalOpen: boolean;
  toolbarHintStore: ToolbarHintStore;
  onToggleFileMenu: () => void;
  onToggleViewMenu: () => void;
  onToggleHelpMenu: () => void;
  onOpenProjectPicker: () => void;
  onProjectFileSelected: (file: File) => void | Promise<void>;
  onExportCurrentProject: () => void;
  onExportActiveCanvasSvg: () => void;
  onExportActiveCanvasPng: () => void;
  onResetWindowLayout: () => void;
  onOpenShortcutsModal: () => void;
  onStartProjectRename: () => void;
  onProjectNameDraftChange: (value: string) => void;
  onCommitProjectRename: () => void;
  onCancelProjectRename: () => void;
  onTogglePagesRack: () => void;
  onToggleComponentRack: () => void;
  onToggleLayersVisible: () => void;
  onToggleInspectorVisible: () => void;
  onToggleMainCanvas: () => void;
  onToggleComponentCanvas: () => void;
  onToggleNodeLogic: () => void;
  onEnterFullscreen: () => void;
  onUpdateToolbarHint: (panel: string, description: string, shortcuts?: string[]) => void;
}

export function GlobalToolbar({
  projectName,
  isHydrating,
  fileMenuOpen,
  viewMenuOpen,
  helpMenuOpen,
  menuBarRef,
  projectFileInputRef,
  pagesRackToggleRef,
  componentRackToggleRef,
  projectNameEditing,
  projectNameDraft,
  pagesRackOpen,
  componentRackOpen,
  layersVisible,
  inspectorVisible,
  canvasClosed,
  canvasMinimized,
  componentCanvasOpen,
  componentCanvasClosed,
  componentCanvasMinimized,
  nodeLogicOpen,
  nodeLogicClosed,
  nodeLogicMinimized,
  shortcutsModalOpen,
  toolbarHintStore,
  onToggleFileMenu,
  onToggleViewMenu,
  onToggleHelpMenu,
  onOpenProjectPicker,
  onProjectFileSelected,
  onExportCurrentProject,
  onExportActiveCanvasSvg,
  onExportActiveCanvasPng,
  onResetWindowLayout,
  onOpenShortcutsModal,
  onStartProjectRename,
  onProjectNameDraftChange,
  onCommitProjectRename,
  onCancelProjectRename,
  onTogglePagesRack,
  onToggleComponentRack,
  onToggleLayersVisible,
  onToggleInspectorVisible,
  onToggleMainCanvas,
  onToggleComponentCanvas,
  onToggleNodeLogic,
  onEnterFullscreen,
  onUpdateToolbarHint,
}: GlobalToolbarProps) {
  const handleFileInputChange = (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the native input so the same file can be selected again after failure.
    input.value = '';
    if (!file) return;
    void onProjectFileSelected(file);
  };

  return (
    <header
      class={`global-toolbar-slot ${fileMenuOpen || viewMenuOpen || helpMenuOpen ? 'has-open-menu' : ''}`}
      aria-label="FOLIO application toolbar"
    >
      <nav class="global-menu-bar" aria-label="Application menus">
        <div class="global-toolbar-left">
          <div class="global-menu-items" ref={menuBarRef}>
            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={fileMenuOpen}
                onClick={onToggleFileMenu}
                onMouseEnter={() => onUpdateToolbarHint('FILE', 'Open or export the current native .flop project.')}
              >
                File
              </button>
              {fileMenuOpen && (
                <div class="global-menu-dropdown" role="menu" aria-label="File menu">
                  <button type="button" role="menuitem" onClick={onOpenProjectPicker} disabled={isHydrating}>
                    Open Project…
                  </button>
                  <button type="button" role="menuitem" onClick={onExportCurrentProject} disabled={isHydrating}>
                    Export Project (.flop)
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={onExportActiveCanvasSvg} disabled={isHydrating}>
                    Export SVG
                  </button>
                  <button type="button" role="menuitem" onClick={onExportActiveCanvasPng} disabled={isHydrating}>
                    Export PNG (2×)
                  </button>
                </div>
              )}
              <input
                ref={projectFileInputRef}
                type="file"
                accept=".flop,application/vnd.folio.project+json"
                aria-label="Choose a FOLIO project file"
                hidden
                onChange={handleFileInputChange}
              />
            </div>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span
              class="global-menu-item is-disabled"
              aria-disabled="true"
              title="Edit menu (planned)"
              onMouseEnter={() => onUpdateToolbarHint('EDIT', 'Editing, history and selection commands will be organized here.')}
            >
              Edit
            </span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
                onClick={onToggleViewMenu}
                onMouseEnter={() => onUpdateToolbarHint('VIEW', 'Workspace display, panels, zoom and window layout controls.')}
              >
                View
              </button>
              {viewMenuOpen && (
                <div class="global-menu-dropdown" role="menu" aria-label="View menu">
                  <button type="button" role="menuitem" onClick={onResetWindowLayout}>
                    Reset Window Layout
                  </button>
                </div>
              )}
            </div>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span
              class="global-menu-item is-disabled"
              aria-disabled="true"
              title="Tools menu (planned)"
              onMouseEnter={() => onUpdateToolbarHint('TOOLS', 'Design tools and tool-specific settings will be organized here.')}
            >
              Tools
            </span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span
              class="global-menu-item is-disabled"
              aria-disabled="true"
              title="Option menu (planned)"
              onMouseEnter={() => onUpdateToolbarHint('OPTION', 'Application and workspace preferences will be organized here.')}
            >
              Option
            </span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={helpMenuOpen}
                onClick={onToggleHelpMenu}
                onMouseEnter={() => onUpdateToolbarHint('HELP', 'Open the categorized Keyboard Shortcuts cheat sheet.', ['KEY: ?', 'CTRL/CMD + /'])}
              >
                Help
              </button>
              {helpMenuOpen && (
                <div class="global-menu-dropdown" role="menu" aria-label="Help menu">
                  <button
                    type="button"
                    role="menuitem"
                    class="global-menu-item-with-shortcut"
                    onClick={onOpenShortcutsModal}
                    disabled={isHydrating}
                  >
                    <span>Keyboard Shortcuts</span>
                    <kbd class="global-menu-shortcut">?</kbd>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div class="global-project-name" title={`${projectName}.flop`}>
          {projectNameEditing ? (
            <input
              class="global-project-rename-input"
              autoFocus
              value={projectNameDraft}
              aria-label="Project name"
              onInput={(event) => onProjectNameDraftChange(event.currentTarget.value)}
              onBlur={onCommitProjectRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelProjectRename();
                }
              }}
            />
          ) : (
            <button
              type="button"
              class="global-project-rename-button"
              title="Rename project"
              onClick={onStartProjectRename}
            >
              <span class="global-project-label">{projectName}</span>
              <span class="global-project-extension">.flop</span>
              <StudioIcon name="edit" />
            </button>
          )}
        </div>

        <div class="global-panel-toggles" aria-label="Workspace panels">
          <div class="global-panel-group" role="group" aria-label="Racks">
            <button
              ref={pagesRackToggleRef}
              class={`global-panel-toggle pages-rack-header-toggle ${pagesRackOpen ? 'active' : ''}`}
              type="button"
              title={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'}
              aria-label={pagesRackOpen ? 'Close Pages Rack' : 'Open Pages Rack'}
              aria-pressed={pagesRackOpen}
              onClick={onTogglePagesRack}
              onMouseEnter={() => onUpdateToolbarHint('PAGES RACK', 'Manage the pages in this project.')}
            >
              <StudioIcon name="pages" />
            </button>
            <button
              ref={componentRackToggleRef}
              class={`global-panel-toggle component-rack-header-toggle ${componentRackOpen ? 'active' : ''}`}
              type="button"
              title={componentRackOpen ? 'Close Component Rack' : 'Open Component Rack'}
              aria-label={componentRackOpen ? 'Close Component Rack' : 'Open Component Rack'}
              aria-pressed={componentRackOpen}
              onClick={onToggleComponentRack}
              onMouseEnter={() => onUpdateToolbarHint('COMPONENT RACK', 'Browse and reuse components saved to your personal library.')}
            >
              <StudioIcon name="rack" />
            </button>
          </div>
          <span class="global-panel-group-divider" aria-hidden="true" />
          <div class="global-panel-group" role="group" aria-label="Side panels">
            <button
              class={`global-panel-toggle ${layersVisible ? 'active' : ''}`}
              type="button"
              title="Show / hide Layers sidebar"
              aria-label="Show or hide Layers sidebar"
              aria-pressed={layersVisible}
              onClick={onToggleLayersVisible}
              onMouseEnter={() => onUpdateToolbarHint('LAYERS SIDEBAR', 'Show or hide the document Layers dock.')}
            >
              <StudioIcon name="sidebar" />
            </button>
            <button
              class={`global-panel-toggle inspector-header-toggle ${inspectorVisible ? 'active' : ''}`}
              type="button"
              title={inspectorVisible ? 'Hide Inspector' : 'Show Inspector'}
              aria-label={inspectorVisible ? 'Hide Inspector' : 'Show Inspector'}
              aria-pressed={inspectorVisible}
              onClick={onToggleInspectorVisible}
              onMouseEnter={() => onUpdateToolbarHint(
                'INSPECTOR',
                inspectorVisible
                  ? 'Hide the properties Inspector. Selecting an object opens it automatically.'
                  : 'Show the properties Inspector. Selecting an object also opens it automatically.',
              )}
            >
              <StudioIcon name="inspector" />
            </button>
          </div>
          <span class="global-panel-group-divider" aria-hidden="true" />
          <div class="global-panel-group" role="group" aria-label="Workspace windows">
            <button
              class={`global-panel-toggle canvas-header-toggle ${!canvasClosed && !canvasMinimized ? 'active' : ''}`}
              type="button"
              title={canvasClosed || canvasMinimized ? 'Open Canvas' : 'Close Canvas'}
              aria-label={canvasClosed || canvasMinimized ? 'Open Canvas' : 'Close Canvas'}
              aria-pressed={!canvasClosed && !canvasMinimized}
              onClick={onToggleMainCanvas}
              onMouseEnter={() => onUpdateToolbarHint('CANVAS WINDOW', canvasClosed || canvasMinimized ? 'Open the Canvas dock.' : 'Close the Canvas workspace.')}
            >
              <StudioIcon name="canvas" />
            </button>
            <button
              class={`global-panel-toggle component-canvas-header-toggle ${componentCanvasOpen ? 'active' : ''}`}
              type="button"
              title={componentCanvasClosed || componentCanvasMinimized ? 'Open Component Canvas' : 'Close Component Canvas'}
              aria-label={componentCanvasClosed || componentCanvasMinimized ? 'Open Component Canvas' : 'Close Component Canvas'}
              aria-pressed={componentCanvasOpen}
              onClick={onToggleComponentCanvas}
              onMouseEnter={() => onUpdateToolbarHint('COMPONENT CANVAS', componentCanvasClosed || componentCanvasMinimized ? 'Open the Component Canvas window.' : 'Close the Component Canvas window.')}
            >
              <StudioIcon name="componentCanvas" />
            </button>
            <button
              class={`global-panel-toggle node-logic-header-toggle ${nodeLogicOpen ? 'active' : ''}`}
              type="button"
              title={nodeLogicClosed || nodeLogicMinimized ? 'Open Node Logic' : 'Close Node Logic'}
              aria-label={nodeLogicClosed || nodeLogicMinimized ? 'Open Node Logic' : 'Close Node Logic'}
              aria-pressed={nodeLogicOpen}
              onClick={onToggleNodeLogic}
              onMouseEnter={() => onUpdateToolbarHint('NODE LOGIC', nodeLogicClosed || nodeLogicMinimized ? 'Open the Node Logic workspace.' : 'Close the Node Logic workspace.')}
            >
              <StudioIcon name="logicNodes" />
            </button>
          </div>
          <span class="global-panel-group-divider" aria-hidden="true" />
          <div class="global-panel-group" role="group" aria-label="Utilities">
            <button
              class={`global-panel-toggle shortcuts-header-toggle ${shortcutsModalOpen ? 'active' : ''}`}
              type="button"
              title="Keyboard Shortcuts (?)"
              aria-label="Keyboard Shortcuts"
              aria-haspopup="dialog"
              aria-expanded={shortcutsModalOpen}
              onClick={onOpenShortcutsModal}
              disabled={isHydrating}
              onMouseEnter={() => onUpdateToolbarHint('KEYBOARD SHORTCUTS', 'View all available keyboard shortcuts grouped by workspace and action.', ['KEY: ?', 'CTRL/CMD + /'])}
            >
              <StudioIcon name="keyboard" />
            </button>
            <button
              class="global-panel-toggle fullscreen-toggle"
              type="button"
              title="Toggle fullscreen"
              aria-label="Toggle fullscreen"
              onClick={onEnterFullscreen}
              onMouseEnter={() => onUpdateToolbarHint('FULLSCREEN', 'Enter or exit browser fullscreen mode.')}
            >
              <StudioIcon name="fullscreen" />
            </button>
          </div>
        </div>
      </nav>
      <ToolbarHintBar store={toolbarHintStore} />
    </header>
  );
}

export interface WorkspacePreferencesRecoveryBannerProps {
  status: WorkspacePreferencesLoadResult['status'];
  reviewRequired: boolean;
  onApprove: () => void;
}

export function WorkspacePreferencesRecoveryBanner({
  status,
  reviewRequired,
  onApprove,
}: WorkspacePreferencesRecoveryBannerProps) {
  if (!reviewRequired && status !== 'unsupported-newer-schema' && status !== 'storage-unavailable') {
    return null;
  }

  const copy = status === 'migrated'
    ? 'Legacy window settings were found. Review the restored layout before converting them to Workspace Preferences V1.'
    : status === 'recovered'
      ? 'Some saved layout values needed safe recovery. Review the restored layout before saving it.'
      : status === 'malformed'
        ? 'The saved workspace layout is unreadable. The app loaded safe defaults; replacing the damaged record requires your approval.'
        : status === 'unsupported-newer-schema'
          ? 'This layout was saved by a newer Folio version. Safe defaults are active and the newer record will not be overwritten.'
          : 'Browser storage is unavailable. Workspace layout changes cannot be saved in this session.';

  const actionLabel = status === 'migrated'
    ? 'Migrate saved layout'
    : status === 'malformed'
      ? 'Replace damaged layout'
      : 'Use recovered layout';

  return (
    <div class="workspace-preferences-recovery" role="status" aria-live="polite">
      <div class="workspace-preferences-recovery-copy">
        <strong>Workspace layout preferences</strong>
        <span>{copy}</span>
      </div>
      {reviewRequired && (
        <button type="button" onClick={onApprove}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

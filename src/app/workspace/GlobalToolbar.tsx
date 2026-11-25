import type { JSX, RefObject } from 'preact';
import { useState } from 'preact/hooks';
import type { PathfinderOperation } from '../../core/document/vector';
import type { CanvasToolId } from '../../core/tools/operationContract';
import { ToolbarHintBar, type ToolbarHintStore } from '../ToolbarHintBar';
import type { WorkspacePreferencesLoadResult } from '../workspacePreferences';
import { StudioIcon } from './StudioIcon';
import type { ProjectImportOutcome } from './useProjectFileLifecycle';

export type TopMenuId = 'file' | 'edit' | 'view' | 'tools' | 'option' | 'help';

export interface GlobalToolbarMenuActions {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canMask: boolean;
  canUnmask: boolean;
  canPathfinder: boolean;
  canConvertToPath: boolean;
  activeToolId: CanvasToolId;
  activeThemeId: string;
  themes: ReadonlyArray<{ id: string; name: string }>;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onSelectAll: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onCreateMask: () => void;
  onRemoveMask: () => void;
  onDelete: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onSelectTool: (toolId: CanvasToolId) => void;
  onPathfinder: (operation: PathfinderOperation) => void;
  onConvertToPath: () => void;
  onRotate90: () => void;
  onSelectTheme: (themeId: string) => void;
}

export interface GlobalToolbarProps {
  projectName: string;
  isHydrating: boolean;
  openMenu: TopMenuId | null;
  menuActions: GlobalToolbarMenuActions;
  menuBarRef: RefObject<HTMLDivElement>;
  projectFileInputRef: RefObject<HTMLInputElement>;
  pagesRackToggleRef: RefObject<HTMLButtonElement>;
  componentRackToggleRef: RefObject<HTMLButtonElement>;
  tokensRackToggleRef: RefObject<HTMLButtonElement>;
  projectNameEditing: boolean;
  projectNameDraft: string;
  pagesRackOpen: boolean;
  componentRackOpen: boolean;
  tokensRackOpen: boolean;
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
  codeWorkspaceOpen: boolean;
  motionTimelineOpen: boolean;
  shortcutsModalOpen: boolean;
  toolbarHintStore: ToolbarHintStore;
  onToggleMenu: (menu: TopMenuId) => void;
  onCloseMenus: () => void;
  onOpenProjectPicker: () => void;
  onProjectFileSelected: (file: File) => void | Promise<ProjectImportOutcome | void>;
  onExportCurrentProject: () => void;
  onExportActiveCanvasSvg: () => void;
  onExportActiveCanvasPng: () => void;
  onResetWindowLayout: () => void;
  onOpenShortcutsModal: () => void;
  onOpenDiagnosticsModal?: () => void;
  onStartProjectRename: () => void;
  onProjectNameDraftChange: (value: string) => void;
  onCommitProjectRename: () => void;
  onCancelProjectRename: () => void;
  onTogglePagesRack: () => void;
  onToggleComponentRack: () => void;
  onToggleTokensRack: () => void;
  onToggleLayersVisible: () => void;
  onToggleInspectorVisible: () => void;
  onToggleMainCanvas: () => void;
  onToggleComponentCanvas: () => void;
  onToggleNodeLogic: () => void;
  onToggleCodeWorkspace: () => void;
  onToggleMotionTimeline: () => void;
  onEnterFullscreen: () => void;
  onUpdateToolbarHint: (panel: string, description: string, shortcuts?: string[]) => void;
}

const TOOLS_MENU_ITEMS: ReadonlyArray<{ id: CanvasToolId; label: string; shortcut: string }> = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'direct-selection', label: 'Direct Selection', shortcut: 'A' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'draw-rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'draw-ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'draw-text', label: 'Text', shortcut: 'T' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'curvature', label: 'Curvature', shortcut: 'U' },
  { id: 'shape-builder', label: 'Shape Builder', shortcut: 'Shift+M' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
];

export function GlobalToolbar({
  projectName,
  isHydrating,
  openMenu,
  menuActions,
  menuBarRef,
  projectFileInputRef,
  pagesRackToggleRef,
  componentRackToggleRef,
  tokensRackToggleRef,
  projectNameEditing,
  projectNameDraft,
  pagesRackOpen,
  componentRackOpen,
  tokensRackOpen,
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
  codeWorkspaceOpen,
  motionTimelineOpen,
  shortcutsModalOpen,
  toolbarHintStore,
  onToggleMenu,
  onCloseMenus,
  onOpenProjectPicker,
  onProjectFileSelected,
  onExportCurrentProject,
  onExportActiveCanvasSvg,
  onExportActiveCanvasPng,
  onResetWindowLayout,
  onOpenShortcutsModal,
  onOpenDiagnosticsModal,
  onStartProjectRename,
  onProjectNameDraftChange,
  onCommitProjectRename,
  onCancelProjectRename,
  onTogglePagesRack,
  onToggleComponentRack,
  onToggleTokensRack,
  onToggleLayersVisible,
  onToggleInspectorVisible,
  onToggleMainCanvas,
  onToggleComponentCanvas,
  onToggleNodeLogic,
  onToggleCodeWorkspace,
  onToggleMotionTimeline,
  onEnterFullscreen,
  onUpdateToolbarHint,
}: GlobalToolbarProps) {
  const [importError, setImportError] = useState<string | null>(null);
  const [studioTheme, setStudioTheme] = useState<'dark' | 'light'>(() => {
    if (typeof document !== 'undefined' && document.documentElement.dataset.studioTheme === 'light') {
      return 'light';
    }
    return 'dark';
  });

  const handleToggleStudioTheme = () => {
    const nextTheme: 'dark' | 'light' = studioTheme === 'dark' ? 'light' : 'dark';
    setStudioTheme(nextTheme);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.studioTheme = nextTheme;
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute('content', nextTheme === 'light' ? '#f4f6fa' : '#0b0d12');
      }
    }
    try {
      window.localStorage.setItem('folio.studio-theme.v1', nextTheme);
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  };

  const handleOpenProjectPickerClick = () => {
    setImportError(null);
    onOpenProjectPicker();
  };

  const handleFileInputChange = async (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the native input so the same file can be selected again after failure.
    input.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const outcome = await onProjectFileSelected(file);
      if (outcome && outcome.ok === false) {
        setImportError(outcome.error.trim().length > 0
          ? outcome.error
          : 'Unable to open the selected .flop project file.');
      }
    } catch (error: unknown) {
      const detail = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unable to open the selected .flop project file.';
      setImportError(detail);
    }
  };

  const runMenuAction = (action: () => void) => {
    onCloseMenus();
    action();
  };

  return (
    <header
      class={`global-toolbar-slot ${openMenu !== null ? 'has-open-menu' : ''}`}
      aria-label="FOLIO application toolbar"
    >
      <nav class="global-menu-bar" aria-label="Application menus">
        <div class="global-toolbar-left">
          <div class="global-brand-mark" aria-hidden="true" title="Folio Studio">
            <span class="global-brand-glyph">F</span>
          </div>
          <div class="global-menu-items" ref={menuBarRef}>
            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'file'}
                onClick={() => onToggleMenu('file')}
                onMouseEnter={() => onUpdateToolbarHint('FILE', 'Open or export the current native .flop project.')}
              >
                File
              </button>
              {openMenu === 'file' && (
                <div class="global-menu-dropdown" role="menu" aria-label="File menu">
                  <button type="button" role="menuitem" onClick={handleOpenProjectPickerClick} disabled={isHydrating}>
                    Open Project…
                  </button>
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onExportCurrentProject)} disabled={isHydrating}>
                    Export Project (.flop)
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onExportActiveCanvasSvg)} disabled={isHydrating}>
                    Export SVG
                  </button>
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onExportActiveCanvasPng)} disabled={isHydrating}>
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

            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'edit'}
                onClick={() => onToggleMenu('edit')}
                onMouseEnter={() => onUpdateToolbarHint('EDIT', 'History, clipboard, grouping, masking, and selection commands.')}
              >
                Edit
              </button>
              {openMenu === 'edit' && (
                <div class="global-menu-dropdown" role="menu" aria-label="Edit menu">
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canUndo} onClick={() => runMenuAction(menuActions.onUndo)}>
                    <span>Undo</span>
                    <kbd class="global-menu-shortcut">Ctrl+Z</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canRedo} onClick={() => runMenuAction(menuActions.onRedo)}>
                    <span>Redo</span>
                    <kbd class="global-menu-shortcut">Ctrl+Shift+Z</kbd>
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.hasSelection} onClick={() => runMenuAction(menuActions.onCut)}>
                    <span>Cut</span>
                    <kbd class="global-menu-shortcut">Ctrl+X</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.hasSelection} onClick={() => runMenuAction(menuActions.onCopy)}>
                    <span>Copy</span>
                    <kbd class="global-menu-shortcut">Ctrl+C</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.hasClipboard} onClick={() => runMenuAction(menuActions.onPaste)}>
                    <span>Paste</span>
                    <kbd class="global-menu-shortcut">Ctrl+V</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.hasSelection} onClick={() => runMenuAction(menuActions.onDuplicate)}>
                    <span>Duplicate</span>
                    <kbd class="global-menu-shortcut">Ctrl+Shift+D</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating} onClick={() => runMenuAction(menuActions.onSelectAll)}>
                    <span>Select All</span>
                    <kbd class="global-menu-shortcut">Ctrl+A</kbd>
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canGroup} onClick={() => runMenuAction(menuActions.onGroup)}>
                    <span>Group Layers</span>
                    <kbd class="global-menu-shortcut">Ctrl+G</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canUngroup} onClick={() => runMenuAction(menuActions.onUngroup)}>
                    <span>Ungroup Layers</span>
                    <kbd class="global-menu-shortcut">Ctrl+Shift+G</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canMask} onClick={() => runMenuAction(menuActions.onCreateMask)}>
                    <span>Create Clipping Mask</span>
                    <kbd class="global-menu-shortcut">Ctrl+M</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.canUnmask} onClick={() => runMenuAction(menuActions.onRemoveMask)}>
                    <span>Remove Clipping Mask</span>
                    <kbd class="global-menu-shortcut">Ctrl+Shift+M</kbd>
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" disabled={isHydrating || !menuActions.hasSelection} onClick={() => runMenuAction(menuActions.onDelete)}>
                    <span>Delete</span>
                    <kbd class="global-menu-shortcut">Del</kbd>
                  </button>
                </div>
              )}
            </div>

            <span class="global-menu-separator" aria-hidden="true">|</span>

            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'view'}
                onClick={() => onToggleMenu('view')}
                onMouseEnter={() => onUpdateToolbarHint('VIEW', 'Workspace display, panels, zoom and window layout controls.')}
              >
                View
              </button>
              {openMenu === 'view' && (
                <div class="global-menu-dropdown" role="menu" aria-label="View menu">
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(menuActions.onZoomIn)}>
                    <span>Zoom In</span>
                    <kbd class="global-menu-shortcut">+</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(menuActions.onZoomOut)}>
                    <span>Zoom Out</span>
                    <kbd class="global-menu-shortcut">−</kbd>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(menuActions.onZoomReset)}>
                    <span>Reset Zoom (100%)</span>
                    <kbd class="global-menu-shortcut">100%</kbd>
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(onToggleLayersVisible)}>
                    <span><span class="global-menu-check">{layersVisible ? '✓' : ''}</span>Layers Sidebar</span>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(onToggleInspectorVisible)}>
                    <span><span class="global-menu-check">{inspectorVisible ? '✓' : ''}</span>Inspector Panel</span>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(onToggleNodeLogic)}>
                    <span><span class="global-menu-check">{nodeLogicOpen ? '✓' : ''}</span>Node Logic Workspace</span>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(onToggleCodeWorkspace)}>
                    <span><span class="global-menu-check">{codeWorkspaceOpen ? '✓' : ''}</span>Code &amp; Preview Studio</span>
                  </button>
                  <button type="button" role="menuitem" class="global-menu-item-with-shortcut" onClick={() => runMenuAction(onToggleMotionTimeline)}>
                    <span><span class="global-menu-check">{motionTimelineOpen ? '✓' : ''}</span>Motion Timeline</span>
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onResetWindowLayout)}>
                    Reset Window Layout
                  </button>
                </div>
              )}
            </div>

            <span class="global-menu-separator" aria-hidden="true">|</span>

            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'tools'}
                onClick={() => onToggleMenu('tools')}
                onMouseEnter={() => onUpdateToolbarHint('TOOLS', 'Switch canvas tools and invoke vector pathfinder or transform operations.')}
              >
                Tools
              </button>
              {openMenu === 'tools' && (
                <div class="global-menu-dropdown" role="menu" aria-label="Tools menu">
                  {TOOLS_MENU_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      class="global-menu-item-with-shortcut"
                      disabled={isHydrating}
                      onClick={() => runMenuAction(() => menuActions.onSelectTool(item.id))}
                    >
                      <span>
                        <span class="global-menu-check">{menuActions.activeToolId === item.id ? '✓' : ''}</span>
                        {item.label}
                      </span>
                      <kbd class="global-menu-shortcut">{item.shortcut}</kbd>
                    </button>
                  ))}
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.canPathfinder} onClick={() => runMenuAction(() => menuActions.onPathfinder('unite'))}>
                    Pathfinder: Unite
                  </button>
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.canPathfinder} onClick={() => runMenuAction(() => menuActions.onPathfinder('subtract'))}>
                    Pathfinder: Subtract
                  </button>
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.canPathfinder} onClick={() => runMenuAction(() => menuActions.onPathfinder('intersect'))}>
                    Pathfinder: Intersect
                  </button>
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.canPathfinder} onClick={() => runMenuAction(() => menuActions.onPathfinder('exclude'))}>
                    Pathfinder: Exclude
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.canConvertToPath} onClick={() => runMenuAction(menuActions.onConvertToPath)}>
                    Convert to Path
                  </button>
                  <button type="button" role="menuitem" disabled={isHydrating || !menuActions.hasSelection} onClick={() => runMenuAction(menuActions.onRotate90)}>
                    Rotate +90°
                  </button>
                </div>
              )}
            </div>

            <span class="global-menu-separator" aria-hidden="true">|</span>

            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'option'}
                onClick={() => onToggleMenu('option')}
                onMouseEnter={() => onUpdateToolbarHint('OPTION', 'Design token themes, workspace racks, and layout preferences.')}
              >
                Option
              </button>
              {openMenu === 'option' && (
                <div class="global-menu-dropdown" role="menu" aria-label="Option menu">
                  <div class="global-menu-section-label">Design Token Theme</div>
                  {menuActions.themes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      role="menuitem"
                      disabled={isHydrating}
                      onClick={() => runMenuAction(() => menuActions.onSelectTheme(theme.id))}
                    >
                      <span class="global-menu-check">{menuActions.activeThemeId === theme.id ? '✓' : ''}</span>
                      {theme.name}
                    </button>
                  ))}
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onToggleTokensRack)}>
                    <span class="global-menu-check">{tokensRackOpen ? '✓' : ''}</span>
                    Design Tokens Rack
                  </button>
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onTogglePagesRack)}>
                    <span class="global-menu-check">{pagesRackOpen ? '✓' : ''}</span>
                    Pages Rack
                  </button>
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onToggleComponentRack)}>
                    <span class="global-menu-check">{componentRackOpen ? '✓' : ''}</span>
                    Component Rack
                  </button>
                  <div class="global-menu-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={() => runMenuAction(onResetWindowLayout)}>
                    Reset Window Layout
                  </button>
                </div>
              )}
            </div>

            <span class="global-menu-separator" aria-hidden="true">|</span>

            <div class="global-menu-entry">
              <button
                type="button"
                class="global-menu-item menu-trigger"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'help'}
                onClick={() => onToggleMenu('help')}
                onMouseEnter={() => onUpdateToolbarHint('HELP', 'Open the categorized Keyboard Shortcuts cheat sheet.', ['KEY: ?', 'CTRL/CMD + /'])}
              >
                Help
              </button>
              {openMenu === 'help' && (
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
                  {onOpenDiagnosticsModal && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onCloseMenus();
                        onOpenDiagnosticsModal();
                      }}
                      disabled={isHydrating}
                    >
                      Scene Profiler &amp; Health
                    </button>
                  )}
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
            <button
              ref={tokensRackToggleRef}
              class={`global-panel-toggle tokens-rack-header-toggle ${tokensRackOpen ? 'active' : ''}`}
              type="button"
              title={tokensRackOpen ? 'Close Design Tokens' : 'Open Design Tokens'}
              aria-label={tokensRackOpen ? 'Close Design Tokens' : 'Open Design Tokens'}
              aria-pressed={tokensRackOpen}
              onClick={onToggleTokensRack}
              onMouseEnter={() => onUpdateToolbarHint('DESIGN TOKENS', 'Manage semantic tokens, Light/Dark themes, and CSS custom properties.')}
            >
              <StudioIcon name="tokens" />
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
            <button
              class={`global-panel-toggle code-studio-header-toggle ${codeWorkspaceOpen ? 'active' : ''}`}
              type="button"
              title={codeWorkspaceOpen ? 'Close Code & Preview Studio' : 'Open Code & Preview Studio'}
              aria-label={codeWorkspaceOpen ? 'Close Code & Preview Studio' : 'Open Code & Preview Studio'}
              aria-pressed={codeWorkspaceOpen}
              onClick={onToggleCodeWorkspace}
              onMouseEnter={() => onUpdateToolbarHint('CODE & PREVIEW', 'Inspect compiled HTML/CSS & React TSX, sync mapped AST changes, author Custom/Extension code, and test Live Preview.')}
            >
              <StudioIcon name="code" />
            </button>
            <button
              class={`global-panel-toggle motion-timeline-header-toggle ${motionTimelineOpen ? 'active' : ''}`}
              type="button"
              title={motionTimelineOpen ? 'Close Motion Timeline' : 'Open Motion Timeline'}
              aria-label={motionTimelineOpen ? 'Close Motion Timeline' : 'Open Motion Timeline'}
              aria-pressed={motionTimelineOpen}
              onClick={onToggleMotionTimeline}
              onMouseEnter={() => onUpdateToolbarHint('MOTION TIMELINE', 'Author keyframe animations, scrub live poses on Canvas, apply presets, and compile CSS @keyframes.')}
            >
              <StudioIcon name="motion" />
            </button>
          </div>
          <span class="global-panel-group-divider" aria-hidden="true" />
          <div class="global-panel-group" role="group" aria-label="Utilities">
            <button
              class={`global-panel-toggle studio-theme-toggle ${studioTheme === 'light' ? 'active' : ''}`}
              type="button"
              title={studioTheme === 'dark' ? 'Switch to Daylight Atelier (Light) theme' : 'Switch to Obsidian Studio (Dark) theme'}
              aria-label={studioTheme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
              aria-pressed={studioTheme === 'light'}
              onClick={handleToggleStudioTheme}
              onMouseEnter={() =>
                onUpdateToolbarHint(
                  'STUDIO THEME',
                  studioTheme === 'dark'
                    ? 'Switch workspace chrome to Daylight Atelier light mode.'
                    : 'Switch workspace chrome to Obsidian Studio dark mode.',
                )
              }
            >
              <StudioIcon name={studioTheme === 'dark' ? 'sun' : 'moon'} />
            </button>
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
      {importError && (
        <div class="project-import-error" role="alert" aria-live="assertive">
          <div class="project-import-error-copy">
            <strong>Project import blocked</strong>
            <span>{importError}</span>
          </div>
          <button
            type="button"
            class="project-import-error-dismiss"
            aria-label="Dismiss project import error"
            onClick={() => setImportError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
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

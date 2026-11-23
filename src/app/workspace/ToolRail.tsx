import type { RefObject } from 'preact';
import type { CanvasToolId } from '../../core/tools/operationContract';
import type { StudioTemplateDefinition, TemplateInsertMode } from '../../core/document/templates';
import type { EditorTarget } from '../editorContext';
import { TemplateLibraryPopover } from '../TemplateLibraryPopover';
import { StudioIcon } from './StudioIcon';

export interface ToolRailToolDescriptor {
  id: CanvasToolId;
  label: string;
  description: string;
  icon: string;
  shortcut?: string;
}

export interface ToolRailGroupDescriptor {
  id: string;
  label: string;
  description: string;
  icon: string;
  tools: readonly CanvasToolId[];
}

export interface ToolRailProps {
  toolRailRef: RefObject<HTMLElement>;
  activeEditorId: EditorTarget;
  activeCanvasToolId: CanvasToolId;
  toolGroups: readonly ToolRailGroupDescriptor[];
  resolveTool: (toolId: CanvasToolId) => ToolRailToolDescriptor;
  toolRackOpen: string | null;
  templateInsertMode: TemplateInsertMode;
  canUndo: boolean;
  canRedo: boolean;
  onCloseTopMenus: () => void;
  onToggleToolRack: (groupId: string | null) => void;
  onChooseTool: (toolId: CanvasToolId) => void;
  onTemplateInsertModeChange: (mode: TemplateInsertMode) => void;
  onInsertTemplate: (template: StudioTemplateDefinition, mode: TemplateInsertMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateToolbarHint: (panel: string, description: string, shortcuts?: string[]) => void;
}

export function ToolRail({
  toolRailRef,
  activeEditorId,
  activeCanvasToolId,
  toolGroups,
  resolveTool,
  toolRackOpen,
  templateInsertMode,
  canUndo,
  canRedo,
  onCloseTopMenus,
  onToggleToolRack,
  onChooseTool,
  onTemplateInsertModeChange,
  onInsertTemplate,
  onUndo,
  onRedo,
  onUpdateToolbarHint,
}: ToolRailProps) {
  return (
    <nav
      ref={toolRailRef}
      class={'tool-rail' + (activeEditorId === 'component' ? ' is-component-studio' : '')}
      data-workspace={activeEditorId}
      aria-label="Tool Rack"
      onMouseEnter={() => onUpdateToolbarHint(
        activeEditorId === 'component' ? 'VECTOR STUDIO' : 'TOOL RACK',
        activeEditorId === 'component'
          ? 'Adobe Illustrator-grade Vector Craft Studio for Component Canvas: Pen, Curvature, Anchor Point, Pencil, Smooth, Scissors, Shapes, and Pathfinder.'
          : 'Figma-grade Layout & Design Studio for Main Canvas: Selection, Frame, Shapes, Pen, Text, Eyedropper, Measure, and Navigation.',
      )}
    >
      <div class={'tool-rack-caption' + (activeEditorId === 'component' ? ' is-component' : '')}>
        {activeEditorId === 'component' ? 'VECTOR' : 'PAGE'}
      </div>
      {toolGroups.map((group) => {
        const activeInGroup = group.tools.includes(activeCanvasToolId);
        const activeTool = activeInGroup ? resolveTool(activeCanvasToolId) : null;
        const isSingleTool = group.tools.length === 1;
        const primaryTool = resolveTool(group.tools[0]);
        return (
          <div class="tool-rack-group" key={group.id}>
            <button
              type="button"
              class={'tool-rack-group-trigger ' + (activeInGroup ? 'active' : '') + (toolRackOpen === group.id ? ' open' : '')}
              title={isSingleTool ? `${primaryTool.label}${primaryTool.shortcut ? ` (${primaryTool.shortcut})` : ''}` : group.label + ' tools'}
              aria-label={group.label + ' tools'}
              aria-expanded={isSingleTool ? undefined : toolRackOpen === group.id}
              onClick={() => {
                onCloseTopMenus();
                if (isSingleTool) {
                  onChooseTool(group.tools[0]);
                } else {
                  onToggleToolRack(toolRackOpen === group.id ? null : group.id);
                }
              }}
              onMouseEnter={() => onUpdateToolbarHint(
                (activeTool ?? group).label.toUpperCase(),
                activeTool ? activeTool.description : group.description,
                activeTool?.shortcut ? [`KEY: ${activeTool.shortcut.toUpperCase()}`] : [],
              )}
            >
              <StudioIcon name={activeTool?.icon ?? group.icon} />
              <span>{group.label}</span>
              {!isSingleTool && <span class="tool-rack-corner-tick" aria-hidden="true" />}
            </button>
            {!isSingleTool && toolRackOpen === group.id && (
              <div class="tool-rack-menu" role="menu" aria-label={group.label + ' tools'}>
                {group.tools.map((id) => {
                  const tool = resolveTool(id);
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeCanvasToolId === id}
                      class={'tool-rack-item ' + (activeCanvasToolId === id ? 'active' : '')}
                      key={id}
                      onClick={() => onChooseTool(id)}
                      onMouseEnter={() => onUpdateToolbarHint(
                        tool.label.toUpperCase(),
                        tool.description,
                        tool.shortcut ? [`KEY: ${tool.shortcut.toUpperCase()}`] : [],
                      )}
                    >
                      <span class="tool-rack-item-icon"><StudioIcon name={tool.icon} /></span>
                      <span class="tool-rack-item-name">{tool.label}</span>
                      {tool.shortcut && <kbd class="tool-rack-shortcut">{tool.shortcut}</kbd>}
                      {activeCanvasToolId === id && <span class="tool-rack-active-mark">●</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div class="rail-separator" />
      <div class="tool-rack-group">
        <button
          type="button"
          class={'tool-rack-group-trigger ' + (toolRackOpen === 'templates' ? 'active open' : '')}
          title="Templates — Component & Section Library"
          aria-label="Template library"
          aria-expanded={toolRackOpen === 'templates'}
          onClick={() => {
            onCloseTopMenus();
            onToggleToolRack(toolRackOpen === 'templates' ? null : 'templates');
          }}
          onMouseEnter={() => onUpdateToolbarHint(
            'TEMPLATES',
            activeEditorId === 'component'
              ? 'Browse Vector Starter Kits and UI presets to insert directly as editable layers inside the active Master Component.'
              : 'Browse ready-to-edit UI Components, Page Sections, and Vector Kits — insert as editable Nodes or reusable Master Components.',
          )}
        >
          <StudioIcon name="templates" />
          <span>Templates</span>
          <span class="tool-rack-corner-tick" aria-hidden="true" />
        </button>
        {toolRackOpen === 'templates' && (
          <TemplateLibraryPopover
            workspace={activeEditorId}
            insertMode={templateInsertMode}
            onInsertModeChange={onTemplateInsertModeChange}
            onInsertTemplate={onInsertTemplate}
            onHoverHint={onUpdateToolbarHint}
            onClose={() => onToggleToolRack(null)}
          />
        )}
      </div>
      <div class="rail-bottom">
        <button class="tool-button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
          <StudioIcon name="undo" />
        </button>
        <button class="tool-button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
          <StudioIcon name="redo" />
        </button>
      </div>
    </nav>
  );
}

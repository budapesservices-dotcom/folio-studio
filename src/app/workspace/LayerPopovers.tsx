import type { RefObject } from 'preact';
import type { DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import {
  LAYER_COLOR_PRESETS,
  type LayerContextMenuCapabilities,
  type LayerContextMenuState,
} from './layerOperations';
import { StudioIcon } from './StudioIcon';

export interface LayerColorPaletteProps {
  pickerKey: string | null;
  activeEditorId: EditorTarget;
  layerSourceNodes: readonly DesignNode[];
  position: { top: number; left: number } | null;
  paletteRef: RefObject<HTMLDivElement>;
  onSelectPresetColor: (nodeId: string, color: string) => void;
  onSelectCustomColor: (nodeId: string, color: string) => void;
}

/**
 * Root-mounted Layer Color Palette popover.
 * MUST be rendered directly as a child of `.app-shell` so `.layers-panel`
 * stacking context / overflow never clips it.
 */
export function LayerColorPalette({
  pickerKey,
  activeEditorId,
  layerSourceNodes,
  position,
  paletteRef,
  onSelectPresetColor,
  onSelectCustomColor,
}: LayerColorPaletteProps) {
  if (!pickerKey) return null;
  const prefix = `${activeEditorId}:`;
  if (!pickerKey.startsWith(prefix)) return null;
  const targetNodeId = pickerKey.slice(prefix.length);
  const colorNode = layerSourceNodes.find((item) => item.id === targetNodeId);
  if (!colorNode) return null;

  return (
    <div
      ref={paletteRef}
      class="layer-color-palette"
      style={position ? { top: `${position.top}px`, left: `${position.left}px` } : undefined}
      role="group"
      aria-label={`Color tags for ${colorNode.name}`}
      onClick={(event) => event.stopPropagation()}
    >
      <span>Layer color</span>
      <div class="layer-color-swatches">
        {LAYER_COLOR_PRESETS.map((color) => (
          <button
            type="button"
            key={color}
            class={'layer-color-swatch ' + (colorNode.layerColor === color ? 'active' : '')}
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`Apply ${color} to selected layers`}
            onClick={() => onSelectPresetColor(colorNode.id, color)}
          />
        ))}
      </div>
      <label class="layer-color-custom">
        <span>Custom</span>
        <input
          type="color"
          value={colorNode.layerColor ?? '#7f8797'}
          aria-label="Custom layer color"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectCustomColor(colorNode.id, event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

export interface LayerContextMenuProps {
  menu: LayerContextMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  targetNodeName: string;
  capabilities: LayerContextMenuCapabilities;
  onRename: (nodeId: string) => void;
  onGroup: (editorId: EditorTarget, rootIds: string[]) => void;
  onUngroup: (editorId: EditorTarget, rootIds: string[]) => void;
  onCreateClippingMask: (editorId: EditorTarget, rootId: string) => void;
  onRemoveClippingMask: (editorId: EditorTarget, rootId: string) => void;
  onDelete: (editorId: EditorTarget, nodeIds: string[]) => void;
}

/**
 * Root-mounted Layer Context Menu.
 * MUST be rendered directly as a child of `.app-shell` so `.layers-panel`
 * stacking context / overflow never clips it.
 */
export function LayerContextMenu({
  menu,
  menuRef,
  targetNodeName,
  capabilities,
  onRename,
  onGroup,
  onUngroup,
  onCreateClippingMask,
  onRemoveClippingMask,
  onDelete,
}: LayerContextMenuProps) {
  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      class="layer-context-menu"
      role="menu"
      aria-label={`Actions for ${targetNodeName}`}
      style={{ position: 'fixed', left: menu.x + 'px', top: menu.y + 'px' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => onRename(menu.nodeId)}>
        Rename
      </button>
      {capabilities.canGroup && (
        <button type="button" role="menuitem" onClick={() => onGroup(menu.editorId, capabilities.rootIds)}>
          Group
        </button>
      )}
      {capabilities.canUngroup && (
        <button type="button" role="menuitem" onClick={() => onUngroup(menu.editorId, capabilities.rootIds)}>
          Ungroup
        </button>
      )}
      {capabilities.canMask && (
        <button type="button" role="menuitem" onClick={() => onCreateClippingMask(menu.editorId, capabilities.rootIds[0])}>
          Create Clipping Mask
        </button>
      )}
      {capabilities.canUnmask && (
        <button type="button" role="menuitem" onClick={() => onRemoveClippingMask(menu.editorId, capabilities.rootIds[0])}>
          Release Clipping Mask
        </button>
      )}
      <div class="layer-context-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        class="layer-context-menu-danger"
        onClick={() => onDelete(menu.editorId, menu.nodeIds)}
      >
        <StudioIcon name="trash" /> Delete{menu.nodeIds.length > 1 ? ` (${menu.nodeIds.length})` : ''}
      </button>
    </div>
  );
}

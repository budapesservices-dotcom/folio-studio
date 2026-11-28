import type { RefObject } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import type { DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import {
  LAYER_COLOR_PRESETS,
  type LayerContextMenuCapabilities,
  type LayerContextMenuState,
} from './layerOperations';
import { StudioIcon } from './StudioIcon';
import { clampContextMenuPosition, formatContextShortcut } from './StudioContextMenu';

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
  targetNodeVisible?: boolean;
  targetNodeLocked?: boolean;
  canPaste?: boolean;
  capabilities: LayerContextMenuCapabilities;
  referenceWarning?: { logicCount: number; motionCount: number; codeExtensionCount?: number } | null;
  onRename: (nodeId: string) => void;
  onCopy?: (editorId: EditorTarget) => void;
  onCut?: (editorId: EditorTarget) => void;
  onPaste?: (editorId: EditorTarget) => void;
  onDuplicate?: (editorId: EditorTarget) => void;
  onToggleVisible?: (nodeId: string) => void;
  onToggleLock?: (nodeId: string) => void;
  onArrange?: (editorId: EditorTarget, direction: 'forward' | 'backward' | 'front' | 'back') => void;
  onCombineSelection?: (editorId: EditorTarget) => void;
  onSaveAsComponent?: (editorId: EditorTarget) => void;
  onGroup: (editorId: EditorTarget, rootIds: string[]) => void;
  onUngroup: (editorId: EditorTarget, rootIds: string[]) => void;
  onCreateClippingMask: (editorId: EditorTarget, rootId: string) => void;
  onRemoveClippingMask: (editorId: EditorTarget, rootId: string) => void;
  onUnpackComponent?: (editorId: EditorTarget, nodeId: string) => void;
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
  targetNodeVisible = true,
  targetNodeLocked = false,
  canPaste = false,
  capabilities,
  referenceWarning,
  onRename,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onToggleVisible,
  onToggleLock,
  onArrange,
  onCombineSelection,
  onSaveAsComponent,
  onGroup,
  onUngroup,
  onCreateClippingMask,
  onRemoveClippingMask,
  onUnpackComponent,
  onDelete,
}: LayerContextMenuProps) {
  const [coords, setCoords] = useState<{ x: number; y: number }>({
    x: menu?.x ?? 0,
    y: menu?.y ?? 0,
  });

  useLayoutEffect(() => {
    if (!menu) return;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const el = menuRef.current;
    const w = el ? el.offsetWidth || 236 : 236;
    const h = el ? el.offsetHeight || 340 : 340;
    setCoords(clampContextMenuPosition(menu.x, menu.y, w, h, vw, vh));
  }, [menu, menuRef]);

  if (!menu) return null;

  const codeExtCount = referenceWarning?.codeExtensionCount ?? 0;
  const hasRefWarning = Boolean(
    referenceWarning && (referenceWarning.logicCount > 0 || referenceWarning.motionCount > 0 || codeExtCount > 0),
  );
  const refBadgeParts: string[] = [];
  if (referenceWarning && referenceWarning.logicCount > 0) {
    refBadgeParts.push(`${referenceWarning.logicCount} Logic`);
  }
  if (referenceWarning && referenceWarning.motionCount > 0) {
    refBadgeParts.push(`${referenceWarning.motionCount} Motion`);
  }
  if (codeExtCount > 0) {
    refBadgeParts.push(`${codeExtCount} Code`);
  }
  const deleteTitle = hasRefWarning
    ? `Used in ${refBadgeParts.join(', ')}. Deleting safely unbinds Logic/Code anchors (preserving custom code) and removes Motion tracks (Undo restores everything).`
    : undefined;

  const kbd = (tokens: readonly string[]) => {
    const label = formatContextShortcut(tokens);
    return label ? <kbd class="studio-context-menu-kbd">{label}</kbd> : null;
  };

  return (
    <div
      ref={menuRef}
      class="layer-context-menu studio-context-menu"
      role="menu"
      data-testid="layer-context-menu"
      aria-label={`Actions for ${targetNodeName}`}
      style={{ position: 'fixed', left: coords.x + 'px', top: coords.y + 'px' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div class="studio-context-menu-header">
        <span>{menu.nodeIds.length > 1 ? `${menu.nodeIds.length} Layers Selected` : targetNodeName}</span>
      </div>

      <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onRename(menu.nodeId)}>
        <span class="studio-context-menu-label">Rename</span>
        {kbd(['F2'])}
      </button>

      {(onCopy || onCut || onPaste || onDuplicate) && (
        <>
          <div class="layer-context-menu-separator studio-context-menu-divider" role="separator" />
          {onCopy && (
            <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onCopy(menu.editorId)}>
              <span class="studio-context-menu-label">Copy</span>
              {kbd(['Mod', 'C'])}
            </button>
          )}
          {onCut && (
            <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onCut(menu.editorId)}>
              <span class="studio-context-menu-label">Cut</span>
              {kbd(['Mod', 'X'])}
            </button>
          )}
          {onPaste && (
            <button
              type="button"
              role="menuitem"
              class="studio-context-menu-item"
              disabled={!canPaste}
              onClick={() => onPaste(menu.editorId)}
            >
              <span class="studio-context-menu-label">Paste</span>
              {kbd(['Mod', 'V'])}
            </button>
          )}
          {onDuplicate && (
            <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onDuplicate(menu.editorId)}>
              <span class="studio-context-menu-label">Duplicate</span>
              {kbd(['Mod', 'D'])}
            </button>
          )}
        </>
      )}

      {(capabilities.canGroup || capabilities.canUngroup || capabilities.canMask || capabilities.canUnmask || capabilities.canUnpackComponent || (onCombineSelection && menu.nodeIds.length >= 2) || onSaveAsComponent) && (
        <div class="layer-context-menu-separator studio-context-menu-divider" role="separator" />
      )}

      {capabilities.canGroup && (
        <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onGroup(menu.editorId, capabilities.rootIds)}>
          <span class="studio-context-menu-label">Group</span>
          {kbd(['Mod', 'G'])}
        </button>
      )}
      {capabilities.canUngroup && (
        <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onUngroup(menu.editorId, capabilities.rootIds)}>
          <span class="studio-context-menu-label">Ungroup</span>
          {kbd(['Mod', 'Shift', 'G'])}
        </button>
      )}
      {onCombineSelection && menu.nodeIds.length >= 2 && (
        <button
          type="button"
          role="menuitem"
          class="studio-context-menu-item is-accent"
          onClick={() => onCombineSelection(menu.editorId)}
        >
          <span class="studio-context-menu-label">Render to SVG</span>
        </button>
      )}
      {capabilities.canMask && (
        <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onCreateClippingMask(menu.editorId, capabilities.rootIds[0])}>
          <span class="studio-context-menu-label">Create Clipping Mask</span>
          {kbd(['Mod', 'M'])}
        </button>
      )}
      {capabilities.canUnmask && (
        <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onRemoveClippingMask(menu.editorId, capabilities.rootIds[0])}>
          <span class="studio-context-menu-label">Release Clipping Mask</span>
          {kbd(['Mod', 'Shift', 'M'])}
        </button>
      )}
      {capabilities.canUnpackComponent && onUnpackComponent && (
        <button
          type="button"
          role="menuitem"
          class="studio-context-menu-item is-accent"
          data-testid="layer-context-unpack-btn"
          onClick={() => onUnpackComponent(menu.editorId, capabilities.rootIds[0])}
        >
          <span class="studio-context-menu-label">Unpack Component to Layers</span>
        </button>
      )}
      {onSaveAsComponent && (
        <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onSaveAsComponent(menu.editorId)}>
          <span class="studio-context-menu-label">Save as Component</span>
        </button>
      )}

      {onArrange && (
        <>
          <div class="layer-context-menu-separator studio-context-menu-divider" role="separator" />
          <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onArrange(menu.editorId, 'forward')}>
            <span class="studio-context-menu-label">Bring Forward</span>
            {kbd([']'])}
          </button>
          <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onArrange(menu.editorId, 'backward')}>
            <span class="studio-context-menu-label">Send Backward</span>
            {kbd(['['])}
          </button>
          <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onArrange(menu.editorId, 'front')}>
            <span class="studio-context-menu-label">Bring to Front</span>
            {kbd(['Mod', ']'])}
          </button>
          <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onArrange(menu.editorId, 'back')}>
            <span class="studio-context-menu-label">Send to Back</span>
            {kbd(['Mod', '['])}
          </button>
        </>
      )}

      {(onToggleVisible || onToggleLock) && (
        <>
          <div class="layer-context-menu-separator studio-context-menu-divider" role="separator" />
          {onToggleVisible && (
            <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onToggleVisible(menu.nodeId)}>
              <span class="studio-context-menu-label">{targetNodeVisible ? 'Hide Layer' : 'Show Layer'}</span>
              {kbd(['Mod', 'Shift', 'H'])}
            </button>
          )}
          {onToggleLock && (
            <button type="button" role="menuitem" class="studio-context-menu-item" onClick={() => onToggleLock(menu.nodeId)}>
              <span class="studio-context-menu-label">{targetNodeLocked ? 'Unlock Layer' : 'Lock Layer'}</span>
              {kbd(['Mod', 'Shift', 'L'])}
            </button>
          )}
        </>
      )}

      <div class="layer-context-menu-separator studio-context-menu-divider" role="separator" />
      <button
        type="button"
        role="menuitem"
        class={`studio-context-menu-item is-danger layer-context-menu-danger${hasRefWarning ? ' has-ref-warning' : ''}`}
        title={deleteTitle}
        onClick={() => onDelete(menu.editorId, menu.nodeIds)}
      >
        <span class="studio-context-menu-item-main">
          <StudioIcon name="trash" />
          <span>Delete{menu.nodeIds.length > 1 ? ` (${menu.nodeIds.length})` : ''}</span>
          {hasRefWarning && (
            <span class="layer-context-ref-badge" aria-label={`Referenced by ${refBadgeParts.join(' and ')}`}>
              {refBadgeParts.join(' · ')}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}


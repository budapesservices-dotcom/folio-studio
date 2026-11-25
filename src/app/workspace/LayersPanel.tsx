import type { JSX, RefObject } from 'preact';
import { useRef } from 'preact/hooks';
import type { EffectiveLayerState, LayerDropPosition, LayerPanelRow } from '../../core/document/layers';
import type { DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import { PANEL_RESIZE_CONSTRAINTS, type ResizablePanelId } from '../panelResize';
import { tokenizeLayerSearchQuery, type LayerRenameSession } from './layerOperations';
import { LayerTypeIcon, StudioIcon } from './StudioIcon';

export interface LayersPanelProps {
  visible: boolean;
  width: number;
  isResizing: boolean;
  resizeHandleRef: RefObject<HTMLDivElement>;
  activeEditorId: EditorTarget;
  focusedPageId: string | undefined;
  layerContextLabel: string;
  layerContextTitle: string;
  layerSourceNodes: readonly DesignNode[];
  layerRows: readonly LayerPanelRow[];
  layerEffectiveStates: ReadonlyMap<string, EffectiveLayerState>;
  selectedNodeIds: readonly string[];
  collapsedLayerIds: readonly string[];
  layerDropTarget: { nodeId: string; position: LayerDropPosition } | null;
  layerRename: LayerRenameSession | null;
  layerRenameInputRef: RefObject<HTMLInputElement>;
  layerColorPickerKey: string | null;
  searchQuery?: string;
  isSearchActive?: boolean;
  searchMatchedIds?: ReadonlySet<string>;
  searchMatchCount?: number;
  onSearchQueryChange?: (value: string) => void;
  onStartResize: (panel: ResizablePanelId, event: MouseEvent) => void;
  onResizeDoubleClick: (panel: ResizablePanelId, event: MouseEvent) => void;
  onResizeKeyDown: (panel: ResizablePanelId, event: KeyboardEvent) => void;
  onHoverHint: () => void;
  onSelectLayer: (nodeId: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onOpenContextMenu: (nodeId: string, event: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  onStartDrag: (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDragOver: (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDrop: (nodeId: string, event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragLeave: (nodeId: string) => void;
  onToggleCollapsed: (nodeId: string) => void;
  onUpdateRenameDraft: (value: string) => void;
  onFinishRename: (save: boolean) => void;
  onToggleColorPicker: (nodeId: string, anchor: HTMLButtonElement) => void;
  onToggleLayerProperty: (nodeId: string, property: 'visible' | 'locked') => void;
}

export function LayersPanel({
  visible,
  width,
  isResizing,
  resizeHandleRef,
  activeEditorId,
  focusedPageId,
  layerContextLabel,
  layerContextTitle,
  layerSourceNodes,
  layerRows,
  layerEffectiveStates,
  selectedNodeIds,
  collapsedLayerIds,
  layerDropTarget,
  layerRename,
  layerRenameInputRef,
  layerColorPickerKey,
  searchQuery = '',
  isSearchActive = false,
  searchMatchedIds,
  searchMatchCount,
  onSearchQueryChange,
  onStartResize,
  onResizeDoubleClick,
  onResizeKeyDown,
  onHoverHint,
  onSelectLayer,
  onOpenContextMenu,
  onStartDrag,
  onDragOver,
  onDrop,
  onDragEnd,
  onDragLeave,
  onToggleCollapsed,
  onUpdateRenameDraft,
  onFinishRename,
  onToggleColorPicker,
  onToggleLayerProperty,
}: LayersPanelProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTokens = isSearchActive ? tokenizeLayerSearchQuery(searchQuery) : [];
  const effectiveMatchCount = searchMatchCount ?? layerSourceNodes.length;
  const nodeById = new Map<string, DesignNode>();
  const maskBaseIds = new Set<string>();
  for (const item of layerSourceNodes) {
    nodeById.set(item.id, item);
    if (item.clipMaskBaseId) {
      maskBaseIds.add(item.clipMaskBaseId);
    }
  }
  const selectedIdSet = new Set(selectedNodeIds);
  const collapsedIdSet = new Set(collapsedLayerIds);
  return (
    <aside
      class={`layers-panel ${visible ? '' : 'is-hidden'}${activeEditorId === 'component' ? ' is-component-context' : ''}`}
      onMouseEnter={onHoverHint}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Layers sidebar"
        aria-valuenow={width}
        aria-valuemin={PANEL_RESIZE_CONSTRAINTS.layers.minWidth}
        aria-valuemax={PANEL_RESIZE_CONSTRAINTS.layers.maxWidth}
        tabIndex={visible ? 0 : -1}
        data-resize-panel="layers"
        class={`panel-resize-handle panel-resize-handle-right ${isResizing ? 'is-active' : ''}`}
        title="Drag to resize Layers sidebar (double-click to reset)"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => onStartResize('layers', event)}
        onDblClick={(event) => onResizeDoubleClick('layers', event)}
        onKeyDown={(event) => onResizeKeyDown('layers', event)}
      />
      <div class="panel-heading">
        <h2>Layers</h2>
      </div>
      {onSearchQueryChange && (
        <div class="layer-search-bar">
          <div class="layer-search-wrap">
            <svg
              class="layer-search-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchInputRef}
              type="search"
              class="layer-search-input"
              placeholder="Filter layers by name or ID..."
              aria-label="Search layers by name or ID"
              autoComplete="off"
              spellcheck={false}
              value={searchQuery}
              onInput={(event) => onSearchQueryChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (searchQuery) {
                    onSearchQueryChange('');
                  } else {
                    event.currentTarget.blur();
                  }
                  return;
                }
                if (event.key === 'Enter' && isSearchActive) {
                  const firstMatch = layerRows.find(
                    ({ node }) => !searchMatchedIds || searchMatchedIds.has(node.id),
                  );
                  if (firstMatch) {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectLayer(firstMatch.node.id, {});
                  }
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                class="layer-search-clear"
                title="Clear layer search"
                aria-label="Clear layer search"
                onClick={() => {
                  onSearchQueryChange('');
                  searchInputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}
      <div class="layer-list-heading" data-page-id={focusedPageId}>
        <span class="layer-list-count">
          {isSearchActive
            ? `${effectiveMatchCount} / ${layerSourceNodes.length} MATCHES`
            : `LAYERS · ${layerSourceNodes.length}`}
        </span>
        <span
          class={`layer-page-context${activeEditorId === 'component' ? ' is-component' : ''}`}
          title={layerContextTitle}
        >
          <span class="layer-page-context-label">{layerContextLabel}</span>
        </span>
      </div>
      <div class="layer-list" role="tree" aria-label="Document layers">
        {layerRows.map(({ node, depth, hasChildren }) => {
          const selected = selectedIdSet.has(node.id);
          const effective = layerEffectiveStates.get(node.id);
          const clipBaseName = node.clipMaskBaseId
            ? nodeById.get(node.clipMaskBaseId)?.name ?? 'another layer'
            : '';
          const isMaskBase = maskBaseIds.has(node.id);
          const isSearchDirectMatch = !isSearchActive || !searchMatchedIds || searchMatchedIds.has(node.id);
          const isSearchAncestor = isSearchActive && !isSearchDirectMatch;
          const matchedViaId = isSearchActive
            && isSearchDirectMatch
            && searchTokens.length > 0
            && !searchTokens.every((token) => node.name.toLowerCase().includes(token));
          const collapsed = !isSearchActive && collapsedIdSet.has(node.id);
          const dropClass = !isSearchActive && layerDropTarget?.nodeId === node.id ? ('drop-' + layerDropTarget.position) : '';
          return (
            <div
              key={node.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selected}
              aria-expanded={hasChildren ? !collapsed : undefined}
              tabIndex={0}
              draggable={!isSearchActive}
              class={
                'layer-row '
                + (selected ? 'selected ' : '')
                + (node.onCanvas === false ? 'layer-not-on-canvas ' : '')
                + (!effective?.visible ? 'layer-hidden ' : '')
                + (effective?.locked ? 'layer-inherited-locked ' : '')
                + (node.clipMaskBaseId ? 'layer-row-clipped ' : '')
                + (isMaskBase ? 'layer-row-mask-base ' : '')
                + (isSearchAncestor ? 'layer-row-search-ancestor ' : '')
                + dropClass
              }
              style={{ paddingLeft: (8 + depth * 15 + (node.clipMaskBaseId ? 14 : 0)) + 'px' }}
              onClick={(event) => onSelectLayer(node.id, event)}
              onContextMenu={(event) => onOpenContextMenu(node.id, event)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectLayer(node.id, event);
                }
              }}
              onDragStart={isSearchActive ? undefined : (event) => onStartDrag(node.id, event)}
              onDragOver={isSearchActive ? undefined : (event) => onDragOver(node.id, event)}
              onDrop={isSearchActive ? undefined : (event) => onDrop(node.id, event)}
              onDragEnd={isSearchActive ? undefined : onDragEnd}
              onDragLeave={isSearchActive ? undefined : () => onDragLeave(node.id)}
              title={
                node.onCanvas === false
                  ? 'Restore ' + node.name + ' to Canvas. Its last position, size and appearance will be kept.'
                  : isSearchActive
                    ? `${node.name} (${node.id}) — Clear search to drag-reorder`
                    : `${node.name} (${node.id})`
              }
            >
              {hasChildren ? (
                <button
                  type="button"
                  class="layer-disclosure"
                  disabled={isSearchActive}
                  title={isSearchActive ? 'Expanded while searching' : (collapsed ? 'Expand sub-layers' : 'Collapse sub-layers')}
                  aria-label={collapsed ? ('Expand ' + node.name) : ('Collapse ' + node.name)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isSearchActive) onToggleCollapsed(node.id);
                  }}
                >
                  <StudioIcon name={collapsed ? 'chevronRight' : 'chevronDown'} />
                </button>
              ) : (
                <span class="layer-disclosure-spacer" />
              )}
              {node.clipMaskBaseId && (
                <span
                  class="layer-clip-indicator"
                  title={`Clipped to ${clipBaseName}`}
                  aria-label={`Clipped to ${clipBaseName}`}
                >
                  <StudioIcon name="clipArrow" />
                </span>
              )}
              <LayerTypeIcon type={node.type} />
              {layerRename?.anchorId === node.id ? (
                <input
                  ref={layerRenameInputRef}
                  class="layer-name-editor"
                  type="text"
                  value={layerRename.value}
                  aria-label={layerRename.batch ? `Rename ${layerRename.nodeIds.length} selected layers` : `Rename ${node.name}`}
                  title={layerRename.batch ? `Batch rename ${layerRename.nodeIds.length} layers (numbered)` : 'Rename layer'}
                  onClick={(event) => event.stopPropagation()}
                  onInput={(event) => onUpdateRenameDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onFinishRename(true);
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onFinishRename(false);
                    }
                  }}
                  onBlur={() => onFinishRename(true)}
                />
              ) : (
                <span class="layer-name-group">
                  <span class={'layer-name ' + (isMaskBase ? 'layer-mask-base-name' : '')}>{node.name}</span>
                  {matchedViaId && (
                    <span class="layer-id-badge" title={`Matched ID: ${node.htmlId ? `#${node.htmlId} · ` : ''}${node.id}`}>
                      {node.htmlId && searchTokens.some((token) => node.htmlId?.toLowerCase().includes(token))
                        ? `#${node.htmlId}`
                        : node.id}
                    </span>
                  )}
                </span>
              )}
              <div class="layer-actions">
                <button
                  type="button"
                  class="layer-color-control"
                  style={{ backgroundColor: node.layerColor ?? '#7f8797' }}
                  title={node.layerColor ? `Layer color ${node.layerColor}` : 'Set layer color'}
                  aria-label={`Choose color for ${node.name}`}
                  aria-expanded={layerColorPickerKey === `${activeEditorId}:${node.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleColorPicker(node.id, event.currentTarget as HTMLButtonElement);
                  }}
                />
                <button
                  type="button"
                  class={'layer-control ' + (node.visible ? 'active' : '')}
                  title={node.visible ? 'Hide layer' : 'Show layer'}
                  aria-label={node.visible ? ('Hide ' + node.name) : ('Show ' + node.name)}
                  aria-pressed={node.visible}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleLayerProperty(node.id, 'visible');
                  }}
                >
                  <StudioIcon name={node.visible ? 'eye' : 'eyeOff'} />
                </button>
                <button
                  type="button"
                  class={'layer-control ' + (node.locked ? 'active' : '')}
                  title={node.locked ? 'Unlock layer' : 'Lock layer'}
                  aria-label={node.locked ? ('Unlock ' + node.name) : ('Lock ' + node.name)}
                  aria-pressed={node.locked}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleLayerProperty(node.id, 'locked');
                  }}
                >
                  <StudioIcon name={node.locked ? 'lock' : 'unlock'} />
                </button>
              </div>
              <span
                class="layer-color-rail"
                style={{ backgroundColor: node.layerColor ?? 'transparent' }}
                aria-hidden="true"
              />
            </div>
          );
        })}
        {layerSourceNodes.length === 0 && (
          <div class="empty-layers">Your layers will appear here.</div>
        )}
        {layerSourceNodes.length > 0 && isSearchActive && layerRows.length === 0 && (
          <div class="empty-layers is-search-empty" role="status">
            <span>No layers match “{searchQuery.trim()}”.</span>
            {onSearchQueryChange && (
              <button
                type="button"
                class="layer-search-reset-btn"
                onClick={() => {
                  onSearchQueryChange('');
                  searchInputRef.current?.focus();
                }}
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

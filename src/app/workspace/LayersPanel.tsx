import type { JSX, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EffectiveLayerState, LayerDropPosition, LayerPanelRow } from '../../core/document/layers';
import type { ComponentDefinition, DesignNode } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import { PANEL_RESIZE_CONSTRAINTS, type ResizablePanelId } from '../panelResize';
import {
  computeLayerVirtualWindow,
  computeScrollTopForLayerIndex,
  LAYER_VIEWPORT_FALLBACK_HEIGHT,
} from './layerListVirtualization';
import { tokenizeLayerSearchQuery, type LayerRenameSession } from './layerOperations';
import { LayerTypeIcon, StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';

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
  components?: readonly ComponentDefinition[];
  onUnpackComponentInstance?: (nodeId: string) => void;
  canPaste?: boolean;
  onPasteLayers?: () => void;
  onSelectAllLayers?: () => void;
  onQuickAddLayer?: (kind: 'rect' | 'ellipse' | 'triangle' | 'text' | 'frame') => void;
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
  components = [],
  onUnpackComponentInstance,
  canPaste = false,
  onPasteLayers,
  onSelectAllLayers,
  onQuickAddLayer,
}: LayersPanelProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const layerListRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(LAYER_VIEWPORT_FALLBACK_HEIGHT);
  const [expandedComponentIds, setExpandedComponentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(null);

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  const toggleExpandedComponent = (nodeId: string) => {
    setExpandedComponentIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const searchTokens = isSearchActive ? tokenizeLayerSearchQuery(searchQuery) : [];
  const effectiveMatchCount = searchMatchCount ?? layerSourceNodes.length;

  useEffect(() => {
    const listEl = layerListRef.current;
    if (!listEl) return;

    const commitHeight = () => {
      const h = listEl.clientHeight;
      if (Number.isFinite(h) && h > 0) {
        setViewportHeight((prev) => (Math.abs(prev - h) >= 2 ? h : prev));
      }
    };

    commitHeight();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', commitHeight);
      return () => {
        window.removeEventListener('resize', commitHeight);
      };
    }

    const observer = new ResizeObserver(() => commitHeight());
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const handleLayerListScroll = (event: JSX.TargetedUIEvent<HTMLDivElement>) => {
    const nextTop = event.currentTarget.scrollTop;
    if (typeof requestAnimationFrame !== 'function') {
      setScrollTop(nextTop);
      return;
    }
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const liveTop = layerListRef.current?.scrollTop ?? nextTop;
      setScrollTop(liveTop);
    });
  };

  const { nodeById, maskBaseIds } = useMemo(() => {
    const byId = new Map<string, DesignNode>();
    const masks = new Set<string>();
    for (const item of layerSourceNodes) {
      byId.set(item.id, item);
      if (item.clipMaskBaseId) {
        masks.add(item.clipMaskBaseId);
      }
    }
    return { nodeById: byId, maskBaseIds: masks };
  }, [layerSourceNodes]);

  const selectedIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const collapsedIdSet = useMemo(() => new Set(collapsedLayerIds), [collapsedLayerIds]);

  const pinnedIndices = useMemo(() => {
    if (!layerRename?.anchorId) return undefined;
    const idx = layerRows.findIndex((row) => row.node.id === layerRename.anchorId);
    return idx >= 0 ? [idx] : undefined;
  }, [layerRename?.anchorId, layerRows]);

  const virtualWindow = useMemo(
    () =>
      computeLayerVirtualWindow({
        totalCount: layerRows.length,
        scrollTop,
        viewportHeight,
        pinnedIndices,
      }),
    [layerRows.length, scrollTop, viewportHeight, pinnedIndices],
  );

  // Clamp scroll position when filtering or switching editors shrinks the list.
  useEffect(() => {
    const listEl = layerListRef.current;
    if (!listEl) return;
    const maxScroll = Math.max(0, virtualWindow.totalHeightPx - viewportHeight);
    if (listEl.scrollTop > maxScroll) {
      listEl.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [virtualWindow.totalHeightPx, viewportHeight, activeEditorId, focusedPageId, isSearchActive]);

  // Keep single-selected layer visible when virtualized.
  const primarySelectedId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  useEffect(() => {
    if (!virtualWindow.isVirtualized || !primarySelectedId) return;
    const listEl = layerListRef.current;
    if (!listEl) return;
    const idx = layerRows.findIndex((row) => row.node.id === primarySelectedId);
    if (idx < 0) return;
    const targetTop = computeScrollTopForLayerIndex({
      index: idx,
      scrollTop: listEl.scrollTop,
      viewportHeight: listEl.clientHeight || viewportHeight,
    });
    if (targetTop !== null) {
      listEl.scrollTop = targetTop;
      setScrollTop(targetTop);
    }
  }, [primarySelectedId, virtualWindow.isVirtualized, layerRows, viewportHeight]);

  const visibleLayerRows = virtualWindow.isVirtualized
    ? layerRows.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : layerRows;

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
      <div
        ref={layerListRef}
        class="layer-list"
        role="tree"
        aria-label="Document layers"
        data-virtualized={virtualWindow.isVirtualized ? 'true' : 'false'}
        onScroll={handleLayerListScroll}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('.layer-row')) return;
          event.preventDefault();
          setEmptyMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {virtualWindow.isVirtualized && virtualWindow.topSpacerPx > 0 && (
          <div
            class="layer-virtual-spacer"
            aria-hidden="true"
            style={{ height: `${virtualWindow.topSpacerPx}px` }}
          />
        )}
        {visibleLayerRows.map(({ node, depth, hasChildren }, sliceIdx) => {
          const rowIndex = virtualWindow.startIndex + sliceIdx;
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
          const masterComponent = node.type === 'component-instance'
            ? componentById.get(node.componentId) ?? null
            : null;
          const componentInnerNodes = masterComponent?.document.nodes ?? [];
          const hasComponentInnerLayers = !hasChildren && componentInnerNodes.length > 0;
          const isComponentExpanded = hasComponentInnerLayers && expandedComponentIds.has(node.id);
          const hasComponentAnimation = Boolean(
            masterComponent?.animations?.some((clip) => clip.tracks.length > 0),
          );
          return (
            <div key={node.id} class="layer-row-group">
              <div
                role="treeitem"
                aria-level={depth + 1}
                aria-setsize={virtualWindow.isVirtualized ? layerRows.length : undefined}
                aria-posinset={virtualWindow.isVirtualized ? rowIndex + 1 : undefined}
                aria-selected={selected}
                aria-expanded={hasChildren ? !collapsed : (hasComponentInnerLayers ? isComponentExpanded : undefined)}
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
                ) : hasComponentInnerLayers ? (
                  <button
                    type="button"
                    class="layer-disclosure"
                    data-testid="layer-expand-component-btn"
                    title={isComponentExpanded ? 'Hide internal component layers' : `Inspect ${componentInnerNodes.length} internal component layers`}
                    aria-label={isComponentExpanded ? (`Collapse ${node.name} internal layers`) : (`Expand ${node.name} internal layers`)}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpandedComponent(node.id);
                    }}
                  >
                    <StudioIcon name={isComponentExpanded ? 'chevronDown' : 'chevronRight'} />
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
                    {hasComponentAnimation && (
                      <span
                        class="layer-anim-badge"
                        data-testid="layer-component-anim-badge"
                        title="Animated component"
                      >
                        ANIM
                      </span>
                    )}
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
                  {node.type === 'component-instance' && masterComponent && onUnpackComponentInstance && (
                    <button
                      type="button"
                      class="layer-unpack-btn"
                      data-testid="layer-unpack-component-btn"
                      title={`Unpack “${node.name}” back into editable layers`}
                      aria-label={`Unpack ${node.name} back into editable layers`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnpackComponentInstance(node.id);
                      }}
                    >
                      <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5.5 2.5H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8.5" />
                        <path d="M8.5 2h3.5v3.5" />
                        <path d="M12 2 6.5 7.5" />
                      </svg>
                    </button>
                  )}
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
              {isComponentExpanded && (
                <div class="layer-component-sublist" data-testid="layer-component-sublist">
                  {componentInnerNodes.map((innerNode) => (
                    <div
                      key={`${node.id}::${innerNode.id}`}
                      class="layer-component-subrow"
                      style={{ paddingLeft: `${26 + depth * 15}px` }}
                      title={`Internal component layer: ${innerNode.name} (click Unpack to edit independently)`}
                    >
                      <LayerTypeIcon type={innerNode.type} />
                      <span class="layer-component-subname">{innerNode.name}</span>
                      <span class="layer-component-subtype">{innerNode.type}</span>
                    </div>
                  ))}
                  {onUnpackComponentInstance && (
                    <button
                      type="button"
                      class="layer-component-unpack-bar"
                      style={{ paddingLeft: `${26 + depth * 15}px` }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnpackComponentInstance(node.id);
                      }}
                    >
                      Unpack all {componentInnerNodes.length} layers to edit on canvas
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {virtualWindow.isVirtualized && virtualWindow.bottomSpacerPx > 0 && (
          <div
            class="layer-virtual-spacer"
            aria-hidden="true"
            style={{ height: `${virtualWindow.bottomSpacerPx}px` }}
          />
        )}
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
      {emptyMenu && (
        <StudioContextMenu
          open={true}
          x={emptyMenu.x}
          y={emptyMenu.y}
          ariaLabel="Layers panel actions"
          testId="layers-empty-context-menu"
          onClose={() => setEmptyMenu(null)}
          items={(() => {
            const entries: StudioContextMenuItem[] = [
              { kind: 'header', id: 'hdr', label: 'Layers', meta: `${layerSourceNodes.length} total` },
            ];
            if (onPasteLayers) {
              entries.push({
                kind: 'item',
                id: 'paste',
                label: 'Paste',
                shortcut: ['Mod', 'V'],
                disabled: !canPaste,
                onSelect: onPasteLayers,
              });
            }
            if (onSelectAllLayers) {
              entries.push({
                kind: 'item',
                id: 'select-all',
                label: 'Select All Layers',
                shortcut: ['Mod', 'A'],
                disabled: layerSourceNodes.length === 0,
                onSelect: onSelectAllLayers,
              });
            }
            if (onQuickAddLayer) {
              entries.push({ kind: 'divider', id: 'div-add' });
              entries.push({ kind: 'item', id: 'add-rect', label: 'Add Rectangle', shortcut: ['R'], onSelect: () => onQuickAddLayer('rect') });
              entries.push({ kind: 'item', id: 'add-ellipse', label: 'Add Circle / Ellipse', shortcut: ['O'], onSelect: () => onQuickAddLayer('ellipse') });
              entries.push({ kind: 'item', id: 'add-triangle', label: 'Add Triangle', shortcut: ['Shift', 'T'], onSelect: () => onQuickAddLayer('triangle') });
              entries.push({ kind: 'item', id: 'add-text', label: 'Add Text', shortcut: ['T'], onSelect: () => onQuickAddLayer('text') });
              entries.push({ kind: 'item', id: 'add-frame', label: 'Add Frame', shortcut: ['F'], onSelect: () => onQuickAddLayer('frame') });
            }
            return entries;
          })()}
        />
      )}
    </aside>
  );
}

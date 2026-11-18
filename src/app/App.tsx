import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { createInitialProject, createNode } from '../core/document/factory';
import type { DesignNode } from '../core/document/types';
import { loadMostRecentProject, saveProject } from '../core/persistence/indexedDb';
import { Canvas } from '../engines/canvas/Canvas';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../engines/canvas/geometry';
import { createEditorState, editorReducer } from './editorReducer';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    cursor: 'M5 3l14 9-6 1.5L10 20 5 3z',
    rect: 'M4 5h16v14H4z',
    ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    text: 'M4 5h16M12 5v14M8 19h8',
    layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
    export: 'M12 3v12m0-12 4 4m-4-4-4 4M5 14v6h14v-6',
    import: 'M12 15V3m0 12 4-4m-4 4-4-4M5 14v6h14v-6',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
    redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2',
    trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    chevron: 'm9 18 6-6-6-6',
    save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
    fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    sidebar: 'M4 4h16v16H4zM9 4v16',
    canvas: 'M3 4h18v16H3zM7 8h10v8H7z',
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
      <path d={paths[name] ?? paths.layers} />
    </svg>
  );
}

function LayerIcon({ type }: { type: DesignNode['type'] }) {
  return <span class={`layer-type layer-type-${type}`}>{type === 'text' ? 'T' : type === 'ellipse' ? '○' : '□'}</span>;
}

type ToolbarHint = {
  panel: string;
  description: string;
  shortcuts: string[];
};

const DEFAULT_TOOLBAR_HINT: ToolbarHint = {
  panel: 'WORKSPACE',
  description: 'Point at a panel to see what it does and which shortcuts are available.',
  shortcuts: ['SPACE + DRAG', 'SHIFT + CLICK'],
};

export function App() {
  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(0.82);
  const [toolbarHint, setToolbarHint] = useState<ToolbarHint>(DEFAULT_TOOLBAR_HINT);
  const [layersVisible, setLayersVisible] = useState(true);
  const [canvasMinimized, setCanvasMinimized] = useState(false);
  const [canvasClosed, setCanvasClosed] = useState(false);
  const [canvasMaximized, setCanvasMaximized] = useState(false);
  const [canvasFloating, setCanvasFloating] = useState(false);
  const [canvasPosition, setCanvasPosition] = useState({ x: 100, y: 92 });
  const canvasDrag = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((project) => {
        if (active && project) dispatch({ type: 'replace-project', project });
      })
      .catch((error: unknown) => {
        console.warn('Folio could not read local autosave:', error);
        if (active) setNotice('Local storage is unavailable. You can still export .flop files.');
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveProject(state.project)
        .then(() => setSaveStatus('saved'))
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setSaveStatus('error');
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state.project, ready]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedNode = useMemo(
    () => state.project.document.nodes.find((node) => node.id === state.selectedNodeId) ?? null,
    [state.project.document.nodes, state.selectedNodeId],
  );

  const addNode = (type: DesignNode['type']) => {
    dispatch({ type: 'add-node', node: createNode(type, state.project.document.nodes.length) });
  };

  const updateSelected = (patch: Partial<DesignNode>) => {
    if (!selectedNode) return;
    dispatch({ type: 'replace-node', node: { ...selectedNode, ...patch } as DesignNode });
  };

  const updateSelectedStyle = (patch: Record<string, string | number>) => {
    if (!selectedNode) return;
    dispatch({
      type: 'replace-node',
      node: { ...selectedNode, style: { ...selectedNode.style, ...patch } } as DesignNode,
    });
  };

  const alignSelection = (alignment: Alignment) => {
    const selected = state.project.document.nodes.filter((node) => state.selectedNodeIds.includes(node.id));
    if (selected.length < 2) return;
    dispatch({ type: 'transform-nodes', nodes: alignNodes(selected, alignment) });
  };

  const distributeSelection = (axis: DistributionAxis) => {
    const selected = state.project.document.nodes.filter((node) => state.selectedNodeIds.includes(node.id));
    if (selected.length < 3) return;
    dispatch({ type: 'transform-nodes', nodes: distributeNodes(selected, axis) });
  };

  const updateToolbarHint = (panel: string, description: string, shortcuts: string[] = []) => {
    setToolbarHint({ panel, description, shortcuts });
  };

  const enterFullscreen = () => {
    const root = document.querySelector('.app-shell') as HTMLElement | null;
    if (!document.fullscreenElement) root?.requestFullscreen?.().catch(() => setNotice('Fullscreen is unavailable in this browser.'));
    else document.exitFullscreen?.();
  };

  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <div class={`app-shell ${layersVisible ? "" : "layers-hidden"}`} onMouseLeave={() => setToolbarHint(DEFAULT_TOOLBAR_HINT)}>
      <header class="global-toolbar-slot" aria-label="FOLIO application toolbar">
        <nav class="global-menu-bar" aria-label="Application menus">
          <div class="global-toolbar-left">
          <div class="global-menu-items">
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('FILE', 'Project actions and .flop file commands will be organized here.')}>File</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('EDIT', 'Editing, history and selection commands will be organized here.')}>Edit</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('VIEW', 'Workspace display, panels, zoom and fullscreen controls will be organized here.')}>View</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('TOOLS', 'Design tools and tool-specific settings will be organized here.')}>Tools</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('OPTION', 'Application and workspace preferences will be organized here.')}>Option</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('HELP', 'Keyboard reference, documentation and support will be organized here.')}>Help</span>
          </div>
          <div class="global-project-name" title={`${state.project.metadata.name}.flop`}>
            <span class="global-project-label">{state.project.metadata.name}</span>
            <span class="global-project-extension">.flop</span>
          </div>
          </div>
          <div class="global-panel-toggles" aria-label="Workspace panels">
            <button class={`global-panel-toggle ${layersVisible ? 'active' : ''}`} type="button" title="Show / hide Layers sidebar" aria-label="Show or hide Layers sidebar" aria-pressed={layersVisible} onClick={() => setLayersVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('LAYERS SIDEBAR', 'Show or hide the document Layers dock.')}><Icon name="sidebar" /></button>
            <button class="global-panel-toggle canvas-header-toggle" type="button" title="Create / open Canvas window" aria-label="Create or open Canvas window" onClick={() => { setCanvasClosed(false); setCanvasMinimized(false); setCanvasFloating(true); setCanvasMaximized(false); }} onMouseEnter={() => updateToolbarHint('CANVAS WINDOW', 'Create or reopen the Canvas window.')}><Icon name="canvas" /></button>
            <button class="global-panel-toggle fullscreen-toggle" type="button" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={enterFullscreen} onMouseEnter={() => updateToolbarHint('FULLSCREEN', 'Enter or exit browser fullscreen mode.')}><Icon name="fullscreen" /></button>
          </div>
        </nav>
        <div class="global-hint-bar" role="status" aria-live="polite">
          <span class="hint-panel-label">{toolbarHint.panel}</span>
          <span class="hint-panel-description">{toolbarHint.description}</span>
          <span class="hint-shortcut-divider" aria-hidden="true">·</span>
          <div class="hint-shortcut-list">
            {toolbarHint.shortcuts.length > 0
              ? toolbarHint.shortcuts.map((shortcut) => <span class="hint-shortcut" key={shortcut}>{shortcut}</span>)
              : <span class="hint-no-shortcuts">SHORTCUTS NOT ASSIGNED</span>}
          </div>
        </div>
      </header>
      <nav class="tool-rail" aria-label="Insert tools" onMouseEnter={() => updateToolbarHint('TOOLS', 'Choose Select, Rectangle, Ellipse or Text from the tool rail.')}>
        <button class="tool-button active" title="Select layer" aria-label="Select layer" onClick={() => dispatch({ type: 'select-node', nodeId: null })}>
          <Icon name="cursor" />
        </button>
        <div class="rail-separator" />
        <button class="tool-button" title="Add rectangle" aria-label="Add rectangle" onClick={() => addNode('rect')}>
          <Icon name="rect" />
        </button>
        <button class="tool-button" title="Add ellipse" aria-label="Add ellipse" onClick={() => addNode('ellipse')}>
          <Icon name="ellipse" />
        </button>
        <button class="tool-button" title="Add text" aria-label="Add text" onClick={() => addNode('text')}>
          <Icon name="text" />
        </button>
        <div class="rail-bottom">
          <button class="tool-button" title="Undo" aria-label="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
            <Icon name="undo" />
          </button>
          <button class="tool-button" title="Redo" aria-label="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
            <Icon name="redo" />
          </button>
        </div>
      </nav>

      <aside class={`layers-panel ${layersVisible ? "" : "is-hidden"}`} onMouseEnter={() => updateToolbarHint('LAYERS', 'Select layers or extend a selection with modifier-click.', ['SHIFT + CLICK', 'CTRL/CMD + CLICK'])}>
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">DOCUMENT</span>
            <h2>Layers</h2>
          </div>
          <button class="icon-button" title="Add rectangle" onClick={() => addNode('rect')}><Icon name="plus" /></button>
        </div>
        <div class="page-row">
          <span class="page-indicator" />
          <span>{state.project.document.name}</span>
          <span class="page-size">{state.project.document.width} × {state.project.document.height}</span>
        </div>
        <div class="layer-list-heading">
          <span>LAYERS</span>
          <span>{state.project.document.nodes.length}</span>
        </div>
        <div class="layer-list">
          {[...state.project.document.nodes].reverse().map((node) => (
            <button
              key={node.id}
              class={"layer-row " + (state.selectedNodeIds.includes(node.id) ? "selected " : "") + (node.visible ? "" : "layer-hidden")}
              onClick={(event) => {
                const selected = state.selectedNodeIds;
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                  const next = selected.includes(node.id)
                    ? selected.filter((id) => id !== node.id)
                    : [...selected, node.id];
                  dispatch({ type: 'select-nodes', nodeIds: next });
                } else {
                  dispatch({ type: 'select-node', nodeId: node.id });
                }
              }}
              title={`Select ${node.name}`}
            >
              <LayerIcon type={node.type} />
              <span class="layer-name">{node.name}</span>
              <span class="layer-eye">{node.visible ? '◉' : '○'}</span>
            </button>
          ))}
          {state.project.document.nodes.length === 0 && (
            <div class="empty-layers">Your layers will appear here.</div>
          )}
        </div>
        <div class="layers-footnote">
          <span class="footnote-dot" />
          <span>Document is stored locally</span>
        </div>
      </aside>

      {!canvasClosed && !canvasMinimized && <main
        class={`workspace${canvasMaximized ? " canvas-maximized" : ""}${canvasFloating && !canvasMaximized ? " canvas-floating" : ""}`}
        style={canvasFloating && !canvasMaximized ? { left: `${canvasPosition.x}px`, top: `${canvasPosition.y}px` } : undefined}
        onMouseEnter={() => updateToolbarHint('CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >
        <div
          class={`workspace-toolbar${canvasFloating && !canvasMaximized ? " workspace-toolbar-draggable" : ""}`}
          onPointerDown={(event) => {
            if (!canvasFloating || canvasMaximized || (event.target as HTMLElement).closest('button')) return;
            canvasDrag.current = { pointerX: event.clientX, pointerY: event.clientY, originX: canvasPosition.x, originY: canvasPosition.y };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = canvasDrag.current;
            if (!drag) return;
            setCanvasPosition({
              x: Math.max(0, drag.originX + event.clientX - drag.pointerX),
              y: Math.max(56, drag.originY + event.clientY - drag.pointerY),
            });
          }}
          onPointerUp={() => { canvasDrag.current = null; }}
          onPointerCancel={() => { canvasDrag.current = null; }}
        >
          <div class="breadcrumb"><strong>{state.project.document.name}</strong></div>
          <div class="canvas-window-tools">
            {state.selectedNodeIds.length > 1 && (
              <div class="alignment-tools" aria-label="Align selected layers">
                <button title="Align left" aria-label="Align left" onClick={() => alignSelection('left')}>⇤</button>
                <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignSelection('horizontal-center')}>↔</button>
                <button title="Align right" aria-label="Align right" onClick={() => alignSelection('right')}>⇥</button>
                <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('horizontal')}>⇌</button>
                <button title="Align top" aria-label="Align top" onClick={() => alignSelection('top')}>⇡</button>
                <button title="Align vertical center" aria-label="Align vertical center" onClick={() => alignSelection('vertical-center')}>↕</button>
                <button title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection('bottom')}>⇣</button>
                <button title="Distribute vertically" aria-label="Distribute vertically" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('vertical')}>⇅</button>
              </div>
            )}
            <div class="workspace-tools">
              <button class="history-button" title="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" /></button>
              <button class="history-button" title="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" /></button>
              <span class="workspace-divider" />
              <button class="zoom-button" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}><Icon name="minus" /></button>
              <span class="zoom-value">{Math.round(zoom * 100)}%</span>
              <button class="zoom-button" title="Zoom in" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
            </div>
            <div class="workspace-window-controls" aria-label="Canvas window controls">
              <button type="button" class="window-control" title="Minimize canvas" aria-label="Minimize canvas" onClick={() => setCanvasMinimized(true)}>—</button>
              <button type="button" class="window-control" title={canvasMaximized ? "Restore to floating window" : "Maximize canvas"} aria-label={canvasMaximized ? "Restore to floating window" : "Maximize canvas"} aria-pressed={canvasMaximized} onClick={() => { setCanvasFloating(true); setCanvasMaximized((value) => !value); }}>{canvasMaximized ? "❐" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Canvas window" aria-label="Close Canvas window" onClick={() => { setCanvasClosed(true); setCanvasMinimized(false); setCanvasMaximized(false); setCanvasFloating(false); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={state.project.document}
            selectedNodeIds={state.selectedNodeIds}
            zoom={zoom}
            onZoomChange={setZoom}
            onSelectionChange={(nodeIds) => dispatch({ type: 'select-nodes', nodeIds })}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SCROLL: PAN Y · SHIFT + SCROLL: PAN X · CTRL/CMD + SCROLL: ZOOM · SPACE + DRAG: PAN</div>
        </div>
      </main>}

      <aside class="inspector-panel" onMouseEnter={() => updateToolbarHint('INSPECTOR', 'Edit the selected layer’s position, dimensions, appearance and options.')}>
        <div class="panel-heading inspector-heading">
          <div>
            <span class="panel-kicker">PROPERTIES</span>
            <h2>Inspector</h2>
          </div>
          {selectedNode && <button class="icon-button danger" title="Delete selected layer" onClick={() => dispatch({ type: 'delete-node', nodeId: selectedNode.id })}><Icon name="trash" /></button>}
        </div>

        {selectedNode ? (
          <div class="inspector-content">
            <section class="property-section">
              <div class="section-title">Layer</div>
              <label class="field-label">Name</label>
              <input
                class="text-field"
                value={selectedNode.name}
                onChange={(event) => updateSelected({ name: event.currentTarget.value })}
              />
            </section>

            <section class="property-section">
              <div class="section-title">Position</div>
              <div class="field-grid">
                <label class="field-label">X<input class="number-field" type="number" value={Math.round(selectedNode.x)} onChange={(event) => updateSelected({ x: Number(event.currentTarget.value) || 0 })} /></label>
                <label class="field-label">Y<input class="number-field" type="number" value={Math.round(selectedNode.y)} onChange={(event) => updateSelected({ y: Number(event.currentTarget.value) || 0 })} /></label>
                <label class="field-label">W<input class="number-field" type="number" min="1" value={Math.round(selectedNode.width)} onChange={(event) => updateSelected({ width: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
                <label class="field-label">H<input class="number-field" type="number" min="1" value={Math.round(selectedNode.height)} onChange={(event) => updateSelected({ height: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
              </div>
              <label class="field-label rotation-field">Rotation<input class="number-field" type="number" value={selectedNode.rotation} onChange={(event) => updateSelected({ rotation: Number(event.currentTarget.value) || 0 })} /></label>
            </section>

            <section class="property-section">
              <div class="section-title">Appearance</div>
              <label class="field-label">Fill</label>
              <div class="color-field-wrap">
                <input
                  class="color-swatch"
                  type="color"
                  value={selectedNode.style.fill.startsWith('#') && selectedNode.style.fill.length === 7 ? selectedNode.style.fill : '#8B7CF6'}
                  onChange={(event) => updateSelectedStyle({ fill: event.currentTarget.value })}
                />
                <span class="color-value">{selectedNode.style.fill.toUpperCase()}</span>
              </div>
              {selectedNode.type === 'rect' && (
                <label class="field-label range-label">Corner radius
                  <input class="number-field" type="number" min="0" value={selectedNode.style.radius ?? 0} onChange={(event) => updateSelectedStyle({ radius: Math.max(0, Number(event.currentTarget.value) || 0) })} />
                </label>
              )}
              {selectedNode.type === 'text' && (
                <>
                  <label class="field-label text-content-label">Text content</label>
                  <textarea class="text-area-field" rows={3} value={selectedNode.text} onChange={(event) => updateSelected({ text: event.currentTarget.value })} />
                  <div class="field-grid single-row">
                    <label class="field-label">Font size<input class="number-field" type="number" min="1" value={selectedNode.style.fontSize} onChange={(event) => updateSelectedStyle({ fontSize: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
                    <label class="field-label">Weight<input class="number-field" type="number" min="100" max="900" step="100" value={selectedNode.style.fontWeight} onChange={(event) => updateSelectedStyle({ fontWeight: Math.min(900, Math.max(100, Number(event.currentTarget.value) || 400)) })} /></label>
                  </div>
                </>
              )}
            </section>

            <section class="property-section last-section">
              <div class="section-title">Layer options</div>
              <label class="toggle-row"><span>Visible</span><input type="checkbox" checked={selectedNode.visible} onChange={(event) => updateSelected({ visible: event.currentTarget.checked })} /></label>
              <label class="toggle-row"><span>Locked</span><input type="checkbox" checked={selectedNode.locked} onChange={(event) => updateSelected({ locked: event.currentTarget.checked })} /></label>
            </section>
          </div>
        ) : state.selectedNodeIds.length > 1 ? (
          <div class="inspector-empty multi-inspector">
            <div class="empty-icon"><Icon name="layers" /></div>
            <strong>{state.selectedNodeIds.length} layers selected</strong>
            <p>Drag to move the group, use the resize handles, or choose an alignment control above the canvas.</p>
          </div>
        ) : (
          <div class="inspector-empty">
            <div class="empty-icon"><Icon name="cursor" /></div>
            <strong>Nothing selected</strong>
            <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
            <div class="quick-add">
              <button onClick={() => addNode('rect')}>+ Rectangle</button>
              <button onClick={() => addNode('text')}>+ Text</button>
            </div>
          </div>
        )}
      </aside>

      <footer class="statusbar">
        <div><span class="status-brand">F</span><span>Folio Studio <b>0.1.0</b></span></div>
        <div class="status-center">{state.project.document.nodes.length} LAYERS <span>·</span> {state.project.document.width} × {state.project.document.height} PX</div>
        <div class={`status-right save-${saveStatus}`} role="status" aria-live="polite"><span class="status-ready-dot" /> {statusLabel}</div>
      </footer>

      {notice && <div class="toast" role="status">{notice}</div>}
    </div>
  );
}

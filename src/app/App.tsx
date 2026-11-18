import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
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
    maximize: 'M8 3H3v5M3 3l6 6M16 3h5v5m0-5-6 6M3 16v5h5m-5 0 6-6m12 1v5h-5m5 0-6-6',
    minimize: 'M8 3v5H3m5-5L3 8M16 3v5h5m-5-5 5 5M3 16h5v5m-5-5 5 5m8 0v-5h5m-5 5 5-5',
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

export function App() {
  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(0.82);

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

  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <div class="app-shell">
      <div class="global-toolbar-slot" aria-hidden="true" />
      <nav class="tool-rail" aria-label="Insert tools">
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

      <aside class="layers-panel">
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

      <main class="workspace">
        <div class="workspace-toolbar">
          <div class="breadcrumb"><span>Canvas</span><Icon name="chevron" /><strong>{state.project.document.name}</strong></div>
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
            <button class="zoom-button" title="Zoom in" onClick={() => setZoom((value) => Math.min(1.4, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={state.project.document}
            selectedNodeIds={state.selectedNodeIds}
            zoom={zoom}
            onSelectionChange={(nodeIds) => dispatch({ type: 'select-nodes', nodeIds })}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SPACE + DRAG / MIDDLE-DRAG TO PAN · DRAG TO MOVE · SHIFT-CLICK MULTI-SELECT</div>
        </div>
      </main>

      <aside class="inspector-panel">
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

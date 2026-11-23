import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  DesignNode,
  FolioProject,
  LogicGraph,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
} from '../../core/document/types';
import {
  createLogicGraph,
  createPrototypeRuntime,
  getLogicNodeDefinition,
  validateLogicGraphSemantics,
  type BuiltInLogicNodeType,
  type LogicNodeCategory,
  type LogicNodeEventKind,
  type PrototypeRuntime,
  type PrototypeRuntimeSnapshot,
} from '../../engines/prototype';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  LOGIC_CATALOG_LIST,
  LOGIC_NODE_WIDTH,
  LOGIC_PRESETS,
  addConnectionToGraph,
  addNodeToGraph,
  addVariableToGraph,
  buildLogicWirePath,
  canConnectLogicPorts,
  computeFitViewTransform,
  computeNextNodePosition,
  createLogicId,
  createLogicPresetGraph,
  createStarterMainPageLogicGraph,
  getLogicNodeCategory,
  getLogicNodePorts,
  getLogicNodeSummary,
  getLogicPortDataType,
  getLogicPortWorldPosition,
  moveNodeInGraph,
  removeConnectionFromGraph,
  removeNodeFromGraph,
  removeVariableFromGraph,
  touchLogicGraph,
  updateNodeDataInGraph,
  updateVariableInGraph,
  type LogicPoint,
  type LogicPresetId,
  type LogicViewportTransform,
} from './nodeLogicGraphHelpers';
import { NodeLogicInspector, type NodeLogicInspectorTab } from './NodeLogicInspector';
import { StudioIcon } from './StudioIcon';

export interface NodeLogicWorkspaceProps {
  project: FolioProject;
  activePageId: string;
  mainCommandClient: MainCanvasCommandClient;
  onNotice: (message: string) => void;
  onOpenLivePreview: (pageId?: string) => void;
}

interface PendingWireState {
  readonly fromNodeId: string;
  readonly fromPortId: string;
  readonly fromDirection: 'in' | 'out';
  readonly pointerWorld: LogicPoint;
}

interface NodeDragState {
  readonly nodeId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
  readonly currentX: number;
  readonly currentY: number;
}

interface PanDragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originPanX: number;
  readonly originPanY: number;
}

const CATEGORY_FILTER_OPTIONS: readonly { id: 'all' | LogicNodeCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'event', label: 'Events' },
  { id: 'state', label: 'State' },
  { id: 'logic', label: 'Logic' },
  { id: 'action', label: 'Actions' },
];

const CATEGORY_MARKERS: Record<LogicNodeCategory | 'custom', { glyph: string; label: string }> = {
  event: { glyph: '◆', label: 'Event' },
  state: { glyph: '■', label: 'State' },
  logic: { glyph: '⬡', label: 'Logic' },
  action: { glyph: '▸', label: 'Action' },
  custom: { glyph: '○', label: 'Custom' },
};

export default function NodeLogicWorkspace({
  project,
  activePageId,
  mainCommandClient,
  onNotice,
  onOpenLivePreview,
}: NodeLogicWorkspaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(
    () => project.logicGraphs[0]?.id ?? null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<NodeLogicInspectorTab>('node');
  const [paletteCategory, setPaletteCategory] = useState<'all' | LogicNodeCategory>('all');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [renamingGraph, setRenamingGraph] = useState(false);
  const [graphNameDraft, setGraphNameDraft] = useState('');
  const [viewport, setViewport] = useState<LogicViewportTransform>({ panX: 32, panY: 32, zoom: 0.85 });
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [pendingWire, setPendingWire] = useState<PendingWireState | null>(null);

  const activePage = useMemo(
    () => project.pages.find((page) => page.id === activePageId) ?? getActivePage(project),
    [project, activePageId],
  );
  const designTokens = useMemo(() => getProjectDesignTokens(project), [project]);

  // Keep activeGraphId synced with project.logicGraphs
  useEffect(() => {
    if (project.logicGraphs.length === 0) {
      if (activeGraphId !== null) setActiveGraphId(null);
      return;
    }
    if (!activeGraphId || !project.logicGraphs.some((g) => g.id === activeGraphId)) {
      setActiveGraphId(project.logicGraphs[0].id);
    }
  }, [project.logicGraphs, activeGraphId]);

  const activeGraph: LogicGraph | null = useMemo(
    () => project.logicGraphs.find((g) => g.id === activeGraphId) ?? project.logicGraphs[0] ?? null,
    [project.logicGraphs, activeGraphId],
  );

  // Clean up stale selection when active graph changes
  useEffect(() => {
    if (!activeGraph) {
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      return;
    }
    if (selectedNodeId && !activeGraph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (selectedConnectionId && !activeGraph.connections.some((c) => c.id === selectedConnectionId)) {
      setSelectedConnectionId(null);
    }
  }, [activeGraph, selectedNodeId, selectedConnectionId]);

  // Fit view when switching to a different graph
  const fittedGraphIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeGraph || fittedGraphIdRef.current === activeGraph.id) return;
    fittedGraphIdRef.current = activeGraph.id;
    const el = stageRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0 && activeGraph.nodes.length > 0) {
      setViewport(computeFitViewTransform(activeGraph.nodes, el.clientWidth, el.clientHeight));
    }
  }, [activeGraph]);

  const scopedAstNodes: readonly DesignNode[] = useMemo(() => {
    if (!activeGraph) return activePage.document.nodes;
    if (activeGraph.scope === 'page') {
      return (
        project.pages.find((p) => p.id === activeGraph.targetId)?.document.nodes
        ?? activePage.document.nodes
      );
    }
    if (activeGraph.scope === 'component') {
      return (
        project.components.find((c) => c.id === activeGraph.targetId)?.document.nodes ?? []
      );
    }
    return project.pages.flatMap((p) => p.document.nodes);
  }, [activeGraph, project.pages, project.components, activePage.document.nodes]);

  const availableVariables: readonly LogicVariableDefinition[] = useMemo(() => {
    if (!activeGraph) return [];
    const map = new Map<string, LogicVariableDefinition>();
    for (const graph of project.logicGraphs) {
      if (graph.scope === 'project' && graph.id !== activeGraph.id) {
        for (const variable of graph.variables ?? []) {
          map.set(variable.id, variable);
        }
      }
    }
    for (const variable of activeGraph.variables ?? []) {
      map.set(variable.id, variable);
    }
    return Array.from(map.values());
  }, [activeGraph, project.logicGraphs]);

  const validationReport = useMemo(
    () => (activeGraph ? validateLogicGraphSemantics(activeGraph, project) : null),
    [activeGraph, project],
  );
  const diagnostics = validationReport?.diagnostics ?? [];
  const diagnosticsByNodeId = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    for (const diag of diagnostics) {
      if (!diag.nodeId) continue;
      const entry = map.get(diag.nodeId) ?? { errors: 0, warnings: 0 };
      if (diag.severity === 'error') entry.errors += 1;
      else entry.warnings += 1;
      map.set(diag.nodeId, entry);
    }
    return map;
  }, [diagnostics]);

  // Headless PrototypeRuntime instance rebuilt cleanly when project changes
  const runtimeRef = useRef<PrototypeRuntime | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<PrototypeRuntimeSnapshot | null>(null);

  const targetPageIdForRuntime =
    activeGraph?.scope === 'page' && activeGraph.targetId
      ? activeGraph.targetId
      : activePage.id;

  useEffect(() => {
    const nextRuntime = createPrototypeRuntime(project, { pageId: targetPageIdForRuntime });
    runtimeRef.current = nextRuntime;
    setRuntimeSnapshot(nextRuntime.getSnapshot());
  }, [project, targetPageIdForRuntime]);

  const commitGraphUpdate = useCallback(
    (nextGraph: LogicGraph, description: string) => {
      mainCommandClient.updateLogicGraph(nextGraph, description);
    },
    [mainCommandClient],
  );

  const handleCreateEmptyGraph = () => {
    const nextIndex = project.logicGraphs.length + 1;
    const graph = createLogicGraph({
      id: createLogicId('lgraph'),
      name: `${activePage.name} Flow ${nextIndex}`,
      scope: 'page',
      targetId: activePage.id,
      nodes: [],
      connections: [],
    });
    const res = mainCommandClient.createLogicGraph(graph, `Create logic graph "${graph.name}"`);
    if (res.status === 'applied') {
      setActiveGraphId(graph.id);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Created logic graph “${graph.name}”.`);
    }
  };

  const handleInsertPreset = (presetId: LogicPresetId) => {
    const graph = createLogicPresetGraph(presetId, project, activePage);
    const res = mainCommandClient.createLogicGraph(graph, `Create preset graph "${graph.name}"`);
    setPresetsOpen(false);
    if (res.status === 'applied') {
      fittedGraphIdRef.current = null;
      setActiveGraphId(graph.id);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Loaded “${graph.name}” preset graph.`);
    }
  };

  const handleLoadStarterFlow = () => {
    const starter = createStarterMainPageLogicGraph(activePage);
    const graph = starter
      ? { ...starter, id: createLogicId('lgraph') }
      : createLogicPresetGraph('click-counter', project, activePage);
    const res = mainCommandClient.createLogicGraph(graph, `Create starter graph "${graph.name}"`);
    if (res.status === 'applied') {
      fittedGraphIdRef.current = null;
      setActiveGraphId(graph.id);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Loaded interactive starter flow “${graph.name}”.`);
    }
  };

  const handleDeleteActiveGraph = () => {
    if (!activeGraph) return;
    const name = activeGraph.name;
    const res = mainCommandClient.deleteLogicGraph(activeGraph.id, `Delete logic graph "${name}"`);
    if (res.status === 'applied') {
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Deleted logic graph “${name}”.`);
    }
  };

  const handleCommitGraphRename = () => {
    setRenamingGraph(false);
    if (!activeGraph) return;
    const trimmed = graphNameDraft.trim();
    if (!trimmed || trimmed === activeGraph.name) return;
    commitGraphUpdate(touchLogicGraph({ ...activeGraph, name: trimmed }), `Rename logic graph to "${trimmed}"`);
  };

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): LogicPoint => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 120, y: 120 };
      return {
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
      };
    },
    [viewport],
  );

  const handleAddNodeFromPalette = (type: BuiltInLogicNodeType) => {
    let targetGraph = activeGraph;
    if (!targetGraph) {
      const created = createLogicGraph({
        id: createLogicId('lgraph'),
        name: `${activePage.name} Interactions`,
        scope: 'page',
        targetId: activePage.id,
        nodes: [],
        connections: [],
      });
      const res = mainCommandClient.createLogicGraph(created, `Create logic graph "${created.name}"`);
      if (res.status !== 'applied') return;
      targetGraph = created;
      setActiveGraphId(created.id);
    }

    const rect = stageRef.current?.getBoundingClientRect();
    const centerWorld = rect
      ? {
          x: (rect.width / 2 - viewport.panX) / viewport.zoom,
          y: (rect.height / 2 - viewport.panY) / viewport.zoom,
        }
      : { x: 260, y: 160 };
    const pos = computeNextNodePosition(targetGraph, centerWorld);

    // Pre-fill helpful defaults for first theme or layer when sensible
    const defaultExtras: Record<string, string | number | boolean | null> = {};
    if (type === 'action.set-theme' && designTokens.themes[0]) {
      defaultExtras.themeId = designTokens.themes[0].id;
    } else if (type === 'action.navigate') {
      defaultExtras.route = activePage.route;
    }

    const { graph: nextGraph, node } = addNodeToGraph(targetGraph, type, pos, defaultExtras);
    commitGraphUpdate(nextGraph, `Add ${getLogicNodeDefinition(type)?.label ?? type} node`);
    setSelectedNodeId(node.id);
    setSelectedConnectionId(null);
    setInspectorTab('node');
  };

  const handleFitView = () => {
    if (!activeGraph || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setViewport(computeFitViewTransform(activeGraph.nodes, rect.width, rect.height));
  };

  const stepZoom = (direction: 'in' | 'out') => {
    setViewport((current) => {
      const factor = direction === 'in' ? 1.15 : 1 / 1.15;
      const nextZoom = Math.max(0.4, Math.min(1.6, Math.round(current.zoom * factor * 100) / 100));
      return { ...current, zoom: nextZoom };
    });
  };

  // Render positions with live node drag preview overlaid smoothly
  const displayNodes = useMemo(() => {
    if (!activeGraph) return [];
    if (!nodeDrag) return activeGraph.nodes;
    return activeGraph.nodes.map((node) =>
      node.id === nodeDrag.nodeId ? { ...node, x: nodeDrag.currentX, y: nodeDrag.currentY } : node,
    );
  }, [activeGraph, nodeDrag]);

  const displayNodesById = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );

  // Global pointer tracking for smooth node dragging, panning, and wire dragging
  useEffect(() => {
    if (!nodeDrag && !panDrag && !pendingWire) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (nodeDrag && event.pointerId === nodeDrag.pointerId) {
        const dx = (event.clientX - nodeDrag.startClientX) / viewport.zoom;
        const dy = (event.clientY - nodeDrag.startClientY) / viewport.zoom;
        setNodeDrag((current) =>
          current
            ? {
                ...current,
                currentX: Math.round(current.originX + dx),
                currentY: Math.round(current.originY + dy),
              }
            : null,
        );
      } else if (panDrag && event.pointerId === panDrag.pointerId) {
        const dx = event.clientX - panDrag.startClientX;
        const dy = event.clientY - panDrag.startClientY;
        setViewport((current) => ({
          ...current,
          panX: Math.round(panDrag.originPanX + dx),
          panY: Math.round(panDrag.originPanY + dy),
        }));
      } else if (pendingWire) {
        setPendingWire((current) =>
          current ? { ...current, pointerWorld: screenToWorld(event.clientX, event.clientY) } : null,
        );
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (nodeDrag && event.pointerId === nodeDrag.pointerId) {
        if (activeGraph && (nodeDrag.currentX !== nodeDrag.originX || nodeDrag.currentY !== nodeDrag.originY)) {
          const nextGraph = moveNodeInGraph(activeGraph, nodeDrag.nodeId, nodeDrag.currentX, nodeDrag.currentY);
          commitGraphUpdate(nextGraph, 'Move logic node');
        }
        setNodeDrag(null);
      }
      if (panDrag && event.pointerId === panDrag.pointerId) {
        setPanDrag(null);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [nodeDrag, panDrag, pendingWire, viewport.zoom, activeGraph, commitGraphUpdate, screenToWorld]);

  // Complete or start a wire connection when interacting with any port socket
  const handlePortClick = (
    event: MouseEvent,
    nodeId: string,
    portId: string,
    direction: 'in' | 'out',
  ) => {
    event.stopPropagation();
    if (!activeGraph) return;

    if (!pendingWire) {
      const node = displayNodesById.get(nodeId);
      const startPos = node ? getLogicPortWorldPosition(node, portId) : null;
      if (!startPos) return;
      setPendingWire({
        fromNodeId: nodeId,
        fromPortId: portId,
        fromDirection: direction,
        pointerWorld: startPos,
      });
      return;
    }

    // Clicking the same port cancels pending wire cleanly
    if (pendingWire.fromNodeId === nodeId && pendingWire.fromPortId === portId) {
      setPendingWire(null);
      return;
    }

    const result = addConnectionToGraph(
      activeGraph,
      pendingWire.fromNodeId,
      pendingWire.fromPortId,
      nodeId,
      portId,
    );
    setPendingWire(null);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    commitGraphUpdate(result.graph, 'Connect logic ports');
    setSelectedConnectionId(result.connection.id);
    setSelectedNodeId(null);
  };

  // Keyboard delete / Escape inside Node Logic stage
  const handleStageKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === 'Escape' && pendingWire) {
      event.preventDefault();
      setPendingWire(null);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && activeGraph) {
      if (selectedConnectionId) {
        event.preventDefault();
        commitGraphUpdate(removeConnectionFromGraph(activeGraph, selectedConnectionId), 'Delete logic connection');
        setSelectedConnectionId(null);
      } else if (selectedNodeId) {
        event.preventDefault();
        commitGraphUpdate(removeNodeFromGraph(activeGraph, selectedNodeId), 'Delete logic node');
        setSelectedNodeId(null);
      }
    }
  };

  const filteredCatalog = useMemo(() => {
    const query = paletteSearch.trim().toLowerCase();
    return LOGIC_CATALOG_LIST.filter((item) => {
      if (paletteCategory !== 'all' && item.category !== paletteCategory) return false;
      if (!query) return true;
      return (
        item.label.toLowerCase().includes(query)
        || item.type.toLowerCase().includes(query)
        || item.description.toLowerCase().includes(query)
      );
    });
  }, [paletteCategory, paletteSearch]);

  const selectedNode = activeGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedConnection = activeGraph?.connections.find((c) => c.id === selectedConnectionId) ?? null;

  const pendingWirePath = useMemo(() => {
    if (!pendingWire) return null;
    const fromNode = displayNodesById.get(pendingWire.fromNodeId);
    const fromPos = fromNode ? getLogicPortWorldPosition(fromNode, pendingWire.fromPortId) : null;
    if (!fromPos) return null;
    return pendingWire.fromDirection === 'out'
      ? buildLogicWirePath(fromPos, pendingWire.pointerWorld)
      : buildLogicWirePath(pendingWire.pointerWorld, fromPos);
  }, [pendingWire, displayNodesById]);

  const errorCount = validationReport?.errors.length ?? 0;
  const warningCount = validationReport?.warnings.length ?? 0;

  return (
    <div
      class="nl-studio"
      tabIndex={0}
      onKeyDown={handleStageKeyDown}
      data-testid="node-logic-studio"
    >
      {/* Top Graph Control & Live Preview Bridge Bar */}
      <div class="nl-topbar">
        <div class="nl-topbar-left">
          {renamingGraph && activeGraph ? (
            <input
              class="nl-graph-rename-input"
              aria-label="Logic graph name"
              autoFocus
              value={graphNameDraft}
              onInput={(event) => setGraphNameDraft(event.currentTarget.value)}
              onBlur={handleCommitGraphRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCommitGraphRename();
                if (event.key === 'Escape') setRenamingGraph(false);
              }}
            />
          ) : (
            <select
              class="select-field nl-graph-select"
              aria-label="Active logic graph"
              value={activeGraph?.id ?? ''}
              disabled={project.logicGraphs.length === 0}
              onChange={(event) => {
                fittedGraphIdRef.current = null;
                setActiveGraphId(event.currentTarget.value);
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                setPendingWire(null);
              }}
            >
              {project.logicGraphs.length === 0 ? (
                <option value="">No logic graphs</option>
              ) : (
                project.logicGraphs.map((graph) => (
                  <option key={graph.id} value={graph.id}>
                    {graph.name} ({graph.nodes.length} nodes)
                  </option>
                ))
              )}
            </select>
          )}

          {activeGraph && !renamingGraph && (
            <button
              type="button"
              class="nl-bar-icon-btn"
              title="Rename logic graph"
              aria-label="Rename logic graph"
              onClick={() => {
                setGraphNameDraft(activeGraph.name);
                setRenamingGraph(true);
              }}
            >
              <StudioIcon name="edit" />
            </button>
          )}

          <button
            type="button"
            class="nl-bar-btn"
            onClick={handleCreateEmptyGraph}
          >
            + Graph
          </button>

          <div class="nl-presets-anchor">
            <button
              type="button"
              class={`nl-bar-btn ${presetsOpen ? 'is-active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={presetsOpen}
              onClick={() => setPresetsOpen((open) => !open)}
            >
              Presets
            </button>
            {presetsOpen && (
              <div class="nl-presets-menu" role="menu" aria-label="Interactive logic presets">
                {LOGIC_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    class="nl-preset-item"
                    onClick={() => handleInsertPreset(preset.id)}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeGraph && (
            <button
              type="button"
              class="nl-bar-icon-btn nl-bar-icon-danger"
              title="Delete active logic graph"
              aria-label="Delete active logic graph"
              onClick={handleDeleteActiveGraph}
            >
              <StudioIcon name="trash" />
            </button>
          )}
        </div>

        <div class="nl-topbar-right">
          <div class="nl-diag-summary nl-tabular" aria-live="polite">
            {errorCount > 0 ? (
              <span class="nl-diag-text is-error">{errorCount} error{errorCount === 1 ? '' : 's'}</span>
            ) : warningCount > 0 ? (
              <span class="nl-diag-text is-warning">{warningCount} warning{warningCount === 1 ? '' : 's'}</span>
            ) : activeGraph ? (
              <span class="nl-diag-text is-ok">Valid · {activeGraph.nodes.length} nodes · {activeGraph.connections.length} wires</span>
            ) : (
              <span class="nl-diag-text">Ready</span>
            )}
          </div>

          <div class="nl-zoom-controls" role="group" aria-label="Node graph zoom">
            <button type="button" class="nl-bar-icon-btn" title="Zoom out" aria-label="Zoom out graph" onClick={() => stepZoom('out')}>
              <StudioIcon name="minus" />
            </button>
            <span class="nl-zoom-label nl-tabular">{Math.round(viewport.zoom * 100)}%</span>
            <button type="button" class="nl-bar-icon-btn" title="Zoom in" aria-label="Zoom in graph" onClick={() => stepZoom('in')}>
              <StudioIcon name="plus" />
            </button>
            <button type="button" class="nl-bar-btn" title="Fit graph to viewport" onClick={handleFitView}>
              Fit
            </button>
          </div>

          <button
            type="button"
            class="nl-preview-cta"
            onClick={() => onOpenLivePreview(targetPageIdForRuntime)}
          >
            <StudioIcon name="preview" />
            <span>Test in Live Preview</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Node Logic Studio Body */}
      <div class="nl-body">
        {/* Left Node Catalog Palette */}
        <aside class="nl-palette" aria-label="Node catalog">
          <div class="nl-palette-search-wrap">
            <input
              class="nl-input"
              type="search"
              aria-label="Search logic nodes"
              placeholder="Filter 18 nodes…"
              value={paletteSearch}
              onInput={(event) => setPaletteSearch(event.currentTarget.value)}
            />
          </div>
          <div class="nl-palette-filters" role="group" aria-label="Filter nodes by category">
            {CATEGORY_FILTER_OPTIONS.map((cat) => (
              <button
                key={cat.id}
                type="button"
                class={`nl-cat-btn ${paletteCategory === cat.id ? 'is-active' : ''}`}
                aria-pressed={paletteCategory === cat.id}
                onClick={() => setPaletteCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div class="nl-palette-list">
            {filteredCatalog.map((item) => {
              const marker = CATEGORY_MARKERS[item.category];
              return (
                <button
                  key={item.type}
                  type="button"
                  class={`nl-palette-item nl-cat-${item.category}`}
                  title={item.description}
                  onClick={() => handleAddNodeFromPalette(item.type)}
                >
                  <span class="nl-palette-marker" aria-hidden="true">{marker.glyph}</span>
                  <span class="nl-palette-copy">
                    <strong>{item.label}</strong>
                    <span>{marker.label}</span>
                  </span>
                  <span class="nl-palette-plus" aria-hidden="true">+</span>
                </button>
              );
            })}
            {filteredCatalog.length === 0 && (
              <div class="nl-palette-empty">No matching logic nodes.</div>
            )}
          </div>
        </aside>

        {/* Center Pan/Zoom Node-Wire Graph Canvas */}
        <div
          ref={stageRef}
          class={`nl-canvas-stage ${panDrag ? 'is-panning' : ''} ${pendingWire ? 'is-connecting' : ''}`}
          data-testid="node-logic-canvas"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.button !== 1) return;
            setPresetsOpen(false);
            if (pendingWire) {
              setPendingWire(null);
              return;
            }
            setSelectedNodeId(null);
            setSelectedConnectionId(null);
            setPanDrag({
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              originPanX: viewport.panX,
              originPanY: viewport.panY,
            });
          }}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              stepZoom(event.deltaY < 0 ? 'in' : 'out');
            }
          }}
        >
          {!activeGraph ? (
            <div class="nl-empty-state">
              <div class="nl-empty-icon"><StudioIcon name="logicNodes" /></div>
              <strong>No Logic Graphs in This Project</strong>
              <p>Connect visual events, state variables, branches, and live actions over your .flop AST.</p>
              <div class="nl-empty-actions">
                <button type="button" class="nl-primary-btn" onClick={handleLoadStarterFlow}>
                  Load Starter Interaction Flow
                </button>
                <button type="button" class="nl-secondary-btn" onClick={handleCreateEmptyGraph}>
                  Create Blank Graph
                </button>
              </div>
            </div>
          ) : (
            <div
              class="nl-canvas-world"
              style={{
                transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              }}
            >
              {/* SVG Wire Layer */}
              <svg class="nl-wires-svg" aria-label="Logic connections">
                {activeGraph.connections.map((conn) => {
                  const srcNode = displayNodesById.get(conn.sourceNodeId);
                  const tgtNode = displayNodesById.get(conn.targetNodeId);
                  if (!srcNode || !tgtNode) return null;
                  const start = getLogicPortWorldPosition(srcNode, conn.sourcePortId);
                  const end = getLogicPortWorldPosition(tgtNode, conn.targetPortId);
                  if (!start || !end) return null;
                  const pathD = buildLogicWirePath(start, end);
                  const dataType = getLogicPortDataType(srcNode.type, conn.sourcePortId);
                  const isSelected = selectedConnectionId === conn.id;
                  return (
                    <g key={conn.id} class={`nl-wire-group nl-wire-${dataType} ${isSelected ? 'is-selected' : ''}`}>
                      <path
                        d={pathD}
                        class="nl-wire-hit"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedConnectionId(conn.id);
                          setSelectedNodeId(null);
                          setInspectorTab('node');
                        }}
                      />
                      <path d={pathD} class="nl-wire-stroke" />
                    </g>
                  );
                })}
                {pendingWirePath && (
                  <path d={pendingWirePath} class="nl-wire-pending" />
                )}
              </svg>

              {/* HTML Node Cards Layer */}
              {displayNodes.map((node) => {
                const def = getLogicNodeDefinition(node.type);
                const category = getLogicNodeCategory(node.type);
                const marker = CATEGORY_MARKERS[category];
                const { inputs, outputs } = getLogicNodePorts(node.type);
                const rowCount = Math.max(1, inputs.length, outputs.length);
                const summary = getLogicNodeSummary(
                  node,
                  scopedAstNodes,
                  availableVariables,
                  designTokens.themes,
                  project.animations ?? [],
                );
                const diagCounts = diagnosticsByNodeId.get(node.id);
                const isSelected = selectedNodeId === node.id;

                return (
                  <article
                    key={node.id}
                    data-logic-node-id={node.id}
                    class={`nl-node-card nl-cat-${category} ${isSelected ? 'is-selected' : ''} ${diagCounts?.errors ? 'has-error' : ''}`}
                    style={{
                      width: `${LOGIC_NODE_WIDTH}px`,
                      transform: `translate(${node.x}px, ${node.y}px)`,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedNodeId(node.id);
                      setSelectedConnectionId(null);
                    }}
                  >
                    <header
                      class="nl-node-header"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                        setSelectedConnectionId(null);
                        setInspectorTab('node');
                        setNodeDrag({
                          nodeId: node.id,
                          pointerId: event.pointerId,
                          startClientX: event.clientX,
                          startClientY: event.clientY,
                          originX: node.x,
                          originY: node.y,
                          currentX: node.x,
                          currentY: node.y,
                        });
                      }}
                    >
                      <span class="nl-node-marker" aria-hidden="true">{marker.glyph}</span>
                      <strong class="nl-node-title">{def?.label ?? node.type}</strong>
                      {diagCounts?.errors ? (
                        <span class="nl-node-diag is-error" title={`${diagCounts.errors} validation error(s)`}>
                          !{diagCounts.errors}
                        </span>
                      ) : diagCounts?.warnings ? (
                        <span class="nl-node-diag is-warning" title={`${diagCounts.warnings} warning(s)`}>
                          !{diagCounts.warnings}
                        </span>
                      ) : null}
                    </header>

                    <div class="nl-node-subtitle" title={summary}>
                      {summary}
                    </div>

                    <div class="nl-node-ports">
                      {Array.from({ length: rowCount }).map((_, rowIdx) => {
                        const inPort = inputs[rowIdx];
                        const outPort = outputs[rowIdx];

                        const inCompatible = Boolean(
                          pendingWire
                          && inPort
                          && canConnectLogicPorts(
                            activeGraph,
                            pendingWire.fromNodeId,
                            pendingWire.fromPortId,
                            node.id,
                            inPort.id,
                          ).ok,
                        );
                        const outCompatible = Boolean(
                          pendingWire
                          && outPort
                          && canConnectLogicPorts(
                            activeGraph,
                            pendingWire.fromNodeId,
                            pendingWire.fromPortId,
                            node.id,
                            outPort.id,
                          ).ok,
                        );

                        return (
                          <div key={rowIdx} class="nl-port-row">
                            <div class="nl-port-slot nl-port-slot-in">
                              {inPort && (
                                <button
                                  type="button"
                                  data-port-dir="in"
                                  data-port-id={inPort.id}
                                  class={`nl-port-btn nl-port-${inPort.dataType} ${inCompatible ? 'is-compatible' : ''} ${
                                    pendingWire?.fromNodeId === node.id && pendingWire?.fromPortId === inPort.id ? 'is-source' : ''
                                  }`}
                                  aria-label={`Input port ${inPort.label} (${inPort.dataType}) on ${def?.label ?? node.type}`}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => handlePortClick(event, node.id, inPort.id, 'in')}
                                >
                                  <span class={`nl-port-socket ${inPort.dataType === 'exec' ? 'is-exec' : ''}`} />
                                  <span class="nl-port-label">{inPort.label}</span>
                                </button>
                              )}
                            </div>

                            <div class="nl-port-slot nl-port-slot-out">
                              {outPort && (
                                <button
                                  type="button"
                                  data-port-dir="out"
                                  data-port-id={outPort.id}
                                  class={`nl-port-btn nl-port-${outPort.dataType} ${outCompatible ? 'is-compatible' : ''} ${
                                    pendingWire?.fromNodeId === node.id && pendingWire?.fromPortId === outPort.id ? 'is-source' : ''
                                  }`}
                                  aria-label={`Output port ${outPort.label} (${outPort.dataType}) on ${def?.label ?? node.type}`}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => handlePortClick(event, node.id, outPort.id, 'out')}
                                >
                                  <span class="nl-port-label">{outPort.label}</span>
                                  <span class={`nl-port-socket ${outPort.dataType === 'exec' ? 'is-exec' : ''}`} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}

              {activeGraph.nodes.length === 0 && (
                <div class="nl-empty-graph-hint">
                  Click any node in the left palette to add it to “{activeGraph.name}”.
                </div>
              )}
            </div>
          )}

          {pendingWire && (
            <div class="nl-wire-banner" role="status">
              Select a highlighted compatible port to connect · Press Escape to cancel
            </div>
          )}
        </div>

        {/* Right Node, Variables & Simulation Inspector */}
        <NodeLogicInspector
          activeTab={inspectorTab}
          graph={activeGraph}
          selectedNode={selectedNode}
          selectedConnection={selectedConnection}
          scopedAstNodes={scopedAstNodes}
          availableVariables={availableVariables}
          components={project.components}
          pages={project.pages}
          themes={designTokens.themes}
          animations={project.animations ?? []}
          diagnostics={diagnostics}
          runtimeSnapshot={runtimeSnapshot}
          onChangeTab={setInspectorTab}
          onUpdateNodeData={(nodeId, patch) => {
            if (!activeGraph) return;
            commitGraphUpdate(updateNodeDataInGraph(activeGraph, nodeId, patch), 'Update logic node properties');
          }}
          onDeleteNode={(nodeId) => {
            if (!activeGraph) return;
            commitGraphUpdate(removeNodeFromGraph(activeGraph, nodeId), 'Delete logic node');
            setSelectedNodeId(null);
          }}
          onDeleteConnection={(connectionId) => {
            if (!activeGraph) return;
            commitGraphUpdate(removeConnectionFromGraph(activeGraph, connectionId), 'Disconnect logic wire');
            setSelectedConnectionId(null);
          }}
          onFocusNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedConnectionId(null);
            setInspectorTab('node');
            const target = activeGraph?.nodes.find((n) => n.id === nodeId);
            const rect = stageRef.current?.getBoundingClientRect();
            if (target && rect) {
              setViewport((current) => ({
                ...current,
                panX: Math.round(rect.width / 2 - (target.x + LOGIC_NODE_WIDTH / 2) * current.zoom),
                panY: Math.round(rect.height / 2 - (target.y + 70) * current.zoom),
              }));
            }
          }}
          onAddVariable={(args: { name: string; valueType: LogicValueType; initialValue: LogicVariableValue }) => {
            if (!activeGraph) return;
            const { graph: nextGraph, variable } = addVariableToGraph(activeGraph, args);
            commitGraphUpdate(nextGraph, `Add logic variable "${variable.name}"`);
            onNotice(`Declared variable “${variable.name}” (${variable.valueType}).`);
          }}
          onUpdateVariable={(variableId, patch) => {
            if (!activeGraph) return;
            commitGraphUpdate(updateVariableInGraph(activeGraph, variableId, patch), 'Update logic variable');
          }}
          onDeleteVariable={(variableId) => {
            if (!activeGraph) return;
            commitGraphUpdate(removeVariableFromGraph(activeGraph, variableId), 'Delete logic variable');
          }}
          onRunMount={() => {
            if (!runtimeRef.current) return;
            setRuntimeSnapshot(runtimeRef.current.mount());
          }}
          onTriggerNodeEvent={(targetAstNodeId: string, eventKind: LogicNodeEventKind) => {
            if (!runtimeRef.current) return;
            setRuntimeSnapshot(runtimeRef.current.dispatchNodeEvent(targetAstNodeId, eventKind));
          }}
          onResetRuntime={() => {
            if (!runtimeRef.current) return;
            setRuntimeSnapshot(runtimeRef.current.reset());
          }}
        />
      </div>
    </div>
  );
}

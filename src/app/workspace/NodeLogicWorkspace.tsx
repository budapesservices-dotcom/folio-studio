import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  DesignNode,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariableValue,
} from '../../core/document/types';
import {
  createLogicGraph,
  createPrototypeRuntime,
  getLogicNodeDefinition,
  getLogicNodeGuide,
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
  autoArrangeLogicGraph,
  buildLogicWirePath,
  canConnectLogicPorts,
  computeFitViewTransform,
  computeNextNodePosition,
  createLogicId,
  createLogicPresetGraph,
  createStarterMainPageLogicGraph,
  findSnapLogicPort,
  getLogicNodeCategory,
  getLogicNodePorts,
  getLogicNodeSummary,
  getLogicPortDataType,
  getLogicPortWorldPosition,
  getUsedSourceReferenceIds,
  isSourceLogicNodeType,
  moveNodeInGraph,
  removeConnectionFromGraph,
  removeNodeFromGraph,
  removeVariableFromGraph,
  repatchConnectionInGraph,
  touchLogicGraph,
  updateNodeDataInGraph,
  updateVariableInGraph,
  type LogicPoint,
  type LogicPresetId,
  type LogicViewportTransform,
  type SnapLogicPortMatch,
} from './nodeLogicGraphHelpers';
import { NodeLogicInspector, type NodeLogicInspectorTab } from './NodeLogicInspector';
import { StudioIcon } from './StudioIcon';

export interface NodeLogicWorkspaceProps {
  project: FolioProject;
  activePageId: string;
  mainCommandClient: MainCanvasCommandClient;
  onNotice: (message: string) => void;
  onOpenLivePreview: (pageId?: string) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  autoArrangeRequestNonce?: number;
  onActiveGraphNodeCountChange?: (nodeCount: number) => void;
}

interface WirePatchState {
  readonly mode: 'drag' | 'click';
  readonly pointerId: number | null;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly hasDragged: boolean;
  readonly anchorNodeId: string;
  readonly anchorPortId: string;
  readonly anchorDirection: 'in' | 'out';
  readonly pointerWorld: LogicPoint;
  readonly snapTarget: SnapLogicPortMatch | null;
  readonly detachedConnection?: LogicConnection;
}

interface WireLiftCandidate {
  readonly connection: LogicConnection;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
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

const DRAG_ACTIVATION_THRESHOLD_PX = 5;
const WIRE_SNAP_RADIUS_WORLD = 28;

const CATEGORY_FILTER_OPTIONS: readonly { id: 'all' | LogicNodeCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'source', label: 'Sources' },
  { id: 'event', label: 'Events' },
  { id: 'state', label: 'State' },
  { id: 'logic', label: 'Logic' },
  { id: 'action', label: 'Actions' },
];

const CATEGORY_MARKERS: Record<LogicNodeCategory | 'custom', { glyph: string; label: string }> = {
  source: { glyph: '◈', label: 'Source' },
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
  onToggleComponentNodeLogic,
  autoArrangeRequestNonce = 0,
  onActiveGraphNodeCountChange,
}: NodeLogicWorkspaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastHandledArrangeNonceRef = useRef<number>(0);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(
    () => project.logicGraphs[0]?.id ?? null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [openGuideNodeId, setOpenGuideNodeId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<NodeLogicInspectorTab>('node');
  const [paletteCategory, setPaletteCategory] = useState<'all' | LogicNodeCategory>('all');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [renamingGraph, setRenamingGraph] = useState(false);
  const [graphNameDraft, setGraphNameDraft] = useState('');
  const [viewport, setViewport] = useState<LogicViewportTransform>({ panX: 32, panY: 32, zoom: 0.85 });
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [wirePatch, setWirePatch] = useState<WirePatchState | null>(null);
  const [wireLiftCandidate, setWireLiftCandidate] = useState<WireLiftCandidate | null>(null);
  const suppressNextPortClickRef = useRef(false);

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
      setOpenGuideNodeId(null);
      return;
    }
    if (selectedNodeId && !activeGraph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (selectedConnectionId && !activeGraph.connections.some((c) => c.id === selectedConnectionId)) {
      setSelectedConnectionId(null);
    }
    if (openGuideNodeId && !activeGraph.nodes.some((n) => n.id === openGuideNodeId)) {
      setOpenGuideNodeId(null);
    }
  }, [activeGraph, selectedNodeId, selectedConnectionId, openGuideNodeId]);

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

    // Pre-fill helpful defaults — auto-picking the first unused source reference for source.* nodes
    const defaultExtras: Record<string, string | number | boolean | null> = {};
    if (type === 'source.page') {
      const usedPages = getUsedSourceReferenceIds(targetGraph, 'source.page');
      const firstAvailable = project.pages.find((page) => !usedPages.has(page.id));
      defaultExtras.pageId = firstAvailable?.id ?? '';
    } else if (type === 'source.component') {
      const usedComponents = getUsedSourceReferenceIds(targetGraph, 'source.component');
      const firstAvailable = project.components.find(
        (comp) => comp.nodeLogicEnabled && !usedComponents.has(comp.id),
      );
      defaultExtras.componentId = firstAvailable?.id ?? '';
    } else if (type === 'source.element') {
      const usedElements = getUsedSourceReferenceIds(targetGraph, 'source.element');
      const firstAvailable = scopedAstNodes.find((item) => !usedElements.has(item.id));
      defaultExtras.targetNodeId = firstAvailable?.id ?? '';
    } else if (type === 'source.theme') {
      const usedThemes = getUsedSourceReferenceIds(targetGraph, 'source.theme');
      const firstAvailable = designTokens.themes.find((theme) => !usedThemes.has(theme.id));
      defaultExtras.themeId = firstAvailable?.id ?? '';
    } else if (type === 'action.set-theme' && designTokens.themes[0]) {
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

  const handleAutoArrange = useCallback(() => {
    if (!activeGraph || activeGraph.nodes.length === 0) {
      onNotice('No logic nodes to arrange.');
      return;
    }
    const arranged = autoArrangeLogicGraph(activeGraph);
    const rect = stageRef.current?.getBoundingClientRect();
    if (arranged === activeGraph) {
      if (rect && rect.width > 0 && rect.height > 0) {
        setViewport(computeFitViewTransform(arranged.nodes, rect.width, rect.height));
      }
      onNotice('Logic graph is already neatly arranged.');
      return;
    }
    commitGraphUpdate(arranged, 'Auto-arrange logic graph');
    if (rect && rect.width > 0 && rect.height > 0) {
      setViewport(computeFitViewTransform(arranged.nodes, rect.width, rect.height));
    }
    const count = arranged.nodes.length;
    onNotice(`Auto-arranged ${count} logic ${count === 1 ? 'node' : 'nodes'}.`);
  }, [activeGraph, commitGraphUpdate, onNotice]);

  useEffect(() => {
    onActiveGraphNodeCountChange?.(activeGraph?.nodes.length ?? 0);
  }, [activeGraph?.nodes.length, onActiveGraphNodeCountChange]);

  useEffect(() => {
    if (autoArrangeRequestNonce <= lastHandledArrangeNonceRef.current) return;
    lastHandledArrangeNonceRef.current = autoArrangeRequestNonce;
    handleAutoArrange();
  }, [autoArrangeRequestNonce, handleAutoArrange]);

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

  const connectedPortKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!activeGraph) return keys;
    const liftedId =
      wirePatch?.hasDragged && wirePatch.detachedConnection ? wirePatch.detachedConnection.id : null;
    for (const conn of activeGraph.connections) {
      if (conn.id === liftedId) continue;
      keys.add(`${conn.sourceNodeId}:${conn.sourcePortId}`);
      keys.add(`${conn.targetNodeId}:${conn.targetPortId}`);
    }
    return keys;
  }, [activeGraph, wirePatch]);

  // Global pointer tracking for smooth node dragging, panning, and drag-and-patch / drag-to-disconnect wires
  useEffect(() => {
    if (!nodeDrag && !panDrag && !wirePatch && !wireLiftCandidate) return;

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
        return;
      }

      if (panDrag && event.pointerId === panDrag.pointerId) {
        const dx = event.clientX - panDrag.startClientX;
        const dy = event.clientY - panDrag.startClientY;
        setViewport((current) => ({
          ...current,
          panX: Math.round(panDrag.originPanX + dx),
          panY: Math.round(panDrag.originPanY + dy),
        }));
        return;
      }

      if (wireLiftCandidate && event.pointerId === wireLiftCandidate.pointerId && activeGraph) {
        const dist = Math.hypot(
          event.clientX - wireLiftCandidate.startClientX,
          event.clientY - wireLiftCandidate.startClientY,
        );
        if (dist >= DRAG_ACTIVATION_THRESHOLD_PX) {
          const pointerWorld = screenToWorld(event.clientX, event.clientY);
          const conn = wireLiftCandidate.connection;
          const snapTarget = findSnapLogicPort(
            activeGraph,
            displayNodes,
            conn.sourceNodeId,
            conn.sourcePortId,
            pointerWorld,
            WIRE_SNAP_RADIUS_WORLD,
            conn.id,
          );
          setWireLiftCandidate(null);
          setWirePatch({
            mode: 'drag',
            pointerId: event.pointerId,
            startClientX: wireLiftCandidate.startClientX,
            startClientY: wireLiftCandidate.startClientY,
            hasDragged: true,
            anchorNodeId: conn.sourceNodeId,
            anchorPortId: conn.sourcePortId,
            anchorDirection: 'out',
            pointerWorld,
            snapTarget,
            detachedConnection: conn,
          });
        }
        return;
      }

      if (wirePatch) {
        if (wirePatch.mode === 'drag' && wirePatch.pointerId !== null && event.pointerId !== wirePatch.pointerId) {
          return;
        }
        const pointerWorld = screenToWorld(event.clientX, event.clientY);
        const dist = Math.hypot(event.clientX - wirePatch.startClientX, event.clientY - wirePatch.startClientY);
        const hasDragged = wirePatch.hasDragged || (wirePatch.mode === 'drag' && dist >= DRAG_ACTIVATION_THRESHOLD_PX);
        const snapTarget = activeGraph
          ? findSnapLogicPort(
              activeGraph,
              displayNodes,
              wirePatch.anchorNodeId,
              wirePatch.anchorPortId,
              pointerWorld,
              WIRE_SNAP_RADIUS_WORLD,
              wirePatch.detachedConnection?.id,
            )
          : null;
        setWirePatch((current) =>
          current
            ? {
                ...current,
                hasDragged,
                pointerWorld,
                snapTarget,
              }
            : null,
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

      if (wireLiftCandidate && event.pointerId === wireLiftCandidate.pointerId) {
        // Short click on wire without dragging selects it for inspection
        setSelectedConnectionId(wireLiftCandidate.connection.id);
        setSelectedNodeId(null);
        setInspectorTab('node');
        setWireLiftCandidate(null);
      }

      if (wirePatch && wirePatch.mode === 'drag' && event.pointerId === wirePatch.pointerId) {
        if (!wirePatch.hasDragged) {
          if (wirePatch.detachedConnection) {
            // Short tap on a connected input selects its incoming wire without unplugging
            setSelectedConnectionId(wirePatch.detachedConnection.id);
            setSelectedNodeId(null);
            setInspectorTab('node');
            setWirePatch(null);
            suppressNextPortClickRef.current = true;
          } else {
            // Quick click on an unwired socket falls back gracefully to click-to-connect mode
            setWirePatch({
              ...wirePatch,
              mode: 'click',
              pointerId: null,
              hasDragged: false,
            });
            suppressNextPortClickRef.current = true;
          }
          return;
        }

        // Completed a real drag gesture
        suppressNextPortClickRef.current = true;
        if (activeGraph) {
          const finalPointer = screenToWorld(event.clientX, event.clientY);
          const finalSnap =
            wirePatch.snapTarget
            ?? findSnapLogicPort(
              activeGraph,
              displayNodes,
              wirePatch.anchorNodeId,
              wirePatch.anchorPortId,
              finalPointer,
              WIRE_SNAP_RADIUS_WORLD,
              wirePatch.detachedConnection?.id,
            );

          if (wirePatch.detachedConnection) {
            const detached = wirePatch.detachedConnection;
            if (finalSnap) {
              if (
                finalSnap.nodeId === detached.targetNodeId
                && finalSnap.portId === detached.targetPortId
              ) {
                // Dropped back on the exact same port — keep existing wire untouched
              } else {
                const res = repatchConnectionInGraph(
                  activeGraph,
                  detached.id,
                  finalSnap.nodeId,
                  finalSnap.portId,
                );
                if (res.ok) {
                  commitGraphUpdate(res.graph, 'Re-patch logic wire');
                  setSelectedConnectionId(res.connection.id);
                  setSelectedNodeId(null);
                } else {
                  onNotice(res.reason);
                }
              }
            } else {
              // Dropped onto open canvas — disconnect the wire!
              commitGraphUpdate(removeConnectionFromGraph(activeGraph, detached.id), 'Disconnect logic wire');
              setSelectedConnectionId(null);
              onNotice('Disconnected logic wire.');
            }
          } else if (finalSnap) {
            const res = addConnectionToGraph(
              activeGraph,
              wirePatch.anchorNodeId,
              wirePatch.anchorPortId,
              finalSnap.nodeId,
              finalSnap.portId,
            );
            if (res.ok) {
              commitGraphUpdate(res.graph, 'Connect logic ports');
              setSelectedConnectionId(res.connection.id);
              setSelectedNodeId(null);
            } else {
              onNotice(res.reason);
            }
          }
        }
        setWirePatch(null);
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
  }, [
    nodeDrag,
    panDrag,
    wirePatch,
    wireLiftCandidate,
    viewport.zoom,
    activeGraph,
    displayNodes,
    commitGraphUpdate,
    screenToWorld,
    onNotice,
  ]);

  // Start drag-and-patch (or unplug an already-connected input socket) on pointerdown
  const handlePortPointerDown = (
    event: PointerEvent,
    nodeId: string,
    portId: string,
    direction: 'in' | 'out',
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!activeGraph) return;

    // If user already started click-mode wiring, let handlePortClick complete it
    if (wirePatch?.mode === 'click') return;

    const node = displayNodesById.get(nodeId);
    const startPos = node ? getLogicPortWorldPosition(node, portId) : null;
    if (!startPos) return;

    // If grabbing an already-connected input port, lift its latest incoming wire so dragging detaches or re-patches it
    if (direction === 'in') {
      const incoming = activeGraph.connections.filter(
        (conn) => conn.targetNodeId === nodeId && conn.targetPortId === portId,
      );
      const latestIncoming = incoming[incoming.length - 1];
      if (latestIncoming) {
        setWirePatch({
          mode: 'drag',
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          hasDragged: false,
          anchorNodeId: latestIncoming.sourceNodeId,
          anchorPortId: latestIncoming.sourcePortId,
          anchorDirection: 'out',
          pointerWorld: startPos,
          snapTarget: null,
          detachedConnection: latestIncoming,
        });
        return;
      }
    }

    setWirePatch({
      mode: 'drag',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasDragged: false,
      anchorNodeId: nodeId,
      anchorPortId: portId,
      anchorDirection: direction,
      pointerWorld: startPos,
      snapTarget: null,
    });
  };

  // Preserve accessible click-to-connect / keyboard Enter wiring alongside drag-and-patch
  const handlePortClick = (
    event: MouseEvent,
    nodeId: string,
    portId: string,
    direction: 'in' | 'out',
  ) => {
    event.stopPropagation();
    if (suppressNextPortClickRef.current) {
      suppressNextPortClickRef.current = false;
      return;
    }
    if (!activeGraph) return;

    if (!wirePatch) {
      const node = displayNodesById.get(nodeId);
      const startPos = node ? getLogicPortWorldPosition(node, portId) : null;
      if (!startPos) return;
      setWirePatch({
        mode: 'click',
        pointerId: null,
        startClientX: event.clientX,
        startClientY: event.clientY,
        hasDragged: false,
        anchorNodeId: nodeId,
        anchorPortId: portId,
        anchorDirection: direction,
        pointerWorld: startPos,
        snapTarget: null,
      });
      return;
    }

    // Clicking the same port cancels pending wire cleanly
    if (wirePatch.anchorNodeId === nodeId && wirePatch.anchorPortId === portId) {
      setWirePatch(null);
      return;
    }

    const result = addConnectionToGraph(
      activeGraph,
      wirePatch.anchorNodeId,
      wirePatch.anchorPortId,
      nodeId,
      portId,
    );
    setWirePatch(null);
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
    if (event.key === 'Escape' && (wirePatch || wireLiftCandidate || openGuideNodeId)) {
      event.preventDefault();
      setWirePatch(null);
      setWireLiftCandidate(null);
      setOpenGuideNodeId(null);
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
  const openGuideNode = activeGraph?.nodes.find((n) => n.id === openGuideNodeId) ?? null;
  const openNodeGuide = openGuideNode ? getLogicNodeGuide(openGuideNode.type) : null;

  const isWireActivelyShown = Boolean(wirePatch && (wirePatch.mode === 'click' || wirePatch.hasDragged));

  const pendingWirePath = useMemo(() => {
    if (!wirePatch || !isWireActivelyShown) return null;
    const anchorNode = displayNodesById.get(wirePatch.anchorNodeId);
    const anchorPos = anchorNode ? getLogicPortWorldPosition(anchorNode, wirePatch.anchorPortId) : null;
    if (!anchorPos) return null;
    const endPoint = wirePatch.snapTarget ? wirePatch.snapTarget.position : wirePatch.pointerWorld;
    return wirePatch.anchorDirection === 'out'
      ? buildLogicWirePath(anchorPos, endPoint)
      : buildLogicWirePath(endPoint, anchorPos);
  }, [wirePatch, isWireActivelyShown, displayNodesById]);

  const isUnpluggingWire = Boolean(
    isWireActivelyShown && wirePatch?.detachedConnection && !wirePatch.snapTarget,
  );

  const renderInlineSourcePicker = (node: LogicNode) => {
    if (!activeGraph || !isSourceLogicNodeType(node.type)) return null;

    if (node.type === 'source.page') {
      const currentPageId = typeof node.data.pageId === 'string' ? node.data.pageId : '';
      const usedIds = getUsedSourceReferenceIds(activeGraph, 'source.page', node.id);
      return (
        <div
          class="nl-node-picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            class="nl-node-select"
            aria-label="Select page for Page node"
            value={currentPageId}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { pageId: event.currentTarget.value }),
                'Bind Page node',
              );
            }}
          >
            <option value="">Select page…</option>
            {project.pages.map((page) => {
              const isUsed = usedIds.has(page.id);
              return (
                <option key={page.id} value={page.id} disabled={isUsed}>
                  {page.name} ({page.route}){isUsed ? ' — In graph' : ''}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    if (node.type === 'source.component') {
      const currentComponentId = typeof node.data.componentId === 'string' ? node.data.componentId : '';
      const usedIds = getUsedSourceReferenceIds(activeGraph, 'source.component', node.id);
      const enabledComponents = project.components.filter(
        (comp) => comp.nodeLogicEnabled || comp.id === currentComponentId,
      );
      return (
        <div
          class="nl-node-picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            class="nl-node-select"
            aria-label="Select component for Component node"
            value={currentComponentId}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { componentId: event.currentTarget.value }),
                'Bind Component node',
              );
            }}
          >
            <option value="">
              {enabledComponents.length === 0 ? 'Send component to Node…' : 'Select component…'}
            </option>
            {enabledComponents.map((comp) => {
              const isUsed = usedIds.has(comp.id);
              const suffix = !comp.nodeLogicEnabled
                ? ' — Disabled'
                : isUsed
                  ? ' — In graph'
                  : '';
              return (
                <option key={comp.id} value={comp.id} disabled={isUsed}>
                  {comp.name}{suffix}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    if (node.type === 'source.element') {
      const currentTargetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      const usedIds = getUsedSourceReferenceIds(activeGraph, 'source.element', node.id);
      return (
        <div
          class="nl-node-picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            class="nl-node-select"
            aria-label="Select canvas layer for Canvas Layer node"
            value={currentTargetId}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { targetNodeId: event.currentTarget.value }),
                'Bind Canvas Layer node',
              );
            }}
          >
            <option value="">Select layer…</option>
            {scopedAstNodes.map((ast) => {
              const isUsed = usedIds.has(ast.id);
              return (
                <option key={ast.id} value={ast.id} disabled={isUsed}>
                  {ast.name} ({ast.type}){isUsed ? ' — In graph' : ''}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    const currentThemeId = typeof node.data.themeId === 'string' ? node.data.themeId : '';
    const usedIds = getUsedSourceReferenceIds(activeGraph, 'source.theme', node.id);
    return (
      <div
        class="nl-node-picker"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <select
          class="nl-node-select"
          aria-label="Select theme for Theme node"
          value={currentThemeId}
          onChange={(event) => {
            commitGraphUpdate(
              updateNodeDataInGraph(activeGraph, node.id, { themeId: event.currentTarget.value }),
              'Bind Theme node',
            );
          }}
        >
          <option value="">Select theme…</option>
          {designTokens.themes.map((theme) => {
            const isUsed = usedIds.has(theme.id);
            return (
              <option key={theme.id} value={theme.id} disabled={isUsed}>
                {theme.name}{isUsed ? ' — In graph' : ''}
              </option>
            );
          })}
        </select>
      </div>
    );
  };

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
                setWirePatch(null);
                setWireLiftCandidate(null);
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
              placeholder={`Filter ${LOGIC_CATALOG_LIST.length} nodes…`}
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
          class={`nl-canvas-stage ${panDrag ? 'is-panning' : ''} ${isWireActivelyShown ? 'is-connecting' : ''}`}
          data-testid="node-logic-canvas"
          onPointerDown={(event) => {
            if (event.button !== 0 && event.button !== 1) return;
            setPresetsOpen(false);
            setOpenGuideNodeId(null);
            if (wirePatch) {
              setWirePatch(null);
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
                  const isDetachedDragging = Boolean(
                    isWireActivelyShown && wirePatch?.detachedConnection?.id === conn.id,
                  );
                  return (
                    <g
                      key={conn.id}
                      data-connection-id={conn.id}
                      class={`nl-wire-group nl-wire-${dataType} ${isSelected ? 'is-selected' : ''} ${isDetachedDragging ? 'is-dragging-detached' : ''}`}
                    >
                      <path
                        d={pathD}
                        class="nl-wire-hit"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setWireLiftCandidate({
                            connection: conn,
                            pointerId: event.pointerId,
                            startClientX: event.clientX,
                            startClientY: event.clientY,
                          });
                        }}
                      />
                      <path d={pathD} class="nl-wire-stroke" />
                    </g>
                  );
                })}
                {pendingWirePath && (
                  <path
                    d={pendingWirePath}
                    class={`nl-wire-pending ${isUnpluggingWire ? 'is-unplugging' : ''} ${wirePatch?.snapTarget ? 'is-snapped' : ''}`}
                  />
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
                  project.pages,
                  project.components,
                );
                const isSourceNode = isSourceLogicNodeType(node.type);
                const diagCounts = diagnosticsByNodeId.get(node.id);
                const isSelected = selectedNodeId === node.id;
                const isGuideOpen = openGuideNodeId === node.id;

                return (
                  <article
                    key={node.id}
                    data-logic-node-id={node.id}
                    class={`nl-node-card nl-cat-${category} ${isSelected ? 'is-selected' : ''} ${isGuideOpen ? 'has-guide-open' : ''} ${diagCounts?.errors ? 'has-error' : ''}`}
                    style={{
                      width: `${LOGIC_NODE_WIDTH}px`,
                      transform: `translate(${node.x}px, ${node.y}px)`,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedNodeId(node.id);
                      setSelectedConnectionId(null);
                      if (openGuideNodeId && openGuideNodeId !== node.id) {
                        setOpenGuideNodeId(null);
                      }
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
                      <button
                        type="button"
                        class={`nl-node-guide-btn ${isGuideOpen ? 'is-active' : ''}`}
                        aria-label={`Connection guide for ${def?.label ?? node.type}`}
                        aria-expanded={isGuideOpen}
                        title="Connection guide: see what connects IN and OUT"
                        data-testid={`nl-guide-btn-${node.id}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedNodeId(node.id);
                          setOpenGuideNodeId((current) => (current === node.id ? null : node.id));
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true" class="nl-guide-bulb-svg">
                          <path
                            d="M8 1.75a4.25 4.25 0 0 0-2.46 7.71c.48.35.76.89.76 1.48v.31h3.4v-.31c0-.59.28-1.13.76-1.48A4.25 4.25 0 0 0 8 1.75Z"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.35"
                            stroke-linejoin="round"
                          />
                          <path
                            d="M6.45 12.85h3.1M6.9 14.35h2.2"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.35"
                            stroke-linecap="round"
                          />
                        </svg>
                      </button>
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

                    {isSourceNode ? (
                      renderInlineSourcePicker(node)
                    ) : (
                      <div class="nl-node-subtitle" title={summary}>
                        {summary}
                      </div>
                    )}

                    <div class="nl-node-ports">
                      {Array.from({ length: rowCount }).map((_, rowIdx) => {
                        const inPort = inputs[rowIdx];
                        const outPort = outputs[rowIdx];

                        const inConnected = Boolean(inPort && connectedPortKeys.has(`${node.id}:${inPort.id}`));
                        const outConnected = Boolean(outPort && connectedPortKeys.has(`${node.id}:${outPort.id}`));

                        const inCompatible = Boolean(
                          isWireActivelyShown
                          && wirePatch
                          && inPort
                          && canConnectLogicPorts(
                            activeGraph,
                            wirePatch.anchorNodeId,
                            wirePatch.anchorPortId,
                            node.id,
                            inPort.id,
                            wirePatch.detachedConnection?.id,
                          ).ok,
                        );
                        const outCompatible = Boolean(
                          isWireActivelyShown
                          && wirePatch
                          && outPort
                          && canConnectLogicPorts(
                            activeGraph,
                            wirePatch.anchorNodeId,
                            wirePatch.anchorPortId,
                            node.id,
                            outPort.id,
                            wirePatch.detachedConnection?.id,
                          ).ok,
                        );

                        const inSnapped = Boolean(
                          isWireActivelyShown
                          && wirePatch?.snapTarget
                          && inPort
                          && wirePatch.snapTarget.nodeId === node.id
                          && wirePatch.snapTarget.portId === inPort.id,
                        );
                        const outSnapped = Boolean(
                          isWireActivelyShown
                          && wirePatch?.snapTarget
                          && outPort
                          && wirePatch.snapTarget.nodeId === node.id
                          && wirePatch.snapTarget.portId === outPort.id,
                        );

                        return (
                          <div key={rowIdx} class="nl-port-row">
                            <div class="nl-port-slot nl-port-slot-in">
                              {inPort && (
                                <button
                                  type="button"
                                  data-port-dir="in"
                                  data-port-id={inPort.id}
                                  class={`nl-port-btn nl-port-${inPort.dataType} ${inConnected ? 'is-connected' : ''} ${inCompatible ? 'is-compatible' : ''} ${inSnapped ? 'is-snap-target' : ''} ${
                                    isWireActivelyShown && wirePatch?.anchorNodeId === node.id && wirePatch?.anchorPortId === inPort.id ? 'is-source' : ''
                                  }`}
                                  title={
                                    inConnected
                                      ? `Drag to disconnect or re-patch ${inPort.label}`
                                      : `Connect to ${inPort.label} (${inPort.dataType})`
                                  }
                                  aria-label={`Input port ${inPort.label} (${inPort.dataType}) on ${def?.label ?? node.type}`}
                                  onPointerDown={(event) => handlePortPointerDown(event, node.id, inPort.id, 'in')}
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
                                  class={`nl-port-btn nl-port-${outPort.dataType} ${outConnected ? 'is-connected' : ''} ${outCompatible ? 'is-compatible' : ''} ${outSnapped ? 'is-snap-target' : ''} ${
                                    isWireActivelyShown && wirePatch?.anchorNodeId === node.id && wirePatch?.anchorPortId === outPort.id ? 'is-source' : ''
                                  }`}
                                  title={`Drag from ${outPort.label} (${outPort.dataType}) to connect`}
                                  aria-label={`Output port ${outPort.label} (${outPort.dataType}) on ${def?.label ?? node.type}`}
                                  onPointerDown={(event) => handlePortPointerDown(event, node.id, outPort.id, 'out')}
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

          {openNodeGuide && openGuideNode && (
            <div
              class="nl-node-guide-popover"
              role="dialog"
              aria-label={`${openNodeGuide.label} connection guide`}
              data-testid="nl-node-guide-popover"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              <div class="nl-guide-popover-header">
                <span class="nl-guide-popover-title">
                  <svg class="nl-guide-bulb-svg" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 1.75a4.25 4.25 0 0 0-2.55 7.65c.44.33.8.95.8 1.55v.3h3.5v-.3c0-.6.36-1.22.8-1.55A4.25 4.25 0 0 0 8 1.75Z"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.25 13.1h3.5M6.9 14.5h2.2"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                    />
                  </svg>
                  <strong>{openNodeGuide.label}</strong>
                  <span>Connection Guide</span>
                </span>
                <button
                  type="button"
                  class="nl-guide-popover-close"
                  aria-label="Close connection guide"
                  onClick={() => setOpenGuideNodeId(null)}
                >
                  ×
                </button>
              </div>

              <p class="nl-guide-role">{openNodeGuide.roleSummary}</p>

              <div class="nl-guide-section">
                <div class="nl-guide-section-title">IN — Connects from</div>
                {openNodeGuide.inHints.length === 0 ? (
                  <p class="nl-guide-empty">Starting trigger / source node — no input wire required.</p>
                ) : (
                  <ul class="nl-guide-port-list">
                    {openNodeGuide.inHints.map((hint) => (
                      <li key={hint.portId} class="nl-guide-port-item">
                        <span class={`nl-guide-port-tag nl-port-${hint.dataType}`}>
                          {hint.portLabel} · {hint.dataType}
                        </span>
                        <span class="nl-guide-port-text">{hint.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div class="nl-guide-section">
                <div class="nl-guide-section-title">OUT — Connects to</div>
                {openNodeGuide.outHints.length === 0 ? (
                  <p class="nl-guide-empty">Terminal node — no outgoing port.</p>
                ) : (
                  <ul class="nl-guide-port-list">
                    {openNodeGuide.outHints.map((hint) => (
                      <li key={hint.portId} class="nl-guide-port-item">
                        <span class={`nl-guide-port-tag nl-port-${hint.dataType}`}>
                          {hint.portLabel} · {hint.dataType}
                        </span>
                        <span class="nl-guide-port-text">{hint.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div class="nl-guide-example">
                <span class="nl-guide-example-label">Example Flow</span>
                <span class="nl-guide-example-text">{openNodeGuide.exampleFlow}</span>
              </div>
            </div>
          )}

          {isWireActivelyShown && wirePatch && (
            <div class={`nl-wire-banner ${isUnpluggingWire ? 'is-unplugging' : ''}`} role="status">
              {wirePatch.detachedConnection
                ? wirePatch.snapTarget
                  ? 'Release to re-patch wire onto highlighted port'
                  : 'Release on empty canvas to disconnect wire · Drag onto a port to re-patch'
                : wirePatch.snapTarget
                  ? 'Release to connect wire'
                  : wirePatch.mode === 'drag'
                    ? 'Drag onto a highlighted compatible port to connect · Release on canvas to cancel'
                    : 'Click a highlighted compatible port to connect · Press Escape to cancel'}
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
          onToggleComponentNodeLogic={onToggleComponentNodeLogic}
        />
      </div>
    </div>
  );
}

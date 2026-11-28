import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  DesignNode,
  FolioProject,
  LogicConnection,
  LogicFrame,
  LogicFramePreset,
  LogicGraph,
  LogicNetworkSettings,
  LogicNode,
  LogicValueType,
  LogicVariableDefinition,
  LogicVariablePersist,
  LogicVariableScope,
  LogicVariableValue,
} from '../../core/document/types';
import {
  BAKED_FRAME_NODE_WIDTH,
  bakeLogicFrame,
  createLogicFramePresetFromFrame,
  createPrototypeRuntime,
  getLogicFrameColorPreset,
  getLogicNodeDefinition,
  getLogicNodeGuide,
  instantiateLogicFramePreset,
  loadStoredLogicFramePresets,
  saveStoredLogicFramePresets,
  unbakeLogicFrame,
  validateLogicGraphSemantics,
  type BuiltInLogicNodeType,
  type LogicDiagnostic,
  type LogicNodeCategory,
  type LogicNodeEventKind,
  type PrototypeRuntime,
  type PrototypeRuntimeSnapshot,
} from '../../engines/prototype';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  LOGIC_CATALOG_LIST,
  LOGIC_NODE_WIDTH,
  addConnectionToGraph,
  addNodeToGraph,
  addVariableToGraph,
  autoArrangeLogicGraph,
  buildLogicWirePath,
  canConnectLogicPorts,
  computeFitViewTransform,
  computeNextNodePosition,
  createComponentVariantToggleStarterGraph,
  createFrameInGraph,
  createLogicId,
  createLogicPresetGraph,
  createOwnerScopedEmptyLogicGraph,
  createStarterMainPageLogicGraph,
  deriveOwnerContextFromLogicGraph,
  findSnapLogicPort,
  formatNodeLogicOwnerBreadcrumb,
  getLogicNodeCategory,
  getLogicNodeIdsInMarquee,
  getLogicNodePorts,
  getLogicNodeSummary,
  getLogicPortDataType,
  getUsedSourceReferenceIds,
  isSourceLogicNodeType,
  migrateLegacyNodeInGraph,
  moveFrameWithChildrenInGraph,
  moveNodesInGraph,
  normalizeLogicMarqueeRect,
  removeConnectionFromGraph,
  removeFrameFromGraph,
  removeNodeFromGraph,
  removeNodesFromGraph,
  removeVariableFromGraph,
  repatchConnectionInGraph,
  resolveActiveLogicGraphForOwner,
  resolveLogicPortWorldPosition,
  resolveOwnerScopedLogicGraphs,
  syncNodeFrameMembershipAfterDrag,
  touchLogicGraph,
  updateFrameInGraph,
  updateNetworkSettingsInGraph,
  updateNodeDataInGraph,
  updateVariableInGraph,
  type LogicPoint,
  type LogicPresetId,
  type LogicViewportTransform,
  type NodeLogicOwnerContext,
  type SnapLogicPortMatch,
} from './nodeLogicGraphHelpers';
import { NodeLogicBrowser } from './NodeLogicBrowser';
import { NodeLogicInspector, type NodeLogicInspectorTab } from './NodeLogicInspector';
import { NodeLogicTransformPreview } from './NodeLogicTransformPreview';
import {
  NodeLogicPresetsMenu,
  computePresetsMenuLayout,
  type PresetsMenuLayout,
} from './NodeLogicPresetsMenu';
import { StudioIcon } from './StudioIcon';
import { StudioContextMenu, type StudioContextMenuItem } from './StudioContextMenu';

export interface NodeLogicWorkspaceProps {
  project: FolioProject;
  activePageId: string;
  ownerContext?: NodeLogicOwnerContext | null;
  onOwnerContextChange?: (next: NodeLogicOwnerContext) => void;
  onOpenOwner?: (owner: NodeLogicOwnerContext) => void;
  mainCommandClient: MainCanvasCommandClient;
  onNotice: (message: string) => void;
  onOpenLivePreview: (pageId?: string) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
  focusRequest?: {
    readonly graphId: string;
    readonly nodeIds: readonly string[];
    readonly nonce: number;
  } | null;
  autoArrangeRequestNonce?: number;
  onActiveGraphNodeCountChange?: (nodeCount: number) => void;
  onRuntimeSnapshotChange?: (
    snapshot: PrototypeRuntimeSnapshot | null,
    scope: 'page' | 'component' | 'project',
    targetId?: string,
  ) => void;
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
  readonly nodeIds: readonly string[];
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly dx: number;
  readonly dy: number;
}

interface MarqueeDragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startWorld: LogicPoint;
  readonly currentWorld: LogicPoint;
  readonly hasDragged: boolean;
  readonly additive: boolean;
  readonly baseSelection: readonly string[];
}

interface FrameDragState {
  readonly frameId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly dx: number;
  readonly dy: number;
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
  { id: 'flow', label: 'Flow' },
  { id: 'network', label: 'Network' },
];

const CATEGORY_MARKERS: Record<LogicNodeCategory | 'custom', { glyph: string; label: string }> = {
  source: { glyph: '◈', label: 'Source' },
  event: { glyph: '◆', label: 'Event' },
  state: { glyph: '■', label: 'State' },
  logic: { glyph: '⬡', label: 'Logic' },
  action: { glyph: '▸', label: 'Action' },
  flow: { glyph: '◷', label: 'Flow' },
  network: { glyph: '⇄', label: 'Network' },
  custom: { glyph: '○', label: 'Custom' },
};

export default function NodeLogicWorkspace({
  project,
  activePageId,
  ownerContext = null,
  onOwnerContextChange,
  onOpenOwner,
  mainCommandClient,
  onNotice,
  onOpenLivePreview,
  onToggleComponentNodeLogic,
  focusRequest = null,
  autoArrangeRequestNonce = 0,
  onActiveGraphNodeCountChange,
  onRuntimeSnapshotChange,
}: NodeLogicWorkspaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const presetsButtonRef = useRef<HTMLButtonElement | null>(null);
  const presetsMenuRef = useRef<HTMLDivElement | null>(null);
  const lastHandledArrangeNonceRef = useRef<number>(0);
  const lastHandledFocusNonceRef = useRef<number>(0);
  const [internalOwnerContext, setInternalOwnerContext] = useState<NodeLogicOwnerContext>(() => {
    if (ownerContext) return ownerContext;
    if (focusRequest?.graphId) {
      const focused = project.logicGraphs.find((g) => g.id === focusRequest.graphId);
      if (focused) return deriveOwnerContextFromLogicGraph(focused, activePageId);
    }
    return { scope: 'page', pageId: activePageId };
  });
  const effectiveOwnerContext: NodeLogicOwnerContext = ownerContext ?? internalOwnerContext;
  const setOwnerContext = useCallback(
    (next: NodeLogicOwnerContext) => {
      if (onOwnerContextChange) {
        onOwnerContextChange(next);
      } else {
        setInternalOwnerContext(next);
      }
    },
    [onOwnerContextChange],
  );
  const [activeGraphId, setActiveGraphId] = useState<string | null>(() => {
    const initialOwner: NodeLogicOwnerContext = ownerContext ?? { scope: 'page', pageId: activePageId };
    return resolveActiveLogicGraphForOwner(
      project.logicGraphs,
      initialOwner,
      focusRequest?.graphId ?? null,
    )?.id ?? null;
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [frameBakeErrors, setFrameBakeErrors] = useState<readonly LogicDiagnostic[]>([]);
  const [savedFramePresets, setSavedFramePresets] = useState<LogicFramePreset[]>(() => {
    const merged = new Map<string, LogicFramePreset>();
    for (const p of project.logicFramePresets ?? []) merged.set(p.id, p);
    for (const p of loadStoredLogicFramePresets()) merged.set(p.id, p);
    return Array.from(merged.values());
  });
  const [openGuideNodeId, setOpenGuideNodeId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<NodeLogicInspectorTab>('node');
  const [paletteCategory, setPaletteCategory] = useState<'all' | LogicNodeCategory>('all');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetsMenuPos, setPresetsMenuPos] = useState<PresetsMenuLayout | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [transformPreviewNodeId, setTransformPreviewNodeId] = useState<string | null>(null);
  const [renamingGraph, setRenamingGraph] = useState(false);
  const [graphNameDraft, setGraphNameDraft] = useState('');
  const [viewport, setViewport] = useState<LogicViewportTransform>({ panX: 32, panY: 32, zoom: 0.85 });
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const [marqueeDrag, setMarqueeDrag] = useState<MarqueeDragState | null>(null);
  const [frameDrag, setFrameDrag] = useState<FrameDragState | null>(null);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [spacePanHeld, setSpacePanHeld] = useState(false);
  const [wirePatch, setWirePatch] = useState<WirePatchState | null>(null);
  const [wireLiftCandidate, setWireLiftCandidate] = useState<WireLiftCandidate | null>(null);
  const suppressNextPortClickRef = useRef(false);
  const suppressContextMenuRef = useRef(false);
  const [stageContextMenu, setStageContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string | null;
  } | null>(null);

  const computePresetsMenuPosition = useCallback((): PresetsMenuLayout | null => {
    const btn = presetsButtonRef.current;
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return computePresetsMenuLayout(
      { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }, []);

  useEffect(() => {
    if (!presetsOpen) return;
    const syncPosition = () => {
      const next = computePresetsMenuPosition();
      if (next) setPresetsMenuPos(next);
    };
    syncPosition();
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (presetsButtonRef.current?.contains(target) || presetsMenuRef.current?.contains(target)) {
        return;
      }
      setPresetsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPresetsOpen(false);
      }
    };
    const topbarEl = topbarRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && topbarEl
        ? new ResizeObserver(() => syncPosition())
        : null;
    if (resizeObserver && topbarEl) {
      resizeObserver.observe(topbarEl);
    }
    window.addEventListener('resize', syncPosition);
    topbarEl?.addEventListener('scroll', syncPosition, { passive: true });
    window.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncPosition);
      topbarEl?.removeEventListener('scroll', syncPosition);
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [presetsOpen, computePresetsMenuPosition]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable
      ) {
        return;
      }
      setSpacePanHeld(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanHeld(false);
    };
    const handleBlur = () => setSpacePanHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const activePage = useMemo(
    () => project.pages.find((page) => page.id === activePageId) ?? getActivePage(project),
    [project, activePageId],
  );
  const designTokens = useMemo(() => getProjectDesignTokens(project), [project]);

  const ownerComponent = useMemo(
    () =>
      effectiveOwnerContext.scope === 'component'
        ? (project.components.find((comp) => comp.id === effectiveOwnerContext.componentId) ?? null)
        : null,
    [effectiveOwnerContext, project.components],
  );

  const ownerBreadcrumb = useMemo(
    () => formatNodeLogicOwnerBreadcrumb(project, activePage.id, effectiveOwnerContext),
    [project, activePage.id, effectiveOwnerContext],
  );

  const scopedGraphs = useMemo(
    () => resolveOwnerScopedLogicGraphs(project.logicGraphs, effectiveOwnerContext),
    [project.logicGraphs, effectiveOwnerContext],
  );

  // Keep activeGraphId strictly synced with the current owner context — never hijack project.logicGraphs[0].
  useEffect(() => {
    const resolved = resolveActiveLogicGraphForOwner(
      project.logicGraphs,
      effectiveOwnerContext,
      activeGraphId,
    );
    const nextId = resolved?.id ?? null;
    if (nextId !== activeGraphId) {
      setActiveGraphId(nextId);
    }
  }, [project.logicGraphs, effectiveOwnerContext, activeGraphId]);

  const activeGraph: LogicGraph | null = useMemo(
    () => resolveActiveLogicGraphForOwner(project.logicGraphs, effectiveOwnerContext, activeGraphId),
    [project.logicGraphs, effectiveOwnerContext, activeGraphId],
  );

  // Clean up stale selection when active graph changes
  useEffect(() => {
    if (!activeGraph) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedFrameId(null);
      setSelectedConnectionId(null);
      setFrameBakeErrors([]);
      setOpenGuideNodeId(null);
      return;
    }
    const validIds = new Set(activeGraph.nodes.map((n) => n.id));
    if (selectedNodeId && !validIds.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (selectedNodeIds.some((id) => !validIds.has(id))) {
      setSelectedNodeIds((prev) => prev.filter((id) => validIds.has(id)));
    }
    if (selectedFrameId && !(activeGraph.frames ?? []).some((f) => f.id === selectedFrameId)) {
      setSelectedFrameId(null);
      setFrameBakeErrors([]);
    }
    if (selectedConnectionId && !activeGraph.connections.some((c) => c.id === selectedConnectionId)) {
      setSelectedConnectionId(null);
    }
    if (openGuideNodeId && !validIds.has(openGuideNodeId)) {
      setOpenGuideNodeId(null);
    }
    if (transformPreviewNodeId && !validIds.has(transformPreviewNodeId)) {
      setTransformPreviewNodeId(null);
    }
  }, [activeGraph, selectedNodeId, selectedNodeIds, selectedFrameId, selectedConnectionId, openGuideNodeId, transformPreviewNodeId]);

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

  // Honor external "Open in Node Graph" focus requests from Canvas Inspector
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastHandledFocusNonceRef.current) return;
    const targetGraph = project.logicGraphs.find((g) => g.id === focusRequest.graphId);
    if (!targetGraph) return;
    lastHandledFocusNonceRef.current = focusRequest.nonce;
    fittedGraphIdRef.current = targetGraph.id;
    setOwnerContext(deriveOwnerContextFromLogicGraph(targetGraph, activePageId));
    setActiveGraphId(targetGraph.id);

    const validIds = new Set(targetGraph.nodes.map((n) => n.id));
    const focusedIds = focusRequest.nodeIds.filter((id) => validIds.has(id));
    setSelectedFrameId(null);
    setSelectedConnectionId(null);
    setFrameBakeErrors([]);
    if (focusedIds.length > 0) {
      setSelectedNodeIds(focusedIds);
      setSelectedNodeId(focusedIds[0]);
      setInspectorTab('node');
    }

    const targetNodes =
      focusedIds.length > 0
        ? targetGraph.nodes.filter((n) => focusedIds.includes(n.id))
        : targetGraph.nodes;

    const applyFit = () => {
      const el = stageRef.current;
      if (el && el.clientWidth > 0 && el.clientHeight > 0 && targetNodes.length > 0) {
        setViewport(computeFitViewTransform(targetNodes, el.clientWidth, el.clientHeight));
      }
    };

    if (stageRef.current && stageRef.current.clientWidth > 0) {
      applyFit();
    } else if (typeof requestAnimationFrame === 'function') {
      const rafId = requestAnimationFrame(applyFit);
      return () => cancelAnimationFrame(rafId);
    }
  }, [focusRequest, project.logicGraphs, activePageId, setOwnerContext]);

  const scopedAstNodes: readonly DesignNode[] = useMemo(() => {
    if (activeGraph) {
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
    }
    if (effectiveOwnerContext.scope === 'component') {
      return ownerComponent?.document.nodes ?? [];
    }
    if (effectiveOwnerContext.scope === 'project') {
      return project.pages.flatMap((p) => p.document.nodes);
    }
    return (
      project.pages.find((p) => p.id === effectiveOwnerContext.pageId)?.document.nodes
      ?? activePage.document.nodes
    );
  }, [activeGraph, effectiveOwnerContext, ownerComponent, project.pages, project.components, activePage.document.nodes]);

  const scopedPreviewDocument = useMemo(() => {
    if (activeGraph?.scope === 'component') {
      return project.components.find((c) => c.id === activeGraph.targetId)?.document ?? activePage.document;
    }
    if (activeGraph?.scope === 'page') {
      return project.pages.find((p) => p.id === activeGraph.targetId)?.document ?? activePage.document;
    }
    if (effectiveOwnerContext.scope === 'component') {
      return ownerComponent?.document ?? activePage.document;
    }
    if (effectiveOwnerContext.scope === 'page') {
      return project.pages.find((p) => p.id === effectiveOwnerContext.pageId)?.document ?? activePage.document;
    }
    return activePage.document;
  }, [activeGraph, effectiveOwnerContext, ownerComponent, project.components, project.pages, activePage.document]);

  const activeTransformPreviewNode: LogicNode | null = useMemo(() => {
    if (!transformPreviewNodeId || !activeGraph) return null;
    const found = activeGraph.nodes.find((n) => n.id === transformPreviewNodeId);
    if (!found || found.type !== 'action.set-layer' || found.data.property !== 'transform') return null;
    return found;
  }, [transformPreviewNodeId, activeGraph]);

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
      : effectiveOwnerContext.scope === 'page'
        ? effectiveOwnerContext.pageId
        : activePage.id;
  const targetComponentIdForRuntime =
    activeGraph?.scope === 'component' && activeGraph.targetId
      ? activeGraph.targetId
      : effectiveOwnerContext.scope === 'component'
        ? effectiveOwnerContext.componentId
        : undefined;

  useEffect(() => {
    const nextRuntime = createPrototypeRuntime(project, {
      pageId: targetPageIdForRuntime,
      ...(targetComponentIdForRuntime ? { componentId: targetComponentIdForRuntime } : {}),
    });
    runtimeRef.current = nextRuntime;
    setRuntimeSnapshot(nextRuntime.getSnapshot());
  }, [project, targetPageIdForRuntime, targetComponentIdForRuntime]);

  useEffect(() => {
    const scope = activeGraph?.scope ?? effectiveOwnerContext.scope;
    const targetId =
      scope === 'component'
        ? targetComponentIdForRuntime
        : scope === 'page'
          ? targetPageIdForRuntime
          : undefined;
    onRuntimeSnapshotChange?.(runtimeSnapshot, scope, targetId);
  }, [runtimeSnapshot, activeGraph?.scope, effectiveOwnerContext.scope, targetComponentIdForRuntime, targetPageIdForRuntime, onRuntimeSnapshotChange]);

  useEffect(() => () => {
    onRuntimeSnapshotChange?.(null, 'page', undefined);
  }, [onRuntimeSnapshotChange]);

  const commitGraphUpdate = useCallback(
    (nextGraph: LogicGraph, description: string) => {
      mainCommandClient.updateLogicGraph(nextGraph, description);
    },
    [mainCommandClient],
  );

  const ensureComponentLogicEnabledIfOwned = () => {
    if (
      effectiveOwnerContext.scope === 'component'
      && ownerComponent
      && !ownerComponent.nodeLogicEnabled
      && onToggleComponentNodeLogic
    ) {
      onToggleComponentNodeLogic(ownerComponent, true);
    }
  };

  const handleCreateEmptyGraph = () => {
    const graph = createOwnerScopedEmptyLogicGraph(project, activePage, effectiveOwnerContext);
    const res = mainCommandClient.createLogicGraph(graph, `Create logic graph "${graph.name}"`);
    if (res.status === 'applied') {
      ensureComponentLogicEnabledIfOwned();
      setActiveGraphId(graph.id);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Created ${effectiveOwnerContext.scope} logic graph “${graph.name}”.`);
    }
  };

  const handleInsertPreset = (presetId: LogicPresetId) => {
    let graph = createLogicPresetGraph(presetId, project, activePage);
    if (effectiveOwnerContext.scope === 'component') {
      const compName = ownerComponent?.name ?? 'Component';
      const firstInteractive =
        ownerComponent?.document.nodes.find((n) => n.type !== 'group' && n.onCanvas !== false)
        ?? ownerComponent?.document.nodes[0];
      const firstText = ownerComponent?.document.nodes.find((n) => n.type === 'text');
      graph = {
        ...graph,
        name: `${compName} · ${graph.name}`,
        scope: 'component',
        targetId: effectiveOwnerContext.componentId,
        nodes: graph.nodes.map((node) => {
          if (node.type === 'action.set-variant') {
            const firstAxis = ownerComponent?.variants?.find((a) => a.options.length > 0);
            return {
              ...node,
              data: {
                ...node.data,
                targetMode: 'override',
                targetNodeId: '',
                ...(firstAxis
                  ? { axisId: firstAxis.id, optionId: firstAxis.options[0]?.id ?? '' }
                  : {}),
              },
            };
          }
          if (typeof node.data.targetNodeId === 'string' && node.data.targetNodeId) {
            const reboundId =
              node.type === 'action.set-text'
                ? (firstText?.id ?? firstInteractive?.id ?? '')
                : (firstInteractive?.id ?? '');
            return {
              ...node,
              data: {
                ...node.data,
                targetNodeId: reboundId,
              },
            };
          }
          return node;
        }),
      };
    } else if (effectiveOwnerContext.scope === 'project') {
      graph = {
        ...graph,
        scope: 'project',
        targetId: null,
      };
    }
    const res = mainCommandClient.createLogicGraph(graph, `Create preset graph "${graph.name}"`);
    setPresetsOpen(false);
    if (res.status === 'applied') {
      ensureComponentLogicEnabledIfOwned();
      fittedGraphIdRef.current = null;
      setActiveGraphId(graph.id);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      onNotice(`Loaded “${graph.name}” preset graph.`);
    }
  };

  const handleLoadStarterFlow = () => {
    let graph: LogicGraph;
    if (effectiveOwnerContext.scope === 'component' && ownerComponent) {
      graph = createComponentVariantToggleStarterGraph(ownerComponent);
    } else if (effectiveOwnerContext.scope === 'project') {
      graph = {
        ...createLogicPresetGraph('click-counter', project, activePage),
        scope: 'project',
        targetId: null,
      };
    } else {
      const targetPageId = effectiveOwnerContext.scope === 'page' ? effectiveOwnerContext.pageId : activePage.id;
      const targetPage =
        project.pages.find((p) => p.id === targetPageId) ?? activePage;
      const starter = createStarterMainPageLogicGraph(targetPage);
      graph = starter
        ? { ...starter, id: createLogicId('lgraph') }
        : createLogicPresetGraph('click-counter', project, targetPage);
    }
    const res = mainCommandClient.createLogicGraph(graph, `Create starter graph "${graph.name}"`);
    if (res.status === 'applied') {
      ensureComponentLogicEnabledIfOwned();
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
      const created = createOwnerScopedEmptyLogicGraph(
        project,
        activePage,
        effectiveOwnerContext,
        effectiveOwnerContext.scope === 'component' ? 'Logic' : 'Interactions',
      );
      const res = mainCommandClient.createLogicGraph(created, `Create logic graph "${created.name}"`);
      if (res.status !== 'applied') return;
      ensureComponentLogicEnabledIfOwned();
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
    } else if (type === 'source.context') {
      const usedPages = getUsedSourceReferenceIds(targetGraph, 'source.context');
      const firstAvailable = project.pages.find((page) => !usedPages.has(page.id));
      defaultExtras.contextKind = 'page';
      defaultExtras.pageId = firstAvailable?.id ?? '';
    } else if (type === 'source.theme') {
      const usedThemes = getUsedSourceReferenceIds(targetGraph, 'source.theme');
      const firstAvailable = designTokens.themes.find((theme) => !usedThemes.has(theme.id));
      defaultExtras.themeId = firstAvailable?.id ?? '';
    } else if (type === 'action.set-theme' && designTokens.themes[0]) {
      defaultExtras.themeId = designTokens.themes[0].id;
    } else if (type === 'action.system-form' && designTokens.themes[0]) {
      defaultExtras.action = 'set-theme';
      defaultExtras.themeId = designTokens.themes[0].id;
    } else if (type === 'action.navigate') {
      defaultExtras.route = activePage.route;
    } else if (type === 'action.set-variant') {
      defaultExtras.targetMode = 'override';
      if (targetGraph.scope === 'component') {
        const compMaster = project.components.find((comp) => comp.id === targetGraph.targetId);
        const firstAxis = compMaster?.variants?.find((axis) => axis.options.length > 0);
        defaultExtras.targetNodeId = '';
        defaultExtras.axisId = firstAxis?.id ?? '';
        defaultExtras.optionId = firstAxis?.options[0]?.id ?? '';
      } else {
        const firstInstance = scopedAstNodes.find((item) => item.type === 'component-instance');
        const instMaster =
          firstInstance && firstInstance.type === 'component-instance'
            ? project.components.find((comp) => comp.id === firstInstance.componentId)
            : undefined;
        const firstAxis = instMaster?.variants?.find((axis) => axis.options.length > 0);
        defaultExtras.targetNodeId = firstInstance?.id ?? '';
        defaultExtras.axisId = firstAxis?.id ?? '';
        defaultExtras.optionId = firstAxis?.options[0]?.id ?? '';
      }
    } else if (
      type === 'action.set-layer'
      || type === 'action.set-visible'
      || type === 'action.set-fill'
      || type === 'action.set-text'
      || type === 'action.media-animation'
    ) {
      defaultExtras.targetMode = 'pipeline';
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

  // Smart Logic Frame handlers
  const handleCreateOrWrapFrame = useCallback(() => {
    if (!activeGraph) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const centerWorld = rect
      ? {
          x: Math.round((rect.width / 2 - viewport.panX) / viewport.zoom - 150),
          y: Math.round((rect.height / 2 - viewport.panY) / viewport.zoom - 95),
        }
      : { x: 140, y: 100 };
    const candidateIds =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : selectedNodeId
          ? [selectedNodeId]
          : [];
    const { graph: nextGraph, frame } = createFrameInGraph(activeGraph, {
      childNodeIds: candidateIds,
      fallbackOrigin: centerWorld,
    });
    commitGraphUpdate(
      nextGraph,
      candidateIds.length > 0 ? `Wrap ${candidateIds.length} node(s) in Logic Frame` : 'Create empty Logic Frame',
    );
    setSelectedFrameId(frame.id);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedConnectionId(null);
    setFrameBakeErrors([]);
    setInspectorTab('node');
    onNotice(
      candidateIds.length > 0
        ? `Wrapped ${candidateIds.length} node${candidateIds.length === 1 ? '' : 's'} into "${frame.title}".`
        : `Created empty Smart Logic Frame "${frame.title}". Drag nodes inside to group.`,
    );
  }, [activeGraph, selectedNodeIds, selectedNodeId, viewport, commitGraphUpdate, onNotice]);

  const handleUpdateFrame = useCallback(
    (frameId: string, patch: Partial<Pick<LogicFrame, 'title' | 'color' | 'exposedParams'>>) => {
      if (!activeGraph) return;
      commitGraphUpdate(updateFrameInGraph(activeGraph, frameId, patch), 'Update Smart Logic Frame');
    },
    [activeGraph, commitGraphUpdate],
  );

  const handleBakeFrame = useCallback(
    (frameId: string) => {
      if (!activeGraph) return;
      const result = bakeLogicFrame(activeGraph, frameId, project);
      if (!result.ok) {
        setFrameBakeErrors(result.errors);
        setSelectedFrameId(frameId);
        setSelectedNodeId(null);
        setInspectorTab('node');
        onNotice(result.errors[0]?.message ?? 'Cannot bake Logic Frame due to validation errors.');
        return;
      }
      setFrameBakeErrors([]);
      commitGraphUpdate(result.graph, `Bake Logic Frame "${result.frame.title}"`);
      setSelectedFrameId(frameId);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedConnectionId(null);
      setInspectorTab('node');
      if (result.warnings.length > 0) {
        onNotice(
          `Baked "${result.frame.title}" (${result.warnings.length} portability warning${result.warnings.length === 1 ? '' : 's'} in Diagnostics).`,
        );
      } else {
        onNotice(
          `Baked "${result.frame.title}" into a compiled function block (${result.frame.bakedData?.compiledPlan.steps.length ?? 0} steps).`,
        );
      }
    },
    [activeGraph, project, commitGraphUpdate, onNotice],
  );

  const handleUnbakeFrame = useCallback(
    (frameId: string) => {
      if (!activeGraph) return;
      const target = (activeGraph.frames ?? []).find((f) => f.id === frameId);
      if (!target) return;
      const nextGraph = unbakeLogicFrame(activeGraph, frameId);
      setFrameBakeErrors([]);
      commitGraphUpdate(nextGraph, `Unbake Logic Frame "${target.title}"`);
      setSelectedFrameId(frameId);
      setInspectorTab('node');
      onNotice(`Unbaked "${target.title}" for visual editing.`);
    },
    [activeGraph, commitGraphUpdate, onNotice],
  );

  const handleSaveFramePreset = useCallback(
    (frameId: string) => {
      if (!activeGraph) return;
      const target = (activeGraph.frames ?? []).find((f) => f.id === frameId);
      if (!target) return;
      const preset = createLogicFramePresetFromFrame(activeGraph, target);
      const nextPresets = [
        preset,
        ...savedFramePresets.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase()),
      ].slice(0, 64);
      setSavedFramePresets(nextPresets);
      saveStoredLogicFramePresets(nextPresets);
      onNotice(`Saved "${preset.name}" to Presets menu.`);
    },
    [activeGraph, savedFramePresets, onNotice],
  );

  const handleInsertSavedFramePreset = useCallback(
    (preset: LogicFramePreset) => {
      setPresetsOpen(false);
      if (!activeGraph) return;
      const rect = stageRef.current?.getBoundingClientRect();
      const baseOrigin = rect
        ? {
            x: Math.round((rect.width / 2 - viewport.panX) / viewport.zoom - BAKED_FRAME_NODE_WIDTH / 2),
            y: Math.round((rect.height / 2 - viewport.panY) / viewport.zoom - 70),
          }
        : computeNextNodePosition(activeGraph);
      const insertOrigin = { ...baseOrigin };
      const existingFrames = activeGraph.frames ?? [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const collidesFrame = existingFrames.some(
          (f) =>
            Math.abs(f.bounds.x - insertOrigin.x) < BAKED_FRAME_NODE_WIDTH + 16 &&
            Math.abs(f.bounds.y - insertOrigin.y) < 168,
        );
        const collidesNode = activeGraph.nodes.some(
          (n) =>
            Math.abs(n.x - insertOrigin.x) < BAKED_FRAME_NODE_WIDTH &&
            Math.abs(n.y - insertOrigin.y) < 140,
        );
        if (!collidesFrame && !collidesNode) break;
        insertOrigin.y += 184;
      }
      const { graph: nextGraph, frame } = instantiateLogicFramePreset(activeGraph, preset, insertOrigin);
      commitGraphUpdate(nextGraph, `Insert Baked Frame preset "${preset.name}"`);
      setSelectedFrameId(frame.id);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedConnectionId(null);
      setFrameBakeErrors([]);
      setInspectorTab('node');
      onNotice(`Inserted independent "${frame.title}" instance. Wire any Event into its input port.`);
    },
    [activeGraph, viewport, commitGraphUpdate, onNotice],
  );

  const handleDeleteSavedFramePreset = useCallback(
    (presetId: string) => {
      const next = savedFramePresets.filter((item) => item.id !== presetId);
      setSavedFramePresets(next);
      saveStoredLogicFramePresets(next);
      onNotice('Removed saved Frame preset.');
    },
    [savedFramePresets, onNotice],
  );

  const handleDeleteFrame = useCallback(
    (frameId: string, deleteChildren = false) => {
      if (!activeGraph) return;
      const target = (activeGraph.frames ?? []).find((f) => f.id === frameId);
      commitGraphUpdate(
        removeFrameFromGraph(activeGraph, frameId, deleteChildren),
        deleteChildren ? 'Delete Baked Logic Frame' : 'Unwrap Logic Frame',
      );
      setSelectedFrameId(null);
      setFrameBakeErrors([]);
      onNotice(
        deleteChildren
          ? `Deleted baked frame "${target?.title ?? 'Frame'}" and its internal nodes.`
          : `Unwrapped "${target?.title ?? 'Frame'}" (internal nodes preserved).`,
      );
    },
    [activeGraph, commitGraphUpdate, onNotice],
  );

  // Render positions with live node drag and frame drag previews overlaid smoothly
  const displayFrames: readonly LogicFrame[] = useMemo(() => {
    const frames = activeGraph?.frames ?? [];
    if (!frameDrag) return frames;
    return frames.map((frame) =>
      frame.id === frameDrag.frameId
        ? {
            ...frame,
            bounds: {
              ...frame.bounds,
              x: Math.round(frame.bounds.x + frameDrag.dx),
              y: Math.round(frame.bounds.y + frameDrag.dy),
            },
          }
        : frame,
    );
  }, [activeGraph, frameDrag]);

  const draggedFrameChildIds = useMemo(() => {
    if (!frameDrag || !activeGraph) return null;
    const target = (activeGraph.frames ?? []).find((f) => f.id === frameDrag.frameId);
    return target ? new Set(target.childNodeIds) : null;
  }, [frameDrag, activeGraph]);

  const displayNodes = useMemo(() => {
    if (!activeGraph) return [];
    if (!nodeDrag && !frameDrag) return activeGraph.nodes;
    const draggedNodeIdSet = nodeDrag ? new Set(nodeDrag.nodeIds) : null;
    return activeGraph.nodes.map((node) => {
      if (nodeDrag && draggedNodeIdSet?.has(node.id)) {
        return {
          ...node,
          x: Math.round(node.x + nodeDrag.dx),
          y: Math.round(node.y + nodeDrag.dy),
        };
      }
      if (frameDrag && draggedFrameChildIds?.has(node.id)) {
        return {
          ...node,
          x: Math.round(node.x + frameDrag.dx),
          y: Math.round(node.y + frameDrag.dy),
        };
      }
      return node;
    });
  }, [activeGraph, nodeDrag, frameDrag, draggedFrameChildIds]);

  const displayNodesById = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );

  const bakedFrameByChildId = useMemo(() => {
    const map = new Map<string, LogicFrame>();
    for (const frame of displayFrames) {
      if (!frame.isBaked) continue;
      for (const cid of frame.childNodeIds) {
        map.set(cid, frame);
      }
    }
    return map;
  }, [displayFrames]);

  const marqueeRect = useMemo(
    () =>
      marqueeDrag?.hasDragged
        ? normalizeLogicMarqueeRect(marqueeDrag.startWorld, marqueeDrag.currentWorld)
        : null,
    [marqueeDrag],
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

  // Global pointer tracking for smooth multi-node dragging, marquee selection, frame dragging, panning, and wires
  useEffect(() => {
    if (!nodeDrag && !marqueeDrag && !frameDrag && !panDrag && !wirePatch && !wireLiftCandidate) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (nodeDrag && event.pointerId === nodeDrag.pointerId) {
        const dx = Math.round((event.clientX - nodeDrag.startClientX) / viewport.zoom);
        const dy = Math.round((event.clientY - nodeDrag.startClientY) / viewport.zoom);
        setNodeDrag((current) => (current ? { ...current, dx, dy } : null));
        return;
      }

      if (marqueeDrag && event.pointerId === marqueeDrag.pointerId) {
        const currentWorld = screenToWorld(event.clientX, event.clientY);
        const dist = Math.hypot(
          event.clientX - marqueeDrag.startClientX,
          event.clientY - marqueeDrag.startClientY,
        );
        const hasDragged = marqueeDrag.hasDragged || dist >= DRAG_ACTIVATION_THRESHOLD_PX;
        setMarqueeDrag((current) =>
          current
            ? {
                ...current,
                currentWorld,
                hasDragged,
              }
            : null,
        );
        if (hasDragged && activeGraph) {
          const rect = normalizeLogicMarqueeRect(marqueeDrag.startWorld, currentWorld);
          const hiddenIds = new Set(bakedFrameByChildId.keys());
          const hits = getLogicNodeIdsInMarquee(displayNodes, rect, hiddenIds);
          const nextSelected = marqueeDrag.additive
            ? Array.from(new Set([...marqueeDrag.baseSelection, ...hits]))
            : hits;
          setSelectedNodeIds(nextSelected);
          setSelectedNodeId(nextSelected[0] ?? null);
          setSelectedFrameId(null);
          setSelectedConnectionId(null);
        }
        return;
      }

      if (frameDrag && event.pointerId === frameDrag.pointerId) {
        const dx = Math.round((event.clientX - frameDrag.startClientX) / viewport.zoom);
        const dy = Math.round((event.clientY - frameDrag.startClientY) / viewport.zoom);
        setFrameDrag((current) => (current ? { ...current, dx, dy } : null));
        return;
      }

      if (panDrag && event.pointerId === panDrag.pointerId) {
        const dx = event.clientX - panDrag.startClientX;
        const dy = event.clientY - panDrag.startClientY;
        if (Math.hypot(dx, dy) > 4) {
          suppressContextMenuRef.current = true;
        }
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
            displayFrames,
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
              displayFrames,
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
        if (activeGraph && (nodeDrag.dx !== 0 || nodeDrag.dy !== 0)) {
          let nextGraph = moveNodesInGraph(activeGraph, nodeDrag.nodeIds, nodeDrag.dx, nodeDrag.dy);
          for (const movedId of nodeDrag.nodeIds) {
            nextGraph = syncNodeFrameMembershipAfterDrag(nextGraph, movedId);
          }
          commitGraphUpdate(
            nextGraph,
            nodeDrag.nodeIds.length > 1 ? 'Move logic nodes' : 'Move logic node',
          );
        }
        setNodeDrag(null);
      }

      if (marqueeDrag && event.pointerId === marqueeDrag.pointerId) {
        setMarqueeDrag(null);
      }

      if (frameDrag && event.pointerId === frameDrag.pointerId) {
        if (activeGraph && (frameDrag.dx !== 0 || frameDrag.dy !== 0)) {
          const nextGraph = moveFrameWithChildrenInGraph(
            activeGraph,
            frameDrag.frameId,
            frameDrag.dx,
            frameDrag.dy,
          );
          commitGraphUpdate(nextGraph, 'Move Smart Logic Frame');
        }
        setFrameDrag(null);
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
              displayFrames,
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
    marqueeDrag,
    frameDrag,
    panDrag,
    wirePatch,
    wireLiftCandidate,
    viewport.zoom,
    activeGraph,
    displayNodes,
    displayFrames,
    bakedFrameByChildId,
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

    const startPos = resolveLogicPortWorldPosition(
      displayNodesById,
      displayFrames,
      nodeId,
      portId,
      direction,
    );
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
      const startPos = resolveLogicPortWorldPosition(
        displayNodesById,
        displayFrames,
        nodeId,
        portId,
        direction,
      );
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
    setSelectedFrameId(null);
  };

  // Keyboard delete / Escape / Ctrl+G or Shift+G wrap in Frame inside Node Logic stage
  const handleStageKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === 'Escape' && (wirePatch || wireLiftCandidate || openGuideNodeId || presetsOpen || marqueeDrag)) {
      event.preventDefault();
      setWirePatch(null);
      setWireLiftCandidate(null);
      setOpenGuideNodeId(null);
      setPresetsOpen(false);
      setMarqueeDrag(null);
      return;
    }
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && event.key.toLowerCase() === 'g' && activeGraph) {
      event.preventDefault();
      handleCreateOrWrapFrame();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && activeGraph) {
      if (selectedConnectionId) {
        event.preventDefault();
        commitGraphUpdate(removeConnectionFromGraph(activeGraph, selectedConnectionId), 'Delete logic connection');
        setSelectedConnectionId(null);
      } else if (selectedFrameId) {
        event.preventDefault();
        const frame = (activeGraph.frames ?? []).find((f) => f.id === selectedFrameId);
        handleDeleteFrame(selectedFrameId, Boolean(frame?.isBaked));
      } else if (selectedNodeIds.length > 1) {
        event.preventDefault();
        commitGraphUpdate(removeNodesFromGraph(activeGraph, selectedNodeIds), 'Delete logic nodes');
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
      } else if (selectedNodeId) {
        event.preventDefault();
        commitGraphUpdate(removeNodeFromGraph(activeGraph, selectedNodeId), 'Delete logic node');
        setSelectedNodeId(null);
        setSelectedNodeIds((prev) => prev.filter((id) => id !== selectedNodeId));
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
  const selectedFrame = (activeGraph?.frames ?? []).find((f) => f.id === selectedFrameId) ?? null;
  const selectedConnection = activeGraph?.connections.find((c) => c.id === selectedConnectionId) ?? null;
  const openGuideNode = activeGraph?.nodes.find((n) => n.id === openGuideNodeId) ?? null;
  const openNodeGuide = openGuideNode ? getLogicNodeGuide(openGuideNode.type) : null;

  const isWireActivelyShown = Boolean(wirePatch && (wirePatch.mode === 'click' || wirePatch.hasDragged));

  const pendingWirePath = useMemo(() => {
    if (!wirePatch || !isWireActivelyShown) return null;
    const anchorPos = resolveLogicPortWorldPosition(
      displayNodesById,
      displayFrames,
      wirePatch.anchorNodeId,
      wirePatch.anchorPortId,
      wirePatch.anchorDirection,
    );
    if (!anchorPos) return null;
    const endPoint = wirePatch.snapTarget ? wirePatch.snapTarget.position : wirePatch.pointerWorld;
    return wirePatch.anchorDirection === 'out'
      ? buildLogicWirePath(anchorPos, endPoint)
      : buildLogicWirePath(endPoint, anchorPos);
  }, [wirePatch, isWireActivelyShown, displayNodesById, displayFrames]);

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
            aria-label="Select canvas layer for Element / Layer node"
            value={currentTargetId}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { targetNodeId: event.currentTarget.value }),
                'Bind Element / Layer node',
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

    if (node.type === 'source.context') {
      const contextKind = typeof node.data.contextKind === 'string' ? node.data.contextKind : 'page';
      return (
        <div
          class="nl-node-picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            class="nl-node-select"
            aria-label="Select context kind for App / Context node"
            value={contextKind}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { contextKind: event.currentTarget.value }),
                'Change App / Context source',
              );
            }}
          >
            <option value="page">Context: Page</option>
            <option value="theme">Context: Theme</option>
            <option value="url-params">Context: URL / Params</option>
            <option value="viewport">Context: Viewport</option>
            <option value="user-auth">Context: User / Auth</option>
          </select>
        </div>
      );
    }

    if (node.type === 'source.external') {
      const sourceKind = node.data.sourceKind === 'cms' ? 'cms' : 'api';
      return (
        <div
          class="nl-node-picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <select
            class="nl-node-select"
            aria-label="Select external provider for External Data node"
            value={sourceKind}
            onChange={(event) => {
              commitGraphUpdate(
                updateNodeDataInGraph(activeGraph, node.id, { sourceKind: event.currentTarget.value }),
                'Change External Data provider',
              );
            }}
          >
            <option value="api">API: {String(node.data.endpoint || '/items').slice(0, 18)}</option>
            <option value="cms">CMS: {String(node.data.collection || 'collection').slice(0, 18)}</option>
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
      <div ref={topbarRef} class="nl-topbar">
        <div class="nl-topbar-left">
          <button
            type="button"
            class={`nl-bar-btn ${browserOpen ? 'is-active' : ''}`}
            data-testid="nl-browser-toggle"
            aria-expanded={browserOpen}
            title="Browse all Project, Page, and Component logic graphs"
            onClick={() => setBrowserOpen((open) => !open)}
          >
            <StudioIcon name="layers" />
            <span>Graphs ({project.logicGraphs.length})</span>
          </button>

          <div
            class="nl-owner-breadcrumb"
            data-testid="nl-owner-breadcrumb"
            data-owner-scope={effectiveOwnerContext.scope}
            title={ownerBreadcrumb.fullLabel}
          >
            <span class="nl-owner-scope-tag">{ownerBreadcrumb.scopeLabel}</span>
            <span class="nl-owner-sep" aria-hidden="true">&gt;</span>
            <strong class="nl-owner-name">{ownerBreadcrumb.ownerName}</strong>
            <span class="nl-owner-sep" aria-hidden="true">&gt;</span>
            <span class="nl-owner-leaf">Node Logic</span>
          </div>

          {onOpenOwner && (
            <button
              type="button"
              class="nl-bar-btn"
              data-testid="nl-open-active-owner-btn"
              title={`Open ${ownerBreadcrumb.scopeLabel} “${ownerBreadcrumb.ownerName}” in Canvas`}
              onClick={() => onOpenOwner(effectiveOwnerContext)}
            >
              Open Owner
            </button>
          )}

          {effectiveOwnerContext.scope !== 'component' && (
            <select
              class="select-field nl-scope-select"
              aria-label="Node Logic owner scope"
              data-testid="nl-owner-scope-select"
              value={effectiveOwnerContext.scope}
              onChange={(event) => {
                const nextScope = event.currentTarget.value;
                fittedGraphIdRef.current = null;
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                if (nextScope === 'project') {
                  setOwnerContext({ scope: 'project' });
                } else {
                  setOwnerContext({ scope: 'page', pageId: activePage.id });
                }
              }}
            >
              <option value="page">Page: {activePage.name}</option>
              <option value="project">Project Scope</option>
            </select>
          )}

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
              disabled={scopedGraphs.length === 0}
              onChange={(event) => {
                fittedGraphIdRef.current = null;
                setActiveGraphId(event.currentTarget.value);
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                setWirePatch(null);
                setWireLiftCandidate(null);
              }}
            >
              {scopedGraphs.length === 0 ? (
                <option value="">No logic graphs for {ownerBreadcrumb.ownerName}</option>
              ) : (
                scopedGraphs.map((graph) => (
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

          {activeGraph && (
            <button
              type="button"
              class={`nl-bar-btn ${selectedNodeIds.length > 0 ? 'is-accent' : ''}`}
              data-testid="nl-create-frame-btn"
              title="Wrap selected nodes into a Smart Logic Frame, or create an empty Frame (Ctrl+G / Shift+G)"
              onClick={handleCreateOrWrapFrame}
            >
              {selectedNodeIds.length > 1
                ? `Wrap Frame (${selectedNodeIds.length})`
                : selectedNodeIds.length === 1 || selectedNodeId
                  ? 'Wrap Frame'
                  : '+ Frame'}
            </button>
          )}

          <div class="nl-presets-anchor">
            <button
              ref={presetsButtonRef}
              type="button"
              class={`nl-bar-btn ${presetsOpen ? 'is-active' : ''}`}
              data-testid="nl-presets-btn"
              aria-haspopup="menu"
              aria-expanded={presetsOpen}
              onClick={() => {
                if (!presetsOpen) {
                  const pos = computePresetsMenuPosition();
                  if (pos) setPresetsMenuPos(pos);
                }
                setPresetsOpen((open) => !open);
              }}
            >
              Presets{savedFramePresets.length > 0 ? ` (${savedFramePresets.length})` : ''}
            </button>
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

      {presetsOpen && presetsMenuPos && (
        <NodeLogicPresetsMenu
          menuRef={presetsMenuRef}
          layout={presetsMenuPos}
          savedFramePresets={savedFramePresets}
          onInsertPreset={handleInsertPreset}
          onInsertSavedFramePreset={handleInsertSavedFramePreset}
          onDeleteSavedFramePreset={handleDeleteSavedFramePreset}
        />
      )}

      {/* Main Node Logic Studio Body */}
      <div class="nl-body">
        {browserOpen && (
          <NodeLogicBrowser
            project={project}
            activePageId={activePageId}
            activeOwnerContext={effectiveOwnerContext}
            activeGraphId={activeGraph?.id ?? null}
            onOpenLogic={(nextOwner, graphId) => {
              fittedGraphIdRef.current = null;
              setOwnerContext(nextOwner);
              setActiveGraphId(graphId);
              setSelectedNodeId(null);
              setSelectedNodeIds([]);
              setSelectedFrameId(null);
              setSelectedConnectionId(null);
              setTransformPreviewNodeId(null);
            }}
            onOpenOwner={onOpenOwner}
            onClose={() => setBrowserOpen(false)}
          />
        )}

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
                    <span>{item.paletteSubtitle ?? marker.label}</span>
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
          class={`nl-canvas-stage ${panDrag ? 'is-panning' : ''} ${spacePanHeld && !panDrag ? 'is-space-pan' : ''} ${marqueeDrag?.hasDragged ? 'is-marquee-selecting' : ''} ${isWireActivelyShown ? 'is-connecting' : ''}`}
          data-testid="node-logic-canvas"
          onContextMenu={(event) => {
            event.preventDefault();
            if (suppressContextMenuRef.current) {
              suppressContextMenuRef.current = false;
              return;
            }
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select')) return;
            const nodeCard = target?.closest<HTMLElement>('[data-logic-node-id]');
            const hitNodeId = nodeCard?.getAttribute('data-logic-node-id') ?? null;
            if (hitNodeId) {
              setSelectedNodeId(hitNodeId);
              if (!selectedNodeIds.includes(hitNodeId)) {
                setSelectedNodeIds([hitNodeId]);
              }
              setSelectedFrameId(null);
              setSelectedConnectionId(null);
            }
            setStageContextMenu({ x: event.clientX, y: event.clientY, nodeId: hitNodeId });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
            setPresetsOpen(false);
            setOpenGuideNodeId(null);
            setStageContextMenu(null);
            if (wirePatch) {
              setWirePatch(null);
              return;
            }
            const wantsPan =
              event.button === 1
              || event.button === 2
              || (event.button === 0 && (spacePanHeld || event.altKey));
            if (wantsPan) {
              if (event.button === 1 || event.button === 2) {
                event.preventDefault();
              }
              if (event.button === 2) {
                suppressContextMenuRef.current = false;
              }
              setPanDrag({
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                originPanX: viewport.panX,
                originPanY: viewport.panY,
              });
              return;
            }
            const startWorld = screenToWorld(event.clientX, event.clientY);
            const baseSelection =
              selectedNodeIds.length > 0
                ? selectedNodeIds
                : selectedNodeId
                  ? [selectedNodeId]
                  : [];
            setSelectedFrameId(null);
            setSelectedConnectionId(null);
            if (!event.shiftKey) {
              setSelectedNodeId(null);
              setSelectedNodeIds([]);
            }
            setMarqueeDrag({
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startWorld,
              currentWorld: startWorld,
              hasDragged: false,
              additive: event.shiftKey,
              baseSelection,
            });
          }}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              stepZoom(event.deltaY < 0 ? 'in' : 'out');
              return;
            }
            event.preventDefault();
            setViewport((current) => ({
              ...current,
              panX: Math.round(current.panX - event.deltaX),
              panY: Math.round(current.panY - event.deltaY),
            }));
          }}
        >
          {!activeGraph ? (
            <div class="nl-empty-state" data-testid="nl-empty-state">
              <div class="nl-empty-icon"><StudioIcon name="logicNodes" /></div>
              <strong>
                {effectiveOwnerContext.scope === 'component'
                  ? `No Node Logic for Component “${ownerBreadcrumb.ownerName}”`
                  : effectiveOwnerContext.scope === 'project'
                    ? 'No Project Logic Graphs Yet'
                    : `No Logic Graphs on Page “${ownerBreadcrumb.ownerName}”`}
              </strong>
              <p>
                {effectiveOwnerContext.scope === 'component'
                  ? `Logic created here belongs exclusively to Component “${ownerBreadcrumb.ownerName}” and runs independently per instance.`
                  : 'Connect visual events, state variables, branches, and live actions over your .flop AST.'}
              </p>
              <div class="nl-empty-actions">
                <button type="button" class="nl-primary-btn" onClick={handleLoadStarterFlow}>
                  {effectiveOwnerContext.scope === 'component'
                    ? 'Create Component Starter Flow'
                    : 'Load Starter Interaction Flow'}
                </button>
                <button type="button" class="nl-secondary-btn" onClick={handleCreateEmptyGraph}>
                  {effectiveOwnerContext.scope === 'component'
                    ? 'Create Blank Component Graph'
                    : 'Create Blank Graph'}
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
              {/* Unbaked Smart Logic Frames (Background Containers) */}
              {displayFrames
                .filter((frame) => !frame.isBaked)
                .map((frame) => {
                  const colorPreset = getLogicFrameColorPreset(frame.color);
                  const isFrameSelected = selectedFrameId === frame.id;
                  return (
                    <section
                      key={frame.id}
                      data-logic-frame-id={frame.id}
                      data-testid={`nl-frame-${frame.id}`}
                      aria-label={`Smart Logic Frame ${frame.title}`}
                      class={`nl-frame-box ${isFrameSelected ? 'is-selected' : ''}`}
                      style={{
                        width: `${frame.bounds.width}px`,
                        height: `${frame.bounds.height}px`,
                        transform: `translate(${frame.bounds.x}px, ${frame.bounds.y}px)`,
                        backgroundColor: colorPreset.bg,
                        borderColor: isFrameSelected ? colorPreset.accent : colorPreset.border,
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setSelectedFrameId(frame.id);
                        setSelectedNodeId(null);
                        setSelectedNodeIds([]);
                        setSelectedConnectionId(null);
                        setInspectorTab('node');
                      }}
                    >
                      <header
                        class="nl-frame-header"
                        style={{ borderBottomColor: colorPreset.border }}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setSelectedFrameId(frame.id);
                          setSelectedNodeId(null);
                          setSelectedNodeIds([]);
                          setSelectedConnectionId(null);
                          setInspectorTab('node');
                          setFrameDrag({
                            frameId: frame.id,
                            pointerId: event.pointerId,
                            startClientX: event.clientX,
                            startClientY: event.clientY,
                            dx: 0,
                            dy: 0,
                          });
                        }}
                      >
                        <span
                          class="nl-frame-accent-dot"
                          style={{ backgroundColor: colorPreset.accent }}
                          aria-hidden="true"
                        />
                        <strong class="nl-frame-title">{frame.title}</strong>
                        <span class="nl-frame-count nl-tabular">
                          {frame.childNodeIds.length} node{frame.childNodeIds.length === 1 ? '' : 's'}
                        </span>
                        <button
                          type="button"
                          class="nl-frame-mini-btn is-bake"
                          data-testid={`nl-frame-bake-${frame.id}`}
                          aria-label={`Bake frame ${frame.title}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleBakeFrame(frame.id);
                          }}
                        >
                          Bake
                        </button>
                      </header>
                    </section>
                  );
                })}

              {/* SVG Wire Layer */}
              <svg class="nl-wires-svg" aria-label="Logic connections">
                {activeGraph.connections.map((conn) => {
                  const srcFrame = bakedFrameByChildId.get(conn.sourceNodeId);
                  const tgtFrame = bakedFrameByChildId.get(conn.targetNodeId);
                  // Hide frozen internal wires inside the same Baked Frame
                  if (srcFrame && tgtFrame && srcFrame.id === tgtFrame.id) {
                    return null;
                  }
                  const srcNode = displayNodesById.get(conn.sourceNodeId);
                  const tgtNode = displayNodesById.get(conn.targetNodeId);
                  if (!srcNode || !tgtNode) return null;
                  const start = resolveLogicPortWorldPosition(
                    displayNodesById,
                    displayFrames,
                    conn.sourceNodeId,
                    conn.sourcePortId,
                    'out',
                  );
                  const end = resolveLogicPortWorldPosition(
                    displayNodesById,
                    displayFrames,
                    conn.targetNodeId,
                    conn.targetPortId,
                    'in',
                  );
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

              {/* Baked Smart Logic Frame Nodes (Collapsed Function Blocks) */}
              {displayFrames
                .filter((frame) => frame.isBaked && frame.bakedData)
                .map((frame) => {
                  const baked = frame.bakedData!;
                  const colorPreset = getLogicFrameColorPreset(frame.color);
                  const isFrameSelected = selectedFrameId === frame.id;
                  const rowCount = Math.max(1, baked.exposedInputs.length, baked.exposedOutputs.length);
                  return (
                    <article
                      key={frame.id}
                      data-logic-frame-id={frame.id}
                      data-testid={`nl-baked-frame-${frame.id}`}
                      class={`nl-node-card nl-baked-frame-card ${isFrameSelected ? 'is-selected' : ''}`}
                      style={{
                        width: `${BAKED_FRAME_NODE_WIDTH}px`,
                        transform: `translate(${frame.bounds.x}px, ${frame.bounds.y}px)`,
                        borderColor: isFrameSelected ? colorPreset.accent : colorPreset.border,
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setSelectedFrameId(frame.id);
                        setSelectedNodeId(null);
                        setSelectedNodeIds([]);
                        setSelectedConnectionId(null);
                        setInspectorTab('node');
                      }}
                    >
                      <header
                        class="nl-node-header nl-baked-frame-header"
                        style={{ borderBottomColor: colorPreset.border }}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setSelectedFrameId(frame.id);
                          setSelectedNodeId(null);
                          setSelectedNodeIds([]);
                          setSelectedConnectionId(null);
                          setInspectorTab('node');
                          setFrameDrag({
                            frameId: frame.id,
                            pointerId: event.pointerId,
                            startClientX: event.clientX,
                            startClientY: event.clientY,
                            dx: 0,
                            dy: 0,
                          });
                        }}
                      >
                        <span
                          class="nl-baked-fn-glyph"
                          style={{ color: colorPreset.accent }}
                          aria-hidden="true"
                        >
                          ƒ
                        </span>
                        <strong class="nl-node-title">{frame.title}</strong>
                        <button
                          type="button"
                          class="nl-frame-mini-btn"
                          data-testid={`nl-frame-unbake-${frame.id}`}
                          aria-label={`Unbake frame ${frame.title}`}
                          title="Unbake to edit internal nodes"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleUnbakeFrame(frame.id);
                          }}
                        >
                          Unbake
                        </button>
                      </header>
                      <div class="nl-node-subtitle nl-tabular">
                        Baked · {frame.childNodeIds.length} node{frame.childNodeIds.length === 1 ? '' : 's'} · {baked.exposedParams.length} param{baked.exposedParams.length === 1 ? '' : 's'}
                      </div>
                      <div class="nl-node-ports">
                        {Array.from({ length: rowCount }).map((_, rowIdx) => {
                          const expIn = baked.exposedInputs[rowIdx];
                          const expOut = baked.exposedOutputs[rowIdx];
                          const inDataType = expIn?.dataType ?? (expIn?.kind === 'exec' ? 'exec' : 'any');
                          const outDataType = expOut?.dataType ?? (expOut?.kind === 'exec' ? 'exec' : 'any');

                          const inConnected = Boolean(
                            expIn && connectedPortKeys.has(`${expIn.targetNodeId}:${expIn.targetPort}`),
                          );
                          const outConnected = Boolean(
                            expOut && connectedPortKeys.has(`${expOut.sourceNodeId}:${expOut.sourcePort}`),
                          );
                          const inCompatible = Boolean(
                            isWireActivelyShown &&
                              wirePatch &&
                              expIn &&
                              canConnectLogicPorts(
                                activeGraph,
                                wirePatch.anchorNodeId,
                                wirePatch.anchorPortId,
                                expIn.targetNodeId,
                                expIn.targetPort,
                                wirePatch.detachedConnection?.id,
                              ).ok,
                          );
                          const outCompatible = Boolean(
                            isWireActivelyShown &&
                              wirePatch &&
                              expOut &&
                              canConnectLogicPorts(
                                activeGraph,
                                wirePatch.anchorNodeId,
                                wirePatch.anchorPortId,
                                expOut.sourceNodeId,
                                expOut.sourcePort,
                                wirePatch.detachedConnection?.id,
                              ).ok,
                          );
                          const inSnapped = Boolean(
                            isWireActivelyShown &&
                              wirePatch?.snapTarget &&
                              expIn &&
                              wirePatch.snapTarget.nodeId === expIn.targetNodeId &&
                              wirePatch.snapTarget.portId === expIn.targetPort,
                          );
                          const outSnapped = Boolean(
                            isWireActivelyShown &&
                              wirePatch?.snapTarget &&
                              expOut &&
                              wirePatch.snapTarget.nodeId === expOut.sourceNodeId &&
                              wirePatch.snapTarget.portId === expOut.sourcePort,
                          );

                          return (
                            <div key={rowIdx} class="nl-port-row">
                              <div class="nl-port-slot nl-port-slot-in">
                                {expIn && (
                                  <button
                                    type="button"
                                    data-port-dir="in"
                                    data-port-id={expIn.portId}
                                    class={`nl-port-btn nl-port-${inDataType} ${inConnected ? 'is-connected' : ''} ${inCompatible ? 'is-compatible' : ''} ${inSnapped ? 'is-snap-target' : ''}`}
                                    aria-label={`Baked input ${expIn.label} on ${frame.title}`}
                                    title={expIn.label}
                                    onPointerDown={(event) =>
                                      handlePortPointerDown(event, expIn.targetNodeId, expIn.targetPort, 'in')
                                    }
                                    onClick={(event) =>
                                      handlePortClick(event, expIn.targetNodeId, expIn.targetPort, 'in')
                                    }
                                  >
                                    <span class={`nl-port-socket ${expIn.kind === 'exec' ? 'is-exec' : ''}`} />
                                    <span class="nl-port-label">{expIn.label}</span>
                                  </button>
                                )}
                              </div>
                              <div class="nl-port-slot nl-port-slot-out">
                                {expOut && (
                                  <button
                                    type="button"
                                    data-port-dir="out"
                                    data-port-id={expOut.portId}
                                    class={`nl-port-btn nl-port-${outDataType} ${outConnected ? 'is-connected' : ''} ${outCompatible ? 'is-compatible' : ''} ${outSnapped ? 'is-snap-target' : ''}`}
                                    aria-label={`Baked output ${expOut.label} on ${frame.title}`}
                                    title={expOut.label}
                                    onPointerDown={(event) =>
                                      handlePortPointerDown(event, expOut.sourceNodeId, expOut.sourcePort, 'out')
                                    }
                                    onClick={(event) =>
                                      handlePortClick(event, expOut.sourceNodeId, expOut.sourcePort, 'out')
                                    }
                                  >
                                    <span class="nl-port-label">{expOut.label}</span>
                                    <span class={`nl-port-socket ${expOut.kind === 'exec' ? 'is-exec' : ''}`} />
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

              {/* HTML Node Cards Layer (Hide nodes collapsed inside Baked Frames) */}
              {displayNodes
                .filter((node) => !bakedFrameByChildId.has(node.id))
                .map((node) => {
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
                  activeGraph,
                );
                const isSourceNode = isSourceLogicNodeType(node.type);
                const diagCounts = diagnosticsByNodeId.get(node.id);
                const isSelected = selectedNodeId === node.id || selectedNodeIds.includes(node.id);
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
                      setSelectedFrameId(null);
                      setSelectedConnectionId(null);
                      if (event.shiftKey) {
                        setSelectedNodeIds((prev) => {
                          const base = prev.length > 0 ? prev : selectedNodeId ? [selectedNodeId] : [];
                          return base.includes(node.id)
                            ? base.filter((id) => id !== node.id)
                            : [...base, node.id];
                        });
                        setSelectedNodeId(node.id);
                      } else if (selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id)) {
                        setSelectedNodeId(node.id);
                      } else {
                        setSelectedNodeId(node.id);
                        setSelectedNodeIds([node.id]);
                      }
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
                        setSelectedFrameId(null);
                        setSelectedConnectionId(null);
                        setInspectorTab('node');
                        if (event.shiftKey) {
                          setSelectedNodeIds((prev) => {
                            const base = prev.length > 0 ? prev : selectedNodeId ? [selectedNodeId] : [];
                            return base.includes(node.id)
                              ? base.filter((id) => id !== node.id)
                              : [...base, node.id];
                          });
                          setSelectedNodeId(node.id);
                          return;
                        }
                        const alreadyMultiSelected =
                          selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id);
                        const dragIds = alreadyMultiSelected ? selectedNodeIds : [node.id];
                        setSelectedNodeId(node.id);
                        if (!alreadyMultiSelected) {
                          setSelectedNodeIds([node.id]);
                        }
                        setNodeDrag({
                          nodeIds: dragIds,
                          pointerId: event.pointerId,
                          startClientX: event.clientX,
                          startClientY: event.clientY,
                          dx: 0,
                          dy: 0,
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

              {marqueeRect && (
                <div
                  class="nl-marquee-box"
                  data-testid="nl-marquee-box"
                  aria-hidden="true"
                  style={{
                    transform: `translate(${marqueeRect.x}px, ${marqueeRect.y}px)`,
                    width: `${marqueeRect.width}px`,
                    height: `${marqueeRect.height}px`,
                  }}
                />
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

        {activeTransformPreviewNode && activeGraph && (
          <NodeLogicTransformPreview
            document={scopedPreviewDocument}
            components={project.components}
            assets={project.assets}
            tokens={designTokens}
            logicNode={activeTransformPreviewNode}
            ownerLabel={ownerBreadcrumb.ownerName}
            onUpdateNodeData={(nodeId, patch) => {
              commitGraphUpdate(updateNodeDataInGraph(activeGraph, nodeId, patch), 'Update transform visually in canvas preview');
            }}
            onClose={() => setTransformPreviewNodeId(null)}
          />
        )}

        {/* Right Node, Variables & Simulation Inspector */}
        <NodeLogicInspector
          activeTab={inspectorTab}
          graph={activeGraph}
          selectedNode={selectedNode}
          selectedFrame={selectedFrame}
          selectedConnection={selectedConnection}
          frameBakeErrors={frameBakeErrors}
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
          onUpdateFrame={handleUpdateFrame}
          onBakeFrame={handleBakeFrame}
          onUnbakeFrame={handleUnbakeFrame}
          onSaveFramePreset={handleSaveFramePreset}
          onDeleteFrame={handleDeleteFrame}
          onDeleteNode={(nodeId) => {
            if (!activeGraph) return;
            commitGraphUpdate(removeNodeFromGraph(activeGraph, nodeId), 'Delete logic node');
            setSelectedNodeId(null);
            setSelectedNodeIds((prev) => prev.filter((id) => id !== nodeId));
          }}
          onDeleteConnection={(connectionId) => {
            if (!activeGraph) return;
            commitGraphUpdate(removeConnectionFromGraph(activeGraph, connectionId), 'Disconnect logic wire');
            setSelectedConnectionId(null);
          }}
          onFocusNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedNodeIds([nodeId]);
            setSelectedFrameId(null);
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
          onAddVariable={(args: {
            name: string;
            valueType: LogicValueType;
            initialValue: LogicVariableValue;
            scope?: LogicVariableScope;
            persist?: LogicVariablePersist;
            computed?: boolean;
            computedExpression?: string;
          }) => {
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
          onUpdateNetworkSettings={(patch: Partial<LogicNetworkSettings>) => {
            if (!activeGraph) return;
            commitGraphUpdate(updateNetworkSettingsInGraph(activeGraph, patch), 'Update project network settings');
          }}
          onRunMount={() => {
            if (!runtimeRef.current) return;
            const hasLiveNodes = project.logicGraphs.some((g) =>
              g.nodes.some(
                (n) => (n.type === 'network.http' || n.type === 'source.external') && n.data.executionMode === 'live',
              ),
            );
            if (hasLiveNodes) {
              const activeRuntime = runtimeRef.current;
              void activeRuntime.mountAsync().then((snap) => {
                if (runtimeRef.current === activeRuntime) setRuntimeSnapshot(snap);
              });
              return;
            }
            setRuntimeSnapshot(runtimeRef.current.mount());
          }}
          onTriggerNodeEvent={(targetAstNodeId: string, eventKind: LogicNodeEventKind) => {
            if (!runtimeRef.current) return;
            const hasLiveNodes = project.logicGraphs.some((g) =>
              g.nodes.some(
                (n) => (n.type === 'network.http' || n.type === 'source.external') && n.data.executionMode === 'live',
              ),
            );
            if (hasLiveNodes) {
              const activeRuntime = runtimeRef.current;
              void activeRuntime.dispatchNodeEventAsync(targetAstNodeId, eventKind).then((snap) => {
                if (runtimeRef.current === activeRuntime) setRuntimeSnapshot(snap);
              });
              return;
            }
            setRuntimeSnapshot(runtimeRef.current.dispatchNodeEvent(targetAstNodeId, eventKind));
          }}
          onResetRuntime={() => {
            if (!runtimeRef.current) return;
            setRuntimeSnapshot(runtimeRef.current.reset());
          }}
          onUpgradeLegacyNode={(nodeId) => {
            if (!activeGraph) return;
            const nextGraph = migrateLegacyNodeInGraph(activeGraph, nodeId);
            if (nextGraph === activeGraph) return;
            const upgradedNode = nextGraph.nodes.find((n) => n.id === nodeId);
            const upgradedDef = upgradedNode ? getLogicNodeDefinition(upgradedNode.type) : undefined;
            commitGraphUpdate(nextGraph, `Upgrade legacy node to ${upgradedDef?.label ?? 'modern node'}`);
            onNotice(`Upgraded legacy node to “${upgradedDef?.label ?? 'modern node'}”.`);
          }}
          onToggleComponentNodeLogic={onToggleComponentNodeLogic}
          activeTransformPreviewNodeId={activeTransformPreviewNode?.id ?? null}
          onToggleTransformPreview={(logicNodeId) => setTransformPreviewNodeId(logicNodeId)}
        />
      </div>
      {stageContextMenu && (
        <StudioContextMenu
          open={true}
          x={stageContextMenu.x}
          y={stageContextMenu.y}
          ariaLabel="Node Logic actions"
          testId="node-logic-context-menu"
          onClose={() => setStageContextMenu(null)}
          items={(() => {
            const items: StudioContextMenuItem[] = [];
            const hitNode = stageContextMenu.nodeId && activeGraph
              ? activeGraph.nodes.find((n) => n.id === stageContextMenu.nodeId) ?? null
              : null;
            if (hitNode && activeGraph) {
              const def = getLogicNodeDefinition(hitNode.type);
              items.push({ kind: 'header', id: 'hdr-node', label: def?.label ?? hitNode.type });
              items.push({
                kind: 'item',
                id: 'wrap-frame',
                label: 'Wrap in Logic Frame',
                shortcut: ['Mod', 'G'],
                onSelect: handleCreateOrWrapFrame,
              });
              items.push({
                kind: 'item',
                id: 'dup-node',
                label: 'Duplicate Logic Node',
                onSelect: () => {
                  const { graph: nextGraph, node: cloned } = addNodeToGraph(
                    activeGraph,
                    hitNode.type as BuiltInLogicNodeType,
                    { x: Math.round(hitNode.x + 40), y: Math.round(hitNode.y + 40) },
                    { ...hitNode.data },
                  );
                  commitGraphUpdate(nextGraph, `Duplicate ${def?.label ?? hitNode.type}`);
                  setSelectedNodeId(cloned.id);
                  setSelectedNodeIds([cloned.id]);
                },
              });
              items.push({ kind: 'divider', id: 'div-del' });
              items.push({
                kind: 'item',
                id: 'del-node',
                label: 'Delete Logic Node',
                shortcut: ['Delete'],
                danger: true,
                onSelect: () => {
                  commitGraphUpdate(removeNodeFromGraph(activeGraph, hitNode.id), 'Delete logic node');
                  setSelectedNodeId(null);
                  setSelectedNodeIds((prev) => prev.filter((id) => id !== hitNode.id));
                },
              });
              return items;
            }

            items.push({ kind: 'header', id: 'hdr-stage', label: activeGraph?.name ?? 'Node Logic Stage' });
            items.push({
              kind: 'item',
              id: 'add-trigger',
              label: 'Add Event Trigger (On Click)',
              onSelect: () => handleAddNodeFromPalette('event.on-click'),
            });
            items.push({
              kind: 'item',
              id: 'add-action',
              label: 'Add Action (Modify Layer)',
              onSelect: () => handleAddNodeFromPalette('action.set-layer'),
            });
            items.push({
              kind: 'item',
              id: 'add-branch',
              label: 'Add Condition (If / Else)',
              onSelect: () => handleAddNodeFromPalette('logic.branch'),
            });
            if (activeGraph) {
              items.push({ kind: 'divider', id: 'div-org' });
              items.push({
                kind: 'item',
                id: 'create-frame',
                label: 'Create Logic Frame',
                shortcut: ['Mod', 'G'],
                onSelect: handleCreateOrWrapFrame,
              });
              items.push({
                kind: 'item',
                id: 'auto-arrange',
                label: 'Auto-Arrange Graph',
                onSelect: handleAutoArrange,
              });
              items.push({ kind: 'divider', id: 'div-view' });
              items.push({ kind: 'item', id: 'fit-view', label: 'Fit Graph to View', onSelect: handleFitView });
              items.push({
                kind: 'item',
                id: 'reset-zoom',
                label: 'Reset Zoom (100%)',
                onSelect: () => setViewport((current) => ({ ...current, zoom: 1 })),
              });
            }
            return items;
          })()}
        />
      )}
    </div>
  );
}

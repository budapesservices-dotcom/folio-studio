import { useCallback, useState } from 'preact/hooks';
import type { FolioProject } from '../../core/document/types';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import {
  createQuickInteractionInProject,
  deleteQuickInteractionFromGraph,
  updateQuickInteractionInGraph,
  type QuickInteractionConfig,
  type QuickInteractionEntry,
  type QuickInteractionScopeContext,
} from './quickInteractions';
import {
  deriveOwnerContextFromLogicGraph,
  type NodeLogicOwnerContext,
} from './nodeLogicGraphHelpers';

export interface NodeLogicFocusRequest {
  readonly graphId: string;
  readonly nodeIds: readonly string[];
  readonly nonce: number;
}

export interface UseQuickInteractionActionsArgs {
  project: FolioProject;
  mainCommandClient: MainCanvasCommandClient;
  openNodeLogic: (ownerContext?: NodeLogicOwnerContext) => void;
  setNotice: (message: string) => void;
}

export function useQuickInteractionActions({
  project,
  mainCommandClient,
  openNodeLogic,
  setNotice,
}: UseQuickInteractionActionsArgs) {
  const [nodeLogicFocusRequest, setNodeLogicFocusRequest] = useState<NodeLogicFocusRequest | null>(null);

  const createQuickInteraction = useCallback(
    (scopeContext: QuickInteractionScopeContext, config: QuickInteractionConfig) => {
      const result = createQuickInteractionInProject(project, scopeContext, config);
      const commandResult =
        result.mode === 'create'
          ? mainCommandClient.createLogicGraph(
              result.graph,
              `Add quick interaction on "${scopeContext.scopeName}"`,
            )
          : mainCommandClient.updateLogicGraph(
              result.graph,
              `Add quick interaction to "${result.graph.name}"`,
            );
      if (commandResult.status !== 'applied') return null;
      setNotice(`Added quick interaction (2 nodes · 1 wire) in “${result.graph.name}”.`);
      return {
        entryId: `${result.graph.id}:${result.triggerNodeId}:${result.actionNodeId}`,
      };
    },
    [project, mainCommandClient, setNotice],
  );

  const updateQuickInteraction = useCallback(
    (entry: QuickInteractionEntry, layerId: string, nextConfig: QuickInteractionConfig) => {
      const targetGraph = project.logicGraphs.find((g) => g.id === entry.graphId);
      if (!targetGraph) return;
      const nextGraph = updateQuickInteractionInGraph(targetGraph, entry, layerId, nextConfig);
      mainCommandClient.updateLogicGraph(nextGraph, `Update quick interaction in "${targetGraph.name}"`);
    },
    [project.logicGraphs, mainCommandClient],
  );

  const deleteQuickInteraction = useCallback(
    (entry: QuickInteractionEntry) => {
      const targetGraph = project.logicGraphs.find((g) => g.id === entry.graphId);
      if (!targetGraph) return;
      const nextGraph = deleteQuickInteractionFromGraph(targetGraph, entry);
      const res = mainCommandClient.updateLogicGraph(
        nextGraph,
        `Remove quick interaction from "${targetGraph.name}"`,
      );
      if (res.status === 'applied') {
        setNotice(`Removed interaction from “${targetGraph.name}”. Press Ctrl+Z to undo.`);
      }
    },
    [project.logicGraphs, mainCommandClient, setNotice],
  );

  const openInteractionInNodeGraph = useCallback(
    (graphId: string, nodeIds: readonly string[]) => {
      const targetGraph = project.logicGraphs.find((g) => g.id === graphId);
      const ownerContext = targetGraph
        ? deriveOwnerContextFromLogicGraph(targetGraph, project.activePageId)
        : undefined;
      openNodeLogic(ownerContext);
      setNodeLogicFocusRequest((prev) => ({
        graphId,
        nodeIds: [...nodeIds],
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      setNotice('Opened interaction in Node Graph.');
    },
    [project.logicGraphs, project.activePageId, openNodeLogic, setNotice],
  );

  return {
    nodeLogicFocusRequest,
    createQuickInteraction,
    updateQuickInteraction,
    deleteQuickInteraction,
    openInteractionInNodeGraph,
  };
}

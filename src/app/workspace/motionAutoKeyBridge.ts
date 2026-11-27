import type { DesignNode, PathNode } from '../../core/document/types';
import { hasActiveMotionPathForNode } from '../../engines/animation';
import type { ValidatedToolOperation } from '../../engines/canvas/geometryEngine';
import type { ToolOperationExecutor } from '../toolOperationExecutor';
import type { MotionPlaybackController } from './useMotionPlayback';

function havePathGeometryChanged(nextNode: PathNode, canonical: PathNode): boolean {
  if (nextNode.closed !== canonical.closed) return true;
  if (nextNode.points.length !== canonical.points.length) return true;
  for (let i = 0; i < nextNode.points.length; i += 1) {
    const a = nextNode.points[i];
    const b = canonical.points[i];
    if (
      Math.abs(a.x - b.x) > 0.01 ||
      Math.abs(a.y - b.y) > 0.01 ||
      a.pointType !== b.pointType ||
      Boolean(a.handleIn) !== Boolean(b.handleIn) ||
      Boolean(a.handleOut) !== Boolean(b.handleOut) ||
      (a.handleIn && b.handleIn && (Math.abs(a.handleIn.x - b.handleIn.x) > 0.01 || Math.abs(a.handleIn.y - b.handleIn.y) > 0.01)) ||
      (a.handleOut && b.handleOut && (Math.abs(a.handleOut.x - b.handleOut.x) > 0.01 || Math.abs(a.handleOut.y - b.handleOut.y) > 0.01))
    ) {
      return true;
    }
  }
  const nextSubs = nextNode.subpaths ?? [];
  const canonSubs = canonical.subpaths ?? [];
  if (nextSubs.length !== canonSubs.length) return true;
  for (let s = 0; s < nextSubs.length; s += 1) {
    if (nextSubs[s].closed !== canonSubs[s].closed || nextSubs[s].points.length !== canonSubs[s].points.length) {
      return true;
    }
  }
  return false;
}

export interface MotionAutoKeyBridgeOptions {
  activeEditorId: 'main' | 'component';
  motion: MotionPlaybackController;
  inspectorSelectedNode: DesignNode | null;
  inspectorSelectedNodes?: readonly DesignNode[];
  mainToolOperationExecutor: ToolOperationExecutor;
  componentToolOperationExecutor: ToolOperationExecutor;
  onUpdateSelectedFallback: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyleFallback: (patch: Record<string, string | number>) => void;
  onSampledColorOption: (color: string, target: 'fill' | 'stroke') => void;
  onCanvasInteraction: () => void;
  onNotice?: (message: string) => void;
  getCanonicalNodeById?: (nodeId: string) => DesignNode | undefined;
}

export function createMotionAutoKeyBridge(options: MotionAutoKeyBridgeOptions) {
  const {
    activeEditorId,
    motion,
    inspectorSelectedNode,
    inspectorSelectedNodes = [],
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    onUpdateSelectedFallback,
    onUpdateSelectedStyleFallback,
    onSampledColorOption,
    onCanvasInteraction,
    onNotice,
    getCanonicalNodeById,
  } = options;

  const isNodePositionLockedByMotionPath = (nodeId: string): boolean =>
    Boolean(motion.motionOpen && hasActiveMotionPathForNode(motion.activeClip, nodeId));

  const notifyMotionPathPositionLock = () => {
    onNotice?.(
      'Position (X/Y) is controlled by Motion Path. Edit path anchors on Canvas, or keyframe rotation, size, color, and effects.',
    );
  };

  const isDocumentMutatingOperation = (op: ValidatedToolOperation): boolean =>
    op.category === 'document-mutation';

  const sanitizeMotionPathTransformOperations = (
    operations: readonly ValidatedToolOperation[],
  ): { sanitized: ValidatedToolOperation[]; blockedPositionOnly: boolean; blockedAnyPosition: boolean } => {
    const sanitized: ValidatedToolOperation[] = [];
    let blockedPositionOnly = false;
    let blockedAnyPosition = false;

    for (const op of operations) {
      if (op.payload.kind !== 'transform-nodes' || op.payload.nodes.length === 0) {
        sanitized.push(op);
        continue;
      }

      const hasLockedNode = op.payload.nodes.some((n) => isNodePositionLockedByMotionPath(n.id));
      if (!hasLockedNode) {
        sanitized.push(op);
        continue;
      }

      const nextNodes: DesignNode[] = [];
      let blockedInOp = 0;

      for (const n of op.payload.nodes) {
        if (!isNodePositionLockedByMotionPath(n.id)) {
          nextNodes.push(n);
          continue;
        }
        const canonical =
          getCanonicalNodeById?.(n.id) ??
          (inspectorSelectedNode?.id === n.id
            ? inspectorSelectedNode
            : inspectorSelectedNodes.find((item) => item.id === n.id));

        if (!canonical) {
          // Cannot verify non-position deltas safely without baseline; treat pure transform as blocked
          blockedInOp += 1;
          blockedAnyPosition = true;
          continue;
        }

        const pathPointsChanged =
          n.type === 'path' && canonical.type === 'path' && havePathGeometryChanged(n, canonical);

        const nonPositionChanged =
          Math.abs(n.width - canonical.width) > 0.01 ||
          Math.abs(n.height - canonical.height) > 0.01 ||
          Math.abs((n.rotation ?? 0) - (canonical.rotation ?? 0)) > 0.01 ||
          Math.abs((n.opacity ?? 1) - (canonical.opacity ?? 1)) > 0.001 ||
          pathPointsChanged;

        if (!nonPositionChanged) {
          // Pure X/Y drag on a Motion Path layer (single or multi-selection) -> block to preserve canonical origin
          blockedInOp += 1;
          blockedAnyPosition = true;
          continue;
        }

        // Non-position transform (resize / rotate / path point edit) on a Motion Path layer:
        // keep canonical x/y fixed so multi-select scaling/rotating never drifts canonical position.
        nextNodes.push({ ...n, x: canonical.x, y: canonical.y } as DesignNode);
      }

      if (nextNodes.length === 0 && blockedInOp > 0) {
        blockedPositionOnly = true;
        continue;
      }

      if (nextNodes.length !== op.payload.nodes.length || blockedInOp > 0 || hasLockedNode) {
        sanitized.push({
          ...op,
          payload: {
            ...op.payload,
            nodes: nextNodes,
          },
        } as ValidatedToolOperation);
      } else {
        sanitized.push(op);
      }
    }

    return { sanitized, blockedPositionOnly, blockedAnyPosition };
  };

  const createWorkspaceExecutor = (
    targetScope: 'main' | 'component',
    executor: ToolOperationExecutor,
  ) => (operations: readonly ValidatedToolOperation[]) => {
    const autoKeyActiveHere = activeEditorId === targetScope && motion.motionOpen && motion.autoKeyEnabled;
    if (!autoKeyActiveHere) {
      if (activeEditorId === targetScope && motion.motionOpen) {
        const { sanitized, blockedPositionOnly, blockedAnyPosition } = sanitizeMotionPathTransformOperations(operations);
        if (blockedPositionOnly || blockedAnyPosition) {
          notifyMotionPathPositionLock();
          onCanvasInteraction();
        }
        if (sanitized.length === 0) {
          return [];
        }
        const mutatesDocument = sanitized.some(isDocumentMutatingOperation);
        if (mutatesDocument && (motion.previewActive || motion.isPlaying)) {
          motion.exitPreview?.();
        } else if (motion.isPlaying) {
          motion.pause();
        }
        return executor.executeBatch(sanitized);
      }
      return executor.executeBatch(operations);
    }

    if (motion.isPlaying) {
      motion.pause();
    }

    if (motion.playheadMs > 0) {
      const remaining: ValidatedToolOperation[] = [];
      let notifiedPositionLock = false;
      for (const operation of operations) {
        const payload = operation.payload;
        if (payload.kind === 'transform-nodes' && payload.nodes.length > 0) {
          const captured = motion.recordAutoKeyNodes(
            payload.nodes,
            operation.metadata.description ?? 'Auto-keyframe canvas transform',
          );
          const { sanitized, blockedAnyPosition } = sanitizeMotionPathTransformOperations([operation]);
          if (blockedAnyPosition && !notifiedPositionLock) {
            notifyMotionPathPositionLock();
            notifiedPositionLock = true;
          }
          if (captured.captured && captured.keepCanonicalUnchanged) {
            onCanvasInteraction();
            continue;
          }
          // Never allow locked Motion Path X/Y mutations (even in mixed multi-selection)
          // to leak through to canonical document execution.
          if (sanitized.length === 0) {
            onCanvasInteraction();
            continue;
          }
          remaining.push(...sanitized);
          continue;
        } else if (payload.kind === 'sample-color' && payload.resolvedNodesToUpdate.length > 0) {
          const captured = motion.recordAutoKeyNodes(
            payload.resolvedNodesToUpdate,
            operation.metadata.description ?? `Auto-keyframe sampled ${payload.target}`,
          );
          if (captured.captured && captured.keepCanonicalUnchanged) {
            onSampledColorOption(payload.color, payload.target);
            onCanvasInteraction();
            continue;
          }
        }
        remaining.push(operation);
      }
      return remaining.length > 0 ? executor.executeBatch(remaining) : [];
    }

    // Playhead is at 0ms with Auto-Key ON: still enforce Motion Path X/Y lock so canonical position
    // cannot be dragged off the trajectory before syncing 0.00s keyframes.
    const { sanitized, blockedPositionOnly, blockedAnyPosition } = sanitizeMotionPathTransformOperations(operations);
    if (blockedPositionOnly || blockedAnyPosition) {
      notifyMotionPathPositionLock();
      onCanvasInteraction();
    }
    if (sanitized.length === 0) {
      return [];
    }

    const reports = executor.executeBatch(sanitized);
    for (let i = 0; i < sanitized.length; i += 1) {
      const status = reports[i]?.status;
      if (status === 'rejected') continue;
      const payload = sanitized[i].payload;
      if (payload.kind === 'transform-nodes' && payload.nodes.length > 0) {
        motion.recordAutoKeyNodes(payload.nodes, 'Sync 0.00s keyframe');
      } else if (payload.kind === 'sample-color' && payload.resolvedNodesToUpdate.length > 0) {
        motion.recordAutoKeyNodes(payload.resolvedNodesToUpdate, 'Sync 0.00s color keyframe');
      }
    }
    return reports;
  };

  const executeMainToolOperations = createWorkspaceExecutor('main', mainToolOperationExecutor);
  const executeComponentToolOperations = createWorkspaceExecutor('component', componentToolOperationExecutor);

  const handleInspectorUpdateSelected = (patch: Partial<DesignNode>, coalesceKey?: string) => {
    let effectivePatch = patch;
    const anySelectedLockedByMotionPath = inspectorSelectedNode
      ? isNodePositionLockedByMotionPath(inspectorSelectedNode.id)
      : inspectorSelectedNodes.some((node) => isNodePositionLockedByMotionPath(node.id));
    if (anySelectedLockedByMotionPath && ('x' in patch || 'y' in patch)) {
      const rest = { ...patch };
      delete rest.x;
      delete rest.y;
      if (Object.keys(rest).length === 0) {
        notifyMotionPathPositionLock();
        return;
      }
      effectivePatch = rest;
    }
    if (
      motion.motionOpen
      && !motion.autoKeyEnabled
      && (motion.previewActive || motion.isPlaying)
    ) {
      motion.exitPreview?.();
    }
    if (
      motion.motionOpen
      && motion.autoKeyEnabled
      && inspectorSelectedNode
    ) {
      if (motion.isPlaying) {
        motion.pause();
      }
      const safePatch = { ...effectivePatch };
      if ('width' in patch) {
        const nextW = Number(patch.width);
        safePatch.width = Number.isFinite(nextW) && nextW > 0 ? nextW : inspectorSelectedNode.width;
      }
      if ('height' in patch) {
        const nextH = Number(patch.height);
        safePatch.height = Number.isFinite(nextH) && nextH > 0 ? nextH : inspectorSelectedNode.height;
      }
      if ('opacity' in patch) {
        const rawOpacity = Number(patch.opacity);
        safePatch.opacity = Number.isFinite(rawOpacity)
          ? Math.round(Math.min(1, Math.max(0, rawOpacity)) * 1000) / 1000
          : inspectorSelectedNode.opacity;
      }
      const candidate = { ...inspectorSelectedNode, ...safePatch } as DesignNode;
      const autoCoalesceKey = coalesceKey
        ? `autokey:${inspectorSelectedNode.id}:${coalesceKey}`
        : `autokey:${inspectorSelectedNode.id}:inspector`;
      if (motion.playheadMs > 0) {
        const res = motion.recordAutoKeyNodes([candidate], 'Auto-keyframe inspector edit', autoCoalesceKey);
        if (res.captured && res.keepCanonicalUnchanged) return;
      } else {
        onUpdateSelectedFallback(effectivePatch);
        motion.recordAutoKeyNodes([candidate], 'Sync 0.00s inspector keyframe', autoCoalesceKey);
        return;
      }
    }
    onUpdateSelectedFallback(effectivePatch);
  };

  const handleInspectorUpdateSelectedStyle = (
    patch: Record<string, string | number>,
    coalesceKey?: string,
  ) => {
    if (
      motion.motionOpen
      && !motion.autoKeyEnabled
      && (motion.previewActive || motion.isPlaying)
    ) {
      motion.exitPreview?.();
    }
    if (
      motion.motionOpen
      && motion.autoKeyEnabled
      && inspectorSelectedNode
      && inspectorSelectedNode.type !== 'component-instance'
      && inspectorSelectedNode.type !== 'group'
    ) {
      if (motion.isPlaying) {
        motion.pause();
      }
      const candidate = {
        ...inspectorSelectedNode,
        style: { ...inspectorSelectedNode.style, ...patch },
      } as DesignNode;
      const autoCoalesceKey = coalesceKey
        ? `autokey:${inspectorSelectedNode.id}:${coalesceKey}`
        : `autokey:${inspectorSelectedNode.id}:style`;
      if (motion.playheadMs > 0) {
        const res = motion.recordAutoKeyNodes([candidate], 'Auto-keyframe style edit', autoCoalesceKey);
        if (res.captured && res.keepCanonicalUnchanged) return;
      } else {
        onUpdateSelectedStyleFallback(patch);
        motion.recordAutoKeyNodes([candidate], 'Sync 0.00s style keyframe', autoCoalesceKey);
        return;
      }
    }
    onUpdateSelectedStyleFallback(patch);
  };

  return {
    executeMainToolOperations,
    executeComponentToolOperations,
    handleInspectorUpdateSelected,
    handleInspectorUpdateSelectedStyle,
  };
}

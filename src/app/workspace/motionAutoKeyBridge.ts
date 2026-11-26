import type { DesignNode } from '../../core/document/types';
import type { ValidatedToolOperation } from '../../engines/canvas/geometryEngine';
import type { ToolOperationExecutor } from '../toolOperationExecutor';
import type { MotionPlaybackController } from './useMotionPlayback';

export interface MotionAutoKeyBridgeOptions {
  activeEditorId: 'main' | 'component';
  motion: MotionPlaybackController;
  inspectorSelectedNode: DesignNode | null;
  mainToolOperationExecutor: ToolOperationExecutor;
  componentToolOperationExecutor: ToolOperationExecutor;
  onUpdateSelectedFallback: (patch: Partial<DesignNode>) => void;
  onUpdateSelectedStyleFallback: (patch: Record<string, string | number>) => void;
  onSampledColorOption: (color: string, target: 'fill' | 'stroke') => void;
  onCanvasInteraction: () => void;
}

export function createMotionAutoKeyBridge(options: MotionAutoKeyBridgeOptions) {
  const {
    activeEditorId,
    motion,
    inspectorSelectedNode,
    mainToolOperationExecutor,
    componentToolOperationExecutor,
    onUpdateSelectedFallback,
    onUpdateSelectedStyleFallback,
    onSampledColorOption,
    onCanvasInteraction,
  } = options;

  const isDocumentMutatingOperation = (op: ValidatedToolOperation): boolean =>
    op.category === 'document-mutation';

  const createWorkspaceExecutor = (
    targetScope: 'main' | 'component',
    executor: ToolOperationExecutor,
  ) => (operations: readonly ValidatedToolOperation[]) => {
    const autoKeyActiveHere = activeEditorId === targetScope && motion.motionOpen && motion.autoKeyEnabled;
    if (!autoKeyActiveHere) {
      if (activeEditorId === targetScope && motion.motionOpen) {
        const mutatesDocument = operations.some(isDocumentMutatingOperation);
        if (mutatesDocument && (motion.previewActive || motion.isPlaying)) {
          motion.exitPreview?.();
        } else if (motion.isPlaying) {
          motion.pause();
        }
      }
      return executor.executeBatch(operations);
    }

    if (motion.isPlaying) {
      motion.pause();
    }

    if (motion.playheadMs > 0) {
      const remaining: ValidatedToolOperation[] = [];
      for (const operation of operations) {
        const payload = operation.payload;
        if (payload.kind === 'transform-nodes' && payload.nodes.length > 0) {
          const captured = motion.recordAutoKeyNodes(
            payload.nodes,
            operation.metadata.description ?? 'Auto-keyframe canvas transform',
          );
          if (captured.captured && captured.keepCanonicalUnchanged) {
            onCanvasInteraction();
            continue;
          }
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

    const reports = executor.executeBatch(operations);
    for (let i = 0; i < operations.length; i += 1) {
      const status = reports[i]?.status;
      if (status === 'rejected') continue;
      const payload = operations[i].payload;
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
      const safePatch = { ...patch };
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
        onUpdateSelectedFallback(patch);
        motion.recordAutoKeyNodes([candidate], 'Sync 0.00s inspector keyframe', autoCoalesceKey);
        return;
      }
    }
    onUpdateSelectedFallback(patch);
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

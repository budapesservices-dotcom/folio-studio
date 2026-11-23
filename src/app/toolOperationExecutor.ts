import type { NativeCommandResult } from '../core/commands/types';
import type { CanvasToolId, ToolWorkspaceScope } from '../core/tools/operationContract';
import { isValidatedToolOperation, type ValidatedToolOperation } from '../engines/canvas/geometryEngine';
import type { WorkspaceCommandClient } from './mainCanvasCommandClient';

export interface ToolOperationShellCallbacks {
  readonly isHydrating?: () => boolean;
  readonly onSelectionChange: (nodeIds: string[]) => void;
  readonly onPanChange: (pan: { x: number; y: number }) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onToolChange?: (toolId: CanvasToolId) => void;
  readonly onNotice?: (message: string) => void;
  readonly onSampledColorOptionChange?: (color: string, target: 'fill' | 'stroke') => void;
  readonly onCanvasMutationCommitted?: (kind: 'create' | 'transform' | 'replace' | 'text' | 'sample-color') => void;
}

export interface WorkspaceToolOperationExecutorOptions {
  readonly workspace: ToolWorkspaceScope;
  readonly commandClient: WorkspaceCommandClient;
  readonly shell: ToolOperationShellCallbacks;
}

export type ToolOperationExecutorOptions = WorkspaceToolOperationExecutorOptions;

export interface ToolOperationExecutionReport {
  readonly operationId: string;
  readonly workspace: ToolWorkspaceScope;
  readonly status: 'applied' | 'no-op' | 'rejected';
  readonly commandResult?: NativeCommandResult;
  readonly reason?: string;
}

export interface ToolOperationExecutor {
  execute(operation: ValidatedToolOperation): ToolOperationExecutionReport;
  executeBatch(operations: readonly ValidatedToolOperation[]): ToolOperationExecutionReport[];
}

/**
 * Unidirectional Native Command Engine adapter for Canvas Tool Operations
 * across both Main Canvas and Component Canvas workspaces.
 *
 * Accepts ONLY `ValidatedToolOperation` envelopes sealed by the Geometry Engine.
 * All document mutations commit exclusively through `WorkspaceCommandClient`
 * (Native Command Engine -> Canonical Editor Store). Studio Tools never see
 * `WorkspaceCommandClient`, `CanonicalEditorStore`, `editorReducer`, or UI panels.
 */
export function createToolOperationExecutor(options: ToolOperationExecutorOptions): ToolOperationExecutor {
  const execute = (operation: ValidatedToolOperation): ToolOperationExecutionReport => {
    if (!isValidatedToolOperation(operation)) {
      return {
        operationId: 'unknown',
        workspace: options.workspace,
        status: 'rejected',
        reason: 'Refused to execute an operation that was not validated by the Geometry Engine.',
      };
    }

    if (operation.workspace !== options.workspace) {
      return {
        operationId: operation.operationId,
        workspace: options.workspace,
        status: 'rejected',
        reason: `Workspace mismatch: executor serves "${options.workspace}" but received "${operation.workspace}".`,
      };
    }

    const hydrating = options.shell.isHydrating?.() ?? false;
    const payload = operation.payload;
    const description = operation.metadata.description;

    switch (payload.kind) {
      case 'create-nodes': {
        if (hydrating) {
          return {
            operationId: operation.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped document creation while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('create');
        const commandResult = options.commandClient.createNodes(
          payload.nodes,
          description ?? 'Create with studio tool',
        );
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'transform-nodes': {
        if (hydrating) {
          return {
            operationId: operation.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped transform while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('transform');
        const commandResult = options.commandClient.transformNodes(
          payload.nodes,
          description ?? 'Transform on canvas',
        );
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'replace-node-with-nodes': {
        if (hydrating) {
          return {
            operationId: operation.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped split while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('replace');
        const commandResult = options.commandClient.replaceNodeWithNodes(
          payload.nodeId,
          payload.nodes,
          description ?? 'Split vector path',
        );
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'replace-nodes': {
        if (hydrating) {
          return {
            operationId: operation.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped node replacement while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('replace');
        const commandResult = options.commandClient.replaceNodes(
          payload.removeIds,
          payload.insertNodes,
          description ?? 'Replace vector nodes',
          payload.selectIds,
        );
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'sample-color': {
        options.shell.onSampledColorOptionChange?.(payload.color, payload.target);
        let commandResult: NativeCommandResult | undefined;
        if (!hydrating && payload.resolvedNodesToUpdate.length > 0) {
          options.shell.onCanvasMutationCommitted?.('sample-color');
          commandResult = options.commandClient.transformNodes(
            payload.resolvedNodesToUpdate,
            description ?? `Apply sampled ${payload.target}`,
          );
        }
        options.shell.onNotice?.(payload.noticeMessage);
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult ? commandResult.status : 'applied',
          ...(commandResult ? { commandResult } : {}),
        };
      }

      case 'commit-inline-text': {
        if (hydrating) {
          return {
            operationId: operation.operationId,
            workspace: options.workspace,
            status: 'no-op',
            reason: 'Skipped text commit while hydrating.',
          };
        }
        options.shell.onCanvasMutationCommitted?.('text');
        const commandResult = options.commandClient.replaceNode(
          payload.resolvedNode,
          description ?? 'Edit text on canvas',
        );
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: commandResult.status,
          commandResult,
        };
      }

      case 'select-nodes': {
        options.shell.onSelectionChange([...payload.nodeIds]);
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'viewport-update': {
        if (payload.pan !== undefined) {
          options.shell.onPanChange({ x: payload.pan.x, y: payload.pan.y });
        }
        if (payload.zoom !== undefined) {
          options.shell.onZoomChange(payload.zoom);
        }
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'switch-tool': {
        options.shell.onToolChange?.(payload.nextToolId);
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }

      case 'notify': {
        options.shell.onNotice?.(payload.message);
        return {
          operationId: operation.operationId,
          workspace: options.workspace,
          status: 'applied',
        };
      }
    }
  };

  return {
    execute,
    executeBatch(operations) {
      return operations.map((op) => execute(op));
    },
  };
}

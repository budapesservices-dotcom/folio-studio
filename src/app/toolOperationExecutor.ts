import type { NativeCommandResult } from '../core/commands/types';
import type { DesignNode, TextNode } from '../core/document/types';
import type { CanvasToolId, ToolWorkspaceScope } from '../core/tools/operationContract';
import { isValidatedToolOperation, type ValidatedToolOperation } from '../engines/canvas/geometryEngine';
import type { MainCanvasCommandClient } from './mainCanvasCommandClient';

export interface ComponentWorkspaceMutationSink {
  createNodes(nodes: readonly DesignNode[]): void;
  transformNodes(nodes: readonly DesignNode[]): void;
  replaceNode(node: TextNode | DesignNode): void;
  replaceNodeWithNodes(nodeId: string, nodes: readonly DesignNode[]): void;
  replaceNodes(removeIds: readonly string[], insertNodes: readonly DesignNode[]): void;
}

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

export interface MainToolOperationExecutorOptions {
  readonly workspace: 'main';
  readonly commandClient: MainCanvasCommandClient;
  readonly shell: ToolOperationShellCallbacks;
}

export interface ComponentToolOperationExecutorOptions {
  readonly workspace: 'component';
  readonly componentSink: ComponentWorkspaceMutationSink;
  readonly shell: ToolOperationShellCallbacks;
}

export type ToolOperationExecutorOptions =
  | MainToolOperationExecutorOptions
  | ComponentToolOperationExecutorOptions;

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
 * Unidirectional Native Command Engine adapter for Canvas Tool Operations.
 *
 * Accepts ONLY `ValidatedToolOperation` envelopes sealed by the Geometry Engine.
 * Main workspace mutations commit exclusively through `MainCanvasCommandClient`
 * (Native Command Engine -> Canonical Editor Store). Studio Tools never see
 * `MainCanvasCommandClient`, `CanonicalEditorStore`, `editorReducer`, or UI panels.
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
        if (options.workspace === 'main') {
          const commandResult = options.commandClient.createNodes(
            payload.nodes,
            description ?? 'Create with studio tool',
          );
          return {
            operationId: operation.operationId,
            workspace: 'main',
            status: commandResult.status,
            commandResult,
          };
        }
        options.componentSink.createNodes(payload.nodes);
        return {
          operationId: operation.operationId,
          workspace: 'component',
          status: 'applied',
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
        if (options.workspace === 'main') {
          const commandResult = options.commandClient.transformNodes(
            payload.nodes,
            description ?? 'Transform on canvas',
          );
          return {
            operationId: operation.operationId,
            workspace: 'main',
            status: commandResult.status,
            commandResult,
          };
        }
        options.componentSink.transformNodes(payload.nodes);
        return {
          operationId: operation.operationId,
          workspace: 'component',
          status: 'applied',
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
        if (options.workspace === 'main') {
          const commandResult = options.commandClient.replaceNodeWithNodes(
            payload.nodeId,
            payload.nodes,
            description ?? 'Split vector path',
          );
          return {
            operationId: operation.operationId,
            workspace: 'main',
            status: commandResult.status,
            commandResult,
          };
        }
        options.componentSink.replaceNodeWithNodes(payload.nodeId, payload.nodes);
        return {
          operationId: operation.operationId,
          workspace: 'component',
          status: 'applied',
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
        if (options.workspace === 'main') {
          const commandResult = options.commandClient.replaceNodes(
            payload.removeIds,
            payload.insertNodes,
            description ?? 'Replace vector nodes',
            payload.selectIds,
          );
          return {
            operationId: operation.operationId,
            workspace: 'main',
            status: commandResult.status,
            commandResult,
          };
        }
        options.componentSink.replaceNodes(payload.removeIds, payload.insertNodes);
        return {
          operationId: operation.operationId,
          workspace: 'component',
          status: 'applied',
        };
      }

      case 'sample-color': {
        options.shell.onSampledColorOptionChange?.(payload.color, payload.target);
        let commandResult: NativeCommandResult | undefined;
        if (!hydrating && payload.resolvedNodesToUpdate.length > 0) {
          options.shell.onCanvasMutationCommitted?.('sample-color');
          if (options.workspace === 'main') {
            commandResult = options.commandClient.transformNodes(
              payload.resolvedNodesToUpdate,
              description ?? `Apply sampled ${payload.target}`,
            );
          } else {
            options.componentSink.transformNodes(payload.resolvedNodesToUpdate);
          }
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
        if (options.workspace === 'main') {
          const commandResult = options.commandClient.replaceNode(
            payload.resolvedNode,
            description ?? 'Edit text on canvas',
          );
          return {
            operationId: operation.operationId,
            workspace: 'main',
            status: commandResult.status,
            commandResult,
          };
        }
        options.componentSink.replaceNode(payload.resolvedNode);
        return {
          operationId: operation.operationId,
          workspace: 'component',
          status: 'applied',
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

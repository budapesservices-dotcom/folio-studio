import type { DocumentAddress, NativeNodeRef } from '../document/ast';

export type NativeWorkspace =
  | 'main'
  | 'component'
  | 'node-logic'
  | 'code'
  | 'system'
  | 'plugin'
  | 'ai-agent';

export type NativeActor =
  | { kind: 'user'; actorId?: string }
  | { kind: 'system'; actorId: string }
  | { kind: 'plugin'; actorId: string }
  | { kind: 'ai-agent'; actorId: string };

export interface NativeCommandSource {
  workspace: NativeWorkspace;
  actor: NativeActor;
  sessionId?: string;
  correlationId?: string;
}

export type NativePermission =
  | 'project.read'
  | 'project.rename'
  | 'document.read'
  | 'node.create'
  | 'node.update'
  | 'node.transform'
  | 'node.reorder'
  | 'node.delete'
  | 'component.read'
  | 'component.update'
  | 'component.delete';

export interface NativeCommandContext {
  /** Supplied by the trusted host, never copied from command.source. */
  projectId: string;
  principal: {
    kind: NativeActor['kind'];
    id: string;
  };
  capabilities: readonly NativePermission[];
  workspace: NativeWorkspace;
}

export type NativeCommandTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'document'; address: DocumentAddress }
  | { kind: 'node'; ref: NativeNodeRef };

export interface NativeCommandPreconditions {
  expectedProjectRevision?: number;
}

export interface NativeCommandMetadata {
  description?: string;
  userGestureId?: string;
}

export interface NativeCommandEnvelope<TType extends string, TPayload> {
  protocol: 'folio.native-command';
  protocolVersion: 1;
  commandId: string;
  type: TType;
  commandVersion: 1;
  issuedAt: string;
  source: NativeCommandSource;
  target: NativeCommandTarget;
  payload: TPayload;
  preconditions?: NativeCommandPreconditions;
  transactionId?: string;
  metadata?: NativeCommandMetadata;
}

export type NativeNodeTransform = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  /** Supported only for the existing Main Canvas placement interaction. */
  onCanvas?: boolean;
};

export interface NodeTransformPayload {
  nodes: Array<{
    ref: NativeNodeRef;
    transform: NativeNodeTransform;
  }>;
}

export interface NodeSetPropertiesPayload {
  nodes: NativeNodeRef[];
  properties: {
    visible?: boolean;
    locked?: boolean;
    layerColor?: string | null;
  };
}

export type NodeTransformCommand = NativeCommandEnvelope<'node.transform', NodeTransformPayload>;
export type NodeSetPropertiesCommand = NativeCommandEnvelope<'node.set-properties', NodeSetPropertiesPayload>;
export type NativeCommand = NodeTransformCommand | NodeSetPropertiesCommand;

export interface NativeCommandWarning {
  code: string;
  message: string;
}

export type NativeCommandStatus = 'applied' | 'no-op' | 'rejected';

export interface NativeCommandResult {
  protocolVersion: 1;
  commandId: string;
  transactionId?: string;
  status: NativeCommandStatus;
  code: string;
  message: string;
  projectId: string;
  projectRevisionBefore: number;
  projectRevisionAfter: number;
  changed: boolean;
  affectedDocuments: DocumentAddress[];
  affectedNodes: NativeNodeRef[];
  warnings: NativeCommandWarning[];
}

export interface NativeChangeSetDraft {
  projectId: string;
  transactionId?: string;
  commandIds: string[];
  documents: Array<{
    address: DocumentAddress;
    nodeIds: {
      added: string[];
      updated: string[];
      removed: string[];
    };
  }>;
  components: Array<{
    componentId: string;
    metadataChanged: boolean;
    documentContentChanged: boolean;
  }>;
  projectMetadataChanged: boolean;
}

export interface NativeChangeSet extends NativeChangeSetDraft {
  projectRevision: number;
}

export interface NativeChangeEvent {
  eventId: string;
  projectId: string;
  projectRevision: number;
  commandId: string;
  transactionId?: string;
  source: NativeCommandSource;
  change: NativeChangeSet;
}

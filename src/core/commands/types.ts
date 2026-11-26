import type { DocumentAddress, NativeNodeRef } from '../document/ast';
import type { LayerDropPosition } from '../document/layers';
import type { SelectSimilarCriterion } from '../document/selectionQueries';
import type {
  AnimationClip,
  AssetReference,
  CodeModuleRecord,
  ComponentDefinition,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  CustomEasingPreset,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  FolioPage,
  FolioProject,
  LogicGraph,
} from '../document/types';

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
  | 'project.replace'
  | 'page.create'
  | 'page.switch'
  | 'document.read'
  | 'node.create'
  | 'node.update'
  | 'node.transform'
  | 'node.reorder'
  | 'node.delete'
  | 'component.read'
  | 'component.create'
  | 'component.update'
  | 'component.delete'
  | 'tokens.update'
  | 'code.update'
  | 'logic.update'
  | 'animation.update'
  | 'asset.update'
  | 'selection.update'
  | 'history.execute';

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

export interface ProjectRenamePayload {
  name: string;
}

export interface ProjectReplacePayload {
  project: FolioProject;
}

export interface PageCreatePayload {
  page: FolioPage;
}

export interface PageSetActivePayload {
  pageId: string;
}

export interface ComponentCreatePayload {
  component: ComponentDefinition;
}

export interface ComponentSyncDocumentPayload {
  componentId: string;
  document: FolioDocument;
  animations?: AnimationClip[];
  updatedAt: string;
  expectedUpdatedAt: string;
  expectedMasterDocument: FolioDocument;
}

export interface DocumentSetBackgroundPayload {
  background: string;
}

export interface ComponentRenamePayload {
  componentId: string;
  name: string;
  expectedUpdatedAt: string;
  expectedMasterDocument: FolioDocument;
}

export interface ComponentDeletePayload {
  componentId: string;
  expectedUpdatedAt: string;
  expectedMasterDocument: FolioDocument;
}

export interface ComponentUpdateContractPayload {
  componentId: string;
  variants?: ComponentVariantAxis[];
  slots?: ComponentSlotDefinition[];
  nodeLogicEnabled?: boolean;
  expectedUpdatedAt: string;
  expectedMasterDocument: FolioDocument;
}

export interface TokensUpdatePayload {
  designTokens: DesignTokenCollection;
  unbindTokenIds?: string[];
}

export interface CodeUpdateModulesPayload {
  codeModules: CodeModuleRecord[];
  coalesceKey?: string;
}

export interface LogicCreateGraphPayload {
  graph: LogicGraph;
}

export interface LogicUpdateGraphPayload {
  graph: LogicGraph;
}

export interface LogicDeleteGraphPayload {
  graphId: string;
}

export interface AnimationCreateClipPayload {
  clip: AnimationClip;
}

export interface AnimationUpdateClipPayload {
  clip: AnimationClip;
  /** Optional coalesce key so continuous slider Auto-Key drags merge into a single Undo/Redo step. */
  coalesceKey?: string;
}

export interface AnimationDeleteClipPayload {
  clipId: string;
}

export interface AnimationUpdateCustomEasingsPayload {
  customEasings: CustomEasingPreset[];
}

export interface AssetUpsertPayload {
  asset: AssetReference;
}

export interface NodeCreatePayload {
  nodes: DesignNode[];
}

export interface NodeReplacePayload {
  node: DesignNode;
}

export interface NodeReplaceManyPayload {
  removeIds: string[];
  insertNodes: DesignNode[];
  selectIds?: string[];
}

export interface NodeSplitPayload {
  nodeId: string;
  nodes: DesignNode[];
}

export interface NodeUpdateManyPayload {
  nodes: DesignNode[];
}

export interface NodeEditPayload {
  node: DesignNode;
  coalesceKey: string;
}

export interface SelectionSetPayload {
  nodeIds: string[];
}

export type SelectionDeselectPayload = Record<string, never>;
export type SelectionInvertPayload = Record<string, never>;
export interface SelectionSelectSimilarPayload {
  criterion: SelectSimilarCriterion;
}

export type HistoryCommitEditPayload = Record<string, never>;
export type HistoryUndoPayload = Record<string, never>;
export type HistoryRedoPayload = Record<string, never>;

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

export interface NodeRenamePayload {
  updates: Array<{
    ref: NativeNodeRef;
    name: string;
  }>;
}

export interface NodeDeletePayload {
  nodes: NativeNodeRef[];
}

export interface NodeSetCanvasStatePayload {
  nodes: NativeNodeRef[];
  onCanvas: boolean;
}

export interface LayerMovePayload {
  node: NativeNodeRef;
  target: NativeNodeRef;
  position: LayerDropPosition;
}

export interface LayerMoveManyPayload {
  nodes: NativeNodeRef[];
  target: NativeNodeRef;
  position: LayerDropPosition;
}

export interface LayerGroupPayload {
  nodes: NativeNodeRef[];
}

export interface LayerUngroupPayload {
  nodes: NativeNodeRef[];
}

export interface LayerClippingMaskPayload {
  node: NativeNodeRef;
}

export type ProjectRenameCommand = NativeCommandEnvelope<'project.rename', ProjectRenamePayload>;
export type ProjectReplaceCommand = NativeCommandEnvelope<'project.replace', ProjectReplacePayload>;
export type PageCreateCommand = NativeCommandEnvelope<'page.create', PageCreatePayload>;
export type PageSetActiveCommand = NativeCommandEnvelope<'page.set-active', PageSetActivePayload>;
export type DocumentSetBackgroundCommand = NativeCommandEnvelope<'document.set-background', DocumentSetBackgroundPayload>;
export type ComponentCreateCommand = NativeCommandEnvelope<'component.create', ComponentCreatePayload>;
export type ComponentSyncDocumentCommand = NativeCommandEnvelope<'component.sync-document', ComponentSyncDocumentPayload>;
export type ComponentRenameCommand = NativeCommandEnvelope<'component.rename', ComponentRenamePayload>;
export type ComponentDeleteCommand = NativeCommandEnvelope<'component.delete', ComponentDeletePayload>;
export type ComponentUpdateContractCommand = NativeCommandEnvelope<'component.update-contract', ComponentUpdateContractPayload>;
export type TokensUpdateCommand = NativeCommandEnvelope<'tokens.update', TokensUpdatePayload>;
export type CodeUpdateModulesCommand = NativeCommandEnvelope<'code.update-modules', CodeUpdateModulesPayload>;
export type LogicCreateGraphCommand = NativeCommandEnvelope<'logic.create-graph', LogicCreateGraphPayload>;
export type LogicUpdateGraphCommand = NativeCommandEnvelope<'logic.update-graph', LogicUpdateGraphPayload>;
export type LogicDeleteGraphCommand = NativeCommandEnvelope<'logic.delete-graph', LogicDeleteGraphPayload>;
export type AnimationCreateClipCommand = NativeCommandEnvelope<'animation.create-clip', AnimationCreateClipPayload>;
export type AnimationUpdateClipCommand = NativeCommandEnvelope<'animation.update-clip', AnimationUpdateClipPayload>;
export type AnimationDeleteClipCommand = NativeCommandEnvelope<'animation.delete-clip', AnimationDeleteClipPayload>;
export type AnimationUpdateCustomEasingsCommand = NativeCommandEnvelope<'animation.update-custom-easings', AnimationUpdateCustomEasingsPayload>;
export type AssetUpsertCommand = NativeCommandEnvelope<'asset.upsert', AssetUpsertPayload>;
export type NodeCreateCommand = NativeCommandEnvelope<'node.create', NodeCreatePayload>;
export type NodeReplaceCommand = NativeCommandEnvelope<'node.replace', NodeReplacePayload>;
export type NodeReplaceManyCommand = NativeCommandEnvelope<'node.replace-many', NodeReplaceManyPayload>;
export type NodeSplitCommand = NativeCommandEnvelope<'node.split', NodeSplitPayload>;
export type NodeUpdateManyCommand = NativeCommandEnvelope<'node.update-many', NodeUpdateManyPayload>;
export type NodeEditCommand = NativeCommandEnvelope<'node.edit', NodeEditPayload>;
export type NodeTransformCommand = NativeCommandEnvelope<'node.transform', NodeTransformPayload>;
export type NodeSetPropertiesCommand = NativeCommandEnvelope<'node.set-properties', NodeSetPropertiesPayload>;
export type NodeRenameCommand = NativeCommandEnvelope<'node.rename', NodeRenamePayload>;
export type NodeDeleteCommand = NativeCommandEnvelope<'node.delete', NodeDeletePayload>;
export type NodeSetCanvasStateCommand = NativeCommandEnvelope<'node.set-canvas-state', NodeSetCanvasStatePayload>;
export type LayerMoveCommand = NativeCommandEnvelope<'layer.move', LayerMovePayload>;
export type LayerMoveManyCommand = NativeCommandEnvelope<'layer.move-many', LayerMoveManyPayload>;
export type LayerGroupCommand = NativeCommandEnvelope<'layer.group', LayerGroupPayload>;
export type LayerUngroupCommand = NativeCommandEnvelope<'layer.ungroup', LayerUngroupPayload>;
export type LayerCreateClippingMaskCommand = NativeCommandEnvelope<'layer.create-clipping-mask', LayerClippingMaskPayload>;
export type LayerRemoveClippingMaskCommand = NativeCommandEnvelope<'layer.remove-clipping-mask', LayerClippingMaskPayload>;
export type SelectionSetCommand = NativeCommandEnvelope<'selection.set', SelectionSetPayload>;
export type SelectionDeselectCommand = NativeCommandEnvelope<'selection.deselect', SelectionDeselectPayload>;
export type SelectionInvertCommand = NativeCommandEnvelope<'selection.invert', SelectionInvertPayload>;
export type SelectionSelectSimilarCommand = NativeCommandEnvelope<'selection.select-similar', SelectionSelectSimilarPayload>;
export type HistoryCommitEditCommand = NativeCommandEnvelope<'history.commit-edit', HistoryCommitEditPayload>;
export type HistoryUndoCommand = NativeCommandEnvelope<'history.undo', HistoryUndoPayload>;
export type HistoryRedoCommand = NativeCommandEnvelope<'history.redo', HistoryRedoPayload>;

export type Phase2NativeCommand =
  | ProjectRenameCommand
  | NodeCreateCommand
  | NodeReplaceCommand
  | NodeTransformCommand
  | NodeSetPropertiesCommand
  | NodeRenameCommand
  | NodeDeleteCommand
  | NodeSetCanvasStateCommand
  | LayerMoveCommand
  | LayerMoveManyCommand
  | LayerGroupCommand
  | LayerUngroupCommand
  | LayerCreateClippingMaskCommand
  | LayerRemoveClippingMaskCommand;

export type ExtendedNativeCommand =
  | ProjectReplaceCommand
  | PageCreateCommand
  | PageSetActiveCommand
  | DocumentSetBackgroundCommand
  | ComponentCreateCommand
  | ComponentSyncDocumentCommand
  | ComponentRenameCommand
  | ComponentDeleteCommand
  | ComponentUpdateContractCommand
  | TokensUpdateCommand
  | CodeUpdateModulesCommand
  | LogicCreateGraphCommand
  | LogicUpdateGraphCommand
  | LogicDeleteGraphCommand
  | AnimationCreateClipCommand
  | AnimationUpdateClipCommand
  | AnimationDeleteClipCommand
  | AnimationUpdateCustomEasingsCommand
  | AssetUpsertCommand
  | NodeReplaceManyCommand
  | NodeSplitCommand
  | NodeUpdateManyCommand
  | NodeEditCommand
  | SelectionSetCommand
  | SelectionDeselectCommand
  | SelectionInvertCommand
  | SelectionSelectSimilarCommand
  | HistoryCommitEditCommand
  | HistoryUndoCommand
  | HistoryRedoCommand;

export type NativeCommandPayload =
  | ProjectRenamePayload
  | ProjectReplacePayload
  | PageCreatePayload
  | PageSetActivePayload
  | DocumentSetBackgroundPayload
  | ComponentCreatePayload
  | ComponentSyncDocumentPayload
  | ComponentRenamePayload
  | ComponentDeletePayload
  | ComponentUpdateContractPayload
  | TokensUpdatePayload
  | CodeUpdateModulesPayload
  | LogicCreateGraphPayload
  | LogicUpdateGraphPayload
  | LogicDeleteGraphPayload
  | AnimationCreateClipPayload
  | AnimationUpdateClipPayload
  | AnimationDeleteClipPayload
  | AnimationUpdateCustomEasingsPayload
  | AssetUpsertPayload
  | NodeCreatePayload
  | NodeReplacePayload
  | NodeReplaceManyPayload
  | NodeSplitPayload
  | NodeUpdateManyPayload
  | NodeEditPayload
  | NodeTransformPayload
  | NodeSetPropertiesPayload
  | NodeRenamePayload
  | NodeDeletePayload
  | NodeSetCanvasStatePayload
  | LayerMovePayload
  | LayerMoveManyPayload
  | LayerGroupPayload
  | LayerUngroupPayload
  | LayerClippingMaskPayload
  | SelectionSetPayload
  | SelectionDeselectPayload
  | SelectionInvertPayload
  | SelectionSelectSimilarPayload
  | HistoryCommitEditPayload
  | HistoryUndoPayload
  | HistoryRedoPayload;

export type NativeCommand = Phase2NativeCommand | ExtendedNativeCommand;

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

export interface NativeCommandTransactionResult {
  protocolVersion: 1;
  transactionId: string;
  status: NativeCommandStatus;
  code: string;
  message: string;
  projectId: string;
  projectRevisionBefore: number;
  projectRevisionAfter: number;
  changed: boolean;
  commandResults: NativeCommandResult[];
  failedCommandIndex?: number;
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

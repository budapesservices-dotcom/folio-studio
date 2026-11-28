import { lazy, Suspense } from 'preact/compat';
import type { RefObject } from 'preact';
import type {
  AnimationClip,
  BreakpointId,
  ComponentDefinition,
  CustomEasingPreset,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
} from '../../core/document/types';
import { findCrossStudioNodeReferences } from '../../core/document/nodeReferenceCleanup';
import type { MotionPresetDefinition } from '../../engines/animation/index';
import type { CanvasToolId } from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import type { CodeWorkspaceViewMode } from './useCodeWorkspace';
import { LayerColorPalette, LayerContextMenu } from './LayerPopovers';
import type { LayerContextMenuCapabilities, LayerContextMenuState } from './layerOperations';
import type { MotionPathPointSelection } from '../../engines/canvas/MotionPathOverlay';

// Lazy-loaded feature bundles kept outside Folio's critical startup chunk.
const LazyCodeWorkspace = lazy(() => import('./LazyCodeWorkspace'));
const LazyTokensPanel = lazy(() => import('./TokensPanel').then((m) => ({ default: m.TokensPanel })));
const LazyMotionTimelinePanel = lazy(() => import('./MotionTimelinePanel').then((m) => ({ default: m.MotionTimelinePanel })));

export interface WorkspaceStudioOverlaysProps {
  project: FolioProject;
  activePage: FolioPage;
  pages: readonly FolioPage[];
  activeEditorId: EditorTarget;
  selectedMainNodeId: string | null;
  activeBreakpoint: BreakpointId;
  designTokens: DesignTokenCollection;
  mainCommandClient: MainCanvasCommandClient;
  focusedCommandClient: MainCanvasCommandClient;
  getCommandClient: (target: EditorTarget) => MainCanvasCommandClient;
  tokensRackOpen: boolean;
  tokensRackRef: RefObject<HTMLElement>;
  onUpdateDesignTokens: (nextTokens: DesignTokenCollection, unbindTokenIds?: string[], description?: string) => void;
  onCloseTokensRack: () => void;
  codeWorkspaceOpen: boolean;
  codeWorkspaceLaunch: { viewMode: CodeWorkspaceViewMode; pageId?: string; nonce: number };
  onJumpToCanvasNode: () => void;
  onCloseCodeWorkspace: () => void;
  layerColorPickerKey: string | null;
  layerSourceNodes: readonly DesignNode[];
  layerColorPickerPosition: { left: number; top: number } | null;
  layerColorPaletteRef: RefObject<HTMLDivElement>;
  onSelectPresetLayerColor: (nodeId: string, color: string) => void;
  onSelectCustomLayerColor: (nodeId: string, color: string) => void;
  layerContextMenu: LayerContextMenuState | null;
  layerContextMenuRef: RefObject<HTMLDivElement>;
  contextMenuNodes: readonly DesignNode[];
  contextMenuCapabilities: LayerContextMenuCapabilities;
  canPaste: boolean;
  onDismissLayerContextMenu: () => void;
  onRenameLayer: (nodeId: string) => void;
  onCopyLayer: (editorId: EditorTarget) => void;
  onCutLayer: (editorId: EditorTarget) => void;
  onPasteLayer: (editorId: EditorTarget) => void;
  onDuplicateLayer: (editorId: EditorTarget) => void;
  onToggleLayerVisible: (nodeId: string) => void;
  onToggleLayerLock: (nodeId: string) => void;
  onArrangeLayer: (editorId: EditorTarget, direction: 'front' | 'forward' | 'backward' | 'back') => void;
  onCombineSelection: (editorId: EditorTarget) => void;
  onSaveLayerAsComponent: (editorId: EditorTarget) => void;
  onUnpackComponent: (editorId: EditorTarget, nodeId: string) => void;
  onDeleteLayers: (editorId: EditorTarget, nodeIds: string[]) => void;
  onMarkLayerSelectionSource: () => void;
  motionOpen: boolean;
  activeMotionPage: FolioPage;
  activeMotionProject: FolioProject;
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  activeMotionSelectedNodeIds: readonly string[];
  playheadMs: number;
  isPlaying: boolean;
  previewActive: boolean;
  autoKeyEnabled: boolean;
  onToggleAutoKey: () => void;
  onSelectClip: (clipId: string) => void;
  onCreateClip: () => void;
  onApplyPreset: (presetId: MotionPresetDefinition['id']) => void;
  onDeleteClip: () => void;
  onUpdateClip: (clip: AnimationClip, description?: string, coalesceKey?: string) => void;
  onUpdateCustomEasings: (easings: readonly CustomEasingPreset[], description?: string) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (timeMs: number) => void;
  onKeyframeSelected: () => void;
  onKeyframePathMorph: () => void;
  onImportMorphFromComponent: (
    component: ComponentDefinition,
    options?: { targetNodeId?: string; atTimeMs?: number },
  ) => void;
  onChooseTool: (toolId: CanvasToolId, target: EditorTarget) => void;
  onOpenLivePreview: (pageId?: string) => void;
  onOpenMotionExport: () => void;
  selectedMotionPathPoint?: MotionPathPointSelection | null;
  onSelectMotionPathPoint?: (selection: MotionPathPointSelection | null) => void;
  showMorphCorrespondence?: boolean;
  onToggleMorphCorrespondence?: () => void;
  onCloseMotion: () => void;
  onNotice: (message: string) => void;
}

export function WorkspaceStudioOverlays(props: WorkspaceStudioOverlaysProps) {
  const {
    project,
    activePage,
    pages,
    activeEditorId,
    selectedMainNodeId,
    activeBreakpoint,
    designTokens,
    mainCommandClient,
    focusedCommandClient,
    getCommandClient,
    tokensRackOpen,
    tokensRackRef,
    onUpdateDesignTokens,
    onCloseTokensRack,
    codeWorkspaceOpen,
    codeWorkspaceLaunch,
    onJumpToCanvasNode,
    onCloseCodeWorkspace,
    layerColorPickerKey,
    layerSourceNodes,
    layerColorPickerPosition,
    layerColorPaletteRef,
    onSelectPresetLayerColor,
    onSelectCustomLayerColor,
    layerContextMenu,
    layerContextMenuRef,
    contextMenuNodes,
    contextMenuCapabilities,
    canPaste,
    onDismissLayerContextMenu,
    onRenameLayer,
    onCopyLayer,
    onCutLayer,
    onPasteLayer,
    onDuplicateLayer,
    onToggleLayerVisible,
    onToggleLayerLock,
    onArrangeLayer,
    onCombineSelection,
    onSaveLayerAsComponent,
    onUnpackComponent,
    onDeleteLayers,
    onMarkLayerSelectionSource,
    motionOpen,
    activeMotionPage,
    activeMotionProject,
    pageClips,
    activeClip,
    activeMotionSelectedNodeIds,
    playheadMs,
    isPlaying,
    previewActive,
    autoKeyEnabled,
    onToggleAutoKey,
    onSelectClip,
    onCreateClip,
    onApplyPreset,
    onDeleteClip,
    onUpdateClip,
    onUpdateCustomEasings,
    onTogglePlay,
    onStop,
    onSeek,
    onKeyframeSelected,
    onKeyframePathMorph,
    onImportMorphFromComponent,
    onChooseTool,
    onOpenLivePreview,
    onOpenMotionExport,
    selectedMotionPathPoint,
    onSelectMotionPathPoint,
    showMorphCorrespondence,
    onToggleMorphCorrespondence,
    onCloseMotion,
    onNotice,
  } = props;

  const targetContextNode = layerContextMenu
    ? contextMenuNodes.find((node) => node.id === layerContextMenu.nodeId)
    : undefined;

  const referenceWarning = layerContextMenu?.editorId === 'main'
    ? (() => {
        const refs = findCrossStudioNodeReferences(project, layerContextMenu.nodeIds, activePage.id);
        return refs.totalCount > 0
          ? {
              logicCount: refs.logicBindings.length,
              motionCount: refs.animationTracks.length,
              codeExtensionCount: refs.codeExtensions.length,
            }
          : null;
      })()
    : null;

  return (
    <>
      {tokensRackOpen && (
        <Suspense fallback={null}>
          <LazyTokensPanel
            panelRef={tokensRackRef}
            open={tokensRackOpen}
            project={project}
            tokens={designTokens}
            onUpdateTokens={onUpdateDesignTokens}
            onCopyNotice={onNotice}
            onClose={onCloseTokensRack}
          />
        </Suspense>
      )}

      {codeWorkspaceOpen && (
        <Suspense
          fallback={(
            <div class="code-workspace-overlay" role="status" aria-live="polite">
              <div class="code-workspace-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
                Loading Code &amp; Live Preview Studio…
              </div>
            </div>
          )}
        >
          <LazyCodeWorkspace
            key={codeWorkspaceLaunch.nonce}
            project={project}
            pages={pages}
            themes={designTokens.themes}
            selectedNodeId={selectedMainNodeId}
            activeBreakpoint={activeBreakpoint}
            initialViewMode={codeWorkspaceLaunch.viewMode}
            initialPageId={codeWorkspaceLaunch.pageId}
            mainCommandClient={mainCommandClient}
            onNotice={onNotice}
            onJumpToCanvasNode={onJumpToCanvasNode}
            onClose={onCloseCodeWorkspace}
          />
        </Suspense>
      )}

      <LayerColorPalette
        pickerKey={layerColorPickerKey}
        activeEditorId={activeEditorId}
        layerSourceNodes={layerSourceNodes}
        position={layerColorPickerPosition}
        paletteRef={layerColorPaletteRef}
        onSelectPresetColor={onSelectPresetLayerColor}
        onSelectCustomColor={onSelectCustomLayerColor}
      />

      <LayerContextMenu
        menu={layerContextMenu}
        menuRef={layerContextMenuRef}
        targetNodeName={targetContextNode?.name ?? 'layer'}
        targetNodeVisible={targetContextNode?.visible ?? true}
        targetNodeLocked={targetContextNode?.locked ?? false}
        canPaste={canPaste}
        capabilities={contextMenuCapabilities}
        referenceWarning={referenceWarning}
        onRename={(nodeId) => { onDismissLayerContextMenu(); onRenameLayer(nodeId); }}
        onCopy={(editorId) => { onDismissLayerContextMenu(); onCopyLayer(editorId); }}
        onCut={(editorId) => { onDismissLayerContextMenu(); onCutLayer(editorId); }}
        onPaste={(editorId) => { onDismissLayerContextMenu(); onPasteLayer(editorId); }}
        onDuplicate={(editorId) => { onDismissLayerContextMenu(); onDuplicateLayer(editorId); }}
        onToggleVisible={(nodeId) => { onDismissLayerContextMenu(); onToggleLayerVisible(nodeId); }}
        onToggleLock={(nodeId) => { onDismissLayerContextMenu(); onToggleLayerLock(nodeId); }}
        onArrange={(editorId, direction) => { onDismissLayerContextMenu(); onArrangeLayer(editorId, direction); }}
        onCombineSelection={(editorId) => { onDismissLayerContextMenu(); onCombineSelection(editorId); }}
        onSaveAsComponent={(editorId) => { onDismissLayerContextMenu(); onSaveLayerAsComponent(editorId); }}
        onGroup={(editorId, rootIds) => { onDismissLayerContextMenu(); onMarkLayerSelectionSource(); getCommandClient(editorId).groupLayers(rootIds); }}
        onUngroup={(editorId, rootIds) => { onDismissLayerContextMenu(); onMarkLayerSelectionSource(); getCommandClient(editorId).ungroupLayers(rootIds); }}
        onCreateClippingMask={(editorId, rootId) => { onDismissLayerContextMenu(); onMarkLayerSelectionSource(); getCommandClient(editorId).createClippingMask(rootId); }}
        onRemoveClippingMask={(editorId, rootId) => { onDismissLayerContextMenu(); onMarkLayerSelectionSource(); getCommandClient(editorId).removeClippingMask(rootId); }}
        onUnpackComponent={(editorId, nodeId) => { onDismissLayerContextMenu(); onUnpackComponent(editorId, nodeId); }}
        onDelete={(editorId, nodeIds) => { onDismissLayerContextMenu(); onMarkLayerSelectionSource(); onDeleteLayers(editorId, nodeIds); }}
      />

      {motionOpen && (
        <Suspense fallback={null}>
          <LazyMotionTimelinePanel
            workspaceScope={activeEditorId}
            activePage={activeMotionPage}
            pageClips={pageClips}
            activeClip={activeClip}
            components={project.components}
            designTokens={designTokens}
            customEasings={activeMotionProject.customEasings ?? []}
            selectedNodeIds={activeMotionSelectedNodeIds}
            playheadMs={playheadMs}
            isPlaying={isPlaying}
            previewActive={previewActive}
            autoKeyEnabled={autoKeyEnabled}
            onToggleAutoKey={onToggleAutoKey}
            onSelectClip={onSelectClip}
            onCreateClip={onCreateClip}
            onApplyPreset={onApplyPreset}
            onDeleteClip={onDeleteClip}
            onUpdateClip={onUpdateClip}
            onUpdateCustomEasings={onUpdateCustomEasings}
            onTogglePlay={onTogglePlay}
            onStop={onStop}
            onSeek={onSeek}
            onKeyframeSelected={onKeyframeSelected}
            onKeyframePathMorph={onKeyframePathMorph}
            onImportMorphFromComponent={onImportMorphFromComponent}
            onEditMorphPoints={(nodeId) => {
              focusedCommandClient.selectNodes([nodeId], 'Select morph layer for point editing');
              onChooseTool('direct-selection', activeEditorId);
            }}
            onOpenLivePreview={onOpenLivePreview}
            onOpenMotionExport={onOpenMotionExport}
            onSelectCanvasNode={(nodeId) => { focusedCommandClient.selectNodes([nodeId], 'Select animated layer'); }}
            selectedMotionPathPoint={selectedMotionPathPoint}
            onSelectMotionPathPoint={onSelectMotionPathPoint}
            showMorphCorrespondence={showMorphCorrespondence}
            onToggleMorphCorrespondence={onToggleMorphCorrespondence}
            onClose={onCloseMotion}
          />
        </Suspense>
      )}
    </>
  );
}

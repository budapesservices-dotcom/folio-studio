import type { BreakpointId, DesignThemeDefinition, FolioPage, FolioProject } from '../../core/document/types';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';
import { CodeWorkspaceView } from './CodeWorkspacePanel';
import { useCodeWorkspace, type CodeWorkspaceViewMode } from './useCodeWorkspace';

export interface LazyCodeWorkspaceProps {
  project: FolioProject;
  pages: readonly FolioPage[];
  themes: readonly DesignThemeDefinition[];
  selectedNodeId: string | null;
  activeBreakpoint: BreakpointId;
  mainCommandClient: MainCanvasCommandClient;
  initialViewMode?: CodeWorkspaceViewMode;
  initialPageId?: string;
  onNotice: (message: string) => void;
  onJumpToCanvasNode: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * Lazy-loaded Code Workspace host. Keeps HTML/CSS & React compilers and the
 * Live Preview pane completely outside Folio's initial startup JS chunk.
 */
export default function LazyCodeWorkspace({
  project,
  pages,
  themes,
  selectedNodeId,
  activeBreakpoint,
  mainCommandClient,
  initialViewMode,
  initialPageId,
  onNotice,
  onJumpToCanvasNode,
  onClose,
}: LazyCodeWorkspaceProps) {
  const workspace = useCodeWorkspace({
    project,
    selectedNodeId,
    activeBreakpoint,
    mainCommandClient,
    onNotice,
    onJumpToCanvasNode,
    controlledOpen: true,
    onControlledClose: onClose,
    initialViewMode,
    initialPageId,
  });

  return (
    <CodeWorkspaceView
      projectName={project.metadata.name}
      pages={pages}
      themes={themes}
      workspace={workspace}
    />
  );
}

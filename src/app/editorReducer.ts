import type { DesignNode, FolioProject } from '../core/document/types';

const HISTORY_LIMIT = 60;

export interface EditorState {
  project: FolioProject;
  past: FolioProject[];
  future: FolioProject[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

export type EditorAction =
  | { type: 'select-node'; nodeId: string | null }
  | { type: 'select-nodes'; nodeIds: string[] }
  | { type: 'add-node'; node: DesignNode }
  | { type: 'replace-node'; node: DesignNode }
  | { type: 'transform-nodes'; nodes: DesignNode[] }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'rename-project'; name: string }
  | { type: 'replace-project'; project: FolioProject }
  | { type: 'undo' }
  | { type: 'redo' };

export function createEditorState(project: FolioProject): EditorState {
  return { project, past: [], future: [], selectedNodeId: null, selectedNodeIds: [] };
}

function withSnapshot(
  state: EditorState,
  nextProject: FolioProject,
  selectedNodeId = state.selectedNodeId,
  selectedNodeIds = state.selectedNodeIds,
): EditorState {
  return {
    project: nextProject,
    past: [...state.past, state.project].slice(-HISTORY_LIMIT),
    future: [],
    selectedNodeId,
    selectedNodeIds,
  };
}

function touch(project: FolioProject): FolioProject {
  return {
    ...project,
    metadata: { ...project.metadata, updatedAt: new Date().toISOString() },
  };
}

function existingSelection(project: FolioProject, ids: string[]): string[] {
  const available = new Set(project.document.nodes.map((node) => node.id));
  return [...new Set(ids)].filter((id) => available.has(id));
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select-node': {
      const ids = action.nodeId ? existingSelection(state.project, [action.nodeId]) : [];
      return {
        ...state,
        selectedNodeId: ids[0] ?? null,
        selectedNodeIds: ids,
      };
    }

    case 'select-nodes': {
      const ids = existingSelection(state.project, action.nodeIds);
      return {
        ...state,
        selectedNodeId: ids.length === 1 ? ids[0] : null,
        selectedNodeIds: ids,
      };
    }

    case 'add-node': {
      const next = touch({
        ...state.project,
        document: {
          ...state.project.document,
          nodes: [...state.project.document.nodes, action.node],
        },
      });
      return withSnapshot(state, next, action.node.id, [action.node.id]);
    }

    case 'replace-node': {
      const exists = state.project.document.nodes.some((node) => node.id === action.node.id);
      if (!exists) return state;
      const next = touch({
        ...state.project,
        document: {
          ...state.project.document,
          nodes: state.project.document.nodes.map((node) => (node.id === action.node.id ? action.node : node)),
        },
      });
      return withSnapshot(state, next);
    }

    case 'transform-nodes': {
      const updates = new Map(action.nodes.map((node) => [node.id, node]));
      let changed = false;
      const nodes = state.project.document.nodes.map((node) => {
        const replacement = updates.get(node.id);
        if (!replacement) return node;
        if (
          replacement.x === node.x &&
          replacement.y === node.y &&
          replacement.width === node.width &&
          replacement.height === node.height &&
          (node.type !== 'text' || replacement.type !== 'text' || replacement.style.fontSize === node.style.fontSize)
        ) {
          return node;
        }
        changed = true;
        return replacement;
      });
      if (!changed) return state;

      const next = touch({
        ...state.project,
        document: { ...state.project.document, nodes },
      });
      return withSnapshot(state, next);
    }

    case 'delete-node': {
      const nodes = state.project.document.nodes.filter((node) => node.id !== action.nodeId);
      if (nodes.length === state.project.document.nodes.length) return state;
      const next = touch({
        ...state.project,
        document: { ...state.project.document, nodes },
      });
      const selected = state.selectedNodeIds.filter((id) => id !== action.nodeId);
      return withSnapshot(state, next, selected.length === 1 ? selected[0] : null, selected);
    }

    case 'rename-project': {
      const name = action.name.trim() || 'Untitled project';
      if (name === state.project.metadata.name) return state;
      const next = touch({
        ...state.project,
        metadata: { ...state.project.metadata, name },
      });
      return withSnapshot(state, next);
    }

    case 'replace-project':
      return createEditorState(touch(action.project));

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const selected = existingSelection(previous, state.selectedNodeIds);
      return {
        project: touch(previous),
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        selectedNodeId: selected.length === 1 ? selected[0] : null,
        selectedNodeIds: selected,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const selected = existingSelection(next, state.selectedNodeIds);
      return {
        project: touch(next),
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedNodeId: selected.length === 1 ? selected[0] : null,
        selectedNodeIds: selected,
      };
    }

    default:
      return state;
  }
}

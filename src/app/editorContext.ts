import type { DesignNode } from '../core/document/types';
import { getActiveDocument } from '../core/document/project';
import type { EditorState } from './editorReducer';

export type EditorTarget = 'main' | 'component';

export interface ActiveEditorContext {
  target: EditorTarget;
  state: EditorState;
  document: ReturnType<typeof getActiveDocument>;
  selectedNode: DesignNode | null;
  selectedNodes: DesignNode[];
}

export function getTransformableNodes(nodes: readonly DesignNode[]): DesignNode[] {
  return nodes.filter((node) => !node.locked);
}

export function getActiveEditorContext(
  target: EditorTarget,
  mainState: EditorState,
  componentState: EditorState,
): ActiveEditorContext {
  const state = target === 'component' ? componentState : mainState;
  const rawDocument = getActiveDocument(state.project);
  const nodes = Array.isArray(rawDocument?.nodes) ? rawDocument.nodes : [];
  const document = rawDocument && Array.isArray(rawDocument.nodes) ? rawDocument : { ...rawDocument, nodes };
  const selectedNodes = nodes.filter((node) => state.selectedNodeIds.includes(node.id));
  const selectedNode = selectedNodes.length === 1
    ? selectedNodes[0]
    : nodes.find((node) => node.id === state.selectedNodeId) ?? null;

  return { target, state, document, selectedNode, selectedNodes };
}

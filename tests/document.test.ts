import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import { createEditorState, editorReducer } from '../src/app/editorReducer';

describe('Folio document foundation', () => {
  it('creates a valid native project document', () => {
    const project = createInitialProject('Test project');
    const result = validateProject(project);

    expect(result.ok).toBe(true);
    expect(result.project?.metadata.name).toBe('Test project');
    expect(project.document.width).toBe(1440);
    expect(project.document.nodes.length).toBeGreaterThan(0);
  });

  it('rejects files with an unsupported format version', () => {
    const project = createInitialProject();
    const result = validateProject({ ...project, formatVersion: 999 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unsupported .flop format version');
  });

  it('adds, undoes and redoes a layer', () => {
    const project = createInitialProject();
    const initialCount = project.document.nodes.length;
    const state = createEditorState(project);
    const added = editorReducer(state, { type: 'add-node', node: createRectNode() });

    expect(added.project.document.nodes).toHaveLength(initialCount + 1);
    expect(added.selectedNodeId).toBe(added.project.document.nodes.at(-1)?.id);

    const undone = editorReducer(added, { type: 'undo' });
    expect(undone.project.document.nodes).toHaveLength(initialCount);

    const redone = editorReducer(undone, { type: 'redo' });
    expect(redone.project.document.nodes).toHaveLength(initialCount + 1);
  });

  it('updates a selected layer without mutating the previous project', () => {
    const project = createInitialProject();
    const firstNode = project.document.nodes[0];
    const state = createEditorState(project);
    const updated = editorReducer(state, {
      type: 'replace-node',
      node: { ...firstNode, x: 123 },
    });

    expect(updated.project.document.nodes[0].x).toBe(123);
    expect(state.project.document.nodes[0].x).toBe(firstNode.x);
  });
});

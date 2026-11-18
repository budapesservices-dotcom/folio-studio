import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { getActiveEditorContext } from '../src/app/editorContext';

describe('Context-aware editor panels', () => {
  it('switches layer and inspector context between Main Page and Component Canvas', () => {
    const mainProject = createInitialProject('Main');
    const mainNode = getActiveDocument(mainProject).nodes[0];
    const componentProject = createInitialProject('Component');
    componentProject.pages[0].document.nodes = [createRectNode()];
    componentProject.pages[0].document.nodes[0].name = 'Component node';
    const mainState = editorReducer(createEditorState(mainProject), { type: 'select-node', nodeId: mainNode.id });
    const componentNode = componentProject.pages[0].document.nodes[0];
    const componentState = editorReducer(createEditorState(componentProject), { type: 'select-node', nodeId: componentNode.id });

    const mainContext = getActiveEditorContext('main', mainState, componentState);
    const componentContext = getActiveEditorContext('component', mainState, componentState);

    expect(mainContext.document.name).toBe(mainProject.pages[0].document.name);
    expect(mainContext.selectedNode?.id).toBe(mainNode.id);
    expect(componentContext.document.name).toBe('Main Page');
    expect(componentContext.selectedNode?.name).toBe('Component node');
    expect(componentContext.state).toBe(componentState);
  });
});

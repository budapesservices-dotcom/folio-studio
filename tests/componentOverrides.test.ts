import { describe, expect, it } from 'vitest';
import { createComponentInstance, pruneComponentInstanceOverridesInDocument, replaceComponentInstancesInDocument } from '../src/core/document/components';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import type { ComponentDefinition, FolioDocument, GroupNode } from '../src/core/document/types';

function componentFixture() {
  const project = createInitialProject('Component override pruning');
  const root: GroupNode = {
    id: 'master-group', type: 'group', name: 'Group',
    x: 10, y: 20, width: 200, height: 100,
    rotation: 0, opacity: 1, visible: true, locked: false,
  };
  const kept = { ...createRectNode(), id: 'master-kept', parentId: root.id, x: 14, y: 16 };
  const removed = { ...createRectNode(), id: 'master-removed', parentId: root.id, x: 24, y: 26 };
  const masterDocument: FolioDocument = {
    ...project.pages[0].document, id: 'master-document',
    width: 400, height: 300, nodes: [root, kept, removed],
  };
  const master: ComponentDefinition = {
    id: 'master-component', name: 'Master', document: masterDocument,
    createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z',
  };
  const otherDocument: FolioDocument = {
    ...masterDocument, id: 'other-document',
    nodes: masterDocument.nodes.map((node) => ({
      ...node,
      id: 'other-' + node.id,
      ...(node.parentId ? { parentId: 'other-' + node.parentId } : {}),
    })),
  };
  const otherMaster: ComponentDefinition = {
    ...master, id: 'other-component', name: 'Other', document: otherDocument,
  };
  const instance = {
    ...createComponentInstance(master, 30, 40, 'instance-one'),
    width: 800, height: 600, rotation: 30, opacity: 0.5,
    overrides: {
      'master-kept': { fill: '#11aa22' },
      'master-removed': { fill: '#aa1122' },
    },
  };
  const other = {
    ...createComponentInstance(otherMaster, 0, 0, 'instance-other'),
    overrides: { 'other-master-kept': { fill: '#334455' } },
  };
  project.components = [master, otherMaster];
  project.pages[0].document = { ...project.pages[0].document, nodes: [instance, other] };
  return { project, master, instance, other };
}

describe('component master instance overrides', () => {
  it('prunes only overrides keyed to removed master node ids across the matching instances', () => {
    const { project, master } = componentFixture();
    const state = createEditorState(project);
    const currentMaster = state.project.components.find((item) => item.id === master.id)!;
    const nextDocument = {
      ...currentMaster.document,
      nodes: currentMaster.document.nodes.filter((node) => node.id !== 'master-removed'),
    };
    const next = editorReducer(state, {
      type: 'sync-component-document',
      componentId: currentMaster.id,
      expectedMasterDocument: currentMaster.document,
      expectedUpdatedAt: currentMaster.updatedAt,
      document: nextDocument,
      updatedAt: '2026-11-20T01:00:00.000Z',
    });
    const [instance, other] = next.project.pages[0].document.nodes;

    expect(instance.type).toBe('component-instance');
    expect(instance.type === 'component-instance' ? instance.overrides : null).toEqual({
      'master-kept': { fill: '#11aa22' },
    });
    expect(other.type).toBe('component-instance');
    expect(other.type === 'component-instance' ? other.overrides : null).toEqual({
      'other-master-kept': { fill: '#334455' },
    });
  });

  it('leaves the document reference unchanged when there are no removed override targets', () => {
    const { project, master } = componentFixture();
    const document = project.pages[0].document;
    expect(pruneComponentInstanceOverridesInDocument(document, master.id, new Set())).toBe(document);
  });

  it('detaches a whole definition with effective overrides, hierarchy, geometry, and transforms intact', () => {
    const { project, master, instance } = componentFixture();
    const detached = replaceComponentInstancesInDocument(project.pages[0].document, master);
    const detachedGroup = detached.nodes.find((node) => node.id === 'instance-one__master-group');
    const detachedKept = detached.nodes.find((node) => node.id === 'instance-one__master-kept');

    expect(detached.nodes.some((node) => node.type === 'component-instance' && node.componentId === master.id)).toBe(false);
    expect(detachedGroup?.type).toBe('group');
    expect(detachedKept?.parentId).toBe('instance-one__master-group');
    expect(detachedKept?.width).toBe(master.document.nodes.find((node) => node.id === 'master-kept')!.width * 2);
    expect(detachedKept?.opacity).toBe(0.5);
    expect(detachedKept?.rotation).toBe(30);
    expect(detachedKept?.type === 'rect' ? detachedKept.style.fill : null).toBe('#11aa22');
    expect(instance.overrides['master-removed']).toEqual({ fill: '#aa1122' });
  });
});

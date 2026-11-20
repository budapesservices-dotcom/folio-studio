import { describe, expect, it } from 'vitest';
import { createDocumentAstView } from '../src/core/document/ast';
import { createEmptyDocument, createRectNode } from '../src/core/document/factory';
import type { DesignNode, FolioDocument } from '../src/core/document/types';

function makeDocument(): FolioDocument {
  const rootBack = { ...createRectNode(), id: 'root-back', name: 'Root back' };
  const { style: _style, ...groupBase } = createRectNode();
  const group: DesignNode = {
    ...groupBase,
    id: 'group',
    name: 'Group',
    type: 'group',
  };
  const childA = { ...createRectNode(), id: 'child-a', name: 'Child A', parentId: group.id };
  const rootFront = { ...createRectNode(), id: 'root-front', name: 'Root front' };
  const childB = { ...createRectNode(), id: 'child-b', name: 'Child B', parentId: group.id };

  const document = createEmptyDocument('AST test');
  return { ...document, id: 'document-ast', nodes: [rootBack, group, childA, rootFront, childB] };
}

function pageAddress(document: FolioDocument) {
  return {
    projectId: 'project-one',
    owner: { kind: 'page' as const, id: 'page-home' },
    documentId: document.id,
  };
}

describe('Native AST compatibility view', () => {
  it('provides document-scoped node lookup and stable references', () => {
    const firstDocument = makeDocument();
    const secondDocument = {
      ...firstDocument,
      id: 'component-document',
      nodes: [{ ...firstDocument.nodes[0], id: 'root-back' }],
    };
    const first = createDocumentAstView(firstDocument, pageAddress(firstDocument));
    const second = createDocumentAstView(secondDocument, {
      projectId: 'project-one',
      owner: { kind: 'component', id: 'component-card' },
      documentId: secondDocument.id,
    });

    expect(first.getNode('root-back')?.name).toBe('Root back');
    expect(first.getNode('missing')).toBeNull();
    expect(first.getNodeRef('root-back')).toEqual({
      document: pageAddress(firstDocument),
      nodeId: 'root-back',
    });
    expect(first.getNodeRef('missing')).toBeNull();
    expect(second.getNodeRef('root-back')?.document.owner).toEqual({
      kind: 'component',
      id: 'component-card',
    });
  });

  it('resolves parents, children, ancestors and descendants from parentId', () => {
    const document = makeDocument();
    const view = createDocumentAstView(document, pageAddress(document));

    expect(view.getParent('child-a')?.id).toBe('group');
    expect(view.getParent('group')).toBeNull();
    expect(view.getChildren('group').map((node) => node.id)).toEqual(['child-a', 'child-b']);
    expect(view.getChildren(null).map((node) => node.id)).toEqual(['root-back', 'group', 'root-front']);
    expect(view.getAncestors('child-a').map((node) => node.id)).toEqual(['group']);
    expect(view.getDescendants('group').map((node) => node.id)).toEqual(['child-a', 'child-b']);
  });

  it('preserves storage, paint, render, sibling and Layers panel order', () => {
    const document = makeDocument();
    const view = createDocumentAstView(document, pageAddress(document));

    expect(view.getStorageIndex('child-b')).toBe(4);
    expect(view.getSiblingIndex('child-b')).toBe(1);
    expect(view.getSiblingIndex('missing')).toBeNull();
    expect(view.getPaintOrder().map((node) => node.id)).toEqual([
      'root-back', 'group', 'child-a', 'root-front', 'child-b',
    ]);
    expect(view.getRenderOrder().map((node) => node.id)).toEqual([
      'root-back', 'group', 'child-a', 'child-b', 'root-front',
    ]);
    expect(view.getLayerPanelRows().map((row) => row.node.id)).toEqual([
      'root-front', 'group', 'child-b', 'child-a', 'root-back',
    ]);
    expect(view.getLayerPanelRows(['group']).map((row) => row.node.id)).toEqual([
      'root-front', 'group', 'root-back',
    ]);
  });

  it('rejects duplicate node IDs before exposing an ambiguous view', () => {
    const document = makeDocument();
    const duplicate = { ...document.nodes[0], name: 'Duplicate' };
    const invalid = { ...document, nodes: [...document.nodes, duplicate] };

    expect(() => createDocumentAstView(invalid, pageAddress(invalid)))
      .toThrow('duplicate node ID "root-back"');
  });

  it('does not mutate the source document while serving queries', () => {
    const document = makeDocument();
    const before = JSON.stringify(document);
    const view = createDocumentAstView(document, pageAddress(document));

    view.getNode('child-a');
    view.getParent('child-a');
    view.getChildren('group');
    view.getAncestors('child-a');
    view.getDescendants('group');
    view.getPaintOrder();
    view.getRenderOrder();
    view.getLayerPanelRows(['group']);

    expect(JSON.stringify(document)).toBe(before);
  });

  it('rebuilds against the next immutable document value', () => {
    const document = makeDocument();
    const firstView = createDocumentAstView(document, pageAddress(document));
    const updatedDocument = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === 'root-back' ? { ...node, name: 'Updated root' } : node),
    };
    const nextView = createDocumentAstView(updatedDocument, pageAddress(updatedDocument));

    expect(firstView.getNode('root-back')?.name).toBe('Root back');
    expect(nextView.getNode('root-back')?.name).toBe('Updated root');
  });
});

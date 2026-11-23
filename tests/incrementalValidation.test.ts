import { describe, expect, it } from 'vitest';
import { createComponentInstance } from '../src/core/document/components';
import { createEmptyDocument, createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { ComponentDefinition, DesignNode, FolioProject } from '../src/core/document/types';
import {
  freezeImmutableGraph,
  isDeeplyFrozenGraph,
  validateProject,
  validateProjectIncremental,
} from '../src/core/document/validation';

function buildMultiPageProject(): FolioProject {
  const base = createInitialProject('Incremental Validation Suite');
  const tokens = createDefaultDesignTokens();
  const rectA = { ...createRectNode(0), id: 'node-rect-a', name: 'Hero Box' };
  const textA = { ...createTextNode(1), id: 'node-text-a', name: 'Hero Title' };
  const masterDoc = createEmptyDocument('Card Master', 320, 180);
  masterDoc.nodes = [
    { ...createRectNode(0), id: 'master-bg', name: 'Card Background' },
    { ...createTextNode(1), id: 'master-label', name: 'Card Label', text: 'Default' },
  ];
  const master: ComponentDefinition = {
    id: 'comp-card-master',
    name: 'Card Master',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    document: masterDoc,
  };
  const instance = createComponentInstance(master, 80, 120);

  const page2Doc = createEmptyDocument('Pricing', 1440, 900);
  page2Doc.nodes = [
    { ...createRectNode(0), id: 'p2-rect', name: 'Pricing Panel' },
    { ...createTextNode(1), id: 'p2-title', name: 'Pricing Heading' },
  ];

  const project: FolioProject = {
    ...base,
    designTokens: tokens,
    components: [master],
    pages: [
      {
        ...base.pages[0],
        document: {
          ...base.pages[0].document,
          nodes: [rectA, textA, instance],
        },
      },
      {
        id: 'page-pricing',
        name: 'Pricing',
        route: '/pricing',
        document: page2Doc,
      },
    ],
  };

  return freezeImmutableGraph(project);
}

describe('Incremental Project Validation Equivalence', () => {
  it('marks deeply frozen graphs and matches full validation on valid edits', () => {
    const previous = buildMultiPageProject();
    expect(isDeeplyFrozenGraph(previous)).toBe(true);
    expect(validateProject(previous).ok).toBe(true);

    const activePage = getActivePage(previous);
    const updatedNode: DesignNode = { ...activePage.document.nodes[0], x: 320, y: 240 };
    const candidate: FolioProject = {
      ...previous,
      pages: previous.pages.map((page) =>
        page.id !== activePage.id
          ? page
          : {
              ...page,
              document: {
                ...page.document,
                nodes: page.document.nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node)),
              },
            },
      ),
    };

    const fullResult = validateProject(candidate);
    const incrementalResult = validateProjectIncremental(previous, candidate);
    expect(incrementalResult).toEqual(fullResult);
    expect(incrementalResult.ok).toBe(true);
  });

  it('rejects tampered unfrozen candidate projects identically to full validation', () => {
    const previous = buildMultiPageProject();
    const cloned = structuredClone(previous) as FolioProject;
    expect(isDeeplyFrozenGraph(cloned)).toBe(false);

    // Mutate an unfrozen node to have invalid negative width
    cloned.pages[0].document.nodes[0].width = -50;
    const fullResult = validateProject(cloned);
    const incrementalResult = validateProjectIncremental(previous, cloned);

    expect(fullResult.ok).toBe(false);
    expect(incrementalResult.ok).toBe(false);
    expect(incrementalResult.error).toEqual(fullResult.error);
  });

  it('catches invalid token references when designTokens change while page references stay frozen', () => {
    const previous = buildMultiPageProject();
    const colorToken = previous.designTokens!.tokens.find((token) => token.category === 'color')!;

    // First bind a valid color token on page 1 and freeze it as the new baseline
    const boundProject = freezeImmutableGraph({
      ...previous,
      pages: previous.pages.map((page, index) =>
        index !== 0
          ? page
          : {
              ...page,
              document: {
                ...page.document,
                nodes: page.document.nodes.map((node) =>
                  node.id === 'node-rect-a'
                    ? { ...node, tokenBindings: { fill: colorToken.id } }
                    : node,
                ),
              },
            },
      ),
    });
    expect(validateProjectIncremental(previous, boundProject).ok).toBe(true);

    // Now delete that token while keeping page 1 object reference untouched (===)
    const missingTokenCandidate: FolioProject = {
      ...boundProject,
      designTokens: {
        ...boundProject.designTokens!,
        tokens: boundProject.designTokens!.tokens.filter((token) => token.id !== colorToken.id),
      },
    };

    const fullResult = validateProject(missingTokenCandidate);
    const incrementalResult = validateProjectIncremental(boundProject, missingTokenCandidate);

    expect(fullResult.ok).toBe(false);
    expect(incrementalResult.ok).toBe(false);
    expect(incrementalResult.error).toEqual(fullResult.error);
  });

  it('catches orphaned component instances when a master component is removed', () => {
    const previous = buildMultiPageProject();
    const withoutMaster: FolioProject = {
      ...previous,
      components: [],
    };

    const fullResult = validateProject(withoutMaster);
    const incrementalResult = validateProjectIncremental(previous, withoutMaster);

    expect(fullResult.ok).toBe(false);
    expect(incrementalResult.ok).toBe(false);
    expect(incrementalResult.error).toEqual(fullResult.error);
  });

  it('catches duplicate page routes, invalid component overrides, and cyclic parent pointers', () => {
    const previous = buildMultiPageProject();

    // 1. Duplicate page route
    const duplicateRoute: FolioProject = {
      ...previous,
      pages: previous.pages.map((page, idx) => (idx === 1 ? { ...page, route: previous.pages[0].route } : page)),
    };
    expect(validateProjectIncremental(previous, duplicateRoute)).toEqual(validateProject(duplicateRoute));
    expect(validateProjectIncremental(previous, duplicateRoute).ok).toBe(false);

    // 2. Invalid component instance override targeting a non-existent master child
    const badOverride: FolioProject = {
      ...previous,
      pages: previous.pages.map((page, idx) =>
        idx !== 0
          ? page
          : {
              ...page,
              document: {
                ...page.document,
                nodes: page.document.nodes.map((node) =>
                  node.type === 'component-instance'
                    ? { ...node, overrides: { 'does-not-exist': { text: 'Broken' } } }
                    : node,
                ),
              },
            },
      ),
    };
    expect(validateProjectIncremental(previous, badOverride)).toEqual(validateProject(badOverride));
    expect(validateProjectIncremental(previous, badOverride).ok).toBe(false);

    // 3. Cyclic parent reference
    const cyclicParent: FolioProject = {
      ...previous,
      pages: previous.pages.map((page, idx) =>
        idx !== 0
          ? page
          : {
              ...page,
              document: {
                ...page.document,
                nodes: page.document.nodes.map((node) =>
                  node.id === 'node-rect-a' ? { ...node, parentId: 'node-rect-a' } : node,
                ),
              },
            },
      ),
    };
    expect(validateProjectIncremental(previous, cyclicParent)).toEqual(validateProject(cyclicParent));
    expect(validateProjectIncremental(previous, cyclicParent).ok).toBe(false);
  });
});

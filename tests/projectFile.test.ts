import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProjectFile } from '../src/app/projectFileActions';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentInstanceNode, FolioProject, GroupNode } from '../src/core/document/types';
import { downloadProject, readProjectFile } from '../src/core/persistence/projectFile';
import { validateProject } from '../src/core/document/validation';

function fileFromContent(content: string, name = 'project.flop'): File {
  return { name, text: async () => content } as File;
}

function fileFromProject(project: unknown, name = 'project.flop'): File {
  return fileFromContent(JSON.stringify(project), name);
}

function createCompleteProject(): FolioProject & Record<string, unknown> {
  const project = createInitialProject('Native project');
  const timestamp = '2026-11-20T00:00:00.000Z';
  const masterNode = { ...createRectNode(), id: 'master-node' };
  const pageNode = { ...createRectNode(), id: 'node-stable' };
  const instance: ComponentInstanceNode = {
    id: 'instance-stable',
    type: 'component-instance',
    name: 'Card instance',
    x: 24,
    y: 36,
    width: 240,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    componentId: 'component-stable',
    overrides: { 'master-node': { fill: '#123456' } },
  };

  project.metadata = {
    ...project.metadata,
    id: 'project-stable',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  project.pages = [{
    ...project.pages[0],
    id: 'page-stable',
    document: {
      ...project.pages[0].document,
      id: 'document-stable',
      nodes: [pageNode, instance],
    },
  }];
  project.activePageId = 'page-stable';
  project.components = [{
    id: 'component-stable',
    name: 'Card',
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      ...project.pages[0].document,
      id: 'component-document-stable',
      name: 'Card',
      nodes: [masterNode],
    },
  }];
  project.logicGraphs = [{
    id: 'logic-graph-stable',
    name: 'Reserved graph',
    scope: 'project',
    targetId: null,
    nodes: [{
      id: 'logic-node-stable',
      type: 'reserved-node',
      x: 10,
      y: 20,
      data: { enabled: true },
    }],
    connections: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  project.assets = [{
    id: 'asset-stable',
    name: 'Reference image',
    kind: 'image',
    mimeType: 'image/png',
    source: 'asset://reference-image',
    createdAt: timestamp,
  }];

  return {
    ...project,
    futureProjectData: { opaque: 'preserve-me' },
  } as FolioProject & Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native .flop project file workflow', () => {
  it('imports a valid v2 project with identities and the complete aggregate intact', async () => {
    const source = createCompleteProject();
    const imported = await readProjectFile(fileFromProject(source));

    expect(imported).toEqual(source);
    expect(imported.metadata.id).toBe('project-stable');
    expect(imported.pages[0].id).toBe('page-stable');
    expect(imported.pages[0].document.id).toBe('document-stable');
    expect(imported.pages[0].document.nodes.map((node) => node.id)).toEqual([
      'node-stable',
      'instance-stable',
    ]);
    expect(imported.pages[0].document.nodes[1]).toMatchObject({
      type: 'component-instance',
      componentId: 'component-stable',
      overrides: { 'master-node': { fill: '#123456' } },
    });
    expect(imported.components[0].id).toBe('component-stable');
    expect(imported.logicGraphs[0].id).toBe('logic-graph-stable');
    expect(imported.assets[0].id).toBe('asset-stable');
    expect((imported as unknown as Record<string, unknown>).futureProjectData).toEqual({
      opaque: 'preserve-me',
    });
  });

  it('migrates a supported v1 file while preserving IDs and unknown extension data', async () => {
    const base = createInitialProject('Legacy project');
    const timestamp = '2026-11-19T00:00:00.000Z';
    const legacyNode = {
      ...createRectNode(),
      id: 'legacy-node-stable',
      futureNodeData: { keep: true },
    };
    const legacy = {
      format: 'folio-project',
      formatVersion: 1,
      appVersion: base.appVersion,
      metadata: {
        ...base.metadata,
        id: 'legacy-project-stable',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      document: {
        ...base.pages[0].document,
        id: 'legacy-document-stable',
        name: 'Legacy single document',
        nodes: [legacyNode],
        futureDocumentData: { keep: true },
      },
      futureProjectData: { keep: true },
    };

    const imported = await readProjectFile(fileFromProject(legacy));

    expect(imported.formatVersion).toBe(2);
    expect(imported.metadata).toEqual(legacy.metadata);
    expect(imported.activePageId).toBe('page-main');
    expect(imported.pages[0]).toMatchObject({
      id: 'page-main',
      route: '/',
      document: {
        id: 'legacy-document-stable',
        nodes: [{ id: 'legacy-node-stable' }],
      },
    });
    expect((imported as unknown as Record<string, unknown>).futureProjectData).toEqual({ keep: true });
    expect((imported.pages[0].document as unknown as Record<string, unknown>).futureDocumentData)
      .toEqual({ keep: true });
    expect((imported.pages[0].document.nodes[0] as unknown as Record<string, unknown>).futureNodeData)
      .toEqual({ keep: true });
  });

  it('treats a cancelled file selection as a no-op', async () => {
    const currentProject = createCompleteProject();
    const originalState = createEditorState(currentProject);
    const state = originalState;
    const replaceProject = vi.fn();

    await expect(openProjectFile(null, replaceProject)).resolves.toBeNull();
    expect(replaceProject).not.toHaveBeenCalled();
    expect(state).toBe(originalState);
  });

  it('rejects invalid JSON without invoking project replacement', async () => {
    const currentProject = createCompleteProject();
    let state = createEditorState(currentProject);
    const originalState = state;
    const replaceProject = vi.fn((project: FolioProject) => {
      state = editorReducer(state, { type: 'replace-project', project });
    });

    await expect(openProjectFile(fileFromContent('{invalid json'), replaceProject))
      .rejects.toThrow('not valid JSON');

    expect(replaceProject).not.toHaveBeenCalled();
    expect(state).toBe(originalState);
  });

  it('rejects unsupported versions without invoking project replacement', async () => {
    const currentProject = createCompleteProject();
    let state = createEditorState(currentProject);
    const originalState = state;
    const replaceProject = vi.fn((project: FolioProject) => {
      state = editorReducer(state, { type: 'replace-project', project });
    });

    await expect(openProjectFile(fileFromProject({
      format: 'folio-project',
      formatVersion: 999,
    }), replaceProject)).rejects.toThrow('Unsupported .flop format version: 999.');

    expect(replaceProject).not.toHaveBeenCalled();
    expect(state).toBe(originalState);
  });

  it('rejects a v1 file that fails migration validation without replacing the current project', async () => {
    const base = createInitialProject('Legacy project');
    const invalidLegacy = {
      format: 'folio-project',
      formatVersion: 1,
      appVersion: base.appVersion,
      metadata: base.metadata,
      document: { ...base.pages[0].document, width: 0 },
    };
    const currentProject = createCompleteProject();
    let state = createEditorState(currentProject);
    const originalState = state;
    const replaceProject = vi.fn((project: FolioProject) => {
      state = editorReducer(state, { type: 'replace-project', project });
    });

    await expect(openProjectFile(fileFromProject(invalidLegacy), replaceProject)).rejects.toThrow();
    expect(replaceProject).not.toHaveBeenCalled();
    expect(state).toBe(originalState);
  });

  it('clears undo and redo history on replacement and retains imported metadata and IDs', () => {
    let state = createEditorState(createCompleteProject());
    state = editorReducer(state, { type: 'rename-project', name: 'Unsaved edit' });
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'select-node', nodeId: 'node-stable' });

    expect(state.future).toHaveLength(1);
    const imported = createCompleteProject();
    imported.metadata.updatedAt = '2026-11-18T12:00:00.000Z';

    const replaced = editorReducer(state, { type: 'replace-project', project: imported });

    expect(replaced.project.metadata).toEqual(imported.metadata);
    expect(replaced.project.metadata.id).toBe('project-stable');
    expect(replaced.project.pages[0].id).toBe('page-stable');
    expect(replaced.project.pages[0].document.id).toBe('document-stable');
    expect(replaced.project.pages[0].document.nodes.map((node) => node.id)).toEqual([
      'node-stable',
      'instance-stable',
    ]);
    expect(replaced.project.components[0].id).toBe('component-stable');
    expect(replaced.project.logicGraphs[0].id).toBe('logic-graph-stable');
    expect(replaced.project.assets[0].id).toBe('asset-stable');
    expect(replaced.past).toEqual([]);
    expect(replaced.future).toEqual([]);
    expect(replaced.selectedNodeId).toBeNull();
    expect(replaced.selectedNodeIds).toEqual([]);
    expect(replaced.historyGroup).toBeNull();
  });

  it('exports the complete project aggregate with the .flop extension', async () => {
    const source = createCompleteProject();
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    const append = vi.fn();
    let exportedBlob: Blob | undefined;

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:folio-project';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('window', { setTimeout: vi.fn() });

    downloadProject(source);

    expect(anchor.download).toBe('native-project.flop');
    expect(anchor.href).toBe('blob:folio-project');
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(exportedBlob?.type).toBe('application/vnd.folio.project+json');
    expect(exportedBlob).toBeDefined();

    const exported = JSON.parse(await exportedBlob!.text());
    expect(exported).toEqual(source);
    expect(exported.pages[0].document.nodes[1].componentId).toBe('component-stable');
    expect(exported.logicGraphs[0].nodes[0].id).toBe('logic-node-stable');
    expect(exported.assets[0].id).toBe('asset-stable');
  });
});


describe('Group node .flop export and import', () => {
  it('exports and re-imports grouped page and component layers without changing IDs, hierarchy, order or properties', async () => {
    const source = createCompleteProject();
    const pageGroup: GroupNode = {
      id: 'page-group-stable',
      type: 'group',
      name: 'Page Group',
      x: 20,
      y: 30,
      width: 360,
      height: 240,
      rotation: 0,
      opacity: 0.85,
      visible: true,
      locked: false,
      layerColor: '#6f9f88',
      onCanvas: true,
    };
    const nestedGroup: GroupNode = {
      id: 'page-nested-group-stable',
      type: 'group',
      name: 'Nested Group',
      x: 52,
      y: 64,
      width: 180,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      parentId: pageGroup.id,
      onCanvas: false,
    };
    const pageChild = {
      ...createRectNode(),
      id: 'page-group-child-stable',
      name: 'Grouped page child',
      x: 36,
      y: 48,
      width: 96,
      height: 72,
      parentId: pageGroup.id,
      layerColor: '#c58c52',
    };
    const nestedChild = {
      ...createRectNode(),
      id: 'page-nested-child-stable',
      name: 'Nested page child',
      x: 72,
      y: 88,
      width: 64,
      height: 48,
      parentId: nestedGroup.id,
      onCanvas: false,
    };
    const instance = source.pages[0].document.nodes.find((node) => node.type === 'component-instance');
    if (!instance) throw new Error('Expected the fixture component instance.');

    source.pages[0].document = {
      ...source.pages[0].document,
      nodes: [pageGroup, pageChild, nestedGroup, nestedChild, instance],
    };

    const componentGroup: GroupNode = {
      id: 'component-group-stable',
      type: 'group',
      name: 'Master Group',
      x: 12,
      y: 16,
      width: 240,
      height: 160,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      parentId: null,
      layerColor: '#8b79aa',
      onCanvas: true,
    };
    const masterChild = {
      ...createRectNode(),
      id: 'master-node',
      name: 'Grouped master child',
      parentId: componentGroup.id,
      style: { fill: '#123456', stroke: '#000000', strokeWidth: 2, radius: 8 },
    };
    source.components[0].document = {
      ...source.components[0].document,
      nodes: [componentGroup, masterChild],
    };

    expect(validateProject(source).ok).toBe(true);

    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    let exportedBlob: Blob | undefined;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append: vi.fn() },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:folio-group-export';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('window', { setTimeout: vi.fn() });

    expect(() => downloadProject(source)).not.toThrow();
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(exportedBlob).toBeDefined();

    const exportedPayload = JSON.parse(await exportedBlob!.text());
    expect(exportedPayload.formatVersion).toBe(2);
    const imported = await readProjectFile(fileFromProject(exportedPayload));

    expect(imported.pages[0].document.nodes.map((node) => node.id)).toEqual([
      'page-group-stable',
      'page-group-child-stable',
      'page-nested-group-stable',
      'page-nested-child-stable',
      'instance-stable',
    ]);
    expect(imported.pages[0].document.nodes).toEqual(source.pages[0].document.nodes);
    expect(imported.pages[0].document.nodes.find((node) => node.id === 'page-group-child-stable')?.parentId)
      .toBe('page-group-stable');
    expect(imported.pages[0].document.nodes.find((node) => node.id === 'page-nested-group-stable')?.parentId)
      .toBe('page-group-stable');
    expect(imported.pages[0].document.nodes.find((node) => node.id === 'page-nested-child-stable')?.parentId)
      .toBe('page-nested-group-stable');

    expect(imported.components[0].document.nodes.map((node) => node.id)).toEqual([
      'component-group-stable',
      'master-node',
    ]);
    expect(imported.components[0].document.nodes).toEqual(source.components[0].document.nodes);
    expect(imported.components[0].document.nodes[1].parentId).toBe('component-group-stable');
    expect(imported).toEqual(source);
  });
});

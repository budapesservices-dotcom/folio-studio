import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getLayerPanelRows } from '../src/core/document/layers';
import { getActivePage } from '../src/core/document/project';
import type { DesignNode, GroupNode } from '../src/core/document/types';
import {
  computeClampedContextMenuPosition,
  computeClampedPopoverPosition,
  computeLayerRenameUpdates,
  computeLayerSelection,
  getLayerContextMenuCapabilities,
  getLayerDropPosition,
  getLayerDropPositionFromRatio,
  LAYER_COLOR_PRESETS,
} from '../src/app/workspace/layerOperations';
import {
  clampCanvasZoom,
  DEFAULT_CANVAS_VIEW,
  parseCanvasViewState,
  resolveActiveExportTarget,
  stepCanvasZoom,
} from '../src/app/workspace/canvasViewState';

const RAW_APP_FILES = import.meta.glob<string>('../src/app/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function makeGroupNode(id: string, name: string): GroupNode {
  return {
    id,
    type: 'group',
    name,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
  };
}

describe('workspace/layerOperations', () => {
  it('computes single and collision-safe batch rename updates', () => {
    expect(
      computeLayerRenameUpdates({ nodeIds: ['a'], value: '   ', batch: false, existingNames: ['a'] }),
    ).toEqual([]);

    expect(
      computeLayerRenameUpdates({
        nodeIds: ['a'],
        value: ' Hero Banner ',
        batch: false,
        existingNames: ['Hero Banner'],
      }),
    ).toEqual([{ nodeId: 'a', name: 'Hero Banner' }]);

    expect(
      computeLayerRenameUpdates({
        nodeIds: ['a', 'b', 'c'],
        value: 'Card',
        batch: true,
        existingNames: ['Card 1', 'Card 2', 'Other'],
      }),
    ).toEqual([
      { nodeId: 'a', name: 'Card 3' },
      { nodeId: 'b', name: 'Card 4' },
      { nodeId: 'c', name: 'Card 5' },
    ]);
  });

  it('derives layer drop placement from vertical pointer ratio cleanly', () => {
    expect(getLayerDropPositionFromRatio(0.1)).toBe('before');
    expect(getLayerDropPositionFromRatio(0.24)).toBe('before');
    expect(getLayerDropPositionFromRatio(0.25)).toBe('inside');
    expect(getLayerDropPositionFromRatio(0.5)).toBe('inside');
    expect(getLayerDropPositionFromRatio(0.75)).toBe('inside');
    expect(getLayerDropPositionFromRatio(0.76)).toBe('after');
    expect(getLayerDropPositionFromRatio(1.2)).toBe('after');

    expect(getLayerDropPosition({ top: 100, height: 0 }, 100)).toBe('before');
    expect(getLayerDropPosition({ top: 100, height: 40 }, 105)).toBe('before');
    expect(getLayerDropPosition({ top: 100, height: 40 }, 120)).toBe('inside');
    expect(getLayerDropPosition({ top: 100, height: 40 }, 136)).toBe('after');
  });

  it('evaluates group, ungroup, clipping mask, and unmask context capabilities accurately', () => {
    const base: DesignNode = { ...createRectNode(0), id: 'base', name: 'Base' };
    const top: DesignNode = { ...createRectNode(1), id: 'top', name: 'Top' };
    const clipped: DesignNode = {
      ...createRectNode(2),
      id: 'clipped',
      name: 'Clipped',
      clipMaskBaseId: 'top',
    };
    const group: GroupNode = makeGroupNode('grp', 'Group');
    const child: DesignNode = { ...createTextNode(0), id: 'child', name: 'Child', parentId: 'grp' };
    const nodes: DesignNode[] = [base, top, clipped, group, child];

    const multiCap = getLayerContextMenuCapabilities(nodes, ['base', 'top']);
    expect(multiCap.canGroup).toBe(true);
    expect(multiCap.canUngroup).toBe(false);
    expect(multiCap.canMask).toBe(false);

    const topCap = getLayerContextMenuCapabilities(nodes, ['top']);
    expect(topCap.canGroup).toBe(false);
    expect(topCap.canMask).toBe(true);
    expect(topCap.canUnmask).toBe(false);

    const clippedCap = getLayerContextMenuCapabilities(nodes, ['clipped']);
    expect(clippedCap.canMask).toBe(true);
    expect(clippedCap.canUnmask).toBe(true);

    const groupCap = getLayerContextMenuCapabilities(nodes, ['grp']);
    expect(groupCap.canGroup).toBe(true);
    expect(groupCap.canUngroup).toBe(true);
  });

  it('handles single click, inline rename trigger, Shift range, and Cmd/Ctrl toggle selection', () => {
    const g = makeGroupNode('g', 'Group');
    const c1: DesignNode = { ...createRectNode(0), id: 'c1', name: 'Child 1', parentId: 'g' };
    const r2: DesignNode = { ...createRectNode(1), id: 'r2', name: 'Rect 2' };
    const r3: DesignNode = { ...createRectNode(2), id: 'r3', name: 'Rect 3' };
    const nodes: DesignNode[] = [r3, r2, g, c1];
    const rows = getLayerPanelRows(nodes, []);
    const rowIds = rows.map((row) => row.node.id);

    // Single click on group selects group + descendant
    const singleGroup = computeLayerSelection({
      nodeId: 'g',
      modifiers: {},
      nodes,
      rows,
      selectedNodeIds: [],
      currentAnchorId: null,
    });
    expect(singleGroup.action).toBe('select');
    expect(singleGroup.nodeIds).toEqual(['g', 'c1']);
    expect(singleGroup.nextAnchorId).toBe('g');

    // Re-clicking already selected single root triggers inline rename
    const renameSingle = computeLayerSelection({
      nodeId: 'r2',
      modifiers: {},
      nodes,
      rows,
      selectedNodeIds: ['r2'],
      currentAnchorId: 'r2',
    });
    expect(renameSingle).toEqual({ action: 'rename-single' });

    // Shift-clicking a range between two visible rows
    const firstId = rowIds[0];
    const lastId = rowIds[rowIds.length - 1];
    const rangeSelect = computeLayerSelection({
      nodeId: lastId,
      modifiers: { shiftKey: true },
      nodes,
      rows,
      selectedNodeIds: [firstId],
      currentAnchorId: firstId,
    });
    expect(rangeSelect.action).toBe('select');
    expect(rangeSelect.nodeIds?.length).toBe(rowIds.length);

    // Shift-clicking an already selected root in a multi-root selection opens batch rename
    const batchRename = computeLayerSelection({
      nodeId: 'r3',
      modifiers: { shiftKey: true },
      nodes,
      rows,
      selectedNodeIds: ['r2', 'r3'],
      currentAnchorId: 'r2',
    });
    expect(batchRename).toEqual({ action: 'rename-batch' });

    // Additive toggle adds and removes cleanly
    const additiveOn = computeLayerSelection({
      nodeId: 'r3',
      modifiers: { ctrlKey: true },
      nodes,
      rows,
      selectedNodeIds: ['r2'],
      currentAnchorId: 'r2',
    });
    expect(additiveOn.action).toBe('select');
    expect(additiveOn.nodeIds).toEqual(['r3', 'r2']);

    const additiveOff = computeLayerSelection({
      nodeId: 'r2',
      modifiers: { metaKey: true },
      nodes,
      rows,
      selectedNodeIds: ['r2', 'r3'],
      currentAnchorId: 'r3',
    });
    expect(additiveOff.action).toBe('select');
    expect(additiveOff.nodeIds).toEqual(['r3']);
  });

  it('clamps color popover and context menu coordinates within the viewport', () => {
    expect(LAYER_COLOR_PRESETS.length).toBeGreaterThanOrEqual(10);

    const below = computeClampedPopoverPosition(
      { left: 100, right: 200, bottom: 200, top: 188 },
      { width: 168, height: 120 },
      { width: 1440, height: 900 },
    );
    expect(below).toEqual({ top: 206, left: 32 });

    const flippedAbove = computeClampedPopoverPosition(
      { left: 1380, right: 1430, bottom: 880, top: 868 },
      { width: 168, height: 120 },
      { width: 1440, height: 900 },
    );
    expect(flippedAbove.left).toBeLessThanOrEqual(1440 - 168 - 8);
    expect(flippedAbove.top).toBeLessThan(868);

    const ctxClamped = computeClampedContextMenuPosition(1420, 880, { width: 1440, height: 900 });
    expect(ctxClamped.x).toBe(1440 - 208 - 8);
    expect(ctxClamped.y).toBe(900 - 240 - 8);
  });
});

describe('workspace/canvasViewState', () => {
  it('clamps and steps canvas zoom deterministically', () => {
    expect(clampCanvasZoom(0.01)).toBe(0.15);
    expect(clampCanvasZoom(15)).toBe(8);
    expect(clampCanvasZoom(Number.NaN)).toBe(DEFAULT_CANVAS_VIEW.zoom);
    expect(clampCanvasZoom(1.23)).toBe(1.23);

    expect(stepCanvasZoom(1, 'in')).toBe(1.2);
    expect(stepCanvasZoom(1, 'out')).toBe(0.83);
    expect(stepCanvasZoom(8, 'in')).toBe(8);
    expect(stepCanvasZoom(0.15, 'out')).toBe(0.15);
  });

  it('parses persisted view state safely with fallback defaults', () => {
    expect(parseCanvasViewState(null)).toEqual(DEFAULT_CANVAS_VIEW);
    expect(parseCanvasViewState('not-json')).toEqual(DEFAULT_CANVAS_VIEW);
    expect(parseCanvasViewState(JSON.stringify({ zoom: 99, pan: { x: 42, y: -18 } }))).toEqual({
      zoom: 8,
      pan: { x: 42, y: -18 },
    });
    expect(parseCanvasViewState(JSON.stringify({ zoom: 'bad', pan: { x: 10, y: 20 } }))).toEqual({
      zoom: DEFAULT_CANVAS_VIEW.zoom,
      pan: { x: 10, y: 20 },
    });
  });

  it('resolves active export target across Main Page, active component master, and scratch Component Canvas', () => {
    const project = createInitialProject();
    const activePage = getActivePage(project);
    const compDoc = { ...activePage.document, id: 'comp-doc', name: 'Button Master' };
    const projectWithComp = {
      ...project,
      components: [
        {
          id: 'comp-1',
          name: 'Primary CTA',
          scope: 'global' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          document: compDoc,
        },
      ],
    };

    const mainTarget = resolveActiveExportTarget('main', projectWithComp, compDoc, null);
    expect(mainTarget).toEqual({
      document: activePage.document,
      name: `${projectWithComp.metadata.name}-${activePage.name}`,
    });

    const masterTarget = resolveActiveExportTarget('component', projectWithComp, compDoc, 'comp-1');
    expect(masterTarget).toEqual({
      document: compDoc,
      name: 'Primary CTA',
    });

    const scratchTarget = resolveActiveExportTarget('component', projectWithComp, compDoc, null);
    expect(scratchTarget).toEqual({
      document: compDoc,
      name: `${projectWithComp.metadata.name}-component`,
    });
  });
});

describe('workspace modularity & architectural boundary regressions', () => {
  it('keeps App.tsx lean and modularized via src/app/workspace/*', () => {
    const appSource = RAW_APP_FILES['../src/app/App.tsx'];
    expect(appSource).toBeTruthy();
    const lineCount = appSource.split('\n').length;
    expect(lineCount).toBeLessThan(2000);
    expect(appSource).toContain('./workspace/GlobalToolbar');
    expect(appSource).toContain('./workspace/ToolRail');
    expect(appSource).toContain('./workspace/LayersPanel');
    expect(appSource).toContain('./workspace/CanvasWindows');
    expect(appSource).toContain('./workspace/PagesRackPanel');
    expect(appSource).toContain('./workspace/ComponentRackPanel');
    expect(appSource).toContain('./workspace/StatusBar');
  });

  it('keeps pure presentation workspace panels decoupled from canvas engine and reducer/store internals', () => {
    const purePanelFiles = [
      'GlobalToolbar.tsx',
      'ToolRail.tsx',
      'LayersPanel.tsx',
      'LayerPopovers.tsx',
      'PagesRackPanel.tsx',
      'ComponentRackPanel.tsx',
      'TokensPanel.tsx',
      'InspectorWebLayoutSection.tsx',
      'InspectorComponentContractSection.tsx',
      'CodeWorkspacePanel.tsx',
      'LivePreviewPane.tsx',
      'StatusBar.tsx',
      'ComponentDeletionDialog.tsx',
    ];

    for (const file of purePanelFiles) {
      const source = RAW_APP_FILES[`../src/app/workspace/${file}`];
      expect(source, `Missing workspace file ${file}`).toBeTruthy();
      expect(source, `${file} must not import Canvas`).not.toMatch(/engines\/canvas\/Canvas/);
      expect(source, `${file} must not import canvas tools`).not.toMatch(/engines\/canvas\/tools\//);
      expect(source, `${file} must not import editorReducer`).not.toMatch(/editorReducer/);
      expect(source, `${file} must not import editorStore`).not.toMatch(/editorStore/);
    }
  });

  it('enforces zero Native Command Engine bypasses inside src/app/workspace/*', () => {
    const workspaceEntries = Object.entries(RAW_APP_FILES).filter(([path]) =>
      path.startsWith('../src/app/workspace/'),
    );
    expect(workspaceEntries.length).toBeGreaterThanOrEqual(14);

    for (const [path, source] of workspaceEntries) {
      expect(source, `${path} must not call dispatchLegacyAction`).not.toMatch(/\bdispatchLegacyAction\s*\(/);
      expect(source, `${path} must not call editorReducer`).not.toMatch(/\beditorReducer\s*\(/);
      expect(source, `${path} must not call commitEditorTransition`).not.toMatch(/\bcommitEditorTransition\s*\(/);
    }
  });
});

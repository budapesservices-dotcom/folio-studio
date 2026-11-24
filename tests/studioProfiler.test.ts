import { describe, expect, it } from 'vitest';
import { createFrameNode, createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createInteractiveStarterProject } from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  analyzeProjectHealth,
  runLiveSceneProfile,
  SPATIAL_CULLING_THRESHOLD,
} from '../src/engines/diagnostics/studioProfiler';

describe('P2-2 — Studio Scene Profiler & Project Health Diagnostics', () => {
  it('computes accurate structural metrics and cross-studio health checks for the interactive starter project', () => {
    const project = createInteractiveStarterProject('Health Check');
    const activePage = getActivePage(project);

    const health = analyzeProjectHealth(project, {
      activePageId: activePage.id,
      historyUndoCount: 3,
      historyRedoCount: 1,
    });

    expect(health.projectName).toBe('Health Check');
    expect(health.pageCount).toBe(1);
    expect(health.activePageNodeCount).toBe(activePage.document.nodes.length);
    expect(health.totalProjectNodes).toBe(activePage.document.nodes.length);
    expect(health.logicGraphCount).toBeGreaterThanOrEqual(1);
    expect(health.animationClipCount).toBeGreaterThanOrEqual(1);
    expect(health.historyUndoCount).toBe(3);
    expect(health.historyRedoCount).toBe(1);
    expect(health.spatialCullingActive).toBe(false);
    expect(health.nodeBreakdown.text).toBe(4);
    expect(health.nodeBreakdown.rect).toBe(1);
    expect(health.nodeBreakdown.ellipse).toBe(2);

    const schemaCheck = health.checks.find((check) => check.id === 'schema-validation');
    const logicCheck = health.checks.find((check) => check.id === 'node-logic-health');
    const motionCheck = health.checks.find((check) => check.id === 'motion-health');
    expect(schemaCheck?.status).toBe('healthy');
    expect(logicCheck?.status).toBe('healthy');
    expect(motionCheck?.status).toBe('healthy');
  });

  it('activates spatial culling diagnostics above threshold and measures deep hierarchy nesting', () => {
    const project = createInitialProject('Large Scene');
    const activePage = getActivePage(project);

    const outer = { ...createFrameNode(0, 0, 800, 600), id: 'frame-outer' };
    const mid = { ...createFrameNode(20, 20, 400, 300), id: 'frame-mid', parentId: 'frame-outer' };
    const leaf = { ...createRectNode(0), id: 'rect-leaf', parentId: 'frame-mid' };

    const extraRects = Array.from({ length: SPATIAL_CULLING_THRESHOLD + 10 }, (_, idx) => ({
      ...createRectNode(idx),
      id: `bulk-rect-${idx}`,
      x: (idx % 20) * 60,
      y: Math.floor(idx / 20) * 40,
      width: 48,
      height: 32,
    }));

    activePage.document.nodes = [outer, mid, leaf, ...extraRects];
    const health = analyzeProjectHealth(project);

    expect(health.spatialCullingActive).toBe(true);
    expect(health.maxNestingDepth).toBe(3);
    expect(health.nodeBreakdown.frame).toBe(2);
    expect(health.nodeBreakdown.rect).toBe(SPATIAL_CULLING_THRESHOLD + 11);
  });

  it('runs a non-destructive live scene profile across all 8 runtime engine stages', () => {
    const project = createInteractiveStarterProject('Profile Target');
    const profile = runLiveSceneProfile(project);

    expect(profile.stages).toHaveLength(8);
    expect(profile.stages.map((stage) => stage.id)).toEqual([
      'ast-view',
      'layer-tree',
      'auto-layout',
      'spatial-index',
      'a11y-audit',
      'compile-html',
      'compile-react',
      'incremental-validation',
    ]);
    for (const stage of profile.stages) {
      expect(Number.isFinite(stage.durationMs)).toBe(true);
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(profile.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(['fast', 'moderate', 'heavy']).toContain(profile.rating);
  });
});

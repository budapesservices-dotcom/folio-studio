import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import {
  cleanupDeletedNodeReferences,
  findCrossStudioNodeReferences,
  formatLayerDeletionCleanupNotice,
} from '../src/core/document/nodeReferenceCleanup';
import { validateProject } from '../src/core/document/validation';
import { readProjectFile } from '../src/core/persistence/projectFile';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import {
  autoArrangeLogicGraph,
  createInteractiveStarterProject,
} from '../src/app/workspace/nodeLogicGraphHelpers';
import { buildPresetClipForPage } from '../src/engines/animation';

describe('Cross-Studio Hardening — Safe Deletion, Undo/Redo & .flop Fidelity', () => {
  it('detects and atomically cleans up Node Logic bindings and Motion tracks on layer delete, and restores all on Undo', () => {
    const starter = createInteractiveStarterProject('Hardening Studio');
    const page = starter.pages[0];
    const visualCard = page.document.nodes.find((n) => n.name === 'Visual card')!;
    const sun = page.document.nodes.find((n) => n.name === 'Sun')!;
    const clip = buildPresetClipForPage(page, 'hero-entrance', [visualCard.id, sun.id]);

    const projectWithBoth = {
      ...starter,
      animations: [clip],
    };

    const store = createCanonicalEditorStore(createEditorState(projectWithBoth));
    const client = createMainCanvasCommandClient(store);

    // Pre-delete inspection detects both Node Logic binding(s) and Motion track(s) on Sun
    const preRefs = findCrossStudioNodeReferences(store.getSnapshot().editorState.project, [sun.id], page.id);
    expect(preRefs.logicBindings.length).toBeGreaterThanOrEqual(2); // two Set Fill Color nodes target Sun
    expect(preRefs.animationTracks.length).toBeGreaterThanOrEqual(1);

    const notice = formatLayerDeletionCleanupNotice([sun.name], {
      logicCount: preRefs.logicBindings.length,
      motionCount: preRefs.animationTracks.length,
    });
    expect(notice).toContain('Sun');
    expect(notice).toContain('Node Logic');
    expect(notice).toContain('Motion');
    expect(notice).toContain('Undo to restore');

    // Delete Sun via Zero-Bypass Native Command Engine
    const delResult = client.deleteNodes([sun.id]);
    expect(delResult.status).toBe('applied');

    const afterDelete = store.getSnapshot().editorState.project;
    expect(validateProject(afterDelete).ok).toBe(true);
    expect(afterDelete.pages[0].document.nodes.some((n) => n.id === sun.id)).toBe(false);

    // Node Logic bindings targeting Sun are safely unbound to '' (preserving nodes & wires)
    const graphAfterDelete = afterDelete.logicGraphs[0];
    expect(graphAfterDelete.nodes).toHaveLength(projectWithBoth.logicGraphs[0].nodes.length);
    expect(graphAfterDelete.connections).toHaveLength(projectWithBoth.logicGraphs[0].connections.length);
    const danglingLogic = graphAfterDelete.nodes.filter((n) => n.data.targetNodeId === sun.id);
    expect(danglingLogic).toHaveLength(0);

    // Motion Timeline tracks targeting Sun are removed while Visual card tracks remain intact
    const clipAfterDelete = afterDelete.animations![0];
    expect(clipAfterDelete.tracks.some((t) => t.targetNodeId === sun.id)).toBe(false);
    expect(clipAfterDelete.tracks.some((t) => t.targetNodeId === visualCard.id)).toBe(true);

    // Atomic Undo restores the deleted layer, ALL Node Logic bindings, AND ALL Motion tracks in 1 step!
    const undoResult = client.undo();
    expect(undoResult.status).toBe('applied');
    const afterUndo = store.getSnapshot().editorState.project;
    expect(afterUndo.pages[0].document.nodes.some((n) => n.id === sun.id)).toBe(true);
    expect(afterUndo.logicGraphs[0].nodes.filter((n) => n.data.targetNodeId === sun.id)).toHaveLength(
      preRefs.logicBindings.length,
    );
    expect(afterUndo.animations![0].tracks.filter((t) => t.targetNodeId === sun.id)).toHaveLength(
      preRefs.animationTracks.length,
    );
  });

  it('returns the original project unchanged when deleting an unreferenced layer', () => {
    const project = createInitialProject('Clean Delete');
    const result = cleanupDeletedNodeReferences(project, new Set(['non-existent-id']), project.activePageId);
    expect(result.project).toBe(project);
    expect(result.unboundLogicCount).toBe(0);
    expect(result.removedTrackCount).toBe(0);
    expect(formatLayerDeletionCleanupNotice(['Rect'], { logicCount: 0, motionCount: 0 })).toBeNull();
  });

  it('interleaves Undo/Redo cleanly across Canvas, Node Logic, and Motion Timeline edits', () => {
    const starter = createInteractiveStarterProject('Undo Redo Cross-Studio');
    const page = starter.pages[0];
    const store = createCanonicalEditorStore(createEditorState(starter));
    const client = createMainCanvasCommandClient(store);

    // 1. Node Logic mutation (scramble + auto-arrange)
    const scrambled = {
      ...starter.logicGraphs[0],
      nodes: starter.logicGraphs[0].nodes.map((n, i) => ({ ...n, x: 100 + i * 5, y: 100 })),
    };
    expect(client.updateLogicGraph(scrambled, 'Scramble graph').status).toBe('applied');
    const arranged = autoArrangeLogicGraph(store.getSnapshot().editorState.project.logicGraphs[0]);
    expect(client.updateLogicGraph(arranged, 'Auto-arrange logic graph').status).toBe('applied');

    // 2. Motion Timeline mutation (create clip)
    const initialClipCount = (store.getSnapshot().editorState.project.animations ?? []).length;
    const clip = buildPresetClipForPage(page, 'orbit-float', [page.document.nodes[0].id]);
    expect(client.createAnimationClip(clip, 'Create motion clip').status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(initialClipCount + 1);

    // Undo Motion -> new clip disappears while arranged graph remains
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations ?? []).toHaveLength(initialClipCount);
    expect(store.getSnapshot().editorState.project.logicGraphs[0].nodes[0].x).toBe(arranged.nodes[0].x);

    // Undo Node Logic -> returns to scrambled coordinates
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs[0].nodes[0].x).toBe(100);

    // Redo Node Logic + Redo Motion -> restores both cleanly
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.logicGraphs[0].nodes[0].x).toBe(arranged.nodes[0].x);
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(initialClipCount + 1);
  });

  it('preserves logicGraphs, animations, tokens, and pages across .flop export/import round-trip', async () => {
    const starter = createInteractiveStarterProject('Roundtrip Studio');
    const page = starter.pages[0];
    const clip = buildPresetClipForPage(page, 'hero-entrance', page.document.nodes.slice(0, 2).map((n) => n.id));
    const richProject = {
      ...starter,
      animations: [clip],
    };

    const json = JSON.stringify(richProject, null, 2);
    const file = new File([json], 'roundtrip-studio.flop', { type: 'application/vnd.folio.project+json' });

    const imported = await readProjectFile(file);
    expect(validateProject(imported).ok).toBe(true);
    expect(imported.metadata.name).toBe('Roundtrip Studio');
    expect(imported.logicGraphs).toEqual(richProject.logicGraphs);
    expect(imported.animations).toEqual(richProject.animations);
    expect(imported.pages).toEqual(richProject.pages);
  });
});

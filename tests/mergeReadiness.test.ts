import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createInitialProject, createNode, createNodeForDocument } from '../src/core/document/factory';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  detachComponentInstance,
} from '../src/core/document/components';
import {
  createClippingMask,
  getEffectiveLayerStates,
  getLayerClipMaskBaseIds,
  groupLayers,
} from '../src/core/document/layers';
import { validateProject } from '../src/core/document/validation';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { getActiveDocument } from '../src/core/document/project';
import { buildMaskElementId, sanitizeMaskIdSegment } from '../src/engines/canvas/artwork';
import type { DesignNode, FolioDocument } from '../src/core/document/types';

describe('WEB-10: createNodeForDocument compact artboard placement', () => {
  const componentDoc: FolioDocument = {
    ...createEmptyDocument('Card Master', 420, 280),
    background: '#00000000',
  };

  it('scales and centers rect, ellipse, and text strictly inside a 420x280 Component Canvas', () => {
    for (const type of ['rect', 'ellipse', 'text'] as const) {
      const node = createNodeForDocument(type, componentDoc);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(componentDoc.width);
      expect(node.y + node.height).toBeLessThanOrEqual(componentDoc.height);

      // Centered within the compact artboard (within 2px rounding)
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      expect(Math.abs(centerX - componentDoc.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(centerY - componentDoc.height / 2)).toBeLessThanOrEqual(2);

      if (node.type === 'text') {
        expect(node.style.fontSize).toBeGreaterThanOrEqual(16);
        expect(node.style.fontSize).toBeLessThanOrEqual(32);
      }
    }
  });

  it('preserves default placement on standard 1440x900 desktop pages', () => {
    const pageDoc = createEmptyDocument('Home', 1440, 900);
    const rect = createNodeForDocument('rect', pageDoc);
    const baseline = createNode('rect');
    expect(rect.width).toBe(baseline.width);
    expect(rect.height).toBe(baseline.height);
    expect(rect.x + rect.width).toBeLessThanOrEqual(pageDoc.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(pageDoc.height);
  });
});

describe('WEB-12 & WEB-13: component creation, nested groups, clipping masks, and detach integrity', () => {
  function buildGroupedMaskedNodes(): {
    nodes: DesignNode[];
    outerGroupId: string;
    maskBaseId: string;
    maskedChildId: string;
  } {
    const base: DesignNode = {
      ...createNode('ellipse'),
      id: 'node-mask-base',
      name: 'Avatar Mask',
      x: 100,
      y: 100,
      width: 120,
      height: 120,
    };
    const fill: DesignNode = {
      ...createNode('rect'),
      id: 'node-masked-fill',
      name: 'Avatar Photo',
      x: 90,
      y: 90,
      width: 150,
      height: 150,
    };
    const caption: DesignNode = {
      ...createNode('text'),
      id: 'node-caption',
      name: 'Caption',
      x: 100,
      y: 235,
      width: 140,
      height: 32,
    };

    // Apply clipping mask: fill clipped by base directly below it in render order
    const maskedNodes = createClippingMask([base, fill, caption], fill.id);
    expect(maskedNodes.find((n) => n.id === fill.id)?.clipMaskBaseId).toBe(base.id);

    // Group base + fill into inner group
    const innerGroupedNodes = groupLayers(maskedNodes, [base.id, fill.id]);
    const innerGroup = innerGroupedNodes.find((n) => n.type === 'group');
    expect(innerGroup).toBeDefined();

    // Group inner group + caption into outer group (nested group hierarchy)
    const outerGroupedNodes = groupLayers(innerGroupedNodes, [innerGroup!.id, caption.id]);
    const outerGroup = outerGroupedNodes.find((n) => n.type === 'group' && n.id !== innerGroup!.id);
    expect(outerGroup).toBeDefined();

    return {
      nodes: outerGroupedNodes,
      outerGroupId: outerGroup!.id,
      maskBaseId: base.id,
      maskedChildId: fill.id,
    };
  }

  it('expands selected groups, preserves nested parentId and clipMaskBaseId, and strips external references', () => {
    const { nodes, outerGroupId, maskBaseId, maskedChildId } = buildGroupedMaskedNodes();
    const externalUnselected: DesignNode = { ...createNode('rect'), id: 'node-external', x: 500, y: 500 };
    const externalMaskTarget: DesignNode = {
      ...createNode('rect'),
      id: 'node-dangling-mask',
      x: 120,
      y: 120,
      parentId: outerGroupId,
      clipMaskBaseId: externalUnselected.id,
    };
    const allNodes = [...nodes, externalUnselected, externalMaskTarget];

    // Select only the outer group — helper must recursively include descendants
    const definition = buildComponentDefinitionFromNodes(allNodes, [outerGroupId], 'Avatar Card');
    expect(definition).not.toBeNull();
    const saved = definition!.document.nodes;

    expect(saved.some((n) => n.id === outerGroupId)).toBe(true);
    expect(saved.some((n) => n.id === maskBaseId)).toBe(true);
    expect(saved.some((n) => n.id === maskedChildId)).toBe(true);
    expect(saved.some((n) => n.id === externalUnselected.id)).toBe(false);

    // Internal clipping mask relationship preserved
    const savedMaskedChild = saved.find((n) => n.id === maskedChildId)!;
    expect(savedMaskedChild.clipMaskBaseId).toBe(maskBaseId);
    expect(getLayerClipMaskBaseIds(saved, maskedChildId)).toEqual([maskBaseId]);

    // Dangling reference to unselected external node stripped cleanly
    const savedDangling = saved.find((n) => n.id === externalMaskTarget.id)!;
    expect(savedDangling.clipMaskBaseId).toBeUndefined();

    // Coordinates normalized cleanly inside component artboard
    expect(definition!.document.width).toBeGreaterThan(0);
    expect(definition!.document.height).toBeGreaterThan(0);
    for (const node of saved) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('remaps clipMaskBaseId and parentId when detaching a component instance', () => {
    const { nodes, outerGroupId, maskBaseId, maskedChildId } = buildGroupedMaskedNodes();
    const component = buildComponentDefinitionFromNodes(nodes, [outerGroupId], 'Avatar Card');
    expect(component).not.toBeNull();
    const instance = createComponentInstance(component!, 300, 200);

    const detached = detachComponentInstance(instance, component!);
    const detachedBase = detached.find((n) => n.name === 'Avatar Mask');
    const detachedFill = detached.find((n) => n.name === 'Avatar Photo');
    expect(detachedBase).toBeDefined();
    expect(detachedFill).toBeDefined();

    // Detached IDs must be fresh (not master IDs) and clipMaskBaseId must point to the detached base
    expect(detachedBase!.id).not.toBe(maskBaseId);
    expect(detachedFill!.id).not.toBe(maskedChildId);
    expect(detachedFill!.clipMaskBaseId).toBe(detachedBase!.id);

    // Effective layer states and mask chain resolve cleanly with zero dangling IDs
    expect(getLayerClipMaskBaseIds(detached, detachedFill!.id)).toEqual([detachedBase!.id]);
    const states = getEffectiveLayerStates(detached);
    expect(states.get(detachedFill!.id)?.visible).toBe(true);
    for (const node of detached) {
      if (node.parentId) {
        expect(detached.some((candidate) => candidate.id === node.parentId)).toBe(true);
      }
      if (node.clipMaskBaseId) {
        expect(detached.some((candidate) => candidate.id === node.clipMaskBaseId)).toBe(true);
      }
    }
  });

  it('validates clipMaskBaseId integrity and round-trips nested groups + masks through .flop and undo/redo', () => {
    const { nodes, outerGroupId } = buildGroupedMaskedNodes();
    const component = buildComponentDefinitionFromNodes(nodes, [outerGroupId], 'Avatar Card');
    expect(component).not.toBeNull();
    const instance = createComponentInstance(component!, 140, 120);

    const project = createInitialProject();
    project.components.push(component!);
    project.pages[0].document.nodes = [...nodes, instance];

    // Valid project passes strict validation
    expect(validateProject(project).ok).toBe(true);

    // Round-trip through .flop JSON serialization & migration/validation
    const serialized = JSON.stringify(project, null, 2);
    const loaded = migrateProjectToV2(JSON.parse(serialized));
    expect(loaded.components).toHaveLength(project.components.length);
    const loadedComponent = loaded.components.find((c) => c.id === component!.id)!;
    expect(loadedComponent.document.nodes.some((n) => n.clipMaskBaseId !== undefined)).toBe(true);
    expect(loaded.pages[0].document.nodes.some((n) => n.clipMaskBaseId !== undefined)).toBe(true);

    // Undo/redo preserves nested groups + clipping masks cleanly
    let editor = createEditorState(loaded);
    const initialNodesSnapshot = JSON.stringify(getActiveDocument(editor.project).nodes);
    const fillNode = getActiveDocument(editor.project).nodes.find((n) => n.id === 'node-masked-fill')!;
    editor = editorReducer(editor, {
      type: 'replace-node',
      node: { ...fillNode, x: fillNode.x + 24 },
    });
    expect(getActiveDocument(editor.project).nodes.find((n) => n.id === 'node-masked-fill')?.clipMaskBaseId).toBe('node-mask-base');
    editor = editorReducer(editor, { type: 'undo' });
    expect(JSON.stringify(getActiveDocument(editor.project).nodes)).toBe(initialNodesSnapshot);
    editor = editorReducer(editor, { type: 'redo' });
    expect(getActiveDocument(editor.project).nodes.find((n) => n.id === 'node-masked-fill')?.clipMaskBaseId).toBe('node-mask-base');

    // Invalid self-mask and dangling clipMaskBaseId are rejected by validateProject
    const invalidSelfMask = structuredClone(project);
    invalidSelfMask.pages[0].document.nodes[0].clipMaskBaseId = invalidSelfMask.pages[0].document.nodes[0].id;
    expect(validateProject(invalidSelfMask).ok).toBe(false);

    const invalidDanglingMask = structuredClone(project);
    invalidDanglingMask.pages[0].document.nodes[0].clipMaskBaseId = 'non-existent-mask-id';
    expect(validateProject(invalidDanglingMask).ok).toBe(false);
  });
});

describe('SVG Mask ID namespacing', () => {
  it('produces sanitized, collision-free mask IDs across canvas, instance, and thumbnail scopes', () => {
    const baseId = 'node:mask/1 base';
    const mainId = buildMaskElementId('folio-mask-doc-page_1', baseId);
    const compId = buildMaskElementId('folio-mask-doc-comp_1', baseId);
    const instId = buildMaskElementId('folio-mask-doc-page_1-inst-inst_1', baseId);
    const thumbId = buildMaskElementId(`folio-thumb-mask-${sanitizeMaskIdSegment('comp/1')}`, baseId);

    const unique = new Set([mainId, compId, instId, thumbId]);
    expect(unique.size).toBe(4);
    for (const id of unique) {
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});

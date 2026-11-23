import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { ComponentDefinition, DesignTokenCollection } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  createDefaultDesignTokens,
  findTokenUsages,
  generateDesignTokensCss,
  resolveDesignTokenValue,
  resolveNodeWithTokens,
  validateDesignTokenCollection,
} from '../src/core/document/tokens';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentSlot,
  createComponentVariantAxis,
  detachComponentInstance,
  pruneComponentContractForDocument,
  resolveComponentInstanceNodes,
} from '../src/core/document/components';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';

describe('Design Tokens & Themes', () => {
  it('resolves primitive, semantic alias, and Light/Dark theme values deterministically', () => {
    const tokens = createDefaultDesignTokens();
    expect(validateDesignTokenCollection(tokens).ok).toBe(true);

    const lightSurface = resolveDesignTokenValue(tokens, 'tok-sem-surface-canvas', 'theme-light');
    expect(lightSurface.ok).toBe(true);
    if (lightSurface.ok) {
      expect(lightSurface.rawValue).toBe('#F5F2EC');
      expect(lightSurface.chain).toEqual(['tok-sem-surface-canvas', 'tok-color-sand-100']);
    }

    const darkSurface = resolveDesignTokenValue(tokens, 'tok-sem-surface-canvas', 'theme-dark');
    expect(darkSurface.ok).toBe(true);
    if (darkSurface.ok) {
      expect(darkSurface.rawValue).toBe('#1D1F28');
      expect(darkSurface.chain).toEqual(['tok-sem-surface-canvas', 'tok-color-ink-900']);
    }

    const cssDark = generateDesignTokensCss(tokens, 'theme-dark');
    expect(cssDark).toContain(':root[data-theme="dark"]');
    expect(cssDark).toContain('--surface-canvas: #1D1F28;');
  });

  it('rejects cyclic token aliases and cross-category type mismatches', () => {
    const cyclic: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 'a', name: 'color.a', layer: 'semantic', category: 'color', value: { kind: 'alias', tokenId: 'b' } },
        { id: 'b', name: 'color.b', layer: 'semantic', category: 'color', value: { kind: 'alias', tokenId: 'a' } },
      ],
    };
    const cyclicRes = resolveDesignTokenValue(cyclic, 'a');
    expect(cyclicRes.ok).toBe(false);
    if (!cyclicRes.ok) expect(cyclicRes.code).toBe('CYCLIC_ALIAS');
    expect(validateDesignTokenCollection(cyclic).ok).toBe(false);

    const mismatch: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 's', name: 'space.1', layer: 'primitive', category: 'spacing', value: { kind: 'literal', value: 8, unit: 'px' } },
        { id: 'c', name: 'color.bad', layer: 'semantic', category: 'color', value: { kind: 'alias', tokenId: 's' } },
      ],
    };
    const mismatchRes = resolveDesignTokenValue(mismatch, 'c');
    expect(mismatchRes.ok).toBe(false);
    if (!mismatchRes.ok) expect(mismatchRes.code).toBe('TYPE_MISMATCH');
    expect(validateDesignTokenCollection(mismatch).ok).toBe(false);
  });

  it('resolves node tokenBindings, scans usages, and unbinds atomically via tokens.update with Undo/Redo', () => {
    const project = createInitialProject();
    const tokens = project.designTokens ?? createDefaultDesignTokens();
    const page = getActivePage(project);
    const rectNode = page.document.nodes.find((n) => n.type === 'rect') ?? page.document.nodes[0];

    const store = createCanonicalEditorStore(createEditorState(project), { workspace: 'main' });
    const client = createMainCanvasCommandClient(store);

    const bindRes = client.replaceNode({
      ...rectNode,
      tokenBindings: { fill: 'tok-sem-accent-primary', radius: 'tok-radius-lg' },
    });
    expect(bindRes.status).toBe('applied');

    const boundNode = getActivePage(store.getSnapshot().editorState.project).document.nodes.find((n) => n.id === rectNode.id)!;
    const resolvedLight = resolveNodeWithTokens(boundNode, tokens, 'theme-light');
    const resolvedDark = resolveNodeWithTokens(boundNode, tokens, 'theme-dark');
    if (resolvedLight.type === 'rect' && resolvedDark.type === 'rect') {
      expect(resolvedLight.style.fill).toBe('#7C6CF6');
      expect(resolvedLight.style.radius).toBe(28);
      expect(resolvedDark.style.fill).toBe('#9B8CFF');
    }

    const usages = findTokenUsages(store.getSnapshot().editorState.project, 'tok-sem-accent-primary');
    expect(usages.some((u) => u.scope === 'page' && u.targetId === rectNode.id && u.property === 'fill')).toBe(true);

    // Delete token and unbind across project in one Native Command
    const prunedTokens: DesignTokenCollection = {
      ...tokens,
      tokens: tokens.tokens.filter((t) => t.id !== 'tok-sem-accent-primary'),
    };
    const delRes = client.updateDesignTokens(prunedTokens, ['tok-sem-accent-primary']);
    expect(delRes.status).toBe('applied');

    const afterDelete = getActivePage(store.getSnapshot().editorState.project).document.nodes.find((n) => n.id === rectNode.id)!;
    expect(afterDelete.tokenBindings?.fill).toBeUndefined();
    expect(afterDelete.tokenBindings?.radius).toBe('tok-radius-lg');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Undo restores both the token and the node binding
    expect(client.undo().status).toBe('applied');
    const afterUndo = getActivePage(store.getSnapshot().editorState.project).document.nodes.find((n) => n.id === rectNode.id)!;
    expect(afterUndo.tokenBindings?.fill).toBe('tok-sem-accent-primary');
  });
});

describe('Component Contract — Variants & Slots', () => {
  function buildButtonMaster(): { component: ComponentDefinition; bgId: string; labelId: string } {
    const bg = {
      ...createRectNode(0),
      id: 'btn-bg',
      name: 'Background',
      x: 0,
      y: 0,
      width: 160,
      height: 44,
      style: { fill: '#7C6CF6', stroke: '#00000000', strokeWidth: 0, radius: 10 },
    };
    const label = {
      ...createTextNode(0),
      id: 'btn-label',
      name: 'Label',
      x: 24,
      y: 12,
      width: 112,
      height: 20,
      text: 'Continue',
    };
    const comp = buildComponentDefinitionFromNodes([bg, label], ['btn-bg', 'btn-label'], 'Button', {
      id: 'comp-btn',
      now: '2026-01-01T00:00:00.000Z',
    })!;

    const toneAxis = createComponentVariantAxis('Tone', {
      id: 'axis-tone',
      optionLabels: ['Primary', 'Danger'],
    });
    toneAxis.options[1].overrides['btn-bg'] = { fill: '#E0485A' };
    toneAxis.options[1].overrides['btn-label'] = { text: 'Delete Item' };

    const labelSlot = createComponentSlot('Label', 'btn-label', {
      id: 'slot-label',
      defaultText: 'Continue',
    });
    return {
      component: { ...comp, variants: [toneAxis], slots: [labelSlot] },
      bgId: 'btn-bg',
      labelId: 'btn-label',
    };
  }

  it('applies deterministic resolution precedence: Master -> Variants -> Slots -> Local Overrides -> Tokens', () => {
    const { component, bgId, labelId } = buildButtonMaster();
    const dangerOptionId = component.variants![0].options[1].id;
    const baseInstance = createComponentInstance(component, 100, 100);

    // 1. Default variant
    const defaultResolved = resolveComponentInstanceNodes(baseInstance, component);
    const defaultBg = defaultResolved.find((n) => n.id === bgId)!;
    const defaultLabel = defaultResolved.find((n) => n.id === labelId)!;
    expect(defaultBg.type === 'rect' && defaultBg.style.fill).toBe('#7C6CF6');
    expect(defaultLabel.type === 'text' && defaultLabel.text).toBe('Continue');

    // 2. Danger variant overrides background + label text
    const dangerInstance = {
      ...baseInstance,
      variantSelection: { 'axis-tone': dangerOptionId },
    };
    const dangerResolved = resolveComponentInstanceNodes(dangerInstance, component);
    const dangerBg = dangerResolved.find((n) => n.id === bgId)!;
    const dangerLabel = dangerResolved.find((n) => n.id === labelId)!;
    expect(dangerBg.type === 'rect' && dangerBg.style.fill).toBe('#E0485A');
    expect(dangerLabel.type === 'text' && dangerLabel.text).toBe('Delete Item');

    // 3. Slot assignment overrides variant text
    const slottedInstance = {
      ...dangerInstance,
      slotAssignments: { 'slot-label': { text: 'Remove Account' } },
    };
    const slottedResolved = resolveComponentInstanceNodes(slottedInstance, component);
    const slottedLabel = slottedResolved.find((n) => n.id === labelId)!;
    expect(slottedLabel.type === 'text' && slottedLabel.text).toBe('Remove Account');

    // 4. Local instance override takes final precedence over slot
    const overriddenInstance = {
      ...slottedInstance,
      overrides: { [labelId]: { text: 'Custom Final' } },
    };
    const finalResolved = resolveComponentInstanceNodes(overriddenInstance, component);
    const finalLabel = finalResolved.find((n) => n.id === labelId)!;
    expect(finalLabel.type === 'text' && finalLabel.text).toBe('Custom Final');

    // 5. Detach bakes active variant + slot + local overrides cleanly
    const detached = detachComponentInstance(slottedInstance, component);
    expect(detached.find((n) => n.type === 'rect' && n.style.fill === '#E0485A')).toBeTruthy();
    expect(detached.find((n) => n.type === 'text' && n.text === 'Remove Account')).toBeTruthy();
  });

  it('prunes orphaned variant overrides and slots when a master node is removed and validates contract via Native Command Engine', () => {
    const { component, bgId, labelId } = buildButtonMaster();

    // Prune when label node is deleted
    const prunedDoc = {
      ...component.document,
      nodes: component.document.nodes.filter((n) => n.id !== labelId),
    };
    const pruned = pruneComponentContractForDocument(component, prunedDoc);
    expect(pruned.slots).toEqual([]);
    expect(pruned.variants![0].options[1].overrides[labelId]).toBeUndefined();
    expect(pruned.variants![0].options[1].overrides[bgId]?.fill).toBe('#E0485A');

    // Native Command Engine: component.update-contract + CAS guard + Undo
    const project = createInitialProject();
    const store = createCanonicalEditorStore(createEditorState(project), { workspace: 'main' });
    const client = createMainCanvasCommandClient(store);

    const plainComp: ComponentDefinition = {
      ...component,
      variants: [],
      slots: [],
    };
    expect(client.createComponent(plainComp).status).toBe('applied');

    // Invalid slot referencing unknown master node is rejected by validation
    const invalidRes = client.updateComponentContract({
      componentId: plainComp.id,
      slots: [createComponentSlot('Broken', 'does-not-exist', { id: 'slot-bad', defaultText: 'Nope' })],
      expectedUpdatedAt: plainComp.updatedAt,
      expectedMasterDocument: plainComp.document,
    });
    expect(invalidRes.status).toBe('rejected');

    // Valid contract update succeeds
    const validRes = client.updateComponentContract({
      componentId: plainComp.id,
      variants: component.variants,
      slots: component.slots,
      expectedUpdatedAt: plainComp.updatedAt,
      expectedMasterDocument: plainComp.document,
    });
    expect(validRes.status).toBe('applied');

    const updatedComp = store.getSnapshot().editorState.project.components.find((c) => c.id === plainComp.id)!;
    expect(updatedComp.variants?.length).toBe(1);
    expect(updatedComp.slots?.length).toBe(1);
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Stale CAS expectedUpdatedAt fails with COMPONENT_CONFLICT
    const conflictRes = client.updateComponentContract({
      componentId: plainComp.id,
      slots: [],
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
      expectedMasterDocument: updatedComp.document,
    });
    expect(conflictRes.status).toBe('rejected');
    if (conflictRes.status === 'rejected') {
      expect(conflictRes.code).toBe('COMPONENT_CONFLICT');
    }

    // Undo restores previous contract cleanly
    expect(client.undo().status).toBe('applied');
    const undoneComp = store.getSnapshot().editorState.project.components.find((c) => c.id === plainComp.id)!;
    expect(undoneComp.variants).toEqual([]);
    expect(undoneComp.slots).toEqual([]);
  });
});

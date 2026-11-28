import { describe, expect, it } from 'vitest';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { ComponentDefinition, DesignTokenCollection, GroupNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  createDefaultDesignTokens,
  findTokenUsages,
  generateDesignTokensCss,
  isSafeCssColorValue,
  resolveDesignTokenValue,
  resolveNodeWithTokens,
  validateDesignTokenCollection,
  validateNodeTokenBindings,
} from '../src/core/document/tokens';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentSlot,
  createComponentVariantAxis,
  detachComponentInstance,
  pruneComponentContractForDocument,
  resolveComponentDefaultNodes,
  resolveComponentInstanceNodes,
} from '../src/core/document/components';
import { buildLivePreviewHtml, compileFolioProject } from '../src/engines/codegen';
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

  it('hardens CSS color safety, numeric bounds, orphan theme keys, and duplicate CSS variable/theme slugs', () => {
    // Safe color values
    expect(isSafeCssColorValue('#7C6CF6')).toBe(true);
    expect(isSafeCssColorValue('#fff')).toBe(true);
    expect(isSafeCssColorValue('rgba(124, 108, 246, 0.5)')).toBe(true);
    expect(isSafeCssColorValue('oklch(0.65 0.18 275)')).toBe(true);
    expect(isSafeCssColorValue('color-mix(in srgb, #7c6cf6 60%, white)')).toBe(true);
    expect(isSafeCssColorValue('transparent')).toBe(true);

    // Unsafe / injection payloads rejected
    expect(isSafeCssColorValue('#fff; } body { background: red }')).toBe(false);
    expect(isSafeCssColorValue('url(javascript:alert(1))')).toBe(false);
    expect(isSafeCssColorValue('expression(alert(1))')).toBe(false);
    expect(isSafeCssColorValue('#fff\ncolor: red')).toBe(false);
    expect(isSafeCssColorValue('rgba(0,0,0,0.5) /* comment */')).toBe(false);
    expect(isSafeCssColorValue('rgb(0,0,0))')).toBe(false);

    const injectedCollection: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        {
          id: 'c-bad',
          name: 'color.bad',
          layer: 'primitive',
          category: 'color',
          value: { kind: 'literal', value: '#fff; } body { display: none }' },
        },
      ],
    };
    expect(validateDesignTokenCollection(injectedCollection).ok).toBe(false);

    // Negative spacing & non-positive typography rejected
    const negSpacing: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 'sp-neg', name: 'space.neg', layer: 'primitive', category: 'spacing', value: { kind: 'literal', value: -4, unit: 'px' } },
      ],
    };
    expect(validateDesignTokenCollection(negSpacing).ok).toBe(false);

    const zeroTypography: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 'ty-zero', name: 'type.zero', layer: 'primitive', category: 'typography', value: { kind: 'literal', value: 0, unit: 'px' } },
      ],
    };
    expect(validateDesignTokenCollection(zeroTypography).ok).toBe(false);

    // Orphan themeValues key rejected
    const orphanThemeKey: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        {
          id: 'c-1',
          name: 'color.brand',
          layer: 'primitive',
          category: 'color',
          value: { kind: 'literal', value: '#7C6CF6' },
          themeValues: { 'unknown-theme': { kind: 'literal', value: '#000000' } },
        },
      ],
    };
    expect(validateDesignTokenCollection(orphanThemeKey).ok).toBe(false);

    // Duplicate CSS variable names rejected
    const dupVarNames: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 'c-1', name: 'accent.primary', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#7C6CF6' } },
        { id: 'c-2', name: 'accent-primary', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#9B8CFF' } },
      ],
    };
    expect(validateDesignTokenCollection(dupVarNames).ok).toBe(false);

    // Duplicate theme slugs rejected
    const dupThemeSlug: DesignTokenCollection = {
      activeThemeId: 't1',
      themes: [
        { id: 't1', name: 'Dark Mode' },
        { id: 't2', name: 'dark-mode' },
      ],
      tokens: [
        { id: 'c-1', name: 'color.brand', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#7C6CF6' } },
      ],
    };
    expect(validateDesignTokenCollection(dupThemeSlug).ok).toBe(false);

    // Invalid base value rejected even if active theme overrides it
    const badBaseValue: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        {
          id: 'c-1',
          name: 'color.brand',
          layer: 'primitive',
          category: 'color',
          value: { kind: 'literal', value: 'url(javascript:alert(1))' },
          themeValues: { light: { kind: 'literal', value: '#7C6CF6' } },
        },
      ],
    };
    expect(validateDesignTokenCollection(badBaseValue).ok).toBe(false);

    // Defense-in-depth: even if an unvalidated collection reaches CSS/Live Preview generators directly,
    // malicious values are dropped and duplicate CSS variable names are deduplicated.
    const unsafeDirect: DesignTokenCollection = {
      activeThemeId: 'light',
      themes: [{ id: 'light', name: 'Light' }],
      tokens: [
        { id: 't1', name: 'brand.color', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#7C6CF6' } },
        { id: 't2', name: 'brand-color', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#111111' } },
        { id: 't3', name: 'evil.color', layer: 'primitive', category: 'color', value: { kind: 'literal', value: '#fff}</style><script>alert(1)</script>' } },
      ],
    };
    const rawCss = generateDesignTokensCss(unsafeDirect, 'light');
    expect(rawCss.match(/--brand-color:/g)?.length).toBe(1);
    expect(rawCss).not.toContain('--evil-color');
    expect(rawCss).not.toContain('<script>');

    const previewProject = createInitialProject('Safe Token Preview');
    previewProject.designTokens = unsafeDirect;
    const previewHtml = buildLivePreviewHtml(previewProject, { themeId: 'light' });
    expect(previewHtml).not.toContain('<script>alert(1)</script>');
    expect(previewHtml).not.toContain('--evil-color');
  });

  it('validates node tokenBindings in validateProject (dangling IDs, category mismatch, node-type mismatch) while keeping legacy projects valid', () => {
    const project = createInitialProject();
    const page = getActivePage(project);
    const rectNode = page.document.nodes.find((n) => n.type === 'rect')!;
    const textNode = page.document.nodes.find((n) => n.type === 'text')!;

    // 1. Dangling token ID rejected
    const danglingProject = structuredClone(project);
    danglingProject.pages[0].document.nodes.find((n) => n.id === rectNode.id)!.tokenBindings = {
      fill: 'tok-does-not-exist',
    };
    expect(validateProject(danglingProject).ok).toBe(false);

    // 2. Category mismatch rejected (fill bound to spacing token)
    const categoryMismatch = structuredClone(project);
    categoryMismatch.pages[0].document.nodes.find((n) => n.id === rectNode.id)!.tokenBindings = {
      fill: 'tok-space-md',
    };
    expect(validateProject(categoryMismatch).ok).toBe(false);

    // 3. Node-type mismatch rejected (fontSize bound to rect, radius bound to text)
    expect(
      validateNodeTokenBindings(
        { ...rectNode, tokenBindings: { fontSize: 'tok-type-body' } },
        project.designTokens,
      ).ok,
    ).toBe(false);
    expect(
      validateNodeTokenBindings(
        { ...textNode, tokenBindings: { radius: 'tok-radius-md' } },
        project.designTokens,
      ).ok,
    ).toBe(false);

    // 4. Component master node dangling binding is also caught by validateProject
    const master = buildComponentDefinitionFromNodes(
      [{ ...rectNode, id: 'm-bg', tokenBindings: { fill: 'tok-missing' } }],
      ['m-bg'],
      'Broken Master',
    )!;
    const brokenMasterProject = structuredClone(project);
    brokenMasterProject.components.push(master);
    expect(validateProject(brokenMasterProject).ok).toBe(false);

    // 5. Legacy project without designTokens and without tokenBindings remains valid
    const legacyProject = structuredClone(project);
    delete legacyProject.designTokens;
    expect(validateProject(legacyProject).ok).toBe(true);
  });

  it('resolves node tokenBindings, scans usages, and unbinds atomically via tokens.update with Undo/Redo (even when unbindTokenIds is omitted)', () => {
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

    // Delete token WITHOUT passing explicit unbindTokenIds — reducer derives removed IDs automatically
    const prunedTokens: DesignTokenCollection = {
      ...tokens,
      tokens: tokens.tokens.filter((t) => t.id !== 'tok-sem-accent-primary'),
    };
    const delRes = client.updateDesignTokens(prunedTokens);
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

  it('applies identical canonical precedence across Canvas, Component Preview, HTML/CSS, and React: Master -> Variants -> Slots -> Local Overrides -> Tokens', () => {
    const tokens = createDefaultDesignTokens();
    const darkTokens: DesignTokenCollection = { ...tokens, activeThemeId: 'theme-dark' };
    const { component: baseComp, bgId, labelId } = buildButtonMaster();

    // Add a token-bound badge node AND keep `bgId` unbound so we test BOTH:
    // - Unbound property cascade: Master -> Variants -> Slots -> Local Overrides
    // - Token-bound property: Tokens applied last (step 5) across all 4 engines
    const badgeId = 'btn-badge';
    const badge = {
      ...createRectNode(2),
      id: badgeId,
      name: 'Accent Badge',
      x: 136,
      y: 8,
      width: 14,
      height: 14,
      style: { fill: '#222222', stroke: '#00000000', strokeWidth: 0, radius: 4 },
      tokenBindings: { fill: 'tok-sem-accent-primary', radius: 'tok-radius-md' },
    };
    const bgSlot = createComponentSlot('Background', bgId, { id: 'slot-bg' });
    const badgeSlot = createComponentSlot('Badge', badgeId, { id: 'slot-badge' });

    const toneAxis = structuredClone(baseComp.variants![0]);
    toneAxis.options[0].overrides[labelId] = { text: 'Primary Action' };
    toneAxis.options[1].overrides[badgeId] = { fill: '#FF0000' };

    const component: ComponentDefinition = {
      ...baseComp,
      variants: [toneAxis],
      slots: [...(baseComp.slots ?? []), bgSlot, badgeSlot],
      document: {
        ...baseComp.document,
        nodes: [...baseComp.document.nodes, badge],
      },
    };
    const dangerOptionId = toneAxis.options[1].id;
    const baseInstance = createComponentInstance(component, 100, 100, 'inst-default');

    // 1. Component Preview (resolveComponentDefaultNodes) matches default Canvas instance:
    //    Master -> Default Variant -> Default Slot -> Tokens
    const previewLight = resolveComponentDefaultNodes(component, tokens);
    const previewDark = resolveComponentDefaultNodes(component, darkTokens);
    const canvasDefaultLight = resolveComponentInstanceNodes(baseInstance, component, tokens);
    expect(previewLight).toEqual(canvasDefaultLight);
    const previewLabel = previewLight.find((n) => n.id === labelId);
    expect(previewLabel?.type === 'text' ? previewLabel.text : null).toBe('Primary Action');
    const previewBadgeLight = previewLight.find((n) => n.id === badgeId)!;
    const previewBadgeDark = previewDark.find((n) => n.id === badgeId)!;
    expect(previewBadgeLight.type === 'rect' && previewBadgeLight.style.fill).toBe('#7C6CF6');
    expect(previewBadgeDark.type === 'rect' && previewBadgeDark.style.fill).toBe('#9B8CFF');

    // 2. Danger Variant overrides unbound bg (#E0485A) & label ('Delete Item'),
    //    while token-bound badge STILL resolves to active theme Design Token (step 5: Tokens last)
    const dangerInstance = {
      ...baseInstance,
      id: 'inst-danger',
      variantSelection: { 'axis-tone': dangerOptionId },
    };
    const dangerResolved = resolveComponentInstanceNodes(dangerInstance, component, darkTokens);
    const dangerBg = dangerResolved.find((n) => n.id === bgId)!;
    const dangerLabel = dangerResolved.find((n) => n.id === labelId)!;
    const dangerBadge = dangerResolved.find((n) => n.id === badgeId)!;
    expect(dangerBg.type === 'rect' && dangerBg.style.fill).toBe('#E0485A');
    expect(dangerLabel.type === 'text' && dangerLabel.text).toBe('Delete Item');
    expect(dangerBadge.type === 'rect' && dangerBadge.style.fill).toBe('#9B8CFF');
    expect(dangerBadge.tokenBindings?.fill).toBe('tok-sem-accent-primary');

    // 3. Slot assignment overrides Variant on unbound bg & label; token-bound badge still resolves to Token
    const slottedInstance = {
      ...dangerInstance,
      id: 'inst-slotted',
      slotAssignments: {
        'slot-label': { text: 'Remove Account' },
        'slot-bg': { fill: '#059669' },
        'slot-badge': { fill: '#10B981' },
      },
    };
    const slottedResolved = resolveComponentInstanceNodes(slottedInstance, component, tokens);
    const slottedBg = slottedResolved.find((n) => n.id === bgId);
    const slottedLabel = slottedResolved.find((n) => n.id === labelId);
    const slottedBadge = slottedResolved.find((n) => n.id === badgeId);
    expect(slottedBg?.type === 'rect' ? slottedBg.style.fill : null).toBe('#059669');
    expect(slottedLabel?.type === 'text' ? slottedLabel.text : null).toBe('Remove Account');
    expect(slottedBadge?.type === 'rect' ? slottedBadge.style.fill : null).toBe('#7C6CF6');

    // 4. Local Override beats Slot on unbound bg & label; token-bound badge still resolves to Token
    const overriddenInstance = {
      ...slottedInstance,
      id: 'inst-override',
      overrides: {
        [labelId]: { text: 'Custom Final' },
        [bgId]: { fill: '#F59E0B' },
        [badgeId]: { fill: '#000000' },
      },
    };
    const finalResolved = resolveComponentInstanceNodes(overriddenInstance, component, tokens);
    const finalBg = finalResolved.find((n) => n.id === bgId);
    const finalLabel = finalResolved.find((n) => n.id === labelId);
    const finalBadge = finalResolved.find((n) => n.id === badgeId);
    expect(finalBg?.type === 'rect' ? finalBg.style.fill : null).toBe('#F59E0B');
    expect(finalLabel?.type === 'text' ? finalLabel.text : null).toBe('Custom Final');
    expect(finalBadge?.type === 'rect' ? finalBadge.style.fill : null).toBe('#7C6CF6');

    // 5. Detach bakes active resolution cleanly
    const detached = detachComponentInstance(overriddenInstance, component, tokens);
    expect(detached.find((n) => n.type === 'rect' && n.style.fill === '#F59E0B')).toBeTruthy();
    expect(detached.find((n) => n.type === 'text' && n.text === 'Custom Final')).toBeTruthy();
    expect(detached.find((n) => n.type === 'rect' && n.style.fill === '#7C6CF6')).toBeTruthy();

    // 6. HTML/CSS & React Compilers match Canvas precedence identically:
    //    - Unbound `bg` gets Variant (#E0485A) / Slot (#059669) / Local Override (#F59E0B)
    //    - Token-bound `badge` keeps `background: var(--accent-primary)` and `border-radius: var(--radius-md)`
    //      without being overridden by variant CSS or inline fill style!
    const project = createInitialProject('Precedence Parity');
    project.designTokens = tokens;
    project.components = [component];
    const page = getActivePage(project);
    page.document.nodes = [baseInstance, dangerInstance, overriddenInstance];
    expect(validateProject(project).ok).toBe(true);

    const htmlCompiled = compileFolioProject(project, { target: 'html-css' });
    const htmlCss = htmlCompiled.files.find((f) => f.path === 'styles/index.css')?.content ?? '';
    expect(htmlCss).toContain('background: #E0485A;');
    expect(htmlCss).toContain('background: #F59E0B;');
    expect(htmlCss).toContain('background: var(--accent-primary);');
    expect(htmlCss).toContain('border-radius: var(--radius-md);');
    expect(htmlCss).not.toContain('background: #FF0000;');
    expect(htmlCss).not.toContain('background: #000000;');

    const reactCompiled = compileFolioProject(project, { target: 'react' });
    const compCss = reactCompiled.files.find((f) => f.path === 'src/components/Button.css')?.content ?? '';
    const compTsx = reactCompiled.files.find((f) => f.path === 'src/components/Button.tsx')?.content ?? '';
    expect(compCss).toContain('background: var(--accent-primary);');
    expect(compCss).toContain('background: #E0485A;');
    expect(compCss).not.toContain('background: #FF0000;');
    expect(compTsx).toContain('Master -> Variants -> Slots -> Local Overrides -> Tokens');
    // Badge element must NOT have inline background override since fill is token-bound
    const badgeLine = compTsx.split('\n').find((line) => line.includes(`data-folio-id="${badgeId}"`)) ?? '';
    expect(badgeLine).not.toContain('background:');
  });

  it('rejects invalid variantSelection, invalid/incompatible slotAssignments, and invalid/incompatible overrides in validateProject', () => {
    const { component, bgId, labelId } = buildButtonMaster();
    const groupNode: GroupNode = {
      id: 'btn-group',
      type: 'group',
      name: 'Wrapper Group',
      x: 0,
      y: 0,
      width: 160,
      height: 44,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    const groupSlot = createComponentSlot('Wrapper', groupNode.id, { id: 'slot-group' });
    const bgSlot = createComponentSlot('Background', bgId, { id: 'slot-bg' });
    const richComponent: ComponentDefinition = {
      ...component,
      slots: [...(component.slots ?? []), bgSlot, groupSlot],
      document: {
        ...component.document,
        nodes: [...component.document.nodes, groupNode],
      },
    };

    const makeProjectWithInstance = (mutateInstance: (inst: ReturnType<typeof createComponentInstance>) => void) => {
      const project = createInitialProject('Contract Validation');
      project.components = [richComponent];
      const inst = createComponentInstance(richComponent, 20, 20, 'inst-check');
      mutateInstance(inst);
      getActivePage(project).document.nodes = [inst];
      return project;
    };

    // Baseline valid
    expect(validateProject(makeProjectWithInstance(() => {})).ok).toBe(true);

    // 1. Unknown variant axis rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.variantSelection = { 'axis-nonexistent': 'opt-1' };
      })).ok,
    ).toBe(false);

    // 2. Unknown variant option rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.variantSelection = { 'axis-tone': 'opt-does-not-exist' };
      })).ok,
    ).toBe(false);

    // 3. Unknown slot ID rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.slotAssignments = { 'slot-missing': { visible: false } };
      })).ok,
    ).toBe(false);

    // 4. Slot text assigned to non-text rect target rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.slotAssignments = { 'slot-bg': { text: 'Not allowed on rect' } };
      })).ok,
    ).toBe(false);

    // 5. Slot fill assigned to group target rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.slotAssignments = { 'slot-group': { fill: '#123456' } };
      })).ok,
    ).toBe(false);

    // 6. Direct override text on rect rejected; fill on group rejected; missing master node rejected
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.overrides = { [bgId]: { text: 'Invalid on rect' } };
      })).ok,
    ).toBe(false);
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.overrides = { [groupNode.id]: { fill: '#123456' } };
      })).ok,
    ).toBe(false);
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.overrides = { 'missing-node': { fill: '#123456' } };
      })).ok,
    ).toBe(false);

    // 7. Master definition itself cannot have defaultText on rect or text override on rect
    const badSlotMaster = structuredClone(makeProjectWithInstance(() => {}));
    badSlotMaster.components[0].slots = [createComponentSlot('Bad Rect Slot', bgId, { id: 's-bad', defaultText: 'Nope' })];
    expect(validateProject(badSlotMaster).ok).toBe(false);

    const badVariantMaster = structuredClone(makeProjectWithInstance(() => {}));
    badVariantMaster.components[0].variants![0].options[1].overrides[bgId] = { text: 'Nope' };
    expect(validateProject(badVariantMaster).ok).toBe(false);

    // Valid label text override still passes
    expect(
      validateProject(makeProjectWithInstance((inst) => {
        inst.overrides = { [labelId]: { text: 'Valid Label', fill: '#FFFFFF' } };
      })).ok,
    ).toBe(true);
  });

  it('prunes orphaned overrides, variantSelection, and slotAssignments atomically across all pages on master sync, contract update, and deletion with CAS & Undo/Redo', () => {
    const { component, bgId, labelId } = buildButtonMaster();

    // Pure pruneComponentContractForDocument check
    const prunedDoc = {
      ...component.document,
      nodes: component.document.nodes.filter((n) => n.id !== labelId),
    };
    const pruned = pruneComponentContractForDocument(component, prunedDoc);
    expect(pruned.slots).toEqual([]);
    expect(pruned.variants![0].options[1].overrides[labelId]).toBeUndefined();
    expect(pruned.variants![0].options[1].overrides[bgId]?.fill).toBe('#E0485A');

    // Full multi-page Native Command Engine workflow
    const project = createInitialProject('Contract Lifecycle');
    const page2 = {
      ...structuredClone(project.pages[0]),
      id: 'page-2',
      name: 'Second Page',
      route: '/second',
      document: { ...structuredClone(project.pages[0].document), id: 'doc-page-2', nodes: [] },
    };
    project.pages.push(page2);

    const store = createCanonicalEditorStore(createEditorState(project), { workspace: 'main' });
    const client = createMainCanvasCommandClient(store);

    expect(client.createComponent(component).status).toBe('applied');

    const dangerOptionId = component.variants![0].options[1].id;
    const inst1 = createComponentInstance(component, 20, 20, 'inst-p1');
    inst1.variantSelection = { 'axis-tone': dangerOptionId };
    inst1.slotAssignments = { 'slot-label': { text: 'Page 1 Label', visible: true } };
    inst1.overrides = { [labelId]: { text: 'P1 Override' }, [bgId]: { fill: '#112233' } };
    expect(client.createNodes([inst1]).status).toBe('applied');

    // Place a second instance on Page 2
    expect(client.setActivePage('page-2').status).toBe('applied');
    const inst2 = createComponentInstance(component, 40, 40, 'inst-p2');
    inst2.variantSelection = { 'axis-tone': dangerOptionId };
    inst2.slotAssignments = { 'slot-label': { text: 'Page 2 Label' } };
    inst2.overrides = { [labelId]: { text: 'P2 Override' } };
    expect(client.createNodes([inst2]).status).toBe('applied');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // 1. Invalid slot referencing unknown master node or incompatible defaultText is rejected
    const currentMaster1 = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const invalidRes = client.updateComponentContract({
      componentId: currentMaster1.id,
      slots: [createComponentSlot('Broken', 'does-not-exist', { id: 'slot-bad', defaultText: 'Nope' })],
      expectedUpdatedAt: currentMaster1.updatedAt,
      expectedMasterDocument: currentMaster1.document,
    });
    expect(invalidRes.status).toBe('rejected');

    const incompatibleRes = client.updateComponentContract({
      componentId: currentMaster1.id,
      slots: [createComponentSlot('Bad Rect', bgId, { id: 'slot-bad-rect', defaultText: 'Nope' })],
      expectedUpdatedAt: currentMaster1.updatedAt,
      expectedMasterDocument: currentMaster1.document,
    });
    expect(incompatibleRes.status).toBe('rejected');

    // 2. Remove Danger option & remove slot-label via updateComponentContract ->
    //    BOTH pages' instances are atomically pruned (variantSelection falls back to default, slotAssignments removed)!
    const reducedAxis = {
      ...currentMaster1.variants![0],
      options: [currentMaster1.variants![0].options[0]],
    };
    const updateContractRes = client.updateComponentContract({
      componentId: currentMaster1.id,
      variants: [reducedAxis],
      slots: [],
      expectedUpdatedAt: currentMaster1.updatedAt,
      expectedMasterDocument: currentMaster1.document,
    });
    expect(updateContractRes.status).toBe('applied');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    const p1InstAfterContract = store.getSnapshot().editorState.project.pages[0].document.nodes.find((n) => n.id === 'inst-p1')!;
    const p2InstAfterContract = store.getSnapshot().editorState.project.pages[1].document.nodes.find((n) => n.id === 'inst-p2')!;
    if (p1InstAfterContract.type === 'component-instance' && p2InstAfterContract.type === 'component-instance') {
      expect(p1InstAfterContract.variantSelection?.['axis-tone']).toBe(reducedAxis.defaultOptionId);
      expect(p2InstAfterContract.variantSelection?.['axis-tone']).toBe(reducedAxis.defaultOptionId);
      expect(p1InstAfterContract.slotAssignments).toBeUndefined();
      expect(p2InstAfterContract.slotAssignments).toBeUndefined();
    }

    // Stale CAS expectedUpdatedAt fails with COMPONENT_CONFLICT
    const currentMaster2 = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const conflictRes = client.updateComponentContract({
      componentId: currentMaster2.id,
      variants: [],
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
      expectedMasterDocument: currentMaster2.document,
    });
    expect(conflictRes.status).toBe('rejected');
    if (conflictRes.status === 'rejected') {
      expect(conflictRes.code).toBe('COMPONENT_CONFLICT');
    }

    // Undo restores previous contract AND both pages' variantSelection + slotAssignments atomically!
    expect(client.undo().status).toBe('applied');
    const p1InstUndone = store.getSnapshot().editorState.project.pages[0].document.nodes.find((n) => n.id === 'inst-p1')!;
    if (p1InstUndone.type === 'component-instance') {
      expect(p1InstUndone.variantSelection?.['axis-tone']).toBe(dangerOptionId);
      expect(p1InstUndone.slotAssignments?.['slot-label']?.text).toBe('Page 1 Label');
    }

    // 3. Delete master label node via syncComponentDocument ->
    //    atomically prunes master slot + variant label override + page instances' overrides AND slotAssignments!
    const currentMaster3 = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const syncRes = client.syncComponentDocument({
      componentId: currentMaster3.id,
      document: {
        ...currentMaster3.document,
        nodes: currentMaster3.document.nodes.filter((n) => n.id !== labelId),
      },
      updatedAt: '2026-02-01T00:00:00.000Z',
      expectedUpdatedAt: currentMaster3.updatedAt,
      expectedMasterDocument: currentMaster3.document,
    });
    expect(syncRes.status).toBe('applied');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    const p1InstAfterSync = store.getSnapshot().editorState.project.pages[0].document.nodes.find((n) => n.id === 'inst-p1')!;
    if (p1InstAfterSync.type === 'component-instance') {
      expect(p1InstAfterSync.overrides[labelId]).toBeUndefined();
      expect(p1InstAfterSync.overrides[bgId]).toEqual({ fill: '#112233' });
      expect(p1InstAfterSync.slotAssignments).toBeUndefined();
    }

    // 4. Delete Master Component -> detaches instances across all pages, leaving zero orphan references
    const currentMaster4 = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const delRes = client.deleteComponent({
      componentId: currentMaster4.id,
      expectedUpdatedAt: currentMaster4.updatedAt,
      expectedMasterDocument: currentMaster4.document,
    });
    expect(delRes.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.components).toHaveLength(0);
    expect(
      store.getSnapshot().editorState.project.pages.every((p) =>
        p.document.nodes.every((n) => n.type !== 'component-instance'),
      ),
    ).toBe(true);
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);
  });
});


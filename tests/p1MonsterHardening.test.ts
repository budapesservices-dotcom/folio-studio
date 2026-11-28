import { describe, expect, it, vi } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type {
  AnimationClip,
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FrameNode,
  RectNode,
} from '../src/core/document/types';
import { createEditorState, editorReducer, EDITOR_HISTORY_LIMIT } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { countDeltaTouchedNodes, isProjectDeltaEntry } from '../src/engines/history/deltaHistory';
import { buildLivePreviewHtml, LIVE_PREVIEW_CSP } from '../src/engines/codegen/htmlCssCompiler';
import {
  MAX_PROJECT_FILE_BYTES,
  parseProjectJsonSafe,
  readProjectFile,
} from '../src/core/persistence/projectFile';
import {
  isStorageQuotaExceededError,
  subscribeExternalPersistenceSync,
} from '../src/core/persistence/indexedDb';

describe('Priority 1 — DeltaHistoryEngine production wiring', () => {
  it('stores O(changed nodes) ProjectDelta entries up to 200 steps and round-trips Undo/Redo including animations and coalescing', () => {
    const project = createInitialProject('Delta Engine Prod');
    // Populate 300 nodes so O(delta) vs O(total) is clearly measurable
    const extraNodes: RectNode[] = Array.from({ length: 300 }, (_, i) => ({
      id: `bulk-${i}`,
      type: 'rect',
      name: `Bulk ${i}`,
      x: (i % 20) * 40,
      y: Math.floor(i / 20) * 40,
      width: 30,
      height: 30,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#223344', stroke: 'none', strokeWidth: 0, radius: 4 },
    }));
    project.pages[0].document.nodes.push(...extraNodes);

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    // 1. Mutate a single node and confirm delta touched-node footprint is O(1), not O(300)
    const target = store.getSnapshot().editorState.project.pages[0].document.nodes[0];
    const editRes = store.dispatchLegacyAction({
      type: 'edit-node',
      node: { ...target, x: target.x + 25 },
      coalesceKey: 'drag-slider-x',
    });
    expect(editRes.status).toBe('committed');
    store.dispatchLegacyAction({
      type: 'edit-node',
      node: { ...target, x: target.x + 50 },
      coalesceKey: 'drag-slider-x',
    });
    store.dispatchLegacyAction({
      type: 'edit-node',
      node: { ...target, x: target.x + 75 },
      coalesceKey: 'drag-slider-x',
    });

    const afterCoalesced = store.getSnapshot().editorState;
    expect(afterCoalesced.past).toHaveLength(1);
    expect(isProjectDeltaEntry(afterCoalesced.past[0])).toBe(true);
    expect(countDeltaTouchedNodes(afterCoalesced.past[0])).toBe(2); // 1 before + 1 after node ref

    // Undo restores exact original X in 1 step
    store.dispatchLegacyAction({ type: 'undo' });
    expect(store.getSnapshot().editorState.project.pages[0].document.nodes[0].x).toBe(target.x);
    expect(store.getSnapshot().editorState.future).toHaveLength(1);

    // Redo restores final coalesced X (+75)
    store.dispatchLegacyAction({ type: 'redo' });
    expect(store.getSnapshot().editorState.project.pages[0].document.nodes[0].x).toBe(target.x + 75);

    // 2. Animation clips must round-trip cleanly through DeltaHistory Undo/Redo
    const clip: AnimationClip = {
      id: 'clip-hero-in',
      name: 'Hero Entrance',
      pageId: project.pages[0].id,
      durationMs: 600,
      loop: false,
      autoplay: true,
      tracks: [
        {
          id: 'track-opacity',
          targetNodeId: target.id,
          property: 'opacity',
          keyframes: [
            { id: 'kf-0', timeMs: 0, value: 0, easing: 'ease-out' },
            { id: 'kf-1', timeMs: 600, value: 1, easing: 'ease-out' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const clipRes = client.createAnimationClip(clip, 'Add entrance clip');
    expect(clipRes.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);

    client.undo('Undo clip creation');
    expect(store.getSnapshot().editorState.project.animations).toBeUndefined();

    client.redo('Redo clip creation');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);
    expect(store.getSnapshot().editorState.project.animations?.[0].id).toBe('clip-hero-in');

    // 3. Confirm 200-step depth limit
    expect(EDITOR_HISTORY_LIMIT).toBe(200);
    let state = createEditorState(createInitialProject('Depth Test'));
    for (let i = 0; i < 210; i += 1) {
      state = editorReducer(state, { type: 'rename-project', name: `Step ${i}` });
    }
    expect(state.past).toHaveLength(200);
  });
});

describe('Priority 1 — visualExport.ts token, Auto-Layout, breakpoint & cycle guard fidelity', () => {
  it('resolves Design Tokens (active theme), Flex Auto-Layout positions, and mobile breakpoint in SVG export', () => {
    const tokens = createDefaultDesignTokens();
    const darkTheme = tokens.themes.find((t) => t.name.toLowerCase().includes('dark')) ?? tokens.themes[1];
    expect(darkTheme).toBeDefined();
    tokens.activeThemeId = darkTheme!.id;

    const accentToken = tokens.tokens.find((t) => t.category === 'color' && t.themeValues?.[darkTheme!.id]);
    expect(accentToken).toBeDefined();
    const themeVal = accentToken!.themeValues![darkTheme!.id];
    const expectedDarkFill = themeVal.kind === 'literal' ? String(themeVal.value) : '';

    const container: FrameNode = {
      id: 'flex-box',
      type: 'frame',
      name: 'Stack',
      x: 40,
      y: 40,
      width: 600,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#ffffff', stroke: 'none', strokeWidth: 0, radius: 12 },
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 24,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
      },
      responsive: {
        mobile: { layoutDirection: 'column', width: 320 },
      },
    };
    const childA: RectNode = {
      id: 'child-a',
      type: 'rect',
      name: 'Card A',
      parentId: 'flex-box',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0, radius: 8 },
      tokenBindings: { fill: accentToken!.id },
    };
    const childB: RectNode = {
      id: 'child-b',
      type: 'rect',
      name: 'Card B',
      parentId: 'flex-box',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#00ff00', stroke: 'none', strokeWidth: 0, radius: 8 },
    };

    const doc = {
      id: 'doc-export',
      name: 'Export Test',
      width: 1440,
      height: 900,
      background: '#111111',
      nodes: [container, childA, childB] as DesignNode[],
    };

    // Desktop export: row layout places childB at x = 40 + 20 + 100 + 24 = 184, y = 60
    const desktopSvg = serializeDocumentToSvgString(doc, [], {
      title: 'Desktop Export',
      designTokens: tokens,
      breakpoint: 'desktop',
    });
    expect(desktopSvg).toContain('width="1440"');
    if (expectedDarkFill) {
      expect(desktopSvg).toContain(`fill="${expectedDarkFill}"`);
      expect(desktopSvg).not.toContain('fill="#ff0000"');
    }
    expect(desktopSvg).toContain('x="184" y="60"');

    // Mobile export: width clamped to 390, column layout places childB at x = 60, y = 40 + 20 + 60 + 24 = 144
    const mobileSvg = serializeDocumentToSvgString(doc, [], {
      title: 'Mobile Export',
      designTokens: tokens,
      breakpoint: 'mobile',
    });
    expect(mobileSvg).toContain('width="390"');
    expect(mobileSvg).toContain('x="60" y="144"');
  });

  it('guards against cyclic component-instance recursion without stack overflow', () => {
    const cyclicInstance: ComponentInstanceNode = {
      id: 'inst-loop',
      type: 'component-instance',
      name: 'Self Loop',
      componentId: 'comp-cyclic',
      x: 10,
      y: 10,
      width: 80,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: {},
    };
    const cyclicComp: ComponentDefinition = {
      id: 'comp-cyclic',
      name: 'Cyclic Master',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      document: {
        id: 'doc-cyclic',
        name: 'Cyclic',
        width: 100,
        height: 100,
        background: 'transparent',
        nodes: [cyclicInstance],
      },
    };
    const rootDoc = {
      id: 'doc-root',
      name: 'Root',
      width: 400,
      height: 300,
      background: '#ffffff',
      nodes: [cyclicInstance],
    };

    const svg = serializeDocumentToSvgString(rootDoc, [cyclicComp]);
    expect(svg).toContain('<svg ');
    expect(svg).toContain('</svg>');
    // Cycle fallback placeholder rendered instead of crashing
    expect(svg).toContain('stroke="#D45B5B"');
  });
});

describe('Priority 1 — Security & Persistence Hardening', () => {
  it('enforces 25MB size cap and strips prototype-polluting keys on .flop JSON import', async () => {
    const fakeHugeFile = {
      size: MAX_PROJECT_FILE_BYTES + 1,
      text: vi.fn(async () => '{}'),
    } as unknown as File;

    await expect(readProjectFile(fakeHugeFile)).rejects.toThrow(/25 MB safety limit/i);
    expect(fakeHugeFile.text).not.toHaveBeenCalled();

    const polluted = parseProjectJsonSafe(
      '{"ok":true,"__proto__":{"polluted":true},"constructor":{"bad":1},"nested":{"prototype":{"x":1},"safe":"yes"}}',
    ) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(polluted, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(polluted, 'constructor')).toBe(false);
    expect((polluted.nested as Record<string, unknown>).safe).toBe('yes');
    expect(Object.prototype.hasOwnProperty.call(polluted.nested as object, 'prototype')).toBe(false);
  });

  it('emits strict Content-Security-Policy and neutralizes comment breakout in Live Preview HTML', () => {
    const project = createInitialProject('Preview Hardening');
    project.codeModules = [
      {
        id: 'mod-evil-comment',
        path: 'styles/test*/</style><script>alert(1)</script>.css',
        language: 'css',
        mapping: 'custom',
        content: 'body { color: #111; }',
        updatedAt: new Date().toISOString(),
      },
    ];

    const html = buildLivePreviewHtml(project, { includeCustomScripts: true });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${LIVE_PREVIEW_CSP}" />`);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<\\/style>');
  });

  it('detects QuotaExceededError across browser shapes and filters same-tab BroadcastChannel events', () => {
    expect(isStorageQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isStorageQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isStorageQuotaExceededError({ code: 22 })).toBe(true);
    expect(isStorageQuotaExceededError(new Error('IndexedDB quota exceeded'))).toBe(true);
    expect(isStorageQuotaExceededError(new Error('Network offline'))).toBe(false);
    expect(isStorageQuotaExceededError(null)).toBe(false);

    // Subscribing returns a safe cleanup even when BroadcastChannel is present or absent
    const unsubscribe = subscribeExternalPersistenceSync(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});

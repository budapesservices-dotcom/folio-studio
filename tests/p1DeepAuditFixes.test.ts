import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { DesignNode, FolioProject, LogicFramePreset } from '../src/core/document/types';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { isSafeRegexPattern, safeRegexTest, sanitizeJsText } from '../src/engines/codegen/sanitize';
import { buildZipArchive, parseZipArchive } from '../src/engines/codegen/zipArchive';
import {
  applyProjectDelta,
  computeProjectDelta,
  createDeltaHistoryTimeline,
  isProjectDeltaEmpty,
  pushProjectDelta,
  redoProjectDelta,
  undoProjectDelta,
} from '../src/engines/history';
import { computeAutoLayoutNodes } from '../src/engines/layout/autoLayout';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
} from '../src/engines/prototype';

describe('P1 Deep Audit Fixes', () => {
  describe('1. Undo/Redo Coalescing & logicFramePresets Delta History', () => {
    it('eliminates ghost undo step when a coalesced edit returns to its baseline value in editorReducer and deltaHistory', () => {
      const project = createInitialProject('Coalesce Ghost Test');
      const target = project.pages[0].document.nodes[0];
      const origX = target.x;

      let state = createEditorState(project);
      state = editorReducer(state, {
        type: 'edit-node',
        node: { ...target, x: origX + 80 },
        coalesceKey: 'drag:node-0',
      });
      expect(state.past.length).toBe(1);
      expect(state.historyGroup).toBe('drag:node-0');

      // Drag back to the exact starting coordinate before mouseup
      state = editorReducer(state, {
        type: 'edit-node',
        node: { ...target, x: origX },
        coalesceKey: 'drag:node-0',
      });
      expect(state.past.length).toBe(0);
      expect(state.historyGroup).toBeNull();

      // Verify pushProjectDelta timeline directly as well
      let timeline = createDeltaHistoryTimeline(project);
      const moved: FolioProject = {
        ...project,
        pages: [
          {
            ...project.pages[0],
            document: {
              ...project.pages[0].document,
              nodes: project.pages[0].document.nodes.map((n, idx) =>
                idx === 0 ? { ...n, x: origX + 45 } : n,
              ),
            },
          },
        ],
      };
      const returned: FolioProject = {
        ...project,
        pages: [
          {
            ...project.pages[0],
            document: {
              ...project.pages[0].document,
              nodes: project.pages[0].document.nodes.map((n, idx) =>
                idx === 0 ? { ...n, x: origX } : n,
              ),
            },
          },
        ],
      };
      timeline = pushProjectDelta(timeline, moved, { coalesceKey: 'slider:x' });
      expect(timeline.past.length).toBe(1);
      timeline = pushProjectDelta(timeline, returned, { coalesceKey: 'slider:x' });
      expect(timeline.past.length).toBe(0);
      expect(timeline.activeCoalesceKey).toBeNull();
    });

    it('diffs and restores project.logicFramePresets cleanly across Undo/Redo', () => {
      const base = createInitialProject('Preset History Test');
      const presetA: LogicFramePreset = {
        id: 'preset-toggle-card',
        name: 'Toggle Card',
        description: 'Reusable toggle logic frame',
        color: '#7C6CF6',
        createdAt: '2026-11-25T00:00:00.000Z',
        frame: {
          id: 'frame-toggle-card',
          title: 'Toggle Card',
          color: '#7C6CF6',
          bounds: { x: 0, y: 0, width: 320, height: 200 },
          childNodeIds: ['n1'],
          isBaked: false,
        },
        nodes: [
          createLogicNode({ id: 'n1', type: 'event.on-click', data: { targetNodeId: 'btn' } }),
        ],
        connections: [],
      };
      const withPreset: FolioProject = {
        ...base,
        logicFramePresets: [presetA],
      };

      const delta = computeProjectDelta(base, withPreset);
      expect(isProjectDeltaEmpty(delta)).toBe(false);
      expect(delta.logicFramePresetsChanged).toBe(true);

      const undone = applyProjectDelta(withPreset, delta, 'backward');
      expect(undone.logicFramePresets).toBeUndefined();

      const redone = applyProjectDelta(undone, delta, 'forward');
      expect(redone.logicFramePresets).toEqual([presetA]);

      let timeline = createDeltaHistoryTimeline(base);
      timeline = pushProjectDelta(timeline, withPreset);
      expect(timeline.current.logicFramePresets).toHaveLength(1);
      timeline = undoProjectDelta(timeline);
      expect(timeline.current.logicFramePresets).toBeUndefined();
      timeline = redoProjectDelta(timeline);
      expect(timeline.current.logicFramePresets).toEqual([presetA]);
    });
  });

  describe('2. Auto-Layout Stability & CSS Grid Accuracy', () => {
    it('does not stack overflow when shifting a subtree containing a cyclic parentId', () => {
      const container: DesignNode = {
        ...createRectNode(0),
        id: 'flex-root',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        layout: {
          mode: 'flex',
          direction: 'column',
          gap: 12,
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
      };
      const childA: DesignNode = {
        ...createRectNode(1),
        id: 'cycle-a',
        parentId: 'flex-root',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
      };
      const childB: DesignNode = {
        ...createRectNode(2),
        id: 'cycle-b',
        parentId: 'cycle-a',
        x: 10,
        y: 10,
        width: 50,
        height: 20,
      };
      const childC: DesignNode = {
        ...createRectNode(3),
        id: 'cycle-c',
        parentId: 'cycle-b',
        x: 10,
        y: 10,
        width: 30,
        height: 20,
      };
      // Create a parentId cycle among descendants: cycle-a -> cycle-b -> cycle-c -> cycle-b
      const cyclicNodes: DesignNode[] = [
        container,
        childA,
        { ...childB, parentId: 'cycle-c' },
        childC,
        // Keep another child whose parentId points to cycle-b and cycle-b back to cycle-a via separate loop
        { ...createRectNode(4), id: 'direct-cycle', parentId: 'flex-root', x: 0, y: 0, width: 80, height: 40 },
      ];
      // Direct 2-node cycle under flex-root where childA's position shifts (x:0 -> 20, y:0 -> 20)
      const cyclicSubtree: DesignNode[] = [
        container,
        childA,
        { ...childB, parentId: 'cycle-a' },
        { ...childC, parentId: 'cycle-b' },
      ];
      // Inject cycle: childA -> childB -> childC -> childA
      cyclicSubtree[1] = { ...childA, parentId: 'flex-root' };
      const mutuallyCyclic: DesignNode[] = [
        container,
        { ...childA, parentId: 'flex-root' },
        { ...childB, parentId: 'cycle-a' },
        { ...childC, parentId: 'cycle-b' },
        { ...createRectNode(5), id: 'back-edge', parentId: 'cycle-c', x: 0, y: 0, width: 20, height: 20 },
      ];
      // Also test direct cycle where childB.parentId = cycle-a and cycle-a is listed in cycle-b
      expect(() => computeAutoLayoutNodes(cyclicNodes)).not.toThrow();
      expect(() => computeAutoLayoutNodes(mutuallyCyclic)).not.toThrow();

      // Explicit A <-> B cycle triggered when onlyContainerId forces solving
      const directLoopNodes: DesignNode[] = [
        { ...container, id: 'loop-a', parentId: 'loop-b' },
        { ...childA, id: 'loop-b', parentId: 'loop-a', x: 0, y: 0 },
      ];
      expect(() => computeAutoLayoutNodes(directLoopNodes, { onlyContainerId: 'loop-a' })).not.toThrow();
    });

    it('lays out more than 256 rows in a single-column CSS Grid without dropping items', () => {
      const gridContainer: DesignNode = {
        ...createRectNode(0),
        id: 'tall-grid',
        x: 0,
        y: 0,
        width: 320,
        height: 600,
        layout: {
          mode: 'grid',
          direction: 'row',
          gridColumnsMode: 'fixed',
          gridColumns: 1,
          gap: 10,
          columnGap: 10,
          rowGap: 10,
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
        },
      };
      const items: DesignNode[] = Array.from({ length: 280 }, (_, idx) => ({
        ...createRectNode(idx + 1),
        id: `grid-item-${idx}`,
        parentId: 'tall-grid',
        x: 0,
        y: 0,
        width: 300,
        height: 40,
      }));

      const solved = computeAutoLayoutNodes([gridContainer, ...items]);
      const item256 = solved.find((n) => n.id === 'grid-item-256')!;
      const item279 = solved.find((n) => n.id === 'grid-item-279')!;

      // Row i starts at paddingTop (10) + i * (40 + 10)
      expect(item256.y).toBe(10 + 256 * 50);
      expect(item279.y).toBe(10 + 279 * 50);
    });

    it('computes CSS Grid rowHeights after applying aspectRatio so tall cards never overlap the next row', () => {
      const gridContainer: DesignNode = {
        ...createRectNode(0),
        id: 'ratio-grid',
        x: 0,
        y: 0,
        width: 440,
        height: 600,
        layout: {
          mode: 'grid',
          direction: 'row',
          gridColumnsMode: 'fixed',
          gridColumns: 2,
          gap: 20,
          columnGap: 20,
          rowGap: 20,
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
        },
      };
      // innerWidth = 420, 2 cols with 20px gap -> each col = 200px wide.
      // Card 0 has initial height 50, but aspectRatio "1/2" => nextH = 200 / 0.5 = 400px!
      const card0: DesignNode = {
        ...createRectNode(1),
        id: 'card-0',
        parentId: 'ratio-grid',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed', aspectRatio: '1/2' },
      };
      const card1: DesignNode = {
        ...createRectNode(2),
        id: 'card-1',
        parentId: 'ratio-grid',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      };
      const card2Row1: DesignNode = {
        ...createRectNode(3),
        id: 'card-2',
        parentId: 'ratio-grid',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        layoutChild: { widthMode: 'fill', heightMode: 'fixed' },
      };

      const solved = computeAutoLayoutNodes([gridContainer, card0, card1, card2Row1]);
      const s0 = solved.find((n) => n.id === 'card-0')!;
      const s2 = solved.find((n) => n.id === 'card-2')!;

      expect(s0.width).toBe(200);
      expect(s0.height).toBe(400);
      // Row 1 must start at pad.top (10) + row0Height (400) + rowGap (20) = 430 (no overlap!)
      expect(s2.y).toBe(430);
    });
  });

  describe('3. Node Logic Security, ReDoS Guard, & React/Live Preview Parity', () => {
    it('escapes <!--, <script, </script, and line separators in sanitizeJsText while keeping JSON parseable', () => {
      const payload = { html: '<!-- <script>alert(1)</script>\u2028\u2029' };
      const sanitized = sanitizeJsText(JSON.stringify(payload));
      expect(sanitized).not.toContain('<!--');
      expect(sanitized).not.toMatch(/<script/i);
      expect(sanitized).not.toMatch(/<\/script/i);
      expect(sanitized).not.toContain('\u2028');
      expect(sanitized).not.toContain('\u2029');
      expect(JSON.parse(sanitized)).toEqual(payload);
    });

    it('blocks catastrophic backtracking regex patterns without freezing in safeRegexTest and PrototypeRuntime', () => {
      expect(isSafeRegexPattern('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$')).toBe(true);
      expect(safeRegexTest('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$', 'user@example.com')).toBe(true);

      expect(isSafeRegexPattern('(a+)+$')).toBe(false);
      expect(isSafeRegexPattern('([a-zA-Z]+)*$')).toBe(false);
      expect(isSafeRegexPattern('(a|aa)+$')).toBe(false);
      expect(isSafeRegexPattern('(\\w+)\\s+\\1')).toBe(false);

      const start = performance.now();
      expect(safeRegexTest('(a+)+$', `${'a'.repeat(50)}!`)).toBe(false);
      expect(performance.now() - start).toBeLessThan(50);

      // Verify PrototypeRuntime logic.condition regex mode also blocks ReDoS
      const project = createInitialProject('ReDoS Runtime Guard');
      const page = project.pages[0];
      const btn = page.document.nodes[0];
      const onClick = createLogicNode({ id: 'ev', type: 'event.on-click', data: { targetNodeId: btn.id } });
      const cond = createLogicNode({
        id: 'cond',
        type: 'logic.condition',
        data: { mode: 'regex', pattern: '(a+)+$', left: `${'a'.repeat(50)}!` },
      });
      const branch = createLogicNode({ id: 'br', type: 'logic.branch', data: { mode: 'if-else' } });
      const setText = createLogicNode({
        id: 'act-txt',
        type: 'action.set-layer',
        data: { targetMode: 'override', targetNodeId: btn.id, property: 'text', text: 'Matched' },
      });
      project.logicGraphs.push(
        createLogicGraph({
          id: 'g-redos',
          name: 'ReDoS Graph',
          scope: 'page',
          targetId: page.id,
          nodes: [onClick, cond, branch, setText],
          connections: [
            createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: branch.id, targetPortId: 'exec' }),
            createLogicConnection({ id: 'c2', sourceNodeId: cond.id, sourcePortId: 'result', targetNodeId: branch.id, targetPortId: 'condition' }),
            createLogicConnection({ id: 'c3', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: setText.id, targetPortId: 'exec' }),
          ],
        }),
      );
      const rt = createPrototypeRuntime(project);
      const t0 = performance.now();
      const next = rt.dispatchNodeEvent(btn.id, 'click');
      expect(performance.now() - t0).toBeLessThan(100);
      expect(next.nodeOverrides[btn.id]?.text).toBeUndefined();
    });

    it('fixes Open Redirect, safe DOM lookup, async flow.delay/flow.loop-timer parity in React export and timer cleanup in Live Preview', () => {
      const project = createInitialProject('Node Logic Parity Audit');
      const page = project.pages[0];
      const trickyNode: DesignNode = {
        ...createRectNode(99),
        id: 'node-"quoted"]-id',
        name: 'Tricky Trigger',
      };
      page.document.nodes.push(trickyNode);

      const evOutside = createLogicNode({
        id: 'ev-out',
        type: 'event.on-click',
        data: { targetNodeId: trickyNode.id, mode: 'click-outside' },
      });
      const evScroll = createLogicNode({
        id: 'ev-scroll',
        type: 'event.on-scroll-view',
        data: { targetNodeId: trickyNode.id, trigger: 'enter-view' },
      });
      const nav = createLogicNode({
        id: 'act-nav',
        type: 'action.navigate',
        data: { mode: 'internal', route: '//evil.example' },
      });
      const delay = createLogicNode({
        id: 'fl-delay',
        type: 'flow.delay',
        data: { duration: 250, unit: 'ms' },
      });
      const loopTimer = createLogicNode({
        id: 'fl-timer',
        type: 'flow.loop-timer',
        data: { mode: 'interval-start', timerId: 'poll', intervalMs: 500 },
      });
      project.logicGraphs.push(
        createLogicGraph({
          id: 'g-parity',
          name: 'Parity Graph',
          scope: 'page',
          targetId: page.id,
          nodes: [evOutside, evScroll, nav, delay, loopTimer],
          connections: [
            createLogicConnection({ id: 'p1', sourceNodeId: evOutside.id, sourcePortId: 'exec', targetNodeId: nav.id, targetPortId: 'exec' }),
            createLogicConnection({ id: 'p2', sourceNodeId: nav.id, sourcePortId: 'next', targetNodeId: delay.id, targetPortId: 'exec' }),
            createLogicConnection({ id: 'p3', sourceNodeId: delay.id, sourcePortId: 'next', targetNodeId: loopTimer.id, targetPortId: 'exec' }),
          ],
        }),
      );

      const reactFiles = compileReactProjectFiles(project);
      const pageTsx = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))?.content ?? '';

      // 1. Open Redirect guard blocks protocol-relative //evil.example
      expect(pageTsx).toContain('/^(?:https?:\\/\\/|mailto:|\\/(?!\\/)|#)/i');
      // 2. No raw querySelector interpolation for click-outside / scroll-view
      expect(pageTsx).not.toContain('document.querySelector(`[data-folio-id="${wid}"]`)');
      expect(pageTsx).toContain('findFolioEl(wid)');
      // 3. ReDoS guard emitted in React export
      expect(pageTsx).toContain('safeRegexTest');
      // 4. Async delay & interval timer parity + unmount cleanup
      expect(pageTsx).toContain('setTimeout(');
      expect(pageTsx).toContain('setInterval(');
      expect(pageTsx).toContain('clearInterval(');
      expect(pageTsx).toContain('clearTimeout(');

      // 5. Live Preview emits safeRegexTest and pagehide/unload cleanup
      const previewScript = buildLivePreviewLogicScript(project, page) ?? '';
      expect(previewScript).toContain('function safeRegexTest');
      expect(previewScript).toContain('window.addEventListener("pagehide", cleanupTimers)');
      expect(previewScript).toContain('window.addEventListener("unload", cleanupTimers)');
    });
  });

  describe('4. ZIP Archive Parser Bounds & Path Traversal Validation', () => {
    it('rejects path traversal entries and out-of-bounds headers without throwing RangeError', () => {
      const validBytes = buildZipArchive([
        { path: 'index.html', content: '<h1>Hello</h1>' },
      ]);
      const parsed = parseZipArchive(validBytes);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].path).toBe('index.html');

      // Tamper central directory filename from "index.html" (10 bytes) -> "../etc/pw0" (10 bytes)
      const traversalBytes = new Uint8Array(validBytes);
      const targetStr = new TextEncoder().encode('index.html');
      const maliciousStr = new TextEncoder().encode('../etc/pw0');
      // Find the second occurrence (in central directory)
      let matches = 0;
      for (let i = 0; i <= traversalBytes.length - targetStr.length; i += 1) {
        let eq = true;
        for (let k = 0; k < targetStr.length; k += 1) {
          if (traversalBytes[i + k] !== targetStr[k]) {
            eq = false;
            break;
          }
        }
        if (eq) {
          matches += 1;
          if (matches === 2) {
            traversalBytes.set(maliciousStr, i);
            break;
          }
        }
      }
      expect(matches).toBe(2);
      expect(() => parseZipArchive(traversalBytes)).toThrow(/Unsafe archive entry path/i);

      // Tamper EOCD centralOffset beyond buffer bounds -> must throw Error (not RangeError)
      const oobBytes = new Uint8Array(validBytes);
      const oobView = new DataView(oobBytes.buffer);
      oobView.setUint32(oobBytes.length - 6, 0x00ffffff, true);
      try {
        parseZipArchive(oobBytes);
        expect.unreachable('Should have rejected out-of-bounds central directory');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(RangeError);
        expect((err as Error).message).toMatch(/Invalid ZIP archive/i);
      }

      // Tamper local header offset to point past centralOffset -> must throw Error (not RangeError)
      const badLocalBytes = new Uint8Array(validBytes);
      const badLocalView = new DataView(badLocalBytes.buffer);
      const centralOffset = badLocalView.getUint32(badLocalBytes.length - 6, true);
      badLocalView.setUint32(centralOffset + 42, 0x00ffffff, true);
      try {
        parseZipArchive(badLocalBytes);
        expect.unreachable('Should have rejected out-of-bounds local header');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(RangeError);
        expect((err as Error).message).toMatch(/Invalid ZIP archive/i);
      }
    });
  });
});

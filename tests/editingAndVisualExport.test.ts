import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createInitialProject } from '../src/core/document/factory';
import type {
  ComponentDefinition,
  DesignNode,
  FrameNode,
  PathNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import {
  buildFrameClipAncestorMap,
  getLayerFrameClipAncestorIds,
} from '../src/core/document/layers';
import { convertShapeToPathNode, scalePathNodeGeometry, simplifyPathNode } from '../src/core/document/vector';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import {
  createVisualExportFilename,
  serializeDocumentToSvgString,
} from '../src/app/visualExport';

describe('editing bug fixes, Frame clipContent, atomic undo, and visual SVG export', () => {
  it('scales PathNode anchor coordinates and handles proportionally when W/H changes', () => {
    const rect: RectNode = {
      id: 'shape-1',
      type: 'rect',
      name: 'Box',
      x: 100,
      y: 100,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: '#111111', strokeWidth: 2, radius: 10 },
    };
    const path = convertShapeToPathNode(rect)!;
    const scaled = scalePathNodeGeometry(path, path.x, path.y, 200, 150);

    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(150);
    const maxAnchorX = Math.max(...scaled.points.map((pt) => pt.x));
    const maxAnchorY = Math.max(...scaled.points.map((pt) => pt.y));
    expect(maxAnchorX).toBeCloseTo(200, 1);
    expect(maxAnchorY).toBeCloseTo(150, 1);
  });

  it('reverts multi-node Convert to Vector Path and Simplify in ONE single atomic undo step', () => {
    const project = createInitialProject();
    const doc = project.pages[0].document;
    const r1: RectNode = {
      id: 'r1',
      type: 'rect',
      name: 'R1',
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: '#20212A', strokeWidth: 2 },
    };
    const r2: RectNode = {
      id: 'r2',
      type: 'rect',
      name: 'R2',
      x: 140,
      y: 20,
      width: 80,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#38BDF8', stroke: '#20212A', strokeWidth: 2 },
    };
    doc.nodes = [r1, r2];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const p1 = convertShapeToPathNode(r1)!;
    const p2 = convertShapeToPathNode(r2)!;

    // Single-shape rect -> path conversion must succeed (not rejected by node.replace type lock)
    const singleResult = client.replaceNodes(['r1'], [p1], 'Convert shape to vector path', ['r1']);
    expect(singleResult.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.pages[0].document.nodes[0].type).toBe('path');
    store.dispatchLegacyAction({ type: 'undo' });
    expect(store.getSnapshot().editorState.project.pages[0].document.nodes[0].type).toBe('rect');

    // Multi-shape rect -> path conversion reverts BOTH in 1 atomic undo
    const result = client.replaceNodes(['r1', 'r2'], [p1, p2], 'Convert shapes to vector paths', ['r1', 'r2']);
    expect(result.status).toBe('applied');

    const afterConvert = store.getSnapshot().editorState.project.pages[0].document.nodes;
    expect(afterConvert.map((n) => n.type)).toEqual(['path', 'path']);

    // One single undo restores BOTH rectangles!
    store.dispatchLegacyAction({ type: 'undo' });
    const afterUndo = store.getSnapshot().editorState.project.pages[0].document.nodes;
    expect(afterUndo.map((n) => n.type)).toEqual(['rect', 'rect']);

    // Multi-node opacity & style update through transform-nodes is not dropped as no-op and reverts in 1 undo
    const opacityResult = client.transformNodes([
      { ...r1, opacity: 0.4, style: { ...r1.style, fill: '#F43F5E' } },
      { ...r2, opacity: 0.5, style: { ...r2.style, fill: '#10B981' } },
    ]);
    expect(opacityResult.status).toBe('applied');
    const afterOpacity = store.getSnapshot().editorState.project.pages[0].document.nodes;
    expect(afterOpacity[0].opacity).toBe(0.4);
    expect((afterOpacity[0] as RectNode).style.fill).toBe('#F43F5E');

    store.dispatchLegacyAction({ type: 'undo' });
    const afterOpacityUndo = store.getSnapshot().editorState.project.pages[0].document.nodes;
    expect(afterOpacityUndo[0].opacity).toBe(1);
    expect((afterOpacityUndo[0] as RectNode).style.fill).toBe('#8B7CF6');

    // Simplify multiple paths atomically in reducer
    const densePath: PathNode = {
      id: 'dense-1',
      type: 'path',
      name: 'Dense',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: false,
      points: [
        { id: '1', x: 0, y: 0, pointType: 'corner' },
        { id: '2', x: 25, y: 0.2, pointType: 'corner' },
        { id: '3', x: 50, y: 0.1, pointType: 'corner' },
        { id: '4', x: 75, y: 0.2, pointType: 'corner' },
        { id: '5', x: 100, y: 0, pointType: 'corner' },
      ],
      style: { fill: 'none', stroke: '#fff', strokeWidth: 2 },
    };
    const state0 = createEditorState({ ...project, pages: [{ ...project.pages[0], document: { ...doc, nodes: [densePath] } }] });
    const simplified = simplifyPathNode(densePath, 2.5);
    const state1 = editorReducer(state0, { type: 'transform-nodes', nodes: [simplified] });
    expect((state1.project.pages[0].document.nodes[0] as PathNode).points.length).toBeLessThan(5);
    const stateUndo = editorReducer(state1, { type: 'undo' });
    expect((stateUndo.project.pages[0].document.nodes[0] as PathNode).points.length).toBe(5);
  });

  it('resolves Frame clipContent ancestors excluding the frame itself and respecting clipContent: false', () => {
    const outerFrame: FrameNode = {
      id: 'frame-outer',
      type: 'frame',
      name: 'Outer',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      clipContent: true,
      style: { fill: '#111', stroke: '#333', strokeWidth: 1, radius: 12 },
    };
    const innerUnclippedFrame: FrameNode = {
      id: 'frame-inner-open',
      type: 'frame',
      name: 'Inner Open',
      parentId: 'frame-outer',
      x: 20,
      y: 20,
      width: 200,
      height: 150,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      clipContent: false,
      style: { fill: '#222', stroke: '#444', strokeWidth: 1, radius: 0 },
    };
    const childRect: RectNode = {
      id: 'child-1',
      type: 'rect',
      name: 'Child',
      parentId: 'frame-inner-open',
      x: 150,
      y: 100,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: '#000', strokeWidth: 0 },
    };

    const nodes: DesignNode[] = [outerFrame, innerUnclippedFrame, childRect];
    const map = buildFrameClipAncestorMap(nodes);

    expect(map.get('frame-outer')).toEqual([]);
    expect(map.get('frame-inner-open')).toEqual(['frame-outer']);
    expect(map.get('child-1')).toEqual(['frame-outer']);
    expect(getLayerFrameClipAncestorIds(nodes, 'child-1')).toEqual(['frame-outer']);
  });

  it('serializes standalone SVG with Frame clipPaths, path arrowheads, typography, opacity, and component instances', () => {
    const doc = createEmptyDocument('Landing Hero', 800, 600);
    doc.id = 'doc-export';
    doc.background = '#10141D';

    const frame: FrameNode = {
      id: 'frame-hero',
      type: 'frame',
      name: 'Hero Frame',
      x: 40,
      y: 40,
      width: 320,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      clipContent: true,
      style: { fill: '#181E2B', stroke: '#3A4256', strokeWidth: 1, radius: 16 },
    };
    const clippedChild: RectNode = {
      id: 'child-banner',
      type: 'rect',
      name: 'Banner',
      parentId: 'frame-hero',
      x: 250,
      y: 60,
      width: 240,
      height: 120,
      rotation: 0,
      opacity: 0.75,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: 'none', strokeWidth: 0 },
    };
    const arrowPath: PathNode = {
      id: 'arrow-1',
      type: 'path',
      name: 'Flow Arrow',
      x: 100,
      y: 320,
      width: 180,
      height: 20,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: false,
      points: [
        { id: 'p1', x: 0, y: 10, pointType: 'corner' },
        { id: 'p2', x: 180, y: 10, pointType: 'corner' },
      ],
      style: {
        fill: 'none',
        stroke: '#38BDF8',
        strokeWidth: 3,
        strokeDasharray: '8 5',
        arrowEnd: true,
      },
    };
    const headline: TextNode = {
      id: 'txt-1',
      type: 'text',
      name: 'Headline',
      x: 60,
      y: 400,
      width: 440,
      height: 60,
      rotation: 0,
      opacity: 0.9,
      visible: true,
      locked: false,
      text: 'Hello <Folio> & World\nLine 2',
      style: {
        fill: '#F8FAFC',
        fontSize: 28,
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontWeight: 700,
        letterSpacing: 1.5,
        lineHeight: 1.4,
      },
    };

    const compDoc = createEmptyDocument('Badge', 100, 40);
    compDoc.id = 'badge-doc';
    compDoc.nodes = [
      {
        id: 'badge-bg',
        type: 'rect',
        name: 'BG',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        style: { fill: '#6366F1', stroke: 'none', strokeWidth: 0, radius: 8 },
      },
    ];
    const badgeComp: ComponentDefinition = {
      id: 'comp-badge',
      name: 'Badge',
      document: compDoc,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const badgeInstance: DesignNode = {
      id: 'inst-badge',
      type: 'component-instance',
      name: 'Badge Instance',
      componentId: 'comp-badge',
      x: 500,
      y: 80,
      width: 120,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: { 'badge-bg': { fill: '#10B981' } },
    };

    doc.nodes = [frame, clippedChild, arrowPath, headline, badgeInstance];

    const svg = serializeDocumentToSvgString(doc, [badgeComp], { title: 'Landing Hero' });

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('<clipPath id="folio-export-doc-export--clip--frame-hero"');
    expect(svg).toContain('clip-path="url(#folio-export-doc-export--clip--frame-hero)"');
    expect(svg).toContain('opacity="0.75"');
    expect(svg).toContain('stroke-dasharray="8 5"');
    expect(svg).toContain('<polygon points="');
    expect(svg).toContain('Hello &lt;Folio&gt; &amp; World');
    expect(svg).toContain('letter-spacing="1.5"');
    expect(svg).toContain('fill="#10B981"');
    expect(createVisualExportFilename('Landing Hero / v2!', 'png')).toBe('landing-hero-v2.png');
  });
});

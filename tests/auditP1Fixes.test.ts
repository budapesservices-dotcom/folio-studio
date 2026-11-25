import { describe, expect, it } from 'vitest';
import {
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import {
  expandSelectedLayerIds,
  getLayerAncestorIds,
  getLayerAncestorIdsFromMap,
  getSelectedLayerRootIds,
} from '../src/core/document/layers';
import type { ComponentDefinition, DesignNode, GroupNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { filterLayerPanelRows } from '../src/app/workspace/layerOperations';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { sanitizeCssTransformValue, sanitizeImageUrl } from '../src/engines/codegen/sanitize';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';

const RAW_SOURCES = import.meta.glob<string>(
  [
    '../src/app/InspectorPanel.tsx',
    '../src/app/workspace/LayersPanel.tsx',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

function makeGroupNode(id: string, name: string): GroupNode {
  return {
    id,
    type: 'group',
    name,
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
}

describe('Audit P1 Regression Suite', () => {
  it('P1-1: resets Inspector interactive state to default when selectedNode.id changes', () => {
    const inspectorSource = RAW_SOURCES['../src/app/InspectorPanel.tsx'] ?? '';
    expect(inspectorSource).toMatch(/useEffect\(\(\) => \{\s*setActiveState\('default'\);\s*\}, \[selectedNode\.id\]\);/);
  });

  it('P1-2: emits htmlId, safe custom className, and target=_blank rel=noopener noreferrer in React Master Component JSX', () => {
    const project = createInitialProject('Master Parity Audit');
    const linkNode: DesignNode = {
      ...createTextNode(0),
      id: 'master-link-1',
      name: 'Docs Link',
      text: 'Read Docs',
      semanticTag: 'a',
      href: 'https://folio.example.com/docs',
      linkTarget: '_blank',
      htmlId: 'master-docs-link',
      className: 'btn-primary is-external',
      visible: true,
    };
    const unsafeNode: DesignNode = {
      ...createRectNode(1),
      id: 'master-unsafe-1',
      name: 'Unsafe Attrs',
      htmlId: 'bad id"><script>',
      className: 'ok;bad<script>',
      visible: true,
    };

    const now = '2026-11-24T00:00:00.000Z';
    const master: ComponentDefinition = {
      id: 'comp-nav-card',
      name: 'NavCard',
      createdAt: now,
      updatedAt: now,
      document: {
        id: 'doc-comp-nav-card',
        name: 'NavCard',
        width: 320,
        height: 120,
        background: '#ffffff',
        nodes: [linkNode, unsafeNode],
      },
    };
    project.components.push(master);

    const reactFiles = compileReactProjectFiles(project);
    const compTsx = reactFiles.find((file) => file.path === 'src/components/NavCard.tsx');
    expect(compTsx).toBeDefined();
    const content = compTsx?.content ?? '';

    expect(content).toContain('id="master-docs-link"');
    expect(content).toMatch(/className="[^"]+ btn-primary is-external"/);
    expect(content).toContain('href="https://folio.example.com/docs"');
    expect(content).toContain('target="_blank"');
    expect(content).toContain('rel="noopener noreferrer"');
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('bad id');
  });

  it('P1-3 & P1-6: precomputes O(N) lookup maps and disables drag-reorder during active search in LayersPanel', () => {
    const layersSource = RAW_SOURCES['../src/app/workspace/LayersPanel.tsx'] ?? '';
    expect(layersSource).toContain('new Map<string, DesignNode>()');
    expect(layersSource).toContain('new Set<string>()');
    expect(layersSource).toContain('draggable={!isSearchActive}');
    expect(layersSource).toContain('onDragStart={isSearchActive ? undefined :');
    expect(layersSource).toContain('onDrop={isSearchActive ? undefined :');
    expect(layersSource).not.toContain('layerSourceNodes.find((item) => item.id === node.clipMaskBaseId)');
    expect(layersSource).not.toContain('layerSourceNodes.some((item) => item.clipMaskBaseId === node.id)');
  });

  it('P1-4: performs O(N) layer root reduction, subtree expansion, and search filtering accurately on 600 layers', () => {
    const nodes: DesignNode[] = [];
    for (let g = 0; g < 60; g += 1) {
      const groupId = `grp-${g}`;
      nodes.push(makeGroupNode(groupId, `Section ${g}`));
      for (let c = 0; c < 9; c += 1) {
        const child: DesignNode = {
          ...createRectNode(c),
          id: `node-${g}-${c}`,
          name: g === 42 && c === 7 ? 'Target Needle Card' : `Card ${g}-${c}`,
          htmlId: g === 42 && c === 7 ? 'needle-anchor' : undefined,
          parentId: groupId,
        };
        nodes.push(child);
      }
    }
    expect(nodes.length).toBe(600);

    const selectedRoots = getSelectedLayerRootIds(nodes, ['grp-10', 'node-10-2', 'node-10-5', 'node-20-1']);
    expect(selectedRoots).toEqual(['grp-10', 'node-20-1']);

    const expanded = expandSelectedLayerIds(nodes, ['grp-10', 'node-20-1']);
    expect(expanded.length).toBe(11);
    expect(expanded[0]).toBe('grp-10');
    expect(expanded[expanded.length - 1]).toBe('node-20-1');

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    expect([...getLayerAncestorIdsFromMap(nodeById, 'node-42-7')]).toEqual([...getLayerAncestorIds(nodes, 'node-42-7')]);

    const filtered = filterLayerPanelRows(nodes, ['grp-42'], 'needle-anchor');
    expect(filtered.isFiltering).toBe(true);
    expect(filtered.matchCount).toBe(1);
    expect(filtered.rows.map((r) => r.node.id)).toEqual(['grp-42', 'node-42-7']);
  });

  it('P1-5a: sanitizes dynamic image URLs and CSS transforms consistently', () => {
    expect(sanitizeImageUrl('https://cdn.example.com/photo.webp')).toBe('https://cdn.example.com/photo.webp');
    expect(sanitizeImageUrl('/assets/banner.png')).toBe('/assets/banner.png');
    expect(sanitizeImageUrl('./thumb.jpg')).toBe('./thumb.jpg');
    expect(sanitizeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');

    expect(sanitizeImageUrl('//evil.example/tracker.png')).toBeNull();
    expect(sanitizeImageUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeImageUrl('mailto:test@example.com')).toBeNull();
    expect(sanitizeImageUrl('#section')).toBeNull();
    expect(sanitizeImageUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeImageUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=')).toBeNull();

    expect(sanitizeCssTransformValue('translateX(12px) scale(1.05) rotate(15deg)')).toBe('translateX(12px) scale(1.05) rotate(15deg)');
    expect(sanitizeCssTransformValue('url(https://evil.example/x)')).toBe('');
    expect(sanitizeCssTransformValue('expression(alert(1))')).toBe('');
    expect(sanitizeCssTransformValue('rotate(10deg); background: url(x)')).toBe('');
  });

  it('P1-5b: blocks unsafe protocol-relative imageUrl and unsafe transform in prototype runtime, validator, and codegen', () => {
    const project = createInitialProject('Security Hardening');
    const page = project.pages[0];
    const targetNode = page.document.nodes[0];

    const onClick = createLogicNode({
      id: 'ev-click',
      type: 'event.on-click',
      data: { targetNodeId: targetNode.id },
    });
    const setBadImg = createLogicNode({
      id: 'act-bad-img',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: targetNode.id, property: 'image', imageUrl: '//evil.example/pixel.png' },
    });
    const setBadTr = createLogicNode({
      id: 'act-bad-tr',
      type: 'action.set-layer',
      data: { targetMode: 'override', targetNodeId: targetNode.id, property: 'transform', transform: 'url(https://evil.example/a)' },
    });

    const graph = createLogicGraph({
      id: 'graph-sec-1',
      name: 'Security Check Graph',
      scope: 'page',
      targetId: page.id,
      nodes: [onClick, setBadImg, setBadTr],
      connections: [
        createLogicConnection({
          id: 'sec-c1',
          sourceNodeId: onClick.id,
          sourcePortId: 'exec',
          targetNodeId: setBadImg.id,
          targetPortId: 'exec',
        }),
        createLogicConnection({
          id: 'sec-c2',
          sourceNodeId: setBadImg.id,
          sourcePortId: 'next',
          targetNodeId: setBadTr.id,
          targetPortId: 'exec',
        }),
      ],
    });
    project.logicGraphs.push(graph);

    const validation = validateLogicGraphSemantics(graph, project);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((issue) => issue.nodeId === 'act-bad-img' && issue.code === 'UNSAFE_NAVIGATE_URL')).toBe(true);
    expect(validation.errors.some((issue) => issue.nodeId === 'act-bad-tr' && issue.code === 'UNSAFE_CSS_VALUE')).toBe(true);

    const runtime = createPrototypeRuntime(project);
    const nextState = runtime.dispatchNodeEvent(targetNode.id, 'click');
    expect(nextState.nodeOverrides[targetNode.id]?.imageUrl).toBeUndefined();
    expect(nextState.nodeOverrides[targetNode.id]?.transform).toBeUndefined();
    expect(nextState.warnings.some((warning) => warning.includes('unsafe image URL'))).toBe(true);
    expect(nextState.warnings.some((warning) => warning.includes('unsafe CSS transform'))).toBe(true);

    const previewScript = buildLivePreviewLogicScript(project, page) ?? '';
    expect(previewScript).toContain('isSafeImageUrl');
    expect(previewScript).toContain('sanitizeTransform');
    expect(previewScript).toContain('\\/(?!\\/)');

    const reactFiles = compileReactProjectFiles(project);
    const reactPage = reactFiles.find((file) => file.path.startsWith('src/pages/') && file.path.endsWith('.tsx'))?.content ?? '';
    expect(reactPage).toContain('!imgUrl.startsWith("//")');
  });

  it('P1-5c: validates .flop asset sources to block protocol-relative URLs and scripted SVG data URIs while allowing static SVGs', () => {
    const safeProject = createInitialProject('Safe SVG Asset');
    safeProject.assets = [
      {
        id: 'asset-safe-svg',
        name: 'icon.svg',
        kind: 'image',
        mimeType: 'image/svg+xml',
        source: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ];
    expect(validateProject(safeProject).ok).toBe(true);

    const scriptedSvgProject = createInitialProject('Scripted SVG Asset');
    scriptedSvgProject.assets = [
      {
        id: 'asset-evil-svg',
        name: 'evil.svg',
        kind: 'image',
        mimeType: 'image/svg+xml',
        source: `data:image/svg+xml;base64,${btoa('<svg onload="alert(1)"></svg>')}`,
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ];
    expect(validateProject(scriptedSvgProject).ok).toBe(false);

    const protoRelProject = createInitialProject('Protocol Relative Asset');
    protoRelProject.assets = [
      {
        id: 'asset-proto-rel',
        name: 'remote.png',
        kind: 'image',
        mimeType: 'image/png',
        source: '//evil.example/leak.png',
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ];
    expect(validateProject(protoRelProject).ok).toBe(false);
  });
});

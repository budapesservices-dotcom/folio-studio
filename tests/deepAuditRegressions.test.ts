import { describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<{ cb: () => void | (() => void); deps?: readonly unknown[]; cleanup?: (() => void) | void }> = [];
  let stateIdx = 0;
  let refIdx = 0;
  let effectIdx = 0;

  return {
    reset() {
      states.length = 0;
      refs.length = 0;
      for (const eff of effects) {
        if (typeof eff.cleanup === 'function') eff.cleanup();
      }
      effects.length = 0;
      stateIdx = 0;
      refIdx = 0;
      effectIdx = 0;
    },
    beginRender() {
      stateIdx = 0;
      refIdx = 0;
      effectIdx = 0;
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateIdx++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = states[idx] as T;
        states[idx] = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      };
      return [states[idx] as T, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const idx = refIdx++;
      if (!refs[idx]) {
        refs[idx] = { current: initial };
      }
      return refs[idx] as { current: T };
    },
    useMemo<T>(factory: () => T): T {
      return factory();
    },
    useCallback<T>(fn: T): T {
      return fn;
    },
    useEffect(cb: () => void | (() => void), deps?: readonly unknown[]) {
      const idx = effectIdx++;
      const prev = effects[idx];
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) {
        if (typeof prev?.cleanup === 'function') prev.cleanup();
        effects[idx] = { cb, deps, cleanup: cb() };
      }
    },
  };
});

vi.mock('preact/hooks', () => ({
  useState: hookState.useState,
  useRef: hookState.useRef,
  useMemo: hookState.useMemo,
  useCallback: hookState.useCallback,
  useEffect: hookState.useEffect,
}));

import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState, editorReducer } from '../src/app/editorReducer';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { useMotionPlayback } from '../src/app/workspace/useMotionPlayback';
import { resolveComponentInstanceNodes } from '../src/core/document/components';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import {
  createDefaultDesignTokens,
  resolveDesignTokenValue,
  resolveNodeWithTokens,
} from '../src/core/document/tokens';
import type {
  AnimationClip,
  AssetReference,
  ComponentInstanceNode,
  ImageNode,
  LogicGraph,
  PathNode,
  RectNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  extractAssetBinaryBytesSync,
  materializeProjectAssetsForExport,
  resolveAssetDisplayUrl,
  resolvePortableAssetUrl,
  sanitizeSvgMarkup,
} from '../src/core/persistence/assetStore';
import { createToolOperation } from '../src/core/tools/operationContract';
import { evaluateToolOperation } from '../src/engines/canvas/geometryEngine';
import { auditPageAccessibility } from '../src/engines/codegen/a11yAudit';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { applyMappedNodeEdit } from '../src/engines/codegen/mappedSync';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { buildLivePreviewLogicScript, buildReactPageLogicPlan } from '../src/engines/prototype/codegen';

function createImageFixture(overrides: Partial<ImageNode> = {}): ImageNode {
  return {
    id: 'img-1',
    type: 'image',
    name: 'Hero Photo',
    assetId: 'asset-1',
    alt: 'Hero Photo',
    naturalWidth: 400,
    naturalHeight: 300,
    x: 40,
    y: 40,
    width: 240,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: {
      fit: 'cover',
      radius: 4,
      stroke: '#000000',
      strokeWidth: 2,
    },
    ...overrides,
  };
}

function createPathFixture(overrides: Partial<PathNode> = {}): PathNode {
  return {
    id: 'path-1',
    type: 'path',
    name: 'Vector Shape',
    x: 10,
    y: 10,
    width: 120,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    closed: true,
    points: [
      { id: 'p1', x: 0.5, y: 0, pointType: 'corner' },
      { id: 'p2', x: 1, y: 1, pointType: 'corner' },
      { id: 'p3', x: 0, y: 1, pointType: 'corner' },
    ],
    style: {
      fill: '#7c6cf6',
      stroke: 'none',
      strokeWidth: 0,
    },
    ...overrides,
  };
}

function makeInlineSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function expectResolvedLiteral(res: ReturnType<typeof resolveDesignTokenValue>): string | number {
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.message);
  return res.rawValue;
}

describe('Deep Audit Regressions — Tokens, Components & Multi-Fill', () => {
  it('BUG-01: resolves stroke and radius design tokens on ImageNode', () => {
    const tokens = createDefaultDesignTokens();
    const colorToken = tokens.tokens.find((t) => t.category === 'color')!;
    const radiusToken = tokens.tokens.find((t) => t.category === 'radius')!;
    const expectedStroke = expectResolvedLiteral(resolveDesignTokenValue(tokens, colorToken.id)) as string;
    const expectedRadius = expectResolvedLiteral(resolveDesignTokenValue(tokens, radiusToken.id)) as number;

    const image = createImageFixture({
      tokenBindings: {
        stroke: colorToken.id,
        radius: radiusToken.id,
      },
    });

    const resolved = resolveNodeWithTokens(image, tokens) as ImageNode;
    expect(resolved.style.stroke).toBe(expectedStroke);
    expect(resolved.style.radius).toBe(expectedRadius);
  });

  it('BUG-02 & BUG-03: applies stroke overrides on ImageNode and clears style.fills on fill override/token', () => {
    const project = createInitialProject('Override & Multi-Fill Test');
    const tokens = createDefaultDesignTokens();
    const colorToken = tokens.tokens.find((t) => t.category === 'color')!;
    const expectedTokenColor = expectResolvedLiteral(resolveDesignTokenValue(tokens, colorToken.id)) as string;

    const multiFillRect: RectNode = {
      ...createRectNode(),
      id: 'master-rect',
      name: 'Multi-Fill Card',
      style: {
        fill: '#111111',
        fills: [
          { id: 'f1', type: 'solid', color: '#222222', opacity: 1, visible: true },
          { id: 'f2', type: 'solid', color: '#333333', opacity: 0.9, visible: true },
        ],
        stroke: 'none',
        strokeWidth: 0,
        radius: 8,
      },
    };
    const masterImg = createImageFixture({
      id: 'master-img',
      style: { fit: 'cover', radius: 4, stroke: '#111111', strokeWidth: 2 },
    });

    const resolvedTokenRect = resolveNodeWithTokens(
      { ...multiFillRect, tokenBindings: { fill: colorToken.id } },
      tokens,
    ) as RectNode;
    expect(resolvedTokenRect.style.fill).toBe(expectedTokenColor);
    expect(resolvedTokenRect.style.fills).toBeUndefined();

    const component = {
      id: 'comp-1',
      name: 'Media Card',
      createdAt: project.metadata.createdAt,
      updatedAt: project.metadata.updatedAt,
      variants: [
        {
          id: 'axis-tone',
          name: 'Tone',
          defaultOptionId: 'opt-accent',
          options: [
            {
              id: 'opt-accent',
              label: 'Accent',
              overrides: {
                'master-img': { stroke: '#00aaff' },
              },
            },
          ],
        },
      ],
      document: {
        ...project.pages[0].document,
        id: 'comp-doc-1',
        name: 'Media Card',
        nodes: [multiFillRect, masterImg],
      },
    };

    const instance: ComponentInstanceNode = {
      id: 'inst-1',
      type: 'component-instance',
      name: 'Media Card Instance',
      x: 20,
      y: 20,
      width: 320,
      height: 240,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      componentId: 'comp-1',
      overrides: {
        'master-rect': { fill: '#ff5500' },
      },
    };

    const resolvedNodes = resolveComponentInstanceNodes(instance, component, tokens);
    const instRect = resolvedNodes.find((n) => n.id.includes('master-rect')) as RectNode;
    const instImg = resolvedNodes.find((n) => n.id.includes('master-img')) as ImageNode;
    expect(instRect.style.fill).toBe('#ff5500');
    expect(instRect.style.fills).toBeUndefined();
    expect(instImg.style.stroke).toBe('#00aaff');
  });
});

describe('Deep Audit Regressions — Codegen, Clipping Masks, SVG Export & Line Mappings', () => {
  it('BUG-04: compiles clipping masks inside component instances with scoped SVG mask defs', () => {
    const project = createInitialProject('Component Mask Test');
    const maskPath = createPathFixture({
      id: 'mask-shape',
      name: 'Blob Mask',
      x: 10,
      y: 10,
      width: 120,
      height: 120,
    });
    const clippedRect: RectNode = {
      ...createRectNode(),
      id: 'clipped-rect',
      name: 'Masked Layer',
      x: 0,
      y: 0,
      width: 160,
      height: 160,
      clipMaskBaseId: 'mask-shape',
      clipMaskMode: 'outside',
    };

    project.components = [
      {
        id: 'comp-mask',
        name: 'Masked Card',
        createdAt: project.metadata.createdAt,
        updatedAt: project.metadata.updatedAt,
        document: {
          ...project.pages[0].document,
          id: 'comp-mask-doc',
          name: 'Masked Card',
          nodes: [maskPath, clippedRect],
        },
      },
    ];
    project.pages[0].document.nodes = [
      {
        id: 'inst-mask',
        type: 'component-instance',
        name: 'Masked Card 1',
        x: 40,
        y: 40,
        width: 160,
        height: 160,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        componentId: 'comp-mask',
        overrides: {},
      },
    ];

    const compiled = compilePageHtmlCss(project, project.pages[0]);
    expect(compiled.htmlFile.content).toContain('<mask id="folio-mask-');
    expect(compiled.cssFile.content).toMatch(/mask:\s*url\(#folio-mask-/);
  });

  it('BUG-05: SVG export supports outside clip masks, cssFilters, strokeAlign, and per-corner cornerRadii', () => {
    const project = createInitialProject('Visual Export Parity');
    const maskBase: RectNode = {
      ...createRectNode(),
      id: 'outside-mask-base',
      name: 'Cutout Mask',
      x: 40,
      y: 40,
      width: 100,
      height: 100,
    };
    const styledCard: RectNode = {
      ...createRectNode(),
      id: 'styled-card',
      name: 'Styled Card',
      x: 20,
      y: 20,
      width: 200,
      height: 120,
      clipMaskBaseId: 'outside-mask-base',
      clipMaskMode: 'outside',
      cssFilters: { brightness: 120, contrast: 110, saturate: 130, grayscale: 25 },
      style: {
        fill: '#2563eb',
        stroke: '#facc15',
        strokeWidth: 8,
        strokeAlign: 'inside',
        radius: 12,
        cornerRadii: { topLeft: 24, topRight: 8, bottomRight: 20, bottomLeft: 4 },
      },
    };
    project.pages[0].document.nodes = [maskBase, styledCard];

    const svg = serializeDocumentToSvgString(project.pages[0].document, project.components, {
      assets: project.assets,
      designTokens: project.designTokens,
    });
    expect(svg).toMatch(/<mask id="[^"]+--outsidemask--outside-mask-base"/);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
    expect(svg).toMatch(/mask="url\(#[^"]+--outsidemask--outside-mask-base\)"/);
    expect(svg).toContain('filter:brightness(120%) contrast(110%) saturate(130%) grayscale(25%)');
    // Per-corner rounded rect path (distinct corner radii) + inset stroke path (strokeAlign: 'inside')
    expect(svg).toMatch(/<path d="M 44 20 H 212 A 8 8/);
    expect(svg).toMatch(/<path d="M 44 24 H 212 A 4 4/);
  });

  it('BUG-08: React compiler resolves spacing tokens inside Auto-Layout page mask defs', () => {
    const project = createInitialProject('React AutoLayout Token Mask');
    const tokens = createDefaultDesignTokens();
    const spacingToken = tokens.tokens.find((t) => t.category === 'spacing')!;
    const expectedGap = expectResolvedLiteral(resolveDesignTokenValue(tokens, spacingToken.id)) as number;
    project.designTokens = tokens;

    const frame = createFrameNode();
    frame.id = 'al-frame';
    frame.x = 0;
    frame.y = 0;
    frame.width = 400;
    frame.height = 300;
    frame.layout = {
      mode: 'flex',
      direction: 'row',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    frame.tokenBindings = { gap: spacingToken.id };

    const first: RectNode = {
      ...createRectNode(),
      id: 'child-1',
      parentId: 'al-frame',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
    };
    const maskChild: RectNode = {
      ...createRectNode(),
      id: 'child-mask',
      parentId: 'al-frame',
      x: 0,
      y: 0,
      width: 60,
      height: 60,
    };
    const maskedSibling: RectNode = {
      ...createRectNode(),
      id: 'child-masked',
      parentId: 'al-frame',
      clipMaskBaseId: 'child-mask',
      clipMaskMode: 'outside',
      x: 0,
      y: 0,
      width: 60,
      height: 60,
    };

    project.pages[0].document.nodes = [frame, first, maskChild, maskedSibling];
    const files = compileReactProjectFiles(project, project.pages[0].id);
    const pageTsx = files.find((f) => f.path.endsWith('.tsx') && f.path.includes('pages/'))!;
    expect(pageTsx).toBeDefined();
    // Relative offset from child-masked to child-mask is -(60 + expectedGap), proving Auto-Layout resolved the spacing token
    expect(pageTsx.content).toContain(`x="${-(60 + expectedGap)}"`);
  });

  it('BUG-20: preserves exact 1-indexed line mappings after multiline text nodes in HTML and React TSX', () => {
    const project = createInitialProject('Multiline Mapping');
    const multiText = createTextNode();
    multiText.id = 'multi-text';
    multiText.name = 'Multiline Copy';
    multiText.text = 'Line one\nLine two\nLine three\nLine four';

    const trailingRect: RectNode = {
      ...createRectNode(),
      id: 'after-multi-rect',
      name: 'Trailing Box',
      x: 40,
      y: 220,
      width: 140,
      height: 60,
    };
    project.pages[0].document.nodes = [multiText, trailingRect];

    const htmlCompiled = compilePageHtmlCss(project, project.pages[0]);
    const htmlLines = htmlCompiled.htmlFile.content.split('\n');
    const htmlRectMap = htmlCompiled.htmlFile.mappings.find((m) => m.nodeId === 'after-multi-rect')!;
    expect(htmlRectMap).toBeDefined();
    expect(htmlLines[htmlRectMap.startLine - 1]).toContain('data-folio-id="after-multi-rect"');

    const reactFiles = compileReactProjectFiles(project, project.pages[0].id);
    const reactPage = reactFiles.find((f) => f.mappings.some((m) => m.nodeId === 'after-multi-rect'))!;
    const reactLines = reactPage.content.split('\n');
    const reactRectMap = reactPage.mappings.find((m) => m.nodeId === 'after-multi-rect')!;
    expect(reactLines[reactRectMap.startLine - 1]).toContain('data-folio-id="after-multi-rect"');
  });
});

describe('Deep Audit Security PoCs — SVG, Asset URI, and Mapped CSS Validation', () => {
  it('BUG-06: blocks namespace-prefixed SVG active payloads and non-allowlisted asset URI schemes', () => {
    const payloads = [
      makeInlineSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>'),
      makeInlineSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"><xhtml:iframe src="https://evil.example"></xhtml:iframe></svg>'),
      makeInlineSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/a.svg#p"/></svg>'),
      makeInlineSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/tracker)"/></svg>'),
      'file:///etc/passwd',
      'ftp://evil.example/payload.png',
      'blob:javascript:alert(1)',
    ];

    for (const source of payloads) {
      const project = createInitialProject('Security Validation');
      project.assets = [
        {
          id: 'asset-bad',
          name: 'bad.svg',
          kind: 'image',
          mimeType: source.startsWith('data:image/svg+xml') ? 'image/svg+xml' : 'image/png',
          source,
          createdAt: project.metadata.createdAt,
        },
      ];
      const validation = validateProject(project);
      expect(validation.ok, `Expected payload to be rejected: ${source.slice(0, 64)}`).toBe(false);
    }
  });

  it('BUG-06 & BUG-12: sanitizes malicious inline SVG data URLs across display, portable, ZIP, and .flop export paths', async () => {
    const evilSvg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><svg:script>alert(1)</svg:script><rect width="10" height="10" fill="url(#ok)" style="background:url(https://evil.example/x)" xlink:href="https://evil.example/a"/></svg>';
    const sanitizedDirect = sanitizeSvgMarkup(evilSvg);
    expect(sanitizedDirect).not.toMatch(/script/i);
    expect(sanitizedDirect).not.toMatch(/evil\.example/i);
    expect(sanitizedDirect).toContain('url(#ok)');

    const maliciousAsset: AssetReference = {
      id: 'asset-evil-svg',
      name: 'icon.svg',
      kind: 'image',
      mimeType: 'image/svg+xml',
      source: makeInlineSvgDataUrl(evilSvg),
      createdAt: new Date().toISOString(),
    };

    const displayUrl = resolveAssetDisplayUrl(maliciousAsset);
    const portableUrl = resolvePortableAssetUrl(maliciousAsset);
    const zipBytes = extractAssetBinaryBytesSync(maliciousAsset);
    expect(displayUrl).toBeTruthy();
    expect(portableUrl).toBeTruthy();
    expect(zipBytes).toBeTruthy();

    const decodedZipSvg = new TextDecoder().decode(zipBytes!);
    expect(decodedZipSvg).not.toMatch(/script/i);
    expect(decodedZipSvg).not.toMatch(/evil\.example/i);

    const decodedDisplaySvg = atob(displayUrl!.split(',')[1]);
    expect(decodedDisplaySvg).not.toMatch(/script/i);
    expect(decodedDisplaySvg).not.toMatch(/evil\.example/i);

    const project = createInitialProject('Export Sanitize');
    project.assets = [maliciousAsset];
    const materialized = await materializeProjectAssetsForExport(project);
    const exportedSvg = atob(materialized.assets[0].source.split(',')[1]);
    expect(exportedSvg).not.toMatch(/script/i);
    expect(exportedSvg).not.toMatch(/evil\.example/i);
  });

  it('BUG-10: mappedSync rejects CSS injection fills and clears style.fills on valid fill update', () => {
    const rect: RectNode = {
      ...createRectNode(),
      id: 'mapped-rect',
      style: {
        fill: '#111111',
        fills: [{ id: 'f1', type: 'solid', color: '#222222', opacity: 1, visible: true }],
        stroke: 'none',
        strokeWidth: 0,
        radius: 0,
      },
    };

    const rejected = applyMappedNodeEdit(rect, {
      fill: 'red; background-image: url(javascript:alert(1))',
    });
    expect(rejected.status).toBe('unsupported');

    const applied = applyMappedNodeEdit(rect, { fill: '#10b981' });
    expect(applied.status).toBe('applied');
    if (applied.status === 'applied') {
      const updated = applied.node as RectNode;
      expect(updated.style.fill).toBe('#10b981');
      expect(updated.style.fills).toBeUndefined();
    }
  });
});

describe('Deep Audit Regressions — Accessibility Audit, Node Logic, Governance & Motion', () => {
  it('BUG-11: a11yAudit resolves multi-fill backdrops and post-AutoLayout coordinates', () => {
    const project = createInitialProject('A11y Multi-Fill & AutoLayout');
    const frame = createFrameNode();
    frame.id = 'al-a11y-frame';
    frame.x = 0;
    frame.y = 0;
    frame.width = 400;
    frame.height = 200;
    frame.style = { ...frame.style, fill: 'transparent' };
    frame.layout = {
      mode: 'flex',
      direction: 'column',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    const darkCard: RectNode = {
      ...createRectNode(),
      id: 'dark-multifill-card',
      parentId: 'al-a11y-frame',
      x: 0,
      y: 0,
      width: 300,
      height: 120,
      style: {
        fill: '#ffffff',
        fills: [{ id: 'dark-top', type: 'solid', color: '#0f172a', opacity: 1, visible: true }],
        stroke: 'none',
        strokeWidth: 0,
        radius: 0,
      },
    };
    const lowContrastText = createTextNode();
    lowContrastText.id = 'dark-on-dark-text';
    lowContrastText.parentId = 'dark-multifill-card';
    lowContrastText.text = 'Hard to read';
    lowContrastText.style = { ...lowContrastText.style, fill: '#1e293b', fontSize: 16 };

    project.pages[0].document.nodes = [frame, darkCard, lowContrastText];
    const report = auditPageAccessibility(project, project.pages[0]);
    const contrastIssue = report.issues.find(
      (i) => i.code === 'CONTRAST_TOO_LOW' && i.nodeId === 'dark-on-dark-text',
    );
    expect(contrastIssue).toBeDefined();
    expect(contrastIssue?.detail).toContain('#0f172a');
  });

  it('BUG-13, BUG-14, BUG-15, BUG-16: Node Logic codegen handles SVG path variants, scroll mode, page-only context onLoad, JSON interpolation, and strict React hex colors', () => {
    const project = createInitialProject('Node Logic Parity');
    const pathNode = createPathFixture({ id: 'icon-path', name: 'Icon' });
    const textNode = { ...createTextNode(), id: 'status-text', name: 'Status' };
    project.pages[0].document.nodes = [pathNode, textNode];

    const graph: LogicGraph = {
      id: 'graph-1',
      name: 'Page Logic',
      scope: 'page',
      targetId: project.pages[0].id,
      nodes: [
        {
          id: 'n-scroll',
          type: 'event.on-scroll-view',
          x: 0,
          y: 0,
          data: { targetNodeId: 'status-text', mode: 'page-scroll' },
        },
        {
          id: 'n-ctx',
          type: 'source.context',
          x: 0,
          y: 80,
          data: { contextKind: 'theme', variableName: 'themeName' },
        },
        {
          id: 'n-variant',
          type: 'action.set-variant',
          x: 200,
          y: 0,
          data: { targetNodeId: 'icon-path', variant: 'primary' },
        },
        {
          id: 'n-text',
          type: 'action.set-text',
          x: 200,
          y: 80,
          data: { targetNodeId: 'status-text', text: '{{payload}}' },
        },
        {
          id: 'n-layer',
          type: 'action.set-layer',
          x: 200,
          y: 160,
          data: { targetNodeId: 'icon-path', fill: '#12345' },
        },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n-scroll', sourcePortId: 'out', targetNodeId: 'n-variant', targetPortId: 'in' },
        { id: 'c2', sourceNodeId: 'n-ctx', sourcePortId: 'out', targetNodeId: 'n-text', targetPortId: 'in' },
        { id: 'c3', sourceNodeId: 'n-scroll', sourcePortId: 'out', targetNodeId: 'n-layer', targetPortId: 'in' },
      ],
      createdAt: project.metadata.createdAt,
      updatedAt: project.metadata.updatedAt,
    };
    project.logicGraphs = [graph];

    const previewScript = buildLivePreviewLogicScript(project, project.pages[0]);
    expect(previewScript).toBeTruthy();
    expect(previewScript).toContain('function fmtTpl(val)');
    expect(previewScript).toContain('JSON.stringify(val)');
    expect(previewScript).toContain('cMeta.type === "path"');
    expect(previewScript).toContain('n.data.mode || n.data.trigger');
    expect(previewScript).toContain('n.data.contextKind === "page"');

    const reactPlan = buildReactPageLogicPlan(project, project.pages[0]);
    expect(reactPlan.hasLogic).toBe(true);
    const reactCode = reactPlan.hookLines.join('\n');
    expect(reactCode).toContain('const fmtTpl =');
    expect(reactCode).toContain('JSON.stringify(val)');
    // Strict hex color regex rejects malformed 5-char hex (#12345)
    expect(reactCode).toContain('#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})');
  });

  it('BUG-17: cleans dangling component logic targets, tracks change drafts accurately, and guards legacy component contract updates', () => {
    const project = createInitialProject('Governance & Sync');
    const compRect: RectNode = { ...createRectNode(), id: 'comp-node-1', name: 'Btn Bg' };
    const compText = { ...createTextNode(), id: 'comp-node-2', name: 'Btn Label' };
    const masterDoc = {
      ...project.pages[0].document,
      id: 'comp-gov-doc',
      name: 'Action Button',
      nodes: [compRect, compText],
    };
    project.components = [
      {
        id: 'comp-gov',
        name: 'Action Button',
        nodeLogicEnabled: false,
        createdAt: project.metadata.createdAt,
        updatedAt: project.metadata.updatedAt,
        document: masterDoc,
      },
    ];
    project.logicGraphs = [
      {
        id: 'comp-logic-1',
        name: 'Button Logic',
        scope: 'component',
        targetId: 'comp-gov',
        nodes: [
          {
            id: 'ev-1',
            type: 'event.on-click',
            x: 0,
            y: 0,
            data: { targetNodeId: 'comp-node-2' },
          },
        ],
        connections: [],
        createdAt: project.metadata.createdAt,
        updatedAt: project.metadata.updatedAt,
      },
    ];

    // 1. sync-component-document cleans dangling targetNodeId when comp-node-2 is deleted
    const initialState = createEditorState(project);
    const currentMasterDoc = initialState.project.components[0].document;
    const nextState = editorReducer(initialState, {
      type: 'sync-component-document',
      componentId: 'comp-gov',
      expectedMasterDocument: currentMasterDoc,
      expectedUpdatedAt: initialState.project.components[0].updatedAt,
      updatedAt: '2026-11-25T18:00:00.000Z',
      document: {
        ...currentMasterDoc,
        nodes: [compRect],
      },
    });
    expect(nextState.project.logicGraphs[0].nodes[0].data.targetNodeId).toBe('');

    // 2. nativeCommandExecutor change draft marks component metadataChanged when nodeLogicEnabled toggles
    const store = createCanonicalEditorStore(createEditorState(project));
    const events: Array<{ components: Array<{ componentId: string; metadataChanged: boolean }> }> = [];
    const unsubscribe = store.subscribeChanges((ev) => {
      events.push(ev.change);
    });
    const client = createMainCanvasCommandClient(store);
    const storeComp = store.getSnapshot().editorState.project.components[0];
    const toggleRes = client.updateComponentContract(
      {
        componentId: 'comp-gov',
        nodeLogicEnabled: true,
        expectedUpdatedAt: storeComp.updatedAt,
        expectedMasterDocument: storeComp.document,
      },
      'Enable component node logic',
    );
    unsubscribe();
    expect(toggleRes.status).toBe('applied');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].components.some((c) => c.componentId === 'comp-gov' && c.metadataChanged)).toBe(true);

    // 3. dispatchLegacyAction enforces componentSyncGuard on update-component-contract
    const updatedStoreComp = store.getSnapshot().editorState.project.components[0];
    const staleLegacyResult = store.dispatchLegacyAction({
      type: 'update-component-contract',
      componentId: 'comp-gov',
      nodeLogicEnabled: false,
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
      expectedMasterDocument: updatedStoreComp.document,
    });
    expect(staleLegacyResult.status).toBe('component-conflict');

    const legacyResult = store.dispatchLegacyAction({
      type: 'update-component-contract',
      componentId: 'comp-gov',
      nodeLogicEnabled: false,
      expectedUpdatedAt: updatedStoreComp.updatedAt,
      expectedMasterDocument: updatedStoreComp.document,
    });
    expect(legacyResult.status).toBe('committed');
    if (legacyResult.status === 'committed') {
      expect(Boolean(legacyResult.snapshot.editorState.project.components[0].nodeLogicEnabled)).toBe(false);
    }
  });

  it('BUG-18: geometryEngine supports ImageNode eyedropper stroke sampling and blocks move-layer inside locked container', () => {
    const project = createInitialProject('Geometry Hardening');
    const img = createImageFixture({ id: 'img-sample' });
    const lockedFrame = createFrameNode();
    lockedFrame.id = 'locked-container';
    lockedFrame.locked = true;
    const movableRect: RectNode = { ...createRectNode(), id: 'free-rect' };
    project.pages[0].document.nodes = [img, lockedFrame, movableRect];

    const sampleOp = createToolOperation(
      'eyedropper',
      'main',
      {
        kind: 'sample-color',
        color: '#ff00aa',
        sourceName: 'Canvas',
        target: 'stroke',
      },
      { description: 'Sample stroke onto image' },
    );
    const sampleResult = evaluateToolOperation(sampleOp, {
      document: project.pages[0].document,
      selectedNodeIds: ['img-sample'],
    });
    expect(sampleResult.status).toBe('ready');
    if (sampleResult.status === 'ready' && sampleResult.operation.payload.kind === 'sample-color') {
      const updatedImg = sampleResult.operation.payload.resolvedNodesToUpdate[0] as ImageNode;
      expect(updatedImg.style.stroke).toBe('#ff00aa');
    }

    const moveOp = createToolOperation(
      'select',
      'main',
      {
        kind: 'move-layer',
        nodeId: 'free-rect',
        targetId: 'locked-container',
        position: 'inside',
      },
      { description: 'Move into locked container' },
    );
    const moveIntoLocked = evaluateToolOperation(moveOp, {
      document: project.pages[0].document,
      selectedNodeIds: ['free-rect'],
    });
    expect(moveIntoLocked.status).toBe('rejected');
    if (moveIntoLocked.status === 'rejected') {
      expect(moveIntoLocked.code).toBe('LOCKED_TARGET');
    }
  });

  it('BUG-19: useMotionPlayback stops RAF cleanly and resets isPlaying to false at durationMs for non-looping clips', () => {
    hookState.reset();
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
          const id = nextRafId++;
          rafQueue.set(id, cb);
          return id;
        }),
        cancelAnimationFrame: vi.fn((id: number) => {
          rafQueue.delete(id);
        }),
      },
    });

    try {
      const project = createInitialProject('Motion Stop Test');
      const clip: AnimationClip = {
        id: 'clip-1',
        name: 'One-Shot',
        pageId: project.pages[0].id,
        durationMs: 200,
        loop: false,
        autoplay: false,
        tracks: [],
        createdAt: project.metadata.createdAt,
        updatedAt: project.metadata.updatedAt,
      };
      project.animations = [clip];

      const renderHook = () => {
        hookState.beginRender();
        return useMotionPlayback({
          project,
          activePage: project.pages[0],
          selectedNodeIds: [],
          mainCommandClient: {} as never,
          onNotice: () => {},
        });
      };

      let controller = renderHook();
      controller.toggleMotionOpen();
      controller = renderHook();
      controller.play();
      controller = renderHook();

      expect(controller.isPlaying).toBe(true);
      expect(rafQueue.size).toBe(1);

      const stepFrame = (ts: number) => {
        const entries = Array.from(rafQueue.entries());
        rafQueue.clear();
        for (const [, cb] of entries) {
          cb(ts);
        }
        controller = renderHook();
      };

      stepFrame(0);
      stepFrame(90);
      stepFrame(180);
      stepFrame(270);

      expect(controller.playheadMs).toBe(200);
      expect(controller.isPlaying).toBe(false);
      expect(rafQueue.size).toBe(0);
    } finally {
      hookState.reset();
      if (prevWindow) {
        Object.defineProperty(globalThis, 'window', prevWindow);
      } else {
        delete (globalThis as Record<string, unknown>).window;
      }
    }
  });
});

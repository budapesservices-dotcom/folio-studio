import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  wouldCreateComponentCycle,
} from '../src/core/document/components';
import {
  buildCssBackgroundFromFills,
  buildCssEffectsAndBlendDeclarations,
  createDefaultLinearGradientFill,
  createDefaultRadialGradientFill,
  createDefaultVisualEffect,
  serializeNodeSvgStyleDefs,
} from '../src/core/document/styling';
import {
  applyTextTransform,
  getSvgTextAnchorAndX,
  wrapTextLines,
} from '../src/core/document/typography';
import {
  buildCustomFontFaceCss,
  buildGoogleFontsStylesheetUrl,
  collectProjectGoogleFonts,
} from '../src/core/document/fonts';
import { requireValidProject, validateProject } from '../src/core/document/validation';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { getActivePage } from '../src/core/document/project';
import type {
  AssetReference,
  ComponentDefinition,
  ImageNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import {
  computeBytesSha256,
  createImageNodeFromAsset,
  getAssetBundlePath,
  ingestImageBytes,
  sanitizeSvgMarkup,
} from '../src/core/persistence/assetStore';
import { parseProjectJsonSafe } from '../src/core/persistence/projectFile';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { buildLivePreviewHtml, compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { buildCompiledProjectBundle } from '../src/engines/codegen/projectBundle';
import { parseZipArchive } from '../src/engines/codegen/zipArchive';

// Minimal valid 1x1 transparent PNG
const SAMPLE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeRect(id: string, name: string, overrides: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: 'rect',
    name,
    x: 20,
    y: 20,
    width: 180,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: '#6366F1',
      stroke: '#111827',
      strokeWidth: 0,
      radius: 12,
    },
    ...overrides,
  };
}

function makeText(id: string, name: string, text: string, overrides: Partial<TextNode> = {}): TextNode {
  return {
    id,
    type: 'text',
    name,
    x: 24,
    y: 24,
    width: 240,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text,
    style: {
      fill: '#111827',
      fontSize: 16,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: 0,
    },
    ...overrides,
  };
}

describe('Prioritas 2 — Pillar 1: Nested Component Instances (DAG, Rendering & React Codegen)', () => {
  it('validates 3-level acyclic nested components and rejects self & transitive cycles', () => {
    const project = createInitialProject('Nested DAG');
    const iconBadge: ComponentDefinition = {
      id: 'comp-badge',
      name: 'Status Badge',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      document: {
        id: 'doc-badge',
        name: 'Status Badge',
        width: 80,
        height: 28,
        background: '#00000000',
        nodes: [
          makeRect('badge-bg', 'Badge Pill', { x: 0, y: 0, width: 80, height: 28 }),
          makeText('badge-lbl', 'Badge Label', 'PRO', { x: 10, y: 4, width: 60, height: 20 }),
        ],
      },
      variants: [
        {
          id: 'axis-tone',
          name: 'Tone',
          defaultOptionId: 'opt-primary',
          options: [
            { id: 'opt-primary', label: 'Primary', overrides: {} },
            { id: 'opt-success', label: 'Success', overrides: { 'badge-bg': { fill: '#10B981' } } },
          ],
        },
      ],
    };

    const badgeInstInCard = createComponentInstance(iconBadge, 16, 16, 'inst-badge-in-card');
    badgeInstInCard.variantSelection = { 'axis-tone': 'opt-success' };

    const cardComp: ComponentDefinition = {
      id: 'comp-card',
      name: 'Feature Card',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      document: {
        id: 'doc-card',
        name: 'Feature Card',
        width: 280,
        height: 160,
        background: '#00000000',
        nodes: [
          makeRect('card-bg', 'Card Surface', { x: 0, y: 0, width: 280, height: 160 }),
          badgeInstInCard,
        ],
      },
    };

    const cardInstInSection = createComponentInstance(cardComp, 24, 24, 'inst-card-in-section');
    const sectionComp: ComponentDefinition = {
      id: 'comp-section',
      name: 'Hero Section',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      document: {
        id: 'doc-section',
        name: 'Hero Section',
        width: 400,
        height: 240,
        background: '#00000000',
        nodes: [cardInstInSection],
      },
    };

    project.components = [iconBadge, cardComp, sectionComp];
    const page = getActivePage(project);
    page.document.nodes = [createComponentInstance(sectionComp, 40, 40, 'inst-section-root')];

    // 1. Valid 3-level DAG passes validation & cycle checks
    expect(validateProject(project).ok).toBe(true);
    expect(wouldCreateComponentCycle(project.components, 'comp-section', 'comp-badge')).toBe(false);
    expect(wouldCreateComponentCycle(project.components, 'comp-badge', 'comp-section')).toBe(true);
    expect(wouldCreateComponentCycle(project.components, 'comp-badge', 'comp-badge')).toBe(true);

    // 2. Recursive visual SVG export renders innermost Badge text ("PRO") & green variant fill
    const svg = serializeDocumentToSvgString(page.document, project.components);
    expect(svg).toContain('PRO');
    expect(svg).toContain('#10B981');

    // 3. HTML/CSS compilation expands nested components cleanly
    const compiledHtml = compilePageHtmlCss(project, page);
    expect(compiledHtml.htmlFile.content).toContain('PRO');
    expect(compiledHtml.cssFile.content).toContain('#10B981');

    // 4. React compiler emits clean ES imports & nested JSX props for Master Components
    const reactFiles = compileReactProjectFiles(project, page.id);
    const cardTsx = reactFiles.find((f) => f.path === 'src/components/FeatureCard.tsx');
    const sectionTsx = reactFiles.find((f) => f.path === 'src/components/HeroSection.tsx');
    expect(cardTsx).toBeDefined();
    expect(cardTsx!.content).toContain("import { StatusBadge } from './StatusBadge';");
    expect(cardTsx!.content).toContain('<StatusBadge');
    expect(cardTsx!.content).toContain('tone="Success"');
    expect(sectionTsx).toBeDefined();
    expect(sectionTsx!.content).toContain("import { FeatureCard } from './FeatureCard';");
    expect(sectionTsx!.content).toContain('<FeatureCard');

    // 5. Direct self-cycle (A -> A) is rejected
    const cyclicSelfProject = structuredClone(project);
    cyclicSelfProject.components[0].document.nodes.push(
      createComponentInstance(iconBadge, 0, 0, 'inst-self-cycle'),
    );
    const selfRes = validateProject(cyclicSelfProject);
    expect(selfRes.ok).toBe(false);
    expect(selfRes.error?.toLowerCase()).toContain('circular');

    // 6. Transitive cycle (Badge -> Section -> Card -> Badge) is rejected
    const cyclicTransitive = structuredClone(project);
    cyclicTransitive.components[0].document.nodes.push(
      createComponentInstance(sectionComp, 0, 0, 'inst-transitive-cycle'),
    );
    const transitiveRes = validateProject(cyclicTransitive);
    expect(transitiveRes.ok).toBe(false);
    expect(transitiveRes.error?.toLowerCase()).toContain('circular');
  });

  it('preserves nested component instances when building a new Master Component from selection', () => {
    const childComp: ComponentDefinition = {
      id: 'comp-pill',
      name: 'Pill',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      document: {
        id: 'doc-pill',
        name: 'Pill',
        width: 90,
        height: 30,
        background: '#00000000',
        nodes: [makeRect('pill-rect', 'Pill Rect', { x: 0, y: 0, width: 90, height: 30 })],
      },
    };
    const inst = createComponentInstance(childComp, 30, 30, 'inst-pill');
    const bg = makeRect('wrap-bg', 'Wrap', { x: 10, y: 10, width: 160, height: 80 });
    const built = buildComponentDefinitionFromNodes([bg, inst], ['wrap-bg', 'inst-pill'], 'Composite');
    expect(built).not.toBeNull();
    expect(built!.document.nodes.some((n) => n.type === 'component-instance' && n.componentId === 'comp-pill')).toBe(true);
  });
});

describe('Prioritas 2 — Pillar 2: ImageNode & Binary Asset Pipeline (Deduplication, SVG Sanitization, ZIP & .flop)', () => {
  it('sanitizes malicious SVG markup by stripping scripts, event handlers, foreignObject, and javascript: URIs', () => {
    const hostileSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert(1)">
        <script>fetch('https://evil.test')</script>
        <foreignObject width="100" height="50"><div>xss</div></foreignObject>
        <a href="javascript:alert(2)"><rect width="120" height="80" fill="#22C55E" onclick="evil()" /></a>
      </svg>
    `;
    const clean = sanitizeSvgMarkup(hostileSvg);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<foreignObject/i);
    expect(clean).not.toMatch(/onload\s*=/i);
    expect(clean).not.toMatch(/onclick\s*=/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain('#22C55E');
  });

  it('deduplicates identical binary images by SHA-256, commits atomically via Native Command, and bundles into SVG, Live Preview, React, HTML ZIP & .flop', async () => {
    const hashA = await computeBytesSha256(SAMPLE_PNG_BYTES);
    const hashB = await computeBytesSha256(new Uint8Array(SAMPLE_PNG_BYTES));
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);

    const first = await ingestImageBytes({
      name: 'hero-banner.png',
      mimeType: 'image/png',
      bytes: SAMPLE_PNG_BYTES,
      width: 320,
      height: 200,
    });
    expect(first.deduplicated).toBe(false);
    expect(first.asset.sha256).toBe(hashA);
    expect(first.asset.source.startsWith('data:image/png;base64,')).toBe(true);

    // Ingesting identical bytes with a different filename reuses the exact same asset reference
    const second = await ingestImageBytes(
      {
        name: 'duplicate-copy.png',
        mimeType: 'image/png',
        bytes: SAMPLE_PNG_BYTES,
      },
      [first.asset],
    );
    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);

    // Insert via atomic Native Command transaction (asset.upsert + node.create)
    const project = createInitialProject('Media Studio');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const imageNode: ImageNode = createImageNodeFromAsset(first.asset, {
      x: 80,
      y: 60,
      maxDimension: 320,
    });
    imageNode.style.radius = 16;

    const tx = client.insertImageWithAsset(first.asset, imageNode);
    expect(tx.status).toBe('applied');
    const updatedProject = store.getSnapshot().editorState.project;
    expect(updatedProject.assets).toHaveLength(1);
    expect(validateProject(updatedProject).ok).toBe(true);

    const activePage = getActivePage(updatedProject);
    const bundlePath = getAssetBundlePath(first.asset);
    expect(bundlePath).toMatch(/^assets\/hero-banner-[0-9a-f]{8}\.png$/);

    // 1. Standalone SVG export embeds <image href="data:image/png;base64,..." />
    const svg = serializeDocumentToSvgString(activePage.document, updatedProject.components, {
      assets: updatedProject.assets,
    });
    expect(svg).toContain('<image ');
    expect(svg).toContain('data:image/png;base64,');

    // 2. Live Preview inlines data URL so strict CSP img-src data: blob: renders it
    const liveHtml = buildLivePreviewHtml(updatedProject);
    expect(liveHtml).toContain('<img ');
    expect(liveHtml).toContain('data:image/png;base64,');

    // 3. HTML/CSS ZIP bundle packs the real binary PNG bytes at assets/...
    const htmlZip = buildCompiledProjectBundle(updatedProject, { target: 'html-css' });
    const parsedHtmlZip = parseZipArchive(htmlZip.zipBytes);
    const htmlAssetEntry = parsedHtmlZip.find((entry) => entry.path === bundlePath);
    expect(htmlAssetEntry).toBeDefined();
    expect(htmlAssetEntry!.data).toEqual(SAMPLE_PNG_BYTES);

    // 4. React/Vite ZIP bundle packs the real binary PNG bytes at public/assets/... and references /assets/...
    const reactZip = buildCompiledProjectBundle(updatedProject, { target: 'react' });
    const parsedReactZip = parseZipArchive(reactZip.zipBytes);
    const reactAssetEntry = parsedReactZip.find((entry) => entry.path === `public/${bundlePath}`);
    expect(reactAssetEntry).toBeDefined();
    expect(reactAssetEntry!.data).toEqual(SAMPLE_PNG_BYTES);
    const reactPageEntry = parsedReactZip.find((entry) => entry.path.startsWith('src/pages/') && entry.path.endsWith('.tsx'));
    expect(reactPageEntry).toBeDefined();
    expect(new TextDecoder().decode(reactPageEntry!.data)).toContain(`src="/${bundlePath}"`);

    // 5. .flop v2 round-trip preserves AssetReference + ImageNode intact
    const serializedFlop = JSON.stringify(requireValidProject(updatedProject));
    const parsedFlop = migrateProjectToV2(parseProjectJsonSafe(serializedFlop));
    expect(parsedFlop.assets).toHaveLength(1);
    expect(parsedFlop.assets[0].sha256).toBe(hashA);
    const restoredNode = getActivePage(parsedFlop).document.nodes.find((n) => n.id === imageNode.id);
    expect(restoredNode?.type).toBe('image');

    // 6. Atomic Undo removes both image node and asset cleanly
    client.undo();
    expect(store.getSnapshot().editorState.project.assets).toHaveLength(0);
    expect(getActivePage(store.getSnapshot().editorState.project).document.nodes.some((n) => n.id === imageNode.id)).toBe(false);
  });
});

describe('Prioritas 2 — Pillar 3: Modern Styling & Typography Engine', () => {
  it('compiles multi-fill Linear/Radial Gradients, Drop/Inner Shadow, Layer/Backdrop Blur & Blend Modes identically for SVG and CSS', () => {
    const linear = createDefaultLinearGradientFill('fill-lin');
    const radial = createDefaultRadialGradientFill('fill-rad');
    const dropShadow = createDefaultVisualEffect('drop-shadow', 'fx-drop');
    const innerShadow = createDefaultVisualEffect('inner-shadow', 'fx-inner');
    const layerBlur = createDefaultVisualEffect('layer-blur', 'fx-blur');
    const glassBlur = createDefaultVisualEffect('backdrop-blur', 'fx-glass');

    const card = makeRect('glass-card', 'Glass Hero Card', {
      blendMode: 'screen',
      style: {
        fill: '#6366F1',
        fills: [
          { id: 'fill-solid', type: 'solid', color: '#0F172A', opacity: 0.65, visible: true },
          linear,
          radial,
        ],
        stroke: '#FFFFFF',
        strokeWidth: 1,
        radius: 20,
      },
      effects: [dropShadow, innerShadow, layerBlur, glassBlur],
    });

    // Pure CSS output
    const cssBg = buildCssBackgroundFromFills(card.style.fills, card.style.fill);
    expect(cssBg).toContain('linear-gradient(');
    expect(cssBg).toContain('radial-gradient(');
    const effectDecls = buildCssEffectsAndBlendDeclarations(card);
    expect(effectDecls.some((d) => d.startsWith('box-shadow:') && d.includes('inset'))).toBe(true);
    expect(effectDecls.some((d) => d.startsWith('filter: blur('))).toBe(true);
    expect(effectDecls.some((d) => d.startsWith('backdrop-filter: blur('))).toBe(true);
    expect(effectDecls.some((d) => d.startsWith('-webkit-backdrop-filter: blur('))).toBe(true);
    expect(effectDecls).toContain('mix-blend-mode: screen;');

    // Pure SVG <defs> output
    const svgDefs = serializeNodeSvgStyleDefs(card, 'test-scope');
    expect(svgDefs).toContain('<linearGradient ');
    expect(svgDefs).toContain('<radialGradient ');
    expect(svgDefs).toContain('<filter ');
    expect(svgDefs).toContain('<feDropShadow ');
    expect(svgDefs).toContain('<feGaussianBlur ');

    // Full project validation + visual SVG export + CSS compilation
    const project = createInitialProject('Modern Visuals');
    const page = getActivePage(project);
    page.document.nodes = [card];
    expect(validateProject(project).ok).toBe(true);

    const exportedSvg = serializeDocumentToSvgString(page.document, []);
    expect(exportedSvg).toContain('<linearGradient ');
    expect(exportedSvg).toContain('backdrop-filter:blur(');
    expect(exportedSvg).toContain('mix-blend-mode:screen');

    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.cssFile.content).toContain('linear-gradient(');
    expect(compiled.cssFile.content).toContain('backdrop-filter: blur(');
    expect(compiled.cssFile.content).toContain('mix-blend-mode: screen;');
  });

  it('performs deterministic auto text-wrapping, text alignment, transforms, and Google Fonts / @font-face emission', () => {
    const textNode = makeText(
      'wrapped-heading',
      'Wrapped Heading',
      'Build world class visual design systems with Folio Studio',
      {
        width: 180,
        height: 120,
        style: {
          fill: '#0F172A',
          fontSize: 20,
          fontFamily: '"Playfair Display", Georgia, serif',
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: 0.5,
          textAlign: 'center',
          textWrap: 'wrap',
          textTransform: 'uppercase',
          textDecoration: 'underline',
        },
      },
    );

    const wrapped = wrapTextLines(textNode.text, {
      maxWidth: textNode.width,
      fontSize: textNode.style.fontSize,
      fontFamily: textNode.style.fontFamily,
      fontWeight: textNode.style.fontWeight,
      letterSpacing: textNode.style.letterSpacing,
      textWrap: textNode.style.textWrap,
      textTransform: textNode.style.textTransform,
    });
    expect(wrapped.length).toBeGreaterThan(2);
    expect(wrapped[0]).toBe(wrapped[0].toUpperCase());
    expect(applyTextTransform('hello world', 'capitalize')).toBe('Hello World');
    expect(getSvgTextAnchorAndX(textNode.x, textNode.width, textNode.style.textAlign)).toEqual({
      anchor: 'middle',
      xPos: 114,
    });

    // No-wrap mode preserves single line
    const noWrap = wrapTextLines(textNode.text, {
      maxWidth: textNode.width,
      fontSize: textNode.style.fontSize,
      fontFamily: textNode.style.fontFamily,
      fontWeight: textNode.style.fontWeight,
      letterSpacing: textNode.style.letterSpacing,
      textWrap: 'nowrap',
      textTransform: textNode.style.textTransform,
    });
    expect(noWrap).toHaveLength(1);

    // Google Fonts + Custom @font-face collection & compilation
    const project = createInitialProject('Typography Lab');
    const customFontAsset: AssetReference = {
      id: 'font-brand-1',
      name: 'Brand Display',
      kind: 'font',
      mimeType: 'font/woff2',
      source: 'data:font/woff2;base64,d09GMgABAAAAAA==',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    project.assets = [customFontAsset];
    const page = getActivePage(project);
    page.document.nodes = [textNode];

    const googleFonts = collectProjectGoogleFonts(project);
    expect(googleFonts).toContain('Playfair Display');
    const gfUrl = buildGoogleFontsStylesheetUrl(googleFonts);
    expect(gfUrl).toContain('https://fonts.googleapis.com/css2?family=Playfair+Display');

    const fontFaceCss = buildCustomFontFaceCss(project.assets);
    expect(fontFaceCss).toContain('@font-face');
    expect(fontFaceCss).toContain('font-family: "Brand Display"');

    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.htmlFile.content).toContain('https://fonts.googleapis.com/css2?family=Playfair+Display');
    expect(compiled.cssFile.content).toContain('text-align: center;');
    expect(compiled.cssFile.content).toContain('text-transform: uppercase;');
    expect(compiled.cssFile.content).toContain('text-decoration: underline;');

    const liveHtml = buildLivePreviewHtml(project);
    expect(liveHtml).toContain('https://fonts.googleapis.com/css2?family=Playfair+Display');
    expect(liveHtml).toContain('font-family: "Brand Display"');

    const svg = serializeDocumentToSvgString(page.document, []);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('<tspan ');
  });
});

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createApplicationWithHomePage } from '../src/core/document/applications';
import {
  createEllipseNode,
  createEmptyDocument,
  createInitialProject,
} from '../src/core/document/factory';
import {
  clearMorphPairCache,
  createMorphPresetSnapshot,
  evaluateMorphSnapshotsToAnchors,
  evaluatePreparedMorphPairToGeometry,
  extractMorphSnapshotFromNode,
  interpolatePathMorph,
  parsePathMorphSnapshot,
  prepareMorphPair,
} from '../src/core/document/pathMorph';
import { getActivePage } from '../src/core/document/project';
import type { AssetReference, FolioPage, ImageNode, PathNode } from '../src/core/document/types';
import { getAssetBundlePath } from '../src/core/persistence/assetStore';
import { buildLivePreviewMorphScript } from '../src/engines/animation/codegen';
import {
  applyAnimatedPosesToDocument,
  createAnimationClip,
  evaluateClipAtTime,
} from '../src/engines/animation/evaluator';
import { buildSvgPathMorphSmil } from '../src/engines/animation/svgExport';
import { buildCompiledProjectBundle } from '../src/engines/codegen/projectBundle';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { parseZipArchive } from '../src/engines/codegen/zipArchive';
import { RUNTIME_FEATURE_PARITY_MATRIX } from '../src/engines/prototype/parity';

function makeCompoundBoxWithHole(
  id: string,
  outerInset: number,
  holeInset: number,
  width = 160,
  height = 160,
): PathNode {
  return {
    id,
    type: 'path',
    name: `Compound ${id}`,
    parentId: null,
    x: 40,
    y: 40,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: true,
    style: {
      fill: '#38BDF8',
      fillRule: 'evenodd',
      stroke: '#0F172A',
      strokeWidth: 2,
    },
    points: [
      { id: `${id}-o0`, x: outerInset, y: outerInset, pointType: 'corner' },
      { id: `${id}-o1`, x: width - outerInset, y: outerInset, pointType: 'corner' },
      { id: `${id}-o2`, x: width - outerInset, y: height - outerInset, pointType: 'corner' },
      { id: `${id}-o3`, x: outerInset, y: height - outerInset, pointType: 'corner' },
    ],
    subpaths: [
      {
        closed: true,
        points: [
          { id: `${id}-h0`, x: holeInset, y: holeInset, pointType: 'corner' },
          { id: `${id}-h1`, x: width - holeInset, y: holeInset, pointType: 'corner' },
          { id: `${id}-h2`, x: width - holeInset, y: height - holeInset, pointType: 'corner' },
          { id: `${id}-h3`, x: holeInset, y: height - holeInset, pointType: 'corner' },
        ],
      },
    ],
  };
}

function makeImageNode(id: string, assetId: string, x: number, y: number, width: number, height: number): ImageNode {
  return {
    id,
    type: 'image',
    name: `Image ${id}`,
    parentId: null,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId,
    alt: `Asset ${id}`,
    style: {
      fit: 'cover',
    },
  };
}

function makeBase64DataUrl(mimeType: string, rawText: string): string {
  const bytes = new TextEncoder().encode(rawText);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

describe('Shape Morph Phase 3 (Multi-Contour + React TSX Runtime)', () => {
  it('interpolates multi-contour compound paths with holes smoothly across geometry, evaluator, SVG SMIL, Live Preview, and React TSX', () => {
    clearMorphPairCache();
    const donutA = makeCompoundBoxWithHole('donut-a', 0, 48, 160, 160);
    const donutB = makeCompoundBoxWithHole('donut-b', 16, 36, 160, 160);

    const snapA = extractMorphSnapshotFromNode(donutA)!;
    const snapB = extractMorphSnapshotFromNode(donutB)!;
    expect(parsePathMorphSnapshot(snapA)?.subpaths?.length).toBe(1);
    expect(parsePathMorphSnapshot(snapB)?.subpaths?.length).toBe(1);

    const pair = prepareMorphPair(snapA, snapB);
    expect(pair).not.toBeNull();
    expect(pair!.subpathPairs?.length).toBe(1);

    const mid = evaluateMorphSnapshotsToAnchors(snapA, snapB, 0.5);
    expect(mid).not.toBeNull();
    expect(mid!.subpaths?.length).toBe(1);
    expect(mid!.subpaths![0].points.length).toBeGreaterThanOrEqual(4);

    // Midpoint inner hole coordinates should be strictly between donutA (48..112) and donutB (36..124)
    const minHoleX = Math.min(...mid!.subpaths![0].points.map((pt) => pt.x));
    expect(minHoleX).toBeGreaterThan(39);
    expect(minHoleX).toBeLessThan(45);

    // Snapshot-level interpolation also preserves subpaths
    const midSnap = parsePathMorphSnapshot(interpolatePathMorph(snapA, snapB, 0.5));
    expect(midSnap?.subpaths?.length).toBe(1);

    // Wire into a full project clip and check Canvas Evaluator, SVG SMIL, Live Preview, and React TSX
    const project = createInitialProject('Multi-Contour Studio');
    const page = getActivePage(project);
    page.document.nodes = [donutA];
    const clip = createAnimationClip({
      id: 'clip-donut',
      pageId: page.id,
      name: 'Donut Pulse',
      durationMs: 1000,
      autoplay: true,
      loop: true,
      tracks: [
        {
          id: 'trk-donut',
          targetNodeId: donutA.id,
          property: 'pathMorph',
          keyframes: [
            { id: 'kf0', timeMs: 0, value: snapA, easing: 'ease-in-out' },
            { id: 'kf1', timeMs: 1000, value: snapB, easing: 'ease-in-out' },
          ],
        },
      ],
    });
    project.animations = [clip];

    // 1. Canvas evaluator
    const poses = evaluateClipAtTime(clip, 500);
    const pose = poses[donutA.id];
    expect(pose?.pathMorphGeometry?.subpaths?.length).toBe(1);
    const animatedDoc = applyAnimatedPosesToDocument(page.document, poses);
    const animatedPath = animatedDoc.nodes.find((n) => n.id === donutA.id) as PathNode;
    expect(animatedPath.subpaths?.length).toBe(1);
    expect(animatedPath.style.fillRule).toBe('evenodd');

    // 2. Animated SVG SMIL export emits two closed `M ... Z` contours per keyframe
    const smil = buildSvgPathMorphSmil(clip.tracks[0], clip, donutA.x, donutA.y);
    expect(smil).not.toBeNull();
    expect(smil!.animateMarkup).toContain('<animate attributeName="d"');
    expect((smil!.initialD.match(/M /g) ?? []).length).toBe(2);
    const valuesMatch = smil!.animateMarkup.match(/values="([^"]+)"/);
    expect(valuesMatch).not.toBeNull();
    const frames = valuesMatch![1].split(';');
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const frameD of frames) {
      expect((frameD.match(/M /g) ?? []).length).toBe(2);
    }

    // 3. Live Preview morph script encodes subpaths and enforces evenodd
    const liveScript = buildLivePreviewMorphScript(project, page);
    expect(liveScript).toContain('"subpaths"');
    expect(liveScript).toContain('fill-rule');
    expect(liveScript).toContain('evenodd');
    expect(liveScript).not.toContain('eval(');

    // 4. React TSX compiler generates strict-TS useFolioShapeMorph hook and multi-contour JSX
    const reactFiles = compileReactProjectFiles(project);
    const hookFile = reactFiles.find((f) => f.path === 'src/motion/useFolioShapeMorph.ts');
    const pageFile = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'));
    expect(hookFile).toBeDefined();
    expect(pageFile).toBeDefined();
    expect(pageFile!.content).toContain('useFolioShapeMorph(FOLIO_MORPH_CLIPS)');
    expect(pageFile!.content).toContain('data-folio-morph-path="true"');
    expect(pageFile!.content).toContain('fillRule="evenodd"');

    // Verify zero TypeScript diagnostics under strict transpile for both hook and page TSX
    for (const file of [hookFile!, pageFile!]) {
      const transpiled = ts.transpileModule(file.content, {
        fileName: file.path,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          strict: true,
        },
      });
      expect(transpiled.diagnostics ?? []).toEqual([]);
      expect(file.content).not.toContain('eval(');
      expect(file.content).not.toContain('new Function');
      expect(file.content).not.toContain('innerHTML');
    }

    const parityEntry = RUNTIME_FEATURE_PARITY_MATRIX.find((e) => e.feature === 'motion.shape-morph');
    expect(parityEntry).toMatchObject({
      headless: 'full',
      livePreview: 'full',
      reactCodegen: 'full',
    });
  });

  it('morphs smoothly between mismatched contour counts (single-contour Circle -> compound Donut with hole)', () => {
    clearMorphPairCache();
    const circleSnap = createMorphPresetSnapshot('circle', 160, 160);
    const donutSnap = extractMorphSnapshotFromNode(makeCompoundBoxWithHole('donut-target', 0, 48, 160, 160))!;

    const pair = prepareMorphPair(circleSnap, donutSnap);
    expect(pair).not.toBeNull();
    expect(pair!.subpathPairs?.length).toBe(1);

    // Endpoint fast-path at t=0 preserves exact Circle without redundant degenerate subpaths
    const atExactStart = evaluateMorphSnapshotsToAnchors(circleSnap, donutSnap, 0)!;
    expect(atExactStart.subpaths).toBeUndefined();

    // Right after start (t=0.001), the partner hole emerges smoothly from its centroid (80, 80)
    const justStarted = evaluatePreparedMorphPairToGeometry(pair!, 0.001);
    expect(justStarted.subpaths?.length).toBe(1);
    for (const pt of justStarted.subpaths![0].points) {
      expect(pt.x).toBeCloseTo(80, 1);
      expect(pt.y).toBeCloseTo(80, 1);
    }

    // At t=0.5 the hole has opened halfway toward [48..112] -> [64..96]
    const atMid = evaluateMorphSnapshotsToAnchors(circleSnap, donutSnap, 0.5)!;
    const midXs = atMid.subpaths![0].points.map((pt) => pt.x);
    expect(Math.min(...midXs)).toBeCloseTo(64, 1);
    expect(Math.max(...midXs)).toBeCloseTo(96, 1);

    // At t=1.0 the hole reaches full [48..112]
    const atEnd = evaluateMorphSnapshotsToAnchors(circleSnap, donutSnap, 1)!;
    const endXs = atEnd.subpaths![0].points.map((pt) => pt.x);
    expect(Math.min(...endXs)).toBeCloseTo(48, 1);
    expect(Math.max(...endXs)).toBeCloseTo(112, 1);
  });

  it('projects morphed primitive Ellipse nodes in React TSX as inline SVG morph paths with valid strict TypeScript', () => {
    const project = createInitialProject('Primitive React Morph');
    const page = getActivePage(project);
    const orb = {
      ...createEllipseNode(0),
      id: 'hero-orb',
      name: 'Hero Orb',
      x: 100,
      y: 80,
      width: 140,
      height: 140,
      style: {
        fill: '#6366F1',
        stroke: 'transparent',
        strokeWidth: 0,
      },
    };
    page.document.nodes = [orb];
    project.animations = [
      createAnimationClip({
        id: 'clip-orb',
        pageId: page.id,
        name: 'Orb To Star',
        durationMs: 1200,
        autoplay: true,
        tracks: [
          {
            id: 'trk-orb',
            targetNodeId: orb.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'k0', timeMs: 0, value: createMorphPresetSnapshot('circle', 140, 140), easing: 'ease-in-out' },
              { id: 'k1', timeMs: 1200, value: createMorphPresetSnapshot('star', 140, 140), easing: 'ease-in-out' },
            ],
          },
        ],
      }),
    ];

    const files = compileReactProjectFiles(project);
    const pageTsx = files.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))!;
    expect(pageTsx.content).toContain('data-folio-id="hero-orb"');
    expect(pageTsx.content).toContain('data-folio-morph-path="true"');
    expect(pageTsx.content).toContain('useFolioShapeMorph(FOLIO_MORPH_CLIPS)');

    const transpiled = ts.transpileModule(pageTsx.content, {
      fileName: pageTsx.path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
      },
    });
    expect(transpiled.diagnostics ?? []).toEqual([]);
  });
});

describe('Free Static Deploy-Ready Export Bundles (Cloudflare Pages, Netlify, GitHub Pages)', () => {
  function buildMultiAppProjectWithAssets() {
    const project = createInitialProject('Folio Free Launch');
    const mainPage = getActivePage(project);

    const verboseSvg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- exported by vector tool -->',
      '<svg xmlns="http://www.w3.org/2000/svg"   viewBox="0 0 64 64"  >',
      '  <metadata>author metadata payload</metadata>',
      '  <circle   cx="32"   cy="32"   r="28"   fill="#2563EB"  />',
      '</svg>',
    ].join('\n');

    const identicalPngBytes = 'FAKE_PNG_BINARY_PAYLOAD_1234567890_REPEATED_ASSET';
    const svgAsset: AssetReference = {
      id: 'asset-logo-svg',
      name: 'brand-logo.svg',
      kind: 'image',
      mimeType: 'image/svg+xml',
      source: makeBase64DataUrl('image/svg+xml', verboseSvg),
      byteLength: verboseSvg.length,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pngAssetA: AssetReference = {
      id: 'asset-hero-a',
      name: 'hero-a.png',
      kind: 'image',
      mimeType: 'image/png',
      source: makeBase64DataUrl('image/png', identicalPngBytes),
      byteLength: identicalPngBytes.length,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pngAssetB: AssetReference = {
      id: 'asset-hero-b',
      name: 'hero-b.png',
      kind: 'image',
      mimeType: 'image/png',
      source: makeBase64DataUrl('image/png', identicalPngBytes),
      byteLength: identicalPngBytes.length,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    project.assets = [svgAsset, pngAssetA, pngAssetB];

    mainPage.document.nodes = [
      makeImageNode('hero-card-a', pngAssetA.id, 40, 40, 320, 180),
      makeImageNode('logo-card', svgAsset.id, 400, 40, 96, 96),
    ];

    // Add a second page inside Main App
    const pricingDoc = createEmptyDocument('Pricing', 1440, 900);
    pricingDoc.nodes = [makeImageNode('pricing-card-dup', pngAssetB.id, 60, 60, 320, 180)];
    const pricingPage: FolioPage = {
      id: 'page-pricing',
      name: 'Pricing',
      route: '/pricing',
      applicationId: mainPage.applicationId ?? 'app-main',
      document: pricingDoc,
    };

    // Add a second application ("Admin Portal" at /admin-portal)
    const { application: adminApp, homePage: adminHome } = createApplicationWithHomePage(
      project,
      'Admin Portal',
    );
    project.applications = [
      ...(project.applications ?? [
        { id: 'app-main', name: 'Main App', slug: 'main-app', basePath: '/' },
      ]),
      adminApp,
    ];
    project.pages = [mainPage, pricingPage, adminHome];
    return project;
  }

  it('builds a complete zero-cost deploy-ready React ZIP with Cloudflare Pages, Netlify, GitHub Pages, multi-app routing, SVG minification, and binary deduplication', () => {
    const project = buildMultiAppProjectWithAssets();
    const bundle = buildCompiledProjectBundle(project, { target: 'react' });

    expect(bundle.optimization.deployTargets).toEqual([
      'cloudflare-pages',
      'netlify',
      'github-pages',
    ]);
    expect(bundle.optimization.applicationCount).toBe(2);
    expect(bundle.optimization.pageCount).toBe(3);
    expect(bundle.optimization.optimizedSvgCount).toBe(1);
    expect(bundle.optimization.deduplicatedAssetCount).toBe(1);
    expect(bundle.optimization.savedBytes).toBeGreaterThan(0);

    const parsed = parseZipArchive(bundle.zipBytes);
    const byPath = new Map(parsed.map((entry) => [entry.path, new TextDecoder().decode(entry.data)]));

    // Free static host configs
    expect(byPath.get('public/_redirects')).toContain('/* /index.html 200');
    expect(byPath.get('public/_headers')).toContain('X-Content-Type-Options: nosniff');
    expect(byPath.get('public/_headers')).toContain('Cache-Control: public, max-age=31536000, immutable');
    expect(byPath.get('netlify.toml')).toContain('command = "npm run build"');
    expect(byPath.get('netlify.toml')).toContain('publish = "dist"');
    expect(byPath.get('public/404.html')).toContain('folio_route=');
    expect(byPath.has('public/.nojekyll')).toBe(true);
    expect(byPath.get('.github/workflows/deploy-pages.yml')).toContain('actions/deploy-pages@v4');
    expect(byPath.get('.github/workflows/deploy-pages.yml')).toContain('VITE_BASE_PATH');
    expect(byPath.get('vite.config.ts')).toContain('VITE_BASE_PATH');
    expect(byPath.get('index.html')).toContain('name="folio-base-path"');
    expect(byPath.get('index.html')).toContain('folio_route');

    // Multi-app route manifest & browser SPA router
    const routesManifest = JSON.parse(byPath.get('public/folio-routes.json')!);
    expect(routesManifest.applications.length).toBe(2);
    expect(routesManifest.routes.map((r: { route: string }) => r.route)).toEqual([
      '/',
      '/pricing',
      '/admin-portal',
    ]);

    const appTsx = byPath.get('src/App.tsx')!;
    expect(appTsx).toContain('FOLIO_APP_ROUTES');
    expect(appTsx).toContain('popstate');
    expect(appTsx).toContain('pushState');
    expect(appTsx).not.toContain('import.meta');
    const appTranspile = ts.transpileModule(appTsx, {
      fileName: 'src/App.tsx',
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
      },
    });
    expect(appTranspile.diagnostics ?? []).toEqual([]);

    // Asset optimization: SVG minified & duplicate PNG collapsed to single canonical file
    const svgRelPath = getAssetBundlePath(project.assets[0]);
    const pngARelPath = getAssetBundlePath(project.assets[1]);
    const pngBRelPath = getAssetBundlePath(project.assets[2]);

    const minifiedSvg = byPath.get(`public/${svgRelPath}`)!;
    expect(minifiedSvg).toBeDefined();
    expect(minifiedSvg).not.toContain('<!-- exported by vector tool -->');
    expect(minifiedSvg).not.toContain('<metadata>');
    expect(minifiedSvg).toContain('<circle');

    expect(byPath.has(`public/${pngARelPath}`)).toBe(true);
    expect(byPath.has(`public/${pngBRelPath}`)).toBe(false);
    // Compiled TSX must rewrite duplicate reference to canonical asset path
    const allSrcFiles = Array.from(byPath.entries())
      .filter(([path]) => path.startsWith('src/'))
      .map(([, text]) => text)
      .join('\n');
    expect(allSrcFiles).not.toContain(pngBRelPath);
    expect(allSrcFiles).toContain(pngARelPath);

    // README documents all 3 zero-cost hosting providers
    const readme = byPath.get('README.md')!;
    expect(readme).toContain('Cloudflare Pages');
    expect(readme).toContain('Netlify');
    expect(readme).toContain('GitHub Pages');
  });

  it('builds a complete zero-cost deploy-ready HTML5 ZIP with multi-app route rewrites and asset optimization', () => {
    const project = buildMultiAppProjectWithAssets();
    const bundle = buildCompiledProjectBundle(project, { target: 'html-css' });

    expect(bundle.optimization.applicationCount).toBe(2);
    expect(bundle.optimization.pageCount).toBe(3);
    expect(bundle.optimization.optimizedSvgCount).toBe(1);
    expect(bundle.optimization.deduplicatedAssetCount).toBe(1);

    const parsed = parseZipArchive(bundle.zipBytes);
    const byPath = new Map(parsed.map((entry) => [entry.path, new TextDecoder().decode(entry.data)]));

    // Explicit clean URL rewrites for all pages across both applications
    const redirects = byPath.get('_redirects')!;
    expect(redirects).toContain('/pricing /pages/pricing.html 200');
    expect(redirects).toContain('/admin-portal /pages/admin-portal.html 200');

    const netlifyToml = byPath.get('netlify.toml')!;
    expect(netlifyToml).toContain('publish = "."');
    expect(netlifyToml).toContain('from = "/pricing"');
    expect(netlifyToml).toContain('from = "/admin-portal"');

    expect(byPath.get('_headers')).toContain('X-Frame-Options: SAMEORIGIN');
    expect(byPath.get('404.html')).toContain('/admin-portal');
    expect(byPath.has('.nojekyll')).toBe(true);
    expect(byPath.get('.github/workflows/deploy-pages.yml')).toContain('actions/deploy-pages@v4');

    const routesManifest = JSON.parse(byPath.get('folio-routes.json')!);
    expect(routesManifest.applications.length).toBe(2);
    expect(routesManifest.routes.length).toBe(3);

    // Root index.html lists grouped app navigation + links
    const rootIndex = byPath.get('index.html')!;
    expect(rootIndex).toContain('Main App');
    expect(rootIndex).toContain('Admin Portal');
    expect(rootIndex).toContain('pages/pricing.html');
    expect(rootIndex).toContain('pages/admin-portal.html');

    // Deduplicated asset is referenced cleanly without dangling duplicate file
    const pngARelPath = getAssetBundlePath(project.assets[1]);
    const pngBRelPath = getAssetBundlePath(project.assets[2]);
    expect(byPath.has(pngARelPath)).toBe(true);
    expect(byPath.has(pngBRelPath)).toBe(false);
    const pricingHtml = byPath.get('pages/pricing.html') ?? '';
    expect(pricingHtml).not.toContain(pngBRelPath);
    expect(pricingHtml).toContain(pngARelPath);
  });
});

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { executeNativeCommand } from '../src/app/nativeCommandExecutor';
import { ALL_NATIVE_COMMAND_REGISTRY, NATIVE_COMMAND_REGISTRY } from '../src/app/nativeCommandRegistry';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentSlot,
  createComponentVariantAxis,
} from '../src/core/document/components';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { CodeModuleRecord, FrameNode, PathNode, TextNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  applyMappedNodeEdit,
  buildCompiledProjectBundle,
  buildLivePreviewHtml,
  buildZipArchive,
  compileFolioProject,
  createCustomCodeModule,
  createNodeExtensionModule,
  parseZipArchive,
} from '../src/engines/codegen';
import {
  escapeAttr,
  escapeHtml,
  sanitizeCssText,
  sanitizeCssValue,
  sanitizeHref,
  sanitizeJsText,
} from '../src/engines/codegen/sanitize';

describe('Tahap 3 — Security Sanitization for Code Engine & Live Preview', () => {
  it('escapes HTML entities and attribute payloads strictly', () => {
    expect(escapeHtml('<script>alert("xss")</script> & \'test\'')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;test&#39;',
    );
    expect(escapeAttr('line1\n"onmouseover=alert(1)')).toBe(
      'line1 &quot;onmouseover=alert(1)',
    );
  });

  it('enforces strict URL allowlist blocking javascript:, data:, and vbscript: schemes', () => {
    expect(sanitizeHref('https://folio.dev/docs')).toBe('https://folio.dev/docs');
    expect(sanitizeHref('http://localhost:3000/app')).toBe('http://localhost:3000/app');
    expect(sanitizeHref('mailto:hello@folio.dev')).toBe('mailto:hello@folio.dev');
    expect(sanitizeHref('/pricing')).toBe('/pricing');
    expect(sanitizeHref('#features')).toBe('#features');
    expect(sanitizeHref('about')).toBe('/about');

    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('  JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeHref('java\u0000script:alert(1)')).toBeNull();
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeHref('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeHref('//evil.example.com/phish')).toBeNull();
  });

  it('neutralizes </style> and </script> breakout sequences and dangerous CSS values', () => {
    expect(sanitizeCssText('body { color: red; }</STYLE><script>alert(1)</script>')).toContain('<\\/style');
    expect(sanitizeJsText('const x = "</script><img src=x>";')).toContain('<\\/script');
    expect(sanitizeCssValue('#7c6cf6; background: url(javascript:alert(1))')).toBe('transparent');
    expect(sanitizeCssValue('#7c6cf6')).toBe('#7c6cf6');
  });
});

describe('Tahap 3 — Deterministic AST to HTML5/CSS & React TSX Compilation', () => {
  it('compiles Auto-Layout Flex/Grid, semantic tags, token var() bindings, responsive media queries, and inline SVG', () => {
    const project = createInitialProject('Web Studio');
    const tokens = createDefaultDesignTokens();
    project.designTokens = tokens;
    const page = getActivePage(project);

    const sectionFrame: FrameNode = {
      ...createFrameNode(0),
      id: 'hero-sec',
      name: 'Hero Section',
      semanticTag: 'section',
      ariaLabel: 'Hero Showcase',
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 24,
        padding: { top: 32, right: 24, bottom: 32, left: 24 },
      },
      tokenBindings: {
        fill: 'tok-sem-surface-card',
        radius: 'tok-radius-md',
        gap: 'tok-space-md',
      },
      responsive: {
        tablet: { layoutDirection: 'column', gap: 16 },
        mobile: { padding: { top: 16, right: 12, bottom: 16, left: 12 } },
      },
    };

    const ctaText: TextNode = {
      ...createTextNode(1),
      id: 'hero-cta',
      parentId: 'hero-sec',
      name: 'CTA Link',
      text: 'Start Building <Now>',
      semanticTag: 'a',
      href: 'https://folio.dev/start',
      ariaLabel: 'Start building with Folio',
      layoutChild: { widthMode: 'hug', heightMode: 'hug' },
    };

    const badHrefLink: TextNode = {
      ...createTextNode(2),
      id: 'unsafe-link',
      parentId: 'hero-sec',
      name: 'Unsafe Link',
      text: 'Blocked',
      semanticTag: 'a',
      href: 'javascript:alert(1)',
    };

    const vectorIcon: PathNode = {
      id: 'icon-vec',
      type: 'path',
      name: 'Arrow Mark',
      x: 20,
      y: 20,
      width: 24,
      height: 24,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      points: [
        { id: 'p1', x: 0, y: 0, pointType: 'corner' },
        { id: 'p2', x: 24, y: 12, pointType: 'corner' },
        { id: 'p3', x: 0, y: 24, pointType: 'corner' },
      ],
      closed: true,
      style: { fill: '#7C6CF6', stroke: 'none', strokeWidth: 0 },
    };

    page.document.nodes = [sectionFrame, ctaText, badHrefLink, vectorIcon];

    const compiled = compileFolioProject(project, { target: 'html-css' });
    const htmlFile = compiled.files.find((f) => f.path === 'pages/index.html');
    const cssFile = compiled.files.find((f) => f.path === 'styles/index.css');
    const tokensFile = compiled.files.find((f) => f.path === 'styles/tokens.css');

    expect(htmlFile?.category).toBe('mapped');
    expect(cssFile?.category).toBe('mapped');
    expect(tokensFile?.category).toBe('generated');
    expect(tokensFile?.readOnly).toBe(true);

    // Semantic HTML5 + escaped text + sanitized href + inline SVG
    expect(htmlFile?.content).toContain('<section ');
    expect(htmlFile?.content).toContain('data-folio-id="hero-sec"');
    expect(htmlFile?.content).toContain('aria-label="Hero Showcase"');
    expect(htmlFile?.content).toContain('href="https://folio.dev/start"');
    expect(htmlFile?.content).toContain('Start Building &lt;Now&gt;');
    expect(htmlFile?.content).toContain('href="#"');
    expect(htmlFile?.content).not.toContain('javascript:alert');
    expect(htmlFile?.content).toContain('<svg ');
    expect(htmlFile?.content).toContain('<path d="M 0 0 L 24 12 L 0 24 L 0 0 Z"');

    // Auto-Layout CSS + Token CSS var() + Responsive Media Queries
    expect(cssFile?.content).toContain('display: flex;');
    expect(cssFile?.content).toContain('flex-direction: row;');
    expect(cssFile?.content).toContain('justify-content: space-between;');
    expect(cssFile?.content).toContain('background: var(--surface-card);');
    expect(cssFile?.content).toContain('border-radius: var(--radius-md);');
    expect(cssFile?.content).toContain('gap: var(--space-md);');
    expect(cssFile?.content).toContain('@media (max-width: 768px)');
    expect(cssFile?.content).toContain('flex-direction: column;');
    expect(cssFile?.content).toContain('@media (max-width: 390px)');

    // Design tokens file includes both Light (:root) and Dark ([data-theme="dark"])
    expect(tokensFile?.content).toContain(':root {');
    expect(tokensFile?.content).toContain(':root[data-theme="dark"]');

    // Traceable AST line mappings exist
    expect(htmlFile!.mappings.some((m) => m.nodeId === 'hero-sec')).toBe(true);
    expect(cssFile!.mappings.some((m) => m.nodeId === 'hero-sec')).toBe(true);
  });

  it('compiles Master Components with Variants, Slots, Direct Overrides, nested Frames, and PathNode SVG into complete React TSX + CSS bundles', () => {
    const project = createInitialProject('React App');
    project.designTokens = createDefaultDesignTokens();
    const page = getActivePage(project);
    const secondPage = {
      ...structuredClone(page),
      id: 'page-pricing',
      name: 'Pricing',
      route: '/pricing',
      document: { ...structuredClone(page.document), nodes: [] },
    };
    project.pages.push(secondPage);

    const frame: FrameNode = {
      ...createFrameNode(0),
      id: 'btn-frame',
      name: 'Action Button',
      semanticTag: 'button',
      ariaLabel: 'Launch Action',
      x: 0,
      y: 0,
      width: 180,
      height: 48,
      layout: {
        mode: 'flex',
        direction: 'row',
        wrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
      },
      // Bind radius to token while leaving fill unbound so Variant/Slot/Override fill precedence applies
      tokenBindings: { radius: 'tok-radius-md' },
    };
    const baseLabel = createTextNode(1);
    const label: TextNode = {
      ...baseLabel,
      id: 'btn-label',
      parentId: 'btn-frame',
      name: 'Label',
      semanticTag: 'span',
      x: 16,
      y: 12,
      width: 120,
      height: 24,
      text: 'Click me',
      style: { ...baseLabel.style, fontSize: 16 },
    };
    const arrowIcon: PathNode = {
      id: 'btn-icon',
      parentId: 'btn-frame',
      type: 'path',
      name: 'Arrow',
      x: 140,
      y: 14,
      width: 16,
      height: 16,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      points: [
        { id: 'p1', x: 0, y: 8, pointType: 'corner' },
        { id: 'p2', x: 16, y: 8, pointType: 'corner' },
      ],
      closed: false,
      style: {
        fill: 'none',
        stroke: '#ffffff',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        arrowEnd: true,
      },
    };

    const master = buildComponentDefinitionFromNodes(
      [frame, label, arrowIcon],
      [frame.id, label.id, arrowIcon.id],
      'Action Button',
    );
    expect(master).not.toBeNull();
    if (!master) return;
    const toneAxis = createComponentVariantAxis('Tone', { optionLabels: ['Primary', 'Ghost'] });
    toneAxis.options[1].overrides[frame.id] = { fill: '#111827' };
    toneAxis.options[1].overrides[label.id] = { text: 'Ghost Action' };
    const textSlot = createComponentSlot('Label', label.id, {
      defaultText: 'Get Started',
    });
    const bgSlot = createComponentSlot('Surface', frame.id);
    master.variants = [toneAxis];
    master.slots = [textSlot, bgSlot];

    // Second master with colliding PascalCase name to verify deterministic deduplication
    const collidingMaster = buildComponentDefinitionFromNodes(
      [{ ...createRectNode(0), id: 'dup-bg', name: 'Action-Button' }],
      ['dup-bg'],
      'Action-Button',
    )!;
    project.components = [master, collidingMaster];

    const instance = createComponentInstance(master, 40, 40, 'inst-cta');
    instance.width = master.document.width * 2;
    instance.height = master.document.height * 2;
    instance.variantSelection = { [toneAxis.id]: toneAxis.options[1].id };
    instance.slotAssignments = {
      [textSlot.id]: { text: 'Launch Studio', visible: true },
      [bgSlot.id]: { fill: '#059669' },
    };
    instance.overrides = {
      [label.id]: { text: 'Override Final' },
    };

    const pageVector: PathNode = {
      ...arrowIcon,
      id: 'page-vec',
      parentId: undefined,
      x: 20,
      y: 120,
    };
    page.document.nodes = [instance, pageVector];

    const customCss = createCustomCodeModule([], 'css');
    customCss.content = '.accent { opacity: 0.9; }';
    project.codeModules = [customCss];

    // 1. HTML/CSS compiler preserves nested component-instance children, arrowheads, and proportional scaling wrapper
    const htmlCompiled = compileFolioProject(project, { target: 'html-css' });
    const htmlContent = htmlCompiled.files.find((f) => f.path === 'pages/index.html')?.content ?? '';
    const cssContent = htmlCompiled.files.find((f) => f.path === 'styles/index.css')?.content ?? '';
    expect(htmlContent).toContain('data-folio-id="inst-cta"');
    expect(htmlContent).toContain('Override Final');
    expect(htmlContent).toContain('__inner');
    expect(htmlContent).toContain('overflow="visible"');
    expect(htmlContent).toContain('<polygon points=');
    expect(cssContent).toContain('transform: scale(2, 2);');

    // 2. React compiler emits complete, self-contained bundle with component CSS, multi-page CSS, tokens, SVG, scaling, and precedence
    const compiled = compileFolioProject(project, { target: 'react' });
    const appFile = compiled.files.find((f) => f.path === 'src/App.tsx');
    const tokensFile = compiled.files.find((f) => f.path === 'src/styles/tokens.css');
    const mainCssFile = compiled.files.find((f) => f.path === 'src/styles/index.css');
    const pricingCssFile = compiled.files.find((f) => f.path === 'src/styles/pricing.css');
    const compFile = compiled.files.find((f) => f.path === 'src/components/ActionButton.tsx');
    const compCssFile = compiled.files.find((f) => f.path === 'src/components/ActionButton.css');
    const collidingCompFile = compiled.files.find((f) => f.path === 'src/components/ActionButton2.tsx');
    const pageFile = compiled.files.find((f) => f.path === 'src/pages/MainPagePage.tsx');

    expect(appFile?.category).toBe('generated');
    expect(tokensFile?.category).toBe('generated');
    expect(mainCssFile?.category).toBe('mapped');
    expect(pricingCssFile?.category).toBe('mapped');
    expect(compFile?.category).toBe('generated');
    expect(compCssFile?.category).toBe('generated');
    expect(collidingCompFile?.category).toBe('generated');
    expect(pageFile?.category).toBe('mapped');

    // Parse & transpile EVERY generated TSX file using TypeScript's real TSX compiler to prove valid AST & zero syntax errors
    const tsxFiles = compiled.files.filter((file) => file.language === 'tsx');
    expect(tsxFiles.length).toBeGreaterThanOrEqual(4);
    for (const file of tsxFiles) {
      const transpiled = ts.transpileModule(file.content, {
        fileName: file.path,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          strict: true,
        },
      });
      expect(transpiled.diagnostics ?? [], `TSX syntax diagnostics in ${file.path}`).toEqual([]);
      expect(transpiled.outputText.length).toBeGreaterThan(20);
    }

    // Structurally inspect ActionButton.tsx AST (interface props, exported function, SVG path + arrowhead polygon)
    const compSource = ts.createSourceFile(compFile!.path, compFile!.content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    let foundPropsInterface = false;
    let foundExportedFunction = false;
    const jsxTagNames = new Set<string>();
    const visit = (astNode: ts.Node) => {
      if (ts.isInterfaceDeclaration(astNode) && astNode.name.text === 'ActionButtonProps') {
        foundPropsInterface = true;
        const memberNames = astNode.members
          .filter(ts.isPropertySignature)
          .map((m) => m.name.getText(compSource));
        expect(memberNames).toEqual(
          expect.arrayContaining(['tone', 'label', 'labelVisible', 'surfaceFill', 'overrides', 'className', 'style']),
        );
      }
      if (ts.isFunctionDeclaration(astNode) && astNode.name?.text === 'ActionButton') {
        foundExportedFunction = true;
      }
      if (ts.isJsxOpeningElement(astNode) || ts.isJsxSelfClosingElement(astNode)) {
        jsxTagNames.add(astNode.tagName.getText(compSource));
      }
      ts.forEachChild(astNode, visit);
    };
    visit(compSource);
    expect(foundPropsInterface).toBe(true);
    expect(foundExportedFunction).toBe(true);
    expect([...jsxTagNames]).toEqual(expect.arrayContaining(['div', 'button', 'span', 'svg', 'path', 'polygon']));

    // Tokens imported by App.tsx
    expect(appFile?.content).toContain("import './styles/tokens.css';");

    // Component CSS contains layout, token var(), and variant selector override
    expect(compCssFile?.content).toContain('display: flex;');
    expect(compCssFile?.content).toContain('border-radius: var(--radius-md);');
    expect(compCssFile?.content).toContain('[data-variant-tone="Ghost"]');
    expect(compCssFile?.content).toContain('background: #111827;');

    // Page TSX imports component BEFORE page stylesheet, scales resized instance proportionally, renders SVG arrowheads, and passes contract props
    const compImportIdx = pageFile!.content.indexOf("import { ActionButton } from '../components/ActionButton';");
    const pageCssImportIdx = pageFile!.content.indexOf("import '../styles/index.css';");
    expect(compImportIdx).toBeGreaterThan(-1);
    expect(pageCssImportIdx).toBeGreaterThan(compImportIdx);
    expect(pageFile?.content).toContain(`import '../../${customCss.path}';`);
    expect(pageFile?.content).toContain('<ActionButton ');
    expect(pageFile?.content).toContain('transform: "scale(2, 2)"');
    expect(pageFile?.content).toContain('transformOrigin: "top left"');
    expect(pageFile?.content).toContain('tone="Ghost"');
    expect(pageFile?.content).toContain('label="Launch Studio"');
    expect(pageFile?.content).toContain('surfaceFill="#059669"');
    expect(pageFile?.content).toContain('overrides={{"btn-label":{"text":"Override Final"}}}');
    expect(pageFile?.content).toContain('<polygon points=');
  });

  it('builds self-contained Live Preview HTML with theme attribute, Custom CSS, and Extension CSS', () => {
    const project = createInitialProject('Preview Test');
    const page = getActivePage(project);
    const customMod = createCustomCodeModule([], 'css');
    customMod.content = '.custom-rule { color: #22c55e; }</style><script>bad()</script>';
    const extMod = createNodeExtensionModule(page.document.nodes[0], page.id, [customMod]);
    project.codeModules = [customMod, extMod];

    const html = buildLivePreviewHtml(project, {
      pageId: page.id,
      themeId: 'theme-dark',
      includeCustomScripts: false,
    });

    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('.custom-rule { color: #22c55e; }<\\/style>');
    expect(html).toContain(`[data-folio-id="${page.document.nodes[0].id}"]`);
    expect(html).not.toContain('<script>');
  });
});

describe('Tahap 3 — Mapped Round-Trip Sync & Custom Code Preservation via Native Command Engine', () => {
  it('applies valid mapped edits back to AST and honestly rejects unsafe/unsupported edits', () => {
    const textNode: TextNode = { ...createTextNode(0), id: 'txt-1', name: 'Headline', text: 'Original' };

    const applied = applyMappedNodeEdit(textNode, {
      text: 'Updated from Code',
      semanticTag: 'h1',
      ariaLabel: 'Main headline',
    });
    expect(applied.status).toBe('applied');
    if (applied.status === 'applied') {
      expect((applied.node as TextNode).text).toBe('Updated from Code');
      expect(applied.node.semanticTag).toBe('h1');
      expect(applied.node.ariaLabel).toBe('Main headline');
    }

    const unsafeLink = applyMappedNodeEdit(textNode, {
      semanticTag: 'a',
      href: 'javascript:alert(1)',
    });
    expect(unsafeLink.status).toBe('unsupported');

    const lockedNode = { ...textNode, locked: true };
    const lockedRes = applyMappedNodeEdit(lockedNode, { text: 'Nope' });
    expect(lockedRes.status).toBe('unsupported');
  });

  it('persists Custom & Extension codeModules via code.update-modules with Undo/Redo and preserves them across Canvas visual edits', () => {
    expect(Object.keys(NATIVE_COMMAND_REGISTRY).length).toBe(14);
    const allCommandTypes = Object.keys(ALL_NATIVE_COMMAND_REGISTRY);
    expect(allCommandTypes.length).toBe(44);
    expect(new Set(allCommandTypes).size).toBe(44);
    expect(ALL_NATIVE_COMMAND_REGISTRY['animation.update-custom-easings']).toBeDefined();

    const project = createInitialProject('Sync Demo');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const customCss = createCustomCodeModule([], 'css');
    customCss.content = 'main { border: 2px solid #7c6cf6; }';

    const addRes = client.updateCodeModules([customCss], 'Add custom stylesheet');
    expect(addRes.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules).toHaveLength(1);
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Visual edit on a Canvas node must NEVER discard custom codeModules
    const firstNode = getActivePage(store.getSnapshot().editorState.project).document.nodes[0];
    const visualEdit = client.renameNodes([{ nodeId: firstNode.id, name: 'Renamed Hero' }]);
    expect(visualEdit.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules?.[0]?.content).toBe(
      'main { border: 2px solid #7c6cf6; }',
    );

    // Undo visual edit, then undo custom module creation, then redo cleanly
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules).toHaveLength(1);
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules).toBeUndefined();
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules).toHaveLength(1);
  });

  it('rejects invalid codeModule paths containing directory traversal in .flop v2 validation', () => {
    const project = createInitialProject('Invalid Path Check');
    const badModule: CodeModuleRecord = {
      id: 'mod-bad',
      path: '../escape.css',
      language: 'css',
      mapping: 'custom',
      content: 'body {}',
      updatedAt: new Date().toISOString(),
    };
    project.codeModules = [badModule];
    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
  });

  it('coalesces consecutive code.update-modules edits with the same coalesceKey into one Undo entry until commitEdit', () => {
    const project = createInitialProject('Coalesce Demo');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const customCss = createCustomCodeModule([], 'css');
    customCss.content = 'main { color: #000; }';
    expect(client.updateCodeModules([customCss], 'Add custom stylesheet').status).toBe('applied');

    const key = `code-module:${customCss.id}`;
    expect(
      client.updateCodeModules([{ ...customCss, content: 'main { color: #111; }' }], 'Edit code module', key).status,
    ).toBe('applied');
    expect(
      client.updateCodeModules([{ ...customCss, content: 'main { color: #222; }' }], 'Edit code module', key).status,
    ).toBe('applied');
    expect(
      client.updateCodeModules([{ ...customCss, content: 'main { color: #333; }' }], 'Edit code module', key).status,
    ).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules?.[0]?.content).toBe('main { color: #333; }');

    // Commit edit session (mirrors textarea blur / file switch / panel close)
    expect(client.commitEdit().status).toBe('applied');

    // Single Undo jumps straight back to pre-typing content instead of per-keystroke steps
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules?.[0]?.content).toBe('main { color: #000; }');

    // Single Redo restores the final coalesced content
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules?.[0]?.content).toBe('main { color: #333; }');

    // Next edit after commitEdit starts a separate Undo group
    expect(
      client.updateCodeModules([{ ...customCss, content: 'main { color: #444; }' }], 'Edit code module', key).status,
    ).toBe('applied');
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.codeModules?.[0]?.content).toBe('main { color: #333; }');

    // Empty coalesceKey is rejected by command payload validation
    const invalidEnvelope = client.createEnvelope(
      'code.update-modules',
      { kind: 'project', projectId: project.metadata.id },
      { codeModules: [customCss], coalesceKey: '' },
    );
    const rejected = executeNativeCommand(store, invalidEnvelope, {
      projectId: project.metadata.id,
      principal: { kind: 'user', id: 'user-local' },
      capabilities: ['project.read', 'code.update'],
      workspace: 'main',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.code).toBe('INVALID_PAYLOAD');
  });

  it('builds deterministic, CRC-32 verified multi-file ZIP bundles for both React TSX and HTML/CSS targets and rejects path traversal', () => {
    const project = createInitialProject('Bundle Studio');
    const customCss = createCustomCodeModule([], 'css');
    customCss.content = '.hero-accent { letter-spacing: 0.04em; }\n';
    project.codeModules = [customCss];

    // 1. React + TypeScript runnable project ZIP
    const reactBundleA = buildCompiledProjectBundle(project, { target: 'react' });
    const reactBundleB = buildCompiledProjectBundle(project, { target: 'react' });
    expect(reactBundleA.fileName).toBe('bundle-studio-react-ts.zip');
    // Byte-for-byte deterministic output
    expect(Array.from(reactBundleA.zipBytes)).toEqual(Array.from(reactBundleB.zipBytes));

    const reactParsed = parseZipArchive(reactBundleA.zipBytes);
    const reactPaths = new Set(reactParsed.map((e) => e.path));
    expect(reactPaths.has('package.json')).toBe(true);
    expect(reactPaths.has('tsconfig.json')).toBe(true);
    expect(reactPaths.has('vite.config.ts')).toBe(true);
    expect(reactPaths.has('index.html')).toBe(true);
    expect(reactPaths.has('src/main.tsx')).toBe(true);
    expect(reactPaths.has('src/App.tsx')).toBe(true);
    expect(reactPaths.has('src/styles/tokens.css')).toBe(true);
    expect(reactPaths.has(customCss.path)).toBe(true);

    const decoder = new TextDecoder();
    const pkgEntry = reactParsed.find((e) => e.path === 'package.json')!;
    const pkgJson = JSON.parse(decoder.decode(pkgEntry.data)) as { name: string; dependencies: Record<string, string> };
    expect(pkgJson.name).toBe('bundle-studio');
    expect(pkgJson.dependencies.react).toBeTruthy();

    // 2. HTML5 + CSS static project ZIP
    const htmlBundle = buildCompiledProjectBundle(project, { target: 'html-css' });
    expect(htmlBundle.fileName).toBe('bundle-studio-html-css.zip');
    const htmlParsed = parseZipArchive(htmlBundle.zipBytes);
    const htmlPaths = new Set(htmlParsed.map((e) => e.path));
    expect(htmlPaths.has('index.html')).toBe(true);
    expect(htmlPaths.has('pages/index.html')).toBe(true);
    expect(htmlPaths.has('styles/index.css')).toBe(true);
    expect(htmlPaths.has('styles/tokens.css')).toBe(true);
    expect(htmlPaths.has(customCss.path)).toBe(true);

    // 3. Rejects directory traversal and duplicate paths in ZIP entries
    expect(() => buildZipArchive([{ path: '../evil.txt', content: 'nope' }])).toThrow();
    expect(() => buildZipArchive([{ path: '/etc/passwd', content: 'nope' }])).toThrow();
    expect(() =>
      buildZipArchive([
        { path: 'dup.txt', content: 'a' },
        { path: 'dup.txt', content: 'b' },
      ]),
    ).toThrow();
  });
});

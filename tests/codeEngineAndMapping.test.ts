import { describe, expect, it } from 'vitest';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
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
  buildLivePreviewHtml,
  compileFolioProject,
  createCustomCodeModule,
  createNodeExtensionModule,
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

  it('compiles Master Components with Variants & Slots into typed React TSX props and Page JSX', () => {
    const project = createInitialProject('React App');
    const page = getActivePage(project);
    const bg = { ...createRectNode(0), id: 'btn-bg', name: 'Background' };
    const label: TextNode = { ...createTextNode(1), id: 'btn-label', name: 'Label', text: 'Click me' };

    const master = buildComponentDefinitionFromNodes([bg, label], [bg.id, label.id], 'Action Button');
    expect(master).not.toBeNull();
    if (!master) return;
    const toneAxis = createComponentVariantAxis('Tone', { optionLabels: ['Primary', 'Ghost'] });
    const textSlot = createComponentSlot('Label', master.document.nodes[1].id, {
      defaultText: 'Get Started',
    });
    master.variants = [toneAxis];
    master.slots = [textSlot];
    project.components = [master];

    const instance = createComponentInstance(master, 40, 40, 'inst-cta');
    instance.variantSelection = { [toneAxis.id]: toneAxis.options[1].id };
    instance.slotAssignments = { [textSlot.id]: { text: 'Launch Studio' } };
    page.document.nodes = [instance];

    const compiled = compileFolioProject(project, { target: 'react' });
    const appFile = compiled.files.find((f) => f.path === 'src/App.tsx');
    const compFile = compiled.files.find((f) => f.path === 'src/components/ActionButton.tsx');
    const pageFile = compiled.files.find((f) => f.path === 'src/pages/MainPagePage.tsx');

    expect(appFile?.category).toBe('generated');
    expect(compFile?.category).toBe('generated');
    expect(pageFile?.category).toBe('mapped');

    expect(compFile?.content).toContain('export interface ActionButtonProps');
    expect(compFile?.content).toContain('tone?: "Primary" | "Ghost";');
    expect(compFile?.content).toContain('label?: React.ReactNode;');
    expect(pageFile?.content).toContain("import { ActionButton } from '../components/ActionButton';");
    expect(pageFile?.content).toContain('<ActionButton ');
    expect(pageFile?.content).toContain('tone="Ghost"');
    expect(pageFile?.content).toContain('label="Launch Studio"');
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
    expect(Object.keys(ALL_NATIVE_COMMAND_REGISTRY).length).toBe(32);

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
});

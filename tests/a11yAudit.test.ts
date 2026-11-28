import { describe, expect, it } from 'vitest';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { FrameNode, RectNode, TextNode } from '../src/core/document/types';
import {
  applyA11yQuickFixToNode,
  auditPageAccessibility,
  computeContrastRatio,
  parseCssColorToRgba,
  suggestAccessibleForegroundColor,
} from '../src/engines/codegen/a11yAudit';

describe('P1-3 — WCAG 2.1 AA Accessibility & Semantic Audit Engine', () => {
  it('computes accurate WCAG 2.1 contrast ratios across hex, rgba, and named colors', () => {
    expect(computeContrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(computeContrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(computeContrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(computeContrastRatio('#CCCCCC', '#FFFFFF')).toBeLessThan(2);
    expect(computeContrastRatio('rgba(0, 0, 0, 0.5)', '#FFFFFF')).toBeGreaterThan(3.5);
    expect(parseCssColorToRgba('not-a-color')).toBeNull();
  });

  it('passes cleanly when a page has proper h1 hierarchy, high-contrast text, and accessible links/buttons', () => {
    const project = createInitialProject('Clean A11y');
    const page = getActivePage(project);
    page.document.background = '#FFFFFF';

    const title: TextNode = {
      ...createTextNode(0),
      id: 'txt-h1',
      name: 'Page Title',
      text: 'Accessible Studio',
      semanticTag: 'h1',
      x: 40,
      y: 40,
      style: { ...createTextNode(0).style, fontSize: 40, fontWeight: 700, fill: '#111827' },
    };
    const sub: TextNode = {
      ...createTextNode(1),
      id: 'txt-h2',
      name: 'Subtitle',
      text: 'Built for everyone',
      semanticTag: 'h2',
      x: 40,
      y: 120,
      style: { ...createTextNode(1).style, fontSize: 24, fontWeight: 600, fill: '#1F2937' },
    };
    const link: TextNode = {
      ...createTextNode(2),
      id: 'txt-link',
      name: 'Docs Link',
      text: 'Read documentation',
      semanticTag: 'a',
      href: 'https://folio.dev/docs',
      x: 40,
      y: 200,
      style: { ...createTextNode(2).style, fontSize: 16, fontWeight: 500, fill: '#1D4ED8' },
    };

    page.document.nodes = [title, sub, link];
    const report = auditPageAccessibility(project, page);

    expect(report.score).toBe(100);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.passedChecks).toBeGreaterThanOrEqual(5);
  });

  it('detects low contrast against parent surface, skipped headings, missing button labels, and unsafe links', () => {
    const project = createInitialProject('Broken A11y');
    const page = getActivePage(project);
    page.document.background = '#FFFFFF';

    const darkCard: FrameNode = {
      ...createFrameNode(0),
      id: 'card-dark',
      name: 'Dark Card',
      x: 40,
      y: 40,
      width: 400,
      height: 220,
      style: { ...createFrameNode(0).style, fill: '#1E293B' },
    };
    const lowContrastText: TextNode = {
      ...createTextNode(1),
      id: 'txt-low',
      parentId: 'card-dark',
      name: 'Dim Caption',
      text: 'Hard to read on dark',
      semanticTag: 'p',
      x: 60,
      y: 60,
      style: { ...createTextNode(1).style, fontSize: 14, fontWeight: 400, fill: '#334155' },
    };
    const heading1: TextNode = {
      ...createTextNode(2),
      id: 'h1-main',
      name: 'Main H1',
      text: 'Main Heading',
      semanticTag: 'h1',
      x: 40,
      y: 280,
      style: { ...createTextNode(2).style, fontSize: 38, fontWeight: 700, fill: '#111111' },
    };
    const skippedH3: TextNode = {
      ...createTextNode(3),
      id: 'h3-skip',
      name: 'Skipped H3',
      text: 'Jumped Heading',
      semanticTag: 'h3',
      x: 40,
      y: 360,
      style: { ...createTextNode(3).style, fontSize: 18, fontWeight: 600, fill: '#111111' },
    };
    const unlabeledBtn: RectNode = {
      ...createRectNode(4),
      id: 'btn-unlabeled',
      name: 'Icon Button',
      semanticTag: 'button',
      x: 40,
      y: 420,
    };
    const badLink: TextNode = {
      ...createTextNode(5),
      id: 'bad-link',
      name: 'Bad Link',
      text: 'Click here',
      semanticTag: 'a',
      href: 'javascript:alert(1)',
      x: 40,
      y: 480,
      style: { ...createTextNode(5).style, fontSize: 16, fill: '#111111' },
    };

    page.document.nodes = [darkCard, lowContrastText, heading1, skippedH3, unlabeledBtn, badLink];
    const report = auditPageAccessibility(project, page);

    const codes = new Set(report.issues.map((issue) => issue.code));
    expect(codes.has('CONTRAST_TOO_LOW')).toBe(true);
    expect(codes.has('SKIPPED_HEADING_LEVEL')).toBe(true);
    expect(codes.has('INTERACTIVE_MISSING_NAME')).toBe(true);
    expect(codes.has('LINK_MISSING_OR_UNSAFE_HREF')).toBe(true);
    expect(report.errorCount).toBeGreaterThanOrEqual(3);
    expect(report.score).toBeLessThan(60);
    // Errors are sorted before warnings and info
    expect(report.issues[0].severity).toBe('error');
  });

  it('suggests WCAG-compliant foreground colors on light and dark backdrops and auto-fixes starter page to 100/100', () => {
    const fixedOnLight = suggestAccessibleForegroundColor('#7C7067', '#F5F2EC', 4.5);
    expect(fixedOnLight).toMatch(/^#[0-9A-F]{6}$/);
    expect(computeContrastRatio(fixedOnLight!, '#F5F2EC')).toBeGreaterThanOrEqual(4.5);

    const fixedOnDark = suggestAccessibleForegroundColor('#334155', '#1E293B', 4.5);
    expect(fixedOnDark).toMatch(/^#[0-9A-F]{6}$/);
    expect(computeContrastRatio(fixedOnDark!, '#1E293B')).toBeGreaterThanOrEqual(4.5);

    // Apply all suggested fixes onto the default transparent starter artboard and confirm 100/100 score
    const project = createInitialProject('Starter Fix Check');
    const page = getActivePage(project);
    const before = auditPageAccessibility(project, page);
    const fixableIssues = before.issues.filter((issue) => Boolean(issue.fix));
    expect(fixableIssues.length).toBeGreaterThanOrEqual(1);
    expect(fixableIssues.some((issue) => issue.code === 'SKIPPED_HEADING_LEVEL')).toBe(true);

    page.document.nodes = page.document.nodes.map((node) => {
      let updated = node;
      for (const issue of fixableIssues) {
        if (issue.fix && issue.fix.nodeId === node.id) {
          updated = applyA11yQuickFixToNode(updated, issue.fix);
        }
      }
      return updated;
    });

    const after = auditPageAccessibility(project, page);
    expect(after.score).toBe(100);
    expect(after.issues).toHaveLength(0);

    // Also verify a warm light-surface artboard (#F5F2EC) flags BOTH low contrast and skipped heading and auto-fixes to 100/100
    const warmProject = createInitialProject('Warm Surface Fix Check');
    const warmPage = getActivePage(warmProject);
    warmPage.document.background = '#F5F2EC';
    const warmBefore = auditPageAccessibility(warmProject, warmPage);
    const warmFixable = warmBefore.issues.filter((issue) => Boolean(issue.fix));
    expect(warmFixable.length).toBeGreaterThanOrEqual(2);
    expect(warmFixable.some((issue) => issue.code === 'CONTRAST_TOO_LOW')).toBe(true);
    expect(warmFixable.some((issue) => issue.code === 'SKIPPED_HEADING_LEVEL')).toBe(true);

    warmPage.document.nodes = warmPage.document.nodes.map((node) => {
      let updated = node;
      for (const issue of warmFixable) {
        if (issue.fix && issue.fix.nodeId === node.id) {
          updated = applyA11yQuickFixToNode(updated, issue.fix);
        }
      }
      return updated;
    });

    const warmAfter = auditPageAccessibility(warmProject, warmPage);
    expect(warmAfter.score).toBe(100);
    expect(warmAfter.issues).toHaveLength(0);
  });
});

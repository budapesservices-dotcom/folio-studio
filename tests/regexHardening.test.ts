import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { sanitizeSvgMarkup } from '../src/core/persistence/assetStore';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  analyzeRegexPattern,
  isSafeRegexPattern,
  safeRegexTest,
} from '../src/engines/codegen/sanitize';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  validateProjectLogicGraphs,
} from '../src/engines/prototype';

function buildRegexTestProject(pattern = '^[^@]+@[^@]+\\.[^@]+$') {
  const project = createInitialProject('Regex Parity Project');
  const page = project.pages[0];
  const target = page.document.nodes[0];
  const onClick = createLogicNode({
    id: 'ev-click',
    type: 'event.on-click',
    data: { targetNodeId: target.id },
  });
  const cond = createLogicNode({
    id: 'cond-regex',
    type: 'logic.condition',
    data: { mode: 'regex', pattern, left: 'user@example.com' },
  });
  const branch = createLogicNode({
    id: 'br-main',
    type: 'logic.branch',
    data: { mode: 'if-else' },
  });
  const act = createLogicNode({
    id: 'act-text',
    type: 'action.set-layer',
    data: { targetMode: 'override', targetNodeId: target.id, property: 'text', text: 'OK' },
  });
  project.logicGraphs.push(
    createLogicGraph({
      id: 'g-regex',
      name: 'Regex Graph',
      scope: 'page',
      targetId: page.id,
      nodes: [onClick, cond, branch, act],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: onClick.id, sourcePortId: 'exec', targetNodeId: branch.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: cond.id, sourcePortId: 'result', targetNodeId: branch.id, targetPortId: 'condition' }),
        createLogicConnection({ id: 'c3', sourceNodeId: branch.id, sourcePortId: 'true', targetNodeId: act.id, targetPortId: 'exec' }),
      ],
    }),
  );
  return { project, page };
}

function extractLivePreviewSafeRegexTest(script: string): (pat: string, str: string) => boolean {
  const start = script.indexOf('  function safeRegexTest(pat, str) {');
  const end = script.indexOf('\n  function parseList(raw) {', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not locate safeRegexTest in Live Preview script');
  }
  const fnSource = script.slice(start, end);
  return new Function(`${fnSource}\nreturn safeRegexTest;`)() as (pat: string, str: string) => boolean;
}

function extractReactExportSafeRegexTest(tsx: string): (pat: string, str: string) => boolean {
  const start = tsx.indexOf('    const safeRegexTest = (pat: string, str: string): boolean => {');
  const end = tsx.indexOf('\n    const queue: Array<', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not locate safeRegexTest in React export TSX');
  }
  const tsSnippet = `${tsx.slice(start, end)}\nexport { safeRegexTest };`;
  const transpiled = ts.transpileModule(tsSnippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as { safeRegexTest?: (pat: string, str: string) => boolean } };
  new Function('exports', 'module', transpiled)(mod.exports, mod);
  if (typeof mod.exports.safeRegexTest !== 'function') {
    throw new Error('Failed to transpile React export safeRegexTest');
  }
  return mod.exports.safeRegexTest;
}

describe('Regex Engine Hardening & 3-Way Parity', () => {
  const validCases: Array<{ label: string; pattern: string; sample: string; expected: boolean }> = [
    { label: 'email', pattern: '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$', sample: 'alice@folio.dev', expected: true },
    { label: 'simple email placeholder', pattern: '^[^@]+@[^@]+\\.[^@]+$', sample: 'a@b.co', expected: true },
    { label: 'url with optional path', pattern: "^https?://[a-z0-9.-]+(?:/[a-z0-9._~:/?#[\\]@!$&'()*+,;=-]*)?$", sample: 'https://folio.dev/docs/v1', expected: true },
    { label: 'password lookaheads', pattern: '^(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{8,}$', sample: 'Secret123', expected: true },
    { label: 'password lookaheads non-match', pattern: '^(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{8,}$', sample: 'weakpass', expected: false },
    { label: 'lazy optional quantifier ??', pattern: '^a??b+?c*?d{1,3}?$', sample: 'abdd', expected: true },
    { label: 'non-capturing alternation', pattern: '^(?:foo|bar|baz)$', sample: 'bar', expected: true },
    { label: 'optional non-capturing group', pattern: '^(?:https?://)?example\\.com$', sample: 'example.com', expected: true },
    { label: 'named capturing groups', pattern: '^(?<area>\\d{3})-(?<num>\\d{4})$', sample: '415-0199', expected: true },
    { label: 'positive lookbehind', pattern: '(?<=@)[a-z]+', sample: 'hi@folio', expected: true },
    { label: 'negative lookbehind', pattern: '(?<!foo)bar', sample: 'bazbar', expected: true },
    { label: 'IPv4 small bounded group repeat', pattern: '^(?:\\d{1,3}\\.){3}\\d{1,3}$', sample: '192.168.1.10', expected: true },
    { label: 'escaped bracket in char class', pattern: '^[a\\]b]+$', sample: 'a]b', expected: true },
    { label: 'hex color', pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', sample: '#ff00aa', expected: true },
    { label: 'word boundary', pattern: '\\bhello\\b', sample: 'say hello world', expected: true },
    { label: 'disjoint non-digit then digit', pattern: '^\\D+\\d+$', sample: 'SKU42', expected: true },
    { label: 'disjoint non-space space non-space', pattern: '^\\S+\\s+\\S+$', sample: 'hello world', expected: true },
    { label: 'disjoint non-word then word', pattern: '^\\W+\\w+$', sample: '---folio', expected: true },
    { label: 'disjoint alpha then numeric', pattern: '^[a-z]+[0-9]+$', sample: 'item99', expected: true },
  ];

  const syntaxInvalidCases: Array<{ label: string; pattern: string }> = [
    { label: 'empty pattern', pattern: '' },
    { label: 'unclosed group', pattern: '(abc' },
    { label: 'unmatched closing paren', pattern: 'abc)' },
    { label: 'unclosed character class', pattern: '[abc' },
    { label: 'inverted quantifier range', pattern: 'a{5,2}' },
    { label: 'trailing backslash', pattern: 'abc\\' },
    { label: 'stray leading quantifier', pattern: '*abc' },
    { label: 'quantified anchor', pattern: '^+abc' },
    { label: 'quantified word boundary', pattern: '\\b+word' },
    { label: 'stacked quantifiers ++', pattern: 'a++' },
    { label: 'stacked quantifiers ???', pattern: 'a???' },
    { label: 'stacked lazy brace quantifier', pattern: 'a{1,2}??' },
    { label: 'invalid group prefix', pattern: '(?i:abc)' },
    { label: 'invalid named group', pattern: '(?<123>abc)' },
  ];

  const unsafeRedosCases: Array<{ label: string; pattern: string; attackInput: string }> = [
    { label: 'classic nested +', pattern: '(a+)+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'optional-in-loop ?', pattern: '(a?)+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'optional-in-loop {0,1}', pattern: '(a{0,1})+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'nested optional group in loop', pattern: '(([a-z])?)+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'quantified alternation', pattern: '(a|aa)+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'double-wrapped quantified alternation', pattern: '((a|aa))+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'large bounded alternation repeat', pattern: '(a|aa){20}$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'numbered backreference', pattern: '(\\w+)\\s+\\1', attackInput: 'foo foo' },
    { label: 'named backreference', pattern: '(?<w>\\w+)\\s+\\k<w>', attackInput: 'foo foo' },
    { label: 'quantified lookahead', pattern: '(?=a)+', attackInput: 'aaa' },
    { label: 'nested lookahead quantifier in loop', pattern: '(?:(?=a+))+$', attackInput: `${'a'.repeat(40)}!` },
    { label: 'polynomial wildcard chain', pattern: '.*.*.*.*x', attackInput: 'a'.repeat(200) },
    { label: 'adjacent identical unbounded literals', pattern: 'a+a+a+a+x', attackInput: 'a'.repeat(200) },
    { label: 'adjacent identical shorthand classes', pattern: '\\s+\\s+x', attackInput: ' '.repeat(200) },
    { label: 'unbounded separated by nullable token', pattern: 'a+b?a+x', attackInput: 'a'.repeat(200) },
    { label: 'adjacent grouped unbounded literals', pattern: '(?:a+)(?:a+)x', attackInput: 'a'.repeat(200) },
    { label: 'adjacent grouped wildcards', pattern: '(?:.*)(?:.*)x', attackInput: 'a'.repeat(200) },
    { label: 'wildcard character class chain', pattern: '[\\s\\S]*[\\s\\S]*x', attackInput: 'a'.repeat(200) },
    { label: 'excessive quantifier bound', pattern: 'a{101}', attackInput: 'a'.repeat(101) },
    { label: 'excessive group nesting', pattern: '(((((((a)))))))', attackInput: 'a' },
    { label: 'excessive pattern length', pattern: 'a'.repeat(201), attackInput: 'a'.repeat(201) },
    { label: 'bounded outer on unbounded inner', pattern: '(a+){2}$', attackInput: `${'a'.repeat(200)}!` },
    { label: 'excessive inner span in bounded loop', pattern: '(a{0,50}){4}$', attackInput: `${'a'.repeat(200)}!` },
    { label: 'overlapping shorthand digit and literal 0', pattern: '^\\d*0*X$', attackInput: '0'.repeat(10_000) },
    { label: 'multi-chain overlapping digit and literal 0', pattern: '^\\d*0*\\d*0*\\d*0*X$', attackInput: '0'.repeat(120) },
    { label: 'nullable bridge between overlapping digit and 0', pattern: '^\\d*[a-z]*0*X$', attackInput: '0'.repeat(200) },
    { label: 'overlapping shorthand word and literal a', pattern: '^\\w*a*X$', attackInput: 'a'.repeat(200) },
    { label: 'overlapping character ranges [0-9] and [0-8]', pattern: '^[0-9]*[0-8]*X$', attackInput: '0'.repeat(200) },
    { label: 'overlapping shorthand space and literal space', pattern: '^\\s* *X$', attackInput: ' '.repeat(200) },
    { label: 'overlapping non-space and literal a', pattern: '^\\S*a*X$', attackInput: 'a'.repeat(200) },
    { label: 'overlapping negated class and literal', pattern: '^[^0-9]*a*X$', attackInput: 'a'.repeat(200) },
    { label: 'overlapping quantified group and literal', pattern: '^(?:0)+0+X$', attackInput: '0'.repeat(200) },
    { label: 'overlapping quantified group and range', pattern: '^(?:\\d)+[0-5]+X$', attackInput: '0'.repeat(200) },
    { label: 'overlapping unquantified alternation tail', pattern: '^(?:[0-9]+|[a-z]+)0+X$', attackInput: '0'.repeat(200) },
  ];

  it('accepts valid real-world patterns including lazy ??, lookarounds, named groups, and IPv4', () => {
    for (const tc of validCases) {
      const analysis = analyzeRegexPattern(tc.pattern);
      expect(analysis, `Expected valid & safe for "${tc.label}" (${tc.pattern})`).toEqual({
        ok: true,
        valid: true,
        safe: true,
      });
      expect(isSafeRegexPattern(tc.pattern), tc.label).toBe(true);
      expect(safeRegexTest(tc.pattern, tc.sample), tc.label).toBe(tc.expected);
    }
  });

  it('rejects syntactically invalid patterns with valid=false', () => {
    for (const tc of syntaxInvalidCases) {
      const analysis = analyzeRegexPattern(tc.pattern);
      expect(analysis.ok, `Expected ok=false for "${tc.label}"`).toBe(false);
      expect(analysis.valid, `Expected valid=false for "${tc.label}"`).toBe(false);
      expect(analysis.reason, `Expected reason for "${tc.label}"`).toBeTruthy();
      expect(isSafeRegexPattern(tc.pattern), tc.label).toBe(false);
      expect(safeRegexTest(tc.pattern, 'abc'), tc.label).toBe(false);
    }
  });

  it('blocks ReDoS bypasses with safe=false in linear time without freezing', () => {
    for (const tc of unsafeRedosCases) {
      const t0 = performance.now();
      const analysis = analyzeRegexPattern(tc.pattern);
      const matched = safeRegexTest(tc.pattern, tc.attackInput);
      const elapsed = performance.now() - t0;

      expect(analysis.ok, `Expected ok=false for "${tc.label}" (${tc.pattern})`).toBe(false);
      expect(analysis.safe, `Expected safe=false for "${tc.label}" (${tc.pattern})`).toBe(false);
      expect(analysis.reason, `Expected reason for "${tc.label}"`).toBeTruthy();
      expect(matched, tc.label).toBe(false);
      expect(elapsed, `Slow regex check for "${tc.label}"`).toBeLessThan(50);
    }
  });

  it('enforces input length guard (>10,000 chars) without executing regex', () => {
    expect(safeRegexTest('^a+$', 'a'.repeat(10_000))).toBe(true);
    expect(safeRegexTest('^a+$', 'a'.repeat(10_001))).toBe(false);
  });

  it('guarantees 100% 3-way parity across Runtime, Live Preview JS, and React Export TSX', () => {
    const { project, page } = buildRegexTestProject();
    const previewScript = buildLivePreviewLogicScript(project, page) ?? '';
    const reactFiles = compileReactProjectFiles(project);
    const pageTsx = reactFiles.find((f) => f.path.startsWith('src/pages/') && f.path.endsWith('.tsx'))?.content ?? '';

    const previewSafeRegexTest = extractLivePreviewSafeRegexTest(previewScript);
    const reactSafeRegexTest = extractReactExportSafeRegexTest(pageTsx);

    const matrix: Array<{ label: string; pattern: string; input: string }> = [
      ...validCases.map((tc) => ({ label: `valid:${tc.label}`, pattern: tc.pattern, input: tc.sample })),
      ...syntaxInvalidCases.map((tc) => ({ label: `invalid:${tc.label}`, pattern: tc.pattern, input: 'abc' })),
      ...unsafeRedosCases.map((tc) => ({ label: `redos:${tc.label}`, pattern: tc.pattern, input: tc.attackInput })),
      { label: 'oversized-input', pattern: '^a+$', input: 'a'.repeat(10_001) },
    ];

    for (const entry of matrix) {
      const runtimeRes = safeRegexTest(entry.pattern, entry.input);
      const previewRes = previewSafeRegexTest(entry.pattern, entry.input);
      const reactRes = reactSafeRegexTest(entry.pattern, entry.input);

      expect(previewRes, `Live Preview parity mismatch on ${entry.label} (${entry.pattern})`).toBe(runtimeRes);
      expect(reactRes, `React Export parity mismatch on ${entry.label} (${entry.pattern})`).toBe(runtimeRes);
    }
  });

  it('reports syntax errors, unsafe ReDoS errors, and empty pattern warnings in Node Logic validator', () => {
    const validReport = validateProjectLogicGraphs(buildRegexTestProject('^(?:foo|bar)$').project);
    expect(validReport.ok).toBe(true);
    expect(validReport.errors).toHaveLength(0);

    const emptyReport = validateProjectLogicGraphs(buildRegexTestProject('   ').project);
    expect(emptyReport.ok).toBe(true);
    expect(emptyReport.warnings.some((w) => w.code === 'INVALID_NODE_CONFIG' && w.message.includes('empty pattern'))).toBe(true);

    const syntaxReport = validateProjectLogicGraphs(buildRegexTestProject('(unclosed').project);
    expect(syntaxReport.ok).toBe(false);
    expect(syntaxReport.errors.some((e) => e.code === 'INVALID_NODE_CONFIG' && e.message.includes('invalid regular expression'))).toBe(true);

    const redosReport = validateProjectLogicGraphs(buildRegexTestProject('(a?)+$').project);
    expect(redosReport.ok).toBe(false);
    expect(redosReport.errors.some((e) => e.code === 'UNSAFE_REGEX_PATTERN')).toBe(true);

    const namedBackrefReport = validateProjectLogicGraphs(buildRegexTestProject('(?<x>a+)\\k<x>').project);
    expect(namedBackrefReport.ok).toBe(false);
    expect(namedBackrefReport.errors.some((e) => e.code === 'UNSAFE_REGEX_PATTERN')).toBe(true);
  });

  it('strips SVG disallowed tags with closing whitespace and runs in linear time on 3,000 unclosed tags', () => {
    const withSpacedClose = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script ><rect width="10" height="10"/></svg>';
    const cleanedSpaced = sanitizeSvgMarkup(withSpacedClose);
    expect(cleanedSpaced).not.toMatch(/script/i);
    expect(cleanedSpaced).not.toContain('alert(1)');
    expect(cleanedSpaced).toContain('<rect');

    const pathological = `<svg xmlns="http://www.w3.org/2000/svg">${'<script>'.repeat(3000)}<rect width="8" height="8"/></svg>`;
    const t0 = performance.now();
    const cleanedPathological = sanitizeSvgMarkup(pathological);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(100);
    expect(cleanedPathological).not.toMatch(/<script/i);
    expect(cleanedPathological).toContain('<rect');
  });
});

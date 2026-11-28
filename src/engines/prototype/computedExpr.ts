/**
 * Folio Node Logic — Zero-`eval` Safe Computed Variable Expression Evaluator.
 *
 * Pure TypeScript recursive-descent parser and evaluator shared across:
 * 1. Headless Prototype Runtime (`runtime.ts`)
 * 2. Live Preview Micro-Runtime (`codegen.ts` -> emitted JS helper)
 * 3. Exported React TSX (`codegen.ts` -> emitted strict-TS helper)
 *
 * Strictly zero `eval()`, zero `new Function()`, prototype-pollution safe,
 * and bounded in length, token count, and AST depth.
 */

import type { LogicVariableValue } from '../../core/document/types';

export const MAX_COMPUTED_EXPR_LENGTH = 512;
const MAX_COMPUTED_EXPR_TOKENS = 256;
const MAX_COMPUTED_EXPR_DEPTH = 32;

const FORBIDDEN_IDENTIFIERS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'window',
  'document',
  'globalThis',
  'process',
  'eval',
  'Function',
]);

type TokenKind = 'num' | 'str' | 'ident' | 'op' | 'punct' | 'eof';

interface ExprToken {
  readonly kind: TokenKind;
  readonly value: string;
}

function tokenizeExpression(expr: string): { ok: true; tokens: ExprToken[] } | { ok: false; error: string } {
  if (expr.length > MAX_COMPUTED_EXPR_LENGTH) {
    return { ok: false, error: `Expression exceeds maximum length (${MAX_COMPUTED_EXPR_LENGTH} chars).` };
  }
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (tokens.length >= MAX_COMPUTED_EXPR_TOKENS) {
      return { ok: false, error: 'Expression is too complex (token limit exceeded).' };
    }
    // Number literal
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr.charAt(i + 1)))) {
      let j = i;
      let seenDot = false;
      while (j < expr.length) {
        const c = expr.charAt(j);
        if (c === '.') {
          if (seenDot) break;
          seenDot = true;
          j += 1;
        } else if (/[0-9]/.test(c)) {
          j += 1;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    // String literal ('...' or "...")
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      let closed = false;
      while (j < expr.length) {
        const c = expr.charAt(j);
        if (c === '\\' && j + 1 < expr.length) {
          const nx = expr.charAt(j + 1);
          out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
          j += 2;
        } else if (c === quote) {
          closed = true;
          j += 1;
          break;
        } else {
          out += c;
          j += 1;
        }
      }
      if (!closed) {
        return { ok: false, error: 'Unterminated string literal in expression.' };
      }
      tokens.push({ kind: 'str', value: out });
      i = j;
      continue;
    }
    // Identifier
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[a-zA-Z0-9_$-]/.test(expr.charAt(j))) {
        // Stop before '-' unless surrounded by identifier chars in a variable id? Avoid ambiguity with minus operator!
        if (expr.charAt(j) === '-') break;
        j += 1;
      }
      const ident = expr.slice(i, j);
      if (FORBIDDEN_IDENTIFIERS.has(ident)) {
        return { ok: false, error: `Identifier "${ident}" is not allowed in computed expressions.` };
      }
      tokens.push({ kind: 'ident', value: ident });
      i = j;
      continue;
    }
    // Two-character operators
    const two = expr.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    // Single-character operators
    if ('+-*/%<>!?:'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    // Punctuation
    if ('(),'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
      continue;
    }
    return { ok: false, error: `Unexpected character "${ch}" in computed expression.` };
  }
  tokens.push({ kind: 'eof', value: '' });
  return { ok: true, tokens };
}

function callSafeBuiltin(name: string, args: unknown[]): unknown {
  const num = (v: unknown, fb = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  switch (name.toLowerCase()) {
    case 'min':
      return args.length === 0 ? 0 : Math.min(...args.map((a) => num(a, 0)));
    case 'max':
      return args.length === 0 ? 0 : Math.max(...args.map((a) => num(a, 0)));
    case 'round':
      return Math.round(num(args[0], 0));
    case 'floor':
      return Math.floor(num(args[0], 0));
    case 'ceil':
      return Math.ceil(num(args[0], 0));
    case 'abs':
      return Math.abs(num(args[0], 0));
    case 'clamp': {
      const v = num(args[0], 0);
      const lo = num(args[1], 0);
      const hi = num(args[2], 100);
      return Math.max(lo, Math.min(hi, v));
    }
    case 'len': {
      const target = args[0];
      if (typeof target === 'string' || Array.isArray(target)) return target.length;
      if (target && typeof target === 'object') return Object.keys(target as Record<string, unknown>).length;
      return 0;
    }
    case 'lower':
      return String(args[0] ?? '').toLowerCase();
    case 'upper':
      return String(args[0] ?? '').toUpperCase();
    case 'trim':
      return String(args[0] ?? '').trim();
    case 'num':
      return num(args[0], 0);
    case 'str':
      return args[0] === null || args[0] === undefined
        ? ''
        : typeof args[0] === 'object'
          ? JSON.stringify(args[0])
          : String(args[0]);
    case 'bool':
      return Boolean(args[0]);
    default:
      return 0;
  }
}

const ALLOWED_BUILTINS = new Set([
  'min',
  'max',
  'round',
  'floor',
  'ceil',
  'abs',
  'clamp',
  'len',
  'lower',
  'upper',
  'trim',
  'num',
  'str',
  'bool',
]);

function resolveVarByIdent(
  ident: string,
  variables: Readonly<Record<string, LogicVariableValue>>,
  variableNameToId: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(variables, ident)) {
    return variables[ident];
  }
  const mappedId =
    variableNameToId instanceof Map
      ? (variableNameToId.get(ident) ?? variableNameToId.get(ident.toLowerCase()))
      : (
          (variableNameToId as Readonly<Record<string, string>>)[ident] ??
          (variableNameToId as Readonly<Record<string, string>>)[ident.toLowerCase()]
        );
  if (mappedId && Object.prototype.hasOwnProperty.call(variables, mappedId)) {
    return variables[mappedId];
  }
  return 0;
}

function interpolateTemplateOnly(
  expr: string,
  variables: Readonly<Record<string, LogicVariableValue>>,
  variableNameToId: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  return expr.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (_match, rawKey: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, rawKey)) {
      const v = variables[rawKey];
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    }
    const mappedId =
      variableNameToId instanceof Map
        ? (variableNameToId.get(rawKey) ?? variableNameToId.get(rawKey.toLowerCase()))
        : (
            (variableNameToId as Readonly<Record<string, string>>)[rawKey] ??
            (variableNameToId as Readonly<Record<string, string>>)[rawKey.toLowerCase()]
          );
    if (mappedId && Object.prototype.hasOwnProperty.call(variables, mappedId)) {
      const v = variables[mappedId];
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    }
    return '';
  });
}

function runParser(
  tokens: readonly ExprToken[],
  evaluate: boolean,
  variables: Readonly<Record<string, LogicVariableValue>>,
  variableNameToId: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let pos = 0;
  let depth = 0;

  const peek = (): ExprToken => tokens[pos] ?? { kind: 'eof', value: '' };
  const consume = (): ExprToken => {
    const tok = peek();
    pos += 1;
    return tok;
  };

  const enter = () => {
    depth += 1;
    if (depth > MAX_COMPUTED_EXPR_DEPTH) {
      throw new Error('Expression nesting depth exceeded.');
    }
  };
  const leave = () => {
    depth -= 1;
  };

  const parseTernary = (): unknown => {
    enter();
    try {
      const cond = parseOr();
      if (peek().kind === 'op' && peek().value === '?') {
        consume();
        const whenTrue = parseTernary();
        if (peek().kind !== 'op' || peek().value !== ':') {
          throw new Error('Expected ":" in ternary expression.');
        }
        consume();
        const whenFalse = parseTernary();
        return evaluate ? (Boolean(cond) ? whenTrue : whenFalse) : null;
      }
      return cond;
    } finally {
      leave();
    }
  };

  const parseOr = (): unknown => {
    let left = parseAnd();
    while (peek().kind === 'op' && peek().value === '||') {
      consume();
      const right = parseAnd();
      if (evaluate) left = Boolean(left) ? left : right;
    }
    return left;
  };

  const parseAnd = (): unknown => {
    let left = parseEquality();
    while (peek().kind === 'op' && peek().value === '&&') {
      consume();
      const right = parseEquality();
      if (evaluate) left = Boolean(left) ? right : left;
    }
    return left;
  };

  const parseEquality = (): unknown => {
    let left = parseRelational();
    while (peek().kind === 'op' && (peek().value === '==' || peek().value === '!=')) {
      const op = consume().value;
      const right = parseRelational();
      if (evaluate) {
        left = op === '==' ? left === right : left !== right;
      }
    }
    return left;
  };

  const parseRelational = (): unknown => {
    let left = parseAdditive();
    while (
      peek().kind === 'op'
      && (peek().value === '<' || peek().value === '<=' || peek().value === '>' || peek().value === '>=')
    ) {
      const op = consume().value;
      const right = parseAdditive();
      if (evaluate) {
        const l = Number(left);
        const r = Number(right);
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          left = false;
        } else if (op === '<') {
          left = l < r;
        } else if (op === '<=') {
          left = l <= r;
        } else if (op === '>') {
          left = l > r;
        } else {
          left = l >= r;
        }
      }
    }
    return left;
  };

  const parseAdditive = (): unknown => {
    let left = parseMultiplicative();
    while (peek().kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseMultiplicative();
      if (evaluate) {
        if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
          left = `${left == null ? '' : String(left)}${right == null ? '' : String(right)}`;
        } else {
          const l = Number(left);
          const r = Number(right);
          const sl = Number.isFinite(l) ? l : 0;
          const sr = Number.isFinite(r) ? r : 0;
          left = op === '+' ? sl + sr : sl - sr;
        }
      }
    }
    return left;
  };

  const parseMultiplicative = (): unknown => {
    let left = parseUnary();
    while (peek().kind === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = consume().value;
      const right = parseUnary();
      if (evaluate) {
        const l = Number(left);
        const r = Number(right);
        const sl = Number.isFinite(l) ? l : 0;
        const sr = Number.isFinite(r) ? r : 0;
        if (op === '*') left = sl * sr;
        else if (op === '/') left = sr === 0 ? 0 : sl / sr;
        else left = sr === 0 ? 0 : sl % sr;
      }
    }
    return left;
  };

  const parseUnary = (): unknown => {
    if (peek().kind === 'op' && (peek().value === '-' || peek().value === '+' || peek().value === '!')) {
      const op = consume().value;
      const operand = parseUnary();
      if (!evaluate) return null;
      if (op === '!') return !Boolean(operand);
      const n = Number(operand);
      const safe = Number.isFinite(n) ? n : 0;
      return op === '-' ? -safe : safe;
    }
    return parsePrimary();
  };

  const parsePrimary = (): unknown => {
    const tok = peek();
    if (tok.kind === 'num') {
      consume();
      const parsed = Number(tok.value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (tok.kind === 'str') {
      consume();
      return tok.value;
    }
    if (tok.kind === 'ident') {
      consume();
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') return null;
      if (peek().kind === 'punct' && peek().value === '(') {
        if (!ALLOWED_BUILTINS.has(tok.value.toLowerCase())) {
          throw new Error(`Unsupported function "${tok.value}" in computed expression.`);
        }
        consume(); // '('
        const args: unknown[] = [];
        if (!(peek().kind === 'punct' && peek().value === ')')) {
          args.push(parseTernary());
          while (peek().kind === 'punct' && peek().value === ',') {
            consume();
            args.push(parseTernary());
          }
        }
        if (peek().kind !== 'punct' || peek().value !== ')') {
          throw new Error(`Expected ")" after arguments to "${tok.value}".`);
        }
        consume();
        return evaluate ? callSafeBuiltin(tok.value, args) : null;
      }
      return evaluate ? resolveVarByIdent(tok.value, variables, variableNameToId) : null;
    }
    if (tok.kind === 'punct' && tok.value === '(') {
      consume();
      const inner = parseTernary();
      if (peek().kind !== 'punct' || peek().value !== ')') {
        throw new Error('Missing closing ")".');
      }
      consume();
      return inner;
    }
    throw new Error(`Unexpected token "${tok.value || 'end of expression'}".`);
  };

  try {
    const value = parseTernary();
    if (peek().kind !== 'eof') {
      return { ok: false, error: `Unexpected trailing token "${peek().value}".` };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid computed expression.' };
  }
}

export function validateComputedExpression(expr: string): { valid: boolean; error?: string } {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { valid: false, error: 'Computed expression is empty.' };
  }
  if (trimmed.length > MAX_COMPUTED_EXPR_LENGTH) {
    return { valid: false, error: `Computed expression exceeds ${MAX_COMPUTED_EXPR_LENGTH} characters.` };
  }
  if (trimmed.includes('{{')) {
    return { valid: true };
  }
  const tokenized = tokenizeExpression(trimmed);
  if (!tokenized.ok) {
    return { valid: false, error: tokenized.error };
  }
  const parsed = runParser(tokenized.tokens, false, {}, {});
  if (!parsed.ok) {
    return { valid: false, error: parsed.error };
  }
  return { valid: true };
}

export function evaluateComputedExpression(
  expr: string,
  variables: Readonly<Record<string, LogicVariableValue>>,
  variableNameToId: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { ok: false, error: 'Computed expression is empty.' };
  }
  if (trimmed.includes('{{')) {
    return { ok: true, value: interpolateTemplateOnly(trimmed, variables, variableNameToId) };
  }
  const tokenized = tokenizeExpression(trimmed);
  if (!tokenized.ok) {
    return { ok: false, error: tokenized.error };
  }
  return runParser(tokenized.tokens, true, variables, variableNameToId);
}

/**
 * Emits the exact same zero-`eval` computed expression evaluator for both
 * Live Preview JS (`mode: 'js'`) and Exported React TSX (`mode: 'ts'`).
 */
export function emitComputedExprEvaluatorLines(mode: 'js' | 'ts', indent: string): string[] {
  const isTs = mode === 'ts';
  const c = isTs ? 'const' : 'var';
  const l = isTs ? 'let' : 'var';
  const fnHdr = isTs
    ? `${indent}const evalComputedExpr = (expr: string, vars: Record<string, string | number | boolean | unknown[] | Record<string, unknown>>, nameToId: Record<string, string>): { ok: boolean; value: unknown } => {`
    : `${indent}function evalComputedExpr(expr, vars, nameToId) {`;
  const fnEnd = isTs ? `${indent}};` : `${indent}}`;
  const tokArrType = isTs ? ': Array<{ k: string; v: string }>' : '';
  const unkType = isTs ? ': unknown' : '';
  const numType = isTs ? ': number' : '';
  const strType = isTs ? ': string' : '';

  return [
    fnHdr,
    `${indent}  ${c} trimmed = String(expr || "").trim();`,
    `${indent}  if (!trimmed || trimmed.length > ${MAX_COMPUTED_EXPR_LENGTH}) return { ok: false, value: null };`,
    `${indent}  if (trimmed.indexOf("{{") !== -1) {`,
    `${indent}    ${c} out = trimmed.replace(/\\{\\{\\s*([a-zA-Z0-9_.:-]+)\\s*\\}\\}/g, function (_${isTs ? ': string' : ''}, rawKey${strType}) {`,
    `${indent}      if (Object.prototype.hasOwnProperty.call(vars, rawKey)) { ${c} v = vars[rawKey]; return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); }`,
    `${indent}      ${c} mid = nameToId[rawKey] || nameToId[rawKey.toLowerCase()];`,
    `${indent}      if (mid && Object.prototype.hasOwnProperty.call(vars, mid)) { ${c} v2 = vars[mid]; return typeof v2 === "object" && v2 !== null ? JSON.stringify(v2) : String(v2); }`,
    `${indent}      return "";`,
    `${indent}    });`,
    `${indent}    return { ok: true, value: out };`,
    `${indent}  }`,
    `${indent}  ${c} FORBID${isTs ? ': Record<string, number>' : ''} = { __proto__: 1, constructor: 1, prototype: 1, window: 1, document: 1, globalThis: 1, process: 1, eval: 1, Function: 1 };`,
    `${indent}  ${c} FNS${isTs ? ': Record<string, number>' : ''} = { min: 1, max: 1, round: 1, floor: 1, ceil: 1, abs: 1, clamp: 1, len: 1, lower: 1, upper: 1, trim: 1, num: 1, str: 1, bool: 1 };`,
    `${indent}  ${c} toks${tokArrType} = [];`,
    `${indent}  ${l} ti = 0;`,
    `${indent}  while (ti < trimmed.length) {`,
    `${indent}    ${c} ch = trimmed.charAt(ti);`,
    `${indent}    if (/\\s/.test(ch)) { ti += 1; continue; }`,
    `${indent}    if (toks.length >= ${MAX_COMPUTED_EXPR_TOKENS}) return { ok: false, value: null };`,
    `${indent}    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(trimmed.charAt(ti + 1)))) {`,
    `${indent}      ${l} tj = ti, dot = false;`,
    `${indent}      while (tj < trimmed.length) { ${c} cc = trimmed.charAt(tj); if (cc === ".") { if (dot) break; dot = true; tj += 1; } else if (/[0-9]/.test(cc)) { tj += 1; } else break; }`,
    `${indent}      toks.push({ k: "num", v: trimmed.slice(ti, tj) }); ti = tj; continue;`,
    `${indent}    }`,
    `${indent}    if (ch === "\\"" || ch === "'") {`,
    `${indent}      ${l} tj2 = ti + 1, sout = "", closed = false;`,
    `${indent}      while (tj2 < trimmed.length) { ${c} cc2 = trimmed.charAt(tj2); if (cc2 === "\\\\" && tj2 + 1 < trimmed.length) { ${c} nx = trimmed.charAt(tj2 + 1); sout += nx === "n" ? "\\n" : nx === "t" ? "\\t" : nx; tj2 += 2; } else if (cc2 === ch) { closed = true; tj2 += 1; break; } else { sout += cc2; tj2 += 1; } }`,
    `${indent}      if (!closed) return { ok: false, value: null };`,
    `${indent}      toks.push({ k: "str", v: sout }); ti = tj2; continue;`,
    `${indent}    }`,
    `${indent}    if (/[a-zA-Z_$]/.test(ch)) {`,
    `${indent}      ${l} tj3 = ti + 1;`,
    `${indent}      while (tj3 < trimmed.length && /[a-zA-Z0-9_$]/.test(trimmed.charAt(tj3))) tj3 += 1;`,
    `${indent}      ${c} idn = trimmed.slice(ti, tj3);`,
    `${indent}      if (FORBID[idn]) return { ok: false, value: null };`,
    `${indent}      toks.push({ k: "id", v: idn }); ti = tj3; continue;`,
    `${indent}    }`,
    `${indent}    ${c} two = trimmed.slice(ti, ti + 2);`,
    `${indent}    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") { toks.push({ k: "op", v: two }); ti += 2; continue; }`,
    `${indent}    if ("+-*/%<>!?:".indexOf(ch) !== -1) { toks.push({ k: "op", v: ch }); ti += 1; continue; }`,
    `${indent}    if ("(),".indexOf(ch) !== -1) { toks.push({ k: "p", v: ch }); ti += 1; continue; }`,
    `${indent}    return { ok: false, value: null };`,
    `${indent}  }`,
    `${indent}  toks.push({ k: "eof", v: "" });`,
    `${indent}  ${l} pos = 0, dep = 0;`,
    `${indent}  ${c} pk = () => toks[pos] || { k: "eof", v: "" };`,
    `${indent}  ${c} nxTok = () => { ${c} t = pk(); pos += 1; return t; };`,
    `${indent}  ${c} toN = (x${unkType})${numType} => { ${c} n = Number(x); return Number.isFinite(n) ? n : 0; };`,
    `${indent}  ${c} callFn = (fnName${strType}, args${isTs ? ': unknown[]' : ''})${unkType} => {`,
    `${indent}    ${c} f = fnName.toLowerCase();`,
    `${indent}    if (f === "min") return args.length ? Math.min.apply(null, args.map(toN)) : 0;`,
    `${indent}    if (f === "max") return args.length ? Math.max.apply(null, args.map(toN)) : 0;`,
    `${indent}    if (f === "round") return Math.round(toN(args[0]));`,
    `${indent}    if (f === "floor") return Math.floor(toN(args[0]));`,
    `${indent}    if (f === "ceil") return Math.ceil(toN(args[0]));`,
    `${indent}    if (f === "abs") return Math.abs(toN(args[0]));`,
    `${indent}    if (f === "clamp") return Math.max(toN(args[1]), Math.min(args.length > 2 ? toN(args[2]) : 100, toN(args[0])));`,
    `${indent}    if (f === "len") { ${c} t = args[0]; if (typeof t === "string" || Array.isArray(t)) return t.length; if (t && typeof t === "object") return Object.keys(t${isTs ? ' as Record<string, unknown>' : ''}).length; return 0; }`,
    `${indent}    if (f === "lower") return String(args[0] == null ? "" : args[0]).toLowerCase();`,
    `${indent}    if (f === "upper") return String(args[0] == null ? "" : args[0]).toUpperCase();`,
    `${indent}    if (f === "trim") return String(args[0] == null ? "" : args[0]).trim();`,
    `${indent}    if (f === "num") return toN(args[0]);`,
    `${indent}    if (f === "str") return args[0] == null ? "" : (typeof args[0] === "object" ? JSON.stringify(args[0]) : String(args[0]));`,
    `${indent}    if (f === "bool") return Boolean(args[0]);`,
    `${indent}    return 0;`,
    `${indent}  };`,
    `${indent}  ${c} pTern = ()${unkType} => { dep += 1; if (dep > ${MAX_COMPUTED_EXPR_DEPTH}) throw new Error("depth"); try { ${c} cd = pOr(); if (pk().k === "op" && pk().v === "?") { nxTok(); ${c} wt = pTern(); if (pk().k !== "op" || pk().v !== ":") throw new Error("colon"); nxTok(); ${c} wf = pTern(); return Boolean(cd) ? wt : wf; } return cd; } finally { dep -= 1; } };`,
    `${indent}  ${c} pOr = ()${unkType} => { ${l} lv = pAnd(); while (pk().k === "op" && pk().v === "||") { nxTok(); ${c} rv = pAnd(); lv = Boolean(lv) ? lv : rv; } return lv; };`,
    `${indent}  ${c} pAnd = ()${unkType} => { ${l} lv = pEq(); while (pk().k === "op" && pk().v === "&&") { nxTok(); ${c} rv = pEq(); lv = Boolean(lv) ? rv : lv; } return lv; };`,
    `${indent}  ${c} pEq = ()${unkType} => { ${l} lv = pRel(); while (pk().k === "op" && (pk().v === "==" || pk().v === "!=")) { ${c} op = nxTok().v; ${c} rv = pRel(); lv = op === "==" ? lv === rv : lv !== rv; } return lv; };`,
    `${indent}  ${c} pRel = ()${unkType} => { ${l} lv = pAdd(); while (pk().k === "op" && (pk().v === "<" || pk().v === "<=" || pk().v === ">" || pk().v === ">=")) { ${c} op = nxTok().v; ${c} rv = pAdd(); ${c} ln = Number(lv), rn = Number(rv); if (!Number.isFinite(ln) || !Number.isFinite(rn)) lv = false; else if (op === "<") lv = ln < rn; else if (op === "<=") lv = ln <= rn; else if (op === ">") lv = ln > rn; else lv = ln >= rn; } return lv; };`,
    `${indent}  ${c} pAdd = ()${unkType} => { ${l} lv = pMul(); while (pk().k === "op" && (pk().v === "+" || pk().v === "-")) { ${c} op = nxTok().v; ${c} rv = pMul(); if (op === "+" && (typeof lv === "string" || typeof rv === "string")) lv = String(lv == null ? "" : lv) + String(rv == null ? "" : rv); else lv = op === "+" ? toN(lv) + toN(rv) : toN(lv) - toN(rv); } return lv; };`,
    `${indent}  ${c} pMul = ()${unkType} => { ${l} lv = pUn(); while (pk().k === "op" && (pk().v === "*" || pk().v === "/" || pk().v === "%")) { ${c} op = nxTok().v; ${c} rv = pUn(); ${c} ln = toN(lv), rn = toN(rv); lv = op === "*" ? ln * rn : (rn === 0 ? 0 : (op === "/" ? ln / rn : ln % rn)); } return lv; };`,
    `${indent}  ${c} pUn = ()${unkType} => { if (pk().k === "op" && (pk().v === "-" || pk().v === "+" || pk().v === "!")) { ${c} op = nxTok().v; ${c} ov = pUn(); return op === "!" ? !Boolean(ov) : (op === "-" ? -toN(ov) : toN(ov)); } return pPri(); };`,
    `${indent}  ${c} pPri = ()${unkType} => {`,
    `${indent}    ${c} t = pk();`,
    `${indent}    if (t.k === "num") { nxTok(); ${c} nv = Number(t.v); return Number.isFinite(nv) ? nv : 0; }`,
    `${indent}    if (t.k === "str") { nxTok(); return t.v; }`,
    `${indent}    if (t.k === "id") {`,
    `${indent}      nxTok();`,
    `${indent}      if (t.v === "true") return true; if (t.v === "false") return false; if (t.v === "null") return null;`,
    `${indent}      if (pk().k === "p" && pk().v === "(") {`,
    `${indent}        if (!FNS[t.v.toLowerCase()]) throw new Error("fn");`,
    `${indent}        nxTok(); ${c} args${isTs ? ': unknown[]' : ''} = [];`,
    `${indent}        if (!(pk().k === "p" && pk().v === ")")) { args.push(pTern()); while (pk().k === "p" && pk().v === ",") { nxTok(); args.push(pTern()); } }`,
    `${indent}        if (pk().k !== "p" || pk().v !== ")") throw new Error("rparen");`,
    `${indent}        nxTok(); return callFn(t.v, args);`,
    `${indent}      }`,
    `${indent}      if (Object.prototype.hasOwnProperty.call(vars, t.v)) return vars[t.v];`,
    `${indent}      ${c} m = nameToId[t.v] || nameToId[t.v.toLowerCase()];`,
    `${indent}      return m && Object.prototype.hasOwnProperty.call(vars, m) ? vars[m] : 0;`,
    `${indent}    }`,
    `${indent}    if (t.k === "p" && t.v === "(") { nxTok(); ${c} iv = pTern(); if (pk().k !== "p" || pk().v !== ")") throw new Error("rparen"); nxTok(); return iv; }`,
    `${indent}    throw new Error("tok");`,
    `${indent}  };`,
    `${indent}  try { ${c} val = pTern(); if (pk().k !== "eof") return { ok: false, value: null }; return { ok: true, value: val }; } catch ${isTs ? '' : '(e) '}{ return { ok: false, value: null }; }`,
    fnEnd,
  ];
}

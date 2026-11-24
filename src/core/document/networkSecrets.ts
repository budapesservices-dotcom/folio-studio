/**
 * Folio Native Core — Single Source of Truth for Network Secret Validation & Sanitization.
 *
 * Security contract (enforced across semantic validation, `.flop` v2 serialization,
 * legacy migrations, IndexedDB persistence, Live Preview payloads, and HTML/React/ZIP codegen):
 * 1. Sensitive HTTP headers (`Authorization`, `Proxy-Authorization`, `X-API-Key`,
 *    `API-Key`, `X-Auth-Token`, `Cookie`, `Set-Cookie`, matched case-insensitively)
 *    are NEVER persisted or exported unless their value is an explicit safe
 *    placeholder (`env:VAR_NAME`, `{{VAR_NAME}}`, or `(Bearer|Basic|Token) <placeholder>`).
 * 2. Arbitrary/custom headers whose values contain raw credential/token patterns
 *    (`Bearer ...`, `Basic ...`, `Token ...`, JWT `eyJ...`, `sk-...`, `pk_live_...`,
 *    `gh[pousr]_...`, `github_pat_...`, `AIza...`, `xox[baprs]-...`, `AKIA...`,
 *    `glpat-...`, PEM private keys) are hard-gated and stripped.
 * 3. Malformed / non-JSON `globalHeaders` strings containing raw secrets or
 *    sensitive header assignments fail closed and are cleared.
 * 4. `authSecretRef` only accepts safe env/secret key identifiers (never raw tokens),
 *    legacy `authToken` fields are stripped, and embedded `user:pass@` URL credentials
 *    are stripped from network URLs.
 */

import type {
  FolioProject,
  LogicGraph,
  LogicNetworkSettings,
  LogicNode,
} from './types';

/** Valid environment variable / secret reference identifier (optional `env:` prefix). */
const SAFE_SECRET_REF_PATTERN = /^(?:env:)?[A-Z][A-Z0-9_]{1,63}$/i;

/** Placeholder syntax allowed inside header values without leaking real credentials. */
const SAFE_HEADER_PLACEHOLDER_PATTERN =
  /^(?:(?:Bearer|Basic|Token)\s+)?(?:env:[A-Z][A-Z0-9_]{1,63}|\{\{[A-Za-z0-9_.-]{1,64}\}\})$/i;

/** Sensitive header names that must never contain inline secrets (matched case-insensitively). */
export const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

/** Patterns indicating a raw credential rather than a safe env key reference in `authSecretRef`. */
const RAW_SECRET_REF_INDICATORS: readonly RegExp[] = [
  /^bearer\s+/i,
  /^basic\s+/i,
  /^token\s+/i,
  /\bsk-(?:live|test|proj|ant|or)?[-_a-z0-9]{8,}/i,
  /\bsk-[a-z0-9_-]{8,}/i,
  /\bpk_(?:live|test)_[0-9A-Za-z]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bglpat-[0-9A-Za-z_-]{12,}/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\s/,
];

/** Patterns indicating a raw secret/token embedded in any header or network string value. */
const RAW_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bbearer\s+(?!env:[A-Z][A-Z0-9_]{1,63}\b)(?!\{\{[A-Za-z0-9_.-]{1,64}\}\})[^\s"',}]+/i,
  /\bbasic\s+(?!env:[A-Z][A-Z0-9_]{1,63}\b)(?!\{\{[A-Za-z0-9_.-]{1,64}\}\})[A-Za-z0-9+/=_-]{6,}/i,
  /\btoken\s+(?!env:[A-Z][A-Z0-9_]{1,63}\b)(?!\{\{[A-Za-z0-9_.-]{1,64}\}\})[^\s"',}]+/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/,
  /\bsk-(?:live|test|proj|ant|or)?[-_a-z0-9]{8,}/i,
  /\bsk-[a-z0-9_-]{8,}/i,
  /\bpk_(?:live|test)_[0-9A-Za-z]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bglpat-[0-9A-Za-z_-]{12,}/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
];

/** Detects malformed/non-JSON strings assigning sensitive headers (e.g. raw HTTP header lines). */
const RAW_SENSITIVE_HEADER_LINE_PATTERN =
  /(?:^|[\s,{'"`])(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie)\s*["']?\s*[:=]\s*([^\r\n,}]+)/i;

/** Prototype-pollution keys stripped when parsing untrusted header JSON. */
const FORBIDDEN_OBJECT_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Node data keys that must never carry raw credentials into persistence or exports. */
const FORBIDDEN_NODE_SECRET_DATA_KEYS: ReadonlySet<string> = new Set([
  'authtoken',
  'apikey',
  'api_key',
  'x-api-key',
  'api-key',
  'secret',
  'clientsecret',
  'client_secret',
  'password',
  'passwd',
  'authorization',
  'proxy-authorization',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearertoken',
  'bearer_token',
]);

const URL_DATA_KEYS: ReadonlySet<string> = new Set([
  'url',
  'endpoint',
  'baseurl',
  'socketurl',
]);

const HEADER_DATA_KEYS: ReadonlySet<string> = new Set([
  'headers',
  'globalheaders',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(raw, (key, val: unknown) => {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) return undefined;
      return val;
    });
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** Returns true if `headerName` is a sensitive credential header (case-insensitive). */
export function isSensitiveHeaderName(headerName: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(headerName.trim().toLowerCase());
}

/** Normalizes an env/secret reference string (strips optional `env:` prefix and trims). */
export function normalizeSecretRef(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^env:/i, '').trim();
}

/**
 * Returns true if `raw` is empty or a valid environment/secret key reference
 * (e.g. `API_TOKEN` or `env:API_TOKEN`) and does not resemble a raw credential.
 */
export function isSafeSecretRef(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.length > 128) return false;
  for (const pattern of RAW_SECRET_REF_INDICATORS) {
    if (pattern.test(trimmed)) return false;
  }
  return SAFE_SECRET_REF_PATTERN.test(trimmed);
}

/**
 * Returns true if a header value is a recognized safe placeholder
 * (`env:VAR`, `{{VAR}}`, or `Bearer|Basic|Token` followed by a placeholder).
 */
export function isSafeHeaderPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return SAFE_HEADER_PLACEHOLDER_PATTERN.test(trimmed);
}

/**
 * Returns true if a string appears to contain a raw credential or secret token
 * (Bearer/Basic/Token literal, JWT, API key prefix, PEM key, etc.).
 */
export function containsRawSecretPattern(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isSafeHeaderPlaceholder(trimmed)) return false;
  for (const pattern of RAW_SECRET_VALUE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/** Returns true if a URL embeds `username` or `password` userinfo (`https://user:pass@host`). */
export function hasEmbeddedUrlCredentials(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return false;
  }
}

/** Strips any embedded `user:pass@` credentials from an absolute URL while preserving safe URLs/paths. */
export function sanitizeUrlCredentials(rawUrl: string): string {
  if (!hasEmbeddedUrlCredentials(rawUrl)) return rawUrl;
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');
  }
}

function serializeCandidateValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isDisallowedHeaderEntry(key: string, value: unknown): boolean {
  if (FORBIDDEN_OBJECT_KEYS.has(key)) return true;
  if (isSensitiveHeaderName(key)) {
    if (typeof value !== 'string') {
      return value !== null && value !== undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) return false;
    return !isSafeHeaderPlaceholder(trimmed);
  }
  const serialized = serializeCandidateValue(value);
  return containsRawSecretPattern(serialized);
}

/**
 * Inspects a `globalHeaders` (or node `headers`) JSON string and returns any
 * header keys that embed raw credentials directly instead of safe placeholders.
 * Also flags malformed/non-JSON strings that contain raw secret patterns or
 * sensitive header assignments.
 */
export function detectInlineSecretHeaders(globalHeadersJson: string): string[] {
  const trimmed = globalHeadersJson.trim();
  if (!trimmed) return [];

  const parsedResult = safeParseJson(trimmed);
  if (!parsedResult.ok || !isPlainRecord(parsedResult.value)) {
    if (containsRawSecretPattern(trimmed)) {
      return ['globalHeaders'];
    }
    const rawMatch = RAW_SENSITIVE_HEADER_LINE_PATTERN.exec(trimmed);
    if (rawMatch) {
      const assigned = rawMatch[2].trim().replace(/^["']|["']$/g, '').trim();
      if (assigned && !isSafeHeaderPlaceholder(assigned)) {
        return [rawMatch[1]];
      }
    }
    return [];
  }

  const flagged: string[] = [];
  for (const [key, val] of Object.entries(parsedResult.value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    if (isDisallowedHeaderEntry(key, val)) {
      flagged.push(key);
    }
  }
  return flagged;
}

/**
 * Hard-gates a header record object, stripping any sensitive header unless its
 * value is an allowed placeholder and stripping any header whose value contains
 * a raw secret/token pattern.
 */
export function sanitizeHeaderRecordForPersistence(
  record: Record<string, unknown>,
): { readonly sanitized: Record<string, unknown>; readonly mutated: boolean } {
  const clean: Record<string, unknown> = {};
  let mutated = false;

  for (const [key, val] of Object.entries(record)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      mutated = true;
      continue;
    }
    if (isSensitiveHeaderName(key)) {
      if (typeof val === 'string' && isSafeHeaderPlaceholder(val.trim())) {
        clean[key] = val;
      } else {
        mutated = true;
      }
      continue;
    }
    const serialized = serializeCandidateValue(val);
    if (containsRawSecretPattern(serialized)) {
      mutated = true;
      continue;
    }
    clean[key] = val;
  }

  return { sanitized: mutated ? clean : record, mutated };
}

/**
 * Hard-gates a `globalHeaders` JSON string for persistence, Live Preview, and export.
 * - Drops all sensitive headers (case-insensitive) unless they use a safe placeholder.
 * - Drops any header whose value contains a raw secret/token pattern.
 * - Fails closed (`''`) on malformed / non-JSON strings containing secrets or sensitive headers.
 * - Preserves exact formatting when no headers were stripped.
 */
export function sanitizeGlobalHeadersForPersistence(globalHeadersJson: string): string {
  const trimmed = globalHeadersJson.trim();
  if (!trimmed) return '';

  const parsedResult = safeParseJson(trimmed);
  if (!parsedResult.ok || !isPlainRecord(parsedResult.value)) {
    if (detectInlineSecretHeaders(trimmed).length > 0 || containsRawSecretPattern(trimmed)) {
      return '';
    }
    return globalHeadersJson;
  }

  const { sanitized, mutated } = sanitizeHeaderRecordForPersistence(parsedResult.value);
  if (!mutated) return globalHeadersJson;
  if (Object.keys(sanitized).length === 0) return '';
  return JSON.stringify(sanitized);
}

/**
 * Sanitizes any incoming or legacy `networkSettings` object into the strict
 * `.flop` v2 `LogicNetworkSettings` shape:
 * - `baseUrl`: strips embedded `user:pass@` credentials.
 * - `globalHeaders`: hard-gates sensitive headers & raw secret patterns.
 * - `authSecretRef`: preserves only safe env key identifiers; strips raw `authToken`.
 */
export function sanitizeNetworkSettingsForPersistence(
  input: unknown,
): LogicNetworkSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { baseUrl: '', globalHeaders: '', authSecretRef: '' };
  }
  const rec = input as Record<string, unknown>;
  const rawBaseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl : '';
  const baseUrl = sanitizeUrlCredentials(rawBaseUrl);
  const rawGlobalHeaders = typeof rec.globalHeaders === 'string' ? rec.globalHeaders : '';
  const globalHeaders = sanitizeGlobalHeadersForPersistence(rawGlobalHeaders);

  let authSecretRef = '';
  if (typeof rec.authSecretRef === 'string') {
    authSecretRef = isSafeSecretRef(rec.authSecretRef)
      ? normalizeSecretRef(rec.authSecretRef)
      : '';
  } else if (typeof rec.authToken === 'string') {
    // Legacy `.flop` migration: preserve only safe env references; strip raw tokens.
    const candidate = rec.authToken.trim();
    if (candidate && isSafeSecretRef(candidate)) {
      authSecretRef = normalizeSecretRef(candidate);
    }
  }

  return {
    baseUrl,
    globalHeaders,
    authSecretRef,
  };
}

/**
 * Sanitizes a single logic node's `data` map for persistence, Live Preview, and export.
 * Preserves referential equality when already clean.
 */
export function sanitizeLogicNodeDataRecord<T extends Record<string, unknown>>(
  nodeType: string,
  data: T,
): T {
  const isNetworkNode = nodeType.startsWith('network.') || nodeType === 'source.external';
  let mutated = false;
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.trim().toLowerCase();

    if (FORBIDDEN_NODE_SECRET_DATA_KEYS.has(normalizedKey)) {
      mutated = true;
      continue;
    }

    if (normalizedKey === 'authsecretref') {
      if (typeof value === 'string') {
        const nextVal = isSafeSecretRef(value) ? normalizeSecretRef(value) : '';
        if (nextVal !== value) mutated = true;
        clean[key] = nextVal;
      } else {
        mutated = true;
      }
      continue;
    }

    if (HEADER_DATA_KEYS.has(normalizedKey)) {
      if (typeof value === 'string') {
        const nextHeaders = sanitizeGlobalHeadersForPersistence(value);
        if (nextHeaders !== value) mutated = true;
        clean[key] = nextHeaders;
      } else if (isPlainRecord(value)) {
        const res = sanitizeHeaderRecordForPersistence(value);
        if (res.mutated) mutated = true;
        clean[key] = res.sanitized;
      } else {
        clean[key] = value;
      }
      continue;
    }

    if (URL_DATA_KEYS.has(normalizedKey) && typeof value === 'string') {
      const nextUrl = sanitizeUrlCredentials(value);
      if (nextUrl !== value) mutated = true;
      clean[key] = nextUrl;
      continue;
    }

    if (isNetworkNode && typeof value === 'string' && containsRawSecretPattern(value)) {
      mutated = true;
      clean[key] = '';
      continue;
    }

    clean[key] = value;
  }

  return mutated ? (clean as T) : data;
}

/** Sanitizes network settings and node data within one `LogicGraph` (no-op when clean). */
export function sanitizeLogicGraphNetworkSecrets(graph: LogicGraph): LogicGraph {
  let mutated = false;

  let nextNetworkSettings = graph.networkSettings;
  if (graph.networkSettings !== undefined) {
    const sanitized = sanitizeNetworkSettingsForPersistence(graph.networkSettings);
    const rawRec = graph.networkSettings as unknown as Record<string, unknown>;
    const hasExtraKeys = Object.keys(rawRec).some(
      (key) => key !== 'baseUrl' && key !== 'globalHeaders' && key !== 'authSecretRef',
    );
    if (
      hasExtraKeys
      || sanitized.baseUrl !== graph.networkSettings.baseUrl
      || sanitized.globalHeaders !== graph.networkSettings.globalHeaders
      || sanitized.authSecretRef !== graph.networkSettings.authSecretRef
    ) {
      nextNetworkSettings = sanitized;
      mutated = true;
    }
  }

  let nodesMutated = false;
  const nextNodes: LogicNode[] = graph.nodes.map((node) => {
    const cleanData = sanitizeLogicNodeDataRecord(node.type, node.data);
    if (cleanData === node.data) return node;
    nodesMutated = true;
    return { ...node, data: cleanData };
  });

  if (!mutated && !nodesMutated) return graph;
  return {
    ...graph,
    ...(nextNetworkSettings !== undefined ? { networkSettings: nextNetworkSettings } : {}),
    nodes: nodesMutated ? nextNodes : graph.nodes,
  };
}

/**
 * Sanitizes all network settings and logic node payloads across a `FolioProject`.
 * Guarantees zero raw credentials in `globalHeaders`, `authSecretRef`, URLs, or
 * network node data before writing to `.flop`, IndexedDB, Live Preview, or code exports.
 * Preserves referential equality when already clean.
 */
export function sanitizeProjectNetworkSecrets(project: FolioProject): FolioProject {
  if (!Array.isArray(project.logicGraphs) || project.logicGraphs.length === 0) {
    return project;
  }
  let mutated = false;
  const nextGraphs = project.logicGraphs.map((graph) => {
    const cleanGraph = sanitizeLogicGraphNetworkSecrets(graph);
    if (cleanGraph !== graph) mutated = true;
    return cleanGraph;
  });
  return mutated ? { ...project, logicGraphs: nextGraphs } : project;
}

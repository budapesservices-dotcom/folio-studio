/**
 * Folio Node Logic — Network Secret Reference & Session-Only Local Test Store.
 *
 * Security boundary:
 * - `.flop` files and exported bundles ONLY store `authSecretRef` (an env key
 *   reference such as `API_TOKEN`), NEVER raw API keys, Bearer tokens, or cookies.
 * - Temporary tokens entered in the Studio Network tab for local simulation stay
 *   strictly in JavaScript process memory (never written to `.flop`, IndexedDB,
 *   `localStorage`, `sessionStorage`, Live Preview HTML, or exported React code).
 */

import type { LogicNetworkSettings } from '../../core/document/types';

/** Valid environment variable / secret reference identifier (optional `env:` prefix). */
const SAFE_SECRET_REF_PATTERN = /^(?:env:)?[A-Z][A-Z0-9_]{1,63}$/i;

/** Patterns indicating a raw credential rather than a safe env key reference. */
const RAW_SECRET_INDICATORS: readonly RegExp[] = [
  /^bearer\s+/i,
  /^basic\s+/i,
  /^token\s+/i,
  /\bsk-[a-z0-9_-]{8,}/i,
  /\bgh[pousr]_[a-z0-9]{12,}/i,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\s/,
];

/** Sensitive header names that must never contain inline secrets inside `.flop`. */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

/** Placeholder syntax allowed in header values without leaking real credentials. */
const SAFE_HEADER_PLACEHOLDER_PATTERN = /^(?:env:[A-Z][A-Z0-9_]{1,63}|\{\{[A-Za-z0-9_.-]+\}\}|Bearer\s+(?:env:[A-Z][A-Z0-9_]{1,63}|\{\{[A-Za-z0-9_.-]+\}\}))$/i;

/**
 * In-memory session-only store for local Studio testing tokens.
 * Automatically cleared on page reload and never serialized.
 */
const sessionLocalTestTokens = new Map<string, string>();

function makeSessionTokenKey(graphId: string, secretRef: string): string {
  const cleanRef = normalizeSecretRef(secretRef) || 'default';
  return `${graphId}::${cleanRef}`;
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
  for (const pattern of RAW_SECRET_INDICATORS) {
    if (pattern.test(trimmed)) return false;
  }
  return SAFE_SECRET_REF_PATTERN.test(trimmed);
}

/**
 * Inspects a JSON `globalHeaders` string and returns any header keys that appear
 * to embed raw credentials directly inside `.flop` project settings.
 */
export function detectInlineSecretHeaders(globalHeadersJson: string): string[] {
  const trimmed = globalHeadersJson.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  const flagged: string[] = [];
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!SENSITIVE_HEADER_NAMES.has(normalizedKey)) continue;
    const strVal = typeof val === 'string' ? val.trim() : '';
    if (!strVal) continue;
    if (!SAFE_HEADER_PLACEHOLDER_PATTERN.test(strVal)) {
      flagged.push(key);
    }
  }
  return flagged;
}

/**
 * Sanitizes any incoming or legacy `networkSettings` object into the strict
 * `.flop` v2 `LogicNetworkSettings` shape (`authSecretRef` only, zero raw `authToken`).
 */
export function sanitizeNetworkSettingsForPersistence(
  input: unknown,
): LogicNetworkSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { baseUrl: '', globalHeaders: '', authSecretRef: '' };
  }
  const rec = input as Record<string, unknown>;
  const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl : '';
  const globalHeaders = typeof rec.globalHeaders === 'string' ? rec.globalHeaders : '';

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

/** Stores a temporary local-only test token in JS memory for the active Studio session. */
export function setSessionNetworkTestToken(
  graphId: string,
  secretRef: string,
  token: string,
): void {
  const key = makeSessionTokenKey(graphId, secretRef);
  if (!token) {
    sessionLocalTestTokens.delete(key);
    return;
  }
  sessionLocalTestTokens.set(key, token);
}

/** Reads the in-memory local-only test token for the active Studio session, if any. */
export function getSessionNetworkTestToken(
  graphId: string,
  secretRef: string,
): string {
  return sessionLocalTestTokens.get(makeSessionTokenKey(graphId, secretRef)) ?? '';
}

/** Returns true when a session-only local test token is currently held in memory. */
export function hasSessionNetworkTestToken(
  graphId: string,
  secretRef: string,
): boolean {
  return sessionLocalTestTokens.has(makeSessionTokenKey(graphId, secretRef));
}

/** Clears one or all session-only local test tokens from JS memory. */
export function clearSessionNetworkTestToken(
  graphId?: string,
  secretRef?: string,
): void {
  if (!graphId) {
    sessionLocalTestTokens.clear();
    return;
  }
  if (secretRef !== undefined) {
    sessionLocalTestTokens.delete(makeSessionTokenKey(graphId, secretRef));
    return;
  }
  const prefix = `${graphId}::`;
  for (const key of sessionLocalTestTokens.keys()) {
    if (key.startsWith(prefix)) {
      sessionLocalTestTokens.delete(key);
    }
  }
}

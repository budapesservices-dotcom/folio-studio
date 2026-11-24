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

import {
  SENSITIVE_HEADER_NAMES,
  containsRawSecretPattern,
  detectInlineSecretHeaders,
  hasEmbeddedUrlCredentials,
  isSafeHeaderPlaceholder,
  isSafeSecretRef,
  isSensitiveHeaderName,
  normalizeSecretRef,
  sanitizeGlobalHeadersForPersistence,
  sanitizeHeaderRecordForPersistence,
  sanitizeLogicFramePresetNetworkSecrets,
  sanitizeLogicGraphNetworkSecrets,
  sanitizeLogicNodeDataRecord,
  sanitizeNetworkSettingsForPersistence,
  sanitizeProjectNetworkSecrets,
  sanitizeUrlCredentials,
} from '../../core/document/networkSecrets';

export {
  SENSITIVE_HEADER_NAMES,
  containsRawSecretPattern,
  detectInlineSecretHeaders,
  hasEmbeddedUrlCredentials,
  isSafeHeaderPlaceholder,
  isSafeSecretRef,
  isSensitiveHeaderName,
  normalizeSecretRef,
  sanitizeGlobalHeadersForPersistence,
  sanitizeHeaderRecordForPersistence,
  sanitizeLogicFramePresetNetworkSecrets,
  sanitizeLogicGraphNetworkSecrets,
  sanitizeLogicNodeDataRecord,
  sanitizeNetworkSettingsForPersistence,
  sanitizeProjectNetworkSecrets,
  sanitizeUrlCredentials,
};

/**
 * In-memory session-only store for local Studio testing tokens.
 * Automatically cleared on page reload and never serialized.
 */
const sessionLocalTestTokens = new Map<string, string>();

function makeSessionTokenKey(graphId: string, secretRef: string): string {
  const cleanRef = normalizeSecretRef(secretRef) || 'default';
  return `${graphId}::${cleanRef}`;
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

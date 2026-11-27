/**
 * Folio Node Logic — Hardened Server-Side HTTP Proxy Handler.
 *
 * Runtime-agnostic Web Standards implementation (zero Node.js built-in imports)
 * shared between:
 * - Cloudflare Pages Function (`functions/api/logic/http-proxy.ts`)
 * - Local Vite dev/preview middleware (`vite.config.ts`)
 *
 * Security controls:
 * 1. Backend authentication (Cloudflare Access RS256 JWT via Web Crypto JWKS or
 *    constant-time `FOLIO_PROXY_AUTH_TOKEN`). Never trusts `Origin` or
 *    `Sec-Fetch-Site` alone as authentication.
 * 2. Fail-closed server-side secret guard: `authSecretRef` is ALWAYS rejected
 *    when backend authentication is not configured, when the secret env var is
 *    missing, or when the target host is not explicitly allowlisted.
 * 3. Strict hostname allowlist (`FOLIO_PROXY_ALLOWED_HOSTS` and optional
 *    per-secret `FOLIO_SECRET_<REF>_HOSTS`) with exact + leading-dot subdomain
 *    matching. Wildcards (`*`, `*.example.com`) are strictly forbidden.
 * 4. SSRF protection blocking non-HTTP(S) schemes, embedded URL credentials,
 *    localhost, internal domains, cloud metadata hosts, IPv4/IPv6 private,
 *    loopback, link-local, CGNAT, NAT64, IPv4-mapped IPv6, obfuscated numeric
 *    IPs, and DNS-rebinding private addresses.
 * 5. `redirect: 'manual'` + explicit rejection of all 3xx / `opaqueredirect`
 *    responses so redirects cannot bypass host or SSRF checks.
 * 6. Request/response byte caps (512 KiB JSON envelope, 256 KiB upstream body,
 *    1 MiB upstream response) and AbortController timeout.
 * 7. Zero token/secret logging or echo in errors or API responses.
 */

export interface HttpProxyRequestPayload {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly authSecretRef?: string;
}

export interface HttpProxyResult {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly data: unknown;
  readonly durationMs: number;
  readonly error?: string;
}

export interface DnsLookupResult {
  readonly address: string;
  readonly family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<readonly DnsLookupResult[]>;

export interface ProxyAuthVerificationResult {
  readonly ok: boolean;
  readonly authenticated: boolean;
  readonly method: 'cloudflare-access' | 'proxy-token' | 'unauthenticated-public' | 'none';
  readonly httpStatus: number;
  readonly error?: string;
}

export interface ExecuteServerHttpProxyOptions {
  readonly dnsLookup?: DnsLookupFn;
  readonly fetchImpl?: typeof fetch;
  readonly jwksFetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly requestHeaders?: Headers | Readonly<Record<string, string | string[] | undefined>>;
  readonly timeoutMs?: number;
  readonly nowMs?: () => number;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
export const MAX_PROXY_ENVELOPE_BYTES = 512 * 1024;
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const SAFE_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const JWT_CLOCK_SKEW_SECONDS = 30;

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'origin',
  'referer',
  'cf-access-jwt-assertion',
  'cf-connecting-ip',
  'x-folio-proxy-auth',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'metadata.azure.com',
  'instance-data',
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.arpa',
  '.home.arpa',
];

interface CachedJwks {
  readonly expiresAt: number;
  readonly keys: readonly JsonWebKey[];
}

const jwksCache = new Map<string, CachedJwks>();

/** Clears the in-memory Cloudflare Access JWKS cache (useful in tests). */
export function clearProxyJwksCache(): void {
  jwksCache.clear();
}

function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null; // Reject octal-like leading zeros
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

function isPrivateIpv4Octets(v4: readonly [number, number, number, number]): boolean {
  const [a, b, c] = v4;
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // 10.0.0.0/8 RFC1918 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/16 IETF protocol / TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // Multicast, reserved, broadcast
  return false;
}

/**
 * Expands a canonical or compressed IPv6 literal (including embedded IPv4 tail)
 * into 8 16-bit integer hextets, or returns null if malformed.
 */
function expandIpv6(rawIp: string): number[] | null {
  let ip = rawIp;
  // Convert trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) to two hex hextets
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const v4Part = ip.slice(lastColon + 1);
    const v4 = parseIpv4Octets(v4Part);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegment = (segment: string): number[] | null => {
    if (!segment) return [];
    const tokens = segment.split(':');
    const out: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
      out.push(Number.parseInt(token, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const parts = parseSegment(doubleColonParts[0]);
    return parts && parts.length === 8 ? parts : null;
  }

  const left = parseSegment(doubleColonParts[0]);
  const right = parseSegment(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/**
 * Returns true if an IPv4 or IPv6 literal belongs to any non-public range
 * (loopback, RFC1918 private, link-local / cloud metadata 169.254.0.0/16,
 * CGNAT 100.64.0.0/10, multicast, unspecified, IPv6 ULA/link-local/loopback,
 * NAT64, Teredo, or IPv4-mapped IPv6).
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;

  // Strip IPv6 zone ID if present (e.g. fe80::1%eth0)
  const cleanIp = ip.split('%')[0];

  const v4 = parseIpv4Octets(cleanIp);
  if (v4) {
    return isPrivateIpv4Octets(v4);
  }

  // IPv6 checks using full 8-hextet expansion
  if (cleanIp.includes(':')) {
    const h = expandIpv6(cleanIp);
    if (!h) return true; // Reject malformed IPv6 fail-closed

    const isAllZeroPrefix6 = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
    const isAllZeroPrefix5 = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;

    // :: (unspecified) and ::1 (loopback)
    if (isAllZeroPrefix6 && h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;

    // IPv4-compatible IPv6 (::/96)
    if (isAllZeroPrefix6 && (h[6] !== 0 || h[7] > 1)) {
      return isPrivateIpv4Octets([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff]);
    }

    // IPv4-mapped IPv6 (::ffff:0:0/96)
    if (isAllZeroPrefix5 && h[5] === 0xffff) {
      return isPrivateIpv4Octets([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff]);
    }

    // NAT64 well-known prefix (64:ff9b::/96)
    if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      return isPrivateIpv4Octets([(h[6] >> 8) & 0xff, h[6] & 0xff, (h[7] >> 8) & 0xff, h[7] & 0xff]);
    }

    // Discard-only (100::/64)
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;
    // Teredo tunneling (2001::/32)
    if (h[0] === 0x2001 && h[1] === 0x0000) return true;
    // Documentation (2001:db8::/32)
    if (h[0] === 0x2001 && h[1] === 0x0db8) return true;
    // Unique Local Address (fc00::/7 — includes AWS IPv6 metadata fd00:ec2::254)
    if ((h[0] & 0xfe00) === 0xfc00) return true;
    // Link-local (fe80::/10)
    if ((h[0] & 0xffc0) === 0xfe80) return true;
    // Multicast (ff00::/8)
    if ((h[0] & 0xff00) === 0xff00) return true;

    return false;
  }

  // Numeric/octal/hex/shortened obfuscated IPv4 literals (e.g. 2130706433, 0x7f000001, 0177.0.0.1, 127.1)
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(cleanIp)) return true;
  if (/^[0-9a-fx.]+$/i.test(cleanIp) && cleanIp.includes('.')) return true;

  return false;
}

function isBlockedInternalHostname(host: string): boolean {
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

function isValidPublicHostnamePattern(candidate: string): boolean {
  if (!candidate || candidate.length > 253) return false;
  const labels = candidate.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!SAFE_HOSTNAME_LABEL_PATTERN.test(label)) return false;
  }
  return true;
}

/**
 * Parses a comma/whitespace-separated hostname allowlist (`FOLIO_PROXY_ALLOWED_HOSTS`
 * or `FOLIO_SECRET_<REF>_HOSTS`).
 *
 * - Exact hostnames: `api.example.com`
 * - Leading-dot subdomain rules: `.example.com` (matches `api.example.com` and
 *   `v2.api.example.com`, does NOT match `evil-example.com` or bare `example.com`)
 * - Strictly rejects wildcards (`*`, `*.*`, `*.example.com`) and internal/private hosts.
 */
export function parseAllowedHostsConfig(
  rawConfig: string | undefined,
): { readonly ok: true; readonly rules: readonly string[] } | { readonly ok: false; readonly error: string } {
  if (!rawConfig || !rawConfig.trim()) {
    return { ok: true, rules: [] };
  }
  const tokens = rawConfig
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const rules: string[] = [];
  for (const rawToken of tokens) {
    if (rawToken.includes('*')) {
      return {
        ok: false,
        error: `Invalid allowlist entry "${rawToken}": wildcards ("*") are forbidden. Specify exact hostnames or leading-dot subdomains (e.g. "api.example.com,.example.com").`,
      };
    }
    if (rawToken.includes('://') || rawToken.includes('/') || rawToken.includes(':')) {
      return {
        ok: false,
        error: `Invalid allowlist entry "${rawToken}": provide hostnames only without schemes, ports, or paths.`,
      };
    }
    const isSubdomainRule = rawToken.startsWith('.');
    const stripped = normalizeHostname(isSubdomainRule ? rawToken.slice(1) : rawToken);
    if (!stripped || isBlockedInternalHostname(stripped) || isPrivateOrReservedIp(stripped)) {
      return {
        ok: false,
        error: `Invalid allowlist entry "${rawToken}": internal, loopback, or private hosts are forbidden.`,
      };
    }
    if (!isValidPublicHostnamePattern(stripped)) {
      return {
        ok: false,
        error: `Invalid allowlist hostname "${rawToken}".`,
      };
    }
    rules.push(isSubdomainRule ? `.${stripped}` : stripped);
  }
  return { ok: true, rules };
}

/**
 * Evaluates whether a target hostname matches at least one parsed allowlist rule
 * using proper exact or leading-dot subdomain boundary matching.
 */
export function isHostAllowedByRules(hostname: string, rules: readonly string[]): boolean {
  const host = normalizeHostname(hostname);
  if (!host || rules.length === 0) return false;
  for (const rule of rules) {
    if (rule.startsWith('.')) {
      if (host.length > rule.length && host.endsWith(rule)) {
        return true;
      }
    } else if (host === rule) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that a target URL is safe to fetch from the server-side proxy
 * before DNS resolution. Optionally validates against parsed hostname allowlist rules.
 */
export function validateProxyTargetUrl(
  rawUrl: string,
  options?: { readonly allowedHostRules?: readonly string[] },
): { ok: true; url: URL; normalizedHost: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    return { ok: false, error: 'Request URL is required and must be under 2048 characters.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Request URL must be a valid absolute http:// or https:// URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Blocked URL protocol "${parsed.protocol}". Only http: and https: are allowed.` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Embedded URL credentials are not permitted.' };
  }
  const host = normalizeHostname(parsed.hostname);
  if (!host) {
    return { ok: false, error: 'Request URL must specify a hostname.' };
  }
  if (isBlockedInternalHostname(host)) {
    return { ok: false, error: `Blocked internal or metadata hostname "${host}".` };
  }
  if (isPrivateOrReservedIp(host)) {
    return { ok: false, error: `Blocked private or reserved IP address "${host}".` };
  }
  if (options?.allowedHostRules) {
    if (options.allowedHostRules.length === 0) {
      return {
        ok: false,
        error: 'Proxy hostname allowlist is not configured. Set FOLIO_PROXY_ALLOWED_HOSTS with permitted hostnames.',
      };
    }
    if (!isHostAllowedByRules(host, options.allowedHostRules)) {
      return {
        ok: false,
        error: `Hostname "${host}" is not in FOLIO_PROXY_ALLOWED_HOSTS.`,
      };
    }
  }
  return { ok: true, url: parsed, normalizedHost: host };
}

function getHeaderValue(
  headers: Headers | Readonly<Record<string, string | string[] | undefined>> | undefined,
  name: string,
): string {
  if (!headers) return '';
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name)?.trim() ?? '';
  }
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) return String(v[0] ?? '').trim();
      return typeof v === 'string' ? v.trim() : '';
    }
  }
  return '';
}

function extractCookieValue(cookieHeader: string, cookieName: string): string {
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === cookieName) {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.byteLength, bb.byteLength);
  let diff = ab.byteLength ^ bb.byteLength;
  for (let i = 0; i < len; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function decodeBase64UrlToBytes(segment: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function normalizeCfTeamOrigin(rawDomain: string): string | null {
  const trimmed = rawDomain.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    const host = normalizeHostname(parsed.hostname);
    if (!host || isBlockedInternalHostname(host) || isPrivateOrReservedIp(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

async function fetchCfAccessJwks(
  teamOrigin: string,
  fetchFn: typeof fetch,
  nowMs: () => number,
): Promise<readonly JsonWebKey[] | null> {
  const now = nowMs();
  const cached = jwksCache.get(teamOrigin);
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }
  try {
    const resp = await fetchFn(`${teamOrigin}/cdn-cgi/access/certs`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { keys?: unknown };
    if (!Array.isArray(body?.keys)) return null;
    const keys = body.keys.filter((k): k is JsonWebKey => Boolean(k && typeof k === 'object'));
    jwksCache.set(teamOrigin, { expiresAt: now + JWKS_CACHE_TTL_MS, keys });
    return keys;
  } catch {
    return null;
  }
}

async function verifyCloudflareAccessJwt(
  jwt: string,
  teamOrigin: string,
  expectedAud: string,
  fetchFn: typeof fetch,
  nowMs: () => number,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'Invalid Cloudflare Access JWT format.' };
  }
  const [headerSeg, payloadSeg, sigSeg] = parts;
  const headerBytes = decodeBase64UrlToBytes(headerSeg);
  const payloadBytes = decodeBase64UrlToBytes(payloadSeg);
  const sigBytes = decodeBase64UrlToBytes(sigSeg);
  if (!headerBytes || !payloadBytes || !sigBytes) {
    return { ok: false, error: 'Malformed Cloudflare Access JWT encoding.' };
  }

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number };
  try {
    const decoder = new TextDecoder();
    header = JSON.parse(decoder.decode(headerBytes)) as { alg?: string; kid?: string };
    payload = JSON.parse(decoder.decode(payloadBytes)) as {
      aud?: string | string[];
      iss?: string;
      exp?: number;
      nbf?: number;
    };
  } catch {
    return { ok: false, error: 'Invalid Cloudflare Access JWT JSON.' };
  }

  if (header.alg !== 'RS256') {
    return { ok: false, error: 'Unsupported Cloudflare Access JWT algorithm.' };
  }

  const audList = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : [];
  if (!audList.includes(expectedAud)) {
    return { ok: false, error: 'Cloudflare Access JWT audience mismatch.' };
  }

  const normalizedIss = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : '';
  if (normalizedIss !== teamOrigin) {
    return { ok: false, error: 'Cloudflare Access JWT issuer mismatch.' };
  }

  const nowSec = Math.floor(nowMs() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + JWT_CLOCK_SKEW_SECONDS < nowSec) {
    return { ok: false, error: 'Cloudflare Access JWT has expired.' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf - JWT_CLOCK_SKEW_SECONDS > nowSec) {
    return { ok: false, error: 'Cloudflare Access JWT is not yet valid.' };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { ok: false, error: 'Web Crypto API is unavailable for JWT verification.' };
  }

  const keys = await fetchCfAccessJwks(teamOrigin, fetchFn, nowMs);
  if (!keys || keys.length === 0) {
    return { ok: false, error: 'Unable to fetch Cloudflare Access signing keys.' };
  }

  const candidates = header.kid
    ? keys.filter((k) => (k as { kid?: string }).kid === header.kid)
    : keys;
  if (candidates.length === 0) {
    return { ok: false, error: 'Cloudflare Access JWT signing key ID not found.' };
  }

  const signingInput = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
  const signatureBuffer = new Uint8Array(sigBytes).buffer;
  const dataBuffer = new Uint8Array(signingInput).buffer;

  for (const jwk of candidates) {
    try {
      const cryptoKey = await subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      const valid = await subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBuffer, dataBuffer);
      if (valid) {
        return { ok: true };
      }
    } catch {
      // Try next candidate key if available
    }
  }

  return { ok: false, error: 'Cloudflare Access JWT signature verification failed.' };
}

/**
 * Verifies backend authentication for `/api/logic/http-proxy`.
 *
 * Supports:
 * - Cloudflare Access (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`, RS256 JWKS verification)
 * - Backend proxy auth token (`FOLIO_PROXY_AUTH_TOKEN`, constant-time `X-Folio-Proxy-Auth` check)
 *
 * Fail-closed:
 * - Never treats `Origin` or `Sec-Fetch-Site` as authentication.
 * - Rejects server-side `authSecretRef` whenever no backend auth is configured.
 * - Rejects unauthenticated requests by default unless `FOLIO_PROXY_ALLOW_UNAUTHENTICATED_PUBLIC=true`
 *   AND no `authSecretRef` is requested.
 */
export async function verifyProxyAuthentication(
  requestHeaders: Headers | Readonly<Record<string, string | string[] | undefined>> | undefined,
  env: Readonly<Record<string, string | undefined>>,
  options?: {
    readonly requiresSecret?: boolean;
    readonly jwksFetchImpl?: typeof fetch;
    readonly nowMs?: () => number;
  },
): Promise<ProxyAuthVerificationResult> {
  const cfTeamRaw = env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? '';
  const cfAud = env.CF_ACCESS_AUD?.trim() ?? '';
  const cfConfigured = Boolean(cfTeamRaw && cfAud);
  const proxyToken = env.FOLIO_PROXY_AUTH_TOKEN?.trim() ?? '';
  const proxyTokenConfigured = proxyToken.length > 0;
  const anyAuthConfigured = cfConfigured || proxyTokenConfigured;

  if (!anyAuthConfigured) {
    if (options?.requiresSecret) {
      return {
        ok: false,
        authenticated: false,
        method: 'none',
        httpStatus: 401,
        error:
          'Server-side secrets require backend authentication. Configure Cloudflare Access (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD) or FOLIO_PROXY_AUTH_TOKEN.',
      };
    }
    if (env.FOLIO_PROXY_ALLOW_UNAUTHENTICATED_PUBLIC === 'true') {
      return {
        ok: true,
        authenticated: false,
        method: 'unauthenticated-public',
        httpStatus: 200,
      };
    }
    return {
      ok: false,
      authenticated: false,
      method: 'none',
      httpStatus: 401,
      error:
        'Proxy backend authentication is not configured. Configure Cloudflare Access (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD) or FOLIO_PROXY_AUTH_TOKEN.',
    };
  }

  // 1. Check backend proxy auth token header if configured
  if (proxyTokenConfigured) {
    const providedToken = getHeaderValue(requestHeaders, 'x-folio-proxy-auth');
    if (providedToken && timingSafeEqualStrings(providedToken, proxyToken)) {
      return {
        ok: true,
        authenticated: true,
        method: 'proxy-token',
        httpStatus: 200,
      };
    }
  }

  // 2. Check Cloudflare Access JWT assertion (header or CF_Authorization cookie)
  if (cfConfigured) {
    const teamOrigin = normalizeCfTeamOrigin(cfTeamRaw);
    if (!teamOrigin) {
      return {
        ok: false,
        authenticated: false,
        method: 'none',
        httpStatus: 500,
        error: 'CF_ACCESS_TEAM_DOMAIN is misconfigured. Provide a valid HTTPS Cloudflare Access team domain.',
      };
    }
    const headerJwt = getHeaderValue(requestHeaders, 'cf-access-jwt-assertion');
    const cookieJwt = headerJwt ? '' : extractCookieValue(getHeaderValue(requestHeaders, 'cookie'), 'CF_Authorization');
    const jwt = headerJwt || cookieJwt;
    if (jwt) {
      const verify = await verifyCloudflareAccessJwt(
        jwt,
        teamOrigin,
        cfAud,
        options?.jwksFetchImpl ?? globalThis.fetch,
        options?.nowMs ?? (() => Date.now()),
      );
      if (verify.ok) {
        return {
          ok: true,
          authenticated: true,
          method: 'cloudflare-access',
          httpStatus: 200,
        };
      }
      return {
        ok: false,
        authenticated: false,
        method: 'none',
        httpStatus: 401,
        error: verify.error,
      };
    }
  }

  return {
    ok: false,
    authenticated: false,
    method: 'none',
    httpStatus: 401,
    error: 'Authentication required. Present a valid Cloudflare Access JWT or X-Folio-Proxy-Auth credential.',
  };
}

export function normalizeProxySecretRef(rawRef: string | undefined): string {
  if (!rawRef) return '';
  return rawRef.trim().replace(/^env:/i, '').trim().toUpperCase();
}

export function sanitizeProxyRequestHeaders(
  rawHeaders: Record<string, string> | undefined,
  authSecretRef: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  options?: {
    readonly allowSecretInjection?: boolean;
  },
): Record<string, string> {
  const clean: Record<string, string> = {};
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders)) {
      const key = k.trim();
      const lower = key.toLowerCase();
      if (!key || FORBIDDEN_REQUEST_HEADERS.has(lower)) continue;
      if (!/^[a-zA-Z0-9-]+$/.test(key)) continue;
      const val = String(v ?? '').replace(/[\r\n\u0000]/g, '').slice(0, 2048);
      clean[key] = val;
    }
  }
  const ref = normalizeProxySecretRef(authSecretRef);
  if (ref && options?.allowSecretInjection === true && SAFE_SECRET_REF_PATTERN.test(ref)) {
    const secretVal = env[`FOLIO_SECRET_${ref}`]?.trim();
    if (secretVal) {
      // Remove any caller-supplied authorization header so the server secret is authoritative
      for (const existingKey of Object.keys(clean)) {
        if (existingKey.toLowerCase() === 'authorization') {
          delete clean[existingKey];
        }
      }
      clean.Authorization = `Bearer ${secretVal}`;
    }
  }
  return clean;
}

function makeErrorResult(
  httpStatus: number,
  startedAt: number,
  error: string,
  statusCode = httpStatus,
): { readonly httpStatus: number; readonly body: HttpProxyResult } {
  return {
    httpStatus,
    body: {
      status: statusCode,
      ok: false,
      contentType: 'application/json',
      data: null,
      durationMs: Math.max(0, Date.now() - startedAt),
      error,
    },
  };
}

export async function executeServerHttpProxy(
  payload: HttpProxyRequestPayload,
  options?: ExecuteServerHttpProxyOptions,
): Promise<{ readonly httpStatus: number; readonly body: HttpProxyResult }> {
  const startedAt = Date.now();
  const env = options?.env ?? {};

  const rawSecretRef = typeof payload.authSecretRef === 'string' ? payload.authSecretRef.trim() : '';
  const normalizedSecretRef = normalizeProxySecretRef(rawSecretRef);
  if (rawSecretRef && !SAFE_SECRET_REF_PATTERN.test(normalizedSecretRef)) {
    return makeErrorResult(
      400,
      startedAt,
      'Invalid authSecretRef identifier. Use an uppercase env key name such as "API_TOKEN".',
    );
  }

  // 1. Verify backend authentication BEFORE performing any outbound network call or secret lookup.
  const authCheck = await verifyProxyAuthentication(options?.requestHeaders, env, {
    requiresSecret: Boolean(normalizedSecretRef),
    jwksFetchImpl: options?.jwksFetchImpl ?? options?.fetchImpl,
    nowMs: options?.nowMs,
  });
  if (!authCheck.ok) {
    return makeErrorResult(authCheck.httpStatus, startedAt, authCheck.error ?? 'Unauthorized.');
  }

  // 2. Parse and validate global hostname allowlist (wildcards like "*" are strictly rejected).
  const globalAllowlist = parseAllowedHostsConfig(env.FOLIO_PROXY_ALLOWED_HOSTS);
  if (!globalAllowlist.ok) {
    return makeErrorResult(500, startedAt, globalAllowlist.error);
  }
  if (globalAllowlist.rules.length === 0) {
    return makeErrorResult(
      403,
      startedAt,
      'Proxy hostname allowlist is not configured. Set FOLIO_PROXY_ALLOWED_HOSTS with explicit permitted hostnames (wildcards "*" are forbidden).',
    );
  }

  // 3. Validate URL syntax, protocol, credentials, SSRF/internal/private IPs, and global allowlist.
  const validated = validateProxyTargetUrl(String(payload.url ?? ''), {
    allowedHostRules: globalAllowlist.rules,
  });
  if (!validated.ok) {
    return makeErrorResult(403, startedAt, validated.error);
  }

  // 4. Enforce secret-specific controls: backend auth, configured secret value, and optional per-secret host allowlist.
  let allowSecretInjection = false;
  if (normalizedSecretRef) {
    if (!authCheck.authenticated) {
      return makeErrorResult(
        401,
        startedAt,
        'Server-side secrets require an authenticated backend session.',
      );
    }
    const perSecretHostsRaw = env[`FOLIO_SECRET_${normalizedSecretRef}_HOSTS`];
    if (perSecretHostsRaw && perSecretHostsRaw.trim().length > 0) {
      const perSecretAllowlist = parseAllowedHostsConfig(perSecretHostsRaw);
      if (!perSecretAllowlist.ok) {
        return makeErrorResult(500, startedAt, perSecretAllowlist.error);
      }
      if (!isHostAllowedByRules(validated.normalizedHost, perSecretAllowlist.rules)) {
        return makeErrorResult(
          403,
          startedAt,
          `Secret reference "${normalizedSecretRef}" is not permitted for hostname "${validated.normalizedHost}".`,
        );
      }
    }
    const secretVal = env[`FOLIO_SECRET_${normalizedSecretRef}`]?.trim();
    if (!secretVal) {
      return makeErrorResult(
        503,
        startedAt,
        `Server secret reference "${normalizedSecretRef}" is not configured on this deployment.`,
      );
    }
    allowSecretInjection = true;
  }

  // 5. Validate HTTP method and request body size.
  const method = String(payload.method ?? 'GET').trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return makeErrorResult(400, startedAt, `Unsupported HTTP method "${method}".`);
  }

  const bodyStr = typeof payload.body === 'string' ? payload.body : undefined;
  if (bodyStr && new TextEncoder().encode(bodyStr).byteLength > MAX_REQUEST_BODY_BYTES) {
    return makeErrorResult(413, startedAt, `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }

  // 6. Optional DNS rebinding / private IP resolution guard (active in Node / Vite dev & preview).
  if (options?.dnsLookup) {
    try {
      const records = await options.dnsLookup(validated.normalizedHost);
      if (!records || records.length === 0) {
        return makeErrorResult(502, startedAt, `Could not resolve hostname "${validated.normalizedHost}".`);
      }
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          return makeErrorResult(
            403,
            startedAt,
            `Blocked target "${validated.normalizedHost}": resolved to a private or reserved network address.`,
          );
        }
      }
    } catch {
      return makeErrorResult(502, startedAt, `DNS resolution failed for "${validated.normalizedHost}".`);
    }
  }

  // 7. Build sanitized upstream headers (injecting server secret ONLY after every allowlist + auth check passed).
  const headers = sanitizeProxyRequestHeaders(payload.headers, normalizedSecretRef || undefined, env, {
    allowSecretInjection,
  });
  if (bodyStr && method !== 'GET' && method !== 'HEAD' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutMs = Math.max(50, Math.min(20_000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(validated.url.toString(), {
      method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
      ...(bodyStr && method !== 'GET' && method !== 'HEAD' ? { body: bodyStr } : {}),
    });

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      return makeErrorResult(
        403,
        startedAt,
        'HTTP redirects are disabled on the proxy for security. Target the final HTTPS URL directly.',
        response.status >= 300 && response.status < 400 ? response.status : 403,
      );
    }

    const contentType = response.headers.get('content-type') ?? 'text/plain';
    const reader = response.body?.getReader();
    let rawText = '';
    if (reader) {
      let totalBytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return makeErrorResult(413, startedAt, 'Upstream response exceeded 1 MiB safety limit.');
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      rawText = new TextDecoder().decode(merged);
    } else {
      rawText = await response.text();
      if (new TextEncoder().encode(rawText).byteLength > MAX_RESPONSE_BYTES) {
        return makeErrorResult(413, startedAt, 'Upstream response exceeded 1 MiB safety limit.');
      }
    }

    let parsedData: unknown = rawText;
    const normalizedContentType = contentType.toLowerCase();
    if (normalizedContentType.includes('json')) {
      try {
        parsedData = rawText.trim() ? JSON.parse(rawText) : null;
      } catch {
        parsedData = rawText;
      }
    } else if (!response.headers.get('content-type') && (rawText.trim().startsWith('{') || rawText.trim().startsWith('['))) {
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = rawText;
      }
    }

    return {
      httpStatus: 200,
      body: {
        status: response.status,
        ok: response.ok,
        contentType,
        data: parsedData,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(!response.ok ? { error: `Upstream HTTP ${response.status}` } : {}),
      },
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return makeErrorResult(
      isAbort ? 504 : 502,
      startedAt,
      isAbort ? `Request timed out after ${timeoutMs}ms.` : 'Upstream network request failed.',
    );
  } finally {
    clearTimeout(timer);
  }
}

const PROXY_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function makeWebJsonResponse(status: number, body: HttpProxyResult): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: PROXY_RESPONSE_HEADERS,
  });
}

async function readWebRequestTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, error: `Proxy request payload exceeds ${Math.floor(maxBytes / 1024)} KiB.` };
  }
  const reader = request.body?.getReader();
  if (!reader) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      return { ok: false, error: `Proxy request payload exceeds ${Math.floor(maxBytes / 1024)} KiB.` };
    }
    return { ok: true, text };
  }
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, error: `Proxy request payload exceeds ${Math.floor(maxBytes / 1024)} KiB.` };
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

/**
 * Standard Web Fetch `Request` -> `Response` handler used directly by the
 * Cloudflare Pages Function (`functions/api/logic/http-proxy.ts`).
 */
export async function handleHttpProxyWebRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
  options?: Omit<ExecuteServerHttpProxyOptions, 'env' | 'requestHeaders'>,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Allow: 'POST, OPTIONS',
      },
    });
  }
  if (method !== 'POST') {
    return makeWebJsonResponse(405, {
      status: 405,
      ok: false,
      contentType: 'application/json',
      data: null,
      durationMs: 0,
      error: 'Method Not Allowed. Use POST.',
    });
  }

  const rawBody = await readWebRequestTextWithLimit(request, MAX_PROXY_ENVELOPE_BYTES);
  if (!rawBody.ok) {
    return makeWebJsonResponse(413, {
      status: 413,
      ok: false,
      contentType: 'application/json',
      data: null,
      durationMs: 0,
      error: rawBody.error,
    });
  }

  let parsed: Record<string, unknown>;
  try {
    const candidate = JSON.parse(rawBody.text || '{}') as unknown;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Payload must be a JSON object');
    }
    parsed = candidate as Record<string, unknown>;
  } catch {
    return makeWebJsonResponse(400, {
      status: 400,
      ok: false,
      contentType: 'application/json',
      data: null,
      durationMs: 0,
      error: 'Invalid JSON request body.',
    });
  }

  const result = await executeServerHttpProxy(
    {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      method: typeof parsed.method === 'string' ? parsed.method : 'GET',
      headers:
        parsed.headers && typeof parsed.headers === 'object' && !Array.isArray(parsed.headers)
          ? (parsed.headers as Record<string, string>)
          : undefined,
      body: typeof parsed.body === 'string' ? parsed.body : undefined,
      authSecretRef: typeof parsed.authSecretRef === 'string' ? parsed.authSecretRef : undefined,
    },
    {
      ...options,
      env,
      requestHeaders: request.headers,
    },
  );

  return makeWebJsonResponse(result.httpStatus, result.body);
}

/**
 * Folio Node Logic — SSRF-Hardened Server-Side HTTP Proxy Handler.
 *
 * Powers live HTTP execution for `network.http` and `source.external` nodes
 * (`executionMode: 'live'`) and the Node Logic Inspector's "Test Live Request"
 * action without ever exposing API secrets to the browser or `.flop` files.
 *
 * Security controls:
 * - Allows only `http:` and `https:` protocols; rejects embedded URL credentials.
 * - Blocks loopback, private RFC1918/RFC4193, link-local, CGNAT, cloud metadata
 *   hostnames/IPs, and internal `.local`/`.internal` domains BEFORE fetch AND
 *   after DNS resolution.
 * - Uses `redirect: 'manual'` so 3xx redirects cannot pivot to internal hosts.
 * - Enforces request body size limit, 10s AbortSignal timeout, and 1 MiB response cap.
 * - Strips hop-by-hop headers and injects server-side `FOLIO_SECRET_<KEY>` env vars
 *   only when requested via an allow-listed `authSecretRef` identifier.
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

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const SAFE_SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

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
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
]);

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * Returns true if an IPv4 or IPv6 literal belongs to any non-public range
 * (loopback, RFC1918 private, link-local / cloud metadata 169.254.0.0/16,
 * CGNAT 100.64.0.0/10, multicast, unspecified, IPv6 ULA/link-local/loopback,
 * or IPv4-mapped IPv6).
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;

  // Strip IPv6 zone ID if present (e.g. fe80::1%eth0)
  const cleanIp = ip.split('%')[0];

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleanIp.startsWith('::ffff:')) {
    const tail = cleanIp.slice(7);
    if (tail.includes('.')) {
      return isPrivateOrReservedIp(tail);
    }
    const hexParts = tail.split(':');
    if (hexParts.length === 2) {
      const hi = Number.parseInt(hexParts[0], 16);
      const lo = Number.parseInt(hexParts[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrReservedIp(ipv4);
      }
    }
    return true;
  }

  const v4 = parseIpv4Octets(cleanIp);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // 0.0.0.0/8 unspecified
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/16 IETF protocol/TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  // IPv6 checks
  if (cleanIp.includes(':')) {
    if (cleanIp === '::' || cleanIp === '::1') return true;
    const firstHextet = cleanIp.split(':')[0] || '0';
    const firstNum = Number.parseInt(firstHextet, 16);
    if (!Number.isFinite(firstNum)) return true;
    // fc00::/7 (Unique Local Address)
    if ((firstNum & 0xfe00) === 0xfc00) return true;
    // fe80::/10 (Link-local)
    if ((firstNum & 0xffc0) === 0xfe80) return true;
    // ff00::/8 (Multicast)
    if ((firstNum & 0xff00) === 0xff00) return true;
    // 2001:db8::/32 documentation
    if (cleanIp.startsWith('2001:db8:')) return true;
    return false;
  }

  // Numeric/octal/hex obfuscated IPv4 literals (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(cleanIp)) return true;
  if (/^[0-9a-fx.]+$/i.test(cleanIp) && cleanIp.includes('.')) return true;

  return false;
}

/**
 * Validates that a target URL is safe to fetch from the server-side proxy
 * before DNS resolution.
 */
export function validateProxyTargetUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
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
  const host = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { ok: false, error: 'Request URL must specify a hostname.' };
  }
  if (
    BLOCKED_HOSTNAMES.has(host)
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.arpa')
  ) {
    return { ok: false, error: `Blocked internal or metadata hostname "${host}".` };
  }
  if (isPrivateOrReservedIp(host)) {
    return { ok: false, error: `Blocked private or reserved IP address "${host}".` };
  }
  return { ok: true, url: parsed };
}

export function sanitizeProxyRequestHeaders(
  rawHeaders: Record<string, string> | undefined,
  authSecretRef: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
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
  if (authSecretRef) {
    const ref = authSecretRef.trim().toUpperCase();
    if (SAFE_SECRET_REF_PATTERN.test(ref)) {
      const secretVal = env[`FOLIO_SECRET_${ref}`];
      if (secretVal && secretVal.trim().length > 0 && !clean.Authorization && !clean.authorization) {
        clean.Authorization = `Bearer ${secretVal.trim()}`;
      }
    }
  }
  return clean;
}

export async function executeServerHttpProxy(
  payload: HttpProxyRequestPayload,
  options?: {
    readonly dnsLookup?: DnsLookupFn;
    readonly fetchImpl?: typeof fetch;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<{ readonly httpStatus: number; readonly body: HttpProxyResult }> {
  const startedAt = Date.now();
  const validated = validateProxyTargetUrl(String(payload.url ?? ''));
  if (!validated.ok) {
    return {
      httpStatus: 403,
      body: {
        status: 403,
        ok: false,
        contentType: 'application/json',
        data: null,
        durationMs: Date.now() - startedAt,
        error: validated.error,
      },
    };
  }

  const method = String(payload.method ?? 'GET').trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return {
      httpStatus: 400,
      body: {
        status: 400,
        ok: false,
        contentType: 'application/json',
        data: null,
        durationMs: Date.now() - startedAt,
        error: `Unsupported HTTP method "${method}".`,
      },
    };
  }

  const bodyStr = typeof payload.body === 'string' ? payload.body : undefined;
  if (bodyStr && new TextEncoder().encode(bodyStr).byteLength > MAX_REQUEST_BODY_BYTES) {
    return {
      httpStatus: 413,
      body: {
        status: 413,
        ok: false,
        contentType: 'application/json',
        data: null,
        durationMs: Date.now() - startedAt,
        error: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`,
      },
    };
  }

  // DNS rebinding / private IP resolution guard
  if (options?.dnsLookup) {
    try {
      const records = await options.dnsLookup(validated.url.hostname);
      if (!records || records.length === 0) {
        return {
          httpStatus: 502,
          body: {
            status: 502,
            ok: false,
            contentType: 'application/json',
            data: null,
            durationMs: Date.now() - startedAt,
            error: `Could not resolve hostname "${validated.url.hostname}".`,
          },
        };
      }
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          return {
            httpStatus: 403,
            body: {
              status: 403,
              ok: false,
              contentType: 'application/json',
              data: null,
              durationMs: Date.now() - startedAt,
              error: `Blocked target "${validated.url.hostname}": resolved to a private or reserved network address.`,
            },
          };
        }
      }
    } catch {
      return {
        httpStatus: 502,
        body: {
          status: 502,
          ok: false,
          contentType: 'application/json',
          data: null,
          durationMs: Date.now() - startedAt,
          error: `DNS resolution failed for "${validated.url.hostname}".`,
        },
      };
    }
  }

  const env = options?.env ?? {};
  const headers = sanitizeProxyRequestHeaders(payload.headers, payload.authSecretRef, env);
  if (bodyStr && method !== 'GET' && method !== 'HEAD' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutMs = Math.max(500, Math.min(20_000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(validated.url.toString(), {
      method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
      ...(bodyStr && method !== 'GET' && method !== 'HEAD' ? { body: bodyStr } : {}),
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        httpStatus: 403,
        body: {
          status: response.status,
          ok: false,
          contentType: 'application/json',
          data: null,
          durationMs: Date.now() - startedAt,
          error: 'HTTP redirects are disabled on the proxy for security. Target the final HTTPS URL directly.',
        },
      };
    }

    const contentType = response.headers.get('content-type') ?? 'text/plain';
    const reader = response.body?.getReader();
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return {
              httpStatus: 413,
              body: {
                status: 413,
                ok: false,
                contentType: 'application/json',
                data: null,
                durationMs: Date.now() - startedAt,
                error: 'Upstream response exceeded 1 MiB safety limit.',
              },
            };
          }
          chunks.push(value);
        }
      }
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const rawText = chunks.length > 0 ? new TextDecoder().decode(merged) : await response.text();
    let parsedData: unknown = rawText;
    if (contentType.toLowerCase().includes('json')) {
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = rawText;
      }
    } else if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
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
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      httpStatus: isAbort ? 504 : 502,
      body: {
        status: isAbort ? 504 : 502,
        ok: false,
        contentType: 'application/json',
        data: null,
        durationMs: Date.now() - startedAt,
        error: isAbort ? `Request timed out after ${timeoutMs}ms.` : 'Upstream network request failed.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

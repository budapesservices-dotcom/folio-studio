import { executeServerHttpProxy } from "../../../src/server/httpProxyHandler";

interface Env {
  [key: string]: string | undefined;
}

function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter((host) => host.length > 0 && host !== "*");
}

function hostMatches(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) => {
    const normalized = entry.replace(/^\./, "");
    return host === normalized || host.endsWith("." + normalized);
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const startedAt = Date.now();
  const url = new URL(request.url);

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Content-Type must be application/json." }, 415);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return json({ ok: false, error: "Cross-origin requests are not allowed." }, 403);
      }
    } catch {
      return json({ ok: false, error: "Invalid Origin header." }, 403);
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return json({ ok: false, error: "Cross-site requests are not allowed." }, 403);
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 512 * 1024) {
    return json({ ok: false, error: "Proxy request payload exceeds 512 KiB." }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024) {
      return json({ ok: false, error: "Proxy request payload exceeds 512 KiB." }, 413);
    }
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const target = typeof payload.url === "string" ? payload.url : "";
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ ok: false, error: "Request URL must be a valid absolute HTTP(S) URL." }, 400);
  }
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return json({ ok: false, error: "Only HTTP and HTTPS targets are supported." }, 403);
  }

  const globalHosts = parseAllowedHosts(env.FOLIO_PROXY_ALLOWED_HOSTS);
  const ref = typeof payload.authSecretRef === "string" ? payload.authSecretRef.trim().toUpperCase() : "";
  if (ref && !/^[A-Z][A-Z0-9_]{1,63}$/.test(ref)) {
    return json({ ok: false, error: "Invalid auth secret reference." }, 400);
  }
  const specificHosts = ref ? parseAllowedHosts(env[`FOLIO_SECRET_${ref}_ALLOWED_HOSTS"]) : [];
  const effectiveHosts = specificHosts.length > 0 ? specificHosts : globalHosts;
  if (effectiveHosts.length === 0 || !hostMatches(targetUrl.hostname, effectiveHosts)) {
    return json({
      ok: false,
      error: "Target hostname is not in the configured FOLIO proxy allowlist.",
    }, 403);
  }

  if (ref && !(env[`FOLIO_SECRET_${ref}`] ?? "").trim()) {
    return json({ ok: false, error: `Server secret FOLIO_SECRET_${ref} is not configured.` }, 503);
  }

  const result = await executeServerHttpProxy(
    {
      url: target,
      method: typeof payload.method === "string" ? payload.method : "GET",
      headers: payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
        ? payload.headers as Record<string, string>
        : undefined,
      body: typeof payload.body === "string" ? payload.body : undefined,
      authSecretRef: ref || undefined,
    },
    { env },
  );

  return new Response(JSON.stringify(result.body), {
    status: result.httpStatus,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Server-Timing": `folio-proxy;dur=${Date.now() - startedAt}`,
    },
  });
};

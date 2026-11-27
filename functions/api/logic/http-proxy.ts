/**
 * Cloudflare Pages Function — `/api/logic/http-proxy`
 *
 * Delegates directly to Folio's runtime-agnostic proxy core
 * (`src/server/httpProxyHandler.ts`) using Web Standards APIs only
 * (Fetch, Web Crypto, AbortController, TextEncoder/TextDecoder).
 * Zero Node.js built-in module dependencies.
 */

import { handleHttpProxyWebRequest } from '../../../src/server/httpProxyHandler';

export interface CloudflarePagesFunctionContext {
  readonly request: Request;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export async function onRequestPost(context: CloudflarePagesFunctionContext): Promise<Response> {
  return handleHttpProxyWebRequest(context.request, context.env ?? {});
}

export async function onRequestOptions(context: CloudflarePagesFunctionContext): Promise<Response> {
  return handleHttpProxyWebRequest(context.request, context.env ?? {});
}

export async function onRequest(context: CloudflarePagesFunctionContext): Promise<Response> {
  return handleHttpProxyWebRequest(context.request, context.env ?? {});
}

/**
 * TEMPORARY PREVIEW DIAGNOSTIC.
 * Reports only whether required variables/session markers exist; never returns
 * secret values. Remove after the Cloudflare Preview configuration is verified.
 */
export async function onRequestGet(context: CloudflarePagesFunctionContext): Promise<Response> {
  const env = context.env ?? {};
  const headers = context.request.headers;
  const cookie = headers.get('cookie') ?? '';
  const hasAccessCookie = /(?:^|;\\s*)CF_Authorization=/.test(cookie);
  const hasAccessAssertion = Boolean(headers.get('cf-access-jwt-assertion')?.trim());

  if (!hasAccessCookie && !hasAccessAssertion) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Cloudflare Access session not detected on this request.',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        previewVariables: {
          CF_ACCESS_TEAM_DOMAIN: Boolean(env.CF_ACCESS_TEAM_DOMAIN?.trim()),
          CF_ACCESS_AUD: Boolean(env.CF_ACCESS_AUD?.trim()),
          FOLIO_PROXY_ALLOWED_HOSTS: Boolean(env.FOLIO_PROXY_ALLOWED_HOSTS?.trim()),
        },
        accessSession: {
          jwtAssertionHeader: hasAccessAssertion,
          authorizationCookie: hasAccessCookie,
        },
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

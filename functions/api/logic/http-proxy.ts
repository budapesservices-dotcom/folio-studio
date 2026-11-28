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

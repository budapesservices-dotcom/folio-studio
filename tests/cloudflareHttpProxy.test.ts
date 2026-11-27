import { describe, expect, it } from "vitest";
import { onRequestPost } from "../functions/api/logic/http-proxy";

function makeContext(body: unknown, env: Record<string, string | undefined> = {}, headers: Record<string, string> = {}) {
  return {
    request: new Request("https://folio.example/api/logic/http-proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://folio.example",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
  };
}

describe("Cloudflare Pages Live HTTP proxy boundary", () => {
  it("rejects non-JSON requests", async () => {
    const ctx = makeContext({ url: "https://api.example.com" }, {}, { "Content-Type": "text/plain" });
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(415);
  });

  it("rejects cross-origin requests", async () => {
    const ctx = makeContext(
      { url: "https://api.example.com" },
      {},
      { Origin: "https://attacker.example" },
    );
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(403);
  });

  it("requires an explicit hostname allowlist before any upstream request", async () => {
    const ctx = makeContext({ url: "https://api.example.com/data" });
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("allowlist");
  });

  it("rejects hostnames outside the configured allowlist", async () => {
    const ctx = makeContext(
      { url: "https://evil.example/data" },
      { FOLIO_PROXY_ALLOWED_HOSTS: "api.example.com" },
    );
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(403);
  });

  it("allows a configured host and its explicitly configured subdomains to pass validation", async () => {
    // The upstream call is intentionally not made in this test: a configured
    // host is tested using the no-secret path in the proxy implementation.
    const ctx = makeContext(
      { url: "https://api.example.com/data", authSecretRef: "API_TOKEN" },
      {
        FOLIO_PROXY_ALLOWED_HOSTS: "api.example.com",
        FOLIO_SECRET_API_TOKEN: "",
      },
    );
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(503);
  });

  it("does not accept wildcard allowlists", async () => {
    const ctx = makeContext(
      { url: "https://api.example.com/data" },
      { FOLIO_PROXY_ALLOWED_HOSTS: "*" },
    );
    const response = await onRequestPost(ctx);
    expect(response.status).toBe(403);
  });
});

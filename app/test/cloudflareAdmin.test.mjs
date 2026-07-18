import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { onRequest as manualEventsEndpoint } from "../functions/api/manual-macro-events.js";
import { onRequest as accessMiddleware } from "../functions/_middleware.js";
import { validateAccessRequest } from "../functions/lib/access-auth.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, "..");
const TEAM = "https://cyclelens.cloudflareaccess.com";
const AUDIENCE = "test-audience";

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function jwtFixture(overrides = {}) {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: TEAM,
    aud: [AUDIENCE],
    sub: "operator-test-subject",
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsigned));
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return {
    token: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    jwks: { keys: [{ ...publicKey, kid: "test-key", alg: "RS256", use: "sig" }] },
  };
}

test("Cloudflare Access JWT validation checks signature, issuer, audience, expiry, and hashes the actor", async () => {
  const fixture = await jwtFixture();
  const request = new Request("https://cyclelens-admin.pages.dev/", {
    headers: { "Cf-Access-Jwt-Assertion": fixture.token },
  });
  const identity = await validateAccessRequest(request, {
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUDIENCE,
  }, {
    fetchImpl: async () => new Response(JSON.stringify(fixture.jwks), { status: 200 }),
  });
  assert.match(identity.actor, /^cf-access:[a-f0-9]{24}$/);
  assert.doesNotMatch(identity.actor, /operator-test-subject/);

  await assert.rejects(validateAccessRequest(request, {
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: "wrong-audience",
  }, {
    fetchImpl: async () => new Response(JSON.stringify(fixture.jwks), { status: 200 }),
  }), { code: "access_audience_invalid" });

  const expired = await jwtFixture({ exp: Math.floor(Date.now() / 1000) - 1 });
  await assert.rejects(validateAccessRequest(new Request("https://cyclelens-admin.pages.dev/", {
    headers: { "Cf-Access-Jwt-Assertion": expired.token },
  }), {
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUDIENCE,
  }, {
    fetchImpl: async () => new Response(JSON.stringify(expired.jwks), { status: 200 }),
  }), { code: "access_token_expired" });
});

test("root middleware denies HTML before invoking the application", async () => {
  let called = false;
  const response = await accessMiddleware({
    request: new Request("https://cyclelens-admin.pages.dev/"),
    env: {},
    data: {},
    next: async () => {
      called = true;
      return new Response("private html");
    },
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

function endpointContext(request, env = {}) {
  return {
    request,
    data: { accessIdentity: { actor: "cf-access:0123456789abcdef01234567" } },
    env: {
      CYCLELENS_ADMIN_ORIGINS: "https://cyclelens-admin.pages.dev",
      CYCLELENS_ADMIN_HOST_SUFFIXES: "cyclelens-admin.pages.dev",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test-only",
      ...env,
    },
  };
}

test("Pages API rejects missing identity, cross-origin writes, and unsupported methods", async () => {
  const missingIdentity = endpointContext(new Request("https://cyclelens-admin.pages.dev/api/manual-macro-events"));
  missingIdentity.data = {};
  assert.equal((await manualEventsEndpoint(missingIdentity)).status, 401);

  const crossOrigin = endpointContext(new Request("https://cyclelens-admin.pages.dev/api/manual-macro-events", {
    method: "PUT",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ version: 1, events: [] }),
  }));
  assert.equal((await manualEventsEndpoint(crossOrigin)).status, 403);

  const unrelatedPreview = endpointContext(new Request("https://unrelated.pages.dev/api/manual-macro-events"));
  assert.equal((await manualEventsEndpoint(unrelatedPreview)).status, 403);

  const unsupported = endpointContext(new Request("https://cyclelens-admin.pages.dev/api/manual-macro-events", {
    method: "POST",
    headers: { origin: "https://cyclelens-admin.pages.dev" },
  }));
  const unsupportedResponse = await manualEventsEndpoint(unsupported);
  assert.equal(unsupportedResponse.status, 405);
  assert.equal(unsupportedResponse.headers.get("allow"), "GET, PUT");

  const oversized = endpointContext(new Request("https://cyclelens-admin.pages.dev/api/manual-macro-events", {
    method: "PUT",
    headers: { origin: "https://cyclelens-admin.pages.dev", "content-type": "application/json" },
    body: JSON.stringify({ version: 1, events: [], padding: "x".repeat(70 * 1024) }),
  }));
  assert.equal((await manualEventsEndpoint(oversized)).status, 413);
});

test("Pages API reads and writes through Supabase without exposing or forwarding local auth", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let rows = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const method = options.method || "GET";
      if (method === "GET") return new Response(JSON.stringify(rows), { status: 200 });
      if (method === "POST") {
        rows = JSON.parse(options.body).map((row, index) => ({
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ...row,
          updated_at: "2026-07-18T12:00:00Z",
        }));
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    };

    const event = {
      status: "published",
      date: "2026-07-20",
      seriesId: "MANUAL_TEST_EVENT",
      labelZh: "测试事件",
      labelEn: "Test event",
      category: "liquidity",
      role: "manual_liquidity_event",
      cadence: "event",
      unit: "event",
      source: "Official test fixture",
      sourceUrl: "https://example.com/source",
      dateMeaning: "scheduled_beijing_date",
    };
    const response = await manualEventsEndpoint(endpointContext(new Request(
      "https://cyclelens-admin.pages.dev/api/manual-macro-events",
      {
        method: "PUT",
        headers: { origin: "https://cyclelens-admin.pages.dev", "content-type": "application/json" },
        body: JSON.stringify({ version: 1, events: [event] }),
      },
    )));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.events.length, 1);
    assert.equal(payload.canonicalWriteAvailable, true);
    assert.equal(payload.publication.state, "queued_for_next_projection");
    assert.equal(rows[0].updated_by, "cf-access:0123456789abcdef01234567");
    assert.equal(calls.some(({ options }) => Object.keys(options.headers).some((name) => name.toLowerCase() === "x-cyclelens-admin")), false);
    assert.equal(calls.every(({ options }) => options.headers.apikey === "sb_secret_test-only"), true);
    assert.equal(calls.every(({ options }) => !("authorization" in options.headers)), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote admin source and Cloudflare config keep explicit security boundaries", async () => {
  const [page, model, config, wrangler] = await Promise.all([
    readFile(resolve(root, "src/pages/MacroAdminPage.jsx"), "utf8"),
    readFile(resolve(root, "src/features/admin-macro-events/adminMacroModel.js"), "utf8"),
    readFile(resolve(root, "vite.config.mjs"), "utf8"),
    readFile(resolve(root, "wrangler.jsonc"), "utf8"),
  ]);
  assert.match(model, /ADMIN_MACRO_REMOTE \? "\/api" : "http:\/\/127\.0\.0\.1:5174"/);
  assert.match(model, /ADMIN_MACRO_REMOTE \? \{\} : \{ \[PRODUCT_CONFIG\.localAdmin\.requestHeader\]: "1" \}/);
  assert.match(page, /!ADMIN_MACRO_REMOTE/);
  assert.match(config, /noindex, nofollow, noarchive/);
  const parsed = JSON.parse(wrangler);
  assert.equal(parsed.compatibility_date, "2026-07-18");
  assert.deepEqual(parsed.compatibility_flags, ["nodejs_compat"]);
  assert.equal(parsed.observability.enabled, true);
  assert.equal(parsed.send_metrics, false);
});

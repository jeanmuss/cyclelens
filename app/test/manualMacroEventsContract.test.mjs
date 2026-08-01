import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_MACRO_EVENTS_MAX_COUNT,
  normalizeManualMacroEventsPayload,
} from "../scripts/manual-macro-events-contract.mjs";
import { readManualEventsPayloadFromSupabase } from "../scripts/manual-macro-events-store.mjs";

function event(overrides = {}) {
  return {
    status: "published",
    date: "2026-07-20",
    seriesId: "MANUAL_TEST_EVENT",
    labelEn: "Test event",
    category: "liquidity",
    source: "Official fixture",
    ...overrides,
  };
}

test("manual macro-event contract normalizes safe fields and server timestamp", () => {
  const payload = normalizeManualMacroEventsPayload({
    version: 99,
    events: [event({ actual: "1.5", sourceUrl: "https://example.com/source" })],
  }, new Date("2026-07-18T12:34:56.789Z"));
  assert.equal(payload.version, 1);
  assert.equal(payload.updatedAt, "2026-07-18T12:34:56Z");
  assert.equal(payload.events[0].actual, 1.5);
  assert.equal(payload.events[0].sourceUrl, "https://example.com/source");
});

test("manual macro-event contract rejects impossible dates, duplicate keys, and non-HTTP URLs", () => {
  assert.throws(() => normalizeManualMacroEventsPayload({ events: [event({ date: "2026-02-30" })] }), /real YYYY-MM-DD/);
  assert.throws(() => normalizeManualMacroEventsPayload({ events: [event(), event()] }), /duplicate manual event key/);
  assert.throws(() => normalizeManualMacroEventsPayload({ events: [event({ sourceUrl: "file:///private/data" })] }), /HTTP\(S\)/);
  assert.throws(
    () => normalizeManualMacroEventsPayload({ events: [event({ sourceUrl: "https://user:pass@example.com/source" })] }),
    /must not contain credentials/,
  );
});

test("manual macro-event contract strips source URL query strings and fragments", () => {
  const payload = normalizeManualMacroEventsPayload({
    events: [event({ sourceUrl: "https://example.com/source?api_key=secret#private" })],
  });
  assert.equal(payload.events[0].sourceUrl, "https://example.com/source");
});

test("manual macro-event contract enforces the event-count ceiling", () => {
  const events = Array.from({ length: MANUAL_MACRO_EVENTS_MAX_COUNT + 1 }, (_, index) => event({
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    seriesId: `MANUAL_TEST_${String(index).padStart(4, "0")}`,
  }));
  assert.throws(() => normalizeManualMacroEventsPayload({ events }), /too many manual events/);
});

test("Supabase manual-event transport rejects redirects, unsafe origins, and oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  try {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test-only";
    let observedOptions = null;
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        "https://project.supabase.co/rest/v1/manual_macro_events?select=*&order=event_date.asc,category.asc,series_id.asc&limit=301",
      );
      observedOptions = options;
      return new Response("[]", {
        status: 200,
        headers: { "content-length": "2", "content-type": "application/json" },
      });
    };
    const payload = await readManualEventsPayloadFromSupabase();
    assert.deepEqual(payload.events, []);
    assert.equal(observedOptions.redirect, "error");
    assert.ok(observedOptions.signal instanceof AbortSignal);

    globalThis.fetch = async () => new Response("[]", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    });
    await assert.rejects(readManualEventsPayloadFromSupabase(), /byte limit/);

    process.env.SUPABASE_URL = "https://user:password@project.supabase.co";
    let unsafeOriginFetched = false;
    globalThis.fetch = async () => {
      unsafeOriginFetched = true;
      return new Response("[]");
    };
    await assert.rejects(readManualEventsPayloadFromSupabase(), /absolute HTTPS origin/);
    assert.equal(unsafeOriginFetched, false);

    process.env.SUPABASE_URL = "https://project.supabase.co.evil.example";
    await assert.rejects(readManualEventsPayloadFromSupabase(), /absolute HTTPS origin/);
    assert.equal(unsafeOriginFetched, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey == null) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});

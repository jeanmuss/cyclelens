import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_MACRO_EVENTS_MAX_COUNT,
  normalizeManualMacroEventsPayload,
} from "../scripts/manual-macro-events-contract.mjs";

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
});

test("manual macro-event contract enforces the event-count ceiling", () => {
  const events = Array.from({ length: MANUAL_MACRO_EVENTS_MAX_COUNT + 1 }, (_, index) => event({
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    seriesId: `MANUAL_TEST_${String(index).padStart(4, "0")}`,
  }));
  assert.throws(() => normalizeManualMacroEventsPayload({ events }), /too many manual events/);
});

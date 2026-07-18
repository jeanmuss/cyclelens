import assert from "node:assert/strict";
import test from "node:test";

import {
  initialLiveData,
  manifestFreshness,
  manifestTimestamp,
  manifestVersion,
  normalizePollInterval,
  versionedDataUrl,
} from "../src/liveDataPolicy.js";

test("live-data state starts with one null slot per dataset", () => {
  assert.deepEqual(initialLiveData([{ id: "required" }, { id: "optional" }]), {
    required: null,
    optional: null,
  });
});

test("poll intervals stay inside the client safety bounds", () => {
  assert.equal(normalizePollInterval(1), 30_000);
  assert.equal(normalizePollInterval(60_000), 60_000);
  assert.equal(normalizePollInterval(9_000_000), 3_600_000);
  assert.equal(normalizePollInterval("invalid", 120_000), 120_000);
});

test("dataset request URLs add encoded versions without dropping query strings", () => {
  assert.equal(versionedDataUrl("/data/sample.json", "a b"), "/data/sample.json?v=a%20b");
  assert.equal(versionedDataUrl("/data/sample.json?mode=compact", "abc"), "/data/sample.json?mode=compact&v=abc");
  assert.equal(versionedDataUrl("/data/sample.json"), "/data/sample.json");
});

test("manifest versions accept only sha256 hex values", () => {
  const version = "a".repeat(64);
  assert.equal(manifestVersion(version), version);
  assert.equal(manifestVersion(version.toUpperCase()), version.toUpperCase());
  assert.equal(manifestVersion("a".repeat(63)), null);
  assert.equal(manifestVersion("z".repeat(64)), null);
});

test("manifest freshness keeps lifecycle timestamps distinct and rejects invalid values", () => {
  const clientCheckedAt = "2026-07-18T08:00:00.000Z";
  assert.equal(manifestTimestamp("2026-07-18T07:00:00.000Z"), "2026-07-18T07:00:00.000Z");
  assert.equal(manifestTimestamp("not-a-date"), null);
  assert.deepEqual(manifestFreshness({
    observedAt: "2026-07-18T01:00:00.000Z",
    fetchedAt: "invalid",
    transformedAt: "2026-07-18T02:00:00.000Z",
    deployedAt: "2026-07-18T03:00:00.000Z",
    timestampFallback: "legacy-generatedAt",
  }, clientCheckedAt), {
    observedAt: "2026-07-18T01:00:00.000Z",
    fetchedAt: null,
    transformedAt: "2026-07-18T02:00:00.000Z",
    deployedAt: "2026-07-18T03:00:00.000Z",
    clientCheckedAt,
    timestampFallback: "legacy-generatedAt",
  });
});

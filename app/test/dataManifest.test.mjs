import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DATA_MANIFEST_DATASETS,
  createDataManifest,
  describeDatasetSource,
  inferObservedAt,
} from "../scripts/data-manifest-contract.mjs";

test("manifest dataset identifiers, files, and polling policies are unique", () => {
  const ids = DATA_MANIFEST_DATASETS.map((item) => item.id);
  const files = DATA_MANIFEST_DATASETS.map((item) => item.file);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(files).size, files.length);
  assert.ok(DATA_MANIFEST_DATASETS.every((item) => item.pollIntervalMs >= 30_000));
});

test("dataset descriptions hash exact bytes and preserve lifecycle timestamps", () => {
  const definition = { id: "equityFast", file: "equity-fast.json", pollIntervalMs: 60_000 };
  const source = Buffer.from(JSON.stringify({
    timestamps: {
      observedAt: "2026-07-18T01:00:00.000Z",
      fetchedAt: "2026-07-18T02:00:00.000Z",
      transformedAt: "2026-07-18T03:00:00.000Z",
    },
  }));
  const [id, entry] = describeDatasetSource(definition, source);

  assert.equal(id, definition.id);
  assert.equal(entry.path, "data/equity-fast.json");
  assert.equal(entry.version, createHash("sha256").update(source).digest("hex"));
  assert.equal(entry.sizeBytes, source.byteLength);
  assert.equal(entry.observedAt, "2026-07-18T01:00:00.000Z");
  assert.equal(entry.fetchedAt, "2026-07-18T02:00:00.000Z");
  assert.equal(entry.transformedAt, "2026-07-18T03:00:00.000Z");
  assert.equal(entry.timestampFallback, null);
});

test("legacy datasets infer observations without relabeling generatedAt", () => {
  const payload = {
    generatedAt: "2026-07-18T04:00:00.000Z",
    metrics: [
      { asOf: "2026-07-17T00:00:00.000Z" },
      { asOf: "2026-07-18T01:00:00.000Z" },
    ],
  };
  const source = Buffer.from(JSON.stringify(payload));
  const [, entry] = describeDatasetSource(
    { id: "equityFast", file: "equity-fast.json", pollIntervalMs: 60_000 },
    source,
  );

  assert.equal(inferObservedAt("equityFast", payload), "2026-07-18T01:00:00.000Z");
  assert.equal(entry.observedAt, "2026-07-18T01:00:00.000Z");
  assert.equal(entry.fetchedAt, payload.generatedAt);
  assert.equal(entry.transformedAt, payload.generatedAt);
  assert.equal(entry.timestampFallback, "legacy-generatedAt");
});

test("public projections preserve their explicit lifecycle without a legacy warning", () => {
  const payload = {
    generatedAt: "2026-07-18T04:00:00.000Z",
    freshness: {
      observedAt: "2026-07-18T01:00:00.000Z",
      firstFetchedAt: "2026-07-18T02:00:00.000Z",
      lastCheckedAt: "2026-07-18T02:30:00.000Z",
      transformedAt: "2026-07-18T03:00:00.000Z",
    },
    metrics: [],
  };
  const [, entry] = describeDatasetSource(
    { id: "dashboardProjection", file: "projections/dashboard.json", pollIntervalMs: 300_000 },
    Buffer.from(JSON.stringify(payload)),
  );

  assert.equal(entry.observedAt, payload.freshness.observedAt);
  assert.equal(entry.fetchedAt, payload.freshness.firstFetchedAt);
  assert.equal(entry.transformedAt, payload.freshness.transformedAt);
  assert.equal(entry.timestampFallback, null);
});

test("manifest deployment time is applied without collapsing source freshness", () => {
  const deployedAt = "2026-07-18T08:00:00.000Z";
  const entry = {
    path: "data/example.json",
    version: "a".repeat(64),
    observedAt: "2026-07-18T01:00:00.000Z",
    fetchedAt: "2026-07-18T02:00:00.000Z",
    transformedAt: "2026-07-18T03:00:00.000Z",
  };
  const manifest = createDataManifest([["example", entry]], deployedAt);

  assert.equal(manifest.version, 2);
  assert.equal(manifest.generatedAt, deployedAt);
  assert.equal(manifest.deployedAt, deployedAt);
  assert.equal(manifest.datasets.example.deployedAt, deployedAt);
  assert.equal(manifest.datasets.example.observedAt, entry.observedAt);
});

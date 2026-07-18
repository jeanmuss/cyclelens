import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  METRIC_CATALOG,
  validateMetricCatalog,
} from "../src/domain/metrics/metricCatalog.js";
import {
  SOURCE_POLICIES,
  validateSourcePolicies,
} from "../src/domain/metrics/sourcePolicy.js";
import {
  defineMetricAdapter,
  METRIC_ADAPTER_STAGES,
  runMetricAdapter,
  SOURCE_TRANSPORT_ADAPTERS,
} from "../scripts/metric-adapter-contract.mjs";
import { validateObservationRows } from "../scripts/metric-observation-contract.mjs";
import {
  createPublicProjection,
  validatePublicProjection,
} from "../scripts/metric-projection-contract.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(directory, "..");
const workspaceRoot = resolve(appRoot, "..");

function observation(overrides = {}) {
  return {
    metric_id: "crypto.totalMarketCap",
    observed_at: "2026-07-18T00:00:00Z",
    value: 3_000_000_000_000,
    unit: "USD",
    cadence: "daily",
    source: "cmc",
    source_url: "https://coinmarketcap.com/api/documentation/",
    source_key: "cmc",
    quality_status: "available",
    fetched_at: "2026-07-18T01:00:00Z",
    last_checked_at: "2026-07-18T02:00:00Z",
    dimensions: {},
    metadata: { internalNote: "must not be projected" },
    ...overrides,
  };
}

test("metric and source catalogs are complete, unique, and mutually referenced", () => {
  assert.deepEqual(validateMetricCatalog(), []);
  assert.deepEqual(validateSourcePolicies(), []);
  const sourceIds = new Set(SOURCE_POLICIES.map((item) => item.id));
  assert.equal(new Set(METRIC_CATALOG.map((item) => item.metricId)).size, METRIC_CATALOG.length);
  assert.ok(METRIC_CATALOG.every((item) => item.sourcePolicyIds.every((id) => sourceIds.has(id))));
  const transports = new Set(SOURCE_TRANSPORT_ADAPTERS.map((item) => item.transport));
  assert.ok(SOURCE_POLICIES.every((item) => transports.has(item.transport)));
  assert.ok(SOURCE_TRANSPORT_ADAPTERS.every((item) => METRIC_ADAPTER_STAGES.every((stage) => typeof item[stage] === "function")));
});

test("adapter runner executes the five stages in order and stops before mutation on fetch failure", async () => {
  const stages = [];
  const adapter = defineMetricAdapter({
    id: "test",
    ...Object.fromEntries(METRIC_ADAPTER_STAGES.map((stage) => [stage, async (value) => {
      stages.push(stage);
      return value || { seed: true };
    }])),
  });
  await runMetricAdapter(adapter);
  assert.deepEqual(stages, METRIC_ADAPTER_STAGES);

  const failedStages = [];
  const failing = defineMetricAdapter({
    id: "failing",
    async fetch() { failedStages.push("fetch"); throw new Error("upstream unavailable"); },
    async normalize() { failedStages.push("normalize"); },
    async validate() { failedStages.push("validate"); },
    async persist() { failedStages.push("persist"); },
    async project() { failedStages.push("project"); },
  });
  await assert.rejects(runMetricAdapter(failing), /upstream unavailable/);
  assert.deepEqual(failedStages, ["fetch"], "an upstream failure must leave persisted and projected LKG untouched");
});

test("reviewed source policy defaults CMC on after operator approval and permits an explicit suspension", () => {
  const approvedByDefault = validateObservationRows([observation()], { environment: {} });
  assert.equal(approvedByDefault.accepted.length, 1);
  assert.equal(approvedByDefault.accepted[0].source_policy_id, "coinmarketcap");

  const blocked = validateObservationRows([observation()], { environment: { CMC_REDISTRIBUTION_APPROVED: "0" } });
  assert.equal(blocked.accepted.length, 0);
  assert.equal(blocked.rejected[0].reason, "source_not_approved_for_production");

  const approved = validateObservationRows([observation()], { environment: { CMC_REDISTRIBUTION_APPROVED: "1" } });
  assert.equal(approved.accepted.length, 1);
  assert.equal(approved.accepted[0].source_policy_id, "coinmarketcap");
});

test("public projections are page-scoped, provenance-rich, and private-field free", () => {
  const { accepted } = validateObservationRows([observation({
    source_url: "https://coinmarketcap.com/example?api_key=never-project-this",
  })], { environment: { CMC_REDISTRIBUTION_APPROVED: "1" } });
  const projection = createPublicProjection("crypto-liquidity", accepted, "2026-07-18T03:00:00Z");
  assert.deepEqual(validatePublicProjection(projection), []);
  assert.deepEqual(projection.metrics.map((item) => item.metricId), ["crypto.totalMarketCap"]);
  assert.equal(projection.metrics[0].observations[0].sourceUrl, "https://coinmarketcap.com/example");
  assert.equal(JSON.stringify(projection).includes("internalNote"), false);
  assert.equal(JSON.stringify(projection).includes("api_key"), false);
});

test("checked-in page projections satisfy the public contract", async () => {
  for (const projectionId of ["dashboard", "crypto-liquidity", "us-equity"]) {
    const payload = JSON.parse(await readFile(resolve(appRoot, `public/data/projections/${projectionId}.json`), "utf8"));
    assert.deepEqual(validatePublicProjection(payload), []);
    assert.equal(payload.projectionId, projectionId);
  }
});

test("Phase 3 migration seeds the catalog and keeps database tables server-only", async () => {
  const migration = await readFile(resolve(workspaceRoot, "supabase/migrations/20260718203236_phase3_metric_catalog.sql"), "utf8");
  for (const entry of METRIC_CATALOG) assert.match(migration, new RegExp(`'${entry.metricId.replaceAll(".", "\\.")}'`));
  assert.match(migration, /foreign key \(metric_id\) references public\.metric_catalog\(metric_id\) not valid/);
  assert.match(migration, /greatest\(old\.last_checked_at, new\.last_checked_at\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.metric_catalog from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.dashboard_snapshot_runs from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant .* to anon/);
});

test("Strategy holdings catalog migration removes the disabled provider source", async () => {
  const migration = await readFile(resolve(workspaceRoot, "supabase/migrations/20260718221500_strategy_official_source.sql"), "utf8");
  assert.match(migration, /where metric_id = 'treasury\.mstr\.btc_holdings'/);
  assert.match(migration, /source_policy_ids = array\['strategy-disclosures'\]/);
  assert.doesNotMatch(migration, /sosovalue/i);
});

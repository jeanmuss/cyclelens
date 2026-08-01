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
  sourceIsEligibleForDataUse,
  sourcePolicyForObservation,
  validateSourcePolicies,
} from "../src/domain/metrics/sourcePolicy.js";
import {
  DATA_USE_SCOPES,
  cacheRootForScope,
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
  manualMacroEventsPathForScope,
} from "../scripts/data-use-scope.mjs";
import {
  defineMetricAdapter,
  METRIC_ADAPTER_STAGES,
  runMetricAdapter,
  SOURCE_TRANSPORT_ADAPTERS,
} from "../scripts/metric-adapter-contract.mjs";
import { createMarketHistoryAdapter } from "../scripts/market-history-adapter.mjs";
import { validateObservationRows } from "../scripts/metric-observation-contract.mjs";
import {
  createOwnerPrivateProjection,
  createPublicProjection,
  validateOwnerPrivateProjection,
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

test("public source policy defaults CMC off and requires explicit redistribution approval", () => {
  const deniedByDefault = validateObservationRows([observation()], { environment: {} });
  assert.equal(deniedByDefault.accepted.length, 0);
  assert.equal(deniedByDefault.rejected[0].reason, "source_not_approved_for_public_redistribution");

  const blocked = validateObservationRows([observation()], { environment: { CMC_REDISTRIBUTION_APPROVED: "0" } });
  assert.equal(blocked.accepted.length, 0);
  assert.equal(blocked.rejected[0].reason, "source_not_approved_for_public_redistribution");

  const approved = validateObservationRows([observation()], { environment: { CMC_REDISTRIBUTION_APPROVED: "1" } });
  assert.equal(approved.accepted.length, 1);
  assert.equal(approved.accepted[0].source_policy_id, "coinmarketcap");
});

test("data-use scope parsing supports split and equals CLI forms", () => {
  assert.equal(dataUseScopeFromEnvironment({}, ["node", "script", "--scope", "owner_private"]), DATA_USE_SCOPES.OWNER_PRIVATE);
  assert.equal(dataUseScopeFromEnvironment({}, ["node", "script", "--scope=owner_private"]), DATA_USE_SCOPES.OWNER_PRIVATE);
  assert.throws(
    () => dataUseScopeFromEnvironment({}, ["node", "script"]),
    /Data-use scope must be explicit/,
  );
  assert.throws(() => dataUseScopeFromEnvironment({}, ["node", "script", "--scope", "unknown"]), /Unsupported data-use scope/);
});

test("operator-facing collection commands cannot fall back to tracked public data", async () => {
  const packageJson = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
  for (const command of [
    "admin:macro-events",
    "refresh-cmc-provider-state",
    "update-data",
    "update-crypto-liquidity",
    "apply-reviewed-treasuries",
    "update-market-session",
    "update-market-session-calendar",
    "update-chip-chain",
    "update-robot-chain",
    "update-equity-fast-data",
    "update-equity-data",
    "sync-manual-macro-events",
    "update-macro-calendar",
    "update-chart-series",
    "persist-market-history",
  ]) {
    assert.match(packageJson.scripts[command], /--scope owner_private\b/, command);
  }
  assert.match(packageJson.scripts["project-public-data"], /--scope public\b/);

  const localAdmin = await readFile(resolve(appRoot, "scripts/macro-events-admin-api.mjs"), "utf8");
  assert.match(localAdmin, /manualMacroEventsPathForScope\(appRoot, dataUseScope\)/);
  assert.match(localAdmin, /dataDirectoryForScope\(appRoot, dataUseScope\)/);
  assert.match(localAdmin, /const host = "127\.0\.0\.1"/);
  assert.match(localAdmin, /\[updateMacroCalendarScript, "--scope", DATA_USE_SCOPES\.OWNER_PRIVATE\]/);
  assert.doesNotMatch(localAdmin, /resolve\(appRoot, "public", "data"/);
  assert.doesNotMatch(localAdmin, /process\.env\.MACRO_EVENTS_ADMIN_HOST \|\|/);

  const mergeScript = await readFile(resolve(appRoot, "scripts/merge-data-cache-snapshot.mjs"), "utf8");
  assert.match(mergeScript, /Public data-cache writes are retired/);
  const treasuryScript = await readFile(resolve(appRoot, "scripts/apply-reviewed-treasury-disclosures.mjs"), "utf8");
  assert.match(treasuryScript, /dataDirectoryForScope\(appRoot, dataUseScope\)/);
  assert.doesNotMatch(treasuryScript, /public\/data\/crypto-liquidity\.json/);
});

test("data-use scope selects fixed public and owner-private raw paths", () => {
  assert.equal(
    dataDirectoryForScope(appRoot, DATA_USE_SCOPES.PUBLIC),
    resolve(appRoot, "public", "data"),
  );
  assert.equal(
    dataDirectoryForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE),
    resolve(appRoot, "data", "private", "raw"),
  );
  assert.equal(
    manualMacroEventsPathForScope(appRoot, DATA_USE_SCOPES.PUBLIC),
    resolve(appRoot, "data", "manual-macro-events.json"),
  );
  assert.equal(
    manualMacroEventsPathForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE),
    resolve(appRoot, "data", "private", "manual-macro-events.json"),
  );
  assert.equal(
    cacheRootForScope(workspaceRoot, DATA_USE_SCOPES.PUBLIC),
    resolve(workspaceRoot, "tmp"),
  );
  assert.equal(
    cacheRootForScope(workspaceRoot, DATA_USE_SCOPES.OWNER_PRIVATE),
    resolve(workspaceRoot, "tmp", "owner-private"),
  );
});

test("owner-private scope requires the global approval and never permits unknown or blocked sources", () => {
  const ownerEnvironment = { CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1" };
  for (const policy of SOURCE_POLICIES) {
    assert.equal(
      sourceIsEligibleForDataUse(policy, {
        scope: DATA_USE_SCOPES.OWNER_PRIVATE,
        environment: ownerEnvironment,
      }),
      policy.reviewStatus !== "blocked",
      `${policy.id} owner-private eligibility must follow the reviewed/blocked boundary`,
    );
  }
  const owner = validateObservationRows([observation()], {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: ownerEnvironment,
  });
  assert.equal(owner.accepted.length, 1);
  assert.equal(owner.accepted[0].data_use_scope, DATA_USE_SCOPES.OWNER_PRIVATE);

  const denied = validateObservationRows([observation()], {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: {},
  });
  assert.equal(denied.accepted.length, 0);
  assert.equal(denied.rejected[0].reason, "source_not_approved_for_owner_private_use");

  const blocked = observation({
    metric_id: "equity.us.sox.value",
    value: 500,
    unit: "index",
    source: "yfinance daily",
    source_url: "https://finance.yahoo.com/quote/%5ESOX",
    source_key: "yfinance",
  });
  assert.equal(validateObservationRows([blocked], {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: ownerEnvironment,
  }).rejected[0].reason, "source_not_approved_for_owner_private_use");

  const unknown = observation({ source: "Unknown provider", source_url: "https://unknown.invalid/", source_key: "unknown" });
  assert.equal(validateObservationRows([unknown], {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: ownerEnvironment,
  }).rejected[0].reason, "source_not_reviewed");
  assert.equal(sourceIsEligibleForDataUse(null, {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: ownerEnvironment,
  }), false);
  assert.equal(sourcePolicyForObservation(observation({
    source: "Alpaca Market Data official IEX daily bars",
    source_url: "https://docs.alpaca.markets/reference/stockbars",
  }))?.id, "alpaca");
  assert.equal(sourcePolicyForObservation(observation({
    source: "Alpaca totally unofficial mirror",
    source_url: "https://evilalpaca.markets/bars",
  })), null);
  assert.equal(sourcePolicyForObservation(observation({
    source: "Alpaca Market Data official IEX daily bars",
    source_url: "https://evil.example/bars",
  })), null);
});

test("market-history persistence preserves owner policy checks without writing scope-only columns", async () => {
  let persistedRows = null;
  const ownerEnvironment = {
    CYCLELENS_DATA_USE_SCOPE: DATA_USE_SCOPES.OWNER_PRIVATE,
    CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1",
  };
  const adapter = createMarketHistoryAdapter({
    async upsertRows(rows) {
      persistedRows = rows;
    },
    async readCryptoHistoryRows() {
      return [observation()];
    },
  });
  const validated = await adapter.validate({
    rows: [observation()],
    environment: ownerEnvironment,
    dataUseScope: DATA_USE_SCOPES.OWNER_PRIVATE,
  });
  assert.equal(validated.rows[0].data_use_scope, DATA_USE_SCOPES.OWNER_PRIVATE);
  const persisted = await adapter.persist(validated);
  assert.equal(persistedRows.length, 1);
  assert.equal("source_policy_id" in persistedRows[0], false);
  assert.equal("data_use_scope" in persistedRows[0], false);
  assert.equal(persisted.databaseRows[0].data_use_scope, DATA_USE_SCOPES.OWNER_PRIVATE);
});

test("FRED government series remain eligible while third-party FRED series require a separate gate", () => {
  const official = observation({
    metric_id: "macro.US10Y.value",
    unit: "percent",
    source: "FRED / U.S. Treasury",
    source_url: "https://fred.stlouisfed.org/series/DGS10",
    source_key: "fred-dgs10",
  });
  const thirdParty = observation({
    metric_id: "macro.VIX.value",
    unit: "index",
    source: "FRED / CBOE",
    source_url: "https://fred.stlouisfed.org/series/VIXCLS",
    source_key: "fred-vixcls",
  });
  assert.equal(sourcePolicyForObservation(official)?.id, "fred-government");
  assert.equal(sourcePolicyForObservation(thirdParty)?.id, "fred-third-party");
  assert.equal(validateObservationRows([official], { environment: {} }).accepted.length, 1);
  assert.equal(validateObservationRows([thirdParty], { environment: {} }).accepted.length, 0);
  assert.equal(validateObservationRows([thirdParty], { environment: { FRED_THIRD_PARTY_SERIES_APPROVED: "1" } }).accepted.length, 1);
});

test("public projections are page-scoped, provenance-rich, and private-field free", () => {
  const { accepted } = validateObservationRows([observation({
    source_url: "https://coinmarketcap.com/example?api_key=never-project-this",
  })], { environment: { CMC_REDISTRIBUTION_APPROVED: "1" } });
  const projection = createPublicProjection("crypto-liquidity", accepted, "2026-07-18T03:00:00Z");
  assert.deepEqual(validatePublicProjection(projection), []);
  assert.equal(projection.dataUseScope, DATA_USE_SCOPES.PUBLIC);
  assert.equal(projection.visibility, "public");
  assert.deepEqual(projection.metrics.map((item) => item.metricId), ["crypto.totalMarketCap"]);
  assert.equal(projection.metrics[0].observations[0].sourceUrl, "https://coinmarketcap.com/example");
  assert.equal(JSON.stringify(projection).includes("internalNote"), false);
  assert.equal(JSON.stringify(projection).includes("api_key"), false);
});

test("owner-private projections retain public sanitization and explicit private visibility", () => {
  const rows = Array.from({ length: 125 }, (_, index) => observation({
    observed_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    source_url: "https://coinmarketcap.com/example?token=never-project-this",
    dimensions: { asset: "BTC", email: "never@example.com", internal: "never" },
  }));
  const { accepted } = validateObservationRows(rows, {
    scope: DATA_USE_SCOPES.OWNER_PRIVATE,
    environment: { CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1" },
  });
  const projection = createOwnerPrivateProjection("crypto-liquidity", accepted, "2026-07-18T03:00:00Z");
  assert.deepEqual(validateOwnerPrivateProjection(projection), []);
  assert.equal(projection.dataUseScope, DATA_USE_SCOPES.OWNER_PRIVATE);
  assert.equal(projection.visibility, "private");
  assert.equal(projection.metrics[0].observations.length, 120);
  assert.equal(projection.metrics[0].observations[0].sourceUrl, "https://coinmarketcap.com/example");
  assert.deepEqual(projection.metrics[0].observations[0].dimensions, { asset: "BTC" });
  assert.equal(JSON.stringify(projection).includes("internalNote"), false);
  assert.equal(JSON.stringify(projection).includes("never@example.com"), false);
  assert.equal(JSON.stringify(projection).includes("token="), false);
});

test("owner projection script reads private raw data and writes only private projections", async () => {
  const source = await readFile(resolve(appRoot, "scripts/project-public-metrics.mjs"), "utf8");
  assert.match(source, /resolve\(appRoot, "data\/private\/projections"\)/);
  assert.match(source, /dataUseScope === DATA_USE_SCOPES\.OWNER_PRIVATE/);
  assert.match(source, /dataDirectoryForScope\(appRoot, dataUseScope\)/);
  assert.doesNotMatch(source, /const dataDirectory = resolve\(appRoot, "public\/data"\)/);
});

test("owner-run data scripts route raw and manual snapshots through fixed scope helpers", async () => {
  const rawDataScripts = [
    "scripts/update-market-data.mjs",
    "scripts/update-crypto-liquidity-data.mjs",
    "scripts/update-market-session-data.mjs",
    "scripts/update-chip-chain-data.mjs",
    "scripts/update-chart-series-data.mjs",
    "scripts/persist-market-metric-history.mjs",
    "scripts/project-public-metrics.mjs",
  ];
  for (const path of rawDataScripts) {
    const source = await readFile(resolve(appRoot, path), "utf8");
    assert.match(source, /dataDirectoryForScope\(appRoot, dataUseScope\)/, `${path} must use the fixed scope directory`);
  }
  const manualSync = await readFile(resolve(appRoot, "scripts/sync-manual-macro-events-from-supabase.mjs"), "utf8");
  assert.match(manualSync, /manualMacroEventsPathForScope\(appRoot, dataUseScope\)/);

  for (const path of [
    "scripts/update-equity-fast-data.py",
    "scripts/update-equity-data.py",
    "scripts/update-macro-calendar.py",
  ]) {
    const source = await readFile(resolve(appRoot, path), "utf8");
    assert.match(source, /data_directory_for_scope\(APP_ROOT, DATA_USE_SCOPE\)/, `${path} must use the fixed scope directory`);
  }
  for (const path of [
    "scripts/update-equity-data.py",
    "scripts/update-macro-calendar.py",
  ]) {
    const source = await readFile(resolve(appRoot, path), "utf8");
    assert.match(source, /cache_root_for_scope\(WORKSPACE_ROOT, DATA_USE_SCOPE\)/, `${path} must scope provider caches`);
  }
  const macro = await readFile(resolve(appRoot, "scripts/update-macro-calendar.py"), "utf8");
  assert.match(macro, /manual_macro_events_path_for_scope\(APP_ROOT, DATA_USE_SCOPE\)/);
  assert.doesNotMatch(macro, /else:\s*\n\s+observations = read_last_known_good_cache/);
  assert.match(macro, /refresh denied by data-use scope; "\s*\n\s+"provider cache not read"/);
  const chart = await readFile(resolve(appRoot, "scripts/update-chart-series-data.mjs"), "utf8");
  assert.match(chart, /cacheRootForScope\(workspaceRoot, dataUseScope\)/);
  const persistence = await readFile(resolve(appRoot, "scripts/persist-market-metric-history.mjs"), "utf8");
  assert.match(persistence, /cacheRootForScope\(workspaceRoot, dataUseScope\)/);

  const equity = await readFile(resolve(appRoot, "scripts/update-equity-data.py"), "utf8");
  for (const [policyCheck, cacheRead] of [
    ["source_allowed = source_is_eligible(\"alpaca\"", "cached = read_price_cache(symbol)"],
    ["source_allowed = source_is_eligible(source_policy_id", "cached = read_fred_cache(series_id)"],
    ["source_allowed = source_is_eligible(\"japan-mof\"", "cached = read_mof_jgb10y_cache()"],
  ]) {
    assert.ok(
      equity.indexOf(policyCheck) >= 0 && equity.indexOf(policyCheck) < equity.indexOf(cacheRead),
      `equity policy check must precede provider cache access: ${cacheRead}`,
    );
  }
});

test("collectors enforce provider eligibility inside the collector process", async () => {
  const collectors = {
    "scripts/update-market-data.mjs": /sourcePolicyIdIsEligibleForDataUse\("public-crypto-market-apis"/,
    "scripts/update-market-session-data.mjs": /sourcePolicyIdIsEligibleForDataUse\("coinmarketcap"/,
    "scripts/update-chip-chain-data.mjs": /sourcePolicyIdIsEligibleForDataUse\("alpaca"/,
    "scripts/update-crypto-liquidity-data.mjs": /providerAllowed\("defillama"\)/,
    "scripts/update-equity-data.py": /source_is_eligible\("alpaca", scope=DATA_USE_SCOPE/,
    "scripts/update-equity-fast-data.py": /source_is_eligible\(source_policy_id, scope=data_use_scope/,
    "scripts/update-macro-calendar.py": /source_is_eligible\(source_policy_id, scope=data_use_scope/,
  };
  for (const [path, expectedGate] of Object.entries(collectors)) {
    const source = await readFile(resolve(appRoot, path), "utf8");
    assert.match(source, expectedGate, `${path} must gate providers inside the collector`);
  }
});

test("equity collector dependencies exclude blocked unofficial adapters", async () => {
  const requirements = await readFile(resolve(appRoot, "requirements-equity.txt"), "utf8");
  assert.match(requirements, /^pandas==3\.0\.3\b/m);
  assert.match(requirements, /^requests==2\.33\.1\b/m);
  assert.doesNotMatch(requirements, /\b(?:fredapi|akshare|yfinance|yahooquery)\b/i);

  const logicalLines = requirements
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .split(/\s+(?=[a-z0-9][a-z0-9-]*==)/i);
  const locked = new Map();
  for (const line of logicalLines) {
    const match = line.match(/^([a-z0-9][a-z0-9-]*)==([^\s\\]+)([\s\S]*)$/i);
    assert.ok(match, `invalid pinned requirement record: ${line}`);
    const hashes = [...match[3].matchAll(/--hash=sha256:([a-f0-9]{64})\b/g)].map((entry) => entry[1]);
    assert.ok(hashes.length >= 1, `${match[1]} must allow only reviewed SHA256 artifacts`);
    locked.set(match[1].toLowerCase(), match[2]);
  }
  assert.deepEqual(
    Object.fromEntries([...locked].sort()),
    {
      certifi: "2026.7.22",
      "charset-normalizer": "3.4.9",
      idna: "3.18",
      numpy: "2.5.1",
      pandas: "3.0.3",
      "python-dateutil": "2.9.0.post0",
      requests: "2.33.1",
      six: "1.17.0",
      urllib3: "2.7.0",
    },
  );
});

test("checked-in page projections satisfy the public contract", async () => {
  for (const projectionId of ["dashboard", "crypto-liquidity", "us-equity"]) {
    const payload = JSON.parse(await readFile(resolve(appRoot, `public/data/projections/${projectionId}.json`), "utf8"));
    assert.deepEqual(validatePublicProjection(payload), []);
    assert.equal(payload.projectionId, projectionId);
  }
});

test("catalog migrations cover every current metric and keep database tables server-only", async () => {
  const [phase3, phase9] = await Promise.all([
    readFile(resolve(workspaceRoot, "supabase/migrations/20260718203236_phase3_metric_catalog.sql"), "utf8"),
    readFile(resolve(workspaceRoot, "supabase/migrations/20260720020013_phase9_dashboard_metrics.sql"), "utf8"),
  ]);
  const catalogMigrations = `${phase3}\n${phase9}`;
  for (const entry of METRIC_CATALOG) assert.match(catalogMigrations, new RegExp(`'${entry.metricId.replaceAll(".", "\\.")}'`));
  assert.match(phase3, /foreign key \(metric_id\) references public\.metric_catalog\(metric_id\) not valid/);
  assert.match(phase3, /greatest\(old\.last_checked_at, new\.last_checked_at\)/);
  assert.match(phase3, /enable row level security/g);
  assert.match(phase3, /revoke all on table public\.metric_catalog from public, anon, authenticated/);
  assert.match(phase3, /revoke all on table public\.dashboard_snapshot_runs from public, anon, authenticated/);
  assert.doesNotMatch(catalogMigrations, /grant .* to anon/);
  assert.match(phase9, /catalog_version = 2/);
});

test("Strategy holdings catalog migration removes the disabled provider source", async () => {
  const migration = await readFile(resolve(workspaceRoot, "supabase/migrations/20260718221500_strategy_official_source.sql"), "utf8");
  assert.match(migration, /where metric_id = 'treasury\.mstr\.btc_holdings'/);
  assert.match(migration, /source_policy_ids = array\['strategy-disclosures'\]/);
  assert.doesNotMatch(migration, /sosovalue/i);
});

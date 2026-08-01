import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.CYCLELENS_DATA_USE_SCOPE ||= "owner_private";
process.env.CYCLELENS_OWNER_PRIVATE_USE_APPROVED ||= "1";

const {
  cmcCurrentIsAvailable,
  normalizeCmcProviderState,
  projectCmcMarketCap,
} = await import("../scripts/update-market-session-data.mjs");

const testDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(testDirectory, "../scripts/update-market-session-data.mjs");
const NOW = new Date("2026-07-31T12:00:00.000Z");

function asset(symbol, id, marketCapUsd) {
  return {
    id,
    symbol,
    priceUsd: symbol === "USDT" || symbol === "USDC" ? 1 : 100,
    marketCapUsd,
    percentChange24h: 1.25,
    observedAt: "2026-07-31T11:58:00.000Z",
  };
}

function providerState(overrides = {}) {
  return {
    version: 1,
    provider: "coinmarketcap",
    dataUseScope: "owner_private",
    updatedAt: "2026-07-31T11:59:00.000Z",
    current: {
      fetchedAt: "2026-07-31T11:59:00.000Z",
      global: {
        totalMarketCapUsd: 2_500_000,
        totalMarketCapYesterdayUsd: 2_400_000,
        totalMarketCapChangePct24h: 4.166,
        observedAt: "2026-07-31T11:58:00.000Z",
      },
      assets: {
        BTC: asset("BTC", 1, 1_400_000),
        ETH: asset("ETH", 1027, 500_000),
        USDT: asset("USDT", 825, 180_000),
        USDC: asset("USDC", 3408, 75_000),
        HYPE: asset("HYPE", 32196, 12_000),
        BNB: asset("BNB", 1839, 95_000),
      },
    },
    history: {},
    watermarks: {},
    budget: {},
    refresh: {
      mode: "refreshed",
      networkRequests: 2,
      creditCount: 2,
      currentRefreshed: true,
      historyRefreshed: false,
    },
    ...overrides,
  };
}

test("market-session accepts a strict current owner-private CMC provider state", () => {
  const normalized = normalizeCmcProviderState(providerState(), { now: NOW });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.fresh, true);
  assert.equal(cmcCurrentIsAvailable(normalized), true);
  assert.equal(normalized.assets.HYPE.marketCapUsd, 12_000);

  const projected = projectCmcMarketCap({ symbol: "HYPE" }, {}, normalized);
  assert.equal(projected.marketCapStatus, "available");
  assert.match(projected.marketCapSourceLabel, /normalized provider state$/);
});

test("stale provider state remains usable only as last-known-good", () => {
  const payload = providerState();
  payload.current.fetchedAt = "2026-07-31T09:00:00.000Z";
  const normalized = normalizeCmcProviderState(payload, { now: NOW });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.fresh, false);

  const projected = projectCmcMarketCap({ symbol: "BTC" }, {}, normalized);
  assert.equal(projected.marketCapUsd, 1_400_000);
  assert.equal(projected.marketCapStatus, "last-known-good");
  assert.match(projected.marketCapSourceLabel, /last-known-good/);
});

test("missing state preserves an existing value but cannot preserve an available status", () => {
  const projected = projectCmcMarketCap(
    { symbol: "BTC" },
    {
      marketCapUsd: 1_300_000,
      marketCapStatus: "available",
      marketCapAsOf: "2026-07-30T00:00:00.000Z",
      marketCapSourceLabel: "CoinMarketCap quotes/latest",
    },
    { valid: false, fresh: false, assets: {} },
  );
  assert.equal(projected.marketCapUsd, 1_300_000);
  assert.equal(projected.marketCapStatus, "last-known-good");
  assert.equal(projected.marketCapAsOf, "2026-07-30T00:00:00.000Z");
});

test("wrong identity, non-finite values, and future observations fail closed", () => {
  const wrongScope = providerState({ dataUseScope: "public" });
  const wrongScopeState = normalizeCmcProviderState(wrongScope, { now: NOW });
  assert.equal(wrongScopeState.valid, false);
  assert.equal(wrongScopeState.mode, "missing");

  const nonFinite = providerState();
  nonFinite.current.assets.BTC.marketCapUsd = "1400000";
  assert.equal(normalizeCmcProviderState(nonFinite, { now: NOW }).valid, false);

  const future = providerState();
  future.current.assets.BTC.observedAt = "2026-08-01T00:00:00.000Z";
  assert.equal(normalizeCmcProviderState(future, { now: NOW }).valid, false);
});

test("nullable quote changes remain valid and disabled or incomplete current states report missing", () => {
  const nullable = providerState();
  nullable.current.global.totalMarketCapYesterdayUsd = null;
  nullable.current.global.totalMarketCapChangePct24h = null;
  nullable.current.assets.BTC.percentChange24h = null;
  const nullableState = normalizeCmcProviderState(nullable, { now: NOW });
  assert.equal(nullableState.valid, true);
  assert.equal(nullableState.global.totalMarketCapYesterdayUsd, null);
  assert.equal(cmcCurrentIsAvailable(nullableState), true);

  const disabled = providerState();
  disabled.current = null;
  disabled.refresh.mode = "disabled";
  const disabledState = normalizeCmcProviderState(disabled, { now: NOW });
  assert.equal(disabledState.valid, false);
  assert.equal(disabledState.mode, "missing");
  assert.equal(cmcCurrentIsAvailable(disabledState), false);

  const wrongId = providerState();
  wrongId.current.assets.BTC.id = 1027;
  assert.equal(normalizeCmcProviderState(wrongId, { now: NOW }).mode, "missing");

  const unsupportedMode = providerState();
  unsupportedMode.refresh.mode = "current";
  assert.equal(normalizeCmcProviderState(unsupportedMode, { now: NOW }).mode, "missing");

  const cadence = providerState();
  cadence.refresh.mode = "cadence_guard";
  cadence.refresh.currentRefreshed = false;
  const cadenceState = normalizeCmcProviderState(cadence, { now: NOW });
  assert.equal(cadenceState.fresh, false);
  assert.equal(cmcCurrentIsAvailable(cadenceState), true);
});

test("market-session has no direct CMC credential or network path", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.equal(source.match(/CMC_PRO_API_KEY/g)?.length, 1);
  assert.match(source, /DENIED_CONSUMER_ENV_KEYS/);
  assert.match(source, /delete process\.env\[key\]/);
  assert.doesNotMatch(source, /X-CMC|pro-api\.coinmarketcap\.com|fetchCmc/i);
  assert.match(source, /provider-state[\\/]coinmarketcap\.json/);
});

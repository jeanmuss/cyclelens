import assert from "node:assert/strict";
import test from "node:test";

import {
  CMC_HISTORY_METRIC_IDS,
  CMC_PROVIDER_ASSETS,
  historyFromMarketMetricRows,
  normalizeCmcCurrentPayloads,
  normalizeCmcHistoryPayloads,
  validateCmcProviderState,
} from "../scripts/cmc-provider-state-contract.mjs";

const NOW = "2026-07-31T12:00:00.000Z";
const OBSERVED_AT = "2026-07-31T11:59:00.000Z";
const HISTORY_AT = "2026-07-30T00:00:00.000Z";

function stateFixture() {
  return {
    version: 1,
    provider: "coinmarketcap",
    dataUseScope: "owner_private",
    updatedAt: NOW,
    current: {
      fetchedAt: NOW,
      global: {
        totalMarketCapUsd: 0,
        totalMarketCapYesterdayUsd: null,
        totalMarketCapChangePct24h: -2.5,
        observedAt: OBSERVED_AT,
      },
      assets: Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => [
        symbol,
        {
          id: definition.id,
          symbol,
          priceUsd: symbol === "USDT" || symbol === "USDC" ? 0.999 : 100,
          marketCapUsd: 0,
          percentChange24h: -3.25,
          observedAt: OBSERVED_AT,
        },
      ])),
    },
    history: {},
    watermarks: {
      lastAttemptedAt: null,
      lastSuccessfulAt: null,
      lastHistoryAttemptedAt: null,
      lastHistorySuccessfulAt: null,
    },
    budget: {
      utcDay: "2026-07-31",
      utcMonth: "2026-07",
      dailyCreditBudget: 50,
      monthlyCreditBudget: 500,
      dailyCreditsReserved: 0,
      monthlyCreditsReserved: 0,
    },
    refresh: {
      mode: "refreshed",
      networkRequests: 2,
      creditCount: 2,
      currentRefreshed: true,
      historyRefreshed: false,
    },
  };
}

function currentPayloads() {
  const globalPayload = {
    status: { timestamp: OBSERVED_AT, credit_count: 1 },
    data: {
      quote: {
        USD: {
          total_market_cap: 0,
          total_market_cap_yesterday: null,
          total_market_cap_yesterday_percentage_change: -2.5,
          last_updated: OBSERVED_AT,
        },
      },
    },
  };
  const assetsPayload = {
    status: { timestamp: OBSERVED_AT, credit_count: 1 },
    data: Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => [
      String(definition.id),
      {
        id: definition.id,
        symbol,
        quote: {
          USD: {
            price: symbol === "USDT" || symbol === "USDC" ? 0.999 : 100,
            market_cap: 0,
            percent_change_24h: -3.25,
            last_updated: OBSERVED_AT,
          },
        },
      },
    ])),
  };
  return { globalPayload, assetsPayload };
}

function historyPayloads() {
  const quote = (marketCap, price = 100) => ({
    timestamp: HISTORY_AT,
    quote: {
      USD: {
        market_cap: marketCap,
        price,
        last_updated: HISTORY_AT,
      },
    },
  });
  return {
    globalPayload: {
      data: {
        quotes: [{
          timestamp: HISTORY_AT,
          quote: { USD: { total_market_cap: 0, last_updated: HISTORY_AT } },
        }],
      },
    },
    assetsPayload: {
      data: {
        1: { id: 1, quotes: [quote(0)] },
        825: { id: 825, quotes: [quote(0, 0.999)] },
        3408: { id: 3408, quotes: [quote(0, 0.999)] },
      },
    },
  };
}

function historyPoint(value) {
  return {
    date: "2026-07-30",
    value,
    observedAt: HISTORY_AT,
    source: "cmc",
    sourceKey: "cmc",
    fetchedAt: NOW,
    lastCheckedAt: NOW,
    qualityStatus: "provider_reported",
  };
}

test("canonical current state permits signed changes and zero caps but requires positive prices", () => {
  const accepted = validateCmcProviderState(stateFixture(), { now: new Date(NOW) });
  assert.equal(accepted.current.global.totalMarketCapUsd, 0);
  assert.equal(accepted.current.global.totalMarketCapYesterdayUsd, null);
  assert.equal(accepted.current.global.totalMarketCapChangePct24h, -2.5);
  assert.equal(accepted.current.assets.BTC.marketCapUsd, 0);
  assert.equal(accepted.current.assets.BTC.percentChange24h, -3.25);

  const zeroYesterday = stateFixture();
  zeroYesterday.current.global.totalMarketCapYesterdayUsd = 0;
  assert.equal(
    validateCmcProviderState(zeroYesterday, { now: new Date(NOW) }).current.global.totalMarketCapYesterdayUsd,
    0,
  );

  for (const invalidPrice of [0, -1]) {
    const candidate = stateFixture();
    candidate.current.assets.BTC.priceUsd = invalidPrice;
    assert.throws(() => validateCmcProviderState(candidate, { now: new Date(NOW) }), /cmc_state_invalid/);
  }

  for (const mutate of [
    (candidate) => { candidate.current.global.totalMarketCapUsd = -1; },
    (candidate) => { candidate.current.global.totalMarketCapYesterdayUsd = -1; },
    (candidate) => { candidate.current.assets.BTC.marketCapUsd = -1; },
  ]) {
    const candidate = stateFixture();
    mutate(candidate);
    assert.throws(() => validateCmcProviderState(candidate, { now: new Date(NOW) }), /cmc_state_invalid/);
  }
});

test("raw current payload normalization enforces the same canonical bounds", () => {
  const acceptedPayloads = currentPayloads();
  const accepted = normalizeCmcCurrentPayloads(
    acceptedPayloads.globalPayload,
    acceptedPayloads.assetsPayload,
    new Date(NOW),
  );
  assert.equal(accepted.global.totalMarketCapUsd, 0);
  assert.equal(accepted.global.totalMarketCapChangePct24h, -2.5);
  assert.equal(accepted.assets.BTC.marketCapUsd, 0);
  assert.equal(accepted.assets.BTC.percentChange24h, -3.25);

  const zeroPrice = currentPayloads();
  zeroPrice.assetsPayload.data[1].quote.USD.price = 0;
  assert.throws(
    () => normalizeCmcCurrentPayloads(zeroPrice.globalPayload, zeroPrice.assetsPayload, new Date(NOW)),
    /cmc_current_incomplete/,
  );

  const negativeGlobal = currentPayloads();
  negativeGlobal.globalPayload.data.quote.USD.total_market_cap = -1;
  assert.throws(
    () => normalizeCmcCurrentPayloads(negativeGlobal.globalPayload, negativeGlobal.assetsPayload, new Date(NOW)),
    /cmc_current_incomplete/,
  );

  const negativeYesterday = currentPayloads();
  negativeYesterday.globalPayload.data.quote.USD.total_market_cap_yesterday = -1;
  assert.throws(
    () => normalizeCmcCurrentPayloads(negativeYesterday.globalPayload, negativeYesterday.assetsPayload, new Date(NOW)),
    /cmc_current_incomplete/,
  );

  const negativeAsset = currentPayloads();
  negativeAsset.assetsPayload.data[1].quote.USD.market_cap = -1;
  assert.throws(
    () => normalizeCmcCurrentPayloads(negativeAsset.globalPayload, negativeAsset.assetsPayload, new Date(NOW)),
    /cmc_current_incomplete/,
  );
});

test("only the depeg history series may contain a negative canonical value", () => {
  const marketCapMetricIds = CMC_HISTORY_METRIC_IDS.filter(
    (metricId) => metricId !== "stablecoin.usdt.depegBps",
  );
  for (const metricId of marketCapMetricIds) {
    const candidate = stateFixture();
    candidate.history = { [metricId]: [historyPoint(-1)] };
    assert.throws(
      () => validateCmcProviderState(candidate, { now: new Date(NOW) }),
      /cmc_state_history_invalid/,
      `${metricId} must reject a negative market cap`,
    );
  }

  const signedDepeg = stateFixture();
  signedDepeg.history = { "stablecoin.usdt.depegBps": [historyPoint(-25)] };
  assert.equal(
    validateCmcProviderState(signedDepeg, { now: new Date(NOW) })
      .history["stablecoin.usdt.depegBps"][0].value,
    -25,
  );
});

test("raw history and database hydration reject negative caps while retaining signed depeg", () => {
  const acceptedPayloads = historyPayloads();
  const accepted = normalizeCmcHistoryPayloads(
    acceptedPayloads.globalPayload,
    acceptedPayloads.assetsPayload,
    new Date(NOW),
  );
  assert.ok(accepted["stablecoin.usdt.depegBps"][0].value < 0);
  assert.equal(accepted["crypto.totalMarketCap"][0].value, 0);

  const negativeGlobal = historyPayloads();
  negativeGlobal.globalPayload.data.quotes[0].quote.USD.total_market_cap = -1;
  assert.throws(
    () => normalizeCmcHistoryPayloads(negativeGlobal.globalPayload, negativeGlobal.assetsPayload, new Date(NOW)),
    /cmc_state_history_invalid/,
  );

  const negativeAsset = historyPayloads();
  negativeAsset.assetsPayload.data[1].quotes[0].quote.USD.market_cap = -1;
  assert.throws(
    () => normalizeCmcHistoryPayloads(negativeAsset.globalPayload, negativeAsset.assetsPayload, new Date(NOW)),
    /cmc_state_history_invalid/,
  );

  const zeroPrice = historyPayloads();
  zeroPrice.assetsPayload.data[825].quotes[0].quote.USD.price = 0;
  assert.throws(
    () => normalizeCmcHistoryPayloads(zeroPrice.globalPayload, zeroPrice.assetsPayload, new Date(NOW)),
    /cmc_history_invalid/,
  );

  const hydrated = historyFromMarketMetricRows([
    {
      metric_id: "btc.marketCap",
      observed_at: HISTORY_AT,
      value: -1,
      source_key: "cmc",
      fetched_at: NOW,
    },
    {
      metric_id: "stablecoin.usdt.depegBps",
      observed_at: HISTORY_AT,
      value: -25,
      source_key: "cmc",
      fetched_at: NOW,
    },
  ], new Date(NOW));
  assert.equal(hydrated["btc.marketCap"], undefined);
  assert.equal(hydrated["stablecoin.usdt.depegBps"][0].value, -25);
});

import test from "node:test";
import assert from "node:assert/strict";

import { validateOwnerDatasetRefresh } from "../scripts/owner-release-refresh-contract.mjs";

const goodFixtures = Object.freeze({
  "market-monthly.json": {
    refreshSummary: {
      requiredAssets: ["BTC", "ETH", "SOL", "HYPE", "BNB"],
      refreshedAssets: ["BNB", "BTC", "ETH", "HYPE", "SOL"],
      refreshedSpotAssets: ["BTC", "ETH", "SOL", "HYPE", "BNB"],
    },
  },
  "crypto-liquidity.json": {
    refreshSummary: {
      cmcCollectionRequested: true,
      cmcCurrentAvailable: true,
      cmcCurrentRefreshed: true,
      cmcStateMode: "refreshed",
      requiredSosoAssets: ["BTC", "ETH", "SOL"],
      sosoRefreshedAssets: ["SOL", "ETH", "BTC"],
    },
  },
  "macro-calendar.json": {
    refreshSummary: {
      requiredSeriesIds: [
        "CPIAUCSL", "PAYEMS", "UNRATE", "DFF", "DGS2", "DGS10",
        "VIXCLS", "M2SL", "WALCL", "WTREGEN", "RRPONTSYD",
      ],
      freshSeriesIds: [
        "CPIAUCSL", "PAYEMS", "UNRATE", "DFF", "DGS2", "DGS10",
        "VIXCLS", "M2SL", "WALCL", "WTREGEN", "RRPONTSYD", "ICSA",
      ],
    },
  },
  "equity-weekly.json": {
    refreshSummary: {
      requiredPriceAssets: ["QQQ", "SPY", "DIA"],
      freshPriceAssets: ["DIA", "QQQ", "SPY"],
      requiredFredSeries: ["DGS10", "VIXCLS"],
      freshFredSeries: ["VIXCLS", "DGS10"],
      jgb10yRefreshed: true,
    },
  },
  "equity-fast.json": {
    refreshSummary: {
      cmcCollectionRequested: true,
      cmcCurrentAvailable: true,
      cmcCurrentRefreshed: true,
      cmcStateMode: "refreshed",
      requiredMetricIds: ["BTC_MARKET_CAP", "CRYPTO_MARKET_CAP", "GOLD_PRICE_PROXY"],
      freshMetricIds: ["GOLD_PRICE_PROXY", "BTC_MARKET_CAP", "CRYPTO_MARKET_CAP"],
    },
  },
  "market-session.json": {
    refreshSummary: {
      cmcCollectionRequested: true,
      cmcCurrentAvailable: true,
      cmcCurrentRefreshed: true,
      cmcStateMode: "refreshed",
      requiredAssets: ["BTC", "USDT", "HYPE", "BNB"],
      okxRefreshedAssets: ["BNB", "BTC", "HYPE", "USDT"],
    },
  },
  "chip-chain-hotspots.json": {
    assets: {
      ASML: { symbol: "ASML", market: "us" },
      TSM: { symbol: "TSM", market: "us" },
      SAMSUNG: { symbol: "005930.KS", market: "kr" },
    },
    refreshSummary: {
      requiredUsSymbols: ["TSM", "ASML"],
      refreshedUsSymbols: ["ASML", "TSM"],
    },
  },
  "robot-chain-watchlist.json": {
    assets: {
      NVDA: { symbol: "NVDA", quote: "USD" },
      BOTZ: { symbol: "BOTZ", quote: "USD" },
    },
    refreshSummary: {
      requiredUsSymbols: ["NVDA", "BOTZ"],
      refreshedUsSymbols: ["BOTZ", "NVDA"],
    },
  },
  "chart-series.json": {
    metricCount: 1,
    metricOrder: ["macro.DGS10.value"],
    metrics: { "macro.DGS10.value": { unit: "percent" } },
    series: {
      "macro.DGS10.value": [
        { t: "2026-07-22", v: 4.1 },
        { t: "2026-07-23", v: 4.2 },
      ],
    },
  },
});

test("owner release refresh contract accepts complete primary coverage", () => {
  for (const [fileName, payload] of Object.entries(goodFixtures)) {
    assert.doesNotThrow(
      () => validateOwnerDatasetRefresh(fileName, structuredClone(payload), { cmcCollectionRequested: true }),
      fileName,
    );
  }
});

test("owner release refresh contract rejects a fresh timestamp with incomplete primaries", () => {
  const mutations = {
    "market-monthly.json": (payload) => payload.refreshSummary.refreshedSpotAssets.pop(),
    "crypto-liquidity.json": (payload) => { payload.refreshSummary.cmcStateMode = "disabled"; },
    "macro-calendar.json": (payload) => payload.refreshSummary.freshSeriesIds.splice(
      payload.refreshSummary.freshSeriesIds.indexOf("DGS10"),
      1,
    ),
    "equity-weekly.json": (payload) => { payload.refreshSummary.jgb10yRefreshed = false; },
    "equity-fast.json": (payload) => payload.refreshSummary.freshMetricIds.splice(
      payload.refreshSummary.freshMetricIds.indexOf("GOLD_PRICE_PROXY"),
      1,
    ),
    "market-session.json": (payload) => payload.refreshSummary.okxRefreshedAssets.pop(),
    "chip-chain-hotspots.json": (payload) => payload.refreshSummary.refreshedUsSymbols.pop(),
    "robot-chain-watchlist.json": (payload) => payload.refreshSummary.requiredUsSymbols.pop(),
    "chart-series.json": (payload) => payload.series["macro.DGS10.value"].pop(),
  };

  for (const [fileName, mutate] of Object.entries(mutations)) {
    const payload = structuredClone(goodFixtures[fileName]);
    mutate(payload);
    assert.throws(
      () => validateOwnerDatasetRefresh(fileName, payload, { cmcCollectionRequested: true }),
      undefined,
      fileName,
    );
  }
});

test("CMC cadence reuse is valid when collection is enabled and the shared state is usable", () => {
  for (const fileName of ["crypto-liquidity.json", "equity-fast.json", "market-session.json"]) {
    const payload = structuredClone(goodFixtures[fileName]);
    payload.refreshSummary.cmcCurrentRefreshed = false;
    payload.refreshSummary.cmcStateMode = "cadence_guard";
    if (fileName === "equity-fast.json") {
      payload.refreshSummary.freshMetricIds = ["GOLD_PRICE_PROXY"];
    }
    assert.doesNotThrow(
      () => validateOwnerDatasetRefresh(fileName, payload, { cmcCollectionRequested: true }),
      fileName,
    );
  }
});

test("CMC disabled mode remains explicit without blocking independent primary sources", () => {
  for (const fileName of ["crypto-liquidity.json", "equity-fast.json", "market-session.json"]) {
    const payload = structuredClone(goodFixtures[fileName]);
    Object.assign(payload.refreshSummary, {
      cmcCollectionRequested: false,
      cmcCurrentAvailable: false,
      cmcCurrentRefreshed: false,
      cmcStateMode: "disabled",
    });
    if (fileName === "equity-fast.json") {
      payload.refreshSummary.freshMetricIds = ["GOLD_PRICE_PROXY"];
    }
    assert.doesNotThrow(
      () => validateOwnerDatasetRefresh(fileName, payload, { cmcCollectionRequested: false }),
      fileName,
    );
  }
});

test("CMC status cannot contradict the release switch or claim freshness while disabled", () => {
  const mismatch = structuredClone(goodFixtures["crypto-liquidity.json"]);
  assert.throws(
    () => validateOwnerDatasetRefresh("crypto-liquidity.json", mismatch, { cmcCollectionRequested: false }),
    /does not match the release input/,
  );

  Object.assign(mismatch.refreshSummary, {
    cmcCollectionRequested: false,
    cmcCurrentRefreshed: true,
    cmcStateMode: "disabled",
  });
  assert.throws(
    () => validateOwnerDatasetRefresh("crypto-liquidity.json", mismatch, { cmcCollectionRequested: false }),
    /cannot report a CoinMarketCap refresh/,
  );
});

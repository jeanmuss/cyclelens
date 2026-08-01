const EXPECTED_MONTHLY_ASSETS = Object.freeze(["BNB", "BTC", "ETH", "HYPE", "SOL"]);
const EXPECTED_SOSO_ASSETS = Object.freeze(["BTC", "ETH", "SOL"]);
const EXPECTED_MARKET_SESSION_ASSETS = Object.freeze(["BNB", "BTC", "HYPE", "USDT"]);
const EXPECTED_FAST_EQUITY_METRICS = Object.freeze([
  "BTC_MARKET_CAP",
  "CRYPTO_MARKET_CAP",
  "GOLD_PRICE_PROXY",
]);
const EXPECTED_EQUITY_PRICE_ASSETS = Object.freeze(["DIA", "QQQ", "SPY"]);
const EXPECTED_EQUITY_FRED_SERIES = Object.freeze(["DGS10", "VIXCLS"]);
const EXPECTED_MACRO_FRED_SERIES = Object.freeze([
  "CPIAUCSL",
  "DFF",
  "DGS10",
  "DGS2",
  "M2SL",
  "PAYEMS",
  "RRPONTSYD",
  "UNRATE",
  "VIXCLS",
  "WALCL",
  "WTREGEN",
]);

function normalizedStringSet(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const values = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label} must contain only non-empty strings`);
    }
    return item.trim();
  });
  const unique = [...new Set(values)].sort();
  if (unique.length !== values.length) throw new Error(`${label} must not contain duplicates`);
  if (!allowEmpty && unique.length === 0) throw new Error(`${label} must not be empty`);
  return unique;
}

function assertExactSet(value, expected, label, options) {
  const actual = normalizedStringSet(value, label, options);
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((item, index) => item !== wanted[index])) {
    throw new Error(`${label} does not match the required release coverage`);
  }
}

function requireRefreshSummary(payload, fileName) {
  const summary = payload?.refreshSummary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error(`${fileName} is missing refreshSummary`);
  }
  return summary;
}

const CMC_ACTIVE_MODES = Object.freeze(new Set([
  "refreshed",
  "cadence_guard",
  "budget_guard",
  "provider_failed_lkg",
  "hydrated",
]));
const CMC_ALL_MODES = Object.freeze(new Set([
  ...CMC_ACTIVE_MODES,
  "disabled",
  "missing",
  "policy_denied",
]));

function validateCmcRefresh(summary, fileName, collectionRequested) {
  if (summary.cmcCollectionRequested !== collectionRequested) {
    throw new Error(`${fileName} CoinMarketCap collection status does not match the release input`);
  }
  if (typeof summary.cmcCurrentAvailable !== "boolean"
    || typeof summary.cmcCurrentRefreshed !== "boolean"
    || !CMC_ALL_MODES.has(summary.cmcStateMode)) {
    throw new Error(`${fileName} has an invalid CoinMarketCap provider-state summary`);
  }
  if (!collectionRequested && summary.cmcCurrentRefreshed) {
    throw new Error(`${fileName} cannot report a CoinMarketCap refresh while collection is disabled`);
  }
  if (collectionRequested
    && (!summary.cmcCurrentAvailable || !CMC_ACTIVE_MODES.has(summary.cmcStateMode))) {
    throw new Error(`${fileName} has no usable CoinMarketCap provider state`);
  }
}

function isUsChainAsset(asset) {
  const market = String(asset?.market || "").trim().toLowerCase();
  if (market) return market === "us";
  return String(asset?.quote || "").trim().toUpperCase() === "USD";
}

function expectedUsChainSymbols(payload, fileName) {
  const symbols = Object.values(payload?.assets || {})
    .filter(isUsChainAsset)
    .map((asset) => String(asset?.symbol || "").trim())
    .filter(Boolean);
  return normalizedStringSet(symbols, `${fileName} U.S. asset symbols`);
}

function validateChartSeries(payload) {
  const metrics = payload?.metrics;
  const series = payload?.series;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)
    || !series || typeof series !== "object" || Array.isArray(series)) {
    throw new Error("chart-series.json must contain metric and series objects");
  }
  const metricIds = normalizedStringSet(Object.keys(metrics), "chart-series metric IDs");
  const seriesIds = normalizedStringSet(Object.keys(series), "chart-series series IDs");
  assertExactSet(payload.metricOrder, metricIds, "chart-series metricOrder");
  assertExactSet(seriesIds, metricIds, "chart-series series IDs");
  if (!Number.isInteger(payload.metricCount) || payload.metricCount !== metricIds.length) {
    throw new Error("chart-series metricCount does not match the derived series");
  }
  for (const metricId of metricIds) {
    if (!Array.isArray(series[metricId]) || series[metricId].length < 2) {
      throw new Error(`chart-series metric lacks two observations: ${metricId}`);
    }
  }
}

export function validateOwnerDatasetRefresh(fileName, payload, { cmcCollectionRequested = false } = {}) {
  if (fileName === "chart-series.json") {
    validateChartSeries(payload);
    return;
  }

  const summary = requireRefreshSummary(payload, fileName);
  switch (fileName) {
    case "market-monthly.json":
      assertExactSet(summary.requiredAssets, EXPECTED_MONTHLY_ASSETS, `${fileName} requiredAssets`);
      assertExactSet(summary.refreshedAssets, EXPECTED_MONTHLY_ASSETS, `${fileName} refreshedAssets`);
      assertExactSet(summary.refreshedSpotAssets, EXPECTED_MONTHLY_ASSETS, `${fileName} refreshedSpotAssets`);
      break;
    case "crypto-liquidity.json":
      validateCmcRefresh(summary, fileName, cmcCollectionRequested);
      assertExactSet(summary.requiredSosoAssets, EXPECTED_SOSO_ASSETS, `${fileName} requiredSosoAssets`);
      assertExactSet(summary.sosoRefreshedAssets, EXPECTED_SOSO_ASSETS, `${fileName} sosoRefreshedAssets`);
      break;
    case "macro-calendar.json":
      assertExactSet(summary.requiredSeriesIds, EXPECTED_MACRO_FRED_SERIES, `${fileName} requiredSeriesIds`);
      for (const seriesId of EXPECTED_MACRO_FRED_SERIES) {
        if (!normalizedStringSet(summary.freshSeriesIds, `${fileName} freshSeriesIds`).includes(seriesId)) {
          throw new Error(`${fileName} did not refresh required FRED series ${seriesId}`);
        }
      }
      break;
    case "equity-weekly.json":
      assertExactSet(summary.requiredPriceAssets, EXPECTED_EQUITY_PRICE_ASSETS, `${fileName} requiredPriceAssets`);
      assertExactSet(summary.freshPriceAssets, EXPECTED_EQUITY_PRICE_ASSETS, `${fileName} freshPriceAssets`);
      assertExactSet(summary.requiredFredSeries, EXPECTED_EQUITY_FRED_SERIES, `${fileName} requiredFredSeries`);
      assertExactSet(summary.freshFredSeries, EXPECTED_EQUITY_FRED_SERIES, `${fileName} freshFredSeries`);
      if (summary.jgb10yRefreshed !== true) {
        throw new Error(`${fileName} did not refresh the official Japan 10Y series`);
      }
      break;
    case "equity-fast.json":
      validateCmcRefresh(summary, fileName, cmcCollectionRequested);
      assertExactSet(summary.requiredMetricIds, EXPECTED_FAST_EQUITY_METRICS, `${fileName} requiredMetricIds`);
      if (!normalizedStringSet(summary.freshMetricIds, `${fileName} freshMetricIds`).includes("GOLD_PRICE_PROXY")) {
        throw new Error(`${fileName} did not refresh the required FRED gold series`);
      }
      break;
    case "market-session.json":
      validateCmcRefresh(summary, fileName, cmcCollectionRequested);
      assertExactSet(summary.requiredAssets, EXPECTED_MARKET_SESSION_ASSETS, `${fileName} requiredAssets`);
      assertExactSet(summary.okxRefreshedAssets, EXPECTED_MARKET_SESSION_ASSETS, `${fileName} okxRefreshedAssets`);
      break;
    case "chip-chain-hotspots.json":
    case "robot-chain-watchlist.json": {
      const expected = expectedUsChainSymbols(payload, fileName);
      assertExactSet(summary.requiredUsSymbols, expected, `${fileName} requiredUsSymbols`);
      assertExactSet(summary.refreshedUsSymbols, expected, `${fileName} refreshedUsSymbols`);
      break;
    }
    default:
      throw new Error(`No owner refresh contract is defined for ${fileName}`);
  }
}

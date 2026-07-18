export const FIVE_MINUTES_MS = 300_000;

function datasetDefinition(definition) {
  return Object.freeze(definition);
}

function datasetGroup(definitions) {
  return Object.freeze(definitions.map(datasetDefinition));
}

export const MACRO_LIVE_DATA = datasetGroup([
  { id: "macroCalendar", path: "data/macro-calendar.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const EQUITY_SUMMARY_LIVE_DATA = datasetGroup([
  { id: "equityWeekly", path: "data/equity-weekly.json", pollIntervalMs: FIVE_MINUTES_MS },
  { id: "equityFast", path: "data/equity-fast.json", pollIntervalMs: 60_000, required: false },
]);

export const EQUITY_CHART_LIVE_DATA = datasetGroup([
  { id: "chartSeries", path: "data/chart-series.json", pollIntervalMs: FIVE_MINUTES_MS, required: false },
]);

export const MARKET_CLOCK_LIVE_DATA = datasetGroup([
  { id: "marketSession", path: "data/market-session.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const CRYPTO_LIVE_DATA = datasetGroup([
  { id: "marketMonthly", path: "data/market-monthly.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const DASHBOARD_LIVE_DATA = datasetGroup([
  { id: "dashboardProjection", path: "data/projections/dashboard.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const CRYPTO_LIQUIDITY_LIVE_DATA = datasetGroup([
  { id: "cryptoLiquidity", path: "data/crypto-liquidity.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const CHIP_CHAIN_LIVE_DATA = datasetGroup([
  { id: "chipChain", path: "data/chip-chain-hotspots.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const ROBOT_CHAIN_LIVE_DATA = datasetGroup([
  { id: "robotChain", path: "data/robot-chain-watchlist.json", pollIntervalMs: FIVE_MINUTES_MS },
]);

export const LIVE_DATA_GROUPS = Object.freeze({
  dashboard: DASHBOARD_LIVE_DATA,
  macro: MACRO_LIVE_DATA,
  equitySummary: EQUITY_SUMMARY_LIVE_DATA,
  equityChart: EQUITY_CHART_LIVE_DATA,
  marketClock: MARKET_CLOCK_LIVE_DATA,
  crypto: CRYPTO_LIVE_DATA,
  cryptoLiquidity: CRYPTO_LIQUIDITY_LIVE_DATA,
  chipChain: CHIP_CHAIN_LIVE_DATA,
  robotChain: ROBOT_CHAIN_LIVE_DATA,
});

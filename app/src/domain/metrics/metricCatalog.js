export const METRIC_CATALOG_VERSION = 2;

const qualityPolicy = Object.freeze({
  missing: "preserve_last_known_good",
  stale: "show_with_quality_flag",
  revisions: "retain",
});

function metric({
  metricId,
  title,
  unit,
  cadence,
  sourcePolicyIds,
  projections,
  format,
  precision = 2,
  historyLimit = 120,
}) {
  return Object.freeze({
    metricId,
    title: Object.freeze(title),
    unit,
    cadence,
    sourcePolicyIds: Object.freeze(sourcePolicyIds),
    visibility: "public",
    quality: qualityPolicy,
    defaultDisplay: Object.freeze({ format, precision }),
    projections: Object.freeze(projections),
    historyLimit,
  });
}

export const METRIC_CATALOG = Object.freeze([
  metric({
    metricId: "crypto.totalMarketCap",
    title: { zh: "加密货币总市值", en: "Total crypto market cap" },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds: ["coinmarketcap"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_currency",
  }),
  metric({
    metricId: "btc.marketCap",
    title: { zh: "比特币市值", en: "Bitcoin market cap" },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds: ["coinmarketcap"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_currency",
  }),
  metric({
    metricId: "stablecoin.usdt.marketCap",
    title: { zh: "USDT 流通市值", en: "USDT circulating market cap" },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds: ["defillama", "coinmarketcap"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_currency",
  }),
  metric({
    metricId: "stablecoin.usdc.marketCap",
    title: { zh: "USDC 流通市值", en: "USDC circulating market cap" },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds: ["defillama", "coinmarketcap"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_currency",
  }),
  metric({
    metricId: "stablecoin.major.marketCap",
    title: { zh: "主要稳定币总市值", en: "Major stablecoin market cap" },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds: ["defillama"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_currency",
  }),
  metric({
    metricId: "stablecoin.usdt.depegBps",
    title: { zh: "USDT 脱锚幅度", en: "USDT depeg distance" },
    unit: "bps",
    cadence: "daily",
    sourcePolicyIds: ["coinmarketcap"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "basis_points",
  }),
  ...[
    ["BTC", ["sosovalue", "blockbeats"]],
    ["ETH", ["sosovalue"]],
    ["SOL", ["sosovalue"]],
  ].map(([asset, sourcePolicyIds]) => metric({
    metricId: `crypto.etf.${asset}.net_flow_usd`,
    title: { zh: `美国现货 ${asset} ETF 净流量`, en: `U.S. spot ${asset} ETF net flow` },
    unit: "USD",
    cadence: "daily",
    sourcePolicyIds,
    projections: ["dashboard", "crypto-liquidity"],
    format: "signed_compact_currency",
  })),
  metric({
    metricId: "treasury.mstr.btc_holdings",
    title: { zh: "Strategy 比特币持仓", en: "Strategy bitcoin holdings" },
    unit: "BTC",
    cadence: "disclosure",
    sourcePolicyIds: ["strategy-disclosures"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_number",
    precision: 0,
    historyLimit: 60,
  }),
  metric({
    metricId: "treasury.mstr.btc_average_cost_usd",
    title: { zh: "Strategy 比特币平均成本", en: "Strategy bitcoin average cost" },
    unit: "USD_per_asset",
    cadence: "disclosure",
    sourcePolicyIds: ["strategy-disclosures"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "currency",
    precision: 0,
    historyLimit: 60,
  }),
  metric({
    metricId: "treasury.bmnr.eth_holdings",
    title: { zh: "BitMine 以太坊持仓", en: "BitMine ether holdings" },
    unit: "ETH",
    cadence: "disclosure",
    sourcePolicyIds: ["sec-edgar"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "compact_number",
    precision: 0,
    historyLimit: 60,
  }),
  metric({
    metricId: "treasury.bmnr.eth_average_cost_usd",
    title: { zh: "BitMine 以太坊平均成本", en: "BitMine ether average cost" },
    unit: "USD_per_asset",
    cadence: "disclosure",
    sourcePolicyIds: ["sec-edgar"],
    projections: ["dashboard", "crypto-liquidity"],
    format: "currency",
    precision: 0,
    historyLimit: 60,
  }),
  ...[
    ["qqq", "纳斯达克 100（QQQ）", "Nasdaq 100 proxy (QQQ)", "USD", "currency", ["akshare"]],
    ["spy", "标普 500（SPY）", "S&P 500 proxy (SPY)", "USD", "currency", ["akshare"]],
    ["dia", "道琼斯（DIA）", "Dow Jones proxy (DIA)", "USD", "currency", ["akshare"]],
    ["sox", "费城半导体指数", "PHLX Semiconductor Index", "index", "number", ["yahoo-finance"]],
  ].map(([symbol, zh, en, unit, format, sourcePolicyIds]) => metric({
    metricId: `equity.us.${symbol}.${symbol === "sox" ? "value" : "price"}`,
    title: { zh, en },
    unit,
    cadence: "daily",
    sourcePolicyIds,
    projections: ["dashboard", "us-equity"],
    format,
    precision: 2,
  })),
  metric({
    metricId: "commodity.gold.proxy",
    title: { zh: "黄金价格代理", en: "Gold price proxy" },
    unit: "index",
    cadence: "daily",
    sourcePolicyIds: ["fred-third-party"],
    projections: ["dashboard", "us-equity"],
    format: "number",
    precision: 2,
  }),
  metric({
    metricId: "macro.riskPosture.score",
    title: { zh: "风险压力评分", en: "Risk pressure score" },
    unit: "score",
    cadence: "weekly",
    sourcePolicyIds: ["fred-government", "fred-third-party"],
    projections: ["dashboard"],
    format: "number",
    precision: 0,
  }),
  metric({
    metricId: "macro.US10Y.value",
    title: { zh: "美国十年期国债收益率", en: "U.S. 10-year Treasury yield" },
    unit: "percent",
    cadence: "daily",
    sourcePolicyIds: ["fred-government"],
    projections: ["dashboard", "us-equity"],
    format: "percent",
    precision: 2,
  }),
  metric({
    metricId: "macro.US10Y.realYield",
    title: { zh: "美国十年期实际利率", en: "U.S. 10-year real yield" },
    unit: "percent",
    cadence: "daily",
    sourcePolicyIds: ["fred-government"],
    projections: ["dashboard"],
    format: "percent",
    precision: 2,
  }),
  metric({
    metricId: "macro.DXY.value",
    title: { zh: "广义美元指数", en: "Broad U.S. dollar index" },
    unit: "index",
    cadence: "daily",
    sourcePolicyIds: ["fred-government"],
    projections: ["dashboard"],
    format: "number",
    precision: 2,
  }),
  metric({
    metricId: "macro.VIX.value",
    title: { zh: "VIX 波动率指数", en: "VIX volatility index" },
    unit: "index",
    cadence: "daily",
    sourcePolicyIds: ["fred-third-party"],
    projections: ["dashboard", "us-equity"],
    format: "number",
    precision: 2,
  }),
  metric({
    metricId: "macro.HYOAS.value",
    title: { zh: "美国高收益债利差", en: "U.S. high-yield OAS" },
    unit: "percent",
    cadence: "daily",
    sourcePolicyIds: ["fred-third-party"],
    projections: ["dashboard"],
    format: "percent",
    precision: 2,
  }),
  metric({
    metricId: "macro.netLiquidity.usd",
    title: { zh: "美元净流动性", en: "U.S. dollar net liquidity" },
    unit: "USD",
    cadence: "weekly",
    sourcePolicyIds: ["fred-government"],
    projections: ["dashboard"],
    format: "compact_currency",
    precision: 2,
  }),
  metric({
    metricId: "macro.JGB10Y.value",
    title: { zh: "日本十年期国债收益率", en: "Japan 10-year government bond yield" },
    unit: "percent",
    cadence: "daily",
    sourcePolicyIds: ["japan-mof"],
    projections: ["dashboard", "us-equity"],
    format: "percent",
    precision: 3,
  }),
]);

export const METRIC_CATALOG_BY_ID = Object.freeze(Object.fromEntries(
  METRIC_CATALOG.map((item) => [item.metricId, item]),
));

export function validateMetricCatalog(entries = METRIC_CATALOG) {
  const errors = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry?.metricId || ids.has(entry.metricId)) errors.push(`duplicate or blank metricId: ${entry?.metricId || "<blank>"}`);
    ids.add(entry?.metricId);
    if (!entry?.title?.zh || !entry?.title?.en) errors.push(`${entry?.metricId}: bilingual title is required`);
    if (!entry?.unit || !entry?.cadence) errors.push(`${entry?.metricId}: unit and cadence are required`);
    if (!entry?.sourcePolicyIds?.length) errors.push(`${entry?.metricId}: source policy is required`);
    if (!entry?.projections?.length) errors.push(`${entry?.metricId}: projection is required`);
    if (!entry?.defaultDisplay?.format) errors.push(`${entry?.metricId}: default display is required`);
    if (entry?.quality?.missing !== "preserve_last_known_good") errors.push(`${entry?.metricId}: LKG policy is required`);
  }
  return errors;
}

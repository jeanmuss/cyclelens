function widget(definition) {
  return Object.freeze({
    ...definition,
    title: Object.freeze(definition.title),
    description: Object.freeze(definition.description),
    metricIds: Object.freeze(definition.metricIds),
    markets: Object.freeze(definition.markets),
  });
}

export const DASHBOARD_WIDGET_DEFINITIONS = Object.freeze([
  widget({
    id: "market-breadth",
    title: { zh: "加密市场规模", en: "Crypto market scale" },
    description: { zh: "总市值与比特币市值的公开快照", en: "Public snapshots for total and bitcoin market cap" },
    metricIds: ["crypto.totalMarketCap", "btc.marketCap"],
    size: "wide",
    defaultPosition: 0,
    markets: ["crypto"],
    componentId: "metric-list",
  }),
  widget({
    id: "stablecoin-liquidity",
    title: { zh: "稳定币流动性", en: "Stablecoin liquidity" },
    description: { zh: "主要稳定币、USDT 与 USDC 供应规模", en: "Major stablecoin, USDT, and USDC supply" },
    metricIds: ["stablecoin.major.marketCap", "stablecoin.usdt.marketCap", "stablecoin.usdc.marketCap"],
    size: "wide",
    defaultPosition: 1,
    markets: ["crypto"],
    componentId: "metric-list",
  }),
  widget({
    id: "etf-flows",
    title: { zh: "现货 ETF 资金流", en: "Spot ETF flows" },
    description: { zh: "BTC、ETH 与 SOL 日度净流量", en: "Daily BTC, ETH, and SOL net flows" },
    metricIds: ["crypto.etf.BTC.net_flow_usd", "crypto.etf.ETH.net_flow_usd", "crypto.etf.SOL.net_flow_usd"],
    size: "wide",
    defaultPosition: 2,
    markets: ["crypto", "us"],
    componentId: "metric-list",
  }),
  widget({
    id: "strategy-treasury",
    title: { zh: "Strategy 财库", en: "Strategy treasury" },
    description: { zh: "比特币持仓与官方披露平均成本", en: "Bitcoin holdings and officially disclosed average cost" },
    metricIds: ["treasury.mstr.btc_holdings", "treasury.mstr.btc_average_cost_usd"],
    size: "standard",
    defaultPosition: 3,
    markets: ["crypto", "us"],
    componentId: "metric-list",
  }),
  widget({
    id: "bitmine-treasury",
    title: { zh: "BitMine 财库", en: "BitMine treasury" },
    description: { zh: "以太坊持仓与 SEC 成本基础", en: "Ether holdings and SEC cost basis" },
    metricIds: ["treasury.bmnr.eth_holdings", "treasury.bmnr.eth_average_cost_usd"],
    size: "standard",
    defaultPosition: 4,
    markets: ["crypto", "us"],
    componentId: "metric-list",
  }),
  widget({
    id: "japan-rates",
    title: { zh: "日本长期利率", en: "Japan long rates" },
    description: { zh: "日本财务省十年期国债收益率", en: "Japan MOF 10-year government bond yield" },
    metricIds: ["macro.JGB10Y.value"],
    size: "standard",
    defaultPosition: 5,
    markets: ["japan", "macro"],
    componentId: "metric-list",
  }),
]);

export const DASHBOARD_WIDGET_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
  DASHBOARD_WIDGET_DEFINITIONS.map((definition) => [definition.id, definition]),
));

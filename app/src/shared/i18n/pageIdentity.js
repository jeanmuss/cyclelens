const identities = {
  zh: {
    dashboard: {
      navLabel: "首页看板",
      title: "风险资产数据看板",
      description: "集中浏览并按设备定制跨市场指标卡片",
    },
    crypto: {
      navLabel: "加密周期",
      title: "风险资产周期与轮动图",
      description: "BTC、ETH、SOL、HYPE、BNB 月度收益周期与轮动可视化",
    },
    cryptoLiquidity: {
      navLabel: "加密流动性",
      title: "加密流动性脉搏",
      description: "ETF、市值与稳定币供应的加密市场流动性观察",
    },
    macro: {
      navLabel: "宏观流动性",
      title: "宏观流动性日历",
      description: "风险资产的宏观、利率、美元、波动率与信用利差观测日历",
    },
    equity: {
      navLabel: "美股大盘",
      title: "美股大盘轮动图",
      description: "QQQ、SPY 周度收益与 FRED 宏观指标轮动可视化",
    },
    marketClock: {
      navLabel: "开市轮动",
      title: "全球市场开市轮动",
      description: "加密、美股、韩股与中国风险市场的开市状态、价格和市值轮动视图",
    },
    chipChain: {
      navLabel: "芯片链热点",
      title: "AI 芯片产业链热点",
      description: "按产业链细分类目追踪 AI 芯片相关美股和韩股的板块轮动热点",
    },
    robotChain: {
      navLabel: "机器人链",
      title: "机器人产业链观察池",
      description: "按机器人产业链板块追踪上市标的、业务定位、缓存价格和多周期涨跌幅。",
    },
    macroAdmin: {
      navLabel: "后台",
      title: "宏观事件后台",
      description: "本地维护宏观流动性手动事件",
    },
  },
  en: {
    dashboard: {
      navLabel: "Dashboard",
      title: "Risk Asset Dashboard",
      description: "Browse and customize cross-market metric cards on this device",
    },
    crypto: {
      navLabel: "Crypto cycle",
      title: "Risk Asset Cycle & Rotation Map",
      description: "Monthly return cycle and rotation visualization for BTC, ETH, SOL, HYPE, and BNB",
    },
    cryptoLiquidity: {
      navLabel: "Crypto liquidity",
      title: "Crypto Liquidity Pulse",
      description: "Crypto ETF flows, market-cap changes, and stablecoin supply signals",
    },
    macro: {
      navLabel: "Macro & liquidity",
      title: "Macro & Liquidity Calendar",
      description: "Macro, rates, dollar, volatility, and credit observations for risk assets",
    },
    equity: {
      navLabel: "US market",
      title: "US Market Rotation Map",
      description: "Weekly QQQ, SPY, and FRED macro rotation visualization",
    },
    marketClock: {
      navLabel: "Market clock",
      title: "Global Market Rotation Clock",
      description: "Session status, prices, and market caps for crypto, U.S., Korean, and China risk markets.",
    },
    chipChain: {
      navLabel: "Chip chain",
      title: "AI Chip Chain Hotspots",
      description: "Track AI chip supply-chain rotation across U.S. and Korean equities by category.",
    },
    robotChain: {
      navLabel: "Robot chain",
      title: "Robotics Chain Watchlist",
      description: "Track robotics value-chain listed names by segment, business role, cached price, and multi-window returns.",
    },
    macroAdmin: {
      navLabel: "Admin",
      title: "Macro Event Admin",
      description: "Local editor for manual macro-liquidity events",
    },
  },
};

function freezeIdentities(values) {
  return Object.freeze(Object.fromEntries(Object.entries(values).map(([language, pages]) => [
    language,
    Object.freeze(Object.fromEntries(Object.entries(pages).map(([pageId, identity]) => [
      pageId,
      Object.freeze(identity),
    ]))),
  ])));
}

export const PAGE_IDENTITIES = freezeIdentities(identities);

export function normalizedLanguage(value) {
  return String(value || "").toLowerCase().startsWith("en") ? "en" : "zh";
}

export function pageIdentity(pageId, language = "zh") {
  const localized = PAGE_IDENTITIES[normalizedLanguage(language)];
  return localized[pageId] || localized.dashboard;
}

export function pageMetadata(pageId, language = "zh") {
  const { title, description } = pageIdentity(pageId, language);
  return { title, description };
}

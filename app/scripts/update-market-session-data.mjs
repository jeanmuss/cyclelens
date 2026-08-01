import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOfficialMarketCalendar } from "./market-session-calendar.mjs";
import { productUserAgent } from "../product.config.mjs";
import { sourcePolicyIdIsEligibleForDataUse } from "../src/domain/metrics/sourcePolicy.js";
import {
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
} from "./data-use-scope.mjs";
import { fetchJsonBounded } from "./secure-fetch.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(appRoot, "..");
const dataUseScope = dataUseScopeFromEnvironment(process.env, process.argv);
const dataDirectory = dataDirectoryForScope(appRoot, dataUseScope);
const outputPath = resolve(dataDirectory, "market-session.json");
const cmcProviderStatePath = resolve(workspaceRoot, "tmp/owner-private/provider-state/coinmarketcap.json");

const OKX_BASE = "https://www.okx.com/api/v5";
const MARKET_SESSION_ALLOWED_ORIGINS = Object.freeze([
  "https://www.okx.com",
]);
const REQUIRED_MARKET_SESSION_ASSETS = Object.freeze(["BTC", "USDT", "HYPE", "BNB"]);
const CMC_PROVIDER_STATE_ASSETS = Object.freeze({ BTC: 1, ETH: 1027, USDT: 825, USDC: 3408, HYPE: 32196, BNB: 1839 });
const CMC_PROVIDER_STATE_MODES = new Set([
  "refreshed",
  "disabled",
  "cadence_guard",
  "budget_guard",
  "provider_failed_lkg",
  "hydrated",
]);
const CMC_PROVIDER_STATE_ACTIVE_MODES = new Set([
  "refreshed",
  "cadence_guard",
  "budget_guard",
  "provider_failed_lkg",
  "hydrated",
]);
const CMC_PROVIDER_STATE_MAX_BYTES = 4 * 1024 * 1024;
const CMC_PROVIDER_STATE_FRESH_MS = 30 * 60 * 1000;
const DENIED_CONSUMER_ENV_KEYS = new Set(["CMC_PRO_API_KEY"]);

const MARKETS = [
  {
    id: "crypto",
    displayName: "Crypto",
    displayNameZh: "加密市场",
    timezone: "UTC",
    stateModel: "always_open",
    assets: ["BTC", "USDT", "HYPE", "BNB"],
  },
  {
    id: "us",
    displayName: "U.S. risk",
    displayNameZh: "美国风险",
    timezone: "America/New_York",
    stateModel: "premarket_regular_afterhours",
    sessionTemplates: [
      { key: "premarket", start: "04:00", end: "09:30", active: true, sortRank: 1 },
      { key: "open", start: "09:30", end: "16:00", active: true, sortRank: 1 },
      { key: "afterhours", start: "16:00", end: "20:00", active: true, sortRank: 2 },
    ],
    assets: ["TSLA", "NVDA", "MSFT", "CL"],
  },
  {
    id: "kr",
    displayName: "Korea",
    displayNameZh: "韩国市场",
    timezone: "Asia/Seoul",
    stateModel: "premarket_regular_afterhours",
    sessionTemplates: [
      { key: "premarket", start: "08:00", end: "09:00", active: true, sortRank: 1 },
      { key: "open", start: "09:00", end: "15:30", active: true, sortRank: 1 },
      { key: "afterhours", start: "15:40", end: "18:00", active: true, sortRank: 2 },
    ],
    assets: ["KOSPI200", "SAMSUNG", "SKHYNIX"],
  },
  {
    id: "cn",
    displayName: "China",
    displayNameZh: "中国市场",
    timezone: "Asia/Shanghai",
    stateModel: "china_auction_regular_afterhours",
    sessionTemplates: [
      { key: "opening-auction", start: "09:15", end: "09:25", active: true, sortRank: 1 },
      { key: "open", start: "09:30", end: "11:30", active: true, sortRank: 1 },
      { key: "lunch", start: "11:30", end: "13:00", active: false, sortRank: 3 },
      { key: "open", start: "13:00", end: "14:57", active: true, sortRank: 1 },
      { key: "closing-auction", start: "14:57", end: "15:00", active: true, sortRank: 1 },
      { key: "fixed-price-gap", start: "15:00", end: "15:05", active: false, sortRank: 3, effectiveFrom: "2026-07-06" },
      { key: "fixed-price", start: "15:05", end: "15:30", active: true, sortRank: 2, effectiveFrom: "2026-07-06" },
    ],
    assets: ["CSI500", "SSE50"],
  },
];

const ASSETS = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    nameZh: "Bitcoin",
    market: "crypto",
    quote: "USDT",
    okx: { type: "ticker", instId: "BTC-USDT" },
    cmcSymbol: "BTC",
    cmcSlug: "bitcoin",
  },
  {
    symbol: "USDT",
    name: "Tether USDt",
    nameZh: "Tether USDt",
    market: "crypto",
    quote: "USD",
    okx: { type: "ticker", instId: "USDT-USD" },
    cmcSymbol: "USDT",
    cmcSlug: "tether",
    note: "USDT/USD is a peg-pressure proxy, not a direct flow measurement.",
  },
  {
    symbol: "HYPE",
    name: "Hyperliquid",
    nameZh: "Hyperliquid",
    market: "crypto",
    quote: "USDT",
    okx: { type: "ticker", instId: "HYPE-USDT" },
    cmcSymbol: "HYPE",
    cmcSlug: "hyperliquid",
  },
  {
    symbol: "BNB",
    name: "BNB",
    nameZh: "BNB",
    market: "crypto",
    quote: "USDT",
    okx: { type: "ticker", instId: "BNB-USDT" },
    cmcSymbol: "BNB",
    cmcSlug: "bnb",
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    nameZh: "Tesla",
    market: "us",
    quote: "USD",
    okx: { type: "ticker", instId: "TSLA-USDT-SWAP" },
    sourceKind: "proxy",
    quality: "OKX equity swap proxy; official U.S. equity feed pending.",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    nameZh: "NVIDIA",
    market: "us",
    quote: "USD",
    okx: { type: "ticker", instId: "NVDA-USDT-SWAP" },
    sourceKind: "proxy",
    quality: "OKX equity swap proxy; official U.S. equity feed pending.",
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    nameZh: "Microsoft",
    market: "us",
    quote: "USD",
    okx: { type: "ticker", instId: "MSFT-USDT-SWAP" },
    sourceKind: "proxy",
    quality: "OKX equity swap proxy; official U.S. equity feed pending.",
  },
  {
    symbol: "CL",
    name: "OKX CL Index",
    nameZh: "OKX CL 指数",
    market: "us",
    quote: "USD",
    okx: { type: "index", instId: "CL-USDT" },
    sourceKind: "proxy",
    marketCapNotApplicable: true,
    quality: "OKX CL index proxy; primarily Hyperliquid Oracle plus OKX linear perpetual components.",
  },
  {
    symbol: "KOSPI200",
    name: "KOSPI 200",
    nameZh: "KOSPI 200",
    market: "kr",
    quote: "USD",
    sourceKind: "pending",
    quality: "Price source pending; status rotation is calculated locally from KRX pre-market, regular, and after-hours session rules.",
  },
  {
    symbol: "SAMSUNG",
    name: "Samsung Electronics",
    nameZh: "Samsung Electronics",
    market: "kr",
    quote: "USD",
    localQuote: "KRW",
    sourceKind: "pending",
    quality: "KRW price and USD conversion source pending.",
  },
  {
    symbol: "SKHYNIX",
    name: "SK hynix",
    nameZh: "SK hynix",
    market: "kr",
    quote: "USD",
    localQuote: "KRW",
    sourceKind: "pending",
    quality: "KRW price and USD conversion source pending.",
  },
  {
    symbol: "CSI500",
    name: "CSI 500",
    nameZh: "中证500",
    market: "cn",
    quote: "CNY",
    sourceKind: "pending",
    sessionEligibility: "non_tradable_index_proxy",
    quality: "Non-tradable China index proxy; session status describes eligible A-shares and exchange-traded open-end funds, not the index itself. Price source pending; market cap may remain unavailable.",
  },
  {
    symbol: "SSE50",
    name: "SSE 50",
    nameZh: "上证50",
    market: "cn",
    quote: "CNY",
    sourceKind: "pending",
    sessionEligibility: "non_tradable_index_proxy",
    quality: "Non-tradable China index proxy; session status describes eligible A-shares and exchange-traded open-end funds, not the index itself. Price source pending; market cap may remain unavailable.",
  },
];

function loadEnvFile(path) {
  return readFile(path, "utf8")
    .then((text) => {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || DENIED_CONSUMER_ENV_KEYS.has(match[1]) || process.env[match[1]]) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
      }
    })
    .catch(() => {});
}

function isoNow() {
  return new Date().toISOString();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function strictFiniteNumber(value, { minimum = -Infinity } = {}) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : null;
}

function nonFutureIso(value, nowMs) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs ? new Date(parsed).toISOString() : null;
}

function invalidCmcProviderState(reason) {
  return {
    valid: false,
    fresh: false,
    reason,
    mode: reason === "scope_denied" ? "policy_denied" : "missing",
    fetchedAt: null,
    global: {},
    assets: {},
  };
}

export function normalizeCmcProviderState(payload, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return invalidCmcProviderState("invalid_clock");
  if (!isRecord(payload)
    || payload.version !== 1
    || payload.provider !== "coinmarketcap"
    || payload.dataUseScope !== "owner_private") {
    return invalidCmcProviderState("invalid_identity");
  }
  if (![payload.current, payload.history, payload.watermarks, payload.budget, payload.refresh].every(isRecord)) {
    return invalidCmcProviderState("invalid_schema");
  }
  const updatedAt = nonFutureIso(payload.updatedAt, nowMs);
  const fetchedAt = nonFutureIso(payload.current.fetchedAt, nowMs);
  const mode = typeof payload.refresh.mode === "string" && CMC_PROVIDER_STATE_MODES.has(payload.refresh.mode)
    ? payload.refresh.mode
    : null;
  const globalObservedAt = nonFutureIso(payload.current.global?.observedAt, nowMs);
  const totalMarketCapUsd = strictFiniteNumber(payload.current.global?.totalMarketCapUsd, { minimum: 0 });
  const totalMarketCapYesterdayUsd = strictFiniteNumber(payload.current.global?.totalMarketCapYesterdayUsd, { minimum: 0 });
  const totalMarketCapChangePct24h = strictFiniteNumber(payload.current.global?.totalMarketCapChangePct24h);
  if (!updatedAt || !fetchedAt || !globalObservedAt || totalMarketCapUsd == null
    || (payload.current.global?.totalMarketCapYesterdayUsd != null && totalMarketCapYesterdayUsd == null)
    || (payload.current.global?.totalMarketCapChangePct24h != null && totalMarketCapChangePct24h == null)
    || !mode || typeof payload.refresh.currentRefreshed !== "boolean") {
    return invalidCmcProviderState("invalid_current_global");
  }

  const assets = {};
  for (const [symbol, expectedId] of Object.entries(CMC_PROVIDER_STATE_ASSETS)) {
    const item = payload.current.assets?.[symbol];
    const id = strictFiniteNumber(item?.id, { minimum: 1 });
    const priceUsd = strictFiniteNumber(item?.priceUsd, { minimum: 0 });
    const marketCapUsd = strictFiniteNumber(item?.marketCapUsd, { minimum: 0 });
    const percentChange24h = strictFiniteNumber(item?.percentChange24h);
    const observedAt = nonFutureIso(item?.observedAt, nowMs);
    if (!isRecord(item) || item.symbol !== symbol || id !== expectedId
      || priceUsd == null || marketCapUsd == null
      || (item.percentChange24h != null && percentChange24h == null) || !observedAt) {
      return invalidCmcProviderState("invalid_current_assets");
    }
    assets[symbol] = {
      marketCapUsd,
      marketCapAsOf: observedAt,
      cmcId: id,
    };
  }

  const maxFreshAgeMs = Number.isFinite(options.maxFreshAgeMs)
    ? Math.max(0, options.maxFreshAgeMs)
    : CMC_PROVIDER_STATE_FRESH_MS;
  const nonCollectingModes = new Set(["disabled", "missing", "policy_denied"]);
  const fresh = payload.refresh.currentRefreshed === true
    && !nonCollectingModes.has(mode)
    && nowMs - Date.parse(fetchedAt) <= maxFreshAgeMs;
  return {
    valid: true,
    fresh,
    reason: fresh ? "current" : "last_known_good",
    mode,
    updatedAt,
    fetchedAt,
    global: {
      totalMarketCapUsd,
      totalMarketCapYesterdayUsd,
      totalMarketCapChangePct24h,
      observedAt: globalObservedAt,
    },
    assets,
  };
}

export async function readCmcProviderState(path = cmcProviderStatePath, options = {}) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > CMC_PROVIDER_STATE_MAX_BYTES) {
      return invalidCmcProviderState("unsafe_file");
    }
    const payload = JSON.parse(await readFile(path, "utf8"));
    return normalizeCmcProviderState(payload, options);
  } catch {
    return invalidCmcProviderState("unavailable");
  }
}

export function cmcCurrentIsAvailable(state) {
  return Boolean(
    state?.valid
    && CMC_PROVIDER_STATE_ACTIVE_MODES.has(state.mode)
    && typeof state.fetchedAt === "string"
    && Number.isFinite(state.global?.totalMarketCapUsd)
    && Object.entries(CMC_PROVIDER_STATE_ASSETS).every(
      ([symbol, expectedId]) => state.assets?.[symbol]?.cmcId === expectedId
        && Number.isFinite(state.assets[symbol].marketCapUsd)
        && typeof state.assets[symbol].marketCapAsOf === "string",
    ),
  );
}

export function projectCmcMarketCap(asset, previous, cmcState) {
  if (asset.marketCapNotApplicable) {
    return {
      marketCapUsd: null,
      marketCapStatus: "not_applicable",
      marketCapAsOf: null,
      marketCapSourceLabel: null,
    };
  }
  const stateRow = cmcState?.valid ? cmcState.assets?.[asset.symbol] : null;
  if (stateRow?.marketCapUsd != null) {
    return {
      marketCapUsd: stateRow.marketCapUsd,
      marketCapStatus: cmcState.fresh ? "available" : "last-known-good",
      marketCapAsOf: stateRow.marketCapAsOf,
      marketCapSourceLabel: cmcState.fresh
        ? "CoinMarketCap normalized provider state"
        : "CoinMarketCap normalized provider state (last-known-good)",
    };
  }
  const previousValue = strictFiniteNumber(previous?.marketCapUsd, { minimum: 0 });
  return {
    marketCapUsd: previousValue,
    marketCapStatus: previousValue == null ? "unavailable" : "last-known-good",
    marketCapAsOf: previousValue == null ? null : previous?.marketCapAsOf || null,
    marketCapSourceLabel: previousValue == null
      ? null
      : previous?.marketCapSourceLabel || "CoinMarketCap last-known-good",
  };
}

function latestIso(values) {
  const valid = values
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0] || null;
}

function attachOfficialCalendars(markets, generatedAt) {
  return markets.map((market) => {
    const official = buildOfficialMarketCalendar(market, new Date(generatedAt));
    return {
      ...market,
      ...official,
      nextTransitionAt: official.generatedStatus.nextTransitionAt,
    };
  });
}

function pctChange(openValue, closeValue) {
  if (!Number.isFinite(openValue) || !Number.isFinite(closeValue) || openValue === 0) return null;
  return ((closeValue - openValue) / openValue) * 100;
}

function okxIso(ts) {
  const number = Number(ts);
  return Number.isFinite(number) ? new Date(number).toISOString() : null;
}

async function fetchJson(url, options = {}) {
  return fetchJsonBounded(url, {
    ...options,
    allowedOrigins: MARKET_SESSION_ALLOWED_ORIGINS,
    maxResponseBytes: 5 * 1024 * 1024,
    timeoutMs: 25_000,
    headers: {
      "User-Agent": productUserAgent("market-session"),
      ...(options.headers || {}),
    },
  });
}

async function fetchOkxAsset(asset) {
  if (!asset.okx) return null;
  if (asset.okx.type === "index") {
    const payload = await fetchJson(`${OKX_BASE}/market/index-tickers?instId=${asset.okx.instId}`);
    const row = payload?.data?.[0];
    const price = finiteNumber(row?.idxPx);
    const open = finiteNumber(row?.sodUtc0 ?? row?.open24h);
    let components = null;
    try {
      const componentPayload = await fetchJson(`${OKX_BASE}/market/index-components?index=${asset.okx.instId}`);
      components = (componentPayload?.data?.components || []).map((item) => ({
        exchange: item.exch,
        symbol: item.symbol,
        weight: finiteNumber(item.wgt),
      }));
    } catch {
      components = null;
    }
    return {
      price,
      changePct: pctChange(open, price),
      changeBasis: "UTC day",
      asOf: okxIso(row?.ts),
      sourceLabel: "OKX index ticker",
      sourceUrl: `${OKX_BASE}/market/index-tickers`,
      components,
    };
  }

  const payload = await fetchJson(`${OKX_BASE}/market/ticker?instId=${asset.okx.instId}`);
  const row = payload?.data?.[0];
  const price = finiteNumber(row?.last);
  const open = finiteNumber(row?.sodUtc0 ?? row?.open24h);
  return {
    price,
    changePct: pctChange(open, price),
    changeBasis: "UTC day",
    asOf: okxIso(row?.ts),
    sourceLabel: asset.okx.instId.endsWith("-SWAP") ? "OKX swap ticker proxy" : "OKX spot ticker",
    sourceUrl: `${OKX_BASE}/market/ticker`,
  };
}

async function buildOutput() {
  for (const key of DENIED_CONSUMER_ENV_KEYS) delete process.env[key];
  await loadEnvFile(resolve(appRoot, ".env.local"));
  await loadEnvFile(resolve(workspaceRoot, ".env.local"));

  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  const existingAssets = new Map((existing.assets || []).map((asset) => [asset.symbol, asset]));
  const okxAllowed = sourcePolicyIdIsEligibleForDataUse("public-crypto-market-apis", {
    scope: dataUseScope,
    environment: process.env,
  });
  const cmcAllowed = sourcePolicyIdIsEligibleForDataUse("coinmarketcap", {
    scope: dataUseScope,
    environment: process.env,
  });
  const failures = [];
  let freshSourceCount = 0;
  let cmcCurrentRefreshed = false;
  let cmcCurrentAvailable = false;
  const cmcCollectionRequested = process.env.CYCLELENS_COLLECT_CMC === "true";
  const okxRefreshedAssets = new Set();
  let cmcState = invalidCmcProviderState("not_loaded");
  if (cmcAllowed) {
    if (dataUseScope === "owner_private") {
      cmcState = await readCmcProviderState();
      cmcCurrentAvailable = cmcCurrentIsAvailable(cmcState);
      cmcCurrentRefreshed = cmcCollectionRequested && cmcCurrentAvailable && cmcState.fresh;
      if (!cmcCollectionRequested && cmcState.fresh) cmcState = { ...cmcState, fresh: false };
      freshSourceCount += cmcCurrentRefreshed ? 1 : 0;
      if (!cmcState.valid) {
        failures.push(`CoinMarketCap provider state unavailable (${cmcState.reason}); last-known-good values preserved.`);
      } else if (!cmcState.fresh) {
        failures.push("CoinMarketCap provider state is last-known-good; this collector made no CMC request.");
      }
    } else {
      cmcState = invalidCmcProviderState("scope_denied");
      failures.push("Owner-private CoinMarketCap provider state is never read for a public-scope build.");
    }
  } else {
    cmcState = invalidCmcProviderState("scope_denied");
    failures.push("CoinMarketCap refresh denied by data-use scope; last-known-good values preserved.");
  }

  const assets = [];
  for (const asset of ASSETS) {
    const previous = existingAssets.get(asset.symbol) || {};
    let quote = null;
    if (okxAllowed) {
      try {
        quote = await fetchOkxAsset(asset);
        if (quote) {
          freshSourceCount += 1;
          okxRefreshedAssets.add(asset.symbol);
        }
      } catch (error) {
        failures.push(`${asset.symbol} OKX quote: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const marketCap = projectCmcMarketCap(asset, previous, cmcState);
    assets.push({
      symbol: asset.symbol,
      name: asset.name,
      nameZh: asset.nameZh,
      market: asset.market,
      quote: asset.quote,
      localQuote: asset.localQuote || null,
      price: quote?.price ?? previous.price ?? null,
      changePct: quote?.changePct ?? previous.changePct ?? null,
      changeBasis: quote?.changeBasis || previous.changeBasis || null,
      marketCapUsd: marketCap.marketCapUsd,
      marketCapStatus: marketCap.marketCapStatus,
      marketCapAsOf: marketCap.marketCapAsOf,
      asOf: quote?.asOf || marketCap.marketCapAsOf || previous.asOf || null,
      sourceKind: asset.sourceKind || "official_public",
      ...(asset.sessionEligibility ? { sessionEligibility: asset.sessionEligibility } : {}),
      sourceLabel: quote?.sourceLabel || previous.sourceLabel || asset.quality || "Source pending",
      marketCapSourceLabel: marketCap.marketCapSourceLabel,
      quality: asset.quality || asset.note || null,
      components: quote?.components || previous.components || null,
    });
  }
  const missingPrimaryQuotes = REQUIRED_MARKET_SESSION_ASSETS.filter(
    (symbol) => !okxRefreshedAssets.has(symbol),
  );
  const cmcStateMode = cmcState.mode || "missing";
  const cmcRequestedButUnavailable = cmcCollectionRequested
    && (!cmcCurrentAvailable || !CMC_PROVIDER_STATE_ACTIVE_MODES.has(cmcStateMode));
  if (process.env.CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE === "1"
    && (missingPrimaryQuotes.length || cmcRequestedButUnavailable)) {
    throw new Error("Required market-session primary data did not refresh; refusing to replace the owner release");
  }
  if (freshSourceCount === 0) {
    throw new Error("No reviewed market-session provider refreshed; refusing to replace the owner release");
  }

  const fetchedAt = isoNow();
  const transformedAt = isoNow();
  const observedAt = latestIso(assets.flatMap((asset) => [asset.asOf, asset.marketCapAsOf]));
  return {
    version: 2,
    page: "market-clock",
    dataUseScope,
    generatedAt: transformedAt,
    timestamps: {
      observedAt,
      fetchedAt,
      transformedAt,
    },
    refreshCadence: "Target 10-15 minutes when a backend scheduler is available; static hosts may refresh less frequently.",
    methodology: "The frontend reads only this generated JSON. OKX public tickers provide crypto, equity-swap proxy, and CL index proxy prices. CoinMarketCap market caps are consumed only from a bounded owner-private normalized provider-state file; this collector has no CMC credential or CMC network path. The backend expands reviewed NYSE, KRX, SSE, and SZSE calendars and trading rules into absolute status intervals with holiday, early-close, weekend, and next-transition boundaries; the frontend only selects the current interval and renders its countdown.",
    failures,
    refreshSummary: {
      freshSourceCount,
      cmcCollectionRequested,
      cmcCurrentAvailable,
      cmcCurrentRefreshed,
      cmcStateMode,
      requiredAssets: REQUIRED_MARKET_SESSION_ASSETS,
      okxRefreshedAssets: [...okxRefreshedAssets].sort(),
    },
    markets: attachOfficialCalendars(MARKETS, transformedAt),
    assets,
    sources: {
      okx: "https://www.okx.com/docs-v5/en/",
      cmc: "https://coinmarketcap.com/api/documentation/v1/",
      nyseCalendar: "https://www.nyse.com/trade/hours-calendars",
      krxCalendar: "https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp",
      sseCalendar: "https://www.sse.com.cn/disclosure/dealinstruc/closed/",
      sseTradingRules: "https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20260424_10816482.shtml",
      szseTradingRules: "https://www.szse.cn/lawrules/rule/allrules/bussiness/t20260424_620190.html",
      note: "No provider credentials are read by this collector or emitted to the frontend cache.",
    },
  };
}

async function buildCalendarOnlyOutput() {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  const transformedAt = isoNow();
  const observedAt = latestIso((existing.assets || []).flatMap((asset) => [asset.asOf, asset.marketCapAsOf]));
  const assetDefinitions = new Map(ASSETS.map((asset) => [asset.symbol, asset]));
  const assets = (existing.assets || []).map((asset) => {
    const sessionEligibility = assetDefinitions.get(asset.symbol)?.sessionEligibility;
    return sessionEligibility ? { ...asset, sessionEligibility } : asset;
  });
  return {
    ...existing,
    version: 2,
    generatedAt: transformedAt,
    timestamps: {
      observedAt: existing.timestamps?.observedAt || observedAt,
      fetchedAt: existing.timestamps?.fetchedAt || existing.generatedAt || null,
      transformedAt,
    },
    methodology: "The frontend reads only this generated JSON. Market sessions are expanded by the backend from reviewed NYSE, KRX, SSE, and SZSE calendars and trading rules into absolute status intervals with holiday, early-close, weekend, and next-transition boundaries; the frontend only renders the current interval and countdown.",
    markets: attachOfficialCalendars(MARKETS, transformedAt),
    assets,
    sources: {
      ...(existing.sources || {}),
      nyseCalendar: "https://www.nyse.com/trade/hours-calendars",
      krxCalendar: "https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp",
      sseCalendar: "https://www.sse.com.cn/disclosure/dealinstruc/closed/",
      sseTradingRules: "https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20260424_10816482.shtml",
      szseTradingRules: "https://www.szse.cn/lawrules/rule/allrules/bussiness/t20260424_620190.html",
    },
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const output = process.argv.includes("--calendar-only") ? await buildCalendarOnlyOutput() : await buildOutput();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    status: "updated",
    outputPath,
    assets: output.assets.length,
    failures: output.failures?.length || 0,
  }));
}

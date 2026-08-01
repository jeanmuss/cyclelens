import { resolve } from "node:path";

export const CMC_PROVIDER_STATE_VERSION = 1;
export const CMC_PROVIDER_ID = "coinmarketcap";
export const CMC_CURRENT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const CMC_HISTORY_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
export const CMC_PROVIDER_STATE_MAX_BYTES = 4 * 1024 * 1024;
export const CMC_HISTORY_DAYS = 400;
export const CMC_INITIAL_HISTORY_DAYS = 365;
export const CMC_MINIMUM_HISTORY_DAYS = 183;
export const CMC_HISTORY_OVERLAP_DAYS = 14;

export const CMC_PROVIDER_ASSETS = Object.freeze({
  BTC: Object.freeze({ id: 1, symbol: "BTC" }),
  ETH: Object.freeze({ id: 1027, symbol: "ETH" }),
  USDT: Object.freeze({ id: 825, symbol: "USDT" }),
  USDC: Object.freeze({ id: 3408, symbol: "USDC" }),
  HYPE: Object.freeze({ id: 32196, symbol: "HYPE" }),
  BNB: Object.freeze({ id: 1839, symbol: "BNB" }),
});

export const CMC_HISTORY_METRIC_IDS = Object.freeze([
  "crypto.totalMarketCap",
  "btc.marketCap",
  "stablecoin.usdt.marketCap",
  "stablecoin.usdc.marketCap",
  "stablecoin.major.marketCap",
  "stablecoin.usdt.depegBps",
]);

const CMC_SOURCE_URL = "https://coinmarketcap.com/api/documentation/pro-api-reference/";
const CMC_GLOBAL_HISTORY_SOURCE_URL = "https://coinmarketcap.com/api/documentation/pro-api-reference/global-metrics";
const CMC_ASSET_HISTORY_SOURCE_URL = "https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency";
const CMC_HISTORY_SOURCE_URLS = new Set([
  CMC_SOURCE_URL,
  CMC_GLOBAL_HISTORY_SOURCE_URL,
  CMC_ASSET_HISTORY_SOURCE_URL,
]);
const CMC_HISTORY_QUALITY_VALUES = new Set([
  "available",
  "provider_reported",
  "derived_same_date_sum",
  "derived_from_provider_price",
  "database_last_known_good",
]);
const REFRESH_MODES = new Set([
  "refreshed",
  "disabled",
  "cadence_guard",
  "budget_guard",
  "provider_failed_lkg",
  "hydrated",
]);
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export class CmcProviderStateError extends Error {
  constructor(code) {
    super(code);
    this.name = "CmcProviderStateError";
    this.code = code;
  }
}

function fail(code) {
  throw new CmcProviderStateError(code);
}

function plainObject(value, code = "cmc_state_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function finite(value, code = "cmc_state_invalid") {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code);
  return number;
}

function nonNegative(value, code = "cmc_state_invalid") {
  const number = finite(value, code);
  if (number < 0) fail(code);
  return number;
}

function positive(value, code = "cmc_state_invalid") {
  const number = finite(value, code);
  if (number <= 0) fail(code);
  return number;
}

function nullableFinite(value, code = "cmc_state_invalid") {
  return value == null ? null : finite(value, code);
}

function nullableNonNegative(value, code = "cmc_state_invalid") {
  return value == null ? null : nonNegative(value, code);
}

function safeInteger(value, { minimum = 0, code = "cmc_state_invalid" } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) fail(code);
  return number;
}

function timestamp(value, { nullable = false, now = null, code = "cmc_state_invalid" } = {}) {
  if (value == null || value === "") {
    if (nullable) return null;
    fail(code);
  }
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) fail(code);
  const nowTime = now == null ? null : new Date(now).getTime();
  if (Number.isFinite(nowTime) && time > nowTime + FUTURE_SKEW_MS) fail(code);
  return new Date(time).toISOString();
}

function dateKey(value, code = "cmc_state_invalid") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) fail(code);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail(code);
  return value;
}

function canonicalUtcDay(now) {
  const value = new Date(now);
  if (!Number.isFinite(value.getTime())) fail("cmc_time_invalid");
  return value.toISOString().slice(0, 10);
}

function canonicalUtcMonth(now) {
  return canonicalUtcDay(now).slice(0, 7);
}

function latestTimestamp(values) {
  const valid = values
    .map((value) => Date.parse(String(value || "")))
    .filter(Number.isFinite);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}

function earliestTimestamp(values) {
  const valid = values
    .map((value) => Date.parse(String(value || "")))
    .filter(Number.isFinite);
  return valid.length ? new Date(Math.min(...valid)).toISOString() : null;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function cmcProviderStatePath(workspaceRoot) {
  if (!String(workspaceRoot || "").trim()) fail("cmc_workspace_root_required");
  return resolve(workspaceRoot, "tmp", "owner-private", "provider-state", "coinmarketcap.json");
}

function normalizeAsset(value, expected, now) {
  const asset = plainObject(value);
  const id = safeInteger(asset.id, { minimum: 1 });
  const symbol = String(asset.symbol || "").trim().toUpperCase();
  if (id !== expected.id || symbol !== expected.symbol) fail("cmc_state_asset_invalid");
  return {
    id,
    symbol,
    priceUsd: positive(asset.priceUsd),
    marketCapUsd: nonNegative(asset.marketCapUsd),
    percentChange24h: nullableFinite(asset.percentChange24h),
    observedAt: timestamp(asset.observedAt, { now }),
  };
}

function normalizeCurrent(value, now) {
  const current = plainObject(value);
  const global = plainObject(current.global);
  const assets = plainObject(current.assets);
  const assetKeys = Object.keys(assets).sort();
  const expectedKeys = Object.keys(CMC_PROVIDER_ASSETS).sort();
  if (assetKeys.length !== expectedKeys.length
    || assetKeys.some((key, index) => key !== expectedKeys[index])) {
    fail("cmc_state_assets_incomplete");
  }
  return {
    fetchedAt: timestamp(current.fetchedAt, { now }),
    global: {
      totalMarketCapUsd: nonNegative(global.totalMarketCapUsd),
      totalMarketCapYesterdayUsd: nullableNonNegative(global.totalMarketCapYesterdayUsd),
      totalMarketCapChangePct24h: nullableFinite(global.totalMarketCapChangePct24h),
      observedAt: timestamp(global.observedAt, { now }),
    },
    assets: Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => [
      symbol,
      normalizeAsset(assets[symbol], definition, now),
    ])),
  };
}

function normalizeHistoryPoint(value, now, metricId) {
  const point = plainObject(value);
  const observedAt = timestamp(point.observedAt || `${point.date}T00:00:00Z`, { now });
  const date = dateKey(point.date || observedAt.slice(0, 10));
  if (observedAt.slice(0, 10) !== date) fail("cmc_state_history_invalid");
  const fetchedAt = timestamp(point.fetchedAt, { nullable: true, now });
  const lastCheckedAt = timestamp(point.lastCheckedAt || fetchedAt, { nullable: true, now });
  const candidateSourceUrl = String(point.sourceUrl || "");
  const candidateQuality = String(point.qualityStatus || "");
  return {
    date,
    value: metricId === "stablecoin.usdt.depegBps"
      ? finite(point.value, "cmc_state_history_invalid")
      : nonNegative(point.value, "cmc_state_history_invalid"),
    observedAt,
    source: "cmc",
    sourceUrl: CMC_HISTORY_SOURCE_URLS.has(candidateSourceUrl) ? candidateSourceUrl : CMC_SOURCE_URL,
    sourceKey: "cmc",
    fetchedAt,
    lastCheckedAt,
    qualityStatus: CMC_HISTORY_QUALITY_VALUES.has(candidateQuality) ? candidateQuality : "provider_reported",
  };
}

function normalizeHistory(value, now) {
  const history = plainObject(value);
  for (const metricId of Object.keys(history)) {
    if (!CMC_HISTORY_METRIC_IDS.includes(metricId)) fail("cmc_state_history_metric_invalid");
  }
  return Object.fromEntries(Object.entries(history).map(([metricId, points]) => {
    if (!Array.isArray(points)) fail("cmc_state_history_invalid");
    const byDate = new Map();
    for (const point of points) {
      const normalized = normalizeHistoryPoint(point, now, metricId);
      byDate.set(normalized.date, normalized);
    }
    return [metricId, [...byDate.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-CMC_HISTORY_DAYS)];
  }));
}

function normalizeWatermarks(value, now) {
  const watermarks = plainObject(value);
  return {
    lastAttemptedAt: timestamp(watermarks.lastAttemptedAt, { nullable: true, now }),
    lastSuccessfulAt: timestamp(watermarks.lastSuccessfulAt, { nullable: true, now }),
    lastHistoryAttemptedAt: timestamp(watermarks.lastHistoryAttemptedAt, { nullable: true, now }),
    lastHistorySuccessfulAt: timestamp(watermarks.lastHistorySuccessfulAt, { nullable: true, now }),
  };
}

function normalizeBudget(value) {
  const budget = plainObject(value);
  const utcDay = dateKey(budget.utcDay, "cmc_state_budget_invalid");
  const utcMonth = String(budget.utcMonth || "");
  if (!/^\d{4}-\d{2}$/.test(utcMonth) || utcDay.slice(0, 7) !== utcMonth) {
    fail("cmc_state_budget_invalid");
  }
  const dailyCreditBudget = safeInteger(budget.dailyCreditBudget, { minimum: 1, code: "cmc_state_budget_invalid" });
  const monthlyCreditBudget = safeInteger(budget.monthlyCreditBudget, { minimum: 1, code: "cmc_state_budget_invalid" });
  if (dailyCreditBudget > monthlyCreditBudget) fail("cmc_state_budget_invalid");
  return {
    utcDay,
    utcMonth,
    dailyCreditBudget,
    monthlyCreditBudget,
    dailyCreditsReserved: safeInteger(budget.dailyCreditsReserved, { code: "cmc_state_budget_invalid" }),
    monthlyCreditsReserved: safeInteger(budget.monthlyCreditsReserved, { code: "cmc_state_budget_invalid" }),
  };
}

function normalizeRefresh(value) {
  const refresh = plainObject(value);
  const mode = String(refresh.mode || "");
  if (!REFRESH_MODES.has(mode)) fail("cmc_state_refresh_invalid");
  return {
    mode,
    networkRequests: safeInteger(refresh.networkRequests, { code: "cmc_state_refresh_invalid" }),
    creditCount: safeInteger(refresh.creditCount, { code: "cmc_state_refresh_invalid" }),
    currentRefreshed: refresh.currentRefreshed === true,
    historyRefreshed: refresh.historyRefreshed === true,
  };
}

export function validateCmcProviderState(value, { now = new Date(), maxBytes = CMC_PROVIDER_STATE_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("cmc_state_size_limit_invalid");
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("cmc_state_invalid");
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) fail("cmc_state_too_large");
  const state = plainObject(value);
  if (state.version !== CMC_PROVIDER_STATE_VERSION
    || state.provider !== CMC_PROVIDER_ID
    || state.dataUseScope !== "owner_private") {
    fail("cmc_state_identity_invalid");
  }
  const refresh = normalizeRefresh(state.refresh);
  if (state.current == null && refresh.mode !== "disabled") fail("cmc_state_current_required");
  return {
    version: CMC_PROVIDER_STATE_VERSION,
    provider: CMC_PROVIDER_ID,
    dataUseScope: "owner_private",
    updatedAt: timestamp(state.updatedAt, { now }),
    current: state.current == null ? null : normalizeCurrent(state.current, now),
    history: normalizeHistory(state.history || {}, now),
    watermarks: normalizeWatermarks(state.watermarks, now),
    budget: normalizeBudget(state.budget),
    refresh,
  };
}

export function parseRequiredCmcBudgets(environment = process.env) {
  const dailyCreditBudget = safeInteger(environment?.CYCLELENS_CMC_DAILY_CREDIT_BUDGET, {
    minimum: 1,
    code: "cmc_budget_required",
  });
  const monthlyCreditBudget = safeInteger(environment?.CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET, {
    minimum: 1,
    code: "cmc_budget_required",
  });
  if (dailyCreditBudget > monthlyCreditBudget) fail("cmc_budget_invalid");
  return { dailyCreditBudget, monthlyCreditBudget };
}

export function parseCurrentIntervalMs(environment = process.env) {
  const raw = environment?.CYCLELENS_CMC_CURRENT_MIN_INTERVAL_MINUTES;
  if (raw == null || raw === "") return CMC_CURRENT_MIN_INTERVAL_MS;
  return safeInteger(raw, { minimum: 1, code: "cmc_current_interval_invalid" }) * 60 * 1000;
}

export function budgetForNow({ budgets, ledger = {}, now = new Date() }) {
  const utcDay = canonicalUtcDay(now);
  const utcMonth = canonicalUtcMonth(now);
  const dailyCreditBudget = safeInteger(budgets?.dailyCreditBudget, { minimum: 1, code: "cmc_budget_invalid" });
  const monthlyCreditBudget = safeInteger(budgets?.monthlyCreditBudget, { minimum: 1, code: "cmc_budget_invalid" });
  if (dailyCreditBudget > monthlyCreditBudget) fail("cmc_budget_invalid");
  return {
    utcDay,
    utcMonth,
    dailyCreditBudget,
    monthlyCreditBudget,
    dailyCreditsReserved: safeInteger(ledger?.dailyCreditsReserved || 0, { code: "cmc_budget_invalid" }),
    monthlyCreditsReserved: safeInteger(ledger?.monthlyCreditsReserved || 0, { code: "cmc_budget_invalid" }),
  };
}

function isDue(value, intervalMs, now) {
  const previous = Date.parse(String(value || ""));
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(nowTime)) fail("cmc_time_invalid");
  return !Number.isFinite(previous) || nowTime - previous >= intervalMs;
}

function addUtcDays(value, days) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function totalMarketCapHistoryCoverage(history, now) {
  const completedDay = addUtcDays(canonicalUtcDay(now), -1);
  const datesFor = (metricId) => [...new Set((Array.isArray(history?.[metricId])
    ? history[metricId]
    : [])
    .map((point) => String(point?.date || ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= completedDay)
    .sort())];
  const sortedByMetric = Object.fromEntries(
    CMC_HISTORY_METRIC_IDS.map((metricId) => [metricId, datesFor(metricId)]),
  );
  const sorted = sortedByMetric["crypto.totalMarketCap"];
  const initialStart = addUtcDays(completedDay, -(CMC_INITIAL_HISTORY_DAYS - 1));
  const hasMinimum = CMC_HISTORY_METRIC_IDS.every((metricId) => {
    const dates = sortedByMetric[metricId];
    return dates.length >= CMC_MINIMUM_HISTORY_DAYS && dates[0] <= initialStart;
  });
  return { completedDay, sorted, initialStart, hasMinimum };
}

export function hasMinimumCmcHistoryCoverage(history, now = new Date()) {
  return totalMarketCapHistoryCoverage(history, now).hasMinimum;
}

function historyWindow(history, now) {
  const {
    completedDay,
    sorted,
    initialStart,
    hasMinimum,
  } = totalMarketCapHistoryCoverage(history, now);
  const overlapStart = sorted.length ? addUtcDays(sorted.at(-1), -CMC_HISTORY_OVERLAP_DAYS) : null;
  const start = hasMinimum && overlapStart > initialStart ? overlapStart : initialStart;
  const days = Math.floor((Date.parse(`${completedDay}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  return {
    mode: hasMinimum ? "overlap" : "initial_backfill",
    timeStart: `${start}T00:00:00.000Z`,
    timeEnd: `${completedDay}T00:00:00.000Z`,
    days,
  };
}

function currentRequests() {
  const ids = Object.values(CMC_PROVIDER_ASSETS).map((asset) => asset.id).join(",");
  return [
    {
      id: "current_global",
      kind: "current_global",
      url: "https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest?convert=USD",
      reservedCredits: 1,
    },
    {
      id: "current_assets",
      kind: "current_assets",
      url: `https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?id=${ids}&convert=USD`,
      reservedCredits: 1,
    },
  ];
}

function historyRequests(history, now) {
  const window = historyWindow(history, now);
  const common = new URLSearchParams({
    time_start: window.timeStart,
    time_end: window.timeEnd,
    interval: "daily",
    convert: "USD",
  });
  const globalQuery = new URLSearchParams(common);
  globalQuery.set("aux", "search_interval");
  const assetQuery = new URLSearchParams(common);
  assetQuery.set("id", "1,825,3408");
  assetQuery.set("aux", "price,market_cap,quote_timestamp,search_interval");
  assetQuery.set("skip_invalid", "false");
  return {
    window,
    requests: [
      {
        id: "history_global",
        kind: "history_global",
        url: `https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/historical?${globalQuery}`,
        reservedCredits: Math.max(1, Math.ceil(window.days / 100)),
      },
      {
        id: "history_assets",
        kind: "history_assets",
        url: `https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical?${assetQuery}`,
        reservedCredits: Math.max(1, Math.ceil((window.days * 3) / 100)),
      },
    ],
  };
}

export function planCmcProviderRefresh({
  state = null,
  hydratedHistory = {},
  restoredWatermarks = {},
  budget,
  now = new Date(),
  currentIntervalMs = CMC_CURRENT_MIN_INTERVAL_MS,
} = {}) {
  if (!Number.isSafeInteger(currentIntervalMs) || currentIntervalMs < 60_000) {
    fail("cmc_current_interval_invalid");
  }
  const history = state?.history || hydratedHistory || {};
  const watermarks = {
    ...(restoredWatermarks || {}),
    ...(state?.watermarks || {}),
  };
  const currentDue = !state?.current || isDue(watermarks.lastAttemptedAt, currentIntervalMs, now);
  const historyDue = isDue(watermarks.lastHistoryAttemptedAt, CMC_HISTORY_MIN_INTERVAL_MS, now);
  const dailyAvailable = budget.dailyCreditBudget - budget.dailyCreditsReserved;
  const monthlyAvailable = budget.monthlyCreditBudget - budget.monthlyCreditsReserved;
  let available = Math.max(0, Math.min(dailyAvailable, monthlyAvailable));
  const requests = [];
  let currentGuarded = false;
  let historyGuarded = false;
  if (currentDue) {
    const candidates = currentRequests();
    const required = candidates.reduce((sum, request) => sum + request.reservedCredits, 0);
    if (required <= available) {
      requests.push(...candidates);
      available -= required;
    } else {
      currentGuarded = true;
    }
  }
  let historyPlan = null;
  if (historyDue && !currentGuarded) {
    historyPlan = historyRequests(history, now);
    const required = historyPlan.requests.reduce((sum, request) => sum + request.reservedCredits, 0);
    if (required <= available) {
      requests.push(...historyPlan.requests);
      available -= required;
    } else {
      historyGuarded = true;
    }
  }
  return {
    currentDue,
    historyDue,
    currentGuarded,
    historyGuarded,
    historyWindow: historyPlan?.window || null,
    requests,
    reservedCredits: requests.reduce((sum, request) => sum + request.reservedCredits, 0),
  };
}

function usdQuote(row) {
  const quote = row?.quote;
  if (Array.isArray(quote)) return quote.find((item) => item?.symbol === "USD") || quote[0] || {};
  return quote?.USD || {};
}

function payloadAsset(payload, definition) {
  const data = payload?.data;
  let row = Array.isArray(data)
    ? data.find((item) => Number(item?.id) === definition.id)
    : data?.[definition.id] ?? data?.[String(definition.id)];
  if (Array.isArray(row)) row = row.find((item) => Number(item?.id) === definition.id) || row[0];
  return row || null;
}

export function creditCountFromCmcPayload(payload) {
  const value = payload?.status?.credit_count;
  if (typeof value !== "number") fail("cmc_credit_count_invalid");
  if (!Number.isSafeInteger(value) || value < 0) fail("cmc_credit_count_invalid");
  return value;
}

export function normalizeCmcCurrentPayloads(globalPayload, assetsPayload, fetchedAt = new Date()) {
  const globalQuote = globalPayload?.data?.quote?.USD || {};
  const totalMarketCapUsd = nonNegative(globalQuote.total_market_cap, "cmc_current_incomplete");
  const normalizedAssets = Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => {
    const row = payloadAsset(assetsPayload, definition);
    const quote = usdQuote(row);
    if (Number(row?.id) !== definition.id || String(row?.symbol || "").toUpperCase() !== symbol) {
      fail("cmc_current_incomplete");
    }
    return [symbol, {
      id: definition.id,
      symbol,
      priceUsd: positive(quote.price, "cmc_current_incomplete"),
      marketCapUsd: nonNegative(quote.market_cap, "cmc_current_incomplete"),
      percentChange24h: nullableFinite(quote.percent_change_24h, "cmc_current_incomplete"),
      observedAt: timestamp(quote.last_updated || row?.last_updated || assetsPayload?.status?.timestamp, {
        now: fetchedAt,
        code: "cmc_current_incomplete",
      }),
    }];
  }));
  return {
    fetchedAt: timestamp(fetchedAt, { now: fetchedAt }),
    global: {
      totalMarketCapUsd,
      totalMarketCapYesterdayUsd: nullableNonNegative(
        globalQuote.total_market_cap_yesterday,
        "cmc_current_incomplete",
      ),
      totalMarketCapChangePct24h: nullableFinite(
        globalQuote.total_market_cap_yesterday_percentage_change,
        "cmc_current_incomplete",
      ),
      observedAt: timestamp(globalQuote.last_updated || globalPayload?.status?.timestamp, {
        now: fetchedAt,
        code: "cmc_current_incomplete",
      }),
    },
    assets: normalizedAssets,
  };
}

function historyPoint(observedAtValue, value, fetchedAt, sourceUrl, qualityStatus) {
  const observedAt = timestamp(observedAtValue, { now: fetchedAt, code: "cmc_history_invalid" });
  return {
    date: observedAt.slice(0, 10),
    value: finite(value, "cmc_history_invalid"),
    observedAt,
    source: "cmc",
    sourceUrl,
    sourceKey: "cmc",
    fetchedAt: timestamp(fetchedAt, { now: fetchedAt }),
    lastCheckedAt: timestamp(fetchedAt, { now: fetchedAt }),
    qualityStatus,
  };
}

function historicalAsset(payload, id) {
  const data = payload?.data;
  if (Array.isArray(data)) return data.find((item) => Number(item?.id) === id) || null;
  return data?.[id] ?? data?.[String(id)] ?? null;
}

function derivedMajorHistory(usdt, usdc, fetchedAt) {
  const usdcByDate = new Map((usdc || []).map((point) => [point.date, point]));
  return (usdt || []).flatMap((point) => {
    const counterpart = usdcByDate.get(point.date);
    if (!counterpart) return [];
    return [historyPoint(
      earliestTimestamp([point.observedAt, counterpart.observedAt]),
      point.value + counterpart.value,
      fetchedAt,
      CMC_ASSET_HISTORY_SOURCE_URL,
      "derived_same_date_sum",
    )];
  });
}

export function normalizeCmcHistoryPayloads(globalPayload, assetsPayload, fetchedAt = new Date()) {
  const fetched = timestamp(fetchedAt, { now: fetchedAt });
  const globalRows = Array.isArray(globalPayload?.data?.quotes) ? globalPayload.data.quotes : [];
  const total = globalRows.map((row) => {
    const quote = usdQuote(row);
    return historyPoint(
      row?.timestamp || quote?.timestamp || quote?.last_updated,
      quote.total_market_cap,
      fetched,
      CMC_GLOBAL_HISTORY_SOURCE_URL,
      "provider_reported",
    );
  });
  const definitions = [
    [1, "btc.marketCap"],
    [825, "stablecoin.usdt.marketCap"],
    [3408, "stablecoin.usdc.marketCap"],
  ];
  const output = { "crypto.totalMarketCap": total };
  for (const [id, metricId] of definitions) {
    const asset = historicalAsset(assetsPayload, id);
    const rows = Array.isArray(asset?.quotes) ? asset.quotes : [];
    output[metricId] = rows.map((row) => {
      const quote = usdQuote(row);
      return historyPoint(
        row?.timestamp || quote?.timestamp || quote?.last_updated,
        quote.market_cap,
        fetched,
        CMC_ASSET_HISTORY_SOURCE_URL,
        "provider_reported",
      );
    });
  }
  const usdtAsset = historicalAsset(assetsPayload, 825);
  output["stablecoin.usdt.depegBps"] = (Array.isArray(usdtAsset?.quotes) ? usdtAsset.quotes : []).map((row) => {
    const quote = usdQuote(row);
    const price = positive(quote.price, "cmc_history_invalid");
    return historyPoint(
      row?.timestamp || quote?.timestamp || quote?.last_updated,
      (price - 1) * 10_000,
      fetched,
      CMC_ASSET_HISTORY_SOURCE_URL,
      "derived_from_provider_price",
    );
  });
  output["stablecoin.major.marketCap"] = derivedMajorHistory(
    output["stablecoin.usdt.marketCap"],
    output["stablecoin.usdc.marketCap"],
    fetched,
  );
  for (const metricId of [
    "crypto.totalMarketCap",
    "btc.marketCap",
    "stablecoin.usdt.marketCap",
    "stablecoin.usdc.marketCap",
  ]) {
    if (!output[metricId]?.length) fail("cmc_history_incomplete");
  }
  return normalizeHistory(output, fetchedAt);
}

export function mergeCmcHistory(...histories) {
  const output = {};
  for (const history of histories) {
    for (const [metricId, points] of Object.entries(history || {})) {
      if (!CMC_HISTORY_METRIC_IDS.includes(metricId) || !Array.isArray(points)) continue;
      const byDate = new Map((output[metricId] || []).map((point) => [point.date, point]));
      for (const point of points) {
        const candidate = normalizeHistoryPoint(point, new Date(), metricId);
        const prior = byDate.get(candidate.date);
        if (!prior || Date.parse(candidate.fetchedAt || 0) >= Date.parse(prior.fetchedAt || 0)) {
          byDate.set(candidate.date, candidate);
        }
      }
      output[metricId] = [...byDate.values()]
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(-CMC_HISTORY_DAYS);
    }
  }
  return output;
}

export function historyFromMarketMetricRows(rows, now = new Date()) {
  const output = {};
  for (const row of rows || []) {
    const metricId = String(row?.metric_id || "");
    if (!CMC_HISTORY_METRIC_IDS.includes(metricId)) continue;
    if (!/^cmc$/i.test(String(row?.source_key || row?.source || ""))) continue;
    let point;
    try {
      point = normalizeHistoryPoint({
        date: String(row.observed_at || "").slice(0, 10),
        value: row.value,
        observedAt: row.metadata?.sourceObservedAt || row.observed_at,
        source: "cmc",
        sourceUrl: row.source_url || CMC_SOURCE_URL,
        fetchedAt: row.fetched_at,
        lastCheckedAt: row.last_checked_at || row.fetched_at,
        qualityStatus: row.quality_status || "database_last_known_good",
      }, now, metricId);
    } catch {
      // Database rows are untrusted input; one malformed point must not discard the remaining LKG.
      continue;
    }
    (output[metricId] ||= []).push(point);
  }
  return normalizeHistory(output, now);
}

export function mergeCmcProviderStates(left, right, { now = new Date() } = {}) {
  if (!left) return right ? validateCmcProviderState(right, { now }) : null;
  if (!right) return validateCmcProviderState(left, { now });
  const first = validateCmcProviderState(left, { now });
  const second = validateCmcProviderState(right, { now });
  const current = !first.current
    ? second.current
    : !second.current
      ? first.current
      : Date.parse(second.current.fetchedAt) >= Date.parse(first.current.fetchedAt)
        ? second.current
        : first.current;
  const latestState = Date.parse(second.updatedAt) >= Date.parse(first.updatedAt) ? second : first;
  const max = (key) => latestTimestamp([first.watermarks[key], second.watermarks[key]]);
  return validateCmcProviderState({
    ...latestState,
    updatedAt: latestTimestamp([first.updatedAt, second.updatedAt]),
    current,
    history: mergeCmcHistory(first.history, second.history),
    watermarks: {
      lastAttemptedAt: max("lastAttemptedAt"),
      lastSuccessfulAt: max("lastSuccessfulAt"),
      lastHistoryAttemptedAt: max("lastHistoryAttemptedAt"),
      lastHistorySuccessfulAt: max("lastHistorySuccessfulAt"),
    },
  }, { now });
}

export function cmcLiquidityFromProviderState(state) {
  const normalized = validateCmcProviderState(state, { now: new Date() });
  const { current } = normalized;
  if (!current) {
    return {
      metrics: [],
      spotPrices: {},
      history: clone(normalized.history),
      historyRefresh: {
        lastAttemptedAt: normalized.watermarks.lastHistoryAttemptedAt,
        lastSuccessfulAt: normalized.watermarks.lastHistorySuccessfulAt,
        initialBackfillDays: CMC_INITIAL_HISTORY_DAYS,
        minimumBackfillDays: CMC_MINIMUM_HISTORY_DAYS,
        overlapDays: CMC_HISTORY_OVERLAP_DAYS,
        refreshCadenceHours: CMC_HISTORY_MIN_INTERVAL_MS / (60 * 60 * 1000),
        providers: {
          cmcGlobal: { status: "disabled" },
          cmcAssets: { status: "disabled" },
        },
      },
      currentRefreshed: false,
      currentAvailable: false,
      refreshMode: normalized.refresh.mode,
    };
  }
  const { BTC, ETH, USDT, USDC } = current.assets;
  const fetchedAt = current.fetchedAt;
  const metric = (id, label, labelZh, value, unit, observedAt, extra = {}) => ({
    id,
    label,
    labelZh,
    value,
    unit,
    observedAt,
    source: "cmc",
    sourceUrl: CMC_SOURCE_URL,
    sourceKey: "cmc",
    fetchedAt,
    lastCheckedAt: fetchedAt,
    qualityStatus: "available",
    ...extra,
  });
  const stableObservedAt = earliestTimestamp([USDT.observedAt, USDC.observedAt]);
  const metrics = [
    metric(
      "crypto.totalMarketCap",
      "Total crypto market cap",
      "加密市场总市值",
      current.global.totalMarketCapUsd,
      "USD",
      current.global.observedAt,
      {
        changePct24h: current.global.totalMarketCapChangePct24h,
        semantics: "market_cap_change_not_net_flow",
      },
    ),
    metric("btc.marketCap", "Bitcoin market cap", "BTC 总市值", BTC.marketCapUsd, "USD", BTC.observedAt, {
      changePct24h: BTC.percentChange24h,
      semantics: "market_cap_change_not_net_flow",
    }),
    metric("stablecoin.usdt.marketCap", "USDT circulating market cap", "USDT 流通市值", USDT.marketCapUsd, "USD", USDT.observedAt, {
      changePct24h: USDT.percentChange24h,
      semantics: "circulating_supply_proxy",
    }),
    metric("stablecoin.usdc.marketCap", "USDC circulating market cap", "USDC 流通市值", USDC.marketCapUsd, "USD", USDC.observedAt, {
      changePct24h: USDC.percentChange24h,
      semantics: "circulating_supply_proxy",
    }),
    metric("stablecoin.major.marketCap", "USDT + USDC market cap", "主要稳定币市值", USDT.marketCapUsd + USDC.marketCapUsd, "USD", stableObservedAt, {
      coverage: ["USDT", "USDC"],
      semantics: "tracked_stablecoin_supply_not_total_market",
    }),
    metric("stablecoin.usdt.depegBps", "USDT peg deviation", "USDT 脱锚幅度", (USDT.priceUsd - 1) * 10_000, "bps", USDT.observedAt, {
      price: USDT.priceUsd,
      semantics: "price_deviation_not_flow",
    }),
  ];
  return {
    metrics,
    spotPrices: {
      BTC: { asset: "BTC", priceUsd: BTC.priceUsd, observedAt: BTC.observedAt, source: "cmc", fetchedAt },
      ETH: { asset: "ETH", priceUsd: ETH.priceUsd, observedAt: ETH.observedAt, source: "cmc", fetchedAt },
    },
    history: clone(normalized.history),
    historyRefresh: {
      lastAttemptedAt: normalized.watermarks.lastHistoryAttemptedAt,
      lastSuccessfulAt: normalized.watermarks.lastHistorySuccessfulAt,
      initialBackfillDays: CMC_INITIAL_HISTORY_DAYS,
      minimumBackfillDays: CMC_MINIMUM_HISTORY_DAYS,
      overlapDays: CMC_HISTORY_OVERLAP_DAYS,
      refreshCadenceHours: CMC_HISTORY_MIN_INTERVAL_MS / (60 * 60 * 1000),
      providers: {
        cmcGlobal: { status: normalized.refresh.historyRefreshed ? "available" : normalized.refresh.mode },
        cmcAssets: { status: normalized.refresh.historyRefreshed ? "available" : normalized.refresh.mode },
      },
    },
    currentRefreshed: normalized.refresh.currentRefreshed,
    currentAvailable: true,
    refreshMode: normalized.refresh.mode,
  };
}

export function makeCmcProviderState({
  previous = null,
  current,
  history = {},
  watermarks,
  budget,
  refresh,
  now = new Date(),
}) {
  return validateCmcProviderState({
    version: CMC_PROVIDER_STATE_VERSION,
    provider: CMC_PROVIDER_ID,
    dataUseScope: "owner_private",
    updatedAt: new Date(now).toISOString(),
    current: current || previous?.current,
    history: mergeCmcHistory(previous?.history, history),
    watermarks,
    budget,
    refresh,
  }, { now });
}

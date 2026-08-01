import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preferredEnvironmentValue, productUserAgent } from "../product.config.mjs";
import { sourcePolicyIdIsEligibleForDataUse } from "../src/domain/metrics/sourcePolicy.js";
import {
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
} from "./data-use-scope.mjs";
import {
  CMC_PROVIDER_STATE_MAX_BYTES,
  cmcLiquidityFromProviderState,
  cmcProviderStatePath,
  validateCmcProviderState,
} from "./cmc-provider-state-contract.mjs";
import {
  fetchJsonBounded,
  fetchTextBounded,
} from "./secure-fetch.mjs";

import {
  attachHistoricalMetricFallbacks,
  attachMetricChanges,
  attachTreasurySpotPrice,
  combineDefiLlamaStablecoinHistory,
  CRYPTO_LIQUIDITY_MINIMUM_BACKFILL_DAYS,
  CRYPTO_LIQUIDITY_VERSION,
  finiteNumber,
  hasFreshCmcStablecoinBackfill,
  mergeSosoEtfHistory,
  mergeHistoricalMetricSeries,
  mergeMetricHistory,
  mergeTreasurySnapshots,
  normalizeBlockbeatsBtcHistory,
  normalizeDefiLlamaStablecoinHistory,
  normalizeReviewedTreasuryDisclosure,
  normalizeSosoEtfHistory,
  requireSosoEtfHistory,
  shouldRefreshHistoryProvider,
  summarizeMetricHistory,
} from "./crypto-liquidity-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "..");
const dataUseScope = dataUseScopeFromEnvironment(process.env, process.argv);
const dataDirectory = dataDirectoryForScope(appRoot, dataUseScope);
const outputPath = resolve(dataDirectory, "crypto-liquidity.json");
const cmcStatePath = cmcProviderStatePath(workspaceRoot);
const treasuryDisclosuresPath = resolve(appRoot, "data", "corporate-treasury-disclosures.json");
const equityFastPath = resolve(dataDirectory, "equity-fast.json");
const marketSessionPath = resolve(dataDirectory, "market-session.json");
const DEFILLAMA_STABLECOIN_BASE_URL = "https://api.llama.fi";
const SOSO_BASE_URL = "https://openapi.sosovalue.com/openapi/v1";
const SOSO_ETF_URL = `${SOSO_BASE_URL}/etfs/summary-history`;
const BLOCKBEATS_URL = "https://api-pro.theblockbeats.info/v1/data/btc_etf";
const BITMINE_CIK = "0001829311";
const SEC_SUBMISSIONS_URL = `https://data.sec.gov/submissions/CIK${BITMINE_CIK}.json`;
const CRYPTO_LIQUIDITY_ALLOWED_ORIGINS = Object.freeze([
  "https://api.llama.fi",
  "https://openapi.sosovalue.com",
  "https://api-pro.theblockbeats.info",
  "https://data.sec.gov",
  "https://www.sec.gov",
]);
const DENIED_CONSUMER_ENV_KEYS = new Set(["CMC_PRO_API_KEY"]);

function isoNow() {
  return new Date().toISOString();
}

async function loadEnvFile(path) {
  let textValue;
  try {
    textValue = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of textValue.split(/\r?\n/)) {
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
}

function safeFailure(error) {
  let text = String(error?.message || error || "unknown error");
  for (const value of [process.env.SOSOVALUE_API_KEY, process.env.BLOCKBEATS_API_KEY, process.env.SEC_USER_AGENT]) {
    if (value) text = text.replaceAll(value, "<redacted>");
  }
  return text.slice(0, 500);
}

async function readCmcProviderSnapshot(now = new Date()) {
  const metadata = await lstat(cmcStatePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 2 || metadata.size > CMC_PROVIDER_STATE_MAX_BYTES) {
    throw new Error("CMC provider state has an invalid size");
  }
  const state = validateCmcProviderState(JSON.parse(await readFile(cmcStatePath, "utf8")), { now });
  return cmcLiquidityFromProviderState(state);
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  return fetchJsonBounded(url, {
    ...options,
    allowedOrigins: CRYPTO_LIQUIDITY_ALLOWED_ORIGINS,
    maxResponseBytes: 8 * 1024 * 1024,
    timeoutMs: 30_000,
    headers: {
      "User-Agent": productUserAgent("crypto-liquidity"),
      ...(options.headers || {}),
    },
  });
}

async function fetchText(url, options = {}) {
  return fetchTextBounded(url, {
    ...options,
    allowedOrigins: CRYPTO_LIQUIDITY_ALLOWED_ORIGINS,
    maxResponseBytes: 8 * 1024 * 1024,
    timeoutMs: 30_000,
    headers: {
      "User-Agent": productUserAgent("market-data"),
      ...(options.headers || {}),
    },
  });
}

async function fetchDefiLlamaStablecoinHistory() {
  const catalog = await fetchJson(`${DEFILLAMA_STABLECOIN_BASE_URL}/stablecoins?includePrices=false`);
  const assets = Array.isArray(catalog?.peggedAssets) ? catalog.peggedAssets : [];
  const selected = Object.fromEntries(["USDT", "USDC"].map((symbol) => {
    const matches = assets.filter((item) => String(item?.symbol || "").toUpperCase() === symbol && item?.pegType === "peggedUSD");
    if (matches.length !== 1 || !matches[0]?.id) {
      throw new Error(`DefiLlama stablecoin catalog did not resolve exactly one peggedUSD ${symbol} asset`);
    }
    return [symbol, matches[0]];
  }));
  const payloads = await Promise.all(["USDT", "USDC"].map(async (symbol) => {
    const payload = await fetchJson(`${DEFILLAMA_STABLECOIN_BASE_URL}/stablecoin/${encodeURIComponent(String(selected[symbol].id))}`);
    return [symbol, payload];
  }));
  const fetchedAt = isoNow();
  const normalized = payloads.map(([symbol, payload]) => normalizeDefiLlamaStablecoinHistory(payload, symbol, fetchedAt));
  const history = combineDefiLlamaStablecoinHistory(normalized, fetchedAt);
  return {
    history,
    fetchedAt,
    points: Object.fromEntries(Object.entries(history).map(([metricId, points]) => [metricId, points.length])),
    providerAssetIds: Object.fromEntries(Object.entries(selected).map(([symbol, item]) => [symbol, String(item.id)])),
  };
}

function unwrapSosoPayload(payload, label) {
  if (Array.isArray(payload)) return payload;
  if (Number(payload?.code) !== 0) throw new Error(`SoSoValue ${label} request failed`);
  if (!Array.isArray(payload?.data)) throw new Error(`SoSoValue ${label} returned an invalid data envelope`);
  return payload.data;
}

async function fetchSosoAsset(asset) {
  const key = process.env.SOSOVALUE_API_KEY;
  if (!key) throw new Error("SOSOVALUE_API_KEY is not configured");
  const query = new URLSearchParams({ symbol: asset, country_code: "US", limit: "300" });
  const payload = await fetchJson(`${SOSO_ETF_URL}?${query}`, {
    headers: { "x-soso-api-key": key },
  });
  const fetchedAt = isoNow();
  const result = requireSosoEtfHistory(normalizeSosoEtfHistory(unwrapSosoPayload(payload, `${asset} ETF`), asset), asset);
  return {
    ...result,
    fetchedAt,
    lastCheckedAt: fetchedAt,
    daily: result.daily.map((point) => ({ ...point, fetchedAt, lastCheckedAt: fetchedAt })),
  };
}

function plainText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;/gi, "$")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTH_INDEX = Object.fromEntries(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month, index) => [month, index]));

function nthSunday(year, monthIndex, ordinal) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  return 1 + ((7 - first.getUTCDay()) % 7) + (ordinal - 1) * 7;
}

function easternDisclosureTimestamp(dateText, timeText, meridiem) {
  const match = String(dateText).match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match || MONTH_INDEX[match[1]] == null) return null;
  const year = Number(match[3]);
  const month = MONTH_INDEX[match[1]];
  const day = Number(match[2]);
  let hour = 12;
  let minute = 0;
  const timeMatch = String(timeText || "").match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12;
    if (String(meridiem).toLowerCase() === "pm") hour += 12;
    minute = Number(timeMatch[2]);
  }
  const dstStart = { month: 2, day: nthSunday(year, 2, 2) };
  const dstEnd = { month: 10, day: nthSunday(year, 10, 1) };
  const afterStart = month > dstStart.month || (month === dstStart.month && day >= dstStart.day);
  const beforeEnd = month < dstEnd.month || (month === dstEnd.month && day < dstEnd.day);
  const offsetHours = afterStart && beforeEnd ? 4 : 5;
  return new Date(Date.UTC(year, month, day, hour + offsetHours, minute)).toISOString();
}

function parseBitmineHoldingsDisclosure(html, filingDate, sourceUrl) {
  const text = plainText(html);
  const match = text.match(/As of\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})(?:\s+at\s+(\d{1,2}:\d{2})(am|pm)\s+ET)?.{0,350}?holdings are comprised of\s+([\d,]+)\s+ETH/i);
  if (!match) return null;
  const holdings = finiteNumber(match[4].replaceAll(",", ""));
  const holdingsObservedAt = easternDisclosureTimestamp(match[1], match[2], match[3]);
  if (holdings == null || !holdingsObservedAt) return null;
  return {
    disclosedAt: filingDate,
    holdingsObservedAt,
    holdings,
    sourceUrl,
    qualityStatus: "official_sec_exhibit_automated",
  };
}

async function fetchBitmineSecHoldings() {
  const userAgent = String(process.env.SEC_USER_AGENT || "").trim();
  if (!userAgent) return { status: "reserved_missing_user_agent", holdings: [] };
  const submissions = await fetchJson(SEC_SUBMISSIONS_URL, { headers: { "User-Agent": userAgent } });
  const recent = submissions?.filings?.recent || {};
  const filings = (recent.form || []).map((form, index) => ({
    form,
    accession: recent.accessionNumber?.[index],
    filingDate: recent.filingDate?.[index],
  })).filter((filing) => filing.form === "8-K" && filing.accession && filing.filingDate).slice(0, 12);
  const holdings = [];
  for (const filing of filings) {
    const accession = filing.accession.replaceAll("-", "");
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/1829311/${accession}/ex99-1.htm`;
    try {
      const html = await fetchText(sourceUrl, { headers: { "User-Agent": userAgent } });
      const disclosure = parseBitmineHoldingsDisclosure(html, filing.filingDate, sourceUrl);
      if (disclosure) holdings.push(disclosure);
      if (holdings.length >= 4) break;
    } catch {
      // Many 8-Ks do not include an EX-99.1 treasury update; continue to the next filing.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  return { status: holdings.length ? "available" : "no_matching_disclosure", holdings };
}

async function fetchBlockbeatsAuxiliary() {
  const enabled = process.env.BLOCKBEATS_AUX_ENABLED === "1";
  const key = process.env.BLOCKBEATS_API_KEY;
  if (!enabled || !key) {
    return {
      enabled,
      configured: Boolean(key),
      status: enabled ? "reserved_missing_key" : "reserved_disabled",
      role: "auxiliary_cross_check_only",
      endpoint: "/v1/data/btc_etf",
      data: null,
    };
  }
  const payload = await fetchJson(BLOCKBEATS_URL, { headers: { "api-key": key } });
  return {
    enabled: true,
    configured: true,
    status: "available",
    role: "auxiliary_cross_check_only",
    endpoint: "/v1/data/btc_etf",
    data: normalizeBlockbeatsBtcHistory(payload),
  };
}

function localFallbackMetrics(equityFast, marketSession) {
  const fast = Object.fromEntries((equityFast?.metrics || []).map((item) => [item.id, item]));
  const assets = Object.fromEntries((marketSession?.assets || []).map((item) => [item.symbol, item]));
  const total = fast.CRYPTO_MARKET_CAP;
  const btc = fast.BTC_MARKET_CAP || assets.BTC;
  const usdt = assets.USDT;
  return [
    {
      id: "crypto.totalMarketCap", label: "Total crypto market cap", labelZh: "加密市场总市值",
      value: finiteNumber(total?.value), unit: "USD", observedAt: total?.asOf || null, source: "existing-static-cache",
      changePct24h: finiteNumber(total?.changePct), semantics: "market_cap_change_not_net_flow",
    },
    {
      id: "btc.marketCap", label: "Bitcoin market cap", labelZh: "BTC 总市值",
      value: finiteNumber(btc?.value ?? btc?.marketCapUsd), unit: "USD", observedAt: btc?.asOf || btc?.marketCapAsOf || null, source: "existing-static-cache",
      changePct24h: finiteNumber(btc?.changePct), semantics: "market_cap_change_not_net_flow",
    },
    {
      id: "stablecoin.usdt.marketCap", label: "USDT circulating market cap", labelZh: "USDT 流通市值",
      value: finiteNumber(usdt?.marketCapUsd), unit: "USD", observedAt: usdt?.marketCapAsOf || usdt?.asOf || null, source: "existing-static-cache",
      changePct24h: null, semantics: "circulating_supply_proxy",
    },
    {
      id: "stablecoin.usdc.marketCap", label: "USDC circulating market cap", labelZh: "USDC 流通市值",
      value: null, unit: "USD", observedAt: null, source: "pending-cmc-refresh", changePct24h: null,
      semantics: "circulating_supply_proxy",
    },
    {
      id: "stablecoin.major.marketCap", label: "USDT + USDC market cap", labelZh: "主流稳定币市值",
      value: null, unit: "USD", observedAt: null, source: "pending-cmc-refresh", coverage: ["USDT", "USDC"],
      semantics: "tracked_stablecoin_supply_not_total_market",
    },
    {
      id: "stablecoin.usdt.depegBps", label: "USDT peg deviation", labelZh: "USDT 脱锚幅度",
      value: finiteNumber(usdt?.price) == null ? null : (finiteNumber(usdt.price) - 1) * 10_000,
      unit: "bps", observedAt: usdt?.asOf || null, source: "existing-static-cache", price: finiteNumber(usdt?.price),
      semantics: "price_deviation_not_flow",
    },
  ];
}

function oldest(values) {
  return values.filter(Boolean).sort()[0] || null;
}

async function writeJsonAtomic(path, payload) {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

for (const key of DENIED_CONSUMER_ENV_KEYS) delete process.env[key];
if (preferredEnvironmentValue(process.env, "CYCLELENS_SKIP_LOCAL_ENV", "CYCLE_MAP_SKIP_LOCAL_ENV") !== "1") {
  await loadEnvFile(resolve(appRoot, ".env.local"));
  await loadEnvFile(resolve(workspaceRoot, ".env.local"));
}

const providerAllowed = (sourcePolicyId) => sourcePolicyIdIsEligibleForDataUse(sourcePolicyId, {
  scope: dataUseScope,
  environment: process.env,
});
const cmcAllowed = dataUseScope === "owner_private" && providerAllowed("coinmarketcap");
const defillamaAllowed = providerAllowed("defillama");
const sosoAllowed = providerAllowed("sosovalue");
const secAllowed = providerAllowed("sec-edgar");
const blockbeatsAllowed = providerAllowed("blockbeats");
const cmcCollectionRequested = ["1", "true"].includes(String(process.env.CYCLELENS_COLLECT_CMC || "").trim().toLowerCase());
const existing = await readJson(outputPath, null);
const failures = [];
let freshSourceCount = 0;
let cmcCurrentRefreshed = false;
let cmcCurrentAvailable = false;
let cmcStateLoaded = false;
let cmcStateMode = "missing";
const sosoRefreshedAssets = new Set();
let metrics = null;
let spotPrices = existing?.spotPrices || null;
let freshMetricHistory = {};
let historyRefresh = existing?.historyRefresh || null;
if (cmcAllowed) {
  try {
    const cmc = await readCmcProviderSnapshot();
    if (cmc.currentAvailable) {
      metrics = cmc.metrics;
      spotPrices = cmc.spotPrices;
    }
    freshMetricHistory = mergeHistoricalMetricSeries(freshMetricHistory, cmc.history);
    historyRefresh = cmc.historyRefresh
      ? {
        ...cmc.historyRefresh,
        providers: {
          ...(historyRefresh?.providers || {}),
          ...(cmc.historyRefresh.providers || {}),
        },
      }
      : historyRefresh;
    cmcCurrentAvailable = cmc.currentAvailable === true;
    cmcCurrentRefreshed = cmc.currentRefreshed === true;
    cmcStateLoaded = true;
    cmcStateMode = cmc.refreshMode;
    if (cmcCurrentRefreshed) freshSourceCount += 1;
  } catch {
    failures.push("CMC provider state unavailable; last-known-good values preserved.");
  }
} else {
  cmcStateMode = "policy_denied";
  if (cmcCollectionRequested) failures.push("CMC provider state denied by the active data-use boundary.");
}

if (!metrics) {
  if (existing?.metrics?.length) metrics = existing.metrics.map(({ change1d, change7d, ...item }) => item);
  else metrics = localFallbackMetrics(await readJson(equityFastPath, {}), await readJson(marketSessionPath, {}));
}

const historyNow = new Date();
const publicHistoryDisabled = preferredEnvironmentValue(
  process.env,
  "CYCLELENS_DISABLE_PUBLIC_HISTORY",
  "CYCLE_MAP_DISABLE_PUBLIC_HISTORY",
) === "1";
const historyRefreshForced = preferredEnvironmentValue(
  process.env,
  "CYCLELENS_FORCE_HISTORY_REFRESH",
  "CYCLE_MAP_FORCE_HISTORY_REFRESH",
) === "1" || process.argv.includes("--force-history");
const defillamaHistoryStatus = historyRefresh?.providers?.defillamaStablecoins;
if (
  !publicHistoryDisabled
  && defillamaAllowed
  && (historyRefreshForced || shouldRefreshHistoryProvider(defillamaHistoryStatus, historyNow))
) {
  const attemptedAt = isoNow();
  const providerStatus = { ...(historyRefresh?.providers || {}) };
  let historyProviderSuccess = false;
  const candidateHistory = mergeHistoricalMetricSeries(existing?.history, freshMetricHistory);
  const stablecoinHasCmcBackfill = hasFreshCmcStablecoinBackfill(candidateHistory, historyNow);
  if (!stablecoinHasCmcBackfill && defillamaAllowed) {
    try {
      const defillama = await fetchDefiLlamaStablecoinHistory();
      freshMetricHistory = mergeHistoricalMetricSeries(freshMetricHistory, defillama.history);
      providerStatus.defillamaStablecoins = {
        status: "available",
        lastAttemptedAt: attemptedAt,
        fetchedAt: defillama.fetchedAt,
        points: defillama.points,
        providerAssetIds: defillama.providerAssetIds,
      };
      freshSourceCount += 1;
      historyProviderSuccess = true;
    } catch (error) {
      failures.push(`DefiLlama stablecoin history: ${safeFailure(error)}`);
      providerStatus.defillamaStablecoins = {
        status: "failed_preserved_last_known_good",
        lastAttemptedAt: attemptedAt,
      };
    }
  } else if (stablecoinHasCmcBackfill) {
    providerStatus.defillamaStablecoins = {
      status: "not_needed_cmc_history_available",
      lastAttemptedAt: attemptedAt,
    };
  } else {
    providerStatus.defillamaStablecoins = {
      status: "denied_preserved_last_known_good",
      lastAttemptedAt: attemptedAt,
    };
  }
  historyRefresh = {
    lastAttemptedAt: attemptedAt,
    lastSuccessfulAt: historyProviderSuccess ? attemptedAt : historyRefresh?.lastSuccessfulAt || null,
    initialBackfillDays: 365,
    minimumBackfillDays: CRYPTO_LIQUIDITY_MINIMUM_BACKFILL_DAYS,
    overlapDays: 14,
    refreshCadenceHours: 20,
    providers: providerStatus,
  };
}

if (!spotPrices) {
  const marketSession = await readJson(marketSessionPath, {});
  const assets = Object.fromEntries((marketSession?.assets || []).map((item) => [item.symbol, item]));
  spotPrices = Object.fromEntries(["BTC", "ETH"].map((asset) => [asset, {
    asset,
    priceUsd: finiteNumber(assets[asset]?.price),
    observedAt: assets[asset]?.asOf || null,
    source: "existing-static-cache",
  }]));
}

const etf = { ...(existing?.etf || {}) };
if (sosoAllowed) {
  for (const asset of ["BTC", "ETH", "SOL"]) {
    try {
      etf[asset] = mergeSosoEtfHistory(etf[asset], await fetchSosoAsset(asset));
      freshSourceCount += 1;
      sosoRefreshedAssets.add(asset);
    } catch (error) {
      failures.push(`SoSoValue ${asset}: ${safeFailure(error)}`);
      etf[asset] ||= {
        asset,
        cadence: "daily",
        status: "pending_credentials",
        source: "sosovalue",
        observedAt: null,
        daily: [],
        weekly: [],
      };
    }
  }
} else {
  failures.push("SoSoValue refresh denied by data-use scope; last-known-good ETF history preserved.");
}

const reviewedDisclosures = await readJson(treasuryDisclosuresPath, { treasuries: {} });
const reviewedStrategy = normalizeReviewedTreasuryDisclosure(reviewedDisclosures?.treasuries?.MSTR || {});
let bitmineSec = { status: "reserved_missing_user_agent", holdings: [] };
if (secAllowed) {
  try {
    bitmineSec = await fetchBitmineSecHoldings();
    if (bitmineSec.holdings.length) freshSourceCount += 1;
  } catch (error) {
    failures.push(`BitMine SEC holdings: ${safeFailure(error)}`);
    bitmineSec = { status: "failed_preserved_reviewed_disclosures", holdings: [] };
  }
} else {
  bitmineSec = { status: "denied_preserved_reviewed_disclosures", holdings: [] };
}
const bitmineDisclosurePayload = reviewedDisclosures?.treasuries?.BMNR || {};
const reviewedBitmine = normalizeReviewedTreasuryDisclosure({
  ...bitmineDisclosurePayload,
  holdings: [...(bitmineDisclosurePayload.holdings || []), ...bitmineSec.holdings],
});
const corporateTreasuries = {
  MSTR: attachTreasurySpotPrice(reviewedStrategy, spotPrices?.BTC),
  BMNR: attachTreasurySpotPrice(mergeTreasurySnapshots(existing?.corporateTreasuries?.BMNR, reviewedBitmine), spotPrices?.ETH),
};

let blockbeats;
if (blockbeatsAllowed) {
  try {
    blockbeats = await fetchBlockbeatsAuxiliary();
    if (blockbeats.status === "available") freshSourceCount += 1;
  } catch (error) {
    failures.push(`BlockBeats auxiliary: ${safeFailure(error)}`);
    blockbeats = {
      enabled: true,
      configured: true,
      status: "failed_preserved_primary",
      role: "auxiliary_cross_check_only",
      endpoint: "/v1/data/btc_etf",
      data: existing?.auxiliarySources?.blockbeats?.data || null,
    };
  }
} else {
  blockbeats = existing?.auxiliarySources?.blockbeats || {
    enabled: false,
    configured: false,
    status: "denied_preserved_primary",
    role: "auxiliary_cross_check_only",
    endpoint: "/v1/data/btc_etf",
    data: null,
  };
}

const requiredSosoAssets = ["BTC", "ETH", "SOL"];
const missingSosoAssets = requiredSosoAssets.filter((asset) => !sosoRefreshedAssets.has(asset));
const cmcStateUsableForRequestedCollection = cmcCurrentAvailable && cmcStateMode !== "disabled";
if (process.env.CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE === "1"
  && ((cmcCollectionRequested && !cmcStateUsableForRequestedCollection) || missingSosoAssets.length)) {
  throw new Error("Owner crypto-liquidity collector did not refresh every required primary source");
}
if (existing && freshSourceCount === 0 && !cmcStateLoaded) {
  console.log("Crypto liquidity update skipped: no primary or auxiliary source refreshed; preserving last-known-good JSON.");
  process.exit(0);
}

const transformedAt = isoNow();
let history = mergeMetricHistory(existing?.history, metrics);
history = mergeHistoricalMetricSeries(history, freshMetricHistory);
metrics = attachHistoricalMetricFallbacks(metrics, history);
metrics = attachMetricChanges(metrics, history);
const historyCoverage = summarizeMetricHistory(history);
const levelsObservedAt = oldest(metrics.filter((item) => item.value != null).map((item) => item.observedAt));
const etfObservedAt = oldest(Object.values(etf).filter((item) => item.status === "available").map((item) => item.observedAt));
const treasuryObservedAt = oldest(Object.values(corporateTreasuries).filter((item) => item.status === "available").map((item) => item.holdingsObservedAt));
const observedAt = oldest([levelsObservedAt, etfObservedAt]);

const output = {
  version: CRYPTO_LIQUIDITY_VERSION,
  page: "crypto-liquidity",
  dataUseScope,
  generatedAt: transformedAt,
  timestamps: {
    observedAt,
    fetchedAt: freshSourceCount ? transformedAt : oldest(metrics.map((item) => item.observedAt)),
    transformedAt,
  },
  sectionObservedAt: {
    levels: levelsObservedAt,
    etf: etfObservedAt,
    corporateTreasuries: treasuryObservedAt,
  },
  status: failures.length ? "partial" : "available",
  metrics,
  history,
  historyCoverage,
  historyRefresh,
  etf,
  spotPrices,
  corporateTreasuries,
  corporateTreasuryAutomation: {
    strategy: "reviewed_strategy_official_disclosure",
    bitmine: bitmineSec.status,
  },
  auxiliarySources: { blockbeats },
  methodology: {
    marketCaps: "Market-cap changes are valuation changes, not capital inflows. CoinMarketCap supplies current aggregate and asset market caps. Its documented historical endpoints are backfilled once and then refreshed with a short overlap; plan-denied asset history remains explicitly unavailable.",
    stablecoins: "USDT and USDC market caps proxy circulating supply in USD. Their sum is labelled as tracked major stablecoins, not the entire stablecoin market. When CoinMarketCap asset history is unavailable, DefiLlama's documented free Stablecoins API supplies same-source circulating-USD history. A fresh CoinMarketCap current level is retained; a missing or stale stablecoin current level may advance to the newest documented same-series history point.",
    usdtPeg: "USDT peg deviation is (price - 1 USD) × 10,000 basis points and is not a flow metric.",
    etf: "SoSoValue v1 daily aggregate net flow is used for U.S. BTC, ETH, and SOL spot ETF series. Its one-month response is merged with prior observations; missing trading days are never filled with zero.",
    treasury: "Corporate treasury holdings and acquisition-cost observations keep separate source dates. Strategy holdings and average cost use reviewed official company disclosures; BitMine cost basis per ETH is derived only from same-date SEC units and cost basis. Press-release spot prices are never treated as acquisition cost.",
    blockbeats: "BlockBeats is reserved as an auxiliary BTC cross-check only and never overwrites the primary ETF series.",
  },
  sources: {
    cmc: "https://coinmarketcap.com/api/documentation/pro-api-reference/",
    cmcGlobalHistory: "https://coinmarketcap.com/api/documentation/pro-api-reference/global-metrics",
    cmcAssetHistory: "https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency",
    defillamaStablecoins: "https://api-docs.defillama.com/",
    sosovalueEtf: "https://sosovalue-1.gitbook.io/sosovalue-api-doc/2.-etf/summary-history",
    strategy: corporateTreasuries.MSTR.sourceUrl,
    bitmine: corporateTreasuries.BMNR.sourceUrl,
    secSubmissions: SEC_SUBMISSIONS_URL,
    blockbeats: "https://www.theblockbeats.info/apiDoc",
  },
  failures,
  refreshSummary: {
    cmcCollectionRequested,
    cmcCurrentAvailable,
    cmcCurrentRefreshed,
    cmcStateMode,
    requiredSosoAssets,
    sosoRefreshedAssets: [...sosoRefreshedAssets].sort(),
  },
};

await writeJsonAtomic(outputPath, output);
console.log(JSON.stringify({ status: output.status, metrics: metrics.length, etfAssets: Object.keys(etf), failures: failures.length }));

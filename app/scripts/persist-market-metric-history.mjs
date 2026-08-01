import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preferredEnvironmentValue } from "../product.config.mjs";

import {
  cacheRootForScope,
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
} from "./data-use-scope.mjs";
import { dedupeMarketMetricRows } from "./market-metric-history-contract.mjs";
import { runMetricAdapter } from "./metric-adapter-contract.mjs";
import { createMarketHistoryAdapter } from "./market-history-adapter.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(appRoot, "..");
const dataUseScope = dataUseScopeFromEnvironment(process.env, process.argv);
const dataDirectory = dataDirectoryForScope(appRoot, dataUseScope);
const cacheRoot = cacheRootForScope(workspaceRoot, dataUseScope);
const table = "market_metric_observations";
const batchSize = 500;
const requestTimeoutMs = 30_000;
const maxResponseBytes = 8 * 1024 * 1024;
const maxRequestAttempts = 3;
const cryptoHistoryPageSize = 1000;
const cryptoHistoryMaxPages = 10;
const cryptoHistoryMetricIds = [
  "crypto.totalMarketCap",
  "btc.marketCap",
  "stablecoin.usdt.marketCap",
  "stablecoin.usdc.marketCap",
  "stablecoin.major.marketCap",
  "stablecoin.usdt.depegBps",
  "crypto.etf.BTC.net_flow_usd",
  "crypto.etf.ETH.net_flow_usd",
  "crypto.etf.SOL.net_flow_usd",
  "treasury.mstr.btc_holdings",
  "treasury.bmnr.eth_holdings",
];

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, payload) {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function loadEnvFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function config() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bearer = key && !key.startsWith("sb_") ? `Bearer ${key}` : null;
  return { url, key, bearer };
}

function validatedSupabaseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be a hosted Supabase HTTPS origin");
  }
  if (parsed.protocol !== "https:"
    || !parsed.hostname.endsWith(".supabase.co")
    || parsed.username
    || parsed.password
    || !["", "/"].includes(parsed.pathname)
    || parsed.search
    || parsed.hash) {
    throw new Error("SUPABASE_URL must be a hosted Supabase HTTPS origin");
  }
  return parsed.origin;
}

function redact(value) {
  const { url, key } = config();
  let text = String(value || "");
  if (key) text = text.replaceAll(key, "<redacted>");
  if (url) text = text.replaceAll(url, "<supabase-url>");
  return text.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

async function boundedResponseText(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength != null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxResponseBytes) {
      throw new Error("Supabase market-history response exceeded the configured byte limit");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw new Error("Supabase market-history response exceeded the configured byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Supabase market-history response was not valid UTF-8");
  }
}

async function request(path, options = {}) {
  const { url, key, bearer } = config();
  const origin = validatedSupabaseOrigin(url);
  const requestBody = options.body == null ? undefined : JSON.stringify(options.body);
  let lastError = null;
  for (let attempt = 0; attempt < maxRequestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let retryable = true;
    try {
      const response = await fetch(`${origin}/rest/v1/${path}`, {
        method: options.method || "GET",
        signal: controller.signal,
        redirect: "error",
        headers: {
          apikey: key,
          ...(bearer ? { Authorization: bearer } : {}),
          "Content-Type": "application/json",
          ...(options.prefer ? { Prefer: options.prefer } : {}),
        },
        body: requestBody,
      });
      const text = await boundedResponseText(response);
      if (response.ok) {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("Supabase market-history response was not valid JSON");
        }
      }
      lastError = new Error(`Supabase market-history request failed with status ${response.status}`);
      retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    } catch (error) {
      const safeResponseError = /^Supabase market-history response (?:exceeded|was not valid)/.test(String(error?.message || ""));
      lastError = safeResponseError
        ? new Error(String(error.message))
        : new Error("Supabase market-history request failed before receiving a valid response");
      retryable = !/response (?:exceeded|was not valid)/.test(lastError.message);
    } finally {
      clearTimeout(timeout);
    }

    if (!retryable) throw lastError;
    if (attempt === maxRequestAttempts - 1) throw lastError;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * (2 ** attempt)));
  }
  throw lastError;
}

async function latestJapanObservation() {
  const query = [
    "select=observed_at",
    "metric_id=eq.macro.JGB10Y.value",
    "order=observed_at.desc",
    "limit=1",
  ].join("&");
  return (await request(`${table}?${query}`) || [])[0]?.observed_at || null;
}

async function readCryptoHistoryRows() {
  const start = new Date(Date.now() - 405 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [];
  for (let page = 0; page < cryptoHistoryMaxPages; page += 1) {
    const query = new URLSearchParams({
      select: "metric_id,observed_at,value,unit,cadence,source,source_url,source_key,quality_status,fetched_at,last_checked_at,transformed_at,dimensions,metadata",
      metric_id: `in.(${cryptoHistoryMetricIds.join(",")})`,
      observed_at: `gte.${start}`,
      order: "metric_id.asc,observed_at.asc,source_key.asc",
      limit: String(cryptoHistoryPageSize),
      offset: String(page * cryptoHistoryPageSize),
    });
    const batch = await request(`${table}?${query}`) || [];
    if (!Array.isArray(batch)) throw new Error("Supabase crypto history query returned an invalid response");
    rows.push(...batch);
    if (batch.length < cryptoHistoryPageSize) return rows;
  }
  throw new Error(`Supabase crypto history exceeded the ${cryptoHistoryMaxPages * cryptoHistoryPageSize} row hydration safety limit`);
}

async function upsertRows(rows) {
  const normalizedRows = dedupeMarketMetricRows(rows);
  for (let index = 0; index < normalizedRows.length; index += batchSize) {
    await request(`${table}?on_conflict=metric_id,observed_at,source_key`, {
      method: "POST",
      body: normalizedRows.slice(index, index + batchSize),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
}

if (preferredEnvironmentValue(process.env, "CYCLELENS_SKIP_LOCAL_ENV", "CYCLE_MAP_SKIP_LOCAL_ENV") !== "1") {
  await loadEnvFile(resolve(appRoot, ".env.local"));
  await loadEnvFile(resolve(workspaceRoot, ".env.local"));
}

const { url, key } = config();
const historyRequired = preferredEnvironmentValue(
  process.env,
  "CYCLELENS_REQUIRE_MARKET_HISTORY",
  "CYCLE_MAP_REQUIRE_MARKET_HISTORY",
) === "1";
if (!url || !key) {
  if (historyRequired) {
    throw new Error("Supabase market-history credentials are required in this environment");
  }
  console.log(JSON.stringify({ status: "skipped", reason: "Supabase market-history credentials are not configured" }));
  process.exit(0);
}

try {
  const adapter = createMarketHistoryAdapter({
    async readInputs() {
      const [crypto, equity, equityFast, macro, jgbCache] = await Promise.all([
        readJson(resolve(dataDirectory, "crypto-liquidity.json"), {}),
        readJson(resolve(dataDirectory, "equity-weekly.json"), {}),
        readJson(resolve(dataDirectory, "equity-fast.json"), {}),
        readJson(resolve(dataDirectory, "macro-calendar.json"), {}),
        readJson(resolve(cacheRoot, "equity-cache/mof-JGB10Y.json"), null),
      ]);
      return { crypto, equity, equityFast, macro, jgbCache };
    },
    latestJapanObservation,
    readCryptoHistoryRows,
    upsertRows,
    writeCryptoDataset(payload) {
      return writeJsonAtomic(resolve(dataDirectory, "crypto-liquidity.json"), payload);
    },
  });
  const result = await runMetricAdapter(adapter, { environment: process.env });
  const summary = result.projected;
  console.log(JSON.stringify({
    status: "persisted",
    rows: summary.persistedRows,
    cryptoRows: summary.cryptoRows,
    japanRows: summary.japanRows,
    equityDashboardRows: summary.equityDashboardRows,
    macroDashboardRows: summary.macroDashboardRows,
    databaseCryptoRows: summary.databaseRows,
    rejectedRows: summary.rejectedRows,
    metricIds: summary.metricIds,
    hydratedHistoryMetrics: Object.keys(summary.hydratedCrypto.history || {}).length,
  }));
} catch (error) {
  const detail = redact(error?.message || error);
  if (historyRequired) throw new Error(detail);
  console.warn(JSON.stringify({
    status: "skipped",
    reason: "Supabase market-history persistence is not ready",
    detail,
  }));
}

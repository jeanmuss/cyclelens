import { PRODUCT_CONFIG, preferredEnvironmentValue } from "../product.config.mjs";
import {
  MANUAL_MACRO_EVENTS_MAX_COUNT,
  normalizeManualMacroEventsPayload,
} from "./manual-macro-events-contract.mjs";
import {
  manualEventKey,
  manualEventsPayloadToSupabaseRows,
  manualEventsSupabaseRowsToPayload,
  manualSupabaseRowKey,
} from "./manual-macro-events-supabase-mapper.mjs";

export {
  manualEventsPayloadToSupabaseRows,
  manualEventsSupabaseRowsToPayload,
} from "./manual-macro-events-supabase-mapper.mjs";

const SUPABASE_TABLE = "manual_macro_events";
const SERVICE_KEY_ENV_NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_SUPABASE_RESPONSE_BYTES = 1024 * 1024;

function cleanText(value) {
  return String(value ?? "").trim();
}

export function manualEventsAdminActor(environment = process.env) {
  return cleanText(
    preferredEnvironmentValue(environment, "CYCLELENS_ADMIN_ACTOR", "CYCLE_MAP_ADMIN_ACTOR")
      || PRODUCT_CONFIG.localAdmin.defaultActor,
  );
}

function serviceKey() {
  for (const name of SERVICE_KEY_ENV_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function supabaseConfig() {
  const url = cleanText(process.env.SUPABASE_URL).replace(/\/+$/, "");
  const key = serviceKey();
  const bearer = key && !key.startsWith("sb_") ? `Bearer ${key}` : null;
  return { url, key, bearer };
}

function validatedSupabaseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be an absolute HTTPS origin");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  const hostedSupabase = parsed.hostname.endsWith(".supabase.co");
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
    || (!hostedSupabase && !loopback)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !["", "/"].includes(parsed.pathname)) {
    throw new Error("SUPABASE_URL must be an absolute HTTPS origin");
  }
  return parsed.origin;
}

export function hasSupabaseManualEventsConfig() {
  const { url, key } = supabaseConfig();
  return Boolean(url && key);
}

export function manualEventsStoreMode() {
  return hasSupabaseManualEventsConfig() ? "supabase-canonical" : "local-snapshot-readonly";
}

export function manualEventsCanonicalWriteAvailable() {
  return hasSupabaseManualEventsConfig();
}

async function boundedResponseText(response) {
  const declaredLength = response.headers?.get?.("content-length") ?? null;
  if (declaredLength != null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_SUPABASE_RESPONSE_BYTES) {
      throw new Error("Supabase response exceeded the configured byte limit");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SUPABASE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Supabase response exceeded the configured byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Supabase response was not valid UTF-8");
  }
}

async function supabaseRequest(path, options = {}) {
  const { url, key, bearer } = supabaseConfig();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required");
  const origin = validatedSupabaseOrigin(url);
  const headers = {
    apikey: key,
    ...(bearer ? { Authorization: bearer } : {}),
    "Content-Type": "application/json",
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${origin}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new Error("Supabase request failed before receiving a response");
  }
  let text;
  try {
    text = await boundedResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Supabase request failed with status ${response.status}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readSupabaseRows() {
  const query = [
    "select=*",
    "order=event_date.asc,category.asc,series_id.asc",
    `limit=${MANUAL_MACRO_EVENTS_MAX_COUNT + 1}`,
  ].join("&");
  const rows = await supabaseRequest(`${SUPABASE_TABLE}?${query}`) || [];
  if (!Array.isArray(rows)) throw new Error("Supabase manual-event response must be an array");
  if (rows.length > MANUAL_MACRO_EVENTS_MAX_COUNT) throw new Error("too many manual events");
  return rows;
}

export async function readManualEventsPayloadFromSupabase() {
  const rows = await readSupabaseRows();
  const mapped = manualEventsSupabaseRowsToPayload(rows);
  return normalizeManualMacroEventsPayload(mapped, new Date(mapped.updatedAt));
}

export async function writeManualEventsPayloadToSupabase(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const rows = manualEventsPayloadToSupabaseRows(payload, manualEventsAdminActor());
  const existingRows = await readSupabaseRows();
  const nextKeys = new Set(events.map(manualEventKey));
  const staleRows = existingRows.filter((row) => !nextKeys.has(manualSupabaseRowKey(row)));

  if (rows.length) {
    await supabaseRequest(`${SUPABASE_TABLE}?on_conflict=series_id,event_date`, {
      method: "POST",
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  for (const row of staleRows) {
    if (!row.id) continue;
    await supabaseRequest(`${SUPABASE_TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
  }

  return {
    upserted: rows.length,
    deleted: staleRows.length,
  };
}

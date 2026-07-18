import { PRODUCT_CONFIG, preferredEnvironmentValue } from "../product.config.mjs";
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

function redact(text) {
  const { url, key } = supabaseConfig();
  let output = String(text || "");
  if (key) output = output.replaceAll(key, "<redacted>");
  if (url) output = output.replaceAll(url, "<supabase-url>");
  return output.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

async function supabaseRequest(path, options = {}) {
  const { url, key, bearer } = supabaseConfig();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required");
  const headers = {
    apikey: key,
    ...(bearer ? { Authorization: bearer } : {}),
    "Content-Type": "application/json",
    ...(options.prefer ? { Prefer: options.prefer } : {}),
  };
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${redact(text)}`);
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
  ].join("&");
  return await supabaseRequest(`${SUPABASE_TABLE}?${query}`) || [];
}

export async function readManualEventsPayloadFromSupabase() {
  const rows = await readSupabaseRows();
  return manualEventsSupabaseRowsToPayload(rows);
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

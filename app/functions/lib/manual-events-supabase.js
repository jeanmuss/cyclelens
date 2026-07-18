import {
  manualEventsPayloadToSupabaseRows,
  manualEventsSupabaseRowsToPayload,
} from "../../scripts/manual-macro-events-supabase-mapper.mjs";

const TABLE = "manual_macro_events";
const MAX_STORE_RESPONSE_BYTES = 2 * 1024 * 1024;
const SELECT_COLUMNS = [
  "id",
  "status",
  "event_date",
  "series_id",
  "label",
  "label_zh",
  "label_en",
  "category",
  "role",
  "cadence",
  "unit",
  "source",
  "source_url",
  "date_meaning",
  "release_time_utc",
  "actual",
  "previous",
  "forecast",
  "change",
  "change_bp",
  "pct_change",
  "year_ago",
  "yoy_pct",
  "note",
  "metadata",
  "updated_at",
].join(",");

export class ManualEventsStoreError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "ManualEventsStoreError";
    this.code = code;
    this.status = status;
  }
}

async function limitedResponseText(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STORE_RESPONSE_BYTES) {
    throw new ManualEventsStoreError("manual_events_store_response_too_large", 502);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_STORE_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ManualEventsStoreError("manual_events_store_response_too_large", 502);
    }
    chunks.push(value);
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
    throw new ManualEventsStoreError("manual_events_store_response_invalid", 502);
  }
}

function storeConfig(env) {
  let url;
  try {
    url = new URL(String(env?.SUPABASE_URL || "").trim());
  } catch {
    throw new ManualEventsStoreError("manual_events_store_not_configured", 503);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ManualEventsStoreError("manual_events_store_not_configured", 503);
  }
  const secret = String(env?.SUPABASE_SECRET_KEY || env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret || (secret.startsWith("sb_") && !secret.startsWith("sb_secret_"))) {
    throw new ManualEventsStoreError("manual_events_store_not_configured", 503);
  }
  return {
    baseUrl: url.origin,
    secret,
    bearer: secret.startsWith("sb_") ? null : `Bearer ${secret}`,
  };
}

async function storeRequest(env, path, options = {}, fetchImpl = fetch) {
  const { baseUrl, secret, bearer } = storeConfig(env);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        apikey: secret,
        ...(bearer ? { authorization: bearer } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.prefer ? { prefer: options.prefer } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ManualEventsStoreError("manual_events_store_unavailable", 502);
  }
  const text = await limitedResponseText(response);
  if (!response.ok) {
    console.error({
      event: "cyclelens_admin_store_error",
      operation: options.operation || "request",
      status: response.status,
    });
    throw new ManualEventsStoreError("manual_events_store_request_failed", 502);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ManualEventsStoreError("manual_events_store_response_invalid", 502);
  }
}

function rowKey(row) {
  return `${row.series_id}::${row.event_date}`;
}

async function readRows(env, fetchImpl) {
  const query = `select=${encodeURIComponent(SELECT_COLUMNS)}&order=event_date.asc,category.asc,series_id.asc&limit=301`;
  const rows = await storeRequest(env, `${TABLE}?${query}`, { operation: "read" }, fetchImpl);
  if (!Array.isArray(rows)) throw new ManualEventsStoreError("manual_events_store_response_invalid", 502);
  if (rows.length > 300) throw new ManualEventsStoreError("manual_events_store_limit_exceeded", 409);
  return rows;
}

export async function readRemoteManualEvents(env, { fetchImpl = fetch } = {}) {
  return manualEventsSupabaseRowsToPayload(await readRows(env, fetchImpl));
}

export async function replaceRemoteManualEvents(payload, actor, env, { fetchImpl = fetch } = {}) {
  const rows = manualEventsPayloadToSupabaseRows(payload, actor);
  const existingRows = await readRows(env, fetchImpl);
  const nextKeys = new Set(rows.map(rowKey));
  const staleRows = existingRows.filter((row) => !nextKeys.has(rowKey(row)));

  if (rows.length) {
    await storeRequest(env, `${TABLE}?on_conflict=series_id,event_date`, {
      method: "POST",
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal",
      operation: "upsert",
    }, fetchImpl);
  }

  for (const row of staleRows) {
    if (!row.id) throw new ManualEventsStoreError("manual_events_store_row_invalid", 502);
    const filter = `id=eq.${encodeURIComponent(row.id)}`;
    await storeRequest(env, `${TABLE}?${filter}`, {
      method: "PATCH",
      body: { updated_by: actor },
      prefer: "return=minimal",
      operation: "mark_delete_actor",
    }, fetchImpl);
    await storeRequest(env, `${TABLE}?${filter}`, {
      method: "DELETE",
      prefer: "return=minimal",
      operation: "delete",
    }, fetchImpl);
  }

  return {
    payload: await readRemoteManualEvents(env, { fetchImpl }),
    changes: { upserted: rows.length, deleted: staleRows.length },
  };
}

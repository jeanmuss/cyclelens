const NUMERIC_FIELDS = [
  ["actual", "actual"],
  ["previous", "previous"],
  ["forecast", "forecast"],
  ["change", "change"],
  ["changeBp", "change_bp"],
  ["pctChange", "pct_change"],
  ["yearAgo", "year_ago"],
  ["yoyPct", "yoy_pct"],
];

const TEXT_FIELDS = [
  ["sourceUrl", "source_url"],
  ["dateMeaning", "date_meaning"],
  ["releaseTimeUtc", "release_time_utc"],
];

const CORE_EVENT_KEYS = new Set([
  "status",
  "date",
  "seriesId",
  "label",
  "labelZh",
  "labelEn",
  "category",
  "role",
  "cadence",
  "unit",
  "source",
  "sourceUrl",
  "dateMeaning",
  "releaseTimeUtc",
  "actual",
  "previous",
  "forecast",
  "change",
  "changeBp",
  "pctChange",
  "yearAgo",
  "yoyPct",
  "note",
  "metadata",
]);

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function nullableText(value) {
  const text = cleanText(value);
  return text ? text : null;
}

function nullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeUtc(value) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().replace(".000Z", "Z");
}

function metadataFromEvent(event) {
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? { ...event.metadata }
    : {};
  for (const [key, value] of Object.entries(event)) {
    if (!CORE_EVENT_KEYS.has(key) && value !== "" && value != null) metadata[key] = value;
  }
  return metadata;
}

function eventToSupabaseRow(event, actor) {
  const row = {
    status: cleanText(event.status || "draft"),
    event_date: cleanText(event.date),
    series_id: cleanText(event.seriesId),
    label: nullableText(event.label),
    label_zh: nullableText(event.labelZh),
    label_en: nullableText(event.labelEn),
    category: cleanText(event.category),
    role: cleanText(event.role || "manual_liquidity_event"),
    cadence: cleanText(event.cadence || "event"),
    unit: cleanText(event.unit || "event"),
    source: cleanText(event.source),
    note: nullableText(event.note),
    metadata: metadataFromEvent(event),
    updated_by: cleanText(actor),
  };
  for (const [eventField, rowField] of TEXT_FIELDS) {
    row[rowField] = eventField === "releaseTimeUtc" ? normalizeUtc(event[eventField]) : nullableText(event[eventField]);
  }
  for (const [eventField, rowField] of NUMERIC_FIELDS) row[rowField] = nullableNumber(event[eventField]);
  return row;
}

function supabaseRowToEvent(row) {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  const event = {
    ...metadata,
    status: cleanText(row.status || "draft"),
    date: cleanText(row.event_date),
    seriesId: cleanText(row.series_id),
    label: cleanText(row.label),
    labelZh: cleanText(row.label_zh),
    labelEn: cleanText(row.label_en),
    category: cleanText(row.category),
    role: cleanText(row.role || "manual_liquidity_event"),
    cadence: cleanText(row.cadence || "event"),
    unit: cleanText(row.unit || "event"),
    source: cleanText(row.source),
    sourceUrl: cleanText(row.source_url),
    dateMeaning: cleanText(row.date_meaning || "scheduled_beijing_date"),
    actual: nullableNumber(row.actual),
    previous: nullableNumber(row.previous),
    forecast: nullableNumber(row.forecast),
    change: nullableNumber(row.change),
    changeBp: nullableNumber(row.change_bp),
    pctChange: nullableNumber(row.pct_change),
    yearAgo: nullableNumber(row.year_ago),
    yoyPct: nullableNumber(row.yoy_pct),
    note: cleanText(row.note),
  };
  const releaseTimeUtc = normalizeUtc(row.release_time_utc);
  if (releaseTimeUtc) event.releaseTimeUtc = releaseTimeUtc;
  return event;
}

export function manualEventKey(event) {
  return `${event.seriesId}::${event.date}`;
}

export function manualSupabaseRowKey(row) {
  return `${row.series_id}::${row.event_date}`;
}

export function manualEventsPayloadToSupabaseRows(payload, actor) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.map((event) => eventToSupabaseRow(event, actor));
}

export function manualEventsSupabaseRowsToPayload(rows, fallbackUpdatedAt = isoNow()) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const updatedAt = safeRows
    .map((row) => normalizeUtc(row.updated_at))
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    version: 1,
    updatedAt: updatedAt || fallbackUpdatedAt,
    events: safeRows.map(supabaseRowToEvent),
  };
}

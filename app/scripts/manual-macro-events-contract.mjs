export const MANUAL_MACRO_EVENT_CATEGORIES = Object.freeze(["inflation", "growth", "rates", "volatility", "liquidity", "other"]);
export const MANUAL_MACRO_EVENT_STATUSES = Object.freeze(["published", "draft", "archived"]);
export const MANUAL_MACRO_EVENTS_MAX_BODY_BYTES = 64 * 1024;
export const MANUAL_MACRO_EVENTS_MAX_COUNT = 300;

const allowedCategories = new Set(MANUAL_MACRO_EVENT_CATEGORIES);
const allowedStatuses = new Set(MANUAL_MACRO_EVENT_STATUSES);

function cleanText(value, fallback = "", maximum = 200) {
  const text = String(value ?? fallback).trim();
  if (text.length > maximum) throw new Error(`text exceeds ${maximum} characters`);
  return text;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("numeric field must be finite");
  return number;
}

function normalizedUtc(value) {
  const text = cleanText(value, "", 64);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("release time must be a valid timestamp");
  return date.toISOString().replace(".000Z", "Z");
}

function validDateKey(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function normalizedUrl(value) {
  const text = cleanText(value, "", 2048);
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("source URL must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("source URL must use HTTP(S)");
  return url.toString();
}

export function normalizeManualMacroEvent(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`events[${index}] must be an object`);
  }
  const category = cleanText(raw.category || "liquidity", "", 40);
  if (!allowedCategories.has(category)) throw new Error(`events[${index}].category is invalid`);
  const date = cleanText(raw.date, "", 10);
  if (!validDateKey(date)) throw new Error(`events[${index}].date must be a real YYYY-MM-DD date`);
  const seriesId = cleanText(raw.seriesId, "", 80);
  if (!/^[A-Z0-9_:-]{3,80}$/.test(seriesId)) throw new Error(`events[${index}].seriesId is invalid`);
  const status = cleanText(raw.status || "published", "", 16);
  if (!allowedStatuses.has(status)) throw new Error(`events[${index}].status is invalid`);
  const labelZh = cleanText(raw.labelZh, "", 200);
  const labelEn = cleanText(raw.labelEn, "", 200);
  const label = cleanText(raw.label, [labelZh, labelEn].filter(Boolean).join(" / "), 400);
  if (!label && !labelZh && !labelEn) throw new Error(`events[${index}] needs a label`);
  const source = cleanText(raw.source, "", 200);
  if (!source) throw new Error(`events[${index}].source is required`);
  const normalized = {
    status,
    date,
    seriesId,
    label,
    labelZh,
    labelEn,
    category,
    role: cleanText(raw.role || "manual_liquidity_event", "", 80),
    cadence: cleanText(raw.cadence || "event", "", 40),
    unit: cleanText(raw.unit || "event", "", 40),
    source,
    dateMeaning: cleanText(raw.dateMeaning || "scheduled_beijing_date", "", 80),
    actual: numberOrNull(raw.actual),
    previous: numberOrNull(raw.previous),
    forecast: numberOrNull(raw.forecast),
    change: numberOrNull(raw.change),
    changeBp: numberOrNull(raw.changeBp),
    pctChange: numberOrNull(raw.pctChange),
    yearAgo: numberOrNull(raw.yearAgo),
    yoyPct: numberOrNull(raw.yoyPct),
    note: cleanText(raw.note, "", 2000),
  };
  const releaseTimeUtc = normalizedUtc(raw.releaseTimeUtc || raw.releaseAtUtc);
  if (releaseTimeUtc) normalized.releaseTimeUtc = releaseTimeUtc;
  const sourceUrl = normalizedUrl(raw.sourceUrl);
  if (sourceUrl) normalized.sourceUrl = sourceUrl;
  for (const key of ["country", "holidayName", "holidayNameZh", "observedDate", "legalDate", "referencePeriod"]) {
    const value = cleanText(raw[key], "", 200);
    if (value) normalized[key] = value;
  }
  return normalized;
}

export function normalizeManualMacroEvents(events) {
  if (!Array.isArray(events)) throw new Error("manual macro events JSON must contain an events array");
  if (events.length > MANUAL_MACRO_EVENTS_MAX_COUNT) throw new Error("too many manual events");
  const normalized = events.map(normalizeManualMacroEvent);
  const keys = new Set();
  for (const event of normalized) {
    const key = `${event.seriesId}::${event.date}`;
    if (keys.has(key)) throw new Error(`duplicate manual event key: ${key}`);
    keys.add(key);
  }
  return normalized;
}

export function normalizeManualMacroEventsPayload(payload, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("request body must be an object");
  return {
    version: 1,
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    events: normalizeManualMacroEvents(payload.events),
  };
}

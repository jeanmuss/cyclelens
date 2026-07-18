import { MACRO_CALENDAR_TIME_ZONES } from "../i18n/macro.js";

export function utcDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateKeyFromUtc(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function calendarTimeZone(language) {
  return MACRO_CALENDAR_TIME_ZONES[language] || MACRO_CALENDAR_TIME_ZONES.zh;
}

export function dateKeyInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateKeyForLanguage(language, date = new Date()) {
  return dateKeyInTimeZone(date, calendarTimeZone(language)) || localDateKey(date);
}

export function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function monthKeyFromDateKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

export function dayLabel(dateKey) {
  return String(dateKey).slice(5).replace("-", "/");
}

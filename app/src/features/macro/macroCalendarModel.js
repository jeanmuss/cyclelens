import { formatPct } from "../../data.js";
import {
  compactMacroCategoryLabel,
  macroCategoryLabel,
} from "../../shared/i18n/macro.js";
import {
  addUtcDays,
  calendarTimeZone,
  dateKeyFromUtc,
  dateKeyInTimeZone,
  dayLabel,
  localDateKey,
  localDateKeyForLanguage,
  monthKeyFromDateKey,
  utcDateFromKey,
} from "../../shared/dates/calendar.js";
import {
  formatMacroChange,
  formatMacroValue,
  formatNumber,
  isMacroNumber,
  macroMoveClass,
} from "../../shared/formatting/metrics.js";

export const MACRO_WEEK_ROWS = ["inflation", "growth", "rates", "volatility", "liquidity", "other"];

export const MACRO_STATUS_DISPLAY = {
  DFEDTARU: { category: "rates", label: "Fed upper", mode: "bp" },
  DFF: { category: "rates", label: "Fed funds", mode: "bp" },
  DGS2: { category: "rates", label: "2Y", mode: "bp" },
  DGS10: { category: "rates", label: "10Y", mode: "bp" },
  DFII10: { category: "rates", label: "Real 10Y", mode: "bp" },
  T10YIE: { category: "rates", label: "BEI", mode: "bp" },
  DTWEXBGS: { category: "rates", label: "DXY", mode: "pct" },
  DEXJPUS: { category: "rates", label: "USD/JPY", mode: "pct" },
  DEXCHUS: { category: "rates", label: "USD/CNY", mode: "pct" },
  VIXCLS: { category: "volatility", label: "VIX", mode: "level" },
  BAMLC0A0CM: { category: "volatility", label: "IG OAS", mode: "bp" },
  BAMLH0A0HYM2: { category: "volatility", label: "HY OAS", mode: "bp" },
  STLFSI4: { category: "volatility", label: "Stress", mode: "level" },
  WALCL: { category: "liquidity", label: "Fed assets", mode: "level" },
  WRESBAL: { category: "liquidity", label: "Reserves", mode: "level" },
  WTREGEN: { category: "liquidity", label: "TGA", mode: "level" },
  RRPONTSYD: { category: "liquidity", label: "RRP", mode: "level" },
};

export const MACRO_CATEGORY_ORDER = ["inflation", "growth", "rates", "volatility", "liquidity", "other"];
export const MONTH_CELL_ITEM_LIMIT = 3;

export {
  addUtcDays,
  calendarTimeZone,
  dateKeyFromUtc,
  dateKeyInTimeZone,
  dayLabel,
  localDateKey,
  localDateKeyForLanguage,
  monthKeyFromDateKey,
  utcDateFromKey,
};

export function startOfSundayWeek(dateKey) {
  const date = utcDateFromKey(dateKey);
  return addUtcDays(date, -date.getUTCDay());
}

export function weekDaysFor(dateKey, language = "zh") {
  const start = startOfSundayWeek(dateKey);
  const todayKey = localDateKeyForLanguage(language);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(start, index);
    const itemDateKey = dateKeyFromUtc(date);
    return { date, dateKey: itemDateKey, dayIndex: index, isToday: itemDateKey === todayKey };
  });
}

export function monthGrid(monthKey, language = "zh") {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const start = startOfSundayWeek(dateKeyFromUtc(first));
  const todayKey = localDateKeyForLanguage(language);
  const days = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addUtcDays(start, index);
    const dateKey = dateKeyFromUtc(date);
    days.push({
      date,
      dateKey,
      inMonth: date.getUTCMonth() === first.getUTCMonth(),
      isToday: dateKey === todayKey,
      dayOfMonth: date.getUTCDate(),
    });
    if (index >= 34 && date >= last && date.getUTCDay() === 6) break;
  }
  return days;
}

export function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return monthKeyFromDateKey(dateKeyFromUtc(date));
}

export function monthTitle(monthKey, language) {
  const date = utcDateFromKey(`${monthKey}-01`);
  const locale = language === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "long" }).format(date);
}

export function sameOrBefore(a, b) {
  return String(a) <= String(b);
}

export function findCurrentWeeklyState(dataset) {
  const endDate = dataset?.window?.endDate;
  const rows = dataset?.weeklyState || [];
  return rows.find((row) => row.weekStart <= endDate && row.weekEnd >= endDate)
    || [...rows].reverse().find((row) => sameOrBefore(row.weekEnd, endDate))
    || rows.at(-1)
    || null;
}

export function findWeeklyStateForDate(dataset, dateKey) {
  const rows = dataset?.weeklyState || [];
  return rows.find((row) => row.weekStart <= dateKey && row.weekEnd >= dateKey)
    || rows.find((row) => row.weekStart <= dateKey && row.weekEnd >= dateKeyFromUtc(addUtcDays(utcDateFromKey(dateKey), -1)))
    || null;
}

export function macroEventLabel(event, t) {
  if (!event) return "N/A";
  const localizedLabel = t.htmlLang === "zh-CN" ? event.labelZh : event.labelEn;
  if (localizedLabel) return localizedLabel;
  const labels = t.macroCalendar.eventLabels || {};
  const prefixes = t.macroCalendar.eventLabelPrefixes || {};
  const seriesId = String(event.seriesId || "");
  const bySeries = labels[seriesId];
  if (bySeries) return bySeries;
  const prefixMatch = Object.entries(prefixes).find(([prefix]) => seriesId.startsWith(prefix));
  if (prefixMatch) return prefixMatch[1];
  return labels[event.label] || event.label || "N/A";
}

export function compactIndicatorLabel(label, t) {
  const translated = t?.macroCalendar?.eventLabels?.[label] || label || "";
  const compactLabel = t?.macroCalendar?.compactEventLabels?.[translated];
  if (compactLabel) return compactLabel;
  const replacements = [
    ["Average hourly earnings", "AHE"],
    ["ADP private payrolls", "ADP"],
    ["Initial jobless claims", "Initial claims"],
    ["Industrial production", "Ind. production"],
    ["PCE price index", "PCE"],
    ["Core PPI goods", "Core PPI"],
    ["Unemployment rate", "Unemployment"],
    ["Nonfarm payrolls", "NFP"],
    ["Retail sales", "Retail"],
    ["Consumer sentiment", "Sentiment"],
    ["Japan overnight rate", "Japan O/N"],
    ["China 3M interbank rate", "China 3M"],
    ["FOMC fed funds median projection", "Dot median"],
    ["FOMC longer-run fed funds median", "Dot long-run"],
    ["FOMC meeting minutes", "FOMC minutes"],
    ["FOMC rate decision", "FOMC decision"],
    ["M2 money stock", "M2"],
    ["U.S. Independence Day holiday", "Independence Day"],
    ["U.S. federal holiday", "U.S. holiday"],
  ];
  return replacements.reduce((value, [from, to]) => value.replace(from, to), translated);
}

export function compactEventLabel(event, t) {
  const label = macroEventLabel(event, t);
  const compactLabel = t.macroCalendar.compactEventLabels?.[label];
  return compactLabel || compactIndicatorLabel(label, t);
}

export function eventWeekText(event, t) {
  return `${compactEventLabel(event, t)} ${formatMacroValue(event.actual, event.unit)}`;
}

export function eventMonthText(event, t) {
  return compactEventLabel(event, t);
}

export function statusChipText(seriesId, value) {
  const meta = MACRO_STATUS_DISPLAY[seriesId];
  if (!meta) return "";
  const changeText = meta.mode === "pct" && isMacroNumber(value.pctChange)
    ? formatPct(value.pctChange, 2)
    : formatMacroChange(value);
  return `${meta.label} ${changeText}`;
}

export function statusItemsForWeek(week) {
  if (!week?.values) return [];
  return Object.entries(week.values)
    .map(([seriesId, value]) => {
      const meta = MACRO_STATUS_DISPLAY[seriesId];
      if (!meta || !value?.observationEnd) return null;
      return {
        type: "status",
        date: value.observationEnd,
        category: meta.category,
        label: meta.label,
        text: statusChipText(seriesId, value),
        value,
        seriesId,
      };
    })
    .filter(Boolean);
}

export function statusItemsForDate(dataset, dateKey) {
  const itemsBySeries = new Map();
  (dataset?.weeklyState || []).forEach((week) => {
    statusItemsForWeek(week)
      .filter((item) => item.date === dateKey)
      .forEach((item) => {
        const existing = itemsBySeries.get(item.seriesId);
        if (!existing || (existing.value?.carriedForward && !item.value?.carriedForward)) {
          itemsBySeries.set(item.seriesId, item);
        }
      });
  });
  return [...itemsBySeries.values()].sort((a, b) => {
    const categoryDiff = MACRO_CATEGORY_ORDER.indexOf(a.category) - MACRO_CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff) return categoryDiff;
    return a.label.localeCompare(b.label);
  });
}

export function flowItemsForDate(dateKey, t) {
  const date = utcDateFromKey(dateKey);
  const endOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const daysToMonthEnd = Math.round((endOfMonth - date) / 86400000);
  const lastWorkingDay = new Date(endOfMonth.getTime());
  while (lastWorkingDay.getUTCDay() === 0 || lastWorkingDay.getUTCDay() === 6) {
    lastWorkingDay.setUTCDate(lastWorkingDay.getUTCDate() - 1);
  }
  const isQuarterEnd = [2, 5, 8, 11].includes(date.getUTCMonth());
  const isJulyEarningsSeasonWindow = date.getUTCMonth() === 6 && date.getUTCDate() >= 15 && date.getUTCDate() <= 31;
  const items = [];
  if (isJulyEarningsSeasonWindow) {
    items.push({
      type: "flow",
      date: dateKey,
      category: "volatility",
      label: t.macroCalendar.earningsSeasonWindow,
      text: t.macroCalendar.earningsSeason,
    });
  }
  if (daysToMonthEnd >= 0 && daysToMonthEnd <= 5) {
    items.push({
      type: "flow",
      date: dateKey,
      category: "liquidity",
      label: isQuarterEnd ? t.macroCalendar.quarterWindow : t.macroCalendar.monthWindow,
      text: isQuarterEnd ? t.macroCalendar.quarterWindow : t.macroCalendar.monthWindow,
    });
  }
  if (dateKey === dateKeyFromUtc(lastWorkingDay)) {
    items.push({
      type: "flow",
      date: dateKey,
      category: "sell-pressure-exhausted",
      label: t.macroCalendar.sellPressureExhausted,
      text: t.macroCalendar.sellPressureExhausted,
    });
  }
  return items;
}

export function calendarDateKeyForEvent(event, language) {
  if (event?.releaseTimeUtc) {
    return dateKeyInTimeZone(event.releaseTimeUtc, calendarTimeZone(language)) || event.date;
  }
  return event?.date;
}

export function eventsByDate(events, language = "zh") {
  return events.reduce((map, event) => {
    const dateKey = calendarDateKeyForEvent(event, language);
    if (!dateKey) return map;
    const list = map.get(dateKey) || [];
    list.push(event);
    map.set(dateKey, list);
    return map;
  }, new Map());
}

export function isHolidayEvent(event) {
  return event?.role === "holiday";
}

export function holidayCountryCode(event) {
  const country = String(event?.country || "").toUpperCase();
  if (country) return country;
  const seriesId = String(event?.seriesId || "");
  if (seriesId.startsWith("US_FEDERAL_HOLIDAY")) return "US";
  if (seriesId.startsWith("CN_PUBLIC_HOLIDAY")) return "CN";
  return "";
}

export function holidayCountryLabel(countryCode, t) {
  return t.macroCalendar.countries?.[countryCode] || countryCode || "N/A";
}

export function holidayCountryCodesForDate(eventMap, dateKey) {
  return [...new Set((eventMap.get(dateKey) || [])
    .filter(isHolidayEvent)
    .map(holidayCountryCode)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function buildWeekCellItems(dateKey, category, eventMap, statusItems, t) {
  const eventItems = (eventMap.get(dateKey) || [])
    .filter((event) => event.category === category)
    .map((event) => ({ type: "event", category, event, displayDate: dateKey, text: eventWeekText(event, t) }));
  const stateItems = statusItems
    .filter((item) => item.date === dateKey && item.category === category)
    .map((item) => ({ ...item, text: item.text }));
  const flowItems = flowItemsForDate(dateKey, t).filter((item) => item.category === category);
  return [...eventItems, ...stateItems, ...flowItems].slice(0, 4);
}

export function buildWeekDayItems(dateKey, eventMap, statusItems, t) {
  const eventItems = (eventMap.get(dateKey) || []).map((event) => ({
    type: "event",
    category: event.category,
    event,
    displayDate: dateKey,
    text: eventWeekText(event, t),
  }));
  const stateItems = statusItems
    .filter((item) => item.date === dateKey)
    .map((item) => ({ ...item, text: item.text }));
  return [...eventItems, ...stateItems, ...flowItemsForDate(dateKey, t)];
}

export function statusGroupItemsForDate(dataset, dateKey, t) {
  const groups = statusItemsForDate(dataset, dateKey).reduce((map, item) => {
    const existing = map.get(item.category) || {
      type: "status-group",
      category: item.category,
      count: 0,
    };
    existing.count += 1;
    map.set(item.category, existing);
    return map;
  }, new Map());

  return [...groups.values()]
    .sort((a, b) => MACRO_CATEGORY_ORDER.indexOf(a.category) - MACRO_CATEGORY_ORDER.indexOf(b.category))
    .map((item) => ({
      ...item,
      label: `${macroCategoryLabel(item.category, t)} ${item.count}`,
      text: `${compactMacroCategoryLabel(item.category, t)} ${item.count}`,
    }));
}

export function monthItemWeight(item) {
  return item.type === "status-group" ? item.count : 1;
}

export function limitMonthItems(items, t) {
  if (items.length <= MONTH_CELL_ITEM_LIMIT) return items;
  const visibleItems = items.slice(0, MONTH_CELL_ITEM_LIMIT - 1);
  const hiddenCount = items
    .slice(MONTH_CELL_ITEM_LIMIT - 1)
    .reduce((sum, item) => sum + monthItemWeight(item), 0);
  const hiddenText = t.macroCalendar.hiddenMonthItems(hiddenCount);
  return [
    ...visibleItems,
    {
      type: "overflow",
      category: "overflow",
      text: hiddenText,
      label: hiddenText,
    },
  ];
}

export function buildMonthItems(dateKey, dataset, eventMap, t) {
  const eventItems = (eventMap.get(dateKey) || []).map((event) => ({
    type: "event",
    category: event.category,
    event,
    displayDate: dateKey,
    text: eventMonthText(event, t),
  }));
  return limitMonthItems([
    ...eventItems,
    ...statusGroupItemsForDate(dataset, dateKey, t),
    ...flowItemsForDate(dateKey, t),
  ], t);
}

export function buildMonthDetailItems(dateKey, dataset, eventMap, t) {
  const eventItems = (eventMap.get(dateKey) || []).map((event) => ({
    type: "event",
    category: event.category,
    event,
    displayDate: dateKey,
    text: eventMonthText(event, t),
  }));
  return [...eventItems, ...statusItemsForDate(dataset, dateKey), ...flowItemsForDate(dateKey, t)];
}

export function pressureSignal(value, mode = "change") {
  if (value?.carriedForward) return 0;
  if (!value) return 0;
  const raw = mode === "pct" && isMacroNumber(value.pctChange)
    ? value.pctChange
    : isMacroNumber(value.changeBp)
      ? value.changeBp
      : value.change;
  if (!isMacroNumber(raw) || Math.abs(Number(raw)) < 0.01) return 0;
  return Number(raw) > 0 ? 1 : -1;
}

export function environmentDeltaText(item, t, mode = "change") {
  if (item?.carriedForward && item.observationEnd) return t.macroCalendar.asOf(dayLabel(item.observationEnd));
  if (mode === "pct" && isMacroNumber(item?.pctChange)) return formatPct(item.pctChange, 2);
  return formatMacroChange(item);
}

export function macroUsdBillions(item) {
  if (!isMacroNumber(item?.end)) return null;
  if (item.unit === "usd_millions") return Number(item.end) / 1000;
  if (item.unit === "usd_billions" || item.unit === "usd_billions_chained") return Number(item.end);
  return null;
}

export function formatMacroUsdLiquidity(value) {
  if (!isMacroNumber(value)) return "N/A";
  const billions = Number(value);
  if (Math.abs(billions) >= 1000) return `$${formatNumber(billions / 1000, 2)}T`;
  return `$${formatNumber(billions, 1)}B`;
}

export function netLiquidityCard(values, t) {
  const fedAssets = macroUsdBillions(values.WALCL);
  const tga = macroUsdBillions(values.WTREGEN);
  const reverseRepo = macroUsdBillions(values.RRPONTSYD);
  const value = [fedAssets, tga, reverseRepo].every(isMacroNumber)
    ? fedAssets - tga - reverseRepo
    : null;
  return {
    label: t.htmlLang === "zh-CN" ? "\u51c0\u6d41\u52a8\u6027" : "Net liquidity",
    value: formatMacroUsdLiquidity(value),
    delta: "Fed-TGA-RRP",
    className: "",
  };
}

export function environmentSummary(week, t) {
  const values = week?.values || {};
  const tenYear = values.DGS10;
  const realYield = values.DFII10;
  const dollar = values.DTWEXBGS;
  const vix = values.VIXCLS;
  const credit = values.BAMLH0A0HYM2;
  const tenYearRealLabel = t.htmlLang === "zh-CN" ? "10Y / \u5b9e\u9645\u5229\u7387" : "10Y / real yield";
  const score = pressureSignal(tenYear)
    + pressureSignal(dollar, "pct")
    + pressureSignal(vix)
    + pressureSignal(credit);
  const posture = score >= 2 ? t.macroCalendar.pressureHigh : score <= -2 ? t.macroCalendar.pressureLow : t.macroCalendar.pressureMedium;
  return {
    posture,
    score,
    cards: [
      { label: t.macroCalendar.riskPosture, value: posture, delta: week?.weekKey || "N/A", className: score >= 2 ? "macro-up" : score <= -2 ? "macro-down" : "" },
      { label: tenYearRealLabel, value: `${formatMacroValue(tenYear?.end, tenYear?.unit)} / ${formatMacroValue(realYield?.end, realYield?.unit)}`, delta: `${environmentDeltaText(tenYear, t)} / ${environmentDeltaText(realYield, t)}`, className: macroMoveClass((Number(tenYear?.changeBp) || 0) + (Number(realYield?.changeBp) || 0)) },
      { label: "DXY", value: formatMacroValue(dollar?.end, dollar?.unit), delta: environmentDeltaText(dollar, t, "pct"), className: dollar?.carriedForward ? "" : macroMoveClass(dollar?.pctChange) },
      { label: "VIX", value: formatMacroValue(vix?.end, vix?.unit), delta: environmentDeltaText(vix, t), className: macroMoveClass(vix?.change) },
      { label: "HY OAS", value: formatMacroValue(credit?.end, credit?.unit), delta: environmentDeltaText(credit, t), className: macroMoveClass(credit?.changeBp) },
      netLiquidityCard(values, t),
    ],
  };
}

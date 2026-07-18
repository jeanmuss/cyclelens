import {
  formatBp,
  formatNumber,
  formatSignedNumber,
} from "../../shared/formatting/metrics.js";
import { equityCopy } from "../../shared/i18n/usEquity.js";
import { dayLabel } from "../../shared/dates/calendar.js";

export const EQUITY_ASSET_KEYS = ["QQQ", "SPY", "DIA", "SOX"];
export const NO_RIGHT_METRIC_ID = "__none__";
export const USD_CNY_METRIC_ID = "macro.DEXCHUS.value";
export const METRIC_CHART_DEFAULTS = {
  left: "equity.QQQ.close",
  right: "macro.VIXCLS.value",
  window: "1m",
  transform: "indexed",
  zoom: 1,
};
export const METRIC_CHART_SIZE = { width: 960, height: 360, left: 76, right: 76, top: 24, bottom: 42 };
export const METRIC_CHART_CATEGORY_ORDER = ["equity", "rates", "volatility", "inflation", "growth", "liquidity", "chip_chain", "robot_chain", "other"];

export function metricChartCopyValue(value, language) {
  if (value && typeof value === "object") return language === "en" ? value.en : value.zh;
  return value || "";
}

export function metricLabel(metric, language) {
  if (!metric) return "N/A";
  return language === "en" ? metric.labelEn || metric.labelZh || metric.id : metric.labelZh || metric.labelEn || metric.id;
}

export function metricCategoryLabel(metric, language) {
  if (!metric) return "";
  return language === "en" ? metric.categoryLabelEn || metric.category : metric.categoryLabelZh || metric.category;
}

export function metricOptionsByCategory(chartDataset, language) {
  const metrics = chartDataset?.metrics || {};
  const ids = chartDataset?.metricOrder || Object.keys(metrics);
  const grouped = new Map();
  ids.forEach((id) => {
    const metric = metrics[id];
    if (!metric) return;
    const category = metric.category || "other";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(metric);
  });
  return [...grouped.entries()]
    .sort((a, b) => {
      const ai = METRIC_CHART_CATEGORY_ORDER.indexOf(a[0]);
      const bi = METRIC_CHART_CATEGORY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([category, items]) => ({
      category,
      label: metricCategoryLabel(items[0], language),
      items: items.sort((a, b) => metricLabel(a, language).localeCompare(metricLabel(b, language))),
    }));
}

export function metricWindowDays(chartDataset, windowValue) {
  return Number((chartDataset?.windows || []).find((item) => item.value === windowValue)?.days) || 31;
}

export function metricSeriesPoints(chartDataset, metricId) {
  const source = chartDataset?.series?.[metricId] || [];
  return source
    .map((point) => ({ t: point.t, ms: Date.parse(point.t), raw: Number(point.v) }))
    .filter((point) => point.t && Number.isFinite(point.ms) && Number.isFinite(point.raw))
    .sort((a, b) => a.ms - b.ms);
}

export function metricWindowEnd(chartDataset, metricIds) {
  const latestTimes = metricIds
    .flatMap((metricId) => metricSeriesPoints(chartDataset, metricId).map((point) => point.ms))
    .filter(Number.isFinite);
  return latestTimes.length ? Math.max(...latestTimes) : Date.now();
}

export function metricWindowDomain(chartDataset, windowValue, windowEndMs) {
  const end = Number.isFinite(windowEndMs) ? windowEndMs : Date.now();
  return [end - metricWindowDays(chartDataset, windowValue) * 86400000, end];
}

export function metricSeriesForWindow(chartDataset, metricId, windowValue, windowEndMs) {
  const points = metricSeriesPoints(chartDataset, metricId);
  if (!points.length) return [];
  const [start, end] = metricWindowDomain(chartDataset, windowValue, windowEndMs);
  return points.filter((point) => point.ms >= start && point.ms <= end);
}

export function transformMetricPoints(points, transform) {
  if (!points.length) return [];
  if (transform === "indexed" || transform === "changePct") {
    const first = points.find((point) => Number.isFinite(point.raw) && point.raw !== 0)?.raw;
    if (!Number.isFinite(first) || first === 0) return points.map((point) => ({ ...point, value: point.raw }));
    return points.map((point) => ({
      ...point,
      value: transform === "indexed" ? (point.raw / first) * 100 : ((point.raw - first) / first) * 100,
    }));
  }
  if (transform === "zscore") {
    const values = points.map((point) => point.raw).filter(Number.isFinite);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, values.length);
    const stdev = Math.sqrt(variance) || 1;
    return points.map((point) => ({ ...point, value: (point.raw - mean) / stdev }));
  }
  return points.map((point) => ({ ...point, value: point.raw }));
}

export function metricPercentile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function metricAxisDomain(points, zoom) {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (!values.length) return [0, 1];
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  const low = metricPercentile(values, 0.05) ?? actualMin;
  const high = metricPercentile(values, 0.95) ?? actualMax;
  const spread = Math.max(Math.abs(high - low), Math.abs(actualMax - actualMin), Math.abs(high || actualMax) * 0.015, 1);
  const center = (low + high) / 2 - spread * 0.08;
  const half = (spread * 0.82) / Math.max(0.75, Number(zoom) || 1);
  return [center - half, center + half];
}

export function metricChartY(value, domain, size = METRIC_CHART_SIZE) {
  const plotHeight = size.height - size.top - size.bottom;
  const ratio = (value - domain[0]) / Math.max(0.000001, domain[1] - domain[0]);
  return size.top + (1 - ratio) * plotHeight;
}

export function metricChartX(ms, domain, size = METRIC_CHART_SIZE) {
  const plotWidth = size.width - size.left - size.right;
  const ratio = (ms - domain[0]) / Math.max(1, domain[1] - domain[0]);
  return size.left + ratio * plotWidth;
}

export function plottedMetricPoints(points, xDomain, yDomain) {
  return points.map((point) => ({
    ...point,
    x: metricChartX(point.ms, xDomain),
    y: metricChartY(point.value, yDomain),
  }));
}

export function metricGapLimitMs(metric) {
  const day = 86400000;
  if (metric?.cadence === "daily") return day * 4;
  if (metric?.cadence === "weekly") return day * 10;
  if (metric?.cadence === "monthly") return day * 38;
  if (metric?.cadence === "quarterly") return day * 105;
  return day * 10;
}

export function metricLinePath(points, metric) {
  if (!points.length) return "";
  const gapLimit = metricGapLimitMs(metric);
  return points.map((point, index) => {
    const previous = points[index - 1];
    const command = !previous || point.ms - previous.ms > gapLimit ? "M" : "L";
    return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(" ");
}

export function metricSparseDots(points) {
  if (points.length > 24) return [];
  return points;
}

export function metricTicks(domain, count = 5) {
  return Array.from({ length: count }, (_, index) => domain[0] + ((domain[1] - domain[0]) * index) / (count - 1));
}

export function metricXTicks(domain, windowValue) {
  const count = windowValue === "7d" ? 8 : 7;
  return metricTicks(domain, count);
}

export function compactMetricAxisTitle(metric, language) {
  const label = metricLabel(metric, language);
  const maxLength = language === "en" ? 30 : 18;
  return label.length > maxLength ? `${label.slice(0, maxLength - 3)}...` : label;
}

export function nearestMetricPoint(points, targetMs) {
  if (!points.length) return null;
  return points.reduce((nearest, point) => {
    if (!nearest) return point;
    return Math.abs(point.ms - targetMs) < Math.abs(nearest.ms - targetMs) ? point : nearest;
  }, null);
}

export function metricDateLabel(value, language, compact = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  const locale = language === "en" ? "en-US" : "zh-CN";
  const options = compact
    ? { month: "2-digit", day: "2-digit" }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(locale, { timeZone: language === "en" ? "America/New_York" : "Asia/Shanghai", ...options }).format(date);
}

export function formatMetricChartValue(value, metric, transform, language) {
  if (!Number.isFinite(Number(value))) return "N/A";
  const number = Number(value);
  if (transform === "indexed") return formatNumber(number, 1);
  if (transform === "changePct") return `${formatNumber(number, 2)}%`;
  if (transform === "zscore") return `${formatNumber(number, 2)} sd`;
  const unit = metric?.unit;
  if (unit === "percent") return `${formatNumber(number, 2)}%`;
  if (unit === "fx") return formatNumber(number, 4);
  if (unit === "USD" || unit === "USDT" || unit === "usd") return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(number);
  if (unit === "persons" || unit === "thousand_persons" || unit === "shares") return new Intl.NumberFormat(language === "en" ? "en-US" : "zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(number);
  if (unit === "usd_millions") return `$${formatNumber(number / 1000, 1)}B`;
  if (unit === "usd_billions" || unit === "usd_billions_chained") return `$${formatNumber(number, 1)}B`;
  return formatNumber(number, Math.abs(number) >= 100 ? 1 : 2);
}

export function equityAssetLabel(dataset, symbol, t) {
  if (symbol === "DIA") return equityCopy(t).dow;
  if (symbol === "SOX") return equityCopy(t).sox;
  return dataset.assets?.[symbol]?.displaySymbol || symbol;
}

export function equityEventLabel(event, language) {
  return language === "en" ? event?.labelEn || event?.labelZh : event?.labelZh || event?.labelEn;
}

export function equityEventNote(event, language) {
  return language === "en" ? event?.noteEn || event?.noteZh : event?.noteZh || event?.noteEn;
}

export function equityDaysByDate(dataset) {
  return new Map((dataset?.days || []).map((day) => [day.date, day]));
}

export function latestEquityDate(dataset) {
  return dataset?.latest?.date || [...(dataset?.days || [])].reverse().find((day) => day.isMarketDay && Object.values(day.assets || {}).some(Boolean))?.date || dataset?.window?.endDate;
}

export function formatEquityPrice(value) {
  if (!Number.isFinite(Number(value))) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Number(value));
}

export function formatEquityMacroValue(value, unit) {
  if (!Number.isFinite(Number(value))) return "N/A";
  if (unit === "percent") return `${formatNumber(value, 2)}%`;
  return formatNumber(value, 2);
}

export function formatEquityMacroChange(seriesId, value) {
  if (!value) return "N/A";
  if (["DGS10", "JGB10Y"].includes(seriesId)) return formatBp(value.changeBp, 0);
  return formatSignedNumber(value.change, 2);
}

export function equityMacroLabel(seriesId, copy) {
  if (seriesId === "DGS10") return copy.tenYear;
  if (seriesId === "JGB10Y") return copy.japanTenYear;
  return copy.vix;
}

export function equityMacroMove(seriesId, item) {
  return ["DGS10", "JGB10Y"].includes(seriesId) ? item?.changeBp : item?.change;
}

export function metricPointAtOrBeforeDate(chartDataset, metricId, dateKey, maxLagDays = 10) {
  if (!chartDataset || !dateKey) return null;
  const metric = chartDataset.metrics?.[metricId];
  if (!metric) return null;
  const targetMs = Date.parse(`${dateKey}T23:59:59Z`);
  if (!Number.isFinite(targetMs)) return null;
  let previous = null;
  let selected = null;
  for (const point of metricSeriesPoints(chartDataset, metricId)) {
    if (point.ms > targetMs) break;
    previous = selected;
    selected = point;
  }
  if (!selected || targetMs - selected.ms > maxLagDays * 86400000) return null;
  return {
    metric,
    point: selected,
    previous,
    change: previous ? selected.raw - previous.raw : null,
  };
}

export function equityMoveClass(value) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "";
  return Number(value) > 0 ? "positive" : "negative";
}

export function equityMarketPrice(asset) {
  return Number.isFinite(Number(asset?.price)) ? Number(asset.price) : Number(asset?.close);
}

export function equityOpenMove(asset) {
  const current = equityMarketPrice(asset);
  const open = Number(asset?.open);
  if (!Number.isFinite(current) || !Number.isFinite(open)) return null;
  return current - open;
}

export function equityDirectionSymbol(asset) {
  const move = equityOpenMove(asset);
  if (!Number.isFinite(Number(move)) || Math.abs(Number(move)) < 0.0001) return "\u2192";
  return Number(move) > 0 ? "\u2191" : "\u2193";
}

export function equityDirectionClass(asset) {
  return equityMoveClass(equityOpenMove(asset));
}

export function equityFastMetric(dataset, metricId) {
  return (dataset.fast?.metrics || []).find((metric) => metric.id === metricId) || null;
}

export function formatUsdCompact(value) {
  if (value == null || value === "") return "N/A";
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000_000) return `$${formatNumber(number / 1_000_000_000_000, 2)}T`;
  if (abs >= 1_000_000_000) return `$${formatNumber(number / 1_000_000_000, 1)}B`;
  if (abs >= 1_000_000) return `$${formatNumber(number / 1_000_000, 1)}M`;
  return `$${formatNumber(number, 0)}`;
}

export function formatEquityFastMetricValue(metric) {
  if (!metric) return "N/A";
  const number = Number(metric.value);
  if (metric.value == null || metric.value === "" || !Number.isFinite(number)) return "N/A";
  if (metric.unit === "USD") return formatUsdCompact(metric.value);
  if (metric.unit === "index") return formatNumber(metric.value, 2);
  return formatEquityPrice(metric.value);
}

export function formatEquityFastMetricNote(metric, copy, language) {
  if (!metric?.asOf) return copy.waitingForFastData;
  if (/^\d{4}-\d{2}-\d{2}$/.test(metric.asOf)) return dayLabel(metric.asOf);
  const timestamp = new Date(metric.asOf);
  if (Number.isNaN(timestamp.getTime())) return metric.asOf;
  const locale = language === "en" ? "en-US" : "zh-CN";
  const timeZone = language === "en" ? "America/New_York" : "Asia/Shanghai";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

import { formatNumber } from "../../shared/formatting/metrics.js";

export function localizedField(item, field, language) {
  return item?.[`${field}${language === "en" ? "En" : "Zh"}`] || item?.[field] || "";
}

export function chipStageLabel(stage, copy) {
  return copy.stage?.[stage] || stage || "";
}

export function chipSourceLabel(asset, copy) {
  if (!asset) return "N/A";
  if (asset.sourceLabel) return asset.sourceLabel;
  return asset.sourceKind === "sample" ? copy.sampleSource : asset.sourceKind || "N/A";
}

export function formatMarketCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (n >= 1000) return `${formatNumber(n / 1000, 2)}T USD`;
  return `${formatNumber(n, n >= 10 ? 0 : 1)}B USD`;
}

export function formatWeek52Position(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${Math.round(n * 100)}%`;
}

export function sourceTimeLabel(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    timeZone: language === "en" ? "America/New_York" : "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

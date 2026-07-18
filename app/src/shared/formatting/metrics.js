import { formatPct } from "../../data.js";

export function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

export function textBlock(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return value || "";
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "N/A";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value));
}


export function formatSignedNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "N/A";
  const normalized = Math.abs(Number(value)) < 10 ** -digits ? 0 : Number(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    signDisplay: normalized === 0 ? "never" : "always",
  }).format(normalized);
}

export function formatCompactPrice(value) {
  if (!Number.isFinite(Number(value))) return "N/A";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value))} USD`;
}

export function formatBp(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return "N/A";
  const normalized = Math.abs(Number(value)) < 0.005 ? 0 : Number(value);
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(digits)} bp`;
}

export function latestMacro(week, id) {
  return week?.macro?.[id] || null;
}

export function macroClass(value) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "";
  return Number(value) > 0 ? "positive" : "negative";
}

export function isMacroNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function macroMoveClass(value) {
  if (!isMacroNumber(value) || Number(value) === 0) return "";
  return Number(value) > 0 ? "macro-up" : "macro-down";
}


export function formatMacroValue(value, unit) {
  if (!isMacroNumber(value)) return "N/A";
  if (unit === "percent" || unit === "percent_spread") return `${formatNumber(value, 2)}%`;
  if (unit === "thousand_persons") return `${formatNumber(value, 0)}K`;
  if (unit === "persons") return formatNumber(value, 0);
  if (unit === "usd_millions") return `$${formatNumber(Number(value) / 1000, 1)}B`;
  if (unit === "usd_billions" || unit === "usd_billions_chained") return `$${formatNumber(value, 1)}B`;
  if (unit === "usd_per_hour") return `$${formatNumber(value, 2)}`;
  return formatNumber(value, unit === "fx" ? 4 : 2);
}

export function formatMacroChange(item) {
  if (!item) return "N/A";
  if (isMacroNumber(item.changeBp)) return formatBp(item.changeBp, 0);
  if (item.unit === "thousand_persons" && isMacroNumber(item.change)) return `${formatSignedNumber(item.change, 0)}K`;
  if (item.unit === "persons" && isMacroNumber(item.change)) return formatSignedNumber(item.change, 0);
  if (item.unit === "usd_millions" && isMacroNumber(item.change)) return `$${formatSignedNumber(Number(item.change) / 1000, 1)}B`;
  if ((item.unit === "usd_billions" || item.unit === "usd_billions_chained") && isMacroNumber(item.change)) return `$${formatSignedNumber(item.change, 1)}B`;
  if (isMacroNumber(item.pctChange)) return formatPct(item.pctChange, 2);
  if (isMacroNumber(item.change)) return formatSignedNumber(item.change, 2);
  return "N/A";
}

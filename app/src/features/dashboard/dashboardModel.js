function finiteValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function dashboardMetricMap(projection) {
  return new Map((projection?.metrics || []).map((metric) => [metric.metricId, metric]));
}

export function metricSnapshot(metric) {
  const observations = Array.isArray(metric?.observations) ? metric.observations : [];
  const latest = observations.at(-1) || null;
  const previous = observations.at(-2) || null;
  const latestValue = finiteValue(latest?.value);
  const previousValue = finiteValue(previous?.value);
  return {
    metric,
    latest,
    latestValue,
    change: latestValue !== null && previousValue !== null ? latestValue - previousValue : null,
  };
}

export function formatDashboardValue(metric, value, language = "zh") {
  const number = finiteValue(value);
  if (number === null) return "N/A";
  const locale = language === "en" ? "en-US" : "zh-CN";
  const format = metric?.defaultDisplay?.format;
  const precision = metric?.defaultDisplay?.precision ?? 2;
  if (format === "compact_currency" || format === "signed_compact_currency") {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: precision,
    }).format(Math.abs(number));
    if (format !== "signed_compact_currency") return number < 0 ? `-${formatted}` : formatted;
    return `${number > 0 ? "+" : number < 0 ? "-" : ""}${formatted}`;
  }
  if (format === "currency") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: precision,
    }).format(number);
  }
  if (format === "percent") return `${number.toFixed(precision)}%`;
  if (format === "basis_points") return `${number > 0 ? "+" : ""}${number.toFixed(precision)} bp`;
  return new Intl.NumberFormat(locale, {
    notation: format === "compact_number" ? "compact" : "standard",
    maximumFractionDigits: precision,
  }).format(number);
}

export function dashboardSourceLabels(projection) {
  return [...new Set((projection?.metrics || []).flatMap((metric) => (
    (metric.sources || []).map((source) => source.attribution || source.label).filter(Boolean)
  )))];
}

export function missingDashboardMetricCount(projection, definitions) {
  const available = dashboardMetricMap(projection);
  const metricIds = new Set(definitions.flatMap((definition) => definition.metricIds));
  return [...metricIds].filter((metricId) => !available.has(metricId)).length;
}

function finiteValue(value) {
  if (value == null || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function changeReference(observations, latest, offsetDays, maxLagDays) {
  const latestTime = Date.parse(latest?.observedAt);
  if (!Number.isFinite(latestTime)) return null;
  const targetTime = latestTime - (offsetDays * DAY_MS);
  const sourcePolicyId = latest?.sourcePolicyId;
  const candidate = [...observations].reverse().find((item) => {
    const time = Date.parse(item?.observedAt);
    return Number.isFinite(time)
      && time <= targetTime
      && (!sourcePolicyId || !item.sourcePolicyId || item.sourcePolicyId === sourcePolicyId);
  });
  if (!candidate || targetTime - Date.parse(candidate.observedAt) > maxLagDays * DAY_MS) return null;
  return candidate;
}

function changeFromReference(latestValue, reference) {
  const referenceValue = finiteValue(reference?.value);
  if (latestValue === null || referenceValue === null) return null;
  return { value: latestValue - referenceValue, referenceValue, observedAt: reference.observedAt };
}

export function dashboardMetricMap(projection) {
  return new Map((projection?.metrics || []).map((metric) => [metric.metricId, metric]));
}

export function metricSnapshot(metric) {
  const observations = (Array.isArray(metric?.observations) ? metric.observations : [])
    .filter((item) => finiteValue(item?.value) !== null && Number.isFinite(Date.parse(item?.observedAt)))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const latest = observations.at(-1) || null;
  const previous = observations.at(-2) || null;
  const latestValue = finiteValue(latest?.value);
  const previousValue = finiteValue(previous?.value);
  const dailyCadence = metric?.cadence === "daily";
  const weeklyCadence = metric?.cadence === "weekly";
  const dayReference = dailyCadence ? changeReference(observations, latest, 1, 3) : null;
  const weekReference = dailyCadence || weeklyCadence ? changeReference(observations, latest, 7, 4) : null;
  return {
    metric,
    latest,
    latestValue,
    change: latestValue !== null && previousValue !== null ? latestValue - previousValue : null,
    dayChange: changeFromReference(latestValue, dayReference),
    weekChange: changeFromReference(latestValue, weekReference),
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

export function formatDashboardChange(metric, change, language = "zh") {
  if (!change || finiteValue(change.value) === null || finiteValue(change.referenceValue) === null) return "N/A";
  const delta = Number(change.value);
  const reference = Number(change.referenceValue);
  const precision = metric?.defaultDisplay?.precision ?? 2;
  if (metric?.unit === "percent" || metric?.unit === "percent_spread") {
    const basisPoints = delta * 100;
    return `${basisPoints > 0 ? "+" : ""}${basisPoints.toFixed(Math.min(precision, 2))} bp`;
  }
  if (metric?.unit === "bps") return `${delta > 0 ? "+" : ""}${delta.toFixed(Math.min(precision, 2))} bp`;
  if (metric?.unit === "score") return `${delta > 0 ? "+" : ""}${delta.toFixed(precision)}`;
  if (metric?.defaultDisplay?.format === "signed_compact_currency") {
    return formatDashboardValue(metric, delta, language);
  }
  if (reference === 0) return "N/A";
  const percent = (delta / Math.abs(reference)) * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
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

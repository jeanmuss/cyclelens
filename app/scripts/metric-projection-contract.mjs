import {
  METRIC_CATALOG,
  METRIC_CATALOG_BY_ID,
  METRIC_CATALOG_VERSION,
} from "../src/domain/metrics/metricCatalog.js";
import { SOURCE_POLICY_BY_ID } from "../src/domain/metrics/sourcePolicy.js";

export const PUBLIC_PROJECTION_SCHEMA_VERSION = 1;
export const PUBLIC_PROJECTION_IDS = Object.freeze(["crypto-liquidity", "us-equity"]);

const publicDimensionKeys = new Set([
  "asset",
  "company",
  "country",
  "countryCode",
  "sourceColumn",
  "tenor",
  "ticker",
]);

function validTimestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function latestTimestamp(values) {
  return values.map(validTimestamp).filter(Boolean).sort().at(-1) || null;
}

function safePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function publicDimensions(dimensions) {
  return Object.fromEntries(Object.entries(dimensions || {}).filter(([key, value]) => (
    publicDimensionKeys.has(key) && ["string", "number", "boolean"].includes(typeof value)
  )));
}

function preferredSourceRows(catalogEntry, rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.source_policy_id) || [];
    current.push(row);
    grouped.set(row.source_policy_id, current);
  }
  return [...grouped.entries()].map(([sourcePolicyId, sourceRows]) => ({
    sourcePolicyId,
    rows: sourceRows,
    latest: Math.max(...sourceRows.map((item) => Date.parse(item.observed_at))),
    priority: catalogEntry.sourcePolicyIds.indexOf(sourcePolicyId),
  })).sort((left, right) => (
    right.latest - left.latest
    || right.rows.length - left.rows.length
    || left.priority - right.priority
  ))[0]?.rows || [];
}

function createMetricProjection(catalogEntry, rows) {
  const selected = preferredSourceRows(catalogEntry, rows);
  const deduped = new Map();
  for (const row of selected) {
    const observedAt = validTimestamp(row.observed_at);
    if (!observedAt || !Number.isFinite(Number(row.value))) continue;
    const existing = deduped.get(observedAt);
    if (!existing || String(row.last_checked_at || "") >= String(existing.last_checked_at || "")) deduped.set(observedAt, row);
  }
  const observations = [...deduped.values()]
    .sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at))
    .slice(-catalogEntry.historyLimit)
    .map((row) => ({
      observedAt: validTimestamp(row.observed_at),
      value: Number(row.value),
      qualityStatus: String(row.quality_status || "available"),
      firstFetchedAt: validTimestamp(row.fetched_at),
      lastCheckedAt: validTimestamp(row.last_checked_at),
      sourcePolicyId: row.source_policy_id,
      sourceUrl: safePublicUrl(row.source_url),
      dimensions: publicDimensions(row.dimensions),
    }));
  if (!observations.length) return null;
  const sourcePolicyIds = [...new Set(observations.map((item) => item.sourcePolicyId))];
  return {
    metricId: catalogEntry.metricId,
    title: catalogEntry.title,
    unit: catalogEntry.unit,
    cadence: catalogEntry.cadence,
    quality: catalogEntry.quality,
    defaultDisplay: catalogEntry.defaultDisplay,
    sources: sourcePolicyIds.map((id) => ({
      sourcePolicyId: id,
      label: SOURCE_POLICY_BY_ID[id].label,
      attribution: SOURCE_POLICY_BY_ID[id].attribution,
      termsUrl: SOURCE_POLICY_BY_ID[id].termsUrl,
    })),
    observations,
  };
}

export function createPublicProjection(projectionId, acceptedRows, generatedAt = null) {
  if (!PUBLIC_PROJECTION_IDS.includes(projectionId)) throw new Error(`Unknown projection: ${projectionId}`);
  const catalogEntries = METRIC_CATALOG.filter((entry) => entry.projections.includes(projectionId));
  const metrics = catalogEntries.map((entry) => createMetricProjection(
    entry,
    acceptedRows.filter((row) => row.metric_id === entry.metricId),
  )).filter(Boolean);
  const observations = metrics.flatMap((metricEntry) => metricEntry.observations);
  const transformedAt = validTimestamp(generatedAt) || latestTimestamp(observations.flatMap((item) => [
    item.lastCheckedAt,
    item.firstFetchedAt,
    item.observedAt,
  ]));
  return {
    schemaVersion: PUBLIC_PROJECTION_SCHEMA_VERSION,
    catalogVersion: METRIC_CATALOG_VERSION,
    projectionId,
    generatedAt: transformedAt,
    freshness: {
      observedAt: latestTimestamp(observations.map((item) => item.observedAt)),
      firstFetchedAt: latestTimestamp(observations.map((item) => item.firstFetchedAt)),
      lastCheckedAt: latestTimestamp(observations.map((item) => item.lastCheckedAt)),
      transformedAt,
    },
    metrics,
  };
}

function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, visit, `${path}.${key}`));
}

export function validatePublicProjection(payload) {
  const errors = [];
  if (payload?.schemaVersion !== PUBLIC_PROJECTION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!PUBLIC_PROJECTION_IDS.includes(payload?.projectionId)) errors.push("invalid projectionId");
  if (payload?.catalogVersion !== METRIC_CATALOG_VERSION) errors.push("invalid catalogVersion");
  if (!Array.isArray(payload?.metrics)) errors.push("metrics must be an array");
  for (const metricEntry of payload?.metrics || []) {
    const catalogEntry = METRIC_CATALOG_BY_ID[metricEntry.metricId];
    if (!catalogEntry?.projections.includes(payload.projectionId)) errors.push(`${metricEntry.metricId}: not allowed in projection`);
    if (metricEntry.unit !== catalogEntry?.unit || metricEntry.cadence !== catalogEntry?.cadence) errors.push(`${metricEntry.metricId}: catalog mismatch`);
    if (!Array.isArray(metricEntry.observations) || !metricEntry.observations.length) errors.push(`${metricEntry.metricId}: observations required`);
  }
  walk(payload, (value, path) => {
    const key = path.split(".").at(-1).toLowerCase();
    if (/(secret|password|cookie|authorization|service_role|api_key|email|user_id)/.test(key)) errors.push(`${path}: private field`);
    if (typeof value === "string" && /[?&](api[_-]?key|token|signature|secret)=/i.test(value)) errors.push(`${path}: credential-like URL`);
  });
  return errors;
}

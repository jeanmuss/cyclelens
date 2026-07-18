import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DATA_MANIFEST_DATASETS = Object.freeze([
  { id: "marketMonthly", file: "market-monthly.json", pollIntervalMs: 300_000 },
  { id: "cryptoLiquidity", file: "crypto-liquidity.json", pollIntervalMs: 300_000 },
  { id: "macroCalendar", file: "macro-calendar.json", pollIntervalMs: 300_000 },
  { id: "equityWeekly", file: "equity-weekly.json", pollIntervalMs: 300_000 },
  { id: "equityFast", file: "equity-fast.json", pollIntervalMs: 60_000 },
  { id: "chartSeries", file: "chart-series.json", pollIntervalMs: 300_000 },
  { id: "marketSession", file: "market-session.json", pollIntervalMs: 300_000 },
  { id: "chipChain", file: "chip-chain-hotspots.json", pollIntervalMs: 300_000 },
  { id: "robotChain", file: "robot-chain-watchlist.json", pollIntervalMs: 300_000 },
  { id: "dashboardProjection", file: "projections/dashboard.json", pollIntervalMs: 300_000 },
  { id: "cryptoLiquidityProjection", file: "projections/crypto-liquidity.json", pollIntervalMs: 300_000 },
  { id: "usEquityProjection", file: "projections/us-equity.json", pollIntervalMs: 300_000 },
]);

export function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function latestTimestamp(values) {
  return values
    .map(validTimestamp)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

export function inferObservedAt(datasetId, payload) {
  if (datasetId.endsWith("Projection")) return validTimestamp(payload.freshness?.observedAt);
  if (datasetId === "marketMonthly") {
    return latestTimestamp(Object.values(payload.assets || {}).flatMap((asset) => [
      asset.updatedAt,
      asset.spot?.updatedAt,
      ...(asset.rows || []).slice(-2).flatMap((row) => [row.closeTime, row.highTime, row.lowTime]),
    ]));
  }
  if (datasetId === "macroCalendar") {
    return latestTimestamp((payload.summary || []).map((item) => item.latestDate));
  }
  if (datasetId === "equityWeekly") {
    return latestTimestamp([
      payload.latest?.date,
      ...Object.values(payload.latest?.assets || {}).map((item) => item?.asOf),
    ]);
  }
  if (datasetId === "equityFast") {
    return latestTimestamp((payload.metrics || []).map((item) => item.asOf));
  }
  if (datasetId === "chartSeries") {
    return latestTimestamp(Object.values(payload.series || {}).flatMap((points) => (points || []).slice(-1).map((point) => point.t)));
  }
  if (datasetId === "marketSession") {
    return latestTimestamp((payload.assets || []).flatMap((asset) => [asset.asOf, asset.marketCapAsOf]));
  }
  if (datasetId === "chipChain" || datasetId === "robotChain") {
    return latestTimestamp(Object.values(payload.assets || {}).flatMap((asset) => [
      asset.asOf,
      ...Object.values(asset.pricePaths || {}).flatMap((points) => (points || []).slice(-1).map((point) => point.t)),
    ]));
  }
  return null;
}

export function describeDatasetSource(definition, source) {
  const payload = JSON.parse(source.toString("utf8"));
  const lifecycle = payload.timestamps || payload.freshness || {};
  const observedAt = validTimestamp(lifecycle.observedAt) || inferObservedAt(definition.id, payload);
  const fetchedAt = validTimestamp(lifecycle.fetchedAt)
    || validTimestamp(lifecycle.firstFetchedAt)
    || validTimestamp(payload.fetchedAt)
    || validTimestamp(payload.generatedAt);
  const transformedAt = validTimestamp(lifecycle.transformedAt) || validTimestamp(payload.generatedAt);

  return [
    definition.id,
    {
      path: `data/${definition.file}`,
      version: createHash("sha256").update(source).digest("hex"),
      observedAt,
      fetchedAt,
      transformedAt,
      timestampFallback: payload.timestamps || payload.freshness ? null : "legacy-generatedAt",
      pollIntervalMs: definition.pollIntervalMs,
      sizeBytes: source.byteLength,
    },
  ];
}

export function createDataManifest(entries, deployedAt) {
  return {
    version: 2,
    generatedAt: deployedAt,
    deployedAt,
    datasets: Object.fromEntries(entries.map(([id, entry]) => [id, { ...entry, deployedAt }])),
  };
}

export async function buildDataManifest({
  dataDirectory,
  definitions = DATA_MANIFEST_DATASETS,
  deployedAt = new Date().toISOString(),
}) {
  const entries = await Promise.all(definitions.map(async (definition) => {
    const source = await readFile(resolve(dataDirectory, definition.file));
    return describeDatasetSource(definition, source);
  }));
  return createDataManifest(entries, deployedAt);
}

export async function writeDataManifest({ dataDirectory, outputPath }) {
  await mkdir(dataDirectory, { recursive: true });
  const manifest = await buildDataManifest({ dataDirectory });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

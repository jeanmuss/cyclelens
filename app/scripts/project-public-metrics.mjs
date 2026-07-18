import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dedupeMarketMetricRows,
  extractCryptoHistoryRows,
  extractJapanRateRows,
} from "./market-metric-history-contract.mjs";
import { validateObservationRows } from "./metric-observation-contract.mjs";
import {
  createPublicProjection,
  PUBLIC_PROJECTION_IDS,
  validatePublicProjection,
} from "./metric-projection-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const dataDirectory = resolve(appRoot, "public/data");
const projectionDirectory = resolve(dataDirectory, "projections");

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

const [crypto, equity] = await Promise.all([
  readJson(resolve(dataDirectory, "crypto-liquidity.json"), {}),
  readJson(resolve(dataDirectory, "equity-weekly.json"), {}),
]);
const generatedAt = [
  crypto?.timestamps?.transformedAt,
  crypto?.generatedAt,
  equity?.timestamps?.transformedAt,
  equity?.generatedAt,
].filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
const rows = dedupeMarketMetricRows([
  ...extractCryptoHistoryRows(crypto),
  ...extractJapanRateRows(null, equity),
]);
const validation = validateObservationRows(rows);
const results = [];
for (const projectionId of PUBLIC_PROJECTION_IDS) {
  const payload = createPublicProjection(projectionId, validation.accepted, generatedAt);
  const errors = validatePublicProjection(payload);
  if (errors.length) throw new Error(`${projectionId} projection failed contract: ${errors.join("; ")}`);
  await writeJsonAtomic(resolve(projectionDirectory, `${projectionId}.json`), payload);
  results.push({ projectionId, metrics: payload.metrics.length, observations: payload.metrics.flatMap((item) => item.observations).length });
}

console.log(JSON.stringify({ status: "projected", acceptedRows: validation.accepted.length, rejectedRows: validation.rejected.length, projections: results }));

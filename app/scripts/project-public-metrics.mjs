import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dedupeMarketMetricRows,
  extractCryptoHistoryRows,
  extractEquityDashboardRows,
  extractJapanRateRows,
  extractMacroDashboardRows,
} from "./market-metric-history-contract.mjs";
import { validateObservationRows } from "./metric-observation-contract.mjs";
import {
  createProjection,
  PUBLIC_PROJECTION_IDS,
  validateProjection,
} from "./metric-projection-contract.mjs";
import {
  DATA_USE_SCOPES,
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
  visibilityForDataUseScope,
} from "./data-use-scope.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const dataUseScope = dataUseScopeFromEnvironment(process.env, process.argv);
const dataDirectory = dataDirectoryForScope(appRoot, dataUseScope);
const projectionDirectory = dataUseScope === DATA_USE_SCOPES.OWNER_PRIVATE
  ? resolve(appRoot, "data/private/projections")
  : resolve(dataDirectory, "projections");

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

const [crypto, equity, equityFast, macro] = await Promise.all([
  readJson(resolve(dataDirectory, "crypto-liquidity.json"), {}),
  readJson(resolve(dataDirectory, "equity-weekly.json"), {}),
  readJson(resolve(dataDirectory, "equity-fast.json"), {}),
  readJson(resolve(dataDirectory, "macro-calendar.json"), {}),
]);
const generatedAt = [
  crypto?.timestamps?.transformedAt,
  crypto?.generatedAt,
  equity?.timestamps?.transformedAt,
  equity?.generatedAt,
  equityFast?.timestamps?.transformedAt,
  equityFast?.generatedAt,
  macro?.timestamps?.transformedAt,
  macro?.generatedAt,
].filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
const rows = dedupeMarketMetricRows([
  ...extractCryptoHistoryRows(crypto),
  ...extractJapanRateRows(null, equity),
  ...extractEquityDashboardRows(equity, equityFast),
  ...extractMacroDashboardRows(macro),
]);
const validation = validateObservationRows(rows, { environment: process.env, scope: dataUseScope });
const results = [];
for (const projectionId of PUBLIC_PROJECTION_IDS) {
  const payload = createProjection(projectionId, validation.accepted, generatedAt, { scope: dataUseScope });
  const errors = validateProjection(payload, { scope: dataUseScope });
  if (errors.length) throw new Error(`${projectionId} projection failed contract: ${errors.join("; ")}`);
  await writeJsonAtomic(resolve(projectionDirectory, `${projectionId}.json`), payload);
  results.push({ projectionId, metrics: payload.metrics.length, observations: payload.metrics.flatMap((item) => item.observations).length });
}

console.log(JSON.stringify({
  status: "projected",
  dataUseScope,
  visibility: visibilityForDataUseScope(dataUseScope),
  acceptedRows: validation.accepted.length,
  rejectedRows: validation.rejected.length,
  projections: results,
}));

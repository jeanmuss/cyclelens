import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_MANIFEST_DATASETS } from "./data-manifest-contract.mjs";
import {
  DATA_USE_SCOPES,
  dataDirectoryForScope,
} from "./data-use-scope.mjs";
import { validateOwnerDatasetRefresh } from "./owner-release-refresh-contract.mjs";

const MAX_DATASET_BYTES = 32 * 1024 * 1024;
const MAX_RELEASE_DATA_BYTES = 128 * 1024 * 1024;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateDataDirectory = dataDirectoryForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE);
const privateProjectionDirectory = resolve(appRoot, "data/private/projections");
const manifestPath = resolve(appRoot, "data/private/data-manifest.json");
const startedAtFile = String(process.env.CYCLELENS_RELEASE_STARTED_AT_FILE || "").trim();

const collectionFlags = Object.freeze({
  "market-monthly.json": "CYCLELENS_COLLECT_CRYPTO_MONTHLY",
  "crypto-liquidity.json": "CYCLELENS_COLLECT_CRYPTO_LIQUIDITY",
  "macro-calendar.json": "CYCLELENS_COLLECT_MACRO_CALENDAR",
  "equity-weekly.json": "CYCLELENS_COLLECT_EQUITY_WEEKLY",
  "equity-fast.json": "CYCLELENS_COLLECT_EQUITY_FAST",
  "chart-series.json": "CYCLELENS_COLLECT_CHART_SERIES",
  "market-session.json": "CYCLELENS_COLLECT_MARKET_SESSION",
  "chip-chain-hotspots.json": "CYCLELENS_COLLECT_CHIP_CHAIN",
  "robot-chain-watchlist.json": "CYCLELENS_COLLECT_ROBOT_CHAIN",
});

function parseTimestamp(value, label) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp`);
  return timestamp;
}

function collectionEnabled(fileName) {
  const variable = collectionFlags[fileName];
  const value = String(process.env[variable] || "").trim().toLowerCase();
  if (!["true", "false"].includes(value)) {
    throw new Error(`${variable} must be explicitly true or false`);
  }
  return value === "true";
}

function explicitBooleanEnvironment(variable) {
  const value = String(process.env[variable] || "").trim().toLowerCase();
  if (!["true", "false"].includes(value)) {
    throw new Error(`${variable} must be explicitly true or false`);
  }
  return value === "true";
}

function sourcePathFor(fileName) {
  return fileName.startsWith("projections/")
    ? resolve(privateProjectionDirectory, fileName.slice("projections/".length))
    : resolve(privateDataDirectory, fileName);
}

if (process.env.CYCLELENS_DATA_USE_SCOPE !== DATA_USE_SCOPES.OWNER_PRIVATE
  || process.env.CYCLELENS_OWNER_PRIVATE_USE_APPROVED !== "1"
  || process.env.CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE !== "1") {
  throw new Error("Owner release validation requires the explicit private scope and freshness gate");
}
if (!startedAtFile) throw new Error("CYCLELENS_RELEASE_STARTED_AT_FILE is required");
const releaseStartedAt = parseTimestamp(
  (await readFile(startedAtFile, "utf8")).trim(),
  "owner release start",
);
const now = Date.now();
if (releaseStartedAt > now + FUTURE_CLOCK_SKEW_MS) {
  throw new Error("Owner release start time is in the future");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const cmcCollectionRequested = explicitBooleanEnvironment("CYCLELENS_COLLECT_CMC");
if (manifest.dataUseScope !== DATA_USE_SCOPES.OWNER_PRIVATE || manifest.visibility !== "private") {
  throw new Error("Owner release manifest must be private");
}
if (Object.keys(manifest.datasets || {}).length !== DATA_MANIFEST_DATASETS.length) {
  throw new Error("Owner release manifest does not cover every dataset");
}

let totalBytes = 0;
for (const definition of DATA_MANIFEST_DATASETS) {
  const source = await readFile(sourcePathFor(definition.file));
  totalBytes += source.byteLength;
  if (source.byteLength < 2 || source.byteLength > MAX_DATASET_BYTES) {
    throw new Error(`Owner release dataset has an invalid size: ${definition.file}`);
  }
  let payload;
  try {
    payload = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error(`Owner release dataset is not valid JSON: ${definition.file}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Owner release dataset must be an object: ${definition.file}`);
  }

  const entry = manifest.datasets?.[definition.id];
  const expectedPath = `data/${definition.file}`;
  const expectedHash = createHash("sha256").update(source).digest("hex");
  if (entry?.path !== expectedPath || entry?.version !== expectedHash || entry?.sizeBytes !== source.byteLength) {
    throw new Error(`Owner release manifest mismatch: ${definition.file}`);
  }

  if (definition.file.startsWith("projections/")) {
    if (payload.dataUseScope !== DATA_USE_SCOPES.OWNER_PRIVATE || payload.visibility !== "private") {
      throw new Error(`Owner projection is not private: ${definition.file}`);
    }
    continue;
  }
  if (!collectionEnabled(definition.file)) continue;
  if (payload.dataUseScope !== DATA_USE_SCOPES.OWNER_PRIVATE) {
    throw new Error(`Enabled owner dataset is missing its private scope: ${definition.file}`);
  }
  const transformedAt = parseTimestamp(
    payload.timestamps?.transformedAt || payload.freshness?.transformedAt || payload.generatedAt,
    `${definition.file} transformedAt`,
  );
  if (transformedAt < releaseStartedAt || transformedAt > now + FUTURE_CLOCK_SKEW_MS) {
    throw new Error(`Enabled owner dataset was not transformed during this release: ${definition.file}`);
  }
  validateOwnerDatasetRefresh(definition.file, payload, { cmcCollectionRequested });
}
if (totalBytes > MAX_RELEASE_DATA_BYTES) {
  throw new Error("Owner release data exceeds the aggregate byte limit");
}

console.log(JSON.stringify({
  status: "validated-owner-release-data",
  datasets: DATA_MANIFEST_DATASETS.length,
  totalBytes,
}));

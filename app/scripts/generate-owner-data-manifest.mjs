import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATA_MANIFEST_DATASETS,
  createDataManifest,
  describeDatasetSource,
} from "./data-manifest-contract.mjs";
import {
  DATA_USE_SCOPES,
  dataDirectoryForScope,
} from "./data-use-scope.mjs";
import { validateOwnerPrivateProjection } from "./metric-projection-contract.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privateDataDirectory = dataDirectoryForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE);
const privateProjectionDirectory = resolve(appRoot, "data/private/projections");
const outputPath = resolve(appRoot, "data/private/data-manifest.json");
const deployedAt = new Date().toISOString();

const entries = await Promise.all(DATA_MANIFEST_DATASETS.map(async (definition) => {
  const projection = definition.file.startsWith("projections/");
  const sourcePath = projection
    ? resolve(privateProjectionDirectory, definition.file.slice("projections/".length))
    : resolve(privateDataDirectory, definition.file);
  let source;
  try {
    source = await readFile(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Owner manifest requires dataset: ${definition.file}`);
    }
    throw error;
  }
  if (projection) {
    let payload;
    try {
      payload = JSON.parse(source.toString("utf8"));
    } catch {
      throw new Error(`Owner manifest requires valid JSON: ${definition.file}`);
    }
    const errors = validateOwnerPrivateProjection(payload);
    if (errors.length) {
      throw new Error(`Owner manifest rejected ${definition.file}: ${errors.join("; ")}`);
    }
  }
  return describeDatasetSource(definition, source);
}));

const manifest = {
  ...createDataManifest(entries, deployedAt),
  dataUseScope: DATA_USE_SCOPES.OWNER_PRIVATE,
  visibility: "private",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: "generated",
  dataUseScope: manifest.dataUseScope,
  visibility: manifest.visibility,
  datasets: Object.keys(manifest.datasets).length,
  outputPath,
}));

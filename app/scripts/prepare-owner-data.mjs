import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_MANIFEST_DATASETS } from "./data-manifest-contract.mjs";
import {
  DATA_USE_SCOPES,
  dataDirectoryForScope,
  manualMacroEventsPathForScope,
} from "./data-use-scope.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDataDirectory = dataDirectoryForScope(appRoot, DATA_USE_SCOPES.PUBLIC);
const privateDataDirectory = dataDirectoryForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE);
const publicManualEventsPath = manualMacroEventsPathForScope(appRoot, DATA_USE_SCOPES.PUBLIC);
const privateManualEventsPath = manualMacroEventsPathForScope(appRoot, DATA_USE_SCOPES.OWNER_PRIVATE);
const rawDatasetDefinitions = DATA_MANIFEST_DATASETS.filter(({ file }) => !file.startsWith("projections/"));

if (rawDatasetDefinitions.length !== 9) {
  throw new Error(`Owner seed contract expected 9 raw datasets, found ${rawDatasetDefinitions.length}`);
}

async function seedIfMissing(sourcePath, destinationPath) {
  await access(sourcePath, constants.R_OK);
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    return "seeded";
  } catch (error) {
    if (error?.code === "EEXIST") return "preserved";
    throw error;
  }
}

const results = [];
for (const definition of rawDatasetDefinitions) {
  results.push({
    file: definition.file,
    status: await seedIfMissing(
      resolve(publicDataDirectory, definition.file),
      resolve(privateDataDirectory, definition.file),
    ),
  });
}
results.push({
  file: "manual-macro-events.json",
  status: await seedIfMissing(publicManualEventsPath, privateManualEventsPath),
});

console.log(JSON.stringify({
  status: "prepared-owner-private-data",
  seeded: results.filter((result) => result.status === "seeded").length,
  preserved: results.filter((result) => result.status === "preserved").length,
  files: results,
}));

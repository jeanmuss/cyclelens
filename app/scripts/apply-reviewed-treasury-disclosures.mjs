import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyReviewedStrategyDisclosure } from "./crypto-liquidity-contract.mjs";
import {
  DATA_USE_SCOPES,
  dataDirectoryForScope,
  dataUseScopeFromEnvironment,
  ownerPrivateUseApproved,
} from "./data-use-scope.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const dataUseScope = dataUseScopeFromEnvironment(process.env, process.argv);
if (dataUseScope !== DATA_USE_SCOPES.OWNER_PRIVATE || !ownerPrivateUseApproved(process.env)) {
  throw new Error("Reviewed treasury disclosures may only update an explicitly approved owner-private dataset");
}
const datasetPath = resolve(dataDirectoryForScope(appRoot, dataUseScope), "crypto-liquidity.json");
const disclosuresPath = resolve(appRoot, "data/corporate-treasury-disclosures.json");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

const [dataset, disclosures] = await Promise.all([
  readJson(datasetPath),
  readJson(disclosuresPath),
]);
if (dataset.dataUseScope !== DATA_USE_SCOPES.OWNER_PRIVATE) {
  throw new Error("Reviewed treasury disclosures require an owner-private input dataset");
}
const next = applyReviewedStrategyDisclosure(dataset, disclosures);
await writeJsonAtomic(datasetPath, next);
console.log(JSON.stringify({
  status: "applied",
  ticker: "MSTR",
  source: next.corporateTreasuries.MSTR.source,
  observedAt: next.corporateTreasuries.MSTR.holdingsObservedAt,
}));

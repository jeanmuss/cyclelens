import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDataManifest } from "./data-manifest-contract.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(appRoot, "public", "data");
const outputPath = resolve(dataDirectory, "data-manifest.json");

await writeDataManifest({ dataDirectory, outputPath });
console.log(`Generated ${outputPath}`);

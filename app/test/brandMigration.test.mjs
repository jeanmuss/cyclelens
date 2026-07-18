import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDir, "..");
const workspaceRoot = resolve(appRoot, "..");

async function source(path) {
  return readFile(resolve(workspaceRoot, path), "utf8");
}

test("browser metadata and the primary page heading use CycleLens identity", async () => {
  const [index, runtime, translations] = await Promise.all([
    source("app/index.html"),
    source("app/src/pages/RouteRuntime.jsx"),
    source("app/src/shared/i18n/translations.js"),
  ]);
  assert.match(index, /<title>CycleLens<\/title>/);
  assert.match(runtime, /productPageTitle\(pageMetadata\.title\)/);
  assert.match(translations, /eyebrow: PRODUCT_CONFIG\.name\.toUpperCase\(\)/);
  assert.doesNotMatch(translations, /RISK ASSET CYCLE MAP/);
});

test("local admin client and loopback API share the configured CycleLens request marker", async () => {
  const [client, api] = await Promise.all([
    source("app/src/pages/MacroAdminPage.jsx"),
    source("app/scripts/macro-events-admin-api.mjs"),
  ]);
  assert.match(client, /\[PRODUCT_CONFIG\.localAdmin\.requestHeader\]: "1"/);
  assert.match(api, /req\.headers\[PRODUCT_CONFIG\.localAdmin\.requestHeader\]/);
  assert.doesNotMatch(`${client}\n${api}`, /x-cycle-map-admin/);
});

test("market-data User-Agent defaults no longer identify the legacy repository", async () => {
  const paths = [
    "app/scripts/update-market-data.mjs",
    "app/scripts/update-crypto-liquidity-data.mjs",
    "app/scripts/update-chip-chain-data.mjs",
    "app/scripts/update-market-session-data.mjs",
    "app/scripts/update-equity-data.py",
    "app/scripts/update-equity-fast-data.py",
    "app/scripts/update-macro-calendar.py",
  ];
  const combined = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(combined, /cycle-map-[a-z-]+\/\d/i);
  assert.match(combined, /productUserAgent\("market-data"\)|cyclelens-market-data\/1\.0/);
});

test("repository docs, icons, and workflows advertise only the current product name", async () => {
  const [rootReadme, appReadme, pinwheel, tide, deploy, update, collect] = await Promise.all([
    source("README.md"),
    source("app/README.md"),
    source("app/public/favicon-pinwheel.svg"),
    source("app/public/favicon-tide.svg"),
    source(".github/workflows/deploy-pages.yml"),
    source(".github/workflows/update-market-data.yml"),
    source(".github/workflows/_collect-persist.yml"),
  ]);
  assert.match(rootReadme, /^# CycleLens$/m);
  assert.match(appReadme, /^# CycleLens$/m);
  assert.match(pinwheel, /<title id="title">CycleLens -/);
  assert.match(tide, /<title id="title">CycleLens -/);
  assert.match(`${deploy}\n${update}\n${collect}`, /CYCLELENS_REQUIRE_MARKET_HISTORY/);
  assert.doesNotMatch(`${deploy}\n${update}\n${collect}`, /CYCLE_MAP_REQUIRE_MARKET_HISTORY/);
});

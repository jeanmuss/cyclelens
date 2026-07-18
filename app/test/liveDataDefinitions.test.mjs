import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EQUITY_CHART_LIVE_DATA,
  EQUITY_SUMMARY_LIVE_DATA,
  FIVE_MINUTES_MS,
  LIVE_DATA_GROUPS,
} from "../src/shared/data/liveDataDefinitions.js";
import { PUBLIC_ROUTE_REGISTRY } from "../src/shared/routing/routeRegistry.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

test("live-data groups own unique immutable dataset contracts", () => {
  assert.equal(FIVE_MINUTES_MS, 300_000);
  assert.deepEqual(Object.keys(LIVE_DATA_GROUPS), [
    "macro",
    "equitySummary",
    "equityChart",
    "marketClock",
    "crypto",
    "cryptoLiquidity",
    "chipChain",
    "robotChain",
  ]);

  const definitions = Object.values(LIVE_DATA_GROUPS).flat();
  assert.equal(new Set(definitions.map(({ id }) => id)).size, definitions.length);
  assert.equal(new Set(definitions.map(({ path }) => path)).size, definitions.length);
  for (const group of Object.values(LIVE_DATA_GROUPS)) {
    assert.ok(Object.isFrozen(group));
    for (const definition of group) {
      assert.ok(Object.isFrozen(definition));
      assert.match(definition.path, /^data\/[a-z0-9-]+\.json$/);
      assert.ok(definition.pollIntervalMs >= 30_000 && definition.pollIntervalMs <= 3_600_000);
    }
  }
});

test("route data dependencies are backed by shared live-data definitions", () => {
  const datasetIds = new Set(Object.values(LIVE_DATA_GROUPS).flat().map(({ id }) => id));
  for (const route of PUBLIC_ROUTE_REGISTRY) {
    for (const dependency of route.dataDependencies) {
      assert.ok(datasetIds.has(dependency), `${route.id} dependency ${dependency} needs a live-data definition`);
    }
  }

  assert.equal(EQUITY_SUMMARY_LIVE_DATA.find(({ id }) => id === "equityFast").required, false);
  assert.equal(EQUITY_CHART_LIVE_DATA[0].id, "chartSeries");
  assert.equal(EQUITY_CHART_LIVE_DATA[0].required, false);
});

test("deferred chart activation keeps cleanup semantics outside page components", async () => {
  const [hookSource, cryptoComponents, equityPage, liquidityPage] = await Promise.all([
    readFile(resolve(appRoot, "src", "shared", "data", "useDeferredActivation.js"), "utf8"),
    readFile(resolve(appRoot, "src", "features", "crypto-cycle", "CryptoCycleComponents.jsx"), "utf8"),
    readFile(resolve(appRoot, "src", "pages", "EquityPage.jsx"), "utf8"),
    readFile(resolve(appRoot, "src", "pages", "CryptoLiquidityPage.jsx"), "utf8"),
  ]);

  assert.match(hookSource, /return \(\) => window\.cancelIdleCallback\(idleId\)/);
  assert.match(hookSource, /return \(\) => window\.clearTimeout\(timeoutId\)/);
  assert.match(equityPage, /from "\.\.\/shared\/data\/useDeferredActivation\.js"/);
  assert.match(liquidityPage, /CRYPTO_LIQUIDITY_LIVE_DATA.*from "\.\.\/shared\/data\/liveDataDefinitions\.js"/s);
  assert.doesNotMatch(cryptoComponents, /FIVE_MINUTES_MS|_LIVE_DATA|useDeferredActivation/);
});

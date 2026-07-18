import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { pageForLocation, routePathname } from "../src/routeResolver.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));

const PUBLIC_HASH_ROUTES = [
  ["#/crypto-liquidity", "cryptoLiquidity"],
  ["#/robot-chain", "robotChain"],
  ["#/chip-chain", "chipChain"],
  ["#/market-clock", "marketClock"],
  ["#/macro-calendar", "macro"],
  ["#/equity-macro", "equity"],
  ["#/", "crypto"],
  ["#/unknown", "crypto"],
];

test("public hash routes resolve to the existing page identifiers", () => {
  for (const [hash, expected] of PUBLIC_HASH_ROUTES) {
    assert.equal(pageForLocation({ hash }), expected, hash);
  }
});

test("admin routes remain gated by the build target", () => {
  assert.equal(pageForLocation({ hash: "#/admin/macro-events", adminEnabled: false }), "crypto");
  assert.equal(pageForLocation({ hash: "#/admin/macro-events", adminEnabled: true }), "macroAdmin");
});

test("repository base paths are removed before pathname fallback routing", () => {
  assert.equal(routePathname("/cycle-map", "/cycle-map/"), "/");
  assert.equal(routePathname("/cycle-map/equity-macro", "/cycle-map/"), "/equity-macro");
  assert.equal(routePathname("/another/equity-macro", "/cycle-map/"), "/another/equity-macro");
  assert.equal(pageForLocation({
    hash: "legacy-path-fallback",
    pathname: "/cycle-map/equity-macro",
    baseUrl: "/cycle-map/",
  }), "equity");
});

test("route selection without browser location data falls back to the crypto page", () => {
  assert.equal(pageForLocation(), "crypto");
});

test("the admin route gate remains statically removable from production builds", async () => {
  const buildTargetSource = await readFile(resolve(testDirectory, "..", "src", "buildTarget.js"), "utf8");
  const viteSource = await readFile(resolve(testDirectory, "..", "vite.config.mjs"), "utf8");
  assert.match(buildTargetSource, /ADMIN_PAGE_ENABLED = import\.meta\.env\.CYCLELENS_ADMIN_ENABLED;/);
  assert.match(viteSource, /"import\.meta\.env\.CYCLELENS_ADMIN_ENABLED"/);
  assert.match(viteSource, /isAdminBuildTarget\(buildTarget\)/);
});

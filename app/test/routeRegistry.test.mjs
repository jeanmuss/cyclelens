import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PAGE_IDENTITIES, pageIdentity, pageMetadata } from "../src/shared/i18n/pageIdentity.js";
import { PUBLIC_ROUTE_LOADERS } from "../src/shared/routing/routeLoaders.js";
import {
  ADMIN_ROUTE_DEFINITION,
  DEFAULT_ROUTE_ID,
  metadataForRoute,
  navigationRoutes,
  PUBLIC_ROUTE_REGISTRY,
  registeredRoute,
  registeredRoutes,
  routeIdForPath,
} from "../src/shared/routing/routeRegistry.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

const EXPECTED_PUBLIC_ROUTES = [
  ["crypto", "", "/"],
  ["cryptoLiquidity", "crypto-liquidity", "/crypto-liquidity"],
  ["macro", "macro-calendar", "/macro-calendar"],
  ["equity", "equity-macro", "/equity-macro"],
  ["marketClock", "market-clock", "/market-clock"],
  ["chipChain", "chip-chain", "/chip-chain"],
  ["robotChain", "robot-chain", "/robot-chain"],
];

test("the public registry owns unique route, navigation, and data contracts", () => {
  assert.equal(DEFAULT_ROUTE_ID, "crypto");
  assert.deepEqual(
    PUBLIC_ROUTE_REGISTRY.map(({ id, hashPath, matchPath }) => [id, hashPath, matchPath]),
    EXPECTED_PUBLIC_ROUTES,
  );
  assert.equal(new Set(PUBLIC_ROUTE_REGISTRY.map((route) => route.id)).size, PUBLIC_ROUTE_REGISTRY.length);
  assert.equal(new Set(PUBLIC_ROUTE_REGISTRY.map((route) => route.hashPath)).size, PUBLIC_ROUTE_REGISTRY.length);
  for (const route of PUBLIC_ROUTE_REGISTRY) {
    assert.equal(route.admin, false);
    assert.equal(route.navigation, true);
    assert.equal(route.loadRoute, undefined, "route metadata must not depend on lazy page modules");
    assert.equal(typeof PUBLIC_ROUTE_LOADERS[route.id], "function");
    assert.ok(route.dataDependencies.length > 0, `${route.id} must declare its static data dependencies`);
    assert.ok(Object.isFrozen(route));
    assert.ok(Object.isFrozen(route.dataDependencies));
  }
});

test("admin registration is explicit and excluded from public route/navigation lists", () => {
  assert.equal(ADMIN_ROUTE_DEFINITION.id, "macroAdmin");
  assert.equal(ADMIN_ROUTE_DEFINITION.admin, true);
  assert.equal(ADMIN_ROUTE_DEFINITION.loadRoute, undefined, "the admin loader stays behind the App build gate");
  assert.deepEqual(registeredRoutes().map((route) => route.id), EXPECTED_PUBLIC_ROUTES.map(([id]) => id));
  assert.equal(registeredRoutes({ adminEnabled: true }).at(-1), ADMIN_ROUTE_DEFINITION);
  assert.equal(navigationRoutes().some((route) => route.admin), false);
  assert.equal(navigationRoutes({ adminEnabled: true }).at(-1).id, "macroAdmin");
  assert.equal(registeredRoute("macroAdmin").id, DEFAULT_ROUTE_ID);
  assert.equal(registeredRoute("macroAdmin", { adminEnabled: true }), ADMIN_ROUTE_DEFINITION);
});

test("route matching is driven by registry paths with a fail-closed default", () => {
  for (const [id, , matchPath] of EXPECTED_PUBLIC_ROUTES) {
    assert.equal(routeIdForPath(matchPath), id);
    if (id !== DEFAULT_ROUTE_ID) assert.equal(routeIdForPath(`${matchPath}/details`), id);
  }
  assert.equal(routeIdForPath("/admin/macro-events"), DEFAULT_ROUTE_ID);
  assert.equal(routeIdForPath("/admin/macro-events", { adminEnabled: true }), "macroAdmin");
  assert.equal(routeIdForPath("/unknown"), DEFAULT_ROUTE_ID);
});

test("route navigation labels and metadata have one bilingual identity source", () => {
  const routeIds = [...EXPECTED_PUBLIC_ROUTES.map(([id]) => id), "macroAdmin"];
  for (const language of ["zh", "en"]) {
    assert.deepEqual(Object.keys(PAGE_IDENTITIES[language]), routeIds);
    for (const pageId of routeIds) {
      const identity = pageIdentity(pageId, language);
      assert.ok(identity.navLabel);
      assert.ok(identity.title);
      assert.ok(identity.description);
      assert.deepEqual(pageMetadata(pageId, language), {
        title: identity.title,
        description: identity.description,
      });
      assert.deepEqual(metadataForRoute(pageId, language), pageMetadata(pageId, language));
    }
  }
  assert.equal(pageIdentity("crypto", "zh-CN").navLabel, "加密周期");
  assert.equal(pageIdentity("crypto", "en-US").navLabel, "Crypto cycle");
  assert.equal(pageIdentity("unknown", "en").title, PAGE_IDENTITIES.en.crypto.title);
});

test("route wrappers pass registry ids while App keeps the admin loader statically gated", async () => {
  const appSource = await readFile(resolve(appRoot, "src", "App.jsx"), "utf8");
  assert.match(appSource, /PUBLIC_ROUTE_REGISTRY\.map\(\(route\) => \[route\.id, lazy\(PUBLIC_ROUTE_LOADERS\[route\.id\]\)\]\)/);
  assert.match(appSource, /ADMIN_PAGE_ENABLED\s*\?\s*lazy\(\(\) => import\("\.\/routes\/MacroAdminRoute\.js"\)\)\s*:\s*null/);

  const routeFiles = {
    crypto: "CryptoRoute.js",
    cryptoLiquidity: "CryptoLiquidityRoute.js",
    macro: "MacroRoute.js",
    equity: "EquityRoute.js",
    marketClock: "MarketClockRoute.js",
    chipChain: "ChipChainRoute.js",
    robotChain: "RobotChainRoute.js",
    macroAdmin: "MacroAdminRoute.js",
  };
  for (const [routeId, file] of Object.entries(routeFiles)) {
    const source = await readFile(resolve(appRoot, "src", "routes", file), "utf8");
    assert.match(source, new RegExp(`routeId: "${routeId}"`), file);
    assert.doesNotMatch(source, /Metadata/);
  }
});

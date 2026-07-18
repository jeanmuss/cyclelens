import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(appRoot, "src");

async function filesUnder(directory, extensions = new Set([".js", ".jsx"])) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(absolutePath, extensions);
    return extensions.has(path.extname(entry.name)) ? [absolutePath] : [];
  }));
  return nested.flat();
}

function relativeFromSrc(filePath) {
  return path.relative(srcRoot, filePath).replaceAll("\\", "/");
}

function relativeImports(source) {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}

function resolveModule(importer, specifier) {
  const resolved = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [resolved, `${resolved}.js`, `${resolved}.jsx`, path.join(resolved, "index.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

test("frontend source graph is acyclic and every relative module import resolves", async () => {
  const files = await filesUnder(srcRoot);
  const fileSet = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const dependencies = relativeImports(source)
      .map((specifier) => resolveModule(file, specifier))
      .filter((dependency) => dependency && fileSet.has(dependency));
    assert.equal(dependencies.length, relativeImports(source).filter((specifier) => /\.(?:js|jsx)$/.test(specifier)).length,
      `${relativeFromSrc(file)} has an unresolved relative module import`);
    graph.set(file, dependencies);
  }

  const active = new Set();
  const complete = new Set();
  const visit = (file, chain = []) => {
    if (active.has(file)) {
      const cycle = [...chain, file].map(relativeFromSrc).join(" -> ");
      assert.fail(`cyclic frontend dependency: ${cycle}`);
    }
    if (complete.has(file)) return;
    active.add(file);
    for (const dependency of graph.get(file) || []) visit(dependency, [...chain, file]);
    active.delete(file);
    complete.add(file);
  };
  for (const file of files) visit(file);
});

test("feature modules do not import pages or sibling feature internals", async () => {
  const featureFiles = await filesUnder(path.join(srcRoot, "features"));
  for (const file of featureFiles) {
    const source = await readFile(file, "utf8");
    for (const specifier of relativeImports(source)) {
      assert.doesNotMatch(specifier, /(?:^|\/)pages(?:\/|$)/, `${relativeFromSrc(file)} imports a page`);
      assert.doesNotMatch(specifier, /^\.\.\/(?!\.\.\/)/, `${relativeFromSrc(file)} imports a sibling feature`);
    }
  }
  assert.equal(existsSync(path.join(srcRoot, "pages", "AppShared.jsx")), false);
});

test("page calculations live in React-free model modules", async () => {
  const contracts = [
    ["pages/MacroPage.jsx", "features/macro/macroCalendarModel.js"],
    ["pages/EquityPage.jsx", "features/us-equity/equityModel.js"],
    ["pages/MarketClockPage.jsx", "features/market-clock/marketClockModel.js"],
    ["pages/ChipChainPage.jsx", "features/chip-chain/chipChainModel.js"],
    ["pages/RobotChainPage.jsx", "features/robot-chain/robotChainModel.js"],
    ["pages/MacroAdminPage.jsx", "features/admin-macro-events/adminMacroModel.js"],
  ];
  for (const [pagePath, modelPath] of contracts) {
    const [pageSource, modelSource] = await Promise.all([
      readFile(path.join(srcRoot, pagePath), "utf8"),
      readFile(path.join(srcRoot, modelPath), "utf8"),
    ]);
    assert.match(pageSource, new RegExp(modelPath.split("/").at(-1).replace(".", "\\.")));
    assert.doesNotMatch(modelSource, /from\s+["']react["']/);
    assert.doesNotMatch(modelSource, /\buse(?:Effect|Memo|State|Callback|Ref)\b/);
  }
});

test("all public loading/error/empty/partial/stale states share one contract", async () => {
  const stateSource = await readFile(path.join(srcRoot, "shared/components/DataState.jsx"), "utf8");
  for (const variant of ["loading", "error", "empty", "stale", "partial"]) assert.match(stateSource, new RegExp(`"${variant}"`));
  for (const pageName of [
    "CryptoPage.jsx",
    "CryptoLiquidityPage.jsx",
    "MacroPage.jsx",
    "EquityPage.jsx",
    "MarketClockPage.jsx",
    "ChipChainPage.jsx",
    "RobotChainPage.jsx",
  ]) {
    const source = await readFile(path.join(srcRoot, "pages", pageName), "utf8");
    assert.match(source, /shared\/components\/DataState\.jsx/);
    assert.match(source, /<DataState\b/);
  }
  const appSource = await readFile(path.join(srcRoot, "App.jsx"), "utf8");
  assert.match(appSource, /<DataState\s+as="main"\s+variant="loading"/);
});

test("styles entrypoint preserves the reviewed token/base/component/feature order", async () => {
  const expectedImports = [
    "./shared/styles/tokens.css",
    "./shared/styles/base.css",
    "./shared/styles/components.css",
    "./features/crypto-cycle/crypto-summary.css",
    "./features/us-equity/equity-summary.css",
    "./shared/styles/controls.css",
    "./features/crypto-cycle/crypto-cycle.css",
    "./features/us-equity/us-equity.css",
    "./features/macro/macro.css",
    "./features/admin-macro-events/admin.css",
    "./features/macro/macro-calendar.css",
    "./features/market-clock/market-clock.css",
    "./features/chip-chain/chip-chain.css",
    "./features/robot-chain/robot-chain.css",
    "./shared/styles/data-trust.css",
    "./shared/styles/responsive.css",
    "./features/chip-chain/chip-pending.css",
    "./features/crypto-liquidity/crypto-liquidity.css",
    "./shared/styles/reduced-motion.css",
  ];
  const entrySource = await readFile(path.join(srcRoot, "styles.css"), "utf8");
  const imports = [...entrySource.matchAll(/@import\s+["']([^"']+)["'];/g)].map((match) => match[1]);
  assert.deepEqual(imports, expectedImports);
  assert.equal(entrySource.replaceAll(/@import[^;]+;\s*/g, ""), "");
  for (const specifier of imports) {
    const stylePath = path.resolve(srcRoot, specifier);
    const source = await readFile(stylePath, "utf8");
    assert.ok(source.trim().length > 0, `${specifier} is empty`);
  }
});

test("route registry keeps every public route behind a distinct lazy route module", async () => {
  const [appSource, loaderSource] = await Promise.all([
    readFile(path.join(srcRoot, "App.jsx"), "utf8"),
    readFile(path.join(srcRoot, "shared/routing/routeLoaders.js"), "utf8"),
  ]);
  assert.doesNotMatch(appSource, /from\s+["'].+\/pages\//);
  for (const routeName of ["Crypto", "CryptoLiquidity", "Macro", "Equity", "MarketClock", "ChipChain", "RobotChain"]) {
    assert.match(loaderSource, new RegExp(`import\\(\\"\\.\\.\\/\\.\\.\\/routes\\/${routeName}Route\\.js\\"\\)`));
    const routeSource = await readFile(path.join(srcRoot, "routes", `${routeName}Route.js`), "utf8");
    assert.match(routeSource, new RegExp(`pages/${routeName}Page\\.jsx`));
  }
});

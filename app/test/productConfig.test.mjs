import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PRODUCT_CONFIG,
  githubPagesBase,
  isAdminBuildTarget,
  isProtectedBuildTarget,
  preferredEnvironmentValue,
  productPageTitle,
  productStorageKey,
  productUserAgent,
  repositoryNameFromGitHub,
  resolveBuildTarget,
} from "../product.config.mjs";
import viteConfig, {
  OWNER_DATASET_DEFINITIONS,
  OWNER_PROJECTION_FILES,
  OWNER_RAW_DATA_FILES,
  overlayOwnerManifest,
  overlayOwnerProjections,
  overlayOwnerRawData,
} from "../vite.config.mjs";

test("CycleLens product identity and storage namespace have one canonical definition", () => {
  assert.equal(PRODUCT_CONFIG.name, "CycleLens");
  assert.equal(PRODUCT_CONFIG.repositoryName, "cyclelens");
  assert.equal(PRODUCT_CONFIG.legacyRepositoryName, "cycle-map");
  assert.equal(PRODUCT_CONFIG.localAdmin.requestHeader, "x-cyclelens-admin");
  assert.equal(PRODUCT_CONFIG.localAdmin.defaultActor, "cyclelens_local_admin");
  assert.equal(productStorageKey(PRODUCT_CONFIG.storageKeys.language), "cyclelens:language");
  assert.equal(
    productStorageKey(PRODUCT_CONFIG.storageKeys.marketClockHideCrypto),
    "cyclelens:market-clock:hide-crypto",
  );
  assert.equal(productStorageKey(PRODUCT_CONFIG.storageKeys.dashboardLayout), "cyclelens:dashboard:layout");
});

test("page titles, User-Agent values, and environment aliases follow CycleLens identity", () => {
  assert.equal(productPageTitle("Risk Asset Dashboard"), "Risk Asset Dashboard | CycleLens");
  assert.equal(productPageTitle("CycleLens"), "CycleLens");
  assert.equal(productPageTitle(""), "CycleLens");
  assert.equal(productUserAgent("market-data"), "cyclelens-market-data/1.0");
  assert.equal(productUserAgent("data-cache", "2.0"), "cyclelens-data-cache/2.0");
  assert.throws(() => productUserAgent(""), /component is required/);

  assert.equal(preferredEnvironmentValue({ NEW_NAME: "new", OLD_NAME: "old" }, "NEW_NAME", "OLD_NAME"), "new");
  assert.equal(preferredEnvironmentValue({ OLD_NAME: "old" }, "NEW_NAME", "OLD_NAME"), "old");
  assert.equal(preferredEnvironmentValue({ NEW_NAME: "", OLD_NAME: "old" }, "NEW_NAME", "OLD_NAME"), "");
});

test("GitHub repository context selects both old and new Pages base paths", () => {
  assert.equal(repositoryNameFromGitHub("jeanmuss/cycle-map"), "cycle-map");
  assert.equal(repositoryNameFromGitHub("jeanmuss/cyclelens"), "cyclelens");
  assert.equal(repositoryNameFromGitHub(null), "cyclelens");
  assert.equal(githubPagesBase({ githubRepository: "jeanmuss/cycle-map" }), "/cycle-map/");
  assert.equal(githubPagesBase({ githubRepository: "jeanmuss/cyclelens" }), "/cyclelens/");
  assert.equal(githubPagesBase({ explicitBase: "/preview/" }), "/preview/");
});

test("build targets distinguish owner, admin, public, retired, and local development", () => {
  const { buildTargets } = PRODUCT_CONFIG;
  assert.equal(resolveBuildTarget(undefined), buildTargets.public);
  assert.equal(resolveBuildTarget("unexpected"), buildTargets.public);
  assert.equal(resolveBuildTarget(buildTargets.admin), buildTargets.admin);
  assert.equal(resolveBuildTarget(buildTargets.owner), buildTargets.owner);
  assert.equal(resolveBuildTarget(buildTargets.publicRetired), buildTargets.publicRetired);
  assert.equal(isAdminBuildTarget(buildTargets.public), false);
  assert.equal(isAdminBuildTarget(buildTargets.development), true);
  assert.equal(isAdminBuildTarget(buildTargets.admin), true);
  assert.equal(isAdminBuildTarget(buildTargets.owner), true);
  assert.equal(isProtectedBuildTarget(buildTargets.development), false);
  assert.equal(isProtectedBuildTarget(buildTargets.public), false);
  assert.equal(isProtectedBuildTarget(buildTargets.admin), true);
  assert.equal(isProtectedBuildTarget(buildTargets.owner), true);
});

test("Vite requires an explicit protected production mode and keeps local development local", () => {
  const previous = {
    GITHUB_PAGES: process.env.GITHUB_PAGES,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_PAGES_BASE: process.env.GITHUB_PAGES_BASE,
    CYCLELENS_BUILD_TARGET: process.env.CYCLELENS_BUILD_TARGET,
    CYCLELENS_PROTECTED_BUILD_APPROVED: process.env.CYCLELENS_PROTECTED_BUILD_APPROVED,
  };
  try {
    process.env.GITHUB_PAGES = "false";
    process.env.GITHUB_REPOSITORY = "jeanmuss/cyclelens";
    delete process.env.GITHUB_PAGES_BASE;
    delete process.env.CYCLELENS_BUILD_TARGET;
    delete process.env.CYCLELENS_PROTECTED_BUILD_APPROVED;
    assert.throws(
      () => viteConfig({ command: "build" }),
      /explicit --mode owner or --mode admin/,
    );
    assert.throws(
      () => viteConfig({ command: "build", mode: "owner" }),
      /CYCLELENS_PROTECTED_BUILD_APPROVED=1/,
    );
    process.env.CYCLELENS_PROTECTED_BUILD_APPROVED = "1";
    const ownerConfig = viteConfig({ command: "build", mode: "owner" });
    assert.equal(ownerConfig.base, "/");
    assert.equal(ownerConfig.build.outDir, "dist-owner");
    assert.equal(ownerConfig.define["import.meta.env.CYCLELENS_BUILD_TARGET"], '"owner"');
    assert.equal(ownerConfig.define["import.meta.env.CYCLELENS_ADMIN_ENABLED"], "true");
    assert.equal(ownerConfig.define["import.meta.env.CYCLELENS_ADMIN_DEFAULT_ROUTE"], "false");

    const developmentConfig = viteConfig({ command: "serve" });
    assert.equal(developmentConfig.base, "/");
    assert.equal(developmentConfig.define["import.meta.env.CYCLELENS_BUILD_TARGET"], '"development"');
    assert.equal(developmentConfig.define["import.meta.env.CYCLELENS_ADMIN_ENABLED"], "true");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("protected builds emit an all-route boundary and target-specific release marker", () => {
  const previousTarget = process.env.CYCLELENS_BUILD_TARGET;
  const previousPages = process.env.GITHUB_PAGES;
  const previousApproval = process.env.CYCLELENS_PROTECTED_BUILD_APPROVED;
  try {
    delete process.env.CYCLELENS_BUILD_TARGET;
    process.env.GITHUB_PAGES = "false";
    process.env.CYCLELENS_PROTECTED_BUILD_APPROVED = "1";
    for (const [mode, expected] of [
      ["owner", { outDir: "dist-owner", marker: "owner-release.json", defaultRoute: "dashboard" }],
      ["admin", { outDir: "dist-admin", marker: "admin-release.json", defaultRoute: "macroAdmin" }],
    ]) {
      const config = viteConfig({ command: "build", mode });
      assert.equal(config.build.outDir, expected.outDir);
      const plugin = config.plugins.find((candidate) => candidate?.name === "cyclelens-protected-boundary");
      assert.ok(plugin, `${mode} requires the protected boundary plugin`);
      const emitted = [];
      plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
      const routes = emitted.find((asset) => asset.fileName === "_routes.json");
      const marker = emitted.find((asset) => asset.fileName === expected.marker);
      assert.deepEqual(JSON.parse(routes.source), { version: 1, include: ["/*"], exclude: [] });
      assert.equal(JSON.parse(marker.source).buildTarget, mode);
      assert.equal(JSON.parse(marker.source).defaultRoute, expected.defaultRoute);
      assert.equal(JSON.parse(marker.source).routesProtected[0], "/*");
      assert.deepEqual(
        JSON.parse(marker.source).privateProjectionOverlay,
        mode === "owner" ? ["crypto-liquidity.json", "dashboard.json", "us-equity.json"] : [],
      );
      assert.deepEqual(
        JSON.parse(marker.source).privateRawDataOverlay,
        mode === "owner" ? OWNER_RAW_DATA_FILES : [],
      );
      assert.equal(JSON.parse(marker.source).dataManifest, mode === "owner" ? "data/data-manifest.json" : null);
      assert.match(JSON.stringify(plugin.transformIndexHtml()), /noindex, nofollow, noarchive/);
    }
  } finally {
    if (previousTarget === undefined) delete process.env.CYCLELENS_BUILD_TARGET;
    else process.env.CYCLELENS_BUILD_TARGET = previousTarget;
    if (previousPages === undefined) delete process.env.GITHUB_PAGES;
    else process.env.GITHUB_PAGES = previousPages;
    if (previousApproval === undefined) delete process.env.CYCLELENS_PROTECTED_BUILD_APPROVED;
    else process.env.CYCLELENS_PROTECTED_BUILD_APPROVED = previousApproval;
  }
});

test("owner data overlay copies only fixed private raw data and projections before manifest verification", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cyclelens-owner-overlay-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourceDirectory = join(temporaryRoot, "private");
  const rawSourceDirectory = join(temporaryRoot, "private-raw");
  const outputDataDirectory = join(temporaryRoot, "dist-data");
  const outputDirectory = join(outputDataDirectory, "projections");
  const manifestPath = join(temporaryRoot, "data-manifest.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(rawSourceDirectory, { recursive: true });
  assert.equal(OWNER_RAW_DATA_FILES.length, 9);
  await assert.rejects(
    overlayOwnerRawData(rawSourceDirectory, outputDataDirectory),
    /Owner build requires private raw dataset: market-monthly\.json/,
  );
  const rawSources = new Map();
  for (const [index, fileName] of OWNER_RAW_DATA_FILES.entries()) {
    const source = JSON.stringify({ ownerRaw: true, index });
    rawSources.set(fileName, source);
    await writeFile(join(rawSourceDirectory, fileName), source, "utf8");
  }
  await writeFile(join(rawSourceDirectory, "unexpected-private.json"), '{"mustNotCopy":true}', "utf8");
  await overlayOwnerRawData(rawSourceDirectory, outputDataDirectory);
  for (const [index, fileName] of OWNER_RAW_DATA_FILES.entries()) {
    assert.deepEqual(JSON.parse(await readFile(join(outputDataDirectory, fileName), "utf8")), {
      ownerRaw: true,
      index,
    });
  }
  await assert.rejects(readFile(join(outputDataDirectory, "unexpected-private.json")), { code: "ENOENT" });

  await assert.rejects(
    overlayOwnerProjections(sourceDirectory, outputDirectory),
    /Owner build requires private projection: crypto-liquidity\.json/,
  );

  const projectionSources = new Map();
  for (const [index, fileName] of OWNER_PROJECTION_FILES.entries()) {
    const source = JSON.stringify({ private: true, index });
    projectionSources.set(fileName, source);
    await writeFile(join(sourceDirectory, fileName), source, "utf8");
  }
  await writeFile(join(sourceDirectory, "unexpected-private.json"), '{"mustNotCopy":true}', "utf8");
  await overlayOwnerProjections(sourceDirectory, outputDirectory);

  for (const [index, fileName] of OWNER_PROJECTION_FILES.entries()) {
    assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, fileName), "utf8")), {
      private: true,
      index,
    });
  }
  await assert.rejects(readFile(join(outputDirectory, "unexpected-private.json")), { code: "ENOENT" });

  const finalSources = new Map();
  for (const definition of OWNER_DATASET_DEFINITIONS) {
    const finalPath = join(outputDataDirectory, definition.file);
    let source;
    if (definition.file.startsWith("projections/")) {
      source = projectionSources.get(definition.file.slice("projections/".length));
    } else {
      source = rawSources.get(definition.file);
    }
    finalSources.set(definition.file, source);
  }
  await assert.rejects(
    overlayOwnerManifest(manifestPath, outputDataDirectory),
    /requires private data-manifest\.json/,
  );
  const manifest = {
    dataUseScope: "owner_private",
    visibility: "private",
    datasets: Object.fromEntries(OWNER_DATASET_DEFINITIONS.map((definition) => [
      definition.id,
      {
        path: `data/${definition.file}`,
        version: createHash("sha256").update(finalSources.get(definition.file)).digest("hex"),
      },
    ])),
  };
  await writeFile(manifestPath, JSON.stringify({ ...manifest, dataUseScope: "public" }), "utf8");
  await assert.rejects(
    overlayOwnerManifest(manifestPath, outputDataDirectory),
    /requires an owner-private data manifest/,
  );
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    datasets: {
      ...manifest.datasets,
      cryptoLiquidityProjection: {
        ...manifest.datasets.cryptoLiquidityProjection,
        version: "0".repeat(64),
      },
    },
  }), "utf8");
  await assert.rejects(
    overlayOwnerManifest(manifestPath, outputDataDirectory),
    /does not match final dataset: projections\/crypto-liquidity\.json/,
  );
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await overlayOwnerManifest(manifestPath, outputDataDirectory);
  assert.deepEqual(
    JSON.parse(await readFile(join(outputDataDirectory, "data-manifest.json"), "utf8")),
    manifest,
  );
});

test("production build modes reject development and environment downgrades", () => {
  const previousTarget = process.env.CYCLELENS_BUILD_TARGET;
  const previousPages = process.env.GITHUB_PAGES;
  try {
    process.env.GITHUB_PAGES = "false";
    process.env.CYCLELENS_BUILD_TARGET = "development";
    assert.throws(
      () => viteConfig({ command: "build", mode: "owner" }),
      /development target cannot be used/,
    );

    process.env.CYCLELENS_BUILD_TARGET = "public";
    assert.throws(
      () => viteConfig({ command: "build", mode: "owner" }),
      /cannot override the owner build mode/,
    );
    assert.throws(
      () => viteConfig({ command: "build", mode: "admin" }),
      /cannot override the admin build mode/,
    );

    delete process.env.CYCLELENS_BUILD_TARGET;
    process.env.GITHUB_PAGES = "true";
    assert.throws(
      () => viteConfig({ command: "build", mode: "owner" }),
      /cannot target GitHub Pages/,
    );

    assert.throws(
      () => viteConfig({ command: "build", mode: "public" }),
      /Public data builds are retired/,
    );
  } finally {
    if (previousTarget === undefined) delete process.env.CYCLELENS_BUILD_TARGET;
    else process.env.CYCLELENS_BUILD_TARGET = previousTarget;
    if (previousPages === undefined) delete process.env.GITHUB_PAGES;
    else process.env.GITHUB_PAGES = previousPages;
  }
});

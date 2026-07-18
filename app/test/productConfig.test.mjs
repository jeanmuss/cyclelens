import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_CONFIG,
  githubPagesBase,
  isAdminBuildTarget,
  productStorageKey,
  repositoryNameFromGitHub,
  resolveBuildTarget,
} from "../product.config.mjs";
import viteConfig from "../vite.config.mjs";

test("CycleLens product identity and storage namespace have one canonical definition", () => {
  assert.equal(PRODUCT_CONFIG.name, "CycleLens");
  assert.equal(PRODUCT_CONFIG.repositoryName, "cyclelens");
  assert.equal(PRODUCT_CONFIG.legacyRepositoryName, "cycle-map");
  assert.equal(productStorageKey(PRODUCT_CONFIG.storageKeys.language), "cyclelens:language");
  assert.equal(
    productStorageKey(PRODUCT_CONFIG.storageKeys.marketClockHideCrypto),
    "cyclelens:market-clock:hide-crypto",
  );
});

test("GitHub repository context selects both old and new Pages base paths", () => {
  assert.equal(repositoryNameFromGitHub("jeanmuss/cycle-map"), "cycle-map");
  assert.equal(repositoryNameFromGitHub("jeanmuss/cyclelens"), "cyclelens");
  assert.equal(repositoryNameFromGitHub(null), "cyclelens");
  assert.equal(githubPagesBase({ githubRepository: "jeanmuss/cycle-map" }), "/cycle-map/");
  assert.equal(githubPagesBase({ githubRepository: "jeanmuss/cyclelens" }), "/cyclelens/");
  assert.equal(githubPagesBase({ explicitBase: "/preview/" }), "/preview/");
});

test("build targets default to public and enable admin code only when explicit", () => {
  const { buildTargets } = PRODUCT_CONFIG;
  assert.equal(resolveBuildTarget(undefined), buildTargets.public);
  assert.equal(resolveBuildTarget("unexpected"), buildTargets.public);
  assert.equal(resolveBuildTarget(buildTargets.admin), buildTargets.admin);
  assert.equal(isAdminBuildTarget(buildTargets.public), false);
  assert.equal(isAdminBuildTarget(buildTargets.development), true);
  assert.equal(isAdminBuildTarget(buildTargets.admin), true);
});

test("Vite injects fail-closed public and local-development build targets", () => {
  const previous = {
    GITHUB_PAGES: process.env.GITHUB_PAGES,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_PAGES_BASE: process.env.GITHUB_PAGES_BASE,
    CYCLELENS_BUILD_TARGET: process.env.CYCLELENS_BUILD_TARGET,
  };
  try {
    process.env.GITHUB_PAGES = "true";
    process.env.GITHUB_REPOSITORY = "jeanmuss/cyclelens";
    delete process.env.GITHUB_PAGES_BASE;
    delete process.env.CYCLELENS_BUILD_TARGET;
    const publicConfig = viteConfig({ command: "build" });
    assert.equal(publicConfig.base, "/cyclelens/");
    assert.equal(publicConfig.define["import.meta.env.CYCLELENS_BUILD_TARGET"], '"public"');
    assert.equal(publicConfig.define["import.meta.env.CYCLELENS_ADMIN_ENABLED"], "false");

    process.env.GITHUB_PAGES = "false";
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

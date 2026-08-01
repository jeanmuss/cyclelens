import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PRODUCT_CONFIG,
  githubPagesBase,
  isAdminBuildTarget,
  isProtectedBuildTarget,
  resolveBuildTarget,
} from "./product.config.mjs";
import { DATA_MANIFEST_DATASETS } from "./scripts/data-manifest-contract.mjs";

export const OWNER_PROJECTION_FILES = Object.freeze([
  "crypto-liquidity.json",
  "dashboard.json",
  "us-equity.json",
]);
export const OWNER_RAW_DATA_FILES = Object.freeze(DATA_MANIFEST_DATASETS
  .map((definition) => definition.file)
  .filter((fileName) => !fileName.startsWith("projections/")));
export const OWNER_DATASET_DEFINITIONS = Object.freeze(DATA_MANIFEST_DATASETS.map((definition) => Object.freeze({
  id: definition.id,
  file: definition.file,
})));

async function overlayRequiredOwnerFiles(sourceDirectory, outputDirectory, fileNames, kind) {
  for (const fileName of fileNames) {
    try {
      await access(resolve(sourceDirectory, fileName));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Owner build requires private ${kind}: ${fileName}`);
      }
      throw error;
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(fileNames.map((fileName) => copyFile(
    resolve(sourceDirectory, fileName),
    resolve(outputDirectory, fileName),
  )));
}

export function overlayOwnerRawData(sourceDirectory, outputDirectory) {
  return overlayRequiredOwnerFiles(
    sourceDirectory,
    outputDirectory,
    OWNER_RAW_DATA_FILES,
    "raw dataset",
  );
}

export function overlayOwnerProjections(sourceDirectory, outputDirectory) {
  return overlayRequiredOwnerFiles(
    sourceDirectory,
    outputDirectory,
    OWNER_PROJECTION_FILES,
    "projection",
  );
}

export async function overlayOwnerManifest(manifestPath, outputDataDirectory) {
  let source;
  try {
    source = await readFile(manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Owner build requires private data-manifest.json");
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Owner build requires a valid private data-manifest.json");
  }
  if (manifest?.dataUseScope !== "owner_private" || manifest?.visibility !== "private") {
    throw new Error("Owner build requires an owner-private data manifest");
  }
  if (Object.keys(manifest.datasets || {}).length !== OWNER_DATASET_DEFINITIONS.length) {
    throw new Error("Owner manifest does not cover the final owner data view");
  }
  for (const definition of OWNER_DATASET_DEFINITIONS) {
    const finalSource = await readFile(resolve(outputDataDirectory, definition.file));
    const expectedVersion = createHash("sha256").update(finalSource).digest("hex");
    const manifestEntry = manifest.datasets?.[definition.id];
    if (manifestEntry?.path !== `data/${definition.file}` || manifestEntry.version !== expectedVersion) {
      throw new Error(`Owner manifest does not match final dataset: ${definition.file}`);
    }
  }
  await mkdir(outputDataDirectory, { recursive: true });
  await copyFile(manifestPath, resolve(outputDataDirectory, "data-manifest.json"));
}

export default defineConfig(({ command, mode }) => {
  const { buildTargets } = PRODUCT_CONFIG;
  const defaultBuildTarget = command === "serve" ? buildTargets.development : null;
  const buildModes = new Map([
    [buildTargets.admin, buildTargets.admin],
    [buildTargets.owner, buildTargets.owner],
    [buildTargets.public, buildTargets.public],
  ]);
  const modeBuildTarget = buildModes.get(mode) || defaultBuildTarget;
  if (command === "build" && !modeBuildTarget) {
    throw new Error("Protected builds require an explicit --mode owner or --mode admin");
  }
  if (command === "build" && modeBuildTarget === buildTargets.public) {
    throw new Error("Public data builds are retired; use the data-free public retirement build");
  }
  const requestedBuildTarget = String(process.env.CYCLELENS_BUILD_TARGET || "").trim();
  if (command === "build" && requestedBuildTarget) {
    if (!Object.values(buildTargets).includes(requestedBuildTarget)) {
      throw new Error(`Unsupported production build target: ${requestedBuildTarget}`);
    }
    if (requestedBuildTarget === buildTargets.development) {
      throw new Error("The development target cannot be used for a production build");
    }
    if (requestedBuildTarget !== modeBuildTarget) {
      throw new Error(`CYCLELENS_BUILD_TARGET cannot override the ${modeBuildTarget} build mode`);
    }
  }
  const buildTarget = resolveBuildTarget(requestedBuildTarget, modeBuildTarget);
  const adminBuild = buildTarget === PRODUCT_CONFIG.buildTargets.admin;
  const ownerBuild = buildTarget === PRODUCT_CONFIG.buildTargets.owner;
  const protectedBuild = isProtectedBuildTarget(buildTarget);
  if (protectedBuild && process.env.GITHUB_PAGES === "true") {
    throw new Error("Protected owner/admin builds cannot target GitHub Pages");
  }
  if (command === "build"
    && protectedBuild
    && process.env.CYCLELENS_PROTECTED_BUILD_APPROVED !== "1") {
    throw new Error("Protected builds require CYCLELENS_PROTECTED_BUILD_APPROVED=1");
  }
  const pagesBase = githubPagesBase({
    githubRepository: process.env.GITHUB_REPOSITORY,
    explicitBase: process.env.GITHUB_PAGES_BASE,
  });
  const outputDirectories = {
    [buildTargets.owner]: "dist-owner",
    [buildTargets.admin]: "dist-admin",
    [buildTargets.public]: "dist-public",
  };

  return {
    base: buildTarget === buildTargets.public && process.env.GITHUB_PAGES === "true" ? pagesBase : "/",
    build: {
      outDir: outputDirectories[buildTarget],
    },
    define: {
      "import.meta.env.CYCLELENS_PRODUCT_NAME": JSON.stringify(PRODUCT_CONFIG.name),
      "import.meta.env.CYCLELENS_BUILD_TARGET": JSON.stringify(buildTarget),
      "import.meta.env.CYCLELENS_ADMIN_ENABLED": JSON.stringify(isAdminBuildTarget(buildTarget)),
      "import.meta.env.CYCLELENS_ADMIN_DEFAULT_ROUTE": JSON.stringify(adminBuild),
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [
      react(),
      protectedBuild ? {
        name: "cyclelens-protected-boundary",
        transformIndexHtml() {
          return [{
            tag: "meta",
            attrs: { name: "robots", content: "noindex, nofollow, noarchive" },
            injectTo: "head",
          }];
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "_routes.json",
            source: `${JSON.stringify({ version: 1, include: ["/*"], exclude: [] }, null, 2)}\n`,
          });
          this.emitFile({
            type: "asset",
            fileName: ownerBuild ? "owner-release.json" : "admin-release.json",
            source: `${JSON.stringify({
              schemaVersion: 1,
              product: PRODUCT_CONFIG.name,
              buildTarget,
              accessBoundary: "cloudflare-access-and-pages-functions",
              adminEnabled: true,
              defaultRoute: ownerBuild ? "dashboard" : "macroAdmin",
              routesProtected: ["/*"],
              dataScope: ownerBuild ? "owner_private" : "public_reviewed",
              privateRawDataOverlay: ownerBuild ? OWNER_RAW_DATA_FILES : [],
              privateProjectionOverlay: ownerBuild ? OWNER_PROJECTION_FILES : [],
              dataManifest: ownerBuild ? "data/data-manifest.json" : null,
            }, null, 2)}\n`,
          });
        },
        async writeBundle() {
          if (!ownerBuild) return;
          const privateRawDataDirectory = resolve(import.meta.dirname, "data/private/raw");
          const privateProjectionDirectory = resolve(import.meta.dirname, "data/private/projections");
          const ownerProjectionOutput = resolve(import.meta.dirname, "dist-owner/data/projections");
          const privateManifestPath = resolve(import.meta.dirname, "data/private/data-manifest.json");
          const ownerDataOutput = resolve(import.meta.dirname, "dist-owner/data");
          await overlayOwnerRawData(privateRawDataDirectory, ownerDataOutput);
          await overlayOwnerProjections(privateProjectionDirectory, ownerProjectionOutput);
          await overlayOwnerManifest(privateManifestPath, ownerDataOutput);
        },
      } : null,
    ].filter(Boolean),
  };
});

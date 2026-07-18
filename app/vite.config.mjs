import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  PRODUCT_CONFIG,
  githubPagesBase,
  isAdminBuildTarget,
  resolveBuildTarget,
} from "./product.config.mjs";

export default defineConfig(({ command, mode }) => {
  const defaultBuildTarget = command === "serve"
    ? PRODUCT_CONFIG.buildTargets.development
    : PRODUCT_CONFIG.buildTargets.public;
  const modeBuildTarget = mode === PRODUCT_CONFIG.buildTargets.admin
    ? PRODUCT_CONFIG.buildTargets.admin
    : defaultBuildTarget;
  const buildTarget = resolveBuildTarget(process.env.CYCLELENS_BUILD_TARGET, modeBuildTarget);
  const adminBuild = buildTarget === PRODUCT_CONFIG.buildTargets.admin;
  const pagesBase = githubPagesBase({
    githubRepository: process.env.GITHUB_REPOSITORY,
    explicitBase: process.env.GITHUB_PAGES_BASE,
  });

  return {
    base: process.env.GITHUB_PAGES === "true" ? pagesBase : "/",
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
      adminBuild ? {
        name: "cyclelens-admin-boundary",
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
        },
      } : null,
    ].filter(Boolean),
  };
});

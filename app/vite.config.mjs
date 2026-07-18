import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  PRODUCT_CONFIG,
  githubPagesBase,
  isAdminBuildTarget,
  resolveBuildTarget,
} from "./product.config.mjs";

export default defineConfig(({ command }) => {
  const defaultBuildTarget = command === "serve"
    ? PRODUCT_CONFIG.buildTargets.development
    : PRODUCT_CONFIG.buildTargets.public;
  const buildTarget = resolveBuildTarget(process.env.CYCLELENS_BUILD_TARGET, defaultBuildTarget);
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
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react()],
  };
});

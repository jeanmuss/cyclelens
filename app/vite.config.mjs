import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").pop() || "cycle-map";
const githubPagesBase = process.env.GITHUB_PAGES_BASE || `/${repositoryName}/`;

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? githubPagesBase : "/",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});

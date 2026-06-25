import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const distRoot = resolve(import.meta.dirname, "../dist");

await copyFile(resolve(distRoot, "index.html"), resolve(distRoot, "404.html"));

console.log("Prepared GitHub Pages SPA fallback: dist/404.html");

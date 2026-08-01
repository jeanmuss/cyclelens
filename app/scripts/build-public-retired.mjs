import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(appRoot, "dist-public");
if (dirname(outputDirectory) !== appRoot || basename(outputDirectory) !== "dist-public") {
  throw new Error("Refusing to write an unexpected public-retired output directory");
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'">
    <title>CycleLens public access retired</title>
  </head>
  <body style="font-family:system-ui,sans-serif;max-width:42rem;margin:10vh auto;padding:1.5rem">
    <main>
      <h1>CycleLens public access has been retired</h1>
      <p>This public endpoint no longer serves product data.</p>
    </main>
  </body>
</html>
`;
const marker = {
  schemaVersion: 1,
  product: "CycleLens",
  buildTarget: "public-retired",
  dataIncluded: false,
  status: "retired",
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "index.html"), html, "utf8"),
  writeFile(resolve(outputDirectory, "404.html"), html, "utf8"),
  writeFile(resolve(outputDirectory, "public-retired-release.json"), `${JSON.stringify(marker, null, 2)}\n`, "utf8"),
]);

console.log(JSON.stringify({ status: "built", outputDirectory, ...marker }));

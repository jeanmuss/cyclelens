import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const workflowRoot = resolve(directory, "..", "..", ".github", "workflows");

async function workflow(name) {
  return readFile(resolve(workflowRoot, name), "utf8");
}

test("deployment and data-cache workflows reuse collection and projection stages", async () => {
  for (const name of ["deploy-pages.yml", "update-market-data.yml"]) {
    const source = await workflow(name);
    const collect = source.indexOf("uses: ./.github/workflows/_collect-persist.yml");
    const project = source.indexOf("uses: ./.github/workflows/_project-public-snapshots.yml");
    assert.ok(collect >= 0 && project > collect);
    assert.match(source, /project-public-snapshots:\s*\n\s+needs: collect-persist/);
    assert.match(source, /secrets: inherit/);
  }
});

test("collection restores LKG, gates reviewed sources, persists, then uploads private input", async () => {
  const source = await workflow("_collect-persist.yml");
  assert.match(source, /on:\s*\n\s+workflow_call:/);
  assert.match(source, /data-cache:refs\/remotes\/origin\/data-cache/);
  assert.match(source, /preserving the checked-in baseline/);
  assert.match(source, /inputs\.public_crypto_market_data_approved/);
  assert.match(source, /inputs\.alpaca_redistribution_approved/);
  assert.match(source, /inputs\.fred_third_party_series_approved/);
  assert.doesNotMatch(source, /update-equity-data\.py/, "blocked unofficial equity adapters must not run in production");
  const chart = source.indexOf("Refresh interactive chart series");
  const persist = source.indexOf("Persist canonical market metric history");
  const upload = source.indexOf("Upload collected private build input");
  assert.ok(chart < persist && persist < upload);
  assert.match(source.slice(persist, upload), /CYCLELENS_REQUIRE_MARKET_HISTORY/);
  assert.match(source, /retention-days: 1/);
});

test("full crypto refresh keeps every reviewed provider gate independent", async () => {
  const source = await workflow("_collect-persist.yml");
  const start = source.indexOf("- name: Refresh crypto liquidity data");
  const end = source.indexOf("- name: Refresh market session data", start);
  const refresh = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(refresh, /if: inputs\.refresh_mode == 'full'/);
  assert.doesNotMatch(refresh, /if:.*defillama_redistribution_approved/);
  assert.match(refresh, /CMC_REDISTRIBUTION_APPROVED: \$\{\{ inputs\.cmc_redistribution_approved && '1' \|\| '0' \}\}/);
  assert.match(refresh, /DEFILLAMA_REDISTRIBUTION_APPROVED: \$\{\{ inputs\.defillama_redistribution_approved && '1' \|\| '0' \}\}/);
  assert.match(refresh, /SOSOVALUE_REDISTRIBUTION_APPROVED: \$\{\{ inputs\.sosovalue_redistribution_approved && '1' \|\| '0' \}\}/);
  assert.match(refresh, /BLOCKBEATS_REDISTRIBUTION_APPROVED: \$\{\{ inputs\.blockbeats_redistribution_approved && '1' \|\| '0' \}\}/);
  assert.doesNotMatch(refresh, /DEFILLAMA_REDISTRIBUTION_APPROVED: "1"/);
});

test("projection is contract-tested before the reviewed artifact is published", async () => {
  const source = await workflow("_project-public-snapshots.yml");
  const download = source.indexOf("Download collected build input");
  const project = source.indexOf("Generate page-scoped public projections");
  const verify = source.indexOf("Verify projection contracts and build the public manifest");
  const upload = source.indexOf("Upload reviewed public snapshot");
  assert.ok(download < project && project < verify && verify < upload);
  assert.match(source, /node --test test\/metricPipeline\.test\.mjs test\/dataManifest\.test\.mjs/);
  assert.match(source, /CMC_REDISTRIBUTION_APPROVED/);
  assert.match(source, /DEFILLAMA_REDISTRIBUTION_APPROVED/);
});

test("deployment builds only from the reviewed projection artifact", async () => {
  const source = await workflow("deploy-pages.yml");
  assert.match(source, /build:\s*\n\s+needs: project-public-snapshots/);
  assert.match(source, /name: public-market-snapshot/);
  assert.match(source, /npm --prefix app run build:pages/);
  assert.match(source, /uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(source, /scripts\/update-market-data\.mjs/);
  assert.match(source, /CMC_REDISTRIBUTION_APPROVED: \$\{\{ vars\.CMC_REDISTRIBUTION_APPROVED \|\| '1' \}\}/);
});

test("versioned snapshots remain isolated on data-cache", async () => {
  const source = await workflow("update-market-data.yml");
  assert.match(source, /fetch-depth:\s*0/);
  assert.match(source, /refs\/remotes\/origin\/data-cache/);
  assert.match(source, /git commit-tree/);
  assert.match(source, /refs\/heads\/data-cache/);
  assert.doesNotMatch(source, /^\s+git commit -m /m);
  assert.doesNotMatch(source, /^\s+git push\s*$/m);
});

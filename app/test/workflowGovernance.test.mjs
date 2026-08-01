import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const workflowRoot = resolve(directory, "..", "..", ".github", "workflows");
const appRoot = resolve(directory, "..");

async function workflow(name) {
  return readFile(resolve(workflowRoot, name), "utf8");
}

function topLevelJobIds(source) {
  const lines = source.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex < 0) return [];
  const ids = [];
  for (const line of lines.slice(jobsIndex + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function namedStep(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = source.indexOf("\n      - ", start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function referencedSecrets(source) {
  return [...source.matchAll(/\bsecrets\.([A-Z0-9_]+)/g)]
    .map((match) => match[1])
    .sort();
}

test("public GitHub Pages deploys only a data-free retirement shell", async () => {
  const source = await workflow("deploy-pages.yml");
  assert.match(source, /npm --prefix app run build:public-retired/);
  assert.match(source, /path: app\/dist-public/);
  assert.match(source, /public-retired-release\.json/);
  assert.match(source, /m\.dataIncluded!==false/);
  assert.match(source, /cyclelens-public-allowlist\.txt/);
  assert.match(source, /diff -u \/tmp\/cyclelens-public-allowlist\.txt \/tmp\/cyclelens-public-files\.txt/);
  assert.match(
    source,
    /uses: actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5\.0\.0/,
  );
  assert.doesNotMatch(source, /^\s+schedule:/m);
  assert.doesNotMatch(source, /_collect-persist|_project-owner-snapshots|download-artifact|owner-private|app\/public\/data/);
  assert.doesNotMatch(source, /secrets\./);
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(source.slice(0, source.indexOf("jobs:")), /pages: write|id-token: write/);
  const buildSection = source.slice(source.indexOf("  build:"), source.indexOf("  deploy:"));
  assert.doesNotMatch(buildSection, /pages: write|id-token: write/);
  assert.match(
    source.slice(source.indexOf("  deploy:")),
    /permissions:\s*\n\s+contents: read\s*\n\s+pages: write\s*\n\s+id-token: write/,
  );
});

test("legacy data-cache publication is workflow-dispatch-only and inert", async () => {
  const source = await workflow("update-market-data.yml");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /^\s+schedule:/m);
  assert.doesNotMatch(source, /contents: write|git push|commit-tree|data-cache:refs|upload-artifact|download-artifact/);
});

test("owner release fails closed and keeps collectors independently switchable", async () => {
  const source = await workflow("_owner-release.yml");
  assert.match(source, /data_scope:\s*\n\s+type: string\s*\n\s+required: true/);
  assert.match(source, /owner_data_collection_approved:/);
  assert.match(source, /collect_coinmarketcap:\s*\n\s+type: boolean\s*\n\s+default: false/);
  assert.match(
    source,
    /python -m pip install --disable-pip-version-check --no-input --no-cache-dir --force-reinstall --only-binary=:all: --require-hashes --requirement app\/requirements-equity\.txt/,
  );
  assert.match(source, /\[ "\$DATA_SCOPE" != "owner_private" \]/);
  assert.match(source, /\[ "\$OWNER_DATA_COLLECTION_APPROVED" != "true" \]/);
  for (const input of [
    "collect_crypto_monthly",
    "collect_crypto_liquidity",
    "collect_market_session",
    "collect_chip_chain",
    "collect_robot_chain",
    "collect_equity_fast",
    "collect_equity_weekly",
    "collect_manual_macro_events",
    "collect_macro_calendar",
    "collect_chart_series",
    "persist_market_history",
  ]) {
    assert.match(source, new RegExp(`inputs\\.${input}`), `${input} must independently guard its collector`);
  }
  assert.match(source, /CYCLELENS_DATA_USE_SCOPE: owner_private/);
  assert.match(source, /CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1"/);
  assert.match(source, /CYCLELENS_PROTECTED_BUILD_APPROVED: "1"/);
  assert.match(source, /CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE: "1"/);
  assert.match(
    source,
    /CYCLELENS_COLLECT_CMC: \$\{\{ inputs\.collect_coinmarketcap && 'true' \|\| 'false' \}\}/,
  );
  assert.match(source, /npm --prefix app run validate-owner-release-data/);
  assert.match(source, /python -m unittest discover -s app\/test -p 'test_\*\.py'/);
  assert.match(source, /app\/test\/secureFetch\.test\.mjs/);
  assert.match(source, /app\/test\/cmcProviderStateBounds\.test\.mjs/);
  assert.match(source, /app\/test\/cmcProviderHistoryFallback\.test\.mjs/);
  assert.match(
    source,
    /Prepare ignored owner-private last-known-good seeds[\s\S]*npm --prefix app run prepare-owner-data/,
  );
  assert.doesNotMatch(source, /cache:\s*npm|cache-dependency-path:/);
  assert.doesNotMatch(
    source,
    /actions\/(?:upload|download)-artifact|owner-private-(?:collected-market-data|market-snapshot)|retention-days:/,
  );
  assert.doesNotMatch(source, /data-cache:refs|refs\/heads\/data-cache|git push|secrets: inherit/);
  assert.doesNotMatch(
    source,
    /(?:REDISTRIBUTION_APPROVED|DATA_DISPLAY_APPROVED|PUBLIC_CRYPTO_MARKET_DATA_APPROVED)/,
    "owner-only collection must not assert any public-display or redistribution approval",
  );
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /continue-on-error:|actions:\s*write|id-token:\s*write|GITHUB_(?:ENV|OUTPUT|PATH|STEP_SUMMARY)|\bset -x\b|\bprintenv\b/);
});

test("owner CoinMarketCap collection is default-off, budgeted, shared, and secret-isolated", async () => {
  const source = await workflow("_owner-release.yml");
  const refresh = namedStep(source, "Refresh shared CoinMarketCap provider state");
  assert.match(
    refresh,
    /if: >-\s*\n\s+inputs\.collect_crypto_liquidity \|\| inputs\.collect_market_session \|\| inputs\.collect_equity_fast/,
  );
  assert.match(
    refresh,
    /CMC_PRO_API_KEY: \$\{\{ inputs\.collect_coinmarketcap && secrets\.CMC_PRO_API_KEY \|\| '' \}\}/,
  );
  assert.match(refresh, /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/);
  assert.match(refresh, /SUPABASE_SECRET_KEY: \$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}/);
  assert.match(refresh, /\[ "\$\{CYCLELENS_COLLECT_CMC:-false\}" = "true" \]/);
  assert.match(
    refresh,
    /CYCLELENS_CMC_DAILY_CREDIT_BUDGET: \$\{\{ vars\.OWNER_CMC_DAILY_CREDIT_BUDGET \}\}/,
  );
  assert.match(
    refresh,
    /CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: \$\{\{ vars\.OWNER_CMC_MONTHLY_CREDIT_BUDGET \}\}/,
  );
  assert.match(
    refresh,
    /CYCLELENS_CMC_CURRENT_MIN_INTERVAL_MINUTES: \$\{\{ vars\.OWNER_CMC_CURRENT_MIN_INTERVAL_MINUTES \}\}/,
  );
  assert.match(refresh, /npm --prefix app run refresh-cmc-provider-state/);
  assert.doesNotMatch(
    source,
    /CYCLELENS_CMC_COLLECTION_ENABLED|CYCLELENS_CMC_CREDIT_BUDGET:|CYCLELENS_CMC_HISTORY_CADENCE_HOURS:/,
  );
  assert.equal((source.match(/\bsecrets\.CMC_PRO_API_KEY\b/g) ?? []).length, 1);
  const outsideRefresh = source.replace(refresh, "");
  for (const variable of [
    "CYCLELENS_CMC_DAILY_CREDIT_BUDGET",
    "CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET",
    "CYCLELENS_CMC_CURRENT_MIN_INTERVAL_MINUTES",
  ]) {
    assert.doesNotMatch(outsideRefresh, new RegExp(variable), `${variable} must remain scoped to the shared refresh step`);
  }

  for (const [name, input] of [
    ["Refresh crypto liquidity data", "collect_crypto_liquidity"],
    ["Refresh market session data", "collect_market_session"],
    ["Refresh fast equity indicators", "collect_equity_fast"],
  ]) {
    const consumer = namedStep(source, name);
    assert.match(consumer, new RegExp(`if: inputs\\.${input}`));
    assert.doesNotMatch(consumer, /CMC_PRO_API_KEY|secrets\.CMC_PRO_API_KEY|OWNER_CMC_|CYCLELENS_CMC_/);
  }
});

test("owner-private bytes stay on one ephemeral runner through deployment", async () => {
  const source = await workflow("_owner-release.yml");
  const seed = source.indexOf("Prepare ignored owner-private last-known-good seeds");
  const cmc = source.indexOf("Refresh shared CoinMarketCap provider state");
  const collect = source.indexOf("Refresh normalized monthly crypto data");
  const cryptoLiquidity = source.indexOf("Refresh crypto liquidity data");
  const marketSession = source.indexOf("Refresh market session data");
  const equityFast = source.indexOf("Refresh fast equity indicators");
  const project = source.indexOf("Generate owner-only projections and manifest");
  const verify = source.indexOf("Verify source, owner-data, and release contracts");
  const build = source.indexOf("Build the owner application and Pages Functions");
  const deploy = source.indexOf("Deploy owner release to the existing Access-protected Pages project");
  assert.ok(seed >= 0 && seed < cmc);
  assert.ok(cmc < cryptoLiquidity && cryptoLiquidity < marketSession && marketSession < equityFast);
  assert.ok(collect >= 0 && collect < project && project < verify && verify < build && build < deploy);
  assert.match(
    source,
    /node --test[^\n]*app\/test\/marketMetricHistory\.test\.mjs/,
    "owner CI must run the Supabase conflict-tuple regression tests",
  );
  assert.match(
    source,
    /node --test[^\n]*app\/test\/cmcProviderState\.test\.mjs/,
    "owner CI must run the CoinMarketCap provider-state budget and circuit-breaker tests",
  );
  assert.match(
    source,
    /node --test[^\n]*app\/test\/marketSessionCmcProviderState\.test\.mjs/,
    "owner CI must run the CoinMarketCap consumer isolation tests",
  );
  assert.deepEqual(topLevelJobIds(source), ["owner-release"]);
  assert.doesNotMatch(source, /uses:\s*\.\/\.github\/workflows\//);
  assert.doesNotMatch(source, /actions\/(?:upload|download)-artifact|retention-days:|owner-private-.*artifact/);
  assert.match(
    source.slice(project, verify),
    /npm run project-owner-data[\s\S]*?npm run generate-owner-data-manifest/,
  );
  assert.match(source.slice(project, verify), /npm run generate-owner-data-manifest/);
  assert.match(source, /npm --prefix app run build:owner/);
  assert.match(source, /npm --prefix app run build:owner:functions/);
  assert.match(source, /app\/dist-owner\/owner-release\.json/);
  assert.match(source, /m\.dataScope!=='owner_private'/);
  assert.match(source, /m\.defaultRoute!=='dashboard'/);
  assert.match(source, /m\.accessBoundary!=='cloudflare-access-and-pages-functions'/);
  assert.match(source, /app\/dist-owner\/_routes\.json/);
  assert.match(source, /includes\('\/\*'\)/);
  assert.match(source, /Array\.isArray\(r\.exclude\)\|\|r\.exclude\.length!==0/);
  assert.match(source, /app\/\.wrangler\/owner-functions/);
  assert.match(
    source.slice(deploy),
    /working-directory: app[\s\S]*CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}[\s\S]*CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}[\s\S]*npx --no-install wrangler pages deploy dist-owner --project-name cyclelens-admin --branch main/,
  );
  assert.match(source.slice(deploy), />\/tmp\/cyclelens-owner-deploy\.log 2>&1/);
  assert.doesNotMatch(source.slice(deploy), /cat .*cyclelens-owner-deploy|upload-artifact/);
  assert.equal(
    (source.match(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/g) ?? []).length,
    1,
  );
  assert.equal(
    (source.match(/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    source.slice(deploy),
    /CMC_PRO_API_KEY: \$\{\{|SOSOVALUE_API_KEY: \$\{\{|APCA_API_KEY_ID: \$\{\{|FRED_API_KEY: \$\{\{|SUPABASE_SECRET_KEY: \$\{\{/,
  );
  assert.equal(
    (source.match(/cyclelens-admin\.pages\.dev\/data\/data-manifest\.json/g) ?? []).length,
    2,
  );
  assert.match(source, /3\?\?\|401\|403/);
  assert.match(source, /--output \/dev\/null/);
});

test("owner caller is gated, uses one release job, and exposes independent source switches", async () => {
  const source = await workflow("deploy-owner.yml");
  assert.match(source, /github\.repository == 'jeanmuss\/cyclelens'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /vars\.OWNER_DATA_COLLECTION_APPROVED == '1'/);
  assert.deepEqual(topLevelJobIds(source), ["owner-release"]);
  assert.match(source, /uses: \.\/\.github\/workflows\/_owner-release\.yml/);
  assert.match(source, /data_scope: owner_private/);
  assert.match(source, /collect_coinmarketcap: \$\{\{ vars\.OWNER_COLLECT_CMC == '1' \}\}/);
  assert.doesNotMatch(source, /OWNER_COLLECT_CMC != '0'/);
  const switches = new Map([
    ["collect_crypto_monthly", "OWNER_COLLECT_CRYPTO_MONTHLY"],
    ["collect_crypto_liquidity", "OWNER_COLLECT_CRYPTO_LIQUIDITY"],
    ["collect_market_session", "OWNER_COLLECT_MARKET_SESSION"],
    ["collect_chip_chain", "OWNER_COLLECT_CHIP_CHAIN"],
    ["collect_robot_chain", "OWNER_COLLECT_ROBOT_CHAIN"],
    ["collect_equity_fast", "OWNER_COLLECT_EQUITY_FAST"],
    ["collect_equity_weekly", "OWNER_COLLECT_EQUITY_WEEKLY"],
    ["collect_manual_macro_events", "OWNER_COLLECT_MANUAL_MACRO_EVENTS"],
    ["collect_macro_calendar", "OWNER_COLLECT_MACRO_CALENDAR"],
    ["collect_chart_series", "OWNER_COLLECT_CHART_SERIES"],
    ["persist_market_history", "OWNER_PERSIST_MARKET_HISTORY"],
  ]);
  for (const [input, variable] of switches) {
    assert.match(
      source,
      new RegExp(`${input}: \\\$\\{\\{ vars\\.${variable} != '0' \\}\\}`),
      `${input} must be independently controlled by ${variable}`,
    );
  }
  assert.match(
    source,
    /CMC_PRO_API_KEY: \$\{\{ vars\.OWNER_COLLECT_CMC == '1' && secrets\.CMC_PRO_API_KEY \|\| '' \}\}/,
  );
  for (const name of [
    "SOSOVALUE_API_KEY",
    "SEC_USER_AGENT",
    "BLOCKBEATS_API_KEY",
    "APCA_API_KEY_ID",
    "APCA_API_SECRET_KEY",
    "FRED_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ]) {
    assert.match(source, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
  assert.doesNotMatch(source, /secrets: inherit/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /actions\/(?:upload|download)-artifact|owner-private-(?:collected-market-data|market-snapshot)/);
});

test("owner secrets are available only to their intended steps", async () => {
  const source = await workflow("_owner-release.yml");
  const expected = new Map([
    ["Refresh shared CoinMarketCap provider state", ["CMC_PRO_API_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_URL"]],
    ["Refresh crypto liquidity data", ["BLOCKBEATS_API_KEY", "SEC_USER_AGENT", "SOSOVALUE_API_KEY"]],
    ["Refresh market session data", []],
    ["Refresh chip-chain data", ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]],
    ["Refresh robot-chain data", ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY"]],
    ["Refresh fast equity indicators", ["FRED_API_KEY"]],
    ["Refresh weekly equity and macro data", ["APCA_API_KEY_ID", "APCA_API_SECRET_KEY", "FRED_API_KEY"]],
    ["Sync manual macro events", ["SUPABASE_SECRET_KEY", "SUPABASE_URL"]],
    ["Refresh macro calendar", ["FRED_API_KEY"]],
    ["Persist canonical market metric history", ["SUPABASE_SECRET_KEY", "SUPABASE_URL"]],
    ["Deploy owner release to the existing Access-protected Pages project", ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]],
  ]);
  for (const [name, secrets] of expected) {
    assert.deepEqual(referencedSecrets(namedStep(source, name)), secrets, `${name} has an unexpected secret scope`);
  }
  for (const name of [
    "Refresh normalized monthly crypto data",
    "Refresh interactive chart series",
    "Generate owner-only projections and manifest",
    "Enforce owner release freshness, scope, size, and manifest hashes",
    "Verify source, owner-data, and release contracts",
    "Build the owner application and Pages Functions",
    "Require anonymous denial on the current protected host",
    "Verify the deployed owner release still denies anonymous access",
  ]) {
    assert.deepEqual(referencedSecrets(namedStep(source, name)), [], `${name} must not receive provider secrets`);
  }
});

test("owner data has no route to public Pages, data-cache, Telegram, or public artifacts", async () => {
  const isolatedNames = [
    "deploy-pages.yml",
    "update-market-data.yml",
    "telegram-morning-brief.yml",
    "_project-public-snapshots.yml",
  ];
  const isolatedSource = (await Promise.all(isolatedNames.map(workflow))).join("\n");
  assert.doesNotMatch(isolatedSource, /owner-private|dist-owner|project-owner-data|SUPABASE_|CMC_PRO_API_KEY|FRED_API_KEY/);
  assert.doesNotMatch(isolatedSource, /app\/data\/private\/projections/);

  const allNames = [
    "_owner-release.yml",
    "_project-public-snapshots.yml",
    "deploy-owner.yml",
    "deploy-pages.yml",
    "update-market-data.yml",
    "telegram-morning-brief.yml",
  ];
  const allSource = (await Promise.all(allNames.map(workflow))).join("\n");
  assert.doesNotMatch(allSource, /name: public-market-snapshot|name: collected-market-data/);
  assert.doesNotMatch(allSource, /refs\/heads\/data-cache|git push/);
  assert.doesNotMatch(await workflow("telegram-morning-brief.yml"), /schedule:|TELEGRAM_BOT_TOKEN|send-telegram|data-cache|upload-artifact/);

  const packageJson = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
  assert.equal("render:telegram-brief" in packageJson.scripts, false);
  const sender = await readFile(resolve(appRoot, "scripts/send-telegram-morning-brief.mjs"), "utf8");
  assert.match(sender, /Telegram delivery is retired for the owner-only product boundary/);
  assert.doesNotMatch(sender, /process\.env\.TELEGRAM_BOT_TOKEN|process\.env\.TELEGRAM_CHAT_ID/);
});

test("official workflow actions are pinned to reviewed immutable releases", async () => {
  const names = [
    "_owner-release.yml",
    "_project-public-snapshots.yml",
    "deploy-owner.yml",
    "deploy-pages.yml",
    "update-market-data.yml",
    "telegram-morning-brief.yml",
  ];
  const source = (await Promise.all(names.map(workflow))).join("\n");
  const expectedPins = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/setup-python", "5fda3b95a4ea91299a34e894583c3862153e4b97"],
    ["actions/configure-pages", "45bfe0192ca1faeb007ade9deae92b16b8254a0d"],
    ["actions/upload-pages-artifact", "fc324d3547104276b827a68afc52ff2a11cc49c9"],
    ["actions/deploy-pages", "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"],
  ]);
  const references = [...source.matchAll(/uses:\s*(actions\/[^@\s]+)@([^\s#]+)/g)];
  assert.ok(references.length >= expectedPins.size);
  for (const [, action, revision] of references) {
    assert.equal(revision, expectedPins.get(action), `${action} must use its reviewed immutable release`);
    assert.match(revision, /^[a-f0-9]{40}$/);
  }
  for (const action of expectedPins.keys()) {
    assert.ok(references.some(([, candidate]) => candidate === action), `${action} must remain covered`);
  }
});

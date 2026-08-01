import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  allowedProviderUrl,
  fetchJsonBounded,
  fetchTextBounded,
} from "../scripts/secure-fetch.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

test("secure provider transport pins the HTTPS origin and disables redirects", async () => {
  assert.equal(
    allowedProviderUrl("https://api.example.test/v1?limit=10", ["https://api.example.test"]).hostname,
    "api.example.test",
  );
  assert.throws(
    () => allowedProviderUrl("https://api.example.test.evil.test/v1", ["https://api.example.test"]),
    /provider_destination_not_allowed/,
  );
  assert.throws(
    () => allowedProviderUrl("https://user:password@api.example.test/v1", ["https://api.example.test"]),
    /provider_destination_not_allowed/,
  );
  assert.throws(
    () => allowedProviderUrl("http://api.example.test/v1", ["https://api.example.test"]),
    /provider_destination_not_allowed/,
  );

  let observed = null;
  const payload = await fetchJsonBounded("https://api.example.test/v1", {
    allowedOrigins: ["https://api.example.test"],
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-length": "11" },
      });
    },
  });
  assert.deepEqual(payload, { ok: true });
  assert.equal(observed.url, "https://api.example.test/v1");
  assert.equal(observed.options.redirect, "error");
  assert.ok(observed.options.signal instanceof AbortSignal);

  let rejectedDestinationCalled = false;
  await assert.rejects(fetchJsonBounded("https://api.example.test.evil.test/v1", {
    allowedOrigins: ["https://api.example.test"],
    headers: { authorization: "Bearer never-send-this" },
    fetchImpl: async () => {
      rejectedDestinationCalled = true;
      return new Response("{}");
    },
  }), /provider_destination_not_allowed/);
  assert.equal(rejectedDestinationCalled, false);
});

test("secure provider transport rejects declared and streamed oversized bodies", async () => {
  await assert.rejects(fetchTextBounded("https://api.example.test/v1", {
    allowedOrigins: ["https://api.example.test"],
    maxResponseBytes: 4,
    fetchImpl: async () => new Response("ok", {
      headers: { "content-length": "5" },
    }),
  }), /provider_response_too_large/);

  await assert.rejects(fetchTextBounded("https://api.example.test/v1", {
    allowedOrigins: ["https://api.example.test"],
    maxResponseBytes: 4,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.close();
      },
    })),
  }), /provider_response_too_large/);
});

test("secure provider transport keeps its timeout active while consuming the body", async () => {
  await assert.rejects(fetchTextBounded("https://api.example.test/v1", {
    allowedOrigins: ["https://api.example.test"],
    timeoutMs: 10,
    fetchImpl: async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    })),
  }), /provider_request_failed/);
});

test("owner Node collectors use fixed reviewed origins and only the bounded transport", async () => {
  const collectors = {
    "scripts/update-chip-chain-data.mjs": {
      constant: "ALPACA_ALLOWED_ORIGINS",
      origins: ["https://data.alpaca.markets"],
    },
    "scripts/update-crypto-liquidity-data.mjs": {
      constant: "CRYPTO_LIQUIDITY_ALLOWED_ORIGINS",
      origins: [
        "https://api.llama.fi",
        "https://openapi.sosovalue.com",
        "https://api-pro.theblockbeats.info",
        "https://data.sec.gov",
        "https://www.sec.gov",
      ],
    },
    "scripts/update-market-session-data.mjs": {
      constant: "MARKET_SESSION_ALLOWED_ORIGINS",
      origins: [
        "https://www.okx.com",
      ],
    },
    "scripts/update-market-data.mjs": {
      constant: "MARKET_DATA_ALLOWED_ORIGINS",
      origins: [
        "https://api.binance.com",
        "https://data-api.binance.vision",
        "https://api.hyperliquid.xyz",
        "https://api.blockchain.info",
      ],
    },
  };

  for (const [relativePath, contract] of Object.entries(collectors)) {
    const source = await readFile(resolve(appRoot, relativePath), "utf8");
    assert.match(source, /from "\.\/secure-fetch\.mjs"/, `${relativePath} must import the bounded transport`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${relativePath} must not bypass the bounded transport`);
    assert.doesNotMatch(source, /\bresponse\.(?:json|text)\s*\(/, `${relativePath} must not consume an unbounded response`);
    assert.doesNotMatch(source, /node:child_process|Invoke-RestMethod|\bpowershell\b/i, `${relativePath} must not use a shell HTTP fallback`);
    assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*(?:BASE_URL|API_URL|ENDPOINT|ORIGIN)/, `${relativePath} must not configure a provider destination through the environment`);
    assert.match(source, new RegExp(`allowedOrigins:\\s*${contract.constant}`));

    const escapedConstant = contract.constant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const originBlock = source.match(new RegExp(`const ${escapedConstant} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
    assert.ok(originBlock, `${relativePath} must declare an explicit origin allowlist`);
    const origins = [...originBlock[1].matchAll(/"(https:\/\/[^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(origins, contract.origins, `${relativePath} origin allowlist changed without review`);
  }

  const chipCollector = await readFile(resolve(appRoot, "scripts/update-chip-chain-data.mjs"), "utf8");
  assert.doesNotMatch(chipCollector, /ALPACA_DATA_BASE_URL/);
  assert.match(chipCollector, /const mergedPaths = \{ \.\.\.retainedPaths, \.\.\.paths \}/);
  assert.match(chipCollector, /pricePaths: mergedPaths/);

  const marketCollector = await readFile(resolve(appRoot, "scripts/update-market-data.mjs"), "utf8");
  assert.doesNotMatch(marketCollector, /api\.binance\.me/);
});

test("only the shared CMC coordinator can reach the fixed provider origin", async () => {
  const source = await readFile(resolve(appRoot, "scripts/refresh-cmc-provider-state.mjs"), "utf8");
  assert.match(source, /from "\.\/secure-fetch\.mjs"/);
  assert.match(source, /const CMC_ORIGIN = "https:\/\/pro-api\.coinmarketcap\.com"/);
  assert.match(source, /allowedOrigins: \[CMC_ORIGIN\]/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bresponse\.(?:json|text)\s*\(/);
  assert.doesNotMatch(source, /node:child_process|Invoke-RestMethod|\bpowershell\b/i);
  assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*(?:BASE_URL|API_URL|ENDPOINT|ORIGIN)/);
});

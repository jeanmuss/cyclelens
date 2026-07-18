import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHashStateUrl,
  DEFAULT_CHIP_CHAIN_STATE,
  DEFAULT_CRYPTO_STATE,
  DEFAULT_EQUITY_STATE,
  DEFAULT_MACRO_STATE,
  DEFAULT_ROBOT_CHAIN_STATE,
  hashParams,
  readChipChainStateFromHash,
  readCryptoStateFromHash,
  readEquityStateFromHash,
  readMacroStateFromHash,
  readRobotChainStateFromHash,
  replaceHashState,
} from "../src/shared/routing/routeViewState.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

test("route view-state defaults are immutable and invalid hash values fail closed", () => {
  for (const state of [
    DEFAULT_CRYPTO_STATE,
    DEFAULT_EQUITY_STATE,
    DEFAULT_MACRO_STATE,
    DEFAULT_CHIP_CHAIN_STATE,
    DEFAULT_ROBOT_CHAIN_STATE,
  ]) {
    assert.ok(Object.isFrozen(state));
  }

  assert.deepEqual(readCryptoStateFromHash("#/crypto?view=invalid&metric=nope&range=2&asset=UNKNOWN"), DEFAULT_CRYPTO_STATE);
  assert.deepEqual(readEquityStateFromHash("#/equity-macro?range=nope"), DEFAULT_EQUITY_STATE);
  assert.deepEqual(readMacroStateFromHash("#/macro-calendar?category=nope"), DEFAULT_MACRO_STATE);
  assert.deepEqual(readChipChainStateFromHash("#/chip-chain?range=1y"), DEFAULT_CHIP_CHAIN_STATE);
  assert.deepEqual(readRobotChainStateFromHash("#/robot-chain?range=1y"), DEFAULT_ROBOT_CHAIN_STATE);
});

test("route view-state parsers accept only registered values", () => {
  assert.deepEqual(readCryptoStateFromHash("#/crypto?view=rotation&metric=relative&range=24&asset=ETH"), {
    view: "rotation",
    metric: "relative",
    range: "24",
    asset: "ETH",
  });
  assert.deepEqual(readEquityStateFromHash("#/equity-macro?range=26"), { range: "26" });
  assert.deepEqual(readMacroStateFromHash("#/macro-calendar?category=liquidity"), { category: "liquidity" });
  assert.deepEqual(readChipChainStateFromHash("#/chip-chain?range=3m"), { range: "3m" });
  assert.deepEqual(readRobotChainStateFromHash("#/robot-chain?range=5d"), { range: "5d" });
  assert.equal(hashParams("#/crypto?asset=BTC%2FUSD").get("asset"), "BTC/USD");
});

test("hash-state URLs preserve base paths, ordering, and omission rules", () => {
  assert.equal(
    buildHashStateUrl("/crypto-liquidity", {
      range: "90d",
      cadence: "weekly",
      empty: "",
      missing: null,
      omitted: undefined,
    }, "/cyclelens/"),
    "/cyclelens/#/crypto-liquidity?range=90d&cadence=weekly",
  );
  assert.equal(buildHashStateUrl("", {}, "/cycle-map/"), "/cycle-map/#/");
});

test("replaceHashState writes only when the browser URL changes", () => {
  const calls = [];
  const targetWindow = {
    location: {
      pathname: "/cyclelens/",
      search: "",
      hash: "#/crypto-liquidity?range=30d&cadence=daily",
    },
    history: {
      replaceState(...args) {
        calls.push(args);
      },
    },
  };

  replaceHashState("crypto-liquidity", { range: "30d", cadence: "daily" }, {
    targetWindow,
    baseUrl: "/cyclelens/",
  });
  assert.equal(calls.length, 0);

  replaceHashState("crypto-liquidity", { range: "90d", cadence: "weekly" }, {
    targetWindow,
    baseUrl: "/cyclelens/",
  });
  assert.deepEqual(calls, [[null, "", "/cyclelens/#/crypto-liquidity?range=90d&cadence=weekly"]]);
  assert.doesNotThrow(() => replaceHashState("crypto-liquidity", {}));
});

test("feature components no longer own route-state definitions", async () => {
  const cryptoComponents = await readFile(resolve(appRoot, "src", "features", "crypto-cycle", "CryptoCycleComponents.jsx"), "utf8");
  await assert.rejects(readFile(resolve(appRoot, "src", "pages", "AppShared.jsx"), "utf8"), { code: "ENOENT" });
  assert.doesNotMatch(cryptoComponents, /DEFAULT_.*_STATE|VALID_.*|hashParams|read.*StateFromHash|replaceHashState/);
});

test("crypto page preserves its explicit route when syncing view state", async () => {
  const cryptoPage = await readFile(resolve(appRoot, "src", "pages", "CryptoPage.jsx"), "utf8");
  assert.match(cryptoPage, /replaceHashState\("crypto-cycle", cryptoState\)/);
  assert.doesNotMatch(cryptoPage, /replaceHashState\("", cryptoState\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CHIP_CHAIN_TEXT, chipChainCopy, plannedSourceLabel } from "../src/shared/i18n/chipChain.js";
import {
  getInitialLanguage,
  languageCode,
  languageFromTranslation,
  SUPPORTED_LANGUAGES,
} from "../src/shared/i18n/language.js";
import { MARKET_CLOCK_LIMITS, MARKET_CLOCK_TEXT, marketClockCopy } from "../src/shared/i18n/marketClock.js";
import { ROBOT_CHAIN_TEXT, robotChainCopy } from "../src/shared/i18n/robotChain.js";
import { TRANSLATIONS, translationFor } from "../src/shared/i18n/translations.js";
import { EQUITY_MARKET_TEXT, equityCopy } from "../src/shared/i18n/usEquity.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

const LOCALE_KEYED_MACRO_LOOKUPS = new Set([
  "compactEventLabels",
  "eventLabelPrefixes",
  "eventLabels",
]);

function valueShape(value, path = []) {
  if (Array.isArray(value)) return "array";
  if (typeof value === "function") return "function";
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => path.join(".") !== "macroCalendar" || !LOCALE_KEYED_MACRO_LOOKUPS.has(key))
      .sort()
      .map((key) => [key, valueShape(value[key], [...path, key])]),
  );
}

test("language helpers normalize locale variants and fail closed to Chinese", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["zh", "en"]);
  assert.equal(languageCode("en-US"), "en");
  assert.equal(languageCode("zh-CN"), "zh");
  assert.equal(languageCode("unsupported"), "zh");
  assert.equal(languageFromTranslation({ htmlLang: "en" }), "en");
  assert.equal(languageFromTranslation(null), "zh");
  assert.equal(getInitialLanguage({ storage: null }), "zh");
});

test("global translation trees keep the same bilingual contract", () => {
  assert.deepEqual(valueShape(TRANSLATIONS.zh), valueShape(TRANSLATIONS.en));
  assert.equal(translationFor("en-US"), TRANSLATIONS.en);
  assert.equal(translationFor("zh-CN"), TRANSLATIONS.zh);
  assert.equal(translationFor("unsupported"), TRANSLATIONS.zh);
  assert.equal(TRANSLATIONS.zh.htmlLang, "zh-CN");
  assert.equal(TRANSLATIONS.en.htmlLang, "en");
  assert.equal(TRANSLATIONS.zh.macroCalendar.eventLabels["Nonfarm payrolls"], "非农就业");
  assert.equal(TRANSLATIONS.en.macroCalendar.compactEventLabels["U.S. federal holiday"], "U.S. holiday");
});

test("feature copy modules keep matching bilingual shapes and safe fallbacks", () => {
  for (const copy of [EQUITY_MARKET_TEXT, MARKET_CLOCK_TEXT, MARKET_CLOCK_LIMITS, CHIP_CHAIN_TEXT, ROBOT_CHAIN_TEXT]) {
    assert.deepEqual(valueShape(copy.zh), valueShape(copy.en));
  }

  assert.equal(equityCopy({ htmlLang: "en" }), EQUITY_MARKET_TEXT.en);
  assert.equal(equityCopy({ htmlLang: "invalid" }), EQUITY_MARKET_TEXT.zh);
  assert.equal(chipChainCopy({ htmlLang: "en" }), CHIP_CHAIN_TEXT.en);
  assert.equal(chipChainCopy(null), CHIP_CHAIN_TEXT.zh);
  assert.equal(robotChainCopy({ htmlLang: "en" }), ROBOT_CHAIN_TEXT.en);
  assert.equal(robotChainCopy(null), ROBOT_CHAIN_TEXT.zh);
  assert.equal(marketClockCopy({ htmlLang: "en" }).tradingLimits, MARKET_CLOCK_LIMITS.en);
  assert.equal(marketClockCopy(null).tradingLimits, MARKET_CLOCK_LIMITS.zh);
  assert.equal(plannedSourceLabel("en-US"), "Reviewed backend quote cache");
  assert.equal(plannedSourceLabel("invalid"), "经审查的后端行情缓存");
});

test("shared components no longer use an AppShared barrel and route runtime consumes the i18n boundary", async () => {
  const cryptoComponents = await readFile(resolve(appRoot, "src", "features", "crypto-cycle", "CryptoCycleComponents.jsx"), "utf8");
  const routeRuntime = await readFile(resolve(appRoot, "src", "pages", "RouteRuntime.jsx"), "utf8");

  await assert.rejects(readFile(resolve(appRoot, "src", "pages", "AppShared.jsx"), "utf8"), { code: "ENOENT" });
  assert.doesNotMatch(cryptoComponents, /export const TRANSLATIONS|readLanguagePreference|EQUITY_MARKET_TEXT|MARKET_CLOCK_TEXT|CHIP_CHAIN_TEXT|ROBOT_CHAIN_TEXT/);
  assert.match(routeRuntime, /from "\.\.\/shared\/i18n\/language\.js"/);
  assert.match(routeRuntime, /from "\.\.\/shared\/i18n\/translations\.js"/);
  assert.match(routeRuntime, /const t = translationFor\(language\)/);
  assert.doesNotMatch(routeRuntime, /AppShared/);
});

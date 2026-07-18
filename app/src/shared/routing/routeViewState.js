import { ASSETS, appUrl } from "../../data.js";

export const DEFAULT_CRYPTO_STATE = Object.freeze({
  view: "cycle",
  metric: "absolute",
  range: "48",
  asset: "BTC",
});

export const DEFAULT_EQUITY_STATE = Object.freeze({ range: "52" });
export const DEFAULT_MACRO_STATE = Object.freeze({ category: "all" });
export const DEFAULT_CHIP_CHAIN_STATE = Object.freeze({ range: "1d" });
export const DEFAULT_ROBOT_CHAIN_STATE = Object.freeze({ range: "1d" });

export const VALID_CRYPTO_VIEWS = new Set(["rotation", "cycle"]);
export const VALID_CRYPTO_METRICS = new Set(["absolute", "relative"]);
export const VALID_CRYPTO_RANGES = new Set(["12", "24", "48", "all"]);
export const VALID_ASSETS = new Set(ASSETS.map((asset) => asset.symbol));
export const VALID_EQUITY_RANGES = new Set(["26", "52", "all"]);
export const VALID_MACRO_CATEGORIES = new Set(["all", "inflation", "growth", "rates", "volatility", "liquidity", "other"]);
export const VALID_CHIP_CHAIN_RANGES = new Set(["1d", "5d", "1m", "3m"]);
export const VALID_ROBOT_CHAIN_RANGES = new Set(["1d", "5d", "1m", "3m"]);

function browserHash() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function hashParams(hash = browserHash()) {
  const rawHash = String(hash || "").replace(/^#/, "");
  const queryIndex = rawHash.indexOf("?");
  return new URLSearchParams(queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : "");
}

export function readCryptoStateFromHash(hash) {
  const params = hashParams(hash);
  const view = params.get("view");
  const metric = params.get("metric");
  const range = params.get("range");
  const asset = params.get("asset");
  return {
    view: VALID_CRYPTO_VIEWS.has(view) ? view : DEFAULT_CRYPTO_STATE.view,
    metric: VALID_CRYPTO_METRICS.has(metric) ? metric : DEFAULT_CRYPTO_STATE.metric,
    range: VALID_CRYPTO_RANGES.has(range) ? range : DEFAULT_CRYPTO_STATE.range,
    asset: VALID_ASSETS.has(asset) ? asset : DEFAULT_CRYPTO_STATE.asset,
  };
}

export function readEquityStateFromHash(hash) {
  const range = hashParams(hash).get("range");
  return { range: VALID_EQUITY_RANGES.has(range) ? range : DEFAULT_EQUITY_STATE.range };
}

export function readMacroStateFromHash(hash) {
  const category = hashParams(hash).get("category");
  return { category: VALID_MACRO_CATEGORIES.has(category) ? category : DEFAULT_MACRO_STATE.category };
}

export function readChipChainStateFromHash(hash) {
  const range = hashParams(hash).get("range");
  return { range: VALID_CHIP_CHAIN_RANGES.has(range) ? range : DEFAULT_CHIP_CHAIN_STATE.range };
}

export function readRobotChainStateFromHash(hash) {
  const range = hashParams(hash).get("range");
  return { range: VALID_ROBOT_CHAIN_RANGES.has(range) ? range : DEFAULT_ROBOT_CHAIN_STATE.range };
}

export function buildHashStateUrl(path, state, baseUrl = appUrl()) {
  const params = new URLSearchParams();
  Object.entries(state || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const query = params.toString();
  return `${baseUrl}#/${cleanPath}${query ? `?${query}` : ""}`;
}

function browserWindow() {
  return typeof window === "undefined" ? null : window;
}

export function replaceHashState(path, state, {
  targetWindow = browserWindow(),
  baseUrl = appUrl(),
} = {}) {
  if (!targetWindow) return;
  const nextUrl = buildHashStateUrl(path, state, baseUrl);
  const currentUrl = `${targetWindow.location.pathname}${targetWindow.location.search}${targetWindow.location.hash}`;
  if (currentUrl !== nextUrl) targetWindow.history.replaceState(null, "", nextUrl);
}

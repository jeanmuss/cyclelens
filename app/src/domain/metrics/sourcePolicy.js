import {
  DATA_USE_SCOPES,
  normalizeDataUseScope,
  ownerPrivateUseApproved,
} from "../../../scripts/data-use-scope.mjs";

export const SOURCE_POLICY_VERSION = 2;

const reviewedAt = "2026-07-18";

function policy(entry) {
  return Object.freeze({ reviewedAt, ...entry });
}

export const SOURCE_POLICIES = Object.freeze([
  policy({ id: "coinmarketcap", label: "CoinMarketCap Pro API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "CMC_REDISTRIBUTION_APPROVED", approvalDefault: "0", termsUrl: "https://coinmarketcap.com/terms/", cachePolicy: "Cache only derived values within the subscribed plan.", redistributionPolicy: "Public redistribution is fail-closed and requires the explicit gate.", attribution: "CoinMarketCap" }),
  policy({ id: "defillama", label: "DefiLlama stablecoins API", transport: "public_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "DEFILLAMA_REDISTRIBUTION_APPROVED", termsUrl: "https://api-docs.defillama.com/", cachePolicy: "Derived daily values only.", redistributionPolicy: "No explicit redistribution grant recorded; operator approval required.", attribution: "DefiLlama" }),
  policy({ id: "sosovalue", label: "SoSoValue Open API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "SOSOVALUE_REDISTRIBUTION_APPROVED", termsUrl: "https://sosovalue-1.gitbook.io/sosovalue-api-doc/", cachePolicy: "Derived daily ETF and treasury observations only.", redistributionPolicy: "Requires confirmation of the account plan and public display rights.", attribution: "SoSoValue" }),
  policy({ id: "blockbeats", label: "BlockBeats Pro API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "BLOCKBEATS_REDISTRIBUTION_APPROVED", termsUrl: "https://www.theblockbeats.info/apiDoc", cachePolicy: "Auxiliary cross-check only; never primary LKG.", redistributionPolicy: "A legal approval variable is required separately from the feature flag.", attribution: "BlockBeats" }),
  policy({ id: "sec-edgar", label: "SEC EDGAR", transport: "official_json_api", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.sec.gov/about/webmaster-frequently-asked-questions", cachePolicy: "Cache selected factual disclosure fields and source links.", redistributionPolicy: "Derived facts only; third-party exhibit rights remain with their owners.", attribution: "SEC EDGAR" }),
  policy({ id: "strategy-disclosures", label: "Strategy investor disclosures", transport: "official_disclosure", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.strategy.com/investor-relations", cachePolicy: "Cache selected disclosed facts, not complete releases.", redistributionPolicy: "Facts with a direct source link; no copied release text.", attribution: "Strategy investor disclosures" }),
  policy({ id: "japan-mof", label: "Japan Ministry of Finance", transport: "official_csv", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm", cachePolicy: "Daily derived rate observations with methodology link.", redistributionPolicy: "Factual government observations only.", attribution: "Japan Ministry of Finance" }),
  policy({ id: "fred-government", label: "FRED government-owned series", transport: "official_json_api", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html", cachePolicy: "Only allowlisted government-owned series.", redistributionPolicy: "Third-party copyrighted FRED series are excluded unless separately approved.", attribution: "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." }),
  policy({ id: "fred-third-party", label: "FRED third-party series", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "FRED_THIRD_PARTY_SERIES_APPROVED", termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html", cachePolicy: "Selected derived observations only after the underlying third-party series terms are approved.", redistributionPolicy: "FRED availability does not grant redistribution rights for CBOE, ICE BofA, NASDAQ, or other third-party series.", attribution: "FRED and the identified underlying series owner" }),
  policy({ id: "federal-reserve", label: "Federal Reserve public calendars", transport: "official_html", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.federalreserve.gov/aboutthefed/website-linking-policies.htm", cachePolicy: "Calendar facts only.", redistributionPolicy: "No copied page text or marks.", attribution: "Federal Reserve Board" }),
  policy({ id: "official-market-calendars", label: "NYSE/KRX/SSE/SZSE official calendars", transport: "official_html", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.nyse.com/trade/hours-calendars", cachePolicy: "Derived open/close intervals only.", redistributionPolicy: "Calendar facts and direct source links only.", attribution: "Relevant official exchange" }),
  policy({ id: "public-crypto-market-apis", label: "Binance/OKX/Hyperliquid/Blockchain.com public market APIs", transport: "public_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "PUBLIC_CRYPTO_MARKET_DATA_APPROVED", termsUrl: "https://www.binance.com/en/terms", cachePolicy: "Selected derived daily/monthly values only.", redistributionPolicy: "Operator must confirm display and caching terms for every active endpoint.", attribution: "Relevant market API provider" }),
  policy({ id: "alpaca", label: "Alpaca Market Data API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "ALPACA_REDISTRIBUTION_APPROVED", termsUrl: "https://alpaca.markets/data-terms-and-conditions", cachePolicy: "Derived selected bars only, within the subscribed feed terms.", redistributionPolicy: "Requires explicit confirmation for the configured feed.", attribution: "Alpaca Market Data" }),
  policy({ id: "adp", label: "ADP National Employment Report", transport: "official_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "ADP_DATA_DISPLAY_APPROVED", termsUrl: "https://www.adp.com/legal.aspx", cachePolicy: "Selected release facts only.", redistributionPolicy: "Public display approval has not been recorded.", attribution: "ADP National Employment Report" }),
  policy({ id: "akshare", label: "AKShare aggregation adapters", transport: "legacy_unofficial", reviewStatus: "blocked", productionEligible: false, termsUrl: "https://github.com/akfamily/akshare", cachePolicy: "Existing LKG only; no scheduled fetch.", redistributionPolicy: "Unofficial aggregation is prohibited without a separate review and user approval.", attribution: "Unavailable for production" }),
  policy({ id: "yahoo-finance", label: "Yahoo Finance fallback", transport: "legacy_unofficial", reviewStatus: "blocked", productionEligible: false, termsUrl: "https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html", cachePolicy: "Existing LKG only; no scheduled fetch.", redistributionPolicy: "Unofficial library access is prohibited without a separate review and user approval.", attribution: "Unavailable for production" }),
]);

export const SOURCE_POLICY_BY_ID = Object.freeze(Object.fromEntries(
  SOURCE_POLICIES.map((item) => [item.id, item]),
));

function hostMatches(host, domains) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function attestedSource(row, sourcePattern, domains = []) {
  if (!sourcePattern.test(row.source)) return false;
  return !row.host || hostMatches(row.host, domains);
}

const sourceMatchers = Object.freeze([
  ["coinmarketcap", (row) => attestedSource(row, /^(?:cmc|CoinMarketCap(?: Pro API)?)$/i, ["coinmarketcap.com"])],
  ["defillama", (row) => attestedSource(row, /^defillama$/i, ["defillama.com", "llama.fi"])],
  ["sosovalue", (row) => attestedSource(row, /^sosovalue$/i, ["sosovalue.com", "sosovalue-1.gitbook.io"])],
  ["blockbeats", (row) => attestedSource(row, /^blockbeats(?: pro api)?$/i, ["theblockbeats.info"])],
  ["sec-edgar", (row) => attestedSource(row, /^SEC EDGAR(?: company disclosures)?$/i, ["sec.gov"])],
  ["strategy-disclosures", (row) => attestedSource(row, /^Strategy (?:official|investor) (?:Form 8-K|disclosures?)$/i, ["strategy.com"])],
  ["japan-mof", (row) => attestedSource(row, /^Japan Ministry of Finance$/i, ["mof.go.jp"])],
  ["fred-third-party", (row) => attestedSource(row, /^FRED\s*\/\s*(?:CBOE|ICE BofA|Credit Suisse|NASDAQ)(?:\b|$)/i, ["stlouisfed.org"])],
  ["fred-government", (row) => attestedSource(row, /^FRED\s*\/\s*(?:U\.S\. Treasury|Federal Reserve|Board of Governors|St\. Louis Fed)(?:\b|$)/i, ["stlouisfed.org"])],
  ["federal-reserve", (row) => attestedSource(row, /^Federal Reserve (?:Board|FOMC calendar)$/i, ["federalreserve.gov"])],
  ["official-market-calendars", (row) => attestedSource(row, /^(?:NYSE|KRX|SSE|SZSE).*(?:calendar|trading rules)$/i, ["nyse.com", "krx.co.kr", "sse.com.cn", "szse.cn"])],
  ["public-crypto-market-apis", (row) => attestedSource(row, /^(?:Binance|OKX|Hyperliquid|Blockchain\.(?:com|info))(?:\b|$)/i, ["binance.com", "binance.vision", "okx.com", "hyperliquid.xyz", "blockchain.com", "blockchain.info"])],
  ["alpaca", (row) => attestedSource(row, /^Alpaca Market Data official (?:IEX|DELAYED_SIP|SIP) (?:daily bars|latest bar)$/i, ["alpaca.markets"])],
  ["adp", (row) => attestedSource(row, /^ADP National Employment Report$/i, ["adpemploymentreport.com", "adp.com"])],
  ["akshare", (row) => attestedSource(row, /^(?:AKShare|AKShare\s*\/\s*Sina US).*/i)],
  ["yahoo-finance", (row) => attestedSource(row, /^(?:Yahoo Finance|yfinance).*/i, ["yahoo.com"])],
]);

function hostFrom(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function sourcePolicyForObservation(observation) {
  const candidate = {
    source: String(observation?.source || observation?.source_key || ""),
    host: hostFrom(observation?.source_url || observation?.source_key),
  };
  const match = sourceMatchers.find(([, predicate]) => predicate(candidate));
  return match ? SOURCE_POLICY_BY_ID[match[0]] : null;
}

export function sourceIsProductionEligible(policy, environment = process.env) {
  if (!policy || policy.reviewStatus === "blocked") return false;
  if (policy.productionEligible) return true;
  if (!policy.approvalVariable) return false;
  const configured = environment?.[policy.approvalVariable];
  if (configured != null) return configured === "1";
  return policy.approvalDefault === "1";
}

export function sourceIsEligibleForDataUse(
  policy,
  { scope = DATA_USE_SCOPES.PUBLIC, environment = process.env } = {},
) {
  const normalizedScope = normalizeDataUseScope(scope);
  if (!policy || policy.reviewStatus === "blocked") return false;
  if (normalizedScope === DATA_USE_SCOPES.OWNER_PRIVATE) {
    return ownerPrivateUseApproved(environment);
  }
  return sourceIsProductionEligible(policy, environment);
}

export function sourcePolicyIdIsEligibleForDataUse(
  sourcePolicyId,
  { scope = DATA_USE_SCOPES.PUBLIC, environment = process.env } = {},
) {
  return sourceIsEligibleForDataUse(SOURCE_POLICY_BY_ID[sourcePolicyId], { scope, environment });
}

export function validateSourcePolicies(policies = SOURCE_POLICIES) {
  const errors = [];
  const ids = new Set();
  for (const entry of policies) {
    if (!entry?.id || ids.has(entry.id)) errors.push(`duplicate or blank source policy: ${entry?.id || "<blank>"}`);
    ids.add(entry?.id);
    if (!entry?.transport || !entry?.reviewStatus || !entry?.termsUrl) errors.push(`${entry?.id}: incomplete review contract`);
    if (!entry?.cachePolicy || !entry?.redistributionPolicy || !entry?.attribution) errors.push(`${entry?.id}: cache, redistribution, and attribution are required`);
    if (entry?.reviewStatus === "approval_required" && !entry?.approvalVariable) errors.push(`${entry?.id}: approval variable is required`);
    if (entry?.approvalDefault != null && !["0", "1"].includes(entry.approvalDefault)) errors.push(`${entry?.id}: approval default must be 0 or 1`);
  }
  return errors;
}

export const SOURCE_POLICY_VERSION = 1;

const reviewedAt = "2026-07-18";

function policy(entry) {
  return Object.freeze({ reviewedAt, ...entry });
}

export const SOURCE_POLICIES = Object.freeze([
  policy({ id: "coinmarketcap", label: "CoinMarketCap Pro API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "CMC_REDISTRIBUTION_APPROVED", termsUrl: "https://coinmarketcap.com/terms/", cachePolicy: "Cache only derived values within the subscribed plan.", redistributionPolicy: "Requires operator confirmation for the active plan.", attribution: "CoinMarketCap" }),
  policy({ id: "defillama", label: "DefiLlama stablecoins API", transport: "public_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "DEFILLAMA_REDISTRIBUTION_APPROVED", termsUrl: "https://api-docs.defillama.com/", cachePolicy: "Derived daily values only.", redistributionPolicy: "No explicit redistribution grant recorded; operator approval required.", attribution: "DefiLlama" }),
  policy({ id: "sosovalue", label: "SoSoValue Open API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "SOSOVALUE_REDISTRIBUTION_APPROVED", termsUrl: "https://sosovalue-1.gitbook.io/sosovalue-api-doc/", cachePolicy: "Derived daily ETF and treasury observations only.", redistributionPolicy: "Requires confirmation of the account plan and public display rights.", attribution: "SoSoValue" }),
  policy({ id: "blockbeats", label: "BlockBeats Pro API", transport: "licensed_json_api", reviewStatus: "approval_required", productionEligible: false, approvalVariable: "BLOCKBEATS_REDISTRIBUTION_APPROVED", termsUrl: "https://www.theblockbeats.info/apiDoc", cachePolicy: "Auxiliary cross-check only; never primary LKG.", redistributionPolicy: "A legal approval variable is required separately from the feature flag.", attribution: "BlockBeats" }),
  policy({ id: "sec-edgar", label: "SEC EDGAR", transport: "official_json_api", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.sec.gov/about/webmaster-frequently-asked-questions", cachePolicy: "Cache selected factual disclosure fields and source links.", redistributionPolicy: "Derived facts only; third-party exhibit rights remain with their owners.", attribution: "SEC EDGAR" }),
  policy({ id: "strategy-disclosures", label: "Strategy investor disclosures", transport: "official_disclosure", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.strategy.com/investor-relations", cachePolicy: "Cache selected disclosed facts, not complete releases.", redistributionPolicy: "Facts with a direct source link; no copied release text.", attribution: "Strategy investor disclosures" }),
  policy({ id: "japan-mof", label: "Japan Ministry of Finance", transport: "official_csv", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm", cachePolicy: "Daily derived rate observations with methodology link.", redistributionPolicy: "Factual government observations only.", attribution: "Japan Ministry of Finance" }),
  policy({ id: "fred-government", label: "FRED government-owned series", transport: "official_json_api", reviewStatus: "approved_with_conditions", productionEligible: true, termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html", cachePolicy: "Only allowlisted government-owned series.", redistributionPolicy: "Third-party copyrighted FRED series are excluded unless separately approved.", attribution: "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." }),
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

const sourceMatchers = Object.freeze([
  ["coinmarketcap", (row) => /(^|\b)cmc(\b|$)/i.test(row.source) || /coinmarketcap\.com$/i.test(row.host)],
  ["defillama", (row) => /defillama/i.test(row.source) || /llama\.fi$/i.test(row.host) || /defillama\.com$/i.test(row.host)],
  ["sosovalue", (row) => /sosovalue/i.test(row.source) || /sosovalue/i.test(row.host)],
  ["blockbeats", (row) => /blockbeats/i.test(row.source) || /blockbeats/i.test(row.host)],
  ["sec-edgar", (row) => /SEC EDGAR/i.test(row.source) || /sec\.gov$/i.test(row.host)],
  ["strategy-disclosures", (row) => /Strategy official/i.test(row.source) || /strategy\.com$/i.test(row.host)],
  ["japan-mof", (row) => /Japan Ministry of Finance/i.test(row.source) || /mof\.go\.jp$/i.test(row.host)],
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
  return Boolean(policy.approvalVariable && environment?.[policy.approvalVariable] === "1");
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
  }
  return errors;
}

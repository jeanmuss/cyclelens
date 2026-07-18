# CycleLens data-source production review

Review date: 2026-07-18

This register is an engineering release gate, not legal advice. The executable source of truth is `src/domain/metrics/sourcePolicy.js`; public metric projections reject any observation whose source is unknown, blocked, or missing its explicit approval variable. Approval variables document an operator decision but never replace provider terms or the active account plan.

## Production decisions

| Source family | Transport | Status | Cache / redistribution boundary | Production gate |
| --- | --- | --- | --- | --- |
| SEC EDGAR | Official JSON and filings | Approved with conditions | Selected factual disclosure fields and direct links only; observe SEC fair-access limits and do not copy third-party exhibit text | Built in |
| Japan Ministry of Finance | Official CSV | Approved with conditions | Derived daily JGB observations with methodology and source links | Built in |
| Federal Reserve / FRED government-owned series | Official API / HTML | Approved with conditions | Government-owned allowlisted series and calendar facts only; do not assume third-party FRED series are redistributable | Built in; third-party series require `FRED_THIRD_PARTY_SERIES_APPROVED=1` |
| NYSE, KRX, SSE, SZSE calendars | Official HTML / documents | Approved with conditions | Derived open/close intervals only, with exchange attribution | Built in |
| Strategy investor disclosures | Official disclosure | Approved with conditions | Selected disclosed facts, no copied release body | Built in |
| CoinMarketCap | Licensed API | Approval required | Derived values only under the active API plan; never publish raw responses or keys | `CMC_REDISTRIBUTION_APPROVED=1` |
| DefiLlama | Public API | Approval required | Derived daily values only; no explicit redistribution grant is recorded in the repository | `DEFILLAMA_REDISTRIBUTION_APPROVED=1` |
| SoSoValue | Licensed API | Approval required | Derived ETF/treasury observations only under the active account terms | `SOSOVALUE_REDISTRIBUTION_APPROVED=1` |
| BlockBeats | Licensed auxiliary API | Approval required | Auxiliary cross-check only and never the primary LKG series | `BLOCKBEATS_REDISTRIBUTION_APPROVED=1` and `BLOCKBEATS_AUX_ENABLED=1` |
| Binance, OKX, Hyperliquid, Blockchain.com market endpoints | Public APIs | Approval required | Selected derived values only after all active endpoints are reviewed | `PUBLIC_CRYPTO_MARKET_DATA_APPROVED=1` |
| Alpaca | Licensed market-data API | Approval required | Selected derived bars only for a feed whose display/redistribution terms were confirmed | `ALPACA_REDISTRIBUTION_APPROVED=1` |
| ADP employment report | Official report/API | Approval required | Selected release facts only; public display rights have not been recorded | `ADP_DATA_DISPLAY_APPROVED=1` |
| AKShare and Yahoo Finance library fallback | Unofficial aggregation | Blocked | Existing static LKG may remain visibly stale; scheduled production fetching is disabled | No gate; requires a new review and explicit user approval |

## Operational rules

- Provider credentials exist only in ignored local environment files or deployment secret stores. Approval variables are non-secret policy flags.
- A fetch failure cannot replace or empty the last-known-good files. Collection starts from `data-cache` (or the checked-in baseline), and publication occurs only after projection contract tests pass.
- Public projections contain only catalog fields, allowlisted dimensions, bounded observations, provider attribution, source links without query strings, and separate observed/fetched/checked/transformed timestamps.
- FRED-backed public features must display: “This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.” Third-party copyrighted series remain disabled until separately approved.
- Source reviews must be revisited when provider terms, endpoints, account plans, display scope, or cache duration changes.

## Primary review references

- [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html)
- [SEC data APIs and developer guidance](https://data.sec.gov/)
- [CoinMarketCap Terms of Use](https://coinmarketcap.com/terms/)
- [CoinMarketCap API plan and usage boundaries](https://coinmarketcap.com/api/pricing/)
- [Japan Ministry of Finance JGB rate methodology](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm)
- [NYSE trading hours and calendars](https://www.nyse.com/trade/hours-calendars)
- [Alpaca market-data terms](https://alpaca.markets/data-terms-and-conditions)
- [DefiLlama API documentation](https://api-docs.defillama.com/)
- [SoSoValue API documentation](https://sosovalue-1.gitbook.io/sosovalue-api-doc/)

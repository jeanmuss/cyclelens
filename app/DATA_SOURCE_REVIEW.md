# CycleLens data-source review

Review date: 2026-07-23

This register is an engineering release gate, not legal advice. The executable source of truth is `src/domain/metrics/sourcePolicy.js`.

## Scope decisions

Public and owner-private use are separate decisions:

- Public projections reject unknown, blocked, or unapproved sources. Every redistribution/display approval defaults off unless the policy explicitly says otherwise.
- Owner-private collection requires `CYCLELENS_DATA_USE_SCOPE=owner_private` and `CYCLELENS_OWNER_PRIVATE_USE_APPROVED=1`. Reviewed sources can then be used without asserting a public redistribution variable.
- Owner-private use still must comply with the provider’s terms, account plan, rate limits, attribution, caching, and personal-use restrictions.
- A key proves authentication only; it is not proof of display or redistribution permission.

## Source register

| Source family | Transport | Review disposition | Owner-private boundary | Public gate |
| --- | --- | --- | --- | --- |
| SEC EDGAR | Official JSON and filings | Approved with conditions | Selected factual fields and direct links; fair-access user agent required | Built in for derived facts |
| Japan Ministry of Finance | Official CSV | Approved with conditions | Derived daily JGB observations and source links | Built in |
| FRED government-owned series | Official REST API | Approved with conditions | Allowlisted series only | Built in |
| FRED third-party series | Official REST transport, third-party rights | Approval required | Selected observations only after the underlying series terms are accepted | `FRED_THIRD_PARTY_SERIES_APPROVED=1` |
| Federal Reserve, OPM, and exchange calendars | Official HTML/documents | Approved with conditions | Calendar facts only; no copied page bodies or marks | Built in |
| Strategy investor disclosures | Official disclosure | Approved with conditions | Selected holdings/cost facts and direct links | Built in |
| CoinMarketCap | Licensed API | Approval required | Derived values under the active account plan; never retain raw responses | `CMC_REDISTRIBUTION_APPROVED=1` |
| DefiLlama | Documented public API at `api.llama.fi` | Approval required | Derived stablecoin observations only | `DEFILLAMA_REDISTRIBUTION_APPROVED=1` |
| SoSoValue | Licensed API | Approval required | Derived ETF observations under the active plan | `SOSOVALUE_REDISTRIBUTION_APPROVED=1` |
| BlockBeats | Licensed auxiliary API | Approval required | Auxiliary cross-check only; never primary LKG | `BLOCKBEATS_REDISTRIBUTION_APPROVED=1` plus feature enablement |
| Binance, OKX, Hyperliquid, Blockchain.com | Documented public market APIs | Approval required | Selected bounded derived market observations | `PUBLIC_CRYPTO_MARKET_DATA_APPROVED=1` |
| Alpaca | Licensed official market-data API | Approval required | Selected bars for the configured `iex`, `delayed_sip`, or `sip` entitlement | `ALPACA_REDISTRIBUTION_APPROVED=1` |
| ADP National Employment Report | Official-domain static JSON | Approval required and fragile | Selected report facts only. No stable public API contract was found, so treat endpoint changes as a re-review trigger | `ADP_DATA_DISPLAY_APPROVED=1` |
| AKShare, yfinance/Yahoo wrappers | Unofficial aggregation | Blocked | Existing visible LKG may remain stale; no new fetch | None; requires a new dependency/data-flow/terms review and explicit approval |
| TradingView scraping/session reuse | Unofficial or authenticated browser path | Blocked | No cookies, reverse-engineered endpoints, or session reuse | None |

## Operational controls

- All provider destinations are exact reviewed HTTPS origins. Redirects are rejected, response bodies are bounded, and timeouts cover body consumption.
- Credentials are supplied only to the collector step that needs them. They never enter query-bearing logs, frontend variables, Git, generic Actions artifacts, or public workflows.
- CoinMarketCap is exact opt-in and centrally acquired. A service-role-only Postgres RPC atomically reserves explicit UTC daily/monthly credit budgets before traffic and rejects ambiguous replays; the coordinator reuses two current responses across three consumers, fixes history to a 20-hour minimum cadence, and records only bounded derived state and usage metadata in service-only Supabase tables.
- Owner raw data and caches are ignored. Collection, projection, validation, build, and deployment stay on one ephemeral runner.
- Enabled owner datasets must have the private scope and a transformation timestamp from the current release. The final manifest must match every dataset hash and size.
- A failed owner release does not deploy, so Cloudflare keeps the previous successful version. There is no generic cross-run private snapshot; selected history/manual events and the reviewed CMC provider-state LKG live in Supabase.
- Public GitHub Pages contains only a data-free retirement shell. Old `data-cache`, Telegram, and public projection workflows do not publish owner data.
- Source labels and source hosts are validated together. Similar-looking hostnames and user-info URLs are rejected; source URLs are stored without credentials, query strings, or fragments.
- FRED observation dates are economic observation dates unless a separate official release-calendar endpoint supplies a release date.

## Semantic non-substitution

Exchange ticker/candle APIs do not provide global circulating stablecoin market capitalization or U.S.-listed ETF creations/redemptions. They must not silently replace DefiLlama/CMC stablecoin series or SoSoValue ETF-flow series. Missing provider coverage remains unavailable or visibly last-known-good.

## Re-review triggers

Re-run the source and security review when a provider changes its terms, hostname, endpoint, account plan, feed entitlement, cache duration, response schema, authentication method, or intended visibility. Moving any dataset back to public display requires a separate redistribution decision even if owner-private testing was successful.

## Primary references

- [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html)
- [SEC data APIs](https://data.sec.gov/)
- [CoinMarketCap Terms of Use](https://coinmarketcap.com/terms/)
- [Japan MOF JGB methodology](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm)
- [Alpaca market-data terms](https://alpaca.markets/data-terms-and-conditions)
- [DefiLlama API documentation](https://api-docs.defillama.com/)
- [SoSoValue API documentation](https://sosovalue-1.gitbook.io/sosovalue-api-doc/)
- [Binance market-data-only endpoints](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only)
- [OKX market-data API](https://www.okx.com/docs-v5/en/)

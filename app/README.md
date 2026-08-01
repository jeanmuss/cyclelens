# CycleLens

CycleLens combines a crypto cycle map, macro calendar, U.S. equity view, global market clock, AI chip-chain map, robotics watchlist, and owner-curated events.

## Visibility model

The product now has two deliberately separate outputs:

- `npm run build` or `npm run build:public-retired` creates `dist-public`, a three-file retirement shell with no product data.
- `npm run build:owner` creates `dist-owner`, which contains plaintext owner-private JSON and must be served only behind both Cloudflare Access and Pages Functions.

A bare `vite build` is rejected. Protected builds require an explicit `--mode owner` or `--mode admin` and `CYCLELENS_PROTECTED_BUILD_APPROVED=1`. Never upload or mirror `dist-owner` to GitHub Pages, object storage, a generic CDN, an Actions artifact, or another static host.

## Data flow

Collectors run only in local backend/CI contexts. The browser never connects to a provider and never receives a provider key.

Owner runs use:

- raw data: `data/private/raw/`
- curated manual events: `data/private/manual-macro-events.json`
- projections: `data/private/projections/`
- provider caches: `../tmp/owner-private/`
- final manifest: `data/private/data-manifest.json`

These paths are ignored by Git. Public seed files under `public/data/` are read-only historical last-known-good inputs and are not an owner persistence channel.

Current reviewed transports include official FRED REST, Federal Reserve/OPM calendars, Japan MOF CSV, SEC EDGAR, Alpaca, CoinMarketCap, SoSoValue, BlockBeats, DefiLlama’s documented `api.llama.fi` API, and selected public exchange market endpoints. Every network collector pins exact HTTPS origins, rejects redirects, bounds response bodies, and keeps timeouts active through body consumption.

AKShare, yfinance/Yahoo wrappers, unofficial TradingView endpoints, cookies, and authenticated browser-session reuse are blocked. Existing rows bearing those legacy source labels can remain as visibly stale audit/LKG material, but cannot be fetched, persisted as approved observations, or enter a validated projection.

## Source policy

Public redistribution remains fail-closed per source. Owner-private use requires the single global gate:

```text
CYCLELENS_DATA_USE_SCOPE=owner_private
CYCLELENS_OWNER_PRIVATE_USE_APPROVED=1
```

That gate records the operator’s decision to use reviewed sources privately. It does not override provider terms, plan limits, attribution, rate limits, caching restrictions, or prohibitions on redistribution. See [DATA_SOURCE_REVIEW.md](DATA_SOURCE_REVIEW.md).

## Local commands

```bash
npm ci
npm run dev
npm run build
```

The ordinary build is intentionally safe and data-free. A local owner run should use ignored environment files and then execute:

```bash
npm run prepare-owner-data
npm run refresh-cmc-provider-state
npm run update-data
npm run update-crypto-liquidity
npm run update-market-session
npm run update-chip-chain
npm run update-robot-chain
npm run update-equity-fast-data
npm run update-equity-data
npm run sync-manual-macro-events
npm run update-macro-calendar
npm run update-chart-series
npm run project-owner-data
npm run generate-owner-data-manifest
npm run validate-owner-release-data
npm run build:owner
npm run build:owner:functions
```

The release validator additionally needs the workflow’s start-time file and explicit true/false collector flags; it is normally invoked by `_owner-release.yml`.

`refresh-cmc-provider-state` is independently default-off and never calls CMC merely because a key exists. Set `CYCLELENS_COLLECT_CMC=true` only for an intentional private refresh, together with positive `CYCLELENS_CMC_DAILY_CREDIT_BUDGET` and `CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET` values (daily must not exceed monthly). The optional current interval defaults to 360 minutes; historical cadence is fixed at 20 hours. With the switch set to `false`, the command only hydrates a private LKG from Supabase and makes zero CMC requests. Before enabling it, apply `supabase/migrations/20260801000000_cmc_atomic_budget_reservation.sql`: the service-role-only RPC serializes reservations in Postgres and a replayed or ambiguous run stops before provider traffic.

Install Python dependencies with hash verification:

```bash
python -m pip install --require-hashes -r requirements-equity.txt
```

Never paste a provider key into chat or commit it. Use `.env.local`/`.dev.vars` files that are already ignored, or the `cyclelens-admin` GitHub Environment.

## Last-known-good behavior

Collectors merge partial successful responses with their local private LKG where possible. A scheduled GitHub runner is ephemeral, and private datasets are intentionally not transferred through GitHub cache/artifact or a branch. Supabase preserves selected metric history, curated manual events, and the bounded derived CMC provider state/credit ledger. It is not a complete canonical snapshot for every raw dataset.

Consequently, the owner release requires enabled datasets to be transformed during the current run and refuses deployment if a reviewed source does not refresh sufficiently. CMC is handled separately: one central step hydrates its service-only cross-run LKG, enforces cadence and credit budgets, and supplies all three consumers; those consumers still have to refresh their independent non-CMC primary sources. Cloudflare retains the prior successful deployment when a gate fails. Any broader private Supabase/R2 snapshot store still requires a separate access, schema, size, retention, and integrity review.

## Deployment

`deploy-owner.yml` calls `_owner-release.yml` as one job on one runner. Secrets are scoped to the individual collector or deploy step. No private artifact, dependency cache containing data, Git branch, or public workflow carries owner bytes.

Before deploying:

- restrict the `cyclelens-admin` GitHub Environment to `main`;
- configure exactly one pseudonymous allowed Access actor;
- protect production, preview, `pages.dev`, and any custom domains;
- keep Cloudflare and Supabase credentials in their secret stores;
- apply and verify required Supabase migrations separately.

The workflow performs anonymous-denial checks before and after deployment. Configuration details are in [the Cloudflare handoff](../docs/deployment/ADMIN_CLOUDFLARE.md).

Telegram delivery and the old public data-cache/publishing paths are retired. Their remaining rendering or compatibility code is not reachable from a scheduled publishing workflow.

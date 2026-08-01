# CycleLens owner deployment: Cloudflare Pages and Access

Updated: 2026-07-23

This document describes the required boundary. Repository configuration alone does not prove that the external Cloudflare, GitHub, or Supabase settings are currently correct.

## Architecture

`dist-owner` contains plaintext private JSON. It is safe to publish only when both controls cover every route:

1. Cloudflare Access protects the production domain, the stable `pages.dev` domain, preview domains, and every custom domain.
2. Pages Functions executes `_middleware.js` for `/*`, validates the Access JWT, and admits exactly one configured pseudonymous actor.

The owner build emits `_routes.json` with `include: ["/*"]` and no exclusions. Middleware authenticates HTML, assets, JSON, and APIs before content is returned and sets `Cache-Control: private, no-store`.

Do not use Cloudflare Pages’ static asset bypass for owner data. Do not mirror `dist-owner` to another static/CDN/object-storage host.

## Cloudflare encrypted secrets

Configure these separately for production and preview:

| Name | Purpose |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Exact `https://<team>.cloudflareaccess.com` issuer and JWKS origin |
| `CF_ACCESS_AUD` | Exact Access application audience |
| `CF_ACCESS_ALLOWED_ACTORS` | Exactly one `cf-access:<24 lowercase hex>` owner actor |
| `CYCLELENS_ADMIN_ORIGINS` | Comma-separated exact HTTPS application origins |
| `CYCLELENS_ADMIN_HOST_SUFFIXES` | Only the project’s own `pages.dev` suffixes needed for previews |
| `SUPABASE_URL` | Hosted `https://<project>.supabase.co` API origin |
| `SUPABASE_SECRET_KEY` | Backend-only `sb_secret_...` key |

The middleware hashes the verified Access JWT `sub` claim with SHA-256 and uses the first 24 lowercase hex characters, prefixed by `cf-access:`. Derive this value offline from a locally verified token/identity; do not paste the JWT, email address, subject, or key into chat, tickets, logs, or the repository. `CF_ACCESS_ALLOWED_ACTORS` must contain exactly one value. A missing, malformed, or second actor causes fail-closed authentication.

Access policy and the application actor check are independent. Configure the Access policy for only the owner identity, then configure the matching pseudonymous actor as the second boundary.

## GitHub Environment

Create or review the `cyclelens-admin` Environment:

- restrict deployment to `jeanmuss/cyclelens` on `refs/heads/main`;
- optionally require a human reviewer;
- store provider, Supabase, and Cloudflare credentials as Environment secrets;
- keep `OWNER_DATA_COLLECTION_APPROVED=1` and individual `OWNER_COLLECT_*` switches as non-secret variables;
- keep `OWNER_COLLECT_CMC` unset or different from `1` until the account has usable credits; CMC is exact opt-in rather than default-on;
- apply and verify `supabase/migrations/20260801000000_cmc_atomic_budget_reservation.sql` before enabling CMC; its RPC is granted only to `service_role`, serializes the UTC budget ledger, and rejects replayed reservations before provider traffic;
- before setting `OWNER_COLLECT_CMC=1`, set positive integer `OWNER_CMC_DAILY_CREDIT_BUDGET` and `OWNER_CMC_MONTHLY_CREDIT_BUDGET` values with the daily limit no greater than the monthly limit; `OWNER_CMC_CURRENT_MIN_INTERVAL_MINUTES` is optional and defaults to 360 minutes;
- use least-privilege Cloudflare and Supabase credentials.

The reusable workflow scopes each secret to its collector/deploy step. It does not use `secrets: inherit`, Actions data artifacts, dependency cache for private bytes, or a data branch.

CoinMarketCap is acquired once per release into `tmp/owner-private/provider-state/coinmarketcap.json`. Only that central step receives the CMC credential. A due current refresh makes at most one global request and one six-asset quote request; historical refresh is fixed at a minimum 20-hour cadence and makes at most two additional requests when its conservative, atomic credit reservation fits both budgets. The three downstream datasets consume the normalized derived state and have no CMC network or credential path.

## Build and release

The public command is deliberately harmless:

```powershell
npm --prefix app run build
```

It produces only `dist-public`. A protected local build requires explicit approval:

```powershell
$env:CYCLELENS_DATA_USE_SCOPE = "owner_private"
$env:CYCLELENS_OWNER_PRIVATE_USE_APPROVED = "1"
$env:CYCLELENS_PROTECTED_BUILD_APPROVED = "1"
npm --prefix app run prepare-owner-data
npm --prefix app run project-owner-data
npm --prefix app run generate-owner-data-manifest
npm --prefix app run build:owner
npm --prefix app run build:owner:functions
```

The scheduled production path is `.github/workflows/deploy-owner.yml`. `_owner-release.yml` runs collection, projection, Python/Node security tests, release-data validation, both builds, and deployment in one job.

Before deploying it verifies that an anonymous request to:

```text
https://cyclelens-admin.pages.dev/data/data-manifest.json
```

receives only an Access redirect or `401`/`403`. It repeats the check after deployment and never prints the response body. A `2xx` response blocks/fails the release.

## Supabase

The browser never receives a Supabase secret. Pages Functions and CI accept hosted `*.supabase.co` origins only (loopback HTTP is allowed solely by the local CLI path), reject redirects, limit response bodies, and suppress response text in errors.

Apply migrations separately and verify row counts, grants, RLS, and postconditions. In particular, the repository migration `20260723233044_owner_private_alpaca_source.sql` being present does not mean it has been applied to the production project.

Browser roles must retain no access to private manual-event or metric-history tables. Use a dedicated least-privilege backend key and rotate it if any log or diagnostic may have exposed it.

CMC cross-run state reuses the existing service-only tables rather than adding a new public schema. `dashboard_snapshot_runs` holds the bounded derived state, watermarks, and conservative credit reservations; `market_metric_observations` restores canonical CMC history. A `started` reservation is written before provider traffic and completed or failed afterward. Raw CMC responses and credentials are never stored. CMC state hydration accepts only hosted HTTPS `*.supabase.co` origins and preserves a prior-month LKG while calculating daily/monthly usage only from the current UTC periods.

## Verification checklist

- Anonymous root, asset, JSON, and API requests are denied on production and preview.
- The verified owner can load the dashboard and manual-event API.
- A valid Access token for any other subject is denied by the actor allowlist.
- `_routes.json` protects `/*` with no exclusions.
- Responses contain `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.
- No owner data appears in GitHub Pages, Actions artifacts/cache, Git history, deployment logs, or a public bucket.
- Provider failures leave the prior Cloudflare deployment active.

## Rollback

Redeploy the previous verified Cloudflare version; never disable Access or remove Functions to restore availability. If a credential may have leaked, revoke/rotate it first, then update the corresponding encrypted secret and redeploy. If anonymous access ever returns `2xx`, treat the deployed owner data as exposed and investigate before resuming collection.

## References

- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Cloudflare Pages Access known issues](https://developers.cloudflare.com/pages/platform/known-issues/)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)

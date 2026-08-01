# CycleLens owner-private security boundary review — 2026-07-24

## Outcome

The current repository design materially separates the owner product from its
retired public surface. No confirmed P0/P1 anonymous exploit path remains in
the reviewed local code. That conclusion is conditional: `dist-owner` contains
plaintext owner data, so a missing or misconfigured external Cloudflare Access
or Pages Functions control would still expose it.

This is a source/workflow review of a dirty local worktree based on commit
`1463c2a`. It is not a statement that a deployment occurred, that a Supabase
migration was applied, or that the live Cloudflare/GitHub/Supabase
configuration was verified.

## Intended boundary and trust model

The permitted owner data path is:

```text
reviewed provider
  -> one ephemeral GitHub Actions runner
  -> ignored app/data/private/raw + tmp/owner-private
  -> private projection + size/freshness/SHA-256 manifest validation
  -> dist-owner
  -> existing Cloudflare Pages project
  -> Cloudflare Access AND Pages Functions JWT/actor enforcement
  -> the single configured owner
```

The public path is deliberately separate:

```text
public GitHub Pages workflow
  -> data-free dist-public retirement shell
  -> index.html + 404.html + public-retired-release.json only
```

Trusted administrative surfaces are GitHub repository/environment
administrators, Cloudflare account/application administrators, Supabase project
administrators, and the owner who approves provider use. Provider responses,
HTTP redirects, source URLs, manual-event payloads, and repository
dependencies are treated as untrusted inputs.

GitHub Actions and Cloudflare necessarily process plaintext owner data.
Supabase processes selected metric history and curated manual events. These
processors are inside the operational trust boundary; this design is not
end-to-end encrypted from those platforms.

## Initial findings and current disposition

| ID | Initial severity | Initial attack path | Current closure evidence | Disposition |
| --- | --- | --- | --- | --- |
| F-01 | High | Scheduled/public workflows could collect data and then push or deploy the same tree to a public data branch or GitHub Pages | `deploy-pages.yml` builds a three-file retirement shell; `update-market-data.yml`, `_project-public-snapshots.yml`, and `telegram-morning-brief.yml` are inert/manual retirement stubs; `_owner-release.yml` keeps collection through deploy in one job | Closed in repository |
| F-02 | High | A public repository Actions artifact could carry owner raw/projection data between jobs and be downloadable by repository readers | Owner release uses one runner and no upload/download artifact, data cache, or data branch; workflow governance tests reject these sinks | Closed in repository |
| F-03 | High | Any otherwise valid Cloudflare Access subject could reach plaintext owner data | Access JWT validation verifies RS256 signature, `iss`, `aud`, `exp`, `nbf`, and then hashes `sub` and admits exactly one configured `cf-access:<24 hex>` actor | Closed in repository; live Access configuration unverified |
| F-04 | High | A build environment override or ordinary build could produce a private-data bundle under a public target | Bare protected Vite builds fail; owner/admin require explicit mode and approval; protected builds reject GitHub Pages; ordinary `npm run build` invokes the data-free retirement builder; owner output is `dist-owner` with a release marker and all-route `_routes.json` | Closed in repository |
| F-05 | High | Public-source approval or an omitted scope could fail open, or an unknown/blocked source could enter a projection | Public approvals compare exactly to `"1"` and default off; operator-facing collection commands pass `--scope owner_private`, missing scope is rejected, and owner use requires the global approval; unknown sources, AKShare, and yfinance/Yahoo remain blocked; observation and projection contracts revalidate policy/visibility | Closed in repository |
| F-06 | High | A configurable provider base URL, redirect, PowerShell fallback, or unbounded body could send credentials to another host or exhaust the runner | Node and Python transports pin reviewed HTTPS origins, reject userinfo/redirects, bound streamed bodies, keep timeouts through body consumption, and suppress credential-bearing exception detail; undocumented `api.binance.me` and shell HTTP fallbacks were removed | Closed for reviewed collector destinations |
| F-07 | High | Owner files could share `public/data`, `dist`, cache, or Git paths and be accidentally committed or deployed | Scope helpers select `app/data/private/raw`, `app/data/private/projections`, `tmp/owner-private`, and `dist-owner`; all are ignored; final manifest covers 12 datasets and is checked against the exact final bytes | Closed in repository |
| F-08 | Medium | Supabase/service credentials or manual-event source URLs could leak through arbitrary destinations, redirects, response bodies, logs, or projected query strings | Hosted Supabase clients require HTTPS `*.supabase.co` origins (local CLI alone permits loopback), reject redirects, bound responses, and log status/code rather than response text; manual source URLs reject userinfo and strip query/fragment; projections scan private/credential-like fields | Closed for current code; exact-project trust remains RR-02 |
| F-09 | Medium | Mutable GitHub Action tags and incompletely pinned Python packages could execute changed supply-chain code with owner secrets | External Actions use full commit SHAs; Python runtime closure is exact-version/hash locked and CI uses `--require-hashes --only-binary=:all: --no-cache-dir --force-reinstall` followed by `pip check`; npm uses `npm ci` and a lockfile | Closed in repository; clean network install remains unverified |
| F-10 | Medium | A Telegram workflow or local CLI could send owner data to a third-party chat or retain a preview/receipt artifact | Telegram workflow is manual and inert; the rendering CLI and package entry were removed; direct execution of the retained injected-transport module fails closed; owner release exposes no Telegram credentials | Closed in repository |
| F-11 | Low | Manual-event source URLs could include credentials or secret query parameters and later enter logs/projections | Contract rejects URL userinfo and removes query/fragment; API maps the validation errors to bounded client errors; projection sanitization repeats the removal | Closed in repository |
| F-12 | Low | Local macro admin could write a public path or bind to a non-loopback address while relying only on a forgeable header/origin pair | The package entry supplies explicit `owner_private` scope; startup requires owner approval, resolves only private data paths, hard-pins `127.0.0.1`, and rejects a different host override | Closed in repository |

## Attack-path closure evidence

### Anonymous request to owner JSON

The original impact was direct disclosure of plaintext private datasets.
Current repository controls require both:

1. an external Cloudflare Access policy, and
2. Pages Functions middleware on `/*`.

The build emits `_routes.json` with `include: ["/*"]` and no exclusions.
Middleware runs before the asset/API response, validates the Access JWT and
single actor, and adds `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex`, CSP, frame denial, and other hardening headers.
Focused tests cover missing, malformed, expired, wrong-issuer,
wrong-audience, wrong-signature, and wrong-actor tokens.

The owner workflow performs a bodyless, no-redirect anonymous probe before and
after deploy and accepts only a redirect, `401`, or `403`. These checks are
repository evidence of the intended gate, not evidence that they have run
successfully against the current external service.

### Owner bytes entering a public GitHub channel

The collection, projection, validation, build, and Cloudflare deploy steps are
in one reusable-workflow job. Private files do not cross a job boundary and
there is no owner-data artifact, dependency/data cache, Git commit/push, Pages
upload, Telegram send, or public bucket step. Provider and Supabase credentials
are attached only to the steps that use them; Cloudflare credentials are
attached only to the deploy step.

The only remaining GitHub Pages upload comes from `deploy-pages.yml`, after a
file allowlist proves the artifact contains exactly the retirement
`index.html`, `404.html`, and `public-retired-release.json`.

### Credential exfiltration through a provider/Supabase URL

Reviewed collectors construct destinations from repository constants.
`secure-fetch.mjs` and `secure_http.py` reject non-HTTPS, userinfo, unreviewed
origins, and redirects before consuming a body. Bodies are streamed under
fixed byte and total-time limits. Tests prove a lookalike origin is rejected
before the mocked network function is called, redirected and oversized
responses fail, a hanging body times out, and Python tracebacks do not retain a
query credential.

Supabase destinations are parsed before service credentials are attached.
They require hosted `*.supabase.co` HTTPS origins, no userinfo/path/query/hash,
no redirects, bounded responses, and generic/status-only error reporting.

### Private data accidentally entering a public build

Owner source, projection, cache, manifest, and distribution paths are distinct
and ignored. The Vite owner plugin refuses missing datasets, requires
owner-private projections/manifest, checks the manifest entry path and
SHA-256 of every final dataset, emits an owner release marker, and writes only
to `dist-owner`. Release validation also bounds individual and aggregate size
and requires enabled datasets to have been transformed during the current
release.

The public builder deletes only a guarded `dist-public` path and recreates
exactly three data-free files. Public workflow verification compares the full
artifact file list to that allowlist.

### Local administrative and retired delivery surfaces

The macro-event admin command now supplies `--scope owner_private`; startup
also requires the owner-private approval gate. Its source, output, and child
collector paths resolve through the private scope helper. The server binds to
the literal `127.0.0.1` and rejects a conflicting host environment value, so a
header/origin check is no longer the only boundary against a LAN listener.
The deployment workflow does not start this local tool.

Telegram has no workflow schedule, package rendering entry, or rendering CLI.
Its workflow is a fail-closed retirement stub. The remaining sender module
keeps only an injected transport function for deterministic tests; executing
that file directly sets a failing exit code before any send operation. No
owner release step receives Telegram credentials.

## Residual risks, assumptions, and follow-up

### RR-01 — No complete cross-run private LKG (P2 integrity/availability)

Each hosted runner starts by seeding ignored private data from the old
checked-in public snapshots. Primary freshness gates prevent a completely
failed collector from replacing the deployed owner version, and Cloudflare
retains the previous successful deployment when the workflow fails. However,
Supabase currently preserves only selected history/manual-event state, not
every owner raw dataset and optional/historical field. A run whose required
primary sources succeed can still regress a non-required historical or
optional field to the older public seed.

Do not solve this with a public Actions artifact, Git branch, or cache. The
follow-up should be a versioned private canonical snapshot in a separately
reviewed Supabase/R2 store with exact project/account binding, encryption and
access policy, object-size/retention limits, manifest verification, and
rollback.

### RR-02 — Supabase project identity is configuration trust (P2 defense in depth)

Credentialed clients accept any hosted `*.supabase.co` project rather than a
repository-hard-coded project ref. This prevents arbitrary-host exfiltration,
but a principal able to change `SUPABASE_URL` independently of the key could
attempt tenant-confusion. Current GitHub/Cloudflare operation must treat the
URL and key as one high-trust, jointly administered secret configuration.
Future hardening can pin an expected project ref or a separate exact-origin
allowlist without putting credentials in source.

### RR-03 — Future “fetch everything” collectors need schema admission

Current collectors normalize provider responses into selected fields, and the
current reviewed datasets contain no credential-like fields/URLs. The raw
owner JSON validator checks scope, freshness, structure, size, and manifest
hashes, but it is not a generic secret/PII classifier. A future collector must
not dump a complete provider response merely because the destination is
private. It needs a reviewed schema, field allowlist, provenance, bounded
cardinality, and explicit treatment of identifiers, licensed text, and
credentials before admission.

Source-policy attestation also permits a recognized source label when
`source_url` is empty/invalid. That is low risk under the current
service-role-only database and trusted-collector model, but a future
multi-writer system should stamp a trusted policy id at ingestion and require
an attested URL when the policy defines one.

### RR-06 — Existing public disclosure cannot be reversed

Checked-in `app/public/data`, Git history, previous public deployments, and any
downloaded copies remain public historical material. The new boundary prevents
future owner bytes from using those channels; it cannot make prior disclosure
confidential. Connected repository metadata observed during this review
reported the active repository as public. Repository visibility and retention
are external decisions, and changing visibility would not erase prior clones.

### RR-07 — External platform configuration and processor trust

The repository cannot prove:

- that Cloudflare Access covers the production, stable `pages.dev`, preview,
  and custom domains;
- that Pages Functions is active for every static asset/API route;
- that the single actor, issuer, audience, GitHub Environment protection, and
  branch restrictions are configured as documented;
- that Cloudflare/Supabase/provider tokens have least privilege and have never
  leaked;
- that Supabase RLS/grants and the new migration are applied to the intended
  project; or
- that GitHub and Cloudflare meet the owner's plaintext-data processing and
  retention expectations.

These are release blockers until verified by the owner in the corresponding
control planes.

## Verification evidence and gaps

Repository-focused checks covered auth/build/workflow/source/manifest/manual
event transports plus the Python secure HTTP transport. The exact final
commands and counts are recorded in the companion coverage ledger.

Known workstation limitations:

- the in-process Node run discovered 195 tests and passed 194; the one
  unexecuted behavior test invokes `child_process.spawn` itself and the
  workstation sandbox denied that call with `EPERM`. The other 28 Node test
  files passed 177 / 177, and the focused owner-boundary suites passed 58 / 58;
- Vite/esbuild could not spawn its helper process in this sandbox, so a real
  owner Vite build did not complete here;
- network restrictions and an approval-service model error prevented a clean
  CPython 3.12/Linux download/install of the hash-locked requirements;
- no provider credentials were used for a live owner collection;
- no Cloudflare deployment or live pre/post-deploy anonymous probe was
  performed;
- no Supabase migration was applied and no remote RLS/grant check was
  performed; and
- formal Codex Security scan
  `230acfe3-d8e3-4293-b767-de386e826314` was canceled externally after its
  `scanDir` was unreachable from the shell and escalation failed because of an
  approval-service model error.

No canonical scan JSON or `report.md` is claimed by these documents.

## Release decision

The local code is suitable for an owner-only pilot only after the external
release checklist in `docs/deployment/ADMIN_CLOUDFLARE.md` is completed and an
anonymous request to every owner domain/preview path is shown to fail closed.
Do not use the owner build on ordinary static hosting, do not restore
artifact/data-branch/Telegram transport, and do not interpret private use as
permission to violate provider terms or later republish the data.

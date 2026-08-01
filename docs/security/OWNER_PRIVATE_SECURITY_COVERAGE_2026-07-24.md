# Owner-private security review coverage ledger — 2026-07-24

## Purpose and status

This ledger records the local repository coverage used for the CycleLens
owner-private boundary review. It is an auditable local-review receipt, not a
canonical Codex Security scan artifact and not evidence that any remote
Cloudflare, GitHub, provider, or Supabase setting is correct.

The inventory was taken from the dirty worktree on branch
`codex/cyclelens-refactor`, based on commit `1463c2a`. The two security
documents produced by this review are included in the document count so that a
fresh inventory of the handed-off worktree is self-consistent.

## Reproducible inventory

The inventory command is:

```powershell
$files = @(
  rg --files --hidden -g '!.git/**' |
    ForEach-Object { $_ -replace '\\', '/' } |
    Sort-Object
)
$tests = @($files | Where-Object { $_ -like 'app/test/*' })
$docs = @($files | Where-Object {
  $_ -like '*.md' -and $_ -notlike 'app/test/*'
})
$runtime = @($files | Where-Object {
  $_ -notlike 'app/test/*' -and $_ -notlike '*.md'
})
```

`rg --files` continues to honor `.gitignore`. `--hidden` is used so that
`.github`, `.gitignore`, and `.gitattributes` are included; `.git/**` is
excluded explicitly. As a result, `.git/`, `node_modules/`,
`app/data/private/`, `data/private/`, `tmp/`, `dist/`, `app/dist-*`,
`.wrangler/`, `.reference/`, local environment files, logs, and other ignored
outputs are not in scope.

| Category | Count | Closure |
| --- | ---: | --- |
| Runtime, source, config, workflow, checked-in data, and migrations | 184 | 184 reviewed receipts |
| Tests | 31 | 31 mapped/reviewed receipts |
| Documentation and repository policy | 19 | 19 reviewed receipts |
| **Total** | **234** | **234 / 234 closed** |

The sorted path-list SHA-256 at handoff is
`85c7b98c14007d1d8472a327586af55e727877dd3466c0e9aaff23503daf8ef6`.
It is a path-list fingerprint, not a content
hash and not a release signature.

## Receipt semantics

- `reviewed-remediated` means the batch contained a confirmed boundary issue,
  the current worktree contains the remediation, and focused proof is mapped
  below.
- `reviewed-no-new-finding` means the batch received the stated static/manual
  checks and did not produce a new current-code finding.
- `reviewed-with-residual` means the files were reviewed but a documented
  assumption, future-change hazard, external dependency, or lower-priority
  issue remains.
- `not-applicable-executable` is used only for non-executable data/style/assets;
  those files still received format, external-reference, and secret-like
  content checks.
- `deferred-external` never means a repository file was skipped. It means the
  corresponding remote configuration or live service could not be proved from
  this workstation.

## Runtime/source/config/workflow/migration worklist

The following rows are disjoint. Their counts sum to 184.

| Receipt | Exact batch membership | Count | Review performed | Disposition |
| --- | --- | ---: | --- | --- |
| R01 | Exact set: `.gitattributes`, `.gitignore`, `app/.dev.vars.example`, `app/.env.example`, `app/index.html`, `app/package.json`, `app/package-lock.json`, `app/product.config.mjs`, `app/requirements-equity.txt`, `app/vite.config.mjs`, `app/wrangler.jsonc` | 11 | Secret placeholders/ignore rules, build-target resolution, output paths, package lock, Python hash lock, Wrangler target | `reviewed-remediated`; clean external package install remains `deferred-external` |
| R02 | `.github/workflows/*.yml` | 6 | Triggers, permissions, repository/ref/environment gates, secret scope, artifact/cache/Git/public sinks, action refs, collection-to-deploy job topology | `reviewed-remediated`; no owner-data Actions artifact or public publishing path remains |
| R03 | `app/functions/**` | 5 | Middleware coverage, JWT signature/issuer/audience/time/actor checks, origin and method policy, request/response bounds, Supabase destination and errors, response headers | `reviewed-remediated`; deployed bindings and Access policy are `deferred-external` |
| R04 | `app/data/*.json` plus `app/public/data/**/*.json` | 15 | UTF-8 JSON parsing, credential-like key/value and URL scan, provenance/quality fields, projection contract mapping | `not-applicable-executable`; these are legacy/public seeds and are excluded from the public retirement artifact |
| R05 | `app/public/*.svg` | 2 | External URL/import/script/reference scan and static-content inspection | `not-applicable-executable`; no remote load or active script found |
| R06 | `app/scripts/*` | 43 | Collector origin/redirect/body/timeout controls, scope and source gates, secret redaction, filesystem destinations, process execution, projection/manifest/freshness validation, retired publishers | `reviewed-remediated` with residuals `RR-01` and `RR-03` in the boundary review |
| R07 | `app/src/**/*.{js,jsx}` | 71 | Browser network destinations, unsafe DOM/code-evaluation sinks, route/build gating, local storage, private-field projection/display flow | `reviewed-no-new-finding`; browser fetches are same-origin application data/API requests |
| R08 | `app/src/**/*.css` | 21 | External `url()`/`@import`, executable-content, and remote-font/resource scan | `not-applicable-executable`; imports are repository-local |
| R09 | `supabase/migrations/*.sql` | 10 | RLS enablement, grants/revokes, browser-role denial, service-role scope, trigger/function privileges, owner source migration postcondition | `reviewed-remediated`; application and live grants are `deferred-external` |

The batch partition was checked programmatically: `R01` through `R09` cover
184 unique runtime rows, with zero missing paths and zero duplicate paths.

## Test worklist

| Receipt | Exact batch membership | Count | Review performed | Disposition |
| --- | --- | ---: | --- | --- |
| T01 | `app/test/*.test.mjs` | 29 | Mapped to auth, build, workflow, source policy, projection, manifest, transport, manual-event, frontend, and data-contract controls | `reviewed`; focused boundary suites run with `--test-isolation=none` |
| T02 | `app/test/test_*.py` | 2 | Mapped to explicit data-use scope selection plus Python destination allowlisting, redirect denial, stream bounds, total timeout, and traceback credential suppression | `reviewed`; Python unit suite passed locally |

Tests are proof for specific invariants, not proof of remote deployment state.
The default Node test runner could not create child processes in this sandbox
(`spawn EPERM`), so the suite was run with `--test-isolation=none`. One
behavior test invokes `child_process.spawn` itself and remained
workstation-blocked; the other 28 Node test files passed.

## Documentation/policy worklist

| Receipt | Exact batch membership | Count | Review performed | Disposition |
| --- | --- | ---: | --- | --- |
| D01 | All non-`docs/` Markdown: `AGENTS.md`, `app/AGENTS.md`, `app/DATA_SOURCE_REVIEW.md`, `app/design-qa.md`, `app/README.md`, `CYCLELENS_DEVELOPMENT_PLAN.md`, `CYCLELENS_MIGRATION_BASELINE.md`, `PRODUCT_LOG.md`, `README.md`, `THIRD_PARTY_NOTICES.md` | 10 | Security instructions, visibility claims, source/terms decisions, operating/development guidance, dependency notices | `reviewed-remediated`; `app/AGENTS.md` now requires the single-runner owner path and forbids owner data in artifacts/caches/Git/public projections |
| D02 | Existing Markdown below `docs/` except the two documents in D03 | 7 | Data assumptions, deployment handoff, Telegram operations, product holds, dependency review | `reviewed-remediated`; Telegram operations records the removed renderer/package entry, fail-closed direct sender CLI, and prohibition on send mode, secrets, and artifacts |
| D03 | `docs/security/OWNER_PRIVATE_SECURITY_COVERAGE_2026-07-24.md` and `docs/security/OWNER_PRIVATE_BOUNDARY_REVIEW_2026-07-24.md` | 2 | Final inventory reconciliation, claim-to-evidence check, external-gap disclosure | `reviewed`; these are local evidence documents only |

## Local verification command receipts

| Check | Local result |
| --- | --- |
| Inventory and disjoint batch reconciliation using the command above | 234 paths: 184 runtime/source/config/workflow/migration, 31 tests, 19 documents; 184 unique runtime paths covered, zero missing, zero duplicate |
| `node --test --test-isolation=none` across all 29 Node test files | 195 tests discovered; 194 passed; one test could not execute because its own `child_process.spawn` call was denied with `EPERM` by the workstation sandbox |
| Same Node command across the other 28 test files, excluding only `cryptoLiquidityContract.test.mjs` | 177 / 177 passed |
| Eight focused owner-boundary suites: Cloudflare, manifest, manual-event, metric pipeline, owner refresh, product config, secure fetch, and workflow governance | 58 / 58 passed |
| `python -m unittest discover -s app/test -p 'test_*.py'` | 6 / 6 passed |
| `npm run build:public-retired` plus recursive output enumeration | Passed; output contained exactly `404.html`, `index.html`, and `public-retired-release.json` |
| `git diff --check` | Passed |

## High-impact review probes and receipts

The review used the following bounded checks in addition to reading the
security-critical implementations:

- enumerated network, secret, process-execution, unsafe DOM/evaluation, and
  environment-driven destination sinks across runtime code;
- checked every workflow `uses:` reference, trigger, permission, secret
  mapping, cache/artifact command, and public deployment sink;
- checked all collector/provider destinations against explicit reviewed HTTPS
  origins and rejected legacy TradingView, AKShare, yfinance/Yahoo, shell HTTP,
  and browser-session paths;
- parsed all 15 in-scope checked-in JSON datasets with Node using UTF-8;
- found no credential-like key/value or credential-bearing URL in those 15
  in-scope JSON datasets;
- found no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, or
  `new Function` sink in application source/functions/scripts;
- found no remote CSS import/resource URL and no active external SVG resource;
- verified operator-facing collection commands select owner-private scope
  explicitly, the local macro admin requires approval and rejects non-loopback
  binding, and no such helper is started by the deployment workflow;
- verified the Telegram renderer/package entry is absent, its workflow is an
  inert retirement stub, and direct sender CLI execution fails closed;
- inspected all ten migrations for RLS and privilege changes; and
- reconciled each confirmed initial finding to a remediation and focused test
  in the owner-private boundary review.

## Formal scan disclosure

Codex Security scan
`230acfe3-d8e3-4293-b767-de386e826314` did **not** complete. The scan
workspace supplied a `scanDir` that was not reachable from the shell, and the
required escalation could not be obtained because the approval service failed
with an internal model error. The scan was later canceled externally.

This ledger therefore documents the local/manual fallback review. It must not
be represented as a completed MCP scan. No canonical scan JSON and no
`report.md` were created by this work; finalizer ownership remains with the
main thread.

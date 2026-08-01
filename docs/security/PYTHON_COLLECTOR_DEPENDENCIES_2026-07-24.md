# Python collector dependency review — 2026-07-24

## Decision

The owner collector runtime is locked to nine exact packages for CPython 3.12 on
Linux x86-64. CI installs only prebuilt wheels with both `--require-hashes` and
`--only-binary=:all:`. It also disables the package cache and forces a reinstall
so a same-version package preloaded on the runner cannot bypass artifact hash
verification. Source distributions, optional extras, dependency upgrades, and
undeclared transitives fail closed.

The closure is:

| Package | Version | Relationship | License | Admitted wheel SHA256 |
| --- | --- | --- | --- | --- |
| pandas | 3.0.3 | direct | BSD-3-Clause | `6dc0b3fd2169c9157deed50b4d519553a3655c8c6a96027136d654592be973a9` |
| numpy | 2.5.1 | pandas | BSD-3-Clause | `59fda5e192b570217ec2580c96f00e9a7e12ef6866a900eb089b62c1a32545ca` |
| python-dateutil | 2.9.0.post0 | pandas | BSD-3-Clause OR Apache-2.0 | `a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427` |
| six | 1.17.0 | python-dateutil | MIT | `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274` |
| requests | 2.33.1 | direct | Apache-2.0 | `4e6d1ef462f3626a1f0a0a9c42dd93c63bad33f9f1c1937509b8c5c8718ab56a` |
| charset-normalizer | 3.4.9 | requests | MIT | `5e226f6218febc71f6c1fc2fafb91c226f75bdc1d8fb12d66823716e891608fd` |
| idna | 3.18 | requests | BSD-3-Clause | `7f952cbe720b688055e3f87de14f5c3e5fdaa8bc3928985c4077ca689de849a2` |
| urllib3 | 2.7.0 | requests | MIT | `9fb4c81ebbb1ce9531cce37674bbc6f1360472bc18ca9a553ede278ef7276897` |
| certifi | 2026.7.22 | requests | MPL-2.0 | `62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775` |

Pandas lists `tzdata` only for Windows/Emscripten, so it is intentionally absent
from this Linux lock. Requests optional extras are also intentionally absent.
All admitted licenses permit this internal use. MPL-2.0 obligations would apply
to modifications or redistribution of certifi files; this project neither
modifies nor redistributes its wheel.

## Artifact and provenance evidence

Hashes, platform tags, publisher attestations, Python requirements, and license
metadata were checked against the official PyPI release pages:

- [pandas 3.0.3](https://pypi.org/project/pandas/3.0.3/)
- [numpy 2.5.1](https://pypi.org/project/numpy/2.5.1/)
- [python-dateutil 2.9.0.post0](https://pypi.org/project/python-dateutil/2.9.0.post0/)
- [six 1.17.0](https://pypi.org/project/six/1.17.0/)
- [requests 2.33.1](https://pypi.org/project/requests/2.33.1/)
- [charset-normalizer 3.4.9](https://pypi.org/project/charset-normalizer/3.4.9/)
- [idna 3.18](https://pypi.org/project/idna/3.18/)
- [urllib3 2.7.0](https://pypi.org/project/urllib3/2.7.0/)
- [certifi 2026.7.22](https://pypi.org/project/certifi/2026.7.22/)

The two compiled packages use wheels compatible with the current
`ubuntu-latest` glibc baseline: pandas declares manylinux 2.24/2.28 and NumPy
declares manylinux 2.27/2.28. Charset Normalizer's admitted optimized wheel
declares manylinux 2.17/2.28. The remaining wheels are platform-independent.

## Vulnerability review

The version-specific PyPI JSON vulnerability records and OSV/PyPA advisory
records were checked on 2026-07-24. No advisory found in that review identifies
an admitted version as affected.

Two recent boundary cases were checked explicitly:

- Requests `.netrc` credential disclosure
  [PYSEC-2026-1872](https://osv.dev/vulnerability/PYSEC-2026-1872) affects
  versions before 2.32.4; the lock uses 2.33.1.
- urllib3 decompression resource exhaustion
  [PYSEC-2026-142](https://osv.dev/vulnerability/PYSEC-2026-142) affects
  2.6.0 through 2.6.2 and is fixed in 2.7.0; the lock uses 2.7.0.

This is a point-in-time review, not a claim that future advisories cannot affect
the lock. Any version or hash change requires repeating the metadata, license,
and advisory review before merge.

## Verification boundary

Repository tests parse every non-comment requirement record, require an exact
version and at least one 64-character SHA256, assert the complete nine-package
closure, and assert that CI uses hash verification, binary-only installation,
no package cache, and forced replacement of any preinstalled copies.

The local sandbox blocks package-index access and its escalation reviewer failed
before allowing an official PyPI download. Consequently, a real CPython
3.12/Linux `pip install` could not be executed in this workstation session.
The owner workflow remains the final clean-run installation check: pip must
resolve the listed dependency metadata, match the admitted wheel hashes, and
then pass `pip check` before any collector receives provider credentials.

# Telegram morning brief — retired

The Telegram delivery path is retired for the owner-only product boundary.

- Do not enable its schedule, `send` mode, Bot API credentials, preview artifacts, or receipt artifacts.
- Do not route owner datasets or derived owner metrics through Telegram.
- `.github/workflows/telegram-morning-brief.yml` remains only as a fail-closed retirement stub.
- `app/scripts/send-telegram-morning-brief.mjs` retains only its injected transport function for deterministic contract tests; direct CLI invocation fails closed. The former rendering CLI was removed.

The supported release path is the single-run owner workflow in
`.github/workflows/_owner-release.yml`: collect, validate, build, and deploy
directly to the Cloudflare Access-protected owner host without intermediate
data artifacts.

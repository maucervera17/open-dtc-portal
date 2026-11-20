# Contributing

Thanks for helping. Keep changes small and focused.

## Setup

```sh
npm install
npm test
```

Node 22 is required. Tests use in-memory stores and fictional data, so they run offline.

## Ground rules

- **Tests stay green.** Add or update a test next to any behaviour change.
- **UI copy stays Spanish** (es-MX). Code, comments, docs and commit messages are English.
- **No secrets, no real data.** Never commit tokens, `.env*` files, real ad copy, account ids or customer emails. Use `example.com` and fictional names in fixtures.
- **Read-only against Meta.** The Meta and MCP integrations must not write to ad accounts.
- **Fail closed.** Unknown config values should disable a feature, not guess.

## Pull requests

1. Branch from `main`, use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...).
2. Describe what changed and why; mention any new environment variable and add it to `env.example` and the README table.
3. Run `npm test` before opening the PR.

## Reporting security issues

Please do not open a public issue for vulnerabilities. Contact the maintainer privately through GitHub.

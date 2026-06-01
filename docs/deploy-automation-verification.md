# Deploy automation verification

This runbook verifies that GitHub Actions is the production deploy path for EzoHata Ledger.

## Current deployment model

- Vercel Git Integration is not the source of truth for production deploys.
- `.github/workflows/deploy-production.yml` is the production deploy automation path.
- The workflow supports both `push` to `main` and manual `workflow_dispatch`.
- The workflow prepares `.vercel/project.json` from GitHub Actions secrets without printing values.
- Release guard, tests, build, Vercel build/deploy, and production SHA verification must pass before a deploy is considered done.

## Required GitHub Actions repository secrets

Repository:

```text
andylitvinov-design/finance
```

GitHub path:

```text
Settings -> Secrets and variables -> Actions -> Repository secrets
```

Required secret names:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

These are deploy automation credentials. They are not app runtime/provider environment variables.

Do not store secret values in this file or anywhere in the repository.

## Source of truth for values

Use Local Secret Vault / macOS Keychain entries:

```text
EzoHata Ledger / Vercel - VERCEL_TOKEN
EzoHata Ledger / Vercel - VERCEL_ORG_ID
EzoHata Ledger / Vercel - VERCEL_PROJECT_ID
```

Only copy values from the vault into GitHub Actions repository secrets. Do not print values in logs, PRs, comments, docs, or chat.

## Push-to-main verification

Expected behavior after a push or merge to `main`:

1. A new commit appears on `main`.
2. `Deploy Production Fallback` starts automatically.
3. The workflow checks out the pushed SHA.
4. The workflow verifies Vercel deploy credentials.
5. The workflow prepares `.vercel/project.json` from `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
6. `bash scripts/release-guard.sh` passes.
7. `npm test` passes.
8. `npm run build` passes.
9. Vercel production environment is pulled.
10. Vercel production build/deploy completes.
11. `/api/status` responds.
12. `npm run verify:production -- <pushed-main-sha>` passes.

## Manual fallback deploy

Use manual dispatch when production is stale and a push-triggered workflow did not run or did not finish.

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected-main-sha> \
  -f reason="fallback deploy after stale production"
```

Then verify:

```bash
npm run verify:production -- <expected-main-sha>
```

## Root-cause checklist

When production is stale, prove the failing layer before patching:

1. Check current `main` SHA.
2. Check live `/api/status` SHA.
3. If live SHA differs from `main`, inspect `Deploy Production Fallback` workflow runs.
4. If the workflow did not run, check push trigger and Actions settings.
5. If it failed at credentials, check only GitHub Actions repository secrets first.
6. If it failed before release guard, check `.vercel/project.json` preparation.
7. If it failed after Vercel deploy, inspect status/verify-production output.
8. Do not patch UI, balance, provider import, analytics, or runtime provider env for deploy automation failures.

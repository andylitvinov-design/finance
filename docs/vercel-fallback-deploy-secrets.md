# Vercel fallback deploy secrets

This document covers the GitHub Actions credentials used by
`.github/workflows/deploy-production.yml`.

## Scope

These secrets are GitHub Actions deploy credentials. They are not app
runtime/provider environment variables.

Do not store secret values in this repository, docs, issues, pull requests,
logs, or chat. Use the private wallet as the source of truth and paste values
only into GitHub repository secrets.

## Required repository secrets

Configure these in the `andylitvinov-design/finance` repository:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

GitHub path:

```text
Repository -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

## Why this exists

The fallback workflow runs Vercel CLI from GitHub Actions when production is
stale after a merge. It needs a Vercel token, org id, and project id to run the
production pull, build, and prebuilt deploy steps.

If the secrets are missing, the workflow must stop before deploying. Do not
repair this by changing app runtime/provider environment variables.

## Verification after adding secrets

First verify secret names only:

```bash
gh secret list --repo andylitvinov-design/finance --app actions --json name,updatedAt
```

Then run fallback deploy only for a known, already-merged commit:

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

After any fallback deploy, verify production serves the same commit:

```bash
npm run verify:production -- <expected_commit_sha>
```

Expected result: `/api/status` reports the expected SHA and the workflow reaches
the production verification step.

## Root-cause checklist

When fallback deploy fails, prove the failing layer before patching:

1. Confirm the workflow checked out the expected SHA.
2. Confirm the failing step.
3. If it fails at the Vercel credentials gate, check GitHub Actions repository
   secrets first.
4. Do not change runtime/provider env variables for this failure.
5. Do not patch balance, provider import, UI, analytics, or finance semantics
   for this failure.
6. Retry fallback deploy only after the required GitHub Actions secrets exist.

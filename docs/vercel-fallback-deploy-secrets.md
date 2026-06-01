# Vercel fallback deploy secrets

This document covers the GitHub Actions credentials used by `.github/workflows/deploy-production.yml`.

## Scope

These secrets are **GitHub Actions deploy credentials**. They are not app runtime/provider environment variables.

Do not store secret values in this repository, docs, issues, pull requests, logs, or chat. Use the private wallet as the source of truth and paste the values only into GitHub repository secrets.

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

## Source of truth

Use the private wallet for the actual values. This repo only documents the required secret names and verification steps.

## Why this exists

The fallback workflow runs Vercel CLI from GitHub Actions when production is stale after a merge. It needs a Vercel token, org id, and project id to run:

```bash
npx vercel@latest pull --yes --environment=production --token "$VERCEL_TOKEN"
npx vercel@latest build --prod --token "$VERCEL_TOKEN"
npx vercel@latest deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN"
```

If the secrets are missing, the workflow intentionally stops before deploy.

## Verification after adding secrets

Run fallback deploy for the expected commit:

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

For the PR #514 stale-production case:

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=79cfd627937c30574faad81efc1b4a6f5760abf1 \
  -f reason="fallback deploy after PR 514 merge and stale production"
```

Then verify production serves the same commit:

```bash
npm run verify:production -- 79cfd627937c30574faad81efc1b4a6f5760abf1
```

Expected result: `/api/status` reports the expected SHA and the workflow reaches `Verify production serves this commit`.

## Root-cause checklist

When this fails again, prove the failing layer before patching:

1. Confirm the workflow checked out the expected SHA.
2. Confirm the failing step.
3. If it fails at `Verify Vercel fallback credentials`, check GitHub Actions repository secrets first.
4. Do not change runtime/provider env variables for this failure.
5. Do not patch balance, provider import, UI, or analytics code for this failure.
6. Retry fallback deploy only after the required GitHub Actions secrets exist.

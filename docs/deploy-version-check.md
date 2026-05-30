# Deploy Version Check

This document tells agents how to check the current live deployment version without asking the user.

## Project

```text
Repo: andylitvinov-design/finance
Platform: Vercel
Production URL: https://ezohata-incoming-ledger.vercel.app/
Status URL: https://ezohata-incoming-ledger.vercel.app/api/status
```

## Rule

Agents must check the current live version themselves. Do not ask Andrey to open the site, inspect the deployed version, or run local terminal deploy/check commands when machine-readable checks are available.

## Primary check

Use the status endpoint:

```text
GET https://ezohata-incoming-ledger.vercel.app/api/status
```

The agent must inspect and report, when present:

```text
ok/status
projectName
repo/project slug
commitSha
commitRef
build metadata
deployment source
```

## Expected SHA comparison

Before or after deploy, determine the expected commit SHA from GitHub `main` or the task branch/merge commit.

Then compare:

```text
expected_sha == live commitSha from /api/status
```

If they match, production is current.

If live commitSha is older or different, classify as:

```text
deploy/source-of-truth mismatch
```

and use deploy fallback if the intended commit is already committed and pushed/merged.

## CI/local verification command

If shell/CI is available:

```bash
npm run verify:production -- <expected_commit_sha>
```

Agents should run this themselves when possible. If not possible, explain the blocker and use `/api/status` directly.

## If /api/status fails

Report:

```text
HTTP status:
content-type:
body excerpt:
classification:
```

Do not ask the user to check manually.

## Final report block

Every production/deploy-related report must include:

```text
Live version check:
- Production URL: https://ezohata-incoming-ledger.vercel.app/
- Status URL: https://ezohata-incoming-ledger.vercel.app/api/status
- Expected SHA:
- Live SHA/build marker:
- Match: yes/no/unknown
- Evidence source: /api/status or npm run verify:production
- If unknown, why:
```

## Hard rules

```text
Never ask the user to check the current live version if /api/status is available.
Never claim production is current without checking /api/status or verify:production.
Never claim commit-level verification when only URL availability was checked.
Always distinguish URL responds vs commit SHA matches.
```

Cross-project source standard:

```text
andylitvinov-design/active-projects-ops/docs/deploy-version-check-protocol.md
```

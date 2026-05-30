# Deploy Fallback

This project uses GitHub Actions as a fallback production deploy path for Vercel.

## Why

If Vercel auto-deploy does not trigger or production remains stale after merge/push, agents must use this workflow before asking the user to run any local terminal deploy.

Production URL:

```text
https://ezohata-incoming-ledger.vercel.app/
```

Status URL:

```text
https://ezohata-incoming-ledger.vercel.app/api/status
```

Workflow:

```text
.github/workflows/deploy-production.yml
```

## When to use

Use fallback deploy when:

```text
1. The intended commit is already committed and pushed.
2. The intended production ref is known, normally main.
3. Production is stale after push/merge.
4. /api/status shows an old commitSha or wrong commitRef.
5. Vercel auto-deploy did not start, failed, or deployed the wrong commit.
6. The user says live does not show the completed changes.
```

## When not to use

Do not use fallback deploy when:

```text
1. Changes are uncommitted.
2. Changes are only local and not pushed.
3. The target ref/commit is unknown.
4. Tests, release guard, or build fail.
5. Production already serves the expected commit.
6. There is a risk of deploying an old ref over a newer production build.
```

## Required GitHub Secrets

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

These secrets must exist in the GitHub repository settings. Do not commit secrets to the repository and do not paste them into chat.

## Standard command

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

Then watch the run:

```bash
gh run list --workflow deploy-production.yml --limit 5
gh run watch <run-id>
```

## Agent protocol

Before fallback deploy:

```text
1. Identify repo.
2. Identify target ref, normally main.
3. Identify expected commit SHA.
4. Confirm changes are committed and pushed.
5. Check production URL and /api/status.
6. If production is stale, trigger deploy-production.yml.
```

After fallback deploy:

```text
1. Re-check production URL.
2. Re-check /api/status.
3. Confirm live commit/build matches expected commit if status metadata supports it.
4. Report workflow result and live verification.
```

## Hard rules

```text
commit / push / merge first
fallback deploy second
production verification third
```

Never ask the user to run `vercel --prod` locally until this fallback workflow has been attempted and diagnosed.

Never run fallback deploy until the target commit is committed, pushed and identified.

Never claim production is updated without checking production after deploy.

## Minimal final report

```text
Repo:
Target ref:
Expected SHA:
Workflow:
Run status:
Production URL:
Status URL:
Live status:
Live commit/build:
Remaining issue:
```

## Source standard

Cross-project standard lives in:

```text
andylitvinov-design/active-projects-ops
```

Relevant docs:

```text
docs/github-actions-vercel-deploy-fallback-plan.md
docs/deploy-fallback-agent-autodeploy-protocol.md
docs/deploy-fallback-branch-propagation-policy.md
```

# /delivery Managed Agent Upgrade Plan

Status: documented future plan (not yet implemented)
Repository: `andylitvinov-design/finance`
Parent: `docs/delivery-loop-completion-program.md`

---

## Current State

Finance `/delivery` already has local Codex-side automation installed on this
machine:

- `codex-delivery-loop` - scheduled local cron automation.
- `codex-delivery-loop-now` - immediate local trigger using the same prompt.

Those automations reduce the need to start the loop manually, but they still
depend on the local Mac, local repo/worktree state, local disk/CLI health, and
locally available credentials. They are not a managed, remote agent deployment.

This document remains relevant only as a future plan for moving the same
finance-safe `/delivery` protocol into a managed environment. It must not be
read as replacing the installed local Codex automations or changing the
repo-local `/delivery` command contract.

---

## Purpose

Local Codex automation can still be blocked by:

- local machine availability, disk, memory, network, or app state;
- local repo/worktree drift;
- local command discovery issues;
- local credentials and CLI tools;
- stale or incomplete automation memory.

Managed Agent deployment can eventually provide:

- new session per run with less stale local context;
- env vars through a managed vault / network boundary;
- GitHub and Vercel access via environment variables;
- reduced dependency on the local Mac;
- scheduled watchdog monitoring.

---

## Proposed Managed Agents

### 1. `delivery-on-demand`

Purpose: run `/delivery` for a specific finance task without requiring the
local Codex or Claude Code app to be running.

Start message:

```txt
Follow docs/delivery-loop-program.md, docs/delivery-loop-technical-details.md,
docs/delivery-loop-source-patterns-and-live-proof.md, and AGENTS.md.
Run the /delivery protocol for the provided task in andylitvinov-design/finance.
Finance safety rules apply: no ledger/balance/fee semantic changes without proof,
no env/secrets/billing/production data without explicit approval.
Finish only with STATUS: SUCCESS or STATUS: BLOCKED.
SUCCESS requires live proof on https://ezohata-incoming-ledger.vercel.app.
```

### 2. `delivery-watchdog`

Purpose: scheduled check for stuck PRs, failed CI, failed Vercel deployments,
or pending live verification.

Suggested schedule: every 1-2 hours during active development.

Start message:

```txt
Check open delivery PRs and recent Vercel deployments for andylitvinov-design/finance.
If a PR, deploy, or live verification is stuck, fix if safe or return STATUS: BLOCKED
with evidence and required user action.
Finance safety rules apply: do not merge PRs that touch ledger/balance/fee semantics
without confirmed regression test coverage and explicit owner approval.
```

### 3. `production-health-check`

Purpose: scheduled production health and critical flow verification.

Suggested schedule: morning and evening.

Start message:

```txt
Check production health for finance:
- https://ezohata-incoming-ledger.vercel.app - primary live URL
- https://ezohata-incoming-ledger.vercel.app/api/status - status endpoint
Verify HTTP 200 and expected response. Do not mutate production data or balances.
Report STATUS: SUCCESS or STATUS: BLOCKED.
```

---

## Required Environment Variables

Names only. Never commit values.

```txt
GITHUB_TOKEN          - GitHub API access for PR/checks/merge
VERCEL_TOKEN          - Vercel API access for deployment status
VERCEL_ORG_ID         - Vercel org (andylitvinov-design)
VERCEL_PROJECT_ID     - Vercel project ID for finance/ezohata
LIVE_URL              - https://ezohata-incoming-ledger.vercel.app
STATUS_URL            - https://ezohata-incoming-ledger.vercel.app/api/status
```

Optional:

```txt
SLACK_WEBHOOK_URL     - delivery status notifications
ANTHROPIC_API_KEY     - for standalone agent runs outside Claude Code
```

---

## Finance Safety Rules for Managed Agents

- Never change ledger amounts, balance calculations, gross/net/fee semantics without explicit approval.
- Never modify env vars, secrets, billing, or provider credentials.
- Never run destructive data operations, migrations, or backfills.
- Always run `bash scripts/release-guard.sh` before merge when the agent changes code, config, tests, or executable scripts.
- For docs-only changes, verify the PR file list is docs-only and run the narrowest available docs/VCS checks instead of broad ledger checks.
- Prove failing layer before patching production.
- Managed agent must restrict API calls to expected GitHub/Vercel/finance domains.

---

## Security Rules

- Secrets must be stored in the managed agent environment/vault, not in the repo.
- Agent may name missing env vars but must never print values.
- Agent must not write env vars, secrets, or billing settings without explicit user approval.

---

## Relationship to Local Codex Automations

- Local Codex automations are the current installed runner.
- Managed agents are a future remote runner for the same `/delivery` protocol.
- Both must preserve finance safety, source-of-truth checks, release guardrails, and final live verification.
- Neither runner may change ledger, provider, env, secret, billing, or production data semantics without the explicit approvals already required by `AGENTS.md`.

---

## Implementation Status

- [x] Local Codex scheduled automation installed (`codex-delivery-loop`).
- [x] Local Codex immediate automation installed (`codex-delivery-loop-now`).
- [ ] Managed agent environment provisioned.
- [ ] `GITHUB_TOKEN` set in agent vault.
- [ ] `VERCEL_TOKEN` set in agent vault.
- [ ] `delivery-on-demand` agent created and tested.
- [ ] `delivery-watchdog` agent created and scheduled.
- [ ] `production-health-check` agent created and scheduled.

---

## One-Line Rule

```txt
Managed agents do not change the /delivery protocol or finance safety rules.
They run the same loop in a managed environment when local Codex automation is not enough.
```

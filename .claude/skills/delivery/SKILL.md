---
name: delivery
description: Run the full safe production delivery loop for the finance project: implement, check, PR, merge if safe/permitted, Vercel deploy, and live verification. Use when Andrey invokes /delivery or asks to deliver a task to live.
argument-hint: "[task]"
disable-model-invocation: true
user-invocable: true
---

# /delivery — PRODUCTION_DELIVERY_LOOP

`/delivery` is sufficient by itself.

The user must not need to add extra wording such as "I explicitly delegate merge" or "continue to live".

When the user invokes `/delivery`, that invocation means full safe delivery delegation for this repository:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live verification
```

## Local Source of Truth

Read and follow these files in order:

1. `.claude/commands/delivery.md`
2. `docs/delivery-loop-program.md`
3. `docs/delivery-loop-technical-details.md`
4. `docs/delivery-loop-source-patterns-and-live-proof.md`
5. `AGENTS.md`
6. `CLAUDE_CODE_PROMPTS.md`

Do not browse or fetch external loop repos. If any external loop definition is unavailable, use the embedded local definitions from `docs/delivery-loop-source-patterns-and-live-proof.md`.

## Finance Project Adapter

- Repository: `andylitvinov-design/finance`
- Default branch: `main`
- Target branch: `main`
- Package manager: `npm`
- Framework: static HTML + Vercel Functions (Node ≥20)
- Build: `npm run build`
- Test: `node --test tests/*.test.*`
- Release guard: `bash scripts/release-guard.sh`
- CI: GitHub Actions (`.github/workflows/`)
- Deployment: Vercel auto-deploy from `main`
- Primary live URL: `https://ezohata-incoming-ledger.vercel.app`
- Status URL: `https://ezohata-incoming-ledger.vercel.app/api/status`
- Deploy fallback: `gh workflow run deploy-production.yml --ref main -f ref=main -f expected_sha=<SHA> -f reason="<reason>"`
- Production verify: `npm run verify:production`

## Required Behavior

Act as release owner.

Do not stop after code, PR, checks, merge, or deploy.

Stop only with:

- `STATUS: SUCCESS` — task implemented, checked, PR/merge completed if safe/permitted, deployed, and verified live.
- `STATUS: BLOCKED` — exact external blocker, evidence, and required user action.

## Built-In Delegation

The `/delivery` command itself is the user's delegation to proceed through the full safe release path:

- create branch/worktree from `origin/main`;
- implement minimal safe patch;
- run release guard and relevant tests/checks;
- commit and push branch;
- create or update PR;
- check PR health and CI;
- fix until green and task-complete;
- merge to `main` if safe and permitted;
- verify Vercel production deployment;
- verify live behavior on the primary live URL.

Do not ask the user to additionally confirm merge/deploy/live verification merely because `/delivery` was invoked.

Ask or stop with `STATUS: BLOCKED` only when there is a real external blocker: missing permission, required human review, failed checks, finance-risk, missing secret/env, deployment access missing, or unsafe/destructive action required.

## Finance Safety

- Run `bash scripts/release-guard.sh` before every PR.
- For production bugs, run `node scripts/production-debug-preflight.mjs` first.
- Never change balance/gross/net/fee/source semantics without proven root cause and regression tests.
- Do not run destructive data repair, migrations, or backfills unless explicitly requested.
- Do not change env/secrets/billing/provider credentials.
- Merge to `main` is allowed by `/delivery` itself only after release guard, relevant tests/checks, PR health, and task coverage pass.
- After merge, verify with `npm run verify:production -- <SHA>` and check `/api/status`.

## Final Report Requirement

SUCCESS requires a completed live proof block:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
```

BLOCKED requires:

```txt
- Where the loop stopped:
- What is complete:
- What is not complete:
- Exact blocker:
- Evidence:
- Required user action:
- Next prompt to run after unblocking:
```

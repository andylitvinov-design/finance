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
implement -> checks -> PR -> PR health -> merge if safe/permitted -> deploy -> live verification
```

## Local Source of Truth

Read and follow these files in order:

1. `.claude/commands/delivery.md`
2. `docs/delivery-loop-program.md`
3. `docs/delivery-loop-technical-details.md`
4. `docs/delivery-loop-source-patterns-and-live-proof.md`
5. `AGENTS.md`
6. `CLAUDE_CODE_PROMPTS.md`

Do not browse or fetch external loop repos. If a local doc is missing, report `needs verification` and do not invent replacement rules.

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

## Execution Order

Run the embedded loops in this order:

1. Local Source-of-Truth Read
2. Project Adapter Extraction
3. Acceptance Criteria Extraction
4. Task Coverage Audit — initial
5. Implementation
6. Build Until Green
7. Local Checks Until Clean
8. Spiral Validator-Critic Loop
9. Ship PR Until Green
10. CI Failure Watcher (if CI fails)
11. PR Babysitter
12. Task Coverage Audit — pre-merge
13. Merge Until Confirmed
14. Deploy Verification Loop
15. Fix Deploy (if deployment/live fails)
16. Live Verification Loop
17. Task Coverage Audit — live
18. Final Evidence Report

## Final Result Verification Gate

Implementation is not completion. Verification against the original request is
completion.

Before any completion claim or `STATUS: SUCCESS`:

1. Reread the original user task.
2. Extract the Original Request Contract:
   - explicit requirements;
   - edge cases;
   - finance invariants and data-safety constraints;
   - exclusions and do-not-touch rules;
   - required live/API/sheet proof.
3. Compare the contract with the final diff and live/API evidence.
4. Verify every requirement in this table:

| Requirement | Status | Evidence | Verification method |
|---|---|---|---|

Allowed statuses: `PASS`, `PARTIAL`, `FAIL`, `NOT VERIFIED`.

Only `PASS` allows completion. If any required item is `PARTIAL`, `FAIL`, or
`NOT VERIFIED`, do not say `done`, `fixed`, `implemented`, `ready`, or
`ready to merge`. Say `Implemented but not verified.` or
`Cannot verify because ...`.

If the gate fails, repair and rerun it. Stop after 2 failed gate repair attempts
and report what still fails, why it was not fixed, the next file/function to
inspect, and any required user action.

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

## PR Checkpoint And Merge Policy

PR creation is an intermediate checkpoint, not the final result.

After PR creation, `/delivery` continues by default to PR health, the Spiral Validator-Critic review, merge, deploy, and live verification when the project adapter requires those steps.

Merge happens by default when all of these allow it:

- local checks and required CI pass;
- the PR is mergeable;
- branch policy allows merge;
- the Spiral Validator-Critic or final review verdict is `READY_FOR_MERGE` or `READY_WITH_NOTES`;
- project safety rules do not require an owner decision.

Stop before merge only when:

- the user explicitly requested PR-only, review-only, draft-only, or no-deploy mode;
- checks, CI, mergeability, or branch protection prevent merge;
- required human review is missing;
- project-specific safety rules require an owner decision.

Merge alone is not `STATUS: SUCCESS`; deployment and live proof still follow per the project adapter.

Ask or stop with `STATUS: BLOCKED` only when there is a real external blocker: missing permission, required human review, failed checks, finance-risk, missing secret/env, deployment access missing, or unsafe/destructive action required.

## Spiral Validator-Critic Loop

The Spiral Validator-Critic Loop is an improvement loop, not a hard blocker.

Run it after implementation and local checks, before merge readiness is claimed:

```txt
implement -> critic review -> concrete improvement plan -> patch next loop -> critic review again
```

The critic must validate the Original Request Contract requirement by requirement and output concrete next actions. It may run up to 3 loops.

Allowed critic verdicts:

- `READY_FOR_MERGE` — all critic requirements are `PASS`.
- `READY_WITH_NOTES` — merge may proceed with documented, non-blocking notes or externally limited gaps.
- `IMPROVE` — another improvement loop is required.
- `IMPROVE_MINOR` — a small improvement loop is required.
- `SAFETY_STOP` — continuing is unsafe or externally blocked.
- `NEEDS_HUMAN_DECISION` — owner/product judgment is required.

Use `SAFETY_STOP` only for dangerous or externally impossible cases. Missing polish, weak evidence, or partial UI/API quality should normally become `IMPROVE`, `IMPROVE_MINOR`, or `READY_WITH_NOTES` with a concrete next action.

Record machine-readable critic output in optional top-level `.delivery/status.json` field `spiralValidatorCritic`. Do not put it inside `result_verification`.

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

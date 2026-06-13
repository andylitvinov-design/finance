# /delivery

`/delivery` is sufficient by itself.

The user must not need to add extra wording such as "I explicitly delegate merge" or "continue to live".

When the user invokes `/delivery`, that invocation means full safe delivery delegation for this repository:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live verification
```

Follow all source-of-truth docs in order:

1. `docs/delivery-loop-program.md` — full protocol, stop states, final report format
2. `docs/delivery-loop-technical-details.md` — scripts, commands, CI/CD checks, agent decision table
3. `docs/delivery-loop-source-patterns-and-live-proof.md` — embedded loop patterns and live proof contract
4. `AGENTS.md` — project adapter and command registry
5. `CLAUDE_CODE_PROMPTS.md` — finance-safe prompting constraints

These docs are the local source of truth. Do not browse or fetch external loop repos. If any external definition is unavailable, use `docs/delivery-loop-source-patterns-and-live-proof.md`.

Act as release owner for this project.

Input format:

```txt
/delivery [task]
```

or:

```txt
/delivery

Task:
$ARGUMENTS
```

## Finance Project Adapter

- Repository: `andylitvinov-design/finance`
- Default branch: `main`
- Target branch: `main` (all features and fixes)
- Package manager: `npm`
- Framework: static HTML + Vercel Functions (Node ≥20)
- Build: `npm run build`
- Test: `node --test tests/*.test.*`
- Release guard: `bash scripts/release-guard.sh`
- CI: GitHub Actions (`.github/workflows/`)
- Deployment: Vercel (auto-deploy from `main`)
- **Primary live URL: `https://ezohata-incoming-ledger.vercel.app`** ← default SUCCESS target
- Status URL: `https://ezohata-incoming-ledger.vercel.app/api/status`
- Deploy fallback: `gh workflow run deploy-production.yml --ref main -f ref=main -f expected_sha=<SHA> -f reason="<reason>"`
- Production verify: `npm run verify:production`

SUCCESS requires live proof on the primary live URL unless another target is explicitly requested by the user.

## Final Result Verification Gate

Implementation is not completion. Verification against the original request is
completion.

Before saying `STATUS: SUCCESS`, `done`, `fixed`, `implemented`, `ready`, or
`ready to merge`, extract the Original Request Contract from the user's task:

- explicit requirements;
- edge cases;
- finance invariants and data-safety constraints;
- explicit exclusions and do-not-touch rules;
- required live/staging/API/sheet proof.

Verify every contract item:

| Requirement | Status | Evidence | Verification method |
|---|---|---|---|

Allowed statuses: `PASS`, `PARTIAL`, `FAIL`, `NOT VERIFIED`.

Do not use completion language if any required item is `PARTIAL`, `FAIL`, or
`NOT VERIFIED`. Say `Implemented but not verified.` or
`Cannot verify because ...` instead.

After implementation, reread the original task and compare it with the diff:
requirements covered, UI/API/data details covered, no unrelated files changed,
existing finance semantics preserved, regression risks identified, PR mergeable,
and live/API proof complete when applicable.

If the gate fails, repair and rerun it. After 2 failed gate repair attempts,
stop with `STATUS: BLOCKED` and report the remaining gap, why it was not fixed,
the next file/function to inspect, and any required user action.

## Required Final Status

- `STATUS: SUCCESS` — task implemented, PR merged or direct-to-main confirmed, deployed, and verified live.
- `STATUS: BLOCKED` — exact external blocker, evidence, and required user action.

Do not stop after code, PR, checks, merge, or deploy.

## Built-In Delegation

The `/delivery` command itself is the user's delegation to proceed through the full safe release path.

That includes:

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

## Cost-Control Rules

- Treat stable docs (1-5 above) as cached/stable context. Do not duplicate the full protocol in dynamic prompts.
- Put current task / logs / diffs / PR status after stable protocol context.
- Prefer diffs over full files. Do not scan the full repository unless necessary.
- Stop after 3 failed fix attempts on the same issue — return `STATUS: BLOCKED`.
- Never touch env vars, secrets, billing, production database, or auth-sensitive settings without explicit user approval.
- Use cheapest capable model/tooling for routine status checks; use stronger reasoning only for architecture, hard debug, or final delivery-risk review.
- Final report must include COST CONTROL section.

## Finance-Specific Rules

- Run `bash scripts/release-guard.sh` before every PR.
- For production bugs, run `node scripts/production-debug-preflight.mjs` first.
- Never change balance/gross/net/fee/source semantics without proven root cause and regression tests.
- Do not run destructive data repair, migrations, or backfills unless explicitly requested.
- Do not change env/secrets/billing/provider credentials.
- Merge to `main` is allowed by `/delivery` itself only after release guard, relevant tests/checks, PR health, and task coverage pass.
- After merge, verify with `npm run verify:production -- <SHA>` and check `/api/status`.

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

SUCCESS also requires a completed result verification block:

```txt
RESULT VERIFICATION:
| Requirement | Status | Evidence | Verification method |
|---|---|---|---|
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

# /delivery

`/delivery` is sufficient by itself.

The user must not need to add extra wording such as "I explicitly delegate merge" or "continue to live".

When the user invokes `/delivery`, that invocation means full safe delivery delegation for this repository:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> deploy -> live verification
```

## Local Source of Truth

Follow all source-of-truth docs in order:

1. `.claude/commands/delivery.md`
2. `docs/delivery-auth-boundary-standard.md` — auth-gated live verification and `SUCCESS_WITH_AUTH_LIMITATION`
3. `docs/delivery-loop-program.md` — full protocol, stop states, final report format
4. `docs/delivery-loop-technical-details.md` — scripts, commands, CI/CD checks, agent decision table
5. `docs/delivery-loop-source-patterns-and-live-proof.md` — embedded loop patterns and live proof contract
6. `AGENTS.md` — project adapter and command registry
7. `CLAUDE_CODE_PROMPTS.md` — finance-safe prompting constraints

These docs are the local source of truth. Do not browse or fetch external loop repos. If a local doc is missing, report `needs verification` and do not invent replacement rules.

If older delivery docs conflict with `docs/delivery-auth-boundary-standard.md`, the auth-boundary standard wins for auth-gated live verification.

Before implementation, also load central project memory when available:

1. `andylitvinov-design/ai-projects-brain/START-HERE-FOR-AGENTS.md`
2. `andylitvinov-design/ai-projects-brain/systems/delivery-auth-boundary-standard.md`
3. relevant project capsule files for this project.

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

For auth-gated finance/dashboard behavior, authenticated post-login live proof may be replaced by safe public/status/API/login/protected-redirect/local-demo/code proof and final status `SUCCESS_WITH_AUTH_LIMITATION` per `docs/delivery-auth-boundary-standard.md`.

## Verification Environment Mode

Classify final verification as one of:

- `PUBLIC_LIVE` — public unauthenticated live behavior can be checked on the deployed site.
- `PREVIEW_DEPLOYMENT` — preview/staging deployment is the best available target.
- `LOCAL_AUTH_SIMULATION` — private/auth-only behavior must be checked locally with safe dev, fixture, or demo state.
- `AUTH_BOUNDARY` — public/login/deploy/API checks pass, but authenticated post-login production verification is blocked only by expected auth.
- `OWNER_REQUIRED` — no safe local/preview proof can reproduce the requested behavior; owner verification is required.

If a feature is behind Google/Supabase/private cabinet/auth-only state, do not request user login material and do not claim authenticated live proof unless actually verified.

Use local dev/fixture/demo/code proof when live auth is unavailable. If the only missing proof is expected auth, mark authenticated live proof as `SKIPPED_EXPECTED_AUTH_BOUNDARY` and finish with `STATUS: SUCCESS_WITH_AUTH_LIMITATION`, not `STATUS: BLOCKED`.

## Auth-Gated Live Verification Rule

Expected Google OAuth, Supabase auth, private cabinet login, account chooser, captcha, browser-not-secure screen, or owner-only session is not by itself a delivery failure.

Do not:

- request user login material;
- alter auth provider settings or production env configuration;
- bypass the app security model;
- retry the hosted login boundary endlessly;
- mark delivery as `BLOCKED` only because production requires human login.

For auth-gated apps, delivery may finish as:

```txt
STATUS: SUCCESS_WITH_AUTH_LIMITATION
```

when all of the following are true:

- implementation is complete;
- release guard/checks/tests/build pass;
- PR is merged or direct-to-main is confirmed;
- deployment is successful;
- public live/status/API route loads;
- login/auth entry point is visible where applicable;
- protected routes redirect to login/auth instead of crashing;
- post-login live verification is impossible only because of expected auth boundary;
- local dev, fixture, mock, demo, API, or code-level verification covers the requested post-login behavior as much as safely possible;
- finance invariants and data-safety constraints are preserved.

Required wording:

```txt
AUTHENTICATED LIVE PROOF: SKIPPED_EXPECTED_AUTH_BOUNDARY
Reason: production post-login area is protected by Google/Supabase/private auth; automated agent verification must stop at the expected login boundary.
Safe proof completed: release guard/checks, deployment, public/status/API route, login entry/protected redirect where applicable, and local/demo/code verification.
Final status: STATUS: SUCCESS_WITH_AUTH_LIMITATION
```

Use `STATUS: BLOCKED` only for a real app/build/runtime/deployment/security/data/finance blocker, not for expected auth.

## Final Result Verification Gate

Implementation is not completion. Verification against the original request is completion.

Before saying `STATUS: SUCCESS`, `STATUS: SUCCESS_WITH_AUTH_LIMITATION`, `done`, `fixed`, `implemented`, `ready`, or `ready to merge`, extract the Original Request Contract from the user's task:

- explicit requirements;
- edge cases;
- finance invariants and data-safety constraints;
- explicit exclusions and do-not-touch rules;
- required live/staging/API/sheet proof.

Verify every contract item:

| Requirement | Status | Evidence | Verification method |
|---|---|---|---|

Allowed statuses: `PASS`, `PARTIAL`, `FAIL`, `NOT VERIFIED`, `SKIPPED_EXPECTED_AUTH_BOUNDARY`.

Do not use completion language if any required item is `PARTIAL`, `FAIL`, or `NOT VERIFIED`.

`SKIPPED_EXPECTED_AUTH_BOUNDARY` is allowed only for authenticated post-login production proof when the auth-boundary standard is satisfied. It permits `STATUS: SUCCESS_WITH_AUTH_LIMITATION` but not plain `STATUS: SUCCESS`.

After implementation, reread the original task and compare it with the diff: requirements covered, UI/API/data details covered, no unrelated files changed, existing finance semantics preserved, regression risks identified, PR mergeable, and live/API proof complete when applicable.

If the gate fails, repair and rerun it. After 2 failed gate repair attempts, stop with `STATUS: BLOCKED` and report the remaining gap, why it was not fixed, the next file/function to inspect, and any required user action.

## Required Final Status

- `STATUS: SUCCESS` — task implemented, PR merged or direct-to-main confirmed, deployed, and verified live.
- `STATUS: SUCCESS_WITH_AUTH_LIMITATION` — task implemented, PR merged or direct-to-main confirmed, deployed, public/status/API/login/protected-redirect checks passed, and only authenticated production proof is skipped due to expected auth boundary.
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
- verify live behavior on the primary live URL or auth-boundary-safe substitute for auth-gated areas.

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

Merge alone is not final success; deployment and live proof still follow per the project adapter.

Ask or stop with `STATUS: BLOCKED` only when there is a real external blocker: missing permission, required human review, failed checks, finance-risk, missing env/permission, deployment access missing, unsafe/destructive action required, or auth-gated behavior with no safe public/local/demo/code proof.

## Spiral Validator-Critic Loop

The Spiral Validator-Critic Loop is an improvement loop, not a hard blocker.

Run it after implementation and local checks, before merge readiness is claimed:

```txt
implement -> critic review -> concrete improvement plan -> patch next loop -> critic review again
```

The critic must validate the Original Request Contract requirement by requirement and output concrete next actions. It may run up to 3 loops.

Allowed critic verdicts:

- `READY_FOR_MERGE` — all critic requirements are `PASS`.
- `READY_WITH_NOTES` — merge may proceed with documented, non-blocking notes or externally limited gaps, including expected auth-boundary limitations.
- `IMPROVE` — another improvement loop is required.
- `IMPROVE_MINOR` — a small improvement loop is required.
- `SAFETY_STOP` — continuing is unsafe or externally blocked.
- `NEEDS_HUMAN_DECISION` — owner/product judgment is required.

Use `SAFETY_STOP` only for dangerous or externally impossible cases. Missing polish, weak evidence, partial UI/API quality, or expected auth boundary should normally become `IMPROVE`, `IMPROVE_MINOR`, or `READY_WITH_NOTES` with a concrete next action.

Record machine-readable critic output in optional top-level `.delivery/status.json` field `spiralValidatorCritic`. Do not put it inside `result_verification`.

## Cost-Control Rules

- Treat stable docs (1-7 above) as cached/stable context. Do not duplicate the full protocol in dynamic prompts.
- Put current task / logs / diffs / PR status after stable protocol context.
- Prefer diffs over full files. Do not scan the full repository unless necessary.
- Stop after 3 failed fix attempts on the same issue — return `STATUS: BLOCKED`.
- Never touch env vars, billing, production database, auth-sensitive settings, provider settings, or production data repair without explicit user approval.
- Use cheapest capable model/tooling for routine status checks; use stronger reasoning only for architecture, hard debug, or final delivery-risk review.
- Final report must include COST CONTROL section.

## Finance-Specific Rules

- Run `bash scripts/release-guard.sh` before every PR.
- For production bugs, run `node scripts/production-debug-preflight.mjs` first.
- Never change balance/gross/net/fee/source semantics without proven root cause and regression tests.
- Do not run destructive data repair, migrations, or backfills unless explicitly requested.
- Do not change env/billing/provider credentials.
- Merge to `main` is allowed by `/delivery` itself only after release guard, relevant tests/checks, PR health, and task coverage pass.
- After merge, verify with `npm run verify:production -- <SHA>` and check `/api/status`.

SUCCESS or SUCCESS_WITH_AUTH_LIMITATION requires a completed live proof block:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
- Auth boundary: NONE / GOOGLE_OAUTH_EXPECTED / SUPABASE_AUTH_EXPECTED / PRIVATE_CABINET_EXPECTED
- Authenticated live proof: VERIFIED / SKIPPED_EXPECTED_AUTH_BOUNDARY / NOT_APPLICABLE
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

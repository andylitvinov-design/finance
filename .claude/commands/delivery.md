# /delivery

Follow all three source-of-truth docs in order:

1. `docs/delivery-loop-program.md` — full protocol, stop states, final report format
2. `docs/delivery-loop-technical-details.md` — scripts, commands, CI/CD checks, agent decision table
3. `docs/delivery-loop-source-patterns-and-live-proof.md` — embedded loop patterns and live proof contract
4. `AGENTS.md` — project adapter and command registry

These docs are the local source of truth. Do not browse or fetch external loop repos. If any external definition is unavailable, use `docs/delivery-loop-source-patterns-and-live-proof.md`.

Act as release owner for this project.

Input format:

Task:
$ARGUMENTS

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

## Required Final Status

- STATUS: SUCCESS — task implemented, PR merged (or direct-to-main confirmed), deployed, and verified live.
- STATUS: BLOCKED — exact external blocker, evidence, and required user action.

Do not stop after code, PR, checks, merge, or deploy.

## Cost-Control Rules

- Treat stable docs (1-4 above) as cached/stable context. Do not duplicate the full protocol in dynamic prompts.
- Put current task / logs / diffs / PR status after stable protocol context.
- Prefer diffs over full files. Do not scan the full repository unless necessary.
- Stop after 3 failed fix attempts on the same issue — return STATUS: BLOCKED.
- Never touch env vars, secrets, billing, production database, or auth-sensitive settings without explicit user approval.
- Use cheapest capable model/tooling for routine status checks; use stronger reasoning only for architecture, hard debug, or final delivery-risk review.
- Final report must include COST CONTROL section.

## Finance-Specific Rules

- Run `bash scripts/release-guard.sh` before every PR.
- For production bugs, run `node scripts/production-debug-preflight.mjs` first.
- Never change balance/gross/net/fee/source semantics without proven root cause and regression tests.
- Do not merge to `main` without explicit user delegation for this task.
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

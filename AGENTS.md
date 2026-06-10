# Active Incoming Ledger

## Status

- This is the only active EzoHata incoming-ledger implementation.
- The production source of truth is `https://github.com/andylitvinov-design/finance.git`, this repository root, on a branch based on `origin/main`.
- `https://github.com/andylitvinov-design/ezohata-incoming-ledger.git` is not the production source of truth unless an explicit migration is being performed and verified end-to-end.
- Do not use the legacy `reconcile-v2/` folder as a new source of production commits.
- Production URL: `https://ezohata-incoming-ledger.vercel.app/`

## Project Memory

Before production debugging, read the shared project memory:

- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/production-debug-protocol.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/DEBUG_PLAYBOOK.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/CHECKS.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/RISKS.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/DEBUG_LOG.md`

Before creating or optimizing Claude Code prompts for this finance project, read/apply:

- Repo-local: `CLAUDE_CODE_PROMPTS.md`
- Global standard: `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/claude-code-prompt-standard.md`
- Finance-specific standard: `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/CLAUDE_CODE_PROMPTS.md`

After meaningful production work, update the relevant project memory files or explicitly report that a memory update is needed.

## Claude Code Prompt Rule

When Andrey asks to create a Claude Code prompt for finance, use low-token staged prompts:

1. `/clear` for a new task.
2. One task only.
3. Diagnose first, no edits.
4. No broad repo scan.
5. Ask for the 1-3 most relevant files before expanding scope.
6. Minimal patch only after the failing layer/root cause is proven.
7. Tests and production verification are separate prompts when possible.

Never create one giant Claude Code prompt that asks for diagnose + patch + tests + PR + merge + deploy + production verification together.

## Autonomy

Default mode: **Production Debugger Autopilot**.

### No Clarification Bias

Prefer autonomous best-effort execution over asking questions. If the user gives an actionable bug report, screenshot, audit note, or desired UI/business outcome, proceed from the most likely interpretation and document assumptions in the final report instead of pausing for confirmation.

Do not ask clarification questions when a safe next step exists. First inspect repo, live read-only endpoints, recent PRs/commits, and relevant docs; then make the smallest safe patch or produce the most concrete Codex prompt/plan possible.

Use questions only as a last resort when all of these are true:

- the missing detail blocks any safe progress;
- guessing could corrupt money, balances, ledger data, provider credentials, or production source of truth;
- the decision cannot be recovered with a small reversible patch or clear `needs verification` note.

When uncertain, choose the least risky reversible action and label assumptions clearly. Do not stop work merely because multiple implementation paths exist; pick the minimal path that preserves existing finance semantics.

Do not ask the user for confirmation before safe engineering actions:

- inspect repo-local code/docs and project memory;
- check recent PRs/commits and production source-of-truth metadata;
- check live read-only endpoints such as `/api/status`, `/api/audit-snapshot`, and `/api/debug-ui-state`;
- create a branch/worktree from `origin/main`;
- edit/update files for a minimal safe patch;
- add/update regression tests;
- run tests/build/release guard;
- commit, push a working branch, and open/update a PR when repository access allows it.

### Self-Run Checks Before Delegation

Run available verification yourself before delegating checks to Codex. Do not default to prompts like "Codex should run checks" when this session or local environment can run read-only/live checks, repo inspections, tests, build, or release guard.

When you cannot run a check yourself, state the exact blocker, for example: no local checkout, no shell, missing dependency, no browser runner, no write permission, or tool access unavailable. Then provide the smallest concrete fallback.

Codex prompts must ask for implementation work, not only verification. A good Codex prompt should include the intended code/data-report change, target files, failing layer to prove first, regression tests to add or update, commands to run, and live verification. Avoid using Codex as a substitute for work the assistant could already perform directly.

If using Codex after partial assistant work, include what was already checked, what was already changed, what remains unverified, and the exact expected patch or data-repair output. Codex should continue from that state, not restart with generic investigation.

Stop and ask before risky actions:

- changing, exposing, requesting, or storing secrets/env values;
- changing provider credentials, OAuth settings, payment settings, billing, or account access;
- running destructive scripts or production migrations/backfills with `--apply`;
- deleting or rewriting Google Sheets / ledger rows;
- merging to `main` unless merge was explicitly delegated for this task;
- production deploy when deploy target/source of truth is unclear;
- changing balance/gross/net/fee/source semantics without proven root cause and regression tests;
- broad architecture rewrites.

## Production Debug Preflight

For every production UI/runtime/API/provider/balance bug, run source-of-truth preflight before patching formulas or UI logic:

```bash
node scripts/production-debug-preflight.mjs
```

Report:

1. live URL;
2. `/api/status` HTTP status/content-type/body excerpt if failing;
3. production project/service;
4. production repo slug;
5. production commit SHA;
6. production branch/ref;
7. relevant open PRs;
8. classification: `source ok`, `deploy/source-of-truth mismatch`, or `needs verification`.

If production does not contain the intended fix, or production is serving a stale feature branch, do not patch business formulas yet. Resolve deploy/source-of-truth mismatch first.

## Agent Debug Surface

For screenshot/UI aggregate discrepancies, use this read-only evidence chain before patching:

1. `/api/status` — prove deployed commit/source.
2. `/api/audit-snapshot` — prove normalized ledger, balance, provider, exchange, source, and daily-balance state.
3. `/api/debug-ui-state` — prove server-derived UI aggregate inputs and channel breakdowns.
4. Screenshot/user report — use only after the machine-readable evidence above.

`/api/debug-ui-state` is routed through the existing `/api/index` function, so it does not add another Vercel Hobby serverless function. It is observability only and must not become a finance calculation source of truth.

Row-level mode requires `includeRows=1` plus a configured debug token. Never expose the token, secrets/env values, full provider payloads, emails, account numbers, or private comments. See `docs/debugger-access-architecture.md`.

## Root Cause First

For runtime/API/import/balance/analytics/UI bugs, prove the failing layer before patching:

`UI -> API route -> provider/import -> normalization -> ledger save -> balance -> analytics`

For production bugs, also prove `deploy/source-of-truth` before this chain.

For each issue report:

1. failing layer
2. evidence for
3. evidence against
4. confidence: high / medium / low
5. exact file/function/pattern
6. live verification needed

If the root cause is not proven, write `likely bug in [layer], needs verification` and make only the safest useful change.

## Finance Invariants

- Balance is calculated by `amount_net`.
- Rows with valid `amount_net` must not be excluded from balance only because `source=unknown`.
- Unknown source may break analytics quality but should not automatically break balance.
- Do not change balance logic while fixing provider transport unless root cause proves balance logic is wrong.
- PayPal gross must not be treated as net when fee is missing.
- Preserve feeAmount/feeCurrency when present.
- Determine PayPal direction from the original sign before `Math.abs`.
- Provider non-JSON/plain-text/HTML errors must become structured JSON errors, not raw SyntaxError or HTML in UI.

## Finance Reverse-Math Guard

For any screenshot/report where a displayed money value disagrees with a raw source amount, start with one-row arithmetic before broad code inspection.

Required first checks:

1. Pick one concrete row/client/date that contributes to the wrong number.
2. Record raw source amount, source currency, displayed/derived USD amount, and any visible rate.
3. Compute:
   - `implied_rate = raw_local_amount / displayed_usd_amount`
   - `implied_multiplier = displayed_usd_amount / raw_local_amount`
   - `error_ratio = displayed_usd_amount / expected_usd_amount`
4. Check whether the implied rate is realistic before blaming UI or JS aggregation.

Expected local-per-USD sanity ranges:

- UAH: `30..60`
- RUB: `60..150`
- CAD: `1.1..1.6`
- EUR: use USD-per-EUR sanity `0.8..1.3`

If the implied rate is outside the sanity range, prioritize source data, rate cells, sheet formulas, decimal comma/dot, missing digit, and derived USD columns before JS/UI hypotheses.

Known regression pattern:

- Source row: `4557.75 UAH`
- Bad derived value: `1072.4118 USD`
- Reverse math: `4557.75 / 1072.4118 = 4.25`
- Root cause: UAH rate cell `4.25` instead of about `43..44`, before UI/analytics.

For UAH movement rows, add/expect diagnostics such as:

- `UAH_RATE_OUT_OF_RANGE`
- `IMPLIED_RATE_OUT_OF_RANGE`
- `DERIVED_USD_MISMATCH`

A useful row-level proof table must include row number, date, client, channel/payment method, raw amount, rate, derived USD, implied rate, and whether the row is included in the displayed aggregate.

## Movement Table Invariant

For `Движение средства`, the rendered `Итого` row under `BALANCE` must equal the sum of visible numeric `NUMBER` rows for the selected period.

Known regression fixture:

- period: `2026-05-05..2026-05-11`;
- wrong total: `-340.5000`;
- visible rows sum: `218.2244`;
- expected total: `218.2244`.

If this fails, first check production source-of-truth. Then patch the final movement aggregation/render layer.

## Deployment

- Start production-facing work from `origin/main`, run `bash scripts/release-guard.sh`, then push a branch and merge through PR.
- If the current branch is not based on `origin/main`, create a fresh branch/worktree from `origin/main` and port only the needed changes.
- Vercel deploys the root app after `main` is updated. Manual production deploys must be run only from this repository root.
- Never deploy from `data/` or from a stale `reconcile-v2/` checkout.

## GitHub Actions Deploy Fallback

This repo has a production fallback workflow:

```text
.github/workflows/deploy-production.yml
```

Use it when Vercel auto-deploy does not trigger, production remains stale after push/merge, `/api/status` shows an old commit, or the user reports that live does not show completed changes.

Do not ask Andrey to run a local terminal deploy until this fallback path has been attempted and diagnosed.

Before fallback deploy, always prove:

```text
Repo: andylitvinov-design/finance
Target ref: normally main
Expected SHA: known commit SHA
Changes: committed and pushed/merged
Production URL: https://ezohata-incoming-ledger.vercel.app/
Status URL: https://ezohata-incoming-ledger.vercel.app/api/status
```

Default command:

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

Hard order:

```text
commit / push / merge first
fallback deploy second
production verification third
```

Never deploy uncommitted or unpushed changes. Never deploy an unknown ref. Never claim production is updated without checking production after deploy.

After workflow completion, verify:

```bash
npm run verify:production -- <expected_commit_sha>
```

Also check `/api/status` and report the live commit/build metadata when available.

Full local protocol: `docs/deploy-fallback.md`.
Cross-project standard: `andylitvinov-design/active-projects-ops` docs.

## Verification Commands

Run available checks and report exact results:

```bash
node --test tests/*.test.*
node scripts/production-debug-preflight.mjs
bash scripts/release-guard.sh
npm run build
```

If a command is unavailable or not run, say so explicitly.

---

## Agent Command Registry — /delivery

When the user invokes `/delivery`, follow all three source-of-truth docs in order:

1. `docs/delivery-loop-program.md` — full protocol, stop states, final report format
2. `docs/delivery-loop-technical-details.md` — scripts, commands, CI/CD checks, agent decision table
3. `docs/delivery-loop-source-patterns-and-live-proof.md` — embedded loop patterns and live proof contract (mandatory)

Local source of truth (do not fetch external loop repos — use these local docs):
- `docs/delivery-loop-program.md`
- `docs/delivery-loop-technical-details.md`
- `docs/delivery-loop-source-patterns-and-live-proof.md`

If any external loop definition is unavailable, use the embedded local definitions from `docs/delivery-loop-source-patterns-and-live-proof.md`.

Act as a release owner, not only a coding assistant.

Do not stop after code changes, PR creation, green checks, merge, or deployment.

Stop only with:

- `STATUS: SUCCESS` — task implemented, PR/merge completed if required, deployed, and verified on live.
- `STATUS: BLOCKED` — real external blocker with exact evidence and required user action.

`SUCCESS` requires a completed live proof block:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
```

### Finance Project Adapter

- Repository: `andylitvinov-design/finance`
- Default branch: `main`
- Target branch: `main`
- Package manager: `npm`
- Framework: static HTML + Vercel Functions (Node ≥20)
- Build command: `npm run build`
- Test command: `node --test tests/*.test.*`
- Release guard: `bash scripts/release-guard.sh`
- CI provider: GitHub Actions (`.github/workflows/`)
- Deployment provider: Vercel (auto-deploy from `main`)
- **Primary live URL: `https://ezohata-incoming-ledger.vercel.app`** ← default `/delivery` target
- Status URL: `https://ezohata-incoming-ledger.vercel.app/api/status`
- Deploy fallback: `.github/workflows/deploy-production.yml`
- Verify: `npm run verify:production`

**Live target rule:** Unless the user explicitly specifies another target, `/delivery` SUCCESS requires LIVE PROOF on `https://ezohata-incoming-ledger.vercel.app`. STATUS: SUCCESS after checking only a preview/fallback URL is not valid unless the user explicitly selected that target.

**Cost-control rules:**

- `/delivery` includes cost-control by default.
- Do not reread or resend unchanged large context. Place stable project context (protocol docs, AGENTS.md, rules) first; place current task/diffs/logs after.
- Prefer diffs over full files. Read only relevant files first.
- Stop after **3 failed fix attempts** on the same issue — return `STATUS: BLOCKED` with the 3 attempts listed.
- Never touch env vars, secrets, billing, production database, or auth-sensitive settings without explicit user approval. Stop and describe the required action; do not proceed.
- Final report must include a `COST CONTROL` section.

## /pr

Create a clean, mergeable PR for the current branch. Do not merge.

Verify: correct base branch (`main`), no conflicts, build and checks pass, PR description includes task and evidence.

## /fix-deploy

Diagnose and fix a deployment or live mismatch. See `docs/deploy-fallback.md` if present. Use `gh workflow run deploy-production.yml` as fallback.

## /audit

Inspect whether the task, PR, merge, deployment, and live state match the original request. Return `STATUS: SUCCESS` or `STATUS: BLOCKED` with evidence.

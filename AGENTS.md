# Global Autonomous Project Rules

Before working in this repository, read and apply the shared project-brain rules:

- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/autonomous-project-executor.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/agent-rules.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/codex-project-workflow.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/PROJECT.md`

Default mode: work autonomously for safe read-only, docs, diagnosis, planning, branch, patch, test, and PR work. Ask only before risky actions: secrets/env changes, deletion, destructive migrations, merge to `main`, production deploy, financial/account/access changes, irreversible changes, or broad rewrites.

---

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

After meaningful production work, update the relevant project memory files or explicitly report that a memory update is needed.

## Autonomy

Default mode: **Production Debugger Autopilot**.

Do not ask the user for confirmation before safe engineering actions:

- inspect repo-local code/docs and project memory;
- check recent PRs/commits and production source-of-truth metadata;
- check live read-only endpoints such as `/api/status` and `/api/audit-snapshot`;
- create a branch/worktree from `origin/main`;
- edit/update files for a minimal safe patch;
- add/update regression tests;
- run tests/build/release guard;
- commit, push a working branch, and open/update a PR when repository access allows it.

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

## Verification Commands

Run available checks and report exact results:

```bash
node --test tests/*.test.*
node scripts/production-debug-preflight.mjs
bash scripts/release-guard.sh
npm run build
```

If a command is unavailable or not run, say so explicitly.

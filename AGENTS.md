# Active Incoming Ledger

## Status

- This is the only active EzoHata incoming-ledger implementation.
- The production source of truth is `https://github.com/andylitvinov-design/finance.git`, this repository root, on a branch based on `origin/main`.
- `https://github.com/andylitvinov-design/ezohata-incoming-ledger.git` is not the production source of truth unless an explicit migration is being performed and verified end-to-end.
- Do not use the legacy `reconcile-v2/` folder as a new source of production commits.
- Production URL: `https://ezohata-incoming-ledger.vercel.app/`

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

## Root Cause First

For runtime/API/import/balance/analytics/UI bugs, prove the failing layer before patching:

`UI -> API route -> provider/import -> normalization -> ledger save -> balance -> analytics`

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

## Deployment

- Start production-facing work from `origin/main`, run `bash scripts/release-guard.sh`, then push a branch and merge through PR.
- If the current branch is not based on `origin/main`, create a fresh branch/worktree from `origin/main` and port only the needed changes.
- Vercel deploys the root app after `main` is updated. Manual production deploys must be run only from this repository root.
- Never deploy from `data/` or from a stale `reconcile-v2/` checkout.

## Verification Commands

Run available checks and report exact results:

```bash
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build
```

If a command is unavailable or not run, say so explicitly.

# Cursor Composer setup for finance repo

Purpose: use Cursor Composer as a fast, cheaper coding/debugging worker for this finance app while keeping strict finance safety rules.

## Recommended model usage

- Use Composer 2.5 Standard for larger repo scans, cheaper debugging passes, test writing, and routine patches.
- Use Composer 2.5 Fast only when interactive speed matters.
- Use Claude Opus / GPT-level review for high-risk financial semantics, Ledger contract changes, PayPal/Wise net/gross/fee decisions, provider money movement interpretation, and final audit of risky patches.

## First setup on local machine

1. Install Cursor from the official Cursor site.
2. Open this repository folder in Cursor.
3. In Cursor settings, select Composer 2.5 as the default coding/agent model when available.
4. Prefer Standard mode for cost control when doing long scans or background repair work.
5. Confirm Cursor loads project rules from `.cursor/rules/finance-debugging.mdc`.

## Default prompt for Composer/Cursor

```text
You are working in andylitvinov-design/finance.

Follow .cursor/rules/finance-debugging.mdc strictly.

Task:
[PASTE THE SPECIFIC BUG OR FEATURE HERE]

Workflow:
1. Inspect the repo and identify the failing layer before changing code.
2. Provide evidence for and against deploy/source, provider/import, normalization, ledger save, balance/reconciliation, analytics, UI, and data repair layers as relevant.
3. Make the smallest safe patch.
4. Add/update targeted tests.
5. Run the smallest relevant verification first, then release guard/build if appropriate.
6. Do not change secrets/env.
7. Do not edit Google Sheet/Ledger/Остатки/Авто Остатки without a guarded dry-run/apply script.
8. Final report must include: failing layer, root cause, changed files, verification, deploy/live status if checked, data rows changed if any, and remaining risks.
```

## Useful verification commands

```bash
node --test tests/*.test.*
node --check <changed-file.js>
bash scripts/release-guard.sh
npm run build
npm run verify:live
```

## Useful live checks

```bash
curl -sS https://ezohata-incoming-ledger.vercel.app/api/status
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/audit-snapshot?from=2026-05-01&to=2026-05-20'
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/period-balance-reconciliation?from=2026-05-01&to=2026-05-20'
```

## When to escalate to stronger review

Escalate when the task involves:

- changing Ledger Data Contract semantics;
- interpreting PayPal/Wise/Binance/Revolut money movement;
- deciding whether gross can equal net;
- repairing production Google Sheet rows;
- changing reconciliation priority rules;
- changing opening balance logic;
- deploying after high-risk data or balance changes.

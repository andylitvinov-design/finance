# Harness Regression Tests

Use this file only during `/upgrade`, `/learn-pass`, or `/memory-review`.

Each check should be small, replayable, and tied to a known harness weakness.

## R004 — Maintenance-file scope matches canonical router

Scope: `AGENTS.md`, `agent-memory/index.md`  
Status: active  
Last checked: 2026-06-30

Scenario:
- Task invokes `/learn-pass`, `/memory-review`, or `/upgrade`.

Expected:
- `archive.md` is lazy-loaded except conflict resolution or `/memory-review`.
- `candidates.md`, `metrics.md`, `harness-proposals.md`, and `harness-regression-tests.md` may be used only during `/learn-pass`, `/memory-review`, or `/upgrade`.
- Ordinary `/delivery`, `/audit`, and `/audit-fin` do not load maintenance files.

Failure signal:
- Router says harness proposals/tests are only for `/upgrade`, blocking `/learn-pass` or `/memory-review` from seeing valid maintenance context.

## R001 — `/audit-fin` routes to finance memory without loading everything

Scope: `AGENTS.md`, `agent-memory/index.md`  
Status: active  
Last checked: 2026-06-29

Scenario:
- Task invokes `/audit-fin` or asks about balances, totals, ledger mismatches, reconciliation, or finance formulas.

Expected:
- Load `active.md` and `index.md`.
- Load `topics/audit-fin.md` only if finance/numeric memory is relevant and present.
- Do not load candidates, metrics, archive, mistakes, harness proposals, or harness regression tests by default.

Failure signal:
- Agent loads the whole memory tree or skips finance-specific memory routing.

## R002 — `/upgrade` can record proposal and validation

Scope: `agent-memory/harness-proposals.md`, `agent-memory/harness-regression-tests.md`  
Status: active  
Last checked: 2026-06-29

Scenario:
- Task invokes `/upgrade` or Memory Upgrade.

Expected:
- Harness proposal has problem, minimal change, expected behavior, regression risk, and validation result.
- Regression check is updated before broad promotion.

Failure signal:
- Harness weakness is found but not recorded or validated.

## R003 — No finance logic mutation during memory upgrade

Scope: `/upgrade`  
Status: active  
Last checked: 2026-06-29

Scenario:
- Memory Upgrade optimizes agent-memory and harness instructions.

Expected:
- Only Markdown memory/instruction files change automatically.
- Finance formulas, source data, provider classification, auth, deploy, and payment behavior are untouched.

Failure signal:
- Upgrade changes app code, ledger logic, data flow, or operational behavior without explicit user request.

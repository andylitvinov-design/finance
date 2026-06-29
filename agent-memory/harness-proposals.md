# Harness Proposals

Use this file only during `/upgrade`, `/learn-pass`, or `/memory-review`.

Harness proposals are not active rules until validated and promoted.

## 2026-06-29 — Align finance memory with `/upgrade` and `/audit-fin` router

Type: harness_proposal  
Scope: finance / agent-memory  
Status: validated_applied  
Risk: low  

Problem:
- `AGENTS.md` includes `/audit-fin` and `/upgrade` in the memory router, but local `agent-memory/active.md` and `agent-memory/index.md` were still on older lifecycle wording.

Minimal harness change:
- Add `/audit-fin` and `/upgrade` to active memory lifecycle wording.
- Add `topics/audit-fin.md` route in the index.
- Route harness proposal/regression files as maintenance-only context.
- Keep product code, finance formulas, auth, data, deploy, and payment behavior untouched.

Expected behavior change:
- `/audit-fin` can route to finance-specific memory without loading the whole tree.
- `/upgrade` can find proposal/regression files and record validation.

Regression risk:
- Very low: Markdown-only memory routing update.

Validation result:
- Passed by inspection: router remains lazy-loaded; no source/product/finance logic files changed.

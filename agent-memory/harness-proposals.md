# Harness Proposals

Use this file only during `/upgrade`, `/learn-pass`, or `/memory-review`.

Harness proposals are not active rules until validated and promoted.

## 2026-06-30 — Align maintenance-file scope wording with brain router

Type: harness_proposal  
Scope: finance / AGENTS.md memory router  
Status: patch_ready_pending  
Risk: low

Problem:
- Local `AGENTS.md` says harness proposals/tests load only during `/upgrade`.
- Local harness files and the canonical brain router allow proposal/regression context during `/learn-pass`, `/memory-review`, or `/upgrade`.

Minimal harness change:
- Narrowly update only the `Agent memory router` bullets in `AGENTS.md`:
  - keep archive lazy-loaded except conflict resolution or `/memory-review`;
  - allow candidates, metrics, harness proposals, and harness regression tests only during `/learn-pass`, `/memory-review`, or `/upgrade`;
  - preserve `/audit-fin` in the command list.

Expected behavior change:
- `/learn-pass` and `/memory-review` can inspect proposal/regression context when needed.
- Ordinary `/delivery`, `/audit`, and `/audit-fin` still avoid maintenance files unless explicitly in a memory-maintenance mode.

Regression risk:
- Low if the diff touches only the router bullets and preserves finance-specific `/audit-fin` wording.

Validation result:
- Not auto-applied in this connector pass to avoid full-file replacement risk on a large finance `AGENTS.md`; ready for Codex/local narrow patch.

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

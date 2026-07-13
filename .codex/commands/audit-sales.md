# /audit-sales

Run the single canonical `/audit-sales` mode for this repository.

Read first:
- `AGENTS.md`
- relevant project docs and current repo state
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/audit-sales.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/audit-sales-markers.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/codex-automation/audit-sales-memory.md`

Repository context:
- Repo: `andylitvinov-design/finance`
- Production: `https://ezohata-incoming-ledger.vercel.app`
- This is the legacy/reference Finance surface; do not conflate it with `ezohata-finance`.

Rules:
- `/audit-sales` is canonical; `/audit-sale` is compatibility alias only.
- Run one read-only context scout before scoring.
- Audit the public decision/onboarding surface only; financial truth stays under `/audit-fin`.
- Mark unavailable behavior `NOT_TESTED`; never guess.
- Do not edit code, merge, deploy, mutate financial data, configure providers or touch secrets during the audit.
- Do not invent business outcomes, metrics, prices, guarantees, scarcity, urgency or conversion uplift.
- Provider-dependent behavior remains `BLOCKED` or `NEEDS_VERIFICATION` without live proof.
- Produce exactly 3–5 ranked recommendations and one ready Codex prompt routed to `/delivery`, `/audit-ui`, `/safe`, `/planner` or `/audit-fin` when the finding is financial rather than sales-related.
- Compare with saved sales-audit memory and label findings `NEW`, `CHANGED`, `UNCHANGED`, `RESOLVED` or `SUPERSEDED`.

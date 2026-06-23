# /audit

`/audit` is sufficient by itself for this finance project.

Mode: diagnostic, not implementation.

Use `/audit` for finance-project UI/UX/product/technical diagnosis:

- dashboard/table/report screens;
- mobile/desktop layout;
- navigation and filters;
- data-loading states;
- visible errors;
- production/debug endpoint visibility;
- chart/table/card consistency;
- UX around financial values;
- unclear or misleading financial UI.

For numeric, calculation, balance, total, currency, date-range, or ledger mismatches, prefer `/audit-fin`.

Shared source of truth:

```txt
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-loop.md
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-ui-polish-skill.md
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/ry-agent-audit-modes.md
```

Finance-local source of truth:

```txt
AGENTS.md
CLAUDE_CODE_PROMPTS.md
scripts/production-debug-preflight.mjs
/api/status
/api/audit-snapshot
/api/debug-ui-state
```

Required chain:

```txt
understand target -> prove production source when relevant -> inspect project rules -> inspect relevant code/read-only endpoints -> evaluate UX/UI/product/technical layers -> map symptoms to code-level findings -> create/update GitHub issue -> return short /delivery prompt
```

For finance UI, always check:

- whether visible numbers reconcile with machine-readable endpoints;
- whether table totals match visible rows;
- whether filters/date ranges are clear;
- whether loading/error/empty states avoid misleading financial conclusions;
- whether UI hides or exposes raw technical errors appropriately;
- whether mobile layout keeps critical totals and controls readable.

UI polish pass:

Use the shared UI polish addendum. If `jakubkrehel/make-interfaces-feel-better` is installed, use it; otherwise use the fallback checklist.

Issue behavior:

When GitHub access is available, create or update an issue in:

```txt
https://github.com/andylitvinov-design/finance/issues
```

Issue title format:

```txt
[AUDIT] <area/page/feature>: <short problem summary>
```

Final chat output must be short and include a copy-pasteable handoff prompt starting with `/delivery` as the first non-empty line. Do not start with `/audit -> /delivery handoff`.

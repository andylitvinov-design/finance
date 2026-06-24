# /audit

`/audit` is diagnostic mode for Finance UI/UX/product/technical diagnosis. For numeric, balance, total, currency, date-range, ledger, reconciliation, dashboard, formula, or source-of-truth mismatches, prefer `/audit-fin`.

## Source of truth

Read in order:

1. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-settings.md`
2. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-command-protocols.md`
3. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-project-adapters.md`
4. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-skills.md`
5. `AGENTS.md` - Finance local adapter and safety rules
6. `CLAUDE_CODE_PROMPTS.md`
7. `docs/audit-deep-technical-issue-writing.md`
8. `scripts/production-debug-preflight.mjs`

## Project adapter

- Repository: `andylitvinov-design/finance`
- Known local folder: `/Users/andriilitvinov/projects/MYPROJECTS/finance`
- Primary live URL: `https://ezohata-incoming-ledger.vercel.app`
- Issue tracker: `https://github.com/andylitvinov-design/finance/issues`
- Read-only proof endpoints: `/api/status`, `/api/audit-snapshot`, `/api/debug-ui-state`

## Required behavior

Follow the shared `/audit` chain, then apply finance-specific source proof:

```txt
understand target
-> prove production source when relevant
-> inspect project rules
-> inspect relevant code/read-only endpoints
-> trace route/component/API/data/style/test chain
-> evaluate UX/UI/product/technical layers
-> map symptoms to code-level findings
-> create/update GitHub issue
-> return short /delivery prompt
```

Do not edit app code, production data, formulas, provider semantics, balance logic, or accounting rules during `/audit`.

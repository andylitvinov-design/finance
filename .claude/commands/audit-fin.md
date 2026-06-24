# /audit-fin

`/audit-fin` is diagnostic numeric/source-layer mode for Finance. It does not patch formulas, mutate production data, or change accounting semantics unless the user explicitly switches to `/delivery` and the failing layer has been proven.

## Source of truth

Read in order:

1. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-settings.md`
2. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-command-protocols.md`
3. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-project-adapters.md`
4. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-skills.md`
5. `AGENTS.md` - Finance local adapter and safety rules
6. `CLAUDE_CODE_PROMPTS.md`
7. `docs/audit-fin-deep-technical-implementation.md`
8. `/api/status`, `/api/audit-snapshot`, `/api/debug-ui-state` when available

## Project adapter

- Repository: `andylitvinov-design/finance`
- Known local folder: `/Users/andriilitvinov/projects/MYPROJECTS/finance`
- Primary live URL: `https://ezohata-incoming-ledger.vercel.app`
- Issue tracker: `https://github.com/andylitvinov-design/finance/issues`
- Read-only proof endpoints: `/api/status`, `/api/audit-snapshot`, `/api/debug-ui-state`

## Required behavior

Follow the shared `/audit-fin` trace and finance source proof:

```txt
production source proof
-> visible value
-> component
-> state/selection
-> data source/read-only endpoint
-> parsing/normalization
-> formula/helper
-> aggregation
-> hydration/cache
-> formatting
-> rendering/table/chart
-> tests
```

Before hypotheses, run the source-layer matrix and identify the first divergence layer. Do not blame formulas before checking production source, raw data, parsing, state, aggregation, formatting, and rendering.

The issue must include the numeric contract, visible values, implementation trace, inspected files/functions/APIs, source-layer matrix, first divergence layer, rejected hypotheses when relevant, protected areas not to touch, deterministic verification plan, and ready-to-run `/delivery` prompt.

---
name: audit-ui
description: Run UI/UX design audit from screenshot, link, or route. Produces 5-7 ideas, 3 concepts, sketch/mockup directions, recommended concept, GitHub issue, and short /delivery prompt. Does not implement by default.
argument-hint: "[screenshot/link/route/problem]"
disable-model-invocation: true
user-invocable: true
---

# /audit-ui — UI_CONCEPT_AUDIT_LOOP

`/audit-ui` is sufficient by itself.

Mode: UI/UX design audit and concept selection, not implementation.

## Source of truth

Read:

1. `.claude/commands/audit-ui.md`
2. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-ui-mode.md`
3. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-command-protocols.md`
4. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-skills.md`
5. `docs/delivery-design-quality-gate.md`
6. `AGENTS.md`

## Project adapter

- Repository: `andylitvinov-design/finance`
- URL: `https://ezohata-incoming-ledger.vercel.app`
- Preserve readable totals, tables, filters, source labels, and audit/debug clarity.

## Required chain

```txt
screenshot/link/route -> current UI diagnosis -> problems/opportunities -> 5-7 improvement ideas -> top 3 concepts -> sketch/mockup directions -> compare concepts -> recommended concept -> GitHub issue -> short /delivery prompt
```

## Output

Return a short report with:

- 3 best concepts;
- recommended concept;
- why it was selected;
- sketch/mockup notes;
- issue link;
- `/delivery` prompt.

Do not implement code unless the user explicitly continues to `/delivery`.

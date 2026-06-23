# /audit-fin

`/audit-fin` is sufficient by itself for this finance project.

Mode: diagnostic, not implementation.

Use `/audit-fin` for every question about:

- balances;
- totals;
- ledgers;
- payments;
- income/expense;
- provider/channel breakdowns;
- exchange/currency;
- movement tables;
- period/date ranges;
- reconciliation;
- dashboard values;
- charts;
- formulas;
- numeric UI mismatches;
- stale production data;
- source-of-truth mismatch.

Shared source of truth:

```txt
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-loop.md
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-failed-repair.md
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
understand numeric target -> prove production source -> extract numeric contract -> inspect visible numbers -> inspect read-only evidence endpoints -> inspect code/data flow -> run source-layer matrix before hypotheses -> compare expected vs actual -> list problems -> generate focused hypotheses only from failing/unverified layers -> evaluate hypotheses -> choose likely root cause -> create/update GitHub issue -> return short /delivery prompt
```

Mandatory source-layer matrix before hypotheses:

1. Production source-of-truth: repo/ref/deployed SHA.
2. Raw ledger/data availability.
3. Input parsing/normalization.
4. Provider/channel/source classification.
5. Date range and timezone boundaries.
6. Currency/exchange/precision.
7. State and selection.
8. Formula/business logic.
9. Aggregation helper/code.
10. Persistence/hydration/cache.
11. Formatting/rounding/sign display.
12. Rendering/component binding.
13. Chart/table/card consistency.
14. API/debug endpoint proof.
15. Test fixture/proof.

For each layer:

```txt
Layer status: PASS | ISSUE | NOT VERIFIED | NOT APPLICABLE
Problem level: NONE | LOW | MEDIUM | HIGH | BLOCKER
Evidence:
Gap:
Next verification:
```

Rules:

- Do not patch formulas during `/audit-fin`.
- Do not modify production financial data during `/audit-fin`.
- Do not invent missing financial values.
- Do not treat missing data as zero unless product rules explicitly say so.
- Do not hide real calculation/data errors behind UI empty states.
- Do not generate a huge generic hypothesis list.
- If previous fixes failed, run failed-repair analysis before proposing another fix.
- If production source-of-truth is stale or wrong repo/ref is deployed, fix deployment/source mismatch before blaming formulas.

Issue behavior:

When GitHub access is available, create or update an issue in:

```txt
https://github.com/andylitvinov-design/finance/issues
```

Issue title format:

```txt
[AUDIT-FIN] <area/metric>: <short numeric problem summary>
```

Final chat output must be short and include a copy-pasteable handoff prompt starting with `/delivery` as the first non-empty line. Do not start with `/audit-fin -> /delivery handoff`.

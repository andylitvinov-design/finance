# /audit-fin

`/audit-fin` is sufficient by itself for this finance project.

Mode: diagnostic, not implementation.

Use `/audit-fin` for balances, totals, ledgers, payments, income/expense, provider/channel breakdowns, exchange/currency, movement tables, period/date ranges, reconciliation, dashboard values, charts, formulas, numeric UI mismatches, stale production data, and source-of-truth mismatch.

Source of truth:

```txt
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-loop.md
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-failed-repair.md
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/ry-agent-audit-modes.md
AGENTS.md
CLAUDE_CODE_PROMPTS.md
docs/audit-fin-deep-technical-implementation.md
/api/status
/api/audit-snapshot
/api/debug-ui-state
```

Required chain:

```txt
numeric target -> production source proof -> numeric contract -> visible value -> read-only endpoint evidence -> code/data inspection -> implementation trace -> source-layer matrix -> first divergence layer -> focused hypotheses -> issue -> /delivery prompt
```

Mandatory implementation trace:

```txt
visible value -> component -> state/selection -> read-only API proof -> data normalization -> formula/aggregation -> rendering -> styles -> tests
```

Mandatory source-layer matrix before hypotheses:

1. Production source-of-truth.
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

Before writing the issue, identify the first layer where expected value becomes wrong actual value.

The issue must include numeric implementation trace, API/code evidence, first divergence layer, confirmed vs likely/unverified findings, implementation map, deterministic verification plan, and ready-to-run `/delivery` prompt.

Use labels:

```txt
CODE VERIFIED
API VERIFIED
RUNTIME VERIFIED
DATA VERIFIED
LIKELY
NOT VERIFIED
```

Rules:

- Do not patch during `/audit-fin`.
- Do not invent missing financial values.
- Do not treat missing data as zero unless product rules explicitly say so.
- Do not generate a huge generic hypothesis list.
- If previous fixes failed, explain why before proposing another fix.

When GitHub access is available, create or update an issue in:

```txt
https://github.com/andylitvinov-design/finance/issues
```

Final chat output must be short and include a copy-pasteable handoff prompt starting with `/delivery` as the first non-empty line.

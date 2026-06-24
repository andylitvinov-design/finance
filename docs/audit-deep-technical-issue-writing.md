# /audit — Deep Technical Issue Writing Gate

Required for `/audit`.

An audit issue must let another agent implement without rediscovering the whole repo.

## Required trace

Document:

```txt
route/page -> UI component -> state/selection -> read-only API proof -> data normalization -> formula/aggregation -> rendering -> styles -> tests
```

For each inspected file:

```txt
File:
Why relevant:
Controls:
Evidence:
Risk:
```

## Required issue sections

```md
## Technical code trace
| Layer | File/function/component | Evidence | Change direction | Risk |
|---|---|---|---|---|

## Confirmed vs suspected
### Confirmed from code/API
- ...

### Suspected / needs verification
- ...

## Implementation map
| Step | File/function/component | Change | Why | Verification |
|---|---|---|---|---|

## Do-not-touch
- Production data
- Finance semantics without proof
- Env/provider settings
- Unrelated flows

## Verification plan
- Release guard/tests
- /api/status
- /api/audit-snapshot
- /api/debug-ui-state
- Route(s) to open
- Regression fixture

## Ready-to-run /delivery prompt
/delivery
Task:
...
```

## Evidence labels

- `CODE VERIFIED`
- `API VERIFIED`
- `RUNTIME VERIFIED`
- `LIKELY`
- `NOT VERIFIED`

Do not present guesses as facts.

If code/API access was unavailable, mark `PARTIAL_CODE_LIMITATION` or `PARTIAL_API_LIMITATION`.

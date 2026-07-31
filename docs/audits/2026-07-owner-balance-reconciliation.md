# July 2026 owner-balance reconciliation — audit-only snapshot

**Current production capture:** 2026-07-29 14:37 UTC

**Scope:** 2026-07-01 through 2026-07-29, production read-only evidence only

**Status:** **NOT CLOSED — owner snapshots are present, but the ledger does not yet explain their delta.**

## Decision

Production now contains two authoritative owner-confirmed batches:

- `owner-confirmed-2026-07-01`: **21,090.50 USD**;
- `owner-confirmed-2026-07-29`: **22,454.50 USD**.

The factual owner-balance delta is therefore **+1,364.00 USD**. The live audit endpoint's amount-net-compatible ledger movement is **-2,948.5720 USD**, after excluding three rows with missing `amount_net`. As a conditional reconciliation:

```text
21,090.50 + (-2,948.5720) = 18,141.9280
22,454.50 - 18,141.9280 = +4,312.5720
```

So the owner delta is **not explained by the current ledger calculation**. `+4,312.5720 USD` is a real reconciliation gap against that endpoint's current calculation, but not yet a final financial conclusion: the calculation has missing PayPal net values, exchange/transfer classification uncertainty, and a 46-technical-position reconciliation that is not the requested canonical 20-owner-position registry.

No financial rows, snapshots, provider imports, mappings, or environment variables were changed in this audit.

## Production source proof

| Item | Evidence |
| --- | --- |
| Canonical repository | `andylitvinov-design/finance` |
| Live domain | `https://ezohata-incoming-ledger.vercel.app/` |
| Vercel project | `ezohata-incoming-ledger` |
| Live `/api/status` | HTTP 200, JSON, `ok: true` |
| Current production source | `main` / `216346f98e487c4d01576a395a1401640d174b40` |
| Google Sheet read | configured and `readOk: true` |

An earlier capture immediately before the `216346f` deployment saw only 72 ledger rows and no PayPal rows. The current deployment reads 142 rows, including 70 PayPal rows, and exposes the two authoritative snapshot batches. This report uses the post-deploy data only; the earlier reading is superseded.

## Authoritative snapshots and cutoff limitations

| Batch | Effective date | Factual rows | Total USD | Batch status |
| --- | --- | ---: | ---: | --- |
| `owner-confirmed-2026-07-01` | 2026-07-01 | 19 | 21,090.50 | factual full |
| `owner-confirmed-2026-07-29` | 2026-07-29 | 20 | 22,454.50 | factual full |

No conflicts were reported between the batches. Snapshot projections are nevertheless partial against the endpoint's 23 technical channel/currency expectations: 17 selected rows on 1 July and 19 on 29 July. The public endpoint exposes only effective dates, not exact capture timestamps, so it cannot prove the requested intraday transaction cutoffs.

## Current ledger and provider evidence

| Metric | Value | Audit meaning |
| --- | ---: | --- |
| Ledger rows | 142 | All current production rows in the period |
| Income rows | 29 | Classification aggregate |
| Expense rows | 78 | Classification aggregate |
| Transfer rows | 5 | Pairing evidence still required |
| Exchange rows | 35 | Must not be treated as external cash movement |
| Unknown-source rows | 0 | Pass for this check |
| Missing `amount_net` | 3 | Excluded from the `-2,948.5720` ledger movement |
| Ledger movement from valid `amount_net` rows | **-2,948.5720 USD** | Candidate explained movement, not final reconciliation |
| Current conditional gap to owner closing | **+4,312.5720 USD** | Needs classification and owner/provider evidence |

PayPal is the dominant unresolved provider layer:

| PayPal diagnostic | Value |
| --- | ---: |
| Rows | 70 |
| Gross USD | 4,152.78 |
| Exact net USD currently usable | 830.00 |
| Fee total USD recorded | 34.00 |
| Rows with missing fee | 69 |
| Rows with missing `amount_net` | 3 |
| Permission/backfill status | needs verification |

The missing-fee and missing-net values mean gross, fee, and net cannot be used interchangeably. The public UI aggregate also shows 35 PayPal exchange-classified rows totaling `-1,719.1328 USD`; they require linked-pair and conversion evidence before contributing to owner capital.

## Failing layers and root-cause evidence

| Problem | Severity | Failing layer | Evidence for | Confidence | Automatic repair? |
| --- | --- | --- | --- | --- | --- |
| Owner delta is not explained by ledger movement | Critical | Reconciliation / data completeness | `+1,364.00` owner delta versus `-2,948.5720` valid-net ledger movement leaves `+4,312.5720` | High | No |
| Canonical owner registry is not the reconciliation total | Critical | Snapshot registry / reconciliation | Authoritative totals are 19/20 factual rows, while period reconciliation checks 46 technical positions and reports a non-owner USD total of 41,923.4376 | High | No |
| PayPal gross/fee/net is incomplete | High | Provider/import / normalization | 69 missing-fee rows, 3 missing-net rows, permission status `needs verification` | High | No — provider evidence required |
| Exchange and transfer classification is incomplete | High | Normalization / reconciliation | 35 exchange rows and 5 transfer rows; read-only transfer aggregate is empty | High | No — do not infer pairs automatically |
| Exact snapshot cutoffs are absent | High | Snapshot registry / observability | Endpoint gives dates but no capture timestamps | High | No — retain owner evidence |
| Protected raw transaction diagnostics are unavailable | High | Observability | `includeRowsAuthorized: false`; no debug token configured | High | No — owner-run redacted extract or explicit temporary diagnostic authorization |
| Technical balance coverage is unstable | High | Balance / reconciliation | 46 positions: 12 mismatch, 26 calculated-from-previous, 1 missing-net | High | No |

## Top live technical diagnostics

These diagnostics are **not owner positions** and must not be summed with aggregate rows. They identify the highest-impact records that require evidence before any repair.

| Channel / currency | Computed end USD | Reported end USD | Difference USD | Status |
| --- | ---: | ---: | ---: | --- |
| Bank Canada CAD | 7,789.00 | 12,500.00 | +4,711.00 | mismatch |
| PayPal EUR | -1,998.6220 | 0.00 | +1,998.6220 | missing `amount_net` |
| Transferwise USD | 1,229.74 | 270.00 | -959.74 | mismatch |
| Binance Spot aggregate | 1,262.00 | 394.00 | -868.00 | aggregate diagnostic |
| Payoneer EUR | 693.00 | 75.00 | -618.00 | mismatch |
| PayPal USD | -349.36 | 234.70 | +584.06 | mismatch |
| YooMoney RUB | 950.2301 | 482.00 | -468.2301 | mismatch |

## What is proven and what remains open

| Requirement | Status |
| --- | --- |
| Production source of truth proven | Pass |
| Owner opening and closing batches present | Pass |
| Factual owner delta calculated | Pass: +1,364.00 USD |
| Valid-net ledger movement calculated | Pass: -2,948.5720 USD, with 3 excluded rows |
| Conditional gap calculated | Pass: +4,312.5720 USD |
| Exact snapshot cutoffs | Blocked |
| Canonical 20 owner positions | Blocked |
| All operations classified and boundary-checked | Blocked |
| Internal transfers net to zero | Blocked |
| PayPal backfill and fee/net completeness | Blocked |
| Gross/fee/net, duplicates, signs, refunds, and FX proven | Blocked |
| No unapproved financial repair performed | Pass |

## Required next steps

1. Produce a redacted, exact-cutoff transaction extract for the two owner snapshots. It must include source, canonical channel, signed amount, gross, fee, net, `amount_net`, status, provider timestamp, and transfer linkage.
2. Finish PayPal provider evidence: reconcile the 70 rows against provider activity, recover fees/net where provider data proves them, and rerun an idempotent dry-run. Do not fill unknown fees with zero.
3. Deploy or prove the canonical 20-owner-position registry. Separate owner rows, diagnostic rows, unmapped rows, and aggregate/components before summing.
4. Match the five transfers with strong evidence only and verify their total capital impact is zero.
5. Recalculate the owner-position table and classify the `+4,312.5720` gap into external movement, fees, FX/valuation, adjustments, duplicates, or unresolved items.

## Verification performed

- Live production preflight at SHA `216346f`: `/api/status` HTTP 200 JSON and Google read state verified.
- Read-only endpoints: `/api/audit-snapshot`, `/api/balance-snapshots` for both dates, `/api/debug-ui-state`, and `/api/period-balance-reconciliation`.
- GitHub: Issue #625 and PRs #630–#632 inspected; current report is linked from Issue #634 and draft PR #633.
- Clean worktree checks: `npm test` — **1,462 passed, 0 failed**; `npm run build` — passed; `git diff --check` — passed.
- `release-guard` could not run in the isolated worktree because its Vercel linkage file `.vercel/project.json` is intentionally absent there. This is a local verification-environment limitation, not a passed guard.

**Residual risk:** the monthly reconciliation remains open. The figures above prove a sizeable gap, but not its financial cause; no data repair should start until the required provider, transfer, timestamp, and canonical-registry evidence exists.

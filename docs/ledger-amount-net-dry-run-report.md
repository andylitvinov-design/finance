# Ledger Amount Net Dry-Run Report

Date: 2026-05-02
Branch: `codex/ledger-v2-amount-net-paypal-source`
Commit: `be286b4`

## Checks

- `npm test` -> pass
- `npm run build` -> pass
- `bash scripts/release-guard.sh` -> pass

## Migrator Dry-Run

Command:

```bash
node scripts/migrate-ledger-amount-net.mjs
```

Environment:

- Production Vercel env pulled locally into ignored `.vercel/.env.production.local`
- Migration was run in dry-run mode only
- No production data was changed

Dry-run summary:

```json
{
  "ok": true,
  "dryRun": true,
  "applied": false,
  "rowCount": 39,
  "hasChanges": true,
  "missingAmountNetRows": 8,
  "incompletePayPalRows": 0,
  "exchangeMissingAmountUsdRows": 0,
  "derivedExchangeAmountUsdRows": 0,
  "sourceBackfilledRows": 0,
  "unknownSourceRows": 0,
  "balanceDelta": 0.85,
  "errors": []
}
```

## Missing `amount_net` Rows

| date | channel | source | provider | amount | amount_gross | amount_fee | amount_net | safe action |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 2026-04-30 | трансервайз дол | wise | wise | 231.75 | 231.75 |  |  | backfill |
| 2026-04-29 | трансервайз дол | wise | wise | 51.5 | 51.5 |  |  | backfill |
| 2026-04-27 | трансервайз дол | wise | wise | 309 | 309 |  |  | backfill |
| 2026-04-24 | трансервайз дол | wise | wise | 103 | 103 |  |  | backfill |
| 2026-04-21 | трансервайз дол | wise | wise | 257.5 | 257.5 |  |  | backfill |
| 2026-04-13 | трансервайз дол | wise | wise | 51.5 | 51.5 |  |  | backfill |
| 2026-04-03 | трансервайз дол | wise | wise | 103 | 103 |  |  | backfill |
| 2026-04-02 | трансервайз дол | wise | wise | 103 | 103 |  |  | backfill |

## Expected Audit Snapshot After Review and Apply

Expected post-apply metrics, assuming only the eight safe Wise rows are backfilled and no other ledger rows change:

- `ledger_rows = 39`
- `fallback_amount_rows = 0`
- `warnings: amount_net missing = 0`
- `balances.uses_amount_net = true`
- `exchange.missing_amount_usd_rows = 0`
- `sources.unknown = 0`
- PayPal remains explicit and unchanged for this migration:
  - `gross_total_usd = 1326`
  - `fee_total_usd = null`
  - `net_total_usd = null`
  - `missing_fee_rows = 5`
  - `permission_status = needs verification`

## Hold Point

Do not run `--apply` until this dry-run report is reviewed.

# Agent-Auditor Audit Snapshot

## Purpose

`/api/audit-snapshot` gives an external data auditor a safe JSON summary of the EzoHata incoming-ledger system without requiring Google OAuth browser login or access to private UI screens.

The endpoint is read-only. It does not migrate Google Sheets, write rows, change environment variables, or call provider write APIs.

## Why Browser Audit Failed

The live dashboard depends on browser Google OAuth and Google Sheets data. External ChatGPT Agent-Auditor sessions cannot reliably complete that interactive login flow or inspect the same authenticated tables as the owner.

The audit model is therefore data-first: the app exposes a minimal, safe aggregate snapshot that can be checked by another agent without viewing the private dashboard.

## Data Auditor Model

The endpoint reads the existing server-side manual ledger repository when service-account access is configured. It summarizes normalized ledger operations and returns only aggregate counts, totals, warnings, and audit checks.

If live Google access is missing or fails, the endpoint still returns `ok: true` with `needs verification` warnings and null/zero totals. It does not crash or expose credential details.

## Endpoint Contract

Path:

```text
GET /api/audit-snapshot
```

Query parameters:

```text
period=YYYY-MM
from=YYYY-MM-DD&to=YYYY-MM-DD
includeRows=0|1
```

Phase 1 is public summary-only. `includeRows=1` is accepted for forward compatibility, but rows are not returned and a warning is included.

Response shape:

```json
{
  "ok": true,
  "generated_at": "2026-05-01T00:00:00.000Z",
  "project": "ezohata-incoming-ledger",
  "period": {
    "from": "2026-05-01",
    "to": "2026-05-31"
  },
  "schema": {
    "ledger_contract": "v2-compatible",
    "sheet_layout": "v1-compatible",
    "source_of_truth": "ledger",
    "physical_sheet_migration": false
  },
  "summary": {
    "ledger_rows": 0,
    "income_rows": 0,
    "expense_rows": 0,
    "transfer_rows": 0,
    "exchange_rows": 0,
    "unknown_source_rows": 0
  },
  "balances": {
    "by_channel": [],
    "total_usd": null,
    "uses_amount_net": true,
    "fallback_amount_rows": 0
  },
  "daily_balances": {
    "uses_amount_net": true,
    "rows": [],
    "actionable_rows": [],
    "summary": {
      "rows": 0,
      "mismatch_rows": 0,
      "missing_opening_balance_rows": 0,
      "missing_provider_balance_rows": 0,
      "excluded_missing_amount_net_rows": 0,
      "status_counts": {
        "ok": 0,
        "mismatch": 0,
        "missing_opening_balance": 0,
        "missing_provider_balance": 0,
        "needs_verification": 0
      }
    }
  },
  "paypal": {
    "rows": 0,
    "gross_total_usd": null,
    "fee_total_usd": null,
    "net_total_usd": null,
    "missing_counterparty_rows": 0,
    "permission_status": "needs verification"
  },
  "exchange": {
    "rows": 0,
    "missing_amount_usd_rows": 0,
    "total_out_usd": null,
    "total_in_usd": null,
    "compatibility_mode": true
  },
  "sources": {
    "manual": 0,
    "fact": 0,
    "paypal": 0,
    "monobank": 0,
    "privatbank": 0,
    "td_bank": 0,
    "unknown": 0
  },
  "warnings": [],
  "audit_checks": []
}
```

## Security Rules

The endpoint must not return:

- environment values
- OAuth tokens
- Google service-account keys
- PayPal secrets
- bank tokens
- cookies
- raw access tokens
- provider transaction ids
- private counterparty identity details
- raw Google Sheet rows

Phase 1 deliberately returns aggregates only. Sanitized rows are deferred until a token-gated audit mode exists.

## How ChatGPT Agent-Auditor Should Use It

1. Fetch `/api/audit-snapshot?period=YYYY-MM`.
2. Confirm `ok: true`.
3. Treat any `needs verification` warning as an explicit audit gap, not as a pass.
4. Check that:
   - `schema.ledger_contract` is `v2-compatible`
   - `schema.source_of_truth` is `ledger`
   - `balances.uses_amount_net` is `true`
   - `balances.fallback_amount_rows` is low or explained by warnings
   - PayPal gross, fee, and net totals are separated when rows exist
   - exchange rows do not have unexpected missing `amount_usd`
   - source distribution does not have unexplained mass `unknown`

## Known Limitations

- The endpoint does not prove live PayPal Transaction Search permission; it reports `paypal.permission_status: "needs verification"`.
- The endpoint does not expose rows in Phase 1, even with `includeRows=1`.
- Totals are only as current as the server-side Google Sheets read path.
- If Google service-account access is unavailable, all live data checks are reported as `needs verification`.
- Physical Google Sheet migration is intentionally false; Ledger v2 compatibility is normalized in code.

## Daily Balances

`daily_balances` is additive and does not change `balances.by_channel`. It uses only Ledger `amount_net` / `balance_amount`; rows without `amount_net` are excluded and counted.

`Остатки`, `Авто Остатки`, and planned balance snapshots are end-of-day balances at 23:59 local day by date + channel + currency. All movements on the same date are already included in that date's snapshot.

For period reconciliation, a period-start snapshot is the opening EOD fact for that date, so movement starts on the next day. For same-day periods (`from=to`), the engine uses the previous EOD snapshot as opening and the selected date's 23:59 snapshot as closing to avoid double-counting same-day movement.

## needs verification

`needs verification` means the data-auditor could not prove a condition from the public summary endpoint alone. It is not a failure by itself, but it must be reviewed before claiming the financial system is fully audited.

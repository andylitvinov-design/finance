# Agent-Audit-Fixer Debugger Access Architecture

This project exposes a small read-only debugging surface so an agent can prove the failing layer before patching production finance bugs.

## Source-of-truth order

Use this order for production debugging:

1. Repository `main` in `andylitvinov-design/finance`.
2. Production `/api/status` for deployed commit/source metadata.
3. Production `/api/audit-snapshot` for normalized ledger/balance/provider audit state.
4. Production `/api/debug-ui-state` for server-derived UI aggregate observability.
5. Screenshot/user report.

If these disagree, treat it as a deploy/source-of-truth or observability mismatch before changing finance formulas.

## Endpoints

### `/api/status`

Purpose: prove production deploy/source-of-truth.

Expected fields:

- `ok`
- `status`
- `service`
- `vercelProjectName`
- `deploymentUrl`
- `commitSha`
- `commitRef`
- `gitRepoSlug`
- `googleSheetReadOk`
- `observability.metadataSource`

### `/api/audit-snapshot`

Purpose: prove normalized ledger, balance, provider, exchange, source, and daily-balance state.

Use it for balance/provider/import questions before reading UI code.

Useful query parameters:

- `period=YYYY-MM`
- `from=YYYY-MM-DD&to=YYYY-MM-DD`
- `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

Public mode is summary-only. It must not expose secrets or raw provider payloads.

### `/api/debug-ui-state`

Purpose: expose the same kind of aggregate evidence an agent needs when the screenshot shows a UI mismatch.

It is routed through the existing `/api/index` serverless function:

```json
{
  "source": "/api/debug-ui-state",
  "destination": "/api/index?action=debugUiState"
}
```

This avoids adding another Vercel function on Hobby limits.

Useful query parameters:

- `period=YYYY-MM`
- `from=YYYY-MM-DD&to=YYYY-MM-DD`
- `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `includeRows=1` for safe row samples only when a debug token is configured and supplied.
- `debugToken=...` only if row-level mode is intentionally enabled.

Returned sections:

- `deploy` — commit/ref/project/source metadata.
- `ui_aggregate_contract` — formulas and invariants.
- `top_metrics` — server-derived inputs for top UI metrics; formula is `total_orders_usd * 0.3 - total_paid_usd`.
- `finance_analysis` — planned best-effort movement summary and actual income by channel.
- `expense_analysis` — real expense by channel and transfer/exchange outflows.
- `transfer_analysis` — transfers and exchanges by channel.
- `source_counts` — source distribution for filtered ledger rows.
- `row_samples` — safe rows only if authorized.
- `warnings` — explicit `needs verification` messages when movement/order rows are unavailable or row access is disabled.

## Row-level safety

Row-level mode is disabled unless both are true:

1. `includeRows=1` is requested.
2. A configured debug token matches the query token.

Accepted env names:

- `AGENT_DEBUG_TOKEN`
- `DEBUG_SNAPSHOT_TOKEN`
- `EZOHATA_DEBUG_TOKEN`

Do not expose the token in logs, docs, comments, screenshots, or PR text.

Safe row fields are restricted to:

- rowId
- date
- operation
- direction
- from_channel
- to_channel
- channel
- amount
- currency
- amount_usd
- amount_net
- source
- category
- subcategory
- sourceTransactionId
- rawSourceId
- comment_excerpt, max 120 chars

Sanitization redacts email-like values, long account/card-like numbers, bearer/basic auth values, and secret/token/private-key looking values.

## Live debug checklist

For runtime/API/provider/UI bugs, record:

1. Live URL.
2. Endpoint and method.
3. HTTP status.
4. Content-Type.
5. First 300 chars of body if failing.
6. `/api/status.commitSha`, `commitRef`, `gitRepoSlug`.
7. `/api/audit-snapshot` period and relevant summary.
8. `/api/debug-ui-state` aggregate and row evidence.
9. Failing layer: `deploy/source -> UI -> API route -> provider/import -> normalization -> ledger save -> balance -> analytics`.

## Finance invariants

- Balance uses `amount_net`.
- Rows with valid `amount_net` are not excluded only because `source=unknown`.
- Unknown source can degrade analytics but must not automatically break balance.
- PayPal gross is not net if fee is missing.
- Provider non-JSON/plain-text/HTML errors must become structured JSON errors.
- Debug endpoints are observability only and must not become source-of-truth finance calculators.

## Agent usage pattern

For every screenshot discrepancy:

1. Check `/api/status` first.
2. If deploy/source is stale, do not patch business logic yet.
3. Check `/api/audit-snapshot` for ledger/provider/balance evidence.
4. Check `/api/debug-ui-state` for UI aggregate evidence.
5. Only then inspect code and patch the proven failing layer.

Always report `needs verification` instead of claiming exact root cause when row-level evidence is unavailable.

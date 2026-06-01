# Balance System Upgrade Plan

## Goal

Create one reliable balance system with three separate layers: factual balances, daily calculated balances, and reconciliation. The UI must show one canonical current balance total, while diagnostics explain stale, manual, unsupported, or incomplete sources.

## Layers

1. Factual balances: verified balances from automatic sources or user-confirmed manual input. Each fact must have date, channel, currency, native amount, USD amount, source, timestamp, and confidence/status.

2. Daily calculated balances: previous closing balance plus daily Ledger movements. These rows are derived and must not be shown as confirmed facts.

3. Reconciliation: compares calculated closing balance with factual closing balance and shows last fact date/source, difference, status, and required action.

## Core rules

- Top-card Остатки and popup primary ВСЕГО USD must use the same canonical total.
- A non-zero native amount must never silently become USD zero.
- USD/stablecoin rows without USD value should use native amount as USD.
- Non-USD rows need a trusted FX source or must be marked fx_missing.
- Manual-only or stale sources must be visible and red.
- User-confirmed balances override calculated forecasts for the same date/channel/currency.

## Refresh button

Add or finalize one button in the Остатки popup: Обновить все остатки.

It must refresh every implemented automatic source, update supported balances and movements, rerun balance snapshots and reconciliation, then return a clear report showing what succeeded, what failed, and what needs manual action.

The first required automatic sources are Wise, Binance, and PayPal. Other sources such as Yandex and Monobank should be included only if implemented and available. Revolut, Bank Canada, and other manual-only sources must be marked as manual/stale with last known date and required action.

## Provider matrix

The backend must return a matrix by channel/currency with automatic balance support, transaction import support, access/status, last import date, last balance date, last factual balance date/source, stale reason, required action, and severity.

## Tests

Add tests for provider success, provider failure, unsupported manual channel warning, USD native fallback, FX missing handling, selected-date total matching period total, top-card matching popup total, user-confirmed fact priority, daily balance calculation, and reconciliation status/difference.

## Acceptance

The upgrade is done when one button refreshes supported sources, top-card and popup show one canonical total, unsupported/manual sources are red, no native amount is counted as USD zero, selected-date and period totals match or show an explicit explained difference, and the report clearly tells the user what still requires manual update.

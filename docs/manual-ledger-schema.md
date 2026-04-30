# Manual Ledger Schema

## Purpose

This document defines the current live manual-ledger contract, the minimal safe fix now used by the app, and the target normalized ledger model for the next architecture step.

## Current Live Contract

The live workflow is still hybrid:

- UI `fact` editor works as a legacy snapshot editor for the selected period end date.
- Hidden Google Sheets tabs store operational data:
  - `Переводы`
  - `Расходы`
  - `Остатки`
  - `Комиссии`
- Analytics is rebuilt client-side from:
  - dashboard snapshot / upstream API payload
  - manual expense rows
  - manual transfers
  - manual balances
  - manual commissions

`Расходы` currently uses a wide daily summary shape:

```text
date | category | channel1 | channel2 | channel3 ...
```

This remains the persisted compatibility layer for the minimal fix.

## Minimal Fix Contract

### Canonical categories

- `serviceIncome`
- `business`
- `flat`
- `food`
- `fun`
- `study`
- `travel`
- `exchange`

### Accepted aliases

- `house` -> `flat`
- `events` -> `fun`
- `beauty` -> `fun`
- `serviceincome` / `service income` / `servicein` -> `serviceIncome`
- `travelFun` / `travel fun` -> `travel`
- `exchange_in` -> `exchange`
- legacy `комиссии` in analytics plan sections is normalized to `exchange`

Reserved but not yet written at runtime:

- `ezoin`
- `partnerTransfer`
- `extra`
- `unclear`

### Canonical channels

The app continues to use the configured manual-finance channel list from `sheet-config.json`.

Known aliases include:

- `binance save` -> `Бинанс spot`
- `paypal usd` -> `пейпал дол`
- `paypal eur` -> `пейпал евр`
- `monobank` / `mono` -> `монобанк грн`
- `yandex rub` -> `Яндекс руб`

### Minimal-fix guarantees

- Duplicate wide-table rows with the same `date + category` are merged by channel instead of overwritten during rebuild.
- `exchange` is visible in both analytics surfaces.
- `exchangeUsd` stays derived from rates/transfers and survives rebuild.
- The current snapshot-style `fact` save flow remains unchanged.

## Exchange Handling

### Current minimal-fix behavior

`exchange` can still be represented in the compatibility sheet as one wide-row category:

```text
2026-04-24 | exchange | Яндекс руб=-74669 | Бинанс spot=874
```

That row is now preserved through:

- sheet parse
- range aggregation
- analytics rebuild
- expense-analysis provider view

### Target behavior

In the normalized ledger, exchange must not be stored as one ambiguous row.

Use two linked rows:

```text
1) expense | from_channel=Яндекс руб | amount=-74669 | currency=RUB | category=exchange
2) income  | to_channel=Бинанс spot | amount=874 | currency=USD | category=exchange
```

Both rows should share:

- `exchange_group_id`
- common source metadata
- optional free-text comment

## Target Normalized Ledger

Preferred canonical schema:

```text
date | operation | direction | from_channel | to_channel | amount | currency | amount_usd | category | source | comment
```

Recommended notes:

- `operation`: semantic operation type such as `income`, `expense`, `exchange`, `transfer`
- `direction`: normalized money direction for the row itself
- `from_channel` and `to_channel`: both optional except for transfers/exchanges where they should be explicit
- `amount_usd`: stable analytics amount after conversion
- `source`: `manual_fact`, `paypal`, `wise`, `tdbank`, `ocr`, etc.

## Derived Daily Summary

The compatibility summary should eventually be generated from the normalized ledger:

```text
date | category | channel1 | channel2 | channel3 ...
```

Rules:

- derived only
- never edited as the primary source of truth
- safe to rebuild at any time from normalized rows

## Analytics Contract

The end-state contract should be one of:

1. Analytics reads normalized ledger rows directly.
2. Analytics reads one stable derived daily summary generated from normalized rows.

It should not mix:

- legacy `fact` snapshot rows
- manual wide rows
- ad-hoc client-side inferred columns

## Migration Notes

- The current live fix is intentionally additive and compatibility-first.
- `fact` remains snapshot-oriented until a dedicated normalized-ledger migration is implemented.
- Any future migration should backfill `exchange_group_id` for existing exchange rows where linkage can be inferred safely.

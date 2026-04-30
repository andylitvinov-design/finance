# Manual Ledger Schema

Primary normalized table for the `Расходы` sheet:

`date | operation | from_channel | to_channel | amount | currency | amount_usd | category | comment`

Rules:

- One row = one operation leg.
- `expense`: use `from_channel`, keep `amount` as the local spent amount, set `category` to `business|flat|food|fun|study|travel`.
- `income`: use `to_channel`, keep `amount` as the received amount, set `category` to `serviceIncome`.
- `exchange`: prefer two rows for exact multi-currency analytics.

Recommended exchange storage:

1. Outgoing leg:
   `2026-04-24 | exchange | Яндекс руб | Бинанс spot | -74669 | RUB | -883.0684 | exchange | sell rub`
2. Incoming leg:
   `2026-04-24 | exchange | Яндекс руб | Бинанс spot | 874 | USD | 874 | exchange | buy usd`

Why two rows:

- It preserves both channel balances.
- It keeps per-channel `exchange` netting correct.
- It avoids inventing `to_amount` and `to_currency` columns.

Backward compatibility:

- If the sheet still uses the legacy wide grid, the server falls back to the old parser.
- The API still emits `manual.expenseRows` for the current UI, but now it can also emit `manual.operations` and prebuilt pivots.

# Ledger Data Contract v2

## Goal

Ledger v2 is the canonical in-memory contract for financial operations.

Phase 1 keeps the existing physical Google Sheet Ledger v1 layout intact and
normalizes rows in code, so current URLs, OAuth, imports, and legacy views keep
working.

## Schema

```text
date
operation
from_channel
to_channel
amount
currency
amount_usd
amount_gross
amount_fee
amount_net
rate
category
source
external_id
comment
```

- `date`: operation date in `YYYY-MM-DD`.
- `operation`: `income`, `expense`, `transfer`, `exchange`, or `adjustment`.
- `from_channel`: where money left from. Required for expense, transfer, and exchange.
- `to_channel`: where money arrived. Required for income.
- `amount`: legacy-compatible display amount.
- `currency`: currency for `amount`.
- `amount_usd`: USD equivalent for analytics. For USD rows it follows
  `amount_net` when present, then `amount`.
- `amount_gross`: client-paid or original pre-fee amount.
- `amount_fee`: provider or bank fee, stored as a positive number.
- `amount_net`: amount actually received or spent after fees. Balance must prefer this field.
- `rate`: USD conversion rate when needed.
- `category`: `service`, `ezohata`, `exchange`, `partner`, `business`,
  `personal`, `house`, `food`, `fun`, `travel`, `study`, `adjustment`, or
  `other`.
- `source`: `manual`, `fact`, `paypal`, `monobank`, `td_bank`, `wise`,
  `google_sheets`, `migration`, or `other`.
- `external_id`: provider transaction id or migrated `raw_source_id`.
- `comment`: human-readable note.

## Amount Rules

- Balance uses `amount_net` when it exists.
- If `amount_net` is empty, balance falls back to `amount` and emits warning metadata.
- Client paid display uses `amount_gross`.
- Provider fee display uses `amount_fee`.
- Net received display uses `amount_net`.
- `amount_fee` is always positive; direction comes from `operation` and channels, not from the fee sign.

## Exchange Rules

Preferred exchange representation is two canonical rows with a shared source id or transfer group:

```text
operation=exchange
from_channel=<source>
to_channel=<target>
amount<0
currency=<source>
amount_usd<0
category=exchange

operation=exchange
from_channel=<source>
to_channel=<target>
amount>0
currency=<target>
amount_usd>0
category=exchange
```

The current app still stores Ledger v1 operations as `exchange_out` and
`exchange_in`.

Phase 1 maps those rows to v2 in memory, preserves the existing Sheet layout,
and normalizes `amount_usd` sign so analytics does not lose exchange values.

## Examples

Income with provider fee:

```json
{
  "date": "2026-05-01",
  "operation": "income",
  "from_channel": "Client",
  "to_channel": "пейпал дол",
  "amount": "324",
  "currency": "USD",
  "amount_usd": "311.06",
  "amount_gross": "324",
  "amount_fee": "12.94",
  "amount_net": "311.06",
  "category": "service",
  "source": "paypal",
  "external_id": "TXN-1"
}
```

Expense:

```json
{
  "date": "2026-05-01",
  "operation": "expense",
  "from_channel": "Яндекс руб",
  "amount": "1000",
  "currency": "RUB",
  "amount_usd": "11.82",
  "amount_net": "1000",
  "category": "food",
  "source": "manual"
}
```

Transfer:

```json
{
  "date": "2026-05-01",
  "operation": "transfer",
  "from_channel": "пейпал дол",
  "to_channel": "БАНК КАНАДА cad",
  "amount": "200",
  "currency": "USD",
  "amount_usd": "200",
  "amount_net": "200",
  "category": "other",
  "source": "manual"
}
```

Exchange pair:

```json
[
  {
    "date": "2026-05-01",
    "operation": "exchange",
    "from_channel": "Яндекс руб",
    "to_channel": "Бинанс spot",
    "amount": "-74669",
    "currency": "RUB",
    "amount_usd": "-883.0684",
    "category": "exchange"
  },
  {
    "date": "2026-05-01",
    "operation": "exchange",
    "from_channel": "Яндекс руб",
    "to_channel": "Бинанс spot",
    "amount": "874",
    "currency": "USD",
    "amount_usd": "874",
    "category": "exchange"
  }
]
```

## Migration Notes

- Phase 1 does not rewrite Google Sheet columns.
- Ledger v1 `raw_source_id` maps to v2 `external_id` in memory.
- Ledger v1 categories remain readable and are mapped to v2 categories by the normalizer.
- Existing legacy tabs remain compatibility views.
- A future Sheet migration can add v2 physical columns after live headers are manually verified.

## Known Risks

- Current production Sheet layout still needs manual verification before
  physical v2 columns are added.
- Historical provider rows without fee/net remain fallback rows and should be
  reviewed before using them for final balance.
- Some provider paths may expose gross/fee/net only after credentials are
  configured; code path can exist while live credentials still need
  verification.
- Wise is kept compatible in Phase 1; no destructive provider-specific migration is included.

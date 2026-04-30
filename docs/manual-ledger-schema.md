# Manual Ledger Schema

## Canonical Source

The primary manual-finance source is the `Ledger` sheet in the `EzoHata Manual Inputs` workbook.

Legacy tabs are retained for compatibility and report views:

- `Расходы`: derived wide daily summary, `date | category | channel...`
- `Переводы`: compatibility transfer/rate rows
- `Остатки`: compatibility balance rows
- `Комиссии`: compatibility commission rows
- UI `fact`: legacy editor that now also writes normalized ledger rows

Analytics should prefer `Ledger`. If `Ledger` is missing or empty, the app falls back to the legacy wide tabs.

## Schema

`Ledger` headers:

```text
date | operation | from_channel | to_channel | amount | currency | amount_usd | category | subcategory | direction | comment | raw_source_id | transfer_group_id | created_at | updated_at
```

Allowed `operation` values:

```text
income | expense | exchange_in | exchange_out | partner_transfer | business_expense | personal_expense | correction
```

Allowed `direction` values:

```text
in | out | neutral
```

Validation rules:

- Empty `date`: skip the row and warn.
- Unknown `category`: store as `extra`, preserve the raw value in warning/comment.
- Unknown channel: preserve the raw value and warn.
- Empty or invalid `amount`: skip from sums and warn.
- Missing `amount_usd`: derive only when a defensible rate exists; otherwise keep blank/null.
- Duplicate `raw_source_id`: keep the first imported row and skip duplicates.

## Category Mapping

Canonical categories:

```text
servicein | ezoin | exchange | partner | business | house | food | fun | travel | extra
```

Required aliases:

- `serviceIncome`, `services`, `service income` -> `servicein`
- `ezohata`, `ezofact` -> `ezoin`
- `exchangeUsd`, `exchange_usd`, `exchange_in`, `обмен` -> `exchange`
- `partnerTransfer`, `partner transfer` -> `partner`
- `flat`, `rent`, `квартира`, `дом` -> `house`
- `events`, `beauty`, `развлечения` -> `fun`
- `study`, `travel/study`, `обучение`, `курс` -> `travel`
- `unclear`, `other`, `misc` -> `extra`

Legacy report adapters map canonical categories back to old columns:

```text
servicein -> serviceIncome
house -> flat
travel -> travel
exchange -> exchange
extra -> business fallback until legacy report views add an explicit extra column
```

## Channel Mapping

Canonical channels are the 20 configured manual-finance channels:

```text
Яндекс руб
пейпал дол
пейпал евр
пейпал сad
приват 24-дол
приват 24-евро
приват 24-грн
монобанк грн
трансервайз дол
трансервайз евро
REVOLUT дол
Payoneer - eur
Payoneer - dol
Бинанс spot
binance save
Налично -я-евр
местная валюты
БАНК КАНАДА cad
нал-мам-евро
нал-мам-дол
```

Known aliases include `paypal usd`, `paypal eur`, `paypal cad`, `privat 24 uah`, `mono uah`, `monobank`, `wise usd`, `wise eur`, `binance save`, `binance spot`, `yandex rub`.

## Exchange Model

Exchange is represented by linked ledger rows.

Out row:

```text
operation=exchange_out
direction=out
from_channel=<source channel>
to_channel=<destination channel>
category=exchange
amount=<source amount>
currency=<source currency>
```

In row:

```text
operation=exchange_in
direction=in
from_channel=<source channel>
to_channel=<destination channel>
category=exchange
amount=<received amount>
currency=<received currency>
```

Both rows share `transfer_group_id` or a related `raw_source_id`.

Legacy wide summary may still show:

```text
date | exchange | Яндекс руб=-74669 | Бинанс spot=874
```

That row is derived from the two ledger rows and must not be treated as the source of truth.

## Data Flow

Raw imported transactions:

```text
PayPal / Wise / Binance / bank statements / OCR / manual fact
```

Normalized ledger:

```text
Raw source -> category/channel normalization -> Ledger rows
```

Compatibility views:

```text
Ledger -> Расходы / Переводы / Остатки / Комиссии
```

Analytics:

```text
Ledger-derived daily summary -> Аналитика
Ledger-derived channel/category totals -> Учет расходов / анализ финансов
Legacy fallback only when Ledger is unavailable or empty
```

## Migration

Use the dry-run helper:

```bash
node scripts/migrate-manual-ledger.mjs --expenses legacy-expenses.csv
```

The helper:

- reads an exported legacy wide table
- generates normalized ledger preview rows
- does not write to Google Sheets
- logs created row count, skipped rows, unknown categories, unknown channels, and a sample

No destructive migration is run automatically.

## Risks

- Existing `fact` remains a legacy editor, so its layout still limits what can be entered directly.
- `extra` is canonical in `Ledger`, but old wide report views do not yet have a dedicated `extra` column.
- Provider exchange imports without a destination channel can only create `exchange_out` until the paired in-row is known.
- Historical backfill should be reviewed before writing because old exchange rows may not always identify both sides.

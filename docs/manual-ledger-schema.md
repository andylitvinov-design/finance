# Manual Ledger Schema

## Canonical Source

The primary manual-finance source is the `Ledger` sheet in the `EzoHata Manual Inputs` workbook.

Legacy tabs are retained for compatibility and historical review:

- `Расходы`: historical wide daily summary, `date | category | channel...`; not a runtime source
- `Переводы`: compatibility transfer/rate rows
- `Остатки`: compatibility end-of-day 23:59 provider/manual balance snapshots by `date | channel | currency`
- `Авто Остатки`: provider-collected end-of-day 23:59 balance snapshots and provider status rows
- `Комиссии`: compatibility commission rows
- UI `fact`: legacy editor that now also writes normalized ledger rows

Analytics and Operations use `Ledger` as the only operations source. If `Ledger` is missing or empty, legacy `Расходы` is ignored and the app should surface a warning instead of migrating or falling back during normal runtime.

Balance snapshots in `Остатки`, `Авто Остатки`, and planned balances represent the end-of-day balance at 23:59 local day for the stated date. Same-day Ledger movements are already included in that snapshot and must not be counted again after the snapshot.

## Schema

`Ledger` headers:

```text
date | operation | from_channel | to_channel | amount | currency | amount_usd | category | subcategory | direction | comment | counterparty | description | source | external_id | raw_source_id | transfer_group_id | created_at | updated_at
```

`source` values:

```text
manual | mcp | photo
```

Backward-compatible fallback:

- old Ledger sheets without `source` still load;
- rows with `raw_source_id` prefixed by `migration:` are normalized to `manual`;
- other missing `source` values are treated as empty on the data layer;
- UI displays missing source as `unknown`.

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
- Missing `amount_usd`: derive from explicit row rate, transfer-rate lookup, or fallback rates; UAH rows must not persist blank/null USD.
- Duplicate `external_id` or `raw_source_id`: keep the first imported row and skip duplicates.
- Unknown or missing `source`: keep the row and expose it as `unknown` in UI filters.

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

Both rows share `transfer_group_id`; imported rows should also expose related `external_id`/`raw_source_id` suffixes such as `PB-1:out` and `PB-1:in`.

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
Ledger -> in-memory expenseRows / analytics compatibility views
```

Analytics:

```text
Ledger-derived daily summary -> Аналитика
Ledger-derived channel/category totals -> Учет расходов / анализ финансов
No runtime fallback to Расходы
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

No destructive migration is run automatically. Normal app load/save must not migrate `Расходы` into `Ledger`.

The app can safely self-heal the `Ledger` header when Google write access is available:

- insert `source` between `comment` and `raw_source_id` if the workbook still has the legacy header;
- backfill only blank `source` cells for rows with `raw_source_id` prefixed by `migration:` to `manual`;
- leave all other existing rows unchanged.

## Risks

- Existing `fact` remains a legacy editor, so its layout still limits what can be entered directly.
- `extra` is canonical in `Ledger`, but old wide report views do not yet have a dedicated `extra` column.
- Provider exchange imports without a destination channel can only create `exchange_out` until the paired in-row is known.
- Historical backfill should be reviewed before writing because old exchange rows may not always identify both sides.

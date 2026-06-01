# Единая кнопка автообновления остатков и движений

## Контекст

Сейчас в попапе **«Остатки»** есть кнопка пересчёта, но пользователь не видит полного и честного результата автообновления:

- какие провайдеры реально были опрошены;
- какие операции подтянулись;
- какие остатки обновились;
- где возникла ошибка;
- какие каналы не поддерживаются автоматически;
- какие данные устарели и требуют ручного скриншота/ввода.

Из-за этого остатки могут выглядеть «обновлёнными», хотя часть данных остаётся старой или ручной.

Нужен единый flow:

```text
Нажать кнопку → подтянуть доступные провайдеры → сохранить/обновить остатки → пересчитать сверку → показать отчёт
```

## Цель

Сделать в попапе **«Остатки»** одну рабочую кнопку **«Обновить все остатки»**, которая автоматически подтягивает движения средств и текущие остатки по поддерживаемым провайдерам:

- Wise / TransferWise;
- Binance;
- PayPal.

Если Yandex / Monobank / другие источники уже реализованы и имеют рабочий токен/доступ, их тоже можно включить, но только с явным статусом в отчёте.

## Требуемое поведение кнопки

Кнопка должна запускать backend orchestration, который:

1. Проверяет доступные провайдеры.
2. Подтягивает движения средств, где это реализовано.
3. Подтягивает текущие остатки, где это реализовано.
4. Нормализует полученные данные.
5. Сохраняет/обновляет остатки через существующие safe routes/helpers.
6. Запускает пересчёт balance snapshots, period balance reconciliation, top-card Остатки и popup Остатки.
7. Возвращает structured report для UI.

## Провайдеры в первом scope

Обязательно проверить и подключить в flow:

- Wise / TransferWise
- Binance
- PayPal

Проверить статус и показать в отчёте:

- Yandex
- Monobank
- Payoneer
- Privat24
- Revolut
- Bank Canada
- cash/manual channels

## Backend endpoint

Можно создать новый endpoint:

```text
POST /api/refresh-all-balances
```

или расширить существующий reconcile endpoint, если это безопаснее.

Endpoint должен возвращать structured JSON:

```json
{
  "ok": true,
  "period": { "from": "2026-05-01", "to": "2026-06-01" },
  "providers_checked": ["wise", "binance", "paypal"],
  "balances_pulled": 0,
  "transactions_imported": 0,
  "updated_balance_rows": 0,
  "provider_failures": [],
  "manual_required": [],
  "stale_channels": [],
  "selected_date_total_usd": 0,
  "period_total_usd": 0,
  "warnings": []
}
```

Если provider/API возвращает HTML, plain text или non-JSON ошибку, UI не должен видеть raw `SyntaxError`. Нужно вернуть structured error:

```json
{
  "ok": false,
  "provider": "paypal",
  "status": 401,
  "error": "provider returned non-JSON auth error",
  "excerpt": "short safe excerpt"
}
```

## UI отчёт после нажатия кнопки

После выполнения пользователь должен видеть блок отчёта.

### Успешно обновлено

```text
Wise: операции загружены, остатки обновлены.
Binance: операции загружены, остатки обновлены.
PayPal: операции загружены, остатки обновлены.
```

### Ошибки / требуется действие

```text
Monobank: token/permission error. Нужно обновить токен.
Privat24: автоостаток не реализован. Нужен ручной ввод или скрин.
Revolut: manual only. Нужен скрин.
Bank Canada: manual only. Нужен ручной остаток.
```

Ошибочные, stale и manual-only строки должны быть выделены красным.

## Матрица провайдеров

В отчёте нужно показывать таблицу:

| Channel | Current balance refresh | Transaction import | Token/status | Last import | Last balance | Required action |
|---|---|---|---|---|---|---|

Пример статусов:

- `ok`
- `available`
- `needs_permission`
- `token_missing`
- `not_implemented`
- `manual_only`
- `stale_import`
- `stale_balance`
- `provider_error`

## Ограничения

Не менять:

- Ledger semantics;
- `amount_net`;
- gross/net/fee/source semantics;
- provider transaction meaning;
- secrets/env;
- Google Sheets напрямую без existing safe route/helper.

Не делать fake FX. Если курс, остаток или source недоступен — показывать `needs verification`.

## Acceptance criteria

Готово, если:

1. В попапе **«Остатки»** есть кнопка **«Обновить все остатки»**.
2. По нажатию кнопка реально запускает backend refresh-flow.
3. Wise, Binance и PayPal проверяются и обрабатываются, если доступны.
4. После refresh запускается пересчёт balance snapshots и period reconciliation.
5. Top-card **«Остатки»** и popup primary total используют один canonical total.
6. UI показывает отчёт: что успешно подтянулось, что не подтянулось, почему и что требует ручного действия.
7. Unsupported/manual/stale каналы подсвечиваются красным.
8. Ошибка одного провайдера не ломает весь refresh-flow.
9. Provider non-JSON/plain-text errors превращаются в structured JSON.
10. Tests проходят.

## Regression tests

Добавить тесты:

1. Provider success case: Wise/Binance/PayPal успешно возвращают данные, refresh result содержит `transactions_imported`, `balances_pulled`.
2. Provider failure case: один провайдер падает, остальные продолжают выполняться, UI получает structured warning.
3. Non-JSON provider error: provider вернул HTML/plain text, API возвращает structured error, не raw SyntaxError.
4. Unsupported/manual channel: Revolut / Bank Canada / Privat24 current balance not implemented, UI показывает красное manual/stale предупреждение.
5. Reconciliation after refresh: selected-date total и period total пересчитаны, top-card Остатки обновлён.

## Commands

```bash
node --test tests/balance-snapshots-api.test.mjs
node --test tests/remainders-summary-popup.test.cjs
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build
```

После merge/deploy:

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
npm run verify:production -- <new-main-sha>
```

## Output required from implementation

В финальном отчёте указать:

- root cause / current failing layer;
- какие providers реально поддерживаются;
- какие providers вызываются кнопкой;
- changed files/functions;
- tests/checks;
- live SHA before/after;
- deploy URL;
- пример refresh report;
- remaining unsupported/manual channels;
- risks.

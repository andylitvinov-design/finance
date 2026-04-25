# EzoHata Incoming Ledger

Веб-приложение для учёта входящих платежей, расходов и балансов по каналам.

Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## Стек

- Чистый HTML/CSS/JS (без фреймворков)
- Google Sheets API (через OAuth2, токен в памяти браузера)
- xlsx.js для экспорта
- Vercel для хостинга
- Vercel `/api` serverless endpoint для dashboard fallback/proxy

## Файловая структура

| Файл | Назначение |
|------|-----------|
| `index.html` | HTML-разметка, подключение стилей и скриптов |
| `style.css` | Все стили, CSS-переменные, адаптив |
| `config.js` | Константы и настройки, используемые клиентским кодом |
| `state.js` | Глобальные объекты `state` и `elements` |
| `google-auth.js` | Google OAuth: connect/disconnect, токены |
| `google-sheets.js` | Чтение и запись листов Google Sheets |
| `finance.js` | Расчёты курсов валют, балансов, сумм |
| `orders.js` | Вкладка "Мои заказы" |
| `ui.js` | Рендер таблиц, вкладок, метрик |
| `export.js` | Экспорт в CSV / XLSX / TSV |
| `main.js` | Точка входа, `init()`, слушатели событий |
| `sheet-config.json` | Runtime config: app version, endpoint, OAuth, spreadsheet IDs, tabs |
| `api/index.js` | Vercel API endpoint для dashboard data и snapshot fallback |
| `analytics-payouts-helper.js` | Вспомогательная логика аналитики выплат |
| `manual-finance-formulas.js` | Формулы ручных финансов |
| `orders-helper.js` | Вспомогательная логика заказов |

## Google Sheets

Проект работает с двумя Google Spreadsheets:

**1. Основная таблица (аналитика + snapshot)**

- URL задаётся через `sheet-config.json`, интерфейс или URL-параметр
- Содержит лист `MANUAL_INPUTS_IMPORT` для синхронизации fact

**2. Таблица ручных данных (fact, расходы, переводы)**

- URL: см. `MOVEMENT_SOURCE_SPREADSHEET_FALLBACK_URL` в `config.js`
- Листы: `fact`, `расходы по каналам`, `Переводы`, `Расходы`, `Комиссии`, `Мои заказы`
- Структура листов: даты в формате `YYYY-MM-DD ~ YYYY-MM-DD` как имена листов

## Настройка (для Claude / Codex)

Основные изменяемые параметры находятся в `config.js`:

- Курсы валют → `MANUAL_FINANCE_FALLBACK_USD_RATES`
- Каналы оплаты → `MANUAL_FINANCE_MONEY_CHANNELS`
- Имена листов → константы `MANUAL_*_TITLE`
- URL основной таблицы → `MOVEMENT_SOURCE_SPREADSHEET_FALLBACK_URL`

Runtime-параметры окружения остаются в `sheet-config.json`:

- OAuth client ID и разрешённые origins
- `/api` endpoint
- Spreadsheet IDs
- Набор dashboard tabs

## Деплой

Production деплоится из GitHub через Vercel Git Integration после merge в `main`.

```bash
git add .
git commit -m "описание изменений"
git push origin main
# Vercel автоматически задеплоит на ezohata-incoming-ledger.vercel.app
```

Для рабочих изменений используйте ветку и PR, затем merge в `main`.

## Версия

Версия интерфейса хранится в `APP_BUILD_VERSION` в `config.js`.
Формат: `YYYY.MM.DD.HH` — обновлять вручную при каждом релизе.

`sheet-config.json` также содержит `appVersion`, который отображается в dashboard status.

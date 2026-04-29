# EzoHata Incoming Ledger

Веб-приложение для учёта входящих платежей, расходов, факта и аналитики по каналам EzoHata.

Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## Canonical Repository

- canonical repo: [andylitvinov-design/finance](https://github.com/andylitvinov-design/finance)
- legacy read-only repo: [andylitvinov-design/ezohata-incoming-ledger](https://github.com/andylitvinov-design/ezohata-incoming-ledger)
- deploy source of truth: root of this repository

Не использовать `reconcile-v2/` как отдельный source root. Эта ветка миграции закрыта; production-коммиты, PR и деплои идут только из `finance`.

## Stack

- static HTML/CSS/JS frontend in repo root
- Google Sheets API via browser OAuth
- Vercel hosting
- Vercel `api/` functions for dashboard fallback/proxy and statement imports
- node built-in test runner for regression coverage

## Repository Layout

| Path | Purpose |
|------|---------|
| `index.html` | main UI shell |
| `style.css` | styles and responsive layout |
| `config.js` | frontend constants and spreadsheet defaults |
| `main.js` | app bootstrap and runtime orchestration |
| `finance.js` | balances, analytics, totals, provider calculations |
| `orders.js` / `orders-helper.js` | orders tab and summaries |
| `ui.js` | rendering, tabs, metrics, expense analysis |
| `google-auth.js` / `google-sheets.js` | Google OAuth and Sheets I/O |
| `sheet-config.json` | runtime app config, endpoint, OAuth client metadata |
| `sheet-snapshot.json` | snapshot fallback for standard tabs |
| `api/` | Vercel serverless routes |
| `tests/` | node regression tests |
| `scripts/build-check.mjs` | static bundle validation for `npm run build` |
| `scripts/release-guard.sh` | release safety guard before push/PR |

## Local Validation

This repo now exposes a minimal npm wrapper without changing the static architecture:

```bash
npm install
npm test
npm run build
npm run release-guard
```

- `npm test` runs `node --test tests/*.test.*`
- `npm run build` validates the static bundle, required JSON files, and local asset references
- `npm run release-guard` checks remote safety, branch ancestry, clean tree, and legacy-source regressions

## Google Sheets Model

Проект работает с двумя Google Spreadsheets:

1. Основная таблица для аналитики и snapshot.
2. Таблица ручных данных для `fact`, `Расходы`, `Остатки`, `Переводы`, `Комиссии`, `Мои заказы`.

Основные runtime-настройки остаются в `sheet-config.json`:

- OAuth client ID and allowed origins
- dashboard `/api` endpoint
- spreadsheet IDs
- visible dashboard tabs

Константы бизнес-логики остаются в `config.js`, включая каналы, fallback rates и sheet titles.

## Provider Integrations

`Учет расходов` uses Vercel API routes:

- `/api/paypal-transactions`
- `/api/wise-transactions`
- `/api/expense-screenshots`

Required or optional deploy env vars are listed in [.env.example](/Users/andriilitvinov/projects/MYPROJECTS/finance/.env.example).

Current env inventory:

- `EZOHATA_V2_APPS_SCRIPT_URL`
- `EZOHATA_LEGACY_MANUAL_FINANCE_URL`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT`
- `PAYPAL_MCP_CLIENT_ID`
- `PAYPAL_MCP_REFRESH_TOKEN`
- `WISE_API_TOKEN`
- `WISE_PROFILE_ID`
- `WISE_API_BASE`
- `OPENAI_API_KEY`
- `OPENAI_EXPENSE_MODEL`

PayPal live app setup:
[PayPal Live Apps & Credentials](https://developer.paypal.com/dashboard/applications/live)

## Deploy Flow

Production must be wired to GitHub integration from `andylitvinov-design/finance`.

Standard flow:

```bash
git switch -c codex/my-change origin/main
git add .
git commit -m "describe change"
npm test
npm run build
npm run release-guard
git push -u origin codex/my-change
gh pr create --base main --head codex/my-change
```

Rules:

- do not push normal changes directly to `origin/main`
- `old-origin` is read-only fallback only
- if `origin/main` is not created yet during bootstrap, release guard temporarily falls back to `old-origin/main`

## Versioning

- UI build version is stored in `APP_BUILD_VERSION` in `config.js`
- `sheet-config.json` stores `appVersion` shown in the dashboard status

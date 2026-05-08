# EzoHata Incoming Ledger

Веб-приложение для учёта входящих платежей, расходов, факта и аналитики по каналам EzoHata.

Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## Canonical Repository

- canonical repo: [andylitvinov-design/finance](https://github.com/andylitvinov-design/finance)
- deploy source of truth: root of this repository, Vercel project `ezohata-incoming-ledger`, branch `main`

Не использовать `reconcile-v2/` как отдельный source root. Эта ветка миграции закрыта; production-коммиты, PR и деплои идут только из `finance`.
This repository is the single source of truth for ezohata-incoming-ledger production.
The older [andylitvinov-design/ezohata-incoming-ledger](https://github.com/andylitvinov-design/ezohata-incoming-ledger) repository is a stale migration artifact unless an explicit repo migration task says otherwise. Do not patch or deploy it for production bug fixes.

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
npm run migration:check
npm test
npm run build
npm run release-guard
```

- `npm test` runs `node --test tests/*.test.*`
- `npm run build` validates the static bundle, required JSON files, and local asset references
- `npm run migration:check` verifies the Git remote and Vercel project lock
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
- `/api/monobank-transactions`
- `/api/privatbank-transactions`
- `/api/yoomoney-transactions`
- `/api/expense-screenshots`

Required or optional deploy env vars are listed in [.env.example](/Users/andriilitvinov/projects/MYPROJECTS/finance/.env.example).
Production env checklist and manual Google OAuth verification steps are documented in [docs/env.md](/Users/andriilitvinov/projects/MYPROJECTS/finance/docs/env.md).

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
- `MONOBANK_API_TOKEN`
- `MONOBANK_ACCOUNT_ID`
- `MONOBANK_API_BASE`
- `PRIVATBANK_STATEMENT_URL`
- `PRIVATBANK_API_TOKEN`
- `PRIVATBANK_ACCOUNT_ID`
- `YOOMONEY_ACCESS_TOKEN`
- `YOOMONEY_CLIENT_ID`
- `YOOMONEY_CLIENT_SECRET`
- `YOOMONEY_REDIRECT_URI`
- `YOOMONEY_API_BASE`
- `YOOMONEY_CURRENCY`
- `OPENAI_API_KEY`
- `OPENAI_EXPENSE_MODEL`

Operational notes:

- `EZOHATA_V2_APPS_SCRIPT_URL` remains the primary server-side upstream for dashboard data.
- `/api/legacy` is retained only as a deprecated compatibility proxy. The current root frontend does not call `/api/legacy`; `fact` and `orders` use browser Google OAuth plus direct Sheets access.
- `OPENAI_API_KEY` enables server-side OCR for `/api/expense-screenshots`, but expense screenshots still work without it because the UI falls back to browser OCR.

PayPal live app setup:
[PayPal Live Apps & Credentials](https://developer.paypal.com/dashboard/applications/live)

Monobank personal API setup:
[Monobank API cabinet](https://api.monobank.ua/)

Current Monobank flow:
- `Учет расходов -> Подключить Monobank`
- paste personal token
- validate via `/api/monobank-transactions` -> `/personal/client-info`
- choose a masked account or import all found accounts
- run `Подтянуть Mono` for a period up to 31 days

Limitation:
- this is a temporary personal-token flow, not a persisted OAuth/link integration; token is kept only in page memory for the current session

PrivatBank setup depends on the enabled account product. Use `PRIVATBANK_STATEMENT_URL` for the JSON statement endpoint issued by Privat24 Business/Open Banking/AutoClient and keep the token in `PRIVATBANK_API_TOKEN`.

YooMoney wallet OAuth setup:
[YooMoney wallet authorization docs](https://yoomoney.ru/docs/wallet/using-api/authorization/request-access-token)

Use YooMoney wallet API for `/api/yoomoney-transactions`; do not replace it with YooKassa business API.

## Deploy Flow

Production must be wired to GitHub integration from `andylitvinov-design/finance`.
The canonical Vercel project is `ezohata-incoming-ledger`; `ezohata-incoming-ledger.vercel.app` is the production alias.

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
- legacy repos and deploy projects are deprecated read-only references only
- release guard requires `origin/main` from `andylitvinov-design/finance`

Post-merge production verification:

```bash
git fetch origin
EXPECTED_SHA="$(git rev-parse origin/main)"
node scripts/verify-production.mjs "$EXPECTED_SHA"
```

Check this in order after merge to `main`:

- GitHub Actions: `Production Observability` must start on the merge push and finish green
- live commit: `/api/status` must return `commitSha == origin/main`
- deploy metadata: `/api/status` must return `buildTime`, `deploymentEnvironment`, `appVersion`, `appBuildVersion`
- smoke test: `/api/index?health=1` must return `ok: true`

Useful URLs:

- production app: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)
- production status: [https://ezohata-incoming-ledger.vercel.app/api/status](https://ezohata-incoming-ledger.vercel.app/api/status)
- production health: [https://ezohata-incoming-ledger.vercel.app/api/index?health=1](https://ezohata-incoming-ledger.vercel.app/api/index?health=1)

## Versioning

- release version is stored in `package.json` and `sheet-config.json`
- UI build marker is stored in `APP_BUILD_VERSION` in `config.js`

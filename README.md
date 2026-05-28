# EzoHata Incoming Ledger

Веб-приложение для учёта входящих платежей, расходов, факта и аналитики по каналам EzoHata.

Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

Production redeploy trigger: 2026-05-29 after PR #483 canonical Остатки order merge.

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

## Hermes task packets

Hermes-created draft PRs can start with only a task packet in `.hermes/tasks/*.md`.
That draft PR is a handoff package, not the final feature or fix. Do not merge it
as-is just because the task packet exists.

The executor, usually Codex, must read the packet, complete the real change on
the same PR branch, run the appropriate checks, and update the existing PR. Keep
the `.hermes/tasks/*.md` file as the audit trail for what Hermes requested.

Hermes-controlled task PRs must not push to `main`, auto-merge, auto-deploy,
change secrets or env values, or apply data repair.

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

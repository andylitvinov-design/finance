# SAFE.md — ezohata-incoming-ledger / finance

Last verified date: 2026-06-28

This file is a compact repo-level safety map for `/safe` sweeps. It lists environment variable names only and must never contain real values.

## Project boundary

- Project name: ezohata-incoming-ledger / finance
- Canonical repo: `andylitvinov-design/finance`
- Live URL: https://ezohata-incoming-ledger.vercel.app
- Hosting: Vercel
- Production branch/source: branch based on `origin/main`; exact deployed SHA needs verification
- Deprecated source: `andylitvinov-design/ezohata-incoming-ledger` is not production unless an explicit migration is verified
- Do not use `reconcile-v2/` as a new production source
- Project memory: `ai-projects-brain/projects/ezohata-incoming-ledger/PROJECT.md`

## Main public and private surface

| Surface | Path / endpoint | Access | Main risk | Notes |
| --- | --- | --- | --- | --- |
| Ledger UI | `/` | expected owner/private workflow | misleading balances/tables | Check loading, stale data, formatting, and reconciliation. |
| Google OAuth / Sheets | `google-auth.js`, `google-sheets.js` | owner OAuth | token/data boundary | Never log credentials or private sheet data. |
| PayPal import | `api/paypal-transactions.js` | server env required | provider data/cost/logging | Return only needed fields and safe errors. |
| Wise import | `api/wise-transactions.js` | server env required | provider data/cost/logging | Return only needed fields and safe errors. |
| OCR/AI expense flow | related API/scripts | server env required | paid API cost | Rate/size/usage guards need verification. |
| Release guard | `scripts/release-guard.sh` | CI/local | production source safety | Run before PR completion. |

## Environment variable names

| Env name | Browser-safe? | Purpose | Notes |
| --- | --- | --- | --- |
| `EZOHATA_V2_APPS_SCRIPT_URL` | no | Apps Script integration | value never stored |
| `EZOHATA_LEGACY_MANUAL_FINANCE_URL` | no | legacy/manual finance source | value never stored |
| `PAYPAL_CLIENT_ID` | no | PayPal API | value never stored |
| `PAYPAL_CLIENT_SECRET` | no | PayPal API | value never stored |
| `PAYPAL_ENVIRONMENT` | no | PayPal mode | name only |
| `PAYPAL_MCP_CLIENT_ID` | no | PayPal MCP | value never stored |
| `PAYPAL_MCP_REFRESH_TOKEN` | no | PayPal MCP | value never stored |
| `WISE_API_TOKEN` | no | Wise API | value never stored |
| `WISE_PROFILE_ID` | no | Wise profile | value never stored |
| `WISE_API_BASE` | no | Wise API base | value never stored |
| `OPENAI_API_KEY` | no | AI/OCR expense helper | paid API; value never stored |
| `OPENAI_EXPENSE_MODEL` | no | AI/OCR model name | value not stored here |

## Finance-specific safety rules

- Prove production source before changing formulas or UI logic.
- Do not patch formulas during `/audit-fin`; diagnose first.
- Do not modify production financial data during `/safe` or `/audit-fin`.
- Do not invent missing financial values.
- Do not treat missing data as zero unless the product rules explicitly say so.
- Do not hide real calculation/data errors behind empty UI states.
- Keep `sheet-config.json` and release version aligned when shipping UI/data changes.

## Frontend UX smoke checks

```text
- Open live root and verify the app is not blank.
- Check mobile and desktop table/card readability.
- Refresh after data loads and use browser back/forward if routes exist.
- Verify loading, empty, error, and stale-data states are not misleading.
- Check table totals, balance cards, provider/channel breakdowns, and chart/table/card consistency.
- Submit/import actions must be disabled or guarded during in-flight requests.
- Error messages must be safe and must not show raw provider payloads, tokens, stack traces, or private sheet data.
```

## Data and provider checks

- Provider imports: verify server-only credentials, safe logs, explicit returned fields, and retry limits.
- Google Sheets: verify OAuth boundary and no token logging.
- Balance checks: compare visible numbers with machine-readable/debug evidence when available.
- Date/currency/rounding: verify timezone boundaries, precision, signs, fees, transfers, payouts, `Остатки`, `Расходы`, `СТАЛО`, and `now` semantics before changes.
- Live provider sync: separate `code path exists`, `env names documented`, `credentials configured`, and `live sync verified`.

## Headers / browser baseline

- CSP or CSP plan: needs verification.
- X-Content-Type-Options: needs verification.
- Referrer-Policy: needs verification.
- Permissions-Policy: needs verification.
- Frame protection: needs verification.
- CORS policy: provider/API routes need verification.
- HSTS status: needs live verification before claiming.

## Verification commands

```bash
npm test
npm run build
npm run release-guard
npm run smoke:live
npm run deploy:verify
```

## Observability / rollback / backup

- Logs: Vercel function logs and browser console.
- Health check: live root, `npm run smoke:live`, `npm run verify:production` / `npm run deploy:verify`.
- Rollback: Vercel previous deployment or revert main commit; exact last-good deploy needs verification.
- Backup/export: Google Sheets/provider data backup status needs verification before risky finance work.
- Incident owner: Andrey.

## Last `/safe` result

- Date: 2026-06-28
- Routes selected: Vercel API/frontend, finance/provider import, paid API cost, frontend data display, headers, rollback/backup.
- Critical/high findings: none proven in this pass.
- Fix applied: repo-level safety map added.
- Checks run: project memory, `AGENTS.md`, and package scripts review.
- Checks not run: tests/build/release-guard, live smoke, provider/OAuth/authenticated flows, browser visual check.
- Live verified: needs verification.
- Next action: run tests/build/release-guard and live read-only smoke before merge/deploy.

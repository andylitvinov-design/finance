# SAFE.md — ezohata-incoming-ledger / finance

Last verified date: 2026-09-20

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
| `FINANCE_DASHBOARD_ACCESS_TOKEN` | no | owner-only HTTP access gate | required in every deployed environment; value never stored |\n| `EZOHATA_V2_APPS_SCRIPT_URL` | no | Apps Script integration | value never stored |
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

- Owner access gate: `middleware.mjs` must cover every static and API route; missing `FINANCE_DASHBOARD_ACCESS_TOKEN` must fail closed with `503`.\n- CSP or CSP plan: needs verification.
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

- Date: 2026-09-20
- Routes selected: Vercel all-route middleware, public root/API exposure, provider/finance boundaries, frontend error state, rollback/backup.
- Critical finding: unauthenticated production root rendered client-identifying service records and financial rows.
- Fix prepared: fail-closed owner Basic-auth gate for every route on `codex/safe-private-ledger-gate-20260920`; no secret value is stored.
- Checks run: clean desktop live smoke; anonymous root/API evidence; focused access-gate tests (5/5).
- Checks not run: authenticated preview, full repository tests/build/release-guard, provider/OAuth flows, production deploy verification.
- Live verified: vulnerable before state confirmed; fix is not live until reviewed, configured, merged, deployed, and anonymously rechecked.
- Rollback: close/revert the isolated gate PR or promote the previous Vercel deployment. No data/schema backup is required for this code-only guard.
- Next action: configure `FINANCE_DASHBOARD_ACCESS_TOKEN` in preview only, verify anonymous `401` and authorized owner access, then review for production rollout.

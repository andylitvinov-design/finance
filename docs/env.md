# Production Env Checklist

Production app: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## What Is Required

Required for the main incoming-ledger flow:

- `EZOHATA_V2_APPS_SCRIPT_URL`
  Server dashboard upstream used by `/api`.

Required only when the corresponding provider import is used:

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`
  Primary PayPal REST credentials for `/api/paypal-transactions`.
- `WISE_API_TOKEN`
  Wise statement/balance access for `/api/wise-transactions`.
- `YOOMONEY_ACCESS_TOKEN`
  YooMoney wallet token with `operation-history` scope for `/api/yoomoney-transactions`.

## Optional

- `PAYPAL_ENVIRONMENT`
  Defaults to `live`.
- `PAYPAL_MCP_CLIENT_ID`
- `PAYPAL_MCP_REFRESH_TOKEN`
  PayPal fallback path when REST credentials are unavailable or invalid.
- `WISE_PROFILE_ID`
  Optional if the token can access only one usable Wise profile.
- `WISE_API_BASE`
  Defaults to `https://api.wise.com`.
- `YOOMONEY_CLIENT_ID`
- `YOOMONEY_CLIENT_SECRET`
- `YOOMONEY_REDIRECT_URI`
  Optional OAuth exchange settings if a short-lived authorization code is used instead of a pre-provisioned `YOOMONEY_ACCESS_TOKEN`.
- `YOOMONEY_API_BASE`
  Defaults to `https://yoomoney.ru`.
- `YOOMONEY_CURRENCY`
  Defaults to `RUB`; YooMoney wallet `operation-history` does not always include a per-operation currency field.

YooMoney notes:

- Use the YooMoney wallet API, not YooKassa business API.
- Required OAuth scope: `operation-history`.
- Official authorization docs: [YooMoney wallet authorization](https://yoomoney.ru/docs/wallet/using-api/authorization/request-access-token)
- Official history method docs: [operation-history](https://yoomoney.ru/docs/wallet/user-account/operation-history)

## OCR

- `OPENAI_API_KEY`
  Enables server-side OCR in `/api/expense-screenshots`.
- `OPENAI_EXPENSE_MODEL`
  Optional model override for OCR.

OCR is not critical for the core ledger flow. If `OPENAI_API_KEY` is missing, `api/expense-screenshots.js` returns `source: "browser-ocr-required"` and the frontend falls back to browser OCR in `ui.js`. Keep the fallback as-is unless OCR quality becomes a product requirement.

## Legacy

- `EZOHATA_LEGACY_MANUAL_FINANCE_URL`
  Deprecated compatibility env for `/api/legacy`.

Current repo status:

- `api/legacy.js` still exists and exposes `listManualSheetDates`, `getManualSheet`, and `saveManualSheet`.
- The current root frontend does not call `/api/legacy`.
- `fact` and `orders` now use browser Google OAuth and direct Google Sheets access instead.

Safe decision:

- Do not delete `/api/legacy` yet.
- Treat it as deprecated until an external consumer explicitly confirms it still depends on this route.
- If health-only checks keep returning `configured: false`, that is not a production blocker for the main app.

If legacy proxy must remain active, `EZOHATA_LEGACY_MANUAL_FINANCE_URL` should be the previous manual-finance Apps Script Web App `/exec` URL that accepts:

- `listManualSheetDates`
- `getManualSheet`
- `saveManualSheet`

Do not invent a new value. Take it from one of these sources:

1. Previous Vercel project env for the old deployment.
2. The older checkout or deployment notes where the manual-finance Apps Script URL was pasted.
3. The Google Apps Script Web App deployment that previously backed manual fact saves.

## Manual Google OAuth Check

The current app uses Google Identity Services token flow in the browser. There is no app-side callback route to configure in this repo. The critical setting is the allowed JavaScript origin for the OAuth client.

Current configured origin list in `sheet-config.json`:

- `https://ezohata-incoming-ledger.vercel.app`
- `https://reconcile-v2-eight.vercel.app`

### Browser Steps

1. Open [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app).
2. Open the `fact` tab.
3. Confirm the Google status text says `OAuth configured for https://ezohata-incoming-ledger.vercel.app`.
4. Click `Подключить Google`.
5. Complete the Google account consent popup.
6. Wait for the button state to change to `Google подключен`.
7. Confirm `fact` data loads instead of showing the connect prompt.
8. Repeat on `orders` if that flow must also be verified.

### Success Result

Successful manual verification looks like this:

- Consent popup opens on Google.
- No OAuth error is shown after consent.
- The app status changes to `Google подключен...`.
- `fact` and `orders` can read the manual spreadsheet for the selected period.

### Errors That Mean Config Is Wrong

- `origin_mismatch`
  The production origin is missing from the Google OAuth client's Authorized JavaScript origins.
- `idpiframe_initialization_failed`
  Usually a bad Google Identity Services origin setup, blocked third-party cookies, or a browser policy issue.
- `redirect_uri_mismatch`
  Usually means the wrong OAuth client type was used in Google Cloud Console, or a non-browser OAuth flow was configured instead of a Web application client.

If any of those appear, compare Google Cloud Console against production:

- Authorized JavaScript origin must include exactly `https://ezohata-incoming-ledger.vercel.app`
- OAuth client must be a Web application client
- The same client ID must be present in `sheet-config.json`

## Post-Env Verification

After adding or adjusting envs in Vercel production:

1. Open `/api?health=1` on production and confirm the main API is healthy.
2. If `EZOHATA_LEGACY_MANUAL_FINANCE_URL` was intentionally added, open `/api/legacy?health=1` and expect `configured: true`.
3. If `YOOMONEY_ACCESS_TOKEN` was added, open `Учет расходов`, select a period, click `Подтянуть ЮMoney`, and confirm the monthly provider block appears with RUB income/expense totals.
4. If `OPENAI_API_KEY` was added, upload a screenshot in `Учет расходов` and confirm the response no longer falls back to browser OCR by default.
5. Manually run the Google OAuth flow from the production app as described above.

# EzoHata Incoming Ledger

Separate online project for the incoming-data repository flow.

Current saved release: `3.0.5`

This is the only active incoming-ledger implementation. The old repo-root and `data/` Vercel deployment configs are archived and must not be used.

Production URL:

- [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## Purpose

- keep legacy `data/` dashboard untouched
- provide a clearer incoming-data dashboard with one manual input tab
- save `Переводы` and `Расходы` directly to Google Sheets from the browser
- keep one cumulative repository and replace only the selected date range on save
- read `analytics` from the live `/api?action=getDashboardData` endpoint when available
- build the first analytics section from range-based aggregation of the incoming repository, with snapshot-only fallback

## Files

- `index.html` - incoming ledger UI
- `sheet-config.json` - client-side config, including Google OAuth client id and optional dashboard `endpoint`
- `sheet-snapshot.json` - read-only snapshot for standard tabs

## Google setup

The incoming ledger flow no longer depends on Apps Script period tabs. It uses:

- Google Identity Services token flow
- direct Google Sheets API calls from the browser

You must set `googleAuth.clientId` in `sheet-config.json`.

For this deployed Vercel UI, the OAuth client must allow the active site origin under `Authorized JavaScript origins`.

Current origins that matter:

- `https://ezohata-incoming-ledger.vercel.app`
- `https://reconcile-v2-eight.vercel.app`

If Google shows `Error 400: redirect_uri_mismatch`, the browser flow is healthy but the OAuth client does not yet allow the current site origin. Add the origin in Google Cloud Console for client `244809429378-piep9u8ekm1t8q2ffstpq88kr2v8jrnc.apps.googleusercontent.com`.

Official docs:

- [Using the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Sheets JavaScript quickstart](https://developers.google.com/sheets/api/quickstart/js)

## Deployment

Deploy this folder as a separate Vercel project, for example `ezohata-incoming-ledger`:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/ezohata/reconcile-v2
vercel --prod
```

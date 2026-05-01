# Production Verification

Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

## Alias and Project

Run from the repository root:

```bash
cat .vercel/project.json
vercel project ls | rg 'ezohata-incoming-ledger'
curl -fsS https://ezohata-incoming-ledger.vercel.app/api/status
```

The expected Vercel project is `ezohata-incoming-ledger`. The status payload must report:

- `service: "ezohata-incoming-ledger"`
- `vercelProjectName: "ezohata-incoming-ledger"` after the status update is deployed
- `vercel.productionUrl: "ezohata-incoming-ledger.vercel.app"`

## Production Env

Check only names, not values:

```bash
vercel env ls production
```

Required Production variables:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

The private key value must be a service-account PEM. If stored on one line, escaped `\n` sequences are valid and the runtime converts them to real newlines. The normalized value must start with `-----BEGIN PRIVATE KEY-----` and end with `-----END PRIVATE KEY-----`.

If an env var name itself looks like secret material, inspect it in Vercel and remove it only after confirming it is accidental.

## Google Sheet Access

Spreadsheet id: `1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY`

The service account from `GOOGLE_SERVICE_ACCOUNT_EMAIL` must have Viewer or Editor access to the spreadsheet.

Primary check:

```bash
curl -fsS https://ezohata-incoming-ledger.vercel.app/api/status
```

Expected Google fields:

- `hasGoogleServiceAccountEmail: true`
- `hasGoogleServiceAccountPrivateKey: true`
- `googleSheetConfigured: true`
- `googleSheetReadOk: true`
- `googleSheetReadError: null`

Temporary gated debug check:

```bash
vercel env add ENABLE_DEBUG_GOOGLE production
curl -fsS https://ezohata-incoming-ledger.vercel.app/api/debug-google
```

Set `ENABLE_DEBUG_GOOGLE` to `1` only for the diagnostic window. Remove or change it after verification. The endpoint must never expose the private key, access token, service-account email, or raw sheet rows.

## Stale Deploy

After merging to `main`:

```bash
git fetch origin
npm run verify:live -- "$(git rev-parse origin/main)"
```

If this fails with a commit mismatch, compare `/api/status.commitSha` with `origin/main`. A mismatch means the production alias is still serving an older deploy or points at the wrong deployment.

## `ledger_rows = 0`

Treat `ledger_rows = 0` as a critical production failure even when `fallback_amount_rows = 0`.

Check in order:

1. `/api/status.googleSheetReadOk` is `true`.
2. `/api/status.googleSheetReadError` is `null`.
3. `/api/audit-snapshot.warnings` does not include Google Sheets or service-account access warnings.
4. The service account has spreadsheet access.
5. The `Ledger` sheet has the expected normalized rows.

Expected current audit contract:

```bash
curl -fsS https://ezohata-incoming-ledger.vercel.app/api/audit-snapshot
```

- `summary.ledger_rows = 26`
- `balances.fallback_amount_rows = 0`
- `exchange.compatibility_mode = false`

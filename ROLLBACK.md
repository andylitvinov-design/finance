# Rollback

## Primary rollback path

1. Create a rollback branch from `origin/main`.
2. Revert the bad merge or commit on that branch.
3. Open a PR back into `main`.
4. If production must recover immediately, redeploy the last known-good Vercel deployment before merging the rollback PR.

## Known good references

- `deploy/ezohata-incoming-ledger-20260428-7e7401d`
- `deploy/ezohata-incoming-ledger-20260428-85319ef`
- `rollback/pre-finance-providers-20260428`

## Legacy fallback

- Deprecated repositories remain available for history lookup only.
- Do not restore deploy integration back to any deprecated repository unless the finance repo is unavailable.

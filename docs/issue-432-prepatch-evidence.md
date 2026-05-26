# Issue 432 Pre-Patch Evidence

Date: 2026-05-26

## Production state

- `/api/status`: HTTP 200 JSON, `status=ok`, `commitSha=8e023a97dbae3a0c4542cb4255bbbea419f52215`, `commitRef=main`, `gitRepoSlug=andylitvinov-design/finance`.
- `/api/audit-snapshot?period=2026-04`: HTTP 200 JSON, `ok=true`; balance summary exposes `uses_amount_net`, manual/auto/merged balance row counters, and remainders rows.
- `/api/debug-ui-state?period=2026-04`: HTTP 200 JSON, `ok=true`; deploy block matches `main` production metadata.

## Live balance snapshot evidence

- `/api/balance-snapshots?from=2026-04-01&to=2026-04-30`: HTTP 200 JSON, `ok=true`.
  - `total_rows=34`, `valid_rows=34`, `manual_balance_snapshot_rows_loaded=34`, `auto_balance_snapshot_rows_loaded=0`, `merged_balance_snapshot_rows_loaded=34`.
  - Manual dates: `2026-04-02`, `2026-04-24` through `2026-04-30`.
  - Missing daily coverage dates: `2026-04-01`, `2026-04-03` through `2026-04-23`.
  - Selected balance date: `2026-04-30`.
- `/api/balance-snapshots?from=2026-06-01&to=2026-06-30`: HTTP 200 JSON, `ok=true`.
  - `total_rows=0`, `valid_rows=0`, `manual_balance_snapshot_rows_loaded=0`, `auto_balance_snapshot_rows_loaded=0`, `merged_balance_snapshot_rows_loaded=0`.
  - Missing daily coverage dates: every date from `2026-06-01` through `2026-06-30`.

## Live backfill route evidence

- `/api/backfill-daily-balance-snapshots?from=2026-04-01&to=2026-04-30`: HTTP 400, `error=may_2026_window_required`.
- `/api/backfill-daily-balance-snapshots?from=2026-05-01&to=2026-05-31`: HTTP 200 dry-run, `planned_rows_count=7`, `missing_anchors_count=0`, `route_guard.may_2026_only=true`.
- `/api/backfill-daily-balance-snapshots?from=2026-06-01&to=2026-06-30`: HTTP 400, `error=may_2026_window_required`.

## Recent related changes

- PR #427: selected-date balance snapshots.
- PR #429 and #430: guarded May balance backfill route and runtime import fix.
- PR #431: latest production main commit.

## Failing layer

Failing layer: `API route -> backfill/cron route`.

Evidence for this layer:
- Production source/deploy is current `main`, so this is not a stale deploy/source problem.
- Snapshot and debug routes read Google Sheets and return healthy JSON, so this is not a Google Sheets access or UI-only fetch failure.
- April and June snapshot coverage is incomplete or empty, and the dry-run route refuses both ranges before invoking planning.
- The CLI/report builder accepts arbitrary ranges, but `server/backfill-daily-balance-snapshots-route.js` requires a May 2026 window.

Evidence against other plausible layers:
- No evidence that Ledger rows, provider imports, secrets/env, or amount semantics are failing; `/api/audit-snapshot` reports `uses_amount_net`.
- `/api/balance-snapshots` can merge and expose existing manual rows, so the read path itself is working.
- May dry-run returns planned rows, proving the report builder path can calculate derived auto rows when the route allows the range.

Confidence: high.

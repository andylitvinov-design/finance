import test from "node:test";
import assert from "node:assert/strict";

import {
  MAY_2026_BACKFILL_CONFIRMATION,
  runDailyBalanceBackfillRoute,
} from "../server/backfill-daily-balance-snapshots-route.js";

test("daily balance backfill route defaults to dry-run for May 2026", async () => {
  const calls = [];
  const result = await runDailyBalanceBackfillRoute({
    method: "GET",
    query: { from: "2026-05-01", to: "2026-05-31" },
    buildReport: async (options) => {
      calls.push(options);
      return { ok: true, planned_rows_count: 2, dryRun: options.apply !== true };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.dryRun, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apply, false);
});

test("daily balance backfill route refuses apply without explicit confirmation", async () => {
  let called = false;
  const result = await runDailyBalanceBackfillRoute({
    method: "POST",
    query: { from: "2026-05-01", to: "2026-05-31", apply: "1" },
    buildReport: async () => {
      called = true;
      return { ok: true };
    },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "apply_confirmation_required");
  assert.equal(called, false);
});

test("daily balance backfill route allows confirmed May 2026 apply", async () => {
  const calls = [];
  const result = await runDailyBalanceBackfillRoute({
    method: "POST",
    query: {
      from: "2026-05-01",
      to: "2026-05-31",
      apply: "1",
      confirm: MAY_2026_BACKFILL_CONFIRMATION,
    },
    buildReport: async (options) => {
      calls.push(options);
      return { ok: true, planned_rows_count: 2, save: { rowCount: 2 } };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apply, true);
});

test("daily balance backfill route rejects non-May windows", async () => {
  const result = await runDailyBalanceBackfillRoute({
    method: "GET",
    query: { from: "2026-04-30", to: "2026-05-31" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "may_2026_window_required");
});

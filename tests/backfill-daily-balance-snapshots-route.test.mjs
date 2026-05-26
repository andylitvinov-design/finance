import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DAILY_BALANCE_BACKFILL_CONFIRMATION,
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

test("daily balance backfill route rejects invalid windows", async () => {
  const result = await runDailyBalanceBackfillRoute({
    method: "GET",
    query: { from: "2026-05-31", to: "2026-05-01" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "valid_date_range_required");
});

test("daily balance backfill route dry-runs April and future ranges", async () => {
  const calls = [];
  for (const query of [
    { from: "2026-04-01", to: "2026-04-30" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]) {
    const result = await runDailyBalanceBackfillRoute({
      method: "GET",
      query,
      buildReport: async (options) => {
        calls.push(options);
        return { ok: true, planned_rows_count: 3, missing_anchors_count: 1 };
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.dryRun, true);
    assert.equal(result.body.route_guard.range_limited_to_may_2026, false);
  }

  assert.deepEqual(calls.map((call) => ({ from: call.from, to: call.to, apply: call.apply })), [
    { from: "2026-04-01", to: "2026-04-30", apply: false },
    { from: "2026-06-01", to: "2026-06-30", apply: false },
  ]);
});

test("daily balance backfill route applies non-May ranges only with explicit generic confirmation", async () => {
  const rejected = await runDailyBalanceBackfillRoute({
    method: "POST",
    query: { from: "2026-04-01", to: "2026-04-30", apply: "1", confirm: MAY_2026_BACKFILL_CONFIRMATION },
    buildReport: async () => {
      throw new Error("must not build report without generic confirmation");
    },
  });

  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "apply_confirmation_required");

  const accepted = await runDailyBalanceBackfillRoute({
    method: "POST",
    query: { from: "2026-04-01", to: "2026-04-30", apply: "1", confirm: DAILY_BALANCE_BACKFILL_CONFIRMATION },
    buildReport: async (options) => ({ ok: true, applied: options.apply }),
  });

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.dryRun, false);
});

test("daily balance backfill route avoids static mjs imports for Vercel CJS bundling", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "server/backfill-daily-balance-snapshots-route.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /^import .*scripts\/backfill-daily-balance-snapshots\.mjs/m);
});

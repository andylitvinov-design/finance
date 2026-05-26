import test from "node:test";
import assert from "node:assert/strict";

import {
  MAY_REPAIR_CONFIRMATION,
  runMayDailyBalanceSnapshotRepairRoute,
} from "../server/repair-may-daily-balance-snapshots-route.js";

test("May daily balance snapshot repair route defaults to dry-run", async () => {
  const calls = [];
  const result = await runMayDailyBalanceSnapshotRepairRoute({
    method: "GET",
    query: { from: "2026-05-01", to: "2026-05-31" },
    buildReport: async (options) => {
      calls.push(options);
      return { ok: true, duplicate_groups_count: 2, removed_rows_count: 12, dryRun: !options.apply };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.dryRun, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apply, false);
});

test("May daily balance snapshot repair route refuses apply without confirmation", async () => {
  let called = false;
  const result = await runMayDailyBalanceSnapshotRepairRoute({
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

test("May daily balance snapshot repair route applies with explicit confirmation", async () => {
  const calls = [];
  const result = await runMayDailyBalanceSnapshotRepairRoute({
    method: "POST",
    query: { from: "2026-05-01", to: "2026-05-31", apply: "1", confirm: MAY_REPAIR_CONFIRMATION },
    buildReport: async (options) => {
      calls.push(options);
      return { ok: true, dryRun: !options.apply, save: { rowCount: 12 } };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apply, true);
  assert.equal(calls[0].confirm, MAY_REPAIR_CONFIRMATION);
});

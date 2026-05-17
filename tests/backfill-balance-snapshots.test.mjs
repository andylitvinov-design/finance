import test from "node:test";
import assert from "node:assert/strict";

import { buildBalanceSnapshotBackfillPlan } from "../scripts/backfill-balance-snapshots.mjs";

test("balance snapshot backfill defaults to dry-run and reports per-date skipped rows", async () => {
  const result = await buildBalanceSnapshotBackfillPlan({
    from: "2026-05-01",
    to: "2026-05-02",
    env: {},
    fetchImpl: async () => {
      throw new Error("dry-run without credentials must not call provider fetch");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.results.every((row) => row.dry_run), true);
});

test("balance snapshot apply skips historical dates instead of writing current balances backwards", async () => {
  const result = await buildBalanceSnapshotBackfillPlan({
    from: "2026-05-01",
    to: "2026-05-01",
    apply: true,
    env: {},
    fetchImpl: async () => {
      throw new Error("historical apply must not call current provider fetch");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, false);
  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
  assert.match(result.warnings.join("\n"), /historical provider balance backfill is not applied/);
});

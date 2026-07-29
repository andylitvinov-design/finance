import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJulyOwnerBackfillPlan,
  summarizeJulyOwnerBackfillPlan,
} from "../scripts/backfill-owner-confirmed-july-2026-snapshots.mjs";

const header = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий", "source", "status", "raw_source_id"];

test("July owner backfill dry-run contains only two full batches and exact supplied totals", async () => {
  const plan = await buildJulyOwnerBackfillPlan([header]);
  const summary = summarizeJulyOwnerBackfillPlan(plan);

  assert.equal(plan.owner_rows.length, 39);
  assert.equal(summary.before_after.before_owner_batch_total_usd, 0);
  assert.equal(summary.before_after.after_owner_batch_total_usd["2026-07-01"], 21090.5);
  assert.equal(summary.before_after.after_owner_batch_total_usd["2026-07-29"], 22454.5);
  assert.equal(summary.factual_change_usd, 1364);
  assert.equal(summary.conflicts.length, 0);
});

test("July owner backfill is idempotent and does not create a duplicate batch", async () => {
  const first = await buildJulyOwnerBackfillPlan([header]);
  const existingValues = [header, ...first.upsert.outputRows.map((row) => [
    row.date, row.channel, row.amount, row.currency, row.rate, row.usdAmount, row.comment,
    row.metadataSource, row.metadataStatus, row.rawSourceId,
  ])];
  const repeated = await buildJulyOwnerBackfillPlan(existingValues);
  const summary = summarizeJulyOwnerBackfillPlan(repeated);

  assert.equal(repeated.upsert.outputRows.length, first.upsert.outputRows.length);
  assert.equal(summary.duplicate_batch_rows, 0);
  assert.equal(summary.conflicts.length, 0);
});

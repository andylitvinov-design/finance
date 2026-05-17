import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBackfillRows,
  classifyBackfillRows,
  summarizeBackfillPlan,
} from "../scripts/backfill-2026-05-01-balances.mjs";
import { mergeBalanceRowsByDateChannelCurrency } from "../server/auto-balance-snapshots.js";

test("2026-05-01 balance backfill is idempotent and does not duplicate rows", () => {
  const backfillRows = buildBackfillRows();
  const initialExisting = [
    { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: "2639,08" },
  ];
  const firstPlan = classifyBackfillRows(initialExisting, backfillRows);

  assert.equal(firstPlan.rowsToWrite.length, 22);
  assert.equal(firstPlan.rowsToWrite.find((row) => row.channel === "трансервайз дол").action, "update");
  assert.equal(firstPlan.duplicateInputs.length, 0);

  const merged = mergeBalanceRowsByDateChannelCurrency(initialExisting, firstPlan.rowsToWrite);
  const secondPlan = classifyBackfillRows(merged, backfillRows);

  assert.equal(secondPlan.rowsToWrite.length, 0);
  assert.equal(secondPlan.skippedRows.length, 22);
  assert.equal(new Set(merged.map((row) => `${row.date}|${row.channel}|${row.currency}`)).size, merged.length);
});

test("2026-05-01 balance backfill summary reports normalized channel decisions", () => {
  const summary = summarizeBackfillPlan(classifyBackfillRows([], buildBackfillRows()));

  assert.equal(summary.create, 22);
  assert.ok(summary.rows_to_write.some((row) =>
    row.input_channel === "24-грн"
    && row.channel === "приват 24-грн"
    && row.currency === "UAH"
    && row.amount === 11239
    && row.note.includes("254")
  ));
  assert.ok(summary.rows_to_write.some((row) =>
    row.input_channel === "карта май"
    && row.currency === "UNKNOWN"
    && row.resolution === "user_provided_unknown_currency"
  ));
});

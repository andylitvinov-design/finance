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

  assert.equal(firstPlan.rowsToWrite.length, 25);
  assert.equal(firstPlan.rowsToWrite.find((row) => row.channel === "трансервайз дол").action, "update");
  assert.equal(firstPlan.duplicateInputs.length, 0);

  const merged = mergeBalanceRowsByDateChannelCurrency(initialExisting, firstPlan.rowsToWrite);
  const secondPlan = classifyBackfillRows(merged, backfillRows);

  assert.equal(secondPlan.rowsToWrite.length, 0);
  assert.equal(secondPlan.skippedRows.length, 25);
  assert.equal(new Set(merged.map((row) => `${row.date}|${row.channel}|${row.currency}`)).size, merged.length);
});

test("2026-05-01 balance backfill summary reports normalized channel decisions", () => {
  const summary = summarizeBackfillPlan(classifyBackfillRows([], buildBackfillRows()));

  assert.equal(summary.create, 25);
  assert.equal(summary.expected_total_usd, 24993);
  assert.ok(summary.rows_to_write.some((row) =>
    row.input_channel === "24-грн"
    && row.channel === "приват 24-грн"
    && row.currency === "UAH"
    && row.amount === 11239
    && row.amount_usd === 254
  ));
  assert.ok(summary.rows_to_write.some((row) =>
    row.input_channel === "карта тай"
    && row.channel === "карта тай"
    && row.currency === "THB"
    && row.amount === 0
    && row.amount_usd === 0
  ));
});

test("USD channels write user amount as native USD amount", () => {
  const row = buildBackfillRows().find((entry) => entry.inputChannel === "пейпал дол");
  const plan = classifyBackfillRows([], [row]);

  assert.equal(plan.rowsToWrite.length, 1);
  assert.equal(plan.rowsToWrite[0].amount, 435);
  assert.equal(plan.rowsToWrite[0].usdAmount, 435);
  assert.equal(plan.rowsToWrite[0].classification, "missing_native_amount");
  assert.equal(plan.rowsToWrite[0].safeAction, "write_native_amount");
});

test("UAH rows write native UAH and user-provided amount_usd separately", () => {
  const row = buildBackfillRows().find((entry) => entry.inputChannel === "монобанк");
  const plan = classifyBackfillRows([], [row]);

  assert.equal(plan.rowsToWrite[0].amount, 26670);
  assert.equal(plan.rowsToWrite[0].usdAmount, 603);
  assert.equal(plan.rowsToWrite[0].currency, "UAH");
});

test("USD-equivalent-only non-USD rows are not written as native amount", () => {
  const row = buildBackfillRows().find((entry) => entry.inputChannel === "Payoneer - eur");
  const plan = classifyBackfillRows([
    { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount: "1284", usdAmount: "1489,44" },
  ], [row]);

  assert.equal(plan.rowsToWrite[0].amount, "");
  assert.equal(plan.rowsToWrite[0].usdAmount, 1284);
  assert.equal(plan.rowsToWrite[0].classification, "present_wrong_amount_usd_used_as_native");
  assert.equal(plan.rowsToWrite[0].safeAction, "write_amount_usd_only_needs_native");
});

test("owner-confirmed zero value is written as zero", () => {
  const row = buildBackfillRows().find((entry) => entry.inputChannel === "нал-мам-д");
  const plan = classifyBackfillRows([], [row]);

  assert.equal(plan.rowsToWrite.length, 1);
  assert.equal(plan.rowsToWrite[0].amount, 0);
  assert.equal(plan.rowsToWrite[0].usdAmount, 0);
  assert.equal(plan.rowsToWrite[0].classification, "missing_native_amount");
  assert.equal(plan.rowsToWrite[0].safeAction, "write_native_zero");
});

test("existing rows update by normalized date channel currency key", () => {
  const row = buildBackfillRows().find((entry) => entry.inputChannel === "24-грн");
  const plan = classifyBackfillRows([
    { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", usdAmount: "256,24" },
  ], [row]);

  assert.equal(plan.rowsToWrite.length, 1);
  assert.equal(plan.rowsToWrite[0].action, "update");
  assert.equal(plan.rowsToWrite[0].amount, 11239);
  assert.equal(plan.rowsToWrite[0].usdAmount, 254);
});

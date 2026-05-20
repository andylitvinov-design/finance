import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRepairPlanToValues,
  buildWiseCardAmountNetRepairPlan,
} from "../scripts/repair-wise-card-amount-net.mjs";

const header = [
  "date",
  "operation",
  "from_channel",
  "to_channel",
  "amount",
  "currency",
  "amount_gross",
  "amount_fee",
  "amount_net",
  "source",
  "raw_source_id",
  "comment",
];

test("repair dry-run reports exact Wise CARD amount_net corrections without mutating values", () => {
  const values = [
    header,
    ["2026-05-09", "business_expense", "трансервайз дол", "", "6.33", "USD", "6.33", "0.02", "6.31", "wise", "CARD-3772654733", "Card transaction of 5.35 EUR"],
  ];

  const plan = buildWiseCardAmountNetRepairPlan(values, { ids: ["CARD-3772654733"] });

  assert.equal(plan.ok, true);
  assert.equal(plan.summary.change_rows, 1);
  assert.equal(plan.summary.total_diff, 0.02);
  assert.deepEqual(plan.changes[0], {
    rowNumber: 2,
    raw_source_id: "CARD-3772654733",
    sourceTransactionId: "CARD-3772654733",
    date: "2026-05-09",
    channel: "трансервайз дол",
    currency: "USD",
    old_amount: 6.33,
    old_amount_net: 6.31,
    old_fee: 0.02,
    old_gross: 6.33,
    comment: "Card transaction of 5.35 EUR",
    expected_amount_net: 6.33,
    diff: 0.02,
    amountNetColumnIndex: 8,
    status: "change",
    safe: true,
    reason: "Wise CARD debit amount_net must equal the full account debit; amount_fee remains metadata.",
  });
  assert.equal(values[1][8], "6.31");
});

test("repair apply helper only updates exact matched amount_net cells and is idempotent", () => {
  const values = [
    header,
    ["2026-05-09", "business_expense", "трансервайз дол", "", "6.33", "USD", "6.33", "0.02", "6.31", "wise", "CARD-3772654733", "Card transaction"],
    ["2026-05-09", "business_expense", "трансервайз дол", "", "3.55", "USD", "3.55", "0.01", "3.54", "wise", "CARD-3771957018", "Card transaction"],
    ["2026-05-09", "business_expense", "трансервайз дол", "", "99", "USD", "99", "1", "98", "wise", "CARD-OTHER", "Do not touch"],
  ];

  const plan = buildWiseCardAmountNetRepairPlan(values, { ids: ["CARD-3772654733", "CARD-3771957018"] });
  const repaired = applyRepairPlanToValues(values, plan);
  const secondPlan = buildWiseCardAmountNetRepairPlan(repaired, { ids: ["CARD-3772654733", "CARD-3771957018"] });
  const repairedAgain = applyRepairPlanToValues(repaired, secondPlan);

  assert.equal(repaired[1][8], "6.33");
  assert.equal(repaired[2][8], "3.55");
  assert.equal(repaired[3][8], "98");
  assert.equal(secondPlan.summary.change_rows, 0);
  assert.equal(secondPlan.summary.unchanged_rows, 2);
  assert.deepEqual(repairedAgain, repaired);
});

test("repair refuses to apply when a requested CARD row is missing or ambiguous", () => {
  const duplicateValues = [
    header,
    ["2026-05-09", "business_expense", "трансервайз дол", "", "6.33", "USD", "6.33", "0.02", "6.31", "wise", "CARD-3772654733", "one"],
    ["2026-05-09", "business_expense", "трансервайз дол", "", "6.33", "USD", "6.33", "0.02", "6.31", "wise", "CARD-3772654733", "two"],
  ];

  const duplicatePlan = buildWiseCardAmountNetRepairPlan(duplicateValues, { ids: ["CARD-3772654733"] });
  const missingPlan = buildWiseCardAmountNetRepairPlan([header], { ids: ["CARD-3772654733"] });

  assert.equal(duplicatePlan.ok, false);
  assert.match(duplicatePlan.errors.join(" | "), /Ambiguous Ledger rows/);
  assert.equal(missingPlan.ok, false);
  assert.match(missingPlan.errors.join(" | "), /Missing Ledger row/);
});

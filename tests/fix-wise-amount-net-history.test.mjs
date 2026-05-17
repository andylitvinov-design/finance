import assert from "node:assert/strict";
import test from "node:test";

import { buildWiseAmountNetHistoryFix } from "../scripts/fix-wise-amount-net-history.mjs";

test("Wise CARD debit amount_net fix uses full debit and preserves fee metadata", () => {
  const values = [
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_gross", "amount_fee", "amount_net", "source", "raw_source_id", "comment"],
    ["2026-05-08", "business_expense", "трансервайз дол", "", "10.88", "USD", "10.88", "0.24", "10.64", "wise", "CARD-123", "card"],
  ];

  const result = buildWiseAmountNetHistoryFix(values);

  assert.equal(result.ok, true);
  assert.equal(result.safeWiseCardDebitRows, 1);
  assert.equal(result.may2026Correction, 0.24);
  assert.equal(result.values[1][7], "0.24");
  assert.equal(result.values[1][8], "10.88");
  assert.match(result.candidateRows[0].reason, /fee remains metadata/);
});

test("Wise fix does not alter non-CARD rows or already full-net rows", () => {
  const values = [
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_gross", "amount_fee", "amount_net", "source", "raw_source_id"],
    ["2026-05-08", "business_expense", "трансервайз дол", "", "20", "USD", "20", "1", "20", "wise", "CARD-OK"],
    ["2026-05-08", "business_expense", "трансервайз дол", "", "30", "USD", "30", "1", "29", "wise", "TRANSFER-1"],
  ];

  const result = buildWiseAmountNetHistoryFix(values);

  assert.equal(result.safeWiseCardDebitRows, 0);
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.values, values);
});

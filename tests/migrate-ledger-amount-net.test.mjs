import test from "node:test";
import assert from "node:assert/strict";

import { buildMigratedLedger, toReport } from "../scripts/migrate-ledger-amount-net.mjs";

test("ledger amount_net migration backfills only safe non-provider rows and groups dry-run output", () => {
  const values = [
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_gross", "amount_fee", "amount_net", "source", "raw_source_id"],
    ["2026-05-01", "expense", "cash usd", "", "42", "USD", "-42", "42", "", "", "manual", "manual-1"],
    ["2026-05-02", "income", "", "пейпал дол", "100", "USD", "100", "100", "", "", "paypal", "paypal:1"],
    ["2026-05-03", "income", "", "трансервайз дол", "200", "USD", "200", "200", "", "", "wise", "wise:1"],
    ["2026-05-04", "income", "", "cash usd", "25", "USD", "25", "25", "", "", "", ""],
  ];

  const result = buildMigratedLedger(values);
  const report = toReport(result);

  assert.equal(report.missingAmountNetRows, 4);
  assert.equal(report.safeBackfilledRows, 2);
  assert.equal(report.incompleteProviderRows, 2);
  assert.equal(report.incompletePayPalRows, 1);
  assert.equal(report.paypalMissingFeeNetRows, 1);
  assert.equal(report.unknownSourceRows, 1);
  assert.equal(result.values[1][9], "42");
  assert.equal(result.values[2][9] || "", "");
  assert.equal(result.values[3][9] || "", "");
  assert.equal(result.values[4][9], "25");
  assert.deepEqual(report.affectedRowsByGroup, [
    { source: "manual", operation: "expense", channel: "cash usd", rows: 1 },
    { source: "paypal", operation: "income", channel: "пейпал дол", rows: 1 },
    { source: "unknown", operation: "income", channel: "cash usd", rows: 1 },
    { source: "wise", operation: "income", channel: "трансервайз дол", rows: 1 },
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildPayPalLedgerImportPlan } from "../server/paypal-ledger-import.js";
import { resolveManualLedgerImportHeader } from "../server/manual-google-sheets.js";

test("PayPal import plan keeps gross, fee, net, direction, and stable source id", () => {
  const plan = buildPayPalLedgerImportPlan({
    entries: [
      {
        date: "2026-06-16",
        channel: "пейпал дол",
        direction: "income",
        localAmount: 100,
        currency: "USD",
        amountGross: 100,
        amountFee: 3,
        amountNet: 97,
        suggestedCategory: "serviceIncome",
        source: "paypal",
        externalId: "paypal:income-1",
        sourceTransactionId: "income-1",
      },
      {
        date: "2026-06-17",
        channel: "пейпал дол",
        direction: "expense",
        localAmount: 50,
        currency: "USD",
        amountGross: 50,
        amountFee: 0,
        amountNet: 50,
        suggestedCategory: "business",
        source: "paypal",
        externalId: "paypal:expense-1",
        sourceTransactionId: "expense-1",
      },
    ],
    existingRows: [],
    now: "2026-07-29T00:00:00.000Z",
  });

  assert.deepEqual({
    fetched: plan.counts.fetched,
    new: plan.counts.new,
    duplicates: plan.counts.duplicates,
    skipped: plan.counts.skipped,
    invalid: plan.counts.invalid,
    incomplete_fee_net: plan.counts.incomplete_fee_net,
    incoming: plan.counts.incoming,
    outgoing: plan.counts.outgoing,
  }, { fetched: 2, new: 2, duplicates: 0, skipped: 0, invalid: 0, incomplete_fee_net: 0, incoming: 1, outgoing: 1 });
  assert.deepEqual(plan.rows.map((row) => ({
    operation: row.operation,
    direction: row.direction,
    gross: row.amountGross,
    fee: row.amountFee,
    net: row.amountNet,
    amount: row.amount,
    sourceTransactionId: row.rawSourceId,
  })), [
    { operation: "income", direction: "in", gross: "100", fee: "3", net: "97", amount: "100", sourceTransactionId: "income-1" },
    { operation: "business_expense", direction: "out", gross: "50", fee: "0", net: "50", amount: "50", sourceTransactionId: "expense-1" },
  ]);
});

test("PayPal import plan is idempotent by stable external or source transaction id", () => {
  const entry = {
    date: "2026-06-16", channel: "пейпал дол", direction: "income", localAmount: 100, currency: "USD",
    amountGross: 100, amountFee: 3, amountNet: 97, suggestedCategory: "serviceIncome", source: "paypal",
    externalId: "paypal:income-1", sourceTransactionId: "income-1",
  };
  const plan = buildPayPalLedgerImportPlan({ entries: [entry], existingRows: [{ externalId: "paypal:income-1" }] });
  assert.equal(plan.counts.new, 0);
  assert.equal(plan.counts.duplicates, 1);
  assert.equal(plan.rows.length, 0);
});

test("PayPal Ledger append accepts existing normalized header aliases", () => {
  assert.deepEqual(
    ["Date", "Operation", "From channel", "To channel", "Amount", "Currency", "External ID", "Raw Source ID"]
      .map(resolveManualLedgerImportHeader),
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "external_id", "raw_source_id"]
  );
});

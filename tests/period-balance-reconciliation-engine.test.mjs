import test from "node:test";
import assert from "node:assert/strict";
import { buildPeriodBalanceReconciliation } from "../server/period-balance-reconciliation-engine.js";

const period = { from: "2026-05-11", to: "2026-05-15" };
const balances = (closing = "1200") => [
  { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
  ...(closing === null ? [] : [{ date: "2026-05-15", channel: "wise usd", currency: "USD", amount: closing }]),
];
const income = (extra = {}) => ({
  date: "2026-05-11",
  toChannel: "wise usd",
  currency: "USD",
  amountNet: "300",
  balanceAmount: 300,
  ledgerV2: { date: "2026-05-11", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300 },
  ...extra,
  ledgerV2: { date: "2026-05-11", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300, ...(extra.ledgerV2 || {}) },
});
const expense = {
  date: "2026-05-12",
  fromChannel: "wise usd",
  currency: "USD",
  amountNet: "100",
  balanceAmount: -100,
  ledgerV2: { date: "2026-05-12", operation: "expense", from_channel: "wise usd", currency: "USD", amount_net: "100", balance_amount: -100 },
};

test("real period balance reconciles when fact equals opening plus real delta", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income(), expense], balanceRows: balances("1200") });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "ok");
  assert.equal(row.status, "ok");
  assert.equal(row.real_delta, 200);
  assert.equal(row.computed_real_closing_balance, 1200);
  assert.equal(row.factual_closing_balance, 1200);
});

test("planned and real deltas are shown separately", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [income()],
    plannedRows: [
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: 500, operation: "income" },
      { date: "2026-05-12", channel: "wise usd", currency: "USD", amount: 100, operation: "expense" },
    ],
    balanceRows: balances("1300"),
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.planned_source_status, "ok");
  assert.equal(row.planned_delta, 400);
  assert.equal(row.real_delta, 300);
  assert.equal(row.plan_vs_real_delta, -100);
  assert.equal(result.by_currency[0].planned_delta, 400);
});

test("previous balance is carried forward only when there are no movements and no new balance", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "carried_forward_conditional");
  assert.equal(row.factual_closing_balance, 1000);
  assert.equal(row.closing_balance_source, "carried_forward");
});

test("missing closing balance is reported when movements exist", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income()], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "missing_closing_balance");
  assert.equal(row.factual_closing_balance, null);
  assert.match(row.fix_action, /конечный Остатки/);
});

test("mismatch shows factual minus computed real difference", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income()], balanceRows: balances("1290") });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(row.status, "mismatch");
  assert.equal(row.computed_real_closing_balance, 1300);
  assert.equal(row.real_difference, -10);
});

test("real reconciliation includes movements after the opening snapshot even when selected period starts later", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-17", to: "2026-05-17" },
    operations: [
      {
        date: "2026-05-16",
        fromChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "726.13",
        balanceAmount: -726.13,
        ledgerV2: {
          date: "2026-05-16",
          operation: "expense",
          from_channel: "трансервайз дол",
          currency: "USD",
          amount_net: "726.13",
          balance_amount: -726.13,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-15", channel: "трансервайз дол", currency: "USD", amount: "1796.61" },
      { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070.48" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance_date, "2026-05-15");
  assert.equal(row.real_outflow, 726.13);
  assert.equal(row.movement_rows, 1);
  assert.equal(row.computed_real_closing_balance, 1070.48);
  assert.equal(row.real_difference, 0);
});

test("empty amount_net makes reconciliation failed", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income({ amountNet: "", ledgerV2: { amount_net: "" } })], balanceRows: balances("1300") });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.missing_amount_net_rows, 1);
  assert.equal(row.status, "missing_amount_net");
});

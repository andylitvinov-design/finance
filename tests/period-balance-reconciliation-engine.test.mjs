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
  assert.equal(row.opening_fact_balance, 1000);
  assert.equal(row.calculated_closing_balance, 1200);
  assert.equal(row.computed_real_closing_balance, 1200);
  assert.equal(row.manual_provider_closing_balance, 1200);
  assert.equal(row.manual_provider_closing_balance_date, "2026-05-15");
  assert.equal(row.manual_provider_fact_lookup_key, "2026-05-15|wise usd|USD");
  assert.equal(row.carried_forward_balance, null);
  assert.equal(row.displayed_fact_balance, 1200);
  assert.equal(row.factual_closing_balance, 1200);
  assert.equal(row.fact_source, "manual");
  assert.equal(row.can_write_to_ostatki, true);
  assert.equal(row.repair_action, "none");
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

test("no movement and last observed balance carries forward as conditional fact", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.status_counts.ok, 0);
  assert.equal(result.summary.status_counts.mismatch, 0);
  assert.equal(result.summary.status_counts.carried_forward_conditional, 1);
  assert.equal(result.summary.status_counts.missing_provider_balance, 0);
  assert.equal(row.status, "carried_forward_conditional");
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.carried_forward_balance, 1000);
  assert.equal(row.displayed_fact_balance, 1000);
  assert.equal(row.factual_closing_balance, 1000);
  assert.equal(row.factual_closing_balance_date, "2026-05-10");
  assert.equal(row.closing_balance_source, "carried_forward");
  assert.equal(row.fact_source, "carried_forward");
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "confirm_carried_forward_before_append");
  assert.equal(row.real_difference, 0);
  assert.equal(row.last_observed_closing_balance, 1000);
  assert.equal(row.last_observed_closing_balance_date, "2026-05-10");
  assert.match(row.fix_action, /Проверить позже/);
});

test("carried-forward with non-zero difference is mismatch, not conditional OK", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [],
    balanceRows: [
      { date: "2026-05-09", channel: "wise usd", currency: "USD", amount: "900" },
      { date: "2026-05-12", channel: "wise usd", currency: "USD", amount: "1000" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(row.status, "mismatch");
  assert.equal(row.calculated_closing_balance, 900);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.carried_forward_balance, 1000);
  assert.equal(row.displayed_fact_balance, 1000);
  assert.equal(row.fact_source, "carried_forward");
  assert.equal(row.real_difference, 100);
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "investigate_mismatch");
});

test("missing exact target-date provider balance with movements is blocked, not mismatch", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income()], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.status_counts.ok, 0);
  assert.equal(result.summary.status_counts.mismatch, 0);
  assert.equal(result.summary.status_counts.missing_provider_balance, 1);
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.calculated_closing_balance, 1300);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.manual_provider_fact_lookup_key, "2026-05-15|wise usd|USD");
  assert.equal(row.nearest_manual_provider_fact_date, "2026-05-10");
  assert.equal(row.nearest_manual_provider_fact_amount, 1000);
  assert.match(row.missing_fact_reason, /period end is 2026-05-15/);
  assert.equal(row.carried_forward_balance, null);
  assert.equal(row.displayed_fact_balance, null);
  assert.equal(row.factual_closing_balance, null);
  assert.equal(row.fact_source, "missing");
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "enter_manual_provider_fact");
  assert.match(row.diagnosis, /Нет фактического остатка на дату/);
});

test("no opening, no movement, no fact, and no plan is ignored as no data", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [],
    plannedRows: [],
    balanceRows: [{ date: "2026-05-12", channel: "empty usd", currency: "USD", amount: "100" }],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.status_counts.no_data, 1);
  assert.equal(result.summary.status_counts.missing_provider_balance, 0);
  assert.equal(result.actionable_rows.length, 0);
  assert.equal(row.status, "no_data");
  assert.equal(row.fact_source, "missing");
  assert.equal(row.repair_action, "ignore_no_data");
});

test("exact closing balance remains authoritative over carried-forward fallback", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [], balanceRows: balances("1001") });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "mismatch");
  assert.equal(row.factual_closing_balance, 1001);
  assert.equal(row.factual_closing_balance_date, "2026-05-15");
  assert.equal(row.closing_balance_source, "exact");
  assert.equal(row.real_difference, 1);
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
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.missing_amount_net_rows, 1);
  assert.equal(row.status, "missing_amount_net");
  assert.match(row.fix_action, /amount_net/);
  assert(row.diagnostics.categories.includes("amount_net issue"));
});

test("Wise USD true mismatch remains visible when exact target provider balance exists", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-17" },
    operations: [
      {
        date: "2026-05-03",
        toChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "313.30",
        balanceAmount: 313.3,
        ledgerV2: { date: "2026-05-03", operation: "income", to_channel: "трансервайз дол", currency: "USD", amount_net: "313.30", balance_amount: 313.3 },
      },
      {
        date: "2026-05-10",
        fromChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "1939.21",
        balanceAmount: -1939.21,
        ledgerV2: { date: "2026-05-10", operation: "expense", from_channel: "трансервайз дол", currency: "USD", amount_net: "1939.21", balance_amount: -1939.21 },
      },
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "2704.25" },
      { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070.48" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(row.status, "mismatch");
  assert.equal(row.computed_real_closing_balance, 1078.34);
  assert.equal(row.factual_closing_balance, 1070.48);
  assert.equal(row.real_difference, -7.86);
  assert.deepEqual(row.diagnostics.categories, ["missing ledger movement", "fee/net mismatch", "sign/direction issue", "amount_net issue"]);
});

test("PayPal EUR missing amount_net blocks without gross-as-net substitution", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [
      {
        date: "2026-05-12",
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountGross: "100",
        amountNet: "",
        balanceAmount: -100,
        source: "paypal",
        ledgerV2: { date: "2026-05-12", operation: "expense", source: "paypal", from_channel: "пейпал евр", currency: "EUR", amount_gross: "100", amount_fee: "", amount_net: "", balance_amount: -100 },
      },
    ],
    balanceRows: [
      { date: "2026-05-10", channel: "пейпал евр", currency: "EUR", amount: "0" },
      { date: "2026-05-15", channel: "пейпал евр", currency: "EUR", amount: "-100" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(row.status, "missing_amount_net");
  assert.equal(row.real_outflow, 0);
  assert.equal(row.missing_amount_net_rows, 1);
  assert.match(result.warnings.join(" "), /provider permission/);
});

test("Binance spot USDT movement without manual/provider fact reports missing provider balance", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [
      {
        date: "2026-05-12",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "103",
        balanceAmount: 103,
        ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "Бинанс spot", currency: "USDT", amount_net: "103", balance_amount: 103 },
      },
    ],
    balanceRows: [],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.opening_fact_balance, null);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.fact_source, "missing");
  assert.match(row.fix_action, /фактический остаток/);
});

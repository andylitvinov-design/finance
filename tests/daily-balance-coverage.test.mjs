import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyBalanceCoverage } from "../server/daily-balance-engine.js";

const period = { from: "2026-05-01", to: "2026-05-03" };
const activePairs = [{ channel: "wise usd", currency: "USD" }];

function expense(overrides = {}) {
  return {
    date: "2026-05-02",
    operation: "expense",
    fromChannel: "wise usd",
    currency: "USD",
    amountNet: "20",
    balanceAmount: -20,
    ledgerV2: {
      date: "2026-05-02",
      operation: "expense",
      from_channel: "wise usd",
      currency: "USD",
      amount_net: "20",
      balance_amount: -20,
    },
    ...overrides,
    ledgerV2: {
      date: "2026-05-02",
      operation: "expense",
      from_channel: "wise usd",
      currency: "USD",
      amount_net: "20",
      balance_amount: -20,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("full calendar coverage carries closing balance across no-movement days", () => {
  const result = buildDailyBalanceCoverage({
    period,
    activePairs,
    configuredChannels: [],
    operations: [expense()],
    balanceRows: [
      { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
    ],
  });

  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((row) => ({
    date: row.date,
    opening: row.opening_balance,
    delta: row.ledger_delta,
    closing: row.computed_closing_balance,
    final: row.final_balance,
    status: row.status,
  })), [
    { date: "2026-05-01", opening: 100, delta: 0, closing: 100, final: 100, status: "computed_from_previous_day" },
    { date: "2026-05-02", opening: 100, delta: -20, closing: 80, final: 80, status: "computed_from_previous_day" },
    { date: "2026-05-03", opening: 80, delta: 0, closing: 80, final: 80, status: "computed_from_previous_day" },
  ]);
  assert.equal(result.summary.expected_rows, 3);
  assert.equal(result.summary.complete, true);
});

test("manual snapshot wins over same-date auto mismatch", () => {
  const result = buildDailyBalanceCoverage({
    period: { from: "2026-05-02", to: "2026-05-02" },
    activePairs,
    configuredChannels: [],
    operations: [expense()],
    balanceRows: [
      { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "80", source: "manual_fact", sourceSheet: "Остатки" },
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "79", source: "provider_auto", sourceSheet: "Авто Остатки" },
    ],
  });

  const row = result.rows[0];
  assert.equal(row.computed_closing_balance, 80);
  assert.equal(row.final_balance, 80);
  assert.equal(row.status, "manual_fact");
  assert.equal(row.source, "manual_fact");
  assert.equal(row.auto_provider_balance_snapshot.amount, 79);
});

test("matching auto provider snapshot becomes provider_auto", () => {
  const result = buildDailyBalanceCoverage({
    period: { from: "2026-05-02", to: "2026-05-02" },
    activePairs,
    configuredChannels: [],
    operations: [expense()],
    balanceRows: [
      { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "80", source: "provider_auto", sourceSheet: "Авто Остатки" },
    ],
  });

  assert.equal(result.rows[0].status, "provider_auto");
  assert.equal(result.rows[0].difference, 0);
  assert.equal(result.rows[0].final_balance, 80);
});

test("provider permission row is propagated without fake final balance when opening is missing", () => {
  const result = buildDailyBalanceCoverage({
    period: { from: "2026-05-02", to: "2026-05-02" },
    activePairs,
    configuredChannels: [],
    operations: [],
    balanceRows: [
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "", status: "needs_provider_permission", sourceSheet: "Авто Остатки" },
    ],
  });

  assert.equal(result.rows[0].status, "needs_provider_permission");
  assert.equal(result.rows[0].final_balance, null);
  assert.equal(result.rows[0].source, "provider_status");
});

test("missing amount_net blocks computed balance and is counted", () => {
  const result = buildDailyBalanceCoverage({
    period: { from: "2026-05-02", to: "2026-05-02" },
    activePairs,
    configuredChannels: [],
    operations: [
      expense({
        amountNet: "",
        balanceAmount: -999,
        ledgerV2: { amount_net: "", amount_gross: "999", balance_amount: -999 },
      }),
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
    ],
  });

  assert.equal(result.rows[0].status, "missing_amount_net");
  assert.equal(result.rows[0].ledger_delta, 0);
  assert.equal(result.rows[0].computed_closing_balance, null);
  assert.equal(result.rows[0].final_balance, null);
  assert.equal(result.summary.missing_amount_net_rows, 1);
});

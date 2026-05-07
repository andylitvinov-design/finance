import test from "node:test";
import assert from "node:assert/strict";

import { buildBalanceCoverage } from "../server/balance-coverage-engine.js";

function dailyRow(overrides = {}) {
  return {
    date: "2026-05-02",
    channel: "wise usd",
    currency: "USD",
    opening_balance: 1000,
    inflow: 206,
    outflow: 0,
    net_change: 206,
    closing_balance: 1206,
    provider_reported_balance: 1206,
    difference: 0,
    status: "ok",
    ...overrides,
  };
}

test("balance coverage reports a fully reconciled account-currency row", () => {
  const result = buildBalanceCoverage({
    rows: [dailyRow()],
    summary: { excluded_missing_amount_net_rows: 0 },
  });

  assert.equal(result.summary.accounts_with_movement, 1);
  assert.equal(result.summary.fully_reconciled_accounts, 1);
  assert.equal(result.summary.mismatch, 0);
  assert.deepEqual(result.actionable_accounts, []);
  assert.deepEqual(result.accounts[0], {
    date: "2026-05-02",
    channel: "wise usd",
    currency: "USD",
    movement_rows: 1,
    has_movement: true,
    has_opening_balance: true,
    has_closing_balance: true,
    opening_balance: 1000,
    inflow: 206,
    outflow: 0,
    net_change: 206,
    computed_closing_balance: 1206,
    provider_reported_balance: 1206,
    difference: 0,
    status: "ok",
    balance_source: "manual",
  });
});

test("balance coverage surfaces missing provider balance", () => {
  const result = buildBalanceCoverage({
    rows: [
      dailyRow({
        provider_reported_balance: null,
        difference: null,
        status: "missing_provider_balance",
      }),
    ],
    summary: { excluded_missing_amount_net_rows: 0 },
  });

  assert.equal(result.summary.missing_provider_balance, 1);
  assert.equal(result.summary.fully_reconciled_accounts, 0);
  assert.equal(result.accounts[0].has_closing_balance, false);
  assert.equal(result.accounts[0].balance_source, "missing");
  assert.equal(result.actionable_accounts[0].status, "missing_provider_balance");
});

test("balance coverage prioritizes mismatch before missing balances", () => {
  const result = buildBalanceCoverage({
    rows: [
      dailyRow({ date: "2026-05-03", provider_reported_balance: null, difference: null, status: "missing_provider_balance" }),
      dailyRow({ date: "2026-05-04", opening_balance: null, closing_balance: null, difference: null, status: "missing_opening_balance" }),
      dailyRow({ date: "2026-05-02", provider_reported_balance: 1201, difference: -5, status: "mismatch" }),
    ],
    summary: { excluded_missing_amount_net_rows: 2 },
  });

  assert.equal(result.summary.accounts_with_movement, 3);
  assert.equal(result.summary.mismatch, 1);
  assert.equal(result.summary.missing_opening_balance, 1);
  assert.equal(result.summary.missing_provider_balance, 1);
  assert.equal(result.summary.excluded_missing_amount_net_rows, 2);
  assert.deepEqual(
    result.actionable_accounts.map((row) => row.status),
    ["mismatch", "missing_opening_balance", "missing_provider_balance"]
  );
});

test("balance coverage keeps same channel with different currencies separate", () => {
  const result = buildBalanceCoverage({
    rows: [
      dailyRow({ currency: "USD", net_change: 100, closing_balance: 1100, provider_reported_balance: 1100 }),
      dailyRow({ currency: "EUR", net_change: 50, closing_balance: 550, provider_reported_balance: 550 }),
    ],
    summary: { excluded_missing_amount_net_rows: 0 },
  });

  assert.deepEqual(
    result.accounts.map((row) => ({ channel: row.channel, currency: row.currency, net_change: row.net_change })),
    [
      { channel: "wise usd", currency: "EUR", net_change: 50 },
      { channel: "wise usd", currency: "USD", net_change: 100 },
    ]
  );
});

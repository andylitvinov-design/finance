import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditSnapshot } from "../api/audit-snapshot.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "wise usd",
    amount: "206",
    currency: "USD",
    amountUsd: "206",
    amountNet: "206",
    source: "wise",
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      from_channel: "",
      to_channel: "wise usd",
      amount: "206",
      currency: "USD",
      amount_usd: "206",
      amount_net: "206",
      balance_amount: 206,
      source: "wise",
    },
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      ...row.ledgerV2,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("audit snapshot exposes balance coverage for reconciled account currency rows", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_coverage.summary.accounts_with_movement, 1);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
  assert.equal(snapshot.balance_coverage.summary.mismatch, 0);
  assert.equal(snapshot.balance_coverage.accounts[0].computed_closing_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].provider_reported_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "ok");
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "ok");
});

test("audit snapshot balance coverage flags missing closing balance without changing balances.by_channel", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.by_channel[0].channel, "wise usd");
  assert.equal(snapshot.balances.by_channel[0].balance_amount, 206);
  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 1);
  assert.equal(snapshot.balance_coverage.actionable_accounts[0].status, "missing_provider_balance");
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "needs verification");
});

test("audit snapshot reconciles today's balance change against same-day closing snapshot", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-06", to: "2026-05-06" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-06",
          toChannel: "wise usd",
          amount: "300",
          amountUsd: "300",
          amountNet: "300",
          ledgerV2: {
            date: "2026-05-06",
            to_channel: "wise usd",
            amount: "300",
            amount_usd: "300",
            amount_net: "300",
            balance_amount: 300,
          },
        }),
        operation({
          date: "2026-05-06",
          operation: "expense",
          fromChannel: "wise usd",
          toChannel: "",
          amount: "40",
          amountUsd: "-40",
          amountNet: "40",
          ledgerV2: {
            date: "2026-05-06",
            operation: "expense",
            from_channel: "wise usd",
            to_channel: "",
            amount: "40",
            amount_usd: "-40",
            amount_net: "40",
            balance_amount: -40,
          },
        }),
      ],
      balances: [
        { date: "2026-05-05", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1260" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.date, "2026-05-06");
  assert.equal(account.opening_balance, 1000);
  assert.equal(account.inflow, 300);
  assert.equal(account.outflow, 40);
  assert.equal(account.net_change, 260);
  assert.equal(account.computed_closing_balance, 1260);
  assert.equal(account.provider_reported_balance, 1260);
  assert.equal(account.difference, 0);
  assert.equal(account.status, "ok");
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
});

test("audit snapshot reconciles end-of-April balance change against April 30 closing snapshot", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-04-30", to: "2026-04-30" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-04-30",
          toChannel: "БАНК КАНАДА cad",
          amount: "500",
          amountUsd: "370",
          amountNet: "500",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-30",
            to_channel: "БАНК КАНАДА cad",
            amount: "500",
            amount_usd: "370",
            amount_net: "500",
            currency: "CAD",
            balance_amount: 500,
          },
        }),
        operation({
          date: "2026-04-30",
          operation: "expense",
          fromChannel: "БАНК КАНАДА cad",
          toChannel: "",
          amount: "120",
          amountUsd: "-88.8",
          amountNet: "120",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-30",
            operation: "expense",
            from_channel: "БАНК КАНАДА cad",
            to_channel: "",
            amount: "120",
            amount_usd: "-88.8",
            amount_net: "120",
            currency: "CAD",
            balance_amount: -120,
          },
        }),
      ],
      balances: [
        { date: "2026-04-29", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "2000" },
        { date: "2026-04-30", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "2380" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.date, "2026-04-30");
  assert.equal(account.currency, "CAD");
  assert.equal(account.opening_balance, 2000);
  assert.equal(account.inflow, 500);
  assert.equal(account.outflow, 120);
  assert.equal(account.net_change, 380);
  assert.equal(account.computed_closing_balance, 2380);
  assert.equal(account.provider_reported_balance, 2380);
  assert.equal(account.difference, 0);
  assert.equal(account.status, "ok");
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "ok");
});

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

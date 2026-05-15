import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodBalanceReconciliationSnapshot } from "../api/period-balance-reconciliation.js";

test("period balance reconciliation API snapshot exposes planned and real period deltas", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-11",
          toChannel: "wise usd",
          currency: "USD",
          amountNet: "300",
          balanceAmount: 300,
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "wise usd",
            currency: "USD",
            amount_net: "300",
            balance_amount: 300,
          },
        },
      ],
      plannedRows: [
        { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: 500, operation: "income" },
        { date: "2026-05-12", channel: "wise usd", currency: "USD", amount: 100, operation: "expense" },
      ],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: "1300" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.period_balance_reconciliation.summary.planned_source_status, "ok");
  assert.equal(snapshot.period_balance_reconciliation.by_currency[0].planned_delta, 400);
  assert.equal(snapshot.period_balance_reconciliation.by_currency[0].real_delta, 300);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].plan_vs_real_delta, -100);
});

test("period balance reconciliation API reports planned source gap without failing real balance", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.period_balance_reconciliation.summary.status, "ok");
  assert.equal(snapshot.period_balance_reconciliation.summary.planned_source_status, "needs_verification");
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].status, "carried_forward_conditional");
  assert.match(snapshot.warnings.join("\n"), /planned income\/expense source/);
});

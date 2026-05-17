import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodBalanceReconciliationSnapshot } from "../server/period-balance-reconciliation-route.js";

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
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.balance_snapshot_rows_loaded, 2);
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.analytics_fact_rows_rendered, 1);
  assert.doesNotMatch(snapshot.warnings.join("\n"), /planned.*source.*unavailable|planned income\/expense source is not connected/i);
});

test("period balance reconciliation API reports planned source gap and missing exact provider balance", async () => {
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

  assert.equal(snapshot.period_balance_reconciliation.summary.status, "blocked");
  assert.equal(snapshot.period_balance_reconciliation.summary.planned_source_status, "needs_verification");
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.missing_provider_balance, 1);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].status, "missing_provider_balance");
  assert.match(snapshot.warnings.join("\n"), /planned income\/expense source/);
  assert.match(snapshot.warnings.join("\n"), /movementValues order-plan rows and manual finance planned expense rows server-side/);
});

test("period balance reconciliation reports available empty planned source without source-unavailable warning", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.period_balance_reconciliation.summary.planned_rows, 0);
  assert.equal(snapshot.period_balance_reconciliation.summary.planned_source_status, "available_empty");
  assert.doesNotMatch(snapshot.warnings.join("\n"), /planned balance movement source is unavailable/);
  assert.doesNotMatch(snapshot.warnings.join("\n"), /planned income\/expense source is not connected/);
});

test("period balance reconciliation treats monthly plan source from repository as available even when amount cells are blank", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-04-01", to: "2026-04-30" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      monthlyPlanRows: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [],
      warnings: [],
    }),
  });

  assert.equal(snapshot.period_balance_reconciliation.planned_source_status, "available_empty");
  assert.doesNotMatch(snapshot.warnings.join("\n"), /source is unavailable|source is not connected/);
});

test("period balance reconciliation classifies PayPal missing amount_net as provider-permission incomplete", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-11",
          toChannel: "пейпал евр",
          currency: "EUR",
          amountNet: "",
          source: "paypal",
          rawSourceId: "paypal:missing-net",
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "пейпал евр",
            currency: "EUR",
            amount_net: "",
            source: "paypal",
            external_id: "paypal:missing-net",
          },
        },
      ],
      plannedRows: [
        { date: "2026-05-11", channel: "пейпал евр", currency: "EUR", amount: 36, operation: "income" },
      ],
      balances: [],
      warnings: [],
    }),
  });

  assert.equal(snapshot.period_balance_reconciliation.summary.missing_amount_net_rows, 1);
  assert.match(snapshot.warnings.join("\n"), /needs provider permission: 1 PayPal row/);
  assert.doesNotMatch(snapshot.warnings.join("\n"), /1 row\(s\) have empty amount_net; real balance reconciliation is incomplete/);
});

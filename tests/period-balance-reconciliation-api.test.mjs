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

test("period balance reconciliation uses manual fact before auto fallback", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-12",
          toChannel: "wise usd",
          currency: "USD",
          amountNet: "50",
          balanceAmount: 50,
          ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "50", balance_amount: 50 },
        },
      ],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000", balanceSource: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: "1070", balanceSource: "manual_fact", sourceSheet: "Остатки", comment: "manual_fact" },
      ],
      autoBalances: [
        { date: "2026-05-15", provider: "wise", channel: "wise usd", currency: "USD", amount: "9999", balanceSource: "provider_auto", sourceSheet: "Авто Остатки", comment: "auto daily provider snapshot" },
      ],
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency[0];
  assert.equal(row.manual_provider_closing_balance, 1070);
  assert.equal(row.balanceSource, "manual_fact");
  assert.equal(row.needsManualConfirmation, false);
  assert.equal(row.sourceSheet, "Остатки");
});

test("period balance reconciliation falls back to auto and marks missing facts", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-11", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-12",
          toChannel: "wise usd",
          currency: "USD",
          amountNet: "50",
          balanceAmount: 50,
          ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "50", balance_amount: 50 },
        },
        {
          date: "2026-05-12",
          toChannel: "paypal usd",
          currency: "USD",
          amountNet: "5",
          balanceAmount: 5,
          ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "paypal usd", currency: "USD", amount_net: "5", balance_amount: 5 },
        },
      ],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000", balanceSource: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-15", provider: "wise", channel: "wise usd", currency: "USD", amount: "1050", balanceSource: "provider_auto", sourceSheet: "Авто Остатки", sourceRow: 2, comment: "wise auto snapshot" },
      ],
      warnings: [],
    }),
  });

  const wise = snapshot.period_balance_reconciliation.by_channel_currency.find((row) => row.channel === "wise usd");
  const paypal = snapshot.period_balance_reconciliation.by_channel_currency.find((row) => row.channel === "paypal usd");
  assert.equal(wise.manual_provider_closing_balance, 1050);
  assert.equal(wise.balanceSource, "provider_auto");
  assert.equal(wise.balance_source, "provider_auto");
  assert.equal(wise.needsManualConfirmation, true);
  assert.equal(wise.needs_manual_confirmation, true);
  assert.equal(wise.provider, "wise");
  assert.equal(wise.sourceSheet, "Авто Остатки");
  assert.equal(wise.source_sheet, "Авто Остатки");
  assert.equal(wise.sourceRow, 2);
  assert.equal(wise.source_row, 2);
  assert.equal(wise.sourceComment, "wise auto snapshot");
  assert.equal(paypal.balanceSource, "missing");
  assert.equal(paypal.balance_source, "missing");
  assert.equal(paypal.needsManualConfirmation, true);
  assert.equal(paypal.needs_manual_confirmation, true);
  assert.equal(paypal.sourceSheet, "");
  assert.equal(paypal.source_sheet, "");
  assert.deepEqual(snapshot.period_balance_reconciliation.summary.balance_source_counts, {
    manual_fact: 0,
    provider_auto: 1,
    missing: 1,
  });
  assert.deepEqual(
    snapshot.period_balance_reconciliation.required_manual_fact_rows.map((row) => ({
      sheet: row.sheet,
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: row.amount,
      amount_hint: row.amount_hint,
      balance_source: row.balance_source,
      source_sheet: row.source_sheet,
      status: row.status,
    })).sort((left, right) => left.channel.localeCompare(right.channel)),
    [
      {
        sheet: "Остатки",
        date: "2026-05-15",
        channel: "paypal usd",
        currency: "USD",
        amount: null,
        amount_hint: null,
        balance_source: "missing",
        source_sheet: "",
        status: "missing_provider_balance",
      },
      {
        sheet: "Остатки",
        date: "2026-05-15",
        channel: "wise usd",
        currency: "USD",
        amount: null,
        amount_hint: 1050,
        balance_source: "provider_auto",
        source_sheet: "Авто Остатки",
        status: "ok",
      },
    ]
  );
});

test("period balance reconciliation API reports planned source gap and carried-forward provider balance", async () => {
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
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.carried_forward_conditional, 1);
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.missing_provider_balance, 0);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].status, "carried_forward_conditional");
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].factual_closing_balance, 1000);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].closing_balance_source, "carried_forward");
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

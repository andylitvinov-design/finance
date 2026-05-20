import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodBalanceReconciliationSnapshot } from "../server/period-balance-reconciliation-route.js";

test("reconciliation source priority is manual over auto over missing", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-10",
          toChannel: "трансервайз дол",
          currency: "USD",
          amountNet: "20",
          balanceAmount: 20,
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "трансервайз дол",
            currency: "USD",
            amount_net: "20",
            balance_amount: 20,
          },
        },
        {
          date: "2026-05-11",
          toChannel: "трансервайз евро",
          currency: "EUR",
          amountNet: "5",
          balanceAmount: 5,
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "трансервайз евро",
            currency: "EUR",
            amount_net: "5",
            balance_amount: 5,
          },
        },
        {
          date: "2026-05-12",
          toChannel: "пейпал дол",
          currency: "USD",
          amountNet: "3",
          balanceAmount: 3,
          ledgerV2: {
            date: "2026-05-12",
            operation: "income",
            to_channel: "пейпал дол",
            currency: "USD",
            amount_net: "3",
            balance_amount: 3,
          },
        },
      ],
      balances: [
        { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "120", source: "manual_fact", sourceSheet: "Остатки", comment: "manual_fact" },
        { date: "2026-04-30", channel: "трансервайз евро", currency: "EUR", amount: "10", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-17", provider: "wise", channel: "трансервайз дол", currency: "USD", amount: "999", source: "provider_auto", sourceSheet: "Авто Остатки", status: "ok", comment: "wise auto snapshot", sourceRow: 2 },
        { date: "2026-05-17", provider: "wise", channel: "трансервайз евро", currency: "EUR", amount: "0", source: "provider_auto", sourceSheet: "Авто Остатки", status: "zero_balance", comment: "wise auto snapshot", sourceRow: 3 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const rows = snapshot.period_balance_reconciliation.by_channel_currency;
  const wiseUsd = rows.find((row) => row.channel === "трансервайз дол" && row.currency === "USD");
  const wiseEur = rows.find((row) => row.channel === "трансервайз евро" && row.currency === "EUR");
  const paypalUsd = rows.find((row) => row.channel === "пейпал дол" && row.currency === "USD");

  assert.equal(wiseUsd.factual_closing_balance, 120);
  assert.equal(wiseUsd.balanceSource, "manual_fact");
  assert.equal(wiseUsd.needsManualConfirmation, false);
  assert.equal(wiseUsd.sourceSheet, "Остатки");

  assert.equal(wiseEur.factual_closing_balance, 0);
  assert.equal(wiseEur.balanceSource, "provider_auto");
  assert.equal(wiseEur.needsManualConfirmation, true);
  assert.equal(wiseEur.provider, "wise");
  assert.equal(wiseEur.sourceSheet, "Авто Остатки");
  assert.equal(wiseEur.sourceRow, 3);

  assert.equal(paypalUsd.factual_closing_balance, null);
  assert.equal(paypalUsd.balanceSource, "missing");
  assert.equal(paypalUsd.needsManualConfirmation, true);
});

test("legacy auto row in manual Остатки is classified as provider_auto", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-10",
          toChannel: "трансервайз дол",
          currency: "USD",
          amountNet: "20",
          balanceAmount: 20,
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "трансервайз дол",
            currency: "USD",
            amount_net: "20",
            balance_amount: 20,
          },
        },
      ],
      balances: [
        { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070,48", source: "manual-google-sheets", sourceSheet: "Остатки", comment: "wise auto snapshot" },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "трансервайз дол");
  assert.equal(row.factual_closing_balance, 1070.48);
  assert.equal(row.balanceSource, "provider_auto");
  assert.equal(row.needsManualConfirmation, true);
  assert.equal(row.sourceSheet, "Остатки");
  assert.equal(row.sourceComment, "wise auto snapshot");
});

test("display date input is normalized with padded month and day", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "1.5.2026", to: "17.5.2026" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [],
      balances: [],
      autoBalances: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.period_balance_reconciliation.period, {
    from: "2026-05-01",
    to: "2026-05-17",
  });
});

test("carried-forward opening row is not labeled as closing manual fact", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [],
      balances: [
        { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки", comment: "manual opening only" },
      ],
      autoBalances: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "трансервайз дол");
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.closing_balance_source, "missing");
  assert.equal(row.balanceSource, "missing");
  assert.equal(row.needsManualConfirmation, true);
  assert.equal(row.sourceSheet, "");
  assert.equal(row.factStatus, "missing");
  assert.match(row.repairHint, /add fact balance/);
});

test("blank auto status row does not become factual balance and reports provider limitation", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-10",
          toChannel: "Payoneer - dol",
          currency: "USD",
          amountNet: "20",
          balanceAmount: 20,
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "Payoneer - dol",
            currency: "USD",
            amount_net: "20",
            balance_amount: 20,
          },
        },
      ],
      balances: [
        { date: "2026-04-30", channel: "Payoneer - dol", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-17", provider: "payoneer", channel: "Payoneer - dol", currency: "USD", amount: "", source: "provider_auto", sourceSheet: "Авто Остатки", status: "provider_not_implemented", comment: "Payoneer current-balance snapshot endpoint is not wired yet.", sourceRow: 11 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "Payoneer - dol");
  assert.equal(row.status, "provider_not_implemented");
  assert.equal(row.factual_closing_balance, null);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.balanceSource, "missing");
  assert.equal(row.factStatus, "provider_not_implemented");
  assert.equal(row.sourceSheet, "Авто Остатки");
  assert.equal(row.sourceRow, 11);
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.provider_not_implemented, 1);
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.auto_balance_status_rows_loaded, 1);
  assert.deepEqual(snapshot.period_balance_reconciliation.diagnostics.auto_balance_status_counts, {
    provider_not_implemented: 1,
  });
});

test("manual fact still beats same-date blank auto status row", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-10",
          toChannel: "пейпал дол",
          currency: "USD",
          amountNet: "20",
          balanceAmount: 20,
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "пейпал дол",
            currency: "USD",
            amount_net: "20",
            balance_amount: 20,
          },
        },
      ],
      balances: [
        { date: "2026-04-30", channel: "пейпал дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-17", channel: "пейпал дол", currency: "USD", amount: "120", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-17", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "", source: "provider_auto", sourceSheet: "Авто Остатки", status: "needs_provider_permission", comment: "PayPal permission missing", sourceRow: 12 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "пейпал дол");
  assert.equal(row.status, "ok");
  assert.equal(row.factual_closing_balance, 120);
  assert.equal(row.balanceSource, "manual_fact");
  assert.equal(row.factStatus, "confirmed");
  assert.equal(row.sourceSheet, "Остатки");
});

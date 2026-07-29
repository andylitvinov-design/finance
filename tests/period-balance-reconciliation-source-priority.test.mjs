import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodBalanceReconciliationSnapshot } from "../server/period-balance-reconciliation-route.js";
import { buildOwnerConfirmedJulySnapshotRows } from "../server/authoritative-balance-snapshot-contract.js";

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

test("opening-only row is labeled as calculated fallback, not closing manual fact", async () => {
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
  assert.equal(row.status, "calculated_from_previous");
  assert.equal(row.closing_balance_source, "calculated");
  assert.equal(row.balanceSource, "calculated_balance");
  assert.equal(row.needsManualConfirmation, false);
  assert.equal(row.sourceSheet, "Расчетные Остатки");
  assert.equal(row.factStatus, "calculated_from_previous");
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.factual_closing_balance, 100);
});

test("blank auto status row stays diagnostic while calculated fallback covers EOD", async () => {
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
  assert.equal(row.status, "calculated_from_previous");
  assert.equal(row.factual_closing_balance, 120);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.balanceSource, "calculated_balance");
  assert.equal(row.factStatus, "calculated_from_previous");
  assert.equal(row.providerStatus, null);
  assert.equal(row.sourceSheet, "Расчетные Остатки");
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.provider_not_implemented, 0);
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.calculated_from_previous, 1);
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

test("PayPal manual balance in Авто Остатки is factual and keeps provider warning separately", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-20", to: "2026-05-20" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-20",
          toChannel: "пейпал дол",
          currency: "USD",
          amountNet: "23.45",
          balanceAmount: 23.45,
          ledgerV2: {
            date: "2026-05-20",
            operation: "income",
            to_channel: "пейпал дол",
            currency: "USD",
            amount_net: "23.45",
            balance_amount: 23.45,
          },
        },
      ],
      balances: [
        { date: "2026-05-19", channel: "пейпал дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "", source: "paypal_auto", sourceSheet: "Авто Остатки", status: "needs_provider_permission", comment: "PayPal OAuth failed (401)", sourceRow: 9 },
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "123.45", source: "paypal_manual_balance", sourceSheet: "Авто Остатки", status: "ok", comment: "manual PayPal balance because REST balance API unavailable for personal account", sourceRow: 10 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "пейпал дол");
  assert.equal(row.status, "ok");
  assert.equal(row.factual_closing_balance, 123.45);
  assert.equal(row.balanceSource, "manual_fact");
  assert.equal(row.factStatus, "confirmed");
  assert.equal(row.needsManualConfirmation, false);
  assert.equal(row.sourceSheet, "Авто Остатки");
  assert.equal(row.sourceRow, 10);
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.auto_balance_status_rows_loaded, 1);
  assert.deepEqual(snapshot.period_balance_reconciliation.diagnostics.auto_balance_status_counts, {
    needs_provider_permission: 1,
  });
});

test("PayPal derived balance is used below manual/provider factual rows and keeps warning separately", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-20" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-10",
          toChannel: "пейпал дол",
          currency: "USD",
          amountNet: "30",
          balanceAmount: 30,
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "пейпал дол",
            currency: "USD",
            amount_net: "30",
            balance_amount: 30,
          },
        },
      ],
      balances: [
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "", source: "paypal_auto", sourceSheet: "Авто Остатки", status: "needs_provider_permission", comment: "PayPal OAuth failed (401)", sourceRow: 9 },
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "130", source: "paypal_derived_balance", sourceSheet: "Авто Остатки", status: "derived_from_confirmed_opening", comment: "Derived from latest confirmed PayPal balance on 2026-05-01 plus Ledger amount_net movements because PayPal REST balance API is unavailable for this account.", sourceRow: 10 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "пейпал дол");
  assert.equal(row.status, "ok");
  assert.equal(row.factual_closing_balance, 130);
  assert.equal(row.balanceSource, "derived_balance");
  assert.equal(row.factStatus, "derived_pending");
  assert.equal(row.factSource, "derived");
  assert.equal(row.needsManualConfirmation, true);
  assert.equal(row.sourceSheet, "Авто Остатки");
  assert.equal(row.sourceRow, 10);
  assert.deepEqual(snapshot.period_balance_reconciliation.diagnostics.auto_balance_status_counts, {
    needs_provider_permission: 1,
  });
});

test("same-date manual PayPal factual balance outranks derived", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-20" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [],
      balances: [
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-20", channel: "пейпал дол", currency: "USD", amount: "140", source: "paypal_manual_balance", sourceSheet: "Авто Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "130", source: "paypal_derived_balance", sourceSheet: "Авто Остатки", status: "derived_from_confirmed_opening", comment: "Derived from latest confirmed PayPal balance on 2026-05-01 plus Ledger amount_net movements because PayPal REST balance API is unavailable for this account.", sourceRow: 10 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "пейпал дол");
  assert.equal(row.factual_closing_balance, 140);
  assert.equal(row.balanceSource, "manual_fact");
  assert.equal(row.factStatus, "confirmed");
});

test("same-date PayPal provider factual balance outranks derived", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-20" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [],
      balances: [
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "150", source: "paypal_auto", sourceSheet: "Авто Остатки", status: "ok", comment: "provider factual API row", sourceRow: 9 },
        { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "130", source: "paypal_derived_balance", sourceSheet: "Авто Остатки", status: "derived_from_confirmed_opening", comment: "Derived from latest confirmed PayPal balance on 2026-05-01 plus Ledger amount_net movements because PayPal REST balance API is unavailable for this account.", sourceRow: 10 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((item) => item.channel === "пейпал дол");
  assert.equal(row.factual_closing_balance, 150);
  assert.equal(row.balanceSource, "provider_auto");
  assert.equal(row.factStatus, "auto_pending");
  assert.equal(row.sourceRow, 9);
});

test("manual period-start opening overrides auto and auto-only fact stays pending", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-03" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [
        {
          date: "2026-05-02",
          toChannel: "трансервайз дол",
          currency: "USD",
          amountNet: "50",
          balanceAmount: 50,
          ledgerV2: {
            date: "2026-05-02",
            operation: "income",
            to_channel: "трансервайз дол",
            currency: "USD",
            amount_net: "50",
            balance_amount: 50,
          },
        },
        {
          date: "2026-05-02",
          toChannel: "трансервайз евро",
          currency: "EUR",
          amountNet: "20",
          balanceAmount: 20,
          ledgerV2: {
            date: "2026-05-02",
            operation: "income",
            to_channel: "трансервайз евро",
            currency: "EUR",
            amount_net: "20",
            balance_amount: 20,
          },
        },
      ],
      balances: [
        { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-03", channel: "трансервайз дол", currency: "USD", amount: "150", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-01", provider: "wise", channel: "трансервайз дол", currency: "USD", amount: "999", source: "provider_auto", sourceSheet: "Авто Остатки", status: "ok", sourceRow: 21 },
        { date: "2026-05-01", provider: "wise", channel: "трансервайз евро", currency: "EUR", amount: "200", source: "provider_auto", sourceSheet: "Авто Остатки", status: "ok", sourceRow: 22 },
        { date: "2026-05-03", provider: "wise", channel: "трансервайз евро", currency: "EUR", amount: "220", source: "provider_auto", sourceSheet: "Авто Остатки", status: "ok", sourceRow: 23 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const rows = snapshot.period_balance_reconciliation.by_channel_currency;
  const manualOpening = rows.find((item) => item.channel === "трансервайз дол" && item.currency === "USD");
  const autoFact = rows.find((item) => item.channel === "трансервайз евро" && item.currency === "EUR");

  assert.equal(manualOpening.status, "ok");
  assert.equal(manualOpening.opening_balance, 100);
  assert.equal(manualOpening.opening_balance_date, "2026-05-01");
  assert.equal(manualOpening.factual_closing_balance, 150);
  assert.equal(manualOpening.balanceSource, "manual_fact");
  assert.equal(manualOpening.needsManualConfirmation, false);
  assert.equal(manualOpening.sourceSheet, "Остатки");

  assert.equal(autoFact.status, "ok");
  assert.equal(autoFact.opening_balance, 200);
  assert.equal(autoFact.opening_balance_date, "2026-05-01");
  assert.equal(autoFact.factual_closing_balance, 220);
  assert.equal(autoFact.balanceSource, "provider_auto");
  assert.equal(autoFact.factStatus, "auto_pending");
  assert.equal(autoFact.needsManualConfirmation, true);
  assert.equal(autoFact.sourceSheet, "Авто Остатки");
  assert.equal(autoFact.sourceRow, 23);
});

test("reconciliation exposes factual-full owner opening and closing without changing ledger movement", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-07-01", to: "2026-07-29" },
    repositoryLoader: async () => ({
      ok: true,
      operations: [],
      balances: buildOwnerConfirmedJulySnapshotRows(),
      autoBalances: [
        { date: "2026-07-01", channel: "Бинанс spot", currency: "USDT", amount: "999", source: "provider", sourceSheet: "Авто Остатки" },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.period_balance_reconciliation.authoritative_snapshot, {
    opening: { date: "2026-07-01", total_usd: 21090.5, source_status: "factual_full" },
    closing: { date: "2026-07-29", total_usd: 22454.5, source_status: "factual_full" },
    factual_change_usd: 1364,
    ledger_movement_usd: null,
    unexplained_difference_usd: null,
  });
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.excluded_from_authoritative_total, 1);
});

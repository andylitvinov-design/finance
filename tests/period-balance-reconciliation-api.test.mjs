import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPeriodBalanceReconciliationSnapshot,
  convertYooMoneyEntriesToProviderEvidenceRows,
} from "../server/period-balance-reconciliation-route.js";
import { buildYooMoneyProviderEvidenceFixture } from "../server/provider-ledger-reconciliation-engine.js";

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
  assert.equal(snapshot.mode.effective, "dry_run");
  assert.equal(snapshot.mutates_data, false);
  assert.equal(snapshot.period_balance_reconciliation.summary.planned_source_status, "ok");
  assert.equal(snapshot.period_balance_reconciliation.by_currency[0].planned_delta, 400);
  assert.equal(snapshot.period_balance_reconciliation.by_currency[0].real_delta, 300);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].plan_vs_real_delta, -100);
  assert.deepEqual(
    snapshot.period_balance_reconciliation.reconciliation_report.map((row) => ({
      channel: row.channel,
      currency: row.currency,
      opening_2026_05_01: row.opening_2026_05_01,
      income_amount_net: row.income_amount_net,
      expense_amount_net: row.expense_amount_net,
      transfer_in: row.transfer_in,
      transfer_out: row.transfer_out,
      exchange_delta: row.exchange_delta,
      provider_adjustments: row.provider_adjustments,
      expected_later_balance: row.expected_later_balance,
      confirmed_later_balance: row.confirmed_later_balance,
      diff: row.diff,
      status: row.status,
      suspected_cause: row.suspected_cause,
    })),
    [{
      channel: "wise usd",
      currency: "USD",
      opening_2026_05_01: 1000,
      income_amount_net: 300,
      expense_amount_net: 0,
      transfer_in: 0,
      transfer_out: 0,
      exchange_delta: 0,
      provider_adjustments: 0,
      expected_later_balance: 1300,
      confirmed_later_balance: 1300,
      diff: 0,
      status: "ok",
      suspected_cause: "none",
    }]
  );
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.balance_snapshot_rows_loaded, 2);
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.analytics_fact_rows_rendered, 1);
  assert.doesNotMatch(snapshot.warnings.join("\n"), /planned.*source.*unavailable|planned income\/expense source is not connected/i);
});

test("period reconciliation exposes complete daily balance coverage diagnostics and optional rows", async () => {
  const repositoryLoader = async () => ({
    ok: true,
    schema: "ledger-v2-compatible",
    operations: [
      {
        date: "2026-05-02",
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
      },
    ],
    balances: [
      { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
    ],
    plannedRows: [],
    plannedSourceStatus: "available",
    warnings: [],
  });
  const defaultSnapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-03" },
    repositoryLoader,
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    yooMoneyProviderEvidenceLoader: async () => ({ source: "not_connected", rows: [], warning: null }),
  });
  const fullSnapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-03", includeDailyBalances: "1" },
    repositoryLoader,
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    yooMoneyProviderEvidenceLoader: async () => ({ source: "not_connected", rows: [], warning: null }),
  });

  const coverage = defaultSnapshot.period_balance_reconciliation.daily_balance_coverage;
  assert.equal(coverage.period_days, 3);
  assert.equal(coverage.expected_rows, coverage.period_days * coverage.active_pairs);
  assert.equal(coverage.actual_rows, coverage.expected_rows);
  assert.equal(coverage.complete, true);
  assert.ok(coverage.status_counts);
  assert.equal(defaultSnapshot.period_balance_reconciliation.daily_balance_rows, undefined);
  assert.ok(defaultSnapshot.period_balance_reconciliation.daily_balance_rows_preview.length > 0);
  assert.equal(
    fullSnapshot.period_balance_reconciliation.daily_balance_rows.length,
    fullSnapshot.period_balance_reconciliation.daily_balance_coverage.expected_rows
  );
});

test("period reconciliation API uses calculated daily EOD fallback without requiring manual fact", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-04-22", to: "2026-05-21", includeDailyBalances: "1" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-21",
          fromChannel: "приват 24-грн",
          currency: "UAH",
          amountNet: "100",
          balanceAmount: -100,
          ledgerV2: {
            date: "2026-05-21",
            operation: "expense",
            from_channel: "приват 24-грн",
            currency: "UAH",
            amount_net: "100",
            balance_amount: -100,
          },
        },
      ],
      balances: [
        { date: "2026-05-20", channel: "приват 24-грн", currency: "UAH", amount: "20096", balanceSource: "manual_fact", sourceSheet: "Остатки" },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    yooMoneyProviderEvidenceLoader: async () => ({ source: "not_connected", rows: [], warning: null }),
  });

  const row = snapshot.period_balance_reconciliation.by_channel_currency.find((entry) => entry.channel === "приват 24-грн" && entry.currency === "UAH");
  assert.equal(row.status, "calculated_from_previous");
  assert.equal(row.factual_closing_balance, 19996);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.fact_source, "calculated");
  assert.equal(row.balanceSource, "calculated_balance");
  assert.equal(snapshot.period_balance_reconciliation.summary.calculated_balance_rows, 1);
  assert.equal(snapshot.period_balance_reconciliation.summary.missing_fact_rows, 0);
  assert.equal(snapshot.period_balance_reconciliation.required_manual_fact_rows.length, 0);
  assert.equal(snapshot.period_balance_reconciliation.diagnostics.calculated_balance_rows_built, 1);
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

test("period balance reconciliation uses exact Yandex manual fact on period end date", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-19" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        {
          date: "2026-05-10",
          fromChannel: "Яндекс руб",
          currency: "RUB",
          amountNet: "72655.37",
          balanceAmount: -72655.37,
          ledgerV2: { date: "2026-05-10", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "72655.37", balance_amount: "-72655.37" },
        },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [
        { date: "2026-04-28", channel: "Яндекс руб", currency: "RUB", amount: "142858.88", balanceSource: "manual_fact", sourceSheet: "Остатки", sourceRow: 26 },
        { date: "2026-05-19", channel: "Яндекс руб", currency: "RUB", amount: "70203.51", balanceSource: "manual_fact", sourceSheet: "Остатки", sourceRow: 67 },
      ],
      autoBalances: [
        { date: "2026-05-19", provider: "wise", channel: "трансервайз евро", currency: "EUR", amount: "158.56", balanceSource: "provider_auto", sourceSheet: "Авто Остатки", sourceRow: 13, comment: "wise auto snapshot" },
      ],
      warnings: [],
    }),
  });

  const yandex = snapshot.period_balance_reconciliation.by_channel_currency.find((row) => row.channel === "Яндекс руб" && row.currency === "RUB");
  const wise = snapshot.period_balance_reconciliation.by_channel_currency.find((row) => row.channel === "трансервайз евро" && row.currency === "EUR");

  assert.equal(yandex.manual_provider_closing_balance, 70203.51);
  assert.equal(yandex.manual_provider_closing_balance_date, "2026-05-19");
  assert.equal(yandex.balanceSource, "manual_fact");
  assert.equal(yandex.needsManualConfirmation, false);
  assert.equal(yandex.sourceSheet, "Остатки");
  assert.equal(yandex.sourceRow, 67);
  assert.equal(yandex.status, "ok");
  assert.equal(wise.manual_provider_closing_balance, 158.56);
  assert.equal(wise.sourceSheet, "Авто Остатки");
});

test("period balance reconciliation exposes YooMoney provider-vs-ledger status without factual balance mutation", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-05-01", to: "2026-05-19" },
    yooMoneyProviderEvidenceLoader: async () => ({
      source: "live_yoomoney",
      rows: buildYooMoneyProviderEvidenceFixture(),
      warning: null,
    }),
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        { date: "2026-05-05", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "74771.50", balanceAmount: -74771.5, source: "yoomoney", ledgerV2: { date: "2026-05-05", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "74771.50", balance_amount: "-74771.5", source: "yoomoney" } },
        { date: "2026-05-06", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "25", balanceAmount: -25, source: "yoomoney", ledgerV2: { date: "2026-05-06", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "25", balance_amount: "-25", source: "yoomoney" } },
        { date: "2026-05-07", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "500", balanceAmount: -500, source: "yoomoney", ledgerV2: { date: "2026-05-07", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "500", balance_amount: "-500", source: "yoomoney" } },
        { date: "2026-05-08", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8674.29", balanceAmount: 8674.29, source: "yoomoney", ledgerV2: { date: "2026-05-08", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8674.29", balance_amount: "8674.29", source: "yoomoney" } },
        { date: "2026-05-08", toChannel: "Яндекс руб", currency: "RUB", amountNet: "4337.15", balanceAmount: 4337.15, source: "yoomoney", ledgerV2: { date: "2026-05-08", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "4337.15", balance_amount: "4337.15", source: "yoomoney" } },
        { date: "2026-05-09", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "4297", balanceAmount: -4297, source: "yoomoney", ledgerV2: { date: "2026-05-09", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "4297", balance_amount: "-4297", source: "yoomoney" } },
        { date: "2026-05-09", toChannel: "Яндекс руб", currency: "RUB", amountNet: "431.82", balanceAmount: 431.82, source: "yoomoney", ledgerV2: { date: "2026-05-09", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "431.82", balance_amount: "431.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8.82", balanceAmount: 8.82, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8.82", balance_amount: "8.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8.82", balanceAmount: 8.82, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8.82", balance_amount: "8.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8.82", balanceAmount: 8.82, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8.82", balance_amount: "8.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8.82", balanceAmount: 8.82, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8.82", balance_amount: "8.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "8.82", balanceAmount: 8.82, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "8.82", balance_amount: "8.82", source: "yoomoney" } },
        { date: "2026-05-10", toChannel: "Яндекс руб", currency: "RUB", amountNet: "440.77", balanceAmount: 440.77, source: "yoomoney", ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "440.77", balance_amount: "440.77", source: "yoomoney" } },
        { date: "2026-05-14", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "6990", balanceAmount: -6990, source: "yoomoney", ledgerV2: { date: "2026-05-14", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "6990", balance_amount: "-6990", source: "yoomoney" } },
      ],
      balances: [
        { date: "2026-04-30", channel: "Яндекс руб", currency: "RUB", amount: "1722", balanceSource: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-19", channel: "Яндекс руб", currency: "RUB", amount: "1", balanceSource: "manual_fact", sourceSheet: "Остатки", sourceRow: 63 },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      warnings: [],
    }),
  });

  const summary = snapshot.period_balance_reconciliation.summary;
  assert.equal(summary.transaction_reconciliation_status, "ok");
  assert.equal(summary.monthly_total_status, "ok");
  assert.equal(summary.provider_evidence_total.expense, 86583.5);
  assert.equal(summary.ledger_provider_total.expense, 86583.5);
  assert.equal(summary.raw_ledger_yoomoney_net, -72655.37);
  assert.equal(summary.confirmed_matched_ledger_net, -72655.37);
  assert.equal(summary.transaction_monthly_delta, 0);
  assert.equal(summary.transaction_delta, 0);
  assert.equal(summary.stale_ostatki_rows[0].classification, "stale_or_wrong_ostatki_needs_provider_balance");
  assert.equal(summary.manual_confirmation_required_rows[0].amount_hint !== undefined, true);
});

test("production period reconciliation route does not call YooMoney fixture", () => {
  const source = readFileSync(new URL("../server/period-balance-reconciliation-route.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /buildYooMoneyProviderEvidenceFixture/);
  assert.match(source, /fetchYooMoneyStatementEntries/);
});

test("YooMoney live API entries are converted to signed provider evidence", () => {
  const rows = convertYooMoneyEntriesToProviderEvidenceRows([
    {
      date: "2026-04-08",
      direction: "income",
      localAmount: 9350.24,
      currency: "RUB",
      operation_id: "income-1",
      organization: "Перевод",
      comment: "client",
    },
    {
      date: "2026-04-09",
      direction: "expense",
      amount: 4297,
      currency: "RUB",
      sourceTransactionId: "expense-1",
      counterpartyName: "RK*OOO_SALEBOT",
    },
  ]);

  assert.deepEqual(rows.map((row) => ({
    date: row.date,
    signedAmount: row.signedAmount,
    currency: row.currency,
    channel: row.channel,
    source: row.source,
    source_id: row.source_id,
  })), [
    {
      date: "2026-04-08",
      signedAmount: 9350.24,
      currency: "RUB",
      channel: "Яндекс руб",
      source: "yoomoney",
      source_id: "income-1",
    },
    {
      date: "2026-04-09",
      signedAmount: -4297,
      currency: "RUB",
      channel: "Яндекс руб",
      source: "yoomoney",
      source_id: "expense-1",
    },
  ]);
});

test("period reconciliation uses fetchYooMoneyStatementEntries when YooMoney token is configured", async () => {
  const requests = [];
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-04-01", to: "2026-04-30" },
    yooMoneyAccessToken: "configured-token",
    yooMoneyBaseUrl: "https://yoomoney.example",
    yooMoneyFetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          operations: [
            {
              datetime: "2026-04-08T12:00:00Z",
              direction: "in",
              amount: "9350.24",
              currency: "RUB",
              operation_id: "op-income",
              title: "Client income",
            },
            {
              datetime: "2026-04-09T12:00:00Z",
              direction: "out",
              amount: "4297",
              currency: "RUB",
              operation_id: "op-expense",
              title: "Provider expense",
            },
          ],
        }),
      };
    },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        { date: "2026-04-08", toChannel: "Яндекс руб", currency: "RUB", amountNet: "9350.24", balanceAmount: 9350.24, source: "yoomoney", ledgerV2: { date: "2026-04-08", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "9350.24", balance_amount: "9350.24", source: "yoomoney", raw_source_id: "op-income" } },
        { date: "2026-04-09", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "4297", balanceAmount: -4297, source: "yoomoney", ledgerV2: { date: "2026-04-09", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "4297", balance_amount: "-4297", source: "yoomoney", raw_source_id: "op-expense" } },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [],
      warnings: [],
    }),
  });

  const yoomoney = snapshot.period_balance_reconciliation.provider_ledger_reconciliation.yoomoney;
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://yoomoney.example/api/operation-history");
  assert.equal(new URLSearchParams(requests[0].options.body).get("type"), "deposition payment");
  assert.equal(new URLSearchParams(requests[1].options.body).get("type"), null);
  assert.match(String(requests[0].options.body), /from=2026-04-01T00%3A00%3A00Z/);
  assert.equal(yoomoney.provider_evidence_source, "live_yoomoney");
  assert.equal(yoomoney.row_level.provider_status_counts.matched_exact, 2);
  assert.equal(yoomoney.provider_evidence_total.income, 9350.24);
  assert.equal(yoomoney.provider_evidence_total.expense, 4297);
});

test("period reconciliation reports YooMoney not connected without Ledger safe fixes", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-04-01", to: "2026-04-30" },
    yooMoneyAccessToken: "",
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        { date: "2026-04-08", toChannel: "Яндекс руб", currency: "RUB", amountNet: "999", balanceAmount: 999, source: "yoomoney", ledgerV2: { date: "2026-04-08", operation: "income", to_channel: "Яндекс руб", currency: "RUB", amount_net: "999", balance_amount: "999", source: "yoomoney" } },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [],
      warnings: [],
    }),
  });

  const yoomoney = snapshot.period_balance_reconciliation.provider_ledger_reconciliation.yoomoney;
  assert.equal(yoomoney.status, "provider_not_connected");
  assert.equal(yoomoney.provider_evidence_source, "not_connected");
  assert.equal(yoomoney.provider_warning.code, "yoomoney_not_connected");
  assert.deepEqual(yoomoney.safe_fixes_available, []);
  assert.deepEqual(yoomoney.row_level.extra_ledger_rows, []);
  assert.deepEqual(snapshot.period_balance_reconciliation.summary.safe_fixes_available, []);
});

test("fixture mismatch cannot mark Ledger as wrong when YooMoney API is not connected", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-04-01", to: "2026-04-30" },
    yooMoneyAccessToken: "",
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        { date: "2026-04-03", fromChannel: "Яндекс руб", currency: "RUB", amountNet: "74668.50", balanceAmount: -74668.5, source: "yoomoney", ledgerV2: { date: "2026-04-03", operation: "expense", from_channel: "Яндекс руб", currency: "RUB", amount_net: "74668.50", balance_amount: "-74668.5", source: "yoomoney" } },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      balances: [],
      warnings: [],
    }),
  });

  const yoomoney = snapshot.period_balance_reconciliation.provider_ledger_reconciliation.yoomoney;
  assert.equal(yoomoney.provider_evidence_source, "not_connected");
  assert.equal(yoomoney.extra_ledger_status, "provider_not_connected");
  assert.deepEqual(yoomoney.row_level.extra_ledger_rows, []);
  assert.deepEqual(yoomoney.manual_confirmation_required_rows, []);
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
        status: "missing_opening_balance",
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

test("period balance reconciliation API reports planned source gap while calculated fallback covers target-date fact", async () => {
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
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.carried_forward_conditional, 0);
  assert.equal(snapshot.period_balance_reconciliation.summary.status_counts.missing_provider_balance, 0);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].status, "calculated_from_previous");
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].factual_closing_balance, 1000);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].carried_forward_balance, null);
  assert.equal(snapshot.period_balance_reconciliation.by_channel_currency[0].closing_balance_source, "calculated");
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

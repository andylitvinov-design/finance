import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderLedgerReconciliation,
  buildYooMoneyProviderEvidenceFixture,
} from "../server/provider-ledger-reconciliation-engine.js";

function ledgerRow(overrides = {}) {
  const signedAmount = Number(overrides.signedAmount ?? 0);
  const isExpense = signedAmount < 0;
  return {
    sheetRowNumber: overrides.sheetRowNumber ?? null,
    date: overrides.date,
    operation: isExpense ? "expense" : "income",
    fromChannel: isExpense ? (overrides.channel ?? "Яндекс руб") : "",
    toChannel: isExpense ? "" : (overrides.channel ?? "Яндекс руб"),
    currency: overrides.currency ?? "RUB",
    amountNet: String(Math.abs(signedAmount)),
    balanceAmount: signedAmount,
    source: overrides.source ?? "yoomoney",
    rawSourceId: overrides.rawSourceId ?? "",
    comment: overrides.comment ?? "",
    ledgerV2: {
      date: overrides.date,
      operation: isExpense ? "expense" : "income",
      from_channel: isExpense ? (overrides.channel ?? "Яндекс руб") : "",
      to_channel: isExpense ? "" : (overrides.channel ?? "Яндекс руб"),
      currency: overrides.currency ?? "RUB",
      amount_net: String(Math.abs(signedAmount)),
      balance_amount: String(signedAmount),
      source: overrides.source ?? "yoomoney",
      raw_source_id: overrides.rawSourceId ?? "",
      external_id: overrides.externalId ?? overrides.rawSourceId ?? "",
      comment: overrides.comment ?? "",
    },
  };
}

test("YooMoney May expenses equal 86583.50 and visible expense rows match provider evidence", () => {
  const providerEvidence = buildYooMoneyProviderEvidenceFixture()
    .filter((row) => row.date >= "2026-05-01" && row.date <= "2026-05-19");
  const ledgerRows = providerEvidence.map((row, index) => ledgerRow({
    sheetRowNumber: 100 + index,
    date: row.date,
    signedAmount: row.signedAmount,
    comment: row.description,
  }));

  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence,
    ledgerRows,
    period: { from: "2026-05-01", to: "2026-05-19" },
  });

  assert.equal(report.provider_totals.by_month["2026-05"].expense, 86583.5);
  assert.equal(report.provider_totals.by_month["2026-05"].expense_display, "86,583.50");
  assert.equal(report.row_level.provider_status_counts.matched_exact, providerEvidence.length);
  assert.equal(report.row_level.provider_status_counts.missing_in_ledger || 0, 0);
});

test("YooMoney fixture classifies wrong date without monthly mismatch", () => {
  const providerEvidence = buildYooMoneyProviderEvidenceFixture()
    .filter((row) => row.date >= "2026-04-01" && row.date <= "2026-04-30");
  const ledgerRows = [
    ledgerRow({ sheetRowNumber: 41, date: "2026-04-08", signedAmount: 9350.24 }),
    ledgerRow({ sheetRowNumber: 42, date: "2026-04-08", signedAmount: 9350.24 }),
    ledgerRow({ sheetRowNumber: 43, date: "2026-04-08", signedAmount: 9350.24 }),
    ledgerRow({ sheetRowNumber: 44, date: "2026-04-09", signedAmount: -4297, comment: "RK*OOO_SALEBOT" }),
    ledgerRow({ sheetRowNumber: 45, date: "2026-04-11", signedAmount: 850 }),
    ledgerRow({ sheetRowNumber: 46, date: "2026-04-14", signedAmount: 9376.54 }),
    ledgerRow({ sheetRowNumber: 47, date: "2026-04-14", signedAmount: 9376.54 }),
    ledgerRow({ sheetRowNumber: 48, date: "2026-04-14", signedAmount: -6990, comment: "BITRIX24" }),
    ledgerRow({ sheetRowNumber: 49, date: "2026-04-18", signedAmount: 9376.54 }),
    ledgerRow({ sheetRowNumber: 50, date: "2026-04-18", signedAmount: 9376.54 }),
    ledgerRow({ sheetRowNumber: 51, date: "2026-04-24", signedAmount: -12920 }),
    ledgerRow({ sheetRowNumber: 52, date: "2026-04-24", signedAmount: 12920, comment: "refund" }),
    ledgerRow({ sheetRowNumber: 53, date: "2026-04-24", signedAmount: -5195 }),
    ledgerRow({ sheetRowNumber: 54, date: "2026-04-25", signedAmount: 2755.86 }),
    ledgerRow({ sheetRowNumber: 55, date: "2026-04-27", signedAmount: 2633.9 }),
    ledgerRow({ sheetRowNumber: 56, date: "2026-04-28", signedAmount: 438.98 }),
  ];

  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence,
    ledgerRows,
    period: { from: "2026-04-01", to: "2026-04-30" },
  });

  assert.equal(report.differences.by_month["2026-04"].provider_vs_yoomoney, 0);
  assert.equal(report.monthly_total_status, "ok");
  assert.equal(report.date_alignment_status, "needs_source_id_confirmation");
  assert.equal(report.provider_net, 55753.62);
  assert.equal(report.raw_ledger_yoomoney_net, 55753.62);
  assert.equal(report.confirmed_matched_ledger_net, 55753.62);
  assert.equal(report.transaction_monthly_delta, 0);
  assert.equal(report.row_level.provider_total_rows.length, 16);
  assert.equal(report.row_level.ledger_yoomoney_total_rows.length, 16);
  assert.equal(report.row_level.wrong_date_rows.length, 1);
  assert.equal(report.row_level.provider_status_counts.matched_wrong_date, 1);
  assert.equal(report.row_level.provider_rows.find((row) => row.date === "2026-04-09" && row.signed_amount === 9350.24).status, "matched_wrong_date");
  assert.equal(report.row_level.ledger_rows.find((row) => row.sheetRowNumber === 54).status, "confirmed_by_provider");
});

test("manual migration rows are quarantined separately from provider totals", () => {
  const providerEvidence = buildYooMoneyProviderEvidenceFixture()
    .filter((row) => row.date >= "2026-04-01" && row.date <= "2026-04-30");
  const ledgerRows = [
    ...providerEvidence.map((row, index) => ledgerRow({
      sheetRowNumber: 40 + index,
      date: row.date,
      signedAmount: row.signedAmount,
    })),
    ledgerRow({ sheetRowNumber: 2, date: "2026-04-24", signedAmount: -11287, source: "migration", rawSourceId: "migration:2026-04-24:2" }),
    ledgerRow({ sheetRowNumber: 5, date: "2026-04-24", signedAmount: -74669, source: "migration", rawSourceId: "migration:2026-04-24:5" }),
  ];

  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence,
    ledgerRows,
    period: { from: "2026-04-01", to: "2026-04-30" },
  });

  assert.equal(report.ledger_totals.by_month["2026-04"].yoomoney.net, report.provider_totals.by_month["2026-04"].net);
  assert.equal(report.ledger_totals.by_month["2026-04"].manual_migration.net, -85956);
  assert.equal(report.manual_migration_total.net, -85956);
  assert.equal(report.combined_total.net, -30202.38);
  assert.equal(report.differences.by_month["2026-04"].provider_vs_yoomoney, 0);
  assert.equal(report.differences.by_month["2026-04"].provider_vs_combined, -85956);
  assert.deepEqual(
    report.row_level.manual_migration_rows.map((row) => row.sheetRowNumber).sort((a, b) => a - b),
    [2, 5]
  );
  assert.deepEqual(
    report.manual_blockers.manual_migration_confirmation_needed.map((row) => row.sheetRowNumber).sort((a, b) => a - b),
    [2, 5]
  );
});

test("extra YooMoney ledger rows are quarantined separately from matched monthly total", () => {
  const providerEvidence = [
    { date: "2026-04-25", signedAmount: 2755.86, description: "provider payment" },
  ];
  const ledgerRows = [
    ledgerRow({ sheetRowNumber: 43, date: "2026-04-25", signedAmount: 2755.86 }),
    ledgerRow({ sheetRowNumber: 99, date: "2026-04-25", signedAmount: -21507.46, source: "yoomoney" }),
    ledgerRow({ sheetRowNumber: 5, date: "2026-04-24", signedAmount: -74669, source: "migration", rawSourceId: "migration:2026-04-24:5" }),
  ];

  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence,
    ledgerRows,
    period: { from: "2026-04-01", to: "2026-04-30" },
  });

  assert.equal(report.transaction_reconciliation_status, "ok");
  assert.equal(report.monthly_total_status, "ok");
  assert.equal(report.extra_ledger_status, "needs_confirmation");
  assert.equal(report.raw_ledger_yoomoney_net, 2755.86);
  assert.equal(report.legacy_source_yoomoney_total.net, -18751.6);
  assert.equal(report.extra_ledger_total.net, -21507.46);
  assert.equal(report.differences.by_month["2026-04"].provider_vs_yoomoney, 0);
  assert.equal(report.row_level.ledger_rows.find((row) => row.sheetRowNumber === 99).status, "not_in_provider_statement");
  assert.deepEqual(report.row_level.extra_ledger_rows.map((row) => row.sheetRowNumber), [99]);
  assert.equal(report.row_level.ledger_rows.find((row) => row.sheetRowNumber === 5).status, "manual_migration_needs_confirmation");
});

test("matching provider operations keeps stale Остатки mismatch out of transaction layer", () => {
  const providerEvidence = buildYooMoneyProviderEvidenceFixture()
    .filter((row) => row.date >= "2026-05-01" && row.date <= "2026-05-19");
  const ledgerRows = providerEvidence.map((row, index) => ledgerRow({
    sheetRowNumber: 160 + index,
    date: row.date,
    signedAmount: row.signedAmount,
  }));

  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence,
    ledgerRows,
    balanceDiagnostics: [
      {
        date: "2026-05-05",
        channel: "Яндекс руб",
        currency: "RUB",
        status: "mismatch",
        computed_closing_balance: -73049.5,
        provider_reported_balance: 68087.38,
        sourceRow: 63,
      },
    ],
    period: { from: "2026-05-01", to: "2026-05-19" },
  });

  assert.equal(report.transaction_reconciliation_status, "ok");
  assert.equal(report.balance_diagnostics.rows[0].classification, "stale_or_wrong_ostatki_needs_provider_balance");
  assert.equal(report.balance_diagnostics.copyable_rows[0].amount_hint, -73049.5);
  assert.equal(report.balance_diagnostics.copyable_rows[0].needs_provider_confirmation, true);
  assert.equal(report.balance_diagnostics.copyable_rows[0].do_not_apply_automatically, true);
});

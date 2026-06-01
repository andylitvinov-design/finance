import test from "node:test";
import assert from "node:assert/strict";

import { runReconcileBalancesAndTransfers } from "../server/reconcile-balances-and-transfers.js";

test("reconcile balances ensures FX Rates before balances and audit snapshot", async () => {
  const calls = [];
  const result = await runReconcileBalancesAndTransfers({
    from: "2026-05-28",
    to: "2026-05-28",
    currentDate: "2026-05-28",
    fetchImpl: async () => {
      throw new Error("provider fetch should be injected in this test");
    },
    ensureFxRatesRunner: async (options) => {
      calls.push(["ensure_fx_rates", options.from, options.to, options.currentDate, options.currencies]);
      return {
        ok: true,
        checked: 7,
        fetched_rows: 7,
        fallback_rows: 0,
        missing_after_ensure: 0,
        errors: [],
      };
    },
    autoBalanceRunner: async () => {
      calls.push(["auto_balance_snapshots"]);
      return { ok: true, saved_rows: 1, providers_checked: ["wise"], providers_succeeded: ["wise"], provider_results: [] };
    },
    auditSnapshotRunner: async () => {
      calls.push(["audit_snapshot"]);
      return { ok: true, balances: { remainders_rows: [] } };
    },
    selectedDateSnapshotRunner: async () => {
      calls.push(["selected_date_balance_snapshot"]);
      return { ok: true, balance_snapshots: { canonical_total_usd: 10, selected_date_coverage: { status: "ok" }, provider_channel_matrix: [] } };
    },
    periodReconciliationRunner: async () => {
      calls.push(["period_balance_reconciliation"]);
      return { ok: true, period_balance_reconciliation: { total_usd_row: { confirmed_end_usd: 10, status: "ok" } } };
    },
    providerTransferCollector: async () => {
      calls.push(["provider_transfers"]);
      return [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fx_rates_ensure.fetched_rows, 7);
  assert.deepEqual(calls.map((call) => call[0]), [
    "ensure_fx_rates",
    "auto_balance_snapshots",
    "provider_transfers",
    "selected_date_balance_snapshot",
    "period_balance_reconciliation",
    "audit_snapshot",
  ]);
  assert.deepEqual(calls[0][4], ["EUR", "CAD", "UAH", "RUB", "CHF", "GBP", "THB"]);
});

test("reconcile balances returns refresh-all report for auto and manual provider outcomes", async () => {
  const result = await runReconcileBalancesAndTransfers({
    from: "2026-06-01",
    to: "2026-06-02",
    currentDate: "2026-06-02",
    ensureFxRatesRunner: async () => ({ ok: true, checked: 0, errors: [] }),
    autoBalanceRunner: async () => ({
      ok: true,
      saved_rows: 2,
      providers_checked: ["wise", "paypal", "binance", "revolut"],
      providers_succeeded: ["wise", "binance"],
      provider_results: [
        { provider: "wise", provider_current_balance_status: "available", writable_rows: 1, rows: 1 },
        { provider: "paypal", provider_current_balance_status: "needs_permission", writable_rows: 0, rows: 3, error: "PayPal token expired" },
        { provider: "binance", provider_current_balance_status: "available", writable_rows: 1, rows: 1 },
        { provider: "revolut", provider_current_balance_status: "not_implemented", writable_rows: 0, rows: 0 },
      ],
    }),
    providerTransferCollector: async () => [
      { provider: "wise", status: "ok", entries: 4, write_status: "processed_provider_movements" },
      { provider: "paypal", status: "needs_permission", entries: 0, error: "PayPal token expired", write_status: "not_written_to_ledger" },
      { provider: "binance", status: "ok", entries: 2, write_status: "processed_provider_movements" },
    ],
    selectedDateSnapshotRunner: async () => ({
      ok: true,
      balance_snapshots: {
        canonical_total_usd: 123.45,
        selected_date_coverage: { status: "ok" },
        provider_channel_matrix: [
          { provider: "wise", channel: "трансервайз дол", currency: "USD", current_balance_auto: true, access_status: "available", severity: "ok" },
          { provider: "revolut", channel: "REVOLUT евро", currency: "EUR", current_balance_auto: false, access_status: "not_implemented", stale_reason: "manual only", action_required: "ручной скриншот", severity: "red" },
        ],
      },
    }),
    periodReconciliationRunner: async () => ({
      ok: true,
      period_balance_reconciliation: {
        total_usd_row: { confirmed_end_usd: 123.45, status: "ok" },
      },
    }),
    auditSnapshotRunner: async () => ({
      ok: true,
      balances: {
        total_usd: 123.45,
        remainders_rows: [
          { channel: "REVOLUT евро", currency: "EUR", status: "needs_verification", source: "manual" },
        ],
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.transactions_imported, 6);
  assert.equal(result.updated_balance_rows, 2);
  assert.equal(result.selected_date_total_usd, 123.45);
  assert.equal(result.period_total_usd, 123.45);
  assert.equal(result.canonical_total.canonical_total_usd, 123.45);
  assert.deepEqual(result.auto_refresh_supported_providers, ["wise", "paypal", "binance"]);
  assert.deepEqual(result.refresh_report.operations_imported, [
    { provider: "wise", status: "ok", imported: 4, write_status: "processed_provider_movements", warnings: [] },
    { provider: "paypal", status: "needs_permission", imported: 0, write_status: "not_written_to_ledger", error: "PayPal token expired", warnings: [] },
    { provider: "binance", status: "ok", imported: 2, write_status: "processed_provider_movements", warnings: [] },
  ]);
  assert.deepEqual(result.refresh_report.balances_updated, [
    { provider: "wise", status: "available", updated: 1, rows: 1, error: null },
    { provider: "paypal", status: "needs_permission", updated: 0, rows: 3, error: "PayPal token expired" },
    { provider: "binance", status: "available", updated: 1, rows: 1, error: null },
  ]);
  assert.ok(result.refresh_report.errors.some((row) => row.provider === "paypal" && /token expired/i.test(row.reason)));
  assert.ok(result.refresh_report.stale_manual_channels.some((row) => row.provider === "revolut" && /ручной скриншот/i.test(row.action_required)));
  assert.ok(result.refresh_report.manual_actions.some((row) => row.channel === "REVOLUT евро" && /руч/i.test(row.action_required)));
  assert.equal(result.manual_required, result.refresh_report.manual_actions);
  assert.equal(result.stale_channels, result.refresh_report.stale_manual_channels);
});

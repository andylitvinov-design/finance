import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBalancePairsSnapshot,
} from "../server/balance-pairs-route.js";

test("balance pairs returns all expected rows with latest snapshots, USD conversion, and summary counts", async () => {
  const snapshot = await buildBalancePairsSnapshot({
    query: { from: "2026-06-10", to: "2026-06-16" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-06-09", channel: "пейпал дол", currency: "USD", amount: "35.3", sourceSheet: "Остатки", sourceRow: 11, source: "manual_fact" },
        { date: "2026-06-16", channel: "пейпал дол", currency: "USD", amount: "36.3", sourceSheet: "Авто Остатки", sourceRow: 25, source: "provider_auto" },
        { date: "2026-06-10", channel: "Binance funding", currency: "USDT", amount: "7" },
        { date: "2026-06-16", channel: "Binance funding", currency: "USDT", amount: "8" },
        { date: "2026-06-10", channel: "binance save", currency: "USDC", amount: "10" },
        { date: "2026-06-16", channel: "binance save", currency: "USDC", amount: "11" },
        { date: "2026-06-10", channel: "трансервайз евро", currency: "EUR", amount: "100", amount_usd: "108.5" },
        { date: "2026-06-16", channel: "трансервайз евро", currency: "EUR", amount: "120", amount_usd: "130.2" },
        { date: "2026-06-08", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "200" },
        { date: "2026-06-16", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "220" },
        { date: "2026-06-10", channel: "приват 24-грн", currency: "UAH", amount: "4100" },
        { date: "2026-06-16", channel: "приват 24-грн", currency: "UAH", amount: "4200" },
        { date: "2026-06-10", channel: "Яндекс руб", currency: "RUB", amount: "7900" },
        { date: "2026-06-16", channel: "Яндекс руб", currency: "RUB", amount: "7990" },
        { date: "2026-06-10", channel: "REVOLUT евро", currency: "EUR", amount: "0" },
        { date: "2026-06-16", channel: "REVOLUT евро", currency: "EUR", amount: "0" },
        { date: "2026-06-16", channel: "Payoneer - dol", currency: "USD", amount: "3.48" },
        { date: "2026-06-10", channel: "missing end", currency: "USD", amount: "5" },
      ],
      autoBalances: [
        { date: "2026-06-16", channel: "auto only", currency: "USD", amount: "9" },
      ],
      fxRates: [
        { date: "2026-06-08", currency: "CAD", base_currency: "USD", rate_to_usd: 0.73, status: "ok" },
        { date: "2026-06-16", currency: "CAD", base_currency: "USD", rate_to_usd: 0.74, status: "ok" },
        { date: "2026-06-10", currency: "UAH", base_currency: "USD", rate_to_usd: 0.025, status: "ok" },
        { date: "2026-06-16", currency: "UAH", base_currency: "USD", rate_to_usd: 0.024, status: "ok" },
        { date: "2026-06-10", currency: "RUB", base_currency: "USD", rate_to_usd: 0.012, status: "ok" },
      ],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    expectedPairs: [
      { channel: "пейпал дол", currency: "USD" },
      { channel: "Binance funding", currency: "USDT" },
      { channel: "binance save", currency: "USDC" },
      { channel: "трансервайз евро", currency: "EUR" },
      { channel: "БАНК КАНАДА cad", currency: "CAD" },
      { channel: "приват 24-грн", currency: "UAH" },
      { channel: "Яндекс руб", currency: "RUB" },
      { channel: "REVOLUT евро", currency: "EUR" },
      { channel: "Payoneer - dol", currency: "USD" },
      { channel: "missing end", currency: "USD" },
      { channel: "auto only", currency: "USD" },
      { channel: "missing both", currency: "EUR" },
    ],
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.period.from, "2026-06-10");
  assert.equal(snapshot.period.to, "2026-06-16");
  assert.equal(snapshot.summary.expected_rows, 12);
  assert.equal(snapshot.summary.found_start_rows, 9);
  assert.equal(snapshot.summary.found_end_rows, 11);
  assert.equal(snapshot.summary.missing_start_rows, 3);
  assert.equal(snapshot.summary.missing_end_rows, 1);
  assert.equal(snapshot.summary.usd_complete_start, 9);
  assert.equal(snapshot.summary.usd_complete_end, 10);
  assert.equal(snapshot.summary.fx_missing, 1);

  const byKey = new Map(snapshot.rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(byKey.get("пейпал дол|USD").start.rate_to_usd, 1);
  assert.equal(byKey.get("пейпал дол|USD").start.amount_usd, 35.3);
  assert.equal(byKey.get("пейпал дол|USD").start.source_sheet, "Остатки");
  assert.equal(byKey.get("пейпал дол|USD").start.source_row, 11);
  assert.equal(byKey.get("пейпал дол|USD").start.source_note, "Остатки #11 · manual_fact");
  assert.equal(byKey.get("пейпал дол|USD").source1, "Остатки");
  assert.equal(byKey.get("пейпал дол|USD").sourceRow1, 11);
  assert.equal(byKey.get("пейпал дол|USD").source2, "Авто Остатки");
  assert.equal(byKey.get("пейпал дол|USD").sourceRow2, 25);
  assert.equal(byKey.get("Binance funding|USDT").start.rate_to_usd, 1);
  assert.equal(byKey.get("binance save|USDC").end.amount_usd, 11);
  assert.equal(byKey.get("трансервайз евро|EUR").start.amount_usd, 108.5);
  assert.equal(byKey.get("БАНК КАНАДА cad|CAD").start.amount_usd, 146);
  assert.equal(byKey.get("приват 24-грн|UAH").end.amount_usd, 100.8);
  assert.equal(byKey.get("REVOLUT евро|EUR").start.amount_usd, 0);
  assert.equal(byKey.get("REVOLUT евро|EUR").start.status, "ok_zero");
  assert.equal(byKey.get("Payoneer - dol|USD").start.status, "missing_snapshot");
  assert.equal(byKey.get("missing end|USD").end.status, "ok");
  assert.equal(byKey.get("missing end|USD").end.snapshot_status, "latest_before");
  assert.equal(byKey.get("БАНК КАНАДА cad|CAD").start.snapshot_status, "latest_before");
  assert.equal(byKey.get("Яндекс руб|RUB").end.status, "missing_fx");
  assert.equal(byKey.get("Яндекс руб|RUB").end.message, "missing FX RUB 2026-06-16");
  assert.equal(byKey.get("missing both|EUR").start.status, "missing_snapshot");
  assert.equal(byKey.get("missing both|EUR").end.status, "missing_snapshot");
  assert.deepEqual(snapshot.diagnostics.missing_snapshot_rows, [
    {
      channel: "auto only",
      currency: "USD",
      missing_start: true,
      missing_end: false,
      reason: "no snapshot found on or before start date",
    },
    {
      channel: "missing both",
      currency: "EUR",
      missing_start: true,
      missing_end: true,
      reason: "no snapshot found on or before start/end date",
    },
    {
      channel: "Payoneer - dol",
      currency: "USD",
      missing_start: true,
      missing_end: false,
      reason: "no snapshot found on or before start date",
    },
  ]);
  assert.match(snapshot.diagnostics.copyable_missing_snapshot_rows, /channel\tcurrency\tmissing_start\tmissing_end\treason/);
  assert.match(snapshot.diagnostics.copyable_missing_snapshot_rows, /missing both\tEUR\ttrue\ttrue/);
});

test("balance pairs returns partial rows from auto balances when manual repository fails", async () => {
  const snapshot = await buildBalancePairsSnapshot({
    query: { from: "2026-06-01", to: "2026-06-17" },
    repositoryLoader: async () => ({
      ok: false,
      warning: "Manual Google Sheets overlay failed: service account missing",
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-06-01", channel: "пейпал дол", currency: "USD", amount: "10" },
        { date: "2026-06-17", channel: "пейпал дол", currency: "USD", amount: "17" },
      ],
      warnings: [],
    }),
    expectedPairs: [{ channel: "пейпал дол", currency: "USD" }],
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.status, "partial_source");
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.summary.expected_rows, 1);
  assert.equal(snapshot.summary.found_start_rows, 1);
  assert.equal(snapshot.summary.found_end_rows, 1);
  assert.match(snapshot.warnings.join("\n"), /manual Google Sheets read failed/);
  assert.match(snapshot.warnings.join("\n"), /service account missing/);
  assert.equal(snapshot.diagnostics.source_route, "balance-pairs");
  assert.equal(snapshot.diagnostics.repository_ok, false);
  assert.equal(snapshot.diagnostics.manual_balances_loaded, 0);
  assert.equal(snapshot.diagnostics.auto_balances_loaded, 2);
  assert.equal(snapshot.diagnostics.auto_balance_loader_ok, true);
  assert.equal(snapshot.diagnostics.env_config_missing, true);
});

test("balance pairs returns ok false with diagnostics when manual and auto sources fail", async () => {
  const snapshot = await buildBalancePairsSnapshot({
    query: { from: "2026-06-01", to: "2026-06-17" },
    repositoryLoader: async () => ({
      ok: false,
      warning: "Manual Google Sheets overlay failed: permission denied",
    }),
    autoBalanceLoader: async () => ({
      ok: false,
      balances: [],
      warnings: ["Auto balance sheet failed: permission denied"],
    }),
    expectedPairs: [{ channel: "пейпал дол", currency: "USD" }],
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, "repository_failed");
  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.summary.expected_rows, 0);
  assert.match(snapshot.error, /permission denied/);
  assert.match(snapshot.warnings.join("\n"), /manual Google Sheets read failed/);
  assert.match(snapshot.warnings.join("\n"), /Auto balance sheet failed/);
  assert.equal(snapshot.diagnostics.source_route, "balance-pairs");
  assert.equal(snapshot.diagnostics.repository_ok, false);
  assert.equal(snapshot.diagnostics.manual_balances_loaded, 0);
  assert.equal(snapshot.diagnostics.auto_balances_loaded, 0);
  assert.equal(snapshot.diagnostics.auto_balance_loader_ok, false);
});

test("balance pairs exposes contract-named diagnostics and source_status across all paths (issue #552)", async () => {
  const baseFx = [{ date: "2026-06-16", currency: "CAD", base_currency: "USD", rate_to_usd: 0.74, status: "ok" }];

  const complete = await buildBalancePairsSnapshot({
    query: { from: "2026-06-01", to: "2026-06-17" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-06-01", channel: "пейпал дол", currency: "USD", amount: "10" },
        { date: "2026-06-17", channel: "пейпал дол", currency: "USD", amount: "17" },
      ],
      fxRates: baseFx,
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    expectedPairs: [{ channel: "пейпал дол", currency: "USD" }],
  });
  assert.equal(complete.source_status, "complete");
  assert.equal(complete.diagnostics.source_status, "complete");
  assert.equal(complete.diagnostics.manual_repository_ok, true);
  assert.equal(complete.diagnostics.manual_repository_warning, null);
  assert.equal(complete.diagnostics.manual_balance_rows_loaded, 2);
  assert.equal(complete.diagnostics.auto_balance_rows_loaded, 0);
  assert.equal(complete.diagnostics.fx_rates_rows_loaded, 1);

  const partial = await buildBalancePairsSnapshot({
    query: { from: "2026-06-01", to: "2026-06-17" },
    repositoryLoader: async () => ({ ok: false, warning: "Manual Google Sheets overlay failed: timeout" }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [{ date: "2026-06-17", channel: "пейпал дол", currency: "USD", amount: "17" }],
      warnings: [],
    }),
    expectedPairs: [{ channel: "пейпал дол", currency: "USD" }],
  });
  assert.equal(partial.source_status, "partial");
  assert.equal(partial.diagnostics.source_status, "partial");
  assert.equal(partial.diagnostics.manual_repository_ok, false);
  assert.match(partial.diagnostics.manual_repository_warning, /timeout/);
  assert.equal(partial.diagnostics.auto_balance_rows_loaded, 1);

  const unavailable = await buildBalancePairsSnapshot({
    query: { from: "2026-06-01", to: "2026-06-17" },
    repositoryLoader: async () => ({ ok: false, warning: "Manual Google Sheets overlay failed: 429" }),
    autoBalanceLoader: async () => ({ ok: false, balances: [], warnings: ["Auto balance sheet failed: 503"] }),
    expectedPairs: [{ channel: "пейпал дол", currency: "USD" }],
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.source_status, "unavailable");
  assert.equal(unavailable.diagnostics.source_status, "unavailable");
  assert.equal(unavailable.diagnostics.manual_repository_ok, false);
  assert.equal(unavailable.diagnostics.auto_balance_rows_loaded, 0);
});
